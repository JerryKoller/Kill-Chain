import { create } from "zustand";
import type { CurvePoint, TractorMeasurement } from "@/lib/tractorBeam";
import { sampleCurveDb } from "@/lib/tractorBeam";
import type { LockLayerSelection } from "@/lib/tractorLock";
import { ALL_LAYERS } from "@/lib/tractorLock";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";
import type { SoundParams } from "@/audio/types";

/**
 * Lock Library — v2.3 persistent per-source Tractor lock records.
 *
 * Where the Mission Log stores the whole chain, a LockRecord stores the
 * TRACTOR side of the story: the measurement (so the correction can be
 * re-derived / re-voiced without re-scanning), the user's controls
 * (target, strength, vetoes, curve edits, layer selection) and what was
 * actually applied — keyed by the same source identities the Mission Log
 * uses (file path, Airspace source id, or a name for live captures).
 *
 * Auto-Lock restores a valid record instantly before ever running a scan;
 * "force re-scan" always measures fresh. Records export/import as `.klock`
 * packs so locks travel between machines.
 */

const STORAGE_KEY = "killchain.lockLibrary.v1";
const MAX_RECORDS = 300;
export const LOCK_RECORD_VERSION = 1;

export type LockSourceKind = "track" | "airspace" | "live";

export interface LockRecord {
  key: string;
  kind: LockSourceKind;
  name: string;
  sub: string;
  favorite: boolean;
  savedAt: number;
  updatedAt: number;

  /** The full measurement — re-derive any voicing without re-scanning. */
  measurement: TractorMeasurement;

  // User controls in effect when the lock was engaged.
  targetId: string;
  strength: number;
  vetoes: number[];
  /** Manual curve edits (freq → extra dB). */
  curveEdits: Record<string, number>;
  layers: LockLayerSelection;

  // What was actually applied (restored verbatim on instant restore).
  curve: CurvePoint[];
  masterMoves: Partial<SoundParams>;
  restore: Partial<RestoreParams>;
  clarity: number;
  outputTrimDb: number;

  matchBeforePct: number;
  matchAfterPct: number;
  contentLabel: string | null;

