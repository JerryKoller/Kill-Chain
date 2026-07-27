import {
  DEFAULT_FIRE_PATCH,
  makeModMatrix,
  type FirePatch,
  type ModRoute,
  type ModSource,
  type ModDest,
} from "./FireCommandSynth";
import type { FirePreset, PresetCategory, PresetArp } from "./firePresetBank";

const P = (over: Partial<FirePatch>): FirePatch => ({ ...DEFAULT_FIRE_PATCH, ...over });
const MR = (source: ModSource, dest: ModDest, amount: number): ModRoute => ({ source, dest, amount });

function preset(
  id: string,
  name: string,
  desc: string,
  category: PresetCategory,
  patch: Partial<FirePatch>,
  arp?: PresetArp,
): FirePreset {
  return { id, name, desc, category, patch: P(patch), arp };
}

export const CURATED_PRESETS: FirePreset[] = [
  // ===== BASS (20) =====
  preset("fc-bass-sub-sine", "Sub Sine Boom", "Pure sub bass with sine wave", "Bass", {
    oscATable: "basic",
    oscALevel: 0.8,
    oscBTable: "basic",
    oscBLevel: 0.5,
    oscBOctave: -1,
    filterType: "lowpass",
    filterCutoff: 800,
    filterResonance: 0.1,
    filterEnvAmount: 0.3,
    ampAttack: 0.001,
    ampDecay: 0.4,
    ampSustain: 0.3,
    ampRelease: 0.5,
    mono: true
}),

  preset("fc-bass-reese", "Reese Detune", "Classic detuned bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "saw",
    oscBLevel: 0.7,
    oscBDetune: 0.15,
    filterType: "lowpass",
    filterCutoff: 1200,
    filterResonance: 0.3,
    filterEnvAmount: 0.5,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.3,
    unison: 3,
    unisonDetune: 0.2,
    mono: true
}),

  preset("fc-bass-acid-squelch", "Acid Squelch", "Mono acid bass with resonance", "Bass", {
    oscATable: "saw",
    oscALevel: 0.8,
    filterType: "lowpass",
    filterCutoff: 600,
    filterResonance: 0.75,
    filterEnvAmount: 0.85,
    filtAttack: 0.001,
    filtDecay: 0.35,
    filtSustain: 0.1,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.6,
    ampRelease: 0.1,
    glide: 0.08,
    mono: true
}),

  preset("fc-bass-fm-punch", "FM Punch", "FM bass with attack", "Bass", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.5,
    fmAmount: 0.4,
    ringAmount: 0.3,
    filterType: "lowpass",
    filterCutoff: 1600,
    filterResonance: 0.2,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.7,
    ampRelease: 0.2,
    mono: true
}),

  preset("fc-bass-vocal-morph", "Talking Bass", "Vocal formant bass", "Bass", {
    oscATable: "vocal",
    oscALevel: 0.6,
    oscBTable: "formant2",
    oscBLevel: 0.6,
    oscBOctave: -1,
    filterType: "bandpass",
    filterCutoff: 1400,
    filterResonance: 0.5,
    filterEnvAmount: 0.4,
    ampAttack: 0.01,
    ampDecay: 0.4,
    ampSustain: 0.5,
    ampRelease: 0.3,
    lfo1Rate: 4,
    lfo1Wave: "triangle",
    lfo1Depth: 0.5,
    lfo1Dest: "filter",
    mono: true
}),

  preset("fc-bass-growl-drive", "Growling Drive", "Distorted growl bass", "Bass", {
    oscATable: "growl",
    oscALevel: 0.7,
    oscBTable: "growl",
    oscBLevel: 0.7,
    oscBDetune: -0.08,
    filterType: "lowpass",
    filterCutoff: 1300,
    filterResonance: 0.6,
    filterDrive: 0.7,
    ampAttack: 0.005,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    mono: true
}),

  preset("fc-bass-808-thump", "808 Thump", "Clean 808-style bass", "Bass", {
    oscATable: "basic",
    oscALevel: 0.9,
    filterType: "lowpass",
    filterCutoff: 1800,
    filterResonance: 0.1,
    ampAttack: 0.001,
    ampDecay: 0.8,
    ampSustain: 0,
    ampRelease: 0.1,
    pitchEnvAmount: 0.12,
    pitchEnvTime: 0.08,
    mono: true
}),

  preset("fc-bass-mid-stab", "Mid Bass Stab", "Punchy mid-range bass", "Bass", {
    oscATable: "pulse",
    oscAPos: 0.3,
    oscALevel: 0.7,
    oscBTable: "saw",
    oscBLevel: 0.3,
    oscBOctave: 1,
    filterType: "lowpass",
    filterCutoff: 2000,
    filterResonance: 0.4,
    filterEnvAmount: 0.6,
    ampAttack: 0.001,
    ampDecay: 0.2,
    ampSustain: 0.4,
    ampRelease: 0.15
}),

  preset("fc-bass-wobble-lfo", "Wobble LFO", "Filtered wobble bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "pulse",
    oscBPos: 0.2,
    oscBLevel: 0.6,
    filterType: "lowpass",
    filterCutoff: 900,
    filterResonance: 0.7,
    lfo1Rate: 8,
    lfo1Wave: "sine",
    lfo1Depth: 0.8,
    lfo1Dest: "filter",
    ampAttack: 0.01,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 0.3,
    mono: true
}),

  preset("fc-bass-noisy-dirt", "Noisy Dirt", "Lo-fi dirty bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "pulse",
    oscBPos: 0.6,
    oscBLevel: 0.6,
    noiseLevel: 0.15,
    filterType: "lowpass",
    filterCutoff: 1400,
    filterResonance: 0.3,
    filterDrive: 0.5,
    ampAttack: 0.01,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    crush: 0.3,
    mono: true
}),

  preset("fc-bass-glide-port", "Glide Portamento", "Smooth gliding bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "pulse",
    oscBPos: 0.4,
    oscBLevel: 0.5,
    oscBOctave: -1,
    filterType: "lowpass",
    filterCutoff: 1600,
    filterResonance: 0.3,
    glide: 0.25,
    mono: true,
    ampAttack: 0.02,
    ampDecay: 0.6,
    ampSustain: 0.7,
    ampRelease: 0.4
}),

  preset("fc-bass-soft-triangle", "Soft Triangle Under", "Mellow triangle bass", "Bass", {
    oscATable: "basic",
    oscAPos: 0.5,
    oscALevel: 0.8,
    oscBTable: "basic",
    oscBPos: 0.5,
    oscBLevel: 0.5,
    oscBOctave: -1,
    filterType: "lowpass",
    filterCutoff: 1800,
    filterResonance: 0.15,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-bass-wide-unison", "Wide Unison Monster", "Massive unison bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "saw",
    oscBLevel: 0.7,
    oscBDetune: 0.1,
    filterType: "lowpass",
    filterCutoff: 1400,
    filterResonance: 0.4,
    unison: 5,
    unisonDetune: 0.3,
    unisonWidth: 0.8,
    ampAttack: 0.015,
    ampDecay: 0.6,
    ampSustain: 0.6,
    ampRelease: 0.4,
    mono: true
}),

  preset("fc-bass-formant", "Formant Bass", "Vowel-like bass", "Bass", {
    oscATable: "formant2",
    oscALevel: 0.7,
    oscBTable: "vocal",
    oscBLevel: 0.6,
    filterType: "bandpass",
    filterCutoff: 1200,
    filterResonance: 0.6,
    ampAttack: 0.01,
    ampDecay: 0.5,
    ampSustain: 0.5,
    ampRelease: 0.3,
    mono: true
}),

  preset("fc-bass-sync-sweep", "Sync Sweep Bass", "Hard sync bass sweep", "Bass", {
    oscATable: "sync",
    oscAPos: 0.6,
    oscALevel: 0.7,
    oscBTable: "saw",
    oscBLevel: 0.6,
    filterType: "lowpass",
    filterCutoff: 1600,
    filterResonance: 0.5,
    filterEnvAmount: 0.5,
    ampAttack: 0.01,
    ampDecay: 0.5,
    ampSustain: 0.5,
    ampRelease: 0.3,
    mono: true
}),

  preset("fc-bass-crushed-lofi", "Crushed Lo-Fi", "Bitcrushed bass", "Bass", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    oscBTable: "saw",
    oscBLevel: 0.6,
    filterType: "lowpass",
    filterCutoff: 1400,
    filterResonance: 0.2,
    crush: 0.6,
    sampleRateReduce: 0.4,
    ampAttack: 0.01,
    ampDecay: 0.4,
    ampSustain: 0.5,
    ampRelease: 0.3,
    mono: true
}),

  preset("fc-bass-pitch-env", "Pitch Env Thump", "Pitch envelope bass hit", "Bass", {
    oscATable: "saw",
    oscALevel: 0.8,
    filterType: "lowpass",
    filterCutoff: 1600,
    filterResonance: 0.3,
    pitchEnvAmount: 0.2,
    pitchEnvTime: 0.15,
    ampAttack: 0.001,
    ampDecay: 0.6,
    ampSustain: 0.3,
    ampRelease: 0.2,
    mono: true
}),

  preset("fc-bass-ring-metal", "Ring Mod Metal", "Metallic ring mod bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "metallic",
    oscBLevel: 0.6,
    ringAmount: 0.6,
    filterType: "lowpass",
    filterCutoff: 1800,
    filterResonance: 0.3,
    ampAttack: 0.01,
    ampDecay: 0.5,
    ampSustain: 0.5,
    ampRelease: 0.3,
    mono: true
}),

  preset("fc-bass-dual-oct", "Dual Octave Stack", "Two octave bass stack", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "saw",
    oscBLevel: 0.6,
    oscBOctave: -1,
    filterType: "lowpass",
    filterCutoff: 1600,
    filterResonance: 0.3,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-bass-airy-high", "Airy High Bass", "High-passed airy bass", "Bass", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "pulse",
    oscBPos: 0.3,
    oscBLevel: 0.5,
    oscBOctave: 1,
    filterType: "highpass",
    filterCutoff: 1400,
    filterResonance: 0.2,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5,
    reverbMix: 0.15
}),


  // ===== LEAD (20) =====
  preset("fc-lead-0", "Lead 0", "Lead preset 0", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-1", "Lead 1", "Lead preset 1", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-2", "Lead 2", "Lead preset 2", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-3", "Lead 3", "Lead preset 3", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-4", "Lead 4", "Lead preset 4", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-5", "Lead 5", "Lead preset 5", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-6", "Lead 6", "Lead preset 6", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-7", "Lead 7", "Lead preset 7", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-8", "Lead 8", "Lead preset 8", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-9", "Lead 9", "Lead preset 9", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-10", "Lead 10", "Lead preset 10", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-11", "Lead 11", "Lead preset 11", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-12", "Lead 12", "Lead preset 12", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3400,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-13", "Lead 13", "Lead preset 13", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3450,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-14", "Lead 14", "Lead preset 14", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3500,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-15", "Lead 15", "Lead preset 15", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3550,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-16", "Lead 16", "Lead preset 16", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3600,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-17", "Lead 17", "Lead preset 17", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3650,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-18", "Lead 18", "Lead preset 18", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3700,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),

  preset("fc-lead-19", "Lead 19", "Lead preset 19", "Lead", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3750,
    ampAttack: 0.02,
    ampDecay: 0.3,
    ampSustain: 0.75,
    ampRelease: 0.25,
    mono: true
}),


  // ===== PLUCK (20) =====
  preset("fc-pluck-0", "Pluck 0", "Pluck preset 0", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2400,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-1", "Pluck 1", "Pluck preset 1", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2450,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-2", "Pluck 2", "Pluck preset 2", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2500,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-3", "Pluck 3", "Pluck preset 3", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2550,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-4", "Pluck 4", "Pluck preset 4", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2600,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-5", "Pluck 5", "Pluck preset 5", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2650,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-6", "Pluck 6", "Pluck preset 6", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2700,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-7", "Pluck 7", "Pluck preset 7", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2750,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-8", "Pluck 8", "Pluck preset 8", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-9", "Pluck 9", "Pluck preset 9", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-10", "Pluck 10", "Pluck preset 10", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-11", "Pluck 11", "Pluck preset 11", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-12", "Pluck 12", "Pluck preset 12", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-13", "Pluck 13", "Pluck preset 13", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-14", "Pluck 14", "Pluck preset 14", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-15", "Pluck 15", "Pluck preset 15", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-16", "Pluck 16", "Pluck preset 16", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-17", "Pluck 17", "Pluck preset 17", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-18", "Pluck 18", "Pluck preset 18", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),

  preset("fc-pluck-19", "Pluck 19", "Pluck preset 19", "Pluck", {
    oscATable: "pulse",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.1,
    ampRelease: 0.2
}),


  // ===== PAD (20) =====
  preset("hyperspace", "Hyperspace Pad", "Lush hyperspace pad", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    oscBTable: "pulse",
    oscBPos: 0.3,
    oscBLevel: 0.6,
    oscBDetune: 0.1,
    filterType: "lowpass",
    filterCutoff: 2600,
    filterResonance: 0.3,
    ampAttack: 0.5,
    ampDecay: 0.6,
    ampSustain: 0.8,
    ampRelease: 1,
    unison: 5,
    unisonDetune: 0.2,
    unisonWidth: 0.7,
    reverbMix: 0.4,
    chorusMix: 0.3
}),

  preset("fc-pad-1", "Pad 1", "Pad preset 1", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2450,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-2", "Pad 2", "Pad preset 2", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2500,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-3", "Pad 3", "Pad preset 3", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2550,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-4", "Pad 4", "Pad preset 4", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2600,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-5", "Pad 5", "Pad preset 5", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2650,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-6", "Pad 6", "Pad preset 6", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2700,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-7", "Pad 7", "Pad preset 7", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2750,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-8", "Pad 8", "Pad preset 8", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-9", "Pad 9", "Pad preset 9", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-10", "Pad 10", "Pad preset 10", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-11", "Pad 11", "Pad preset 11", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-12", "Pad 12", "Pad preset 12", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-13", "Pad 13", "Pad preset 13", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-14", "Pad 14", "Pad preset 14", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-15", "Pad 15", "Pad preset 15", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-16", "Pad 16", "Pad preset 16", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-17", "Pad 17", "Pad preset 17", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-18", "Pad 18", "Pad preset 18", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),

  preset("fc-pad-19", "Pad 19", "Pad preset 19", "Pad", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.6,
    ampDecay: 0.5,
    ampSustain: 0.8,
    ampRelease: 1,
    reverbMix: 0.35
}),


  // ===== KEYS (20) =====
  preset("fc-keys-0", "Keys 0", "Keys preset 0", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-1", "Keys 1", "Keys preset 1", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-2", "Keys 2", "Keys preset 2", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-3", "Keys 3", "Keys preset 3", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-4", "Keys 4", "Keys preset 4", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-5", "Keys 5", "Keys preset 5", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-6", "Keys 6", "Keys preset 6", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-7", "Keys 7", "Keys preset 7", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-8", "Keys 8", "Keys preset 8", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3400,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-9", "Keys 9", "Keys preset 9", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3450,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-10", "Keys 10", "Keys preset 10", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3500,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-11", "Keys 11", "Keys preset 11", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3550,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-12", "Keys 12", "Keys preset 12", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3600,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-13", "Keys 13", "Keys preset 13", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3650,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-14", "Keys 14", "Keys preset 14", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3700,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-15", "Keys 15", "Keys preset 15", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3750,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-16", "Keys 16", "Keys preset 16", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3800,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-17", "Keys 17", "Keys preset 17", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3850,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-18", "Keys 18", "Keys preset 18", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3900,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),

  preset("fc-keys-19", "Keys 19", "Keys preset 19", "Keys", {
    oscATable: "harmonic",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3950,
    ampAttack: 0.01,
    ampDecay: 0.6,
    ampSustain: 0.5,
    ampRelease: 0.4
}),


  // ===== ARP (20) =====
  preset("fc-arp-0", "Arp 0", "Arp preset 0", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-1", "Arp 1", "Arp preset 1", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-2", "Arp 2", "Arp preset 2", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-3", "Arp 3", "Arp preset 3", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-4", "Arp 4", "Arp preset 4", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-5", "Arp 5", "Arp preset 5", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-6", "Arp 6", "Arp preset 6", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-7", "Arp 7", "Arp preset 7", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-8", "Arp 8", "Arp preset 8", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-9", "Arp 9", "Arp preset 9", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-10", "Arp 10", "Arp preset 10", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-11", "Arp 11", "Arp preset 11", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-12", "Arp 12", "Arp preset 12", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3400,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-13", "Arp 13", "Arp preset 13", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3450,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-14", "Arp 14", "Arp preset 14", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3500,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-15", "Arp 15", "Arp preset 15", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3550,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-16", "Arp 16", "Arp preset 16", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3600,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-17", "Arp 17", "Arp preset 17", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3650,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-18", "Arp 18", "Arp preset 18", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3700,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),

  preset("fc-arp-19", "Arp 19", "Arp preset 19", "Arp", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3750,
    ampAttack: 0.001,
    ampDecay: 0.25,
    ampSustain: 0.3,
    ampRelease: 0.15
}, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.7 }),


  // ===== FX (20) =====
  preset("fc-fx-0", "FX 0", "FX preset 0", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2200,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-1", "FX 1", "FX preset 1", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2250,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-2", "FX 2", "FX preset 2", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2300,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-3", "FX 3", "FX preset 3", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2350,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-4", "FX 4", "FX preset 4", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2400,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-5", "FX 5", "FX preset 5", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2450,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-6", "FX 6", "FX preset 6", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2500,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-7", "FX 7", "FX preset 7", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2550,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-8", "FX 8", "FX preset 8", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2600,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-9", "FX 9", "FX preset 9", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2650,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-10", "FX 10", "FX preset 10", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2700,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-11", "FX 11", "FX preset 11", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2750,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-12", "FX 12", "FX preset 12", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2800,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-13", "FX 13", "FX preset 13", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2850,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-14", "FX 14", "FX preset 14", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2900,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-15", "FX 15", "FX preset 15", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 2950,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-16", "FX 16", "FX preset 16", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 3000,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-17", "FX 17", "FX preset 17", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 3050,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-18", "FX 18", "FX preset 18", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 3100,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),

  preset("fc-fx-19", "FX 19", "FX preset 19", "FX", {
    oscATable: "saw",
    oscALevel: 0.7,
    noiseLevel: 0.3,
    filterType: "bandpass",
    filterCutoff: 3150,
    ampAttack: 0.1,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.5
}),


  // ===== ATMOS (20) =====
  preset("fc-atmos-0", "Atmos 0", "Atmos preset 0", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2000,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-1", "Atmos 1", "Atmos preset 1", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2050,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-2", "Atmos 2", "Atmos preset 2", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2100,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-3", "Atmos 3", "Atmos preset 3", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2150,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-4", "Atmos 4", "Atmos preset 4", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2200,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-5", "Atmos 5", "Atmos preset 5", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2250,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-6", "Atmos 6", "Atmos preset 6", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2300,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-7", "Atmos 7", "Atmos preset 7", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2350,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-8", "Atmos 8", "Atmos preset 8", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2400,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-9", "Atmos 9", "Atmos preset 9", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2450,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-10", "Atmos 10", "Atmos preset 10", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2500,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-11", "Atmos 11", "Atmos preset 11", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2550,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-12", "Atmos 12", "Atmos preset 12", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2600,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-13", "Atmos 13", "Atmos preset 13", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2650,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-14", "Atmos 14", "Atmos preset 14", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2700,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-15", "Atmos 15", "Atmos preset 15", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2750,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-16", "Atmos 16", "Atmos preset 16", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2800,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-17", "Atmos 17", "Atmos preset 17", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2850,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-18", "Atmos 18", "Atmos preset 18", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2900,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),

  preset("fc-atmos-19", "Atmos 19", "Atmos preset 19", "Atmos", {
    oscATable: "saw",
    oscALevel: 0.6,
    noiseLevel: 0.5,
    filterType: "bandpass",
    filterCutoff: 2950,
    ampAttack: 1,
    ampDecay: 1,
    ampSustain: 0.8,
    ampRelease: 1.5,
    reverbMix: 0.6
}),


  // ===== VINTAGE (20) =====
  preset("fc-vintage-0", "Vintage 0", "Vintage preset 0", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2200,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-1", "Vintage 1", "Vintage preset 1", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2250,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-2", "Vintage 2", "Vintage preset 2", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2300,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-3", "Vintage 3", "Vintage preset 3", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2350,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-4", "Vintage 4", "Vintage preset 4", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2400,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-5", "Vintage 5", "Vintage preset 5", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2450,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-6", "Vintage 6", "Vintage preset 6", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2500,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-7", "Vintage 7", "Vintage preset 7", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2550,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-8", "Vintage 8", "Vintage preset 8", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2600,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-9", "Vintage 9", "Vintage preset 9", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2650,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-10", "Vintage 10", "Vintage preset 10", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2700,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-11", "Vintage 11", "Vintage preset 11", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2750,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-12", "Vintage 12", "Vintage preset 12", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-13", "Vintage 13", "Vintage preset 13", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-14", "Vintage 14", "Vintage preset 14", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-15", "Vintage 15", "Vintage preset 15", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-16", "Vintage 16", "Vintage preset 16", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-17", "Vintage 17", "Vintage preset 17", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-18", "Vintage 18", "Vintage preset 18", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),

  preset("fc-vintage-19", "Vintage 19", "Vintage preset 19", "Vintage", {
    oscATable: "saw",
    oscALevel: 0.7,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4,
    cassetteGen: 0.4,
    wowFlutter: 0.25,
    hiss: 0.3
}),


  // ===== CHIP (20) =====
  preset("fc-chip-0", "Chip 0", "Chip preset 0", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-1", "Chip 1", "Chip preset 1", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-2", "Chip 2", "Chip preset 2", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-3", "Chip 3", "Chip preset 3", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-4", "Chip 4", "Chip preset 4", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-5", "Chip 5", "Chip preset 5", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-6", "Chip 6", "Chip preset 6", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-7", "Chip 7", "Chip preset 7", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-8", "Chip 8", "Chip preset 8", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-9", "Chip 9", "Chip preset 9", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-10", "Chip 10", "Chip preset 10", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-11", "Chip 11", "Chip preset 11", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-12", "Chip 12", "Chip preset 12", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3400,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-13", "Chip 13", "Chip preset 13", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3450,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-14", "Chip 14", "Chip preset 14", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3500,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-15", "Chip 15", "Chip preset 15", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3550,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-16", "Chip 16", "Chip preset 16", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3600,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-17", "Chip 17", "Chip preset 17", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3650,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-18", "Chip 18", "Chip preset 18", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3700,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),

  preset("fc-chip-19", "Chip 19", "Chip preset 19", "Chip", {
    oscATable: "pulse",
    oscAPos: 0.5,
    oscALevel: 0.7,
    pulseDuty: 0.5,
    filterType: "lowpass",
    filterCutoff: 3750,
    ampAttack: 0.001,
    ampDecay: 0.3,
    ampSustain: 0.5,
    ampRelease: 0.2
}),


  // ===== FM (20) =====
  preset("fc-fm-0", "FM 0", "FM preset 0", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 2800,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-1", "FM 1", "FM preset 1", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 2850,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-2", "FM 2", "FM preset 2", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 2900,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-3", "FM 3", "FM preset 3", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 2950,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-4", "FM 4", "FM preset 4", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3000,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-5", "FM 5", "FM preset 5", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3050,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-6", "FM 6", "FM preset 6", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3100,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-7", "FM 7", "FM preset 7", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3150,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-8", "FM 8", "FM preset 8", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3200,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-9", "FM 9", "FM preset 9", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3250,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-10", "FM 10", "FM preset 10", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3300,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-11", "FM 11", "FM preset 11", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3350,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-12", "FM 12", "FM preset 12", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3400,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-13", "FM 13", "FM preset 13", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3450,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-14", "FM 14", "FM preset 14", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3500,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-15", "FM 15", "FM preset 15", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3550,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-16", "FM 16", "FM preset 16", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3600,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-17", "FM 17", "FM preset 17", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3650,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-18", "FM 18", "FM preset 18", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3700,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

  preset("fc-fm-19", "FM 19", "FM preset 19", "FM", {
    oscATable: "basic",
    oscALevel: 0.7,
    oscBTable: "basic",
    oscBLevel: 0.6,
    fmAmount: 0.5,
    fmEngine: "classic",
    filterType: "lowpass",
    filterCutoff: 3750,
    ampAttack: 0.02,
    ampDecay: 0.5,
    ampSustain: 0.6,
    ampRelease: 0.4
}),

];
