/**
 * WARP — Harmonic Forge stage visualizer.
 *
 * IDIOM: the harmonic comb. Partials 1…64 stand as bars along the width, height
 * = amplitude, so the letterbox becomes a spectrum instead of a waveform — this
 * is the only source module that shows frequency rather than time. Stretch
 * slides the partials along the width, Tilt trades even against odd, Comb
 * notches whole teeth out, and the unwarped saw is always drawn behind as a
 * ghost so the transform itself is what you read.
 *
 * Stretch · Tilt · Comb · Amount · Mode (Signal Path Sources · FC.warp).
 * Drag: Stretch ↔ / Tilt ↕. Shift or bottom rail: Comb. Double-click: neutral.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { applyWarp, NUM_PARTIALS, type WarpMode } from "@/audio/dsp/wavetables";
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

const H = 168;
const N = Math.min(64, NUM_PARTIALS);
const C = FC.warp;
const C_DEEP = bandShade(FC.sources, 0.35);
const C_MID = bandShade(FC.sources, 0.48);
const C_HOT = bandShade(FC.sources, 0.66);
const C_GLOW = bandShade(FC.sources, 0.88);
const C_ST = bandShade(FC.sources, 0.55);
const C_TL = bandShade(FC.sources, 0.72);
const C_CB = bandShade(FC.sources, 0.42);

/** Partial indices worth labelling on the comb ruler. */
const TICKS = [1, 8, 16, 24, 32, 40, 48, 56, 64] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Reference saw spectrum for forge preview (matches PeriodicWave imag layout). */
function makeSawImag(count: number): Float32Array {
  const imag = new Float32Array(count + 1);
  for (let n = 1; n <= count; n++) imag[n] = 1 / n;
  return imag;
}

const BASE_SAW = makeSawImag(N);

const MODE_LABEL: Record<WarpMode, string> = {
  classic: "CLASSIC",
  scramble: "SCRAMBLE",
  subharmonic: "SUBHARMONIC",
  brickwall: "BRICKWALL",
};
/** Mode as a number, so it can ride in the allocation-free motion hash. */
const MODE_IX: Record<WarpMode, number> = { classic: 0, scramble: 1, subharmonic: 2, brickwall: 3 };

export type WarpState = {
  stretch: number;
  tilt: number;
  comb: number;
  amount: number;
  warpMode: WarpMode;
};

