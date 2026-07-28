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

export const CURATED_PRESETS_V2: FirePreset[] = [
  // ===== BASS V2 (20) =====
  preset("fc2-bass-vactrol-maw", "Vactrol Maw", "Organic plucked bass through struck vactrol gate with tape warmth", "Bass", {
    subLevel: 0.45, oscATable: "growl", oscALevel: 0.7, oscAOctave: -1, oscAPos: 0.4,
    oscBTable: "saw", oscBLevel: 0.35, oscBOctave: -1, oscBDetune: 8,
    lpgOn: true, lpgDecay: 0.5, lpgColor: 0.85,
    filterType: "lowpass", filterCutoff: 1400, filterResonance: 0.35, filterDrive: 0.3,
    ampAttack: 0.002, ampDecay: 0.4, ampSustain: 0.3, ampRelease: 0.35,
    cassetteGen: 0.25, wowFlutter: 0.08, analogComp: 0.3,
    drift: 0.15, voiceInstability: 0.1,
    punch: 0.5, mono: true, stereoWidth: 0.8
  }),
  preset("fc2-bass-warp-throat", "Warp Throat", "Spectral-stretched vocal bass with formant growl and tube saturation", "Bass", {
    subLevel: 0.4, oscATable: "vocal", oscALevel: 0.7, oscAOctave: -1, oscAPos: 0.35,
    oscBTable: "formant2", oscBLevel: 0.45, oscBOctave: -1, oscBPos: 0.6,
    warpStretch: 0.45, warpTilt: -0.35, warpComb: 0.15,
    filterType: "lowpass", filterCutoff: 1100, filterResonance: 0.5, filterDrive: 0.5, filterEnvAmount: 0.4,
    ampAttack: 0.005, ampDecay: 0.35, ampSustain: 0.5, ampRelease: 0.3,
    filtAttack: 0.001, filtDecay: 0.25, filtSustain: 0.3, filtRelease: 0.2,
    drive: 0.3, driveMode: "tube",
    drift: 0.2, driftRate: 0.3,
    mono: true, punch: 0.35
  }),
  preset("fc2-bass-frozen-depth", "Frozen Depth", "Spectral freeze captures bass harmonics in infinite crystalline sustain", "Bass", {
    subLevel: 0.5, oscATable: "saw", oscALevel: 0.55, oscAOctave: -1,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBOctave: -1, oscBDetune: 6,
    spectralMode: "freeze", spectralAmount: 0.75, spectralMix: 0.55,
    filterType: "lowpass", filterCutoff: 800, filterResonance: 0.25,
    ampAttack: 0.01, ampDecay: 0.5, ampSustain: 0.7, ampRelease: 1.2,
    reverbMix: 0.2, reverbSize: 3,
    warpTilt: -0.2,
    drift: 0.1, mono: true
  }),
  preset("fc2-bass-ops4-grind", "Ops4 Grind", "4-operator FM industrial bass with feedback distortion and compression", "Bass", {
    subLevel: 0.35, oscATable: "basic", oscALevel: 0.75, oscAOctave: -1,
    fmEngine: "ops4", fmAlg: 3, fmOp1Level: 1, fmOp2Level: 0.85, fmOp3Level: 0.6, fmOp4Level: 0.4,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3, fmFeedback: 0.65,
    filterType: "lowpass", filterCutoff: 1600, filterResonance: 0.3, filterDrive: 0.55, filterEnvAmount: 0.35,
    ampAttack: 0.002, ampDecay: 0.3, ampSustain: 0.55, ampRelease: 0.25,
    filtAttack: 0.001, filtDecay: 0.2, filtSustain: 0.4, filtRelease: 0.15,
    drive: 0.35, driveMode: "tube", analogComp: 0.4,
    mono: true, punch: 0.5
  }),
  preset("fc2-bass-acid-lpg", "Acid Gate", "303 acid meets Buchla vactrol — resonant squelch through organic decay", "Bass", {
    subLevel: 0.3, oscATable: "saw", oscALevel: 0.8, oscAOctave: 0,
    lpgOn: true, lpgDecay: 0.28, lpgColor: 0.9,
    filterType: "lowpass", filterCutoff: 600, filterResonance: 0.8, filterEnvAmount: 0.85, filterDrive: 0.25,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.4, ampRelease: 0.15,
    filtAttack: 0.001, filtDecay: 0.22, filtSustain: 0.1, filtRelease: 0.1,
    accentAmount: 0.7, slideOn: true, glide: 0.12,
    drift: 0.25, voiceInstability: 0.15,
    mono: true
  }),
  preset("fc2-bass-vector-morph", "Vector Morph", "XY vector automation morphs between growl and metallic bass textures", "Bass", {
    subLevel: 0.4, oscATable: "growl", oscAPos: 0.25, oscALevel: 0.6, oscAOctave: -1,
    oscBTable: "metallic", oscBPos: 0.6, oscBLevel: 0.5, oscBOctave: -1, oscBDetune: 5,
    vectorRate: 0.35, vectorDepth: 0.7,
    filterType: "lowpass", filterCutoff: 1200, filterResonance: 0.4, filterEnvAmount: 0.3,
    ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.5, ampRelease: 0.35,
    modMatrix: makeModMatrix([MR("lfo1", "wtA", 0.3), MR("lfo2", "wtB", 0.25), MR("velocity", "cutoff", 0.4)]),
    lfo1Rate: 0.2, lfo2Rate: 0.15,
    mono: true, punch: 0.3
  }),
  preset("fc2-bass-gated-pulse", "Gated Pulse", "Rhythmic trance gate chops pulsing sub bass with sidechain pump feel", "Bass", {
    subLevel: 0.5, oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.65, oscAOctave: -1, pulseDuty: 0.35,
    oscBTable: "saw", oscBLevel: 0.4, oscBOctave: -1,
    gateOn: true, gateRate: 8, gateDepth: 0.85, gateSmooth: 0.25,
    gatePattern: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0],
    filterType: "lowpass", filterCutoff: 1100, filterResonance: 0.3,
    ampAttack: 0.005, ampDecay: 0.3, ampSustain: 0.6, ampRelease: 0.2,
    punch: 0.4, mono: true
  }),
  preset("fc2-bass-smear-drone", "Smear Drone", "Spectral smear transforms bass into infinite evolving drone texture", "Bass", {
    subLevel: 0.55, oscATable: "saw", oscALevel: 0.5, oscAOctave: -1,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: -2,
    spectralMode: "smear", spectralAmount: 0.85, spectralMix: 0.65,
    filterType: "lowpass", filterCutoff: 600, filterResonance: 0.2,
    ampAttack: 0.4, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 2,
    reverbMix: 0.25, reverbSize: 4,
    drift: 0.2, driftRate: 0.25,
    mono: true
  }),
  preset("fc2-bass-nes-rumble", "NES Rumble", "Chip noise layered with triangle sub for authentic retro thunder", "Bass", {
    subLevel: 0.55, oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.6, oscAOctave: -1, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.45, oscBOctave: -2,
    noiseLevel: 0.12, chipNoise: "nes",
    filterType: "lowpass", filterCutoff: 900, filterResonance: 0.2,
    ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.45, ampRelease: 0.25,
    chipVoiceLimit: 3, bitDepth: "8bit", sampleRateReduce: 0.15,
    punch: 0.45, mono: true
  }),
  preset("fc2-bass-drift-analog", "Drift Analog", "Unstable vintage oscillators with tape saturation and organic drift", "Bass", {
    subLevel: 0.4, oscATable: "saw", oscALevel: 0.65, oscAOctave: -1,
    oscBTable: "saw", oscBLevel: 0.5, oscBDetune: 15, oscBOctave: -1,
    drift: 0.5, driftRate: 0.55, voiceInstability: 0.35, tuneVariance: 0.2, envVariance: 0.15,
    filterType: "lowpass", filterCutoff: 1400, filterResonance: 0.35, filterEnvAmount: 0.3,
    ampAttack: 0.008, ampDecay: 0.4, ampSustain: 0.55, ampRelease: 0.35,
    cassetteGen: 0.35, wowFlutter: 0.12, analogComp: 0.3,
    mono: true
  }),
  preset("fc2-bass-fold-crunch", "Fold Crunch", "Wavefolder adds metallic harmonics with tube drive saturation", "Bass", {
    subLevel: 0.35, oscATable: "fold", oscALevel: 0.7, oscAOctave: -1, oscAPos: 0.4,
    oscBTable: "saw", oscBLevel: 0.4, oscBOctave: -1,
    filterType: "lowpass", filterCutoff: 1800, filterResonance: 0.3, filterDrive: 0.6, filterEnvAmount: 0.4,
    ampAttack: 0.002, ampDecay: 0.3, ampSustain: 0.5, ampRelease: 0.25,
    filtAttack: 0.001, filtDecay: 0.2, filtSustain: 0.35, filtRelease: 0.15,
    drive: 0.45, driveMode: "fold",
    punch: 0.5, mono: true
  }),
  preset("fc2-bass-sync-grind", "Sync Grind", "Hard sync oscillators create aggressive grinding bass edge", "Bass", {
    subLevel: 0.35, oscATable: "saw", oscALevel: 0.7, oscAOctave: -1,
    oscBTable: "saw", oscBLevel: 0.55, oscBOctave: 0,
    hardSync: true,
    filterType: "lowpass", filterCutoff: 1600, filterResonance: 0.45, filterEnvAmount: 0.5, filterDrive: 0.3,
    ampAttack: 0.002, ampDecay: 0.25, ampSustain: 0.55, ampRelease: 0.2,
    filtAttack: 0.001, filtDecay: 0.18, filtSustain: 0.3, filtRelease: 0.12,
    modMatrix: makeModMatrix([MR("modenv", "cutoff", 0.5), MR("velocity", "resonance", 0.35)]),
    mono: true, punch: 0.4
  }),
  preset("fc2-bass-comb-razor", "Comb Razor", "Warp comb filtering creates razor-sharp notched bass texture", "Bass", {
    subLevel: 0.45, oscATable: "saw", oscALevel: 0.7, oscAOctave: -1,
    oscBTable: "pulse", oscBLevel: 0.4, oscBOctave: -1, pulseDuty: 0.4,
    warpComb: 0.65, warpTilt: 0.25, warpStretch: 0.1,
    filterType: "lowpass", filterCutoff: 2000, filterResonance: 0.35,
    ampAttack: 0.003, ampDecay: 0.35, ampSustain: 0.5, ampRelease: 0.3,
    lfo1Rate: 0.15, lfo1Depth: 0.2, lfo1Dest: "filter",
    mono: true
  }),
  preset("fc2-bass-gb-wave", "GB Wave", "Authentic Gameboy wave channel bass with chip character", "Bass", {
    subLevel: 0.35, oscATable: "chip", oscALevel: 0.8, oscAOctave: -1, pulseDuty: 0.25,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: -2,
    chipNoise: "gb", chipVoiceLimit: 4,
    filterType: "lowpass", filterCutoff: 2200, filterResonance: 0.15,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.6, ampRelease: 0.2,
    bitDepth: "8bit",
    mono: true, punch: 0.3
  }),
  preset("fc2-bass-formant-sub", "Formant Sub", "Vowel-shaped subharmonic bass with talking resonance", "Bass", {
    subLevel: 0.5, oscATable: "formant2", oscALevel: 0.6, oscAOctave: -1, oscAPos: 0.4,
    oscBTable: "vocal", oscBLevel: 0.45, oscBOctave: -1, oscBPos: 0.6,
    filterType: "bandpass", filterCutoff: 900, filterResonance: 0.55,
    ampAttack: 0.008, ampDecay: 0.4, ampSustain: 0.5, ampRelease: 0.35,
    lfo1Rate: 3, lfo1Depth: 0.35, lfo1Dest: "filter", lfo1Wave: "sine",
    modMatrix: makeModMatrix([MR("lfo1", "wtA", 0.4), MR("modenv", "wtB", 0.35)]),
    mono: true
  }),
  preset("fc2-bass-ring-metal", "Ring Metal Bass", "Ring modulation adds clanging metallic overtones to bass", "Bass", {
    subLevel: 0.4, oscATable: "saw", oscALevel: 0.65, oscAOctave: -1,
    oscBTable: "metallic", oscBLevel: 0.4, oscBOctave: -1,
    ringAmount: 0.45, ringFreq: 55,
    filterType: "lowpass", filterCutoff: 1500, filterResonance: 0.3, filterDrive: 0.35,
    ampAttack: 0.003, ampDecay: 0.35, ampSustain: 0.5, ampRelease: 0.3,
    reverbMix: 0.1, reverbSize: 2,
    mono: true
  }),
  preset("fc2-bass-tape-saturate", "Tape Saturate", "Heavy cassette saturation with wow flutter and analog compression", "Bass", {
    subLevel: 0.5, oscATable: "saw", oscALevel: 0.7, oscAOctave: -1,
    oscBTable: "pulse", oscBLevel: 0.35, oscBOctave: -1, pulseDuty: 0.4,
    cassetteGen: 0.7, wowFlutter: 0.15, analogComp: 0.5, hiss: 0.08, printThrough: 0.1,
    filterType: "lowpass", filterCutoff: 1000, filterResonance: 0.2,
    ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.55, ampRelease: 0.35,
    drift: 0.2, voiceInstability: 0.1,
    mono: true
  }),
  preset("fc2-bass-additive-low", "Additive Low", "Additive synthesis creates pure powerful bass weight", "Bass", {
    subLevel: 0.45, oscATable: "additive", oscAPos: 0.2, oscALevel: 0.7, oscAOctave: -1,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: -2,
    filterType: "lowpass", filterCutoff: 1300, filterResonance: 0.25, filterEnvAmount: 0.35,
    ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.55, ampRelease: 0.3,
    filtAttack: 0.001, filtDecay: 0.25, filtSustain: 0.3, filtRelease: 0.2,
    punch: 0.45, airLow: 0.2, airAmount: 0.25,
    mono: true
  }),
  preset("fc2-bass-spectral-gate", "Spectral Gate", "FFT gating creates rhythmic bass with spectral articulation", "Bass", {
    subLevel: 0.45, oscATable: "saw", oscALevel: 0.6, oscAOctave: -1,
    oscBTable: "growl", oscBLevel: 0.4, oscBOctave: -1,
    spectralMode: "gate", spectralAmount: 0.55, spectralMix: 0.5,
    filterType: "lowpass", filterCutoff: 1400, filterResonance: 0.3,
    ampAttack: 0.003, ampDecay: 0.35, ampSustain: 0.55, ampRelease: 0.3,
    punch: 0.35, mono: true
  }),
  preset("fc2-bass-modmatrix-pulse", "ModMatrix Pulse", "Complex modulation matrix shapes evolving bass timbre", "Bass", {
    subLevel: 0.4, oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.7, oscAOctave: -1, pulseDuty: 0.4,
    oscBTable: "saw", oscBLevel: 0.45, oscBOctave: -1, oscBDetune: 8,
    modMatrix: makeModMatrix([
      MR("lfo1", "cutoff", 0.45), MR("modenv", "wtA", 0.5), MR("velocity", "resonance", 0.35),
      MR("lfo2", "levelB", 0.3), MR("keytrack", "cutoff", 0.25)
    ]),
    lfo1Rate: 2.5, lfo1Wave: "sine", lfo2Rate: 0.3, lfo2Wave: "triangle",
    filterType: "lowpass", filterCutoff: 1100, filterResonance: 0.55,
    ampAttack: 0.003, ampDecay: 0.35, ampSustain: 0.5, ampRelease: 0.3,
    mono: true
  }),

  // ===== LEAD V2 (20) =====
  preset("fc2-lead-spectral-shift", "Spectral Shift", "FFT pitch shifting creates alien detuned lead harmonics", "Lead", {
    oscATable: "saw", oscALevel: 0.7, oscAPos: 0.5,
    oscBTable: "harmonic", oscBLevel: 0.45, oscBDetune: 5,
    spectralMode: "shift", spectralAmount: 0.35, spectralMix: 0.55,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.35, filterEnvAmount: 0.4,
    ampAttack: 0.008, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.35,
    filtAttack: 0.005, filtDecay: 0.25, filtSustain: 0.5, filtRelease: 0.2,
    delayMix: 0.22, delayTime: 0.35, delayFeedback: 0.4,
    reverbMix: 0.2, mono: true
  }),
  preset("fc2-lead-vactrol-pluck", "Vactrol Pluck Lead", "LPG struck lead with natural organic decay and air shimmer", "Lead", {
    oscATable: "bell", oscALevel: 0.65, oscAPos: 0.4,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 3,
    lpgOn: true, lpgDecay: 0.35, lpgColor: 0.8,
    airHigh: 0.35, airAmount: 0.4,
    reverbMix: 0.3, reverbSize: 2.5,
    delayMix: 0.15, delayFeedback: 0.35,
    drift: 0.15, mono: true
  }),
  preset("fc2-lead-warp-screamer", "Warp Screamer", "Harmonic stretch and sync create screaming aggressive lead", "Lead", {
    oscATable: "sync", oscALevel: 0.75, oscAPos: 0.6,
    oscBTable: "saw", oscBLevel: 0.5, oscBOctave: 1,
    warpStretch: 0.6, warpTilt: 0.45, warpComb: 0.2,
    hardSync: true,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.45, filterEnvAmount: 0.5,
    ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.65, ampRelease: 0.25,
    filtAttack: 0.002, filtDecay: 0.2, filtSustain: 0.4, filtRelease: 0.15,
    drive: 0.3, driveMode: "tube",
    mono: true
  }),
  preset("fc2-lead-ops4-brass", "Ops4 Brass", "4-operator FM brass lead with punchy attack and warm sustain", "Lead", {
    oscATable: "basic", oscALevel: 0.7,
    fmEngine: "ops4", fmAlg: 5, fmOp1Level: 1, fmOp2Level: 0.75, fmOp3Level: 0.55, fmOp4Level: 0.4,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 4, fmFeedback: 0.35,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.3, filterEnvAmount: 0.55,
    ampAttack: 0.04, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.3,
    filtAttack: 0.02, filtDecay: 0.25, filtSustain: 0.5, filtRelease: 0.2,
    cassetteGen: 0.15, analogComp: 0.25,
    mono: true
  }),
  preset("fc2-lead-vector-sweep", "Vector Sweep", "XY vector motion creates sweeping evolving lead timbre", "Lead", {
    oscATable: "saw", oscAPos: 0.2, oscALevel: 0.6,
    oscBTable: "pulse", oscBPos: 0.65, oscBLevel: 0.55, pulseDuty: 0.35,
    vectorRate: 0.55, vectorDepth: 0.75,
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.4,
    ampAttack: 0.01, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.35,
    chorusMix: 0.25, chorusDepth: 0.5,
    modMatrix: makeModMatrix([MR("lfo1", "pan", 0.3), MR("modenv", "cutoff", 0.4)]),
    lfo1Rate: 0.3,
    mono: true
  }),
  preset("fc2-lead-freeze-sustain", "Freeze Sustain", "Spectral freeze holds lead notes in crystalline suspension", "Lead", {
    oscATable: "harmonic", oscALevel: 0.65, oscAPos: 0.5,
    oscBTable: "bell", oscBLevel: 0.4,
    spectralMode: "freeze", spectralAmount: 0.8, spectralMix: 0.7,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.25,
    ampAttack: 0.02, ampDecay: 0.4, ampSustain: 0.85, ampRelease: 1.5,
    reverbMix: 0.35, reverbSize: 3.5,
    airHigh: 0.3, airAmount: 0.35,
    mono: true
  }),
  preset("fc2-lead-acid-accent", "Acid Accent", "303 acid line with velocity accent and legato slide", "Lead", {
    oscATable: "saw", oscALevel: 0.8,
    filterType: "lowpass", filterCutoff: 700, filterResonance: 0.88, filterEnvAmount: 0.9, filterDrive: 0.2,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.5, ampRelease: 0.12,
    filtAttack: 0.001, filtDecay: 0.22, filtSustain: 0.08, filtRelease: 0.1,
    accentAmount: 0.75, slideOn: true, glide: 0.1,
    drift: 0.2, voiceInstability: 0.12,
    mono: true
  }),
  preset("fc2-lead-drift-vintage", "Drift Vintage", "Unstable analog oscillators with tape warmth and organic drift", "Lead", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.5, oscBDetune: 12, pulseDuty: 0.4,
    drift: 0.55, driftRate: 0.6, voiceInstability: 0.3, tuneVariance: 0.2, envVariance: 0.2,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.35,
    ampAttack: 0.015, ampDecay: 0.35, ampSustain: 0.7, ampRelease: 0.35,
    cassetteGen: 0.35, wowFlutter: 0.15, hiss: 0.08,
    chorusMix: 0.2,
    mono: true
  }),
  preset("fc2-lead-comb-nasal", "Comb Nasal", "Warp comb filtering creates nasal vocal-like lead tone", "Lead", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.35,
    warpComb: 0.75, warpStretch: -0.2, warpTilt: 0.15,
    filterType: "bandpass", filterCutoff: 2200, filterResonance: 0.5,
    ampAttack: 0.008, ampDecay: 0.3, ampSustain: 0.65, ampRelease: 0.3,
    lfo1Rate: 4, lfo1Depth: 0.25, lfo1Dest: "filter", lfo1Wave: "sine",
    mono: true
  }),
  preset("fc2-lead-gate-stutter", "Gate Stutter", "Rhythmic gate creates stutter-cut lead phrases", "Lead", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "saw", oscBLevel: 0.5, oscBDetune: 8,
    unison: 3, unisonDetune: 10, unisonWidth: 0.6,
    gateOn: true, gateRate: 16, gateDepth: 0.9, gateSmooth: 0.12,
    gatePattern: [1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0],
    filterType: "lowpass", filterCutoff: 4800, filterResonance: 0.3,
    ampAttack: 0.002, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.15,
    delayMix: 0.2, delayTime: 0.375,
    mono: true
  }),
  preset("fc2-lead-smear-glide", "Smear Glide", "Spectral smear blurs pitch transitions into ghostly trails", "Lead", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 5,
    spectralMode: "smear", spectralAmount: 0.55, spectralMix: 0.5,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.3,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.7, ampRelease: 0.6,
    glide: 0.18,
    delayMix: 0.25, delayFeedback: 0.45, delayTime: 0.4,
    reverbMix: 0.2,
    mono: true
  }),
  preset("fc2-lead-fm-bell-lead", "FM Bell Lead", "Bell-like FM with ring modulation sparkle", "Lead", {
    oscATable: "bell", oscALevel: 0.6,
    oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.6, fmRatio: 4, fmBtoA: 0.25,
    ringAmount: 0.2, ringFreq: 550,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.25,
    ampAttack: 0.002, ampDecay: 0.4, ampSustain: 0.5, ampRelease: 0.4,
    reverbMix: 0.25, reverbSize: 2.5,
    airHigh: 0.25, airAmount: 0.3,
    mono: true
  }),
  preset("fc2-lead-tilt-bright", "Tilt Bright", "Harmonic tilt adds searing brightness with air shimmer", "Lead", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "harmonic", oscBLevel: 0.45, oscBDetune: 4,
    warpTilt: 0.65, warpStretch: 0.2,
    filterType: "lowpass", filterCutoff: 6000, filterResonance: 0.3,
    ampAttack: 0.008, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.3,
    airHigh: 0.45, airAmount: 0.4,
    delayMix: 0.15, delayFeedback: 0.3,
    mono: true
  }),
  preset("fc2-lead-growl-talk", "Growl Talk", "Vocal formant growl creates talking lead character", "Lead", {
    oscATable: "growl", oscALevel: 0.65, oscAPos: 0.4,
    oscBTable: "vocal", oscBLevel: 0.5, oscBPos: 0.55,
    filterType: "bandpass", filterCutoff: 2000, filterResonance: 0.55,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.65, ampRelease: 0.3,
    lfo1Rate: 4.5, lfo1Depth: 0.4, lfo1Dest: "filter", lfo1Wave: "sine",
    modMatrix: makeModMatrix([MR("lfo2", "wtA", 0.35), MR("modenv", "wtB", 0.4)]),
    lfo2Rate: 0.25,
    mono: true
  }),
  preset("fc2-lead-sync-screech", "Sync Screech", "Hard sync creates aggressive screeching overtones", "Lead", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "saw", oscBLevel: 0.55, oscBOctave: 1,
    hardSync: true,
    filterType: "lowpass", filterCutoff: 5200, filterResonance: 0.4, filterEnvAmount: 0.6,
    ampAttack: 0.003, ampDecay: 0.25, ampSustain: 0.6, ampRelease: 0.2,
    filtAttack: 0.001, filtDecay: 0.18, filtSustain: 0.35, filtRelease: 0.12,
    drive: 0.25, driveMode: "soft",
    modMatrix: makeModMatrix([MR("modenv", "pitch", 0.15), MR("velocity", "cutoff", 0.4)]),
    mono: true
  }),
  preset("fc2-lead-chip-hero", "Chip Hero Lead", "Retro chip lead with modern polish and delay trails", "Lead", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.25,
    oscBTable: "pulse", oscBLevel: 0.4, oscBOctave: 1,
    chipNoise: "nes", chipVoiceLimit: 2,
    filterType: "lowpass", filterCutoff: 5800, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.6, ampRelease: 0.2,
    delayMix: 0.2, delayTime: 0.333, delayFeedback: 0.4,
    mono: true
  }),
  preset("fc2-lead-air-whisper", "Air Whisper Lead", "Airy breathy lead with high-frequency shimmer", "Lead", {
    oscATable: "basic", oscALevel: 0.55, oscAOctave: 1,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 3,
    noiseLevel: 0.18, noiseColor: 0.6,
    airHigh: 0.6, airLow: -0.1, airAmount: 0.55,
    filterType: "highpass", filterCutoff: 1500, filterResonance: 0.25,
    ampAttack: 0.04, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.5,
    reverbMix: 0.35, reverbSize: 3,
    mono: true
  }),
  preset("fc2-lead-modmatrix-morph", "ModMatrix Morph", "Complex modulation matrix morphs lead timbre continuously", "Lead", {
    oscATable: "saw", oscAPos: 0.3, oscALevel: 0.65,
    oscBTable: "harmonic", oscBPos: 0.6, oscBLevel: 0.5,
    modMatrix: makeModMatrix([
      MR("lfo1", "wtA", 0.5), MR("lfo2", "wtB", 0.45), MR("modenv", "cutoff", 0.55),
      MR("velocity", "fm", 0.35), MR("keytrack", "resonance", 0.2), MR("random", "pan", 0.25)
    ]),
    lfo1Rate: 0.35, lfo1Wave: "sine", lfo2Rate: 0.5, lfo2Wave: "triangle",
    fmAmount: 0.3, fmRatio: 2,
    filterType: "lowpass", filterCutoff: 3500, filterResonance: 0.4,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.7, ampRelease: 0.35,
    mono: true
  }),
  preset("fc2-lead-vhs-nostalgia", "VHS Nostalgia", "Tape-degraded nostalgic lead with wow flutter and hiss", "Lead", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.45, oscBDetune: 10, pulseDuty: 0.4,
    cassetteGen: 0.55, vhsColor: 0.45, wowFlutter: 0.3, hiss: 0.18, printThrough: 0.12,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.3,
    ampAttack: 0.015, ampDecay: 0.35, ampSustain: 0.65, ampRelease: 0.35,
    chorusMix: 0.25, bbdChorus: 0.3,
    drift: 0.2,
    mono: true
  }),
  preset("fc2-lead-ring-alien", "Ring Alien", "Ring modulation creates otherworldly alien lead tones", "Lead", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "metallic", oscBLevel: 0.4,
    ringAmount: 0.55, ringFreq: 480,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.35,
    ampAttack: 0.008, ampDecay: 0.3, ampSustain: 0.65, ampRelease: 0.35,
    reverbMix: 0.3, reverbSize: 3,
    delayMix: 0.22, delayTime: 0.4, delayFeedback: 0.45,
    mono: true
  }),

  // ===== PLUCK V2 (20) =====
  preset("fc2-pluck-vactrol-tine", "Vactrol Tine", "LPG creates organic tine pluck with natural decay curve", "Pluck", {
    oscATable: "bell", oscALevel: 0.65, oscAPos: 0.4,
    oscBTable: "basic", oscBLevel: 0.4,
    lpgOn: true, lpgDecay: 0.22, lpgColor: 0.75,
    airHigh: 0.3, airAmount: 0.35,
    reverbMix: 0.3, reverbSize: 2.5,
    drift: 0.1
  }),
  preset("fc2-pluck-warp-kalimba", "Warp Kalimba", "Spectral warp creates alien metallic kalimba tone", "Pluck", {
    oscATable: "bell", oscALevel: 0.65, oscAPos: 0.5,
    oscBTable: "metallic", oscBLevel: 0.35,
    warpStretch: 0.4, warpTilt: -0.25, warpComb: 0.2,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.25, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.06, ampRelease: 0.4,
    filtAttack: 0.001, filtDecay: 0.3, filtSustain: 0.2, filtRelease: 0.25,
    reverbMix: 0.35, reverbSize: 2.8
  }),
  preset("fc2-pluck-frozen-harp", "Frozen Harp", "Spectral freeze extends harp pluck into shimmering sustain", "Pluck", {
    oscATable: "harmonic", oscALevel: 0.6, oscAPos: 0.5,
    oscBTable: "bell", oscBLevel: 0.4,
    spectralMode: "freeze", spectralAmount: 0.65, spectralMix: 0.45,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.2,
    ampAttack: 0.002, ampDecay: 0.5, ampSustain: 0.3, ampRelease: 0.8,
    reverbMix: 0.4, reverbSize: 3.5,
    chorusMix: 0.2
  }),
  preset("fc2-pluck-ops4-mallet", "Ops4 Mallet", "4-operator FM creates authentic mallet percussion", "Pluck", {
    oscATable: "basic", oscALevel: 0.7,
    fmEngine: "ops4", fmAlg: 2, fmOp1Level: 1, fmOp2Level: 0.65, fmOp3Level: 0.4, fmOp4Level: 0.25,
    fmOp2Ratio: 3, fmOp3Ratio: 5, fmOp4Ratio: 7,
    filterType: "lowpass", filterCutoff: 4800, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.05, ampRelease: 0.35,
    reverbMix: 0.25, reverbSize: 2.2
  }),
  preset("fc2-pluck-vector-shimmer", "Vector Shimmer", "XY vector motion creates shimmering evolving plucks", "Pluck", {
    oscATable: "bell", oscAPos: 0.3, oscALevel: 0.55,
    oscBTable: "harmonic", oscBPos: 0.65, oscBLevel: 0.5,
    vectorRate: 0.8, vectorDepth: 0.55,
    filterType: "lowpass", filterCutoff: 5800, filterResonance: 0.25,
    ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.1, ampRelease: 0.4,
    chorusMix: 0.25, reverbMix: 0.35, reverbSize: 2.8,
    airHigh: 0.25, airAmount: 0.3
  }),
  preset("fc2-pluck-comb-resonant", "Comb Resonant", "Warp comb adds resonant metallic character to plucks", "Pluck", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.35,
    warpComb: 0.6, warpStretch: 0.15, warpTilt: 0.1,
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.4, filterEnvAmount: 0.55,
    ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.08, ampRelease: 0.25,
    filtAttack: 0.001, filtDecay: 0.2, filtSustain: 0.15, filtRelease: 0.15,
    delayMix: 0.2, delayFeedback: 0.35
  }),
  preset("fc2-pluck-gated-dots", "Gated Dots", "Gate creates rhythmic dotted pluck patterns with delay trails", "Pluck", {
    oscATable: "bell", oscALevel: 0.6,
    oscBTable: "basic", oscBLevel: 0.4,
    gateOn: true, gateRate: 12, gateDepth: 0.85, gateSmooth: 0.08,
    gatePattern: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.15, ampRelease: 0.2,
    delayMix: 0.35, delayTime: 0.333, delayFeedback: 0.5,
    reverbMix: 0.2
  }),
  preset("fc2-pluck-lpg-marimba", "LPG Marimba", "Vactrol gate shapes authentic woody marimba tone", "Pluck", {
    oscATable: "basic", oscALevel: 0.65,
    oscBTable: "bell", oscBLevel: 0.35,
    fmAmount: 0.25, fmRatio: 2.5,
    lpgOn: true, lpgDecay: 0.38, lpgColor: 0.65,
    reverbMix: 0.25, reverbSize: 2.2,
    airLow: 0.15, airAmount: 0.2
  }),
  preset("fc2-pluck-drift-vintage", "Drift Vintage Pluck", "Unstable tuning adds warm vintage character", "Pluck", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.65, pulseDuty: 0.4,
    oscBTable: "basic", oscBLevel: 0.4,
    drift: 0.35, tuneVariance: 0.25, envVariance: 0.18,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.3, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.32, ampSustain: 0.08, ampRelease: 0.28,
    filtAttack: 0.001, filtDecay: 0.22, filtSustain: 0.15, filtRelease: 0.18,
    cassetteGen: 0.25, wowFlutter: 0.08
  }),
  preset("fc2-pluck-chip-blip", "Chip Blip V2", "Enhanced chip pluck with noise burst and bitcrush", "Pluck", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.25,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1,
    noiseLevel: 0.1, chipNoise: "nes",
    filterType: "lowpass", filterCutoff: 5800, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.05, ampRelease: 0.12,
    bitDepth: "8bit", sampleRateReduce: 0.1,
    chipVoiceLimit: 3
  }),
  preset("fc2-pluck-smear-bloom", "Smear Bloom", "Spectral smear blooms pluck tail into ambient wash", "Pluck", {
    oscATable: "saw", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.45,
    spectralMode: "smear", spectralAmount: 0.65, spectralMix: 0.55,
    filterType: "lowpass", filterCutoff: 4500, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.25, ampRelease: 1,
    reverbMix: 0.45, reverbSize: 4,
    chorusMix: 0.2
  }),
  preset("fc2-pluck-ring-metal", "Ring Metal Pluck", "Ring mod adds clanging metallic overtones", "Pluck", {
    oscATable: "bell", oscALevel: 0.6,
    oscBTable: "metallic", oscBLevel: 0.4,
    ringAmount: 0.4, ringFreq: 880,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.38, ampSustain: 0.06, ampRelease: 0.35,
    reverbMix: 0.3, reverbSize: 2.5
  }),
  preset("fc2-pluck-fold-twang", "Fold Twang", "Wavefold adds rich harmonics to guitar-like twang", "Pluck", {
    oscATable: "fold", oscALevel: 0.65, oscAPos: 0.45,
    oscBTable: "saw", oscBLevel: 0.4,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.35, filterEnvAmount: 0.6, filterDrive: 0.35,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.05, ampRelease: 0.22,
    filtAttack: 0.001, filtDecay: 0.18, filtSustain: 0.1, filtRelease: 0.12,
    drive: 0.2, driveMode: "soft"
  }),
  preset("fc2-pluck-sync-snap", "Sync Snap V2", "Hard sync creates aggressive snappy pluck attack", "Pluck", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "saw", oscBLevel: 0.5, oscBOctave: 1,
    hardSync: true,
    filterType: "lowpass", filterCutoff: 5200, filterResonance: 0.35, filterEnvAmount: 0.55,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.05, ampRelease: 0.15,
    filtAttack: 0.001, filtDecay: 0.15, filtSustain: 0.1, filtRelease: 0.1,
    modMatrix: makeModMatrix([MR("velocity", "cutoff", 0.45), MR("modenv", "pitch", 0.12)])
  }),
  preset("fc2-pluck-air-sparkle", "Air Sparkle Pluck", "Airy high-frequency shimmer on crystalline pluck", "Pluck", {
    oscATable: "bell", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.45,
    noiseLevel: 0.12, noiseColor: 0.7,
    airHigh: 0.55, airLow: -0.1, airAmount: 0.5,
    filterType: "lowpass", filterCutoff: 6500, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.32, ampSustain: 0.08, ampRelease: 0.4,
    reverbMix: 0.35, reverbSize: 3
  }),
  preset("fc2-pluck-tilt-bright", "Tilt Bright Pluck", "Harmonic tilt adds searing brightness to pluck attack", "Pluck", {
    oscATable: "harmonic", oscALevel: 0.65, oscAPos: 0.5,
    oscBTable: "bell", oscBLevel: 0.4,
    warpTilt: 0.55, warpStretch: 0.12,
    filterType: "lowpass", filterCutoff: 6000, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.08, ampRelease: 0.3,
    filtAttack: 0.001, filtDecay: 0.2, filtSustain: 0.15, filtRelease: 0.18,
    delayMix: 0.22, delayFeedback: 0.4
  }),
  preset("fc2-pluck-modmatrix-evolve", "ModMatrix Evolve", "Modulation matrix creates evolving pluck timbre", "Pluck", {
    oscATable: "bell", oscAPos: 0.4, oscALevel: 0.6,
    oscBTable: "harmonic", oscBPos: 0.6, oscBLevel: 0.45,
    modMatrix: makeModMatrix([
      MR("modenv", "wtA", 0.55), MR("velocity", "cutoff", 0.45), MR("keytrack", "resonance", 0.25),
      MR("random", "wtB", 0.2)
    ]),
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.4, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.1, ampRelease: 0.35,
    reverbMix: 0.25
  }),
  preset("fc2-pluck-tape-warmth", "Tape Warmth Pluck", "Cassette warmth and compression on soft pluck", "Pluck", {
    oscATable: "basic", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    cassetteGen: 0.45, wowFlutter: 0.12, analogComp: 0.35, hiss: 0.06,
    filterType: "lowpass", filterCutoff: 3500, filterEnvAmount: 0.4,
    ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.12, ampRelease: 0.3,
    chorusMix: 0.18,
    drift: 0.15
  }),
  preset("fc2-pluck-gb-chime", "GB Chime", "Gameboy wave channel chime with chip character", "Pluck", {
    oscATable: "chip", oscALevel: 0.65, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: 1,
    chipNoise: "gb", chipVoiceLimit: 3,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.05, ampRelease: 0.2,
    delayMix: 0.25, delayTime: 0.25, delayFeedback: 0.4
  }),
  preset("fc2-pluck-formant-vocal", "Formant Vocal Pluck", "Vowel-shaped pluck with talking resonance", "Pluck", {
    oscATable: "formant2", oscALevel: 0.65, oscAPos: 0.4,
    oscBTable: "vocal", oscBLevel: 0.4, oscBPos: 0.55,
    filterType: "bandpass", filterCutoff: 1800, filterResonance: 0.5,
    ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.1, ampRelease: 0.25,
    lfo1Rate: 5, lfo1Depth: 0.2, lfo1Dest: "filter",
    modMatrix: makeModMatrix([MR("modenv", "wtA", 0.4)])
  }),

  // ===== PAD V2 (20) =====
  preset("fc2-pad-spectral-freeze", "Spectral Freeze", "FFT freeze captures pad harmonics in infinite crystalline sustain", "Pad", {
    oscATable: "harmonic", oscALevel: 0.5, oscAPos: 0.5,
    oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 10,
    oscCTable: "bell", oscCLevel: 0.3, oscCOctave: 1,
    spectralMode: "freeze", spectralAmount: 0.85, spectralMix: 0.7,
    filterType: "lowpass", filterCutoff: 3500, filterResonance: 0.25,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2.5,
    unison: 3, unisonDetune: 8, unisonWidth: 0.7,
    reverbMix: 0.55, reverbSize: 4.5,
    chorusMix: 0.25
  }),
  preset("fc2-pad-vactrol-swell", "Vactrol Swell", "LPG shapes organic pad swells with natural envelope curves", "Pad", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 12, pulseDuty: 0.4,
    lpgOn: true, lpgDecay: 1.8, lpgColor: 0.55,
    unison: 4, unisonDetune: 14, unisonWidth: 0.75,
    reverbMix: 0.5, reverbSize: 4,
    chorusMix: 0.3,
    drift: 0.2, driftRate: 0.3
  }),
  preset("fc2-pad-warp-dimension", "Warp Dimension", "Spectral warps create alien dimensional textures", "Pad", {
    oscATable: "harmonic", oscALevel: 0.5, oscAPos: 0.4,
    oscBTable: "vocal", oscBLevel: 0.45, oscBDetune: 8, oscBPos: 0.6,
    warpStretch: 0.55, warpTilt: -0.35, warpComb: 0.35,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.3,
    ampAttack: 0.9, ampDecay: 0.7, ampSustain: 0.85, ampRelease: 2.2,
    unison: 3, unisonDetune: 10,
    reverbMix: 0.55, reverbSize: 5,
    phaserMix: 0.25, phaserRate: 0.1, phaserDepth: 0.6
  }),
  preset("fc2-pad-ops4-glass", "Ops4 Glass", "4-operator FM creates glassy ethereal pad texture", "Pad", {
    oscATable: "basic", oscALevel: 0.5,
    oscBTable: "bell", oscBLevel: 0.4, oscBDetune: 6,
    fmEngine: "ops4", fmAlg: 4, fmOp1Level: 0.8, fmOp2Level: 0.6, fmOp3Level: 0.4, fmOp4Level: 0.25,
    fmOp2Ratio: 2, fmOp3Ratio: 3, fmOp4Ratio: 5,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.2,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2,
    unison: 3, unisonDetune: 8,
    reverbMix: 0.55, reverbSize: 4,
    airHigh: 0.25, airAmount: 0.3
  }),
  preset("fc2-pad-vector-morph", "Vector Morph Pad", "XY vector automation morphs between pad textures", "Pad", {
    oscATable: "saw", oscAPos: 0.2, oscALevel: 0.45,
    oscBTable: "harmonic", oscBPos: 0.75, oscBLevel: 0.45, oscBDetune: 10,
    vectorRate: 0.12, vectorDepth: 0.75,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.3,
    ampAttack: 1, ampDecay: 0.7, ampSustain: 0.9, ampRelease: 2.2,
    unison: 4, unisonDetune: 12, unisonWidth: 0.8,
    chorusMix: 0.35, reverbMix: 0.5, reverbSize: 4,
    modMatrix: makeModMatrix([MR("lfo1", "wtA", 0.3), MR("lfo2", "wtB", 0.25)]),
    lfo1Rate: 0.08, lfo2Rate: 0.05
  }),
  preset("fc2-pad-smear-infinite", "Smear Infinite", "Spectral smear extends pad into infinite ambient wash", "Pad", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 12, pulseDuty: 0.4,
    spectralMode: "smear", spectralAmount: 0.92, spectralMix: 0.75,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.2,
    ampAttack: 1.5, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 4,
    unison: 3, unisonDetune: 10,
    reverbMix: 0.6, reverbSize: 5.5,
    drift: 0.15
  }),
  preset("fc2-pad-gated-rhythm", "Gated Rhythm Pad", "Gate creates hypnotic rhythmic pad movement", "Pad", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 10, pulseDuty: 0.35,
    unison: 4, unisonDetune: 12, unisonWidth: 0.75,
    gateOn: true, gateRate: 4, gateDepth: 0.65, gateSmooth: 0.45,
    gatePattern: [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0],
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.3,
    ampAttack: 0.3, ampDecay: 0.5, ampSustain: 0.85, ampRelease: 1,
    reverbMix: 0.45, reverbSize: 3.5,
    delayMix: 0.2, delayTime: 0.5
  }),
  preset("fc2-pad-drift-analog", "Drift Analog Pad", "Unstable vintage analog pad with organic character", "Pad", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 15,
    drift: 0.55, driftRate: 0.45, voiceInstability: 0.35, tuneVariance: 0.25, envVariance: 0.2,
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.35,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 1.8,
    unison: 3, unisonDetune: 12,
    cassetteGen: 0.35, wowFlutter: 0.15, analogComp: 0.25,
    chorusMix: 0.35, reverbMix: 0.45
  }),
  preset("fc2-pad-comb-hollow", "Comb Hollow", "Warp comb creates hollow resonant pad cavern", "Pad", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 8,
    warpComb: 0.7, warpTilt: -0.25, warpStretch: -0.1,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.35,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2.2,
    unison: 3, unisonDetune: 10,
    reverbMix: 0.5, reverbSize: 4.5,
    phaserMix: 0.2, phaserRate: 0.08
  }),
  preset("fc2-pad-formant-choir", "Formant Choir", "Vocal formant creates ethereal choir pad", "Pad", {
    oscATable: "vocal", oscAPos: 0.35, oscALevel: 0.5,
    oscBTable: "formant2", oscBPos: 0.6, oscBLevel: 0.45, oscBDetune: 10,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.35,
    ampAttack: 1, ampDecay: 0.7, ampSustain: 0.9, ampRelease: 2.5,
    unison: 4, unisonDetune: 10, unisonWidth: 0.75,
    reverbMix: 0.55, reverbSize: 5,
    lfo1Rate: 0.1, lfo1Depth: 0.2, lfo1Dest: "filter",
    modMatrix: makeModMatrix([MR("lfo2", "wtA", 0.3), MR("lfo2", "wtB", 0.25)]),
    lfo2Rate: 0.06
  }),
  preset("fc2-pad-ring-shimmer", "Ring Shimmer Pad", "Ring modulation adds shimmering overtones", "Pad", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 8,
    ringAmount: 0.3, ringFreq: 350,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.25,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2.2,
    unison: 3, unisonDetune: 10, unisonWidth: 0.7,
    reverbMix: 0.55, reverbSize: 4,
    chorusMix: 0.25,
    airHigh: 0.2, airAmount: 0.25
  }),
  preset("fc2-pad-fold-texture", "Fold Texture Pad", "Wavefold adds rich harmonic texture to pad", "Pad", {
    oscATable: "fold", oscALevel: 0.5, oscAPos: 0.45,
    oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 12,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.3, filterDrive: 0.3,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 2,
    unison: 4, unisonDetune: 12, unisonWidth: 0.75,
    reverbMix: 0.5, reverbSize: 4,
    drive: 0.15, driveMode: "soft"
  }),
  preset("fc2-pad-sync-evolve", "Sync Evolve Pad", "Hard sync with slow LFO creates evolving pad", "Pad", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "saw", oscBLevel: 0.4, oscBOctave: 1,
    hardSync: true,
    lfo1Rate: 0.06, lfo1Depth: 0.4, lfo1Dest: "filter", lfo1Wave: "triangle",
    filterType: "lowpass", filterCutoff: 3500, filterResonance: 0.35,
    ampAttack: 1, ampDecay: 0.7, ampSustain: 0.9, ampRelease: 2.2,
    unison: 3, unisonDetune: 10,
    reverbMix: 0.5, reverbSize: 4,
    modMatrix: makeModMatrix([MR("lfo2", "pitch", 0.05)]),
    lfo2Rate: 0.03
  }),
  preset("fc2-pad-air-atmosphere", "Air Atmosphere", "Airy atmospheric pad with breathy shimmer", "Pad", {
    oscATable: "saw", oscALevel: 0.4,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 10,
    noiseLevel: 0.18, noiseColor: 0.55,
    airHigh: 0.5, airLow: 0.1, airAmount: 0.5,
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.2,
    ampAttack: 1.2, ampDecay: 0.7, ampSustain: 0.9, ampRelease: 2.8,
    unison: 4, unisonDetune: 14, unisonWidth: 0.8,
    reverbMix: 0.6, reverbSize: 5
  }),
  preset("fc2-pad-tilt-warm", "Tilt Warm Pad", "Harmonic tilt creates warm enveloping pad", "Pad", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 12, pulseDuty: 0.4,
    warpTilt: -0.45, warpStretch: -0.15,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.3,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2.2,
    unison: 3, unisonDetune: 12,
    chorusMix: 0.4, reverbMix: 0.5, reverbSize: 4,
    cassetteGen: 0.15
  }),
  preset("fc2-pad-modmatrix-living", "ModMatrix Living", "Complex modulation gives pad organic life", "Pad", {
    oscATable: "saw", oscAPos: 0.4, oscALevel: 0.45,
    oscBTable: "harmonic", oscBPos: 0.65, oscBLevel: 0.45, oscBDetune: 10,
    modMatrix: makeModMatrix([
      MR("lfo1", "wtA", 0.4), MR("lfo2", "wtB", 0.35), MR("lfo1", "cutoff", 0.3),
      MR("lfo2", "pan", 0.4), MR("modenv", "resonance", 0.2)
    ]),
    lfo1Rate: 0.12, lfo1Wave: "sine", lfo2Rate: 0.07, lfo2Wave: "triangle",
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.35,
    ampAttack: 1, ampDecay: 0.7, ampSustain: 0.9, ampRelease: 2.2,
    unison: 3, unisonDetune: 10,
    reverbMix: 0.55, reverbSize: 4.5
  }),
  preset("fc2-pad-tape-memory", "Tape Memory", "Cassette-aged nostalgic pad with warbly character", "Pad", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 12, pulseDuty: 0.4,
    cassetteGen: 0.55, wowFlutter: 0.35, vhsColor: 0.35, hiss: 0.18, printThrough: 0.15,
    filterType: "lowpass", filterCutoff: 2200, filterResonance: 0.25,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 2,
    unison: 3, unisonDetune: 12,
    chorusMix: 0.3, bbdChorus: 0.25,
    reverbMix: 0.45
  }),
  preset("fc2-pad-growl-dark", "Growl Dark Pad", "Dark growling textured pad atmosphere", "Pad", {
    oscATable: "growl", oscALevel: 0.5, oscAPos: 0.4,
    oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 10, oscBOctave: -1,
    filterType: "lowpass", filterCutoff: 1600, filterResonance: 0.35,
    ampAttack: 1.2, ampDecay: 0.8, ampSustain: 0.9, ampRelease: 2.8,
    unison: 3, unisonDetune: 12,
    reverbMix: 0.5, reverbSize: 5,
    lfo1Rate: 0.08, lfo1Depth: 0.25, lfo1Dest: "filter"
  }),
  preset("fc2-pad-spectral-gate", "Spectral Gate Pad", "FFT gate creates rhythmic spectral pad texture", "Pad", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "harmonic", oscBLevel: 0.45, oscBDetune: 12,
    spectralMode: "gate", spectralAmount: 0.55, spectralMix: 0.55,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.3,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2.2,
    unison: 3, unisonDetune: 10,
    reverbMix: 0.5, reverbSize: 4
  }),
  preset("fc2-pad-bell-shimmer", "Bell Shimmer Pad", "Bell tones create shimmering ethereal pad", "Pad", {
    oscATable: "bell", oscALevel: 0.45, oscAPos: 0.5,
    oscBTable: "harmonic", oscBLevel: 0.45, oscBDetune: 8,
    fmAmount: 0.25, fmRatio: 2.5,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.2,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 2,
    unison: 3, unisonDetune: 10, unisonWidth: 0.75,
    reverbMix: 0.6, reverbSize: 5,
    delayMix: 0.22, delayTime: 0.45, delayFeedback: 0.4,
    airHigh: 0.25, airAmount: 0.3
  }),

  // ===== KEYS V2 (20) =====
  preset("fc2-keys-vactrol-ep", "Vactrol EP", "LPG shapes organic electric piano with natural decay", "Keys", {
    oscATable: "bell", oscALevel: 0.55, oscAPos: 0.4,
    oscBTable: "basic", oscBLevel: 0.5,
    lpgOn: true, lpgDecay: 0.65, lpgColor: 0.68,
    chorusMix: 0.28, chorusDepth: 0.45,
    reverbMix: 0.22, reverbSize: 2.2,
    drift: 0.12, voiceInstability: 0.08,
    airHigh: 0.15, airAmount: 0.2
  }),
  preset("fc2-keys-ops4-dx", "Ops4 DX Keys", "4-operator FM classic DX electric piano tines", "Keys", {
    oscATable: "basic", oscALevel: 0.7,
    fmEngine: "ops4", fmAlg: 1, fmOp1Level: 1, fmOp2Level: 0.65, fmOp3Level: 0.4, fmOp4Level: 0.2,
    fmOp2Ratio: 1, fmOp3Ratio: 3, fmOp4Ratio: 7,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.2,
    ampAttack: 0.002, ampDecay: 1.1, ampSustain: 0.28, ampRelease: 0.6,
    chorusMix: 0.25, chorusDepth: 0.4,
    reverbMix: 0.18
  }),
  preset("fc2-keys-warp-tines", "Warp Tines", "Spectral warp shapes unique tine character", "Keys", {
    oscATable: "bell", oscALevel: 0.55, oscAPos: 0.45,
    oscBTable: "basic", oscBLevel: 0.5,
    warpStretch: 0.3, warpTilt: 0.2, warpComb: 0.15,
    filterType: "lowpass", filterCutoff: 5200, filterResonance: 0.25,
    ampAttack: 0.002, ampDecay: 0.95, ampSustain: 0.32, ampRelease: 0.55,
    chorusMix: 0.32, chorusDepth: 0.45,
    reverbMix: 0.2
  }),
  preset("fc2-keys-vector-morph", "Vector Morph Keys", "XY motion morphs between key timbres", "Keys", {
    oscATable: "bell", oscAPos: 0.3, oscALevel: 0.5,
    oscBTable: "basic", oscBPos: 0.65, oscBLevel: 0.5,
    vectorRate: 0.25, vectorDepth: 0.45,
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.25,
    ampAttack: 0.002, ampDecay: 0.9, ampSustain: 0.35, ampRelease: 0.55,
    chorusMix: 0.28,
    modMatrix: makeModMatrix([MR("velocity", "cutoff", 0.4), MR("modenv", "wtA", 0.3)])
  }),
  preset("fc2-keys-freeze-sustain", "Freeze Sustain Keys", "Spectral freeze sustains keys infinitely", "Keys", {
    oscATable: "bell", oscALevel: 0.55,
    oscBTable: "basic", oscBLevel: 0.5,
    spectralMode: "freeze", spectralAmount: 0.55, spectralMix: 0.4,
    filterType: "lowpass", filterCutoff: 4800, filterResonance: 0.2,
    ampAttack: 0.003, ampDecay: 1, ampSustain: 0.45, ampRelease: 1.2,
    reverbMix: 0.35, reverbSize: 3
  }),
  preset("fc2-keys-drift-wurli", "Drift Wurli", "Unstable vintage Wurlitzer with tube warmth", "Keys", {
    oscATable: "saw", oscALevel: 0.6,
    oscBTable: "pulse", oscBLevel: 0.45, pulseDuty: 0.35, oscBDetune: 8,
    drift: 0.45, voiceInstability: 0.28, tuneVariance: 0.18, envVariance: 0.15,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.35,
    ampAttack: 0.003, ampDecay: 0.8, ampSustain: 0.35, ampRelease: 0.45,
    drive: 0.3, driveMode: "tube",
    cassetteGen: 0.28, wowFlutter: 0.1
  }),
  preset("fc2-keys-comb-clav", "Comb Clav", "Warp comb adds clav bite and bark", "Keys", {
    oscATable: "pulse", oscAPos: 0.28, oscALevel: 0.7, pulseDuty: 0.3,
    oscBTable: "saw", oscBLevel: 0.4,
    warpComb: 0.45, warpTilt: 0.25,
    filterType: "lowpass", filterCutoff: 5200, filterResonance: 0.4, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.15, ampRelease: 0.18,
    filtAttack: 0.001, filtDecay: 0.2, filtSustain: 0.1, filtRelease: 0.12,
    punch: 0.35
  }),
  preset("fc2-keys-gated-organ", "Gated Organ", "Gate creates rhythmic organ chops with chorus", "Keys", {
    oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.5, pulseDuty: 0.5,
    oscBTable: "pulse", oscBPos: 0.25, oscBLevel: 0.4, oscBOctave: 1,
    oscCTable: "basic", oscCLevel: 0.3, oscCOctave: 2,
    gateOn: true, gateRate: 8, gateDepth: 0.75, gateSmooth: 0.28,
    gatePattern: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1],
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.2,
    ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.9, ampRelease: 0.18,
    chorusMix: 0.25
  }),
  preset("fc2-keys-lpg-marimba", "LPG Marimba Keys", "Vactrol gate shapes authentic marimba keyboard", "Keys", {
    oscATable: "basic", oscALevel: 0.6,
    oscBTable: "bell", oscBLevel: 0.4,
    fmAmount: 0.22, fmRatio: 2.5,
    lpgOn: true, lpgDecay: 0.4, lpgColor: 0.62,
    reverbMix: 0.28, reverbSize: 2.5,
    airLow: 0.1, airAmount: 0.15
  }),
  preset("fc2-keys-tape-rhodes", "Tape Rhodes", "Cassette-warped Rhodes with analog warmth", "Keys", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.35, fmRatio: 1,
    cassetteGen: 0.5, wowFlutter: 0.22, analogComp: 0.35, hiss: 0.08,
    filterType: "lowpass", filterCutoff: 3400, filterResonance: 0.25,
    ampAttack: 0.003, ampDecay: 1, ampSustain: 0.35, ampRelease: 0.6,
    chorusMix: 0.32, bbdChorus: 0.25,
    drift: 0.15
  }),
  preset("fc2-keys-chip-piano", "Chip Piano", "8-bit style piano with retro character", "Keys", {
    oscATable: "chip", oscALevel: 0.65, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: 1,
    chipVoiceLimit: 4, chipNoise: "nes",
    filterType: "lowpass", filterCutoff: 5000, filterEnvAmount: 0.25,
    ampAttack: 0.001, ampDecay: 0.55, ampSustain: 0.2, ampRelease: 0.35,
    bitDepth: "8bit"
  }),
  preset("fc2-keys-smear-pad-keys", "Smear Pad Keys", "Spectral smear pads key releases into ambient tails", "Keys", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "basic", oscBLevel: 0.5,
    spectralMode: "smear", spectralAmount: 0.45, spectralMix: 0.4,
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.2,
    ampAttack: 0.003, ampDecay: 0.85, ampSustain: 0.4, ampRelease: 1.4,
    reverbMix: 0.4, reverbSize: 3.5,
    chorusMix: 0.22
  }),
  preset("fc2-keys-sync-organ", "Sync Organ Keys", "Hard sync adds biting organ edge", "Keys", {
    oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.5, pulseDuty: 0.5,
    oscBTable: "pulse", oscBPos: 0.5, oscBLevel: 0.45, oscBOctave: 1,
    hardSync: true,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.3,
    ampAttack: 0.008, ampDecay: 0.25, ampSustain: 0.88, ampRelease: 0.2,
    chorusMix: 0.25,
    lfo1Rate: 6, lfo1Depth: 0.15, lfo1Dest: "filter"
  }),
  preset("fc2-keys-formant-vocal", "Formant Vocal Keys", "Vowel-shaped keyboard with talking resonance", "Keys", {
    oscATable: "formant2", oscALevel: 0.55, oscAPos: 0.4,
    oscBTable: "vocal", oscBLevel: 0.45, oscBPos: 0.55,
    filterType: "bandpass", filterCutoff: 2200, filterResonance: 0.5,
    ampAttack: 0.005, ampDecay: 0.7, ampSustain: 0.4, ampRelease: 0.45,
    lfo1Rate: 4, lfo1Depth: 0.2, lfo1Dest: "filter",
    modMatrix: makeModMatrix([MR("velocity", "wtA", 0.3), MR("modenv", "wtB", 0.35)])
  }),
  preset("fc2-keys-ring-celesta", "Ring Celesta", "Ring mod adds sparkling celesta overtones", "Keys", {
    oscATable: "bell", oscALevel: 0.6, oscAOctave: 1,
    oscBTable: "basic", oscBLevel: 0.4,
    ringAmount: 0.25, ringFreq: 1400,
    filterType: "lowpass", filterCutoff: 6000, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 0.6, ampSustain: 0.12, ampRelease: 0.5,
    reverbMix: 0.4, reverbSize: 3,
    airHigh: 0.25, airAmount: 0.3
  }),
  preset("fc2-keys-air-sparkle", "Air Sparkle Keys", "Airy shimmering keyboard with high-end sparkle", "Keys", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "basic", oscBLevel: 0.5,
    noiseLevel: 0.1, noiseColor: 0.65,
    airHigh: 0.5, airLow: -0.1, airAmount: 0.45,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.2,
    ampAttack: 0.002, ampDecay: 0.85, ampSustain: 0.3, ampRelease: 0.55,
    reverbMix: 0.32, reverbSize: 2.8
  }),
  preset("fc2-keys-modmatrix-ep", "ModMatrix EP", "Modulation matrix shapes EP dynamics and timbre", "Keys", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "basic", oscBLevel: 0.5,
    modMatrix: makeModMatrix([
      MR("velocity", "cutoff", 0.55), MR("velocity", "levelA", 0.35), MR("modenv", "wtA", 0.4),
      MR("keytrack", "resonance", 0.2)
    ]),
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.35,
    ampAttack: 0.002, ampDecay: 0.95, ampSustain: 0.3, ampRelease: 0.55,
    chorusMix: 0.28
  }),
  preset("fc2-keys-fold-clav", "Fold Clav Keys", "Wavefold adds gritty clav harmonics", "Keys", {
    oscATable: "fold", oscALevel: 0.65, oscAPos: 0.4,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.3,
    filterType: "lowpass", filterCutoff: 4800, filterResonance: 0.35, filterDrive: 0.4, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.1, ampRelease: 0.15,
    filtAttack: 0.001, filtDecay: 0.18, filtSustain: 0.08, filtRelease: 0.1,
    punch: 0.4, drive: 0.2
  }),
  preset("fc2-keys-tilt-mellow", "Tilt Mellow Keys", "Harmonic tilt mellows keys into warm comfort", "Keys", {
    oscATable: "basic", oscALevel: 0.6,
    oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 6,
    warpTilt: -0.4, warpStretch: -0.1,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.25,
    ampAttack: 0.005, ampDecay: 0.85, ampSustain: 0.45, ampRelease: 0.55,
    chorusMix: 0.3, reverbMix: 0.22,
    cassetteGen: 0.12
  }),
  preset("fc2-keys-growl-organ", "Growl Organ", "Growling texture adds character to organ keys", "Keys", {
    oscATable: "growl", oscALevel: 0.45, oscAPos: 0.4,
    oscBTable: "pulse", oscBPos: 0.5, oscBLevel: 0.45, oscBOctave: 1, pulseDuty: 0.5,
    oscCTable: "basic", oscCLevel: 0.3, oscCOctave: 2,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.3,
    ampAttack: 0.01, ampDecay: 0.3, ampSustain: 0.88, ampRelease: 0.25,
    chorusMix: 0.25,
    lfo1Rate: 5.5, lfo1Depth: 0.12, lfo1Dest: "filter"
  }),

  // ===== ARP V2 (20) =====
  preset("fc2-arp-spectral-cascade", "Spectral Cascade", "FFT pitch shift creates cascading alien harmonics", "Arp", {
    oscATable: "bell", oscALevel: 0.6, oscAPos: 0.45,
    oscBTable: "harmonic", oscBLevel: 0.4,
    spectralMode: "shift", spectralAmount: 0.3, spectralMix: 0.5,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.25, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.15, ampRelease: 0.2,
    filtAttack: 0.001, filtDecay: 0.15, filtSustain: 0.1, filtRelease: 0.12,
    delayMix: 0.32, delayTime: 0.333, delayFeedback: 0.45,
    reverbMix: 0.28, reverbSize: 2.8
  }, { enabled: true, mode: "up", bpm: 120, division: "1/16", octaves: 2, gate: 0.6 }),
  preset("fc2-arp-vactrol-pluck", "Vactrol Pluck Arp", "LPG shapes organic arp notes with natural decay", "Arp", {
    oscATable: "bell", oscALevel: 0.65, oscAPos: 0.4,
    oscBTable: "basic", oscBLevel: 0.4,
    lpgOn: true, lpgDecay: 0.18, lpgColor: 0.78,
    airHigh: 0.25, airAmount: 0.3,
    reverbMix: 0.35, reverbSize: 3,
    drift: 0.12
  }, { enabled: true, mode: "updown", bpm: 125, division: "1/16", octaves: 2, gate: 0.7 }),
  preset("fc2-arp-warp-alien", "Warp Alien Arp", "Spectral warps create alien arp tones", "Arp", {
    oscATable: "harmonic", oscALevel: 0.6, oscAPos: 0.5,
    oscBTable: "metallic", oscBLevel: 0.35,
    warpStretch: 0.5, warpTilt: 0.35, warpComb: 0.25,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.3, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.12, ampRelease: 0.18,
    filtAttack: 0.001, filtDecay: 0.15, filtSustain: 0.08, filtRelease: 0.1,
    delayMix: 0.28, delayFeedback: 0.4
  }, { enabled: true, mode: "random", bpm: 115, division: "1/16", octaves: 3, gate: 0.55 }),
  preset("fc2-arp-ops4-bell", "Ops4 Bell Arp", "4-operator FM bell cascading arpeggio", "Arp", {
    oscATable: "basic", oscALevel: 0.65,
    fmEngine: "ops4", fmAlg: 2, fmOp1Level: 1, fmOp2Level: 0.55, fmOp3Level: 0.38, fmOp4Level: 0.22,
    fmOp2Ratio: 3, fmOp3Ratio: 5, fmOp4Ratio: 7,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.1, ampRelease: 0.25,
    reverbMix: 0.35, reverbSize: 3
  }, { enabled: true, mode: "up", bpm: 130, division: "1/16", octaves: 2, gate: 0.6 }),
  preset("fc2-arp-vector-shimmer", "Vector Shimmer Arp", "XY motion creates shimmering evolving arps", "Arp", {
    oscATable: "bell", oscAPos: 0.3, oscALevel: 0.5,
    oscBTable: "harmonic", oscBPos: 0.65, oscBLevel: 0.5,
    vectorRate: 0.7, vectorDepth: 0.55,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.25,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.12, ampRelease: 0.2,
    chorusMix: 0.28, reverbMix: 0.35, reverbSize: 3,
    modMatrix: makeModMatrix([MR("lfo1", "pan", 0.35)]),
    lfo1Rate: 0.4
  }, { enabled: true, mode: "updown", bpm: 118, division: "1/16", octaves: 2, gate: 0.55 }),
  preset("fc2-arp-gated-pulse", "Gated Pulse Arp", "Double gate creates complex rhythmic arp patterns", "Arp", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.65, pulseDuty: 0.35,
    oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 5,
    gateOn: true, gateRate: 16, gateDepth: 0.8, gateSmooth: 0.12,
    gatePattern: [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1],
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.35, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.2, ampRelease: 0.12,
    delayMix: 0.2, delayTime: 0.375
  }, { enabled: true, mode: "up", bpm: 140, division: "1/8", octaves: 2, gate: 0.8 }),
  preset("fc2-arp-drift-analog", "Drift Analog Arp", "Unstable tuning adds vintage character to arp", "Arp", {
    oscATable: "saw", oscALevel: 0.6,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 8, pulseDuty: 0.4,
    drift: 0.4, tuneVariance: 0.25, envVariance: 0.18,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.35, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.15, ampRelease: 0.18,
    filtAttack: 0.001, filtDecay: 0.15, filtSustain: 0.1, filtRelease: 0.1,
    cassetteGen: 0.25, wowFlutter: 0.08
  }, { enabled: true, mode: "updown", bpm: 110, division: "1/16", octaves: 2, gate: 0.6 }),
  preset("fc2-arp-smear-trail", "Smear Trail Arp", "Spectral smear creates ghostly arp trails", "Arp", {
    oscATable: "bell", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.45,
    spectralMode: "smear", spectralAmount: 0.55, spectralMix: 0.45,
    filterType: "lowpass", filterCutoff: 5000, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.15, ampRelease: 0.35,
    reverbMix: 0.4, reverbSize: 3.5
  }, { enabled: true, mode: "up", bpm: 100, division: "1/8", octaves: 3, gate: 0.5 }),
  preset("fc2-arp-chip-run", "Chip Run V2", "Enhanced chip arpeggio with noise burst and bitcrush", "Arp", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.25,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1,
    noiseLevel: 0.05, chipNoise: "nes", chipVoiceLimit: 3,
    filterType: "lowpass", filterCutoff: 5800, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.1, ampRelease: 0.08,
    bitDepth: "8bit"
  }, { enabled: true, mode: "up", bpm: 155, division: "1/32", octaves: 3, gate: 0.75 }),
  preset("fc2-arp-acid-slide", "Acid Slide Arp", "303 accent and slide mechanics in arp form", "Arp", {
    oscATable: "saw", oscALevel: 0.8,
    filterType: "lowpass", filterCutoff: 650, filterResonance: 0.85, filterEnvAmount: 0.88, filterDrive: 0.2,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.35, ampRelease: 0.12,
    filtAttack: 0.001, filtDecay: 0.18, filtSustain: 0.06, filtRelease: 0.08,
    accentAmount: 0.72, slideOn: true, glide: 0.08,
    drift: 0.18, mono: true
  }, { enabled: true, mode: "up", bpm: 128, division: "1/16", octaves: 1, gate: 0.6 }),
  preset("fc2-arp-comb-metallic", "Comb Metallic Arp", "Warp comb adds metallic resonance to arp", "Arp", {
    oscATable: "bell", oscALevel: 0.6, oscAPos: 0.45,
    oscBTable: "metallic", oscBLevel: 0.4,
    warpComb: 0.6, warpStretch: 0.18, warpTilt: 0.1,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.1, ampRelease: 0.2,
    delayMix: 0.28, delayFeedback: 0.4, reverbMix: 0.28
  }, { enabled: true, mode: "updown", bpm: 122, division: "1/16", octaves: 2, gate: 0.55 }),
  preset("fc2-arp-ring-sparkle", "Ring Sparkle Arp", "Ring mod adds sparkling overtones to arp", "Arp", {
    oscATable: "bell", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.45,
    ringAmount: 0.35, ringFreq: 720,
    filterType: "lowpass", filterCutoff: 6000, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.1, ampRelease: 0.22,
    reverbMix: 0.35, reverbSize: 3,
    airHigh: 0.2, airAmount: 0.25
  }, { enabled: true, mode: "random", bpm: 118, division: "1/16", octaves: 2, gate: 0.5 }),
  preset("fc2-arp-sync-aggressive", "Sync Aggressive Arp", "Hard sync creates aggressive biting arp", "Arp", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "saw", oscBLevel: 0.5, oscBOctave: 1,
    hardSync: true,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.4, filterEnvAmount: 0.55,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.15, ampRelease: 0.12,
    filtAttack: 0.001, filtDecay: 0.12, filtSustain: 0.1, filtRelease: 0.08,
    modMatrix: makeModMatrix([MR("velocity", "cutoff", 0.45)])
  }, { enabled: true, mode: "up", bpm: 138, division: "1/16", octaves: 2, gate: 0.65 }),
  preset("fc2-arp-tape-nostalgia", "Tape Nostalgia Arp", "Cassette-aged nostalgic arp with wow flutter", "Arp", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.6, pulseDuty: 0.4,
    oscBTable: "basic", oscBLevel: 0.4,
    cassetteGen: 0.5, wowFlutter: 0.28, hiss: 0.15, analogComp: 0.25,
    filterType: "lowpass", filterCutoff: 3500, filterEnvAmount: 0.4,
    ampAttack: 0.002, ampDecay: 0.25, ampSustain: 0.15, ampRelease: 0.2,
    chorusMix: 0.22, bbdChorus: 0.2,
    drift: 0.15
  }, { enabled: true, mode: "updown", bpm: 95, division: "1/8", octaves: 2, gate: 0.65 }),
  preset("fc2-arp-formant-chatter", "Formant Chatter Arp", "Vocal formant creates chattering arp character", "Arp", {
    oscATable: "formant2", oscALevel: 0.6, oscAPos: 0.4,
    oscBTable: "vocal", oscBLevel: 0.45, oscBPos: 0.55,
    filterType: "bandpass", filterCutoff: 2000, filterResonance: 0.5,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.12, ampRelease: 0.15,
    lfo1Rate: 6, lfo1Depth: 0.2, lfo1Dest: "filter",
    modMatrix: makeModMatrix([MR("modenv", "wtA", 0.4), MR("velocity", "wtB", 0.3)])
  }, { enabled: true, mode: "random", bpm: 120, division: "1/16", octaves: 2, gate: 0.55 }),
  preset("fc2-arp-air-sparkle", "Air Sparkle Arp", "Airy shimmering arpeggio with high-end sparkle", "Arp", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "harmonic", oscBLevel: 0.45,
    noiseLevel: 0.12, noiseColor: 0.7,
    airHigh: 0.55, airLow: -0.1, airAmount: 0.5,
    filterType: "lowpass", filterCutoff: 6000, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.1, ampRelease: 0.25,
    reverbMix: 0.4, reverbSize: 3.5
  }, { enabled: true, mode: "up", bpm: 112, division: "1/16", octaves: 2, gate: 0.55 }),
  preset("fc2-arp-modmatrix-evolve", "ModMatrix Evolve Arp", "Modulation matrix creates evolving arp timbre", "Arp", {
    oscATable: "bell", oscAPos: 0.4, oscALevel: 0.55,
    oscBTable: "harmonic", oscBPos: 0.6, oscBLevel: 0.45,
    modMatrix: makeModMatrix([
      MR("lfo1", "wtA", 0.45), MR("modenv", "cutoff", 0.5), MR("random", "pan", 0.35),
      MR("velocity", "resonance", 0.3)
    ]),
    lfo1Rate: 0.35, lfo1Wave: "sine",
    filterType: "lowpass", filterCutoff: 4800, filterResonance: 0.4, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.12, ampRelease: 0.22,
    delayMix: 0.28, delayFeedback: 0.4
  }, { enabled: true, mode: "updown", bpm: 115, division: "1/16", octaves: 2, gate: 0.6 }),
  preset("fc2-arp-fold-edge", "Fold Edge Arp", "Wavefold adds rich harmonic edge to arp", "Arp", {
    oscATable: "fold", oscALevel: 0.65, oscAPos: 0.45,
    oscBTable: "saw", oscBLevel: 0.4,
    filterType: "lowpass", filterCutoff: 5200, filterResonance: 0.35, filterDrive: 0.35, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.12, ampRelease: 0.15,
    filtAttack: 0.001, filtDecay: 0.12, filtSustain: 0.08, filtRelease: 0.08,
    drive: 0.18
  }, { enabled: true, mode: "up", bpm: 135, division: "1/16", octaves: 2, gate: 0.65 }),
  preset("fc2-arp-tilt-bright", "Tilt Bright Arp", "Harmonic tilt adds searing brightness to arp", "Arp", {
    oscATable: "harmonic", oscALevel: 0.6, oscAPos: 0.5,
    oscBTable: "bell", oscBLevel: 0.4,
    warpTilt: 0.55, warpStretch: 0.12,
    filterType: "lowpass", filterCutoff: 6000, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.1, ampRelease: 0.2,
    delayMix: 0.22, delayFeedback: 0.38,
    reverbMix: 0.28, airHigh: 0.25, airAmount: 0.3
  }, { enabled: true, mode: "updown", bpm: 125, division: "1/16", octaves: 2, gate: 0.55 }),
  preset("fc2-arp-gb-melody", "GB Melody Arp", "Gameboy wave channel melody arpeggio", "Arp", {
    oscATable: "chip", oscALevel: 0.65, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: 1,
    chipNoise: "gb", chipVoiceLimit: 3,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.1, ampRelease: 0.15,
    delayMix: 0.22, delayTime: 0.25, delayFeedback: 0.4
  }, { enabled: true, mode: "up", bpm: 145, division: "1/16", octaves: 3, gate: 0.7 }),

  // ===== FX V2 (20) =====
  preset("fc2-fx-spectral-freeze", "Spectral Freeze FX", "FFT freeze captures and suspends any sonic moment", "FX", {
    oscATable: "harmonic", oscALevel: 0.55, oscAPos: 0.5,
    oscBTable: "metallic", oscBLevel: 0.4,
    noiseLevel: 0.22,
    spectralMode: "freeze", spectralAmount: 0.92, spectralMix: 0.85,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.25,
    ampAttack: 0.35, ampDecay: 0.5, ampSustain: 0.85, ampRelease: 2.5,
    reverbMix: 0.55, reverbSize: 5,
    stereoWidth: 1.25
  }),
  preset("fc2-fx-spectral-smear", "Spectral Smear FX", "FFT smear creates infinite ghostly trails", "FX", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "bell", oscBLevel: 0.35,
    noiseLevel: 0.28,
    spectralMode: "smear", spectralAmount: 0.88, spectralMix: 0.75,
    filterType: "lowpass", filterCutoff: 3500, filterResonance: 0.2,
    ampAttack: 0.5, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 3,
    reverbMix: 0.6, reverbSize: 5.5,
    drift: 0.15
  }),
  preset("fc2-fx-warp-riser", "Warp Riser", "Spectral warp creates rising tension and anticipation", "FX", {
    oscATable: "saw", oscALevel: 0.6,
    oscBTable: "harmonic", oscBLevel: 0.4,
    noiseLevel: 0.32,
    warpStretch: 0.75, warpTilt: 0.55, warpComb: 0.25,
    lfo1Rate: 0.08, lfo1Depth: 0.65, lfo1Dest: "filter", lfo1Wave: "sawtooth",
    filterType: "lowpass", filterCutoff: 800, filterResonance: 0.5,
    ampAttack: 1.8, ampDecay: 0.5, ampSustain: 0.85, ampRelease: 0.8,
    reverbMix: 0.45, stereoWidth: 1.3
  }),
  preset("fc2-fx-ops4-metallic", "Ops4 Metallic Hit", "4-operator FM industrial metallic impact", "FX", {
    oscATable: "metallic", oscALevel: 0.65,
    oscBTable: "bell", oscBLevel: 0.45,
    fmEngine: "ops4", fmAlg: 6, fmOp1Level: 1, fmOp2Level: 0.85, fmOp3Level: 0.65, fmOp4Level: 0.5,
    fmOp2Ratio: 1.4, fmOp3Ratio: 3.5, fmOp4Ratio: 7, fmFeedback: 0.55,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.3,
    ampAttack: 0.001, ampDecay: 0.55, ampSustain: 0.05, ampRelease: 0.6,
    reverbMix: 0.45, reverbSize: 4,
    drive: 0.32, driveMode: "tube"
  }),
  preset("fc2-fx-vactrol-strike", "Vactrol Strike", "LPG percussion strike with organic decay character", "FX", {
    oscATable: "metallic", oscALevel: 0.65,
    oscBTable: "bell", oscBLevel: 0.5,
    oscCTable: "basic", oscCLevel: 0.3, oscCOctave: -1,
    lpgOn: true, lpgDecay: 0.35, lpgColor: 0.88,
    reverbMix: 0.4, reverbSize: 3.5,
    punch: 0.45
  }),
  preset("fc2-fx-gated-stutter", "Gated Stutter FX", "Complex gate creates intense stutter effects", "FX", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.45, pulseDuty: 0.35,
    noiseLevel: 0.28,
    gateOn: true, gateRate: 24, gateDepth: 0.95, gateSmooth: 0.05,
    gatePattern: [1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1],
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.4,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.6, ampRelease: 0.1,
    drive: 0.3, driveMode: "hard"
  }),
  preset("fc2-fx-vector-sweep", "Vector Sweep FX", "XY motion creates sweeping evolving textures", "FX", {
    oscATable: "saw", oscAPos: 0.2, oscALevel: 0.5,
    oscBTable: "metallic", oscBPos: 0.75, oscBLevel: 0.5,
    vectorRate: 0.45, vectorDepth: 0.85,
    filterType: "bandpass", filterCutoff: 2000, filterResonance: 0.5,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 1.5,
    stereoWidth: 1.35, phaserMix: 0.3, phaserRate: 0.15, phaserDepth: 0.7,
    reverbMix: 0.5
  }),
  preset("fc2-fx-drift-chaos", "Drift Chaos", "Unstable drifting creates chaotic textural FX", "FX", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "metallic", oscBLevel: 0.45, oscBDetune: 30,
    oscCTable: "bell", oscCLevel: 0.3, oscCDetune: -20,
    drift: 0.85, driftRate: 0.75, voiceInstability: 0.55, tuneVariance: 0.45,
    filterType: "lowpass", filterCutoff: 2500, filterResonance: 0.4,
    ampAttack: 0.6, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1.5,
    reverbMix: 0.5, reverbSize: 4
  }),
  preset("fc2-fx-spectral-gate", "Spectral Gate FX", "FFT gate creates rhythmic spectral textures", "FX", {
    oscATable: "saw", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.45,
    noiseLevel: 0.3,
    spectralMode: "gate", spectralAmount: 0.65, spectralMix: 0.6,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.3,
    ampAttack: 0.3, ampDecay: 0.4, ampSustain: 0.75, ampRelease: 0.8,
    reverbMix: 0.45
  }),
  preset("fc2-fx-comb-resonance", "Comb Resonance FX", "Warp comb creates resonant sweeping textures", "FX", {
    oscATable: "saw", oscALevel: 0.6,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    noiseLevel: 0.22,
    warpComb: 0.85, warpStretch: 0.35, warpTilt: 0.2,
    lfo1Rate: 0.12, lfo1Depth: 0.55, lfo1Dest: "filter", lfo1Wave: "triangle",
    filterType: "lowpass", filterCutoff: 2500, filterResonance: 0.55,
    ampAttack: 0.6, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1.2,
    reverbMix: 0.45, stereoWidth: 1.2
  }),
  preset("fc2-fx-ring-alien", "Ring Alien FX", "Ring mod creates otherworldly alien textures", "FX", {
    oscATable: "saw", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.4,
    noiseLevel: 0.18,
    ringAmount: 0.65, ringFreq: 580,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.35,
    ampAttack: 0.4, ampDecay: 0.5, ampSustain: 0.75, ampRelease: 1.5,
    reverbMix: 0.45, delayMix: 0.28, delayFeedback: 0.5,
    stereoWidth: 1.25
  }),
  preset("fc2-fx-tape-deteriorate", "Tape Deteriorate", "Severely degraded tape creates textural chaos", "FX", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    noiseLevel: 0.25,
    cassetteGen: 0.88, wowFlutter: 0.7, vhsColor: 0.55, hiss: 0.45, dust: 0.35, printThrough: 0.3,
    filterType: "lowpass", filterCutoff: 2000, filterResonance: 0.25,
    ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1.2,
    reverbMix: 0.4
  }),
  preset("fc2-fx-chip-explosion", "Chip Explosion", "8-bit explosion with pitch dive and noise burst", "FX", {
    oscATable: "chip", oscALevel: 0.65, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: -1,
    noiseLevel: 0.55, chipNoise: "nes",
    pitchEnvAmount: -0.85, pitchEnvTime: 0.45,
    filterType: "lowpass", filterCutoff: 4500, filterEnvAmount: 0.5,
    ampAttack: 0.001, ampDecay: 0.65, ampSustain: 0.08, ampRelease: 0.5,
    filtAttack: 0.001, filtDecay: 0.5, filtSustain: 0.1, filtRelease: 0.4,
    bitDepth: "8bit", punch: 0.5
  }),
  preset("fc2-fx-spectral-shift-up", "Spectral Shift Up", "FFT pitch shift creates rising harmonic cascade", "FX", {
    oscATable: "saw", oscALevel: 0.55,
    oscBTable: "harmonic", oscBLevel: 0.45,
    spectralMode: "shift", spectralAmount: 0.45, spectralMix: 0.65,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.25,
    ampAttack: 1.2, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1.8,
    reverbMix: 0.5, reverbSize: 4.5,
    stereoWidth: 1.2
  }),
  preset("fc2-fx-fold-distort", "Fold Distort FX", "Wavefold creates harsh distorted textures", "FX", {
    oscATable: "fold", oscALevel: 0.65, oscAPos: 0.5,
    oscBTable: "saw", oscBLevel: 0.45,
    noiseLevel: 0.18,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.4, filterDrive: 0.65,
    ampAttack: 0.3, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.8,
    drive: 0.55, driveMode: "fold",
    reverbMix: 0.35
  }),
  preset("fc2-fx-sync-screech", "Sync Screech FX", "Hard sync creates screeching pitch-dive FX", "FX", {
    oscATable: "saw", oscALevel: 0.7,
    oscBTable: "saw", oscBLevel: 0.55, oscBOctave: 2,
    hardSync: true,
    pitchEnvAmount: 0.6, pitchEnvTime: 0.55,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.6,
    ampAttack: 0.002, ampDecay: 0.65, ampSustain: 0.1, ampRelease: 0.5,
    filtAttack: 0.001, filtDecay: 0.5, filtSustain: 0.15, filtRelease: 0.4,
    reverbMix: 0.4
  }),
  preset("fc2-fx-formant-morph", "Formant Morph FX", "Vocal formant morphing creates alien voice texture", "FX", {
    oscATable: "vocal", oscAPos: 0.2, oscALevel: 0.55,
    oscBTable: "formant2", oscBPos: 0.75, oscBLevel: 0.5,
    lfo1Rate: 0.18, lfo1Depth: 0.55, lfo1Dest: "filter", lfo1Wave: "triangle",
    filterType: "bandpass", filterCutoff: 1800, filterResonance: 0.55,
    ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1,
    modMatrix: makeModMatrix([MR("lfo2", "wtA", 0.45), MR("lfo2", "wtB", 0.4)]),
    lfo2Rate: 0.12,
    reverbMix: 0.45
  }),
  preset("fc2-fx-modmatrix-chaos", "ModMatrix Chaos FX", "Complex modulation creates controlled chaos", "FX", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "metallic", oscBLevel: 0.45, oscBDetune: 18,
    oscCTable: "bell", oscCLevel: 0.35,
    modMatrix: makeModMatrix([
      MR("lfo1", "pitch", 0.35), MR("lfo2", "cutoff", 0.55), MR("random", "pan", 0.65),
      MR("modenv", "fm", 0.45), MR("lfo1", "wtA", 0.3)
    ]),
    lfo1Rate: 3.5, lfo2Rate: 0.18, fmAmount: 0.4, fmRatio: 3,
    filterType: "lowpass", filterCutoff: 3500, filterResonance: 0.4,
    ampAttack: 0.4, ampDecay: 0.5, ampSustain: 0.75, ampRelease: 1,
    reverbMix: 0.45
  }),
  preset("fc2-fx-air-whoosh", "Air Whoosh V2", "Enhanced airy whoosh with stereo movement", "FX", {
    noiseLevel: 0.78, noiseColor: 0.45,
    oscATable: "basic", oscALevel: 0.18,
    airHigh: 0.65, airLow: 0.15, airAmount: 0.55,
    filterType: "bandpass", filterCutoff: 2800, filterResonance: 0.35,
    lfo1Rate: 0.35, lfo1Depth: 0.65, lfo1Dest: "pan", lfo1Wave: "sine",
    ampAttack: 0.35, ampDecay: 0.5, ampSustain: 0.7, ampRelease: 1.4,
    stereoWidth: 1.45, reverbMix: 0.45
  }),
  preset("fc2-fx-growl-monster", "Growl Monster FX", "Monstrous growling beast texture", "FX", {
    oscATable: "growl", oscALevel: 0.65, oscAPos: 0.5,
    oscBTable: "growl", oscBLevel: 0.5, oscBDetune: 25, oscBOctave: -1,
    filterType: "lowpass", filterCutoff: 1400, filterResonance: 0.45, filterDrive: 0.55,
    ampAttack: 0.35, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1.6,
    drive: 0.45, driveMode: "tube",
    lfo1Rate: 0.5, lfo1Depth: 0.35, lfo1Dest: "filter",
    reverbMix: 0.4
  }),

  // ===== ATMOS V2 (20) =====
  preset("fc2-atmos-spectral-void", "Spectral Void", "FFT freeze creates infinite void atmosphere", "Atmos", {
    oscATable: "harmonic", oscALevel: 0.4, oscAPos: 0.5,
    oscBTable: "saw", oscBLevel: 0.35, oscBDetune: 12,
    oscCTable: "bell", oscCLevel: 0.25, oscCOctave: 1,
    spectralMode: "freeze", spectralAmount: 0.8, spectralMix: 0.65,
    filterType: "lowpass", filterCutoff: 3000, filterResonance: 0.2,
    ampAttack: 1.8, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 3.5,
    reverbMix: 0.65, reverbSize: 6,
    stereoWidth: 1.2
  }),
  preset("fc2-atmos-smear-infinite", "Smear Infinite", "FFT smear extends atmosphere indefinitely", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "pulse", oscBLevel: 0.32, oscBDetune: 15, pulseDuty: 0.4,
    noiseLevel: 0.22,
    spectralMode: "smear", spectralAmount: 0.92, spectralMix: 0.75,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.2,
    ampAttack: 2.2, ampDecay: 1, ampSustain: 0.98, ampRelease: 4.5,
    reverbMix: 0.65, reverbSize: 6,
    drift: 0.15, driftRate: 0.2
  }),
  preset("fc2-atmos-warp-dimension", "Warp Dimension", "Spectral warps create alien dimensional space", "Atmos", {
    oscATable: "harmonic", oscALevel: 0.4, oscAPos: 0.45,
    oscBTable: "vocal", oscBLevel: 0.35, oscBPos: 0.6,
    warpStretch: 0.65, warpTilt: -0.45, warpComb: 0.4,
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.25,
    ampAttack: 1.8, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 4,
    reverbMix: 0.6, reverbSize: 5.5,
    phaserMix: 0.35, phaserRate: 0.08, phaserDepth: 0.65
  }),
  preset("fc2-atmos-ops4-ethereal", "Ops4 Ethereal", "4-operator FM creates ethereal atmosphere", "Atmos", {
    oscATable: "basic", oscALevel: 0.4,
    oscBTable: "bell", oscBLevel: 0.35, oscBDetune: 8,
    fmEngine: "ops4", fmAlg: 4, fmOp1Level: 0.75, fmOp2Level: 0.55, fmOp3Level: 0.38, fmOp4Level: 0.22,
    fmOp2Ratio: 2, fmOp3Ratio: 4, fmOp4Ratio: 6,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.2,
    ampAttack: 1.4, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3.5,
    reverbMix: 0.6, reverbSize: 5,
    chorusMix: 0.25
  }),
  preset("fc2-atmos-vector-drift", "Vector Drift", "XY motion creates slowly drifting atmosphere", "Atmos", {
    oscATable: "harmonic", oscAPos: 0.3, oscALevel: 0.38,
    oscBTable: "saw", oscBPos: 0.65, oscBLevel: 0.35, oscBDetune: 10,
    vectorRate: 0.06, vectorDepth: 0.65,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.25,
    ampAttack: 1.8, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 3.5,
    chorusMix: 0.32, reverbMix: 0.6, reverbSize: 5,
    modMatrix: makeModMatrix([MR("lfo1", "pan", 0.35)]),
    lfo1Rate: 0.05
  }),
  preset("fc2-atmos-gated-pulse", "Gated Pulse Atmos", "Gate creates hypnotic pulsing atmosphere", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "harmonic", oscBLevel: 0.35, oscBDetune: 12,
    unison: 3, unisonDetune: 10, unisonWidth: 0.7,
    gateOn: true, gateRate: 2, gateDepth: 0.55, gateSmooth: 0.65,
    gatePattern: [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.25,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2,
    reverbMix: 0.55, reverbSize: 4.5
  }),
  preset("fc2-atmos-drift-analog", "Drift Analog Atmos", "Unstable vintage atmosphere with organic character", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "pulse", oscBLevel: 0.35, oscBDetune: 18, pulseDuty: 0.4,
    drift: 0.65, driftRate: 0.45, voiceInstability: 0.42, tuneVariance: 0.28,
    filterType: "lowpass", filterCutoff: 2200, filterResonance: 0.3,
    ampAttack: 1.4, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3,
    cassetteGen: 0.4, wowFlutter: 0.18,
    chorusMix: 0.32, reverbMix: 0.55
  }),
  preset("fc2-atmos-comb-hollow", "Comb Hollow Atmos", "Warp comb creates hollow cavernous space", "Atmos", {
    oscATable: "saw", oscALevel: 0.42,
    oscBTable: "harmonic", oscBLevel: 0.35,
    noiseLevel: 0.18,
    warpComb: 0.75, warpTilt: -0.3, warpStretch: -0.15,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.35,
    ampAttack: 1.8, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 3.5,
    reverbMix: 0.6, reverbSize: 5.5
  }),
  preset("fc2-atmos-formant-spirit", "Formant Spirit", "Vocal formant creates ghostly spirit atmosphere", "Atmos", {
    oscATable: "vocal", oscAPos: 0.4, oscALevel: 0.38,
    oscBTable: "formant2", oscBPos: 0.65, oscBLevel: 0.35, oscBDetune: 10,
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.3,
    ampAttack: 1.5, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3.5,
    reverbSize: 5.5, reverbMix: 0.6,
    lfo1Rate: 0.08, lfo1Depth: 0.25, lfo1Dest: "filter",
    modMatrix: makeModMatrix([MR("lfo2", "wtA", 0.25), MR("lfo2", "wtB", 0.2)]),
    lfo2Rate: 0.05
  }),
  preset("fc2-atmos-ring-alien", "Ring Alien Atmos", "Ring mod creates alien atmospheric textures", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "harmonic", oscBLevel: 0.35, oscBDetune: 12,
    ringAmount: 0.35, ringFreq: 250,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.25,
    ampAttack: 1.4, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3,
    reverbMix: 0.55, delayMix: 0.28, delayFeedback: 0.5,
    stereoWidth: 1.2
  }),
  preset("fc2-atmos-tape-memory", "Tape Memory Atmos", "Cassette-degraded atmosphere of fading memory", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "pulse", oscBLevel: 0.35, oscBDetune: 14, pulseDuty: 0.4,
    cassetteGen: 0.65, wowFlutter: 0.45, vhsColor: 0.4, hiss: 0.22, printThrough: 0.18,
    filterType: "lowpass", filterCutoff: 2000, filterResonance: 0.2,
    ampAttack: 1.6, ampDecay: 0.8, ampSustain: 0.9, ampRelease: 3,
    chorusMix: 0.28, bbdChorus: 0.22,
    reverbMix: 0.55
  }),
  preset("fc2-atmos-chip-dream", "Chip Dream Atmos", "8-bit dreamscape atmosphere", "Atmos", {
    oscATable: "chip", oscALevel: 0.38, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1, oscBDetune: 8,
    chipNoise: "nes", chipVoiceLimit: 4,
    filterType: "lowpass", filterCutoff: 3500, filterResonance: 0.2,
    ampAttack: 1.2, ampDecay: 0.7, ampSustain: 0.88, ampRelease: 2.8,
    chorusMix: 0.35, reverbMix: 0.55, reverbSize: 4.5,
    bitDepth: "12bit"
  }),
  preset("fc2-atmos-spectral-gate", "Spectral Gate Atmos", "FFT gate creates rhythmic spectral atmosphere", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "harmonic", oscBLevel: 0.35,
    noiseLevel: 0.22,
    spectralMode: "gate", spectralAmount: 0.5, spectralMix: 0.55,
    filterType: "lowpass", filterCutoff: 3000, filterResonance: 0.25,
    ampAttack: 1.4, ampDecay: 0.7, ampSustain: 0.92, ampRelease: 3,
    reverbMix: 0.55, reverbSize: 5
  }),
  preset("fc2-atmos-sync-evolve", "Sync Evolve Atmos", "Hard sync with slow modulation creates evolving atmosphere", "Atmos", {
    oscATable: "saw", oscALevel: 0.38,
    oscBTable: "saw", oscBLevel: 0.35, oscBOctave: 1,
    hardSync: true,
    lfo1Rate: 0.04, lfo1Depth: 0.4, lfo1Dest: "filter", lfo1Wave: "triangle",
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.35,
    ampAttack: 1.5, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3.5,
    reverbMix: 0.55, reverbSize: 5,
    modMatrix: makeModMatrix([MR("lfo2", "pitch", 0.05)]),
    lfo2Rate: 0.025
  }),
  preset("fc2-atmos-air-shimmer", "Air Shimmer Atmos", "Airy shimmering atmospheric texture", "Atmos", {
    oscATable: "harmonic", oscALevel: 0.35,
    oscBTable: "bell", oscBLevel: 0.32, oscBDetune: 8,
    noiseLevel: 0.22, noiseColor: 0.55,
    airHigh: 0.55, airLow: 0.12, airAmount: 0.55,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.2,
    ampAttack: 1.8, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 3.5,
    reverbMix: 0.6, reverbSize: 5.5
  }),
  preset("fc2-atmos-modmatrix-living", "ModMatrix Living Atmos", "Complex modulation creates living atmosphere", "Atmos", {
    oscATable: "saw", oscAPos: 0.4, oscALevel: 0.38,
    oscBTable: "harmonic", oscBPos: 0.65, oscBLevel: 0.35,
    modMatrix: makeModMatrix([
      MR("lfo1", "wtA", 0.32), MR("lfo2", "wtB", 0.28), MR("lfo1", "cutoff", 0.28),
      MR("lfo2", "pan", 0.38), MR("random", "pitch", 0.05)
    ]),
    lfo1Rate: 0.08, lfo1Wave: "sine", lfo2Rate: 0.045, lfo2Wave: "triangle",
    filterType: "lowpass", filterCutoff: 3000, filterResonance: 0.28,
    ampAttack: 1.4, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3,
    reverbMix: 0.55, reverbSize: 5
  }),
  preset("fc2-atmos-growl-dark", "Growl Dark Atmos", "Dark growling atmosphere from the depths", "Atmos", {
    oscATable: "growl", oscALevel: 0.42, oscAPos: 0.45,
    oscBTable: "saw", oscBLevel: 0.35, oscBDetune: 18, oscBOctave: -1,
    filterType: "lowpass", filterCutoff: 1200, filterResonance: 0.35,
    ampAttack: 1.8, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 4,
    reverbMix: 0.55, reverbSize: 5.5,
    lfo1Rate: 0.06, lfo1Depth: 0.28, lfo1Dest: "filter"
  }),
  preset("fc2-atmos-fold-texture", "Fold Texture Atmos", "Wavefold creates rich textural atmosphere", "Atmos", {
    oscATable: "fold", oscALevel: 0.42, oscAPos: 0.5,
    oscBTable: "saw", oscBLevel: 0.35, oscBDetune: 12,
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.3, filterDrive: 0.28,
    ampAttack: 1.4, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3,
    reverbMix: 0.55, reverbSize: 5,
    drive: 0.15, driveMode: "soft"
  }),
  preset("fc2-atmos-tilt-warm", "Tilt Warm Atmos", "Harmonic tilt creates warm enveloping atmosphere", "Atmos", {
    oscATable: "saw", oscALevel: 0.42,
    oscBTable: "pulse", oscBLevel: 0.35, oscBDetune: 14, pulseDuty: 0.4,
    warpTilt: -0.55, warpStretch: -0.2,
    filterType: "lowpass", filterCutoff: 2200, filterResonance: 0.25,
    ampAttack: 1.5, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3.5,
    chorusMix: 0.35, reverbMix: 0.55, reverbSize: 5,
    cassetteGen: 0.15
  }),
  preset("fc2-atmos-bell-shimmer", "Bell Shimmer Atmos", "Bell tones shimmer in ethereal space", "Atmos", {
    oscATable: "bell", oscALevel: 0.38, oscAPos: 0.5,
    oscBTable: "harmonic", oscBLevel: 0.35, oscBDetune: 10,
    fmAmount: 0.22, fmRatio: 2.5,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.2,
    ampAttack: 1.4, ampDecay: 0.8, ampSustain: 0.92, ampRelease: 3.5,
    reverbMix: 0.6, reverbSize: 5.5,
    delayMix: 0.28, delayTime: 0.5, delayFeedback: 0.45,
    airHigh: 0.25, airAmount: 0.3
  }),

  // ===== VINTAGE V2 (20) =====
  preset("fc2-vintage-vhs-dream", "VHS Dream", "VHS-colored dreamy texture with tracking artifacts", "Vintage", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 12, pulseDuty: 0.4,
    cassetteGen: 0.65, vhsColor: 0.65, wowFlutter: 0.45, hiss: 0.28, printThrough: 0.15,
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.25,
    ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1,
    chorusMix: 0.32, bbdChorus: 0.25,
    reverbMix: 0.45, drift: 0.2
  }),
  preset("fc2-vintage-tape-saturate", "Tape Saturate Deep", "Heavy cassette saturation with analog warmth", "Vintage", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    cassetteGen: 0.78, analogComp: 0.55, wowFlutter: 0.22, hiss: 0.12,
    filterType: "lowpass", filterCutoff: 2000, filterResonance: 0.2,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.7, ampRelease: 0.35,
    drive: 0.35, driveMode: "tube",
    drift: 0.25, voiceInstability: 0.15,
    mono: true
  }),
  preset("fc2-vintage-drift-lead", "Drift Lead Vintage", "Unstable vintage mono lead with tape character", "Vintage", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.45, oscBDetune: 12, pulseDuty: 0.4,
    drift: 0.55, driftRate: 0.55, voiceInstability: 0.38, tuneVariance: 0.22, envVariance: 0.18,
    filterType: "lowpass", filterCutoff: 3200, filterResonance: 0.35, filterEnvAmount: 0.4,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.7, ampRelease: 0.35,
    filtAttack: 0.005, filtDecay: 0.25, filtSustain: 0.4, filtRelease: 0.2,
    cassetteGen: 0.35, wowFlutter: 0.12,
    mono: true
  }),
  preset("fc2-vintage-bbd-chorus", "BBD Chorus Pad", "Bucket-brigade delay chorus creates warm pad", "Vintage", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 10,
    bbdChorus: 0.65, cassetteGen: 0.25, wowFlutter: 0.1,
    filterType: "lowpass", filterCutoff: 2800, filterResonance: 0.25,
    ampAttack: 0.7, ampDecay: 0.5, ampSustain: 0.85, ampRelease: 1.6,
    unison: 3, unisonDetune: 8,
    reverbMix: 0.4, drift: 0.18
  }),
  preset("fc2-vintage-print-through", "Print Through Ghost", "Tape print-through creates ghostly echoes", "Vintage", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "harmonic", oscBLevel: 0.4, oscBDetune: 14,
    cassetteGen: 0.55, printThrough: 0.65, wowFlutter: 0.35, hiss: 0.22,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.25,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 1.5,
    reverbMix: 0.45, reverbSize: 4
  }),
  preset("fc2-vintage-dust-crackle", "Dust Crackle Keys", "Dusty vinyl-like keyboard with surface noise", "Vintage", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.3, fmRatio: 1,
    dust: 0.55, cassetteGen: 0.4, hiss: 0.22,
    filterType: "lowpass", filterCutoff: 3400, filterResonance: 0.2,
    ampAttack: 0.003, ampDecay: 0.85, ampSustain: 0.3, ampRelease: 0.55,
    chorusMix: 0.28
  }),
  preset("fc2-vintage-hum-drone", "Hum Drone Vintage", "60Hz hum adds authentic vintage character", "Vintage", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "saw", oscBLevel: 0.4, oscBOctave: -1,
    hum: 0.45, cassetteGen: 0.35, analogComp: 0.35, hiss: 0.15,
    filterType: "lowpass", filterCutoff: 1400, filterResonance: 0.25,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 2,
    reverbMix: 0.4, drift: 0.2
  }),
  preset("fc2-vintage-bitcrush-retro", "Bitcrush Retro", "Bit reduction creates retro sampler texture", "Vintage", {
    oscATable: "saw", oscALevel: 0.6,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    bitDepth: "8bit", sampleRateReduce: 0.45, cassetteGen: 0.3,
    filterType: "lowpass", filterCutoff: 3000, filterResonance: 0.25,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.65, ampRelease: 0.35,
    mono: true
  }),
  preset("fc2-vintage-env-variance", "Env Variance Keys", "Envelope jitter adds organic vintage character", "Vintage", {
    oscATable: "bell", oscALevel: 0.55,
    oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.35, fmRatio: 1,
    envVariance: 0.45, tuneVariance: 0.18, drift: 0.2,
    cassetteGen: 0.3, wowFlutter: 0.1,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.25,
    ampAttack: 0.003, ampDecay: 0.9, ampSustain: 0.32, ampRelease: 0.55,
    chorusMix: 0.25
  }),
  preset("fc2-vintage-tape-stop", "Tape Stop Effect", "Variable tape speed for slowdown stop effect", "Vintage", {
    oscATable: "saw", oscALevel: 0.6,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    tapeSpeed: -0.55, cassetteGen: 0.55, wowFlutter: 0.45, hiss: 0.15,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.2,
    ampAttack: 0.01, ampDecay: 0.35, ampSustain: 0.7, ampRelease: 0.4,
    mono: true
  }),
  preset("fc2-vintage-analog-comp", "Analog Comp Punch", "Analog compression pumping with tape warmth", "Vintage", {
    oscATable: "saw", oscALevel: 0.65,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    subLevel: 0.35,
    analogComp: 0.65, cassetteGen: 0.25, wowFlutter: 0.08,
    filterType: "lowpass", filterCutoff: 1600, filterResonance: 0.25,
    ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.6, ampRelease: 0.3,
    punch: 0.45, mono: true
  }),
  preset("fc2-vintage-am-radio", "AM Radio Texture", "AM radio bandpass with static and hiss", "Vintage", {
    oscATable: "basic", oscALevel: 0.55,
    oscBTable: "pulse", oscBLevel: 0.35, pulseDuty: 0.5,
    noiseLevel: 0.18,
    filterType: "bandpass", filterCutoff: 1600, filterResonance: 0.55,
    ampAttack: 0.02, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.4,
    cassetteGen: 0.45, hiss: 0.4, hum: 0.15
  }),
  preset("fc2-vintage-warp-aged", "Warp Aged", "Spectral warp simulates aged frequency response", "Vintage", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 10, pulseDuty: 0.4,
    warpStretch: -0.25, warpTilt: -0.35,
    cassetteGen: 0.5, wowFlutter: 0.28, hiss: 0.18,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.25,
    ampAttack: 0.02, ampDecay: 0.4, ampSustain: 0.75, ampRelease: 0.5,
    chorusMix: 0.28, reverbMix: 0.35,
    drift: 0.2
  }),
  preset("fc2-vintage-drift-pad", "Drift Pad Vintage", "Unstable vintage pad with warm character", "Vintage", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 14,
    drift: 0.6, driftRate: 0.5, voiceInstability: 0.35, tuneVariance: 0.2,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.3,
    ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.88, ampRelease: 2,
    unison: 3, unisonDetune: 10,
    cassetteGen: 0.4, wowFlutter: 0.2,
    chorusMix: 0.35, reverbMix: 0.45
  }),
  preset("fc2-vintage-formant-radio", "Formant Radio", "Vocal formant through vintage radio filter", "Vintage", {
    oscATable: "vocal", oscALevel: 0.55, oscAPos: 0.4,
    oscBTable: "formant2", oscBLevel: 0.4, oscBPos: 0.55,
    filterType: "bandpass", filterCutoff: 1800, filterResonance: 0.5,
    ampAttack: 0.02, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.4,
    cassetteGen: 0.45, hiss: 0.35, hum: 0.12
  }),
  preset("fc2-vintage-12bit-ep", "12-Bit EP", "12-bit sampler electric piano character", "Vintage", {
    oscATable: "bell", oscALevel: 0.5,
    oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.4, fmRatio: 1,
    bitDepth: "12bit", sampleRateReduce: 0.22, cassetteGen: 0.25,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.2,
    ampAttack: 0.003, ampDecay: 1, ampSustain: 0.32, ampRelease: 0.6,
    chorusMix: 0.28
  }),
  preset("fc2-vintage-vhs-pad", "VHS Pad Deep", "Deep VHS-colored pad with tracking wobble", "Vintage", {
    oscATable: "saw", oscALevel: 0.45,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 12, pulseDuty: 0.4,
    cassetteGen: 0.6, vhsColor: 0.6, wowFlutter: 0.4, hiss: 0.22, printThrough: 0.12,
    filterType: "lowpass", filterCutoff: 2200, filterResonance: 0.2,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.88, ampRelease: 2.2,
    unison: 3, unisonDetune: 10,
    chorusMix: 0.32, bbdChorus: 0.2,
    reverbMix: 0.5
  }),
  preset("fc2-vintage-broken-tape", "Broken Tape", "Severely degraded tape with heavy artifacts", "Vintage", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, pulseDuty: 0.4,
    cassetteGen: 0.9, wowFlutter: 0.75, printThrough: 0.45, dust: 0.4, hiss: 0.45, vhsColor: 0.3,
    filterType: "lowpass", filterCutoff: 1600, filterResonance: 0.2,
    ampAttack: 0.02, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.5,
    mono: true
  }),
  preset("fc2-vintage-bbd-bass", "BBD Bass", "Bucket-brigade chorus on deep bass", "Vintage", {
    oscATable: "saw", oscALevel: 0.65, oscAOctave: -1,
    oscBTable: "pulse", oscBLevel: 0.4, oscBOctave: -1, pulseDuty: 0.4,
    subLevel: 0.4,
    bbdChorus: 0.55, cassetteGen: 0.3, analogComp: 0.3,
    filterType: "lowpass", filterCutoff: 1100, filterResonance: 0.25,
    ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.55, ampRelease: 0.35,
    mono: true
  }),
  preset("fc2-vintage-modmatrix-age", "ModMatrix Age", "Modulation simulates aging and instability", "Vintage", {
    oscATable: "saw", oscALevel: 0.5,
    oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 10, pulseDuty: 0.4,
    modMatrix: makeModMatrix([
      MR("lfo1", "pitch", 0.18), MR("lfo2", "cutoff", 0.25), MR("random", "levelA", 0.12),
      MR("random", "pan", 0.15)
    ]),
    lfo1Rate: 0.35, lfo1Wave: "sine", lfo2Rate: 0.18, lfo2Wave: "triangle",
    cassetteGen: 0.45, wowFlutter: 0.28, hiss: 0.15,
    filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.25,
    ampAttack: 0.02, ampDecay: 0.4, ampSustain: 0.75, ampRelease: 0.5,
    chorusMix: 0.25, drift: 0.25
  }),

  // ===== CHIP V2 (20) =====
  preset("fc2-chip-nes-lead", "NES Lead V2", "Enhanced NES-style lead with authentic character", "Chip", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1,
    noiseLevel: 0.06, chipNoise: "nes", chipVoiceLimit: 2,
    filterType: "lowpass", filterCutoff: 5800, filterEnvAmount: 0.25,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.6, ampRelease: 0.18,
    bitDepth: "8bit",
    lfo1Rate: 5.5, lfo1Depth: 0.15, lfo1Dest: "pitch",
    mono: true
  }),
  preset("fc2-chip-gb-bass", "GB Bass V2", "Gameboy wave channel bass with authentic chip sound", "Chip", {
    oscATable: "chip", oscALevel: 0.75, oscAOctave: -1, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.4, oscBOctave: -2,
    chipNoise: "gb", chipVoiceLimit: 3,
    filterType: "lowpass", filterCutoff: 2000, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.5, ampRelease: 0.2,
    bitDepth: "8bit",
    mono: true, punch: 0.35
  }),
  preset("fc2-chip-periodic-noise", "Periodic Noise", "Periodic LFSR noise creates metallic texture", "Chip", {
    noiseLevel: 0.7, chipNoise: "periodic",
    oscATable: "chip", oscALevel: 0.32, pulseDuty: 0.25,
    filterType: "bandpass", filterCutoff: 2500, filterResonance: 0.4,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.15, ampRelease: 0.12,
    bitDepth: "8bit", chipVoiceLimit: 2
  }),
  preset("fc2-chip-duty-sweep", "Duty Sweep", "PWM duty cycle sweeping with LFO modulation", "Chip", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.5,
    oscBTable: "pulse", oscBLevel: 0.35, oscBOctave: 1,
    lfo1Rate: 2.5, lfo1Depth: 0.45, lfo1Dest: "filter", lfo1Wave: "triangle",
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.25,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.6, ampRelease: 0.22,
    chipVoiceLimit: 2, bitDepth: "8bit",
    mono: true
  }),
  preset("fc2-chip-slide-acid", "Slide Acid Chip", "Chip with 303-style slides and accents", "Chip", {
    oscATable: "chip", oscALevel: 0.78, pulseDuty: 0.25,
    filterType: "lowpass", filterCutoff: 750, filterResonance: 0.78, filterEnvAmount: 0.82,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.4, ampRelease: 0.12,
    filtAttack: 0.001, filtDecay: 0.18, filtSustain: 0.08, filtRelease: 0.08,
    accentAmount: 0.68, slideOn: true, glide: 0.1,
    chipVoiceLimit: 1, bitDepth: "8bit",
    mono: true
  }),
  preset("fc2-chip-arp-cascade", "Chip Arp Cascade", "Fast chip arpeggio cascade with delay", "Chip", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1,
    chipNoise: "nes", chipVoiceLimit: 3,
    filterType: "lowpass", filterCutoff: 5800, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.1, ampRelease: 0.1,
    bitDepth: "8bit",
    delayMix: 0.2, delayTime: 0.25, delayFeedback: 0.4
  }, { enabled: true, mode: "up", bpm: 160, division: "1/32", octaves: 3, gate: 0.75 }),
  preset("fc2-chip-warp-retro", "Warp Retro Chip", "Spectral warp adds alien twist to chip tone", "Chip", {
    oscATable: "chip", oscALevel: 0.65, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.35,
    warpStretch: 0.35, warpTilt: 0.25,
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.55, ampRelease: 0.2,
    chipVoiceLimit: 2, bitDepth: "8bit",
    mono: true
  }),
  preset("fc2-chip-gated-blip", "Gated Blip", "Gate creates rhythmic chip blip patterns", "Chip", {
    oscATable: "chip", oscALevel: 0.68, pulseDuty: 0.25,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1,
    gateOn: true, gateRate: 16, gateDepth: 0.92, gateSmooth: 0.05,
    gatePattern: [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.25,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.2, ampRelease: 0.1,
    chipVoiceLimit: 2, bitDepth: "8bit"
  }),
  preset("fc2-chip-harmony-duo", "Chip Harmony Duo", "Two-voice chip harmony with octave stack", "Chip", {
    oscATable: "chip", oscALevel: 0.55, pulseDuty: 0.5,
    oscBTable: "chip", oscBLevel: 0.5, oscBOctave: 1,
    chipVoiceLimit: 4,
    filterType: "lowpass", filterCutoff: 5800, filterResonance: 0.15,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.55, ampRelease: 0.2,
    bitDepth: "8bit"
  }),
  preset("fc2-chip-bass-drum", "Chip Bass Drum", "8-bit style kick drum with pitch envelope", "Chip", {
    oscATable: "basic", oscALevel: 0.78, oscAOctave: -2,
    noiseLevel: 0.32, chipNoise: "nes",
    pitchEnvAmount: 0.75, pitchEnvTime: 0.1,
    filterType: "lowpass", filterCutoff: 900, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.02, ampRelease: 0.15,
    filtAttack: 0.001, filtDecay: 0.15, filtSustain: 0.05, filtRelease: 0.1,
    bitDepth: "8bit", punch: 0.55
  }),
  preset("fc2-chip-snare-noise", "Chip Snare", "8-bit snare with noise burst character", "Chip", {
    noiseLevel: 0.8, chipNoise: "nes",
    oscATable: "chip", oscALevel: 0.32, pulseDuty: 0.5,
    filterType: "bandpass", filterCutoff: 2800, filterResonance: 0.35,
    ampAttack: 0.001, ampDecay: 0.14, ampSustain: 0.02, ampRelease: 0.1,
    bitDepth: "8bit", chipVoiceLimit: 2
  }),
  preset("fc2-chip-triangle-melody", "Triangle Melody", "Pure triangle wave melody with chip warmth", "Chip", {
    oscATable: "basic", oscALevel: 0.72,
    oscBTable: "basic", oscBLevel: 0.3, oscBOctave: 1,
    chipVoiceLimit: 2,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.15,
    ampAttack: 0.005, ampDecay: 0.32, ampSustain: 0.68, ampRelease: 0.28,
    mono: true
  }),
  preset("fc2-chip-vibrato-lead", "Chip Vibrato Lead", "Chip lead with authentic vibrato character", "Chip", {
    oscATable: "chip", oscALevel: 0.72, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.3, oscBOctave: 1,
    lfo1Wave: "sine", lfo1Rate: 5.8, lfo1Depth: 0.22, lfo1Dest: "pitch",
    filterType: "lowpass", filterCutoff: 5500, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.62, ampRelease: 0.22,
    chipVoiceLimit: 2, bitDepth: "8bit",
    mono: true
  }),
  preset("fc2-chip-lpg-pluck", "Chip LPG Pluck", "LPG shapes chip pluck with organic decay", "Chip", {
    oscATable: "chip", oscALevel: 0.68, pulseDuty: 0.25,
    oscBTable: "basic", oscBLevel: 0.35,
    lpgOn: true, lpgDecay: 0.18, lpgColor: 0.72,
    chipVoiceLimit: 3, bitDepth: "8bit"
  }),
  preset("fc2-chip-boss-battle", "Boss Battle", "Epic chip boss battle lead with drive", "Chip", {
    oscATable: "chip", oscALevel: 0.58, pulseDuty: 0.25,
    oscBTable: "chip", oscBLevel: 0.52, oscBOctave: 1,
    chipVoiceLimit: 4,
    filterType: "lowpass", filterCutoff: 5800, filterResonance: 0.25,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.6, ampRelease: 0.18,
    drive: 0.18, bitDepth: "8bit",
    mono: true
  }),
  preset("fc2-chip-powerup-sweep", "Powerup Sweep", "Classic powerup pitch sweep effect", "Chip", {
    oscATable: "chip", oscALevel: 0.72, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.35, oscBOctave: 1,
    pitchEnvAmount: 0.92, pitchEnvTime: 0.45,
    filterType: "lowpass", filterCutoff: 5800, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.15, ampRelease: 0.3,
    filtAttack: 0.001, filtDecay: 0.35, filtSustain: 0.1, filtRelease: 0.2,
    chipVoiceLimit: 2, bitDepth: "8bit"
  }),
  preset("fc2-chip-death-sound", "Death Sound", "Game over death sound with pitch dive", "Chip", {
    oscATable: "chip", oscALevel: 0.68, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.35,
    noiseLevel: 0.32, chipNoise: "nes",
    pitchEnvAmount: -0.85, pitchEnvTime: 0.55,
    filterType: "lowpass", filterCutoff: 4500, filterEnvAmount: 0.45,
    ampAttack: 0.001, ampDecay: 0.65, ampSustain: 0.08, ampRelease: 0.4,
    chipVoiceLimit: 2, bitDepth: "8bit"
  }),
  preset("fc2-chip-menu-blip", "Menu Blip", "UI menu selection blip sound", "Chip", {
    oscATable: "basic", oscALevel: 0.68, oscAOctave: 1,
    oscBTable: "chip", oscBLevel: 0.35, oscBOctave: 2, pulseDuty: 0.5,
    chipVoiceLimit: 2,
    filterType: "lowpass", filterCutoff: 5500, filterEnvAmount: 0.2,
    ampAttack: 0.001, ampDecay: 0.1, ampSustain: 0.05, ampRelease: 0.08,
    bitDepth: "8bit"
  }),
  preset("fc2-chip-dungeon-pad", "Dungeon Pad", "Dark dungeon atmosphere with chip character", "Chip", {
    oscATable: "chip", oscALevel: 0.45, pulseDuty: 0.5,
    oscBTable: "chip", oscBLevel: 0.4, oscBDetune: 10,
    chipVoiceLimit: 4,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.3,
    ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.85, ampRelease: 1.4,
    reverbMix: 0.35, bitDepth: "12bit"
  }),
  preset("fc2-chip-victory-fanfare", "Victory Fanfare", "Triumphant chip victory celebration", "Chip", {
    oscATable: "chip", oscALevel: 0.55, pulseDuty: 0.5,
    oscBTable: "basic", oscBLevel: 0.45, oscBOctave: 1,
    oscCTable: "chip", oscCLevel: 0.35, oscCOctave: 2,
    chipVoiceLimit: 4,
    filterType: "lowpass", filterCutoff: 5800, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 0.32, ampSustain: 0.5, ampRelease: 0.25,
    bitDepth: "8bit",
    delayMix: 0.15
  }, { enabled: true, mode: "up", bpm: 140, division: "1/16", octaves: 2, gate: 0.7 }),

  // ===== FM V2 (20) =====
  preset("fc2-fm-ops4-ep", "Ops4 Electric Piano", "4-operator FM DX-style electric piano tines", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    fmEngine: "ops4", fmAlg: 1, fmOp1Level: 1, fmOp2Level: 0.62, fmOp3Level: 0.38, fmOp4Level: 0.22,
    fmOp2Ratio: 1, fmOp3Ratio: 3, fmOp4Ratio: 7,
    filterType: "lowpass", filterCutoff: 5200, filterResonance: 0.2,
    ampAttack: 0.002, ampDecay: 1.1, ampSustain: 0.28, ampRelease: 0.62,
    chorusMix: 0.28, chorusDepth: 0.45,
    reverbMix: 0.2
  }),
  preset("fc2-fm-ops4-brass", "Ops4 Brass", "4-operator FM brass ensemble with punch", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    fmEngine: "ops4", fmAlg: 5, fmOp1Level: 1, fmOp2Level: 0.78, fmOp3Level: 0.58, fmOp4Level: 0.38,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 4, fmFeedback: 0.32,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.25, filterEnvAmount: 0.5,
    ampAttack: 0.05, ampDecay: 0.32, ampSustain: 0.72, ampRelease: 0.32,
    filtAttack: 0.02, filtDecay: 0.25, filtSustain: 0.5, filtRelease: 0.2,
    cassetteGen: 0.18, analogComp: 0.28
  }),
  preset("fc2-fm-ops4-bell", "Ops4 Bell Tower", "4-operator FM massive church bell", "FM", {
    oscATable: "bell", oscALevel: 0.6,
    oscBTable: "metallic", oscBLevel: 0.35,
    fmEngine: "ops4", fmAlg: 2, fmOp1Level: 1, fmOp2Level: 0.72, fmOp3Level: 0.52, fmOp4Level: 0.32,
    fmOp2Ratio: 3.5, fmOp3Ratio: 7, fmOp4Ratio: 11,
    filterType: "lowpass", filterCutoff: 6000, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 1.6, ampSustain: 0.12, ampRelease: 1.8,
    reverbMix: 0.5, reverbSize: 5
  }),
  preset("fc2-fm-ops4-bass", "Ops4 Bass Growl", "4-operator FM aggressive growling bass", "FM", {
    oscATable: "basic", oscALevel: 0.75, oscAOctave: -1,
    fmEngine: "ops4", fmAlg: 3, fmOp1Level: 1, fmOp2Level: 0.85, fmOp3Level: 0.55, fmOp4Level: 0.35,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3, fmFeedback: 0.58,
    filterType: "lowpass", filterCutoff: 1600, filterResonance: 0.35, filterDrive: 0.45,
    ampAttack: 0.002, ampDecay: 0.32, ampSustain: 0.55, ampRelease: 0.28,
    drive: 0.28, driveMode: "tube",
    mono: true, punch: 0.42
  }),
  preset("fc2-fm-ops4-pad", "Ops4 Glass Pad", "4-operator FM ethereal glass pad", "FM", {
    oscATable: "basic", oscALevel: 0.48,
    oscBTable: "bell", oscBLevel: 0.38, oscBDetune: 8,
    fmEngine: "ops4", fmAlg: 4, fmOp1Level: 0.82, fmOp2Level: 0.55, fmOp3Level: 0.38, fmOp4Level: 0.22,
    fmOp2Ratio: 2, fmOp3Ratio: 4, fmOp4Ratio: 6,
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.2,
    ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.88, ampRelease: 2.2,
    unison: 3, unisonDetune: 8,
    reverbMix: 0.55, reverbSize: 4.5,
    chorusMix: 0.25
  }),
  preset("fc2-fm-ops4-organ", "Ops4 Organ", "4-operator FM drawbar organ character", "FM", {
    oscATable: "basic", oscALevel: 0.58,
    fmEngine: "ops4", fmAlg: 7, fmOp1Level: 1, fmOp2Level: 0.72, fmOp3Level: 0.52, fmOp4Level: 0.38,
    fmOp2Ratio: 2, fmOp3Ratio: 3, fmOp4Ratio: 4,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.2,
    ampAttack: 0.01, ampDecay: 0.22, ampSustain: 0.88, ampRelease: 0.2,
    chorusMix: 0.25, bbdChorus: 0.15,
    lfo1Rate: 5.5, lfo1Depth: 0.12, lfo1Dest: "filter"
  }),
  preset("fc2-fm-ops4-pluck", "Ops4 Pluck", "4-operator FM mallet pluck percussion", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    fmEngine: "ops4", fmAlg: 2, fmOp1Level: 1, fmOp2Level: 0.68, fmOp3Level: 0.42, fmOp4Level: 0.25,
    fmOp2Ratio: 3, fmOp3Ratio: 5, fmOp4Ratio: 7,
    filterType: "lowpass", filterCutoff: 5200, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.38, ampSustain: 0.05, ampRelease: 0.35,
    filtAttack: 0.001, filtDecay: 0.28, filtSustain: 0.1, filtRelease: 0.22,
    reverbMix: 0.28, reverbSize: 2.5
  }),
  preset("fc2-fm-feedback-growl", "FM Feedback Growl", "High feedback creates aggressive growl", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    oscBTable: "saw", oscBLevel: 0.35,
    fmEngine: "ops4", fmAlg: 0, fmOp1Level: 1, fmOp2Level: 0.75, fmOp3Level: 0.52, fmOp4Level: 0.42,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3, fmFeedback: 0.82,
    filterType: "lowpass", filterCutoff: 2400, filterResonance: 0.4, filterDrive: 0.4,
    ampAttack: 0.005, ampDecay: 0.35, ampSustain: 0.65, ampRelease: 0.3,
    drive: 0.25, driveMode: "tube",
    mono: true
  }),
  preset("fc2-fm-vector-ep", "Vector FM EP", "XY motion modulates FM electric piano timbre", "FM", {
    oscATable: "basic", oscAPos: 0.32, oscALevel: 0.55,
    oscBTable: "bell", oscBPos: 0.65, oscBLevel: 0.5,
    vectorRate: 0.25, vectorDepth: 0.48,
    fmAmount: 0.45, fmRatio: 1,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.22,
    ampAttack: 0.002, ampDecay: 0.95, ampSustain: 0.32, ampRelease: 0.58,
    chorusMix: 0.28
  }),
  preset("fc2-fm-crossmod-metal", "CrossMod Metal", "B-to-A FM creates metallic cross-modulation", "FM", {
    oscATable: "saw", oscALevel: 0.58,
    oscBTable: "basic", oscBLevel: 0.52,
    fmAmount: 0.55, fmRatio: 3, fmBtoA: 0.55,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.3,
    ampAttack: 0.002, ampDecay: 0.42, ampSustain: 0.35, ampRelease: 0.38,
    reverbMix: 0.32, reverbSize: 3
  }),
  preset("fc2-fm-warp-fm", "Warp FM", "Spectral warp adds alien twist to FM tone", "FM", {
    oscATable: "basic", oscALevel: 0.62,
    oscBTable: "bell", oscBLevel: 0.4,
    fmAmount: 0.55, fmRatio: 2.5,
    warpStretch: 0.38, warpTilt: 0.25,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.25,
    ampAttack: 0.003, ampDecay: 0.45, ampSustain: 0.5, ampRelease: 0.4,
    chorusMix: 0.22
  }),
  preset("fc2-fm-ring-fm", "Ring FM Hybrid", "Ring mod combined with FM for complex timbres", "FM", {
    oscATable: "basic", oscALevel: 0.55,
    oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.5, fmRatio: 2, ringAmount: 0.35, ringFreq: 380,
    filterType: "lowpass", filterCutoff: 4800, filterResonance: 0.25,
    ampAttack: 0.003, ampDecay: 0.4, ampSustain: 0.45, ampRelease: 0.38,
    reverbMix: 0.28
  }),
  preset("fc2-fm-lpg-fm", "LPG FM Pluck", "Vactrol gate shapes FM pluck with organic decay", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    oscBTable: "bell", oscBLevel: 0.4,
    fmAmount: 0.55, fmRatio: 3,
    lpgOn: true, lpgDecay: 0.28, lpgColor: 0.72,
    reverbMix: 0.28, reverbSize: 2.5
  }),
  preset("fc2-fm-spectral-fm", "Spectral FM", "FFT processing adds spectral character to FM", "FM", {
    oscATable: "basic", oscALevel: 0.58,
    oscBTable: "bell", oscBLevel: 0.42,
    fmAmount: 0.55, fmRatio: 2.5,
    spectralMode: "smear", spectralAmount: 0.45, spectralMix: 0.45,
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.2,
    ampAttack: 0.003, ampDecay: 0.52, ampSustain: 0.4, ampRelease: 0.65,
    reverbMix: 0.4
  }),
  preset("fc2-fm-ops4-lead", "Ops4 Screamer Lead", "4-operator FM aggressive screaming lead", "FM", {
    oscATable: "basic", oscALevel: 0.72,
    fmEngine: "ops4", fmAlg: 0, fmOp1Level: 1, fmOp2Level: 0.82, fmOp3Level: 0.62, fmOp4Level: 0.42,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3, fmFeedback: 0.48,
    filterType: "lowpass", filterCutoff: 5000, filterResonance: 0.35, filterEnvAmount: 0.5,
    ampAttack: 0.005, ampDecay: 0.28, ampSustain: 0.68, ampRelease: 0.25,
    filtAttack: 0.002, filtDecay: 0.2, filtSustain: 0.4, filtRelease: 0.15,
    drive: 0.22, mono: true
  }),
  preset("fc2-fm-ops4-marimba", "Ops4 Marimba", "4-operator FM authentic marimba bars", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    fmEngine: "ops4", fmAlg: 2, fmOp1Level: 1, fmOp2Level: 0.58, fmOp3Level: 0.38, fmOp4Level: 0.22,
    fmOp2Ratio: 2.5, fmOp3Ratio: 5, fmOp4Ratio: 9,
    filterType: "lowpass", filterCutoff: 4800, filterEnvAmount: 0.35,
    ampAttack: 0.001, ampDecay: 0.48, ampSustain: 0.08, ampRelease: 0.35,
    filtAttack: 0.001, filtDecay: 0.35, filtSustain: 0.1, filtRelease: 0.25,
    reverbMix: 0.25
  }),
  preset("fc2-fm-drift-fm", "Drift FM Vintage", "Unstable vintage FM with analog drift", "FM", {
    oscATable: "basic", oscALevel: 0.62,
    oscBTable: "basic", oscBLevel: 0.48,
    fmAmount: 0.5, fmRatio: 1,
    drift: 0.45, voiceInstability: 0.28, tuneVariance: 0.18,
    filterType: "lowpass", filterCutoff: 3600, filterResonance: 0.25,
    ampAttack: 0.003, ampDecay: 0.95, ampSustain: 0.35, ampRelease: 0.6,
    cassetteGen: 0.25, wowFlutter: 0.1,
    chorusMix: 0.28
  }),
  preset("fc2-fm-modmatrix-fm", "ModMatrix FM", "Modulation matrix animates FM parameters", "FM", {
    oscATable: "basic", oscALevel: 0.62,
    oscBTable: "bell", oscBLevel: 0.45,
    fmAmount: 0.55, fmRatio: 2,
    modMatrix: makeModMatrix([
      MR("lfo1", "fm", 0.45), MR("modenv", "cutoff", 0.52), MR("velocity", "levelA", 0.35),
      MR("keytrack", "resonance", 0.2)
    ]),
    lfo1Rate: 0.55, lfo1Wave: "sine",
    filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.35,
    ampAttack: 0.003, ampDecay: 0.85, ampSustain: 0.4, ampRelease: 0.55,
    chorusMix: 0.22
  }),
  preset("fc2-fm-gated-fm", "Gated FM Stutter", "Gate creates rhythmic FM stutter patterns", "FM", {
    oscATable: "basic", oscALevel: 0.68,
    oscBTable: "bell", oscBLevel: 0.45,
    fmAmount: 0.58, fmRatio: 2.5,
    gateOn: true, gateRate: 8, gateDepth: 0.78, gateSmooth: 0.22,
    gatePattern: [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
    filterType: "lowpass", filterCutoff: 4500, filterResonance: 0.25,
    ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.55, ampRelease: 0.3,
    delayMix: 0.22, delayFeedback: 0.4
  }),
  preset("fc2-fm-ops4-space", "Ops4 Space Gong", "4-operator FM massive reverberant space gong", "FM", {
    oscATable: "bell", oscALevel: 0.55,
    oscBTable: "metallic", oscBLevel: 0.42,
    fmEngine: "ops4", fmAlg: 6, fmOp1Level: 0.92, fmOp2Level: 0.72, fmOp3Level: 0.52, fmOp4Level: 0.38,
    fmOp2Ratio: 1.4, fmOp3Ratio: 2.8, fmOp4Ratio: 5.5,
    filterType: "lowpass", filterCutoff: 4000, filterResonance: 0.2,
    ampAttack: 0.001, ampDecay: 2.2, ampSustain: 0.15, ampRelease: 3.5,
    reverbSize: 6, reverbMix: 0.6,
    stereoWidth: 1.2
  }),
];
