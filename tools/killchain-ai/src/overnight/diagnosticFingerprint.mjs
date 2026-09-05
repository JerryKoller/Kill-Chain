/**
 * Compiler-driven progress: stage name equality is not "no progress".
 * Fingerprint the sanitized diagnostic set (idents, messages, lines).
 */
import { sanitizeGlText } from "./probeShape.mjs";

const ERROR_RE = /ERROR:\s*(\d+):(\d+):\s*(?:'([^']*)'\s*:)?\s*(.*)/gi;

function normalizeMessage(msg) {
  return sanitizeGlText(msg)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseGlDiagnostics(log) {
  const text = sanitizeGlText(log);
  const items = [];
  ERROR_RE.lastIndex = 0;
  let m;
  while ((m = ERROR_RE.exec(text))) {
    const ident = sanitizeGlText(m[3] || "").trim();
    const message = sanitizeGlText(m[4] || "").replace(/\s+/g, " ").trim();
    const line = Number(m[2]);
    const column = Number(m[1]);
    items.push({
      column: Number.isFinite(column) ? column : 0,
      line: Number.isFinite(line) ? line : 0,
      ident,
      message,
      key: `${Number.isFinite(line) ? line : 0}|${ident.toLowerCase()}|${normalizeMessage(message)}`,
    });
  }
  return items;
}

export function diagnosticFingerprint({ stage = "", log = "", compileOk = false } = {}) {
  const items = parseGlDiagnostics(log);
  const keys = [...new Set(items.map((i) => i.key))].sort();
  const idents = [...new Set(items.map((i) => i.ident).filter(Boolean))];
  const lines = items.map((i) => i.line).filter((n) => Number.isFinite(n) && n > 0);
  return {
    stage: String(stage || ""),
    compileOk: Boolean(compileOk),
    count: items.length,
    primary: items[0] || null,
    minLine: lines.length ? Math.min(...lines) : null,
    maxLine: lines.length ? Math.max(...lines) : null,
    idents,
    keys,
    signature: `${String(stage || "")}::${keys.join(";")}`,
    items,
  };
}

function identSet(fp) {
  return new Set((fp?.idents || []).map((s) => String(s).toLowerCase()));
}

function keySet(fp) {
  return new Set(fp?.keys || []);
}

/**
 * Compare two fingerprints.
 * SUCCESS only if the after snapshot actually compiled.
 * Same stage name with a changed diagnostic set can still be PROGRESS.
 */
export function compareDiagnostics(beforeIn, afterIn) {
  const before = beforeIn?.signature != null ? beforeIn : diagnosticFingerprint(beforeIn || {});
  const after = afterIn?.signature != null ? afterIn : diagnosticFingerprint(afterIn || {});
  const reasons = [];

  if (after.compileOk) {
    return { kind: "SUCCESS", progress: true, success: true, unchanged: false, regress: false, reasons: ["compile ok"] };
  }
  if (before.compileOk && !after.compileOk) {
    return { kind: "REGRESS", progress: false, success: false, unchanged: false, regress: true, reasons: ["compile became failing"] };
  }
  if (after.signature === before.signature) {
    return { kind: "UNCHANGED", progress: false, success: false, unchanged: true, regress: false, reasons: ["same diagnostic signature"] };
  }

  const beforeKeys = keySet(before);
  const afterKeys = keySet(after);
  const beforeIdents = identSet(before);
  const afterIdents = identSet(after);
  const primaryKey = before.primary?.key;
  const primaryIdent = String(before.primary?.ident || "").toLowerCase();
  const primaryGone = Boolean(primaryKey)
    && !afterKeys.has(primaryKey)
    && !(primaryIdent && afterIdents.has(primaryIdent));
  const lineAdvanced = before.minLine != null && after.minLine != null && after.minLine > before.minLine;
  const lineEarlier = before.minLine != null && after.minLine != null && after.minLine < before.minLine;
  const countDown = after.count < before.count;
  const countUp = after.count > before.count;
  const identShift = [...beforeIdents].sort().join(",") !== [...afterIdents].sort().join(",");

  if (lineEarlier && !primaryGone) {
    reasons.push(`failure moved earlier (${before.minLine} → ${after.minLine})`);
    return { kind: "REGRESS", progress: false, success: false, unchanged: false, regress: true, reasons };
  }
  if (!primaryGone && countUp && !lineAdvanced) {
    reasons.push(`error count increased (${before.count} → ${after.count}) without advancing`);
    return { kind: "REGRESS", progress: false, success: false, unchanged: false, regress: true, reasons };
  }

  if (primaryGone) reasons.push("primary diagnostic disappeared");
  if (lineAdvanced) reasons.push(`min line ${before.minLine} → ${after.minLine}`);
  if (countDown) reasons.push(`count ${before.count} → ${after.count}`);
  if (identShift) reasons.push("identifier set changed");

  if (primaryGone || lineAdvanced || countDown || identShift) {
    return { kind: "PROGRESS", progress: true, success: false, unchanged: false, regress: false, reasons };
  }
  return {
    kind: "UNCHANGED",
    progress: false,
    success: false,
    unchanged: true,
    regress: false,
    reasons: reasons.length ? reasons : ["signature changed but not classified as forward"],
  };
}

export function fingerprintFromProbe(probe) {
  const p = probe || {};
  const fail = p.firstFail || {};
  const compileOk = p.SCENE_SHADER_COMPILE_OK === true;
  return diagnosticFingerprint({
    stage: fail.stage || (compileOk ? "SCENE_SHADER_COMPILE" : ""),
    log: fail.log || "",
    compileOk,
  });
}

/** Overnight regression fixtures (sanitized copies of the real compiler trail). */
export const OVERNIGHT_LET_LOG = "ERROR: 0:58: 'let' : undeclared identifier\nERROR: 0:58: 'targetX' : syntax error\n\u0000";
export const OVERNIGHT_RO_DT_LOG = "ERROR: 0:61: 'ro' : undeclared identifier\nERROR: 0:61: 'ro' : undeclared identifier\nERROR: 0:61: 'z' : field selection requires structure, vector, or interface block on left hand side\nERROR: 0:61: 'dt' : undeclared identifier\nERROR: 0:61: 'mix' : no matching overloaded function found\nERROR: 0:61: 'assign' : l-value required (can't modify a const)\n";
