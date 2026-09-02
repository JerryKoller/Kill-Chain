import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ActionBar } from "@/components/shared/ActionBar";
import { NeonButton } from "@/components/shared/NeonButton";
import { VisualizerOverlay } from "@/components/Visualizer/VisualizerOverlay";
import { useUIStore } from "@/state/uiStore";
import { usePlayerStore } from "@/state/playerStore";
import { useCoverStore, raiseCoverCapacity } from "@/state/coverStore";
import { useVisualizerStore } from "@/state/visualizerStore";
import { MissionLogPanel } from "@/components/MissionLog/MissionLogPanel";
import { KCEmptyState, IconLibrary } from "@/components/kcds";
import {
  useMissionLogStore,
  trackKey,
  albumKey,
  playlistKey,
} from "@/state/missionLogStore";
import {
  useLibraryStore,
  buildLibraryView,
  playLibrary,
  enqueueLibrary,
  playNextLibrary,
  pathFromAudioSrc,
  LIBRARY_RECENT_LIMIT,
  type LibrarySortKey,
  type LibraryGroupBy,
  type LibraryCollection,
  type LibraryTrack,
  type LibRowHeader,
} from "@/state/libraryStore";

const ROW_H = 40;
const HEADER_H = 46;
const GRID =
  "grid items-center gap-2 grid-cols-[26px_44px_minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_44px_62px_50px_30px] px-3";

const COLUMNS: { key: LibrarySortKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
];

const GROUPS: { id: LibraryGroupBy; label: string }[] = [
  { id: "none", label: "None" },
  { id: "artist", label: "Artist" },
  { id: "album", label: "Album" },
];

