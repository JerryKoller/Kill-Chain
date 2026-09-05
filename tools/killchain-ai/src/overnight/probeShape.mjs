/**
 * Truthful Singularity pipeline labels.
 * Context acquisition is not the same as the raymarch executing.
 */

export const PIPELINE_STAGES = ["SCENE", "BRIGHT", "BLUR", "COMPOSITE"];

/**
 * WebGL info logs often contain NUL / C0 controls. OpenCode spawn rejects NUL
 * in argv. Strip those bytes; keep printable compiler text, tabs, and newlines.
 */
export function sanitizeGlText(s) {
  return String(s ?? "")
    .replace(/\u0000/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Walk JSON-like values and sanitize every string (logs, windows, labels). */
export function sanitizeGlTree(value, depth = 0) {
  if (depth > 12) return value;
  if (typeof value === "string") return sanitizeGlText(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeGlTree(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeGlTree(v, depth + 1);
  return out;
}

export function stringifyGlSafe(value, space = 2) {
  return `${JSON.stringify(sanitizeGlTree(value), null, space)}\n`;
}

export const EMPTY_PROBE = {
  WEBGL2_CONTEXT_OK: false,
  SCENE_SHADER_COMPILE_OK: false,
  SCENE_PROGRAM_LINK_OK: false,
  BRIGHT_PROGRAM_LINK_OK: false,
  BLUR_PROGRAM_LINK_OK: false,
  COMPOSITE_PROGRAM_LINK_OK: false,
  FRAMEBUFFER_ALLOC_OK: false,
  SCENE_PASS_EXECUTED: false,
  BRIGHT_PASS_EXECUTED: false,
  BLUR_PASS_EXECUTED: false,
  COMPOSITE_PASS_EXECUTED: false,
  FALLBACK_USED: true,
  firstFail: null,
  draws: { scene: 0, bright: 0, blur: 0, composite: 0, other: 0, total: 0 },
  shaders: [],
  programs: [],
  framebuffers: [],
  glErrors: [],
};

export function realPipelineExecuted(probe) {
  const p = probe || {};
  return PIPELINE_STAGES.every((s) => p[`${s}_PASS_EXECUTED`] === true);
}

export function truthFromProbe(probe, { webgl2Got } = {}) {
  const p = probe && typeof probe === "object" ? probe : {};
  const contextOk = webgl2Got === true || p.WEBGL2_CONTEXT_OK === true;
  const real = realPipelineExecuted(p);
  const fallbackUsed = p.FALLBACK_USED === true || (contextOk && !real) || !contextOk;
  return {
    contextOk,
    realPipeline: real,
    fallbackUsed,
    firstFail: p.firstFail ? sanitizeGlTree(p.firstFail) : null,
    label: !contextOk ? "NO_WEBGL2_CONTEXT" : real ? "REAL_WEBGL2" : "FALLBACK",
  };
}

export function describeFirstFail(probe) {
  const f = probe?.firstFail;
  if (!f) return "none recorded";
  const stage = f.stage || "unknown";
  const log = sanitizeGlText(f.log).replace(/\s+/g, " ").trim().slice(0, 400);
  return log ? `${stage}: ${log}` : stage;
}
