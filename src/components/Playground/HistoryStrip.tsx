import { useAudioStore } from "@/state/audioStore";

export function HistoryStrip() {
  const history = useAudioStore((s) => s.history);
  const future = useAudioStore((s) => s.future);
  const undo = useAudioStore((s) => s.undo);
  const redo = useAudioStore((s) => s.redo);

  const past = history.slice(-12);
  const next = future.slice(0, 6);

  // Plain ticks: index-based layoutIds made undo/redo replay WRONG shared-
  // layout morphs (entries shift index every step), and per-tick framer
  // springs on a strip that changes every knob drag was wasted work.
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={undo}
        disabled={history.length === 0}
        title={
          history.length === 0
            ? "Nothing to undo"
            : "Undo last tone / dynamics / space / tape tweak — not EQ bands"
        }
        className="btn-ghost text-xs disabled:opacity-40"
      >
        ⟲ Undo
      </button>
      <div className="flex items-center gap-[3px] px-2 py-2 rounded-xl glass min-w-[200px]">
        {past.length === 0 && next.length === 0 && (
          <span className="text-[10px] text-dim tracking-widest uppercase px-2">
            timeline empty — start tweaking
          </span>
        )}
        {past.map((_, i) => (
          <span key={`p${i}`} className="h-4 w-1 rounded-full bg-cyan/50 kc-hist-tick" />
        ))}
        <span className="h-5 w-[3px] rounded-full bg-plasma shadow-plasma mx-1" />
        {next.map((_, i) => (
          <span key={`f${i}`} className="h-4 w-1 rounded-full bg-violet/50 kc-hist-tick" />
        ))}
      </div>
      <button
        onClick={redo}
        disabled={future.length === 0}
        title={
          future.length === 0
            ? "Nothing to redo"
            : "Redo last tone / dynamics / space / tape tweak — not EQ bands"
        }
        className="btn-ghost text-xs disabled:opacity-40"
      >
        ⟳ Redo
      </button>
    </div>
  );
}
