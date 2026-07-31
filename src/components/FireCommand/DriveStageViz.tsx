/**
 * Drive — Shape Crucible stage visualizer.
 *
 * IDIOM: the transfer function and what it manufactures. Stages are a ~10:1
 * letterbox, so the panel reads left → right as cause → effect: the input→output
 * curve sits at the left as the hero, and the harmonic ladder it generates runs
 * along the rest of the width as a partial-index axis. Nothing is radial — the
 * curve is a wide field, the ladder is a march of columns.
 *
 * The ladder is a real DFT of the shaped sine, so the modes separate honestly:
 * `fold` sprays high partials, `hard` stacks odd ones, `fuzz` fills the series,
 * and bias/symmetry break the waveform's symmetry — which is exactly what lights
 * the even partials. Tone draws its roll-off straight over the ladder.
 *
 * Drive · mode · bias · symmetry · crush · tone (Signal Path FX · FC.drive).
 * Drag: Drive ↔ · Left zone Bias ↕ · Right zone Crush ↕. Bottom: Tone.
 * Double-click: cycle mode.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { DriveMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
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
  lit,
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 176;
const C = FC.drive;
const C_DEEP = bandShade(FC.fx, 0.18);
const C_MID = bandShade(FC.fx, 0.4);
const C_HOT = bandShade(FC.fx, 0.62);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_DRV = bandShade(FC.fx, 0.5);
const C_CRUSH = bandShade(FC.fx, 0.72);
const C_TONE = bandShade(FC.fx, 0.85);
const C_EVEN = bandShade(FC.fx, 0.66);

const TONE_MIN = 1000;
const TONE_MAX = 18000;

const MODE_CYCLE: DriveMode[] = ["soft", "tube", "fold", "hard", "fuzz"];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Deterministic scatter — a fixed field, so idle sparks don't crawl. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Mirrors the DSP's waveshapers so the drawn curve is the real one. */
function xfer(xIn: number, mode: DriveMode, drive: number, bias = 0, symmetry = 0): number {
  const b = clamp(bias, -1, 1) * 0.35;
  const sym = clamp(symmetry, -1, 1);
  const x = xIn + b;
  if (drive <= 0.001) return clamp(xIn, -1.2, 1.2);
  switch (mode) {
    case "tube": {
      const k = 1 + drive * 7;
      let y = x >= 0 ? Math.tanh(k * x) : Math.tanh(k * (0.55 + sym * 0.25) * x);
      y /= Math.tanh(k) || 1;
      return clamp(y, -1.2, 1.2);
    }
    case "fold": {
      const g = 1 + drive * (5 + Math.abs(sym) * 2);
      let y = Math.sin(x * g * Math.PI * 0.5);
      if (sym > 0.2) y = Math.sin(y * Math.PI * (0.5 + sym * 0.4));
      return clamp(y, -1.2, 1.2);
    }
    case "hard": {
      const g = 1 + drive * 9;
      const pos = clamp(x * g * (1 + sym * 0.3), -1, 1);
      const neg = clamp(x * g * (1 - sym * 0.3), -1, 1);
      return x >= 0 ? pos : neg;
    }
    case "fuzz": {
      const k = 1 + drive * 22;
      let y = Math.tanh(k * x);
      if (sym > 0.35 && x > 0) y = Math.abs(y);
      return clamp(y, -1.2, 1.2);
    }
    default: {
      const k = 1 + drive * 8;
      return clamp(Math.tanh(k * x) / (Math.tanh(k) || 1), -1.2, 1.2);
    }
  }
}

// ── harmonic analysis ────────────────────────────────────────────────────
// One period of a shaped sine, then a small DFT. Twiddles are baked once at
// module load; the per-frame cost is a few thousand multiply-adds.

