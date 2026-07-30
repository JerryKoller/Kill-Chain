/**
 * Compact per-editor pattern length controls (replaces the old global Duration strip).
 * Piano Roll / Drums mount this — Arrangement uses ArrangementBarsControls instead.
 */

import { useEffect, useState } from "react";
import { useFireSequencerStore, MAX_BARS } from "@/state/fireSequencerStore";

const PRESETS = [1, 2, 4, 8, 16] as const;

export function PatternBarsControls({
  compact = true,
  accent = "#ff6a3d",
}: {
  compact?: boolean;
  accent?: string;
}) {
  const bars = useFireSequencerStore((s) => s.bars);
  const setBars = useFireSequencerStore((s) => s.setBars);
  const [draft, setDraft] = useState(String(bars));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(bars));
  }, [bars, focused]);

  const apply = (n: number) => {
    const next = Math.max(1, Math.min(MAX_BARS, Math.round(n)));
    if (!Number.isFinite(next) || next === bars) return;
    if (next > bars) {
      useFireSequencerStore.getState().setBarsWithMode(next, "empty");
    } else {
      setBars(next);
    }
  };

  const commitDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(bars));
      return;
    }
    apply(n);
    setDraft(String(Math.max(1, Math.min(MAX_BARS, Math.round(n)))));
  };

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/30 shrink-0 ${compact ? "p-0.5" : "p-1"}`}
      title="Active pattern length (bars)"
    >
      <span className="px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/48">
        Bars
      </span>
      {PRESETS.filter((b) => b <= MAX_BARS).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => apply(b)}
          className={`${compact ? "h-7 min-w-[1.6rem] px-1" : "h-8 min-w-[2rem] px-1.5"} rounded-md text-[10px] font-mono tabular-nums transition`}
          style={
            bars === b
              ? { background: `${accent}33`, color: accent }
              : { color: "rgba(255,255,255,0.45)" }
          }
        >
          {b}
        </button>
      ))}
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitDraft();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(String(bars));
            e.currentTarget.blur();
          }
        }}
        className={`${compact ? "w-8 h-7" : "w-10 h-8"} rounded-md bg-black/40 text-center font-mono text-[10px] tabular-nums text-white/75 outline-none`}
        style={{ boxShadow: `inset 0 0 0 1px ${accent}40` }}
        aria-label="Pattern bars"
      />
      <button
        type="button"
        disabled={bars * 2 > MAX_BARS}
        onClick={() => useFireSequencerStore.getState().duplicatePattern()}
        className={`${compact ? "h-7 px-1.5" : "h-8 px-2"} rounded-md text-[9px] font-bold uppercase tracking-wider text-white/45 hover:text-white/80 disabled:opacity-30`}
        title="Double pattern length and repeat contents"
      >
        ×2
      </button>
    </div>
  );
}
