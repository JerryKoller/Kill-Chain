/**
 * Arrangement timeline length — independent of pattern Bars (piano / drums).
 */

import { useEffect, useState } from "react";
import { useFireSequencerStore, MAX_ARRANGEMENT_BARS } from "@/state/fireSequencerStore";

const PRESETS = [16, 32, 64, 128, 256] as const;

export function ArrangementBarsControls({
  compact = true,
  accent = "#ff6a3d",
}: {
  compact?: boolean;
  accent?: string;
}) {
  const arrangementBars = useFireSequencerStore((s) => s.arrangementBars);
  const setArrangementBars = useFireSequencerStore((s) => s.setArrangementBars);
  const [draft, setDraft] = useState(String(arrangementBars));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(arrangementBars));
  }, [arrangementBars, focused]);

  const apply = (n: number) => {
    const next = Math.max(1, Math.min(MAX_ARRANGEMENT_BARS, Math.round(n)));
    if (!Number.isFinite(next) || next === arrangementBars) return;
    setArrangementBars(next);
  };

  const commitDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(arrangementBars));
      return;
    }
    apply(n);
    setDraft(String(Math.max(1, Math.min(MAX_ARRANGEMENT_BARS, Math.round(n)))));
  };

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/30 shrink-0 ${compact ? "p-0.5" : "p-1"}`}
      title={`Arrangement timeline length (1–${MAX_ARRANGEMENT_BARS} bars) — independent of pattern length`}
    >
      <span className="px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/48">
        Bars
      </span>
      {PRESETS.filter((b) => b <= MAX_ARRANGEMENT_BARS).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => apply(b)}
          className={`${compact ? "h-7 min-w-[1.6rem] px-1" : "h-8 min-w-[2rem] px-1.5"} rounded-md text-[10px] font-mono tabular-nums transition`}
          style={
            arrangementBars === b
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
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitDraft();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(String(arrangementBars));
            e.currentTarget.blur();
          }
        }}
        className={`${compact ? "w-9 h-7" : "w-11 h-8"} rounded-md bg-black/40 text-center font-mono text-[10px] tabular-nums text-white/75 outline-none`}
        style={{ boxShadow: `inset 0 0 0 1px ${accent}40` }}
        aria-label="Arrangement bars"
      />
    </div>
  );
}
