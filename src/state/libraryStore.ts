import { create } from "zustand";
import { usePlayerStore, type QueueItem } from "@/state/playerStore";
import { useAudioStore } from "@/state/audioStore";

export type LibrarySortKey =
  | "title"
  | "artist"
  | "album"
  | "duration"
  | "added"
  | "plays";
export type SortDir = "asc" | "desc";
export type LibraryGroupBy = "none" | "artist" | "album";
/** List = virtualized rows; grid = album-art wall. */
export type LibraryViewMode = "list" | "grid";

/** Which slice of the library is on screen: everything, starred tracks,
 *  recently played, or one of the user's playlists ("pl:<id>"). */
export type LibraryCollection = "all" | "favorites" | "recent" | `pl:${string}`;

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  /** Track paths in play order. */
  paths: string[];
}

export interface LibraryTrack {
  /** Stable unique id — the absolute file path. */
  id: string;
  path: string;
  fileName: string;
  ext: string;
  size: number;
  mtimeMs: number;
  addedAt: number;
  title: string;
  artist: string;
  album: string;
  trackNo: number | null;
  year: number | null;
  durationSec: number | null;
  /** Average bitrate in bits/sec (e.g. 320000) — null until tags are read. */
  bitrate: number | null;
  /** Sample rate in Hz (e.g. 44100, 96000). */
  sampleRate: number | null;
  /** Bit depth for PCM/lossless (e.g. 16, 24). null for lossy/unknown. */
  bitsPerSample: number | null;
  /** True for lossless containers/codecs (FLAC, WAV, ALAC). */
  lossless: boolean | null;
  /** Codec / container short name (e.g. "FLAC", "MPEG 1 Layer 3"). */
  codec: string | null;
  /** First genre tag (e.g. "Electronic"). null = untagged / none in file. */
  genre: string | null;
  /** True once real tags were read (vs. derived from the path). */
  tagged: boolean;
}

const STORAGE_KEY = "audio-playground.library.v1";
/** Favorites / play counts / playlists live under their own key so they
 *  survive even when the big track list can't be persisted. */
const META_KEY = "audio-playground.libraryMeta.v1";
/** Above this many tracks we stop persisting the list (localStorage limit). */
const MAX_PERSIST_TRACKS = 5000;

/** Build the privileged-scheme URL the engine/loader understands. */
export function audioUrlForPath(p: string): string {
  return `playground-audio:///lib?p=${encodeURIComponent(p)}`;
}

/** Extract the original file path from a playground-audio src, if present. */
export function pathFromAudioSrc(src: string | null): string | null {
  if (!src || !src.includes("?p=")) return null;
  try {
    return decodeURIComponent(src.split("?p=")[1]);
  } catch {
    return null;
  }
}

/** Best-effort title/artist/album from the filename + folder layout. */
function deriveFromPath(p: string, fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "");
  // Drop a leading track number like "01 - ", "01. ", "01) ", "01 ".
  const title = base.replace(/^\s*\d{1,3}\s*[-_.)]\s*/, "").trim() || base;
  const parts = p.split(/[\\/]/).filter(Boolean);
  const album = parts.length >= 2 ? parts[parts.length - 2] : "Unknown album";
  const artist = parts.length >= 3 ? parts[parts.length - 3] : "Unknown artist";
  return { title, artist, album };
}

function isUnder(p: string, folder: string): boolean {
  const a = p.toLowerCase().replace(/\\/g, "/");
  const b = folder.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  return a === b || a.startsWith(b + "/");
}

function mergeTags(t: LibraryTrack, tags: Partial<LibraryTrack>): LibraryTrack {
  return {
    ...t,
    title: (tags.title && tags.title.trim()) || t.title,
    artist: (tags.artist && tags.artist.trim()) || t.artist,
    album: (tags.album && tags.album.trim()) || t.album,
    trackNo: tags.trackNo ?? t.trackNo,
    year: tags.year ?? t.year,
    durationSec: tags.durationSec ?? t.durationSec,
    bitrate: tags.bitrate ?? t.bitrate,
    sampleRate: tags.sampleRate ?? t.sampleRate,
    bitsPerSample: tags.bitsPerSample ?? t.bitsPerSample,
    lossless: tags.lossless ?? t.lossless,
    codec: tags.codec ?? t.codec,
    genre: tags.genre ?? t.genre,
    tagged: true,
  };
}

