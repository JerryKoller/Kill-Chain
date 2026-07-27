/**
 * Mission showcase presets — capability demos for Fire Command (not genre packs).
 * Each one puts a major synthesis system front and center.
 */

import {
  DEFAULT_FIRE_PATCH,
  makeModMatrix,
  type FirePatch,
  type ModRoute,
  type ModSource,
  type ModDest,
} from "./FireCommandSynth";
import type { FirePreset } from "./firePresetBank";

const P = (over: Partial<FirePatch>): FirePatch => ({ ...DEFAULT_FIRE_PATCH, ...over });
const MR = (source: ModSource, dest: ModDest, amount: number): ModRoute => ({ source, dest, amount });

/** Five capability showcases — also appear in the factory browser under their sonic category. */
export const MISSION_SHOWCASE_PRESETS: FirePreset[] = [
  {
    id: "ms-cap-unison",
    name: "Capability · Unison Width",
    desc: "Five-voice detuned choir with stereo width pushed — hear the unison and M/S stage",
    category: "Pad",
    patch: P({
      oscATable: "saw", oscAPos: 0.45, oscALevel: 0.7, oscADetune: -6,
      oscBTable: "saw", oscBPos: 0.55, oscBLevel: 0.55, oscBDetune: 9,
      oscCTable: "harmonic", oscCPos: 0.35, oscCLevel: 0.35, oscCOctave: 1, oscCDetune: 4,
      unison: 5, unisonDetune: 26, unisonWidth: 0.95,
      subWave: "sine", subLevel: 0.2,
      filterType: "lowpass", filterCutoff: 4200, filterResonance: 1.8,
      ampAttack: 0.35, ampDecay: 0.6, ampSustain: 0.95, ampRelease: 1.4,
      chorusRate: 0.35, chorusDepth: 0.55, chorusMix: 0.4,
      reverbSize: 3.5, reverbMix: 0.32, reverbDiffusion: 0.85,
      stereoWidth: 1.25, punch: 0.15,
      masterGain: 0.78,
      modMatrix: makeModMatrix([
        MR("macro1", "cutoff", 0.55),
        MR("macro2", "levelA", 0.35),
      ]),
    }),
  },
  {
    id: "ms-cap-fm",
    name: "Capability · Cross-FM Forge",
    desc: "Classic FM + B→A cross-mod + ring — metallic punch that shows the FM · Ring rack",
    category: "FM",
    patch: P({
      oscATable: "bell", oscAPos: 0.25, oscAEnv: 0.45, oscALevel: 0.8,
      oscBTable: "basic", oscBPos: 0.1, oscBOctave: 0, oscBLevel: 0.55, oscBDetune: 3,
      oscCLevel: 0,
      unison: 1, subLevel: 0.15,
      fmAmount: 0.62, fmRatio: 3, fmBtoA: 0.45,
      ringAmount: 0.22, ringFreq: 440,
      filterType: "lowpass", filterCutoff: 5200, filterResonance: 3.5,
      filterEnvAmount: 0.55, filtDecay: 0.28, filtSustain: 0.15,
      ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.45, ampRelease: 0.28,
      drive: 0.22, driveMode: "tube",
      delayTime: 0.28, delayFeedback: 0.28, delayMix: 0.18,
      reverbSize: 2.2, reverbMix: 0.16,
      mono: true, glide: 0.04,
      masterGain: 0.74,
      modMatrix: makeModMatrix([
        MR("modenv", "fm", 0.4),
        MR("velocity", "cutoff", 0.45),
      ]),
    }),
  },
  {
    id: "ms-cap-spectral",
    name: "Capability · Spectral Freeze",
    desc: "Sustain a note and hear the spectral freeze lattice hold the partials",
    category: "Atmos",
    patch: P({
      oscATable: "harmonic", oscAPos: 0.4, oscALevel: 0.65, oscALfo: 0.12,
      oscBTable: "vocal", oscBPos: 0.3, oscBLevel: 0.4, oscBDetune: 7,
      oscCTable: "metallic", oscCPos: 0.5, oscCLevel: 0.25, oscCOctave: 1,
      unison: 3, unisonDetune: 10, unisonWidth: 0.7,
      filterType: "bandpass", filterCutoff: 1800, filterResonance: 2.2,
      ampAttack: 0.6, ampDecay: 0.8, ampSustain: 1, ampRelease: 2.2,
      lfo1Wave: "sine", lfo1Rate: 0.15, lfo1Depth: 0.3, lfo1Dest: "filter",
      reverbSize: 4.5, reverbMix: 0.42, reverbDamp: 0.35,
      spectralMode: "freeze", spectralAmount: 0.72, spectralMix: 0.65,
      chorusMix: 0.2,
      masterGain: 0.72,
      modMatrix: makeModMatrix([
        MR("macro1", "reverb", 0.5),
        MR("lfo2", "pan", 0.35),
      ]),
      lfo2Wave: "sine", lfo2Rate: 0.08, lfo2Depth: 0.4, lfo2Dest: "pan",
    }),
  },
  {
    id: "ms-cap-gate",
    name: "Capability · Gate · Matrix Pulse",
    desc: "Trance gate chopping a bright pad while macros drive cutoff and delay",
    category: "Pad",
    patch: P({
      oscATable: "saw", oscAPos: 0.5, oscALevel: 0.7,
      oscBTable: "pulse", oscBPos: 0.4, oscBLevel: 0.45, oscBDetune: 8,
      oscCLevel: 0,
      unison: 3, unisonDetune: 14, unisonWidth: 0.75,
      filterType: "lowpass", filterCutoff: 2800, filterResonance: 4,
      ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.9, ampRelease: 0.4,
      gateOn: true, gateRate: 8, gateDepth: 0.92, gateSteps: 16,
      gatePattern: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1],
      gateSmooth: 0.12,
      delayTime: 0.375, delayFeedback: 0.4, delayMix: 0.28,
      reverbSize: 2.8, reverbMix: 0.22,
      phaserRate: 0.35, phaserDepth: 0.5, phaserMix: 0.25,
      macro1: 0.55, macro2: 0.4,
      masterGain: 0.76,
      modMatrix: makeModMatrix([
        MR("macro1", "cutoff", 0.7),
        MR("macro2", "delay", 0.55),
        MR("lfo1", "wtA", 0.25),
      ]),
      lfo1Wave: "triangle", lfo1Rate: 0.4, lfo1Depth: 0.35, lfo1Dest: "off",
    }),
  },
  {
    id: "ms-cap-vintage",
    name: "Capability · Vintage Age Bus",
    desc: "Cassette generation, wow/flutter, hiss and VHS color — the Age stage in full",
    category: "Vintage",
    patch: P({
      oscATable: "saw", oscAPos: 0.35, oscALevel: 0.7,
      oscBTable: "pulse", oscBPos: 0.45, oscBLevel: 0.4, oscBDetune: 11,
      oscCTable: "basic", oscCPos: 0.2, oscCLevel: 0.2, oscCOctave: -1,
      unison: 3, unisonDetune: 12, unisonWidth: 0.55,
      filterType: "lowpass", filterCutoff: 2400, filterResonance: 2.5,
      ampAttack: 0.04, ampDecay: 0.4, ampSustain: 0.85, ampRelease: 0.55,
      chorusMix: 0.15, delayMix: 0.12, reverbMix: 0.18, reverbSize: 2.4,
      cassetteGen: 0.72, tapeSpeed: 0.35, wowFlutter: 0.55,
      vhsColor: 0.4, hiss: 0.35, dust: 0.25, hum: 0.15,
      bbdChorus: 0.45, analogComp: 0.35, printThrough: 0.2,
      bitDepth: "12bit", sampleRateReduce: 0.25,
      drift: 0.35, driftRate: 0.4, voiceInstability: 0.2, tuneVariance: 0.15,
      masterGain: 0.74,
    }),
  },
];