const HARM_MAX = 30;
const DFT_N = 128;
const COS_T = new Float32Array(HARM_MAX * DFT_N);
const SIN_T = new Float32Array(HARM_MAX * DFT_N);
for (let k = 0; k < HARM_MAX; k++) {
  for (let n = 0; n < DFT_N; n++) {
    const a = (2 * Math.PI * (k + 1) * n) / DFT_N;
    COS_T[k * DFT_N + n] = Math.cos(a);
    SIN_T[k * DFT_N + n] = Math.sin(a);
  }
}
const WAVE = new Float32Array(DFT_N);
const MAG = new Float32Array(HARM_MAX);

/** Fill `MAG[0..nH)` with partial magnitudes; returns the peak for normalising. */
function analyseHarmonics(p: DriveVizState, nH: number): number {
  const steps = p.crush > 0.02 ? Math.max(2, Math.round(2 + (1 - p.crush) * 48)) : 0;
  for (let n = 0; n < DFT_N; n++) {
    let x = Math.sin((2 * Math.PI * n) / DFT_N);
    if (steps) x = Math.round(x * steps) / steps;
    WAVE[n] = xfer(x, p.mode, p.drive, p.bias, p.symmetry);
  }
  let peak = 1e-6;
  for (let k = 0; k < nH; k++) {
    let re = 0;
    let im = 0;
    const off = k * DFT_N;
    for (let n = 0; n < DFT_N; n++) {
      const v = WAVE[n]!;
      re += v * COS_T[off + n]!;
      im += v * SIN_T[off + n]!;
    }
    const m = Math.sqrt(re * re + im * im) / DFT_N;
    MAG[k] = m;
    if (m > peak) peak = m;
  }
  return peak;
}

type DragMode = "xy" | "tone" | null;
type VertTarget = "bias" | "crush";

export type DriveVizState = {
  drive: number;
  mode: DriveMode;
  crush: number;
  tone: number;
  bias: number;
  symmetry: number;
};

/**
 * Paint the crucible. Exported and pure so a headless render only needs a 2D
 * context, a size, and a state object.
 */
