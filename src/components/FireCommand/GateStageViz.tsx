/**
 * Gate — Rhythm Shutter stage visualizer.
 *
 * IDIOM: the pattern lane. Sixteen steps run left→right with a playhead, and
 * the module's whole job — the SHAPE of the opening — is the silhouette. Open
 * steps hold the lane at full height; `depth` sets how far closed steps cut
 * (depth 0 leaves the lane flat, depth 1 slams it to the floor); `gateSmooth`
 * rounds every block edge into a visible ramp, so a smoothed pattern reads as a
 * wave and a hard one as square teeth. The cut region above the silhouette is
 * drawn as shutter slats, and motes only drift up through the parts of the lane
 * that are actually open.
 *
 * Trance gate chop (Signal Path Perf · FC.gate).
 * Click steps to toggle · bottom rail: Rate · drag depth zone.
 * Double-click: cycle pattern presets.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
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
const C = FC.gate;
const C_DEEP = bandShade(FC_BAND.perf, 0.26);
const C_MID = bandShade(FC_BAND.perf, 0.45);
const C_HOT = bandShade(FC_BAND.perf, 0.62);
const C_GLOW = bandShade(FC_BAND.perf, 0.92);
const C_RATE = bandShade(FC_BAND.perf, 0.55);
const C_DEPTH = bandShade(FC_BAND.perf, 0.7);

export const GATE_PRESETS: { id: string; name: string; steps: number[] }[] = [
  { id: "offbeat", name: "Offbeat", steps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { id: "four", name: "Four", steps: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0] },
  { id: "gallop", name: "Gallop", steps: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1] },
  { id: "332", name: "3-3-2", steps: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0] },
  { id: "stutter", name: "Stutter", steps: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0] },
  { id: "sparse", name: "Sparse", steps: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0] },
  { id: "long", name: "Long", steps: [1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0] },
  { id: "solid", name: "Solid", steps: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Deterministic mote field — an idle lane must render the same every frame. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type DragMode = "step" | "rate" | "depth" | null;

export type GateVizState = {
  on: boolean;
  pattern: number[];
  steps: number;
  depth: number;
  smooth: number;
  rate: number;
  enabled: boolean;
  /** Engine playhead step, −1 when not running. */
  playStep: number;
  /** Matched preset name (or "Custom") — resolved outside the paint path. */
  presetName: string;
};

