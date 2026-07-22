/**
 * DeHummer — mains-hum removal for the Restoration Bay.
 *
 * Ground loops and cheap capture gear stamp a 50 Hz (EU) or 60 Hz (US)
 * fundamental plus a ladder of harmonics onto recordings. A stack of narrow
 * peaking CUTS sits on the fundamental and its first four harmonics; depth
 * scales with the amount (up to -30 dB at the fundamental, shallower up the
 * ladder where music actually lives).
 *
 * AUTO-DETECT (realtime contexts only): a high-resolution analyser compares
 * the energy at 50 vs 60 Hz (and their 2nd harmonics) about twice a second
 * and retunes the stack when one side clearly wins. Offline renders call
 * `setBaseHz` explicitly instead.
 *
 * At amount 0 every filter sits at 0 dB — a transparent wire.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Cut depth (dB, positive) per harmonic at amount = 1. */
const HARMONIC_DEPTH = [30, 22, 16, 11, 7];
/** Q per harmonic — tight on the fundamental, looser up the ladder. */
const HARMONIC_Q = [24, 18, 14, 12, 10];

export class DeHummer {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly notches: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private freqBuf: Float32Array<ArrayBuffer> | null = null;
  private timer: number | null = null;

  private amount = 0;
  private baseHz: 50 | 60 = 60;
  private auto = true;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    let prev: AudioNode = this.input;
    for (let i = 0; i < HARMONIC_DEPTH.length; i++) {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = this.baseHz * (i + 1);
      f.Q.value = HARMONIC_Q[i];
      f.gain.value = 0;
      prev.connect(f);
      prev = f;
      this.notches.push(f);
    }
    prev.connect(this.output);
  }

  setAmount(amount: number): void {
    this.amount = clamp01(amount);
    this.applyGains();
    this.syncDetector();
  }

  getAmount(): number {
    return this.amount;
  }

  /** Pin the hum fundamental (disables auto-detection). Used offline. */
  setBaseHz(hz: 50 | 60): void {
    this.auto = false;
    this.retune(hz);
    this.syncDetector();
  }

  getBaseHz(): number {
    return this.baseHz;
  }

  private retune(hz: 50 | 60): void {
    if (hz === this.baseHz) return;
    this.baseHz = hz;
    const t = this.ctx.currentTime;
    this.notches.forEach((f, i) => {
      f.frequency.setTargetAtTime(hz * (i + 1), t, 0.05);
    });
  }

  private applyGains(): void {
    const t = this.ctx.currentTime;
    this.notches.forEach((f, i) => {
      f.gain.setTargetAtTime(-HARMONIC_DEPTH[i] * this.amount, t, 0.05);
    });
  }

  // ── Auto-detection (realtime only) ──
  private syncDetector(): void {
    const wantTimer =
      this.auto && this.amount > 0.001 && typeof window !== "undefined" &&
      // OfflineAudioContext renders faster than wall-clock; timers are useless there.
      !("startRendering" in this.ctx);
    if (wantTimer && this.timer === null) {
      if (!this.analyser) {
        // 32768-point FFT → ~1.5 Hz bins at 48 kHz: cleanly separates 50 / 60.
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 32768;
        this.analyser.smoothingTimeConstant = 0.5;
        this.freqBuf = new Float32Array(this.analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
        this.input.connect(this.analyser);
      }
      this.timer = window.setInterval(() => this.detect(), 600);
    } else if (!wantTimer && this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private energyAt(hz: number): number {
    if (!this.analyser || !this.freqBuf) return -180;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const k = Math.round(hz / binHz);
    let best = -180;
    for (let i = Math.max(1, k - 1); i <= k + 1 && i < this.freqBuf.length; i++) {
      if (this.freqBuf[i] > best) best = this.freqBuf[i];
    }
    return best;
  }

  private detect(): void {
    if (!this.analyser || !this.freqBuf) return;
    this.analyser.getFloatFrequencyData(this.freqBuf);
    // Fundamental + 2nd harmonic on each side; switch only on a clear win.
    const e50 = this.energyAt(50) + this.energyAt(100);
    const e60 = this.energyAt(60) + this.energyAt(120);
    if (e50 > e60 + 6 && this.baseHz !== 50) this.retune(50);
    else if (e60 > e50 + 6 && this.baseHz !== 60) this.retune(60);
  }

  dispose(): void {
    if (this.timer !== null && typeof window !== "undefined") {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
