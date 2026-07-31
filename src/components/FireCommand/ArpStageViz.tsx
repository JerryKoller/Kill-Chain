/**
 * Arpeggiator — Cascade Orbit stage visualizer.
 *
 * IDIOM: the step lane. An arp is a sequence of gated steps, so the 10:1
 * letterbox becomes the lane itself: one cell per step marching across the
 * width, tiled for as many loops as fit, with loop boundaries marked and a
 * playhead beam riding the sounding step.
 *
 * Every parameter lands on the cells rather than in a legend. Gate is the cell's
 * width inside its slot — a short gate is a sliver, a long one fills the slot.
 * Octave range stacks the lane into that many rows, and each step sits in the
 * row for its octave with its bar height reading pitch inside that octave, so
 * mode is legible from the shape alone: up ramps, down falls, updown makes a V,
 * converge zig-zags outward. Swing skews the odd cells late. Ratchet splits a
 * cell in two. Accent puts a spike over every Nth cell.
 *
 * Drag: BPM ↔ / Gate ↕. Bottom: Swing. Click: arm toggle. Double-click: cycle mode.
 */

import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore, buildArpSequence, type ArpDivision, type ArpMode, type ArpSettings } from "@/state/fireCommandStore";
import { NOTE_NAMES } from "@/state/fireSequencerStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  cachedGrad,
  drawGlow,
  footer,
  grain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  roundRect,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 176;
const C = FC.arp;
const C_DEEP = bandShade(FC.mod, 0.32);
const C_MID = bandShade(FC.mod, 0.55);
const C_HOT = bandShade(FC.mod, 0.75);
const C_GLOW = bandShade(FC.mod, 0.96);
const C_BPM = bandShade(FC.mod, 0.62);
const C_GATE = bandShade(FC.mod, 0.8);
const C_SWING = bandShade(FC.mod, 0.88);
const C_ACCENT = bandShade(FC.mod, 0.92);

const BPM_MIN = 40;
const BPM_MAX = 300;
const GATE_MIN = 0.1;
const GATE_MAX = 1;

/** Includes distinctive cascade/orbit modes (converge · diverge · pedal). */
const MODE_CYCLE: ArpMode[] = [
  "up",
  "down",
  "updown",
  "downup",
  "converge",
  "diverge",
  "pedal",
  "random",
  "walk",
  "asplayed",
];

const DIVISIONS: ArpDivision[] = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];

/** Cells the lane will draw at most, however many loops that ends up being. */
const MAX_CELLS = 48;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

function noteName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

type DragMode = "xy" | "swing" | null;

export type ArpVizState = {
  enabled: boolean;
  mode: ArpMode;
  bpm: number;
  division: ArpDivision;
  octaves: number;
  gate: number;
  hold: boolean;
  swing: number;
  accent: number;
  accentEvery: number;
  ratchet: number;
  /** One loop of the sequence, in MIDI notes. */
  seq: number[];
  /** How many loops are tiled across the lane. */
  reps: number;
  lo: number;
  hi: number;
  /** True when no chord is held and the lane is showing a demo triad. */
  ghost: boolean;
  /** Live transport, refreshed from the store outside the paint. */
  stepIdx: number;
  cur: number | null;
  /** Which tiled loop the playhead is in, so the lit cell holds the right note. */
  rep: number;
  /** Timestamps for the step rings — decay is derived, never mutated in paint. */
  stepAt: number;
  prevCell: number;
  prevAt: number;
};

/**
 * Paint the step lane. Exported and pure so it renders headlessly without
 * mounting the component.
 */
