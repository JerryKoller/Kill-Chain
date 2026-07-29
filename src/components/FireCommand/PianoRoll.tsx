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
  detectKeyFromNotes,
  STEPS_PER_BAR,
  SCALES,
  NOTE_NAMES,
  type RollNote,
  type ScaleId,
} from "@/state/fireSequencerStore";
import { playUi } from "@/audio/uiSounds";
import { useUIStore } from "@/state/uiStore";
import { useRollFit, ROLL_ZOOM_MAX, ROLL_ZOOM_MIN, setRollHScroll, subscribeRollHScroll } from "./useRollFit";
import { PatternBarsControls } from "./PatternBarsControls";
import { ScopedPlayButton } from "./ScopedPlayButton";
import { PatternSelect } from "./PatternSelect";
import { EditorToolbarGroup, EditorToolbarDivider } from "./EditorShell";

export const PIANO_GUTTER = 46;

const ROW_H = 16;    // px per semitone — taller = easier to hit
const GUTTER = PIANO_GUTTER;
const MIDI_TOP = 96; // C7
const MIDI_BOT = 24; // C1
const ROWS = MIDI_TOP - MIDI_BOT + 1;
const HEIGHT_MIN = 220;
const HEIGHT_MAX = 900;

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
  /** Note ids erased this stroke — committed once on pointer up. */
  erased?: Set<string>;
  /** Grab offset in steps from note edge (resize) so the edge doesn't jump to the cursor. */
  grabOffsetSteps?: number;
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
  { label: "T", steps: 2 / 3 },
  { label: "Off", steps: 0 },
  { label: "Auto", steps: -1 },
] as const;

const SNAP_STORAGE = "killchain.fire.rollSnap";
const KICK_GHOST_MIDI = 36;

type FoldMode = "all" | "scale" | "used";
type VelTool = "pencil" | "line" | "ramp" | "randomize" | "compress" | "accents" | "humanize";

/** RollNote with optional clarity fields (future / extended saves). */
type RollNoteExt = RollNote & {
  probability?: number;
  prob?: number;
  micro?: number;
  ratchet?: number;
};

function resolveRollSnap(snap: number, cellW: number): number {
  if (snap > 0) return snap;
  if (snap === -1) {
    const pxPerBar = cellW * STEPS_PER_BAR;
    if (pxPerBar < 36) return 16;
    if (pxPerBar < 56) return 8;
    if (pxPerBar < 90) return 4;
    if (pxPerBar < 140) return 2;
    return 1;
  }
  return 0; // Off — free placement
}

function buildConformPreview(
  notes: RollNote[],
  root: number,
  scaleId: ScaleId,
): Map<string, number> {
  const map = new Map<string, number>();
  if (scaleId === "off") return map;
  for (const n of notes) {
    const midi = snapMidiToScale(n.midi, root, scaleId);
    if (midi !== n.midi) map.set(n.id, midi);
  }
  return map;
}

function detectKeyAlternatives(notes: RollNote[]): Array<{ root: number; scaleId: ScaleId; confidence: number }> {
  if (notes.length < 3) return [];
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[((n.midi % 12) + 12) % 12] += Math.max(0.25, n.len) * n.vel;
  if (hist.every((v) => v === 0)) return [];
  const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const correlate = (a: number[], b: number[]) => {
    const ma = a.reduce((s, v) => s + v, 0) / 12;
    const mb = b.reduce((s, v) => s + v, 0) / 12;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / Math.sqrt(da * db || 1);
  };
  const hits: Array<{ root: number; scaleId: ScaleId; confidence: number }> = [];
  for (let root = 0; root < 12; root++) {
    const rotated = hist.map((_, i) => hist[(i + root) % 12]);
    hits.push({ root, scaleId: "major", confidence: correlate(rotated, KRUMHANSL_MAJOR) });
    hits.push({ root, scaleId: "minor", confidence: correlate(rotated, KRUMHANSL_MINOR) });
  }
  hits.sort((a, b) => b.confidence - a.confidence);
  const out: typeof hits = [];
  for (const h of hits) {
    if (out.some((o) => o.root === h.root && o.scaleId === h.scaleId)) continue;
    out.push(h);
    if (out.length >= 3) break;
  }
  return out;
}
const MOVE_THRESHOLD_PX = 6;
/** Need a clearer pitch slip before place-stretch flips into paint. */
const PLACE_TO_PAINT_SEMIS = 3;
/** Marquee must grow past this before it replaces the selection. */
const MARQUEE_MIN_PX = 5;

function edgePx(noteW: number, selectTool = false): number {
  // Select tool: tiny grips so clicks land on the body (less accidental resize).
  if (selectTool) return Math.max(5, Math.min(noteW * 0.12, 9));
  // Keep grips small so the note body stays easy to grab/move (FL-like).
  return Math.max(8, Math.min(noteW * 0.22, 14));
}

function quantizeTo(raw: number, grid: number): number {
  if (grid <= 0) return raw;
  return Math.round(raw / grid) * grid;
}

function snapLenTo(raw: number, grid: number): number {
  if (grid <= 0) return Math.max(0.25, raw);
  return Math.max(grid, quantizeTo(raw, grid));
}

