/**
 * PianoRoll — FL-Studio-style editable piano roll for the Fire Command
 * sequencer, rendered on a single canvas for performance.
 *
 * Tools (toolbar):
 *   · Draw   — place + drag to stretch length; paint across pitches; note body
 *              moves; edges resize. Live preview (no store thrash while dragging).
 *   · Select — LMB marquee / move; empty click deselects (never creates notes)
 *   · Erase  — LMB sweeps delete (RMB always erases in any tool)
 *
 * Also:
 *   · left OR right edge drag  → resize (preview until release)
 *   · Shift+vertical drag      → velocity
 *   · Double-click note        → delete
 *   · Alt+drag in Draw         → erase stroke
 *   · Ctrl+wheel / ± buttons   → horizontal zoom
 *   · Snap chips (1 → 1/32) → grid + place / move / resize / default length
 *   · Ctrl+D / ↑↓ / ←→ / Del   → duplicate / transpose / nudge / delete
 *   · Keys 1–6                 → snap resolution (whole → 1/32)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useFireSequencerStore,
  getPlayheadStep,
  inScale,
  snapMidiToScale,
  STEPS_PER_BAR,
  SCALES,
  NOTE_NAMES,
  type RollNote,
  type ScaleId,
} from "@/state/fireSequencerStore";
import { playUi } from "@/audio/uiSounds";
import { useUIStore } from "@/state/uiStore";
import { useRollFit, ROLL_ZOOM_MAX } from "./useRollFit";

export const PIANO_GUTTER = 46;

const ROW_H = 16;    // px per semitone — taller = easier to hit
const GUTTER = PIANO_GUTTER;
const MIDI_TOP = 96; // C7
const MIDI_BOT = 24; // C1
const ROWS = MIDI_TOP - MIDI_BOT + 1;
const HEIGHT_MIN = 220;
const HEIGHT_MAX = 620;

const BLACK = new Set([1, 3, 6, 8, 10]);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Tool = "draw" | "select" | "erase";
type DragMode =
  | "move"
  | "resize"
  | "resizeL"
  | "velocity"
  | "marquee"
  | "erase"
  | "paint"
  | "placeStretch";
type HitZone = "body" | "left" | "right";

interface DragSession {
  mode: DragMode;
  noteId: string | null;
  startX: number;
  startY: number;
  startStep: number;
  startMidi: number;
  orig: RollNote | null;
  /** Original positions of every selected note for group moves. */
  groupOrig: Map<string, RollNote> | null;
  moved: boolean;
  /** Cells already painted this stroke (`step:midi`) — paint mode. */
  painted?: Set<string>;
  /** Ghost notes for place/paint — committed on pointer up. */
  ghosts?: RollNote[];
}

/** Ephemeral overlay while dragging — avoids store writes every pointermove. */
interface PreviewState {
  overrides: Map<string, Partial<RollNote>>;
  ghosts: RollNote[];
  hoverId: string | null;
}

/** FL-style snap grid — step units where 16 = one bar of 16ths. */
const SNAP_OPTIONS = [
  { label: "1", steps: 16 },
  { label: "1/2", steps: 8 },
  { label: "1/4", steps: 4 },
  { label: "1/8", steps: 2 },
  { label: "1/16", steps: 1 },
  { label: "1/32", steps: 0.5 },
] as const;

const SNAP_STORAGE = "killchain.fire.rollSnap";
const MOVE_THRESHOLD_PX = 2;
const PLACE_TO_PAINT_SEMIS = 1;

function edgePx(noteW: number): number {
  // Keep grips small so the note body stays easy to grab/move (FL-like).
  return Math.max(8, Math.min(noteW * 0.22, 14));
}

function quantizeTo(raw: number, grid: number): number {
  if (grid <= 0) return raw;
  return Math.round(raw / grid) * grid;
}

function snapLenTo(raw: number, grid: number): number {
  return Math.max(grid, quantizeTo(raw, grid));
}

function readStoredSnap(): number {
  try {
    const v = Number(window.localStorage.getItem(SNAP_STORAGE));
    if (SNAP_OPTIONS.some((o) => o.steps === v)) return v;
  } catch { /* ignore */ }
  return 1; // default 1/16
}

/** True if a 1-step cell overlaps an existing note on the same pitch. */
function cellOccupied(
  notes: RollNote[],
  pitch: number,
  cell: number,
  ignoreId?: string,
): boolean {
  for (const n of notes) {
    if (ignoreId && n.id === ignoreId) continue;
    if (n.midi !== pitch) continue;
    // Interval [step, step+len) vs cell [cell, cell+1)
    if (n.step < cell + 1 && n.step + n.len > cell) return true;
  }
  return false;
}

/** Cap length so a new note can touch the next same-pitch note but not overlap it. */
function clampLenBeforeNext(
  notes: RollNote[],
  pitch: number,
  step: number,
  wanted: number,
  grid: number,
  ignoreId?: string,
): number {
  let max = wanted;
  for (const n of notes) {
    if (ignoreId && n.id === ignoreId) continue;
    if (n.midi !== pitch) continue;
    if (n.step >= step) max = Math.min(max, n.step - step);
  }
  return snapLenTo(Math.max(grid, max), grid);
}

