/**
 * Mine curriculum exercises from real Git history at HUNK granularity.
 *
 * Why hunks: this repo's history is release-sized commits, so commit-level
 * mining yields almost nothing (a scan of 80 commits found ONE small
 * single-file change). But those same commits carry 42-314 independent hunks
 * each in src/components alone, and every hunk is a real, human-authored,
 * shipped change. That is the actual gold mine.
 *
 * An exercise is built by reverse-applying ONE hunk to the committed file:
 *   BEFORE = committed file with that single hunk undone
 *   AFTER  = the committed file (hidden gold)
 * The model is asked to make the change; the gold decides whether it did.
 *
 * If BEFORE still parses, this is an "apply" exercise. If reverting the hunk
 * broke the file (because it was coupled to its neighbours), it is a genuine
 * repair fixture instead. Both are useful, and the distinction is measured
 * rather than assumed.
 *
 * Discovery and construction only. No model is invoked here.
 */
import { execFileSync } from "node:child_process";
import { repoRoot } from "../paths.mjs";
import { scanStructure } from "../mission/jsxStructure.mjs";
import { checkTsSyntax } from "../mission/syntax.mjs";
import { FAMILIES } from "./mineEpisodes.mjs";

function git(args, { maxBuffer = 200e6 } = {}) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer });
}

/** @typedef {{header:string,oldStart:number,oldCount:number,newStart:number,newCount:number,lines:string[]}} Hunk */

/** Split a single-file unified diff into hunks. */
export function parseHunks(diffText) {
  const lines = String(diffText || "").split(/\r?\n/);
  /** @type {Hunk[]} */
  const hunks = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      if (cur) hunks.push(cur);
      cur = {
        header: line,
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      continue;
    }
    if (!cur) continue;
    if (/^[-+ ]/.test(line) || line === "") cur.lines.push(line);
    else break; // end of this file's diff
  }
  if (cur) hunks.push(cur);
  return hunks;
}

/**
 * Undo one hunk in the AFTER text.
 * Verifies the hunk's expected new-side content actually matches before
 * splicing, and returns null on mismatch rather than producing garbage.
 */
export function reverseApplyHunk(afterText, hunk) {
  const src = afterText.split(/\r?\n/);
  const expectedNew = [];
  const restoredOld = [];
  for (const l of hunk.lines) {
    const tag = l[0];
    const body = l.slice(1);
    if (tag === " ") {
      expectedNew.push(body);
      restoredOld.push(body);
    } else if (tag === "+") {
      expectedNew.push(body);
    } else if (tag === "-") {
      restoredOld.push(body);
    }
  }
  const start = hunk.newStart - 1;
  const slice = src.slice(start, start + expectedNew.length);
  if (slice.length !== expectedNew.length) return null;
  for (let i = 0; i < expectedNew.length; i += 1) {
    if (slice[i] !== expectedNew[i]) return null;
  }
  return [...src.slice(0, start), ...restoredOld, ...src.slice(start + expectedNew.length)].join("\n");
}

/** Deterministic family classification from the hunk's changed content. */
export function classifyHunk(hunk, rel) {
  const added = hunk.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join("\n");
  const removed = hunk.lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1)).join("\n");
  const both = `${added}\n${removed}`;

  if (/^\s*import\b|^\s*export\s+\{/m.test(both)) return FAMILIES.MECHANICAL_IMPORT;
  if (/className=|\bgap-|\bmax-w-|\bmin-w-|\btruncate\b|\btracking-|text-\[|\bshrink-|\bflex\b|\bgrid\b|padding|margin/.test(both)) {
    return FAMILIES.UI_LAYOUT;
  }
  if (/aria-|role=|tabIndex|onKeyDown|focus/i.test(both)) return FAMILIES.CRITIC_REVISION;
  return FAMILIES.SINGLE_FILE_APPLY;
}

/**
 * State the task without handing over the literal patch.
 *
 * Two goal styles, chosen by family:
 *  - "directed": names the concrete before/after values. This is the
 *    approved-proposal-to-applied-patch family, which is exactly the
 *    apply-plan disconnect we want to measure, so being explicit is correct.
 *  - "intent": describes the change without the values, for families where
 *    we want to test comprehension rather than transcription.
 */
export function goalForHunk(hunk, rel, family) {
  const added = hunk.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim()).filter(Boolean);
  const removed = hunk.lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim()).filter(Boolean);
  const where = `in ${rel.split("/").pop()} around line ${hunk.newStart}`;

  if (!removed.length && added.length) {
    return {
      style: "directed",
      text: `Insert the following ${added.length === 1 ? "line" : `${added.length} lines`} ${where}, preserving the surrounding code exactly:\n`
        + added.map((l) => `    ${l}`).join("\n"),
    };
  }
  if (removed.length && !added.length) {
    return {
      style: "directed",
      text: `Remove the following ${removed.length === 1 ? "line" : `${removed.length} lines`} ${where}, changing nothing else:\n`
        + removed.map((l) => `    ${l}`).join("\n"),
    };
  }
  return {
    style: "directed",
    text: `Replace this code ${where}:\n${removed.map((l) => `    ${l}`).join("\n")}\n\nwith:\n${added.map((l) => `    ${l}`).join("\n")}\n\nChange nothing else.`,
  };
}

/**
 * Mine exercises.
 *
 * @param {object} o
 * @param {number} o.commits how many recent commits to scan
 * @param {number} o.minLines minimum changed lines in a hunk
 * @param {number} o.maxLines maximum changed lines in a hunk
 * @param {number} o.perFile cap exercises per file so one big file cannot dominate
 * @param {string} o.pathspec git pathspec to mine
 */