export function paintArp(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ArpVizState,
  now: number,
  flash: number,
): void {
  const seqLen = p.seq.length;
  const bpmN = logNorm(p.bpm, BPM_MIN, BPM_MAX);
  const gate = clamp(p.gate, GATE_MIN, GATE_MAX);
  const gateN = (gate - GATE_MIN) / (GATE_MAX - GATE_MIN);
  const swing = clamp(p.swing, 0, 0.33);
  const ratchet = clamp(p.ratchet, 0, 1);
  const accentAmt = clamp(p.accent, 0, 1);
  const every = Math.max(0, Math.round(p.accentEvery));
  const running = !p.ghost && p.enabled && p.stepIdx >= 0;
  const breath = p.ghost || !p.enabled ? 0.55 + 0.45 * Math.sin(now / 900) : 1;
  const energy =
    0.12 + (p.enabled ? 0.24 : 0) + (p.ghost ? 0 : 0.14) + gateN * 0.14 +
    swing * 0.5 + ratchet * 0.14 + flash * 0.24;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.56 });

  // ── lane geometry ──
  const xL = 34;
  const xR = W - 14;
  const span = Math.max(80, xR - xL);
  const laneTop = 26;
  const laneBot = Hh - 46;
  const laneH = laneBot - laneTop;
  const rows = clamp(Math.round(p.octaves), 1, 4);
  const rowH = laneH / rows;

  // Octave rows as horizontal strata — the lane's depth language.
  for (let r = 0; r < rows; r++) {
    const yTop = laneBot - (r + 1) * rowH;
    ctx.fillStyle = hexA(C_DEEP, r % 2 === 0 ? 0.16 : 0.08);
    ctx.fillRect(xL, yTop, span, rowH);
    ctx.fillStyle = hexA(C_MID, 0.12);
    ctx.fillRect(xL, yTop, span, 1);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_MID, 0.45);
    ctx.fillText(r === 0 ? "+0" : `+${r * 12}`, xL - 4, yTop + rowH * 0.5 + 3);
  }
  ctx.fillStyle = hexA(C_MID, 0.2);
  ctx.fillRect(xL, laneBot, span, 1);

  if (seqLen === 0) {
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HOLD A CHORD", W / 2, laneTop + laneH * 0.5);
  } else {
    const cells = Math.min(MAX_CELLS, seqLen * Math.max(1, p.reps));
    const slotW = span / cells;
    const lo = p.lo;
    const playCell = running ? Math.min(cells - 1, p.stepIdx + seqLen * p.rep) : -1;

    // Loop boundaries — makes the tiling explicit rather than accidental.
    for (let k = seqLen; k < cells; k += seqLen) {
      const x = xL + k * slotW;
      ctx.fillStyle = hexA(C_MID, 0.22);
      ctx.fillRect(x, laneTop, 1, laneH);
    }

    for (let i = 0; i < cells; i++) {
      const midi = p.seq[i % seqLen]!;
      const rel = midi - lo;
      const row = clamp(Math.floor(rel / 12), 0, rows - 1);
      const pc = ((rel % 12) + 12) % 12;
      const rowBase = laneBot - row * rowH;
      // Swing pushes the odd cells late; gate sets how much of the slot fills.
      const skew = (i % 2 === 1 ? swing : 0) * slotW;
      const cx0 = xL + i * slotW + skew + 1;
      const cw = Math.max(2, slotW * gate - 2);
      const accented = accentAmt > 0 && every > 0 && i % every === 0;
      const isLive = i === playCell;
      const fillH = Math.max(3, (rowH - 5) * (0.16 + (pc / 11) * 0.84));
      const cy0 = rowBase - 2 - fillH;
      const vel = clamp(0.34 + (accented ? accentAmt * 0.55 : 0) + (ratchet > 0.2 && i % 2 === 0 ? ratchet * 0.2 : 0), 0, 1);
      const col = accented ? C_ACCENT : C_HOT;
      const alpha = p.ghost ? 0.16 * breath : isLive ? 0.78 + vel * 0.22 : (0.24 + vel * 0.4) * breath;

      const body = cachedGrad(ctx, `arpcell|${(rowH * 4) | 0}|${row}|${accented ? 1 : 0}`, (c) => {
        const g = c.createLinearGradient(0, rowBase - rowH, 0, rowBase);
        g.addColorStop(0, hexA(accented ? C_ACCENT : C_GLOW, 0.9));
        g.addColorStop(1, hexA(col, 0.25));
        return g;
      });
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = body;
      roundRect(ctx, cx0, cy0, cw, fillH, Math.min(3, cw * 0.4));
      ctx.fill();
      ctx.restore();

      // Slot outline shows the unfilled remainder — i.e. the gate.
      if (slotW > 6) {
        ctx.strokeStyle = hexA(C_MID, p.ghost ? 0.08 : 0.14);
        ctx.lineWidth = 1;
        ctx.strokeRect(xL + i * slotW + 0.5, rowBase - rowH + 2.5, slotW - 1, rowH - 4);
      }

      // Ratchet: the cell retriggers, so it is drawn split.
      if (ratchet > 0.05 && cw > 5) {
        ctx.fillStyle = hexA(C_DEEP, 0.5 + ratchet * 0.4);
        ctx.fillRect(cx0 + cw * 0.5 - 0.5, cy0, 1, fillH);
      }

      // Accent spike over the cell.
      if (accented && !p.ghost) {
        ctx.strokeStyle = hexA(C_ACCENT, (0.45 + accentAmt * 0.45) * breath);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx0 + cw * 0.5 - 3, cy0 - 3);
        ctx.lineTo(cx0 + cw * 0.5, cy0 - 7 - accentAmt * 4);
        ctx.lineTo(cx0 + cw * 0.5 + 3, cy0 - 3);
        ctx.stroke();
      }

      if (isLive) {
        lit(ctx, () => {
          drawGlow(ctx, cx0 + cw * 0.5, cy0 + fillH * 0.5, 14 + vel * 14 + flash * 6, accented ? C_ACCENT : C_GLOW, 0.8);
        });
      }
    }

    // ── playhead ──
    if (playCell >= 0) {
      const skew = (playCell % 2 === 1 ? swing : 0) * slotW;
      const px = xL + playCell * slotW + skew + Math.max(2, slotW * gate - 2) * 0.5;
      const beam = cachedGrad(ctx, `arpbeam|${laneTop}|${laneBot}`, (c) => {
        const g = c.createLinearGradient(0, laneTop, 0, laneBot + 6);
        g.addColorStop(0, hexA(C_GLOW, 0));
        g.addColorStop(0.4, hexA(C_GLOW, 0.5));
        g.addColorStop(1, hexA(C, 0));
        return g;
      });
      ctx.fillStyle = beam;
      ctx.fillRect(px - 1.5, laneTop, 3, laneH + 6);

      // Step rings: current, plus the one it just left.
      const ring = (cell: number, at: number, col: string) => {
        if (cell < 0) return;
        const age = (now - at) / 340;
        if (age < 0 || age > 1) return;
        const sk = (cell % 2 === 1 ? swing : 0) * slotW;
        const rx = xL + cell * slotW + sk + Math.max(2, slotW * gate - 2) * 0.5;
        const midi = p.seq[cell % seqLen]!;
        const row = clamp(Math.floor((midi - lo) / 12), 0, rows - 1);
        const ry = laneBot - row * rowH - rowH * 0.5;
        ctx.strokeStyle = hexA(col, (1 - age) * (1 - age) * 0.8);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(rx, ry, 4 + age * 26, 0, Math.PI * 2);
        ctx.stroke();
      };
      ring(p.prevCell, p.prevAt, C_HOT);
      ring(playCell, p.stepAt, C_GLOW);

      ctx.font = VIZ_FONT_VALUE;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_GLOW, 0.95);
      ctx.fillText(noteName(p.seq[playCell % seqLen]!), px, laneTop - 4);
    }

    // Step numbers along the floor, thinned out when the cells get tight.
    const stride = slotW < 26 ? (slotW < 13 ? 8 : 4) : 1;
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    for (let i = 0; i < cells; i += stride) {
      ctx.fillStyle = hexA(i === playCell ? C_GLOW : C_MID, i === playCell ? 0.9 : 0.4);
      ctx.fillText(`${(i % seqLen) + 1}`, xL + (i + 0.5) * slotW, laneBot + 11);
    }
  }

  // ── telemetry ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_BPM, 0.72);
  ctx.fillText(`${Math.round(p.bpm)} BPM · ${p.division}`, xL, laneTop - 4);
  ctx.fillStyle = hexA(C_GATE, 0.7);
  ctx.fillText(`GATE ${Math.round(gate * 100)}`, xL + 108, laneTop - 4);
  ctx.fillStyle = hexA(C_ACCENT, accentAmt > 0.02 ? 0.7 : 0.35);
  ctx.fillText(`ACC ${Math.round(accentAmt * 100)}/${every}`, xL + 176, laneTop - 4);
  ctx.fillStyle = hexA(C_HOT, ratchet > 0.02 ? 0.7 : 0.35);
  ctx.fillText(`RATCH ${Math.round(ratchet * 100)}`, xL + 258, laneTop - 4);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(p.enabled ? C_GLOW : C_MID, 0.7);
  ctx.fillText(`${clamp(Math.round(p.octaves), 1, 4)} OCT${p.hold ? " · HOLD" : ""}`, xR, laneTop - 4);

  // BPM / gate crosshair — matches the drag mapping.
  const hx = bpmN * W;
  const hy = (1 - gateN) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, p.mode.toUpperCase(), C_GLOW, { glow: flash });

  // ── swing rail ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railX, railY, railW, 7);
  ctx.strokeStyle = hexA(C_SWING, 0.22 + swing * 1.2);
  ctx.lineWidth = 1;
  ctx.strokeRect(railX + 0.5, railY + 0.5, railW - 1, 6);
  const swingN = swing / 0.33;
  if (swing > 0.01) {
    const rg = cachedGrad(ctx, `swrail|${railX}|${railW}`, (c) => {
      const g = c.createLinearGradient(railX, 0, railX + railW, 0);
      g.addColorStop(0, hexA(C_SWING, 0.4));
      g.addColorStop(1, hexA(C_GLOW, 0.8));
      return g;
    });
    ctx.fillStyle = rg;
    ctx.fillRect(railX + 1, railY + 1, Math.max(2, (railW - 2) * swingN), 5);
  }
  lit(ctx, () => drawGlow(ctx, railX + 1 + (railW - 2) * swingN, railY + 3.5, 8 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_SWING, 0.8);
  ctx.fillText("SWING", railX + 2, railY - 4);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_SWING, 0.62);
  ctx.fillText(`${Math.round(swing * 300)}%`, railX + railW - 2, railY - 4);

  // Step pulse on the panel edges.
  const pulse = clamp(1 - (now - p.stepAt) / 220, 0, 1);
  if (running && pulse > 0) {
    ctx.fillStyle = hexA(C, pulse * 0.25);
    ctx.fillRect(0, 0, W, 2);
    ctx.fillRect(0, Hh - 2, W, 2);
  }

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "ARP · CASCADE ORBIT",
    p.ghost
      ? "HOLD CHORD"
      : p.enabled
        ? p.cur != null
          ? `● ${noteName(p.cur)} · ${p.bpm}`
          : `● LIVE · ${p.bpm}`
        : `STANDBY · ${p.bpm} · ${p.octaves}º`,
    C_GLOW,
    p.enabled && !p.ghost ? C_HOT : C_MID,
  );
}

