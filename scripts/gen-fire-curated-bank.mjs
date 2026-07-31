/**
 * Generate fireCuratedBank.ts — 20 specially curated presets × 11 categories
 * for the CURRENT Fire Command synth (absolute Q, ladder/svf, ops4, warp, LPG…).
 *
 * Run: node scripts/gen-fire-curated-bank.mjs
 */
import fs from "fs";

const OUT = new URL("../src/audio/dsp/fireCuratedBank.ts", import.meta.url);

function ser(patch, indent = 4) {
  const sp = " ".repeat(indent);
  const lines = Object.entries(patch).map(([k, v]) => {
    if (typeof v === "string") return `${sp}${k}: "${v}",`;
    if (typeof v === "boolean") return `${sp}${k}: ${v},`;
    if (typeof v === "number") return `${sp}${k}: ${Number.isInteger(v) ? v : Math.round(v * 1000) / 1000},`;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "object") return `${sp}${k}: ${JSON.stringify(v)},`;
      return `${sp}${k}: [${v.map((x) => (typeof x === "string" ? `"${x}"` : x)).join(", ")}],`;
    }
    return `${sp}${k}: ${JSON.stringify(v)},`;
  });
  return `{\n${lines.join("\n")}\n${" ".repeat(indent - 2)}}`;
}

function preset(id, name, desc, cat, patch, arp) {
  const arpStr = arp
    ? `, { enabled: ${!!arp.enabled}, mode: "${arp.mode}", bpm: ${arp.bpm}, division: "${arp.division}", octaves: ${arp.octaves}, gate: ${arp.gate} }`
    : "";
  return `  preset("${id}", "${name}", "${desc}", "${cat}", ${ser(patch)}${arpStr}),\n`;
}

/** Shared musical helpers */
const MR = (source, dest, amount) => ({ source, dest, amount });

const bass = [
  ["fc-bass-sub-sine", "Sub Sine Boom", "Pure sine sub with gentle body", {
    oscATable: "basic", oscAPos: 0.05, oscALevel: 0.55, oscAOctave: -1,
    subLevel: 0.55, subWave: "sine", subOctave: -1,
    filterType: "lowpass", filterModel: "biquad", filterCutoff: 320, filterResonance: 1.2,
    filterEnvAmount: 0.25, filtDecay: 0.35, filtSustain: 0.2,
    ampAttack: 0.004, ampDecay: 0.45, ampSustain: 0.55, ampRelease: 0.4,
    punch: 0.35, mono: true, masterGain: 0.68,
  }],
  ["fc-bass-reese", "Reese Detune", "Wide detuned saw reese", {
    oscATable: "saw", oscALevel: 0.62, oscBTable: "saw", oscBLevel: 0.55, oscBDetune: 14, oscBOctave: 0,
    subLevel: 0.28, unison: 3, unisonDetune: 12, unisonWidth: 0.7, unisonPhase: "even",
    filterType: "lowpass", filterModel: "ladder", filterCutoff: 900, filterResonance: 3.2,
    filterDrive: 0.25, filterEnvAmount: 0.4, filtDecay: 0.5,
    ampAttack: 0.02, ampDecay: 0.5, ampSustain: 0.7, ampRelease: 0.35,
    chorusMix: 0.15, mono: true, masterGain: 0.66,
  }],
  ["fc-bass-acid", "Acid Ladder", "303-style resonant ladder squelch", {
    oscATable: "saw", oscALevel: 0.78, pulseDuty: 0.5,
    chipAcidMix: 0.75, filterType: "lowpass", filterModel: "ladder",
    filterCutoff: 480, filterResonance: 11.5, filterEnvAmount: 0.92, filterDrive: 0.4,
    filtAttack: 0.001, filtDecay: 0.28, filtSustain: 0.08, filtRelease: 0.12,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.55, ampRelease: 0.1,
    glide: 0.09, mono: true, drive: 0.22, driveMode: "soft", masterGain: 0.65,
  }],
  ["fc-bass-fm-punch", "FM Punch", "Percussive FM bass hit", {
    oscATable: "harmonic", oscALevel: 0.7, oscBTable: "basic", oscBLevel: 0.4,
    fmAmount: 0.55, fmRatio: 2, fmBtoA: 0.2, subLevel: 0.32,
    filterType: "lowpass", filterModel: "svf", filterCutoff: 1400, filterResonance: 2.4,
    filterEnvAmount: 0.55, filtDecay: 0.18,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.45, ampRelease: 0.18,
    punch: 0.45, mono: true, masterGain: 0.67,
  }],
  ["fc-bass-growl", "Growl Fold", "Folded mid-bass growl", {
    oscATable: "growl", oscAPos: 0.45, oscALevel: 0.72, oscBTable: "fold", oscBLevel: 0.35, oscBDetune: 8,
    filterType: "lowpass", filterModel: "ladder", filterCutoff: 1100, filterResonance: 4.5,
    filterDrive: 0.45, filterEnvAmount: 0.5, drive: 0.4, driveMode: "fold",
    ampAttack: 0.01, ampDecay: 0.4, ampSustain: 0.65, ampRelease: 0.3,
    mono: true, masterGain: 0.64,
  }],
  ["fc-bass-wobble", "Wobble LFO", "Tempo-feel filter wobble bass", {
    oscATable: "saw", oscALevel: 0.7, oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 10,
    subLevel: 0.3, filterType: "lowpass", filterModel: "ladder", filterCutoff: 700,
    filterResonance: 6.5, filterEnvAmount: 0.2,
    lfo1Wave: "sine", lfo1Rate: 4.5, lfo1Depth: 0.7, lfo1Dest: "filter",
    ampAttack: 0.02, ampDecay: 0.35, ampSustain: 0.75, ampRelease: 0.25,
    mono: true, masterGain: 0.66,
  }],
  ["fc-bass-round", "Round Triangle", "Warm triangle bass", {
    oscATable: "basic", oscAPos: 0.35, oscALevel: 0.75, subLevel: 0.4, subWave: "triangle",
    filterCutoff: 1600, filterResonance: 1.8, filterModel: "biquad",
    ampAttack: 0.015, ampDecay: 0.35, ampSustain: 0.8, ampRelease: 0.35,
    chorusMix: 0.12, mono: true, masterGain: 0.7,
  }],
  ["fc-bass-dist-drive", "Tube Drive Bass", "Tube-driven mid bass", {
    oscATable: "saw", oscALevel: 0.68, oscBTable: "pulse", oscBPos: 0.3, oscBLevel: 0.35,
    filterType: "lowpass", filterModel: "svf", filterCutoff: 1800, filterResonance: 3.0,
    filterDrive: 0.35, drive: 0.55, driveMode: "tube", tone: 9000,
    ampAttack: 0.008, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.22,
    mono: true, masterGain: 0.63,
  }],
  ["fc-bass-sync", "Hard Sync Bass", "Hard-synced pulse bass", {
    oscATable: "pulse", oscAPos: 0.25, oscALevel: 0.75, hardSync: true, pulseDuty: 0.22,
    filterType: "lowpass", filterModel: "ladder", filterCutoff: 2200, filterResonance: 4.2,
    filterEnvAmount: 0.45, ampAttack: 0.005, ampDecay: 0.35, ampSustain: 0.6, ampRelease: 0.2,
    mono: true, masterGain: 0.65,
  }],
  ["fc-bass-dub", "Dub Sub Bloom", "Deep dub sub with slow bloom", {
    oscATable: "basic", oscALevel: 0.5, oscAOctave: -1, subLevel: 0.6,
    filterCutoff: 280, filterResonance: 2.0, filterEnvAmount: 0.35, filtDecay: 0.8,
    ampAttack: 0.05, ampDecay: 0.6, ampSustain: 0.7, ampRelease: 0.8,
    delayMix: 0.2, delayFeedback: 0.45, delayTime: 0.375, reverbMix: 0.22,
    mono: true, masterGain: 0.62,
  }],
  ["fc-bass-formant", "Formant Mouth", "Talking formant bass", {
    oscATable: "vocal", oscAPos: 0.4, oscALevel: 0.7, oscAEnv: 0.35,
    filterCarve: "formant", filterCarveAmount: 0.65, filterCutoff: 900, filterResonance: 3.5,
    filterModel: "svf", filterEnvAmount: 0.4, ampAttack: 0.01, ampDecay: 0.4, ampSustain: 0.65, ampRelease: 0.25,
    mono: true, masterGain: 0.66,
  }],
  ["fc-bass-metallic", "Metallic Edge", "Metallic mid-bass stab", {
    oscATable: "metallic", oscAPos: 0.55, oscALevel: 0.7, fmAmount: 0.3, fmRatio: 3,
    filterCutoff: 2400, filterResonance: 5.0, filterModel: "ladder", filterEnvAmount: 0.7, filtDecay: 0.2,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.35, ampRelease: 0.15,
    mono: true, masterGain: 0.65,
  }],
  ["fc-bass-clean", "Clean Finger", "Clean fingered bass", {
    oscATable: "basic", oscAPos: 0.5, oscALevel: 0.72, oscBTable: "basic", oscBLevel: 0.25, oscBOctave: 1,
    filterCutoff: 2800, filterResonance: 1.4, ampAttack: 0.008, ampDecay: 0.3, ampSustain: 0.55, ampRelease: 0.2,
    mono: true, glide: 0.04, masterGain: 0.7,
  }],
  ["fc-bass-neuro", "Neuro Warp", "Warped neuro bass body", {
    oscATable: "fold", oscAPos: 0.6, oscALevel: 0.65, oscBTable: "growl", oscBLevel: 0.4,
    warpMode: "scramble", warpStretch: 0.45, warpTilt: -0.3, warpComb: 0.4, warpAmount: 1,
    filterType: "lowpass", filterModel: "ladder", filterCutoff: 1000, filterResonance: 5.5, filterDrive: 0.4,
    ampAttack: 0.01, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.25, mono: true, masterGain: 0.62,
  }],
  ["fc-bass-808", "808 Boom", "Long 808-style boom", {
    oscATable: "basic", oscAPos: 0.0, oscALevel: 0.7, oscAOctave: -1, subLevel: 0.5,
    pitchEnvAmount: 18, pitchEnvTime: 0.12,
    filterCutoff: 400, filterResonance: 1.5, filterEnvAmount: 0.5, filtDecay: 0.25,
    ampAttack: 0.001, ampDecay: 0.9, ampSustain: 0.15, ampRelease: 0.7,
    punch: 0.5, mono: true, masterGain: 0.68,
  }],
  ["fc-bass-moogish", "Moogish Ladder", "Classic ladder bass", {
    oscATable: "saw", oscALevel: 0.7, oscBTable: "saw", oscBLevel: 0.35, oscBDetune: 6,
    filterModel: "ladder", filterCutoff: 1200, filterResonance: 7.0, filterDrive: 0.3, filterEnvAmount: 0.55,
    filtDecay: 0.4, ampAttack: 0.01, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.3,
    mono: true, masterGain: 0.66,
  }],
  ["fc-bass-pulse", "Narrow Pulse", "Narrow PWM bass", {
    oscATable: "pulse", oscAPos: 0.12, oscALevel: 0.75, pulseDuty: 0.12,
    lfo1Wave: "triangle", lfo1Rate: 0.35, lfo1Depth: 0.4, lfo1Dest: "off",
    oscALfo: 0.35, filterCutoff: 1500, filterResonance: 3.2, filterModel: "svf",
    ampAttack: 0.005, ampDecay: 0.35, ampSustain: 0.65, ampRelease: 0.22, mono: true, masterGain: 0.67,
  }],
  ["fc-bass-slap", "Slap Attack", "Bright slap bass", {
    oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.7, noiseLevel: 0.08, noiseMode: "burst",
    filterCutoff: 4200, filterResonance: 2.5, filterEnvAmount: 0.75, filtDecay: 0.12,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.25, ampRelease: 0.15,
    punch: 0.4, mono: true, masterGain: 0.68,
  }],
  ["fc-bass-dark", "Dark Floor", "Dark low-passed floor bass", {
    oscATable: "saw", oscALevel: 0.65, oscBTable: "basic", oscBLevel: 0.4, oscBOctave: -1,
    subLevel: 0.35, filterCutoff: 550, filterResonance: 4.0, filterModel: "ladder", filterDrive: 0.2,
    ampAttack: 0.03, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 0.45, mono: true, masterGain: 0.65,
  }],
  ["fc-bass-ops", "Ops4 Sub", "4-op FM sub bass", {
    oscATable: "bell", oscALevel: 0.55, fmEngine: "ops4", fmAlg: 2,
    fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3, fmFeedback: 0.25,
    fmOp2Level: 0.7, fmOp3Level: 0.35, fmOp4Level: 0.2, fmAmount: 0.4,
    filterCutoff: 900, filterResonance: 2.2, subLevel: 0.3,
    ampAttack: 0.005, ampDecay: 0.35, ampSustain: 0.6, ampRelease: 0.25, mono: true, masterGain: 0.64,
  }],
];

