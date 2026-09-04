/**
 * Edit curriculum: real editing evidence, generated safely.
 *
 * The archive is 70 read-only missions and essentially 1 real editing mission,
 * so every autonomy claim above Level 1 rests on almost no data. This harness
 * generates genuine PROPOSAL -> EDIT -> DELTA -> SYNTAX -> VALIDATION evidence
 * without touching production.
 *
 * Task sources are real, not invented:
 *   APPLY tier      — validated Qwen-authored changes parked in the worktree.
 *                     The fixture is the committed (pre-change) bytes; the
 *                     approved proposal is derived from the real change; the
 *                     gold result is hidden from the executor. This is task
 *                     family C (approved proposal -> exact applied patch),
 *                     which is the apply-plan disconnect bottleneck.
 *   MECHANICAL tier — one real closing delimiter deleted from a real
 *                     production file. This reproduces the archive's dominant
 *                     mechanical failure under controlled conditions and tests
 *                     the open hypothesis from the first audit: that a 9B model
 *                     can fix ONE structural fault but not two.
 *
 * Every task runs in its own sandbox. Production hashes are verified before
 * and after, and drift fails the run.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, repoRoot } from "../paths.mjs";
import { runOpenCode, parseOpenCodeJsonl } from "../mission/opencode.mjs";
import { DEFAULT_MISSION_MODEL, normalizeModelId } from "../mission/model.mjs";
import { checkTsSyntax, formatDiagnostics } from "../mission/syntax.mjs";
import { scanStructure, jsxRepairPacket } from "../mission/jsxStructure.mjs";
import { DISCIPLINE } from "../mission/prompts.mjs";
import { emptyEditPacket, validationPacket } from "../mission/tutor.mjs";
import { mineHunkExercises } from "./mineHunks.mjs";

const root = join(dataDir, "overnight", "edit-curriculum");

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function hashFile(abs) {
  return existsSync(abs) ? sha(readFileSync(abs)) : null;
}
function gitShow(rel) {
  // Committed bytes for a path, i.e. the state before the parked change.
  try {
    return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 40e6 });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ tasks */

/**
 * APPLY tasks. `goal` is what an approved proposal would state; `accept`
 * deterministically decides whether the applied patch achieved it.
 * The gold text is never shown to the executor.
 */
const APPLY_TASKS = [
  {
    id: "apply-01-toggle-contrast",
    tier: 1,
    rel: "src/components/FireCommand/ModuleEnableToggle.tsx",
    goal:
      "In the disabled-state style branch of ModuleEnableToggle, raise the contrast of the three "
      + "inline style values so a disabled chip is clearly legible: set borderColor to "
      + "rgba(255,255,255,0.30), color to rgba(255,255,255,0.65), and background to rgba(10,10,10,0.75). "
      + "Change nothing else — do not touch the enabled branch, click handling, or aria attributes.",
    accept: (after) =>
      after.includes("rgba(255,255,255,0.30)")
      && after.includes("rgba(255,255,255,0.65)")
      && after.includes("rgba(10,10,10,0.75)"),
    guard: (before, after) => {
      // Enabled-branch marker and click semantics must survive.
      const keep = ["fcChipCharacterStyle", "aria-pressed", "onClick"];
      return keep.every((k) => !before.includes(k) || after.includes(k));
    },
  },
  {
    id: "apply-02-gate-strip-gaps",
    tier: 1,
    rel: "src/components/FireCommand/GatePanel.tsx",
    goal:
      "Tighten the horizontal gaps in the Gate panel strips: every occurrence of the Tailwind class "
      + "`gap-1` that sits on a strip row container should become `gap-[0.3rem]`. Do not change any "
      + "other class, and do not alter component structure or handlers.",
    accept: (after) => after.includes("gap-[0.3rem]"),
    guard: (before, after) => after.includes("export function") && after.length > before.length * 0.9,
  },
  {
    id: "apply-03-macro-strip-gaps",
    tier: 1,
    rel: "src/components/FireCommand/MacroPanel.tsx",
    goal:
      "Tighten the horizontal gaps in the Macro panel Helm/All strips: change the `gap-1` class on those "
      + "strip row containers to `gap-[0.3rem]`. Change nothing else.",
    accept: (after) => after.includes("gap-[0.3rem]"),
    guard: (before, after) => after.includes("export function") && after.length > before.length * 0.9,
  },
];

