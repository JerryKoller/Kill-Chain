/**
 * OSC A — Prime Voice stage visualizer.
 * Every oscillator-A control (table, morph, env, lfo, octave, detune, level)
 * paints the crimson Signal Path identity. Morph rail is interactive.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 158;
const N = 112;
const C = FC.oscA;
const C_DEEP = bandShade(FC.sources, 0.08);
const C_MID = bandShade(FC.sources, 0.38);
const C_HOT = bandShade(FC.sources, 0.68);
const C_GLOW = bandShade(FC.sources, 0.88);
const C_ENV = bandShade(FC.sources, 0.55);
const C_LFO = bandShade(FC.sources, 0.72);

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

export function OscAStageViz() {
  const table = useFireCommandStore((s) => s.patch.oscATable);
  const level = useFireCommandStore((s) => s.patch.oscALevel);
  const pos = useFireCommandStore((s) => s.patch.oscAPos);
  const env = useFireCommandStore((s) => s.patch.oscAEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscALfo);
  const oct = useFireCommandStore((s) => s.patch.oscAOctave);
  const detune = useFireCommandStore((s) => s.patch.oscADetune);
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
      setParam("oscAPos", Math.round(t * 1000) / 1000);
    },
    [setParam],
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
    setParam("oscAPos", DEFAULT_MORPH);
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
        livePos = activeFireEngine().getMorphPositions().a;
      } catch { /* offline / boot */ }

      ensure(p.table);
      ctx.clearRect(0, 0, W, Hh);

      const silent = p.level < 0.02;
      const energy = silent ? 0.08 : 0.22 + p.level * 0.78;
      const envAbs = Math.abs(p.env);
      const lfoAbs = Math.abs(p.lfo);
      const detNorm = Math.min(1, Math.abs(p.detune) / 50);
      const octZoom = Math.pow(2, clamp(p.oct, -2, 2) * 0.38);
      const tf = tableFlashRef.current;

      // Crimson nebula background — pivots with morph
      const cx = W * (0.28 + livePos * 0.44);
      const bg = ctx.createRadialGradient(cx, Hh * 0.4, 2, W * 0.5, Hh * 0.52, W * 0.78);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.18 + energy * 0.32 + flashRef.current * 0.3 + tf * 0.35));
      bg.addColorStop(0.4, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(3,0,1,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Scanlines
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      for (let y = 0; y < Hh; y += 3) ctx.fillRect(0, y, W, 1);

      // Octave rings — expand/contract with pitch register
      const ringN = 2 + Math.abs(p.oct);
      for (let r = 0; r < ringN; r++) {
        const radius = 18 + r * (10 + Math.abs(p.oct) * 3) + (p.oct >= 0 ? r * 2 : 0);
        ctx.beginPath();
        ctx.arc(W * 0.5, Hh * 0.42, radius * (0.9 + energy * 0.15), 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(C_MID, 0.06 + energy * 0.08 + (p.oct !== 0 ? 0.05 : 0));
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Env bloom — polarity chooses side + warps mid
      if (envAbs > 0.02) {
        const side = p.env >= 0 ? W * 0.1 : W * 0.9;
        const rb = ctx.createRadialGradient(side, Hh * 0.45, 0, side, Hh * 0.45, Hh * 0.62);
        rb.addColorStop(0, hexAlpha(C_ENV, 0.4 * envAbs * energy));
        rb.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = rb;
        ctx.fillRect(0, 0, W, Hh);
      }

      const mid = Hh * 0.42;
      const amp = Hh * 0.28 * energy * (0.85 + flashRef.current * 0.25);
      const xL = 14;
      const xR = W - 14;
      const breath = 0.94 + 0.06 * Math.sin(now / 620);
      const lfoSpin = now * (0.0011 + lfoAbs * 0.009) * (p.lfo >= 0 ? 1 : -1);
      const envWarp = p.env * 0.22;

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
        // Env bends wave asymmetrically (positive = brighten peaks, negative = fold)
        if (envAbs > 0.01) {
          const bend = 1 + envWarp * Math.sign(v) * Math.abs(v);
          v *= bend;
        }
        return clamp(v, -1.4, 1.4);
      };

      const detPhase = detNorm * Math.PI * 0.6;

      // Ghost frame helix
      for (const offset of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        const fIdx = Math.max(0, Math.min(FRAME_COUNT - 1, lo + offset));
        const depth = 1 - Math.abs(offset) * 0.13;
        const helix = offset * 0.22 + lfoSpin * 0.45;
        const yShift = Math.sin(helix) * (4 + lfoAbs * 12) + offset * 2.1;
        const xInset = Math.abs(offset) * 2.4 + Math.abs(Math.cos(helix)) * (2 + envAbs * 5);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = sample(fIdx, i);
          const x = xL + xInset + (i / (N - 1)) * (xR - xL - xInset * 2);
          const y = mid + yShift - v * amp * depth * 0.52 * breath;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_MID, (0.06 + energy * 0.09) * depth);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const drawWave = (phaseOff: number, alphaMul: number, width: number, fill: boolean, tint = C_HOT) => {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          let v: number;
          if (phaseOff === 0) {
            v = sample(lo, i) * (1 - frac) + sample(hi, i) * frac;
          } else {
            const j = i + (phaseOff / (Math.PI * 2)) * N;
            const j0 = Math.floor(((j % N) + N) % N);
            const j1 = (j0 + 1) % N;
            const jf = ((j % N) + N) % N - j0;
            const u0 = sample(lo, j0) * (1 - frac) + sample(hi, j0) * frac;
            const u1 = sample(lo, j1) * (1 - frac) + sample(hi, j1) * frac;
            v = u0 * (1 - jf) + u1 * jf;
          }
          const x = xL + (i / (N - 1)) * (xR - xL);
          const y = mid - v * amp * breath;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (fill) {
          ctx.lineTo(xR, mid + amp * 0.42);
          ctx.lineTo(xL, mid + amp * 0.42);
          ctx.closePath();
          const glow = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
          glow.addColorStop(0, hexAlpha(C_GLOW, (0.3 + energy * 0.38) * alphaMul));
          glow.addColorStop(0.55, hexAlpha(C, 0.14 * alphaMul));
          glow.addColorStop(1, hexAlpha(C_DEEP, 0.02));
          ctx.fillStyle = glow;
          ctx.fill();
        } else {
          ctx.strokeStyle = hexAlpha(tint, (0.48 + energy * 0.48) * alphaMul);
          ctx.lineWidth = width;
          ctx.shadowBlur = 12 + energy * 18 + flashRef.current * 22;
          ctx.shadowColor = C;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      };

      drawWave(0, 1, 2.6, true);
      if (detNorm > 0.04) {
        drawWave(detPhase, 0.32 + detNorm * 0.5, 1.5, false, C_ENV);
        drawWave(-detPhase * 0.7, 0.18 + detNorm * 0.25, 1.1, false, C_MID);
      }
      drawWave(0, 1, 2.9, false);

      // LFO sparks ride the wave
      if (lfoAbs > 0.03) {
        const sparkN = 4 + Math.floor(lfoAbs * 7);
        for (let s = 0; s < sparkN; s++) {
          const u = (s / sparkN + now * 0.00045 * (1 + lfoAbs * 3.2) * (p.lfo >= 0 ? 1 : -1) + s * 0.07) % 1;
          const uu = u < 0 ? u + 1 : u;
          const i = Math.floor(uu * (N - 1));
          const v0 = sample(lo, i) * (1 - frac) + sample(hi, i) * frac;
          const x = xL + uu * (xR - xL);
          const y = mid - v0 * amp * breath;
          const rad = 4 + lfoAbs * 7;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
          rg.addColorStop(0, hexAlpha(C_LFO, 0.65 * lfoAbs * energy));
          rg.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Harmonic spectrum bars under the wave — morph shifts density
      const partials = 5 + Math.floor(livePos * 12);
      const barBase = Hh - 36;
      for (let k = 1; k <= partials; k++) {
        const px = xL + (k / (partials + 1)) * (xR - xL);
        const hgt = (3 + (1 - k / partials) * 12 * energy) * (0.7 + Math.sin(now / 400 + k) * 0.15);
        ctx.fillStyle = hexAlpha(C_MID, 0.1 + energy * 0.18);
        ctx.fillRect(px - 1, barBase - hgt, 2.5, hgt);
      }

      // Frame tick marks
      const railY = Hh - 20;
      for (let f = 0; f < FRAME_COUNT; f++) {
        const fx = xL + (f / (FRAME_COUNT - 1)) * (xR - xL);
        ctx.fillStyle = hexAlpha(C_GLOW, f === lo || f === hi ? 0.55 : 0.18);
        ctx.fillRect(fx - 0.5, railY - 5, 1, 5);
      }

      // Morph rail
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
      const beam = ctx.createLinearGradient(mx, railY, mx, mid + amp * 0.25);
      beam.addColorStop(0, hexAlpha(C_GLOW, 0.75));
      beam.addColorStop(1, hexAlpha(C, 0.04));
      ctx.strokeStyle = beam;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(mx, railY);
      ctx.lineTo(mx, mid + amp * 0.25);
      ctx.stroke();

      ctx.fillStyle = hexAlpha(C_GLOW, 0.98);
      ctx.shadowBlur = 14;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(mx, railY + 2.5, 4 + flashRef.current * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Table-change wipe
      if (tf > 0.05) {
        const wipe = ctx.createLinearGradient(0, 0, W, 0);
        wipe.addColorStop(0, hexAlpha(C_GLOW, 0));
        wipe.addColorStop(0.5, hexAlpha(C_GLOW, 0.22 * tf));
        wipe.addColorStop(1, hexAlpha(C_GLOW, 0));
        ctx.fillStyle = wipe;
        ctx.fillRect(0, 0, W, Hh);
      }

      // Telemetry — operational size bumped; no duplicate Level %
      ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.92);
      const octLabel = p.oct === 0 ? "±0" : p.oct > 0 ? `+${p.oct}` : `${p.oct}`;
      ctx.fillText(`WAVE · ${wavetableName(p.table).toUpperCase()} · ${octLabel}oct`, 12, Hh - 6);
      ctx.textAlign = "right";
      if (silent) {
        ctx.fillStyle = hexAlpha(C_MID, 0.6);
        ctx.fillText("MUTED — raise Level", W - 12, Hh - 6);
      } else {
        const bits: string[] = [`FRAME ${lo + 1}→${hi + 1}`];
        if (envAbs > 0.04) bits.push(`ENV ${p.env > 0 ? "+" : "−"}${Math.round(envAbs * 100)}`);
        if (lfoAbs > 0.04) bits.push(`LFO ${Math.round(lfoAbs * 100)}`);
        if (detNorm > 0.04) bits.push(`${p.detune > 0 ? "+" : ""}${Math.round(p.detune)}¢`);
        ctx.fillStyle = hexAlpha(C_HOT, 0.9);
        ctx.fillText(bits.join(" · "), W - 12, Hh - 6);
      }

      // Live playhead — establishes this is a live instrument, not a static curve
      const playU = (now * 0.00035 * (1 + energy) + livePos) % 1;
      const playX = xL + playU * (xR - xL);
      const playI = Math.floor(playU * (N - 1));
      const playV = sample(lo, playI) * (1 - frac) + sample(hi, playI) * frac;
      const playY = mid - playV * amp * breath;
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.55 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(playX, mid - amp * 0.95);
      ctx.lineTo(playX, mid + amp * 0.55);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_HOT, 0.95);
      ctx.beginPath();
      ctx.arc(playX, playY, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();

      // Frame interpolation caption on canvas
      ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.fillText(`FRAME ${lo + 1} → ${hi + 1}   MORPH ${Math.round(livePos * 100)}%`, W * 0.5, 18);
    
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
        borderColor: hexAlpha(C, 0.48),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.07), 0 0 44px ${hexAlpha(C, 0.24)}, 0 10px 28px rgba(0,0,0,0.4)`,
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
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.75) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.75) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexAlpha(C, 0.55) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexAlpha(C, 0.55) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.78) }}
      >
        Prime Voice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[10px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.78) }}
      >
        {Math.round(pos * (FRAME_COUNT - 1)) + 1}→{Math.min(FRAME_COUNT, Math.floor(pos * (FRAME_COUNT - 1)) + 2)} · {Math.round(pos * 100)}%
      </div>
    </div>
  );
}

const DEFAULT_MORPH = 0.66;
