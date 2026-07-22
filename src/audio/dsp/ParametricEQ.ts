import type { ParametricBand } from "../types";

/**
 * ParametricEQ — chain of BiquadFilterNodes you can edit live.
 * Bands are addressed by id so the UI can drag nodes around freely.
 *
 * v2.1 additions:
 *   DYNAMIC BANDS  A band flagged `dynamic` gets a sidechain (bandpass →
 *     analyser) and its gain rides a 30 ms watchdog instead of sitting
 *     static: cuts only engage when the band flares above its own running
 *     average (de-esser style), boosts only fill in when the band dips
 *     below it. Steady content passes untouched.
 *   BYPASS  Crossfaded true bypass for the repair-stack A/B (click-safe).
 */

interface DynState {
  /** The audible filter whose gain the watchdog drives. */
  filter: BiquadFilterNode;
  side: BiquadFilterNode;
  an: AnalyserNode;
  /** Full user-dialled gain (dB) the dynamic ride scales toward. */
  targetDb: number;
  /** Running average of the band's share of the full signal. */
  avg: number;
}

export class ParametricEQ {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly nodes = new Map<string, BiquadFilterNode>();
  private order: string[] = [];

  private readonly directGain: GainNode;
  private readonly wetTail: GainNode;
  private bypassed = false;

  private readonly dyn = new Map<string, DynState>();
  private fullAnalyser: AnalyserNode | null = null;
  private dynTimer: number | null = null;
  private readonly dynBuf = new Float32Array(1024) as Float32Array<ArrayBuffer>;

