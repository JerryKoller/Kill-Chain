import type { SoundParams } from "@/audio/types";
import { NEUTRAL_PARAMS, isBipolar } from "@/audio/types";

/**
 * Adaptive A/B Tuning Engine
 * ───────────────────────────
 * Each question presents two micro-variants (A and B) built by nudging one or
 * more real DSP parameters away from the user's running profile. Picking a side
 * moves the profile a little in that direction; the magnitude shrinks over the
 * session (explore early, refine late).
 *
 * The question bank below is intentionally large and every entry is uniquely
 * worded, so a session NEVER asks the same question twice — even a 60-question
 * "deep" probe is 60 distinct questions. Questions are drawn from a per-session
 * shuffled order via a cursor, which guarantees no repeats and good spread
 * across the whole tonal space.
 */

export type AxisKey = keyof SoundParams;

/** A single parameter nudged by a question. A pushes +dir, B pushes -dir. */
export interface ProbeTarget {
  key: AxisKey;
  dir: 1 | -1;
  /** Relative strength of this target within the question (0..1). */
  weight?: number;
}

export type QuestionCategory =
  | "Low end"
  | "Mids"
  | "Highs"
  | "Dynamics"
  | "Space"
  | "Character";

export interface CalibQuestion {
  id: string;
  cat: QuestionCategory;
  /** Axis used for confidence tracking + the on-screen category label. */
  primary: AxisKey;
  prompt: string;
  hintA: string;
  hintB: string;
  targets: ProbeTarget[];
}

/**
 * The bank. 60+ uniquely-worded questions, each shaping the sound for real.
 * Single-target questions move one knob; combo questions move two for richer,
 * more musical choices. No two prompts are identical.
 */
