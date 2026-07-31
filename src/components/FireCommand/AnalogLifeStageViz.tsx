/**
 * LIFE — Organic Pulse stage visualizer.
 *
 * IDIOM: drift ribbons. Analog life is not a waveform, it is four slow noise
 * layers wandering at different speeds, so the panel is four horizontal ribbons
 * stacked with depth — the back ones dim, thin and slow, the front ones bright,
 * thick and quick — each one wandering across the full width of the letterbox.
 * Nothing here is a curve you read a value off; it reads as instability.
 *
 *   TREMOR  — fast micro jitter        (analogTremor × rate, frayed by instability)
 *   BREATH  — medium wander            (analogBreath, the widest excursion)
 *   CLIMATE — very slow bias           (analogClimate, a long lazy tilt)
 *   EVENTS  — discrete irregular kicks (analogEvents × envVariance, spikes)
 *
 * Drift sets every ribbon's amplitude, rate their speed, tune variance splits
 * each ribbon into per-voice filaments that pull apart, and env variance fires
 * the event spikes. Beat pips across the top count out the drift rate in BPM.
 *
 * The wander is value noise hashed off the layer index and a quantized time
 * lattice, not `Math.random`, so an idle panel holds still instead of crawling.
 *
 * Drift · Rate · Instability · Tune Δ · Env Δ (Signal Path Tone · FC.analogLife).
 * Drag: Rate ↔ / Life ↕. Bottom rail: Env Δ. Every param paints the living scope.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
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
  scanlines,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 176;
const C = FC.analogLife;
const C_DEEP = bandShade(FC.tone, 0.18);
const C_MID = bandShade(FC.tone, 0.38);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.88);
const C_DRIFT = bandShade(FC.tone, 0.42);
const C_RATE = bandShade(FC.tone, 0.5);
const C_INST = bandShade(FC.tone, 0.62);
const C_TUNE = bandShade(FC.tone, 0.72);
const C_ENV = bandShade(FC.tone, 0.82);

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Smooth value noise over a 1-D lattice. Deterministic in (x, seed), which is
 * what lets an idle panel hold a frozen field instead of shimmering.
 */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i * 1.13 + seed * 57.7);
  const b = hash01((i + 1) * 1.13 + seed * 57.7);
  const u = f * f * (3 - 2 * f);
  return (a + (b - a) * u) * 2 - 1;
}

/** Two octaves — enough to look organic without looking like white noise. */
function fbm(x: number, seed: number): number {
  return noise1(x, seed) * 0.7 + noise1(x * 2.7, seed + 11) * 0.3;
}

/**
 * Offsets are sampled once per filament into these, then every path walk reads
 * them back. `glowStroke` replays its path three times, so recomputing noise
 * inside the walk would triple the cost of the most expensive layer.
 */
const MAX_STEPS = 256;
const OFF_BODY = new Float32Array(MAX_STEPS + 1);
const OFF_FIL = new Float32Array(MAX_STEPS + 1);

export type AnalogLifeVizState = {
  drift: number;
  rate: number;
  instab: number;
  tune: number;
  env: number;
  tremor: number;
  breath: number;
  climate: number;
  events: number;
};

type Ribbon = {
  label: string;
  col: string;
  /** Fraction of panel height the ribbon's centreline sits at. */
  cy: number;
  /** Lattice cells across the width — low is slow and lazy. */
  cells: number;
  /** Scroll speed multiplier against the master rate. */
  speed: number;
  /** Amplitude multiplier against drift. */
  amp: number;
  /** Ribbon body thickness in px. */
  thick: number;
  /** Depth 0 (far) .. 1 (near) — sets alpha and line weight. */
  depth: number;
  scale: number;
  seed: number;
};

/**
 * Paint the drift field. Exported and pure so any life setting can be rendered
 * headlessly without mounting the component.
 */