/**
 * MECHANICAL tasks: delete exactly one real closing delimiter from a real
 * file. Chosen deterministically (the Nth closing tag) so fixtures are
 * reproducible, and validated to actually break the parse before use.
 */
const MECHANICAL_SOURCES = [
  { rel: "src/components/FireCommand/ModuleEnableToggle.tsx", nth: 1 },
  { rel: "src/components/FireCommand/GatePanel.tsx", nth: 2 },
  { rel: "src/components/FireCommand/MacroPanel.tsx", nth: 2 },
  { rel: "src/components/FireCommand/PatternSelect.tsx", nth: 1 },
  { rel: "src/components/FireCommand/fireUiKit.tsx", nth: 2 },
  { rel: "src/components/FireCommand/fcChip.tsx", nth: 1 },
];

/** Remove the nth closing JSX tag; returns null when it fails to break parsing. */
function injectSingleFault({ rel, nth }) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) return null;
  const original = readFileSync(abs, "utf8");
  if (!scanStructure(original, { jsx: true }).ok) return null; // must start clean

  const lines = original.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(<\/[A-Za-z][A-Za-z0-9.]*>)\s*$/);
    if (!m) continue;
    seen += 1;
    if (seen !== nth) continue;
    const broken = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
    const scan = scanStructure(broken, { jsx: true });
    const gate = checkTsSyntax(rel, broken);
    if (scan.ok && gate.ok) return null; // deleting it changed nothing detectable
    return { original, broken, removedLine: i + 1, removedText: m[2].trim() };
  }
  return null;
}

export function buildMechanicalTasks() {
  const out = [];
  for (const src of MECHANICAL_SOURCES) {
    const inj = injectSingleFault(src);
    if (!inj) continue;
    out.push({
      id: `mech-${String(out.length + 1).padStart(2, "0")}-${src.rel.split("/").pop().replace(/\.tsx$/, "")}`,
      tier: 5,
      rel: src.rel,
      kind: "mechanical",
      fixtureSource: inj.broken,
      goldSource: inj.original,
      removedLine: inj.removedLine,
      removedText: inj.removedText,
      goal:
        "This file does not parse. Exactly one closing delimiter is missing. "
        + "Restore it. Make the smallest possible edit and change nothing else.",
      accept: (after) => scanStructure(after, { jsx: true }).ok && checkTsSyntax(src.rel, after).ok,
    });
  }
  return out;
}

export function buildApplyTasks() {
  const out = [];
  for (const t of APPLY_TASKS) {
    const committed = gitShow(t.rel);
    const current = existsSync(join(repoRoot, t.rel)) ? readFileSync(join(repoRoot, t.rel), "utf8") : null;
    if (!committed || !current) continue;
    // The parked change is the hidden gold; skip if nothing is parked.
    if (sha(Buffer.from(committed)) === sha(Buffer.from(current))) continue;
    out.push({ ...t, kind: "apply", fixtureSource: committed, goldSource: current });
  }
  return out;
}

/**
 * Exercises mined from real Git history at hunk granularity.
 *
 * Acceptance is decided against the shipped diff: every line the real change
 * added must be present and every line it removed must be gone. Exact byte
 * equality with the gold is recorded separately but not required, since a
 * different-but-equivalent edit is still a correct edit.
 */