function fmtDur(s: number | null): string {
  if (!s || !isFinite(s) || s <= 0) return "–";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function fmtSize(b: number | null | undefined): string {
  if (!b || b <= 0) return "–";
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

const LOSSLESS_EXT = new Set(["flac", "wav", "alac", "aiff", "aif", "ape", "wv"]);

function bareExt(ext: string): string {
  return (ext || "").replace(/^\./, "").toLowerCase();
}

function isHiRes(t: LibraryTrack): boolean {
  return (
    (t.sampleRate != null && t.sampleRate > 48000) ||
    (t.bitsPerSample != null && t.bitsPerSample > 16)
  );
}

/** Compact format/quality label, e.g. "FLAC 24/96", "MP3 320k", "WAV". */
function fmtQuality(t: LibraryTrack): { label: string; hi: boolean } {
  const ext = bareExt(t.ext).toUpperCase();
  const hi = isHiRes(t);
  const lossless = t.lossless === true || LOSSLESS_EXT.has(bareExt(t.ext));
  if (lossless && t.sampleRate) {
    const khz = t.sampleRate / 1000;
    const khzStr = Number.isInteger(khz) ? `${khz}` : khz.toFixed(1);
    const depth = t.bitsPerSample ? `${t.bitsPerSample}/` : "";
    return { label: `${ext} ${depth}${khzStr}`, hi };
  }
  if (t.bitrate) {
    return { label: `${ext} ${Math.round(t.bitrate / 1000)}k`, hi };
  }
  return { label: ext || "–", hi };
}

/** Verbose tooltip with the full technical breakdown. */
function qualityTitle(t: LibraryTrack): string {
  const parts: string[] = [bareExt(t.ext).toUpperCase()];
  if (t.bitsPerSample) parts.push(`${t.bitsPerSample}-bit`);
  if (t.sampleRate) parts.push(`${(t.sampleRate / 1000).toFixed(1)} kHz`);
  if (t.bitrate) parts.push(`${Math.round(t.bitrate / 1000)} kbps`);
  if (t.codec && t.codec.toUpperCase() !== bareExt(t.ext).toUpperCase()) parts.push(t.codec);
  if (t.lossless === true) parts.push("lossless");
  return parts.filter(Boolean).join(" · ");
}

function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

interface MenuState {
  x: number;
  y: number;
  track: LibraryTrack;
  playIndex: number;
}

export function LibraryView() {
  const folders = useLibraryStore((s) => s.folders);
  const tracks = useLibraryStore((s) => s.tracks);
  const scanning = useLibraryStore((s) => s.scanning);
  const pendingTags = useLibraryStore((s) => s.pendingTags);
  const sortKey = useLibraryStore((s) => s.sortKey);
  const sortDir = useLibraryStore((s) => s.sortDir);
  const groupBy = useLibraryStore((s) => s.groupBy);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const search = useLibraryStore((s) => s.search);
  const genreFilter = useLibraryStore((s) => s.genreFilter);
  const collection = useLibraryStore((s) => s.collection);
  const favorites = useLibraryStore((s) => s.favorites);
  const playCounts = useLibraryStore((s) => s.playCounts);
  const lastPlayed = useLibraryStore((s) => s.lastPlayed);
  const playlists = useLibraryStore((s) => s.playlists);
  const addFolders = useLibraryStore((s) => s.addFolders);
  const rescan = useLibraryStore((s) => s.rescan);
  const removeFolder = useLibraryStore((s) => s.removeFolder);
  const clearAll = useLibraryStore((s) => s.clearAll);
  const missingPaths = useLibraryStore((s) => s.missingPaths);
  const verifying = useLibraryStore((s) => s.verifying);
  const verifyMissing = useLibraryStore((s) => s.verifyMissing);
  const pruneMissing = useLibraryStore((s) => s.pruneMissing);
  const setSort = useLibraryStore((s) => s.setSort);
  const setGroupBy = useLibraryStore((s) => s.setGroupBy);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const setGenreFilter = useLibraryStore((s) => s.setGenreFilter);
  const setCollection = useLibraryStore((s) => s.setCollection);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const movePlaylistItem = useLibraryStore((s) => s.movePlaylistItem);
  const removeFromPlaylist = useLibraryStore((s) => s.removeFromPlaylist);
  const focusPath = useLibraryStore((s) => s.focusPath);
  const clearFocusPath = useLibraryStore((s) => s.clearFocusPath);

  const available = !!window.playground?.library;
  const toast = useUIStore((s) => s.toast);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRemoveFolder, setConfirmRemoveFolder] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [missionLogOpen, setMissionLogOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const confirmClearTimer = useRef(0);
  const confirmFolderTimer = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(confirmClearTimer.current);
      window.clearTimeout(confirmFolderTimer.current);
    },
    [],
  );

  const vizOpen = useVisualizerStore((s) => s.open);
  const setVizOpen = useVisualizerStore((s) => s.setOpen);

  // Leaving the Library view unmounts the overlay — make sure the store
  // agrees, so returning to the Library doesn't surprise-launch fullscreen
  // visuals. (Lives HERE, on the view: a self-closing cleanup on the overlay
  // itself trips StrictMode's simulated remount and the overlay never opens.)
  useEffect(() => {
    return () => useVisualizerStore.getState().setOpen(false);
  }, []);

  const playingSrc = usePlayerStore((s) => s.src);
  const playingPath = useMemo(() => pathFromAudioSrc(playingSrc), [playingSrc]);

  const { rows, orderedTracks } = useMemo(
    () =>
      buildLibraryView({
        tracks,
        sortKey,
        sortDir,
        search,
        genreFilter,
        groupBy,
        collection,
        favorites,
        playCounts,
        lastPlayed,
        playlists,
      }),
    [tracks, sortKey, sortDir, search, genreFilter, groupBy, collection, favorites, playCounts, lastPlayed, playlists],
  );

  // Genre chips follow the current collection (not the whole library), so a
  // playlist without "Electronic" doesn't offer a chip that zeros the list.
  const collectionTracks = useMemo(() => {
    if (collection.startsWith("pl:")) {
      const pl = playlists.find((p) => `pl:${p.id}` === collection);
      const byPath = new Map(tracks.map((t) => [t.path, t]));
      return (pl?.paths ?? []).flatMap((p) => {
        const t = byPath.get(p);
        return t ? [t] : [];
      });
    }
    if (collection === "favorites") return tracks.filter((t) => favorites[t.path]);
    if (collection === "recent") {
      return tracks
        .filter((t) => lastPlayed[t.path])
        .sort((a, b) => (lastPlayed[b.path] ?? 0) - (lastPlayed[a.path] ?? 0))
        .slice(0, LIBRARY_RECENT_LIMIT);
    }
    return tracks;
  }, [tracks, collection, playlists, favorites, lastPlayed]);

  // Top genres in the current collection — filter chips (needs tag enrichment done).
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of collectionTracks) {
      if (!t.genre) continue;
      counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([g, n]) => ({ genre: g, count: n }));
  }, [collectionTracks]);

  useEffect(() => {
    if (!genreFilter) return;
    if (collectionTracks.some((t) => t.genre === genreFilter)) return;
    setGenreFilter(null);
  }, [collectionTracks, genreFilter, setGenreFilter]);

  const activePlaylist = collection.startsWith("pl:")
    ? playlists.find((p) => `pl:${p.id}` === collection) ?? null
    : null;
  /** Drag-to-reorder only makes sense with the playlist's true order visible. */
  const canReorder = !!activePlaylist && search.trim() === "" && !genreFilter;
  const flatCollection = collection === "recent" || !!activePlaylist;

  // Auto-scan once on mount if we have folders but nothing scanned yet.
  useEffect(() => {
    if (available && folders.length > 0 && tracks.length === 0) {
      void rescan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the context menu on any outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  // ── Mixed-height windowing (headers are taller than track rows) ──
  const offsets = useMemo(() => {
    const o = new Array(rows.length + 1);
    o[0] = 0;
    for (let i = 0; i < rows.length; i++) {
      o[i + 1] = o[i] + (rows[i].kind === "header" ? HEADER_H : ROW_H);
    }
    return o as number[];
  }, [rows]);
  const totalHeight = offsets[rows.length] || 0;

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(480);
  // rAF-coalesced scroll → at most one virtual-list re-render per frame
  // (raw onScroll fired setState for every wheel/trackpad event).
  const scrollRaf = useRef(0);
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      setScrollTop(listRef.current?.scrollTop ?? top);
    });
  };
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);
  useEffect(() => {
    if (viewMode !== "list") return;
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    setScrollTop(el.scrollTop);
    return () => ro.disconnect();
  }, [viewMode, rows.length]);

  // List ↔ albums (and group/filter changes) remount or rebuild the windowed
  // rows. Keep DOM scroll and the virtualizer's scrollTop in lockstep or the
  // first rows render at a leftover offset and shear under the column header.
  useEffect(() => {
    setScrollTop(0);
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [viewMode, groupBy, collection, search, genreFilter]);

  const overscan = 6;
  const findRow = (y: number) => {
    // smallest i with offsets[i+1] > y
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(lo, Math.max(0, rows.length - 1));
  };
  const startIdx = Math.max(0, findRow(scrollTop) - overscan);
  const endIdx = Math.min(rows.length, findRow(scrollTop + viewH) + overscan + 1);
  const visible = rows.slice(startIdx, endIdx);

  const playAt = (index: number) => {
    const t = orderedTracks[index];
    if (!t) return;
    if (missingPaths[t.path]) {
      toast("File missing — reveal in Explorer, rescan, or prune orphans", "warn");
      return;
    }
    void playLibrary(orderedTracks, index);
  };

  // ── Keyboard navigation on the list (arrows + Enter + paging) ──
  const scrollTrackIntoView = useCallback(
    (path: string) => {
      const idx = rows.findIndex((r) => r.kind === "track" && r.track.path === path);
      if (idx < 0 || !listRef.current) return;
      const el = listRef.current;
      const top = offsets[idx];
      const bottom = top + ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    },
    [rows, offsets],
  );

  // Fire export / transport "show in Library" — select the row once it's in view.
  useEffect(() => {
    if (!focusPath) return;
    if (!orderedTracks.some((t) => t.path === focusPath)) return;
    setSelectedPath(focusPath);
    scrollTrackIntoView(focusPath);
    clearFocusPath();
  }, [focusPath, orderedTracks, scrollTrackIntoView, clearFocusPath]);

  // Opening Library while something is already playing: land on that row.
  const followedPlaying = useRef(false);
  useEffect(() => {
    if (followedPlaying.current || !playingPath) return;
    if (!orderedTracks.some((t) => t.path === playingPath)) return;
    followedPlaying.current = true;
    setSelectedPath(playingPath);
    scrollTrackIntoView(playingPath);
  }, [playingPath, orderedTracks, scrollTrackIntoView]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "/") {
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    if (e.key === "Escape") {
      if (selectedPath) {
        e.preventDefault();
        setSelectedPath(null);
      }
      return;
    }
    if (orderedTracks.length === 0) return;
    const cur = orderedTracks.findIndex((t) => t.path === selectedPath);
    if (e.key === "Enter") {
      if (cur >= 0) {
        e.preventDefault();
        playAt(cur);
      }
      return;
    }
    if (e.key === "Delete" && activePlaylist && cur >= 0) {
      e.preventDefault();
      const keep = orderedTracks[cur + 1]?.path ?? orderedTracks[cur - 1]?.path ?? null;
      removeFromPlaylist(activePlaylist.id, orderedTracks[cur].path);
      toast(`Removed from "${activePlaylist.name}"`);
      setSelectedPath(keep);
      if (keep) scrollTrackIntoView(keep);
      return;
    }
    const page = Math.max(1, Math.floor(viewH / ROW_H) - 1);
    let next = cur;
    if (e.key === "ArrowDown") next = Math.min(orderedTracks.length - 1, (cur < 0 ? -1 : cur) + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, cur < 0 ? 0 : cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = orderedTracks.length - 1;
    else if (e.key === "PageDown") next = Math.min(orderedTracks.length - 1, Math.max(0, cur) + page);
    else if (e.key === "PageUp") next = Math.max(0, (cur < 0 ? 0 : cur) - page);
    else return;
    e.preventDefault();
    const t = orderedTracks[next];
    if (!t) return;
    setSelectedPath(t.path);
    scrollTrackIntoView(t.path);
  };

  // ── Drag-to-reorder (playlists only) ──
  const dragFrom = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const collectionLabel =
    collection === "favorites"
      ? "favorite"
      : collection === "recent"
        ? "recent"
        : activePlaylist
          ? "playlist"
          : "";

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="shrink-0">
      <ActionBar
        title="Library"
        code="KC-02"
        subtitle="Your music — add folders, then browse, search, and play into the sculpting engine"
      />
      </div>

      {!available ? (
        <GlassPanel intense className="p-8 flex-1 min-h-0">
          <KCEmptyState
            className="w-full max-w-lg mx-auto"
            icon={<IconLibrary width={40} height={40} className="opacity-60" />}
            title="Library needs the desktop app"
            hint={
              <>
                Folder scanning and local file playback use the Electron shell.
                You&apos;re on the web build — install or launch the Kill-Chain
                desktop app to add music folders, repair missing paths, and hear
                tracks through the sculpting engine.
                <span className="block mt-2 text-[11px]">
                  Tip: you can still drop a single audio file onto this window in
                  some browsers, but the full Library is desktop-only.
                </span>
              </>
            }
          />
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* ── Controls ── */}
          <GlassPanel intense className="p-3 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <NeonButton onClick={() => void addFolders()} className="text-xs">
                ＋ Add folders
              </NeonButton>
              <button
                onClick={() => void rescan()}
                disabled={scanning || folders.length === 0}
                className="btn-ghost text-xs disabled:opacity-40"
                title="Re-scan folders for new or changed files"
              >
                ↻ Refresh
              </button>
              <button
                onClick={() => setVizOpen(true)}
                className="kc-vz-launch text-xs"
                title="Open the full-panel visualizer — 10 modes locked to the live output signal"
              >
                ▦ VISUALIZER
              </button>

              {/* Group control (flat collections keep their own order) */}
              <div
                className={`flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 ${
                  flatCollection ? "opacity-40 pointer-events-none" : ""
                }`}
                title={
                  flatCollection
                    ? "Recent and playlists keep their own order"
                    : undefined
                }
              >
                <span className="text-[10px] uppercase tracking-widest text-dim px-1.5">
                  Group
                </span>
                {GROUPS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGroupBy(g.id)}
                    className={`px-2 py-1 rounded-md text-xs transition ${
                      groupBy === g.id
                        ? "bg-cyan/15 text-cyan"
                        : "text-white/60 hover:text-white/90"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              {/* List / album-art grid toggle */}
              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-2 py-1 rounded-md text-xs transition ${
                    viewMode === "list" ? "bg-cyan/15 text-cyan" : "text-white/60 hover:text-white/90"
                  }`}
                  title="Track list"
                >
                  ☰ List
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`px-2 py-1 rounded-md text-xs transition ${
                    viewMode === "grid" ? "bg-cyan/15 text-cyan" : "text-white/60 hover:text-white/90"
                  }`}
                  title="Album-art grid"
                >
                  ▦ Albums
                </button>
              </div>

              <div className="relative flex-1 min-w-[160px]">
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (search) setSearch("");
                    else if (genreFilter) setGenreFilter(null);
                  }}
                  placeholder="Search title, artist, album, genre…"
                  aria-label="Search library"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-cyan/50 transition"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              <MissionLogButton onOpen={() => setMissionLogOpen(true)} />

              <div className="text-[11px] text-dim tabular-nums">
                {scanning
                  ? "Scanning…"
                  : pendingTags > 0
                    ? `Reading tags… ${pendingTags} left`
                    : `${orderedTracks.length}${collectionLabel ? ` ${collectionLabel}` : ""} track${orderedTracks.length === 1 ? "" : "s"}`}
                {orderedTracks.filter((t) => missingPaths[t.path]).length > 0 && (
                  <span className="text-plasma ml-2">
                    · {orderedTracks.filter((t) => missingPaths[t.path]).length} missing
                  </span>
                )}
              </div>
              {folders.length > 0 && (
                <>
                  <button
                    onClick={() => {
                      void verifyMissing().then((n) =>
                        toast(
                          n > 0
                            ? `${n} missing file${n === 1 ? "" : "s"} — prune or re-add folders`
                            : "All indexed files are still on disk",
                          n > 0 ? "warn" : "success",
                        ),
                      );
                    }}
                    disabled={verifying || scanning || tracks.length === 0}
                    className="btn-ghost text-xs disabled:opacity-40"
                    title="Check whether indexed files still exist on disk"
                  >
                    {verifying ? "Checking…" : "Check missing"}
                  </button>
                  {Object.keys(missingPaths).length > 0 && (
                    <button
                      onClick={() => {
                        const n = pruneMissing();
                        toast(
                          n > 0
                            ? `Removed ${n} orphan${n === 1 ? "" : "s"} from Library`
                            : "Nothing to prune",
                          n > 0 ? "success" : "info",
                        );
                      }}
                      className="btn-ghost text-xs text-plasma"
                      title="Remove tracks whose files are missing (disk untouched)"
                    >
                      Prune orphans
                    </button>
                  )}
                </>
              )}
              {folders.length > 0 && (
                <button
                  onClick={() => {
                    if (confirmClear) {
                      window.clearTimeout(confirmClearTimer.current);
                      clearAll();
                      setConfirmClear(false);
                      toast("Library cleared");
                    } else {
                      setConfirmClear(true);
                      window.clearTimeout(confirmClearTimer.current);
                      confirmClearTimer.current = window.setTimeout(
                        () => setConfirmClear(false),
                        2400,
                      );
                    }
                  }}
                  className={`btn-ghost text-xs ${
                    confirmClear
                      ? "text-plasma border-plasma/50"
                      : "text-white/50 hover:text-plasma"
                  }`}
                  title="Removes all folders and tracks from the library (files on disk are untouched)"
                >
                  {confirmClear ? "CONFIRM PURGE" : "Clear"}
                </button>
              )}
            </div>

            {/* Collection tabs + playlist chips */}
            <CollectionBar
              collection={collection}
              setCollection={setCollection}
              favoritesCount={Object.keys(favorites).length}
            />

            {/* Genre filter chips (from real file tags) */}
            {(genres.length > 0 || genreFilter) && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                <span className="text-[10px] uppercase tracking-widest text-dim pr-0.5">
                  Genre
                </span>
                {genres.map(({ genre, count }) => (
                  <button
                    key={genre}
                    onClick={() => setGenreFilter(genreFilter === genre ? null : genre)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                      genreFilter === genre
                        ? "border-cyan/60 bg-cyan/15 text-cyan"
                        : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90 hover:border-white/25"
                    }`}
                    title={`${count} track${count === 1 ? "" : "s"}`}
                  >
                    {genre}
                  </button>
                ))}
                {genreFilter && !genres.some((g) => g.genre === genreFilter) && (
                  <button
                    onClick={() => setGenreFilter(null)}
                    className="rounded-full border px-2.5 py-0.5 text-[11px] transition border-cyan/60 bg-cyan/15 text-cyan"
                    title="Active genre is outside the top chips — click to clear"
                  >
                    {genreFilter}
                  </button>
                )}
                {genreFilter && (
                  <button
                    onClick={() => setGenreFilter(null)}
                    className="text-[11px] text-dim hover:text-white"
                  >
                    ✕ clear
                  </button>
                )}
              </div>
            )}

            {/* Folder chips */}
            {folders.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                {folders.map((f) => (
                  <span
                    key={f}
                    className={`group inline-flex items-center gap-1.5 rounded-full border pl-2.5 pr-1.5 py-1 text-[11px] ${
                      confirmRemoveFolder === f
                        ? "border-plasma/50 bg-plasma/15 text-plasma"
                        : "border-white/10 bg-white/[0.03] text-white/70"
                    }`}
                    title={f}
                  >
                    <span className="opacity-60">📁</span>
                    <span className="max-w-[160px] truncate">{folderName(f)}</span>
                    <button
                      onClick={() => {
                        if (confirmRemoveFolder === f) {
                          window.clearTimeout(confirmFolderTimer.current);
                          removeFolder(f);
                          setConfirmRemoveFolder(null);
                          toast(`Removed “${folderName(f)}” from Library`);
                        } else {
                          setConfirmRemoveFolder(f);
                          window.clearTimeout(confirmFolderTimer.current);
                          confirmFolderTimer.current = window.setTimeout(
                            () => setConfirmRemoveFolder(null),
                            2400,
                          );
                        }
                      }}
                      className="rounded-full w-4 h-4 grid place-items-center text-dim hover:text-plasma hover:bg-white/10"
                      title={
                        confirmRemoveFolder === f
                          ? "Click again to remove this folder from the library (files on disk are untouched)"
                          : "Remove folder from library (files on disk are untouched)"
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </GlassPanel>

          {/* ── Track list / album grid ── */}
          <GlassPanel intense className="p-0 overflow-hidden flex-1 min-h-0 flex flex-col">
            {viewMode === "grid" ? (
              rows.length === 0 ? (
                <div className="flex-1 min-h-0">
                  <EmptyState
                    hasFolders={folders.length > 0}
                    scanning={scanning}
                    collection={collection}
                    playlistName={activePlaylist?.name ?? null}
                    searching={search.trim().length > 0 || !!genreFilter}
                    onAdd={() => void addFolders()}
                  />
                </div>
              ) : (
                <AlbumGrid
                  tracks={orderedTracks}
                  playingPath={playingPath}
                />
              )
            ) : (
            <>
            {/* Column header */}
            <div
              className={`${GRID} h-9 shrink-0 border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-dim`}
            >
              <span className="text-center">★</span>
              <span />
              {COLUMNS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setSort(c.key)}
                  className={`text-left hover:text-white/80 transition flex items-center gap-1 ${
                    !flatCollection && groupBy === "none" && sortKey === c.key ? "text-cyan" : ""
                  }`}
                  title={
                    flatCollection
                      ? "Recent and playlists keep their own order"
                      : groupBy === "none"
                        ? "Sort by " + c.label
                        : "Sorting follows the group"
                  }
                >
                  {c.label}
                  {!flatCollection && groupBy === "none" && sortKey === c.key && (
                    <span>{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </button>
              ))}
              <span className="text-left">Format</span>
              <button
                onClick={() => setSort("plays")}
                className={`text-right hover:text-white/80 transition ${
                  !flatCollection && groupBy === "none" && sortKey === "plays" ? "text-cyan" : ""
                }`}
                title="Sort by play count"
              >
                Plays
                {!flatCollection && groupBy === "none" && sortKey === "plays" && (sortDir === "asc" ? " ▲" : " ▼")}
              </button>
              <span className="text-right">Size</span>
              <button
                onClick={() => setSort("duration")}
                className={`text-right hover:text-white/80 transition ${
                  !flatCollection && groupBy === "none" && sortKey === "duration" ? "text-cyan" : ""
                }`}
              >
                Time
                {!flatCollection && groupBy === "none" && sortKey === "duration" && (sortDir === "asc" ? " ▲" : " ▼")}
              </button>
              <span />
            </div>

            {rows.length === 0 ? (
              <div className="flex-1 min-h-0">
                <EmptyState
                  hasFolders={folders.length > 0}
                  scanning={scanning}
                  collection={collection}
                  playlistName={activePlaylist?.name ?? null}
                  searching={search.trim().length > 0 || !!genreFilter}
                  onAdd={() => void addFolders()}
                />
              </div>
            ) : (
              <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={onListKeyDown}
                onScroll={onListScroll}
                className="flex-1 min-h-0 overflow-y-auto sidebar-scroll outline-none focus:ring-1 focus:ring-cyan/20 [overflow-anchor:none]"
              >
                <div style={{ height: totalHeight, position: "relative" }}>
                  {visible.map((row, i) => {
                    const idx = startIdx + i;
                    const top = offsets[idx];
                    if (row.kind === "header") {
                      return (
                        <GroupHeader
                          key={row.key}
                          row={row}
                          top={top}
                          onPlay={() => {
                            let i = row.firstIndex;
                            const end = row.firstIndex + row.count;
                            while (i < end && missingPaths[orderedTracks[i]?.path]) i += 1;
                            if (i >= end) {
                              toast("Every track in this group is missing", "warn");
                              return;
                            }
                            playAt(i);
                          }}
                        />
                      );
                    }
                    const isPlaying =
                      playingPath != null && row.track.path === playingPath;
                    return (
                      <TrackRow
                        key={row.key}
                        track={row.track}
                        top={top}
                        isPlaying={isPlaying}
                        isSelected={selectedPath === row.track.path}
                        isFavorite={!!favorites[row.track.path]}
                        plays={playCounts[row.track.path] ?? 0}
                        isDropTarget={canReorder && dropIndex === (row.pathIndex ?? row.playIndex)}
                        draggable={canReorder}
                        onDragStart={() => {
                          dragFrom.current = row.pathIndex ?? row.playIndex;
                        }}
                        onDragOver={(e) => {
                          if (dragFrom.current == null) return;
                          e.preventDefault();
                          setDropIndex(row.pathIndex ?? row.playIndex);
                        }}
                        onDrop={() => {
                          const from = dragFrom.current;
                          dragFrom.current = null;
                          setDropIndex(null);
                          const to = row.pathIndex ?? row.playIndex;
                          if (activePlaylist && from != null && from !== to) {
                            movePlaylistItem(activePlaylist.id, from, to);
                          }
                        }}
                        onDragEnd={() => {
                          dragFrom.current = null;
                          setDropIndex(null);
                        }}
                        onSelect={() => setSelectedPath(row.track.path)}
                        onPlay={() => playAt(row.playIndex)}
                        onToggleFavorite={() => toggleFavorite(row.track.path)}
                        onMenu={(x, y) => {
                          setSelectedPath(row.track.path);
                          setMenu({ x, y, track: row.track, playIndex: row.playIndex });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
            </>
            )}
          </GlassPanel>
        </div>
      )}

      {menu && (
        <TrackMenu
          menu={menu}
          activePlaylistId={activePlaylist?.id ?? null}
          onClose={() => setMenu(null)}
          onPlay={() => playAt(menu.playIndex)}
        />
      )}

      {missionLogOpen && <MissionLogPanel onClose={() => setMissionLogOpen(false)} />}

      {vizOpen && <VisualizerOverlay />}
    </div>
  );
}

/** Mission Log entry point: shows the saved-chain count + opens the panel. */
function MissionLogButton({ onOpen }: { onOpen: () => void }) {
  const autoRestore = useMissionLogStore((s) => s.autoRestore);
  const count = useMissionLogStore((s) => Object.keys(s.entries).length);
  return (
    <button
      onClick={onOpen}
      className={`btn-ghost text-xs ${autoRestore ? "text-cyan" : "text-white/50"}`}
      title={
        `Mission Log: full-chain memory per track / album / playlist / Airspace source. ` +
        `${count} chain${count === 1 ? "" : "s"} saved. ` +
        `Auto-restore is ${autoRestore ? "armed" : "off"}. Click to open.`
      }
    >
      ◎ Mission Log{count > 0 ? ` · ${count}` : ""}
    </button>
  );
}

function CollectionBar({
  collection,
  setCollection,
  favoritesCount,
}: {
  collection: LibraryCollection;
  setCollection: (c: LibraryCollection) => void;
  favoritesCount: number;
}) {
  const playlists = useLibraryStore((s) => s.playlists);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const renamePlaylist = useLibraryStore((s) => s.renamePlaylist);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const missingPaths = useLibraryStore((s) => s.missingPaths);
  const rescan = useLibraryStore((s) => s.rescan);
  const removeFromPlaylist = useLibraryStore((s) => s.removeFromPlaylist);
  const toast = useUIStore((s) => s.toast);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const skipRenameCommit = useRef(false);
  const confirmDeleteTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(confirmDeleteTimer.current), []);

  const tab = (
    id: LibraryCollection,
    label: string,
    title?: string,
  ) => (
    <button
      key={id}
      onClick={() => setCollection(id)}
      className={`px-2.5 py-1 rounded-md text-xs transition ${
        collection === id
          ? "bg-cyan/15 text-cyan"
          : "text-white/60 hover:text-white/90"
      }`}
      title={title}
    >
      {label}
    </button>
  );

  const commitRename = (id: string) => {
    if (renameValue.trim()) renamePlaylist(id, renameValue);
    setRenamingId(null);
  };

  const cancelRename = () => {
    skipRenameCommit.current = true;
    setRenamingId(null);
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
      <span className="text-[10px] uppercase tracking-widest text-dim pr-0.5">
        View
      </span>
      <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
        {tab("all", "All")}
        {tab("favorites", `★ Favorites${favoritesCount ? ` (${favoritesCount})` : ""}`)}
        {tab("recent", "Recent", "Tracks you played, newest first")}
      </div>

      {playlists.length > 0 && (
        <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-dim px-1.5">
            Playlists
          </span>
          {playlists.map((pl) => {
            const id: LibraryCollection = `pl:${pl.id}`;
            const active = collection === id;
            const missingCount = pl.paths.filter((p) => missingPaths[p]).length;
            if (renamingId === pl.id) {
              return (
                <input
                  key={pl.id}
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (skipRenameCommit.current) {
                      skipRenameCommit.current = false;
                      return;
                    }
                    commitRename(pl.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename(pl.id);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelRename();
                    }
                  }}
                  className="bg-white/[0.06] border border-cyan/40 rounded-md px-2 py-0.5 text-xs w-32 outline-none"
                />
              );
            }
            return (
              <span key={pl.id} className="inline-flex items-center">
                <button
                  onClick={() => setCollection(id)}
                  onDoubleClick={() => {
                    setRenamingId(pl.id);
                    setRenameValue(pl.name);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs transition ${
                    active
                      ? "bg-violet/20 text-white"
                      : "text-white/60 hover:text-white/90"
                  }`}
                  title={`${pl.paths.length} track${pl.paths.length === 1 ? "" : "s"}${
                    missingCount ? ` · ${missingCount} missing` : ""
                  } — double-click to rename`}
                >
                  ≡ {pl.name}
                  <span className="text-dim ml-1 tabular-nums">{pl.paths.length}</span>
                  {missingCount > 0 && (
                    <span className="text-plasma ml-1 tabular-nums">{missingCount} missing</span>
                  )}
                </button>
                {active && (
                  <>
                    <PlaylistChainControls id={pl.id} name={pl.name} />
                    {missingCount > 0 && (
                      <>
                        <button
                          onClick={() => {
                            for (const p of pl.paths) {
                              if (missingPaths[p]) removeFromPlaylist(pl.id, p);
                            }
                            toast(`Removed ${missingCount} orphan${missingCount === 1 ? "" : "s"} from playlist`);
                          }}
                          className="btn-ghost text-[10px] text-plasma px-1.5"
                          title="Remove missing tracks from this playlist only"
                        >
                          Remove orphans
                        </button>
                        <button
                          onClick={() => void rescan()}
                          className="btn-ghost text-[10px] px-1.5"
                          title="Rescan folders — may rediscover moved files if they stayed under a watched folder"
                        >
                          Rescan folder
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (confirmDeleteId === pl.id) {
                          window.clearTimeout(confirmDeleteTimer.current);
                          deletePlaylist(pl.id);
                          setConfirmDeleteId(null);
                          toast(`Deleted playlist "${pl.name}"`);
                        } else {
                          setConfirmDeleteId(pl.id);
                          window.clearTimeout(confirmDeleteTimer.current);
                          confirmDeleteTimer.current = window.setTimeout(
                            () => setConfirmDeleteId(null),
                            2400,
                          );
                        }
                      }}
                      className={`w-4 h-4 grid place-items-center rounded-full text-[10px] ml-0.5 ${
                        confirmDeleteId === pl.id
                          ? "text-plasma bg-plasma/20"
                          : "text-dim hover:text-plasma hover:bg-white/10"
                      }`}
                      title={
                        confirmDeleteId === pl.id
                          ? "Confirm purge — tap again to delete this playlist"
                          : "Delete playlist (tracks stay in the library)"
                      }
                    >
                      ✕
                    </button>
                  </>
                )}
              </span>
            );
          })}
        </div>
      )}

      <button
        onClick={() => {
          const n = useLibraryStore.getState().playlists.length + 1;
          const id = createPlaylist(`Playlist ${n}`);
          setCollection(`pl:${id}`);
          setRenamingId(id);
          setRenameValue(`Playlist ${n}`);
        }}
        className="btn-ghost text-xs text-white/60 hover:text-cyan"
        title="Create a new playlist — add tracks via a track's ⋯ menu"
      >
        ＋ New playlist
      </button>
    </div>
  );
}

