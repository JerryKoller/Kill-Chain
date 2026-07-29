import { create } from "zustand";
import { getEngine } from "@/audio/AudioEngine";
import { useAudioStore } from "@/state/audioStore";
import { useFireSequencerStore, inScale, snapMidiToScale } from "@/state/fireSequencerStore";
import type { ScaleId } from "@/state/fireSequencerStore";
import { pushFireHistory, registerFireHistoryProvider } from "@/lib/fireHistory";
import {
  DEFAULT_FIRE_PATCH,
  makeModMatrix,
  type FirePatch,
  type LfoWave,
  type LfoDest,
  type FireFilterType,
  type SubWave,
  type DriveMode,
  type ModRoute,
  type ModSource,
  type ModDest,
  type HarmonyMode,
} from "@/audio/dsp/FireCommandSynth";
import { adsrToModEnvPoints, normalizeModEnvPoints } from "@/audio/dsp/toneDifferentiation";
import { upsertLfoQuickRoute, inferLfoDestFromMatrix } from "@/audio/dsp/modRouting";
import { WAVETABLE_IDS } from "@/audio/dsp/wavetables";
import { GENERATED_PRESETS, type FirePreset, type PresetArp } from "@/audio/dsp/firePresetBank";
import { applyLoudnessSafety, applyModuleLocks, lockedModuleCount } from "@/lib/fireModuleLocks";

/**
 * fireCommandStore — single source of truth for the "Fire Command" synth.
 * Owns the live patch, the arpeggiator + its scheduler, the held-note state
 * (for the on-screen keyboard), octave, the "route through Kill-Chain FX"
 * switch, the patch randomiser and the preset library.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Map soft controller velocities into a punchier live range. */
function shapeLiveVelocity(raw: number, gain: number, curve: number): number {
  const x = clamp(raw, 0, 1);
  const curved = Math.pow(x, clamp(curve, 0.35, 1.8));
  return clamp(curved * clamp(gain, 0.5, 2.5), 0.05, 1);
}

function liveWhen(delayMs: number): number | undefined {
  const ms = clamp(delayMs, 0, 50);
  if (ms <= 0.05) return undefined;
  try {
    return getEngine().ctx.currentTime + ms / 1000;
  } catch {
    return undefined;
  }
}

// ════════════════════ arpeggiator ════════════════════

export type ArpMode =
  | "up" | "down" | "updown" | "downup"
  | "converge" | "diverge" | "pedal"
  | "random" | "walk" | "asplayed";
export type ArpDivision = "1/4" | "1/8" | "1/8T" | "1/16" | "1/16T" | "1/32";

export interface ArpSettings {
  enabled: boolean;
  mode: ArpMode;
  bpm: number;
  division: ArpDivision;
  octaves: number;
  gate: number; // fraction of a step (0.1..1)
  hold: boolean; // latch held notes
  /** MK IV — 0..0.33: every 2nd step lands late (shuffle feel). */
  swing: number;
  /** MK IV — 0..1: how much accented steps punch above the rest. */
  accent: number;
  /** MK IV — accent every Nth step (0 = off). */
  accentEvery: number;
  /** MK IV — 0..1 probability a step retriggers as a double-hit. */
  ratchet: number;
}

export const DEFAULT_ARP: ArpSettings = {
  enabled: false,
  mode: "up",
  bpm: 120,
  division: "1/16",
  octaves: 1,
  gate: 0.6,
  hold: false,
  swing: 0,
  accent: 0,
  accentEvery: 4,
  ratchet: 0,
};

const DIV_MULT: Record<ArpDivision, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/8T": 1 / 3,
  "1/16": 0.25,
  "1/16T": 1 / 6,
  "1/32": 0.125,
};

function divisionSec(bpm: number, division: ArpDivision): number {
  return (60 / clamp(bpm, 40, 300)) * DIV_MULT[division];
}

export function buildArpSequence(order: number[], mode: ArpMode, octaves: number): number[] {
  if (order.length === 0) return [];
  const oct = clamp(Math.round(octaves), 1, 4);
  const baseList = mode === "asplayed" ? [...order] : [...order].sort((a, b) => a - b);
  let expanded: number[] = [];
  for (let o = 0; o < oct; o++) for (const n of baseList) expanded.push(n + 12 * o);
  if (mode === "down") expanded = expanded.slice().reverse();
  else if (mode === "updown") {
    const down = expanded.slice(1, Math.max(1, expanded.length - 1)).reverse();
    expanded = expanded.concat(down);
  } else if (mode === "downup") {
    const rev = expanded.slice().reverse();
    const up = rev.slice(1, Math.max(1, rev.length - 1)).reverse();
    expanded = rev.concat(up);
  } else if (mode === "converge") {
    // Outside-in: lowest, highest, 2nd lowest, 2nd highest…
    const out: number[] = [];
    for (let lo = 0, hi = expanded.length - 1; lo <= hi; lo++, hi--) {
      out.push(expanded[lo]);
      if (hi !== lo) out.push(expanded[hi]);
    }
    expanded = out;
  } else if (mode === "diverge") {
    // Inside-out: middle first, spiralling to the extremes.
    const out: number[] = [];
    for (let lo = 0, hi = expanded.length - 1; lo <= hi; lo++, hi--) {
      out.push(expanded[lo]);
      if (hi !== lo) out.push(expanded[hi]);
    }
    expanded = out.reverse();
  } else if (mode === "pedal") {
    // Trance pedal: the lowest note bounces between every other note.
    const [root, ...rest] = expanded;
    const out: number[] = [];
    for (const n of rest.length > 0 ? rest : [root + 12]) { out.push(root, n); }
    expanded = out;
  }
  return expanded;
}

// Module-level scheduler so it survives store re-reads.
let arpTimer: ReturnType<typeof setTimeout> | null = null;
let arpStep = 0;
let arpWalkPos = 0; // "walk" mode: drunken index into the sequence
/** Cancels overlapping scene morph / next-bar recalls. */
let sceneRecallTimer: ReturnType<typeof setTimeout> | null = null;
let sceneMorphGen = 0;
/** True while a morphMs scene recall is scrubbing the live `patch`. */
let sceneMorphActive = false;
/** True while the morph pad is scrubbing without commit. */
let padMorphActive = false;

/** Abort in-flight scene morph / next-bar recalls (A↔B switch, preset load…). */
function cancelSceneRecall(): void {
  sceneMorphGen++;
  sceneMorphActive = false;
  if (sceneRecallTimer) {
    clearTimeout(sceneRecallTimer);
    sceneRecallTimer = null;
  }
}

/** Committed A/B slots — never the mid-morph blended `patch`. */
function committedSlots(s: {
  editTarget: EditTarget;
  patch: FirePatch;
  patchA: FirePatch;
  patchB: FirePatch;
}): { patchA: FirePatch; patchB: FirePatch } {
  if (sceneMorphActive || padMorphActive) return { patchA: s.patchA, patchB: s.patchB };
  return slotsFromState(s);
}

/** Discard a mid-scrub blend (scene morph or morph pad) from live `patch`. */
function discardMorphBlend(
  get: () => FireCommandState,
  set: (partial: Partial<FireCommandState>) => void,
): void {
  if (!sceneMorphActive && !padMorphActive) return;
  const s = get();
  const clean = structuredClone(s.editTarget === "b" ? s.patchB : s.patchA);
  cancelSceneRecall();
  padMorphActive = false;
  set({ patch: clean });
  try {
    const e = getEngine();
    (s.editTarget === "b" ? e.fireCommandB : e.fireCommand).setPatch(clean);
  } catch { /* engine not ready */ }
}
/** Gate/ratchet note-off timers — must cancel on stop/panic or they retrigger. */
const arpVoiceTimers = new Set<ReturnType<typeof setTimeout>>();
/** Sequencer→arp latch timers (cancel on transport stop). */
const seqArpTimers = new Set<number>();
/** Bumped on every stop so in-flight callbacks no-op. */
let arpGen = 0;

function clearArpVoiceTimers(): void {
  for (const id of arpVoiceTimers) clearTimeout(id);
  arpVoiceTimers.clear();
}

function armArpVoiceTimer(fn: () => void, ms: number): void {
  const id = setTimeout(() => {
    arpVoiceTimers.delete(id);
    fn();
  }, ms);
  arpVoiceTimers.add(id);
}

function stopArpScheduler(): void {
  if (arpTimer) {
    clearTimeout(arpTimer);
    arpTimer = null;
  }
  clearArpVoiceTimers();
  arpGen++;
  arpStep = 0;
  arpWalkPos = 0;
}

function startArpScheduler(
  get: () => FireCommandState,
  set: (partial: Partial<FireCommandState>) => void,
): void {
  stopArpScheduler();
  const tick = () => {
    const s = get();
    const arpModuleOn = s.patch.moduleEnable?.["arp"] !== false;
    if (!s.arp.enabled || !arpModuleOn) {
      arpTimer = null;
      return;
    }
    const stepSec = divisionSec(s.arp.bpm, s.arp.division);
    const seq = buildArpSequence(s.arpOrder, s.arp.mode, s.arp.octaves);
    if (seq.length === 0) {
      // Nothing latched/held — park instead of ticking an empty pattern
      // forever (noteOn re-arms the scheduler when the next note arrives).
      arpStep = 0;
      arpTimer = null;
      if (s.arpCurrent !== null) set({ arpCurrent: null, arpStepIndex: -1 });
      return;
    }
    const fc = getEngine().fireCommand;
    let idx: number;
    if (s.arp.mode === "random") {
      idx = Math.floor(Math.random() * seq.length);
    } else if (s.arp.mode === "walk") {
      // Drunken walk: mostly steps ±1, occasionally holds, clamped in range.
      const r = Math.random();
      arpWalkPos += r < 0.45 ? 1 : r < 0.85 ? -1 : 0;
      arpWalkPos = clamp(arpWalkPos, 0, seq.length - 1);
      idx = arpWalkPos;
    } else {
      idx = arpStep % seq.length;
    }
    let midi = seq[idx];
    void getEngine().resume();
    // Accent pattern: accented steps hit full force, the rest sit back by
    // up to 35% depending on the accent amount.
    const every = Math.max(0, Math.round(s.arp.accentEvery));
    const accented = s.arp.accent > 0 && every > 0 && arpStep % every === 0;
    let vel = accented ? 1 : 0.9 - s.arp.accent * 0.35;
    // Honor Scale Lock + Humanize on arp ticks (same rules as live noteOn).
    const modOn = (id: string) => s.patch.moduleEnable?.[id] !== false;
    if (modOn("scale") && s.patch.scaleLock) {
      const seqStore = useFireSequencerStore.getState();
      midi = snapMidiToScale(midi, seqStore.scaleRoot, seqStore.scaleId);
    }
    if (modOn("human") && s.patch.humanizeOn) {
      const j = (s.patch.humanizeVelocity ?? 0.2) * 0.35;
      vel = clamp(vel * (1 + (Math.random() * 2 - 1) * j), 0.05, 1);
    }
    fc.noteOn(midi, vel);
    // arpStepIndex is display-only — surfaces the sounding step for the viz.
    set({ arpCurrent: midi, arpStepIndex: idx });
    const gateMs = Math.max(20, s.arp.gate * stepSec * 1000 - 8);
    const offMidi = midi;
    const gen = arpGen;
    armArpVoiceTimer(() => {
      if (gen !== arpGen) return;
      fc.noteOff(offMidi);
    }, gateMs);
    // Ratchet: probabilistic double-hit in the back half of the step.
    if (s.arp.ratchet > 0 && Math.random() < s.arp.ratchet) {
      const half = stepSec * 500;
      armArpVoiceTimer(() => {
        if (gen !== arpGen || !get().arp.enabled) return;
        fc.noteOn(offMidi, Math.min(1, vel * 0.85));
        armArpVoiceTimer(() => {
          if (gen !== arpGen) return;
          fc.noteOff(offMidi);
        }, Math.max(15, gateMs * 0.4));
      }, half);
    }
    arpStep++;
    // Swing: every other step borrows time from its neighbour.
    const sw = clamp(s.arp.swing, 0, 0.33);
    const durMs = stepSec * 1000 * (arpStep % 2 === 1 ? 1 + sw : 1 - sw);
    arpTimer = setTimeout(tick, durMs);
  };
  arpTimer = setTimeout(tick, 0);
}

// ════════════════════ presets ════════════════════
// The factory bank lives in firePresetBank.ts: ~20 hand-tuned flagships below
// plus ~500 seeded-deterministic archetype variations generated at load.

export { PRESET_CATEGORIES } from "@/audio/dsp/firePresetBank";
export type { PresetCategory, FirePreset } from "@/audio/dsp/firePresetBank";

/** A patch the user saved from the synth's current state. */
export interface SavedPreset {
  id: string;
  name: string;
  patch: FirePatch;
  arp: ArpSettings;
  createdAt: number;
}

const P = (over: Partial<FirePatch>): FirePatch => ({ ...DEFAULT_FIRE_PATCH, ...over });
/** Shorthand for one modulation-matrix route. */
const MR = (source: ModSource, dest: ModDest, amount: number): ModRoute => ({ source, dest, amount });

const FLAGSHIP_PRESETS: FirePreset[] = [
  {
    id: "init", name: "Init", desc: "Clean wavetable starting point", category: "Lead",
    patch: P({}),
  },
];

/** Factory bank: Init + curated library (no character mirrors). */
export const FIRE_PRESETS: FirePreset[] = [
  ...FLAGSHIP_PRESETS,
  ...GENERATED_PRESETS,
];

