/**
 * Maps Fire module IDs → patch keys preserved when that module is locked
 * against Random Armory / Natural Selection.
 */

import type { FirePatch } from "@/audio/dsp/FireCommandSynth";

type PatchKey = keyof FirePatch;

const MODULE_KEYS: Record<string, readonly PatchKey[]> = {
  "osc.a": ["oscATable", "oscAPos", "oscAEnv", "oscALfo", "oscAOctave", "oscADetune", "oscALevel", "oscAContinuity"],
  "osc.b": ["oscBTable", "oscBPos", "oscBEnv", "oscBLfo", "oscBOctave", "oscBDetune", "oscBLevel", "oscBInherit", "oscBPhaseLock", "fmAtoB"],
  "osc.c": ["oscCTable", "oscCPos", "oscCEnv", "oscCLfo", "oscCOctave", "oscCDetune", "oscCLevel"],
  "fire.sec.warp": ["warpStretch", "warpTilt", "warpComb", "warpAmount", "warpMode"],
  chip: ["pulseDuty", "hardSync", "chipNoise", "chipVoiceLimit", "accentAmount", "slideOn", "chipAcidMix"],
  noise: ["noiseLevel", "noiseColor", "noiseMode", "noiseDensity", "noiseGrain"],
  sub: ["subWave", "subLevel", "subOctave", "subPhaseAlign", "subTranslate"],
  "mixer.unison": ["unison", "unisonDetune", "unisonWidth"],
  "analog.life": ["drift", "driftRate", "voiceInstability", "tuneVariance", "envVariance"],
  filter: ["filterType", "filterModel", "filterCutoff", "filterResonance", "filterEnvAmount", "filterKeyTrack", "filterDrive", "filterCarve", "filterCarveAmount"],
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
  "fx.drive": ["drive", "driveMode", "crush", "tone", "punch", "driveInGain", "driveOutGain", "driveAutoGain", "driveBias", "driveSymmetry", "driveDcBlock", "driveTonePos"],
  "fx.vintage": [
    "cassetteGen", "tapeSpeed", "wowFlutter", "vhsColor", "bitDepth", "sampleRateReduce",
    "bbdChorus", "analogComp", "dust", "hiss", "hum", "printThrough",
    "ageInGain", "ageOutGain", "ageMacro", "ageEvolve",
    "ageLockMedium", "ageLockMotion", "ageLockWear", "ageLockResolution",
  ],
  "fx.phaser": ["phaserRate", "phaserDepth", "phaserMix", "phaserStages", "phaserFeedback", "phaserCenter", "phaserStereo"],
  "fx.chorus": ["chorusRate", "chorusDepth", "chorusMix", "chorusVoices", "chorusDelay", "chorusSpread", "chorusModel", "chorusLowCut"],
  "fx.delay": ["delayTime", "delayFeedback", "delayMix", "delaySync", "delayCascadeMode", "delayDuck", "delayFbFilter", "delayFbDrive", "delayFreeze"],
  "fx.reverb": ["reverbSize", "reverbMix", "reverbDamp", "reverbPredelay", "reverbDiffusion", "reverbEarly", "reverbLowDecay", "reverbHighCut", "reverbFreeze", "reverbInGain", "reverbOutGain"],
  "fx.spectral": ["spectralMode", "spectralAmount", "spectralMix", "spectralLow", "spectralHigh", "spectralFftSize", "spectralInGain", "spectralOutGain", "spectralWetOnly"],
  macros: ["macro1", "macro2", "macro3", "macro4"],
  gate: ["gateOn", "gateRate", "gateDepth", "gateSteps", "gatePattern", "gateSmooth"],
  width: ["stereoWidth", "widthInGain", "widthOutGain", "monoBelow", "widthMechanism", "widthCorrWarn"],
  glue: [
    "punch", "glueInGain", "glueOutGain", "glueAutoGain", "glueMode",
    "glueThreshold", "glueRatio", "glueAttack", "glueRelease", "glueKnee", "glueMakeup", "glueMix",
    "glueUseAdvanced", "mixDeltaAudition", "masterChainScene",
  ],
  air: ["airLow", "airHigh", "airAmount", "airInGain", "airOutGain", "airArch", "airMsMode"],
  harmony: ["harmonyMode", "harmonyLevel"],
  scale: ["scaleLock"],
  chord: ["chordMemoryOn", "chordIntervals"],
  human: ["humanizeOn", "humanizeTiming", "humanizeVelocity"],
  scenes: [],
  output: ["masterGain", "scopeDisplayGain"],
  performance: ["pathOsc", "pathFilter", "pathDrive", "pathAge", "pathFx", "pathMix", "pathScope", "voiceSteal", "ceaseMode"],
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

/** True when spectral FX is actually costing STFT CPU. */
export function spectralActive(patch: FirePatch): boolean {
  return (patch.spectralMode ?? "off") !== "off" && (patch.spectralMix ?? 0) > 0.05;
}

/**
 * Soft unison ceiling for live voices. Spectral STFT + ops4 + 3 osc groups
 * at unison 16 (~48 PeriodicWaves) melts the audio + UI threads; cap before
 * Voice construction so extreme user presets stay playable.
 */
export function liveUnisonCap(patch: FirePatch): number {
  const spectralOn = spectralActive(patch);
  const ops4 = (patch.fmEngine ?? "classic") === "ops4";
  const groups = 2 + ((patch.oscCLevel ?? 0) > 0.0001 ? 1 : 0);
  const dualMorph = (patch.oscAContinuity ?? 0) > 0.45;
  const workletFilt = (patch.filterModel ?? "biquad") !== "biquad" && (patch.fxQuality ?? "live") !== "eco";
  const heavyFx =
    (patch.crush ?? 0) > 0.45
    || (patch.chorusModel === "triple" || patch.chorusModel === "ensemble")
    || (patch.reverbMix ?? 0) > 0.4
    || (patch.phaserMix ?? 0) > 0.45;
  let cap = 12;
  if (ops4) cap = Math.min(cap, 8);
  if (spectralOn) cap = Math.min(cap, 6);
  if (spectralOn && ops4) cap = 4;
  if (spectralOn && groups >= 3) cap = Math.min(cap, 4);
  if (!spectralOn && !ops4 && heavyFx) cap = Math.min(cap, 8);
  if (dualMorph) cap = Math.min(cap, 8);
  if (workletFilt) cap = Math.min(cap, dualMorph ? 6 : 8);
  return cap;
}

/**
 * 0..1 estimate of how hard this patch pushes CPU (voices × sources + bus FX).
 * Used by StageViz throttle and eco FX downgrades.
 */
export function patchCpuPressure(patch: FirePatch, activeVoices = 1): number {
  const uni = Math.min(Math.round(patch.unison ?? 1), liveUnisonCap(patch));
  const groups = 2 + ((patch.oscCLevel ?? 0) > 0.0001 ? 1 : 0);
  const sources = uni * groups + ((patch.fmEngine ?? "classic") === "ops4" ? 4 : 1) + 2;
  const voiceLoad = (sources * Math.max(1, activeVoices)) / 72;
  const spectral = spectralActive(patch) ? 0.35 : 0;
  const fx =
    ((patch.crush ?? 0) > 0.4 ? 0.08 : 0)
    + ((patch.chorusMix ?? 0) > 0.2 ? 0.06 : 0)
    + ((patch.phaserMix ?? 0) > 0.2 ? 0.05 : 0)
    + ((patch.reverbMix ?? 0) > 0.25 ? 0.08 : 0)
    + ((patch.delayMix ?? 0) > 0.2 ? 0.05 : 0);
  return Math.max(0, Math.min(1, voiceLoad * 0.55 + spectral + fx));
}

/**
 * Soften runaway CPU / clip settings on load / randomize.
 * Mutates `patch`. Returns true when anything was dialed back.
 * Ceilings leave room for musical scream-Q / drive — only true bombs get cut.
 */
export function applyPerformanceSafety(
  patch: FirePatch,
  opts: {
    /**
     * Keep deliberately-risky-but-intentional settings (delay/reverb freeze,
     * infinite cascade). Used when the patch comes from a project the USER
     * saved: clearing them made saved sounds fail to round-trip. The engine
     * still hard-bounds the feedback those modes ask for, so they can't run
     * away. Presets, characters and Natural Selection output do NOT set this.
     */
    preserveIntent?: boolean;
  } = {},
): boolean {
  let softened = false;
  const cap = (cond: boolean, apply: () => void) => {
    if (cond) {
      apply();
      softened = true;
    }
  };

  const uniCap = liveUnisonCap(patch);
  cap((patch.unison ?? 1) > uniCap, () => {
    patch.unison = uniCap as FirePatch["unison"];
  });
  // Soften only runaway scream Q — Studio/Fire power users may sit above 2.2.
  const pressureEarly = patchCpuPressure(patch, patch.mono ? 1 : 4);
  const resoCeil = pressureEarly > 0.75 ? 12 : 18;
  cap((patch.filterResonance ?? 0) > resoCeil, () => {
    patch.filterResonance = resoCeil;
  });
  cap((patch.filterDrive ?? 0) > 0.88, () => {
    patch.filterDrive = 0.88;
  });
  cap((patch.drive ?? 0) > 0.85, () => {
    patch.drive = 0.85;
  });
  cap((patch.crush ?? 0) > 0.62, () => {
    patch.crush = 0.62;
  });
  const delayMode = patch.delayCascadeMode ?? "echo";
  if (delayMode !== "infinite" && delayMode !== "long" && !patch.delayFreeze) {
    // Only intervene when the ENERGY (mix × feedback) is genuinely dangerous.
    // The old blanket "echo feedback ≤ 0.38" silently rewrote every authored
    // dub/echo preset on load (0.45–0.55 → 0.38) — tails died after one
    // repeat and the patches read as flat and non-responsive. The engine
    // hard-caps echo feedback at 0.72 and the bus limiter now catches
    // recirculation cleanly, so let musical feedback through.
    const fb = patch.delayFeedback ?? 0;
    const mix = patch.delayMix ?? 0;
    cap(fb > 0.62 && mix > 0.45, () => {
      patch.delayFeedback = 0.62;
    });
  }
  cap((patch.delayFeedback ?? 0) > 0.78, () => {
    patch.delayFeedback = 0.78;
  });
  // Freeze / infinite modes force near-unity feedback in the engine — clear
  // freeze on load so untrusted patches can't leave a self-sustaining delay
  // bomb. Skipped for user projects (see preserveIntent).
  if (!opts.preserveIntent) {
    if (patch.delayFreeze) {
      patch.delayFreeze = false;
      softened = true;
    }
    if (patch.reverbFreeze) {
      patch.reverbFreeze = false;
      softened = true;
    }
    if ((patch.delayCascadeMode ?? "echo") === "infinite") {
      patch.delayCascadeMode = "long";
      softened = true;
    }
  }
  cap((patch.glueMakeup ?? 1) > 2, () => {
    patch.glueMakeup = 2;
  });
  cap((patch.glueOutGain ?? 1) > 1.5, () => {
    patch.glueOutGain = 1.5;
  });
  cap((patch.delayMix ?? 0) > 0.55, () => {
    patch.delayMix = 0.55;
  });
  cap((patch.reverbMix ?? 0) > 0.6, () => {
    patch.reverbMix = 0.6;
  });
  cap((patch.punch ?? 0) > 0.8, () => {
    patch.punch = 0.8;
  });
  cap((patch.chipAcidMix ?? 0) > 0.92, () => {
    patch.chipAcidMix = 0.92;
  });
  cap((patch.phaserStages ?? 4) > 8, () => {
    patch.phaserStages = 8;
  });
  cap((patch.fmAmount ?? 0) > 0.85, () => {
    patch.fmAmount = 0.85;
  });
  cap((patch.fmFeedback ?? 0) > 0.7, () => {
    patch.fmFeedback = 0.7;
  });
  cap((patch.masterGain ?? 0) > 0.85, () => {
    patch.masterGain = 0.85;
  });
  if (spectralActive(patch)) {
    cap((patch.spectralMix ?? 0) > 0.55, () => {
      patch.spectralMix = 0.55;
    });
  }
  // Only force eco under extreme pressure — mid pressure used to sterilize every lush patch.
  const pressure = patchCpuPressure(patch, patch.mono ? 1 : 4);
  if (pressure > 0.78) {
    cap(patch.fxQuality === "high", () => {
      patch.fxQuality = "live";
    });
    cap(
      patch.chorusModel === "ensemble",
      () => {
        patch.chorusModel = "triple";
      },
    );
  }

  const oscSum = (patch.oscALevel ?? 0) + (patch.oscBLevel ?? 0) + (patch.oscCLevel ?? 0);
  if (oscSum > 2.2) {
    const s = 2.05 / oscSum;
    patch.oscALevel *= s;
    patch.oscBLevel *= s;
    patch.oscCLevel *= s;
    softened = true;
  }
  return softened;
}

/**
 * Loudness / feedback safety after randomize (Armory).
 * Split from the old hard Q≤2.2 ceiling so Random Armory keeps filter bite —
 * only runaway feedback/wet mixes stay tightly capped.
 */
export function applyLoudnessSafety(patch: FirePatch): FirePatch {
  patch.masterGain = Math.min(patch.masterGain ?? 0.72, 0.8);
  patch.filterResonance = Math.min(patch.filterResonance ?? 0, 14);
  patch.filterDrive = Math.min(patch.filterDrive ?? 0, 0.8);
  patch.drive = Math.min(patch.drive ?? 0, 0.78);
  patch.delayFeedback = Math.min(patch.delayFeedback ?? 0, 0.72);
  patch.delayMix = Math.min(patch.delayMix ?? 0, 0.48);
  patch.reverbMix = Math.min(patch.reverbMix ?? 0, 0.55);
  patch.fmAmount = Math.min(patch.fmAmount ?? 0, 0.78);
  patch.fmFeedback = Math.min(patch.fmFeedback ?? 0, 0.65);
  patch.crush = Math.min(patch.crush ?? 0, 0.52);
  patch.noiseLevel = Math.min(patch.noiseLevel ?? 0, 0.5);
  patch.unison = Math.min(patch.unison ?? 1, 8) as FirePatch["unison"];
  if ((patch.oscALevel ?? 0) + (patch.oscBLevel ?? 0) + (patch.oscCLevel ?? 0) > 2.2) {
    const s = 2.05 / ((patch.oscALevel ?? 0) + (patch.oscBLevel ?? 0) + (patch.oscCLevel ?? 0));
    patch.oscALevel *= s;
    patch.oscBLevel *= s;
    patch.oscCLevel *= s;
  }
  applyPerformanceSafety(patch);
  return patch;
}

/**
 * Natural Selection safety — musical bite without ear-hash or bus poison.
 * Caps scream-Q / stacked drive / freeze loops; floors attack & gate edges
 * so offspring don't click on the first note.
 */
export function applyNsSafety(patch: FirePatch): FirePatch {
  patch.masterGain = Math.min(patch.masterGain ?? 0.72, 0.72);
  // Biquad can take a little more Q than ladder/SVF (self-osc hash).
  const ladderLike = patch.filterModel === "ladder" || patch.filterModel === "svf";
  patch.filterResonance = Math.min(patch.filterResonance ?? 0, ladderLike ? 6.5 : 9);
  patch.filterDrive = Math.min(patch.filterDrive ?? 0, ladderLike ? 0.55 : 0.62);
  patch.drive = Math.min(patch.drive ?? 0, 0.62);
  // High Q + high filter-env is the classic "screaming note" combo — trim env.
  if ((patch.filterResonance ?? 0) > 5 && Math.abs(patch.filterEnvAmount ?? 0) > 0.75) {
    patch.filterEnvAmount = Math.sign(patch.filterEnvAmount ?? 0) * 0.7;
  }
  patch.delayFeedback = Math.min(patch.delayFeedback ?? 0, 0.62);
  patch.delayMix = Math.min(patch.delayMix ?? 0, 0.4);
  patch.reverbMix = Math.min(patch.reverbMix ?? 0, 0.42);
  patch.fmAmount = Math.min(patch.fmAmount ?? 0, 0.68);
  patch.fmFeedback = Math.min(patch.fmFeedback ?? 0, 0.55);
  patch.fmAtoB = Math.min(patch.fmAtoB ?? 0, 0.55);
  patch.fmBtoA = Math.min(patch.fmBtoA ?? 0, 0.55);
  patch.ringAmount = Math.min(patch.ringAmount ?? 0, 0.45);
  patch.crush = Math.min(patch.crush ?? 0, 0.38);
  patch.noiseLevel = Math.min(patch.noiseLevel ?? 0, 0.32);
  patch.phaserFeedback = Math.min(patch.phaserFeedback ?? 0, 0.48);
  patch.phaserMix = Math.min(patch.phaserMix ?? 0, 0.5);
  patch.chipAcidMix = Math.min(patch.chipAcidMix ?? 0, 0.85);
  patch.punch = Math.min(patch.punch ?? 0, 0.45);
  patch.glueMakeup = Math.min(patch.glueMakeup ?? 1, 1.45);
  patch.glueOutGain = Math.min(patch.glueOutGain ?? 1, 1.25);
  patch.warpComb = Math.max(-0.85, Math.min(0.85, patch.warpComb ?? 0));
  // Near-unity freeze / infinite delay loops cooked the shared bus permanently.
  patch.delayFreeze = false;
  patch.reverbFreeze = false;
  if ((patch.delayCascadeMode ?? "echo") === "infinite") {
    patch.delayCascadeMode = "long";
  }
  // Spectral smear/freeze state survives setPatch — keep NS offspring clean.
  patch.spectralMode = "off";
  patch.spectralMix = Math.min(patch.spectralMix ?? 0, 0.28);
  // Declick floors
  patch.ampAttack = Math.max(0.005, patch.ampAttack ?? 0.01);
  if (patch.ampCurveAttack === "step") patch.ampCurveAttack = "lin";
  if (patch.gateOn) {
    patch.gateSmooth = Math.max(patch.gateSmooth ?? 0, 0.28);
  }
  // Prefer soft retrigger over hard zero-snap when attack is short
  if ((patch.ampAttack ?? 0) < 0.02 && patch.ampRetrigger === "zero") {
    patch.ampRetrigger = "current";
  }
  const uniCap = liveUnisonCap(patch);
  patch.unison = Math.min(patch.unison ?? 1, Math.min(7, uniCap)) as FirePatch["unison"];
  const oscSum = (patch.oscALevel ?? 0) + (patch.oscBLevel ?? 0) + (patch.oscCLevel ?? 0);
  if (oscSum > 1.95) {
    const s = 1.85 / oscSum;
    patch.oscALevel *= s;
    patch.oscBLevel *= s;
    patch.oscCLevel *= s;
  }
  const pressure = patchCpuPressure(patch, patch.mono ? 1 : 4);
  if (pressure > 0.7 && patch.fxQuality === "high") {
    patch.fxQuality = "live";
  }
  return patch;
}

export function lockedModuleCount(locks: Record<string, boolean>): number {
  return Object.values(locks).filter(Boolean).length;
}
