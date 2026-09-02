/**
 * FireCommandSynth — a wavetable software synthesiser for Fire Command, aimed
 * "in the direction of" Serum/Massive: morphing wavetable oscillators, deep
 * modulation (two LFOs + a wavetable-morphing mod-envelope), unison, and a
 * full stereo FX bus (drive, crush, ring, chorus, ping-pong delay, reverb).
 * Its master output sums into the AudioEngine `inputBus`, so it flows through
 * the same downstream chain as music (EQ, FX, spatializer, limiter) unless the
 * global bypass ("FX: OFF") is engaged.
 *
 * Wavetable playback keeps CPU in check via pitch-mip × subframe `PeriodicWave`
 * banks. At high Continuity, each unison slot dual-crossfades adjacent frames
 * (linear / amplitude-preserving — frames are correlated); Continuity → 0 keeps
 * the coarse snap character.
 */

import {
  WAVETABLE_IDS,
  SUBFRAMES,
  NUM_PARTIALS,
  MIP_PARTIALS,
  harmonicsAt,
  loudnessGain,
  mipLevelForFreq,
  applyWarp,
  type WarpMode,
} from "./wavetables";
import { isArpKeepAlive, isHotArp, getArpStepSec } from "@/audio/arpKeepAlive";
import { FireVintageAge } from "./FireVintageAge";
import { punchMacroToGlue, type GlueMode, type MasterChainScene } from "./mixClarity";
import {
  type AmpModel,
  type AmpRetrigger,
  type EnvCurve,
  type FilterCarveMode,
  type FilterDrivePos,
  type FilterModel,
  type FilterSlope,
  type LpgModel,
  type ModEnvPoint,
  type ToneVoiceTelemetry,
  type UnisonDistribution,
  type UnisonPhaseMode,
  type UnisonTemporalMode,
  adsrToModEnvPoints,
  evalModEnvHeld,
  evalModEnvRelease,
  idleTelemetry,
  lpgModelTimes,
  normalizeModEnvPoints,
  unisonDelaySec,
  unisonPhaseOffsets,
  unisonPositions,
  voiceIdentityUnit,
} from "./toneDifferentiation";

export type {
  AmpModel,
  AmpRetrigger,
  EnvCurve,
  FilterCarveMode,
  FilterDrivePos,
  FilterModel,
  FilterSlope,
  LpgModel,
  ModEnvPoint,
  ToneEnvTelemetry,
  ToneVoiceTelemetry,
  UnisonDistribution,
  UnisonPhaseMode,
  UnisonTemporalMode,
} from "./toneDifferentiation";
export type { WarpMode } from "./wavetables";

/** Valid wavetable ids — unknown ids fall back to "saw". */
const WAVETABLE_ID_SET = new Set<string>(WAVETABLE_IDS);

/** Spectral warp settings a warped bank is rendered against. */
type WarpSpec = { stretch: number; tilt: number; comb: number; mode: WarpMode };

/** Sample&hold step edge time — short enough to read as a step, long enough not to click. */
const SH_SLEW_SEC = 0.0015;

/** Phaser feedback ceiling — loop peak stays near +11 dB instead of +20 dB. */
const PHASER_FB_CEIL = 0.72;

/** S-curve glide: fixed smoothstep table + one reusable curve buffer. */
const GLIDE_CURVE_N = 16;
const SMOOTHSTEP_LUT = (() => {
  const a = new Float32Array(GLIDE_CURVE_N);
  for (let i = 0; i < GLIDE_CURVE_N; i++) {
    const u = i / (GLIDE_CURVE_N - 1);
    a[i] = u * u * (3 - 2 * u);
  }
  return a;
})();
const GLIDE_CURVE_SCRATCH = new Float32Array(GLIDE_CURVE_N);

export type FireFilterType = "lowpass" | "bandpass" | "highpass" | "notch";
export type SubWave = "sine" | "triangle" | "square" | "sawtooth";
export type LfoWave = "sine" | "triangle" | "sawtooth" | "square" | "sample-hold";
/** Live-input harmonizer companion mode (v1.7). */
export type HarmonyMode = "off" | "third" | "fifth" | "octave" | "triad";
/** Spectral FX unit mode (v1.7, STFT AudioWorklet). */
export type SpectralMode = "off" | "freeze" | "smear" | "gate" | "shift";
export type LfoDest = "off" | "pitch" | "filter" | "pan" | "volume";
export type DriveMode = "soft" | "tube" | "fold" | "hard" | "fuzz";
export type FireBitDepth = "off" | "12bit" | "8bit";
export type ChipNoiseMode = "white" | "nes" | "gb" | "periodic";
export type FmEngineMode = "classic" | "ops4";
/** Noise Grain Storm operating mode. */
export type NoiseMode = "bed" | "burst" | "storm";
/** Twin Voice continuous inheritance from Osc A. */
export type OscBInheritMode = "off" | "morph" | "mirror" | "offset" | "family" | "lock" | "fm";

// ── Modulation matrix ──
export type ModSource =
  | "none" | "lfo1" | "lfo2" | "modenv" | "velocity" | "keytrack"
  | "macro1" | "macro2" | "macro3" | "macro4" | "random";
export type ModDest =
  | "none" | "pitch" | "cutoff" | "resonance" | "wtA" | "wtB" | "wtC"
  | "levelA" | "levelB" | "levelC" | "fm" | "pan" | "volume" | "reverb" | "delay"
  | "chorusMix" | "phaserMix" | "drive" | "spectral";
export type FxQuality = "eco" | "live" | "high" | "render";
export type LowProtect = "off" | "80" | "120" | "200" | "custom";
export type DriveTonePos = "pre" | "post" | "both";
export type PhaserStereoMode = "linked" | "opposed" | "quadrature";
export type ChorusModel = "single" | "dual" | "triple" | "ensemble" | "dimension" | "tape";
export type DelayCascadeMode = "slap" | "echo" | "dub" | "bounce" | "long" | "infinite";
export type FxRoutingScene = "serial" | "driveAgePrint" | "spaceCascade" | "spectralTail";
/** Twin Orbit relationship of LFO2 relative to LFO1. */
export type Lfo2Relation = "independent" | "mirror" | "invert" | "phaseOffset" | "ratio" | "followLag";
export type Lfo2DriftMode = "locked" | "elastic" | "wandering";
export type GlideMode = "always" | "legato";
export type GlideCurve = "linear" | "exp" | "s";
export type GlideRateMode = "time" | "rate";
export type RingMode = "ratio" | "fixed";
export type LfoRateDisplay = "hz" | "sync";
/** Mini-state stored at a Vector Lattice pad corner. */
export interface FmVectorCorner {
  levels: [number, number, number, number];
  ratios: [number, number, number];
  feedback: number;
}
export interface ModRoute {
  source: ModSource;
  dest: ModDest;
  amount: number;
  /** Flip polarity after reading the source. */
  invert?: boolean;
  /** Map bipolar −1..1 sources into 0..1 before scaling. */
  unipolar?: boolean;
  /** 0..1 slew / smooth on the route contribution. */
  smooth?: number;
  /** Response curve applied to |source| before polarity. */
  curve?: "linear" | "exp" | "log" | "invert";
}
// MK IV: 8 → 12 slots. makeModMatrix pads shorter (legacy) matrices with
// inert routes, so every persisted patch/preset loads unchanged.
export const MOD_SLOTS = 12;
/** Build a fixed-length (MOD_SLOTS) matrix, padding/truncating as needed. */
export function makeModMatrix(routes: ModRoute[] = []): ModRoute[] {
  const out: ModRoute[] = [];
  for (let i = 0; i < MOD_SLOTS; i++) {
    const r = routes[i];
    const sm = typeof r?.smooth === "number" ? Math.max(0, Math.min(1, r.smooth)) : 0;
    const curve = r?.curve === "exp" || r?.curve === "log" || r?.curve === "invert" ? r.curve : "linear";
    out.push(
      r
        ? {
            source: r.source,
            dest: r.dest,
            amount: r.amount,
            invert: !!r.invert,
            unipolar: !!r.unipolar,
            smooth: sm,
            curve,
          }
        : { source: "none", dest: "none", amount: 0, invert: false, unipolar: false, smooth: 0, curve: "linear" },
    );
  }
  return out;
}

/** Apply route polarity / curve transforms to a raw bipolar source sample. */
export function applyRouteSource(raw: number, r: ModRoute): number {
  let s = raw;
  if (r.unipolar) s = (s + 1) * 0.5;
  const curve = r.curve ?? "linear";
  if (curve !== "linear") {
    const sign = s < 0 ? -1 : 1;
    let mag = Math.min(1, Math.abs(s));
    if (curve === "exp") mag = mag * mag;
    else if (curve === "log") mag = Math.sqrt(mag);
    else if (curve === "invert") mag = 1 - mag;
    s = sign * mag;
  }
  if (r.invert) s = -s;
  return s;
}

export interface FirePatch {
  // ── Oscillator A (wavetable) ──
  oscATable: string;
  oscAPos: number; // 0..1 morph
  oscAEnv: number; // -1..1 mod-env → morph
  oscALfo: number; // -1..1 LFO1 → morph
  oscAOctave: number;
  oscADetune: number;
  oscALevel: number;
  /**
   * 0..1 Prime Voice Continuity.
   * Low = discrete frame snaps (glitchy table steps).
   * High = full subframe morph resolution (smooth interpolation character).
   */
  oscAContinuity: number;
  // ── Oscillator B (wavetable) ──
  oscBTable: string;
  oscBPos: number;
  oscBEnv: number;
  oscBLfo: number;
  oscBOctave: number;
  oscBDetune: number;
  oscBLevel: number;
  /** Continuous Twin inheritance from A (morph / lock / FM…). */
  oscBInherit: OscBInheritMode;
  /** When true (or inherit=lock), B tracks A's frequency base (phase-lock feel). */
  oscBPhaseLock: boolean;
  /** 0..1 — osc A's audio frequency-modulates osc B (Twin FM from Prime). */
  fmAtoB: number;
  // ── Oscillator C (wavetable) ──
  oscCTable: string;
  oscCPos: number;
  oscCEnv: number;
  oscCLfo: number;
  oscCOctave: number;
  oscCDetune: number;
  oscCLevel: number;
  // ── Spectral warps (v1.7): shared across all three wavetable oscillators ──
  /** -1..1 stretch/compress of the harmonic series (0 = off). */
  warpStretch: number;
  /** -1..1 even/odd harmonic tilt (0 = off). */
  warpTilt: number;
  /** 0..1 periodic comb notching across the harmonics (0 = off). */
  warpComb: number;
  /**
   * -1..1 Forge master amount.
   * Scales Stretch/Tilt/Comb (negative = inverse transform). 0 = bypass.
   */
  warpAmount: number;
  /** PeriodicWave-legal warp species (classic / scramble / subharmonic / brickwall). */
  warpMode: WarpMode;
  // ── Unison ──
  unison: number;
  unisonDetune: number;
  unisonWidth: number;
  /** Mix of generated choir vs anchor/center (0 = dry center, 1 = full choir). */
  unisonMix: number;
  /** Keep center partial locked (tune/pan/delay). */
  unisonAnchor: boolean;
  unisonDistribution: UnisonDistribution;
  unisonPhase: UnisonPhaseMode;
  /** 0..0.05 seconds max per-voice start delay. */
  unisonTemporalSpread: number;
  unisonTemporalMode: UnisonTemporalMode;
  /** 0..1 spread amp/filt envelope timing across choir partials (via note jitter). */
  unisonEnvSpread: number;
  // ── Sub + Noise ──
  subWave: SubWave;
  subLevel: number;
  /** Align Sub start/detune with Prime (protected foundation lock). */
  subPhaseAlign: boolean;
  /** 0..1 upper-harmonic translation for small-speaker audibility. */
  subTranslate: number;
  noiseLevel: number;
  /** -1..1 noise tilt: -1 = dark rumble (LP 350 Hz), 0 = white, +1 = airy hiss (HP 6 kHz). */
  noiseColor: number;
  /** Grain Storm operating mode. */
  noiseMode: NoiseMode;
  /** 0..1 storm/burst event density. */
  noiseDensity: number;
  /** 0..1 grain duration / hold (storm) or burst body. */
  noiseGrain: number;
  // ── FM + Ring ──
  fmAmount: number;
  fmRatio: number;
  /** 0..1 — osc B's audio output frequency-modulates osc A (2-op cross FM). */
  fmBtoA: number;
  ringAmount: number;
  ringFreq: number;
  // ── Filter ──
  filterType: FireFilterType;
  /** Eco/default = biquad cascade; ladder/svf = bite worklet when loaded. */
  filterModel: FilterModel;
  filterCutoff: number;
  filterResonance: number;
  filterEnvAmount: number;
  /** -1..1 filter-envelope → resonance depth. */
  filterEnvResoAmount: number;
  filterKeyTrack: number;
  /** 0..1 per-voice post-filter saturation (0 = clean, exactly current behavior). */
  filterDrive: number;
  filterDrivePos: FilterDrivePos;
  /** Cascaded biquad count (1=12dB, 2=24dB, 3=36dB-ish). */
  filterSlope: FilterSlope;
  filterCarve: FilterCarveMode;
  /** 0..1 carve intensity. */
  filterCarveAmount: number;
  // ── Amp ADSR ──
  ampAttack: number;
  ampDecay: number;
  ampSustain: number;
  ampRelease: number;
  /** 0..1 velocity → amp depth. 1 = full tracking (legacy behavior), 0 = fixed level. */
  velAmount: number;
  /** Velocity → attack time shortening (0 = off). */
  velAttack: number;
  ampModel: AmpModel;
  ampCurveAttack: EnvCurve;
  ampCurveDecay: EnvCurve;
  ampCurveRelease: EnvCurve;
  ampRetrigger: AmpRetrigger;
  /** Optional hold after attack (seconds). */
  ampHold: number;
  /** 0..1 punch overshoot above peak. */
  ampOvershoot: number;
  // ── Lowpass gate (v1.7, Aalto-style vactrol) ──
  /** LPG mode replaces the amp/filter ADSR with a struck vactrol envelope. */
  lpgOn: boolean;
  /** Ring-out time of the strike, seconds (0.05..2.5). */
  lpgDecay: number;
  /** 0..1 — how much the gate colors the tone (drives cutoff with the strike). */
  lpgColor: number;
  lpgModel: LpgModel;
  /** 0..1 strike excitation amount. */
  lpgStrike: number;
  /** 0..1 body ring persistence (scales decay). */
  lpgRing: number;
  /** 0..1 residual leakage after ring. */
  lpgLeakage: number;
  /** Choke previous strike on re-trigger. */
  lpgChoke: boolean;
  /** 0..1 excite filter resonance / noise burst into filter. */
  lpgResoCouple: number;
  // ── Filter ADSR ──
  filtAttack: number;
  filtDecay: number;
  filtSustain: number;
  filtRelease: number;
  filtCurveAttack: EnvCurve;
  filtCurveDecay: EnvCurve;
  filtCurveRelease: EnvCurve;
  // ── Mod envelope (morph/timbre) — ADSR mirrors + MSEG ──
  modAttack: number;
  modDecay: number;
  modSustain: number;
  modRelease: number;
  modEnvPoints: ModEnvPoint[];
  modEnvSustainIndex: number;
  modEnvLoop: boolean;
  // ── LFO 1 ──
  lfo1Wave: LfoWave;
  lfo1Rate: number;
  lfo1Depth: number;
  lfo1Dest: LfoDest;
  /** UI rate readout: free Hz vs musical sync hint. */
  lfo1RateDisplay: LfoRateDisplay;
  // ── LFO 2 ──
  lfo2Wave: LfoWave;
  lfo2Rate: number;
  lfo2Depth: number;
  lfo2Dest: LfoDest;
  lfo2RateDisplay: LfoRateDisplay;
  /** Twin Orbit relationship to LFO 1. */
  lfo2Relation: Lfo2Relation;
  /** Degrees when relation is phaseOffset (0/45/90/180/270). */
  lfo2PhaseOffset: number;
  /** Rate multiplier vs LFO1 when relation is ratio (e.g. 0.5, 2). */
  lfo2Ratio: number;
  /** Slow wander of offset/ratio within Twin Orbit. */
  lfo2DriftMode: Lfo2DriftMode;
  // ── Pitch env + voice ──
  pitchEnvAmount: number;
  pitchEnvTime: number;
  mono: boolean;
  glide: number;
  glideMode: GlideMode;
  glideCurve: GlideCurve;
  glideRateMode: GlideRateMode;
  // ── Harmonizer (v1.7): scale-locked companion notes on live input ──
  harmonyMode: HarmonyMode;
  /** 0..1 velocity scale on the companion notes. */
  harmonyLevel: number;
  // ── Drive / Crush / Tone / Punch ──
  drive: number;
  driveMode: DriveMode;
  crush: number;
  tone: number;
  punch: number;
  /** Glue / Press Anvil — Mix Clarity */
  glueInGain: number;
  glueOutGain: number;
  glueAutoGain: boolean;
  glueMode: import("./mixClarity").GlueMode;
  glueThreshold: number;
  glueRatio: number;
  glueAttack: number;
  glueRelease: number;
  glueKnee: number;
  glueMakeup: number;
  glueMix: number;
  glueUseAdvanced: boolean;
  mixDeltaAudition: boolean;
  masterChainScene: import("./mixClarity").MasterChainScene;
  /** Drive input trim (linear gain 0..2, 1 = unity). */
  driveInGain: number;
  /** Drive output trim. */
  driveOutGain: number;
  /** Compensate perceived loudness after drive. */
  driveAutoGain: boolean;
  /** Bias (−1..1) for asymmetric transfer. */
  driveBias: number;
  /** Symmetry (−1..1) even/odd balance tilt. */
  driveSymmetry: number;
  /** DC blocker after drive. */
  driveDcBlock: boolean;
  /** Where Tone LPF sits relative to drive. */
  driveTonePos: DriveTonePos;
  // ── Phaser ──
  phaserRate: number;
  phaserDepth: number;
  phaserMix: number;
  phaserStages: number;
  phaserFeedback: number;
  phaserCenter: number;
  phaserStereo: PhaserStereoMode;
  // ── Chorus + Delay ──
  chorusRate: number;
  chorusDepth: number;
  chorusMix: number;
  chorusVoices: number;
  chorusDelay: number;
  chorusSpread: number;
  chorusModel: ChorusModel;
  chorusLowCut: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  delaySync: boolean;
  delayCascadeMode: DelayCascadeMode;
  delayDuck: number;
  delayFbFilter: number;
  delayFbDrive: number;
  delayFreeze: boolean;
  // ── Reverb ──
  reverbSize: number;
  reverbMix: number;
  /** 0..1 — high-frequency damping in the IR (0 = bright, 1 = dark). */
  reverbDamp: number;
  /** 0..0.2 — wet-path pre-delay seconds. */
  reverbPredelay: number;
  /** 0..1 — early/dense diffusion character. */
  reverbDiffusion: number;
  reverbEarly: number;
  reverbLowDecay: number;
  reverbHighCut: number;
  reverbFreeze: boolean;
  // ── Signal Path rack enables (v3.0.1) — true = stage engaged ──
  pathOsc: boolean;
  pathFilter: boolean;
  pathDrive: boolean;
  pathAge: boolean;
  pathFx: boolean;
  pathMix: boolean;
  pathScope: boolean;
  // ── Spectral FX (v1.7): STFT worklet between reverb and autopan ──
  spectralMode: SpectralMode;
  /** 0..1 mode intensity (freeze hold, smear time, gate threshold, shift ±). */
  spectralAmount: number;
  /** 0..1 dry/wet, latency-matched inside the worklet. 0 = hard bypass. */
  spectralMix: number;
  spectralLow: number;
  spectralHigh: number;
  spectralFftSize: number;
  // ── FX Clarity rack-wide ──
  fxQuality: FxQuality;
  lowProtect: LowProtect;
  lowProtectHz: number;
  /** Audition wet−dry delta on supported FX. */
  fxDeltaAudition: boolean;
  ageInGain: number;
  ageOutGain: number;
  reverbInGain: number;
  reverbOutGain: number;
  spectralInGain: number;
  spectralOutGain: number;
  /** Oxide Archive group locks (true = lock against AGE macro / randomize). */
  ageLockMedium: boolean;
  ageLockMotion: boolean;
  ageLockWear: boolean;
  ageLockResolution: boolean;
  ageMacro: number;
  ageEvolve: number;
  /** Shared Phaser↔Chorus LFO link. */
  fxSharedMod: boolean;
  fxRoutingScene: FxRoutingScene;
  /** Spectral processes only wet delay/reverb when true (Phase 6 tap). */
  spectralWetOnly: boolean;
  // ── Macros ──
  macro1: number;
  macro2: number;
  macro3: number;
  macro4: number;
  // ── Modulation matrix ──
  modMatrix: ModRoute[];
  // ── Analog drift / life (Genesis) ──
  drift: number;
  /** 0..1 — stronger random wander rate companion to drift. */
  driftRate: number;
  /** 0..1 — continuous per-voice pitch instability. */
  voiceInstability: number;
  /** 0..1 — static per-note cents offset at note-on. */
  tuneVariance: number;
  /** 0..1 — per-note ADSR time jitter. */
  envVariance: number;
  /** Integer DNA seed for persistent voice personalities. */
  analogDnaSeed: number;
  /** Lock DNA against mutation. */
  analogDnaLock: boolean;
  /** 0..1 warm-up / wake instability that converges while playing. */
  analogWake: number;
  /** Relative scale for tremor / breath / climate time layers (Rate still master). */
  analogTremor: number;
  analogBreath: number;
  analogClimate: number;
  /** 0..1 occasional irregular event probability. */
  analogEvents: number;
  // ── Vintage Age bus (Genesis) ──
  cassetteGen: number;
  /** -1..1 variable tape speed. */
  tapeSpeed: number;
  wowFlutter: number;
  vhsColor: number;
  bitDepth: FireBitDepth;
  sampleRateReduce: number;
  bbdChorus: number;
  analogComp: number;
  dust: number;
  hiss: number;
  hum: number;
  printThrough: number;
  // ── Chip / Acid (Genesis v2.9) ──
  /** 0..1 pulse width (0.5 = square). */
  pulseDuty: number;
  /** Hard sync: osc B resets osc A phase. */
  hardSync: boolean;
  /** Chip noise character: white | nes | gb | periodic. */
  chipNoise: ChipNoiseMode;
  /** Optional low polyphony for chip authenticity (0 = use maxVoices). */
  chipVoiceLimit: number;
  /** Velocity → accent (filter+amp boost) for acid-style lines. */
  accentAmount: number;
  /** Legato extends glide (slide) in mono mode. */
  slideOn: boolean;
  /**
   * 0..1 Chip↔Acid personality blend.
   * 0 = Chip (clocked pulse / grit / voice limits).
   * 1 = Acid (slide / accent / sync punch).
   */
  chipAcidMix: number;
  // ── FM Rack / Vector (Genesis v3.0) ──
  fmEngine: FmEngineMode;
  fmAlg: number; // 0..7 algorithm index
  fmOp1Level: number;
  fmOp2Level: number;
  fmOp3Level: number;
  fmOp4Level: number;
  fmOp2Ratio: number;
  fmOp3Ratio: number;
  fmOp4Ratio: number;
  fmFeedback: number;
  /** Slow XY vector motion on osc A/B wavetable positions. */
  vectorRate: number;
  vectorDepth: number;
  /** Ring modulator: ratio of carrier vs absolute Hz. */
  ringMode: RingMode;
  /** Vector Lattice pad corners (NW, NE, SW, SE). */
  fmVectorCorners: FmVectorCorner[];
  /** Active pad morph X/Y 0..1. */
  fmVectorX: number;
  fmVectorY: number;
  // ── Stereo width (bus mid/side) ──
  /** 0 = mono, 1 = untouched (legacy behavior), up to 1.4 = extra-wide sides. */
  stereoWidth: number;
  widthInGain: number;
  widthOutGain: number;
  /** Mono-below frequency for side channel (0 = off). */
  monoBelow: number;
  widthMechanism: import("./mixClarity").WidthMechanism;
  widthCorrWarn: number;
  // ── Trance gate ──
  gateOn: boolean;
  gateRate: number;   // steps per second
  gateDepth: number;  // 0..1, how deep closed steps cut
  gateSteps: number;  // 2..16 active steps
  /** Length 16; each step 0..1 open amount (legacy 0/1 still works). */
  gatePattern: number[];
  /** 0..1 edge softness — 0 = hard chop (legacy), 1 = pumping swells. UI: Edge. */
  gateSmooth: number;
  /** Gate destination — volume bus or live velocity scale. */
  gateDest: "volume" | "velocity";
  // ── Master ──
  masterGain: number;
  // ── v3.0.2 module fill ──
  /** Sub oscillator octave offset (−2..0). */
  subOctave: number;
  /** Bus air — low shelf gain in dB-ish (−1..1). */
  airLow: number;
  /** Bus air — high shelf gain (−1..1). */
  airHigh: number;
  /** 0..1 wet amount for air shelves (0 = bypass). */
  airAmount: number;
  airInGain: number;
  airOutGain: number;
  airArch: import("./mixClarity").AirArch;
  airMsMode: boolean;
  /** Scope display amplitude (does not change output). */
  scopeDisplayGain: number;
  voiceSteal: import("./mixClarity").VoiceStealPolicy;
  ceaseMode: import("./mixClarity").CeaseMode;
  /** Live scale-lock (snap played notes to sequencer scale). Legacy; prefer scaleMode. */
  scaleLock: boolean;
  /** Correction mode: guide=no change, soft=snap, strict=reject, fold=wrap. */
  scaleMode: "guide" | "soft" | "strict" | "fold";
  /** Which systems follow Key Lattice. */
  scaleFollowers: { harmony: boolean; chord: boolean; arp: boolean; pianoRoll: boolean };
  /** Chord memory: fire stored intervals with each key. */
  chordMemoryOn: boolean;
  /** Builder constructs intervals; Memory learns/replays. */
  chordMode: "builder" | "memory";
  /** Relative semis from the played root, e.g. [0, 4, 7]. */
  chordIntervals: number[];
  /** Sequencer / live humanize enable. */
  humanizeOn: boolean;
  /** 0..1 timing jitter strength. */
  humanizeTiming: number;
  /** 0..1 velocity jitter strength. */
  humanizeVelocity: number;
  /** Deterministic seed for humanize PRNG. */
  humanizeSeed: number;
  humanizeSeedMode: "fixed" | "perPlay";
  /** Skip jitter on bar downbeats (step % 16 === 0). */
  humanizeProtectDownbeats: boolean;
  /** Macro response when read as mod sources. */
  macroResponse: "absolute" | "relative" | "bipolar" | "smoothed";
  /** Kin Halo voice leading. */
  harmonyVoiceLead: "parallel" | "nearest" | "scale";
  harmonyLow: number;
  harmonyHigh: number;
  /**
   * Per-module enable map. Missing key = on; `false` = bypassed.
   * Keys match fireModuleAtlas module ids.
   */
  moduleEnable: Record<string, boolean>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MAX_UNISON = 16;
/** Hard ceiling on live filter Q — power-user bite path (was 3.5). */
const FILTER_Q_CEIL = 18;

/**
 * Soft unison ceiling for live voices. Extreme user presets (unison 16 +
 * spectral + ops4) used to spin ~48 PeriodicWaves on a single mono note.
 */
function liveUnisonCap(p: FirePatch): number {
  const spectralOn = (p.spectralMode ?? "off") !== "off" && (p.spectralMix ?? 0) > 0.05;
  const ops4 = (p.fmEngine ?? "classic") === "ops4";
  const groups = 2 + ((p.oscCLevel ?? 0) > 0.0001 ? 1 : 0);
  const dualMorph = (p.oscAContinuity ?? 0) > 0.45;
  const workletFilt = (p.filterModel ?? "biquad") !== "biquad" && (p.fxQuality ?? "live") !== "eco";
  const heavyFx =
    (p.crush ?? 0) > 0.45
    || p.chorusModel === "triple"
    || p.chorusModel === "ensemble"
    || (p.reverbMix ?? 0) > 0.4
    || (p.phaserMix ?? 0) > 0.45;
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

function liveFilterQ(base: number, extra = 0): number {
  return clamp(base + extra, 0.0001, FILTER_Q_CEIL);
}

/**
 * Unison level trim.
 *
 * Perceived loudness of a stack tracks its RMS, which sums as 1/√N once the
 * voices decorrelate — so 1/√N is the body-correct trim and what makes a
 * supersaw sound fat. The only case that genuinely peaks ~N (and needs 1/N to
 * stay clip-safe) is a TRULY coherent stack: `locked` phase with negligible
 * detune. Real supersaws always carry detune, so we blend from 1/N → 1/√N as
 * detune grows, restoring the body a flat 1/N was stealing from locked stacks.
 */
export function unisonLevelNorm(
  count: number,
  phase: UnisonPhaseMode,
  detuneCents = 0,
): number {
  const n = Math.max(1, count | 0);
  if (n <= 1) return 1;
  const energy = 1 / Math.sqrt(n);
  if (phase !== "locked") return energy;
  // ~6 cents of spread is enough to fully decorrelate the onset.
  const decorr = Math.min(1, Math.abs(detuneCents) / 6);
  const coherent = 1 / n;
  return coherent + (energy - coherent) * decorr;
}

/**
 * Dual-frame morph gains. Adjacent frames are correlated — linear keeps
 * peak ≤ 1 when frames match (equal-power would boost mid-crossfade by √2).
 */
export function morphFrameGains(frac: number): { g0: number; g1: number } {
  const f = Math.max(0, Math.min(1, frac));
  return { g0: 1 - f, g1: f };
}

/** Pre-filter trim as Q rises so bite stays audible without resonant blowups. */
export function filterResoCompGain(q: number): number {
  const excess = Math.max(0, q - 0.707);
  // Was 0.1 — too aggressive; scream-Q patches lost the character users dialed.
  return 1 / (1 + excess * 0.065);
}

/**
 * Minimum amp attack (seconds). Sub‑2 ms linear ramps are ~44–88 samples at
 * 44.1 kHz — perceived as a hard step / click at note onset. 4 ms (~176
 * samples) is short enough to stay snappy and long enough to declick.
 */
export const MIN_AMP_ATTACK_SEC = 0.004;

/** Pre-filter soft-start so PeriodicWave/filter don't see a hard edge before the VCA opens. */
export const VOICE_DECLICK_SEC = 0.0035;

/**
 * Fixed headroom trim on the voice-summing bus.
 *
 * ROOT CAUSE (clipping, part 1): a single default-patch voice already peaks
 * well above full scale BEFORE the filter — oscA 0.75 + oscB 0.5 + sub 0.3
 * ≈ 1.55 (unison normalization keeps each group at its level, it doesn't
 * shrink the A+B+C+sub sum). A WaveShaper's transfer curve only spans input
 * [-1, 1]; anything hotter is clamped to the curve's endpoints, i.e. HARD
 * clipped. So even a 2–3 note chord used to overload the drive shaper and
 * distort audibly. Halving the bus puts single notes and small chords back
 * inside the shaper's (mostly) linear region.
 *
 * WORST-CASE GAIN-STAGING MATH (full synth path, all bounds independent of
 * user settings):
 *   · one voice, pre-filter: 3 osc groups ≤ √7·level(≤1) ≈ 2.65 each at a
 *     coherent unison onset, + sub 1 + noise 1 → ≤ ~9.9 pathological; the
 *     per-voice filter-drive shaper then hard-bounds every voice at
 *     ±CLIP_RANGE (=3), and at any filterDrive > 0.33 at ≤ 1.
 *   · voice sum: N voices × 3 × VOICE_HEADROOM(0.5) × polyComp √(4/N)
 *     → 12 voices ≤ 10.4 aligned (realistic default-patch chords ≈ 3.1).
 *   · drive stage: input ×(1+1.2·drive)/DRIVE_RANGE, transfer evaluated
 *     over ±DRIVE_RANGE(2) → absorbs ≤ 2× over-range smoothly, output
 *     ≤ max(|curve|) ≤ DRIVE_RANGE, then ×1/(1+0.7·drive).
 *   · FX tail worst cases: chorus ≤ 1.5×, phaser ≤ ~3.2× (fb 0.55),
 *     ping-pong delay ≤ 1 + mix/(1−0.92) ≈ 13.5× sustained-input asymptote,
 *     punch comp ≤ +2.3 dB manual makeup on top of DynamicsCompressor's
 *     auto-makeup — ALL of it lands in…
 *   · …master (≤1.2, mod-vol ≤1.4) → clipPre 1/3 → soft-clip knee: identity
 *     to 0.7, tanh shoulder, ceiling 0.98. Synth output ≤ 0.98 (-0.18 dBFS)
 *     BY CONSTRUCTION, for any patch, any polyphony, any FX setting.
 */
const VOICE_HEADROOM = 0.5;

/**
 * Over-range padding for the output soft-clipper (see makeSoftClipCurve).
 * The signal is attenuated by 1/CLIP_RANGE going into the shaper and the
 * curve bakes the ×CLIP_RANGE back in, so the clipper has CLIP_RANGE× of
 * genuine input range to absorb smoothly instead of hard-clamping at ±1.
 */
const CLIP_RANGE = 3;

/**
 * Over-range padding for the DRIVE shaper.
 *
 * ROOT CAUSE (clipping, part 5): a WaveShaper's transfer curve only spans
 * input [-1, 1] — anything hotter reads the curve's endpoint, i.e. HARD
 * clips, no matter how gentle the curve itself is. The voice bus routinely
 * lands here above 1 (e.g. default patch: 4 overlapping voices × ~1.55 peak
 * × 0.5 VOICE_HEADROOM ≈ 3.1 worst-case aligned) so chords sheared off flat
 * at the drive stage even with drive = 0. Padding the input by 1/DRIVE_RANGE
 * and evaluating the same transfer over ±DRIVE_RANGE keeps the transfer
 * IDENTICAL for in-range signals while doubling the range the stage absorbs
 * without hard-clamping.
 */
const DRIVE_RANGE = 2;

/**
 * Cap an FM / cross-mod frequency deviation (Hz) so the generated sidebands
 * stay mostly under Nyquist. Deviation scales with the note's base frequency
 * times large index multipliers, so high notes / high ratios could otherwise
 * push deviation far past Nyquist and alias into broadband digital hash.
 */
function clampFmDev(hz: number, sampleRate: number): number {
  return clamp(hz, 0, sampleRate * 0.33);
}

/**
 * Bound the A↔B cross-FM round trip.
 *
 * Both directions live is a real graph cycle (Chromium runs it with an implicit
 * one-render-quantum delay), so a high index in both directions self-oscillates
 * into broadband hash regardless of the per-direction Nyquist clamp. Cap the
 * round-trip index while keeping the balance the patch asked for.
 */
export const CROSS_FM_LOOP_MAX = 9;
export function boundCrossFm(devBtoA: number, devAtoB: number, f0: number): [number, number] {
  if (devBtoA <= 0 || devAtoB <= 0) return [devBtoA, devAtoB];
  const base = Math.max(1, f0);
  const loop = (devBtoA / base) * (devAtoB / base);
  if (loop <= CROSS_FM_LOOP_MAX) return [devBtoA, devAtoB];
  const s = Math.sqrt(CROSS_FM_LOOP_MAX / loop);
  return [devBtoA * s, devAtoB * s];
}

function makeDriveCurve(
  drive: number,
  mode: DriveMode = "soft",
  bias = 0,
  symmetry = 0,
): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  if (drive <= 0) {
    for (let i = 0; i < n; i++) curve[i] = ((i / (n - 1)) * 2 - 1) * DRIVE_RANGE;
    return curve;
  }
  const b = clamp(bias, -1, 1) * 0.35;
  const sym = clamp(symmetry, -1, 1);
  const shape = (xIn: number): number => {
    const x = xIn + b;
    let y: number;
    switch (mode) {
      case "tube": {
        const k = 1 + drive * 7;
        y = x >= 0 ? Math.tanh(k * x) : Math.tanh(k * (0.55 + sym * 0.25) * x);
        y /= Math.tanh(k);
        break;
      }
      case "fold": {
        const g = 1 + drive * (5 + Math.abs(sym) * 2);
        y = Math.sin(x * g * Math.PI * 0.5);
        if (sym > 0.2) y = Math.sin(y * Math.PI * (0.5 + sym * 0.4));
        break;
      }
      case "hard": {
        const g = 1 + drive * 9;
        const pos = clamp(x * g * (1 + sym * 0.3), -1, 1);
        const neg = clamp(x * g * (1 - sym * 0.3), -1, 1);
        y = x >= 0 ? pos : neg;
        break;
      }
      case "fuzz": {
        const k = 1 + drive * 22;
        y = Math.tanh(k * x);
        // Rectify-ish grit on positive half when symmetry high
        if (sym > 0.35 && x > 0) y = Math.abs(y);
        break;
      }
      case "soft":
      default: {
        const k = 1 + drive * 8;
        y = Math.tanh(k * x) / Math.tanh(k);
        break;
      }
    }
    return y;
  };
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * DRIVE_RANGE;
    curve[i] = clamp(shape(x), -1, 1);
  }
  return curve;
}

/**
 * Per-voice post-filter saturation curve (the "Filter Drive" knob).
 *
 * Evaluated over ±CLIP_RANGE (the voice pads by 1/CLIP_RANGE going in) so a
 * resonant filter peak can't hard-clamp at the shaper's input boundary.
 *
 * drive = 0 is the EXACT identity — zero tonal change for legacy patches —
 * and it still bounds a pathological voice at ±CLIP_RANGE. As drive rises,
 * the transfer crossfades into tanh(k·x) with a mild makeup that keeps the
 * ceiling ≤ 1/(0.55 + 0.45k) < 1, so a heavily driven voice actually hands
 * the summing bus LESS peak than a clean one. All voices share one curve
 * (the patch is global), cached on the synth.
 */
function makeFilterDriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const d = clamp(drive, 0, 1);
  const w = clamp(d * 3, 0, 1);
  const k = 1 + d * 6;
  const makeup = 1 / (0.55 + 0.45 * k);
  // ROOT CAUSE (clipping, part 7 — "Talking Bass"): at drive 0 this curve was
  // the pure identity over ±CLIP_RANGE, which still HARD-clamps at the curve
  // endpoints. A resonant filter peak (Q 6+ riding an LFO wobble over the
  // fundamental) routinely pushes a bass voice past ±CLIP_RANGE, so wobble
  // presets sheared off flat once per LFO cycle — heard as rhythmic crunch.
  // The clean transfer is now identity to 85% of the range with a tanh
  // shoulder into the same ±CLIP_RANGE bound: bit-identical for normal
  // levels, rounded instead of sheared for resonant overs.
  const knee = CLIP_RANGE * 0.85;
  const span = CLIP_RANGE - knee;
  const soft = (x: number): number => {
    const a = Math.abs(x);
    return a <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  };
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE;
    curve[i] = (1 - w) * soft(x) + w * Math.tanh(k * x) * makeup;
  }
  return curve;
}

/**
 * Delay feedback-path saturator.
 *
 * Small-signal slope is exactly unity, so the loop gain stays governed by the
 * feedback gain alone — no runaway however hard this is driven. Loud repeats
 * compress and grow harmonics instead, which is how tape / BBD echoes behave.
 */
export function makeFbDriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + clamp(drive, 0, 1) * 4;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / k;
  }
  return curve;
}

function makeCrushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const levels = Math.max(2, Math.pow(2, bits));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (Math.round(((x + 1) / 2) * (levels - 1)) / (levels - 1)) * 2 - 1;
  }
  return curve;
}

function makeSoftClipCurve(): Float32Array<ArrayBuffer> {
  // Final brickwall soft clipper at the synth output.
  //
  // ROOT CAUSE (clipping, part 2): the old curve was tanh(1.6·x)/tanh(1.6).
  // Normalizing by tanh(1.6)=0.92 gives the "linear body" a slope of ~1.74 —
  // the "gentle" clipper was actually a +4.8 dB BOOST that pushed the already
  // hot bus even harder into the downstream master limiter (heard as pumping
  // / "cut-out"). Worse, a WaveShaper hard-clamps anything outside ±1, so
  // peaks past full scale were sheared off flat, not rounded.
  //
  // ROOT CAUSE (clipping, part 6): the first fix (pure tanh(x) over a padded
  // ±CLIP_RANGE domain) was clip-SAFE but not clip-CLEAN: tanh compresses
  // from the very first millivolt (-0.9 dB and audible 3rd-harmonic haze at
  // a routine 0.6 peak), which listeners read as "the synth is always
  // slightly distorted". The curve is now a hinged knee: EXACT identity up
  // to ±0.7, then a smooth tanh shoulder that lands on a hard 0.98 ceiling.
  // Normal program level is bit-transparent; only genuine overs get rounded.
  // Combined with the 1/CLIP_RANGE pad (see clipPre) the stage absorbs
  // ±CLIP_RANGE of over-range smoothly, and output can never exceed 0.98
  // (-0.18 dBFS) — the synth hands the engine a DAC-safe signal by
  // construction.
  // Knee at 0.8 (was 0.7): with the Fire bus now guarded by a true lookahead
  // limiter instead of a DynamicsCompressor, this stage no longer needs to
  // start rounding so early. Program material below -1.9 dBFS passes
  // bit-exact; the shoulder only catches genuine synth-internal pile-ups
  // (FX-tail resonance, massive unison chords).
  const n = 8192;
  const curve = new Float32Array(n);
  const knee = 0.8;
  const span = 0.98 - knee; // shoulder height → ceiling asymptote 0.98
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  }
  return curve;
}

/**
 * Fixed makeup on the synth's final output (post soft-clip).
 *
 * ROOT CAUSE (washed-out / faded sound): the synth's internal headroom
 * budget (VOICE_HEADROOM 0.5 → master ≈0.72 → clipPre staging) is correct
 * for clip safety but lands a default single note at ≈0.3 peak — and the
 * engine then multiplied in part fader (0.85) × fireBus pad (0.58 → now
 * 0.85) × master fader (0.85) × output profile (−3 dB). Every stage was
 * "polite" in isolation; the PRODUCT was ≈ −10.6 dB of static loss, so the
 * synth reached the DAC at −16…−25 dBFS peak. Users cranked faders/drive to
 * compensate and slammed the (old, pumping) limiter — the reported
 * "clipping and corruption". +2.5 dB here plus the bus restage puts default
 * patches at a healthy level with the SAME clip ceilings.
 */
const SYNTH_OUTPUT_MAKEUP = 1.33;

function unisonSpread(n: number, dist: UnisonDistribution = "linear"): number[] {
  return unisonPositions(n, dist);
}

interface LfoBank {
  osc: OscillatorNode;
  oscGain: GainNode;
  sh: ConstantSourceNode;
  shGain: GainNode;
  sum: GainNode;
  filterDepth: GainNode;
  pitchDepth: GainNode;
  panDepth: GainNode;
  ampDepth: GainNode;
}

interface Group {
  /** Low / primary frame oscillators. */
  osc: OscillatorNode[];
  /** Adjacent-frame oscillators for equal-power morph crossfade. */
  oscHi: OscillatorNode[];
  morphLo: GainNode[];
  morphHi: GainNode[];
  /** Per-unison polarity / level (alternating phase uses gain = -1). */
  gains: GainNode[];
  pans: StereoPannerNode[];
  level: GainNode;
  bank: PeriodicWave[];
  lastK: number;
  lastK1: number;
  lastFrac: number;
}

/** One polyphonic, stereo wavetable voice. */
class Voice {
  private readonly groupA: Group;
  private readonly groupB: Group;
  private readonly groupC: Group | null;
  private readonly sub: OscillatorNode;
  private readonly gSub: GainNode;
  /** Upper-harmonic translation oscillator (subTranslate audibility). */
  private readonly subHarm: OscillatorNode;
  private readonly gSubHarm: GainNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly gNoise: GainNode;
  /** Burst mode: driven by amp envelope. */
  private readonly noiseBurst: GainNode;
  /** Tilt filter on the noise layer (noiseColor: dark ↔ white ↔ bright). */
  private readonly noiseFilt: BiquadFilterNode;
  private readonly fmOsc: OscillatorNode;
  private readonly fmGain: GainNode;
  /** Osc B audio → osc A frequency (cross FM). Scaled by fmBtoA in applyFm. */
  private readonly xmodGain: GainNode;
  /** Osc A audio → osc B frequency (Twin FM from Prime). */
  private readonly xmodGainAB: GainNode;
  private stormPhase = 0;
  private stormOpen = true;
  private lfoToSub: boolean = true;
  private burstWired = false;
  private readonly mix: GainNode;
  readonly filter: BiquadFilterNode;
  /** 1/CLIP_RANGE pad + shared saturation curve — the per-voice Filter Drive. */
  private readonly fdPad: GainNode;
  private readonly fdShaper: WaveShaperNode;
  private readonly vca: GainNode;
  private readonly ampEnv: ConstantSourceNode;
  private readonly filterEnv: ConstantSourceNode;
  private readonly pitchEnv: ConstantSourceNode;
  private readonly modDetune: ConstantSourceNode;
  private readonly modCutoff: ConstantSourceNode;
  private driftCur = 0;
  private driftTarget = 0;
  /** Static per-note cents from tuneVariance (picked at note-on). */
  private tuneCents = 0;
  /** Continuous instability wander. */
  private instabilityCur = 0;
  private instabilityTarget = 0;
  private readonly unisonCount: number;
  /** Osc B provably unread by this voice — its oscillators stay unstarted. */
  private readonly bSilent: boolean;
  /** Equal-power/coherent unison normalization — see unisonLevelNorm. */
  private uNorm: number;
  /** Extra cascaded biquads for slope > 12 dB/oct. */
  private readonly filterExtra: BiquadFilterNode[] = [];
  /** Harmonic carve notch / peaking stage (F1 / primary). */
  private readonly carveFilt: BiquadFilterNode;
  /** Second carve stage for formant F2 pairs. */
  private readonly carveFilt2: BiquadFilterNode;
  /** Optional ladder/SVF worklet (null = biquad eco path). */
  /** Pooled — checked out in the constructor, returned in forceStop. */
  private filterWorklet: AudioWorkletNode | null;
  /** Persistent Analog Life personality slot (0..47). */
  voiceSlot = 0;

  midi: number;
  baseFreq: number;
  startedAt: number;
  releaseAt: number | null = null;
  velocity: number;
  releasing = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Optional live keyboard attack override (seconds). */
  private liveAttackSec: number | null = null;
  /** Cached mod-env level at release for MSEG release stage. */
  private modLevelAtRelease = 0;
  /** Pitch-mip indices last bound to each osc group (-1 = unset). */
  private mipA = -1;
  private mipB = -1;
  private mipC = -1;

  constructor(
    private readonly synth: FireCommandSynth,
    private readonly ctx: AudioContext,
    dest: AudioNode,
    noiseBuffer: AudioBuffer,
    bankA: PeriodicWave[],
    bankB: PeriodicWave[],
    bankC: PeriodicWave[],
    p: FirePatch,
    midi: number,
    velocity: number,
    /** Optional future start time (ctx clock) for sample-accurate sequencing. */
    when?: number,
    liveAttackSec?: number,
  ) {
    this.midi = midi;
    this.velocity = velocity;
    this.liveAttackSec = liveAttackSec != null && Number.isFinite(liveAttackSec)
      ? Math.max(MIN_AMP_ATTACK_SEC, liveAttackSec)
      : null;
    this.baseFreq = midiToFreq(midi);
    this.unisonCount = Math.round(clamp(Math.min(p.unison, liveUnisonCap(p)), 1, MAX_UNISON));
    this.uNorm = unisonLevelNorm(this.unisonCount, p.unisonPhase ?? "locked", p.unisonDetune ?? 0);
    // Analog Life: persistent DNA personality + note variance.
    const seed = (p.analogDnaSeed ?? 0x73a9c412) >>> 0;
    this.voiceSlot = Math.abs(midi + Math.round(velocity * 17)) % 48;
    const idTune = voiceIdentityUnit(seed, this.voiceSlot, 0);
    const wake = clamp(p.analogWake ?? 0, 0, 1);
    this.tuneCents =
      idTune * clamp(p.tuneVariance ?? 0, 0, 1) * 55
      + (Math.random() * 2 - 1) * clamp(p.tuneVariance ?? 0, 0, 1) * 30 * (1 - wake * 0.5)
      + idTune * wake * 40;
    const t = Math.max(ctx.currentTime, when ?? ctx.currentTime);

    this.mix = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;

    this.fmGain = ctx.createGain();
    this.fmOsc = ctx.createOscillator();
    this.fmOsc.type = "sine";
    this.fmOsc.connect(this.fmGain);
    this.xmodGain = ctx.createGain();
    this.xmodGain.gain.value = 0;
    this.xmodGainAB = ctx.createGain();
    this.xmodGainAB.gain.value = 0;

    // Dual-frame morph oscillators are only reachable above the setWt snap
    // threshold — below it they are silent CPU. See makeGroup.
    const withHi = clamp(p.oscAContinuity ?? 0.72, 0, 1) >= 0.12;
    this.groupA = this.makeGroup(ctx, this.unisonCount, bankA, withHi);
    this.groupB = this.makeGroup(ctx, this.unisonCount, bankB, withHi);
    this.groupC = p.oscCLevel > 0.0001 ? this.makeGroup(ctx, this.unisonCount, bankC, withHi) : null;
    // Osc B is ALSO a modulator source (cross-FM taps its pans pre-level), so
    // it can't just be dropped when its level is 0 the way osc C is. But when
    // nothing reads it at all, leaving its oscillators UNSTARTED costs
    // nothing while keeping every node reference valid — the default Init
    // patch (oscBLevel 0) stops paying for a full silent oscillator bank.
    this.bSilent =
      p.oscBLevel <= 0.0001
      && !(p.fmBtoA && p.fmBtoA > 0.0001)
      && !(p.fmAtoB && p.fmAtoB > 0.0001)
      && (p.oscBInherit ?? "off") === "off"
      && !p.oscBPhaseLock
      && !(Array.isArray(p.modMatrix) && p.modMatrix.some(
        (r) => r && r.source !== "none" && (r.dest === "levelB" || r.dest === "wtB"),
      ));
    this.groupA.level.connect(this.mix);
    this.groupB.level.connect(this.mix);
    this.groupC?.level.connect(this.mix);
    // Cross FM: osc B's summed audio drives osc A's frequency. Tapped from
    // the group's raw sum (pre-level) so oscBLevel = 0 still allows B to act
    // as a pure (silent) modulator, Serum-style.
    for (const pan of this.groupB.pans) pan.connect(this.xmodGain);
    for (const o of this.groupA.osc) this.xmodGain.connect(o.frequency);
    for (const o of this.groupA.oscHi) this.xmodGain.connect(o.frequency);
    // Twin FM: A → B
    for (const pan of this.groupA.pans) pan.connect(this.xmodGainAB);
    for (const o of this.groupB.osc) this.xmodGainAB.connect(o.frequency);
    for (const o of this.groupB.oscHi) this.xmodGainAB.connect(o.frequency);

    this.sub = ctx.createOscillator();
    this.sub.type = p.subWave;
    this.gSub = ctx.createGain();
    this.sub.connect(this.gSub).connect(this.mix);
    this.subHarm = ctx.createOscillator();
    this.subHarm.type = "sine";
    this.gSubHarm = ctx.createGain();
    this.gSubHarm.gain.value = 0;
    this.subHarm.connect(this.gSubHarm).connect(this.mix);

    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;
    this.noiseFilt = ctx.createBiquadFilter();
    this.noiseBurst = ctx.createGain();
    this.noiseBurst.gain.value = 1;
    this.gNoise = ctx.createGain();
    this.noise.connect(this.noiseFilt).connect(this.noiseBurst).connect(this.gNoise).connect(this.mix);

    // mix → [pre-drive?] → filter(+cascade) → carve → [post-drive?] → vca.
    // At filterDrive = 0 the shaper is identity over ±CLIP_RANGE.
    this.fdPad = ctx.createGain();
    this.fdPad.gain.value = 1 / CLIP_RANGE;
    this.fdShaper = ctx.createWaveShaper();
    this.fdShaper.curve = synth.filterDriveCurve;
    // Oversample the per-voice drive/carve saturation — its harmonics alias at
    // 1× on resonant/bright material. (Identity curve at filterDrive 0, so this
    // is free when unused.)
    this.fdShaper.oversample = "2x";
    this.carveFilt = ctx.createBiquadFilter();
    this.carveFilt.type = "allpass";
    this.carveFilt.Q.value = 1;
    this.carveFilt.frequency.value = 1000;
    this.carveFilt2 = ctx.createBiquadFilter();
    this.carveFilt2.type = "allpass";
    this.carveFilt2.Q.value = 1;
    this.carveFilt2.frequency.value = 2000;

    const slope = Math.round(clamp(p.filterSlope ?? 1, 1, 3)) as FilterSlope;
    for (let i = 1; i < slope; i++) {
      const extra = ctx.createBiquadFilter();
      extra.type = p.filterType;
      extra.Q.value = liveFilterQ(p.filterResonance) * 0.55;
      this.filterExtra.push(extra);
    }

    const model = p.filterModel ?? "biquad";
    const wantWorklet =
      (model === "ladder" || model === "svf")
      && synth.filterWorkletReady
      && (p.fxQuality ?? "live") !== "eco";
    // Pooled checkout — per-voice construction wedged the worklet thread
    // after enough churn (see acquireFilterWorklet). Null = biquad fallback.
    this.filterWorklet = wantWorklet ? synth.acquireFilterWorklet() : null;

    const drivePre = (p.filterDrivePos ?? "post") === "pre";
    let node: AudioNode = this.mix;
    if (drivePre) {
      node = node.connect(this.fdPad).connect(this.fdShaper);
    }
    if (this.filterWorklet) {
      // Worklet is the audible filter; keep biquad out of the audio path
      // but still drive its params so env/mod math stays shared.
      node = node.connect(this.filterWorklet);
    } else {
      node = node.connect(this.filter);
      for (const extra of this.filterExtra) node = node.connect(extra);
    }
    node = node.connect(this.carveFilt).connect(this.carveFilt2);
    if (!drivePre) {
      node = node.connect(this.fdPad).connect(this.fdShaper);
    }
    node.connect(this.vca).connect(dest);

    this.filter.type = p.filterType;
    this.filter.Q.value = liveFilterQ(p.filterResonance);

    this.ampEnv = ctx.createConstantSource();
    this.ampEnv.offset.value = 0;
    this.ampEnv.connect(this.vca.gain);
    this.filterEnv = ctx.createConstantSource();
    this.filterEnv.offset.value = 0;
    this.filterEnv.connect(this.filter.frequency);
    this.pitchEnv = ctx.createConstantSource();
    this.pitchEnv.offset.value = 0;
    this.modDetune = ctx.createConstantSource();
    this.modDetune.offset.value = 0;
    this.modCutoff = ctx.createConstantSource();
    this.modCutoff.offset.value = 0;
    this.modCutoff.connect(this.filter.frequency);
    if (this.filterWorklet) {
      const cutP = this.filterWorklet.parameters.get("cutoff");
      if (cutP) {
        // Base cutoff written in setFilterLive; env/mod sum onto the worklet too.
        this.filterEnv.connect(cutP);
        this.modCutoff.connect(cutP);
      }
    }

    // FM + LFO + pitch-env taps into every oscillator.
    for (const o of this.allOscs()) this.fmGain.connect(o.frequency);
    this.lfoToSub = !(p.subPhaseAlign ?? true);
    for (const bank of [synth.lfo1, synth.lfo2]) {
      bank.filterDepth.connect(this.filter.frequency);
      // Ladder/SVF patches run the worklet, not the biquad — without this
      // connect, "LFO → filter" was silently dead on those filter models.
      if (this.filterWorklet) {
        const cutP = this.filterWorklet.parameters.get("cutoff");
        if (cutP) bank.filterDepth.connect(cutP);
      }
      for (const o of this.allOscs()) bank.pitchDepth.connect(o.detune);
      if (this.lfoToSub) bank.pitchDepth.connect(this.sub.detune);
    }
    for (const o of this.allOscs()) this.pitchEnv.connect(o.detune);
    this.pitchEnv.connect(this.sub.detune);
    for (const o of this.allOscs()) this.modDetune.connect(o.detune);
    if (this.lfoToSub) this.modDetune.connect(this.sub.detune);

    this.setOscLevels(p);
    this.setFilterLive(p);

    this.applyTuning(p, t, true);
    this.applyFm(p);
    this.applyUnisonSpread(p);
    this.setWtA(clamp(p.oscAPos, 0, 1), p.oscAContinuity ?? 0.72);
    this.setWtB(clamp(p.oscBPos, 0, 1), p.oscAContinuity ?? 0.72);
    this.setWtC(clamp(p.oscCPos, 0, 1), p.oscAContinuity ?? 0.72);

    // NOTE-ONSET CLICK: filter + drive sit BEFORE the VCA, so oscillators used
    // to slam a cold biquad/worklet at full level on the first sample — heard
    // as a click even when amp attack was several ms. Soft-start the mix into
    // the filter target (reso-compensated) over VOICE_DECLICK_SEC.
    {
      const filtOff = p.pathFilter === false || p.moduleEnable?.["filter"] === false;
      const mixTarget = filtOff ? 1 : filterResoCompGain(liveFilterQ(p.filterResonance));
      this.mix.gain.cancelScheduledValues(t);
      this.mix.gain.setValueAtTime(0, t);
      this.mix.gain.linearRampToValueAtTime(mixTarget, t + VOICE_DECLICK_SEC);
    }

    const dnaSeed = (p.analogDnaSeed ?? 1) >>> 0;
    const spreadSec = p.moduleEnable?.["mixer.unison"] === false ? 0 : (p.unisonTemporalSpread ?? 0);
    const mode = p.unisonTemporalMode ?? "ltr";
    const phaseMode = p.unisonPhase ?? "locked";
    const phases = unisonPhaseOffsets(this.unisonCount, phaseMode, dnaSeed);
    const anchor = p.unisonAnchor !== false;
    const mid = (this.unisonCount - 1) / 2;
    // Phase stagger via delayed start: Δt = φ / (2π f). Alternating uses
    // polarity invert on the per-voice gain instead (works mid-note too).
    const fA0 = Math.max(30, this.baseFreq * Math.pow(2, p.oscAOctave));
    const phaseLock = !!(p.oscBPhaseLock || p.oscBInherit === "lock");
    const fB0 = Math.max(30, phaseLock ? fA0 * Math.pow(2, p.oscBOctave - p.oscAOctave)
      : this.baseFreq * Math.pow(2, p.oscBOctave));
    const fC0 = Math.max(30, this.baseFreq * Math.pow(2, p.oscCOctave));
    for (let i = 0; i < this.unisonCount; i++) {
      const isAnchor = anchor && this.unisonCount > 1 && Math.abs(i - mid) < 0.51;
      const delay = isAnchor ? 0 : unisonDelaySec(i, this.unisonCount, spreadSec, mode, dnaSeed);
      const st = t + delay;
      const usePhase = !isAnchor && phaseMode !== "locked" && phaseMode !== "alternating";
      const phi = usePhase ? phases[i]! : 0;
      this.groupA.osc[i].start(st + phi / (2 * Math.PI * fA0));
      this.groupA.oscHi[i]?.start(st + phi / (2 * Math.PI * fA0));
      if (!this.bSilent) {
        this.groupB.osc[i].start(st + phi / (2 * Math.PI * fB0));
        this.groupB.oscHi[i]?.start(st + phi / (2 * Math.PI * fB0));
      }
      if (this.groupC) {
        this.groupC.osc[i].start(st + phi / (2 * Math.PI * fC0));
        this.groupC.oscHi[i]?.start(st + phi / (2 * Math.PI * fC0));
      }
    }
    this.sub.start(t);
    this.subHarm.start(t);
    this.fmOsc.start(t);
    this.noise.start(t);
    this.ampEnv.start(t);
    this.filterEnv.start(t);
    this.pitchEnv.start(t);
    this.modDetune.start(t);
    this.modCutoff.start(t);
    this.startedAt = t;
    this.triggerEnvelopes(p, velocity, t);
  }

  /**
   * Build one oscillator group.
   *
   * `withHi` = false skips the adjacent-frame morph oscillators entirely.
   * At low continuity `setWt` snaps to a SINGLE frame and holds morphHi at 0
   * forever, so those oscillators were pure waste — and they are half of the
   * per-voice oscillator count (3 groups × unison 7 = 21 wasted wavetable
   * oscillators on a big patch). setWt/detune/tuning all treat an empty
   * oscHi array as "single frame mode".
   */
  private makeGroup(ctx: AudioContext, count: number, bank: PeriodicWave[], withHi: boolean): Group {
    const osc: OscillatorNode[] = [];
    const oscHi: OscillatorNode[] = [];
    const morphLo: GainNode[] = [];
    const morphHi: GainNode[] = [];
    const gains: GainNode[] = [];
    const pans: StereoPannerNode[] = [];
    const level = ctx.createGain();
    for (let i = 0; i < count; i++) {
      const o = ctx.createOscillator();
      const mLo = ctx.createGain();
      mLo.gain.value = 1;
      const g = ctx.createGain();
      g.gain.value = 1;
      const pan = ctx.createStereoPanner();
      o.setPeriodicWave(bank[0]);
      // Dual-frame equal-power morph: lo/hi → polarity → pan → group level.
      o.connect(mLo).connect(g);
      if (withHi) {
        const oHi = ctx.createOscillator();
        const mHi = ctx.createGain();
        mHi.gain.value = 0;
        oHi.setPeriodicWave(bank[0]);
        oHi.connect(mHi).connect(g);
        oscHi.push(oHi);
        morphHi.push(mHi);
      }
      g.connect(pan).connect(level);
      osc.push(o);
      morphLo.push(mLo);
      gains.push(g);
      pans.push(pan);
    }
    return { osc, oscHi, morphLo, morphHi, gains, pans, level, bank, lastK: -1, lastK1: -1, lastFrac: -1 };
  }

  private allOscs(): OscillatorNode[] {
    const a = [...this.groupA.osc, ...this.groupA.oscHi, ...this.groupB.osc, ...this.groupB.oscHi];
    if (this.groupC) a.push(...this.groupC.osc, ...this.groupC.oscHi);
    return a;
  }

  private setWt(group: Group, pos: number, continuity = 1): void {
    const cont = clamp(continuity, 0, 1);
    const N = Math.max(2, group.bank.length);
    const t = this.ctx.currentTime;
    // Continuity low → coarse snapped single frame; high → dual-osc crossfade.
    // No hi oscillators (built single-frame) forces the snapped path — a live
    // continuity raise then takes effect on the NEXT note, same as the
    // existing per-note baking of filter model / osc C presence.
    if (cont < 0.12 || group.oscHi.length === 0) {
      const steps = Math.max(2, Math.round(4 + cont * (N - 4)));
      const snapped = Math.round(clamp(pos, 0, 1) * (steps - 1)) / (steps - 1);
      const k = Math.round(snapped * (N - 1));
      if (k === group.lastK && group.lastFrac === 0) return;
      group.lastK = k;
      group.lastK1 = k;
      group.lastFrac = 0;
      const wave = group.bank[k] ?? group.bank[0]!;
      for (let i = 0; i < group.osc.length; i++) {
        group.osc[i]!.setPeriodicWave(wave);
        group.morphLo[i]!.gain.setTargetAtTime(1, t, 0.01);
        group.morphHi[i]?.gain.setTargetAtTime(0, t, 0.01);
      }
      return;
    }
    const steps = Math.max(2, Math.round(4 + cont * (N - 4)));
    const continuous = clamp(pos, 0, 1) * (N - 1);
    const snapped = (Math.round(clamp(pos, 0, 1) * (steps - 1)) / (steps - 1)) * (N - 1);
    const idx = continuous * cont + snapped * (1 - cont);
    const k0 = Math.max(0, Math.min(N - 1, Math.floor(idx)));
    const k1 = Math.min(N - 1, k0 + 1);
    const frac = clamp(idx - k0, 0, 1);
    if (k0 === group.lastK && k1 === group.lastK1 && Math.abs(frac - group.lastFrac) < 0.0015) return;
    if (k0 !== group.lastK || k1 !== group.lastK1) {
      const w0 = group.bank[k0] ?? group.bank[0]!;
      const w1 = group.bank[k1] ?? w0;
      for (let i = 0; i < group.osc.length; i++) {
        group.osc[i]!.setPeriodicWave(w0);
        group.oscHi[i]?.setPeriodicWave(w1);
      }
      group.lastK = k0;
      group.lastK1 = k1;
    }
    group.lastFrac = frac;
    // Adjacent wavetable frames are highly correlated. Equal-power (√) boosts
    // mid-crossfades by up to √2 when frames match; linear keeps peak ≤ 1.
    const { g0, g1 } = morphFrameGains(frac);
    for (let i = 0; i < group.osc.length; i++) {
      group.morphLo[i]!.gain.setTargetAtTime(g0, t, 0.006);
      group.morphHi[i]?.gain.setTargetAtTime(g1, t, 0.006);
    }
  }

  setWtA(pos: number, continuity = 1): void { this.setWt(this.groupA, pos, continuity); }
  setWtB(pos: number, continuity = 1): void { this.setWt(this.groupB, pos, continuity); }
  setWtC(pos: number, continuity = 1): void { if (this.groupC) this.setWt(this.groupC, pos, continuity); }

  setBankA(bank: PeriodicWave[]): void {
    this.groupA.bank = bank; this.groupA.lastK = -1; this.groupA.lastK1 = -1; this.groupA.lastFrac = -1;
  }
  setBankB(bank: PeriodicWave[]): void {
    this.groupB.bank = bank; this.groupB.lastK = -1; this.groupB.lastK1 = -1; this.groupB.lastFrac = -1;
  }
  setBankC(bank: PeriodicWave[]): void {
    if (this.groupC) {
      this.groupC.bank = bank; this.groupC.lastK = -1; this.groupC.lastK1 = -1; this.groupC.lastFrac = -1;
    }
  }
  hasGroupC(): boolean { return this.groupC !== null; }

  setSubWave(w: SubWave): void { this.sub.type = w; }

  private detuneFor(p: FirePatch, group: "a" | "b" | "c", i: number): number {
    const spread = unisonSpread(this.unisonCount, p.unisonDistribution ?? "linear");
    const base = group === "a" ? p.oscADetune : group === "b" ? p.oscBDetune : p.oscCDetune;
    return base + spread[i] * p.unisonDetune;
  }

  applyUnisonSpread(p: FirePatch): void {
    const unisonOn = p.moduleEnable?.["mixer.unison"] !== false;
    const count = unisonOn ? this.unisonCount : 1;
    const dist = p.unisonDistribution ?? "linear";
    const spread = unisonSpread(this.unisonCount, dist);
    const t = this.ctx.currentTime;
    const detune = unisonOn ? p.unisonDetune : 0;
    const width = unisonOn ? p.unisonWidth : 0;
    const mix = clamp(p.unisonMix ?? 1, 0, 1);
    const anchor = p.unisonAnchor !== false;
    const mid = (this.unisonCount - 1) / 2;
    const phaseMode = p.unisonPhase ?? "locked";
    this.uNorm = unisonLevelNorm(unisonOn ? this.unisonCount : 1, phaseMode, detune);
    for (let i = 0; i < this.unisonCount; i++) {
      const isAnchor = anchor && this.unisonCount > 1 && Math.abs(i - mid) < 0.51;
      const choirScale = isAnchor ? 0 : mix;
      const pan = (count <= 1 || isAnchor ? 0 : spread[i]!) * width * (isAnchor ? 0 : 1);
      const det = isAnchor ? 0 : spread[i]! * detune * choirScale;
      // Real alternating polarity (was a fake pan flip + microscopic detune).
      const pol = (phaseMode === "alternating" && i % 2 === 1 && !isAnchor) ? -1 : 1;
      this.groupA.gains[i].gain.setValueAtTime(pol, t);
      this.groupB.gains[i].gain.setValueAtTime(pol, t);
      this.groupA.pans[i].pan.setTargetAtTime(pan, t, 0.02);
      this.groupB.pans[i].pan.setTargetAtTime(pan, t, 0.02);
      this.groupA.osc[i].detune.setValueAtTime(p.oscADetune + (unisonOn ? det : 0), t);
      this.groupB.osc[i].detune.setValueAtTime(p.oscBDetune + (unisonOn ? det : 0), t);
      // The hi-frame morph oscillators must carry the SAME detune — leaving
      // them at 0 made half the dual-morph stack un-detuned: coherent peak
      // pile-ups (clip) and a narrower image than the patch asked for.
      this.groupA.oscHi[i]?.detune.setValueAtTime(p.oscADetune + (unisonOn ? det : 0), t);
      this.groupB.oscHi[i]?.detune.setValueAtTime(p.oscBDetune + (unisonOn ? det : 0), t);
      if (this.groupC) {
        this.groupC.gains[i].gain.setValueAtTime(pol, t);
        this.groupC.pans[i].pan.setTargetAtTime(pan, t, 0.02);
        this.groupC.osc[i].detune.setValueAtTime(p.oscCDetune + (unisonOn ? det : 0), t);
        this.groupC.oscHi[i]?.detune.setValueAtTime(p.oscCDetune + (unisonOn ? det : 0), t);
      }
    }
  }

  applyTuning(p: FirePatch, t: number, immediate: boolean, fromMidi?: number): void {
    this.baseFreq = midiToFreq(this.midi);
    const fA = this.baseFreq * Math.pow(2, p.oscAOctave);
    const phaseLock = !!(p.oscBPhaseLock || p.oscBInherit === "lock");
    const fB = phaseLock
      ? fA * Math.pow(2, p.oscBOctave - p.oscAOctave)
      : this.baseFreq * Math.pow(2, p.oscBOctave);
    const fC = this.baseFreq * Math.pow(2, p.oscCOctave);
    // Acid slide: legato glide stretches when slideOn — stronger when Acid personality is high.
    const pitchOn = p.moduleEnable?.["pitch"] !== false;
    const chipOn = p.moduleEnable?.["chip"] !== false;
    const acidMix = clamp(p.chipAcidMix ?? 0.35, 0, 1);
    const chipSlide = p.slideOn && chipOn && acidMix > 0.2;
    const glideBase = (pitchOn || chipSlide) ? p.glide : 0;
    let glideSec = (chipSlide && p.mono && !immediate)
      ? Math.max(glideBase, 0.14) * (1.4 + acidMix * 1.6)
      : glideBase;
    const glideMode = p.glideMode ?? "legato";
    const allowGlide = glideSec > 0 && (glideMode === "always" || !immediate);
    if (allowGlide && (p.glideRateMode ?? "time") === "rate" && fromMidi != null) {
      const semis = Math.max(0.5, Math.abs(this.midi - fromMidi));
      // glide 0..1 → rate ~1..40 semis/sec
      const rate = 1 + clamp(glideBase, 0, 1) * 39;
      glideSec = semis / rate;
    }
    const curve = p.glideCurve ?? "exp";
    const setFreq = (osc: OscillatorNode, f: number) => {
      if (!allowGlide || glideSec <= 0) {
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setValueAtTime(f, t);
        return;
      }
      const cur = osc.frequency.value;
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(cur, t);
      if (curve === "linear") {
        osc.frequency.linearRampToValueAtTime(f, t + Math.max(0.008, glideSec));
      } else if (curve === "s") {
        // setValueCurveAtTime copies the array, so one scratch buffer serves
        // every oscillator — a 7-wide unison × dual-morph × 3 groups retune was
        // allocating 42 Float32Arrays per note.
        const arr = GLIDE_CURVE_SCRATCH;
        for (let i = 0; i < GLIDE_CURVE_N; i++) arr[i] = cur + (f - cur) * SMOOTHSTEP_LUT[i]!;
        try {
          osc.frequency.setValueCurveAtTime(arr, t, Math.max(0.01, glideSec));
        } catch {
          osc.frequency.setTargetAtTime(f, t, Math.max(0.005, glideSec / 3));
        }
      } else {
        osc.frequency.setTargetAtTime(f, t, Math.max(0.005, glideSec / 3));
      }
    };
    for (const o of this.groupA.osc) setFreq(o, fA);
    for (const o of this.groupA.oscHi) setFreq(o, fA);
    for (const o of this.groupB.osc) setFreq(o, fB);
    for (const o of this.groupB.oscHi) setFreq(o, fB);
    if (this.groupC) {
      for (const o of this.groupC.osc) setFreq(o, fC);
      for (const o of this.groupC.oscHi) setFreq(o, fC);
    }
    const fSub = this.baseFreq * Math.pow(2, p.subOctave ?? -1);
    setFreq(this.sub, fSub);
    setFreq(this.subHarm, fSub * 2);
    this.refreshMipBanks(p, fA, fB, fC);
    this.applyUnisonSpread(p);
  }

  /** Swap PeriodicWave banks when pitch crosses a mip boundary (glide / retune). */
  refreshMipBanks(p: FirePatch, fA: number, fB: number, fC: number): void {
    const sr = this.ctx.sampleRate;
    const mA = mipLevelForFreq(fA, sr);
    const mB = mipLevelForFreq(fB, sr);
    const mC = mipLevelForFreq(fC, sr);
    if (mA !== this.mipA) {
      this.mipA = mA;
      this.setBankA(this.synth.bankAtMip(p.oscATable, mA));
    }
    if (mB !== this.mipB) {
      this.mipB = mB;
      this.setBankB(this.synth.bankAtMip(p.oscBTable, mB));
    }
    if (this.groupC && mC !== this.mipC) {
      this.mipC = mC;
      this.setBankC(this.synth.bankAtMip(p.oscCTable, mC));
    }
  }

  /** Force-rebind all osc banks for current tables at given fundamentals. */
  rebindBanks(p: FirePatch, fA: number, fB: number, fC: number): void {
    this.mipA = this.mipB = this.mipC = -1;
    this.refreshMipBanks(p, fA, fB, fC);
  }