// Fast lookup for loadPreset — linear scans over 500 entries add up.
const PRESET_BY_ID = new Map(FIRE_PRESETS.map((p) => [p.id, p]));

// ════════════════════ randomiser ════════════════════

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number) => Math.random() < p;

const LFO_WAVES: LfoWave[] = ["sine", "triangle", "sawtooth", "square", "sample-hold"];
const LFO_DESTS: LfoDest[] = ["off", "pitch", "filter", "volume", "pan"];
const SUB_WAVES: SubWave[] = ["sine", "sine", "triangle", "square"];
const DRIVE_MODES: DriveMode[] = ["soft", "soft", "tube", "fold", "hard", "fuzz"];

/** Generate a fresh, musical (non-screeching) random wavetable patch. */
function randomPatch(): FirePatch {
  const mono = chance(0.5);
  const filterType: FireFilterType = chance(0.8) ? "lowpass" : chance(0.5) ? "bandpass" : chance(0.5) ? "notch" : "highpass";
  const morphMod = chance(0.6);
  const lush = chance(0.45);
  const useC = chance(0.3);
  // A couple of musical matrix routes for instant movement.
  const routes: ModRoute[] = [];
  if (chance(0.5)) routes.push(MR("macro1", "cutoff", rand(0.3, 0.8)));
  if (chance(0.35)) routes.push(MR("lfo2", pick<ModDest>(["pitch", "wtA", "pan"]), rand(-0.4, 0.4)));
  if (chance(0.25)) routes.push(MR("velocity", "cutoff", rand(0.2, 0.6)));
  const gateOn = chance(0.18);
  return normalizePatch({
    oscATable: pick(WAVETABLE_IDS),
    oscAPos: rand(0, 1),
    oscAEnv: morphMod && chance(0.6) ? rand(-0.6, 0.8) : 0,
    oscALfo: morphMod && chance(0.5) ? rand(-0.5, 0.5) : 0,
    oscAOctave: pick([-1, 0, 0, 0, 1]),
    oscADetune: Math.round(rand(-8, 8)),
    oscALevel: rand(0.55, 0.85),
    oscAContinuity: rand(0.35, 0.95),
    oscBTable: pick(WAVETABLE_IDS),
    oscBPos: rand(0, 1),
    oscBEnv: chance(0.4) ? rand(-0.5, 0.6) : 0,
    oscBLfo: chance(0.3) ? rand(-0.4, 0.4) : 0,
    oscBOctave: pick([-2, -1, 0, 0, 1]),
    oscBDetune: Math.round(rand(-18, 18)),
    oscBLevel: rand(0.2, 0.7),
    oscBInherit: chance(0.2) ? pick(["morph", "mirror", "offset", "fm"] as const) : "off",
    oscBPhaseLock: chance(0.12),
    fmAtoB: chance(0.18) ? rand(0.1, 0.55) : 0,
    oscCTable: pick(WAVETABLE_IDS),
    oscCPos: rand(0, 1),
    oscCEnv: chance(0.4) ? rand(-0.5, 0.6) : 0,
    oscCLfo: chance(0.3) ? rand(-0.4, 0.4) : 0,
    oscCOctave: pick([-2, -1, 0, 1]),
    oscCDetune: Math.round(rand(-12, 12)),
    oscCLevel: useC ? rand(0.25, 0.6) : 0,
    unison: pick([1, 1, 3, 3, 5]),
    unisonDetune: Math.round(rand(8, 28)),
    unisonWidth: rand(0.3, 0.95),
    unisonMix: chance(0.7) ? 1 : rand(0.6, 1),
    unisonAnchor: chance(0.8),
    unisonDistribution: pick(["linear", "linear", "gaussian", "center", "edge", "alternating"] as const),
    unisonPhase: pick(["locked", "locked", "random", "even", "alternating"] as const),
    unisonTemporalSpread: chance(0.15) ? rand(0.005, 0.025) : 0,
    unisonTemporalMode: pick(["ltr", "ltr", "center", "random"] as const),
    unisonEnvSpread: chance(0.2) ? rand(0.1, 0.55) : 0,
    warpStretch: chance(0.18) ? rand(-0.5, 0.6) : 0,
    warpTilt: chance(0.18) ? rand(-0.6, 0.6) : 0,
    warpComb: chance(0.12) ? rand(0.15, 0.6) : 0,
    warpAmount: chance(0.7) ? 1 : rand(0.4, 1),
    subWave: pick(SUB_WAVES),
    subLevel: chance(0.6) ? rand(0.2, 0.7) : 0,
    subPhaseAlign: chance(0.7),
    subTranslate: chance(0.35) ? rand(0.15, 0.7) : 0,
    noiseLevel: chance(0.2) ? rand(0.05, 0.25) : 0,
    noiseColor: chance(0.5) ? rand(-0.6, 0.7) : 0,
    noiseMode: chance(0.25) ? pick(["bed", "burst", "storm"] as const) : "bed",
    noiseDensity: rand(0.25, 0.85),
    noiseGrain: rand(0.2, 0.7),
    fmAmount: chance(0.3) ? rand(0.1, 0.5) : 0,
    fmRatio: pick([1, 1.5, 2, 2, 3, 4]),
    fmBtoA: chance(0.25) ? rand(0.1, 0.5) : 0,
    ringAmount: chance(0.2) ? rand(0.1, 0.4) : 0,
    ringFreq: rand(40, 600),
    filterType,
    filterCutoff: Math.round(rand(400, 6500)),
    filterResonance: rand(1, 8),
    filterEnvAmount: rand(-0.3, 0.7),
    filterEnvResoAmount: chance(0.3) ? rand(-0.4, 0.6) : 0,
    filterKeyTrack: rand(0, 0.5),
    filterDrive: chance(0.35) ? rand(0.1, 0.5) : 0,
    filterDrivePos: chance(0.25) ? "pre" : "post",
    filterSlope: pick([1, 1, 2, 3] as const),
    filterCarve: chance(0.2) ? pick(["fundamental", "odds", "evens", "noise"] as const) : "off",
    filterCarveAmount: chance(0.2) ? rand(0.2, 0.7) : 0,
    ampAttack: chance(0.3) ? rand(0.2, 1.2) : rand(0.002, 0.05),
    ampDecay: rand(0.1, 0.6),
    ampSustain: rand(0.3, 0.95),
    ampRelease: rand(0.15, 1.2),
    velAmount: rand(0.4, 1),
    velAttack: chance(0.3) ? rand(0.1, 0.6) : 0,
    ampModel: chance(0.15) ? "gate" : "vca",
    ampCurveAttack: pick(["lin", "exp", "s"] as const),
    ampCurveDecay: pick(["exp", "log", "lin"] as const),
    ampCurveRelease: pick(["exp", "log", "s"] as const),
    ampRetrigger: pick(["zero", "zero", "current", "legato"] as const),
    ampHold: chance(0.1) ? rand(0.02, 0.15) : 0,
    ampOvershoot: chance(0.2) ? rand(0.1, 0.45) : 0,
    lpgOn: chance(0.12),
    lpgDecay: rand(0.15, 1.1),
    lpgColor: rand(0.4, 0.95),
    lpgModel: pick(["classic", "classic", "fast", "slow", "aged", "bright"] as const),
    lpgStrike: rand(0.6, 1),
    lpgRing: rand(0.5, 1),
    lpgLeakage: chance(0.2) ? rand(0.05, 0.25) : 0,
    lpgChoke: chance(0.75),
    lpgResoCouple: chance(0.2) ? rand(0.1, 0.5) : 0,
    filtAttack: rand(0.005, 0.5),
    filtDecay: rand(0.1, 0.6),
    filtSustain: rand(0.2, 0.7),
    filtRelease: rand(0.1, 0.6),
    filtCurveAttack: "lin",
    filtCurveDecay: "exp",
    filtCurveRelease: "exp",
    modAttack: rand(0.005, 0.5),
    modDecay: rand(0.1, 0.9),
    modSustain: rand(0, 0.6),
    modRelease: rand(0.1, 0.7),
    modEnvPoints: adsrToModEnvPoints(rand(0.005, 0.5), rand(0.1, 0.9), rand(0, 0.6), rand(0.1, 0.7)),
    modEnvSustainIndex: 2,
    modEnvLoop: chance(0.12),
    harmonyMode: "off",
    harmonyLevel: 0.6,
    lfo1Wave: pick(LFO_WAVES),
    lfo1Rate: chance(0.5) ? rand(0.1, 3) : rand(3, 12),
    lfo1Depth: chance(0.6) ? rand(0.2, 0.7) : 0,
    lfo1Dest: pick(LFO_DESTS),
    lfo1RateDisplay: "hz",
    lfo2Wave: pick(LFO_WAVES),
    lfo2Rate: rand(0.1, 6),
    lfo2Depth: chance(0.4) ? rand(0.2, 0.6) : 0,
    lfo2Dest: pick(LFO_DESTS),
    lfo2RateDisplay: "hz",
    lfo2Relation: chance(0.35) ? pick(["mirror", "invert", "phaseOffset", "ratio", "followLag"] as const) : "independent",
    lfo2PhaseOffset: pick([0, 45, 90, 180, 270]),
    lfo2Ratio: pick([0.5, 1, 2]),
    lfo2DriftMode: chance(0.25) ? pick(["elastic", "wandering"] as const) : "locked",
    pitchEnvAmount: chance(0.25) ? Math.round(rand(-24, 36)) : 0,
    pitchEnvTime: rand(0.08, 0.5),
    mono,
    glide: mono ? rand(0.02, 0.12) : 0.05,
    glideMode: chance(0.3) ? "always" : "legato",
    glideCurve: pick(["linear", "exp", "s"] as const),
    glideRateMode: chance(0.35) ? "rate" : "time",
    drive: rand(0, 0.4),
    driveMode: pick(DRIVE_MODES),
    crush: chance(0.3) ? rand(0.1, 0.4) : 0,
    tone: Math.round(rand(8000, 16000)),
    driveBias: chance(0.2) ? rand(-0.3, 0.3) : 0,
    driveSymmetry: chance(0.15) ? rand(-0.4, 0.4) : 0,
    driveAutoGain: true,
    driveTonePos: pick(["post", "post", "both", "pre"] as const),
    punch: chance(0.5) ? rand(0.15, 0.5) : 0,
    phaserRate: rand(0.1, 2),
    phaserDepth: rand(0.4, 0.9),
    phaserMix: chance(0.3) ? rand(0.3, 0.6) : 0,
    phaserStages: pick([2, 4, 4, 6, 8]),
    phaserFeedback: rand(0.2, 0.55),
    phaserCenter: Math.round(rand(400, 1600)),
    phaserStereo: pick(["linked", "linked", "opposed", "quadrature"] as const),
    chorusRate: rand(0.2, 1.5),
    chorusDepth: rand(0.2, 0.7),
    chorusMix: chance(0.6) ? rand(0.2, 0.5) : 0,
    chorusModel: pick(["single", "dual", "dual", "triple", "ensemble", "dimension", "tape"] as const),
    chorusVoices: pick([1, 2, 2, 3, 4]),
    chorusSpread: rand(0.4, 1),
    delayTime: rand(0.12, 0.5),
    delayFeedback: rand(0.2, 0.5),
    delayMix: chance(0.5) ? rand(0.15, 0.35) : 0,
    delayCascadeMode: pick(["slap", "echo", "echo", "dub", "bounce", "long"] as const),
    delayDuck: chance(0.2) ? rand(0.1, 0.5) : 0,
    reverbSize: rand(1.5, 4.5),
    reverbMix: lush ? rand(0.2, 0.45) : (chance(0.4) ? rand(0.1, 0.25) : 0),
    reverbDamp: rand(0.25, 0.75),
    reverbPredelay: chance(0.5) ? rand(0.01, 0.08) : 0.02,
    reverbDiffusion: rand(0.45, 0.9),
    reverbEarly: rand(0.25, 0.7),
    reverbLowDecay: rand(0.35, 0.75),
    spectralMode: "off", spectralAmount: 0.6, spectralMix: 0.5,
    spectralLow: 0, spectralHigh: 1,
    fxQuality: pick(["eco", "live", "live", "high"] as const),
    lowProtect: chance(0.25) ? pick(["80", "120", "200"] as const) : "off",
    ageMacro: chance(0.15) ? rand(0.1, 0.45) : 0,
    ageEvolve: chance(0.1) ? rand(0.05, 0.35) : 0,
    fxRoutingScene: "serial",
    macro1: rand(0, 1), macro2: rand(0, 1), macro3: 0, macro4: 0,
    modMatrix: makeModMatrix(routes),
    drift: chance(0.5) ? rand(0.1, 0.5) : 0,
    driftRate: 0.35,
    voiceInstability: chance(0.2) ? rand(0.05, 0.25) : 0,
    tuneVariance: chance(0.2) ? rand(0.05, 0.2) : 0,
    envVariance: chance(0.15) ? rand(0.05, 0.2) : 0,
    analogDnaSeed: Math.floor(Math.random() * 0xFFFFFFFF) >>> 0,
    analogDnaLock: false,
    analogWake: chance(0.2) ? rand(0.05, 0.35) : 0,
    analogTremor: rand(0.35, 0.75),
    analogBreath: rand(0.3, 0.65),
    analogClimate: rand(0.2, 0.5),
    analogEvents: chance(0.15) ? rand(0.05, 0.3) : 0,
    cassetteGen: chance(0.12) ? rand(0.1, 0.4) : 0,
    tapeSpeed: chance(0.1) ? rand(-0.2, 0.2) : 0,
    wowFlutter: chance(0.12) ? rand(0.05, 0.3) : 0,
    vhsColor: chance(0.1) ? rand(0.1, 0.35) : 0,
    bitDepth: "off",
    sampleRateReduce: 0,
    bbdChorus: chance(0.15) ? rand(0.15, 0.5) : 0,
    analogComp: chance(0.2) ? rand(0.1, 0.4) : 0,
    dust: chance(0.1) ? rand(0.02, 0.12) : 0,
    hiss: chance(0.1) ? rand(0.02, 0.1) : 0,
    hum: chance(0.08) ? rand(0.02, 0.08) : 0,
    printThrough: chance(0.08) ? rand(0.02, 0.12) : 0,
    pulseDuty: 0.5,
    hardSync: false,
    chipNoise: "white",
    chipVoiceLimit: 0,
    accentAmount: 0,
    slideOn: false,
    chipAcidMix: rand(0.15, 0.85),
    fmEngine: "classic",
    fmAlg: 0,
    fmOp1Level: 1,
    fmOp2Level: 0.7,
    fmOp3Level: 0.5,
    fmOp4Level: 0.35,
    fmOp2Ratio: 1,
    fmOp3Ratio: 2,
    fmOp4Ratio: 3,
    fmFeedback: 0,
    vectorRate: chance(0.12) ? rand(0.05, 0.3) : 0,
    vectorDepth: chance(0.12) ? rand(0.15, 0.55) : 0,
    pathOsc: true,
    pathFilter: true,
    pathDrive: true,
    pathAge: true,
    pathFx: true,
    pathMix: true,
    pathScope: true,
    subOctave: -1,
    airLow: 0,
    airHigh: 0,
    airAmount: chance(0.35) ? rand(0.2, 0.6) : 0,
    scaleLock: false,
    chordMemoryOn: false,
    chordIntervals: [0, 4, 7],
    humanizeOn: false,
    humanizeTiming: 0.25,
    humanizeVelocity: 0.2,
    moduleEnable: {},
    stereoWidth: rand(0.85, 1.3),
    gateOn,
    gateRate: pick([4, 8, 8, 12, 16]),
    gateDepth: rand(0.6, 1),
    gateSteps: pick([8, 16, 16]),
    gatePattern: Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 1 : (chance(0.3) ? 1 : 0))),
    gateSmooth: gateOn && chance(0.4) ? rand(0.1, 0.6) : 0,
    masterGain: 0.72,
  });
}

