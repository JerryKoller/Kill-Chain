/**
 * Glue — Press Anvil stage visualizer.
 *
 * IDIOM: the gain reduction trace. A chart recorder running left→right as time,
 * which is the shape a compressor actually has. The dim trace is the programme
 * going in, the bright trace is what comes out, and the shaded gap between them
 * IS the gain reduction. The threshold is a line the programme crosses; the knee
 * is the soft band around it. Attack and release are not captions — the envelope
 * follower is simulated across the window, so a fast attack visibly snaps the
 * gap open and a long release visibly holds it.
 *
 * Bus DynamicsCompressor via punch (Signal Path Mix · FC.glue).
 * Drag ↕/↔: Punch. Double-click: cycle Off → Soft → Bus → Crush → Slam.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { GlueMode } from "@/audio/dsp/mixClarity";
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
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 172;
const C = FC.glue;
const C_DEEP = bandShade(FC_BAND.mix, 0.28);
const C_MID = bandShade(FC_BAND.mix, 0.45);
const C_HOT = bandShade(FC_BAND.mix, 0.58);
const C_GLOW = bandShade(FC_BAND.mix, 0.9);
const C_GR = bandShade(FC_BAND.mix, 0.68);
const C_VU = bandShade(FC_BAND.mix, 0.78);
const C_MK = bandShade(FC_BAND.mix, 0.84);

const PUNCH_CYCLE = [0, 0.25, 0.45, 0.7, 1] as const;

/** Chart window — 2.4 s of programme across the panel. */
const WINDOW_MS = 2400;
/** dB window: headroom above 0 so makeup gain is visible. */
const DB_TOP = 6;
const DB_BOT = -48;
const DB_RANGE = DB_TOP - DB_BOT;

const MAX_STEPS = 512;
/** Scratch traces — fully rewritten each paint, so never stale. */
const IN_DB = new Float32Array(MAX_STEPS + 1);
const OUT_DB = new Float32Array(MAX_STEPS + 1);
const GR_DB = new Float32Array(MAX_STEPS + 1);

/** Mirrors the engine's punch→glue macro so displayed ballistics are honest. */
const MODE_BALLISTICS: Record<GlueMode, { atk: number; rel: number; knee: number }> = {
  soft: { atk: 0.012, rel: 0.28, knee: 12 },
  glue: { atk: 0.008, rel: 0.18, knee: 6 },
  bus: { atk: 0.006, rel: 0.14, knee: 4 },
  punch: { atk: 0.018, rel: 0.12, knee: 3 },
  slam: { atk: 0.0015, rel: 0.06, knee: 0 },
};

/** Modes hashed as ordinals so `motionHash` stays numeric. */
const MODE_IDX: Record<GlueMode, number> = { soft: 0, glue: 1, bus: 2, punch: 3, slam: 4 };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function punchLabel(p: number): string {
  if (p < 0.03) return "OPEN";
  if (p < 0.3) return "SOFT";
  if (p < 0.55) return "GLUE";
  if (p < 0.8) return "CRUSH";
  return "SLAM";
}

/** Mirror DSP mapping for display. */
function glueMetrics(punch: number) {
  const p = clamp(punch, 0, 1);
  return {
    threshDb: -p * 30,
    ratio: 1 + p * 7,
    makeupDb: 20 * Math.log10(1 + p * 0.3),
    grDb: p * (6 + p * 8), // display-ballistic estimate
  };
}

/** Deterministic scatter — the programme is a fixed pattern, not noise. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Deterministic programme level in dB at an absolute time. A ~125 BPM pattern
 * with accented downbeats — enough transient shape that attack and release
 * differences are obvious on the trace.
 */
