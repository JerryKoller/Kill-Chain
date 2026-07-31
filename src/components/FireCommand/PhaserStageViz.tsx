/**
 * Phaser — Sweep Veil stage visualizer.
 *
 * IDIOM: notches carved out of a spectral floor. Stages are a ~10:1 letterbox,
 * so the width is a log frequency axis (100 Hz → 8 kHz) and the module's whole
 * identity — a comb of notches sliding across that axis — is exactly a wide,
 * short gesture. Stage count sets how many notches; the LFO drags them left and
 * right; feedback narrows and deepens them and raises resonant shoulders beside
 * each one; opposed/quadrature stereo splits the comb into two offset sets that
 * scissor past each other.
 *
 * Notch placement mirrors the DSP: allpass `i` sits at `center × (0.7 + 0.18i)`,
 * and the LFO scales that by depth × stage count.
 *
 * Rate · Depth · Mix · Stages · Center · Feedback · Stereo (Signal Path FX).
 * Drag: Rate ↔ / Depth ↕. Bottom: Mix. Double-click: cycle mix 0→50→100.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { PhaserStereoMode } from "@/audio/dsp/FireCommandSynth";
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
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 176;
const C = FC.phaser;
const C_DEEP = bandShade(FC.fx, 0.28);
const C_MID = bandShade(FC.fx, 0.48);
const C_HOT = bandShade(FC.fx, 0.65);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_RATE = bandShade(FC.fx, 0.52);
const C_DEPTH = bandShade(FC.fx, 0.68);
const C_MIX = bandShade(FC.fx, 0.82);
const C_R = bandShade(FC.fx, 0.76);

const RATE_MIN = 0.02;
const RATE_MAX = 12;
const MIX_CYCLE = [0, 0.5, 1] as const;
const STEREO_ORDER: PhaserStereoMode[] = ["linked", "opposed", "quadrature"];

/** Frequency ruler stops — enough to read the axis without crowding it. */
const F_TICKS: Array<[string, number]> = [
  ["100", 100], ["200", 200], ["500", 500], ["1k", 1000],
  ["2k", 2000], ["5k", 5000], ["8k", 8000],
];

const NS_MAX = 360;
const RESP_A = new Float32Array(NS_MAX + 1);
const RESP_B = new Float32Array(NS_MAX + 1);
const NOTCH_A = new Float32Array(12);
const NOTCH_B = new Float32Array(12);

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Position on the drawn frequency axis, 0..1. */
function uOf(f: number): number {
  return Math.log(clamp(f, 100, 8000) / 100) / Math.log(80);
}

type DragMode = "xy" | "mix" | null;

export type PhaserVizState = {
  rate: number;
  depth: number;
  mix: number;
  stages: number;
  center: number;
  feedback: number;
  stereo: PhaserStereoMode;
};