// ════════════════════ mutation (natural selection) ════════════════════

/**
 * Breed one offspring from a patch. `amount` (0..1) scales every jitter:
 * ~0 is a whisper of drift, 0.35 is the classic MK III nudge, 1 rewrites the
 * character while keeping the patch's skeleton (tables, octaves, unison
 * count and mod routing never change).
 */
export function mutatePatch(src: FirePatch, amount: number): FirePatch {
  const p = structuredClone(src);
  // 0..1 → 0.25..3× the legacy jitter sizes (legacy ≈ amount 0.35).
  const g = 0.25 + clamp(amount, 0, 1) * 2.75;
  const j = (v: number, amt: number, lo: number, hi: number) =>
    clamp(v + (Math.random() * 2 - 1) * amt * g, lo, hi);
  const jLog = (v: number, oct: number, lo: number, hi: number) =>
    clamp(v * Math.pow(2, (Math.random() * 2 - 1) * oct * g), lo, hi);

  const pn = p as unknown as Record<string, number>;
  // Unipolar 0..1 shapers.
  const uni = [
    "oscAPos", "oscBPos", "oscCPos", "oscALevel", "oscBLevel",
    "subLevel", "noiseLevel", "fmAmount", "fmBtoA", "ringAmount",
    "filterDrive", "drive", "crush", "punch", "chorusMix", "phaserMix",
    "lfo1Depth", "lfo2Depth", "unisonWidth", "ampSustain", "filtSustain",
  ];
  for (const k of uni) {
    if (typeof pn[k] === "number") pn[k] = j(pn[k], 0.09, 0, 1);
  }
  // Bipolar -1..1 modulation amounts.
  const bi = [
    "oscAEnv", "oscBEnv", "oscCEnv", "oscALfo", "oscBLfo", "oscCLfo",
    "noiseColor", "filterEnvAmount",
  ];
  for (const k of bi) {
    if (typeof pn[k] === "number") pn[k] = j(pn[k], 0.12, -1, 1);
  }
  // Log-domain: cutoff, LFO rates, envelope times, detunes.
  p.filterCutoff = jLog(p.filterCutoff, 0.25, 40, 18000);
  p.filterResonance = jLog(Math.max(0.2, p.filterResonance), 0.3, 0.1, 24);
  p.lfo1Rate = jLog(Math.max(0.05, p.lfo1Rate), 0.35, 0.05, 24);
  p.lfo2Rate = jLog(Math.max(0.05, p.lfo2Rate), 0.35, 0.05, 24);
  p.ampAttack = jLog(Math.max(0.002, p.ampAttack), 0.3, 0.001, 3);
  p.ampDecay = jLog(Math.max(0.01, p.ampDecay), 0.3, 0.01, 4);
  p.ampRelease = jLog(Math.max(0.01, p.ampRelease), 0.3, 0.01, 5);
  p.filtAttack = jLog(Math.max(0.002, p.filtAttack), 0.3, 0.001, 3);
  p.filtDecay = jLog(Math.max(0.01, p.filtDecay), 0.3, 0.01, 4);
  p.unisonDetune = j(p.unisonDetune, 4, 0, 60);
  // At high amounts, let the warp/spectral character drift too.
  if (amount > 0.55) {
    p.warpStretch = j(p.warpStretch ?? 0, 0.15, -1, 1);
    p.warpTilt = j(p.warpTilt ?? 0, 0.15, -1, 1);
    p.stereoWidth = j(p.stereoWidth ?? 1, 0.1, 0.5, 1.6);
    p.reverbMix = j(p.reverbMix, 0.08, 0, 0.8);
    p.delayMix = j(p.delayMix, 0.08, 0, 0.8);
  }
  return p;
}

/** A pending natural-selection round: base parent + two offspring. */
export interface MutationRound {
  base: FirePatch;
  a: FirePatch;
  b: FirePatch;
  /** Which offspring is currently audible. */
  listening: "a" | "b";
  /** Generation counter — grows as the user keeps evolving. */
  generation: number;
}

// ════════════════════ persistence ════════════════════

const STORAGE_KEY = "killchain.firecommand.v5";
// Pre-rebrand key. Read once as a fallback so dialed-in patches and saved
// user presets survive the Pulse-Fire → Kill-Chain rename; the next persist
// writes everything back under STORAGE_KEY.
const LEGACY_STORAGE_KEY = "pulsefire.firecommand.v5";

export type EditTarget = "a" | "b";

export type FireUiDensity = "studio" | "compact" | "focus";
export type FireKeyboardMode = "full" | "strip" | "hidden";
export type FireLabelMode = "character" | "technical" | "both";

const FIRE_KEYBOARD_MODES: FireKeyboardMode[] = ["full", "strip", "hidden"];
const FIRE_UI_DENSITIES: FireUiDensity[] = ["studio", "compact", "focus"];
const FIRE_LABEL_MODES: FireLabelMode[] = ["character", "technical", "both"];

function isFireKeyboardMode(v: unknown): v is FireKeyboardMode {
  return typeof v === "string" && (FIRE_KEYBOARD_MODES as string[]).includes(v);
}
function isFireUiDensity(v: unknown): v is FireUiDensity {
  return typeof v === "string" && (FIRE_UI_DENSITIES as string[]).includes(v);
}
function isFireLabelMode(v: unknown): v is FireLabelMode {
  return typeof v === "string" && (FIRE_LABEL_MODES as string[]).includes(v);
}

function normalizePatch(raw: Partial<FirePatch> | undefined | null): FirePatch {
  const patch = { ...DEFAULT_FIRE_PATCH, ...(raw ?? {}) };
  patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
  if (raw && raw.moduleEnable) patch.moduleEnable = { ...raw.moduleEnable };
  // Migrate legacy ADSR-only patches into MSEG points.
  if (!Array.isArray(patch.modEnvPoints) || patch.modEnvPoints.length < 2) {
    patch.modEnvPoints = adsrToModEnvPoints(
      patch.modAttack ?? 0.02,
      patch.modDecay ?? 0.5,
      patch.modSustain ?? 0.3,
      patch.modRelease ?? 0.4,
    );
    patch.modEnvSustainIndex = patch.modEnvPoints.length - 1;
  } else {
    patch.modEnvPoints = normalizeModEnvPoints(patch.modEnvPoints);
  }
  if (typeof patch.unisonMix !== "number") patch.unisonMix = 1;
  if (typeof patch.filterSlope !== "number") patch.filterSlope = 1;
  if (typeof patch.filterEnvResoAmount !== "number") patch.filterEnvResoAmount = 0;
  if (typeof patch.analogDnaSeed !== "number") patch.analogDnaSeed = 0x73a9c412;
  if (!patch.lfo2Relation) patch.lfo2Relation = "independent";
  if (typeof patch.lfo2PhaseOffset !== "number") patch.lfo2PhaseOffset = 90;
  if (typeof patch.lfo2Ratio !== "number") patch.lfo2Ratio = 1;
  if (!patch.lfo2DriftMode) patch.lfo2DriftMode = "locked";
  if (!patch.glideMode) patch.glideMode = "legato";
  if (!patch.glideCurve) patch.glideCurve = "exp";
  if (!patch.glideRateMode) patch.glideRateMode = "time";
  if (!patch.ringMode) patch.ringMode = "ratio";
  if (!patch.lfo1RateDisplay) patch.lfo1RateDisplay = "hz";
  if (!patch.lfo2RateDisplay) patch.lfo2RateDisplay = "hz";
  if (!Array.isArray(patch.fmVectorCorners) || patch.fmVectorCorners.length < 4) {
    patch.fmVectorCorners = DEFAULT_FIRE_PATCH.fmVectorCorners.map((c) => ({
      levels: [...c.levels] as [number, number, number, number],
      ratios: [...c.ratios] as [number, number, number],
      feedback: c.feedback,
    }));
  }
  if (typeof patch.fmVectorX !== "number") patch.fmVectorX = 0.5;
  if (typeof patch.fmVectorY !== "number") patch.fmVectorY = 0.5;
  // FX Clarity migrations
  if (!patch.fxQuality || !["eco", "live", "high", "render"].includes(patch.fxQuality)) {
    patch.fxQuality = "live";
  }
  if (!patch.lowProtect || !["off", "80", "120", "200", "custom"].includes(patch.lowProtect)) {
    patch.lowProtect = "off";
  }
  if (typeof patch.fxDeltaAudition !== "boolean") patch.fxDeltaAudition = false;
  if (typeof patch.fxSharedMod !== "boolean") patch.fxSharedMod = false;
  if (typeof patch.spectralWetOnly !== "boolean") patch.spectralWetOnly = false;
  if (!patch.fxRoutingScene || !["serial", "driveAgePrint", "spaceCascade", "spectralTail"].includes(patch.fxRoutingScene)) {
    patch.fxRoutingScene = "serial";
  }
  if (!patch.chorusModel) patch.chorusModel = "dual";
  if (!patch.delayCascadeMode) patch.delayCascadeMode = "echo";
  if (!patch.phaserStereo) patch.phaserStereo = "linked";
  if (!patch.driveTonePos) patch.driveTonePos = "post";
  if (typeof patch.driveAutoGain !== "boolean") patch.driveAutoGain = true;
  if (typeof patch.ageMacro !== "number") patch.ageMacro = 0;
  if (typeof patch.ageEvolve !== "number") patch.ageEvolve = 0;
  if (typeof patch.spectralLow !== "number") patch.spectralLow = 0;
  if (typeof patch.spectralHigh !== "number") patch.spectralHigh = 1;
  // Mix Clarity migrations
  if (!patch.glueMode) patch.glueMode = "glue";
  if (!patch.masterChainScene) patch.masterChainScene = "glueAirWidth";
  if (!patch.widthMechanism) patch.widthMechanism = "ms";
  if (!patch.airArch) patch.airArch = "dual";
  if (!patch.voiceSteal) patch.voiceSteal = "oldest";
  if (!patch.ceaseMode) patch.ceaseMode = "notes";
  if (typeof patch.mixDeltaAudition !== "boolean") patch.mixDeltaAudition = false;
  if (typeof patch.glueMix !== "number") patch.glueMix = 1;
  if (typeof patch.monoBelow !== "number") patch.monoBelow = 0;
  if (typeof patch.scopeDisplayGain !== "number") patch.scopeDisplayGain = 1;
  // Performance Clarity migrations
  if (!patch.gateDest || (patch.gateDest !== "volume" && patch.gateDest !== "velocity")) {
    patch.gateDest = "volume";
  }
  if (!patch.scaleMode || !["guide", "soft", "strict", "fold"].includes(patch.scaleMode)) {
    patch.scaleMode = patch.scaleLock ? "soft" : "guide";
  }
  if (patch.scaleMode === "guide") patch.scaleLock = false;
  else if (patch.scaleMode === "soft" || patch.scaleMode === "strict" || patch.scaleMode === "fold") {
    patch.scaleLock = true;
  }
  if (!patch.scaleFollowers || typeof patch.scaleFollowers !== "object") {
    patch.scaleFollowers = { harmony: true, chord: true, arp: true, pianoRoll: false };
  } else {
    patch.scaleFollowers = {
      harmony: patch.scaleFollowers.harmony !== false,
      chord: patch.scaleFollowers.chord !== false,
      arp: patch.scaleFollowers.arp !== false,
      pianoRoll: !!patch.scaleFollowers.pianoRoll,
    };
  }
  if (patch.chordMode !== "builder" && patch.chordMode !== "memory") patch.chordMode = "memory";
  if (!patch.macroResponse || !["absolute", "relative", "bipolar", "smoothed"].includes(patch.macroResponse)) {
    patch.macroResponse = "absolute";
  }
  if (!patch.harmonyVoiceLead || !["parallel", "nearest", "scale"].includes(patch.harmonyVoiceLead)) {
    patch.harmonyVoiceLead = "parallel";
  }
  if (typeof patch.harmonyLow !== "number") patch.harmonyLow = 36;
  if (typeof patch.harmonyHigh !== "number") patch.harmonyHigh = 96;
  if (typeof patch.humanizeSeed !== "number") patch.humanizeSeed = 0x4f1ce;
  if (patch.humanizeSeedMode !== "fixed" && patch.humanizeSeedMode !== "perPlay") {
    patch.humanizeSeedMode = "fixed";
  }
  if (typeof patch.humanizeProtectDownbeats !== "boolean") patch.humanizeProtectDownbeats = true;
  if (Array.isArray(patch.gatePattern)) {
    patch.gatePattern = patch.gatePattern.map((v) => clamp(Number(v) || 0, 0, 1));
    while (patch.gatePattern.length < 16) patch.gatePattern.push(0);
    patch.gatePattern = patch.gatePattern.slice(0, 16);
  }
  return patch;
}

