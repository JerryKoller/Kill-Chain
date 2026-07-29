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
import { CollapseToggle } from "./CollapseToggle";
import { useFireCollapsed } from "./useFireCollapsed";
import { PatternBarsControls } from "./PatternBarsControls";
import { ScopedPlayButton } from "./ScopedPlayButton";
import { SeqSectionRow, SEQ_PILL, SEQ } from "./seqChrome";
import { ExitFullscreenButton } from "./EditorShell";

const FIRE = SEQ.fire;

export const PATTERN_COLORS = [
  "#ff6a3d", "#62b6ff", "#9be564", "#c98bff",
  "#ffd166", "#ff7bac", "#7ce8d5", "#ffb648",
  "#a78bfa", "#34d399", "#fb7185", "#38bdf8",
  "#fbbf24", "#c084fc", "#4ade80", "#f472b6",
];

const PX_PER_BAR_MIN = 24;
const PX_PER_BAR_MAX = 220;
const PX_PER_BAR_DEFAULT = 72;
const RULER_H = 24;
const LANE_H = 36;
const LANE_H_FS = 52;
const TRACK_LABEL_W = 168;

/** FL-style arrangement snap — same step units as the piano roll (16 = 1 bar). */
const ARR_SNAP_OPTIONS = [
  { label: "1", steps: 16 },
  { label: "1/2", steps: 8 },
  { label: "1/4", steps: 4 },
  { label: "1/8", steps: 2 },
  { label: "1/16", steps: 1 },
  { label: "1/32", steps: 0.5 },
  { label: "T", steps: 2 / 3 }, // triplet 1/8
  { label: "Off", steps: 0.25 },
  { label: "Auto", steps: -1 },
] as const;
const ARR_SNAP_STORAGE = "killchain.fire.arrSnap";

const PATTERN_DND = "application/x-fire-pattern";

function quantizeStep(raw: number, grid: number): number {
  const g = Math.max(0.25, grid);
  return Math.max(0, Math.round(raw / g) * g);
}

function resolveArrSnap(snap: number, pxPerBar: number): number {
  if (snap > 0) return snap;
  if (snap === -1) {
    // Adaptive: prefer finer grids once subdivisions are readable
    if (pxPerBar < 28) return 16;
    if (pxPerBar < 44) return 8;
    if (pxPerBar < 72) return 4;
    if (pxPerBar < 120) return 2;
    return 1;
  }
  return 0.25; // Off — finest
}

function readArrSnap(): number {
  try {
    const v = Number(window.localStorage.getItem(ARR_SNAP_STORAGE));
    if (ARR_SNAP_OPTIONS.some((o) => o.steps === v)) return v;
  } catch { /* ignore */ }
  return 4; // default quarter-bar — matches visible beat grid
}

/** Soft magnetic snap: hard-locks near grid lines, gentle pull farther away. */
function magneticSnap(raw: number, grid: number): number {
  const g = Math.max(0.25, grid);
  const nearest = Math.round(raw / g) * g;
  const dist = Math.abs(raw - nearest);
  const half = g * 0.5;
  if (half <= 0) return Math.max(0, nearest);
  if (dist <= half * 0.4) return Math.max(0, nearest);
  // Ease toward the grid so scrubbing still feels continuous between lines
  const t = 1 - dist / half;
  const pull = 0.25 + 0.55 * t * t;
  return Math.max(0, raw + (nearest - raw) * pull);
}

