/**
 * Chorus — Ensemble Drift stage visualizer.
 *
 * IDIOM: drifting copies. Stages are a ~10:1 letterbox, so the width is time in
 * milliseconds and the module's identity is literal: a dry comb of events on the
 * centre line, and above and below it the delayed copies of that comb, each one
 * sliding back and forth against the dry as its own LFO breathes. Every copy
 * drags a streak behind it covering where it has been — that smear, multiplied
 * across the voices, *is* the chorus.
 *
 * Voice count adds lanes, spread fans them apart vertically, and the model
 * re-tunes the relationship between their drifts: `dimension` runs them at
 * nearly the same rate so they beat slowly, `ensemble` speeds them up and
 * staggers the phases, `tape` slows everything and adds a wow-like second term.
 *
 * Rate · Depth · Mix · Voices · Delay · Spread · Model (Signal Path FX).
 * Drag: Rate ↔ / Depth ↕. Bottom: Mix. Double-click: cycle mix 0→50→100.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ChorusModel } from "@/audio/dsp/FireCommandSynth";
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
  VIZ_FONT_LABEL,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 176;
const C = FC.chorus;
const C_DEEP = bandShade(FC.fx, 0.32);
const C_MID = bandShade(FC.fx, 0.5);
const C_HOT = bandShade(FC.fx, 0.68);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_RATE = bandShade(FC.fx, 0.55);
const C_DEPTH = bandShade(FC.fx, 0.7);
const C_MIX = bandShade(FC.fx, 0.84);
const C_L = bandShade(FC.fx, 0.58);
const C_R = bandShade(FC.fx, 0.78);

const RATE_MIN = 0.05;
const RATE_MAX = 8;
const MIX_CYCLE = [0, 0.5, 1] as const;
const MODEL_ORDER: ChorusModel[] = ["single", "dual", "triple", "ensemble", "dimension", "tape"];

/** Widest offset the lane legend has to cover, in ms. */
const MS_WINDOW = 52;

type Voice = {
  pan: number;
  delayMul: number;
  label: string;
  color: string;
  rate: number;
  phase: number;
  wow: number;
};

// Reused across frames — the voice table is rebuilt in place, never allocated.
const VOICES: Voice[] = Array.from({ length: 4 }, () => ({
  pan: 0, delayMul: 1, label: "", color: C_GLOW, rate: 1, phase: 0, wow: 0,
}));

// Lane layout is a function of the voice count alone. Pans are scaled by spread
// at build time; the final voice's delay multiplier is too.
const PANS: number[][] = [[0], [-1, 1], [-1, 0, 1], [-1, -0.35, 0.35, 1]];
const DELAY_MULS: number[][] = [[1], [1, 1], [1, 1.08, 1], [0.95, 1.05, 1.12, 1]];
const LABELS: string[][] = [["C"], ["L", "R"], ["L", "C", "R"], ["L", "", "C", "R"]];

/**
 * The model's contribution: how far the copies detune from each other and how
 * their phases stagger. This is deliberately independent of the voice count, so
 * two models at the same count still read differently.
 */
function modelShape(model: ChorusModel): { rateMul: number; detune: number; phaseStep: number; wow: number } {
  switch (model) {
    case "single": return { rateMul: 1, detune: 1, phaseStep: 0, wow: 0 };
    case "triple": return { rateMul: 1, detune: 1.09, phaseStep: (Math.PI * 2) / 3, wow: 0 };
    case "ensemble": return { rateMul: 1.4, detune: 1.27, phaseStep: (Math.PI * 2) / 5, wow: 0 };
    // Near-identical rates: the pair beats against itself very slowly.
    case "dimension": return { rateMul: 0.9, detune: 1.01, phaseStep: Math.PI * 0.5, wow: 0 };
    case "tape": return { rateMul: 0.55, detune: 1.06, phaseStep: Math.PI, wow: 1 };
    default: return { rateMul: 1, detune: 1.18, phaseStep: Math.PI, wow: 0 };
  }
}

