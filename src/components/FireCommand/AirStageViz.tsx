/**
 * Air — Sky Shelf stage visualizer.
 *
 * IDIOM: the tilt shelf. A real analyser plot — log frequency across the
 * letterbox, dB up — so the module reads as what it is: a low shelf, a high
 * shelf, and the arch that decides whether they act independently or see-saw
 * around 1 kHz. This is the calmest of the six on purpose: graph paper, a grid,
 * two handles, one curve. Nothing animates, so it costs nothing while idle.
 *
 * Low/high shelves × amount, arch and M/S mode (Signal Path Mix · FC.air).
 * Drag left: Low ↕ · right: High ↕ · bottom rail: Amount.
 * Double-click: flatten / cycle characters.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { AirArch } from "@/audio/dsp/mixClarity";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  cachedGrad,
  drawGlow,
  footer,
  glowStroke,
  grain,
  hexA,
  lattice,
  lit,
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 176;
const C = FC.air;
const C_DEEP = bandShade(FC_BAND.mix, 0.3);
const C_MID = bandShade(FC_BAND.mix, 0.5);
const C_HOT = bandShade(FC_BAND.mix, 0.66);
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
const C_LOW = bandShade(FC_BAND.mix, 0.4);
const C_HIGH = bandShade(FC_BAND.mix, 0.78);
const C_AMT = bandShade(FC_BAND.mix, 0.86);

const CHAR_CYCLE = [
  { low: 0, high: 0, amt: 0 },
  { low: 0.45, high: -0.15, amt: 0.55 },
  { low: -0.1, high: 0.55, amt: 0.6 },
  { low: 0, high: 0.7, amt: 0.65 },
  { low: 0.55, high: 0.35, amt: 0.5 },
  { low: -0.35, high: 0.5, amt: 0.55 },
] as const;

type DragMode = "low" | "high" | "amt" | null;

/** Log frequency axis: 20 Hz → 20 kHz across the plot. */
const F_LO = 20;
const F_HI = 20000;
const F_SPAN = Math.log(F_HI / F_LO);

/** Shelf corners the DSP uses — the plot's landmarks. */
const F_LOW_SHELF = 180;
const F_HIGH_SHELF = 6500;
const F_PIVOT = 1000;

/** Grid reach: ±12 dB, matching the low shelf's full travel. */
const SPAN_DB = 12;
const CURVE_STEPS = 160;

/**
 * The ruler doubles as the landmark row: the shelf corners and the tilt pivot
 * are decades in their own right, so no second label row is needed.
 */