const lead = [
  ["fc-lead-saw-edge", "Saw Edge Blade", "Bright mono saw with sharp edge", {
    oscATable: "saw", oscALevel: 0.75, filterModel: "ladder", filterCutoff: 4200, filterResonance: 5.5,
    filterEnvAmount: 0.55, filtDecay: 0.25, ampAttack: 0.01, ampDecay: 0.25, ampSustain: 0.7, ampRelease: 0.2,
    drive: 0.2, driveMode: "soft", mono: true, masterGain: 0.68,
  }],
  ["fc-lead-silk", "Soft Silk", "Gentle soft-attack lead", {
    oscATable: "basic", oscALevel: 0.7, filterCutoff: 2400, filterResonance: 2.0,
    ampAttack: 0.12, ampDecay: 0.4, ampSustain: 0.8, ampRelease: 0.5, chorusMix: 0.25, mono: true, masterGain: 0.7,
  }],
  ["fc-lead-supersaw", "Supersaw Horizon", "Wide unison supersaw", {
    oscATable: "saw", oscALevel: 0.55, oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 8,
    unison: 7, unisonDetune: 18, unisonWidth: 0.9, unisonPhase: "even", unisonDistribution: "gaussian",
    filterCutoff: 3800, filterResonance: 2.2, ampAttack: 0.03, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.35,
    chorusMix: 0.2, masterGain: 0.6,
  }],
  ["fc-lead-acid-scream", "Acid Scream", "Screaming resonant acid lead", {
    oscATable: "saw", oscALevel: 0.78, filterModel: "ladder", filterCutoff: 700, filterResonance: 13,
    filterEnvAmount: 0.95, filtDecay: 0.22, filtSustain: 0.05, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.5, ampRelease: 0.12,
    glide: 0.07, chipAcidMix: 0.6, mono: true, masterGain: 0.62,
  }],
  ["fc-lead-pulse-talk", "Pulse Talker", "PWM talkbox lead", {
    oscATable: "pulse", oscAPos: 0.2, oscALevel: 0.72, pulseDuty: 0.2, oscALfo: 0.45,
    lfo1Wave: "sine", lfo1Rate: 4.2, lfo1Depth: 0.5, lfo1Dest: "filter",
    filterCutoff: 2600, filterResonance: 4.0, ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.65, ampRelease: 0.2,
    mono: true, masterGain: 0.68,
  }],
  ["fc-lead-fm-bell", "FM Bell Pierce", "Metallic FM bell lead", {
    oscATable: "bell", oscALevel: 0.72, oscBTable: "basic", oscBLevel: 0.4, fmAmount: 0.65, fmRatio: 3.5,
    filterCutoff: 5500, filterResonance: 2.5, ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.3, ampRelease: 0.4,
    delayMix: 0.22, mono: true, masterGain: 0.66,
  }],
  ["fc-lead-porta", "Portamento Snake", "Gliding snake lead", {
    oscATable: "saw", oscALevel: 0.7, oscBTable: "pulse", oscBLevel: 0.3, oscBPos: 0.35,
    filterCutoff: 2800, filterResonance: 3.5, ampAttack: 0.04, ampDecay: 0.35, ampSustain: 0.8, ampRelease: 0.3,
    glide: 0.28, mono: true, masterGain: 0.68,
  }],
  ["fc-lead-trance", "Trance Gate", "Gated trance lead", {
    oscATable: "saw", oscALevel: 0.65, unison: 5, unisonDetune: 14, unisonWidth: 0.8,
    filterCutoff: 5000, filterResonance: 2.8, ampAttack: 0.005, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.15,
    delayTime: 0.375, delayMix: 0.25, gateOn: true, gateRate: 8, gateDepth: 0.75, masterGain: 0.62,
  }],
  ["fc-lead-nasal", "Vintage Nasal", "Bandpass nasal lead", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.7, filterType: "bandpass", filterCutoff: 1400, filterResonance: 6.5,
    ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.25, cassetteGen: 0.35, wowFlutter: 0.12, mono: true, masterGain: 0.66,
  }],
  ["fc-lead-chip", "Chip Square", "Retro square lead", {
    oscATable: "chip", oscALevel: 0.78, pulseDuty: 0.5, hardSync: false,
    filterCutoff: 7000, filterResonance: 1.5, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.55, ampRelease: 0.1,
    mono: true, masterGain: 0.7,
  }],
  ["fc-lead-harmony", "Harmony Stack", "Octave-stack lead bloom", {
    oscATable: "saw", oscALevel: 0.5, oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 7, oscCTable: "saw", oscCLevel: 0.35, oscCOctave: 1,
    filterCutoff: 3200, filterResonance: 2.5, ampAttack: 0.05, ampDecay: 0.4, ampSustain: 0.85, ampRelease: 0.55,
    chorusMix: 0.28, reverbMix: 0.2, masterGain: 0.6,
  }],
  ["fc-lead-grit", "Drive Grit", "Tube grit mid lead", {
    oscATable: "saw", oscALevel: 0.72, filterCutoff: 2200, filterResonance: 3.8, filterModel: "ladder",
    drive: 0.55, driveMode: "tube", ampAttack: 0.01, ampDecay: 0.28, ampSustain: 0.7, ampRelease: 0.22,
    mono: true, masterGain: 0.64,
  }],
  ["fc-lead-air", "Air Whistle", "High airy whistle", {
    oscATable: "basic", oscALevel: 0.6, oscAOctave: 1, filterType: "highpass", filterCutoff: 1800, filterResonance: 2.5,
    ampAttack: 0.06, ampDecay: 0.35, ampSustain: 0.75, ampRelease: 0.45, airHigh: 0.45, airAmount: 0.55,
    reverbMix: 0.28, mono: true, masterGain: 0.66,
  }],
  ["fc-lead-ring", "Ring Spark", "Ring-mod spark lead", {
    oscATable: "saw", oscALevel: 0.68, ringAmount: 0.4, ringFreq: 660, filterCutoff: 4000, filterResonance: 3.0,
    ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.6, ampRelease: 0.2, mono: true, masterGain: 0.66,
  }],
  ["fc-lead-wobble", "LFO Wobble", "Filter wobble mono lead", {
    oscATable: "saw", oscALevel: 0.7, filterCutoff: 1600, filterResonance: 6.0, filterModel: "ladder",
    lfo1Wave: "sine", lfo1Rate: 5.5, lfo1Depth: 0.6, lfo1Dest: "filter",
    ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.25, mono: true, masterGain: 0.66,
  }],
  ["fc-lead-pluck-hook", "Plucky Hook", "Short hooky lead pluck", {
    oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.72, filterCutoff: 3400, filterResonance: 4.5, filterEnvAmount: 0.7, filtDecay: 0.14,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.12, ampRelease: 0.12, delayMix: 0.18, mono: true, masterGain: 0.68,
  }],
  ["fc-lead-warm", "Warm Analog", "Detuned warm analog lead", {
    oscATable: "saw", oscALevel: 0.65, oscBTable: "saw", oscBLevel: 0.48, oscBDetune: 9,
    filterCutoff: 2100, filterResonance: 3.0, filterModel: "ladder", ampAttack: 0.04, ampDecay: 0.4, ampSustain: 0.8, ampRelease: 0.4,
    chorusMix: 0.2, drift: 0.2, mono: true, masterGain: 0.67,
  }],
  ["fc-lead-phase", "Phase Sweep", "Phaser-swept lead", {
    oscATable: "saw", oscALevel: 0.68, filterCutoff: 4000, filterResonance: 2.5,
    phaserRate: 0.35, phaserDepth: 0.75, phaserMix: 0.5, phaserFeedback: 0.4,
    ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.3, mono: true, masterGain: 0.66,
  }],
  ["fc-lead-oct", "Octave Scream", "Dual-octave scream", {
    oscATable: "saw", oscALevel: 0.55, oscBTable: "saw", oscBLevel: 0.5, oscBOctave: 1,
    filterCutoff: 4500, filterResonance: 4.5, drive: 0.3, ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.7, ampRelease: 0.2,
    mono: true, masterGain: 0.64,
  }],
  ["fc-lead-echo", "Delay Echo", "Sparse echo lead", {
    oscATable: "saw", oscALevel: 0.62, filterCutoff: 3000, filterResonance: 2.8,
    ampAttack: 0.02, ampDecay: 0.35, ampSustain: 0.5, ampRelease: 0.45,
    delayTime: 0.45, delayFeedback: 0.55, delayMix: 0.4, reverbMix: 0.2, mono: true, masterGain: 0.65,
  }],
];

