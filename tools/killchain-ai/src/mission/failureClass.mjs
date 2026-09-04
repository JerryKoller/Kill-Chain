/**
 * Deterministic failure classification and type-based escalation.
 *
 * The runner historically escalated on retry COUNT alone: any failure got the
 * same "diagnose then apply again" treatment up to `maxRetriesPerPhase`, then
 * BLOCK. The archived evidence says that is wrong in two directions.
 *
 * Evidence from `tools/killchain-ai/data/missions` (71 missions):
 *   - fire-drum-fill-preview-live burned 4 repair cycles on a MECHANICAL_SYNTAX
 *     fault, each mutating an already-damaged buffer, and still blocked.
 *   - fire-drum-fill-preview-retry burned 3 identical apply retries on what was
 *     really a PRODUCT_AMBIGUITY ("no changes required") — retrying could never
 *     have helped.
 *   - 4 of 15 BLOCKs were `missing-verdict`, a REPORTING_FAILURE, i.e. the
 *     model did the work and lost the mission on output format.
 *
 * Different classes need different responses, so classify first, then route.
 */

export const FAILURE_CLASSES = [
  "MECHANICAL_SYNTAX",   // delimiter/JSX skeleton broken; parser cannot recover
  "INVENTED_SYMBOL",     // identifier or import that does not exist in scope
  "SEMANTIC_TYPE",       // real type error that is not a bare missing name
  "APPLY_EMPTY",         // entered an execution phase and produced zero delta
  "APPLY_DIVERGENT",     // wrote files, but not the ones the proposal approved
  "SCOPE_VIOLATION",     // touched paths outside allowedPaths
  "RETRIEVAL_INVENTED",  // referenced repository files that do not exist
  "PRODUCT_AMBIGUITY",   // task underspecified; model argues no change needed
  "REPORTING_FAILURE",   // work happened but the visible contract was not met
  "CRITIC_SUBSTANTIVE",  // critic raised a real, evidenced objection
  "VALIDATION_OTHER",    // tests/build failed for another reason
  "BUDGET_EXHAUSTED",    // model calls / wall clock / phases
  "INFRASTRUCTURE",      // tool, provider, or process failure
  "UNKNOWN",
];

/** Escalation actions the runner knows how to perform. */
export const ACTIONS = {
  STRUCTURAL_REPAIR: "STRUCTURAL_REPAIR",   // repair with the structural packet
  RESTORE_AND_REAPPLY: "RESTORE_AND_REAPPLY", // roll back to PRE_EDIT, apply fresh
  SCOPE_REPAIR: "SCOPE_REPAIR",             // re-derive identifiers from real scope
  FOCUSED_REPAIR: "FOCUSED_REPAIR",         // normal diagnose + apply
  STRONG_APPLY: "STRONG_APPLY",             // imperative execution-only retry
  REPLAN: "REPLAN",                         // back to PLANNING
  ENRICH_RETRIEVAL: "ENRICH_RETRIEVAL",     // force MCP verification pass
  REEMIT_REPORT: "REEMIT_REPORT",           // ask only for the missing contract fields
  TEACHER: "TEACHER",                       // escalate to senior/remote teacher
  BLOCK: "BLOCK",                           // stop; human decision required
};

const TS_INVENTED = new Set(["TS2304", "TS2552", "TS2551", "TS2307", "TS2305"]);

function hasCode(text, codes) {
  const s = String(text || "");
  return [...codes].some((c) => s.includes(c));
}

/**
 * Classify a failure from deterministic signals only. Never reads model prose
 * for its verdict; prose is used at most as a weak tiebreaker.
 *
 * @param {object} signal
 * @param {object} [signal.syntax]      result of checkChangedTsSyntax
 * @param {string} [signal.validation]  raw validation stdout/stderr
 * @param {object} [signal.editOutcome] result of classifyEditOutcome
 * @param {string[]} [signal.unauthorized] paths written outside scope
 * @param {string[]} [signal.inventedFiles]
 * @param {string} [signal.criticVerdict]
 * @param {string[]} [signal.criticErrors]
 * @param {string} [signal.blockedReason]
 * @param {string} [signal.proposalText]
 */