function progDb(tms: number): number {
  const beat = tms / 480;
  const idx = Math.floor(beat);
  const ph = beat - idx;
  const h = hash01(idx * 1.7);
  const h2 = hash01(idx * 3.3 + 11);
  const accent = (idx & 3) === 0 ? 1 : 0.6 + h * 0.32;
  const env = Math.exp(-ph * (2.1 + h2 * 3.6));
  const bed = 0.15 + h2 * 0.09;
  return DB_BOT + Math.min(1, bed + env * accent) * -DB_BOT;
}

/** Soft-knee gain computer — returns reduction in dB (≥ 0). */
function grFor(inDb: number, thr: number, ratio: number, knee: number): number {
  const slope = 1 - 1 / Math.max(1, ratio);
  const over = inDb - thr;
  if (knee <= 0.01) return over > 0 ? over * slope : 0;
  const half = knee * 0.5;
  if (over <= -half) return 0;
  if (over >= half) return over * slope;
  const t = over + half;
  return (slope * t * t) / (2 * knee);
}

export type GlueVizState = {
  punch: number;
  enabled: boolean;
  mode: GlueMode;
  useAdvanced: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  makeup: number;
  mix: number;
};

/**
 * Paint the gain reduction trace. Exported and pure: the compressor envelope is
 * simulated forward across the window from `now`, so the same inputs always draw
 * the same frame.
 */
