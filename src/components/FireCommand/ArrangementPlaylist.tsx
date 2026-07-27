/**
 * ArrangementPlaylist — FL-style pattern bank + multi-lane arrangement timeline.
 * Patterns are edited below; clips on playlist tracks layer during arrangement play.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFireSequencerStore,
  getPlayingSectionId,
  getPlayingClipIds,
  getArrangementPlayheadStep,
  songTotalSteps,
  MAX_SECTIONS,
  MAX_CLIPS,
  MAX_ARRANGEMENT_BARS,
  MAX_PLAYLIST_TRACKS,
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

const PX_PER_BAR_MIN = 28;
const PX_PER_BAR_MAX = 96;
const PX_PER_BAR_DEFAULT = 56;
const RULER_H = 24;
const LANE_H = 36;
const TRACK_LABEL_W = 108;

const PATTERN_DND = "application/x-fire-pattern";
const CLIP_DND = "application/x-fire-clip";

export function ArrangementPlaylist() {
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const arrangement = useFireSequencerStore((s) => s.arrangement);
  const playlistTracks = useFireSequencerStore((s) => s.playlistTracks);
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
  const duplicateClip = useFireSequencerStore((s) => s.duplicateClip);
  const nudgeClip = useFireSequencerStore((s) => s.nudgeClip);
  const trimClip = useFireSequencerStore((s) => s.trimClip);
  const setClipColor = useFireSequencerStore((s) => s.setClipColor);
  const setPlaylistTrack = useFireSequencerStore((s) => s.setPlaylistTrack);
  const seekArrangement = useFireSequencerStore((s) => s.seekArrangement);
  const setPlayMode = useFireSequencerStore((s) => s.setPlayMode);
  const toast = useUIStore((s) => s.toast);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [playingPattern, setPlayingPattern] = useState<string | null>(null);
  const [playingClips, setPlayingClips] = useState<Set<string>>(() => new Set());
  const [playheadStep, setPlayheadStep] = useState(0);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState<{ bar: number; track: number } | null>(null);
  const [pxPerBar, setPxPerBar] = useState(PX_PER_BAR_DEFAULT);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (playMode !== "arrangement") {
      setPlayingPattern(null);
      setPlayingClips(new Set());
      setPlayheadStep(0);
      return;
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      setPlayheadStep((prev) => {
        const cur = getArrangementPlayheadStep();
        return Math.abs(cur - prev) < 0.01 ? prev : cur;
      });
      if (!playing) {
        setPlayingPattern(null);
        setPlayingClips(new Set());
        return;
      }
      setPlayingPattern((prev) => {
        const cur = getPlayingSectionId();
        return cur === prev ? prev : cur;
      });
      setPlayingClips((prev) => {
        const cur = getPlayingClipIds();
        if (cur.length === prev.size && cur.every((id) => prev.has(id))) return prev;
        return new Set(cur);
      });
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
  const selected = arrangement.find((c) => c.id === selectedClip) ?? null;

  const commitRename = (id: string) => {
    renameSection(id, renameValue);
    setRenaming(null);
  };

  const clipLenSteps = useCallback(
    (clip: ArrangementClip) => {
      const sec = sections.find((s) => s.id === clip.patternId);
      const full = (sec?.bars ?? 1) * STEPS_PER_BAR;
      if (clip.lengthSteps == null) return full;
      return Math.max(1, Math.min(full, Math.round(clip.lengthSteps)));
    },
    [sections],
  );

  const arrangementEndStep = useMemo(
    () =>
      arrangement.reduce((m, c) => Math.max(m, c.startStep + clipLenSteps(c)), 0),
    [arrangement, clipLenSteps],
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
  const trackW = totalBars * pxPerBar;
  const lengthBars = Math.max(1, Math.ceil(arrangementEndStep / STEPS_PER_BAR));
  const playlistH = MAX_PLAYLIST_TRACKS * LANE_H;

  const posFromClient = (clientX: number, clientY: number): { bar: number; track: number } => {
    const el = scrollRef.current;
    if (!el) return { bar: 0, track: 0 };
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop - RULER_H;
    const bar = Math.max(0, Math.min(totalBars - 1, Math.floor(x / pxPerBar)));
    const track = Math.max(0, Math.min(MAX_PLAYLIST_TRACKS - 1, Math.floor(y / LANE_H)));
    return { bar, track };
  };

  const placeAtEnd = () => {
    if (arrangement.length >= MAX_CLIPS) {
      toast(`Max ${MAX_CLIPS} clips`);
      return;
    }
    const id = placeClip(activeSectionId, arrangementEndStep, 0);
    if (id) {
      setSelectedClip(id);
      toast(`Added “${activeName}” at bar ${Math.floor(arrangementEndStep / STEPS_PER_BAR) + 1}`);
    }
  };

  const placeAt = (bar: number, track: number) => {
    if (arrangement.length >= MAX_CLIPS) {
      toast(`Max ${MAX_CLIPS} clips`);
      return;
    }
    const id = placeClip(activeSectionId, bar * STEPS_PER_BAR, track);
    if (id) {
      setSelectedClip(id);
      toast(`Added “${activeName}” · T${track + 1} · bar ${bar + 1}`);
    } else {
      toast("That spot is occupied on this track — try another lane or Add to end");
    }
  };

  const onTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(null);
    const { bar, track } = posFromClient(e.clientX, e.clientY);
    const startStep = bar * STEPS_PER_BAR;

    const clipMove = e.dataTransfer.getData(CLIP_DND);
    if (clipMove) {
      moveClip(clipMove, startStep, track);
      setSelectedClip(clipMove);
      return;
    }
    const patternId = e.dataTransfer.getData(PATTERN_DND);
    if (patternId) {
      if (arrangement.length >= MAX_CLIPS) {
        toast(`Max ${MAX_CLIPS} clips`);
        return;
      }
      const id = placeClip(patternId, startStep, track);
      if (!id) toast("That spot is occupied on this track");
      else setSelectedClip(id);
    }
  };

  const seekFromRuler = (clientX: number) => {
    const { bar } = posFromClient(clientX, 0);
    seekArrangement(bar * STEPS_PER_BAR);
    if (playMode !== "arrangement") setPlayMode("arrangement");
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
                {" · "}{MAX_PLAYLIST_TRACKS} tracks
              </span>
            </div>
            <div className="text-[9px] text-white/30 mt-0.5">
              Click ruler to scrub · drop onto any track · mute/solo per lane
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-1.5 h-8">
              <button
                type="button"
                className="w-6 h-6 text-[12px] text-white/50 hover:text-white"
                onClick={() => setPxPerBar((z) => Math.max(PX_PER_BAR_MIN, z - 8))}
                title="Zoom out"
              >−</button>
              <span className="text-[9px] font-mono text-white/40 w-8 text-center tabular-nums">{pxPerBar}</span>
              <button
                type="button"
                className="w-6 h-6 text-[12px] text-white/50 hover:text-white"
                onClick={() => setPxPerBar((z) => Math.min(PX_PER_BAR_MAX, z + 8))}
                title="Zoom in"
              >＋</button>
            </div>
            {selected && (
              <>
                <button
                  type="button"
                  onClick={() => nudgeClip(selected.id, -1)}
                  className="h-8 px-2 rounded-lg text-[10px] font-semibold border border-white/12 text-white/55 hover:bg-white/[0.06]"
                  title="Nudge left 1 bar"
                >←1</button>
                <button
                  type="button"
                  onClick={() => nudgeClip(selected.id, 1)}
                  className="h-8 px-2 rounded-lg text-[10px] font-semibold border border-white/12 text-white/55 hover:bg-white/[0.06]"
                  title="Nudge right 1 bar"
                >1→</button>
                <button
                  type="button"
                  onClick={() => {
                    const id = duplicateClip(selected.id);
                    if (!id) toast(`Max ${MAX_CLIPS} clips or no free space`);
                    else setSelectedClip(id);
                  }}
                  className="h-8 px-2.5 rounded-lg text-[10px] font-semibold border border-white/12 text-white/55 hover:bg-white/[0.06]"
                >Dup</button>
                <label className="h-8 inline-flex items-center gap-1 px-2 rounded-lg border border-white/12 text-[10px] text-white/50">
                  Color
                  <input
                    type="color"
                    value={selected.color
                      ?? playlistTracks[selected.track ?? 0]?.color
                      ?? colorOf(selected.patternId)}
                    onChange={(e) => setClipColor(selected.id, e.target.value)}
                    className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer"
                    title="Clip color"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    removeClip(selected.id);
                    setSelectedClip(null);
                  }}
                  className="h-8 px-2.5 rounded-lg text-[10px] font-semibold border border-rose-400/30 text-rose-200/80 hover:bg-rose-500/15 transition"
                >
                  Remove
                </button>
              </>
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
              title={`Append a ${activeBars}-bar clip of “${activeName}” on Track 1`}
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
          {/* Fixed track headers */}
          <div
            className="shrink-0 border-r border-white/[0.08] bg-black/35 flex flex-col"
            style={{ width: TRACK_LABEL_W }}
          >
            <div
              className="border-b border-white/[0.06] flex items-center px-2 text-[9px] font-black uppercase tracking-[0.14em] text-white/40"
              style={{ height: RULER_H }}
            >
              Tracks
            </div>
            {playlistTracks.map((tr, i) => (
              <div
                key={i}
                className="flex items-center gap-1 px-1.5 border-b border-white/[0.04]"
                style={{
                  height: LANE_H,
                  background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                  opacity: tr.mute && !tr.solo ? 0.45 : 1,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: tr.color }}
                />
                <span className="flex-1 min-w-0 text-[10px] font-semibold text-white/70 truncate" title={tr.name}>
                  {tr.name}
                </span>
                <button
                  type="button"
                  onClick={() => setPlaylistTrack(i, { mute: !tr.mute, solo: tr.mute ? tr.solo : false })}
                  className={`w-5 h-5 rounded text-[8px] font-black ${
                    tr.mute ? "bg-rose-500/30 text-rose-200" : "bg-white/[0.06] text-white/40 hover:text-white/70"
                  }`}
                  title={tr.mute ? "Unmute" : "Mute"}
                >M</button>
                <button
                  type="button"
                  onClick={() => setPlaylistTrack(i, { solo: !tr.solo, mute: tr.solo ? tr.mute : false })}
                  className={`w-5 h-5 rounded text-[8px] font-black ${
                    tr.solo ? "bg-amber-400/35 text-amber-100" : "bg-white/[0.06] text-white/40 hover:text-white/70"
                  }`}
                  title={tr.solo ? "Unsolo" : "Solo"}
                >S</button>
                <input
                  type="color"
                  value={tr.color}
                  onChange={(e) => setPlaylistTrack(i, { color: e.target.value })}
                  className="w-4 h-4 rounded border-0 bg-transparent cursor-pointer shrink-0"
                  title="Track color"
                />
              </div>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="relative flex-1 overflow-auto"
            style={{ maxHeight: RULER_H + playlistH }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = e.dataTransfer.types.includes(CLIP_DND) ? "move" : "copy";
              setDropHover(posFromClient(e.clientX, e.clientY));
            }}
            onDragLeave={() => setDropHover(null)}
            onDrop={onTimelineDrop}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              setPxPerBar((z) => clampZoom(z + (e.deltaY < 0 ? 6 : -6)));
            }}
          >
            <div className="relative" style={{ width: trackW, height: RULER_H + playlistH }}>
              {/* Bar ruler — click to scrub */}
              <div
                className="absolute inset-x-0 top-0 border-b border-white/[0.08] bg-black/40 cursor-ew-resize z-20"
                style={{ height: RULER_H }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  seekFromRuler(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (!(e.buttons & 1)) return;
                  seekFromRuler(e.clientX);
                }}
                title="Click / drag to scrub arrangement playhead"
              >
                {Array.from({ length: totalBars }, (_, b) => (
                  <div
                    key={b}
                    className="absolute top-0 bottom-0 border-l pointer-events-none"
                    style={{
                      left: b * pxPerBar,
                      width: pxPerBar,
                      borderColor: b % 4 === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
                    }}
                  >
                    <span className={`pl-1 text-[9px] font-mono leading-[24px] ${b % 4 === 0 ? "text-white/55 font-semibold" : "text-white/25"}`}>
                      {b + 1}
                    </span>
                  </div>
                ))}
              </div>

              {/* Lanes */}
              <div
                className="absolute inset-x-0 bottom-0 bg-[#0a0c10]"
                style={{ top: RULER_H, height: playlistH }}
              >
                {Array.from({ length: MAX_PLAYLIST_TRACKS }, (_, track) => (
                  <div
                    key={track}
                    className="absolute inset-x-0 border-b border-white/[0.04]"
                    style={{
                      top: track * LANE_H,
                      height: LANE_H,
                      background: track % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                    }}
                  >
                    {Array.from({ length: totalBars }, (_, b) => (
                      <button
                        key={b}
                        type="button"
                        className="absolute top-0 bottom-0 border-l transition hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.06]"
                        style={{
                          left: b * pxPerBar,
                          width: pxPerBar,
                          borderColor: b % 4 === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                          background: b % 4 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                        }}
                        title={`Place “${activeName}” · T${track + 1} · bar ${b + 1}`}
                        onClick={() => placeAt(b, track)}
                      />
                    ))}
                  </div>
                ))}

                {arrangement.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 px-4">
                    <div className="rounded-xl border border-dashed border-white/15 bg-black/50 px-4 py-2.5 text-center max-w-md">
                      <div className="text-[12px] font-semibold text-white/70">Empty arrangement</div>
                      <div className="text-[10px] text-white/40 mt-1 leading-relaxed">
                        Drop <span style={{ color: activeColor }} className="font-semibold">{activeName}</span> on any track,
                        click a cell, or use <span className="text-white/55">Add to end</span>
                      </div>
                    </div>
                  </div>
                )}

                {dropHover !== null && (
                  <div
                    className="absolute pointer-events-none z-20 rounded-sm"
                    style={{
                      left: dropHover.bar * pxPerBar + 1,
                      top: dropHover.track * LANE_H + 2,
                      width: Math.max(pxPerBar * activeBars - 2, pxPerBar - 2),
                      height: LANE_H - 4,
                      background: `${activeColor}33`,
                      border: `1px dashed ${activeColor}`,
                    }}
                  />
                )}

                {arrangement.map((clip) => {
                  const track = clampTrack(clip.track ?? 0);
                  const trColor = playlistTracks[track]?.color ?? colorOf(clip.patternId);
                  const color = clip.color ?? trColor;
                  const lenSteps = clipLenSteps(clip);
                  const bars = lenSteps / STEPS_PER_BAR;
                  return (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      name={nameOf(clip.patternId)}
                      bars={bars}
                      fullBars={sections.find((s) => s.id === clip.patternId)?.bars ?? 1}
                      color={color}
                      pxPerBar={pxPerBar}
                      sounding={playingClips.has(clip.id)}
                      selected={selectedClip === clip.id}
                      onSelect={() => {
                        setSelectedClip(clip.id);
                        setActiveSection(clip.patternId);
                      }}
                      onRemove={() => {
                        removeClip(clip.id);
                        if (selectedClip === clip.id) setSelectedClip(null);
                      }}
                      onTrim={(steps) => trimClip(clip.id, steps)}
                    />
                  );
                })}

                {playMode === "arrangement" && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white z-30 pointer-events-none shadow-[0_0_10px_rgba(255,255,255,0.85)]"
                    style={{ left: (playheadStep / STEPS_PER_BAR) * pxPerBar }}
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

function clampZoom(z: number): number {
  return Math.max(PX_PER_BAR_MIN, Math.min(PX_PER_BAR_MAX, Math.round(z)));
}

function clampTrack(t: number): number {
  return Math.max(0, Math.min(MAX_PLAYLIST_TRACKS - 1, Math.round(t)));
}

function TimelineClip({
  clip,
  name,
  bars,
  fullBars,
  color,
  pxPerBar,
  sounding,
  selected,
  onSelect,
  onRemove,
  onTrim,
}: {
  clip: ArrangementClip;
  name: string;
  bars: number;
  fullBars: number;
  color: string;
  pxPerBar: number;
  sounding: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onTrim: (lengthSteps: number) => void;
}) {
  const track = clampTrack(clip.track ?? 0);
  const left = (clip.startStep / STEPS_PER_BAR) * pxPerBar;
  const width = Math.max(pxPerBar * 0.55, bars * pxPerBar - 3);
  const startBar = Math.floor(clip.startStep / STEPS_PER_BAR) + 1;
  const top = track * LANE_H + 3;

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
      className={`group absolute rounded-md border cursor-grab active:cursor-grabbing select-none overflow-hidden transition z-[15] ${
        selected ? "ring-2 ring-white/55" : ""
      }`}
      style={{
        left: left + 2,
        top,
        width,
        height: LANE_H - 6,
        borderColor: sounding || selected ? color : `${color}77`,
        background: `linear-gradient(165deg, ${color}${sounding ? "55" : "38"}, ${color}${sounding ? "28" : "16"})`,
        boxShadow: sounding
          ? `0 0 12px ${color}66, inset 0 1px 0 rgba(255,255,255,0.12)`
          : "inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
      title={`“${name}” · T${track + 1} · bars ${startBar}–${startBar + Math.max(1, Math.ceil(bars)) - 1} — drag to move · edge to trim`}
    >
      <div className="h-full flex flex-col justify-center px-2 min-w-0 pr-4">
        <div
          className="text-[10px] font-bold truncate leading-tight"
          style={{ color: sounding ? "#fff" : color }}
        >
          {name}
        </div>
        <div className="text-[8px] font-mono text-white/45 truncate">
          {bars % 1 === 0 ? `${bars}b` : `${bars.toFixed(1)}b`} · @{startBar}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 text-[9px] rounded bg-black/70 text-white/70 hover:text-rose-300"
        title="Remove this clip"
      >✕</button>
      {/* Trim handle — right edge */}
      <div
        className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/25"
        title="Drag to trim length"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startLen = Math.round(bars * STEPS_PER_BAR);
          const maxLen = fullBars * STEPS_PER_BAR;
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            const dSteps = Math.round((dx / pxPerBar) * STEPS_PER_BAR);
            const next = Math.max(STEPS_PER_BAR, Math.min(maxLen, startLen + dSteps));
            // Snap trim to whole bars for stability
            const snapped = Math.max(STEPS_PER_BAR, Math.round(next / STEPS_PER_BAR) * STEPS_PER_BAR);
            onTrim(snapped);
          };
          const onUp = () => {
            el.releasePointerCapture(e.pointerId);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      />
    </div>
  );
}