function defaultPatchB(): FirePatch {
  const preset = FIRE_PRESETS.find((p) => p.id === "hyperspace") ?? FIRE_PRESETS[0];
  return normalizePatch(preset?.patch ?? {});
}

interface PersistShape {
  /** Active edit surface — always mirrors the voice named by `editTarget`. */
  patch: FirePatch;
  /** Committed Synth A patch (kept in sync while editing A). */
  patchA: FirePatch;
  /** Committed Synth B patch (kept in sync while editing B). */
  patchB: FirePatch;
  octave: number;
  presetId: string;
  presetIdB: string;
  editTarget: EditTarget;
  routeThroughFx: boolean;
  arp: ArpSettings;
  keyboardMode: FireKeyboardMode;
  fireUiDensity: FireUiDensity;
  fireUiDensityBeforeFocus: FireUiDensity;
  labelMode: FireLabelMode;
  moduleLocks: Record<string, boolean>;
  accordionMode: boolean;
  pinnedModules: string[];
  /**
   * Live keyboard / MIDI playability (not patch params).
   * Soft controllers (MPK Mini) often need gain + a concave curve.
   */
  kbdVelGain: number;
  /** Power curve on incoming velocity (<1 expands soft hits). */
  kbdVelCurve: number;
  /** Schedule delay in ms (0 = ASAP). Useful for syncing, not for cutting lag. */
  kbdDelayMs: number;
  /** Live amp-attack override in ms (tight response on keyboard/MIDI). */
  kbdAttackMs: number;
  userPresets: SavedPreset[];
  maxVoices: number;
  /** Natural-selection mutation strength, 0 (subtle) .. 1 (wild). */
  mutateAmount: number;
  /** Last kept generation — survives Keep Winner so the next breed continues the lineage. */
  mutateLineage: number;
  /** Short genealogy trail for Natural Selection UI (generation + kept offspring). */
  mutationGenealogy: { generation: number; kept: "a" | "b"; at: number }[];
  /** Editable Home signal-path order (node ids). Empty = default SIGNAL_PATH. */
  signalPathOrder: string[];
  /** Performance scene slots (partial patch snapshots). */
  scenes: (Partial<FirePatch> | null)[];
  /** Per-slot name + capture scope for Orbit Vault. */
  sceneMeta: {
    name: string;
    scope: { entire: boolean; macros: boolean; fx: boolean; performance: boolean; morph: boolean };
  }[];
  sceneProtect: { masterGain: boolean; maxVoices: boolean };
  sceneTransition: "immediate" | "nextBar" | "morphMs";
  sceneMorphMs: number;
  activeSceneSlot: number | null;
}

function defaultSceneMeta(): PersistShape["sceneMeta"] {
  return Array.from({ length: SCENE_SLOTS }, (_, i) => ({
    name: `Scene ${i + 1}`,
    scope: { entire: true, macros: true, fx: true, performance: true, morph: true },
  }));
}

function defaults(): PersistShape {
  const patchA = normalizePatch({});
  const patchB = defaultPatchB();
  return {
    patch: structuredClone(patchA),
    patchA,
    patchB,
    octave: 4,
    presetId: "init",
    presetIdB: "hyperspace",
    editTarget: "a",
    routeThroughFx: true,
    arp: { ...DEFAULT_ARP },
    keyboardMode: "full",
    fireUiDensity: "studio",
    fireUiDensityBeforeFocus: "studio",
    labelMode: "both",
    moduleLocks: {},
    accordionMode: false,
    pinnedModules: [],
    // Soft USB pads (MPK Mini) land quiet under a linear map — lean bright by default.
    kbdVelGain: 1.45,
    kbdVelCurve: 0.72,
    kbdDelayMs: 0,
    kbdAttackMs: 6,
    userPresets: [],
    maxVoices: 12,
    mutateAmount: 0.35,
    mutateLineage: 0,
    mutationGenealogy: [],
    signalPathOrder: [],
    scenes: Array.from({ length: SCENE_SLOTS }, () => null),
    sceneMeta: defaultSceneMeta(),
    sceneProtect: { masterGain: false, maxVoices: false },
    sceneTransition: "immediate",
    sceneMorphMs: 400,
    activeSceneSlot: null,
  };
}

function load(): PersistShape {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<PersistShape> & {
      patch?: Partial<FirePatch>;
      /** Legacy — migrated to keyboardMode on load. */
      keyboardMinimized?: boolean;
    };
    const d = defaults();
    const patchA = normalizePatch(parsed.patchA ?? parsed.patch ?? {});
    const patchB = normalizePatch(parsed.patchB ?? d.patchB);
    const editTarget: EditTarget = parsed.editTarget === "b" ? "b" : "a";
    const keyboardMode: FireKeyboardMode = isFireKeyboardMode(parsed.keyboardMode)
      ? parsed.keyboardMode
      : parsed.keyboardMinimized === true
        ? "strip"
        : "full";
    return {
      patch: structuredClone(editTarget === "b" ? patchB : patchA),
      patchA,
      patchB,
      octave: typeof parsed.octave === "number" ? parsed.octave : d.octave,
      presetId: parsed.presetId ?? d.presetId,
      presetIdB: typeof parsed.presetIdB === "string" ? parsed.presetIdB : d.presetIdB,
      editTarget,
      routeThroughFx: typeof parsed.routeThroughFx === "boolean" ? parsed.routeThroughFx : d.routeThroughFx,
      arp: { ...d.arp, ...(parsed.arp ?? {}) },
      keyboardMode,
      // Focus is a transient overlay mode — never boot into it. A persisted
      // "focus" (from a crash or an old stuck-density bug) falls back to the
      // remembered pre-Focus density, else Studio.
      fireUiDensity: (() => {
        const raw = isFireUiDensity(parsed.fireUiDensity) ? parsed.fireUiDensity : d.fireUiDensity;
        if (raw !== "focus") return raw;
        const before = isFireUiDensity(parsed.fireUiDensityBeforeFocus) ? parsed.fireUiDensityBeforeFocus : "studio";
        return before === "focus" ? "studio" : before;
      })(),
      fireUiDensityBeforeFocus: (() => {
        const before = isFireUiDensity(parsed.fireUiDensityBeforeFocus) ? parsed.fireUiDensityBeforeFocus : d.fireUiDensityBeforeFocus;
        return before === "focus" ? "studio" : before;
      })(),
      labelMode: isFireLabelMode(parsed.labelMode) ? parsed.labelMode : d.labelMode,
      moduleLocks:
        parsed.moduleLocks && typeof parsed.moduleLocks === "object" && !Array.isArray(parsed.moduleLocks)
          ? { ...parsed.moduleLocks }
          : d.moduleLocks,
      // v2 key: the first ship defaulted accordion ON, which surprised users
      // (opening one module folded the rest). Accordion is opt-in now; only an
      // explicit v2 choice survives reloads.
      accordionMode: typeof (parsed as { accordionModeV2?: unknown }).accordionModeV2 === "boolean"
        ? ((parsed as { accordionModeV2: boolean }).accordionModeV2)
        : d.accordionMode,
      pinnedModules: Array.isArray(parsed.pinnedModules) ? [...parsed.pinnedModules] : d.pinnedModules,
      kbdVelGain: typeof parsed.kbdVelGain === "number" ? clamp(parsed.kbdVelGain, 0.5, 2.5) : d.kbdVelGain,
      kbdVelCurve: typeof parsed.kbdVelCurve === "number" ? clamp(parsed.kbdVelCurve, 0.35, 1.8) : d.kbdVelCurve,
      kbdDelayMs: typeof parsed.kbdDelayMs === "number" ? clamp(parsed.kbdDelayMs, 0, 50) : d.kbdDelayMs,
      kbdAttackMs: typeof parsed.kbdAttackMs === "number" ? clamp(parsed.kbdAttackMs, 1, 80) : d.kbdAttackMs,
      userPresets: Array.isArray(parsed.userPresets) ? parsed.userPresets : d.userPresets,
      maxVoices: typeof parsed.maxVoices === "number" ? parsed.maxVoices : d.maxVoices,
      mutateAmount: typeof parsed.mutateAmount === "number" ? clamp(parsed.mutateAmount, 0, 1) : d.mutateAmount,
      mutateLineage: typeof parsed.mutateLineage === "number" ? Math.max(0, Math.floor(parsed.mutateLineage)) : d.mutateLineage,
      mutationGenealogy: Array.isArray(parsed.mutationGenealogy)
        ? parsed.mutationGenealogy
            .filter((g): g is { generation: number; kept: "a" | "b"; at: number } =>
              !!g && typeof g === "object"
              && typeof (g as { generation?: unknown }).generation === "number"
              && ((g as { kept?: unknown }).kept === "a" || (g as { kept?: unknown }).kept === "b"))
            .slice(-12)
        : d.mutationGenealogy,
      signalPathOrder: Array.isArray(parsed.signalPathOrder)
        ? parsed.signalPathOrder.filter((x): x is string => typeof x === "string")
        : d.signalPathOrder,
      scenes: Array.isArray(parsed.scenes)
        ? Array.from({ length: SCENE_SLOTS }, (_, i) => (parsed.scenes?.[i] as Partial<FirePatch> | null) ?? null)
        : d.scenes,
      sceneMeta: Array.isArray(parsed.sceneMeta)
        ? Array.from({ length: SCENE_SLOTS }, (_, i) => {
            const m = parsed.sceneMeta?.[i];
            const base = d.sceneMeta[i]!;
            if (!m || typeof m !== "object") return base;
            return {
              name: typeof m.name === "string" && m.name.trim() ? m.name.slice(0, 24) : base.name,
              scope: {
                entire: m.scope?.entire !== false,
                macros: !!m.scope?.macros || m.scope?.entire !== false,
                fx: !!m.scope?.fx || m.scope?.entire !== false,
                performance: !!m.scope?.performance || m.scope?.entire !== false,
                morph: !!m.scope?.morph || m.scope?.entire !== false,
              },
            };
          })
        : d.sceneMeta,
      sceneProtect: {
        masterGain: !!parsed.sceneProtect?.masterGain,
        maxVoices: !!parsed.sceneProtect?.maxVoices,
      },
      sceneTransition:
        parsed.sceneTransition === "nextBar" || parsed.sceneTransition === "morphMs"
          ? parsed.sceneTransition
          : "immediate",
      sceneMorphMs: typeof parsed.sceneMorphMs === "number" ? Math.max(50, Math.min(4000, parsed.sceneMorphMs)) : d.sceneMorphMs,
      activeSceneSlot:
        typeof parsed.activeSceneSlot === "number" ? parsed.activeSceneSlot : null,
    };
  } catch {
    return defaults();
  }
}

/** Resolve committed A/B from state (active `patch` wins for the current target). */
export function slotsFromState(s: {
  editTarget: EditTarget;
  patch: FirePatch;
  patchA: FirePatch;
  patchB: FirePatch;
}): { patchA: FirePatch; patchB: FirePatch } {
  if (s.editTarget === "b") {
    return { patchA: s.patchA, patchB: s.patch };
  }
  return { patchA: s.patch, patchB: s.patchB };
}

