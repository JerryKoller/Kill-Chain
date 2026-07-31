/**
 * UNI — Voice Choir stage visualizer.
 *
 * IDIOM: the voice fan. Every unison partial gets its own trace, and all of them
 * leave the left edge in perfect agreement. Detune makes them diverge as they
 * travel right — a literal fan opening across the letterbox — stereo width pulls
 * them apart vertically between the L and R rails, and the phase mode decides how
 * they start out: locked stacks them, even staggers them, random scatters them,
 * alternating flips every other polarity.
 *
 * Voices · Detune · Width · Drift · Phase (Signal Path Tone · FC.unison).
 * Drag: Width ↔ / Detune ↕. Bottom rail: voice count. Double-click: mono.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { UnisonPhaseMode } from "@/audio/dsp/toneDifferentiation";
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
} from "./stageVizKit";

const H = 168;
const C = FC.unison;
const C_DEEP = bandShade(FC.tone, 0.12);
const C_MID = bandShade(FC.tone, 0.35);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.82);
const C_DET = bandShade(FC.tone, 0.42);
const C_WID = bandShade(FC.tone, 0.68);
const C_DRIFT = bandShade(FC.tone, 0.75);

const MAX_STEPS = 1024;
/** Hull scratch — the fan's silhouette, rebuilt each paint without garbage. */
const hullTop = new Float32Array(MAX_STEPS);
const hullBot = new Float32Array(MAX_STEPS);

const PHASE_LABEL: Record<UnisonPhaseMode, string> = {
  locked: "PHASE LOCKED",
  random: "PHASE RANDOM",
  even: "PHASE EVEN",
  alternating: "PHASE ALT",
};
/** Phase mode as a number, so it can ride in the allocation-free motion hash. */
const PHASE_IX: Record<UnisonPhaseMode, number> = { locked: 0, random: 1, even: 2, alternating: 3 };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic per-voice offsets — the same choir every frame. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export type UnisonState = {
  unison: number;
  detune: number;
  width: number;
  drift: number;
  phase: UnisonPhaseMode;
};

