/**
 * Pitch · Glide — Glide Horizon stage visualizer.
 *
 * IDIOM: the glide trajectory. Pitch is a value over time, so the 10:1 letterbox
 * becomes a note timeline: a short phrase of target notes marching left to
 * right, semitone gridlines behind them, and the voice's actual pitch drawn as
 * one continuous trajectory through them.
 *
 * Everything the module owns is visible in that one line. Glide time is the
 * length of the ramp between notes — zero glide and it is a hard step, full
 * glide and the ramp fills the whole slot. The curve mode bends the ramp
 * (linear straight, exp lunging then settling, S easing both ends). The pitch
 * envelope is the spike at each onset that decays back onto the target, with its
 * reach drawn as a band so you can see how far the voice is allowed to travel.
 * Legato transitions carry a tie, always-glide carries a slide chevron, and poly
 * drops the ramps entirely because portamento does not apply.
 *
 * Drag: Env Time ↔ / Amount ↕ (bipolar). Bottom: Glide. Double-click: flip polarity. Click: strike flash.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { GlideCurve, GlideMode } from "@/audio/dsp/FireCommandSynth";
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
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 176;
const C = FC.pitch;
const C_DEEP = bandShade(FC.mod, 0.28);
const C_MID = bandShade(FC.mod, 0.5);
const C_HOT = bandShade(FC.mod, 0.7);
const C_GLOW = bandShade(FC.mod, 0.95);
const C_AMT = bandShade(FC.mod, 0.62);
const C_TIME = bandShade(FC.mod, 0.78);
const C_GLIDE = bandShade(FC.mod, 0.88);
const C_UP = bandShade(FC.mod, 0.92);
const C_DN = bandShade(FC.mod, 0.45);

const AMT_MIN = -48;
const AMT_MAX = 48;
const TIME_MIN = 0.01;
const TIME_MAX = 2;

/** The demo phrase, in semitones from the root — a fixed, readable little line. */
const PHRASE = [0, 4, -3, 7, 2] as const;
/** Seconds each note holds in the drawn timeline. */
const SLOT_SEC = 0.5;
/** Chord the poly view stacks, since portamento does not apply there. */
const POLY_STACK = [0, 4, 7] as const;

const CURVES: GlideCurve[] = ["linear", "exp", "s"];
const MODES: GlideMode[] = ["always", "legato"];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Glide shaping — the three curves have to look plainly different. */
function glideCurveAt(curve: GlideCurve, u: number): number {
  const t = clamp(u, 0, 1);
  if (curve === "linear") return t;
  if (curve === "s") return t * t * (3 - 2 * t);
  // exp: lunges off the old note, then settles onto the new one
  return (1 - Math.exp(-4.2 * t)) / EXP_NORM;
}

const EXP_NORM = 1 - Math.exp(-4.2);

type DragMode = "xy" | "glide" | null;

export type PitchVizState = {
  amt: number;
  time: number;
  glide: number;
  mono: boolean;
  glideMode: GlideMode;
  glideCurve: GlideCurve;
  /** Timestamp of the last pointer strike — decays in-paint, so it stays pure. */
  strikeAt: number;
};

/**
 * Paint the glide trajectory. Exported and pure so it renders headlessly without
 * mounting the component.
 */