/** Live DSP engine for the active Edit A/B target (meters, StageViz, gates). */
export function activeFireEngine() {
  const e = getEngine();
  return useFireCommandStore.getState().editTarget === "b" ? e.fireCommandB : e.fireCommand;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(getState: () => FireCommandState): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    // Read at WRITE time — a snapshot captured at schedule time silently
    // overwrote any field mutated during the debounce window.
    const state = getState();
    const { patchA, patchB } = committedSlots(state);
    const data: PersistShape & { accordionModeV2: boolean } = {
      patch: patchA,
      patchA,
      patchB,
      octave: state.octave,
      presetId: state.presetId,
      presetIdB: state.presetIdB,
      editTarget: state.editTarget,
      routeThroughFx: state.routeThroughFx,
      arp: state.arp,
      keyboardMode: state.keyboardMode,
      fireUiDensity: state.fireUiDensity,
      fireUiDensityBeforeFocus: state.fireUiDensityBeforeFocus,
      labelMode: state.labelMode,
      moduleLocks: state.moduleLocks,
      accordionMode: state.accordionMode,
      accordionModeV2: state.accordionMode,
      pinnedModules: state.pinnedModules,
      kbdVelGain: state.kbdVelGain,
      kbdVelCurve: state.kbdVelCurve,
      kbdDelayMs: state.kbdDelayMs,
      kbdAttackMs: state.kbdAttackMs,
      userPresets: state.userPresets,
      maxVoices: state.maxVoices,
      mutateAmount: state.mutateAmount,
      mutateLineage: state.mutateLineage,
      mutationGenealogy: state.mutationGenealogy,
      signalPathOrder: state.signalPathOrder,
      scenes: state.scenes,
      sceneMeta: state.sceneMeta,
      sceneProtect: state.sceneProtect,
      sceneTransition: state.sceneTransition,
      sceneMorphMs: state.sceneMorphMs,
      activeSceneSlot: state.activeSceneSlot,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }, 350);
}

// ════════════════════ store ════════════════════

export interface FireCommandState extends PersistShape {
  heldNotes: number[]; // physically held keys (keyboard highlight)
  arpOrder: number[]; // latched arp pattern source notes
  arpCurrent: number | null; // note the arp is currently sounding
  /** Display-only: index into the built sequence of the sounding step (−1 idle). */
  arpStepIndex: number;
  /** Pending natural-selection round (null when not selecting). */
  mutation: MutationRound | null;

  setEditTarget: (t: EditTarget) => void;
  setParam: <K extends keyof FirePatch>(key: K, value: FirePatch[K]) => void;
  setModRoute: (index: number, partial: Partial<ModRoute>) => void;
  setGateStep: (index: number, on: boolean) => void;
  loadPreset: (id: string) => void;
  /**
   * Full Fire Command factory reset (Init patch A+B, mixer, performance chrome).
   * Confirm-gated in the UI like Kill-Chain Purge.
   */
  resetToDefaults: () => void;
  /** Push a full patch into Synth B (factory load / project restore). */
  importPatchB: (patch: unknown, presetId?: string) => void;
  randomize: () => void;
  /**
   * Natural selection: breed TWO offspring of the current patch (strength =
   * mutateAmount) and audition A. Call again while a round is open to breed
   * the next generation from whichever offspring is playing.
   */
  mutate: () => void;
  setMutateAmount: (v: number) => void;
  /** Audition the other offspring of the open round. */
  auditionMutation: (which: "a" | "b") => void;
  /** Keep the audible offspring — it becomes the patch. */
  commitMutation: () => void;
  /** Abandon the round and restore the parent patch. */
  discardMutation: () => void;
  /** Replace patch + arp from a project file (Synth A). */
  importPatch: (patch: unknown, arp?: unknown) => void;
  /** Deploy a random preset from the factory bank. Returns what it picked. */
  randomPreset: () => FirePreset;
  /**
   * Random Armory deploy: pick from the factory bank (optionally one
   * category) and load it, but keep locked modules exactly as they are.
   * Returns null when the filtered pool is empty.
   */
  deployArmoryPreset: (category?: string) => FirePreset | null;
  /**
   * Morph pad (v1.6): push a blended patch into the synth. No history entry —
   * the pad takes ONE snapshot per gesture itself. commit=true also persists.
   */
  applyMorphPatch: (patch: FirePatch, commit: boolean) => void;
  /**
   * Genesis Characters: push a full/partial patch (+ optional arp), history,
   * engine apply, persist. Marks presetId as custom.
   */
  applyCharacterPatch: (patch: FirePatch | Partial<FirePatch>, arp?: Partial<ArpSettings> | PresetArp) => void;
  savePreset: (name: string) => string;
  deleteUserPreset: (id: string) => void;
  renameUserPreset: (id: string, name: string) => void;
  setMaxVoices: (n: number) => void;
  noteOn: (midi: number, velocity?: number) => void;
  noteOff: (midi: number) => void;
  panic: () => void;
  setOctave: (octave: number) => void;
  shiftOctave: (delta: number) => void;
  /** Live keyboard velocity gain (0.5–2.5). */
  setKbdVelGain: (v: number) => void;
  /** Live velocity power curve (<1 expands soft hits). */
  setKbdVelCurve: (v: number) => void;
  /** Live note schedule delay in ms. */
  setKbdDelayMs: (v: number) => void;
  /** Live amp-attack override in ms. */
  setKbdAttackMs: (v: number) => void;
  setRouteThroughFx: (on: boolean) => void;
  setArp: (patch: Partial<ArpSettings>) => void;
  setKeyboardMode: (m: FireKeyboardMode) => void;
  cycleKeyboardMode: () => void;
  /** Backward-compat alias — cycles full → strip → hidden → full. */
  toggleKeyboard: () => void;
  setFireUiDensity: (d: FireUiDensity) => void;
  enterFireFocusDensity: () => void;
  exitFireFocusDensity: () => void;
  setLabelMode: (m: FireLabelMode) => void;
  setModuleLock: (moduleId: string, locked: boolean) => void;
  toggleModuleLock: (moduleId: string) => void;
  setAccordionMode: (on: boolean) => void;
  toggleModulePin: (moduleId: string) => void;
  isModuleLocked: (moduleId: string) => boolean;
  sync: () => void;
  setModuleEnable: (moduleId: string, on: boolean) => void;
  captureScene: (slot: number) => void;
  recallScene: (slot: number) => void;
  clearScene: (slot: number) => void;
  setSceneName: (slot: number, name: string) => void;
  setSceneScope: (slot: number, partial: Partial<PersistShape["sceneMeta"][0]["scope"]>) => void;
  setSceneProtect: (partial: Partial<PersistShape["sceneProtect"]>) => void;
  setSceneTransition: (t: PersistShape["sceneTransition"], morphMs?: number) => void;
  learnChordFromHeld: () => void;
  setSignalPathOrder: (order: string[]) => void;
  clearMutationGenealogy: () => void;
}

const genId = (): string =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── Harmonizer (v1.7) ──
// Companion notes for live input, locked to the sequencer's scale controls.
// Live-only: sequenced notes already have Conform/duplicate for harmonies.

/** Step `degrees` scale tones upward from `midi` (chromatic-safe). */
function scaleToneUp(midi: number, degrees: number, root: number, scaleId: ScaleId): number {
  let m = midi;
  for (let d = 0; d < degrees; d++) {
    let next = m + 1;
    while (next <= m + 12 && !inScale(next, root, scaleId)) next++;
    m = next;
  }
  return m;
}

function harmonyCompanions(midi: number, mode: HarmonyMode): number[] {
  if (mode === "off") return [];
  if (mode === "octave") return [midi + 12];
  const seq = useFireSequencerStore.getState();
  const { scaleRoot, scaleId } = seq;
  if (scaleId === "off") {
    // Chromatic fallback: fixed major-ish intervals.
    if (mode === "third") return [midi + 4];
    if (mode === "fifth") return [midi + 7];
    return [midi + 4, midi + 7];
  }
  // Companions land on scale tones relative to the played note (which may
  // itself be off-scale — the walk still finds the next tones above it).
  const third = scaleToneUp(midi, 2, scaleRoot, scaleId);
  const fifth = scaleToneUp(midi, 4, scaleRoot, scaleId);
  if (mode === "third") return [third];
  if (mode === "fifth") return [fifth];
  return [third, fifth];
}

/** Live input midi → its sounding companion notes (for matching note-offs). */
const harmonyHeld = new Map<number, number[]>();
/** Chord-memory extras for matching note-offs. */
const chordHeld = new Map<number, number[]>();
/** Input midi → sounding pitch after scale-lock (stable noteOff target). */
const livePitchHeld = new Map<number, number>();

/** Clear live performance maps + UI held state (call with any all-notes-off). */
function clearLiveNoteMaps(): void {
  harmonyHeld.clear();
  chordHeld.clear();
  livePitchHeld.clear();
}

/**
 * Harmony / chord expansions for a sequencer note on channel A or B.
 * Shared by the live bridge and offline bounce (no ARP — arp needs wall clock).
 */
export function expandSequencerSynthVoices(
  ch: 0 | 1,
  midi: number,
  velocity: number,
): { midi: number; vel: number }[] {
  const s = useFireCommandStore.getState();
  const patch = ch === 1 ? s.patchB : s.patchA;
  const modOn = (id: string) => patch.moduleEnable?.[id] !== false;
  const vel = clamp(velocity, 0.05, 1);
  const pitch = clamp(Math.round(midi), 0, 127);
  const voices: { midi: number; vel: number }[] = [{ midi: pitch, vel }];
  const mode = patch.harmonyMode ?? "off";
  const followers = patch.scaleFollowers ?? { harmony: true, chord: true, arp: true, pianoRoll: false };
  if (modOn("harmony") && mode !== "off") {
    let comps = harmonyCompanions(pitch, mode).filter((c) => c <= 127);
    const lo = patch.harmonyLow ?? 36;
    const hi = patch.harmonyHigh ?? 96;
    comps = comps.map((c) => {
      let n = c;
      while (n < lo) n += 12;
      while (n > hi) n -= 12;
      return n;
    }).filter((c) => c >= 0 && c <= 127);
    if (followers.harmony && modOn("scale") && (patch.scaleMode ?? (patch.scaleLock ? "soft" : "guide")) !== "guide") {
      const seq = useFireSequencerStore.getState();
      comps = comps.map((c) => snapMidiToScale(c, seq.scaleRoot, seq.scaleId));
    }
    const lvl = clamp(patch.harmonyLevel ?? 0.6, 0, 1);
    for (const c of comps) voices.push({ midi: c, vel: vel * lvl });
  }
  if (modOn("chord") && patch.chordMemoryOn) {
    const ivs = patch.chordIntervals ?? [0, 4, 7];
    let extras = ivs
      .filter((iv) => iv !== 0)
      .map((iv) => pitch + iv)
      .filter((c) => c >= 0 && c <= 127);
    if (followers.chord && modOn("scale") && (patch.scaleMode ?? (patch.scaleLock ? "soft" : "guide")) !== "guide") {
      const seq = useFireSequencerStore.getState();
      extras = extras.map((c) => snapMidiToScale(c, seq.scaleRoot, seq.scaleId));
    }
    for (const c of extras) voices.push({ midi: c, vel: vel * 0.85 });
  }
  return voices;
}

/**
 * Sequencer → synth bridge: applies the same ARP / harmony / chord paths as
 * live MIDI `noteOn`, instead of bare `playNote` (which skipped them).
 *
 * Expansions come from each channel's own slot (`patchA` / `patchB`).
 * ARP latch remains Synth-A only.
 */
export function scheduleSequencerSynthNote(
  ch: 0 | 1,
  midi: number,
  velocity: number,
  when: number,
  duration: number,
): void {
  const engine = getEngine();
  const target = ch === 1 ? engine.fireCommandB : engine.fireCommand;
  const dur = Math.max(0.03, duration);
  const vel = clamp(velocity, 0.05, 1);
  const pitch = clamp(Math.round(midi), 0, 127);

  const s = useFireCommandStore.getState();
  const patch = ch === 1 ? s.patchB : s.patchA;
  const modOn = (id: string) => patch.moduleEnable?.[id] !== false;

  // ARP latch is Synth-A only.
  if (ch === 0) {
    const ctx = engine.ctx;
    const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
    const arpModuleOn = modOn("arp");

    if (s.arp.enabled && arpModuleOn) {
      // Feed the arp latch for the note's duration (same as holding a key).
      // Sync arp clock to the sequencer so divisions land on the groove.
      const seqBpm = useFireSequencerStore.getState().bpm;
      if (Math.abs(s.arp.bpm - seqBpm) > 0.5) {
        useFireCommandStore.setState({ arp: { ...s.arp, bpm: seqBpm } });
      }
      const onId = window.setTimeout(() => {
        seqArpTimers.delete(onId);
        const st = useFireCommandStore.getState();
        if (!(st.arp.enabled && st.patchA.moduleEnable?.["arp"] !== false)) {
          engine.fireCommand.playNote(pitch, vel, ctx.currentTime, dur);
          return;
        }
        const freshLatch = st.arp.hold && st.heldNotes.length === 0;
        const arpOrder = freshLatch ? [] : [...st.arpOrder];
        if (!arpOrder.includes(pitch)) arpOrder.push(pitch);
        const heldNotes = st.heldNotes.includes(pitch) ? st.heldNotes : [...st.heldNotes, pitch];
        useFireCommandStore.setState({ arpOrder, heldNotes });
        if (arpTimer === null) startArpScheduler(useFireCommandStore.getState, useFireCommandStore.setState);
      }, delayMs);
      const offId = window.setTimeout(() => {
        seqArpTimers.delete(offId);
        const st = useFireCommandStore.getState();
        const heldNotes = st.heldNotes.filter((n) => n !== pitch);
        const arpOrder = st.arp.hold ? st.arpOrder : st.arpOrder.filter((n) => n !== pitch);
        useFireCommandStore.setState({ heldNotes, arpOrder });
      }, delayMs + dur * 1000);
      seqArpTimers.add(onId);
      seqArpTimers.add(offId);
      return;
    }
  }

  for (const v of expandSequencerSynthVoices(ch, pitch, vel)) {
    target.playNote(v.midi, v.vel, when, dur);
  }
}

/** Cancel pending sequencer→arp latch timers (call on transport stop). */
export function clearSequencerArpLatches(): void {
  for (const id of seqArpTimers) clearTimeout(id);
  seqArpTimers.clear();
}

