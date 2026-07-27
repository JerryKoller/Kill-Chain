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
import { WAVETABLE_IDS } from "@/audio/dsp/wavetables";
import { GENERATED_PRESETS, type FirePreset, type PresetArp } from "@/audio/dsp/firePresetBank";

/**
 * fireCommandStore — single source of truth for the "Fire Command" synth.
 * Owns the live patch, the arpeggiator + its scheduler, the held-note state
 * (for the on-screen keyboard), octave, the "route through Kill-Chain FX"
 * switch, the patch randomiser and the preset library.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

function stopArpScheduler(): void {
  if (arpTimer) {
    clearTimeout(arpTimer);
    arpTimer = null;
  }
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
    setTimeout(() => fc.noteOff(offMidi), gateMs);
    // Ratchet: probabilistic double-hit in the back half of the step.
    if (s.arp.ratchet > 0 && Math.random() < s.arp.ratchet) {
      const half = stepSec * 500;
      setTimeout(() => {
        if (!get().arp.enabled) return;
        fc.noteOn(offMidi, Math.min(1, vel * 0.85));
        setTimeout(() => fc.noteOff(offMidi), Math.max(15, gateMs * 0.4));
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
  return {
    oscATable: pick(WAVETABLE_IDS),
    oscAPos: rand(0, 1),
    oscAEnv: morphMod && chance(0.6) ? rand(-0.6, 0.8) : 0,
    oscALfo: morphMod && chance(0.5) ? rand(-0.5, 0.5) : 0,
    oscAOctave: pick([-1, 0, 0, 0, 1]),
    oscADetune: Math.round(rand(-8, 8)),
    oscALevel: rand(0.55, 0.85),
    oscBTable: pick(WAVETABLE_IDS),
    oscBPos: rand(0, 1),
    oscBEnv: chance(0.4) ? rand(-0.5, 0.6) : 0,
    oscBLfo: chance(0.3) ? rand(-0.4, 0.4) : 0,
    oscBOctave: pick([-2, -1, 0, 0, 1]),
    oscBDetune: Math.round(rand(-18, 18)),
    oscBLevel: rand(0.2, 0.7),
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
    warpStretch: chance(0.18) ? rand(-0.5, 0.6) : 0,
    warpTilt: chance(0.18) ? rand(-0.6, 0.6) : 0,
    warpComb: chance(0.12) ? rand(0.15, 0.6) : 0,
    lpgOn: chance(0.12),
    lpgDecay: rand(0.15, 1.1),
    lpgColor: rand(0.4, 0.95),
    harmonyMode: "off",
    harmonyLevel: 0.6,
    subWave: pick(SUB_WAVES),
    subLevel: chance(0.6) ? rand(0.2, 0.7) : 0,
    noiseLevel: chance(0.2) ? rand(0.05, 0.25) : 0,
    noiseColor: chance(0.5) ? rand(-0.6, 0.7) : 0,
    fmAmount: chance(0.3) ? rand(0.1, 0.5) : 0,
    fmRatio: pick([1, 1.5, 2, 2, 3, 4]),
    fmBtoA: chance(0.25) ? rand(0.1, 0.5) : 0,
    ringAmount: chance(0.2) ? rand(0.1, 0.4) : 0,
    ringFreq: rand(40, 600),
    filterType,
    filterCutoff: Math.round(rand(400, 6500)),
    filterResonance: rand(1, 8),
    filterEnvAmount: rand(-0.3, 0.7),
    filterKeyTrack: rand(0, 0.5),
    filterDrive: chance(0.35) ? rand(0.1, 0.5) : 0,
    ampAttack: chance(0.3) ? rand(0.2, 1.2) : rand(0.002, 0.05),
    ampDecay: rand(0.1, 0.6),
    ampSustain: rand(0.3, 0.95),
    ampRelease: rand(0.15, 1.2),
    velAmount: rand(0.4, 1),
    filtAttack: rand(0.005, 0.5),
    filtDecay: rand(0.1, 0.6),
    filtSustain: rand(0.2, 0.7),
    filtRelease: rand(0.1, 0.6),
    modAttack: rand(0.005, 0.5),
    modDecay: rand(0.1, 0.9),
    modSustain: rand(0, 0.6),
    modRelease: rand(0.1, 0.7),
    lfo1Wave: pick(LFO_WAVES),
    lfo1Rate: chance(0.5) ? rand(0.1, 3) : rand(3, 12),
    lfo1Depth: chance(0.6) ? rand(0.2, 0.7) : 0,
    lfo1Dest: pick(LFO_DESTS),
    lfo2Wave: pick(LFO_WAVES),
    lfo2Rate: rand(0.1, 6),
    lfo2Depth: chance(0.4) ? rand(0.2, 0.6) : 0,
    lfo2Dest: pick(LFO_DESTS),
    pitchEnvAmount: chance(0.25) ? Math.round(rand(-24, 36)) : 0,
    pitchEnvTime: rand(0.08, 0.5),
    mono,
    glide: mono ? rand(0.02, 0.12) : 0.05,
    drive: rand(0, 0.4),
    driveMode: pick(DRIVE_MODES),
    crush: chance(0.3) ? rand(0.1, 0.4) : 0,
    tone: Math.round(rand(8000, 16000)),
    punch: chance(0.5) ? rand(0.15, 0.5) : 0,
    phaserRate: rand(0.1, 2),
    phaserDepth: rand(0.4, 0.9),
    phaserMix: chance(0.3) ? rand(0.3, 0.6) : 0,
    chorusRate: rand(0.2, 1.5),
    chorusDepth: rand(0.2, 0.7),
    chorusMix: chance(0.6) ? rand(0.2, 0.5) : 0,
    delayTime: rand(0.12, 0.5),
    delayFeedback: rand(0.2, 0.5),
    delayMix: chance(0.5) ? rand(0.15, 0.35) : 0,
    reverbSize: rand(1.5, 4.5),
    reverbMix: lush ? rand(0.2, 0.45) : (chance(0.4) ? rand(0.1, 0.25) : 0),
    reverbDamp: rand(0.25, 0.75),
    reverbPredelay: chance(0.5) ? rand(0.01, 0.08) : 0.02,
    reverbDiffusion: rand(0.45, 0.9),
    spectralMode: "off", spectralAmount: 0.6, spectralMix: 0.5,
    macro1: rand(0, 1), macro2: rand(0, 1), macro3: 0, macro4: 0,
    modMatrix: makeModMatrix(routes),
    drift: chance(0.5) ? rand(0.1, 0.5) : 0,
    driftRate: 0.35,
    voiceInstability: chance(0.2) ? rand(0.05, 0.25) : 0,
    tuneVariance: chance(0.2) ? rand(0.05, 0.2) : 0,
    envVariance: chance(0.15) ? rand(0.05, 0.2) : 0,
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
  };
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

interface PersistShape {
  patch: FirePatch;
  octave: number;
  presetId: string;
  routeThroughFx: boolean;
  arp: ArpSettings;
  keyboardMinimized: boolean;
  userPresets: SavedPreset[];
  maxVoices: number;
  /** Natural-selection mutation strength, 0 (subtle) .. 1 (wild). */
  mutateAmount: number;
  /** Last kept generation — survives Keep Winner so the next breed continues the lineage. */
  mutateLineage: number;
  /** Performance scene slots (partial patch snapshots). */
  scenes: (Partial<FirePatch> | null)[];
}

