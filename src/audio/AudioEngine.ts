import { ParametricEQ } from "./dsp/ParametricEQ";
import { HarmonicEnhancer } from "./dsp/HarmonicEnhancer";
import { Saturator } from "./dsp/Saturator";
import { StereoWidener } from "./dsp/StereoWidener";
import { TransientShaper } from "./dsp/TransientShaper";
import { Reverb } from "./dsp/Reverb";
import { SpatialEnhancer } from "./dsp/SpatialEnhancer";
import { DeEsser } from "./dsp/DeEsser";
import { PerBandWidth } from "./dsp/PerBandWidth";
import { MultibandCompressor } from "./dsp/MultibandCompressor";
import { StereoBalance } from "./dsp/StereoBalance";
import { LoFiDeck } from "./dsp/LoFiDeck";
import { HRTFRooms, type RoomId } from "./dsp/HRTFRooms";
import { Spatializer3D } from "./dsp/Spatializer3D";
import { LUFSMeter } from "./dsp/LUFSMeter";
import { FeedbackKiller } from "./dsp/FeedbackKiller";
import { Reconstructor, type RestoreParams } from "./dsp/Reconstructor";
import { ClarityEngine } from "./dsp/ClarityEngine";
import { FireCommandSynth } from "./dsp/FireCommandSynth";
import { FireDrumKit, makeSafetyClipCurve, SAFETY_CLIP_RANGE } from "./dsp/FireDrumKit";
import type { ParametricBand, SoundParams } from "./types";
import { NEUTRAL_PARAMS } from "./types";
import { DEFAULT_CORRECTION_BANDS, DEFAULT_OUTPUT_GAIN_DB } from "./defaultCorrectionProfile";

/**
 * Maps friendly UI sliders to ParametricEQ bands.
 *
 * Layout: { freq, q, maxDb, type }. The actual gain is the slider value
 * multiplied by the per-band maximum, so a slider of ±1 maps to ±maxDb of
 * cut / boost.
 *
 * Ten bands spaced roughly evenly across the spectrum give plenty of fine
 * control without becoming a graphic-EQ-style chore.
 */
export type FriendlyKey =
  | "subBass" | "bass" | "warmth" | "body" | "mid"
  | "vocals" | "presence" | "clarity" | "air" | "sparkle";

export const FRIENDLY_TO_EQ: Record<
  FriendlyKey,
  { id: string; freq: number; q: number; maxDb: number; type: BiquadFilterType }
> = {
  subBass:  { id: "f-subbass",  freq: 40,    q: 0.7, maxDb: 6, type: "lowshelf" },
  bass:     { id: "f-bass",     freq: 90,    q: 0.9, maxDb: 5, type: "peaking" },
  warmth:   { id: "f-warmth",   freq: 180,   q: 1.0, maxDb: 4, type: "peaking" },
  body:     { id: "f-body",     freq: 350,   q: 1.2, maxDb: 4, type: "peaking" },
  mid:      { id: "f-mid",      freq: 700,   q: 1.0, maxDb: 4, type: "peaking" },
  vocals:   { id: "f-vocals",   freq: 1500,  q: 1.0, maxDb: 4, type: "peaking" },
  presence: { id: "f-presence", freq: 3000,  q: 1.1, maxDb: 5, type: "peaking" },
  clarity:  { id: "f-clarity",  freq: 5500,  q: 1.0, maxDb: 5, type: "peaking" },
  air:      { id: "f-air",      freq: 10000, q: 0.9, maxDb: 5, type: "peaking" },
  sparkle:  { id: "f-sparkle",  freq: 15000, q: 0.7, maxDb: 6, type: "highshelf" },
};

const FRIENDLY_KEYS = Object.keys(FRIENDLY_TO_EQ) as FriendlyKey[];

export const FRIENDLY_EQ_LAYOUT = FRIENDLY_TO_EQ;

export type EngineSource =
  | { kind: "file"; element: HTMLAudioElement }
  | { kind: "mic"; stream: MediaStream }
  | { kind: "none" };

/** Fire Command mixer parts (v1.6): Synth A/B, drum kit, sample deck. */
export type FireMixPart = "a" | "b" | "drums" | "samples";

export interface AnalyserSnapshot {
  freq: Uint8Array<ArrayBuffer>;
  time: Uint8Array<ArrayBuffer>;
  rms: number;
  peak: number;
}

type ByteBuf = { freq: Uint8Array<ArrayBuffer>; time: Uint8Array<ArrayBuffer> };

/**
 * AudioEngine — the single source of truth for the realtime DSP graph.
 *
 * Signal flow:
 *
 *   source → input → correctionEQ → friendlyEQ → harmonicEnhancer
 *          → saturator → transientShaper → glueComp → spatialEnhancer
 *          → stereoWidener → reverb → analyserA (post-fx)
 *          → outputGain → limiter → destination
 *
 *   sourceTap → analyserB (pre-fx) for A/B comparison
 */
export class AudioEngine {
  readonly ctx: AudioContext;

  private source: EngineSource = { kind: "none" };
  private srcNode: AudioNode | null = null;
  /**
   * A MediaElementAudioSourceNode can be created only ONCE per <audio>
   * element for the lifetime of the page. We cache it so switching to
   * Exterior Audio and back (which detaches the source) can re-wire the
   * SAME node instead of calling createMediaElementSource() again — the
   * second call throws InvalidStateError and silently kills file playback.
   */
  private elementSource: { el: HTMLMediaElement; node: MediaElementAudioSourceNode } | null = null;

