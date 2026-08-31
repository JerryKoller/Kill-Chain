/**
 * Which Fire Command modules is a patch ACTUALLY using?
 *
 * One shared predicate, three consumers:
 *   · preset load  — sleep every module the preset never touches, so a Bass
 *     patch stops paying for reverb / spectral / vintage DSP it doesn't use.
 *   · Natural Selection — cap generated patches to a module budget.
 *   · setParam — wake a sleeping module the moment the user edits one of its
 *     parameters, so pruning can never become a "dead knob" trap.
 *
 * "Used" means the module's parameters are away from their inert defaults —
 * i.e. removing the module would change the sound.
 */

import type { FirePatch, ModRoute } from "@/audio/dsp/FireCommandSynth";

/** Never slept: without these there is no sound to shape. */
export const FIRE_CORE_MODULES = ["osc.a", "filter", "env.amp"] as const;

/**
 * Navigation / bus surfaces. Sleeping these would hide UI rather than save
 * meaningful DSP, so usage analysis leaves them exactly as authored.
 *
 * `arp` is here deliberately: it is TRANSPORT state (store.arp), not a patch
 * parameter, so it has no setParam path to auto-wake it. Sleeping it because
 * a preset shipped without an arp made "enable the arpeggiator" silently do
 * nothing — and the arpeggiator costs nothing while it is switched off.
 */
export const FIRE_UNMANAGED_MODULES = [
  "mixer", "morph", "output", "performance", "scenes", "arp",
] as const;

/**
 * Toggleable modules in KEEP priority order (earliest = most defining of a
 * patch's identity). The Natural Selection budget drops from the tail.
 */
export const FIRE_MODULE_PRIORITY = [
  // Identity: the sound itself
  "osc.b", "osc.c", "sub", "mixer.unison", "env.filt", "fm", "fm.rack",
  "chip", "fire.sec.warp", "pluck", "noise",
  // Motion
  "lfo.1", "matrix", "lfo.2", "env.mod", "pitch", "analog.life",
  // Space / colour
  "fx.drive", "fx.delay", "fx.reverb", "fx.chorus", "fx.vintage",
  "fx.phaser", "fx.spectral",
  // Bus polish
  "glue", "width", "air",
  // Performance helpers (each has a setParam path, so auto-wake covers them)
  "gate", "harmony", "chord", "macros", "human", "scale",
] as const;

export type FireManagedModule = (typeof FIRE_MODULE_PRIORITY)[number];

/**
 * Parameter → owning module, for the setParam auto-wake. Only parameters
 * whose module can be slept need an entry.
 */