const pluck = [
  ["fc-pluck-nylon", "Nylon Snap", "Soft nylon finger pluck", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.68, lpgOn: true, lpgDecay: 0.35, lpgColor: 0.55,
    filterCutoff: 2200, filterResonance: 2.5, filterEnvAmount: 0.5, filtDecay: 0.12,
    ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.08, ampRelease: 0.18, reverbMix: 0.15, masterGain: 0.7,
  }],
  ["fc-pluck-steel", "Steel Twang", "Bright steel twang", {
    oscATable: "saw", oscALevel: 0.7, filterCutoff: 4800, filterResonance: 3.5, filterEnvAmount: 0.75, filtDecay: 0.1,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.05, ampRelease: 0.14, masterGain: 0.7,
  }],
  ["fc-pluck-kalimba", "Kalimba Tine", "Metallic kalimba tine", {
    oscATable: "bell", oscALevel: 0.68, oscBTable: "basic", oscBLevel: 0.25, fmAmount: 0.3, fmRatio: 4,
    filterCutoff: 5200, filterResonance: 2.2, ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.05, ampRelease: 0.35,
    reverbMix: 0.28, masterGain: 0.68,
  }],
  ["fc-pluck-harp", "Harp Gliss", "Airy harp gliss", {
    oscATable: "basic", oscALevel: 0.62, filterCutoff: 3600, filterResonance: 1.8,
    ampAttack: 0.002, ampDecay: 0.5, ampSustain: 0.1, ampRelease: 0.65, chorusMix: 0.22, reverbMix: 0.35, masterGain: 0.68,
  }],
  ["fc-pluck-funk", "Muted Funk", "Muted funk pluck", {
    oscATable: "pulse", oscAPos: 0.18, oscALevel: 0.72, filterCutoff: 1600, filterResonance: 3.2,
    ampAttack: 0.001, ampDecay: 0.1, ampSustain: 0.02, ampRelease: 0.08, punch: 0.35, masterGain: 0.7,
  }],
  ["fc-pluck-glass", "Glass Tap", "Glass crystalline tap", {
    oscATable: "bell", oscALevel: 0.65, filterType: "highpass", filterCutoff: 1200, filterResonance: 2.5,
    ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.05, ampRelease: 0.4, delayMix: 0.2, reverbMix: 0.3, masterGain: 0.68,
  }],
  ["fc-pluck-bass", "Bass Thump", "Low thumpy bass pluck", {
    oscATable: "basic", oscALevel: 0.75, oscAOctave: -1, subLevel: 0.35, filterCutoff: 900, filterResonance: 2.8,
    ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.1, ampRelease: 0.18, punch: 0.45, mono: true, masterGain: 0.68,
  }],
  ["fc-pluck-chip", "Chip Blip", "8-bit chip blip", {
    oscATable: "chip", oscALevel: 0.72, pulseDuty: 0.25, filterCutoff: 5500, filterResonance: 1.5,
    ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.04, ampRelease: 0.08, masterGain: 0.72,
  }],
  ["fc-pluck-bloom", "Bloom Tail", "Pluck into pad bloom", {
    oscATable: "saw", oscALevel: 0.58, filterCutoff: 2800, filterResonance: 2.5,
    ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.35, ampRelease: 0.95, reverbMix: 0.4, chorusMix: 0.25, masterGain: 0.65,
  }],
  ["fc-pluck-zap", "Resonant Zap", "Resonant filter zap", {
    oscATable: "saw", oscALevel: 0.68, filterCutoff: 700, filterResonance: 10, filterEnvAmount: 0.95, filtDecay: 0.16,
    filterModel: "ladder", ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.05, ampRelease: 0.12, masterGain: 0.64,
  }],
  ["fc-pluck-marimba", "Marimba Wood", "Wooden marimba bar", {
    oscATable: "basic", oscALevel: 0.68, oscBTable: "bell", oscBLevel: 0.28, filterCutoff: 3200, filterResonance: 2.0,
    ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.05, ampRelease: 0.25, reverbMix: 0.2, masterGain: 0.7,
  }],
  ["fc-pluck-delay", "Delay Dots", "Sparse delay-dot plucks", {
    oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.62, filterCutoff: 3000, filterResonance: 2.5,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.05, ampRelease: 0.14,
    delayTime: 0.333, delayFeedback: 0.48, delayMix: 0.42, masterGain: 0.66,
  }],
  ["fc-pluck-harmonic", "Harmonic Ping", "High harmonic ping", {
    oscATable: "harmonic", oscAPos: 0.65, oscALevel: 0.62, filterCutoff: 5500, filterResonance: 2.2,
    ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.08, ampRelease: 0.5, airHigh: 0.35, airAmount: 0.4, masterGain: 0.68,
  }],
  ["fc-pluck-vinyl", "Vinyl Scratch", "Lo-fi vinyl pluck", {
    oscATable: "pulse", oscAPos: 0.3, oscALevel: 0.68, noiseLevel: 0.12, filterCutoff: 2000, filterResonance: 2.5,
    ampAttack: 0.001, ampDecay: 0.16, ampSustain: 0.05, ampRelease: 0.12, cassetteGen: 0.45, hiss: 0.12, masterGain: 0.66,
  }],
  ["fc-pluck-formant", "Formant Pluck", "Vowel formant pluck", {
    oscATable: "vocal", oscAPos: 0.4, oscALevel: 0.68, filterCarve: "formant", filterCarveAmount: 0.6,
    filterCutoff: 2400, filterResonance: 3.5, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.08, ampRelease: 0.2, masterGain: 0.68,
  }],
  ["fc-pluck-chorus", "Wide Chorus", "Stereo chorus pluck", {
    oscATable: "saw", oscALevel: 0.6, unison: 3, unisonDetune: 12, unisonWidth: 0.85,
    filterCutoff: 3400, filterResonance: 2.2, ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.1, ampRelease: 0.25,
    chorusMix: 0.45, masterGain: 0.65,
  }],
  ["fc-pluck-lpg", "LPG Strike", "West-coast LPG strike", {
    oscATable: "basic", oscALevel: 0.7, lpgOn: true, lpgModel: "bright", lpgDecay: 0.28, lpgColor: 0.75, lpgStrike: 1,
    filterCutoff: 3000, filterResonance: 2.0, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.05, ampRelease: 0.15, masterGain: 0.7,
  }],
  ["fc-pluck-odds", "Odd Harmonics", "Odd-harmonic carve pluck", {
    oscATable: "saw", oscALevel: 0.65, filterCarve: "odds", filterCarveAmount: 0.7, filterCutoff: 2800, filterResonance: 3.0,
    ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.08, ampRelease: 0.22, masterGain: 0.68,
  }],
  ["fc-pluck-sync", "Sync Pluck", "Hard-sync pluck zap", {
    oscATable: "pulse", oscALevel: 0.7, hardSync: true, pulseDuty: 0.3, filterCutoff: 3600, filterResonance: 4.0,
    filterEnvAmount: 0.6, filtDecay: 0.12, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.05, ampRelease: 0.12, masterGain: 0.68,
  }],
  ["fc-pluck-ep", "EP Key", "Electric piano-ish pluck", {
    oscATable: "bell", oscAPos: 0.3, oscALevel: 0.6, oscBTable: "basic", oscBLevel: 0.35, fmAmount: 0.2,
    filterCutoff: 4000, filterResonance: 1.8, ampAttack: 0.002, ampDecay: 0.55, ampSustain: 0.15, ampRelease: 0.4,
    chorusMix: 0.2, reverbMix: 0.18, masterGain: 0.68,
  }],
];

function padRow(id, name, desc, over) {
  return [id, name, desc, {
    ampAttack: 0.4, ampDecay: 0.8, ampSustain: 0.85, ampRelease: 1.4,
    filterCutoff: 2800, filterResonance: 1.8, chorusMix: 0.3, reverbMix: 0.35, ...over,
  }];
}

const pad = [
  padRow("fc-pad-hyperspace", "Hyperspace", "Lush hyperspace pad", {
    oscATable: "saw", oscALevel: 0.5, oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 10,
    unison: 5, unisonDetune: 14, unisonWidth: 0.85, filterCutoff: 3200, filterResonance: 2.2, reverbMix: 0.4, chorusMix: 0.3,
  }),
  padRow("fc-pad-cloud", "Soft Cloud", "Soft cloudy wash", {
    oscATable: "basic", oscALevel: 0.55, oscBTable: "harmonic", oscBLevel: 0.35, filterCutoff: 2200, filterResonance: 1.4,
    ampAttack: 0.8, reverbSize: 4.5, reverbMix: 0.45,
  }),
  padRow("fc-pad-swarm", "Swarm Unison", "Detuned swarm pad", {
    oscATable: "saw", oscALevel: 0.45, unison: 7, unisonDetune: 22, unisonWidth: 0.95, unisonPhase: "random",
    filterCutoff: 2600, filterResonance: 2.0, drift: 0.25,
  }),
  padRow("fc-pad-vocal", "Vocal Air", "Vocal formant air pad", {
    oscATable: "vocal", oscAPos: 0.45, oscALevel: 0.55, oscAEnv: 0.25, filterCarve: "formant", filterCarveAmount: 0.45,
    filterCutoff: 2400, filterResonance: 2.5, airAmount: 0.4, airHigh: 0.3,
  }),
  padRow("fc-pad-dark", "Dark Drone", "Dark low drone pad", {
    oscATable: "saw", oscALevel: 0.5, oscAOctave: -1, oscBTable: "basic", oscBLevel: 0.35, filterCutoff: 900,
    filterResonance: 3.0, filterModel: "ladder", ampAttack: 1.0, reverbMix: 0.4,
  }),
  padRow("fc-pad-shimmer", "Shimmer High", "High shimmer pad", {
    oscATable: "bell", oscALevel: 0.45, oscBTable: "harmonic", oscBLevel: 0.4, oscBOctave: 1,
    filterCutoff: 5000, filterResonance: 1.6, airHigh: 0.5, airAmount: 0.5, reverbMix: 0.45,
  }),
  padRow("fc-pad-analog", "Analog Warmth", "Warm analog pad", {
    oscATable: "saw", oscALevel: 0.5, oscBTable: "saw", oscBLevel: 0.42, oscBDetune: 8,
    filterModel: "ladder", filterCutoff: 2000, filterResonance: 2.8, chorusMix: 0.35, drift: 0.3, cassetteGen: 0.15,
  }),
  padRow("fc-pad-phase", "Phased Silk", "Phaser silk pad", {
    oscATable: "saw", oscALevel: 0.52, phaserMix: 0.45, phaserRate: 0.15, phaserDepth: 0.7, filterCutoff: 3000,
  }),
  padRow("fc-pad-glass", "Glass Room", "Glass room pad", {
    oscATable: "bell", oscALevel: 0.48, oscBTable: "basic", oscBLevel: 0.35, filterType: "highpass", filterCutoff: 600,
    reverbMix: 0.5, reverbSize: 5, delayMix: 0.15,
  }),
  padRow("fc-pad-pwm", "PWM Drift", "Slow PWM pad", {
    oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.55, oscALfo: 0.5, pulseDuty: 0.35,
    lfo1Rate: 0.2, lfo1Depth: 0.4, filterCutoff: 2500, filterResonance: 2.0,
  }),
  padRow("fc-pad-fm", "FM Atmosphere", "Soft FM atmosphere", {
    oscATable: "bell", oscALevel: 0.5, fmAmount: 0.35, fmRatio: 1.5, filterCutoff: 2800, reverbMix: 0.4,
  }),
  padRow("fc-pad-wide", "Stereo Wide", "Extra-wide stereo pad", {
    oscATable: "saw", oscALevel: 0.45, unison: 5, unisonDetune: 16, unisonWidth: 1, stereoWidth: 1.35, chorusMix: 0.4,
  }),
  padRow("fc-pad-tape", "Tape Wash", "Tape-washed pad", {
    oscATable: "saw", oscALevel: 0.5, cassetteGen: 0.4, wowFlutter: 0.2, vhsColor: 0.2, ageMacro: 0.35, filterCutoff: 2200,
  }),
  padRow("fc-pad-notch", "Notch Hollow", "Hollow notch pad", {
    oscATable: "saw", oscALevel: 0.52, filterType: "notch", filterCutoff: 1200, filterResonance: 4.0, reverbMix: 0.38,
  }),
  padRow("fc-pad-swarm-lfo", "Breathing Swarm", "Breathing filter swarm", {
    oscATable: "saw", oscALevel: 0.48, unison: 5, unisonDetune: 15, lfo1Rate: 0.12, lfo1Depth: 0.45, lfo1Dest: "filter",
    filterCutoff: 2000, filterResonance: 2.5,
  }),
  padRow("fc-pad-additive", "Organ Mist", "Additive organ mist", {
    oscATable: "additive", oscAPos: 0.4, oscALevel: 0.55, oscBTable: "harmonic", oscBLevel: 0.3, chorusMix: 0.35, reverbMix: 0.4,
  }),
  padRow("fc-pad-subharmonic", "Subharmonic Bed", "Subharmonic warp bed", {
    oscATable: "saw", oscALevel: 0.5, warpMode: "subharmonic", warpStretch: 0.4, warpAmount: 0.8, filterCutoff: 1800, reverbMix: 0.4,
  }),
  padRow("fc-pad-ice", "Ice Sheet", "Cold ice sheet pad", {
    oscATable: "metallic", oscALevel: 0.45, oscBTable: "bell", oscBLevel: 0.35, filterType: "highpass",
    filterCutoff: 800, reverbMix: 0.48, airHigh: 0.4, airAmount: 0.45,
  }),
  padRow("fc-pad-motion", "Motion Matrix", "Mod-matrix moving pad", {
    oscATable: "saw", oscALevel: 0.5, oscAPos: 0.4, oscAEnv: 0.3, modMatrix: [MR("lfo1", "wtA", 0.4), MR("lfo2", "cutoff", 0.35)],
    lfo1Rate: 0.15, lfo1Depth: 0.5, lfo2Rate: 0.08, lfo2Depth: 0.4, filterCutoff: 2600, reverbMix: 0.35,
  }),
  padRow("fc-pad-cathedral", "Cathedral", "Huge cathedral pad", {
    oscATable: "saw", oscALevel: 0.45, oscBTable: "harmonic", oscBLevel: 0.35, unison: 3, unisonDetune: 10,
    reverbMix: 0.55, reverbSize: 6, reverbDiffusion: 0.85, delayMix: 0.2, filterCutoff: 3000,
  }),
];

