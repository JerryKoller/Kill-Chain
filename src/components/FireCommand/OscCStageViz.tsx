/**
 * OSC C — Depth Voice stage visualizer.
 *
 * IDIOM: the octave lattice. The third voice is drawn as a ladder of thin
 * traces, one rung per octave register (−2 … +2), each carrying the same cycle
 * at twice the rate of the rung below it. The selected octave is the lit rung —
 * thick, filled and glowing — so the panel reads as "where in the register this
 * voice sits", which is the only thing that distinguishes C from A and B.
 *
 * Table · Morph · Env · LFO · Octave · Detune · Level (Sources · FC.oscC).
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
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 158;
const N = 128;
/** Signal Path Sources · Osc C landmark */
const C = FC.oscC;
const C_DEEP = bandShade(FC.sources, 0.28);
const C_MID = bandShade(FC.sources, 0.42);
const C_HOT = bandShade(FC.sources, 0.62);
const C_GLOW = bandShade(FC.sources, 0.86);
const C_ENV = bandShade(FC.sources, 0.5);
const C_LFO = bandShade(FC.sources, 0.7);
const C_FLOOR = bandShade(FC.sources, 0.35);

const DEFAULT_MORPH = 0.4;
/** Rungs, high register first — the ladder is read top-down like a score. */
const RUNGS = [2, 1, 0, -1, -2] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Frequency territory each rung lands in — kept from the old zone strip. */
function registerOf(oct: number): string {
  if (oct <= -2) return "SUB";
  if (oct === -1) return "SUB BODY";
  if (oct === 0) return "DEPTH BODY";
  return "MID";
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

const cycle = new Float32Array(N);

export type OscCState = {
  table: string;
  level: number;
  pos: number;
  env: number;
  lfo: number;
  oct: number;
  detune: number;
  /** Engine-side morph for C; falls back to `pos`. */
  livePos: number;
};

export function paintOscC(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: OscCState,
  now: number,
  flash: number,
): void {
  const lvl = clamp(p.level, 0, 1);
  const dormant = lvl < 0.02;
  const energy = dormant ? 0.05 : 0.18 + lvl * 0.82;
  const envAbs = Math.abs(p.env);
  const lfoAbs = Math.abs(p.lfo);
  const detNorm = Math.min(1, Math.abs(p.detune) / 50);
  const morph = clamp(p.livePos, 0, 1);
  const oct = Math.round(clamp(p.oct, -2, 2));
  const eBucket = (energy * 12) | 0;

  const frames = tableFrames(p.table);
  const cur = morph * (FRAME_COUNT - 1);
  const lo = Math.floor(cur);
  const hi = Math.min(lo + 1, FRAME_COUNT - 1);
  const frac = cur - lo;
  {
    const fLo = frames[lo]!;
    const fHi = frames[hi]!;
    const bend = envAbs > 0.01 ? p.env * 0.18 : 0;
    for (let i = 0; i < N; i++) {
      let v = fLo[i]! * (1 - frac) + fHi[i]! * frac;
      if (bend !== 0) v *= 1 + bend * Math.sign(v) * Math.abs(v);
      cycle[i] = clamp(v, -1.4, 1.4);
    }
  }

  ctx.clearRect(0, 0, W, Hh);
  // Deep register sits low, so the chamber's light pools under the ladder.
  plate(ctx, W, Hh, C, { energy, horizon: 0.78 });

  // ── ladder geometry ──
  const padL = 62;
  const padR = 86;
  const span = Math.max(60, W - padL - padR);
  const topY = Hh * 0.22;
  const ladderH = Hh * 0.5;
  const rungGap = ladderH / (RUNGS.length - 1);
  const railY = Hh - 26;
  const breath = 0.95 + 0.05 * Math.sin(now / 700);
  const yFor = (o: number) => topY + ((2 - o) / 4) * ladderH;

  /** Sampled cycle at a fractional phase (0..1 of one cycle). */
  const at = (phase: number) => {
    const j = (((phase % 1) + 1) % 1) * N;
    const j0 = Math.floor(j);
    const j1 = (j0 + 1) % N;
    const jf = j - j0;
    return cycle[j0]! * (1 - jf) + cycle[j1]! * jf;
  };

  // Rung baselines — the lattice itself, visible even when the voice is off.
  for (const o of RUNGS) {
    const y = yFor(o);
    const on = o === oct;
    ctx.fillStyle = hexA(on ? C_HOT : C_MID, on ? 0.26 : 0.1);
    ctx.fillRect(padL, y, span, 1);
    // Stringer ties at both ends make it read as one ladder, not five lines.
    ctx.fillStyle = hexA(C_DEEP, 0.3);
    ctx.fillRect(padL - 8, y - 0.5, 8, 2);
    ctx.fillRect(padL + span, y - 0.5, 8, 2);
  }
  ctx.fillStyle = hexA(C_DEEP, 0.22);
  ctx.fillRect(padL - 9, yFor(2), 2, ladderH);
  ctx.fillRect(padL + span + 7, yFor(2), 2, ladderH);

  // ── the rungs: same cycle, one octave apart per step ──
  // Idle rungs are hairlines, so they can be walked at a coarser stride.
  const drawRung = (o: number, active: boolean) => {
    const step = active ? 3 : 5;
    const y0 = yFor(o);
    const cycles = Math.pow(2, o + 2);
    const amp = active ? rungGap * 0.74 * (0.35 + energy * 0.65) * (0.94 + flash * 0.1) : rungGap * 0.24 * (0.4 + energy * 0.6);
    const phase = now * 0.0002 * cycles;

    if (active) {
      // Fill the lit rung down to its own baseline so it carries weight.
      ctx.beginPath();
      ctx.moveTo(padL, y0);
      for (let x = 0; x <= span; x += step) {
        ctx.lineTo(padL + x, y0 - at((x / span) * cycles + phase) * amp * breath);
      }
      ctx.lineTo(padL + span, y0);
      ctx.closePath();
      ctx.fillStyle = cachedGrad(ctx, `osccRung|${Hh}|${eBucket}`, (c) => {
        const g = c.createLinearGradient(0, 0, 0, Hh);
        g.addColorStop(0, hexA(C_GLOW, 0.16 + energy * 0.2));
        g.addColorStop(0.62, hexA(C_FLOOR, 0.16 + energy * 0.18));
        g.addColorStop(1, hexA(C_DEEP, 0.04));
        return g;
      });
      ctx.fill();
    }

    const path = () => {
      for (let x = 0; x <= span; x += step) {
        const xx = padL + x;
        const yy = y0 - at((x / span) * cycles + phase) * amp * breath;
        if (x === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
    };
    if (active) {
      glowStroke(ctx, path, C_GLOW, {
        width: 2.6,
        glow: 0.5 + energy * 0.7,
        alpha: (dormant ? 0.3 : 0.55) + energy * 0.4,
      });
    } else {
      ctx.strokeStyle = hexA(C_MID, 0.1 + energy * 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      path();
      ctx.stroke();
    }
  };

  for (const o of RUNGS) if (o !== oct) drawRung(o, false);
  drawRung(oct, true);

  // Detune: a second copy of the lit rung sliding out of phase.
  if (detNorm > 0.04) {
    const y0 = yFor(oct);
    const cycles = Math.pow(2, oct + 2);
    const amp = rungGap * 0.62 * (0.35 + energy * 0.65);
    const slip = detNorm * 0.18 + Math.sin(now * 0.0016) * detNorm * 0.06;
    ctx.strokeStyle = hexA(C_FLOOR, 0.3 + detNorm * 0.4);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= span; x += 4) {
      const xx = padL + x;
      const yy = y0 + 3 - at((x / span) * cycles + slip) * amp * breath;
      if (x === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }

  // LFO: a light pulse travelling the lit rung, direction from polarity.
  if (lfoAbs > 0.03 && !dormant) {
    lit(ctx, () => {
      const y0 = yFor(oct);
      const cycles = Math.pow(2, oct + 2);
      const amp = rungGap * 0.74 * (0.35 + energy * 0.65);
      const n = 3 + Math.floor(lfoAbs * 6);
      for (let s = 0; s < n; s++) {
        const u = (((s / n + now * 0.0004 * (1 + lfoAbs * 2.5) * (p.lfo >= 0 ? 1 : -1)) % 1) + 1) % 1;
        const x = padL + u * span;
        const y = y0 - at(u * cycles + now * 0.0002 * cycles) * amp * breath;
        drawGlow(ctx, x, y, 5 + lfoAbs * 10, C_LFO, 0.28 + lfoAbs * 0.42);
      }
    });
  }

  // Env polarity: lifts the ladder's light up or lets it sink.
  if (envAbs > 0.02 && !dormant) {
    lit(ctx, () => {
      const y = yFor(oct) - Math.sign(p.env) * rungGap * 1.1;
      for (let k = 0; k < 5; k++) {
        drawGlow(ctx, padL + ((k + 0.5) / 5) * span, y, 14 + envAbs * 12, C_ENV, 0.06 + envAbs * 0.14);
      }
    });
  }

  // Register gutters: octave on the left, frequency territory on the right.
  ctx.font = VIZ_FONT_LABEL;
  for (const o of RUNGS) {
    const y = yFor(o) + 3;
    const on = o === oct;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(on ? C_GLOW : C_MID, on ? 0.9 : 0.32);
    ctx.fillText(o === 0 ? "±0 OCT" : `${o > 0 ? "+" : "−"}${Math.abs(o)} OCT`, padL - 14, y);
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(on ? C_HOT : C_MID, on ? 0.8 : 0.26);
    ctx.fillText(registerOf(o), padL + span + 14, y);
  }

  // ── morph rail (the drag surface) ──
  for (let f = 0; f < FRAME_COUNT; f++) {
    const fx = padL + (f / (FRAME_COUNT - 1)) * span;
    ctx.fillStyle = hexA(C_GLOW, f === lo || f === hi ? 0.5 : 0.14);
    ctx.fillRect(fx - 0.5, railY - 5, 1, 5);
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padL, railY, span, 5);
  ctx.save();
  ctx.translate(padL, railY);
  ctx.fillStyle = cachedGrad(ctx, `osccRail|${(span / 40) | 0}`, (c) => {
    const g = c.createLinearGradient(0, 0, span, 0);
    g.addColorStop(0, hexA(C_DEEP, 0.55));
    g.addColorStop(1, hexA(C_GLOW, 0.98));
    return g;
  });
  ctx.fillRect(0, 0, Math.max(2, span * morph), 5);
  ctx.restore();
  const mx = padL + morph * span;
  ctx.strokeStyle = hexA(C_GLOW, 0.26);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(mx, railY);
  ctx.lineTo(mx, yFor(oct));
  ctx.stroke();
  ctx.setLineDash([]);
  lit(ctx, () => drawGlow(ctx, mx, railY + 2.5, 9 + flash * 6, C_GLOW, 0.85));
  ctx.fillStyle = hexA(C_GLOW, 0.95);
  ctx.beginPath();
  ctx.arc(mx, railY + 2.5, 3.4 + flash * 2, 0, Math.PI * 2);
  ctx.fill();

  pill(
    ctx,
    W * 0.5,
    3,
    `${registerOf(oct)} · MORPH ${Math.round(morph * 100)}%`,
    C_GLOW,
    { glow: flash },
  );

  // Dormant veil — C is the voice most often left at zero.
  if (dormant) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, Hh);
    ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.55 + Math.sin(now / 500) * 0.1);
    ctx.fillText("DISABLED — raise Level to wake", W * 0.5, Hh * 0.48);
  }

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  const octLabel = oct === 0 ? "±0" : oct > 0 ? `+${oct}` : `${oct}`;
  const bits: string[] = [`${Math.round(lvl * 100)}%`];
  if (envAbs > 0.04) bits.push(`ENV ${p.env > 0 ? "+" : "−"}${Math.round(envAbs * 100)}`);
  if (lfoAbs > 0.04) bits.push(`LFO ${Math.round(lfoAbs * 100)}`);
  if (detNorm > 0.04) bits.push(`${p.detune > 0 ? "+" : ""}${Math.round(p.detune)}¢`);
  footer(
    ctx,
    W,
    Hh,
    `OSC C · ${wavetableName(p.table).toUpperCase()} · ${octLabel}oct`,
    dormant ? "OFF AT 0" : bits.join(" · "),
    C_GLOW,
    dormant ? C_MID : C_HOT,
  );
}

export function OscCStageViz() {
  const table = useFireCommandStore((s) => s.patch.oscCTable);
  const level = useFireCommandStore((s) => s.patch.oscCLevel);
  const pos = useFireCommandStore((s) => s.patch.oscCPos);
  const env = useFireCommandStore((s) => s.patch.oscCEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscCLfo);
  const oct = useFireCommandStore((s) => s.patch.oscCOctave);
  const detune = useFireCommandStore((s) => s.patch.oscCDetune);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef(0);
  const prevTable = useRef(table);
  const st = useRef<OscCState>({ table, level, pos, env, lfo, oct, detune, livePos: pos });
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
      setParam("oscCPos", Math.round(t * 1000) / 1000);
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
    setParam("oscCPos", DEFAULT_MORPH);
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
        paintOscC(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        let live = st.current.pos;
        try {
          live = activeFireEngine().getMorphPositions().c;
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
        borderColor: hexA(C, level < 0.02 ? 0.28 : 0.5),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 36px ${hexA(C, level < 0.02 ? 0.08 : 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag lower half to morph · double-click to reset"
      role="slider"
      aria-label="OSC C morph position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos * 100)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexA(C, 0.55) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexA(C, 0.55) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.78) }}
      >
        Depth Voice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {oct <= -1 ? `${oct}oct · ` : ""}{Math.round(pos * 100)}%
      </div>
    </div>
  );
}