  applyFm(p: FirePatch): void {
    const t = this.ctx.currentTime;
    const fmOn = p.moduleEnable?.["fm"] !== false;
    const rackOn = p.moduleEnable?.["fm.rack"] !== false;
    if (!fmOn && !rackOn) {
      this.fmGain.gain.setValueAtTime(0, t);
      this.xmodGain.gain.setTargetAtTime(0, t, 0.02);
      this.xmodGainAB.gain.setTargetAtTime(0, t, 0.02);
      return;
    }
    // BUG FIX: FM Rack (ops4) only applies when BOTH fm module AND fm.rack module are on.
    if ((p.fmEngine ?? "classic") === "ops4" && fmOn && rackOn) {
      // Progressive topology (Modulation Clarity):
      // Alg 0–3 ≈ serial-ish index stacks with audible carrier weight.
      // Alg 4–7 ≈ parallel-ish modulator blends into the carrier.
      const corners = p.fmVectorCorners;
      const vx = clamp(p.fmVectorX ?? 0.5, 0, 1);
      const vy = clamp(p.fmVectorY ?? 0.5, 0, 1);
      const lerp4 = (a: number, b: number, c: number, d: number) => {
        const top = a + (b - a) * vx;
        const bot = c + (d - c) * vx;
        return top + (bot - top) * vy;
      };
      let l1 = clamp(p.fmOp1Level ?? 1, 0, 1);
      let l2 = clamp(p.fmOp2Level ?? 0.7, 0, 1);
      let l3 = clamp(p.fmOp3Level ?? 0.5, 0, 1);
      let l4 = clamp(p.fmOp4Level ?? 0.35, 0, 1);
      let r2 = clamp(p.fmOp2Ratio ?? 1, 0.25, 16);
      let r3 = clamp(p.fmOp3Ratio ?? 2, 0.25, 16);
      let r4 = clamp(p.fmOp4Ratio ?? 3, 0.25, 16);
      let fb = clamp(p.fmFeedback ?? 0, 0, 1);
      if (corners && corners.length >= 4) {
        const c0 = corners[0]!, c1 = corners[1]!, c2 = corners[2]!, c3 = corners[3]!;
        l1 = lerp4(c0.levels[0], c1.levels[0], c2.levels[0], c3.levels[0]);
        l2 = lerp4(c0.levels[1], c1.levels[1], c2.levels[1], c3.levels[1]);
        l3 = lerp4(c0.levels[2], c1.levels[2], c2.levels[2], c3.levels[2]);
        l4 = lerp4(c0.levels[3], c1.levels[3], c2.levels[3], c3.levels[3]);
        r2 = lerp4(c0.ratios[0], c1.ratios[0], c2.ratios[0], c3.ratios[0]);
        r3 = lerp4(c0.ratios[1], c1.ratios[1], c2.ratios[1], c3.ratios[1]);
        r4 = lerp4(c0.ratios[2], c1.ratios[2], c2.ratios[2], c3.ratios[2]);
        fb = lerp4(c0.feedback, c1.feedback, c2.feedback, c3.feedback);
      }
      const alg = Math.round(clamp(p.fmAlg ?? 0, 0, 7));
      // Serial-ish (0–3): deeper stack weighting; Parallel-ish (4–7): flatter mix.
      let modIdx: number;
      if (alg <= 3) {
        const stack = [0.55, 0.85, 1.1, 1.35][alg] ?? 1;
        modIdx = (l2 * r2 * 0.55 + l3 * r3 * (alg >= 1 ? 0.55 : 0.15) + l4 * r4 * (alg >= 3 ? 0.55 : 0.1)) * stack / 3;
      } else {
        const parallel = [1.0, 1.15, 1.25, 1.35][alg - 4] ?? 1;
        modIdx = ((l2 * r2) + (l3 * r3) + (l4 * r4)) * parallel / 4.5;
      }
      const sr = this.ctx.sampleRate;
      this.fmOsc.frequency.setValueAtTime(this.baseFreq * r2, t);
      this.fmGain.gain.setValueAtTime(clampFmDev((0.15 + l1 * 0.85) * modIdx * this.baseFreq * (4 + fb * 4), sr), t);
      const xm = (p.fmBtoA ?? 0.15 + fb * 0.5) * this.baseFreq * 4 / this.unisonCount;
      const abAmt = Math.max(p.fmAtoB ?? 0, p.oscBInherit === "fm" ? 0.45 : 0);
      const [xmBA, xmAB] = boundCrossFm(xm, abAmt * this.baseFreq * 4 / this.unisonCount, this.baseFreq);
      this.xmodGain.gain.setTargetAtTime(clampFmDev(xmBA, sr), t, 0.02);
      this.xmodGainAB.gain.setTargetAtTime(clampFmDev(xmAB, sr), t, 0.02);
      return;
    }
    if (!fmOn) {
      this.fmGain.gain.setValueAtTime(0, t);
      const chipOn = p.moduleEnable?.["chip"] !== false;
      const acidMix = clamp(p.chipAcidMix ?? 0.35, 0, 1);
      const syncBoost = chipOn && p.hardSync && acidMix > 0.25
        ? Math.max(p.fmBtoA ?? 0, 0.55 + acidMix * 0.4)
        : 0;
      const ab = (p.fmAtoB ?? 0) > 0.001 || p.oscBInherit === "fm" ? Math.max(p.fmAtoB ?? 0, p.oscBInherit === "fm" ? 0.55 : 0) : 0;
      const [sBA, sAB] = boundCrossFm(
        syncBoost * this.baseFreq * 10 / this.unisonCount,
        ab * this.baseFreq * 4 / this.unisonCount,
        this.baseFreq,
      );
      this.xmodGain.gain.setTargetAtTime(clampFmDev(sBA, this.ctx.sampleRate), t, 0.02);
      this.xmodGainAB.gain.setTargetAtTime(clampFmDev(sAB, this.ctx.sampleRate), t, 0.02);
      return;
    }
    const acidMix = clamp(p.chipAcidMix ?? 0.35, 0, 1);
    const syncWanted = p.hardSync && (p.moduleEnable?.["chip"] === false ? true : acidMix > 0.2);
    const fmAmt = syncWanted ? Math.max(p.fmAmount, 0.22) : p.fmAmount;
    const fbClassic = clamp(p.fmFeedback ?? 0, 0, 0.85);
    const sr = this.ctx.sampleRate;
    this.fmOsc.frequency.setValueAtTime(this.baseFreq * p.fmRatio, t);
    this.fmGain.gain.setValueAtTime(clampFmDev(fmAmt * this.baseFreq * ((syncWanted ? 9 : 6) + fbClassic * 5), sr), t);
    // Hard sync feel: strong B→A cross-mod (PeriodicWave can't hard-reset phase).
    const syncBoost = syncWanted ? Math.max(p.fmBtoA ?? 0, 0.88) : (p.fmBtoA ?? 0);
    const xm = syncBoost * this.baseFreq * (syncWanted ? 10 : 4) / this.unisonCount;
    const abAmt = Math.max(p.fmAtoB ?? 0, p.oscBInherit === "fm" ? 0.55 : 0);
    const [xmBA, xmAB] = boundCrossFm(xm, abAmt * this.baseFreq * 4 / this.unisonCount, this.baseFreq);
    this.xmodGain.gain.setTargetAtTime(clampFmDev(xmBA, sr), t, 0.02);
    this.xmodGainAB.gain.setTargetAtTime(clampFmDev(xmAB, sr), t, 0.02);
  }

  private baseCutoff(p: FirePatch): number {
    const track = p.filterKeyTrack * ((this.midi - 60) / 12);
    return clamp(p.filterCutoff * Math.pow(2, track), 20, 20000);
  }

  triggerEnvelopes(p: FirePatch, velocity: number, t: number): void {
    this.velocity = velocity;
    this.releaseAt = null;
    this.startedAt = t;
    this.modLevelAtRelease = 0;
    // velAmount scales how much velocity moves the amp peak: 1 = full
    // tracking (legacy), 0 = every note lands at full level.
    const va = clamp(p.velAmount ?? 1, 0, 1);
    let peak = clamp(1 - va * (1 - clamp(velocity, 0, 1)), 0, 1);
    const overshoot = clamp(p.ampOvershoot ?? 0, 0, 1);
    const peakPunch = clamp(peak * (1 + overshoot * 0.35), 0, 1.35);

    if (p.lpgOn && p.moduleEnable?.["pluck"] !== false) {
      const model = lpgModelTimes(p.lpgModel ?? "classic", p.lpgDecay ?? 0.4, velocity);
      const strikeAmt = clamp(p.lpgStrike ?? 1, 0, 1);
      const ring = clamp(p.lpgRing ?? 1, 0, 1);
      const leak = clamp(p.lpgLeakage ?? 0, 0, 1);
      const color = clamp((p.lpgColor ?? 0.7) + model.colorBias, 0, 1);
      const decay = model.decay * (0.55 + ring * 0.7);
      const strike = Math.max(MIN_AMP_ATTACK_SEC, model.strike);
      const strikePeak = peak * (0.35 + strikeAmt * 0.65);
      const from = (p.lpgChoke !== false)
        ? 0
        : Math.max(0, this.ampEnv.offset.value);

      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(from, t);
      this.ampEnv.offset.linearRampToValueAtTime(strikePeak, t + strike);
      this.ampEnv.offset.setTargetAtTime(leak * 0.08, t + strike, decay / 3);

      const base = this.baseCutoff(p);
      const couple = clamp(p.lpgResoCouple ?? 0, 0, 1);
      if (couple > 0.02) {
        this.filter.Q.setValueAtTime(liveFilterQ(p.filterResonance, couple * 12 * velocity), t);
      }
      const openHz = clamp(base * Math.pow(2, (1 + 2 * clamp(velocity, 0, 1)) * color * strikeAmt), 20, 18000);
      const floorHz = clamp(base * Math.pow(2, -4.5 * color), 30, 18000);
      this.filter.frequency.setValueAtTime(base, t);
      for (const extra of this.filterExtra) {
        extra.frequency.setValueAtTime(base, t);
        extra.Q.setValueAtTime(liveFilterQ(p.filterResonance) * 0.55, t);
      }
      this.filterEnv.offset.cancelScheduledValues(t);
      this.filterEnv.offset.setValueAtTime(floorHz - base, t);
      this.filterEnv.offset.linearRampToValueAtTime(openHz - base, t + strike);
      this.filterEnv.offset.setTargetAtTime(floorHz - base, t + strike, (decay / 3) * 0.8);
    } else {
      const jitter = clamp(p.envVariance ?? 0, 0, 1);
      const choirSpread = clamp(p.unisonEnvSpread ?? 0, 0, 1) * Math.max(0, this.unisonCount - 1) / 15;
      const lifeOn = p.moduleEnable?.["analog.life"] !== false;
      const lifeCouple = lifeOn ? clamp(p.drift ?? 0, 0, 1) * 0.35 : 0;
      const j = (base: number) =>
        Math.max(
          MIN_AMP_ATTACK_SEC,
          base *
            (1 + (Math.random() * 2 - 1) * jitter * 0.95) *
            (1 + (Math.random() * 2 - 1) * choirSpread * 0.8) *
            (1 + voiceIdentityUnit(p.analogDnaSeed ?? 1, this.voiceSlot, 3) * lifeCouple * 0.25),
        );
      // Asleep envelope modules bypass their time shaping: the amp holds a flat
      // gate (velocity still scales it) and the filter envelope contributes
      // nothing. Without this, sleeping either one only dimmed its panel.
      const ampEnvOn = p.moduleEnable?.["env.amp"] !== false;
      const filtEnvOn = p.moduleEnable?.["env.filt"] !== false;
      const velAtk = ampEnvOn ? clamp(p.velAttack ?? 0, 0, 1) : 0;
      let ampAtk = this.liveAttackSec != null ? this.liveAttackSec : j(p.ampAttack);
      if (!ampEnvOn) ampAtk = Math.max(MIN_AMP_ATTACK_SEC, 0.004);
      ampAtk = Math.max(MIN_AMP_ATTACK_SEC, ampAtk * (1 - velAtk * clamp(velocity, 0, 1) * 0.85));
      const ampDec = j(p.ampDecay);
      const hold = ampEnvOn ? Math.max(0, p.ampHold ?? 0) : 0;
      const filtAtk = this.liveAttackSec != null
        ? Math.min(j(p.filtAttack), Math.max(MIN_AMP_ATTACK_SEC, this.liveAttackSec * 1.25))
        : Math.max(MIN_AMP_ATTACK_SEC, j(p.filtAttack));
      const filtDec = j(p.filtDecay);
      // Curve shapes approximated via ramp vs setTarget tau.
      const atkCurve = ampEnvOn ? (p.ampCurveAttack ?? "lin") : "lin";
      const decCurve = p.ampCurveDecay ?? "exp";
      const retrig = p.ampRetrigger ?? "zero";
      const startLvl = retrig === "current" || retrig === "legato"
        ? Math.max(0, this.ampEnv.offset.value)
        : 0;
      const gateish = (p.ampModel ?? "vca") === "gate" || !ampEnvOn;
      const susLvl = gateish ? peak : peak * p.ampSustain;

      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(startLvl, t);
      if (atkCurve === "lin" || atkCurve === "step") {
        this.ampEnv.offset.linearRampToValueAtTime(peakPunch, t + ampAtk);
      } else {
        // setTargetAtTime is asymptotic, so aiming AT the peak only reached ~89%
        // of it (exp) before decay took over — every curved attack lost its top
        // and started decaying early. Aim past the peak so the curve arrives at
        // peakPunch exactly when the attack ends, then pin it there.
        const tau = Math.max(MIN_AMP_ATTACK_SEC, ampAtk / (atkCurve === "exp" ? 2.2 : 3.5));
        const k = Math.exp(-ampAtk / tau);
        const aim = Math.max(0, (peakPunch - startLvl * k) / (1 - k));
        this.ampEnv.offset.setTargetAtTime(aim, t, tau);
        // Pin continuously: cancel then set at the scheduled end so we don't
        // insert a discontinuous jump from an unfinished asymptotic curve.
        this.ampEnv.offset.cancelScheduledValues(t + ampAtk);
        this.ampEnv.offset.setValueAtTime(peakPunch, t + ampAtk);
      }
      const afterAtk = t + ampAtk + hold;
      if (overshoot > 0.02) {
        // Both attack branches now land exactly on peakPunch at t + ampAtk, so
        // the overshoot fall can ramp straight off that value.
        this.ampEnv.offset.linearRampToValueAtTime(peak, t + ampAtk + Math.min(0.04, ampAtk * 0.5));
      }
      const decTau = Math.max(0.005, ampDec / (decCurve === "lin" ? 8 : 3));
      this.ampEnv.offset.setTargetAtTime(susLvl, afterAtk, decTau);

      const base = this.baseCutoff(p);
      this.filter.frequency.setValueAtTime(base, t);
      for (const extra of this.filterExtra) {
        extra.type = p.filterType;
        extra.frequency.setValueAtTime(base, t);
        extra.Q.setValueAtTime(liveFilterQ(p.filterResonance) * 0.55, t);
      }
      const acidMix = clamp(p.chipAcidMix ?? 0.35, 0, 1);
      const accent = clamp(p.accentAmount ?? 0, 0, 1) * clamp(velocity, 0, 1) * (0.15 + acidMix * 0.85);
      let envAmt = filtEnvOn ? p.filterEnvAmount + accent * 1.15 : 0;
      // Filter-type-aware sweep scaling.
      if (p.filterType === "bandpass" || p.filterType === "notch") envAmt *= 0.85;
      const peakOff = clamp(base * Math.pow(2, envAmt * 4.5), 20, 20000) - base;
      this.filterEnv.offset.cancelScheduledValues(t);
      this.filterEnv.offset.setValueAtTime(0, t);
      this.filterEnv.offset.linearRampToValueAtTime(peakOff, t + filtAtk);
      this.filterEnv.offset.setTargetAtTime(peakOff * p.filtSustain, t + filtAtk, Math.max(0.005, filtDec / 3));
      // Dual destination: resonance follows filter envelope.
      const resoAmt = filtEnvOn ? clamp(p.filterEnvResoAmount ?? 0, -1, 1) : 0;
      if (Math.abs(resoAmt) > 0.02) {
        const qPeak = liveFilterQ(p.filterResonance, resoAmt * 14);
        this.filter.Q.cancelScheduledValues(t);
        this.filter.Q.setValueAtTime(liveFilterQ(p.filterResonance), t);
        this.filter.Q.linearRampToValueAtTime(qPeak, t + filtAtk);
        this.filter.Q.setTargetAtTime(
          liveFilterQ(p.filterResonance, resoAmt * 14 * p.filtSustain),
          t + filtAtk,
          Math.max(0.005, filtDec / 3),
        );
        if (this.filterWorklet) {
          const resP = this.filterWorklet.parameters.get("resonance");
          if (resP) {
            resP.cancelScheduledValues(t);
            resP.setValueAtTime(clamp(liveFilterQ(p.filterResonance) / FILTER_Q_CEIL, 0, 1), t);
            resP.linearRampToValueAtTime(clamp(qPeak / FILTER_Q_CEIL, 0, 1), t + filtAtk);
            resP.setTargetAtTime(
              clamp(liveFilterQ(p.filterResonance, resoAmt * 14 * p.filtSustain) / FILTER_Q_CEIL, 0, 1),
              t + filtAtk,
              Math.max(0.005, filtDec / 3),
            );
          }
        }
      }
      if (accent > 0.04) {
        // Cap at 1.0: accents used to push the amp envelope to 1.25 — a
        // +1.9 dB spike straight into the drive shaper on every accented
        // arp step (audible as periodic crunch). Accent character now comes
        // from the velocity/filter response, not from overshooting the VCA.
        const boosted = clamp(peak * (1 + accent * 0.4), 0, 1.0);
        this.ampEnv.offset.cancelScheduledValues(t);
        this.ampEnv.offset.setValueAtTime(startLvl, t);
        this.ampEnv.offset.linearRampToValueAtTime(clamp(boosted * (1 + overshoot * 0.25), 0, 1.05), t + ampAtk);
        this.ampEnv.offset.setTargetAtTime(boosted * (gateish ? 1 : p.ampSustain), afterAtk, decTau);
      }
    }

    this.pitchEnv.offset.cancelScheduledValues(t);
    const pitchOn = p.moduleEnable?.["pitch"] !== false;
    if (pitchOn && p.pitchEnvAmount !== 0) {
      this.pitchEnv.offset.setValueAtTime(p.pitchEnvAmount * 100, t);
      this.pitchEnv.offset.linearRampToValueAtTime(0, t + Math.max(0.01, p.pitchEnvTime));
    } else {
      this.pitchEnv.offset.setValueAtTime(0, t);
    }
  }

  /**
   * Schedule voice teardown `tailSec` from now. Live path uses a wall-clock
   * timer; offline bounce has no wall clock, so it stops sources on the audio
   * clock and cleans up in `onended` — otherwise offline voices never GC and a
   * wall-clock steal could disconnect nodes mid-render.
   */
  private scheduleEnd(tailSec: number): void {
    // Audio-clock stop for BOTH paths (small live safety margin on top).
    // The live path used to rely on setTimeout alone: background-tab timer
    // throttling left whole voice graphs rendering for minutes — CPU climbed,
    // ecoHot kicked in, oversampling dropped, and the synth started aliasing
    // ("corruption when sounds get complex"). Oscillator stop() cannot be
    // throttled; the wall timer remains only to disconnect/GC promptly.
    const at = this.ctx.currentTime + Math.max(0.01, tailSec) + (this.synth.offlineSafe ? 0 : 0.05);
    const srcs: AudioScheduledSourceNode[] = [
      ...this.allOscs(), this.sub, this.subHarm, this.fmOsc, this.noise,
      this.ampEnv, this.filterEnv, this.pitchEnv, this.modDetune, this.modCutoff,
    ];
    for (const n of srcs) { try { n.stop(at); } catch { /* already stopped */ } }
    if (this.synth.offlineSafe) {
      try { this.ampEnv.onended = () => this.forceStop(); } catch { /* ignore */ }
    } else {
      this.endTimer = setTimeout(() => this.forceStop(), tailSec * 1000);
      try { this.ampEnv.onended = () => this.forceStop(); } catch { /* ignore */ }
    }
  }

  noteOff(p: FirePatch, when?: number): void {
    if (this.releasing || this.stopped) return;
    this.releasing = true;
    const now = this.ctx.currentTime;
    const t = Math.max(now, when ?? now);
    this.releaseAt = t;
    this.modLevelAtRelease = this.synth.peekModEnvLevel(this, t);
    if (p.lpgOn && p.moduleEnable?.["pluck"] !== false) {
      const model = lpgModelTimes(p.lpgModel ?? "classic", p.lpgDecay ?? 0.4, this.velocity);
      const decay = model.decay * (0.55 + clamp(p.lpgRing ?? 1, 0, 1) * 0.7);
      const tail = (t - now) + decay * 4 + 0.15;
      // Declick: ease amp to 0 over the ring so LPG leakage doesn't hard-cut
      // at the forced stop (previously it returned with amp untouched).
      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(Math.max(0, this.ampEnv.offset.value), t);
      this.ampEnv.offset.setTargetAtTime(0, t, Math.max(0.02, decay * 0.6));
      this.scheduleEnd(tail);
      return;
    }
    // Asleep amp envelope = no time shaping at all, so release is a declick.
    const ampEnvOn = p.moduleEnable?.["env.amp"] !== false;
    const rel = ampEnvOn ? Math.max(0.01, p.ampRelease) : 0.012;
    const future = t > now + 0.001;
    // For scheduled (future) releases, hold the envelope's ramp value at `t`
    // rather than snapshotting `.value` now — the attack may still be running.
    const hold = (param: AudioParam) => {
      const p2 = param as AudioParam & { cancelAndHoldAtTime?: (at: number) => AudioParam };
      if (future && typeof p2.cancelAndHoldAtTime === "function") {
        p2.cancelAndHoldAtTime(t);
      } else {
        param.cancelScheduledValues(t);
        param.setValueAtTime(Math.max(0, param.value), t);
      }
    };
    hold(this.ampEnv.offset);
    const relCurve = ampEnvOn ? (p.ampCurveRelease ?? "exp") : "lin";
    const relTau = rel / (relCurve === "lin" ? 8 : relCurve === "s" ? 3.5 : 4);
    this.ampEnv.offset.setTargetAtTime(0, t, Math.max(0.004, relTau));
    hold(this.filterEnv.offset);
    const filtRel = p.moduleEnable?.["env.filt"] !== false ? Math.max(0.01, p.filtRelease) : 0.02;
    this.filterEnv.offset.setTargetAtTime(0, t, filtRel / 4);
    const tail = (t - now) + rel * 4 + 0.15;
    this.scheduleEnd(tail);
  }

  /**
   * ARP / sequencer one-shot release — caps the amp tail so 300 BPM × 1/32
   * (40 notes/s) cannot stack hundreds of ms of release on the shared bus.
   * Audio-clock oscillator stop mirrors fastRelease so background-tab timer
   * throttle cannot leave ARP voices allocated.
   */
  noteOffShort(p: FirePatch, when: number, maxReleaseSec: number): void {
    if (this.releasing || this.stopped) return;
    this.releasing = true;
    const now = this.ctx.currentTime;
    const t = Math.max(now, when);
    this.releaseAt = t;
    this.modLevelAtRelease = this.synth.peekModEnvLevel(this, t);
    const ampEnvOn = p.moduleEnable?.["env.amp"] !== false;
    const rel = ampEnvOn
      ? Math.max(0.004, Math.min(p.ampRelease, maxReleaseSec))
      : 0.006;
    const future = t > now + 0.001;
    const hold = (param: AudioParam) => {
      const p2 = param as AudioParam & { cancelAndHoldAtTime?: (at: number) => AudioParam };
      if (future && typeof p2.cancelAndHoldAtTime === "function") {
        p2.cancelAndHoldAtTime(t);
      } else {
        param.cancelScheduledValues(t);
        param.setValueAtTime(Math.max(0, param.value), t);
      }
    };
    hold(this.ampEnv.offset);
    const relTau = rel / 3;
    this.ampEnv.offset.setTargetAtTime(0, t, Math.max(0.003, relTau));
    hold(this.filterEnv.offset);
    const filtRel = p.moduleEnable?.["env.filt"] !== false
      ? Math.max(0.004, Math.min(p.filtRelease, maxReleaseSec * 1.2))
      : 0.008;
    this.filterEnv.offset.setTargetAtTime(0, t, filtRel / 3);
    // Audio-clock hard stop — don't rely solely on wall-clock scheduleEnd.
    const hardAt = t + Math.max(0.03, rel * 1.6 + 0.02);
    const srcs: AudioScheduledSourceNode[] = [
      ...this.allOscs(), this.sub, this.subHarm, this.fmOsc, this.noise,
      this.ampEnv, this.filterEnv, this.pitchEnv, this.modDetune, this.modCutoff,
    ];
    for (const n of srcs) {
      try { n.stop(hardAt); } catch { /* already stopped / not started */ }
    }
    const tail = (hardAt - now) + 0.012;
    if (this.synth.offlineSafe) {
      try { this.ampEnv.onended = () => this.forceStop(); } catch { /* ignore */ }
    } else {
      if (this.endTimer) clearTimeout(this.endTimer);
      this.endTimer = setTimeout(() => this.forceStop(), Math.ceil(tail * 1000) + 8);
    }
  }

  /**
   * Soft choke at an audio-clock time (ARP same-pitch retrigger).
   * Never mutates amp at schedule-now for a future choke.
   */
  chokeAt(when: number): void {
    if (this.stopped) return;
    this.releasing = true;
    const now = this.ctx.currentTime;
    const t = Math.max(now, when);
    this.releaseAt = t;
    const hold = this.ampEnv.offset as AudioParam & {
      cancelAndHoldAtTime?: (at: number) => AudioParam;
    };
    if (typeof hold.cancelAndHoldAtTime === "function") {
      try { hold.cancelAndHoldAtTime(t); } catch { /* ignore */ }
    } else {
      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(Math.max(0, this.ampEnv.offset.value), t);
    }
    this.ampEnv.offset.setTargetAtTime(0, t, 0.004);
    try {
      const mixCur = Math.max(0, this.mix.gain.value);
      this.mix.gain.cancelScheduledValues(t);
      this.mix.gain.setValueAtTime(mixCur, t);
      this.mix.gain.linearRampToValueAtTime(0, t + 0.008);
    } catch { /* ignore */ }
    const hardAt = t + 0.04;
    const srcs: AudioScheduledSourceNode[] = [
      ...this.allOscs(), this.sub, this.subHarm, this.fmOsc, this.noise,
      this.ampEnv, this.filterEnv, this.pitchEnv, this.modDetune, this.modCutoff,
    ];
    for (const n of srcs) {
      try { n.stop(hardAt); } catch { /* ignore */ }
    }
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => this.forceStop(), Math.ceil((hardAt - now) * 1000) + 10);
  }

  /** Quick click-free fade then stop — used when stealing a voice. */
  fastRelease(): void {
    if (this.stopped) return;
    this.releasing = true;
    const t = this.ctx.currentTime;
    // Hold current amp (avoid cancel→set snap), then fade. Hotter voices need
    // a slightly longer τ or rapid note-switches crackle on resonant patches.
    const cur = Math.max(0, this.ampEnv.offset.value);
    const hold = this.ampEnv.offset as AudioParam & {
      cancelAndHoldAtTime?: (at: number) => AudioParam;
    };
    if (typeof hold.cancelAndHoldAtTime === "function") {
      hold.cancelAndHoldAtTime(t);
    } else {
      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(cur, t);
    }
    const tau = cur > 0.55 ? 0.014 : 0.01;
    this.ampEnv.offset.setTargetAtTime(0, t, tau);
    // Also choke the pre-filter mix so a dying resonant voice can't keep
    // injecting into the shared bus while the new note attacks.
    try {
      const mixCur = Math.max(0, this.mix.gain.value);
      this.mix.gain.cancelScheduledValues(t);
      this.mix.gain.setValueAtTime(mixCur, t);
      this.mix.gain.linearRampToValueAtTime(0, t + Math.min(0.012, tau + 0.002));
    } catch { /* ignore */ }
    // Audio-clock hard stop so background-tab timer throttling can't leave
    // stolen oscillators rendering for seconds as zombies.
    const hardAt = t + Math.max(0.05, tau * 4 + 0.02);
    const srcs: AudioScheduledSourceNode[] = [
      ...this.allOscs(), this.sub, this.subHarm, this.fmOsc, this.noise,
      this.ampEnv, this.filterEnv, this.pitchEnv, this.modDetune, this.modCutoff,
    ];
    for (const n of srcs) {
      try { n.stop(hardAt); } catch { /* already stopped / not started */ }
    }
    if (this.synth.offlineSafe) {
      // No wall clock offline — the audio-clock stop above ends ampEnv; clean
      // up in onended so stolen voices still GC during render.
      try { this.ampEnv.onended = () => this.forceStop(); } catch { /* ignore */ }
    } else {
      if (this.endTimer) clearTimeout(this.endTimer);
      this.endTimer = setTimeout(() => this.forceStop(), Math.ceil((hardAt - t) * 1000) + 10);
    }
  }

  forceStop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    try { this.ampEnv.disconnect(this.noiseBurst.gain); } catch { /* ignore */ }
    const srcs: AudioScheduledSourceNode[] = [
      ...this.allOscs(), this.sub, this.subHarm, this.fmOsc, this.noise, this.ampEnv, this.filterEnv, this.pitchEnv,
      this.modDetune, this.modCutoff,
    ];
    for (const n of srcs) {
      try { n.stop(); } catch { /* already stopped */ }
      try { n.disconnect(); } catch { /* ignore */ }
    }
    for (const bank of [this.synth.lfo1, this.synth.lfo2]) {
      try { bank.filterDepth.disconnect(this.filter.frequency); } catch { /* ignore */ }
      // The worklet cutoff param edge too — the shared LFO bank must not
      // accumulate a dead param connection per note played.
      if (this.filterWorklet) {
        const cutP = this.filterWorklet.parameters.get("cutoff");
        if (cutP) { try { bank.filterDepth.disconnect(cutP); } catch { /* ignore */ } }
      }
      for (const o of this.allOscs()) {
        try { bank.pitchDepth.disconnect(o.detune); } catch { /* ignore */ }
      }
      try { bank.pitchDepth.disconnect(this.sub.detune); } catch { /* ignore */ }
    }
    const others: AudioNode[] = [
      ...this.groupA.pans, ...this.groupB.pans,
      ...this.groupA.gains, ...this.groupB.gains,
      ...this.groupA.morphLo, ...this.groupA.morphHi,
      ...this.groupB.morphLo, ...this.groupB.morphHi,
      this.groupA.level, this.groupB.level,
      this.gSub, this.gSubHarm, this.gNoise, this.noiseBurst, this.noiseFilt, this.fmGain, this.xmodGain, this.xmodGainAB,
      this.mix, this.filter, ...this.filterExtra, this.carveFilt, this.carveFilt2, this.fdPad, this.fdShaper, this.vca,
    ];
    // Pooled worklet goes BACK to the synth (reset + reuse), not to GC.
    if (this.filterWorklet) {
      this.synth.releaseFilterWorklet(this.filterWorklet);
      this.filterWorklet = null;
    }
    if (this.groupC) {
      others.push(
        ...this.groupC.pans, ...this.groupC.gains, ...this.groupC.morphLo, ...this.groupC.morphHi, this.groupC.level,
      );
    }
    for (const n of others) { try { n.disconnect(); } catch { /* ignore */ } }
    this.synth.onVoiceEnded(this);
  }

  // ── live updates ──
  setOscLevels(p: FirePatch): void {
    const t = this.ctx.currentTime;
    const mute = p.pathOsc === false;
    const nMul = mute ? 0 : 1;
    const modOn = (id: string) => p.moduleEnable?.[id] !== false;
    const noiseOn = modOn("noise");
    const subOn = modOn("sub");
    const mode = p.noiseMode ?? "bed";
    const dens = clamp(p.noiseDensity ?? 0.45, 0, 1);
    const grain = clamp(p.noiseGrain ?? 0.35, 0, 1);
    // Noise is ONLY what the Noise knob says — never a hidden chip "bed".
    let noise = (!noiseOn || mute) ? 0 : clamp(p.noiseLevel, 0, 1);
    if (mode === "storm" && noise > 0.0005) {
      // Stochastic storm gate — density opens grains; grain holds them open longer.
      this.stormPhase += 0.016 * (3 + dens * 22);
      if (this.stormPhase >= 1) {
        this.stormPhase -= 1;
        this.stormOpen = Math.random() < (0.18 + dens * 0.72);
      }
      noise *= this.stormOpen ? (0.55 + grain * 0.45) : (1 - dens) * 0.12;
    }
    const oscAOn = modOn("osc.a");
    const oscBOn = modOn("osc.b");
    const oscCOn = modOn("osc.c");
    this.groupA.level.gain.setTargetAtTime((oscAOn ? p.oscALevel : 0) * this.uNorm * nMul, t, 0.02);
    this.groupB.level.gain.setTargetAtTime((oscBOn ? p.oscBLevel : 0) * this.uNorm * nMul, t, 0.02);
    if (this.groupC) this.groupC.level.gain.setTargetAtTime((oscCOn ? p.oscCLevel : 0) * this.uNorm * nMul, t, 0.02);
    const subLvl = (subOn ? p.subLevel : 0) * nMul;
    this.gSub.gain.setTargetAtTime(subLvl, t, 0.02);
    const translate = clamp(p.subTranslate ?? 0, 0, 1);
    this.gSubHarm.gain.setTargetAtTime(subLvl * translate * 0.55, t, 0.03);
    // Burst: ampEnv drives noiseBurst (note body); Bed: unity.
    if (mode === "burst") {
      if (!this.burstWired) {
        this.noiseBurst.gain.value = 0;
        try { this.ampEnv.connect(this.noiseBurst.gain); this.burstWired = true; } catch { /* */ }
      }
    } else if (this.burstWired) {
      try { this.ampEnv.disconnect(this.noiseBurst.gain); } catch { /* */ }
      this.burstWired = false;
      this.noiseBurst.gain.setTargetAtTime(1, t, 0.02);
    } else {
      this.noiseBurst.gain.setTargetAtTime(1, t, 0.02);
    }
    // Snap noise off immediately so a prior noisy preset can't bleed a hat-tick
    // into the next note via setTargetAtTime lag.
    if (noise < 0.0005) this.gNoise.gain.setValueAtTime(0, t);
    else this.gNoise.gain.setTargetAtTime(noise, t, mode === "storm" ? 0.008 : 0.02);
    this.applyNoiseColor(p);
  }

  /** noiseColor tilt: <0 sweeps a lowpass down to 350 Hz, >0 a highpass up to 6 kHz. */
  applyNoiseColor(p: FirePatch, immediate = false): void {
    const t = this.ctx.currentTime;
    const c = clamp(p.noiseColor ?? 0, -1, 1);
    const type: BiquadFilterType = c < 0 ? "lowpass" : "highpass";
    const freq = c < 0
      ? 18000 * Math.pow(350 / 18000, -c) // 18 kHz (transparent) → 350 Hz
      : 20 * Math.pow(6000 / 20, c);      // 20 Hz (transparent) → 6 kHz
    this.noiseFilt.type = type;
    if (immediate) this.noiseFilt.frequency.value = freq;
    else this.noiseFilt.frequency.setTargetAtTime(freq, t, 0.02);
    this.noiseFilt.Q.value = 0.5;
  }

  /** Swap in the shared filter-drive transfer (rebuilt when the param moves). */
  setFilterDriveCurve(curve: Float32Array<ArrayBuffer>): void {
    this.fdShaper.curve = curve;
  }
  setFilterLive(p: FirePatch): void {
    const t = this.ctx.currentTime;
    if (p.pathFilter === false || p.moduleEnable?.["filter"] === false) {
      this.filter.type = "lowpass";
      this.filter.Q.setTargetAtTime(0.0001, t, 0.02);
      this.filter.frequency.setTargetAtTime(20000, t, 0.03);
      for (const extra of this.filterExtra) {
        extra.type = "lowpass";
        extra.Q.setTargetAtTime(0.0001, t, 0.02);
        extra.frequency.setTargetAtTime(20000, t, 0.03);
      }
      this.carveFilt.type = "allpass";
      this.carveFilt2.type = "allpass";
      if (this.filterWorklet) {
        this.filterWorklet.parameters.get("cutoff")?.setTargetAtTime(20000, t, 0.03);
        this.filterWorklet.parameters.get("resonance")?.setTargetAtTime(0, t, 0.03);
        // Stop the ladder/SVF kernel outright — an open cutoff still ran the
        // full per-voice filter for a module the user switched off.
        this.filterWorklet.parameters.get("bypass")?.setValueAtTime(1, t);
      }
      this.mix.gain.setTargetAtTime(1, t, 0.03);
      return;
    }
    const base = this.baseCutoff(p);
    const lifeOn = p.moduleEnable?.["analog.life"] !== false;
    const cal =
      lifeOn
        ? 1 + voiceIdentityUnit(p.analogDnaSeed ?? 1, this.voiceSlot, 5) * clamp(p.drift ?? 0, 0, 1) * 0.08
        : 1;
    const cut = clamp(base * cal, 20, 20000);
    const qLive = liveFilterQ(p.filterResonance);
    this.filter.type = p.filterType;
    this.filter.Q.setTargetAtTime(qLive, t, 0.02);
    this.filter.frequency.setTargetAtTime(cut, t, 0.03);
    for (const extra of this.filterExtra) {
      extra.type = p.filterType;
      extra.Q.setTargetAtTime(qLive * 0.55, t, 0.02);
      extra.frequency.setTargetAtTime(cut, t, 0.03);
    }
    // High Q still bites; compensate the input so resonant peaks don't clip.
    this.mix.gain.setTargetAtTime(filterResoCompGain(qLive), t, 0.03);
    if (this.filterWorklet) {
      const model = p.filterModel ?? "biquad";
      const typeHint =
        p.filterType === "bandpass" ? 1
          : p.filterType === "highpass" ? 2
            : p.filterType === "notch" ? 3
              : 0;
      const mode = model === "svf" ? 1 : 0;
      const q01 = clamp(qLive / FILTER_Q_CEIL, 0, 1);
      const cutP = this.filterWorklet.parameters.get("cutoff");
      const resP = this.filterWorklet.parameters.get("resonance");
      const drvP = this.filterWorklet.parameters.get("drive");
      const modeP = this.filterWorklet.parameters.get("mode");
      const typeP = this.filterWorklet.parameters.get("typeHint");
      cutP?.setTargetAtTime(cut, t, 0.03);
      resP?.setTargetAtTime(q01, t, 0.03);
      drvP?.setTargetAtTime(clamp(p.filterDrive ?? 0, 0, 1) * 0.55, t, 0.04);
      modeP?.setValueAtTime(mode, t);
      typeP?.setValueAtTime(typeHint, t);
      this.filterWorklet.parameters.get("bypass")?.setValueAtTime(0, t);
    }
    // Harmonic carve via notch / peaking near fundamental or partials / formants.
    const carve = p.filterCarve ?? "off";
    const amt = clamp(p.filterCarveAmount ?? 0, 0, 1);
    if (carve === "off" || amt < 0.02) {
      this.carveFilt.type = "allpass";
      this.carveFilt.Q.setTargetAtTime(0.7, t, 0.03);
      this.carveFilt.frequency.setTargetAtTime(1000, t, 0.03);
      this.carveFilt.gain.setTargetAtTime(0, t, 0.03);
      this.carveFilt2.type = "allpass";
      this.carveFilt2.Q.setTargetAtTime(0.7, t, 0.03);
      this.carveFilt2.frequency.setTargetAtTime(2000, t, 0.03);
      this.carveFilt2.gain.setTargetAtTime(0, t, 0.03);
    } else if (carve === "formant") {
      // Movable F1/F2 pair — cutoff slides the vowel, carve amount opens the mouths.
      // Milder than the old +16/+13 dB blowouts, stronger than the sterile +6.5/+5.2 floor.
      const f1 = clamp(cut * (0.35 + amt * 0.2), 220, 1000);
      const f2 = clamp(cut * (0.95 + amt * 1.1), 650, 3800);
      this.carveFilt.type = "peaking";
      this.carveFilt.frequency.setTargetAtTime(f1, t, 0.03);
      this.carveFilt.Q.setTargetAtTime(2.2 + amt * 4.5, t, 0.03);
      this.carveFilt.gain.setTargetAtTime(2.5 + amt * 6.5, t, 0.03);
      this.carveFilt2.type = "peaking";
      this.carveFilt2.frequency.setTargetAtTime(f2, t, 0.03);
      this.carveFilt2.Q.setTargetAtTime(1.8 + amt * 3.5, t, 0.03);
      this.carveFilt2.gain.setTargetAtTime(2 + amt * 5.5, t, 0.03);
    } else {
      this.carveFilt2.type = "allpass";
      this.carveFilt2.gain.setTargetAtTime(0, t, 0.03);
      const f0 = clamp(this.baseFreq, 40, 4000);
      if (carve === "fundamental") {
        this.carveFilt.type = "notch";
        this.carveFilt.frequency.setTargetAtTime(f0, t, 0.03);
        this.carveFilt.Q.setTargetAtTime(0.7 + amt * 8, t, 0.03);
        this.carveFilt.gain.setTargetAtTime(0, t, 0.03);
      } else if (carve === "odds") {
        this.carveFilt.type = "peaking";
        this.carveFilt.frequency.setTargetAtTime(f0 * 3, t, 0.03);
        this.carveFilt.Q.setTargetAtTime(1 + amt * 6, t, 0.03);
        this.carveFilt.gain.setTargetAtTime(-amt * 18, t, 0.03);
      } else if (carve === "evens") {
        this.carveFilt.type = "peaking";
        this.carveFilt.frequency.setTargetAtTime(f0 * 2, t, 0.03);
        this.carveFilt.Q.setTargetAtTime(1 + amt * 6, t, 0.03);
        this.carveFilt.gain.setTargetAtTime(-amt * 18, t, 0.03);
      } else {
        // noise-ish: high shelf cut of hiss region
        this.carveFilt.type = "highshelf";
        this.carveFilt.frequency.setTargetAtTime(4500, t, 0.03);
        this.carveFilt.gain.setTargetAtTime(-amt * 14, t, 0.03);
      }
    }
  }

  /** Slow random per-voice detune wander (analog instability), in cents. */
  advanceDrift(amount: number, rate = 0.35, scales?: { tremor?: number; breath?: number; climate?: number; events?: number }): number {
    if (amount <= 0.001) return 0;
    const r = clamp(rate, 0.05, 1);
    const tremor = clamp(scales?.tremor ?? 0.55, 0, 1);
    const breath = clamp(scales?.breath ?? 0.45, 0, 1);
    const climate = clamp(scales?.climate ?? 0.3, 0, 1);
    const events = clamp(scales?.events ?? 0, 0, 1);
    // Tremor: rapid micro updates
    if (Math.random() < 0.12 * tremor * r) {
      this.driftTarget += (Math.random() * 2 - 1) * amount * 4 * tremor;
    }
    // Breath: medium wander
    if (Math.random() < 0.03 + r * 0.08 * breath) {
      this.driftTarget = (Math.random() * 2 - 1) * amount * (18 + r * 24) * breath;
    }
    // Climate: slow bias
    if (Math.random() < 0.008 * climate) {
      this.driftTarget += (Math.random() * 2 - 1) * amount * 12 * climate;
    }
    // Events: occasional spikes
    if (events > 0.02 && Math.random() < events * 0.015) {
      this.driftTarget = (Math.random() * 2 - 1) * amount * 55;
    }
    const slew = 0.04 + r * 0.1 * tremor + breath * 0.04;
    this.driftCur += (this.driftTarget - this.driftCur) * slew;
    return this.driftCur;
  }

  advanceInstability(amount: number): number {
    if (amount <= 0) return 0;
    if (Math.random() < 0.08) this.instabilityTarget = (Math.random() * 2 - 1) * amount * 55;
    this.instabilityCur += (this.instabilityTarget - this.instabilityCur) * 0.12;
    return this.instabilityCur;
  }

  getTuneCents(): number { return this.tuneCents; }

  /** Apply one frame of summed modulation-matrix output to this voice. */
  applyMatrix(p: FirePatch, m: {
    pitch: number; cutoff: number; reso: number; fm: number;
    lvlA: number; lvlB: number; lvlC: number; driftCents: number;
    aReso: boolean; aFm: boolean; aLvl: boolean;
  }): void {
    const t = this.ctx.currentTime;
    const cents = clamp(m.pitch * 1200 + m.driftCents, -4800, 4800);
    this.modDetune.offset.setTargetAtTime(cents, t, 0.02);
    const oct = clamp(m.cutoff * 4, -8, 8);
    const base = this.baseCutoff(p);
    const hz = clamp(base * (Math.pow(2, oct) - 1), -18000, 18000);
    this.modCutoff.offset.setTargetAtTime(hz, t, 0.02);
    if (m.aReso) {
      const q = liveFilterQ(p.filterResonance, m.reso * 18);
      this.filter.Q.setTargetAtTime(q, t, 0.03);
      if (this.filterWorklet) {
        this.filterWorklet.parameters.get("resonance")?.setTargetAtTime(
          clamp(q / FILTER_Q_CEIL, 0, 1),
          t,
          0.03,
        );
      }
    }
    if (m.aFm) this.fmGain.gain.setTargetAtTime(clampFmDev(Math.max(0, (p.fmAmount + m.fm) * this.baseFreq * 6), this.ctx.sampleRate), t, 0.02);
    if (m.aLvl) {
      const oscAOn = p.moduleEnable?.["osc.a"] !== false;
      const oscBOn = p.moduleEnable?.["osc.b"] !== false;
      const oscCOn = p.moduleEnable?.["osc.c"] !== false;
      this.groupA.level.gain.setTargetAtTime(clamp((oscAOn ? p.oscALevel : 0) + m.lvlA, 0, 1.5) * this.uNorm, t, 0.03);
      this.groupB.level.gain.setTargetAtTime(clamp((oscBOn ? p.oscBLevel : 0) + m.lvlB, 0, 1.5) * this.uNorm, t, 0.03);
      if (this.groupC) this.groupC.level.gain.setTargetAtTime(clamp((oscCOn ? p.oscCLevel : 0) + m.lvlC, 0, 1.5) * this.uNorm, t, 0.03);
    }
  }

  /** Return matrix-driven detune/cutoff offsets to neutral when the matrix goes idle. */
  clearMod(): void {
    const t = this.ctx.currentTime;
    this.modDetune.offset.setTargetAtTime(0, t, 0.02);
    this.modCutoff.offset.setTargetAtTime(0, t, 0.02);
  }
}

