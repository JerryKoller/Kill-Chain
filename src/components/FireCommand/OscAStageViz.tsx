/**
 * OSC A — Prime Voice stage visualizer.
 *
 * IDIOM: the wavetable frame ribbon. The stage is a ~11:1 letterbox, so width
 * is ONE cycle of the table and depth runs *up* the panel: all eight morph
 * frames are drawn as receding strata, and the frame the engine is actually
 * playing rides through that stack as a bright scan line. Drag the morph and
 * the lit wave physically climbs the ribbon — you see the table you are
 * scanning through, not just the slice you landed on.
 *
 * Table · Morph · Env · LFO · Octave · Detune · Level (Sources · FC.oscA).
 * Drag lower half: morph. Double-click: reset morph.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
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
const N = 128;
const C = FC.oscA;
const C_DEEP = bandShade(FC.sources, 0.08);
const C_MID = bandShade(FC.sources, 0.38);
const C_HOT = bandShade(FC.sources, 0.68);
const C_GLOW = bandShade(FC.sources, 0.88);
const C_ENV = bandShade(FC.sources, 0.55);
const C_LFO = bandShade(FC.sources, 0.72);

const DEFAULT_MORPH = 0.66;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic scatter — a fixed field, so nothing crawls on an idle canvas. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * One resampled frame set per table id. `frameSamples` sums 64 partials per
 * sample, so it must never run more than once per table inside a paint.
 */
const frameBank = new Map<string, Float32Array[]>();
function tableFrames(id: string): Float32Array[] {
  const hit = frameBank.get(id);
  if (hit) return hit;
  const out: Float32Array[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) out.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
  if (frameBank.size > 24) frameBank.clear();
  frameBank.set(id, out);
  return out;
}

/** Scratch for the interpolated cycle — paint is single-threaded, reuse is safe. */
const hero = new Float32Array(N);

export type OscAState = {
  table: string;
  level: number;
  pos: number;
  env: number;
  lfo: number;
  oct: number;
  detune: number;
  /** Engine-side morph (env + LFO already folded in); falls back to `pos`. */
  livePos: number;
};

/**
 * Paint the frame ribbon. Exported and pure so a headless render gets exactly
 * what the panel shows for a given state.
 */
