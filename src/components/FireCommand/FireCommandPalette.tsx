/**
 * Cmd/Ctrl+K command palette — jump modules, density, workspace, Open Fire.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { FIRE_BANDS, FIRE_MODULE_BY_ID } from "./fireModuleAtlas";
import { FIRE_PARAM_INDEX } from "./fireParamIndex";
import { jumpToModule } from "./fireNavigate";
import { useFireLayout } from "./FireLayoutContext";
import { trapTabKey } from "./fireUiKit";

/**
 * Fired by chrome that wants to open the palette (the "Jump ⌘K" hint in the
 * utility strip). An event keeps the affordance decoupled from where the
 * palette's open state happens to live.
 */
export const FIRE_PALETTE_EVENT = "killchain.fire.palette.open";
export const FIRE_DUAL_TOGGLE_EVENT = "killchain.fire.dual.toggle";

type Item = {
  id: string;
  label: string;
  hint: string;
  /** Extra search terms (aliases, nicknames) that aren't shown in the row. */
  keywords?: string;
  run: () => void;
};

export function FireCommandPalette({
  open,
  onClose,
  onWorkspace,
}: {
  open: boolean;
  onClose: () => void;
  onWorkspace?: (ws: "synth" | "sequencer") => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { exitFocus } = useFireLayout();
  const setDensity = useFireCommandStore((s) => s.setFireUiDensity);
  const cycleKeyboard = useFireCommandStore((s) => s.cycleKeyboardMode);
  const setLabelMode = useFireCommandStore((s) => s.setLabelMode);
  const setAccordion = useFireCommandStore((s) => s.setAccordionMode);
  const accordion = useFireCommandStore((s) => s.accordionMode);
  const togglePlay = useFireSequencerStore((s) => s.togglePlay);
  const setPlayScope = useFireSequencerStore((s) => s.setPlayScope);
  const panic = useFireCommandStore((s) => s.panic);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      {
        id: "ws-synth",
        label: "Workspace · Synth",
        hint: "Sound design",
        run: () => onWorkspace?.("synth"),
      },
      {
        id: "ws-seq",
        label: "Workspace · Sequencer",
        hint: "Time & groove",
        run: () => onWorkspace?.("sequencer"),
      },
      {
        id: "open-fire",
        label: "Open Fire / Hold Fire",
        hint: "Toggle transport",
        run: () => togglePlay(),
      },
      {
        id: "scope-pat",
        label: "Open Fire scope · Pattern",
        hint: "Loop active pattern",
        run: () => setPlayScope("pattern"),
      },
      {
        id: "scope-arr",
        label: "Open Fire scope · Arrangement",
        hint: "Play playlist",
        run: () => setPlayScope("arrangement"),
      },
      {
        id: "scope-sel",
        label: "Open Fire scope · Selection",
        hint: "Loop selection range",
        run: () => setPlayScope("selection"),
      },
      {
        id: "dens-studio",
        label: "Density · Studio",
        hint: "Full chrome",
        run: () => setDensity("studio"),
      },
      {
        id: "dens-compact",
        label: "Density · Compact",
        hint: "Shorter chrome",
        run: () => setDensity("compact"),
      },
      {
        id: "dens-focus",
        label: "Density · Focus",
        hint: "Essential only",
        run: () => setDensity("focus"),
      },
      {
        id: "kbd-cycle",
        label: "Keyboard · Cycle size",
        hint: "Full → Strip → Hidden",
        run: () => cycleKeyboard(),
      },
      {
        id: "lbl-both",
        label: "Labels · Both",
        hint: "Character + technical",
        run: () => setLabelMode("both"),
      },
      {
        id: "lbl-char",
        label: "Labels · Character",
        hint: "Nicknames",
        run: () => setLabelMode("character"),
      },
      {
        id: "lbl-tech",
        label: "Labels · Technical",
        hint: "Canonical titles",
        run: () => setLabelMode("technical"),
      },
      {
        id: "acc",
        label: accordion ? "Accordion · Off" : "Accordion · On",
        hint: "One module open at a time",
        run: () => setAccordion(!accordion),
      },
      {
        id: "exit-focus",
        label: "Exit Δ Focus",
        hint: "Show all modules",
        run: () => exitFocus(),
      },
      {
        id: "panic",
        label: "Panic · All notes off",
        hint: "Silence",
        run: () => panic(),
      },
      {
        id: "wake-all",
        label: "Wake all modules",
        hint: "Un-sleep every slept module",
        keywords: "enable unmute asleep",
        run: () => useFireCommandStore.getState().setParam("moduleEnable", {}),
      },
      {
        id: "dual-expand",
        label: "Expand sequencer to second display",
        hint: "Dual monitor",
        keywords: "span undock dual monitor second screen collapse",
        run: () => window.dispatchEvent(new CustomEvent(FIRE_DUAL_TOGGLE_EVENT)),
      },
    ];
    for (const band of FIRE_BANDS) {
      for (const mod of band.modules) {
        list.push({
          id: `mod-${mod.id}`,
          label: `${mod.title}`,
          hint: `${band.title} · ${mod.short}`,
          // Search the character nickname and abbreviation too: a user who
          // knows a module as "Prime Voice" or "OscA" could not find
          // "Oscillator A" when only label + hint were matched.
          keywords: `${mod.short} ${mod.subtitle} ${mod.abbrev} ${band.short} ${band.hint}`,
          // Jump only — soloing every palette destination was too aggressive.
          run: () => jumpToModule(mod.id),
        });
      }
    }
    // PARAMETER INDEX. Knobs were unreachable from the palette, so finding one
    // meant knowing which of the six bands owns it. Each entry jumps to the
    // owning module (and wakes it if a preset slept it).
    for (const p of FIRE_PARAM_INDEX) {
      const mod = FIRE_MODULE_BY_ID.get(p.moduleId);
      list.push({
        id: `param-${p.moduleId}-${p.label}`,
        label: p.label,
        hint: `Parameter · ${mod?.title ?? p.moduleId}`,
        keywords: `${p.keywords ?? ""} ${mod?.short ?? ""} ${mod?.abbrev ?? ""}`,
        run: () => jumpToModule(p.moduleId),
      });
    }
    return list;
  }, [
    accordion, onWorkspace, togglePlay, setPlayScope, setDensity,
    cycleKeyboard, setLabelMode, setAccordion, exitFocus, panic,
  ]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Empty query used to show an arbitrary first 24 entries, which buried the
    // module list under the action commands. Show actions + every module.
    if (!needle) return items.filter((it) => !it.id.startsWith("param-"));
    const hay = (it: Item) =>
      `${it.label} ${it.hint} ${it.keywords ?? ""}`.toLowerCase();
    // Rank exact label prefix > label contains > anything else, so typing
    // "cut" surfaces "Cutoff" above a module whose hint mentions it.
    const scored = items
      .map((it) => {
        const label = it.label.toLowerCase();
        if (label.startsWith(needle)) return { it, s: 0 };
        if (label.includes(needle)) return { it, s: 1 };
        if (hay(it).includes(needle)) return { it, s: 2 };
        return null;
      })
      .filter((x): x is { it: Item; s: number } => x !== null)
      .sort((a, b) => a.s - b.s);
    return scored.slice(0, 40).map((x) => x.it);
  }, [items, q]);

  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => {
    if (open) {
      setQ("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Latest-value refs so the window keydown listener doesn't rebind per keystroke.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(filteredRef.current.length - 1, i + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = filteredRef.current[activeRef.current];
        if (it) { it.run(); onClose(); }
      }
      if (panelRef.current) trapTabKey(panelRef.current, e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-2xl border border-white/15 shadow-2xl overflow-hidden"
        style={{ background: "linear-gradient(180deg, #1a1618 0%, #0e0c10 100%)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10">
          <span className="fc-text-telemetry uppercase tracking-[0.16em] text-white/40">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump, density, Open Fire…"
            className="flex-1 bg-transparent outline-none fc-text-primary text-white placeholder:text-white/30"
          />
          <kbd className="fc-text-telemetry text-white/35 border border-white/10 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.map((it, i) => {
            const mod = it.id.startsWith("mod-") ? FIRE_MODULE_BY_ID.get(it.id.slice(4)) : null;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition ${
                    i === active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { it.run(); onClose(); }}
                >
                  <span className="fc-text-primary truncate" style={mod ? { color: mod.color } : undefined}>
                    {it.label}
                  </span>
                  <span className="fc-text-telemetry shrink-0 text-white/35">{it.hint}</span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-3 py-4 fc-text-secondary text-white/40">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
