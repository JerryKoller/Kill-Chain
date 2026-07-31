/**
 * Delay — Ping Cascade stage visualizer.
 *
 * IDIOM: discrete taps. Stages are a ~10:1 letterbox, so the width is a real
 * time ruler and the repeats are what they actually are — separate impulses
 * struck at the delay interval, each one a fixed fraction of the last. This is
 * deliberately *not* a smooth decay envelope; that shape belongs to Reverb.
 * Here you count the spikes, read the gap between them, and watch a ping travel
 * the line at the delay rate.
 *
 * Ping-pong puts alternate taps below the centre line. The cascade mode changes
 * the window, the spacing law and the pattern: `slap` is two tight taps, `dub`
 * darkens and drags each repeat, `bounce` alternates hard, `long` stretches the
 * ruler out, `infinite` stops decaying and fills the width.
 *
 * Time · Feedback · Mix · Cascade (Signal Path FX · FC.delay).
 * Drag: Time ↔ / Feedback ↕. Bottom: Mix. Double-click: cycle mix 0→50→100.
 * R delay line runs 1.5× L (matches DSP ping-pong).
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { DelayCascadeMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
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
const C = FC.delay;
const C_DEEP = bandShade(FC.fx, 0.36);
const C_MID = bandShade(FC.fx, 0.52);
const C_HOT = bandShade(FC.fx, 0.7);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_TIME = bandShade(FC.fx, 0.58);
const C_FBK = bandShade(FC.fx, 0.72);
const C_MIX = bandShade(FC.fx, 0.86);
const C_L = bandShade(FC.fx, 0.6);
const C_R = bandShade(FC.fx, 0.8);

const TIME_MIN = 0.01;
const TIME_MAX = 1.5;
const FBK_MAX = 0.92;
const MIX_CYCLE = [0, 0.5, 1] as const;
const MODE_ORDER: DelayCascadeMode[] = ["slap", "echo", "dub", "bounce", "long", "infinite"];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

function fmtTime(v: number) {
  return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
}

/** Seconds the ruler spans — the mode decides how far out you can see. */
function windowFor(mode: DelayCascadeMode): number {
  if (mode === "slap") return 0.45;
  if (mode === "long" || mode === "infinite") return 5;
  if (mode === "dub") return 3;
  return 2.2;
}

type DragMode = "xy" | "mix" | null;

export type DelayVizState = {
  time: number;
  fbk: number;
  mix: number;
  cascade: DelayCascadeMode;
};

