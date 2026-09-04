/**
 * Repair-evidence A/B: does deterministic structural evidence let the LOCAL
 * worker repair the archived TSX failure it previously could not?
 *
 * Arms (identical model, identical retry budget, identical fixture bytes):
 *   baseline  — compiler diagnostics + source windows (what the runner sent
 *               before jsxStructure.mjs existed; this is the exact evidence
 *               that failed in fire-drum-fill-preview-live and again for both
 *               models in the lightning benchmark)
 *   assisted  — the same, plus the deterministic structural repair packet
 *
 * Production source is never an edit target: each attempt gets its own fixture
 * copy under data/overnight/repair-bench/work/. Production hashes are checked
 * before and after.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { dataDir, repoRoot } from "../paths.mjs";
import { runOpenCode, parseOpenCodeJsonl } from "../mission/opencode.mjs";
import { DEFAULT_MISSION_MODEL, normalizeModelId } from "../mission/model.mjs";
import { checkTsSyntax, formatDiagnostics, excerptAround } from "../mission/syntax.mjs";
import { jsxRepairPacket, scanStructure, structuralFingerprint } from "../mission/jsxStructure.mjs";
import { DISCIPLINE } from "../mission/prompts.mjs";

const benchRoot = join(dataDir, "overnight", "repair-bench");
const REL = "src/components/FireCommand/DrumMachine.tsx";

/** The archived broken buffer from the mission that blocked on this failure. */
const ARCHIVED_BROKEN = join(
  dataDir, "missions", "fire-drum-fill-preview-live", "attribution",
  "009-repair", "files", "src", "components", "FireCommand", "DrumMachine.tsx",
);
const PRODUCTION = join(repoRoot, REL);

const GUARDED = [REL, "src/components/FireCommand/SequencerPanel.tsx", "src/components/FireCommand/PatternSelect.tsx"];