/** Paint the veil. Exported and pure — no React, no store. */
export function paintPhaser(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: PhaserVizState,
  now: number,
  flash: number,
): void {
  const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
  const isLive = p.mix > 0.02;
  const notches = clamp(Math.round(p.stages ?? 4), 2, 12);
  const fbk = clamp(p.feedback ?? 0.35, 0, 1);
  const stereo = p.stereo ?? "linked";
  const split = stereo !== "linked";
  const centerHz = clamp(p.center ?? 800, 100, 8000);
  const energy = 0.1 + p.mix * 0.42 + p.depth * 0.18 + flash * 0.22;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.62 });

  // ── geometry ──
  const padL = 26;
  const padR = 20;
  const spanW = Math.max(80, W - padL - padR);
  const top = 34;
  const floorY = 112;
  const lfoY0 = 128;
  const lfoH = 9;
  const bodyH = floorY - top;
  const xOf = (u: number) => padL + u * spanW;

  // LFO phase per channel. Opposed pushes R half a cycle out; quadrature a
  // quarter — which is what makes the two combs scissor rather than track.
  const lfoPhase = (now / 1000) * p.rate * Math.PI * 2;
  const offB = stereo === "opposed" ? Math.PI : stereo === "quadrature" ? Math.PI * 0.5 : 0;
  const lfoA = Math.sin(lfoPhase);
  const lfoB = Math.sin(lfoPhase + offB);

  // Sweep multiplier on each allpass frequency — mirrors the DSP's depth gain.
  const stageScale = clamp(notches / 4, 0.5, 3);
  const swing = 0.7 * p.depth * Math.min(1.6, stageScale);

  const fillNotches = (out: Float32Array, lfo: number) => {
    const mul = Math.pow(2, lfo * swing);
    for (let n = 0; n < notches; n++) {
      out[n] = uOf(centerHz * (0.7 + n * 0.18) * mul);
    }
  };
  fillNotches(NOTCH_A, lfoA);
  if (split) fillNotches(NOTCH_B, lfoB);

  // Feedback narrows the notch and pushes resonant shoulders up beside it.
  const sharp = 260 + fbk * 900 + notches * 14;
  const dip = (0.3 + p.depth * 0.42) * (0.32 + p.mix * 0.68);
  const shoulder = fbk * dip * 0.85;
  const shoulderU = 0.055 / Math.sqrt(1 + fbk * 3);

  const NS = clamp(Math.round(spanW / 6), 80, NS_MAX);
  const buildResponse = (out: Float32Array, notch: Float32Array, gain: number) => {
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      // A gently tilted floor so the field isn't a flat slab.
      let y = 0.62 + 0.055 * Math.sin(u * 5.4 + now / 1400) - u * 0.06;
      for (let n = 0; n < notches; n++) {
        const d = u - notch[n]!;
        y -= dip * Math.exp(-d * d * sharp);
        if (shoulder > 0.004) {
          const dl = d + shoulderU;
          const dr = d - shoulderU;
          y += shoulder * (Math.exp(-dl * dl * sharp * 2.2) + Math.exp(-dr * dr * sharp * 2.2));
        }
      }
      out[i] = clamp(y * gain, 0.03, 1.08);
    }
  };
  buildResponse(RESP_A, NOTCH_A, 1);
  if (split) buildResponse(RESP_B, NOTCH_B, 1);

  const yOf = (v: number) => floorY - v * bodyH * 0.9;

  // ── frequency ruler ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let i = 0; i < F_TICKS.length; i++) {
    const [lab, f] = F_TICKS[i]!;
    const x = xOf(uOf(f));
    ctx.fillStyle = hexA(C_MID, 0.16);
    ctx.fillRect(x, floorY, 1, 4);
    ctx.fillStyle = hexA(C_MID, 0.45);
    ctx.fillText(lab, x, floorY + 13);
  }
  ctx.fillStyle = hexA(C_MID, 0.22);
  ctx.fillRect(padL, floorY, spanW, 1);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.4);
  ctx.fillText("Hz", padL - 4, floorY + 3);

  // Dry reference: the flat spectrum the wet is being carved out of.
  if (p.mix < 0.98) {
    ctx.strokeStyle = hexA(C_MID, 0.1 + (1 - p.mix) * 0.16);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, yOf(0.62));
    ctx.lineTo(padL + spanW, yOf(0.62 - 0.06));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── the carved floor ──
  const veil = cachedGrad(ctx, `veil|${top}|${floorY}`, (c) => {
    const g = c.createLinearGradient(0, top, 0, floorY);
    g.addColorStop(0, hexA(C_GLOW, 0.42));
    g.addColorStop(0.4, hexA(C_HOT, 0.2));
    g.addColorStop(1, hexA(C_DEEP, 0.06));
    return g;
  });

  const drawComb = (resp: Float32Array, color: string, alpha: number, glow: number) => {
    ctx.beginPath();
    ctx.moveTo(padL, floorY);
    for (let i = 0; i <= NS; i++) ctx.lineTo(xOf(i / NS), yOf(resp[i]!));
    ctx.lineTo(padL + spanW, floorY);
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = veil;
    ctx.fill();
    ctx.restore();
    glowStroke(
      ctx,
      () => {
        for (let i = 0; i <= NS; i++) {
          const x = xOf(i / NS);
          const y = yOf(resp[i]!);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      },
      color,
      { width: 2, glow, alpha: 0.6 + p.mix * 0.35 },
    );
  };

  if (split) {
    drawComb(RESP_B, C_R, 0.3 + p.mix * 0.3, 0.5 + p.mix * 0.6);
    drawComb(RESP_A, C_GLOW, 0.34 + p.mix * 0.34, 0.6 + p.mix * 0.8);
  } else {
    drawComb(RESP_A, C_GLOW, 0.42 + p.mix * 0.4, 0.7 + p.mix * 0.9);
  }

  // Notch markers: a caret at each carved slot plus a dim beam down the axis.
  const markComb = (notch: Float32Array, color: string, up: boolean) => {
    for (let n = 0; n < notches; n++) {
      const u = notch[n]!;
      if (u < -0.02 || u > 1.02) continue;
      const x = xOf(u);
      ctx.strokeStyle = hexA(color, 0.12 + p.mix * 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top + 2);
      ctx.lineTo(x, floorY);
      ctx.stroke();
      const cy = up ? top + 2 : floorY - 3;
      const dir = up ? 1 : -1;
      ctx.strokeStyle = hexA(color, 0.5 + p.mix * 0.45);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - 4, cy);
      ctx.lineTo(x, cy + 5 * dir);
      ctx.lineTo(x + 4, cy);
      ctx.stroke();
      if (isLive) {
        lit(ctx, () => drawGlow(ctx, x, yOf(0.62 - dip), 7 + p.depth * 12, color, 0.14 + p.mix * 0.3));
      }
    }
  };
  if (split) markComb(NOTCH_B, C_R, false);
  markComb(NOTCH_A, C_GLOW, true);

  // Centre frequency: the anchor the whole comb is built from.
  const cx = xOf(uOf(centerHz));
  ctx.strokeStyle = hexA(C_RATE, 0.38);
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, floorY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_RATE, 0.72);
  ctx.fillText(centerHz >= 1000 ? `${(centerHz / 1000).toFixed(1)}k` : `${Math.round(centerHz)}`, cx, top - 3);

  // ── LFO strip ──
  // A bare trace rather than a boxed lane: at this panel height a framed lane
  // costs more vertical budget than the frequency ruler can spare.
  const lfoMid = lfoY0 + lfoH * 0.5;
  ctx.fillStyle = hexA(C_MID, 0.12);
  ctx.fillRect(padL, lfoMid, spanW, 1);
  const lfoAmp = lfoH * 0.5 * (0.35 + p.depth * 0.65);
  const traceLfo = (phaseOff: number, color: string, alpha: number) => {
    ctx.strokeStyle = hexA(color, alpha);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const v = Math.sin((u * 4 + (now / 1000) * p.rate) * Math.PI * 2 + phaseOff);
      const x = padL + u * spanW;
      if (i === 0) ctx.moveTo(x, lfoMid - v * lfoAmp);
      else ctx.lineTo(x, lfoMid - v * lfoAmp);
    }
    ctx.stroke();
  };
  if (split) traceLfo(offB, C_R, 0.4 + p.mix * 0.25);
  traceLfo(0, C_GLOW, 0.7 + p.mix * 0.25);
  lit(ctx, () => drawGlow(ctx, padL + spanW, lfoMid - lfoA * lfoAmp, 6, C_GLOW, 0.7));

  // Telemetry packs left-to-right from the reserved top strip and stops short of
  // the centred mode pill, so it can't collide at any panel width.
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
  tel(`LFO ${p.rate < 1 ? p.rate.toFixed(2) : p.rate.toFixed(1)}Hz · ${notches}stg`, C_RATE, 0.75);
  tel(`DEPTH ${Math.round(p.depth * 100)}`, C_DEPTH, 0.7);
  tel(`FB ${Math.round(fbk * 100)}`, C_HOT, 0.7);
  tel(stereo.toUpperCase(), split ? C_R : C_MID, 0.7);

  // Rate / Depth crosshair (the drag target).
  const hx = rateN * W;
  const hy = (1 - p.depth) * (Hh * 0.58);
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
    !isLive ? "BYPASS" : p.rate < 0.2 ? "SLOW" : p.rate > 4 ? "JET" : "SWEEP",
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
    "PHASE · SWEEP VEIL",
    !isLive
      ? "BYPASS"
      : `${notches}n · ${p.rate < 1 ? p.rate.toFixed(2) : p.rate.toFixed(1)}Hz · D${Math.round(p.depth * 100)}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function PhaserStageViz() {
  const rate = useFireCommandStore((s) => s.patch.phaserRate) ?? 0.4;
  const depth = useFireCommandStore((s) => s.patch.phaserDepth) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.phaserMix) ?? 0;
  const stages = useFireCommandStore((s) => s.patch.phaserStages) ?? 4;
  const center = useFireCommandStore((s) => s.patch.phaserCenter) ?? 800;
  const feedback = useFireCommandStore((s) => s.patch.phaserFeedback) ?? 0.35;
  const stereo = (useFireCommandStore((s) => s.patch.phaserStereo) ?? "linked") as PhaserStereoMode;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<PhaserVizState>({ rate, depth, mix, stages, center, feedback, stereo });
  st.current = { rate, depth, mix, stages, center, feedback, stereo };

  const live = mix > 0.02;

  useEffect(() => {
    const key = motionHash(rate, depth, mix, stages, center, feedback, STEREO_ORDER.indexOf(stereo));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [rate, depth, mix, stages, center, feedback, stereo]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("phaserRate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("phaserDepth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("phaserMix", Math.round(x * 1000) / 1000);
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
    setParam("phaserMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
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
        paintPhaser(ctx, W, Hh, st.current, now, flashRef.current);
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
          st.current.stages,
          st.current.center,
          st.current.feedback,
          STEREO_ORDER.indexOf(st.current.stereo),
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
      aria-label="Phaser sweep veil"
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
        Sweep Veil
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