export function mineHunkExercises({
  commits = 25,
  minLines = 2,
  maxLines = 14,
  perFile = 2,
  perCommit = 6,
  pathspec = "src/components/**/*.tsx",
} = {}) {
  let shas = [];
  try {
    shas = git(["log", "--format=%H", `-${commits}`, "--", pathspec]).split(/\r?\n/).filter(Boolean);
  } catch {
    return { exercises: [], errors: ["git log failed"] };
  }

  const exercises = [];
  const errors = [];
  const perFileCount = new Map();

  for (const sha of shas) {
    let files = [];
    try {
      files = git(["show", "--numstat", "--format=", sha, "--", pathspec])
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => l.split("\t"))
        .filter((p) => p.length === 3 && p[0] !== "-")
        .map((p) => ({ rel: p[2].split(/[\\/]/).join("/"), add: Number(p[0]), del: Number(p[1]) }));
    } catch {
      continue;
    }

    let takenThisCommit = 0;
    for (const f of files) {
      if (takenThisCommit >= perCommit) break;
      if ((perFileCount.get(f.rel) || 0) >= perFile) continue;

      let afterText;
      let diffText;
      try {
        afterText = git(["show", `${sha}:${f.rel}`]);
        diffText = git(["show", sha, "--unified=3", "--format=", "--", f.rel]);
      } catch {
        continue;
      }
      const hunks = parseHunks(diffText.replace(/^diff --git[\s\S]*?^@@/m, "@@"));
      for (const h of hunks) {
        if (takenThisCommit >= perCommit) break;
        if ((perFileCount.get(f.rel) || 0) >= perFile) break;
        const changed = h.lines.filter((l) => l.startsWith("+") || l.startsWith("-")).length;
        if (changed < minLines || changed > maxLines) continue;

        const before = reverseApplyHunk(afterText, h);
        if (before == null || before === afterText) continue;

        const jsx = f.rel.endsWith(".tsx");
        const beforeSound = scanStructure(before, { jsx }).ok && checkTsSyntax(f.rel, before).ok;
        const family = classifyHunk(h, f.rel);
        const goal = goalForHunk(h, f.rel, family);

        exercises.push({
          id: `hunk-${sha.slice(0, 7)}-${f.rel.split("/").pop().replace(/\.tsx$/, "")}-L${h.newStart}`,
          source: "git-hunk",
          sha,
          rel: f.rel,
          family,
          // A hunk whose removal breaks the file is a repair fixture, not an
          // apply exercise. Measured, not assumed.
          kind: beforeSound ? "apply" : "repair",
          tier: beforeSound ? 2 : 5,
          changedLines: changed,
          hunkHeader: h.header,
          goalStyle: goal.style,
          goal: goal.text,
          fixtureSource: before,
          goldSource: afterText,
          // Acceptance evidence: the exact lines the real change added and
          // removed, so success is decided against the shipped diff rather
          // than against a prose judgement.
          addedLines: h.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim()).filter(Boolean),
          removedLines: h.lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim()).filter(Boolean),
        });
        perFileCount.set(f.rel, (perFileCount.get(f.rel) || 0) + 1);
        takenThisCommit += 1;
      }
    }
  }
  return { exercises, errors };
}

/**
 * Self-test: reverse-applying EVERY hunk of a file must reproduce the parent
 * blob exactly. If that does not hold, the patcher is wrong and no exercise it
 * produces can be trusted.
 */
export function selfTest({ commits = 6, pathspec = "src/components/**/*.tsx" } = {}) {
  const results = { checked: 0, exact: 0, mismatched: [], skipped: 0 };
  let shas = [];
  try {
    shas = git(["log", "--format=%H", `-${commits}`, "--", pathspec]).split(/\r?\n/).filter(Boolean);
  } catch {
    return results;
  }
  for (const sha of shas) {
    let files = [];
    try {
      files = git(["show", "--numstat", "--format=", sha, "--", pathspec])
        .split(/\r?\n/).filter(Boolean)
        .map((l) => l.split("\t")).filter((p) => p.length === 3 && p[0] !== "-")
        .map((p) => p[2].split(/[\\/]/).join("/"));
    } catch {
      continue;
    }
    for (const rel of files.slice(0, 3)) {
      let afterText;
      let parentText;
      let diffText;
      try {
        afterText = git(["show", `${sha}:${rel}`]);
        parentText = git(["show", `${sha}^:${rel}`]);
        diffText = git(["show", sha, "--unified=3", "--format=", "--", rel]);
      } catch {
        results.skipped += 1;
        continue;
      }
      const hunks = parseHunks(diffText.replace(/^diff --git[\s\S]*?^@@/m, "@@"));
      if (!hunks.length) {
        results.skipped += 1;
        continue;
      }
      // Undo hunks bottom-up so earlier line numbers stay valid.
      let text = afterText;
      let ok = true;
      for (const h of [...hunks].sort((a, b) => b.newStart - a.newStart)) {
        const next = reverseApplyHunk(text, h);
        if (next == null) {
          ok = false;
          break;
        }
        text = next;
      }
      results.checked += 1;
      const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\n$/, "");
      if (ok && norm(text) === norm(parentText)) results.exact += 1;
      else results.mismatched.push(`${sha.slice(0, 7)}:${rel}`);
    }
  }
  return results;
}

export function summarizeHunks(exercises) {
  const byFamily = {};
  const byKind = {};
  const byTier = {};
  for (const e of exercises) {
    byFamily[e.family] = (byFamily[e.family] || 0) + 1;
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    byTier[`tier${e.tier}`] = (byTier[`tier${e.tier}`] || 0) + 1;
  }
  return {
    total: exercises.length,
    families: Object.keys(byFamily).length,
    byFamily,
    byKind,
    byTier,
    files: new Set(exercises.map((e) => e.rel)).size,
    commits: new Set(exercises.map((e) => e.sha)).size,
  };
}