function hashFile(abs) {
  if (!existsSync(abs)) return null;
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function guardSnapshot() {
  const out = {};
  for (const rel of GUARDED) out[rel] = hashFile(join(repoRoot, rel));
  return out;
}

function guardDrifted(snap) {
  return GUARDED.filter((rel) => hashFile(join(repoRoot, rel)) !== snap[rel]);
}

/** Evidence the old repair prompt had: compiler text plus ±6-line windows. */
function baselineEvidence(source) {
  const gate = checkTsSyntax(REL, source);
  const windows = gate.diagnostics
    .slice(0, 6)
    .map((d) => `--- ${d.file}:${d.line}:${d.column} ${d.code} ---\n${d.excerpt || ""}`)
    .join("\n\n");
  return {
    diagnostics: formatDiagnostics(gate.diagnostics),
    windows,
    count: gate.diagnostics.length,
  };
}

function repairPrompt({ fixtureRel, source, assisted }) {
  const ev = baselineEvidence(source);
  const structure = assisted
    ? `\n${jsxRepairPacket({ fileName: fixtureRel, source, diagnostics: checkTsSyntax(REL, source).diagnostics, jsx: true }).markdown}\n`
      + "TRUST THE ANALYSIS ABOVE. A scanner counted every delimiter. Do not re-count by eye.\n"
    : "";
  return `${DISCIPLINE}

CURRENT PASS: APPLY REPAIR. EXECUTION PHASE. Fresh context.

A previous edit left this TSX file structurally broken and it no longer parses.
Repair it with the SMALLEST possible mechanical edit.

THE ONLY FILE YOU MAY EDIT:
${fixtureRel}

This is an isolated fixture copy. Do NOT open, read, or edit anything under src/.
USE THE EDIT/WRITE TOOL ON THAT PATH NOW. Do not only describe the patch.

RULES:
- Fix ONLY the structural break. Preserve every existing element, prop, handler and string.
- Do not rename identifiers, do not add hooks, do not reformat, do not add comments.
- Do not delete working JSX blocks to make the parser happy.

EXACT COMPILER/PARSER DIAGNOSTICS (${ev.count} reported):
${ev.diagnostics}

SOURCE WINDOWS:
${ev.windows}
${structure}
WHEN COMPLETE, REPORT THE EXACT LINES YOU CHANGED.`;
}

/**
 * Feature-bearing symbols the mission's own edit introduced. A repair that
 * deletes JSX until the parser is happy will drop these, so they separate a
 * real repair from vandalism that merely parses.
 */
const FEATURE_MARKERS = [
  "FILL_PERSONAS",
  "acceptDrumFillPreview",
  "revertDrumFillPreview",
  "setDrumFillIntensity",
  "setDrumFillPersonality",
  "Fill last bar",
  "data-drum-popover",
];

/** Count of independent structural faults, ignoring cascade noise. */
function divergenceCount(source) {
  const scan = scanStructure(source, { jsx: true });
  return {
    scan,
    total: scan.surplusClosers.filter((s) => !s.cascade).length
      + scan.tagMismatches.filter((m) => !m.cascade).length
      + scan.unclosed.length,
    unclosed: scan.unclosed.length,
  };
}

/**
 * Grade a repair attempt.
 *
 * `repaired` is the hard success bar (parses and is structurally sound).
 * `progressed` / `regressed` matter just as much: the production runner is
 * iterative, so an attempt that removes one of two faults without breaking
 * anything is a step the loop can finish, while an attempt that introduces
 * unclosed openers forces a rollback.
 */
function grade(before, after, original) {
  if (after == null) return { repaired: false, reason: "fixture missing after run", changed: false };
  const gate = checkTsSyntax(REL, after);
  const dAfter = divergenceCount(after);
  const dBefore = divergenceCount(before);
  const beforeBytes = Buffer.byteLength(before, "utf8");
  const afterBytes = Buffer.byteLength(after, "utf8");
  const lostMarkers = FEATURE_MARKERS.filter((m) => original.includes(m) && !after.includes(m));
  return {
    repaired: dAfter.scan.ok && gate.ok,
    structureOk: dAfter.scan.ok,
    syntaxOk: gate.ok,
    remainingDiagnostics: gate.diagnostics.slice(0, 3).map((d) => `${d.line}:${d.column} ${d.code}`),
    surplus: dAfter.scan.surplusClosers.length,
    unclosed: dAfter.unclosed,
    mismatches: dAfter.scan.tagMismatches.length,
    divergencesBefore: dBefore.total,
    divergencesAfter: dAfter.total,
    progressed: dAfter.total < dBefore.total && dAfter.unclosed <= dBefore.unclosed,
    regressed: dAfter.total > dBefore.total || dAfter.unclosed > dBefore.unclosed,
    byteDelta: afterBytes - beforeBytes,
    lineDelta: after.split(/\r?\n/).length - before.split(/\r?\n/).length,
    changed: after !== before,
    // Deleting the feature to satisfy the parser is not a repair.
    lostFeatureMarkers: lostMarkers,
    preservedFeature: lostMarkers.length === 0,
  };
}

/**
 * One attempt = up to `rounds` sequential repair sessions on the same fixture,
 * with the evidence re-derived from the CURRENT bytes each round. That is what
 * the runner does between DIFF_REVIEW and REPAIRING, so measuring a single
 * shot would understate both arms.
 */
async function attempt({ arm, n, model, rounds, log }) {
  const workDir = join(benchRoot, "work", arm, `attempt-${n}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const fixtureAbs = join(workDir, "DrumMachine.tsx");
  cpSync(ARCHIVED_BROKEN, fixtureAbs);
  const original = readFileSync(fixtureAbs, "utf8");
  const fixtureRel = relative(repoRoot, fixtureAbs).replace(/\\/g, "/");
  mkdirSync(join(benchRoot, "sessions"), { recursive: true });

  const roundRows = [];
  let totalMs = 0;
  let totalUnix = 0;
  let promptChars = 0;
  let sawRegression = false;

  for (let round = 1; round <= rounds; round++) {
    const before = readFileSync(fixtureAbs, "utf8");
    if (scanStructure(before, { jsx: true }).ok && checkTsSyntax(REL, before).ok) break;
    const prompt = repairPrompt({ fixtureRel, source: before, assisted: arm === "assisted" });
    writeFileSync(join(workDir, `PROMPT.round${round}.txt`), prompt);
    promptChars += prompt.length;
    const outPath = join(benchRoot, "sessions", `${arm}-${n}-r${round}.jsonl`);
    let result = null;
    let error = null;
    const started = Date.now();
    try {
      result = await runOpenCode({
        prompt,
        title: `repair-bench ${arm} ${n} r${round}`,
        outPath,
        timeoutMs: 10 * 60 * 1000,
        cwd: repoRoot,
        model,
      });
    } catch (err) {
      error = String(err?.message || err);
    }
    const after = existsSync(fixtureAbs) ? readFileSync(fixtureAbs, "utf8") : null;
    const parsed = result?.parsed || parseOpenCodeJsonl("");
    const g = grade(before, after, original);
    totalMs += result?.durationMs ?? Date.now() - started;
    totalUnix += (parsed.unixViolations || []).length;
    if (g.regressed) sawRegression = true;
    roundRows.push({
      round,
      error,
      durationMs: result?.durationMs ?? Date.now() - started,
      unixViolations: (parsed.unixViolations || []).length,
      mcpFirst: Boolean(parsed.mcpFirst),
      ...g,
    });
    log(
      `    r${round}: repaired=${g.repaired} changed=${g.changed} divergences ${g.divergencesBefore}->${g.divergencesAfter}`
      + `${g.regressed ? " REGRESSED" : g.progressed ? " progress" : ""} lines=${g.lineDelta >= 0 ? "+" : ""}${g.lineDelta} ${((result?.durationMs ?? 0) / 1000).toFixed(0)}s`,
    );
    if (g.repaired) break;
  }

  const last = roundRows[roundRows.length - 1] || { repaired: false };
  const final = readFileSync(fixtureAbs, "utf8");
  const row = {
    arm,
    attempt: n,
    model: normalizeModelId(model),
    rounds: roundRows.length,
    repaired: Boolean(last.repaired),
    everRegressed: sawRegression,
    changed: final !== original,
    preservedFeature: last.preservedFeature !== false,
    lostFeatureMarkers: last.lostFeatureMarkers || [],
    divergencesFinal: last.divergencesAfter ?? null,
    lineDeltaTotal: final.split(/\r?\n/).length - original.split(/\r?\n/).length,
    durationMs: totalMs,
    unixViolations: totalUnix,
    promptChars: Math.round(promptChars / (roundRows.length || 1)),
    roundRows,
  };
  log(
    `  ${arm} attempt ${n}: REPAIRED=${row.repaired} in ${row.rounds} round(s)`
    + `${row.everRegressed ? " (regressed at least once)" : ""} featureIntact=${row.preservedFeature} ${(row.durationMs / 1000).toFixed(0)}s`,
  );
  return row;
}

export async function runRepairBench({ attempts = 3, rounds = 2, model = DEFAULT_MISSION_MODEL, arms = ["baseline", "assisted"], log = console.log } = {}) {
  if (!existsSync(ARCHIVED_BROKEN)) throw new Error(`missing archived fixture ${ARCHIVED_BROKEN}`);
  mkdirSync(benchRoot, { recursive: true });
  const guard = guardSnapshot();

  const broken = readFileSync(ARCHIVED_BROKEN, "utf8");
  const brokenScan = scanStructure(broken, { jsx: true });
  const brokenGate = checkTsSyntax(REL, broken);
  log(
    `fixture: ${brokenGate.diagnostics.length} compiler diagnostics; scanner finds `
    + `${brokenScan.surplusClosers.length} surplus / ${brokenScan.unclosed.length} unclosed / `
    + `${brokenScan.tagMismatches.length} mismatched at line ${brokenScan.firstDivergence?.line}`,
  );

  const rows = [];
  for (const arm of arms) {
    log(`\n== arm: ${arm} (${arm === "assisted" ? "with structural packet" : "compiler diagnostics only"})`);
    for (let n = 1; n <= attempts; n++) {
      rows.push(await attempt({ arm, n, model, rounds, log }));
      const drift = guardDrifted(guard);
      if (drift.length) {
        log(`!! production drift detected: ${drift.join(", ")} — aborting`);
        break;
      }
    }
  }

  const summary = {};
  for (const arm of arms) {
    const a = rows.filter((r) => r.arm === arm);
    const allRounds = a.flatMap((r) => r.roundRows);
    summary[arm] = {
      attempts: a.length,
      repaired: a.filter((r) => r.repaired).length,
      repairRate: Number((a.filter((r) => r.repaired).length / (a.length || 1)).toFixed(2)),
      touchedFile: a.filter((r) => r.changed).length,
      everRegressed: a.filter((r) => r.everRegressed).length,
      featureIntact: a.filter((r) => r.preservedFeature).length,
      roundsUsed: allRounds.length,
      roundsThatProgressed: allRounds.filter((r) => r.progressed).length,
      roundsThatRegressed: allRounds.filter((r) => r.regressed).length,
      roundsWithNoEdit: allRounds.filter((r) => !r.changed).length,
      medianSecondsPerRound: median(allRounds.map((r) => r.durationMs / 1000)),
      avgPromptChars: Math.round(a.reduce((s, r) => s + r.promptChars, 0) / (a.length || 1)),
      unixViolations: a.reduce((s, r) => s + r.unixViolations, 0),
    };
  }

  const report = {
    at: new Date().toISOString(),
    model: normalizeModelId(model),
    fixture: {
      source: ARCHIVED_BROKEN,
      diagnostics: brokenGate.diagnostics.length,
      firstDivergenceLine: brokenScan.firstDivergence?.line ?? null,
    },
    attemptsPerArm: attempts,
    roundsPerAttempt: rounds,
    summary,
    rows,
    productionDrift: guardDrifted(guard),
  };
  writeFileSync(join(benchRoot, "REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(benchRoot, "REPORT.md"), mdReport(report));
  return report;
}

function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return Number((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2).toFixed(1));
}

function mdReport(r) {
  const armRows = Object.entries(r.summary).map(([arm, s]) => (
    `| ${arm} | ${s.repaired}/${s.attempts} | ${s.everRegressed}/${s.attempts} | ${s.featureIntact}/${s.attempts} | ${s.roundsThatProgressed}/${s.roundsUsed} | ${s.roundsThatRegressed}/${s.roundsUsed} | ${s.roundsWithNoEdit}/${s.roundsUsed} | ${s.medianSecondsPerRound}s | ${s.avgPromptChars} | ${s.unixViolations} |`
  ));
  return `# Repair-evidence A/B — archived TSX structural failure

model: \`${r.model}\` (identical in both arms)
fixture: archived broken \`${REL}\` from \`fire-drum-fill-preview-live/009-repair\`
compiler diagnostics on the fixture: ${r.fixture.diagnostics}
scanner first divergence: line ${r.fixture.firstDivergenceLine}
attempts per arm: ${r.attemptsPerArm}; repair rounds per attempt: ${r.roundsPerAttempt}
production drift: ${r.productionDrift.length ? r.productionDrift.join(", ") : "none"}

Arms differ ONLY in whether the prompt carries the deterministic structural
packet from \`jsxStructure.mjs\`. Fixture bytes, model, rounds, and timeout are
identical.

| arm | repaired | ever regressed | feature intact | rounds w/ progress | rounds w/ regression | rounds w/ no edit | median s/round | prompt chars | unix violations |
|---|---|---|---|---|---|---|---|---|---|
${armRows.join("\n")}

## Per attempt

| arm | # | repaired | rounds | ever regressed | feature intact | divergences left | line delta | total s |
|---|---|---|---|---|---|---|---|---|
${r.rows.map((x) => `| ${x.arm} | ${x.attempt} | ${x.repaired} | ${x.rounds} | ${x.everRegressed} | ${x.preservedFeature} | ${x.divergencesFinal} | ${x.lineDeltaTotal} | ${(x.durationMs / 1000).toFixed(0)} |`).join("\n")}

## Per round

| arm | # | r | changed | divergences | progress | regress | unclosed | lines |
|---|---|---|---|---|---|---|---|---|
${r.rows.flatMap((x) => x.roundRows.map((q) => `| ${x.arm} | ${x.attempt} | ${q.round} | ${q.changed} | ${q.divergencesBefore}→${q.divergencesAfter} | ${q.progressed} | ${q.regressed} | ${q.unclosed} | ${q.lineDelta} |`)).join("\n")}

Raw sessions: \`tools/killchain-ai/data/overnight/repair-bench/sessions/\`
Fixture copies and exact prompts: \`tools/killchain-ai/data/overnight/repair-bench/work/\`
`;
}