export function paintAnalogLife(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: AnalogLifeVizState,
  now: number,
  flash: number,
): void {
  const life = Math.max(p.drift, p.instab * 0.9, p.tune * 0.7, p.env * 0.6);
  const dormant = life < 0.02;
  const energy = dormant ? 0.06 : 0.18 + life * 0.6;
  const t = now / 1000;
  const rate = clamp(p.rate, 0.05, 1);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  const padL = 62;
  const padR = 18;
  const span = Math.max(60, W - padL - padR);
  // Ribbons start below the reserved top strip so the beat-pip row and its
  // RATE gutter label, which sit just above them, clear the DOM chrome.
  const top = 38;
  const bottom = Hh - 34;

  // ── beat pips: the drift rate, counted out along the top ──
  const bpm = 28 + rate * 92;
  const beats = Math.max(4, Math.min(48, Math.round(span / 40)));
  const beatPhase = (t * bpm) / 60;
  for (let i = 0; i < beats; i++) {
    const x = padL + ((i + 0.5) / beats) * span;
    const lit0 = dormant ? 0 : Math.max(0, 1 - Math.abs(((beatPhase % beats) - i)) * 1.6);
    ctx.fillStyle = hexA(C_RATE, 0.12 + lit0 * 0.6);
    ctx.fillRect(x - 1, top - 12, 2, 5 + lit0 * 4);
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_RATE, 0.55);
  ctx.fillText("RATE", padL - 6, top - 8);

  // ── the four ribbons, far to near ──
  const ribbons: Ribbon[] = [
    { label: "CLIMATE", col: C_TUNE, cy: 0.3, cells: 2.2, speed: 0.1, amp: 1.5, thick: 16, depth: 0.15, scale: p.climate, seed: 3 },
    { label: "BREATH", col: C_DRIFT, cy: 0.46, cells: 5, speed: 0.34, amp: 1.15, thick: 12, depth: 0.45, scale: p.breath, seed: 7 },
    { label: "TREMOR", col: C_INST, cy: 0.62, cells: 18, speed: 1.5, amp: 0.55, thick: 7, depth: 0.8, scale: p.tremor, seed: 13 },
    { label: "EVENTS", col: C_ENV, cy: 0.76, cells: 9, speed: 0.5, amp: 0.7, thick: 6, depth: 1, scale: p.events, seed: 23 },
  ];

  // Per-voice filaments pull apart as tune variance rises.
  const filaments = 1 + Math.round(clamp(p.tune, 0, 1) * 4);

  for (let r = 0; r < ribbons.length; r++) {
    const rb = ribbons[r]!;
    const cy = top + rb.cy * (bottom - top);
    const gain = clamp(p.drift, 0, 1) * clamp(rb.scale, 0, 1) * rb.amp;
    const swing = (bottom - top) * 0.13 * gain;
    const scroll = t * rate * rb.speed;
    const fray = clamp(p.instab, 0, 1);
    const isEvents = rb.label === "EVENTS";
    const alpha = (0.1 + rb.depth * 0.16 + gain * 0.3) * (dormant ? 0.3 : 1);

    // Rail — where the ribbon would sit with no life at all.
    ctx.strokeStyle = hexA(C_MID, 0.07 + rb.depth * 0.05);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(cy) + 0.5);
    ctx.lineTo(padL + span, Math.round(cy) + 0.5);
    ctx.stroke();

    const steps = Math.max(40, Math.min(MAX_STEPS, (span / 8) | 0));
    const sample = (out: Float32Array, fil: number) => {
      for (let i = 0; i <= steps; i++) {
        const lattice = (i / steps) * rb.cells + scroll;
        let v = fbm(lattice + fil * 3.7, rb.seed + fil);
        if (isEvents) {
          // Events are irregular kicks, not a wander: a hashed gate that only
          // fires in the cells env variance opens up.
          const cell = Math.floor(lattice);
          const gate = hash01(cell * 3.3 + rb.seed);
          const local = lattice - cell;
          // Kicks alternate direction per cell so the row reads as events
          // rather than a rectified wobble.
          const sign = cell % 2 === 0 ? 1 : -1;
          v = gate < 0.12 + clamp(p.env, 0, 1) * 0.4 ? Math.exp(-local * 5) * sign : v * 0.12;
        }
        // Instability frays the edge — same hash every frame, so it holds still.
        const grit = fray * (hash01(i * 2.1 + fil * 17 + rb.seed) - 0.5) * 0.5;
        out[i] = (v + grit) * swing * (1 - fil * 0.12);
      }
    };
    sample(OFF_BODY, 0);

    // Ribbon body: a filled band between the wander and its thickness.
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      ctx.lineTo(padL + (i / steps) * span, cy + OFF_BODY[i]! - rb.thick * 0.5);
    }
    for (let i = steps; i >= 0; i--) {
      ctx.lineTo(padL + (i / steps) * span, cy + OFF_BODY[i]! + rb.thick * 0.5);
    }
    ctx.closePath();
    const body = cachedGrad(ctx, `ribbon|${r}|${Hh}|${(gain * 10) | 0}`, (c) => {
      const g = c.createLinearGradient(0, cy - rb.thick, 0, cy + rb.thick);
      g.addColorStop(0, hexA(rb.col, 0.05));
      g.addColorStop(0.5, hexA(rb.col, 0.45));
      g.addColorStop(1, hexA(rb.col, 0.05));
      return g;
    });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    // Filaments — one per voice as tune variance splits the pitch.
    const walk = (out: Float32Array) => {
      for (let i = 0; i <= steps; i++) {
        const x = padL + (i / steps) * span;
        const y = cy + out[i]!;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    glowStroke(ctx, () => walk(OFF_BODY), rb.col, {
      width: 0.8 + rb.depth * 1.4,
      glow: dormant ? 0 : rb.depth * (0.5 + gain),
      alpha: (0.3 + rb.depth * 0.45 + gain * 0.25) * (dormant ? 0.35 : 1),
    });
    for (let fil = 1; fil < filaments; fil++) {
      sample(OFF_FIL, fil);
      ctx.strokeStyle = hexA(rb.col, (0.1 + rb.depth * 0.12) * (dormant ? 0.3 : 1));
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      walk(OFF_FIL);
      ctx.stroke();
    }

    // Event spikes get a bloom where they land.
    if (isEvents && !dormant && p.env > 0.04) {
      lit(ctx, () => {
        for (let i = 0; i <= steps; i += 4) {
          const off = OFF_BODY[i]!;
          if (Math.abs(off) < swing * 0.55) continue;
          drawGlow(ctx, padL + (i / steps) * span, cy + off, 6 + p.env * 8, C_ENV, 0.25 + p.env * 0.35);
        }
      });
    }

    // Layer label in the left gutter — the ribbon names itself.
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(rb.col, (0.4 + rb.depth * 0.3) * (dormant ? 0.5 : 1));
    ctx.fillText(rb.label, padL - 6, cy + 3);
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(rb.col, 0.34);
    ctx.fillText(`${Math.round(clamp(rb.scale, 0, 1) * 100)}`, padL + span + 3, cy + 3);
  }

  // ── vitality strip along the top: one bar per param ──
  if (W >= 460) {
    const meters: Array<{ v: number; col: string; label: string }> = [
      { v: p.drift, col: C_DRIFT, label: "DRIFT" },
      { v: (p.rate - 0.05) / 0.95, col: C_RATE, label: "RATE" },
      { v: p.instab, col: C_INST, label: "INST" },
      { v: p.tune, col: C_TUNE, label: "TUNE" },
      { v: p.env, col: C_ENV, label: "ENV" },
    ];
    ctx.font = VIZ_FONT_LABEL;
    for (let i = 0; i < meters.length; i++) {
      const m = meters[i]!;
      const bx = 136 + i * 92;
      const bw = 44;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(bx, 10, bw, 6);
      ctx.fillStyle = hexA(m.col, 0.8);
      ctx.fillRect(bx, 11, Math.max(1, bw * clamp(m.v, 0, 1)), 4);
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(m.col, 0.62);
      ctx.fillText(m.label, bx + bw + 4, 16);
    }
  }

  // Rate / life crosshair — the drag handle's read-back.
  const hx = ((rate - 0.05) / 0.95) * W;
  const lifeAmt = Math.max(p.drift / 0.7, p.instab / 0.55, p.tune / 0.4, 0);
  const hy = (1 - clamp(lifeAmt, 0, 1)) * (Hh * 0.7);
  ctx.strokeStyle = hexA(C_GLOW, dormant ? 0.1 : 0.36 + flash * 0.3);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hx - 9, hy);
  ctx.lineTo(hx + 9, hy);
  ctx.moveTo(hx, hy - 9);
  ctx.lineTo(hx, hy + 9);
  ctx.stroke();
  ctx.fillStyle = hexA(C_HOT, 0.7 + flash * 0.3);
  ctx.beginPath();
  ctx.arc(hx, hy, 3 + flash * 2, 0, Math.PI * 2);
  ctx.fill();

  if (dormant) {
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillRect(0, 0, W, Hh - 24);
    ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.48);
    ctx.fillText("STILL · drag to wake organic life", W * 0.5, Hh * 0.5);
  }

  pill(ctx, W * 0.5, 3, dormant ? "STILL" : "ALIVE", C_GLOW, { glow: flash });

  // ── env Δ rail along the bottom, clear of the footer band ──
  const railY = Hh - 25;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  if (p.env > 0.01) {
    const eg = cachedGrad(ctx, `envrail|${W}`, (c) => {
      const g = c.createLinearGradient(12, 0, 12 + railW, 0);
      g.addColorStop(0, hexA(C_ENV, 0.35));
      g.addColorStop(1, hexA(C_GLOW, 0.92));
      return g;
    });
    ctx.fillStyle = eg;
    ctx.fillRect(12, railY + 1, Math.max(2, railW * p.env), 4);
  }
  lit(ctx, () => drawGlow(ctx, 12 + railW * p.env, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_ENV, 0.7);
  ctx.fillText("ENV Δ", 14, railY - 3);

  scanlines(ctx, W, Hh, 0.03, 3);
  grain(ctx, W, Hh, 0.03);
  bezel(ctx, W, Hh, C);

  let right = "STILL";
  if (!dormant) {
    const bits: string[] = [];
    if (p.drift > 0.04) bits.push(`DR${Math.round(p.drift * 100)}`);
    if (p.instab > 0.04) bits.push(`IN${Math.round(p.instab * 100)}`);
    if (p.tune > 0.04) bits.push(`TN${Math.round(p.tune * 100)}`);
    if (p.env > 0.04) bits.push(`EV${Math.round(p.env * 100)}`);
    bits.push(`~${Math.round(bpm)}bpm`);
    right = bits.join(" · ");
  }
  footer(ctx, W, Hh, "LIFE · ORGANIC PULSE", right, C_GLOW, dormant ? C_MID : C_HOT);
}