export function paintOscA(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: OscAState,
  now: number,
  flash: number,
): void {
  const lvl = clamp(p.level, 0, 1);
  const silent = lvl < 0.02;
  const energy = silent ? 0.08 : 0.22 + lvl * 0.78;
  const envAbs = Math.abs(p.env);
  const lfoAbs = Math.abs(p.lfo);
  const detNorm = Math.min(1, Math.abs(p.detune) / 50);
  const octZoom = Math.pow(2, clamp(p.oct, -2, 2) * 0.38);
  const morph = clamp(p.livePos, 0, 1);
  const eBucket = (energy * 12) | 0;

  const frames = tableFrames(p.table);
  const cur = morph * (FRAME_COUNT - 1);
  const lo = Math.floor(cur);
  const hi = Math.min(lo + 1, FRAME_COUNT - 1);
  const frac = cur - lo;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.68 });

  // ── ribbon geometry: across = one cycle, up = deeper into the table ──
  const padL = 30;
  const padR = 24;
  const span = Math.max(60, W - padL - padR);
  const frontY = Hh * 0.63;
  const backY = Hh * 0.32;
  const stackH = frontY - backY;
  const railY = Hh - 26;
  const amp = Hh * 0.15 * (0.35 + energy * 0.65) * (0.94 + flash * 0.12);
  const ghostAmp = Hh * 0.058 * (0.4 + energy * 0.6);
  const breath = 0.95 + 0.05 * Math.sin(now / 620);

  strata(ctx, W, Hh, C_DEEP, { count: 9, horizon: 0.3, alpha: 0.11, skew: 44 });

  /** Baseline of frame `f` (fractional ok) — compressed toward the back. */
  const frameY = (f: number) =>
    frontY - Math.pow(clamp(f, 0, FRAME_COUNT - 1) / (FRAME_COUNT - 1), 0.8) * stackH;

  const sample = (frame: number, i: number) => {
    const f = frames[frame < 0 ? 0 : frame > FRAME_COUNT - 1 ? FRAME_COUNT - 1 : frame]!;
    const ii = (((i * octZoom) % (N - 1)) + (N - 1)) % (N - 1);
    const i0 = Math.floor(ii);
    const i1 = Math.min(N - 1, i0 + 1);
    const ft = ii - i0;
    let v = f[i0]! * (1 - ft) + f[i1]! * ft;
    // Env bends the wave asymmetrically: + brightens peaks, − folds them.
    if (envAbs > 0.01) v *= 1 + p.env * 0.22 * Math.sign(v) * Math.abs(v);
    return clamp(v, -1.4, 1.4);
  };
  // The lit cycle is walked several times (fill, glow passes, detune ghosts),
  // so resolve it once into a scratch buffer instead of re-interpolating.
  for (let i = 0; i < N; i++) hero[i] = sample(lo, i) * (1 - frac) + sample(hi, i) * frac;
  const waveAt = (i: number) => hero[((i % N) + N) % N]!;

  // ── the stack: every frame in the table, receding ──
  for (let f = FRAME_COUNT - 1; f >= 0; f--) {
    const t = f / (FRAME_COUNT - 1);
    const y0 = frameY(f);
    const inset = t * span * 0.03;
    const near = 1 - Math.min(1, Math.abs(f - cur) / 2.4);
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = padL + inset + (i / (N - 1)) * (span - inset * 2);
      const y = y0 - sample(f, i) * ghostAmp * (0.55 + (1 - t) * 0.6) * breath;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hexA(near > 0.55 ? C_HOT : C_MID, 0.06 + energy * 0.08 + near * (0.08 + energy * 0.14));
    ctx.lineWidth = 0.7 + near * 0.7;
    ctx.stroke();
  }

  // Frame index gutter — the table read as a numbered stack.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  for (let f = 0; f < FRAME_COUNT; f++) {
    const on = f === lo || f === hi;
    ctx.fillStyle = hexA(on ? C_GLOW : C_MID, on ? 0.72 : 0.26);
    ctx.fillText(`${f + 1}`, padL - 7, frameY(f) + 3);
  }

  // ── the scan line: where in the table we actually are ──
  const heroY = frameY(cur);
  lit(ctx, () => {
    const band = cachedGrad(ctx, "oscaScan", (c) => {
      const g = c.createLinearGradient(0, -16, 0, 16);
      g.addColorStop(0, hexA(C, 0));
      g.addColorStop(0.5, hexA(C_GLOW, 0.17));
      g.addColorStop(1, hexA(C, 0));
      return g;
    });
    ctx.save();
    ctx.translate(0, heroY);
    ctx.fillStyle = band;
    ctx.fillRect(padL, -16, span, 32);
    ctx.restore();
  });
  ctx.fillStyle = hexA(C_GLOW, 0.2 + flash * 0.2);
  ctx.fillRect(padL, heroY, span, 1);

  /** Hero contour at a phase offset (samples, wrapped) — no beginPath here. */
  const heroPath = (phase: number, mul: number) => {
    for (let i = 0; i < N; i++) {
      const j = (((i + phase) % N) + N) % N;
      const j0 = Math.floor(j);
      const j1 = (j0 + 1) % N;
      const jf = j - j0;
      const v = waveAt(j0) * (1 - jf) + waveAt(j1) * jf;
      const x = padL + (i / (N - 1)) * span;
      const y = heroY - v * amp * mul * breath;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  // Detune: the same cycle sliding out of phase with itself.
  if (detNorm > 0.04) {
    const dp = detNorm * N * 0.09 + Math.sin(now * 0.0016) * detNorm * 3;
    glowStroke(ctx, () => heroPath(dp, 0.9), C_ENV, { width: 1.4, glow: 0.35, alpha: 0.2 + detNorm * 0.4 });
    glowStroke(ctx, () => heroPath(-dp * 0.7, 0.82), C_MID, { width: 1.1, glow: 0.25, alpha: 0.14 + detNorm * 0.24 });
  }

  // Hero body: filled to the scan line, then the crisp lit contour.
  ctx.save();
  ctx.translate(0, heroY);
  ctx.beginPath();
  ctx.moveTo(padL, 0);
  for (let i = 0; i < N; i++) {
    const x = padL + (i / (N - 1)) * span;
    ctx.lineTo(x, -waveAt(i) * amp * breath);
  }
  ctx.lineTo(padL + span, 0);
  ctx.closePath();
  ctx.fillStyle = cachedGrad(ctx, `oscaBody|${Hh}|${eBucket}`, (c) => {
    const g = c.createLinearGradient(0, -Hh * 0.2, 0, Hh * 0.2);
    g.addColorStop(0, hexA(C_GLOW, 0.28 + energy * 0.34));
    g.addColorStop(0.5, hexA(C, 0.12 + energy * 0.1));
    g.addColorStop(1, hexA(C_DEEP, 0.04));
    return g;
  });
  ctx.fill();
  ctx.restore();

  glowStroke(ctx, () => heroPath(0, 1), C_GLOW, {
    width: 2.5,
    glow: 0.55 + energy * 0.7,
    alpha: 0.52 + energy * 0.44,
  });

  // LFO: sparks travelling the lit cycle, direction follows polarity.
  if (lfoAbs > 0.03 && !silent) {
    lit(ctx, () => {
      const n = 4 + Math.floor(lfoAbs * 7);
      for (let s = 0; s < n; s++) {
        const u = (((s / n + hash01(s * 7.7) * 0.04 + now * 0.00045 * (1 + lfoAbs * 3.2) * (p.lfo >= 0 ? 1 : -1)) % 1) + 1) % 1;
        const x = padL + u * span;
        const y = heroY - waveAt(Math.floor(u * (N - 1))) * amp * breath;
        drawGlow(ctx, x, y, 5 + lfoAbs * 10, C_LFO, 0.3 + lfoAbs * 0.5);
      }
    });
  }

  // Live playhead — proof this is an instrument, not a plotted curve.
  const playU = ((now * 0.00035 * (1 + energy) + morph) % 1 + 1) % 1;
  const playX = padL + playU * span;
  const playY = heroY - waveAt(Math.floor(playU * (N - 1))) * amp * breath;
  ctx.fillStyle = hexA(C_GLOW, 0.24 + flash * 0.3);
  ctx.fillRect(playX - 0.5, heroY - amp * 1.05, 1, amp * 2.1);
  lit(ctx, () => drawGlow(ctx, playX, playY, 9 + flash * 6, C_GLOW, 0.7));

  // Level rail, right edge (read-only — drag zones live low and wide).
  const lvlX = W - 10;
  const lvlTop = Hh * 0.2;
  const lvlH = Hh * 0.42;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(lvlX - 3, lvlTop, 5, lvlH);
  ctx.fillStyle = hexA(C_HOT, 0.35 + lvl * 0.5);
  ctx.fillRect(lvlX - 2, lvlTop + lvlH * (1 - lvl), 3, lvlH * lvl);
  lit(ctx, () => drawGlow(ctx, lvlX - 0.5, lvlTop + lvlH * (1 - lvl), 5, C_GLOW, 0.7));

  // ── morph rail (the drag surface) ──
  for (let f = 0; f < FRAME_COUNT; f++) {
    const fx = padL + (f / (FRAME_COUNT - 1)) * span;
    ctx.fillStyle = hexA(C_GLOW, f === lo || f === hi ? 0.55 : 0.18);
    ctx.fillRect(fx - 0.5, railY - 5, 1, 5);
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padL, railY, span, 5);
  ctx.save();
  ctx.translate(padL, railY);
  ctx.fillStyle = cachedGrad(ctx, `oscaRail|${(span / 40) | 0}`, (c) => {
    const g = c.createLinearGradient(0, 0, span, 0);
    g.addColorStop(0, hexA(C_DEEP, 0.55));
    g.addColorStop(1, hexA(C_GLOW, 0.98));
    return g;
  });
  ctx.fillRect(0, 0, Math.max(2, span * morph), 5);
  ctx.restore();
  const mx = padL + morph * span;
  ctx.strokeStyle = hexA(C_GLOW, 0.3);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(mx, railY);
  ctx.lineTo(mx, heroY + amp * 0.4);
  ctx.stroke();
  ctx.setLineDash([]);
  lit(ctx, () => drawGlow(ctx, mx, railY + 2.5, 9 + flash * 6, C_GLOW, 0.85));
  ctx.fillStyle = hexA(C_GLOW, 0.98);
  ctx.beginPath();
  ctx.arc(mx, railY + 2.5, 3.4 + flash * 2, 0, Math.PI * 2);
  ctx.fill();

  pill(ctx, W * 0.5, 3, `FRAME ${lo + 1}→${hi + 1} · MORPH ${Math.round(morph * 100)}%`, C_GLOW, { glow: flash });

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  const octLabel = p.oct === 0 ? "±0" : p.oct > 0 ? `+${p.oct}` : `${p.oct}`;
  const bits: string[] = [`FRAME ${lo + 1}→${hi + 1}`];
  if (envAbs > 0.04) bits.push(`ENV ${p.env > 0 ? "+" : "−"}${Math.round(envAbs * 100)}`);
  if (lfoAbs > 0.04) bits.push(`LFO ${Math.round(lfoAbs * 100)}`);
  if (detNorm > 0.04) bits.push(`${p.detune > 0 ? "+" : ""}${Math.round(p.detune)}¢`);
  footer(
    ctx,
    W,
    Hh,
    `WAVE · ${wavetableName(p.table).toUpperCase()} · ${octLabel}oct`,
    silent ? "MUTED — raise Level" : bits.join(" · "),
    C_GLOW,
    silent ? C_MID : C_HOT,
  );
}

export function OscAStageViz() {
  const table = useFireCommandStore((s) => s.patch.oscATable);
  const level = useFireCommandStore((s) => s.patch.oscALevel);
  const pos = useFireCommandStore((s) => s.patch.oscAPos);
  const env = useFireCommandStore((s) => s.patch.oscAEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscALfo);
  const oct = useFireCommandStore((s) => s.patch.oscAOctave);
  const detune = useFireCommandStore((s) => s.patch.oscADetune);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const prevTable = useRef(table);
  const st = useRef<OscAState>({ table, level, pos, env, lfo, oct, detune, livePos: pos });
  st.current = { table, level, pos, env, lfo, oct, detune, livePos: st.current.livePos };

  useEffect(() => {
    const key = motionHash(level, pos, env, lfo, oct, detune);
    if (key !== prevKey.current || table !== prevTable.current) {
      prevKey.current = key;
      prevTable.current = table;
      flashRef.current = 1;
    }
  }, [table, level, pos, env, lfo, oct, detune]);

  const setMorphFromClientX = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const xL = 14;
      const xR = rect.width - 14;
      const t = clamp((clientX - rect.left - xL) / Math.max(1, xR - xL), 0, 1);
      setParam("oscAPos", Math.round(t * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Scrub anywhere in lower third or on the rail region
      if (y < H * 0.55) return;
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      setMorphFromClientX(e.clientX);
    },
    [setMorphFromClientX, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      setMorphFromClientX(e.clientX);
    },
    [setMorphFromClientX],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("oscAPos", DEFAULT_MORPH);
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
        paintOscA(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        // Engine-side morph is the only per-frame value the paint can't derive.
        let live = st.current.pos;
        try {
          live = activeFireEngine().getMorphPositions().a;
        } catch { /* offline / boot */ }
        st.current.livePos = live;
        return {
          flash: flashRef.current,
          active: (st.current.level ?? 0) > 0.01,
          dragging: !!dragRef.current,
          visible: visibleRef.current,
          motionKey: motionHash(
            st.current.level,
            live,
            st.current.env,
            st.current.lfo,
            st.current.oct,
            st.current.detune,
          ),
        };
      },
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, 0.48),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.07), 0 0 44px ${hexA(C, 0.24)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag lower half to morph · double-click to reset"
      role="slider"
      aria-label="OSC A morph position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos * 100)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.75) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.75) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexA(C, 0.55) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexA(C, 0.55) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.78) }}
      >
        Prime Voice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[10px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.78) }}
      >
        {Math.round(pos * (FRAME_COUNT - 1)) + 1}→{Math.min(FRAME_COUNT, Math.floor(pos * (FRAME_COUNT - 1)) + 2)} · {Math.round(pos * 100)}%
      </div>
    </div>
  );
}
