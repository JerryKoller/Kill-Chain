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
      // cutoff + resonance are A-RATE: the host connects audio-rate sources
      // (LFO banks, filter envelope, mod matrix) straight to them. As k-rate
      // they were sampled once per 128-frame block, so ladder/SVF filters
      // stepped in ~2.7 ms stairs — an audible zipper on any LFO→cutoff patch,
      // while the biquad path modulated smoothly. Coefficients are refreshed
      // every COEF_STRIDE samples (see process), which is 16× finer than the
      // block rate and cheaper than the per-sample divisions this replaced.
      { name: "cutoff", defaultValue: 1000, minValue: 20, maxValue: 20000, automationRate: "a-rate" },
      { name: "resonance", defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "drive", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mode", defaultValue: 0, minValue: 0, maxValue: 3, automationRate: "k-rate" },
      { name: "typeHint", defaultValue: 0, minValue: 0, maxValue: 3, automationRate: "k-rate" },
      // True bypass. Opening the cutoff to 20 kHz still ran the full ladder /
      // SVF kernel per voice, so a patch with the filter module switched OFF
      // paid for filtering it couldn't hear.
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // Per-channel state (up to stereo) so L/R stay independent.
    // Ladder stages
    this.z1 = [0, 0]; this.z2 = [0, 0]; this.z3 = [0, 0]; this.z4 = [0, 0];
    // SVF state
    this.ic1 = [0, 0]; this.ic2 = [0, 0];
    // Pooled nodes are parked in bypass, so a fresh node's first engage is
    // also a 1 → 0 edge; start "bypassed" so that edge fires and zeroes.
    this.lastBypass = true;
    // LIFECYCLE: these nodes are POOLED by the synth (a bounded set created
    // once, checked out per voice, reset + returned on voice death). Two
    // failed designs inform this:
    //   1. per-voice nodes + `return true` forever → every note leaked an
    //      immortal DSP kernel; after enough play the render thread starved
    //      (progressive crackle → silence).
    //   2. per-voice nodes + returning false after disconnect → thousands of
    //      create/destroy cycles wedged Chromium's worklet thread; NEW
    //      processors stopped being instantiated and every ladder/SVF voice
    //      was born silent (measured live by the soak harness).
    // Pooling removes the churn entirely. process() must therefore ALWAYS
    // return true — pool nodes idle cheaply on the empty-input fast path.
    this.port.onmessage = (e) => {
      if (e.data && e.data.reset) {
        this.z1[0] = this.z1[1] = this.z2[0] = this.z2[1] = 0;
        this.z3[0] = this.z3[1] = this.z4[0] = this.z4[1] = 0;
        this.ic1[0] = this.ic1[1] = this.ic2[0] = this.ic2[1] = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    // Idle fast path (parked in pool / voice not started yet): no DSP.
    if (!input || !input[0] || !output || !output[0]) return true;

    const chCount = Math.min(input.length, output.length);
    const bypassNow = parameters.bypass[0] >= 0.5;
    // DETERMINISTIC RESET ON RE-ENGAGE. Pooled nodes are parked in bypass and
    // sent a { reset: true } message on release, but a message is only handled
    // at the audio thread's next quantum — so a voice that acquired a node and
    // started filtering inside that window could inherit the previous voice's
    // resonant ladder state and screech on onset. Zeroing here, on the
    // bypass 1 → 0 edge, happens on the audio thread and cannot be raced.
    if (this.lastBypass && !bypassNow) {
      this.z1[0] = this.z1[1] = this.z2[0] = this.z2[1] = 0;
      this.z3[0] = this.z3[1] = this.z4[0] = this.z4[1] = 0;
      this.ic1[0] = this.ic1[1] = this.ic2[0] = this.ic2[1] = 0;
    }
    this.lastBypass = bypassNow;
    // True bypass: straight copy, no filter math, states parked at zero so
    // re-engaging starts clean.
    if (bypassNow) {
      for (let ch = 0; ch < chCount; ch++) {
        const inp = input[ch];
        const out = output[ch];
        if (inp && out) out.set(inp);
      }
      this.z1[0] = this.z1[1] = this.z2[0] = this.z2[1] = 0;
      this.z3[0] = this.z3[1] = this.z4[0] = this.z4[1] = 0;
      this.ic1[0] = this.ic1[1] = this.ic2[0] = this.ic2[1] = 0;
      return true;
    }
    const cutoff = parameters.cutoff;
    const reso = parameters.resonance;
    const drive = parameters.drive;
    const mode = parameters.mode;
    const typeHint = parameters.typeHint;
    const drv0 = drive.length > 1 ? drive[0] : drive[0];
    const mode0 = Math.round(mode.length > 1 ? mode[0] : mode[0]);
    const type0 = Math.round(typeHint.length > 1 ? typeHint[0] : typeHint[0]);

    const sr = sampleRate;
    const nyq = sr * 0.45;
    const drv = Math.max(0, Math.min(1, drv0 || 0));
    // Coefficient refresh interval. 8 samples ≈ 0.17 ms at 48 kHz — well below
    // audibility for a cutoff sweep, and it hoists the SVF's two divisions out
    // of the per-sample path.
    const COEF_STRIDE = 8;
    const cutRate = cutoff.length > 1;
    const resRate = reso.length > 1;

    for (let ch = 0; ch < chCount; ch++) {
      const inp = input[ch];
      const out = output[ch];
      if (!inp || !out) continue;

      // Per-channel state: left/right run independent filter histories.
      const si = Math.min(ch, 1);
      let z1 = this.z1[si], z2 = this.z2[si], z3 = this.z3[si], z4 = this.z4[si];
      let ic1 = this.ic1[si], ic2 = this.ic2[si];

      // Coefficients, recomputed every COEF_STRIDE samples.
      let g = 0, f = 0, k = 0, inComp = 1, svfA = 0, svfB = 0;
      let nextCoefAt = -1;

      for (let i = 0; i < out.length; i++) {
        if (i >= nextCoefAt) {
          nextCoefAt = i + COEF_STRIDE;
          const cutV = cutRate ? cutoff[i] : cutoff[0];
          const resV = resRate ? reso[i] : reso[0];
          const fc = Math.max(20, Math.min(nyq, cutV || 1000));
          g = Math.tan(Math.PI * fc / sr);
          f = g / (1 + g);
          // Softer reso map — host Q/14 already; keep k well below self-osc blowup.
          k = Math.max(0, Math.min(0.92, (resV || 0) * 0.9));
          // Pre-filter trim rises with resonance so bite ≠ clip.
          inComp = 1 / (1 + k * 1.35);
          const q = 1 - k * 0.9;
          const denom = 1 / (1 + g * (g + q));
          svfA = denom;
          svfB = g * denom;
        }

        let x = inp[i];
        // NaN/Inf firewall: a poisoned sample would park NaN in the filter
        // states mid-block and smear a whole quantum before the block-end
        // scrub. The range test is false for NaN, so this catches both.
        if (!(x > -1e6 && x < 1e6)) x = 0;
        x *= inComp;
        if (drv > 0.001) {
          const hot = x * (1 + drv * 1.8);
          x = Math.tanh(hot);
        }

        let y;
        if (mode0 === 0) {
          // 4-pole Moog-ish ladder (Huovilainen-lite)
          const inputL = x - k * z4;
          z1 += 2 * f * (Math.tanh(inputL) - Math.tanh(z1));
          z2 += 2 * f * (Math.tanh(z1) - Math.tanh(z2));
          z3 += 2 * f * (Math.tanh(z2) - Math.tanh(z3));
          z4 += 2 * f * (Math.tanh(z3) - Math.tanh(z4));
          // Mild LP2/LP4 blend by type
          y = type0 === 1 ? (z2 - z4) : type0 === 2 ? (x - z4) : z4;
        } else {
          // Chamberlin / trapezoidal SVF
          const hp = (x - ic2) * svfA - ic1 * svfB;
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
