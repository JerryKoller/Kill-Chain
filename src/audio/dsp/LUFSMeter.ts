/**
 * ITU-R BS.1770-4 loudness meter (mono / stereo).
 *
 * We K-weight the input with two cascaded biquads (pre-filter + RLB
 * highpass), then compute mean-square energy in 400 ms momentary blocks
 * with 75% overlap (100 ms hop). Short-term loudness is the mean of the
 * last 30 momentary blocks (~3 s). Integrated loudness is the gated mean
 * of all blocks (gate at -70 LUFS abs + relative gate at -10 LU).
 *
 * Implemented as an analyser node feeding off a stereo splitter, with the
 * energy sum computed on the CPU in a 100ms timer.
 */
export class LUFSMeter {
  readonly input: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly preL: BiquadFilterNode;
  private readonly preR: BiquadFilterNode;
  private readonly rlbL: BiquadFilterNode;
  private readonly rlbR: BiquadFilterNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly analyserL: AnalyserNode;
  private readonly analyserR: AnalyserNode;

  /** Last momentary loudness (~400 ms) - LUFS */
  momentaryLufs = -120;
  /** Short-term loudness (~3 s) - LUFS */
  shortTermLufs = -120;
  /** Integrated loudness since reset() - LUFS */
  integratedLufs = -120;

  private momentaryHistory: number[] = [];
  private allBlocks: number[] = [];
  private buf: Float32Array<ArrayBuffer>;
  private timer: number | null = null;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();

    this.splitter = ctx.createChannelSplitter(2);
    this.input.connect(this.splitter);

    // K-weighting: pre-filter (high-shelf @ ~1681 Hz, +4 dB) + RLB
    // (high-pass @ ~38 Hz). Biquad coefficients picked to approximate
    // BS.1770 - close enough for a creative meter.
    this.preL = makePre(ctx);
    this.preR = makePre(ctx);
    this.rlbL = makeRLB(ctx);
    this.rlbR = makeRLB(ctx);

    this.splitter.connect(this.preL, 0, 0);
    this.splitter.connect(this.preR, 1, 0);
    this.preL.connect(this.rlbL);
    this.preR.connect(this.rlbR);

    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    // 400 ms @ 48k = 19200 samples. AnalyserNode max fftSize is 32768, OK.
    const sr = (this.ctx as AudioContext).sampleRate || 48000;
    const fft = nearestPow2(Math.min(32768, Math.floor(sr * 0.4)));
    this.analyserL.fftSize = fft;
    this.analyserR.fftSize = fft;
    this.analyserL.smoothingTimeConstant = 0;
    this.analyserR.smoothingTimeConstant = 0;
    this.rlbL.connect(this.analyserL);
    this.rlbR.connect(this.analyserR);

    this.buf = new Float32Array(fft) as Float32Array<ArrayBuffer>;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.momentaryHistory = [];
    this.allBlocks = [];
    this.momentaryLufs = -120;
    this.shortTermLufs = -120;
    this.integratedLufs = -120;
  }

  private tick(): void {
    this.analyserL.getFloatTimeDomainData(this.buf);
    let sumL = 0;
    for (let i = 0; i < this.buf.length; i++) sumL += this.buf[i] * this.buf[i];
    const msL = sumL / this.buf.length;

    this.analyserR.getFloatTimeDomainData(this.buf);
    let sumR = 0;
    for (let i = 0; i < this.buf.length; i++) sumR += this.buf[i] * this.buf[i];
    const msR = sumR / this.buf.length;

    // Stereo loudness with channel weights = 1 each.
    const ms = msL + msR;
    const lufs = ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120;
    this.momentaryLufs = lufs;

    this.momentaryHistory.push(lufs);
    if (this.momentaryHistory.length > 30) this.momentaryHistory.shift();
    this.shortTermLufs = average(this.momentaryHistory);

    if (lufs > -70) this.allBlocks.push(lufs);
    if (this.allBlocks.length > 0) {
      // Apply -10 LU relative gate.
      const ungatedMean = average(this.allBlocks);
      const gateLU = ungatedMean - 10;
      const gated = this.allBlocks.filter((l) => l >= gateLU);
      this.integratedLufs = gated.length > 0 ? average(gated) : -120;
    }
  }
}

function makePre(ctx: BaseAudioContext): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "highshelf";
  f.frequency.value = 1681;
  f.gain.value = 4;
  f.Q.value = 0.7071;
  return f;
}

function makeRLB(ctx: BaseAudioContext): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 38;
  f.Q.value = 0.5;
  return f;
}

function nearestPow2(n: number): number {
  let p = 32;
  while (p < n) p <<= 1;
  return p;
}

function average(arr: number[]): number {
  if (arr.length === 0) return -120;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}
