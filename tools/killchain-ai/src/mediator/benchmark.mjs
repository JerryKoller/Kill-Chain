/**
 * Supervisor benchmark.
 *
 * Chooses the FAST model by measurement rather than reputation. Every case is
 * harmless: fixtures only, no mission, no production access.
 *
 * Component metrics stay separate. There is deliberately no single opaque
 * score — "fast but invents files" and "slow but disciplined" are different
 * failures and collapsing them into one number hides the thing you need to know.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { BENCHMARK_CASES, packForFixture } from "./fixtures.mjs";
import { ensureMediatorDirs, mediatorBenchDir } from "./paths.mjs";
import { loadRegistry, median, recordCall, saveRegistry } from "./modelRegistry.mjs";
import { askSupervisor, buildSupervisorPrompt } from "./supervisorInvoker.mjs";

const PATH_RE = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g;

/** Paths the model mentions that appear nowhere in the trusted evidence. */
export function inventedPaths(result, pack) {
  const haystack = pack.items.map((i) => `${i.content}\n${i.label}`).join("\n");
  const mentioned = new Set([
    ...(result.allowedPaths || []),
    ...((String(result.workerObjective || "").match(PATH_RE)) || []),
    ...((String(result.reason || "").match(PATH_RE)) || []),
  ]);
  return [...mentioned].filter((p) => p && !haystack.includes(p));
}

/** Score one validated result against one fixture. All components inspectable. */
export function scoreCase(fixture, outcome) {
  const pack = outcome.pack;
  const base = {
    caseId: fixture.id,
    family: fixture.family,
    latencyMs: outcome.latencyMs,
    calls: outcome.calls,
    repaired: outcome.repaired,
    structuredValid: false,
    decision: null,
    decisionCorrect: false,
    citedEvidence: false,
    inventedFileCount: 0,
    inventedFiles: [],
    scopeExpansion: 0,
    inappropriateDirectCoding: false,
    unnecessaryEscalation: false,
    missedEscalation: false,
    objectiveOk: false,
    confidence: null,
    failure: outcome.ok ? null : outcome.reason,
  };
  if (!outcome.ok || !outcome.result) return base;

  const r = outcome.result;
  const exp = fixture.expect;
  base.structuredValid = true;
  base.decision = r.decision;
  base.confidence = r.confidence;
  base.decisionCorrect = exp.decisions.includes(r.decision);
  base.citedEvidence = Array.isArray(r.trustedEvidenceRefs) && r.trustedEvidenceRefs.length > 0;

  const invented = inventedPaths(r, pack);
  base.inventedFiles = invented;
  base.inventedFileCount = invented.length;

  if (exp.maxAllowedPaths != null) {
    base.scopeExpansion = Math.max(0, (r.allowedPaths || []).length - exp.maxAllowedPaths);
  }

  // A supervisor that answers a supervision question by declaring senior
  // implementation is taking the keyboard away from the worker.
  base.inappropriateDirectCoding = r.decision === "NEEDS_SENIOR_IMPLEMENTATION"
    && !exp.decisions.includes("NEEDS_SENIOR_IMPLEMENTATION");

  base.unnecessaryEscalation = r.decision === "ESCALATE" && exp.escalationExpected === false;
  base.missedEscalation = exp.escalationExpected === true
    && !["ESCALATE", "STOP", "NEEDS_SENIOR_IMPLEMENTATION"].includes(r.decision);

  base.objectiveOk = exp.requireObjective
    ? Boolean(r.workerObjective) && (r.acceptance || []).length > 0
    : true;

  return base;
}

/** Run every fixture against one model. */
export async function benchmarkModel(modelId, { role = "FAST_SUPERVISOR", cases = BENCHMARK_CASES, timeoutMs = 10 * 60 * 1000, signal = null, log = () => {} } = {}) {
  const rows = [];
  for (const fixture of cases) {
    const pack = packForFixture(fixture);
    const situation = fixture.unsupportedClaim
      ? `${fixture.title}\n\nUNTRUSTED MODEL PROSE (not evidence):\n${fixture.unsupportedClaim}`
      : fixture.title;
    const prompt = buildSupervisorPrompt({
      role,
      humanBrief: fixture.humanBrief,
      operationalObjective: fixture.objective,
      situation,
      pack,
      spec: null,
    });

    const startedAt = Date.now();
    const outcome = await askSupervisor({
      role,
      model: modelId,
      prompt,
      pack,
      spec: null,
      timeoutMs,
      signal,
      title: `kc-bench-${fixture.id}`,
    });
    const latencyMs = Date.now() - startedAt;
    const scored = scoreCase(fixture, {
      ...outcome,
      pack,
      latencyMs,
      calls: outcome.calls.length,
    });
    rows.push(scored);
    log(`    ${fixture.id.padEnd(24)} ${scored.structuredValid ? (scored.decisionCorrect ? "correct" : `wrong(${scored.decision})`) : `invalid: ${scored.failure}`}  ${(latencyMs / 1000).toFixed(1)}s`);
    if (signal?.aborted) break;
  }
  return { modelId, role, rows, summary: summarizeRows(rows) };
}

