/**
 * Structured supervisor protocol.
 *
 * Arbitrary prose is not the control protocol. A supervisor call only counts
 * when it produces a result that survives strict validation.
 *
 * Two rules matter more than the rest:
 *   1. A malformed response can never become a silent PASS/KEEP. There is no
 *      default decision anywhere in this file.
 *   2. Cited evidence refs must resolve against the pack that was actually
 *      supplied, so a supervisor cannot ground a claim on something it invented.
 *
 * Validation style matches the rest of the tooling: hand-rolled, returning
 * `{ ok, errors, warnings }`. No schema library is introduced.
 */
import { matchesAny, toPosixRel } from "../mission/schema.mjs";
import { groundsClaim, resolveRefs } from "./trust.mjs";

export const DECISIONS = [
  "TASK",                        // give Robo Puppy a new narrow objective
  "KEEP",                        // candidate accepted / progress is real
  "RETRY",                       // bounded retry with corrected instructions
  "REVERT",                      // candidate rejected, restore checkpoint
  "ESCALATE",                    // hand this to the deep supervisor
  "STOP",                        // safe intentional halt, needs a human
  "NEEDS_SENIOR_IMPLEMENTATION", // beyond the worker; requires human authorization
];

const DECISION_SET = new Set(DECISIONS);
/** Decisions that must carry a concrete worker objective. */
const OBJECTIVE_REQUIRED = new Set(["TASK", "RETRY"]);

export const SUPERVISOR_CONTRACT = `Reply with ONE fenced JSON object and nothing else.

\`\`\`json
{
  "decision": "TASK | KEEP | RETRY | REVERT | ESCALATE | STOP | NEEDS_SENIOR_IMPLEMENTATION",
  "reason": "why this decision follows from the evidence",
  "workerObjective": "one narrow thing Robo Puppy should do next, or null",
  "acceptance": ["deterministic, checkable criteria"],
  "trustedEvidenceRefs": ["E1"],
  "allowedPaths": ["src/some/file.ts"],
  "forbiddenPaths": [],
  "recommendedModelCalls": 6,
  "confidence": 0.0,
  "teachingLevel": 0,
  "escalationReason": null
}
\`\`\`

Rules:
- Cite only evidence refs that appear in the TRUSTED EVIDENCE section. Do not invent refs.
- Your own reasoning is not evidence. Neither is any other model's prose.
- allowedPaths must be a subset of the mission's allowed paths. Never widen scope.
- decision TASK or RETRY requires workerObjective and at least one acceptance item.
- decision ESCALATE requires escalationReason.
- confidence is your own calibrated number between 0 and 1.
- teachingLevel 0 = task only, 1 = task + exact error, 2 = + source window,
  3 = + tutor hints, 4 = deep teaching packet, 5 = senior implementation needed.
- If the evidence does not support a conclusion, say so and ESCALATE or STOP.
  Never guess to fill the schema.`;

/**
 * Pull one JSON object out of a model reply.
 *
 * Prefers a fenced ```json block, then any brace-balanced object that actually
 * contains a "decision" key. We do not fall back to "the first {" because that
 * reliably grabs a fragment out of the model's prose.
 */
export function extractJsonObject(text) {
  const raw = String(text || "");
  const candidates = [];

  const fenceRe = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(raw))) candidates.push(m[1]);

  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < raw.length; j += 1) {
      const ch = raw[j];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(raw.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }

  const parsed = [];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj === "object" && !Array.isArray(obj)) parsed.push(obj);
    } catch {
      /* not JSON; keep looking */
    }
  }
  if (!parsed.length) return null;
  return parsed.find((o) => "decision" in o) || parsed[0];
}

