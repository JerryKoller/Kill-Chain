/**
 * Model router.
 *
 * V1 is deterministic on purpose. We do not run an LLM to ask another LLM which
 * LLM to ask. The rules below are a data table so tests assert the real rule
 * rather than a reimplementation of it.
 *
 * The Mediator is one entity in different cognitive gears. FAST handles routine
 * judgement; DEEP is reserved for reasoning that is worth its latency; after a
 * DEEP escalation resolves, the router returns to FAST rather than leaving the
 * slow model switched on.
 */

export const ROUTE_FAST = "FAST_SUPERVISOR";
export const ROUTE_DEEP = "DEEP_SUPERVISOR";
export const ROUTE_VISUAL = "VISUAL_REVIEW";
/** Not a model. An intentional halt that requires a person. */
export const ROUTE_HUMAN = "HUMAN";

export const MODE_AUTO = "AUTO_ROUTE";
export const MODE_FAST_ONLY = "FAST_ONLY";
export const MODE_DEEP_ONLY = "DEEP_ONLY";
export const MODES = [MODE_AUTO, MODE_FAST_ONLY, MODE_DEEP_ONLY];

/**
 * Ordered rules. First match wins.
 *
 * `safetyCritical` marks decisions we refuse to hand to an inadequate model.
 * `stop` marks situations where the correct answer is to halt, not to think harder.
 */
export const ROUTING_RULES = [
  // --- halt-first conditions: deterministic evidence says something is wrong ---
  {
    id: "preservation-hash-mismatch",
    when: (s) => Boolean(s.preservationHashMismatch),
    role: ROUTE_DEEP,
    stop: true,
    safetyCritical: true,
    reason: "A preserved file's hash changed. Halt and review before any further work.",
  },
  {
    id: "unexpected-production-file",
    when: (s) => Boolean(s.unexpectedProductionFile),
    role: ROUTE_DEEP,
    stop: true,
    safetyCritical: true,
    reason: "A production file changed outside the authorized scope.",
  },

  // --- deep reasoning triggers ---
  {
    id: "trusted-evidence-issue",
    when: (s) => Boolean(s.trustedEvidenceIssue),
    role: ROUTE_DEEP,
    safetyCritical: true,
    reason: "Evidence grounding is in question; this is a trust-boundary decision.",
  },
  {
    id: "safety-semantics",
    when: (s) => Boolean(s.safetySemantics) || Boolean(s.weakensGate),
    role: ROUTE_DEEP,
    safetyCritical: true,
    reason: "Change touches deterministic safety semantics or would weaken a gate.",
  },
  {
    id: "critic-policy-bug",
    when: (s) => Boolean(s.criticPolicyBug),
    role: ROUTE_DEEP,
    safetyCritical: true,
    reason: "Critic or gate behaviour itself is suspect.",
  },
  {
    id: "foreman-failure",
    when: (s) => Boolean(s.foremanFailure),
    role: ROUTE_DEEP,
    safetyCritical: false,
    reason: "Failure is in the foreman/runner orchestration, not in the worker.",
  },
  {
    id: "checkpoint-ambiguity",
    when: (s) => Boolean(s.checkpointAmbiguity),
    role: ROUTE_DEEP,
    safetyCritical: true,
    reason: "Checkpoint restoration is ambiguous; a wrong choice loses work.",
  },
  {
    id: "conflicting-evidence",
    when: (s) => Boolean(s.conflictingEvidence),
    role: ROUTE_DEEP,
    safetyCritical: false,
    reason: "Deterministic evidence disagrees with itself.",
  },
  {
    id: "repeated-worker-failure",
    when: (s) => Number(s.sameFailureCount || 0) >= 2,
    role: ROUTE_DEEP,
    safetyCritical: false,
    reason: "The worker has failed the same way twice; more of the same will not help.",
  },
  {
    id: "architectural-change",
    when: (s) => Boolean(s.architecturalChange),
    role: ROUTE_DEEP,
    safetyCritical: false,
    reason: "A proposed architecture change needs senior review.",
  },
  {
    id: "fast-requests-escalation",
    when: (s) => Boolean(s.fastRequestsEscalation),
    role: ROUTE_DEEP,
    safetyCritical: false,
    reason: "The fast supervisor explicitly asked to escalate.",
  },
  {
    id: "fast-confidence-low",
    when: (s) => s.fastConfidence != null && Number(s.fastConfidence) < 0.5,
    role: ROUTE_DEEP,
    safetyCritical: false,
    reason: "Fast supervisor confidence was below the escalation threshold.",
  },

  // --- visual ---
  {
    id: "visual-screening",
    when: (s) => Boolean(s.needsVisualReview),
    role: ROUTE_VISUAL,
    safetyCritical: false,
    reason: "A rendered frame needs mechanical visual screening.",
  },

  // --- routine work stays fast ---
  {
    id: "routine",
    when: () => true,
    role: ROUTE_FAST,
    safetyCritical: false,
    reason: "Routine supervision.",
  },
];

export const ESCALATION_THRESHOLD = 0.5;

/**
 * Decide which cognitive gear handles this situation.
 *
 * `availability` lets provider outage change the answer without ever silently
 * downgrading a safety-critical decision to an inadequate model.
 */
