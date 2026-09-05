/**
 * Tutoring layer: turn deterministic gate detections into targeted correction.
 *
 * The foreman already knows exactly what was wrong — which field was absent,
 * which path was invented, which paths were authorized. Historically it threw
 * that away and either blocked or re-ran the whole phase. A CorrectionPacket
 * carries the localization forward so the model repairs one specific thing
 * instead of reinterpreting the mission.
 *
 * Packets are deliberately small. They never re-send the mission brief.
 */

import { repoFileExists, parseMentionedPaths, tryLocalVerdictNormalize } from "./critic.mjs";

/** Failure kinds. Each maps to exactly one recovery path. */
export const TUTOR = {
  /** Contract/shape only. Substance may be fine. Cheapest recovery. */
  CRITIC_FORMAT: "CRITIC_FORMAT",
  /** Critic found something real. Not a format problem; act on the finding. */
  CRITIC_SUBSTANTIVE: "CRITIC_SUBSTANTIVE",
  /** Cited a path or symbol that does not exist. */
  INVALID_REFERENCE: "INVALID_REFERENCE",
  /** Wrote or proposed writing outside allowedPaths. */
  SCOPE: "SCOPE",
  /** Entered an execution phase and produced no delta. */
  EMPTY_EDIT: "EMPTY_EDIT",
  /** Syntax/typecheck/build failure with localizable evidence. */
  VALIDATION: "VALIDATION",
  /** Requires a human decision. Never a model retry. */
  PRODUCT_AMBIGUITY: "PRODUCT_AMBIGUITY",
};

/**
 * Gate error strings, mapped to failure kind.
 * Order matters: the first matching pattern wins, so substantive and
 * ambiguity classes must be tested before the format class.
 */
const ERROR_KINDS = [
  [/^unresolved-design$|^option-menu$|^asks-operator$/, TUTOR.PRODUCT_AMBIGUITY],
  [/^invented-files:|^invented-inner-panel:|^wrong-stack:|^existing-marked-new:/, TUTOR.INVALID_REFERENCE],
  [/^outside-allowed:|^forbidden:/, TUTOR.SCOPE],
  [/^missing-verdict$|^no-inspected-files$|^no-risk$|^no-evidence$|^critic-no-tools$|^praise-only$|^proposal-too-thin$/, TUTOR.CRITIC_FORMAT],
];

/** Which contract field each format error corresponds to. */
const FIELD_FOR_ERROR = {
  "missing-verdict": "VERDICT",
  "no-inspected-files": "INSPECTED",
  "no-risk": "RISK",
  "no-evidence": "EVIDENCE",
  "praise-only": "RISK",
  "critic-no-tools": "INSPECTED",
};

export function kindForError(error) {
  const e = String(error || "");
  for (const [re, kind] of ERROR_KINDS) if (re.test(e)) return kind;
  return TUTOR.CRITIC_SUBSTANTIVE;
}

/**
 * Split a gate result into what can be cheaply reformatted versus what needs
 * real work. This is the distinction the archive was missing: 8 of 15 blocked
 * missions were format-only, and all 8 were sent back to re-plan.
 */
export function classifyGateFailure(gate = {}) {
  const errors = [...new Set(gate.errors || [])];
  const kinds = new Map();
  for (const e of errors) {
    const k = kindForError(e);
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k).push(e);
  }

  const verdict = String(gate.modelVerdict || "").toUpperCase();
  const negativeVerdict = verdict === "FAIL" || verdict === "BLOCK" || verdict === "NOT_READY";

  // A negative verdict with no contract errors is the critic doing its job.
  if (negativeVerdict && !errors.length) {
    return { kind: TUTOR.CRITIC_SUBSTANTIVE, formatOnly: false, errors, kinds, missingFields: [] };
  }

  const present = [...kinds.keys()];
  // Ambiguity and reference/scope problems outrank formatting.
  for (const priority of [TUTOR.PRODUCT_AMBIGUITY, TUTOR.INVALID_REFERENCE, TUTOR.SCOPE, TUTOR.CRITIC_SUBSTANTIVE]) {
    if (present.includes(priority)) {
      return { kind: priority, formatOnly: false, errors, kinds, missingFields: missingFieldsFrom(kinds) };
    }
  }

  if (present.includes(TUTOR.CRITIC_FORMAT)) {
    return { kind: TUTOR.CRITIC_FORMAT, formatOnly: true, errors, kinds, missingFields: missingFieldsFrom(kinds) };
  }
  return { kind: null, formatOnly: false, errors, kinds, missingFields: [] };
}