  constructor(private readonly ctx: BaseAudioContext, initial: ParametricBand[]) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.directGain = ctx.createGain();
    this.directGain.gain.value = 0;
    this.wetTail = ctx.createGain();
    this.wetTail.gain.value = 1;
    this.input.connect(this.directGain).connect(this.output);
    this.wetTail.connect(this.output);
    this.rebuild(initial);
  }

  rebuild(bands: ParametricBand[]): void {
    // Tear down (the direct bypass wire + wetTail→output stay connected).
    this.input.disconnect();
    this.input.connect(this.directGain);
    for (const n of this.nodes.values()) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.clear();
    this.order = [];
    this.teardownDynamics();

    if (bands.length === 0) {
      this.input.connect(this.wetTail);
      return;
    }

    let prev: AudioNode = this.input;
    for (const b of bands) {
      const node = this.ctx.createBiquadFilter();
      node.type = b.type;
      node.frequency.value = b.freq;
      node.gain.value = b.gain;
      node.Q.value = b.q;
      prev.connect(node);
      prev = node;
      this.nodes.set(b.id, node);
      this.order.push(b.id);
      if (b.dynamic && isGainType(b.type)) {
        this.attachDynamic(b, node);
      }
    }
    prev.connect(this.wetTail);
    this.syncDynTimer();
  }

  updateBand(b: ParametricBand): void {
    const n = this.nodes.get(b.id);
    if (!n) return;
    const t = this.ctx.currentTime;
    n.type = b.type;
    n.frequency.setTargetAtTime(b.freq, t, 0.02);
    n.Q.setTargetAtTime(b.q, t, 0.02);
    const d = this.dyn.get(b.id);
    if (d) {
      // Keep the sidechain aimed at the band; the watchdog owns n.gain.
      d.targetDb = b.gain;
      d.side.frequency.setTargetAtTime(b.freq, t, 0.02);
      d.side.Q.setTargetAtTime(Math.max(0.5, b.q), t, 0.02);
    } else {
      n.gain.setTargetAtTime(b.gain, t, 0.02);
    }
  }

  /** v2.1 repair-stack A/B — crossfaded true bypass (click-safe). */
  setBypassed(b: boolean): void {
    if (this.bypassed === b) return;
    this.bypassed = b;
    const t = this.ctx.currentTime;
    this.directGain.gain.setTargetAtTime(b ? 1 : 0, t, 0.03);
    this.wetTail.gain.setTargetAtTime(b ? 0 : 1, t, 0.03);
  }

  /**
   * Compute magnitude response (dB) for given frequencies, summed across all bands.
   * Used for the EQ visualization curve.
   */
  computeResponse(freqs: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    const mag = new Float32Array(freqs.length);
    const phase = new Float32Array(freqs.length);
    const total = new Float32Array(freqs.length).fill(1);
    for (const id of this.order) {
      const n = this.nodes.get(id);
      if (!n) continue;
      n.getFrequencyResponse(freqs, mag, phase);
      for (let i = 0; i < freqs.length; i++) total[i] *= mag[i];
    }
    const db = new Float32Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      db[i] = 20 * Math.log10(Math.max(1e-6, total[i]));
    }
    return db;
  }

  // ── Dynamic bands ────────────────────────────────────────────────────────

  private attachDynamic(b: ParametricBand, filter: BiquadFilterNode): void {
    const side = this.ctx.createBiquadFilter();
    side.type = "bandpass";
    side.frequency.value = b.freq;
    side.Q.value = Math.max(0.5, b.q);
    const an = this.ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0;
    this.input.connect(side).connect(an);
    // The watchdog owns the gain — start from silence, ride toward target.
    filter.gain.value = 0;
    this.dyn.set(b.id, { filter, side, an, targetDb: b.gain, avg: 0 });
    if (!this.fullAnalyser) {
      this.fullAnalyser = this.ctx.createAnalyser();
      this.fullAnalyser.fftSize = 1024;
      this.fullAnalyser.smoothingTimeConstant = 0;
      this.input.connect(this.fullAnalyser);
    }
  }

  private teardownDynamics(): void {
    for (const d of this.dyn.values()) {
      try { d.side.disconnect(); } catch { /* ignore */ }
      try { d.an.disconnect(); } catch { /* ignore */ }
    }
    this.dyn.clear();
    if (this.fullAnalyser) {
      try { this.fullAnalyser.disconnect(); } catch { /* ignore */ }
      this.fullAnalyser = null;
    }
    this.syncDynTimer();
  }

  private syncDynTimer(): void {
    const want = this.dyn.size > 0 && typeof window !== "undefined";
    if (want && this.dynTimer === null) {
      this.dynTimer = window.setInterval(() => this.dynTick(), 30);
    } else if (!want && this.dynTimer !== null) {
      window.clearInterval(this.dynTimer);
      this.dynTimer = null;
    }
  }

  private rms(an: AnalyserNode): number {
    an.getFloatTimeDomainData(this.dynBuf);
    let sum = 0;
    for (let i = 0; i < this.dynBuf.length; i++) sum += this.dynBuf[i] * this.dynBuf[i];
    return Math.sqrt(sum / this.dynBuf.length);
  }

  private dynTick(): void {
    if (!this.fullAnalyser) return;
    const full = this.rms(this.fullAnalyser) + 1e-6;
    const t = this.ctx.currentTime;
    for (const d of this.dyn.values()) {
      const share = this.rms(d.an) / full;
      // Track the band's typical share; deviations drive the ride.
      d.avg += (share - d.avg) * 0.06;
      const ref = Math.max(1e-4, d.avg);
      const ratio = share / ref;
      let s: number;
      if (d.targetDb < 0) {
        // Cut: engage as the band flares above its usual level.
        s = Math.max(0, Math.min(1, (ratio - 1.1) * 1.6));
      } else {
        // Boost: fill in as the band falls below its usual level.
        s = Math.max(0, Math.min(1, (1 - ratio + 0.1) * 1.6));
      }
      d.filter.gain.setTargetAtTime(d.targetDb * s, t, 0.04);
    }
  }

  dispose(): void {
    this.teardownDynamics();
  }
}

function isGainType(t: BiquadFilterType): boolean {
  return t === "peaking" || t === "lowshelf" || t === "highshelf";
}
