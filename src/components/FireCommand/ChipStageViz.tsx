/**
 * CHIP — Acid Circuit stage visualizer.
 *
 * IDIOM: the stair grid. Everything here is snapped to an 8 px pixel lattice —
 * the pulse is drawn as hard duty blocks, the DAC staircase behind it steps in
 * 4-bit rungs, the noise is a row of held bits, and nothing is anti-aliased on
 * purpose. No other module in the instrument is allowed to look blocky, so the
 * cart reads as 8-bit at a glance.
 *
 * Duty · Hard sync · Chip noise · Accent · Slide · Voices (Sources · FC.chip).
 * Drag: pulse width. Double-click: 50% square.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ChipNoiseMode } from "@/audio/dsp/FireCommandSynth";
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
  lattice,
  lit,
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 158;
/** Pixel lattice pitch — every coordinate in this panel snaps to it. */
const CELL = 8;
const C = FC.chip;
const C_DEEP = bandShade(FC.sources, 0.42);
const C_MID = bandShade(FC.sources, 0.55);
const C_HOT = bandShade(FC.sources, 0.72);
const C_GLOW = bandShade(FC.sources, 0.9);
const C_SYNC = bandShade(FC.sources, 0.62);
const C_NOISE = bandShade(FC.sources, 0.48);
const C_ACC = bandShade(FC.sources, 0.78);

/** Duty landmarks a chip musician actually thinks in. */
const DUTY_TICKS = [0.125, 0.25, 0.5, 0.75] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function snap(v: number): number {
  return Math.round(v / CELL) * CELL;
}

