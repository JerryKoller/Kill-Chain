/**
 * Reverb — Halo Vault stage visualizer.
 *
 * IDIOM: the decay field. Stages are a ~10:1 letterbox, so this reads left to
 * right as time — the shape a reverb actually has. A strike at the left throws
 * early reflections as hard spikes, the tail blooms and smears rightward as far
 * as `size` carries it, and the field mirrors around a floor line so it reads as
 * an impulse response rather than an abstract glow.
 *
 * Damp eats the bright upper band before the dark lower one; `lowDecay` extends
 * the low band past it, so you can see the tail's tilt as well as its length.
 *
 * Size · Diff · Damp · Pre · Early · LowDecay · Mix (Signal Path FX · FC.reverb).
 * Drag: Size ↔ / Diff ↕. Top: Pre. Right: Damp. Bottom: Mix.
 * Double-click: cycle mix 0→50→100.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  drawGlow,
  footer,
  glowStroke,
  grain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  strata,
  VIZ_FONT_LABEL,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 188;
const C = FC.reverb;
const C_DEEP = bandShade(FC.fx, 0.4);
const C_MID = bandShade(FC.fx, 0.55);
const C_HOT = bandShade(FC.fx, 0.72);
const C_GLOW = bandShade(FC.fx, 0.94);
const C_DAMP = bandShade(FC.fx, 0.68);
const C_PRE = bandShade(FC.fx, 0.78);
const C_MIX = bandShade(FC.fx, 0.9);

const SIZE_MIN = 0.3;
const SIZE_MAX = 6;
const PRE_MAX = 0.2;
const MIX_CYCLE = [0, 0.5, 1] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

type DragMode = "xy" | "mix" | "pre" | "damp" | null;

export type RevState = { size: number; damp: number; pre: number; diff: number; mix: number; early: number; lowDecay: number };

/** Deterministic scatter — a fixed field, so the tail doesn't crawl when idle. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Paint the decay field. Exported and pure so it can be rendered (and eyeballed)
 * without mounting the component or waiting on a RAF frame.
 */
