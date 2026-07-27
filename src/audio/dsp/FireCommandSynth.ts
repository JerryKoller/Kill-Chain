/**
 * FireCommandSynth — a wavetable software synthesiser for Fire Command, aimed
 * "in the direction of" Serum/Massive: morphing wavetable oscillators, deep
 * modulation (two LFOs + a wavetable-morphing mod-envelope), unison, and a
 * full stereo FX bus (drive, crush, ring, chorus, ping-pong delay, reverb).
 * Its master output sums into the AudioEngine `inputBus`, so it flows through
 * the same downstream chain as music (EQ, FX, spatializer, limiter) unless the
 * global bypass ("FX: OFF") is engaged.
 *
 * Wavetable playback is intentionally light on CPU: each table is pre-rendered
 * into a dense bank of `SUBFRAMES` band-limited `PeriodicWave`s (the morph is
 * interpolated in harmonic space at build time). A voice therefore needs only
 * ONE oscillator per unison voice; morphing just swaps which bank entry it
 * plays, at control-rate, and only when the entry actually changes. This keeps
 * polyphony affordable and avoids the audio dropouts that a 2-oscillator
 * crossfade design caused under chords.
 */

import {
  WAVETABLE_IDS,
  SUBFRAMES,
  harmonicsAt,
  applyWarp,
} from "./wavetables";
import { FireVintageAge } from "./FireVintageAge";

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

// ── Modulation matrix ──
export type ModSource =
  | "none" | "lfo1" | "lfo2" | "modenv" | "velocity" | "keytrack"
  | "macro1" | "macro2" | "macro3" | "macro4" | "random";
export type ModDest =
  | "none" | "pitch" | "cutoff" | "resonance" | "wtA" | "wtB" | "wtC"
  | "levelA" | "levelB" | "levelC" | "fm" | "pan" | "volume" | "reverb" | "delay";
export interface ModRoute { source: ModSource; dest: ModDest; amount: number; }
// MK IV: 8 → 12 slots. makeModMatrix pads shorter (legacy) matrices with
// inert routes, so every persisted patch/preset loads unchanged.
export const MOD_SLOTS = 12;
/** Build a fixed-length (MOD_SLOTS) matrix, padding/truncating as needed. */
export function makeModMatrix(routes: ModRoute[] = []): ModRoute[] {
  const out: ModRoute[] = [];
  for (let i = 0; i < MOD_SLOTS; i++) {
    const r = routes[i];
    out.push(r ? { source: r.source, dest: r.dest, amount: r.amount } : { source: "none", dest: "none", amount: 0 });
  }
  return out;
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
  // ── Oscillator B (wavetable) ──
  oscBTable: string;
  oscBPos: number;
  oscBEnv: number;
  oscBLfo: number;
  oscBOctave: number;
  oscBDetune: number;
  oscBLevel: number;
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
  // ── Unison ──
  unison: number;
  unisonDetune: number;
  unisonWidth: number;
  // ── Sub + Noise ──
  subWave: SubWave;
  subLevel: number;
  noiseLevel: number;
  /** -1..1 noise tilt: -1 = dark rumble (LP 350 Hz), 0 = white, +1 = airy hiss (HP 6 kHz). */
  noiseColor: number;
  // ── FM + Ring ──
  fmAmount: number;
  fmRatio: number;
  /** 0..1 — osc B's audio output frequency-modulates osc A (2-op cross FM). */
  fmBtoA: number;
  ringAmount: number;
  ringFreq: number;
  // ── Filter ──
  filterType: FireFilterType;
  filterCutoff: number;
  filterResonance: number;
  filterEnvAmount: number;
  filterKeyTrack: number;
  /** 0..1 per-voice post-filter saturation (0 = clean, exactly current behavior). */
  filterDrive: number;
  // ── Amp ADSR ──
  ampAttack: number;
  ampDecay: number;
  ampSustain: number;
  ampRelease: number;
  /** 0..1 velocity → amp depth. 1 = full tracking (legacy behavior), 0 = fixed level. */
  velAmount: number;
  // ── Lowpass gate (v1.7, Aalto-style vactrol) ──
  /** LPG mode replaces the amp/filter ADSR with a struck vactrol envelope. */
  lpgOn: boolean;
  /** Ring-out time of the strike, seconds (0.05..2.5). */
  lpgDecay: number;
  /** 0..1 — how much the gate colors the tone (drives cutoff with the strike). */
  lpgColor: number;
  // ── Filter ADSR ──
  filtAttack: number;
  filtDecay: number;
  filtSustain: number;
  filtRelease: number;
  // ── Mod envelope (morph/timbre) ──
  modAttack: number;
  modDecay: number;
  modSustain: number;
  modRelease: number;
  // ── LFO 1 ──
  lfo1Wave: LfoWave;
  lfo1Rate: number;
  lfo1Depth: number;
  lfo1Dest: LfoDest;
  // ── LFO 2 ──
  lfo2Wave: LfoWave;
  lfo2Rate: number;
  lfo2Depth: number;
  lfo2Dest: LfoDest;
  // ── Pitch env + voice ──
  pitchEnvAmount: number;
  pitchEnvTime: number;
  mono: boolean;
  glide: number;
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
  // ── Phaser ──
  phaserRate: number;
  phaserDepth: number;
  phaserMix: number;
  // ── Chorus + Delay ──
  chorusRate: number;
  chorusDepth: number;
  chorusMix: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  // ── Reverb ──
  reverbSize: number;
  reverbMix: number;
  /** 0..1 — high-frequency damping in the IR (0 = bright, 1 = dark). */
  reverbDamp: number;
  /** 0..0.2 — wet-path pre-delay seconds. */
  reverbPredelay: number;
  /** 0..1 — early/dense diffusion character. */
  reverbDiffusion: number;
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
  // ── Stereo width (bus mid/side) ──
  /** 0 = mono, 1 = untouched (legacy behavior), up to 1.4 = extra-wide sides. */
  stereoWidth: number;
  // ── Trance gate ──
  gateOn: boolean;
  gateRate: number;   // steps per second
  gateDepth: number;  // 0..1, how deep closed steps cut
  gateSteps: number;  // 2..16 active steps
  gatePattern: number[]; // length 16, 0/1
  /** 0..1 edge softness — 0 = hard chop (legacy), 1 = pumping swells. */
  gateSmooth: number;
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
  /** Live scale-lock (snap played notes to sequencer scale). */
  scaleLock: boolean;
  /** Chord memory: fire stored intervals with each key. */
  chordMemoryOn: boolean;
  /** Relative semis from the played root, e.g. [0, 4, 7]. */
  chordIntervals: number[];
  /** Sequencer / live humanize enable. */
  humanizeOn: boolean;
  /** 0..1 timing jitter strength. */
  humanizeTiming: number;
  /** 0..1 velocity jitter strength. */
  humanizeVelocity: number;
  /**
   * Per-module enable map. Missing key = on; `false` = bypassed.
   * Keys match fireModuleAtlas module ids.
   */
  moduleEnable: Record<string, boolean>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MAX_UNISON = 7;

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

function makeDriveCurve(drive: number, mode: DriveMode = "soft"): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  if (drive <= 0) {
    // Identity over the full ±DRIVE_RANGE span (curve values may exceed ±1 —
    // WaveShaper output is unclamped, only its input domain is [-1, 1]).
    for (let i = 0; i < n; i++) curve[i] = ((i / (n - 1)) * 2 - 1) * DRIVE_RANGE;
    return curve;
  }
  const shape = (x: number): number => {
    switch (mode) {
      case "tube": {
        // asymmetric soft clip — even harmonics, warm
        const k = 1 + drive * 7;
        const y = x >= 0 ? Math.tanh(k * x) : Math.tanh(k * 0.6 * x);
        return y / Math.tanh(k);
      }
      case "fold": {
        // sine wavefolder — extra reflections add metallic harmonics with drive
        const g = 1 + drive * 5;
        return Math.sin(x * g * Math.PI * 0.5);
      }
      case "hard": {
        const g = 1 + drive * 9;
        return clamp(x * g, -1, 1);
      }
      case "fuzz": {
        // aggressive, near-square with rounded shoulders
        const k = 1 + drive * 22;
        return Math.tanh(k * x);
      }
      case "soft":
      default: {
        const k = 1 + drive * 8;
        return Math.tanh(k * x) / Math.tanh(k);
      }
    }
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
  const n = 8192;
  const curve = new Float32Array(n);
  const knee = 0.7;
  const span = 0.98 - knee; // shoulder height → ceiling asymptote 0.98
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  }
  return curve;
}

function unisonSpread(n: number): number[] {
  if (n <= 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i / (n - 1)) * 2 - 1);
  return out;
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
  osc: OscillatorNode[];
  pans: StereoPannerNode[];
  level: GainNode;
  bank: PeriodicWave[];
  lastK: number;
}