export function ArpStageViz() {
  const arp = useFireCommandStore((s) => s.arp);
  const arpOrder = useFireCommandStore((s) => s.arpOrder);
  const setArp = useFireCommandStore((s) => s.setArp);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const lastStepRef = useRef(-1);
  const prevKey = useRef(0);

  // The sequence is a render-time derivation — building it per frame allocated
  // a fresh array 45× a second for every visible arp panel.
  const shape = useMemo(() => {
    const ghost = arpOrder.length === 0;
    const held = ghost ? [60, 64, 67] : arpOrder;
    const seq = buildArpSequence(held, arp.mode, arp.octaves);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i]! < lo) lo = seq[i]!;
      if (seq[i]! > hi) hi = seq[i]!;
    }
    if (!seq.length) {
      lo = 60;
      hi = 60;
    }
    const reps = clamp(Math.ceil(14 / Math.max(1, seq.length)), 1, 8);
    return { ghost, seq, lo, hi, reps };
  }, [arpOrder, arp.mode, arp.octaves]);

  const st = useRef<ArpVizState>({
    enabled: arp.enabled,
    mode: arp.mode,
    bpm: arp.bpm,
    division: arp.division,
    octaves: arp.octaves,
    gate: arp.gate,
    hold: arp.hold,
    swing: arp.swing ?? 0,
    accent: arp.accent ?? 0,
    accentEvery: arp.accentEvery ?? 4,
    ratchet: arp.ratchet ?? 0,
    seq: shape.seq,
    reps: shape.reps,
    lo: shape.lo,
    hi: shape.hi,
    ghost: shape.ghost,
    stepIdx: -1,
    cur: null,
    rep: 0,
    stepAt: 0,
    prevCell: -1,
    prevAt: 0,
  });
  // Patch fields refresh on render; transport fields are owned by the hint pass.
  st.current.enabled = arp.enabled;
  st.current.mode = arp.mode;
  st.current.bpm = arp.bpm;
  st.current.division = arp.division;
  st.current.octaves = arp.octaves;
  st.current.gate = arp.gate;
  st.current.hold = arp.hold;
  st.current.swing = arp.swing ?? 0;
  st.current.accent = arp.accent ?? 0;
  st.current.accentEvery = arp.accentEvery ?? 4;
  st.current.ratchet = arp.ratchet ?? 0;
  st.current.seq = shape.seq;
  st.current.reps = shape.reps;
  st.current.lo = shape.lo;
  st.current.hi = shape.hi;
  st.current.ghost = shape.ghost;

  const live = arp.enabled && arpOrder.length > 0;

  useEffect(() => {
    const key = motionHash(
      arp.enabled,
      MODE_CYCLE.indexOf(arp.mode),
      arp.bpm,
      arp.gate,
      arp.swing ?? 0,
      arp.ratchet ?? 0,
      arp.accent ?? 0,
      arp.accentEvery,
      arp.octaves,
      DIVISIONS.indexOf(arp.division),
      arp.hold,
      arpOrder.length,
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [arp, arpOrder]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setArp({
        bpm: Math.round(logLerp(x, BPM_MIN, BPM_MAX)),
        gate: Math.round((GATE_MIN + (1 - y) * (GATE_MAX - GATE_MIN)) * 100) / 100,
      });
    },
    [setArp, wrapRef],
  );

  const applySwing = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setArp({ swing: Math.round(x * 0.33 * 1000) / 1000 });
    },
    [setArp, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "swing";
        wrap.setPointerCapture(e.pointerId);
        applySwing(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applySwing, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "swing") applySwing(e.clientX);
    },
    [applyXy, applySwing],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const i = MODE_CYCLE.indexOf(st.current.mode);
    const next = MODE_CYCLE[(i + 1) % MODE_CYCLE.length]!;
    setArp({ mode: next });
  }, [setArp]);

  const onClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Only toggle arm on quick click without drag — handled via pointerup if no move
      // Use double-click for mode; single click on badge area toggles — simpler: Alt+click or we use a dedicated approach
      // Actually: short click without significant drag toggles enable when clicking top chrome zone
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (e.clientY - rect.top < 28) {
        setArp({ enabled: !st.current.enabled });
      }
    },
    [setArp, wrapRef],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintArp(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        // Per-tick transport is read here rather than subscribed to — subscribing
        // re-rendered the whole component at note rate.
        const s = useFireCommandStore.getState();
        const stepIdx = s.arpStepIndex;
        const p = st.current;
        if (stepIdx !== lastStepRef.current) {
          const seqLen = Math.max(1, p.seq.length);
          const cells = Math.min(MAX_CELLS, seqLen * Math.max(1, p.reps));
          const loops = Math.max(1, Math.floor(cells / seqLen));
          if (lastStepRef.current >= 0) {
            p.prevCell = Math.min(cells - 1, lastStepRef.current + seqLen * p.rep);
            p.prevAt = p.stepAt;
          }
          // A wrap back to the head advances which tiled loop is lit.
          if (stepIdx <= lastStepRef.current) p.rep = (p.rep + 1) % loops;
          p.stepAt = performance.now();
          lastStepRef.current = stepIdx;
        }
        p.stepIdx = stepIdx;
        p.cur = s.arpCurrent;
        return {
          flash: flashRef.current,
          active: p.enabled,
          dragging: !!dragRef.current,
          particles: performance.now() - p.stepAt < 400 ? 1 : 0,
          visible: visibleRef.current,
          motionKey: motionHash(
            p.enabled,
            MODE_CYCLE.indexOf(p.mode),
            p.bpm,
            p.gate,
            p.swing,
            p.ratchet,
            p.accent,
            p.accentEvery,
            p.octaves,
            DIVISIONS.indexOf(p.division),
            p.hold,
            p.seq.length,
            stepIdx,
          ),
        };
      },
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, live ? 0.55 : arp.enabled ? 0.4 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      title="Drag: BPM ↔ / Gate ↕ · Bottom: Swing · Top click: Arm · Double-click: cycle mode"
      role="img"
      aria-label="Arpeggiator cascade orbit"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexA(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexA(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.78) }}
      >
        Cascade Orbit
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(arp.enabled ? C_HOT : C_MID, 0.78) }}
      >
        {arp.enabled ? (arp.hold ? "HOLD" : "ARMED") : "OFF"}
      </div>
    </div>
  );
}

/** Compat wrapper for older call sites that pass arp prop */
export function ArpViz(_props: { arp: ArpSettings }) {
  return <ArpStageViz />;
}