type RulerTick = { hz: number; label: string; major: boolean; mark?: "low" | "pivot" | "high" };
const RULER: RulerTick[] = [
  { hz: 20, label: "20", major: true },
  { hz: 50, label: "50", major: false },
  { hz: 100, label: "100", major: false },
  { hz: 180, label: "180", major: true, mark: "low" },
  { hz: 500, label: "500", major: false },
  { hz: 1000, label: "1k", major: true, mark: "pivot" },
  { hz: 2000, label: "2k", major: false },
  { hz: 6500, label: "6.5k", major: true, mark: "high" },
  { hz: 20000, label: "20k", major: true },
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function freqU(hz: number): number {
  return clamp(Math.log(hz / F_LO) / F_SPAN, 0, 1);
}

const U_LOW = freqU(F_LOW_SHELF);
const U_HIGH = freqU(F_HIGH_SHELF);
const U_PIVOT = freqU(F_PIVOT);

function airLabel(low: number, high: number, amt: number): string {
  if (amt < 0.03) return "FLAT";
  if (Math.abs(low) < 0.08 && Math.abs(high) < 0.08) return "IDLE";
  if (low > 0.2 && high < -0.05) return "WARM";
  if (high > 0.35 && low < 0.1) return "AIR";
  if (low > 0.25 && high > 0.2) return "LIFT";
  if (low < -0.2 && high > 0.2) return "SCOOP";
  if (low > 0.3) return "BASS";
  if (high > 0.25) return "BRIGHT";
  return "SHELF";
}

/** Mirror DSP: low ±12 dB · high ±10 dB, scaled by amount. */
function airMetrics(low: number, high: number, amt: number) {
  const a = clamp(amt, 0, 1);
  return {
    lowDb: clamp(low, -1, 1) * 12 * a,
    highDb: clamp(high, -1, 1) * 10 * a,
  };
}

/**
 * Shelf response in dB at a normalized frequency.
 *
 * `dual` sums two independent shelves with half-octave transitions; `tilt`
 * collapses them into one see-saw pivoting at 1 kHz, which is the whole point of
 * the arch switch and the one thing the old panel could not show.
 */
function shelfDb(u: number, lowDb: number, highDb: number, arch: AirArch): number {
  if (arch === "tilt") {
    const amount = (highDb - lowDb) * 0.5;
    return amount * Math.tanh((u - U_PIVOT) / 0.18);
  }
  const lo = 1 / (1 + Math.exp((u - U_LOW) / 0.052));
  const hi = 1 / (1 + Math.exp(-(u - U_HIGH) / 0.052));
  return lowDb * lo + highDb * hi;
}

export type AirVizState = {
  low: number;
  high: number;
  amt: number;
  enabled: boolean;
  arch: AirArch;
  msMode: boolean;
};

/**
 * Paint the shelf plot. Exported and pure — and time-invariant, so `now` is
 * unused: this panel looks identical on every frame until a param moves.
 */
export function paintAir(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: AirVizState,
  now: number,
  flash: number,
): void {
  const on = p.enabled;
  const lowV = on ? clamp(p.low, -1, 1) : 0;
  const highV = on ? clamp(p.high, -1, 1) : 0;
  const amt = on ? clamp(p.amt, 0, 1) : 0;
  const arch = p.arch;
  const m = airMetrics(lowV, highV, amt);
  const energy = 0.06 + amt * 0.22 + Math.max(Math.abs(lowV), Math.abs(highV)) * amt * 0.16 + flash * 0.14;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.42 });

  // Geometry: frequency across, dB up, zero line aligned to the drag mapping.
  const padL = 34;
  const padR = 34;
  const span = Math.max(60, W - padL - padR);
  // The plot sits low and slightly shallower than the panel allows, so the top
  // dB gridline's gutter label clears the reserved top strip.
  const zeroY = Math.round(Hh * 0.44);
  const pxDb = 48 / SPAN_DB;
  const plotTop = zeroY - SPAN_DB * pxDb;
  const plotBot = zeroY + SPAN_DB * pxDb;
  const rulerY = plotBot + 10;
  const railY = Hh - 26;
  const dbY = (db: number) => zeroY - clamp(db, -SPAN_DB - 2, SPAN_DB + 2) * pxDb;
  const lowX = padL + U_LOW * span;
  const highX = padL + U_HIGH * span;
  const pivotX = padL + U_PIVOT * span;

  // Recessed plot bed + graph paper.
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, plotTop, span, plotBot - plotTop);
  ctx.clip();
  ctx.fillStyle = hexA(C_DEEP, 0.3);
  ctx.fillRect(padL, plotTop, span, plotBot - plotTop);
  lattice(ctx, W, Hh, C_MID, 14, 0.05);
  ctx.restore();
  ctx.strokeStyle = hexA(C_MID, 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(padL + 0.5, plotTop + 0.5, span - 1, plotBot - plotTop - 1);

  // ── dB grid ──
  ctx.font = VIZ_FONT_LABEL;
  for (let db = SPAN_DB; db >= -SPAN_DB; db -= 6) {
    const y = dbY(db);
    const zero = db === 0;
    ctx.fillStyle = hexA(zero ? C_GLOW : C_MID, zero ? 0.22 : 0.09);
    ctx.fillRect(padL, y, span, 1);
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(zero ? C_GLOW : C_MID, zero ? 0.55 : 0.4);
    ctx.fillText(zero ? "0" : `${db > 0 ? "+" : ""}${db}`, padL - 5, y + 3);
  }

  // ── frequency ruler, with the shelf corners called out in their own colour ──
  const labelAll = span > 520;
  const markActive = (m: RulerTick["mark"]) =>
    arch === "tilt"
      ? m === "pivot" && amt > 0.02
      : (m === "low" && Math.abs(lowV) > 0.05 && amt > 0.02) ||
        (m === "high" && Math.abs(highV) > 0.05 && amt > 0.02);
  ctx.textAlign = "center";
  for (const r of RULER) {
    const x = padL + freqU(r.hz) * span;
    const col = r.mark === "low" ? C_LOW : r.mark === "high" ? C_HIGH : r.mark === "pivot" ? C_GLOW : C_MID;
    const hot = markActive(r.mark);
    ctx.fillStyle = hexA(col, r.mark ? (hot ? 0.3 : 0.16) : r.major ? 0.12 : 0.07);
    ctx.fillRect(x - (r.mark ? 0.5 : 0), plotTop, 1, plotBot - plotTop);
    if (labelAll || r.major) {
      ctx.fillStyle = hexA(col, r.mark ? (hot ? 0.8 : 0.5) : 0.42);
      ctx.fillText(r.label, x, rulerY);
    }
  }
  if (arch === "tilt") {
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.6);
    ctx.fillText("PIVOT", pivotX + 5, plotTop + 10);
  }

  // ── the curve ──
  const traceAt = (scale: number) => {
    for (let i = 0; i <= CURVE_STEPS; i++) {
      const u = i / CURVE_STEPS;
      const x = padL + u * span;
      const y = dbY(shelfDb(u, m.lowDb * scale, m.highDb * scale, arch));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  // Fill from the curve to the zero line — signed, so cuts read as cuts.
  ctx.beginPath();
  traceAt(1);
  ctx.lineTo(padL + span, zeroY);
  ctx.lineTo(padL, zeroY);
  ctx.closePath();
  const fill = cachedGrad(ctx, `airfill|${plotTop | 0}|${plotBot | 0}|${(amt * 20) | 0}`, (c) => {
    const g = c.createLinearGradient(0, plotTop, 0, plotBot);
    g.addColorStop(0, hexA(C_HIGH, 0.24 + amt * 0.2));
    g.addColorStop(0.5, hexA(C, 0.08 + amt * 0.08));
    g.addColorStop(1, hexA(C_LOW, 0.24 + amt * 0.2));
    return g;
  });
  ctx.fillStyle = fill;
  ctx.fill();

  if (p.msMode) {
    // M/S: the side path takes a lighter hand than the mid. Two curves, so the
    // mode is visible on the plot rather than only in a chip.
    glowStroke(ctx, () => traceAt(1), C_GLOW, { width: 2, glow: 0.8, alpha: 0.9 });
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = hexA(C_HIGH, 0.62);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    traceAt(0.7);
    ctx.stroke();
    ctx.restore();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.8);
    ctx.fillText("M", padL + span + 4, dbY(shelfDb(1, m.lowDb, m.highDb, arch)) + 3);
    ctx.fillStyle = hexA(C_HIGH, 0.7);
    ctx.fillText("S", padL + span + 4, dbY(shelfDb(1, m.lowDb * 0.7, m.highDb * 0.7, arch)) + 3);
  } else {
    glowStroke(ctx, () => traceAt(1), C_GLOW, { width: 2.2 + amt * 0.8, glow: 1, alpha: 0.92 });
  }

  // ── shelf handles ──
  const handles = arch === "tilt"
    ? [
        { x: pivotX - span * 0.16, db: shelfDb(U_PIVOT - 0.16, m.lowDb, m.highDb, arch), col: C_LOW, label: "L" },
        { x: pivotX + span * 0.16, db: shelfDb(U_PIVOT + 0.16, m.lowDb, m.highDb, arch), col: C_HIGH, label: "H" },
      ]
    : [
        { x: lowX, db: m.lowDb, col: C_LOW, label: "L" },
        { x: highX, db: m.highDb, col: C_HIGH, label: "H" },
      ];
  for (const h of handles) {
    const y = dbY(h.db);
    const active = Math.abs(h.db) > 0.4;
    ctx.strokeStyle = hexA(h.col, active ? 0.4 : 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(h.x, zeroY);
    ctx.lineTo(h.x, y);
    ctx.stroke();
    lit(ctx, () => drawGlow(ctx, h.x, y, 11 + (active ? 5 : 0) + flash * 4, h.col, 0.6));
    ctx.fillStyle = hexA(C_GLOW, 0.95);
    ctx.beginPath();
    ctx.arc(h.x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(h.col, 0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(h.x, y, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(h.col, 0.85);
    ctx.fillText(h.label, h.x, y - 10);
  }

  // ── readouts ──
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so they can't collide at any panel width.
  ctx.textAlign = "left";
  let telX = VIZ_TOP_LABEL_X;
  const telRight = W * 0.5 - 52;
  const tel = (text: string, color: string, alpha: number, font: string) => {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    if (telX + w > telRight) return;
    ctx.fillStyle = hexA(color, alpha);
    ctx.fillText(text, telX, VIZ_TOP_LABEL_Y);
    telX += w + 14;
  };
  tel(`L ${m.lowDb >= 0 ? "+" : ""}${m.lowDb.toFixed(1)} dB`, C_LOW, 0.78, VIZ_FONT_VALUE);
  tel(`H ${m.highDb >= 0 ? "+" : ""}${m.highDb.toFixed(1)} dB`, C_HIGH, 0.78, VIZ_FONT_VALUE);
  if (arch === "tilt") {
    const tiltDb = (m.highDb - m.lowDb) * 0.5;
    tel(`TILT ${tiltDb >= 0 ? "+" : ""}${tiltDb.toFixed(1)} dB`, C_AMT, 0.7, VIZ_FONT_LABEL);
  }

  pill(
    ctx,
    W * 0.5,
    2,
    !on ? "ASLEEP" : p.msMode ? `${arch === "tilt" ? "TILT" : "DUAL SHELF"} · M/S` : arch === "tilt" ? "TILT" : "DUAL SHELF",
    on ? C_GLOW : C_MID,
    { glow: flash, height: 12 },
  );

  // ── amount rail ──
  const railPad = 14;
  const railW = W - railPad * 2;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railPad, railY, railW, 6);
  ctx.fillStyle = hexA(C_AMT, 0.55 + flash * 0.25);
  ctx.fillRect(railPad, railY + 1, Math.max(2, railW * amt), 4);
  for (const notch of [0, 0.25, 0.5, 0.75, 1]) {
    const nx = railPad + notch * railW;
    const active = Math.abs(amt - notch) < 0.04;
    ctx.fillStyle = hexA(active ? C_GLOW : C_AMT, active ? 0.9 : 0.3);
    ctx.fillRect(nx - 1, railY - 2, 2, 10);
  }
  lit(ctx, () => drawGlow(ctx, railPad + railW * amt, railY + 3, 8 + flash * 5, C_GLOW, 0.85));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_AMT, 0.6);
  ctx.fillText("AMOUNT", railPad, railY - 4);

  if (!on) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, Hh);
  }

  grain(ctx, W, Hh, 0.022);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    on ? "SKY SHELF" : "SKY SHELF · ASLEEP",
    `${airLabel(lowV, highV, amt)} · A${Math.round(amt * 100)}`,
    C_GLOW,
    on ? C_HOT : C_MID,
  );
}