const keys = [
  ["fc-keys-ep", "Electric Piano", "Classic EP tine", {
    oscATable: "bell", oscAPos: 0.25, oscALevel: 0.6, oscBTable: "basic", oscBLevel: 0.4, fmAmount: 0.25, fmRatio: 2,
    filterCutoff: 4500, filterResonance: 1.6, ampAttack: 0.002, ampDecay: 0.7, ampSustain: 0.35, ampRelease: 0.5,
    chorusMix: 0.25, reverbMix: 0.15, masterGain: 0.7,
  }],
  ["fc-keys-organ", "Drawbar Organ", "Additive organ keys", {
    oscATable: "additive", oscAPos: 0.35, oscALevel: 0.65, oscBTable: "harmonic", oscBLevel: 0.3,
    filterCutoff: 5000, filterResonance: 1.2, ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.9, ampRelease: 0.15,
    chorusMix: 0.2, masterGain: 0.68,
  }],
  ["fc-keys-clav", "Clav Snap", "Clavinet snap", {
    oscATable: "pulse", oscAPos: 0.15, oscALevel: 0.72, filterCutoff: 3500, filterResonance: 3.5, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.2, ampRelease: 0.12, drive: 0.2, masterGain: 0.7,
  }],
  ["fc-keys-piano", "Soft Piano", "Soft piano-like keys", {
    oscATable: "basic", oscAPos: 0.55, oscALevel: 0.65, oscBTable: "bell", oscBLevel: 0.25,
    filterCutoff: 4000, filterResonance: 1.5, filterEnvAmount: 0.3, filtDecay: 0.4,
    ampAttack: 0.002, ampDecay: 0.8, ampSustain: 0.25, ampRelease: 0.6, reverbMix: 0.2, masterGain: 0.7,
  }],
  ["fc-keys-bell", "Bell Keys", "Bright bell keys", {
    oscATable: "bell", oscALevel: 0.68, fmAmount: 0.4, fmRatio: 3, filterCutoff: 6000, filterResonance: 2.0,
    ampAttack: 0.001, ampDecay: 0.9, ampSustain: 0.1, ampRelease: 0.7, reverbMix: 0.3, masterGain: 0.68,
  }],
  ["fc-keys-rhodes-dark", "Dark Rhodes", "Dark Rhodes EP", {
    oscATable: "bell", oscAPos: 0.4, oscALevel: 0.58, oscBTable: "basic", oscBLevel: 0.4, fmAmount: 0.2,
    filterCutoff: 2200, filterResonance: 2.2, ampAttack: 0.005, ampDecay: 0.9, ampSustain: 0.4, ampRelease: 0.55,
    chorusMix: 0.3, cassetteGen: 0.15, masterGain: 0.68,
  }],
  ["fc-keys-harpsi", "Harpsichord", "Harpsichord pluck keys", {
    oscATable: "pulse", oscAPos: 0.45, oscALevel: 0.7, filterCutoff: 5000, filterResonance: 2.0, filterEnvAmount: 0.55, filtDecay: 0.15,
    ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.1, ampRelease: 0.2, masterGain: 0.7,
  }],
  ["fc-keys-wurli", "Wurli Bark", "Barky Wurlitzer", {
    oscATable: "pulse", oscAPos: 0.3, oscALevel: 0.65, oscBTable: "basic", oscBLevel: 0.3, drive: 0.35, driveMode: "tube",
    filterCutoff: 2800, filterResonance: 2.8, ampAttack: 0.003, ampDecay: 0.6, ampSustain: 0.3, ampRelease: 0.4, masterGain: 0.66,
  }],
  ["fc-keys-glass", "Glass Keys", "Glass mallet keys", {
    oscATable: "metallic", oscALevel: 0.6, oscBTable: "bell", oscBLevel: 0.3, filterCutoff: 5500, filterResonance: 2.0,
    ampAttack: 0.001, ampDecay: 0.7, ampSustain: 0.15, ampRelease: 0.55, reverbMix: 0.35, masterGain: 0.68,
  }],
  ["fc-keys-padkeys", "Pad Keys", "Sustaining pad keys", {
    oscATable: "saw", oscALevel: 0.55, oscBTable: "harmonic", oscBLevel: 0.35, filterCutoff: 3000, filterResonance: 2.0,
    ampAttack: 0.08, ampDecay: 0.4, ampSustain: 0.85, ampRelease: 0.8, chorusMix: 0.25, reverbMix: 0.25, masterGain: 0.66,
  }],
  ["fc-keys-fm", "FM Keys", "Classic FM electric keys", {
    oscATable: "bell", oscALevel: 0.62, fmEngine: "ops4", fmAlg: 4, fmOp2Ratio: 14, fmOp3Ratio: 1, fmOp4Ratio: 1,
    fmOp2Level: 0.55, fmFeedback: 0.15, fmAmount: 0.45, filterCutoff: 5000,
    ampAttack: 0.002, ampDecay: 0.6, ampSustain: 0.3, ampRelease: 0.45, masterGain: 0.66,
  }],
  ["fc-keys-choir", "Choir Keys", "Choir-like keys", {
    oscATable: "vocal", oscAPos: 0.5, oscALevel: 0.55, oscBTable: "formant2", oscBLevel: 0.35, filterCarve: "formant", filterCarveAmount: 0.5,
    filterCutoff: 2600, ampAttack: 0.15, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 0.7, reverbMix: 0.35, masterGain: 0.65,
  }],
  ["fc-keys-bright", "Bright Stab", "Bright key stab", {
    oscATable: "saw", oscALevel: 0.65, unison: 3, unisonDetune: 10, filterCutoff: 5500, filterResonance: 2.5, filterEnvAmount: 0.45, filtDecay: 0.2,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.4, ampRelease: 0.2, masterGain: 0.66,
  }],
  ["fc-keys-muted", "Muted Keys", "Muted soft keys", {
    oscATable: "basic", oscALevel: 0.65, filterCutoff: 1400, filterResonance: 1.8, ampAttack: 0.01, ampDecay: 0.4, ampSustain: 0.5, ampRelease: 0.35, masterGain: 0.7,
  }],
  ["fc-keys-trem", "Tremolo Keys", "Tremolo EP keys", {
    oscATable: "bell", oscALevel: 0.6, lfo1Wave: "sine", lfo1Rate: 5, lfo1Depth: 0.45, lfo1Dest: "volume",
    filterCutoff: 3500, ampAttack: 0.005, ampDecay: 0.7, ampSustain: 0.5, ampRelease: 0.45, chorusMix: 0.15, masterGain: 0.68,
  }],
  ["fc-keys-honky", "Honky Detune", "Honky-tonk detuned keys", {
    oscATable: "basic", oscALevel: 0.55, oscBTable: "basic", oscBLevel: 0.5, oscBDetune: 18, filterCutoff: 4000,
    ampAttack: 0.002, ampDecay: 0.55, ampSustain: 0.3, ampRelease: 0.4, masterGain: 0.68,
  }],
  ["fc-keys-crystal", "Crystal", "Crystal key sparkle", {
    oscATable: "metallic", oscAPos: 0.7, oscALevel: 0.55, oscBTable: "bell", oscBLevel: 0.4, fmAmount: 0.3,
    filterCutoff: 7000, ampAttack: 0.001, ampDecay: 1.0, ampSustain: 0.1, ampRelease: 0.8, reverbMix: 0.4, delayMix: 0.15, masterGain: 0.66,
  }],
  ["fc-keys-saw", "Saw Keys", "Simple saw keys", {
    oscATable: "saw", oscALevel: 0.68, filterCutoff: 3200, filterResonance: 2.2, filterEnvAmount: 0.35, filtDecay: 0.35,
    ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.55, ampRelease: 0.35, masterGain: 0.7,
  }],
  ["fc-keys-wide", "Wide Board", "Wide stereo keys", {
    oscATable: "saw", oscALevel: 0.5, oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 12, unison: 3, unisonDetune: 8, unisonWidth: 0.85,
    filterCutoff: 3600, ampAttack: 0.01, ampDecay: 0.5, ampSustain: 0.6, ampRelease: 0.45, chorusMix: 0.3, masterGain: 0.64,
  }],
  ["fc-keys-vintage", "Vintage Keys", "Aged vintage keys", {
    oscATable: "bell", oscALevel: 0.58, cassetteGen: 0.35, wowFlutter: 0.15, hiss: 0.06, filterCutoff: 2800,
    ampAttack: 0.008, ampDecay: 0.65, ampSustain: 0.4, ampRelease: 0.5, chorusMix: 0.2, masterGain: 0.66,
  }],
];

const arp = [
  ["fc-arp-classic", "Classic Up", "Classic up arp pluck", {
    oscATable: "saw", oscALevel: 0.68, filterCutoff: 3800, filterResonance: 3.5, filterEnvAmount: 0.55, filtDecay: 0.15,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.15, ampRelease: 0.12, delayMix: 0.2, masterGain: 0.68,
  }, { enabled: true, mode: "up", bpm: 128, division: "1/16", octaves: 2, gate: 0.55 }],
  ["fc-arp-down", "Cascade Down", "Descending cascade", {
    oscATable: "pulse", oscAPos: 0.3, oscALevel: 0.65, filterCutoff: 3200, filterResonance: 4.0, filterEnvAmount: 0.5, filtDecay: 0.12,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.1, ampRelease: 0.1, masterGain: 0.68,
  }, { enabled: true, mode: "down", bpm: 120, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-arp-updown", "Up-Down Mirror", "Up-down mirror arp", {
    oscATable: "saw", oscALevel: 0.62, unison: 3, unisonDetune: 10, filterCutoff: 4000, filterResonance: 2.8,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.2, ampRelease: 0.12, chorusMix: 0.15, masterGain: 0.65,
  }, { enabled: true, mode: "updown", bpm: 132, division: "1/16", octaves: 3, gate: 0.6 }],
  ["fc-arp-acid", "Acid Arp", "Resonant acid arp", {
    oscATable: "saw", oscALevel: 0.72, filterModel: "ladder", filterCutoff: 800, filterResonance: 10, filterEnvAmount: 0.85, filtDecay: 0.18,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.2, ampRelease: 0.1, mono: true, masterGain: 0.64,
  }, { enabled: true, mode: "up", bpm: 135, division: "1/16", octaves: 1, gate: 0.45 }],
  ["fc-arp-chip", "Chip Arp", "Chippy square arp", {
    oscATable: "chip", oscALevel: 0.72, pulseDuty: 0.5, filterCutoff: 6000, ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.1, ampRelease: 0.08, masterGain: 0.7,
  }, { enabled: true, mode: "updown", bpm: 140, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-arp-pluck", "Pluck Arp", "Plucky arp sequence", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.65, lpgOn: true, lpgDecay: 0.25, filterCutoff: 3000, filterResonance: 2.5,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.08, ampRelease: 0.1, reverbMix: 0.15, masterGain: 0.68,
  }, { enabled: true, mode: "up", bpm: 118, division: "1/16", octaves: 2, gate: 0.4 }],
  ["fc-arp-trance", "Trance Run", "Trance running arp", {
    oscATable: "saw", oscALevel: 0.6, unison: 5, unisonDetune: 12, filterCutoff: 4800, filterResonance: 2.5,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.25, ampRelease: 0.1, delayMix: 0.28, delayTime: 0.375, masterGain: 0.62,
  }, { enabled: true, mode: "up", bpm: 138, division: "1/16", octaves: 3, gate: 0.55 }],
  ["fc-arp-random", "Random Sparks", "Random spark arp", {
    oscATable: "metallic", oscALevel: 0.62, filterCutoff: 4500, filterResonance: 3.0, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.1, ampRelease: 0.12,
    delayMix: 0.25, masterGain: 0.66,
  }, { enabled: true, mode: "random", bpm: 125, division: "1/16", octaves: 2, gate: 0.45 }],
  ["fc-arp-bell", "Bell Arp", "Bell tone arp", {
    oscATable: "bell", oscALevel: 0.65, fmAmount: 0.3, filterCutoff: 5000, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.1, ampRelease: 0.25,
    reverbMix: 0.3, masterGain: 0.66,
  }, { enabled: true, mode: "updown", bpm: 110, division: "1/8", octaves: 2, gate: 0.6 }],
  ["fc-arp-soft", "Soft Steps", "Soft stepped arp", {
    oscATable: "basic", oscALevel: 0.6, filterCutoff: 2400, filterResonance: 2.0, ampAttack: 0.02, ampDecay: 0.25, ampSustain: 0.3, ampRelease: 0.2,
    chorusMix: 0.2, reverbMix: 0.2, masterGain: 0.68,
  }, { enabled: true, mode: "up", bpm: 100, division: "1/8", octaves: 2, gate: 0.7 }],
  ["fc-arp-gate", "Gated Run", "Trance-gated arp run", {
    oscATable: "saw", oscALevel: 0.62, filterCutoff: 4200, gateOn: true, gateRate: 16, gateDepth: 0.85,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.5, ampRelease: 0.15, masterGain: 0.64,
  }, { enabled: true, mode: "up", bpm: 128, division: "1/16", octaves: 2, gate: 0.8 }],
  ["fc-arp-oct", "Octave Hop", "Octave-hopping arp", {
    oscATable: "saw", oscALevel: 0.55, oscBTable: "saw", oscBLevel: 0.45, oscBOctave: 1, filterCutoff: 3600, filterResonance: 3.0,
    ampAttack: 0.001, ampDecay: 0.16, ampSustain: 0.15, ampRelease: 0.1, masterGain: 0.65,
  }, { enabled: true, mode: "updown", bpm: 130, division: "1/16", octaves: 3, gate: 0.5 }],
  ["fc-arp-pwm", "PWM Arp", "PWM moving arp", {
    oscATable: "pulse", oscAPos: 0.25, oscALevel: 0.65, oscALfo: 0.4, pulseDuty: 0.25, filterCutoff: 3000, filterResonance: 3.5,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.15, ampRelease: 0.1, masterGain: 0.68,
  }, { enabled: true, mode: "up", bpm: 122, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-arp-dub", "Dub Echo Arp", "Dub delay arp", {
    oscATable: "saw", oscALevel: 0.58, filterCutoff: 2000, filterResonance: 4.0, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.1, ampRelease: 0.15,
    delayTime: 0.5, delayFeedback: 0.55, delayMix: 0.4, reverbMix: 0.25, masterGain: 0.62,
  }, { enabled: true, mode: "down", bpm: 95, division: "1/8", octaves: 2, gate: 0.45 }],
  ["fc-arp-metallic", "Metallic Run", "Metallic arp run", {
    oscATable: "metallic", oscALevel: 0.62, filterCutoff: 4500, filterResonance: 3.5, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.12, ampRelease: 0.12, masterGain: 0.66,
  }, { enabled: true, mode: "up", bpm: 128, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-arp-minor", "Minor Drive", "Driving minor arp", {
    oscATable: "saw", oscALevel: 0.65, filterModel: "ladder", filterCutoff: 2800, filterResonance: 5.0, filterEnvAmount: 0.4,
    ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.2, ampRelease: 0.1, drive: 0.2, masterGain: 0.66,
  }, { enabled: true, mode: "up", bpm: 126, division: "1/16", octaves: 2, gate: 0.55 }],
  ["fc-arp-glass", "Glass Arp", "Glass arp sparkle", {
    oscATable: "bell", oscALevel: 0.6, filterType: "highpass", filterCutoff: 1000, ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.08, ampRelease: 0.25,
    reverbMix: 0.35, delayMix: 0.2, masterGain: 0.66,
  }, { enabled: true, mode: "updown", bpm: 112, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-arp-sync", "Sync Arp", "Hard-sync arp", {
    oscATable: "pulse", oscALevel: 0.68, hardSync: true, pulseDuty: 0.3, filterCutoff: 3400, filterResonance: 4.0,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.12, ampRelease: 0.1, masterGain: 0.66,
  }, { enabled: true, mode: "up", bpm: 130, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-arp-warm", "Warm Steps", "Warm analog arp", {
    oscATable: "saw", oscALevel: 0.6, oscBTable: "saw", oscBLevel: 0.35, oscBDetune: 8, filterModel: "ladder", filterCutoff: 2200, filterResonance: 3.5,
    ampAttack: 0.005, ampDecay: 0.22, ampSustain: 0.25, ampRelease: 0.15, drift: 0.15, masterGain: 0.66,
  }, { enabled: true, mode: "updown", bpm: 116, division: "1/16", octaves: 2, gate: 0.55 }],
  ["fc-arp-stutter", "Stutter Gate", "Stutter-gated arp", {
    oscATable: "saw", oscALevel: 0.62, filterCutoff: 3600, gateOn: true, gateRate: 32, gateDepth: 1, gateSmooth: 0.1,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.4, ampRelease: 0.1, masterGain: 0.64,
  }, { enabled: true, mode: "random", bpm: 128, division: "1/16", octaves: 2, gate: 0.7 }],
];

