/**
 * PresetBrowser — Fire Command patch library. Two-pane category rail + list.
 * Flat cards, no emoji chrome.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  useFireCommandStore,
  FIRE_PRESETS,
  PRESET_CATEGORIES,
  type PresetCategory,
} from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";

const FIRE = "#ff6a3d";

const CAT_COLOR: Record<string, string> = {
  Bass: "#ff5c2e",
  Lead: "#ffb648",
  Pluck: "#ffd166",
  Pad: "#62b6ff",
  Keys: "#7ce8d5",
  Arp: "#9be564",
  FX: "#c98bff",
  Atmos: "#8fa8ff",
  Vintage: "#c9a66b",
  Chip: "#6ee7a8",
  FM: "#a78bfa",
  User: "#ff9a6b",
};

/** Text marks only — no emoji. */
const CAT_MARK: Record<string, string> = {
  All: "ALL",
  Bass: "BAS",
  Lead: "LED",
  Pluck: "PLK",
  Pad: "PAD",
  Keys: "KEY",
  Arp: "ARP",
  FX: "FX",
  Atmos: "ATM",
  Vintage: "VIN",
  Chip: "CHP",
  FM: "FM",
  User: "USR",
};

type Filter = "All" | PresetCategory | "User";

interface Card {
  id: string;
  name: string;
  desc: string;
  category: Filter;
  user: boolean;
}