const QUESTION_BANK: CalibQuestion[] = [
  // ───────────── LOW END ─────────────
  { id: "sub-bigger", cat: "Low end", primary: "subBass", prompt: "Which version feels bigger down low?", hintA: "Room-shaking rumble", hintB: "Tight, controlled lows", targets: [{ key: "subBass", dir: 1 }] },
  { id: "sub-depth", cat: "Low end", primary: "subBass", prompt: "How deep should the foundation reach?", hintA: "Cinema-deep sub", hintB: "Lean, shallow floor", targets: [{ key: "subBass", dir: 1 }] },
  { id: "sub-feel", cat: "Low end", primary: "subBass", prompt: "Sub-bass: felt in your chest or just tidy?", hintA: "You feel it physically", hintB: "Neat and restrained", targets: [{ key: "subBass", dir: 1 }] },
  { id: "bass-groove", cat: "Low end", primary: "bass", prompt: "Which groove makes you want to move?", hintA: "Full, round bass", hintB: "Lean, fast bass", targets: [{ key: "bass", dir: 1 }] },
  { id: "bass-weight", cat: "Low end", primary: "bass", prompt: "Pick the low-end weight you like.", hintA: "Heavier, thicker bass", hintB: "Lighter, nimble bass", targets: [{ key: "bass", dir: 1 }] },
  { id: "bass-kick", cat: "Low end", primary: "bass", prompt: "How should the kick drum land?", hintA: "Big and boomy", hintB: "Tight and dry", targets: [{ key: "bass", dir: 1 }] },
  { id: "warm-cozy", cat: "Low end", primary: "warmth", prompt: "Which feels warmer?", hintA: "Warm, rich mids", hintB: "Cool, airy mids", targets: [{ key: "warmth", dir: 1 }] },
  { id: "warm-temp", cat: "Low end", primary: "warmth", prompt: "Pick the tonal temperature.", hintA: "Warm and rounded", hintB: "Crisp and cool", targets: [{ key: "warmth", dir: 1 }] },
  { id: "warm-full", cat: "Low end", primary: "warmth", prompt: "Lower mids: velvety or clean?", hintA: "Velvety and full", hintB: "Clean and open", targets: [{ key: "warmth", dir: 1 }] },
  { id: "body-fuller", cat: "Low end", primary: "body", prompt: "Which has more body?", hintA: "Thick and full", hintB: "Lean, less mud", targets: [{ key: "body", dir: 1 }] },
  { id: "body-weight", cat: "Low end", primary: "body", prompt: "How much weight in the low-mids?", hintA: "Weighty and solid", hintB: "Light and quick", targets: [{ key: "body", dir: 1 }] },
  { id: "low-warm-combo", cat: "Low end", primary: "bass", prompt: "Overall low-end vibe?", hintA: "Big and warm", hintB: "Tight and neutral", targets: [{ key: "bass", dir: 1, weight: 0.7 }, { key: "warmth", dir: 1, weight: 0.6 }] },
  { id: "low-clean-combo", cat: "Low end", primary: "body", prompt: "Bass cleanliness?", hintA: "Lush, blooming low end", hintB: "Dry, articulate low end", targets: [{ key: "bass", dir: 1, weight: 0.6 }, { key: "body", dir: 1, weight: 0.6 }] },
  { id: "sub-vs-bass", cat: "Low end", primary: "subBass", prompt: "Where do you want the low-end weight?", hintA: "Deep sub floor", hintB: "Mid-bass punch", targets: [{ key: "subBass", dir: 1, weight: 0.8 }, { key: "bass", dir: -1, weight: 0.6 }] },

  // ───────────── MIDS ─────────────
  { id: "mid-fuller", cat: "Mids", primary: "mid", prompt: "Which sounds fuller in the middle?", hintA: "Rich, full mids", hintB: "Scooped, V-shaped", targets: [{ key: "mid", dir: 1 }] },
  { id: "mid-balance", cat: "Mids", primary: "mid", prompt: "Midrange balance?", hintA: "Present, forward mids", hintB: "Recessed mids", targets: [{ key: "mid", dir: 1 }] },
  { id: "mid-box", cat: "Mids", primary: "mid", prompt: "Boxy or open midrange?", hintA: "Full and forward", hintB: "Open and scooped", targets: [{ key: "mid", dir: 1 }] },
  { id: "voc-stand", cat: "Mids", primary: "vocals", prompt: "Where should the singer stand?", hintA: "Up front", hintB: "Back in the mix", targets: [{ key: "vocals", dir: 1 }] },
  { id: "voc-intimate", cat: "Mids", primary: "vocals", prompt: "Which vocal placement feels right?", hintA: "Intimate and close", hintB: "Blended and distant", targets: [{ key: "vocals", dir: 1 }] },
  { id: "voc-lead", cat: "Mids", primary: "vocals", prompt: "Should voices lead the band?", hintA: "Voices lead", hintB: "Voices sit in the band", targets: [{ key: "vocals", dir: 1 }] },
  { id: "pres-artic", cat: "Mids", primary: "presence", prompt: "Which feels more articulate?", hintA: "Forward presence", hintB: "Relaxed presence", targets: [{ key: "presence", dir: 1 }] },
  { id: "pres-bite", cat: "Mids", primary: "presence", prompt: "How much bite on guitars and snares?", hintA: "Edgy and present", hintB: "Smooth and easy", targets: [{ key: "presence", dir: 1 }] },
  { id: "clar-clear", cat: "Mids", primary: "clarity", prompt: "Which sounds clearer?", hintA: "More definition", hintB: "More relaxed", targets: [{ key: "clarity", dir: 1 }] },
  { id: "clar-detail", cat: "Mids", primary: "clarity", prompt: "Upper mids: detail or ease?", hintA: "Crisp detail", hintB: "Gentle and forgiving", targets: [{ key: "clarity", dir: 1 }] },
  { id: "voc-clar-combo", cat: "Mids", primary: "vocals", prompt: "How clear should dialogue and vocals be?", hintA: "Crystal-clear and upfront", hintB: "Soft and laid-back", targets: [{ key: "vocals", dir: 1, weight: 0.7 }, { key: "clarity", dir: 1, weight: 0.6 }] },
  { id: "mid-shape-combo", cat: "Mids", primary: "mid", prompt: "Pick the overall midrange shape.", hintA: "Mid-forward and full", hintB: "Smiley V-shape", targets: [{ key: "mid", dir: 1, weight: 0.7 }, { key: "vocals", dir: 1, weight: 0.5 }] },
  { id: "pres-clar-combo", cat: "Mids", primary: "presence", prompt: "The detail region — sharp or smooth?", hintA: "Sharp and articulate", hintB: "Smooth and round", targets: [{ key: "presence", dir: 1, weight: 0.6 }, { key: "clarity", dir: 1, weight: 0.6 }] },
  { id: "warm-vs-clar", cat: "Mids", primary: "warmth", prompt: "Tone vs. clarity — which way do you lean?", hintA: "Warm and smooth", hintB: "Bright and clear", targets: [{ key: "warmth", dir: 1, weight: 0.7 }, { key: "clarity", dir: -1, weight: 0.7 }] },

  // ───────────── HIGHS ─────────────
  { id: "air-open", cat: "Highs", primary: "air", prompt: "Which feels more open up top?", hintA: "Airy and spacious", hintB: "Intimate and closed-in", targets: [{ key: "air", dir: 1 }] },
  { id: "air-headroom", cat: "Highs", primary: "air", prompt: "Top-end headroom?", hintA: "Wide-open and airy", hintB: "Controlled and contained", targets: [{ key: "air", dir: 1 }] },
  { id: "spark-char", cat: "Highs", primary: "sparkle", prompt: "Pick your top-end character.", hintA: "Bright and detailed", hintB: "Silky and smooth", targets: [{ key: "sparkle", dir: 1 }] },
  { id: "spark-cymbal", cat: "Highs", primary: "sparkle", prompt: "Cymbals and hi-hats?", hintA: "Crisp and forward", hintB: "Soft and rounded", targets: [{ key: "sparkle", dir: 1 }] },
  { id: "spark-detail", cat: "Highs", primary: "sparkle", prompt: "High-frequency detail?", hintA: "Etched and crisp", hintB: "Easy and dark", targets: [{ key: "sparkle", dir: 1 }] },
  { id: "air-spark-combo", cat: "Highs", primary: "sparkle", prompt: "Treble personality?", hintA: "Crisp and airy", hintB: "Dark and smooth", targets: [{ key: "air", dir: 1, weight: 0.7 }, { key: "sparkle", dir: 1, weight: 0.7 }] },
  { id: "deess-harsh", cat: "Highs", primary: "deEss", prompt: "Do bright tracks ever get harsh for you?", hintA: "Tame the sharp edges", hintB: "Keep the top end intact", targets: [{ key: "deEss", dir: 1, weight: 0.8 }, { key: "sparkle", dir: -1, weight: 0.4 }] },
  { id: "deess-sib", cat: "Highs", primary: "deEss", prompt: "Sibilant 'S' and 'T' sounds?", hintA: "Smooth them down", hintB: "Leave them natural", targets: [{ key: "deEss", dir: 1 }] },

  // ───────────── DYNAMICS ─────────────
  { id: "punch-hit", cat: "Dynamics", primary: "punch", prompt: "Which hits harder?", hintA: "Snappy and punchy", hintB: "Soft and rounded", targets: [{ key: "punch", dir: 1 }] },
  { id: "punch-drum", cat: "Dynamics", primary: "punch", prompt: "Drum impact?", hintA: "Tight and punchy", hintB: "Loose and natural", targets: [{ key: "punch", dir: 1 }] },
  { id: "punch-edge", cat: "Dynamics", primary: "punch", prompt: "Percussion edge?", hintA: "Crisp and immediate", hintB: "Gentle and smooth", targets: [{ key: "punch", dir: 1 }] },
  { id: "tex-lush", cat: "Dynamics", primary: "texture", prompt: "Which feels more lush?", hintA: "Long, blooming sustain", hintB: "Short and dry", targets: [{ key: "texture", dir: 1 }] },
  { id: "tex-tails", cat: "Dynamics", primary: "texture", prompt: "Note tails?", hintA: "Let them ring out", hintB: "Damped and controlled", targets: [{ key: "texture", dir: 1 }] },
  { id: "comp-glue", cat: "Dynamics", primary: "compression", prompt: "Which feels more glued together?", hintA: "Cohesive and even", hintB: "Open and dynamic", targets: [{ key: "compression", dir: 1 }] },
  { id: "comp-loud", cat: "Dynamics", primary: "compression", prompt: "Loudness consistency?", hintA: "Steady and consistent", hintB: "Breathing dynamics", targets: [{ key: "compression", dir: 1 }] },
  { id: "punch-comp-combo", cat: "Dynamics", primary: "punch", prompt: "Overall drum feel?", hintA: "Punchy and glued", hintB: "Relaxed and airy", targets: [{ key: "punch", dir: 1, weight: 0.7 }, { key: "compression", dir: 1, weight: 0.5 }] },
  { id: "attack-sustain", cat: "Dynamics", primary: "punch", prompt: "Emphasize attack or sustain?", hintA: "Sharp attack", hintB: "Rich sustain", targets: [{ key: "punch", dir: 1, weight: 0.7 }, { key: "texture", dir: -1, weight: 0.7 }] },
  { id: "dyn-control", cat: "Dynamics", primary: "compression", prompt: "Dynamics overall?", hintA: "Controlled and tight", hintB: "Natural and open", targets: [{ key: "compression", dir: 1, weight: 0.6 }, { key: "punch", dir: 1, weight: 0.4 }] },

  // ───────────── SPACE ─────────────
  { id: "width-wide", cat: "Space", primary: "width", prompt: "Which sounds wider?", hintA: "Wide stereo spread", hintB: "Focused center", targets: [{ key: "width", dir: 1 }] },
  { id: "width-stage", cat: "Space", primary: "width", prompt: "Soundstage width?", hintA: "Expansive and wide", hintB: "Tight and centered", targets: [{ key: "width", dir: 1 }] },
  { id: "spatial-head", cat: "Space", primary: "spatial", prompt: "Which feels more out-of-head?", hintA: "Speaker-like, open", hintB: "Close and direct", targets: [{ key: "spatial", dir: 1 }] },
  { id: "spatial-room", cat: "Space", primary: "spatial", prompt: "Speakers in a room, or right in your head?", hintA: "Out in the room", hintB: "Up close and personal", targets: [{ key: "spatial", dir: 1 }] },
  { id: "reverb-amt", cat: "Space", primary: "reverbAmount", prompt: "How much ambience around the music?", hintA: "Add space and air", hintB: "Dry and direct", targets: [{ key: "reverbAmount", dir: 1 }] },
  { id: "reverb-size", cat: "Space", primary: "reverbSize", prompt: "If there's space, what kind of room?", hintA: "Big, grand hall", hintB: "Small, intimate room", targets: [{ key: "reverbAmount", dir: 1, weight: 0.5 }, { key: "reverbSize", dir: 1, weight: 0.8 }] },
  { id: "width-spatial-combo", cat: "Space", primary: "width", prompt: "Stereo image?", hintA: "Surround and envelop me", hintB: "Pinpoint and focused", targets: [{ key: "width", dir: 1, weight: 0.6 }, { key: "spatial", dir: 1, weight: 0.6 }] },
  { id: "sub-width", cat: "Space", primary: "subWidth", prompt: "Low-end placement?", hintA: "Centered and powerful", hintB: "Spread the lows wide", targets: [{ key: "subWidth", dir: -1 }] },
  { id: "pres-width", cat: "Space", primary: "presenceWidth", prompt: "Width of vocals and mids?", hintA: "Wide, spacious mids", hintB: "Centered, solid mids", targets: [{ key: "presenceWidth", dir: 1 }] },
  { id: "air-width", cat: "Space", primary: "airWidth", prompt: "Width of cymbals and air?", hintA: "Spacious, wide highs", hintB: "Centered highs", targets: [{ key: "airWidth", dir: 1 }] },

  // ───────────── CHARACTER ─────────────
  { id: "harm-alive", cat: "Character", primary: "harmonics", prompt: "Which feels more alive?", hintA: "Excited harmonics", hintB: "Pure and clean", targets: [{ key: "harmonics", dir: 1 }] },
  { id: "harm-rich", cat: "Character", primary: "harmonics", prompt: "Add richness to the tone?", hintA: "Harmonically rich", hintB: "Clean and literal", targets: [{ key: "harmonics", dir: 1 }] },
  { id: "sat-char", cat: "Character", primary: "saturation", prompt: "Which has more character?", hintA: "Analog warmth and drive", hintB: "Digital clean", targets: [{ key: "saturation", dir: 1 }] },
  { id: "sat-grit", cat: "Character", primary: "saturation", prompt: "A touch of grit?", hintA: "Subtle saturation", hintB: "Pristine and clear", targets: [{ key: "saturation", dir: 1 }] },
  { id: "color-combo", cat: "Character", primary: "saturation", prompt: "Overall color?", hintA: "Warm, driven, vintage", hintB: "Transparent and modern", targets: [{ key: "harmonics", dir: 1, weight: 0.6 }, { key: "saturation", dir: 1, weight: 0.6 }] },
  { id: "lofi-age", cat: "Character", primary: "lofiAge", prompt: "Vintage character?", hintA: "Aged, tape-like warmth", hintB: "Modern and full-range", targets: [{ key: "lofiAge", dir: 1 }] },
  { id: "philosophy", cat: "Character", primary: "saturation", prompt: "Signal philosophy?", hintA: "Colored and characterful", hintB: "Clean and faithful", targets: [{ key: "saturation", dir: 1, weight: 0.5 }, { key: "harmonics", dir: 1, weight: 0.5 }] },
];

