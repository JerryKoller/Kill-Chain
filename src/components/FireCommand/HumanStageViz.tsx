/**
 * Humanize — Feel Grain stage visualizer.
 *
 * IDIOM: the jitter scatter. A bar of sixteenth grid lines runs the width with
 * the nominal velocity line across it; every note is plotted where humanize
 * would actually put it — pushed off its grid line by the timing jitter and off
 * the velocity line by the velocity variance, with a leader back to where it
 * "should" have been. Amount visibly widens the cloud: the timing window under
 * each grid line and the velocity band around the centre line grow with it.
 *
 * The scatter is drawn from the patch's humanize seed, not live randomness, so
 * it is the same cloud the engine will play. With seed mode `perPlay` the sample
 * re-rolls on a slow clock (each play differs); with `fixed` it never moves.
 * Protected downbeats stay pinned to the grid.
 *
 * Micro timing × velocity scatter (Signal Path Perf · FC.human).
 * Drag pad: X = Timing · Y = Velocity · bottom toggles feel · top cycles characters.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
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
  VIZ_FONT_VALUE,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 168;
const C = FC.human;
const C_DEEP = bandShade(FC_BAND.perf, 0.44);
const C_MID = bandShade(FC_BAND.perf, 0.58);
const C_HOT = bandShade(FC_BAND.perf, 0.74);
const C_GLOW = bandShade(FC_BAND.perf, 0.96);
const C_TIME = bandShade(FC_BAND.perf, 0.55);
const C_VEL = bandShade(FC_BAND.perf, 0.82);
const C_ARM = bandShade(FC_BAND.perf, 0.88);

export const HUMAN_CHARS = [
  { id: "grid", label: "Grid", timing: 0, vel: 0, on: false },
  { id: "soft", label: "Soft", timing: 0.12, vel: 0.1, on: true },
  { id: "pocket", label: "Pocket", timing: 0.25, vel: 0.2, on: true },
  { id: "loose", label: "Loose", timing: 0.45, vel: 0.35, on: true },
  { id: "drunk", label: "Drunk", timing: 0.7, vel: 0.55, on: true },
  { id: "wild", label: "Wild", timing: 0.9, vel: 0.85, on: true },
  { id: "time", label: "Time", timing: 0.65, vel: 0.08, on: true },
  { id: "dyn", label: "Dyn", timing: 0.08, vel: 0.7, on: true },
] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function near(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

export function humanCharMatch(timing: number, vel: number, on: boolean) {
  return HUMAN_CHARS.find((c) => c.on === on && near(timing, c.timing) && near(vel, c.vel)) ?? null;
}

/**
 * Seeded hash in the same shape as the engine's humanize RNG — the scatter must
 * be the patch's actual jitter, and it must not crawl on an idle canvas.
 */
