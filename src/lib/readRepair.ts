/**
 * READ & REPAIR — the Sculptor's one-button auto-enhance (v2.1).
 *
 * One listening pass produces a READABLE report, never a silent change:
 *
 *   · Restoration Bay settings (brickwall cutoff, thin body, crunch, hum,
 *     clicks, clipping, phase) via the Auto-read analyzer.
 *   · A Clarity amount when the mud region carries more than its share.
 *   · A gentle EQ correction (Tractor derivation at reduced strength).
 *   · An output-gain move toward ≈ −14 LUFS, read from the live meter.
 *
 * The user reviews the report, unticks anything they disagree with, and
 * only then does applyRepairReport() touch the chain.
 */

import { getEngine } from "@/audio/AudioEngine";
import { analyzeForRestore } from "@/lib/restoreAnalyze";
import { measureLive } from "@/lib/tractorLive";
import {
  deriveCorrection,
  sampleCurveDb,
  type CurvePoint,
  type TractorMeasurement,
} from "@/lib/tractorBeam";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";

export const READ_REPAIR_TARGET_LUFS = -14;

export interface RepairReportItem {
  id: "restore" | "clarity" | "eq" | "loudness";
  label: string;
  /** Human-readable findings, one line each. */
  details: string[];
  /** Default-on; the user can veto each recommendation. */
  recommended: boolean;
}

