import { create } from "zustand";
import {
  captureChain,
  sanitizeChainSnapshot,
  chainFromLegacyParams,
  applyChain,
  type ChainSnapshot,
} from "@/lib/chainSnapshot";
import { airspaceSourceId } from "@/lib/airspaceMedia";
import { useAirspaceStore } from "@/state/airspaceStore";

/**
 * SourceMemory (v2.4) — ONE versioned per-source record for everything the
 * app remembers about a source. Presented in the UI as the "Mission Log".
 *
 * A record stores a complete ChainSnapshot (params, Sculptor bands,
 * Restoration Bay, Clarity, room/balance, output gain, Cinema/Music voicing,
 * the Tractor lock and the 3D scene) plus v2.4 references:
 *
 *   · lockKey        — the Lock Library record for this source (referenced,
 *                      not copied — the measurement/manifest live there).
 *   · armoryPresetId — the Armory loadout the chain came from, referenced so
 *                      later edits to the loadout follow the source.
 *
 * Keyed by WHAT is playing:
 *
 *   file:<absolute path>          a specific local track
 *   album:<artist>|<album>        every track of an album
 *   pl:<playlist id>              every track of a playlist
 *   air:yt:<video id> etc.        an Airspace source (see airspaceSourceId)
 *
 * Restore is orchestrated by MISSION STATE (missionStateStore) — this store
 * no longer runs its own watcher. Migration: v1 Mission Log entries and the
 * legacy per-track EQ memory both upgrade in place on load. Sessions travel
 * as `.kcsession` packs (records + their referenced lock records).
 */

const STORAGE_KEY = "killchain.missionLog.v1";
const LEGACY_TRACK_EQ_KEY = "audio-playground.trackEq.v1";
const MAX_ENTRIES = 500;

export const SOURCE_MEMORY_VERSION = 2;

export type MissionSourceKind = "track" | "album" | "playlist" | "airspace";

export interface SourceMemory {
  key: string;
  kind: MissionSourceKind;
  /** Display label — track title, album name, playlist name, video title. */
  name: string;
  /** Secondary label — artist, channel, … */
  sub: string;
  chain: ChainSnapshot;
  savedAt: number;
  updatedAt: number;
  pinned: boolean;
  /** Record schema version (1 = pre-2.4 Mission Log entry). */
  v: number;
  /** v2.4 — Lock Library record key for this source (reference, not copy). */
  lockKey: string | null;
  /** v2.4 — Armory loadout this chain came from (reference, not copy). */
  armoryPresetId: string | null;
}

/** Back-compat alias — the Mission Log UI predates the SourceMemory name. */
export type MissionLogEntry = SourceMemory;

// ── Source keys ────────────────────────────────────────────────────────────

export const trackKey = (path: string) => `file:${path}`;
export const albumKey = (artist: string, album: string) =>
  `album:${(artist || "?").toLowerCase()}|${(album || "?").toLowerCase()}`;
export const playlistKey = (id: string) => `pl:${id}`;

/** Mission Log key for what's playing in Airspace right now (null if idle). */
export function currentAirspaceKey(): string | null {
  const media = useAirspaceStore.getState().media;
  if (!media) return null;
  return airspaceSourceId(media);
}

// ── Armory reference tracking ──────────────────────────────────────────────
// When the user deploys an Armory loadout, the presets view calls
// noteArmoryApplied(). The NEXT chain save for a source records that id as a
// reference; any manual chain edit clears it (the chain no longer IS the
// loadout).

let lastArmoryPresetId: string | null = null;

export function noteArmoryApplied(presetId: string | null): void {
  lastArmoryPresetId = presetId;
}

export function getLastArmoryApplied(): string | null {
  return lastArmoryPresetId;
}

// ── Persistence ────────────────────────────────────────────────────────────

interface Persisted {
  entries: Record<string, SourceMemory>;
  autoRestore: boolean;
  migratedTrackEq: boolean;
}