export function PianoRoll() {
  const notes = useFireSequencerStore((s) => s.notes);
  const playScope = useFireSequencerStore((s) => s.playScope);
  const bars = useFireSequencerStore((s) => s.bars);
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const activeChannel = useFireSequencerStore((s) => s.activeChannel);
  const scaleRoot = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const scaleSnap = useFireSequencerStore((s) => s.scaleSnap);
  const addNotes = useFireSequencerStore((s) => s.addNotes);
  const updateNote = useFireSequencerStore((s) => s.updateNote);
  const updateNotes = useFireSequencerStore((s) => s.updateNotes);
  const removeNote = useFireSequencerStore((s) => s.removeNote);
  const removeNotes = useFireSequencerStore((s) => s.removeNotes);
  const duplicateNotes = useFireSequencerStore((s) => s.duplicateNotes);
  const transposeNotes = useFireSequencerStore((s) => s.transposeNotes);
  const humanizeNotes = useFireSequencerStore((s) => s.humanizeNotes);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  const setScaleSnap = useFireSequencerStore((s) => s.setScaleSnap);
  const auditionNote = useFireSequencerStore((s) => s.audition);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const previewRef = useRef<PreviewState>({
    overrides: new Map(),
    ghosts: [],
    hoverId: null,
  });
  const rafPaintRef = useRef(0);
  const [snapSteps, setSnapStepsState] = useState(readStoredSnap);
  const snapRef = useRef(snapSteps);
  snapRef.current = snapSteps;
  const lastLenRef = useRef(snapSteps);
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const [brushLen, setBrushLen] = useState(snapSteps);
  const [tool, setTool] = useState<Tool>("draw");
  const velCanvasRef = useRef<HTMLCanvasElement>(null);
  const velScrollRef = useRef<HTMLDivElement>(null);
  const velPaintingRef = useRef(false);
  const [velOpen, setVelOpen] = useState(true);
  const lastAudMidiRef = useRef<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  // Selected notes define the Open Fire "Selection" loop range. Tracks note
  // drags too (notes dep), not just selection membership changes.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    let min = Infinity;
    let max = -Infinity;
    for (const n of notes) {
      if (!selectedIds.has(n.id)) continue;
      min = Math.min(min, n.step);
      max = Math.max(max, n.step + n.len);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    useFireSequencerStore.getState().setSelectionRange(Math.floor(min), Math.ceil(max));
  }, [selectedIds, notes]);

  const { cellW: CELL_W, gridW, zoom, bumpZoom, setZoom, fitMode } = useRollFit();
  const cellWRef = useRef(CELL_W);
  const gridWRef = useRef(gridW);
  cellWRef.current = CELL_W;
  gridWRef.current = gridW;
  const [rollH, setRollH] = useState(360);
  const heightDrag = useRef<{ startY: number; startH: number } | null>(null);

  const totalSteps = bars * STEPS_PER_BAR;
  const gridH = ROWS * ROW_H;
  const gridHRef = useRef(gridH);
  gridHRef.current = gridH;

  const setSnap = (steps: number) => {
    setSnapStepsState(steps);
    snapRef.current = steps;
    lastLenRef.current = steps;
    setBrushLen(steps);
    try { window.localStorage.setItem(SNAP_STORAGE, String(steps)); } catch { /* ignore */ }
  };

  const setBrush = (len: number) => {
    lastLenRef.current = len;
    setBrushLen(len);
  };

  const snapPitch = useCallback(
    (midi: number) => (scaleSnap ? snapMidiToScale(midi, scaleRoot, scaleId) : midi),
    [scaleSnap, scaleRoot, scaleId],
  );

  /** Notes as drawn: store + live drag preview. */
  const effectiveNotes = useCallback((): RollNote[] => {
    const base = useFireSequencerStore.getState().notes;
    const p = previewRef.current;
    const out: RollNote[] = [];
    for (const n of base) {
      const o = p.overrides.get(n.id);
      out.push(o ? { ...n, ...o } : n);
    }
    for (const g of p.ghosts) out.push(g);
    return out;
  }, []);

  // ── initial scroll: center around A3–C5 ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetRow = MIDI_TOP - 66;
    el.scrollTop = Math.max(0, targetRow * ROW_H - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paintCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Always size from useRollFit's gridW — same number the layout uses.
    const gw = gridWRef.current;
    const cw = cellWRef.current;
    const gh = gridHRef.current;
    const bufW = Math.max(1, Math.round(gw * dpr));
    const bufH = Math.max(1, Math.round(gh * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    // Always sync CSS size (even when buffer unchanged) so hit-tests match paint.
    canvas.style.width = `${gw}px`;
    canvas.style.height = `${gh}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gw, gh);

    const plate = ctx.createLinearGradient(0, 0, 0, gh);
    plate.addColorStop(0, "rgba(14,16,22,1)");
    plate.addColorStop(0.5, "rgba(10,12,18,1)");
    plate.addColorStop(1, "rgba(8,9,14,1)");
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, gw, gh);
    const scaleOn = scaleId !== "off";
    for (let r = 0; r < ROWS; r++) {
      const midi = MIDI_TOP - r;
      const pc = midi % 12;
      ctx.fillStyle = BLACK.has(pc) ? "rgba(0,0,0,0.34)" : "rgba(255,255,255,0.024)";
      ctx.fillRect(GUTTER, r * ROW_H, gw - GUTTER, ROW_H);
      if (scaleOn && inScale(midi, scaleRoot, scaleId)) {
        const isRoot = ((midi - scaleRoot) % 12 + 12) % 12 === 0;
        ctx.fillStyle = isRoot ? "rgba(255,150,70,0.10)" : "rgba(120,220,170,0.05)";
        ctx.fillRect(GUTTER, r * ROW_H, gw - GUTTER, ROW_H);
      }
      if (pc === 0) {
        ctx.fillStyle = "rgba(255,140,80,0.12)";
        ctx.fillRect(GUTTER, r * ROW_H + ROW_H - 1, gw - GUTTER, 1);
      }
    }

    const snap = snapRef.current;
    const lineCount = Math.ceil(totalSteps / snap);
    for (let i = 0; i <= lineCount; i++) {
      const s = i * snap;
      if (s > totalSteps + 1e-6) break;
      const x = GUTTER + s * cw;
      const isBar = Math.abs(s % STEPS_PER_BAR) < 1e-6;
      const isBeat = Math.abs(s % 4) < 1e-6;
      ctx.fillStyle = isBar
        ? "rgba(255,120,60,0.32)"
        : isBeat
          ? "rgba(255,255,255,0.12)"
          : "rgba(255,255,255,0.05)";
      ctx.fillRect(x, 0, isBar ? 1.5 : 1, gh);
    }

    const sel = selectedRef.current;
    const hoverId = previewRef.current.hoverId;
    const drawList = effectiveNotes();
    for (const n of drawList) {
      const ghost = n.id.startsWith("__ghost");
      const x = GUTTER + n.step * cw + 1;
      const y = (MIDI_TOP - n.midi) * ROW_H + 1.5;
      const w = Math.max(6, n.len * cw - 2);
      const h = ROW_H - 3;
      const isSel = sel.has(n.id);
      const isHover = hoverId === n.id;
      const alpha = ghost ? 0.55 : 0.42 + n.vel * 0.55;
      const isB = n.ch === 1;
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, isB ? `rgba(98,182,255,${alpha})` : `rgba(255,140,66,${alpha})`);
      grad.addColorStop(1, isB ? `rgba(52,120,224,${alpha})` : `rgba(255,84,38,${alpha})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();
      ctx.strokeStyle = isSel
        ? "rgba(255,235,190,0.95)"
        : isHover
          ? "rgba(255,255,255,0.75)"
          : isB
            ? "rgba(140,200,255,0.55)"
            : "rgba(255,170,110,0.5)";
      ctx.lineWidth = isSel || isHover ? 1.6 : 1;
      ctx.stroke();
      if (isSel) {
        ctx.shadowColor = "rgba(255,220,160,0.8)";
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      const grip = edgePx(w);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillRect(x + w - Math.min(4, grip * 0.25), y + 2, 3, h - 4);
      if ((isSel || isHover) && w > 16) {
        ctx.fillRect(x + 1, y + 2, 3, h - 4);
      }
    }

    ctx.fillStyle = "rgba(8,6,10,0.96)";
    ctx.fillRect(0, 0, GUTTER, gh);
    for (let r = 0; r < ROWS; r++) {
      const midi = MIDI_TOP - r;
      const pc = midi % 12;
      const y = r * ROW_H;
      const black = BLACK.has(pc);
      ctx.fillStyle = black ? "rgba(20,16,24,1)" : "rgba(235,230,240,0.92)";
      ctx.fillRect(0, y + 0.5, GUTTER - 6, ROW_H - 1);
      if (scaleOn && inScale(midi, scaleRoot, scaleId)) {
        ctx.fillStyle = "rgba(90,220,160,0.55)";
        ctx.fillRect(GUTTER - 10, y + 2, 3, ROW_H - 4);
      }
      if (pc === 0) {
        ctx.fillStyle = black ? "#ddd" : "#3a2a22";
        ctx.font = "8.5px ui-monospace, monospace";
        ctx.textBaseline = "middle";
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, 4, y + ROW_H / 2 + 0.5);
      }
    }
    ctx.fillStyle = "rgba(255,120,60,0.5)";
    ctx.fillRect(GUTTER - 2, 0, 2, gh);
  }, [effectiveNotes, totalSteps, scaleRoot, scaleId]);

  const schedulePaint = useCallback(() => {
    if (rafPaintRef.current) return;
    rafPaintRef.current = requestAnimationFrame(() => {
      rafPaintRef.current = 0;
      paintCanvas();
    });
  }, [paintCanvas]);

  // Cancel any paint frame still pending at unmount.
  useEffect(() => () => {
    if (rafPaintRef.current) cancelAnimationFrame(rafPaintRef.current);
  }, []);

  useEffect(() => { paintCanvas(); }, [paintCanvas, notes, selectedIds, gridW, CELL_W, snapSteps]);

  // ── playhead ──
  useEffect(() => {
    const el = playheadRef.current;
    if (!el) return;
    if (!playing) { el.style.opacity = "0"; return; }
    el.style.opacity = "1";
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const step = getPlayheadStep(bpm, bars);
      el.style.opacity = step < 0 ? "0" : "1";
      el.style.transform = `translateX(${GUTTER + Math.max(0, step) * CELL_W}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, bpm, bars, CELL_W]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      bumpZoom(e.deltaY > 0 ? 0.85 : 1.18);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bumpZoom]);

  const posFromEvent = (e: React.PointerEvent): { x: number; y: number; step: number; midi: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // Map viewport pixels → logical canvas space. Required when CSS size and
    // getBoundingClientRect diverge (DPR, fit-width, subpixel layout).
    const logicalW = gridWRef.current;
    const logicalH = gridHRef.current;
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * logicalW;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * logicalH;
    const cw = cellWRef.current;
    return {
      x,
      y,
      step: (x - GUTTER) / Math.max(1e-6, cw),
      midi: MIDI_TOP - Math.floor(y / ROW_H),
    };
  };

  const hitNote = (x: number, y: number, fat = false): { note: RollNote; zone: HitZone } | null => {
    const padY = fat ? 5 : 1;
    const padX = fat ? 4 : 1;
    const cw = cellWRef.current;
    const list = effectiveNotes();
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.id.startsWith("__ghost")) continue; // don't grab ghosts mid-stroke from outside
      const nx = GUTTER + n.step * cw;
      const ny = (MIDI_TOP - n.midi) * ROW_H;
      const nw = Math.max(6, n.len * cw);
      if (
        x >= nx - padX && x <= nx + nw + padX
        && y >= ny - padY && y <= ny + ROW_H + padY
      ) {
        let zone: HitZone = "body";
        const edge = edgePx(nw);
        // Always prefer a real body zone — short notes used to be ~half resize.
        if (nw > edge * 2.2) {
          if (x <= nx + edge) zone = "left";
          else if (x >= nx + nw - edge) zone = "right";
        } else if (nw > 10 && x >= nx + nw - Math.min(edge, nw * 0.35)) {
          zone = "right";
        }
        return { note: n, zone };
      }
    }
    return null;
  };

  const clearPreview = () => {
    previewRef.current.overrides.clear();
    previewRef.current.ghosts = [];
  };

  const audition = (midi: number, vel = 0.85, ch = activeChannel) => {
    auditionNote(midi, vel, ch);
  };

  const beginGhost = (step: number, midi: number, len: number): RollNote => {
    // Draw at the exact row clicked — scale snap must not steal black-key pitches.
    const pitch = clamp(Math.round(midi), MIDI_BOT, MIDI_TOP);
    const grid = snapRef.current;
    const snapped = Math.max(0, quantizeTo(step, grid));
    const live = useFireSequencerStore.getState().notes;
    const capped = clampLenBeforeNext(live, pitch, snapped, Math.max(grid, len), grid);
    return {
      id: `__ghost_${snapped}_${pitch}_${Math.random().toString(36).slice(2, 7)}`,
      step: snapped,
      midi: pitch,
      len: capped,
      vel: 0.85,
      ch: activeChannel,
    };
  };

  // ── pointer interactions ──
  const onPointerDown = (e: React.PointerEvent) => {
    const erasing =
      e.button === 2
      || (e.button === 0 && tool === "erase")
      || (e.button === 0 && tool === "draw" && e.altKey);

    if (erasing) {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = posFromEvent(e);
      if (x < GUTTER) return;
      const canvas = canvasRef.current;
      if (canvas) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      } else {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      dragRef.current = {
        mode: "erase", noteId: null, startX: x, startY: y,
        startStep: 0, startMidi: 0,
        orig: null, groupOrig: null, moved: false,
      };
      const hit = hitNote(x, y, true);
      if (hit) {
        if (selectedIds.has(hit.note.id) && selectedIds.size > 1) {
          removeNotes([...selectedIds]);
          setSelectedIds(new Set());
        } else {
          removeNote(hit.note.id);
        }
      }
      return;
    }
    if (e.button !== 0) return;

    const { x, y, step, midi } = posFromEvent(e);

    if (x < GUTTER) { audition(midi); return; }
    if (midi < MIDI_BOT || midi > MIDI_TOP || step < 0) return;

    const hit = hitNote(x, y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // Double-click note → delete (FL-adjacent quick remove).
    if (hit && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      const now = performance.now();
      const prev = lastClickRef.current;
      if (prev && prev.id === hit.note.id && now - prev.t < 320) {
        lastClickRef.current = null;
        removeNote(hit.note.id);
        setSelectedIds((s) => {
          const n = new Set(s);
          n.delete(hit.note.id);
          return n;
        });
        dragRef.current = null;
        return;
      }
      lastClickRef.current = { id: hit.note.id, t: now };
    } else {
      lastClickRef.current = null;
    }

    if (!hit && (tool === "select" || e.ctrlKey || e.metaKey)) {
      dragRef.current = {
        mode: "marquee", noteId: null, startX: x, startY: y,
        startStep: step, startMidi: midi,
        orig: null, groupOrig: null, moved: false,
      };
      if (!(e.ctrlKey || e.metaKey)) setSelectedIds(new Set());
      return;
    }

    if (hit) {
      const inSelection = selectedIds.has(hit.note.id);
      let sel: ReadonlySet<string>;
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedIds);
        if (inSelection) next.delete(hit.note.id);
        else next.add(hit.note.id);
        sel = next;
        setSelectedIds(next);
      } else if (inSelection) {
        sel = selectedIds;
      } else {
        sel = new Set([hit.note.id]);
        setSelectedIds(sel);
      }
      const live = useFireSequencerStore.getState().notes;
      const groupOrig =
        sel.size > 1 && sel.has(hit.note.id)
          ? new Map(live.filter((n) => sel.has(n.id)).map((n) => [n.id, { ...n }]))
          : null;
      const mode: DragMode = e.shiftKey
        ? "velocity"
        : hit.zone === "right"
          ? "resize"
          : hit.zone === "left"
            ? "resizeL"
            : "move";
      clearPreview();
      dragRef.current = {
        mode,
        noteId: hit.note.id,
        startX: x, startY: y,
        startStep: step, startMidi: midi,
        orig: { ...hit.note },
        groupOrig,
        moved: false,
      };
    } else if (tool === "draw") {
      // FL place: ghost at click; drag same pitch → stretch; cross pitch → paint.
      const ghost = beginGhost(step, midi, lastLenRef.current);
      if (ghost.step >= totalSteps) return;
      previewRef.current.ghosts = [ghost];
      dragRef.current = {
        mode: "placeStretch",
        noteId: ghost.id,
        startX: x, startY: y,
        startStep: ghost.step,
        startMidi: ghost.midi,
        orig: { ...ghost },
        groupOrig: null,
        moved: false,
        painted: new Set([`${ghost.step}:${ghost.midi}`]),
        ghosts: [ghost],
      };
      if (ghost.midi !== lastAudMidiRef.current) {
        lastAudMidiRef.current = ghost.midi;
        audition(ghost.midi, 0.85, activeChannel);
      }
      schedulePaint();
    } else {
      dragRef.current = {
        mode: "marquee", noteId: null, startX: x, startY: y,
        startStep: step, startMidi: midi,
        orig: null, groupOrig: null, moved: false,
      };
      setSelectedIds(new Set());
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const d = dragRef.current;
    if (!canvas) return;

    if (!d) {
      const { x, y } = posFromEvent(e);
      if (tool === "erase") {
        canvas.style.cursor = x < GUTTER ? "pointer" : "not-allowed";
        return;
      }
      const hit = x >= GUTTER ? hitNote(x, y) : null;
      const hoverId = hit?.note.id ?? null;
      if (previewRef.current.hoverId !== hoverId) {
        previewRef.current.hoverId = hoverId;
        schedulePaint();
      }
      canvas.style.cursor = x < GUTTER
        ? "pointer"
        : hit
          ? (hit.zone === "left" || hit.zone === "right" ? "ew-resize" : "grab")
          : tool === "select" || e.ctrlKey || e.metaKey
            ? "crosshair"
            : "cell";
      return;
    }

    const { x, y, step, midi } = posFromEvent(e);
    const dx = x - d.startX;
    const dy = y - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > MOVE_THRESHOLD_PX) d.moved = true;

    if (d.mode === "erase") {
      const hit = x >= GUTTER ? hitNote(x, y, true) : null;
      if (hit) removeNote(hit.note.id);
      canvas.style.cursor = "not-allowed";
      return;
    }

    if (d.mode === "placeStretch" || d.mode === "paint") {
      // Exact row under the cursor (no scale remap — black keys stay drawable).
      const pitch = clamp(Math.round(midi), MIDI_BOT, MIDI_TOP);
      const crossedPitch = Math.abs(pitch - d.startMidi) >= PLACE_TO_PAINT_SEMIS;

      if (d.mode === "placeStretch" && crossedPitch) {
        d.mode = "paint";
        // Reset to brush-length stamps from the origin cell onward.
        const origin = d.ghosts?.[0];
        if (origin) {
          const live = useFireSequencerStore.getState().notes;
          const grid = snapRef.current;
          origin.len = clampLenBeforeNext(live, origin.midi, origin.step, lastLenRef.current, grid);
          d.painted = new Set([`${origin.step}:${origin.midi}`]);
          d.ghosts = [origin];
          previewRef.current.ghosts = d.ghosts;
        }
      }

      if (d.mode === "paint") {
        const grid = snapRef.current;
        const snapped = Math.max(0, quantizeTo(step, grid));
        if (snapped >= 0 && snapped < totalSteps && pitch >= MIDI_BOT && pitch <= MIDI_TOP) {
          const key = `${snapped}:${pitch}`;
          const painted = d.painted ?? new Set();
          d.painted = painted;
          if (!painted.has(key)) {
            const live = useFireSequencerStore.getState().notes;
            const blocked = cellOccupied(live, pitch, snapped);
            painted.add(key);
            if (!blocked) {
              const g = beginGhost(snapped, pitch, lastLenRef.current);
              d.ghosts = [...(d.ghosts ?? []), g];
              previewRef.current.ghosts = d.ghosts;
              if (pitch !== lastAudMidiRef.current) {
                lastAudMidiRef.current = pitch;
                audition(pitch, 0.85, activeChannel);
              }
            }
          }
        }
        canvas.style.cursor = "cell";
        schedulePaint();
        return;
      }

      // placeStretch — same pitch: drag right/left sets length from start.
      const g = d.ghosts?.[0];
      if (g && d.orig) {
        const live = useFireSequencerStore.getState().notes;
        const grid = snapRef.current;
        const end = Math.max(d.orig.step + grid, step);
        const rawLen = snapLenTo(end - d.orig.step, grid);
        g.len = clampLenBeforeNext(live, g.midi, d.orig.step, rawLen, grid);
        g.step = d.orig.step;
        g.midi = d.orig.midi;
        previewRef.current.ghosts = d.ghosts ?? [g];
        lastLenRef.current = g.len;
        canvas.style.cursor = "ew-resize";
        schedulePaint();
      }
      return;
    }

    if (d.mode === "marquee") {
      const el = marqueeRef.current;
      if (el) {
        const left = Math.min(d.startX, x);
        const top = Math.min(d.startY, y);
        el.style.opacity = "1";
        el.style.transform = `translate(${left}px, ${top}px)`;
        el.style.width = `${Math.abs(dx)}px`;
        el.style.height = `${Math.abs(dy)}px`;
      }
      const x0 = Math.min(d.startX, x);
      const x1 = Math.max(d.startX, x);
      const y0 = Math.min(d.startY, y);
      const y1 = Math.max(d.startY, y);
      const cw = cellWRef.current;
      const covered = new Set<string>();
      for (const n of useFireSequencerStore.getState().notes) {
        const nx = GUTTER + n.step * cw;
        const ny = (MIDI_TOP - n.midi) * ROW_H;
        const nw = Math.max(6, n.len * cw);
        if (nx < x1 && nx + nw > x0 && ny < y1 && ny + ROW_H > y0) covered.add(n.id);
      }
      setSelectedIds(covered);
      return;
    }

    // Move / resize / velocity — preview only until pointer up.
    const cw = cellWRef.current;
    if (d.mode === "move" && d.orig) {
      const grid = snapRef.current;
      const dSteps = quantizeTo(dx / cw, grid);
      const dSemis = -Math.round(dy / ROW_H);
      if (d.groupOrig) {
        for (const o of d.groupOrig.values()) {
          const newMidi = clamp(
            scaleSnap ? snapPitch(o.midi + dSemis) : o.midi + dSemis,
            MIDI_BOT,
            MIDI_TOP,
          );
          previewRef.current.overrides.set(o.id, {
            step: Math.max(0, quantizeTo(o.step + dSteps, grid)),
            midi: newMidi,
          });
        }
      } else {
        const rawMidi = d.orig.midi + dSemis;
        const newMidi = clamp(
          scaleSnap ? snapPitch(rawMidi) : rawMidi,
          MIDI_BOT,
          MIDI_TOP,
        );
        previewRef.current.overrides.set(d.noteId!, {
          step: Math.max(0, quantizeTo(d.orig.step + dSteps, grid)),
          midi: newMidi,
        });
        if (newMidi !== d.orig.midi && newMidi !== lastAudMidiRef.current) {
          lastAudMidiRef.current = newMidi;
          audition(newMidi, d.orig.vel, d.orig.ch);
        }
      }
      canvas.style.cursor = "grabbing";
      schedulePaint();
    } else if (d.mode === "resize" && d.orig) {
      const grid = snapRef.current;
      const endStep = (x - GUTTER) / cw;
      const live = useFireSequencerStore.getState().notes;
      const rawLen = snapLenTo(endStep - d.orig.step, grid);
      const len = clampLenBeforeNext(live, d.orig.midi, d.orig.step, rawLen, grid, d.noteId ?? undefined);
      previewRef.current.overrides.set(d.noteId!, { len });
      canvas.style.cursor = "ew-resize";
      schedulePaint();
    } else if (d.mode === "resizeL" && d.orig) {
      const grid = snapRef.current;
      const startStep = quantizeTo((x - GUTTER) / cw, grid);
      const end = d.orig.step + d.orig.len;
      const live = useFireSequencerStore.getState().notes;
      let minStart = 0;
      for (const n of live) {
        if (n.id === d.noteId || n.midi !== d.orig.midi) continue;
        if (n.step + n.len <= d.orig.step + 0.001) {
          minStart = Math.max(minStart, n.step + n.len);
        }
      }
      const clampedStart = Math.max(minStart, Math.min(startStep, end - grid));
      const len = snapLenTo(end - clampedStart, grid);
      previewRef.current.overrides.set(d.noteId!, { step: end - len, len });
      canvas.style.cursor = "ew-resize";
      schedulePaint();
    } else if (d.mode === "velocity" && d.orig) {
      const vel = clamp(d.orig.vel - dy / 100, 0.05, 1);
      previewRef.current.overrides.set(d.noteId!, { vel });
      schedulePaint();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (d.mode === "marquee") {
      const el = marqueeRef.current;
      if (el) el.style.opacity = "0";
      return;
    }

    if (d.mode === "placeStretch" || d.mode === "paint") {
      const ghosts = d.ghosts ?? previewRef.current.ghosts;
      clearPreview();
      if (ghosts.length > 0) {
        const ids = addNotes(
          ghosts.map(({ step, midi, len, vel, ch }) => ({ step, midi, len, vel, ch })),
        );
        if (ids.length > 0) setSelectedIds(new Set(ids));
        // Remember stretch length as the new brush default.
        if (d.mode === "placeStretch" && ghosts[0]) setBrush(ghosts[0].len);
      }
      lastAudMidiRef.current = null;
      schedulePaint();
      return;
    }

    if (
      (d.mode === "move" || d.mode === "resize" || d.mode === "resizeL" || d.mode === "velocity")
      && d.moved
    ) {
      const entries: Array<{ id: string } & Partial<Omit<RollNote, "id">>> = [];
      for (const [id, partial] of previewRef.current.overrides) {
        entries.push({ id, ...partial });
      }
      clearPreview();
      if (entries.length === 1) {
        const { id, ...partial } = entries[0];
        updateNote(id, partial);
        if (partial.len != null) setBrush(partial.len);
      } else if (entries.length > 1) {
        updateNotes(entries);
      }
      if (d.mode === "move" && d.noteId && d.orig) {
        const n = useFireSequencerStore.getState().notes.find((nn) => nn.id === d.noteId);
        if (n && n.midi !== d.orig.midi) audition(n.midi, n.vel, n.ch);
      }
    } else {
      clearPreview();
      schedulePaint();
    }
    lastAudMidiRef.current = null;
  };

  // ── velocity lane ──
  const VEL_H = 56;

  const velDraw = useCallback(() => {
    if (!velOpen) return;
    const canvas = velCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== gridW * dpr || canvas.height !== VEL_H * dpr) {
      canvas.width = gridW * dpr;
      canvas.height = VEL_H * dpr;
      canvas.style.width = `${gridW}px`;
      canvas.style.height = `${VEL_H}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gridW, VEL_H);
    ctx.fillStyle = "rgba(10,12,18,1)";
    ctx.fillRect(0, 0, gridW, VEL_H);

    for (let s = 0; s <= totalSteps; s++) {
      const x = GUTTER + s * CELL_W;
      ctx.fillStyle = s % STEPS_PER_BAR === 0
        ? "rgba(255,120,60,0.22)"
        : s % 4 === 0
          ? "rgba(255,255,255,0.07)"
          : "rgba(255,255,255,0.025)";
      ctx.fillRect(x, 0, 1, VEL_H);
    }

    const barW = Math.max(4, Math.min(CELL_W - 3, 9));
    for (const n of [...notes].sort((a, b) => a.step - b.step)) {
      const x = GUTTER + n.step * CELL_W + 1;
      const h = Math.max(2, n.vel * (VEL_H - 8));
      const y = VEL_H - 3 - h;
      const sel = selectedIds.has(n.id);
      const isB = n.ch === 1;
      const alpha = 0.35 + n.vel * 0.6;
      ctx.fillStyle = isB ? `rgba(98,182,255,${alpha})` : `rgba(255,120,60,${alpha})`;
      ctx.fillRect(x, y, barW, h);
      ctx.fillStyle = sel
        ? "rgba(255,235,190,0.95)"
        : isB
          ? "rgba(140,200,255,0.9)"
          : "rgba(255,170,110,0.9)";
      ctx.fillRect(x, y, barW, 2.5);
    }

    ctx.fillStyle = "rgba(8,6,10,0.96)";
    ctx.fillRect(0, 0, GUTTER, VEL_H);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "8.5px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.fillText("VEL", 6, VEL_H / 2);
    ctx.fillStyle = "rgba(255,120,60,0.5)";
    ctx.fillRect(GUTTER - 2, 0, 2, VEL_H);
  }, [velOpen, notes, selectedIds, gridW, totalSteps, CELL_W]);

  useEffect(() => { velDraw(); }, [velDraw]);

  const velHit = (x: number): RollNote | null => {
    const barW = Math.max(4, Math.min(CELL_W - 3, 9));
    let best: RollNote | null = null;
    let bestDist = Infinity;
    for (const n of notes) {
      const bx = GUTTER + n.step * CELL_W + 1;
      const center = bx + barW / 2;
      const dist = Math.abs(x - center);
      if (x >= bx - 3 && x <= bx + barW + 3 && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    return best;
  };

  const velPaint = (e: React.PointerEvent) => {
    const canvas = velCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * gridWRef.current;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * VEL_H;
    if (x < GUTTER) return;
    const hit = velHit(x);
    if (!hit) return;
    const vel = clamp(1 - (y - 3) / (VEL_H - 8), 0.05, 1);
    updateNote(hit.id, { vel });
  };

  const onVelPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    velPaintingRef.current = true;
    velPaint(e);
  };
  const onVelPointerMove = (e: React.PointerEvent) => {
    if (velPaintingRef.current) velPaint(e);
  };
  const onVelPointerUp = () => { velPaintingRef.current = false; };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      const ids = [...selectedIds];
      if (e.key === "Delete" || e.key === "Backspace") {
        removeNotes(ids);
        setSelectedIds(new Set());
      } else if (e.key === "Escape") {
        setSelectedIds(new Set());
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        const st = useFireSequencerStore.getState();
        const sel = st.notes.filter((n) => selectedIds.has(n.id));
        if (sel.length === 0) return;
        const start = Math.min(...sel.map((n) => n.step));
        const end = Math.max(...sel.map((n) => n.step + n.len));
        const span = Math.max(1, Math.ceil(end - start));
        const newIds = duplicateNotes(ids, span);
        if (newIds.length > 0) setSelectedIds(new Set(newIds));
        playUi("success");
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const semis = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1);
        transposeNotes(ids, semis);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const grid = snapRef.current;
        const delta = (e.key === "ArrowRight" ? 1 : -1) * grid;
        const st = useFireSequencerStore.getState();
        updateNotes(
          st.notes
            .filter((n) => selectedIds.has(n.id))
            .map((n) => ({ id: n.id, step: Math.max(0, n.step + delta) })),
        );
      } else if (e.key >= "1" && e.key <= "6" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const opt = SNAP_OPTIONS[Number(e.key) - 1];
        if (opt) setSnap(opt.steps);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, removeNotes, duplicateNotes, transposeNotes, updateNotes]);

  return (
    <div>
      <div
        className="mb-2 flex items-center gap-2 flex-wrap rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2"
        title="Draw: click places, drag stretches length, drag across pitches paints · edges resize · double-click / Alt-drag / RMB erase · Shift+drag velocity"
      >
        <div className="inline-flex rounded-lg border border-white/12 bg-black/30 p-0.5">
          {([
            ["draw", "Draw"],
            ["select", "Select"],
            ["erase", "Erase"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              className="px-2.5 py-1.5 text-[10px] font-bold rounded-md transition"
              style={
                tool === id
                  ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0" }
                  : { color: "rgba(255,255,255,0.4)" }
              }
              title={
                id === "draw"
                  ? "Place a note, drag to set length; drag across pitches to paint. Alt-drag erases."
                  : id === "select"
                    ? "Select / move — drag empty to marquee, click empty to deselect"
                    : "Erase — left-drag deletes (right-drag always erases)"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/12 bg-black/30 p-0.5">
          <span className="px-1.5 text-[9px] uppercase tracking-[0.12em] text-white/35">Snap</span>
          {SNAP_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setSnap(opt.steps)}
              className="min-w-[28px] h-7 px-1.5 rounded-md text-[10px] font-mono transition"
              style={
                snapSteps === opt.steps
                  ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0" }
                  : { color: "rgba(255,255,255,0.45)" }
              }
              title={`Snap grid + default note length: ${opt.label} note (keys 1–6)`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="uppercase tracking-[0.18em] text-white/40 text-[9px] font-semibold">Key</span>
        <select
          value={scaleRoot}
          onChange={(e) => setScaleRoot(Number(e.target.value))}
          className="bg-black/50 border border-white/12 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-cyan/50 h-8"
          title="Scale root note"
        >
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>{n}</option>
          ))}
        </select>
        <select
          value={scaleId}
          onChange={(e) => setScaleId(e.target.value as ScaleId)}
          className="bg-black/50 border border-white/12 rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-cyan/50 h-8"
          title="Scale — in-scale rows glow in the roll"
        >
          {SCALES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={() => setScaleSnap(!scaleSnap)}
          data-ui-sound="toggle"
          data-ui-on={scaleSnap ? "true" : "false"}
          disabled={scaleId === "off"}
          className={`h-8 px-2.5 rounded-lg border text-[10px] uppercase tracking-[0.12em] transition ${
            scaleId === "off"
              ? "border-white/8 text-white/25"
              : scaleSnap
                ? "border-[#efc53d]/40 bg-[#efc53d]/15 text-[#efc53d]"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
          }`}
          title="Snap vertical moves / transpose to the scale. Drawing always uses the exact key you click (including sharps)."
        >
          {scaleSnap ? "Snap on" : "Snap"}
        </button>
        <button
          onClick={() => {
            const hit = useFireSequencerStore.getState().detectAndApplyKey();
            playUi("press");
            useUIStore
              .getState()
              .toast(
                hit
                  ? `Detected ${NOTE_NAMES[hit.root]} ${SCALES.find((s) => s.id === hit.scaleId)?.label ?? ""} — scale set`
                  : "Not enough notes to call a key yet",
              );
          }}
          className="h-8 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-white/55 hover:text-cyan text-[10px] uppercase tracking-[0.12em] transition"
          title="Detect key from notes in the roll"
        >
          Detect key
        </button>
        <button
          onClick={() => {
            const moved = useFireSequencerStore.getState().conformNotesToScale();
            playUi("press");
            useUIStore
              .getState()
              .toast(
                scaleId === "off"
                  ? "Pick a scale first"
                  : moved > 0
                    ? `Conformed ${moved} note${moved === 1 ? "" : "s"} to the scale`
                    : "Already all in scale",
              );
          }}
          disabled={scaleId === "off"}
          className={`h-8 px-2.5 rounded-lg border text-[10px] uppercase tracking-[0.12em] transition ${
            scaleId === "off"
              ? "border-white/8 text-white/25"
              : "border-white/10 bg-white/[0.03] text-white/55 hover:text-[#efc53d]"
          }`}
          title="Move out-of-scale notes to nearest scale tone"
        >
          Conform
        </button>
        <button
          onClick={() => { humanizeNotes(); playUi("press"); }}
          className="h-8 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-white/55 hover:text-white/90 text-[10px] uppercase tracking-[0.12em] transition"
          title="Humanize velocity + micro-timing"
        >
          Humanize
        </button>
        {selectedIds.size > 0 && (
          <span className="text-[10px] text-cyan/80">
            {selectedIds.size} sel · Del · Ctrl+D · ↑↓ · ←→
          </span>
        )}
        {(selectedIds.size > 0 || playScope === "selection") && (
          <button
            onClick={() => {
              const st = useFireSequencerStore.getState();
              st.setPlayScope(st.playScope === "selection" ? "pattern" : "selection");
            }}
            className={`h-8 px-2.5 rounded-lg border text-[10px] uppercase tracking-[0.12em] transition ${
              playScope === "selection"
                ? "border-[#e8b86d]/60 bg-[#e8b86d]/15 text-[#f5d9a8]"
                : "border-white/10 bg-white/[0.03] text-white/55 hover:text-[#f5d9a8]"
            }`}
            title={
              playScope === "selection"
                ? "Open Fire loops the selected range — click to play the whole pattern"
                : "Loop only the selected notes' range with Open Fire"
            }
          >
            {playScope === "selection" ? "Looping sel" : "Loop sel"}
          </button>
        )}
        <span className="flex-1" />
        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5">
          <button
            onClick={() => bumpZoom(0.85)}
            disabled={fitMode}
            className="w-7 h-7 rounded-md border border-transparent text-white/60 hover:text-white hover:bg-white/8 text-[13px] leading-none transition disabled:opacity-30"
            title="Zoom out toward fit-to-width"
          >
            −
          </button>
          <button
            onClick={() => setZoom(1)}
            className={`h-7 px-2 rounded-md text-[9px] uppercase tracking-[0.14em] transition ${
              fitMode
                ? "bg-[#ff6a3d]/15 text-[#ffbfa0]"
                : "text-white/45 hover:text-white/80"
            }`}
            title="Fit pattern to the full width of the bay"
          >
            Fit
          </button>
          <button
            onClick={() => bumpZoom(1.18)}
            disabled={zoom >= ROLL_ZOOM_MAX}
            className="w-7 h-7 rounded-md border border-transparent text-white/60 hover:text-white hover:bg-white/8 text-[13px] leading-none transition disabled:opacity-30"
            title="Zoom in for detail (scroll horizontally)"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const v = velScrollRef.current;
          if (v) v.scrollLeft = e.currentTarget.scrollLeft;
        }}
        className={`relative rounded-2xl border border-white/12 bg-[#0a0c12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,106,61,0.06)] ${
          fitMode ? "overflow-y-auto overflow-x-hidden" : "overflow-auto"
        }`}
        style={{ height: rollH }}
      >
        <div className="relative" style={{ width: gridW, height: gridH }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={onContextMenu}
            className="block touch-none select-none"
            aria-label="Piano roll — Draw places and stretches, Select moves, Erase deletes"
          />
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 w-px pointer-events-none opacity-0"
            style={{
              background: "linear-gradient(180deg, rgba(255,220,150,0.9), rgba(255,110,50,0.65))",
              boxShadow: "0 0 8px rgba(255,140,60,0.8)",
              willChange: "transform",
            }}
          />
          <div
            ref={marqueeRef}
            className="absolute top-0 left-0 pointer-events-none opacity-0 rounded border border-cyan/60 bg-cyan/10"
            style={{ willChange: "transform, width, height" }}
          />
        </div>
      </div>

      <div className="mt-2">
        <button
          onClick={() => setVelOpen(!velOpen)}
          className="text-[10px] uppercase tracking-[0.22em] text-white/40 hover:text-white/70 transition"
          title="Velocity lane: each bar is a note's loudness — drag across to paint."
        >
          {velOpen ? "▾" : "▸"} Velocity
        </button>
        {velOpen && (
          <div
            ref={velScrollRef}
            className={`mt-1.5 rounded-xl border border-white/12 bg-[#0a0c12] ${
              fitMode ? "overflow-hidden" : "overflow-x-auto"
            }`}
          >
            <canvas
              ref={velCanvasRef}
              onPointerDown={onVelPointerDown}
              onPointerMove={onVelPointerMove}
              onPointerUp={onVelPointerUp}
              onPointerCancel={onVelPointerUp}
              onContextMenu={(ev) => ev.preventDefault()}
              className="block touch-none select-none cursor-ns-resize"
              aria-label="Velocity lane — drag over the bars to set note velocities"
            />
          </div>
        )}
      </div>

      <div
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          heightDrag.current = { startY: e.clientY, startH: rollH };
        }}
        onPointerMove={(e) => {
          const h = heightDrag.current;
          if (!h) return;
          setRollH(clamp(h.startH + (e.clientY - h.startY), HEIGHT_MIN, HEIGHT_MAX));
        }}
        onPointerUp={(e) => {
          heightDrag.current = null;
          try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        }}
        className="mt-1.5 h-3 rounded-full cursor-ns-resize flex items-center justify-center group touch-none"
        title="Drag to resize the piano roll"
      >
        <div className="w-20 h-1 rounded-full bg-white/15 group-hover:bg-[#ff6a3d]/55 transition" />
      </div>
    </div>
  );
}
