/**
 * Lesson store: durable corrective behaviour extracted from repeated,
 * evidenced failures.
 *
 * Two rules keep this from becoming folklore:
 *   1. A lesson needs support from >= 2 distinct observed cases before it is
 *      eligible for prompt injection. One anecdote stays a candidate.
 *   2. Lessons are selected by phase and failure class, never all injected at
 *      once. Context volume has a measured cost: in the repair A/B the larger
 *      prompt raised unix-tool violations from 1 to 10.
 *
 * Only explicit artifacts are cited as evidence — mission ids, gate errors,
 * benchmark results. No hidden reasoning is stored.
 */

/** Mission phases a lesson may target. */
export const PHASES = ["investigate", "plan", "plan-critic", "proposal", "edit", "repair", "final"];

/**
 * @typedef {object} Lesson
 * @property {string} id
 * @property {string} failureClass
 * @property {string} summary        corrective behaviour, imperative
 * @property {string[]} evidenceCases
 * @property {number} supportCount
 * @property {string[]} counterexamples
 * @property {"low"|"medium"|"high"} confidence
 * @property {string[]} promptTargets  phases where this is injected
 * @property {string} lastVerified
 */

/** @type {Lesson[]} */
export const LESSONS = [
  {
    id: "path-not-implied-by-symbol",
    failureClass: "INVALID_REFERENCE",
    summary:
      "Before naming a write or inspect target, verify the path exists. A real symbol name does not imply "
      + "a file of the same name — a component may be an inner function of a larger module.",
    evidenceCases: [
      "fire-ux-level2-overnight-discovery-3#plan (DrivePanel.tsx)",
      "fire-ux-level2-overnight-discovery-3#final (DrivePanel.tsx)",
      "fire-ux-level2-overnight-discovery-6#plan (DrivePanel.tsx)",
      "fire-ux-level2-overnight-discovery-6#final (DrivePanel.tsx)",
      "fire-ux-level2-overnight-discovery-7#plan (DelayPanel.tsx, DrivePanel.tsx)",
      "pilot-fire-ux-plan#final (ModuleEnableToggleBase.tsx, HomeBandContent.tsx)",
      "helper-shadow-readonly-overnight#plan (src/Commands/FireCommandView.tsx)",
      "fire-level3-overnight-dryrun#plan (src/audioEngine.ts, src/stateManager.ts)",
    ],
    supportCount: 8,
    counterexamples: [],
    confidence: "high",
    promptTargets: ["investigate", "plan", "plan-critic", "proposal", "final"],
    lastVerified: "2026-09-03",
  },
  {
    id: "one-verdict-line",
    failureClass: "REPORTING_FAILURE",
    summary:
      "When acting as critic, emit exactly one machine-readable verdict on its own line, plus a labelled "
      + "line for each required field. A review whose substance is correct still fails the gate if the "
      + "verdict is not parseable.",
    evidenceCases: [
      "cover-store-readonly-overnight#final (wrote '## VERDICT READY'; mission exhausted its call budget)",
      "repair-store-readonly-overnight-2#final (emitted a file report with no verdict)",
      "fire-level3-overnight-dryrun#final (final critic gate: missing-verdict)",
      "fire-level3-overnight-dryrun-3#plan (plan critic gate: missing-verdict)",
    ],
    supportCount: 4,
    counterexamples: [],
    confidence: "high",
    promptTargets: ["plan-critic", "final"],
    lastVerified: "2026-09-03",
  },
  {
    id: "execution-is-mutation",
    failureClass: "APPLY_EMPTY",
    summary:
      "In an execution pass the only deliverable is a modified file. Call an edit or write tool. Do not "
      + "describe the patch, restate the plan, or create a summary document — a zero-byte delta is a failure "
      + "even when the description is correct.",
    evidenceCases: [
      "fire-drum-fill-preview-retry (BLOCKED on apply-discipline: EMPTY_EDIT)",
      "edit-curriculum mech-02-GatePanel (round 1 zero delta, recovered after the empty-edit packet)",
      "edit-curriculum mech-05-fireUiKit (two consecutive zero-delta rounds)",
    ],
    supportCount: 3,
    counterexamples: [
      "edit-curriculum tier 1: 3/3 applied on the first attempt when the prompt carried only the approved "
      + "change and the target file, suggesting the failure is prompt-shaped rather than intrinsic",
    ],
    confidence: "medium",
    promptTargets: ["edit", "repair"],
    lastVerified: "2026-09-03",
  },
  {
    id: "one-divergence-per-round",
    failureClass: "MECHANICAL_SYNTAX",
    summary:
      "Repair exactly one structural divergence per attempt, then stop and let the file be re-scanned. Do "
      + "not attempt to fix several imbalances in a single edit.",
    evidenceCases: [
      "repair-bench archived DrumMachine.tsx, two orphaned closers: 1/6 repaired",
      "edit-curriculum tier 5, one missing closer each: 4/6 repaired with the same model and round budget",
    ],
    supportCount: 2,
    counterexamples: [],
    confidence: "medium",
    promptTargets: ["repair"],
    lastVerified: "2026-09-03",
  },
  {
    id: "restore-before-reapply",
    failureClass: "REPAIR_DEGRADATION",
    summary:
      "When a repair attempt has already modified a broken file and validation still fails, restore the "
      + "pre-edit bytes before the next attempt. Stacking repairs on a damaged buffer makes it worse.",
    evidenceCases: [
      "fire-drum-fill-preview-live (four repair cycles, progressively worse, BLOCKED on validation retries exhausted)",
      "repair-bench baseline arm (2/6 attempts ended worse than they started; worst case 10 -> 90 diagnostics)",
      "edit-curriculum mech-03-MacroPanel (tutored round applied to the damaged buffer: 1 -> 2 diagnostics)",
    ],
    supportCount: 3,
    counterexamples: [],
    confidence: "high",
    promptTargets: ["repair"],
    lastVerified: "2026-09-03",
  },
  {
    id: "windows-tooling",
    failureClass: "TOOL_DISCIPLINE",
    summary:
      "This machine is Windows. Use Kill Chain MCP and native editor tools; use PowerShell if a shell is "
      + "unavoidable. Do not reach for bash, grep, sed, head, tail or Unix find.",
    evidenceCases: [
      "292 unix violations across 652 archived model calls (~0.45 per call)",
      "177 archived UNIX_VIOLATIONS artifacts; 'bash' appears 337 times",
      "repair-bench assisted arm: violations rose from 1 to 10 as prompt size grew",
    ],
    supportCount: 3,
    counterexamples: [],
    confidence: "high",
    promptTargets: ["investigate", "plan", "edit", "repair"],
    lastVerified: "2026-09-03",
  },
];

