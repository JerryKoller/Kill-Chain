import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMissionLogStore, type MissionLogEntry, type MissionSourceKind } from "@/state/missionLogStore";
import { describeChain } from "@/lib/chainSnapshot";
import { useUIStore } from "@/state/uiStore";

/**
 * Mission Log panel — the saved-chain library. Lists every logged source
 * (tracks, albums, playlists, Airspace), lets the user restore / pin /
 * rename / delete entries and arms the auto-restore switch. Opened from
 * Library, Airspace and the Sculptor header.
 */

const KIND_META: Record<MissionSourceKind, { label: string; icon: string }> = {
  track: { label: "Track", icon: "♪" },
  album: { label: "Album", icon: "◈" },
  playlist: { label: "Playlist", icon: "≣" },
  airspace: { label: "Airspace", icon: "⌁" },
};

function fmtAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

type KindFilter = "all" | MissionSourceKind;

export function MissionLogPanel({ onClose }: { onClose: () => void }) {
  const entries = useMissionLogStore((s) => s.entries);
  const autoRestore = useMissionLogStore((s) => s.autoRestore);
  const setAutoRestore = useMissionLogStore((s) => s.setAutoRestore);
  const applyEntry = useMissionLogStore((s) => s.applyEntry);
  const removeEntry = useMissionLogStore((s) => s.removeEntry);
  const togglePin = useMissionLogStore((s) => s.togglePin);
  const renameEntry = useMissionLogStore((s) => s.renameEntry);
  const toast = useUIStore((s) => s.toast);

  const [filter, setFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const skipRenameCommit = useRef(false);
  const renamingRef = useRef(renaming);
  renamingRef.current = renaming;
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (renamingRef.current) {
        skipRenameCommit.current = true;
        setRenaming(null);
        return;
      }
      if (searchRef.current) {
        setSearch("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(entries)
      .filter((e) => filter === "all" || e.kind === filter)
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.sub.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
      );
  }, [entries, filter, search]);

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, track: 0, album: 0, playlist: 0, airspace: 0 };
    for (const e of Object.values(entries)) {
      c.all++;
      c[e.kind]++;
    }
    return c;
  }, [entries]);

  const restore = (e: MissionLogEntry) => {
    if (applyEntry(e.key)) toast(`Mission Log — restored "${e.name}"`);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-sm"
      onPointerDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Mission Log"
    >
      <div className="glass-strong rounded-2xl border border-white/10 w-[min(680px,92vw)] max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-sm font-semibold tracking-wide">◎ Mission Log</div>
            <div className="text-[11px] text-dim mt-0.5">
              Saved chains per track, album, playlist and Airspace source
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRestore(!autoRestore)}
              className={`btn-ghost text-xs ${autoRestore ? "text-cyan" : "text-white/50"}`}
              title="When armed, a source with a saved chain gets it restored automatically the moment it plays"
            >
              {autoRestore ? "◉" : "○"} Auto-restore
            </button>
            <button
              onClick={onClose}
              className="rounded-lg w-7 h-7 grid place-items-center text-dim hover:text-white hover:bg-white/10"
              aria-label="Close Mission Log"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/5 flex-wrap">
          {(["all", "track", "album", "playlist", "airspace"] as KindFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full px-2.5 py-1 text-[11px] border transition ${
                filter === k
                  ? "border-cyan/50 bg-cyan/10 text-cyan"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
              }`}
            >
              {k === "all" ? "All" : KIND_META[k].label} · {counts[k]}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="ml-auto bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-cyan/40 w-40"
            aria-label="Search Mission Log"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto sidebar-scroll">
          {list.length === 0 ? (
            <div className="py-14 text-center text-xs text-dim px-8">
              {counts.all === 0 ? (
                <>
                  Nothing logged yet. Dial in a sound, then use{" "}
                  <span className="text-white/70">“Log this chain”</span> from a
                  track's ⋯ menu, the Airspace toolbar or the Sculptor header.
                </>
              ) : (
                "No entries match."
              )}
            </div>
          ) : (
            list.map((e) => (
              <div
                key={e.key}
                className="group flex items-center gap-3 px-5 py-2.5 border-b border-white/5 hover:bg-white/[0.03]"
              >
                <span
                  className="w-7 h-7 shrink-0 grid place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-sm"
                  title={KIND_META[e.kind].label}
                >
                  {KIND_META[e.kind].icon}
                </span>
                <div className="min-w-0 flex-1">
                  {renaming === e.key ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(ev) => setRenameValue(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") {
                          ev.preventDefault();
                          renameEntry(e.key, renameValue);
                          setRenaming(null);
                        }
                        if (ev.key === "Escape") {
                          ev.preventDefault();
                          skipRenameCommit.current = true;
                          setRenaming(null);
                        }
                      }}
                      onBlur={() => {
                        if (skipRenameCommit.current) {
                          skipRenameCommit.current = false;
                          return;
                        }
                        // Commit on blur — clicking away used to silently
                        // throw the typed name away.
                        if (renameValue.trim()) renameEntry(e.key, renameValue);
                        setRenaming(null);
                      }}
                      className="bg-white/[0.06] border border-cyan/40 rounded px-1.5 py-0.5 text-sm w-full outline-none"
                    />
                  ) : (
                    <div className="text-sm truncate">
                      {e.pinned && <span className="text-amber-300 mr-1">★</span>}
                      {e.name}
                      {e.sub && <span className="text-dim"> — {e.sub}</span>}
                    </div>
                  )}
                  <div className="text-[10px] text-dim truncate mt-0.5">
                    {describeChain(e.chain)} · {fmtAgo(e.updatedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                  <button
                    onClick={() => restore(e)}
                    className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-2.5 py-1 text-[11px] text-cyan"
                    title="Apply this saved chain now"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => togglePin(e.key)}
                    className={`rounded-lg w-7 h-7 grid place-items-center hover:bg-white/10 ${e.pinned ? "text-amber-300" : "text-dim"}`}
                    title={e.pinned ? "Unpin" : "Pin (survives log trimming)"}
                  >
                    ★
                  </button>
                  <button
                    onClick={() => {
                      setRenaming(e.key);
                      setRenameValue(e.name);
                    }}
                    className="rounded-lg w-7 h-7 grid place-items-center text-dim hover:bg-white/10"
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => {
                      removeEntry(e.key);
                      toast("Mission Log entry deleted");
                    }}
                    className="rounded-lg w-7 h-7 grid place-items-center text-dim hover:text-plasma hover:bg-white/10"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
