import { motion } from "framer-motion";
import { useAudioStore } from "@/state/audioStore";

export function HistoryStrip() {
  const history = useAudioStore((s) => s.history);
  const future = useAudioStore((s) => s.future);
  const undo = useAudioStore((s) => s.undo);
  const redo = useAudioStore((s) => s.redo);

  const past = history.slice(-12);
  const next = future.slice(0, 6);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={undo}
        disabled={history.length === 0}
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
          <motion.span
            layoutId={`hist-past-${i}`}
            key={`p${i}`}
            className="h-4 w-1 rounded-full bg-cyan/50"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
          />
        ))}
        <span className="h-5 w-[3px] rounded-full bg-plasma shadow-plasma mx-1" />
        {next.map((_, i) => (
          <motion.span
            layoutId={`hist-future-${i}`}
            key={`f${i}`}
            className="h-4 w-1 rounded-full bg-violet/50"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
          />
        ))}
      </div>
      <button
        onClick={redo}
        disabled={future.length === 0}
        className="btn-ghost text-xs disabled:opacity-40"
      >
        ⟳ Redo
      </button>
    </div>
  );
}
