/**
 * chainSnapshot — capture / apply the ENTIRE audible chain as one JSON-safe
 * value. This is the shared foundation for Mission Log (per-track / per-source
 * memory), session snapshots and level-matched A/B: anything that wants to
 * remember "how the app sounds right now" stores a ChainSnapshot.
 *
 * A snapshot covers everything the older per-track memory (SoundParams only)
 * missed: Sculptor EQ bands, Restoration Bay + Clarity (previously
 * session-only), room / balance pro-tools, output gain, the Airspace
 * Cinema/Music voicing, and the Tractor lock that produced the chain.
 *
 * Airspace subtlety: the Cinema/Music overlay is ADDITIVE on top of the
 * user's params (see airspaceModes.ts). We capture the UNDERLYING params
 * (overlay stripped via its baseline) plus the mode + options, and on apply
 * we restore the underlying params first and re-engage the mode on top — so
 * overlays never stack or double-apply.
 */

import type { SoundParams } from "@/audio/types";
import { normalizeParams } from "@/audio/types";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";
import { RESTORE_OFF, restoreActive } from "@/audio/dsp/Reconstructor";
import type { RoomId } from "@/audio/dsp/HRTFRooms";
import type { CurvePoint } from "@/lib/tractorBeam";
import {
  applyAirMode,
  defaultAirOpts,
  getActiveAirBaseline,
  type AirMode,
} from "@/lib/airspaceModes";
import {
  getLastAppliedTractor,
  setLastAppliedTractor,
} from "@/lib/tractorApplied";
import { useAudioStore } from "@/state/audioStore";
import { useEqStore, clampFreq, clampGain, clampQ, EQ_TYPES } from "@/state/eqStore";
import { useAirspaceStore } from "@/state/airspaceStore";
import {
  captureDimensionScene,
  sanitizeDimensionScene,
  applyDimensionScene,
  type DimensionSceneSnapshot,
} from "@/state/dimensionStore";

export const CHAIN_SNAPSHOT_VERSION = 1;

/** An EQ band as stored in a snapshot (no runtime ids). */
export interface SnapshotEqBand {
  freq: number;
  gain: number;
  q: number;
  type: BiquadFilterType;
  enabled: boolean;
  /** v2.1 — dynamic mode flag (absent on older snapshots). */
  dynamic?: boolean;
}

export interface SnapshotTractor {
  curve: CurvePoint[];
  targetId: string;
  strength: number;
  contentLabel: string | null;
  fullChain: boolean;
  at: number;
  /** v2.3 — predicted match % of the lock (status badges). */
  matchPct?: number | null;
  /** v2.3 — display name of the locked source. */
  sourceName?: string | null;
}

export interface ChainSnapshot {
  v: number;
  /** Underlying friendly params (Airspace overlay stripped). */
  params: SoundParams;
  eqBands: SnapshotEqBand[];
  restore: RestoreParams;
  clarity: number;
  outputGainDb: number;
  room: RoomId;
  roomMix: number;
  balanceLDb: number;
  balanceRDb: number;
  balanceDelayMs: number;
  airMode: AirMode;
  airOpts: Record<string, boolean>;
  /** The Tractor lock that produced this chain, if one was applied. */
  tractor: SnapshotTractor | null;
  /**
   * v2.0 Spatial Memory — the full 3rd Dimension scene (layout, room, stage,
   * motion, engaged state). Absent/null on pre-2.0 snapshots: applying such
   * a snapshot leaves the current spatial setup untouched.
   */
  dimension?: DimensionSceneSnapshot | null;
}

