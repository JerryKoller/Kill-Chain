/**
 * PseudoStereo — synthesized width for mono uploads (Restoration Bay).
 *
 * A normal stereo widener scales the SIDE signal — useless on a mono file,
 * which has none. This stage manufactures one: the input is collapsed to
 * mono, then split into two complementary spectral "combs" (L gets gentle
 * peaking boosts where R gets cuts and vice versa, alternating up the
 * spectrum) plus a short Haas delay on the right ear. The result decorrelates
 * the channels enough to read as space while summing back to (almost) the
 * original mono.
 *
 * Lows below ~200 Hz stay center — both trees leave the bass band untouched
 * so the image never gets seasick.
 *
 * At amount 0 the wet path is silent and the dry wire is untouched.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Alternating comb centers (Hz) — complementary ±dB on each side. */
const COMB_FREQS = [350, 700, 1400, 2800, 5600, 11200];
const COMB_DB = 4.5;
const COMB_Q = 1.6;

export class PseudoStereo {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly haas: DelayNode;

  private amount = 0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.input.connect(this.dryGain).connect(this.output);

    // Wet path: mono fold-down → complementary filter trees → L/R merge.
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = "explicit";
    mono.channelInterpretation = "speakers";
    this.input.connect(mono);

    const buildTree = (sign: 1 | -1): AudioNode => {
      let node: AudioNode = mono;
      COMB_FREQS.forEach((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = freq;
        f.Q.value = COMB_Q;
        f.gain.value = sign * (i % 2 === 0 ? COMB_DB : -COMB_DB);
        node.connect(f);
        node = f;
      });
      return node;
    };

    const left = buildTree(1);
    const right = buildTree(-1);
    // Short Haas delay on the right ear deepens the decorrelation.
    this.haas = ctx.createDelay(0.05);
    this.haas.delayTime.value = 0.008;
    const merger = ctx.createChannelMerger(2);
    left.connect(merger, 0, 0);
    right.connect(this.haas).connect(merger, 0, 1);

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;
    merger.connect(this.wetGain).connect(this.output);
  }

  setAmount(amount: number): void {
    this.amount = clamp01(amount);
    const t = this.ctx.currentTime;
    // Keep total energy roughly constant while crossfading.
    this.wetGain.gain.setTargetAtTime(this.amount * 0.9, t, 0.05);
    this.dryGain.gain.setTargetAtTime(1 - this.amount * 0.75, t, 0.05);
  }

  getAmount(): number {
    return this.amount;
  }
}