const KINDS: MissionSourceKind[] = ["track", "album", "playlist", "airspace"];

export function sanitizeSourceMemory(key: string, e: unknown): SourceMemory | null {
  if (!e || typeof e !== "object") return null;
  const r = e as Partial<SourceMemory>;
  const chain = sanitizeChainSnapshot(r.chain);
  if (!chain) return null;
  return {
    key,
    kind: KINDS.includes(r.kind as MissionSourceKind) ? (r.kind as MissionSourceKind) : "track",
    name: typeof r.name === "string" ? r.name : key,
    sub: typeof r.sub === "string" ? r.sub : "",
    chain,
    savedAt: Number(r.savedAt ?? Date.now()),
    updatedAt: Number(r.updatedAt ?? r.savedAt ?? Date.now()),
    pinned: r.pinned === true,
    // v1 records upgrade in place: the references simply start empty.
    v: SOURCE_MEMORY_VERSION,
    lockKey: typeof r.lockKey === "string" && r.lockKey ? r.lockKey : null,
    armoryPresetId:
      typeof r.armoryPresetId === "string" && r.armoryPresetId ? r.armoryPresetId : null,
  };
}

function loadPersisted(): Persisted {
  const empty: Persisted = { entries: {}, autoRestore: true, migratedTrackEq: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw);
    const entries: Record<string, SourceMemory> = {};
    if (p.entries && typeof p.entries === "object") {
      for (const [key, e] of Object.entries(p.entries as Record<string, unknown>)) {
        const s = sanitizeSourceMemory(key, e);
        if (s) entries[key] = s;
      }
    }
    return {
      entries,
      autoRestore: p.autoRestore !== false,
      migratedTrackEq: p.migratedTrackEq === true,
    };
  } catch {
    return empty;
  }
}

/**
 * One-time import of the legacy per-track EQ memory (SoundParams only) so
 * nobody loses their saved tracks when upgrading to 1.5+.
 */
function migrateLegacy(persisted: Persisted): Persisted {
  if (persisted.migratedTrackEq) return persisted;
  const out = { ...persisted, entries: { ...persisted.entries }, migratedTrackEq: true };
  try {
    const raw = localStorage.getItem(LEGACY_TRACK_EQ_KEY);
    if (!raw) return out;
    const p = JSON.parse(raw);
    if (p.entries && typeof p.entries === "object") {
      for (const [path, e] of Object.entries(p.entries as Record<string, { params?: object; savedAt?: number }>)) {
        const key = trackKey(path);
        if (out.entries[key] || !e || typeof e !== "object" || !e.params) continue;
        const fileName = path.split(/[\\/]/).pop() ?? path;
        out.entries[key] = {
          key,
          kind: "track",
          name: fileName.replace(/\.[^.]+$/, ""),
          sub: "",
          chain: chainFromLegacyParams(e.params),
          savedAt: Number(e.savedAt ?? Date.now()),
          updatedAt: Number(e.savedAt ?? Date.now()),
          pinned: false,
          v: SOURCE_MEMORY_VERSION,
          lockKey: null,
          armoryPresetId: null,
        };
      }
    }
    out.autoRestore = p.autoApply !== false && persisted.autoRestore;
  } catch {
    /* legacy store unreadable — nothing to migrate */
  }
  return out;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(state: Pick<MissionLogState, "entries" | "autoRestore">): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          entries: state.entries,
          autoRestore: state.autoRestore,
          migratedTrackEq: true,
        }),
      );
    } catch (err) {
      console.warn("[missionLog] persist failed:", err);
      void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
        reportStorageFailure("Mission Log", err),
      );
    }
  }, 250);
}

