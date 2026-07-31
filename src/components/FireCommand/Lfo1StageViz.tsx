/**
 * LFO 1 — Phase Aurora stage visualizer.
 *
 * IDIOM: scrolling cycles. The stage is a ~10:1 letterbox, so the width is the
 * one axis worth having: time. The actual selected waveform repeats across it,
 * cycle density set by rate, height set by depth, the whole pattern drifting
 * leftward as phase advances. Stepped waves (saw / square / sample-hold) are
 * drawn with true vertical risers so a square never reads as a soft sine, and
 * sample-hold lands as real held plateaus.
 *
 * The right edge is where the newest sample arrives, so that is where the
 * destination lives: a labelled tap fed by a connector off the wave, with a
 * bipolar deflection meter showing what the destination is actually receiving.
 * The left gutter carries the three LFO→WT morph taps.
 *
 * Wave · rate · depth · dest · LFO→WT A/B/C (Signal Path Mod · FC.lfo).
 * Drag: Rate ↔ / Depth ↕. Bottom rail: →WT for focused osc. Double-click: cycle wave.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { LfoDest, LfoWave } from "@/audio/dsp/FireCommandSynth";
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
  strata,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 176;
const C = FC.lfo;
const C_DEEP = bandShade(FC.mod, 0.18);
const C_MID = bandShade(FC.mod, 0.38);
const C_HOT = bandShade(FC.mod, 0.55);
const C_GLOW = bandShade(FC.mod, 0.9);
const C_RATE = bandShade(FC.mod, 0.45);
const C_DEPTH = bandShade(FC.mod, 0.65);
const C_DEST = bandShade(FC.mod, 0.78);
const C_OA = FC.oscA;
const C_OB = FC.oscB;
const C_OC = FC.oscC;

const RATE_MIN = 0.05;
const RATE_MAX = 30;

const WAVE_CYCLE: LfoWave[] = ["sine", "triangle", "sawtooth", "square", "sample-hold"];

/** Steps held per cycle for sample-hold — enough to read as plateaus, not noise. */
const SH_STEPS = 8;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Deterministic scatter — a fixed field, so nothing crawls when idle. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function lfoShape(w: LfoWave, ph: number): number {
  const p = ((ph % 1) + 1) % 1;
  switch (w) {
    case "sine":
      return Math.sin(p * Math.PI * 2);
    case "triangle":
      return 1 - 4 * Math.abs(p - 0.5);
    case "sawtooth":
      return 1 - 2 * p;
    case "square":
      return p < 0.5 ? 1 : -1;
    case "sample-hold": {
      const step = Math.floor(ph * SH_STEPS);
      const h = Math.sin(step * 127.1) * 43758.5453;
      return (h - Math.floor(h)) * 2 - 1;
    }
    default:
      return 0;
  }
}

/** Waves that jump between samples get a vertical riser instead of a ramp. */
function isStepped(w: LfoWave): boolean {
  return w === "sawtooth" || w === "square" || w === "sample-hold";
}

function destLabel(d: LfoDest): string {
  return d === "off" ? "NO DEST" : `→${d.toUpperCase()}`;
}

const DEST_ORDER: LfoDest[] = ["off", "pitch", "filter", "pan", "volume"];

/** motionHash only eats numbers — enums go in as their index. */
function destIdx(d: LfoDest): number {
  const i = DEST_ORDER.indexOf(d);
  return i < 0 ? 0 : i;
}

type DragMode = "xy" | "morph" | null;
type MorphFocus = "a" | "b" | "c";

export type Lfo1VizState = {
  wave: LfoWave;
  rate: number;
  depth: number;
  dest: LfoDest;
  lfoA: number;
  lfoB: number;
  lfoC: number;
  /** Which osc the bottom →WT rail edits — pointer state, not patch state. */
  focus: MorphFocus;
};

