/**
 * TARGET LOCK — reference-match analysis for the Sculptor (v2.1).
 *
 * Two inputs, one verdict:
 *
 *   SOURCE   whatever is flowing through the engine right now (a damaged
 *            rip, a muffled upload) — measured live off preTap with the
 *            same Welch pipeline Tractor Beam uses.
 *   TARGET   a clean reference the user loads from disk — measured offline
 *            with measureTrack().
 *
 * deriveTargetLock() measures the spectral gap between them and splits the
 * repair across the tools that do each job best:
 *
 *   · EQ curve for tonal-balance differences (clamped, level-trimmed).
 *   · HF Rebuild instead of EQ boost above the source's brickwall cutoff —
 *     you cannot EQ-boost content that isn't there.
 *   · Body / De-crunch / Clarity for the classic damage signatures.
 *   · Width / De-ess master moves when the stereo image or sibilance
 *     measurably diverges from the reference.
 *
 * The result carries before / predicted-after match percentages computed
 * with the same loudness-weighted RMS Tractor Beam reports, so the numbers
 * read consistently across the app.
 */

import { getEngine } from "@/audio/AudioEngine";
import {
  perceptualWeight,
  sampleCurveDb,
  type CurvePoint,
  type TractorMeasurement,
} from "@/lib/tractorBeam";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";
import type { SoundParams } from "@/audio/types";
import { measureTrack } from "@/lib/tractorBeam";
import { audioUrlForPath } from "@/state/libraryStore";

export interface TargetReference {
  /** Display name (file name). */
  name: string;
  m: TractorMeasurement;
}

export interface TargetLockMove {
  id: "eq" | "hf" | "body" | "decrunch" | "clarity" | "width" | "deess";
  label: string;
  detail: string;
}

export interface TargetLockPlan {
  /** Suggested Sculptor EQ curve (sample with sampleCurveDb). Empty = no EQ move. */
  curve: CurvePoint[];
  restore: Partial<RestoreParams>;
  /** Suggested Clarity amount (0 = leave alone). */
  clarity: number;
  /** Suggested SoundParams.width move (null = leave alone). */
  width: number | null;
  /** Suggested SoundParams.deEss move (null = leave alone). */
  deEss: number | null;
  matchBeforePct: number;
  matchAfterPct: number;
  srcCutoffHz: number | null;
  refCutoffHz: number | null;
  /** One row per suggested move — render as the explainable checklist. */
  moves: TargetLockMove[];
  silent: boolean;
}

const BOOST_CLAMP = 6;
const CUT_CLAMP = 9;
const MATCH_FLOOR_DB = 6;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const finite = (x: number) => (Number.isFinite(x) ? x : 0);

/** Pick + decode + measure a reference file from disk. Null on cancel. */
export async function loadReferenceFile(
  onProgress?: (p: { stage: string; fraction: number }) => void,
): Promise<TargetReference | null> {
  const files = window.playground?.files;
  if (!files?.openAudioMulti) return null;
  const picked = await files.openAudioMulti();
  if (!picked || picked.length === 0) return null;
  const path = picked[0];
  onProgress?.({ stage: "Decoding reference…", fraction: 0.1 });
  const engine = getEngine();
  await engine.resume();
  const resp = await fetch(audioUrlForPath(path));
  if (!resp.ok) throw new Error(`Couldn't read the reference (${resp.status})`);
  const bytes = await resp.arrayBuffer();
  const decoded = await engine.ctx.decodeAudioData(bytes);
  const m = await measureTrack(decoded, {
    onProgress: (p) => onProgress?.({ stage: p.stage, fraction: 0.1 + p.fraction * 0.9 }),
  });
  const name = path.split(/[\\/]/).pop() ?? "reference";
  return { name, m };
}

