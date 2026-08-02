/**
 * FireVintageAge — Fire Command bus insert for cassette / tape / VHS / dust.
 *
 * CRITICAL: when every control is at its neutral (0 / "off"), this is a
 * bit-transparent dry wire — no extra latency or filtering on clean patches.
 *
 * Order inside the wet path:
 *   input → bitDepth → cassette → vhs → tapeSpeed/wow → BBD chorus → analogComp
 *         → (+ dust/hiss/hum/printThrough) → output
 */

export type FireBitDepth = "off" | "12bit" | "8bit";

export interface FireVintageAgeParams {
  cassetteGen: number;      // 0..1 — multi-generation cassette
  tapeSpeed: number;        // -1..1 — variable tape speed (pitch/rate feel)
  wowFlutter: number;       // 0..1
  vhsColor: number;         // 0..1
  bitDepth: FireBitDepth;
  sampleRateReduce: number; // 0..1 companion downsample
  bbdChorus: number;        // 0..1 wet
  analogComp: number;       // 0..1
  dust: number;             // 0..1
  hiss: number;             // 0..1
  hum: number;              // 0..1
  printThrough: number;     // 0..1 delayed ghost
}

const NEUTRAL: FireVintageAgeParams = {
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
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function makeCrushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const levels = Math.pow(2, Math.max(2, bits)) - 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

function makeSoftSat(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const a = 1 + amount * 4;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * a) / Math.tanh(a);
  }
  return curve;
}

function isActive(p: FireVintageAgeParams): boolean {
  return (
    p.cassetteGen > 0.001 ||
    Math.abs(p.tapeSpeed) > 0.001 ||
    p.wowFlutter > 0.001 ||
    p.vhsColor > 0.001 ||
    p.bitDepth !== "off" ||
    p.sampleRateReduce > 0.001 ||
    p.bbdChorus > 0.001 ||
    p.analogComp > 0.001 ||
    p.dust > 0.001 ||
    p.hiss > 0.001 ||
    p.hum > 0.001 ||
    p.printThrough > 0.001
  );
}

export class FireVintageAge {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly dry: GainNode;
  private readonly wetIn: GainNode;
  private readonly wetOut: GainNode;

  private readonly crush: WaveShaperNode;
  private readonly crushDry: GainNode;
  private readonly crushWet: GainNode;
  private readonly crushMerge: GainNode;

  private readonly casHpf: BiquadFilterNode;
  private readonly casLpf: BiquadFilterNode;
  private readonly casSat: WaveShaperNode;

  private readonly vhsPeak: BiquadFilterNode;
  private readonly vhsLpf: BiquadFilterNode;

  private tapeDelay: DelayNode;
  private readonly wowLfo: OscillatorNode;
  private readonly flutterLfo: OscillatorNode;
  private readonly wowGain: GainNode;
  private readonly flutterGain: GainNode;
  private readonly speedBase: ConstantSourceNode;

  private bbdDelayL: DelayNode;
  private bbdDelayR: DelayNode;
  private readonly bbdLfo: OscillatorNode;
  private readonly bbdDepth: GainNode;
  private readonly bbdDry: GainNode;
  private readonly bbdWet: GainNode;
  private readonly bbdLpf: BiquadFilterNode;
  private readonly bbdMerge: GainNode;
  private readonly bbdPanL: StereoPannerNode;
  private readonly bbdPanR: StereoPannerNode;

  private comp: DynamicsCompressorNode;
  private readonly compMakeup: GainNode;

  private readonly dustGain: GainNode;
  private readonly hissGain: GainNode;
  private readonly humOsc: OscillatorNode;
  private readonly humGain: GainNode;
  private readonly printDelay: DelayNode;
  private readonly printGain: GainNode;

  private noiseSrc: AudioBufferSourceNode | null = null;
  private active = false;
  /** Quantized crush depth — avoids rebuilding a 4 k curve on every param touch. */
  private lastCrushKey = -1;
  private params: FireVintageAgeParams = { ...NEUTRAL };

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wetIn = ctx.createGain();
    this.wetOut = ctx.createGain();

    this.crush = ctx.createWaveShaper();
    this.crush.curve = makeCrushCurve(12);
    this.crushDry = ctx.createGain();
    this.crushWet = ctx.createGain();
    this.crushMerge = ctx.createGain();
    this.crushDry.gain.value = 1;
    this.crushWet.gain.value = 0;

