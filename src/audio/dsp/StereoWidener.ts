/**
 * StereoWidener — classic Mid/Side widening.
 *
 *   M = (L + R) * 0.5
 *   S = (L - R) * 0.5
 *   width = 0 → mono (S=0)
 *   width = 1 → neutral
 *   width > 1 → wider than stereo
 *
 * Implemented entirely with native nodes (no AudioWorklet required), so
 * it works in any browser/Electron build out of the box.
 */
export class StereoWidener {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly midL: GainNode;
  private readonly midR: GainNode;
  private readonly sidePosL: GainNode;
  private readonly sideNegR: GainNode;
  private readonly midGain: GainNode;
  private readonly sideGain: GainNode;
  private readonly outL: GainNode;
  private readonly outR: GainNode;
  private readonly sideToL: GainNode;
  private readonly sideToRNeg: GainNode;

  private _width = 1.0;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);

    this.midL = ctx.createGain();
    this.midR = ctx.createGain();
    this.midL.gain.value = 0.5;
    this.midR.gain.value = 0.5;

    this.sidePosL = ctx.createGain();
    this.sideNegR = ctx.createGain();
    this.sidePosL.gain.value = 0.5;
    this.sideNegR.gain.value = -0.5;

    this.midGain = ctx.createGain();
    this.sideGain = ctx.createGain();

    this.outL = ctx.createGain();
    this.outR = ctx.createGain();
    this.sideToL = ctx.createGain();
    this.sideToRNeg = ctx.createGain();
    this.sideToL.gain.value = 1.0;
    this.sideToRNeg.gain.value = -1.0;

    this.input.connect(this.splitter);
    // Mid = 0.5L + 0.5R
    this.splitter.connect(this.midL, 0);
    this.splitter.connect(this.midR, 1);
    this.midL.connect(this.midGain);
    this.midR.connect(this.midGain);

    // Side = 0.5L - 0.5R
    this.splitter.connect(this.sidePosL, 0);
    this.splitter.connect(this.sideNegR, 1);
    this.sidePosL.connect(this.sideGain);
    this.sideNegR.connect(this.sideGain);

    // L = Mid + Side
    this.midGain.connect(this.outL);
    this.sideGain.connect(this.sideToL);
    this.sideToL.connect(this.outL);
    // R = Mid - Side
    this.midGain.connect(this.outR);
    this.sideGain.connect(this.sideToRNeg);
    this.sideToRNeg.connect(this.outR);

    this.outL.connect(this.merger, 0, 0);
    this.outR.connect(this.merger, 0, 1);
    this.merger.connect(this.output);

    this.setWidth(0);
  }

  setWidth(normalized: number): void {
    // -1 → mono, 0 → neutral, +1 → very wide
    const w = Math.max(-1, Math.min(1, normalized));
    this._width = 1.0 + w; // 0..2
    const t = this.ctx.currentTime;
    this.sideGain.gain.setTargetAtTime(this._width, t, 0.02);
    this.midGain.gain.setTargetAtTime(1.0, t, 0.02);
  }

  get width(): number {
    return this._width - 1.0;
  }
}