function defaults(): PersistShape {
  return {
    patch: { ...DEFAULT_FIRE_PATCH },
    octave: 4,
    presetId: "init",
    routeThroughFx: true,
    arp: { ...DEFAULT_ARP },
    keyboardMinimized: false,
    userPresets: [],
    maxVoices: 12,
    mutateAmount: 0.35,
    mutateLineage: 0,
    scenes: Array.from({ length: SCENE_SLOTS }, () => null),
  };
}

function load(): PersistShape {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    const d = defaults();
    const patch = { ...d.patch, ...(parsed.patch ?? {}) };
    patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
    return {
      patch,
      octave: typeof parsed.octave === "number" ? parsed.octave : d.octave,
      presetId: parsed.presetId ?? d.presetId,
      routeThroughFx: typeof parsed.routeThroughFx === "boolean" ? parsed.routeThroughFx : d.routeThroughFx,
      arp: { ...d.arp, ...(parsed.arp ?? {}) },
      keyboardMinimized: typeof parsed.keyboardMinimized === "boolean" ? parsed.keyboardMinimized : d.keyboardMinimized,
      userPresets: Array.isArray(parsed.userPresets) ? parsed.userPresets : d.userPresets,
      maxVoices: typeof parsed.maxVoices === "number" ? parsed.maxVoices : d.maxVoices,
      mutateAmount: typeof parsed.mutateAmount === "number" ? clamp(parsed.mutateAmount, 0, 1) : d.mutateAmount,
      mutateLineage: typeof parsed.mutateLineage === "number" ? Math.max(0, Math.floor(parsed.mutateLineage)) : d.mutateLineage,
      scenes: Array.isArray(parsed.scenes)
        ? Array.from({ length: SCENE_SLOTS }, (_, i) => (parsed.scenes?.[i] as Partial<FirePatch> | null) ?? null)
        : d.scenes,
    };
  } catch {
    return defaults();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(state: FireCommandState): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const data: PersistShape = {
      patch: state.patch,
      octave: state.octave,
      presetId: state.presetId,
      routeThroughFx: state.routeThroughFx,
      arp: state.arp,
      keyboardMinimized: state.keyboardMinimized,
      userPresets: state.userPresets,
      maxVoices: state.maxVoices,
      mutateAmount: state.mutateAmount,
      mutateLineage: state.mutateLineage,
      scenes: state.scenes,
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

  setParam: <K extends keyof FirePatch>(key: K, value: FirePatch[K]) => void;
  setModRoute: (index: number, partial: Partial<ModRoute>) => void;
  setGateStep: (index: number, on: boolean) => void;
  loadPreset: (id: string) => void;
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
  /** Replace patch + arp from a project file. */
  importPatch: (patch: unknown, arp?: unknown) => void;
  /** Deploy a random preset from the factory bank. Returns what it picked. */
  randomPreset: () => FirePreset;
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
  setRouteThroughFx: (on: boolean) => void;
  setArp: (patch: Partial<ArpSettings>) => void;
  toggleKeyboard: () => void;
  sync: () => void;
  setModuleEnable: (moduleId: string, on: boolean) => void;
  captureScene: (slot: number) => void;
  recallScene: (slot: number) => void;
  clearScene: (slot: number) => void;
  learnChordFromHeld: () => void;
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

export const SCENE_SLOTS = 8;

export const useFireCommandStore = create<FireCommandState>((set, get) => {
  const persist = () => schedulePersist(get());

  return {
    ...load(),
    heldNotes: [],
    arpOrder: [],
    arpCurrent: null,
    arpStepIndex: -1,
    mutation: null,

    setParam: (key, value) => {
      // Knob drags stream setParam per mousemove — coalesce by param name.
      pushFireHistory(`param:${String(key)}`);
      const patch = { ...get().patch, [key]: value };
      // Hand-editing adopts the audible sound and ends any selection round.
      set({ patch, presetId: "custom", mutation: null, mutateLineage: 0 });
      getEngine().fireCommand.set(key, value);
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
      // Merge over defaults: user presets saved before newer patch fields
      // existed (fmBtoA, noiseColor, filterDrive, stereoWidth, velAmount…)
      // load with legacy-exact behavior.
      const patch = { ...DEFAULT_FIRE_PATCH, ...src.patch };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      // FIXED: Always reset moduleEnable to the preset's own setting (or empty
      // = all modules on). Previously this preserved the current moduleEnable,
      // causing modules disabled on one preset to stay disabled on all
      // subsequent preset loads — the "sticky sound" bug.
      patch.moduleEnable = src.patch.moduleEnable
        ? { ...src.patch.moduleEnable }
        : {};
      const arp: ArpSettings = src.arp
        ? { ...DEFAULT_ARP, ...src.arp }
        : { ...DEFAULT_ARP, enabled: false };
      set({ patch, presetId: id, arp, arpOrder: [], arpCurrent: null, arpStepIndex: -1, heldNotes: [], mutation: null, mutateLineage: 0 });
      const fc = getEngine().fireCommand;
      fc.allNotesOff();
      fc.setPatch(patch);
      if (arp.enabled) startArpScheduler(get, set);
      else stopArpScheduler();
      persist();
    },

    randomize: () => {
      pushFireHistory();
      const patch = randomPatch();
      set({ patch, presetId: "custom", mutation: null, mutateLineage: 0 });
      getEngine().fireCommand.setPatch(patch);
      persist();
    },

    mutate: () => {
      pushFireHistory();
      const s = get();
      // Breeding from an open round evolves from what's currently audible —
      // the parent of the next generation is the offspring you're hearing.
      // After Keep Winner, mutateLineage remembers the last kept gen.
      const parent = s.patch;
      const generation = s.mutation
        ? s.mutation.generation + 1
        : s.mutateLineage > 0
          ? s.mutateLineage + 1
          : 1;
      const a = mutatePatch(parent, s.mutateAmount);
      const b = mutatePatch(parent, s.mutateAmount);
      set({
        mutation: { base: structuredClone(parent), a, b, listening: "a", generation },
        patch: structuredClone(a),
        presetId: "custom",
      });
      getEngine().fireCommand.setPatch(get().patch);
      persist();
    },

    setMutateAmount: (v) => {
      set({ mutateAmount: clamp(v, 0, 1) });
      persist();
    },

    auditionMutation: (which) => {
      const m = get().mutation;
      if (!m || m.listening === which) return;
      const next = which === "a" ? m.a : m.b;
      set({
        mutation: { ...m, listening: which },
        patch: structuredClone(next),
        presetId: "custom",
      });
      getEngine().fireCommand.setPatch(get().patch);
      persist();
    },

    commitMutation: () => {
      const m = get().mutation;
      if (!m) return;
      // Patch already holds the audible offspring — close the round and
      // remember the generation so the next breed continues the lineage.
      set({ mutation: null, mutateLineage: m.generation });
      persist();
    },

    discardMutation: () => {
      const m = get().mutation;
      if (!m) return;
      set({ mutation: null, mutateLineage: 0, patch: structuredClone(m.base), presetId: "custom" });
      getEngine().fireCommand.setPatch(get().patch);
      persist();
    },

    importPatch: (rawPatch, rawArp) => {
      pushFireHistory();
      const patch = { ...DEFAULT_FIRE_PATCH, ...(rawPatch as Partial<FirePatch>) };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      // Same contract as loadPreset: never inherit prior module bypasses / arp.
      patch.moduleEnable = (rawPatch as Partial<FirePatch>)?.moduleEnable
        ? { ...((rawPatch as Partial<FirePatch>).moduleEnable as Record<string, boolean>) }
        : {};
      const arp: ArpSettings = rawArp && typeof rawArp === "object"
        ? { ...DEFAULT_ARP, ...(rawArp as Partial<ArpSettings>) }
        : { ...DEFAULT_ARP, enabled: false };
      stopArpScheduler();
      set({ patch, arp, presetId: "custom", heldNotes: [], arpOrder: [], arpCurrent: null, arpStepIndex: -1, mutation: null, mutateLineage: 0 });
      const fc = getEngine().fireCommand;
      fc.allNotesOff();
      fc.setPatch(patch);
      if (arp.enabled) startArpScheduler(get, set);
      persist();
    },

    randomPreset: () => {
      // Never repeat the current pick and skip the neutral Init patch —
      // "Randomize" should always land on an actual voice.
      const cur = get().presetId;
      const pool = FIRE_PRESETS.filter((p) => p.id !== cur && p.id !== "init");
      const preset = pool[Math.floor(Math.random() * pool.length)] ?? FIRE_PRESETS[0];
      get().loadPreset(preset.id);
      return preset;
    },

    applyMorphPatch: (patch, commit) => {
      // Drag path: engine only — avoid structuredClone + Zustand churn at 60fps.
      if (!commit) {
        getEngine().fireCommand.setPatch(patch);
        return;
      }
      set({ patch: structuredClone(patch), presetId: "custom" });
      getEngine().fireCommand.setPatch(get().patch);
      persist();
    },

    applyCharacterPatch: (rawPatch, rawArp) => {
      pushFireHistory();
      const patch = { ...DEFAULT_FIRE_PATCH, ...rawPatch };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      const arp: ArpSettings = rawArp
        ? { ...DEFAULT_ARP, ...rawArp }
        : { ...DEFAULT_ARP, enabled: false };
      stopArpScheduler();
      set({
        patch,
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
      set({ userPresets: [...s.userPresets, preset], presetId: id });
      persist();
      return id;
    },

    deleteUserPreset: (id) => {
      pushFireHistory();
      const s = get();
      set({
        userPresets: s.userPresets.filter((p) => p.id !== id),
        presetId: s.presetId === id ? "custom" : s.presetId,
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
      getEngine().fireCommand.setMaxVoices(v);
      persist();
    },

    noteOn: (midi, velocity = 0.9) => {
      const s = get();
      if (s.heldNotes.length === 0 && s.arpOrder.length === 0) {
        void import("@/lib/sourceArbiter").then(({ claimSource }) => claimSource("fire"));
      }
      useFireSequencerStore.getState().recordNoteOn(midi, velocity);
      const arpModuleOn = s.patch.moduleEnable?.["arp"] !== false;
      if (s.arp.enabled && arpModuleOn) {
        const freshLatch = s.arp.hold && s.heldNotes.length === 0;
        const arpOrder = freshLatch ? [] : [...s.arpOrder];
        if (!arpOrder.includes(midi)) arpOrder.push(midi);
        const heldNotes = s.heldNotes.includes(midi) ? s.heldNotes : [...s.heldNotes, midi];
        set({ arpOrder, heldNotes });
        if (arpTimer === null) startArpScheduler(get, set);
        return;
      }
      const engine = getEngine();
      void engine.resume();
      const modOn = (id: string) => s.patch.moduleEnable?.[id] !== false;

      // Scale Lock — snap live notes to the sequencer scale.
      let playMidi = midi;
      if (modOn("scale") && s.patch.scaleLock) {
        const seq = useFireSequencerStore.getState();
        playMidi = snapMidiToScale(midi, seq.scaleRoot, seq.scaleId);
      }

      // Humanize velocity on live input.
      let playVel = velocity;
      if (modOn("human") && s.patch.humanizeOn) {
        const j = (s.patch.humanizeVelocity ?? 0.2) * 0.35;
        playVel = clamp(velocity * (1 + (Math.random() * 2 - 1) * j), 0.05, 1);
      }

      engine.fireCommand.noteOn(playMidi, playVel);

      // Harmony companions (module + mode).
      const mode = s.patch.harmonyMode ?? "off";
      if (modOn("harmony") && mode !== "off" && !harmonyHeld.has(midi)) {
        const comps = harmonyCompanions(playMidi, mode).filter((c) => c <= 127);
        const lvl = clamp(s.patch.harmonyLevel ?? 0.6, 0, 1);
        for (const c of comps) engine.fireCommand.noteOn(c, playVel * lvl);
        harmonyHeld.set(midi, comps);
      }

      // Chord Memory — fire stored intervals from the played root.
      if (modOn("chord") && s.patch.chordMemoryOn && !chordHeld.has(midi)) {
        const ivs = s.patch.chordIntervals ?? [0, 4, 7];
        const extras = ivs
          .filter((iv) => iv !== 0)
          .map((iv) => playMidi + iv)
          .filter((c) => c >= 0 && c <= 127);
        for (const c of extras) engine.fireCommand.noteOn(c, playVel * 0.85);
        chordHeld.set(midi, extras);
      }

      if (!s.heldNotes.includes(midi)) set({ heldNotes: [...s.heldNotes, midi] });
    },

    noteOff: (midi) => {
      const s = get();
      useFireSequencerStore.getState().recordNoteOff(midi);
      const arpModuleOn = s.patch.moduleEnable?.["arp"] !== false;
      if (s.arp.enabled && arpModuleOn) {
        const heldNotes = s.heldNotes.filter((n) => n !== midi);
        const arpOrder = s.arp.hold ? s.arpOrder : s.arpOrder.filter((n) => n !== midi);
        set({ heldNotes, arpOrder });
        return;
      }
      const engine = getEngine();
      // Scale-locked note-off: release the snapped pitch if it differs.
      let offMidi = midi;
      if (s.patch.moduleEnable?.["scale"] !== false && s.patch.scaleLock) {
        const seq = useFireSequencerStore.getState();
        offMidi = snapMidiToScale(midi, seq.scaleRoot, seq.scaleId);
      }
      engine.fireCommand.noteOff(offMidi);
      if (offMidi !== midi) engine.fireCommand.noteOff(midi);
      const comps = harmonyHeld.get(midi);
      if (comps) {
        harmonyHeld.delete(midi);
        for (const c of comps) engine.fireCommand.noteOff(c);
      }
      const chord = chordHeld.get(midi);
      if (chord) {
        chordHeld.delete(midi);
        for (const c of chord) engine.fireCommand.noteOff(c);
      }
      set({ heldNotes: s.heldNotes.filter((n) => n !== midi) });
    },

    panic: () => {
      stopArpScheduler();
      harmonyHeld.clear();
      chordHeld.clear();
      getEngine().fireCommand.allNotesOff();
      set({ heldNotes: [], arpOrder: [], arpCurrent: null, arpStepIndex: -1 });
      if (get().arp.enabled) startArpScheduler(get, set);
    },

    setOctave: (octave) => {
      const o = clamp(octave, 0, 8);
      getEngine().fireCommand.allNotesOff();
      set({ octave: o, heldNotes: [], arpOrder: [], arpCurrent: null, arpStepIndex: -1 });
      persist();
    },

    shiftOctave: (delta) => get().setOctave(get().octave + delta),

    setRouteThroughFx: (on) => {
      set({ routeThroughFx: on });
      useAudioStore.getState().setBypass(!on);
      persist();
    },

    setArp: (patch) => {
      pushFireHistory("arp");
      const prev = get().arp;
      const arp: ArpSettings = { ...prev, ...patch };
      // Turning hold off drops latched notes that aren't physically held.
      let arpOrder = get().arpOrder;
      if (prev.hold && !arp.hold) {
        const held = get().heldNotes;
        arpOrder = arpOrder.filter((n) => held.includes(n));
      }
      set({ arp, arpOrder });
      if (arp.enabled && !prev.enabled) {
        startArpScheduler(get, set);
      } else if (!arp.enabled && prev.enabled) {
        stopArpScheduler();
        getEngine().fireCommand.allNotesOff();
        set({ arpCurrent: null, arpStepIndex: -1 });
      }
      persist();
    },

    toggleKeyboard: () => {
      set({ keyboardMinimized: !get().keyboardMinimized });
      persist();
    },

    sync: () => {
      const s = get();
      const engine = getEngine();
      engine.fireCommand.setMaxVoices(s.maxVoices);
      engine.fireCommand.setPatch(s.patch);
      useAudioStore.getState().setBypass(!s.routeThroughFx);
      if (s.arp.enabled) startArpScheduler(get, set);
    },

    setModuleEnable: (moduleId, on) => {
      pushFireHistory(`module:${moduleId}`);
      const moduleEnable = { ...(get().patch.moduleEnable ?? {}), [moduleId]: on };
      const patch = { ...get().patch, moduleEnable };
      set({ patch, presetId: "custom" });
      getEngine().fireCommand.set("moduleEnable", moduleEnable);
      // Arp module off must park the scheduler so notes fall through to live play.
      if (moduleId === "arp" && !on) {
        stopArpScheduler();
        set({ arpCurrent: null, arpStepIndex: -1 });
      } else if (moduleId === "arp" && on && get().arp.enabled && arpTimer === null) {
        startArpScheduler(get, set);
      }
      persist();
    },

    captureScene: (slot) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const scenes = [...get().scenes];
      // Include moduleEnable so scene recall restores which modules were armed.
      scenes[i] = { ...get().patch, moduleEnable: { ...(get().patch.moduleEnable ?? {}) } };
      set({ scenes });
      persist();
    },

    recallScene: (slot) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const snap = get().scenes[i];
      if (!snap) return;
      pushFireHistory(`scene:${i}`);
      const patch = {
        ...DEFAULT_FIRE_PATCH,
        ...get().patch,
        ...snap,
        moduleEnable: { ...(snap.moduleEnable ?? get().patch.moduleEnable ?? {}) },
      };
      patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
      set({ patch, presetId: "custom", mutation: null });
      getEngine().fireCommand.setPatch(patch);
      persist();
    },

    clearScene: (slot) => {
      const i = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(slot)));
      const scenes = [...get().scenes];
      scenes[i] = null;
      set({ scenes });
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
  };
});

// ── undo/redo provider (v1.6) ──
// The synth's undoable slice: patch, arp, presets. Live performance state
// (held notes, octave, FX routing) is deliberately excluded.
registerFireHistoryProvider("fireCommand", {
  capture: () => {
    const s = useFireCommandStore.getState();
    return {
      patch: s.patch,
      arp: s.arp,
      presetId: s.presetId,
      userPresets: s.userPresets,
      maxVoices: s.maxVoices,
    };
  },
  restore: (snap) => {
    stopArpScheduler();
    useFireCommandStore.setState({
      ...(snap as Partial<FireCommandState>),
      arpOrder: [],
      arpCurrent: null,
      arpStepIndex: -1,
    });
    const s = useFireCommandStore.getState();
    const fc = getEngine().fireCommand;
    fc.allNotesOff();
    fc.setPatch(s.patch);
    fc.setMaxVoices(s.maxVoices);
    if (s.arp.enabled) {
      startArpScheduler(
        useFireCommandStore.getState,
        (p) => useFireCommandStore.setState(p),
      );
    }
    schedulePersist(s);
  },
});
