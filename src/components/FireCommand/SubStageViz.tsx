/**
 * SUB — Tectonic stage visualizer.
 *
 * IDIOM: the foundation. One heavy, slow waveform sits low in the letterbox and
 * is welded to the floor — thick stroke, deep body fill, real bloom in the
 * troughs. Only two or three cycles cross the whole width, so it reads as mass
 * rather than detail; every other source module is busy, this one is only heavy.
 * When Translate is up, a thin bright harmonic ghost rides above it — the part
 * of the sub that small speakers can actually reproduce.
 *
 * Wave · Octave · Level · Translate (Signal Path Sources · FC.sub).
 * Drag vertically: level. Bottom rail: octave. Double-click: mute.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { SubWave } from "@/audio/dsp/FireCommandSynth";
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
} from "./stageVizKit";

const H = 158;
const C = FC.sub;
const C_DEEP = bandShade(FC.sources, 0.55);
const C_MID = bandShade(FC.sources, 0.68);
const C_HOT = bandShade(FC.sources, 0.82);
const C_GLOW = bandShade(FC.sources, 0.94);
const C_FLOOR = bandShade(FC.sources, 0.48);

const OCTS = [-2, -1, 0] as const;
/** Wave as a number, so it can ride in the allocation-free motion hash. */
const WAVE_IX: Record<SubWave, number> = { sine: 0, triangle: 1, square: 2, sawtooth: 3 };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function waveAt(wave: SubWave, u: number): number {
  if (wave === "sine") return Math.sin(u);
  if (wave === "triangle") return (2 / Math.PI) * Math.asin(Math.sin(u));
  if (wave === "square") return Math.sin(u) > 0 ? 1 : -1;
  // sawtooth
  return 2 * ((u / (Math.PI * 2)) % 1) - 1;
}

export type SubState = {
  level: number;
  wave: SubWave;
  oct: number;
  /** 0..1 upper-harmonic translation for small-speaker audibility. */
  translate: number;
};