const fx = [
  ["fc-fx-riser", "Noise Riser", "Noise riser sweep", {
    oscATable: "saw", oscALevel: 0.3, noiseLevel: 0.45, noiseMode: "storm", noiseColor: 0.4,
    filterType: "highpass", filterCutoff: 800, filterResonance: 3.0, filterEnvAmount: 0.8, filtAttack: 1.5, filtDecay: 0.5,
    ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 0.8, reverbMix: 0.4, masterGain: 0.6,
  }],
  ["fc-fx-impact", "Impact Boom", "Cinematic impact", {
    oscATable: "basic", oscALevel: 0.5, oscAOctave: -2, noiseLevel: 0.35, noiseMode: "burst",
    pitchEnvAmount: 24, pitchEnvTime: 0.2, filterCutoff: 600, filterResonance: 2.5, filterEnvAmount: 0.7, filtDecay: 0.3,
    ampAttack: 0.001, ampDecay: 0.8, ampSustain: 0.1, ampRelease: 1.0, punch: 0.6, reverbMix: 0.35, masterGain: 0.62,
  }],
  ["fc-fx-glitch", "Glitch Scramble", "Scrambled glitch texture", {
    oscATable: "fold", oscALevel: 0.55, warpMode: "scramble", warpStretch: 0.7, warpTilt: 0.5, warpComb: 0.6, warpAmount: 1,
    crush: 0.35, bitDepth: "8bit", filterCutoff: 4000, filterResonance: 4.0, ampAttack: 0.01, ampDecay: 0.3, ampSustain: 0.5, ampRelease: 0.3, masterGain: 0.6,
  }],
  ["fc-fx-laser", "Laser Zap", "Sci-fi laser zap", {
    oscATable: "saw", oscALevel: 0.7, pitchEnvAmount: -36, pitchEnvTime: 0.25, filterCutoff: 5000, filterResonance: 6.0, filterEnvAmount: 0.6,
    ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.1, ampRelease: 0.2, delayMix: 0.2, masterGain: 0.65,
  }],
  ["fc-fx-drone", "Alien Drone", "Alien drone bed", {
    oscATable: "metallic", oscALevel: 0.45, oscBTable: "growl", oscBLevel: 0.4, ringAmount: 0.3, ringFreq: 80,
    filterType: "bandpass", filterCutoff: 600, filterResonance: 5.0, ampAttack: 1.0, ampSustain: 0.9, ampRelease: 1.5,
    reverbMix: 0.45, masterGain: 0.58,
  }],
  ["fc-fx-whoosh", "Whoosh Sweep", "Filter whoosh", {
    oscATable: "saw", oscALevel: 0.5, noiseLevel: 0.25, filterType: "bandpass", filterCutoff: 400, filterResonance: 4.0,
    filterEnvAmount: 0.9, filtAttack: 0.01, filtDecay: 0.8, ampAttack: 0.01, ampDecay: 0.7, ampSustain: 0.2, ampRelease: 0.5, masterGain: 0.62,
  }],
  ["fc-fx-brick", "Brickwall Warp", "Brickwall spectral warp", {
    oscATable: "saw", oscALevel: 0.55, warpMode: "brickwall", warpTilt: 0.6, warpStretch: -0.4, warpAmount: 1,
    filterCutoff: 3000, filterResonance: 3.0, ampAttack: 0.05, ampSustain: 0.8, ampRelease: 0.5, masterGain: 0.62,
  }],
  ["fc-fx-ring", "Ring Chaos", "Chaotic ring mod", {
    oscATable: "saw", oscALevel: 0.55, ringAmount: 0.7, ringFreq: 140, filterCutoff: 3500, filterResonance: 3.5,
    ampAttack: 0.02, ampSustain: 0.7, ampRelease: 0.4, delayMix: 0.25, masterGain: 0.6,
  }],
  ["fc-fx-freeze", "Spectral Freeze", "Frozen spectral smear", {
    oscATable: "harmonic", oscALevel: 0.5, spectralMode: "smear", spectralMix: 0.4, spectralAmount: 0.7,
    filterCutoff: 2500, reverbMix: 0.4, ampAttack: 0.3, ampSustain: 0.85, ampRelease: 1.2, masterGain: 0.58,
  }],
  ["fc-fx-drop", "Bass Drop FX", "Drop warning FX", {
    oscATable: "saw", oscALevel: 0.6, pitchEnvAmount: -20, pitchEnvTime: 1.2, filterCutoff: 2000, filterResonance: 5.0,
    filterEnvAmount: -0.5, ampAttack: 0.05, ampDecay: 1.0, ampSustain: 0.3, ampRelease: 0.5, masterGain: 0.6,
  }],
  ["fc-fx-static", "Radio Static", "Radio static wash", {
    noiseLevel: 0.5, noiseMode: "storm", noiseColor: 0.2, oscALevel: 0.15, crush: 0.4, sampleRateReduce: 0.3,
    filterType: "bandpass", filterCutoff: 2000, filterResonance: 2.0, ampAttack: 0.1, ampSustain: 0.8, ampRelease: 0.5,
    hiss: 0.15, masterGain: 0.55,
  }],
  ["fc-fx-formant", "Vowel Morph", "Moving vowel morph", {
    oscATable: "vocal", oscAPos: 0.3, oscALevel: 0.6, oscALfo: 0.5, filterCarve: "formant", filterCarveAmount: 0.75,
    lfo1Rate: 0.4, lfo1Depth: 0.5, filterCutoff: 1500, filterResonance: 4.0, ampAttack: 0.1, ampSustain: 0.8, ampRelease: 0.6, masterGain: 0.62,
  }],
  ["fc-fx-sub-drop", "Sub Drop", "Long sub drop", {
    oscATable: "basic", oscALevel: 0.7, oscAOctave: -2, pitchEnvAmount: -28, pitchEnvTime: 1.5,
    filterCutoff: 200, filterResonance: 1.5, ampAttack: 0.01, ampDecay: 1.5, ampSustain: 0.2, ampRelease: 0.8, mono: true, masterGain: 0.65,
  }],
  ["fc-fx-impulse", "Click Impulse", "Short click impulse", {
    oscATable: "basic", oscALevel: 0.4, noiseLevel: 0.5, noiseMode: "burst", filterCutoff: 8000, filterResonance: 1.5,
    ampAttack: 0.001, ampDecay: 0.05, ampSustain: 0, ampRelease: 0.05, punch: 0.5, masterGain: 0.7,
  }],
  ["fc-fx-phaser", "Phaser Sweep FX", "Huge phaser sweep", {
    oscATable: "saw", oscALevel: 0.55, phaserMix: 0.7, phaserRate: 0.08, phaserDepth: 0.9, phaserStages: 8, phaserFeedback: 0.55,
    filterCutoff: 4000, ampAttack: 0.2, ampSustain: 0.85, ampRelease: 1.0, reverbMix: 0.3, masterGain: 0.6,
  }],
  ["fc-fx-bitcrush", "Bitcrush Rain", "Bitcrushed rain", {
    oscATable: "saw", oscALevel: 0.4, noiseLevel: 0.35, crush: 0.5, bitDepth: "8bit", sampleRateReduce: 0.45,
    filterCutoff: 5000, ampAttack: 0.15, ampSustain: 0.75, ampRelease: 0.6, masterGain: 0.55,
  }],
  ["fc-fx-reverse", "Reverse Bloom", "Reverse-feeling bloom", {
    oscATable: "harmonic", oscALevel: 0.55, ampAttack: 1.2, ampDecay: 0.2, ampSustain: 0.3, ampRelease: 0.1,
    filterCutoff: 3000, reverbMix: 0.5, delayMix: 0.3, delayFeedback: 0.5, masterGain: 0.6,
  }],
  ["fc-fx-alarm", "Alarm Pulse", "Alarm pulse FX", {
    oscATable: "pulse", oscALevel: 0.7, pulseDuty: 0.5, lfo1Wave: "square", lfo1Rate: 6, lfo1Depth: 0.8, lfo1Dest: "pitch",
    filterCutoff: 4000, filterResonance: 3.0, ampAttack: 0.01, ampSustain: 0.8, ampRelease: 0.2, masterGain: 0.62,
  }],
  ["fc-fx-ocean", "Ocean Wash", "Ocean noise wash", {
    noiseLevel: 0.55, noiseColor: -0.4, noiseMode: "bed", noiseDensity: 0.7, oscALevel: 0.1,
    filterType: "lowpass", filterCutoff: 1200, filterResonance: 1.5, lfo1Rate: 0.1, lfo1Depth: 0.4, lfo1Dest: "filter",
    ampAttack: 1.5, ampSustain: 0.9, ampRelease: 2.0, reverbMix: 0.45, masterGain: 0.55,
  }],
  ["fc-fx-stutter", "Stutter Break", "Stutter break FX", {
    oscATable: "saw", oscALevel: 0.6, gateOn: true, gateRate: 32, gateDepth: 1, crush: 0.25,
    filterCutoff: 3500, ampAttack: 0.001, ampSustain: 0.7, ampRelease: 0.2, masterGain: 0.62,
  }],
];