const QUESTION_BY_ID: Record<string, CalibQuestion> = Object.fromEntries(
  QUESTION_BANK.map((q) => [q.id, q]),
);

export interface AdaptiveAnswer {
  id: string;
  primary: AxisKey;
  choice: "A" | "B";
  /** Exact per-param deltas applied, so Back can reverse precisely. */
  deltas: Partial<Record<AxisKey, number>>;
  step: number;
}

export interface AdaptiveState {
  profile: SoundParams;
  confidence: Partial<Record<AxisKey, number>>;
  step: number;
  totalSteps: number;
  history: AdaptiveAnswer[];
  /** Per-session shuffled question id order (never repeats within a run). */
  order: string[];
  /** Index into `order` for the question currently being shown. */
  cursor: number;
}

export interface AdaptiveProbe {
  id: string;
  /** Friendly category label shown in the UI (e.g. "Low end"). */
  axis: string;
  primary: AxisKey;
  prompt: string;
  hintA: string;
  hintB: string;
  magnitude: number;
  targets: ProbeTarget[];
  variantA: SoundParams;
  variantB: SoundParams;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createAdaptiveState(totalSteps = 30): AdaptiveState {
  return {
    profile: { ...NEUTRAL_PARAMS },
    confidence: {},
    step: 0,
    totalSteps,
    history: [],
    order: shuffle(QUESTION_BANK.map((q) => q.id)),
    cursor: 0,
  };
}

/** Ensure the order array is long enough to keep serving unique-ish questions
 * even if the user skips a lot (only repeats after the whole bank is exhausted). */
function ensureOrder(order: string[], cursor: number): string[] {
  if (cursor < order.length) return order;
  return [...order, ...shuffle(QUESTION_BANK.map((q) => q.id))];
}

function probeMagnitude(state: AdaptiveState): number {
  // Big early, refining later — cosine decay from ~0.5 → ~0.12.
  const t = state.step / Math.max(1, state.totalSteps - 1);
  return 0.12 + (0.38 * (1 + Math.cos(Math.PI * t))) / 2;
}

function lo(key: AxisKey): number {
  return isBipolar(key) ? -1 : 0;
}

function clampParam(key: AxisKey, v: number): number {
  return Math.max(lo(key), Math.min(1, v));
}

export function nextQuestion(state: AdaptiveState): AdaptiveProbe {
  const order = ensureOrder(state.order, state.cursor);
  const id = order[state.cursor % order.length];
  const q = QUESTION_BY_ID[id] ?? QUESTION_BANK[0];
  const mag = probeMagnitude(state);

  const variantA: SoundParams = { ...state.profile };
  const variantB: SoundParams = { ...state.profile };
  for (const t of q.targets) {
    const w = t.weight ?? 1;
    const d = t.dir * mag * w;
    variantA[t.key] = clampParam(t.key, state.profile[t.key] + d);
    variantB[t.key] = clampParam(t.key, state.profile[t.key] - d);
  }

  return {
    id: q.id,
    axis: q.cat,
    primary: q.primary,
    prompt: q.prompt,
    hintA: q.hintA,
    hintB: q.hintB,
    magnitude: mag,
    targets: q.targets,
    variantA,
    variantB,
  };
}

export function applyAnswer(
  state: AdaptiveState,
  probe: AdaptiveProbe,
  choice: "A" | "B",
): AdaptiveState {
  const sign = choice === "A" ? 1 : -1;
  const learnRate = 0.7;
  const profile: SoundParams = { ...state.profile };
  const deltas: Partial<Record<AxisKey, number>> = {};

  for (const t of probe.targets) {
    const w = t.weight ?? 1;
    const d = sign * t.dir * probe.magnitude * w * learnRate;
    const before = profile[t.key];
    profile[t.key] = clampParam(t.key, before + d);
    // Record the *actual* applied change (post-clamp) so Back is exact.
    deltas[t.key] = (deltas[t.key] ?? 0) + (profile[t.key] - before);
  }

  const confidence = { ...state.confidence };
  const prev = confidence[probe.primary] ?? 0;
  confidence[probe.primary] = clamp(prev + sign * 0.18, -1, 1);

  const step = state.step + 1;
  return {
    ...state,
    profile,
    confidence,
    step,
    cursor: state.cursor + 1,
    history: [
      ...state.history,
      { id: probe.id, primary: probe.primary, choice, deltas, step },
    ],
  };
}

/** Advance to the next question WITHOUT recording an answer (the Skip button). */
export function advance(state: AdaptiveState): AdaptiveState {
  const cursor = state.cursor + 1;
  return { ...state, cursor, order: ensureOrder(state.order, cursor) };
}

/**
 * Pop the most recent answer and reconstruct the state at that step. Used by
 * the "Back" button in the calibration view.
 */
export function rewindOne(state: AdaptiveState): AdaptiveState {
  if (state.history.length === 0) return state;
  const last = state.history[state.history.length - 1];
  const profile: SoundParams = { ...state.profile };
  for (const key of Object.keys(last.deltas) as AxisKey[]) {
    profile[key] = clampParam(key, profile[key] - (last.deltas[key] ?? 0));
  }
  const sign = last.choice === "A" ? 1 : -1;
  const confidence = { ...state.confidence };
  const prev = confidence[last.primary] ?? 0;
  confidence[last.primary] = clamp(prev - sign * 0.18, -1, 1);

  return {
    ...state,
    profile,
    confidence,
    step: Math.max(0, state.step - 1),
    cursor: Math.max(0, state.cursor - 1),
    history: state.history.slice(0, -1),
  };
}

export function isComplete(state: AdaptiveState): boolean {
  return state.step >= state.totalSteps;
}

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export const QUESTION_COUNT = QUESTION_BANK.length;