export function buildHunkTasks({ limit = 20, families = null, kinds = null } = {}) {
  let mined;
  try {
    mined = mineHunkExercises({ commits: 25 }).exercises;
  } catch {
    return [];
  }
  const picked = [];
  const perFamily = new Map();
  // Round-robin across families so one family cannot swamp the sample.
  const cap = Math.max(1, Math.ceil(limit / Math.max(1, new Set(mined.map((e) => e.family)).size)));
  for (const e of mined) {
    if (picked.length >= limit) break;
    if (families && !families.includes(e.family)) continue;
    if (kinds && !kinds.includes(e.kind)) continue;
    if ((perFamily.get(e.family) || 0) >= cap) continue;
    perFamily.set(e.family, (perFamily.get(e.family) || 0) + 1);
    picked.push({
      id: e.id,
      tier: e.tier,
      rel: e.rel,
      kind: e.kind === "repair" ? "mechanical" : "apply",
      family: e.family,
      source: "git-hunk",
      sha: e.sha,
      goal: e.goal,
      fixtureSource: e.fixtureSource,
      goldSource: e.goldSource,
      accept: (after) => {
        if (after === e.goldSource) return true;
        const present = e.addedLines.every((l) => after.includes(l));
        const gone = e.removedLines.every((l) => !after.includes(l));
        return present && gone && e.addedLines.length > 0;
      },
      guard: (before, after) => {
        // Reject wholesale deletion dressed up as an edit.
        const bl = before.split(/\r?\n/).length;
        const al = after.split(/\r?\n/).length;
        return al >= bl * 0.8;
      },
    });
  }
  return picked;
}

export function buildTasks({ tiers = null, hunks = 0, families = null } = {}) {
  const all = [
    ...buildApplyTasks(),
    ...buildMechanicalTasks(),
    ...(hunks ? buildHunkTasks({ limit: hunks, families }) : []),
  ];
  return tiers ? all.filter((t) => tiers.includes(t.tier)) : all;
}

/* ------------------------------------------------------------------ prompts */

function applyPrompt(task, { tutor = "" } = {}) {
  return `${DISCIPLINE}

CURRENT PASS: EXECUTION. The change below is ALREADY APPROVED. Your only job is to apply it.

AUTHORIZED FILE (the only file you may modify):
- ${task.rel}

APPROVED CHANGE:
${task.goal}

REQUIREMENTS:
- Use an edit/write tool. A description is not a deliverable.
- Modify only the authorized file.
- Make the smallest edit that satisfies the approved change.
- Do not reformat unrelated lines. Do not refactor. Do not re-plan.
${tutor ? `\n${tutor}\n` : ""}
When finished, state in one sentence what you changed.`;
}

function mechanicalPrompt(task, { assisted = true, tutor = "" } = {}) {
  const gate = checkTsSyntax(task.rel, task.fixtureSource);
  const structure = assisted
    ? jsxRepairPacket({ fileName: task.rel, source: task.fixtureSource, diagnostics: gate.diagnostics, jsx: true })
    : "";
  return `${DISCIPLINE}

CURRENT PASS: MECHANICAL REPAIR.

AUTHORIZED FILE (the only file you may modify):
- ${task.rel}

TASK:
${task.goal}

COMPILER DIAGNOSTICS:
${formatDiagnostics(gate.diagnostics).slice(0, 3000)}
${structure ? `\n${structure}\n` : ""}${tutor ? `\n${tutor}\n` : ""}
Use an edit tool. Do not rewrite the file. Do not refactor.`;
}

/* ------------------------------------------------------------------ teacher */

/**
 * Opus-authored TEACHER LEVEL 1 responses for tasks the tutored local loop
 * could not solve: diagnosis, evidence and repair strategy — no finished
 * source and no literal patch text. Written after reading only the failing
 * file's structural packet and source window, which is what the future remote
 * teacher will receive.
 *
 * Level 2 would add explicit localized patch guidance. Recorded separately so
 * we can tell which level was actually necessary.
 */
