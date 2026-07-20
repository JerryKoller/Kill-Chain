/**
 * Dynamic de-esser using only stock Web Audio nodes.
 *
 * Topology:
 *   input → mainFilter (peaking 7kHz, gain mutable) → output
 *   input → sidechain bandpass (7kHz, Q=2) → analyser (envelope follow)
 *   A 50 Hz timer reads the sidechain RMS and ducks mainFilter.gain when
 *   it exceeds the threshold.
 *
 * Transparent when `amount` is 0 (mainFilter.gain stays at 0 dB).
 */
export class DeEsser {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly main: BiquadFilterNode;
  private readonly sideBand: BiquadFilterNode;
  private readonly sideAnalyser: AnalyserNode;

  private readonly ctx: BaseAudioContext;
  private amount = 0;
  private timer: number | null = null;
  private sampleBuf: Float32Array<ArrayBuffer>;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.main = ctx.createBiquadFilter();
    this.main.type = "peaking";
    this.main.frequency.value = 7000;
    this.main.Q.value = 1.5;
    this.main.gain.value = 0;

    this.input.connect(this.main).connect(this.output);

    this.sideBand = ctx.createBiquadFilter();
    this.sideBand.type = "bandpass";
    this.sideBand.frequency.value = 7000;
    this.sideBand.Q.value = 2.0;
    this.sideAnalyser = ctx.createAnalyser();
    this.sideAnalyser.fftSize = 1024;
    this.sideAnalyser.smoothingTimeConstant = 0.0;
    this.input.connect(this.sideBand).connect(this.sideAnalyser);

    this.sampleBuf = new Float32Array(this.sideAnalyser.fftSize) as Float32Array<ArrayBuffer>;
  }

  setAmount(a: number): void {
    const clamped = Math.max(0, Math.min(1, a));
    if (Math.abs(clamped - this.amount) < 1e-4) return;
    this.amount = clamped;
    if (clamped <= 0.001) {
      this.stopTimer();
      this.main.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      return;
    }
    this.startTimer();
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.sideAnalyser.getFloatTimeDomainData(this.sampleBuf);
    let sum = 0;
    for (let i = 0; i < this.sampleBuf.length; i++) {
      const v = this.sampleBuf[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.sampleBuf.length);
    // rms ~ 0..0.5 typical. Threshold scales with amount:
    //   amount 0 → threshold 1.0 (never triggers)
    //   amount 1 → threshold 0.04 (triggers often)
    const threshold = 0.6 - 0.55 * this.amount;
    const ratio = 3 + 8 * this.amount;
    const excess = Math.max(0, rms - threshold);
    const reduceDb = excess > 0
      ? -Math.min(18, ratio * 20 * excess)
      : 0;
    this.main.gain.setTargetAtTime(reduceDb, this.ctx.currentTime, 0.012);
  }

  dispose(): void {
    this.stopTimer();
    try { this.sideAnalyser.disconnect(); } catch { /* ignore */ }
    try { this.sideBand.disconnect(); } catch { /* ignore */ }
    try { this.main.disconnect(); } catch { /* ignore */ }
  }
}
