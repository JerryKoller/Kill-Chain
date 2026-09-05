/**
 * Phase-aware model-call budgeting.
 *
 * Field evidence (`run_mto1hfmy_e7aeb7` m03): the worker legally reached EDITING
 * after investigate → plan → critic → evidence repair → proposal, then discovered
 * `maxModelCalls` was already spent. Implementation never got a turn.
 *
 * Rule: pre-edit phases may not consume the implementation reserve. Entering
 * EDITING with zero remaining calls is BUDGET_STARVATION, not a successful
 * handoff. Read-only / dry-run missions reserve nothing — there is no edit.
 */

export const IMPLEMENTATION_RESERVE_CALLS = 2;
/** Investigate + plan + critic + optional evidence/format repair + proposal. */
export const MIN_PRE_EDIT_CALLS = 6;

const IMPLEMENTATION_PHASE_RE = /^(edit|repair-apply)/;

const PRE_EDIT_STATES = new Set([
  "CREATED",
  "PREFLIGHT",
  "INVESTIGATING",
  "PLANNING",
  "PLAN_REVIEW",
  "PROPOSING",
]);

export function isImplementationPhase(state, phase) {
  if (state === "EDITING" || state === "REPAIRING") return true;
  return IMPLEMENTATION_PHASE_RE.test(String(phase || ""));
}

export function isPreEditState(state, phase) {
  if (isImplementationPhase(state, phase)) return false;
  if (state === "FINAL_REVIEW" || String(phase || "") === "final") return false;
  return PRE_EDIT_STATES.has(state) || !state;
}

export function implementationReserve(spec = {}, status = {}) {
  const dry = Boolean(status.dryRun || spec.dryRun);
  const edits = Boolean(spec.levelInfo?.edits);
  if (dry || !edits) return 0;
  const n = spec.implementationReserveCalls;
  if (n != null && Number.isFinite(Number(n))) {
    return Math.min(8, Math.max(0, Math.round(Number(n))));
  }
  return IMPLEMENTATION_RESERVE_CALLS;
}

export function remainingCalls(spec, status) {
  return Math.max(0, Number(spec.maxModelCalls || 0) - Number(status.modelCalls || 0));
}

export function canEnterEditing(spec, status) {
  if (!spec.levelInfo?.edits || status.dryRun || spec.dryRun) return false;
  return remainingCalls(spec, status) >= 1;
}

/**
 * Floor a supervisor-recommended budget so a successful pre-edit path still
 * leaves the implementation reserve. Large recommendations are left alone;
 * we do not inflate an already-sufficient ceiling.
 */
export function allocateMicroMissionCallBudget(recommended, baseMax, { edits = true } = {}) {
  const requested = Math.max(1, Number(recommended) || Number(baseMax) || (MIN_PRE_EDIT_CALLS + IMPLEMENTATION_RESERVE_CALLS));
  if (!edits) return requested;
  return Math.max(requested, MIN_PRE_EDIT_CALLS + IMPLEMENTATION_RESERVE_CALLS);
}

export function planningCap(spec, status) {
  const cap = Number(spec.maxModelCalls || 0);
  const reserve = implementationReserve(spec, status);
  return Math.max(0, cap - reserve);
}

/**
 * Call-budget half of the runner's budgetHit. Wall-clock and phase-count
 * remain the runner's responsibility.
 *
 * @returns {string|null} blocked reason, or null if a call is still allowed
 */
export function callBudgetHit(spec, status, { phase = null } = {}) {
  const cap = Number(spec.maxModelCalls || 0);
  if (!cap) return null;
  const reserve = implementationReserve(spec, status);
  const preEdit = isPreEditState(status.state, phase);
  const effectiveCap = preEdit ? Math.max(0, cap - reserve) : cap;
  if (Number(status.modelCalls || 0) >= effectiveCap) {
    if (preEdit && reserve > 0) {
      return `BUDGET_STARVATION planning used ${status.modelCalls} of ${cap} (${reserve} reserved for implementation)`;
    }
    return `maxModelCalls ${cap}`;
  }
  return null;
}

export function refuseEditingReason(spec, status) {
  const left = remainingCalls(spec, status);
  return `BUDGET_STARVATION cannot enter EDITING with ${left} implementation call(s) remaining (maxModelCalls ${spec.maxModelCalls})`;
}