export const TEACHER_LEVEL1 = {
  "mech-03-MacroPanel": {
    diagnosis: "TWO closing tags are now missing, not one. Your previous repair attempt made this file worse.",
    evidence:
      "The structural scan reports 0 surplus closers and 2 UNCLOSED openers. The first divergence is the "
      + "`</div>` on line 79, which the parser reaches while two elements are still open. Line 79 is the "
      + "final closer of the component's return statement (`</div>;`), so the missing closers are BEFORE it.",
    strategy:
      "Do not edit your current buffer further — it has drifted from the original fault. Start from the "
      + "file as given. Exactly one `</div>` was missing originally. Walk the nesting from the opening tag "
      + "of the returned element down to line 79 and find the single level whose closer is absent, then "
      + "add that one line. Do not delete anything.",
  },
  "mech-05-fireUiKit": {
    diagnosis: "A `<button>` element is never closed, and you have made zero edits across two attempts.",
    evidence:
      "The structural scan reports the `}` on line 177 cannot close anything because it is blocked by an "
      + "open `button` frame opened on line 160. Line 175 is `) : (`, which terminates the true branch of a "
      + "ternary — so the button's closing tag has to appear before that branch ends.",
    strategy:
      "Insert a single closing tag for the button element on its own line, immediately before the `) : (` "
      + "line that ends the ternary's first branch. Change nothing else. You must actually call an edit "
      + "tool: two attempts produced no file modification at all.",
  },
};

function teacherPrompt(task, teacher, { level = 1 } = {}) {
  const gate = checkTsSyntax(task.rel, task.fixtureSource);
  return `${DISCIPLINE}

CURRENT PASS: REPAIR WITH SENIOR GUIDANCE.

A senior engineer reviewed your failed attempts. Their guidance is ADVISORY but
their diagnosis is based on the same deterministic analysis you were given.

AUTHORIZED FILE (the only file you may modify):
- ${task.rel}

SENIOR DIAGNOSIS:
${teacher.diagnosis}

EVIDENCE:
${teacher.evidence}

RECOMMENDED REPAIR STRATEGY:
${teacher.strategy}
${level >= 2 && teacher.patchGuidance ? `\nEXACT PATCH GUIDANCE:\n${teacher.patchGuidance}\n` : ""}
COMPILER DIAGNOSTICS:
${formatDiagnostics(gate.diagnostics).slice(0, 1500)}

${jsxRepairPacket({ fileName: task.rel, source: task.fixtureSource, diagnostics: gate.diagnostics, jsx: true }).report || ""}

Apply the repair with an edit tool. Make the smallest possible change.`;
}

/**
 * Teacher-assisted retry. The fixture is RESTORED to its original broken bytes
 * first: the archived evidence and this curriculum both show that stacking a
 * repair on top of a damaged buffer degrades it further.
 */
export async function runTeacherRound(task, { model, timeoutMs, level = 1, log = console.log }) {
  const teacher = TEACHER_LEVEL1[task.id];
  if (!teacher) return null;
  const dir = sandboxFor(task.id, `teach${level}`);
  const target = join(dir, task.rel);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, task.fixtureSource, "utf8"); // restore-then-reapply

  const sessionDir = join(root, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  const started = Date.now();
  try {
    await runOpenCode({
      prompt: teacherPrompt(task, teacher, { level }),
      title: `curriculum ${task.id} teacher-L${level}`,
      outPath: join(sessionDir, `${task.id}-teacher-L${level}.jsonl`),
      cwd: dir,
      model,
      timeoutMs,
    });
  } catch (e) {
    log(`  ${task.id}: teacher round error ${e.message}`);
  }
  const after = existsSync(target) ? readFileSync(target, "utf8") : task.fixtureSource;
  const grade = gradeAttempt(task, after);
  return { id: task.id, level, ms: Date.now() - started, ...grade };
}

/* ------------------------------------------------------------------ scoring */

/**
 * Formatting collateral damage: lines that changed but are unrelated to the
 * goal. Measured as changed lines beyond the minimum the gold patch needed.
 */
