/**
 * PLUCK — Vactrol Strike stage visualizer.
 *
 * IDIOM: the strike and its ringing tail. A ~10:1 letterbox is exactly the
 * shape of an impulse response, so the panel is one: a hard vertical strike
 * pinned near the left edge, then a damped ring smearing right for as long as
 * the vactrol holds on. Nothing is drawn left of the strike, which makes the
 * whole panel percussive and asymmetric — the opposite of the symmetrical ADSR
 * contours next door.
 *
 * `lpgDecay` sets how far the tail reaches; `lpgColor` tilts it, opening the
 * bright band that dies early against the dark band that runs on, and raising
 * the ring frequency; `lpgModel` reshapes the strike itself through
 * `lpgModelTimes` — fast snaps vertically, sticky and slow ramp into it, and
 * each model's colour bias shifts the tail's brightness.
 *
 * A -60 dB line marks where the tail goes inaudible and the marker there prints
 * the decay time, so the panel reads as a measurement, not a mood.
 *
 * On · Decay · Color · Model · Vel (Signal Path Tone · FC.pluck).
 * Drag: Decay ↔ / Color ↕. Bottom rail: Vel. Click: strike flash. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { lpgModelTimes, type LpgModel } from "@/audio/dsp/toneDifferentiation";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import { useToneTelemetry } from "./useToneTelemetry";
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
const C = FC.pluck;
const C_DEEP = bandShade(FC.tone, 0.18);
const C_MID = bandShade(FC.tone, 0.38);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.92);
const C_DEC = bandShade(FC.tone, 0.48);
const C_COL = bandShade(FC.tone, 0.68);
const C_VEL = bandShade(FC.tone, 0.85);

const DEC_MIN = 0.05;
const DEC_MAX = 2.5;

/** Auto-strike cadence while the gate is armed but nothing is being played. */
const IDLE_STRIKE_MS = 1400;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Deterministic scatter — a fixed grit field, so the tail never crawls. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export type PluckVizState = {
  on: boolean;
  decay: number;
  color: number;
  vel: number;
  model: LpgModel;
  /** performance.now() of the last manual strike — drives the flare, purely. */
  strikeAt: number;
  /** Live telemetry — passed in so the paint stays pure. */
  telStage: string;
  voices: number;
};

/**
 * Paint the impulse response. Exported and pure so any decay / colour / model
 * combination can be rendered headlessly without mounting the component.
 */