const PARAM_OWNER: Partial<Record<keyof FirePatch, FireManagedModule>> = {
  oscBTable: "osc.b", oscBPos: "osc.b", oscBEnv: "osc.b", oscBLfo: "osc.b",
  oscBOctave: "osc.b", oscBDetune: "osc.b", oscBLevel: "osc.b",
  oscBInherit: "osc.b", oscBPhaseLock: "osc.b",
  oscCTable: "osc.c", oscCPos: "osc.c", oscCEnv: "osc.c", oscCLfo: "osc.c",
  oscCOctave: "osc.c", oscCDetune: "osc.c", oscCLevel: "osc.c",
  subWave: "sub", subLevel: "sub", subOctave: "sub", subTranslate: "sub",
  subPhaseAlign: "sub",
  unison: "mixer.unison", unisonDetune: "mixer.unison", unisonWidth: "mixer.unison",
  unisonMix: "mixer.unison", unisonAnchor: "mixer.unison",
  unisonDistribution: "mixer.unison", unisonPhase: "mixer.unison",
  unisonTemporalSpread: "mixer.unison", unisonTemporalMode: "mixer.unison",
  unisonEnvSpread: "mixer.unison",
  filterEnvAmount: "env.filt", filterEnvResoAmount: "env.filt",
  filtAttack: "env.filt", filtDecay: "env.filt", filtSustain: "env.filt",
  filtRelease: "env.filt", filtCurveAttack: "env.filt",
  filtCurveDecay: "env.filt", filtCurveRelease: "env.filt",
  fmAmount: "fm", fmRatio: "fm", fmBtoA: "fm", fmAtoB: "fm",
  ringAmount: "fm", ringFreq: "fm", ringMode: "fm",
  fmEngine: "fm.rack", fmAlg: "fm.rack", fmFeedback: "fm.rack",
  fmOp1Level: "fm.rack", fmOp2Level: "fm.rack", fmOp3Level: "fm.rack",
  fmOp4Level: "fm.rack", fmOp2Ratio: "fm.rack", fmOp3Ratio: "fm.rack",
  fmOp4Ratio: "fm.rack", fmVectorX: "fm.rack", fmVectorY: "fm.rack",
  fmVectorCorners: "fm.rack", vectorRate: "fm.rack", vectorDepth: "fm.rack",
  pulseDuty: "chip", hardSync: "chip", chipNoise: "chip",
  chipVoiceLimit: "chip", accentAmount: "chip", slideOn: "chip",
  chipAcidMix: "chip",
  warpStretch: "fire.sec.warp", warpTilt: "fire.sec.warp",
  warpComb: "fire.sec.warp", warpAmount: "fire.sec.warp",
  warpMode: "fire.sec.warp",
  lpgOn: "pluck", lpgDecay: "pluck", lpgColor: "pluck", lpgModel: "pluck",
  lpgStrike: "pluck", lpgRing: "pluck", lpgLeakage: "pluck",
  lpgChoke: "pluck", lpgResoCouple: "pluck",
  noiseLevel: "noise", noiseColor: "noise", noiseMode: "noise",
  noiseDensity: "noise", noiseGrain: "noise",
  lfo1Wave: "lfo.1", lfo1Rate: "lfo.1", lfo1Depth: "lfo.1",
  lfo1Dest: "lfo.1", lfo1RateDisplay: "lfo.1",
  lfo2Wave: "lfo.2", lfo2Rate: "lfo.2", lfo2Depth: "lfo.2",
  lfo2Dest: "lfo.2", lfo2RateDisplay: "lfo.2", lfo2Relation: "lfo.2",
  lfo2PhaseOffset: "lfo.2", lfo2Ratio: "lfo.2", lfo2DriftMode: "lfo.2",
  modMatrix: "matrix",
  modEnvPoints: "env.mod", modEnvSustainIndex: "env.mod",
  modEnvLoop: "env.mod", modAttack: "env.mod", modDecay: "env.mod",
  modSustain: "env.mod", modRelease: "env.mod",
  pitchEnvAmount: "pitch", pitchEnvTime: "pitch", glide: "pitch",
  glideMode: "pitch", glideCurve: "pitch", glideRateMode: "pitch",
  drift: "analog.life", driftRate: "analog.life",
  voiceInstability: "analog.life", tuneVariance: "analog.life",
  envVariance: "analog.life", analogWake: "analog.life",
  analogTremor: "analog.life", analogBreath: "analog.life",
  analogClimate: "analog.life", analogEvents: "analog.life",
  drive: "fx.drive", driveMode: "fx.drive", crush: "fx.drive",
  driveBias: "fx.drive", driveSymmetry: "fx.drive",
  driveInGain: "fx.drive", driveOutGain: "fx.drive",
  driveAutoGain: "fx.drive", driveDcBlock: "fx.drive", driveTonePos: "fx.drive",
  delayTime: "fx.delay", delayFeedback: "fx.delay", delayMix: "fx.delay",
  delaySync: "fx.delay", delayCascadeMode: "fx.delay", delayDuck: "fx.delay",
  delayFbFilter: "fx.delay", delayFbDrive: "fx.delay", delayFreeze: "fx.delay",
  reverbSize: "fx.reverb", reverbMix: "fx.reverb", reverbDamp: "fx.reverb",
  reverbPredelay: "fx.reverb", reverbDiffusion: "fx.reverb",
  reverbEarly: "fx.reverb", reverbLowDecay: "fx.reverb",
  reverbHighCut: "fx.reverb", reverbFreeze: "fx.reverb",
  reverbInGain: "fx.reverb", reverbOutGain: "fx.reverb",
  chorusRate: "fx.chorus", chorusDepth: "fx.chorus", chorusMix: "fx.chorus",
  chorusVoices: "fx.chorus", chorusDelay: "fx.chorus",
  chorusSpread: "fx.chorus", chorusLowCut: "fx.chorus", chorusModel: "fx.chorus",
  cassetteGen: "fx.vintage", tapeSpeed: "fx.vintage", wowFlutter: "fx.vintage",
  vhsColor: "fx.vintage", bitDepth: "fx.vintage",
  sampleRateReduce: "fx.vintage", bbdChorus: "fx.vintage",
  analogComp: "fx.vintage", dust: "fx.vintage", hiss: "fx.vintage",
  hum: "fx.vintage", printThrough: "fx.vintage", ageMacro: "fx.vintage",
  ageEvolve: "fx.vintage", ageInGain: "fx.vintage", ageOutGain: "fx.vintage",
  phaserRate: "fx.phaser", phaserDepth: "fx.phaser", phaserMix: "fx.phaser",
  phaserStages: "fx.phaser", phaserFeedback: "fx.phaser",
  phaserCenter: "fx.phaser", phaserStereo: "fx.phaser",
  spectralMode: "fx.spectral", spectralAmount: "fx.spectral",
  spectralMix: "fx.spectral", spectralLow: "fx.spectral",
  spectralHigh: "fx.spectral", spectralWetOnly: "fx.spectral",
  punch: "glue", glueThreshold: "glue", glueRatio: "glue",
  glueAttack: "glue", glueRelease: "glue", glueKnee: "glue",
  glueMakeup: "glue", glueMix: "glue", glueUseAdvanced: "glue",
  glueMode: "glue", glueInGain: "glue", glueOutGain: "glue",
  stereoWidth: "width", monoBelow: "width", widthMechanism: "width",
  widthInGain: "width", widthOutGain: "width",
  airAmount: "air", airLow: "air", airHigh: "air", airArch: "air",
  airInGain: "air", airOutGain: "air", airMsMode: "air",
  gateOn: "gate", gateRate: "gate", gateDepth: "gate", gateSteps: "gate",
  gatePattern: "gate", gateSmooth: "gate", gateDest: "gate",
  harmonyMode: "harmony", harmonyLevel: "harmony",
  harmonyVoiceLead: "harmony", harmonyLow: "harmony", harmonyHigh: "harmony",
  chordMemoryOn: "chord", chordIntervals: "chord", chordMode: "chord",
  macro1: "macros", macro2: "macros", macro3: "macros", macro4: "macros",
  macroResponse: "macros",
  humanizeOn: "human", humanizeTiming: "human", humanizeVelocity: "human",
  humanizeSeed: "human", humanizeSeedMode: "human",
  humanizeProtectDownbeats: "human",
  scaleLock: "scale", scaleMode: "scale", scaleFollowers: "scale",
};

