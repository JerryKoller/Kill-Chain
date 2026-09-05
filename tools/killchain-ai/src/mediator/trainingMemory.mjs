/**
 * Durable teaching memory.
 *
 * One append-only JSONL record per meaningful worker task. The point is to be
 * able to answer, eventually and from data: what is Robo Puppy actually good at,
 * when does he need help, and which supervisor was worth its latency.
 *
 * The whole history is never injected into a prompt. Callers take a summary.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { ensureMediatorDirs, trainingMemoryPath } from "./paths.mjs";

/** Task families we can currently attribute from real signals. */
export const TASK_FAMILIES = [
  "compiler_microfix",
  "typescript_microfix",
  "jsx_structure",
  "ui_microedit",
  "scope_discipline",
  "empty_edit",
  "visual_iteration",
  "persistence",
  "tool_usage",
  "checkpoint_behavior",
  "repair_after_feedback",
  "orchestration",
  "trust_boundary",
  "protocol",
  "unknown",
];

export function normalizeFamily(family) {
  const f = String(family || "").trim();
  return TASK_FAMILIES.includes(f) ? f : "unknown";
}

/**
 * Append one training record.
 * Unknown values stay null rather than being filled with a plausible default —
 * the skill profile refuses to compute a metric it has no data for.
 */
export function recordTask(record) {
  ensureMediatorDirs();
  const row = {
    at: Date.now(),
    taskId: record.taskId || null,
    runId: record.runId || null,
    family: normalizeFamily(record.family),
    humanObjective: record.humanObjective ?? null,
    supervisorModel: record.supervisorModel ?? null,
    supervisorRole: record.supervisorRole ?? null,
    routingRuleId: record.routingRuleId ?? null,
    evidenceRefs: record.evidenceRefs ?? [],
    evidenceBytes: record.evidenceBytes ?? null,
    workerObjective: record.workerObjective ?? null,
    workerModel: record.workerModel ?? null,
    allowedPaths: record.allowedPaths ?? [],
    teachingLevel: record.teachingLevel ?? null,
    workerCalls: record.workerCalls ?? null,
    byteDelta: record.byteDelta ?? null,
    changedFiles: record.changedFiles ?? [],
    validation: record.validation ?? null,
    diagnosticBefore: record.diagnosticBefore ?? null,
    diagnosticAfter: record.diagnosticAfter ?? null,
    failureClass: record.failureClass ?? null,
    tutorFeedback: record.tutorFeedback ?? null,
    retry: record.retry ?? false,
    checkpointDecision: record.checkpointDecision ?? null,
    outcome: record.outcome ?? null,
    implementedBy: record.implementedBy ?? null,
    supervisorLatencyMs: record.supervisorLatencyMs ?? null,
    workerLatencyMs: record.workerLatencyMs ?? null,
    validationLatencyMs: record.validationLatencyMs ?? null,
    escalationCount: record.escalationCount ?? 0,
    simulated: Boolean(record.simulated),
  };
  appendFileSync(trainingMemoryPath, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function readMemory({ includeSimulated = true, limit = null } = {}) {
  if (!existsSync(trainingMemoryPath)) return [];
  let rows = readFileSync(trainingMemoryPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!includeSimulated) rows = rows.filter((r) => !r.simulated);
  if (limit) rows = rows.slice(-limit);
  return rows;
}

/**
 * Compact history for prompt injection. Per-family one-liners only, and only
 * for families with enough records to say anything.
 */
export function memorySummary({ minSamples = 2, includeSimulated = false } = {}) {
  const rows = readMemory({ includeSimulated });
  const byFamily = new Map();
  for (const r of rows) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, []);
    byFamily.get(r.family).push(r);
  }
  const lines = [];
  for (const [family, list] of byFamily) {
    if (list.length < minSamples) continue;
    const firstPass = list.filter((r) => r.outcome === "KEEP" && !r.retry).length;
    const deep = list.filter((r) => r.supervisorRole === "DEEP_SUPERVISOR").length;
    const levels = list.map((r) => r.teachingLevel).filter((n) => Number.isFinite(n));
    const typicalLevel = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
    lines.push(
      `${family}: ${list.length} tasks, ${firstPass} first-pass keeps, ${deep} needed deep supervision`
      + (typicalLevel == null ? "" : `, typical teaching level ${typicalLevel}`),
    );
  }
  return lines.length ? lines.join("\n") : "(no training history yet)";
}