/** Set once if music-metadata can't load, so we stop retrying tag reads. */
let tagLibBroken = false;

async function parseTags(p: string): Promise<Partial<LibraryTrack> | null> {
  try {
    const resp = await fetch(audioUrlForPath(p));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const mm = await import("music-metadata");
    const { common, format } = await mm.parseBlob(blob, {
      // duration: true so every row gets an accurate time (costs a deeper read,
      // but it's background work and cached after the first scan).
      duration: true,
      skipCovers: true,
    });
    const codec = format.codec || format.container || null;
    return {
      title: common.title || undefined,
      artist:
        common.artist ||
        (common.artists && common.artists[0]) ||
        common.albumartist ||
        undefined,
      album: common.album || undefined,
      trackNo: common.track?.no ?? null,
      year: common.year ?? null,
      durationSec: format.duration ?? null,
      bitrate: format.bitrate ?? null,
      sampleRate: format.sampleRate ?? null,
      bitsPerSample: format.bitsPerSample ?? null,
      lossless: format.lossless ?? null,
      codec,
      genre: (common.genre && common.genre[0]) || null,
    };
  } catch {
    return null;
  }
}

interface Persisted {
  folders: string[];
  tracks: LibraryTrack[];
  sortKey: LibrarySortKey;
  sortDir: SortDir;
  groupBy: LibraryGroupBy;
  viewMode: LibraryViewMode;
}

function load(): Persisted {
  const empty: Persisted = {
    folders: [],
    tracks: [],
    sortKey: "artist",
    sortDir: "asc",
    groupBy: "none",
    viewMode: "list",
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw);
    const rawTracks: LibraryTrack[] = Array.isArray(p.tracks) ? p.tracks : [];
    // Migration: records saved before the technical-info fields existed get
    // the new fields back-filled to null and are flagged for a one-time
    // re-read so format / bitrate / sample-rate show up without a rescan.
    const tracks = rawTracks.map((t) => {
      const hasTech = (t as Partial<LibraryTrack>).bitrate !== undefined;
      // v1.5 migration: records saved before `genre` existed get re-read once
      // (background enrichment) so genre chips work without a manual rescan.
      const hasGenre = (t as Partial<LibraryTrack>).genre !== undefined;
      return {
        ...t,
        bitrate: t.bitrate ?? null,
        sampleRate: t.sampleRate ?? null,
        bitsPerSample: t.bitsPerSample ?? null,
        lossless: t.lossless ?? null,
        codec: t.codec ?? null,
        genre: t.genre ?? null,
        tagged: hasTech && hasGenre ? !!t.tagged : false,
      };
    });
    return {
      folders: Array.isArray(p.folders) ? p.folders : [],
      tracks,
      sortKey: p.sortKey ?? "artist",
      sortDir: p.sortDir ?? "asc",
      groupBy: p.groupBy ?? "none",
      viewMode: p.viewMode === "grid" ? "grid" : "list",
    };
  } catch {
    return empty;
  }
}

interface PersistedMeta {
  favorites: string[];
  playCounts: Record<string, number>;
  lastPlayed: Record<string, number>;
  playlists: Playlist[];
}

function loadMeta(): PersistedMeta {
  const empty: PersistedMeta = {
    favorites: [],
    playCounts: {},
    lastPlayed: {},
    playlists: [],
  };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw);
    return {
      favorites: Array.isArray(p.favorites) ? p.favorites.filter((f: unknown) => typeof f === "string") : [],
      playCounts: p.playCounts && typeof p.playCounts === "object" ? p.playCounts : {},
      lastPlayed: p.lastPlayed && typeof p.lastPlayed === "object" ? p.lastPlayed : {},
      playlists: Array.isArray(p.playlists)
        ? p.playlists
            .filter((pl: unknown) => pl && typeof pl === "object")
            .map((pl: Partial<Playlist>) => ({
              id: String(pl.id ?? newPlaylistId()),
              name: String(pl.name ?? "Playlist"),
              createdAt: Number(pl.createdAt ?? Date.now()),
              paths: Array.isArray(pl.paths) ? pl.paths.filter((x: unknown) => typeof x === "string") : [],
            }))
        : [],
    };
  } catch {
    return empty;
  }
}

