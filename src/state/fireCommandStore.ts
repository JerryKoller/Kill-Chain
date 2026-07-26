import { create } from "zustand";
import { getEngine } from "@/audio/AudioEngine";
import { useAudioStore } from "@/state/audioStore";
import { useFireSequencerStore, inScale } from "@/state/fireSequencerStore";
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
import { GENERATED_PRESETS, type FirePreset } from "@/audio/dsp/firePresetBank";
import { MISSION_SHOWCASE_PRESETS } from "@/audio/dsp/fireMissionPresets";

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
    if (!s.arp.enabled) {
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
    const midi = seq[idx];
    void getEngine().resume();
    // Accent pattern: accented steps hit full force, the rest sit back by
    // up to 35% depending on the accent amount.
    const every = Math.max(0, Math.round(s.arp.accentEvery));
    const accented = s.arp.accent > 0 && every > 0 && arpStep % every === 0;
    const vel = accented ? 1 : 0.9 - s.arp.accent * 0.35;
    fc.noteOn(midi, vel);
    // arpStepIndex is display-only — surfaces the sounding step for the viz.
    set({ arpCurrent: midi, arpStepIndex: idx });
    const gateMs = Math.max(20, s.arp.gate * stepSec * 1000 - 8);
    setTimeout(() => fc.noteOff(midi), gateMs);
    // Ratchet: probabilistic double-hit in the back half of the step.
    if (s.arp.ratchet > 0 && Math.random() < s.arp.ratchet) {
      const half = stepSec * 500;
      setTimeout(() => {
        if (!get().arp.enabled) return;
        fc.noteOn(midi, Math.min(1, vel * 0.85));
        setTimeout(() => fc.noteOff(midi), Math.max(15, gateMs * 0.4));
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

/** Hand-tuned flagship patches — shown first within their categories. */
const FLAGSHIP_PRESETS: FirePreset[] = [
  {
    id: "init", name: "Init", desc: "Clean wavetable starting point", category: "Lead",
    patch: P({}),
  },

  // ── Bass ──
  {
    id: "alien-bass", name: "Alien Bass", desc: "Dubstep wobble — the nasty one", category: "Bass",
    patch: P({
      oscATable: "growl", oscAPos: 0.5, oscALfo: 0.25,
      oscBTable: "saw", oscBPos: 0.6, oscBDetune: 16,
      unison: 3, unisonDetune: 18, unisonWidth: 0.5,
      subWave: "square", subLevel: 0.55, oscALevel: 0.75, oscBLevel: 0.5,
      filterType: "lowpass", filterCutoff: 320, filterResonance: 8,
      filterEnvAmount: 0.2, filterKeyTrack: 0.2,
      ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.95, ampRelease: 0.25,
      lfo1Wave: "triangle", lfo1Rate: 2.6, lfo1Depth: 0.8, lfo1Dest: "filter",
      drive: 0.35, mono: true, glide: 0.08, tone: 12000, masterGain: 0.82,
    }),
  },
  {
    id: "reese", name: "Reese Driver", desc: "Wide detuned bass monster", category: "Bass",
    patch: P({
      oscATable: "growl", oscAPos: 0.45, oscBTable: "growl", oscBPos: 0.65, oscBDetune: 26,
      unison: 5, unisonDetune: 28, unisonWidth: 0.5, subLevel: 0.4,
      filterType: "lowpass", filterCutoff: 280, filterResonance: 5,
      filterEnvAmount: 0.25, filtDecay: 0.4, filtSustain: 0.4,
      fmAmount: 0.08, drive: 0.34, mono: true, glide: 0.05, tone: 9500, masterGain: 0.8,
    }),
  },
  {
    id: "808-sub", name: "808 Sub", desc: "Deep sub with a pitch drop", category: "Bass",
    patch: P({
      oscATable: "basic", oscAPos: 0, oscALevel: 0.5, oscBTable: "basic", oscBPos: 1, oscBOctave: -1, oscBLevel: 0.2,
      unison: 1, subWave: "sine", subLevel: 0.85,
      filterType: "lowpass", filterCutoff: 180, filterResonance: 1,
      pitchEnvAmount: 14, pitchEnvTime: 0.22,
      ampAttack: 0.004, ampDecay: 0.6, ampSustain: 0.7, ampRelease: 0.35,
      mono: true, drive: 0.12, tone: 7000, masterGain: 0.85,
    }),
  },
  {
    id: "talking-bass", name: "Talking Bass", desc: "Vowel-morphing wobble bass", category: "Bass",
    patch: P({
      oscATable: "vocal", oscAPos: 0.3, oscALfo: 0.55,
      oscBTable: "growl", oscBPos: 0.4, oscBDetune: 12, oscBLevel: 0.45,
      unison: 3, unisonDetune: 16, unisonWidth: 0.5, subWave: "triangle", subLevel: 0.5,
      // Resonance 6 → 5 and master 0.8 → 0.72: with the LFO sweeping the
      // resonant peak across the fundamental, the old settings rode the
      // filter-drive ceiling every wobble cycle (audible crunch).
      filterType: "lowpass", filterCutoff: 700, filterResonance: 5, filterEnvAmount: 0.15,
      ampAttack: 0.006, ampDecay: 0.3, ampSustain: 0.9, ampRelease: 0.25,
      lfo1Wave: "triangle", lfo1Rate: 3, lfo1Depth: 0.5, lfo1Dest: "filter",
      drive: 0.28, mono: true, glide: 0.06, tone: 11000, masterGain: 0.72,
    }),
  },
  {
    id: "acid-reactor", name: "Acid Reactor", desc: "303-style squelch — mono, gliding, resonant", category: "Bass",
    patch: P({
      oscATable: "saw", oscAPos: 0.15, oscALevel: 0.8,
      oscBTable: "pulse", oscBPos: 0.35, oscBLevel: 0.25, oscBDetune: 4,
      unison: 1, subLevel: 0,
      filterType: "lowpass", filterCutoff: 480, filterResonance: 11,
      filterEnvAmount: 0.85, filterKeyTrack: 0.3, filterDrive: 0.3,
      filtAttack: 0.003, filtDecay: 0.22, filtSustain: 0.05, filtRelease: 0.12,
      ampAttack: 0.002, ampDecay: 0.28, ampSustain: 0.55, ampRelease: 0.08,
      velAmount: 1,
      drive: 0.34, driveMode: "tube",
      mono: true, glide: 0.055,
      delayTime: 0.375, delayFeedback: 0.3, delayMix: 0.14,
      reverbMix: 0.06, tone: 12500, masterGain: 0.7,
    }),
  },
  {
    id: "fm-bass", name: "FM Punch Bass", desc: "Tight metallic FM stab", category: "Bass",
    patch: P({
      oscATable: "bell", oscAPos: 0.2, oscAEnv: 0.5, oscALevel: 0.7,
      oscBTable: "basic", oscBPos: 0.15, oscBOctave: -1, oscBLevel: 0.4,
      unison: 1, subWave: "sine", subLevel: 0.5,
      fmAmount: 0.28, fmRatio: 2,
      filterType: "lowpass", filterCutoff: 1400, filterResonance: 3,
      filterEnvAmount: 0.4, filtDecay: 0.16, filtSustain: 0.2,
      modAttack: 0.002, modDecay: 0.18, modSustain: 0.1,
      ampAttack: 0.003, ampDecay: 0.22, ampSustain: 0.55, ampRelease: 0.18,
      drive: 0.2, mono: true, glide: 0.04, tone: 12000, masterGain: 0.8,
    }),
  },
  {
    id: "macro-morph", name: "Macro Morph", desc: "Macro 1 sweeps the whole timbre", category: "Bass",
    patch: P({
      oscATable: "growl", oscAPos: 0.4, oscBTable: "saw", oscBPos: 0.5, oscBDetune: 14,
      unison: 3, unisonDetune: 16, unisonWidth: 0.5, subWave: "square", subLevel: 0.5,
      filterType: "lowpass", filterCutoff: 600, filterResonance: 6, filterEnvAmount: 0.2,
      macro1: 0.3, drift: 0.18,
      modMatrix: makeModMatrix([MR("macro1", "cutoff", 0.8), MR("macro1", "wtA", 0.5), MR("lfo1", "resonance", 0.2)]),
      lfo1Wave: "triangle", lfo1Rate: 2.4,
      ampAttack: 0.006, ampDecay: 0.35, ampSustain: 0.9, ampRelease: 0.25,
      drive: 0.28, mono: true, glide: 0.06, tone: 12000, masterGain: 0.8,
    }),
  },

  // ── Lead ──
  {
    id: "supersaw", name: "Supersaw Lead", desc: "Huge wide trance saw", category: "Lead",
    patch: P({
      oscATable: "saw", oscAPos: 0.85, oscAEnv: 0.15,
      oscBTable: "saw", oscBPos: 0.7, oscBDetune: 10,
      unison: 7, unisonDetune: 22, unisonWidth: 0.95,
      subLevel: 0.12, filterType: "lowpass", filterCutoff: 6500, filterResonance: 1,
      filterEnvAmount: 0.3, ampAttack: 0.02, ampRelease: 0.45,
      modAttack: 0.01, modDecay: 0.4, modSustain: 0.6,
      chorusRate: 0.5, chorusDepth: 0.5, chorusMix: 0.4,
      delayTime: 0.3, delayFeedback: 0.3, delayMix: 0.2,
      reverbSize: 2.6, reverbMix: 0.18,
      drive: 0.1, mono: false, tone: 16000, masterGain: 0.68,
    }),
  },
  {
    id: "plasma-lead", name: "Plasma Lead", desc: "Bright morphing lead, vibrato", category: "Lead",
    patch: P({
      oscATable: "harmonic", oscAPos: 0.35, oscAEnv: 0.35,
      oscBTable: "saw", oscBPos: 0.6, oscBDetune: 6,
      unison: 3, unisonDetune: 12, unisonWidth: 0.5, subLevel: 0.2,
      filterType: "lowpass", filterCutoff: 3200, filterResonance: 4,
      filterEnvAmount: 0.45, filtDecay: 0.25, filtSustain: 0.5,
      modAttack: 0.005, modDecay: 0.45, modSustain: 0.15,
      lfo1Wave: "sine", lfo1Rate: 5.5, lfo1Depth: 0.12, lfo1Dest: "pitch",
      delayTime: 0.25, delayFeedback: 0.3, delayMix: 0.15,
      reverbSize: 2, reverbMix: 0.14,
      drive: 0.22, mono: true, glide: 0.05, tone: 13000, masterGain: 0.78,
    }),
  },
  {
    id: "sync-screamer", name: "Sync Screamer", desc: "Hard-sync sweep lead", category: "Lead",
    patch: P({
      oscATable: "sync", oscAPos: 0.2, oscAEnv: 0.7,
      oscBTable: "saw", oscBPos: 0.6, oscBDetune: 8, oscBLevel: 0.4,
      unison: 3, unisonDetune: 14, unisonWidth: 0.6, subLevel: 0.15,
      filterType: "lowpass", filterCutoff: 4000, filterResonance: 3,
      filterEnvAmount: 0.4, modAttack: 0.005, modDecay: 0.6, modSustain: 0.25,
      delayTime: 0.27, delayFeedback: 0.35, delayMix: 0.18,
      reverbSize: 2, reverbMix: 0.12,
      drive: 0.28, mono: true, glide: 0.04, tone: 13500, masterGain: 0.76,
    }),
  },
  {
    id: "pluck-stack", name: "Pluck Stack", desc: "Snappy morphing pluck", category: "Pluck",
    patch: P({
      oscATable: "saw", oscAPos: 0.6, oscAEnv: -0.4,
      oscBTable: "harmonic", oscBPos: 0.5, oscBDetune: 7, oscBLevel: 0.45,
      unison: 3, unisonDetune: 14, unisonWidth: 0.7, subLevel: 0.18,
      filterType: "lowpass", filterCutoff: 5000, filterResonance: 4,
      filterEnvAmount: 0.5, filtDecay: 0.16, filtSustain: 0.1,
      modAttack: 0.001, modDecay: 0.18, modSustain: 0,
      ampAttack: 0.002, ampDecay: 0.2, ampSustain: 0.0, ampRelease: 0.25,
      delayTime: 0.27, delayFeedback: 0.38, delayMix: 0.28,
      reverbSize: 2.4, reverbMix: 0.22,
      drive: 0.12, mono: false, tone: 15000, masterGain: 0.74,
    }),
  },
  {
    id: "bell-keys", name: "Bell Keys", desc: "Glassy FM mallet", category: "Keys",
    patch: P({
      oscATable: "bell", oscAPos: 0.4, oscAEnv: -0.3, oscALevel: 0.8,
      oscBTable: "bell", oscBPos: 0.7, oscBOctave: 1, oscBDetune: 4, oscBLevel: 0.35,
      unison: 1, subLevel: 0.1,
      filterType: "lowpass", filterCutoff: 6000, filterResonance: 1,
      filterEnvAmount: 0.3, filtDecay: 0.4, filtSustain: 0.2,
      modAttack: 0.001, modDecay: 0.7, modSustain: 0,
      ampAttack: 0.002, ampDecay: 0.6, ampSustain: 0.25, ampRelease: 0.6,
      delayTime: 0.32, delayFeedback: 0.35, delayMix: 0.25,
      reverbSize: 3, reverbMix: 0.3,
      drive: 0.04, mono: false, tone: 16000, masterGain: 0.72,
    }),
  },
  {
    id: "triple-threat", name: "Triple Threat", desc: "All three oscillators, punchy + wide", category: "Lead",
    patch: P({
      oscATable: "saw", oscAPos: 0.7, oscALevel: 0.7,
      oscBTable: "sync", oscBPos: 0.45, oscBDetune: 9, oscBLevel: 0.5,
      oscCTable: "additive", oscCPos: 0.5, oscCOctave: 0, oscCDetune: -6, oscCLevel: 0.45,
      unison: 3, unisonDetune: 16, unisonWidth: 0.85, subLevel: 0.15,
      filterType: "lowpass", filterCutoff: 4200, filterResonance: 3,
      filterEnvAmount: 0.4, filtDecay: 0.3, filtSustain: 0.4,
      drive: 0.18, driveMode: "tube", punch: 0.4,
      delayTime: 0.26, delayFeedback: 0.34, delayMix: 0.16,
      reverbSize: 2.4, reverbMix: 0.2,
      mono: false, tone: 15000, masterGain: 0.68,
    }),
  },
  {
    id: "fuzz-saw", name: "Fuzz Saw", desc: "Aggressive fuzz-driven sync lead", category: "Lead",
    patch: P({
      oscATable: "sync", oscAPos: 0.3, oscAEnv: 0.5, oscALevel: 0.8,
      oscBTable: "saw", oscBPos: 0.6, oscBDetune: 12, oscBLevel: 0.5,
      unison: 3, unisonDetune: 18, unisonWidth: 0.7, subLevel: 0.2,
      filterType: "lowpass", filterCutoff: 3000, filterResonance: 4, filterEnvAmount: 0.45,
      drive: 0.45, driveMode: "fuzz", punch: 0.45, tone: 11000,
      delayTime: 0.24, delayFeedback: 0.36, delayMix: 0.18,
      reverbSize: 1.8, reverbMix: 0.14,
      mono: true, glide: 0.04, masterGain: 0.66,
    }),
  },

  // ── Pad ──
  {
    id: "morpheus", name: "Morpheus Pad", desc: "Evolving vowel/harmonic morph", category: "Pad",
    patch: P({
      oscATable: "vocal", oscAPos: 0.05, oscAEnv: 0.8,
      oscBTable: "harmonic", oscBPos: 0.2, oscBLfo: 0.4, oscBDetune: 7,
      unison: 4, unisonDetune: 16, unisonWidth: 0.85, subLevel: 0.15,
      filterType: "lowpass", filterCutoff: 2400, filterResonance: 2,
      ampAttack: 1.0, ampDecay: 0.8, ampSustain: 0.85, ampRelease: 1.8,
      modAttack: 1.2, modDecay: 1.5, modSustain: 0.4, modRelease: 1.2,
      lfo1Wave: "sine", lfo1Rate: 0.18, lfo1Depth: 0.4, lfo1Dest: "filter",
      chorusRate: 0.35, chorusDepth: 0.6, chorusMix: 0.55,
      delayTime: 0.45, delayFeedback: 0.5, delayMix: 0.28,
      reverbSize: 4, reverbMix: 0.4,
      drive: 0.05, mono: false, tone: 14000, masterGain: 0.62,
    }),
  },
  {
    id: "hyperspace", name: "Hyperspace Pad", desc: "Lush warp-drive pad", category: "Pad",
    patch: P({
      oscATable: "harmonic", oscAPos: 0.3, oscALfo: 0.25,
      oscBTable: "saw", oscBPos: 0.5, oscBDetune: 12,
      unison: 5, unisonDetune: 16, unisonWidth: 0.8, subLevel: 0.2,
      filterType: "lowpass", filterCutoff: 1800, filterResonance: 1,
      filterEnvAmount: 0.3, filtAttack: 0.6, filtDecay: 0.8, filtSustain: 0.6,
      ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 1.4,
      lfo1Wave: "sine", lfo1Rate: 0.3, lfo1Depth: 0.5, lfo1Dest: "filter",
      chorusRate: 0.4, chorusDepth: 0.6, chorusMix: 0.5,
      delayTime: 0.4, delayFeedback: 0.5, delayMix: 0.28,
      reverbSize: 3.5, reverbMix: 0.32,
      drive: 0.05, mono: false, tone: 14000, masterGain: 0.64,
    }),
  },
  {
    id: "glass-choir", name: "Glass Choir", desc: "Shimmering vocal cathedral", category: "Pad",
    patch: P({
      oscATable: "vocal", oscAPos: 0.4, oscALfo: 0.2,
      oscBTable: "vocal", oscBPos: 0.7, oscBOctave: 1, oscBDetune: 6, oscBLevel: 0.4,
      unison: 4, unisonDetune: 14, unisonWidth: 0.9, subLevel: 0.12,
      filterType: "lowpass", filterCutoff: 3200, filterResonance: 1,
      ampAttack: 1.2, ampDecay: 1.0, ampSustain: 0.9, ampRelease: 2.2,
      lfo1Wave: "sine", lfo1Rate: 0.12, lfo1Depth: 0.3, lfo1Dest: "pan",
      chorusRate: 0.3, chorusDepth: 0.7, chorusMix: 0.6,
      reverbSize: 5, reverbMix: 0.5,
      drive: 0.03, mono: false, tone: 15000, masterGain: 0.6,
    }),
  },
  {
    id: "phase-nebula", name: "Phase Nebula", desc: "Swirling 3-osc phaser pad", category: "Pad",
    patch: P({
      oscATable: "additive", oscAPos: 0.4, oscALfo: 0.2, oscALevel: 0.65,
      oscBTable: "formant2", oscBPos: 0.5, oscBDetune: 9, oscBLevel: 0.5,
      oscCTable: "saw", oscCPos: 0.5, oscCOctave: -1, oscCDetune: -7, oscCLevel: 0.4,
      unison: 3, unisonDetune: 14, unisonWidth: 0.9, subLevel: 0.18,
      filterType: "lowpass", filterCutoff: 2200, filterResonance: 2,
      ampAttack: 0.9, ampDecay: 0.7, ampSustain: 0.88, ampRelease: 1.8,
      lfo1Wave: "sine", lfo1Rate: 0.16, lfo1Depth: 0.4, lfo1Dest: "filter",
      phaserRate: 0.25, phaserDepth: 0.8, phaserMix: 0.5,
      chorusRate: 0.3, chorusDepth: 0.5, chorusMix: 0.4,
      reverbSize: 4, reverbMix: 0.4,
      drive: 0.05, mono: false, tone: 14000, masterGain: 0.6,
    }),
  },
  {
    id: "mothership", name: "Mothership Drone", desc: "Ominous low hover", category: "Pad",
    patch: P({
      oscATable: "vocal", oscAPos: 0.2, oscALfo: 0.15,
      oscBTable: "growl", oscBPos: 0.4, oscBOctave: -1, oscBLevel: 0.4,
      unison: 2, unisonDetune: 10, unisonWidth: 0.6, oscALevel: 0.6, subLevel: 0.7,
      ringAmount: 0.12, ringFreq: 55,
      filterType: "lowpass", filterCutoff: 600, filterResonance: 2,
      ampAttack: 0.6, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.2,
      lfo1Wave: "sine", lfo1Rate: 0.15, lfo1Depth: 0.4, lfo1Dest: "filter",
      reverbSize: 4.5, reverbMix: 0.3,
      drive: 0.15, mono: false, tone: 9000, masterGain: 0.66,
    }),
  },
  {
    id: "star-cruiser", name: "Star Cruiser", desc: "Slow autopanning drift", category: "Pad",
    patch: P({
      oscATable: "harmonic", oscAPos: 0.3, oscALfo: 0.2, oscBTable: "saw", oscBPos: 0.55, oscBDetune: 8,
      unison: 5, unisonDetune: 16, unisonWidth: 0.9, subLevel: 0.25,
      filterType: "lowpass", filterCutoff: 1200, filterResonance: 2,
      ampAttack: 0.7, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 1.4,
      lfo1Wave: "sine", lfo1Rate: 0.2, lfo1Depth: 0.8, lfo1Dest: "pan",
      lfo2Wave: "sine", lfo2Rate: 0.13, lfo2Depth: 0.3, lfo2Dest: "filter",
      chorusRate: 0.3, chorusDepth: 0.5, chorusMix: 0.4,
      delayTime: 0.5, delayFeedback: 0.45, delayMix: 0.22,
      reverbSize: 3.5, reverbMix: 0.3,
      drive: 0.08, mono: false, tone: 12000, masterGain: 0.66,
    }),
  },

  // ── FX ──
  {
    id: "transformer", name: "Transformer", desc: "Metallic servo morph", category: "FX",
    patch: P({
      oscATable: "metallic", oscAPos: 0.3, oscAEnv: 0.5,
      oscBTable: "saw", oscBPos: 0.4, oscBOctave: -1, oscBLevel: 0.4,
      unison: 1, oscALevel: 0.7, subLevel: 0.2,
      fmAmount: 0.3, fmRatio: 2, ringAmount: 0.18, ringFreq: 130,
      filterType: "lowpass", filterCutoff: 1400, filterResonance: 3, filterEnvAmount: 0.35,
      modAttack: 0.005, modDecay: 0.5, modSustain: 0.2, modRelease: 0.3,
      pitchEnvAmount: 4, pitchEnvTime: 0.3,
      ampAttack: 0.004, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.25,
      drive: 0.3, crush: 0.15, mono: false, tone: 9000, masterGain: 0.78,
    }),
  },
  {
    id: "tie-fighter", name: "TIE Fighter", desc: "Screaming ion engine", category: "FX",
    patch: P({
      oscATable: "metallic", oscAPos: 0.6, oscBTable: "saw", oscBPos: 0.7, oscBDetune: 22,
      unison: 2, unisonDetune: 14, unisonWidth: 0.5,
      oscALevel: 0.7, oscBLevel: 0.5, noiseLevel: 0.22, subLevel: 0.1,
      ringAmount: 0.15, ringFreq: 80,
      filterType: "bandpass", filterCutoff: 1200, filterResonance: 3,
      ampAttack: 0.05, ampDecay: 0.3, ampSustain: 0.9, ampRelease: 0.3,
      lfo1Wave: "sine", lfo1Rate: 6, lfo1Depth: 0.2, lfo1Dest: "pitch",
      drive: 0.3, mono: true, glide: 0.12, tone: 8000, masterGain: 0.7,
    }),
  },
  {
    id: "laser", name: "Laser Blaster", desc: "Pew-pew with ping-pong + verb", category: "FX",
    patch: P({
      oscATable: "basic", oscAPos: 1, oscBTable: "sync", oscBPos: 0.5, oscBDetune: 10, oscBLevel: 0.3,
      unison: 1, subLevel: 0, filterType: "lowpass", filterCutoff: 6000, filterResonance: 2,
      ampAttack: 0.001, ampDecay: 0.16, ampSustain: 0, ampRelease: 0.12,
      pitchEnvAmount: 36, pitchEnvTime: 0.16,
      delayTime: 0.16, delayFeedback: 0.42, delayMix: 0.4,
      reverbSize: 2, reverbMix: 0.2,
      mono: true, glide: 0, drive: 0.15, tone: 16000, masterGain: 0.82,
    }),
  },

  // ── Seq ──
  {
    id: "computer-talk", name: "Computer Talk", desc: "Random S&H robot chatter", category: "Arp",
    patch: P({
      oscATable: "basic", oscAPos: 0.85, oscALfo: 0.4, oscBTable: "basic", oscBPos: 0.85, oscBDetune: 4, unison: 1,
      filterType: "lowpass", filterCutoff: 3000, filterResonance: 4,
      lfo1Wave: "sample-hold", lfo1Rate: 9, lfo1Depth: 0.55, lfo1Dest: "pitch",
      ampAttack: 0.001, ampDecay: 0.08, ampSustain: 0.3, ampRelease: 0.05,
      crush: 0.3, delayTime: 0.18, delayFeedback: 0.25, delayMix: 0.25,
      reverbSize: 1.6, reverbMix: 0.12,
      mono: false, tone: 11000, masterGain: 0.78,
    }),
    arp: { enabled: true, mode: "random", bpm: 150, division: "1/16", octaves: 2, gate: 0.5 },
  },
  {
    id: "warp-seq", name: "Warp Sequence", desc: "Driving arp with morph + ping-pong", category: "Arp",
    patch: P({
      oscATable: "saw", oscAPos: 0.5, oscAEnv: 0.4, oscBTable: "saw", oscBPos: 0.6, oscBDetune: 9,
      unison: 3, unisonDetune: 14, unisonWidth: 0.6,
      filterType: "lowpass", filterCutoff: 2200, filterResonance: 3,
      filterEnvAmount: 0.4, filtDecay: 0.18, filtSustain: 0.3,
      modAttack: 0.002, modDecay: 0.2, modSustain: 0.2, modRelease: 0.15,
      ampAttack: 0.003, ampDecay: 0.2, ampSustain: 0.5, ampRelease: 0.2,
      chorusMix: 0.3, delayTime: 0.22, delayFeedback: 0.45, delayMix: 0.3,
      reverbSize: 2, reverbMix: 0.16,
      drive: 0.12, mono: false, tone: 14000, masterGain: 0.74,
    }),
    arp: { enabled: true, mode: "up", bpm: 124, division: "1/16", octaves: 2, gate: 0.7 },
  },
  {
    id: "gate-rider", name: "Gate Rider", desc: "Trance-gated saw — chops to a pattern", category: "Arp",
    patch: P({
      oscATable: "saw", oscAPos: 0.7, oscBTable: "saw", oscBPos: 0.55, oscBDetune: 12,
      unison: 5, unisonDetune: 20, unisonWidth: 0.85, subLevel: 0.15,
      filterType: "lowpass", filterCutoff: 5200, filterResonance: 2, filterEnvAmount: 0.2,
      ampAttack: 0.01, ampDecay: 0.3, ampSustain: 0.9, ampRelease: 0.3,
      gateOn: true, gateRate: 8, gateDepth: 1, gateSteps: 16,
      gatePattern: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
      modMatrix: makeModMatrix([MR("macro1", "cutoff", 0.6)]),
      chorusMix: 0.3, delayTime: 0.26, delayFeedback: 0.34, delayMix: 0.18,
      reverbSize: 2.4, reverbMix: 0.2,
      drive: 0.12, mono: false, tone: 15000, masterGain: 0.7,
    }),
  },
];

/** Full factory bank: flagships first, then the generated arsenal (~500 total). */
export const FIRE_PRESETS: FirePreset[] = [...FLAGSHIP_PRESETS, ...MISSION_SHOWCASE_PRESETS, ...GENERATED_PRESETS];

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
    spectralMode: "off", spectralAmount: 0.6, spectralMix: 0.5,
    macro1: rand(0, 1), macro2: rand(0, 1), macro3: 0, macro4: 0,
    modMatrix: makeModMatrix(routes),
    drift: chance(0.5) ? rand(0.1, 0.5) : 0,
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
      const arp: ArpSettings = src.arp
        ? { ...DEFAULT_ARP, ...src.arp }
        : { ...get().arp, enabled: false };
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
      const arp: ArpSettings = rawArp && typeof rawArp === "object"
        ? { ...DEFAULT_ARP, ...(rawArp as Partial<ArpSettings>) }
        : { ...get().arp };
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
      // One source at a time: the first key silences the file player and any
      // media playing in Airspace (dynamic-import arbiter, ~free when idle).
      if (s.heldNotes.length === 0 && s.arpOrder.length === 0) {
        void import("@/lib/sourceArbiter").then(({ claimSource }) => claimSource("fire"));
      }
      // v1.6: capture into the piano roll when REC is armed + playing.
      // All live inputs funnel through here (QWERTY, on-screen keys, MIDI).
      useFireSequencerStore.getState().recordNoteOn(midi, velocity);
      if (s.arp.enabled) {
        // Feed the arp pattern; the scheduler sounds the notes.
        const freshLatch = s.arp.hold && s.heldNotes.length === 0;
        const arpOrder = freshLatch ? [] : [...s.arpOrder];
        if (!arpOrder.includes(midi)) arpOrder.push(midi);
        const heldNotes = s.heldNotes.includes(midi) ? s.heldNotes : [...s.heldNotes, midi];
        set({ arpOrder, heldNotes });
        // The scheduler parks itself when the pattern empties — re-arm it.
        if (arpTimer === null) startArpScheduler(get, set);
        return;
      }
      const engine = getEngine();
      void engine.resume();
      engine.fireCommand.noteOn(midi, velocity);
      // Harmonizer (v1.7): scale-locked companions ride along at reduced
      // velocity. Live input only — the sequencer schedules notes directly.
      const mode = s.patch.harmonyMode ?? "off";
      if (mode !== "off" && !harmonyHeld.has(midi)) {
        const comps = harmonyCompanions(midi, mode).filter((c) => c <= 127);
        const lvl = clamp(s.patch.harmonyLevel ?? 0.6, 0, 1);
        for (const c of comps) engine.fireCommand.noteOn(c, velocity * lvl);
        harmonyHeld.set(midi, comps);
      }
      if (!s.heldNotes.includes(midi)) set({ heldNotes: [...s.heldNotes, midi] });
    },

    noteOff: (midi) => {
      const s = get();
      useFireSequencerStore.getState().recordNoteOff(midi);
      if (s.arp.enabled) {
        const heldNotes = s.heldNotes.filter((n) => n !== midi);
        const arpOrder = s.arp.hold ? s.arpOrder : s.arpOrder.filter((n) => n !== midi);
        set({ heldNotes, arpOrder });
        return;
      }
      const engine = getEngine();
      engine.fireCommand.noteOff(midi);
      const comps = harmonyHeld.get(midi);
      if (comps) {
        harmonyHeld.delete(midi);
        for (const c of comps) engine.fireCommand.noteOff(c);
      }
      set({ heldNotes: s.heldNotes.filter((n) => n !== midi) });
    },

    panic: () => {
      stopArpScheduler();
      harmonyHeld.clear();
      getEngine().fireCommand.allNotesOff();
      set({ heldNotes: [], arpOrder: [], arpCurrent: null, arpStepIndex: -1 });
      // Keep arp enabled flag, just restart the (now-empty) scheduler if on.
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
