/**
 * Per-band Mid/Side width control.
 *
 * The signal is split into 3 bands using Linkwitz-Riley 4th-order
 * crossovers (two cascaded biquads with Q=0.707 each at the same cutoff).
 * Each band gets its own Mid/Side encoder + width gain. Bands are summed
 * back to L/R at the output.
 *
 * Width semantics (per band):
 *   -1 → full mono (side = 0)
 *    0 → unchanged
 *   +1 → exaggerated stereo (side x2)
 *
 * Transparent when all three widths are 0.
 *
 * Note: using only stock Web Audio nodes - no AudioWorklet required.
 * For Mid/Side encode/decode we exploit ChannelSplitter +
 * GainNode arithmetic with explicit channel routing.
 */
export class PerBandWidth {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly lowChain: BandStereoStage;
  private readonly midChain: BandStereoStage;
  private readonly highChain: BandStereoStage;
  /** Dry/wet crossfade so neutral = bit-transparent (no 3-band comb). */
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly widths = { low: 0, mid: 0, high: 0 };

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();

    // Split crossover into 3 bands. LR4 = two cascaded LP/HP at the same
    // cutoff. We use 250 Hz and 3 kHz as the two crossover points.
    const splitLow = makeLR4(ctx, "lowpass", 250);
    const highOfLow = makeLR4(ctx, "highpass", 250);
    const lowOfHigh = makeLR4(ctx, "lowpass", 3000);
    const splitHigh = makeLR4(ctx, "highpass", 3000);

    // Low band: input → splitLow → low stage
    this.input.connect(splitLow.input);
    this.lowChain = new BandStereoStage(ctx);
    splitLow.output.connect(this.lowChain.input);
    this.lowChain.output.connect(this.wet);

    // Mid + high: input → highOfLow (everything above 250)
    this.input.connect(highOfLow.input);
    // Mid band: highOfLow → lowOfHigh
    highOfLow.output.connect(lowOfHigh.input);
    this.midChain = new BandStereoStage(ctx);
    lowOfHigh.output.connect(this.midChain.input);
    this.midChain.output.connect(this.wet);

    // High band: highOfLow → splitHigh (everything above 3000)
    highOfLow.output.connect(splitHigh.input);
    this.highChain = new BandStereoStage(ctx);
    splitHigh.output.connect(this.highChain.input);
    this.highChain.output.connect(this.wet);

    this.wet.connect(this.output);

    // Dry = clean wire, active by default. The band split/M-S/sum network
    // above is only crossfaded in when a width is actually dialed away from 0.
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.dry.gain.value = 1;
    this.wet.gain.value = 0;
  }

  setLowWidth(w: number): void { this.widths.low = w; this.lowChain.setWidth(w); this.refreshBypass(); }
  setMidWidth(w: number): void { this.widths.mid = w; this.midChain.setWidth(w); this.refreshBypass(); }
  setHighWidth(w: number): void { this.widths.high = w; this.highChain.setWidth(w); this.refreshBypass(); }

  private refreshBypass(): void {
    const active = this.widths.low !== 0 || this.widths.mid !== 0 || this.widths.high !== 0;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(active ? 1 : 0, t, 0.04);
    this.dry.gain.setTargetAtTime(active ? 0 : 1, t, 0.04);
  }
}

class BandStereoStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly midGain: GainNode;
  private readonly sideGain: GainNode;
  private readonly ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // M/S encode: M = (L + R) / 2, S = (L - R) / 2
    const splitter = ctx.createChannelSplitter(2);
    this.input.connect(splitter);

    const lPlusR = ctx.createGain();
    const lMinusR = ctx.createGain();
    const lForSide = ctx.createGain();
    const rForSideInv = ctx.createGain();
    rForSideInv.gain.value = -1;

    splitter.connect(lPlusR, 0, 0);
    splitter.connect(lPlusR, 1, 0);
    lPlusR.gain.value = 0.5;

    splitter.connect(lForSide, 0, 0);
    splitter.connect(rForSideInv, 1, 0);
    lForSide.connect(lMinusR);
    rForSideInv.connect(lMinusR);
    lMinusR.gain.value = 0.5;

    // Width gains
    this.midGain = ctx.createGain();
    this.midGain.gain.value = 1;
    this.sideGain = ctx.createGain();
    this.sideGain.gain.value = 1;
    lPlusR.connect(this.midGain);
    lMinusR.connect(this.sideGain);

    // Decode: L = M + S, R = M - S
    const sideForR = ctx.createGain();
    sideForR.gain.value = -1;
    this.sideGain.connect(sideForR);

    const lOut = ctx.createGain();
    const rOut = ctx.createGain();
    this.midGain.connect(lOut);
    this.sideGain.connect(lOut);
    this.midGain.connect(rOut);
    sideForR.connect(rOut);

    const merger = ctx.createChannelMerger(2);
    lOut.connect(merger, 0, 0);
    rOut.connect(merger, 0, 1);
    merger.connect(this.output);
  }

  setWidth(w: number): void {
    // w in [-1, 1]: -1 → side x0, 0 → x1, +1 → x2.
    const sideScale = 1 + Math.max(-1, Math.min(1, w));
    this.sideGain.gain.setTargetAtTime(sideScale, this.ctx.currentTime, 0.05);
  }
}

function makeLR4(
  ctx: BaseAudioContext,
  type: "lowpass" | "highpass",
  freq: number,
): { input: GainNode; output: GainNode } {
  const inp = ctx.createGain();
  const a = ctx.createBiquadFilter();
  const b = ctx.createBiquadFilter();
  a.type = type;
  b.type = type;
  a.frequency.value = freq;
  b.frequency.value = freq;
  a.Q.value = 0.7071;
  b.Q.value = 0.7071;
  inp.connect(a).connect(b);
  const out = ctx.createGain();
  b.connect(out);
  return { input: inp, output: out };
}
