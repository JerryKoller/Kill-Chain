/**
 * tractorLive — Tractor Beam's LIVE measurement path.
 *
 * The offline analyzer needs a decodable file; this listens to whatever is
 * actually flowing through the engine right now (local track, Exterior Audio,
 * an Airspace movie) and builds the SAME {@link TractorMeasurement} shape by
 * averaging the pre-FX spectrum for a number of seconds:
 *
 *   engine.preTap ─ AnalyserNode (float FFT, no smoothing) → power average
 *              └─ splitter → L/R analysers → correlation + RMS/crest stats
 *
 * Everything is a parallel tap — the audible path is untouched — and all
 * nodes are disconnected when the capture ends or is cancelled.
 */

import { getEngine } from "@/audio/AudioEngine";
import { bandEnergyShare, type TractorMeasurement, type TractorProgress } from "@/lib/tractorBeam";

const FFT_SIZE = 8192;
const TICK_MS = 120;
/** A tick's max byte-RMS must clear this to count as signal. */
const LIVE_GATE_RMS = 0.004;

const THIRD_OCT = Math.pow(2, 1 / 3);
const HALF_BAND = Math.pow(2, 1 / 6);

function buildCenters(sr: number): number[] {
  const out: number[] = [];
  for (let f = 25; f <= 16000 * 1.001; f *= THIRD_OCT) {
    if (f < sr * 0.45) out.push(Math.round(f));
  }
  return out;
}

export interface LiveMeasureOptions {
  /** Listening time in seconds (default 20). */
  seconds?: number;
  signal?: AbortSignal;
  onProgress?: (p: TractorProgress) => void;
}

/**
 * Listen to the engine's source signal for `seconds` and fold it into a
 * TractorMeasurement. Throws AbortError on cancel. The measurement is marked
 * silent when nothing audible passed through while listening.
 */
export async function measureLive(opts: LiveMeasureOptions = {}): Promise<TractorMeasurement> {
  const seconds = Math.max(5, Math.min(60, opts.seconds ?? 20));
  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;
  const sr = ctx.sampleRate;

  // Spectrum tap (mono sum of the source bus).
  const an = ctx.createAnalyser();
  an.fftSize = FFT_SIZE;
  an.smoothingTimeConstant = 0; // we average ourselves, in power
  // Per-ear taps for correlation + level stats.
  const split = ctx.createChannelSplitter(2);
  const anL = ctx.createAnalyser();
  const anR = ctx.createAnalyser();
  anL.fftSize = 2048;
  anR.fftSize = 2048;
  anL.smoothingTimeConstant = 0;
  anR.smoothingTimeConstant = 0;

  engine.preTap.connect(an);
  engine.preTap.connect(split);
  split.connect(anL, 0);
  split.connect(anR, 1);

  const freqDb = new Float32Array(an.frequencyBinCount);
  const timeL = new Float32Array(anL.fftSize);
  const timeR = new Float32Array(anR.fftSize);
  const powerAvg = new Float64Array(an.frequencyBinCount);

  let used = 0;
  let crestSum = 0;
  let loudSum = 0;
  let loudSqSum = 0;
  let corrLL = 0;
  let corrRR = 0;
  let corrLR = 0;

  const cleanup = () => {
    try { engine.preTap.disconnect(an); } catch { /* already gone */ }
    try { engine.preTap.disconnect(split); } catch { /* already gone */ }
    try { an.disconnect(); } catch { /* ignore */ }
    try { split.disconnect(); } catch { /* ignore */ }
    try { anL.disconnect(); } catch { /* ignore */ }
    try { anR.disconnect(); } catch { /* ignore */ }
  };

  const totalTicks = Math.ceil((seconds * 1000) / TICK_MS);

  try {
    for (let tick = 0; tick < totalTicks; tick++) {
      await new Promise<void>((r) => setTimeout(r, TICK_MS));
      if (opts.signal?.aborted) {
        throw new DOMException("Live lock cancelled", "AbortError");
      }

      anL.getFloatTimeDomainData(timeL);
      anR.getFloatTimeDomainData(timeR);
      let sumSq = 0;
      let peak = 0;
      let ll = 0;
      let rr = 0;
      let lr = 0;
      for (let i = 0; i < timeL.length; i++) {
        const l = timeL[i];
        const r = timeR[i];
        const mono = (l + r) * 0.5;
        sumSq += mono * mono;
        const a = Math.abs(mono);
        if (a > peak) peak = a;
        ll += l * l;
        rr += r * r;
        lr += l * r;
      }
      const rms = Math.sqrt(sumSq / timeL.length);

      opts.onProgress?.({
        stage: rms >= LIVE_GATE_RMS ? "Listening…" : "Waiting for signal…",
        fraction: tick / totalTicks,
      });

      if (rms < LIVE_GATE_RMS) continue; // silence — don't average it in

      an.getFloatFrequencyData(freqDb);
      for (let k = 0; k < freqDb.length; k++) {
        const db = freqDb[k];
        if (db > -180 && Number.isFinite(db)) {
          powerAvg[k] += Math.pow(10, db / 10);
        }
      }
      const loudDb = 20 * Math.log10(rms + 1e-9);
      loudSum += loudDb;
      loudSqSum += loudDb * loudDb;
      if (peak > 0) crestSum += 20 * Math.log10(peak / rms);
      corrLL += ll;
      corrRR += rr;
      corrLR += lr;
      used++;
    }
  } finally {
    cleanup();
  }

  const centers = buildCenters(sr);
  if (used < 8) {
    // Under ~1 s of audible signal — not enough to trust.
    return {
      sampleRate: sr,
      analyzedSec: seconds,
      windowsUsed: 0,
      centers,
      levelsDb: centers.map(() => 0),
      silent: true,
    };
  }

  for (let k = 0; k < powerAvg.length; k++) powerAvg[k] /= used;

  // Fold FFT bins into 1/3-octave bands (bin spacing = sr / fftSize).
  const binHz = sr / FFT_SIZE;
  const levelsDb = centers.map((freq) => {
    const lo = freq / HALF_BAND;
    const hi = freq * HALF_BAND;
    let kLo = Math.max(1, Math.floor(lo / binHz));
    const kHi = Math.min(powerAvg.length - 1, Math.ceil(hi / binHz));
    if (kLo > kHi) kLo = kHi;
    let sum = 0;
    for (let k = kLo; k <= kHi; k++) sum += powerAvg[k];
    return 10 * Math.log10(sum + 1e-12);
  });

  const mean = loudSum / used;
  const dynRangeDb = Math.sqrt(Math.max(0, loudSqSum / used - mean * mean));
  const stereoCorr =
    corrLL > 1e-9 && corrRR > 1e-9 ? corrLR / Math.sqrt(corrLL * corrRR) : null;

  return {
    sampleRate: sr,
    analyzedSec: (used * TICK_MS) / 1000,
    windowsUsed: used,
    centers,
    levelsDb,
    silent: false,
    crestDb: crestSum / used,
    dynRangeDb,
    stereoCorr,
    bassShare: bandEnergyShare(centers, levelsDb, 0, 150),
    speechShare: bandEnergyShare(centers, levelsDb, 300, 3400),
    airShare: bandEnergyShare(centers, levelsDb, 7000, 24000),
  };
}
