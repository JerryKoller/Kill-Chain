/**
 * tractorLock — v2.3 FULL CHAIN LOCK.
 *
 * One LOCK action prepares a complete correction MANIFEST from a single
 * measurement:
 *
 *   · Sculptor EQ curve            (Tractor's tonal match)
 *   · Master moves                 (dynamics / width / de-ess / spatial)
 *   · Restoration suggestions      (HF rebuild, de-crunch, body, de-clip)
 *   · Clarity amount               (dynamic mud duck)
 *   · Optional loudness trim       (headroom for crushed masters)
 *
 * …voiced by the target profile, scaled by user strength, filtered by
 * per-band vetoes, and gated by Intelligence v2 (the "already mastered"
 * guard caps strength on healthy sources). The manifest is shown to the
 * user BEFORE anything is applied — every layer can be toggled off.
 *
 * When a REFERENCE measurement is supplied, the EQ curve and repair moves
 * are derived from the source→reference gap (Target Lock) instead of the
 * generic profile match.
 */

import {
  deriveCorrection,
  readTractorHealth,
  sampleCurveDb,
  getTargetProfile,
  type CurvePoint,
  type DeriveOptions,
  type TractorMeasurement,
  type TractorResult,
  type TractorHealth,
} from "@/lib/tractorBeam";
import { deriveTargetLock, type TargetLockPlan } from "@/lib/targetLock";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";
import type { SoundParams } from "@/audio/types";

export type LockLayerId = "eq" | "master" | "restore" | "clarity" | "trim";

export interface LockManifestItem {
  id: LockLayerId;
  label: string;
  /** Compact value readout for the manifest row ("+2.1 dB at 3.2 kHz"). */
  value: string;
  /** Plain-language why. */
  detail: string;
  /** False when this layer has nothing to do (row shown dimmed / skipped). */
  active: boolean;
}

export interface LockManifest {
  /** Final Sculptor curve (already strength-scaled / vetoed / edited). */
  curve: CurvePoint[];
  masterMoves: Partial<SoundParams>;
  masterNotes: string[];
  restore: Partial<RestoreParams>;
  restoreNotes: string[];
  clarity: number;
  /** Extra output-gain trim (dB, usually ≤ 0) — headroom for hot masters. */
  outputTrimDb: number;
  /** The level trim already folded INTO the curve (info only). */
  curveTrimDb: number;

  strength: number;
  /** Strength the user asked for, before the health ceiling clamp. */
  requestedStrength: number;
  /** True when the health guard limited the strength. */
  strengthLimited: boolean;

  targetId: string;
  resolvedTargetId: string;
  contentLabel: string | null;
  health: TractorHealth;
  result: TractorResult;
  /** Non-null when this manifest was derived against a reference. */
  referencePlan: TargetLockPlan | null;

  matchBeforePct: number;
  matchAfterPct: number;

  /** One-line summary: "+2.1 dB at 3.2 kHz · Cinema voicing · light glue…" */
  summary: string;
  items: LockManifestItem[];
  silent: boolean;
}

export interface BuildManifestOptions extends DeriveOptions {
  /** Optional reference measurement — switches to reference-match mode. */
  reference?: TractorMeasurement | null;
  /** Per-band manual curve edits (freq → extra dB), applied after derive. */
  curveEdits?: ReadonlyMap<number, number> | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function fmtFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}

function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Restoration suggestions read straight off the damage flags. */
function deriveRestoreLayer(
  health: TractorHealth,
  m: TractorMeasurement,
): { restore: Partial<RestoreParams>; notes: string[] } {
  const restore: Partial<RestoreParams> = {};
  const notes: string[] = [];
  for (const d of health.damage) {
    if (d.id === "cutoff" && health.cutoffHz !== null) {
      restore.hf = clamp01((14000 - health.cutoffHz) / 9000 + 0.15);
      notes.push(`HF Rebuild ${fmtPct(restore.hf)} — ${d.detail}`);
    }
    if (d.id === "crunch") {
      restore.decrunch = clamp01(0.2 + d.severity * 0.5);
      notes.push(`De-crunch ${fmtPct(restore.decrunch)} — ${d.detail}`);
      if ((m.crestDb ?? 12) < 8) {
        restore.declip = 0.25;
        notes.push(`Soft de-clip ${fmtPct(restore.declip)} — crest under 8 dB reads as a clipped master.`);
      }
    }
    if (d.id === "thin") {
      restore.body = clamp01(0.2 + d.severity * 0.45);
      notes.push(`Body rebuild ${fmtPct(restore.body)} — ${d.detail}`);
    }
  }
  return { restore, notes };
}

