/**
 * PianoRoll — FL-Studio-style editable piano roll for the Fire Command
 * sequencer, rendered on a single canvas for performance.
 *
 * Tools (toolbar):
 *   · Draw   — LMB paints notes (drag across cells); note body moves; edges resize
 *   · Select — LMB marquee / move; empty click deselects (never creates notes)
 *   · Erase  — LMB sweeps delete (RMB always erases in any tool)
 *
 * Also:
 *   · left OR right edge drag  → resize
 *   · Shift+vertical drag      → velocity
 *   · Ctrl+wheel / ± buttons   → horizontal zoom
 *   · Ctrl+D / ↑↓ / ←→ / Del   → duplicate / transpose / nudge / delete
 *   · brush length chips       → length of newly painted notes
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

const ROW_H = 14;    // px per semitone row
const GUTTER = PIANO_GUTTER;   // piano key gutter width
const MIDI_TOP = 96; // C7
const MIDI_BOT = 24; // C1
const ROWS = MIDI_TOP - MIDI_BOT + 1;
const HEIGHT_MIN = 220;
const HEIGHT_MAX = 620;

const BLACK = new Set([1, 3, 6, 8, 10]);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Tool = "draw" | "select" | "erase";
type DragMode = "move" | "resize" | "resizeL" | "velocity" | "marquee" | "erase" | "paint";
type HitZone = "body" | "left" | "right";

interface DragSession {
  mode: DragMode;
  noteId: string | null;
  startX: number;
  startY: number;
  orig: RollNote | null;
  /** Original positions of every selected note for group moves. */
  groupOrig: Map<string, RollNote> | null;
  moved: boolean;
  /** Cells already painted this stroke (`step:midi`). */
  painted?: Set<string>;
}

const EDGE_PX = 10;
const BRUSH_LENS = [0.5, 1, 2, 4] as const;

