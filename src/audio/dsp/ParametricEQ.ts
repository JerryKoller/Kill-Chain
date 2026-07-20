import type { ParametricBand } from "../types";

/**
 * ParametricEQ — chain of BiquadFilterNodes you can edit live.
 * Bands are addressed by id so the UI can drag nodes around freely.
 */
export class ParametricEQ {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly nodes = new Map<string, BiquadFilterNode>();
  private order: string[] = [];

  constructor(private readonly ctx: AudioContext, initial: ParametricBand[]) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.rebuild(initial);
  }

  rebuild(bands: ParametricBand[]): void {
    // Tear down
    this.input.disconnect();
    for (const n of this.nodes.values()) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.clear();
    this.order = [];

    if (bands.length === 0) {
      this.input.connect(this.output);
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
    }
    prev.connect(this.output);
  }

  updateBand(b: ParametricBand): void {
    const n = this.nodes.get(b.id);
    if (!n) return;
    const t = this.ctx.currentTime;
    n.type = b.type;
    n.frequency.setTargetAtTime(b.freq, t, 0.02);
    n.gain.setTargetAtTime(b.gain, t, 0.02);
    n.Q.setTargetAtTime(b.q, t, 0.02);
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
}