/**
 * One addModule per AudioContext, shared by both synth instances (A and B).
 * The worklet lives as a plain JS asset in public/worklets so the same
 * relative URL resolves in the Vite dev server AND next to dist/index.html
 * in the packaged Electron build (file://). Resolves false — never throws —
 * so a failed load degrades to a permanent clean bypass.
 */
/** STFT window used by kc-spectral. Fixed: the worklet sizes its tables once
 *  at module load, so this is engine truth, not a per-patch setting. */
export const SPECTRAL_FFT_SIZE = 2048;

const spectralModuleReady = new WeakMap<BaseAudioContext, Promise<boolean>>();
function loadSpectralModule(ctx: AudioContext): Promise<boolean> {
  let p = spectralModuleReady.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        const url = new URL("worklets/spectral-processor.js", document.baseURI).toString();
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch (err) {
        console.warn("[FireCommand] spectral worklet failed to load — FX bypassed:", err);
        return false;
      }
    })();
    spectralModuleReady.set(ctx, p);
  }
  return p;
}

const filterModuleReady = new WeakMap<BaseAudioContext, Promise<boolean>>();
function loadFilterModule(ctx: AudioContext): Promise<boolean> {
  let p = filterModuleReady.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        const url = new URL("worklets/filter-processor.js", document.baseURI).toString();
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch (err) {
        console.warn("[FireCommand] filter worklet failed to load — biquad path kept:", err);
        return false;
      }
    })();
    filterModuleReady.set(ctx, p);
  }
  return p;
}

/** Cap is 40 nodes per synth — extra ladder/SVF voices fall back to biquad. */
let lastFilterPoolToastAt = 0;
function toastFilterPoolExhausted(): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastFilterPoolToastAt < 10000) return;
  lastFilterPoolToastAt = now;
  void import("@/state/uiStore").then(({ useUIStore }) => {
    useUIStore.getState().toast(
      "Filter pool full — extra ladder voices using the analog filter",
      "warn",
    );
  }).catch(() => { /* UI not ready */ });
}

export class FireCommandSynth {
  readonly output: GainNode;
  readonly lfo1: LfoBank;
  readonly lfo2: LfoBank;
  private readonly ctx: AudioContext;

  // bus
  private readonly voiceBus: GainNode;
  private readonly drivePre: GainNode;
  private readonly driveShaper: WaveShaperNode;
  private readonly drivePost: GainNode;
  private readonly driveDcHp: BiquadFilterNode;
  private readonly crushShaper: WaveShaperNode;
  private readonly crushDry: GainNode;
  private readonly crushWet: GainNode;
  private readonly crushOut: GainNode;
  private readonly vintage: FireVintageAge;
  private readonly ringDry: GainNode;
  private readonly ringWet: GainNode;
  private readonly ringCarrier: OscillatorNode;
  private readonly ringDepth: GainNode;
  private readonly ringOut: GainNode;
  private readonly lowProtectHp: BiquadFilterNode;
  private readonly chorusIn: GainNode;
  private readonly chorusDry: GainNode;
  private readonly chorusWet: GainNode;
  private cDelayL: DelayNode;
  private cDelayR: DelayNode;
  private readonly cLfoL: OscillatorNode;
  private readonly cLfoR: OscillatorNode;
  private readonly cDepthL: GainNode;
  private readonly cDepthR: GainNode;
  private readonly cPanL: StereoPannerNode;
  private readonly cPanR: StereoPannerNode;
  private readonly chorusOut: GainNode;
  private readonly phaserIn: GainNode;
  private phaserAP: BiquadFilterNode[];
  private readonly phaserDry: GainNode;
  private readonly phaserWet: GainNode;
  private readonly phaserFb: GainNode;
  private readonly phaserOut: GainNode;
  private readonly phaserLfo: OscillatorNode;
  private readonly phaserDepth: GainNode;
  private readonly tremolo: GainNode;
  private readonly delayDry: GainNode;
  private dL: DelayNode;
  private dR: DelayNode;
  private readonly dFbLR: GainNode;
  private readonly dFbRL: GainNode;
  // In-loop feedback conditioning. Without these the repeats never darkened
  // (delayFbFilter only dimmed the shared post-delay tone LPF, which coloured
  // the DRY signal instead) and nothing bounded low-end/hiss accumulation at
  // high feedback.
  private readonly dFbSatLR: WaveShaperNode;
  private readonly dFbSatRL: WaveShaperNode;
  private readonly dFbLpLR: BiquadFilterNode;
  private readonly dFbLpRL: BiquadFilterNode;
  private readonly dFbHpLR: BiquadFilterNode;
  private readonly dFbHpRL: BiquadFilterNode;
  private lastFbDriveKey = -1;
  private readonly dPanL: StereoPannerNode;
  private readonly dPanR: StereoPannerNode;
  private readonly delayWet: GainNode;
  private readonly delayOut: GainNode;
  private readonly tone: BiquadFilterNode;
  private punchComp: DynamicsCompressorNode;
  private readonly punchMakeup: GainNode;
  private readonly punchDry: GainNode;
  private readonly punchWet: GainNode;
  private readonly punchIn: GainNode;
  private readonly punchOut: GainNode;
  private readonly airIn: GainNode;
  private readonly airLow: BiquadFilterNode;
  private readonly airHigh: BiquadFilterNode;
  private readonly airOut: GainNode;
  private readonly reverbIn: GainNode;
  private reverbPredelay: DelayNode;
  // Tail EQ lives on the WET path. reverbHighCut / reverbLowDecay used to be
  // folded into the shared post-delay tone LPF, which band-limited the DRY bus
  // to 12 kHz whenever the reverb module was merely enabled — audible as a
  // washed-out top end on patches with reverbMix at 0.
  private readonly revHiCut: BiquadFilterNode;
  private readonly revLowShelf: BiquadFilterNode;
  private readonly reverbConv: ConvolverNode;
  private readonly reverbDry: GainNode;
  private readonly reverbWet: GainNode;
  private readonly reverbOut: GainNode;
  // ── Spectral FX (v1.7) — dry branch is unity until the worklet engages ──
  private readonly spectralDry: GainNode;
  private readonly spectralSend: GainNode;
  /** Post-STFT trim — makes spectralOutGain real (it was a dead patch field). */
  private readonly spectralOutTrim: GainNode;
  private spectralNode: AudioWorkletNode | null = null;
  private spectralState: "idle" | "loading" | "ready" | "failed" = "idle";
  private readonly autopan: StereoPannerNode;
  private readonly gateGain: GainNode;
  // Mid/side stereo width (stereoWidth): L/R → M=(L+R)/2, S=(L-R)/2, then
  // L' = M + w·S, R' = M − w·S. At w = 1 the network is the exact identity.
  private readonly widthIn: GainNode;
  private readonly widthSplit: ChannelSplitterNode;
  private readonly widthMid: GainNode;
  private readonly widthSideL: GainNode;
  private readonly widthSideR: GainNode;
  private readonly widthSideHp: BiquadFilterNode;
  // Mechanism stages: three parallel side-path branches, exactly one live at a
  // time. "ms" routes straight through, so the network is still the exact
  // identity at w = 1; "microdelay" lags the side, "decorrelate" runs it
  // through an allpass pair that scrambles phase without touching magnitude.
  private readonly widthSideDirect: GainNode;
  private readonly widthSideDelay: DelayNode;
  private readonly widthSideDelayAmt: GainNode;
  private readonly widthSideAp1: BiquadFilterNode;
  private readonly widthSideAp2: BiquadFilterNode;
  private readonly widthSideApAmt: GainNode;
  private readonly widthSideAmt: GainNode;
  private readonly widthSideInv: GainNode;
  private readonly widthMerge: ChannelMergerNode;
  private readonly widthOutGain: GainNode;
  private lastMasterChain: MasterChainScene = "glueAirWidth";
  private readonly master: GainNode;
  /** 1/CLIP_RANGE pad into the soft clipper — see makeSoftClipCurve. */
  private readonly clipPre: GainNode;
  private readonly softClip: WaveShaperNode;
  /** Shared per-voice filter-drive transfer — rebuilt only when the param moves. */
  filterDriveCurve: Float32Array<ArrayBuffer>;

  private readonly noiseBuffer: AudioBuffer;
  private nesNoiseBuffer: AudioBuffer | null = null;
  private gbNoiseBuffer: AudioBuffer | null = null;
  private periodicNoiseBuffer: AudioBuffer | null = null;
  /** table id → sparse per-mip frame banks. Built on demand (see baseBankFor). */
  private readonly banks = new Map<string, (PeriodicWave[] | undefined)[]>();
  /** table id → per-subframe constant-loudness gains, shared across that table's mips. */
  private readonly bankGains = new Map<string, number[]>();
  private readonly voices = new Set<Voice>();
  private readonly held = new Map<number, Voice>();
  private monoVoice: Voice | null = null;
  private patch: FirePatch;
  private maxVoices = 12;

  private modTimer: ReturnType<typeof setInterval> | null = null;
  private irTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIrKey = "";
  private lastPredelay = -1;
  private lastDriveKey = "";
  private lastCrushBits = -1;
  private lastSpectralMsg = "";
  private lastBusVoiceSyncKey = "";
  /** Hysteretic CPU-eco flag — enter hot at 0.65, leave at 0.5. Prevents the
   *  drive/soft-clip oversample from flapping (and rebuilding curves) when
   *  voice count oscillates around a single threshold. */
  private ecoHot = false;
  /** Voices pulled from the active set but still fading out after a steal.
   *  Tracked so setPatch hard-kills them too — otherwise a ~50 ms zombie can
   *  keep its old filter/dual-morph topology and bleed into the next preset. */
  private readonly dying = new Set<Voice>();
  private sh1Step = -1; private sh1Val = 0;
  private sh2Step = -1; private sh2Val = 0;
  private mtxRandStep = -1; private mtxRandVal = 0;
  private lastPvActive = false;
  private gPanWas = false; private gVolWas = false; private gRevWas = false; private gDlyWas = false;
  private lastGateTarget = 1;
  private revNullTimer: ReturnType<typeof setTimeout> | null = null;
  // Pre-digested modulation matrix — recomputed only when the matrix itself
  // changes, so the 60 Hz loop never has to scan/branch over inert slots.
  private mtxRoutes: ModRoute[] = [];
  private mtxHasGlobal = false;
  private mtxHasPerVoice = false;
  /** A matrix route can drive reverb above a 0 base mix — keep the convolver
   *  alive in that case even though the patch's own reverbMix is silent. */
  private mtxHasReverbRoute = false;
  /** Per-slot smooth memory for route transforms (Phase 5). */
  private readonly mtxSmooth = new Float32Array(MOD_SLOTS);
  /** Macro response smoothed values (macroResponse === "smoothed"). */
  private readonly macroSmooth = new Float32Array(4);
  /** Macro baselines captured when entering `relative` response mode. */
  private readonly macroBaseline = new Float32Array(4);
  /** Host/sequencer BPM for delaySync (and future tempo-linked FX). */
  private hostBpm = 120;
  /** Twin Orbit follow-lag state for LFO2. */
  private lfo2Follow = 0;
  private twinDriftPhase = 0;
  private readonly mtxA = { reso: false, fm: false, lvlA: false, lvlB: false, lvlC: false };
  // Reusable per-voice modulation payload — mutated and handed to applyMatrix
  // each voice so the hot loop allocates nothing.
  private readonly mScratch = { pitch: 0, cutoff: 0, reso: 0, fm: 0, lvlA: 0, lvlB: 0, lvlC: 0, driftCents: 0, aReso: false, aFm: false, aLvl: false };
  displayPosA = 0;
  displayPosB = 0;
  displayPosC = 0;

  /** Skip wall-clock voice GC / mod interval — required for OfflineAudioContext bounce. */
  offlineSafe = false;
  /** Set by dispose(); guards the mod tick against running on a dead graph. */
  private disposed = false;
  /** Ladder/SVF AudioWorklet available for new voices. */
  filterWorkletReady = false;

  /**
   * Optional hook into AudioEngine so a preset load can also rebuild the
   * shared Fire master limiter — DynamicsCompressor envelope state cannot be
   * cleared in-place and is what forces a full app reboot after IceKing / NS.
   */
  private readonly onFlushContamination: (() => void) | null;
  private readonly getLimiterReduction: (() => number) | null;

  /** Fading voices still hit voiceBus — cap or IceKing arps pile up into clip. */
  private static readonly DYING_CAP = 6;
  private static readonly HOT_ARP_DYING_CAP = 2;
  /** Materialize ARP notes this far before `when` (keeps sample-accurate starts). */
  private static readonly ARP_MATERIALIZE_EPS = 0.008;
  /** Extra voiceBus pad while hot ARP is cooking. 0.72 stacked with the poly
   *  √comp was a double penalty (−2.8 dB on top of the duck) — with the bus
   *  limiter now doing real lookahead limiting, a light 0.9 pad suffices. */
  private static readonly HOT_ARP_BUS_PAD = 0.9;
  /** Bound deferred ARP jobs so a main-thread stall cannot burst-spawn voices. */
  private static readonly ARP_QUEUE_CAP = 8;
  private static readonly HOT_ARP_QUEUE_CAP = 5;

  private limiterPinFrames = 0;
  /**
   * Multiplier on the limiter-pin window, doubled per flush (max 32).
   * Without it, a loud-but-healthy patch drove an endless flush loop — see
   * the backoff comment in updateMod.
   */
  private limiterFlushBackoff = 1;
  /** Frames the limiter has been unpinned, used to re-arm the backoff. */
  private limiterUnpinFrames = 0;
  private delayHotFrames = 0;
  /** Dead-output self-heal: consecutive ticks with voices sounding but the
   *  output flat-zero / non-finite. See runTickBody. */
  private healthAnalyser: AnalyserNode | null = null;
  private healthBuf: Float32Array<ArrayBuffer> | null = null;
  private deadOutputFrames = 0;
  private healSameTickGuard = -1000;
  /** Last observed hot-arp flag — bus params reapply on flips (space duck). */
  private lastHotArpState = false;
  /** True while the exporter is driving updateMod by hand. See
   *  tickModulationForRender — suppresses live-only timer/graph maintenance. */
  private offlineTick = false;

  /**
   * Bounded pool of kc-filter worklet nodes. Constructing one AudioWorkletNode
   * PER VOICE wedged Chromium's worklet thread after a few thousand
   * create/destroy cycles (≈5 minutes of fast ladder arps) — new processors
   * silently stopped instantiating and every ladder/SVF voice was born
   * silent. Nodes here are created once, checked out per voice, and reset +
   * returned on voice teardown. When the pool is exhausted the voice falls
   * back to the biquad path (audible, just a different filter flavor).
   */
  private readonly filterWorkletPool: AudioWorkletNode[] = [];
  private filterWorkletCount = 0;
  private static readonly FILTER_WORKLET_CAP = 40;

  acquireFilterWorklet(): AudioWorkletNode | null {
    // FIFO, not LIFO. The state reset on release is a `postMessage`, which the
    // audio thread only processes at its next render quantum (~2.7 ms). Popping
    // from the end handed the JUST-released node to the next voice first, so a
    // fast retrigger (ARP, choke-and-replace on the same pitch) could start
    // filtering before the reset landed and inherit the previous voice's
    // resonant ladder state — a screech on note onset, worst at high
    // resonance. Taking the OLDEST idle node instead gives every reset the
    // maximum possible time to be applied.
    const pooled = this.filterWorkletPool.shift();
    if (pooled) return pooled;
    if (this.filterWorkletCount >= FireCommandSynth.FILTER_WORKLET_CAP) {
      toastFilterPoolExhausted();
      return null;
    }
    try {
      const node = new AudioWorkletNode(this.ctx, "kc-filter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.filterWorkletCount++;
      return node;
    } catch {
      return null;
    }
  }

  releaseFilterWorklet(node: AudioWorkletNode): void {
    try { node.disconnect(); } catch { /* ignore */ }
    // Zero the DSP state and park the params open/neutral so the next owner
    // never inherits the previous voice's resonant tail or closed cutoff.
    try { node.port.postMessage({ reset: true }); } catch { /* ignore */ }
    try {
      const t = this.ctx.currentTime;
      const set = (name: string, v: number) => {
        const p = node.parameters.get(name);
        if (p) { p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
      };
      set("cutoff", 18000);
      set("resonance", 0);
      set("drive", 0);
      // Park pooled nodes in true bypass so an idle checkout costs nothing.
      set("bypass", 1);
    } catch { /* ignore */ }
    this.filterWorkletPool.push(node);
  }

  /** Lightweight ARP lookahead jobs — Voice is built only near `when`. */
  private readonly arpQueue: Array<{
    midi: number;
    velocity: number;
    when: number;
    duration: number;
    stepSec: number;
  }> = [];

  constructor(
    ctxIn: BaseAudioContext,
    dest: AudioNode,
    opts?: {
      onFlushContamination?: () => void;
      getLimiterReduction?: () => number;
      /**
       * Throwaway synth on a short-lived OfflineAudioContext (Natural
       * Selection auditions). Suppresses the constructor's filter-worklet
       * preload — see the comment at the call site.
       */
      transient?: boolean;
    },
  ) {
    const ctx = ctxIn as AudioContext;
    this.ctx = ctx;
    this.onFlushContamination = opts?.onFlushContamination ?? null;
    this.getLimiterReduction = opts?.getLimiterReduction ?? null;
    this.patch = cloneFirePatch({});
    this.filterDriveCurve = makeFilterDriveCurve(this.patch.filterDrive);

    // Preload filter bite worklet (non-blocking); voices fall back to biquad
    // until ready.
    //
    // SKIPPED for transient synths. Calling addModule() gives an
    // AudioWorkletGlobalScope — a separate JS realm — to the context, and
    // Blink then never collects that context. Natural Selection builds one
    // OfflineAudioContext per audition, so this single unconditional line
    // stranded the whole context, its rendered AudioBuffer and ~772 KB of
    // channel data per audition. Measured by heap-snapshot diff: every class
    // below grew exactly once per audition — OfflineAudioContext,
    // AudioWorklet, AudioBuffer, AudioDestinationNode, AudioListener.
    // Auditions measure gross silence / distortion, for which the biquad
    // fallback is sufficient.
    if (!opts?.transient) void loadFilterModule(ctx).then((ok) => {
      this.filterWorkletReady = ok;
      // Do not setPatch here. setPatch force-stops every live voice (the
      // worklet-ready race used to kill held notes / arp). New Voice()
      // instances pick up the worklet via acquireFilterWorklet() now that
      // ready is true; in-flight biquad voices finish as-is.
    });

    // Wave banks are built on demand (see baseBankFor / warmBanks): rendering
    // every table × mip × subframe up front is thousands of PeriodicWaves and
    // stalled first paint. Warm just what the starting patch will ask for.
    this.warmBanks(this.patch);

    this.output = ctx.createGain();
    // See SYNTH_OUTPUT_MAKEUP — static makeup so default patches reach the
    // bus at a healthy level. The soft clip bounds the signal at 0.98 before
    // this, so the output ceiling is 0.98 × makeup ≈ 1.30, well inside the
    // bus limiter's control range.
    this.output.gain.value = SYNTH_OUTPUT_MAKEUP;
    // Dead-output watchdog tap (see runTickBody): tiny FFT, no smoothing —
    // we only ask "is ANY signal reaching the output while voices claim to
    // be sounding". Live contexts only; offline renders have no tick loop.
    if (!this.offlineSafe) {
      try {
        this.healthAnalyser = ctx.createAnalyser();
        this.healthAnalyser.fftSize = 256;
        this.output.connect(this.healthAnalyser);
      } catch { /* metering is best-effort */ }
    }
    this.voiceBus = ctx.createGain();
    this.drivePre = ctx.createGain();
    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = "2x";
    this.drivePost = ctx.createGain();
    this.driveDcHp = ctx.createBiquadFilter();
    this.driveDcHp.type = "highpass";
    this.driveDcHp.frequency.value = 5;
    this.driveDcHp.Q.value = 0.7;
    this.crushShaper = ctx.createWaveShaper();
    this.crushDry = ctx.createGain();
    this.crushWet = ctx.createGain();
    this.crushOut = ctx.createGain();
    this.vintage = new FireVintageAge(ctx);
    this.ringDry = ctx.createGain();
    this.ringWet = ctx.createGain();
    this.ringWet.gain.value = 0;
    this.ringCarrier = ctx.createOscillator();
    this.ringCarrier.type = "sine";
    this.ringDepth = ctx.createGain();
    this.ringOut = ctx.createGain();
    this.lowProtectHp = ctx.createBiquadFilter();
    this.lowProtectHp.type = "highpass";
    this.lowProtectHp.frequency.value = 20;
    this.lowProtectHp.Q.value = 0.707;
    this.chorusIn = ctx.createGain();
    this.chorusDry = ctx.createGain();
    this.chorusWet = ctx.createGain();
    this.cDelayL = ctx.createDelay(0.1);
    this.cDelayR = ctx.createDelay(0.1);
    this.cLfoL = ctx.createOscillator();
    this.cLfoR = ctx.createOscillator();
    this.cLfoL.type = "sine";
    this.cLfoR.type = "sine";
    this.cDepthL = ctx.createGain();
    this.cDepthR = ctx.createGain();
    this.cPanL = ctx.createStereoPanner();
    this.cPanR = ctx.createStereoPanner();
    this.cPanL.pan.value = -0.8;
    this.cPanR.pan.value = 0.8;
    this.chorusOut = ctx.createGain();
    this.phaserIn = ctx.createGain();
    this.phaserAP = [];
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = 800;
      ap.Q.value = 0.6;
      this.phaserAP.push(ap);
    }
    this.phaserDry = ctx.createGain();
    this.phaserWet = ctx.createGain();
    this.phaserWet.gain.value = 0;
    this.phaserFb = ctx.createGain();
    this.phaserFb.gain.value = 0;
    this.phaserOut = ctx.createGain();
    this.phaserLfo = ctx.createOscillator();
    this.phaserLfo.type = "sine";
    this.phaserDepth = ctx.createGain();
    this.phaserDepth.gain.value = 0;
    this.tremolo = ctx.createGain();
    this.delayDry = ctx.createGain();
    this.dL = ctx.createDelay(2.0);
    this.dR = ctx.createDelay(2.0);
    this.dFbLR = ctx.createGain();
    this.dFbRL = ctx.createGain();
    this.dFbSatLR = ctx.createWaveShaper();
    this.dFbSatRL = ctx.createWaveShaper();
    this.dFbSatLR.oversample = "2x";
    this.dFbSatRL.oversample = "2x";
    this.dFbLpLR = ctx.createBiquadFilter();
    this.dFbLpRL = ctx.createBiquadFilter();
    this.dFbHpLR = ctx.createBiquadFilter();
    this.dFbHpRL = ctx.createBiquadFilter();
    for (const f of [this.dFbLpLR, this.dFbLpRL]) {
      f.type = "lowpass";
      f.frequency.value = 18000;
      f.Q.value = 0.5;
    }
    for (const f of [this.dFbHpLR, this.dFbHpRL]) {
      f.type = "highpass";
      f.frequency.value = 40;
      f.Q.value = 0.5;
    }
    this.dPanL = ctx.createStereoPanner();
    this.dPanR = ctx.createStereoPanner();
    this.dPanL.pan.value = -0.9;
    this.dPanR.pan.value = 0.9;
    this.delayWet = ctx.createGain();
    this.delayOut = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.Q.value = 0.5;
    this.punchComp = ctx.createDynamicsCompressor();
    this.punchComp.knee.value = 6;
    this.punchComp.attack.value = 0.004;
    this.punchComp.release.value = 0.12;
    this.punchMakeup = ctx.createGain();
    this.punchDry = ctx.createGain();
    this.punchWet = ctx.createGain();
    this.punchIn = ctx.createGain();
    this.punchOut = ctx.createGain();
    this.punchDry.gain.value = 0;
    this.punchWet.gain.value = 1;
    this.airIn = ctx.createGain();
    this.airLow = ctx.createBiquadFilter();
    this.airLow.type = "lowshelf";
    this.airLow.frequency.value = 180;
    this.airLow.gain.value = 0;
    this.airHigh = ctx.createBiquadFilter();
    this.airHigh.type = "highshelf";
    this.airHigh.frequency.value = 6500;
    this.airHigh.gain.value = 0;
    this.airOut = ctx.createGain();
    this.reverbIn = ctx.createGain();
    this.reverbPredelay = ctx.createDelay(0.25);
    this.reverbPredelay.delayTime.value = 0;
    this.revHiCut = ctx.createBiquadFilter();
    this.revHiCut.type = "lowpass";
    this.revHiCut.frequency.value = 12000;
    this.revHiCut.Q.value = 0.5;
    this.revLowShelf = ctx.createBiquadFilter();
    this.revLowShelf.type = "lowshelf";
    this.revLowShelf.frequency.value = 220;
    this.revLowShelf.gain.value = 0;
    this.reverbConv = ctx.createConvolver();
    this.reverbDry = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;
    this.reverbOut = ctx.createGain();
    this.spectralDry = ctx.createGain();
    this.spectralSend = ctx.createGain();
    this.spectralSend.gain.value = 0;
    this.spectralOutTrim = ctx.createGain();
    this.autopan = ctx.createStereoPanner();
    this.gateGain = ctx.createGain();
    // widthIn pins the stream to true stereo ("speakers" up-mix) so the
    // splitter's discrete channel handling can't zero the right channel on a
    // momentarily mono signal.
    this.widthIn = ctx.createGain();
    this.widthIn.channelCount = 2;
    this.widthIn.channelCountMode = "explicit";
    this.widthIn.channelInterpretation = "speakers";
    this.widthSplit = ctx.createChannelSplitter(2);
    this.widthMid = ctx.createGain();
    this.widthMid.gain.value = 0.5;
    this.widthSideL = ctx.createGain();
    this.widthSideL.gain.value = 0.5;
    this.widthSideR = ctx.createGain();
    this.widthSideR.gain.value = -0.5;
    this.widthSideHp = ctx.createBiquadFilter();
    this.widthSideHp.type = "highpass";
    this.widthSideHp.frequency.value = 20;
    this.widthSideHp.Q.value = 0.7;
    this.widthSideDirect = ctx.createGain();
    this.widthSideDirect.gain.value = 1;
    this.widthSideDelay = ctx.createDelay(0.02);
    this.widthSideDelay.delayTime.value = 0.00045;
    this.widthSideDelayAmt = ctx.createGain();
    this.widthSideDelayAmt.gain.value = 0;
    this.widthSideAp1 = ctx.createBiquadFilter();
    this.widthSideAp1.type = "allpass";
    this.widthSideAp1.frequency.value = 380;
    this.widthSideAp1.Q.value = 0.7;
    this.widthSideAp2 = ctx.createBiquadFilter();
    this.widthSideAp2.type = "allpass";
    this.widthSideAp2.frequency.value = 2200;
    this.widthSideAp2.Q.value = 0.7;
    this.widthSideApAmt = ctx.createGain();
    this.widthSideApAmt.gain.value = 0;
    this.widthSideAmt = ctx.createGain();
    this.widthSideAmt.gain.value = 1;
    this.widthSideInv = ctx.createGain();
    this.widthSideInv.gain.value = -1;
    this.widthMerge = ctx.createChannelMerger(2);
    this.widthOutGain = ctx.createGain();
    this.widthOutGain.gain.value = 1;
    this.master = ctx.createGain();
    this.clipPre = ctx.createGain();
    this.clipPre.gain.value = 1 / CLIP_RANGE;
    this.softClip = ctx.createWaveShaper();
    this.softClip.curve = makeSoftClipCurve();
    this.softClip.oversample = "2x";
    // Fixed headroom on the voice sum — see VOICE_HEADROOM. Set before any
    // note plays so the first chord isn't hot for one gain-ramp.
    this.voiceBus.gain.value = VOICE_HEADROOM;

    // bus wiring
    this.voiceBus.connect(this.drivePre);
    this.drivePre.connect(this.driveShaper);
    this.driveShaper.connect(this.driveDcHp);
    this.driveDcHp.connect(this.drivePost);
    this.drivePost.connect(this.crushDry).connect(this.crushOut);
    this.drivePost.connect(this.crushShaper).connect(this.crushWet).connect(this.crushOut);
    // Vintage Age sits between crush and ring — dry wire when all params off.
    this.crushOut.connect(this.vintage.input);
    this.vintage.output.connect(this.ringDry).connect(this.ringOut);
    this.vintage.output.connect(this.ringWet).connect(this.ringOut);
    this.ringCarrier.connect(this.ringDepth).connect(this.ringWet.gain);
    this.ringDepth.gain.value = 1;
    this.ringOut.connect(this.lowProtectHp);
    this.lowProtectHp.connect(this.chorusIn);
    this.chorusIn.connect(this.chorusDry).connect(this.chorusOut);
    this.chorusIn.connect(this.cDelayL).connect(this.cPanL).connect(this.chorusWet);
    this.chorusIn.connect(this.cDelayR).connect(this.cPanR).connect(this.chorusWet);
    this.chorusWet.connect(this.chorusOut);
    this.cLfoL.connect(this.cDepthL).connect(this.cDelayL.delayTime);
    this.cLfoR.connect(this.cDepthR).connect(this.cDelayR.delayTime);
    this.cDelayL.delayTime.value = 0.012;
    this.cDelayR.delayTime.value = 0.0145;
    // Phaser: 4 series allpass stages, LFO-swept, with feedback + wet/dry mix.
    this.chorusOut.connect(this.phaserIn);
    this.phaserIn.connect(this.phaserDry).connect(this.phaserOut);
    let apNode: AudioNode = this.phaserIn;
    for (const ap of this.phaserAP) { apNode.connect(ap); apNode = ap; }
    apNode.connect(this.phaserWet).connect(this.phaserOut);
    apNode.connect(this.phaserFb).connect(this.phaserIn);
    this.phaserLfo.connect(this.phaserDepth);
    for (const ap of this.phaserAP) this.phaserDepth.connect(ap.frequency);
    this.phaserOut.connect(this.tremolo);
    this.tremolo.connect(this.delayDry).connect(this.delayOut);
    this.tremolo.connect(this.dL);
    this.dL.connect(this.dPanL).connect(this.delayWet);
    this.dR.connect(this.dPanR).connect(this.delayWet);
    // Cross-coupled feedback, each pass through saturation → band limiting.
    this.dL.connect(this.dFbLR).connect(this.dFbSatLR).connect(this.dFbHpLR).connect(this.dFbLpLR).connect(this.dR);
    this.dR.connect(this.dFbRL).connect(this.dFbSatRL).connect(this.dFbHpRL).connect(this.dFbLpRL).connect(this.dL);
    this.delayWet.connect(this.delayOut);
    this.delayOut.connect(this.tone);
    this.tone.connect(this.punchIn);
    this.punchIn.connect(this.punchComp).connect(this.punchWet).connect(this.punchOut);
    this.punchIn.connect(this.punchDry).connect(this.punchOut);
    this.punchOut.connect(this.punchMakeup).connect(this.airIn);
    this.airIn.connect(this.airLow).connect(this.airHigh).connect(this.airOut).connect(this.reverbIn);
    this.reverbIn.connect(this.reverbDry).connect(this.reverbOut);
    this.reverbIn.connect(this.reverbPredelay).connect(this.revHiCut).connect(this.revLowShelf)
      .connect(this.reverbConv).connect(this.reverbWet).connect(this.reverbOut);
    // Spectral FX sits between reverb and autopan (freezing reverb tails is
    // the point). At spectralMode "off" the signal takes the plain dry gain —
    // zero added latency, zero worklet cost; the worklet is loaded lazily on
    // first activation and the two branches crossfade.
    this.reverbOut.connect(this.spectralDry).connect(this.autopan);
    this.reverbOut.connect(this.spectralSend);
    this.autopan.connect(this.gateGain);
    // gate → width (M/S) → master
    this.gateGain.connect(this.widthIn);
    this.widthIn.connect(this.widthSplit);
    this.widthSplit.connect(this.widthMid, 0);
    this.widthSplit.connect(this.widthMid, 1);          // M = (L+R)/2
    this.widthSplit.connect(this.widthSideL, 0);
    this.widthSplit.connect(this.widthSideR, 1);        // S = (L−R)/2
    this.widthSideL.connect(this.widthSideHp);
    this.widthSideR.connect(this.widthSideHp);
    // S × width (mono-below HPF), then one of three mechanism branches.
    this.widthSideHp.connect(this.widthSideDirect).connect(this.widthSideAmt);
    this.widthSideHp.connect(this.widthSideDelay).connect(this.widthSideDelayAmt).connect(this.widthSideAmt);
    this.widthSideHp.connect(this.widthSideAp1).connect(this.widthSideAp2)
      .connect(this.widthSideApAmt).connect(this.widthSideAmt);
    this.widthMid.connect(this.widthMerge, 0, 0);
    this.widthMid.connect(this.widthMerge, 0, 1);
    this.widthSideAmt.connect(this.widthMerge, 0, 0);   // L' = M + wS
    this.widthSideAmt.connect(this.widthSideInv);
    this.widthSideInv.connect(this.widthMerge, 0, 1);   // R' = M − wS
    this.widthMerge.connect(this.widthOutGain);
    this.widthOutGain.connect(this.master);
    this.master.connect(this.clipPre);
    this.clipPre.connect(this.softClip);
    this.softClip.connect(this.output);
    this.output.connect(dest);

    this.lfo1 = this.makeLfoBank();
    this.lfo2 = this.makeLfoBank();

    this.noiseBuffer = FireCommandSynth.makeNoise(ctx);

    this.ringCarrier.start();
    this.cLfoL.start();
    this.cLfoR.start();
    this.phaserLfo.start();

    this.recomputeMatrix();
    // The reverb IR is built lazily by applyBusParams the first time the mix
    // is non-zero, so the convolver isn't burning CPU on silence at the
    // default (dry) patch.
    this.applyBusParams(this.patch);
    this.applyLfoParams(this.patch);
    this.applySpectral(this.patch);
    // Mod timer starts on first note (playNote / noteOn) — keeps OfflineAudioContext quiet.
  }

  private startModTimer(): void {
    if (this.offlineSafe) return;
    if (this.modTimer) return;
    this.idleFrames = 0;
    this.modTimer = setInterval(this.updateMod, 1000 / 60);
  }

  private stopModTimer(): void {
    if (!this.modTimer) return;
    clearInterval(this.modTimer);
    this.modTimer = null;
  }

  setMaxVoices(n: number): void { this.maxVoices = Math.round(clamp(n, 2, 48)); }
  getMaxVoices(): number { return this.maxVoices; }

  /**
   * Oscillator-source cost of ONE voice of the current patch. Every unison
   * osc, the sub, the noise source and the FM operator all render per voice —
   * this is what actually loads the audio thread.
   */
  private voiceSourceCost(p: FirePatch): number {
    const unison = Math.round(clamp(Math.min(p.unison, liveUnisonCap(p)), 1, MAX_UNISON));
    const groups = 2 + (p.oscCLevel > 0.0001 ? 1 : 0); // A and B always exist
    // High Continuity runs a second (oscHi) oscillator per unison voice for the
    // dual-frame morph crossfade, doubling the real oscillator count. The old
    // budget ignored this and admitted ~2× too many voices on morphing patches.
    const morphMul = (p.oscAContinuity ?? 0) >= 0.12 ? 2 : 1;
    const fm = (p.fmEngine ?? "classic") === "ops4" ? 4 : 1;
    return unison * groups * morphMul + 3 + fm; // + sub + subHarm + noise + FM weight
  }

  /**
   * Polyphony cap that adapts to how EXPENSIVE the current patch is.
   *
   * ROOT CAUSE (issue #2, "some voices slow playback down"): polyphony was a
   * flat voice count, but a voice's real cost varies ~8× between patches. A
   * supersaw like CONTRAIL (unison 7 × 3 osc groups ≈ 24 sources per voice)
   * at 12 voices spins up ~290 oscillators + as many panners — the audio
   * render thread falls behind and playback audibly stutters/slows. Budgeting
   * SOURCES instead of voices keeps the worst-case node count flat: cheap
   * patches keep their full polyphony, monster patches steal voices sooner
   * (inaudible — the oldest, already-releasing voice goes first).
   *
   * The budget equals the default patch's full allowance (12 voices × 9
   * sources), so existing moderate patches behave exactly as before.
   */
  private effectiveMaxVoices(p: FirePatch): number {
    // Scale the oscillator budget with the user-chosen voice cap so raising
    // polyphony actually unlocks more simultaneous notes on capable machines
    // (default 12×8 = 96 matches the historical fixed budget).
    const OSC_BUDGET = Math.max(96, this.maxVoices * 8);
    const byBudget = Math.floor(OSC_BUDGET / this.voiceSourceCost(p));
    const chipCap = Math.round(p.chipVoiceLimit ?? 0);
    const cap = chipCap > 0 ? Math.min(this.maxVoices, chipCap) : this.maxVoices;
    // 4-op FM is heavier — steal sooner.
    const fmPenalty = (p.fmEngine ?? "classic") === "ops4" ? 0.7 : 1;
    // Spectral STFT is a global bus tax — leave fewer voices when it's on.
    const spectralOn = (p.spectralMode ?? "off") !== "off" && (p.spectralMix ?? 0) > 0.05;
    const spectralPenalty = spectralOn ? 0.55 : 1;
    return clamp(Math.min(cap, Math.floor(byBudget * fmPenalty * spectralPenalty)), 2, 48);
  }

  /** 0..1 — how hard the current patch + active voices are hitting CPU. */
  getCpuPressure(): number {
    const p = this.patch;
    const uni = Math.round(clamp(Math.min(p.unison, liveUnisonCap(p)), 1, MAX_UNISON));
    const groups = 2 + (p.oscCLevel > 0.0001 ? 1 : 0);
    const sources = this.voiceSourceCost(p);
    const voiceLoad = (sources * Math.max(1, this.voices.size)) / 72;
    const spectral = (p.spectralMode ?? "off") !== "off" && (p.spectralMix ?? 0) > 0.05 ? 0.35 : 0;
    const fx =
      (p.crush > 0.4 ? 0.08 : 0)
      + (p.chorusMix > 0.2 ? 0.06 : 0)
      + (p.phaserMix > 0.2 ? 0.05 : 0)
      + (p.reverbMix > 0.25 ? 0.08 : 0)
      + (p.delayMix > 0.2 ? 0.05 : 0);
    return clamp(voiceLoad * 0.55 + spectral + fx + (uni * groups > 24 ? 0.1 : 0), 0, 1);
  }

  private makeLfoBank(): LfoBank {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    const sh = ctx.createConstantSource();
    const shGain = ctx.createGain();
    const sum = ctx.createGain();
    const filterDepth = ctx.createGain();
    const pitchDepth = ctx.createGain();
    const panDepth = ctx.createGain();
    const ampDepth = ctx.createGain();
    oscGain.gain.value = 1;
    shGain.gain.value = 0;
    filterDepth.gain.value = 0;
    pitchDepth.gain.value = 0;
    panDepth.gain.value = 0;
    ampDepth.gain.value = 0;
    osc.connect(oscGain).connect(sum);
    sh.connect(shGain).connect(sum);
    sum.connect(filterDepth);
    sum.connect(pitchDepth);
    sum.connect(panDepth);
    sum.connect(ampDepth);
    panDepth.connect(this.autopan.pan);
    ampDepth.connect(this.tremolo.gain);
    osc.start();
    sh.start();
    return { osc, oscGain, sh, shGain, sum, filterDepth, pitchDepth, panDepth, ampDepth };
  }

  private static makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Short LFSR-ish / periodic noise buffers for chip characters. */
  private static makeChipNoise(ctx: AudioContext, mode: ChipNoiseMode): AudioBuffer {
    const sr = ctx.sampleRate;
    // Step lengths are pinned to time, not samples: a fixed sample count made
    // the loop pitch and LFSR rate track the device sample rate (a 96 kHz
    // machine heard these an octave up from a 48 kHz one).
    const stepSamples = Math.max(1, Math.round(sr / 48000));
    if (mode === "periodic") {
      // Metallic short loop — harsh digital tone noise (~1 kHz at any rate).
      const len = 48 * stepSamples;
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const s = Math.floor(i / stepSamples);
        d[i] = (((s * 7) & 15) / 7.5 - 1) * 0.95;
      }
      return buf;
    }
    // Hold / Soft: long buffer with stepped LFSR bits (4-bit / softer hold).
    const len = Math.floor(sr * 1.5);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let reg = 1;
    const hold = (mode === "nes" ? 10 : 5) * stepSamples;
    let bit = 0;
    for (let i = 0; i < len; i++) {
      if (i % hold === 0) {
        const b0 = reg & 1;
        const b1 = (reg >> (mode === "nes" ? 1 : 6)) & 1;
        reg = (reg >> 1) | ((b0 ^ b1) << 14);
        bit = b0 ? 1 : -1;
      }
      d[i] = bit * 0.9;
    }
    return buf;
  }

