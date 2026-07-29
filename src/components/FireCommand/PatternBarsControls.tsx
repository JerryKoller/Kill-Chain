/**
 * Compact per-editor pattern length controls (replaces the old global Duration strip).
 * Arrangement / Piano Roll / Drums each mount their own copy — all drive the active pattern.
 */

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

  const apply = (n: number) => {
    const next = Math.max(1, Math.min(MAX_BARS, Math.round(n)));
    if (!Number.isFinite(next) || next === bars) return;
    if (next > bars) {
      useFireSequencerStore.getState().setBarsWithMode(next, "empty");
    } else {
      setBars(next);
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/30 ${compact ? "p-0.5" : "p-1"}`}
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
          className={`${compact ? "h-7 min-w-[1.6rem] px-1" : "h-8 min-w-[2rem] px-1.5"} rounded-md text-[10px] font-mono transition`}
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
        type="number"
        min={1}
        max={MAX_BARS}
        value={bars}
        onChange={(e) => apply(Number(e.target.value))}
        className={`${compact ? "w-8 h-7" : "w-10 h-8"} rounded-md bg-black/40 text-center font-mono text-[10px] text-white/75 outline-none`}
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