    this.casHpf = ctx.createBiquadFilter();
    this.casHpf.type = "highpass";
    this.casHpf.frequency.value = 20;
    this.casLpf = ctx.createBiquadFilter();
    this.casLpf.type = "lowpass";
    this.casLpf.frequency.value = 20000;
    this.casSat = ctx.createWaveShaper();
    this.casSat.curve = makeSoftSat(0.01);

    this.vhsPeak = ctx.createBiquadFilter();
    this.vhsPeak.type = "peaking";
    this.vhsPeak.frequency.value = 2200;
    this.vhsPeak.Q.value = 0.8;
    this.vhsPeak.gain.value = 0;
    this.vhsLpf = ctx.createBiquadFilter();
    this.vhsLpf.type = "lowpass";
    this.vhsLpf.frequency.value = 20000;

    this.tapeDelay = ctx.createDelay(0.08);
    this.tapeDelay.delayTime.value = 0.012;
    this.wowLfo = ctx.createOscillator();
    this.wowLfo.type = "sine";
    this.wowLfo.frequency.value = 0.45;
    this.flutterLfo = ctx.createOscillator();
    this.flutterLfo.type = "sine";
    this.flutterLfo.frequency.value = 5.5;
    this.wowGain = ctx.createGain();
    this.wowGain.gain.value = 0;
    this.flutterGain = ctx.createGain();
    this.flutterGain.gain.value = 0;
    this.speedBase = ctx.createConstantSource();
    this.speedBase.offset.value = 0.012;

    this.bbdDelayL = ctx.createDelay(0.05);
    this.bbdDelayR = ctx.createDelay(0.05);
    this.bbdDelayL.delayTime.value = 0.018;
    this.bbdDelayR.delayTime.value = 0.023;
    this.bbdLfo = ctx.createOscillator();
    this.bbdLfo.type = "sine";
    this.bbdLfo.frequency.value = 0.55;
    this.bbdDepth = ctx.createGain();
    this.bbdDepth.gain.value = 0;
    this.bbdDry = ctx.createGain();
    this.bbdWet = ctx.createGain();
    this.bbdDry.gain.value = 1;
    this.bbdWet.gain.value = 0;
    this.bbdLpf = ctx.createBiquadFilter();
    this.bbdLpf.type = "lowpass";
    this.bbdLpf.frequency.value = 4200;
    this.bbdMerge = ctx.createGain();
    this.bbdPanL = ctx.createStereoPanner();
    this.bbdPanR = ctx.createStereoPanner();
    this.bbdPanL.pan.value = -0.7;
    this.bbdPanR.pan.value = 0.7;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = 0;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 1;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.22;
    this.compMakeup = ctx.createGain();

    this.dustGain = ctx.createGain();
    this.dustGain.gain.value = 0;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = "sine";
    this.humOsc.frequency.value = 60;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.printDelay = ctx.createDelay(0.6);
    this.printDelay.delayTime.value = 0.28;
    this.printGain = ctx.createGain();
    this.printGain.gain.value = 0;

    // Wet chain
    this.wetIn
      .connect(this.crushDry).connect(this.crushMerge);
    this.wetIn
      .connect(this.crush).connect(this.crushWet).connect(this.crushMerge);
    this.crushMerge
      .connect(this.casHpf).connect(this.casLpf).connect(this.casSat)
      .connect(this.vhsPeak).connect(this.vhsLpf)
      .connect(this.tapeDelay);

    this.speedBase.connect(this.tapeDelay.delayTime);
    this.wowLfo.connect(this.wowGain).connect(this.tapeDelay.delayTime);
    this.flutterLfo.connect(this.flutterGain).connect(this.tapeDelay.delayTime);

    this.tapeDelay.connect(this.bbdDry).connect(this.bbdMerge);
    this.tapeDelay.connect(this.bbdLpf);
    this.bbdLpf.connect(this.bbdDelayL).connect(this.bbdPanL).connect(this.bbdWet);
    this.bbdLpf.connect(this.bbdDelayR).connect(this.bbdPanR).connect(this.bbdWet);
    this.bbdWet.connect(this.bbdMerge);
    this.bbdLfo.connect(this.bbdDepth);
    this.bbdDepth.connect(this.bbdDelayL.delayTime);
    this.bbdDepth.connect(this.bbdDelayR.delayTime);