function newPlaylistId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `pl-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

interface LibraryState {
  folders: string[];
  tracks: LibraryTrack[];
  scanning: boolean;
  /** How many tracks still need tag reading (for a small progress hint). */
  pendingTags: number;
  sortKey: LibrarySortKey;
  sortDir: SortDir;
  groupBy: LibraryGroupBy;
  viewMode: LibraryViewMode;
  search: string;
  /** Genre chip filter (exact match against LibraryTrack.genre). */
  genreFilter: string | null;
  /** Which slice is on screen (all / favorites / recent / a playlist). */
  collection: LibraryCollection;

  /** Favorite track paths (set semantics via a record for cheap lookups). */
  favorites: Record<string, true>;
  /** Lifetime play counts keyed by track path. */
  playCounts: Record<string, number>;
  /** Last-played timestamps (ms) keyed by track path. */
  lastPlayed: Record<string, number>;
  playlists: Playlist[];

  available: () => boolean;
  addFolders: () => Promise<void>;
  rescan: () => Promise<void>;
  /**
   * Register the managed Fire export folder (if needed) and upsert one track
   * with known metadata — used after Fire Command → Library export.
   */
  ingestExportedTrack: (opts: {
    path: string;
    title: string;
    artist: string;
    album: string;
    durationSec?: number | null;
    genre?: string | null;
  }) => Promise<LibraryTrack | null>;
  removeFolder: (folder: string) => void;
  clearAll: () => void;
  setSort: (key: LibrarySortKey) => void;
  setGroupBy: (g: LibraryGroupBy) => void;
  setViewMode: (m: LibraryViewMode) => void;
  setSearch: (q: string) => void;
  setGenreFilter: (g: string | null) => void;
  setCollection: (c: LibraryCollection) => void;

  toggleFavorite: (path: string) => void;
  /** Bump play count + recency for a track (called when playback starts). */
  recordPlay: (path: string) => void;

  createPlaylist: (name: string, paths?: string[]) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, paths: string[]) => void;
  removeFromPlaylist: (id: string, path: string) => void;
  /** Move a track within a playlist (drag-to-reorder). */
  movePlaylistItem: (id: string, from: number, to: number) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const initial = load();
  const initialMeta = loadMeta();

  let persistTimer: number | null = null;
  const schedulePersist = () => {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      const s = get();
      try {
        const tracks = s.tracks.length <= MAX_PERSIST_TRACKS ? s.tracks : [];
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            folders: s.folders,
            tracks,
            sortKey: s.sortKey,
            sortDir: s.sortDir,
            groupBy: s.groupBy,
            viewMode: s.viewMode,
          }),
        );
      } catch (err) {
        console.warn("[library] persist failed:", err);
      }
    }, 600);
  };

  let metaTimer: number | null = null;
  const schedulePersistMeta = () => {
    if (metaTimer) window.clearTimeout(metaTimer);
    metaTimer = window.setTimeout(() => {
      metaTimer = null;
      const s = get();
      try {
        const meta: PersistedMeta = {
          favorites: Object.keys(s.favorites),
          playCounts: s.playCounts,
          lastPlayed: s.lastPlayed,
          playlists: s.playlists,
        };
        localStorage.setItem(META_KEY, JSON.stringify(meta));
      } catch (err) {
        console.warn("[library] meta persist failed:", err);
      }
    }, 400);
  };

  let enriching = false;
  const runEnrichment = async () => {
    if (enriching || tagLibBroken) return;
    enriching = true;
    try {
      try {
        await import("music-metadata");
      } catch {
        tagLibBroken = true;
        return;
      }

      const CONCURRENCY = 4;
      const pending = get().tracks.filter((t) => !t.tagged);
      set({ pendingTags: pending.length });
      let idx = 0;
      const updates = new Map<string, Partial<LibraryTrack>>();
      let lastFlush = performance.now();

      const flush = () => {
        if (updates.size === 0) return;
        const map = new Map(updates);
        updates.clear();
        set((s) => ({
          tracks: s.tracks.map((t) =>
            map.has(t.id) ? mergeTags(t, map.get(t.id)!) : t,
          ),
          pendingTags: s.tracks.filter((t) => !t.tagged && !map.has(t.id)).length,
        }));
        schedulePersist();
      };

      const worker = async () => {
        while (idx < pending.length) {
          const t = pending[idx++];
          const fresh = get().tracks.find((x) => x.id === t.id);
          if (!fresh || fresh.tagged) continue;
          const tags = await parseTags(t.path);
          // Even on failure, mark tagged so we stop retrying this file.
          updates.set(t.id, tags ?? {});
          const now = performance.now();
          if (updates.size >= 30 || now - lastFlush > 500) {
            flush();
            lastFlush = now;
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      flush();
      set({ pendingTags: 0 });
    } finally {
      enriching = false;
    }
    // Pick up any tracks added while we were running.
    if (!tagLibBroken && get().tracks.some((t) => !t.tagged)) {
      void runEnrichment();
    }
  };

  // On launch, fill in tech info for any persisted records that still need it
  // (the Library view only auto-rescans when the list is empty, so migrated
  // records would otherwise sit without bitrate / sample-rate until a rescan).
  if (initial.tracks.some((t) => !t.tagged)) {
    setTimeout(() => void runEnrichment(), 800);
  }

  return {
    folders: initial.folders,
    tracks: initial.tracks,
    scanning: false,
    pendingTags: 0,
    sortKey: initial.sortKey,
    sortDir: initial.sortDir,
    groupBy: initial.groupBy,
    viewMode: initial.viewMode,
    search: "",
    genreFilter: null,
    collection: "all",

    favorites: Object.fromEntries(initialMeta.favorites.map((f) => [f, true as const])),
    playCounts: initialMeta.playCounts,
    lastPlayed: initialMeta.lastPlayed,
    playlists: initialMeta.playlists,

    available: () => !!window.playground?.library,

    addFolders: async () => {
      const api = window.playground?.library;
      if (!api) return;
      const picked = await api.pickFolders();
      if (!picked || picked.length === 0) return;
      const folders = Array.from(new Set([...get().folders, ...picked]));
      set({ folders });
      schedulePersist();
      await get().rescan();
    },

    ingestExportedTrack: async (opts) => {
      const api = window.playground?.library;
      if (!api?.getExportDir || !api.statFile) return null;
      const exportDir = await api.getExportDir();
      if (!exportDir) return null;
      // Keep the export folder registered so Library scans find future bounces.
      if (!get().folders.some((f) => f.toLowerCase() === exportDir.toLowerCase())) {
        set({ folders: [...get().folders, exportDir] });
        schedulePersist();
      }
      const entry = await api.statFile(opts.path);
      if (!entry) return null;
      const existing = get().tracks.find((t) => t.path === entry.path);
      const track: LibraryTrack = {
        id: entry.path,
        path: entry.path,
        fileName: entry.name,
        ext: entry.ext,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        addedAt: existing?.addedAt ?? Date.now(),
        title: opts.title.trim() || existing?.title || deriveFromPath(entry.path, entry.name).title,
        artist: opts.artist.trim() || existing?.artist || "Kill-Chain",
        album: opts.album.trim() || existing?.album || "Fire Command Exports",
        trackNo: existing?.trackNo ?? null,
        year: existing?.year ?? new Date().getFullYear(),
        durationSec: opts.durationSec ?? existing?.durationSec ?? null,
        bitrate: entry.ext === ".mp3" ? 320000 : existing?.bitrate ?? null,
        sampleRate: existing?.sampleRate ?? null,
        bitsPerSample: entry.ext === ".wav" ? 16 : existing?.bitsPerSample ?? null,
        lossless: entry.ext === ".wav" ? true : entry.ext === ".mp3" ? false : existing?.lossless ?? null,
        codec: entry.ext === ".mp3" ? "MPEG 1 Layer 3" : entry.ext === ".wav" ? "PCM" : existing?.codec ?? null,
        genre: opts.genre ?? existing?.genre ?? "Electronic",
        tagged: true,
      };
      const tracks = existing
        ? get().tracks.map((t) => (t.path === track.path ? track : t))
        : [track, ...get().tracks];
      set({ tracks });
      schedulePersist();
      return track;
    },

    rescan: async () => {
      const api = window.playground?.library;
      if (!api) return;
      const folders = get().folders;
      if (folders.length === 0) {
        set({ tracks: [] });
        schedulePersist();
        return;
      }
      set({ scanning: true });
      try {
        const entries = await api.scan(folders);
        const prev = new Map(get().tracks.map((t) => [t.path, t]));
        const tracks: LibraryTrack[] = entries.map((e) => {
          const existing = prev.get(e.path);
          // Unchanged file → keep the (possibly tagged) record we already have.
          if (existing && existing.mtimeMs === e.mtimeMs) return existing;
          const d = deriveFromPath(e.path, e.name);
          return {
            id: e.path,
            path: e.path,
            fileName: e.name,
            ext: e.ext,
            size: e.size,
            mtimeMs: e.mtimeMs,
            addedAt: existing?.addedAt ?? Date.now(),
            title: d.title,
            artist: d.artist,
            album: d.album,
            trackNo: null,
            year: null,
            durationSec: null,
            bitrate: null,
            sampleRate: null,
            bitsPerSample: null,
            lossless: null,
            codec: null,
            genre: null,
            tagged: false,
          };
        });
        set({ tracks });
        schedulePersist();
        void runEnrichment();
      } catch (err) {
        console.error("[library] scan failed:", err);
      } finally {
        set({ scanning: false });
      }
    },

    removeFolder: (folder) => {
      const folders = get().folders.filter((f) => f !== folder);
      const tracks = get().tracks.filter((t) => !isUnder(t.path, folder));
      set({ folders, tracks });
      schedulePersist();
    },

    clearAll: () => {
      set({ folders: [], tracks: [] });
      schedulePersist();
    },

    setSort: (key) => {
      const { sortKey, sortDir } = get();
      if (key === sortKey) {
        set({ sortDir: sortDir === "asc" ? "desc" : "asc" });
      } else {
        set({ sortKey: key, sortDir: "asc" });
      }
      schedulePersist();
    },

    setGroupBy: (g) => {
      set({ groupBy: g });
      schedulePersist();
    },

    setViewMode: (m) => {
      set({ viewMode: m });
      schedulePersist();
    },

    setSearch: (q) => set({ search: q }),

    setGenreFilter: (g) => set({ genreFilter: g }),

    setCollection: (c) => {
      // Grouping is a flat-list concept; playlists keep their manual order.
      set({ collection: c });
    },

    toggleFavorite: (path) => {
      const favs = { ...get().favorites };
      if (favs[path]) delete favs[path];
      else favs[path] = true;
      set({ favorites: favs });
      schedulePersistMeta();
    },

    recordPlay: (path) => {
      set((s) => ({
        playCounts: { ...s.playCounts, [path]: (s.playCounts[path] ?? 0) + 1 },
        lastPlayed: { ...s.lastPlayed, [path]: Date.now() },
      }));
      schedulePersistMeta();
    },

    createPlaylist: (name, paths = []) => {
      const id = newPlaylistId();
      const pl: Playlist = {
        id,
        name: (name || "Playlist").trim().slice(0, 60) || "Playlist",
        createdAt: Date.now(),
        paths: [...new Set(paths)],
      };
      set((s) => ({ playlists: [...s.playlists, pl] }));
      schedulePersistMeta();
      return id;
    },

    renamePlaylist: (id, name) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      set((s) => ({
        playlists: s.playlists.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      }));
      schedulePersistMeta();
    },

    deletePlaylist: (id) => {
      set((s) => ({
        playlists: s.playlists.filter((p) => p.id !== id),
        collection: s.collection === `pl:${id}` ? "all" : s.collection,
      }));
      schedulePersistMeta();
    },

    addToPlaylist: (id, paths) => {
      set((s) => ({
        playlists: s.playlists.map((p) => {
          if (p.id !== id) return p;
          const have = new Set(p.paths);
          const add = paths.filter((x) => !have.has(x));
          return add.length ? { ...p, paths: [...p.paths, ...add] } : p;
        }),
      }));
      schedulePersistMeta();
    },

    removeFromPlaylist: (id, path) => {
      set((s) => ({
        playlists: s.playlists.map((p) =>
          p.id === id ? { ...p, paths: p.paths.filter((x) => x !== path) } : p,
        ),
      }));
      schedulePersistMeta();
    },

    movePlaylistItem: (id, from, to) => {
      set((s) => ({
        playlists: s.playlists.map((p) => {
          if (p.id !== id) return p;
          if (from < 0 || from >= p.paths.length || to < 0 || to >= p.paths.length || from === to)
            return p;
          const paths = [...p.paths];
          const [moved] = paths.splice(from, 1);
          paths.splice(to, 0, moved);
          return { ...p, paths };
        }),
      }));
      schedulePersistMeta();
    },
  };
});

export interface LibRowHeader {
  kind: "header";
  key: string;
  label: string;
  sub?: string;
  count: number;
  /** Index into orderedTracks of this group's first track (for play-all). */
  firstIndex: number;
}
export interface LibRowTrack {
  kind: "track";
  key: string;
  track: LibraryTrack;
  /** Index into the flattened ordered list (for queue playback). */
  playIndex: number;
}
export type LibRow = LibRowHeader | LibRowTrack;

const cmpStr = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** How many tracks the "Recent" collection shows at most. */
const RECENT_LIMIT = 200;

/**
 * Produce the visible rows + the flat ordered track list for the current
 * collection / search / sort / group settings. In grouped modes the rows
 * include header entries; in flat mode every row is a track. Playlist
 * collections keep their manual order (search still filters them).
 */
export function buildLibraryView(
  s: Pick<
    LibraryState,
    | "tracks"
    | "sortKey"
    | "sortDir"
    | "search"
    | "genreFilter"
    | "groupBy"
    | "collection"
    | "favorites"
    | "playCounts"
    | "lastPlayed"
    | "playlists"
  >,
): { orderedTracks: LibraryTrack[]; rows: LibRow[] } {
  const q = s.search.trim().toLowerCase();
  const matches = (t: LibraryTrack) =>
    (!s.genreFilter || t.genre === s.genreFilter) &&
    (!q ||
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q) ||
      (t.genre !== null && t.genre.toLowerCase().includes(q)));

  // ── Playlist collections: manual order wins over sort/group ──
  if (s.collection.startsWith("pl:")) {
    const pl = s.playlists.find((p) => `pl:${p.id}` === s.collection);
    const byPath = new Map(s.tracks.map((t) => [t.path, t]));
    const ordered = (pl?.paths ?? [])
      .map((p) => byPath.get(p))
      .filter((t): t is LibraryTrack => !!t && matches(t));
    return {
      orderedTracks: ordered,
      rows: ordered.map((t, i) => ({ kind: "track", key: t.id, track: t, playIndex: i })),
    };
  }

  let list = s.tracks.filter(matches);
  if (s.collection === "favorites") {
    list = list.filter((t) => s.favorites[t.path]);
  } else if (s.collection === "recent") {
    list = list
      .filter((t) => s.lastPlayed[t.path])
      .sort((a, b) => (s.lastPlayed[b.path] ?? 0) - (s.lastPlayed[a.path] ?? 0))
      .slice(0, RECENT_LIMIT);
    // Recency IS the order — skip sort/group below.
    return {
      orderedTracks: list,
      rows: list.map((t, i) => ({ kind: "track", key: t.id, track: t, playIndex: i })),
    };
  }
  const dir = s.sortDir === "asc" ? 1 : -1;

  // ── Flat (ungrouped) ──
  if (s.groupBy === "none") {
    const sorted = [...list].sort((a, b) => {
      switch (s.sortKey) {
        case "title":
          return cmpStr(a.title, b.title) * dir;
        case "album":
          return (
            (cmpStr(a.album, b.album) ||
              (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
              cmpStr(a.title, b.title)) * dir
          );
        case "duration":
          return ((a.durationSec ?? 0) - (b.durationSec ?? 0)) * dir;
        case "added":
          return (a.addedAt - b.addedAt) * dir;
        case "plays":
          return (
            ((s.playCounts[a.path] ?? 0) - (s.playCounts[b.path] ?? 0) ||
              cmpStr(a.title, b.title)) * dir
          );
        case "artist":
        default:
          return (
            (cmpStr(a.artist, b.artist) ||
              cmpStr(a.album, b.album) ||
              (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
              cmpStr(a.title, b.title)) * dir
          );
      }
    });
    return {
      orderedTracks: sorted,
      rows: sorted.map((t, i) => ({ kind: "track", key: t.id, track: t, playIndex: i })),
    };
  }

  // ── Grouped by artist or album ──
  const groups = new Map<string, LibraryTrack[]>();
  for (const t of list) {
    const key =
      s.groupBy === "artist"
        ? t.artist || "Unknown artist"
        : t.album || "Unknown album";
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(t);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => cmpStr(a, b) * dir);

  const rows: LibRow[] = [];
  const orderedTracks: LibraryTrack[] = [];
  for (const gk of groupKeys) {
    const items = groups.get(gk)!.sort((a, b) =>
      s.groupBy === "artist"
        ? cmpStr(a.album, b.album) ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
          cmpStr(a.title, b.title)
        : (a.trackNo ?? 0) - (b.trackNo ?? 0) || cmpStr(a.title, b.title),
    );
    let sub: string;
    if (s.groupBy === "album") {
      const artists = new Set(items.map((i) => i.artist));
      sub = artists.size === 1 ? [...artists][0] : "Various artists";
    } else {
      const albums = new Set(items.map((i) => i.album));
      sub = `${albums.size} album${albums.size === 1 ? "" : "s"} · ${items.length} track${items.length === 1 ? "" : "s"}`;
    }
    rows.push({
      kind: "header",
      key: `h:${gk}`,
      label: gk,
      sub,
      count: items.length,
      firstIndex: orderedTracks.length,
    });
    for (const t of items) {
      rows.push({ kind: "track", key: t.id, track: t, playIndex: orderedTracks.length });
      orderedTracks.push(t);
    }
  }
  return { orderedTracks, rows };
}

function toQueueItems(list: LibraryTrack[]): QueueItem[] {
  return list.map((t) => ({
    id: t.id,
    src: audioUrlForPath(t.path),
    name: t.fileName,
    metadata: {
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverUrl: null,
    },
  }));
}

/** Build a queue from the given list and start playback at `index`. */
export async function playLibrary(
  list: LibraryTrack[],
  index: number,
): Promise<void> {
  if (list.length === 0 || index < 0 || index >= list.length) return;
  await useAudioStore.getState().ensureReady();
  await usePlayerStore.getState().setQueue(toQueueItems(list), index);
  await usePlayerStore.getState().play();
}

/** Append tracks to the end of the current queue. */
export function enqueueLibrary(list: LibraryTrack[]): void {
  if (list.length === 0) return;
  usePlayerStore.getState().enqueue(toQueueItems(list));
}

/** Insert tracks right after the currently playing queue item. */
export function playNextLibrary(list: LibraryTrack[]): void {
  if (list.length === 0) return;
  usePlayerStore.getState().insertNext(toQueueItems(list));
}

// ── Play tracking ──
// Watches the player: when a library track actually starts playing we bump
// its play count / recency. Lives here (not in playerStore) so the player
// stays library-agnostic; this module is loaded app-wide via TransportBar.
//
// v2.4: chain restore no longer happens here — MISSION STATE
// (missionStateStore) owns the single source-settle pipeline that restores
// saved memories / locks in priority order.
let lastTrackedSrc: string | null = null;
usePlayerStore.subscribe((s) => {
  if (s.status !== "playing" || !s.src || s.src === lastTrackedSrc) return;
  lastTrackedSrc = s.src;
  const path = pathFromAudioSrc(s.src);
  if (!path) return;
  useLibraryStore.getState().recordPlay(path);
});