  readonly inputBus: GainNode;
  readonly preTap: GainNode;
  /** Mutes the FX chain when bypass is on. */
  readonly fxInput: GainNode;
  /** Direct passthrough bus — active only while bypassed. */
  readonly bypassBus: GainNode;
  /** Mutes the processed path when bypass is on. */
  readonly postFxGain: GainNode;
  readonly feedbackKiller: FeedbackKiller;
  readonly correctionEQ: ParametricEQ;
  /** Restoration Bay — rebuilds damaged / low-bitrate audio (Sculptor). */
  readonly reconstruct: Reconstructor;
  /** Clarity Engine — one-knob "wipe the glass" (Sculptor). */
  readonly clarity: ClarityEngine;
  readonly friendlyEQ: ParametricEQ;
  /** User-built parametric EQ (1-20 bands) — the Sculptor's graphic EQ. */
  readonly userEQ: ParametricEQ;
  readonly harmonic: HarmonicEnhancer;
  readonly saturator: Saturator;
  readonly transient: TransientShaper;
  readonly glue: DynamicsCompressorNode;
  readonly deEsser: DeEsser;
  readonly multiband: MultibandCompressor;
  readonly perBandWidth: PerBandWidth;
  readonly spatial: SpatialEnhancer;
  readonly widener: StereoWidener;
  readonly lofiDeck: LoFiDeck;
  readonly reverb: Reverb;
  readonly rooms: HRTFRooms;
  /** 3rd Dimension — HRTF speaker/band spatializer (off unless engaged). */
  readonly dimension: Spatializer3D;
  readonly balance: StereoBalance;
  readonly outputGain: GainNode;
  readonly limiter: DynamicsCompressorNode;
  /** Master brick-wall AFTER outputGain — the true clip ceiling for EVERY
   *  path (bypass, FX, 3D, reference clips) and any volume boost / LUFS trim. */
  readonly finalLimiter: DynamicsCompressorNode;
  readonly destinationTap: GainNode;
  readonly lufs: LUFSMeter;

  /** Fire Command — playable sci-fi synth. Its output sums into `inputBus`
   *  so it runs through the full FX chain (and the bypass toggle) like any
   *  other source. */
  readonly fireCommand: FireCommandSynth;
  /** Second synth instrument (Synth B) — created lazily on first use so the
   *  extra wavetable bank costs nothing until a second voice is deployed. */
  private _fireCommandB: FireCommandSynth | null = null;
  /** Fire Command drum machine (fully synthesized, sequencer-scheduled). */
  readonly fireDrums: FireDrumKit;
  /** Clean synth+drums tap for the WAV export (post-clipper, pre-chain). */
  readonly fireTap: GainNode;
  /** Shared synth+drums summing bus → safety clipper → inputBus. */
  private readonly fireBus: GainNode;
  private readonly fireBusPad: GainNode;
  private readonly fireBusClip: WaveShaperNode;
  /** Per-part Fire mixer chains (v1.6): part gain → pan → (duck) → fireBus. */
  private readonly firePart: Record<FireMixPart, { gain: GainNode; pan: StereoPannerNode }>;
  /** Sidechain duck gain on the combined Synth A+B path (kick pump). */
  readonly fireDuck: GainNode;
  /** Fire master fader (pre-limiter). */
  private readonly fireMasterGain: GainNode;
  /** Fire master limiter — glue/safety on the summed Fire output. */
  private readonly fireLimiter: DynamicsCompressorNode;
  private fireLimiterEnabled = true;
  /** Master listen dim (−12 dB) multiplier applied on top of master fader. */
  private fireDimOn = false;
  /** Master mono-fold listen (true mid collapse after bus clip). */
  private fireMonoOn = false;
  private readonly fireMonoIn: GainNode;
  private readonly fireMonoSplit: ChannelSplitterNode;
  private readonly fireMonoMid: GainNode;
  private readonly fireMonoMerge: ChannelMergerNode;
  private readonly fireStereoPass: GainNode;
  /** Per-part input trim (pre-fader), linear 0..2 — applied in setFirePartMix. */
  private readonly firePartTrimGain: Record<FireMixPart, number>;
  private fireMasterLevel = 1;
  private fireMasterMuted = false;
  /** Duck envelope extras (attack/hold/HPF are host-side approximations). */
  private duckAttackSec = 0.005;
  private duckHoldSec = 0;
  private duckHpfHz = 0;

  readonly analyserPost: AnalyserNode;
  readonly analyserPre: AnalyserNode;

  /** 3rd Dimension routing: parallel taps + binaural return into the master. */
  private readonly dimReturn: GainNode;
  private readonly dimTapRaw: GainNode;
  private readonly dimTapEq: GainNode;
  private dimensionActive = false;
  private dimensionSignal: "eqd" | "raw" = "eqd";

  private bypass = true;
  private correctionEnabled = false;
  private params: SoundParams = { ...NEUTRAL_PARAMS };
  private friendlyBands: ParametricBand[] = [];
  private balanceLDb = 0;
  private balanceRDb = 0;
  private balanceDelayMs = 0;

