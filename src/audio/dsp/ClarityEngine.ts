/**
 * ClarityEngine — one knob whose only job is CLEAN.
 *
 * Four small moves that together read as "someone wiped the glass":
 *
 *   MUD DUCK      A dynamic 180-450 Hz dip that only engages when that band
 *                 piles up (sidechain-driven, like a de-esser aimed at mud).
 *                 Static mud cuts thin the sound; dynamic ones just clean it.
 *   RUMBLE GATE   A gentle 24 Hz highpass — sub-sonic junk eats headroom
 *                 and smears everything above it.
 *   UNVEIL TILT   −1.6 dB shelf at 300 Hz and +1.4 dB shelf at 6.5 kHz at
 *                 full knob — the classic "remove the blanket" tilt, scaled.
 *   EDGE GUARD    A soft dynamic 3.8 kHz dip (¼ strength of the mud duck)
 *                 so the added top never turns harsh.
 *
 * `amount` 0 = a bit-transparent wire (all gains 0 dB, timer off).
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class ClarityEngine {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private amount = 0;

  private readonly rumble: BiquadFilterNode;
  private readonly mudFilter: BiquadFilterNode;
  private readonly loShelf: BiquadFilterNode;
  private readonly hiShelf: BiquadFilterNode;
  private readonly edgeFilter: BiquadFilterNode;

  private readonly mudSide: BiquadFilterNode;
  private readonly mudAnalyser: AnalyserNode;
  private readonly fullAnalyser: AnalyserNode;
  private readonly buf: Float32Array<ArrayBuffer>;
  private timer: number | null = null;

  /** v2.1 repair-stack A/B: crossfaded true bypass (click-safe). */
  private readonly directGain: GainNode;
  private readonly wetTail: GainNode;
  private bypassed = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.directGain = ctx.createGain();
    this.directGain.gain.value = 0;
    this.wetTail = ctx.createGain();
    this.wetTail.gain.value = 1;
    this.input.connect(this.directGain).connect(this.output);

    this.rumble = ctx.createBiquadFilter();
    this.rumble.type = "highpass";
    this.rumble.frequency.value = 5; // effectively open until engaged
    this.rumble.Q.value = Math.SQRT1_2;

    this.mudFilter = ctx.createBiquadFilter();
    this.mudFilter.type = "peaking";
    this.mudFilter.frequency.value = 290;
    this.mudFilter.Q.value = 0.9;
    this.mudFilter.gain.value = 0;

    this.loShelf = ctx.createBiquadFilter();
    this.loShelf.type = "lowshelf";
    this.loShelf.frequency.value = 300;
    this.loShelf.gain.value = 0;

    this.hiShelf = ctx.createBiquadFilter();
    this.hiShelf.type = "highshelf";
    this.hiShelf.frequency.value = 6500;
    this.hiShelf.gain.value = 0;

    this.edgeFilter = ctx.createBiquadFilter();
    this.edgeFilter.type = "peaking";
    this.edgeFilter.frequency.value = 3800;
    this.edgeFilter.Q.value = 1.3;
    this.edgeFilter.gain.value = 0;

    this.input
      .connect(this.rumble)
      .connect(this.mudFilter)
      .connect(this.loShelf)
      .connect(this.hiShelf)
      .connect(this.edgeFilter)
      .connect(this.wetTail)
      .connect(this.output);

    this.mudSide = ctx.createBiquadFilter();
    this.mudSide.type = "bandpass";
    this.mudSide.frequency.value = 290;
    this.mudSide.Q.value = 0.8;
    this.mudAnalyser = ctx.createAnalyser();
    this.mudAnalyser.fftSize = 1024;
    this.mudAnalyser.smoothingTimeConstant = 0;
    this.input.connect(this.mudSide).connect(this.mudAnalyser);

    this.fullAnalyser = ctx.createAnalyser();
    this.fullAnalyser.fftSize = 1024;
    this.fullAnalyser.smoothingTimeConstant = 0;
    this.input.connect(this.fullAnalyser);

    this.buf = new Float32Array(1024) as Float32Array<ArrayBuffer>;
  }

  setAmount(a: number): void {
    const amt = clamp01(a);
    if (Math.abs(amt - this.amount) < 1e-4) return;
    this.amount = amt;
    const t = this.ctx.currentTime;
    if (amt <= 0.001) {
      this.stopTimer();
      this.rumble.frequency.setTargetAtTime(5, t, 0.05);
      this.mudFilter.gain.setTargetAtTime(0, t, 0.05);
      this.loShelf.gain.setTargetAtTime(0, t, 0.05);
      this.hiShelf.gain.setTargetAtTime(0, t, 0.05);
      this.edgeFilter.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    this.rumble.frequency.setTargetAtTime(5 + amt * 21, t, 0.05); // → 26 Hz
    this.loShelf.gain.setTargetAtTime(-1.6 * amt, t, 0.05);
    this.hiShelf.gain.setTargetAtTime(1.4 * amt, t, 0.05);
    this.startTimer();
  }

  getAmount(): number {
    return this.amount;
  }

  /** v2.1 repair-stack A/B — crossfaded true bypass (click-safe). */
  setBypassed(b: boolean): void {
    if (this.bypassed === b) return;
    this.bypassed = b;
    const t = this.ctx.currentTime;
    this.directGain.gain.setTargetAtTime(b ? 1 : 0, t, 0.03);
    this.wetTail.gain.setTargetAtTime(b ? 0 : 1, t, 0.03);
  }

  private rms(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const t = this.ctx.currentTime;
    const amt = this.amount;
    const mud = this.rms(this.mudAnalyser);
    const full = this.rms(this.fullAnalyser) + 1e-6;
    // Duck the mud band only when it carries MORE than its fair share.
    const share = mud / full;
    const threshold = 0.42 - 0.12 * amt;
    const excess = Math.max(0, share - threshold);
    const cutDb = -Math.min(7, excess * (18 + 14 * amt) * (0.4 + full));
    this.mudFilter.gain.setTargetAtTime(cutDb * amt, t, 0.03);
    // Edge guard rides the same detector at quarter strength.
    this.edgeFilter.gain.setTargetAtTime(cutDb * amt * 0.25, t, 0.03);
  }

  dispose(): void {
    this.stopTimer();
  }
}