export const SCENE_SLOTS = 8;

export const useFireCommandStore = create<FireCommandState>((set, get) => {
  const persist = () => schedulePersist(get);

  /** Commit active `patch` into committed A/B slots (active target wins). */
  const commitActive = (activePatch?: FirePatch): { patchA: FirePatch; patchB: FirePatch } => {
    const s = get();
    const patch = activePatch ?? s.patch;
    if (s.editTarget === "b") {
      return { patchA: s.patchA, patchB: patch };
    }
    return { patchA: patch, patchB: s.patchB };
  };

  const engineFor = (t: EditTarget) => {
    const engine = getEngine();
    return t === "b" ? engine.fireCommandB : engine.fireCommand;
  };

  const activeEngine = () => engineFor(get().editTarget);

  return {
    ...load(),
    heldNotes: [],
    arpOrder: [],
    arpCurrent: null,
    arpStepIndex: -1,
    mutation: null,

    setEditTarget: (t) => {
      const s = get();
      if (s.editTarget === t) return;
      // Drop any mid-morph blend before committing the abandoned slot.
      if (sceneMorphActive || padMorphActive) discardMorphBlend(get, set);
      else cancelSceneRecall();
      const from = get().editTarget;
      const committed = commitActive();
      // Morph scrub / live drift lives on the engine only — snap the abandoned
      // voice back to the committed store slot so A/B don't desync.
      engineFor(from).setPatch(from === "b" ? committed.patchB : committed.patchA);
      // Flush held/arp/harmony so noteOff after the switch can't miss the
      // engine that actually sounded the note.
      stopArpScheduler();
      clearLiveNoteMaps();
      getEngine().fireCommand.allNotesOff();
      getEngine().peekFireCommandB()?.allNotesOff();
      const nextPatch = structuredClone(t === "b" ? committed.patchB : committed.patchA);
      set({
        editTarget: t,
        patch: nextPatch,
        patchA: committed.patchA,
        patchB: committed.patchB,
        heldNotes: [],
        arpOrder: [],
        arpCurrent: null,
        arpStepIndex: -1,
      });
      engineFor(t).setPatch(nextPatch);
      // Keep sequencer Draw A/B aligned with the edit target.
      const wantCh = t === "b" ? 1 : 0;
      const seq = useFireSequencerStore.getState();
      if (seq.activeChannel !== wantCh) {
        if (t === "b" && !seq.synthBEnabled) seq.setSynthBEnabled(true);
        useFireSequencerStore.setState({ activeChannel: wantCh });
      }
      // Re-arm latch arp only when editing A (arp is A-only).
      if (t === "a" && get().arp.enabled && get().patch.moduleEnable?.["arp"] !== false) {
        startArpScheduler(get, set);
      }
      persist();
    },

    setParam: (key, value) => {
      // Knob moves mid-morph would otherwise commit the blend into patchA/B.
      if (sceneMorphActive || padMorphActive) discardMorphBlend(get, set);
      pushFireHistory(`param:${String(key)}`);
      const s = get();
      let patch = { ...s.patch, [key]: value } as FirePatch;
      let alsoMatrix = false;
      let alsoLfoDest: { lfo1?: LfoDest; lfo2?: LfoDest } | null = null;

      // Phase 1B: keep LFO Quick Route ↔ Patch Loom matrix in sync.
      if (key === "lfo1Dest" || key === "lfo2Dest") {
        const lfo = key === "lfo1Dest" ? 1 : 2;
        const depth = lfo === 1 ? patch.lfo1Depth : patch.lfo2Depth;
        patch = {
          ...patch,
          modMatrix: upsertLfoQuickRoute(patch.modMatrix ?? [], lfo as 1 | 2, value as LfoDest, depth),
        };
        alsoMatrix = true;
      } else if (key === "lfo1Depth" || key === "lfo2Depth") {
        const lfo = key === "lfo1Depth" ? 1 : 2;
        const dest = lfo === 1 ? patch.lfo1Dest : patch.lfo2Dest;
        if (dest && dest !== "off") {
          patch = {
            ...patch,
            modMatrix: upsertLfoQuickRoute(patch.modMatrix ?? [], lfo as 1 | 2, dest, value as number),
          };
          alsoMatrix = true;
        }
      } else if (key === "modMatrix") {
        const matrix = value as ModRoute[];
        const d1 = inferLfoDestFromMatrix(matrix, 1);
        const d2 = inferLfoDestFromMatrix(matrix, 2);
        alsoLfoDest = {};
        if (d1 != null) { patch.lfo1Dest = d1; alsoLfoDest.lfo1 = d1; }
        if (d2 != null) { patch.lfo2Dest = d2; alsoLfoDest.lfo2 = d2; }
      }

      const { patchA, patchB } = commitActive(patch);
      set({
        patch,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
        mutation: null,
        mutateLineage: 0,
      });
      // Prefer incremental engine.set — full setPatch rebuilds every voice bank
      // and was a major scrub-while-playing hitch.
      const eng = activeEngine();
      eng.set(key, value);
      if (alsoMatrix) eng.set("modMatrix", patch.modMatrix);
      if (alsoLfoDest?.lfo1 != null) eng.set("lfo1Dest", alsoLfoDest.lfo1);
      if (alsoLfoDest?.lfo2 != null) eng.set("lfo2Dest", alsoLfoDest.lfo2);
      persist();
    },

    setModRoute: (index, partial) => {
      const routes = get().patch.modMatrix.map((r, i) => (i === index ? { ...r, ...partial } : r));
      get().setParam("modMatrix", routes);
    },

    setGateStep: (index, on) => {
      const pattern = get().patch.gatePattern.map((v, i) => (i === index ? (on ? 1 : 0) : v));
      get().setParam("gatePattern", pattern);
    },

    loadPreset: (id) => {
      const factory = PRESET_BY_ID.get(id);
      const user = factory ? null : get().userPresets.find((p) => p.id === id);
      const src = factory ?? user;
      if (!src) return;
      pushFireHistory();
      cancelSceneRecall();
      const patch = { ...DEFAULT_FIRE_PATCH, ...src.patch };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      patch.moduleEnable = src.patch.moduleEnable
        ? { ...src.patch.moduleEnable }
        : {};
      const s = get();
      if (s.editTarget === "b") {
        clearLiveNoteMaps();
        getEngine().fireCommandB.allNotesOff();
        set({
          patch,
          patchB: patch,
          presetIdB: id,
          heldNotes: [],
        });
        getEngine().fireCommandB.setPatch(patch);
        persist();
        return;
      }
      const arp: ArpSettings = src.arp
        ? { ...DEFAULT_ARP, ...src.arp }
        : { ...DEFAULT_ARP, enabled: false };
      set({
        patch,
        patchA: patch,
        presetId: id,
        arp,
        arpOrder: [],
        arpCurrent: null,
        arpStepIndex: -1,
        heldNotes: [],
        mutation: null,
        mutateLineage: 0,
      });
      const fc = getEngine().fireCommand;
      clearLiveNoteMaps();
      fc.allNotesOff();
      fc.setPatch(patch);
      if (arp.enabled) startArpScheduler(get, set);
      else stopArpScheduler();
      persist();
    },

    resetToDefaults: () => {
      pushFireHistory();
      cancelSceneRecall();
      clearLiveNoteMaps();
      stopArpScheduler();
      const patchA = normalizePatch({});
      const patchB = defaultPatchB();
      const eng = getEngine();
      eng.fireCommand.allNotesOff();
      eng.peekFireCommandB()?.allNotesOff();
      eng.fireCommand.setPatch(patchA);
      eng.fireCommandB.setPatch(patchB);
      const d = defaults();
      set({
        patch: structuredClone(patchA),
        patchA,
        patchB,
        presetId: "init",
        presetIdB: "hyperspace",
        editTarget: "a",
        octave: 4,
        routeThroughFx: true,
        arp: { ...DEFAULT_ARP, enabled: false },
        arpOrder: [],
        arpCurrent: null,
        arpStepIndex: -1,
        heldNotes: [],
        keyboardMode: "full",
        fireUiDensity: "studio",
        fireUiDensityBeforeFocus: "studio",
        labelMode: "both",
        moduleLocks: {},
        accordionMode: false,
        pinnedModules: [],
        maxVoices: 12,
        mutateAmount: 0.35,
        mutation: null,
        mutateLineage: 0,
        mutationGenealogy: [],
        signalPathOrder: [],
        scenes: Array.from({ length: SCENE_SLOTS }, () => null),
        sceneMeta: defaultSceneMeta(),
        sceneProtect: { masterGain: false, maxVoices: false },
        sceneTransition: "immediate",
        sceneMorphMs: 400,
        activeSceneSlot: null,
        kbdVelGain: d.kbdVelGain,
        kbdVelCurve: d.kbdVelCurve,
        kbdDelayMs: d.kbdDelayMs,
        kbdAttackMs: d.kbdAttackMs,
      });
      // Sequencer / piano roll / arrangement / mixer — full blank project.
      void import("@/state/fireSequencerStore").then((m) => {
        m.useFireSequencerStore.getState().resetProjectDefaults();
      });
      persist();
    },

    importPatchB: (rawPatch, presetId) => {
      pushFireHistory();
      const patch = normalizePatch(rawPatch as Partial<FirePatch>);
      const presetIdB = presetId ?? "custom";
      const s = get();
      clearLiveNoteMaps();
      getEngine().fireCommandB.allNotesOff();
      const partial: Partial<FireCommandState> = { patchB: patch, presetIdB };
      if (s.editTarget === "b") {
        partial.patch = patch;
        partial.heldNotes = [];
      }
      set(partial);
      getEngine().fireCommandB.setPatch(patch);
      persist();
    },

    randomize: () => {
      pushFireHistory();
      const s = get();
      const patch = randomPatch();
      applyModuleLocks(patch, s.patch, s.moduleLocks);
      applyLoudnessSafety(patch);
      const { patchA, patchB } = commitActive(patch);
      set({
        patch,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
        mutation: s.editTarget === "a" ? null : s.mutation,
        mutateLineage: s.editTarget === "a" ? 0 : s.mutateLineage,
      });
      activeEngine().setPatch(patch);
      persist();
    },

    mutate: () => {
      pushFireHistory();
      const s = get();
      const parent = s.patch;
      const generation = s.mutation
        ? s.mutation.generation + 1
        : s.mutateLineage > 0
          ? s.mutateLineage + 1
          : 1;
      const a = mutatePatch(parent, s.mutateAmount);
      const b = mutatePatch(parent, s.mutateAmount);
      applyModuleLocks(a, parent, s.moduleLocks);
      applyModuleLocks(b, parent, s.moduleLocks);
      applyLoudnessSafety(a);
      applyLoudnessSafety(b);
      const next = structuredClone(a);
      const { patchA, patchB } = commitActive(next);
      set({
        mutation: { base: structuredClone(parent), a, b, listening: "a", generation },
        patch: next,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
      });
      activeEngine().setPatch(get().patch);
      persist();
    },

    setMutateAmount: (v) => {
      set({ mutateAmount: clamp(v, 0, 1) });
      persist();
    },

    auditionMutation: (which) => {
      const s = get();
      const m = s.mutation;
      if (!m || m.listening === which) return;
      const next = which === "a" ? m.a : m.b;
      const cloned = structuredClone(next);
      const { patchA, patchB } = commitActive(cloned);
      set({
        mutation: { ...m, listening: which },
        patch: cloned,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
      });
      activeEngine().setPatch(get().patch);
      persist();
    },

    commitMutation: () => {
      const m = get().mutation;
      if (!m) return;
      // Genealogy records only KEPT generations — breeds that get discarded
      // or re-bred never enter the trail.
      const genealogy = [
        ...(get().mutationGenealogy ?? []).slice(-11),
        { generation: m.generation, kept: m.listening, at: Date.now() },
      ];
      set({ mutation: null, mutateLineage: m.generation, mutationGenealogy: genealogy });
      persist();
    },

    discardMutation: () => {
      const s = get();
      const m = s.mutation;
      if (!m) return;
      const restored = structuredClone(m.base);
      const { patchA, patchB } = commitActive(restored);
      set({
        mutation: null,
        mutateLineage: 0,
        patch: restored,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
      });
      activeEngine().setPatch(get().patch);
      persist();
    },

    importPatch: (rawPatch, rawArp) => {
      // Always load into Synth A (+ arp). Never redirect to B — that broke
      // .kcproj open while Edit B was active (A/arp never applied).
      pushFireHistory();
      cancelSceneRecall();
      padMorphActive = false;
      const patch = { ...DEFAULT_FIRE_PATCH, ...(rawPatch as Partial<FirePatch>) };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      patch.moduleEnable = (rawPatch as Partial<FirePatch>)?.moduleEnable
        ? { ...((rawPatch as Partial<FirePatch>).moduleEnable as Record<string, boolean>) }
        : {};
      const arp: ArpSettings = rawArp && typeof rawArp === "object"
        ? { ...DEFAULT_ARP, ...(rawArp as Partial<ArpSettings>) }
        : { ...DEFAULT_ARP, enabled: false };
      stopArpScheduler();
      clearLiveNoteMaps();
      const s = get();
      if (s.editTarget === "b") {
        // Keep editing B — only replace slot A / arp.
        set({
          patchA: patch,
          presetId: "custom",
          arp,
          heldNotes: [],
          arpOrder: [],
          arpCurrent: null,
          arpStepIndex: -1,
          mutation: null,
          mutateLineage: 0,
        });
      } else {
        set({
          patch,
          patchA: patch,
          presetId: "custom",
          arp,
          heldNotes: [],
          arpOrder: [],
          arpCurrent: null,
          arpStepIndex: -1,
          mutation: null,
          mutateLineage: 0,
        });
      }
      const fc = getEngine().fireCommand;
      fc.allNotesOff();
      fc.setPatch(patch);
      if (arp.enabled && get().editTarget === "a") startArpScheduler(get, set);
      persist();
    },

    randomPreset: () => {
      return get().deployArmoryPreset() ?? FIRE_PRESETS[0];
    },

    deployArmoryPreset: (category) => {
      const s = get();
      const cur = s.editTarget === "b" ? s.presetIdB : s.presetId;
      const pool = FIRE_PRESETS.filter(
        (p) =>
          p.id !== cur &&
          p.id !== "init" &&
          (!category || category === "all" || p.category === category),
      );
      const preset = pool[Math.floor(Math.random() * pool.length)];
      if (!preset) return null;
      // Snapshot the pre-deploy patch so locked modules survive the load.
      const lockedFrom = structuredClone(s.patch);
      const locks = s.moduleLocks;
      get().loadPreset(preset.id);
      if (lockedModuleCount(locks) > 0) {
        const s2 = get();
        const merged = structuredClone(s2.patch);
        applyModuleLocks(merged, lockedFrom, locks);
        const { patchA, patchB } = commitActive(merged);
        set({ patch: merged, patchA, patchB });
        activeEngine().setPatch(merged);
        persist();
      }
      return preset;
    },

    applyMorphPatch: (patch, commit) => {
      if (!commit) {
        // Scrub: mirror into live `patch` so UI/knobs match the engine, but do
        // not commit into patchA/B until pointer-up (same as scene morph).
        padMorphActive = true;
        set({ patch });
        activeEngine().applyLiveMorph(patch);
        return;
      }
      padMorphActive = false;
      const s = get();
      const cloned = structuredClone(patch);
      const { patchA, patchB } = commitActive(cloned);
      set({
        patch: cloned,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
      });
      activeEngine().setPatch(cloned);
      persist();
    },

    applyCharacterPatch: (rawPatch, rawArp) => {
      pushFireHistory();
      const patch = { ...DEFAULT_FIRE_PATCH, ...rawPatch };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      const s = get();
      if (s.editTarget === "b") {
        clearLiveNoteMaps();
        getEngine().fireCommandB.allNotesOff();
        set({
          patch,
          patchB: patch,
          presetIdB: "custom",
          heldNotes: [],
        });
        getEngine().fireCommandB.setPatch(patch);
        persist();
        return;
      }
      const arp: ArpSettings = rawArp
        ? { ...DEFAULT_ARP, ...rawArp }
        : { ...DEFAULT_ARP, enabled: false };
      stopArpScheduler();
      set({
        patch,
        patchA: patch,
        arp,
        presetId: "custom",
        heldNotes: [],
        arpOrder: [],
        arpCurrent: null,
        arpStepIndex: -1,
        mutation: null,
        mutateLineage: 0,
      });
      const fc = getEngine().fireCommand;
      clearLiveNoteMaps();
      fc.allNotesOff();
      fc.setPatch(patch);
      if (arp.enabled) startArpScheduler(get, set);
      persist();
    },

    savePreset: (name) => {
      pushFireHistory();
      const s = get();
      const id = genId();
      const preset: SavedPreset = {
        id,
        name: name.trim() || `Patch ${s.userPresets.length + 1}`,
        patch: { ...s.patch },
        arp: { ...s.arp },
        createdAt: Date.now(),
      };
      set({
        userPresets: [...s.userPresets, preset],
        ...(s.editTarget === "b" ? { presetIdB: id } : { presetId: id }),
      });
      persist();
      return id;
    },

    deleteUserPreset: (id) => {
      pushFireHistory();
      const s = get();
      set({
        userPresets: s.userPresets.filter((p) => p.id !== id),
        presetId: s.presetId === id ? "custom" : s.presetId,
        presetIdB: s.presetIdB === id ? "custom" : s.presetIdB,
      });
      persist();
    },

    renameUserPreset: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      pushFireHistory();
      set({
        userPresets: get().userPresets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      });
      persist();
    },

    setMaxVoices: (n) => {
      pushFireHistory("maxVoices");
      const v = Math.round(clamp(n, 4, 48));
      set({ maxVoices: v });
      const engine = getEngine();
      engine.fireCommand.setMaxVoices(v);
      engine.fireCommandB.setMaxVoices(v);
      persist();
    },

    noteOn: (midi, velocity = 0.9) => {
      const s = get();
      if (s.heldNotes.length === 0 && s.arpOrder.length === 0) {
        void import("@/lib/sourceArbiter").then(({ claimSource }) => claimSource("fire"));
      }
      const shapedVel = shapeLiveVelocity(velocity, s.kbdVelGain, s.kbdVelCurve);
      // ARP is A-only. When editing B, skip the latch so keys audition B dry.
      const arpModuleOn = s.patch.moduleEnable?.["arp"] !== false;
      if (s.editTarget === "a" && s.arp.enabled && arpModuleOn) {
        useFireSequencerStore.getState().recordNoteOn(midi, shapedVel);
        const freshLatch = s.arp.hold && s.heldNotes.length === 0;
        const arpOrder = freshLatch ? [] : [...s.arpOrder];
        if (!arpOrder.includes(midi)) arpOrder.push(midi);
        const heldNotes = s.heldNotes.includes(midi) ? s.heldNotes : [...s.heldNotes, midi];
        set({ arpOrder, heldNotes });
        if (arpTimer === null) startArpScheduler(get, set);
        return;
      }
      void getEngine().resume();
      const eng = activeEngine();
      const modOn = (id: string) => s.patch.moduleEnable?.[id] !== false;

      let playMidi = midi;
      const scaleMode = s.patch.scaleMode ?? (s.patch.scaleLock ? "soft" : "guide");
      if (modOn("scale") && scaleMode !== "guide") {
        const seq = useFireSequencerStore.getState();
        if (scaleMode === "strict") {
          // Reject before record — out-of-scale presses must not land in the roll.
          if (!inScale(midi, seq.scaleRoot, seq.scaleId)) return;
          playMidi = midi;
        } else if (scaleMode === "fold") {
          const snapped = snapMidiToScale(midi, seq.scaleRoot, seq.scaleId);
          // Prefer snap in the direction of the press (up if above snap, else down).
          playMidi = snapped;
          if (snapped < midi) {
            const up = snapMidiToScale(midi + 1, seq.scaleRoot, seq.scaleId);
            if (Math.abs(up - midi) < Math.abs(snapped - midi)) playMidi = up;
          }
        } else {
          playMidi = snapMidiToScale(midi, seq.scaleRoot, seq.scaleId);
        }
      }
      useFireSequencerStore.getState().recordNoteOn(midi, shapedVel);
      livePitchHeld.set(midi, playMidi);

      let playVel = shapedVel;
      if (modOn("human") && s.patch.humanizeOn) {
        const seed = (s.patch.humanizeSeed ?? 0x4f1ce) ^ (midi * 2654435761);
        const rnd = () => {
          let t = (seed + Math.floor(performance.now() * 0.01)) >>> 0;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const j = (s.patch.humanizeVelocity ?? 0.2) * 0.35;
        playVel = clamp(shapedVel * (1 + (rnd() * 2 - 1) * j), 0.05, 1);
      }

      // Gate → velocity destination (use the engine that will sound the note)
      if (
        modOn("gate")
        && s.patch.gateOn
        && (s.patch.gateDest ?? "volume") === "velocity"
      ) {
        try {
          const step = eng.getGateStep();
          const openAmt = clamp(s.patch.gatePattern[step] ?? 1, 0, 1);
          const cut = s.patch.gateDepth * (1 - openAmt);
          playVel = clamp(playVel * (1 - cut), 0.05, 1);
        } catch { /* ignore */ }
      }

      const timingJitterMs =
        modOn("human") && s.patch.humanizeOn
          ? (s.patch.humanizeTiming ?? 0) * 28 * ((Math.random() * 2) - 1)
          : 0;
      const when = liveWhen(s.kbdDelayMs + timingJitterMs);
      const attackSec = clamp(s.kbdAttackMs, 1, 80) / 1000;
      eng.noteOn(playMidi, playVel, when, attackSec);

      const mode = s.patch.harmonyMode ?? "off";
      const followers = s.patch.scaleFollowers ?? { harmony: true, chord: true, arp: true, pianoRoll: false };
      if (modOn("harmony") && mode !== "off" && !harmonyHeld.has(midi)) {
        let comps = harmonyCompanions(playMidi, mode).filter((c) => c <= 127);
        const lo = s.patch.harmonyLow ?? 36;
        const hi = s.patch.harmonyHigh ?? 96;
        comps = comps.map((c) => {
          let n = c;
          while (n < lo) n += 12;
          while (n > hi) n -= 12;
          return n;
        }).filter((c) => c >= 0 && c <= 127);
        if (followers.harmony && modOn("scale") && scaleMode !== "guide") {
          const seq = useFireSequencerStore.getState();
          comps = comps.map((c) => snapMidiToScale(c, seq.scaleRoot, seq.scaleId));
        }
        const lvl = clamp(s.patch.harmonyLevel ?? 0.6, 0, 1);
        for (const c of comps) eng.noteOn(c, playVel * lvl, when, attackSec);
        harmonyHeld.set(midi, comps);
      }

      const chordArmed =
        (s.patch.chordMode ?? "memory") === "memory"
          ? s.patch.chordMemoryOn
          : s.patch.chordMemoryOn; // builder still fires intervals when armed
      if (modOn("chord") && chordArmed && !chordHeld.has(midi)) {
        const ivs = s.patch.chordIntervals ?? [0, 4, 7];
        let extras = ivs
          .filter((iv) => iv !== 0)
          .map((iv) => playMidi + iv)
          .filter((c) => c >= 0 && c <= 127);
        if (followers.chord && modOn("scale") && scaleMode !== "guide") {
          const seq = useFireSequencerStore.getState();
          extras = extras.map((c) => snapMidiToScale(c, seq.scaleRoot, seq.scaleId));
        }
        for (const c of extras) eng.noteOn(c, playVel * 0.85, when, attackSec);
        chordHeld.set(midi, extras);
      }

      if (!s.heldNotes.includes(midi)) set({ heldNotes: [...s.heldNotes, midi] });
    },

    noteOff: (midi) => {
      const s = get();
      useFireSequencerStore.getState().recordNoteOff(midi);
      const arpModuleOn = s.patch.moduleEnable?.["arp"] !== false;
      if (s.editTarget === "a" && s.arp.enabled && arpModuleOn) {
        const heldNotes = s.heldNotes.filter((n) => n !== midi);
        const arpOrder = s.arp.hold ? s.arpOrder : s.arpOrder.filter((n) => n !== midi);
        set({ heldNotes, arpOrder });
        return;
      }
      const eng = activeEngine();
      const when = liveWhen(s.kbdDelayMs);
      const offMidi = livePitchHeld.get(midi) ?? (() => {
        if (s.patch.moduleEnable?.["scale"] !== false && s.patch.scaleLock) {
          const seq = useFireSequencerStore.getState();
          return snapMidiToScale(midi, seq.scaleRoot, seq.scaleId);
        }
        return midi;
      })();
      livePitchHeld.delete(midi);
      eng.noteOff(offMidi, when);
      if (offMidi !== midi) eng.noteOff(midi, when);
      const comps = harmonyHeld.get(midi);
      if (comps) {
        harmonyHeld.delete(midi);
        for (const c of comps) eng.noteOff(c, when);
      }
      const chord = chordHeld.get(midi);
      if (chord) {
        chordHeld.delete(midi);
        for (const c of chord) eng.noteOff(c, when);
      }
      set({ heldNotes: s.heldNotes.filter((n) => n !== midi) });
    },

    panic: () => {
      stopArpScheduler();
      clearLiveNoteMaps();
      const engine = getEngine();
      engine.fireCommand.allNotesOff();
      engine.peekFireCommandB()?.allNotesOff();
      set({ heldNotes: [], arpOrder: [], arpCurrent: null, arpStepIndex: -1 });
      // Re-arm latch arp if still enabled (empty order parks until next note).
      if (
        get().editTarget === "a"
        && get().arp.enabled
        && get().patch.moduleEnable?.["arp"] !== false
      ) {
        startArpScheduler(get, set);
      }
    },

    setOctave: (octave) => {
      const o = clamp(octave, 0, 8);
      stopArpScheduler();
      clearLiveNoteMaps();
      getEngine().fireCommand.allNotesOff();
      getEngine().peekFireCommandB()?.allNotesOff();
      set({ octave: o, heldNotes: [], arpOrder: [], arpCurrent: null, arpStepIndex: -1 });
      if (
        get().editTarget === "a"
        && get().arp.enabled
        && get().patch.moduleEnable?.["arp"] !== false
      ) {
        startArpScheduler(get, set);
      }
      persist();
    },

    shiftOctave: (delta) => get().setOctave(get().octave + delta),

    setKbdVelGain: (v) => {
      set({ kbdVelGain: clamp(v, 0.5, 2.5) });
      persist();
    },
    setKbdVelCurve: (v) => {
      set({ kbdVelCurve: clamp(v, 0.35, 1.8) });
      persist();
    },
    setKbdDelayMs: (v) => {
      set({ kbdDelayMs: clamp(v, 0, 50) });
      persist();
    },
    setKbdAttackMs: (v) => {
      set({ kbdAttackMs: clamp(v, 1, 80) });
      persist();
    },

    setRouteThroughFx: (on) => {
      set({ routeThroughFx: on });
      useAudioStore.getState().setBypass(!on);
      persist();
    },

    setArp: (patch) => {
      pushFireHistory("arp");
      const prev = get().arp;
      const arp: ArpSettings = { ...prev, ...patch };
      let arpOrder = get().arpOrder;
      if (prev.hold && !arp.hold) {
        const held = get().heldNotes;
        arpOrder = arpOrder.filter((n) => held.includes(n));
      }
      set({ arp, arpOrder });
      if (arp.enabled && !prev.enabled) {
        if (get().editTarget === "a") startArpScheduler(get, set);
      } else if (!arp.enabled && prev.enabled) {
        stopArpScheduler();
        getEngine().fireCommand.allNotesOff();
        set({ arpCurrent: null, arpStepIndex: -1 });
      }
      persist();
    },

    setKeyboardMode: (m) => {
      set({ keyboardMode: m });
      persist();
    },

    cycleKeyboardMode: () => {
      const order: FireKeyboardMode[] = ["full", "strip", "hidden"];
      const cur = get().keyboardMode;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      set({ keyboardMode: next });
      persist();
    },

    toggleKeyboard: () => get().cycleKeyboardMode(),

    setFireUiDensity: (d) => {
      set({ fireUiDensity: d });
      persist();
    },

    enterFireFocusDensity: () => {
      const s = get();
      if (s.fireUiDensity === "focus") return;
      set({ fireUiDensityBeforeFocus: s.fireUiDensity, fireUiDensity: "focus" });
      persist();
    },

    exitFireFocusDensity: () => {
      const s = get();
      if (s.fireUiDensity !== "focus") return;
      set({ fireUiDensity: s.fireUiDensityBeforeFocus });
      persist();
    },

    setLabelMode: (m) => {
      set({ labelMode: m });
      persist();
    },

    setModuleLock: (moduleId, locked) => {
      set({ moduleLocks: { ...get().moduleLocks, [moduleId]: locked } });
      persist();
    },

    toggleModuleLock: (moduleId) => {
      const locks = { ...get().moduleLocks };
      locks[moduleId] = !locks[moduleId];
      set({ moduleLocks: locks });
      persist();
    },

    setAccordionMode: (on) => {
      set({ accordionMode: on });
      persist();
    },

    toggleModulePin: (moduleId) => {
      const pins = get().pinnedModules;
      const next = pins.includes(moduleId)
        ? pins.filter((id) => id !== moduleId)
        : [...pins, moduleId];
      set({ pinnedModules: next });
      persist();
    },

    isModuleLocked: (moduleId) => !!get().moduleLocks[moduleId],

    sync: () => {
      const s = get();
      const engine = getEngine();
      const { patchA, patchB } = slotsFromState(s);
      engine.fireCommand.setMaxVoices(s.maxVoices);
      engine.fireCommandB.setMaxVoices(s.maxVoices);
      engine.fireCommand.setPatch(patchA);
      engine.fireCommandB.setPatch(patchB);
      const bpm = useFireSequencerStore.getState().bpm;
      engine.fireCommand.setHostBpm(bpm);
      engine.fireCommandB.setHostBpm(bpm);
      useAudioStore.getState().setBypass(!s.routeThroughFx);
      if (s.arp.enabled && s.editTarget === "a") startArpScheduler(get, set);
    },

    setModuleEnable: (moduleId, on) => {
      pushFireHistory(`module:${moduleId}`);
      const s = get();
      const moduleEnable = { ...(s.patch.moduleEnable ?? {}), [moduleId]: on };
      const patch = { ...s.patch, moduleEnable };
      const { patchA, patchB } = commitActive(patch);
      set({
        patch,
        patchA,
        patchB,
        presetId: s.editTarget === "a" ? "custom" : s.presetId,
        presetIdB: s.editTarget === "b" ? "custom" : s.presetIdB,
      });
      activeEngine().set("moduleEnable", moduleEnable);
      if (s.editTarget === "a" && moduleId === "arp" && !on) {
        stopArpScheduler();
        set({ arpCurrent: null, arpStepIndex: -1 });
      } else if (s.editTarget === "a" && moduleId === "arp" && on && get().arp.enabled && arpTimer === null) {
        startArpScheduler(get, set);
      }
      persist();
    },

    captureScene: (slot) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const st = get();
      const meta = st.sceneMeta[i] ?? defaultSceneMeta()[i]!;
      const full = { ...st.patch, moduleEnable: { ...(st.patch.moduleEnable ?? {}) } };
      let snap: Partial<FirePatch> = full;
      if (!meta.scope.entire) {
        snap = { moduleEnable: full.moduleEnable };
        const take = (keys: (keyof FirePatch)[]) => {
          for (const k of keys) (snap as Record<string, unknown>)[k] = full[k];
        };
        if (meta.scope.macros) take(["macro1", "macro2", "macro3", "macro4", "macroResponse", "modMatrix"]);
        if (meta.scope.fx) {
          take([
            "drive", "driveBias", "driveInGain", "driveOutGain", "crush", "punch",
            "ageMacro", "ageEvolve", "cassetteGen", "tapeSpeed", "wowFlutter", "vhsColor",
            "chorusMix", "phaserMix", "delayMix", "reverbMix",
            "spectralMix", "spectralMode", "fxRoutingScene",
          ] as (keyof FirePatch)[]);
        }
        if (meta.scope.performance) {
          take([
            "gateOn", "gateRate", "gateDepth", "gateSteps", "gatePattern", "gateSmooth", "gateDest",
            "harmonyMode", "harmonyLevel", "harmonyVoiceLead", "harmonyLow", "harmonyHigh",
            "scaleLock", "scaleMode", "scaleFollowers",
            "chordMemoryOn", "chordMode", "chordIntervals",
            "humanizeOn", "humanizeTiming", "humanizeVelocity", "humanizeSeed", "humanizeSeedMode",
            "humanizeProtectDownbeats",
          ] as (keyof FirePatch)[]);
        }
        if (meta.scope.morph) {
          take(["fmVectorX", "fmVectorY", "fmVectorCorners"] as (keyof FirePatch)[]);
        }
      }
      const scenes = [...st.scenes];
      scenes[i] = snap;
      set({ scenes, activeSceneSlot: i });
      persist();
    },

    recallScene: (slot) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const snap = get().scenes[i];
      if (!snap) return;
      pushFireHistory(`scene:${i}`);
      // Cancel any in-flight morph / next-bar recall so recalls don't stack.
      cancelSceneRecall();
      const morphGen = ++sceneMorphGen;
      const apply = () => {
        if (morphGen !== sceneMorphGen) return;
        sceneMorphActive = false;
        sceneRecallTimer = null;
        const cur = get();
        const protect = cur.sceneProtect;
        // Prefer committed slots as the base — mid-morph `patch` may still be blended
        // if we landed here from the final morph tick.
        const base = cur.editTarget === "b" ? cur.patchB : cur.patchA;
        const patch = {
          ...DEFAULT_FIRE_PATCH,
          ...base,
          ...snap,
          moduleEnable: { ...(snap.moduleEnable ?? base.moduleEnable ?? {}) },
        };
        if (protect.masterGain) patch.masterGain = base.masterGain;
        patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
        const normalized = normalizePatch(patch);
        const { patchA, patchB } = commitActive(normalized);
        set({
          patch: normalized,
          patchA,
          patchB,
          presetId: cur.editTarget === "a" ? "custom" : cur.presetId,
          presetIdB: cur.editTarget === "b" ? "custom" : cur.presetIdB,
          mutation: cur.editTarget === "a" ? null : cur.mutation,
          activeSceneSlot: i,
        });
        activeEngine().setPatch(normalized);
        persist();
      };
      const mode = get().sceneTransition;
      if (mode === "morphMs") {
        const ms = get().sceneMorphMs || 400;
        const steps = 8;
        let n = 0;
        const from = { ...(get().editTarget === "b" ? get().patchB : get().patchA) };
        sceneMorphActive = true;
        const tick = () => {
          if (morphGen !== sceneMorphGen) return;
          n++;
          const t = n / steps;
          const blended = { ...from } as FirePatch & Record<string, unknown>;
          for (const key of Object.keys(snap) as (keyof FirePatch)[]) {
            const a = from[key];
            const b = snap[key];
            if (typeof a === "number" && typeof b === "number") {
              blended[key as string] = a + (b - a) * t;
            } else if (t >= 1) {
              blended[key as string] = b;
            }
          }
          if (n >= steps) {
            apply();
          } else {
            const mid = normalizePatch(blended);
            // Scrub engine + UI patch; commit slots only on final apply so a
            // mid-morph setParam isn't fighting half-written patchA/patchB.
            set({ patch: mid });
            activeEngine().applyLiveMorph(mid);
            sceneRecallTimer = setTimeout(tick, ms / steps);
          }
        };
        tick();
        return;
      }
      if (mode === "nextBar") {
        const bpm = useFireSequencerStore.getState().bpm || 120;
        const wait = (60 / bpm) * 4 * 1000;
        sceneRecallTimer = setTimeout(() => {
          sceneRecallTimer = null;
          apply();
        }, wait);
        return;
      }
      apply();
    },

    clearScene: (slot) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const scenes = [...get().scenes];
      scenes[i] = null;
      set({ scenes, activeSceneSlot: get().activeSceneSlot === i ? null : get().activeSceneSlot });
      persist();
    },

    setSceneName: (slot, name) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const sceneMeta = [...get().sceneMeta];
      const cur = sceneMeta[i] ?? defaultSceneMeta()[i]!;
      sceneMeta[i] = { ...cur, name: name.trim().slice(0, 24) || cur.name };
      set({ sceneMeta });
      persist();
    },

    setSceneScope: (slot, partial) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const sceneMeta = [...get().sceneMeta];
      const cur = sceneMeta[i] ?? defaultSceneMeta()[i]!;
      sceneMeta[i] = { ...cur, scope: { ...cur.scope, ...partial } };
      set({ sceneMeta });
      persist();
    },

    setSceneProtect: (partial) => {
      set({ sceneProtect: { ...get().sceneProtect, ...partial } });
      persist();
    },

    setSceneTransition: (t, morphMs) => {
      set({
        sceneTransition: t,
        ...(typeof morphMs === "number" ? { sceneMorphMs: Math.max(50, Math.min(4000, morphMs)) } : {}),
      });
      persist();
    },

    learnChordFromHeld: () => {
      const held = [...get().heldNotes].sort((a, b) => a - b);
      if (held.length < 2) return;
      const root = held[0];
      const chordIntervals = held.map((n) => n - root);
      get().setParam("chordIntervals", chordIntervals);
      get().setParam("chordMemoryOn", true);
    },

    setSignalPathOrder: (order) => {
      set({ signalPathOrder: [...order] });
      persist();
    },

    clearMutationGenealogy: () => {
      set({ mutationGenealogy: [] });
      persist();
    },
  };
});