/** Drop the oldest unpinned entries once we're over the cap. */
function enforceCap(entries: Record<string, SourceMemory>): Record<string, SourceMemory> {
  const all = Object.values(entries);
  if (all.length <= MAX_ENTRIES) return entries;
  const evictable = all
    .filter((e) => !e.pinned)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const out = { ...entries };
  for (let i = 0; i < all.length - MAX_ENTRIES && i < evictable.length; i++) {
    delete out[evictable[i].key];
  }
  return out;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface MissionLogState {
  entries: Record<string, SourceMemory>;
  /** Master switch: restore a saved chain when its source plays again. */
  autoRestore: boolean;

  /** Snapshot the live chain under a source key. */
  saveEntry: (key: string, kind: MissionSourceKind, name: string, sub?: string) => void;
  removeEntry: (key: string) => void;
  togglePin: (key: string) => void;
  renameEntry: (key: string, name: string) => void;
  setAutoRestore: (on: boolean) => void;
  /** Apply a saved chain to the live DSP. Returns false if key is unknown. */
  applyEntry: (key: string) => boolean;
  clearAll: () => void;

  /** Export the whole session (records + referenced locks) as `.kcsession`. */
  exportSession: () => Promise<boolean>;
  /** Import a `.kcsession` pack — returns how many records landed. */
  importSession: () => Promise<number>;
  /** Apply a Kill-Chain backup Mission Log slice. */
  applyBackup: (
    data: { entries: Record<string, SourceMemory>; autoRestore?: boolean },
    mode: "merge" | "replace",
  ) => void;
}

export const useMissionLogStore = create<MissionLogState>((set, get) => {
  const initial = migrateLegacy(loadPersisted());
  // Write back straight away so the migration flag sticks.
  schedulePersist(initial);

  return {
    entries: initial.entries,
    autoRestore: initial.autoRestore,

    saveEntry: (key, kind, name, sub = "") => {
      const prev = get().entries[key];
      const now = Date.now();
      // Reference the Lock Library record for this source, if one exists.
      let lockKey: string | null = null;
      try {
        // Dynamic require avoided: lockLibraryStore imports nothing from us.
        // A stale reference is harmless — applyEntry re-checks existence.
        const mod = lockLibraryPeek?.();
        if (mod && mod.records[key]) lockKey = key;
      } catch { /* lock library unavailable */ }
      const entry: SourceMemory = {
        key,
        kind,
        name: name || key,
        sub,
        chain: captureChain(),
        savedAt: prev?.savedAt ?? now,
        updatedAt: now,
        pinned: prev?.pinned ?? false,
        v: SOURCE_MEMORY_VERSION,
        lockKey,
        armoryPresetId: lastArmoryPresetId,
      };
      const entries = enforceCap({ ...get().entries, [key]: entry });
      set({ entries });
      schedulePersist({ entries, autoRestore: get().autoRestore });
    },

    removeEntry: (key) => {
      if (!get().entries[key]) return;
      const entries = { ...get().entries };
      delete entries[key];
      set({ entries });
      schedulePersist({ entries, autoRestore: get().autoRestore });
    },

    togglePin: (key) => {
      const e = get().entries[key];
      if (!e) return;
      const entries = { ...get().entries, [key]: { ...e, pinned: !e.pinned } };
      set({ entries });
      schedulePersist({ entries, autoRestore: get().autoRestore });
    },

    renameEntry: (key, name) => {
      const e = get().entries[key];
      const trimmed = name.trim().slice(0, 80);
      if (!e || !trimmed) return;
      const entries = { ...get().entries, [key]: { ...e, name: trimmed } };
      set({ entries });
      schedulePersist({ entries, autoRestore: get().autoRestore });
    },

    setAutoRestore: (on) => {
      set({ autoRestore: on });
      schedulePersist({ entries: get().entries, autoRestore: on });
    },

    applyEntry: (key) => {
      const e = get().entries[key];
      if (!e) return false;
      applyChain(e.chain);
      // Armory reference semantics: the loadout is referenced, not copied —
      // if it still exists, its CURRENT values ride on top of the chain.
      if (e.armoryPresetId) {
        void import("@/state/userPresetsStore").then(({ useUserPresetsStore }) => {
          const preset = useUserPresetsStore
            .getState()
            .presets.find((p) => p.id === e.armoryPresetId);
          if (!preset) return;
          void import("@/state/audioStore").then(({ useAudioStore }) => {
            const a = useAudioStore.getState();
            a.replaceParams(preset.params);
            if (preset.repair) {
              a.setRestore(preset.repair.restore);
              a.setClarity(preset.repair.clarity);
            }
          });
        });
      }
      return true;
    },

    clearAll: () => {
      const pinned = Object.fromEntries(
        Object.entries(get().entries).filter(([, e]) => e.pinned),
      );
      set({ entries: pinned });
      schedulePersist({ entries: pinned, autoRestore: get().autoRestore });
    },

    exportSession: async () => {
      const files = window.playground?.files;
      if (!files) return false;
      const entries = Object.values(get().entries);
      if (entries.length === 0) return false;
      // Bundle the referenced lock records so the session travels complete.
      let locks: unknown[] = [];
      try {
        const { useLockLibraryStore } = await import("@/state/lockLibraryStore");
        const all = useLockLibraryStore.getState().records;
        locks = entries
          .map((e) => (e.lockKey ? all[e.lockKey] : null))
          .filter((r) => r !== null && r !== undefined);
      } catch { /* lock library unavailable */ }
      const payload = {
        kind: "kill-chain-session",
        v: SOURCE_MEMORY_VERSION,
        exportedAt: Date.now(),
        entries,
        locks,
      };
      const json = JSON.stringify(payload, null, 2);
      const base64 = btoa(unescape(encodeURIComponent(json)));
      const out = await files.save(
        `session-${new Date().toISOString().slice(0, 10)}.kcsession`,
        [{ name: "Kill-Chain session", extensions: ["kcsession", "json"] }],
        base64,
      );
      return out !== null;
    },

    importSession: async () => {
      const files = window.playground?.files;
      if (!files) return 0;
      const res = await files.openText([
        { name: "Kill-Chain session", extensions: ["kcsession", "json"] },
      ]);
      if (!res) return 0;
      try {
        const data = JSON.parse(res.text) as {
          kind?: string;
          entries?: unknown[];
          locks?: unknown[];
        };
        if (data.kind !== "kill-chain-session" || !Array.isArray(data.entries)) return 0;
        let landed = 0;
        let entries = { ...get().entries };
        for (const raw of data.entries) {
          const key = (raw as { key?: unknown })?.key;
          if (typeof key !== "string" || !key) continue;
          const s = sanitizeSourceMemory(key, raw);
          if (!s) continue;
          const prev = entries[key];
          entries[key] = {
            ...s,
            savedAt: prev?.savedAt ?? s.savedAt,
            pinned: prev?.pinned || s.pinned,
            updatedAt: Date.now(),
          };
          landed++;
        }
        entries = enforceCap(entries);
        set({ entries });
        schedulePersist({ entries, autoRestore: get().autoRestore });
        // Restore the bundled lock records too.
        if (Array.isArray(data.locks) && data.locks.length > 0) {
          const { useLockLibraryStore, sanitizeLockRecord } = await import(
            "@/state/lockLibraryStore"
          );
          for (const raw of data.locks) {
            const rec = sanitizeLockRecord(raw);
            if (rec) useLockLibraryStore.getState().upsert(rec);
          }
        }
        return landed;
      } catch {
        return 0;
      }
    },

    applyBackup: (data, mode) => {
      const incoming: Record<string, SourceMemory> = {};
      if (data.entries && typeof data.entries === "object") {
        for (const [key, raw] of Object.entries(data.entries)) {
          const s = sanitizeSourceMemory(key, raw);
          if (s) incoming[key] = s;
        }
      }
      let entries: Record<string, SourceMemory>;
      if (mode === "replace") {
        entries = enforceCap(incoming);
      } else {
        entries = { ...get().entries };
        for (const [key, s] of Object.entries(incoming)) {
          const prev = entries[key];
          entries[key] = {
            ...s,
            savedAt: prev?.savedAt ?? s.savedAt,
            pinned: prev?.pinned || s.pinned,
            updatedAt: Date.now(),
          };
        }
        entries = enforceCap(entries);
      }
      const autoRestore =
        typeof data.autoRestore === "boolean" ? data.autoRestore : get().autoRestore;
      set({ entries, autoRestore });
      schedulePersist({ entries, autoRestore });
    },
  };
});

// Lazy peek at the lock library without a static import (avoids a module
// cycle: lockLibraryStore → tractorLock → chainSnapshot territory).
type LockLibraryPeek = () => { records: Record<string, unknown> } | null;
let lockLibraryPeek: LockLibraryPeek | null = null;
void import("@/state/lockLibraryStore")
  .then((m) => {
    lockLibraryPeek = () => m.useLockLibraryStore.getState();
  })
  .catch(() => { /* optional */ });

// ── Lookup helpers (consumed by MISSION STATE) ─────────────────────────────

/**
 * Best entry for a local file: exact track first, then its album, then the
 * playlist it's being played from (if any).
 */
export function lookupForTrack(
  path: string,
  opts: { artist?: string; album?: string; playlistId?: string | null } = {},
): SourceMemory | null {
  const entries = useMissionLogStore.getState().entries;
  const direct = entries[trackKey(path)];
  if (direct) return direct;
  if (opts.artist !== undefined || opts.album !== undefined) {
    const byAlbum = entries[albumKey(opts.artist ?? "", opts.album ?? "")];
    if (byAlbum) return byAlbum;
  }
  if (opts.playlistId) {
    const byPlaylist = entries[playlistKey(opts.playlistId)];
    if (byPlaylist) return byPlaylist;
  }
  return null;
}

/** True when the current playing source already has a saved chain. */
export function missionLogHasChainFor(sig: { kind: "file" | "air"; ident: string }): boolean {
  const s = useMissionLogStore.getState();
  if (!s.autoRestore) return false;
  if (sig.kind === "file") {
    return !!lookupForTrack(sig.ident);
  }
  const key = currentAirspaceKey();
  return key !== null && !!s.entries[key];
}

/** Snapshot the live chain for the Airspace page only. Never falls through
 *  to a Library track — the Airspace toolbar Log must not silently save the
 *  file player. Returns the entry name, or null when nothing identifiable
 *  is playing / routed. */
export async function logAirspaceSource(): Promise<string | null> {
  const { usePlayerStore } = await import("@/state/playerStore");
  const p = usePlayerStore.getState();
  const air = useAirspaceStore.getState().media;
  if (!air || air.paused || !p.loopbackActive) return null;
  const key = airspaceSourceId(air);
  if (!key) return null;
  const name = air.title || "Airspace source";
  useMissionLogStore.getState().saveEntry(key, "airspace", name, air.artist);
  return name;
}

/**
 * Snapshot the live chain under whatever is playing RIGHT NOW (Airspace
 * source wins while routed; else the current file). Returns the entry name,
 * or null when nothing identifiable is playing.
 */
export async function logCurrentSource(): Promise<string | null> {
  const { usePlayerStore } = await import("@/state/playerStore");
  const p = usePlayerStore.getState();
  const air = useAirspaceStore.getState().media;
  const log = useMissionLogStore.getState();

  if (air && !air.paused && p.loopbackActive) {
    const key = airspaceSourceId(air);
    if (key) {
      const name = air.title || "Airspace source";
      log.saveEntry(key, "airspace", name, air.artist);
      return name;
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
      log.saveEntry(trackKey(path), "track", name, track?.artist ?? "");
      return name;
    }
  }
  return null;
}
