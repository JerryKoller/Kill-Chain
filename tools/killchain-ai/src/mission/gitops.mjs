import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { gitRun } from "../git.mjs";
import { repoRoot } from "../paths.mjs";
import { pathEditable, toPosixRel } from "./schema.mjs";

export const GENERATED_SIDE_EFFECTS = ["tsconfig.tsbuildinfo"];

export function isAppPath(rel) {
  const p = toPosixRel(rel);
  return (
    p.startsWith("src/") ||
    p.startsWith("electron/") ||
    p.startsWith("scripts/") ||
    p.startsWith("public/") ||
    p === "package.json" ||
    p === "package-lock.json" ||
    p === "index.html" ||
    p === "tsconfig.json" ||
    p === "tsconfig.tsbuildinfo" ||
    p === "vite.config.ts"
  );
}

export function isToolingPath(rel) {
  const p = toPosixRel(rel);
  return p === "tools/killchain-ai" || p.startsWith("tools/killchain-ai/") || p.includes("killchain-ai/");
}

export function parsePorcelain(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/).filter(Boolean)) {
    const m = line.match(/^(..) (.*)$/);
    if (!m) continue;
    const xy = m[1];
    let path = m[2];
    let orig = null;
    if (path.includes(" -> ")) {
      const idx = path.lastIndexOf(" -> ");
      orig = toPosixRel(path.slice(0, idx).replace(/^"|"$/g, ""));
      path = path.slice(idx + 4);
    }
    path = toPosixRel(path.replace(/^"|"$/g, ""));
    rows.push({
      xy,
      path,
      orig,
      untracked: xy === "??",
    });
  }
  return rows;
}

export function gitPorcelain() {
  return parsePorcelain(gitRun(["status", "--porcelain", "-u"], { allowFail: true }));
}

export function classifyPorcelain(rows) {
  const app = [];
  const tools = [];
  const other = [];
  for (const row of rows) {
    if (isToolingPath(row.path)) tools.push(row);
    else if (isAppPath(row.path)) app.push(row);
    else other.push(row);
  }
  return { app, tools, other };
}

export function snapshotWorktree() {
  return {
    at: new Date().toISOString(),
    head: gitRun(["rev-parse", "HEAD"], { allowFail: true }),
    porcelain: gitPorcelain(),
  };
}

export function diffCheckArgs() {
  return ["-c", "core.whitespace=cr-at-eol", "diff", "--check"];
}

/**
 * Mixed-EOL repo: never treat CR-at-EOL as an error.
 * Does not normalize files.
 */
export function gitDiffCheck(paths = []) {
  const args = diffCheckArgs();
  if (paths.length) args.push("--", ...paths);
  try {
    const out = gitRun(args);
    return { ok: true, output: out, args };
  } catch (err) {
    const output = `${err.stdout || ""}${err.stderr || ""}`.trim();
    return { ok: false, output, args, code: err.status };
  }
}

export function gitDiffStat() {
  const numstat = gitRun(["diff", "--numstat"], { allowFail: true });
  const nameOnly = gitRun(["diff", "--name-only"], { allowFail: true });
  const files = nameOnly ? nameOnly.split(/\r?\n/).filter(Boolean).map(toPosixRel) : [];
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
    const [a, b] = line.split("\t");
    if (a !== "-") insertions += Number(a) || 0;
    if (b !== "-") deletions += Number(b) || 0;
  }
  const patch = gitRun(["diff"], { allowFail: true });
  return { files, insertions, deletions, patch };
}

export function changesSince(snapshot, porcelainNow = gitPorcelain()) {
  const before = new Set((snapshot?.porcelain || []).map((r) => `${r.xy} ${r.path}`));
  const now = porcelainNow;
  const added = now.filter((r) => !before.has(`${r.xy} ${r.path}`));
  return { now, added };
}

export function unauthorizedChanges(rows, spec, { dryRun = false } = {}) {
  const unauthorized = [];
  const allowed = [];
  for (const row of rows) {
    if (isToolingPath(row.path)) continue;
    if (GENERATED_SIDE_EFFECTS.includes(row.path)) continue;
    if (pathEditable(row.path, spec, { dryRun })) allowed.push(row);
    else unauthorized.push(row);
  }
  return { unauthorized, allowed };
}

export function unexpectedJunk(rows, spec, { dryRun = false } = {}) {
  return rows.filter((row) => {
    if (!row.untracked) return false;
    if (isToolingPath(row.path)) return false;
    if (pathEditable(row.path, spec, { dryRun })) return false;
    return true;
  });
}

export function restoreGenerated(paths = GENERATED_SIDE_EFFECTS, { wasClean = true } = {}) {
  if (!wasClean) return [];
  const restored = [];
  for (const p of paths) {
    const abs = join(repoRoot, p);
    if (!existsSync(abs)) continue;
    try {
      gitRun(["checkout", "--", p]);
      restored.push(p);
    } catch {
      /* not tracked or already clean */
    }
  }
  return restored;
}

/**
 * Revert only identified unauthorized Qwen changes.
 * Tracked → git checkout -- <file>
 * Untracked → move into quarantine (do not git reset --hard).
 */
export function revertUnauthorized(rows, { quarantineDir } = {}) {
  const reverted = [];
  const quarantined = [];
  for (const row of rows) {
    if (isToolingPath(row.path)) continue;
    if (row.untracked) {
      if (!quarantineDir) continue;
      mkdirSync(quarantineDir, { recursive: true });
      const src = join(repoRoot, row.path);
      if (!existsSync(src)) continue;
      const dest = join(quarantineDir, `${Date.now()}-${basename(row.path)}`);
      renameSync(src, dest);
      quarantined.push({ from: row.path, to: dest });
    } else {
      const abs = join(repoRoot, row.path);
      if (!existsSync(abs)) continue;
      gitRun(["checkout", "--", row.path], { allowFail: true });
      reverted.push(row.path);
    }
  }
  return { reverted, quarantined };
}

export function fileLooksCrlf(absPath) {
  try {
    const buf = readFileSync(absPath);
    return buf.subarray(0, 8192).toString("binary").includes("\r\n");
  } catch {
    return false;
  }
}

export function wasPathClean(snapshot, rel) {
  const p = toPosixRel(rel);
  return !(snapshot?.porcelain || []).some((r) => r.path === p);
}

export function fileSizeOk(stat, spec) {
  const overFiles = stat.files.length > spec.diff.maxFiles;
  const overIns = stat.insertions > spec.diff.maxInsertions;
  return {
    overFiles,
    overIns,
    warn: overFiles || overIns,
    block: (overFiles || overIns) && spec.diff.warnOnly === false,
  };
}