/** Paint the cascade. Exported and pure — no React, no store. */
export function paintDelay(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: DelayVizState,
  now: number,
  flash: number,
): void {
  const timeN = logNorm(p.time, TIME_MIN, TIME_MAX);
  const fbkN = p.fbk / FBK_MAX;
  const isLive = p.mix > 0.02;
  const mode = p.cascade ?? "echo";
  const infinite = mode === "infinite";
  const energy = 0.1 + p.mix * 0.4 + fbkN * 0.22 + flash * 0.22;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // ── geometry: the width is time ──
  const padL = 26;
  const padR = 20;
  const spanW = Math.max(120, W - padL - padR);
  const top = 30;
  const bot = 116;
  const midY = (top + bot) * 0.5;
  const spike = (bot - top) * 0.5 - 4;
  const rulerY = 124;

  const win = windowFor(mode);
  const pxPerSec = spanW / win;
  const gap = clamp(p.time * pxPerSec, 20, spanW * 0.46);
  // Dub drags each repeat a little further out than the last.
  const drag = mode === "dub" ? 0.05 : 0;
  const rRatio = 1.5;

  const maxTaps = mode === "slap" ? 2 : Math.min(48, Math.floor(spanW / Math.max(12, gap)) + 1);
  const decay = infinite ? 0.985 : clamp(p.fbk, 0.02, FBK_MAX);
  // Ping-pong lanes: bounce alternates hard, echo/dub run a second R line at
  // 1.5×, slap and long stay on the top lane.
  const pingPong = mode === "bounce" || infinite;
  const twoLine = mode === "echo" || mode === "dub";

  // ── centre line + time ruler ──
  ctx.fillStyle = hexA(C_MID, 0.22);
  ctx.fillRect(padL, midY, spanW, 1);
  ctx.fillStyle = hexA(C_MID, 0.16);
  ctx.fillRect(padL, rulerY, spanW, 1);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  {
    // A tick every 100 ms up to 1 s, then every 500 ms.
    const step = win <= 0.6 ? 0.05 : win <= 2.5 ? 0.25 : 0.5;
    for (let t = 0; t <= win + 1e-6; t += step) {
      const x = padL + t * pxPerSec;
      if (x > padL + spanW) break;
      ctx.fillStyle = hexA(C_MID, 0.18);
      ctx.fillRect(x, rulerY, 1, 4);
      ctx.fillStyle = hexA(C_MID, 0.4);
      ctx.fillText(t === 0 ? "0" : fmtTime(t), x, rulerY + 12);
    }
  }

  // ── feedback ladder: the decay law, stated rather than drawn as a curve ──
  // One mark per tap level, so you can read what each repeat is worth without
  // an envelope being drawn through the spikes.
  ctx.textAlign = "right";
  for (let k = 0; k < 4; k++) {
    const a = Math.pow(decay, k);
    if (a < 0.04) break;
    const y = midY - spike * a;
    ctx.fillStyle = hexA(C_FBK, 0.14);
    ctx.fillRect(padL - 8, y, 6, 1);
    ctx.fillStyle = hexA(C_FBK, 0.4);
    ctx.fillText(`${Math.round(a * 100)}`, padL - 10, y + 3);
  }

  // ── the taps ──
  // A ping departs the source and advances one gap per delay period; whichever
  // tap it is passing flares. That is the only motion here — the taps themselves
  // are fixed marks on a time ruler.
  const travel = isLive ? ((now / 1000) / Math.max(0.02, p.time)) * gap : 0;
  const lineLen = gap * Math.max(1, maxTaps);
  const pingX = padL + (travel % lineLen);

  const drawTap = (x: number, up: boolean, amp: number, color: string, k: number) => {
    if (x > padL + spanW || amp < 0.02) return;
    const flare = isLive ? Math.exp(-(((x - pingX) / 26) ** 2)) : 0;
    const h = spike * amp * (0.3 + p.mix * 0.7);
    const y = up ? midY - h : midY + h;
    const a = (0.35 + p.mix * 0.55) * (0.45 + amp * 0.55) + flare * 0.4;

    // Stem: a single hard impulse, not a filled area.
    ctx.fillStyle = hexA(color, a);
    ctx.fillRect(x - 0.9, Math.min(midY, y), 1.8, Math.abs(h));
    // Cap.
    ctx.fillStyle = hexA(C_GLOW, Math.min(1, a + 0.2 + flare * 0.5));
    ctx.fillRect(x - 2.4, y - (up ? 2 : 0), 4.8, 2);
    if (amp > 0.05) {
      lit(ctx, () => drawGlow(ctx, x, y, 6 + amp * 12 + flare * 14, C_GLOW, (0.14 + p.mix * 0.32) * amp + flare * 0.45));
    }
    // Drop a guide down to the shared ruler so each repeat can be read off the
    // absolute time axis without a label stack over the spikes.
    if (k > 0) {
      ctx.fillStyle = hexA(color, 0.14 + amp * 0.2);
      ctx.fillRect(x, bot + 2, 1, rulerY - bot - 2);
      ctx.fillStyle = hexA(color, 0.4 + amp * 0.35);
      ctx.fillRect(x - 1, rulerY - 3, 3, 3);
    }
  };

  // Source: the dry hit everything is measured from.
  ctx.fillStyle = hexA(C_GLOW, 0.9);
  ctx.fillRect(padL - 1, midY - spike, 2, spike * 2);
  lit(ctx, () => drawGlow(ctx, padL, midY, 14 + p.mix * 10 + flash * 8, C_GLOW, 0.35 + p.mix * 0.4));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLOW, 0.6);
  ctx.fillText("IN", padL + 4, midY - spike - 3);

  for (let k = 1; k <= maxTaps; k++) {
    // The first repeat always lands at full level; feedback only governs what
    // survives after it, so tap k is worth fbk^(k−1).
    const amp = Math.pow(decay, k - 1);
    if (amp < 0.025) break;
    const x = padL + gap * k * (1 + drag * (k - 1));
    const up = pingPong ? k % 2 === 1 : true;
    drawTap(x, up, amp, up ? C_L : C_R, k);
    if (twoLine) {
      const xr = padL + gap * rRatio * k * (1 + drag * (k - 1));
      drawTap(xr, false, amp * 0.82, C_R, k);
    }
  }

  // The ping itself, riding the line.
  if (isLive) {
    lit(ctx, () => drawGlow(ctx, pingX, midY, 10 + p.mix * 10, C_HOT, 0.3 + p.mix * 0.4));
  }

  // Lane labels.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_L, 0.6);
  ctx.fillText("L", 6, midY - 6);
  ctx.fillStyle = hexA(C_R, 0.6);
  ctx.fillText("R", 6, midY + 12);

  // ── telemetry row ──
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so it can't collide at any panel width.
  let telX = VIZ_TOP_LABEL_X;
  const telRight = W * 0.5 - 52;
  const tel = (text: string, color: string, alpha: number) => {
    const w = ctx.measureText(text).width;
    if (telX + w > telRight) return;
    ctx.fillStyle = hexA(color, alpha);
    ctx.fillText(text, telX, VIZ_TOP_LABEL_Y);
    telX += w + 14;
  };
  tel(mode.toUpperCase(), C_TIME, 0.72);
  tel(`TIME ${fmtTime(p.time)}`, C_TIME, 0.66);
  tel(infinite ? "FB HOLD" : `FB ${Math.round(p.fbk * 100)}`, C_FBK, 0.66);
  tel(twoLine ? `R ${fmtTime(p.time * rRatio)}` : pingPong ? "PING-PONG" : "MONO TAPS", C_R, 0.62);
  tel(`WIN ${fmtTime(win)}`, C_DEEP, 0.7);

  // Time / Feedback crosshair (the drag target).
  const hx = timeN * W;
  const hy = (1 - fbkN) * (Hh * 0.68);
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
    !isLive ? "IDLE" : infinite ? "INFINITE" : mode.toUpperCase(),
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
    "DLY · PING CASCADE",
    !isLive ? "IDLE" : `${fmtTime(p.time)} · FB${Math.round(p.fbk * 100)} · ${mode}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function DelayStageViz() {
  const time = useFireCommandStore((s) => s.patch.delayTime) ?? 0.28;
  const fbk = useFireCommandStore((s) => s.patch.delayFeedback) ?? 0.3;
  const mix = useFireCommandStore((s) => s.patch.delayMix) ?? 0;
  const cascade = (useFireCommandStore((s) => s.patch.delayCascadeMode) ?? "echo") as DelayCascadeMode;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<DelayVizState>({ time, fbk, mix, cascade });
  st.current = { time, fbk, mix, cascade };

  const live = mix > 0.02;

  useEffect(() => {
    const key = motionHash(time, fbk, mix, MODE_ORDER.indexOf(cascade));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [time, fbk, mix, cascade]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("delayTime", Math.round(logLerp(x, TIME_MIN, TIME_MAX) * 1000) / 1000);
      setParam("delayFeedback", Math.round((1 - y) * FBK_MAX * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("delayMix", Math.round(x * 1000) / 1000);
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
    setParam("delayMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
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
        paintDelay(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.time,
          st.current.fbk,
          st.current.mix,
          MODE_ORDER.indexOf(st.current.cascade),
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
      title="Drag taps / stage: Time ↔ / Feedback ↕ · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Delay ping cascade"
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
        Ping Cascade
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? fmtTime(time) : "IDLE"}
      </div>
    </div>
  );
}