export function AirStageViz() {
  const low = useFireCommandStore((s) => s.patch.airLow) ?? 0;
  const high = useFireCommandStore((s) => s.patch.airHigh) ?? 0;
  const amt = useFireCommandStore((s) => s.patch.airAmount) ?? 0;
  const arch = (useFireCommandStore((s) => s.patch.airArch) ?? "dual") as AirArch;
  const msMode = useFireCommandStore((s) => s.patch.airMsMode) === true;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["air"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<AirVizState>({ low, high, amt, enabled, arch, msMode });
  st.current = { low, high, amt, enabled, arch, msMode };

  const live = enabled && amt > 0.03 && (Math.abs(low) > 0.04 || Math.abs(high) > 0.04);

  useEffect(() => {
    const key = motionHash(low, high, amt, enabled, arch === "tilt", msMode);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [low, high, amt, enabled, arch, msMode]);

  const hitTest = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return "amt";
    const rect = wrap.getBoundingClientRect();
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    if (y > 0.82) return "amt";
    return x < 0.5 ? "low" : "high";
  }, [wrapRef]);

  const applyAt = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "amt") {
        setParam("airAmount", Math.round(x * 1000) / 1000);
        return;
      }
      // Vertical: top = +1, bottom = -1 (within main plot area)
      const plotY = clamp((y - 0.06) / 0.72, 0, 1);
      const v = Math.round((1 - plotY * 2) * 1000) / 1000; // 1 → -1
      if (mode === "low") setParam("airLow", clamp(v, -1, 1));
      else setParam("airHigh", clamp(v, -1, 1));
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const mode = hitTest(e.clientX, e.clientY);
      dragRef.current = mode;
      flashRef.current = 1;
      applyAt(e.clientX, e.clientY, mode);
    },
    [applyAt, hitTest],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      applyAt(e.clientX, e.clientY, dragRef.current);
    },
    [applyAt],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < CHAR_CYCLE.length; i++) {
      const c = CHAR_CYCLE[i]!;
      const d = Math.abs(c.low - cur.low) + Math.abs(c.high - cur.high) + Math.abs(c.amt - cur.amt);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = CHAR_CYCLE[(best + 1) % CHAR_CYCLE.length]!;
    setParam("airLow", next.low);
    setParam("airHigh", next.high);
    setParam("airAmount", next.amt);
    flashRef.current = 1;
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.9;
        paintAir(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        // Nothing here animates — the plot only needs a frame when a param moves.
        active: false,
        dragging: !!dragRef.current,
        particles: 0,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.low,
          st.current.high,
          st.current.amt,
          st.current.enabled,
          st.current.arch === "tilt",
          st.current.msMode,
        ),
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] cursor-crosshair touch-none select-none"
      style={{
        borderColor: `${C}${live ? "77" : "44"}`,
        height: H,
        boxShadow: live
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 28px ${C}33, 0 6px 20px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="img"
      aria-label="Air sky shelf — left Low, right High, bottom Amount"
      title="Left ↕ Low · Right ↕ High · Bottom rail Amount · Double-click cycles characters"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t rounded-tl" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t rounded-tr" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l rounded-bl" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r rounded-br" style={{ borderColor: `${C}88` }} />
    </div>
  );
}
