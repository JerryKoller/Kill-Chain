/**
 * HarmonicEnhancer — adds gentle even-order harmonics for an "alive" tone.
 *
 * We branch the signal: a dry pass-through plus a high-passed, soft-shaped
 * copy that gets blended back in. The shaped copy is the only thing scaled
 * by `amount`, so at amount=0 the wet branch is silent and the chain is a
 * mathematically transparent dry pass-through.
 *
 * Contract: `amount` is in [0, 1] (negative values clamp to 0).
 */
export class HarmonicEnhancer {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private _amount = 0;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.hp = ctx.createBiquadFilter();
    this.shaper = ctx.createWaveShaper();

    this.hp.type = "highpass";
    this.hp.frequency.value = 1800;
    this.hp.Q.value = 0.7;

    this.shaper.oversample = "4x";
    this.shaper.curve = HarmonicEnhancer.makeCurve(0.35);

    this.input.connect(this.dry);
    this.input.connect(this.hp);
    this.hp.connect(this.shaper);
    this.shaper.connect(this.wet);
    this.dry.connect(this.output);
    this.wet.connect(this.output);

    this.dry.gain.value = 1.0;
    this.setAmount(0);
  }

  setAmount(value: number): void {
    // Negative half of a bipolar control = off. 0 = pure dry. 1 = full sparkle.
    const a = Math.max(0, Math.min(1, value));
    this._amount = a;
    // Keep the wet branch genuinely subtle even at full tilt — this is an
    // excitement effect, not a distortion box.
    const wet = a * 0.35;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(wet, t, 0.03);
  }

  get amount(): number {
    return this._amount;
  }

  private static makeCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = drive * 4;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // Even-leaning soft-clip — emphasises 2nd harmonic content.
      const y = Math.tanh(x + k * x * x * Math.sign(x) * 0.5);
      curve[i] = y;
    }
    return curve;
  }
}