/**
 * Paint the pattern lane. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintGate(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: GateVizState,
  now: number,
  flash: number,
): void {
  const active = p.on && p.enabled;
  const dim = p.enabled ? 1 : 0.4;
  const n = Math.max(2, Math.min(16, Math.round(p.steps)));
  const rateT = logNorm(p.rate, 0.5, 24);
  const closed = 1 - clamp(p.depth, 0, 1);
  const smooth = clamp(p.smooth, 0, 1);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy: 0.08 + (active ? 0.22 + p.depth * 0.2 : 0) + flash * 0.16, horizon: 0.66 });

  const padX = 12;
  const usable = Math.max(40, W - padX * 2);
  const stepW = usable / n;
  const ceil = 32;
  const floor = Hh - 44;
  const ampH = floor - ceil;
  // Edge run: how far a transition takes to travel horizontally.
  const r = smooth * Math.min(stepW * 0.9, 54);

  const lvl = (i: number) => ((p.pattern[((i % n) + n) % n] ?? 0) > 0.5 ? 1 : closed);
  const yOf = (i: number) => floor - lvl(i) * ampH;

  /** The gate silhouette: flats over each step, S-ramps at every boundary. */
  const contour = () => {
    ctx.moveTo(padX - r * 0.5 - 2, yOf(-1));
    ctx.bezierCurveTo(padX, yOf(-1), padX, yOf(0), padX + r * 0.5, yOf(0));
    for (let i = 0; i < n; i++) {
      const bx = padX + (i + 1) * stepW;
      ctx.lineTo(bx - r * 0.5, yOf(i));
      ctx.bezierCurveTo(bx, yOf(i), bx, yOf(i + 1), bx + r * 0.5, yOf(i + 1));
    }
  };

  // ── lane bed ──
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.fillRect(padX, ceil, usable, ampH);
  for (let i = 0; i <= n; i++) {
    const x = padX + i * stepW;
    const beat = i % 4 === 0;
    ctx.fillStyle = hexA(C, beat ? 0.2 : 0.07);
    ctx.fillRect(x, ceil, beat ? 1.2 : 1, ampH);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, ceil, usable, ampH);
  ctx.clip();

  // ── the cut: everything above the silhouette, as shutter slats ──
  ctx.save();
  ctx.beginPath();
  contour();
  ctx.lineTo(padX + usable + r, ceil - 12);
  ctx.lineTo(padX - r - 4, ceil - 12);
  ctx.closePath();
  ctx.clip();
  const cut = cachedGrad(ctx, `gcut|${ceil}|${floor}`, (c) => {
    const g = c.createLinearGradient(0, ceil, 0, floor);
    g.addColorStop(0, hexA(C_DEEP, 0.5));
    g.addColorStop(1, hexA(C_HOT, 0.16));
    return g;
  });
  ctx.fillStyle = cut;
  ctx.fillRect(padX, ceil - 12, usable, ampH + 12);
  ctx.strokeStyle = hexA(C_GLOW, 0.09 + p.depth * 0.06);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = ceil + 3; y < floor; y += 5) {
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + usable, y);
  }
  ctx.stroke();
  ctx.restore();

  // ── the opening: everything under the silhouette ──
  ctx.save();
  ctx.beginPath();
  contour();
  ctx.lineTo(padX + usable + r, floor);
  ctx.lineTo(padX - r - 4, floor);
  ctx.closePath();
  ctx.clip();
  const open = cachedGrad(ctx, `gopen|${ceil}|${floor}|${active ? 1 : 0}`, (c) => {
    const g = c.createLinearGradient(0, ceil, 0, floor);
    g.addColorStop(0, hexA(C_GLOW, active ? 0.34 : 0.13));
    g.addColorStop(0.55, hexA(C_HOT, active ? 0.17 : 0.06));
    g.addColorStop(1, hexA(C, 0.02));
    return g;
  });
  ctx.fillStyle = open;
  ctx.fillRect(padX, ceil, usable, ampH);

  // Motes riding the open air — brightness follows the local opening.
  if (active) {
    lit(ctx, () => {
      for (let i = 0; i < 22; i++) {
        const x = padX + hash01(i * 3.71) * usable;
        const si = clamp(Math.floor((x - padX) / stepW), 0, n - 1);
        const l = lvl(si);
        if (l < 0.12) continue;
        const ph = (hash01(i * 9.13) + now * (0.00004 + rateT * 0.00013)) % 1;
        const y = floor - ph * l * ampH;
        drawGlow(ctx, x, y, 3 + l * 4, C_GLOW, (1 - ph) * 0.4 * l);
      }
    });
  }
  ctx.restore();

  // ── silhouette edge ──
  glowStroke(ctx, contour, C_GLOW, {
    width: 1.8 + smooth * 1,
    glow: active ? 1 : 0.4,
    alpha: (active ? 0.9 : 0.42) * dim,
  });
  ctx.restore();

  // ── step chips: the row the pointer paints ──
  const chipY = floor + 5;
  for (let i = 0; i < n; i++) {
    const x = padX + i * stepW;
    const isOpen = (p.pattern[i] ?? 0) > 0.5;
    const isPlay = active && i === p.playStep;
    if (isOpen) {
      ctx.fillStyle = hexA(isPlay ? C_GLOW : C_HOT, (isPlay ? 0.95 : 0.5) * dim);
      ctx.fillRect(x + 1.5, chipY, stepW - 3, 4);
    } else {
      ctx.strokeStyle = hexA(C_MID, (isPlay ? 0.6 : 0.24) * dim);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2, chipY + 0.5, stepW - 4, 3);
    }
    if (i % 4 === 0) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(C_MID, 0.4);
      ctx.fillText(`${i + 1}`, x + 2, chipY + 15);
    }
  }

  // ── playhead ──
  if (active && p.playStep >= 0 && p.playStep < n) {
    const x = padX + (p.playStep + 0.5) * stepW;
    const beam = cachedGrad(ctx, `gbeam|${Hh}`, (c) => {
      const g = c.createLinearGradient(0, 0, 0, Hh);
      g.addColorStop(0, hexA(C_GLOW, 0));
      g.addColorStop(0.4, hexA(C_GLOW, 0.5));
      g.addColorStop(1, hexA(C, 0));
      return g;
    });
    ctx.save();
    ctx.translate(x, 0);
    ctx.fillStyle = beam;
    ctx.fillRect(-2, ceil - 6, 4, ampH + 18);
    ctx.restore();
    const py = yOf(p.playStep);
    lit(ctx, () => {
      drawGlow(ctx, x, py, 15 + flash * 8, C_GLOW, 0.75);
      ctx.fillStyle = hexA(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(x, py, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ── depth strip (top drag zone) ──
  const stripY = 18;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(padX, stripY, usable, 5);
  ctx.fillStyle = hexA(C_DEPTH, (0.55 + flash * 0.2) * dim);
  ctx.fillRect(padX, stripY, Math.max(1, usable * clamp(p.depth, 0, 1)), 5);
  lit(ctx, () => drawGlow(ctx, padX + usable * clamp(p.depth, 0, 1), stripY + 2.5, 6 + flash * 3, C_GLOW, 0.7 * dim));

  // ── telemetry ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_DEPTH, 0.72 * dim);
  ctx.fillText(`DEPTH ${Math.round(p.depth * 100)}`, padX, 16);
  ctx.fillStyle = hexA(C_GLOW, 0.6 * dim);
  ctx.fillText(`EDGE ${Math.round(smooth * 100)}`, padX + 74, 16);
  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_RATE, 0.72);
  ctx.fillText(`${n}ST · ${p.rate.toFixed(1)}Hz`, W - padX, 16);

  // Edge bracket — the ramp length, drawn to scale next to the strip.
  if (r > 1) {
    const bx = padX + 150;
    ctx.strokeStyle = hexA(C_GLOW, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, 13);
    ctx.lineTo(bx, 16);
    ctx.lineTo(bx + r, 16);
    ctx.lineTo(bx + r, 13);
    ctx.stroke();
  }

  pill(
    ctx,
    W * 0.5,
    3,
    !p.enabled ? "BYPASS" : active ? p.presetName.toUpperCase() : "ARMED",
    C_GLOW,
    { glow: flash },
  );

  // ── rate rail (bottom drag zone) ──
  const railY = Hh - 25;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padX, railY, usable, 6);
  ctx.fillStyle = hexA(C_RATE, 0.5 * dim);
  ctx.fillRect(padX, railY + 1, Math.max(2, usable * rateT), 4);
  lit(ctx, () => drawGlow(ctx, padX + usable * rateT, railY + 3, 7 + flash * 4, C_GLOW, 0.8 * dim));

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    !p.enabled ? "RHYTHM SHUTTER · BYPASS" : active ? "RHYTHM SHUTTER · LIVE" : "RHYTHM SHUTTER · ARMED",
    `${n}st · ${p.rate.toFixed(1)}Hz · D${Math.round(p.depth * 100)} · S${Math.round(smooth * 100)}`,
    C_GLOW,
    C,
  );
}

/** Nearest stock pattern, so the chip can name what you're looking at. */
function matchPresetName(pattern: number[]): string {
  for (const preset of GATE_PRESETS) {
    let same = true;
    for (let i = 0; i < 16; i++) {
      if (((preset.steps[i] ?? 0) > 0.5) !== ((pattern[i] ?? 0) > 0.5)) {
        same = false;
        break;
      }
    }
    if (same) return preset.name;
  }
  return "Custom";
}

export function GateStageViz() {
  const on = useFireCommandStore((s) => s.patch.gateOn);
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const steps = useFireCommandStore((s) => s.patch.gateSteps);
  const depth = useFireCommandStore((s) => s.patch.gateDepth);
  const smooth = useFireCommandStore((s) => s.patch.gateSmooth) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.gateRate) ?? 8;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["gate"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setGateStep = useFireCommandStore((s) => s.setGateStep);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const paintValRef = useRef<boolean | null>(null);
  const lastPaintRef = useRef(-1);
  const playStepRef = useRef(-1);
  const prevKey = useRef(0);
  const st = useRef<GateVizState>({
    on,
    pattern,
    steps,
    depth,
    smooth,
    rate,
    enabled,
    playStep: -1,
    presetName: "Custom",
  });
  st.current = {
    on,
    pattern,
    steps,
    depth,
    smooth,
    rate,
    enabled,
    playStep: playStepRef.current,
    presetName: matchPresetName(pattern),
  };

  const live = on && enabled;

  useEffect(() => {
    let mask = 0;
    for (let i = 0; i < 16; i++) if ((pattern[i] ?? 0) > 0.5) mask |= 1 << i;
    const key = motionHash(on, steps, depth, smooth, rate, mask, enabled);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [on, steps, depth, smooth, rate, pattern, enabled]);

  // Playhead poll
  useEffect(() => {
    if (!on || !enabled) {
      playStepRef.current = -1;
      st.current.playStep = -1;
      return;
    }
    const id = window.setInterval(() => {
      let v = -1;
      try {
        v = activeFireEngine().getGateStep();
      } catch {
        v = -1;
      }
      playStepRef.current = v;
      st.current.playStep = v;
    }, 40);
    return () => window.clearInterval(id);
  }, [on, enabled]);

  const hitTest = useCallback(
    (clientY: number): DragMode => {
      const wrap = wrapRef.current;
      if (!wrap) return "step";
      const rect = wrap.getBoundingClientRect();
      const y = (clientY - rect.top) / Math.max(1, rect.height);
      if (y > 0.84) return "rate";
      if (y < 0.14) return "depth";
      return "step";
    },
    [wrapRef],
  );

  const paintStepAt = useCallback(
    (clientX: number, first: boolean) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const n = Math.max(2, Math.min(16, Math.round(st.current.steps)));
      const padX = 12;
      const usable = Math.max(1, rect.width - padX * 2);
      const x = clientX - rect.left - padX;
      const i = clamp(Math.floor((x / usable) * n), 0, n - 1);
      if (!first && i === lastPaintRef.current) return;
      lastPaintRef.current = i;
      const isOpen = (st.current.pattern[i] ?? 0) > 0.5;
      if (first) paintValRef.current = !isOpen;
      const next = paintValRef.current ?? !isOpen;
      if (isOpen !== next) setGateStep(i, next);
    },
    [setGateStep, wrapRef],
  );

  const applyRate = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("gateRate", Math.round(logLerp(x, 0.5, 24) * 100) / 100);
    },
    [setParam, wrapRef],
  );

  const applyDepth = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("gateDepth", Math.round(x * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const mode = hitTest(e.clientY);
      dragRef.current = mode;
      flashRef.current = 1;
      lastPaintRef.current = -1;
      paintValRef.current = null;
      if (mode === "step") paintStepAt(e.clientX, true);
      else if (mode === "rate") applyRate(e.clientX);
      else applyDepth(e.clientX);
    },
    [applyDepth, applyRate, hitTest, paintStepAt],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const mode = dragRef.current;
      if (!mode) return;
      if (mode === "step") paintStepAt(e.clientX, false);
      else if (mode === "rate") applyRate(e.clientX);
      else applyDepth(e.clientX);
    },
    [applyDepth, applyRate, paintStepAt],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    paintValRef.current = null;
    lastPaintRef.current = -1;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.pattern;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < GATE_PRESETS.length; i++) {
      const p = GATE_PRESETS[i]!.steps;
      let d = 0;
      for (let j = 0; j < 16; j++) d += Math.abs((p[j] ?? 0) - (cur[j] ?? 0));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = GATE_PRESETS[(best + 1) % GATE_PRESETS.length]!;
    setParam("gatePattern", [...next.steps]);
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
        flashRef.current *= 0.86;
        paintGate(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        const s = st.current;
        let mask = 0;
        for (let i = 0; i < 16; i++) if ((s.pattern[i] ?? 0) > 0.5) mask |= 1 << i;
        return {
          flash: flashRef.current,
          active: !!(s.on && s.enabled),
          dragging: !!dragRef.current,
          visible: visibleRef.current,
          motionKey: motionHash(s.playStep, s.depth, s.smooth, s.rate, s.steps, s.on, s.enabled, mask),
        };
      },
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-pointer touch-none select-none"
      style={{
        borderColor: `${C}${live ? "66" : "40"}`,
        height: H,
        boxShadow: live
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 28px ${C}28, 0 6px 18px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="img"
      aria-label="Rhythm shutter — click steps, scrub rate and depth"
      title="Paint steps · Top: Depth · Bottom: Rate · Double-click cycles presets"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