export function summarizeRows(rows) {
  const n = rows.length || 1;
  const valid = rows.filter((r) => r.structuredValid);
  return {
    cases: rows.length,
    totalLatencyMs: rows.reduce((a, r) => a + (r.latencyMs || 0), 0),
    medianLatencyMs: median(rows.map((r) => r.latencyMs)),
    structuredValidRate: valid.length / n,
    decisionCorrectRate: rows.filter((r) => r.decisionCorrect).length / n,
    citedEvidenceRate: rows.filter((r) => r.citedEvidence).length / n,
    objectiveOkRate: rows.filter((r) => r.objectiveOk).length / n,
    inventedFiles: rows.reduce((a, r) => a + r.inventedFileCount, 0),
    scopeExpansion: rows.reduce((a, r) => a + r.scopeExpansion, 0),
    inappropriateDirectCoding: rows.filter((r) => r.inappropriateDirectCoding).length,
    unnecessaryEscalations: rows.filter((r) => r.unnecessaryEscalation).length,
    missedEscalations: rows.filter((r) => r.missedEscalation).length,
    formatRepairs: rows.filter((r) => r.repaired).length,
  };
}

/**
 * Rank candidates for the FAST role.
 *
 * Discipline first, then correctness, then speed. A fast model that invents
 * files or quietly widens scope is not a cheaper supervisor, it is a liability.
 */
export function rankCandidates(results) {
  return results.slice().sort((a, b) => {
    const s = a.summary;
    const t = b.summary;
    const disciplineA = s.inventedFiles + s.scopeExpansion + s.inappropriateDirectCoding + s.missedEscalations;
    const disciplineB = t.inventedFiles + t.scopeExpansion + t.inappropriateDirectCoding + t.missedEscalations;
    if (disciplineA !== disciplineB) return disciplineA - disciplineB;
    if (t.structuredValidRate !== s.structuredValidRate) return t.structuredValidRate - s.structuredValidRate;
    if (t.decisionCorrectRate !== s.decisionCorrectRate) return t.decisionCorrectRate - s.decisionCorrectRate;
    return (s.medianLatencyMs ?? Infinity) - (t.medianLatencyMs ?? Infinity);
  });
}

export function renderBenchmarkTable(results) {
  const head = ["MODEL", "VALID", "CORRECT", "CITED", "INVENT", "SCOPE+", "ESC!", "ESC?", "MED s", "TOTAL s"];
  const lines = [head.join("\t")];
  for (const r of results) {
    const s = r.summary;
    lines.push([
      r.modelId,
      pct(s.structuredValidRate),
      pct(s.decisionCorrectRate),
      pct(s.citedEvidenceRate),
      String(s.inventedFiles),
      String(s.scopeExpansion),
      String(s.unnecessaryEscalations),
      String(s.missedEscalations),
      s.medianLatencyMs == null ? "-" : (s.medianLatencyMs / 1000).toFixed(1),
      (s.totalLatencyMs / 1000).toFixed(1),
    ].join("\t"));
  }
  return lines.join("\n");
}

function pct(v) {
  return v == null ? "-" : `${Math.round(v * 100)}%`;
}

/** Run the benchmark across candidates and persist the observations. */
export async function runBenchmark({ candidates, role = "FAST_SUPERVISOR", cases = BENCHMARK_CASES, timeoutMs, signal = null, log = () => {} } = {}) {
  ensureMediatorDirs();
  const reg = loadRegistry();
  const results = [];
  for (const modelId of candidates) {
    log(`  benchmarking ${modelId} …`);
    const res = await benchmarkModel(modelId, { role, cases, timeoutMs, signal, log });
    results.push(res);
    for (const row of res.rows) {
      recordCall(reg, modelId, {
        ok: row.structuredValid,
        durationMs: row.latencyMs,
        structuredAttempt: true,
        structuredValid: row.structuredValid,
        error: row.failure,
      });
    }
    if (signal?.aborted) break;
  }
  saveRegistry(reg);

  const ranked = rankCandidates(results);
  const report = { at: Date.now(), role, cases: cases.map((c) => c.id), results: ranked, recommended: ranked[0]?.modelId || null };
  const outPath = join(mediatorBenchDir, `benchmark-${Date.now()}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(mediatorBenchDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { ...report, outPath };
}
