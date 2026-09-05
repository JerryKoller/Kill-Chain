/**
 * Robo Puppy's report card.
 *
 * Every metric is derived from recorded tasks. A family with no data reports
 * null and says so. We do not invent statistics, and we do not print a
 * percentage computed from one sample as though it meant something.
 */
import { readMemory } from "./trainingMemory.mjs";

/** Below this, we report the count but refuse to publish rates. */
export const MIN_SAMPLES_FOR_RATE = 3;

function rate(numerator, denominator) {
  if (!denominator || denominator < MIN_SAMPLES_FOR_RATE) return null;
  return numerator / denominator;
}

function median(values) {
  const nums = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

export function familyProfile(rows) {
  const total = rows.length;
  const keeps = rows.filter((r) => r.outcome === "KEEP");
  const firstPass = keeps.filter((r) => !r.retry);
  const afterTutoring = keeps.filter((r) => r.retry);
  const emptyEdits = rows.filter((r) => r.failureClass === "APPLY_EMPTY" || r.byteDelta === 0);
  const scopeViolations = rows.filter((r) => r.failureClass === "SCOPE_VIOLATION");
  const deep = rows.filter((r) => r.supervisorRole === "DEEP_SUPERVISOR");
  const fast = rows.filter((r) => r.supervisorRole === "FAST_SUPERVISOR");
  const fastKeeps = fast.filter((r) => r.outcome === "KEEP");
  const puppyImplemented = rows.filter((r) => r.implementedBy === "ROBO_PUPPY");
  const seniorTookOver = rows.filter((r) => r.implementedBy === "SENIOR");

  return {
    tasks: total,
    firstPassSuccess: rate(firstPass.length, total),
    successAfterTutoring: rate(afterTutoring.length, total),
    emptyEditRate: rate(emptyEdits.length, total),
    scopeViolationRate: rate(scopeViolations.length, total),
    medianWorkerCalls: median(rows.map((r) => r.workerCalls)),
    medianWorkerLatencyMs: median(rows.map((r) => r.workerLatencyMs)),
    fastSupervisorSuccess: rate(fastKeeps.length, fast.length),
    deepEscalationRate: rate(deep.length, total),
    puppyImplementedCount: puppyImplemented.length,
    seniorTookOverCount: seniorTookOver.length,
    enoughData: total >= MIN_SAMPLES_FOR_RATE,
  };
}

/**
 * Full profile.
 *
 * `puppyImplementedShare` is the guard against the failure mode where the
 * supervisors quietly do all the work and the worker becomes a mascot.
 */
export function puppySkillProfile({ includeSimulated = false } = {}) {
  const rows = readMemory({ includeSimulated });
  const byFamily = new Map();
  for (const r of rows) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, []);
    byFamily.get(r.family).push(r);
  }

  const families = [...byFamily.entries()]
    .map(([family, list]) => ({ family, ...familyProfile(list) }))
    .sort((a, b) => b.tasks - a.tasks);

  const overall = familyProfile(rows);
  const implemented = overall.puppyImplementedCount + overall.seniorTookOverCount;

  return {
    generatedAt: Date.now(),
    workerModel: rows.findLast?.((r) => r.workerModel)?.workerModel
      || rows.slice().reverse().find((r) => r.workerModel)?.workerModel
      || null,
    totalTasks: rows.length,
    includeSimulated,
    overall,
    puppyImplementedShare: implemented >= MIN_SAMPLES_FOR_RATE
      ? overall.puppyImplementedCount / implemented
      : null,
    families,
    strengths: families.filter((f) => f.enoughData && f.firstPassSuccess != null && f.firstPassSuccess >= 0.6),
    weaknesses: families.filter((f) => f.enoughData && f.firstPassSuccess != null && f.firstPassSuccess < 0.34),
    note: rows.length
      ? null
      : "No training records yet. Every metric on this page will stay empty until Robo Puppy actually runs tasks under the Mediator.",
  };
}

/**
 * Least help historically sufficient for this family.
 * The goal is increasing independence, so we start from what worked before
 * rather than defaulting to maximum hand-holding.
 */
export function recommendedTeachingLevel(family, { includeSimulated = false } = {}) {
  const rows = readMemory({ includeSimulated }).filter((r) => r.family === family);
  const successes = rows.filter((r) => r.outcome === "KEEP" && Number.isFinite(r.teachingLevel));
  if (successes.length < MIN_SAMPLES_FOR_RATE) {
    return { level: 1, confident: false, reason: `only ${successes.length} recorded successes for ${family}; starting at level 1` };
  }
  const level = Math.min(...successes.map((r) => r.teachingLevel));
  return {
    level,
    confident: true,
    reason: `lowest teaching level that has previously succeeded for ${family} across ${successes.length} records`,
  };
}