const atmos = [
  ["fc-atmos-void", "Deep Void", "Deep space void", {
    oscATable: "harmonic", oscALevel: 0.4, oscBTable: "metallic", oscBLevel: 0.3, noiseLevel: 0.15, noiseColor: -0.5,
    filterCutoff: 800, filterResonance: 2.0, ampAttack: 2.0, ampSustain: 0.9, ampRelease: 3.0,
    reverbMix: 0.55, reverbSize: 7, delayMix: 0.2, masterGain: 0.55,
  }],
  ["fc-atmos-wind", "Alien Wind", "Alien wind bed", {
    noiseLevel: 0.4, noiseMode: "bed", noiseColor: 0.3, oscATable: "saw", oscALevel: 0.25,
    filterType: "bandpass", filterCutoff: 900, filterResonance: 3.5, lfo1Rate: 0.07, lfo1Depth: 0.5, lfo1Dest: "filter",
    ampAttack: 1.5, ampSustain: 0.85, ampRelease: 2.5, reverbMix: 0.5, masterGain: 0.55,
  }],
  ["fc-atmos-choir", "Ghost Choir", "Ghost choir atmosphere", {
    oscATable: "vocal", oscAPos: 0.45, oscALevel: 0.45, oscBTable: "formant2", oscBLevel: 0.35, filterCarve: "formant", filterCarveAmount: 0.55,
    unison: 5, unisonDetune: 18, filterCutoff: 2200, ampAttack: 1.2, ampSustain: 0.85, ampRelease: 2.0, reverbMix: 0.5, masterGain: 0.55,
  }],
  ["fc-atmos-crystal", "Crystal Cave", "Crystal cave ambience", {
    oscATable: "bell", oscALevel: 0.4, oscBTable: "metallic", oscBLevel: 0.35, fmAmount: 0.25,
    filterCutoff: 4500, ampAttack: 0.8, ampSustain: 0.8, ampRelease: 2.5, reverbMix: 0.55, delayMix: 0.25, delayFeedback: 0.5, masterGain: 0.55,
  }],
  ["fc-atmos-pulse", "Slow Pulse", "Slow pulsing atmos", {
    oscATable: "saw", oscALevel: 0.45, lfo1Rate: 0.15, lfo1Depth: 0.6, lfo1Dest: "volume", filterCutoff: 1800,
    ampAttack: 1.0, ampSustain: 0.9, ampRelease: 2.0, reverbMix: 0.45, masterGain: 0.58,
  }],
  ["fc-atmos-metallic", "Metal Rain", "Metallic rain atmos", {
    oscATable: "metallic", oscALevel: 0.4, noiseLevel: 0.2, filterType: "highpass", filterCutoff: 1500,
    ampAttack: 0.5, ampSustain: 0.8, ampRelease: 1.5, reverbMix: 0.5, delayMix: 0.3, masterGain: 0.55,
  }],
  ["fc-atmos-sub", "Sub Pressure", "Infrasonic pressure bed", {
    oscATable: "basic", oscALevel: 0.5, oscAOctave: -2, subLevel: 0.4, filterCutoff: 200, filterResonance: 1.5,
    ampAttack: 2.0, ampSustain: 0.95, ampRelease: 3.0, masterGain: 0.6,
  }],
  ["fc-atmos-smear", "Spectral Smear", "Smeared spectral fog", {
    oscATable: "harmonic", oscALevel: 0.45, spectralMode: "smear", spectralMix: 0.45, spectralAmount: 0.75,
    filterCutoff: 2000, ampAttack: 1.5, ampSustain: 0.85, ampRelease: 2.5, reverbMix: 0.4, masterGain: 0.55,
  }],
  ["fc-atmos-warm", "Warm Blanket", "Warm blanket pad atmos", {
    oscATable: "saw", oscALevel: 0.45, oscBTable: "basic", oscBLevel: 0.35, filterModel: "ladder", filterCutoff: 1400, filterResonance: 2.0,
    ampAttack: 1.5, ampSustain: 0.9, ampRelease: 2.5, chorusMix: 0.3, reverbMix: 0.4, cassetteGen: 0.2, masterGain: 0.58,
  }],
  ["fc-atmos-ice", "Ice Field", "Frozen ice field", {
    oscATable: "metallic", oscALevel: 0.4, oscBTable: "bell", oscBLevel: 0.3, filterType: "highpass", filterCutoff: 2000,
    ampAttack: 1.0, ampSustain: 0.8, ampRelease: 2.0, airHigh: 0.5, airAmount: 0.5, reverbMix: 0.55, masterGain: 0.55,
  }],
  ["fc-atmos-modular", "Modular Drift", "Modular-style drift", {
    oscATable: "saw", oscALevel: 0.4, oscBTable: "pulse", oscBLevel: 0.3, drift: 0.4, voiceInstability: 0.2,
    warpMode: "classic", warpTilt: 0.3, filterCutoff: 1600, ampAttack: 1.2, ampSustain: 0.85, ampRelease: 2.0, reverbMix: 0.4, masterGain: 0.58,
  }],
  ["fc-atmos-hum", "Machine Hum", "Machine room hum", {
    oscATable: "basic", oscALevel: 0.35, oscAOctave: -1, hum: 0.12, noiseLevel: 0.15, filterCutoff: 600, filterResonance: 2.5,
    ampAttack: 1.0, ampSustain: 0.95, ampRelease: 2.0, masterGain: 0.55,
  }],
  ["fc-atmos-shimmer", "Shimmer Tail", "Endless shimmer tail", {
    oscATable: "bell", oscALevel: 0.4, oscBTable: "harmonic", oscBLevel: 0.35, oscBOctave: 1,
    ampAttack: 0.8, ampSustain: 0.8, ampRelease: 3.0, reverbMix: 0.6, reverbSize: 7, delayMix: 0.25, masterGain: 0.55,
  }],
  ["fc-atmos-dark", "Dark Matter", "Dark matter bed", {
    oscATable: "growl", oscALevel: 0.4, oscBTable: "saw", oscBLevel: 0.3, oscBOctave: -1, filterCutoff: 700, filterResonance: 3.5,
    filterModel: "ladder", ampAttack: 2.0, ampSustain: 0.9, ampRelease: 3.0, reverbMix: 0.45, masterGain: 0.55,
  }],
  ["fc-atmos-phase", "Phase Fog", "Phasing fog", {
    oscATable: "saw", oscALevel: 0.45, phaserMix: 0.6, phaserRate: 0.05, phaserDepth: 0.8, phaserStages: 8,
    ampAttack: 1.0, ampSustain: 0.85, ampRelease: 2.0, reverbMix: 0.4, masterGain: 0.58,
  }],
  ["fc-atmos-granular", "Grain Cloud", "Grain-like noise cloud", {
    noiseLevel: 0.4, noiseGrain: 0.7, noiseDensity: 0.35, noiseMode: "storm", oscATable: "harmonic", oscALevel: 0.3,
    filterCutoff: 2500, ampAttack: 1.0, ampSustain: 0.85, ampRelease: 2.0, reverbMix: 0.5, masterGain: 0.55,
  }],
  ["fc-atmos-organ", "Distant Organ", "Distant organ wash", {
    oscATable: "additive", oscALevel: 0.45, oscBTable: "harmonic", oscBLevel: 0.3, filterCutoff: 2000,
    ampAttack: 1.5, ampSustain: 0.9, ampRelease: 2.5, reverbMix: 0.55, chorusMix: 0.25, masterGain: 0.58,
  }],
  ["fc-atmos-ring", "Ring Horizon", "Ring-mod horizon", {
    oscATable: "saw", oscALevel: 0.4, ringAmount: 0.45, ringFreq: 55, filterCutoff: 1800, filterResonance: 2.5,
    ampAttack: 1.2, ampSustain: 0.85, ampRelease: 2.0, reverbMix: 0.45, masterGain: 0.55,
  }],
  ["fc-atmos-motion", "Living Motion", "Living modulating atmos", {
    oscATable: "saw", oscALevel: 0.42, oscAPos: 0.4, oscAEnv: 0.4, modMatrix: [MR("lfo1", "wtA", 0.5), MR("lfo2", "pan", 0.4), MR("modenv", "cutoff", 0.35)],
    lfo1Rate: 0.1, lfo2Rate: 0.07, filterCutoff: 2000, ampAttack: 1.0, ampSustain: 0.9, ampRelease: 2.0, reverbMix: 0.4, masterGain: 0.58,
  }],
  ["fc-atmos-cathedral", "Night Cathedral", "Night cathedral space", {
    oscATable: "harmonic", oscALevel: 0.4, oscBTable: "vocal", oscBLevel: 0.3, unison: 3, unisonDetune: 12,
    ampAttack: 1.5, ampSustain: 0.85, ampRelease: 3.0, reverbMix: 0.6, reverbSize: 8, reverbDiffusion: 0.9, masterGain: 0.55,
  }],
];

