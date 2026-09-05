/**
 * Worktree baseline.
 *
 * This repository carries a large, deliberately parked dirty worktree. That dirt
 * is somebody's unfinished work and the Mediator must neither absorb it, clean
 * it, nor lose it.
 *
 * `git status` is not a sufficient tripwire. When an OpenCode snapshot restore
 * reverted 150 tracked files during development, the only visible symptom was
 * the dirty count quietly dropping from 178 to 31 — every remaining file still
 * looked "modified", and nothing looked wrong. Content hashes caught it.
 *
 * So: capture the complete porcelain plus a SHA-256 for every dirty file, and
 * classify each one as semantic dirt or line-ending-only churn WITHOUT
 * normalizing or rewriting anything. Classification is for reporting only; no
 * function in this module ever writes to a tracked file.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureMediatorDirs, mediatorDataDir } from "./paths.mjs";
import { repoRoot } from "../paths.mjs";

export const baselinePath = join(mediatorDataDir, "worktree-baseline.json");

/** Dirt classifications. Descriptive only — nothing here triggers a rewrite. */
export const DIRT_SEMANTIC = "semantic";
export const DIRT_EOL_ONLY = "line-ending-only";
export const DIRT_UNTRACKED = "untracked";
export const DIRT_DELETED = "deleted";
export const DIRT_UNREADABLE = "unreadable";

function git(args, { binary = false } = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    maxBuffer: 1 << 28,
    encoding: binary ? "buffer" : "utf8",
  });
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** CRLF / LF / mixed / none. Reported, never corrected. */
export function eolProfile(buf) {
  const s = buf.toString("latin1");
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length - crlf;
  if (!crlf && !lf) return "none";
  if (crlf && lf) return "mixed";
  return crlf ? "crlf" : "lf";
}

function stripCr(buf) {
  return Buffer.from(buf.toString("latin1").replace(/\r/g, ""), "latin1");
}

export function parsePorcelain(text) {
  return String(text || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ xy: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, "") }));
}

function headBytes(rel) {
  try {
    return git(["show", `HEAD:${rel}`], { binary: true });
  } catch {
    return null;
  }
}

/**
 * Classify one dirty file.
 * A file whose content differs from HEAD only by carriage returns is churn; the
 * distinction matters because churn is safe to ignore and semantic dirt is not.
 */
export function classifyDirtyFile(rel, xy) {
  const abs = join(repoRoot, rel);
  if (xy.includes("D")) return { path: rel, xy, dirt: DIRT_DELETED, sha256: null, bytes: 0, eol: null };
  if (!existsSync(abs)) return { path: rel, xy, dirt: DIRT_DELETED, sha256: null, bytes: 0, eol: null };

  let cur;
  try {
    cur = readFileSync(abs);
  } catch (err) {
    return { path: rel, xy, dirt: DIRT_UNREADABLE, sha256: null, bytes: 0, eol: null, error: String(err?.message || err) };
  }

  const rec = { path: rel, xy, sha256: sha256(cur), bytes: cur.length, eol: eolProfile(cur) };
  if (xy.startsWith("??")) return { ...rec, dirt: DIRT_UNTRACKED, headSha256: null };

  const head = headBytes(rel);
  if (!head) return { ...rec, dirt: DIRT_UNTRACKED, headSha256: null };

  rec.headSha256 = sha256(head);
  rec.headEol = eolProfile(head);
  if (rec.sha256 === rec.headSha256) return { ...rec, dirt: DIRT_EOL_ONLY, identicalToHead: true };

  const sameIgnoringCr = sha256(stripCr(cur)) === sha256(stripCr(head));
  return { ...rec, dirt: sameIgnoringCr ? DIRT_EOL_ONLY : DIRT_SEMANTIC };
}

/** Snapshot the whole dirty worktree. Read-only. */
export function captureBaseline({ note = "" } = {}) {
  const porcelain = git(["status", "--porcelain", "-uall"]);
  const rows = parsePorcelain(porcelain);
  const files = rows.map((r) => classifyDirtyFile(r.path, r.xy));
  return {
    version: 1,
    capturedAt: Date.now(),
    note,
    head: git(["rev-parse", "HEAD"]).trim(),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    porcelain: porcelain.replace(/\r/g, ""),
    counts: {
      total: files.length,
      semantic: files.filter((f) => f.dirt === DIRT_SEMANTIC).length,
      eolOnly: files.filter((f) => f.dirt === DIRT_EOL_ONLY).length,
      untracked: files.filter((f) => f.dirt === DIRT_UNTRACKED).length,
      deleted: files.filter((f) => f.dirt === DIRT_DELETED).length,
    },
    files,
  };
}

