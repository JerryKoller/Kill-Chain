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

  /** Mean-square (energy) histories — BS.1770 averages energies, then
   *  converts to LUFS once. Averaging LUFS values (log domain) understates
   *  loud passages and overstates quiet ones. */
  private momentaryMs: number[] = [];
  /** Bounded ring buffer of block energies (1 h of 100 ms blocks). The old
   *  unbounded array grew ~36k entries/hour forever during long sessions. */
  private blockMs: Float64Array = new Float64Array(36_000);
  private blockCount = 0;
  private blockHead = 0;
  private tickN = 0;
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
    // 400 ms @ 48k = 19200 samples; the closest power of two is 16384
    // (~341 ms) — much nearer the BS.1770 window than rounding UP to 32768
    // (~683 ms), which stretched every "momentary" reading.
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
    this.momentaryMs = [];
    this.blockCount = 0;
    this.blockHead = 0;
    this.tickN = 0;
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
    this.momentaryLufs = lufsOf(ms);

    // Short-term (~3 s): mean of block ENERGIES, converted once.
    this.momentaryMs.push(ms);
    if (this.momentaryMs.length > 30) this.momentaryMs.shift();
    let stSum = 0;
    for (const v of this.momentaryMs) stSum += v;
    this.shortTermLufs = lufsOf(stSum / this.momentaryMs.length);

    // Integrated: absolute gate at -70 LUFS on entry.
    if (this.momentaryLufs > -70) {
      this.blockMs[this.blockHead] = ms;
      this.blockHead = (this.blockHead + 1) % this.blockMs.length;
      if (this.blockCount < this.blockMs.length) this.blockCount++;
    }
    // Recomputing the two-pass relative gate is O(blocks); do it at 1 Hz
    // instead of every 100 ms tick — integrated loudness moves slowly.
    this.tickN++;
    if (this.blockCount > 0 && this.tickN % 10 === 0) {
      let sum = 0;
      for (let i = 0; i < this.blockCount; i++) sum += this.blockMs[i];
      const ungatedMeanMs = sum / this.blockCount;
      // -10 LU relative gate applied in the energy domain (10 LU = 10 dB).
      const gateMs = ungatedMeanMs / 10;
      let gatedSum = 0;
      let gatedN = 0;
      for (let i = 0; i < this.blockCount; i++) {
        if (this.blockMs[i] >= gateMs) {
          gatedSum += this.blockMs[i];
          gatedN++;
        }
      }
      this.integratedLufs = gatedN > 0 ? lufsOf(gatedSum / gatedN) : -120;
    }
  }
}

function lufsOf(meanSquare: number): number {
  return meanSquare > 1e-12 ? -0.691 + 10 * Math.log10(meanSquare) : -120;
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

/** Nearest power of two (not next-up) so the analysis window hugs the target. */
function nearestPow2(n: number): number {
  let p = 32;
  while (p < n) p <<= 1;
  const down = p >> 1;
  return n - down < p - n ? down : p;
}
