import { FRIENDLY_TO_EQ, getEngine, type FriendlyKey } from "./AudioEngine";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import type { SoundParams } from "./types";

/**
 * Analyze the first N seconds of the currently-playing track via the
 * engine's pre-EQ analyser, average the frequency response, and tilt the
 * 10-band friendly EQ so the spectrum approaches a target curve (pink
 * noise tilt at -3 dB / oct by default).
 *
 * Replaces the user's current tone params on success - issues a toast +
 * pushes to undo history via replaceParams().
 */
const SAMPLE_RATE_FALLBACK = 48000;

const BAND_FREQS: { key: keyof SoundParams; freq: number }[] = [
  { key: "subBass",  freq: 40 },
  { key: "bass",     freq: 90 },
  { key: "warmth",   freq: 180 },
  { key: "body",     freq: 350 },
  { key: "mid",      freq: 700 },
  { key: "vocals",   freq: 1500 },
  { key: "presence", freq: 3000 },
  { key: "clarity",  freq: 5500 },
  { key: "air",      freq: 10000 },
  { key: "sparkle",  freq: 15000 },
];

const ANALYSIS_SEC = 8;
const SAMPLE_INTERVAL_MS = 100;

export async function autoFlatten(signal?: AbortSignal): Promise<void> {
  const engine = getEngine();
  // A suspended context produces silent analyser frames — the run would just
  // end in "not enough signal" 8 seconds later.
  await engine.resume();
  const analyser = engine.analyserPre;
  const sr = engine.ctx.sampleRate || SAMPLE_RATE_FALLBACK;
  const bins = analyser.frequencyBinCount;
  const buf = new Uint8Array(bins);

  const samples: number[][] = [];
  const start = performance.now();

  return new Promise((resolve) => {
    const id = window.setInterval(() => {
      // Source changed / view closed: stop sampling instead of applying a
      // correction measured against a track that's no longer playing.
      if (signal?.aborted) {
        window.clearInterval(id);
        resolve();
        return;
      }
      analyser.getByteFrequencyData(buf);
      // Snapshot only if signal is present (avoid biasing toward silence).
      let any = 0;
      for (let i = 0; i < bins; i++) if (buf[i] > 6) any++;
      if (any > bins * 0.05) {
        const arr: number[] = new Array(bins);
        for (let i = 0; i < bins; i++) arr[i] = buf[i];
        samples.push(arr);
      }
      if (performance.now() - start > ANALYSIS_SEC * 1000) {
        window.clearInterval(id);
        try {
          if (samples.length < 8) {
            useUIStore.getState().toast("Auto-flatten: not enough signal");
            return;
          }
          const avg = new Float32Array(bins);
          for (const s of samples) {
            for (let i = 0; i < bins; i++) avg[i] += s[i];
          }
          for (let i = 0; i < bins; i++) avg[i] /= samples.length;
          const tiltDb = computeTilt(avg, sr, analyser);
          const cur = useAudioStore.getState().params;
          const next: SoundParams = { ...cur };
          for (const b of BAND_FREQS) {
            // Scale the suggested correction by the band's REAL maxDb (4-6 dB
            // varies per band) so a given dB residual lands on the right
            // slider position for every band.
            const maxDb = FRIENDLY_TO_EQ[b.key as FriendlyKey]?.maxDb ?? 5;
            const delta = tiltDb[b.key] / maxDb;
            // Clamp final position to [-0.7, 0.7] to avoid extreme suggestions.
            const raw = (cur[b.key] || 0) + delta * 0.6;
            next[b.key] = Math.max(-0.7, Math.min(0.7, raw));
          }
          useAudioStore.getState().replaceParams(next);
          useUIStore.getState().toast("Auto-flatten applied (undo with Z)");
        } finally {
          resolve();
        }
      }
    }, SAMPLE_INTERVAL_MS);
  });
}

function computeTilt(
  avg: Float32Array,
  sampleRate: number,
  analyser: AnalyserNode,
): Record<string, number> {
  const bins = avg.length;
  const nyquist = sampleRate / 2;
  // Convert each band centre Hz → bin index, sample +/- ~30% around it.
  const out: Record<string, number> = {};

  // Target curve: pink noise (-3 dB / octave starting from 1 kHz @ 0 dB).
  // We compute the deviation of each band from its target value, then a
  // negative correction goes the opposite direction.
  const target = (freq: number) => {
    const oct = Math.log2(freq / 1000);
    return -3 * oct;
  };

  // Byte → dB using the analyser's REAL mapping. The default AnalyserNode
  // range is minDecibels −100 to maxDecibels −30, so the old "(v/255)*100−100"
  // guess compressed every reading by ~30% and skewed the tilt.
  const minDb = analyser.minDecibels;
  const maxDb = analyser.maxDecibels;
  const byteToDb = (v: number) => (v / 255) * (maxDb - minDb) + minDb;

  // Overall average reference (mid band region).
  let refSum = 0;
  let refN = 0;
  for (let i = 0; i < bins; i++) {
    const freq = (i / bins) * nyquist;
    if (freq >= 200 && freq <= 5000) {
      refSum += byteToDb(avg[i]);
      refN += 1;
    }
  }
  const refDb = refN > 0 ? refSum / refN : -40;

  for (const b of BAND_FREQS) {
    const loF = b.freq * 0.7;
    const hiF = b.freq * 1.43;
    let s = 0;
    let n = 0;
    for (let i = 0; i < bins; i++) {
      const freq = (i / bins) * nyquist;
      if (freq >= loF && freq <= hiF) {
        s += byteToDb(avg[i]);
        n += 1;
      }
    }
    const measured = n > 0 ? s / n : refDb;
    const expected = refDb + target(b.freq) - target(1000);
    // If band is louder than expected, suggest a negative correction;
    // if quieter, suggest a positive one.
    out[b.key] = expected - measured;
  }
  return out;
}