export function paintPluck(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: PluckVizState,
  now: number,
  flash: number,
): void {
  const decayN = logNorm(p.decay, DEC_MIN, DEC_MAX);
  const model = lpgModelTimes(p.model ?? "classic", p.decay, p.vel);
  const colorBiased = clamp(p.color + model.colorBias, 0, 1);
  // Strike flare from the manual hit, plus the armed auto-cadence underneath it.
  const sinceHit = Math.max(0, now - p.strikeAt);
  const hitFlare = p.strikeAt > 0 ? Math.exp(-sinceHit / 260) : 0;
  const autoPhase = p.on ? ((now % (IDLE_STRIKE_MS + p.decay * 700)) / (IDLE_STRIKE_MS + p.decay * 700)) : 1;
  const autoFlare = p.on ? Math.exp(-autoPhase * 7) : 0;
  const strike = clamp(Math.max(hitFlare, autoFlare * 0.7), 0, 1);
  const energy = p.on ? 0.2 + colorBiased * 0.32 + p.vel * 0.14 + strike * 0.22 + flash * 0.2 : 0.06;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.56 });

  // ── geometry: strike near the left, time running right ──
  const padL = 46;
  const padR = 24;
  const span = Math.max(60, W - padL - padR);
  const floorY = Hh * 0.5;
  // Vactrol strike time is sub-millisecond for `fast`, several for `sticky` —
  // that difference is the whole reason the models sound different.
  const riseW = clamp(model.strike * 900, 1.5, 26);
  const strikeX = padL + riseW;
  // Reach: how far the tail is still doing something before -60 dB.
  const tailLen = span * (0.2 + decayN * 0.78);
  const ampH = (Hh * 0.34) * (0.45 + p.vel * 0.55);
  const alive = p.on ? 1 : 0.18;

  // ── time ruler + the -60 dB floor ──
  ctx.save();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  // Ruler and the tail marker share one scale: the marker sits at `model.decay`.
  const fullSpanS = model.decay / Math.max(0.05, tailLen / span);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = padL + t * span;
    ctx.fillStyle = hexA(C_MID, 0.1 + (t <= tailLen / span ? 0.08 : 0));
    ctx.fillRect(Math.round(x) + 0.5, floorY + ampH * 0.62, 1, 5);
    if (i % 2 === 0) {
      ctx.fillStyle = hexA(C_MID, 0.4);
      ctx.fillText(`${(t * fullSpanS).toFixed(2)}s`, x, floorY + ampH * 0.62 + 14);
    }
  }
  ctx.restore();
  // -60 dB: 1/1000 of full scale, so a hair above the floor line.
  const quietY = floorY - ampH * 0.06;
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = hexA(C_MID, 0.26);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, quietY);
  ctx.lineTo(padL + span, quietY);
  ctx.stroke();
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.45);
  ctx.fillText("−60dB", padL - 4, quietY + 3);
  ctx.fillStyle = hexA(C_MID, 0.4);
  ctx.fillText("0dB", padL - 4, floorY - ampH + 4);

  // Floor line — the ring mirrors around it.
  ctx.fillStyle = hexA(C_MID, 0.2);
  ctx.fillRect(padL, Math.round(floorY) + 0.5, span, 1);

  // ── the ring: a damped sinusoid inside a decaying envelope ──
  // Two bands. Colour opens the bright one, which always dies first; the dark
  // one carries the tail out past it. That tilt is what `lpgColor` does.
  const ringHz = 5 + colorBiased * 16;
  const drawBand = (lenScale: number, heightScale: number, color: string, alphaMul: number, phase: number) => {
    const len = Math.max(10, tailLen * lenScale);
    const steps = Math.max(60, Math.min(340, (len / 3) | 0));
    ctx.beginPath();
    for (let mirror = 0; mirror < 2; mirror++) {
      const sign = mirror === 0 ? -1 : 1;
      for (let i = 0; i <= steps; i++) {
        const k = mirror === 0 ? i : steps - i;
        const t = k / steps;
        const x = strikeX + t * len;
        const env = Math.exp(-t * (2.2 + (1 - decayN) * 2.6));
        const osc = 0.55 + 0.45 * Math.abs(Math.sin(t * ringHz * Math.PI + phase));
        // Grit on the leading edge — hashed so it is the same field every frame.
        const grit = 1 + (hash01(k * 1.7 + phase * 31) - 0.5) * 0.22 * (1 - decayN);
        const h = ampH * heightScale * env * osc * grit * (mirror === 0 ? 1 : 0.8);
        const y = floorY + sign * h;
        if (mirror === 0 && i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = hexA(color, alphaMul * alive);
    ctx.fill();
  };
  drawBand(1, 0.62, C_DEC, 0.3, 0);
  drawBand(0.42 + colorBiased * 0.4, 0.92 * (0.4 + colorBiased * 0.6), C_HOT, 0.2 + colorBiased * 0.22, 1.7);

  // Envelope outline — the thing you read the decay off.
  const envelope = () => {
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = strikeX + t * tailLen;
      const env = Math.exp(-t * (2.2 + (1 - decayN) * 2.6));
      if (i === 0) ctx.moveTo(x, floorY - ampH * env);
      else ctx.lineTo(x, floorY - ampH * env);
    }
  };
  glowStroke(ctx, envelope, C_GLOW, {
    width: 1.8,
    glow: 0.6 + strike * 0.9 + flash * 0.5,
    alpha: (0.72 + strike * 0.28) * alive,
  });

  // ── the strike itself: model-shaped rise, then the flare ──
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(padL, floorY);
  // Sticky / slow models ramp in; fast snaps almost vertically.
  ctx.quadraticCurveTo(padL + riseW * 0.65, floorY - ampH * 0.35, strikeX, floorY - ampH);
  ctx.lineTo(strikeX, floorY + ampH * 0.8);
  ctx.quadraticCurveTo(padL + riseW * 0.65, floorY + ampH * 0.3, padL, floorY);
  ctx.closePath();
  const hit = cachedGrad(ctx, `strike|${Hh}|${(ampH * 0.25) | 0}`, (c) => {
    const g = c.createLinearGradient(0, floorY - ampH, 0, floorY + ampH);
    g.addColorStop(0, hexA(C_GLOW, 0.6));
    g.addColorStop(0.5, hexA(C_GLOW, 0.9));
    g.addColorStop(1, hexA(C_HOT, 0.4));
    return g;
  });
  ctx.globalAlpha = (0.5 + strike * 0.5) * alive;
  ctx.fillStyle = hit;
  ctx.fill();
  ctx.restore();
  lit(ctx, () => {
    drawGlow(ctx, strikeX, floorY, (18 + p.vel * 20) * (0.5 + strike), C_GLOW, (0.24 + strike * 0.5) * alive);
    drawGlow(ctx, strikeX, floorY, 6 + strike * 10, C_GLOW, (0.4 + strike * 0.5) * alive);
  });
  ctx.fillStyle = hexA(C_GLOW, (0.85 + strike * 0.15) * alive);
  ctx.fillRect(strikeX - 0.75, floorY - ampH, 1.5, ampH * 1.8);

  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLOW, 0.7 * alive);
  ctx.fillText(`STRIKE ${(model.strike * 1000).toFixed(1)}ms`, strikeX + 5, floorY - ampH - 4);

  // ── tail-end marker: where the ring crosses inaudible ──
  const tailX = strikeX + tailLen;
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = hexA(C_DEC, (0.35 + flash * 0.25) * alive);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tailX, floorY - ampH * 0.75);
  ctx.lineTo(tailX, floorY + ampH * 0.75);
  ctx.stroke();
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_DEC, 0.72 * alive);
  ctx.fillText(`${Math.round(model.decay * 1000)}ms`, Math.min(W - 6, tailX - 3), floorY - ampH * 0.75 - 4);

  // ── decay / colour / vel meters as a horizontal strip, not a vertical stack ──
  if (W >= 420) {
    const meters: Array<{ v: number; col: string; label: string }> = [
      { v: decayN, col: C_DEC, label: "DECAY" },
      { v: colorBiased, col: C_COL, label: "COLOR" },
      { v: p.vel, col: C_VEL, label: "VEL" },
    ];
    ctx.font = VIZ_FONT_LABEL;
    for (let i = 0; i < meters.length; i++) {
      const m = meters[i]!;
      const bx = 136 + i * 104;
      const bw = 52;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(bx, 10, bw, 6);
      ctx.fillStyle = hexA(m.col, 0.8);
      ctx.fillRect(bx, 11, Math.max(1, bw * clamp(m.v, 0, 1)), 4);
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(m.col, 0.66);
      ctx.fillText(m.label, bx + bw + 4, 16);
    }
  }

  // Crosshair for the decay × colour drag.
  const hx = logNorm(p.decay, DEC_MIN, DEC_MAX) * W;
  const hy = (1 - p.color) * (Hh * 0.7);
  ctx.strokeStyle = hexA(C_GLOW, p.on ? 0.38 + flash * 0.3 : 0.12);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hx - 8, hy);
  ctx.lineTo(hx + 8, hy);
  ctx.moveTo(hx, hy - 8);
  ctx.lineTo(hx, hy + 8);
  ctx.stroke();
  ctx.fillStyle = hexA(C_HOT, 0.8);
  ctx.beginPath();
  ctx.arc(hx, hy, 3 + flash * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // ── stage / sleep state ──
  let stageName = "SLEEP";
  if (p.on) {
    if (p.voices <= 0 || p.telStage === "idle") stageName = "ARMED";
    else if (p.telStage === "strike") stageName = "STRIKE";
    else if (p.telStage === "ring") stageName = "RING";
    else if (p.telStage === "decay_out" || p.telStage === "release") stageName = "DECAY";
    else stageName = p.telStage.toUpperCase();
  }

  if (!p.on) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, Hh - 24);
    ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.5);
    ctx.fillText("SLEEP · DSP DISABLED", W * 0.5, Hh * 0.34);
  } else if (p.voices > 0) {
    ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_GLOW, 0.9);
    ctx.fillText(`◉ ${stageName}`, W - padR, floorY - ampH - 4);
  }

  pill(ctx, W * 0.5, 3, p.on ? `${(p.model ?? "classic").toUpperCase()} · ${stageName}` : "SLEEP", C_GLOW, { glow: flash });

  // ── vel rail along the bottom, clear of the footer band ──
  const railY = Hh - 25;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  if (p.vel > 0.01) {
    const vg = cachedGrad(ctx, `pluckvel|${W}`, (c) => {
      const g = c.createLinearGradient(12, 0, 12 + railW, 0);
      g.addColorStop(0, hexA(C_HOT, 0.4));
      g.addColorStop(1, hexA(C_VEL, 0.92));
      return g;
    });
    ctx.fillStyle = vg;
    ctx.fillRect(12, railY + 1, Math.max(2, railW * p.vel), 4);
  }
  lit(ctx, () => drawGlow(ctx, 12 + railW * p.vel, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_VEL, 0.7);
  ctx.fillText("VEL", 14, railY - 3);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "PLUCK · VACTROL STRIKE",
    p.on
      ? `${Math.round(p.decay * 1000)}ms · C${Math.round(p.color * 100)} · V${Math.round(p.vel * 100)}`
      : "ADSR MODE",
    C_GLOW,
    p.on ? C_HOT : C_MID,
  );
}

