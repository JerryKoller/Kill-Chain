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

const PX_PER_BAR = 56;
const RULER_H = 22;
const LANE_H = 56;
const TRACK_LABEL_W = 72;

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
  const activeName = nameOf(activeSectionId);
  const activeColor = colorOf(activeSectionId);
  const activeBars = sections.find((s) => s.id === activeSectionId)?.bars ?? 1;

  const commitRename = (id: string) => {
    renameSection(id, renameValue);
    setRenaming(null);
  };

  const arrangementEndStep = useMemo(
    () =>
      arrangement.reduce((m, c) => {
        const sec = sections.find((s) => s.id === c.patternId);
        return Math.max(m, c.startStep + (sec?.bars ?? 1) * STEPS_PER_BAR);
      }, 0),
    [arrangement, sections],
  );

  const totalSteps = useMemo(() => {
    const live = songTotalSteps(useFireSequencerStore.getState());
    const minBars = 16;
    const bars = Math.min(
      MAX_ARRANGEMENT_BARS,
      Math.max(minBars, Math.ceil(Math.max(live, arrangementEndStep) / STEPS_PER_BAR) + 4),
    );
    return bars * STEPS_PER_BAR;
  }, [arrangementEndStep, playing, playMode]);

  const totalBars = totalSteps / STEPS_PER_BAR;
  const trackW = totalBars * PX_PER_BAR;
  const lengthBars = Math.max(1, Math.ceil(arrangementEndStep / STEPS_PER_BAR));

  const barFromClientX = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - TRACK_LABEL_W;
    return Math.max(0, Math.min(totalBars - 1, Math.floor(x / PX_PER_BAR)));
  };

  const placeAtEnd = () => {
    if (arrangement.length >= MAX_CLIPS) {
      toast(`Max ${MAX_CLIPS} clips`);
      return;
    }
    const id = placeClip(activeSectionId, arrangementEndStep);
    if (id) {
      setSelectedClip(id);
      toast(`Added “${activeName}” at bar ${Math.floor(arrangementEndStep / STEPS_PER_BAR) + 1}`);
    }
  };

  const placeAtBar = (bar: number) => {
    if (arrangement.length >= MAX_CLIPS) {
      toast(`Max ${MAX_CLIPS} clips`);
      return;
    }
    const id = placeClip(activeSectionId, bar * STEPS_PER_BAR);
    if (id) {
      setSelectedClip(id);
      toast(`Added “${activeName}” at bar ${bar + 1}`);
    } else {
      toast("That bar is occupied — try another spot or Add to end");
    }
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
      if (!id) toast("That bar is occupied — try another spot or Add to end");
      else setSelectedClip(id);
    }
  };

  return (
    <div className="mb-2.5 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.045] to-white/[0.015] overflow-hidden">
      {/* ── Pattern bank ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
        <div className="shrink-0">
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/50">Patterns</div>
          <div className="text-[9px] text-white/30 leading-tight">select to edit · drag onto timeline</div>
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
                  className="w-24 rounded-lg border border-[#ff6a3d]/60 bg-black/40 px-2 py-1 text-xs text-white outline-none"
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
                  title={`Edit “${sec.name}” below · drag onto arrangement · double-click rename`}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                    style={{ background: color, opacity: active ? 1 : 0.55 }}
                  />
                  {sec.name}
                  <span className="ml-1.5 font-mono font-normal opacity-45 text-[10px]">{sec.bars}b</span>
                </button>
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSection(sec.id)}
                    className="h-8 px-1.5 rounded-r-lg text-[10px] border border-l-0 text-white/25 hover:text-rose-300 hover:bg-rose-500/10 transition"
                    style={active ? { borderColor: `${color}b0` } : { borderColor: "rgba(255,255,255,0.1)" }}
                    title={`Delete pattern “${sec.name}”`}
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
              else toast("Blank pattern ready — draw notes, then add it to the arrangement");
            }}
            disabled={sections.length >= MAX_SECTIONS}
            className="h-8 px-2.5 rounded-lg text-[11px] border border-dashed border-white/20 text-white/50 hover:text-[#ffbfa0] hover:border-[#ff6a3d]/50 disabled:opacity-30 transition"
            title="Create a blank pattern (does not place it on the timeline)"
          >＋ New</button>
          <button
            type="button"
            onClick={() => {
              const id = duplicateSection();
              if (!id) toast(`Max ${MAX_SECTIONS} patterns`);
            }}
            disabled={sections.length >= MAX_SECTIONS}
            className="h-8 px-2.5 rounded-lg text-[11px] border border-white/12 bg-white/[0.03] text-white/50 hover:text-white/80 disabled:opacity-30 transition"
            title="Copy the pattern you're editing"
          >Duplicate</button>
        </div>

        <div className="inline-flex rounded-lg border border-white/12 bg-black/30 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setPlayMode("pattern")}
            className="px-2.5 py-1.5 text-[10px] font-bold rounded-md transition"
            style={
              playMode === "pattern"
                ? { background: "rgba(255,106,61,0.22)", color: FIRE }
                : { color: "rgba(255,255,255,0.4)" }
            }
            title="Transport loops only the pattern open in the editor"
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
            title="Transport plays the timeline left-to-right, then loops"
          >
            Play arrangement
          </button>
        </div>
      </div>

      {/* ── Arrangement timeline ── */}
      <div className={playMode === "arrangement" ? "bg-[#ff6a3d]/[0.04]" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-[9px] font-black uppercase tracking-[0.18em] ${playMode === "arrangement" ? "text-[#ffbfa0]" : "text-white/45"}`}>
                Arrangement
              </span>
              <span className="text-[10px] font-mono text-white/35 tabular-nums">
                {arrangement.length} clip{arrangement.length === 1 ? "" : "s"}
                {arrangement.length > 0 ? ` · ${lengthBars} bar${lengthBars === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            <div className="text-[9px] text-white/30 mt-0.5">
              Drag a pattern chip onto the grid, click an empty bar, or add to the end
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedClip && (
              <button
                type="button"
                onClick={() => {
                  removeClip(selectedClip);
                  setSelectedClip(null);
                }}
                className="h-8 px-2.5 rounded-lg text-[10px] font-semibold border border-rose-400/30 text-rose-200/80 hover:bg-rose-500/15 transition"
              >
                Remove clip
              </button>
            )}
            <button
              type="button"
              onClick={placeAtEnd}
              className="h-8 inline-flex items-center gap-2 rounded-lg border px-2.5 text-[11px] font-semibold transition hover:brightness-110"
              style={{
                borderColor: `${activeColor}66`,
                background: `${activeColor}18`,
                color: activeColor,
              }}
              title={`Append a ${activeBars}-bar clip of “${activeName}” after the last clip`}
            >
              <span>＋ Add to end</span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-black/35 text-white/80 max-w-[6rem] truncate"
                title={activeName}
              >
                {activeName}
              </span>
            </button>
          </div>
        </div>

        <div className="flex min-h-0">
          {/* Fixed track header */}
          <div
            className="shrink-0 border-r border-white/[0.08] bg-black/35 flex flex-col"
            style={{ width: TRACK_LABEL_W }}
          >
            <div className="border-b border-white/[0.06]" style={{ height: RULER_H }} />
            <div
              className="flex flex-col justify-center px-2 gap-0.5"
              style={{ height: LANE_H }}
            >
              <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/45">Track</span>
              <span className="text-[10px] font-semibold text-white/70 truncate">Playlist</span>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="relative flex-1 overflow-x-auto overflow-y-hidden"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = e.dataTransfer.types.includes(CLIP_DND) ? "move" : "copy";
              setDropHoverBar(barFromClientX(e.clientX));
            }}
            onDragLeave={() => setDropHoverBar(null)}
            onDrop={onTimelineDrop}
          >
            <div className="relative" style={{ width: trackW, height: RULER_H + LANE_H }}>
              {/* Bar ruler */}
              <div
                className="absolute inset-x-0 top-0 border-b border-white/[0.08] bg-black/40"
                style={{ height: RULER_H }}
              >
                {Array.from({ length: totalBars }, (_, b) => (
                  <div
                    key={b}
                    className="absolute top-0 bottom-0 border-l"
                    style={{
                      left: b * PX_PER_BAR,
                      width: PX_PER_BAR,
                      borderColor: b % 4 === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
                    }}
                  >
                    <span className={`pl-1 text-[9px] font-mono leading-[22px] ${b % 4 === 0 ? "text-white/55 font-semibold" : "text-white/25"}`}>
                      {b + 1}
                    </span>
                  </div>
                ))}
              </div>

              {/* Lane */}
              <div
                className="absolute inset-x-0 bottom-0 bg-[#0a0c10]"
                style={{ top: RULER_H, height: LANE_H }}
              >
                {Array.from({ length: totalBars }, (_, b) => (
                  <button
                    key={b}
                    type="button"
                    className="absolute top-0 bottom-0 border-l transition hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.06]"
                    style={{
                      left: b * PX_PER_BAR,
                      width: PX_PER_BAR,
                      borderColor: b % 4 === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                      background: b % 4 === 0 ? "rgba(255,255,255,0.025)" : "transparent",
                    }}
                    title={`Place “${activeName}” at bar ${b + 1}`}
                    onClick={() => placeAtBar(b)}
                  />
                ))}

                {/* Beat subdivisions (visual only) */}
                {Array.from({ length: totalBars * 4 }, (_, i) => {
                  if (i % 4 === 0) return null;
                  return (
                    <div
                      key={`beat-${i}`}
                      className="absolute top-0 bottom-0 w-px pointer-events-none"
                      style={{
                        left: (i / 4) * PX_PER_BAR,
                        background: "rgba(255,255,255,0.03)",
                      }}
                    />
                  );
                })}

                {arrangement.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 px-4">
                    <div className="rounded-xl border border-dashed border-white/15 bg-black/50 px-4 py-2.5 text-center max-w-md">
                      <div className="text-[12px] font-semibold text-white/70">Empty arrangement</div>
                      <div className="text-[10px] text-white/40 mt-1 leading-relaxed">
                        Drag <span style={{ color: activeColor }} className="font-semibold">{activeName}</span> here,
                        click a bar, or use <span className="text-white/55">Add to end</span>
                      </div>
                    </div>
                  </div>
                )}

                {dropHoverBar !== null && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-20 rounded-sm"
                    style={{
                      left: dropHoverBar * PX_PER_BAR + 1,
                      width: Math.max(PX_PER_BAR * activeBars - 2, PX_PER_BAR - 2),
                      background: `${activeColor}33`,
                      border: `1px dashed ${activeColor}`,
                    }}
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
                    className="absolute top-0 bottom-0 w-0.5 bg-white z-30 pointer-events-none shadow-[0_0_10px_rgba(255,255,255,0.85)]"
                    style={{ left: (playheadStep / STEPS_PER_BAR) * PX_PER_BAR }}
                  />
                )}
              </div>
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
  const width = Math.max(PX_PER_BAR * 0.85, bars * PX_PER_BAR - 3);
  const startBar = Math.floor(clip.startStep / STEPS_PER_BAR) + 1;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CLIP_DND, clip.id);
        e.dataTransfer.effectAllowed = "move";
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`group absolute top-1.5 bottom-1.5 rounded-lg border cursor-grab active:cursor-grabbing select-none overflow-hidden transition z-[15] ${
        selected ? "ring-2 ring-white/55" : ""
      }`}
      style={{
        left: left + 2,
        width,
        borderColor: sounding || selected ? color : `${color}77`,
        background: `linear-gradient(165deg, ${color}${sounding ? "55" : "38"}, ${color}${sounding ? "28" : "16"})`,
        boxShadow: sounding
          ? `0 0 16px ${color}66, inset 0 1px 0 rgba(255,255,255,0.12)`
          : "inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
      title={`“${name}” · bars ${startBar}–${startBar + bars - 1} — click to edit · drag to move`}
    >
      <div className="h-full flex flex-col justify-center px-2.5 min-w-0 gap-0.5">
        <div
          className="text-[11px] font-bold truncate leading-tight"
          style={{ color: sounding ? "#fff" : color }}
        >
          {name}
        </div>
        <div className="text-[9px] font-mono text-white/45 truncate">
          {bars} bar{bars === 1 ? "" : "s"} · @{startBar}
        </div>
      </div>
      {bars > 1 && Array.from({ length: bars - 1 }, (_, b) => (
        <span
          key={b}
          className="absolute top-0 bottom-0 w-px opacity-30 pointer-events-none"
          style={{ left: `${((b + 1) / bars) * 100}%`, background: color }}
        />
      ))}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-5 h-5 text-[10px] rounded bg-black/70 text-white/70 hover:text-rose-300"
        title="Remove this clip from the arrangement"
      >✕</button>
    </div>
  );
}
