/**
 * ArrangementPlaylist — FL-style pattern bank + one-lane arrangement timeline.
 * Patterns are edited below; clips on the timeline drive arrangement playback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFireSequencerStore,
  getPlayingSectionId,
  getPlayingClipId,
  getArrangementPlayheadStep,
  songTotalSteps,
  MAX_SECTIONS,
  MAX_CLIPS,
  MAX_ARRANGEMENT_BARS,
  STEPS_PER_BAR,
  type ArrangementClip,
} from "@/state/fireSequencerStore";
import { useUIStore } from "@/state/uiStore";

const FIRE = "#ff6a3d";

export const PATTERN_COLORS = [
  "#ff6a3d", "#62b6ff", "#9be564", "#c98bff",
  "#ffd166", "#ff7bac", "#7ce8d5", "#ffb648",
  "#a78bfa", "#34d399", "#fb7185", "#38bdf8",
  "#fbbf24", "#c084fc", "#4ade80", "#f472b6",
];

/** Pixels per bar on the timeline. */
const PX_PER_BAR = 48;
const LANE_H = 44;

const PATTERN_DND = "application/x-fire-pattern";
const CLIP_DND = "application/x-fire-clip";

export function ArrangementPlaylist() {
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const arrangement = useFireSequencerStore((s) => s.arrangement);
  const playMode = useFireSequencerStore((s) => s.playMode);
  const playing = useFireSequencerStore((s) => s.playing);
  const setActiveSection = useFireSequencerStore((s) => s.setActiveSection);
  const addSection = useFireSequencerStore((s) => s.addSection);
  const duplicateSection = useFireSequencerStore((s) => s.duplicateSection);
  const renameSection = useFireSequencerStore((s) => s.renameSection);
  const removeSection = useFireSequencerStore((s) => s.removeSection);
  const placeClip = useFireSequencerStore((s) => s.placeClip);
  const removeClip = useFireSequencerStore((s) => s.removeClip);
  const moveClip = useFireSequencerStore((s) => s.moveClip);
  const setPlayMode = useFireSequencerStore((s) => s.setPlayMode);
  const toast = useUIStore((s) => s.toast);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [playingPattern, setPlayingPattern] = useState<string | null>(null);
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [playheadStep, setPlayheadStep] = useState(0);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [dropHoverBar, setDropHoverBar] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing || playMode !== "arrangement") {
      setPlayingPattern(null);
      setPlayingClip(null);
      setPlayheadStep(0);
      return;
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      setPlayingPattern((prev) => {
        const cur = getPlayingSectionId();
        return cur === prev ? prev : cur;
      });
      setPlayingClip((prev) => {
        const cur = getPlayingClipId();
        return cur === prev ? prev : cur;
      });
      setPlayheadStep(getArrangementPlayheadStep());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, playMode]);

  const colorOf = useCallback(
    (id: string) =>
      PATTERN_COLORS[Math.max(0, sections.findIndex((s) => s.id === id)) % PATTERN_COLORS.length],
    [sections],
  );

  const nameOf = (id: string) => sections.find((s) => s.id === id)?.name ?? "?";

  const commitRename = (id: string) => {
    renameSection(id, renameValue);
    setRenaming(null);
  };

  const totalSteps = useMemo(() => {
    const live = songTotalSteps(useFireSequencerStore.getState());
    const fromClips = arrangement.reduce((m, c) => {
      const sec = sections.find((s) => s.id === c.patternId);
      const len = (sec?.bars ?? 1) * STEPS_PER_BAR;
      return Math.max(m, c.startStep + len);
    }, 0);
    const minBars = 8;
    const bars = Math.min(
      MAX_ARRANGEMENT_BARS,
      Math.max(minBars, Math.ceil(Math.max(live, fromClips) / STEPS_PER_BAR) + 2),
    );
    return bars * STEPS_PER_BAR;
  }, [arrangement, sections, playing, playMode]);

  const totalBars = totalSteps / STEPS_PER_BAR;
  const trackW = totalBars * PX_PER_BAR;

  const barFromClientX = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    return Math.max(0, Math.min(totalBars - 1, Math.floor(x / PX_PER_BAR)));
  };

  const onTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHoverBar(null);
    const bar = barFromClientX(e.clientX);
    const startStep = bar * STEPS_PER_BAR;

    const clipMove = e.dataTransfer.getData(CLIP_DND);
    if (clipMove) {
      moveClip(clipMove, startStep);
      setSelectedClip(clipMove);
      return;
    }
    const patternId = e.dataTransfer.getData(PATTERN_DND);
    if (patternId) {
      if (arrangement.length >= MAX_CLIPS) {
        toast(`Max ${MAX_CLIPS} clips`);
        return;
      }
      const id = placeClip(patternId, startStep);
      if (!id) toast("No free slot there — tried end of arrangement");
      else setSelectedClip(id);
    }
  };

  return (
    <div className="mb-2.5 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.045] to-white/[0.015] px-3 py-2.5 space-y-2.5">
      {/* ── Pattern bank ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="shrink-0 min-w-[4.5rem]">
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/50">Patterns</div>
          <div className="text-[9px] text-white/30 leading-tight">edit · drag to timeline</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {sections.map((sec) => {
            const active = sec.id === activeSectionId;
            const sounding = playingPattern === sec.id;
            if (renaming === sec.id) {
              return (
                <input
                  key={sec.id}
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(sec.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(sec.id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-20 rounded-lg border border-[#ff6a3d]/60 bg-black/40 px-2 py-1 text-xs text-white outline-none"
                />
              );
            }
            const color = colorOf(sec.id);
            return (
              <span key={sec.id} className="group inline-flex items-center">
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PATTERN_DND, sec.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => setActiveSection(sec.id)}
                  onDoubleClick={() => { setRenaming(sec.id); setRenameValue(sec.name); }}
                  className={`h-8 px-2.5 rounded-l-lg ${sections.length > 1 ? "" : "rounded-r-lg"} text-[11px] font-bold border transition cursor-grab active:cursor-grabbing ${
                    active ? "" : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08]"
                  }`}
                  style={{
                    ...(active
                      ? { borderColor: `${color}b0`, background: `${color}22`, color }
                      : undefined),
                    ...(sounding ? { boxShadow: `0 0 12px ${color}80` } : undefined),
                  }}
                  title={`Edit "${sec.name}" · drag onto arrangement · double-click rename`}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                    style={{ background: color, opacity: active ? 1 : 0.55 }}
                  />
                  {sec.name}
                  <span className="ml-1 font-mono font-normal opacity-50">{sec.bars}</span>
                </button>
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSection(sec.id)}
                    className="h-8 px-1.5 rounded-r-lg text-[10px] border border-l-0 text-white/25 hover:text-rose-300 hover:bg-rose-500/10 transition"
                    style={active ? { borderColor: `${color}b0` } : { borderColor: "rgba(255,255,255,0.1)" }}
                    title={`Delete "${sec.name}"`}
                  >✕</button>
                )}
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const id = addSection();
              if (!id) toast(`Max ${MAX_SECTIONS} patterns`);
              else toast("Blank pattern — draw notes below, then drag to arrangement");
            }}
            disabled={sections.length >= MAX_SECTIONS}
            className="h-8 px-2.5 rounded-lg text-[11px] border border-dashed border-white/20 text-white/50 hover:text-[#ffbfa0] hover:border-[#ff6a3d]/50 disabled:opacity-30 transition"
            title="New blank pattern"
          >＋ New</button>
          <button
            type="button"
            onClick={() => {
              const id = duplicateSection();
              if (!id) toast(`Max ${MAX_SECTIONS} patterns`);
            }}
            disabled={sections.length >= MAX_SECTIONS}
            className="h-8 px-2.5 rounded-lg text-[11px] border border-white/12 bg-white/[0.03] text-white/50 hover:text-white/80 disabled:opacity-30 transition"
            title="Duplicate the pattern you're editing"
          >Duplicate</button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <span className="text-[9px] uppercase tracking-wider text-white/35 hidden sm:inline">Play</span>
          <div className="inline-flex rounded-lg border border-white/12 bg-black/30 p-0.5">
            <button
              type="button"
              onClick={() => setPlayMode("pattern")}
              className="px-2.5 py-1.5 text-[10px] font-bold rounded-md transition"
              style={
                playMode === "pattern"
                  ? { background: "rgba(255,106,61,0.22)", color: FIRE }
                  : { color: "rgba(255,255,255,0.4)" }
              }
              title="Loop only the pattern you're editing"
            >
              Loop pattern
            </button>
            <button
              type="button"
              onClick={() => setPlayMode("arrangement")}
              className="px-2.5 py-1.5 text-[10px] font-bold rounded-md transition"
              style={
                playMode === "arrangement"
                  ? { background: "rgba(255,106,61,0.22)", color: FIRE }
                  : { color: "rgba(255,255,255,0.4)" }
              }
              title="Play the arrangement timeline start-to-finish, then loop"
            >
              Play arrangement
            </button>
          </div>
        </div>
      </div>

      {/* ── Arrangement timeline ── */}
      <div
        className={`rounded-xl border overflow-hidden ${
          playMode === "arrangement"
            ? "border-[#ff6a3d]/35 bg-[#ff6a3d]/[0.05]"
            : "border-white/[0.07] bg-black/25"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-white/[0.06]">
          <div>
            <div className={`text-[9px] font-black uppercase tracking-[0.18em] ${playMode === "arrangement" ? "text-[#ffbfa0]" : "text-white/45"}`}>
              Arrangement
            </div>
            <div className="text-[9px] text-white/30">drop patterns · drag clips · gaps = silence</div>
          </div>
          <div className="flex items-center gap-2">
            {selectedClip && (
              <button
                type="button"
                onClick={() => {
                  removeClip(selectedClip);
                  setSelectedClip(null);
                }}
                className="h-7 px-2 rounded-md text-[10px] font-semibold border border-rose-400/30 text-rose-200/80 hover:bg-rose-500/15 transition"
              >
                Remove clip
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (arrangement.length >= MAX_CLIPS) {
                  toast(`Max ${MAX_CLIPS} clips`);
                  return;
                }
                const end = arrangement.reduce((m, c) => {
                  const sec = sections.find((s) => s.id === c.patternId);
                  return Math.max(m, c.startStep + (sec?.bars ?? 1) * STEPS_PER_BAR);
                }, 0);
                const id = placeClip(activeSectionId, end);
                if (id) setSelectedClip(id);
              }}
              className="h-7 px-2 rounded-md text-[10px] font-semibold border border-dashed border-white/20 text-white/55 hover:text-[#ffbfa0] hover:border-[#ff6a3d]/50 transition"
              title={`Place "${nameOf(activeSectionId)}" at the end`}
            >
              ＋ Place {nameOf(activeSectionId)}
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="relative overflow-x-auto overflow-y-hidden"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = e.dataTransfer.types.includes(CLIP_DND) ? "move" : "copy";
            setDropHoverBar(barFromClientX(e.clientX));
          }}
          onDragLeave={() => setDropHoverBar(null)}
          onDrop={onTimelineDrop}
        >
          <div className="relative" style={{ width: trackW, height: LANE_H + 18 }}>
            {/* Bar ruler */}
            <div className="absolute inset-x-0 top-0 h-[18px] border-b border-white/[0.06]">
              {Array.from({ length: totalBars }, (_, b) => (
                <div
                  key={b}
                  className="absolute top-0 bottom-0 border-l border-white/[0.08]"
                  style={{ left: b * PX_PER_BAR, width: PX_PER_BAR }}
                >
                  <span className="pl-1 text-[8px] font-mono text-white/30">{b + 1}</span>
                </div>
              ))}
            </div>

            {/* Lane */}
            <div
              className="absolute left-0 right-0 bottom-0"
              style={{ top: 18, height: LANE_H }}
            >
              {Array.from({ length: totalBars }, (_, b) => (
                <div
                  key={b}
                  className="absolute top-0 bottom-0 border-l border-white/[0.05]"
                  style={{
                    left: b * PX_PER_BAR,
                    width: PX_PER_BAR,
                    background: b % 4 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                  }}
                />
              ))}

              {dropHoverBar !== null && (
                <div
                  className="absolute top-1 bottom-1 w-0.5 bg-[#ffbfa0]/80 pointer-events-none z-20"
                  style={{ left: dropHoverBar * PX_PER_BAR }}
                />
              )}

              {arrangement.map((clip) => (
                <TimelineClip
                  key={clip.id}
                  clip={clip}
                  name={nameOf(clip.patternId)}
                  bars={sections.find((s) => s.id === clip.patternId)?.bars ?? 1}
                  color={colorOf(clip.patternId)}
                  sounding={playingClip === clip.id}
                  selected={selectedClip === clip.id}
                  onSelect={() => {
                    setSelectedClip(clip.id);
                    setActiveSection(clip.patternId);
                  }}
                  onRemove={() => {
                    removeClip(clip.id);
                    if (selectedClip === clip.id) setSelectedClip(null);
                  }}
                />
              ))}

              {playMode === "arrangement" && playing && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-30 pointer-events-none shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                  style={{ left: (playheadStep / STEPS_PER_BAR) * PX_PER_BAR }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineClip({
  clip,
  name,
  bars,
  color,
  sounding,
  selected,
  onSelect,
  onRemove,
}: {
  clip: ArrangementClip;
  name: string;
  bars: number;
  color: string;
  sounding: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const left = (clip.startStep / STEPS_PER_BAR) * PX_PER_BAR;
  const width = Math.max(PX_PER_BAR * 0.75, bars * PX_PER_BAR - 2);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CLIP_DND, clip.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`group absolute top-1 bottom-1 rounded-md border cursor-grab active:cursor-grabbing select-none overflow-hidden transition ${
        selected ? "ring-2 ring-white/50" : ""
      }`}
      style={{
        left: left + 1,
        width,
        borderColor: sounding || selected ? color : `${color}66`,
        background: `linear-gradient(180deg, ${color}${sounding ? "44" : "28"}, ${color}${sounding ? "28" : "14"})`,
        boxShadow: sounding ? `0 0 14px ${color}66` : undefined,
      }}
      title={`${name} · ${bars} bar${bars === 1 ? "" : "s"} — click to edit · drag to move`}
    >
      <div
        className="h-full flex items-center px-2 gap-1 text-[10px] font-bold truncate"
        style={{ color: sounding ? "#fff" : color }}
      >
        <span className="truncate">{name}</span>
        <span className="font-mono font-normal opacity-55">{bars}</span>
      </div>
      {bars > 1 && Array.from({ length: bars - 1 }, (_, b) => (
        <span
          key={b}
          className="absolute top-0 bottom-0 w-px opacity-25 pointer-events-none"
          style={{ left: `${((b + 1) / bars) * 100}%`, background: color }}
        />
      ))}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0 right-0 hidden group-hover:flex items-center justify-center w-4 h-4 text-[9px] rounded-bl bg-black/60 text-white/60 hover:text-rose-300"
        title="Remove clip"
      >✕</button>
    </div>
  );
}
