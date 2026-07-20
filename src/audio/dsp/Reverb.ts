/**
 * Reverb — convolution reverb with a procedurally generated impulse.
 *
 * We synthesize an impulse on the fly using exponentially-decaying noise.
 * This avoids shipping IR files and lets us morph between "intimate" and
 * "cathedral" by re-baking the IR when the size parameter changes.
 */
export class Reverb {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly conv: ConvolverNode;
  private readonly preDelay: DelayNode;
  private readonly damp: BiquadFilterNode;
  private rebakePending = false;

  private _amount = 0;
  private _size = 0.4;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.conv = ctx.createConvolver();
    this.preDelay = ctx.createDelay(0.2);
    this.damp = ctx.createBiquadFilter();
    this.damp.type = "lowpass";
    this.damp.frequency.value = 7500;
    this.damp.Q.value = 0.7;

    this.input.connect(this.dry);
    this.dry.connect(this.output);

    this.input.connect(this.preDelay);
    this.preDelay.connect(this.conv);
    this.conv.connect(this.damp);
    this.damp.connect(this.wet);
    this.wet.connect(this.output);

    this.dry.gain.value = 1.0;
    this.wet.gain.value = 0.0;
    this.preDelay.delayTime.value = 0.012;

    this.bakeImpulse(this._size);
  }

  setAmount(value: number): void {
    // Unipolar — 0 = bone-dry. Negative clamps to 0 so the wet branch is
    // silent at neutral and the chain is acoustically transparent.
    const a = Math.max(0, Math.min(1, value));
    this._amount = a;
    const wet = a * 0.7;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(wet, t, 0.05);
  }

  setSize(value: number): void {
    // Bipolar input — -1 = booth, 0 = mid room, +1 = cathedral.
    const size = Math.max(0, Math.min(1, (value + 1) / 2));
    this._size = size;
    this.preDelay.delayTime.setTargetAtTime(
      0.005 + size * 0.06,
      this.ctx.currentTime,
      0.05,
    );
    if (!this.rebakePending) {
      this.rebakePending = true;
      // Debounce IR regeneration to keep UI buttery during drags.
      setTimeout(() => {
        this.bakeImpulse(this._size);
        this.rebakePending = false;
      }, 60);
    }
  }

  private bakeImpulse(size: number): void {
    const sampleRate = this.ctx.sampleRate;
    const duration = 0.4 + size * 4.6; // 0.4s → 5s
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const decay = 2.2 + size * 5.0;
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    this.conv.buffer = buffer;
  }
}
