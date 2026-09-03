export const STATES = [
  "CREATED",
  "PREFLIGHT",
  "INVESTIGATING",
  "PLANNING",
  "PLAN_REVIEW",
  "PROPOSING",
  "EDITING",
  "DIFF_REVIEW",
  "VALIDATING",
  "REPAIRING",
  "CHECKPOINT",
  "FINAL_REVIEW",
  "COMPLETE",
  "BLOCKED",
  "FAILED",
];

export const TERMINAL = new Set(["COMPLETE", "BLOCKED", "FAILED"]);

export const ALLOWED_TRANSITIONS = {
  CREATED: ["PREFLIGHT", "FAILED"],
  PREFLIGHT: ["INVESTIGATING", "BLOCKED", "FAILED"],
  INVESTIGATING: ["PLANNING", "BLOCKED", "FAILED"],
  PLANNING: ["PLAN_REVIEW", "BLOCKED", "FAILED"],
  PLAN_REVIEW: ["PROPOSING", "PLANNING", "BLOCKED", "FAILED"],
  PROPOSING: ["EDITING", "PROPOSING", "FINAL_REVIEW", "BLOCKED", "FAILED"],
  EDITING: ["DIFF_REVIEW", "BLOCKED", "FAILED"],
  DIFF_REVIEW: ["VALIDATING", "EDITING", "REPAIRING", "BLOCKED", "FAILED"],
  VALIDATING: ["CHECKPOINT", "REPAIRING", "FINAL_REVIEW", "BLOCKED", "FAILED"],
  REPAIRING: ["PROPOSING", "BLOCKED", "FAILED"],
  CHECKPOINT: ["PROPOSING", "FINAL_REVIEW", "BLOCKED", "FAILED"],
  FINAL_REVIEW: ["COMPLETE", "BLOCKED", "FAILED"],
  COMPLETE: [],
  BLOCKED: [],
  FAILED: [],
};

export function assertTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) throw new Error(`unknown state: ${from}`);
  if (!allowed.includes(to)) {
    throw new Error(`illegal mission transition ${from} → ${to}`);
  }
}

export function isTerminal(state) {
  return TERMINAL.has(state);
}
