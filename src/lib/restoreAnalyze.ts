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
 *
 * Returns suggested knob positions + human-readable notes, or null when
 * nothing audible passed through while listening.
 */

import { getEngine } from "@/audio/AudioEngine";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";

export interface RestoreSuggestion {
  params: Partial<RestoreParams>;
  cutoffHz: number | null;
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

  const bins = an.frequencyBinCount;
  const frame = new Float32Array(bins);
  const maxHold = new Float32Array(bins).fill(-180);
  const ticks = Math.max(10, Math.round((seconds * 1000) / 100));

  try {
    for (let i = 0; i < ticks; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      an.getFloatFrequencyData(frame);
      for (let k = 0; k < bins; k++) {
        if (frame[k] > maxHold[k]) maxHold[k] = frame[k];
      }
    }
  } finally {
    try { engine.preTap.disconnect(an); } catch { /* ignore */ }
    try { an.disconnect(); } catch { /* ignore */ }
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

  if (Object.keys(params).length === 0) {
    notes.push("This source measures healthy — nothing to repair.");
  }

  return { params, cutoffHz, notes };
}