const vintage = [
  ["fc-vin-tape", "Tape Saturate", "Warm tape saturation", {
    oscATable: "saw", oscALevel: 0.6, oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 8, cassetteGen: 0.55, tapeSpeed: -0.1,
    wowFlutter: 0.25, printThrough: 0.1, filterCutoff: 2400, filterResonance: 2.5, drive: 0.3, driveMode: "tube",
    ampAttack: 0.02, ampSustain: 0.75, ampRelease: 0.4, masterGain: 0.64,
  }],
  ["fc-vin-vinyl", "Vinyl Dust", "Dusty vinyl keys", {
    oscATable: "bell", oscALevel: 0.55, dust: 0.12, hiss: 0.1, cassetteGen: 0.3, filterCutoff: 2800,
    ampAttack: 0.005, ampDecay: 0.6, ampSustain: 0.4, ampRelease: 0.5, chorusMix: 0.2, masterGain: 0.64,
  }],
  ["fc-vin-vhs", "VHS Color", "VHS colored lead", {
    oscATable: "saw", oscALevel: 0.62, vhsColor: 0.45, cassetteGen: 0.35, wowFlutter: 0.2, sampleRateReduce: 0.15,
    filterCutoff: 3000, filterResonance: 3.0, ampAttack: 0.02, ampSustain: 0.7, ampRelease: 0.35, mono: true, masterGain: 0.64,
  }],
  ["fc-vin-radio", "AM Radio", "AM radio midrange", {
    oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.6, filterType: "bandpass", filterCutoff: 1400, filterResonance: 3.5,
    crush: 0.25, hiss: 0.12, hum: 0.08, ampAttack: 0.01, ampSustain: 0.75, ampRelease: 0.3, masterGain: 0.62,
  }],
  ["fc-vin-cassette", "Cassette Deck", "Cassette deck warmth", {
    oscATable: "saw", oscALevel: 0.58, oscBTable: "basic", oscBLevel: 0.35, cassetteGen: 0.6, ageMacro: 0.5, wowFlutter: 0.3,
    filterCutoff: 2200, chorusMix: 0.15, ampAttack: 0.03, ampSustain: 0.8, ampRelease: 0.45, masterGain: 0.64,
  }],
  ["fc-vin-analog", "Analog Drift", "Drifting analog voice", {
    oscATable: "saw", oscALevel: 0.6, oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 10, drift: 0.4, tuneVariance: 0.15,
    filterModel: "ladder", filterCutoff: 2000, filterResonance: 4.0, ampAttack: 0.02, ampSustain: 0.75, ampRelease: 0.4, masterGain: 0.64,
  }],
  ["fc-vin-lofi", "Lo-Fi Bed", "Lo-fi chord bed", {
    oscATable: "saw", oscALevel: 0.5, unison: 3, unisonDetune: 12, crush: 0.3, bitDepth: "12bit", cassetteGen: 0.4,
    filterCutoff: 1800, ampAttack: 0.15, ampSustain: 0.85, ampRelease: 0.8, reverbMix: 0.3, masterGain: 0.6,
  }],
  ["fc-vin-organ", "Farfisa Dust", "Dusty combo organ", {
    oscATable: "additive", oscALevel: 0.6, oscBTable: "harmonic", oscBLevel: 0.3, cassetteGen: 0.35, hiss: 0.08,
    filterCutoff: 3500, ampAttack: 0.01, ampSustain: 0.9, ampRelease: 0.2, chorusMix: 0.2, masterGain: 0.66,
  }],
  ["fc-vin-chorus", "Dimension Chorus", "Vintage dimension chorus", {
    oscATable: "saw", oscALevel: 0.55, oscBTable: "saw", oscBLevel: 0.4, oscBDetune: 7,
    chorusModel: "dimension", chorusMix: 0.5, chorusDepth: 0.5, filterCutoff: 2800,
    ampAttack: 0.04, ampSustain: 0.8, ampRelease: 0.5, masterGain: 0.64,
  }],
  ["fc-vin-string", "String Machine", "Vintage string machine", {
    oscATable: "saw", oscALevel: 0.5, oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 9, unison: 3, unisonDetune: 8,
    filterCutoff: 2600, filterResonance: 2.0, ampAttack: 0.3, ampSustain: 0.85, ampRelease: 0.9, chorusMix: 0.4, reverbMix: 0.25, masterGain: 0.62,
  }],
  ["fc-vin-ep", "Worn EP", "Worn electric piano", {
    oscATable: "bell", oscALevel: 0.55, oscBTable: "basic", oscBLevel: 0.35, fmAmount: 0.2, cassetteGen: 0.3, dust: 0.08,
    filterCutoff: 3000, ampAttack: 0.003, ampDecay: 0.7, ampSustain: 0.35, ampRelease: 0.5, chorusMix: 0.25, masterGain: 0.66,
  }],
  ["fc-vin-bass", "Vintage Bass", "Warm vintage bass", {
    oscATable: "saw", oscALevel: 0.68, subLevel: 0.3, filterModel: "ladder", filterCutoff: 1000, filterResonance: 4.5,
    cassetteGen: 0.25, drive: 0.25, driveMode: "tube", ampAttack: 0.01, ampSustain: 0.7, ampRelease: 0.3, mono: true, masterGain: 0.64,
  }],
  ["fc-vin-lead", "Retro Lead", "Retro mono lead", {
    oscATable: "saw", oscALevel: 0.7, filterModel: "ladder", filterCutoff: 2800, filterResonance: 5.0, filterEnvAmount: 0.45,
    cassetteGen: 0.2, ampAttack: 0.01, ampSustain: 0.7, ampRelease: 0.25, mono: true, glide: 0.08, masterGain: 0.66,
  }],
  ["fc-vin-pad", "Worn Pad", "Worn tape pad", {
    oscATable: "saw", oscALevel: 0.48, oscBTable: "harmonic", oscBLevel: 0.35, cassetteGen: 0.45, wowFlutter: 0.25, ageMacro: 0.4,
    ampAttack: 0.5, ampSustain: 0.85, ampRelease: 1.2, chorusMix: 0.3, reverbMix: 0.35, filterCutoff: 2200, masterGain: 0.6,
  }],
  ["fc-vin-bbd", "BBD Chorus", "BBD chorus voice", {
    oscATable: "saw", oscALevel: 0.58, bbdChorus: 0.55, chorusMix: 0.2, filterCutoff: 2600, filterResonance: 2.5,
    ampAttack: 0.03, ampSustain: 0.75, ampRelease: 0.4, masterGain: 0.64,
  }],
  ["fc-vin-comp", "Analog Comp", "Analog-compressed keys", {
    oscATable: "basic", oscALevel: 0.6, oscBTable: "bell", oscBLevel: 0.3, analogComp: 0.45, punch: 0.3,
    filterCutoff: 3200, ampAttack: 0.005, ampDecay: 0.5, ampSustain: 0.5, ampRelease: 0.4, masterGain: 0.66,
  }],
  ["fc-vin-flutter", "Flutter Lead", "Heavy flutter lead", {
    oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.65, wowFlutter: 0.5, tapeSpeed: 0.15, cassetteGen: 0.4,
    filterCutoff: 3000, ampAttack: 0.02, ampSustain: 0.7, ampRelease: 0.3, mono: true, masterGain: 0.64,
  }],
  ["fc-vin-phone", "Phone Line", "Phone-line bandpass", {
    oscATable: "basic", oscALevel: 0.65, filterType: "bandpass", filterCutoff: 1200, filterResonance: 2.5,
    crush: 0.2, hiss: 0.1, ampAttack: 0.01, ampSustain: 0.8, ampRelease: 0.25, masterGain: 0.64,
  }],
  ["fc-vin-age", "Age Macro", "Age-macro wash", {
    oscATable: "saw", oscALevel: 0.55, ageMacro: 0.7, ageEvolve: 0.35, cassetteGen: 0.3, vhsColor: 0.25,
    filterCutoff: 2000, ampAttack: 0.2, ampSustain: 0.85, ampRelease: 0.8, reverbMix: 0.3, masterGain: 0.6,
  }],
  ["fc-vin-synth", "70s Synth", "70s polysynth voice", {
    oscATable: "saw", oscALevel: 0.55, oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 10, filterModel: "ladder",
    filterCutoff: 2400, filterResonance: 3.5, filterEnvAmount: 0.4, filtDecay: 0.5,
    ampAttack: 0.05, ampDecay: 0.4, ampSustain: 0.7, ampRelease: 0.5, chorusMix: 0.25, masterGain: 0.64,
  }],
];

const chip = [
  ["fc-chip-square", "NES Square", "NES-style square", {
    oscATable: "chip", oscALevel: 0.78, pulseDuty: 0.5, chipNoise: "nes", filterCutoff: 8000, filterResonance: 1.2,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.5, ampRelease: 0.08, mono: true, masterGain: 0.72,
  }],
  ["fc-chip-pulse25", "Pulse 25%", "25% duty pulse", {
    oscATable: "pulse", oscALevel: 0.75, pulseDuty: 0.25, filterCutoff: 7000, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.45, ampRelease: 0.1, mono: true, masterGain: 0.72,
  }],
  ["fc-chip-pulse125", "Pulse 12%", "12.5% duty pulse", {
    oscATable: "pulse", oscALevel: 0.75, pulseDuty: 0.125, filterCutoff: 6500, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.4, ampRelease: 0.1, mono: true, masterGain: 0.72,
  }],
  ["fc-chip-triangle", "GB Triangle", "Game Boy triangle", {
    oscATable: "basic", oscAPos: 0.35, oscALevel: 0.75, chipNoise: "gb", filterCutoff: 5000,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.55, ampRelease: 0.12, mono: true, masterGain: 0.72,
  }],
  ["fc-chip-noise", "Noise Drum", "Chip noise hit", {
    oscALevel: 0.2, noiseLevel: 0.7, noiseMode: "burst", chipNoise: "nes", filterCutoff: 4000, filterResonance: 1.5,
    ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.05, ampRelease: 0.08, masterGain: 0.7,
  }],
  ["fc-chip-lead", "Chip Lead", "Bright chip lead", {
    oscATable: "chip", oscALevel: 0.72, hardSync: true, pulseDuty: 0.5, filterCutoff: 6000, filterResonance: 2.0,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.55, ampRelease: 0.12, mono: true, masterGain: 0.7,
  }],
  ["fc-chip-bass", "Chip Bass", "Square chip bass", {
    oscATable: "pulse", oscALevel: 0.75, pulseDuty: 0.5, oscAOctave: -1, filterCutoff: 3000, filterResonance: 2.0,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.6, ampRelease: 0.1, mono: true, masterGain: 0.7,
  }],
  ["fc-chip-arp", "Chip Arp", "Classic chip arp", {
    oscATable: "chip", oscALevel: 0.7, pulseDuty: 0.5, filterCutoff: 7000, ampAttack: 0.001, ampDecay: 0.1, ampSustain: 0.15, ampRelease: 0.08, masterGain: 0.72,
  }, { enabled: true, mode: "up", bpm: 150, division: "1/16", octaves: 2, gate: 0.5 }],
  ["fc-chip-vibrato", "Vibrato Square", "Vibrato chip square", {
    oscATable: "pulse", oscALevel: 0.72, pulseDuty: 0.5, lfo1Wave: "sine", lfo1Rate: 6, lfo1Depth: 0.25, lfo1Dest: "pitch",
    filterCutoff: 6500, ampAttack: 0.001, ampSustain: 0.65, ampRelease: 0.12, mono: true, masterGain: 0.7,
  }],
  ["fc-chip-acid", "Chip Acid", "Chip + acid filter", {
    oscATable: "pulse", oscALevel: 0.7, pulseDuty: 0.5, chipAcidMix: 0.8, filterModel: "ladder", filterCutoff: 900, filterResonance: 10,
    filterEnvAmount: 0.85, filtDecay: 0.2, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.45, ampRelease: 0.1, mono: true, masterGain: 0.64,
  }],
  ["fc-chip-harmony", "Chip Harmony", "Two-square harmony", {
    oscATable: "pulse", oscALevel: 0.55, pulseDuty: 0.5, oscBTable: "pulse", oscBLevel: 0.5, oscBOctave: 1,
    filterCutoff: 6000, ampAttack: 0.001, ampSustain: 0.6, ampRelease: 0.15, masterGain: 0.68,
  }],
  ["fc-chip-pwm", "Chip PWM", "PWM chip voice", {
    oscATable: "pulse", oscAPos: 0.3, oscALevel: 0.72, pulseDuty: 0.3, oscALfo: 0.5, lfo1Rate: 0.8, lfo1Depth: 0.4,
    filterCutoff: 5500, ampAttack: 0.001, ampSustain: 0.6, ampRelease: 0.12, mono: true, masterGain: 0.7,
  }],
  ["fc-chip-kick", "Chip Kick", "Chip-style kick", {
    oscATable: "basic", oscALevel: 0.8, oscAOctave: -1, pitchEnvAmount: 24, pitchEnvTime: 0.08,
    filterCutoff: 800, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.05, ampRelease: 0.1, punch: 0.5, mono: true, masterGain: 0.7,
  }],
  ["fc-chip-pluck", "Chip Pluck", "Short chip pluck", {
    oscATable: "chip", oscALevel: 0.72, pulseDuty: 0.25, filterCutoff: 6000, ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.05, ampRelease: 0.08, masterGain: 0.72,
  }],
  ["fc-chip-detune", "Detuned Chips", "Detuned dual chips", {
    oscATable: "chip", oscALevel: 0.55, oscBTable: "pulse", oscBLevel: 0.5, oscBDetune: 12, pulseDuty: 0.5,
    filterCutoff: 5500, ampAttack: 0.001, ampSustain: 0.55, ampRelease: 0.15, masterGain: 0.68,
  }],
  ["fc-chip-echo", "Chip Echo", "Echoing chip blip", {
    oscATable: "pulse", oscALevel: 0.65, pulseDuty: 0.5, filterCutoff: 6000, ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.1, ampRelease: 0.1,
    delayTime: 0.25, delayFeedback: 0.45, delayMix: 0.4, masterGain: 0.68,
  }],
  ["fc-chip-periodic", "Periodic Noise", "Periodic noise voice", {
    oscALevel: 0.3, noiseLevel: 0.55, chipNoise: "periodic", noiseMode: "bed", filterCutoff: 3500, filterResonance: 2.0,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.3, ampRelease: 0.15, masterGain: 0.68,
  }],
  ["fc-chip-sync", "Sync Chip", "Hard-sync chip lead", {
    oscATable: "pulse", oscALevel: 0.72, hardSync: true, pulseDuty: 0.4, filterCutoff: 5000, filterResonance: 2.5,
    ampAttack: 0.001, ampSustain: 0.55, ampRelease: 0.12, mono: true, masterGain: 0.7,
  }],
  ["fc-chip-pad", "Chip Pad", "Lo-fi chip pad", {
    oscATable: "chip", oscALevel: 0.5, oscBTable: "pulse", oscBLevel: 0.4, oscBDetune: 8, filterCutoff: 4000,
    ampAttack: 0.2, ampSustain: 0.85, ampRelease: 0.8, chorusMix: 0.2, reverbMix: 0.25, masterGain: 0.64,
  }],
  ["fc-chip-solo", "Chip Solo", "Expressive chip solo", {
    oscATable: "pulse", oscALevel: 0.72, pulseDuty: 0.5, glide: 0.1, lfo1Rate: 5, lfo1Depth: 0.2, lfo1Dest: "pitch",
    filterCutoff: 5500, ampAttack: 0.005, ampSustain: 0.7, ampRelease: 0.15, mono: true, masterGain: 0.7,
  }],
];

