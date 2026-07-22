/**
 * PresetBrowser — the Fire Command armory. Two-pane browser (category rail +
 * searchable list) built for a 500+ preset bank: the list renders flat cards
 * with no per-card animation so even "All" stays snappy.
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
import { MISSION_PACKS } from "@/audio/dsp/fireMissionPacks";
import { loadProjectData } from "@/lib/fireStudio";

const FIRE = "#ff6a3d";

const CAT_COLOR: Record<string, string> = {
  Missions: "#ffd166",
  Bass: "#ff5c2e",
  Lead: "#ffb648",
  Pluck: "#ffd166",
  Pad: "#62b6ff",
  Keys: "#7ce8d5",
  Arp: "#9be564",
  FX: "#c98bff",
  Atmos: "#8fa8ff",
  User: "#ff9a6b",
};

const CAT_ICON: Record<string, string> = {
  All: "◈",
  Missions: "🎯",
  Bass: "▁",
  Lead: "⚡",
  Pluck: "✦",
  Pad: "≋",
  Keys: "⌨",
  Arp: "⇶",
  FX: "☄",
  Atmos: "🌫",
  User: "★",
};

type Filter = "All" | "Missions" | PresetCategory | "User";

interface Card {
  id: string;
  name: string;
  desc: string;
  category: Filter;
  user: boolean;
}

export function PresetBrowser({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Focus search so you can type immediately.
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [open, onClose]);

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
    m.set("Missions", MISSION_PACKS.length);
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
    const order: Filter[] = [...PRESET_CATEGORIES, "User"];
    return order
      .map((cat) => ({ cat, items: filtered.filter((c) => c.category === cat) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const doSave = () => {
    const id = savePreset(saveName);
    setSaveName("");
    setFilter("User");
    loadPreset(id);
  };

  const rail: Filter[] = ["All", "Missions", ...PRESET_CATEGORIES, "User"];

  const deployPack = (packId: string) => {
    const pack = MISSION_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    loadProjectData(pack.payload());
    toast(`🎯 ${pack.name} deployed — patch, drums, sections and chain are live. Hit play.`);
    onClose();
  };

  const missionItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MISSION_PACKS;
    return MISSION_PACKS.filter(
      (p) =>
        p.name.toLowerCase().includes(q)
        || p.desc.toLowerCase().includes(q)
        || p.tagline.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 14 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl h-[86vh] rounded-2xl flex flex-col overflow-hidden border border-[#ff6a3d]/25"
            style={{
              background: "linear-gradient(165deg, rgb(24 12 8 / 0.99), rgb(10 6 10 / 0.995))",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 60px rgba(255,90,40,0.08) inset",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#ff6a3d]/15">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl grid place-items-center text-lg"
                  style={{ background: "linear-gradient(145deg, #ff6a3d33, #ff2e1a22)", border: "1px solid #ff6a3d55" }}
                >🔥</div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.4em]" style={{ color: "#ff9a6b" }}>Fire Command</div>
                  <div className="text-lg font-bold tracking-wide text-white">THE ARMORY</div>
                </div>
                <div className="ml-2 text-[10px] font-mono text-white/35 tabular-nums">
                  {FIRE_PRESETS.length} factory · {userPresets.length} saved
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 grid place-items-center rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition"
              >{"\u2715"}</button>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-white/6">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${counts.get(filter) ?? 0} presets…`}
                className="flex-1 min-w-[160px] rounded-lg border border-white/12 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#ff6a3d]/60"
              />
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSave(); }}
                placeholder="Name this patch…"
                className="w-[170px] rounded-lg border border-white/12 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#ff6a3d]/60"
              />
              <button
                onClick={doSave}
                className="rounded-lg border border-[#ff6a3d]/60 bg-[#ff6a3d]/15 hover:bg-[#ff6a3d]/25 px-3.5 py-1.5 text-sm font-bold transition"
                style={{ color: "#ffd9c9" }}
              >＋ Save</button>
              <button
                onClick={() => {
                  randomize();
                  toast("🎲 Fresh random patch generated — hit ＋ Save to keep it");
                }}
                className="rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-sm text-white/80 transition"
                title="Generate a fresh random patch (not from the preset bank)"
              >🎲</button>
            </div>

            {/* Body: rail + list */}
            <div className="flex-1 flex min-h-0">
              <div className="w-[124px] shrink-0 border-r border-white/6 py-2 px-1.5 space-y-0.5 overflow-y-auto">
                {rail.map((t) => {
                  const active = filter === t;
                  const color = t === "All" ? FIRE : CAT_COLOR[t] ?? "#fff";
                  return (
                    <button
                      key={t}
                      onClick={() => setFilter(t)}
                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition border ${
                        active ? "bg-white/[0.07] border-white/15" : "border-transparent text-white/55 hover:bg-white/[0.04]"
                      }`}
                      style={active ? { color } : undefined}
                    >
                      <span className="w-4 text-center opacity-80">{CAT_ICON[t] ?? "·"}</span>
                      <span className="flex-1 text-left">{t}</span>
                      <span className="text-[9px] font-mono opacity-45 tabular-nums">{counts.get(t) ?? 0}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {filter === "Missions" ? (
                  <div>
                    <div className="mb-3 text-[11px] text-white/45 leading-relaxed">
                      Mission packs load an ENTIRE production — synth patches, drum grids,
                      note riffs, sections and the song chain — replacing what's loaded now.
                      (Ctrl+Z brings your work back.)
                    </div>
                    {missionItems.length === 0 && (
                      <div className="text-center text-sm text-dim py-10">No mission packs match your search.</div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {missionItems.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => deployPack(p.id)}
                          className="group cursor-pointer rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 p-3 transition"
                          style={{ boxShadow: `inset 3px 0 0 ${p.color}` }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{p.name}</span>
                            <span
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded-md border"
                              style={{ color: p.color, borderColor: `${p.color}55`, background: `${p.color}14` }}
                            >{p.bpm} BPM</span>
                            <span className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] font-bold uppercase tracking-[0.15em] transition" style={{ color: p.color }}>
                              Deploy ▸
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] font-semibold" style={{ color: `${p.color}cc` }}>{p.tagline}</div>
                          <div className="mt-1 text-[11px] text-white/45 leading-snug">{p.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                {groups.length === 0 && (
                  <div className="text-center text-sm text-dim py-10">
                    {filter === "User"
                      ? "No saved patches yet — dial in a sound and hit “＋ Save”."
                      : "No presets match your search."}
                  </div>
                )}
                {groups.map((g) => (
                  <div key={g.cat}>
                    <div className="flex items-center gap-2 mb-2 sticky top-0 z-10 py-1 -my-1"
                      style={{ background: "linear-gradient(180deg, rgb(18 10 8 / 0.97), rgb(18 10 8 / 0.85))" }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[g.cat] ?? "#fff" }} />
                      <span className="text-[10px] uppercase tracking-[0.25em] text-white/60 font-semibold">{g.cat}</span>
                      <span className="text-[10px] text-white/25 font-mono">{g.items.length}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {g.items.map((c) => {
                        const active = presetId === c.id;
                        const color = CAT_COLOR[c.category] ?? FIRE;
                        return (
                          <div
                            key={c.id}
                            onClick={() => loadPreset(c.id)}
                            className={`group cursor-pointer rounded-lg border px-2.5 py-2 transition ${
                              active
                                ? "border-[#ff6a3d]/70 bg-[#ff6a3d]/[0.14]"
                                : "border-white/6 bg-white/[0.025] hover:bg-white/[0.06] hover:border-white/18"
                            }`}
                            style={active ? { boxShadow: "0 0 16px rgb(255 106 61 / 0.2)" } : undefined}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color, opacity: active ? 1 : 0.5 }} />
                              <div className="min-w-0 flex-1">
                                {renamingId === c.id ? (
                                  <input
                                    autoFocus
                                    value={renameText}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setRenameText(e.target.value)}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                      if (e.key === "Escape") { setRenameText(""); setRenamingId(null); }
                                    }}
                                    onBlur={() => {
                                      if (renameText.trim()) renameUserPreset(c.id, renameText.trim());
                                      setRenamingId(null);
                                    }}
                                    className="w-full rounded-md border border-[#ff6a3d]/50 bg-black/50 px-1.5 py-0.5 text-[13px] text-white outline-none"
                                  />
                                ) : (
                                  <div className="text-[13px] font-semibold text-white truncate leading-tight">{c.name}</div>
                                )}
                                <div className="text-[10px] text-white/40 truncate leading-tight">{c.desc}</div>
                              </div>
                              {c.user && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenamingId(c.id);
                                      setRenameText(c.name);
                                    }}
                                    className="w-5 h-5 grid place-items-center rounded border border-white/10 text-white/55 hover:text-white hover:border-white/30 text-[10px]"
                                    title="Rename"
                                  >✎</button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirmDeleteId === c.id) {
                                        deleteUserPreset(c.id);
                                        setConfirmDeleteId(null);
                                      } else {
                                        setConfirmDeleteId(c.id);
                                        setTimeout(() => setConfirmDeleteId(null), 2200);
                                      }
                                    }}
                                    className={`h-5 grid place-items-center rounded border text-[10px] px-1 transition ${
                                      confirmDeleteId === c.id
                                        ? "border-rose-400/70 bg-rose-500/25 text-rose-100"
                                        : "border-rose-400/30 text-rose-300/70 hover:text-rose-200 hover:border-rose-400/60 w-5"
                                    }`}
                                    title="Delete"
                                  >{confirmDeleteId === c.id ? "CONFIRM PURGE" : "✕"}</button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                  </>
                )}
              </div>
            </div>

            <div className="px-4 py-2 border-t border-white/6 text-[9px] uppercase tracking-[0.3em] text-white/30 text-center">
              Click to deploy · Esc to close
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
