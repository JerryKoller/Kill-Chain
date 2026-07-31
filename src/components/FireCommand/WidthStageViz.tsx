/**
 * Width — Side Horizon stage visualizer.
 *
 * IDIOM: the mid/side field. The letterbox runs left→right as frequency, which
 * is the axis that makes this module legible: mid energy is a solid centre band
 * and side energy spreads above and below it, so `stereoWidth` literally opens
 * the field. `monoBelow` is then visible as a place rather than a number — left
 * of the corner the wings close and the centre band swells as the sides fold
 * back in. The mechanism is a texture on the side bands, not a label: clean
 * (M/S), skewed + combed (microdelay), or scattered (decorrelate).
 *
 * Stereo width · Mono-below · Mechanism (Signal Path Mix · FC.width).
 * Drag ↔: Stereo width. Double-click: cycle Mono → Unity → Wide → Hyper.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { WidthMechanism } from "@/audio/dsp/mixClarity";
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
  lit,
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 168;
const W_MAX = 1.4;
const C = FC.width;
const C_DEEP = bandShade(FC_BAND.mix, 0.32);
const C_MID = bandShade(FC_BAND.mix, 0.48);
const C_HOT = bandShade(FC_BAND.mix, 0.62);
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
const C_SIDE = bandShade(FC_BAND.mix, 0.72);
const C_L = bandShade(FC_BAND.mix, 0.42);
const C_R = bandShade(FC_BAND.mix, 0.78);
/** Correlation warning shade — still a band shade, never an ad-hoc red. */
const C_WARN = bandShade(FC_BAND.mix, 0.99);

const WIDTH_CYCLE = [0, 0.5, 1, 1.2, 1.4] as const;

/** Log frequency axis: 20 Hz → 20 kHz across the panel. */
const F_LO = 20;
const F_HI = 20000;
const F_SPAN = Math.log(F_HI / F_LO);
/** One octave in normalized axis units — the mono-below crossover width. */
const OCTAVE_U = Math.log(2) / F_SPAN;

const RULER: { hz: number; label: string; major: boolean }[] = [
  { hz: 20, label: "20", major: true },
  { hz: 50, label: "50", major: false },
  { hz: 100, label: "100", major: true },
  { hz: 200, label: "200", major: false },
  { hz: 500, label: "500", major: false },
  { hz: 1000, label: "1k", major: true },
  { hz: 2000, label: "2k", major: false },
  { hz: 5000, label: "5k", major: false },
  { hz: 10000, label: "10k", major: true },
  { hz: 20000, label: "20k", major: false },
];

const STEPS = 128;
/** Scratch envelopes — filled from scratch every paint, so never stale. */
const ENV_UP = new Float32Array(STEPS + 1);
const ENV_DN = new Float32Array(STEPS + 1);