  noiseBufferFor(mode: ChipNoiseMode | undefined): AudioBuffer {
    const m = mode ?? "white";
    if (m === "white") return this.noiseBuffer;
    if (m === "nes") {
      if (!this.nesNoiseBuffer) this.nesNoiseBuffer = FireCommandSynth.makeChipNoise(this.ctx, "nes");
      return this.nesNoiseBuffer;
    }
    if (m === "gb") {
      if (!this.gbNoiseBuffer) this.gbNoiseBuffer = FireCommandSynth.makeChipNoise(this.ctx, "gb");
      return this.gbNoiseBuffer;
    }
    if (!this.periodicNoiseBuffer) this.periodicNoiseBuffer = FireCommandSynth.makeChipNoise(this.ctx, "periodic");
    return this.periodicNoiseBuffer;
  }

  private buildReverbIR(p: FirePatch): void {
    const sr = this.ctx.sampleRate;
    const size = clamp(p.reverbSize, 0.2, 6);
    const damp = clamp(p.reverbDamp ?? 0.45, 0, 1);
    const diff = clamp(p.reverbDiffusion ?? 0.7, 0, 1);
    // THE CAVE FIX. The old IR decayed POLYNOMIALLY ((1−t)^~2.3): at half the
    // tail it was still only −14 dB, so a size-6 preset kept audible wash
    // 3+ seconds after every note — users heard "playing in a cave with no
    // clarity". Real rooms decay exponentially (linear in dB). `size` now
    // maps to an RT60 and the tail hits −60 dB exactly there.
    const rt60 = 0.18 + size * 0.5; // 0.28 s (size .2) … 3.18 s (size 6)
    const len = Math.max(64, Math.floor(sr * Math.min(6, rt60 * 1.05 + 0.06)));
    const ir = this.ctx.createBuffer(2, len, sr);
    const earlyEnd = 0.014 + 0.014 * size; // 17…98 ms early-reflection window
    const eN = Math.min(len - 1, Math.floor(earlyEnd * sr));
    const k60 = Math.log(1000) / Math.max(1, rt60 * sr); // −60 dB at rt60
    const tapCount = 6 + Math.round(diff * 8);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      // Tail: noise through a one-pole whose damping CLOSES OVER TIME — the
      // old builder muffled the entire IR (earlies included) with one static
      // coefficient, which is the other half of why everything sounded like
      // it was behind a blanket. Bright onset, progressively darker tail.
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const prog = Math.min(1, i / (rt60 * sr));
        const c = Math.min(0.92, 0.05 + damp * 0.28 + (0.3 + damp * 0.5) * prog);
        const noise = Math.random() * 2 - 1;
        lp = lp * c + noise * (1 - c);
        d[i] = lp * (0.35 + diff * 0.65) * Math.exp(-k60 * i);
      }
      // Fade the dense tail in across the early window so the direct sound
      // and discrete reflections stay articulate before the wash arrives.
      for (let i = 0; i < eN; i++) d[i] *= i / eN;
      // Early reflections: sparse DETERMINISTIC taps (seeded per channel for
      // stereo, stable across rebuilds) instead of the old random crackle.
      let s = ch === 0 ? 0x9e3779b9 : 0x85ebca6b;
      const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0xffffffff);
      for (let k = 0; k < tapCount; k++) {
        const pos = Math.floor((0.004 + rnd() * Math.max(0.004, earlyEnd - 0.004)) * sr);
        if (pos >= len) continue;
        const amp = (1 - pos / Math.max(1, earlyEnd * sr)) * (0.5 + rnd() * 0.5);
        d[pos] += (rnd() < 0.5 ? -1 : 1) * amp * 0.6;
      }
    }
    this.reverbConv.buffer = ir;
    this.lastIrKey = `${size.toFixed(2)}|${damp.toFixed(2)}|${diff.toFixed(2)}`;
  }

  private bankFor(id: string, f0 = 220): PeriodicWave[] {
    return this.activeBankFor(id, mipLevelForFreq(f0, this.ctx.sampleRate));
  }

  /** Pitch-mip bank for a table (used by Voice on glide / retune). */
  bankAtMip(id: string, mip: number): PeriodicWave[] {
    return this.activeBankFor(id, mip);
  }

  /**
   * Per-subframe constant-loudness gains for a table, derived once from the
   * full-resolution spectrum and reused across that table's mips — so tables
   * sit at an even level and a note gliding across a mip boundary doesn't step.
   */
  private baseGainsFor(id: string): number[] {
    let gains = this.bankGains.get(id);
    if (gains) return gains;
    gains = new Array<number>(SUBFRAMES);
    for (let k = 0; k < SUBFRAMES; k++) {
      const f = SUBFRAMES > 1 ? k / (SUBFRAMES - 1) : 0;
      gains[k] = loudnessGain(harmonicsAt(id, f, NUM_PARTIALS).imag);
    }
    this.bankGains.set(id, gains);
    return gains;
  }

  /** Render one table's one mip level into SUBFRAMES PeriodicWaves. */
  private buildFrames(id: string, mip: number, gains: number[], warp: WarpSpec | null): PeriodicWave[] {
    const maxP = MIP_PARTIALS[mip]!;
    const frames: PeriodicWave[] = [];
    for (let k = 0; k < SUBFRAMES; k++) {
      const f = SUBFRAMES > 1 ? k / (SUBFRAMES - 1) : 0;
      const { real, imag } = harmonicsAt(id, f, maxP);
      const spec = warp
        ? applyWarp(imag, warp.stretch, warp.tilt, warp.comb, warp.mode)
        : imag;
      const g = gains[k]!;
      for (let n = 1; n < spec.length; n++) spec[n]! *= g;
      frames.push(this.ctx.createPeriodicWave(real, spec, { disableNormalization: true }));
    }
    return frames;
  }

  private baseBankFor(id: string, mip = 0): PeriodicWave[] {
    const key = WAVETABLE_ID_SET.has(id) ? id : "saw";
    const i = clamp(mip | 0, 0, MIP_PARTIALS.length - 1);
    let mips = this.banks.get(key);
    if (!mips) {
      mips = new Array<PeriodicWave[] | undefined>(MIP_PARTIALS.length);
      this.banks.set(key, mips);
    }
    let frames = mips[i];
    if (!frames) {
      frames = this.buildFrames(key, i, this.baseGainsFor(key), null);
      mips[i] = frames;
    }
    return frames;
  }

  /**
   * Pre-build the banks the patch is about to ask for, off the note-on path.
   * Two mip levels (bass + mid register) cover ordinary playing; anything
   * further out builds lazily on first use.
   */
  private warmBanks(p: FirePatch): void {
    const sr = this.ctx.sampleRate;
    const tables: Array<[string, number]> = [
      [p.oscATable, p.oscAOctave],
      [p.oscBTable, p.oscBOctave],
      [p.oscCTable, p.oscCOctave],
    ];
    for (const [id, oct] of tables) {
      const shift = Math.pow(2, oct ?? 0);
      this.activeBankFor(id, mipLevelForFreq(110 * shift, sr));
      this.activeBankFor(id, mipLevelForFreq(440 * shift, sr));
    }
  }

  // ── Spectral warps (v1.7) ──
  // Base banks stay cached forever; a non-zero warp lazily renders WARPED
  // subframes per in-use table+mip, invalidated whenever the warp signature
  // changes. Knob drags are debounced (~80 ms) so scrubbing doesn't re-render
  // hundreds of waves per mousemove.
  private readonly warpedBanks = new Map<string, (PeriodicWave[] | undefined)[]>();
  private readonly warpedGains = new Map<string, number[]>();
  private warpedSig = "";
  private warpTimer: ReturnType<typeof setTimeout> | null = null;

  private hasWarp(p: FirePatch): boolean {
    if (p.moduleEnable?.["fire.sec.warp"] === false) return false;
    const amt = Math.abs(p.warpAmount ?? 1);
    if (amt < 0.001) return false;
    const mode = p.warpMode ?? "classic";
    if (mode !== "classic") return true;
    return Math.abs(p.warpStretch ?? 0) > 0.001
      || Math.abs(p.warpTilt ?? 0) > 0.001
      || (p.warpComb ?? 0) > 0.001;
  }

  private activeBankFor(id: string, mip = 0): PeriodicWave[] {
    const p = this.patch;
    const mipI = clamp(mip | 0, 0, MIP_PARTIALS.length - 1);
    if (!this.hasWarp(p)) return this.baseBankFor(id, mipI);
    const amt = clamp(p.warpAmount ?? 1, -1, 1);
    const stretch = (p.warpStretch ?? 0) * amt;
    const tilt = (p.warpTilt ?? 0) * amt;
    const comb = (p.warpComb ?? 0) * Math.abs(amt);
    const mode = p.warpMode ?? "classic";
    const sig = `${mode}|${stretch}|${tilt}|${comb}|${amt}`;
    if (sig !== this.warpedSig) {
      // A warp knob mid-scrub: rebuilding a bank costs tens of ms on the MAIN
      // thread (SUBFRAMES × createPeriodicWave). The 80 ms debounce covered
      // re-binding live voices but not NOTE-ONS — so playing (or arpeggiating)
      // while dragging a warp knob paid a full rebuild per note and stalled
      // audibly. Serve the last rendered banks until the scrub settles; the
      // debounce then rebuilds exactly once.
      if (this.warpTimer !== null) {
        const held = this.warpedBanks.get(WAVETABLE_ID_SET.has(id) ? id : "saw")?.[mipI];
        if (held) return held;
      }
      this.warpedBanks.clear();
      this.warpedGains.clear();
      this.warpedSig = sig;
    }
    const key = WAVETABLE_ID_SET.has(id) ? id : "saw";
    const warp: WarpSpec = { stretch, tilt, comb, mode };
    let mips = this.warpedBanks.get(key);
    if (!mips) {
      mips = new Array<PeriodicWave[] | undefined>(MIP_PARTIALS.length);
      this.warpedBanks.set(key, mips);
    }
    let frames = mips[mipI];
    if (!frames) {
      let gains = this.warpedGains.get(key);
      if (!gains) {
        // Full-res warped gain per subframe, reused across this table's mips.
        gains = new Array<number>(SUBFRAMES);
        for (let k = 0; k < SUBFRAMES; k++) {
          const f = SUBFRAMES > 1 ? k / (SUBFRAMES - 1) : 0;
          const full = applyWarp(harmonicsAt(key, f, NUM_PARTIALS).imag, stretch, tilt, comb, mode);
          gains[k] = loudnessGain(full);
        }
        this.warpedGains.set(key, gains);
      }
      frames = this.buildFrames(key, mipI, gains, warp);
      mips[mipI] = frames;
    }
    return frames;
  }

  /** Swap all live voices onto the (possibly warped) banks for the current patch. */
  private applyWarpBanks(): void {
    for (const v of this.voices) {
      const f0 = v.baseFreq;
      const p = this.patch;
      v.rebindBanks(
        p,
        f0 * Math.pow(2, p.oscAOctave),
        f0 * Math.pow(2, p.oscBOctave),
        f0 * Math.pow(2, p.oscCOctave),
      );
    }
  }

  /**
   * Digest the modulation matrix into the flat `mtxRoutes` list + destination
   * flags. Called only when the matrix changes (preset load, slot edit) so the
   * 60 Hz updater never scans dead slots or re-derives which targets are live.
   */
  private recomputeMatrix(): void {
    const A = this.mtxA;
    A.reso = A.fm = A.lvlA = A.lvlB = A.lvlC = false;
    let hasGlobal = false;
    let hasPerVoice = false;
    let hasReverb = false;
    const routes: ModRoute[] = [];
    for (const r of this.patch.modMatrix ?? []) {
      if (r.source === "none" || r.dest === "none" || r.amount === 0) continue;
      routes.push(r);
      switch (r.dest) {
        case "reverb": hasGlobal = true; hasReverb = true; break;
        case "pan": case "volume": case "delay":
        case "chorusMix": case "phaserMix": case "drive": case "spectral":
          hasGlobal = true; break;
        case "resonance": A.reso = true; hasPerVoice = true; break;
        case "fm": A.fm = true; hasPerVoice = true; break;
        case "levelA": A.lvlA = true; hasPerVoice = true; break;
        case "levelB": A.lvlB = true; hasPerVoice = true; break;
        case "levelC": A.lvlC = true; hasPerVoice = true; break;
        case "pitch": case "cutoff": case "wtA": case "wtB": case "wtC": hasPerVoice = true; break;
      }
    }
    this.mtxRoutes = routes;
    this.mtxHasGlobal = hasGlobal;
    this.mtxHasPerVoice = hasPerVoice;
    this.mtxHasReverbRoute = hasReverb;
  }

  /**
   * Value of a modulation source this frame. A plain method (not a per-frame
   * closure) so the hot loop allocates nothing. Per-note sources read 0 when
   * `v` is null (global/bus destinations).
   */
  private modSource(src: ModSource, lfo1: number, lfo2: number, me: number, v: Voice | null): number {
    const macrosOn = this.patch.moduleEnable?.["macros"] !== false;
    const mapMacro = (raw: number, idx: number): number => {
      if (!macrosOn) return 0;
      const mode = this.patch.macroResponse ?? "absolute";
      let x = clamp(raw, 0, 1);
      if (mode === "smoothed") {
        const a = 0.12;
        this.macroSmooth[idx] += (x - this.macroSmooth[idx]) * a;
        x = this.macroSmooth[idx];
      }
      if (mode === "bipolar") return x * 2 - 1;
      if (mode === "relative") {
        // Delta from the values captured when Relative was armed.
        return clamp(x - this.macroBaseline[idx], -1, 1);
      }
      // absolute — matrix already scales by amount
      return x;
    };
    switch (src) {
      case "lfo1": return lfo1;
      case "lfo2": return lfo2;
      case "random": return this.mtxRandVal;
      case "macro1": return mapMacro(this.patch.macro1, 0);
      case "macro2": return mapMacro(this.patch.macro2, 1);
      case "macro3": return mapMacro(this.patch.macro3, 2);
      case "macro4": return mapMacro(this.patch.macro4, 3);
      case "modenv": return v ? me : 0;
      case "velocity": return v ? v.velocity : 0;
      case "keytrack": return v ? clamp((v.midi - 60) / 36, -1, 1) : 0;
      default: return 0;
    }
  }

  /** Frames since the last voice ended — lets the mod loop idle out. */
  private idleFrames = 0;
  /** True after audible play this wake — idle flush clears shared limiter poison. */
  private sessionNeedsFlush = false;

  // ── control-rate modulation updater (matrix + morph + gate + drift) ──
  private updateMod = (): void => {
    // Idle gate: sleep the 60 Hz timer after ~5 s with no voices (tails need
    // a few seconds). noteOn / playNote / setPatch restart it. Skipped for
    // offline render ticks — there is no timer to stop, and a bounce must keep
    // shaping the gate / LFOs through the gaps between notes.
    if (!this.offlineTick && this.voices.size === 0 && this.arpQueue.length === 0) {
      if (!isArpKeepAlive() && ++this.idleFrames > 300) {
        // IceKing / NS leave DynamicsCompressor GR pinned on the shared master
        // path. Preset switch already flushes; also flush when a long session
        // goes quiet so the next note/preset isn't already crushed.
        if (this.sessionNeedsFlush) {
          this.sessionNeedsFlush = false;
          try {
            this.flushBusContamination(this.ctx.currentTime, { rebuildDelay: true });
            this.applyBusParams(this.patch);
          } catch { /* ignore */ }
        }
        this.stopModTimer();
        return;
      }
    } else {
      this.idleFrames = 0;
      this.sessionNeedsFlush = true;
    }

    if (isArpKeepAlive() && this.voices.size === 0 && this.arpQueue.length === 0) {
      this.idleFrames = 0;
    }

    // Materialize deferred ARP notes just before they sound.
    this.flushArpQueue();

    const now = this.ctx.currentTime;
    const p = this.patch;

    // Reapply bus params when the hot-arp state flips so the space duck
    // (delay/reverb wet trims in applyBusParams) engages and releases with
    // the arp instead of waiting for the next unrelated knob touch.
    {
      const hotNow = isHotArp();
      if (hotNow !== this.lastHotArpState) {
        this.lastHotArpState = hotNow;
        try { this.applyBusParams(p); } catch { /* ignore */ }
      }
    }

    // Restore voiceBus pad after hot ARP cools (updatePolyGain otherwise only
    // runs on voice edges and can leave the bus ducked forever).
    if (!isHotArp() && this.voices.size === 0 && this.dying.size === 0 && this.arpQueue.length === 0) {
      const target = VOICE_HEADROOM;
      if (Math.abs(this.voiceBus.gain.value - target) > 0.02) {
        this.voiceBus.gain.setTargetAtTime(target, now, 0.03);
      }
    }

    if (this.voices.size > 0) {
      // IceKing-class delay patches slowly fill ping-pong buffers and pin the
      // shared Fire limiter. Rebuild dynamics before reboot-only poison sticks.
      // Hot ARP: still allow an *emergency* dynamics rebuild (no delay rebuild)
      // when GR is deeply pinned — previously we never flushed while hot.
      if (this.getLimiterReduction) {
        const gr = this.getLimiterReduction();
        const hot = isHotArp();
        const pinDb = hot ? -8 : -3;
        const pinFrames = hot ? 90 : 36; // ~1.5 s hot / ~0.6 s cool at 60 Hz
        if (gr < pinDb) {
          this.limiterPinFrames++;
          // BACKOFF. A limiter holding -3 dB of gain reduction is usually a
          // limiter doing its job on a loud patch, not evidence of poisoned
          // state. The old code flushed, reset the counter to 0, and left the
          // level untouched — so a genuinely loud patch re-pinned immediately
          // and this looped at ~1.6 Hz indefinitely, rebuilding the delay
          // lines and all four shared compressors every time. Each rebuild
          // cuts the FX tails and lets one burst through a zero-state
          // compressor, which is itself audible as distortion, which keeps
          // the limiter pinned: a self-sustaining failure needing a relaunch.
          //
          // A flush only helps if state is actually stuck, so retrying at a
          // fixed fast rate can never be right. Each successive flush now
          // waits twice as long, and the ladder only resets once the limiter
          // has genuinely recovered (see the else branch).
          if (this.limiterPinFrames >= pinFrames * this.limiterFlushBackoff) {
            this.limiterPinFrames = 0;
            this.limiterFlushBackoff = Math.min(32, this.limiterFlushBackoff * 2);
            try {
              this.flushBusContamination(now, { rebuildDelay: !hot });
              this.onFlushContamination?.();
              if (!hot && (p.delayMix ?? 0) > 0.12) {
                this.applyBusParams(p);
              }
            } catch { /* ignore */ }
          }
        } else {
          this.limiterPinFrames = Math.max(0, this.limiterPinFrames - 1);
          // Sustained recovery (~1 s of unpinned limiter) means whatever we
          // did worked, or there was never a problem — re-arm at full speed.
          if (this.limiterPinFrames === 0) {
            this.limiterUnpinFrames++;
            if (this.limiterUnpinFrames >= 60) {
              this.limiterUnpinFrames = 0;
              this.limiterFlushBackoff = 1;
            }
          }
        }
      }
      // Never rebuild delay/chorus/predelay nodes mid-bounce: swapping graph
      // nodes while an OfflineAudioContext renders would punch a hole in the
      // export. The contamination this guards against needs a long live
      // session to build up anyway.
      if (!this.offlineTick && (p.delayMix ?? 0) > 0.12 && !isHotArp()) {
        this.delayHotFrames++;
        // ~30 s of sustained delay-heavy play: rebuild lines even if limiter
        // hasn't pinned yet (slow IceKing breakdown while still on the preset).
        if (this.delayHotFrames >= 1800) {
          this.delayHotFrames = 0;
          try {
            this.rebuildDelayLines();
            this.rebuildChorusDelays();
            this.rebuildReverbPredelay();
            this.onFlushContamination?.();
            this.applyBusParams(p);
          } catch { /* ignore */ }
        }
      } else {
        this.delayHotFrames = 0;
      }

      // ── Dead-output self-heal ──
      // Last line of defense for "played for hours, then it just stopped":
      // if voices have been sounding for a while but the output is EXACTLY
      // zero (or non-finite) for ~2.5 s straight, some bus stage latched a
      // bad state. Flush and reassert the patch; escalate to a full graph
      // rebuild if a heal repeats within 10 s. False positives are made
      // near-impossible by requiring settled voices + audible master gain,
      // and a spurious flush is inaudible anyway (it only clears FX tails).
      if (this.healthAnalyser && !this.fxSilenced && (p.masterGain ?? 0.72) > 0.05) {
        // Arm whenever any voice has been alive ≥250 ms — arp one-shots are
        // short-lived, so requiring a long-settled non-releasing voice made
        // the watchdog blind during exactly the workload that kills audio.
        // The 4 s persistence window below is what prevents false alarms
        // (slow pad attacks, quiet patches between notes).
        const anyAudible = [...this.voices].some((v) => v.startedAt < now - 0.25);
        if (anyAudible) {
          if (!this.healthBuf || this.healthBuf.length !== this.healthAnalyser.fftSize) {
            this.healthBuf = new Float32Array(this.healthAnalyser.fftSize);
          }
          this.healthAnalyser.getFloatTimeDomainData(this.healthBuf);
          let peak = 0;
          for (let i = 0; i < this.healthBuf.length; i++) {
            const a = Math.abs(this.healthBuf[i]!);
            if (a > peak) peak = a;
          }
          const dead = !(peak > 0) || !Number.isFinite(peak);
          if (dead) {
            this.deadOutputFrames++;
            if (this.deadOutputFrames >= 240) {
              this.deadOutputFrames = 0;
              const escalate = now - this.healSameTickGuard < 12;
              this.healSameTickGuard = now;
              try {
                if (escalate) {
                  // Second heal in 12 s: flush didn't stick — rebuild the
                  // whole voice/bus graph from the current patch.
                  this.setPatch(this.patch);
                } else {
                  this.flushBusContamination(now, { rebuildDelay: true });
                  this.applyBusParams(p);
                  this.onFlushContamination?.();
                }
                console.warn(
                  `[FireCommand] dead-output watchdog ${escalate ? "rebuilt graph" : "flushed bus"}`,
                );
              } catch { /* ignore */ }
            }
          } else {
            // Decay instead of hard reset: intermittent single live samples
            // must not let a mostly-dead bus evade the watchdog forever.
            this.deadOutputFrames = Math.max(0, this.deadOutputFrames - 8);
          }
        }
      }
      this.pruneDying();
    }

    // Stepping the S&H value with setValueAtTime was a sample-accurate jump —
    // audible as a click/zipper on pitch and cutoff. A sub-audio ramp keeps the
    // stepped character but removes the discontinuity.
    if (p.lfo1Wave === "sample-hold") {
      const step = Math.floor(now * clamp(p.lfo1Rate, 0.01, 40));
      if (step !== this.sh1Step) {
        this.sh1Step = step;
        this.sh1Val = Math.random() * 2 - 1;
        const o = this.lfo1.sh.offset;
        o.cancelScheduledValues(now);
        o.setValueAtTime(o.value, now);
        o.linearRampToValueAtTime(this.sh1Val, now + SH_SLEW_SEC);
      }
    }
    if (p.lfo2Wave === "sample-hold") {
      const step = Math.floor(now * clamp(p.lfo2Rate, 0.01, 40));
      if (step !== this.sh2Step) {
        this.sh2Step = step;
        this.sh2Val = Math.random() * 2 - 1;
        const o = this.lfo2.sh.offset;
        o.cancelScheduledValues(now);
        o.setValueAtTime(o.value, now);
        o.linearRampToValueAtTime(this.sh2Val, now + SH_SLEW_SEC);
      }
    }
    // Matrix random source — a stepped sample/hold independent of the LFOs.
    const rstep = Math.floor(now * 6);
    if (rstep !== this.mtxRandStep) { this.mtxRandStep = rstep; this.mtxRandVal = Math.random() * 2 - 1; }

    const lfoPair = this.computeTwinLfos(p, now);
    const lfo1 = lfoPair.lfo1;
    const lfo2 = lfoPair.lfo2;
    const routes = this.mtxRoutes;
    const matrixOn = p.moduleEnable?.["matrix"] !== false;

    // Helper: amount × transformed source, with optional slew.
    const routeContrib = (r: ModRoute, slotHint: number, src: number): number => {
      const s = applyRouteSource(src, r);
      let out = r.amount * s;
      const sm = r.smooth ?? 0;
      if (sm > 0.02) {
        const idx = Math.max(0, Math.min(MOD_SLOTS - 1, slotHint));
        const a = 0.04 + (1 - sm) * 0.35;
        this.mtxSmooth[idx] += (out - this.mtxSmooth[idx]) * a;
        out = this.mtxSmooth[idx];
      }
      return out;
    };

    // ── global (bus) destinations ──
    let gPan = false, gVol = false, gRev = false, gDly = false;
    if (matrixOn && this.mtxHasGlobal) {
      let accPan = 0, accVol = 0, accRev = 0, accDly = 0;
      let accCh = 0, accPh = 0, accDr = 0, accSp = 0;
      let gCh = false, gPh = false, gDr = false, gSp = false;
      for (let i = 0; i < routes.length; i++) {
        const r = routes[i];
        const src = this.modSource(r.source, lfo1, lfo2, 0, null);
        const c = routeContrib(r, i, src);
        switch (r.dest) {
          case "pan": accPan += c; gPan = true; break;
          case "volume": accVol += c; gVol = true; break;
          case "reverb": accRev += c; gRev = true; break;
          case "delay": accDly += c; gDly = true; break;
          case "chorusMix": accCh += c; gCh = true; break;
          case "phaserMix": accPh += c; gPh = true; break;
          case "drive": accDr += c; gDr = true; break;
          case "spectral": accSp += c; gSp = true; break;
        }
      }
      if (gPan) this.autopan.pan.setTargetAtTime(clamp(accPan, -1, 1), now, 0.02);
      // Soft-saturate stacked volume routes so multiple LFO→volume paths can't
      // crest into a sudden 1.4× slam (clean → distorted).
      if (gVol) {
        const softVol = Math.tanh(accVol * 0.85) * 1.05;
        this.master.gain.setTargetAtTime(clamp(p.masterGain * (1 + softVol), 0, 1.15), now, 0.02);
      }
      if (gRev && !this.fxSilenced) this.reverbWet.gain.setTargetAtTime(clamp(p.reverbMix + accRev, 0, 1), now, 0.03);
      if (gDly && !this.fxSilenced) this.delayWet.gain.setTargetAtTime(clamp(p.delayMix + accDly, 0, 1), now, 0.03);
      if (gCh && !this.fxSilenced) this.chorusWet.gain.setTargetAtTime(clamp(p.chorusMix + accCh, 0, 1), now, 0.03);
      if (gPh && !this.fxSilenced) this.phaserWet.gain.setTargetAtTime(clamp(p.phaserMix + accPh, 0, 1), now, 0.03);
      if (gDr) this.drivePre.gain.setTargetAtTime(clamp((p.driveInGain ?? 1) * (1 + (p.drive + accDr) * 1.2) / DRIVE_RANGE, 0.05, 2), now, 0.03);
      if (gSp && p.spectralMode !== "off") {
        /* spectral mix modulated in applySpectral on next set — store soft */
        this.spectralSend.gain.setTargetAtTime(clamp((p.spectralMix ?? 0.5) + accSp, 0, 1), now, 0.04);
      }
    }
    // Restore the bus base value exactly once when a global route is removed.
    if (!gPan && this.gPanWas) this.autopan.pan.setTargetAtTime(0, now, 0.05);
    if (!gVol && this.gVolWas) this.master.gain.setTargetAtTime(clamp(p.masterGain, 0, 1.15), now, 0.05);
    if (!gRev && this.gRevWas && !this.fxSilenced) this.reverbWet.gain.setTargetAtTime(clamp(p.reverbMix, 0, 1), now, 0.05);
    if (!gDly && this.gDlyWas && !this.fxSilenced) this.delayWet.gain.setTargetAtTime(clamp(p.delayMix, 0, 1), now, 0.05);
    this.gPanWas = gPan; this.gVolWas = gVol; this.gRevWas = gRev; this.gDlyWas = gDly;

    // ── trance gate ── (only touch the param when the target actually moves)
    let gateTarget = 1;
    if (p.gateOn && p.moduleEnable?.["gate"] !== false && (p.gateDest ?? "volume") === "volume") {
      const steps = Math.max(1, Math.min(16, Math.round(p.gateSteps)));
      const idx = Math.floor(now * clamp(p.gateRate, 0.25, 24)) % steps;
      const openAmt = clamp(p.gatePattern[idx] ?? 1, 0, 1);
      // Continuous per-step depth: openAmt=1 → full; 0 → cut by gateDepth.
      gateTarget = clamp(1 - p.gateDepth * (1 - openAmt), 0, 1);
    }
    if (gateTarget !== this.lastGateTarget) {
      // gateSmooth (Edge) stretches the edge time-constant: 4 ms → ~60 ms.
      const tc = 0.004 + clamp(p.gateSmooth ?? 0, 0, 1) * 0.056;
      this.gateGain.gain.setTargetAtTime(gateTarget, now, p.gateOn ? tc : 0.02);
      this.lastGateTarget = gateTarget;
    }

    const lifeOn = p.moduleEnable?.["analog.life"] !== false;
    const pvActive = (lifeOn && (p.drift > 0 || (p.voiceInstability ?? 0) > 0 || (p.tuneVariance ?? 0) > 0
      || (p.envVariance ?? 0) > 0)) || (matrixOn && this.mtxHasPerVoice);
    const A = this.mtxA;
    const m = this.mScratch;

    let dispA = clamp(p.oscAPos, 0, 1);
    let dispB = clamp(p.oscBPos, 0, 1);
    let dispC = clamp(p.oscCPos, 0, 1);
    if (this.voices.size > 0) {
      for (const v of this.voices) {
        const me = this.modEnvValue(v, now);
        let mWA = 0, mWB = 0, mWC = 0;
        if (pvActive && matrixOn) {
          m.pitch = 0; m.cutoff = 0; m.reso = 0; m.fm = 0; m.lvlA = 0; m.lvlB = 0; m.lvlC = 0;
          for (let i = 0; i < routes.length; i++) {
            const r = routes[i];
            const c = routeContrib(r, i, this.modSource(r.source, lfo1, lfo2, me, v));
            switch (r.dest) {
              case "pitch": m.pitch += c; break;
              case "cutoff": m.cutoff += c; break;
              case "resonance": m.reso += c; break;
              case "fm": m.fm += c; break;
              case "levelA": m.lvlA += c; break;
              case "levelB": m.lvlB += c; break;
              case "levelC": m.lvlC += c; break;
              case "wtA": mWA += c; break;
              case "wtB": mWB += c; break;
              case "wtC": mWC += c; break;
            }
          }
        } else if (pvActive) {
          m.pitch = 0; m.cutoff = 0; m.reso = 0; m.fm = 0; m.lvlA = 0; m.lvlB = 0; m.lvlC = 0;
        }
        const dutyMorph = (table: string, base: number) => {
          if (table !== "pulse" && table !== "chip") return base;
          // Map pulseDuty directly onto PWM morph (0.5 = square → f≈0, extremes → thin).
          const thin = Math.abs(clamp(p.pulseDuty ?? 0.5, 0, 1) - 0.5) * 2;
          return clamp(thin * 0.92 + base * 0.08, 0, 1);
        };
        // Morph modulation gating: oscEnv/oscLfo only apply when morph module is on.
        const morphOn = p.moduleEnable?.["morph"] !== false;
        const envMod = morphOn ? me : 0;
        const lfoMod = morphOn ? lfo1 : 0;
        const matrixWA = matrixOn ? mWA : 0;
        const matrixWB = matrixOn ? mWB : 0;
        const matrixWC = matrixOn ? mWC : 0;
        // Vector morph lives on FM Rack.
        const rackOn = p.moduleEnable?.["fm.rack"] !== false;
        const vDepth = rackOn ? clamp(p.vectorDepth ?? 0, 0, 1) : 0;
        const vRate = rackOn ? clamp(p.vectorRate ?? 0, 0, 8) : 0;
        const vec = vDepth > 0 && vRate > 0
          ? Math.sin(now * vRate * Math.PI * 2) * vDepth * 0.45
          : 0;
        const syncTilt = p.hardSync ? 0.22 : 0;
        let baseA = clamp(p.oscAPos + envMod * p.oscAEnv + lfoMod * p.oscALfo + matrixWA + vec + syncTilt, 0, 1);
        let baseB = clamp(p.oscBPos + envMod * p.oscBEnv + lfoMod * p.oscBLfo + matrixWB - vec, 0, 1);
        // Twin continuous inheritance from Prime
        const inherit = p.oscBInherit ?? "off";
        if (inherit === "morph") baseB = baseA;
        else if (inherit === "mirror") baseB = 1 - baseA;
        else if (inherit === "offset") baseB = clamp(baseA + 0.25, 0, 1);
        else if (inherit === "family") {
          // Follow A's table morph character but keep B's own offset relative to default
          baseB = clamp(baseA * 0.85 + p.oscBPos * 0.15, 0, 1);
        }
        const posA = dutyMorph(p.oscATable, baseA);
        const posB = dutyMorph(p.oscBTable, baseB);
        v.setWtA(posA, p.oscAContinuity ?? 0.72);
        v.setWtB(posB, p.oscAContinuity ?? 0.72);
        dispA = posA;
        dispB = posB;
        if (v.hasGroupC()) {
          const posC = dutyMorph(
            p.oscCTable,
            clamp(p.oscCPos + envMod * p.oscCEnv + lfoMod * p.oscCLfo + matrixWC, 0, 1),
          );
          v.setWtC(posC, p.oscAContinuity ?? 0.72);
          dispC = posC;
        }
        // Keep noise storm / burst / translate live while notes hold
        if ((p.noiseMode ?? "bed") !== "bed" || (p.subTranslate ?? 0) > 0.01) {
          v.setOscLevels(p);
        }
        if (pvActive) {
          const lifeAmt = lifeOn
            ? Math.max(p.drift, (p.voiceInstability ?? 0) * 0.55, (p.tuneVariance ?? 0) * 0.25)
            : 0;
          m.driftCents = lifeOn
            ? ((lifeAmt > 0 ? v.advanceDrift(lifeAmt, p.driftRate ?? 0.35, {
                tremor: p.analogTremor,
                breath: p.analogBreath,
                climate: p.analogClimate,
                events: p.analogEvents,
              }) : 0)
              + v.getTuneCents()
              + v.advanceInstability(p.voiceInstability ?? 0))
            : 0;
          m.aReso = matrixOn && A.reso; m.aFm = matrixOn && A.fm; m.aLvl = matrixOn && (A.lvlA || A.lvlB || A.lvlC);
          if (!matrixOn) { m.pitch = 0; m.cutoff = 0; m.reso = 0; m.fm = 0; m.lvlA = 0; m.lvlB = 0; m.lvlC = 0; }
          v.applyMatrix(p, m);
        }
      }
    }
    // When the matrix/drift go idle, return offsets to neutral exactly once.
    if (!pvActive && this.lastPvActive) for (const v of this.voices) v.clearMod();
    this.lastPvActive = pvActive;

    this.displayPosC = dispC;
    this.displayPosA = dispA;
    this.displayPosB = dispB;
  };

  private jsLfoValue(wave: LfoWave, rate: number, shVal: number, now: number): number {
    if (wave === "sample-hold") return shVal;
    const phase = (now * clamp(rate, 0.01, 40)) % 1;
    switch (wave) {
      case "sine": return Math.sin(2 * Math.PI * phase);
      case "triangle": return (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * phase));
      case "sawtooth": return 2 * phase - 1;
      case "square": return phase < 0.5 ? 1 : -1;
      default: return 0;
    }
  }

  /** AD(S) segment level at time `t` — no allocation (called per voice/frame). */
  private static adLevel(t: number, a: number, d: number, s: number): number {
    if (t <= 0) return 0; // scheduled note that hasn't started yet
    if (t < a) return t / a;
    if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
    return s;
  }

  peekModEnvLevel(v: Voice, now: number): number {
    return this.modEnvValue(v, now);
  }

  private modEnvValue(v: Voice, now: number): number {
    const p = this.patch;
    const points = normalizeModEnvPoints(
      p.modEnvPoints?.length
        ? p.modEnvPoints
        : adsrToModEnvPoints(p.modAttack, p.modDecay, p.modSustain, p.modRelease),
    );
    const susIdx = p.modEnvSustainIndex ?? points.length - 1;
    const loop = !!p.modEnvLoop;
    if (v.releaseAt == null || now < v.releaseAt) {
      return evalModEnvHeld(points, susIdx, now - v.startedAt, loop).level;
    }
    const r = Math.max(0.001, p.modRelease);
    const atRel = v["modLevelAtRelease"] as number;
    return evalModEnvRelease(points, susIdx, atRel || 0.3, r, now - v.releaseAt).level;
  }

  private envTelemetryFor(
    kind: "amp" | "mod" | "filt" | "pluck",
    v: Voice | null,
    now: number,
  ): import("./toneDifferentiation").ToneEnvTelemetry {
    if (!v) return idleTelemetry();
    const p = this.patch;
    const releasing = !!(v.releaseAt != null && now >= v.releaseAt);
    if (kind === "mod") {
      const points = normalizeModEnvPoints(
        p.modEnvPoints?.length
          ? p.modEnvPoints
          : adsrToModEnvPoints(p.modAttack, p.modDecay, p.modSustain, p.modRelease),
      );
      const susIdx = p.modEnvSustainIndex ?? points.length - 1;
      if (!releasing) {
        const e = evalModEnvHeld(points, susIdx, now - v.startedAt, !!p.modEnvLoop);
        return {
          level: e.level,
          phase: e.phase,
          stage: e.stage,
          releasing: false,
          startedAt: v.startedAt,
          releaseAt: v.releaseAt,
        };
      }
      const e = evalModEnvRelease(
        points,
        susIdx,
        (v as unknown as { modLevelAtRelease: number }).modLevelAtRelease || 0.3,
        Math.max(0.001, p.modRelease),
        now - (v.releaseAt ?? now),
      );
      return { ...e, releasing: true, startedAt: v.startedAt, releaseAt: v.releaseAt };
    }
    if (kind === "pluck" || (kind === "amp" && p.lpgOn)) {
      const model = lpgModelTimes(p.lpgModel ?? "classic", p.lpgDecay ?? 0.4, v.velocity);
      const decay = model.decay * (0.55 + clamp(p.lpgRing ?? 1, 0, 1) * 0.7);
      const strike = model.strike;
      const elapsed = now - v.startedAt;
      let stage: import("./toneDifferentiation").ToneEnvTelemetry["stage"] = "strike";
      let level = 0;
      let phase = 0;
      if (elapsed < strike) {
        stage = "strike";
        level = elapsed / Math.max(strike, 0.0001);
        phase = level * 0.15;
      } else if (elapsed < strike + decay * 0.35) {
        stage = "ring";
        const u = (elapsed - strike) / Math.max(decay * 0.35, 0.001);
        level = Math.exp(-u * 1.8);
        phase = 0.15 + u * 0.35;
      } else {
        stage = "decay_out";
        const u = (elapsed - strike) / Math.max(decay, 0.001);
        level = Math.exp(-u * 2.4) * (1 - clamp(p.lpgLeakage ?? 0, 0, 1) * 0.15 + clamp(p.lpgLeakage ?? 0, 0, 1) * 0.15);
        phase = clamp(0.5 + u * 0.5, 0, 1);
      }
      if (!(p.lpgOn && p.moduleEnable?.["pluck"] !== false) && kind === "pluck") {
        return idleTelemetry();
      }
      return { level: clamp(level, 0, 1), phase, stage, releasing, startedAt: v.startedAt, releaseAt: v.releaseAt };
    }
    // Amp / filt classic ADSR approximation from patch times
    const a = kind === "amp" ? Math.max(0.001, p.ampAttack) : Math.max(0.001, p.filtAttack);
    const d = kind === "amp" ? Math.max(0.001, p.ampDecay) : Math.max(0.001, p.filtDecay);
    const s = kind === "amp" ? clamp(p.ampSustain, 0, 1) : clamp(p.filtSustain, 0, 1);
    const r = kind === "amp" ? Math.max(0.001, p.ampRelease) : Math.max(0.001, p.filtRelease);
    if (!releasing) {
      const elapsed = now - v.startedAt;
      const level = FireCommandSynth.adLevel(elapsed, a, d, s);
      const stage = elapsed < a ? "attack" : elapsed < a + d ? "decay" : "sustain";
      const phase = clamp(elapsed / Math.max(a + d + 0.35, 0.001), 0, 0.85);
      return { level, phase, stage, releasing: false, startedAt: v.startedAt, releaseAt: v.releaseAt };
    }
    const lvl = FireCommandSynth.adLevel((v.releaseAt ?? now) - v.startedAt, a, d, s);
    const since = now - (v.releaseAt ?? now);
    const level = clamp(lvl * (1 - since / r), 0, 1);
    return {
      level,
      phase: clamp(0.75 + 0.25 * (since / r), 0, 1),
      stage: "release",
      releasing: true,
      startedAt: v.startedAt,
      releaseAt: v.releaseAt,
    };
  }

  /** Live Tone envelope telemetry for StageViz cursors. */
  getToneTelemetry(): ToneVoiceTelemetry {
    const now = this.ctx.currentTime;
    let best: Voice | null = null;
    for (const v of this.voices) {
      if (!best || v.startedAt > best.startedAt) best = v;
    }
    return {
      voiceCount: this.voices.size,
      amp: this.envTelemetryFor("amp", best, now),
      mod: this.envTelemetryFor("mod", best, now),
      filt: this.envTelemetryFor("filt", best, now),
      pluck: this.envTelemetryFor("pluck", best, now),
    };
  }

  getMorphPositions(): { a: number; b: number; c: number } {
    return { a: this.displayPosA, b: this.displayPosB, c: this.displayPosC };
  }

  /** Current trance-gate step for the UI playhead (-1 when the gate is off). */
  /**
   * Gate pattern index. `at` defaults to now (live keyboard); the sequencer
   * passes the note's scheduled time so a gate-to-velocity note is shaped by
   * the step it will actually land on — including offline renders, where
   * currentTime is 0 while every note is scheduled ahead.
   */
  getGateStep(at?: number): number {
    const p = this.patch;
    if (!p.gateOn) return -1;
    const steps = Math.max(1, Math.min(16, Math.round(p.gateSteps)));
    const when = typeof at === "number" && Number.isFinite(at) ? at : this.ctx.currentTime;
    return Math.floor(Math.max(0, when) * clamp(p.gateRate, 0.25, 24)) % steps;
  }

  /** Live LFO value (-1..1) for UI scopes — same math the mod loop uses. */
  getLfoValue(idx: 1 | 2): number {
    const p = this.patch;
    const now = this.ctx.currentTime;
    const pair = this.computeTwinLfos(p, now);
    return idx === 1 ? pair.lfo1 : pair.lfo2;
  }

  /**
   * Twin Orbit: derive LFO1/LFO2 samples with relation modes + optional Analog Life coupling.
   */
  private computeTwinLfos(p: FirePatch, now: number): { lfo1: number; lfo2: number } {
    const lifeOn = p.moduleEnable?.["analog.life"] !== false;
    const life = lifeOn ? clamp(p.drift ?? 0, 0, 1) : 0;
    // Correlated Analog Life → slight rate/phase wander on both LFOs (clamped).
    const lifeRateJitter = life > 0.01 ? 1 + Math.sin(now * 0.37) * life * 0.04 * (p.analogBreath ?? 0.45) : 1;
    const lifePhase = life > 0.01 ? Math.sin(now * 0.11) * life * 0.03 : 0;

    let rate1 = clamp(p.lfo1Rate, 0.01, 40) * lifeRateJitter;
    let wave1 = p.lfo1Wave;
    let lfo1 = this.jsLfoValue(wave1, rate1, this.sh1Val, now + lifePhase);

    const relation = p.lfo2Relation ?? "independent";
    const driftMode = p.lfo2DriftMode ?? "locked";
    let driftAmt = 0;
    if (driftMode === "elastic") {
      this.twinDriftPhase += 0.01;
      driftAmt = Math.sin(this.twinDriftPhase * 0.7) * 0.08;
    } else if (driftMode === "wandering") {
      this.twinDriftPhase += 0.017 + Math.random() * 0.004;
      driftAmt = Math.sin(this.twinDriftPhase) * 0.14 + Math.sin(this.twinDriftPhase * 0.31) * 0.06;
    }

    let rate2 = clamp(p.lfo2Rate, 0.01, 40) * lifeRateJitter;
    let wave2 = p.lfo2Wave;
    let phaseOff = ((p.lfo2PhaseOffset ?? 0) / 360) + driftAmt * 0.5 + lifePhase;
    let ratio = clamp((p.lfo2Ratio ?? 1) * (1 + driftAmt * 0.25), 0.125, 8);

    if (relation === "mirror" || relation === "invert" || relation === "phaseOffset" || relation === "ratio" || relation === "followLag") {
      wave2 = wave1;
    }
    if (relation === "ratio" || relation === "mirror" || relation === "invert" || relation === "phaseOffset") {
      rate2 = rate1 * (relation === "ratio" ? ratio : 1);
    }
    if (relation === "followLag") {
      rate2 = rate1;
    }

    let lfo2: number;
    if (relation === "independent") {
      lfo2 = this.jsLfoValue(wave2, rate2, this.sh2Val, now + lifePhase);
    } else if (relation === "followLag") {
      const target = lfo1;
      const lag = 0.08 + clamp(Math.abs(driftAmt), 0, 0.2);
      this.lfo2Follow += (target - this.lfo2Follow) * lag;
      lfo2 = this.lfo2Follow;
    } else {
      // Shared phase clock from LFO1 rate, with optional offset.
      const phase = ((now * rate1) + phaseOff) % 1;
      lfo2 = this.jsLfoAtPhase(wave2, phase, this.sh2Val);
      if (relation === "invert") lfo2 = -lfo2;
      if (relation === "mirror") {
        /* same as LFO1 shape/phase (phaseOff may still apply via drift) */
        if (Math.abs(phaseOff) < 1e-6) lfo2 = lfo1;
      }
    }

    // Soft-disable when module off is handled by depth in applyLfoParams; values still flow for matrix/viz.
    return { lfo1, lfo2 };
  }

  private jsLfoAtPhase(wave: LfoWave, phase: number, shVal: number): number {
    if (wave === "sample-hold") return shVal;
    const p = ((phase % 1) + 1) % 1;
    switch (wave) {
      case "sine": return Math.sin(p * Math.PI * 2);
      case "triangle": return 1 - 4 * Math.abs(p - 0.5);
      case "sawtooth": return 1 - 2 * p;
      case "square": return p < 0.5 ? 1 : -1;
      default: return 0;
    }
  }

  /** Pitch-aware banks for a note (each osc may sit on a different mip). */
  private banksForNote(p: FirePatch, midi: number): [PeriodicWave[], PeriodicWave[], PeriodicWave[]] {
    const f0 = midiToFreq(midi);
    return [
      this.bankFor(p.oscATable, f0 * Math.pow(2, p.oscAOctave)),
      this.bankFor(p.oscBTable, f0 * Math.pow(2, p.oscBOctave)),
      this.bankFor(p.oscCTable, f0 * Math.pow(2, p.oscCOctave)),
    ];
  }

  private rebindVoiceBanks(v: Voice, p: FirePatch): void {
    const f0 = v.baseFreq;
    v.rebindBanks(
      p,
      f0 * Math.pow(2, p.oscAOctave),
      f0 * Math.pow(2, p.oscBOctave),
      f0 * Math.pow(2, p.oscCOctave),
    );
  }

  // ── notes ──
  /** `when` (ctx clock) enables sample-accurate sequencing; omit for live play.
   *  `liveAttackSec` tightens amp/filter attack for keyboard / MIDI only. */
  noteOn(midi: number, velocity = 0.9, when?: number, liveAttackSec?: number): void {
    this.restoreFxIfSilenced();
    this.startModTimer();
    const p = this.patch;
    const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
    if (p.mono) {
      const v = this.monoVoice;
      if (v && !v.releasing) {
        const fromMidi = v.midi;
        v.midi = midi;
        v.applyTuning(p, t, false, fromMidi);
        v.applyFm(p);
        v.triggerEnvelopes(p, velocity, t);
        this.held.set(midi, v);
        return;
      }
    }
    const cap = this.effectiveMaxVoices(p);
    while (this.voices.size >= cap) this.stealVoice();
    // Re-trigger of the same MIDI must release the previous voice or it orphans.
    // Move it to `dying` like stealVoice — leaving it in `voices` stacked two
    // resonant voices on one key (IceKing rapid arps → static crackle).
    const prev = this.held.get(midi);
    if (prev && !p.mono) {
      this.held.delete(midi);
      this.voices.delete(prev);
      this.dying.add(prev);
      prev.fastRelease();
      this.pruneDying();
    }
    const [bankA, bankB, bankC] = this.banksForNote(p, midi);
    const voice = new Voice(
      this, this.ctx, this.voiceBus, this.noiseBufferFor(p.chipNoise),
      bankA, bankB, bankC, p, midi, velocity, when,
      liveAttackSec,
    );
    this.voices.add(voice);
    this.held.set(midi, voice);
    if (p.mono) this.monoVoice = voice;
    this.updatePolyGain();
  }

  noteOff(midi: number, when?: number): void {
    const v = this.held.get(midi);
    if (!v) return;
    this.held.delete(midi);
    if (this.patch.mono && this.monoVoice === v) {
      const remaining = [...this.held.keys()];
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        v.midi = next;
        v.applyTuning(this.patch, this.ctx.currentTime, false);
        v.applyFm(this.patch);
        this.held.set(next, v);
        return;
      }
      this.monoVoice = null;
    }
    v.noteOff(this.patch, when);
  }

  /**
   * Sequencer-facing one-shot: a fully scheduled note (start + release both on
   * the audio clock). Bypasses the held-note map so overlapping notes of the
   * same pitch from a piano roll can't cancel each other.
   */
  playNote(midi: number, velocity: number, when: number, duration: number): void {
    this.restoreFxIfSilenced();
    this.startModTimer();
    this.pruneDying();
    const p = this.patch;
    const t = Math.max(this.ctx.currentTime, when);
    // Anchor the release to the CLAMPED start: when a late timer delivered a
    // past `when`, the release used to land before (or right on top of) the
    // actual start — zero-length envelopes that clicked.
    const releaseAt = t + Math.max(0.02, duration);
    // Sequencer must honor mono the same way live noteOn does — otherwise
    // piano-roll / arrangement stacks poly voices on acid/legato patches.
    if (p.mono) {
      const existing = this.monoVoice;
      if (existing && !existing.releasing) {
        const fromMidi = existing.midi;
        existing.midi = midi;
        existing.applyTuning(p, t, false, fromMidi);
        existing.applyFm(p);
        existing.triggerEnvelopes(p, velocity, t);
        existing.noteOff(p, releaseAt);
        return;
      }
      while (this.voices.size > 0) this.stealVoice();
      const [bankA, bankB, bankC] = this.banksForNote(p, midi);
      const voice = new Voice(
        this, this.ctx, this.voiceBus, this.noiseBufferFor(p.chipNoise),
        bankA, bankB, bankC,
        p, midi, velocity, when,
      );
      this.voices.add(voice);
      this.monoVoice = voice;
      this.updatePolyGain();
      voice.noteOff(p, releaseAt);
      return;
    }
    // Overlapping same-pitch roll/arrangement notes: softly choke the earlier
    // voice exactly like the arp path does. Without this, stacked identical
    // pitches summed coherently (+6 dB per doubling) into the drive shaper.
    this.chokeSameMidiAt(midi, t);
    const cap = this.effectiveMaxVoices(p);
    while (this.voices.size >= cap) this.stealVoice();
    {
      const [bankA, bankB, bankC] = this.banksForNote(p, midi);
      const voice = new Voice(
        this, this.ctx, this.voiceBus, this.noiseBufferFor(p.chipNoise),
        bankA, bankB, bankC,
        p, midi, velocity, when,
      );
      this.voices.add(voice);
      this.updatePolyGain();
      voice.noteOff(p, releaseAt);
    }
  }

  /** Kill fading voices that exceed the cap — they still sum on voiceBus. */
  private pruneDying(): void {
    const hot = isHotArp();
    const cap = hot ? FireCommandSynth.HOT_ARP_DYING_CAP : FireCommandSynth.DYING_CAP;
    const now = this.ctx.currentTime;
    // Hard ceiling so a steal storm cannot grow dying unboundedly while soft
    // prune waits for fades to settle.
    const hard = hot ? cap + 1 : cap + 2;
    while (this.dying.size > hard) {
      const v = this.dying.values().next().value;
      if (!v) break;
      this.dying.delete(v);
      v.forceStop();
    }
    while (this.dying.size > cap) {
      const v = this.dying.values().next().value;
      if (!v) break;
      this.dying.delete(v);
      if (!v.releasing) {
        v.fastRelease();
        continue;
      }
      // Already fading — only hard-stop once the fade has had time to settle.
      // Mid-sample forceStop on a hot amp is the crackle users heard as
      // "distortion" on fast arps: the old code force-stopped ANY fading
      // voice the moment the arp ran hot, so every steal produced a click at
      // 40 notes/sec. Now even hot arps give the fade 12 ms to get quiet;
      // the hard ceiling above still bounds true pile-ups.
      const relAt = v.releaseAt ?? now;
      if (now >= relAt + 0.012) {
        v.forceStop();
      } else {
        this.dying.add(v);
        break;
      }
    }
  }

  /**
   * Soft-choke already-audible same-MIDI voices at audio-clock `when`.
   * Does NOT touch future-scheduled oscillators at schedule-now.
   */
  private chokeSameMidiAt(midi: number, when: number): void {
    const t = when;
    for (const v of [...this.voices]) {
      if (v.midi !== midi) continue;
      for (const [k, vv] of this.held) if (vv === v) this.held.delete(k);
      this.voices.delete(v);
      this.dying.add(v);
      v.chokeAt(t);
    }
    // Dying same-MIDI already fading — leave them unless over cap.
    if (this.monoVoice?.midi === midi) this.monoVoice = null;
    this.pruneDying();
  }

  /** Drop pending ARP lookahead jobs (panic / preset / stop). */
  clearArpSchedule(): void {
    this.arpQueue.length = 0;
  }

  /**
   * Queue an ARP one-shot. Voice nodes are built only near `when` so lookahead
   * does not inflate poly / steal / polyGain with silent futures.
   */
  scheduleArpNote(
    midi: number,
    velocity: number,
    when: number,
    duration: number,
    stepSec: number,
  ): void {
    this.restoreFxIfSilenced();
    this.startModTimer();
    const t = Math.max(this.ctx.currentTime, when);
    const win = Math.max(0.008, duration);
    // Refuse new spawns when the live graph is already at the hot ceiling —
    // better a dropped tick than reboot-poison node thrash.
    const hot = isHotArp();
    if (hot && this.voices.size + this.dying.size >= 8) {
      this.pruneDying();
      if (this.voices.size + this.dying.size >= 8) return;
    }
    // Replace only pending SAME-MIDI jobs in this note's own window.
    // Do NOT cancel earlier pending notes (e.g. primary before a ratchet) —
    // those materialize first and get choked at the later attack time.
    for (let i = this.arpQueue.length - 1; i >= 0; i--) {
      const j = this.arpQueue[i]!;
      if (j.midi === midi && j.when >= t - 0.0005 && j.when < t + win) {
        this.arpQueue.splice(i, 1);
      }
    }
    this.arpQueue.push({
      midi,
      velocity,
      when: t,
      duration: win,
      stepSec,
    });
    this.arpQueue.sort((a, b) => a.when - b.when);
    const qCap = hot ? FireCommandSynth.HOT_ARP_QUEUE_CAP : FireCommandSynth.ARP_QUEUE_CAP;
    while (this.arpQueue.length > qCap) this.arpQueue.shift();
    this.flushArpQueue();
  }

  /** Materialize due ARP jobs (also called from the 60 Hz mod loop). */
  flushArpQueue(): void {
    const now = this.ctx.currentTime;
    const eps = FireCommandSynth.ARP_MATERIALIZE_EPS;
    while (this.arpQueue.length > 0 && this.arpQueue[0]!.when <= now + eps) {
      const job = this.arpQueue.shift()!;
      this.materializeArpNote(job);
    }
  }

  /**
   * High-rate arpeggiator path (300 BPM × 1/32, 4 octaves…). Uses capped
   * release tails, time-correct same-MIDI choke, and tighter dying-voice limits.
   */
  private materializeArpNote(job: {
    midi: number;
    velocity: number;
    when: number;
    duration: number;
    stepSec: number;
  }): void {
    this.pruneDying();
    const p = this.patch;
    const when = Math.max(this.ctx.currentTime, job.when);
    // Choke prior same pitch AT the new attack time — never at schedule-now.
    this.chokeSameMidiAt(job.midi, when);
    const dur = Math.max(0.008, job.duration);
    const releaseAt = when + dur;
    const hot = isHotArp();
    const maxRel = Math.min(
      p.ampRelease,
      dur * 0.85,
      job.stepSec * 0.9,
      hot ? 0.018 : 0.06,
    );
    const attackSec = Math.min(
      Math.max(0.001, p.ampAttack),
      Math.max(0.001, job.stepSec * 0.25),
    );
    // Hot ARP: 4–5 voice ceiling (Init dual-morph is expensive at 40 Hz).
    const step = getArpStepSec();
    const hotCap = step < 0.04 ? 4 : 5;
    const cap = hot
      ? Math.min(this.effectiveMaxVoices(p), hotCap)
      : this.effectiveMaxVoices(p);
    while (this.voices.size >= cap) this.stealVoice();
    const [bankA, bankB, bankC] = this.banksForNote(p, job.midi);
    // Drop dual-morph continuity while hot — halves the morph work on Init.
    // Deliberately NOT pushed below setWt's 0.12 snap threshold: going fully
    // single-frame would save the hi oscillator bank too, but it audibly
    // shifted arp timbre (measured ~1.5 dB and a different frame selection),
    // and consistent sound beats the extra headroom here.
    const voicePatch = hot && (p.oscAContinuity ?? 0) > 0.45
      ? { ...p, oscAContinuity: 0.35 }
      : p;
    const voice = new Voice(
      this, this.ctx, this.voiceBus, this.noiseBufferFor(p.chipNoise),
      bankA, bankB, bankC,
      voicePatch, job.midi, job.velocity, when,
      attackSec,
    );
    this.voices.add(voice);
    this.updatePolyGain();
    voice.noteOffShort(p, releaseAt, maxRel);
  }

  /**
   * @deprecated Prefer scheduleArpNote — kept as a thin alias for callers.
   */
  playArpNote(
    midi: number,
    velocity: number,
    when: number,
    duration: number,
    stepSec: number,
  ): void {
    this.scheduleArpNote(midi, velocity, when, duration, stepSec);
  }

  allNotesOff(opts: { hard?: boolean } = {}): void {
    this.clearArpSchedule();
    this.held.clear();
    this.monoVoice = null;
    // CLICK SOURCE (read as "crackle/distortion"): this used to forceStop()
    // every voice, hard-cutting live audio mid-sample — preset switches and
    // sequencer stops landed with an audible pop burst. fastRelease() is a
    // 6 ms fade with the actual stop deferred 40 ms, which is inaudible.
    for (const v of [...this.voices]) v.fastRelease();
    if (opts.hard) {
      // Dying voices are off the poly cap but still sum on voiceBus — IceKing
      // arps stack them until the bus clips. Only hard-kill on panic/preset load.
      for (const v of [...this.dying]) v.forceStop();
      this.dying.clear();
    }
  }

  /** When true, FX wet/feedback stay hard-zeroed until the next note. */
  private fxSilenced = false;

  /** Re-open FX sends after a transport kill (called from noteOn / playNote). */
  private restoreFxIfSilenced(): void {
    if (!this.fxSilenced) return;
    this.fxSilenced = false;
    try {
      this.applyBusParams(this.patch);
    } catch { /* ignore */ }
  }

  /** Public: open FX wet again after stop/panic (e.g. start of a sequencer pass). */
  unsilenceFx(): void {
    this.restoreFxIfSilenced();
  }

  /**
   * Panic / transport stop: kill delay feedback + wet sends so FX tails
   * (hiss, infinite delay freeze, long reverb) don't keep ringing after notes
   * are released. Wet stays zero until the next note (no timed restore —
   * that was reopening delay/reverb mid-silence).
   * Also clears freeze flags so near-unity feedback cannot re-arm silently.
   */
  killFxTails(): void {
    this.fxSilenced = true;
    this.clearArpSchedule();
    // Prevent freeze from re-asserting 0.9+ feedback on the next applyBusParams.
    this.patch.delayFreeze = false;
    this.patch.reverbFreeze = false;
    const t = this.ctx.currentTime;
    this.flushBusContamination(t, { rebuildDelay: true });
  }

  /**
   * Wipe shared-bus state that survives voice kills and contaminates the next
   * preset (IceKing → clean preset still distorted; NS → whole Fire Command
   * stays harsh until reboot). DelayNode / DynamicsCompressor / spectral
   * worklet state cannot be cleared in-place — rebuild or hard-reset them.
   */
  private flushBusContamination(
    t = this.ctx.currentTime,
    opts: { rebuildDelay?: boolean } = {},
  ): void {
    try {
      this.dFbLR.gain.cancelScheduledValues(t);
      this.dFbRL.gain.cancelScheduledValues(t);
      this.dFbLR.gain.setValueAtTime(0, t);
      this.dFbRL.gain.setValueAtTime(0, t);
      this.delayWet.gain.cancelScheduledValues(t);
      this.delayWet.gain.setValueAtTime(0, t);
      this.reverbWet.gain.cancelScheduledValues(t);
      this.reverbWet.gain.setValueAtTime(0, t);
      this.chorusWet.gain.cancelScheduledValues(t);
      this.chorusWet.gain.setValueAtTime(0, t);
      this.phaserWet.gain.cancelScheduledValues(t);
      this.phaserWet.gain.setValueAtTime(0, t);
      this.phaserFb.gain.cancelScheduledValues(t);
      this.phaserFb.gain.setValueAtTime(0, t);
      this.punchMakeup.gain.cancelScheduledValues(t);
      this.punchMakeup.gain.setValueAtTime(1, t);
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(clamp(this.patch.masterGain ?? 0.72, 0, 1.15), t);
      this.tremolo.gain.cancelScheduledValues(t);
      this.tremolo.gain.setValueAtTime(1, t);
      this.drivePre.gain.cancelScheduledValues(t);
      this.limiterPinFrames = 0;
      this.delayHotFrames = 0;
      this.lastFbDriveKey = -1;
      this.ecoHot = false;
      this.mtxSmooth.fill(0);
      this.macroSmooth.fill(0);
      this.gPanWas = this.gVolWas = this.gRevWas = this.gDlyWas = false;
      // Force spectral worklet to wipe freeze/smear accumulators even when the
      // next patch keeps the same mode (message-key cache would skip the reset).
      this.lastSpectralMsg = "";
      try {
        this.spectralNode?.port.postMessage({
          mode: "off",
          amount: 0,
          mix: 0,
          bypass: true,
          binLow: 0,
          binHigh: 1,
          eco: false,
        });
      } catch { /* worklet may be mid-load */ }
      try { this.vintage.flush(); } catch { /* ignore */ }
    } catch { /* node may be mid-teardown */ }
    if (opts.rebuildDelay) {
      try { this.rebuildDelayLines(); } catch { /* ignore */ }
      try { this.rebuildChorusDelays(); } catch { /* ignore */ }
      try { this.rebuildPhaserStages(); } catch { /* ignore */ }
      try { this.rebuildPunchComp(); } catch { /* ignore */ }
      try { this.rebuildReverbPredelay(); } catch { /* ignore */ }
      try {
        this.reverbConv.buffer = null;
        this.lastIrKey = "";
      } catch { /* ignore */ }
    }
    try { this.onFlushContamination?.(); } catch { /* ignore */ }
  }

  /** Swap the glue DynamicsCompressor — internal GR envelope is not resettable. */
  private rebuildPunchComp(): void {
    const ctx = this.ctx;
    const old = this.punchComp;
    try { this.punchIn.disconnect(old); } catch { /* ignore */ }
    try { old.disconnect(); } catch { /* ignore */ }
    const next = ctx.createDynamicsCompressor();
    next.knee.value = 6;
    next.attack.value = 0.004;
    next.release.value = 0.12;
    next.threshold.value = 0;
    next.ratio.value = 1;
    this.punchComp = next;
    this.punchIn.connect(next).connect(this.punchWet);
  }

  /**
   * Replace ping-pong DelayNodes so residual buffer content from a previous
   * patch cannot recirculate when delay wet/feedback are re-enabled.
   */
  private rebuildDelayLines(): void {
    const ctx = this.ctx;
    const oldL = this.dL;
    const oldR = this.dR;
    // Tear down old graph edges — keep dPanL/R → delayWet (stable sink).
    try { this.tremolo.disconnect(oldL); } catch { /* ignore */ }
    try { oldL.disconnect(); } catch { /* ignore */ }
    try { oldR.disconnect(); } catch { /* ignore */ }
    try { this.dFbLR.disconnect(); } catch { /* ignore */ }
    try { this.dFbRL.disconnect(); } catch { /* ignore */ }
    try { this.dFbSatLR.disconnect(); } catch { /* ignore */ }
    try { this.dFbSatRL.disconnect(); } catch { /* ignore */ }
    try { this.dFbHpLR.disconnect(); } catch { /* ignore */ }
    try { this.dFbHpRL.disconnect(); } catch { /* ignore */ }
    try { this.dFbLpLR.disconnect(); } catch { /* ignore */ }
    try { this.dFbLpRL.disconnect(); } catch { /* ignore */ }

    this.dL = ctx.createDelay(2.0);
    this.dR = ctx.createDelay(2.0);
    // Preserve scheduled delay times approximately from the live patch.
    const dTime = clamp(this.patch.delayTime ?? 0.28, 0.001, 2);
    this.dL.delayTime.value = dTime;
    this.dR.delayTime.value = dTime * 1.5;

    this.tremolo.connect(this.dL);
    this.dL.connect(this.dPanL);
    this.dR.connect(this.dPanR);
    this.dL.connect(this.dFbLR).connect(this.dFbSatLR).connect(this.dFbHpLR).connect(this.dFbLpLR).connect(this.dR);
    this.dR.connect(this.dFbRL).connect(this.dFbSatRL).connect(this.dFbHpRL).connect(this.dFbLpRL).connect(this.dL);
  }

  /** Chorus DelayNodes hold the same kind of non-clearable buffer residue. */
  private rebuildChorusDelays(): void {
    const ctx = this.ctx;
    const oldL = this.cDelayL;
    const oldR = this.cDelayR;
    try { this.chorusIn.disconnect(oldL); } catch { /* ignore */ }
    try { this.chorusIn.disconnect(oldR); } catch { /* ignore */ }
    try { this.cDepthL.disconnect(); } catch { /* ignore */ }
    try { this.cDepthR.disconnect(); } catch { /* ignore */ }
    try { oldL.disconnect(); } catch { /* ignore */ }
    try { oldR.disconnect(); } catch { /* ignore */ }

    this.cDelayL = ctx.createDelay(0.1);
    this.cDelayR = ctx.createDelay(0.1);
    const base = clamp(this.patch.chorusDelay ?? 0.012, 0.004, 0.04);
    this.cDelayL.delayTime.value = base;
    this.cDelayR.delayTime.value = base * 1.2;
    // cPanL/R → chorusWet already wired from constructor — don't re-fan.
    this.chorusIn.connect(this.cDelayL).connect(this.cPanL);
    this.chorusIn.connect(this.cDelayR).connect(this.cPanR);
    // LFO → depth gains stay wired; only re-aim depth at the new delayTime params.
    this.cDepthL.connect(this.cDelayL.delayTime);
    this.cDepthR.connect(this.cDelayR.delayTime);
  }

  /** Fresh allpass stages — kills self-resonance residue after high phaser FB. */
  private rebuildPhaserStages(): void {
    const ctx = this.ctx;
    const old = this.phaserAP;
    try { this.phaserIn.disconnect(); } catch { /* ignore */ }
    try { this.phaserDepth.disconnect(); } catch { /* ignore */ }
    try { this.phaserFb.disconnect(); } catch { /* ignore */ }
    for (const ap of old) {
      try { ap.disconnect(); } catch { /* ignore */ }
    }
    this.phaserAP = [];
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = 800;
      ap.Q.value = 0.6;
      this.phaserAP.push(ap);
    }
    // phaserDry/Wet → phaserOut already wired — only reattach from phaserIn / stages.
    this.phaserIn.connect(this.phaserDry);
    let apNode: AudioNode = this.phaserIn;
    for (const ap of this.phaserAP) { apNode.connect(ap); apNode = ap; }
    apNode.connect(this.phaserWet);
    apNode.connect(this.phaserFb).connect(this.phaserIn);
    for (const ap of this.phaserAP) this.phaserDepth.connect(ap.frequency);
  }

  /** Reverb predelay DelayNode holds wet-path residue like the echo lines. */
  private rebuildReverbPredelay(): void {
    const ctx = this.ctx;
    const old = this.reverbPredelay;
    try { this.reverbIn.disconnect(old); } catch { /* ignore */ }
    try { old.disconnect(); } catch { /* ignore */ }
    this.reverbPredelay = ctx.createDelay(0.25);
    this.reverbPredelay.delayTime.value = clamp(this.patch.reverbPredelay ?? 0, 0, 0.2);
    this.reverbIn.connect(this.reverbPredelay).connect(this.revHiCut);
  }

  /**
   * Parallel taps for DistortionProbe (voice bus, glue makeup, delay wet, soft-clip out).
   * suffix distinguishes Synth A vs B in logs.
   */
  attachDistortionProbes(
    probe: { tap: (stage: string, node: AudioNode) => void },
    suffix = "A",
  ): void {
    probe.tap(`fire${suffix}.voiceBus`, this.voiceBus);
    probe.tap(`fire${suffix}.punchMakeup`, this.punchMakeup);
    probe.tap(`fire${suffix}.delayWet`, this.delayWet);
    probe.tap(`fire${suffix}.delayFb`, this.dFbLR);
    probe.tap(`fire${suffix}.softClip`, this.softClip);
    probe.tap(`fire${suffix}.out`, this.output);
  }


  onVoiceEnded(v: Voice): void {
    this.voices.delete(v);
    this.dying.delete(v);
    if (this.monoVoice === v) this.monoVoice = null;
    this.updatePolyGain();
  }

  /**
   * Equal-power polyphony compensation on the summing bus.
   *
   * Summing N independent voices grows the bus level ~sqrt(N); past a handful
   * of held notes that overflows the drive shaper's ±1 curve into hard
   * clipping (audible distortion) and pins the downstream master limiter (the
   * "cut-out"/pump). We hold flat gain up to a knee so the dialed-in sound of
   * single notes and small chords is preserved exactly, then roll off as
   * 1/sqrt(N) so the summed loudness stays pinned at roughly the knee-voice
   * level no matter how many keys are held.
   *
   * The flat region is VOICE_HEADROOM (not 1): one voice can peak ~1.5 on its
   * own before the filter (osc levels + sub + noise sum, unison normalization
   * only holds each GROUP constant), so unity here fed every later stage an
   * already-clipping signal — that pre-trim is the core of the clipping fix.
   * The knee is 3 (was 4): piano-roll / sequencer chords stack releases hard,
   * so compensation engages where sequenced material actually lives. The 50 ms
   * time-constant keeps the gain change click-free as voices come and go.
   */
  private updatePolyGain(): void {
    const now = this.ctx.currentTime;
    // Only count voices that have started (or are due) — lookahead futures live
    // in arpQueue and must not pull headroom / trigger steal.
    let audible = 0;
    for (const v of this.voices) {
      if (v.startedAt <= now + 0.001) audible++;
    }
    // Dying voices are mid-fade (≤50 ms tails at a fraction of full level) —
    // counting them at FULL weight ducked hot arps to ~0.19× (−8 dB): with
    // 5 sounding + 2 dying at knee 2, √(2/7) crushed every accent. That WAS
    // the "arps sound washed out / non-responsive" complaint. Half-weight,
    // capped, keeps a little headroom credit without the crush.
    audible += Math.min(this.dying.size * 0.5, 1.5);
    const hot = isHotArp();
    // Hot knee raised 2 → 3: a normal up/down arp holds ~3 overlapping
    // voices (gate tails), which used to sit permanently ABOVE the knee.
    const knee = hot ? 3 : isArpKeepAlive() ? 3 : 3;
    const pad = hot ? FireCommandSynth.HOT_ARP_BUS_PAD : 1;
    const g = VOICE_HEADROOM * pad * (audible <= knee ? 1 : Math.sqrt(knee / audible));
    // 12 ms trim: fast enough that a burst doesn't clip ahead of the bus
    // limiter, slow enough that per-note gain changes stop reading as
    // note-rate amplitude modulation (the old 1.5 ms pumped audibly).
    const tau = hot ? 0.012 : isArpKeepAlive() ? 0.015 : 0.05;
    this.voiceBus.gain.setTargetAtTime(g, now, tau);
  }

  private stealVoice(): void {
    // Prefer voices already audibly fading out (least noticeable theft), else
    // pick by voiceSteal policy among remaining voices. Prefer already-started
    // voices over silent futures (should be rare with deferred ARP).
    const now = this.ctx.currentTime;
    const policy = this.patch.voiceSteal ?? "oldest";
    const score = (v: Voice): number => {
      switch (policy) {
        case "newest": return -v.startedAt;
        case "lowest": return v.midi;
        case "highest": return -v.midi;
        default: return v.startedAt; // oldest
      }
    };
    let pick: Voice | null = null;
    for (const v of this.voices) {
      if (!(v.releasing && (v.releaseAt === null || v.releaseAt <= now))) continue;
      if (!pick || score(v) < score(pick)) pick = v;
    }
    if (!pick) {
      for (const v of this.voices) {
        if (v.startedAt > now + 0.002) continue; // don't steal silent futures
        if (!pick || score(v) < score(pick)) pick = v;
      }
    }
    if (!pick) {
      for (const v of this.voices) {
        if (!pick || score(v) < score(pick)) pick = v;
      }
    }
    if (!pick) return;
    for (const [k, vv] of this.held) if (vv === pick) this.held.delete(k);
    this.voices.delete(pick);
    this.dying.add(pick);
    pick.fastRelease();
    this.pruneDying();
    this.updatePolyGain();
  }

  /**
   * Tear the synth down and release everything it holds.
   *
   * Added because Natural Selection builds a THROWAWAY synth per candidate
   * patch: `auditionFirePatch` spins up an OfflineAudioContext plus a complete
   * FireCommandSynth (≈150 nodes, a generated reverb impulse response, and a
   * freshly rendered set of wavetable PeriodicWaves) purely to measure whether
   * the candidate is silent or distorted, then dropped both on the floor.
   *
   * Measured cost: 0.42 MB retained per audition, while a bare
   * OfflineAudioContext render retains nothing. A mutate runs several
   * auditions, so breeding sounds leaked ~64 MB per minute — roughly a
   * gigabyte in a quarter hour of sound design, which never came back without
   * an app relaunch. As the heap grows, GC pauses lengthen and start stalling
   * the 60 Hz modulation loop and the audio render thread, which is heard as
   * crackle and breakup rather than as "low memory".
   *
   * Disposal is reflective rather than a hand-written list of 150 fields:
   * enumerating own properties and disconnecting anything node-shaped can't
   * drift out of date as the graph changes.
   */
  dispose(): void {
    this.stopModTimer();
    this.clearArpSchedule();
    if (this.warpTimer) {
      clearTimeout(this.warpTimer);
      this.warpTimer = null;
    }
    for (const v of [...this.voices]) { try { v.forceStop(); } catch { /* ignore */ } }
    this.voices.clear();
    for (const v of [...this.dying]) { try { v.forceStop(); } catch { /* ignore */ } }
    this.dying.clear();
    this.held.clear();
    this.monoVoice = null;

    const self = this as unknown as Record<string, unknown>;
    const visit = (val: unknown): void => {
      if (!val || typeof val !== "object") return;
      const n = val as Partial<AudioNode & AudioScheduledSourceNode & { buffer: unknown }>;
      // Sources must stop before disconnect or they keep the context alive.
      if (typeof n.stop === "function") { try { n.stop(); } catch { /* not started */ } }
      if (typeof n.disconnect === "function") { try { n.disconnect(); } catch { /* ignore */ } }
      // Convolver IRs and buffer sources hold the largest single allocations.
      if ("buffer" in n) { try { (n as { buffer: unknown }).buffer = null; } catch { /* readonly */ } }
      if (typeof (val as { port?: { onmessage: unknown } }).port === "object") {
        try { (val as { port: { onmessage: unknown } }).port.onmessage = null; } catch { /* ignore */ }
      }
    };
    for (const key of Object.keys(self)) {
      const val = self[key];
      if (Array.isArray(val)) { for (const item of val) visit(item); continue; }
      visit(val);
    }
    // LFO banks and the vintage submodule hold their own nested graphs.
    for (const bank of [this.lfo1, this.lfo2]) {
      if (!bank) continue;
      for (const v of Object.values(bank as unknown as Record<string, unknown>)) visit(v);
    }
    if (this.vintage) {
      for (const v of Object.values(this.vintage as unknown as Record<string, unknown>)) visit(v);
    }

    // Caches: PeriodicWave sets are the bulk of a throwaway synth's footprint.
    this.banks.clear();
    this.bankGains.clear();
    this.warpedBanks.clear();
    this.warpedGains.clear();
    this.filterWorkletPool.length = 0;
    this.filterWorkletCount = 0;
    this.healthAnalyser = null;
    this.spectralNode = null;
    this.disposed = true;
  }

  /** Keep delaySync (and tempo-linked FX) locked to the sequencer/host BPM. */
  setHostBpm(bpm: number): void {
    const next = clamp(bpm, 40, 300);
    if (Math.abs(next - this.hostBpm) < 0.05) return;
    this.hostBpm = next;
    if (this.patch.delaySync) this.applyBusParams(this.patch);
  }

  /**
   * Rebuild live voices for a topology change WITHOUT touching the FX bus.
   *
   * filterModel / filterSlope / filterDrivePos / unison are baked into each
   * Voice at construction, so changing one needs the voices rebuilt. They used
   * to route through the full `setPatch()`, which additionally:
   *   · flushed bus contamination and REBUILT the delay lines, chorus delays,
   *     phaser allpasses, punch compressor and reverb predelay,
   *   · called onFlushContamination() → the engine replaced all four of its
   *     shared DynamicsCompressors (fire limiter, glue, FX limiter, final),
   *   · dropped the wavetable caches and re-rendered every bank.
   *
   * None of that is implied by "use a ladder instead of a biquad". The cost
   * was ~7 heavyweight node allocations per click plus two audible artifacts:
   * every delay/reverb tail cut off, and a fresh zero-state compressor letting
   * one burst through un-limited before its envelope caught up. Clicking
   * through filter models or unison counts — normal sound design — therefore
   * produced a click and a level spike each time, and churned the graph.
   *
   * This keeps the voice rebuild and drops everything else.
   */
  private retopologizeVoices(p: FirePatch): void {
    this.startModTimer();
    this.patch = cloneFirePatch({ ...DEFAULT_FIRE_PATCH, ...p });
    // Voices carry the old topology in their node graph and cannot be
    // retopologized in place, so they must go — but their FX tails may stay.
    this.held.clear();
    this.monoVoice = null;
    for (const v of [...this.voices]) v.forceStop();
    this.voices.clear();
    for (const v of [...this.dying]) v.forceStop();
    this.dying.clear();
    this.updatePolyGain();
    this.filterDriveCurve = makeFilterDriveCurve(this.patch.filterDrive);
    // Re-assert bus + LFO params (cheap, no node surgery) so a topology change
    // bundled with other edits still lands.
    this.applyBusParams(this.patch);
    this.applyLfoParams(this.patch);
  }

  // ── patch ──
  setPatch(p: FirePatch): void {
    this.startModTimer();
    this.clearArpSchedule();
    // Drop any pending warp rebuild from a prior knob scrub — otherwise an
    // 80 ms timer can rebind voices after a preset load with stale intent.
    if (this.warpTimer) {
      clearTimeout(this.warpTimer);
      this.warpTimer = null;
    }
    this.warpedBanks.clear();
    this.warpedGains.clear();
    this.warpedSig = "";
    // Hard-kill live voices. fastRelease left ~50 ms zombies whose filter
    // topology (ladder/SVF worklet vs biquad) and dual-morph graph cannot be
    // retopologized by setFilterLive — Natural Selection → loadPreset then
    // bled NS DNA into the next preset until relaunch rebuilt the synth.
    this.held.clear();
    this.monoVoice = null;
    for (const v of [...this.voices]) v.forceStop();
    this.voices.clear();
    // Stolen voices already removed from the active set are still fading out
    // with their old topology — kill them too so nothing bleeds into the load.
    for (const v of [...this.dying]) v.forceStop();
    this.dying.clear();
    this.updatePolyGain();
    // IceKing-class patches leave hot delay buffers + compressor state that
    // keep crushing cleaner presets until they slowly recover. Flush now —
    // before applying the new bus params / re-enabling FX.
    this.flushBusContamination(this.ctx.currentTime, { rebuildDelay: true });
    this.fxSilenced = false;
    // Deep-clone nested fields so engine state never aliases store / factory
    // / user-preset objects (moduleEnable, modMatrix, fm corners, gate…).
    this.patch = cloneFirePatch({ ...DEFAULT_FIRE_PATCH, ...p });
    this.filterDriveCurve = makeFilterDriveCurve(this.patch.filterDrive);
    this.lastDriveKey = "";
    this.lastCrushBits = -1;
    this.lastSpectralMsg = "";
    this.lastBusVoiceSyncKey = "";
    this.lastFbDriveKey = -1;
    this.ecoHot = false;
    this.sessionNeedsFlush = false;
    if ((this.patch.macroResponse ?? "absolute") === "relative") {
      this.macroBaseline[0] = this.patch.macro1;
      this.macroBaseline[1] = this.patch.macro2;
      this.macroBaseline[2] = this.patch.macro3;
      this.macroBaseline[3] = this.patch.macro4;
    }
    this.recomputeMatrix();
    this.applyBusParams(this.patch);
    this.applyLfoParams(this.patch);
    this.applySpectral(this.patch);
    // Render this patch's banks now rather than on the first note-on.
    this.warmBanks(this.patch);
  }

  /**
   * Morph-pad scrub: update engine from a blended patch without the full
   * setPatch rebuild (wavetable banks / matrix digest / every-frame alloc).
   * Batches into a single bus+voice refresh instead of N× set() storms.
   */
  applyLiveMorph(next: FirePatch): void {
    this.startModTimer();
    const cur = this.patch;
    const merged: FirePatch = { ...cur };
    let changed = false;
    let tablesChanged = false;
    const keys = Object.keys(DEFAULT_FIRE_PATCH) as (keyof FirePatch)[];
    for (const key of keys) {
      const a = cur[key];
      const b = next[key];
      if (a === b) continue;
      if (typeof a === "number" && typeof b === "number") {
        if (Math.abs(a - b) < 1e-5) continue;
        (merged as unknown as Record<string, unknown>)[key as string] = b;
        changed = true;
        continue;
      }
      // Skip object fields (modMatrix, moduleEnable, gatePattern…) during scrub —
      // morph snaps those from the nearest corner only on commit via setPatch.
      if (b !== null && typeof b === "object") continue;
      (merged as unknown as Record<string, unknown>)[key as string] = b;
      changed = true;
      if (key === "oscATable" || key === "oscBTable" || key === "oscCTable" || key === "subWave") {
        tablesChanged = true;
      }
    }
    if (!changed) return;
    this.patch = merged;
    this.applyBusParams(merged);
    this.applyLfoParams(merged);
    for (const v of this.voices) {
      if (tablesChanged) {
        this.rebindVoiceBanks(v, merged);
        if (merged.subWave !== cur.subWave) v.setSubWave(merged.subWave);
      }
      v.setOscLevels(merged);
      v.setFilterLive(merged);
      v.applyFm(merged);
      v.applyUnisonSpread(merged);
      v.applyTuning(merged, this.ctx.currentTime, false);
    }
  }

  set<K extends keyof FirePatch>(key: K, value: FirePatch[K]): void {
    this.patch = { ...this.patch, [key]: value };
    const p = this.patch;
    switch (key) {
      case "masterGain": case "drive": case "driveMode": case "crush": case "punch":
      case "driveBias": case "driveSymmetry": case "driveInGain": case "driveOutGain":
      case "driveAutoGain": case "driveDcBlock": case "driveTonePos":
      case "fxQuality": case "fxSharedMod": case "fxDeltaAudition":
      case "lowProtect": case "lowProtectHz":
      case "ringAmount": case "ringFreq": case "ringMode":
      case "phaserRate": case "phaserDepth": case "phaserMix":
      case "phaserStages": case "phaserCenter": case "phaserStereo": case "phaserFeedback":
      case "chorusRate": case "chorusDepth": case "chorusMix":
      case "chorusVoices": case "chorusDelay": case "chorusSpread": case "chorusLowCut": case "chorusModel":
      case "delayTime": case "delayFeedback": case "delayMix": case "tone":
      case "delaySync": case "delayFreeze": case "delayDuck": case "delayFbFilter":
      case "delayFbDrive": case "delayCascadeMode":
      case "reverbSize": case "reverbMix": case "reverbDamp": case "reverbPredelay": case "reverbDiffusion":
      case "reverbFreeze": case "reverbEarly": case "reverbLowDecay": case "reverbHighCut":
      case "reverbInGain": case "reverbOutGain":
      case "stereoWidth": case "airLow": case "airHigh": case "airAmount":
      case "glueInGain": case "glueOutGain": case "glueAutoGain": case "glueMode":
      case "glueThreshold": case "glueRatio": case "glueAttack": case "glueRelease":
      case "glueKnee": case "glueMakeup": case "glueMix": case "glueUseAdvanced":
      case "mixDeltaAudition": case "masterChainScene":
      case "widthInGain": case "widthOutGain": case "monoBelow": case "widthMechanism":
      case "airInGain": case "airOutGain": case "airArch": case "airMsMode":
      case "cassetteGen": case "tapeSpeed": case "wowFlutter": case "vhsColor":
      case "bitDepth": case "sampleRateReduce": case "bbdChorus": case "analogComp":
      case "dust": case "hiss": case "hum": case "printThrough":
      case "ageMacro": case "ageEvolve": case "ageInGain": case "ageOutGain":
      case "ageLockMedium": case "ageLockMotion": case "ageLockWear": case "ageLockResolution":
      case "pathOsc": case "pathFilter": case "pathDrive": case "pathAge":
      case "pathFx": case "pathMix": case "pathScope": case "moduleEnable":
        this.applyBusParams(p); break;
      case "lfo1Wave": case "lfo1Rate": case "lfo1Depth": case "lfo1Dest":
      case "lfo2Wave": case "lfo2Rate": case "lfo2Depth": case "lfo2Dest":
      case "lfo2Relation": case "lfo2PhaseOffset": case "lfo2Ratio": case "lfo2DriftMode":
      case "lfo1RateDisplay": case "lfo2RateDisplay":
        this.applyLfoParams(p); break;
      case "oscATable":
      case "oscBTable":
      case "oscCTable":
        this.warmBanks(p);
        for (const v of this.voices) this.rebindVoiceBanks(v, p); break;
      case "spectralMode": case "spectralAmount": case "spectralMix":
      case "spectralLow": case "spectralHigh": case "spectralWetOnly":
      case "spectralInGain": case "spectralOutGain":
        this.applySpectral(p); break;
      case "warpStretch": case "warpTilt": case "warpComb": case "warpAmount": case "warpMode":
        // Debounced: knob scrubs settle before the warped banks re-render.
        if (this.warpTimer) clearTimeout(this.warpTimer);
        this.warpTimer = setTimeout(() => {
          this.warpTimer = null;
          this.applyWarpBanks();
        }, 80);
        break;
      case "subWave":
        for (const v of this.voices) v.setSubWave(p.subWave); break;
      case "oscALevel": case "oscBLevel": case "oscCLevel": case "subLevel": case "noiseLevel":
      case "noiseColor": case "noiseMode": case "noiseDensity": case "noiseGrain":
      case "subTranslate": case "subPhaseAlign":
        for (const v of this.voices) v.setOscLevels(p); break;
      case "oscAOctave": case "oscBOctave": case "oscCOctave": case "subOctave":
      case "oscBPhaseLock": case "oscBInherit":
        for (const v of this.voices) v.applyTuning(p, this.ctx.currentTime, false); break;
      case "oscADetune": case "oscBDetune": case "oscCDetune": case "unisonDetune": case "unisonWidth":
      case "unisonMix": case "unisonAnchor": case "unisonDistribution": case "unisonPhase":
      case "unisonTemporalSpread": case "unisonTemporalMode":
        for (const v of this.voices) {
          v.applyUnisonSpread(p);
          v.setOscLevels(p);
        }
        break;
      case "fmAmount": case "fmRatio": case "fmBtoA": case "fmAtoB":
      case "fmEngine": case "fmAlg": case "fmFeedback":
      case "fmOp1Level": case "fmOp2Level": case "fmOp3Level": case "fmOp4Level":
      case "fmOp2Ratio": case "fmOp3Ratio": case "fmOp4Ratio":
      case "fmVectorCorners": case "fmVectorX": case "fmVectorY":
      case "hardSync": case "chipAcidMix":
        for (const v of this.voices) v.applyFm(p); break;
      case "filterType": case "filterCutoff": case "filterResonance":
      case "filterEnvAmount": case "filterEnvResoAmount": case "filterKeyTrack":
      case "filterCarve": case "filterCarveAmount":
        for (const v of this.voices) v.setFilterLive(p); break;
      case "filterSlope": case "filterDrivePos": case "filterModel":
        // Filter topology (extra poles, pre/post drive routing, ladder/SVF
        // worklet vs biquad) is baked per voice at construction — rebuild so
        // the change is audible immediately, not only on the next note.
        // Voices only: see retopologizeVoices for why this must not flush the
        // FX bus or swap the engine's shared limiters.
        this.retopologizeVoices(p); break;
      case "filterDrive":
        this.filterDriveCurve = makeFilterDriveCurve(p.filterDrive);
        for (const v of this.voices) v.setFilterDriveCurve(this.filterDriveCurve);
        break;
      case "modMatrix":
        // Re-digest the routes and re-assert per-voice bases so removing a
        // route can't leave a parameter stuck at its last modulated value.
        // Re-evaluate the reverb-convolver bypass in case a reverb route was
        // just added or removed.
        this.recomputeMatrix();
        this.updateReverbConvolver(p);
        for (const v of this.voices) {
          v.setFilterLive(p);
          v.setOscLevels(p);
          v.applyFm(p);
          v.clearMod();
        }
        break;
      case "macroResponse":
        if ((value as FirePatch["macroResponse"]) === "relative") {
          this.macroBaseline[0] = p.macro1;
          this.macroBaseline[1] = p.macro2;
          this.macroBaseline[2] = p.macro3;
          this.macroBaseline[3] = p.macro4;
        }
        break;
      case "unison":
        // Unison voice count is baked into each Voice at construction — rebuild
        // the voices only, not the FX bus (see retopologizeVoices).
        this.retopologizeVoices(p);
        break;
      case "mono":
        if (value) {
          // Collapse poly stack so mono mode doesn't leave dangling voices.
          this.allNotesOff();
        }
        break;
      default:
        break;
    }
  }

  getPatch(): FirePatch { return { ...this.patch }; }

  private applyBusParams(p: FirePatch): void {
    const t = this.ctx.currentTime;
    const on = (id: string) => p.moduleEnable?.[id] !== false;
    const pathDrive = p.pathDrive !== false && on("fx.drive");
    const pathAge = p.pathAge !== false && on("fx.vintage");
    const pathFx = p.pathFx !== false;
    const pathMix = p.pathMix !== false;
    const pressure = this.getCpuPressure();

    this.master.gain.setTargetAtTime(pathMix ? clamp(p.masterGain, 0, 1.2) : 0, t, 0.02);

    const driveAmt = pathDrive ? p.drive : 0;
    const crushAmt = pathDrive ? clamp(p.crush, 0, 1) : 0;
    const bias = pathDrive ? (p.driveBias ?? 0) : 0;
    const sym = pathDrive ? (p.driveSymmetry ?? 0) : 0;
    // Under heavy patches, force eco oversampling even if the knob says Live/High.
    // Hysteresis (enter hot 0.65, leave 0.5) stops the oversample + drive-curve
    // rebuild from flapping when voice count hovers around a single threshold.
    this.ecoHot = pressure > (this.ecoHot ? 0.5 : 0.65);
    const qEff = this.ecoHot ? "eco" : (p.fxQuality ?? "live");
    const driveKey = `${p.driveMode}|${driveAmt.toFixed(3)}|${bias.toFixed(2)}|${sym.toFixed(2)}|${qEff}`;
    if (driveKey !== this.lastDriveKey) {
      this.driveShaper.curve = makeDriveCurve(driveAmt, p.driveMode, bias, sym);
      // Keep ≥2× on the wavefolder even in eco — its harmonics alias badly at 1×.
      this.driveShaper.oversample = qEff === "eco" ? (p.driveMode === "fold" ? "2x" : "none") : qEff === "live" ? "2x" : "4x";
      this.lastDriveKey = driveKey;
    }
    // The master soft clip keeps 2× oversampling ALWAYS. Dropping it under
    // load traded CPU for aliasing at exactly the moment the signal was most
    // likely to hit the shoulder (dense arps / big chords) — the reported
    // "corruption when sounds get too complex". Eco mode still saves CPU on
    // the drive/crush shapers above, which is where the real cost lives.
    this.softClip.oversample = "2x";
    const inG = pathDrive ? clamp(p.driveInGain ?? 1, 0, 2) : 1;
    const outG = pathDrive ? clamp(p.driveOutGain ?? 1, 0, 2) : 1;
    const auto = pathDrive && (p.driveAutoGain !== false);
    // Pre-pad into shaper domain + user input trim
    this.drivePre.gain.setTargetAtTime(inG * (1 + driveAmt * 1.2) / DRIVE_RANGE, t, 0.02);
    // Auto-gain pulls output back as drive rises
    const ag = auto ? 1 / (1 + driveAmt * 0.85) : 1;
    this.drivePost.gain.setTargetAtTime(outG * ag, t, 0.02);
    this.driveDcHp.frequency.setTargetAtTime(pathDrive && (p.driveDcBlock !== false) ? 18 : 5, t, 0.05);
    const crushBits = 16 - crushAmt * 13;
    if (Math.abs(crushBits - this.lastCrushBits) > 0.02) {
      this.crushShaper.curve = makeCrushCurve(crushBits);
      this.lastCrushBits = crushBits;
    }
    // The bit-crush staircase is a hard nonlinearity — oversample it so its
    // images don't fold back as harsh alias tones (it ran at 1× before).
    this.crushShaper.oversample = crushAmt > 0.02 ? "4x" : "none";
    this.crushDry.gain.setTargetAtTime(1 - crushAmt, t, 0.02);
    this.crushWet.gain.setTargetAtTime(crushAmt, t, 0.02);

    // Low-frequency protection across FX rack
    const lpHz = (() => {
      const mode = p.lowProtect ?? "off";
      if (mode === "off") return 20;
      if (mode === "custom") return clamp(p.lowProtectHz ?? 100, 20, 500);
      if (mode === "80") return 80;
      if (mode === "120") return 120;
      if (mode === "200") return 200;
      return 20;
    })();
    this.lowProtectHp.frequency.setTargetAtTime(lpHz, t, 0.05);

    // Vintage Age bus — force neutral when path Age or module is off.
    // AGE macro scales unlocked groups; evolve adds light wow wander.
    const ageMacro = clamp(p.ageMacro ?? 0, 0, 1);
    const evolve = clamp(p.ageEvolve ?? 0, 0, 1) * (0.85 + 0.15 * Math.sin(t * 0.17));
    const scaleAge = (v: number, locked: boolean | undefined) =>
      locked ? v : clamp(v + ageMacro * (0.35 - v * 0.2) + evolve * 0.04, 0, 1);
    // Groups: Medium (cass/vhs/comp) · Motion (speed/wow/bbd) · Wear · Resolution
    this.vintage.apply(pathAge ? {
      cassetteGen: scaleAge(p.cassetteGen ?? 0, p.ageLockMedium),
      vhsColor: scaleAge(p.vhsColor ?? 0, p.ageLockMedium),
      analogComp: scaleAge(p.analogComp ?? 0, p.ageLockMedium),
      tapeSpeed: scaleAge(p.tapeSpeed ?? 0, p.ageLockMotion),
      wowFlutter: scaleAge((p.wowFlutter ?? 0) + evolve * 0.08, p.ageLockMotion),
      bbdChorus: scaleAge(p.bbdChorus ?? 0, p.ageLockMotion),
      bitDepth: p.bitDepth ?? "off",
      sampleRateReduce: scaleAge(p.sampleRateReduce ?? 0, p.ageLockResolution),
      dust: scaleAge(p.dust ?? 0, p.ageLockWear) * (1 + evolve * 0.3 * Math.random()),
      hiss: scaleAge(p.hiss ?? 0, p.ageLockWear),
      hum: scaleAge(p.hum ?? 0, p.ageLockWear),
      printThrough: scaleAge(p.printThrough ?? 0, p.ageLockWear),
    } : {
      cassetteGen: 0, tapeSpeed: 0, wowFlutter: 0, vhsColor: 0, bitDepth: "off",
      sampleRateReduce: 0, bbdChorus: 0, analogComp: 0, dust: 0, hiss: 0, hum: 0, printThrough: 0,
    });
    // Age in/out trim via crushOut / ring — approximate with vintage wet path identity
    const ageIn = pathAge ? clamp(p.ageInGain ?? 1, 0, 2) : 1;
    const ageOut = pathAge ? clamp(p.ageOutGain ?? 1, 0, 2) : 1;
    this.crushOut.gain.setTargetAtTime(ageIn, t, 0.03);
    this.ringOut.gain.setTargetAtTime(ageOut, t, 0.03);

    // Glue module owns bus compress (punch knob). Age analogComp still layers lightly.
    const glueOn = on("glue");
    const glueAmt = glueOn ? clamp(p.punch, 0, 1) : 0;
    const ac = pathAge ? clamp(p.analogComp ?? 0, 0, 1) : 0;
    const glueMode = (p.glueMode ?? "glue") as GlueMode;
    const macro = punchMacroToGlue(glueAmt, glueMode);
    const useAdv = !!(p.glueUseAdvanced);
    const thr = useAdv ? clamp(p.glueThreshold ?? -18, -60, 0) : macro.threshDb - ac * 8;
    const ratio = useAdv ? clamp(p.glueRatio ?? 3, 1, 20) : 1 + (macro.ratio - 1) + ac * 2;
    const atk = useAdv ? clamp(p.glueAttack ?? 0.008, 0.001, 0.1) : macro.attack;
    const rel = useAdv ? clamp(p.glueRelease ?? 0.18, 0.02, 1) : macro.release;
    const knee = useAdv ? clamp(p.glueKnee ?? 6, 0, 40) : macro.knee;
    const makeupLin = useAdv ? clamp(p.glueMakeup ?? 1, 0.5, 4) : macro.makeup;
    // TRUE BYPASS when the glue is doing nothing: with punch = 0 (the
    // default!) and no Age analogComp and no advanced settings, glueMix = 1
    // still routed 100% of the program through the DynamicsCompressor —
    // Chromium's implementation adds ~4-6 ms of lookahead latency, its own
    // makeup-gain model and an adaptive release even at ratio 1. Every
    // default patch paid that smear, which is a big slice of the "sounds
    // washed out / attacks feel soft" complaint. Idle glue now takes the
    // clean parallel dry path (bit-exact wire).
    const glueIdle = glueAmt < 0.005 && ac < 0.005 && !useAdv;
    const glueMix = glueOn && !glueIdle ? clamp(p.glueMix ?? 1, 0, 1) : 0;
    const gIn = glueOn ? clamp(p.glueInGain ?? 1, 0, 2) : 1;
    const gOut = glueOn ? clamp(p.glueOutGain ?? 1, 0, 2) : 1;
    const autoG = glueOn && (p.glueAutoGain !== false);
    this.punchIn.gain.setTargetAtTime(gIn, t, 0.03);
    this.punchComp.threshold.setTargetAtTime(thr, t, 0.05);
    this.punchComp.ratio.setTargetAtTime(ratio, t, 0.05);
    this.punchComp.attack.setTargetAtTime(atk, t, 0.05);
    this.punchComp.release.setTargetAtTime(rel, t, 0.05);
    this.punchComp.knee.setTargetAtTime(knee, t, 0.05);
    const mixDelta = !!(p.mixDeltaAudition);
    // Parallel: dry bypasses compressor; delta solos the wet contribution.
    this.punchDry.gain.setTargetAtTime(mixDelta ? 0 : (1 - glueMix), t, 0.03);
    this.punchWet.gain.setTargetAtTime(glueMix, t, 0.03);
    const glueAg = autoG ? 1 / (1 + glueAmt * 0.25) : 1;
    // Cap stacked makeup × out-gain — advanced knobs alone could hit 8× and
    // only engage once dense material trips the compressor (sudden crunch).
    const makeupProduct = clamp(makeupLin * gOut * glueAg, 0.5, 2.0);
    this.punchMakeup.gain.setTargetAtTime(makeupProduct, t, 0.05);

    this.applyMasterChainScene(p.masterChainScene ?? "glueAirWidth");

    const phaserOn = pathFx && on("fx.phaser");
    const phMix = phaserOn ? clamp(p.phaserMix, 0, 1) : 0;
    const phDepth = clamp(p.phaserDepth, 0, 1);
    const shared = !!(p.fxSharedMod);
    const phRate = shared ? clamp(p.chorusRate, 0.02, 12) * 0.85 : clamp(p.phaserRate, 0.02, 12);
    this.phaserLfo.frequency.setTargetAtTime(phRate, t, 0.02);
    const center = clamp(p.phaserCenter ?? 800, 100, 8000);
    const stageScale = clamp((p.phaserStages ?? 4) / 4, 0.5, 3);
    // Cap the sweep: center 8 kHz × depth 1 × stageScale 3 used to modulate
    // the allpass frequencies by ±16.8 kHz — way past Nyquist headroom,
    // heard as harsh metallic hash. 2.4 kHz of swing is a deep, musical
    // phase sweep; the cap also keeps center − depth safely above 0 Hz.
    const depthHz = Math.min(center * 0.7 * phDepth * stageScale, Math.min(center * 0.85, 2400));
    this.phaserDepth.gain.setTargetAtTime(depthHz, t, 0.02);
    for (let i = 0; i < this.phaserAP.length; i++) {
      const ap = this.phaserAP[i]!;
      ap.frequency.setTargetAtTime(center * (0.7 + i * 0.18), t, 0.05);
    }
    const stereo = p.phaserStereo ?? "linked";
    // Opposed/quadrature: skew R-side allpass via feedback polarity / wet.
    // Feedback around a unity-magnitude allpass chain peaks at ~1/(1-fb): the
    // old 0.9 ceiling was +20 dB of metallic self-resonance straight into the
    // drive stage. Cap it, and trim the wet only in the hot end of the range so
    // patches at the 0.35 default are untouched.
    const fbAmt = clamp(p.phaserFeedback ?? 0.35, 0, PHASER_FB_CEIL);
    const fbTrim = 1 - 0.3 * clamp((fbAmt - 0.5) / 0.5, 0, 1);
    const delta = !!(p.fxDeltaAudition);
    this.phaserDry.gain.setTargetAtTime(delta ? 0 : 1, t, 0.02);
    this.phaserWet.gain.setTargetAtTime(
      this.fxSilenced ? 0 : phMix * fbTrim * (delta ? 1.4 : 1) * (stereo === "opposed" ? 1.1 : 1),
      t,
      0.02,
    );
    this.phaserFb.gain.setTargetAtTime(
      this.fxSilenced ? 0 : phMix * fbAmt * (stereo === "quadrature" ? 0.75 : 1),
      t,
      0.02,
    );

    // Ring lives under FM · Ring module.
    const ringOn = on("fm");
    const ring = ringOn ? clamp(p.ringAmount, 0, 1) : 0;
    this.ringDry.gain.setTargetAtTime(1 - ring, t, 0.02);
    this.ringDepth.gain.setTargetAtTime(ring, t, 0.02);
    let ringHz = clamp(p.ringFreq, 1, 8000);
    if ((p.ringMode ?? "ratio") === "ratio") {
      let base = 220;
      for (const v of this.voices) { base = v.baseFreq; break; }
      const ratio = p.ringFreq > 32 ? clamp(p.ringFreq / 220, 0.25, 16) : clamp(p.ringFreq, 0.25, 16);
      ringHz = clamp(base * ratio, 1, 8000);
    }
    this.ringCarrier.frequency.setTargetAtTime(ringHz, t, 0.02);

    const chorusOn = pathFx && on("fx.chorus");
    const chMix = chorusOn ? clamp(p.chorusMix, 0, 1) : 0;
    this.chorusDry.gain.setTargetAtTime(delta ? 0 : (1 - chMix * 0.5), t, 0.02);
    this.chorusWet.gain.setTargetAtTime(this.fxSilenced ? 0 : chMix * (delta ? 1.35 : 1), t, 0.02);
    const model = p.chorusModel ?? "dual";
    const voices = clamp(Math.round(p.chorusVoices ?? 2), 1, 4);
    const baseDelay = clamp(p.chorusDelay ?? 0.012, 0.004, 0.04);
    const spread = clamp(p.chorusSpread ?? 0.7, 0, 1);
    const rateMul = model === "tape" ? 0.55 : model === "ensemble" ? 1.4 : model === "dimension" ? 0.9 : 1;
    const depthMul = model === "triple" || voices >= 3 ? 1.25 : model === "single" ? 0.7 : 1;
    const chRate = shared ? clamp(p.phaserRate, 0.05, 8) : clamp(p.chorusRate, 0.05, 8);
    this.cLfoL.frequency.setTargetAtTime(chRate * rateMul, t, 0.02);
    this.cLfoR.frequency.setTargetAtTime(chRate * rateMul * (model === "dimension" ? 1.01 : 1.18), t, 0.02);
    this.cDepthL.gain.setTargetAtTime(p.chorusDepth * 0.006 * depthMul, t, 0.02);
    this.cDepthR.gain.setTargetAtTime(p.chorusDepth * 0.006 * depthMul * (0.85 + spread * 0.3), t, 0.02);
    this.cDelayL.delayTime.setTargetAtTime(baseDelay, t, 0.03);
    this.cDelayR.delayTime.setTargetAtTime(baseDelay * (1.05 + spread * 0.25), t, 0.03);
    this.cPanL.pan.setTargetAtTime(-0.8 * spread, t, 0.03);
    this.cPanR.pan.setTargetAtTime(0.8 * spread, t, 0.03);
    // Mono-below / chorus low cut via lowProtect + chorusLowCut. The shared HP
    // sits upstream of the chorus dry/wet split, so only let a chorus control
    // touch it while the chorus is actually contributing.
    const chCut = Math.max(lpHz, chMix > 0.0005 ? clamp(p.chorusLowCut ?? 0, 0, 400) : 0);
    if (chCut > 30) this.lowProtectHp.frequency.setTargetAtTime(chCut, t, 0.05);

    const mode = p.delayCascadeMode ?? "echo";
    let dTime = clamp(p.delayTime, 0.001, 2);
    if (p.delaySync) {
      const bpm = clamp(this.hostBpm || 120, 40, 300);
      // delayTime as beat fractions when sync (0.25 ≈ 1/4 note)
      dTime = clamp((60 / bpm) * Math.max(0.125, dTime * 4), 0.001, 2);
    }
    if (mode === "slap") dTime = Math.min(dTime, 0.12);
    if (mode === "long" || mode === "infinite") dTime = Math.max(dTime, 0.45);
    const rRatio = mode === "bounce" ? 1.5 : mode === "dub" ? 1.35 : 1.5;
    this.dL.delayTime.setTargetAtTime(dTime, t, 0.02);
    this.dR.delayTime.setTargetAtTime(dTime * rRatio, t, 0.02);
    let fb = clamp(p.delayFeedback, 0, 0.72);
    // Musical echo/dub tops out below runaway — IceKing-class ~0.41 FB still
    // cooks ping-pong buffers over minutes without an audible change in tone.
    if (mode === "echo" || mode === "dub" || mode === "bounce" || mode === "slap") {
      fb = Math.min(fb, 0.38);
    }
    // Near-unity loops fill quietly then explode — keep freeze/infinite musical
    // but below runaway. Hard ceiling after mode overrides.
    if (mode === "infinite") fb = Math.min(0.85, Math.max(fb, 0.78));
    if (mode === "slap") fb = Math.min(fb, 0.25);
    if (p.delayFreeze) fb = Math.min(0.88, Math.max(fb, 0.82));
    // Feedback-path filter/drive: applied INSIDE the loop, so each repeat is
    // darker and grittier than the last (and hiss / low-end can't stack up).
    const fbDrive = clamp(p.delayFbDrive ?? 0, 0, 1);
    const fbFilt = clamp(p.delayFbFilter ?? 0.35, 0, 1);
    fb = clamp(fb * (1 - fbDrive * 0.08), 0, 0.88);
    const delayOn = pathFx && on("fx.delay");
    let dMix = delayOn ? clamp(p.delayMix, 0, 1) : 0;
    // Simple duck: reduce wet when voices loud (voice count proxy)
    const duck = clamp(p.delayDuck ?? 0, 0, 1);
    if (duck > 0.01 && this.voices.size > 0) dMix *= 1 - duck * Math.min(1, this.voices.size / 4) * 0.7;
    // Hot-arp space duck: ≥20 notes/s into a 35%+ wet delay integrates into a
    // continuous wash that parks the bus limiter at −2…−3 dB ("IceKing wall").
    // Dense input already fills the room — trim the wet, keep the dry punch.
    // runTickBody reapplies bus params when the hot state flips, so this
    // engages/releases cleanly with the arp.
    if (isHotArp()) dMix *= 0.7;
    // Gate the feedback LOOP when wet is silent — otherwise the delay keeps
    // cooking on the tremolo feed with no audible output, then dumps hash the
    // moment any later preset opens delay mix (IceKing linger / NS poison).
    const delayLoop = !this.fxSilenced && dMix > 0.0005;
    this.dFbLR.gain.setTargetAtTime(delayLoop ? fb * (mode === "bounce" ? 0.85 : 1) : 0, t, 0.02);
    this.dFbRL.gain.setTargetAtTime(delayLoop ? fb * (mode === "bounce" ? 0.85 : 1) : 0, t, 0.02);
    // Dub-style band limiting: open at 0, ~6.5 kHz at the 0.35 default, tight at 1.
    const fbLp = clamp(18000 * Math.pow(0.06, fbFilt), 700, 18000);
    const fbHp = 40 + fbFilt * 140;
    this.dFbLpLR.frequency.setTargetAtTime(fbLp, t, 0.05);
    this.dFbLpRL.frequency.setTargetAtTime(fbLp, t, 0.05);
    this.dFbHpLR.frequency.setTargetAtTime(fbHp, t, 0.05);
    this.dFbHpRL.frequency.setTargetAtTime(fbHp, t, 0.05);
    const fbDriveKey = Math.round(fbDrive * 24);
    if (fbDriveKey !== this.lastFbDriveKey) {
      this.lastFbDriveKey = fbDriveKey;
      const curve = fbDrive < 0.02 ? null : makeFbDriveCurve(fbDrive);
      this.dFbSatLR.curve = curve;
      this.dFbSatRL.curve = curve;
    }
    this.delayWet.gain.setTargetAtTime(this.fxSilenced ? 0 : (delta ? dMix * 1.3 : dMix), t, 0.02);
    this.delayDry.gain.setTargetAtTime(delta ? 0 : 1, t, 0.02);
    // Tone LPF: post-delay bus (or both if driveTonePos says both — pre handled as mild lowpass via protect)
    const tonePos = p.driveTonePos ?? "post";
    const toneHz = clamp(p.tone, 200, 20000);
    this.tone.frequency.setTargetAtTime(tonePos === "pre" ? 20000 : toneHz, t, 0.02);

    const reverbOn = pathFx && on("fx.reverb");
    let revMix = reverbOn ? clamp(p.reverbMix, 0, 1) : 0;
    const revIn = clamp(p.reverbInGain ?? 1, 0, 2);
    const revOut = clamp(p.reverbOutGain ?? 1, 0, 2);
    this.reverbIn.gain.setTargetAtTime(revIn, t, 0.03);
    const early = clamp(p.reverbEarly ?? 0.45, 0, 1);
    // Early vs tail: more early → higher dry remainder. The trim now scales
    // with mix, so an enabled-but-silent reverb no longer costs 1.6 dB of bus.
    // Softened (0.4→0.25, 0.3→0.2): cutting 3+ dB of DRY on wet pads pushed
    // the source into the back of the room — with the new tighter IR the dry
    // can stay present without the sum overloading.
    const revDryTrim = 1 - revMix * (0.25 + (1 - early) * 0.2);
    this.reverbDry.gain.setTargetAtTime(delta ? 0 : revDryTrim, t, 0.04);
    if (p.reverbFreeze) revMix = Math.max(revMix, 0.85);
    // Hot-arp space duck — see the delay-side comment above.
    const revHotTrim = isHotArp() ? 0.82 : 1;
    this.reverbWet.gain.setTargetAtTime(
      this.fxSilenced ? 0 : revMix * revOut * revHotTrim * (delta ? 1.25 : 1) * (0.65 + (1 - early) * 0.45),
      t,
      0.04,
    );
    const pre = clamp(p.reverbPredelay ?? 0, 0, 0.2);
    if (Math.abs(pre - this.lastPredelay) > 0.0005) {
      this.reverbPredelay.delayTime.setTargetAtTime(pre, t, 0.03);
      this.lastPredelay = pre;
    }
    // Tail EQ on the wet path only: high cut band-limits the reverb, low decay
    // tilts how much low-frequency energy the tail keeps.
    const lowDec = clamp(p.reverbLowDecay ?? 0.55, 0, 1);
    const hiCut = clamp(p.reverbHighCut ?? 12000, 1000, 18000);
    this.revHiCut.frequency.setTargetAtTime(hiCut, t, 0.05);
    this.revLowShelf.gain.setTargetAtTime((lowDec - 0.55) * 8, t, 0.05);

    const widthOn = on("width");
    const wIn = widthOn ? clamp(p.widthInGain ?? 1, 0, 2) : 1;
    const wOut = widthOn ? clamp(p.widthOutGain ?? 1, 0, 2) : 1;
    const w = widthOn ? clamp(p.stereoWidth ?? 1, 0, 1.4) : 1;
    // Mechanism used to be two cosmetic nudges of the same M/S gain. Each mode
    // now runs its own side-path stage: sub-ms Haas lag, or an allpass pair
    // that scrambles side phase without touching magnitude.
    const mech = widthOn ? (p.widthMechanism ?? "ms") : "ms";
    this.widthSideDirect.gain.setTargetAtTime(mech === "ms" ? 1 : 0, t, 0.04);
    this.widthSideDelayAmt.gain.setTargetAtTime(mech === "microdelay" ? 1 : 0, t, 0.04);
    this.widthSideApAmt.gain.setTargetAtTime(mech === "decorrelate" ? 1 : 0, t, 0.04);
    if (mixDelta) {
      // Delta: exaggerate side vs mid (processed difference feel)
      this.widthSideAmt.gain.setTargetAtTime(Math.max(0, w - 1) * 2, t, 0.03);
    } else {
      this.widthSideAmt.gain.setTargetAtTime(w, t, 0.03);
    }
    this.widthIn.gain.setTargetAtTime(wIn, t, 0.03);
    this.widthOutGain.gain.setTargetAtTime(wOut, t, 0.03);
    const monoBelow = widthOn ? clamp(p.monoBelow ?? 0, 0, 400) : 0;
    this.widthSideHp.frequency.setTargetAtTime(monoBelow > 20 ? monoBelow : 20, t, 0.05);

    const airOn = on("air");
    const airAmt = airOn ? clamp(p.airAmount ?? 0, 0, 1) : 0;
    const aIn = airOn ? clamp(p.airInGain ?? 1, 0, 2) : 1;
    const aOut = airOn ? clamp(p.airOutGain ?? 1, 0, 2) : 1;
    this.airIn.gain.setTargetAtTime(aIn, t, 0.03);
    this.airOut.gain.setTargetAtTime(aOut, t, 0.03);
    let lowG = clamp(p.airLow ?? 0, -1, 1) * 12 * airAmt;
    let highG = clamp(p.airHigh ?? 0, -1, 1) * 10 * airAmt;
    if ((p.airArch ?? "dual") === "tilt") {
      // Tilt: opposite shelves from a single gesture (airHigh drives tilt)
      const tilt = clamp(p.airHigh ?? 0, -1, 1) * 8 * airAmt;
      lowG = -tilt;
      highG = tilt;
    }
    if (mixDelta) {
      // Solo the shelf delta vs flat
      this.airLow.gain.setTargetAtTime(lowG, t, 0.04);
      this.airHigh.gain.setTargetAtTime(highG, t, 0.04);
    } else {
      this.airLow.gain.setTargetAtTime(lowG, t, 0.04);
      this.airHigh.gain.setTargetAtTime(highG, t, 0.04);
    }
    // airMsMode: sides-only high shelf approximation — reduce mid via lower low shelf when M/S
    if (airOn && p.airMsMode) {
      this.airLow.gain.setTargetAtTime(lowG * 0.35, t, 0.04);
      this.airHigh.frequency.setTargetAtTime(4500, t, 0.05);
    } else {
      this.airHigh.frequency.setTargetAtTime(6500, t, 0.05);
    }

    this.updateReverbConvolver(p, pathFx && reverbOn);

    // Voice re-sync is only needed when path/module toggles change what
    // oscillators hear — pure bus knobs (master/delay/reverb…) must not
    // walk every live voice on every set().
    const voiceSyncKey = [
      p.pathOsc === false ? "0" : "1",
      p.moduleEnable?.["osc.a"] === false ? "0" : "1",
      p.moduleEnable?.["osc.b"] === false ? "0" : "1",
      p.moduleEnable?.["osc.c"] === false ? "0" : "1",
      p.moduleEnable?.["sub"] === false ? "0" : "1",
      p.moduleEnable?.["noise"] === false ? "0" : "1",
      p.moduleEnable?.["filter"] === false ? "0" : "1",
      p.moduleEnable?.["fm"] === false ? "0" : "1",
      p.moduleEnable?.["mixer.unison"] === false ? "0" : "1",
    ].join("");
    if (voiceSyncKey !== this.lastBusVoiceSyncKey) {
      this.lastBusVoiceSyncKey = voiceSyncKey;
      for (const v of this.voices) {
        v.setOscLevels(p);
        v.setFilterLive(p);
        v.applyFm(p);
        v.applyUnisonSpread(p);
      }
    }

    const spectralOn = pathFx && on("fx.spectral");
    if (!spectralOn && p.spectralMode !== "off") {
      this.applySpectral({ ...p, spectralMode: "off" });
    } else {
      this.applySpectral(p);
    }
  }

  /**
   * Arm or release the convolution reverb. A ConvolverNode keeps doing full
   * (multi-second) convolution even on silence, so when the reverb is
   * inaudible — mix ~0 with no matrix route driving it, which is the default
   * patch — we drop its impulse response entirely and it costs nothing. The
   * buffer is nulled on a short delay so the wet tail has ramped to silence
   * first (click-free), and rebuilt on demand the moment it's needed again.
   */
  private updateReverbConvolver(p: FirePatch, pathFx = true): void {
    const revMix = pathFx ? clamp(p.reverbMix, 0, 1) : 0;
    const matrixOn = p.moduleEnable?.["matrix"] !== false;
    const reverbNeeded = revMix > 0.0005 || (pathFx && matrixOn && this.mtxHasReverbRoute);
    if (!reverbNeeded) {
      if (this.reverbConv.buffer !== null && !this.revNullTimer) {
        this.revNullTimer = setTimeout(() => {
          this.reverbConv.buffer = null;
          this.lastIrKey = "";
          this.revNullTimer = null;
        }, 220);
      }
      return;
    }
    if (this.revNullTimer) { clearTimeout(this.revNullTimer); this.revNullTimer = null; }
    const key = `${clamp(p.reverbSize, 0.2, 6).toFixed(2)}|${clamp(p.reverbDamp ?? 0.45, 0, 1).toFixed(2)}|${clamp(p.reverbDiffusion ?? 0.7, 0, 1).toFixed(2)}`;
    if (this.reverbConv.buffer === null) {
      if (this.irTimer) { clearTimeout(this.irTimer); this.irTimer = null; }
      this.buildReverbIR(p);
    } else if (key !== this.lastIrKey) {
      if (this.irTimer) clearTimeout(this.irTimer);
      this.irTimer = setTimeout(() => { this.buildReverbIR(p); this.irTimer = null; }, 140);
    }
  }

  /**
   * Engage / retune / bypass the spectral FX worklet.
   *
   * The worklet module + node are created lazily the FIRST time a patch
   * actually turns the effect on, then kept for the synth's lifetime. When
   * active, the dry gain crossfades to 0 and the whole bus flows through the
   * STFT (which adds 2048 samples ≈ 43 ms of latency — dry/wet inside the
   * worklet is latency-matched, so the mix knob never combs). When off, the
   * plain dry branch carries the signal and the worklet idles in bypass.
   */
  /**
   * Build + wire the spectral worklet node. Split out of applySpectral so the
   * offline bounce can create it SYNCHRONOUSLY once the module is loaded —
   * the async `.then` path could otherwise miss the render window entirely
   * and export a patch with its spectral FX missing.
   */
  private createSpectralNode(): boolean {
    if (this.spectralNode) return true;
    try {
      this.spectralNode = new AudioWorkletNode(this.ctx, "kc-spectral", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
    } catch (err) {
      console.warn("[FireCommand] spectral node creation failed — FX bypassed:", err);
      this.spectralState = "failed";
      return false;
    }
    this.spectralSend.connect(this.spectralNode).connect(this.spectralOutTrim);
    this.spectralOutTrim.connect(this.autopan);
    this.spectralState = "ready";
    return true;
  }

  /**
   * OFFLINE BOUNCE PRE-WARM. An OfflineAudioContext renders as fast as it can,
   * so anything loaded asynchronously (the ladder/SVF filter worklet, the
   * spectral STFT) can miss the render entirely — ladder patches silently
   * exported through the biquad fallback and spectral FX went missing.
   * Await this before scheduling notes so the offline graph matches live.
   */
  async prewarmWorkletsForRender(): Promise<void> {
    this.filterWorkletReady = await loadFilterModule(this.ctx);
    const p = this.patch;
    const wantSpectral =
      (p.spectralMode ?? "off") !== "off" && clamp(p.spectralMix ?? 0, 0, 1) > 0.001;
    if (wantSpectral && this.spectralState !== "ready") {
      const ok = await loadSpectralModule(this.ctx);
      this.spectralState = ok && this.createSpectralNode() ? "ready" : "failed";
      this.applySpectral(p);
    }
  }

  /**
   * OFFLINE BOUNCE modulation tick. The 60 Hz `updateMod` timer is wall-clock
   * and deliberately never starts offline, which left every bounce with the
   * trance gate wide open, sample-hold LFOs frozen and matrix routes stuck at
   * their initial value. The exporter drives this once per 1/60 s of render
   * time (via OfflineAudioContext.suspend) so the same code path shapes the
   * render that shapes live playback.
   */
  tickModulationForRender(): void {
    if (!this.offlineSafe) return;
    this.offlineTick = true;
    try {
      this.updateMod();
    } catch { /* never let a mod tick abort a render */ } finally {
      this.offlineTick = false;
    }
  }

  private applySpectral(p: FirePatch): void {
    const mode = p.spectralMode ?? "off";
    // Wet-only: process when delay/reverb wet is present (SpecTail routing scene).
    const wetGate = p.spectralWetOnly
      ? Math.max(clamp(p.delayMix ?? 0, 0, 1), clamp(p.reverbMix ?? 0, 0, 1))
      : 1;
    const mix = clamp((p.spectralMix ?? 0) * wetGate, 0, 1);
    const active = mode !== "off" && mix > 0.001;
    if (active && this.spectralState === "idle") {
      this.spectralState = "loading";
      void loadSpectralModule(this.ctx).then((ok) => {
        if (!ok) { this.spectralState = "failed"; return; }
        if (!this.createSpectralNode()) return;
        // Re-run against the CURRENT patch — it may have changed (or turned
        // the effect back off) while addModule was in flight.
        this.applySpectral(this.patch);
      });
    }
    const t = this.ctx.currentTime;
    const on = active && this.spectralState === "ready" && this.spectralNode !== null;
    // spectralInGain / spectralOutGain were declared and defaulted but never
    // read — drive into the STFT and post-trim now actually work, matching the
    // in/out gain pairs the other FX modules already honor.
    const inG = clamp(p.spectralInGain ?? 1, 0, 2);
    const outG = clamp(p.spectralOutGain ?? 1, 0, 2);
    this.spectralDry.gain.setTargetAtTime(on ? 0 : 1, t, 0.03);
    this.spectralSend.gain.setTargetAtTime(on ? inG : 0, t, 0.03);
    this.spectralOutTrim.gain.setTargetAtTime(outG, t, 0.03);
    // Under CPU pressure, ask the worklet for mono STFT (copy L→R) — ~½ cost.
    const eco = on && this.getCpuPressure() > 0.55;
    const msgKey = `${mode}|${(p.spectralAmount ?? 0.6).toFixed(3)}|${mix.toFixed(3)}|${on ? 1 : 0}|${(p.spectralLow ?? 0).toFixed(2)}|${(p.spectralHigh ?? 1).toFixed(2)}|${eco ? 1 : 0}`;
    if (msgKey !== this.lastSpectralMsg) {
      this.lastSpectralMsg = msgKey;
      this.spectralNode?.port.postMessage({
        mode,
        amount: clamp(p.spectralAmount ?? 0.6, 0, 1),
        mix,
        bypass: !on,
        binLow: clamp(p.spectralLow ?? 0, 0, 1),
        binHigh: clamp(p.spectralHigh ?? 1, 0, 1),
        eco,
      });
    }
  }

  private applyLfoParams(p: FirePatch): void {
    const d1 = p.moduleEnable?.["lfo.1"] === false ? 0 : p.lfo1Depth;
    const d2 = p.moduleEnable?.["lfo.2"] === false ? 0 : p.lfo2Depth;
    const relation = p.lfo2Relation ?? "independent";
    // Audio-rate LFO banks: when Twin Orbit locks LFO2 to LFO1, mirror rate into bank 2.
    let rate2 = p.lfo2Rate;
    let wave2 = p.lfo2Wave;
    if (relation !== "independent") {
      wave2 = p.lfo1Wave;
      if (relation === "ratio") rate2 = clamp(p.lfo1Rate * clamp(p.lfo2Ratio ?? 1, 0.125, 8), 0.01, 40);
      else rate2 = p.lfo1Rate;
    }
    this.applyOneLfo(this.lfo1, p.lfo1Wave, p.lfo1Rate, d1, p.lfo1Dest);
    const dest2 = relation === "invert" && p.lfo2Dest === "off" ? p.lfo1Dest : p.lfo2Dest;
    // Invert polarity for dedicated dest gains when relation is invert.
    const depth2 = relation === "invert" ? d2 : d2;
    this.applyOneLfo(this.lfo2, wave2, rate2, depth2, dest2);
    if (relation === "invert") {
      // Flip dedicated dest by negating depth on bank 2.
      const t = this.ctx.currentTime;
      const d = clamp(depth2, 0, 1);
      this.lfo2.filterDepth.gain.setTargetAtTime(dest2 === "filter" ? -d * 5000 : 0, t, 0.02);
      this.lfo2.pitchDepth.gain.setTargetAtTime(dest2 === "pitch" ? -d * 1200 : 0, t, 0.02);
      this.lfo2.panDepth.gain.setTargetAtTime(dest2 === "pan" ? -d : 0, t, 0.02);
      this.lfo2.ampDepth.gain.setTargetAtTime(dest2 === "volume" ? -d * 0.9 : 0, t, 0.02);
    }
  }

  private applyOneLfo(bank: LfoBank, wave: LfoWave, rate: number, depth: number, dest: LfoDest): void {
    const t = this.ctx.currentTime;
    const sh = wave === "sample-hold";
    if (wave !== "sample-hold") bank.osc.type = wave;
    bank.oscGain.gain.setTargetAtTime(sh ? 0 : 1, t, 0.01);
    bank.shGain.gain.setTargetAtTime(sh ? 1 : 0, t, 0.01);
    bank.osc.frequency.setTargetAtTime(clamp(rate, 0.01, 40), t, 0.02);
    const d = clamp(depth, 0, 1);
    bank.filterDepth.gain.setTargetAtTime(dest === "filter" ? d * 5000 : 0, t, 0.02);
    bank.pitchDepth.gain.setTargetAtTime(dest === "pitch" ? d * 1200 : 0, t, 0.02);
    bank.panDepth.gain.setTargetAtTime(dest === "pan" ? d : 0, t, 0.02);
    bank.ampDepth.gain.setTargetAtTime(dest === "volume" ? d * 0.9 : 0, t, 0.02);
  }

  getActiveVoiceCount(): number { return this.voices.size; }

  /** Live Glue compressor reduction in dB (≤ 0). */
  getPunchReduction(): number {
    return this.punchComp.reduction;
  }

  /**
   * Phase 6 — reconnect Glue ↔ Air order (Width stays post-gate for stability;
   * width-early scenes swap Air past Glue only; full Width relocate is soft).
   */
  private applyMasterChainScene(scene: MasterChainScene): void {
    if (scene === this.lastMasterChain) return;
    this.lastMasterChain = scene;
    try {
      this.tone.disconnect();
      this.punchMakeup.disconnect();
      this.airOut.disconnect();
    } catch { /* ignore */ }
    // Always: tone → punchIn … punchMakeup → airIn … airOut → reverbIn
    // Scenes that put Air before Glue:
    if (scene === "airGlueWidth") {
      this.tone.connect(this.airIn);
      this.airOut.connect(this.punchIn);
      this.punchMakeup.connect(this.reverbIn);
    } else {
      // glueAirWidth | glueWidthAir | widthGlueAir — keep Glue before Air
      this.tone.connect(this.punchIn);
      this.punchMakeup.connect(this.airIn);
      this.airOut.connect(this.reverbIn);
    }
  }
}