export function routeSupervisor(situation = {}, { mode = MODE_AUTO, availability = null } = {}) {
  const matched = ROUTING_RULES.find((r) => r.when(situation)) || ROUTING_RULES[ROUTING_RULES.length - 1];
  const base = {
    ruleId: matched.id,
    role: matched.role,
    reason: matched.reason,
    safetyCritical: Boolean(matched.safetyCritical),
    stop: Boolean(matched.stop),
    overridden: false,
    degraded: false,
  };

  // Manual overrides. A human may force a gear, but may not force a
  // safety-critical decision down to the fast model.
  if (mode === MODE_FAST_ONLY && base.role === ROUTE_DEEP) {
    if (base.safetyCritical) {
      return { ...base, role: ROUTE_HUMAN, overridden: true, reason: `${base.reason} FAST ONLY was requested, but this decision is safety-critical, so it pauses for a human instead.` };
    }
    return { ...base, role: ROUTE_FAST, overridden: true, reason: `${base.reason} Overridden to FAST by manual FAST ONLY mode.` };
  }
  if (mode === MODE_DEEP_ONLY && base.role === ROUTE_FAST) {
    return { ...base, role: ROUTE_DEEP, overridden: true, reason: `${base.reason} Overridden to DEEP by manual DEEP ONLY mode.` };
  }

  if (!availability) return base;
  return applyAvailability(base, availability);
}

/**
 * Provider failure handling.
 *
 * FAST down  -> try DEEP for routine work (slow but correct).
 * DEEP down  -> routine work may fall back to FAST; safety-critical work pauses.
 * Neither    -> pause for a human. We never route a safety-critical task to an
 *               inadequate model just to keep the loop moving.
 */
export function applyAvailability(decision, availability) {
  const fastUp = availability[ROUTE_FAST] !== false;
  const deepUp = availability[ROUTE_DEEP] !== false;
  const visualUp = availability[ROUTE_VISUAL] !== false;

  if (decision.role === ROUTE_FAST && !fastUp) {
    if (deepUp) {
      return { ...decision, role: ROUTE_DEEP, degraded: true, reason: `${decision.reason} FAST supervisor unavailable, using DEEP.` };
    }
    return { ...decision, role: ROUTE_HUMAN, degraded: true, reason: `${decision.reason} No supervisor model is available.` };
  }

  if (decision.role === ROUTE_DEEP && !deepUp) {
    if (decision.safetyCritical) {
      return { ...decision, role: ROUTE_HUMAN, degraded: true, reason: `${decision.reason} DEEP supervisor unavailable and this decision is safety-critical, so it pauses for a human.` };
    }
    if (fastUp) {
      return { ...decision, role: ROUTE_FAST, degraded: true, reason: `${decision.reason} DEEP supervisor unavailable; routing to FAST because this decision is not safety-critical.` };
    }
    return { ...decision, role: ROUTE_HUMAN, degraded: true, reason: `${decision.reason} No supervisor model is available.` };
  }

  if (decision.role === ROUTE_VISUAL && !visualUp) {
    return { ...decision, role: ROUTE_HUMAN, degraded: true, reason: `${decision.reason} No image-capable model is available.` };
  }

  return decision;
}

/**
 * After a DEEP escalation resolves, drop back to FAST. Nemotron Ultra should not
 * stay switched on merely because it was invoked once.
 */
export function nextSituationAfterResolution(situation = {}) {
  return {
    ...situation,
    escalationResolved: true,
    sameFailureCount: 0,
    foremanFailure: false,
    fastRequestsEscalation: false,
    fastConfidence: null,
    // Safety-critical / still-unresolved DEEP reasons are NOT cleared here.
    // A successful DEEP teaching packet for repeated worker failure must return
    // to FAST; a live trust-boundary or preservation issue must stay DEEP.
  };
}

/**
 * Translate a validated supervisor result into the signals the router reads on
 * the next turn. This is how `ESCALATE` and low confidence actually cause a gear
 * change rather than just being reported.
 */
export function situationFromResult(situation, result, { role } = {}) {
  if (!result) return situation;
  const next = { ...situation };
  if (role === ROUTE_FAST) {
    next.fastConfidence = result.confidence;
    next.fastRequestsEscalation = result.decision === "ESCALATE";
  }
  if (result.decision === "NEEDS_SENIOR_IMPLEMENTATION") next.needsSeniorImplementation = true;
  return next;
}

/** Map a deterministic failure class onto routing signals. */
export function situationFromFailureClass(failureClass, { sameFailureCount = 0 } = {}) {
  const s = { failureClass, sameFailureCount };
  switch (failureClass) {
    case "SCOPE_VIOLATION":
      s.unexpectedProductionFile = false;
      s.safetySemantics = false;
      break;
    case "RETRIEVAL_INVENTED":
      s.trustedEvidenceIssue = true;
      break;
    case "INFRASTRUCTURE":
      s.foremanFailure = true;
      break;
    default:
      break;
  }
  return s;
}

export function describeRoute(decision) {
  const gear = decision.role === ROUTE_HUMAN ? "PAUSE FOR HUMAN" : decision.role.replace(/_/g, " ");
  return `${gear} — ${decision.reason}`;
}