export function paintWarp(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: WarpState,
  now: number,
  flash: number,
): void {
  const amt = p.amount ?? 1;
  const mode = p.warpMode ?? "classic";
  const S = clamp(p.stretch * amt, -1, 1);
  const T = clamp(p.tilt * amt, -1, 1);
  const Cb = clamp(p.comb * Math.abs(amt), 0, 1);
  const dormant = Math.abs(amt) < 0.01 || (
    mode === "classic" && Math.abs(p.stretch) < 0.01 && Math.abs(p.tilt) < 0.01 && p.comb < 0.01
  );
  const energy = dormant ? 0.12 : 0.3 + (Math.abs(S) + Math.abs(T) + Cb) * 0.28;
  const eBucket = (energy * 12) | 0;

  const warped = applyWarp(BASE_SAW, S, T, Cb, mode);
  let maxAmp = 1e-3;
  for (let n = 1; n <= N; n++) maxAmp = Math.max(maxAmp, warped[n]!, BASE_SAW[n]!);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.72 });

  // ── comb geometry: partial index runs left→right, amplitude runs up ──
  const padL = 34;
  const padR = 30;
  const span = Math.max(60, W - padL - padR);
  const baseY = Hh * 0.72;
  // Bars start below the eyebrow row so the IN/OUT legend has clean air.
  const topY = Hh * 0.24;
  const usableH = baseY - topY;
  const railY = Hh - 26;
  const breath = 0.94 + 0.06 * Math.sin(now / 680);
  const barW = Math.max(2, Math.min(9, (span / N) * 0.5));
  /** Stretch is an exponent warp on the index axis, so the comb always fits. */
  const warpExp = Math.pow(2, -S);
  const xOf = (n: number) => padL + Math.pow((n - 1) / (N - 1), warpExp) * span;
  const xFlat = (n: number) => padL + ((n - 1) / (N - 1)) * span;

  // Floor + amplitude gridlines: a spectrum needs a scale, not a horizon.
  for (let g = 1; g <= 3; g++) {
    const y = baseY - (g / 3) * usableH;
    ctx.fillStyle = hexA(C_MID, 0.06);
    ctx.fillRect(padL, y, span, 1);
  }
  ctx.fillStyle = hexA(C_MID, 0.26);
  ctx.fillRect(padL, baseY, span, 1);

  // Comb teeth: shade the notched columns so the notch spacing is visible.
  if (Cb > 0.05) {
    for (let n = 2; n <= N; n++) {
      const notch = 0.5 + 0.5 * Math.cos((2 * Math.PI * n) / 4.3);
      if (notch < 0.35) continue;
      ctx.fillStyle = hexA(C_CB, 0.06 + Cb * notch * 0.2);
      ctx.fillRect(xOf(n) - barW * 0.7, topY, barW * 1.4, usableH);
    }
  }

  // ── ghost: the untouched saw, at untouched partial positions ──
  for (let n = 1; n <= N; n++) {
    const h = Math.max(1.5, (BASE_SAW[n]! / maxAmp) * usableH * breath);
    ctx.fillStyle = hexA(C_MID, dormant ? 0.3 : 0.16);
    ctx.fillRect(xFlat(n) - barW * 0.32, baseY - h, barW * 0.64, h);
  }
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hexA(C_MID, dormant ? 0.45 : 0.26);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let n = 1; n <= N; n++) {
    const y = baseY - (BASE_SAW[n]! / maxAmp) * usableH * breath;
    if (n === 1) ctx.moveTo(xFlat(n), y);
    else ctx.lineTo(xFlat(n), y);
  }
  ctx.stroke();
  ctx.restore();

  // ── the forged comb ──
  const bodyGrad = cachedGrad(ctx, `warpBar|${Hh}|${eBucket}`, (c) => {
    const g = c.createLinearGradient(0, topY, 0, baseY);
    g.addColorStop(0, hexA(C_GLOW, 0.7 + energy * 0.3));
    g.addColorStop(0.55, hexA(C_ST, 0.4 + energy * 0.3));
    g.addColorStop(1, hexA(C_DEEP, 0.08));
    return g;
  });
  for (let n = 1; n <= N; n++) {
    const a = warped[n]! / maxAmp;
    if (a <= 0.0005) continue;
    const h = Math.max(1.5, a * usableH * breath);
    const x = xOf(n);
    const even = n % 2 === 0;
    // Tilt shows as one parity dimming while the other holds.
    const parity = even ? 1 - Math.max(0, T) * 0.55 : 1 - Math.max(0, -T) * 0.55;
    ctx.globalAlpha = clamp((0.5 + energy * 0.5) * parity, 0, 1);
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x - barW * 0.5, baseY - h, barW, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = hexA(even ? C_TL : C_GLOW, (0.4 + energy * 0.5) * parity);
    ctx.fillRect(x - barW * 0.5, baseY - h, barW, 1.6);
  }

  // Contour through the forged tips — the profile you actually hear.
  glowStroke(
    ctx,
    () => {
      for (let n = 1; n <= N; n++) {
        const y = baseY - (warped[n]! / maxAmp) * usableH * breath;
        if (n === 1) ctx.moveTo(xOf(n), y);
        else ctx.lineTo(xOf(n), y);
      }
    },
    C_GLOW,
    { width: 2, glow: 0.5 + energy * 0.7, alpha: 0.4 + energy * 0.45 },
  );

  // Fundamental + brightest tip get real light.
  lit(ctx, () => {
    drawGlow(ctx, xOf(1), baseY - (warped[1]! / maxAmp) * usableH, 16 + energy * 14, C_GLOW, 0.3 + energy * 0.3);
    let peak = 1;
    for (let n = 2; n <= N; n++) if (warped[n]! > warped[peak]!) peak = n;
    if (peak !== 1) {
      drawGlow(ctx, xOf(peak), baseY - (warped[peak]! / maxAmp) * usableH, 13 + energy * 10, C_TL, 0.24 + energy * 0.26);
    }
  });

  // ── partial ruler: where each harmonic landed after the stretch ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (const n of TICKS) {
    if (n > N) continue;
    const x = xOf(n);
    ctx.fillStyle = hexA(C_MID, 0.3);
    ctx.fillRect(x - 0.5, baseY + 2, 1, 4);
    ctx.fillStyle = hexA(C_MID, 0.5);
    ctx.fillText(`${n}`, x, baseY + 15);
    // The drift line shows how far stretch moved that partial.
    if (Math.abs(S) > 0.04) {
      ctx.strokeStyle = hexA(C_ST, 0.16 + Math.abs(S) * 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xFlat(n), baseY + 6);
      ctx.lineTo(x, baseY + 2);
      ctx.stroke();
    }
  }
  const legendY = topY - 7;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MID, 0.55);
  ctx.fillText("IN", padL, legendY);
  ctx.fillStyle = hexA(C_GLOW, 0.78);
  ctx.fillText("OUT", padL + 22, legendY);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.45);
  ctx.fillText("PARTIAL", padL + span, baseY + 15);

  // Even / odd legend — makes the tilt axis readable without a label sweep.
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLOW, 0.5 + Math.max(0, -T) * 0.4);
  ctx.fillText("ODD", padL + 62, legendY);
  ctx.fillStyle = hexA(C_TL, 0.5 + Math.max(0, T) * 0.4);
  ctx.fillText("EVEN", padL + 96, legendY);

  // Stretch direction arrow, drawn on the index axis it acts on.
  if (Math.abs(S) > 0.06) {
    const ay = legendY - 4;
    const cxA = padL + span * 0.5;
    const dir = S > 0 ? 1 : -1;
    const len = 20 + Math.abs(S) * 46;
    ctx.strokeStyle = hexA(C_ST, 0.4 + Math.abs(S) * 0.45);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cxA - dir * len * 0.15, ay);
    ctx.lineTo(cxA + dir * len, ay);
    ctx.lineTo(cxA + dir * (len - 5), ay - 3);
    ctx.moveTo(cxA + dir * len, ay);
    ctx.lineTo(cxA + dir * (len - 5), ay + 3);
    ctx.stroke();
  }

  // ── comb rail (the shift-drag surface) ──
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padL, railY, span, 5);
  ctx.save();
  ctx.translate(padL, railY);
  ctx.fillStyle = cachedGrad(ctx, `warpRail|${(span / 40) | 0}`, (c) => {
    const g = c.createLinearGradient(0, 0, span, 0);
    g.addColorStop(0, hexA(C_DEEP, 0.5));
    g.addColorStop(1, hexA(C_CB, 0.95));
    return g;
  });
  ctx.fillRect(0, 0, Math.max(2, span * Cb), 5);
  ctx.restore();
  lit(ctx, () => drawGlow(ctx, padL + span * Cb, railY + 2.5, 8 + flash * 5, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_CB, 0.6);
  ctx.fillText(`COMB ${Math.round(Cb * 100)}`, padL, railY - 4);

  // Stretch / Tilt crosshair — the XY pad's read-out.
  const hx = padL + ((S + 1) / 2) * span;
  const hy = topY + ((1 - T) / 2) * usableH;
  ctx.strokeStyle = hexA(C_GLOW, dormant ? 0.15 : 0.32 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();
  ctx.fillStyle = hexA(C_HOT, 0.7);
  ctx.beginPath();
  ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
  ctx.fill();

  pill(ctx, W * 0.5, 3, MODE_LABEL[mode] ?? "CLASSIC", C_GLOW, { glow: flash });

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  const bits: string[] = [];
  if (Math.abs(S) > 0.02) bits.push(`ST ${S > 0 ? "+" : "−"}${Math.round(Math.abs(S) * 100)}`);
  if (Math.abs(T) > 0.02) bits.push(`TL ${T > 0 ? "+" : "−"}${Math.round(Math.abs(T) * 100)}`);
  if (Cb > 0.04) bits.push(`CMB ${Math.round(Cb * 100)}`);
  if (Math.abs(amt - 1) > 0.02) bits.push(`AMT ${amt > 0 ? "" : "−"}${Math.round(Math.abs(amt) * 100)}`);
  footer(
    ctx,
    W,
    Hh,
    "WARP · HARMONIC FORGE",
    dormant ? "NEUTRAL · drag to forge" : bits.join(" · "),
    C_GLOW,
    dormant ? C_MID : C_HOT,
  );
}

export function WarpStageViz() {
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const amount = useFireCommandStore((s) => s.patch.warpAmount) ?? 1;
  const warpMode = useFireCommandStore((s) => s.patch.warpMode) ?? "classic";
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragMode = useRef<"xy" | "comb" | null>(null);
  const prevKey = useRef(0);
  const st = useRef<WarpState>({ stretch, tilt, comb, amount, warpMode });
  st.current = { stretch, tilt, comb, amount, warpMode };

  const active = Math.abs(amount) > 0.01 && (
    warpMode !== "classic"
    || Math.abs(stretch) > 0.01 || Math.abs(tilt) > 0.01 || comb > 0.01
  );

  useEffect(() => {
    const key = motionHash(stretch, tilt, comb, amount, MODE_IX[warpMode]);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [stretch, tilt, comb, amount, warpMode]);

  const applyFromPointer = useCallback(
    (clientX: number, clientY: number, mode: "xy" | "comb") => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "comb") {
        setParam("warpComb", Math.round(x * 1000) / 1000);
        return;
      }
      // X → stretch (−1..1), Y → tilt (−1..1) inverted so up = bright
      setParam("warpStretch", Math.round((x * 2 - 1) * 1000) / 1000);
      setParam("warpTilt", Math.round((1 - y * 2) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mode: "xy" | "comb" = y > H * 0.78 || e.shiftKey ? "comb" : "xy";
      dragMode.current = mode;
      wrap.setPointerCapture(e.pointerId);
      applyFromPointer(e.clientX, e.clientY, mode);
    },
    [applyFromPointer, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragMode.current) return;
      applyFromPointer(e.clientX, e.clientY, dragMode.current);
    },
    [applyFromPointer],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode.current) return;
    dragMode.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("warpStretch", 0);
    setParam("warpTilt", 0);
    setParam("warpComb", 0);
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
        paintWarp(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: Math.abs(st.current.amount ?? 1) > 0.01 && (
          Math.abs(st.current.stretch ?? 0) > 0.02 || Math.abs(st.current.tilt ?? 0) > 0.02 || (st.current.comb ?? 0) > 0.02
        ),
        dragging: !!dragMode.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.stretch,
          st.current.tilt,
          st.current.comb,
          st.current.amount,
          MODE_IX[st.current.warpMode],
        ),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, active ? 0.5 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexA(C, active ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Stretch↔ / Tilt↕ · Shift or bottom rail: Comb · Double-click: neutral"
      role="img"
      aria-label="Spectral warp harmonic forge"
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
        Harmonic Forge
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {active ? "ACTIVE" : "DRY"}
      </div>
    </div>
  );
}