/**
 * Paint the scrolling cycle field. Exported and pure so it renders headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintLfo1(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: Lfo1VizState,
  now: number,
  flash: number,
): void {
  const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
  const depth = clamp(p.depth, 0, 1);
  const morphMag = Math.max(Math.abs(p.lfoA), Math.abs(p.lfoB), Math.abs(p.lfoC));
  const destOn = p.dest !== "off";
  const isLive = depth > 0.02 || destOn || morphMag > 0.04;
  const energy = 0.1 + depth * 0.4 + morphMag * 0.18 + (destOn ? 0.12 : 0) + flash * 0.22;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });
  strata(ctx, W, Hh, C_DEEP, { count: 6, horizon: 0.14, alpha: 0.09 });

  // ── geometry: a wave lane, a left morph gutter, a destination tap at the right ──
  const xL = 92;
  const xR = Math.max(xL + 70, W - 96);
  const span = xR - xL;
  const laneTop = 24;
  const laneBot = Hh - 46;
  const mid = (laneTop + laneBot) * 0.5;
  const ampMax = (laneBot - laneTop) * 0.5 - 3;
  const amp = ampMax * (0.08 + depth * 0.92);

  // Rate sets how many cycles fit the width; phase drifts them leftward.
  const cycles = 0.6 + Math.pow(rateN, 2.2) * 15;
  const phase = (now / 1000) * (0.25 + rateN * 1.6);
  const stepped = isStepped(p.wave);

  /** Re-runnable wave path (no beginPath — glowStroke owns that). */
  const trace = (scale: number, stepPx: number) => {
    const n = Math.max(24, Math.ceil(span / stepPx));
    let prevV = lfoShape(p.wave, phase);
    ctx.moveTo(xL, mid - prevV * amp * scale);
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const v = lfoShape(p.wave, u * cycles + phase);
      const x = xL + u * span;
      if (stepped && Math.abs(v - prevV) > 0.3) ctx.lineTo(x, mid - prevV * amp * scale);
      ctx.lineTo(x, mid - v * amp * scale);
      prevV = v;
    }
  };

  // Depth rails — the full-scale reach the wave is allowed to swing between.
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = hexA(C_DEPTH, 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xL, mid - ampMax);
  ctx.lineTo(xR, mid - ampMax);
  ctx.moveTo(xL, mid + ampMax);
  ctx.lineTo(xR, mid + ampMax);
  ctx.stroke();
  ctx.restore();

  // Cycle graticule — the visible read of rate: hairlines on every cycle edge.
  ctx.strokeStyle = hexA(C_RATE, 0.13);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = Math.ceil(phase); k <= Math.floor(cycles + phase); k++) {
    const x = xL + ((k - phase) / cycles) * span;
    ctx.moveTo(x, mid - ampMax);
    ctx.lineTo(x, mid + ampMax);
  }
  ctx.stroke();

  // Zero line.
  ctx.fillStyle = hexA(C_MID, 0.26);
  ctx.fillRect(xL, mid, span, 1);

  // Inverted ghost — states outright that the modulation is bipolar.
  ctx.strokeStyle = hexA(C_DEEP, 0.3 + depth * 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  trace(-1, 6);
  ctx.stroke();

  // Ribbon between the wave and zero.
  const ribbon = cachedGrad(ctx, `lfo1rib|${mid}|${ampMax}`, (c) => {
    const g = c.createLinearGradient(0, mid - ampMax, 0, mid + ampMax);
    g.addColorStop(0, hexA(C_GLOW, 0.3));
    g.addColorStop(0.5, hexA(C, 0.1));
    g.addColorStop(1, hexA(C_DEEP, 0.26));
    return g;
  });
  ctx.beginPath();
  ctx.moveTo(xL, mid);
  trace(1, 4);
  ctx.lineTo(xR, mid);
  ctx.closePath();
  ctx.save();
  ctx.globalAlpha = 0.35 + depth * 0.5;
  ctx.fillStyle = ribbon;
  ctx.fill();
  ctx.restore();

  // The wave itself.
  lit(ctx, () => {
    glowStroke(ctx, () => trace(1, 3), C_GLOW, {
      width: 2.2,
      glow: 0.5 + depth * 0.8 + flash * 0.5,
      alpha: 0.8 + flash * 0.2,
    });
  });

  // Crest sparks — deterministic, keyed off cycle index so idle frames are still.
  if (depth > 0.05) {
    lit(ctx, () => {
      for (let k = Math.ceil(phase); k <= Math.floor(cycles + phase); k++) {
        const u = (k - phase) / cycles;
        const cu = u + 0.25 / cycles;
        if (cu > 1) continue;
        const v = lfoShape(p.wave, cu * cycles + phase);
        const jitter = hash01(k * 1.7) * 0.4 + 0.6;
        drawGlow(ctx, xL + cu * span, mid - v * amp, (5 + depth * 12) * jitter, C_HOT, depth * 0.4);
      }
    });
  }

  // ── destination tap: the newest sample leaves the lane and drives the dest ──
  const vNow = lfoShape(p.wave, cycles + phase);
  const jackX = xR + 24;
  const meterX = W - 36;
  const meterH = ampMax * 1.6;
  ctx.strokeStyle = hexA(destOn ? C_DEST : C_MID, destOn ? 0.6 : 0.25);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(xR, mid - vNow * amp);
  ctx.quadraticCurveTo(xR + 12, mid - vNow * amp * 0.4, jackX, mid);
  ctx.stroke();

  ctx.strokeStyle = hexA(destOn ? C_DEST : C_MID, destOn ? 0.75 : 0.3);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(jackX, mid, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = hexA(destOn ? C_GLOW : C_MID, destOn ? 0.9 : 0.35);
  ctx.beginPath();
  ctx.arc(jackX, mid, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Bipolar deflection meter — what the destination actually receives.
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(meterX - 4, mid - meterH * 0.5, 8, meterH);
  ctx.fillStyle = hexA(C_MID, 0.28);
  ctx.fillRect(meterX - 6, mid, 12, 1);
  const defl = vNow * depth * (destOn ? 1 : 0.25) * (meterH * 0.5);
  ctx.fillStyle = hexA(destOn ? C_DEST : C_MID, 0.45 + depth * 0.4);
  if (defl >= 0) ctx.fillRect(meterX - 3, mid - defl, 6, defl);
  else ctx.fillRect(meterX - 3, mid, 6, -defl);
  if (destOn) {
    lit(ctx, () => {
      drawGlow(ctx, meterX, mid - defl, 9 + depth * 9, C_GLOW, 0.6 + flash * 0.3);
      drawGlow(ctx, jackX, mid, 12 + depth * 10, C_DEST, 0.35 + depth * 0.35);
    });
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(destOn ? C_DEST : C_MID, destOn ? 0.9 : 0.5);
  ctx.fillText(destLabel(p.dest), W - 12, laneBot + 12);

  // ── left gutter: LFO→WT morph taps ──
  const tapRows: Array<{ v: number; col: string; label: string; id: MorphFocus }> = [
    { v: p.lfoA, col: C_OA, label: "A", id: "a" },
    { v: p.lfoB, col: C_OB, label: "B", id: "b" },
    { v: p.lfoC, col: C_OC, label: "C", id: "c" },
  ];
  const barW = 42;
  const barX = 30;
  for (let i = 0; i < tapRows.length; i++) {
    const m = tapRows[i]!;
    const ry = laneTop + 12 + i * ((laneBot - laneTop - 18) / 3);
    const on = m.id === p.focus;
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(m.col, on ? 0.95 : 0.5);
    ctx.fillText(m.label, 12, ry + 7);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(barX, ry, barW, 8);
    const cxBar = barX + barW * 0.5;
    ctx.fillStyle = hexA(C_MID, 0.3);
    ctx.fillRect(cxBar, ry, 1, 8);
    const mag = Math.abs(m.v);
    if (mag > 0.02) {
      const bw = (barW * 0.5) * mag;
      ctx.fillStyle = hexA(m.col, 0.55 + mag * 0.35);
      if (m.v >= 0) ctx.fillRect(cxBar, ry + 1, bw, 6);
      else ctx.fillRect(cxBar - bw, ry + 1, bw, 6);
      lit(ctx, () => drawGlow(ctx, cxBar + (m.v >= 0 ? bw : -bw), ry + 4, 6 + mag * 5, m.col, 0.6));
    }
    if (on) {
      ctx.strokeStyle = hexA(C_GLOW, 0.55);
      ctx.lineWidth = 1;
      ctx.strokeRect(barX - 1.5, ry - 1.5, barW + 3, 11);
    }
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_DEPTH, 0.5);
  // Sits below the reserved top strip — the gutter's left edge is under the
  // DOM character eyebrow above y=26.
  ctx.fillText("→WT", 12, laneTop + 8);

  // ── rate / depth telemetry ──
  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_RATE, 0.72);
  ctx.fillText(`${p.rate.toFixed(2)}Hz`, xL, laneBot + 12);
  ctx.fillStyle = hexA(C_DEPTH, 0.72);
  ctx.fillText(`DEPTH ${Math.round(depth * 100)}`, xL + 76, laneBot + 12);
  ctx.fillStyle = hexA(C_MID, 0.55);
  ctx.fillText(`${cycles < 1 ? cycles.toFixed(2) : cycles.toFixed(1)} CYC`, xL + 168, laneBot + 12);

  // Rate / depth crosshair — matches the drag mapping (x: rate, y: depth).
  const hx = rateN * W;
  const hy = (1 - depth) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.28 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, String(p.wave).toUpperCase().replace("SAMPLE-HOLD", "S&H"), C_GLOW, { glow: flash });

  // ── bottom rail: bipolar →WT for the focused osc, thirds pick which ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  const focusVal = p.focus === "a" ? p.lfoA : p.focus === "b" ? p.lfoB : p.lfoC;
  const focusCol = p.focus === "a" ? C_OA : p.focus === "b" ? C_OB : C_OC;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railX, railY, railW, 7);
  ctx.strokeStyle = hexA(C_DEPTH, 0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(railX + 0.5, railY + 0.5, railW - 1, 6);
  const railMid = railX + railW * 0.5;
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(railMid - 0.5, railY, 1, 7);
  const signedX = railMid + clamp(focusVal, -1, 1) * (railW * 0.5);
  if (Math.abs(focusVal) > 0.02) {
    const left = Math.min(railMid, signedX);
    const wide = Math.abs(signedX - railMid);
    const rg = cachedGrad(ctx, `lfo1rail|${railX}|${railW}|${focusCol}`, (c) => {
      const g = c.createLinearGradient(railX, 0, railX + railW, 0);
      g.addColorStop(0, hexA(focusCol, 0.55));
      g.addColorStop(0.5, hexA(focusCol, 0.3));
      g.addColorStop(1, hexA(C_GLOW, 0.7));
      return g;
    });
    ctx.fillStyle = rg;
    ctx.fillRect(left, railY + 1, Math.max(1, wide), 5);
  }
  lit(ctx, () => drawGlow(ctx, signedX, railY + 3.5, 8 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let i = 0; i < 3; i++) {
    const zx = railX + railW * ((i + 0.5) / 3);
    const id: MorphFocus = i === 0 ? "a" : i === 1 ? "b" : "c";
    const col = i === 0 ? C_OA : i === 1 ? C_OB : C_OC;
    if (i > 0) {
      ctx.fillStyle = hexA(C_MID, 0.18);
      ctx.fillRect(railX + railW * (i / 3), railY - 2, 1, 11);
    }
    ctx.fillStyle = hexA(col, id === p.focus ? 0.95 : 0.42);
    ctx.fillText(id.toUpperCase(), zx, railY - 4);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_DEPTH, 0.75);
  ctx.fillText(`→WT ${p.focus.toUpperCase()} ${focusVal >= 0 ? "+" : ""}${Math.round(focusVal * 100)}`, railX + 2, railY - 4);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "LFO1 · PHASE AURORA",
    `${p.rate.toFixed(2)}Hz · D${Math.round(depth * 100)} · ${p.dest === "off" ? "IDLE" : `→${p.dest.toUpperCase()}`}`,
    C_GLOW,
    isLive ? C_DEST : C_MID,
  );
}

export function Lfo1StageViz() {
  const wave = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const depth = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const lfoA = useFireCommandStore((s) => s.patch.oscALfo) ?? 0;
  const lfoB = useFireCommandStore((s) => s.patch.oscBLfo) ?? 0;
  const lfoC = useFireCommandStore((s) => s.patch.oscCLfo) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const focusRef = useRef<MorphFocus>("a");
  const prevKey = useRef(0);
  const st = useRef<Lfo1VizState>({ wave, rate, depth, dest, lfoA, lfoB, lfoC, focus: focusRef.current });
  st.current = { wave, rate, depth, dest, lfoA, lfoB, lfoC, focus: focusRef.current };

  const live =
    depth > 0.02 ||
    Math.abs(lfoA) > 0.04 ||
    Math.abs(lfoB) > 0.04 ||
    Math.abs(lfoC) > 0.04 ||
    dest !== "off";

  useEffect(() => {
    const key = motionHash(WAVE_CYCLE.indexOf(wave), rate, depth, destIdx(dest), lfoA, lfoB, lfoC);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1; // retrigger flash on any param change
    }
  }, [wave, rate, depth, dest, lfoA, lfoB, lfoC]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("lfo1Rate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("lfo1Depth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyMorph = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const signed = clamp(x * 2 - 1, -1, 1);
      const key = focusRef.current === "a" ? "oscALfo" : focusRef.current === "b" ? "oscBLfo" : "oscCLfo";
      setParam(key, Math.round(signed * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (y > H * 0.78) {
        focusRef.current = x < 0.33 ? "a" : x < 0.66 ? "b" : "c";
        st.current.focus = focusRef.current;
        dragRef.current = "morph";
        wrap.setPointerCapture(e.pointerId);
        applyMorph(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMorph, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "morph") applyMorph(e.clientX);
    },
    [applyXy, applyMorph],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const i = WAVE_CYCLE.indexOf(st.current.wave);
    const next = WAVE_CYCLE[(i + 1) % WAVE_CYCLE.length]!;
    setParam("lfo1Wave", next);
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
        paintLfo1(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          (st.current.depth ?? 0) > 0.02 ||
          st.current.dest !== "off" ||
          Math.abs(st.current.lfoA ?? 0) > 0.04 ||
          Math.abs(st.current.lfoB ?? 0) > 0.04 ||
          Math.abs(st.current.lfoC ?? 0) > 0.04,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          WAVE_CYCLE.indexOf(st.current.wave),
          st.current.rate,
          st.current.depth,
          destIdx(st.current.dest),
          st.current.lfoA,
          st.current.lfoB,
          st.current.lfoC,
          st.current.focus === "a" ? 0 : st.current.focus === "b" ? 1 : 2,
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
      title="Drag: Rate ↔ / Depth ↕ · Bottom: LFO→WT (thirds A/B/C) · Double-click: cycle wave"
      role="img"
      aria-label="LFO 1 phase aurora"
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
        Phase Aurora
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{
          color: hexA(live ? C_HOT : C_MID, live ? 0.9 : 0.7),
          textShadow: live ? `0 0 10px ${hexA(C, 0.65)}` : undefined,
        }}
      >
        {live ? "ACTIVE" : "IDLE"}
      </div>
    </div>
  );
}