function collateral(before, after, gold) {
  const diffLines = (a, b) => {
    const A = a.split(/\r?\n/);
    const B = b.split(/\r?\n/);
    let n = 0;
    const max = Math.max(A.length, B.length);
    for (let i = 0; i < max; i += 1) if (A[i] !== B[i]) n += 1;
    return n;
  };
  const changed = diffLines(before, after);
  const goldChanged = gold ? diffLines(before, gold) : 0;
  return { changed, goldChanged, excess: Math.max(0, changed - goldChanged) };
}

/**
 * Independent structural faults plus compiler diagnostics, used to decide
 * whether an attempt regressed. Cascade noise is excluded so one real fault
 * does not read as several.
 */
export function countFaults(rel, source) {
  const scan = scanStructure(source, { jsx: true });
  const structural = scan.surplusClosers.filter((s) => !s.cascade).length
    + scan.tagMismatches.filter((m) => !m.cascade).length
    + scan.unclosed.length;
  return structural + checkTsSyntax(rel, source).diagnostics.length;
}

export function gradeAttempt(task, afterSource, { wrote = true } = {}) {
  const before = task.fixtureSource;
  const changedAtAll = afterSource !== before;
  const structure = scanStructure(afterSource, { jsx: true });
  const gate = checkTsSyntax(task.rel, afterSource);
  const accepted = changedAtAll ? Boolean(task.accept?.(afterSource)) : false;
  const guardOk = task.guard ? Boolean(task.guard(before, afterSource)) : true;
  const col = collateral(before, afterSource, task.goldSource);
  return {
    wrote,
    emptyEdit: !changedAtAll,
    mechanicallyValid: structure.ok && gate.ok,
    structureOk: structure.ok,
    syntaxOk: gate.ok,
    diagnostics: gate.diagnostics.length,
    accepted: accepted && guardOk,
    guardOk,
    exactMatch: task.goldSource ? afterSource === task.goldSource : null,
    collateral: col,
  };
}

/* ------------------------------------------------------------------ runner */

/**
 * Sandboxes live OUTSIDE the repository, in the OS temp dir.
 *
 * This is not cosmetic. A sandbox placed under the repo (the obvious choice)
 * lets OpenCode walk up, find the real project root, and resolve relative
 * paths against PRODUCTION instead of the fixture — observed live: the model
 * read and attempted to edit the real `ModuleEnableToggle.tsx`. The edit only
 * failed because its `oldString` did not match. Keeping sandboxes outside the
 * repo removes the ambiguity rather than relying on that luck.
 */