/** Snapshot the full audible chain right now. */
export function captureChain(): ChainSnapshot {
  const a = useAudioStore.getState();
  const air = useAirspaceStore.getState();
  // Strip the active Airspace overlay so we store what the user dialled in.
  const underlying: SoundParams = { ...a.params, ...getActiveAirBaseline() };
  return {
    v: CHAIN_SNAPSHOT_VERSION,
    params: underlying,
    eqBands: useEqStore.getState().bands.map((b) => ({
      freq: b.freq,
      gain: b.gain,
      q: b.q,
      type: b.type,
      enabled: b.enabled,
      dynamic: b.dynamic === true,
    })),
    restore: { ...a.restore },
    clarity: a.clarity,
    outputGainDb: a.outputGainDb,
    room: a.room,
    roomMix: a.roomMix,
    balanceLDb: a.balanceLDb,
    balanceRDb: a.balanceRDb,
    balanceDelayMs: a.balanceDelayMs,
    airMode: air.airMode,
    airOpts: { ...air.airOpts },
    tractor: getLastAppliedTractor(),
    dimension: captureDimensionScene(),
  };
}

/**
 * Apply a snapshot to the live chain. Everything routes through the normal
 * store setters so undo history, FX-engage logic and persistence behave as
 * if the user dialled it in by hand.
 */
export function applyChain(snap: ChainSnapshot): void {
  const safe = sanitizeChainSnapshot(snap);
  if (!safe) return;
  const a = useAudioStore.getState();
  const air = useAirspaceStore.getState();

  // 1. Clear any live Airspace overlay so its baseline bookkeeping resets —
  //    the params we're about to restore are the underlying values.
  applyAirMode("off", {});

  // 2. Friendly params + Sculptor bands.
  a.replaceParams(safe.params);
  if (safe.eqBands.length > 0) useEqStore.getState().setBands(safe.eqBands);

  // 3. Restoration Bay / Clarity / gain / pro tools.
  a.setRestore(safe.restore);
  a.setClarity(safe.clarity);
  a.setOutputGain(safe.outputGainDb);
  a.setRoom(safe.room, safe.roomMix);
  a.setBalance(safe.balanceLDb, safe.balanceRDb, safe.balanceDelayMs);

  // 4. Airspace voicing last, so the overlay lands on the restored baseline.
  useAirspaceStore.setState({ airOpts: safe.airOpts });
  air.setAirMode(safe.airMode);

  // 5. Remember which lock this chain came from (Auto-Lock skips re-measure).
  setLastAppliedTractor(safe.tractor);

  // 6. v2.0 Spatial Memory: restore the 3rd Dimension scene when the
  //    snapshot carries one. Pre-2.0 snapshots (dimension null) leave the
  //    current spatial setup alone.
  if (safe.dimension) applyDimensionScene(safe.dimension);
}

const ROOM_IDS: RoomId[] = ["off", "studio", "cinema", "club"];

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Validate + backfill a snapshot loaded from storage (or an older schema).
 * Returns null only when the value is unusable.
 */