const MECH_LABEL: Record<WidthMechanism, string> = {
  ms: "M/S MATRIX",
  microdelay: "MICRODELAY",
  decorrelate: "DECORRELATE",
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function widthLabel(w: number): string {
  if (w < 0.04) return "MONO";
  if (w < 0.55) return "NARROW";
  if (w < 0.95) return "STEREO";
  if (w < 1.15) return "WIDE";
  return "HYPER";
}

/** Approximate M/S energy share for display (w=1 → equal mid/side scale). */
function midSide(w: number): { mid: number; side: number; corr: number } {
  const side = clamp(w / W_MAX, 0, 1);
  const mid = clamp(1 - side * 0.55, 0.2, 1);
  // Correlation ≈ 1 at mono, falls as sides grow
  const corr = clamp(1 - side * 0.85, 0.05, 1);
  return { mid, side, corr };
}

/** Deterministic scatter — a fixed field, so a still panel stays still. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function freqU(hz: number): number {
  return clamp(Math.log(hz / F_LO) / F_SPAN, 0, 1);
}

export type WidthVizState = {
  width: number;
  enabled: boolean;
  monoBelow: number;
  mech: WidthMechanism;
};

/**
 * Paint the mid/side field. Exported and pure so the field can be rendered
 * headlessly — no store reads, no analyser, no `Math.random`.
 */
export function paintWidth(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: WidthVizState,
  now: number,
  flash: number,
): void {
  const on = p.enabled;
  const w = on ? clamp(p.width, 0, W_MAX) : 1;
  const { mid, side, corr } = midSide(w);
  const n = clamp(w / W_MAX, 0, 1);
  const mech = p.mech;
  const monoHz = on ? clamp(p.monoBelow, 0, 400) : 0;
  const monoOn = monoHz >= 20;
  const monoU = monoOn ? freqU(monoHz) : 0;
  const energy = 0.08 + n * 0.34 + flash * 0.2;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // Geometry: frequency across, side energy mirrored around the mid axis.
  const padL = 26;
  const padR = 26;
  const span = Math.max(60, W - padL - padR);
  const axisY = Math.round(Hh * 0.46);
  const reach = Hh * 0.27;
  const rulerY = Hh - 40;

  // ── frequency ruler ──
  const labelAll = span > 520;
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (const r of RULER) {
    const x = padL + freqU(r.hz) * span;
    ctx.fillStyle = hexA(C_MID, r.major ? 0.16 : 0.08);
    ctx.fillRect(x, axisY - reach, 1, reach * 2);
    if (labelAll || r.major) {
      ctx.fillStyle = hexA(C_MID, 0.44);
      ctx.fillText(r.label, x, rulerY + 8);
    }
  }

  // ── mono-below: the region where the sides have been folded to centre ──
  if (monoOn) {
    const mx = Math.round(padL + monoU * span);
    if (mx - padL > 1) {
      const wash = cachedGrad(ctx, `mono|${padL}|${mx}`, (c) => {
        const g = c.createLinearGradient(padL, 0, mx, 0);
        g.addColorStop(0, hexA(C_DEEP, 0.34));
        g.addColorStop(1, hexA(C_DEEP, 0.05));
        return g;
      });
      ctx.fillStyle = wash;
      ctx.fillRect(padL, axisY - reach, mx - padL, reach * 2);
    }
    ctx.strokeStyle = hexA(C_HOT, 0.42 + flash * 0.2);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, axisY - reach);
    ctx.lineTo(mx, axisY + reach);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_HOT, 0.72);
    ctx.fillText(`MONO < ${Math.round(monoHz)}Hz`, Math.min(W - 92, mx + 4), axisY - reach + 9);
  }

  // ── build the side envelope across frequency ──
  // Below the mono corner the wings close; the programme profile puts the bulk
  // of the side energy in the upper mids where real records carry it.
  const combN = 3 + n * 9;
  const skew = mech === "microdelay" ? 3 + n * 9 : 0;
  const scatterPhase = mech === "decorrelate" ? Math.floor(now / 80) : 0;
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const gate = monoOn ? clamp((u - monoU) / OCTAVE_U, 0, 1) : 1;
    const prof = 0.34 + 0.66 * Math.exp(-Math.pow((u - 0.62) / 0.42, 2));
    const ripple = 0.86 + hash01(i * 1.37) * 0.28;
    let base = reach * side * gate * prof * ripple;
    if (mech === "microdelay") {
      // A short delay combs the side channel — visible notches across frequency.
      base *= 0.52 + 0.48 * Math.abs(Math.cos(u * combN * Math.PI));
    }
    if (mech === "decorrelate") {
      base *= 0.6 + hash01(i * 3.11 + scatterPhase) * 0.6;
    }
    ENV_UP[i] = base * (1 + hash01(i * 0.71) * 0.1);
    ENV_DN[i] = base * (0.9 + hash01(i * 0.93 + 51) * 0.16);
  }

  // ── side bands ──
  const sideFill = cachedGrad(ctx, `side|${axisY}|${(reach * 10) | 0}|${(n * 20) | 0}`, (c) => {
    const g = c.createLinearGradient(0, axisY - reach, 0, axisY + reach);
    g.addColorStop(0, hexA(C_L, 0.05 + n * 0.1));
    g.addColorStop(0.34, hexA(C_L, 0.24 + n * 0.3));
    g.addColorStop(0.5, hexA(C_GLOW, 0.16 + n * 0.16));
    g.addColorStop(0.66, hexA(C_R, 0.24 + n * 0.3));
    g.addColorStop(1, hexA(C_R, 0.05 + n * 0.1));
    return g;
  });

  const traceSide = (dir: -1 | 1, dx: number) => {
    const env = dir < 0 ? ENV_UP : ENV_DN;
    for (let i = 0; i <= STEPS; i++) {
      const x = padL + (i / STEPS) * span + dx;
      const y = axisY + dir * env[i]!;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  if (mech === "decorrelate") {
    // Scattered: the side field is a cloud of uncorrelated grains, not a shape.
    ctx.save();
    for (let i = 0; i <= STEPS; i++) {
      const x = padL + (i / STEPS) * span;
      const cw = span / STEPS;
      for (const dir of [-1, 1] as const) {
        const h = dir < 0 ? ENV_UP[i]! : ENV_DN[i]!;
        if (h < 1) continue;
        const grains = 3;
        for (let k = 0; k < grains; k++) {
          const seed = i * 17.3 + k * 5.1 + (dir < 0 ? 0 : 91) + scatterPhase * 0.37;
          const gy = axisY + dir * h * (0.15 + hash01(seed) * 0.85);
          const ga = (0.16 + hash01(seed + 3) * 0.4) * (0.4 + n * 0.6);
          ctx.fillStyle = hexA(dir < 0 ? C_L : C_R, ga);
          ctx.fillRect(x + hash01(seed + 7) * cw, gy, Math.max(1, cw * 0.6), 1.4);
        }
      }
    }
    ctx.restore();
    // A faint hull keeps the cloud readable as an envelope.
    ctx.beginPath();
    traceSide(-1, 0);
    ctx.lineTo(padL + span, axisY);
    ctx.lineTo(padL, axisY);
    ctx.closePath();
    ctx.fillStyle = hexA(C_L, 0.07 + n * 0.08);
    ctx.fill();
    ctx.beginPath();
    traceSide(1, 0);
    ctx.lineTo(padL + span, axisY);
    ctx.lineTo(padL, axisY);
    ctx.closePath();
    ctx.fillStyle = hexA(C_R, 0.07 + n * 0.08);
    ctx.fill();
  } else {
    // Clean (M/S) or skewed (microdelay): a solid mirrored envelope. The skew
    // offsets the two halves against each other — the delay made visible.
    ctx.beginPath();
    traceSide(-1, -skew);
    for (let i = STEPS; i >= 0; i--) {
      const x = padL + (i / STEPS) * span + skew;
      ctx.lineTo(x, axisY + ENV_DN[i]!);
    }
    ctx.closePath();
    ctx.fillStyle = sideFill;
    ctx.fill();
    glowStroke(ctx, () => traceSide(-1, -skew), C_L, { width: 1.2, glow: 0.8, alpha: 0.5 + n * 0.4 });
    glowStroke(ctx, () => traceSide(1, skew), C_R, { width: 1.2, glow: 0.8, alpha: 0.5 + n * 0.4 });
  }

  // ── mid band: the correlated centre, fattened where the sides folded in ──
  const midBase = Hh * 0.055;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const gate = monoOn ? clamp((u - monoU) / OCTAVE_U, 0, 1) : 1;
    const fold = 1 + (1 - gate) * 0.85;
    const h = midBase * (0.55 + mid * 0.65) * fold;
    const x = padL + u * span;
    if (i === 0) ctx.moveTo(x, axisY - h);
    else ctx.lineTo(x, axisY - h);
  }
  for (let i = STEPS; i >= 0; i--) {
    const u = i / STEPS;
    const gate = monoOn ? clamp((u - monoU) / OCTAVE_U, 0, 1) : 1;
    const fold = 1 + (1 - gate) * 0.85;
    const h = midBase * (0.55 + mid * 0.65) * fold;
    ctx.lineTo(padL + u * span, axisY + h);
  }
  ctx.closePath();
  const midFill = cachedGrad(ctx, `midb|${axisY}|${(midBase * 10) | 0}|${(mid * 20) | 0}`, (c) => {
    const g = c.createLinearGradient(0, axisY - midBase * 1.6, 0, axisY + midBase * 1.6);
    g.addColorStop(0, hexA(C_HOT, 0.3));
    g.addColorStop(0.5, hexA(C_GLOW, 0.72));
    g.addColorStop(1, hexA(C_HOT, 0.3));
    return g;
  });
  ctx.fillStyle = midFill;
  ctx.fill();

  // Centre axis + its bloom.
  ctx.fillStyle = hexA(C_GLOW, 0.5);
  ctx.fillRect(padL, axisY - 0.5, span, 1);
  lit(ctx, () => {
    const marks = 7;
    for (let i = 0; i < marks; i++) {
      const x = padL + ((i + 0.5) / marks) * span;
      drawGlow(ctx, x, axisY, 14 + n * 16, C_GLOW, 0.08 + mid * 0.12 + flash * 0.1);
    }
  });

  // Channel identity where the field is widest.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_L, 0.6 + n * 0.3);
  ctx.fillText("+S · L", padL + span - 4, axisY - reach * 0.62);
  ctx.fillStyle = hexA(C_R, 0.6 + n * 0.3);
  ctx.fillText("−S · R", padL + span - 4, axisY + reach * 0.62 + 6);

  // ── correlation meter ──
  const corrW = 62;
  const corrX = W - corrW - 12;
  const corrY = 14;
  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_SIDE, 0.8);
  ctx.fillText(`CORR ${corr.toFixed(2)}`, W - 12, corrY - 4);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(corrX, corrY, corrW, 5);
  ctx.fillStyle = hexA(corr < 0.25 ? C_WARN : C_SIDE, 0.8);
  ctx.fillRect(corrX, corrY, corrW * corr, 5);

  // ── telemetry row ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLOW, 0.7);
  ctx.fillText(`MID ${Math.round(mid * 100)}`, padL, 18);
  ctx.fillStyle = hexA(C_SIDE, 0.68);
  ctx.fillText(`SIDE ${Math.round(side * 100)}`, padL + 60, 18);
  ctx.fillStyle = hexA(C_HOT, 0.62);
  ctx.fillText(monoOn ? `MONO ${Math.round(monoHz)}Hz` : "MONO OFF", padL + 128, 18);

  pill(ctx, W * 0.5, 2, on ? MECH_LABEL[mech] : "BYPASS", on ? C_GLOW : C_MID, { glow: flash, height: 12 });

  // ── width rail: the drag affordance, notched at the double-click cycle ──
  const railY = Hh - 26;
  const railPad = 14;
  const railW = W - railPad * 2;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railPad, railY, railW, 6);
  ctx.fillStyle = hexA(C_HOT, 0.55 + flash * 0.25);
  ctx.fillRect(railPad, railY + 1, Math.max(2, railW * (w / W_MAX)), 4);
  for (const notch of WIDTH_CYCLE) {
    const nx = railPad + (notch / W_MAX) * railW;
    const active = Math.abs(w - notch) < 0.05;
    ctx.fillStyle = hexA(active ? C_GLOW : C_MID, active ? 0.9 : 0.32);
    ctx.fillRect(nx - 1, railY - 2, 2, 10);
  }
  const thumbX = railPad + (w / W_MAX) * railW;
  lit(ctx, () => drawGlow(ctx, thumbX, railY + 3, 8 + flash * 5, C_GLOW, 0.85));

  if (!on) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, Hh);
  }

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    on ? "SIDE HORIZON" : "SIDE HORIZON · BYPASS",
    `${widthLabel(w)} · ${Math.round(w * 100)}%`,
    C_GLOW,
    on ? C_HOT : C_MID,
  );
}