  /** Source fingerprint — duration + coarse spectrum hash. A fresh scan
   *  that produces the same fingerprint means the source is unchanged. */
  fingerprint: string;
  v: number;
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

/** Coarse, stable fingerprint of a measurement (source identity/version). */
export function measurementFingerprint(m: TractorMeasurement): string {
  let h = 5381;
  for (let i = 0; i < m.levelsDb.length; i++) {
    // Half-dB resolution — robust to tiny numeric drift between scans.
    const q = Math.round(m.levelsDb[i] * 2);
    h = ((h << 5) + h + q) | 0;
  }
  return `${Math.round(m.analyzedSec)}s:${(h >>> 0).toString(36)}`;
}

// ── Source keys ─────────────────────────────────────────────────────────────

/** Lock Library key + labels for whatever is playing right now. */
export async function lockKeyForCurrentSource(): Promise<{
  key: string;
  kind: LockSourceKind;
  name: string;
  sub: string;
} | null> {
  const { usePlayerStore } = await import("@/state/playerStore");
  const { useAirspaceStore } = await import("@/state/airspaceStore");
  const p = usePlayerStore.getState();
  const air = useAirspaceStore.getState().media;

  if (air && !air.paused && p.loopbackActive) {
    const { airspaceSourceId } = await import("@/lib/airspaceMedia");
    const id = airspaceSourceId(air);
    if (id) {
      return { key: id, kind: "airspace", name: air.title || "Airspace source", sub: air.artist || "" };
    }
  }
  if (p.src) {
    const { pathFromAudioSrc, useLibraryStore } = await import("@/state/libraryStore");
    const path = pathFromAudioSrc(p.src);
    if (path) {
      const track = useLibraryStore.getState().tracks.find((t) => t.path === path);
      const name =
        track?.title ??
        p.metadata.title ??
        (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
      return { key: `file:${path}`, kind: "track", name, sub: track?.artist ?? "" };
    }
  }
  return null;
}

// ── Sanitize / persistence ──────────────────────────────────────────────────

const num = (v: unknown, fb: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fb;

function isNumArray(a: unknown): a is number[] {
  return Array.isArray(a) && a.every((x) => typeof x === "number" && Number.isFinite(x));
}

export function sanitizeLockRecord(raw: unknown): LockRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const m = r.measurement as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return null;
  if (!isNumArray(m.centers) || !isNumArray(m.levelsDb)) return null;
  if (m.centers.length === 0 || m.centers.length !== m.levelsDb.length) return null;
  if (typeof r.key !== "string" || !r.key) return null;

  const measurement: TractorMeasurement = {
    sampleRate: num(m.sampleRate, 44100),
    analyzedSec: num(m.analyzedSec, 0),
    windowsUsed: num(m.windowsUsed, 1),
    centers: m.centers,
    levelsDb: m.levelsDb,
    silent: m.silent === true,
    crestDb: typeof m.crestDb === "number" ? m.crestDb : undefined,
    dynRangeDb: typeof m.dynRangeDb === "number" ? m.dynRangeDb : undefined,
    stereoCorr: typeof m.stereoCorr === "number" ? m.stereoCorr : null,
    bassShare: typeof m.bassShare === "number" ? m.bassShare : undefined,
    speechShare: typeof m.speechShare === "number" ? m.speechShare : undefined,
    airShare: typeof m.airShare === "number" ? m.airShare : undefined,
    sectionSpreadDb: typeof m.sectionSpreadDb === "number" ? m.sectionSpreadDb : undefined,
  };

  const curve: CurvePoint[] = Array.isArray(r.curve)
    ? (r.curve as unknown[])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => ({ freq: num(p.freq, 0), db: num(p.db, 0) }))
        .filter((p) => p.freq > 0)
    : [];

  const curveEdits: Record<string, number> = {};
  if (r.curveEdits && typeof r.curveEdits === "object") {
    for (const [k, v] of Object.entries(r.curveEdits as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) curveEdits[k] = v;
    }
  }

  const layersRaw = (r.layers ?? {}) as Record<string, unknown>;
  const layers: LockLayerSelection = { ...ALL_LAYERS };
  for (const id of Object.keys(ALL_LAYERS) as (keyof LockLayerSelection)[]) {
    if (typeof layersRaw[id] === "boolean") layers[id] = layersRaw[id] as boolean;
  }

  const kind: LockSourceKind =
    r.kind === "airspace" || r.kind === "live" ? r.kind : "track";

  return {
    key: r.key,
    kind,
    name: typeof r.name === "string" && r.name ? r.name : r.key,
    sub: typeof r.sub === "string" ? r.sub : "",
    favorite: r.favorite === true,
    savedAt: num(r.savedAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
    measurement,
    targetId: typeof r.targetId === "string" ? r.targetId : "smart",
    strength: Math.max(0, Math.min(1.5, num(r.strength, 1))),
    vetoes: isNumArray(r.vetoes) ? r.vetoes : [],
    curveEdits,
    layers,
    curve,
    masterMoves:
      r.masterMoves && typeof r.masterMoves === "object"
        ? (r.masterMoves as Partial<SoundParams>)
        : {},
    restore:
      r.restore && typeof r.restore === "object"
        ? (r.restore as Partial<RestoreParams>)
        : {},
    clarity: Math.max(0, Math.min(1, num(r.clarity, 0))),
    outputTrimDb: Math.max(-6, Math.min(0, num(r.outputTrimDb, 0))),
    matchBeforePct: num(r.matchBeforePct, 0),
    matchAfterPct: num(r.matchAfterPct, 0),
    contentLabel: typeof r.contentLabel === "string" ? r.contentLabel : null,
    fingerprint:
      typeof r.fingerprint === "string" && r.fingerprint
        ? r.fingerprint
        : measurementFingerprint(measurement),
    v: LOCK_RECORD_VERSION,
  };
}

function loadRecords(): Record<string, LockRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    const out: Record<string, LockRecord> = {};
    if (p.records && typeof p.records === "object") {
      for (const rec of Object.values(p.records as Record<string, unknown>)) {
        const s = sanitizeLockRecord(rec);
        if (s) out[s.key] = s;
      }
    }
    return out;
  } catch {
    return {};
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(records: Record<string, LockRecord>): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, records }));
    } catch (err) {
      console.warn("[lockLibrary] persist failed:", err);
      void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
        reportStorageFailure("Lock Library", err),
      );
    }
  }, 300);
}

function enforceCap(records: Record<string, LockRecord>): Record<string, LockRecord> {
  const all = Object.values(records);
  if (all.length <= MAX_RECORDS) return records;
  const evictable = all.filter((r) => !r.favorite).sort((a, b) => a.updatedAt - b.updatedAt);
  const out = { ...records };
  for (let i = 0; i < all.length - MAX_RECORDS && i < evictable.length; i++) {
    delete out[evictable[i].key];
  }
  return out;
}

// ── Store ───────────────────────────────────────────────────────────────────

interface LockLibraryState {
  records: Record<string, LockRecord>;

  upsert: (rec: LockRecord) => void;
  remove: (key: string) => void;
  toggleFavorite: (key: string) => void;
  rename: (key: string, name: string) => void;
  clearAll: () => void;

  /** Re-apply a stored lock verbatim. Returns false when the key is unknown. */
  applyRecord: (key: string) => Promise<boolean>;