export function sanitizeChainSnapshot(raw: unknown): ChainSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ChainSnapshot> & { params?: Partial<SoundParams> };
  if (!r.params || typeof r.params !== "object") return null;

  const eqBands: SnapshotEqBand[] = Array.isArray(r.eqBands)
    ? r.eqBands
        .filter((b): b is SnapshotEqBand => !!b && typeof b === "object")
        .slice(0, 20)
        .map((b) => ({
          freq: clampFreq(num(b.freq, 1000)),
          gain: clampGain(num(b.gain, 0)),
          q: clampQ(num(b.q, 1.1)),
          type: EQ_TYPES.includes(b.type) ? b.type : "peaking",
          enabled: b.enabled !== false,
          dynamic: b.dynamic === true,
        }))
    : [];

  const rr = (r.restore ?? {}) as Partial<RestoreParams>;
  const restore: RestoreParams = {
    hf: clamp01(num(rr.hf, 0)),
    body: clamp01(num(rr.body, 0)),
    decrunch: clamp01(num(rr.decrunch, 0)),
    hiss: clamp01(num(rr.hiss, 0)),
    dehum: clamp01(num(rr.dehum, 0)),
    declick: clamp01(num(rr.declick, 0)),
    widen: clamp01(num(rr.widen, 0)),
    declip: clamp01(num(rr.declip, 0)),
    voice: clamp01(num(rr.voice, 0)),
    phase: clamp01(num(rr.phase, 0)),
  };

  const airMode: AirMode =
    r.airMode === "cinema" || r.airMode === "music" ? r.airMode : "off";
  const airOpts: Record<string, boolean> = { ...defaultAirOpts() };
  if (r.airOpts && typeof r.airOpts === "object") {
    for (const [k, v] of Object.entries(r.airOpts)) {
      if (typeof v === "boolean" && k in airOpts) airOpts[k] = v;
    }
  }

  let tractor: SnapshotTractor | null = null;
  const t = r.tractor;
  if (t && typeof t === "object" && Array.isArray(t.curve)) {
    tractor = {
      curve: t.curve
        .filter((p): p is CurvePoint => !!p && typeof p === "object")
        .map((p) => ({ freq: num(p.freq, 0), db: num(p.db, 0) }))
        .filter((p) => p.freq > 0),
      targetId: typeof t.targetId === "string" ? t.targetId : "smart",
      strength: num(t.strength, 1),
      contentLabel: typeof t.contentLabel === "string" ? t.contentLabel : null,
      fullChain: t.fullChain !== false,
      at: num(t.at, Date.now()),
      matchPct: typeof t.matchPct === "number" && Number.isFinite(t.matchPct) ? t.matchPct : null,
      sourceName: typeof t.sourceName === "string" ? t.sourceName : null,
    };
  }

  return {
    v: CHAIN_SNAPSHOT_VERSION,
    params: normalizeParams(r.params),
    eqBands,
    restore,
    clarity: clamp01(num(r.clarity, 0)),
    outputGainDb: Math.max(-24, Math.min(12, num(r.outputGainDb, 0))),
    room: ROOM_IDS.includes(r.room as RoomId) ? (r.room as RoomId) : "off",
    roomMix: clamp01(num(r.roomMix, 0)),
    balanceLDb: Math.max(-12, Math.min(12, num(r.balanceLDb, 0))),
    balanceRDb: Math.max(-12, Math.min(12, num(r.balanceRDb, 0))),
    balanceDelayMs: Math.max(0, Math.min(30, num(r.balanceDelayMs, 0))),
    airMode,
    airOpts,
    tractor,
    dimension: sanitizeDimensionScene(r.dimension),
  };
}

/** Build a snapshot from a legacy per-track SoundParams entry (trackEq.v1). */
export function chainFromLegacyParams(params: Partial<SoundParams>): ChainSnapshot {
  return {
    v: CHAIN_SNAPSHOT_VERSION,
    params: normalizeParams(params),
    eqBands: [],
    restore: { ...RESTORE_OFF },
    clarity: 0,
    outputGainDb: useAudioStore.getState().outputGainDb,
    room: "off",
    roomMix: 0,
    balanceLDb: 0,
    balanceRDb: 0,
    balanceDelayMs: 0,
    airMode: "off",
    airOpts: defaultAirOpts(),
    tractor: null,
    dimension: null,
  };
}

/** Short human summary of what a snapshot changes — for list rows. */
export function describeChain(snap: ChainSnapshot): string {
  const bits: string[] = [];
  const activeBands = snap.eqBands.filter(
    (b) => b.enabled && (Math.abs(b.gain) > 0.1 || b.type === "lowpass" || b.type === "highpass" || b.type === "notch"),
  ).length;
  if (snap.tractor) bits.push("Tractor lock");
  if (activeBands > 0) bits.push(`${activeBands}-band EQ`);
  if (restoreActive(snap.restore)) bits.push("Restoration");
  if (snap.clarity > 0) bits.push("Clarity");
  if (snap.airMode !== "off") bits.push(snap.airMode === "cinema" ? "Cinema mode" : "Music mode");
  if (snap.room !== "off" && snap.roomMix > 0) bits.push("Room");
  if (snap.dimension?.active) bits.push("3D scene");
  return bits.length > 0 ? bits.join(" · ") : "Tone chain";
}
