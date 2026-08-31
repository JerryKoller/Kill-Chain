/**
 * kc-limiter — stereo-linked lookahead brickwall limiter for the Fire bus.
 *
 * Plain JS asset (same pattern as filter-processor.js) loaded via
 * ctx.audioWorklet.addModule("worklets/limiter-processor.js").
 *
 * WHY THIS EXISTS: the Fire master "limiter" used to be a DynamicsCompressor.
 * Chromium's DynamicsCompressor applies AUTOMATIC makeup gain, a ~6 ms fixed
 * lookahead delay, an adaptive release that pumps on program material, and a
 * gain-reduction envelope that can stay pinned after extreme input. Stacked
 * on the synth's own soft-clip stages the result read as "washed out,
 * non-responsive, then crunchy when pushed". This is a plain transparent
 * peak limiter instead:
 *
 *   - true lookahead (2.5 ms delay line): gain is already down when the
 *     peak emerges, so NOTHING overshoots the ceiling — the downstream
 *     safety clipper stays in its bit-exact identity region.
 *   - no makeup gain of any kind: quiet material passes bit-identical.
 *   - stereo-linked: no image wander when one channel clips.
 *   - fixed exponential release (param), no adaptive pumping, and the state
 *     fully recovers the moment input drops — nothing to "flush".
 *
 * Parameters:
 *   ceiling — linear output ceiling (default 0.84, just under the safety
 *             clipper's 0.85 identity knee)
 *   release — seconds to recover ~63% toward unity (default 0.09)
 *   bypass  — 1 = pass the (still delayed) signal with unity gain, so
 *             toggling never clicks or shifts timing
 *
 * Port messages: posts { gr: <max dB of gain reduction since last post> }
 * every ~50 ms while reducing (the mixer's "LIM" readout).
 */

class KcLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ceiling", defaultValue: 0.84, minValue: 0.1, maxValue: 1.0, automationRate: "k-rate" },
      { name: "release", defaultValue: 0.09, minValue: 0.01, maxValue: 1.0, automationRate: "k-rate" },
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.la = Math.max(8, Math.round(sampleRate * 0.0025)); // 2.5 ms lookahead
    this.bufL = new Float32Array(this.la);
    this.bufR = new Float32Array(this.la);
    this.w = 0;          // write index into the circular delay line
    this.gain = 1;       // current smoothed gain (1 = transparent)
    this.grMaxDb = 0;    // deepest reduction since the last port post
    this.sinceReport = 0;
    this.reportEvery = Math.round(sampleRate * 0.05); // ~50 ms
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outL = output[0];
    const outR = output[1] ?? output[0];
    const n = outL.length;

    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;

    const ceiling = parameters.ceiling[0];
    const release = parameters.release[0];
    const bypassed = parameters.bypass[0] >= 0.5;
    // Per-sample exponential recovery coefficient toward 1.
    const rel = 1 - Math.exp(-1 / (Math.max(0.01, release) * sampleRate));

    for (let i = 0; i < n; i++) {
      let l = inL ? inL[i] : 0;
      let r = inR ? inR[i] : 0;
      // NaN/Inf firewall — this node feeds the DAC, so a poisoned upstream
      // sample must never write NaN into the delay line or the output.
      // (The range test is false for NaN, catching both.)
      if (!(l > -1e6 && l < 1e6)) l = 0;
      if (!(r > -1e6 && r < 1e6)) r = 0;

      // Gain need for the sample ENTERING the delay line. Because the audio
      // is delayed by `la` samples and the gain envelope moves NOW, the
      // reduction is fully in place by the time the peak emerges (attack
      // time = lookahead, zero overshoot).
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const need = peak > ceiling ? ceiling / peak : 1;
      if (need < this.gain) this.gain = need;        // instant attack
      else this.gain += (1 - this.gain) * rel;       // smooth release

      // Delayed read → apply gain.
      const ro = this.w;
      const dl = this.bufL[ro];
      const dr = this.bufR[ro];
      this.bufL[this.w] = l;
      this.bufR[this.w] = r;
      this.w = (this.w + 1) % this.la;

      const g = bypassed ? 1 : this.gain;
      outL[i] = dl * g;
      if (outR !== outL) outR[i] = dr * g;

      if (g < 1) {
        const db = -20 * Math.log10(Math.max(1e-4, g));
        if (db > this.grMaxDb) this.grMaxDb = db;
      }
    }

    this.sinceReport += n;
    if (this.sinceReport >= this.reportEvery) {
      this.sinceReport = 0;
      if (this.grMaxDb > 0.01) {
        this.port.postMessage({ gr: this.grMaxDb });
        this.grMaxDb = 0;
      } else {
        this.port.postMessage({ gr: 0 });
      }
    }
    return true;
  }
}

registerProcessor("kc-limiter", KcLimiterProcessor);