export function ArrangementPlaylist({ flush = false }: { flush?: boolean } = {}) {
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const arrangement = useFireSequencerStore((s) => s.arrangement);
  const playlistTracks = useFireSequencerStore((s) => s.playlistTracks);
  const playMode = useFireSequencerStore((s) => s.playMode);
  const playScope = useFireSequencerStore((s) => s.playScope);
  const playing = useFireSequencerStore((s) => s.playing);
  const setActiveSection = useFireSequencerStore((s) => s.setActiveSection);
  const setPlayScope = useFireSequencerStore((s) => s.setPlayScope);
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
  const makeClipUnique = useFireSequencerStore((s) => s.makeClipUnique);
  const editClipSource = useFireSequencerStore((s) => s.editClipSource);
  const commitClipVariation = useFireSequencerStore((s) => s.commitClipVariation);
  const selectClipForEdit = useFireSequencerStore((s) => s.selectClipForEdit);
  const clearSelectedClip = useFireSequencerStore((s) => s.clearSelectedClip);
  const storeSelectedClipId = useFireSequencerStore((s) => s.selectedClipId);
  const trackHeaderWidth = useFireSequencerStore((s) => s.trackHeaderWidth);
  const setTrackHeaderWidth = useFireSequencerStore((s) => s.setTrackHeaderWidth);
  const toast = useUIStore((s) => s.toast);
  const [patternsCollapsed, togglePatterns] = useFireCollapsed("seq.patterns", false);
  const [arrCollapsed, toggleArr] = useFireCollapsed("seq.arrangement", false);
  const [arrFullscreen, setArrFullscreen] = useState(false);
  /** Session-only: patterns dock starts collapsed in fullscreen so the timeline dominates. */
  const [fsPatternsCollapsed, setFsPatternsCollapsed] = useState(true);

  useEffect(() => {
    if (!arrFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArrFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arrFullscreen]);

  useEffect(() => {
    if (arrFullscreen) setFsPatternsCollapsed(true);
  }, [arrFullscreen]);

  const patternsDockCollapsed = arrFullscreen ? fsPatternsCollapsed : patternsCollapsed;
  const togglePatternsDock = () => {
    if (arrFullscreen) setFsPatternsCollapsed((v) => !v);
    else togglePatterns();
  };

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingTrack, setRenamingTrack] = useState<number | null>(null);
  const [trackRenameValue, setTrackRenameValue] = useState("");
  const [playingPattern, setPlayingPattern] = useState<string | null>(null);
  const [playingClips, setPlayingClips] = useState<Set<string>>(() => new Set());
  const [playheadStep, setPlayheadStep] = useState(0);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [clipMenu, setClipMenu] = useState<string | null>(null);
  const [appendOpen, setAppendOpen] = useState(false);
  const [dropHover, setDropHover] = useState<{ step: number; track: number; bars: number } | null>(null);
  const [pxPerBar, setPxPerBar] = useState(PX_PER_BAR_DEFAULT);
  const [snapSteps, setSnapStepsState] = useState(readArrSnap);
  const [clipGhost, setClipGhost] = useState<{
    id: string; step: number; track: number; bars: number; color: string;
  } | null>(null);
  const dragClipRef = useRef<{
    id: string; bars: number; color: string; pointerId: number;
  } | null>(null);
  // Active window-listener detach for a clip drag — run on unmount so a drag
  // in flight when the panel closes can't leave listeners behind.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const scrubbingRef = useRef(false);
  const scrubCleanupRef = useRef<(() => void) | null>(null);
  const lastSoftSeekRef = useRef(0);

  useEffect(() => () => {
    dragCleanupRef.current?.();
    scrubCleanupRef.current?.();
  }, []);

  // Keep timeline highlight in sync when store clears/changes selection (section switch, undo…).
  useEffect(() => {
    setSelectedClip((prev) => (storeSelectedClipId !== prev ? storeSelectedClipId : prev));
  }, [storeSelectedClipId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const totalBarsRef = useRef(1);
  const snapRef = useRef(snapSteps);
  snapRef.current = snapSteps;
  const effectiveSnap = resolveArrSnap(snapSteps, pxPerBar);
  const effectiveSnapRef = useRef(effectiveSnap);
  effectiveSnapRef.current = effectiveSnap;

  const setSnap = useCallback((steps: number) => {
    setSnapStepsState(steps);
    try { window.localStorage.setItem(ARR_SNAP_STORAGE, String(steps)); } catch { /* ignore */ }
  }, []);

  const fitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w < 48) return;
    const bars = Math.max(1, totalBarsRef.current);
    setPxPerBar(clampZoom(w / bars));
  }, []);

  useEffect(() => {
    if (playMode !== "arrangement") {
      setPlayingPattern(null);
      setPlayingClips(new Set());
      setPlayheadStep(0);
      return;
    }
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      // While scrubbing, the pointer handler owns the playhead — don't fight it.
      if (scrubbingRef.current) return;
      // Stopped: only track the cue marker, and only at ~12 Hz — a 60 fps loop
      // over an idle timeline is pure waste.
      if (!playing && t - last < 80) return;
      last = t;
      setPlayheadStep((prev) => {
        const cur = getArrangementPlayheadStep();
        return Math.abs(cur - prev) < 0.01 ? prev : cur;
      });
      if (!playing) {
        setPlayingPattern((prev) => (prev === null ? prev : null));
        setPlayingClips((prev) => (prev.size === 0 ? prev : new Set()));
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
      const fullBars = clip.unique
        ? (clip.local?.bars ?? sec?.bars ?? 1)
        : (sec?.bars ?? 1);
      const full = fullBars * STEPS_PER_BAR;
      if (clip.lengthSteps == null) return full;
      return Math.max(1, Math.min(full, Math.round(clip.lengthSteps * 2) / 2));
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
  totalBarsRef.current = totalBars;
  const trackW = Math.max(totalBars * pxPerBar, 1);
  const lengthBars = Math.max(1, Math.ceil(arrangementEndStep / STEPS_PER_BAR));
  const laneH = arrFullscreen ? LANE_H_FS : LANE_H;
  const playlistH = MAX_PLAYLIST_TRACKS * laneH;

  useEffect(() => {
    if (arrCollapsed) return;
    const id = requestAnimationFrame(() => fitZoom());
    return () => cancelAnimationFrame(id);
  }, [fitZoom, arrCollapsed]);

  /** Raw (unquantized) step under pointer — used for drag grab offset. */
  const rawStepFromClient = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    return Math.max(0, (x / pxPerBar) * STEPS_PER_BAR);
  };

  const posFromClient = (clientX: number, clientY: number): { step: number; track: number } => {
    const el = scrollRef.current;
    if (!el) return { step: 0, track: 0 };
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop - RULER_H;
    const rawStep = (x / pxPerBar) * STEPS_PER_BAR;
    const step = Math.max(0, Math.min(Math.max(0, totalSteps - effectiveSnapRef.current), quantizeStep(rawStep, effectiveSnapRef.current)));
    const track = Math.max(0, Math.min(MAX_PLAYLIST_TRACKS - 1, Math.floor(y / laneH)));
    return { step, track };
  };

  // New clips land on the armed lane (fallback: Track 1).
  const armedTrack = Math.max(0, playlistTracks.findIndex((t) => t.arm));

  const placeAtEnd = (times = 1) => {
    if (arrangement.length + times > MAX_CLIPS) {
      toast(`Max ${MAX_CLIPS} clips`);
      return;
    }
    let start = arrangementEndStep;
    let lastId: string | null = null;
    let placed = 0;
    for (let i = 0; i < times; i++) {
      const id = placeClip(activeSectionId, start, armedTrack);
      if (!id) break;
      lastId = id;
      placed++;
      start += activeBars * STEPS_PER_BAR;
    }
    if (lastId) {
      setSelectedClip(lastId);
      selectClipForEdit(lastId);
      toast(
        placed < times
          ? `APPEND PATTERN ${activeName} ×${placed}/${times} (blocked) · ends ~${Math.ceil(start / STEPS_PER_BAR)} bars`
          : `APPEND PATTERN ${activeName} ×${times} · ends ~${Math.ceil(start / STEPS_PER_BAR)} bars`,
      );
    } else {
      toast("Can't append — track occupied or max clips");
    }
  };

  const placeAt = (step: number, track: number, force = false) => {
    if (!force && selectedClip) {
      setSelectedClip(null);
      clearSelectedClip();
      return;
    }
    if (arrangement.length >= MAX_CLIPS) {
      toast(`Max ${MAX_CLIPS} clips`);
      return;
    }
    const snapped = quantizeStep(step, effectiveSnapRef.current);
    const id = placeClip(activeSectionId, snapped, track);
    if (id) {
      setSelectedClip(id);
      selectClipForEdit(id);
      toast(`Added “${activeName}” · T${track + 1} · bar ${Math.floor(snapped / STEPS_PER_BAR) + 1}`);
    } else {
      toast("That spot is occupied on this track — try another lane or Add to end");
    }
  };

  const onTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(null);
    const { step, track } = posFromClient(e.clientX, e.clientY);
    const patternId = e.dataTransfer.getData(PATTERN_DND);
    if (patternId) {
      if (arrangement.length >= MAX_CLIPS) {
        toast(`Max ${MAX_CLIPS} clips`);
        return;
      }
      const id = placeClip(patternId, step, track);
      if (!id) toast("That spot is occupied on this track");
      else {
        setSelectedClip(id);
        selectClipForEdit(id);
      }
    }
  };

  const beginClipDrag = (
    e: React.PointerEvent,
    clip: ArrangementClip,
    color: string,
    bars: number,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    // Preserve grab point inside the clip so the left edge doesn't jump to the cursor.
    const grabOffsetSteps = rawStepFromClient(e.clientX) - clip.startStep;
    let dragging = false;
    dragClipRef.current = { id: clip.id, bars, color, pointerId };
    setSelectedClip(clip.id);
    selectClipForEdit(clip.id);

    const ghostPos = (clientX: number, clientY: number) => {
      const trackPos = posFromClient(clientX, clientY);
      const unsnapped = rawStepFromClient(clientX) - grabOffsetSteps;
      const step = Math.max(
        0,
        Math.min(
          Math.max(0, totalSteps - effectiveSnapRef.current),
          quantizeStep(unsnapped, effectiveSnapRef.current),
        ),
      );
      return { step, track: trackPos.track };
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
      }
      const pos = ghostPos(ev.clientX, ev.clientY);
      setClipGhost({ id: clip.id, step: pos.step, track: pos.track, bars, color });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detach();
      dragClipRef.current = null;
      setClipGhost(null);
      if (!dragging) return;
      const pos = ghostPos(ev.clientX, ev.clientY);
      if (!moveClip(clip.id, pos.step, pos.track)) {
        toast("Can't place there — track occupied");
      }
    };
    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (dragCleanupRef.current === detach) dragCleanupRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    dragCleanupRef.current = detach;
  };

  // Keyboard: Del / arrows nudge selected clip.
  useEffect(() => {
    if (!selectedClip) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      const grid = Math.max(0.25, effectiveSnapRef.current);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeClip(selectedClip);
        setSelectedClip(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!nudgeClip(selectedClip, -(e.shiftKey ? grid * 4 : grid))) {
          toast("Can't nudge — track occupied");
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!nudgeClip(selectedClip, e.shiftKey ? grid * 4 : grid)) {
          toast("Can't nudge — track occupied");
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const clip = useFireSequencerStore.getState().arrangement.find((c) => c.id === selectedClip);
        if (clip && !moveClip(clip.id, clip.startStep, Math.max(0, (clip.track ?? 0) - 1))) {
          toast("Can't move — track occupied");
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const clip = useFireSequencerStore.getState().arrangement.find((c) => c.id === selectedClip);
        if (clip && !moveClip(clip.id, clip.startStep, Math.min(MAX_PLAYLIST_TRACKS - 1, (clip.track ?? 0) + 1))) {
          toast("Can't move — track occupied");
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        const id = duplicateClip(selectedClip);
        if (id) {
          setSelectedClip(id);
          selectClipForEdit(id);
        } else toast(`Max ${MAX_CLIPS} clips or no free space`);
      } else if (e.key === "Escape") {
        setSelectedClip(null);
        clearSelectedClip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClip, removeClip, nudgeClip, moveClip, duplicateClip, selectClipForEdit, clearSelectedClip, toast]);

  const seekFromRuler = (clientX: number, soft: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const rawStep = Math.max(0, (x / pxPerBar) * STEPS_PER_BAR);
    const grid = effectiveSnapRef.current;
    // Soft magnetic while dragging; hard quantize on release / click.
    const step = soft
      ? Math.min(Math.max(0, totalSteps - 1), magneticSnap(rawStep, grid))
      : Math.min(Math.max(0, totalSteps - 1), quantizeStep(rawStep, grid));
    // Paint immediately — don't wait for the idle RAF cue poll.
    setPlayheadStep(step);
    if (playMode !== "arrangement") setPlayScope("arrangement");
    if (soft) {
      if (playing) {
        const now = performance.now();
        // Visual already updated; throttle live re-anchors to ~60 Hz.
        if (now - lastSoftSeekRef.current < 16) return;
        lastSoftSeekRef.current = now;
      }
      seekArrangement(step, { soft: true });
    } else {
      seekArrangement(step);
    }
  };

  const beginRulerScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    scrubbingRef.current = true;
    seekFromRuler(e.clientX, false);
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      seekFromRuler(ev.clientX, true);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detach();
      seekFromRuler(ev.clientX, false);
      scrubbingRef.current = false;
    };
    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (scrubCleanupRef.current === detach) scrubCleanupRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    scrubCleanupRef.current = detach;
  };

  return (
    <div
      className={
        arrFullscreen
          ? "fixed left-0 right-0 bottom-0 top-9 z-[90] flex flex-col bg-[#06070b] p-2.5 gap-2 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
          : flush
            ? "overflow-hidden bg-gradient-to-b from-cyan-400/[0.04] via-white/[0.02] to-transparent"
            : "mb-2.5 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.045] to-white/[0.015] overflow-hidden"
      }
    >
      {arrFullscreen && (
        <header className="editor-fs-header shrink-0 flex flex-wrap items-center gap-2 px-1 min-h-9">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ExitFullscreenButton onClick={() => setArrFullscreen(false)} />
            <ScopedPlayButton
              scope="arrangement"
              title="Play / pause arrangement only"
            />
            <div className="min-w-0 leading-tight">
              <div className="text-[12px] font-black uppercase tracking-[0.1em] text-white/80 truncate">
                Arrangement
              </div>
              <div className="text-[10px] text-white/50 truncate mt-0.5">
                {arrangement.length} clip{arrangement.length === 1 ? "" : "s"}
                {arrangement.length > 0 ? ` · ${lengthBars} bar${lengthBars === 1 ? "" : "s"}` : ""}
                {" · "}{MAX_PLAYLIST_TRACKS} tracks
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 ml-auto">
            <PatternBarsControls accent={FIRE} />
          </div>
        </header>
      )}
      {/* ── Pattern bank (collapsible dock in fullscreen) ── */}
      <div
        className={`border-b border-white/[0.07] shrink-0 arr-patterns-dock ${
          arrFullscreen ? "rounded-xl border border-white/10 bg-[#0a0c12]" : ""
        }`}
        data-expanded={arrFullscreen && !patternsDockCollapsed ? "1" : "0"}
      >
        <SeqSectionRow
          collapsed={patternsDockCollapsed}
          onToggle={togglePatternsDock}
          title="Patterns"
          meta={
            patternsDockCollapsed
              ? `${sections.length} pattern${sections.length === 1 ? "" : "s"} · ${sections.find((s) => s.id === activeSectionId)?.name ?? "—"}`
              : "select to edit · drag onto timeline"
          }
          collapseControl={
            <CollapseToggle
              collapsed={patternsDockCollapsed}
              color={FIRE}
              title={patternsDockCollapsed ? "Expand patterns" : "Collapse patterns"}
            />
          }
          play={
            <ScopedPlayButton
              scope="pattern"
              title="Play / pause active pattern only"
            />
          }
        />
        {!patternsDockCollapsed && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
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
                  className="w-24 h-8 rounded-lg border border-[#ff6a3d]/60 bg-black/40 px-2 text-xs text-white outline-none"
                />
              );
            }
            const color = colorOf(sec.id);
            return (
              <span key={sec.id} className="group inline-flex items-center h-8">
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PATTERN_DND, sec.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => setActiveSection(sec.id)}
                  onDoubleClick={() => { setRenaming(sec.id); setRenameValue(sec.name); }}
                  className={`h-8 px-2.5 rounded-l-lg text-[11px] font-bold border transition cursor-grab active:cursor-grabbing ${
                    active ? "" : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08]"
                  }`}
                  style={{
                    ...(active
                      ? { borderColor: `${color}b0`, background: `${color}22`, color }
                      : undefined),
                    ...(sounding ? { boxShadow: `0 0 12px ${color}80` } : undefined),
                  }}
                  title={`PATTERN ${sec.name} — edit below · drag onto arrangement · double-click to rename`}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                    style={{ background: color, opacity: active ? 1 : 0.55 }}
                  />
                  {sec.name}
                  <span className="ml-1.5 font-mono font-normal opacity-45 text-[10px]">{sec.bars}b</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setRenaming(sec.id); setRenameValue(sec.name); }}
                  className="h-8 px-1.5 text-[10px] border border-l-0 text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition"
                  style={active ? { borderColor: `${color}b0` } : { borderColor: "rgba(255,255,255,0.1)" }}
                  title={`Rename “${sec.name}”`}
                >✎</button>
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
            className={`${SEQ_PILL} border-dashed disabled:opacity-30`}
            title="Create a blank pattern (does not place it on the timeline)"
          >＋ New</button>
          <button
            type="button"
            onClick={() => {
              const id = addSection();
              if (!id) {
                toast(`Max ${MAX_SECTIONS} patterns`);
                return;
              }
              const clipId = placeClip(id, arrangementEndStep, 0);
              if (clipId) setSelectedClip(clipId);
              toast(clipId
                ? "New pattern created and added to the arrangement"
                : "Blank pattern ready — timeline was full on Track 1");
            }}
            disabled={sections.length >= MAX_SECTIONS || arrangement.length >= MAX_CLIPS}
            className="inline-flex h-8 items-center px-2.5 rounded-lg text-[10px] font-semibold border border-[#ff6a3d]/40 bg-[#ff6a3d]/10 text-[#ffbfa0] hover:bg-[#ff6a3d]/18 disabled:opacity-30 transition"
            title="Create a blank pattern and place it at the end of the arrangement"
          >＋ New + place</button>
          <button
            type="button"
            onClick={() => {
              const id = duplicateSection();
              if (!id) toast(`Max ${MAX_SECTIONS} patterns`);
            }}
            disabled={sections.length >= MAX_SECTIONS}
            className={`${SEQ_PILL} disabled:opacity-30`}
            title="Duplicate the pattern you're editing (bank only — not a timeline clip)"
          >Duplicate</button>
        </div>
        )}
      </div>

      {/* ── Arrangement timeline ── */}
      <div
        className={
          arrFullscreen
            ? "flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#080a10]"
            : playMode === "arrangement" ? "bg-[#ff6a3d]/[0.04]" : ""
        }
      >
        <div className={`border-b border-white/[0.07] shrink-0 ${arrFullscreen ? "bg-[#0a0c12]" : ""}`}>
          <SeqSectionRow
            collapsed={arrCollapsed}
            onToggle={toggleArr}
            title="Arrangement"
            meta={
              <>
                <span className="font-mono tabular-nums">
                  {arrangement.length} clip{arrangement.length === 1 ? "" : "s"}
                  {arrangement.length > 0 ? ` · ${lengthBars} bar${lengthBars === 1 ? "" : "s"}` : ""}
                  {" · "}{MAX_PLAYLIST_TRACKS} tracks
                </span>
                {!arrCollapsed ? (
                  <span className="block mt-0.5 text-white/45">
                    Click empty · RMB delete · Del / ←→
                  </span>
                ) : null}
              </>
            }
            collapseControl={<CollapseToggle collapsed={arrCollapsed} color={FIRE} />}
            play={
              <ScopedPlayButton
                scope="arrangement"
                title="Play / pause arrangement only"
              />
            }
            tools={
              !arrCollapsed ? (
              <>
            {!arrFullscreen && <PatternBarsControls accent={FIRE} />}
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/12 bg-black/25 p-0.5 h-8">
              <span className="px-1.5 text-[10px] uppercase tracking-[0.08em] text-white/50">
                Snap {ARR_SNAP_OPTIONS.find((o) => o.steps === snapSteps)?.label ?? "?"}
                {snapSteps === -1 ? `→${effectiveSnap === 16 ? "1" : effectiveSnap === 8 ? "1/2" : effectiveSnap === 4 ? "1/4" : effectiveSnap === 2 ? "1/8" : "1/16"}` : ""}
              </span>
              {ARR_SNAP_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setSnap(opt.steps)}
                  className="min-w-[26px] h-7 px-1 rounded-md text-[10px] font-mono transition"
                  style={
                    snapSteps === opt.steps
                      ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0", fontWeight: 700 }
                      : { color: "rgba(255,255,255,0.45)" }
                  }
                  title={`ARRANGE SNAP: ${opt.label === "T" ? "TRIPLET 1/8" : opt.label === "Off" ? "OFF" : opt.label === "Auto" ? "ADAPTIVE" : `${opt.label} BAR`}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-black/25 px-1.5 h-8">
              <button
                type="button"
                className="w-6 h-6 text-[12px] text-white/55 hover:text-white"
                onClick={() => setPxPerBar((z) => clampZoom(z / 1.2))}
                title="Zoom out"
                aria-label="Zoom out"
              >−</button>
              <span className="text-[10px] font-mono text-white/50 w-8 text-center tabular-nums">{Math.round(pxPerBar)}</span>
              <button
                type="button"
                className="w-6 h-6 text-[12px] text-white/55 hover:text-white"
                onClick={() => setPxPerBar((z) => clampZoom(z * 1.2))}
                title="Zoom in"
                aria-label="Zoom in"
              >＋</button>
              <button
                type="button"
                className="h-6 px-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-[#ffbfa0] border-l border-white/10 ml-0.5 pl-1.5"
                onClick={fitZoom}
                title="Fit timeline to module width"
              >Fit</button>
            </div>
            {selected && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!nudgeClip(selected.id, -Math.max(0.25, effectiveSnap))) {
                      toast("Can't nudge — track occupied");
                    }
                  }}
                  className={SEQ_PILL}
                  title="Nudge left by arrange snap"
                >←</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!nudgeClip(selected.id, Math.max(0.25, effectiveSnap))) {
                      toast("Can't nudge — track occupied");
                    }
                  }}
                  className={SEQ_PILL}
                  title="Nudge right by arrange snap"
                >→</button>
                <button
                  type="button"
                  onClick={() => {
                    const id = duplicateClip(selected.id);
                    if (!id) toast(`Max ${MAX_CLIPS} clips or no free space`);
                    else {
                      setSelectedClip(id);
                      selectClipForEdit(id);
                    }
                  }}
                  className={SEQ_PILL}
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
                  className="inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold border border-rose-400/30 text-rose-200/80 hover:bg-rose-500/15 transition shrink-0"
                >
                  Remove
                </button>
              </>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => placeAtEnd(1)}
                onContextMenu={(e) => { e.preventDefault(); setAppendOpen((v) => !v); }}
                className="h-8 inline-flex items-center gap-2 rounded-lg border px-2.5 text-[11px] font-semibold transition hover:brightness-110"
                style={{
                  borderColor: `${activeColor}66`,
                  background: `${activeColor}18`,
                  color: activeColor,
                }}
                title={`APPEND PATTERN ${activeName} — right-click for ×4 / after selection`}
              >
                <span>＋ APPEND {activeName}</span>
                <span className="rounded px-1.5 py-0.5 text-[9px] font-mono bg-black/35 text-white/70">
                  {activeBars}b
                </span>
              </button>
              {appendOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-lg border border-white/15 bg-[#0c0c12]/98 py-1 shadow-xl">
                  {[
                    { label: "Append once", run: () => placeAtEnd(1) },
                    { label: "Append ×4", run: () => placeAtEnd(4) },
                    {
                      label: "Append after selection",
                      run: () => {
                        const clip = arrangement.find((c) => c.id === selectedClip);
                        if (!clip) { placeAtEnd(1); return; }
                        const len = clipLenSteps(clip);
                        const id = placeClip(activeSectionId, clip.startStep + len, clip.track);
                        if (id) { setSelectedClip(id); selectClipForEdit(id); toast("Appended after selection"); }
                        else toast("That spot is occupied on this track");
                      },
                    },
                  ].map((it) => (
                    <button
                      key={it.label}
                      type="button"
                      className="block w-full px-2.5 py-1.5 text-left text-[10px] text-white/70 hover:bg-white/10"
                      onClick={() => { it.run(); setAppendOpen(false); }}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!arrFullscreen && (
              <button
                type="button"
                onClick={() => setArrFullscreen(true)}
                className={SEQ_PILL}
                title="Fullscreen arrangement"
              >
                Fullscreen
              </button>
            )}
              </>
              ) : undefined
            }
          />
        </div>

        {!arrCollapsed && (
        <div className={`flex min-h-0 ${arrFullscreen ? "flex-1 overflow-hidden" : ""}`}>
          {/* Fixed track headers */}
          <div
            className="shrink-0 border-r border-white/[0.08] bg-black/35 flex flex-col"
            style={{ width: trackHeaderWidth || TRACK_LABEL_W }}
          >
            <div
              className="border-b border-white/[0.06] flex items-center px-2 text-[9px] font-black uppercase tracking-[0.14em] text-white/40 relative"
              style={{ height: RULER_H }}
            >
              Tracks
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/20"
                onPointerDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startW = trackHeaderWidth || TRACK_LABEL_W;
                  const onMove = (ev: PointerEvent) => {
                    const w = Math.max(120, Math.min(280, startW + (ev.clientX - startX)));
                    setTrackHeaderWidth(w);
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
                title="Drag to resize track headers"
              />
            </div>
            {playlistTracks.map((tr, i) => {
              const trackAudible =
                playing &&
                !tr.mute &&
                arrangement.some((c) => c.track === i && playingClips.has(c.id));
              return (
              <div
                key={i}
                className="flex items-center gap-0.5 px-1 border-b border-white/[0.04]"
                style={{
                  height: laneH,
                  background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                  opacity: tr.mute && !tr.solo ? 0.45 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => setPlaylistTrack(i, { collapsed: !tr.collapsed })}
                  className="w-4 h-5 rounded text-[8px] text-white/35 hover:text-white/70"
                  title={tr.collapsed ? "Expand track" : "Collapse track"}
                >{tr.collapsed ? "▸" : "▾"}</button>
                <span
                  className="w-1 h-1 rounded-full shrink-0"
                  style={{ background: tr.color }}
                />
                {renamingTrack === i ? (
                  <input
                    autoFocus
                    value={trackRenameValue}
                    onChange={(e) => setTrackRenameValue(e.target.value)}
                    onBlur={() => {
                      setPlaylistTrack(i, { name: trackRenameValue });
                      setRenamingTrack(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setPlaylistTrack(i, { name: trackRenameValue });
                        setRenamingTrack(null);
                      }
                      if (e.key === "Escape") setRenamingTrack(null);
                    }}
                    className="flex-1 min-w-0 h-5 rounded border border-white/20 bg-black/50 px-1 text-[10px] text-white outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left truncate"
                    title={`${tr.name} — double-click to rename`}
                    onDoubleClick={() => {
                      setRenamingTrack(i);
                      setTrackRenameValue(tr.name);
                    }}
                  >
                    <div className="text-[10px] font-semibold text-white/78 truncate leading-tight" title={tr.name}>{tr.name}</div>
                    <div className="text-[9px] uppercase tracking-[0.08em] text-white/45 leading-tight">
                      {tr.layer === "a" ? "Synth A" : tr.layer === "b" ? "Synth B" : tr.layer === "drums" ? "Drums" : tr.layer === "samples" ? "Samples" : "Track"}
                    </div>
                  </button>
                )}
                <div
                  className="w-1.5 h-6 rounded-full overflow-hidden shrink-0 bg-white/[0.06]"
                  title={trackAudible ? "Audible" : "Silent"}
                  aria-hidden
                >
                  <div
                    className="w-full rounded-full origin-bottom transition-all duration-150"
                    style={{
                      height: trackAudible ? "70%" : playing && !tr.mute ? "18%" : "8%",
                      marginTop: trackAudible ? "30%" : playing && !tr.mute ? "82%" : "92%",
                      background: tr.color,
                      boxShadow: trackAudible ? `0 0 6px ${tr.color}` : undefined,
                      animation: trackAudible ? "evolve-breathe 0.9s ease-in-out infinite" : undefined,
                      opacity: trackAudible ? 1 : 0.35,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setPlaylistTrack(i, { arm: !tr.arm })}
                  className="arr-track-btn"
                  data-on={tr.arm ? "1" : "0"}
                  data-kind="arm"
                  title={tr.arm ? "Disarm record — this lane is the Add-to-end target" : "Arm record — make this the target lane for new clips"}
                  aria-label={tr.arm ? `Disarm ${tr.name}` : `Arm ${tr.name}`}
                  aria-pressed={tr.arm}
                >R</button>
                <button
                  type="button"
                  onClick={() => setPlaylistTrack(i, { mute: !tr.mute, solo: tr.mute ? tr.solo : false })}
                  className="arr-track-btn"
                  data-on={tr.mute ? "1" : "0"}
                  data-kind="mute"
                  title={tr.mute ? "Unmute track" : "Mute track"}
                  aria-label={tr.mute ? `Unmute ${tr.name}` : `Mute ${tr.name}`}
                  aria-pressed={tr.mute}
                >M</button>
                <button
                  type="button"
                  onClick={() => setPlaylistTrack(i, { solo: !tr.solo, mute: tr.solo ? tr.mute : false })}
                  className="arr-track-btn"
                  data-on={tr.solo ? "1" : "0"}
                  data-kind="solo"
                  title={tr.solo ? "Unsolo track" : "Solo track"}
                  aria-label={tr.solo ? `Unsolo ${tr.name}` : `Solo ${tr.name}`}
                  aria-pressed={tr.solo}
                >S</button>
                <input
                  type="color"
                  value={tr.color}
                  onChange={(e) => setPlaylistTrack(i, { color: e.target.value })}
                  className="w-4 h-4 rounded border-0 bg-transparent cursor-pointer shrink-0"
                  title="Track color"
                />
              </div>
              );
            })}
          </div>

          <div
            ref={scrollRef}
            className={`relative flex-1 editor-scroll overflow-auto ${arrFullscreen ? "min-h-0" : ""}`}
            style={arrFullscreen ? undefined : { maxHeight: RULER_H + playlistH }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const { step, track } = posFromClient(e.clientX, e.clientY);
              setDropHover({ step, track, bars: activeBars });
            }}
            onDragLeave={() => setDropHover(null)}
            onDrop={onTimelineDrop}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
              setPxPerBar((z) => clampZoom(z * factor));
            }}
          >
            <div className="relative min-w-full" style={{ width: trackW, height: RULER_H + playlistH }}>
              {/* Bar ruler — click / drag to scrub */}
              <div
                className="absolute inset-x-0 top-0 border-b border-white/[0.08] bg-black/40 cursor-ew-resize z-20 touch-none"
                style={{ height: RULER_H }}
                onPointerDown={beginRulerScrub}
                title="Click / drag to scrub arrangement playhead"
              >
                {Array.from({ length: Math.ceil(totalBars) }, (_, b) => (
                  <div
                    key={b}
                    className="absolute top-0 bottom-0 border-l pointer-events-none"
                    style={{
                      left: b * pxPerBar,
                      width: pxPerBar,
                      borderColor: b % 4 === 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
                      background: b % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
                    }}
                  >
                    <span className={`pl-1.5 text-[10px] font-mono leading-[24px] ${b % 4 === 0 ? "text-white/65 font-semibold" : "text-white/40"}`}>
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
                {/* Snap subdivision grid */}
                {(() => {
                  const lines: JSX.Element[] = [];
                  const pxPerStep = pxPerBar / STEPS_PER_BAR;
                  const grid = effectiveSnap;
                  // Only draw subdivisions when zoomed enough to read them
                  const minPx = grid <= 1 ? 6 : grid <= 4 ? 4 : 3;
                  if (grid > 0 && pxPerStep * grid >= minPx) {
                    for (let s = 0; s < totalSteps; s += grid) {
                      const isBar = s % STEPS_PER_BAR === 0;
                      const isBeat = s % 4 === 0;
                      if (isBar) continue; // bars drawn separately
                      lines.push(
                        <div
                          key={`g${s}`}
                          className="absolute top-0 bottom-0 pointer-events-none"
                          style={{
                            left: s * pxPerStep,
                            width: 1,
                            background: isBeat ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.035)",
                          }}
                        />,
                      );
                    }
                  }
                  // Bar lines always
                  for (let b = 0; b <= totalBars; b++) {
                    lines.push(
                      <div
                        key={`b${b}`}
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{
                          left: b * pxPerBar,
                          width: b % 4 === 0 ? 2 : 1,
                          background: b % 4 === 0
                            ? "rgba(255,150,80,0.28)"
                            : "rgba(255,255,255,0.09)",
                        }}
                      />,
                    );
                  }
                  return lines;
                })()}

                {Array.from({ length: MAX_PLAYLIST_TRACKS }, (_, track) => (
                  <div
                    key={track}
                    className="absolute inset-x-0 border-b border-white/[0.04]"
                    style={{
                      top: track * laneH,
                      height: laneH,
                      background: track % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
                    }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-clip]")) return;
                      const { step } = posFromClient(e.clientX, e.clientY);
                      placeAt(step, track, e.shiftKey);
                    }}
                    title={
                      selectedClip
                        ? `Click to deselect (Shift+click places “${activeName}”)`
                        : `Place “${activeName}” · T${track + 1}`
                    }
                  />
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
                      left: (dropHover.step / STEPS_PER_BAR) * pxPerBar + 1,
                      top: dropHover.track * laneH + 2,
                      width: Math.max(pxPerBar * dropHover.bars - 2, pxPerBar * 0.4),
                      height: laneH - 4,
                      background: `${activeColor}33`,
                      border: `1px dashed ${activeColor}`,
                    }}
                  />
                )}

                {clipGhost && (
                  <div
                    className="absolute pointer-events-none z-25 rounded-md border border-dashed opacity-80"
                    style={{
                      left: (clipGhost.step / STEPS_PER_BAR) * pxPerBar + 2,
                      top: clipGhost.track * laneH + 3,
                      width: Math.max(pxPerBar * 0.55, clipGhost.bars * pxPerBar - 3),
                      height: laneH - 6,
                      borderColor: clipGhost.color,
                      background: `${clipGhost.color}44`,
                    }}
                  />
                )}

                {arrangement.map((clip) => {
                  const track = clampTrack(clip.track ?? 0);
                  const trColor = playlistTracks[track]?.color ?? colorOf(clip.patternId);
                  const color = clip.color ?? trColor;
                  const lenSteps = clipLenSteps(clip);
                  const bars = lenSteps / STEPS_PER_BAR;
                  const dragging = clipGhost?.id === clip.id;
                  const sec = sections.find((s) => s.id === clip.patternId);
                  const displayName = clip.unique
                    ? (clip.instanceLabel ?? `${nameOf(clip.patternId)}1`)
                    : nameOf(clip.patternId);
                  return (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      name={displayName}
                      sourceName={nameOf(clip.patternId)}
                      notePreview={clip.unique ? clip.local?.notes : sec?.notes}
                      hasAutomation={!!(clip.unique ? clip.local?.automation : sec?.automation)
                        && Object.keys((clip.unique ? clip.local?.automation : sec?.automation) ?? {}).length > 0}
                      bars={bars}
                      fullBars={clip.unique ? (clip.local?.bars ?? sec?.bars ?? 1) : (sec?.bars ?? 1)}
                      color={color}
                      pxPerBar={pxPerBar}
                      laneH={laneH}
                      snapSteps={effectiveSnap}
                      sounding={playingClips.has(clip.id)}
                      selected={selectedClip === clip.id}
                      menuOpen={clipMenu === clip.id}
                      hidden={dragging || !!playlistTracks[track]?.collapsed}
                      onSelect={() => {
                        setSelectedClip(clip.id);
                        setClipMenu(null);
                        selectClipForEdit(clip.id);
                      }}
                      onMenu={() => setClipMenu(clipMenu === clip.id ? null : clip.id)}
                      onMakeUnique={() => {
                        if (makeClipUnique(clip.id)) {
                          selectClipForEdit(clip.id);
                          toast(`${displayName} · UNIQUE`);
                        }
                        setClipMenu(null);
                      }}
                      onEditSource={() => {
                        editClipSource(clip.id);
                        toast(`Editing source PATTERN ${nameOf(clip.patternId)}`);
                        setClipMenu(null);
                      }}
                      onCommit={() => {
                        const nid = commitClipVariation(clip.id);
                        if (nid) toast("Committed variation → new bank pattern");
                        setClipMenu(null);
                      }}
                      onDuplicateLinked={() => {
                        const id = duplicateClip(clip.id);
                        if (id) {
                          setSelectedClip(id);
                          selectClipForEdit(id);
                          toast(clip.unique ? "Duplicated unique clip" : "Duplicated linked clip");
                        }
                        setClipMenu(null);
                      }}
                      onRemove={() => {
                        removeClip(clip.id);
                        if (selectedClip === clip.id) setSelectedClip(null);
                        setClipMenu(null);
                        toast(`Removed clip “${displayName}”`);
                      }}
                      onTrim={(steps) => trimClip(clip.id, steps)}
                      onDragStart={(e) => beginClipDrag(e, clip, color, bars)}
                    />
                  );
                })}

                {(playMode === "arrangement" || playScope === "arrangement") && (
                  <div
                    className="absolute top-0 bottom-0 w-[2px] z-30 pointer-events-none"
                    style={{
                      left: (playheadStep / STEPS_PER_BAR) * pxPerBar,
                      background: "linear-gradient(180deg, #fff, #ffbfa0)",
                      boxShadow: "0 0 12px rgba(255,220,150,0.9)",
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        )}
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
  sourceName,
  notePreview,
  hasAutomation,
  bars,
  fullBars,
  color,
  pxPerBar,
  laneH,
  snapSteps,
  sounding,
  selected,
  menuOpen,
  hidden,
  onSelect,
  onMenu,
  onMakeUnique,
  onEditSource,
  onCommit,
  onDuplicateLinked,
  onRemove,
  onTrim,
  onDragStart,
}: {
  clip: ArrangementClip;
  name: string;
  sourceName: string;
  notePreview?: { step: number; midi: number; len: number; vel: number }[] | null;
  hasAutomation?: boolean;
  bars: number;
  fullBars: number;
  color: string;
  pxPerBar: number;
  laneH: number;
  snapSteps: number;
  sounding: boolean;
  selected: boolean;
  menuOpen?: boolean;
  hidden?: boolean;
  onSelect: () => void;
  onMenu: () => void;
  onMakeUnique: () => void;
  onEditSource: () => void;
  onCommit: () => void;
  onDuplicateLinked: () => void;
  onRemove: () => void;
  onTrim: (lengthSteps: number) => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const track = clampTrack(clip.track ?? 0);
  const left = (clip.startStep / STEPS_PER_BAR) * pxPerBar;
  // Allow true 1/16-bar clips — old 0.35·bar floor made 1/4 look identical to ~1/3.
  const width = Math.max(pxPerBar / 16, bars * pxPerBar - 2);
  const startBar = Math.floor(clip.startStep / STEPS_PER_BAR) + 1;
  const top = track * laneH + 3;
  const unique = !!clip.unique;
  const badge = unique ? "UNIQUE" : "LINKED";
  // Active window-listener detach for a trim drag — run on unmount.
  const trimCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    trimCleanupRef.current?.();
  }, []);

  const audibleSteps = Math.max(1, bars * STEPS_PER_BAR);
  const spark = useMemo(() => {
    const notes = notePreview ?? [];
    if (notes.length === 0) return null;
    const h = Math.max(10, laneH - 22);
    const visible = notes.filter((n) => n.step < audibleSteps).slice(0, 96);
    if (visible.length === 0) return null;
    const minMidi = Math.min(...visible.map((n) => n.midi));
    const maxMidi = Math.max(...visible.map((n) => n.midi));
    const span = Math.max(1, maxMidi - minMidi);
    return visible.map((n, i) => {
      const x = (n.step / audibleSteps) * 100;
      const yw = ((n.midi - minMidi) / span) * (h - 2);
      const ww = Math.max(0.8, (n.len / audibleSteps) * 100);
      return (
        <rect
          key={i}
          x={`${x}%`}
          y={h - 2 - yw}
          width={`${ww}%`}
          height={2.5}
          fill="rgba(255,255,255,0.7)"
          opacity={0.4 + n.vel * 0.55}
        />
      );
    });
  }, [notePreview, audibleSteps, laneH]);

  return (
    <div
      data-clip="1"
      onPointerDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.dataset.trim || t.closest("button") || t.closest("[data-menu]")) return;
        // Piano-roll style: right-click deletes immediately.
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
          return;
        }
        onDragStart(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`group absolute rounded-md border cursor-grab active:cursor-grabbing select-none overflow-visible transition z-[15] touch-none ${
        selected ? "ring-2 ring-white/55" : ""
      } ${hidden ? "opacity-30" : ""}`}
      style={{
        left: left + 2,
        top,
        width,
        height: laneH - 6,
        borderColor: sounding || selected ? color : `${color}77`,
        background: `linear-gradient(165deg, ${color}${sounding ? "55" : "38"}, ${color}${sounding ? "28" : "16"})`,
        boxShadow: sounding
          ? `0 0 12px ${color}66, inset 0 1px 0 rgba(255,255,255,0.12)`
          : "inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
      title={`PATTERN ${name} · ${badge} · ${bars % 1 === 0 ? `${bars}b` : `${bars.toFixed(2)}b`} · T${track + 1} — right-click to delete · ⋯ for more`}
    >
      <div className="absolute inset-0 rounded-md overflow-hidden pointer-events-none">
        {spark && (
          <svg
            className="absolute inset-x-0 bottom-0 opacity-90"
            width="100%"
            height={Math.max(10, laneH - 22)}
            preserveAspectRatio="none"
            aria-hidden
          >
            {spark}
          </svg>
        )}
      </div>
      <div className="relative h-full flex flex-col justify-start pt-0.5 px-1.5 min-w-0 pr-5 pointer-events-none overflow-hidden z-[1]">
        <div className="flex items-center gap-1 min-w-0">
          <div
            className="text-[10px] font-bold truncate leading-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            style={{ color: sounding ? "#fff" : color }}
          >
            {name}
          </div>
          <span
            className={`shrink-0 text-[7px] font-black uppercase tracking-wide px-1 rounded ${
              unique ? "bg-violet-400/30 text-violet-100" : "bg-black/35 text-white/55"
            }`}
          >
            {unique ? "UNIQUE" : "LINKED"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className="text-[8px] font-mono text-white/55 truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]">
            {bars % 1 === 0 ? `${bars}b` : `${bars.toFixed(2)}b`} · @{startBar}
          </div>
          {hasAutomation && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300/80 shrink-0" title="Has automation" />
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMenu(); }}
        className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 text-[9px] rounded bg-black/50 text-white/60 hover:text-white z-[2]"
        title="Clip actions"
      >⋯</button>
      {menuOpen && (
        <div
          data-menu="1"
          className="absolute left-0 top-full z-50 mt-0.5 w-44 rounded-lg border border-white/15 bg-[#0c0c12]/98 py-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {!unique && (
            <button type="button" className="block w-full px-2.5 py-1.5 text-left text-[10px] text-white/75 hover:bg-white/10" onClick={onMakeUnique}>
              Make unique
            </button>
          )}
          <button type="button" className="block w-full px-2.5 py-1.5 text-left text-[10px] text-white/75 hover:bg-white/10" onClick={onEditSource}>
            Edit source pattern
          </button>
          {unique && (
            <button type="button" className="block w-full px-2.5 py-1.5 text-left text-[10px] text-white/75 hover:bg-white/10" onClick={onCommit}>
              Commit variation (new pattern)
            </button>
          )}
          <button type="button" className="block w-full px-2.5 py-1.5 text-left text-[10px] text-white/75 hover:bg-white/10" onClick={onDuplicateLinked}>
            {unique ? "Duplicate unique" : "Duplicate linked"}
          </button>
          <button type="button" className="block w-full px-2.5 py-1.5 text-left text-[10px] text-rose-300/80 hover:bg-white/10" onClick={onRemove}>
            Remove clip
          </button>
        </div>
      )}
      <div
        data-trim="1"
        className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/25 z-[3]"
        title="Drag to trim length (follows snap)"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startLen = bars * STEPS_PER_BAR;
          const maxLen = fullBars * STEPS_PER_BAR;
          const grid = Math.max(0.25, snapSteps);
          // Trim can always resolve to 1/4 bar (or finer if snap is finer).
          const trimGrid = Math.min(grid, STEPS_PER_BAR / 4);
          const minLen = Math.max(1, trimGrid);
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            const dSteps = (dx / pxPerBar) * STEPS_PER_BAR;
            const next = Math.max(minLen, Math.min(maxLen, startLen + dSteps));
            const snapped = Math.max(minLen, quantizeStep(next, trimGrid));
            onTrim(snapped);
          };
          const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            trimCleanupRef.current = null;
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
          trimCleanupRef.current = onUp;
        }}
      />
    </div>
  );
}