/**
 * Playlist chain override (v1.5). Saves the live full chain under the
 * playlist's Mission Log key; auto-restore applies it to any track in this
 * playlist that has no track/album entry of its own (track > album > playlist).
 */
function PlaylistChainControls({ id, name }: { id: string; name: string }) {
  const key = playlistKey(id);
  const entry = useMissionLogStore((s) => s.entries[key]);
  const saveEntry = useMissionLogStore((s) => s.saveEntry);
  const removeEntry = useMissionLogStore((s) => s.removeEntry);
  const applyEntry = useMissionLogStore((s) => s.applyEntry);
  const toast = useUIStore((s) => s.toast);

  return (
    <span className="inline-flex items-center gap-0.5 ml-0.5">
      <button
        onClick={() => {
          saveEntry(key, "playlist", name);
          toast(`◎ Chain override saved for "${name}"`);
        }}
        className={`w-5 h-5 grid place-items-center rounded-full text-[11px] ${
          entry ? "text-violet bg-violet/15" : "text-dim hover:text-violet hover:bg-white/10"
        }`}
        title={
          entry
            ? "Playlist chain override active — click to overwrite with the current chain"
            : "Save the current chain as this playlist's override (applies to every track in it without its own saved chain)"
        }
      >
        ◎
      </button>
      {entry && (
        <>
          <button
            onClick={() => {
              applyEntry(key);
              toast(`Applied "${name}" chain override`);
            }}
            className="w-5 h-5 grid place-items-center rounded-full text-[11px] text-dim hover:text-cyan hover:bg-white/10"
            title="Apply the saved playlist chain now"
          >
            ↺
          </button>
          <button
            onClick={() => {
              removeEntry(key);
              toast("Playlist chain override cleared");
            }}
            className="w-5 h-5 grid place-items-center rounded-full text-[11px] text-dim hover:text-plasma hover:bg-white/10"
            title="Clear the playlist chain override"
          >
            ○
          </button>
        </>
      )}
    </span>
  );
}