/** Module that owns a parameter, or null when the parameter is always live. */
export function moduleOwningParam(key: keyof FirePatch): FireManagedModule | null {
  return PARAM_OWNER[key] ?? null;
}

const on = (v: number | undefined, eps = 0.0005): boolean =>
  typeof v === "number" && Math.abs(v) > eps;

function activeRoutes(p: FirePatch): ModRoute[] {
  if (!Array.isArray(p.modMatrix)) return [];
  return p.modMatrix.filter(
    (r) => r && r.source !== "none" && r.dest !== "none" && Math.abs(r.amount ?? 0) > 0.001,
  );
}

/** Reserved for future context the predicate can't read off the patch. */
export interface UsageOpts {
  [key: string]: unknown;
}

/**
 * The set of managed modules this patch genuinely uses. Core and unmanaged
 * modules are not included (they are never slept by these helpers).
 */
export function usedModules(p: FirePatch, opts: UsageOpts = {}): Set<FireManagedModule> {
  const used = new Set<FireManagedModule>();
  const add = (id: FireManagedModule, cond: boolean) => {
    if (cond) used.add(id);
  };

  const routes = activeRoutes(p);
  const matrixLive = routes.length > 0;
  const routeSrc = (name: string) => matrixLive && routes.some((r) => r.source === name);
  const routeDest = (...names: string[]) =>
    matrixLive && routes.some((r) => names.includes(r.dest));

  // ── Sources ──
  add("osc.b",
    on(p.oscBLevel) || on(p.fmAtoB) || on(p.fmBtoA)
    || (p.oscBInherit ?? "off") !== "off" || !!p.oscBPhaseLock
    || routeDest("levelB", "wtB"));
  add("osc.c", on(p.oscCLevel) || routeDest("levelC", "wtC"));
  add("sub", on(p.subLevel));
  add("noise", on(p.noiseLevel));
  add("chip",
    !!p.hardSync || !!p.slideOn || on(p.accentAmount)
    || (p.chipVoiceLimit ?? 0) > 0
    || (p.chipNoise ?? "white") !== "white"
    || Math.abs((p.pulseDuty ?? 0.5) - 0.5) > 0.005);
  add("fire.sec.warp",
    (p.warpMode ?? "classic") !== "classic"
    || (on(p.warpStretch) || on(p.warpTilt) || on(p.warpComb)));

  // ── Tone ──
  add("mixer.unison", (p.unison ?? 1) > 1);
  add("env.filt", on(p.filterEnvAmount) || on(p.filterEnvResoAmount));
  add("pluck", !!p.lpgOn);
  add("analog.life",
    on(p.drift) || on(p.voiceInstability) || on(p.tuneVariance)
    || on(p.envVariance) || on(p.analogWake) || on(p.analogEvents));

  // ── Modulation ──
  add("lfo.1",
    (on(p.lfo1Depth) && (p.lfo1Dest ?? "off") !== "off") || routeSrc("lfo1"));
  add("lfo.2",
    (on(p.lfo2Depth) && (p.lfo2Dest ?? "off") !== "off") || routeSrc("lfo2"));
  add("fm", on(p.fmAmount) || on(p.ringAmount) || on(p.fmBtoA) || on(p.fmAtoB));
  add("fm.rack", (p.fmEngine ?? "classic") === "ops4");
  add("pitch", on(p.pitchEnvAmount, 0.01) || on(p.glide, 0.002));
  add("matrix", matrixLive);
  add("env.mod", !!p.modEnvLoop || routeSrc("modenv"));

  // ── FX ──
  add("fx.drive", on(p.drive) || on(p.crush));
  add("fx.delay", on(p.delayMix) || !!p.delayFreeze || routeDest("delay"));
  add("fx.reverb", on(p.reverbMix) || !!p.reverbFreeze || routeDest("reverb"));
  add("fx.chorus", on(p.chorusMix) || routeDest("chorusMix"));
  add("fx.phaser", on(p.phaserMix) || routeDest("phaserMix"));
  add("fx.spectral",
    (p.spectralMode ?? "off") !== "off" && (on(p.spectralMix) || routeDest("spectral")));
  add("fx.vintage",
    on(p.cassetteGen) || on(p.tapeSpeed) || on(p.wowFlutter) || on(p.vhsColor)
    || (p.bitDepth ?? "off") !== "off" || on(p.sampleRateReduce)
    || on(p.bbdChorus) || on(p.analogComp) || on(p.dust) || on(p.hiss)
    || on(p.hum) || on(p.printThrough) || on(p.ageMacro) || on(p.ageEvolve));

  // ── Bus polish ──
  add("glue", on(p.punch) || !!p.glueUseAdvanced);
  add("width", Math.abs((p.stereoWidth ?? 1) - 1) > 0.01 || on(p.monoBelow, 0.5));
  add("air", on(p.airAmount));

  // ── Performance ──
  add("gate", !!p.gateOn);
  add("harmony", (p.harmonyMode ?? "off") !== "off");
  add("chord", !!p.chordMemoryOn);
  add("human", !!p.humanizeOn);
  add("scale", !!p.scaleLock);
  add("macros",
    on(p.macro1) || on(p.macro2) || on(p.macro3) || on(p.macro4)
    || routeSrc("macro1") || routeSrc("macro2") || routeSrc("macro3") || routeSrc("macro4"));

  return used;
}