/** A lesson is eligible for injection only with corroborated support. */
export const MIN_SUPPORT = 2;

export function eligibleLessons() {
  return LESSONS.filter((l) => l.supportCount >= MIN_SUPPORT);
}

/**
 * Select lessons for a prompt. Phase-scoped and capped so context stays lean.
 * A failure class, when known, takes precedence over generic phase lessons.
 */
export function selectLessons({ phase, failureClass = null, max = 3 } = {}) {
  const eligible = eligibleLessons().filter((l) => l.promptTargets.includes(phase));
  const rank = (l) => {
    let score = 0;
    if (failureClass && l.failureClass === failureClass) score += 100;
    score += { high: 10, medium: 5, low: 1 }[l.confidence] || 0;
    score += Math.min(l.supportCount, 10);
    return score;
  };
  return [...eligible].sort((a, b) => rank(b) - rank(a)).slice(0, max);
}

/** Compact prompt block. Returns "" when nothing applies, so callers stay clean. */
export function formatLessons(lessons) {
  if (!lessons || !lessons.length) return "";
  const body = lessons.map((l) => `- ${l.summary}`).join("\n");
  return `LESSONS FROM PRIOR MISSIONS (each corroborated by at least ${MIN_SUPPORT} recorded cases):\n${body}`;
}

/** Candidate lessons that do not yet have enough support to inject. */
export function candidateLessons() {
  return LESSONS.filter((l) => l.supportCount < MIN_SUPPORT);
}