export function AnalogLifeStageViz() {
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.driftRate) ?? 0.35;
  const instab = useFireCommandStore((s) => s.patch.voiceInstability) ?? 0;
  const tune = useFireCommandStore((s) => s.patch.tuneVariance) ?? 0;
  const env = useFireCommandStore((s) => s.patch.envVariance) ?? 0;
  const tremor = useFireCommandStore((s) => s.patch.analogTremor) ?? 0.55;
  const breath = useFireCommandStore((s) => s.patch.analogBreath) ?? 0.45;
  const climate = useFireCommandStore((s) => s.patch.analogClimate) ?? 0.3;
  const events = useFireCommandStore((s) => s.patch.analogEvents) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<"xy" | "env" | null>(null);
  const prevKey = useRef(0);
  const st = useRef<AnalogLifeVizState>({ drift, rate, instab, tune, env, tremor, breath, climate, events });
  st.current = { drift, rate, instab, tune, env, tremor, breath, climate, events };

  const alive = drift > 0.02 || instab > 0.02 || tune > 0.02 || env > 0.02;
  const bpm = Math.round(28 + rate * 92);

  useEffect(() => {
    const key = motionHash(drift, rate, instab, tune, env, tremor, breath, climate, events);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [drift, rate, instab, tune, env, tremor, breath, climate, events]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      const r = 0.05 + x * 0.95;
      const lifeAmt = 1 - y;
      setParam("driftRate", Math.round(r * 1000) / 1000);
      setParam("drift", Math.round(lifeAmt * 0.7 * 1000) / 1000);
      setParam("voiceInstability", Math.round(lifeAmt * 0.55 * 1000) / 1000);
      setParam("tuneVariance", Math.round(lifeAmt * 0.4 * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyEnv = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("envVariance", Math.round(x * 1000) / 1000);
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
        dragRef.current = "env";
        wrap.setPointerCapture(e.pointerId);
        applyEnv(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyEnv, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "env") applyEnv(e.clientX);
    },
    [applyXy, applyEnv],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("drift", 0);
    setParam("driftRate", 0.35);
    setParam("voiceInstability", 0);
    setParam("tuneVariance", 0);
    setParam("envVariance", 0);
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
        paintAnalogLife(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          (st.current.drift ?? 0) > 0.02 ||
          (st.current.instab ?? 0) > 0.02 ||
          (st.current.tune ?? 0) > 0.02 ||
          (st.current.env ?? 0) > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.drift,
          st.current.rate,
          st.current.instab,
          st.current.tune,
          st.current.env,
          st.current.tremor,
          st.current.breath,
          st.current.climate,
          st.current.events,
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
        borderColor: hexA(C, alive ? 0.55 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, alive ? 0.26 : 0.08)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Rate ↔ / Life ↕ · Bottom rail: Env Δ · Double-click: still"
      role="img"
      aria-label="Analog life organic pulse"
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
        Organic Pulse
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 flex items-center gap-1.5 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: alive ? C_GLOW : "rgba(255,255,255,0.2)",
            boxShadow: alive ? `0 0 8px ${C}` : undefined,
            animation: alive ? `lifePulse ${Math.max(0.35, 1.1 - rate * 0.7)}s ease-in-out infinite` : undefined,
          }}
        />
        {alive ? `${bpm} BPM` : "STILL"}
      </div>
      <style>{`@keyframes lifePulse { 0%,100%{opacity:.45;transform:scale(.85)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
    </div>
  );
}