// ── Album-art grid (v1.5) ──

interface AlbumCell {
  key: string;
  album: string;
  artist: string;
  tracks: LibraryTrack[];
  /** Index of the album's first track in the flat ordered list. */
  firstIndex: number;
}

function AlbumGrid({
  tracks,
  playingPath,
}: {
  tracks: LibraryTrack[];
  playingPath: string | null;
}) {
  // The grid shows far more art at once than the list — widen the LRU so
  // scrolling back up doesn't re-parse covers that were just evicted.
  useEffect(() => {
    raiseCoverCapacity(1200);
  }, []);

  const albums = useMemo(() => {
    const map = new Map<string, AlbumCell>();
    tracks.forEach((t, i) => {
      const key = `${t.artist}|${t.album}`.toLowerCase();
      const cell = map.get(key);
      if (cell) {
        cell.tracks.push(t);
      } else {
        map.set(key, {
          key,
          album: t.album || "Unknown album",
          artist: t.artist || "Unknown artist",
          tracks: [t],
          firstIndex: i,
        });
      }
    });
    const list = [...map.values()];
    // Multi-artist albums ("Various") collapse when artists differ per track.
    for (const a of list) {
      const artists = new Set(a.tracks.map((t) => t.artist));
      if (artists.size > 1) a.artist = "Various artists";
    }
    return list.sort(
      (a, b) =>
        a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) ||
        a.album.localeCompare(b.album, undefined, { sensitivity: "base" }),
    );
  }, [tracks]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll p-3 [overflow-anchor:none]">
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(148px,1fr))]">
        {albums.map((a) => (
          <AlbumCard
            key={a.key}
            cell={a}
            isPlaying={playingPath != null && a.tracks.some((t) => t.path === playingPath)}
          />
        ))}
      </div>
    </div>
  );
}

