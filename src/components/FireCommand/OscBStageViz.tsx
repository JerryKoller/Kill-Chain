/**
 * OSC B — Twin Voice stage visualizer.
 *
 * IDIOM: the twin trace. Two cycles run the full width of the letterbox — A
 * ghosted above, B solid below — and the inheritance mode IS the geometry
 * between them: mirror reflects B, offset slides it, lock welds the pair into
 * one seam, FM bends B's phase with A's instantaneous value. Coupling ties
 * stitch the two traces at intervals, and detune shows up as the pair drifting
 * out of phase with visible beat nodes where they cross.
 *
 * Table · Morph · Env · LFO · Octave · Detune · Level · Inherit (FC.oscB).
 * Drag lower half: morph. Double-click: reset morph.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import type { OscBInheritMode } from "@/audio/dsp/FireCommandSynth";
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
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 158;
const N = 128;
/** Signal Path Sources · Osc B landmark */
const C = FC.oscB;
const C_DEEP = bandShade(FC.sources, 0.18);
const C_MID = bandShade(FC.sources, 0.32);
const C_HOT = bandShade(FC.sources, 0.58);
const C_GLOW = bandShade(FC.sources, 0.82);
const C_ENV = bandShade(FC.sources, 0.48);
const C_LFO = bandShade(FC.sources, 0.64);
const C_TWIN = bandShade(FC.sources, 0.4);

const DEFAULT_MORPH = 0.4;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

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

/** Interpolate a table's current cycle into `out`. */
function resolveCycle(out: Float32Array, table: string, pos: number, zoom: number, bend: number): void {
  const frames = tableFrames(table);
  const cur = clamp(pos, 0, 1) * (FRAME_COUNT - 1);
  const lo = Math.floor(cur);
  const hi = Math.min(lo + 1, FRAME_COUNT - 1);
  const frac = cur - lo;
  const fLo = frames[lo]!;
  const fHi = frames[hi]!;
  for (let i = 0; i < N; i++) {
    const ii = (((i * zoom) % (N - 1)) + (N - 1)) % (N - 1);
    const i0 = Math.floor(ii);
    const i1 = Math.min(N - 1, i0 + 1);
    const ft = ii - i0;
    let v = (fLo[i0]! * (1 - ft) + fLo[i1]! * ft) * (1 - frac) + (fHi[i0]! * (1 - ft) + fHi[i1]! * ft) * frac;
    if (bend !== 0) v *= 1 + bend * Math.sign(v) * Math.abs(v);
    out[i] = clamp(v, -1.4, 1.4);
  }
}

const aWave = new Float32Array(N);
const bWave = new Float32Array(N);

/** How the inheritance mode draws as a relationship between the two traces. */
type Couple = {
  label: string;
  /** 0 = fused on one axis, 1 = fully separated. */
  gap: number;
  /** −1 reflects B about the coupling axis. */
  flip: number;
  /** Constant phase displacement of B, in samples. */
  shift: number;
  /** How hard A's value bends B's phase. */
  fm: number;
  /** Tie stitch strength between the traces. */
  tie: number;
  /** Mid-tie glyph. */
  glyph: "none" | "dot" | "cross" | "chevron" | "arrow";
};

function couplingOf(mode: OscBInheritMode, fmAmt: number): Couple {
  switch (mode) {
    case "morph":
      return { label: "MORPH FOLLOW", gap: 0.6, flip: 1, shift: 0, fm: 0, tie: 0.55, glyph: "dot" };
    case "family":
      return { label: "FAMILY", gap: 0.68, flip: 1, shift: 0, fm: 0, tie: 0.45, glyph: "dot" };
    case "mirror":
      return { label: "MIRROR", gap: 0.92, flip: -1, shift: 0, fm: 0, tie: 0.5, glyph: "cross" };
    case "offset":
      return { label: "OFFSET +¼", gap: 0.88, flip: 1, shift: N * 0.25, fm: 0, tie: 0.4, glyph: "arrow" };
    case "lock":
      return { label: "PHASE LOCK", gap: 0.08, flip: 1, shift: 0, fm: 0, tie: 0, glyph: "none" };
    case "fm":
      return { label: "FM A→B", gap: 0.78, flip: 1, shift: 0, fm: 0.35 + fmAmt * 0.65, tie: 0.6, glyph: "chevron" };
    default:
      return { label: "FREE TWIN", gap: 1, flip: 1, shift: 0, fm: 0, tie: 0.14, glyph: "none" };
  }
}

export type OscBState = {
  table: string;
  level: number;
  pos: number;
  env: number;
  lfo: number;
  oct: number;
  detune: number;
  aTable: string;
  aPos: number;
  inherit: OscBInheritMode;
  fmAtoB: number;
  /** Engine-side morph for B; falls back to `pos`. */
  livePos: number;
};

