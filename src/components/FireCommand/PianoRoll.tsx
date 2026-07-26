/**
 * PianoRoll — FL-Studio-style editable piano roll for the Fire Command
 * sequencer, rendered on a single canvas for performance.
 *
 * Interactions:
 *   · click empty space        → add note (length = last drawn length)
 *   · drag note body           → move (pitch + time; moves the whole
 *                                selection when the note is selected)
 *   · drag note's right edge   → resize
 *   · right-click + drag       → ERASER — hold and sweep over notes
 *   · Shift+vertical drag      → velocity (note brightness shows velocity)
 *   · Ctrl+drag empty space    → marquee multi-select
 *   · Ctrl+wheel / ± buttons   → horizontal zoom
 *   · Ctrl+D                   → duplicate selection right after itself
 *   · ↑/↓ (Shift = octave)     → transpose selection (walks the scale)
 *   · ←/→                      → nudge selection in time
 *   · click the piano gutter   → audition that pitch
 *   · drag the bottom edge     → resize the roll itself
 *
 * SCALE ENGINE: pick a key + scale in the toolbar — in-scale rows glow, and
 * with Snap on every added/dragged note lands on the nearest scale tone.
 * You cannot draw a wrong note.
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

const ROW_H = 14;    // px per semitone row
const GUTTER = 46;   // piano key gutter width
const MIDI_TOP = 96; // C7
const MIDI_BOT = 24; // C1
const ROWS = MIDI_TOP - MIDI_BOT + 1;
const ZOOM_MIN = 12;
const ZOOM_MAX = 48;
const HEIGHT_MIN = 220;
const HEIGHT_MAX = 620;

const BLACK = new Set([1, 3, 6, 8, 10]);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type DragMode = "move" | "resize" | "velocity" | "marquee" | "erase";

interface DragSession {
  mode: DragMode;
  noteId: string | null;
  startX: number;
  startY: number;
  orig: RollNote | null;
  /** Original positions of every selected note for group moves. */
  groupOrig: Map<string, RollNote> | null;
  moved: boolean;
}

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
  // Velocity lane (v1.7): a discoverable strip under the roll.
  const velCanvasRef = useRef<HTMLCanvasElement>(null);
  const velScrollRef = useRef<HTMLDivElement>(null);
  const velPaintingRef = useRef(false);
  const [velOpen, setVelOpen] = useState(true);
  // Live audition while dragging a note across pitches (throttle by pitch).
  const lastAudMidiRef = useRef<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Horizontal zoom (px per 16th) + the roll's own height — both live-tweakable.
  const [cellW, setCellW] = useState(26);
  const [rollH, setRollH] = useState(320);
  const heightDrag = useRef<{ startY: number; startH: number } | null>(null);

  const CELL_W = cellW;
  const totalSteps = bars * STEPS_PER_BAR;
  const gridW = GUTTER + totalSteps * CELL_W;
  const gridH = ROWS * ROW_H;

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

    // Row stripes (+ scale tint: in-scale rows glow, the root glows most)
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
      // resize grip
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x + w - 3, y + 2, 2, h - 4);
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
  }, [notes, selectedIds, totalSteps, gridW, gridH, scaleRoot, scaleId]);

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
  }, [playing, bpm, bars, cellW]);

  // Ctrl+wheel zooms horizontally around the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setCellW((w) => clamp(Math.round(w * (e.deltaY > 0 ? 0.85 : 1.18)), ZOOM_MIN, ZOOM_MAX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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

  const hitNote = (x: number, y: number): { note: RollNote; zone: "body" | "edge" } | null => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const nx = GUTTER + n.step * CELL_W;
      const ny = (MIDI_TOP - n.midi) * ROW_H;
      const nw = Math.max(5, n.len * CELL_W);
      if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_H) {
        return { note: n, zone: x > nx + nw - 7 ? "edge" : "body" };
      }
    }
    return null;
  };

  const audition = (midi: number, vel = 0.85, ch = activeChannel) => {
    auditionNote(midi, vel, ch);
  };

  // ── pointer interactions ──
  const onPointerDown = (e: React.PointerEvent) => {
    // Right button = the ERASER: delete on contact, keep deleting while held.
    if (e.button === 2) {
      const { x, y } = posFromEvent(e);
      if (x < GUTTER) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "erase", noteId: null, startX: x, startY: y,
        orig: null, groupOrig: null, moved: false,
      };
      const hit = hitNote(x, y);
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
    const { x, y, step, midi } = posFromEvent(e);

    if (x < GUTTER) { audition(midi); return; }
    if (midi < MIDI_BOT || midi > MIDI_TOP || step < 0) return;

    const hit = hitNote(x, y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // Ctrl+drag on empty space: marquee multi-select.
    if (!hit && (e.ctrlKey || e.metaKey)) {
      dragRef.current = {
        mode: "marquee", noteId: null, startX: x, startY: y,
        orig: null, groupOrig: null, moved: false,
      };
      return;
    }

    if (hit) {
      const inSelection = selectedIds.has(hit.note.id);
      let sel: ReadonlySet<string>;
      if (e.ctrlKey || e.metaKey) {
        // Toggle membership.
        const next = new Set(selectedIds);
        if (inSelection) next.delete(hit.note.id);
        else next.add(hit.note.id);
        sel = next;
        setSelectedIds(next);
      } else if (inSelection) {
        sel = selectedIds; // keep the group — this drag moves all of it
      } else {
        sel = new Set([hit.note.id]);
        setSelectedIds(sel);
      }
      const groupOrig =
        sel.size > 1 && sel.has(hit.note.id)
          ? new Map(notes.filter((n) => sel.has(n.id)).map((n) => [n.id, { ...n }]))
          : null;
      dragRef.current = {
        mode: e.shiftKey ? "velocity" : hit.zone === "edge" ? "resize" : "move",
        noteId: hit.note.id,
        startX: x, startY: y,
        orig: { ...hit.note },
        groupOrig,
        moved: false,
      };
    } else {
      const snapped = Math.floor(step);
      const pitch = snapPitch(midi);
      const id = addNote({ step: snapped, midi: pitch, len: lastLenRef.current, vel: 0.85, ch: activeChannel });
      setSelectedIds(new Set([id]));
      audition(pitch);
      dragRef.current = {
        mode: "resize",
        noteId: id,
        startX: x, startY: y,
        orig: { id, step: snapped, midi: pitch, len: lastLenRef.current, vel: 0.85, ch: activeChannel },
        groupOrig: null,
        moved: false,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const d = dragRef.current;
    if (!canvas) return;

    if (!d) {
      // cursor affordances
      const { x, y } = posFromEvent(e);
      const hit = x >= GUTTER ? hitNote(x, y) : null;
      canvas.style.cursor = x < GUTTER
        ? "pointer"
        : hit
          ? (hit.zone === "edge" ? "ew-resize" : "grab")
          : e.ctrlKey || e.metaKey
            ? "crosshair"
            : "cell";
      return;
    }

    const { x, y } = posFromEvent(e);
    const dx = x - d.startX;
    const dy = y - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;

    if (d.mode === "erase") {
      const hit = x >= GUTTER ? hitNote(x, y) : null;
      if (hit) removeNote(hit.note.id);
      canvas.style.cursor = "not-allowed";
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
      // Live-select covered notes.
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
        // Group move: every selected note shifts by the same delta.
        const entries = [...d.groupOrig.values()].map((o) => ({
          id: o.id,
          step: Math.max(0, o.step + dSteps),
          midi: clamp(snapPitch(o.midi + dSemis), MIDI_BOT, MIDI_TOP),
        }));
        updateNotes(entries);
      } else {
        const newMidi = clamp(snapPitch(d.orig.midi + dSemis), MIDI_BOT, MIDI_TOP);
        updateNote(d.noteId!, { step: Math.max(0, d.orig.step + dSteps), midi: newMidi });
        // Hear the pitch as you drag (fires once per row crossed).
        if (newMidi !== d.orig.midi && newMidi !== lastAudMidiRef.current) {
          lastAudMidiRef.current = newMidi;
          audition(newMidi, d.orig.vel, d.orig.ch);
        }
      }
    } else if (d.mode === "resize" && d.orig) {
      const endStep = (x - GUTTER) / CELL_W;
      const rawLen = endStep - d.orig.step;
      const len = Math.max(0.25, Math.round(rawLen * 2) / 2); // snap to half-steps
      updateNote(d.noteId!, { len });
      lastLenRef.current = len;
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
      return;
    }
    lastAudMidiRef.current = null;
    if (d.mode === "move" && d.moved && d.noteId && d.groupOrig) {
      // Group drags stay silent during the move — confirm the landing pitch.
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
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault();

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
      {/* ── Scale + tools bar (compact) ── */}
      <div
        className="mb-1 flex items-center gap-1 flex-wrap text-[11px]"
        title="Click draw · drag move · edge resize · right-drag erase · Shift+drag velocity · Ctrl+wheel zoom · orange=A · blue=B"
      >
        <span className="uppercase tracking-[0.16em] text-dim text-[9px]">Key</span>
        <select
          value={scaleRoot}
          onChange={(e) => setScaleRoot(Number(e.target.value))}
          className="bg-black/50 border border-white/10 rounded-md px-1 py-0.5 text-[10px] font-mono outline-none focus:border-cyan/50 h-6"
          title="Scale root note"
        >
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>{n}</option>
          ))}
        </select>
        <select
          value={scaleId}
          onChange={(e) => setScaleId(e.target.value as ScaleId)}
          className="bg-black/50 border border-white/10 rounded-md px-1 py-0.5 text-[10px] outline-none focus:border-cyan/50 h-6"
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
          className={`h-6 px-1.5 rounded-md border text-[9px] uppercase tracking-[0.1em] transition ${
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
          className="h-6 px-1.5 rounded-md border border-white/10 bg-white/[0.03] text-white/55 hover:text-cyan text-[9px] uppercase tracking-[0.1em] transition"
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
          className={`h-6 px-1.5 rounded-md border text-[9px] uppercase tracking-[0.1em] transition ${
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
          className="h-6 px-1.5 rounded-md border border-white/10 bg-white/[0.03] text-white/55 hover:text-white/90 text-[9px] uppercase tracking-[0.1em] transition"
          title="Humanize velocity + micro-timing"
        >
          Humanize
        </button>
        {selectedIds.size > 0 && (
          <span className="text-[9px] text-cyan/80">
            {selectedIds.size} sel · Ctrl+D · ↑↓ · ←→
          </span>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCellW((w) => clamp(w - 5, ZOOM_MIN, ZOOM_MAX))}
            className="w-5 h-5 rounded border border-white/10 bg-white/[0.03] text-white/60 hover:text-white text-[11px] leading-none transition"
            title="Zoom out (Ctrl+wheel)"
          >
            −
          </button>
          <button
            onClick={() => setCellW((w) => clamp(w + 5, ZOOM_MIN, ZOOM_MAX))}
            className="w-5 h-5 rounded border border-white/10 bg-white/[0.03] text-white/60 hover:text-white text-[11px] leading-none transition"
            title="Zoom in (Ctrl+wheel)"
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
        className="relative overflow-auto rounded-xl border border-white/10 bg-black/45"
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
            aria-label="Piano roll — click to add notes, drag to move, Ctrl+drag to multi-select, right-click-drag to erase"
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
      <div className="mt-1">
        <button
          onClick={() => setVelOpen(!velOpen)}
          className="text-[10px] uppercase tracking-[0.25em] text-dim hover:text-white/70 transition"
          title="Velocity lane: each bar is a note's loudness — drag across to paint. (Shift+drag on a note still works.)"
        >
          {velOpen ? "▾" : "▸"} Velocity
        </button>
        {velOpen && (
          <div
            ref={velScrollRef}
            className="mt-1 overflow-hidden rounded-xl border border-white/10 bg-black/45"
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
          setRollH(clamp(h.startH + (e.clientY - h.startY), HEIGHT_MIN, HEIGHT_MAX));
        }}
        onPointerUp={(e) => {
          heightDrag.current = null;
          try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        }}
        className="mt-1 h-2.5 rounded-full cursor-ns-resize flex items-center justify-center group touch-none"
        title="Drag to resize the piano roll"
      >
        <div className="w-16 h-1 rounded-full bg-white/15 group-hover:bg-cyan/50 transition" />
      </div>
    </div>
  );
}
