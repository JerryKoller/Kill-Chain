/**
 * MPK Focus — Signal Path modules that expose continuous knobs, ordered
 * SRC → TONE → MOD → FX → MIX → PERF. Matrix / Arp / mixer faders / morph
 * / scenes are intentionally omitted.
 */

import type { FirePatch } from "@/audio/dsp/FireCommandSynth";
import { FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";

export type NumericFireKey = {
  [K in keyof FirePatch]: FirePatch[K] extends number ? K : never;
}[keyof FirePatch];

export type FocusKnob = {
  key: NumericFireKey;
  label: string;
  min: number;
  max: number;
  curve?: "lin" | "log";
  integer?: boolean;
};

export type FocusModule = {
  id: FireModuleId;
  knobs: FocusKnob[];
};

const K = (
  key: NumericFireKey,
  label: string,
  min: number,
  max: number,
  opts?: { curve?: "lin" | "log"; integer?: boolean },
): FocusKnob => ({ key, label, min, max, curve: opts?.curve ?? "lin", integer: opts?.integer });

const osc = (g: "A" | "B" | "C"): FocusKnob[] => [
  K(`osc${g}Pos` as NumericFireKey, "Morph", 0, 1),
  K(`osc${g}Env` as NumericFireKey, "Env→WT", -1, 1),
  K(`osc${g}Lfo` as NumericFireKey, "LFO→WT", -1, 1),
  K(`osc${g}Octave` as NumericFireKey, "Octave", -2, 2, { integer: true }),
  K(`osc${g}Detune` as NumericFireKey, "Detune", -50, 50, { integer: true }),
  K(`osc${g}Level` as NumericFireKey, "Level", 0, 1),
];

/** Ordered ring — PROG SELECT / next advances through these. */
export const FIRE_FOCUS_RING: FocusModule[] = [
  { id: "osc.a", knobs: osc("A") },
  { id: "osc.b", knobs: osc("B") },
  { id: "osc.c", knobs: osc("C") },
  {
    id: "fire.sec.warp",
    knobs: [
      K("warpStretch", "Stretch", -1, 1),
      K("warpTilt", "Tilt", -1, 1),
      K("warpComb", "Comb", 0, 1),
    ],
  },
  {
    id: "chip",
    knobs: [
      K("pulseDuty", "Pulse", 0.05, 0.95),
      K("chipVoiceLimit", "Voices", 0, 8, { integer: true }),
      K("accentAmount", "Accent", 0, 1),
    ],
  },
  {
    id: "noise",
    knobs: [
      K("noiseLevel", "Level", 0, 1),
      K("noiseColor", "Color", -1, 1),
    ],
  },
  {
    id: "sub",
    knobs: [
      K("subLevel", "Level", 0, 1),
      K("subOctave", "Oct", -2, 0, { integer: true }),
    ],
  },
  {
    id: "mixer.unison",
    knobs: [
      K("unison", "Unison", 1, 7, { integer: true }),
      K("unisonMix", "Choir Mix", 0, 1),
      K("unisonDetune", "Detune", 0, 50, { integer: true }),
      K("unisonWidth", "Width", 0, 1),
      K("unisonTemporalSpread", "Temporal", 0, 0.05),
      K("drift", "Drift", 0, 1),
    ],
  },
  {
    id: "analog.life",
    knobs: [
      K("drift", "Life", 0, 1),
      K("driftRate", "Rate", 0.05, 1),
      K("voiceInstability", "Instab", 0, 1),
      K("tuneVariance", "Tune Δ", 0, 1),
      K("envVariance", "Env Δ", 0, 1),
    ],
  },
  {
    id: "filter",
    knobs: [
      K("filterCutoff", "Cutoff", 20, 18000, { curve: "log" }),
      K("filterResonance", "Reso", 0.1, 28, { curve: "log" }),
      K("filterEnvAmount", "Env Amt", -1, 1),
      K("filterEnvResoAmount", "Env→Reso", -1, 1),
      K("filterKeyTrack", "Key Trk", 0, 1),
      K("filterDrive", "Sat", 0, 1),
    ],
  },
  {
    id: "env.amp",
    knobs: [
      K("ampAttack", "A", 0.001, 3, { curve: "log" }),
      K("ampDecay", "D", 0.005, 3, { curve: "log" }),
      K("ampSustain", "S", 0, 1),
      K("ampRelease", "R", 0.005, 4, { curve: "log" }),
      K("velAmount", "Vel", 0, 1),
    ],
  },
  {
    id: "env.mod",
    knobs: [
      K("modAttack", "A", 0.001, 3, { curve: "log" }),
      K("modDecay", "D", 0.005, 3, { curve: "log" }),
      K("modSustain", "S", 0, 1),
      K("modRelease", "R", 0.005, 4, { curve: "log" }),
      K("oscAEnv", "→A", -1, 1),
      K("oscBEnv", "→B", -1, 1),
      K("oscCEnv", "→C", -1, 1),
    ],
  },
  {
    id: "env.filt",
    knobs: [
      K("filtAttack", "A", 0.001, 3, { curve: "log" }),
      K("filtDecay", "D", 0.005, 3, { curve: "log" }),
      K("filtSustain", "S", 0, 1),
      K("filtRelease", "R", 0.005, 4, { curve: "log" }),
      K("filterEnvAmount", "Env Amt", -1, 1),
    ],
  },
  {
    id: "pluck",
    knobs: [
      K("lpgDecay", "Decay", 0.05, 2.5, { curve: "log" }),
      K("lpgColor", "Color", 0, 1),
      K("lpgStrike", "Strike", 0, 1),
      K("velAmount", "Vel", 0, 1),
    ],
  },
  {
    id: "lfo.1",
    knobs: [
      K("lfo1Rate", "Rate", 0.05, 30, { curve: "log" }),
      K("lfo1Depth", "Depth", 0, 1),
      K("oscALfo", "→A", -1, 1),
      K("oscBLfo", "→B", -1, 1),
      K("oscCLfo", "→C", -1, 1),
    ],
  },
  {
    id: "lfo.2",
    knobs: [
      K("lfo2Rate", "Rate", 0.05, 30, { curve: "log" }),
      K("lfo2Depth", "Depth", 0, 1),
    ],
  },
  {
    id: "fm",
    knobs: [
      K("fmAmount", "FM Amt", 0, 1),
      K("fmRatio", "FM Ratio", 0.5, 12, { curve: "log" }),
      K("fmBtoA", "B→A FM", 0, 1),
      K("ringAmount", "Ring", 0, 1),
      K("ringFreq", "Ring Hz", 20, 4000, { curve: "log" }),
    ],
  },
  {
    id: "fm.rack",
    knobs: [
      K("fmAlg", "Alg", 0, 7, { integer: true }),
      K("fmFeedback", "Fbk", 0, 1),
      K("vectorRate", "Vec Rate", 0, 1),
      K("vectorDepth", "Vec Depth", 0, 1),
      K("fmOp1Level", "Op1", 0, 1),
      K("fmOp2Level", "Op2", 0, 1),
      K("fmOp3Level", "Op3", 0, 1),
      K("fmOp4Level", "Op4", 0, 1),
      K("fmOp2Ratio", "R2", 0.25, 16, { curve: "log" }),
      K("fmOp3Ratio", "R3", 0.25, 16, { curve: "log" }),
      K("fmOp4Ratio", "R4", 0.25, 16, { curve: "log" }),
    ],
  },
  {
    id: "pitch",
    knobs: [
      K("pitchEnvAmount", "Ptch Env", -48, 48, { integer: true }),
      K("pitchEnvTime", "Env Time", 0.01, 2, { curve: "log" }),
      K("glide", "Glide", 0, 1),
    ],
  },
  {
    id: "fx.drive",
    knobs: [
      K("drive", "Drive", 0, 1),
      K("crush", "Crush", 0, 1),
      K("tone", "Tone", 1000, 18000, { curve: "log" }),
    ],
  },
  {
    id: "fx.vintage",
    knobs: [
      K("cassetteGen", "Cass", 0, 1),
      K("tapeSpeed", "Speed", -1, 1),
      K("wowFlutter", "Wow", 0, 1),
      K("vhsColor", "VHS", 0, 1),
      K("sampleRateReduce", "SR↓", 0, 1),
      K("bbdChorus", "BBD", 0, 1),
      K("analogComp", "Comp", 0, 1),
      K("dust", "Dust", 0, 1),
      K("hiss", "Hiss", 0, 1),
      K("hum", "Hum", 0, 1),
      K("printThrough", "Print", 0, 1),
    ],
  },
  {
    id: "fx.phaser",
    knobs: [
      K("phaserRate", "Rate", 0.02, 12, { curve: "log" }),
      K("phaserDepth", "Depth", 0, 1),
      K("phaserMix", "Mix", 0, 1),
    ],
  },
  {
    id: "fx.chorus",
    knobs: [
      K("chorusRate", "Rate", 0.05, 8, { curve: "log" }),
      K("chorusDepth", "Depth", 0, 1),
      K("chorusMix", "Mix", 0, 1),
    ],
  },
  {
    id: "fx.delay",
    knobs: [
      K("delayTime", "Time", 0.01, 1.5, { curve: "log" }),
      K("delayFeedback", "Fbk", 0, 1),
      K("delayMix", "Mix", 0, 1),
    ],
  },
  {
    id: "fx.reverb",
    knobs: [
      K("reverbSize", "Size", 0.3, 6, { curve: "log" }),
      K("reverbDamp", "Damp", 0, 1),
      K("reverbPredelay", "Pre", 0, 0.2),
      K("reverbDiffusion", "Diff", 0, 1),
      K("reverbMix", "Mix", 0, 1),
    ],
  },
  {
    id: "fx.spectral",
    knobs: [
      K("spectralAmount", "Amount", 0, 1),
      K("spectralMix", "Mix", 0, 1),
    ],
  },
  { id: "width", knobs: [K("stereoWidth", "Stereo", 0, 1.4)] },
  { id: "glue", knobs: [K("punch", "Punch", 0, 1)] },
  {
    id: "air",
    knobs: [
      K("airLow", "Low", -1, 1),
      K("airHigh", "High", -1, 1),
      K("airAmount", "Amount", 0, 1),
    ],
  },
  { id: "output", knobs: [K("masterGain", "Master", 0, 1.2)] },
  { id: "performance", knobs: [K("masterGain", "Master", 0, 1.2)] },
  {
    id: "macros",
    knobs: [
      K("macro1", "Macro 1", 0, 1),
      K("macro2", "Macro 2", 0, 1),
      K("macro3", "Macro 3", 0, 1),
      K("macro4", "Macro 4", 0, 1),
    ],
  },
  {
    id: "gate",
    knobs: [
      K("gateRate", "Rate", 0.5, 24, { curve: "log" }),
      K("gateDepth", "Depth", 0, 1),
      K("gateSteps", "Steps", 2, 16, { integer: true }),
      K("gateSmooth", "Smooth", 0, 1),
    ],
  },
  { id: "harmony", knobs: [K("harmonyLevel", "Level", 0, 1)] },
  {
    id: "human",
    knobs: [
      K("humanizeTiming", "Timing", 0, 1),
      K("humanizeVelocity", "Vel", 0, 1),
    ],
  },
];

export const FIRE_FOCUS_COUNT = FIRE_FOCUS_RING.length;

export function focusModuleAt(index: number): FocusModule {
  const i = ((index % FIRE_FOCUS_COUNT) + FIRE_FOCUS_COUNT) % FIRE_FOCUS_COUNT;
  return FIRE_FOCUS_RING[i]!;
}

export function focusPageCount(mod: FocusModule): number {
  return Math.max(1, Math.ceil(mod.knobs.length / 8));
}

/** Knobs visible on the active bank page (up to 8). */
export function focusPageKnobs(mod: FocusModule, bankPage: number): (FocusKnob | null)[] {
  const pages = focusPageCount(mod);
  const page = Math.max(0, Math.min(pages - 1, bankPage));
  const start = page * 8;
  const out: (FocusKnob | null)[] = [];
  for (let i = 0; i < 8; i++) out.push(mod.knobs[start + i] ?? null);
  return out;
}

export function focusTitle(id: FireModuleId): string {
  return FIRE_MODULE_BY_ID.get(id)?.title ?? id;
}

export function focusBandTitle(id: FireModuleId): string {
  return FIRE_MODULE_BY_ID.get(id)?.bandTitle ?? "";
}

export function focusShort(id: FireModuleId): string {
  return FIRE_MODULE_BY_ID.get(id)?.short ?? id;
}

export function focusColor(id: FireModuleId): string {
  return FIRE_MODULE_BY_ID.get(id)?.color ?? "#ff6a3d";
}

/** Map MIDI CC 0..127 → patch value for a focus knob. */
export function ccToFocusValue(cc: number, knob: FocusKnob): number {
  const t = Math.max(0, Math.min(1, cc / 127));
  const { min, max, curve, integer } = knob;
  let v: number;
  if (curve === "log") {
    const lo = Math.log(Math.max(Math.abs(min) < 1e-9 ? 1e-6 : Math.abs(min), 1e-6));
    // For positive log ranges (cutoff, rates, etc.)
    const a = Math.max(min, 1e-6);
    const b = Math.max(max, a * 1.0001);
    v = Math.exp(Math.log(a) + t * (Math.log(b) - Math.log(a)));
    void lo;
  } else {
    v = min + t * (max - min);
  }
  if (integer) v = Math.round(v);
  return Math.max(Math.min(v, Math.max(min, max)), Math.min(min, max));
}

/**
 * Factory / Ableton-style MPK Mini knob CC sets.
 * First matching set that receives traffic "locks" for the session.
 * Also includes common non-sequential factory / editor dumps.
 */
export const MPK_KNOB_CC_SETS: number[][] = [
  [1, 2, 3, 4, 5, 6, 7, 8],
  [14, 15, 16, 17, 18, 19, 20, 21],
  [70, 71, 72, 73, 74, 75, 76, 77],
  [7, 10, 74, 71, 76, 77, 93, 73],
  [75, 76, 77, 78, 79, 80, 81, 82],
  [20, 21, 22, 23, 24, 25, 26, 27],
];

/** Momentary CCs (value ≥ 64) for navigation — assign in MPK Editor if needed. */
export const MPK_FOCUS_CC = {
  prev: 112,
  next: 113,
  bankToggle: 114,
} as const;

/**
 * Pad notes used for PROG / BANK while Focus is on (don't play the synth).
 * Covers common Mk II bank layouts; unknown pads in 0–51 still cycle next.
 */
export const MPK_PAD_NAV: Record<number, "prev" | "next" | "bank"> = {
  36: "prev",
  37: "prev",
  38: "next",
  39: "next",
  40: "bank",
  41: "bank",
  42: "next",
  43: "next",
  44: "prev",
  45: "next",
  46: "bank",
  47: "next",
};

/** Only notes in MPK_PAD_NAV are stolen for PROG — keybed (usually ≥48) still plays. */
export const MPK_PAD_NOTE_MAX = 47;

const KNOB_MAP_KEY = "killchain.firecmd.mpk.knobCcs";

/** Load a user-learned K1–K8 CC map from localStorage. */
export function loadLearnedKnobCcs(): number[] | null {
  try {
    const raw = window.localStorage.getItem(KNOB_MAP_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== 8) return null;
    if (!arr.every((n) => typeof n === "number" && n >= 0 && n <= 127)) return null;
    return arr as number[];
  } catch {
    return null;
  }
}

export function saveLearnedKnobCcs(ccs: number[]): void {
  try {
    window.localStorage.setItem(KNOB_MAP_KEY, JSON.stringify(ccs));
  } catch { /* ignore */ }
}

export function clearLearnedKnobCcs(): void {
  try {
    window.localStorage.removeItem(KNOB_MAP_KEY);
  } catch { /* ignore */ }
}