/** One polyphonic, stereo wavetable voice. */
class Voice {
  private readonly groupA: Group;
  private readonly groupB: Group;
  private readonly groupC: Group | null;
  private readonly sub: OscillatorNode;
  private readonly gSub: GainNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly gNoise: GainNode;
  /** Tilt filter on the noise layer (noiseColor: dark ↔ white ↔ bright). */
  private readonly noiseFilt: BiquadFilterNode;
  private readonly fmOsc: OscillatorNode;
  private readonly fmGain: GainNode;
  /** Osc B audio → osc A frequency (cross FM). Scaled by fmBtoA in applyFm. */
  private readonly xmodGain: GainNode;
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
  /** Equal-power unison normalization: keeps a group's loudness constant as the
   *  unison voice count rises (wider, not louder) so stacked unison can't blow
   *  past the soft-clip on its own. */
  private readonly uNorm: number;

  midi: number;
  baseFreq: number;
  startedAt: number;
  releaseAt: number | null = null;
  velocity: number;
  releasing = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

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
  ) {
    this.midi = midi;
    this.velocity = velocity;
    this.baseFreq = midiToFreq(midi);
    this.unisonCount = Math.round(clamp(p.unison, 1, MAX_UNISON));
    this.uNorm = 1 / Math.sqrt(this.unisonCount);
    // Analog Life: static per-note tuning variance (audible cents spread).
    this.tuneCents = (Math.random() * 2 - 1) * clamp(p.tuneVariance ?? 0, 0, 1) * 85;
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

    this.groupA = this.makeGroup(ctx, this.unisonCount, bankA);
    this.groupB = this.makeGroup(ctx, this.unisonCount, bankB);
    this.groupC = p.oscCLevel > 0.0001 ? this.makeGroup(ctx, this.unisonCount, bankC) : null;
    this.groupA.level.connect(this.mix);
    this.groupB.level.connect(this.mix);
    this.groupC?.level.connect(this.mix);
    // Cross FM: osc B's summed audio drives osc A's frequency. Tapped from
    // the group's raw sum (pre-level) so oscBLevel = 0 still allows B to act
    // as a pure (silent) modulator, Serum-style.
    for (const pan of this.groupB.pans) pan.connect(this.xmodGain);
    for (const o of this.groupA.osc) this.xmodGain.connect(o.frequency);

    this.sub = ctx.createOscillator();
    this.sub.type = p.subWave;
    this.gSub = ctx.createGain();
    this.sub.connect(this.gSub).connect(this.mix);

    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;
    this.noiseFilt = ctx.createBiquadFilter();
    this.gNoise = ctx.createGain();
    this.noise.connect(this.noiseFilt).connect(this.gNoise).connect(this.mix);

    // mix → filter → (pad → filter-drive shaper) → vca. At filterDrive = 0
    // the shaper's curve is the exact identity over ±CLIP_RANGE, so the two
    // extra nodes are tonally transparent while still hard-bounding a
    // pathological voice (max unison + resonance) at ±CLIP_RANGE.
    this.fdPad = ctx.createGain();
    this.fdPad.gain.value = 1 / CLIP_RANGE;
    this.fdShaper = ctx.createWaveShaper();
    this.fdShaper.curve = synth.filterDriveCurve;
    this.mix.connect(this.filter).connect(this.fdPad).connect(this.fdShaper).connect(this.vca).connect(dest);

    this.filter.type = p.filterType;
    this.filter.Q.value = clamp(p.filterResonance, 0.0001, 30);

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

    // FM + LFO + pitch-env taps into every oscillator.
    for (const o of this.allOscs()) this.fmGain.connect(o.frequency);
    for (const bank of [synth.lfo1, synth.lfo2]) {
      bank.filterDepth.connect(this.filter.frequency);
      for (const o of this.allOscs()) bank.pitchDepth.connect(o.detune);
      bank.pitchDepth.connect(this.sub.detune);
    }
    for (const o of this.allOscs()) this.pitchEnv.connect(o.detune);
    this.pitchEnv.connect(this.sub.detune);
    for (const o of this.allOscs()) this.modDetune.connect(o.detune);
    this.modDetune.connect(this.sub.detune);

    this.setOscLevels(p);
    this.setFilterLive(p);

    this.applyTuning(p, t, true);
    this.applyFm(p);
    this.applyUnisonSpread(p);
    this.setWtA(clamp(p.oscAPos, 0, 1));
    this.setWtB(clamp(p.oscBPos, 0, 1));
    this.setWtC(clamp(p.oscCPos, 0, 1));

    for (const o of this.allOscs()) o.start(t);
    this.sub.start(t);
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

  private makeGroup(ctx: AudioContext, count: number, bank: PeriodicWave[]): Group {
    const osc: OscillatorNode[] = [];
    const pans: StereoPannerNode[] = [];
    const level = ctx.createGain();
    for (let i = 0; i < count; i++) {
      const o = ctx.createOscillator();
      const pan = ctx.createStereoPanner();
      o.setPeriodicWave(bank[0]);
      o.connect(pan).connect(level);
      osc.push(o);
      pans.push(pan);
    }
    return { osc, pans, level, bank, lastK: -1 };
  }

  private allOscs(): OscillatorNode[] {
    return this.groupC
      ? [...this.groupA.osc, ...this.groupB.osc, ...this.groupC.osc]
      : [...this.groupA.osc, ...this.groupB.osc];
  }

  private setWt(group: Group, pos: number): void {
    const k = Math.round(clamp(pos, 0, 1) * (SUBFRAMES - 1));
    if (k === group.lastK) return;
    group.lastK = k;
    const wave = group.bank[k];
    for (const o of group.osc) o.setPeriodicWave(wave);
  }

  setWtA(pos: number): void { this.setWt(this.groupA, pos); }
  setWtB(pos: number): void { this.setWt(this.groupB, pos); }
  setWtC(pos: number): void { if (this.groupC) this.setWt(this.groupC, pos); }

  setBankA(bank: PeriodicWave[]): void { this.groupA.bank = bank; this.groupA.lastK = -1; }
  setBankB(bank: PeriodicWave[]): void { this.groupB.bank = bank; this.groupB.lastK = -1; }
  setBankC(bank: PeriodicWave[]): void { if (this.groupC) { this.groupC.bank = bank; this.groupC.lastK = -1; } }
  hasGroupC(): boolean { return this.groupC !== null; }

  setSubWave(w: SubWave): void { this.sub.type = w; }

  private detuneFor(p: FirePatch, group: "a" | "b" | "c", i: number): number {
    const spread = unisonSpread(this.unisonCount);
    const base = group === "a" ? p.oscADetune : group === "b" ? p.oscBDetune : p.oscCDetune;
    return base + spread[i] * p.unisonDetune;
  }

  applyUnisonSpread(p: FirePatch): void {
    const unisonOn = p.moduleEnable?.["mixer.unison"] !== false;
    const count = unisonOn ? this.unisonCount : 1;
    const spread = unisonSpread(this.unisonCount);
    const t = this.ctx.currentTime;
    const detune = unisonOn ? p.unisonDetune : 0;
    const width = unisonOn ? p.unisonWidth : 0;
    for (let i = 0; i < this.unisonCount; i++) {
      const pan = (count <= 1 ? 0 : spread[i]) * width;
      this.groupA.pans[i].pan.setTargetAtTime(pan, t, 0.02);
      this.groupB.pans[i].pan.setTargetAtTime(pan, t, 0.02);
      const baseA = p.oscADetune + (unisonOn ? spread[i] * detune : 0);
      const baseB = p.oscBDetune + (unisonOn ? spread[i] * detune : 0);
      this.groupA.osc[i].detune.setValueAtTime(baseA, t);
      this.groupB.osc[i].detune.setValueAtTime(baseB, t);
      if (this.groupC) {
        this.groupC.pans[i].pan.setTargetAtTime(pan, t, 0.02);
        this.groupC.osc[i].detune.setValueAtTime(p.oscCDetune + (unisonOn ? spread[i] * detune : 0), t);
      }
    }
  }

  applyTuning(p: FirePatch, t: number, immediate: boolean): void {
    this.baseFreq = midiToFreq(this.midi);
    const fA = this.baseFreq * Math.pow(2, p.oscAOctave);
    const fB = this.baseFreq * Math.pow(2, p.oscBOctave);
    const fC = this.baseFreq * Math.pow(2, p.oscCOctave);
    // Acid slide: legato glide stretches when slideOn.
    const pitchOn = p.moduleEnable?.["pitch"] !== false;
    const chipSlide = p.slideOn && p.moduleEnable?.["chip"] !== false;
    const glideBase = (pitchOn || chipSlide) ? p.glide : 0;
    const glideSec = (chipSlide && p.mono && !immediate)
      ? Math.max(glideBase, 0.14) * 2.2
      : glideBase;
    const setFreq = (osc: OscillatorNode, f: number) => {
      if (immediate || glideSec <= 0) osc.frequency.setValueAtTime(f, t);
      else osc.frequency.setTargetAtTime(f, t, Math.max(0.005, glideSec / 3));
    };
    for (const o of this.groupA.osc) setFreq(o, fA);
    for (const o of this.groupB.osc) setFreq(o, fB);
    if (this.groupC) for (const o of this.groupC.osc) setFreq(o, fC);
    setFreq(this.sub, this.baseFreq * Math.pow(2, p.subOctave ?? -1));
    this.applyUnisonSpread(p);
  }

  applyFm(p: FirePatch): void {
    const t = this.ctx.currentTime;
    const fmOn = p.moduleEnable?.["fm"] !== false;
    const rackOn = p.moduleEnable?.["fm.rack"] !== false;
    if (!fmOn && !rackOn) {
      this.fmGain.gain.setValueAtTime(0, t);
      this.xmodGain.gain.setTargetAtTime(0, t, 0.02);
      return;
    }
    // BUG FIX: FM Rack (ops4) only applies when BOTH fm module AND fm.rack module are on.
    if ((p.fmEngine ?? "classic") === "ops4" && fmOn && rackOn) {
      // 4-op rack: op1 is carrier (audible via fmGain into all osc freqs as
      // a brightener); ops 2–4 stack as modulators with algorithm-ish ratios.
      const fb = clamp(p.fmFeedback ?? 0, 0, 1);
      const l1 = clamp(p.fmOp1Level ?? 1, 0, 1);
      const l2 = clamp(p.fmOp2Level ?? 0.7, 0, 1);
      const l3 = clamp(p.fmOp3Level ?? 0.5, 0, 1);
      const l4 = clamp(p.fmOp4Level ?? 0.35, 0, 1);
      const r2 = clamp(p.fmOp2Ratio ?? 1, 0.25, 16);
      const r3 = clamp(p.fmOp3Ratio ?? 2, 0.25, 16);
      const r4 = clamp(p.fmOp4Ratio ?? 3, 0.25, 16);
      const alg = Math.round(clamp(p.fmAlg ?? 0, 0, 7));
      // Algorithm blends how much stacked modulators feed the carrier index.
      const modIdx = (l2 * r2 + l3 * r3 * (alg >= 2 ? 1 : 0.35) + l4 * r4 * (alg >= 4 ? 1 : 0.2)) / 3;
      this.fmOsc.frequency.setValueAtTime(this.baseFreq * r2, t);
      this.fmGain.gain.setValueAtTime((0.15 + l1 * 0.85) * modIdx * this.baseFreq * (4 + fb * 4), t);
      const xm = (p.fmBtoA ?? 0.15 + fb * 0.5) * this.baseFreq * 4 / this.unisonCount;
      this.xmodGain.gain.setTargetAtTime(xm, t, 0.02);
      return;
    }
    if (!fmOn) {
      this.fmGain.gain.setValueAtTime(0, t);
      const chipOn = p.moduleEnable?.["chip"] !== false;
      const syncBoost = chipOn && p.hardSync ? Math.max(p.fmBtoA ?? 0, 0.88) : 0;
      this.xmodGain.gain.setTargetAtTime(syncBoost * this.baseFreq * 10 / this.unisonCount, t, 0.02);
      return;
    }
    const fmAmt = p.hardSync ? Math.max(p.fmAmount, 0.22) : p.fmAmount;
    this.fmOsc.frequency.setValueAtTime(this.baseFreq * p.fmRatio, t);
    this.fmGain.gain.setValueAtTime(fmAmt * this.baseFreq * (p.hardSync ? 9 : 6), t);
    // Hard sync feel: strong B→A cross-mod (PeriodicWave can't hard-reset phase).
    const syncBoost = p.hardSync ? Math.max(p.fmBtoA ?? 0, 0.88) : (p.fmBtoA ?? 0);
    const xm = syncBoost * this.baseFreq * (p.hardSync ? 10 : 4) / this.unisonCount;
    this.xmodGain.gain.setTargetAtTime(xm, t, 0.02);
  }

  private baseCutoff(p: FirePatch): number {
    const track = p.filterKeyTrack * ((this.midi - 60) / 12);
    return clamp(p.filterCutoff * Math.pow(2, track), 20, 20000);
  }

  triggerEnvelopes(p: FirePatch, velocity: number, t: number): void {
    this.velocity = velocity;
    this.releaseAt = null;
    this.startedAt = t;
    // velAmount scales how much velocity moves the amp peak: 1 = full
    // tracking (legacy), 0 = every note lands at full level.
    const va = clamp(p.velAmount ?? 1, 0, 1);
    const peak = clamp(1 - va * (1 - clamp(velocity, 0, 1)), 0, 1);

    if (p.lpgOn && p.moduleEnable?.["pluck"] !== false) {
      // ── Lowpass gate (v1.7): a struck vactrol drives BOTH the VCA and the
      // cutoff instead of the ADSR pair. 1–3 ms strike (harder hits snap
      // faster, like a real photoresistor), exponential ring-out, and the
      // filter tracking the envelope scaled by lpgColor — loud is bright,
      // quiet is dark, which is the entire Buchla/Aalto sound.
      const decay = clamp(p.lpgDecay ?? 0.4, 0.05, 2.5);
      const color = clamp(p.lpgColor ?? 0.7, 0, 1);
      const strike = 0.001 + (1 - clamp(velocity, 0, 1)) * 0.002; // 1..3 ms

      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(Math.max(0, this.ampEnv.offset.value), t);
      this.ampEnv.offset.linearRampToValueAtTime(peak, t + strike);
      this.ampEnv.offset.setTargetAtTime(0, t + strike, decay / 3);

      const base = this.baseCutoff(p);
      // Fully-open peak brightens with velocity; the closed floor darkens
      // with color. At color 0 the gate is a plain VCA (cutoff stays put).
      const openHz = clamp(base * Math.pow(2, (1 + 2 * clamp(velocity, 0, 1)) * color), 20, 18000);
      const floorHz = clamp(base * Math.pow(2, -4.5 * color), 30, 18000);
      this.filter.frequency.setValueAtTime(base, t);
      this.filterEnv.offset.cancelScheduledValues(t);
      this.filterEnv.offset.setValueAtTime(floorHz - base, t);
      this.filterEnv.offset.linearRampToValueAtTime(openHz - base, t + strike);
      // The filter closes slightly ahead of the amplitude — vactrol lag.
      this.filterEnv.offset.setTargetAtTime(floorHz - base, t + strike, (decay / 3) * 0.8);
    } else {
      const jitter = clamp(p.envVariance ?? 0, 0, 1);
      const j = (base: number) => Math.max(0.001, base * (1 + (Math.random() * 2 - 1) * jitter * 0.95));
      const ampAtk = j(p.ampAttack);
      const ampDec = j(p.ampDecay);
      const filtAtk = j(p.filtAttack);
      const filtDec = j(p.filtDecay);
      this.ampEnv.offset.cancelScheduledValues(t);
      this.ampEnv.offset.setValueAtTime(Math.max(0, this.ampEnv.offset.value), t);
      this.ampEnv.offset.linearRampToValueAtTime(peak, t + ampAtk);
      this.ampEnv.offset.setTargetAtTime(peak * p.ampSustain, t + ampAtk, Math.max(0.005, ampDec / 3));

      const base = this.baseCutoff(p);
      this.filter.frequency.setValueAtTime(base, t);
      // Acid accent: high velocity opens filter harder when accentAmount > 0.
      const accent = clamp(p.accentAmount ?? 0, 0, 1) * clamp(velocity, 0, 1);
      const envAmt = p.filterEnvAmount + accent * 1.15;
      const peakOff = clamp(base * Math.pow(2, envAmt * 4.5), 20, 20000) - base;
      this.filterEnv.offset.cancelScheduledValues(t);
      this.filterEnv.offset.setValueAtTime(0, t);
      this.filterEnv.offset.linearRampToValueAtTime(peakOff, t + filtAtk);
      this.filterEnv.offset.setTargetAtTime(peakOff * p.filtSustain, t + filtAtk, Math.max(0.005, filtDec / 3));
      // Accent also lifts amp peak.
      if (accent > 0.04) {
        const boosted = clamp(peak * (1 + accent * 0.4), 0, 1.25);
        this.ampEnv.offset.cancelScheduledValues(t);
        this.ampEnv.offset.setValueAtTime(Math.max(0, this.ampEnv.offset.value), t);
        this.ampEnv.offset.linearRampToValueAtTime(boosted, t + ampAtk);
        this.ampEnv.offset.setTargetAtTime(boosted * p.ampSustain, t + ampAtk, Math.max(0.005, ampDec / 3));
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

  noteOff(p: FirePatch, when?: number): void {
    if (this.releasing || this.stopped) return;
    this.releasing = true;
    const now = this.ctx.currentTime;
    const t = Math.max(now, when ?? now);
    this.releaseAt = t;
    if (p.lpgOn && p.moduleEnable?.["pluck"] !== false) {
      // LPG notes ring out on their own strike decay — note-off doesn't cut
      // them, it just schedules cleanup once the vactrol has fully closed.
      const decay = clamp(p.lpgDecay ?? 0.4, 0.05, 2.5);
      const tail = (t - now) + decay * 4 + 0.15;
      this.endTimer = setTimeout(() => this.forceStop(), tail * 1000);
      return;
    }
    const rel = Math.max(0.01, p.ampRelease);
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
    this.ampEnv.offset.setTargetAtTime(0, t, rel / 4);
    hold(this.filterEnv.offset);
    this.filterEnv.offset.setTargetAtTime(0, t, Math.max(0.01, p.filtRelease) / 4);
    const tail = (t - now) + rel * 4 + 0.15;
    this.endTimer = setTimeout(() => this.forceStop(), tail * 1000);
  }

  /** Quick click-free fade then stop — used when stealing a voice. */
  fastRelease(): void {
    if (this.stopped) return;
    this.releasing = true;
    const t = this.ctx.currentTime;
    this.ampEnv.offset.cancelScheduledValues(t);
    this.ampEnv.offset.setValueAtTime(Math.max(0, this.ampEnv.offset.value), t);
    this.ampEnv.offset.setTargetAtTime(0, t, 0.006);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => this.forceStop(), 40);
  }

  forceStop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    const srcs: AudioScheduledSourceNode[] = [
      ...this.allOscs(), this.sub, this.fmOsc, this.noise, this.ampEnv, this.filterEnv, this.pitchEnv,
      this.modDetune, this.modCutoff,
    ];
    for (const n of srcs) {
      try { n.stop(); } catch { /* already stopped */ }
      try { n.disconnect(); } catch { /* ignore */ }
    }
    for (const bank of [this.synth.lfo1, this.synth.lfo2]) {
      try { bank.filterDepth.disconnect(this.filter.frequency); } catch { /* ignore */ }
      for (const o of this.allOscs()) {
        try { bank.pitchDepth.disconnect(o.detune); } catch { /* ignore */ }
      }
      try { bank.pitchDepth.disconnect(this.sub.detune); } catch { /* ignore */ }
    }
    const others: AudioNode[] = [
      ...this.groupA.pans, ...this.groupB.pans, this.groupA.level, this.groupB.level,
      this.gSub, this.gNoise, this.noiseFilt, this.fmGain, this.xmodGain,
      this.mix, this.filter, this.fdPad, this.fdShaper, this.vca,
    ];
    if (this.groupC) others.push(...this.groupC.pans, this.groupC.level);
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
    // Non-white chip noise stays audible even when the Noise knob is low (if Chip module on).
    const chipOn = modOn("chip");
    const chipBed = (chipOn && p.chipNoise && p.chipNoise !== "white") ? 0.1 : 0;
    const noise = (!noiseOn || mute) ? 0 : Math.max(p.noiseLevel, chipBed * Math.min(1, 0.35 + p.noiseLevel));
    const oscAOn = modOn("osc.a");
    const oscBOn = modOn("osc.b");
    const oscCOn = modOn("osc.c");
    this.groupA.level.gain.setTargetAtTime((oscAOn ? p.oscALevel : 0) * this.uNorm * nMul, t, 0.02);
    this.groupB.level.gain.setTargetAtTime((oscBOn ? p.oscBLevel : 0) * this.uNorm * nMul, t, 0.02);
    if (this.groupC) this.groupC.level.gain.setTargetAtTime((oscCOn ? p.oscCLevel : 0) * this.uNorm * nMul, t, 0.02);
    this.gSub.gain.setTargetAtTime((subOn ? p.subLevel : 0) * nMul, t, 0.02);
    this.gNoise.gain.setTargetAtTime(noise, t, 0.02);
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
      return;
    }
    this.filter.type = p.filterType;
    this.filter.Q.setTargetAtTime(clamp(p.filterResonance, 0.0001, 30), t, 0.02);
    this.filter.frequency.setTargetAtTime(this.baseCutoff(p), t, 0.03);
  }

  /** Slow random per-voice detune wander (analog instability), in cents. */
  advanceDrift(amount: number, rate = 0.35): number {
    if (amount <= 0.001) return 0;
    const r = clamp(rate, 0.05, 1);
    if (Math.random() < 0.04 + r * 0.1) this.driftTarget = (Math.random() * 2 - 1) * amount * (22 + r * 28);
    this.driftCur += (this.driftTarget - this.driftCur) * (0.06 + r * 0.12);
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
    if (m.aReso) this.filter.Q.setTargetAtTime(clamp(p.filterResonance + m.reso * 18, 0.0001, 30), t, 0.03);
    if (m.aFm) this.fmGain.gain.setTargetAtTime(Math.max(0, (p.fmAmount + m.fm) * this.baseFreq * 6), t, 0.02);
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

export class FireCommandSynth {
  readonly output: GainNode;
  readonly lfo1: LfoBank;
  readonly lfo2: LfoBank;

  // bus
  private readonly voiceBus: GainNode;
  private readonly drivePre: GainNode;
  private readonly driveShaper: WaveShaperNode;
  private readonly drivePost: GainNode;
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
  private readonly chorusIn: GainNode;
  private readonly chorusDry: GainNode;
  private readonly chorusWet: GainNode;
  private readonly cDelayL: DelayNode;
  private readonly cDelayR: DelayNode;
  private readonly cLfoL: OscillatorNode;
  private readonly cLfoR: OscillatorNode;
  private readonly cDepthL: GainNode;
  private readonly cDepthR: GainNode;
  private readonly cPanL: StereoPannerNode;
  private readonly cPanR: StereoPannerNode;
  private readonly chorusOut: GainNode;
  private readonly phaserIn: GainNode;
  private readonly phaserAP: BiquadFilterNode[];
  private readonly phaserDry: GainNode;
  private readonly phaserWet: GainNode;
  private readonly phaserFb: GainNode;
  private readonly phaserOut: GainNode;
  private readonly phaserLfo: OscillatorNode;
  private readonly phaserDepth: GainNode;
  private readonly tremolo: GainNode;
  private readonly delayDry: GainNode;
  private readonly dL: DelayNode;
  private readonly dR: DelayNode;
  private readonly dFbLR: GainNode;
  private readonly dFbRL: GainNode;
  private readonly dPanL: StereoPannerNode;
  private readonly dPanR: StereoPannerNode;
  private readonly delayWet: GainNode;
  private readonly delayOut: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly punchComp: DynamicsCompressorNode;
  private readonly punchMakeup: GainNode;
  private readonly airLow: BiquadFilterNode;
  private readonly airHigh: BiquadFilterNode;
  private readonly reverbIn: GainNode;
  private readonly reverbPredelay: DelayNode;
  private readonly reverbConv: ConvolverNode;
  private readonly reverbDry: GainNode;
  private readonly reverbWet: GainNode;
  private readonly reverbOut: GainNode;
  // ── Spectral FX (v1.7) — dry branch is unity until the worklet engages ──
  private readonly spectralDry: GainNode;
  private readonly spectralSend: GainNode;
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
  private readonly widthSideAmt: GainNode;
  private readonly widthSideInv: GainNode;
  private readonly widthMerge: ChannelMergerNode;
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
  private readonly banks = new Map<string, PeriodicWave[]>();
  private readonly voices = new Set<Voice>();
  private readonly held = new Map<number, Voice>();
  private monoVoice: Voice | null = null;
  private patch: FirePatch;
  private maxVoices = 12;

  private modTimer: ReturnType<typeof setInterval> | null = null;
  private irTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIrKey = "";
  private lastPredelay = -1;
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
  private readonly mtxA = { reso: false, fm: false, lvlA: false, lvlB: false, lvlC: false };
  // Reusable per-voice modulation payload — mutated and handed to applyMatrix
  // each voice so the hot loop allocates nothing.
  private readonly mScratch = { pitch: 0, cutoff: 0, reso: 0, fm: 0, lvlA: 0, lvlB: 0, lvlC: 0, driftCents: 0, aReso: false, aFm: false, aLvl: false };
  displayPosA = 0;
  displayPosB = 0;
  displayPosC = 0;

  constructor(private readonly ctx: AudioContext, dest: AudioNode) {
    this.patch = { ...DEFAULT_FIRE_PATCH };
    this.filterDriveCurve = makeFilterDriveCurve(this.patch.filterDrive);

    // Pre-render every wavetable into a dense band-limited bank.
    for (const id of WAVETABLE_IDS) {
      const frames: PeriodicWave[] = [];
      for (let k = 0; k < SUBFRAMES; k++) {
        const { real, imag } = harmonicsAt(id, SUBFRAMES > 1 ? k / (SUBFRAMES - 1) : 0);
        frames.push(ctx.createPeriodicWave(real, imag, { disableNormalization: false }));
      }
      this.banks.set(id, frames);
    }

    this.output = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.drivePre = ctx.createGain();
    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = "2x";
    this.drivePost = ctx.createGain();
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
    this.airLow = ctx.createBiquadFilter();
    this.airLow.type = "lowshelf";
    this.airLow.frequency.value = 180;
    this.airLow.gain.value = 0;
    this.airHigh = ctx.createBiquadFilter();
    this.airHigh.type = "highshelf";
    this.airHigh.frequency.value = 6500;
    this.airHigh.gain.value = 0;
    this.reverbIn = ctx.createGain();
    this.reverbPredelay = ctx.createDelay(0.25);
    this.reverbPredelay.delayTime.value = 0;
    this.reverbConv = ctx.createConvolver();
    this.reverbDry = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;
    this.reverbOut = ctx.createGain();
    this.spectralDry = ctx.createGain();
    this.spectralSend = ctx.createGain();
    this.spectralSend.gain.value = 0;
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
    this.widthSideAmt = ctx.createGain();
    this.widthSideAmt.gain.value = 1;
    this.widthSideInv = ctx.createGain();
    this.widthSideInv.gain.value = -1;
    this.widthMerge = ctx.createChannelMerger(2);
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
    this.driveShaper.connect(this.drivePost);
    this.drivePost.connect(this.crushDry).connect(this.crushOut);
    this.drivePost.connect(this.crushShaper).connect(this.crushWet).connect(this.crushOut);
    // Vintage Age sits between crush and ring — dry wire when all params off.
    this.crushOut.connect(this.vintage.input);
    this.vintage.output.connect(this.ringDry).connect(this.ringOut);
    this.vintage.output.connect(this.ringWet).connect(this.ringOut);
    this.ringCarrier.connect(this.ringDepth).connect(this.ringWet.gain);
    this.ringDepth.gain.value = 1;
    this.ringOut.connect(this.chorusIn);
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
    this.dL.connect(this.dFbLR).connect(this.dR);
    this.dR.connect(this.dFbRL).connect(this.dL);
    this.delayWet.connect(this.delayOut);
    this.delayOut.connect(this.tone);
    this.tone.connect(this.punchComp).connect(this.punchMakeup).connect(this.airLow).connect(this.airHigh).connect(this.reverbIn);
    this.reverbIn.connect(this.reverbDry).connect(this.reverbOut);
    this.reverbIn.connect(this.reverbPredelay).connect(this.reverbConv).connect(this.reverbWet).connect(this.reverbOut);
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
    this.widthSideL.connect(this.widthSideAmt);
    this.widthSideR.connect(this.widthSideAmt);         // S × width
    this.widthMid.connect(this.widthMerge, 0, 0);
    this.widthMid.connect(this.widthMerge, 0, 1);
    this.widthSideAmt.connect(this.widthMerge, 0, 0);   // L' = M + wS
    this.widthSideAmt.connect(this.widthSideInv);
    this.widthSideInv.connect(this.widthMerge, 0, 1);   // R' = M − wS
    this.widthMerge.connect(this.master);
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

    this.startModTimer();
  }

  private startModTimer(): void {
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
    const unison = Math.round(clamp(p.unison, 1, MAX_UNISON));
    const groups = 2 + (p.oscCLevel > 0.0001 ? 1 : 0); // A and B always exist
    return unison * groups + 3; // + sub + noise + FM operator
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
    const OSC_BUDGET = 108;
    const byBudget = Math.floor(OSC_BUDGET / this.voiceSourceCost(p));
    const chipCap = Math.round(p.chipVoiceLimit ?? 0);
    const cap = chipCap > 0 ? Math.min(this.maxVoices, chipCap) : this.maxVoices;
    // 4-op FM is heavier — steal sooner.
    const fmPenalty = (p.fmEngine ?? "classic") === "ops4" ? 0.7 : 1;
    return clamp(Math.min(cap, Math.floor(byBudget * fmPenalty)), 2, 48);
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
    if (mode === "periodic") {
      // Metallic short loop — harsh digital tone noise.
      const len = 48;
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (((i * 7) & 15) / 7.5 - 1) * 0.95;
      return buf;
    }
    // Hold / Soft: long buffer with stepped LFSR bits (4-bit / softer hold).
    const len = Math.floor(sr * 1.5);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let reg = 1;
    const hold = mode === "nes" ? 10 : 5;
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
    const len = Math.max(1, Math.floor(sr * size));
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      const lpCoef = 0.12 + damp * 0.78;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const decay = Math.pow(1 - t, 1.55 + damp * 1.55);
        const noise = Math.random() * 2 - 1;
        lp = lp * lpCoef + noise * (1 - lpCoef);
        // Sparse early reflections → denser body with diffusion.
        const earlyWin = i < sr * 0.09;
        const early = earlyWin && Math.random() < (0.015 + diff * 0.09)
          ? (Math.random() * 2 - 1) * (1 - i / (sr * 0.09))
          : 0;
        const dense = lp * (0.28 + diff * 0.72);
        d[i] = (dense + early * (1.1 - diff * 0.55)) * decay * (ch === 0 ? 1 : 0.92 + Math.random() * 0.16);
      }
    }
    this.reverbConv.buffer = ir;
    this.lastIrKey = `${size.toFixed(2)}|${damp.toFixed(2)}|${diff.toFixed(2)}`;
  }

  private bankFor(id: string): PeriodicWave[] {
    return this.activeBankFor(id);
  }

  private baseBankFor(id: string): PeriodicWave[] {
    return this.banks.get(id) ?? this.banks.get("saw")!;
  }

  // ── Spectral warps (v1.7) ──
  // Base banks stay cached forever; a non-zero warp lazily renders a WARPED
  // bank per in-use table (32 createPeriodicWave calls each), invalidated
  // whenever the warp signature changes. Knob drags are debounced (~80 ms)
  // so scrubbing doesn't re-render 96 waves per mousemove.
  private readonly warpedBanks = new Map<string, PeriodicWave[]>();
  private warpedSig = "";
  private warpTimer: ReturnType<typeof setTimeout> | null = null;

  private hasWarp(p: FirePatch): boolean {
    if (p.moduleEnable?.["fire.sec.warp"] === false) return false;
    return Math.abs(p.warpStretch ?? 0) > 0.001
      || Math.abs(p.warpTilt ?? 0) > 0.001
      || (p.warpComb ?? 0) > 0.001;
  }

  private activeBankFor(id: string): PeriodicWave[] {
    const p = this.patch;
    if (!this.hasWarp(p)) return this.baseBankFor(id);
    const sig = `${p.warpStretch}|${p.warpTilt}|${p.warpComb}`;
    if (sig !== this.warpedSig) {
      this.warpedBanks.clear();
      this.warpedSig = sig;
    }
    const key = this.banks.has(id) ? id : "saw";
    let bank = this.warpedBanks.get(key);
    if (!bank) {
      bank = [];
      for (let k = 0; k < SUBFRAMES; k++) {
        const f = SUBFRAMES > 1 ? k / (SUBFRAMES - 1) : 0;
        const { real, imag } = harmonicsAt(key, f);
        const warped = applyWarp(imag, p.warpStretch, p.warpTilt, p.warpComb);
        bank.push(this.ctx.createPeriodicWave(real, warped, { disableNormalization: false }));
      }
      this.warpedBanks.set(key, bank);
    }
    return bank;
  }

  /** Swap all live voices onto the (possibly warped) banks for the current patch. */
  private applyWarpBanks(): void {
    for (const v of this.voices) {
      v.setBankA(this.activeBankFor(this.patch.oscATable));
      v.setBankB(this.activeBankFor(this.patch.oscBTable));
      v.setBankC(this.activeBankFor(this.patch.oscCTable));
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
        case "pan": case "volume": case "delay": hasGlobal = true; break;
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
    switch (src) {
      case "lfo1": return lfo1;
      case "lfo2": return lfo2;
      case "random": return this.mtxRandVal;
      case "macro1": return macrosOn ? this.patch.macro1 : 0;
      case "macro2": return macrosOn ? this.patch.macro2 : 0;
      case "macro3": return macrosOn ? this.patch.macro3 : 0;
      case "macro4": return macrosOn ? this.patch.macro4 : 0;
      case "modenv": return v ? me : 0;
      case "velocity": return v ? v.velocity : 0;
      case "keytrack": return v ? clamp((v.midi - 60) / 36, -1, 1) : 0;
      default: return 0;
    }
  }

  /** Frames since the last voice ended — lets the mod loop idle out. */
  private idleFrames = 0;

  // ── control-rate modulation updater (matrix + morph + gate + drift) ──
  private updateMod = (): void => {
    // Idle gate: sleep the 60 Hz timer after ~5 s with no voices (tails need
    // a few seconds). noteOn / playNote / setPatch restart it.
    if (this.voices.size === 0) {
      if (++this.idleFrames > 300) {
        this.stopModTimer();
        return;
      }
    } else {
      this.idleFrames = 0;
    }

    const now = this.ctx.currentTime;
    const p = this.patch;

    if (p.lfo1Wave === "sample-hold") {
      const step = Math.floor(now * clamp(p.lfo1Rate, 0.01, 40));
      if (step !== this.sh1Step) { this.sh1Step = step; this.sh1Val = Math.random() * 2 - 1; this.lfo1.sh.offset.setValueAtTime(this.sh1Val, now); }
    }
    if (p.lfo2Wave === "sample-hold") {
      const step = Math.floor(now * clamp(p.lfo2Rate, 0.01, 40));
      if (step !== this.sh2Step) { this.sh2Step = step; this.sh2Val = Math.random() * 2 - 1; this.lfo2.sh.offset.setValueAtTime(this.sh2Val, now); }
    }
    // Matrix random source — a stepped sample/hold independent of the LFOs.
    const rstep = Math.floor(now * 6);
    if (rstep !== this.mtxRandStep) { this.mtxRandStep = rstep; this.mtxRandVal = Math.random() * 2 - 1; }

    const lfo1 = this.jsLfoValue(p.lfo1Wave, p.lfo1Rate, this.sh1Val, now);
    const lfo2 = this.jsLfoValue(p.lfo2Wave, p.lfo2Rate, this.sh2Val, now);
    const routes = this.mtxRoutes;
    const matrixOn = p.moduleEnable?.["matrix"] !== false;

    // ── global (bus) destinations ──
    let gPan = false, gVol = false, gRev = false, gDly = false;
    if (matrixOn && this.mtxHasGlobal) {
      let accPan = 0, accVol = 0, accRev = 0, accDly = 0;
      for (let i = 0; i < routes.length; i++) {
        const r = routes[i];
        switch (r.dest) {
          case "pan": accPan += r.amount * this.modSource(r.source, lfo1, lfo2, 0, null); gPan = true; break;
          case "volume": accVol += r.amount * this.modSource(r.source, lfo1, lfo2, 0, null); gVol = true; break;
          case "reverb": accRev += r.amount * this.modSource(r.source, lfo1, lfo2, 0, null); gRev = true; break;
          case "delay": accDly += r.amount * this.modSource(r.source, lfo1, lfo2, 0, null); gDly = true; break;
        }
      }
      if (gPan) this.autopan.pan.setTargetAtTime(clamp(accPan, -1, 1), now, 0.02);
      if (gVol) this.master.gain.setTargetAtTime(clamp(p.masterGain * (1 + accVol), 0, 1.4), now, 0.02);
      if (gRev) this.reverbWet.gain.setTargetAtTime(clamp(p.reverbMix + accRev, 0, 1), now, 0.03);
      if (gDly) this.delayWet.gain.setTargetAtTime(clamp(p.delayMix + accDly, 0, 1), now, 0.03);
    }
    // Restore the bus base value exactly once when a global route is removed.
    if (!gPan && this.gPanWas) this.autopan.pan.setTargetAtTime(0, now, 0.05);
    if (!gVol && this.gVolWas) this.master.gain.setTargetAtTime(clamp(p.masterGain, 0, 1.4), now, 0.05);
    if (!gRev && this.gRevWas) this.reverbWet.gain.setTargetAtTime(clamp(p.reverbMix, 0, 1), now, 0.05);
    if (!gDly && this.gDlyWas) this.delayWet.gain.setTargetAtTime(clamp(p.delayMix, 0, 1), now, 0.05);
    this.gPanWas = gPan; this.gVolWas = gVol; this.gRevWas = gRev; this.gDlyWas = gDly;

    // ── trance gate ── (only touch the param when the target actually moves)
    let gateTarget = 1;
    if (p.gateOn && p.moduleEnable?.["gate"] !== false) {
      const steps = Math.max(1, Math.min(16, Math.round(p.gateSteps)));
      const idx = Math.floor(now * clamp(p.gateRate, 0.25, 24)) % steps;
      gateTarget = (p.gatePattern[idx] ?? 1) > 0.5 ? 1 : clamp(1 - p.gateDepth, 0, 1);
    }
    if (gateTarget !== this.lastGateTarget) {
      // gateSmooth stretches the edge time-constant: 4 ms (legacy chop) up to
      // ~60 ms (sidechain-style pump).
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
            const c = r.amount * this.modSource(r.source, lfo1, lfo2, me, v);
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
        const posA = dutyMorph(
          p.oscATable,
          clamp(p.oscAPos + envMod * p.oscAEnv + lfoMod * p.oscALfo + matrixWA + vec + syncTilt, 0, 1),
        );
        const posB = dutyMorph(
          p.oscBTable,
          clamp(p.oscBPos + envMod * p.oscBEnv + lfoMod * p.oscBLfo + matrixWB - vec, 0, 1),
        );
        v.setWtA(posA);
        v.setWtB(posB);
        dispA = posA;
        dispB = posB;
        if (v.hasGroupC()) {
          const posC = dutyMorph(
            p.oscCTable,
            clamp(p.oscCPos + envMod * p.oscCEnv + lfoMod * p.oscCLfo + matrixWC, 0, 1),
          );
          v.setWtC(posC);
          dispC = posC;
        }
        if (pvActive) {
          const lifeAmt = lifeOn
            ? Math.max(p.drift, (p.voiceInstability ?? 0) * 0.55, (p.tuneVariance ?? 0) * 0.25)
            : 0;
          m.driftCents = lifeOn
            ? ((lifeAmt > 0 ? v.advanceDrift(lifeAmt, p.driftRate ?? 0.35) : 0)
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

  private modEnvValue(v: Voice, now: number): number {
    const p = this.patch;
    const a = Math.max(0.001, p.modAttack);
    const d = Math.max(0.001, p.modDecay);
    const s = clamp(p.modSustain, 0, 1);
    // releaseAt may be scheduled in the future (sequencer) — until it arrives
    // the voice is still in its AD(S) phase.
    if (v.releaseAt == null || now < v.releaseAt) {
      return FireCommandSynth.adLevel(now - v.startedAt, a, d, s);
    }
    const r = Math.max(0.001, p.modRelease);
    const lvl = FireCommandSynth.adLevel(v.releaseAt - v.startedAt, a, d, s);
    return clamp(lvl * (1 - (now - v.releaseAt) / r), 0, 1);
  }

  getMorphPositions(): { a: number; b: number; c: number } {
    return { a: this.displayPosA, b: this.displayPosB, c: this.displayPosC };
  }

  /** Current trance-gate step for the UI playhead (-1 when the gate is off). */
  getGateStep(): number {
    const p = this.patch;
    if (!p.gateOn) return -1;
    const steps = Math.max(1, Math.min(16, Math.round(p.gateSteps)));
    return Math.floor(this.ctx.currentTime * clamp(p.gateRate, 0.25, 24)) % steps;
  }

  /** Live LFO value (-1..1) for UI scopes — same math the mod loop uses. */
  getLfoValue(idx: 1 | 2): number {
    const p = this.patch;
    const now = this.ctx.currentTime;
    return idx === 1
      ? this.jsLfoValue(p.lfo1Wave, p.lfo1Rate, this.sh1Val, now)
      : this.jsLfoValue(p.lfo2Wave, p.lfo2Rate, this.sh2Val, now);
  }

  // ── notes ──
  /** `when` (ctx clock) enables sample-accurate sequencing; omit for live play. */
  noteOn(midi: number, velocity = 0.9, when?: number): void {
    this.startModTimer();
    const p = this.patch;
    const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
    if (p.mono) {
      const v = this.monoVoice;
      if (v && !v.releasing) {
        v.midi = midi;
        v.applyTuning(p, t, false);
        v.applyFm(p);
        v.triggerEnvelopes(p, velocity, t);
        this.held.set(midi, v);
        return;
      }
    }
    const cap = this.effectiveMaxVoices(p);
    while (this.voices.size >= cap) this.stealOldest();
    const voice = new Voice(
      this, this.ctx, this.voiceBus, this.noiseBufferFor(p.chipNoise),
      this.bankFor(p.oscATable), this.bankFor(p.oscBTable), this.bankFor(p.oscCTable), p, midi, velocity, when,
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
    this.startModTimer();
    const p = this.patch;
    const cap = this.effectiveMaxVoices(p);
    while (this.voices.size >= cap) this.stealOldest();
    const voice = new Voice(
      this, this.ctx, this.voiceBus, this.noiseBufferFor(p.chipNoise),
      this.bankFor(p.oscATable), this.bankFor(p.oscBTable), this.bankFor(p.oscCTable),
      p, midi, velocity, when,
    );
    this.voices.add(voice);
    this.updatePolyGain();
    voice.noteOff(p, when + Math.max(0.02, duration));
  }

  allNotesOff(): void {
    this.held.clear();
    this.monoVoice = null;
    // CLICK SOURCE (read as "crackle/distortion"): this used to forceStop()
    // every voice, hard-cutting live audio mid-sample — preset switches and
    // sequencer stops landed with an audible pop burst. fastRelease() is a
    // 6 ms fade with the actual stop deferred 40 ms, which is inaudible.
    for (const v of [...this.voices]) v.fastRelease();
  }

  onVoiceEnded(v: Voice): void {
    this.voices.delete(v);
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
   * The knee is 4 (was 6): with the sequencer running, chords of 3-4 one-shot
   * voices routinely overlap their releases, so compensation has to start
   * engaging where real material actually lives. The 60 ms time-constant
   * keeps the gain change click-free as voices come and go.
   */
  private updatePolyGain(): void {
    const n = this.voices.size;
    const knee = 4;
    const g = VOICE_HEADROOM * (n <= knee ? 1 : Math.sqrt(knee / n));
    this.voiceBus.gain.setTargetAtTime(g, this.ctx.currentTime, 0.06);
  }

  private stealOldest(): void {
    // Prefer voices already audibly fading out (least noticeable theft), else
    // the oldest sounding voice. A sequencer one-shot pre-schedules its
    // release, so check against the clock — not just the `releasing` flag —
    // or long piano-roll notes would be first in line for theft.
    const now = this.ctx.currentTime;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (!(v.releasing && (v.releaseAt === null || v.releaseAt <= now))) continue;
      if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
    }
    if (!oldest) for (const v of this.voices) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
    if (oldest) oldest.fastRelease();
    // fastRelease schedules removal; nudge the set so the while-loop can exit
    // even before the timer fires by removing it from held tracking.
    if (oldest) {
      for (const [k, vv] of this.held) if (vv === oldest) this.held.delete(k);
      this.voices.delete(oldest);
    }
  }

  // ── patch ──
  setPatch(p: FirePatch): void {
    this.startModTimer();
    // Merge over the defaults so patches persisted before newer fields were
    // added (fmBtoA, noiseColor, filterDrive, stereoWidth, velAmount…) load
    // with legacy-exact behavior instead of undefined params.
    this.patch = { ...DEFAULT_FIRE_PATCH, ...p };
    this.filterDriveCurve = makeFilterDriveCurve(this.patch.filterDrive);
    this.recomputeMatrix();
    this.applyBusParams(this.patch);
    this.applyLfoParams(this.patch);
    this.applySpectral(this.patch);
    for (const v of this.voices) {
      v.setBankA(this.bankFor(this.patch.oscATable));
      v.setBankB(this.bankFor(this.patch.oscBTable));
      v.setBankC(this.bankFor(this.patch.oscCTable));
      v.setSubWave(this.patch.subWave);
      v.setOscLevels(this.patch);
      v.setFilterLive(this.patch);
      v.setFilterDriveCurve(this.filterDriveCurve);
      v.applyFm(this.patch);
      v.applyUnisonSpread(this.patch);
      v.clearMod();
    }
  }

  set<K extends keyof FirePatch>(key: K, value: FirePatch[K]): void {
    this.patch = { ...this.patch, [key]: value };
    const p = this.patch;
    switch (key) {
      case "masterGain": case "drive": case "driveMode": case "crush": case "punch":
      case "ringAmount": case "ringFreq":
      case "phaserRate": case "phaserDepth": case "phaserMix":
      case "chorusRate": case "chorusDepth": case "chorusMix":
      case "delayTime": case "delayFeedback": case "delayMix": case "tone":
      case "reverbSize": case "reverbMix": case "reverbDamp": case "reverbPredelay": case "reverbDiffusion":
      case "stereoWidth": case "airLow": case "airHigh": case "airAmount": case "punch":
      case "cassetteGen": case "tapeSpeed": case "wowFlutter": case "vhsColor":
      case "bitDepth": case "sampleRateReduce": case "bbdChorus": case "analogComp":
      case "dust": case "hiss": case "hum": case "printThrough":
      case "pathOsc": case "pathFilter": case "pathDrive": case "pathAge":
      case "pathFx": case "pathMix": case "pathScope": case "moduleEnable":
        this.applyBusParams(p); break;
      case "lfo1Wave": case "lfo1Rate": case "lfo1Depth": case "lfo1Dest":
      case "lfo2Wave": case "lfo2Rate": case "lfo2Depth": case "lfo2Dest":
        this.applyLfoParams(p); break;
      case "oscATable":
        for (const v of this.voices) v.setBankA(this.bankFor(p.oscATable)); break;
      case "oscBTable":
        for (const v of this.voices) v.setBankB(this.bankFor(p.oscBTable)); break;
      case "oscCTable":
        for (const v of this.voices) v.setBankC(this.bankFor(p.oscCTable)); break;
      case "spectralMode": case "spectralAmount": case "spectralMix":
        this.applySpectral(p); break;
      case "warpStretch": case "warpTilt": case "warpComb":
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
      case "noiseColor":
        for (const v of this.voices) v.setOscLevels(p); break;
      case "oscAOctave": case "oscBOctave": case "oscCOctave": case "subOctave":
        for (const v of this.voices) v.applyTuning(p, this.ctx.currentTime, false); break;
      case "oscADetune": case "oscBDetune": case "oscCDetune": case "unisonDetune": case "unisonWidth":
        for (const v of this.voices) v.applyUnisonSpread(p); break;
      case "fmAmount": case "fmRatio": case "fmBtoA":
      case "fmEngine": case "fmAlg": case "fmFeedback":
      case "fmOp1Level": case "fmOp2Level": case "fmOp3Level": case "fmOp4Level":
      case "fmOp2Ratio": case "fmOp3Ratio": case "fmOp4Ratio":
      case "hardSync":
        for (const v of this.voices) v.applyFm(p); break;
      case "filterType": case "filterCutoff": case "filterResonance":
      case "filterEnvAmount": case "filterKeyTrack":
        for (const v of this.voices) v.setFilterLive(p); break;
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

    this.master.gain.setTargetAtTime(pathMix ? clamp(p.masterGain, 0, 1.2) : 0, t, 0.02);

    const driveAmt = pathDrive ? p.drive : 0;
    const crushAmt = pathDrive ? clamp(p.crush, 0, 1) : 0;
    this.driveShaper.curve = makeDriveCurve(driveAmt, p.driveMode);
    this.drivePre.gain.setTargetAtTime((1 + driveAmt * 1.2) / DRIVE_RANGE, t, 0.02);
    this.drivePost.gain.setTargetAtTime(1 / (1 + driveAmt * 0.7), t, 0.02);
    this.crushShaper.curve = makeCrushCurve(16 - crushAmt * 13);
    this.crushDry.gain.setTargetAtTime(1 - crushAmt, t, 0.02);
    this.crushWet.gain.setTargetAtTime(crushAmt, t, 0.02);

    // Vintage Age bus — force neutral when path Age or module is off.
    this.vintage.apply(pathAge ? {
      cassetteGen: p.cassetteGen ?? 0,
      tapeSpeed: p.tapeSpeed ?? 0,
      wowFlutter: p.wowFlutter ?? 0,
      vhsColor: p.vhsColor ?? 0,
      bitDepth: p.bitDepth ?? "off",
      sampleRateReduce: p.sampleRateReduce ?? 0,
      bbdChorus: p.bbdChorus ?? 0,
      analogComp: p.analogComp ?? 0,
      dust: p.dust ?? 0,
      hiss: p.hiss ?? 0,
      hum: p.hum ?? 0,
      printThrough: p.printThrough ?? 0,
    } : {
      cassetteGen: 0, tapeSpeed: 0, wowFlutter: 0, vhsColor: 0, bitDepth: "off",
      sampleRateReduce: 0, bbdChorus: 0, analogComp: 0, dust: 0, hiss: 0, hum: 0, printThrough: 0,
    });

    // Glue module owns bus compress (punch knob). Age analogComp still layers lightly.
    const glueAmt = on("glue") ? clamp(p.punch, 0, 1) : 0;
    const ac = pathAge ? clamp(p.analogComp ?? 0, 0, 1) : 0;
    const glue = clamp(glueAmt + ac * 0.55, 0, 1);
    this.punchComp.threshold.setTargetAtTime(-glue * 30, t, 0.05);
    this.punchComp.ratio.setTargetAtTime(1 + glue * 7, t, 0.05);
    this.punchMakeup.gain.setTargetAtTime(1 + glue * 0.3, t, 0.05);

    const phaserOn = pathFx && on("fx.phaser");
    const phMix = phaserOn ? clamp(p.phaserMix, 0, 1) : 0;
    const phDepth = clamp(p.phaserDepth, 0, 1);
    this.phaserLfo.frequency.setTargetAtTime(clamp(p.phaserRate, 0.02, 12), t, 0.02);
    this.phaserDepth.gain.setTargetAtTime(560 * phDepth, t, 0.02);
    this.phaserDry.gain.setTargetAtTime(1, t, 0.02);
    this.phaserWet.gain.setTargetAtTime(phMix, t, 0.02);
    this.phaserFb.gain.setTargetAtTime(phMix * 0.55, t, 0.02);

    // Ring lives under FM · Ring module.
    const ringOn = on("fm");
    const ring = ringOn ? clamp(p.ringAmount, 0, 1) : 0;
    this.ringDry.gain.setTargetAtTime(1 - ring, t, 0.02);
    this.ringDepth.gain.setTargetAtTime(ring, t, 0.02);
    this.ringCarrier.frequency.setTargetAtTime(clamp(p.ringFreq, 1, 8000), t, 0.02);

    const chorusOn = pathFx && on("fx.chorus");
    const chMix = chorusOn ? clamp(p.chorusMix, 0, 1) : 0;
    this.chorusDry.gain.setTargetAtTime(1 - chMix * 0.5, t, 0.02);
    this.chorusWet.gain.setTargetAtTime(chMix, t, 0.02);
    this.cLfoL.frequency.setTargetAtTime(clamp(p.chorusRate, 0.05, 8), t, 0.02);
    this.cLfoR.frequency.setTargetAtTime(clamp(p.chorusRate, 0.05, 8) * 1.18, t, 0.02);
    this.cDepthL.gain.setTargetAtTime(p.chorusDepth * 0.006, t, 0.02);
    this.cDepthR.gain.setTargetAtTime(p.chorusDepth * 0.006, t, 0.02);

    this.dL.delayTime.setTargetAtTime(clamp(p.delayTime, 0.001, 2), t, 0.02);
    this.dR.delayTime.setTargetAtTime(clamp(p.delayTime, 0.001, 2) * 1.5, t, 0.02);
    const fb = clamp(p.delayFeedback, 0, 0.92);
    this.dFbLR.gain.setTargetAtTime(fb, t, 0.02);
    this.dFbRL.gain.setTargetAtTime(fb, t, 0.02);
    const delayOn = pathFx && on("fx.delay");
    this.delayWet.gain.setTargetAtTime(delayOn ? clamp(p.delayMix, 0, 1) : 0, t, 0.02);
    this.tone.frequency.setTargetAtTime(clamp(p.tone, 200, 20000), t, 0.02);

    const reverbOn = pathFx && on("fx.reverb");
    const revMix = reverbOn ? clamp(p.reverbMix, 0, 1) : 0;
    this.reverbDry.gain.setTargetAtTime(1 - revMix * 0.4, t, 0.04);
    this.reverbWet.gain.setTargetAtTime(revMix, t, 0.04);
    const pre = clamp(p.reverbPredelay ?? 0, 0, 0.2);
    if (Math.abs(pre - this.lastPredelay) > 0.0005) {
      this.reverbPredelay.delayTime.setTargetAtTime(pre, t, 0.03);
      this.lastPredelay = pre;
    }

    const widthOn = on("width");
    this.widthSideAmt.gain.setTargetAtTime(widthOn ? clamp(p.stereoWidth ?? 1, 0, 1.4) : 1, t, 0.03);

    const airOn = on("air");
    const airAmt = airOn ? clamp(p.airAmount ?? 0, 0, 1) : 0;
    this.airLow.gain.setTargetAtTime(clamp(p.airLow ?? 0, -1, 1) * 12 * airAmt, t, 0.04);
    this.airHigh.gain.setTargetAtTime(clamp(p.airHigh ?? 0, -1, 1) * 10 * airAmt, t, 0.04);

    this.updateReverbConvolver(p, pathFx && reverbOn);

    for (const v of this.voices) {
      v.setOscLevels(p);
      v.setFilterLive(p);
      v.applyFm(p);
      v.applyUnisonSpread(p);
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
  private applySpectral(p: FirePatch): void {
    const mode = p.spectralMode ?? "off";
    const mix = clamp(p.spectralMix ?? 0, 0, 1);
    const active = mode !== "off" && mix > 0.001;
    if (active && this.spectralState === "idle") {
      this.spectralState = "loading";
      void loadSpectralModule(this.ctx).then((ok) => {
        if (!ok) { this.spectralState = "failed"; return; }
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
          return;
        }
        this.spectralSend.connect(this.spectralNode).connect(this.autopan);
        this.spectralState = "ready";
        // Re-run against the CURRENT patch — it may have changed (or turned
        // the effect back off) while addModule was in flight.
        this.applySpectral(this.patch);
      });
    }
    const t = this.ctx.currentTime;
    const on = active && this.spectralState === "ready" && this.spectralNode !== null;
    this.spectralDry.gain.setTargetAtTime(on ? 0 : 1, t, 0.03);
    this.spectralSend.gain.setTargetAtTime(on ? 1 : 0, t, 0.03);
    this.spectralNode?.port.postMessage({
      mode,
      amount: clamp(p.spectralAmount ?? 0.6, 0, 1),
      mix,
      bypass: !on,
    });
  }

  private applyLfoParams(p: FirePatch): void {
    const d1 = p.moduleEnable?.["lfo.1"] === false ? 0 : p.lfo1Depth;
    const d2 = p.moduleEnable?.["lfo.2"] === false ? 0 : p.lfo2Depth;
    this.applyOneLfo(this.lfo1, p.lfo1Wave, p.lfo1Rate, d1, p.lfo1Dest);
    this.applyOneLfo(this.lfo2, p.lfo2Wave, p.lfo2Rate, d2, p.lfo2Dest);
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
}

export const DEFAULT_FIRE_PATCH: FirePatch = {
  // Neutral Init — one oscillator, no FX wet, no unison stack.
  // Presets that want color must set it explicitly (via P(overrides)).
  oscATable: "basic", oscAPos: 0.66, oscAEnv: 0, oscALfo: 0, oscAOctave: 0, oscADetune: 0, oscALevel: 0.75,
  oscBTable: "saw", oscBPos: 0.4, oscBEnv: 0, oscBLfo: 0, oscBOctave: 0, oscBDetune: 0, oscBLevel: 0,
  oscCTable: "harmonic", oscCPos: 0.4, oscCEnv: 0, oscCLfo: 0, oscCOctave: -1, oscCDetune: 0, oscCLevel: 0,
  warpStretch: 0, warpTilt: 0, warpComb: 0,
  unison: 1, unisonDetune: 0, unisonWidth: 0.5,
  subWave: "sine", subLevel: 0, noiseLevel: 0, noiseColor: 0,
  fmAmount: 0, fmRatio: 2, fmBtoA: 0, ringAmount: 0, ringFreq: 220,
  filterType: "lowpass", filterCutoff: 2600, filterResonance: 0.7, filterEnvAmount: 0.4, filterKeyTrack: 0.3,
  filterDrive: 0,
  ampAttack: 0.01, ampDecay: 0.25, ampSustain: 0.8, ampRelease: 0.35, velAmount: 1,
  lpgOn: false, lpgDecay: 0.4, lpgColor: 0.7,
  filtAttack: 0.01, filtDecay: 0.3, filtSustain: 0.5, filtRelease: 0.3,
  modAttack: 0.02, modDecay: 0.5, modSustain: 0.3, modRelease: 0.4,
  lfo1Wave: "sine", lfo1Rate: 5, lfo1Depth: 0, lfo1Dest: "off",
  lfo2Wave: "triangle", lfo2Rate: 0.5, lfo2Depth: 0, lfo2Dest: "off",
  pitchEnvAmount: 0, pitchEnvTime: 0.2,
  mono: false, glide: 0,
  harmonyMode: "off", harmonyLevel: 0.6,
  drive: 0, driveMode: "soft", crush: 0, tone: 15000, punch: 0,
  phaserRate: 0.4, phaserDepth: 0.6, phaserMix: 0,
  chorusRate: 0.6, chorusDepth: 0.4, chorusMix: 0,
  delayTime: 0.28, delayFeedback: 0.3, delayMix: 0,
  reverbSize: 2.2, reverbMix: 0, reverbDamp: 0.45, reverbPredelay: 0.02, reverbDiffusion: 0.7,
  spectralMode: "off", spectralAmount: 0.6, spectralMix: 0.5,
  macro1: 0, macro2: 0, macro3: 0, macro4: 0,
  modMatrix: makeModMatrix(),
  drift: 0,
  driftRate: 0.35,
  voiceInstability: 0,
  tuneVariance: 0,
  envVariance: 0,
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
  pathOsc: true,
  pathFilter: true,
  pathDrive: true,
  pathAge: true,
  pathFx: true,
  pathMix: true,
  pathScope: true,
  stereoWidth: 1,
  gateOn: false, gateRate: 8, gateDepth: 1, gateSteps: 16,
  gatePattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  gateSmooth: 0,
  masterGain: 0.72,
  subOctave: -1,
  airLow: 0,
  airHigh: 0,
  airAmount: 0,
  scaleLock: false,
  chordMemoryOn: false,
  chordIntervals: [0, 4, 7],
  humanizeOn: false,
  humanizeTiming: 0.25,
  humanizeVelocity: 0.2,
  moduleEnable: {},
};