/**
 * Sleep every managed module the patch does not use. Mutates `p`.
 * Returns the number of managed modules left awake.
 */
export function pruneUnusedModules(p: FirePatch, opts: UsageOpts = {}): number {
  const used = usedModules(p, opts);
  const enable: Record<string, boolean> = { ...(p.moduleEnable ?? {}) };
  for (const id of FIRE_MODULE_PRIORITY) {
    if (used.has(id)) delete enable[id];
    else enable[id] = false;
  }
  // A slept module must never leave the core asleep with it.
  for (const id of FIRE_CORE_MODULES) delete enable[id];
  p.moduleEnable = enable;
  return used.size;
}

/**
 * Prune, then enforce a hard budget of simultaneously-active modules by
 * sleeping the lowest-priority ones. `limit` counts EVERY awake module,
 * including the always-on core. Mutates `p`; returns the awake managed list.
 */
export function capActiveModules(
  p: FirePatch,
  limit: number,
  opts: UsageOpts = {},
): FireManagedModule[] {
  pruneUnusedModules(p, opts);
  const budget = Math.max(0, limit - FIRE_CORE_MODULES.length);
  const awake = FIRE_MODULE_PRIORITY.filter((id) => p.moduleEnable?.[id] !== false);
  if (awake.length <= budget) return awake;
  const keep = awake.slice(0, budget);
  const enable: Record<string, boolean> = { ...(p.moduleEnable ?? {}) };
  for (const id of awake.slice(budget)) enable[id] = false;
  p.moduleEnable = enable;
  return keep;
}

/** Count of awake modules across the whole atlas (core + managed + unmanaged). */
export function activeModuleCount(p: FirePatch, totalModules: number): number {
  const off = Object.values(p.moduleEnable ?? {}).filter((v) => v === false).length;
  return Math.max(0, totalModules - off);
}