/** Clarity from the mud region's excess over the track's own envelope. */
function deriveClarityLayer(result: TractorResult): number {
  // The derived curve already cuts mud when needed; clarity adds a DYNAMIC
  // duck only when the static picture shows a real 200-500 Hz pile-up.
  let mudCut = 0;
  let n = 0;
  for (const b of result.bands) {
    if (b.freq >= 200 && b.freq <= 500) {
      mudCut += -b.moveDb;
      n++;
    }
  }
  const avgCut = n > 0 ? mudCut / n : 0;
  return avgCut > 1.4 ? clamp01((avgCut - 1.4) / 5 + 0.15) : 0;
}

/**
 * Build the complete manifest. Pure and instant — safe to rebuild on every
 * control change; nothing is applied until applyLockManifest().
 */
export function buildLockManifest(
  m: TractorMeasurement,
  opts: BuildManifestOptions,
): LockManifest {
  const requestedStrength = opts.strength;

  // First derive at requested strength to read health, then clamp.
  const probe = deriveCorrection(m, opts);
  const health = readTractorHealth(m, probe);
  const strength = Math.min(requestedStrength, health.strengthCeiling);
  const strengthLimited = strength < requestedStrength - 1e-3;

  const result =
    strength === requestedStrength ? probe : deriveCorrection(m, { ...opts, strength });

  // Reference mode: the EQ curve + repair moves come from the src→ref gap.
  const referencePlan =
    opts.reference && !opts.reference.silent ? deriveTargetLock(m, opts.reference) : null;

  let curve: CurvePoint[];
  let matchBeforePct: number;
  let matchAfterPct: number;
  let restore: Partial<RestoreParams>;
  let restoreNotes: string[];
  let clarity: number;
  const masterMoves: Partial<SoundParams> = { ...result.masterMoves };
  const masterNotes = [...result.masterNotes];

  if (referencePlan && !referencePlan.silent) {
    // Scale the reference curve by strength (reference gap is "100%").
    const s = clamp01(strength);
    curve = referencePlan.curve.map((p) => ({ freq: p.freq, db: p.db * s }));
    matchBeforePct = referencePlan.matchBeforePct;
    matchAfterPct = referencePlan.matchAfterPct;
    restore = { ...referencePlan.restore };
    restoreNotes = referencePlan.moves
      .filter((mv) => mv.id === "hf" || mv.id === "body" || mv.id === "decrunch")
      .map((mv) => `${mv.label} — ${mv.detail}`);
    clarity = referencePlan.clarity;
    if (referencePlan.width !== null) {
      masterMoves.width = referencePlan.width;
      const wMove = referencePlan.moves.find((mv) => mv.id === "width");
      if (wMove) masterNotes.push(`${wMove.label} — ${wMove.detail}`);
    }
    if (referencePlan.deEss !== null) {
      masterMoves.deEss = Math.max(masterMoves.deEss ?? 0, referencePlan.deEss);
      const dMove = referencePlan.moves.find((mv) => mv.id === "deess");
      if (dMove) masterNotes.push(`${dMove.label} — ${dMove.detail}`);
    }
  } else {
    curve = result.curve;
    matchBeforePct = result.matchBeforePct;
    matchAfterPct = result.matchAfterPct;
    const r = deriveRestoreLayer(health, m);
    restore = r.restore;
    restoreNotes = r.notes;
    clarity = deriveClarityLayer(result);
  }

  // Manual curve edits (the editable correction curve) land last.
  if (opts.curveEdits && opts.curveEdits.size > 0) {
    curve = curve.map((p) => {
      const edit = opts.curveEdits!.get(p.freq);
      return edit !== undefined
        ? { freq: p.freq, db: Math.max(-9, Math.min(6, p.db + edit)) }
        : p;
    });
  }

  // Optional loudness trim: crushed masters get headroom so the added EQ /
  // harmonics can't push a hot master into the limiter.
  const crest = m.crestDb;
  const outputTrimDb = crest !== undefined && crest < 8.5 ? -1.5 : 0;

  // ── Manifest rows ──
  const maxMove = curve.reduce(
    (best, p) => (Math.abs(p.db) > Math.abs(best.db) ? p : best),
    { freq: 0, db: 0 },
  );
  const profile = getTargetProfile(result.resolvedTargetId);
  const items: LockManifestItem[] = [];

  items.push({
    id: "eq",
    label: referencePlan ? "Sculptor EQ · reference match" : "Sculptor EQ",
    value:
      Math.abs(maxMove.db) > 0.2
        ? `${maxMove.db > 0 ? "+" : ""}${maxMove.db.toFixed(1)} dB at ${fmtFreq(maxMove.freq)}`
        : "flat",
    detail: referencePlan
      ? "Retunes your bands toward the reference's tonal balance."
      : `${profile.label} voicing — tames resonances and drifts toward the ${profile.label.toLowerCase()} target, level-trimmed for a fair A/B.`,
    active: Math.abs(maxMove.db) > 0.2,
  });

  const glue = masterMoves.compression ?? 0;
  const masterBits: string[] = [];
  if ((masterMoves.punch ?? 0) > 0) masterBits.push("punch");
  if (glue > 0) masterBits.push(glue < 0.25 ? "light glue" : "glue");
  if ((masterMoves.width ?? 0) !== 0) masterBits.push((masterMoves.width ?? 0) > 0 ? "widen" : "narrow");
  if ((masterMoves.deEss ?? 0) > 0) masterBits.push("de-ess");
  if ((masterMoves.spatial ?? 0) > 0) masterBits.push("depth");
  if ((masterMoves.harmonics ?? 0) > 0) masterBits.push("harmonics");
  if ((masterMoves.mbCompLow ?? 0) > 0 || (masterMoves.mbCompMid ?? 0) > 0) masterBits.push("multiband");
  items.push({
    id: "master",
    label: "Master moves",
    value: masterBits.length > 0 ? masterBits.join(" · ") : "none",
    detail:
      masterNotes.length > 0
        ? masterNotes.join(" ")
        : "The fingerprint didn't call for dynamics, width or de-ess moves.",
    active: Object.keys(masterMoves).length > 0,
  });

  const restoreBits = Object.entries(restore)
    .filter(([, v]) => (v ?? 0) > 0.001)
    .map(([k, v]) => `${k === "hf" ? "HF rebuild" : k === "decrunch" ? "de-crunch" : k === "declip" ? "de-clip" : k} ${fmtPct(v as number)}`);
  items.push({
    id: "restore",
    label: "Restoration",
    value: restoreBits.length > 0 ? restoreBits.join(" · ") : "none",
    detail:
      restoreNotes.length > 0
        ? restoreNotes.join(" ")
        : "No damage signatures — the Restoration Bay stays out of the path.",
    active: restoreBits.length > 0,
  });

  items.push({
    id: "clarity",
    label: "Clarity",
    value: clarity > 0 ? fmtPct(clarity) : "none",
    detail:
      clarity > 0
        ? "A real 200-500 Hz pile-up — the dynamic mud duck clears it without thinning the mix."
        : "Mud region is healthy — no dynamic duck needed.",
    active: clarity > 0,
  });

  items.push({
    id: "trim",
    label: "Loudness trim",
    value: outputTrimDb !== 0 ? `${outputTrimDb.toFixed(1)} dB output` : "none",
    detail:
      outputTrimDb !== 0
        ? `Crest factor ${crest?.toFixed(1)} dB reads as a crushed master — trimming output headroom so the correction can't clip.`
        : Math.abs(result.trimDb) > 0.05
          ? `A ${result.trimDb.toFixed(1)} dB level trim is already folded into the EQ curve for a fair A/B.`
          : "Level already fair — nothing to trim.",
    active: outputTrimDb !== 0,
  });

  // ── One-line summary ──
  const bits: string[] = [];
  if (Math.abs(maxMove.db) > 0.2) {
    bits.push(`${maxMove.db > 0 ? "+" : ""}${maxMove.db.toFixed(1)} dB at ${fmtFreq(maxMove.freq)}`);
  }
  bits.push(referencePlan ? "Reference match" : `${profile.label} voicing`);
  if (glue > 0) bits.push(glue < 0.25 ? "light glue" : "glue");
  if ((restore.hf ?? 0) > 0) bits.push(`HF rebuild ${fmtPct(restore.hf!)}`);
  if ((restore.decrunch ?? 0) > 0) bits.push(`de-crunch ${fmtPct(restore.decrunch!)}`);
  if ((restore.body ?? 0) > 0) bits.push(`body ${fmtPct(restore.body!)}`);
  if (clarity > 0) bits.push(`Clarity ${fmtPct(clarity)}`);
  if (outputTrimDb !== 0) bits.push(`${outputTrimDb.toFixed(1)} dB trim`);
  if (strengthLimited) bits.push(`strength capped ${Math.round(strength * 100)}%`);

  return {
    curve,
    masterMoves,
    masterNotes,
    restore,
    restoreNotes,
    clarity,
    outputTrimDb,
    curveTrimDb: result.trimDb,
    strength,
    requestedStrength,
    strengthLimited,
    targetId: result.targetId,
    resolvedTargetId: result.resolvedTargetId,
    contentLabel: result.content?.label ?? null,
    health,
    result,
    referencePlan,
    matchBeforePct,
    matchAfterPct,
    summary: bits.join(" · "),
    items,
    silent: result.silent,
  };
}