  /** Export records (all, or the given keys) as a `.klock` pack. */
  exportPack: (keys?: string[]) => Promise<boolean>;
  /** Import a `.klock` pack — returns how many records landed. */
  importPack: () => Promise<number>;
}

export const useLockLibraryStore = create<LockLibraryState>((set, get) => ({
  records: loadRecords(),

  upsert: (rec) => {
    const prev = get().records[rec.key];
    const next = enforceCap({
      ...get().records,
      [rec.key]: {
        ...rec,
        savedAt: prev?.savedAt ?? rec.savedAt,
        favorite: prev?.favorite ?? rec.favorite,
        updatedAt: Date.now(),
      },
    });
    set({ records: next });
    schedulePersist(next);
  },

  remove: (key) => {
    if (!get().records[key]) return;
    const next = { ...get().records };
    delete next[key];
    set({ records: next });
    schedulePersist(next);
  },

  toggleFavorite: (key) => {
    const r = get().records[key];
    if (!r) return;
    const next = { ...get().records, [key]: { ...r, favorite: !r.favorite } };
    set({ records: next });
    schedulePersist(next);
  },

  rename: (key, name) => {
    const r = get().records[key];
    const trimmed = name.trim().slice(0, 80);
    if (!r || !trimmed) return;
    const next = { ...get().records, [key]: { ...r, name: trimmed } };
    set({ records: next });
    schedulePersist(next);
  },

  clearAll: () => {
    const favorites = Object.fromEntries(
      Object.entries(get().records).filter(([, r]) => r.favorite),
    );
    set({ records: favorites });
    schedulePersist(favorites);
  },

  applyRecord: async (key) => {
    const r = get().records[key];
    if (!r) return false;
    const { useAudioStore } = await import("@/state/audioStore");
    const { useEqStore } = await import("@/state/eqStore");
    const a = useAudioStore.getState();

    if (r.layers.eq && r.curve.length > 0) {
      useEqStore.getState().applyGainCurve((f) => sampleCurveDb(r.curve, f));
    }
    if (r.layers.master && Object.keys(r.masterMoves).length > 0) {
      a.setParams(r.masterMoves);
    }
    if (r.layers.restore && Object.keys(r.restore).length > 0) {
      a.setRestore(r.restore);
    }
    if (r.layers.clarity && r.clarity > 0) {
      a.setClarity(Math.max(a.clarity, r.clarity));
    }
    // Output trim is deliberately NOT re-applied on restore — it compounds
    // (each restore would trim further); the stored chain gain is absolute
    // and the user may have re-adjusted since.

    const { setLastAppliedTractor } = await import("@/lib/tractorApplied");
    setLastAppliedTractor({
      curve: r.curve,
      targetId: r.targetId,
      strength: r.strength,
      contentLabel: r.contentLabel,
      fullChain: r.layers.master || r.layers.restore || r.layers.clarity,
      at: Date.now(),
      matchPct: r.matchAfterPct,
      sourceName: r.name,
    });
    return true;
  },

  exportPack: async (keys) => {
    const files = window.playground?.files;
    if (!files) return false;
    const all = get().records;
    const chosen = keys && keys.length > 0 ? keys.map((k) => all[k]).filter(Boolean) : Object.values(all);
    if (chosen.length === 0) return false;
    const payload = {
      kind: "kill-chain-lock-pack",
      v: LOCK_RECORD_VERSION,
      exportedAt: Date.now(),
      records: chosen,
    };
    const json = JSON.stringify(payload, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const out = await files.save(
      `locks-${new Date().toISOString().slice(0, 10)}.klock`,
      [{ name: "Kill-Chain lock pack", extensions: ["klock", "json"] }],
      base64,
    );
    return out !== null;
  },

  importPack: async () => {
    const files = window.playground?.files;
    if (!files) return 0;
    const res = await files.openText([
      { name: "Kill-Chain lock pack", extensions: ["klock", "json"] },
    ]);
    if (!res) return 0;
    try {
      const data = JSON.parse(res.text) as { kind?: string; records?: unknown[] };
      if (data.kind !== "kill-chain-lock-pack" || !Array.isArray(data.records)) return 0;
      let landed = 0;
      let next = { ...get().records };
      for (const raw of data.records) {
        const rec = sanitizeLockRecord(raw);
        if (!rec) continue;
        const prev = next[rec.key];
        next[rec.key] = {
          ...rec,
          savedAt: prev?.savedAt ?? rec.savedAt,
          favorite: prev?.favorite || rec.favorite,
          updatedAt: Date.now(),
        };
        landed++;
      }
      next = enforceCap(next);
      set({ records: next });
      schedulePersist(next);
      return landed;
    } catch {
      return 0;
    }
  },
}));

/** Best record for the given source key (exact match only). */
export function lookupLock(key: string): LockRecord | null {
  return useLockLibraryStore.getState().records[key] ?? null;
}