/** What PLAN_REVIEW should do. Pure. Never stamps PASS itself. */
/**
 * EVIDENCE_REPAIR is tracked separately from generic critic retries so a missing
 * INSPECTED field gets exactly one tool-enabled recovery rather than competing
 * for the prose-repair budget.
 */
export const PLAN_CRITIC_ACTION = {
  EVIDENCE_REPAIR: "EVIDENCE_REPAIR",
  CONTINUE: "CONTINUE",
  LOCAL_NORMALIZE: "LOCAL_NORMALIZE",
  FORMAT_REPAIR: "FORMAT_REPAIR",
  NEEDS_MORE_EVIDENCE: "NEEDS_MORE_EVIDENCE",
  PLAN_CORRECTION: "PLAN_CORRECTION",
  BLOCK: "BLOCK",
};

/**
 * Route a plan-critic gate failure.
 *
 * missing-verdict with real review substance → cheap format repair.
 * missing-verdict with no approve/reject substance → NEEDS_MORE_EVIDENCE
 *   (do not invent a verdict).
 * invented-files / scope / ambiguity outrank format, even when VERDICT is also
 * missing — that mix must not take the cheap path.
 */
/**
 * Concrete files the critic could actually be told to inspect.
 * Globs are skipped — we only name paths a model can open directly.
 */
export function evidenceTargets(spec) {
  const allowed = spec?.allowedPaths || [];
  return allowed.filter((p) => typeof p === "string" && p && !p.includes("*")).slice(0, 4);
}

export function planCriticDisposition(gate = {}, criticText = "", { spec = null } = {}) {
  if (gate.pass) {
    return { action: PLAN_CRITIC_ACTION.CONTINUE, kind: null, formatOnly: false };
  }

  const cls = classifyGateFailure(gate);
  const verdict = String(gate.modelVerdict || "").toUpperCase();

  if (!gate.missingVerdict && (verdict === "BLOCK")) {
    return { action: PLAN_CRITIC_ACTION.BLOCK, kind: cls.kind, formatOnly: false };
  }

  if (cls.kind === TUTOR.PRODUCT_AMBIGUITY || cls.kind === TUTOR.INVALID_REFERENCE || cls.kind === TUTOR.SCOPE) {
    return { action: PLAN_CRITIC_ACTION.PLAN_CORRECTION, kind: cls.kind, formatOnly: false };
  }

  // A missing INSPECTED field is an evidence problem, not a formatting one. The
  // cheap needs-evidence repair explicitly forbids tools, so asking for
  // inspected files that way is unwinnable — it consumed two calls and blocked
  // the first live production mission. Route it to one targeted, tool-enabled
  // evidence pass aimed at the mission's own authorized files.
  const targets = evidenceTargets(spec);
  if ((gate.errors || []).includes("no-inspected-files") && targets.length) {
    return {
      action: PLAN_CRITIC_ACTION.EVIDENCE_REPAIR,
      kind: TUTOR.CRITIC_FORMAT,
      formatOnly: false,
      targets,
    };
  }

  if (gate.missingVerdict) {
    const local = tryLocalVerdictNormalize(criticText);
    if (local.repaired) {
      return {
        action: PLAN_CRITIC_ACTION.LOCAL_NORMALIZE,
        kind: TUTOR.CRITIC_FORMAT,
        formatOnly: true,
        normalizedText: local.text,
        verdict: local.verdict,
      };
    }
    if (!cls.formatOnly && cls.kind) {
      return { action: PLAN_CRITIC_ACTION.PLAN_CORRECTION, kind: cls.kind, formatOnly: false };
    }
    if (hasSubstanceFor("VERDICT", criticText)) {
      return { action: PLAN_CRITIC_ACTION.FORMAT_REPAIR, kind: TUTOR.CRITIC_FORMAT, formatOnly: true };
    }
    return { action: PLAN_CRITIC_ACTION.NEEDS_MORE_EVIDENCE, kind: TUTOR.CRITIC_SUBSTANTIVE, formatOnly: false };
  }

  if (cls.formatOnly) {
    const fields = cls.missingFields.length ? cls.missingFields : ["VERDICT"];
    const allHaveSubstance = fields.every((f) => hasSubstanceFor(f, criticText));
    if (allHaveSubstance) {
      return { action: PLAN_CRITIC_ACTION.FORMAT_REPAIR, kind: TUTOR.CRITIC_FORMAT, formatOnly: true };
    }
    return { action: PLAN_CRITIC_ACTION.NEEDS_MORE_EVIDENCE, kind: TUTOR.CRITIC_SUBSTANTIVE, formatOnly: false };
  }

  if (verdict === "FAIL" || verdict === "NOT_READY" || cls.kind === TUTOR.CRITIC_SUBSTANTIVE) {
    return { action: PLAN_CRITIC_ACTION.PLAN_CORRECTION, kind: TUTOR.CRITIC_SUBSTANTIVE, formatOnly: false };
  }

  return { action: PLAN_CRITIC_ACTION.PLAN_CORRECTION, kind: cls.kind, formatOnly: false };
}