export function saveBaseline(baseline) {
  ensureMediatorDirs();
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return baselinePath;
}

export function loadBaseline() {
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Compare the worktree against a captured baseline.
 *
 * `revertedToHead` is called out separately from `changed` because it is the
 * signature of a snapshot restore silently discarding parked work — the exact
 * failure this module exists to catch.
 */
export function verifyBaseline(baseline, { now = null } = {}) {
  if (!baseline) return { ok: false, error: "no baseline captured" };
  const current = now || captureBaseline();
  const byPath = new Map(current.files.map((f) => [f.path, f]));

  const unchanged = [];
  const changed = [];
  const revertedToHead = [];
  const vanished = [];

  for (const before of baseline.files) {
    const after = byPath.get(before.path);
    if (!after) {
      // No longer dirty. Either it was reverted to HEAD, or it was committed.
      const abs = join(repoRoot, before.path);
      const head = headBytes(before.path);
      const cur = existsSync(abs) ? readFileSync(abs) : null;
      if (cur && head && sha256(cur) === sha256(head) && before.sha256 !== sha256(head)) {
        revertedToHead.push({ path: before.path, was: before.sha256, now: sha256(head), dirt: before.dirt });
      } else {
        vanished.push({ path: before.path, was: before.sha256 });
      }
      continue;
    }
    if (after.sha256 === before.sha256) unchanged.push(before.path);
    else changed.push({ path: before.path, was: before.sha256, now: after.sha256, wasEol: before.eol, nowEol: after.eol, dirt: before.dirt });
  }

  const appeared = current.files
    .filter((f) => !baseline.files.some((b) => b.path === f.path))
    .map((f) => ({ path: f.path, dirt: f.dirt, sha256: f.sha256 }));

  // Losing parked semantic work is the serious case; new tooling files are not.
  const lostSemantic = [...revertedToHead, ...vanished]
    .filter((r) => (r.dirt || DIRT_SEMANTIC) === DIRT_SEMANTIC);

  return {
    ok: revertedToHead.length === 0 && vanished.length === 0 && changed.length === 0,
    safe: lostSemantic.length === 0,
    baselineAt: baseline.capturedAt,
    unchanged: unchanged.length,
    changed,
    revertedToHead,
    vanished,
    appeared,
    lostSemantic,
  };
}

/** Only the files whose bytes must be protected: real production dirt. */
export function protectedProductionFiles(baseline) {
  if (!baseline) return [];
  return baseline.files
    .filter((f) => f.dirt === DIRT_SEMANTIC)
    .filter((f) => /^(src|electron|scripts)\//.test(f.path))
    .map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }));
}

export function renderVerify(v) {
  if (v.error) return v.error;
  const lines = [];
  lines.push(`baseline taken ${new Date(v.baselineAt).toLocaleString()}`);
  lines.push(`  unchanged:       ${v.unchanged}`);
  lines.push(`  content changed: ${v.changed.length}`);
  lines.push(`  REVERTED TO HEAD:${v.revertedToHead.length}`);
  lines.push(`  vanished:        ${v.vanished.length}`);
  lines.push(`  newly dirty:     ${v.appeared.length}`);
  for (const r of v.revertedToHead.slice(0, 40)) lines.push(`    reverted: ${r.path} (${r.dirt})`);
  for (const c of v.changed.slice(0, 40)) {
    const eol = c.wasEol !== c.nowEol ? `  [eol ${c.wasEol} -> ${c.nowEol}]` : "";
    lines.push(`    changed:  ${c.path} (${c.dirt})${eol}`);
  }
  lines.push(v.safe
    ? "  no parked semantic work has been lost"
    : `  WARNING: ${v.lostSemantic.length} parked semantic file(s) lost — see above`);
  return lines.join("\n");
}
