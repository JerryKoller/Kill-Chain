/**
 * Local VISUAL critic.
 *
 * Empirically established during setup (do not re-derive from assumptions):
 *
 *   Through OpenCode's tool path, qwen3.5:9b CANNOT see images. Asked to
 *   inspect a JPEG with its `read` tool it read the bytes and correctly
 *   answered "CANNOT_SEE_IMAGES". So the AGENT has no visual judgement.
 *
 *   Through Ollama's /api/generate with an `images: [base64]` field, the SAME
 *   model does see the picture. Handed the Robo Puppy avatar it replied
 *   "a robotic puppy with glowing green eyes".
 *
 * Therefore the visual critic must be a FOREMAN-driven step that calls Ollama
 * directly, not a tool the agent invokes. The agent proposes and edits; the
 * foreman looks at the result.
 *
 * This is a screening critic. It is a 9B model looking at a screenshot: good
 * for "is the frame black / empty / blown out / did the core disappear", not
 * a substitute for human aesthetic judgement. The human remains the final
 * arbiter, with Cursor as senior visual critic in between.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const OLLAMA = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const VISION_MODEL = process.env.KC_VISION_MODEL || "qwen3.5:9b";

/** Does the configured local model report a vision capability? */
export async function visionAvailable({ model = VISION_MODEL } = {}) {
  try {
    const r = await fetch(`${OLLAMA}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
    });
    if (!r.ok) return { ok: false, reason: `ollama /api/show ${r.status}` };
    const j = await r.json();
    const caps = j.capabilities || [];
    return { ok: caps.includes("vision"), capabilities: caps, model };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * The screening questions. Deliberately closed-form and mechanical: a small
 * model is far more reliable answering "is this frame mostly black" than
 * "is this beautiful".
 */
export const SCREEN_CONTRACT = `Answer EXACTLY these lines and nothing else.

VISIBLE: <YES or NO — is there any clearly visible subject, or is the frame essentially empty/black?>
BRIGHT_CORE: <YES or NO — is there a bright concentrated core or focal point?>
BLOWN_OUT: <YES or NO — is a large area pure white / clipped?>
COLOR: <two or three words for the dominant colours>
DETAIL: <LOW, MEDIUM or HIGH — how much fine structure/detail is present?>
DEPTH: <YES or NO — does the image read as three-dimensional rather than flat?>
NOTE: <one short sentence describing what you actually see>`;

function parseScreen(text) {
  const get = (k) => {
    const m = String(text || "").match(new RegExp(`^${k}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : null;
  };
  const yn = (v) => (v == null ? null : /^y/i.test(v));
  return {
    visible: yn(get("VISIBLE")),
    brightCore: yn(get("BRIGHT_CORE")),
    blownOut: yn(get("BLOWN_OUT")),
    color: get("COLOR"),
    detail: (get("DETAIL") || "").toUpperCase() || null,
    depth: yn(get("DEPTH")),
    note: get("NOTE"),
    raw: String(text || ""),
  };
}

/**
 * Screen one screenshot.
 * @param {string} pngPath
 */
export async function screenImage(pngPath, { model = VISION_MODEL, prompt = SCREEN_CONTRACT, timeoutMs = 120000 } = {}) {
  if (!existsSync(pngPath)) return { ok: false, reason: `missing image ${pngPath}` };
  const images = [readFileSync(pngPath).toString("base64")];
  const ctl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, images, stream: false }),
      signal: ctl,
    });
    if (!r.ok) return { ok: false, reason: `ollama /api/generate ${r.status}` };
    const j = await r.json();
    return { ok: true, image: basename(pngPath), model, ...parseScreen(j.response) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Deterministic sanity gate on a screened frame.
 *
 * This is the part that can safely be automatic: it rejects frames that are
 * objectively broken rather than merely ugly. Taste is not automated.
 */
export function screenVerdict(screen, { requireCore = true } = {}) {
  const fails = [];
  if (!screen?.ok) return { pass: false, fails: [`vision unavailable: ${screen?.reason || "unknown"}`] };
  if (screen.visible === false) fails.push("frame appears empty or black");
  if (requireCore && screen.brightCore === false) fails.push("no bright focal core — Singularity's defining feature may be gone");
  if (screen.blownOut === true) fails.push("large clipped/blown-out region");
  if (screen.detail === "LOW") fails.push("very little fine structure");
  return { pass: fails.length === 0, fails, screen };
}

/**
 * Compare two screened frames. Reports movement, not preference: whether the
 * candidate lost something the baseline had.
 */
export function compareScreens(baseline, candidate) {
  const lost = [];
  const gained = [];
  const pairs = [["visible", "visible subject"], ["brightCore", "bright core"], ["depth", "depth cue"]];
  for (const [k, label] of pairs) {
    if (baseline?.[k] === true && candidate?.[k] === false) lost.push(label);
    if (baseline?.[k] === false && candidate?.[k] === true) gained.push(label);
  }
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  if (baseline?.detail && candidate?.detail && rank[candidate.detail] < rank[baseline.detail]) lost.push("fine detail");
  if (baseline?.detail && candidate?.detail && rank[candidate.detail] > rank[baseline.detail]) gained.push("fine detail");
  if (candidate?.blownOut === true && baseline?.blownOut !== true) lost.push("headroom (now clipping)");
  return { lost, gained, regressed: lost.length > 0 };
}
