/**
 * SpatialEnhancer — a lightweight crossfeed + Haas widener to give
 * tracks an "out-of-head" feeling on closed-back headphones.
 *
 * For each channel we feed a delayed, low-passed copy to the opposite
 * channel. The amount controls both delay (5–18ms) and gain.
 */
export class SpatialEnhancer {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;

  private readonly lDirect: GainNode;
  private readonly rDirect: GainNode;
  private readonly lToR: GainNode;
  private readonly rToL: GainNode;
  private readonly lDelay: DelayNode;
  private readonly rDelay: DelayNode;
  private readonly lFilter: BiquadFilterNode;
  private readonly rFilter: BiquadFilterNode;

  private _amount = 0;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);

    this.lDirect = ctx.createGain();
    this.rDirect = ctx.createGain();
    this.lToR = ctx.createGain();
    this.rToL = ctx.createGain();
    this.lDelay = ctx.createDelay(0.05);
    this.rDelay = ctx.createDelay(0.05);
    this.lFilter = ctx.createBiquadFilter();
    this.rFilter = ctx.createBiquadFilter();
    this.lFilter.type = "lowpass";
    this.rFilter.type = "lowpass";
    this.lFilter.frequency.value = 2200;
    this.rFilter.frequency.value = 2200;

    this.input.connect(this.splitter);

    this.splitter.connect(this.lDirect, 0);
    this.splitter.connect(this.rDirect, 1);
    this.lDirect.connect(this.merger, 0, 0);
    this.rDirect.connect(this.merger, 0, 1);

    this.splitter.connect(this.lDelay, 0);
    this.lDelay.connect(this.lFilter);
    this.lFilter.connect(this.lToR);
    this.lToR.connect(this.merger, 0, 1);

    this.splitter.connect(this.rDelay, 1);
    this.rDelay.connect(this.rFilter);
    this.rFilter.connect(this.rToL);
    this.rToL.connect(this.merger, 0, 0);

    this.merger.connect(this.output);

    this.lDirect.gain.value = 1.0;
    this.rDirect.gain.value = 1.0;
    this.setAmount(0);
  }

  setAmount(value: number): void {
    // Unipolar — 0 = no crossfeed at all (acoustically transparent).
    const a = Math.max(0, Math.min(1, value));
    this._amount = a;
    const delay = 0.005 + a * 0.013;
    const cross = a * 0.32;
    const t = this.ctx.currentTime;
    this.lDelay.delayTime.setTargetAtTime(delay, t, 0.05);
    this.rDelay.delayTime.setTargetAtTime(delay, t, 0.05);
    this.lToR.gain.setTargetAtTime(cross, t, 0.05);
    this.rToL.gain.setTargetAtTime(cross, t, 0.05);
  }
}