function sandboxFor(taskId, attempt) {
  const dir = join(tmpdir(), "kc-edit-curriculum", `${taskId}-a${attempt}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // A minimal but real project shell so the model's tools behave normally.
  // opencode.json is required for provider/model resolution inside the sandbox.
  for (const f of ["tsconfig.json", "package.json", "opencode.json", "AGENTS.md"]) {
    const src = join(repoRoot, f);
    if (existsSync(src)) cpSync(src, join(dir, f));
  }
  return dir;
}

async function runTask(task, { model, timeoutMs, assisted, log, attempt = 1, tutorRound = true }) {
  const dir = sandboxFor(task.id, attempt);
  const target = join(dir, task.rel);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, task.fixtureSource, "utf8");

  const prompt = task.kind === "apply"
    ? applyPrompt(task)
    : mechanicalPrompt(task, { assisted });

  const started = Date.now();
  const rounds = [];
  const sessionDir = join(root, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  let sessionRaw = "";
  let res;
  try {
    res = await runOpenCode({
      prompt,
      title: `curriculum ${task.id} r1`,
      outPath: join(sessionDir, `${task.id}-a${attempt}-r1.jsonl`),
      cwd: dir,
      model,
      timeoutMs,
    });
    sessionRaw = res.raw || "";
  } catch (e) {
    log(`  ${task.id}: session error ${e.message}`);
  }
  const parsed = parseOpenCodeJsonl(sessionRaw);
  let after = existsSync(target) ? readFileSync(target, "utf8") : task.fixtureSource;
  let grade = gradeAttempt(task, after, { wrote: (parsed.tools || []).length > 0 });
  rounds.push({ round: 1, ...grade, tools: (parsed.tools || []).length, tutored: false });

  // One tutored round when the first attempt failed, mirroring the runner's
  // failure-aware retry rather than a generic re-run.
  let restored = false;
  if (tutorRound && !grade.accepted) {
    // RESTORE_AND_REAPPLY: if the attempt made the file worse, do not repair
    // the repair. Restore the original bytes and reapply from clean.
    // Progress is kept — only regression is rolled back.
    const faultsBefore = countFaults(task.rel, task.fixtureSource);
    const faultsAfter = countFaults(task.rel, after);
    if (faultsAfter > faultsBefore) {
      writeFileSync(target, task.fixtureSource, "utf8");
      after = task.fixtureSource;
      restored = true;
      log(`  ${task.id}: attempt regressed (${faultsBefore} -> ${faultsAfter} faults); restored pre-edit bytes`);
      grade = gradeAttempt(task, after, { wrote: false });
    }
    const tutor = grade.emptyEdit
      ? emptyEditPacket({ proposalSummary: task.goal, expectedFiles: [task.rel], retriesUsed: 1, retryBudget: 1 })
      : validationPacket({
        primary: formatDiagnostics(checkTsSyntax(task.rel, after).diagnostics).slice(0, 1200) || "change did not satisfy the approved requirement",
        files: [task.rel],
        structure: task.kind === "mechanical"
          ? jsxRepairPacket({ fileName: task.rel, source: after, diagnostics: checkTsSyntax(task.rel, after).diagnostics, jsx: true })
          : "",
        repairScope: [task.rel],
        retriesUsed: 1,
        retryBudget: 1,
      });
    const p2 = task.kind === "apply" ? applyPrompt(task, { tutor }) : mechanicalPrompt(task, { assisted, tutor });
    try {
      const r2 = await runOpenCode({
        prompt: p2,
        title: `curriculum ${task.id} r2-tutored`,
        outPath: join(sessionDir, `${task.id}-a${attempt}-r2-tutored.jsonl`),
        cwd: dir,
        model,
        timeoutMs,
      });
      const parsed2 = parseOpenCodeJsonl(r2.raw || "");
      after = existsSync(target) ? readFileSync(target, "utf8") : after;
      grade = gradeAttempt(task, after, { wrote: (parsed2.tools || []).length > 0 });
      rounds.push({ round: 2, ...grade, tools: (parsed2.tools || []).length, tutored: true, restoredBefore: restored });
    } catch (e) {
      log(`  ${task.id}: tutor round error ${e.message}`);
    }
  }

  return {
    id: task.id,
    tier: task.tier,
    kind: task.kind,
    rel: task.rel,
    ms: Date.now() - started,
    firstRound: rounds[0],
    finalRound: rounds[rounds.length - 1],
    rounds,
    restoredBeforeTutor: restored,
    tutorRecovered: rounds.length > 1 && !rounds[0].accepted && rounds[rounds.length - 1].accepted,
  };
}

export async function runEditCurriculum({
  model = DEFAULT_MISSION_MODEL,
  timeoutMs = 240000,
  tiers = null,
  hunks = 0,
  families = null,
  only = null,
  assisted = true,
  tutor = true,
  log = console.log,
} = {}) {
  const tasks = buildTasks({ tiers, hunks, families }).filter((t) => (only ? t.id.includes(only) : true));
  const guardPaths = [...new Set(tasks.map((t) => t.rel))];
  const before = Object.fromEntries(guardPaths.map((r) => [r, hashFile(join(repoRoot, r))]));

  mkdirSync(root, { recursive: true });
  log(`edit curriculum: ${tasks.length} tasks | model ${normalizeModelId(model)}`);
  for (const t of tasks) log(`  [tier ${t.tier}] ${t.id.padEnd(46)} ${String(t.family || t.kind).padEnd(30)} ${t.rel}`);
  log("");

  // Every production file the curriculum draws from, hashed up front. Checked
  // after each task so a stray write is caught immediately, not at the end.
  const allGuard = [...new Set([...guardPaths, ...MECHANICAL_SOURCES.map((s) => s.rel), ...APPLY_TASKS.map((t) => t.rel)])];
  const guardBefore = Object.fromEntries(allGuard.map((r) => [r, hashFile(join(repoRoot, r))]));
  const driftedNow = () => allGuard.filter((r) => hashFile(join(repoRoot, r)) !== guardBefore[r]);

  const results = [];
  for (const t of tasks) {
    const r = await runTask(t, { model, timeoutMs, assisted, log, tutorRound: tutor });
    results.push(r);
    const stray = driftedNow();
    if (stray.length) {
      log(`\nABORT: production drift detected after ${t.id}: ${stray.join(", ")}`);
      throw new Error(`production drift: ${stray.join(", ")}`);
    }
    const f = r.firstRound;
    const z = r.finalRound;
    log(
      `${r.id.padEnd(34)} first[edit=${f.emptyEdit ? "NONE" : "yes"} valid=${f.mechanicallyValid ? "y" : "n"} ok=${f.accepted ? "PASS" : "fail"}]`
      + ` final[ok=${z.accepted ? "PASS" : "fail"} diag=${z.diagnostics}]`
      + `${r.tutorRecovered ? " TUTOR-RECOVERED" : ""} ${(r.ms / 1000).toFixed(0)}s`,
    );
  }

  const drift = guardPaths.filter((r) => hashFile(join(repoRoot, r)) !== before[r]);
  const n = results.length || 1;
  const summary = {
    tasks: results.length,
    model: normalizeModelId(model),
    firstEditApplied: results.filter((r) => !r.firstRound.emptyEdit).length,
    firstEditMechanicallyValid: results.filter((r) => r.firstRound.mechanicallyValid).length,
    firstEditAccepted: results.filter((r) => r.firstRound.accepted).length,
    finalAccepted: results.filter((r) => r.finalRound.accepted).length,
    emptyEdits: results.filter((r) => r.firstRound.emptyEdit).length,
    tutorRecovered: results.filter((r) => r.tutorRecovered).length,
    collateralDamage: results.filter((r) => (r.finalRound.collateral?.excess || 0) > 2).length,
    rates: {
      firstEditApplication: +(results.filter((r) => !r.firstRound.emptyEdit).length / n).toFixed(3),
      firstEditValidity: +(results.filter((r) => r.firstRound.mechanicallyValid).length / n).toFixed(3),
      firstEditAcceptance: +(results.filter((r) => r.firstRound.accepted).length / n).toFixed(3),
      finalAcceptance: +(results.filter((r) => r.finalRound.accepted).length / n).toFixed(3),
    },
    byTier: {},
    productionDrift: drift,
  };
  for (const r of results) {
    const k = `tier${r.tier}`;
    summary.byTier[k] = summary.byTier[k] || { n: 0, firstAccepted: 0, finalAccepted: 0, empty: 0 };
    summary.byTier[k].n += 1;
    if (r.firstRound.accepted) summary.byTier[k].firstAccepted += 1;
    if (r.finalRound.accepted) summary.byTier[k].finalAccepted += 1;
    if (r.firstRound.emptyEdit) summary.byTier[k].empty += 1;
  }

  writeFileSync(join(root, "results.json"), JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 2));
  log("");
  log(`first-edit application ${summary.rates.firstEditApplication} | mechanical validity ${summary.rates.firstEditValidity}`);
  log(`first-edit acceptance ${summary.rates.firstEditAcceptance} | after tutoring ${summary.rates.finalAcceptance}`);
  log(`empty edits ${summary.emptyEdits} | tutor-recovered ${summary.tutorRecovered} | production drift ${drift.length}`);
  return { summary, results };
}
