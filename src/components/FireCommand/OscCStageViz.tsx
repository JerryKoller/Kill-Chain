/**
 * OSC C — Depth Voice stage visualizer.
 * Subterranean third oscillator in Signal Path Sources (FC.oscC).
 * Stratified floor layers; every C control paints the depth stack.
 * Morph rail is interactive. Level 0 = dormant shadow state.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 158;
const N = 104;
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

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function useHiDpi(
  wrapRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  cssH: number,
  sizeRef: MutableRefObject<{ w: number; h: number }>,
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wrapRef, canvasRef, cssH, sizeRef]);
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const tableFlashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef("");
  const prevTable = useRef(table);
  const st = useRef({ table, level, pos, env, lfo, oct, detune });
  st.current = { table, level, pos, env, lfo, oct, detune };

  useEffect(() => {
    const key = `${table}|${level.toFixed(3)}|${pos.toFixed(3)}|${env.toFixed(3)}|${lfo.toFixed(3)}|${oct}|${detune}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
    if (table !== prevTable.current) {
      prevTable.current = table;
      tableFlashRef.current = 1;
    }
  }, [table, level, pos, env, lfo, oct, detune]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

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
    [setParam],
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
    [setMorphFromClientX],
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
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("oscCPos", DEFAULT_MORPH);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const cache: Float32Array[] = [];
    let cacheTable = "";
    const ensure = (id: string) => {
      if (cacheTable === id && cache.length) return;
      cache.length = 0;
      for (let i = 0; i < FRAME_COUNT; i++) cache.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
      cacheTable = id;
    };

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.88;
      tableFlashRef.current *= 0.92;

      let livePos = p.pos;
      try {
        livePos = activeFireEngine().getMorphPositions().c;
      } catch { /* offline / boot */ }

      ensure(p.table);
      ctx.clearRect(0, 0, W, Hh);

      const dormant = p.level < 0.02;
      const energy = dormant ? 0.05 : 0.18 + p.level * 0.82;
      const envAbs = Math.abs(p.env);
      const lfoAbs = Math.abs(p.lfo);
      const detNorm = Math.min(1, Math.abs(p.detune) / 50);
      // Lower octave sinks the stack; higher lifts it
      const depthBias = (-clamp(p.oct, -2, 2) + 2) / 4; // -2 → 1, +2 → 0
      const octZoom = Math.pow(2, clamp(p.oct, -2, 2) * 0.34);
      const tf = tableFlashRef.current;
      const strata = 3 + Math.abs(p.oct) + (detNorm > 0.1 ? 1 : 0);

      // Depth well — glow sits low
      const floorY = Hh * (0.55 + depthBias * 0.12);
      const bg = ctx.createLinearGradient(0, 0, 0, Hh);
      bg.addColorStop(0, "rgba(2,0,1,0.98)");
      bg.addColorStop(0.35, hexAlpha(C_DEEP, 0.35 + energy * 0.15));
      bg.addColorStop(0.72, hexAlpha(C_FLOOR, 0.22 + energy * 0.35 + flashRef.current * 0.2));
      bg.addColorStop(1, hexAlpha(C_HOT, 0.08 + energy * 0.2));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Floor bloom under morph
      const fx = W * (0.25 + livePos * 0.5);
      const floorGlow = ctx.createRadialGradient(fx, floorY, 2, fx, floorY, W * 0.45);
      floorGlow.addColorStop(0, hexAlpha(C_GLOW, (dormant ? 0.04 : 0.2) + energy * 0.35 + flashRef.current * 0.25));
      floorGlow.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = floorGlow;
      ctx.fillRect(0, 0, W, Hh);

      // Sediment strata lines
      for (let s = 0; s < strata; s++) {
        const sy = Hh * 0.22 + s * ((Hh * 0.55) / strata) + depthBias * 8;
        ctx.strokeStyle = hexAlpha(C_MID, 0.06 + energy * 0.06 + (s === strata - 1 ? 0.08 : 0));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, sy);
        ctx.lineTo(W - 8, sy);
        ctx.stroke();
      }

      if (envAbs > 0.02) {
        const rise = p.env >= 0 ? Hh * 0.25 : Hh * 0.75;
        const rb = ctx.createRadialGradient(W * 0.5, rise, 0, W * 0.5, rise, Hh * 0.5);
        rb.addColorStop(0, hexAlpha(C_ENV, 0.35 * envAbs * energy));
        rb.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = rb;
        ctx.fillRect(0, 0, W, Hh);
      }

      const mid = Hh * (0.38 + depthBias * 0.1);
      const amp = Hh * 0.24 * energy * (0.85 + flashRef.current * 0.22);
      const xL = 14;
      const xR = W - 14;
      const breath = 0.94 + 0.06 * Math.sin(now / 700);
      const lfoSpin = now * (0.001 + lfoAbs * 0.008) * (p.lfo >= 0 ? 1 : -1);

      const cur = livePos * (FRAME_COUNT - 1);
      const lo = Math.floor(cur);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = cur - lo;

      const sample = (frame: number, i: number) => {
        const f = cache[Math.max(0, Math.min(FRAME_COUNT - 1, frame))]!;
        const ii = ((i * octZoom) % (N - 1) + (N - 1)) % (N - 1);
        const i0 = Math.floor(ii);
        const i1 = Math.min(N - 1, i0 + 1);
        const ft = ii - i0;
        let v = f[i0]! * (1 - ft) + f[i1]! * ft;
        if (envAbs > 0.01) {
          v *= 1 + p.env * 0.18 * Math.sign(v) * Math.abs(v);
        }
        return clamp(v, -1.4, 1.4);
      };

      const waveAt = (i: number) => sample(lo, i) * (1 - frac) + sample(hi, i) * frac;

      // Stacked depth ghosts — sink below mid
      const layers = Math.max(2, Math.min(6, 2 + Math.abs(p.oct) + Math.floor(detNorm * 2)));
      for (let L = layers; L >= 1; L--) {
        const depth = L / layers;
        const yOff = L * (5 + depthBias * 4 + detNorm * 3);
        const xInset = L * 2.5;
        const helix = lfoSpin * 0.35 + L * 0.4;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = waveAt(i);
          const x = xL + xInset + (i / (N - 1)) * (xR - xL - xInset * 2);
          const y = mid + yOff + Math.sin(helix + i * 0.05) * (2 + lfoAbs * 6) - v * amp * (1.1 - depth * 0.55) * breath;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(L === 1 ? C_HOT : C_MID, (0.08 + energy * 0.12) * (1.2 - depth));
        ctx.lineWidth = L === 1 ? 1.4 : 1;
        ctx.stroke();
      }

      // Primary wave + underglow fill toward floor
      ctx.beginPath();
      const ys: number[] = [];
      for (let i = 0; i < N; i++) {
        const v = waveAt(i);
        const x = xL + (i / (N - 1)) * (xR - xL);
        const y = mid - v * amp * breath;
        ys.push(y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xR, Hh - 28);
      ctx.lineTo(xL, Hh - 28);
      ctx.closePath();
      const under = ctx.createLinearGradient(0, mid - amp, 0, Hh - 20);
      under.addColorStop(0, hexAlpha(C_GLOW, (0.28 + energy * 0.35) * (dormant ? 0.25 : 1)));
      under.addColorStop(0.55, hexAlpha(C_FLOOR, 0.16 * energy));
      under.addColorStop(1, hexAlpha(C_DEEP, 0.02));
      ctx.fillStyle = under;
      ctx.fill();

      // Detune: second submerged ghost
      if (detNorm > 0.04) {
        const phase = detNorm * N * 0.1;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const j = (i + phase) % N;
          const j0 = Math.floor(j);
          const j1 = (j0 + 1) % N;
          const jf = j - j0;
          const v = waveAt(j0) * (1 - jf) + waveAt(j1) * jf;
          const x = xL + (i / (N - 1)) * (xR - xL);
          const y = mid + 4 + detNorm * 8 - v * amp * breath * 0.85;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_FLOOR, 0.35 + detNorm * 0.4);
        ctx.lineWidth = 1.6;
        ctx.shadowBlur = 8;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = xL + (i / (N - 1)) * (xR - xL);
        if (i === 0) ctx.moveTo(x, ys[i]!);
        else ctx.lineTo(x, ys[i]!);
      }
      ctx.strokeStyle = hexAlpha(C_HOT, (dormant ? 0.25 : 0.5) + energy * 0.45);
      ctx.lineWidth = 2.7;
      ctx.shadowBlur = 12 + energy * 16 + flashRef.current * 20;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // LFO bubbles rising from floor
      if (lfoAbs > 0.03 && !dormant) {
        const n = 3 + Math.floor(lfoAbs * 6);
        for (let s = 0; s < n; s++) {
          const u = (s / n + now * 0.00035 * (1 + lfoAbs * 2.5)) % 1;
          const x = xL + ((u + s * 0.13) % 1) * (xR - xL);
          const rise = Hh - 30 - u * (Hh * 0.45 + lfoAbs * 20);
          const rad = 2.5 + lfoAbs * 4 * (1 - u);
          const rg = ctx.createRadialGradient(x, rise, 0, x, rise, rad);
          rg.addColorStop(0, hexAlpha(C_LFO, 0.5 * lfoAbs * energy * (1 - u)));
          rg.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(x, rise, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Harmonic stubs anchored to floor
      const partials = 4 + Math.floor(livePos * 10);
      for (let k = 1; k <= partials; k++) {
        const px = xL + (k / (partials + 1)) * (xR - xL);
        const hgt = (3 + (1 - k / partials) * 14 * energy) * (0.6 + depthBias * 0.4);
        ctx.fillStyle = hexAlpha(C_MID, 0.1 + energy * 0.18);
        ctx.fillRect(px - 1, Hh - 34 - hgt, 2.4, hgt);
      }

      // Morph rail on the floor
      const railY = Hh - 20;
      for (let f = 0; f < FRAME_COUNT; f++) {
        const fxx = xL + (f / (FRAME_COUNT - 1)) * (xR - xL);
        ctx.fillStyle = hexAlpha(C_GLOW, f === lo || f === hi ? 0.5 : 0.14);
        ctx.fillRect(fxx - 0.5, railY - 5, 1, 5);
      }
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(xL, railY, xR - xL, 5);
      const fillW = (xR - xL) * livePos;
      const mg = ctx.createLinearGradient(xL, railY, xL + fillW, railY);
      mg.addColorStop(0, hexAlpha(C_DEEP, 0.55));
      mg.addColorStop(1, hexAlpha(C_GLOW, 0.98));
      ctx.fillStyle = mg;
      ctx.shadowBlur = 10;
      ctx.shadowColor = C;
      ctx.fillRect(xL, railY, fillW, 5);
      ctx.shadowBlur = 0;

      const mx = xL + livePos * (xR - xL);
      const beam = ctx.createLinearGradient(mx, railY, mx, mid);
      beam.addColorStop(0, hexAlpha(C_GLOW, 0.65));
      beam.addColorStop(1, hexAlpha(C, 0.03));
      ctx.strokeStyle = beam;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mx, railY);
      ctx.lineTo(mx, mid);
      ctx.stroke();

      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 12;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(mx, railY + 2.5, 3.8 + flashRef.current * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Dormant veil
      if (dormant) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, Hh);
        ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + Math.sin(now / 500) * 0.1);
        ctx.fillText("DISABLED — raise Level to wake", W * 0.5, Hh * 0.48);
      }

      // Frequency territory — Depth body vs Sub bedrock
      {
        const zoneY = 22;
        const zones = [
          { label: "SUB", w: 0.18, col: FC.sub },
          { label: "DEPTH BODY", w: 0.32, col: C },
          { label: "MID", w: 0.5, col: C_MID },
        ];
        let zx = 12;
        for (const z of zones) {
          const zw = (W - 24) * z.w;
          ctx.fillStyle = hexAlpha(z.col, dormant ? 0.08 : 0.14);
          ctx.fillRect(zx, zoneY, zw - 2, 10);
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(z.col, 0.55);
          ctx.textAlign = "center";
          ctx.fillText(z.label, zx + zw / 2, zoneY + 8);
          zx += zw;
        }
      }

      if (tf > 0.05) {
        const wipe = ctx.createLinearGradient(0, 0, 0, Hh);
        wipe.addColorStop(0, hexAlpha(C_GLOW, 0));
        wipe.addColorStop(0.7, hexAlpha(C_FLOOR, 0.22 * tf));
        wipe.addColorStop(1, hexAlpha(C_GLOW, 0.15 * tf));
        ctx.fillStyle = wipe;
        ctx.fillRect(0, 0, W, Hh);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.88);
      const octLabel = p.oct === 0 ? "±0" : p.oct > 0 ? `+${p.oct}` : `${p.oct}`;
      ctx.fillText(`OSC C · ${wavetableName(p.table).toUpperCase()} · ${octLabel}oct`, 12, Hh - 6);
      ctx.textAlign = "right";
      if (dormant) {
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.fillText("OFF AT 0", W - 12, Hh - 6);
      } else {
        const bits: string[] = [`${Math.round(p.level * 100)}%`];
        if (envAbs > 0.04) bits.push(`ENV ${p.env > 0 ? "+" : "−"}${Math.round(envAbs * 100)}`);
        if (lfoAbs > 0.04) bits.push(`LFO ${Math.round(lfoAbs * 100)}`);
        if (detNorm > 0.04) bits.push(`${p.detune > 0 ? "+" : ""}${Math.round(p.detune)}¢`);
        ctx.fillStyle = hexAlpha(C_HOT, 0.85);
        ctx.fillText(bits.join(" · "), W - 12, Hh - 6);
      }
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.level ?? 0) > 0.01,
        dragging: !!dragRef.current,
        particles: 0,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, level < 0.02 ? 0.28 : 0.5),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 36px ${hexAlpha(C, level < 0.02 ? 0.08 : 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
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
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexAlpha(C, 0.55) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexAlpha(C, 0.55) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.78) }}
      >
        Depth Voice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {oct <= -1 ? `${oct}oct · ` : ""}{Math.round(pos * 100)}%
      </div>
    </div>
  );
}