export function paintDrive(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: DriveVizState,
  now: number,
  flash: number,
): void {
  const toneN = logNorm(p.tone, TONE_MIN, TONE_MAX);
  const isLive = p.drive > 0.02 || p.crush > 0.02;
  const energy = 0.1 + p.drive * 0.42 + p.crush * 0.26 + flash * 0.22;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.56 });

  // ── geometry: curve field at the left, ladder filling the rest ──
  const padL = 30;
  const padR = 18;
  const span = Math.max(120, W - padL - padR);
  const top = 34;
  // Leaves room under the art for the axis labels and the tone rail.
  const bot = Hh - 44;
  const midY = (top + bot) * 0.5;
  const halfH = (bot - top) * 0.5;
  const curveW = clamp(span * 0.28, 130, 300);
  const cx0 = padL;
  const cx1 = padL + curveW;
  const ladX0 = cx1 + 34;
  const ladW = Math.max(60, padL + span - ladX0);

  // ── transfer field ──
  // Input runs left→right across the field, output is vertical. Stretching the
  // field horizontally keeps every mode's shape intact — the fold still folds,
  // the hard clip still shows plateaus — while fitting the letterbox.
  const px = (x: number) => cx0 + (x + 1) * 0.5 * curveW;
  const py = (y: number) => midY - clamp(y, -1.15, 1.15) * halfH * 0.86;

  // Field frame: zero axes, ±1 clip rails, identity reference.
  ctx.strokeStyle = hexA(C_MID, 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx0, midY);
  ctx.lineTo(cx1, midY);
  ctx.moveTo(px(0), py(1.05));
  ctx.lineTo(px(0), py(-1.05));
  ctx.stroke();

  ctx.strokeStyle = hexA(C_HOT, 0.1 + p.drive * 0.16);
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(cx0, py(1));
  ctx.lineTo(cx1, py(1));
  ctx.moveTo(cx0, py(-1));
  ctx.lineTo(cx1, py(-1));
  ctx.stroke();
  ctx.strokeStyle = hexA(C_MID, 0.2);
  ctx.beginPath();
  ctx.moveTo(px(-1), py(-1));
  ctx.lineTo(px(1), py(1));
  ctx.stroke();
  ctx.setLineDash([]);

  // Saturated regions: contiguous input spans where the output has run out of
  // headroom. They light up, which is the whole point of the module.
  {
    const STEPS = 96;
    let runStart = -1;
    for (let i = 0; i <= STEPS; i++) {
      const x = (i / STEPS) * 2 - 1;
      const clipped = i < STEPS && Math.abs(xfer(x, p.mode, p.drive, p.bias, p.symmetry)) >= 0.92;
      if (clipped && runStart < 0) runStart = x;
      if (!clipped && runStart >= 0) {
        const x1 = px(runStart);
        const x2 = px((i / STEPS) * 2 - 1);
        const band = cachedGrad(ctx, `clip|${top}|${bot}`, (c) => {
          const g = c.createLinearGradient(0, top, 0, bot);
          g.addColorStop(0, hexA(C_HOT, 0.3));
          g.addColorStop(0.5, hexA(C_HOT, 0.03));
          g.addColorStop(1, hexA(C_HOT, 0.3));
          return g;
        });
        ctx.save();
        ctx.globalAlpha = 0.45 + p.drive * 0.4;
        ctx.fillStyle = band;
        ctx.fillRect(Math.min(x1, x2), top, Math.max(1.5, Math.abs(x2 - x1)), bot - top);
        ctx.restore();
        runStart = -1;
      }
    }
  }

  // The curve itself.
  const curvePath = () => {
    for (let i = 0; i <= 140; i++) {
      const x = (i / 140) * 2 - 1;
      const y = xfer(x, p.mode, p.drive, p.bias, p.symmetry);
      if (i === 0) ctx.moveTo(px(x), py(y));
      else ctx.lineTo(px(x), py(y));
    }
  };
  glowStroke(ctx, curvePath, C_GLOW, { width: 2.4, glow: 0.7 + p.drive * 0.9, alpha: 0.92 });

  // Sparks skittering along the saturated shoulders while the drive is hot.
  if (p.drive > 0.15) {
    lit(ctx, () => {
      const n = 4 + Math.round(p.drive * 8);
      for (let i = 0; i < n; i++) {
        const t = (hash01(i * 5.3) + now * 0.00018 * (0.4 + hash01(i * 2.1))) % 1;
        const x = t * 2 - 1;
        const y = xfer(x, p.mode, p.drive, p.bias, p.symmetry);
        if (Math.abs(y) < 0.86) continue;
        drawGlow(ctx, px(x), py(y), 5 + hash01(i * 9.7) * 7, C_GLOW, 0.16 + p.drive * 0.3);
      }
    });
  }

  // Bias shifts the input the shaper actually sees — mark where zero landed.
  if (Math.abs(p.bias) > 0.02) {
    const bx = px(-clamp(p.bias, -1, 1) * 0.35);
    ctx.strokeStyle = hexA(C_DRV, 0.5);
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(bx, top + 4);
    ctx.lineTo(bx, bot - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = VIZ_FONT_LABEL;
    ctx.fillStyle = hexA(C_DRV, 0.78);
    ctx.textAlign = "center";
    ctx.fillText(`B${p.bias >= 0 ? "+" : ""}${Math.round(p.bias * 100)}`, bx, top - 3);
  }

  // Tracer: an input sample sweeping the domain, projected up onto the curve.
  const trX = Math.sin(now / 400);
  const trY = xfer(trX, p.mode, p.drive, p.bias, p.symmetry);
  ctx.strokeStyle = hexA(C_MID, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(trX), py(trX));
  ctx.lineTo(px(trX), py(trY));
  ctx.stroke();
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.fillRect(px(trX) - 1.5, py(trX) - 1.5, 3, 3);
  lit(ctx, () => {
    drawGlow(ctx, px(trX), py(trY), 11 + flash * 6, C_GLOW, 0.55);
    ctx.fillStyle = hexA(C_GLOW, 0.95);
    ctx.beginPath();
    ctx.arc(px(trX), py(trY), 2.6 + flash, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_DRV, 0.78);
  ctx.fillText("XFER", (cx0 + cx1) * 0.5, bot + 11);
  if (Math.abs(p.symmetry) > 0.05) {
    ctx.fillStyle = hexA(C_MID, 0.68);
    ctx.fillText(`SYM ${Math.round(p.symmetry * 100)}`, (cx0 + cx1) * 0.5 + 46, bot + 11);
  }

  // ── harmonic ladder ──
  // Partial index runs left→right. Odd partials are the drive's backbone; even
  // ones only appear once bias/symmetry make the waveform asymmetric.
  const nH = clamp(Math.round(ladW / 40), 10, HARM_MAX);
  const peak = analyseHarmonics(p, nH);
  const colW = ladW / nH;
  const ladBase = bot;
  const ladTop = top + 4;
  const ladH = ladBase - ladTop;

  ctx.fillStyle = hexA(C_MID, 0.2);
  ctx.fillRect(ladX0, ladBase, ladW, 1);

  // Crush raises a broadband hash floor between the partials.
  if (p.crush > 0.04) {
    ctx.fillStyle = hexA(C_CRUSH, 0.1 + p.crush * 0.22);
    const n = Math.round(nH * 3);
    for (let i = 0; i < n; i++) {
      const x = ladX0 + ((i + 0.5) / n) * ladW;
      const h = (2 + hash01(i * 3.7 + (p.crush * 40 | 0)) * 12) * (0.3 + p.crush);
      ctx.fillRect(x, ladBase - h, 1, h);
    }
  }

  for (let k = 0; k < nH; k++) {
    const part = k + 1;
    // Partial k sits at k×f0; tone's one-pole roll-off eats the top of the ladder.
    const f = 200 * part;
    const roll = 1 / Math.sqrt(1 + (f / Math.max(200, p.tone)) ** 2);
    const v = clamp((MAG[k]! / peak) * roll, 0, 1);
    const h = Math.max(v > 0.004 ? 1.5 : 0, v * ladH * 0.94);
    const x = ladX0 + k * colW;
    const bw = Math.max(2, colW * 0.52);
    const even = part % 2 === 0;
    const col = even ? C_EVEN : C_GLOW;

    const g = cachedGrad(ctx, `bar|${ladTop | 0}|${ladBase | 0}|${even ? 1 : 0}`, (c) => {
      const lg = c.createLinearGradient(0, ladTop, 0, ladBase);
      lg.addColorStop(0, hexA(even ? C_EVEN : C_HOT, 0.85));
      lg.addColorStop(1, hexA(C_DEEP, 0.2));
      return lg;
    });
    ctx.save();
    ctx.globalAlpha = 0.35 + v * 0.55;
    ctx.fillStyle = g;
    ctx.fillRect(x, ladBase - h, bw, h);
    ctx.restore();

    if (h > 2) {
      ctx.fillStyle = hexA(col, 0.55 + v * 0.45);
      ctx.fillRect(x, ladBase - h, bw, 1.6);
      if (v > 0.1) lit(ctx, () => drawGlow(ctx, x + bw * 0.5, ladBase - h, 6 + v * 16, col, v * 0.5));
    }

    // Sparse index ticks — enough to read the series without a wall of digits.
    if (part === 1 || part % 4 === 0) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_MID, 0.42);
      ctx.fillText(`${part}`, x + bw * 0.5, ladBase + 11);
    }
  }

  // Tone roll-off drawn over the ladder as the curve that shaped it.
  ctx.strokeStyle = hexA(C_TONE, 0.28 + toneN * 0.3);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const f = 200 * (1 + u * (nH - 1));
    const roll = 1 / Math.sqrt(1 + (f / Math.max(200, p.tone)) ** 2);
    const x = ladX0 + u * ladW;
    if (i === 0) ctx.moveTo(x, ladBase - roll * ladH * 0.94);
    else ctx.lineTo(x, ladBase - roll * ladH * 0.94);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_HOT, 0.7);
  ctx.fillText("HARMONICS", ladX0, top - 3);
  ctx.fillStyle = hexA(C_EVEN, 0.6);
  ctx.fillText("EVEN", ladX0 + 74, top - 3);
  ctx.fillStyle = hexA(C_GLOW, 0.6);
  ctx.fillText("ODD", ladX0 + 118, top - 3);
  if (p.crush > 0.06) {
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_CRUSH, 0.75);
    ctx.fillText(`${Math.max(2, Math.round((1 - p.crush) * 16))}b`, ladX0 + ladW, top - 3);
  }

  // ── controls / telemetry ──
  const hx = p.drive * W;
  const hy = (1 - p.crush) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, p.drive < 0.02 ? "CLEAN" : p.mode.toUpperCase(), C_GLOW, { glow: flash });

  // Tone rail, clear of the footer band.
  const railY = Hh - 26;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  const fill = cachedGrad(ctx, `tone|${W}`, (c) => {
    const g = c.createLinearGradient(12, 0, 12 + (W - 24), 0);
    g.addColorStop(0, hexA(C_TONE, 0.3));
    g.addColorStop(1, hexA(C_GLOW, 0.8));
    return g;
  });
  ctx.fillStyle = fill;
  ctx.fillRect(12, railY + 1, Math.max(2, railW * toneN), 4);
  lit(ctx, () => drawGlow(ctx, 12 + railW * toneN, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_TONE, 0.8);
  const toneLabel = p.tone >= 1000 ? `${(p.tone / 1000).toFixed(1)}k` : `${Math.round(p.tone)}`;
  ctx.fillText(`TONE ${toneLabel}`, 14, railY - 3);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "DRIVE · SHAPE CRUCIBLE",
    !isLive ? "CLEAN" : `D${Math.round(p.drive * 100)} · C${Math.round(p.crush * 100)} · ${p.mode}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function DriveStageViz() {
  const drive = useFireCommandStore((s) => s.patch.drive) ?? 0;
  const mode = (useFireCommandStore((s) => s.patch.driveMode) ?? "soft") as DriveMode;
  const crush = useFireCommandStore((s) => s.patch.crush) ?? 0;
  const tone = useFireCommandStore((s) => s.patch.tone) ?? 15000;
  const bias = useFireCommandStore((s) => s.patch.driveBias) ?? 0;
  const symmetry = useFireCommandStore((s) => s.patch.driveSymmetry) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const vertRef = useRef<VertTarget>("crush");
  const prevKey = useRef(0);
  const st = useRef<DriveVizState>({ drive, mode, crush, tone, bias, symmetry });
  st.current = { drive, mode, crush, tone, bias, symmetry };

  const live = drive > 0.02 || crush > 0.02 || Math.abs(bias) > 0.02;

  useEffect(() => {
    const key = motionHash(drive, MODE_CYCLE.indexOf(mode), crush, tone, bias, symmetry);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [drive, mode, crush, tone, bias, symmetry]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("drive", Math.round(x * 1000) / 1000);
      if (vertRef.current === "bias") {
        setParam("driveBias", Math.round((1 - y * 2) * 1000) / 1000);
      } else {
        setParam("crush", Math.round((1 - y) * 1000) / 1000);
      }
    },
    [setParam, wrapRef],
  );

  const applyTone = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("tone", Math.round(logLerp(x, TONE_MIN, TONE_MAX)));
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "tone";
        wrap.setPointerCapture(e.pointerId);
        applyTone(e.clientX);
        return;
      }
      const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      vertRef.current = x < 0.42 ? "bias" : "crush";
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyTone, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "tone") applyTone(e.clientX);
    },
    [applyXy, applyTone],
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
    setParam("driveMode", next);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintDrive(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.drive ?? 0) > 0.02 || (st.current.crush ?? 0) > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.drive,
          MODE_CYCLE.indexOf(st.current.mode),
          st.current.crush,
          st.current.tone,
          st.current.bias,
          st.current.symmetry,
        ),
      }),
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, live ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Drive ↔ · Left: Bias ↕ · Right: Crush ↕ · Bottom: Tone · Double-click: cycle mode"
      role="img"
      aria-label="Drive shape crucible"
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
        Shape Crucible
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? mode : "CLEAN"}
      </div>
    </div>
  );
}