registerFireHistoryProvider("fireCommand", {
  capture: () => {
    const s = useFireCommandStore.getState();
    const { patchA, patchB } = committedSlots(s);
    return {
      patch: patchA,
      patchA,
      patchB,
      arp: s.arp,
      presetId: s.presetId,
      presetIdB: s.presetIdB,
      editTarget: s.editTarget,
      maxVoices: s.maxVoices,
    };
  },
  restore: (snap) => {
    const raw = snap as Partial<PersistShape>;
    const patchA = normalizePatch(raw.patchA ?? raw.patch);
    const patchB = normalizePatch(raw.patchB ?? defaultPatchB());
    const editTarget: EditTarget = raw.editTarget === "b" ? "b" : "a";
    const patch = structuredClone(editTarget === "b" ? patchB : patchA);
    stopArpScheduler();
    clearLiveNoteMaps();
    useFireCommandStore.setState({
      patch,
      patchA,
      patchB,
      arp: raw.arp ? { ...DEFAULT_ARP, ...raw.arp } : { ...DEFAULT_ARP },
      presetId: raw.presetId ?? "init",
      presetIdB: typeof raw.presetIdB === "string" ? raw.presetIdB : "hyperspace",
      editTarget,
      // Keep the live user bank — history never owned it.
      maxVoices: typeof raw.maxVoices === "number" ? raw.maxVoices : 12,
      heldNotes: [],
      arpOrder: [],
      arpCurrent: null,
      arpStepIndex: -1,
    });
    const s = useFireCommandStore.getState();
    const engine = getEngine();
    engine.fireCommand.allNotesOff();
    engine.fireCommandB.allNotesOff();
    engine.fireCommand.setPatch(patchA);
    engine.fireCommandB.setPatch(patchB);
    engine.fireCommand.setMaxVoices(s.maxVoices);
    engine.fireCommandB.setMaxVoices(s.maxVoices);
    // Keep sequencer Draw A/B aligned with restored edit target.
    const wantCh = editTarget === "b" ? 1 : 0;
    const seq = useFireSequencerStore.getState();
    if (seq.activeChannel !== wantCh) {
      if (editTarget === "b" && !seq.synthBEnabled) seq.setSynthBEnabled(true);
      useFireSequencerStore.setState({ activeChannel: wantCh });
    }
    if (s.arp.enabled && editTarget === "a") {
      startArpScheduler(
        useFireCommandStore.getState,
        (p) => useFireCommandStore.setState(p),
      );
    }
    schedulePersist(useFireCommandStore.getState);
  },
});
