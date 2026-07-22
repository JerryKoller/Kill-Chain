/**
 * restoreAnalyze — the Restoration Bay's "Auto-read".
 *
 * Listens to whatever is flowing through the engine for a few seconds and
 * measures the damage a lossy upload leaves behind:
 *
 *   · BRICKWALL CUTOFF — max-hold spectrum, scanned from the top down for
 *     where content actually stops. 240p-era encodes die at 10-14 kHz;
 *     the gap maps directly onto the HF-rebuild amount.
 *   · BODY DEFICIT — low band (70-160 Hz) level vs the mids; thin rips get
 *     body-rebuild suggested.
 *   · CRUNCH BUMP — energy piling up in 2.8-5.5 kHz above its neighbours
 *     (codec crunch / clipping harshness) maps onto de-crunch.
 *   · MAINS HUM (v2) — a 50 or 60 Hz spike (plus harmonics) sticking out of
 *     the low-end floor maps onto de-hum.
 *   · CLICKS (v2) — time-domain sample spikes far above each frame's RMS
 *     map onto de-click.
 *   · MONO SOURCE (v2) — near-perfect L/R correlation suggests the Widen
 *     (pseudo-stereo) knob.
 *
 * Returns suggested knob positions + human-readable notes, or null when
 * nothing audible passed through while listening.
 */

import { getEngine } from "@/audio/AudioEngine";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";