export function paintSub(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: SubState,
  now: number,
  flash: number,
): void {
  const lvl = clamp(p.level, 0, 1);
  const dormant = lvl < 0.02;
  const energy = dormant ? 0.08 : 0.22 + lvl * 0.78;
  const trans = clamp(p.translate ?? 0, 0, 1);
  const oct = Math.round(clamp(p.oct, -2, 0));
  // Deeper octave = fewer, wider cycles = more apparent mass.
  const cycles = 1.4 + (2 + oct) * 0.8;
  const eBucket = (energy * 12) | 0;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.84 });
  strata(ctx, W, Hh, C_DEEP, { count: 5, horizon: 0.16, alpha: 0.09 });

  // ── geometry: the body sits low and the floor is a real surface ──
  const padL = 18;
  const padR = 18;
  const span = Math.max(60, W - padL - padR);
  const floorY = Hh * 0.78;
  const axisY = Hh * 0.5;
  const railY = Hh - 26;
  const amp = Hh * 0.24 * (0.3 + energy * 0.7) * (0.95 + flash * 0.1);
  const phase = now * 0.0016 * (1 + Math.abs(oct) * 0.12);
  const breath = 0.96 + 0.04 * Math.sin(now / 700);
  const step = 3;

  const bodyY = (x: number) =>
    axisY + waveAt(p.wave, (x / span) * cycles * Math.PI * 2 + phase) * amp * breath;

  // Floor slab — the thing the foundation rests on.
  ctx.fillStyle = hexA(C_FLOOR, 0.2 + energy * 0.14);
  ctx.fillRect(padL, floorY, span, 2);
  lit(ctx, () => {
    const n = Math.max(4, Math.round(span / 220));
    for (let k = 0; k < n; k++) {
      drawGlow(ctx, padL + ((k + 0.5) / n) * span, floorY, 26 + energy * 26, C_FLOOR, 0.08 + energy * 0.16);
    }
  });

  // ── body: filled from the wave down onto the floor ──
  ctx.beginPath();
  ctx.moveTo(padL, floorY);
  for (let x = 0; x <= span; x += step) ctx.lineTo(padL + x, bodyY(x));
  ctx.lineTo(padL + span, floorY);
  ctx.closePath();
  ctx.fillStyle = cachedGrad(ctx, `subBody|${Hh}|${eBucket}`, (c) => {
    const g = c.createLinearGradient(0, Hh * 0.2, 0, Hh * 0.86);
    g.addColorStop(0, hexA(C_GLOW, (0.22 + energy * 0.3) * (dormant ? 0.3 : 1)));
    g.addColorStop(0.5, hexA(C_HOT, 0.16 + energy * 0.16));
    g.addColorStop(1, hexA(C_DEEP, 0.06));
    return g;
  });
  ctx.fill();

  // Undertow: the octave below, drawn as a slower shadow of the body.
  ctx.strokeStyle = hexA(C_DEEP, 0.2 + energy * 0.14);
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let x = 0; x <= span; x += step * 2) {
    const y = axisY + waveAt(p.wave, (x / span) * cycles * Math.PI + phase * 0.5) * amp * 0.55 * breath;
    if (x === 0) ctx.moveTo(padL + x, y);
    else ctx.lineTo(padL + x, y);
  }
  ctx.stroke();

  // ── the heavy trace ──
  const bodyPath = () => {
    for (let x = 0; x <= span; x += step) {
      const xx = padL + x;
      const yy = bodyY(x);
      if (x === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
  };
  glowStroke(ctx, bodyPath, C_GLOW, {
    width: 5.5 + lvl * 3.5,
    glow: 0.8 + energy * 0.9,
    alpha: (dormant ? 0.3 : 0.6) + energy * 0.35,
  });

  // Trough bloom — where the mass actually is.
  if (!dormant) {
    lit(ctx, () => {
      const peaks = Math.max(2, Math.round(cycles * 2));
      for (let i = 0; i < peaks; i++) {
        const x = ((i + 0.5) / peaks) * span;
        const y = bodyY(x);
        const low = (y - axisY) / Math.max(1, amp);
        drawGlow(ctx, padL + x, y, 16 + lvl * 20, C_HOT, (0.14 + lvl * 0.3) * (0.4 + Math.max(0, low) * 0.6));
      }
    });
  }

  // ── translate: the thin upper harmonic that makes the sub audible small ──
  if (trans > 0.01) {
    const tY = Hh * 0.2;
    ctx.strokeStyle = hexA(C_GLOW, 0.2 + trans * 0.5);
    ctx.lineWidth = 1 + trans;
    ctx.beginPath();
    for (let x = 0; x <= span; x += 3) {
      const y = tY + waveAt("sine", (x / span) * cycles * 8 * Math.PI * 2 + phase * 4) * (Hh * 0.045) * (0.35 + trans * 0.65);
      if (x === 0) ctx.moveTo(padL + x, y);
      else ctx.lineTo(padL + x, y);
    }
    ctx.stroke();
    // Tie it back to the body so it reads as derived, not as a second voice.
    ctx.strokeStyle = hexA(C_MID, 0.1 + trans * 0.16);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    const ties = Math.max(3, Math.round(span / 260));
    for (let k = 0; k < ties; k++) {
      const x = ((k + 0.5) / ties) * span;
      ctx.moveTo(padL + x, tY + 6);
      ctx.lineTo(padL + x, bodyY(x) - amp * 0.2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.35 + trans * 0.4);
    ctx.fillText(`TRANSLATE ${Math.round(trans * 100)}`, padL + 110, tY - 8);
  }

  // ── octave rail (tap zone) ──
  for (let i = 0; i < 3; i++) {
    const x0 = padL + (i / 3) * span + 3;
    const x1 = padL + ((i + 1) / 3) * span - 3;
    const on = oct === OCTS[i];
    ctx.fillStyle = on ? hexA(C_HOT, 0.32 + energy * 0.24) : "rgba(255,255,255,0.04)";
    ctx.fillRect(x0, railY, x1 - x0, 8);
    if (on) {
      ctx.strokeStyle = hexA(C_GLOW, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, railY + 0.5, x1 - x0 - 1, 7);
    }
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = on ? hexA(C_GLOW, 0.95) : hexA(C_MID, 0.42);
    ctx.fillText(`${OCTS[i]} OCT`, (x0 + x1) / 2, railY + 6.5);
  }

  // Level needle, right edge.
  const meterTop = Hh * 0.16;
  const meterH = Hh * 0.5;
  const lx = W - 12;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(lx, meterTop, 5, meterH);
  ctx.fillStyle = hexA(C_GLOW, 0.4 + lvl * 0.5);
  ctx.fillRect(lx, meterTop + meterH * (1 - lvl), 5, meterH * lvl);
  lit(ctx, () => drawGlow(ctx, lx + 2.5, meterTop + meterH * (1 - lvl), 8, C_GLOW, 0.75));

  pill(ctx, W * 0.5, 3, `${p.wave.toUpperCase()} · ${oct} OCT`, C_GLOW, { glow: flash });

  if (dormant) {
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillRect(0, 0, W, Hh - 20);
    ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.5 + Math.sin(now / 520) * 0.1);
    ctx.fillText("FOUNDATION OFF · drag up to wake", W * 0.5, Hh * 0.45);
  }

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    `SUB · ${p.wave.toUpperCase()} · ${oct}oct`,
    dormant ? "OFF" : trans > 0.01 ? `${Math.round(lvl * 100)}% · TR ${Math.round(trans * 100)}` : `${Math.round(lvl * 100)}%`,
    C_GLOW,
    dormant ? C_MID : C_HOT,
  );
}

export function SubStageViz() {
  const level = useFireCommandStore((s) => s.patch.subLevel) ?? 0;
  const wave = useFireCommandStore((s) => s.patch.subWave) ?? "sine";
  const oct = useFireCommandStore((s) => s.patch.subOctave ?? -1);
  const translate = useFireCommandStore((s) => s.patch.subTranslate) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const st = useRef<SubState>({ level, wave, oct, translate });
  st.current = { level, wave, oct, translate };

  const silent = level < 0.02;

  useEffect(() => {
    const key = motionHash(level, oct, translate, WAVE_IX[wave]);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [level, wave, oct, translate]);

  const setLevelFromClientY = useCallback(
    (clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      setParam("subLevel", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Octave scrub on bottom rail
      if (y > H * 0.78) {
        const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const idx = Math.min(2, Math.floor(x * 3));
        setParam("subOctave", OCTS[idx]!);
        return;
      }
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      setLevelFromClientY(e.clientY);
    },
    [setLevelFromClientY, setParam, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      setLevelFromClientY(e.clientY);
    },
    [setLevelFromClientY],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("subLevel", 0);
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
        paintSub(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.level ?? 0) > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.level,
          st.current.oct,
          st.current.translate,
          WAVE_IX[st.current.wave],
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
        borderColor: hexA(C, silent ? 0.28 : 0.5),
        height: H,
        cursor: "ns-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexA(C, silent ? 0.08 : 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag vertically for level · tap octave rail · double-click mute"
      role="slider"
      aria-label="Sub oscillator level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
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
        Tectonic
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {silent ? "OFF" : `${oct}oct · ${Math.round(level * 100)}%`}
      </div>
    </div>
  );
}
