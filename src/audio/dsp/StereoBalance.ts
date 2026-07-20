/**
 * Independent L/R gain trim + sub-millisecond per-ear delay (ITD shift).
 *
 * Useful for users with asymmetric hearing or who want to perceptually
 * shift the centre image. Web Audio's built-in StereoPannerNode only
 * exposes a single -1..+1 pan; this lets you tweak each ear's gain in dB
 * and the inter-aural delay in milliseconds, independently.
 *
 * Transparent when balanceL = balanceR = 0 dB and delayMs = 0.
 */
export class StereoBalance {
  readonly input: GainNode;
  readonly output: ChannelMergerNode;

  private readonly ctx: BaseAudioContext;
  private readonly splitter: ChannelSplitterNode;
  private readonly lGain: GainNode;
  private readonly rGain: GainNode;
  private readonly lDelay: DelayNode;
  private readonly rDelay: DelayNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createChannelMerger(2);

    this.splitter = ctx.createChannelSplitter(2);
    this.input.connect(this.splitter);

    this.lDelay = ctx.createDelay(0.02);
    this.rDelay = ctx.createDelay(0.02);
    this.lGain = ctx.createGain();
    this.rGain = ctx.createGain();

    this.splitter.connect(this.lDelay, 0, 0);
    this.splitter.connect(this.rDelay, 1, 0);
    this.lDelay.connect(this.lGain).connect(this.output, 0, 0);
    this.rDelay.connect(this.rGain).connect(this.output, 0, 1);
  }

  setBalanceDb(left: number, right: number): void {
    const t = this.ctx.currentTime;
    this.lGain.gain.setTargetAtTime(dbToGain(left), t, 0.05);
    this.rGain.gain.setTargetAtTime(dbToGain(right), t, 0.05);
  }

  /**
   * delayMs > 0 → R is delayed (image shifts toward L)
   * delayMs < 0 → L is delayed (image shifts toward R)
   * |delayMs| clamped to 5 ms.
   */
  setDelayMs(delayMs: number): void {
    const d = Math.max(-5, Math.min(5, delayMs)) / 1000;
    const t = this.ctx.currentTime;
    if (d >= 0) {
      this.lDelay.delayTime.setTargetAtTime(0, t, 0.05);
      this.rDelay.delayTime.setTargetAtTime(d, t, 0.05);
    } else {
      this.lDelay.delayTime.setTargetAtTime(-d, t, 0.05);
      this.rDelay.delayTime.setTargetAtTime(0, t, 0.05);
    }
  }
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
