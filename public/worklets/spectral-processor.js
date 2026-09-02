/**
 * kc-spectral — SpecOps-style STFT spectral effect for Fire Command (v1.7).
 *
 * Plain JavaScript on purpose: this file is served verbatim from public/ (dev)
 * and dist/worklets/ (packaged Electron, file://) and loaded with
 * ctx.audioWorklet.addModule("worklets/spectral-processor.js") — no bundler
 * transform involved, so it works identically in every build mode.
 *
 * DSP: 2048-point FFT, 4x overlap (hop 512), Hann analysis + synthesis
 * windows. Modes operate on the half-spectrum, the conjugate mirror is
 * rebuilt before the iFFT:
 *   freeze — capture a frame's complex spectrum and hold it, per-frame phase
 *            rotation keeps the held sound moving instead of buzzing.
 *   smear  — one-pole temporal magnitude average (reverb-like spectral wash).
 *   gate   — bins below an amount-scaled fraction of the frame peak are killed.
 *   shift  — rigid bin translation up/down (bipolar around amount 0.5).
 *
 * Dry/wet is mixed INSIDE the processor with a latency-matched dry tap:
 * every OLA contribution lands exactly FFT_SIZE samples after its input
 * sample entered the FIFO, so the dry ring delays by FFT_SIZE (2048 ≈ 43 ms
 * @ 48k) and the mix knob never combs against the STFT delay. The host graph
 * hard-switches around the node when the effect is off, so the synth has
 * zero added latency at spectralMode "off".
 */

const FFT_SIZE = 2048;
const HOP = FFT_SIZE / 4;
const LATENCY = FFT_SIZE - HOP;
const HALF = FFT_SIZE / 2;

const WINDOW = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  WINDOW[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
}
// Hann², 4x overlap: per-sample window-power sum is 1.5 — bake the inverse in.
const OLA_NORM = 1 / 1.5;

// ── radix-2 iterative FFT (module-scope tables) ──
const LEVELS = Math.log2(FFT_SIZE);
const COS = new Float32Array(HALF);
const SIN = new Float32Array(HALF);
for (let i = 0; i < HALF; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
  SIN[i] = Math.sin((2 * Math.PI * i) / FFT_SIZE);
}
const REV = new Uint32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let x = i, r = 0;
  for (let j = 0; j < LEVELS; j++) { r = (r << 1) | (x & 1); x >>= 1; }
  REV[i] = r;
}

function fft(re, im, inverse) {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const c = COS[k];
        const s = inverse ? SIN[k] : -SIN[k];
        const l = j + half;
        const tre = re[l] * c - im[l] * s;
        const tim = re[l] * s + im[l] * c;
        re[l] = re[j] - tre; im[l] = im[j] - tim;
        re[j] += tre; im[j] += tim;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < FFT_SIZE; i++) { re[i] /= FFT_SIZE; im[i] /= FFT_SIZE; }
  }
}

// Per-frame phase rotation for the freeze mode: advancing a held bin k by one
// hop is a rotation by 2π·k·HOP/FFT_SIZE.
const ROT_COS = new Float32Array(HALF + 1);
const ROT_SIN = new Float32Array(HALF + 1);
for (let k = 0; k <= HALF; k++) {
  const a = (2 * Math.PI * k * HOP) / FFT_SIZE;
  ROT_COS[k] = Math.cos(a);
  ROT_SIN[k] = Math.sin(a);
}

class ChannelState {
  constructor() {
    this.inFifo = new Float32Array(FFT_SIZE);
    this.outFifo = new Float32Array(HOP);
    // Dry tap: an OLA output sample surfaces exactly FFT_SIZE samples after
    // its input entered the FIFO, so the dry side needs the same delay.
    this.dryRing = new Float32Array(FFT_SIZE);
    this.dryPos = 0;
    this.accum = new Float32Array(FFT_SIZE);
    this.rover = LATENCY;
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);
    this.frozenRe = new Float32Array(HALF + 1);
    this.frozenIm = new Float32Array(HALF + 1);
    this.captured = false;
    this.avgMag = new Float32Array(HALF + 1);
    this.tmpRe = new Float32Array(HALF + 1);
    this.tmpIm = new Float32Array(HALF + 1);
  }
  reset() {
    this.inFifo.fill(0);
    this.outFifo.fill(0);
    this.dryRing.fill(0);
    this.dryPos = 0;
    this.accum.fill(0);
    this.rover = LATENCY;
    this.captured = false;
    this.avgMag.fill(0);
    this.frozenRe.fill(0);
    this.frozenIm.fill(0);
  }
}

class SpectralProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "off";
    this.amount = 0.6;
    this.mix = 0.5;
    this.bypass = true;
    this.eco = false;
    this.binLow = 0;
    this.binHigh = 1;
    this.ch = [new ChannelState(), new ChannelState()];
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.mode === "string" && d.mode !== this.mode) {
        this.mode = d.mode;
        for (const c of this.ch) { c.captured = false; c.avgMag.fill(0); }
      }
      if (typeof d.amount === "number") {
        if (this.mode === "freeze" && d.amount < 0.01 && this.amount >= 0.01) {
          for (const c of this.ch) c.captured = false;
        }
        this.amount = d.amount;
      }
      if (typeof d.mix === "number") this.mix = d.mix;
      if (typeof d.binLow === "number") this.binLow = Math.min(1, Math.max(0, d.binLow));
      if (typeof d.binHigh === "number") this.binHigh = Math.min(1, Math.max(0, d.binHigh));
      if (typeof d.eco === "boolean") this.eco = d.eco;
      if (typeof d.bypass === "boolean") {
        if (d.bypass && !this.bypass) for (const c of this.ch) c.reset();
        this.bypass = d.bypass;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const nCh = Math.min(output.length, 2);
    if (this.bypass || this.mode === "off") {
      for (let c = 0; c < nCh; c++) {
        const src = input[c] || input[0];
        if (src) output[c].set(src);
      }
      return true;
    }
    // Eco: one STFT on a mid sum, copy to both outs — ~½ the FFT work.
    if (this.eco && nCh >= 1) {
      const l = input[0] || null;
      const r = input[1] || l;
      const n = output[0].length;
      const mid = this._ecoMid || (this._ecoMid = new Float32Array(128));
      if (mid.length < n) this._ecoMid = new Float32Array(n);
      const m = this._ecoMid;
      for (let i = 0; i < n; i++) {
        const a = l ? l[i] : 0;
        const b = r ? r[i] : a;
        m[i] = (a + b) * 0.5;
      }
      this.runChannel(this.ch[0], m, output[0]);
      if (nCh > 1) output[1].set(output[0]);
      return true;
    }
    for (let c = 0; c < nCh; c++) {
      // Mono source into a stereo node: feed BOTH channel states from ch 0.
      // (This used to process silence on the right, halving the image.)
      this.runChannel(this.ch[c], input[c] || input[0] || null, output[c]);
    }
    return true;
  }

  runChannel(st, inArr, outArr) {
    const mix = this.mix;
    for (let i = 0; i < outArr.length; i++) {
      let x = inArr ? inArr[i] : 0;
      // NaN/Inf firewall: one poisoned sample entering the FIFO would put
      // NaN through the FFT into avgMag / accum, and the one-pole smear
      // average NEVER recovers from NaN — the wet path would output NaN
      // (silence at the DAC) forever. Range test is false for NaN.
      if (!(x > -1e6 && x < 1e6)) x = 0;
      const wet = st.outFifo[st.rover - LATENCY];
      const dry = st.dryRing[st.dryPos]; // x from exactly FFT_SIZE samples ago
      st.dryRing[st.dryPos] = x;
      st.dryPos = (st.dryPos + 1) % FFT_SIZE;
      outArr[i] = dry + (wet - dry) * mix;
      st.inFifo[st.rover] = x;
      st.rover++;
      if (st.rover >= FFT_SIZE) {
        st.rover = LATENCY;
        this.frame(st);
        // Belt-and-braces: if a frame still turned the accumulator non-finite
        // (e.g. a mode edge case), reset instead of latching silence forever.
        if (!Number.isFinite(st.accum[LATENCY]) || !Number.isFinite(st.avgMag[1])) {
          st.reset();
        }
      }
    }
  }

  frame(st) {
    const re = st.re, im = st.im;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = st.inFifo[i] * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im, false);

    const a = Math.min(1, Math.max(0, this.amount));
    const k0 = Math.max(0, Math.floor(Math.min(this.binLow, this.binHigh) * HALF));
    const k1 = Math.min(HALF, Math.ceil(Math.max(this.binLow, this.binHigh) * HALF));
    const inBand = (k) => k >= k0 && k <= k1;
    switch (this.mode) {
      case "freeze": {
        if (!st.captured) {
          let energy = 0;
          for (let k = 0; k <= HALF; k++) energy += re[k] * re[k] + im[k] * im[k];
          if (energy > 1e-6) {
            for (let k = 0; k <= HALF; k++) { st.frozenRe[k] = re[k]; st.frozenIm[k] = im[k]; }
            st.captured = true;
          }
        } else {
          for (let k = 0; k <= HALF; k++) {
            const fr = st.frozenRe[k], fi = st.frozenIm[k];
            st.frozenRe[k] = fr * ROT_COS[k] - fi * ROT_SIN[k];
            st.frozenIm[k] = fr * ROT_SIN[k] + fi * ROT_COS[k];
          }
        }
        for (let k = 0; k <= HALF; k++) {
          if (!inBand(k)) continue;
          re[k] = re[k] * (1 - a) + st.frozenRe[k] * a;
          im[k] = im[k] * (1 - a) + st.frozenIm[k] * a;
        }
        break;
      }
      case "smear": {
        const c = 0.995 * Math.pow(a, 0.3);
        // Quiet frame? Decay the held average toward 0 so a loud transient
        // can't keep inflating silent tails.
        let energy = 0;
        for (let k = 0; k <= HALF; k++) energy += re[k] * re[k] + im[k] * im[k];
        const hold = energy > 1e-6 ? 1 : 0.9;
        for (let k = 0; k <= HALF; k++) {
          if (!inBand(k)) continue;
          const mag = Math.hypot(re[k], im[k]);
          const avg = (st.avgMag[k] * c + mag * (1 - c)) * hold;
          st.avgMag[k] = avg;
          // Floor the denominator near the running average and cap the boost:
          // quiet bins after a loud frame get at most ×6, never ×1e4.
          const scale = Math.min(avg / Math.max(mag, avg * 0.05 + 1e-4), 6);
          re[k] *= scale;
          im[k] *= scale;
        }
        break;
      }
      case "gate": {
        let peak = 0;
        for (let k = 0; k <= HALF; k++) {
          if (!inBand(k)) continue;
          const mag = Math.hypot(re[k], im[k]);
          if (mag > peak) peak = mag;
        }
        const thr = peak * a * a * 0.7;
        for (let k = 0; k <= HALF; k++) {
          if (!inBand(k)) continue;
          if (Math.hypot(re[k], im[k]) < thr) { re[k] = 0; im[k] = 0; }
        }
        break;
      }
      case "shift": {
        const shift = Math.round((a * 2 - 1) * 96);
        if (shift !== 0) {
          st.tmpRe.fill(0);
          st.tmpIm.fill(0);
          for (let k = 1; k <= HALF; k++) {
            if (!inBand(k)) { st.tmpRe[k] = re[k]; st.tmpIm[k] = im[k]; continue; }
            const j = k + shift;
            if (j >= 1 && j <= HALF) { st.tmpRe[j] = re[k]; st.tmpIm[j] = im[k]; }
          }
          for (let k = 1; k <= HALF; k++) { re[k] = st.tmpRe[k]; im[k] = st.tmpIm[k]; }
        }
        break;
      }
      default:
        break;
    }

    // Real output: force the self-conjugate bins real, mirror the rest.
    im[0] = 0;
    im[HALF] = 0;
    for (let k = 1; k < HALF; k++) {
      re[FFT_SIZE - k] = re[k];
      im[FFT_SIZE - k] = -im[k];
    }
    fft(re, im, true);

    // Safety: hard-clamp each wet sample to ±1 before the OLA write so the
    // accumulator (and the emitted wet signal) can never hold huge values.
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = re[i] > 1 ? 1 : re[i] < -1 ? -1 : re[i];
      st.accum[i] += s * WINDOW[i] * OLA_NORM;
    }
    for (let i = 0; i < HOP; i++) st.outFifo[i] = st.accum[i];
    st.accum.copyWithin(0, HOP);
    st.accum.fill(0, FFT_SIZE - HOP);
    st.inFifo.copyWithin(0, HOP);
  }
}

registerProcessor("kc-spectral", SpectralProcessor);
