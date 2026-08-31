/**
 * Synth keyboard-shortcut reference.
 *
 * The Sequencer workspace had a `?` overlay; the Synth workspace had none, so
 * every power interaction here — the command palette, Solo, Pin, octave keys,
 * undo — was either tooltip-only or entirely undocumented. Opens on `?` (and
 * from the Jump chip's sibling in the utility strip).
 */

import { useEffect, useState } from "react";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Navigate",
    rows: [
      ["Ctrl / ⌘ + K", "Jump to any module or parameter"],
      ["Click breadcrumb", "Workspace · band · module"],
      ["Esc", "Exit Solo / close overlays"],
      ["?", "This overlay"],
    ],
  },
  {
    title: "Play",
    rows: [
      ["Space", "Play / stop transport"],
      ["Z / X", "Octave down / up"],
      ["A W S E D …", "Play notes (QWERTY keyboard)"],
      ["Panic", "All notes off (header button)"],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Ctrl / ⌘ + Z", "Undo"],
      ["Ctrl / ⌘ + Y", "Redo (or Shift+Z)"],
      ["Double-click knob", "Reset to patch default"],
      ["Shift + drag knob", "Fine adjust"],
    ],
  },
  {
    title: "Modules",
    rows: [
      ["Solo (card header)", "Hide every other module"],
      ["Pin (card header)", "Stay open when accordion folds others"],
      ["Lock (card header)", "Protect from Armory / mutation"],
      ["Wake all", "Un-sleep modules a preset slept"],
    ],
  },
];

export function FireShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t
        && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Synth keyboard shortcuts"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/12 bg-[#0b0d13] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#ffbfa0]">
            Synth shortcuts
          </div>
          <button
            type="button"
            className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-white/60 hover:text-white"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-white/40">
                {g.title}
              </div>
              <div className="space-y-1">
                {g.rows.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline gap-2 text-[11px]">
                    <kbd className="shrink-0 rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/85">
                      {keys}
                    </kbd>
                    <span className="text-white/60">{what}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-white/30">
          Press <kbd className="font-mono text-white/60">?</kbd> again or Esc to close.
        </div>
      </div>
    </div>
  );
}