function readStoredSnap(): number {
  try {
    const v = Number(window.localStorage.getItem(SNAP_STORAGE));
    // Migrate old "Off" sentinel (0.25) → true Off (0)
    if (v === 0.25) return 0;
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

export function PianoRoll({ tall = false }: { tall?: boolean } = {}) {
  const notes = useFireSequencerStore((s) => s.notes);
  const drums = useFireSequencerStore((s) => s.drums);
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
  /** Last pointer client coords — drives edge auto-scroll while marquee/move is held. */
  const lastPtrRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const autoScrollRafRef = useRef(0);
  const previewRef = useRef<PreviewState>({
    overrides: new Map(),
    ghosts: [],
    hoverId: null,
  });
  const rafPaintRef = useRef(0);
  const [snapSteps, setSnapStepsState] = useState(readStoredSnap);
  const snapRef = useRef(snapSteps);
  const lastLenRef = useRef(snapSteps);
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const [brushLen, setBrushLen] = useState(() => resolveRollSnap(readStoredSnap(), 12));
  const [tool, setTool] = useState<Tool>("draw");
  const [foldMode, setFoldMode] = useState<FoldMode>("all");
  const [wideKeys, setWideKeys] = useState(false);
  const [conformPreview, setConformPreview] = useState<Map<string, number> | null>(null);
  const velCanvasRef = useRef<HTMLCanvasElement>(null);
  const velScrollRef = useRef<HTMLDivElement>(null);
  const velPlayheadRef = useRef<HTMLDivElement>(null);
  const velPaintingRef = useRef(false);
  const velStrokeRef = useRef<{ x: number; y: number; vel: number } | null>(null);
  const velPendingRef = useRef<Map<string, number>>(new Map());
  const [velOpen, setVelOpen] = useState(true);
  const [velH, setVelH] = useState(56);
  const velHRef = useRef(velH);
  velHRef.current = velH;
  const velHeightDrag = useRef<{ startY: number; startH: number } | null>(null);
  const [velTool, setVelTool] = useState<VelTool>("pencil");
  const velToolRef = useRef(velTool);
  velToolRef.current = velTool;
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

  // Keep conform preview map in sync so Accept never writes stale pitches.
  useEffect(() => {
    setConformPreview((prev) => {
      if (!prev || prev.size === 0) return prev;
      if (scaleId === "off") return null;
      const next = buildConformPreview(notes, scaleRoot, scaleId);
      return next.size === 0 ? null : next;
    });
  }, [notes, scaleRoot, scaleId]);

  const { cellW: CELL_W, gridW, zoom, bumpZoom, setZoom, fitMode } = useRollFit();
  const effectiveSnap = resolveRollSnap(snapSteps, CELL_W);
  snapRef.current = effectiveSnap;
  const cellWRef = useRef(CELL_W);
  const gridWRef = useRef(gridW);
  cellWRef.current = CELL_W;
  gridWRef.current = gridW;
  const [rollH, setRollH] = useState(tall ? 640 : 360);
  const heightDrag = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    if (tall) setRollH((h) => Math.max(h, 640));
  }, [tall]);

  const totalSteps = bars * STEPS_PER_BAR;
  const gridH = ROWS * ROW_H;
  const gridHRef = useRef(gridH);
  gridHRef.current = gridH;

  const setSnap = (steps: number) => {
    setSnapStepsState(steps);
    const eff = resolveRollSnap(steps, cellWRef.current);
    snapRef.current = eff;
    lastLenRef.current = eff;
    setBrushLen(eff);
    try { window.localStorage.setItem(SNAP_STORAGE, String(steps)); } catch { /* ignore */ }
  };

  useEffect(() => {
    const eff = resolveRollSnap(snapSteps, CELL_W);
    snapRef.current = eff;
    // Auto + Off: keep brush length in sync with effective snap (Off floors at 1/16 brush)
    lastLenRef.current = eff > 0 ? eff : Math.max(0.25, lastLenRef.current || 1);
    setBrushLen(lastLenRef.current);
  }, [snapSteps, CELL_W]);

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
    const usedMidis = foldMode === "used"
      ? new Set(effectiveNotes().map((n) => n.midi))
      : null;
    for (let r = 0; r < ROWS; r++) {
      const midi = MIDI_TOP - r;
      const pc = midi % 12;
      const inFold =
        foldMode === "all"
          ? true
          : foldMode === "scale"
            ? inScale(midi, scaleRoot, scaleId)
            : usedMidis!.has(midi);
      const foldDim = foldMode !== "all" && !inFold;
      ctx.fillStyle = BLACK.has(pc)
        ? foldDim ? "rgba(0,0,0,0.52)" : "rgba(0,0,0,0.34)"
        : foldDim ? "rgba(255,255,255,0.008)" : "rgba(255,255,255,0.024)";
      ctx.fillRect(GUTTER, r * ROW_H, gw - GUTTER, ROW_H);
      if (scaleOn && inScale(midi, scaleRoot, scaleId)) {
        const isRoot = ((midi - scaleRoot) % 12 + 12) % 12 === 0;
        ctx.fillStyle = foldDim
          ? isRoot ? "rgba(255,150,70,0.04)" : "rgba(120,220,170,0.02)"
          : isRoot ? "rgba(255,150,70,0.10)" : "rgba(120,220,170,0.05)";
        ctx.fillRect(GUTTER, r * ROW_H, gw - GUTTER, ROW_H);
      } else if (foldMode === "scale" && scaleOn && !inScale(midi, scaleRoot, scaleId)) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(GUTTER, r * ROW_H, gw - GUTTER, ROW_H);
      }
      if (pc === 0) {
        ctx.fillStyle = foldDim ? "rgba(255,140,80,0.05)" : "rgba(255,140,80,0.12)";
        ctx.fillRect(GUTTER, r * ROW_H + ROW_H - 1, gw - GUTTER, 1);
      }
    }

    const lineGrid = snapRef.current <= 0 ? 1 : snapRef.current;
    const lineCount = Math.ceil(totalSteps / lineGrid);
    for (let i = 0; i <= lineCount; i++) {
      const s = i * lineGrid;
      if (s > totalSteps + 1e-6) break;
      const x = GUTTER + s * cw;
      const isBar = Math.abs(s % STEPS_PER_BAR) < 1e-6;
      const isBeat = Math.abs(s % 4) < 1e-6;
      ctx.fillStyle = isBar
        ? "rgba(255,120,60,0.52)"
        : isBeat
          ? "rgba(255,255,255,0.20)"
          : "rgba(255,255,255,0.035)";
      const w = isBar ? 2 : 1;
      ctx.fillRect(x, 0, w, gh);
    }

    const sel = selectedRef.current;
    const hoverId = previewRef.current.hoverId;
    const drawList = effectiveNotes();
    const ghostCh = activeChannel === 0 ? 1 : 0;

    const drawNote = (
      n: RollNote,
      opts: { ghost?: boolean; channelGhost?: boolean; conformOrig?: boolean; conformProposed?: boolean },
    ) => {
      const proposedMidi = conformPreview?.get(n.id);
      const midi = opts.conformProposed && proposedMidi != null ? proposedMidi : n.midi;
      const ghost = opts.ghost ?? n.id.startsWith("__ghost");
      const channelGhost = opts.channelGhost ?? false;
      const x = GUTTER + n.step * cw + 1;
      const y = (MIDI_TOP - midi) * ROW_H + 1.5;
      const w = Math.max(6, n.len * cw - 2);
      const h = ROW_H - 3;
      const isSel = sel.has(n.id);
      const isHover = hoverId === n.id;

      if (opts.conformOrig && proposedMidi != null) {
        const oy = (MIDI_TOP - n.midi) * ROW_H + 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.roundRect(x, oy, w, h, 3);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (channelGhost) {
        ctx.strokeStyle = n.ch === 1 ? "rgba(98,182,255,0.28)" : "rgba(255,140,66,0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.stroke();
        return;
      }

      const alpha = ghost ? 0.55 : opts.conformProposed ? 0.72 : 0.42 + n.vel * 0.55;
      const isB = n.ch === 1;
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, isB ? `rgba(98,182,255,${alpha})` : `rgba(255,140,66,${alpha})`);
      grad.addColorStop(1, isB ? `rgba(52,120,224,${alpha})` : `rgba(255,84,38,${alpha})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();
      ctx.strokeStyle = opts.conformProposed
        ? "rgba(255,220,120,0.95)"
        : isSel
          ? "rgba(255,235,190,0.95)"
          : isHover
            ? "rgba(255,255,255,0.75)"
            : isB
              ? "rgba(140,200,255,0.55)"
              : "rgba(255,170,110,0.5)";
      ctx.lineWidth = isSel || isHover || opts.conformProposed ? 1.6 : 1;
      ctx.stroke();
      if (isSel || opts.conformProposed) {
        ctx.shadowColor = opts.conformProposed ? "rgba(255,220,120,0.8)" : "rgba(255,220,160,0.8)";
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (!ghost && !opts.conformProposed) {
        const grip = edgePx(w);
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillRect(x + w - Math.min(4, grip * 0.25), y + 2, 3, h - 4);
        if ((isSel || isHover) && w > 16) {
          ctx.fillRect(x + 1, y + 2, 3, h - 4);
        }
      }
    };

    for (const n of drawList) {
      if (n.id.startsWith("__ghost")) continue;
      if (n.len <= 0) continue;
      if (n.ch === ghostCh) drawNote(n, { channelGhost: true });
    }
    for (const n of drawList) {
      if (n.id.startsWith("__ghost")) {
        drawNote(n, { ghost: true });
        continue;
      }
      if (n.len <= 0) continue;
      if (n.ch === ghostCh) continue;
      if (conformPreview?.has(n.id)) {
        drawNote(n, { conformOrig: true, conformProposed: true });
      } else {
        drawNote(n, {});
      }
    }

    // Tiny kick ghost ticks (optional drum hint)
    const kickSteps = drums?.steps?.kick;
    if (kickSteps && KICK_GHOST_MIDI >= MIDI_BOT && KICK_GHOST_MIDI <= MIDI_TOP) {
      const ky = (MIDI_TOP - KICK_GHOST_MIDI) * ROW_H + ROW_H - 4;
      for (let s = 0; s < totalSteps && s < kickSteps.length; s++) {
        const st = kickSteps[s];
        if (!st || st.vel <= 0) continue;
        const x = GUTTER + s * cw + cw * 0.35;
        ctx.fillStyle = "rgba(255,92,46,0.35)";
        ctx.fillRect(x, ky, Math.max(2, cw * 0.3), 3);
      }
    }

    ctx.fillStyle = "rgba(8,6,10,0.96)";
    ctx.fillRect(0, 0, GUTTER, gh);
    const labelW = GUTTER - 6;
    for (let r = 0; r < ROWS; r++) {
      const midi = MIDI_TOP - r;
      const pc = midi % 12;
      const y = r * ROW_H;
      const black = BLACK.has(pc);
      ctx.fillStyle = black ? "rgba(20,16,24,1)" : "rgba(235,230,240,0.92)";
      ctx.fillRect(0, y + 0.5, labelW, ROW_H - 1);
      if (scaleOn && inScale(midi, scaleRoot, scaleId)) {
        ctx.fillStyle = "rgba(90,220,160,0.55)";
        ctx.fillRect(GUTTER - 10, y + 2, 3, ROW_H - 4);
      }
      const showName = pc === 0 || (wideKeys && !black);
      if (showName) {
        ctx.fillStyle = black ? "#ddd" : "#3a2a22";
        ctx.font = wideKeys ? "8px ui-monospace, monospace" : "8.5px ui-monospace, monospace";
        ctx.textBaseline = "middle";
        const label = pc === 0
          ? `C${Math.floor(midi / 12) - 1}`
          : NOTE_NAMES[pc];
        ctx.fillText(label, 3, y + ROW_H / 2 + 0.5);
      }
    }
    ctx.fillStyle = "rgba(255,120,60,0.5)";
    ctx.fillRect(GUTTER - 2, 0, 2, gh);
  }, [effectiveNotes, totalSteps, scaleRoot, scaleId, activeChannel, conformPreview, foldMode, wideKeys, drums]);

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
    if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
  }, []);

  useEffect(() => { paintCanvas(); }, [paintCanvas, notes, selectedIds, gridW, CELL_W, snapSteps, conformPreview, foldMode, wideKeys, activeChannel]);

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

  const posFromClient = (clientX: number, clientY: number): { x: number; y: number; step: number; midi: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // Map viewport pixels → logical canvas space. Required when CSS size and
    // getBoundingClientRect diverge (DPR, fit-width, subpixel layout).
    const logicalW = gridWRef.current;
    const logicalH = gridHRef.current;
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * logicalW;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * logicalH;
    const cw = cellWRef.current;
    return {
      x,
      y,
      step: (x - GUTTER) / Math.max(1e-6, cw),
      midi: MIDI_TOP - Math.floor(y / ROW_H),
    };
  };

  const posFromEvent = (e: React.PointerEvent): { x: number; y: number; step: number; midi: number } =>
    posFromClient(e.clientX, e.clientY);

  const applyMarqueeAt = (x: number, y: number, startX: number, startY: number) => {
    const el = marqueeRef.current;
    const dx = x - startX;
    const dy = y - startY;
    if (el) {
      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      el.style.opacity = "1";
      el.style.transform = `translate(${left}px, ${top}px)`;
      el.style.width = `${Math.abs(dx)}px`;
      el.style.height = `${Math.abs(dy)}px`;
    }
    // Tiny jitter shouldn't wipe / rewrite selection mid-click.
    if (Math.abs(dx) + Math.abs(dy) < MARQUEE_MIN_PX) return;
    const x0 = Math.min(startX, x);
    const x1 = Math.max(startX, x);
    const y0 = Math.min(startY, y);
    const y1 = Math.max(startY, y);
    const cw = cellWRef.current;
    const covered = new Set<string>();
    const preview = conformPreview;
    for (const n of useFireSequencerStore.getState().notes) {
      if (n.ch !== activeChannel) continue;
      const midi = preview?.get(n.id) ?? n.midi;
      const nx = GUTTER + n.step * cw;
      const ny = (MIDI_TOP - midi) * ROW_H;
      const nw = Math.max(6, n.len * cw);
      if (nx < x1 && nx + nw > x0 && ny < y1 && ny + ROW_H > y0) covered.add(n.id);
    }
    setSelectedIds(covered);
  };

  const stopAutoScroll = () => {
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = 0;
    }
  };

  const tickEdgeAutoScroll = () => {
    autoScrollRafRef.current = 0;
    const el = scrollRef.current;
    const ptr = lastPtrRef.current;
    const d = dragRef.current;
    if (!el || !ptr || !d || (d.mode !== "marquee" && d.mode !== "move")) return;

    const rect = el.getBoundingClientRect();
    const EDGE = 48;
    const SPEED = 22;
    let scrolled = false;

    if (ptr.clientY < rect.top + EDGE) {
      const before = el.scrollTop;
      el.scrollTop = Math.max(0, before - SPEED);
      scrolled = el.scrollTop !== before;
    } else if (ptr.clientY > rect.bottom - EDGE) {
      const before = el.scrollTop;
      el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, before + SPEED);
      scrolled = el.scrollTop !== before;
    }

    if (ptr.clientX < rect.left + EDGE) {
      const before = el.scrollLeft;
      el.scrollLeft = Math.max(0, before - SPEED);
      scrolled = scrolled || el.scrollLeft !== before;
    } else if (ptr.clientX > rect.right - EDGE) {
      const before = el.scrollLeft;
      el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, before + SPEED);
      scrolled = scrolled || el.scrollLeft !== before;
    }

    if (scrolled) {
      const { x, y } = posFromClient(ptr.clientX, ptr.clientY);
      if (d.mode === "marquee") {
        if (Math.abs(x - d.startX) + Math.abs(y - d.startY) > MOVE_THRESHOLD_PX) d.moved = true;
        applyMarqueeAt(x, y, d.startX, d.startY);
      } else if (d.mode === "move" && d.orig) {
        // Re-enter move preview with scrolled coords (same math as pointermove).
        const dx = x - d.startX;
        const dy = y - d.startY;
        if (Math.abs(dx) + Math.abs(dy) > MOVE_THRESHOLD_PX) d.moved = true;
        const cw = cellWRef.current;
        const grid = snapRef.current;
        const dSteps = quantizeTo(dx / cw, grid);
        const dSemis = -Math.round(dy / ROW_H);
        const mapMidi = (base: number) => {
          const raw = base + dSemis;
          return clamp(scaleSnap && dSemis !== 0 ? snapPitch(raw) : raw, MIDI_BOT, MIDI_TOP);
        };
        if (d.groupOrig) {
          for (const o of d.groupOrig.values()) {
            previewRef.current.overrides.set(o.id, {
              step: Math.max(0, o.step + dSteps),
              midi: mapMidi(o.midi),
            });
          }
        } else {
          previewRef.current.overrides.set(d.noteId!, {
            step: Math.max(0, d.orig.step + dSteps),
            midi: mapMidi(d.orig.midi),
          });
        }
        schedulePaint();
      }
    }

    // Keep scrolling while the pointer stays near an edge.
    const nearEdge =
      ptr.clientY < rect.top + EDGE
      || ptr.clientY > rect.bottom - EDGE
      || ptr.clientX < rect.left + EDGE
      || ptr.clientX > rect.right - EDGE;
    if (nearEdge && dragRef.current) {
      autoScrollRafRef.current = requestAnimationFrame(tickEdgeAutoScroll);
    }
  };

  const armEdgeAutoScroll = (clientX: number, clientY: number) => {
    lastPtrRef.current = { clientX, clientY };
    const d = dragRef.current;
    if (!d || (d.mode !== "marquee" && d.mode !== "move")) return;
    if (!autoScrollRafRef.current) {
      autoScrollRafRef.current = requestAnimationFrame(tickEdgeAutoScroll);
    }
  };

  const hitNote = (x: number, y: number, fat = false): { note: RollNote; zone: HitZone } | null => {
    const padY = fat ? 5 : 2;
    const padX = fat ? 4 : 2;
    const cw = cellWRef.current;
    const list = effectiveNotes();
    const preview = conformPreview;
    const preferBody = tool === "select";
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.id.startsWith("__ghost")) continue;
      if (n.ch !== activeChannel) continue;
      const midi = preview?.get(n.id) ?? n.midi;
      const nx = GUTTER + n.step * cw;
      const ny = (MIDI_TOP - midi) * ROW_H;
      const nw = Math.max(6, n.len * cw);
      if (
        x >= nx - padX && x <= nx + nw + padX
        && y >= ny - padY && y <= ny + ROW_H + padY
      ) {
        let zone: HitZone = "body";
        const edge = edgePx(nw, preferBody);
        // Always prefer a real body zone — short notes used to be ~half resize.
        if (nw > edge * 2.2) {
          if (x <= nx + edge) zone = "left";
          else if (x >= nx + nw - edge) zone = "right";
        } else if (!preferBody && nw > 10 && x >= nx + nw - Math.min(edge, nw * 0.35)) {
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
        erased: new Set(),
      };
      const hit = hitNote(x, y, true);
      if (hit) {
        if (selectedIds.has(hit.note.id) && selectedIds.size > 1) {
          for (const id of selectedIds) dragRef.current.erased!.add(id);
          setSelectedIds(new Set());
        } else {
          dragRef.current.erased!.add(hit.note.id);
        }
        // Optimistic hide via preview overrides (zero len) — commit on up
        for (const id of dragRef.current.erased!) {
          previewRef.current.overrides.set(id, { len: 0 });
        }
        schedulePaint();
      }
      return;
    }
    if (e.button !== 0) return;

    const { x, y, step, midi } = posFromEvent(e);

    if (x < GUTTER) { audition(midi); return; }
    if (midi < MIDI_BOT || midi > MIDI_TOP || step < 0) return;

    const hit = hitNote(x, y);
    // Don't place new notes while conform preview is open — Accept/Cancel first.
    if (
      !hit
      && tool === "draw"
      && !e.ctrlKey && !e.metaKey
      && conformPreview
      && conformPreview.size > 0
    ) {
      useUIStore.getState().toast("Conform preview open — Accept or Cancel first");
      return;
    }
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
      const cw = cellWRef.current;
      const cursorStep = (x - GUTTER) / cw;
      let grabOffsetSteps = 0;
      if (mode === "resize") {
        grabOffsetSteps = cursorStep - (hit.note.step + hit.note.len);
      } else if (mode === "resizeL") {
        grabOffsetSteps = cursorStep - hit.note.step;
      }
      dragRef.current = {
        mode,
        noteId: hit.note.id,
        startX: x, startY: y,
        startStep: step, startMidi: midi,
        orig: { ...hit.note },
        groupOrig,
        moved: false,
        grabOffsetSteps,
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
      if (hit && !(d.erased?.has(hit.note.id))) {
        const erased = d.erased ?? new Set();
        erased.add(hit.note.id);
        d.erased = erased;
        previewRef.current.overrides.set(hit.note.id, { len: 0 });
        schedulePaint();
      }
      canvas.style.cursor = "not-allowed";
      return;
    }

    if (d.mode === "placeStretch" || d.mode === "paint") {
      // Exact row under the cursor (no scale remap — black keys stay drawable).
      const pitch = clamp(Math.round(midi), MIDI_BOT, MIDI_TOP);
      const crossedPitch = Math.abs(pitch - d.startMidi) >= PLACE_TO_PAINT_SEMIS;

      if (d.mode === "placeStretch" && crossedPitch && Math.abs(dy) > Math.abs(dx) && d.moved) {
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
        if (!d.moved) {
          canvas.style.cursor = "ew-resize";
          return;
        }
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
      applyMarqueeAt(x, y, d.startX, d.startY);
      armEdgeAutoScroll(e.clientX, e.clientY);
      return;
    }

    // Move / resize / velocity — preview only until pointer up.
    const cw = cellWRef.current;
    if (d.mode === "move" && d.orig) {
      const grid = snapRef.current;
      const dSteps = quantizeTo(dx / cw, grid);
      const dSemis = -Math.round(dy / ROW_H);
      const mapMidi = (base: number) => {
        const raw = base + dSemis;
        // Only scale-snap when pitch actually changes — never yank a parked note.
        return clamp(scaleSnap && dSemis !== 0 ? snapPitch(raw) : raw, MIDI_BOT, MIDI_TOP);
      };
      if (d.groupOrig) {
        for (const o of d.groupOrig.values()) {
          previewRef.current.overrides.set(o.id, {
            // Relative delta only — do not re-quantize the original step.
            step: Math.max(0, o.step + dSteps),
            midi: mapMidi(o.midi),
          });
        }
      } else {
        const newMidi = mapMidi(d.orig.midi);
        previewRef.current.overrides.set(d.noteId!, {
          step: Math.max(0, d.orig.step + dSteps),
          midi: newMidi,
        });
        if (newMidi !== d.orig.midi && newMidi !== lastAudMidiRef.current) {
          lastAudMidiRef.current = newMidi;
          audition(newMidi, d.orig.vel, d.orig.ch);
        }
      }
      canvas.style.cursor = "grabbing";
      schedulePaint();
      armEdgeAutoScroll(e.clientX, e.clientY);
    } else if (d.mode === "resize" && d.orig) {
      const grid = snapRef.current;
      const endStep = (x - GUTTER) / cw - (d.grabOffsetSteps ?? 0);
      const live = useFireSequencerStore.getState().notes;
      const rawLen = snapLenTo(endStep - d.orig.step, grid);
      const len = clampLenBeforeNext(live, d.orig.midi, d.orig.step, rawLen, grid, d.noteId ?? undefined);
      previewRef.current.overrides.set(d.noteId!, { len });
      canvas.style.cursor = "ew-resize";
      schedulePaint();
    } else if (d.mode === "resizeL" && d.orig) {
      const grid = snapRef.current;
      const startStep = quantizeTo((x - GUTTER) / cw - (d.grabOffsetSteps ?? 0), grid);
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
    stopAutoScroll();
    lastPtrRef.current = null;
    if (!d) return;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (d.mode === "marquee") {
      const el = marqueeRef.current;
      if (el) el.style.opacity = "0";
      return;
    }

    if (d.mode === "erase") {
      const ids = [...(d.erased ?? [])];
      clearPreview();
      if (ids.length > 0) removeNotes(ids);
      schedulePaint();
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
  const VEL_H = velH;

  const velTargets = useCallback((): RollNote[] => {
    const live = useFireSequencerStore.getState().notes;
    if (selectedIds.size > 0) return live.filter((n) => selectedIds.has(n.id));
    return live.filter((n) => n.ch === activeChannel);
  }, [selectedIds, activeChannel]);

  const runVelTool = (toolId: VelTool) => {
    const targets = velTargets();
    if (targets.length === 0) return;
    if (toolId === "randomize") {
      updateNotes(targets.map((n) => ({
        id: n.id,
        vel: clamp(0.35 + Math.random() * 0.55, 0.05, 1),
      })));
      playUi("press");
      return;
    }
    if (toolId === "compress") {
      const mean = targets.reduce((s, n) => s + n.vel, 0) / targets.length;
      updateNotes(targets.map((n) => ({
        id: n.id,
        vel: clamp(mean + (n.vel - mean) * 0.55, 0.05, 1),
      })));
      playUi("press");
      return;
    }
    if (toolId === "accents") {
      updateNotes(targets.map((n) => ({
        id: n.id,
        vel: clamp(
          Math.floor(n.step) % 4 === 0 ? Math.max(n.vel, 0.88) : n.vel * 0.82,
          0.05,
          1,
        ),
      })));
      playUi("press");
      return;
    }
    if (toolId === "humanize") {
      updateNotes(targets.map((n) => ({
        id: n.id,
        vel: clamp(n.vel + (Math.random() * 2 - 1) * 0.12, 0.05, 1),
      })));
      playUi("press");
    }
  };

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
        ? "rgba(255,120,60,0.32)"
        : s % 4 === 0
          ? "rgba(255,255,255,0.12)"
          : "rgba(255,255,255,0.035)";
      ctx.fillRect(x, 0, s % STEPS_PER_BAR === 0 ? 2 : 1, VEL_H);
    }

    const barW = Math.max(4, Math.min(CELL_W - 3, 9));
    const pending = velPendingRef.current;
    for (const n of [...notes].sort((a, b) => a.step - b.step)) {
      const x = GUTTER + n.step * CELL_W + 1;
      const vel = pending.get(n.id) ?? n.vel;
      const h = Math.max(2, vel * (VEL_H - 8));
      const y = VEL_H - 3 - h;
      const sel = selectedIds.has(n.id);
      const isB = n.ch === 1;
      const alpha = 0.35 + vel * 0.6;
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
  }, [velOpen, notes, selectedIds, gridW, totalSteps, CELL_W, velH]);

  useEffect(() => { velDraw(); }, [velDraw]);

  useEffect(() => {
    const el = velPlayheadRef.current;
    if (!el || !velOpen) return;
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
  }, [velOpen, playing, bpm, bars, CELL_W]);

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

  const velYToVel = (y: number) => clamp(1 - (y - 3) / (VEL_H - 8), 0.05, 1);

  const velPaintAt = (clientX: number, clientY: number) => {
    const canvas = velCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * gridWRef.current;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * velHRef.current;
    if (x < GUTTER) return;
    const vel = velYToVel(y);
    const toolNow = velToolRef.current;
    const pending = velPendingRef.current;

    if (toolNow === "pencil") {
      const hit = velHit(x);
      if (hit) {
        pending.set(hit.id, vel);
        velDraw();
      }
      return;
    }

    if (toolNow === "line" || toolNow === "ramp") {
      const stroke = velStrokeRef.current;
      if (!stroke) {
        velStrokeRef.current = { x, y, vel };
        const hit = velHit(x);
        if (hit) {
          pending.set(hit.id, vel);
          velDraw();
        }
        return;
      }
      const x0 = Math.min(stroke.x, x);
      const x1 = Math.max(stroke.x, x);
      const targets = velTargets().filter((n) => {
        const bx = GUTTER + n.step * CELL_W;
        return bx >= x0 - 6 && bx <= x1 + 6;
      });
      for (const n of targets) {
        const bx = GUTTER + n.step * CELL_W + 1;
        const t = x1 === x0 ? 1 : clamp((bx - x0) / (x1 - x0), 0, 1);
        // Line = flat end velocity across range; Ramp = interpolate start → end.
        const v = toolNow === "line"
          ? vel
          : stroke.vel + (vel - stroke.vel) * t;
        pending.set(n.id, clamp(v, 0.05, 1));
      }
    }
    // Live preview of pending velocities (commit on pointer up = one undo).
    velDraw();
  };

  const velPaint = (e: React.PointerEvent) => velPaintAt(e.clientX, e.clientY);

  const onVelPointerDown = (e: React.PointerEvent) => {
    const toolNow = velToolRef.current;
    if (toolNow === "randomize" || toolNow === "compress" || toolNow === "accents" || toolNow === "humanize") {
      runVelTool(toolNow);
      return;
    }
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    velPaintingRef.current = true;
    velStrokeRef.current = null;
    velPendingRef.current = new Map();
    velPaint(e);
  };
  const onVelPointerMove = (e: React.PointerEvent) => {
    if (velPaintingRef.current) velPaint(e);
  };
  const onVelPointerUp = () => {
    if (velPaintingRef.current && velPendingRef.current.size > 0) {
      updateNotes([...velPendingRef.current.entries()].map(([id, vel]) => ({ id, vel })));
    }
    velPaintingRef.current = false;
    velStrokeRef.current = null;
    velPendingRef.current = new Map();
  };

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
        const n = useFireSequencerStore.getState().notes.find((nn) => selectedIds.has(nn.id));
        const el = scrollRef.current;
        if (n && el) {
          const y = (MIDI_TOP - n.midi) * ROW_H;
          if (y < el.scrollTop + ROW_H || y > el.scrollTop + el.clientHeight - ROW_H * 2) {
            el.scrollTop = Math.max(0, y - el.clientHeight / 2);
          }
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const grid = snapRef.current;
        const delta = (e.key === "ArrowRight" ? 1 : -1) * (grid > 0 ? grid : 0.25);
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

  const selectedNote = selectedIds.size >= 1
    ? notes.find((n) => n.id === [...selectedIds][0]) ?? null
    : null;

  const acceptConform = () => {
    if (!conformPreview || conformPreview.size === 0) {
      setConformPreview(null);
      return;
    }
    const count = conformPreview.size;
    updateNotes([...conformPreview.entries()].map(([id, midi]) => ({ id, midi })));
    setConformPreview(null);
    playUi("success");
    useUIStore.getState().toast(`Conformed ${count} note${count === 1 ? "" : "s"}`);
  };

  return (
    <div>
      <div
        className="mb-2 editor-toolbar rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent"
        title="Draw: click places, drag stretches length, drag across pitches paints · edges resize · double-click / Alt-drag / RMB erase · Shift+drag velocity"
      >
        <EditorToolbarGroup>
          <ScopedPlayButton
            scope="pattern"
            title="Play / pause this pattern only"
          />
          <PatternSelect />
          <PatternBarsControls />
        </EditorToolbarGroup>
        <EditorToolbarDivider />
        <EditorToolbarGroup label="Tool">
          <div className="inline-flex h-8 rounded-lg border border-white/12 bg-black/30 p-0.5">
            {([
              ["draw", "Draw"],
              ["select", "Select"],
              ["erase", "Erase"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className="h-7 px-2.5 text-[10px] font-bold rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
                style={
                  tool === id
                    ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0", boxShadow: "inset 0 0 0 1px rgba(255,106,61,0.45)" }
                    : { color: "rgba(255,255,255,0.45)" }
                }
                aria-pressed={tool === id}
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
        </EditorToolbarGroup>
        <EditorToolbarDivider />
        <EditorToolbarGroup label="Snap">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/12 bg-black/30 p-0.5 h-8">
          <span className="px-1.5 text-[10px] uppercase tracking-[0.08em] text-white/48">Snap</span>
          {SNAP_OPTIONS.map((opt) => (
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
              aria-pressed={snapSteps === opt.steps}
              title={
                opt.label === "T"
                  ? "NOTE SNAP: triplet 1/8"
                  : opt.label === "Off"
                    ? "NOTE SNAP: Off — free placement"
                    : opt.label === "Auto"
                      ? `NOTE SNAP: Adaptive → ${
                          effectiveSnap === 16 ? "1" : effectiveSnap === 8 ? "1/2" : effectiveSnap === 4 ? "1/4" : effectiveSnap === 2 ? "1/8" : "1/16"
                        } BAR`
                      : `NOTE SNAP: ${opt.label} NOTE`
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        </EditorToolbarGroup>
        <EditorToolbarDivider />
        <EditorToolbarGroup label="Key" className="editor-toolbar__advanced">
        <div className="inline-flex rounded-lg border border-white/12 bg-black/30 p-0.5">
          {([
            ["all", "All"],
            ["scale", "Scale"],
            ["used", "Used"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFoldMode(id)}
              className="px-2 py-1.5 text-[10px] font-bold rounded-md transition"
              style={
                foldMode === id
                  ? { background: "rgba(120,220,170,0.18)", color: "#a8f0d0" }
                  : { color: "rgba(255,255,255,0.4)" }
              }
              title={id === "all" ? "Show all rows" : id === "scale" ? "Dim out-of-scale rows" : "Highlight rows with notes"}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWideKeys(!wideKeys)}
          className={`h-8 px-2.5 rounded-lg border text-[10px] uppercase tracking-[0.12em] transition ${
            wideKeys
              ? "border-cyan/40 bg-cyan/12 text-cyan"
              : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white/80"
          }`}
          title="Wider key labels — show note names on white keys"
        >
          Keys+
        </button>
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
            const st = useFireSequencerStore.getState();
            const alts = detectKeyAlternatives(st.notes);
            const hit = detectKeyFromNotes(st.notes);
            playUi("press");
            if (!hit) {
              useUIStore.getState().toast("Not enough notes to call a key yet");
              return;
            }
            st.detectAndApplyKey();
            const bestLabel = `${NOTE_NAMES[hit.root]} ${SCALES.find((s) => s.id === hit.scaleId)?.label ?? ""}`;
            const altText = alts
              .filter((a) => !(a.root === hit.root && a.scaleId === hit.scaleId))
              .slice(0, 2)
              .map((a) => `${NOTE_NAMES[a.root]} ${SCALES.find((s) => s.id === a.scaleId)?.label ?? ""} (${(a.confidence * 100).toFixed(0)}%)`)
              .join(" · ");
            useUIStore.getState().toast(
              altText
                ? `Detected ${bestLabel} (${(hit.confidence * 100).toFixed(0)}%) — also ${altText}`
                : `Detected ${bestLabel} (${(hit.confidence * 100).toFixed(0)}%) — scale set`,
            );
          }}
          className="h-8 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-white/55 hover:text-cyan text-[10px] uppercase tracking-[0.12em] transition"
          title="Detect key from notes in the roll"
        >
          Detect key
        </button>
        {conformPreview && conformPreview.size > 0 ? (
          <>
            <button
              onClick={acceptConform}
              className="h-8 px-2.5 rounded-lg border border-[#efc53d]/50 bg-[#efc53d]/18 text-[#efc53d] text-[10px] uppercase tracking-[0.12em] transition"
            >
              Accept ({conformPreview.size})
            </button>
            <button
              onClick={() => setConformPreview(null)}
              className="h-8 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-white/55 hover:text-white/90 text-[10px] uppercase tracking-[0.12em] transition"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              if (scaleId === "off") {
                useUIStore.getState().toast("Pick a scale first");
                return;
              }
              const preview = buildConformPreview(notes, scaleRoot, scaleId);
              if (preview.size === 0) {
                playUi("press");
                useUIStore.getState().toast("Already all in scale");
                return;
              }
              setConformPreview(preview);
              playUi("press");
              useUIStore.getState().toast(`Preview: ${preview.size} note${preview.size === 1 ? "" : "s"} would move — Accept or Cancel`);
            }}
            disabled={scaleId === "off"}
            className={`h-8 px-2.5 rounded-lg border text-[10px] uppercase tracking-[0.12em] transition ${
              scaleId === "off"
                ? "border-white/8 text-white/25"
                : "border-white/10 bg-white/[0.03] text-white/55 hover:text-[#efc53d]"
            }`}
            title="Preview moving out-of-scale notes to nearest scale tone"
          >
            Conform
          </button>
        )}
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
        </EditorToolbarGroup>
        <span className="editor-toolbar__spacer flex-1 min-w-[8px]" />
        <EditorToolbarGroup label="View">
        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5">
          <button
            onClick={() => bumpZoom(0.85)}
            disabled={zoom <= ROLL_ZOOM_MIN}
            className="w-7 h-7 rounded-md border border-transparent text-white/60 hover:text-white hover:bg-white/8 text-[13px] leading-none transition disabled:opacity-30"
            title="Zoom out (bird's-eye — past fit)"
            aria-label="Zoom out"
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
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
        </EditorToolbarGroup>
      </div>

      <p className="mb-2 text-[10px] text-white/35 tracking-wide">
        Move · Resize edges · Alt-drag erase · Shift-drag velocity · Draw paints across pitches
      </p>

      {/* Always reserved — opening on first note used to shove the canvas mid-drag. */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 px-2.5 py-2 min-h-[40px]">
        <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">
          {selectedNote
            ? (selectedIds.size > 1 ? `Note (1 of ${selectedIds.size})` : "Note")
            : "Note"}
        </span>
        {selectedNote ? (
          <>
          {([
            ["Start", "step", selectedNote.step, 0.25, totalSteps - 0.25],
            ["Len", "len", selectedNote.len, 0.25, totalSteps],
            ["Pitch", "midi", selectedNote.midi, MIDI_BOT, MIDI_TOP],
            ["Vel", "vel", selectedNote.vel, 0.05, 1],
          ] as const).map(([label, key, val, min, max]) => (
            <label key={key} className="inline-flex items-center gap-1 text-[10px] text-white/55">
              {label}
              <input
                type="number"
                step={key === "vel" ? 0.01 : key === "midi" ? 1 : 0.25}
                min={min}
                max={max}
                value={key === "midi" ? val : Number(val.toFixed(key === "vel" ? 2 : 2))}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  updateNote(selectedNote.id, { [key]: clamp(n, min, max) } as Partial<RollNote>);
                }}
                className="w-16 bg-black/50 border border-white/12 rounded px-1.5 py-1 text-[10px] font-mono outline-none focus:border-cyan/50"
              />
              {key === "midi" && (
                <span className="text-cyan/70 font-mono">{NOTE_NAMES[((selectedNote.midi % 12) + 12) % 12]}</span>
              )}
            </label>
          ))}
          {(() => {
            const ext = selectedNote as RollNoteExt;
            const prob = ext.probability ?? ext.prob;
            const extras: Array<{ label: string; key: keyof RollNoteExt; val: number; min: number; max: number; step: number }> = [];
            if (prob != null) extras.push({ label: "Prob", key: "probability", val: prob, min: 0, max: 1, step: 0.01 });
            if (ext.micro != null) extras.push({ label: "Micro", key: "micro", val: ext.micro, min: -1, max: 1, step: 0.01 });
            if (ext.ratchet != null) extras.push({ label: "Ratchet", key: "ratchet", val: ext.ratchet, min: 1, max: 4, step: 1 });
            return extras.map((f) => (
              <label key={f.label} className="inline-flex items-center gap-1 text-[10px] text-white/55">
                {f.label}
                <input
                  type="number"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={f.val}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    updateNote(selectedNote.id, { [f.key]: clamp(n, f.min, f.max) } as Partial<RollNote>);
                  }}
                  className="w-14 bg-black/50 border border-white/12 rounded px-1.5 py-1 text-[10px] font-mono outline-none focus:border-cyan/50"
                />
              </label>
            ));
          })()}
          </>
        ) : (
          <span className="text-[10px] text-white/30">Select or place a note to edit Start · Len · Pitch · Vel</span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const left = e.currentTarget.scrollLeft;
          const v = velScrollRef.current;
          if (v) v.scrollLeft = left;
          setRollHScroll(left);
        }}
        className="relative rounded-2xl border border-white/12 bg-[#0a0c12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,106,61,0.06)] editor-scroll overflow-auto"
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setVelOpen(!velOpen)}
            className="text-[10px] uppercase tracking-[0.12em] text-white/55 hover:text-white/80 transition font-bold"
            title="Velocity lane: each bar is a note's loudness — drag across to paint."
            aria-expanded={velOpen}
          >
            {velOpen ? "▾" : "▸"} Velocity
          </button>
          {velOpen && (
            <div className="inline-flex rounded-lg border border-white/12 bg-black/30 p-0.5">
              {([
                ["pencil", "Pencil", "Drag to paint velocity"],
                ["line", "Line", "Drag across notes — set all to end velocity"],
                ["ramp", "Ramp", "Drag across notes — ramp from start to end velocity"],
                ["randomize", "Rand", "Randomize velocities (selected if any)"],
                ["compress", "Compress", "Pull velocities toward the mean"],
                ["accents", "Accents", "Boost downbeats, soften the rest"],
                ["humanize", "Vel human", "Jitter velocities only (toolbar Humanize also moves timing)"],
              ] as const).map(([id, label, tip]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (id === "randomize" || id === "compress" || id === "accents" || id === "humanize") {
                      runVelTool(id);
                      return;
                    }
                    setVelTool(id);
                  }}
                  className="px-2 py-1 text-[9px] font-bold rounded-md transition"
                  style={
                    velTool === id
                      ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0" }
                      : { color: "rgba(255,255,255,0.4)" }
                  }
                  title={tip}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {velOpen && (
          <div
            ref={velScrollRef}
            className="relative mt-1.5 rounded-xl border border-white/12 bg-[#0a0c12] editor-scroll overflow-x-auto"
            style={{ height: velH }}
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
            <div
              ref={velPlayheadRef}
              className="absolute top-0 bottom-0 w-px pointer-events-none opacity-0"
              style={{
                background: "linear-gradient(180deg, rgba(255,220,150,0.9), rgba(255,110,50,0.65))",
                boxShadow: "0 0 8px rgba(255,140,60,0.8)",
                willChange: "transform",
              }}
            />
          </div>
        )}
        {velOpen && (
          <div
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              velHeightDrag.current = { startY: e.clientY, startH: velH };
            }}
            onPointerMove={(e) => {
              const h = velHeightDrag.current;
              if (!h) return;
              setVelH(clamp(h.startH + (e.clientY - h.startY), 40, 160));
            }}
            onPointerUp={(e) => {
              velHeightDrag.current = null;
              try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
            className="mt-1 h-2 rounded-full cursor-ns-resize flex items-center justify-center group touch-none"
            title="Drag to resize the velocity lane"
          >
            <div className="w-16 h-0.5 rounded-full bg-white/12 group-hover:bg-cyan/45 transition" />
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