/**
 * Deep-clone a Fire patch so nested arrays/objects never alias factory defaults,
 * user presets, or the live store (the NS→loadPreset contamination class).
 */
export function cloneFirePatch(raw: FirePatch | Partial<FirePatch>): FirePatch {
  const src = { ...DEFAULT_FIRE_PATCH, ...raw } as FirePatch;
  const patch: FirePatch = { ...src };
  // Scrub non-finite scalars (corrupt persistence, a bad import, or a mutate
  // that produced NaN/Infinity). A non-finite value written to an AudioParam
  // throws and can wedge the graph into silence — fall back to the factory
  // default for that key.
  const def = DEFAULT_FIRE_PATCH as unknown as Record<string, unknown>;
  const rec = patch as unknown as Record<string, unknown>;
  for (const k in def) {
    if (typeof def[k] === "number" && typeof rec[k] === "number" && !Number.isFinite(rec[k] as number)) {
      rec[k] = def[k];
    }
  }
  patch.modMatrix = makeModMatrix(Array.isArray(src.modMatrix) ? src.modMatrix : []);
  patch.moduleEnable = { ...(src.moduleEnable ?? {}) };
  patch.modEnvPoints = Array.isArray(src.modEnvPoints)
    ? src.modEnvPoints.map((pt) => ({ ...pt }))
    : DEFAULT_FIRE_PATCH.modEnvPoints.map((pt) => ({ ...pt }));
  patch.gatePattern = Array.isArray(src.gatePattern)
    ? src.gatePattern.map((v) => clamp(Number(v) || 0, 0, 1)).slice(0, 16)
    : [...DEFAULT_FIRE_PATCH.gatePattern];
  while (patch.gatePattern.length < 16) patch.gatePattern.push(0);
  patch.chordIntervals = Array.isArray(src.chordIntervals)
    ? [...src.chordIntervals]
    : [...DEFAULT_FIRE_PATCH.chordIntervals];
  patch.scaleFollowers = {
    harmony: src.scaleFollowers?.harmony !== false,
    chord: src.scaleFollowers?.chord !== false,
    arp: src.scaleFollowers?.arp !== false,
    pianoRoll: !!src.scaleFollowers?.pianoRoll,
  };
  const corners = Array.isArray(src.fmVectorCorners) && src.fmVectorCorners.length >= 4
    ? src.fmVectorCorners
    : DEFAULT_FIRE_PATCH.fmVectorCorners;
  patch.fmVectorCorners = corners.map((c) => ({
    levels: c.levels.map((v) => (Number.isFinite(v) ? v : 0)) as [number, number, number, number],
    ratios: c.ratios.map((v) => (Number.isFinite(v) ? v : 1)) as [number, number, number],
    feedback: Number.isFinite(c.feedback) ? c.feedback : 0,
  }));
  return patch;
}

