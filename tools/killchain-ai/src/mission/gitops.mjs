import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/**
 * Production-adjacent scratch files are never an authorized write, even if
 * allowedPaths is a directory glob. The runner/checkpoint system is the backup.
 */
export function isSidecarPath(rel) {
  const p = toPosixRel(rel);
  const base = (p.split("/").pop() || "").toLowerCase();
  if (!base) return false;
  if (/\.(bak|tmp|old|orig)$/i.test(base)) return true;
  if (/^(copy|backup)\.(ts|tsx|js|mjs|jsx)$/i.test(base)) return true;
  return false;
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

export function appDiffFiles(files) {
  return (files || []).filter((p) => isAppPath(p) && !isToolingPath(p) && !GENERATED_SIDE_EFFECTS.includes(toPosixRel(p)));
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
  const patch = gitRun(["diff"], { allowFail: true, stripTrailingNl: false });
  return { files, insertions, deletions, patch };
}

export function gitDiffStatFor(files) {
  const list = (files || []).map(toPosixRel).filter(Boolean);
  if (!list.length) {
    return { files: [], insertions: 0, deletions: 0, patch: "" };
  }
  const numstat = gitRun(["diff", "--numstat", "--", ...list], { allowFail: true });
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
    const [a, b] = line.split("\t");
    if (a !== "-") insertions += Number(a) || 0;
    if (b !== "-") deletions += Number(b) || 0;
  }
  const patch = gitRun(["diff", "--", ...list], { allowFail: true, stripTrailingNl: false });
  return { files: list, insertions, deletions, patch };
}

/** Fallback for files never fingerprinted. Not used for mission-owned restore. */
export function gitShowHead(rel, { cwd = repoRoot } = {}) {
  try {
    return execFileSync("git", ["show", `HEAD:${toPosixRel(rel)}`], {
      cwd,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

export function gitAppDiffStat() {
  const nameOnly = gitRun(["diff", "--name-only"], { allowFail: true });
  const files = appDiffFiles(nameOnly ? nameOnly.split(/\r?\n/).filter(Boolean).map(toPosixRel) : []);
  return gitDiffStatFor(files);
}

/** Critic/size checks should ignore pre-existing dirty files outside the allowlist. */
export function allowedAppDiffFiles(files, spec) {
  return (files || []).filter((p) => pathEditable(p, spec, { dryRun: false }));
}

export function gitAllowedAppDiffStat(spec) {
  return gitDiffStatFor(allowedAppDiffFiles(gitAppDiffStat().files, spec));
}

export function changesSince(snapshot, porcelainNow = gitPorcelain()) {
  const before = new Set((snapshot?.porcelain || []).map((r) => `${r.xy} ${r.path}`));
  const now = porcelainNow;
  const added = now.filter((r) => !before.has(`${r.xy} ${r.path}`));
  return { now, added };
}

/**
 * Proposal/plan phases must revert only files dirtied *during that phase*.
 * Comparing against the mission-start snapshot would check out allowed edits
 * from earlier EDITING phases.
 */
export function revertBaseline(snapshot, phaseSnapshot, revertAllApp) {
  if (revertAllApp && phaseSnapshot) return phaseSnapshot;
  return snapshot;
}

export function latestCheckpointDir(missionDir) {
  const root = join(missionDir, "checkpoints");
  if (!existsSync(root)) return null;
  const names = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => /^\d+$/.test(n))
    .sort();
  if (!names.length) return null;
  return join(root, names[names.length - 1]);
}

export function readCheckpointFiles(cdir) {
  const p = join(cdir, "files.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/).map((s) => toPosixRel(s.trim())).filter(Boolean);
}

export function missingCheckpointAppFiles(checkpointFiles, dirtyFiles) {
  const dirty = new Set((dirtyFiles || []).map((p) => toPosixRel(p)));
  return (checkpointFiles || [])
    .map((p) => toPosixRel(p))
    .filter((p) => p && isAppPath(p) && !isToolingPath(p) && !GENERATED_SIDE_EFFECTS.includes(p) && !dirty.has(p));
}

export function extractFilePatch(unified, rel) {
  const p = toPosixRel(rel);
  const src = String(unified || "").replace(/\r\n/g, "\n");
  const needle = `diff --git a/${p} b/${p}`;
  const start = src.indexOf(needle);
  if (start < 0) return "";
  const rest = src.slice(start);
  const next = rest.indexOf("\ndiff --git ", 1);
  let body = next >= 0 ? rest.slice(0, next + 1) : rest;
  if (!body.endsWith("\n")) body += "\n";
  return body;
}

export function applyPatchIncludes(patchPath, files) {
  if (!files.length) return { ok: true, applied: [], output: "" };
  if (!existsSync(patchPath)) return { ok: false, applied: [], output: "missing patch" };
  const unified = readFileSync(patchPath, "utf8");
  const applied = [];
  const failed = [];
  const notes = [];
  for (const f of files) {
    const body = extractFilePatch(unified, f);
    if (!body) {
      failed.push(f);
      notes.push(`${f}: not in patch`);
      continue;
    }
    const tmp = `${patchPath}.${basename(f)}.part.patch`;
    writeFileSync(tmp, body.endsWith("\n") ? body : `${body}\n`, "utf8");
    const tryApply = (args) => gitRun(args);
    try {
      tryApply(["apply", "--whitespace=nowarn", tmp]);
      applied.push(f);
    } catch (err) {
      try {
        tryApply(["apply", "--ignore-whitespace", tmp]);
        applied.push(f);
        notes.push(`${f}: applied with --ignore-whitespace`);
      } catch (err2) {
        failed.push(f);
        notes.push(`${f}: ${String(err2.stderr || err2.message || err.stderr || err.message || "apply failed").slice(0, 240)}`);
      }
    }
  }
  return {
    ok: failed.length === 0,
    applied,
    failed,
    output: notes.join("\n"),
  };
}

/** Re-apply Qwen files from the latest checkpoint that proposing later wiped. Prefer lossless file copies. */
export function restoreMissingCheckpointFiles(missionDir, dirtyFiles, io = null) {
  const cdir = latestCheckpointDir(missionDir);
  if (!cdir) return { ok: true, restored: [], skipped: "no-checkpoint" };
  const dirty = dirtyFiles || gitAppDiffStat().files;
  const wanted = missingCheckpointAppFiles(readCheckpointFiles(cdir), dirty);
  if (!wanted.length) return { ok: true, restored: [], skipped: "already-present" };
  const filesDir = join(cdir, "files");
  if (existsSync(filesDir) && io) {
    const restored = [];
    const failed = [];
    for (const rel of wanted) {
      const blob = join(filesDir, ...toPosixRel(rel).split("/"));
      if (!existsSync(blob)) {
        failed.push(rel);
        continue;
      }
      io.write(rel, readFileSync(blob));
      restored.push(rel);
    }
    if (!failed.length) return { ok: true, restored, wanted, via: "files" };
  }
  const r = applyPatchIncludes(join(cdir, "diff.patch"), wanted);
  return { ...r, restored: r.ok ? wanted : [], wanted, via: "patch" };
}

export function unauthorizedChanges(rows, spec, { dryRun = false } = {}) {
  const unauthorized = [];
  const allowed = [];
  for (const row of rows) {
    if (isToolingPath(row.path)) continue;
    if (GENERATED_SIDE_EFFECTS.includes(row.path)) continue;
    if (isSidecarPath(row.path)) {
      unauthorized.push(row);
      continue;
    }
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