export function paintUnison(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: UnisonState,
  now: number,
  flash: number,
): void {
  const n = Math.max(1, Math.min(7, Math.round(p.unison)));
  const det = clamp(p.detune / 50, 0, 1);
  const wid = clamp(p.width, 0, 1);
  const dri = clamp(p.drift, 0, 1);
  const mode = p.phase ?? "locked";
  const mono = n === 1 && det < 0.04;
  const energy = mono ? 0.2 : 0.32 + det * 0.34 + wid * 0.22 + (n / 7) * 0.2;
  const eBucket = (energy * 12) | 0;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // ── geometry: voices leave the left edge together and fan out rightward ──
  const padL = 30;
  const padR = 26;
  const span = Math.max(60, W - padL - padR);
  const cy = Hh * 0.44;
  const railY = Hh - 28;
  // The rails frame the choir: width pushes the seats apart and the rails out.
  const railTop = Hh * 0.15 - wid * 6;
  const railBot = Hh * 0.77 + wid * 6;
  const spreadY = 6 + wid * 24;
  const cycles = 3;
  // Seven voices × a glow pass each is the most expensive thing in the panel,
  // so the fan is walked at a stride that still resolves three cycles cleanly.
  const step = Math.max(3, span / 300);
  const steps = Math.min(MAX_STEPS - 1, Math.floor(span / step));
  const base = now * 0.0016;
  const breath = 0.94 + 0.06 * Math.sin(now / 640);
  const amp = (Hh * 0.1) * (0.6 + energy * 0.5) * breath;

  /** Voice index → normalized seat, −1 = far left channel, +1 = far right. */
  const seatOf = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * 2 - 1);
  /** Starting phase per voice — this is what the phase mode actually changes. */
  const phase0 = (i: number, u: number) => {
    if (mode === "even") return u * 0.55;
    if (mode === "random") return (hash01(i * 3.77 + 0.5) - 0.5) * 1.5;
    if (mode === "alternating") return i % 2 === 1 ? Math.PI : 0;
    return 0;
  };
  const polarity = (i: number) => (mode === "alternating" && i % 2 === 1 ? -1 : 1);
  /** Voice trace at a fraction of the width — divergence grows with distance. */
  const voiceY = (i: number, t: number) => {
    const u = seatOf(i);
    const wobble = dri * Math.sin(now * 0.0022 + i * 1.7) * 0.5;
    const fan = u * (det * 5.5 + wobble) * t;
    const ph = base + phase0(i, u) + fan;
    return cy + u * spreadY + Math.sin(t * cycles * Math.PI * 2 + ph) * amp * polarity(i) * (0.72 + (1 - Math.abs(u)) * 0.28);
  };

  // L / R rails — stereo is the vertical axis in this panel.
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = hexA(C_WID, 0.14 + wid * 0.32);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(padL - 12, railTop);
  ctx.lineTo(padL + span + 12, railTop);
  ctx.moveTo(padL - 12, railBot);
  ctx.lineTo(padL + span + 12, railBot);
  ctx.stroke();
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_WID, 0.6);
  ctx.fillText("L", 8, railTop + 11);
  ctx.textAlign = "right";
  ctx.fillText("R", W - 8, railBot - 5);

  // ── the fan's silhouette ──
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = voiceY(i, t);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    hullTop[s] = lo;
    hullBot[s] = hi;
  }
  ctx.beginPath();
  for (let s = 0; s <= steps; s++) {
    const x = padL + (s / steps) * span;
    if (s === 0) ctx.moveTo(x, hullTop[s]!);
    else ctx.lineTo(x, hullTop[s]!);
  }
  for (let s = steps; s >= 0; s--) ctx.lineTo(padL + (s / steps) * span, hullBot[s]!);
  ctx.closePath();
  ctx.fillStyle = cachedGrad(ctx, `uniHull|${Hh}|${eBucket}`, (c) => {
    const g = c.createLinearGradient(0, Hh * 0.12, 0, Hh * 0.8);
    g.addColorStop(0, hexA(C_WID, 0.1 + energy * 0.14));
    g.addColorStop(0.5, hexA(C_HOT, 0.1 + energy * 0.12));
    g.addColorStop(1, hexA(C_DEEP, 0.05));
    return g;
  });
  ctx.fill();

  // ── one trace per voice ──
  for (let i = 0; i < n; i++) {
    const u = seatOf(i);
    const centre = 1 - Math.abs(u);
    const col = Math.abs(u) > 0.4 ? C_DET : C_HOT;
    const path = () => {
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = padL + t * span;
        const y = voiceY(i, t);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    // Only the anchor voices earn the glow pass; the rest read as thin lines.
    if (n <= 2 || centre > 0.6) {
      glowStroke(ctx, path, C_GLOW, {
        width: n === 1 ? 3 : 1.5 + centre * 1.1,
        glow: 0.35 + centre * 0.4 + energy * 0.4,
        alpha: 0.45 + centre * 0.3 + energy * 0.25,
      });
    } else {
      ctx.strokeStyle = hexA(col, 0.35 + centre * 0.25 + energy * 0.25);
      ctx.lineWidth = 1.4 + centre * 0.8;
      ctx.beginPath();
      path();
      ctx.stroke();
    }

    // Seat marker at the left edge: where every voice still agrees.
    const y0 = voiceY(i, 0);
    lit(ctx, () => drawGlow(ctx, padL, y0, 8 + centre * 6, C_GLOW, 0.5 + centre * 0.3));
    ctx.fillStyle = hexA(C_GLOW, 0.9);
    ctx.beginPath();
    ctx.arc(padL, y0, 2.4 + flash * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Pan connector: the seat's landing point on its stereo rail.
    const yEnd = voiceY(i, 1);
    const panX = padL + span * ((u * wid + 1) / 2);
    const targetY = u < 0 ? railTop : u > 0 ? railBot : cy;
    ctx.strokeStyle = hexA(C_WID, 0.1 + wid * 0.24);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + span, yEnd);
    ctx.lineTo(panX, targetY);
    ctx.stroke();
    ctx.fillStyle = hexA(C_WID, 0.35 + wid * 0.45);
    ctx.fillRect(panX - 2, targetY - 2, 4, 4);
  }

  // Drift: deterministic shimmer riding the outer voices.
  if (dri > 0.03 || det > 0.2) {
    const intensity = clamp(dri + det * 0.4, 0, 1);
    lit(ctx, () => {
      const m = 5 + Math.round(intensity * 9);
      for (let k = 0; k < m; k++) {
        const i = Math.floor(hash01(k * 5.11) * n);
        const t = ((now * 0.00035 * (0.5 + hash01(k * 2.13)) + hash01(k * 8.7)) % 1 + 1) % 1;
        drawGlow(ctx, padL + t * span, voiceY(i, t), 5 + intensity * 7, C_DRIFT, 0.15 + intensity * 0.3);
      }
    });
  }

  // Detune aperture caption — the fan's opening angle, in cents.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_DET, 0.55 + det * 0.35);
  ctx.fillText(`${Math.round(p.detune)}¢ SPREAD`, padL + span, Math.min(Hh - 36, hullBot[steps]! + 12));

  // ── voice count rail (the tap zone) ──
  for (let v = 1; v <= 7; v++) {
    const x0 = padL + ((v - 1) / 7) * span + 3;
    const x1 = padL + (v / 7) * span - 3;
    const on = n === v;
    ctx.fillStyle = on ? hexA(C_HOT, 0.36 + energy * 0.2) : "rgba(255,255,255,0.04)";
    ctx.fillRect(x0, railY, x1 - x0, 8);
    if (on) {
      ctx.strokeStyle = hexA(C_GLOW, 0.75);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, railY + 0.5, x1 - x0 - 1, 7);
    }
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = on ? hexA(C_GLOW, 0.95) : hexA(C_MID, 0.4);
    ctx.fillText(`${v}V`, (x0 + x1) / 2, railY + 6.5);
  }

  // Crosshair — the width / detune pad read-out.
  const hx = wid * W;
  const hy = (1 - det) * (Hh * 0.75);
  ctx.strokeStyle = hexA(C_GLOW, mono ? 0.12 : 0.32 + flash * 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, PHASE_LABEL[mode], C_GLOW, { glow: flash });

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  const bits = [`${Math.round(p.detune)}¢`, `W${Math.round(wid * 100)}`];
  if (dri > 0.04) bits.push(`DR${Math.round(dri * 100)}`);
  footer(
    ctx,
    W,
    Hh,
    `UNI · ${n}V CHOIR`,
    mono ? "MONO · tap rail for voices" : bits.join(" · "),
    C_GLOW,
    mono ? C_MID : C_HOT,
  );
}