export function paintReverb(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: RevState,
  now: number,
  flash: number,
): void {
  const sizeN = logNorm(p.size, SIZE_MIN, SIZE_MAX);
  const preN = p.pre / PRE_MAX;
  const earlyN = clamp(p.early ?? 0.45, 0, 1);
  const lowDec = clamp(p.lowDecay ?? 0.55, 0, 1);
  const isLive = p.mix > 0.02;
  const energy = 0.08 + p.mix * 0.4 + sizeN * 0.16 + flash * 0.2;
  const bright = 1 - p.damp * 0.55;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.52 });

  // Geometry: a strike point, then time running right.
  const padL = 34;
  const padR = 22;
  const span = Math.max(40, W - padL - padR);
  const floorY = Hh * 0.54;
  const strikeX = padL + preN * span * 0.16;
  // Tail reach: size carries energy right, damp pulls it back in.
  const reach = span * (0.18 + sizeN * 0.78) * (0.55 + p.mix * 0.45);
  const bandH = Hh * 0.3;

  // Time ruler under the floor — quiet ticks, brighter at the tail end.
  ctx.save();
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = padL + t * span;
    const a = 0.05 + (t < (reach / span) ? 0.06 : 0);
    ctx.fillStyle = hexA(C_MID, a);
    ctx.fillRect(x, floorY + bandH * 0.62, 1, 5);
  }
  ctx.restore();

  // Floor line — the reflection axis.
  ctx.fillStyle = hexA(C_MID, 0.22);
  ctx.fillRect(padL, floorY, span, 1);

  // ── the decay envelope ──
  // Two bands: the bright (high-frequency) band dies at damp's rate, the low
  // band rides lowDecay further out. Drawn as mirrored filled envelopes.
  const drawBand = (
    lenScale: number,
    heightScale: number,
    color: string,
    alpha: number,
    jag: number,
  ) => {
    const len = Math.max(8, reach * lenScale);
    const steps = 46;
    ctx.beginPath();
    ctx.moveTo(strikeX, floorY);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = strikeX + t * len;
      // Exponential decay with an early-reflection shelf at the front.
      const decay = Math.exp(-t * (2.4 + (1 - lowDec) * 1.6));
      const shelf = t < 0.16 ? 1 + earlyN * (1 - t / 0.16) * 0.8 : 1;
      // Diffusion smooths the contour; low diffusion stays spiky.
      const rough = 1 + (hash01(i * 3.1 + lenScale * 17) - 0.5) * jag * (1 - p.diff * 0.75);
      const h = bandH * heightScale * decay * shelf * rough * (0.25 + p.mix * 0.75);
      ctx.lineTo(x, floorY - h);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = strikeX + t * len;
      const decay = Math.exp(-t * (2.4 + (1 - lowDec) * 1.6));
      const shelf = t < 0.16 ? 1 + earlyN * (1 - t / 0.16) * 0.8 : 1;
      const rough = 1 + (hash01(i * 3.1 + lenScale * 17 + 91) - 0.5) * jag * (1 - p.diff * 0.75);
      // Mirror sits slightly shallower so the field reads as lit from above.
      const h = bandH * heightScale * 0.82 * decay * shelf * rough * (0.25 + p.mix * 0.75);
      ctx.lineTo(x, floorY + h);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(color, alpha);
    ctx.fill();
  };

  // Low band first (furthest reach, dimmest), then the damped bright band.
  drawBand(0.7 + lowDec * 0.55, 0.62, C_DEEP, (0.3 + p.mix * 0.3), 0.5);
  drawBand(0.55 + bright * 0.5, 0.9 * bright, C_HOT, (0.16 + p.mix * 0.26) * bright, 0.75);

  // Diffusion haze: the smeared continuum between discrete reflections.
  if (p.diff > 0.08) {
    lit(ctx, () => {
      const n = 5 + Math.round(p.diff * 7);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = strikeX + t * reach;
        const decay = Math.exp(-t * 2.2);
        drawGlow(
          ctx,
          x,
          floorY,
          (10 + t * 26 + p.diff * 18) * (0.6 + sizeN * 0.6),
          C_MID,
          decay * p.diff * (0.05 + p.mix * 0.22),
        );
      }
    });
  }

  // ── early reflections: hard, discrete, near the strike ──
  lit(ctx, () => {
    const nEarly = 3 + Math.round(earlyN * 7);
    for (let i = 0; i < nEarly; i++) {
      const t = Math.pow((i + 0.35) / nEarly, 1.5);
      const x = strikeX + t * reach * 0.34;
      const decay = Math.exp(-t * 2.6);
      const h = bandH * (0.55 + earlyN * 0.6) * decay * (0.3 + p.mix * 0.7);
      const a = (0.28 + earlyN * 0.55) * decay * (0.35 + p.mix * 0.65);
      ctx.strokeStyle = hexA(C_GLOW, a);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x, floorY - h);
      ctx.lineTo(x, floorY + h * 0.8);
      ctx.stroke();
      drawGlow(ctx, x, floorY, h * 0.85, C_GLOW, a * 0.5);
    }
    // The strike itself — pulses while the reverb is live.
    const pulse = isLive ? 0.6 + 0.4 * Math.sin(now * 0.004) : 0.35;
    drawGlow(ctx, strikeX, floorY, 16 + p.mix * 18 + flash * 12, C_GLOW, (0.2 + p.mix * 0.45) * pulse);
    ctx.fillStyle = hexA(C_GLOW, 0.9);
    ctx.fillRect(strikeX - 0.5, floorY - bandH * 0.95, 1.5, bandH * 1.75);
  });

  // Predelay: the dead gap before the strike (drawn on the floor line only —
  // its readout lives in the top label row so it can't sit on the envelope).
  if (preN > 0.01) {
    ctx.fillStyle = hexA(C_PRE, 0.34);
    ctx.fillRect(padL, floorY - 1, strikeX - padL, 1);
  }

  // Tail-end marker: where size finally runs out.
  const tailX = strikeX + reach;
  ctx.strokeStyle = hexA(C_MIX, 0.3 + flash * 0.25);
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tailX, floorY - bandH * 0.8);
  ctx.lineTo(tailX, floorY + bandH * 0.8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MIX, 0.7);
  ctx.fillText(`${p.size.toFixed(1)}s`, Math.min(W - 4, tailX - 3), floorY - bandH * 0.8 - 3);

  // ── rails / telemetry ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  // Starts past VIZ_TOP_LABEL_X so it clears the DOM "Halo Vault" eyebrow
  // that sits over the canvas's top-left corner.
  const lx0 = VIZ_TOP_LABEL_X;
  ctx.fillStyle = hexA(C_HOT, 0.7);
  ctx.fillText(`EARLY ${Math.round(earlyN * 100)}`, lx0, VIZ_TOP_LABEL_Y);
  ctx.fillStyle = hexA(C_MID, 0.62);
  ctx.fillText(`LOW DEC ${Math.round(lowDec * 100)}`, lx0 + 78, VIZ_TOP_LABEL_Y);
  ctx.fillStyle = hexA(C_DAMP, 0.62);
  ctx.fillText(`DAMP ${Math.round(p.damp * 100)}`, lx0 + 172, VIZ_TOP_LABEL_Y);
  ctx.fillStyle = hexA(C_PRE, 0.62);
  ctx.fillText(`PRE ${Math.round(p.pre * 1000)}ms`, lx0 + 250, VIZ_TOP_LABEL_Y);

  // Damp rail (right edge).
  const dampX = W - 10;
  const dampTop = Hh * 0.14;
  const dampH = Hh * 0.5;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(dampX - 3, dampTop, 5, dampH);
  const dampFillH = dampH * p.damp;
  ctx.fillStyle = hexA(C_DAMP, 0.35 + p.damp * 0.5);
  ctx.fillRect(dampX - 2, dampTop + dampH - dampFillH, 3, dampFillH);
  lit(ctx, () => drawGlow(ctx, dampX - 0.5, dampTop + dampH - dampFillH, 5, C_GLOW, 0.75));

  // Size / Diff crosshair.
  const hx = padL + sizeN * span;
  const hy = Hh * 0.1 + (1 - p.diff) * (Hh * 0.28);
  ctx.strokeStyle = hexA(C_GLOW, 0.26 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 6, hy);
  ctx.lineTo(hx + 6, hy);
  ctx.moveTo(hx, hy - 6);
  ctx.lineTo(hx, hy + 6);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, !isLive ? "DRY" : p.size > 4 ? "HALL" : p.size < 1 ? "ROOM" : "VAULT", C_GLOW, { glow: flash });

  // Mix rail along the bottom, clear of the footer band.
  const railY = Hh - 25;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, W - 24, 6);
  ctx.fillStyle = hexA(C_MIX, 0.55);
  ctx.fillRect(12, railY + 1, Math.max(2, (W - 24) * p.mix), 4);
  lit(ctx, () => drawGlow(ctx, 12 + (W - 24) * p.mix, railY + 3, 7 + flash * 4, C_GLOW, 0.8));

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  // Mix reads in the footer rather than as its own label stacked on the rail.
  footer(
    ctx,
    W,
    Hh,
    "REV · HALO VAULT",
    !isLive
      ? "DRY"
      : `${p.size.toFixed(1)}s · Δ${Math.round(p.diff * 100)} · M${Math.round(p.mix * 100)}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function ReverbStageViz() {
  const size = useFireCommandStore((s) => s.patch.reverbSize) ?? 2.2;
  const damp = useFireCommandStore((s) => s.patch.reverbDamp) ?? 0.45;
  const pre = useFireCommandStore((s) => s.patch.reverbPredelay) ?? 0.02;
  const diff = useFireCommandStore((s) => s.patch.reverbDiffusion) ?? 0.7;
  const mix = useFireCommandStore((s) => s.patch.reverbMix) ?? 0;
  const early = useFireCommandStore((s) => s.patch.reverbEarly) ?? 0.45;
  const lowDecay = useFireCommandStore((s) => s.patch.reverbLowDecay) ?? 0.55;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<RevState>({ size, damp, pre, diff, mix, early, lowDecay });
  st.current = { size, damp, pre, diff, mix, early, lowDecay };

  const live = mix > 0.02;

  useEffect(() => {
    const key = motionHash(size, damp, pre, diff, mix, early, lowDecay);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [size, damp, pre, diff, mix, early, lowDecay]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0.04, 0.92);
      const y = clamp((clientY - rect.top - H * 0.12) / Math.max(1, rect.height * 0.6), 0, 1);
      setParam("reverbSize", Math.round(logLerp((x - 0.04) / 0.88, SIZE_MIN, SIZE_MAX) * 100) / 100);
      setParam("reverbDiffusion", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("reverbMix", Math.round(x * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyPre = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("reverbPredelay", Math.round(x * PRE_MAX * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyDamp = useCallback(
    (clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0.12, 0.78);
      setParam("reverbDamp", Math.round((1 - (y - 0.12) / 0.66) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      if (y < H * 0.12) {
        dragRef.current = "pre";
        wrap.setPointerCapture(e.pointerId);
        applyPre(e.clientX);
        return;
      }
      if (x > rect.width * 0.92) {
        dragRef.current = "damp";
        wrap.setPointerCapture(e.pointerId);
        applyDamp(e.clientY);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix, applyPre, applyDamp, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "mix") applyMix(e.clientX);
      else if (dragRef.current === "pre") applyPre(e.clientX);
      else if (dragRef.current === "damp") applyDamp(e.clientY);
    },
    [applyXy, applyMix, applyPre, applyDamp],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const m = st.current.mix;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < MIX_CYCLE.length; i++) {
      const d = Math.abs(MIX_CYCLE[i]! - m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setParam("reverbMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
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
        paintReverb(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.size,
          st.current.damp,
          st.current.pre,
          st.current.diff,
          st.current.mix,
          st.current.early,
          st.current.lowDecay,
        ),
      }),
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 select-none overflow-hidden rounded-2xl border-2"
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
      title="Drag: Size ↔ / Diff ↕ · Top: Pre · Right: Damp · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Reverb halo vault"
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexA(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexA(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.78) }}
      >
        Halo Vault
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] uppercase tabular-nums"
        style={{ color: hexA(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? `${size.toFixed(1)}s` : "DRY"}
      </div>
    </div>
  );
}
