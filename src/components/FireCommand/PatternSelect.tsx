/**
 * Compact pattern switcher for Piano Roll / Drum Bay / editor toolbars.
 */

import { useFireSequencerStore } from "@/state/fireSequencerStore";

const COLORS = [
  "#ff6a3d", "#62b6ff", "#9be564", "#c98bff",
  "#ffd166", "#ff7bac", "#7ce8d5", "#ffb648",
];

export function PatternSelect({
  accent = "#ff6a3d",
}: {
  accent?: string;
}) {
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const setActiveSection = useFireSequencerStore((s) => s.setActiveSection);
  const idx = Math.max(0, sections.findIndex((s) => s.id === activeSectionId));
  const color = COLORS[idx % COLORS.length] ?? accent;
  const active = sections[idx];

  return (
    <label
      className="inline-flex items-center gap-1.5 h-8 rounded-lg border px-2 min-w-0 max-w-[12rem] focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[rgba(232,184,109,0.65)] cursor-pointer"
      style={{ borderColor: `${color}70`, background: `${color}14` }}
      title="Switch active pattern"
    >
      <span
        className="text-[10px] font-bold uppercase tracking-[0.08em] shrink-0"
        style={{ color, opacity: 0.85 }}
      >
        Pat
      </span>
      <select
        value={activeSectionId}
        onChange={(e) => setActiveSection(e.target.value)}
        className="min-w-0 flex-1 h-6 bg-transparent text-[11px] font-bold outline-none cursor-pointer truncate"
        style={{ color }}
        aria-label={`Active pattern: ${active?.name ?? "none"}`}
      >
        {sections.map((sec) => (
          <option key={sec.id} value={sec.id} className="bg-[#0c0c12] text-white">
            {sec.name} · {sec.bars}b
          </option>
        ))}
      </select>
    </label>
  );
}