type DragMode = "xy" | "vel" | null;

export function PluckStageViz() {
  const on = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const decay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const color = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const model = useFireCommandStore((s) => s.patch.lpgModel) ?? "classic";
  const setParam = useFireCommandStore((s) => s.setParam);

  const tel = useToneTelemetry();

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  // A timestamp rather than a decaying scalar, so the flare is a pure function
  // of `now` and the RAF callback stays a single paint call.
  const strikeAtRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<PluckVizState>({
    on, decay, color, vel, model, strikeAt: 0, telStage: tel.pluck.stage, voices: tel.voiceCount,
  });
  st.current = {
    on, decay, color, vel, model,
    strikeAt: strikeAtRef.current,
    telStage: tel.pluck.stage,
    voices: tel.voiceCount,
  };

  useEffect(() => {
    const key = motionHash(on, decay, color, vel, model.length, model.charCodeAt(0));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
      if (on) {
        strikeAtRef.current = performance.now();
        st.current.strikeAt = strikeAtRef.current;
      }
    }
  }, [on, decay, color, vel, model]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("lpgDecay", Math.round(logLerp(x, DEC_MIN, DEC_MAX) * 1000) / 1000);
      setParam("lpgColor", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyVel = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("velAmount", Math.round(x * 1000) / 1000);
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
        dragRef.current = "vel";
        wrap.setPointerCapture(e.pointerId);
        applyVel(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
      strikeAtRef.current = performance.now();
      st.current.strikeAt = strikeAtRef.current;
      flashRef.current = 1;
    },
    [applyXy, applyVel, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "vel") applyVel(e.clientX);
    },
    [applyXy, applyVel],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("lpgDecay", 0.4);
    setParam("lpgColor", 0.7);
    setParam("velAmount", 1);
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
        paintPluck(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.on,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.on,
          st.current.decay,
          st.current.color,
          st.current.vel,
          st.current.voices,
          st.current.strikeAt,
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
        borderColor: hexA(C, on ? 0.55 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, on ? 0.28 : 0.08)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Decay ↔ / Color ↕ · Bottom: Vel · Click: strike · Double-click: defaults"
      role="img"
      aria-label="Pluck gate vactrol strike"
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
        Vactrol Strike
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        {(() => {
          if (!on) return "SLEEP";
          const telData = tel.pluck;
          const active = tel.voiceCount > 0;
          if (!active || !telData) return "ARMED";
          if (telData.stage === "strike") return "STRIKE";
          if (telData.stage === "ring") return "RING";
          if (telData.stage === "decay_out" || telData.stage === "release") return "DECAY";
          return "ARMED";
        })()}
      </div>
    </div>
  );
}