/** Highest 1/3-oct centre still carrying content within `windowDb` of peak. */
function measureCutoff(m: TractorMeasurement, windowDb = 38): number | null {
  if (m.silent) return null;
  const max = Math.max(...m.levelsDb);
  for (let i = m.centers.length - 1; i >= 0; i--) {
    if (m.centers[i] < 3000) break;
    if (m.levelsDb[i] > max - windowDb) return m.centers[i];
  }
  return 3000;
}

/** Average of `vals[i]` over centers within [lo, hi] Hz. */
function bandAvg(centers: number[], vals: number[], lo: number, hi: number): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < centers.length; i++) {
    if (centers[i] >= lo && centers[i] <= hi) {
      s += vals[i];
      n++;
    }
  }
  return n > 0 ? s / n : 0;
}

/**
 * Measure the gap between a live SOURCE and a loaded TARGET reference and
 * derive an explainable repair plan. Pure and instant — re-run freely.
 */
export function deriveTargetLock(
  src: TractorMeasurement,
  ref: TractorMeasurement,
): TargetLockPlan {
  const empty: TargetLockPlan = {
    curve: [],
    restore: {},
    clarity: 0,
    width: null,
    deEss: null,
    matchBeforePct: 0,
    matchAfterPct: 0,
    srcCutoffHz: null,
    refCutoffHz: null,
    moves: [],
    silent: true,
  };
  if (src.silent || ref.silent) return empty;

  // Common band set: both ladders start at 25 Hz with 1/3-oct steps, so the
  // shorter list is a prefix of the longer.
  const n = Math.min(src.centers.length, ref.centers.length);
  if (n < 8) return empty;
  const centers = src.centers.slice(0, n);
  const srcDb = src.levelsDb.slice(0, n);
  const refDb = ref.levelsDb.slice(0, n);

  // Confidence per band (fade out near-silent bands on EITHER side) ×
  // perceptual weight — decisions matter where the ear listens.
  const srcMax = Math.max(...srcDb);
  const refMax = Math.max(...refDb);
  const conf = centers.map((_, i) => {
    const cs = clamp01((srcDb[i] - (srcMax - 42)) / 14);
    const cr = clamp01((refDb[i] - (refMax - 42)) / 14);
    return Math.min(cs, cr);
  });
  const w = centers.map((f, i) => conf[i] * perceptualWeight(f));

  // Level-align the two spectra (they were captured at unrelated gains).
  let oSum = 0;
  let oW = 0;
  for (let i = 0; i < n; i++) {
    oSum += (refDb[i] - srcDb[i]) * w[i];
    oW += w[i];
  }
  const offset = oW > 1e-9 ? oSum / oW : 0;

  // The raw gap: what the source would need to sound like the target.
  const gap = centers.map((_, i) => finite(refDb[i] - srcDb[i] - offset));

  const srcCutoffHz = measureCutoff(src);
  const refCutoffHz = measureCutoff(ref);

  const moves: TargetLockMove[] = [];
  const restore: Partial<RestoreParams> = {};

  // ── HF Rebuild: don't EQ-boost bands the source physically lacks ──
  const brickwalled =
    srcCutoffHz !== null &&
    refCutoffHz !== null &&
    srcCutoffHz < refCutoffHz * 0.72 &&
    srcCutoffHz < 14000;
  if (brickwalled) {
    restore.hf = clamp01((refCutoffHz - srcCutoffHz) / 9000 + 0.2);
    moves.push({
      id: "hf",
      label: "HF Rebuild",
      detail: `Source stops near ${(srcCutoffHz / 1000).toFixed(1)} kHz, reference reaches ${(refCutoffHz / 1000).toFixed(1)} kHz — regenerating the missing octaves instead of boosting noise.`,
    });
  }

  // ── Body: a big low-end deficit is better filled with harmonics + a
  //    modest shelf than a huge EQ boost ──
  const bodyGap = bandAvg(centers, gap, 60, 180);
  if (bodyGap > 4.5) {
    restore.body = clamp01((bodyGap - 4.5) / 8 + 0.2);
    moves.push({
      id: "body",
      label: "Body rebuild",
      detail: `Low end sits ${bodyGap.toFixed(1)} dB under the reference — harmonic weight carries part of the lift so the EQ shelf stays polite.`,
    });
  }

  // ── De-crunch: source piles up in the 2.8-5.5 kHz harshness band ──
  const crunchExcess = -bandAvg(centers, gap, 2800, 5500);
  const neighbours =
    (-bandAvg(centers, gap, 1000, 2000) + -bandAvg(centers, gap, 7000, 10000)) / 2;
  if (crunchExcess - neighbours > 2.5) {
    restore.decrunch = clamp01((crunchExcess - neighbours - 2.5) / 6 + 0.2);
    moves.push({
      id: "decrunch",
      label: "De-crunch",
      detail: `2.8-5.5 kHz runs ${(crunchExcess - neighbours).toFixed(1)} dB hotter than the reference relative to its surroundings — dynamic ducking beats a static cut here.`,
    });
  }

  // ── Clarity: mud-region excess vs the reference ──
  const mudExcess = -bandAvg(centers, gap, 200, 500);
  const clarity = mudExcess > 2.5 ? clamp01((mudExcess - 2.5) / 6 + 0.2) : 0;
  if (clarity > 0) {
    moves.push({
      id: "clarity",
      label: "Clarity",
      detail: `${mudExcess.toFixed(1)} dB of extra 200-500 Hz mud vs the reference — the dynamic mud duck clears it without thinning the mix.`,
    });
  }

  // ── Width: stereo image divergence ──
  let width: number | null = null;
  const sCorr = src.stereoCorr ?? null;
  const rCorr = ref.stereoCorr ?? null;
  if (sCorr !== null && rCorr !== null) {
    if (sCorr > 0.9 && rCorr < 0.65) {
      width = 0.35;
      moves.push({
        id: "width",
        label: "Widen",
        detail: `Source is nearly mono (corr ${sCorr.toFixed(2)}) while the reference is wide (${rCorr.toFixed(2)}) — opening the image.`,
      });
    } else if (sCorr < 0.15 && rCorr > 0.55) {
      width = -0.3;
      moves.push({
        id: "width",
        label: "Narrow",
        detail: `Source is far wider than the reference (corr ${sCorr.toFixed(2)} vs ${rCorr.toFixed(2)}) — pulling the image back for solidity.`,
      });
    }
  }

  // ── De-ess: sibilance band clearly hotter than the reference ──
  let deEss: number | null = null;
  const sibExcess = -bandAvg(centers, gap, 5000, 9000);
  if (sibExcess > 4 && (src.speechShare ?? 0) > 0.35) {
    deEss = clamp01((sibExcess - 4) / 8 + 0.25);
    moves.push({
      id: "deess",
      label: "De-ess",
      detail: `Sibilance region runs ${sibExcess.toFixed(1)} dB hotter than the reference on voice-heavy content — dynamic de-ess instead of a dull shelf.`,
    });
  }

  // ── EQ curve: the remaining tonal gap, smoothed, clamped, trimmed ──
  const raw = centers.map((f, i) => {
    let mv = gap[i] * (0.35 + 0.65 * conf[i]);
    // Above the source's brickwall the ladder does the lifting — cap the EQ
    // so it doesn't hoist the codec noise floor.
    if (brickwalled && srcCutoffHz !== null && f > srcCutoffHz) {
      mv = Math.min(mv, 2.5);
    }
    // Body rebuild carries part of the low-end lift.
    if (restore.body && f >= 50 && f <= 200 && mv > 0) mv *= 0.55;
    return mv;
  });
  const smooth = raw.map((mv, i) => {
    const a = raw[i - 1] ?? mv;
    const b = raw[i + 1] ?? mv;
    return 0.25 * a + 0.5 * mv + 0.25 * b;
  });
  // Loudness-preserving trim over energy-carrying bands (fair A/B).
  let tSum = 0;
  let tW = 0;
  for (let i = 0; i < n; i++) {
    const eShare = Math.pow(10, (srcDb[i] - srcMax) / 10);
    tSum += w[i] * eShare * smooth[i];
    tW += w[i] * eShare;
  }
  const trim = tW > 1e-9 ? -(tSum / tW) : 0;
  const eqMoves = smooth.map((mv) =>
    Math.max(-CUT_CLAMP, Math.min(BOOST_CLAMP, finite(mv + trim))),
  );
  const curve: CurvePoint[] = centers.map((freq, i) => ({ freq, db: eqMoves[i] }));
  const maxEq = eqMoves.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
  if (maxEq > 0.8) {
    moves.push({
      id: "eq",
      label: "Sculptor EQ",
      detail: `Retunes your bands toward the reference's tonal balance (largest move ${maxEq.toFixed(1)} dB, level-trimmed for a fair A/B).`,
    });
  }

  // ── Match % (loudness-weighted RMS residual, Tractor-style) ──
  const wrms = (dev: number[]): number => {
    let s = 0;
    let sw = 0;
    for (let i = 0; i < dev.length; i++) {
      s += w[i] * dev[i] * dev[i];
      sw += w[i];
    }
    return sw > 1e-9 ? Math.sqrt(s / sw) : 0;
  };
  const toPct = (r: number) => Math.round(100 * clamp01(1 - r / MATCH_FLOOR_DB));
  const matchBeforePct = toPct(wrms(gap));
  // Predicted after: the EQ closes what it can; re-centre so the trim
  // doesn't read as mismatch.
  let cSum = 0;
  let cW = 0;
  for (let i = 0; i < n; i++) {
    cSum += w[i] * eqMoves[i];
    cW += w[i];
  }
  const cMean = cW > 1e-9 ? cSum / cW : 0;
  const after = gap.map((g, i) => g - (eqMoves[i] - cMean));
  const matchAfterPct = Math.max(matchBeforePct, toPct(wrms(after)));

  return {
    curve: maxEq > 0.8 ? curve : [],
    restore,
    clarity,
    width,
    deEss,
    matchBeforePct,
    matchAfterPct,
    srcCutoffHz,
    refCutoffHz,
    moves,
    silent: false,
  };
}