export function WidthStageViz() {
  const width = useFireCommandStore((s) => s.patch.stereoWidth) ?? 1;
  const monoBelow = useFireCommandStore((s) => s.patch.monoBelow) ?? 0;
  const mech = (useFireCommandStore((s) => s.patch.widthMechanism) ?? "ms") as WidthMechanism;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["width"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const st = useRef<WidthVizState>({ width, enabled, monoBelow, mech });
  st.current = { width, enabled, monoBelow, mech };

  const live = enabled && Math.abs(width - 1) > 0.03;

  useEffect(() => {
    const key = motionHash(width, enabled, monoBelow, mech === "ms" ? 0 : mech === "microdelay" ? 1 : 2);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [width, enabled, monoBelow, mech]);

  const applyWidth = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("stereoWidth", Math.round(x * W_MAX * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = true;
      flashRef.current = 1;
      applyWidth(e.clientX);
    },
    [applyWidth],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      applyWidth(e.clientX);
    },
    [applyWidth],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = false;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.width;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WIDTH_CYCLE.length; i++) {
      const d = Math.abs(WIDTH_CYCLE[i]! - cur);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = WIDTH_CYCLE[(best + 1) % WIDTH_CYCLE.length]!;
    setParam("stereoWidth", next);
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
        paintWidth(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        // Only the decorrelate texture is time-varying; M/S and microdelay are
        // static readouts and should cost nothing while nothing is changing.
        active: st.current.enabled && st.current.mech === "decorrelate",
        dragging: !!dragRef.current,
        particles: 0,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.width,
          st.current.enabled,
          st.current.monoBelow,
          st.current.mech === "ms" ? 0 : st.current.mech === "microdelay" ? 1 : 2,
        ),
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] cursor-ew-resize touch-none select-none"
      style={{
        borderColor: `${C}${live || dragRef.current ? "77" : "44"}`,
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
      role="slider"
      aria-label="Stereo width — drag horizontally"
      aria-valuemin={0}
      aria-valuemax={140}
      aria-valuenow={Math.round(width * 100)}
      title="Drag ↔ width · Double-click cycles Mono → Unity → Wide → Hyper"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: `${C}88` }} />
    </div>
  );
}