export function classifyFailure(signal = {}) {
  const {
    syntax, validation, editOutcome, unauthorized, inventedFiles,
    criticVerdict, criticErrors, blockedReason, proposalText,
  } = signal;

  const reasons = [];

  if (Array.isArray(unauthorized) && unauthorized.length) {
    return mk("SCOPE_VIOLATION", ACTIONS.BLOCK, [`wrote outside allowedPaths: ${unauthorized.join(", ")}`], { unauthorized });
  }

  if (syntax && syntax.ok === false) {
    const structures = syntax.structures || [];
    const mechanical = structures.find((s) => s.balanced === false);
    if (mechanical) {
      return mk(
        "MECHANICAL_SYNTAX",
        ACTIONS.STRUCTURAL_REPAIR,
        [
          `${mechanical.file}: delimiter skeleton broken at line ${mechanical.faultLine}`,
          `surplus=${mechanical.surplus} unclosed=${mechanical.unclosed} mismatched=${mechanical.mismatches}`,
        ],
        { file: mechanical.file, faultLine: mechanical.faultLine, structural: true },
      );
    }
    return mk("SEMANTIC_TYPE", ACTIONS.FOCUSED_REPAIR, ["syntax gate failed without a delimiter imbalance"], {});
  }

  if (validation && hasCode(validation, TS_INVENTED)) {
    const names = [...String(validation).matchAll(/Cannot find name '([^']+)'/g)].map((m) => m[1]);
    const suggested = [...String(validation).matchAll(/Did you mean '([^']+)'/g)].map((m) => m[1]);
    return mk(
      "INVENTED_SYMBOL",
      ACTIONS.SCOPE_REPAIR,
      [
        names.length ? `identifiers not in scope: ${[...new Set(names)].join(", ")}` : "missing name/module diagnostic",
        suggested.length ? `compiler suggests: ${[...new Set(suggested)].join(", ")}` : "",
      ].filter(Boolean),
      { names: [...new Set(names)], suggested: [...new Set(suggested)] },
    );
  }

  if (editOutcome && editOutcome.empty) {
    // "No changes required" is a product question, not an execution failure.
    const arguesNoChange = /\bNO CHANGES REQUIRED\b|\bdoes not exist\b|\bno edit (?:is )?needed\b/i
      .test(String(proposalText || ""));
    if (arguesNoChange) {
      return mk(
        "PRODUCT_AMBIGUITY",
        ACTIONS.BLOCK,
        ["execution phase produced zero delta because the model argues the premise is false"],
        { kind: editOutcome.kind },
      );
    }
    return mk(
      "APPLY_EMPTY",
      ACTIONS.STRONG_APPLY,
      [`execution phase produced zero file delta (${editOutcome.kind})`],
      { kind: editOutcome.kind, tools: editOutcome.tools || [] },
    );
  }

  if (Array.isArray(inventedFiles) && inventedFiles.length) {
    return mk(
      "RETRIEVAL_INVENTED",
      ACTIONS.ENRICH_RETRIEVAL,
      [`referenced non-existent paths: ${inventedFiles.join(", ")}`],
      { inventedFiles },
    );
  }

  const errs = criticErrors || [];
  if (errs.length) {
    const formatOnly = errs.every((e) => /missing-verdict|critic-no-tools|no-inspected-files|thin/i.test(String(e)));
    if (formatOnly) {
      return mk("REPORTING_FAILURE", ACTIONS.REEMIT_REPORT, [`critic output contract unmet: ${errs.join("; ")}`], { errors: errs });
    }
    return mk("CRITIC_SUBSTANTIVE", ACTIONS.REPLAN, [`critic raised evidenced objections: ${errs.join("; ")}`], { errors: errs });
  }

  if (criticVerdict === "BLOCK") {
    return mk("CRITIC_SUBSTANTIVE", ACTIONS.BLOCK, ["critic returned BLOCK"], {});
  }
  if (criticVerdict === "FAIL" || criticVerdict === "NOT_READY") {
    return mk("CRITIC_SUBSTANTIVE", ACTIONS.REPLAN, [`critic returned ${criticVerdict}`], {});
  }

  if (/maxModelCalls|maxWallClock|maxPhases|budget/i.test(String(blockedReason || ""))) {
    return mk("BUDGET_EXHAUSTED", ACTIONS.TEACHER, [String(blockedReason)], {});
  }

  if (validation) {
    return mk("VALIDATION_OTHER", ACTIONS.FOCUSED_REPAIR, ["validation failed"], {});
  }

  return mk("UNKNOWN", ACTIONS.FOCUSED_REPAIR, reasons, {});
}

function mk(failureClass, action, evidence, detail) {
  return { failureClass, action, evidence: evidence.filter(Boolean), detail: detail || {} };
}

/**
 * Decide the next escalation step from the failure class and how many times
 * this same class has already been seen in the mission.
 *
 * Repeating an action that has already failed twice on the same class is the
 * behaviour that produced the archived repair spiral, so escalate instead.
 */
