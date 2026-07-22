/**
 * DeClicker — click / crackle tamer for the Restoration Bay.
 *
 * Vinyl pops, scratchy uploads and edit clicks are sample-scale spikes far
 * above the running program level. A DynamicsCompressor set up as a hard
 * transient clamp (fast attack, high ratio, zero knee) catches them with
 * sample-accurate native detection; a slow envelope follower (30 ms timer)
 * keeps the threshold riding WELL ABOVE the music's own level, so ordinary
 * drum transients pass and only genuine outliers get clamped.
 *
 * The compressor path is crossfaded in only while the knob is up — at 0 the
 * dry wire carries the signal and no extra latency or compression exists.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class DeClicker {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private timer: number | null = null;

  private amount = 0;
  private rmsDb = -30;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.input.connect(this.dryGain).connect(this.output);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = 0;
    this.comp.knee.value = 0;
    this.comp.ratio.value = 20;
    this.comp.attack.value = 0.001;
    this.comp.release.value = 0.04;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;
    this.input.connect(this.comp).connect(this.wetGain).connect(this.output);

    if (typeof window !== "undefined" && !("startRendering" in ctx)) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.input.connect(this.analyser);
      this.buf = new Float32Array(2048) as Float32Array<ArrayBuffer>;
    }
  }

  setAmount(amount: number): void {
    const a = clamp01(amount);
    const wasOff = this.amount <= 0.001;
    this.amount = a;
    const t = this.ctx.currentTime;
    if (a <= 0.001) {
      this.dryGain.gain.setTargetAtTime(1, t, 0.03);
      this.wetGain.gain.setTargetAtTime(0, t, 0.03);
      this.stopTimer();
      return;
    }
    this.dryGain.gain.setTargetAtTime(0, t, 0.03);
    this.wetGain.gain.setTargetAtTime(1, t, 0.03);
    this.comp.ratio.setTargetAtTime(8 + 12 * a, t, 0.05);
    if (wasOff) this.applyThreshold();
    if (this.analyser) this.startTimer();
    else this.applyThreshold(); // offline: static threshold from the amount
  }

  getAmount(): number {
    return this.amount;
  }

  /** Offline renders can't track program level — pin the threshold. */
  setStaticThresholdDb(db: number): void {
    this.comp.threshold.value = Math.max(-60, Math.min(0, db));
  }

  private applyThreshold(): void {
    // Headroom above program RMS: generous at low amounts (only wild spikes
    // clamp), tighter as the knob comes up. Crest factor of normal music is
    // ~12-18 dB, so we start above that.
    const headroom = 24 - 12 * this.amount;
    const thr = Math.max(-42, Math.min(-3, this.rmsDb + headroom));
    this.comp.threshold.setTargetAtTime(thr, this.ctx.currentTime, 0.1);
  }

  private startTimer(): void {
    if (this.timer !== null || typeof window === "undefined") return;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  private stopTimer(): void {
    if (this.timer === null || typeof window === "undefined") return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.analyser || !this.buf) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const db = 20 * Math.log10(Math.max(1e-5, rms));
    // Slow follower — the threshold shouldn't chase every phrase.
    this.rmsDb += (db - this.rmsDb) * 0.12;
    this.applyThreshold();
  }

  dispose(): void {
    this.stopTimer();
  }
}