export interface RepairReport {
  items: RepairReportItem[];
  restore: Partial<RestoreParams> | null;
  clarity: number | null;
  eqCurve: CurvePoint[] | null;
  /** Measured output loudness (integrated LUFS) during the listen. */
  lufs: number | null;
  /** Output-gain move (dB) that lands near −14 LUFS. Null = already close. */
  gainDeltaDb: number | null;
  cutoffHz: number | null;
  measurement: TractorMeasurement;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface ReadRepairOptions {
  /** Listening time in seconds (default 8). */
  seconds?: number;
  signal?: AbortSignal;
  onProgress?: (p: { stage: string; fraction: number }) => void;
}

/**
 * Listen to what's playing and build the recommendation report. Returns
 * null when nothing audible passed through. NEVER applies anything.
 */
export async function readAndRepair(
  opts: ReadRepairOptions = {},
): Promise<RepairReport | null> {
  const seconds = Math.max(5, Math.min(30, opts.seconds ?? 8));
  const engine = getEngine();
  await engine.resume();

  // Loudness is metered at the OUTPUT (post-chain) — that's what a −14 LUFS
  // normalization target is about.
  engine.ensureLufsMeter();
  engine.lufs.reset();

  try {
    // Both analyses tap preTap in parallel over the same listen.
    const [spectrum, restoreRead] = await Promise.all([
      measureLive({
        seconds,
        signal: opts.signal,
        onProgress: (p) =>
          opts.onProgress?.({ stage: p.stage, fraction: p.fraction * 0.9 }),
      }),
      analyzeForRestore(Math.min(seconds, 6), opts.signal),
    ]);
    if (spectrum.silent && !restoreRead) return null;

    opts.onProgress?.({ stage: "Reading the damage…", fraction: 0.94 });

    const items: RepairReportItem[] = [];

    // ── Restoration ──
    let restore: Partial<RestoreParams> | null = null;
    if (restoreRead && Object.keys(restoreRead.params).length > 0) {
      restore = restoreRead.params;
      items.push({
        id: "restore",
        label: "Restoration Bay",
        details: restoreRead.notes,
        recommended: true,
      });
    }

    // ── Clarity: mud share of the measured spectrum ──
    let clarity: number | null = null;
    if (!spectrum.silent) {
      const mudDb = avgLevel(spectrum, 200, 500);
      const midDb = avgLevel(spectrum, 700, 2500);
      const mudExcess = mudDb - midDb - 4; // constant-Q lows run naturally hot
      if (mudExcess > 2) {
        clarity = clamp01((mudExcess - 2) / 7 + 0.2);
        items.push({
          id: "clarity",
          label: "Clarity Engine",
          details: [
            `200-500 Hz carries ${mudExcess.toFixed(1)} dB more than its share — the veil over this source. Dynamic mud duck + unveil tilt at ${Math.round(clarity * 100)}%.`,
          ],
          recommended: true,
        });
      }
    }

    // ── Gentle EQ (Tractor derivation at reduced strength) ──
    let eqCurve: CurvePoint[] | null = null;
    if (!spectrum.silent) {
      const res = deriveCorrection(spectrum, {
        correctionEnabled: true, // exclude headphone voicing — this is repair
        strength: 0.6,
        targetId: "smart",
      });
      if (!res.silent && res.maxMoveDb > 0.8) {
        eqCurve = res.curve;
        const details: string[] = [];
        if (res.bassMoveDb > 1) {
          details.push(`Thin body — filling the lows by ~${res.bassMoveDb.toFixed(1)} dB.`);
        } else if (res.bassMoveDb < -1) {
          details.push(`Bass-heavy tilt — easing the lows by ~${(-res.bassMoveDb).toFixed(1)} dB.`);
        }
        const harsh = -sampleCurveDb(res.curve, 3500);
        if (harsh > 1) {
          details.push(`Harsh region around 2-6 kHz — tamed by ~${harsh.toFixed(1)} dB.`);
        }
        if (res.trebleMoveDb > 1) {
          details.push(`Dark top end — lifting the highs by ~${res.trebleMoveDb.toFixed(1)} dB.`);
        }
        details.push(
          `Gentle correction at 60% strength (largest move ${res.maxMoveDb.toFixed(1)} dB), level-trimmed.`,
        );
        items.push({ id: "eq", label: "Sculptor EQ", details, recommended: true });
      }
    }

    // ── Loudness vs −14 LUFS ──
    const lufs = engine.lufs.integratedLufs;
    let gainDeltaDb: number | null = null;
    if (lufs > -70) {
      const delta = READ_REPAIR_TARGET_LUFS - lufs;
      if (Math.abs(delta) > 1) {
        gainDeltaDb = Math.max(-12, Math.min(12, delta));
        items.push({
          id: "loudness",
          label: "Output loudness",
          details: [
            `Playing at ${lufs.toFixed(1)} LUFS — ${gainDeltaDb > 0 ? "+" : ""}${gainDeltaDb.toFixed(1)} dB lands near the ${READ_REPAIR_TARGET_LUFS} LUFS streaming reference.`,
          ],
          // Loudness is taste — recommend only clear offenders.
          recommended: Math.abs(delta) > 3,
        });
      }
    }

    opts.onProgress?.({ stage: "Report ready", fraction: 1 });
    if (items.length === 0) return null;

    return {
      items,
      restore,
      clarity,
      eqCurve,
      lufs: lufs > -70 ? lufs : null,
      gainDeltaDb,
      cutoffHz: restoreRead?.cutoffHz ?? null,
      measurement: spectrum,
    };
  } finally {
    engine.releaseLufsMeter();
  }
}

function avgLevel(m: TractorMeasurement, lo: number, hi: number): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < m.centers.length; i++) {
    if (m.centers[i] >= lo && m.centers[i] <= hi) {
      s += m.levelsDb[i];
      n++;
    }
  }
  return n > 0 ? s / n : -120;
}

/** Apply only the ticked recommendations, through the normal store setters. */
export async function applyRepairReport(
  report: RepairReport,
  accepted: ReadonlySet<RepairReportItem["id"]>,
): Promise<string[]> {
  const { useAudioStore } = await import("@/state/audioStore");
  const { useEqStore } = await import("@/state/eqStore");
  const a = useAudioStore.getState();
  const applied: string[] = [];

  if (accepted.has("restore") && report.restore) {
    a.setRestore(report.restore);
    applied.push("Restoration");
  }
  if (accepted.has("clarity") && report.clarity !== null) {
    a.setClarity(Math.max(a.clarity, report.clarity));
    applied.push("Clarity");
  }
  if (accepted.has("eq") && report.eqCurve) {
    const curve = report.eqCurve;
    useEqStore.getState().applyGainCurve((f) => sampleCurveDb(curve, f));
    applied.push("EQ");
  }
  if (accepted.has("loudness") && report.gainDeltaDb !== null) {
    a.setOutputGain(Math.max(-24, Math.min(12, a.outputGainDb + report.gainDeltaDb)));
    applied.push("Loudness");
  }
  return applied;
}