  constructor() {
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: "interactive" });

    this.inputBus = this.ctx.createGain();
    this.preTap = this.ctx.createGain();
    this.fxInput = this.ctx.createGain();
    this.fxInput.gain.value = 0;
    this.bypassBus = this.ctx.createGain();
    this.bypassBus.gain.value = 1;
    this.postFxGain = this.ctx.createGain();
    this.postFxGain.gain.value = 0;
    this.feedbackKiller = new FeedbackKiller(this.ctx);

    this.correctionEQ = new ParametricEQ(this.ctx, DEFAULT_CORRECTION_BANDS);
    this.reconstruct = new Reconstructor(this.ctx);
    this.clarity = new ClarityEngine(this.ctx);
    this.friendlyBands = this.buildFriendlyBands(this.params);
    this.friendlyEQ = new ParametricEQ(this.ctx, this.friendlyBands);
    // User graphic EQ starts empty (transparent) — bands added from the UI.
    this.userEQ = new ParametricEQ(this.ctx, []);

    this.harmonic = new HarmonicEnhancer(this.ctx);
    this.saturator = new Saturator(this.ctx);
    this.transient = new TransientShaper(this.ctx);
    this.deEsser = new DeEsser(this.ctx);
    this.multiband = new MultibandCompressor(this.ctx);
    this.perBandWidth = new PerBandWidth(this.ctx);

    this.glue = this.ctx.createDynamicsCompressor();
    // Default: fully transparent. Compression "amount" param dials it up.
    this.glue.threshold.value = -10;
    this.glue.knee.value = 20;
    this.glue.ratio.value = 1.0;
    this.glue.attack.value = 0.012;
    this.glue.release.value = 0.18;

    this.spatial = new SpatialEnhancer(this.ctx);
    this.widener = new StereoWidener(this.ctx);
    this.lofiDeck = new LoFiDeck(this.ctx);
    this.reverb = new Reverb(this.ctx);
    this.rooms = new HRTFRooms(this.ctx);
    this.dimension = new Spatializer3D(this.ctx);
    this.dimReturn = this.ctx.createGain();
    this.dimReturn.gain.value = 0;
    this.dimTapRaw = this.ctx.createGain();
    this.dimTapRaw.gain.value = 0;
    this.dimTapEq = this.ctx.createGain();
    this.dimTapEq.gain.value = 0;
    this.balance = new StereoBalance(this.ctx);

    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = AudioEngine.dbToGain(DEFAULT_OUTPUT_GAIN_DB);

    this.lufs = new LUFSMeter(this.ctx);

    // Transparent brick-wall safety limiter. Threshold sits at -0.3 dBFS with
    // a hard knee, so loud modern masters (which routinely peak near 0 dBFS)
    // pass essentially untouched — only genuine overs get caught. The old
    // -1 dBFS setting was clamping the peaks of normal music, which read as
    // "compressed / washed out". This only ever sits in the FX path; the
    // clean-bypass path never touches the limiter at all.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -0.3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;

    // Master safety brick-wall — sits AFTER outputGain so it protects the
    // bypass path, the 3D return, reference clips and any volume boost / LUFS
    // trim (all of which skip the FX limiter above). The FX path is already
    // pre-tamed to -0.3 dBFS and the volume boost is capped at +12 dB, so a
    // -1 dBFS / 20:1 ceiling keeps the worst-case sum comfortably under 0 dBFS
    // while staying transparent for normal playback (only the hottest masters,
    // peaking above -1 dBFS, see a sub-1 dB peak tame — which also kills the
    // inter-sample overs that were causing the "random clipping").
    this.finalLimiter = this.ctx.createDynamicsCompressor();
    this.finalLimiter.threshold.value = -1.0;
    this.finalLimiter.knee.value = 0;
    this.finalLimiter.ratio.value = 20;
    this.finalLimiter.attack.value = 0.0008;
    this.finalLimiter.release.value = 0.06;

    this.destinationTap = this.ctx.createGain();

    this.analyserPost = this.ctx.createAnalyser();
    // Analysers are parallel taps only — never in the audible path. 2048 is
    // plenty for meters/visuals and much cheaper than 4096 at 60 Hz.
    this.analyserPost.fftSize = 2048;
    this.analyserPost.smoothingTimeConstant = 0.65;

    this.analyserPre = this.ctx.createAnalyser();
    this.analyserPre.fftSize = 1024;
    this.analyserPre.smoothingTimeConstant = 0.75;

    // Fire Command gain staging: synth and drums sum on a private fireBus,
    // pass one knee-style safety clipper (unity below ±0.7, hard 0.98
    // ceiling), then feed the same inputBus as files/mic — inheriting the
    // downstream chain (EQ, FX, 3D, limiter) and the bypass toggle.
    //
    // WORST CASE: the synth's own soft clip bounds it at 0.98 and the drum
    // kit's clipper bounds it at 0.98, so their sum can still hit 1.96 —
    // and BOTH engine "limiters" are DynamicsCompressors (1 ms / 0.8 ms
    // attack, ratio 20): they tame sustained level but pass short transients
    // essentially unclamped, and the clean-bypass path has no limiter before
    // outputGain (0 dB default) at all. That +5.8 dBFS over-range reached
    // the DAC as genuine hard clipping. The bus clipper makes the combined
    // Fire Command contribution ≤ 0.98 (-0.18 dBFS) by construction: solo
    // synth OR solo drums at normal level sit in the identity region
    // (bit-exact), and only simultaneous full-scale pile-ups get rounded.
    this.fireBus = this.ctx.createGain();
    // Fixed headroom for A+B+drums+samples summing. Each part can already
    // peak near 0.98 from its own soft-clipper; unity sum was ~+6 dBFS into
    // the Fire limiter and read as constant clipping on the sequencer.
    this.fireBus.gain.value = 0.58;
    this.fireBusPad = this.ctx.createGain();
    this.fireBusPad.gain.value = 1 / SAFETY_CLIP_RANGE;
    this.fireBusClip = this.ctx.createWaveShaper();
    this.fireBusClip.curve = makeSafetyClipCurve();
    this.fireBusClip.oversample = "2x";
    // v1.6 mixer: fireBus → master fader → master limiter → pad → clipper.
    // Softer threshold + knee: WaveShaper is the hard ceiling; the compressor
    // only glues — a -3 dB brick-wall was pumping every chord+drums hit.
    this.fireMasterGain = this.ctx.createGain();
    this.fireLimiter = this.ctx.createDynamicsCompressor();
    this.fireLimiter.threshold.value = -1.2;
    this.fireLimiter.knee.value = 8;
    this.fireLimiter.ratio.value = 8;
    this.fireLimiter.attack.value = 0.003;
    this.fireLimiter.release.value = 0.12;
    this.fireBus.connect(this.fireMasterGain);
    this.fireMasterGain.connect(this.fireLimiter);
    this.fireLimiter.connect(this.fireBusPad);
    this.fireBusPad.connect(this.fireBusClip);
    // Post-clip: stereo pass OR mono-fold → inputBus; fireTap always post-clip.
    this.fireStereoPass = this.ctx.createGain();
    this.fireMonoIn = this.ctx.createGain();
    this.fireMonoSplit = this.ctx.createChannelSplitter(2);
    this.fireMonoMid = this.ctx.createGain();
    this.fireMonoMid.gain.value = 0.5;
    this.fireMonoMerge = this.ctx.createChannelMerger(2);
    this.fireBusClip.connect(this.fireStereoPass);
    this.fireStereoPass.connect(this.inputBus);
    this.fireBusClip.connect(this.fireMonoIn);
    this.fireMonoIn.gain.value = 0;
    this.fireMonoIn.connect(this.fireMonoSplit);
    this.fireMonoSplit.connect(this.fireMonoMid, 0);
    this.fireMonoSplit.connect(this.fireMonoMid, 1);
    this.fireMonoMid.connect(this.fireMonoMerge, 0, 0);
    this.fireMonoMid.connect(this.fireMonoMerge, 0, 1);
    this.fireMonoMerge.connect(this.inputBus);
    // Clean tap of the summed synth+drums (post-clipper, pre-chain) — the
    // Fire Command WAV export records from here.
    this.fireTap = this.ctx.createGain();
    this.fireBusClip.connect(this.fireTap);

    // Per-part strips: gain → pan; synths pass the shared sidechain duck.
    const mkPart = () => {
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      gain.connect(pan);
      return { gain, pan };
    };
    this.firePart = { a: mkPart(), b: mkPart(), drums: mkPart(), samples: mkPart() };
    this.firePartTrimGain = { a: 1, b: 1, drums: 1, samples: 1 };
    // Sidechain ducks Synth A only — bass/808s on Synth B stay solid.
    this.fireDuck = this.ctx.createGain();
    this.firePart.a.pan.connect(this.fireDuck);
    this.fireDuck.connect(this.fireBus);
    this.firePart.b.pan.connect(this.fireBus);
    this.firePart.drums.pan.connect(this.fireBus);
    this.firePart.samples.pan.connect(this.fireBus);

    this.fireCommand = new FireCommandSynth(this.ctx, this.firePart.a.gain);
    // Fire Command drum machine — lanes on the drum strip, the sample deck
    // one-shots on their own strip.
    this.fireDrums = new FireDrumKit(this.ctx, this.firePart.drums.gain, this.firePart.samples.gain);

    this.connectGraph();
  }

  /**
   * Second Fire Command synth instrument ("Synth B", issue #11) — its own
   * patch, oscillators and FX bus, summed onto the same fireBus (so it shares
   * the safety clipper + downstream chain with Synth A and the drums).
   */
  get fireCommandB(): FireCommandSynth {
    if (!this._fireCommandB) {
      this._fireCommandB = new FireCommandSynth(this.ctx, this.firePart.b.gain);
    }
    return this._fireCommandB;
  }

  /** Synth B if it has been created, without instantiating it. */
  peekFireCommandB(): FireCommandSynth | null {
    return this._fireCommandB;
  }

  // ────────── Fire Command mixer (v1.6) ──────────

  /** Set one part strip: level (0..1.5), pan (-1..1), effective mute. Trim is pre-fader. */
  setFirePartMix(part: FireMixPart, level: number, pan: number, muted: boolean): void {
    const p = this.firePart[part];
    const t = this.ctx.currentTime;
    const trim = this.firePartTrimGain[part] ?? 1;
    const g = muted ? 0 : Math.max(0, Math.min(1.5, level)) * Math.max(0, Math.min(2, trim));
    p.gain.gain.setTargetAtTime(g, t, 0.02);
    p.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.02);
  }

  /** Per-part input trim (0..2, 1 = unity). Re-apply via setFirePartMix. */
  setFirePartTrim(part: FireMixPart, trim: number): void {
    this.firePartTrimGain[part] = Math.max(0, Math.min(2, trim));
  }

  /** Fire master fader (pre-limiter). Dim applies −12 dB listen cut. */
  setFireMasterMix(level: number, muted: boolean): void {
    this.fireMasterLevel = level;
    this.fireMasterMuted = muted;
    const dim = this.fireDimOn ? 0.25 : 1;
    this.fireMasterGain.gain.setTargetAtTime(
      muted ? 0 : Math.max(0, Math.min(1.5, level)) * dim,
      this.ctx.currentTime,
      0.02,
    );
  }

  setFireDim(on: boolean): void {
    this.fireDimOn = on;
    this.setFireMasterMix(this.fireMasterLevel, this.fireMasterMuted);
  }

  setFireMono(on: boolean): void {
    this.fireMonoOn = on;
    const t = this.ctx.currentTime;
    this.fireStereoPass.gain.setTargetAtTime(on ? 0 : 1, t, 0.02);
    this.fireMonoIn.gain.setTargetAtTime(on ? 1 : 0, t, 0.02);
  }

  /** Toggle the Fire master limiter (the safety clipper always stays). */
  setFireLimiterEnabled(on: boolean): void {
    if (on === this.fireLimiterEnabled) return;
    this.fireLimiterEnabled = on;
    try { this.fireMasterGain.disconnect(); } catch { /* ignore */ }
    if (on) this.fireMasterGain.connect(this.fireLimiter);
    else this.fireMasterGain.connect(this.fireBusPad);
  }

  /** Live gain reduction in dB (≤ 0). 0 when limiter bypassed. */
  getFireLimiterReduction(): number {
    if (!this.fireLimiterEnabled) return 0;
    return this.fireLimiter.reduction;
  }

  isFireLimiterEnabled(): boolean {
    return this.fireLimiterEnabled;
  }

  /**
   * Sidechain duck (v1.6+): dip Synth A to `1 - amount` at `when` and ramp
   * back to unity over `releaseSec`. Optional attack/hold shape the envelope.
   */
  fireDuckTrigger(when: number, amount: number, releaseSec: number): void {
    const g = this.fireDuck.gain;
    const t = Math.max(this.ctx.currentTime, when);
    const dip = Math.max(0.02, 1 - Math.max(0, Math.min(1, amount)));
    const atk = Math.max(0.001, this.duckAttackSec);
    const hold = Math.max(0, this.duckHoldSec);
    const gg = g as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
    if (typeof gg.cancelAndHoldAtTime === "function") gg.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(dip, t + atk);
    g.setValueAtTime(dip, t + atk + hold);
    g.linearRampToValueAtTime(1, t + atk + hold + Math.max(0.02, releaseSec));
  }

  setDuckEnvelope(opts: { attackSec?: number; holdSec?: number; hpfHz?: number }): void {
    if (typeof opts.attackSec === "number") this.duckAttackSec = Math.max(0.001, Math.min(0.2, opts.attackSec));
    if (typeof opts.holdSec === "number") this.duckHoldSec = Math.max(0, Math.min(0.4, opts.holdSec));
    if (typeof opts.hpfHz === "number") this.duckHpfHz = Math.max(0, Math.min(500, opts.hpfHz));
  }

  /** Post-pan tap point for one Fire part (stems export). */
  getFirePartTap(part: FireMixPart): AudioNode {
    return this.firePart[part].pan;
  }

  // ────────── connection topology ──────────
  private connectGraph(): void {
    // inputBus → feedbackKiller (bypass when off) → preTap → rest of chain
    // The FeedbackKiller passes audio through transparently when inactive
    // and engages vibrato + adaptive notches + auto-ducker when on.
    this.inputBus.connect(this.feedbackKiller.input);
    this.feedbackKiller.output.connect(this.preTap);

    // Static portion of the graph (FX chain → output).
    // Order chosen so corrective/cleanup happens early (restoration,
    // de-esser, multiband comp), creative shaping in the middle (transient,
    // glue, spatial), and stereo / room placement at the end. Per-band width
    // sits before the final stereo balance so the user can sculpt mono-safe
    // lows + wide highs and still have an even L/R balance trim available.
    // Repair → clean → sculpt: Restoration Bay feeds the Clarity Engine,
    // which feeds the friendly EQ. The bay's input is wired per-mode in
    // connectFrontChain.
    this.reconstruct.output.connect(this.clarity.input);
    this.clarity.output.connect(this.friendlyEQ.input);
    this.friendlyEQ.output.connect(this.userEQ.input);
    this.userEQ.output.connect(this.deEsser.input);
    this.deEsser.output.connect(this.harmonic.input);
    this.harmonic.output.connect(this.saturator.input);
    this.saturator.output.connect(this.transient.input);
    this.transient.output.connect(this.multiband.input);
    this.multiband.output.connect(this.glue);
    this.glue.connect(this.spatial.input);
    this.spatial.output.connect(this.perBandWidth.input);
    this.perBandWidth.output.connect(this.widener.input);
    this.widener.output.connect(this.lofiDeck.input);
    this.lofiDeck.output.connect(this.reverb.input);
    this.reverb.output.connect(this.rooms.input);
    this.rooms.output.connect(this.balance.input);
    this.balance.output.connect(this.limiter);
    this.limiter.connect(this.postFxGain);
    this.postFxGain.connect(this.outputGain);
    this.bypassBus.connect(this.outputGain);
    // Master brick-wall is the LAST node before the tap so meters + the
    // hardware see the same clip-safe signal.
    this.outputGain.connect(this.finalLimiter);
    this.finalLimiter.connect(this.destinationTap);
    this.destinationTap.connect(this.ctx.destination);

    // Parallel analysis taps — never in the audible signal path.
    this.preTap.connect(this.analyserPre);
    this.destinationTap.connect(this.analyserPost);

    // Passthrough bus + FX entry (routing details in rewireFront).
    this.preTap.connect(this.bypassBus);

    // 3rd Dimension: parallel taps (raw source + post-EQ) into the
    // spatializer, and its binaural return into the master output. All three
    // gains sit at 0 until 3D mode is engaged (see rewireFront), so the
    // spatializer is silent and the normal path is untouched when off.
    this.preTap.connect(this.dimTapRaw);
    this.glue.connect(this.dimTapEq);
    this.dimTapRaw.connect(this.dimension.input);
    this.dimTapEq.connect(this.dimension.input);
    this.dimension.output.connect(this.dimReturn);
    this.dimReturn.connect(this.outputGain);

    // LUFS meter taps off the destinationTap; started lazily when needed.
    this.destinationTap.connect(this.lufs.input);

    this.rewireFront();
  }

  // ────────── source management ──────────
  attachAudioElement(el: HTMLAudioElement): void {
    // IDEMPOTENT: if this exact element is already the source, do nothing.
    // The Web Audio spec forbids calling createMediaElementSource() on the
    // same <audio> element more than once - it throws InvalidStateError.
    // If we naively re-attached, detachSource() would disconnect the
    // working source first, the second createMediaElementSource() would
    // throw, the catch would swallow it, and the graph would be silently
    // broken with the element's samples being pulled by an orphan node.
    // That manifests as "play() resolves but no sound and the timeline
    // never advances."
    if (
      this.source.kind === "file" &&
      this.source.element === el &&
      this.srcNode
    ) {
      console.log("[engine] attachAudioElement: already attached, no-op");
      return;
    }

    // REUSE the cached MediaElementSourceNode for this element. This is what
    // makes Exterior Audio → back-to-files work: the source was created once,
    // detached when loopback engaged, and is now simply re-wired. Calling
    // createMediaElementSource() a second time would throw.
    if (this.elementSource && this.elementSource.el === el) {
      console.log("[engine] attachAudioElement: re-wiring cached source");
      this.detachSource();
      try {
        this.elementSource.node.connect(this.inputBus);
      } catch { /* already connected */ }
      this.srcNode = this.elementSource.node;
      this.source = { kind: "file", element: el };
      return;
    }

    console.log("[engine] attachAudioElement: connecting MediaElementSource");
    this.detachSource();
    // Deliberately do NOT set el.crossOrigin. Setting it to "anonymous"
    // forces strict CORS enforcement on the audio source, and file:// /
    // custom-protocol URLs without explicit CORS headers then make
    // createMediaElementSource() produce SILENT samples (cross-origin
    // tainted MediaElementSource emits zeros). Tracks are loaded via the
    // `playground-audio://` scheme registered in electron/main.ts, which
    // returns proper `Access-Control-Allow-Origin: *` headers and a
    // same-origin treatment, so leaving crossOrigin unset is the right
    // thing for both production (Electron) and dev (Vite).
    const node = this.ctx.createMediaElementSource(el);
    this.elementSource = { el, node };
    node.connect(this.inputBus);
    this.srcNode = node;
    this.source = { kind: "file", element: el };
  }

  attachMicStream(stream: MediaStream): void {
    this.detachSource();
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.inputBus);
    this.srcNode = node;
    this.source = { kind: "mic", stream };
  }

  /**
   * Play an offline AudioBuffer through the engine (additive to any current
   * source). Returns a stop function. Used for reference clips and the
   * hearing-test tone sweep.
   */
  playBuffer(
    buffer: AudioBuffer,
    opts?: { loop?: boolean; gainDb?: number; pan?: -1 | 0 | 1 },
  ): () => void {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = !!opts?.loop;
    const gain = this.ctx.createGain();
    gain.gain.value = AudioEngine.dbToGain(opts?.gainDb ?? 0);
    node.connect(gain);
    if (opts?.pan !== undefined && opts.pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = opts.pan;
      gain.connect(panner).connect(this.inputBus);
    } else {
      gain.connect(this.inputBus);
    }
    void this.resume();
    node.start();
    return () => {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* ignore */ }
      try { gain.disconnect(); } catch { /* ignore */ }
    };
  }

  detachSource(): void {
    if (this.srcNode) {
      try {
        this.srcNode.disconnect();
      } catch {
        /* ignore */
      }
      this.srcNode = null;
    }
    this.source = { kind: "none" };
  }

  // ────────── control ──────────
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === "running") await this.ctx.suspend();
  }

  setBypass(bypass: boolean): void {
    if (bypass === this.bypass) return;
    this.bypass = bypass;
    this.rewireFront();
  }

  isBypassed(): boolean {
    return this.bypass;
  }

  /**
   * Toggle the playback-correction layer independent of the user-facing
   * DSP. Useful for A/B-ing "raw" vs the active output profile without
   * touching the playground controls.
   */
  setCorrectionEnabled(enabled: boolean): void {
    if (enabled === this.correctionEnabled) return;
    this.correctionEnabled = enabled;
    this.rewireFront();
  }

  isCorrectionEnabled(): boolean {
    return this.correctionEnabled;
  }

  private connectFrontChain(): void {
    this.preTap.connect(this.fxInput);
    if (this.correctionEnabled) {
      this.fxInput.connect(this.correctionEQ.input);
      this.correctionEQ.output.connect(this.reconstruct.input);
    } else {
      this.fxInput.connect(this.reconstruct.input);
    }
  }

  private rewireFront(): void {
    try {
      this.fxInput.disconnect();
    } catch { /* ignore */ }
    try {
      this.correctionEQ.output.disconnect();
    } catch { /* ignore */ }

    const t = this.ctx.currentTime;

    if (this.dimensionActive) {
      // 3rd Dimension replaces the normal output: the binaural return is the
      // only thing reaching the master while the standard tail is muted.
      this.bypassBus.gain.setTargetAtTime(0, t, 0.02);
      this.postFxGain.gain.setTargetAtTime(0, t, 0.02);
      this.dimReturn.gain.setTargetAtTime(1, t, 0.03);
      if (this.dimensionSignal === "eqd") {
        // Run the EQ/tone/dynamics front so the post-`glue` tap carries the
        // sculpted sound; the muted tail downstream is harmless.
        this.fxInput.gain.setTargetAtTime(1, t, 0.02);
        this.connectFrontChain();
        this.dimTapEq.gain.setTargetAtTime(1, t, 0.02);
        this.dimTapRaw.gain.setTargetAtTime(0, t, 0.02);
      } else {
        // Spatialize the raw source straight off preTap.
        this.fxInput.gain.setTargetAtTime(0, t, 0.02);
        this.dimTapEq.gain.setTargetAtTime(0, t, 0.02);
        this.dimTapRaw.gain.setTargetAtTime(1, t, 0.02);
      }
      return;
    }

    // Not in 3D mode — keep the spatializer fully silent.
    this.dimReturn.gain.setTargetAtTime(0, t, 0.02);
    this.dimTapEq.gain.setTargetAtTime(0, t, 0.02);
    this.dimTapRaw.gain.setTargetAtTime(0, t, 0.02);

    if (this.bypass) {
      // Bit-transparent passthrough — identical to the source (WMP parity).
      // Signal: preTap → bypassBus → outputGain → destination. No EQ, no
      // limiter, no FX nodes in the audible path.
      this.bypassBus.gain.setTargetAtTime(1, t, 0.01);
      this.fxInput.gain.setTargetAtTime(0, t, 0.01);
      this.postFxGain.gain.setTargetAtTime(0, t, 0.01);
      return;
    }

    this.bypassBus.gain.setTargetAtTime(0, t, 0.01);
    this.fxInput.gain.setTargetAtTime(1, t, 0.01);
    this.postFxGain.gain.setTargetAtTime(1, t, 0.01);
    this.connectFrontChain();
  }

  // ────────── 3rd Dimension ──────────
  /** Engage/disengage the 3D spatializer as the master output. */
  setDimensionActive(on: boolean): void {
    if (on === this.dimensionActive) return;
    this.dimensionActive = on;
    this.rewireFront();
  }

  isDimensionActive(): boolean {
    return this.dimensionActive;
  }

  /** Choose whether 3D spatializes the EQ'd sound or the raw track. */
  setDimensionSignal(signal: "eqd" | "raw"): void {
    if (signal === this.dimensionSignal) return;
    this.dimensionSignal = signal;
    if (this.dimensionActive) this.rewireFront();
  }

  getDimensionSignal(): "eqd" | "raw" {
    return this.dimensionSignal;
  }

  /** Reference count so the LUFS CPU meter only runs while someone reads it
   *  (Scope / Pro Tools / normalize). It used to start on first use and then
   *  tick a 100 ms FFT-sized loop forever. */
  private lufsConsumers = 0;

  /** Start the LUFS CPU meter on demand. Pair with releaseLufsMeter(). */
  ensureLufsMeter(): void {
    this.lufsConsumers++;
    this.lufs.start();
  }

  releaseLufsMeter(): void {
    this.lufsConsumers = Math.max(0, this.lufsConsumers - 1);
    if (this.lufsConsumers === 0) this.lufs.stop();
  }

  setOutputGainDb(db: number): void {
    const g = AudioEngine.dbToGain(Math.max(-24, Math.min(6, db)));
    this.outputGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  /**
   * Route the engine's destination to a specific audio output device. Empty
   * string = system default. Uses `AudioContext.setSinkId()` (Chromium 110+).
   *
   * Critical for Exterior-Audio flow on Windows: if the app outputs to the
   * same physical device it captures from, the processed output is captured
   * again and creates a feedback loop. Setting a separate sink breaks it.
   */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const ctx = this.ctx as AudioContext & {
      setSinkId?: (id: string | { type: "none" }) => Promise<void>;
      sinkId?: string;
    };
    if (typeof ctx.setSinkId !== "function") {
      console.warn("[engine] AudioContext.setSinkId not available in this Chromium build");
      return false;
    }
    try {
      await ctx.setSinkId(deviceId || "");
      console.log(`[engine] output sink set to "${deviceId || "default"}"`);
      return true;
    } catch (err) {
      console.warn("[engine] setSinkId failed:", err);
      return false;
    }
  }

  /** Current sinkId reported by the AudioContext, "" = default. */
  getOutputDevice(): string {
    const ctx = this.ctx as AudioContext & { sinkId?: string };
    return ctx.sinkId ?? "";
  }

  /**
   * Engage the multi-layer feedback killer at the front of the chain.
   * Should be set to `true` whenever Exterior-Audio (system loopback) is
   * active. Adds a sub-audible vibrato, an adaptive notch bank, and an
   * auto-ducker to prevent runaway feedback on single-device setups.
   *
   * Also tightens the master limiter from -3 dBFS to -10 dBFS so any
   * brief runaway can't blow eardrums while the notch + ducker react.
   */
  setFeedbackKillerActive(on: boolean): void {
    this.feedbackKiller.setActive(on);
    const t = this.ctx.currentTime;
    if (on) {
      this.limiter.threshold.setTargetAtTime(-10, t, 0.05);
      this.limiter.ratio.setTargetAtTime(20, t, 0.05);
      this.limiter.attack.setTargetAtTime(0.0005, t, 0.05);
      this.limiter.release.setTargetAtTime(0.06, t, 0.05);
    } else {
      // Restore the transparent brick-wall safety limiter.
      this.limiter.threshold.setTargetAtTime(-0.3, t, 0.05);
      this.limiter.ratio.setTargetAtTime(20, t, 0.05);
      this.limiter.attack.setTargetAtTime(0.001, t, 0.05);
      this.limiter.release.setTargetAtTime(0.05, t, 0.05);
    }
  }

  isFeedbackKillerActive(): boolean {
    return this.feedbackKiller.isActive();
  }

  // ────────── live level meters for diagnostics ──────────
  private inputMeterBuf: Uint8Array<ArrayBuffer> | null = null;
  private outputMeterBuf: Uint8Array<ArrayBuffer> | null = null;

  /** RMS (0..1) of the pre-FX signal — i.e. what's coming in from the source. */
  getInputRms(): number {
    if (!this.inputMeterBuf) {
      this.inputMeterBuf = new Uint8Array(this.analyserPre.fftSize) as Uint8Array<ArrayBuffer>;
    }
    this.analyserPre.getByteTimeDomainData(this.inputMeterBuf);
    let sumSq = 0;
    const N = this.inputMeterBuf.length;
    for (let i = 0; i < N; i++) {
      const v = (this.inputMeterBuf[i] - 128) / 128;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / N);
  }

  /** RMS (0..1) of the post-FX signal — i.e. what we're sending to the output. */
  getOutputRms(): number {
    if (!this.outputMeterBuf) {
      this.outputMeterBuf = new Uint8Array(this.analyserPost.fftSize) as Uint8Array<ArrayBuffer>;
    }
    this.analyserPost.getByteTimeDomainData(this.outputMeterBuf);
    let sumSq = 0;
    const N = this.outputMeterBuf.length;
    for (let i = 0; i < N; i++) {
      const v = (this.outputMeterBuf[i] - 128) / 128;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / N);
  }

  /**
   * Update the friendly-slider DSP layer from a {@link SoundParams} object.
   * Cheap to call from drag handlers — only the affected nodes get touched.
   */
  applyParams(next: Partial<SoundParams>): void {
    const merged: SoundParams = { ...this.params, ...next };
    this.params = merged;

    // Update friendly EQ bands.
    for (const key of FRIENDLY_KEYS) {
      const meta = FRIENDLY_TO_EQ[key];
      const band: ParametricBand = {
        id: meta.id,
        freq: meta.freq,
        q: meta.q,
        type: meta.type,
        gain: merged[key] * meta.maxDb,
      };
      this.friendlyEQ.updateBand(band);
    }

    // Effects. Unipolar amounts (clamped inside each module).
    this.harmonic.setAmount(merged.harmonics);
    this.saturator.setAmount(merged.saturation);
    this.spatial.setAmount(merged.spatial);
    this.lofiDeck.setAge(merged.lofiAge);
    this.lofiDeck.setWear(merged.lofiWear);
    this.lofiDeck.setWowFlutter(merged.lofiWowFlutter);
    this.reverb.setAmount(merged.reverbAmount);
    this.reverb.setSize(merged.reverbSize);

    // Bipolar amounts.
    this.transient.setAttack(merged.punch);
    this.transient.setSustain(merged.texture);
    this.widener.setWidth(merged.width);

    // Glue compression depth — unipolar (0 = transparent ratio of 1:1).
    const glue = Math.max(0, Math.min(1, merged.compression));
    const threshold = -8 - glue * 14;
    const ratio = 1 + glue * 2.5;
    const t = this.ctx.currentTime;
    this.glue.threshold.setTargetAtTime(threshold, t, 0.05);
    this.glue.ratio.setTargetAtTime(ratio, t, 0.05);

    // Pro tools.
    this.deEsser.setAmount(merged.deEss);
    this.perBandWidth.setLowWidth(merged.subWidth);
    this.perBandWidth.setMidWidth(merged.presenceWidth);
    this.perBandWidth.setHighWidth(merged.airWidth);
    this.multiband.setDepth("low", merged.mbCompLow);
    this.multiband.setDepth("mid", merged.mbCompMid);
    this.multiband.setDepth("high", merged.mbCompHigh);
  }

  /**
   * L/R balance trim (dB each ear) + interaural delay (ms, can be
   * negative). Not part of SoundParams - persisted via settingsStore so
   * it doesn't pollute creative presets.
   */
  setBalance(leftDb: number, rightDb: number, delayMs: number): void {
    this.balanceLDb = leftDb;
    this.balanceRDb = rightDb;
    this.balanceDelayMs = delayMs;
    this.balance.setBalanceDb(leftDb, rightDb);
    this.balance.setDelayMs(delayMs);
  }

  getBalance(): { leftDb: number; rightDb: number; delayMs: number } {
    return {
      leftDb: this.balanceLDb,
      rightDb: this.balanceRDb,
      delayMs: this.balanceDelayMs,
    };
  }

  /**
   * Activate one of the procedurally-generated room impulses, and dial in
   * its wet/dry mix. mix = 0 leaves the dry signal untouched.
   */
  setRoom(room: RoomId, mix: number): void {
    this.rooms.setRoom(room);
    this.rooms.setMix(mix);
  }

  replaceCorrectionBands(bands: ParametricBand[]): void {
    this.correctionEQ.rebuild(bands);
  }

  /** Restoration Bay controls (HF rebuild / body / de-crunch / hiss). */
  setRestore(params: Partial<RestoreParams>): void {
    this.reconstruct.setParams(params);
  }

  getRestore(): RestoreParams {
    return this.reconstruct.getParams();
  }

  /** Clarity Engine amount (0 = transparent wire). */
  setClarity(amount: number): void {
    this.clarity.setAmount(amount);
  }

  /**
   * v2.1 repair-stack A/B — true-bypass the whole repair stack (Restoration
   * Bay → Clarity → Sculptor EQ) in one click-safe crossfade, leaving the
   * rest of the chain (dynamics, width, rooms…) running. Store state is
   * untouched, so releasing the compare restores the exact same sound.
   */
  setRepairBypass(b: boolean): void {
    this.reconstruct.setBypassed(b);
    this.clarity.setBypassed(b);
    this.userEQ.setBypassed(b);
  }

  getClarity(): number {
    return this.clarity.getAmount();
  }

  /** Used by the EQ canvas — recomputes the magnitude curve. */
  computeFriendlyResponseDb(freqs: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    return this.friendlyEQ.computeResponse(freqs);
  }

  // ────────── user graphic EQ (1-20 bands) ──────────
  /** Rebuild the entire user EQ band stack (add/remove/enable/type changes). */
  setUserEQBands(bands: ParametricBand[]): void {
    this.userEQ.rebuild(bands);
  }

  /** Live-update a single user EQ band (freq/gain/Q drags). */
  updateUserEQBand(band: ParametricBand): void {
    this.userEQ.updateBand(band);
  }

  /** Magnitude curve for the user EQ — drives the graphic EQ display. */
  computeUserEQResponseDb(freqs: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    return this.userEQ.computeResponse(freqs);
  }

  // ────────── analysis ──────────
  readPost(buf: ByteBuf): AnalyserSnapshot {
    this.analyserPost.getByteFrequencyData(buf.freq);
    this.analyserPost.getByteTimeDomainData(buf.time);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buf.time.length; i++) {
      const v = (buf.time[i] - 128) / 128;
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    return {
      freq: buf.freq,
      time: buf.time,
      rms: Math.sqrt(sum / buf.time.length),
      peak,
    };
  }

  readPre(buf: ByteBuf): AnalyserSnapshot {
    this.analyserPre.getByteFrequencyData(buf.freq);
    this.analyserPre.getByteTimeDomainData(buf.time);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buf.time.length; i++) {
      const v = (buf.time[i] - 128) / 128;
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    return {
      freq: buf.freq,
      time: buf.time,
      rms: Math.sqrt(sum / buf.time.length),
      peak,
    };
  }

  // ────────── helpers ──────────
  private buildFriendlyBands(p: SoundParams): ParametricBand[] {
    return FRIENDLY_KEYS.map((k) => {
      const m = FRIENDLY_TO_EQ[k];
      return {
        id: m.id,
        freq: m.freq,
        q: m.q,
        type: m.type,
        gain: p[k] * m.maxDb,
        label: k,
      };
    });
  }

  static dbToGain(db: number): number {
    return Math.pow(10, db / 20);
  }

  static gainToDb(g: number): number {
    return 20 * Math.log10(Math.max(1e-6, g));
  }
}

let _engine: AudioEngine | null = null;

/**
 * Lazily create a single shared AudioEngine.
 * AudioContext creation must follow a user gesture, but we can prepare the
 * object early — actual playback uses {@link AudioEngine.resume}.
 */
export function getEngine(): AudioEngine {
  if (!_engine) _engine = new AudioEngine();
  return _engine;
}

/**
 * Return the live engine if it already exists, else null — WITHOUT creating
 * it. Lets passive readers (the resource monitor) sample audio stats without
 * spinning up an AudioContext before the user has interacted.
 */
export function peekEngine(): AudioEngine | null {
  return _engine;
}