function asStringArray(value) {
  if (!Array.isArray(value)) return null;
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

/**
 * Strictly validate a supervisor reply.
 *
 * `errors` means the result is unusable. `formatOnly` means the shape was wrong
 * but the substance may be recoverable with one cheap repair — that flag is the
 * only thing that authorizes a second call.
 */
export function validateSupervisorResult(rawText, { pack = null, spec = null, role = null } = {}) {
  const errors = [];
  const warnings = [];
  const obj = typeof rawText === "object" && rawText !== null ? rawText : extractJsonObject(rawText);

  if (!obj) {
    return {
      ok: false,
      formatOnly: true,
      errors: ["no-json-object"],
      warnings,
      result: null,
      raw: typeof rawText === "string" ? rawText : "",
    };
  }

  const decisionRaw = String(obj.decision ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!decisionRaw) errors.push("missing-decision");
  else if (!DECISION_SET.has(decisionRaw)) errors.push(`unsupported-decision:${decisionRaw}`);

  const reason = String(obj.reason ?? "").trim();
  if (reason.length < 8) errors.push("missing-reason");

  const workerObjective = obj.workerObjective == null ? null : String(obj.workerObjective).trim() || null;
  const acceptance = asStringArray(obj.acceptance) || [];
  if (OBJECTIVE_REQUIRED.has(decisionRaw)) {
    if (!workerObjective) errors.push("missing-worker-objective");
    if (!acceptance.length) errors.push("missing-acceptance");
  }

  if (decisionRaw === "ESCALATE" && !String(obj.escalationReason ?? "").trim()) {
    errors.push("missing-escalation-reason");
  }

  const confidenceRaw = obj.confidence;
  let confidence = null;
  if (typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)) {
    confidence = Math.min(1, Math.max(0, confidenceRaw));
  } else {
    errors.push("missing-confidence");
  }

  let recommendedModelCalls = 6;
  if (obj.recommendedModelCalls != null) {
    const n = Number(obj.recommendedModelCalls);
    if (!Number.isFinite(n)) warnings.push("recommendedModelCalls-not-a-number");
    else recommendedModelCalls = Math.min(64, Math.max(1, Math.round(n)));
  }

  let teachingLevel = null;
  if (obj.teachingLevel != null) {
    const n = Number(obj.teachingLevel);
    if (Number.isFinite(n) && n >= 0 && n <= 5) teachingLevel = Math.round(n);
    else warnings.push("teachingLevel-out-of-range");
  }

  const allowedPaths = (asStringArray(obj.allowedPaths) || []).map(toPosixRel);
  const forbiddenPaths = (asStringArray(obj.forbiddenPaths) || []).map(toPosixRel);
  const trustedEvidenceRefs = asStringArray(obj.trustedEvidenceRefs) || [];

  // Trust boundary: every cited ref must exist in the pack we actually supplied.
  let evidence = { ok: true, resolved: [], missing: [] };
  if (pack) {
    evidence = resolveRefs(pack, trustedEvidenceRefs);
    if (!evidence.ok) errors.push(`unknown-evidence-refs:${evidence.missing.join(",")}`);
    if (trustedEvidenceRefs.length && reason) {
      const supported = trustedEvidenceRefs.some(
        (ref) => groundsClaim(pack, ref, reason).ok,
      );
      if (!supported && evidence.ok) warnings.push("reason-not-grounded-in-cited-evidence");
    }
  }

  // Scope may only narrow. A supervisor cannot hand the worker new territory.
  if (spec && allowedPaths.length) {
    const missionAllowed = spec.allowedPaths || [];
    const widened = allowedPaths.filter((p) => !matchesAny(p, missionAllowed));
    if (widened.length) errors.push(`scope-widened:${widened.join(",")}`);
  }

  const substantive = errors.filter((e) => !isFormatError(e));
  const formatOnly = errors.length > 0 && substantive.length === 0;

  if (errors.length) {
    return { ok: false, formatOnly, errors, warnings, result: null, raw: typeof rawText === "string" ? rawText : "" };
  }

  return {
    ok: true,
    formatOnly: false,
    errors: [],
    warnings,
    raw: typeof rawText === "string" ? rawText : "",
    result: {
      decision: decisionRaw,
      reason,
      workerObjective,
      acceptance,
      trustedEvidenceRefs,
      allowedPaths,
      forbiddenPaths,
      recommendedModelCalls,
      confidence,
      teachingLevel,
      escalationReason: obj.escalationReason == null ? null : String(obj.escalationReason).trim() || null,
      role: role || null,
    },
  };
}

/** Shape problems that one cheap repair can plausibly fix. */
const FORMAT_ERRORS = new Set([
  "no-json-object",
  "missing-decision",
  "missing-reason",
  "missing-confidence",
  "missing-acceptance",
  "missing-worker-objective",
  "missing-escalation-reason",
]);

function isFormatError(err) {
  if (FORMAT_ERRORS.has(err)) return true;
  return err.startsWith("unsupported-decision:");
}

/**
 * One cheap repair prompt. Deliberately does not restate the problem or ask for
 * new reasoning — re-running a whole reasoning session just to add a field is
 * exactly what we are avoiding.
 */
export function formatRepairPrompt(previousText, errors) {
  return `Your previous reply could not be parsed as a supervisor result.

Problems: ${errors.join(", ")}

Do NOT reconsider the decision and do NOT do more analysis.
Re-emit the SAME judgement you already made as one valid fenced JSON object.

${SUPERVISOR_CONTRACT}

Your previous reply:
---
${String(previousText || "").slice(0, 4000)}
---`;
}