export const DEFAULT_FIRE_PATCH: FirePatch = {
  // Neutral Init — one oscillator, no FX wet, no unison stack.
  // Presets that want color must set it explicitly (via P(overrides)).
  oscATable: "basic", oscAPos: 0.66, oscAEnv: 0, oscALfo: 0, oscAOctave: 0, oscADetune: 0, oscALevel: 0.75,
  oscAContinuity: 0.72,
  oscBTable: "saw", oscBPos: 0.4, oscBEnv: 0, oscBLfo: 0, oscBOctave: 0, oscBDetune: 0, oscBLevel: 0,
  oscBInherit: "off", oscBPhaseLock: false, fmAtoB: 0,
  oscCTable: "harmonic", oscCPos: 0.4, oscCEnv: 0, oscCLfo: 0, oscCOctave: -1, oscCDetune: 0, oscCLevel: 0,
  warpStretch: 0, warpTilt: 0, warpComb: 0, warpAmount: 1, warpMode: "classic",
  unison: 1, unisonDetune: 0, unisonWidth: 0.5,
  unisonMix: 1, unisonAnchor: true, unisonDistribution: "linear", unisonPhase: "locked",
  unisonTemporalSpread: 0, unisonTemporalMode: "ltr", unisonEnvSpread: 0,
  subWave: "sine", subLevel: 0, subPhaseAlign: true, subTranslate: 0,
  noiseLevel: 0, noiseColor: 0, noiseMode: "bed", noiseDensity: 0.45, noiseGrain: 0.35,
  fmAmount: 0, fmRatio: 2, fmBtoA: 0, ringAmount: 0, ringFreq: 220,
  filterType: "lowpass", filterModel: "biquad", filterCutoff: 2600, filterResonance: 0.7, filterEnvAmount: 0, filterEnvResoAmount: 0,
  filterKeyTrack: 0.3,
  filterDrive: 0, filterDrivePos: "post", filterSlope: 1, filterCarve: "off", filterCarveAmount: 0,
  ampAttack: 0.01, ampDecay: 0.25, ampSustain: 0.8, ampRelease: 0.35, velAmount: 1, velAttack: 0,
  ampModel: "vca", ampCurveAttack: "lin", ampCurveDecay: "exp", ampCurveRelease: "exp",
  ampRetrigger: "zero", ampHold: 0, ampOvershoot: 0,
  lpgOn: false, lpgDecay: 0.4, lpgColor: 0.7, lpgModel: "classic",
  lpgStrike: 1, lpgRing: 1, lpgLeakage: 0, lpgChoke: true, lpgResoCouple: 0,
  filtAttack: 0.01, filtDecay: 0.3, filtSustain: 0.5, filtRelease: 0.3,
  filtCurveAttack: "lin", filtCurveDecay: "exp", filtCurveRelease: "exp",
  modAttack: 0.02, modDecay: 0.5, modSustain: 0.3, modRelease: 0.4,
  modEnvPoints: [
    { t: 0, level: 0, curve: "lin" },
    { t: 0.02, level: 1, curve: "exp" },
    { t: 0.52, level: 0.3, curve: "log" },
  ],
  modEnvSustainIndex: 2,
  modEnvLoop: false,
  lfo1Wave: "sine", lfo1Rate: 5, lfo1Depth: 0, lfo1Dest: "off",
  lfo1RateDisplay: "hz",
  lfo2Wave: "triangle", lfo2Rate: 0.5, lfo2Depth: 0, lfo2Dest: "off",
  lfo2RateDisplay: "hz",
  lfo2Relation: "independent",
  lfo2PhaseOffset: 90,
  lfo2Ratio: 1,
  lfo2DriftMode: "locked",
  pitchEnvAmount: 0, pitchEnvTime: 0.2,
  mono: false, glide: 0,
  glideMode: "legato",
  glideCurve: "exp",
  glideRateMode: "time",
  harmonyMode: "off", harmonyLevel: 0.6,
  drive: 0, driveMode: "soft", crush: 0, tone: 15000, punch: 0,
  glueInGain: 1, glueOutGain: 1, glueAutoGain: true, glueMode: "glue",
  glueThreshold: -18, glueRatio: 3, glueAttack: 0.008, glueRelease: 0.18, glueKnee: 6, glueMakeup: 1, glueMix: 1,
  glueUseAdvanced: false, mixDeltaAudition: false, masterChainScene: "glueAirWidth",
  driveInGain: 1, driveOutGain: 1, driveAutoGain: true,
  driveBias: 0, driveSymmetry: 0, driveDcBlock: true, driveTonePos: "post",
  phaserRate: 0.4, phaserDepth: 0.6, phaserMix: 0,
  phaserStages: 4, phaserFeedback: 0.35, phaserCenter: 800, phaserStereo: "linked",
  chorusRate: 0.6, chorusDepth: 0.4, chorusMix: 0,
  chorusVoices: 2, chorusDelay: 0.012, chorusSpread: 0.7, chorusModel: "dual", chorusLowCut: 0,
  delayTime: 0.28, delayFeedback: 0.3, delayMix: 0,
  delaySync: false, delayCascadeMode: "echo", delayDuck: 0, delayFbFilter: 0.35, delayFbDrive: 0, delayFreeze: false,
  reverbSize: 2.2, reverbMix: 0, reverbDamp: 0.45, reverbPredelay: 0.02, reverbDiffusion: 0.7,
  reverbEarly: 0.45, reverbLowDecay: 0.55, reverbHighCut: 12000, reverbFreeze: false,
  spectralMode: "off", spectralAmount: 0.6, spectralMix: 0.5,
  spectralLow: 0, spectralHigh: 1, spectralFftSize: 2048,
  fxQuality: "live", lowProtect: "off", lowProtectHz: 100, fxDeltaAudition: false,
  ageInGain: 1, ageOutGain: 1, reverbInGain: 1, reverbOutGain: 1, spectralInGain: 1, spectralOutGain: 1,
  ageLockMedium: false, ageLockMotion: false, ageLockWear: false, ageLockResolution: false,
  ageMacro: 0, ageEvolve: 0,
  fxSharedMod: false, fxRoutingScene: "serial", spectralWetOnly: false,
  macro1: 0, macro2: 0, macro3: 0, macro4: 0,
  modMatrix: makeModMatrix(),
  drift: 0,
  driftRate: 0.35,
  voiceInstability: 0,
  tuneVariance: 0,
  envVariance: 0,
  analogDnaSeed: 0x73a9c412,
  analogDnaLock: false,
  analogWake: 0,
  analogTremor: 0.55,
  analogBreath: 0.45,
  analogClimate: 0.3,
  analogEvents: 0,
  cassetteGen: 0,
  tapeSpeed: 0,
  wowFlutter: 0,
  vhsColor: 0,
  bitDepth: "off",
  sampleRateReduce: 0,
  bbdChorus: 0,
  analogComp: 0,
  dust: 0,
  hiss: 0,
  hum: 0,
  printThrough: 0,
  pulseDuty: 0.5,
  hardSync: false,
  chipNoise: "white",
  chipVoiceLimit: 0,
  accentAmount: 0,
  slideOn: false,
  chipAcidMix: 0.35,
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
  vectorRate: 0,
  vectorDepth: 0,
  ringMode: "ratio",
  fmVectorCorners: [
    { levels: [1, 0.7, 0.5, 0.35], ratios: [1, 2, 3], feedback: 0 },
    { levels: [1, 0.9, 0.4, 0.2], ratios: [1, 3, 5], feedback: 0.2 },
    { levels: [0.8, 0.5, 0.7, 0.4], ratios: [2, 1, 4], feedback: 0.1 },
    { levels: [1, 0.6, 0.6, 0.6], ratios: [1, 1.5, 2.5], feedback: 0.35 },
  ],
  fmVectorX: 0.5,
  fmVectorY: 0.5,
  pathOsc: true,
  pathFilter: true,
  pathDrive: true,
  pathAge: true,
  pathFx: true,
  pathMix: true,
  pathScope: true,
  stereoWidth: 1,
  widthInGain: 1, widthOutGain: 1, monoBelow: 0, widthMechanism: "ms", widthCorrWarn: 0.2,
  gateOn: false, gateRate: 8, gateDepth: 1, gateSteps: 16,
  gatePattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  gateSmooth: 0,
  gateDest: "volume",
  masterGain: 0.72,
  subOctave: -1,
  airLow: 0,
  airHigh: 0,
  airAmount: 0,
  airInGain: 1, airOutGain: 1, airArch: "dual", airMsMode: false,
  scopeDisplayGain: 1,
  voiceSteal: "oldest",
  ceaseMode: "notes",
  scaleLock: false,
  scaleMode: "guide",
  scaleFollowers: { harmony: true, chord: true, arp: true, pianoRoll: false },
  chordMemoryOn: false,
  chordMode: "memory",
  chordIntervals: [0, 4, 7],
  humanizeOn: false,
  humanizeTiming: 0.25,
  humanizeVelocity: 0.2,
  humanizeSeed: 0x4f1ce,
  humanizeSeedMode: "fixed",
  humanizeProtectDownbeats: true,
  macroResponse: "absolute",
  harmonyVoiceLead: "parallel",
  harmonyLow: 36,
  harmonyHigh: 96,
  moduleEnable: {},
};
