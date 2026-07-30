/**
 * kc-filter — Moog-ish ladder + SVF for Fire Command filter bite.
 *
 * Plain JS asset (same pattern as spectral-processor.js) loaded via
 * ctx.audioWorklet.addModule("worklets/filter-processor.js").
 *
 * Parameters:
 *   cutoff   — Hz
 *   resonance — 0..1 (mapped from host Q)
 *   drive    — 0..1 soft saturation into the ladder
 *   mode     — 0 = ladder LP4, 1 = SVF lowpass, 2 = SVF bandpass, 3 = SVF highpass
 *   typeHint — 0 LP / 1 BP / 2 HP / 3 notch (ladder uses LP4; SVF switches)
 */

class KcFilterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "cutoff", defaultValue: 1000, minValue: 20, maxValue: 20000, automationRate: "k-rate" },
      { name: "resonance", defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "drive", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mode", defaultValue: 0, minValue: 0, maxValue: 3, automationRate: "k-rate" },
      { name: "typeHint", defaultValue: 0, minValue: 0, maxValue: 3, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // Per-channel state (up to stereo) so L/R stay independent.
    // Ladder stages
    this.z1 = [0, 0]; this.z2 = [0, 0]; this.z3 = [0, 0]; this.z4 = [0, 0];
    // SVF state
    this.ic1 = [0, 0]; this.ic2 = [0, 0];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const chCount = Math.min(input.length, output.length);
    const cutoff = parameters.cutoff;
    const reso = parameters.resonance;
    const drive = parameters.drive;
    const mode = parameters.mode;
    const typeHint = parameters.typeHint;
    const cut0 = cutoff.length > 1 ? cutoff[0] : cutoff[0];
    const res0 = reso.length > 1 ? reso[0] : reso[0];
    const drv0 = drive.length > 1 ? drive[0] : drive[0];
    const mode0 = Math.round(mode.length > 1 ? mode[0] : mode[0]);
    const type0 = Math.round(typeHint.length > 1 ? typeHint[0] : typeHint[0]);

    const sr = sampleRate;
    const fc = Math.max(20, Math.min(sr * 0.45, cut0 || 1000));
    const g = Math.tan(Math.PI * fc / sr);
    // Softer reso map — host Q/14 already; keep k well below self-osc blowup.
    const k = Math.max(0, Math.min(0.92, (res0 || 0) * 0.9));
    const drv = Math.max(0, Math.min(1, drv0 || 0));
    // Pre-filter trim rises with resonance so bite ≠ clip.
    const inComp = 1 / (1 + k * 1.35);

    for (let ch = 0; ch < chCount; ch++) {
      const inp = input[ch];
      const out = output[ch];
      if (!inp || !out) continue;

      // Per-channel state: left/right run independent filter histories.
      const si = Math.min(ch, 1);
      let z1 = this.z1[si], z2 = this.z2[si], z3 = this.z3[si], z4 = this.z4[si];
      let ic1 = this.ic1[si], ic2 = this.ic2[si];

      for (let i = 0; i < out.length; i++) {
        let x = inp[i] * inComp;
        if (drv > 0.001) {
          const hot = x * (1 + drv * 1.8);
          x = Math.tanh(hot);
        }

        let y;
        if (mode0 === 0) {
          // 4-pole Moog-ish ladder (Huovilainen-lite)
          const f = g / (1 + g);
          const inputL = x - k * z4;
          z1 += 2 * f * (Math.tanh(inputL) - Math.tanh(z1));
          z2 += 2 * f * (Math.tanh(z1) - Math.tanh(z2));
          z3 += 2 * f * (Math.tanh(z2) - Math.tanh(z3));
          z4 += 2 * f * (Math.tanh(z3) - Math.tanh(z4));
          // Mild LP2/LP4 blend by type
          y = type0 === 1 ? (z2 - z4) : type0 === 2 ? (x - z4) : z4;
        } else {
          // Chamberlin / trapezoidal SVF
          const q = 1 - k * 0.9;
          const hp = (x - ic2) * (1 / (1 + g * (g + q))) - ic1 * (g / (1 + g * (g + q)));
          const bp = hp * g + ic1;
          const lp = bp * g + ic2;
          ic1 = bp + hp * g;
          ic2 = lp + bp * g;
          if (type0 === 1 || mode0 === 2) y = bp;
          else if (type0 === 2 || mode0 === 3) y = hp;
          else if (type0 === 3) y = x - 2 * bp; // notch-ish
          else y = lp;
        }
        // Soft-limit output + keep internal state finite.
        out[i] = Math.tanh(y);
      }

      const lim = (v) => (Number.isFinite(v) ? Math.max(-4, Math.min(4, v)) : 0);
      this.z1[si] = lim(z1); this.z2[si] = lim(z2); this.z3[si] = lim(z3); this.z4[si] = lim(z4);
      this.ic1[si] = lim(ic1); this.ic2[si] = lim(ic2);
    }
    return true;
  }
}

registerProcessor("kc-filter", KcFilterProcessor);
