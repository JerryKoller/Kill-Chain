/**
 * Sanitized regression fixture mined from the real production field run
 * `run_mto1hfmy_e7aeb7` (2026-09-05). Not a fixture *run* — a recorded sequence
 * the architecture tests must keep reproducing.
 *
 * Production bytes retained: 0. Safety violations: 0. Edit tool invokes: 0.
 */
export const FIELD_RUN_MTO1HFMY = {
  runId: "run_mto1hfmy_e7aeb7",
  production: true,
  fixture: false,
  tasksAttempted: 4,
  tasksCompleted: 0,
  puppyCalls: 19,
  editInvocations: 0,
  productionBytesRetained: 0,
  safetyViolations: 0,
  recommendedModelCalls: [6, 4, 6, 3],
  routes: [
    { task: 1, role: "FAST_SUPERVISOR", ruleId: "routine", decision: "TASK" },
    { task: 2, role: "FAST_SUPERVISOR", ruleId: "routine", decision: "RETRY" },
    { task: 3, role: "DEEP_SUPERVISOR", ruleId: "repeated-worker-failure", decision: "RETRY", escalationResolved: true },
    { task: 4, role: "DEEP_SUPERVISOR", ruleId: "repeated-worker-failure", decision: "RETRY", escalationResolved: true },
  ],
  defects: {
    budgetStarvation: "m03 reached EDITING after 6 pre-edit calls with maxModelCalls=6; zero implementation calls remained",
    deepStickiness: "ESCALATION_RESOLVED fired after DEEP RETRY but the next route was still repeated-worker-failure/DEEP",
    deepTimeoutAbort: "fifth supervisor call timed out (~900s) and blocked the entire run with reason 'timeout'",
    evidenceRepairWorked: "m03 EVIDENCE_REPAIR gathered live killchain_symbol evidence, critic PASS, proposal passed scope",
  },
};
