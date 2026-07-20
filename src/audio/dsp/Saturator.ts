/**
 * Saturator — gentle tape-like soft clipping driven by a normalized control.
 *
 * Contract: `amount` is in [0, 1].
 *   0 → fully clean. The waveshaper is a perfect linear pass-through and
 *       pre/post gain are unity, so the chain is mathematically
 *       transparent (modulo the WaveShaper's own oversampling) at neutral.
 *   1 → maximum drive.
 *
 * Negative inputs are clamped to 0 so this can sit on a bipolar knob.
 */
export class Saturator {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly pre: GainNode;
  private readonly post: GainNode;
  private readonly shaper: WaveShaperNode;
  /** Dry/wet crossfade so amount=0 keeps the 4x-oversampled shaper out of
   *  the audible path entirely (its resampling can tint the top octave). */
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private _amount = 0;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.pre = ctx.createGain();
    this.post = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = "4x";
    this.shaper.curve = Saturator.makeCurve(0.0);

    this.input.connect(this.pre);
    this.pre.connect(this.shaper);
    this.shaper.connect(this.post);
    this.post.connect(this.wet);
    this.wet.connect(this.output);

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.dry.gain.value = 1;
    this.wet.gain.value = 0;

    this.setAmount(0);
  }

  setAmount(value: number): void {
    // Bipolar input — negative half is "off" (no reverse-saturation makes sense).
    const a = Math.max(0, Math.min(1, value));
    this._amount = a;
    this.shaper.curve = Saturator.makeCurve(a);
    // Conservative gain staging: at 0 → unity in & out. At 1 → +3dB drive,
    // automatically compensated by post-gain to maintain perceived loudness.
    const preGain = 1 + a * 0.4;
    const postGain = 1 / (1 + a * 0.5);
    const t = this.ctx.currentTime;
    this.pre.gain.setTargetAtTime(preGain, t, 0.02);
    this.post.gain.setTargetAtTime(postGain, t, 0.02);
    // Crossfade to the clean wire when fully off.
    this.wet.gain.setTargetAtTime(a > 0 ? 1 : 0, t, 0.02);
    this.dry.gain.setTargetAtTime(a > 0 ? 0 : 1, t, 0.02);
  }

  private static makeCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 4096;
    const curve = new Float32Array(n);
    // At drive=0 we want curve[i] = x exactly (pure pass-through) so the
    // shaper is acoustically invisible. We only start bending the curve
    // once drive > 0.
    if (drive <= 0) {
      for (let i = 0; i < n; i++) {
        curve[i] = (i / (n - 1)) * 2 - 1;
      }
      return curve;
    }
    // Soft-knee tanh saturation. k grows with drive so light settings stay
    // musical; full drive gives a noticeable but pleasant tape colour.
    const k = 1 + drive * 4;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }
}