export interface TargetLockSelection {
  eq: boolean;
  hf: boolean;
  body: boolean;
  decrunch: boolean;
  clarity: boolean;
  width: boolean;
  deess: boolean;
}

/** Apply the selected moves of a plan through the normal store setters. */
export async function applyTargetLock(
  plan: TargetLockPlan,
  sel: TargetLockSelection,
): Promise<void> {
  const { useAudioStore } = await import("@/state/audioStore");
  const { useEqStore } = await import("@/state/eqStore");
  const a = useAudioStore.getState();

  const restorePatch: Partial<RestoreParams> = {};
  if (sel.hf && plan.restore.hf !== undefined) restorePatch.hf = plan.restore.hf;
  if (sel.body && plan.restore.body !== undefined) restorePatch.body = plan.restore.body;
  if (sel.decrunch && plan.restore.decrunch !== undefined) {
    restorePatch.decrunch = plan.restore.decrunch;
  }
  if (Object.keys(restorePatch).length > 0) a.setRestore(restorePatch);

  if (sel.clarity && plan.clarity > 0) {
    a.setClarity(Math.max(a.clarity, plan.clarity));
  }

  const params: Partial<SoundParams> = {};
  if (sel.width && plan.width !== null) params.width = plan.width;
  if (sel.deess && plan.deEss !== null) params.deEss = plan.deEss;
  if (Object.keys(params).length > 0) a.setParams(params);

  if (sel.eq && plan.curve.length > 0) {
    useEqStore.getState().applyGainCurve((f) => sampleCurveDb(plan.curve, f));
  }
}