function missingFieldsFrom(kinds) {
  const out = [];
  for (const e of kinds.get(TUTOR.CRITIC_FORMAT) || []) {
    const f = FIELD_FOR_ERROR[e];
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * Does the critic's own text already contain the substance for a field, just
 * not under the contract heading? If so a format repair is safe: the model is
 * reshaping content it already produced rather than inventing evidence.
 */
export function hasSubstanceFor(field, criticText) {
  const raw = String(criticText || "");
  if (raw.trim().length < 120) return false;
  switch (field) {
    case "VERDICT":
      return /\b(approve[ds]?|looks correct|should proceed|ready to|do not proceed|reject|blocking|not ready|insufficient)\b/i.test(raw)
        || /\brecommend(?:ing)?\b[^.\n]{0,40}\bproceed/i.test(raw);
    case "INSPECTED":
      return parseMentionedPaths(raw).length >= 1;
    case "RISK":
      return /\b(risk|regression|could break|could fail|might break|side effect|invariant|coupling|breaks?\b)/i.test(raw);
    case "EVIDENCE":
      return /\b(line \d+|because|inspected|verified|confirmed|read the|checked)\b/i.test(raw);
    default:
      return false;
  }
}

const CLIP = (s, n) => {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, n)}\n…[clipped]`;
};

function section(title, body) {
  const b = String(body || "").trim();
  return b ? `${title}:\n${b}\n` : "";
}

function line(title, body) {
  const b = String(body || "").trim();
  return b ? `${title}: ${b}\n` : "";
}

/**
 * Nearest verified references for an invalid path.
 * Deterministic and thresholded — a basename match or a same-directory
 * sibling, never a fuzzy guess. Returns [] rather than speculating.
 */
export function nearestValidReferences(invalidPath, { candidates = [] } = {}) {
  const bad = String(invalidPath || "").replace(/\\/g, "/");
  const base = bad.split("/").pop().replace(/\.(tsx|ts|mjs|js)$/, "");
  const dir = bad.split("/").slice(0, -1).join("/");
  const out = [];

  for (const c of candidates) {
    const cp = String(c).replace(/\\/g, "/");
    if (!repoFileExists(cp)) continue;
    const cbase = cp.split("/").pop().replace(/\.(tsx|ts|mjs|js)$/, "");
    const cdir = cp.split("/").slice(0, -1).join("/");
    let why = null;
    if (cbase === base) why = "same filename, different directory";
    else if (cdir === dir && (cbase.includes(base) || base.includes(cbase))) why = "sibling with related name";
    else if (cbase.toLowerCase() === base.toLowerCase()) why = "case-insensitive filename match";
    if (why) out.push({ path: cp, why });
  }
  return out.slice(0, 5);
}

/**
 * Where a real symbol actually lives. The archived failure mode is a real
 * symbol name attached to a nonexistent same-named file, so naming the true
 * location is the correction that matters.
 */
export async function locateSymbols(names = []) {
  const out = [];
  for (const name of names) {
    if (!name) continue;
    try {
      const { symbolLookup } = await import("../retrieve/hybrid.mjs");
      const r = symbolLookup(name);
      const hit = (r.hits || [])[0];
      if (hit?.path) out.push({ symbol: name, path: hit.path, kind: hit.kind || "symbol" });
      else out.push({ symbol: name, path: null });
    } catch {
      out.push({ symbol: name, path: null });
    }
  }
  return out;
}

/**
 * Build a correction packet. Compact by construction: callers pass only the
 * evidence relevant to the one failure being corrected.
 */
export function buildCorrectionPacket({
  kind,
  failedGate,
  expected,
  observed,
  missingFields = [],
  invalidReferences = [],
  nearestValid = [],
  symbolLocations = [],
  allowedPaths = [],
  forbiddenPaths = [],
  evidence = "",
  requiredAction,
  prohibited = [],
  retriesUsed = 0,
  retryBudget = 1,
  priorOutput = "",
} = {}) {
  const parts = [];
  parts.push("=== CORRECTION PACKET (deterministic gate output) ===");
  parts.push(line("FAILURE_CLASS", kind));
  parts.push(line("FAILED_GATE", failedGate));
  parts.push(section("WHAT_WAS_EXPECTED", expected));
  parts.push(section("WHAT_WAS_OBSERVED", observed));

  if (missingFields.length) parts.push(line("EXACT_MISSING_FIELDS", missingFields.join(", ")));

  if (invalidReferences.length) {
    parts.push(section(
      "INVALID_REFERENCES",
      invalidReferences.map((r) => `- ${typeof r === "string" ? r : r.path} — ${typeof r === "string" ? "no such path in repository" : r.why || "no such path in repository"}`).join("\n"),
    ));
  }
  if (nearestValid.length) {
    parts.push(section(
      "NEAREST_VALID_REFERENCES",
      nearestValid.map((r) => `- ${r.path} (${r.why})`).join("\n"),
    ));
  }
  if (symbolLocations.length) {
    parts.push(section(
      "VERIFIED_SYMBOL_LOCATIONS",
      symbolLocations.map((s) => (s.path ? `- ${s.symbol} is defined in ${s.path}` : `- ${s.symbol}: not found in the index`)).join("\n"),
    ));
  }
  if (allowedPaths.length) parts.push(section("ALLOWED_PATHS", allowedPaths.map((p) => `- ${p}`).join("\n")));
  if (forbiddenPaths.length) parts.push(section("FORBIDDEN_PATHS", forbiddenPaths.map((p) => `- ${p}`).join("\n")));
  if (evidence) parts.push(section("RELEVANT_EVIDENCE", CLIP(evidence, 3000)));

  parts.push(section("REQUIRED_NEXT_ACTION", requiredAction));
  if (prohibited.length) parts.push(section("PROHIBITED_NEXT_ACTIONS", prohibited.map((p) => `- ${p}`).join("\n")));
  parts.push(line("RETRY_BUDGET", `${retriesUsed} of ${retryBudget} used`));
  if (priorOutput) parts.push(section("YOUR_PREVIOUS_OUTPUT (reshape this; do not redo the analysis)", CLIP(priorOutput, 6000)));

  return parts.filter(Boolean).join("").trim();
}

/** Critic contract shape, shared by the prompt and the format-repair path. */
export const CRITIC_CONTRACT = `INSPECTED: <real repo paths or symbols you examined, comma separated>
RISK: <one plausible regression you actually investigated>
EVIDENCE: <what you checked that makes the risk acceptable, or why it is not>
VERDICT: PASS|FAIL|BLOCK`;

/**
 * Format-only correction. The model keeps its own analysis and only reshapes
 * it. It is explicitly told to write MISSING rather than invent evidence,
 * which keeps a cheap reformat from becoming a fabrication vector.
 */
export function criticFormatPacket({ gate, criticText, missingFields = [], retriesUsed = 0, retryBudget = 1, verdictWords = "PASS, FAIL, or BLOCK" } = {}) {
  const fields = missingFields.length ? missingFields : ["VERDICT"];
  const withSubstance = fields.filter((f) => hasSubstanceFor(f, criticText));
  const withoutSubstance = fields.filter((f) => !withSubstance.includes(f));

  const observedBits = [];
  if ((gate?.errors || []).length) observedBits.push(`gate errors: ${gate.errors.join(", ")}`);
  observedBits.push(`your output was ${String(criticText || "").length} chars and did not contain the required field(s) in machine-readable form`);
  if (withSubstance.length) {
    observedBits.push(`your text DOES appear to contain the substance for: ${withSubstance.join(", ")} — it is only missing the labelled line`);
  }

  const prohibited = [
    "Do not re-investigate the repository.",
    "Do not revise your judgement.",
    "Do not add new findings.",
    "Do not invent evidence. If a required field has no support in your previous output, write exactly: MISSING",
  ];

  return buildCorrectionPacket({
    kind: TUTOR.CRITIC_FORMAT,
    failedGate: "critic output contract",
    expected: `Exactly these labelled lines, each on its own line:\n${CRITIC_CONTRACT.replace("PASS or FAIL", verdictWords)}`,
    observed: observedBits.join("\n"),
    missingFields: fields,
    requiredAction:
      `Re-emit your SAME review, unchanged in substance, with the missing field(s) added as labelled lines: ${fields.join(", ")}.`
      + (withoutSubstance.length ? `\nFor ${withoutSubstance.join(", ")} you have no supporting content — write the label followed by MISSING.` : "")
      + `\nWrite the verdict on its own line with no backticks.`
      + `\nYOUR FINAL LINE MUST BE EXACTLY ONE OF:\nVERDICT: PASS\nVERDICT: FAIL\nVERDICT: BLOCK`,
    prohibited,
    retriesUsed,
    retryBudget,
    priorOutput: criticText,
  });
}

/** When there is no approve/reject substance, do not invent a verdict. */
/**
 * Correction for a critic that produced no inspected-file evidence.
 *
 * Unlike the needs-evidence packet, this one REQUIRES tool use — the failure is
 * that nothing was inspected, so forbidding inspection makes it unwinnable.
 * Targets come from the mission's own authorized paths so the critic does not
 * survey the repository.
 */
export function criticEvidenceGatherPacket({ gate, criticText, targets = [], retriesUsed = 0, retryBudget = 1 } = {}) {
  return buildCorrectionPacket({
    kind: PLAN_CRITIC_ACTION.EVIDENCE_REPAIR,
    failedGate: "critic inspected-file evidence",
    expected: "A critic review naming at least one repository file it actually inspected, under INSPECTED.",
    observed: [
      (gate?.errors || []).length ? `gate errors: ${gate.errors.join(", ")}` : "",
      "The review named no inspected file, so its evidence could not be verified.",
    ].filter(Boolean).join("\n"),
    missingFields: ["INSPECTED"],
    allowedPaths: targets,
    requiredAction:
      `Inspect the authorized target(s) with Kill Chain MCP first (killchain_search, killchain_symbol, or killchain_context_pack): ${targets.join(", ")}. `
      + "Gather only the evidence needed to review this plan. "
      + "Then re-emit the review with labelled INSPECTED, RISK, EVIDENCE and VERDICT lines. "
      + "List a file under INSPECTED only if you actually opened it — do not guess, and do not invent a PASS.",
    prohibited: [
      "Do not re-plan or propose a different approach.",
      "Do not survey the whole repository.",
      "Do not start with bash, grep, sed, awk, head, tail or find.",
      "Do not list a file under INSPECTED that you did not open.",
      "Do not invent a PASS.",
    ],
    retriesUsed,
    retryBudget,
    priorOutput: criticText,
  });
}

export function criticNeedsEvidencePacket({ gate, criticText, retriesUsed = 0, retryBudget = 1 } = {}) {
  return buildCorrectionPacket({
    kind: PLAN_CRITIC_ACTION.NEEDS_MORE_EVIDENCE,
    failedGate: "critic verdict substance",
    expected: "A critic review of the plan with INSPECTED, RISK, EVIDENCE, and a final line VERDICT: PASS|FAIL|BLOCK.",
    observed: [
      (gate?.errors || []).length ? `gate errors: ${gate.errors.join(", ")}` : "",
      "Previous output had no parseable VERDICT and no approve/reject recommendation.",
      "Format-repair would have to invent a verdict, which is forbidden.",
    ].filter(Boolean).join("\n"),
    missingFields: ["VERDICT"],
    requiredAction:
      "Review the PLAN already provided. Emit labelled INSPECTED, RISK, EVIDENCE, and VERDICT lines. "
      + "If the PLAN is not a real structured plan, VERDICT must be FAIL. "
      + "If a field has no support, write MISSING. Never invent a PASS.",
    prohibited: [
      "Do not re-investigate the repository.",
      "Do not call tools.",
      "Do not edit files.",
      "Do not invent a PASS.",
      "Do not restart the plan from scratch.",
    ],
    retriesUsed,
    retryBudget,
    priorOutput: criticText,
  });
}

/** Invalid path/symbol correction, with verified alternatives. */
export function referencePacket({ invalid = [], nearest = [], symbols = [], allowedPaths = [], retriesUsed = 0, retryBudget = 1 } = {}) {
  return buildCorrectionPacket({
    kind: TUTOR.INVALID_REFERENCE,
    failedGate: "repository reference existence check",
    expected: "Every path you cite as an inspect or edit target must exist in the repository. A real symbol name does not imply a same-named file.",
    observed: `${invalid.length} cited path(s) do not exist.`,
    invalidReferences: invalid,
    nearestValid: nearest,
    symbolLocations: symbols,
    allowedPaths,
    requiredAction:
      "Revise using only verified targets. If you meant a symbol, cite the file it is actually defined in (listed above). "
      + "If you cannot verify a target, search for it first, and if it still does not exist, say so explicitly instead of substituting a plausible name.",
    prohibited: [
      "Do not invent a replacement path.",
      "Do not assume a component lives in a file named after it.",
      "Do not widen scope to create the missing file.",
    ],
    retriesUsed,
    retryBudget,
  });
}

/** Scope correction. Never silently broadens the allowlist. */
export function scopePacket({ unauthorized = [], allowedPaths = [], forbiddenPaths = [], delta = "", goalRequiresExpansion = false, retriesUsed = 0, retryBudget = 1 } = {}) {
  return buildCorrectionPacket({
    kind: TUTOR.SCOPE,
    failedGate: "mission scope (allowedPaths)",
    expected: "Write targets must fall inside allowedPaths.",
    observed: `Unauthorized write target(s): ${unauthorized.map((u) => (typeof u === "string" ? u : u.path)).join(", ")}`,
    allowedPaths,
    forbiddenPaths,
    evidence: delta ? `PHASE DELTA:\n${delta}` : "",
    requiredAction: goalRequiresExpansion
      ? "The stated goal cannot be achieved inside the authorized paths. Do not expand scope. State plainly that the mission requires additional authorization and stop."
      : "Revise your change so it only touches authorized paths. If the goal genuinely cannot be achieved within them, say so explicitly instead of editing elsewhere.",
    prohibited: [
      "Do not edit any path not listed under ALLOWED_PATHS.",
      "Do not create new files outside ALLOWED_PATHS.",
      "Do not assume authorization was implied by the goal.",
    ],
    retriesUsed,
    retryBudget,
  });
}

/**
 * Empty-edit correction. Deliberately terse and imperative: the archived
 * failure is a model that treats an execution phase as a writing assignment.
 */
export function emptyEditPacket({ proposalSummary = "", expectedFiles = [], retriesUsed = 0, retryBudget = 1 } = {}) {
  return buildCorrectionPacket({
    kind: TUTOR.EMPTY_EDIT,
    failedGate: "apply discipline (phase delta)",
    expected: `Nonzero file delta in: ${expectedFiles.join(", ") || "the approved target file(s)"}`,
    observed: "ACTUAL DELTA: ZERO BYTES. No file was modified. You described the change instead of applying it.",
    evidence: proposalSummary ? `APPROVED CHANGE (already reviewed — do not revisit):\n${CLIP(proposalSummary, 2000)}` : "",
    allowedPaths: expectedFiles,
    requiredAction:
      "THIS IS AN EXECUTION RETRY. Call an edit/write tool now and apply the approved change to the file(s) above. "
      + "Your only deliverable is a modified file.",
    prohibited: [
      "Do not analyze.",
      "Do not explain your reasoning.",
      "Do not write a PLAN, PROPOSAL, or summary file.",
      "Do not re-derive the change — it is already approved.",
      "Do not finish without calling a mutation tool.",
    ],
    retriesUsed,
    retryBudget,
  });
}

/** Validation correction: localized, never a raw build dump. */
export function validationPacket({
  primary = "",
  related = [],
  files = [],
  windows = "",
  delta = "",
  lastValidSnapshot = "",
  repairScope = [],
  structure = "",
  retriesUsed = 0,
  retryBudget = 1,
} = {}) {
  const relatedTrimmed = related.slice(0, 8);
  return buildCorrectionPacket({
    kind: TUTOR.VALIDATION,
    failedGate: "validation (syntax/typecheck/build)",
    expected: "Validation passes with no new diagnostics.",
    observed: [
      primary ? `PRIMARY FAILURE:\n${primary}` : "",
      relatedTrimmed.length ? `RELATED (${related.length} total, showing ${relatedTrimmed.length}):\n${relatedTrimmed.map((r) => `- ${r}`).join("\n")}` : "",
    ].filter(Boolean).join("\n"),
    evidence: [
      files.length ? `FILES: ${files.join(", ")}` : "",
      windows ? `MINIMAL SOURCE WINDOWS:\n${CLIP(windows, 4000)}` : "",
      structure ? CLIP(structure, 6000) : "",
      delta ? `PHASE DELTA:\n${CLIP(delta, 1500)}` : "",
      lastValidSnapshot ? `LAST KNOWN VALID SNAPSHOT: ${lastValidSnapshot}` : "",
    ].filter(Boolean).join("\n\n"),
    allowedPaths: repairScope,
    requiredAction:
      "Repair the primary failure only. Make the smallest edit that resolves it. "
      + "If the primary failure is a delimiter imbalance, correct the imbalance rather than rewriting the block.",
    prohibited: [
      "Do not refactor.",
      "Do not reformat unrelated lines.",
      "Do not address the related diagnostics unless they share the primary cause.",
      "Do not rewrite the whole file.",
    ],
    retriesUsed,
    retryBudget,
  });
}

/**
 * Substantive critic failure: the critic found something real. Ask for the
 * specific missing evidence rather than resending the phase.
 */
export function substantivePacket({ verdict = "", findings = [], acceptanceGaps = [], retriesUsed = 0, retryBudget = 1 } = {}) {
  return buildCorrectionPacket({
    kind: TUTOR.CRITIC_SUBSTANTIVE,
    failedGate: "critic substantive review",
    expected: "Every acceptance criterion is supported by evidence, and no unaddressed regression remains.",
    observed: [
      verdict ? `Critic verdict: ${verdict}` : "",
      findings.length ? `Findings:\n${findings.slice(0, 6).map((f) => `- ${f}`).join("\n")}` : "",
      acceptanceGaps.length ? `Unproven acceptance criteria:\n${acceptanceGaps.map((a) => `- ${a}`).join("\n")}` : "",
    ].filter(Boolean).join("\n"),
    requiredAction:
      "Address the findings above specifically. For each, either change the implementation or supply the evidence that disproves the concern. "
      + "Do not restate the plan.",
    prohibited: [
      "Do not dismiss a finding without evidence.",
      "Do not broaden the change to satisfy a critic concern that is out of scope — say it is out of scope instead.",
    ],
    retriesUsed,
    retryBudget,
  });
}