/** Deterministic bit source — the LFSR stand-in, stable for a given frame. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function noiseHold(mode: ChipNoiseMode): number {
  if (mode === "nes") return 7;
  if (mode === "gb") return 4;
  if (mode === "periodic") return 2;
  return 1;
}

function noiseLabel(mode: ChipNoiseMode): string {
  if (mode === "periodic") return "PER";
  if (mode === "nes") return "HOLD";
  if (mode === "gb") return "SOFT";
  return "WHT";
}

export type ChipState = {
  duty: number;
  sync: boolean;
  noise: ChipNoiseMode;
  accent: number;
  slide: boolean;
  voices: number;
};

export function paintChip(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ChipState,
  now: number,
  flash: number,
): void {
  const duty = clamp(p.duty, 0.05, 0.95);
  const acc = clamp(p.accent, 0, 1);
  const energy = 0.22 + Math.abs(duty - 0.5) * 0.7 + acc * 0.4 + (p.sync ? 0.14 : 0);
  const eBucket = (energy * 12) | 0;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });
  lattice(ctx, W, Hh, C_MID, CELL, 0.16);

  // ── lattice geometry: whole cells only, no sub-pixel anything ──
  const padL = snap(24);
  const padR = snap(24);
  const span = Math.max(CELL * 8, snap(W - padL - padR));
  const cols = Math.max(8, Math.floor(span / CELL));
  const mid = snap(Hh * 0.42);
  const amp = Math.max(CELL * 2, snap(Hh * 0.2 * (1 + acc * 0.35)));
  const noiseY = snap(Hh * 0.76);
  const cycles = 4 + (p.sync ? 1 : 0);
  // Motion advances in whole cells so the cart never looks smooth.
  const shift = Math.floor(now * 0.055 * (p.slide ? 0.55 : 1));
  const phaseAt = (c: number) => ((((c + shift) / cols) * cycles) % 1 + 1) % 1;

  // Centre rail.
  ctx.fillStyle = hexA(C_MID, 0.26);
  ctx.fillRect(padL, mid, span, 1);

  // ── 4-bit DAC staircase behind the pulse ──
  const steps = 8;
  for (let c = 0; c < cols; c++) {
    const ph = phaseAt(c);
    const q = Math.floor(ph * steps) / (steps - 1);
    const y = snap(mid + amp - q * amp * 2);
    ctx.fillStyle = hexA(C_DEEP, 0.5);
    ctx.fillRect(padL + c * CELL, y, CELL - 1, 2);
  }

  // ── slide: the lagged duty, drawn as a ghost stair ──
  if (p.slide) {
    const lag = clamp(duty + Math.sin(now / 400) * 0.09, 0.05, 0.95);
    ctx.fillStyle = hexA(C_MID, 0.3);
    for (let c = 0; c < cols; c++) {
      const y = phaseAt(c) < lag ? mid - amp + CELL : mid + amp - CELL;
      ctx.fillRect(padL + c * CELL, y, CELL - 1, 2);
    }
  }

  // ── the pulse, as duty blocks ──
  const blockGrad = cachedGrad(ctx, `chipHi|${mid}|${amp}|${eBucket}`, (c) => {
    const g = c.createLinearGradient(0, mid - amp, 0, mid);
    g.addColorStop(0, hexA(C_HOT, 0.5 + energy * 0.35));
    g.addColorStop(1, hexA(C, 0.14 + energy * 0.12));
    return g;
  });
  const lowGrad = cachedGrad(ctx, `chipLo|${mid}|${amp}|${eBucket}`, (c) => {
    const g = c.createLinearGradient(0, mid, 0, mid + amp);
    g.addColorStop(0, hexA(C_DEEP, 0.16));
    g.addColorStop(1, hexA(C_DEEP, 0.4 + energy * 0.16));
    return g;
  });
  for (let c = 0; c < cols; c++) {
    const high = phaseAt(c) < duty;
    const x = padL + c * CELL;
    ctx.fillStyle = high ? blockGrad : lowGrad;
    ctx.fillRect(x, high ? mid - amp : mid, CELL - 1, amp);
    // Cap the block so the square edge reads as a hard step.
    ctx.fillStyle = hexA(high ? C_GLOW : C_MID, high ? 0.75 + energy * 0.25 : 0.28);
    ctx.fillRect(x, high ? mid - amp : mid + amp - 2, CELL - 1, 2);
  }

  // Transition walls: the vertical edge of each duty flip.
  ctx.fillStyle = hexA(C_GLOW, 0.5 + energy * 0.35);
  for (let c = 1; c < cols; c++) {
    if ((phaseAt(c) < duty) !== (phaseAt(c - 1) < duty)) {
      ctx.fillRect(padL + c * CELL - 1, mid - amp, 2, amp * 2);
    }
  }
  lit(ctx, () => {
    for (let c = 1; c < cols; c++) {
      if ((phaseAt(c) < duty) !== (phaseAt(c - 1) < duty)) {
        drawGlow(ctx, padL + c * CELL, mid, 12 + acc * 14, C_GLOW, 0.14 + energy * 0.18);
      }
    }
  });

  // ── hard sync: the phase reset, one bright column per cycle ──
  if (p.sync) {
    for (let k = 0; k < cycles; k++) {
      const c = ((Math.round((k * cols) / cycles) - (shift % cols)) % cols + cols) % cols;
      const x = padL + c * CELL;
      ctx.fillStyle = hexA(C_SYNC, 0.85);
      ctx.fillRect(x, mid - amp - CELL, 2, amp * 2 + CELL * 2);
      ctx.fillStyle = hexA(C_GLOW, 0.9);
      ctx.fillRect(x - 2, mid - amp - CELL - 2, 6, 4);
    }
    lit(ctx, () => {
      for (let k = 0; k < cycles; k++) {
        const c = ((Math.round((k * cols) / cycles) - (shift % cols)) % cols + cols) % cols;
        drawGlow(ctx, padL + c * CELL, mid, 16, C_SYNC, 0.22);
      }
    });
  }

  // ── accent pops: blocky sparks off the rising edges ──
  if (acc > 0.05) {
    const n = 6 + Math.floor(acc * 12);
    for (let k = 0; k < n; k++) {
      const t = ((now * 0.0015 * (0.6 + hash01(k * 3.31) * 0.8) + hash01(k * 7.13)) % 1 + 1) % 1;
      const life = 1 - t;
      const x = padL + Math.floor(hash01(k * 2.71) * cols) * CELL;
      const y = snap(mid - amp - t * CELL * 3);
      ctx.fillStyle = hexA(C_ACC, life * 0.8 * acc);
      ctx.fillRect(x, y, CELL / 2, CELL / 2);
    }
  }

  // ── chip noise: one row of held bits, hold length is the mode ──
  const hold = noiseHold(p.noise);
  const tick = Math.floor(now * 0.012 * (hold < 3 ? 2 : 1));
  ctx.fillStyle = hexA(C_NOISE, 0.1 + energy * 0.07);
  ctx.fillRect(padL, noiseY - CELL - 2, span, CELL * 2 + 4);
  for (let c = 0; c < cols; c++) {
    const g = Math.floor(c / hold);
    const bit = hash01(g * 1.37 + tick * 0.61) > 0.5;
    ctx.fillStyle = hexA(bit ? C_HOT : C_DEEP, bit ? 0.5 + energy * 0.25 : 0.35);
    ctx.fillRect(padL + c * CELL, bit ? noiseY - CELL : noiseY, CELL - 1, CELL);
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_NOISE, 0.65);
  ctx.fillText(`NOISE ${noiseLabel(p.noise)} · HOLD ${hold}`, padL, noiseY - CELL - 6);

  // ── duty ruler + marker ──
  const rulerY = snap(Hh * 0.13);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (const t of DUTY_TICKS) {
    const x = snap(padL + t * span);
    const on = Math.abs(t - duty) < 0.02;
    ctx.fillStyle = hexA(on ? C_GLOW : C_MID, on ? 0.85 : 0.3);
    ctx.fillRect(x - 1, rulerY, 2, 4);
    ctx.fillText(`${Math.round(t * 100)}`, x, rulerY - 3);
  }
  const dutyX = snap(padL + duty * span);
  ctx.fillStyle = hexA(C_GLOW, 0.7);
  ctx.fillRect(dutyX - 1, rulerY, 2, mid - amp - rulerY);
  ctx.fillRect(dutyX - CELL / 2, rulerY + 4, CELL, 4);
  lit(ctx, () => drawGlow(ctx, dutyX, rulerY + 6, 10 + flash * 6, C_GLOW, 0.8));

  // ── voice limit: one block per allocated chip voice ──
  const vCount = Math.round(p.voices);
  if (vCount > 0) {
    for (let v = 0; v < vCount; v++) {
      const on = Math.sin(now / 150 + v * 0.6) > -0.2;
      const x = W - padR - (vCount - v) * CELL * 2;
      ctx.fillStyle = hexA(C_GLOW, on ? 0.8 : 0.28);
      ctx.fillRect(x, rulerY - 2, CELL, CELL + (on ? 4 : 0));
    }
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.fillText(`V${vCount}`, W - padR - vCount * CELL * 2 - 4, rulerY + CELL);
  }

  // ── slide flag: a stepped ramp glyph, not a smooth arrow ──
  if (p.slide) {
    const sx = snap(W * 0.5) - CELL * 3;
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = hexA(C_HOT, 0.35 + k * 0.14);
      ctx.fillRect(sx + k * CELL, rulerY + CELL - k * 2, CELL - 1, 2);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_HOT, 0.6);
    ctx.fillText("SLIDE", sx + CELL * 5, rulerY + CELL);
  }

  pill(
    ctx,
    W * 0.5,
    3,
    `${noiseLabel(p.noise)} · ${p.sync ? "SYNC" : "FREE"}${acc > 0.04 ? ` · ACC ${Math.round(acc * 100)}` : ""}`,
    C_GLOW,
    { glow: flash },
  );

  grain(ctx, W, Hh, 0.03);
  bezel(ctx, W, Hh, C);
  const tags = [
    p.sync ? "SYNC" : null,
    p.slide ? "SLIDE" : null,
    acc > 0.04 ? `ACC ${Math.round(acc * 100)}` : null,
    vCount > 0 ? `V${vCount}` : null,
  ].filter(Boolean) as string[];
  footer(
    ctx,
    W,
    Hh,
    `CHIP · PWM ${Math.round(duty * 100)}% · ${String(p.noise).toUpperCase()}`,
    tags.length ? tags.join(" · ") : "IDLE CART",
    C_GLOW,
    tags.length ? C_HOT : C_MID,
  );
}

export function ChipStageViz() {
  const duty = useFireCommandStore((s) => s.patch.pulseDuty) ?? 0.5;
  const sync = useFireCommandStore((s) => s.patch.hardSync) ?? false;
  const noise = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const accent = useFireCommandStore((s) => s.patch.accentAmount) ?? 0;
  const slide = useFireCommandStore((s) => s.patch.slideOn) ?? false;
  const voices = useFireCommandStore((s) => s.patch.chipVoiceLimit) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const st = useRef<ChipState>({ duty, sync, noise, accent, slide, voices });
  st.current = { duty, sync, noise, accent, slide, voices };

  const active = Math.abs(duty - 0.5) > 0.02 || sync || slide || accent > 0.02 || voices > 0 || noise !== "white";

  useEffect(() => {
    const key = motionHash(duty, sync, accent, slide, voices, noiseHold(noise));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [duty, sync, noise, accent, slide, voices]);

  const setDutyFromClientX = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const t = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      // Map full width to 5%–95%
      const d = 0.05 + t * 0.9;
      setParam("pulseDuty", Math.round(d * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Duty scrub on upper/mid wave region; lower third reserved for reading
      if (y > H * 0.72) return;
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      setDutyFromClientX(e.clientX);
    },
    [setDutyFromClientX, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      setDutyFromClientX(e.clientX);
    },
    [setDutyFromClientX],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("pulseDuty", 0.5);
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
        paintChip(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          Math.abs((st.current.duty ?? 0.5) - 0.5) > 0.02 ||
          !!st.current.sync ||
          !!st.current.slide ||
          (st.current.accent ?? 0) > 0.02 ||
          (st.current.voices ?? 0) > 0 ||
          st.current.noise !== "white",
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.duty,
          st.current.sync,
          st.current.accent,
          st.current.slide,
          st.current.voices,
          noiseHold(st.current.noise),
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
        borderColor: hexA(C, active ? 0.5 : 0.28),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexA(C, active ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
        imageRendering: "pixelated",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag to set pulse width · double-click = 50% square"
      role="slider"
      aria-label="Chip pulse duty"
      aria-valuemin={5}
      aria-valuemax={95}
      aria-valuenow={Math.round(duty * 100)}
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
        Acid Circuit
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {Math.round(duty * 100)}%
      </div>
    </div>
  );
}
