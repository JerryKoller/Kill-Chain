/**
 * 3-band multiband compressor with LR4 crossovers at 250 Hz and 3 kHz.
 *
 * Each band gets its own DynamicsCompressorNode. Per-band depth is a
 * unipolar 0..1: 0 = transparent (1:1 ratio), 1 = aggressive (4:1 with
 * low threshold).
 *
 * Bands are summed at the output via a single GainNode.
 */
export class MultibandCompressor {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly compLow: DynamicsCompressorNode;
  private readonly compMid: DynamicsCompressorNode;
  private readonly compHigh: DynamicsCompressorNode;
  /** Dry/wet crossfade so neutral = bit-transparent (no 3-band comb). */
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly depths = { low: 0, mid: 0, high: 0 };

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();

    const lowOut = lr4(ctx, "lowpass", 250);
    const midA = lr4(ctx, "highpass", 250);
    const midB = lr4(ctx, "lowpass", 3000);
    const highOut = lr4(ctx, "highpass", 3000);

    this.compLow = ctx.createDynamicsCompressor();
    this.compMid = ctx.createDynamicsCompressor();
    this.compHigh = ctx.createDynamicsCompressor();
    for (const c of [this.compLow, this.compMid, this.compHigh]) {
      c.threshold.value = -6;
      c.knee.value = 8;
      c.ratio.value = 1;
      c.attack.value = 0.012;
      c.release.value = 0.18;
    }

    // Wet = the 3-band split/compress/sum network. This recombination is NOT
    // phase-flat (each band has a different group delay), so it must never be
    // in the path unless the user is actually compressing.
    this.input.connect(lowOut.input);
    lowOut.output.connect(this.compLow).connect(this.wet);

    this.input.connect(midA.input);
    midA.output.connect(midB.input);
    midB.output.connect(this.compMid).connect(this.wet);

    this.input.connect(highOut.input);
    highOut.output.connect(this.compHigh).connect(this.wet);

    this.wet.connect(this.output);

    // Dry = clean wire, active by default.
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.dry.gain.value = 1;
    this.wet.gain.value = 0;
  }

  setDepth(band: "low" | "mid" | "high", amount: number): void {
    const c = band === "low" ? this.compLow : band === "mid" ? this.compMid : this.compHigh;
    const a = Math.max(0, Math.min(1, amount));
    this.depths[band] = a;
    const threshold = -6 - a * 18;       // -6 → -24
    const ratio = 1 + a * 3;              // 1 → 4
    const t = this.ctx.currentTime;
    c.threshold.setTargetAtTime(threshold, t, 0.05);
    c.ratio.setTargetAtTime(ratio, t, 0.05);
    this.refreshBypass();
  }

  private refreshBypass(): void {
    const active = this.depths.low > 0 || this.depths.mid > 0 || this.depths.high > 0;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(active ? 1 : 0, t, 0.04);
    this.dry.gain.setTargetAtTime(active ? 0 : 1, t, 0.04);
  }
}

function lr4(
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