export function PresetBrowser({
  open,
  onClose,
  initialFilter,
}: {
  open: boolean;
  onClose: () => void;
  initialFilter?: Filter;
}) {
  const presetId = useFireCommandStore((s) => s.presetId);
  const userPresets = useFireCommandStore((s) => s.userPresets);
  const loadPreset = useFireCommandStore((s) => s.loadPreset);
  const savePreset = useFireCommandStore((s) => s.savePreset);
  const deleteUserPreset = useFireCommandStore((s) => s.deleteUserPreset);
  const renameUserPreset = useFireCommandStore((s) => s.renameUserPreset);
  const randomize = useFireCommandStore((s) => s.randomize);
  const toast = useUIStore((s) => s.toast);

  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initialFilter) setFilter(initialFilter);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [open, onClose, initialFilter]);

  const cards = useMemo<Card[]>(() => {
    const factory: Card[] = FIRE_PRESETS.map((p) => ({
      id: p.id, name: p.name, desc: p.desc, category: p.category, user: false,
    }));
    const users: Card[] = [...userPresets]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => ({ id: p.id, name: p.name, desc: "Your saved patch", category: "User" as const, user: true }));
    return [...factory, ...users];
  }, [userPresets]);

  const counts = useMemo(() => {
    const m = new Map<Filter, number>();
    m.set("All", cards.length);
    for (const c of cards) m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return m;
  }, [cards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter !== "All" && c.category !== filter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q);
    });
  }, [cards, filter, query]);

  const groups = useMemo(() => {
    if (filter !== "All") return [{ cat: filter, items: filtered }];
    return PRESET_CATEGORIES
      .map((cat) => ({ cat, items: filtered.filter((c) => c.category === cat) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, filter]);

  const doSave = () => {
    const id = savePreset(saveName);
    setSaveName("");
    setFilter("User");
    toast(`Saved · ${useFireCommandStore.getState().userPresets.find((p) => p.id === id)?.name ?? "patch"}`);
  };

  const rail: Filter[] = ["All", ...PRESET_CATEGORIES, "User"];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 bg-black/85"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.98, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, y: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl h-[88vh] rounded-2xl flex flex-col overflow-hidden border border-white/[0.1]"
            style={{
              background: "linear-gradient(165deg, #12141a 0%, #0a0b0f 55%, #08090c 100%)",
              boxShadow: "0 28px 90px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/[0.07]">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-lg grid place-items-center shrink-0 text-[11px] font-black tracking-wider"
                  style={{
                    color: FIRE,
                    background: "linear-gradient(145deg, rgba(255,106,61,0.2), rgba(0,0,0,0.4))",
                    border: "1px solid rgba(255,106,61,0.4)",
                  }}
                >FC</div>
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.28em] text-white/40">Fire Command</div>
                  <div className="text-base font-bold tracking-wide text-white">Patch Library</div>
                </div>
                <div className="hidden sm:flex items-center gap-2 ml-2 text-[10px] font-mono text-white/35 tabular-nums">
                  <span className="rounded border border-white/10 px-1.5 py-0.5">{FIRE_PRESETS.length} factory</span>
                  <span className="rounded border border-white/10 px-1.5 py-0.5">{userPresets.length} saved</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 grid place-items-center rounded-lg border border-white/10 text-white/55 hover:text-white hover:border-white/25 transition"
                aria-label="Close"
              >{"\u2715"}</button>
            </div>

            {/* Toolbar — search primary, save secondary */}
            <div className="flex flex-col gap-2 px-5 py-2.5 border-b border-white/[0.06] sm:flex-row sm:items-center">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${counts.get(filter) ?? 0} patches…`}
                className="flex-1 min-w-0 rounded-lg border border-white/12 bg-black/45 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#ff6a3d]/55"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doSave(); }}
                  placeholder="Save as…"
                  className="w-[140px] rounded-lg border border-white/12 bg-black/45 px-2.5 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#ff6a3d]/55"
                />
                <button
                  type="button"
                  onClick={doSave}
                  className="rounded-lg border border-[#ff6a3d]/55 bg-[#ff6a3d]/15 hover:bg-[#ff6a3d]/25 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition"
                  style={{ color: "#ffd9c9" }}
                >Save</button>
                <button
                  type="button"
                  onClick={() => {
                    randomize();
                    toast("Random patch — Save to keep it");
                  }}
                  className="rounded-lg border border-white/12 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/70 transition"
                  title="Generate a fresh random patch"
                >Dice</button>
              </div>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* Category rail */}
              <div className="w-[118px] shrink-0 border-r border-white/[0.06] py-2 px-1.5 space-y-0.5 overflow-y-auto">
                {rail.map((t) => {
                  const active = filter === t;
                  const color = t === "All" ? FIRE : CAT_COLOR[t] ?? "#fff";
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFilter(t)}
                      className={`w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition border ${
                        active ? "bg-white/[0.07] border-white/15" : "border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/75"
                      }`}
                      style={active ? { color, borderColor: `${color}44` } : undefined}
                    >
                      <span
                        className="w-7 shrink-0 text-center text-[8px] font-black tracking-wide rounded border border-current/20 py-0.5 opacity-80"
                      >{CAT_MARK[t] ?? "·"}</span>
                      <span className="flex-1 text-left truncate">{t}</span>
                      <span className="text-[9px] font-mono opacity-40 tabular-nums">{counts.get(t) ?? 0}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {groups.length === 0 && (
                  <div className="text-center text-sm text-white/35 py-12">No patches match.</div>
                )}
                {groups.map(({ cat, items }) => (
                  <div key={String(cat)}>
                    {filter === "All" && (
                      <div
                        className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]"
                        style={{ color: CAT_COLOR[cat] ?? "#fff" }}
                      >
                        <span className="opacity-70">{CAT_MARK[cat]}</span>
                        <span>{cat}</span>
                        <span className="h-px flex-1 bg-white/[0.06]" />
                        <span className="font-mono text-white/30 normal-case tracking-normal">{items.length}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {items.map((c) => {
                        const active = presetId === c.id;
                        const color = CAT_COLOR[c.category] ?? FIRE;
                        return (
                          <div
                            key={c.id}
                            className={`group relative rounded-lg border px-3 py-2.5 transition cursor-pointer ${
                              active
                                ? "border-white/25 bg-white/[0.07]"
                                : "border-white/[0.06] bg-black/25 hover:border-white/14 hover:bg-white/[0.04]"
                            }`}
                            style={active ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                            onClick={() => {
                              loadPreset(c.id);
                              toast(c.name);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className={`text-[13px] font-semibold truncate ${active ? "text-white" : "text-white/90"}`}>
                                  {c.name}
                                </div>
                                <div className="text-[10px] text-white/35 truncate mt-0.5">{c.desc}</div>
                              </div>
                              {c.user && (
                                <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100">
                                  <button
                                    type="button"
                                    className="w-6 h-6 rounded text-[10px] text-white/50 hover:text-white hover:bg-white/10"
                                    title="Rename"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenamingId(c.id);
                                      setRenameText(c.name);
                                    }}
                                  >✎</button>
                                  <button
                                    type="button"
                                    className="w-6 h-6 rounded text-[10px] text-white/50 hover:text-red-300 hover:bg-red-500/15"
                                    title="Delete"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteId(c.id);
                                    }}
                                  >✕</button>
                                </div>
                              )}
                            </div>
                            {renamingId === c.id && (
                              <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                                <input
                                  autoFocus
                                  value={renameText}
                                  onChange={(e) => setRenameText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      renameUserPreset(c.id, renameText);
                                      setRenamingId(null);
                                    }
                                    if (e.key === "Escape") setRenamingId(null);
                                  }}
                                  className="rounded border border-white/15 bg-black/50 px-2 py-1 text-xs text-white outline-none flex-1"
                                />
                                <button
                                  type="button"
                                  className="px-2 text-[10px] font-bold text-[#ffb08a]"
                                  onClick={() => {
                                    renameUserPreset(c.id, renameText);
                                    setRenamingId(null);
                                  }}
                                >OK</button>
                              </div>
                            )}
                            {confirmDeleteId === c.id && (
                              <div className="mt-2 flex items-center gap-2 text-[10px]" onClick={(e) => e.stopPropagation()}>
                                <span className="text-white/50">Delete?</span>
                                <button
                                  type="button"
                                  className="text-red-300 font-bold"
                                  onClick={() => {
                                    deleteUserPreset(c.id);
                                    setConfirmDeleteId(null);
                                  }}
                                >Yes</button>
                                <button type="button" className="text-white/40" onClick={() => setConfirmDeleteId(null)}>No</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-2 border-t border-white/[0.06] text-[10px] text-white/30 flex justify-between">
              <span>Click a patch to load · Esc closes</span>
              <span className="font-mono tabular-nums text-white/25">{filtered.length} shown</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