export function escalate(classification, { attemptsForClass = 0, teacherAvailable = false, level = 0 } = {}) {
  const { failureClass, action } = classification;

  if (action === ACTIONS.BLOCK) {
    return { action: ACTIONS.BLOCK, reason: `${failureClass}: human decision required`, escalated: false };
  }

  if (failureClass === "MECHANICAL_SYNTAX") {
    if (attemptsForClass === 0) {
      return { action: ACTIONS.STRUCTURAL_REPAIR, reason: "first mechanical failure: repair with structural packet", escalated: false };
    }
    if (attemptsForClass === 1) {
      // Mutating a damaged buffer twice is what degraded the archived file.
      return { action: ACTIONS.RESTORE_AND_REAPPLY, reason: "mechanical failure repeated: restore PRE_EDIT and re-apply the approved patch fresh", escalated: true };
    }
    return teacherAvailable
      ? { action: ACTIONS.TEACHER, reason: "mechanical failure survived a clean re-apply", escalated: true }
      : { action: ACTIONS.BLOCK, reason: "mechanical failure survived a clean re-apply and no teacher is configured", escalated: true };
  }

  if (failureClass === "INVENTED_SYMBOL") {
    if (attemptsForClass === 0) {
      return { action: ACTIONS.SCOPE_REPAIR, reason: "resolve identifiers against real file scope before editing", escalated: false };
    }
    return { action: ACTIONS.RESTORE_AND_REAPPLY, reason: "invented identifiers persisted: restore and re-apply", escalated: true };
  }

  if (failureClass === "APPLY_EMPTY") {
    if (attemptsForClass === 0) return { action: ACTIONS.STRONG_APPLY, reason: "execution-only retry", escalated: false };
    if (attemptsForClass === 1) return { action: ACTIONS.STRONG_APPLY, reason: "stronger execution-only retry", escalated: true };
    return { action: ACTIONS.BLOCK, reason: "apply discipline: three consecutive zero-delta execution phases", escalated: true };
  }

  if (failureClass === "REPORTING_FAILURE") {
    return attemptsForClass === 0
      ? { action: ACTIONS.REEMIT_REPORT, reason: "ask only for the missing contract fields", escalated: false }
      : { action: ACTIONS.BLOCK, reason: "output contract unmet twice", escalated: true };
  }

  if (failureClass === "RETRIEVAL_INVENTED") {
    return attemptsForClass === 0
      ? { action: ACTIONS.ENRICH_RETRIEVAL, reason: "force MCP existence verification for every referenced path", escalated: false }
      : { action: ACTIONS.REPLAN, reason: "retrieval remained unfactual", escalated: true };
  }

  if (failureClass === "CRITIC_SUBSTANTIVE") {
    return attemptsForClass < 2
      ? { action: ACTIONS.REPLAN, reason: "address substantiated critic findings", escalated: false }
      : { action: teacherAvailable ? ACTIONS.TEACHER : ACTIONS.BLOCK, reason: "plan rejected repeatedly", escalated: true };
  }

  if (failureClass === "SEMANTIC_TYPE" || failureClass === "VALIDATION_OTHER") {
    if (attemptsForClass < 2) return { action: ACTIONS.FOCUSED_REPAIR, reason: "focused local repair", escalated: false };
    return teacherAvailable
      ? { action: ACTIONS.TEACHER, reason: "semantic failure survived local repair", escalated: true }
      : { action: ACTIONS.BLOCK, reason: "semantic failure survived local repair", escalated: true };
  }

  if (failureClass === "BUDGET_EXHAUSTED") {
    return { action: teacherAvailable ? ACTIONS.TEACHER : ACTIONS.BLOCK, reason: "budget exhausted", escalated: true };
  }

  // Audio-adjacent work never gets blind local retries.
  if (level >= 4) {
    return { action: teacherAvailable ? ACTIONS.TEACHER : ACTIONS.BLOCK, reason: "audio-level mission: no blind local retries", escalated: true };
  }

  return attemptsForClass < 2
    ? { action: action || ACTIONS.FOCUSED_REPAIR, reason: "default focused retry", escalated: false }
    : { action: ACTIONS.BLOCK, reason: `${failureClass}: retries exhausted`, escalated: true };
}

/** Human-readable one-liner for JOURNAL.md. */
export function describeFailure(classification, decision) {
  const ev = classification.evidence?.length ? ` — ${classification.evidence[0]}` : "";
  return `${classification.failureClass} → ${decision.action}${decision.escalated ? " (escalated)" : ""}${ev}`;
}
