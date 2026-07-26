/**
 * CharacterBrowser — Genesis character cards grouped by phase.
 * Deploy loads patch (+ optional arp), toasts, and jumps to the first focus module.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FIRE_CHARACTERS,
  FIRE_CHARACTER_PHASES,
  resolveCharacterPatch,
  type FireCharacter,
  type FireCharacterPhase,
} from "@/audio/dsp/fireCharacters";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";
import { ensureExpanded, jumpToModule } from "./fireNavigate";

export function CharacterBrowser({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const applyCharacterPatch = useFireCommandStore((s) => s.applyCharacterPatch);
  const toast = useUIStore((s) => s.toast);
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<FireCharacterPhase | "all">("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FIRE_CHARACTERS.filter((c) => {
      if (phaseFilter !== "all" && c.phase !== phaseFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q)
        || c.tagline.toLowerCase().includes(q)
        || c.inspiration.toLowerCase().includes(q)
        || c.phase.toLowerCase().includes(q)
      );
    });
  }, [query, phaseFilter]);

  const groups = useMemo(() => {
    return FIRE_CHARACTER_PHASES
      .map((p) => ({
        ...p,
        items: filtered.filter((c) => c.phase === p.id),
      }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const deploy = (c: FireCharacter) => {
    const patch = resolveCharacterPatch(c);
    applyCharacterPatch(patch, c.arp);
    toast(`Character · ${c.name}`);
    onClose();
    const first = c.focusModules[0];
    if (first) {
      // Expand band chips, then jump after modal exit animation settles.
      ensureExpanded(first);
      window.setTimeout(() => jumpToModule(first), 120);
    }
  };

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
            className="w-full max-w-4xl h-[86vh] rounded-2xl flex flex-col overflow-hidden border border-[#a78bfa]/30"
            style={{
              background: "linear-gradient(165deg, rgb(18 12 28 / 0.99), rgb(8 6 14 / 0.995))",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 60px rgba(167,139,250,0.08) inset",
            }}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#a78bfa]/18">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl grid place-items-center text-lg"
                  style={{ background: "linear-gradient(145deg, #a78bfa33, #7c3aed22)", border: "1px solid #a78bfa55" }}
                >
                  ✦
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.4em]" style={{ color: "#c4b5fd" }}>
                    Fire Command Genesis
                  </div>
                  <div className="text-lg font-bold tracking-wide text-white">Characters</div>
                </div>
                <div className="ml-2 text-[10px] font-mono text-white/35 tabular-nums">
                  {FIRE_CHARACTERS.length} inspired voices
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 grid place-items-center rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition"
              >
                {"\u2715"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-white/6">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${filtered.length} characters…`}
                className="flex-1 min-w-[160px] rounded-lg border border-white/12 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#a78bfa]/60"
              />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPhaseFilter("all")}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    phaseFilter === "all"
                      ? "border-[#a78bfa]/50 bg-[#a78bfa]/15 text-[#e9d5ff]"
                      : "border-white/10 text-white/50 hover:bg-white/5"
                  }`}
                >
                  All
                </button>
                {FIRE_CHARACTER_PHASES.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPhaseFilter(p.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      phaseFilter === p.id
                        ? "text-white"
                        : "border-white/10 text-white/50 hover:bg-white/5"
                    }`}
                    style={
                      phaseFilter === p.id
                        ? { color: p.color, borderColor: `${p.color}55`, background: `${p.color}18` }
                        : undefined
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="text-[11px] text-white/45 leading-relaxed px-0.5">
                Characters load inspired defaults and jump you to the knobs that matter.
                Shared DSP stays available — this is DNA, not a separate engine.
              </div>
              {groups.length === 0 && (
                <div className="text-center text-sm text-white/40 py-10">No characters match your search.</div>
              )}
              {groups.map((g) => (
                <div key={g.id}>
                  <div
                    className="flex items-center gap-2 mb-2 sticky top-0 z-10 py-1 -my-1"
                    style={{ background: "linear-gradient(180deg, rgb(14 10 22 / 0.97), rgb(14 10 22 / 0.85))" }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                    <span className="text-[10px] uppercase tracking-[0.25em] text-white/60 font-semibold">{g.label}</span>
                    <span className="text-[10px] text-white/25 font-mono">{g.items.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {g.items.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => deploy(c)}
                        className="group cursor-pointer rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 p-3 transition"
                        style={{ boxShadow: `inset 3px 0 0 ${c.color}` }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{c.name}</span>
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded-md border"
                            style={{ color: c.color, borderColor: `${c.color}55`, background: `${c.color}14` }}
                          >
                            {c.phase}
                          </span>
                          <span
                            className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] font-bold uppercase tracking-[0.15em] transition"
                            style={{ color: c.color }}
                          >
                            Deploy ▸
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] font-semibold" style={{ color: `${c.color}cc` }}>
                          {c.tagline}
                        </div>
                        <div className="mt-1 text-[11px] text-white/45 leading-snug">
                          Inspired by {c.inspiration}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-2 border-t border-white/6 text-[9px] uppercase tracking-[0.3em] text-white/30 text-center">
              Click to deploy character · Esc to close
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default CharacterBrowser;