function hashSeed(seed: number, i: number): number {
  let t = (seed ^ Math.imul(i + 1, 2654435761)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

type DragMode = "pad" | "arm" | null;

const STEPS = 16;
const NOTES = 48;
/** ms per re-roll when the patch re-seeds every play. */
const ROLL_MS = 1100;

export type HumanVizState = {
  on: boolean;
  timing: number;
  vel: number;
  enabled: boolean;
  /** Patch humanize seed — the scatter is derived from this. */
  seed: number;
  /** True when the seed re-rolls per play. */
  perPlay: boolean;
  /** True when downbeats are pinned to the grid. */
  protectDownbeats: boolean;
  /** Matched character label (resolved outside the paint path). */
  label: string;
};

/**
 * Paint the jitter scatter. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintHuman(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: HumanVizState,
  now: number,
  flash: number,
): void {
  const active = p.enabled && p.on;
  const dim = p.enabled ? 1 : 0.45;
  const timing = clamp(p.timing, 0, 1);
  const vel = clamp(p.vel, 0, 1);
  const energy = (timing + vel) * 0.5;
  // perPlay re-rolls the sample on a slow clock; fixed keeps one still cloud.
  const roll = p.perPlay && active ? Math.floor(now / ROLL_MS) : 0;
  const seed = (p.seed ^ Math.imul(roll + 1, 2246822519)) >>> 0;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy: 0.08 + (active ? energy * 0.34 : 0.02) + flash * 0.16, horizon: 0.62 });

  const padL = 26;
  const padR = 26;
  const span = Math.max(80, W - padL - padR);
  const slotW = span / STEPS;
  const gridTop = 32;
  const gridBot = Hh - 40;
  const plotH = gridBot - gridTop;
  const velY = gridTop + plotH * 0.5;
  const velSpread = vel * plotH * 0.42;
  const timeSpread = timing * slotW * 0.9;

  // ── velocity tolerance band ──
  if (velSpread > 0.5) {
    const band = cachedGrad(ctx, `vband|${gridTop}|${gridBot}`, (c) => {
      const g = c.createLinearGradient(0, gridTop, 0, gridBot);
      g.addColorStop(0, hexA(C_VEL, 0));
      g.addColorStop(0.5, hexA(C_VEL, 0.16));
      g.addColorStop(1, hexA(C_VEL, 0));
      return g;
    });
    ctx.save();
    ctx.globalAlpha = dim * (active ? 1 : 0.4);
    ctx.fillStyle = band;
    ctx.fillRect(padL - 8, velY - velSpread, span + 16, velSpread * 2);
    ctx.restore();
    ctx.strokeStyle = hexA(C_VEL, 0.22 * dim);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL - 8, velY - velSpread);
    ctx.lineTo(padL + span + 8, velY - velSpread);
    ctx.moveTo(padL - 8, velY + velSpread);
    ctx.lineTo(padL + span + 8, velY + velSpread);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── grid ──
  for (let i = 0; i <= STEPS; i++) {
    const x = padL + i * slotW;
    const beat = i % 4 === 0;
    const pinned = p.protectDownbeats && beat && i < STEPS;
    ctx.fillStyle = hexA(pinned ? C_HOT : C, beat ? 0.24 : 0.09);
    ctx.fillRect(x - 0.5, gridTop, beat ? 1.2 : 1, plotH);
    if (beat && i < STEPS) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(pinned ? C_HOT : C_MID, 0.5);
      ctx.fillText(`${i / 4 + 1}${pinned ? " ·PIN" : ""}`, x + 3, gridBot + 11);
    }
    // Timing window under each grid line — the cloud's width, to scale.
    if (i < STEPS && timeSpread > 0.5) {
      const pin = p.protectDownbeats && beat;
      const w = pin ? 0 : timeSpread;
      ctx.fillStyle = hexA(pin ? C_HOT : C_TIME, (pin ? 0.5 : 0.34) * dim);
      ctx.fillRect(x - w, gridBot - 5, Math.max(1.2, w * 2), 2);
    }
  }

  // Nominal velocity line.
  ctx.fillStyle = hexA(C_VEL, 0.3 * dim);
  ctx.fillRect(padL - 8, velY, span + 16, 1);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_VEL, 0.55 * dim);
  ctx.fillText("VEL NOM", padL - 12, velY + 3);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_TIME, 0.5 * dim);
  ctx.fillText("TIMING →", padL + span, gridBot + 11);

  // ── the scatter ──
  for (let i = 0; i < NOTES; i++) {
    const slot = i % STEPS;
    const gx = padL + slot * slotW;
    const pinned = p.protectDownbeats && slot % 4 === 0;
    const jt = pinned || !active ? 0 : hashSeed(seed, i) * 2 - 1;
    const jv = active ? hashSeed(seed ^ 0x9e3779b9, i) * 2 - 1 : 0;
    const x = gx + jt * timeSpread;
    const y = velY - jv * velSpread;
    const noteVel = clamp(0.72 + jv * 0.28, 0.05, 1);
    const off = Math.abs(jt);

    // Leader back to the quantized position.
    if (active && (Math.abs(x - gx) > 0.6 || Math.abs(y - velY) > 0.6)) {
      ctx.strokeStyle = hexA(C_MID, 0.1 + off * 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, velY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    const sz = 1.5 + noteVel * 2.2;
    const a = (active ? 0.5 + noteVel * 0.42 : 0.22) * dim;
    ctx.fillStyle = hexA(pinned ? C_HOT : C_GLOW, a);
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      lit(ctx, () => drawGlow(ctx, x, y, 5 + noteVel * 6, pinned ? C_HOT : C_GLOW, 0.16 + energy * 0.24));
    }
    // Velocity stem — how far this note drifted off the nominal line.
    if (active && Math.abs(y - velY) > 2) {
      ctx.fillStyle = hexA(C_VEL, 0.18 + Math.abs(jv) * 0.2);
      ctx.fillRect(x - 0.5, Math.min(y, velY), 1, Math.abs(y - velY));
    }
  }

  // ── amount cursor: the pad handle (X = timing, Y = velocity) ──
  const cx = timing * W;
  const cy = Hh * 0.14 + (1 - vel) * (Hh * 0.7);
  ctx.strokeStyle = hexA(C_ARM, 0.45 * dim);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy);
  ctx.lineTo(cx + 9, cy);
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx, cy + 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 4.5 + flash * 2, 0, Math.PI * 2);
  ctx.strokeStyle = hexA(C_GLOW, 0.7 * dim);
  ctx.stroke();
  if (active) lit(ctx, () => drawGlow(ctx, cx, cy, 12 + flash * 8, C_GLOW, 0.4));

  // ── character strip + telemetry ──
  const padX = 10;
  const usable = W - padX * 2;
  const stripY = 18;
  const segW = usable / HUMAN_CHARS.length;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(padX, stripY, usable, 6);
  for (let i = 0; i < HUMAN_CHARS.length; i++) {
    const hit = HUMAN_CHARS[i]!.label === p.label;
    ctx.fillStyle = hit ? hexA(C_HOT, 0.8 + flash * 0.2) : hexA(C, 0.1);
    ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, 4);
  }
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so it can't collide at any panel width.
  ctx.textAlign = "left";
  let telX = VIZ_TOP_LABEL_X;
  const telRight = W * 0.5 - 52;
  const tel = (text: string, color: string, alpha: number, font: string) => {
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    if (telX + tw > telRight) return;
    ctx.fillStyle = hexA(color, alpha);
    ctx.fillText(text, telX, VIZ_TOP_LABEL_Y);
    telX += tw + 14;
  };
  tel(`FEEL · ${p.label.toUpperCase()}`, C_GLOW, 0.7 * dim, VIZ_FONT_LABEL);
  tel(
    `SEED ${(p.seed >>> 0).toString(16).toUpperCase()} · ${p.perPlay ? "PER PLAY" : "FIXED"}`,
    C_MID,
    0.7,
    VIZ_FONT_VALUE,
  );

  pill(ctx, W * 0.5, 3, !p.enabled ? "ASLEEP" : active ? p.label.toUpperCase() : "GRID", C_GLOW, { glow: flash });

  // ── arm rail (bottom drag zone) ──
  const railY = Hh - 25;
  const armT = !p.enabled ? 0 : p.on ? 1 : 0.12;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padX, railY, usable, 6);
  ctx.fillStyle = hexA(C_ARM, 0.5 * dim);
  ctx.fillRect(padX, railY + 1, Math.max(2, usable * armT), 4);
  lit(ctx, () => drawGlow(ctx, padX + usable * armT, railY + 3, 7 + flash * 4, C_GLOW, 0.8 * dim));

  grain(ctx, W, Hh, 0.03);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    !p.enabled ? "FEEL GRAIN · ASLEEP" : active ? `FEEL GRAIN · ${p.label.toUpperCase()}` : "FEEL GRAIN · GRID",
    `T${Math.round(timing * 100)} · V${Math.round(vel * 100)}`,
    C_GLOW,
    C,
  );
}

export function HumanStageViz() {
  const on = useFireCommandStore((s) => s.patch.humanizeOn);
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming) ?? 0.25;
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity) ?? 0.2;
  const seed = useFireCommandStore((s) => s.patch.humanizeSeed) ?? 0x4f1ce;
  const seedMode = useFireCommandStore((s) => s.patch.humanizeSeedMode) ?? "fixed";
  const protectDownbeats = useFireCommandStore((s) => s.patch.humanizeProtectDownbeats) !== false;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["human"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<HumanVizState>({
    on,
    timing,
    vel,
    enabled,
    seed,
    perPlay: seedMode === "perPlay",
    protectDownbeats,
    label: humanCharMatch(timing, vel, on)?.label ?? "Custom",
  });
  st.current = {
    on,
    timing,
    vel,
    enabled,
    seed,
    perPlay: seedMode === "perPlay",
    protectDownbeats,
    label: humanCharMatch(timing, vel, on)?.label ?? "Custom",
  };

  const live = enabled && on && (timing > 0.02 || vel > 0.02);

  useEffect(() => {
    const key = motionHash(on, enabled, timing, vel, seed, seedMode === "perPlay", protectDownbeats);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [on, enabled, timing, vel, seed, seedMode, protectDownbeats]);

  const cycleChar = useCallback(
    (dir = 1) => {
      const s = st.current;
      let best = 0;
      for (let i = 0; i < HUMAN_CHARS.length; i++) {
        const c = HUMAN_CHARS[i]!;
        if (c.on === s.on && near(s.timing, c.timing) && near(s.vel, c.vel)) {
          best = i;
          break;
        }
      }
      const next = HUMAN_CHARS[(best + dir + HUMAN_CHARS.length) % HUMAN_CHARS.length]!;
      setParam("humanizeOn", next.on);
      setParam("humanizeTiming", next.timing);
      setParam("humanizeVelocity", next.vel);
      flashRef.current = 1;
    },
    [setParam],
  );

  const applyPad = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const padTop = 0.14;
      const padBot = 0.84;
      const yNorm = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      // Invert Y so top = high velocity
      const yPad = clamp((yNorm - padTop) / Math.max(0.01, padBot - padTop), 0, 1);
      const timingV = Math.round(x * 1000) / 1000;
      const velV = Math.round((1 - yPad) * 1000) / 1000;
      setParam("humanizeTiming", timingV);
      setParam("humanizeVelocity", velV);
      if (!st.current.on) setParam("humanizeOn", true);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yNorm = (e.clientY - rect.top) / Math.max(1, rect.height);
      flashRef.current = 1;
      if (yNorm > 0.86) {
        dragRef.current = "arm";
        setParam("humanizeOn", !st.current.on);
        return;
      }
      if (yNorm < 0.12) {
        cycleChar(1);
        return;
      }
      dragRef.current = "pad";
      applyPad(e.clientX, e.clientY);
    },
    [applyPad, cycleChar, setParam, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragRef.current !== "pad") return;
      applyPad(e.clientX, e.clientY);
    },
    [applyPad],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintHuman(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        const s = st.current;
        // A fixed-seed cloud is a still image: no frames until something changes.
        // A per-play seed only needs one repaint per re-roll, so the roll index
        // rides in the motion key instead of holding the loop awake.
        const roll = s.perPlay && s.on && s.enabled ? Math.floor(performance.now() / ROLL_MS) : 0;
        return {
          flash: flashRef.current,
          active: false,
          dragging: !!dragRef.current,
          visible: visibleRef.current,
          motionKey: motionHash(s.on, s.enabled, s.timing, s.vel, s.seed, s.protectDownbeats, roll),
        };
      },
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-crosshair touch-none select-none"
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
      role="img"
      aria-label="Feel grain — drag for timing and velocity, bottom arms feel"
      title="Pad: Timing × Vel · Top: character · Bottom: arm"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