function AlbumCard({ cell, isPlaying }: { cell: AlbumCell; isPlaying: boolean }) {
  const missingPaths = useLibraryStore((s) => s.missingPaths);
  const first = cell.tracks.find((t) => !missingPaths[t.path]) ?? cell.tracks[0];
  const firstMissing = !!missingPaths[first.path];
  const cover = useCoverStore((s) => s.covers[first.path]);
  const requestCover = useCoverStore((s) => s.requestCover);
  const hasChain = useMissionLogStore(
    (s) => !!s.entries[albumKey(first.artist, first.album)],
  );
  useEffect(() => {
    if (!firstMissing) requestCover(first.path);
  }, [first.path, requestCover, firstMissing]);

  // Album order: track number then title (the flat list may be sorted by
  // anything — inside an album we always want disc order).
  const play = () => {
    const ordered = [...cell.tracks].sort(
      (a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0) || a.title.localeCompare(b.title),
    );
    const missing = useLibraryStore.getState().missingPaths;
    const playable = ordered.filter((t) => !missing[t.path]);
    if (playable.length === 0) {
      useUIStore.getState().toast("Every track in this album is missing", "warn");
      return;
    }
    void playLibrary(playable, 0);
  };

  return (
    <button
      onClick={play}
      className={`group text-left rounded-xl border p-2 transition ${
        isPlaying
          ? "border-cyan/50 bg-cyan/[0.07]"
          : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
      }`}
      title={`${cell.album} — ${cell.artist}\n${cell.tracks.length} track${cell.tracks.length === 1 ? "" : "s"} · click to play`}
    >
      <div className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/[0.04] grid place-items-center text-2xl text-dim">
        {cover ? (
          <div
            className="absolute inset-0"
            style={{ background: `center/cover no-repeat url("${cover}")` }}
          />
        ) : (
          <span>♪</span>
        )}
        <span className="absolute inset-0 hidden group-hover:grid place-items-center bg-black/50 text-cyan text-3xl">
          ▶
        </span>
        {hasChain && (
          <span
            className="absolute top-1.5 right-1.5 rounded-[4px] border border-violet/60 bg-ink/80 text-violet text-[9px] font-bold leading-none px-1 py-[2px]"
            title="Mission Log: this album has a saved chain"
          >
            ◎
          </span>
        )}
        {isPlaying && (
          <span className="absolute bottom-1.5 left-1.5 rounded-[4px] bg-cyan/20 border border-cyan/50 text-cyan text-[9px] font-bold leading-none px-1 py-[2px]">
            PLAYING
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs font-medium truncate" title={cell.album}>
        {cell.album}
      </div>
      <div className="text-[10px] text-dim truncate">{cell.artist}</div>
    </button>
  );
}

function GroupHeader({
  row,
  top,
  onPlay,
}: {
  row: LibRowHeader;
  top: number;
  onPlay: () => void;
}) {
  return (
    <div
      style={{ position: "absolute", top, left: 0, right: 0, height: HEADER_H }}
      className="group px-3 flex items-end justify-between pb-1.5 border-b border-white/10 bg-ink/70 backdrop-blur-sm"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{row.label}</div>
        {row.sub && (
          <div className="text-[10px] uppercase tracking-widest text-dim truncate">
            {row.sub}
          </div>
        )}
      </div>
      <button
        onClick={onPlay}
        className="opacity-0 group-hover:opacity-100 transition text-[11px] text-cyan border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 rounded-md px-2 py-0.5 mb-0.5"
        title="Play this group"
      >
        ▶ Play
      </button>
    </div>
  );
}

function TrackRow({
  track,
  top,
  isPlaying,
  isSelected,
  isFavorite,
  plays,
  isDropTarget,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSelect,
  onPlay,
  onToggleFavorite,
  onMenu,
}: {
  track: LibraryTrack;
  top: number;
  isPlaying: boolean;
  isSelected: boolean;
  isFavorite: boolean;
  plays: number;
  isDropTarget: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onSelect: () => void;
  onPlay: () => void;
  onToggleFavorite: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const cover = useCoverStore((s) => s.covers[track.path]);
  const requestCover = useCoverStore((s) => s.requestCover);
  const logEntry = useMissionLogStore((s) => s.entries[trackKey(track.path)]);
  const isMissing = useLibraryStore((s) => !!s.missingPaths[track.path]);
  useEffect(() => {
    if (!isMissing) requestCover(track.path);
  }, [track.path, requestCover, isMissing]);

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onPlay}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`${GRID} group border-b text-sm ${
        isDropTarget ? "border-cyan/70" : "border-white/[0.04]"
      } ${
        isPlaying
          ? "bg-cyan/10"
          : isSelected
            ? "bg-white/[0.07]"
            : isMissing
              ? "bg-plasma/5 hover:bg-plasma/10"
              : "hover:bg-white/[0.04]"
      }`}
      style={{ position: "absolute", top, left: 0, right: 0, height: ROW_H }}
    >
      {/* Favorite star */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`w-6 h-6 grid place-items-center rounded-md transition ${
          isFavorite
            ? "text-amber"
            : `text-white/15 hover:text-white/60 ${
                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`
        }`}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        {isFavorite ? "★" : "☆"}
      </button>

      {/* Cover + hover play */}
      <div className="relative w-9 h-9 rounded-md overflow-hidden border border-white/10 bg-white/[0.04] grid place-items-center text-dim text-sm">
        {cover ? (
          <div
            className="absolute inset-0"
            style={{ background: `center/cover no-repeat url("${cover}")` }}
          />
        ) : (
          <span>{isPlaying ? <span className="text-cyan">♪</span> : "♪"}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className="absolute inset-0 hidden group-hover:grid place-items-center bg-black/50 text-cyan"
          title="Play"
        >
          ▶
        </button>
      </div>

      <div className="min-w-0 flex items-center gap-1.5">
        <span
          className={`truncate ${isPlaying ? "text-cyan font-medium" : "text-white/90"}`}
          title={[
            track.title,
            track.genre,
            track.year != null ? String(track.year) : null,
            isMissing ? "missing from disk" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {track.title}
        </span>
        {logEntry && (
          <span
            className="shrink-0 rounded-[3px] border border-violet/50 bg-violet/15 text-violet text-[8px] font-bold leading-none px-1 py-[2px]"
            title={
              logEntry.chain.tractor
                ? "Mission Log: saved chain with a Tractor lock — restored automatically when this track plays"
                : "Mission Log: saved chain — restored automatically when this track plays"
            }
          >
            {logEntry.chain.tractor ? "◎LOCK" : "◎"}
          </span>
        )}
        {isMissing && (
          <span
            className="shrink-0 rounded-[3px] border border-plasma/50 bg-plasma/15 text-plasma text-[8px] font-bold leading-none px-1 py-[2px]"
            title="File not found on disk — was it moved? Use Reveal in Explorer, Rescan, or Prune orphans."
          >
            MISSING
          </span>
        )}
      </div>
      <div className="truncate text-white/65" title={track.artist}>
        {track.artist}
      </div>
      <div className="truncate text-white/55" title={track.album}>
        {track.album}
      </div>
      <QualityCell track={track} />
      <div className="text-right text-dim text-[11px] tabular-nums">
        {plays > 0 ? plays : "–"}
      </div>
      <div
        className="text-right text-dim text-[11px] tabular-nums"
        title={track.size ? `${track.size.toLocaleString()} bytes` : undefined}
      >
        {fmtSize(track.size)}
      </div>
      <div className="text-right text-dim text-xs tabular-nums">
        {fmtDur(track.durationSec)}
      </div>

      {/* Row menu */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onMenu(r.right, r.bottom);
        }}
        className={`w-6 h-6 grid place-items-center rounded-md text-dim hover:text-white hover:bg-white/10 transition justify-self-end ${
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        title="Track actions"
      >
        ⋯
      </button>
    </div>
  );
}

function TrackMenu({
  menu,
  activePlaylistId,
  onClose,
  onPlay,
}: {
  menu: MenuState;
  activePlaylistId: string | null;
  onClose: () => void;
  onPlay: () => void;
}) {
  const { track } = menu;
  const playlists = useLibraryStore((s) => s.playlists);
  const favorites = useLibraryStore((s) => s.favorites);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const addToPlaylist = useLibraryStore((s) => s.addToPlaylist);
  const removeFromPlaylist = useLibraryStore((s) => s.removeFromPlaylist);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const hasChain = useMissionLogStore((s) => !!s.entries[trackKey(track.path)]);
  const hasAlbumChain = useMissionLogStore(
    (s) => !!s.entries[albumKey(track.artist, track.album)],
  );
  const saveEntry = useMissionLogStore((s) => s.saveEntry);
  const removeEntry = useMissionLogStore((s) => s.removeEntry);
  const applyEntry = useMissionLogStore((s) => s.applyEntry);
  const toast = useUIStore((s) => s.toast);

  const isFav = !!favorites[track.path];
  const isMissing = useLibraryStore((s) => !!s.missingPaths[track.path]);

  // Clamp so the menu never renders off-screen.
  const MENU_W = 224;
  const MENU_MAX_H = 420;
  const x = Math.min(menu.x, window.innerWidth - MENU_W - 8);
  const y = Math.min(menu.y, window.innerHeight - Math.min(MENU_MAX_H, 380) - 8);

  const item =
    "w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/[0.07] hover:text-white transition flex items-center gap-2";
  const divider = <div className="h-px bg-white/10 my-1" />;
  const label =
    "px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-[0.2em] text-dim";

  return createPortal(
    <div
      role="menu"
      aria-label={`Actions for ${track.title}`}
      className="fixed z-50 rounded-xl border border-white/15 bg-ink/95 backdrop-blur-xl shadow-neon overflow-y-auto sidebar-scroll py-1"
      style={{ left: x, top: y, width: MENU_W, maxHeight: MENU_MAX_H }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 border-b border-white/10 mb-1">
        <div className="text-xs font-medium text-white/90 truncate" title={track.title}>
          {track.title}
        </div>
        <div className="text-[10px] text-dim truncate">{track.artist}</div>
      </div>

      <button
        className={item}
        onClick={() => {
          onPlay();
          onClose();
        }}
      >
        ▶ Play now
      </button>
      <button
        className={item}
        onClick={() => {
          if (isMissing) {
            toast("File missing — reveal in Explorer, rescan, or prune orphans", "warn");
            onClose();
            return;
          }
          playNextLibrary([track]);
          toast(`"${track.title}" will play next`);
          onClose();
        }}
      >
        ⏭ Play next
      </button>
      <button
        className={item}
        onClick={() => {
          if (isMissing) {
            toast("File missing — reveal in Explorer, rescan, or prune orphans", "warn");
            onClose();
            return;
          }
          enqueueLibrary([track]);
          toast(`Queued "${track.title}"`);
          onClose();
        }}
      >
        ＋ Add to queue
      </button>
      <button
        className={item}
        onClick={() => {
          void useLibraryStore.getState().revealInExplorer(track.path).then((ok) => {
            toast(
              ok ? "Revealed in Explorer" : "Could not reveal — file or folder may be gone",
              ok ? "success" : "warn",
            );
          });
          onClose();
        }}
      >
        ⌕ Reveal in Explorer
      </button>

      {divider}

      <button
        className={item}
        onClick={() => {
          toggleFavorite(track.path);
          onClose();
        }}
      >
        {isFav ? "★ Remove from favorites" : "☆ Add to favorites"}
      </button>

      {divider}
      <div className={label}>Add to playlist</div>
      {playlists.map((pl) => {
        const already = pl.paths.includes(track.path);
        return (
          <button
            key={pl.id}
            className={`${item} ${already ? "opacity-40" : ""}`}
            disabled={already}
            onClick={() => {
              addToPlaylist(pl.id, [track.path]);
              toast(`Added to "${pl.name}"`);
              onClose();
            }}
          >
            ≡ {pl.name}
            {already && <span className="text-dim ml-auto">added</span>}
          </button>
        );
      })}
      <button
        className={`${item} text-cyan`}
        onClick={() => {
          const n = useLibraryStore.getState().playlists.length + 1;
          createPlaylist(`Playlist ${n}`, [track.path]);
          toast(`Created "Playlist ${n}" with "${track.title}"`);
          onClose();
        }}
      >
        ＋ New playlist with track
      </button>
      {activePlaylistId && (
        <button
          className={`${item} text-plasma/90`}
          onClick={() => {
            removeFromPlaylist(activePlaylistId, track.path);
            toast("Removed from playlist");
            onClose();
          }}
        >
          ✕ Remove from this playlist
        </button>
      )}

      {divider}
      <div className={label}>Mission Log</div>
      <button
        className={item}
        onClick={() => {
          saveEntry(trackKey(track.path), "track", track.title, track.artist);
          toast(`◎ Logged chain for "${track.title}"`);
          onClose();
        }}
        title="Snapshot the FULL chain (EQ, restoration, modes, Tractor lock); it's restored whenever this track plays"
      >
        ◎ Log this chain to track
      </button>
      <button
        className={item}
        onClick={() => {
          saveEntry(
            albumKey(track.artist, track.album),
            "album",
            track.album || "Unknown album",
            track.artist,
          );
          toast(`◎ Logged chain for album "${track.album || "Unknown album"}"`);
          onClose();
        }}
        title="Snapshot the full chain for EVERY track of this album"
      >
        ◈ Log this chain to album
      </button>
      {hasChain && (
        <>
          <button
            className={item}
            onClick={() => {
              applyEntry(trackKey(track.path));
              toast(`Mission Log — restored "${track.title}"`);
              onClose();
            }}
          >
            ↺ Restore saved chain
          </button>
          <button
            className={item}
            onClick={() => {
              removeEntry(trackKey(track.path));
              toast("Mission Log entry cleared");
              onClose();
            }}
          >
            ○ Clear saved chain
          </button>
        </>
      )}
      {hasAlbumChain && !hasChain && (
        <button
          className={item}
          onClick={() => {
            removeEntry(albumKey(track.artist, track.album));
            toast("Album chain cleared");
            onClose();
          }}
        >
          ○ Clear album chain
        </button>
      )}
    </div>,
    document.body,
  );
}

function QualityCell({ track }: { track: LibraryTrack }) {
  const q = fmtQuality(track);
  return (
    <div className="min-w-0 flex items-center gap-1" title={qualityTitle(track)}>
      <span className="truncate text-[11px] text-white/55 tabular-nums">{q.label}</span>
      {q.hi && (
        <span className="shrink-0 rounded-[3px] border border-cyan/40 bg-cyan/15 text-cyan text-[8px] font-bold leading-none px-1 py-[2px]">
          HR
        </span>
      )}
    </div>
  );
}

function EmptyState({
  hasFolders,
  scanning,
  collection,
  playlistName,
  searching,
  onAdd,
}: {
  hasFolders: boolean;
  scanning: boolean;
  collection: LibraryCollection;
  playlistName: string | null;
  searching: boolean;
  onAdd: () => void;
}) {
  let icon: ReactNode = <IconLibrary width={40} height={40} className="opacity-60" />;
  let title: string;
  let hint: string;

  if (scanning) {
    icon = <span className="text-4xl opacity-60">⟳</span>;
    title = "Scanning your folders…";
    hint = "Indexing every audio file it can find.";
  } else if (searching) {
    icon = <span className="text-4xl opacity-60">⌕</span>;
    title = "No matches";
    hint = "Nothing in this view matches your search or genre filter.";
  } else if (collection === "favorites") {
    icon = <span className="text-4xl opacity-60">☆</span>;
    title = "No favorites yet";
    hint = "Hover a track and click the star to pin it here.";
  } else if (collection === "recent") {
    icon = <span className="text-4xl opacity-60">◷</span>;
    title = "Nothing played yet";
    hint = "Tracks you play will show up here, newest first.";
  } else if (playlistName) {
    icon = <span className="text-4xl opacity-60">≡</span>;
    title = `"${playlistName}" is empty`;
    hint = "Right-click any track (or use its ⋯ menu) and choose Add to playlist.";
  } else if (hasFolders) {
    title = "No audio files found";
    hint = "Those folders didn't contain supported audio files.";
  } else {
    title = "Your library is empty";
    hint =
      "Add folders so Kill-Chain can index tracks, or drop audio files onto the window to hear them sculpted.";
  }

  const loadFile = () => {
    void (async () => {
      const path = await window.playground?.openAudioFile?.();
      if (!path) return;
      const { usePlayerStore } = await import("@/state/playerStore");
      const name = path.split(/[\\/]/).pop() || "Track";
      const src = `playground-audio:///lib?p=${encodeURIComponent(path)}`;
      await usePlayerStore.getState().setQueue([{ id: path, src, name }], 0);
      await usePlayerStore.getState().play();
      useUIStore.getState().toast(`Loaded "${name}"`, "success");
    })();
  };

  const showAdd =
    !hasFolders && !scanning && collection === "all" && !searching && !!window.playground?.library;

  return (
    <div className="h-full grid place-items-center p-8">
      <KCEmptyState
        className="w-full max-w-md"
        icon={icon}
        title={title}
        hint={hint}
        action={
          showAdd ? (
            <>
              <div className="flex flex-col sm:flex-row gap-2 items-center justify-center">
                <button onClick={onAdd} className="kc-btn kc-btn--primary">
                  ＋ Add folders
                </button>
                <button onClick={loadFile} className="kc-btn kc-btn--ghost">
                  Load a file
                </button>
              </div>
              <div className="text-[10px] text-dim mt-2">
                Or drop files / folders onto the Kill-Chain window
              </div>
            </>
          ) : undefined
        }
      />
    </div>
  );
}