export type LockLayerSelection = Record<LockLayerId, boolean>;

export const ALL_LAYERS: LockLayerSelection = {
  eq: true,
  master: true,
  restore: true,
  clarity: true,
  trim: true,
};

/**
 * Apply the selected layers of a manifest through the normal store setters
 * and record the applied lock (badges + ChainSnapshot). Returns the list of
 * layer ids that actually changed something.
 */
export async function applyLockManifest(
  manifest: LockManifest,
  sel: LockLayerSelection,
  sourceName?: string | null,
): Promise<LockLayerId[]> {
  if (manifest.silent) return [];
  const applied: LockLayerId[] = [];
  const { useAudioStore } = await import("@/state/audioStore");
  const { useEqStore } = await import("@/state/eqStore");
  const a = useAudioStore.getState();

  if (sel.eq && manifest.curve.length > 0) {
    useEqStore.getState().applyGainCurve((f) => sampleCurveDb(manifest.curve, f));
    applied.push("eq");
  }
  if (sel.master && Object.keys(manifest.masterMoves).length > 0) {
    a.setParams(manifest.masterMoves);
    applied.push("master");
  }
  if (sel.restore && Object.keys(manifest.restore).length > 0) {
    a.setRestore(manifest.restore);
    applied.push("restore");
  }
  if (sel.clarity && manifest.clarity > 0) {
    a.setClarity(Math.max(a.clarity, manifest.clarity));
    applied.push("clarity");
  }
  if (sel.trim && manifest.outputTrimDb !== 0) {
    // Absolute set with clamp — additive trim across repeated Auto-Locks could
    // slowly climb outputGain into distortion territory.
    const next = Math.max(-24, Math.min(12, a.outputGainDb + manifest.outputTrimDb));
    a.setOutputGain(next);
    applied.push("trim");
  }

  const { setLastAppliedTractor } = await import("@/lib/tractorApplied");
  setLastAppliedTractor({
    curve: manifest.curve,
    targetId: manifest.resolvedTargetId,
    strength: manifest.strength,
    contentLabel: manifest.contentLabel,
    fullChain: applied.length > 1,
    at: Date.now(),
    matchPct: manifest.matchAfterPct,
    sourceName: sourceName ?? null,
  });

  return applied;
}