export function paintOscB(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: OscBState,
  now: number,
  flash: number,
): void {
  const lvl = clamp(p.level, 0, 1);
  const silent = lvl < 0.02;
  const energy = silent ? 0.07 : 0.2 + lvl * 0.8;
  const envAbs = Math.abs(p.env);
  const lfoAbs = Math.abs(p.lfo);
  const detNorm = Math.min(1, Math.abs(p.detune) / 50);
  const octZoom = Math.pow(2, clamp(p.oct, -2, 2) * 0.36);
  const morph = clamp(p.livePos, 0, 1);
  const cp = couplingOf(p.inherit, clamp(p.fmAtoB, 0, 1));
  const eBucket = (energy * 12) | 0;

  const cur = morph * (FRAME_COUNT - 1);
  const lo = Math.floor(cur);
  const hi = Math.min(lo + 1, FRAME_COUNT - 1);

  resolveCycle(aWave, p.aTable, p.aPos, 1, 0);
  resolveCycle(bWave, p.table, morph, octZoom, envAbs > 0.01 ? p.env * 0.2 : 0);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // ── geometry: one axis, two traces straddling it ──
  const padL = 30;
  const padR = 24;
  const span = Math.max(60, W - padL - padR);
  const axisY = Hh * 0.42;
  const railY = Hh - 26;
  const gap = (10 + detNorm * 14 + Math.abs(p.oct) * 2.5) + cp.gap * 26;
  const aY = axisY - gap * 0.5;
  const bY = axisY + gap * 0.5;
  const amp = Hh * 0.135 * (0.4 + energy * 0.6) * (0.94 + flash * 0.12);
  const breath = 0.95 + 0.05 * Math.sin(now / 580);
  // Detune reads as the pair sliding apart in phase, beating slowly.
  const beat = now * (0.002 + detNorm * 0.012);
  const drift = detNorm * N * 0.11 + Math.sin(beat) * detNorm * 5;

  // Coupling axis — the spine the relationship is measured against.
  ctx.fillStyle = hexA(C_MID, 0.16);
  ctx.fillRect(padL, axisY, span, 1);

  /** B's sample at output index i, after shift / drift / FM bend. */
  const bAt = (i: number) => {
    let j = i + cp.shift + drift;
    if (cp.fm > 0) j += aWave[((i % N) + N) % N]! * cp.fm * N * 0.09;
    const jj = (((j % N) + N) % N);
    const j0 = Math.floor(jj);
    const j1 = (j0 + 1) % N;
    const jf = jj - j0;
    return (bWave[j0]! * (1 - jf) + bWave[j1]! * jf) * cp.flip;
  };
  const aAt = (i: number) => aWave[((i % N) + N) % N]!;

  const xOf = (i: number) => padL + (i / (N - 1)) * span;
  const aPathY = (i: number) => aY - aAt(i) * amp * 0.82 * breath;
  const bPathY = (i: number) => bY - bAt(i) * amp * breath;

  // Interference band — the live difference between the twins.
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = xOf(i);
    if (i === 0) ctx.moveTo(x, aPathY(i));
    else ctx.lineTo(x, aPathY(i));
  }
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(xOf(i), bPathY(i));
  ctx.closePath();
  ctx.fillStyle = cachedGrad(ctx, `oscbBand|${Hh}|${eBucket}|${(detNorm * 8) | 0}`, (c) => {
    const g = c.createLinearGradient(0, Hh * 0.16, 0, Hh * 0.78);
    g.addColorStop(0, hexA(C_GLOW, (0.16 + energy * 0.22) * (0.55 + detNorm * 0.45)));
    g.addColorStop(0.5, hexA(C, 0.08 + energy * 0.12));
    g.addColorStop(1, hexA(C_TWIN, 0.14 * energy));
    return g;
  });
  ctx.fill();

  // Coupling ties — the stitch that makes the mode legible.
  if (cp.tie > 0.02) {
    const step = Math.max(6, Math.round(N / Math.max(6, Math.round(span / 58))));
    ctx.strokeStyle = hexA(C_TWIN, 0.1 + cp.tie * 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 2; i < N - 1; i += step) {
      const x = xOf(i);
      ctx.moveTo(x, aPathY(i));
      ctx.lineTo(x, bPathY(i));
    }
    ctx.stroke();
    if (cp.glyph !== "none") {
      ctx.strokeStyle = hexA(C_GLOW, 0.2 + cp.tie * 0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 2; i < N - 1; i += step) {
        const x = xOf(i);
        const my = (aPathY(i) + bPathY(i)) * 0.5;
        if (cp.glyph === "cross") {
          ctx.moveTo(x - 3, my - 3);
          ctx.lineTo(x + 3, my + 3);
          ctx.moveTo(x + 3, my - 3);
          ctx.lineTo(x - 3, my + 3);
        } else if (cp.glyph === "chevron") {
          ctx.moveTo(x - 3, my - 2);
          ctx.lineTo(x, my + 2);
          ctx.lineTo(x + 3, my - 2);
        } else if (cp.glyph === "arrow") {
          ctx.moveTo(x - 3, my);
          ctx.lineTo(x + 3, my);
          ctx.moveTo(x + 1, my - 2);
          ctx.lineTo(x + 3, my);
          ctx.lineTo(x + 1, my + 2);
        } else {
          ctx.moveTo(x - 0.8, my);
          ctx.lineTo(x + 0.8, my);
        }
      }
      ctx.stroke();
    }
  }

  // A — the reference, always dashed so it never reads as B.
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = hexA(FC.oscA, 0.3 + energy * 0.22);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = xOf(i);
    if (i === 0) ctx.moveTo(x, aPathY(i));
    else ctx.lineTo(x, aPathY(i));
  }
  ctx.stroke();
  ctx.restore();

  // B — solid, lit, the voice this panel owns.
  const bPath = () => {
    for (let i = 0; i < N; i++) {
      const x = xOf(i);
      if (i === 0) ctx.moveTo(x, bPathY(i));
      else ctx.lineTo(x, bPathY(i));
    }
  };
  glowStroke(ctx, bPath, C_HOT, {
    width: p.inherit === "lock" ? 3.4 : 2.6,
    glow: 0.5 + energy * 0.7,
    alpha: 0.55 + energy * 0.4,
  });

  // Phase-lock welds the pair: mark the fused seam instead of stitching it.
  if (p.inherit === "lock") {
    lit(ctx, () => {
      for (let k = 0; k < 9; k++) {
        const x = padL + ((k + 0.5) / 9) * span;
        drawGlow(ctx, x, axisY, 11 + energy * 8, C_GLOW, 0.16 + energy * 0.2);
      }
    });
  }

  // Beat nodes — where the twins actually collide.
  if (detNorm > 0.06) {
    lit(ctx, () => {
      for (let i = 2; i < N - 2; i += 3) {
        const ya = aPathY(i);
        const yb = bPathY(i);
        if (Math.abs(ya - yb) < 5 + detNorm * 5) {
          drawGlow(ctx, xOf(i), (ya + yb) * 0.5, 6 + detNorm * 8, C_GLOW, 0.22 * detNorm + energy * 0.16);
        }
      }
    });
  }

  // LFO sparks ride both traces.
  if (lfoAbs > 0.03 && !silent) {
    lit(ctx, () => {
      const n = 3 + Math.floor(lfoAbs * 6);
      for (let s = 0; s < n; s++) {
        const u = (((s / n + now * 0.0005 * (1 + lfoAbs * 2.8) * (p.lfo >= 0 ? 1 : -1)) % 1) + 1) % 1;
        const i = Math.floor(u * (N - 1));
        drawGlow(ctx, xOf(i), aPathY(i), 4 + lfoAbs * 7, C_LFO, 0.25 + lfoAbs * 0.4);
        drawGlow(ctx, xOf(i), bPathY(i), 5 + lfoAbs * 9, C_LFO, 0.3 + lfoAbs * 0.45);
      }
    });
  }

  // Trace tags, set against the traces they name.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(FC.oscA, 0.5);
  // Held below the eyebrow row however wide the coupling gap opens.
  ctx.fillText("A REF", padL, Math.max(30, aY - amp * 0.9 - 4));
  ctx.fillStyle = hexA(C_GLOW, 0.75);
  ctx.fillText("B", padL, bY + amp * 0.9 + 10);

  // Octave ladder ticks — register offset of the twin.
  const ladderN = 3 + Math.abs(p.oct);
  for (let r = 0; r < ladderN; r++) {
    const ly = aY - amp * 0.8 + r * ((gap + amp * 1.6) / Math.max(1, ladderN - 1));
    ctx.fillStyle = hexA(C_MID, 0.12 + (p.oct !== 0 ? 0.12 : 0));
    ctx.fillRect(8, ly, 7, 1);
  }

  // ── morph rail (the drag surface), twin cursors offset by detune ──
  for (let f = 0; f < FRAME_COUNT; f++) {
    const fx = padL + (f / (FRAME_COUNT - 1)) * span;
    ctx.fillStyle = hexA(C_GLOW, f === lo || f === hi ? 0.5 : 0.16);
    ctx.fillRect(fx - 0.5, railY - 5, 1, 5);
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padL, railY, span, 5);
  ctx.save();
  ctx.translate(padL, railY);
  ctx.fillStyle = cachedGrad(ctx, `oscbRail|${(span / 40) | 0}`, (c) => {
    const g = c.createLinearGradient(0, 0, span, 0);
    g.addColorStop(0, hexA(C_DEEP, 0.5));
    g.addColorStop(0.5, hexA(C, 0.85));
    g.addColorStop(1, hexA(C_GLOW, 0.98));
    return g;
  });
  ctx.fillRect(0, 0, Math.max(2, span * morph), 5);
  ctx.restore();

  const mx = padL + morph * span;
  const mx2 = clamp(mx + detNorm * 12 * Math.sign(p.detune || 1), padL, padL + span);
  if (detNorm > 0.05) {
    ctx.strokeStyle = hexA(C_TWIN, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, railY + 2.5);
    ctx.lineTo(mx2, railY + 2.5);
    ctx.stroke();
  }
  lit(ctx, () => {
    drawGlow(ctx, mx, railY + 2.5, 9 + flash * 6, C_GLOW, 0.85);
    if (detNorm > 0.05) drawGlow(ctx, mx2, railY + 2.5, 7, C_TWIN, 0.6);
  });
  ctx.fillStyle = hexA(C_GLOW, 0.95);
  ctx.beginPath();
  ctx.arc(mx, railY + 2.5, 3.6 + flash * 2, 0, Math.PI * 2);
  ctx.fill();
  if (detNorm > 0.05) {
    ctx.fillStyle = hexA(C_TWIN, 0.9);
    ctx.beginPath();
    ctx.arc(mx2, railY + 2.5, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  pill(ctx, W * 0.5, 3, cp.label, C_GLOW, { glow: flash });

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  const octLabel = p.oct === 0 ? "±0" : p.oct > 0 ? `+${p.oct}` : `${p.oct}`;
  const bits: string[] = [`${Math.round(lvl * 100)}%`];
  if (envAbs > 0.04) bits.push(`ENV ${p.env > 0 ? "+" : "−"}${Math.round(envAbs * 100)}`);
  if (lfoAbs > 0.04) bits.push(`LFO ${Math.round(lfoAbs * 100)}`);
  if (detNorm > 0.04) bits.push(`${p.detune > 0 ? "+" : ""}${Math.round(p.detune)}¢`);
  footer(
    ctx,
    W,
    Hh,
    `OSC B · ${wavetableName(p.table).toUpperCase()} · ${octLabel}oct`,
    silent ? "SILENT · drag rail to morph" : bits.join(" · "),
    C_GLOW,
    silent ? C_MID : C_HOT,
  );
}

export function OscBStageViz() {
  const table = useFireCommandStore((s) => s.patch.oscBTable);
  const level = useFireCommandStore((s) => s.patch.oscBLevel);
  const pos = useFireCommandStore((s) => s.patch.oscBPos);
  const env = useFireCommandStore((s) => s.patch.oscBEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscBLfo);
  const oct = useFireCommandStore((s) => s.patch.oscBOctave);
  const detune = useFireCommandStore((s) => s.patch.oscBDetune);
  const aTable = useFireCommandStore((s) => s.patch.oscATable);
  const aPos = useFireCommandStore((s) => s.patch.oscAPos);
  const inherit = useFireCommandStore((s) => s.patch.oscBInherit) ?? "off";
  const fmAtoB = useFireCommandStore((s) => s.patch.fmAtoB) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const prevMode = useRef(`${table}|${inherit}`);
  const st = useRef<OscBState>({
    table, level, pos, env, lfo, oct, detune, aTable, aPos, inherit, fmAtoB, livePos: pos,
  });
  st.current = {
    table, level, pos, env, lfo, oct, detune, aTable, aPos, inherit, fmAtoB,
    livePos: st.current.livePos,
  };

  useEffect(() => {
    const key = motionHash(level, pos, env, lfo, oct, detune, fmAtoB);
    const mode = `${table}|${inherit}`;
    if (key !== prevKey.current || mode !== prevMode.current) {
      prevKey.current = key;
      prevMode.current = mode;
      flashRef.current = 1;
    }
  }, [table, level, pos, env, lfo, oct, detune, inherit, fmAtoB]);

  const setMorphFromClientX = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const xL = 14;
      const xR = rect.width - 14;
      const t = clamp((clientX - rect.left - xL) / Math.max(1, xR - xL), 0, 1);
      setParam("oscBPos", Math.round(t * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
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
    setParam("oscBPos", DEFAULT_MORPH);
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
        paintOscB(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        let live = st.current.pos;
        try {
          live = activeFireEngine().getMorphPositions().b;
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
            st.current.aPos,
            st.current.fmAtoB,
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
        borderColor: hexA(C, 0.5),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.07), 0 0 40px ${hexA(C, 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag lower half to morph · double-click to reset"
      role="slider"
      aria-label="OSC B morph position"
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
        Twin Voice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {Math.round(pos * 100)}%
        {Math.abs(detune) > 0.5 ? ` · ${detune > 0 ? "+" : ""}${Math.round(detune)}¢` : ""}
      </div>
    </div>
  );
}