const fm = [
  ["fc-fm-electric", "Electric Piano FM", "DX-style electric piano", {
    oscATable: "bell", oscALevel: 0.6, fmEngine: "ops4", fmAlg: 4, fmOp2Ratio: 14, fmOp3Ratio: 1, fmOp4Ratio: 1,
    fmOp2Level: 0.6, fmOp3Level: 0.3, fmFeedback: 0.1, fmAmount: 0.5, filterCutoff: 5000,
    ampAttack: 0.002, ampDecay: 0.7, ampSustain: 0.3, ampRelease: 0.45, masterGain: 0.66,
  }],
  ["fc-fm-bell", "Temple Bell", "Temple FM bell", {
    oscATable: "bell", oscALevel: 0.65, fmEngine: "ops4", fmAlg: 5, fmOp2Ratio: 3.5, fmOp3Ratio: 7, fmOp4Ratio: 11,
    fmOp2Level: 0.7, fmOp3Level: 0.4, fmOp4Level: 0.25, fmFeedback: 0.2, fmAmount: 0.55,
    filterCutoff: 6000, ampAttack: 0.001, ampDecay: 1.2, ampSustain: 0.1, ampRelease: 1.0, reverbMix: 0.35, masterGain: 0.64,
  }],
  ["fc-fm-bass", "FM Bass", "Tight FM bass", {
    oscATable: "basic", oscALevel: 0.65, fmEngine: "ops4", fmAlg: 2, fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3,
    fmOp2Level: 0.8, fmOp3Level: 0.35, fmFeedback: 0.3, fmAmount: 0.45, subLevel: 0.25,
    filterCutoff: 1200, filterResonance: 2.5, ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.5, ampRelease: 0.2, mono: true, masterGain: 0.64,
  }],
  ["fc-fm-brass", "FM Brass", "Synthesized FM brass", {
    oscATable: "saw", oscALevel: 0.6, fmEngine: "ops4", fmAlg: 3, fmOp2Ratio: 1, fmOp3Ratio: 2, fmOp4Ratio: 3,
    fmOp2Level: 0.7, fmOp3Level: 0.5, fmFeedback: 0.15, fmAmount: 0.4, filterCutoff: 3200, filterResonance: 2.5, filterEnvAmount: 0.5, filtDecay: 0.3,
    ampAttack: 0.08, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.3, masterGain: 0.64,
  }],
  ["fc-fm-pluck", "FM Pluck", "FM plucked string", {
    oscATable: "bell", oscALevel: 0.62, fmEngine: "ops4", fmAlg: 1, fmOp2Ratio: 2, fmOp3Ratio: 3, fmOp4Ratio: 4,
    fmOp2Level: 0.65, fmFeedback: 0.25, fmAmount: 0.5, filterCutoff: 4000,
    ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.1, ampRelease: 0.3, reverbMix: 0.2, masterGain: 0.66,
  }],
  ["fc-fm-pad", "FM Pad", "Soft FM pad", {
    oscATable: "harmonic", oscALevel: 0.5, fmEngine: "ops4", fmAlg: 6, fmOp2Ratio: 1.5, fmOp3Ratio: 2.5, fmOp4Ratio: 0.5,
    fmOp2Level: 0.45, fmOp3Level: 0.3, fmAmount: 0.35, filterCutoff: 2800,
    ampAttack: 0.5, ampSustain: 0.85, ampRelease: 1.4, chorusMix: 0.25, reverbMix: 0.35, masterGain: 0.6,
  }],
  ["fc-fm-clav", "FM Clav", "FM clavinet", {
    oscATable: "pulse", oscALevel: 0.65, fmEngine: "ops4", fmAlg: 0, fmOp2Ratio: 2, fmOp3Ratio: 3, fmOp4Ratio: 4,
    fmOp2Level: 0.7, fmFeedback: 0.35, fmAmount: 0.55, filterCutoff: 3500, filterResonance: 3.0,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.2, ampRelease: 0.12, masterGain: 0.66,
  }],
  ["fc-fm-mallet", "Mallet FM", "Mallet percussion FM", {
    oscATable: "bell", oscALevel: 0.65, fmEngine: "ops4", fmAlg: 5, fmOp2Ratio: 4, fmOp3Ratio: 7, fmOp4Ratio: 11,
    fmOp2Level: 0.75, fmOp3Level: 0.3, fmAmount: 0.5, filterCutoff: 5500,
    ampAttack: 0.001, ampDecay: 0.5, ampSustain: 0.08, ampRelease: 0.4, reverbMix: 0.25, masterGain: 0.66,
  }],
  ["fc-fm-growl", "FM Growl", "Growling FM lead", {
    oscATable: "growl", oscALevel: 0.6, fmEngine: "ops4", fmAlg: 2, fmOp2Ratio: 1.5, fmOp3Ratio: 2, fmOp4Ratio: 3.5,
    fmOp2Level: 0.85, fmFeedback: 0.45, fmAmount: 0.6, filterModel: "ladder", filterCutoff: 1800, filterResonance: 4.5,
    ampAttack: 0.02, ampSustain: 0.7, ampRelease: 0.3, mono: true, masterGain: 0.62,
  }],
  ["fc-fm-flute", "FM Flute", "Breathy FM flute", {
    oscATable: "basic", oscALevel: 0.55, noiseLevel: 0.08, fmEngine: "ops4", fmAlg: 1, fmOp2Ratio: 2, fmOp3Ratio: 1, fmOp4Ratio: 3,
    fmOp2Level: 0.4, fmAmount: 0.3, filterCutoff: 3500, ampAttack: 0.08, ampSustain: 0.75, ampRelease: 0.35, masterGain: 0.66,
  }],
  ["fc-fm-organ", "FM Organ", "FM organ tones", {
    oscATable: "additive", oscALevel: 0.6, fmEngine: "ops4", fmAlg: 7, fmOp2Ratio: 2, fmOp3Ratio: 3, fmOp4Ratio: 4,
    fmOp2Level: 0.5, fmOp3Level: 0.35, fmAmount: 0.35, filterCutoff: 4500,
    ampAttack: 0.01, ampSustain: 0.9, ampRelease: 0.15, chorusMix: 0.2, masterGain: 0.66,
  }],
  ["fc-fm-bell-soft", "Soft Bell", "Soft FM bell", {
    oscATable: "bell", oscALevel: 0.58, fmAmount: 0.4, fmRatio: 2.5, filterCutoff: 4500,
    ampAttack: 0.001, ampDecay: 1.0, ampSustain: 0.15, ampRelease: 0.8, reverbMix: 0.4, masterGain: 0.66,
  }],
  ["fc-fm-lead", "FM Lead", "Cutting FM lead", {
    oscATable: "harmonic", oscALevel: 0.65, fmEngine: "ops4", fmAlg: 3, fmOp2Ratio: 2, fmOp3Ratio: 5, fmOp4Ratio: 7,
    fmOp2Level: 0.7, fmOp3Level: 0.4, fmFeedback: 0.2, fmAmount: 0.55, filterCutoff: 4000, filterResonance: 3.0,
    ampAttack: 0.01, ampSustain: 0.7, ampRelease: 0.25, mono: true, masterGain: 0.64,
  }],
  ["fc-fm-vector", "Vector Drift", "Vector-morphing FM", {
    oscATable: "bell", oscALevel: 0.55, fmEngine: "ops4", fmAlg: 4, vectorRate: 0.15, vectorDepth: 0.5,
    fmOp2Ratio: 2, fmOp3Ratio: 3, fmOp4Ratio: 5, fmOp2Level: 0.6, fmAmount: 0.45, filterCutoff: 3200,
    ampAttack: 0.1, ampSustain: 0.8, ampRelease: 0.6, reverbMix: 0.25, masterGain: 0.62,
  }],
  ["fc-fm-kick", "FM Kick", "FM kick drum", {
    oscATable: "basic", oscALevel: 0.75, fmAmount: 0.7, fmRatio: 1, pitchEnvAmount: 28, pitchEnvTime: 0.1,
    filterCutoff: 600, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.05, ampRelease: 0.15, punch: 0.55, mono: true, masterGain: 0.68,
  }],
  ["fc-fm-marimba", "FM Marimba", "FM marimba", {
    oscATable: "bell", oscALevel: 0.62, fmEngine: "ops4", fmAlg: 5, fmOp2Ratio: 4, fmOp3Ratio: 8, fmOp4Ratio: 1,
    fmOp2Level: 0.55, fmAmount: 0.4, filterCutoff: 5000, ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.08, ampRelease: 0.35, reverbMix: 0.2, masterGain: 0.66,
  }],
  ["fc-fm-vox", "FM Voice", "FM vocal formant", {
    oscATable: "vocal", oscALevel: 0.55, fmEngine: "ops4", fmAlg: 6, fmOp2Ratio: 1.5, fmOp3Ratio: 2, fmOp4Ratio: 3,
    fmOp2Level: 0.5, fmAmount: 0.4, filterCarve: "formant", filterCarveAmount: 0.55, filterCutoff: 2000,
    ampAttack: 0.05, ampSustain: 0.75, ampRelease: 0.4, masterGain: 0.64,
  }],
  ["fc-fm-metallic", "FM Metal", "Metallic FM hit", {
    oscATable: "metallic", oscALevel: 0.6, fmEngine: "ops4", fmAlg: 5, fmOp2Ratio: 5, fmOp3Ratio: 7, fmOp4Ratio: 11,
    fmOp2Level: 0.8, fmOp3Level: 0.5, fmFeedback: 0.3, fmAmount: 0.65, filterCutoff: 4500,
    ampAttack: 0.001, ampDecay: 0.6, ampSustain: 0.15, ampRelease: 0.5, masterGain: 0.62,
  }],
  ["fc-fm-glass", "Glass FM", "Glass FM tone", {
    oscATable: "bell", oscALevel: 0.58, fmAmount: 0.5, fmRatio: 7, filterType: "highpass", filterCutoff: 800,
    ampAttack: 0.001, ampDecay: 0.8, ampSustain: 0.15, ampRelease: 0.7, reverbMix: 0.4, delayMix: 0.15, masterGain: 0.64,
  }],
  ["fc-fm-classic", "Classic Cross", "Classic cross-mod FM", {
    oscATable: "basic", oscAPos: 0.0, oscALevel: 0.6, oscBTable: "basic", oscBLevel: 0.5,
    fmAmount: 0.6, fmRatio: 2, fmBtoA: 0.3, filterCutoff: 3500, filterResonance: 2.0,
    ampAttack: 0.01, ampSustain: 0.7, ampRelease: 0.35, masterGain: 0.66,
  }],
];

const CATEGORIES = [
  ["Bass", bass],
  ["Lead", lead],
  ["Pluck", pluck],
  ["Pad", pad],
  ["Keys", keys],
  ["Arp", arp],
  ["FX", fx],
  ["Atmos", atmos],
  ["Vintage", vintage],
  ["Chip", chip],
  ["FM", fm],
];

let out = `import {
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
  const p = P(patch);
  if (Array.isArray((patch as { modMatrix?: ModRoute[] }).modMatrix)) {
    p.modMatrix = makeModMatrix((patch as { modMatrix: ModRoute[] }).modMatrix);
  }
  return { id, name, desc, category, patch: p, arp };
}

/**
 * Factory curated bank — 20 unique presets × 11 categories = 220.
 * Authored for the current Fire Command synth (absolute Q, ladder/svf, ops4, warp, LPG).
 */
export const CURATED_PRESETS: FirePreset[] = [
`;

const CAT_Q = {
  Bass: 2.8, Lead: 3.5, Pluck: 2.4, Pad: 1.8, Keys: 2.2, Arp: 3.8,
  FX: 4.5, Atmos: 1.6, Vintage: 2.6, Chip: 2.0, FM: 2.8,
};

for (const [cat, rows] of CATEGORIES) {
  out += `\n  // ===== ${cat.toUpperCase()} (20) =====\n`;
  for (const row of rows) {
    const [id, name, desc, patch, arp] = row;
    const clean = { ...patch };
    // Ensure absolute musical Q — never leave the Init default (0.7).
    if (clean.filterResonance == null || clean.filterResonance < 1.1) {
      clean.filterResonance = CAT_Q[cat] ?? 2.5;
    }
    if (clean.masterGain == null) clean.masterGain = 0.68;
    out += preset(id, name, desc, cat, clean, arp);
    out += "\n";
  }
}

out += `];\n`;

fs.writeFileSync(OUT, out);
const counts = Object.fromEntries(CATEGORIES.map(([c, r]) => [c, r.length]));
console.log("Wrote", OUT.pathname, counts);
const bad = Object.entries(counts).filter(([, n]) => n !== 20);
if (bad.length) {
  console.error("Category count errors:", bad);
  process.exit(1);
}
console.log("OK: 11 × 20 = 220 presets");