export function PianoRoll() {
  const notes = useFireSequencerStore((s) => s.notes);
  const bars = useFireSequencerStore((s) => s.bars);
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const activeChannel = useFireSequencerStore((s) => s.activeChannel);
  const scaleRoot = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const scaleSnap = useFireSequencerStore((s) => s.scaleSnap);
  const addNote = useFireSequencerStore((s) => s.addNote);
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
  const lastLenRef = useRef(2);
  const [brushLen, setBrushLen] = useState(2);
  const [tool, setTool] = useState<Tool>("draw");
  // Velocity lane (v1.7): a discoverable strip under the roll.
  const velCanvasRef = useRef<HTMLCanvasElement>(null);
  const velScrollRef = useRef<HTMLDivElement>(null);
  const velPaintingRef = useRef(false);
  const [velOpen, setVelOpen] = useState(true);
  // Live audition while dragging a note across pitches (throttle by pitch).
  const lastAudMidiRef = useRef<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Fit-to-width zoom (1 = fill the bay) + the roll's own height.
  const { cellW: CELL_W, gridW, zoom, bumpZoom, setZoom, fitMode } = useRollFit();
  const [rollH, setRollH] = useState(360);
  const heightDrag = useRef<{ startY: number; startH: number } | null>(null);

  const totalSteps = bars * STEPS_PER_BAR;
  const gridH = ROWS * ROW_H;

  const setBrush = (len: number) => {
    lastLenRef.current = len;
    setBrushLen(len);
  };

  const snapPitch = useCallback(
    (midi: number) => (scaleSnap ? snapMidiToScale(midi, scaleRoot, scaleId) : midi),
    [scaleSnap, scaleRoot, scaleId],
  );

  // ── initial scroll: center around A3–C5 (the seeded riff) ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetRow = MIDI_TOP - 66; // F#4-ish
    el.scrollTop = Math.max(0, targetRow * ROW_H - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── canvas rendering (only on data change, never during playback) ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== gridW * dpr || canvas.height !== gridH * dpr) {
      canvas.width = gridW * dpr;
      canvas.height = gridH * dpr;
      canvas.style.width = `${gridW}px`;
      canvas.style.height = `${gridH}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gridW, gridH);

    // Stage plate — fills the whole bay so there's never a dead black void
    const plate = ctx.createLinearGradient(0, 0, 0, gridH);
    plate.addColorStop(0, "rgba(14,16,22,1)");
    plate.addColorStop(0.5, "rgba(10,12,18,1)");
    plate.addColorStop(1, "rgba(8,9,14,1)");
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, gridW, gridH);
    const scaleOn = scaleId !== "off";
    for (let r = 0; r < ROWS; r++) {
      const midi = MIDI_TOP - r;
      const pc = midi % 12;
      ctx.fillStyle = BLACK.has(pc) ? "rgba(0,0,0,0.34)" : "rgba(255,255,255,0.024)";
      ctx.fillRect(GUTTER, r * ROW_H, gridW - GUTTER, ROW_H);
      if (scaleOn && inScale(midi, scaleRoot, scaleId)) {
        const isRoot = ((midi - scaleRoot) % 12 + 12) % 12 === 0;
        ctx.fillStyle = isRoot ? "rgba(255,150,70,0.10)" : "rgba(120,220,170,0.05)";
        ctx.fillRect(GUTTER, r * ROW_H, gridW - GUTTER, ROW_H);
      }
      if (pc === 0) {
        // C row separator — orient the user
        ctx.fillStyle = "rgba(255,140,80,0.12)";
        ctx.fillRect(GUTTER, r * ROW_H + ROW_H - 1, gridW - GUTTER, 1);
      }
    }

    // Vertical grid lines
    for (let s = 0; s <= totalSteps; s++) {
      const x = GUTTER + s * CELL_W;
      const isBar = s % STEPS_PER_BAR === 0;
      const isBeat = s % 4 === 0;
      ctx.fillStyle = isBar
        ? "rgba(255,120,60,0.28)"
        : isBeat
          ? "rgba(255,255,255,0.10)"
          : "rgba(255,255,255,0.035)";
      ctx.fillRect(x, 0, 1, gridH);
    }

    // Notes — colored by instrument channel: A = fire orange, B = ice blue.
    for (const n of notes) {
      const x = GUTTER + n.step * CELL_W + 1;
      const y = (MIDI_TOP - n.midi) * ROW_H + 1.5;
      const w = Math.max(5, n.len * CELL_W - 2);
      const h = ROW_H - 3;
      const sel = selectedIds.has(n.id);
      const alpha = 0.4 + n.vel * 0.55;
      const isB = n.ch === 1;
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, isB ? `rgba(98,182,255,${alpha})` : `rgba(255,140,66,${alpha})`);
      grad.addColorStop(1, isB ? `rgba(52,120,224,${alpha})` : `rgba(255,84,38,${alpha})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();
      ctx.strokeStyle = sel
        ? "rgba(255,235,190,0.95)"
        : isB
          ? "rgba(140,200,255,0.55)"
          : "rgba(255,170,110,0.5)";
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.stroke();
      if (sel) {
        ctx.shadowColor = "rgba(255,220,160,0.8)";
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // resize grips (left + right)
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x + w - 3, y + 2, 2, h - 4);
      if (sel && w > 14) ctx.fillRect(x + 1, y + 2, 2, h - 4);
    }

    // Piano gutter (drawn last, sits above notes when scrolling horizontally)
    ctx.fillStyle = "rgba(8,6,10,0.96)";
    ctx.fillRect(0, 0, GUTTER, gridH);
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
    ctx.fillRect(GUTTER - 2, 0, 2, gridH);
  }, [notes, selectedIds, totalSteps, gridW, gridH, CELL_W, scaleRoot, scaleId]);

  useEffect(() => { draw(); }, [draw]);

  // ── playhead (RAF only while playing; DOM transform, no canvas repaint) ──
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
      // -1 = song mode is sounding a DIFFERENT section — hide the head.
      el.style.opacity = step < 0 ? "0" : "1";
      el.style.transform = `translateX(${GUTTER + Math.max(0, step) * CELL_W}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, bpm, bars, CELL_W]);

  // Ctrl+wheel zooms horizontally (fit = 1×; zoom in for detail + scroll).
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

  // ── hit-testing helpers ──
  const posFromEvent = (e: React.PointerEvent): { x: number; y: number; step: number; midi: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      x, y,
      step: (x - GUTTER) / CELL_W,
      midi: MIDI_TOP - Math.floor(y / ROW_H),
    };
  };

  const hitNote = (x: number, y: number, fat = false): { note: RollNote; zone: HitZone } | null => {
    const padY = fat ? 4 : 0;
    const padX = fat ? 3 : 0;
    const edge = Math.max(EDGE_PX, CELL_W * 0.35);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const nx = GUTTER + n.step * CELL_W;
      const ny = (MIDI_TOP - n.midi) * ROW_H;
      const nw = Math.max(5, n.len * CELL_W);
      if (
        x >= nx - padX && x <= nx + nw + padX
        && y >= ny - padY && y <= ny + ROW_H + padY
      ) {
        let zone: HitZone = "body";
        if (nw > edge * 2) {
          if (x <= nx + edge) zone = "left";
          else if (x >= nx + nw - edge) zone = "right";
        } else if (x >= nx + nw - Math.max(5, edge * 0.6)) {
          zone = "right";
        }
        return { note: n, zone };
      }
    }
    return null;
  };

  const paintCell = (step: number, midi: number, painted: Set<string>) => {
    const snapped = Math.floor(step);
    const pitch = snapPitch(midi);
    if (snapped < 0 || snapped >= totalSteps) return;
    if (pitch < MIDI_BOT || pitch > MIDI_TOP) return;
    const key = `${snapped}:${pitch}`;
    if (painted.has(key)) return;
    const liveNotes = useFireSequencerStore.getState().notes;
    const exists = liveNotes.some(
      (n) => n.midi === pitch && snapped >= Math.floor(n.step) && snapped < n.step + n.len,
    );
    if (exists) {
      painted.add(key);
      return;
    }
    painted.add(key);
    const id = addNote({
      step: snapped,
      midi: pitch,
      len: lastLenRef.current,
      vel: 0.85,
      ch: activeChannel,
    });
    setSelectedIds(new Set([id]));
    if (pitch !== lastAudMidiRef.current) {
      lastAudMidiRef.current = pitch;
      auditionNote(pitch, 0.85, activeChannel);
    }
  };

  const audition = (midi: number, vel = 0.85, ch = activeChannel) => {
    auditionNote(midi, vel, ch);
  };

  // ── pointer interactions ──
  const onPointerDown = (e: React.PointerEvent) => {
    // Right button OR erase tool = the ERASER.
    const erasing = e.button === 2 || (e.button === 0 && tool === "erase");
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

    // Select tool OR Ctrl/Cmd: marquee on empty.
    if (!hit && (tool === "select" || e.ctrlKey || e.metaKey)) {
      dragRef.current = {
        mode: "marquee", noteId: null, startX: x, startY: y,
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
      const groupOrig =
        sel.size > 1 && sel.has(hit.note.id)
          ? new Map(notes.filter((n) => sel.has(n.id)).map((n) => [n.id, { ...n }]))
          : null;
      const mode: DragMode = e.shiftKey
        ? "velocity"
        : hit.zone === "right"
          ? "resize"
          : hit.zone === "left"
            ? "resizeL"
            : "move";
      dragRef.current = {
        mode,
        noteId: hit.note.id,
        startX: x, startY: y,
        orig: { ...hit.note },
        groupOrig,
        moved: false,
      };
    } else if (tool === "draw") {
      const painted = new Set<string>();
      paintCell(step, midi, painted);
      dragRef.current = {
        mode: "paint",
        noteId: null,
        startX: x, startY: y,
        orig: null,
        groupOrig: null,
        moved: false,
        painted,
      };
    } else {
      // Select tool empty click — deselect (confirm on pointer up if no drag).
      dragRef.current = {
        mode: "marquee", noteId: null, startX: x, startY: y,
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
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;

    if (d.mode === "erase") {
      const hit = x >= GUTTER ? hitNote(x, y, true) : null;
      if (hit) removeNote(hit.note.id);
      canvas.style.cursor = "not-allowed";
      return;
    }

    if (d.mode === "paint") {
      paintCell(step, midi, d.painted ?? new Set());
      canvas.style.cursor = "cell";
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
      const covered = new Set<string>();
      for (const n of notes) {
        const nx = GUTTER + n.step * CELL_W;
        const ny = (MIDI_TOP - n.midi) * ROW_H;
        const nw = Math.max(5, n.len * CELL_W);
        if (nx < x1 && nx + nw > x0 && ny < y1 && ny + ROW_H > y0) covered.add(n.id);
      }
      setSelectedIds(covered);
      return;
    }

    if (d.mode === "move" && d.orig) {
      const dSteps = Math.round(dx / CELL_W);
      const dSemis = -Math.round(dy / ROW_H);
      if (d.groupOrig) {
        const entries = [...d.groupOrig.values()].map((o) => ({
          id: o.id,
          step: Math.max(0, o.step + dSteps),
          midi: clamp(snapPitch(o.midi + dSemis), MIDI_BOT, MIDI_TOP),
        }));
        updateNotes(entries);
      } else {
        const newMidi = clamp(snapPitch(d.orig.midi + dSemis), MIDI_BOT, MIDI_TOP);
        updateNote(d.noteId!, { step: Math.max(0, d.orig.step + dSteps), midi: newMidi });
        if (newMidi !== d.orig.midi && newMidi !== lastAudMidiRef.current) {
          lastAudMidiRef.current = newMidi;
          audition(newMidi, d.orig.vel, d.orig.ch);
        }
      }
    } else if (d.mode === "resize" && d.orig) {
      const endStep = (x - GUTTER) / CELL_W;
      const rawLen = endStep - d.orig.step;
      const len = Math.max(0.25, Math.round(rawLen * 2) / 2);
      updateNote(d.noteId!, { len });
      setBrush(len);
    } else if (d.mode === "resizeL" && d.orig) {
      const startStep = Math.max(0, Math.round(((x - GUTTER) / CELL_W) * 2) / 2);
      const end = d.orig.step + d.orig.len;
      const len = Math.max(0.25, Math.round((end - startStep) * 2) / 2);
      updateNote(d.noteId!, { step: end - len, len });
      setBrush(len);
    } else if (d.orig) {
      const vel = clamp(d.orig.vel - dy / 120, 0.05, 1);
      updateNote(d.noteId!, { vel });
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
      // Empty click with no drag → already cleared on down.
      return;
    }
    lastAudMidiRef.current = null;
    if (d.mode === "move" && d.moved && d.noteId && d.groupOrig) {
      const n = useFireSequencerStore.getState().notes.find((nn) => nn.id === d.noteId);
      if (n && d.orig && n.midi !== d.orig.midi) audition(n.midi, n.vel, n.ch);
    }
  };

  // ── velocity lane (v1.7) ──
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

    // grid
    for (let s = 0; s <= totalSteps; s++) {
      const x = GUTTER + s * CELL_W;
      ctx.fillStyle = s % STEPS_PER_BAR === 0
        ? "rgba(255,120,60,0.22)"
        : s % 4 === 0
          ? "rgba(255,255,255,0.07)"
          : "rgba(255,255,255,0.025)";
      ctx.fillRect(x, 0, 1, VEL_H);
    }

    // one stem+cap per note, colored by channel, brightness = velocity
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

    // gutter label
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
    const rect = velCanvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
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

  // Deletion happens in the pointer handlers (eraser drag) — just keep the
  // browser menu out of the way.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Keyboard: delete / duplicate / transpose / nudge / escape.
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
        const d = e.key === "ArrowRight" ? 1 : -1;
        const st = useFireSequencerStore.getState();
        updateNotes(
          st.notes
            .filter((n) => selectedIds.has(n.id))
            .map((n) => ({ id: n.id, step: Math.max(0, n.step + d) })),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, removeNotes, duplicateNotes, transposeNotes, updateNotes]);

  return (
    <div>
      {/* ── Scale + tools bar ── */}
      <div
        className="mb-2 flex items-center gap-2 flex-wrap rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2"
        title="Draw paints notes · Select marquee/moves · Erase deletes · edges resize · Shift+drag velocity · Ctrl+wheel zoom"
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
                  ? "Paint notes — click or drag across the grid"
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
          <span className="px-1.5 text-[9px] uppercase tracking-[0.12em] text-white/35">Len</span>
          {BRUSH_LENS.map((len) => (
            <button
              key={len}
              type="button"
              onClick={() => setBrush(len)}
              className="min-w-[28px] h-7 px-1.5 rounded-md text-[10px] font-mono transition"
              style={
                brushLen === len
                  ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0" }
                  : { color: "rgba(255,255,255,0.45)" }
              }
              title={`Brush length ${len} step${len === 1 ? "" : "s"}`}
            >
              {len}
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
                ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
          }`}
          title="Snap drawn + dragged notes to the scale"
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
          Detect
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
              : "border-white/10 bg-white/[0.03] text-white/55 hover:text-emerald-300"
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
            {selectedIds.size} sel · Del · Ctrl+D · ↑↓ · ←→ · Shift+drag vel
          </span>
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
          // Velocity lane tracks the roll's horizontal scroll 1:1.
          const v = velScrollRef.current;
          if (v) v.scrollLeft = e.currentTarget.scrollLeft;
        }}
        className={`relative rounded-2xl border border-white/12 bg-[#0a0c12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,106,61,0.06)] ${
          fitMode ? "overflow-y-auto overflow-x-hidden" : "overflow-auto"
        }`}
        style={{ height: rollH }}
      >
        <div className="relative" style={{ width: gridW, height: gridH, minWidth: "100%" }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={onContextMenu}
            className="block touch-none select-none"
            aria-label="Piano roll — Draw paints, Select moves/marquees, Erase deletes, edges resize"
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

      {/* Velocity lane (v1.7): one bar per note — drag to paint loudness. */}
      <div className="mt-2">
        <button
          onClick={() => setVelOpen(!velOpen)}
          className="text-[10px] uppercase tracking-[0.22em] text-white/40 hover:text-white/70 transition"
          title="Velocity lane: each bar is a note's loudness — drag across to paint. (Shift+drag on a note still works.)"
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
              onContextMenu={(e) => e.preventDefault()}
              className="block touch-none select-none cursor-ns-resize"
              aria-label="Velocity lane — drag over the bars to set note velocities"
            />
          </div>
        )}
      </div>

      {/* Grab-handle: drag to resize the roll vertically. */}
      <div
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          heightDrag.current = { startY: e.clientY, startH: rollH };
        }}
        onPointerMove={(e) => {
          const h = heightDrag.current;
          if (!h) return;
          setRollH(clamp(h.startH + (e.clientY - h.startH), HEIGHT_MIN, HEIGHT_MAX));
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
