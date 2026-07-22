/**
 * offlineRestore — the Restoration Bay's batch processor.
 *
 * Renders whole FILES through the restoration chain faster than realtime
 * with an OfflineAudioContext, then encodes 16-bit WAV and writes results
 * into a folder the user picked (no per-file dialogs).
 *
 * Differences from the live chain, because offline rendering has no
 * wall-clock timers for the adaptive stages:
 *
 *   · DE-CLICK runs as a JS pre-pass on the decoded samples — real spike
 *     detection + interpolation across each click (better than the live
 *     clamp can ever be).
 *   · DE-HUM's 50/60 Hz base is detected up front (Goertzel probe on the
 *     decoded audio) and pinned on the offline DeHummer.
 *   · DE-CRUNCH / HISS use static filter approximations of their live
 *     dynamic behavior (a fixed cut scaled by the knob).
 *
 * HF rebuild, body and widen are graph-native and render identically.
 */

import { getEngine } from "@/audio/AudioEngine";
import { Reconstructor, type RestoreParams } from "@/audio/dsp/Reconstructor";
import { encodeWav, toBase64 } from "@/lib/fireStudio";
import { audioUrlForPath } from "@/state/libraryStore";

export interface BatchFileResult {
  path: string;
  outPath: string | null;
  error: string | null;
}

export interface BatchProgress {
  index: number;
  total: number;
  file: string;
  stage: "decoding" | "processing" | "rendering" | "writing";
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ── Analysis helpers ────────────────────────────────────────────────────────

/** Goertzel single-bin energy of `data` at `freq`. */
function goertzel(data: Float32Array, sampleRate: number, freq: number): number {
  const n = data.length;
  const k = Math.round((n * freq) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = data[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** Detect the mains-hum fundamental from decoded audio (first ~5 s). */
export function detectHumBase(buffer: AudioBuffer): 50 | 60 {
  const ch = buffer.getChannelData(0);
  const probe = ch.subarray(0, Math.min(ch.length, buffer.sampleRate * 5));
  const e50 = goertzel(probe, buffer.sampleRate, 50) + goertzel(probe, buffer.sampleRate, 100);
  const e60 = goertzel(probe, buffer.sampleRate, 60) + goertzel(probe, buffer.sampleRate, 120);
  return e50 > e60 ? 50 : 60;
}

// ── JS de-click pre-pass ────────────────────────────────────────────────────

/**
 * Find sample spikes towering over the local RMS and repair them by linear
 * interpolation across the spike. Operates in place, per channel.
 */
export function declickBuffer(buffer: AudioBuffer, amount: number): number {
  const a = clamp01(amount);
  if (a <= 0.001) return 0;
  const WIN = 1024;
  // Higher amount → lower spike ratio required (more aggressive repair).
  const ratio = 10 - 5 * a;
  let repaired = 0;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    let i = 0;
    while (i < data.length) {
      const end = Math.min(data.length, i + WIN);
      let sum = 0;
      for (let k = i; k < end; k++) sum += data[k] * data[k];
      const rms = Math.sqrt(sum / (end - i));
      const thr = Math.max(0.08, rms * ratio);
      if (rms > 1e-4) {
        for (let k = i; k < end; k++) {
          if (Math.abs(data[k]) <= thr) continue;
          // Found a spike — expand to the whole run above half-threshold.
          let s = k;
          while (s > i && Math.abs(data[s - 1]) > thr * 0.5) s--;
          let e = k;
          const hardEnd = Math.min(data.length - 1, k + 64);
          while (e < hardEnd && Math.abs(data[e + 1]) > thr * 0.5) e++;
          const from = s > 0 ? data[s - 1] : 0;
          const to = e < data.length - 1 ? data[e + 1] : 0;
          const span = e - s + 2;
          for (let m = s; m <= e; m++) {
            data[m] = from + ((to - from) * (m - s + 1)) / span;
          }
          repaired++;
          k = e;
        }
      }
      i = end;
    }
  }
  return repaired;
}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * Run one decoded buffer through the offline restoration graph and return
 * the rendered result.
 */
export async function renderRestore(
  buffer: AudioBuffer,
  params: RestoreParams,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const recon = new Reconstructor(ctx);
  // De-click already ran as the JS pre-pass; keep the live clamp out.
  recon.setParams({ ...params, declick: 0 });
  if (params.dehum > 0.001) recon.setHumBaseHz(detectHumBase(buffer));

  // Static stand-ins for the live dynamic de-crunch / hiss stages.
  let tail: AudioNode = recon.output;
  if (params.decrunch > 0.001) {
    const crunch = ctx.createBiquadFilter();
    crunch.type = "peaking";
    crunch.frequency.value = 3600;
    crunch.Q.value = 1.1;
    crunch.gain.value = -6 * params.decrunch;
    tail.connect(crunch);
    tail = crunch;
  }
  if (params.hiss > 0.001) {
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 9000;
    shelf.gain.value = -(3 + 6 * params.hiss);
    tail.connect(shelf);
    tail = shelf;
  }

  src.connect(recon.input);
  tail.connect(ctx.destination);
  src.start();
  try {
    return await ctx.startRendering();
  } finally {
    // Stop the adaptive watchdog timers (de-crunch/hiss, phase repair) that
    // would otherwise keep ticking against the finished offline context.
    recon.dispose();
  }
}

/** Peak-normalize DOWN only (protects against wet-path overs). */
function protectPeaks(rendered: AudioBuffer): void {
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const d = rendered.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak <= 0.999) return;
  const scale = 0.985 / peak;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const d = rendered.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= scale;
  }
}

// ── Batch driver ────────────────────────────────────────────────────────────

function outputNameFor(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? "output").replace(/\.[^.]+$/, "");
  return `${base}.restored.wav`;
}

/**
 * Process `files` through the restoration chain with `params`, writing
 * `<name>.restored.wav` files into `outDir`. Sequential on purpose — each
 * render already parallelizes internally and decoded buffers are huge.
 */
export async function runBatchRestore(
  files: string[],
  params: RestoreParams,
  outDir: string,
  onProgress?: (p: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchFileResult[]> {
  const writeIn = window.playground?.files?.writeIn;
  if (!writeIn) throw new Error("File writing unavailable outside Electron");

  const engine = getEngine();
  await engine.resume();
  const results: BatchFileResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    if (signal?.aborted) break;
    const report = (stage: BatchProgress["stage"]) =>
      onProgress?.({ index: i, total: files.length, file: path, stage });
    try {
      report("decoding");
      const resp = await fetch(audioUrlForPath(path));
      if (!resp.ok) throw new Error(`read failed (${resp.status})`);
      const bytes = await resp.arrayBuffer();
      const decoded = await engine.ctx.decodeAudioData(bytes);
      if (signal?.aborted) break;

      report("processing");
      declickBuffer(decoded, params.declick);

      report("rendering");
      const rendered = await renderRestore(decoded, params);
      if (signal?.aborted) break;
      protectPeaks(rendered);

      report("writing");
      const wav = encodeWav(
        rendered.getChannelData(0),
        rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0),
        rendered.sampleRate,
      );
      const outPath = await writeIn(outDir, outputNameFor(path), toBase64(wav));
      results.push({ path, outPath, error: outPath ? null : "write failed" });
    } catch (err) {
      results.push({
        path,
        outPath: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