export function UnisonStageViz() {
  const unison = useFireCommandStore((s) => s.patch.unison) ?? 1;
  const detune = useFireCommandStore((s) => s.patch.unisonDetune) ?? 0;
  const width = useFireCommandStore((s) => s.patch.unisonWidth) ?? 0.5;
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const phase = useFireCommandStore((s) => s.patch.unisonPhase) ?? "locked";
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const st = useRef<UnisonState>({ unison, detune, width, drift, phase });
  st.current = { unison, detune, width, drift, phase };

  const stacked = Math.round(unison) > 1 || detune > 1 || width > 0.55 || drift > 0.02;

  useEffect(() => {
    const key = motionHash(unison, detune, width, drift, PHASE_IX[phase]);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [unison, detune, width, drift, phase]);

  const applyFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      // X → width, Y → detune (up = more)
      setParam("unisonWidth", Math.round(x * 1000) / 1000);
      setParam("unisonDetune", Math.round((1 - y) * 50));
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Bottom rail: voice count 1–7
      if (y > H * 0.82) {
        const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const v = 1 + Math.min(6, Math.floor(x * 7));
        setParam("unison", v);
        return;
      }
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      applyFromPointer(e.clientX, e.clientY);
    },
    [applyFromPointer, setParam, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyFromPointer(e.clientX, e.clientY);
    },
    [applyFromPointer],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("unison", 1);
    setParam("unisonDetune", 0);
    setParam("unisonWidth", 0.5);
    setParam("drift", 0);
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
        paintUnison(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.unison ?? 1) > 1 || (st.current.drift ?? 0) > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.unison,
          st.current.detune,
          st.current.width,
          st.current.drift,
          PHASE_IX[st.current.phase],
        ),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, stacked ? 0.5 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexA(C, stacked ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Width ↔ / Detune ↕ · Bottom rail: voices · Double-click: mono"
      role="img"
      aria-label="Unison voice choir"
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
        Voice Choir
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {Math.round(unison)}V · {Math.round(detune)}¢
      </div>
    </div>
  );
}