    this.bbdMerge.connect(this.comp).connect(this.compMakeup).connect(this.wetOut);

    // Noise beds into wetOut
    this.dustGain.connect(this.wetOut);
    this.hissGain.connect(this.wetOut);
    this.humOsc.connect(this.humGain).connect(this.wetOut);
    // Print-through: delayed ghost from pre-comp tap (no feedback loop).
    this.bbdMerge.connect(this.printDelay).connect(this.printGain).connect(this.wetOut);

    this.wowLfo.start();
    this.flutterLfo.start();
    this.bbdLfo.start();
    this.speedBase.start();
    this.humOsc.start();

    // Neutral dry wire
    this.input.connect(this.dry).connect(this.output);
  }

  private ensureNoise(): void {
    if (this.noiseSrc) return;
    const sr = this.ctx.sampleRate;
    const len = sr * 2;
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        const dust = Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 4 : 0;
        d[i] = white * 0.08 + dust;
      }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Split to dust (dark) and hiss (bright)
    const dustFilt = this.ctx.createBiquadFilter();
    dustFilt.type = "lowpass";
    dustFilt.frequency.value = 900;
    const hissFilt = this.ctx.createBiquadFilter();
    hissFilt.type = "highpass";
    hissFilt.frequency.value = 3500;
    src.connect(dustFilt).connect(this.dustGain);
    src.connect(hissFilt).connect(this.hissGain);
    src.start();
    this.noiseSrc = src;
  }

  private setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this.dry.disconnect(); } catch { /* ignore */ }
    try { this.wetOut.disconnect(); } catch { /* ignore */ }
    if (on) {
      this.input.connect(this.wetIn);
      this.wetOut.connect(this.output);
      // Also keep a tiny dry bleed so full-wet BBD doesn't feel hollow — wetOut is full path
    } else {
      this.input.connect(this.dry).connect(this.output);
    }
  }

  /**
   * Hard-reset wet-path dynamics + noise beds. DynamicsCompressor envelopes
   * survive parameter writes — replace the node so an Age-heavy Natural
   * Selection offspring can't keep crushing later patches.
   */
  flush(): void {
    const t = this.ctx.currentTime;
    try {
      this.dustGain.gain.cancelScheduledValues(t);
      this.hissGain.gain.cancelScheduledValues(t);
      this.humGain.gain.cancelScheduledValues(t);
      this.printGain.gain.cancelScheduledValues(t);
      this.dustGain.gain.setValueAtTime(0, t);
      this.hissGain.gain.setValueAtTime(0, t);
      this.humGain.gain.setValueAtTime(0, t);
      this.printGain.gain.setValueAtTime(0, t);
      this.bbdWet.gain.cancelScheduledValues(t);
      this.bbdDry.gain.cancelScheduledValues(t);
      this.bbdWet.gain.setValueAtTime(0, t);
      this.bbdDry.gain.setValueAtTime(1, t);
    } catch { /* mid-teardown */ }
    this.rebuildComp();
  }

  private rebuildComp(): void {
    const old = this.comp;
    try { this.bbdMerge.disconnect(old); } catch { /* ignore */ }
    try { old.disconnect(); } catch { /* ignore */ }
    const next = this.ctx.createDynamicsCompressor();
    next.threshold.value = 0;
    next.knee.value = 12;
    next.ratio.value = 1;
    next.attack.value = 0.01;
    next.release.value = 0.22;
    this.comp = next;
    this.bbdMerge.connect(next).connect(this.compMakeup);
  }

  apply(p: Partial<FireVintageAgeParams>): void {
    this.params = { ...this.params, ...p };
    const t = this.ctx.currentTime;
    const a = this.params;
    const on = isActive(a);
    this.setActive(on);
    if (!on) {
      // Still neutralize wet-path state so the next age engagement doesn't
      // inherit a slammed compressor / hiss beds from a prior preset.
      this.flush();
      return;
    }

    // Bit depth + resolution. Downsampling used to be a no-op unless bitDepth
    // was already crushing; it now loses real bandwidth (band limit at the
    // target rate's Nyquist, folded into the cassette LPF below) and real
    // resolution, so the control does something on its own.
    const srr = clamp(a.sampleRateReduce, 0, 1);
    if (a.bitDepth === "off" && srr < 0.001) {
      this.crushDry.gain.setTargetAtTime(1, t, 0.02);
      this.crushWet.gain.setTargetAtTime(0, t, 0.02);
    } else {
      const bits = a.bitDepth === "8bit" ? 8 : a.bitDepth === "12bit" ? 12 : 14;
      const effective = Math.max(4, bits - srr * (bits === 8 ? 2 : 3));
      const crushKey = Math.round(effective * 4);
      if (crushKey !== this.lastCrushKey) {
        this.lastCrushKey = crushKey;
        this.crush.curve = makeCrushCurve(effective);
      }
      const wet = a.bitDepth === "off" ? srr * 0.6 : 0.55 + srr * 0.45;
      this.crushDry.gain.setTargetAtTime(1 - wet, t, 0.02);
      this.crushWet.gain.setTargetAtTime(wet, t, 0.02);
    }

    // Cassette generations
    const gen = clamp(a.cassetteGen, 0, 1);
    this.casHpf.frequency.setTargetAtTime(20 + gen * 280, t, 0.05);
    const srNyquist = srr < 0.001 ? 20000 : 24000 * Math.pow(2750 / 24000, srr);
    this.casLpf.frequency.setTargetAtTime(Math.min(20000 * Math.pow(0.12, gen), srNyquist), t, 0.05);
    this.casSat.curve = makeSoftSat(0.05 + gen * 0.9);

    // VHS Hi-Fi
    const vhs = clamp(a.vhsColor, 0, 1);
    this.vhsPeak.gain.setTargetAtTime(vhs * 5.5, t, 0.05);
    this.vhsLpf.frequency.setTargetAtTime(18000 * Math.pow(0.25, vhs), t, 0.05);

    // Tape speed + wow/flutter
    const speed = clamp(a.tapeSpeed, -1, 1);
    const baseDelay = 0.012 * Math.pow(2, -speed * 0.35); // slower tape = longer delay = lower pitch feel
    this.speedBase.offset.setTargetAtTime(baseDelay, t, 0.08);
    const wf = clamp(a.wowFlutter, 0, 1);
    const speedBoost = Math.abs(speed) * 0.002;
    this.wowGain.gain.setTargetAtTime(wf * 0.0045 + speedBoost, t, 0.05);
    this.flutterGain.gain.setTargetAtTime(wf * 0.0012 + speedBoost * 0.3, t, 0.05);
    this.wowLfo.frequency.setTargetAtTime(0.35 + Math.abs(speed) * 0.8, t, 0.05);

    // BBD chorus
    const bbd = clamp(a.bbdChorus, 0, 1);
    this.bbdDry.gain.setTargetAtTime(1 - bbd * 0.45, t, 0.03);
    this.bbdWet.gain.setTargetAtTime(bbd, t, 0.03);
    this.bbdDepth.gain.setTargetAtTime(bbd * 0.004, t, 0.03);
    this.bbdLpf.frequency.setTargetAtTime(5200 - bbd * 1800, t, 0.05);

    // Analog compress
    const ac = clamp(a.analogComp, 0, 1);
    this.comp.threshold.setTargetAtTime(-ac * 22, t, 0.05);
    this.comp.ratio.setTargetAtTime(1 + ac * 5, t, 0.05);
    this.compMakeup.gain.setTargetAtTime(1 + ac * 0.22, t, 0.05);

    // Noise beds — snap to silence when off (no lingering hiss from prior preset).
    if (a.dust > 0.001 || a.hiss > 0.001) this.ensureNoise();
    if (a.dust < 0.001) this.dustGain.gain.setValueAtTime(0, t);
    else this.dustGain.gain.setTargetAtTime(a.dust * 0.04, t, 0.05);
    if (a.hiss < 0.001) this.hissGain.gain.setValueAtTime(0, t);
    else this.hissGain.gain.setTargetAtTime(a.hiss * 0.035, t, 0.05);
    if (a.hum < 0.001) this.humGain.gain.setValueAtTime(0, t);
    else this.humGain.gain.setTargetAtTime(a.hum * 0.025, t, 0.05);
    this.printGain.gain.setTargetAtTime(a.printThrough * 0.18, t, 0.05);
  }
}

export const DEFAULT_VINTAGE_AGE: FireVintageAgeParams = { ...NEUTRAL };