export function paintGlue(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: GlueVizState,
  now: number,
  flash: number,
): void {
  const on = p.enabled;
  const punch = on ? clamp(p.punch, 0, 1) : 0;
  const macro = glueMetrics(punch);
  const ball = MODE_BALLISTICS[p.mode] ?? MODE_BALLISTICS.glue;
  const adv = p.useAdvanced;

  const thr = adv ? clamp(p.threshold, -60, 0) : macro.threshDb;
  const ratio = adv ? clamp(p.ratio, 1, 20) : macro.ratio;
  const atkMs = (adv ? clamp(p.attack, 0.001, 0.1) : ball.atk) * 1000;
  const relMs = (adv ? clamp(p.release, 0.02, 1) : ball.rel) * 1000;
  const knee = adv ? clamp(p.knee, 0, 40) : ball.knee;
  const makeupLin = adv ? clamp(p.makeup, 0.5, 4) : 1 + punch * 0.3;
  const makeupDb = 20 * Math.log10(makeupLin);
  const mix = on ? clamp(p.mix, 0, 1) : 0;

  const energy = 0.08 + punch * 0.4 + flash * 0.2;
  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.46 });

  // Geometry: dB up, time right, with a reduction ribbon slung underneath.
  const padL = 40;
  const padR = 58;
  const span = Math.max(60, W - padL - padR);
  const plotTop = 26;
  const plotH = 82;
  const plotBot = plotTop + plotH;
  const ribTop = plotBot + 5;
  const ribH = 16;
  const railY = Hh - 26;
  const dbY = (db: number) => plotTop + ((DB_TOP - clamp(db, DB_BOT, DB_TOP)) / DB_RANGE) * plotH;

  // ── dB grid ──
  ctx.font = VIZ_FONT_LABEL;
  for (let db = DB_TOP; db >= DB_BOT; db -= 6) {
    const y = dbY(db);
    const major = db % 12 === 0;
    ctx.fillStyle = hexA(db === 0 ? C_GLOW : C_MID, db === 0 ? 0.2 : major ? 0.1 : 0.05);
    ctx.fillRect(padL, y, span, 1);
    if (major) {
      ctx.textAlign = "right";
      ctx.fillStyle = hexA(C_MID, 0.42);
      ctx.fillText(db === 0 ? "0" : String(db), padL - 5, y + 3);
    }
  }
  // Time ruler — 400 ms divisions.
  for (let i = 0; i <= 6; i++) {
    const x = padL + (i / 6) * span;
    ctx.fillStyle = hexA(C_MID, 0.07);
    ctx.fillRect(x, plotTop, 1, plotH);
  }

  // ── knee band + threshold ──
  if (knee > 0.2) {
    const kTop = dbY(thr + knee * 0.5);
    const kBot = dbY(thr - knee * 0.5);
    const kg = cachedGrad(ctx, `knee|${kTop | 0}|${kBot | 0}`, (c) => {
      const g = c.createLinearGradient(0, kTop, 0, kBot);
      g.addColorStop(0, hexA(C_GR, 0));
      g.addColorStop(0.5, hexA(C_GR, 0.18));
      g.addColorStop(1, hexA(C_GR, 0));
      return g;
    });
    ctx.fillStyle = kg;
    ctx.fillRect(padL, kTop, span, kBot - kTop);
  }
  const thrY = dbY(thr);
  ctx.strokeStyle = hexA(C_MK, 0.6 + flash * 0.25);
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, thrY);
  ctx.lineTo(padL + span, thrY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MK, 0.78);
  ctx.fillText(`THR ${thr.toFixed(0)} dB`, padL + span + 5, thrY + 3);

  // ── simulate the compressor across the window ──
  const steps = Math.round(clamp(span / 4, 96, MAX_STEPS));
  const dt = WINDOW_MS / steps;
  const aAtk = 1 - Math.exp(-dt / Math.max(0.5, atkMs));
  const aRel = 1 - Math.exp(-dt / Math.max(1, relMs));
  const warm = steps >> 2;
  let env = 0;
  let grNow = 0;
  let grPeak = 0;
  for (let i = -warm; i <= steps; i++) {
    const tms = now - WINDOW_MS + (i / steps) * WINDOW_MS;
    const inDb = progDb(tms);
    const target = grFor(inDb, thr, ratio, knee);
    env += (target - env) * (target > env ? aAtk : aRel);
    if (i < 0) continue;
    const linIn = Math.pow(10, inDb / 20);
    const linWet = Math.pow(10, (inDb - env) / 20);
    const linOut = ((1 - mix) * linIn + mix * linWet) * makeupLin;
    IN_DB[i] = inDb;
    OUT_DB[i] = 20 * Math.log10(Math.max(1e-6, linOut));
    GR_DB[i] = env;
    if (env > grPeak) grPeak = env;
    grNow = env;
  }

  const traceIn = () => {
    for (let i = 0; i <= steps; i++) {
      const x = padL + (i / steps) * span;
      const y = dbY(IN_DB[i]!);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  const traceOut = () => {
    for (let i = 0; i <= steps; i++) {
      const x = padL + (i / steps) * span;
      const y = dbY(OUT_DB[i]!);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  // ── the reduction gap: what the compressor took away ──
  ctx.beginPath();
  traceIn();
  for (let i = steps; i >= 0; i--) {
    ctx.lineTo(padL + (i / steps) * span, dbY(OUT_DB[i]!));
  }
  ctx.closePath();
  const gap = cachedGrad(ctx, `gap|${plotTop}|${plotH}|${(punch * 20) | 0}`, (c) => {
    const g = c.createLinearGradient(0, plotTop, 0, plotBot);
    g.addColorStop(0, hexA(C_GR, 0.42));
    g.addColorStop(0.6, hexA(C_HOT, 0.2));
    g.addColorStop(1, hexA(C_DEEP, 0.06));
    return g;
  });
  ctx.fillStyle = gap;
  ctx.fill();

  // Input trace stays quiet — it is the reference, not the subject.
  ctx.strokeStyle = hexA(C_MID, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  traceIn();
  ctx.stroke();

  // Output trace is the instrument reading.
  glowStroke(ctx, traceOut, C_GLOW, { width: 1.8 + punch * 0.8, glow: 1, alpha: 0.9 });

  // The live edge — where "now" is.
  lit(ctx, () => {
    const ny = dbY(OUT_DB[steps]!);
    drawGlow(ctx, padL + span, ny, 12 + punch * 10 + flash * 8, C_GLOW, 0.7);
  });

  // ── reduction ribbon ──
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(padL, ribTop, span, ribH);
  const GR_FULL = 24;
  ctx.beginPath();
  ctx.moveTo(padL, ribTop);
  for (let i = 0; i <= steps; i++) {
    const x = padL + (i / steps) * span;
    ctx.lineTo(x, ribTop + Math.min(1, GR_DB[i]! / GR_FULL) * ribH);
  }
  ctx.lineTo(padL + span, ribTop);
  ctx.closePath();
  const rg = cachedGrad(ctx, `rib|${ribTop}|${ribH}`, (c) => {
    const g = c.createLinearGradient(0, ribTop, 0, ribTop + ribH);
    g.addColorStop(0, hexA(C_GR, 0.85));
    g.addColorStop(1, hexA(C_VU, 0.28));
    return g;
  });
  ctx.fillStyle = rg;
  ctx.fill();
  ctx.fillStyle = hexA(C_MID, 0.22);
  ctx.fillRect(padL, ribTop, span, 1);

  // Attack / release drawn to the ribbon's own time scale — the numbers become
  // lengths you can compare against how fast the gap actually moved.
  const msPx = span / WINDOW_MS;
  const bracket = (x0: number, len: number, col: string, text: string) => {
    const w = Math.max(3, len * msPx);
    const y = ribTop + ribH + 7;
    ctx.strokeStyle = hexA(col, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y - 3);
    ctx.lineTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.lineTo(x0 + w, y - 3);
    ctx.stroke();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(col, 0.72);
    ctx.fillText(text, x0 + w + 4, y + 3);
  };
  bracket(padL, atkMs, C_HOT, `ATK ${atkMs < 10 ? atkMs.toFixed(1) : atkMs.toFixed(0)}ms`);
  bracket(padL + span * 0.42, relMs, C_VU, `REL ${relMs.toFixed(0)}ms`);

  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GR, 0.9);
  ctx.fillText(`GR −${grNow.toFixed(1)}`, padL + span + 5, ribTop + 11);
  ctx.font = VIZ_FONT_LABEL;
  ctx.fillStyle = hexA(C_VU, 0.6);
  ctx.fillText(`PK −${grPeak.toFixed(1)}`, padL + span + 5, ribTop + ribH + 10);

  // ── telemetry row ──
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so it can't collide at any panel width.
  ctx.font = VIZ_FONT_LABEL;
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
  tel(adv ? `${p.mode.toUpperCase()} · ADV` : p.mode.toUpperCase(), adv ? C_GLOW : C_MID, 0.7);
  tel(`THR ${thr.toFixed(0)} dB`, C_MK, 0.72);
  tel(`RAT ${ratio.toFixed(1)}:1`, C_HOT, 0.8);
  tel(`MKP +${makeupDb.toFixed(1)} dB`, C_MK, 0.76);
  tel(`KNEE ${knee.toFixed(0)}`, C_GR, 0.66);
  tel(`MIX ${Math.round(mix * 100)}`, C_VU, 0.62);

  pill(ctx, W * 0.5, 2, on ? punchLabel(punch) : "BYPASS", on ? C_GLOW : C_MID, { glow: flash, height: 12 });

  // ── punch rail: drag affordance, cycle notches, and the ratio teeth ──
  const railPad = 14;
  const railW = W - railPad * 2;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railPad, railY, railW, 6);
  ctx.fillStyle = hexA(C_HOT, 0.55 + flash * 0.25);
  ctx.fillRect(railPad, railY + 1, Math.max(2, railW * punch), 4);
  for (let i = 0; i <= 8; i++) {
    const tx = railPad + (i / 8) * railW;
    ctx.fillStyle = hexA(C_GLOW, i / 8 <= punch ? 0.85 : 0.16);
    ctx.fillRect(tx - 0.6, railY - 2, 1.2, 10);
  }
  for (const notch of PUNCH_CYCLE) {
    const nx = railPad + notch * railW;
    if (Math.abs(punch - notch) < 0.04) {
      ctx.fillStyle = hexA(C_GLOW, 0.95);
      ctx.fillRect(nx - 1.5, railY - 4, 3, 14);
    }
  }
  lit(ctx, () => drawGlow(ctx, railPad + railW * punch, railY + 3, 8 + flash * 5, C_GLOW, 0.85));

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
    on ? "PRESS ANVIL" : "PRESS ANVIL · BYPASS",
    `${punchLabel(punch)} · ${Math.round(punch * 100)}%`,
    C_GLOW,
    on ? C_HOT : C_MID,
  );
}

export function GlueStageViz() {
  const punch = useFireCommandStore((s) => s.patch.punch) ?? 0;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["glue"] !== false);
  const mode = (useFireCommandStore((s) => s.patch.glueMode) ?? "glue") as GlueMode;
  const useAdvanced = useFireCommandStore((s) => s.patch.glueUseAdvanced) === true;
  const threshold = useFireCommandStore((s) => s.patch.glueThreshold) ?? -18;
  const ratio = useFireCommandStore((s) => s.patch.glueRatio) ?? 3;
  const attack = useFireCommandStore((s) => s.patch.glueAttack) ?? 0.008;
  const release = useFireCommandStore((s) => s.patch.glueRelease) ?? 0.18;
  const knee = useFireCommandStore((s) => s.patch.glueKnee) ?? 6;
  const makeup = useFireCommandStore((s) => s.patch.glueMakeup) ?? 1;
  const mix = useFireCommandStore((s) => s.patch.glueMix) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const st = useRef<GlueVizState>({
    punch, enabled, mode, useAdvanced, threshold, ratio, attack, release, knee, makeup, mix,
  });
  st.current = { punch, enabled, mode, useAdvanced, threshold, ratio, attack, release, knee, makeup, mix };

  const live = enabled && punch > 0.03;

  useEffect(() => {
    const key = motionHash(
      punch, enabled, MODE_IDX[mode] ?? 1, useAdvanced, threshold, ratio, attack, release, knee, makeup, mix,
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [punch, enabled, mode, useAdvanced, threshold, ratio, attack, release, knee, makeup, mix]);

  const applyPunch = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      // Prefer vertical press metaphor; blend with X for pad feel
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const v = clamp(1 - y * 0.75 + (x - 0.5) * 0.15, 0, 1);
      setParam("punch", Math.round(v * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = true;
      flashRef.current = 1;
      applyPunch(e.clientX, e.clientY);
    },
    [applyPunch],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      applyPunch(e.clientX, e.clientY);
    },
    [applyPunch],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = false;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.punch;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < PUNCH_CYCLE.length; i++) {
      const d = Math.abs(PUNCH_CYCLE[i]! - cur);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setParam("punch", PUNCH_CYCLE[(best + 1) % PUNCH_CYCLE.length]!);
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
        paintGlue(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
        dragging: !!dragRef.current,
        particles: 0,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.punch,
          st.current.enabled,
          MODE_IDX[st.current.mode] ?? 1,
          st.current.useAdvanced,
          st.current.threshold,
          st.current.ratio,
          st.current.attack,
          st.current.release,
          st.current.knee,
          st.current.makeup,
          st.current.mix,
        ),
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)] cursor-ns-resize touch-none select-none"
      style={{
        borderColor: `${C}${live ? "77" : "44"}`,
        height: H,
        boxShadow: live
          ? `inset 0 2px 8px rgba(0,0,0,0.45), 0 0 28px ${C}33, 0 6px 18px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="slider"
      aria-label="Bus glue punch — drag to press"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(punch * 100)}
      title="Drag ↕ punch · Double-click cycles Off → Soft → Bus → Crush → Slam"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 70% 100%, 0 100%)", opacity: 0.7 }} />
      <span className="pointer-events-none absolute right-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 100% 100%, 30% 100%)", opacity: 0.7 }} />
    </div>
  );
}