function labelColor(label: string): string {
  return label === "L" ? C_L : label === "R" ? C_R : label === "C" ? C_GLOW : C_MID;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

type DragMode = "xy" | "mix" | null;

export type ChorusVizState = {
  rate: number;
  depth: number;
  mix: number;
  voicesN: number;
  baseDelay: number;
  spread: number;
  model: ChorusModel;
};

/** Fill `VOICES[0..n)` for this state; returns how many are in play. */
function buildVoices(p: ChorusVizState): number {
  const model = p.model ?? "dual";
  const n = model === "single" ? 1 : clamp(Math.round(p.voicesN ?? 2), 1, 4);
  const spread = clamp(p.spread ?? 0.7, 0, 1);
  const sh = modelShape(model);
  const base = p.rate * sh.rateMul;
  const pans = PANS[n - 1]!;
  const muls = DELAY_MULS[n - 1]!;
  const labels = LABELS[n - 1]!;

  for (let i = 0; i < n; i++) {
    const v = VOICES[i]!;
    const label = labels[i]!;
    v.pan = pans[i]! * spread;
    // The outermost copy carries the longest delay, widened by spread.
    v.delayMul = i === n - 1 && n > 1 ? 1.05 + spread * 0.25 : muls[i]!;
    v.label = label;
    v.color = labelColor(label);
    // Rates fan from `base` to `base × detune` across the ensemble, so the
    // model's detune amount decides how fast the copies pull apart.
    v.rate = base * (1 + (sh.detune - 1) * (n > 1 ? i / (n - 1) : 0));
    v.phase = i * sh.phaseStep;
    v.wow = sh.wow;
  }
  return n;
}

/** Paint the ensemble. Exported and pure — no React, no store. */
export function paintChorus(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ChorusVizState,
  now: number,
  flash: number,
): void {
  const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
  const isLive = p.mix > 0.02;
  const spread = clamp(p.spread ?? 0.7, 0, 1);
  const delayMs = clamp(p.baseDelay ?? 0.012, 0.004, 0.04) * 1000;
  const model = p.model ?? "dual";
  const nV = buildVoices(p);
  const energy = 0.1 + p.mix * 0.42 + p.depth * 0.2 + flash * 0.22;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // ── geometry ──
  const padL = 26;
  const padR = 20;
  const spanW = Math.max(120, W - padL - padR);
  const top = 30;
  const bot = 118;
  const midY = (top + bot) * 0.5;
  const laneGap = ((bot - top) * 0.5 - 8) / 1.15;
  const rulerY = 124;

  // Time scale: one comb cell has to hold the widest smear the delay can reach.
  const markGap = clamp(spanW / 14, 96, 190);
  const pxPerMs = markGap / MS_WINDOW;
  const nMarks = Math.max(2, Math.floor(spanW / markGap));
  const sec = now / 1000;

  /** This voice's offset in ms, `back` seconds ago. Never runs ahead of dry. */
  const offsetAt = (v: Voice, back: number): number => {
    const t = sec - back;
    const swing = p.depth * (5 + delayMs * 0.45);
    const wobble = v.wow ? Math.sin(t * v.rate * 0.31 * Math.PI * 2 + v.phase * 0.5) * swing * 0.5 : 0;
    return Math.max(0.3, delayMs * v.delayMul + Math.sin(t * v.rate * Math.PI * 2 + v.phase) * swing + wobble);
  };

  // ── dry reference ──
  ctx.fillStyle = hexA(C_DEEP, 0.14);
  ctx.fillRect(padL, midY - 9, spanW, 18);
  ctx.strokeStyle = hexA(C_MID, 0.26);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, midY);
  ctx.lineTo(padL + spanW, midY);
  ctx.stroke();
  for (let m = 0; m < nMarks; m++) {
    const x = padL + 6 + m * markGap;
    ctx.fillStyle = hexA(C_MID, 0.42);
    ctx.fillRect(x, midY - 7, 1, 14);
  }
  // ── the copies ──
  const streak = cachedGrad(ctx, `smear|${(markGap * 10) | 0}`, (c) => {
    const g = c.createLinearGradient(0, 0, markGap, 0);
    g.addColorStop(0, hexA(C_HOT, 0));
    g.addColorStop(0.5, hexA(C_HOT, 0.55));
    g.addColorStop(1, hexA(C_HOT, 0));
    return g;
  });

  // The per-lane offsets used to be printed next to each trace, which overprints
  // as soon as spread closes the lanes up. They're collected into one combined
  // readout instead; the gutter keeps only the L/C/R axis anchors.
  let driftLo = Infinity;
  let driftHi = 0;
  let lastLabelY = -Infinity;

  for (let vi = 0; vi < nV; vi++) {
    const v = VOICES[vi]!;
    const laneY = midY + v.pan * laneGap;
    const dNow = offsetAt(v, 0);
    // Half an LFO cycle of history is how far the copy has smeared.
    const back = 0.5 / Math.max(0.05, v.rate);
    let dMin = dNow;
    let dMax = dNow;
    for (let s = 1; s <= 8; s++) {
      const d = offsetAt(v, (back * s) / 8);
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }

    // Lane rule.
    ctx.strokeStyle = hexA(v.color, 0.12 + p.mix * 0.16);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(padL, laneY);
    ctx.lineTo(padL + spanW, laneY);
    ctx.stroke();
    ctx.setLineDash([]);

    const tickH = 5 + p.mix * 4;
    for (let m = 0; m < nMarks; m++) {
      const x0 = padL + 6 + m * markGap;
      const xLo = x0 + dMin * pxPerMs;
      const xHi = x0 + dMax * pxPerMs;
      const xNow = x0 + dNow * pxPerMs;

      // Smear: the span of time this copy has occupied recently.
      ctx.save();
      ctx.translate(xLo, 0);
      ctx.globalAlpha = (0.1 + p.mix * 0.3) * (0.4 + p.depth * 0.6);
      ctx.fillStyle = streak;
      ctx.scale(Math.max(0.05, (xHi - xLo) / markGap), 1);
      ctx.fillRect(0, laneY - tickH * 0.8, markGap, tickH * 1.6);
      ctx.restore();

      // Offset tie-line back to the dry event it came from.
      ctx.strokeStyle = hexA(v.color, 0.1 + p.mix * 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, midY);
      ctx.lineTo(xNow, laneY);
      ctx.stroke();

      // The copy itself.
      ctx.fillStyle = hexA(v.color, 0.5 + p.mix * 0.45);
      ctx.fillRect(xNow, laneY - tickH, 1.6, tickH * 2);
    }

    // One additive pass for the whole lane rather than one per mark.
    if (isLive) {
      lit(ctx, () => {
        const r = 6 + p.mix * 8 + flash * 4;
        const a = 0.2 + p.mix * 0.4;
        for (let m = 0; m < nMarks; m++) {
          drawGlow(ctx, padL + 6 + m * markGap + dNow * pxPerMs, laneY, r, v.color, a);
        }
      });
    }

    if (dMin < driftLo) driftLo = dMin;
    if (dMax > driftHi) driftHi = dMax;

    // Lane head: the axis anchor only. Skipped when spread has pulled this lane
    // within a glyph of the last one it drew, so the gutter can't overprint.
    if (v.label && laneY - lastLabelY >= 9) {
      lastLabelY = laneY;
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "right";
      ctx.fillStyle = hexA(v.color, clamp(0.45 + spread * 0.5, 0.3, 1));
      ctx.fillText(v.label, padL - 5, laneY + 3);
    }
  }

  // Dry reference, labelled at the far end where the gutter has no room.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.62);
  ctx.fillText("DRY", padL + spanW, midY - 11);

  // ── ms legend: what a horizontal smear is worth ──
  ctx.fillStyle = hexA(C_DEPTH, 0.2);
  ctx.fillRect(padL, rulerY, MS_WINDOW * pxPerMs, 1);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let ms = 0; ms <= 40; ms += 10) {
    const x = padL + ms * pxPerMs;
    ctx.fillStyle = hexA(C_DEPTH, 0.24);
    ctx.fillRect(x, rulerY, 1, 4);
    ctx.fillStyle = hexA(C_DEPTH, 0.55);
    ctx.fillText(`${ms}`, x, rulerY + 13);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_DEPTH, 0.45);
  ctx.fillText("ms", padL - 4, rulerY + 3);

  // ── telemetry row ──
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so it can't collide at any panel width. The drift span
  // carries what the per-lane millisecond labels used to say, in one place.
  ctx.textAlign = "left";
  let telX = VIZ_TOP_LABEL_X;
  const telRight = W * 0.5 - 52;
  const tel = (text: string, color: string, alpha: number) => {
    const w = ctx.measureText(text).width;
    if (telX + w > telRight) return;
    ctx.fillStyle = hexA(color, alpha);
    ctx.fillText(text, telX, VIZ_TOP_LABEL_Y);
    telX += w + 14;
  };
  tel(`${delayMs.toFixed(1)}ms · ${model.toUpperCase()} · ${nV}v`, C_DEPTH, 0.72);
  // Ordered ahead of rate/depth: this is the reading the per-lane labels used to
  // carry, so it has to survive the narrowest panel.
  if (driftHi > 0) {
    tel(`DRIFT ${driftLo.toFixed(1)}–${driftHi.toFixed(1)}ms`, C_HOT, 0.7);
  }
  tel(
    `RATE ${p.rate < 1 ? p.rate.toFixed(2) : p.rate.toFixed(1)}Hz · DEPTH ${Math.round(p.depth * 100)}`,
    C_RATE,
    0.68,
  );
  tel(`SPREAD ${Math.round(spread * 100)}`, C_R, 0.66);

  // Rate / Depth crosshair (the drag target).
  const hx = rateN * W;
  const hy = (1 - p.depth) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(
    ctx,
    W * 0.5,
    3,
    !isLive ? "BYPASS" : model === "ensemble" ? "WIDE" : model === "tape" ? "TAPE" : "ENSEMBLE",
    C_GLOW,
    { glow: flash },
  );

  // Mix rail, clear of the footer band.
  const railY = Hh - 26;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  ctx.fillStyle = hexA(C_MIX, 0.55);
  ctx.fillRect(12, railY + 1, Math.max(2, railW * p.mix), 4);
  lit(ctx, () => drawGlow(ctx, 12 + railW * p.mix, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MIX, 0.85);
  ctx.fillText(`MIX ${Math.round(p.mix * 100)}%`, 14, railY - 3);

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "CHOR · ENSEMBLE DRIFT",
    !isLive ? "BYPASS" : `${nV}v · ${delayMs.toFixed(1)}ms · S${Math.round(spread * 100)}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function ChorusStageViz() {
  const rate = useFireCommandStore((s) => s.patch.chorusRate) ?? 0.6;
  const depth = useFireCommandStore((s) => s.patch.chorusDepth) ?? 0.4;
  const mix = useFireCommandStore((s) => s.patch.chorusMix) ?? 0;
  const voicesN = useFireCommandStore((s) => s.patch.chorusVoices) ?? 2;
  const baseDelay = useFireCommandStore((s) => s.patch.chorusDelay) ?? 0.012;
  const spread = useFireCommandStore((s) => s.patch.chorusSpread) ?? 0.7;
  const model = (useFireCommandStore((s) => s.patch.chorusModel) ?? "dual") as ChorusModel;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<ChorusVizState>({ rate, depth, mix, voicesN, baseDelay, spread, model });
  st.current = { rate, depth, mix, voicesN, baseDelay, spread, model };

  const live = mix > 0.02;

  useEffect(() => {
    const key = motionHash(rate, depth, mix, voicesN, baseDelay, spread, MODEL_ORDER.indexOf(model));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [rate, depth, mix, voicesN, baseDelay, spread, model]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("chorusRate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("chorusDepth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("chorusMix", Math.round(x * 1000) / 1000);
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
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "mix") applyMix(e.clientX);
    },
    [applyXy, applyMix],
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
    setParam("chorusMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
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
        paintChorus(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.rate,
          st.current.depth,
          st.current.mix,
          st.current.voicesN,
          st.current.baseDelay,
          st.current.spread,
          MODEL_ORDER.indexOf(st.current.model),
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
      title="Drag: Rate ↔ / Depth ↕ · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Chorus ensemble drift"
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
        Ensemble Drift
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? `${rate < 1 ? rate.toFixed(2) : rate.toFixed(1)}Hz` : "BYPASS"}
      </div>
    </div>
  );
}
