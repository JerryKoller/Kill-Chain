/**
 * StereoRepair — fix broken stereo images and phase damage (v2.1).
 *
 * Mid/side matrix with a correlation watchdog:
 *
 *   BASS ANCHOR   The side channel is highpassed (sweeping up to ~140 Hz) so
 *                 the low end always sums solid in mono — out-of-phase bass
 *                 is the #1 "sounds thin on speakers" fault.
 *   PHASE GUARD   Two per-channel analysers measure live L/R correlation on
 *                 a 30 ms timer. When the image goes anti-phase (corr < 0),
 *                 the side level is ducked toward mono proportionally — a
 *                 fully-cancelled mix folds to clean mono instead of a comb.
 *   SIDE TAME     Static side trim scaled by amount (up to −3 dB) reins in
 *                 exaggerated fake-stereo processing.
 *
 * `amount` 0 = transparent wire (matrix passthrough at unity, timer off).
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class StereoRepair {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private amount = 0;

  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly midGain: GainNode;
  private readonly sideGain: GainNode;
  private readonly sideHp: BiquadFilterNode;
  /** Dynamic anti-phase duck, driven by the correlation watchdog. */
  private readonly sideDuck: GainNode;

  private readonly anL: AnalyserNode;
  private readonly anR: AnalyserNode;
  private readonly bufL: Float32Array<ArrayBuffer>;
  private readonly bufR: Float32Array<ArrayBuffer>;
  private timer: number | null = null;
  private corrEnv = 1;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    // Force stereo at the matrix input — a mono feed must upmix to L=R
    // before the splitter, or the decode would leave the right channel dead.
    this.input.channelCount = 2;
    this.input.channelCountMode = "explicit";
    this.input.channelInterpretation = "speakers";
    this.output = ctx.createGain();

    // M/S encode: mid = (L+R)/2, side = (L−R)/2 — decode back L = m+s, R = m−s.
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);
    this.input.connect(this.splitter);

    const half = ctx.createGain();
    half.gain.value = 0.5;
    const halfNeg = ctx.createGain();
    halfNeg.gain.value = -0.5;
    const halfB = ctx.createGain();
    halfB.gain.value = 0.5;

    this.midGain = ctx.createGain();
    this.midGain.gain.value = 1;
    this.sideGain = ctx.createGain();
    this.sideGain.gain.value = 1;
    this.sideDuck = ctx.createGain();
    this.sideDuck.gain.value = 1;

    this.sideHp = ctx.createBiquadFilter();
    this.sideHp.type = "highpass";
    this.sideHp.frequency.value = 5; // open until engaged
    this.sideHp.Q.value = Math.SQRT1_2;

    // mid = 0.5·L + 0.5·R
    this.splitter.connect(half, 0);
    this.splitter.connect(halfB, 1);
    half.connect(this.midGain);
    halfB.connect(this.midGain);
    // side = 0.5·L − 0.5·R
    const sHalf = ctx.createGain();
    sHalf.gain.value = 0.5;
    this.splitter.connect(sHalf, 0);
    this.splitter.connect(halfNeg, 1);
    const sideSum = ctx.createGain();
    sHalf.connect(sideSum);
    halfNeg.connect(sideSum);
    sideSum.connect(this.sideHp).connect(this.sideGain).connect(this.sideDuck);

    // Decode: L = mid + side, R = mid − side.
    const negSide = ctx.createGain();
    negSide.gain.value = -1;
    this.sideDuck.connect(negSide);
    this.midGain.connect(this.merger, 0, 0);
    this.sideDuck.connect(this.merger, 0, 0);
    this.midGain.connect(this.merger, 0, 1);
    negSide.connect(this.merger, 0, 1);
    this.merger.connect(this.output);

    // Correlation watchdog taps.
    this.anL = ctx.createAnalyser();
    this.anR = ctx.createAnalyser();
    this.anL.fftSize = 1024;
    this.anR.fftSize = 1024;
    this.anL.smoothingTimeConstant = 0;
    this.anR.smoothingTimeConstant = 0;
    const watchSplit = ctx.createChannelSplitter(2);
    this.input.connect(watchSplit);
    watchSplit.connect(this.anL, 0);
    watchSplit.connect(this.anR, 1);
    this.bufL = new Float32Array(1024) as Float32Array<ArrayBuffer>;
    this.bufR = new Float32Array(1024) as Float32Array<ArrayBuffer>;
  }

  setAmount(a: number): void {
    const amt = clamp01(a);
    if (Math.abs(amt - this.amount) < 1e-4) return;
    this.amount = amt;
    const t = this.ctx.currentTime;
    if (amt <= 0.001) {
      this.stopTimer();
      this.sideHp.frequency.setTargetAtTime(5, t, 0.05);
      this.sideGain.gain.setTargetAtTime(1, t, 0.05);
      this.sideDuck.gain.setTargetAtTime(1, t, 0.08);
      return;
    }
    this.sideHp.frequency.setTargetAtTime(5 + amt * 135, t, 0.05); // → 140 Hz
    this.sideGain.gain.setTargetAtTime(1 - 0.3 * amt, t, 0.05); // up to −3 dB
    this.startTimer();
  }

  getAmount(): number {
    return this.amount;
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.anL.getFloatTimeDomainData(this.bufL);
    this.anR.getFloatTimeDomainData(this.bufR);
    let dot = 0;
    let eL = 0;
    let eR = 0;
    for (let i = 0; i < this.bufL.length; i++) {
      dot += this.bufL[i] * this.bufR[i];
      eL += this.bufL[i] * this.bufL[i];
      eR += this.bufR[i] * this.bufR[i];
    }
    const energy = Math.sqrt(eL * eR);
    const corr = energy > 1e-9 ? dot / energy : 1;
    // Slow envelope so a single drum hit doesn't pump the image.
    this.corrEnv += (corr - this.corrEnv) * 0.15;
    // Anti-phase → fold the side down. corr 0 = untouched, corr −1 → up to
    // −85% side at full amount (never a hard mono switch — that pumps).
    const bad = Math.max(0, -this.corrEnv);
    const duck = 1 - bad * 0.85 * this.amount;
    this.sideDuck.gain.setTargetAtTime(duck, this.ctx.currentTime, 0.08);
  }

  dispose(): void {
    this.stopTimer();
  }
}
