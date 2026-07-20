/**
 * TransientShaper — modulates attack vs sustain using two parallel
 * envelope-followed compressors.
 *
 * "Attack path" uses a fast attack/release compressor whose gain reduction
 * acts as a transient detector. Subtracting that from the dry signal gives
 * us a transient-only component we can boost or cut to taste.
 *
 * For simplicity & cross-platform stability we approximate this with a
 * fast compressor + slow compressor pair and crossfade them.
 */
export class TransientShaper {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly fast: DynamicsCompressorNode;
  private readonly slow: DynamicsCompressorNode;
  private readonly fastGain: GainNode;
  private readonly slowGain: GainNode;

  private _attack = 0;
  private _sustain = 0;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.fast = ctx.createDynamicsCompressor();
    this.slow = ctx.createDynamicsCompressor();
    this.fastGain = ctx.createGain();
    this.slowGain = ctx.createGain();

    this.fast.threshold.value = -28;
    this.fast.knee.value = 8;
    this.fast.ratio.value = 4;
    this.fast.attack.value = 0.001;
    this.fast.release.value = 0.05;

    this.slow.threshold.value = -22;
    this.slow.knee.value = 12;
    this.slow.ratio.value = 2.2;
    this.slow.attack.value = 0.06;
    this.slow.release.value = 0.35;

    this.input.connect(this.dry);
    this.dry.connect(this.output);

    this.input.connect(this.fast);
    this.fast.connect(this.fastGain);
    this.fastGain.connect(this.output);

    this.input.connect(this.slow);
    this.slow.connect(this.slowGain);
    this.slowGain.connect(this.output);

    this.dry.gain.value = 1.0;
    this.setAttack(0);
    this.setSustain(0);
  }

  setAttack(value: number): void {
    this._attack = Math.max(-1, Math.min(1, value));
    const t = this.ctx.currentTime;
    // Boost = positive amount of fast-compressed signal (out of phase wouldn't
    // be safe to expose without phase-aligned paths). Cut = negative gain.
    this.fastGain.gain.setTargetAtTime(this._attack * 0.5, t, 0.02);
  }

  setSustain(value: number): void {
    this._sustain = Math.max(-1, Math.min(1, value));
    const t = this.ctx.currentTime;
    this.slowGain.gain.setTargetAtTime(this._sustain * 0.4, t, 0.02);
  }
}