export function paintPitch(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: PitchVizState,
  now: number,
  flash: number,
): void {
  const t = now / 1000;
  const amt = clamp(p.amt, AMT_MIN, AMT_MAX);
  const glide = clamp(p.glide, 0, 1);
  const timeN = logNorm(p.time, TIME_MIN, TIME_MAX);
  const amtN = clamp((amt - AMT_MIN) / (AMT_MAX - AMT_MIN), 0, 1);
  const dir = Math.sign(amt) || 0;
  const envCol = dir > 0 ? C_UP : dir < 0 ? C_DN : C_MID;
  const strike = clamp(Math.exp(-Math.max(0, now - p.strikeAt) / 260), 0, 1);
  const isLive = Math.abs(amt) > 0.5 || glide > 0.02;
  const energy =
    0.12 + Math.min(1, Math.abs(amt) / 24) * 0.36 + glide * 0.24 + (p.mono ? 0.08 : 0) +
    flash * 0.22 + strike * 0.2;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // ── geometry ──
  const xL = 40;
  const xR = W - 16;
  const span = Math.max(80, xR - xL);
  // The lane starts below the reserved top strip, so the semitone axis label
  // and telemetry row that sit just above it clear the DOM chrome.
  const laneTop = 34;
  const laneBot = Hh - 52;
  const mid = (laneTop + laneBot) * 0.5;
  const halfH = (laneBot - laneTop) * 0.5;
  // Vertical scale follows the env reach, so a ±48 st env visibly dwarfs the line.
  const stSpan = clamp(Math.abs(amt) * 1.15 + 6, 9, 54);
  const gridStep = stSpan <= 12 ? 2 : stSpan <= 26 ? 4 : 12;
  const yOf = (semis: number) => mid - (clamp(semis, -stSpan, stSpan) / stSpan) * halfH;

  const slots = PHRASE.length;
  const slotW = span / slots;
  const gFrac = p.mono ? clamp(glide, 0, 0.98) : 0;
  const eFrac = clamp(p.time / SLOT_SEC, 0.02, 1);

  /** Target pitch for a slot, and the note before it. */
  const noteAt = (i: number) => PHRASE[((i % slots) + slots) % slots]!;

  /** Glide/step target at window position u (0..1). */
  const baseAt = (u: number, offset: number) => {
    const raw = u * slots;
    const slot = Math.min(slots - 1, Math.floor(raw));
    const local = raw - slot;
    const to = noteAt(slot) + offset;
    const from = noteAt(slot - 1) + offset;
    if (gFrac <= 0.001 || local >= gFrac) return to;
    return from + (to - from) * glideCurveAt(p.glideCurve, local / gFrac);
  };

  /** Pitch-envelope contribution at u — a spike at onset decaying to nothing. */
  const envAt = (u: number) => {
    const raw = u * slots;
    const local = raw - Math.min(slots - 1, Math.floor(raw));
    return amt * Math.exp((-3 * local) / eFrac);
  };

  // ── semitone grid ──
  ctx.font = VIZ_FONT_LABEL;
  for (let s = -Math.floor(stSpan / gridStep) * gridStep; s <= stSpan; s += gridStep) {
    const y = yOf(s);
    const zero = s === 0;
    ctx.fillStyle = hexA(zero ? C_GLOW : C_MID, zero ? 0.3 : 0.09);
    ctx.fillRect(xL, y, span, 1);
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(zero ? C_GLOW : C_MID, zero ? 0.7 : 0.34);
    ctx.fillText(zero ? "0" : `${s > 0 ? "+" : ""}${s}`, xL - 4, y + 3);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MID, 0.4);
  ctx.fillText("ST", 12, laneTop - 4);

  // ── slot boundaries + target notes ──
  for (let i = 0; i < slots; i++) {
    const x = xL + i * slotW;
    ctx.fillStyle = hexA(C_MID, 0.12);
    ctx.fillRect(x, laneTop, 1, laneBot - laneTop);
    // Glide ramp window inside the slot.
    if (gFrac > 0.005) {
      ctx.fillStyle = hexA(C_GLIDE, 0.07 + glide * 0.06);
      ctx.fillRect(x, laneTop, slotW * gFrac, laneBot - laneTop);
    }
  }

  // ── env reach band around the target line ──
  if (Math.abs(amt) > 0.5) {
    const bandN = Math.max(24, Math.min(600, Math.floor(span / 4)));
    ctx.beginPath();
    for (let i = 0; i <= bandN; i++) {
      const u = i / bandN;
      ctx.lineTo(xL + u * span, yOf(baseAt(u, 0)));
    }
    for (let i = bandN; i >= 0; i--) {
      const u = i / bandN;
      ctx.lineTo(xL + u * span, yOf(baseAt(u, 0) + amt));
    }
    ctx.closePath();
    const band = cachedGrad(ctx, `pitchband|${laneTop}|${laneBot}|${dir}`, (c) => {
      const g = c.createLinearGradient(0, laneTop, 0, laneBot);
      g.addColorStop(0, hexA(dir > 0 ? C_UP : C_DN, 0.22));
      g.addColorStop(0.5, hexA(C, 0.07));
      g.addColorStop(1, hexA(dir > 0 ? C_DN : C_UP, 0.2));
      return g;
    });
    ctx.save();
    ctx.globalAlpha = 0.5 + strike * 0.3;
    ctx.fillStyle = band;
    ctx.fill();
    ctx.restore();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(envCol, 0.7);
    ctx.fillText(`ENV REACH ${amt > 0 ? "+" : ""}${Math.round(amt)} ST`, xL + 4, yOf(amt) + (amt > 0 ? -4 : 10));
  }

  const nSamp = Math.max(48, Math.min(900, Math.floor(span / 2)));

  // ── target line: where the glide is heading, before the env ──
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = hexA(C_GLIDE, 0.45);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i <= nSamp; i++) {
    const u = i / nSamp;
    const y = yOf(baseAt(u, 0));
    const x = xL + u * span;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // ── the trajectory ──
  if (p.mono) {
    const traj = () => {
      for (let i = 0; i <= nSamp; i++) {
        const u = i / nSamp;
        const y = yOf(baseAt(u, 0) + envAt(u));
        const x = xL + u * span;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    lit(ctx, () => {
      glowStroke(ctx, traj, C_GLOW, {
        width: 2.4,
        glow: 0.6 + glide * 0.5 + strike * 0.8,
        alpha: 0.85 + flash * 0.15,
      });
    });
  } else {
    // Poly: one stepped trajectory per stacked voice, no ramps.
    for (let v = 0; v < POLY_STACK.length; v++) {
      const off = POLY_STACK[v]!;
      ctx.beginPath();
      for (let i = 0; i <= nSamp; i++) {
        const u = i / nSamp;
        const y = yOf(baseAt(u, off) + envAt(u));
        const x = xL + u * span;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexA(v === 0 ? C_GLOW : C_HOT, v === 0 ? 0.8 : 0.4);
      ctx.lineWidth = v === 0 ? 2 : 1.3;
      ctx.stroke();
    }
  }

  // ── note heads + transition marks ──
  for (let i = 0; i < slots; i++) {
    const xStart = xL + i * slotW;
    const to = noteAt(i);
    const from = noteAt(i - 1);
    const yTo = yOf(to);
    // Note head where the target settles.
    const xHead = xStart + slotW * (gFrac > 0.005 ? gFrac : 0) + 3;
    ctx.fillStyle = hexA(C_GLOW, 0.85);
    ctx.beginPath();
    ctx.arc(Math.min(xHead, xStart + slotW - 4), yTo, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.fillText(`${to > 0 ? "+" : ""}${to}`, xStart + slotW * 0.5, laneBot - 4);

    // Onset bloom — the env firing.
    if (Math.abs(amt) > 0.5) {
      lit(ctx, () =>
        drawGlow(
          ctx,
          xStart + 2,
          yOf(from + amt),
          8 + Math.min(20, Math.abs(amt) * 0.5) + strike * 10,
          envCol,
          0.3 + strike * 0.4,
        ),
      );
    }

    // Transition mark: tie for legato, chevron for always-glide.
    if (i > 0) {
      const mY = laneBot + 9;
      ctx.strokeStyle = hexA(C_GLIDE, p.mono ? 0.7 : 0.28);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (p.glideMode === "legato") {
        ctx.moveTo(xStart - 7, mY);
        ctx.quadraticCurveTo(xStart, mY + 5, xStart + 7, mY);
      } else {
        ctx.moveTo(xStart - 6, mY + 3);
        ctx.lineTo(xStart, mY - 2);
        ctx.lineTo(xStart + 6, mY + 3);
      }
      ctx.stroke();
    }
  }

  // ── playhead sweeping the window ──
  const uP = ((t / (slots * SLOT_SEC)) % 1 + 1) % 1;
  const pxP = xL + uP * span;
  const pyP = yOf(baseAt(uP, 0) + envAt(uP));
  ctx.fillStyle = hexA(C_GLOW, 0.14);
  ctx.fillRect(pxP - 0.5, laneTop, 1, laneBot - laneTop);
  lit(ctx, () => drawGlow(ctx, pxP, pyP, 10 + strike * 10, C_GLOW, 0.75));
  ctx.fillStyle = hexA(C_GLOW, 0.95);
  ctx.beginPath();
  ctx.arc(pxP, pyP, 3 + strike * 2, 0, Math.PI * 2);
  ctx.fill();

  // ── telemetry ──
  const modeTag = String(p.glideMode ?? "legato").toUpperCase();
  const curveTag = String(p.glideCurve ?? "exp").toUpperCase();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_AMT, 0.72);
  ctx.fillText("PITCH ENV · MIDI", xL + 2, laneTop - 4);
  ctx.fillStyle = hexA(C_TIME, 0.65);
  ctx.fillText(
    `ENV ${p.time < 1 ? `${Math.round(p.time * 1000)}ms` : `${p.time.toFixed(2)}s`}`,
    xL + 104,
    laneTop - 4,
  );
  ctx.fillStyle = hexA(C_GLIDE, 0.72);
  ctx.fillText(`GLIDE · ${modeTag} · ${curveTag}`, xL + 186, laneTop - 4);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(p.mono ? C_GLIDE : C_MID, 0.75);
  ctx.fillText(p.mono ? `MONO · ${modeTag}` : "POLY STEPS", xR - 2, laneTop - 4);

  // Amount / time crosshair + the bipolar zero rail it swings around.
  ctx.strokeStyle = hexA(C_MID, 0.22);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0.5 * (Hh * 0.68));
  ctx.lineTo(W, 0.5 * (Hh * 0.68));
  ctx.stroke();
  const hx = timeN * W;
  const hy = (1 - amtN) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.3);
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
    Math.abs(amt) < 0.5 ? "0 st" : `${amt > 0 ? "+" : ""}${Math.round(amt)} st`,
    Math.abs(amt) > 0.5 ? envCol : C_MID,
    { glow: flash },
  );

  // ── glide rail ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railX, railY, railW, 7);
  ctx.strokeStyle = hexA(C_GLIDE, 0.22 + glide * 0.4);
  ctx.lineWidth = 1;
  ctx.strokeRect(railX + 0.5, railY + 0.5, railW - 1, 6);
  if (glide > 0.02) {
    const rg = cachedGrad(ctx, `glrail|${railX}|${railW}`, (c) => {
      const g = c.createLinearGradient(railX, 0, railX + railW, 0);
      g.addColorStop(0, hexA(C_GLIDE, 0.4));
      g.addColorStop(1, hexA(C_GLOW, 0.8));
      return g;
    });
    ctx.fillStyle = rg;
    ctx.fillRect(railX + 1, railY + 1, Math.max(2, (railW - 2) * glide), 5);
  }
  lit(ctx, () => drawGlow(ctx, railX + 1 + (railW - 2) * glide, railY + 3.5, 8 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLIDE, 0.8);
  ctx.fillText(p.mono ? `GLIDE · ${modeTag} · ${curveTag}` : `GLIDE · (arm mono) · ${curveTag}`, railX + 2, railY - 4);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_GLIDE, 0.62);
  ctx.fillText(`${Math.round(glide * 100)}`, railX + railW - 2, railY - 4);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "PITCH · GLIDE HORIZON",
    !isLive
      ? p.mono
        ? `MONO · ${modeTag} · IDLE`
        : "POLY · IDLE"
      : `ENV ${amt > 0 ? "+" : ""}${Math.round(amt)}st/${p.time < 1 ? `${Math.round(p.time * 1000)}ms` : `${p.time.toFixed(2)}s`}${glide > 0.02 ? ` · G${Math.round(glide * 100)} ${curveTag}` : ""}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function PitchStageViz() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount) ?? 0;
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime) ?? 0.2;
  const glide = useFireCommandStore((s) => s.patch.glide) ?? 0;
  const mono = useFireCommandStore((s) => s.patch.mono) ?? false;
  const glideMode = useFireCommandStore((s) => s.patch.glideMode) ?? "legato";
  const glideCurve = useFireCommandStore((s) => s.patch.glideCurve) ?? "exp";
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<PitchVizState>({ amt, time, glide, mono, glideMode, glideCurve, strikeAt: 0 });
  st.current = { amt, time, glide, mono, glideMode, glideCurve, strikeAt: st.current.strikeAt };

  const live = Math.abs(amt) > 0.5 || glide > 0.02;

  useEffect(() => {
    const key = motionHash(
      amt,
      time,
      glide,
      mono,
      MODES.indexOf(glideMode),
      CURVES.indexOf(glideCurve),
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [amt, time, glide, mono, glideMode, glideCurve]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      // Y bipolar: top = +48, mid = 0, bottom = -48
      const amtN = clamp(1 - y, 0, 1);
      const signed = Math.round(AMT_MIN + amtN * (AMT_MAX - AMT_MIN));
      setParam("pitchEnvAmount", signed);
      setParam("pitchEnvTime", Math.round(logLerp(x, TIME_MIN, TIME_MAX) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyGlide = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("glide", Math.round(x * 1000) / 1000);
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
        dragRef.current = "glide";
        wrap.setPointerCapture(e.pointerId);
        applyGlide(e.clientX);
        return;
      }
      dragRef.current = "xy";
      st.current.strikeAt = performance.now();
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyGlide, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "glide") applyGlide(e.clientX);
    },
    [applyXy, applyGlide],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const a = st.current.amt;
    if (Math.abs(a) < 0.5) setParam("pitchEnvAmount", 12);
    else setParam("pitchEnvAmount", -a);
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
        paintPitch(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: Math.abs(st.current.amt ?? 0) > 0.01 || (st.current.glide ?? 0) > 0.01,
        dragging: !!dragRef.current,
        // The strike bloom is a timestamp decay, so it has to hold the pump open.
        particles: performance.now() - st.current.strikeAt < 900 ? 1 : 0,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.amt,
          st.current.time,
          st.current.glide,
          st.current.mono,
          MODES.indexOf(st.current.glideMode),
          CURVES.indexOf(st.current.glideCurve),
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
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Env Time ↔ / Amount ↕ · Bottom: Glide · Double-click: flip polarity · Click: strike"
      role="img"
      aria-label="Pitch glide horizon"
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
        Glide Horizon
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(mono ? C_GLIDE : C_MID, 0.78) }}
      >
        {mono ? `${glideMode} · ${glideCurve}` : "POLY"}
      </div>
    </div>
  );
}

/** Alias for older imports */
export { PitchStageViz as PitchGlideStageViz };
