/**
 * Maps Fire module IDs → patch keys preserved when that module is locked
 * against Random Armory / Natural Selection.
 */

import type { FirePatch } from "@/audio/dsp/FireCommandSynth";

type PatchKey = keyof FirePatch;

const MODULE_KEYS: Record<string, readonly PatchKey[]> = {
  "osc.a": ["oscATable", "oscAPos", "oscAEnv", "oscALfo", "oscAOctave", "oscADetune", "oscALevel"],
  "osc.b": ["oscBTable", "oscBPos", "oscBEnv", "oscBLfo", "oscBOctave", "oscBDetune", "oscBLevel"],
  "osc.c": ["oscCTable", "oscCPos", "oscCEnv", "oscCLfo", "oscCOctave", "oscCDetune", "oscCLevel"],
  "fire.sec.warp": ["warpStretch", "warpTilt", "warpComb"],
  chip: ["pulseDuty", "hardSync", "chipNoise", "chipVoiceLimit", "accentAmount", "slideOn"],
  noise: ["noiseLevel", "noiseColor"],
  sub: ["subWave", "subLevel", "subOctave"],
  "mixer.unison": ["unison", "unisonDetune", "unisonWidth"],
  "analog.life": ["drift", "driftRate", "voiceInstability", "tuneVariance", "envVariance"],
  filter: ["filterType", "filterCutoff", "filterResonance", "filterEnvAmount", "filterKeyTrack", "filterDrive"],
  "env.amp": ["ampAttack", "ampDecay", "ampSustain", "ampRelease", "velAmount"],
  "env.mod": ["modAttack", "modDecay", "modSustain", "modRelease"],
  "env.filt": ["filtAttack", "filtDecay", "filtSustain", "filtRelease"],
  pluck: ["lpgOn", "lpgDecay", "lpgColor"],
  "lfo.1": ["lfo1Wave", "lfo1Rate", "lfo1Depth", "lfo1Dest"],
  "lfo.2": ["lfo2Wave", "lfo2Rate", "lfo2Depth", "lfo2Dest"],
  fm: ["fmAmount", "fmRatio", "fmBtoA", "ringAmount", "ringFreq"],
  "fm.rack": [
    "fmEngine", "fmAlg", "fmOp1Level", "fmOp2Level", "fmOp3Level", "fmOp4Level",
    "fmOp2Ratio", "fmOp3Ratio", "fmOp4Ratio", "fmFeedback", "vectorRate", "vectorDepth",
  ],
  pitch: ["pitchEnvAmount", "pitchEnvTime", "mono", "glide"],
  matrix: ["modMatrix"],
  arp: [],
  "fx.drive": ["drive", "driveMode", "crush", "tone", "punch"],
  "fx.vintage": [
    "cassetteGen", "tapeSpeed", "wowFlutter", "vhsColor", "bitDepth", "sampleRateReduce",
    "bbdChorus", "analogComp", "dust", "hiss", "hum", "printThrough",
  ],
  "fx.phaser": ["phaserRate", "phaserDepth", "phaserMix"],
  "fx.chorus": ["chorusRate", "chorusDepth", "chorusMix"],
  "fx.delay": ["delayTime", "delayFeedback", "delayMix"],
  "fx.reverb": ["reverbSize", "reverbMix", "reverbDamp", "reverbPredelay", "reverbDiffusion"],
  "fx.spectral": ["spectralMode", "spectralAmount", "spectralMix"],
  macros: ["macro1", "macro2", "macro3", "macro4"],
  gate: ["gateOn", "gateRate", "gateDepth", "gateSteps", "gatePattern", "gateSmooth"],
  width: ["stereoWidth"],
  glue: [],
  air: ["airLow", "airHigh", "airAmount"],
  harmony: ["harmonyMode", "harmonyLevel"],
  scale: ["scaleLock"],
  chord: ["chordMemoryOn", "chordIntervals"],
  human: ["humanizeOn", "humanizeTiming", "humanizeVelocity"],
  scenes: [],
  output: ["masterGain"],
  performance: ["pathOsc", "pathFilter", "pathDrive", "pathAge", "pathFx", "pathMix", "pathScope"],
};

/** Copy locked-module params from `src` onto `dst` (mutates dst). */
export function applyModuleLocks(dst: FirePatch, src: FirePatch, locks: Record<string, boolean>): FirePatch {
  for (const [modId, locked] of Object.entries(locks)) {
    if (!locked) continue;
    const keys = MODULE_KEYS[modId];
    if (!keys?.length) continue;
    for (const k of keys) {
      (dst as unknown as Record<string, unknown>)[k] = structuredClone((src as unknown as Record<string, unknown>)[k]);
    }
    const me = { ...(dst.moduleEnable ?? {}) };
    if (src.moduleEnable && modId in src.moduleEnable) {
      me[modId] = src.moduleEnable[modId];
      dst.moduleEnable = me;
    }
  }
  return dst;
}

/** Loudness / feedback safety ceiling after randomize or mutate. */
export function applyLoudnessSafety(patch: FirePatch): FirePatch {
  patch.masterGain = Math.min(patch.masterGain ?? 0.72, 0.78);
  patch.filterResonance = Math.min(patch.filterResonance ?? 0, 10);
  patch.filterDrive = Math.min(patch.filterDrive ?? 0, 0.65);
  patch.drive = Math.min(patch.drive ?? 0, 0.55);
  patch.delayFeedback = Math.min(patch.delayFeedback ?? 0, 0.62);
  patch.delayMix = Math.min(patch.delayMix ?? 0, 0.42);
  patch.reverbMix = Math.min(patch.reverbMix ?? 0, 0.5);
  patch.fmAmount = Math.min(patch.fmAmount ?? 0, 0.65);
  patch.fmFeedback = Math.min(patch.fmFeedback ?? 0, 0.55);
  patch.crush = Math.min(patch.crush ?? 0, 0.45);
  patch.unison = Math.min(patch.unison ?? 1, 7) as FirePatch["unison"];
  if ((patch.oscALevel ?? 0) + (patch.oscBLevel ?? 0) + (patch.oscCLevel ?? 0) > 2.1) {
    const s = 2.0 / ((patch.oscALevel ?? 0) + (patch.oscBLevel ?? 0) + (patch.oscCLevel ?? 0));
    patch.oscALevel *= s;
    patch.oscBLevel *= s;
    patch.oscCLevel *= s;
  }
  return patch;
}

export function lockedModuleCount(locks: Record<string, boolean>): number {
  return Object.values(locks).filter(Boolean).length;
}