export interface RestoreSuggestion {
  params: Partial<RestoreParams>;
  cutoffHz: number | null;
  /** Detected mains-hum fundamental, if any. */
  humHz: 50 | 60 | null;
  /** True when the source measures essentially mono. */
  mono: boolean;
  notes: string[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export async function analyzeForRestore(
  seconds = 3,
  signal?: AbortSignal,
): Promise<RestoreSuggestion | null> {
  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 8192;
  an.smoothingTimeConstant = 0;
  engine.preTap.connect(an);

  // v2 taps: per-channel analysers for correlation (mono detection) and a
  // time-domain view for click counting.
  const splitter = ctx.createChannelSplitter(2);
  const anL = ctx.createAnalyser();
  const anR = ctx.createAnalyser();
  anL.fftSize = 2048;
  anR.fftSize = 2048;
  anL.smoothingTimeConstant = 0;
  anR.smoothingTimeConstant = 0;
  engine.preTap.connect(splitter);
  splitter.connect(anL, 0);
  splitter.connect(anR, 1);
  const bufL = new Float32Array(2048);
  const bufR = new Float32Array(2048);

  const bins = an.frequencyBinCount;
  const frame = new Float32Array(bins);
  const maxHold = new Float32Array(bins).fill(-180);
  const ticks = Math.max(10, Math.round((seconds * 1000) / 100));

  let corrSum = 0;
  let corrN = 0;
  let clickFrames = 0;
  let loudFrames = 0;
  // v2.1: clipping fingerprint — flat-top plateaus + starved crest factor.
  let plateauShare = 0;
  let crestSum = 0;

  try {
    for (let i = 0; i < ticks; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      an.getFloatFrequencyData(frame);
      for (let k = 0; k < bins; k++) {
        if (frame[k] > maxHold[k]) maxHold[k] = frame[k];
      }

      // Correlation + click scan on this tick's time-domain window.
      anL.getFloatTimeDomainData(bufL);
      anR.getFloatTimeDomainData(bufR);
      let dot = 0;
      let eL = 0;
      let eR = 0;
      let peak = 0;
      for (let k = 0; k < bufL.length; k++) {
        dot += bufL[k] * bufR[k];
        eL += bufL[k] * bufL[k];
        eR += bufR[k] * bufR[k];
        const a = Math.abs(bufL[k]);
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(eL / bufL.length);
      if (rms > 0.004) {
        loudFrames++;
        corrSum += dot / Math.sqrt(Math.max(1e-12, eL * eR));
        corrN++;
        // A frame whose peak towers over its own RMS carries a click/pop.
        if (peak > Math.max(0.1, rms * 7.5)) clickFrames++;
        // Clipping: samples camped on the frame's own peak plateau. A clean
        // waveform touches its peak once; a clipped one sits on it.
        let flat = 0;
        const lip = peak * 0.985;
        for (let k = 0; k < bufL.length; k++) {
          if (Math.abs(bufL[k]) >= lip) flat++;
        }
        plateauShare += flat / bufL.length;
        crestSum += 20 * Math.log10(Math.max(1.0001, peak / rms));
      }
    }
  } finally {
    try { engine.preTap.disconnect(an); } catch { /* ignore */ }
    try { engine.preTap.disconnect(splitter); } catch { /* ignore */ }
    try { an.disconnect(); } catch { /* ignore */ }
    try { splitter.disconnect(); } catch { /* ignore */ }
  }

  const binHz = ctx.sampleRate / an.fftSize;
  const levelAt = (lo: number, hi: number): number => {
    let sum = 0;
    let n = 0;
    const kLo = Math.max(1, Math.floor(lo / binHz));
    const kHi = Math.min(bins - 1, Math.ceil(hi / binHz));
    for (let k = kLo; k <= kHi; k++) {
      sum += maxHold[k];
      n++;
    }
    return n > 0 ? sum / n : -180;
  };

  // Reference: the PEAK bin in the mids. The AnalyserNode's Blackman window
  // leaks ~−58 dB sidelobes across the whole spectrum, so any threshold
  // deeper than ~50 dB below the peak just measures leakage, not content.
  let ref = -200;
  {
    const kLo = Math.max(1, Math.floor(400 / binHz));
    const kHi = Math.min(bins - 1, Math.ceil(5000 / binHz));
    for (let k = kLo; k <= kHi; k++) if (maxHold[k] > ref) ref = maxHold[k];
  }
  if (ref < -80) return null; // heard nothing usable

  // Brickwall cutoff: scan down from 20 kHz for sustained content within
  // 40 dB of the mid peak (3 consecutive bins so noise spikes don't lie).
  let cutoffHz: number | null = null;
  const kTop = Math.min(bins - 1, Math.ceil(20000 / binHz));
  const kFloor = Math.floor(4000 / binHz);
  let run = 0;
  for (let k = kTop; k >= kFloor; k--) {
    if (maxHold[k] > ref - 40) {
      run++;
      if (run >= 3) {
        cutoffHz = (k + 2) * binHz;
        break;
      }
    } else {
      run = 0;
    }
  }
  if (cutoffHz === null) cutoffHz = kFloor * binHz;

  const notes: string[] = [];
  const params: Partial<RestoreParams> = {};

  if (cutoffHz !== null && cutoffHz < 15500) {
    params.hf = clamp01(((15500 - cutoffHz) / 7500) * 0.9 + 0.15);
    if (cutoffHz < 8000) {
      notes.push(
        `Severely bandlimited — nothing above ${(cutoffHz / 1000).toFixed(1)} kHz. Full two-stage ladder: presence regen feeds the air regen.`,
      );
    } else {
      notes.push(`Top end stops near ${(cutoffHz / 1000).toFixed(1)} kHz — rebuilding the missing octave.`);
    }
  } else if (cutoffHz !== null) {
    notes.push("Full bandwidth present — no HF rebuild needed.");
  } else {
    notes.push("Couldn't find the top edge — content may be very dark; try HF rebuild by ear.");
  }

  const bassDeficit = levelAt(300, 1200) - levelAt(70, 160);
  if (bassDeficit > 6) {
    params.body = clamp01((bassDeficit - 6) / 10 + 0.2);
    notes.push("Thin low end — body rebuild adds harmonic weight.");
  }

  // Crunch = a 3-5 kHz bump STICKING OUT of an otherwise present top end.
  // A dark source rolling off through that region is not crunch — require
  // real content on the high side before flagging it.
  const hiSide = levelAt(7000, 10000);
  const crunchBump = levelAt(2800, 5500) - (levelAt(1000, 2000) + hiSide) / 2;
  if (crunchBump > 3 && hiSide > ref - 32) {
    params.decrunch = clamp01(((crunchBump - 3) / 6) * 0.6 + 0.2);
    notes.push("Harsh 3-5 kHz build-up (codec crunch) — dynamic de-crunch engaged.");
  }

  // ── v2: mains hum ──
  // A hum spike must tower over the neighbouring low-end floor. The floor is
  // read AROUND (not at) the candidate bins so the hum can't hide itself.
  let humHz: (50 | 60) | null = null;
  {
    const floor = (levelAt(30, 44) + levelAt(72, 92)) / 2;
    const at50 = levelAt(46, 54);
    const at60 = levelAt(56, 65);
    const spike50 = at50 - floor;
    const spike60 = at60 - floor;
    const best = Math.max(spike50, spike60);
    if (best > 14 && Math.max(at50, at60) > ref - 30) {
      humHz = spike50 >= spike60 ? 50 : 60;
      params.dehum = clamp01((best - 14) / 20 + 0.35);
      notes.push(`${humHz} Hz mains hum detected — notch ladder engaged.`);
    }
  }

  // ── v2: clicks / crackle ──
  if (loudFrames >= 5) {
    const clickShare = clickFrames / loudFrames;
    if (clickShare > 0.08) {
      params.declick = clamp01((clickShare - 0.08) / 0.3 + 0.25);
      notes.push("Pops / crackle detected — de-click clamp engaged.");
    }
  }

  // ── v2: mono source ──
  const mono = corrN >= 5 && corrSum / corrN > 0.985;
  if (mono) {
    notes.push("Source is mono (or near-mono) — try the Widen knob for synthesized stereo.");
  }

  // ── v2.1: hard clipping / crushed master ──
  if (loudFrames >= 5) {
    const flatAvg = plateauShare / loudFrames;
    const crestAvg = crestSum / loudFrames;
    if (flatAvg > 0.02 && crestAvg < 11) {
      params.declip = clamp01((flatAvg - 0.02) / 0.08 + (11 - crestAvg) / 12 + 0.2);
      notes.push("Flattened peaks (hard clipping / crushed master) — soft de-clip rounds them back out.");
    }
  }

  // ── v2.1: anti-phase stereo damage ──
  if (corrN >= 5) {
    const corrAvg = corrSum / corrN;
    if (corrAvg < -0.1) {
      params.phase = clamp01(-corrAvg * 0.8 + 0.25);
      notes.push("Anti-phase stereo image (cancels in mono) — phase repair anchors it.");
    }
  }

  if (Object.keys(params).length === 0) {
    notes.push("This source measures healthy — nothing to repair.");
  }

  return { params, cutoffHz, humHz, mono, notes };
}
