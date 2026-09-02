/**
 * Compact MIDI learn button for Fire Command performance controls.
 */

import { useMidiStore, type MidiTarget } from "@/state/midiStore";
import { FC_BAND } from "./fireColors";

export function PerfMidiLearnButton({
  target,
  label,
}: {
  target: MidiTarget;
  label?: string;
}) {
  const available = useMidiStore((s) => s.available);
  const learning = useMidiStore((s) => s.learning);
  const setLearning = useMidiStore((s) => s.setLearning);
  const mappings = useMidiStore((s) => s.mappings);
  const c = FC_BAND.perf;

  if (!available) return null;

  const learningThis =
    learning
    && learning.kind === target.kind
    && JSON.stringify(learning) === JSON.stringify(target);
  const mapped = mappings.filter((m) => JSON.stringify(m.target) === JSON.stringify(target));

  return (
    <button
      type="button"
      onClick={() => setLearning(learningThis ? null : target)}
      className="rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider transition"
      style={
        learningThis
          ? { borderColor: `${c}99`, background: `${c}40`, color: "#fff" }
          : mapped.length
            ? { borderColor: `${c}55`, background: `${c}18`, color: `${c}dd` }
            : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)" }
      }
      aria-pressed={!!learningThis}
      title={
        learningThis
          ? "Waiting for MIDI CC / note…"
          : mapped.length
            ? `Mapped: ${mapped.map((m) => m.label).join(", ")} — click to re-learn`
            : `MIDI learn${label ? ` · ${label}` : ""}`
      }
    >
      {learningThis ? "…" : mapped.length ? "MIDI" : "Learn"}
    </button>
  );
}
