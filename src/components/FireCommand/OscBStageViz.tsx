/**
 * OSC B — Twin Voice stage visualizer.
 * Dual-phase interference identity in Signal Path Sources rose-crimson (FC.oscB).
 * Every B control paints the twin pair; morph rail is interactive.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import { FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 158;
const N = 108;
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

export function OscBStageViz() {
  const table = useFireCommandStore((s) => s.patch.oscBTable);
  const level = useFireCommandStore((s) => s.patch.oscBLevel);
  const pos = useFireCommandStore((s) => s.patch.oscBPos);
  const env = useFireCommandStore((s) => s.patch.oscBEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscBLfo);
  const oct = useFireCommandStore((s) => s.patch.oscBOctave);
  const detune = useFireCommandStore((s) => s.patch.oscBDetune);
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
      setParam("oscBPos", Math.round(t * 1000) / 1000);
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
    setParam("oscBPos", DEFAULT_MORPH);
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
        livePos = getEngine().fireCommand.getMorphPositions().b;
      } catch { /* offline / boot */ }

      ensure(p.table);
      ctx.clearRect(0, 0, W, Hh);

      const silent = p.level < 0.02;
      const energy = silent ? 0.07 : 0.2 + p.level * 0.8;
      const envAbs = Math.abs(p.env);
      const lfoAbs = Math.abs(p.lfo);
      const detNorm = Math.min(1, Math.abs(p.detune) / 50);
      const octZoom = Math.pow(2, clamp(p.oct, -2, 2) * 0.36);
      const tf = tableFlashRef.current;
      const twinGap = 6 + detNorm * 22 + Math.abs(p.oct) * 3;

      // Rose-crimson field — dual foci that separate with detune
      const cx1 = W * (0.32 + livePos * 0.2 - detNorm * 0.06);
      const cx2 = W * (0.48 + livePos * 0.28 + detNorm * 0.08);
      const bg1 = ctx.createRadialGradient(cx1, Hh * 0.38, 2, W * 0.45, Hh * 0.5, W * 0.7);
      bg1.addColorStop(0, hexAlpha(C_HOT, 0.16 + energy * 0.28 + flashRef.current * 0.26));
      bg1.addColorStop(0.5, hexAlpha(C_DEEP, 0.5));
      bg1.addColorStop(1, "rgba(4,1,2,0.98)");
      ctx.fillStyle = bg1;
      ctx.fillRect(0, 0, W, Hh);
      const bg2 = ctx.createRadialGradient(cx2, Hh * 0.48, 0, cx2, Hh * 0.48, W * 0.35);
      bg2.addColorStop(0, hexAlpha(C_TWIN, 0.14 * energy + detNorm * 0.12));
      bg2.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = bg2;
      ctx.fillRect(0, 0, W, Hh);

      // Diagonal twin hatch
      ctx.save();
      ctx.strokeStyle = hexAlpha(C_MID, 0.05 + energy * 0.04);
      ctx.lineWidth = 1;
      for (let i = -Hh; i < W + Hh; i += 7) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + Hh * 0.55, Hh);
        ctx.stroke();
      }
      ctx.restore();

      // Env polarity bloom on opposite twins
      if (envAbs > 0.02) {
        const side = p.env >= 0 ? W * 0.22 : W * 0.78;
        const rb = ctx.createRadialGradient(side, Hh * 0.4, 0, side, Hh * 0.4, Hh * 0.55);
        rb.addColorStop(0, hexAlpha(C_ENV, 0.38 * envAbs * energy));
        rb.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = rb;
        ctx.fillRect(0, 0, W, Hh);
      }

      const mid = Hh * 0.4;
      const amp = Hh * 0.26 * energy * (0.85 + flashRef.current * 0.22);
      const xL = 14;
      const xR = W - 14;
      const breath = 0.94 + 0.06 * Math.sin(now / 580);
      const lfoSpin = now * (0.0013 + lfoAbs * 0.01) * (p.lfo >= 0 ? 1 : -1);
      const beat = now * (0.002 + detNorm * 0.012);

      const cur = livePos * (FRAME_COUNT - 1);
      const lo = Math.floor(cur);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = cur - lo;

      const sample = (frame: number, i: number, phase: number) => {
        const f = cache[Math.max(0, Math.min(FRAME_COUNT - 1, frame))]!;
        const ii = (((i + phase) * octZoom) % (N - 1) + (N - 1)) % (N - 1);
        const i0 = Math.floor(ii);
        const i1 = Math.min(N - 1, i0 + 1);
        const ft = ii - i0;
        let v = f[i0]! * (1 - ft) + f[i1]! * ft;
        if (envAbs > 0.01) {
          const bend = 1 + p.env * 0.2 * Math.sign(v) * Math.abs(v);
          v *= bend;
        }
        return clamp(v, -1.4, 1.4);
      };

      const waveAt = (i: number, phase: number) =>
        sample(lo, i, phase) * (1 - frac) + sample(hi, i, phase) * frac;

      // Ghost frames — staggered twin helix
      for (const offset of [-3, -2, -1, 1, 2, 3]) {
        const fIdx = Math.max(0, Math.min(FRAME_COUNT - 1, lo + offset));
        const depth = 1 - Math.abs(offset) * 0.15;
        const helix = offset * 0.28 + lfoSpin * 0.5;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = sample(fIdx, i, 0);
          const x = xL + Math.abs(offset) * 2 + (i / (N - 1)) * (xR - xL - Math.abs(offset) * 4);
          const y = mid + Math.sin(helix + i * 0.04) * (3 + lfoAbs * 8) - v * amp * depth * 0.45 * breath;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_MID, (0.05 + energy * 0.08) * depth);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Interference fill between twin paths
      const phaseTwin = detNorm * (N * 0.12) + Math.sin(beat) * detNorm * 4;
      const ysA: number[] = [];
      const ysB: number[] = [];
      for (let i = 0; i < N; i++) {
        const vA = waveAt(i, 0);
        const vB = waveAt(i, phaseTwin);
        const x = xL + (i / (N - 1)) * (xR - xL);
        const yA = mid - twinGap * 0.5 - vA * amp * breath;
        const yB = mid + twinGap * 0.5 - vB * amp * breath;
        ysA.push(yA);
        ysB.push(yB);
        if (i === 0) {
          ctx.beginPath();
          ctx.moveTo(x, yA);
        } else ctx.lineTo(x, yA);
      }
      for (let i = N - 1; i >= 0; i--) {
        const x = xL + (i / (N - 1)) * (xR - xL);
        ctx.lineTo(x, ysB[i]!);
      }
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, mid - twinGap - amp, 0, mid + twinGap + amp);
      fill.addColorStop(0, hexAlpha(C_GLOW, (0.22 + energy * 0.28) * (0.5 + detNorm * 0.5)));
      fill.addColorStop(0.5, hexAlpha(C, 0.1 + energy * 0.12));
      fill.addColorStop(1, hexAlpha(C_TWIN, 0.18 * energy));
      ctx.fillStyle = fill;
      ctx.fill();

      // Twin strokes
      const strokeTwin = (ys: number[], color: string, width: number, alpha: number) => {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = xL + (i / (N - 1)) * (xR - xL);
          if (i === 0) ctx.moveTo(x, ys[i]!);
          else ctx.lineTo(x, ys[i]!);
        }
        ctx.strokeStyle = hexAlpha(color, alpha);
        ctx.lineWidth = width;
        ctx.shadowBlur = 10 + energy * 14 + flashRef.current * 18;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      strokeTwin(ysA, C_HOT, 2.6, 0.55 + energy * 0.4);
      strokeTwin(ysB, C_TWIN, 2.2, 0.4 + energy * 0.35 + detNorm * 0.2);

      // Beat nodes along crossings when detuned
      if (detNorm > 0.06) {
        for (let i = 2; i < N - 2; i += 3) {
          const d = Math.abs(ysA[i]! - ysB[i]!);
          if (d < 5 + detNorm * 4) {
            const x = xL + (i / (N - 1)) * (xR - xL);
            const y = (ysA[i]! + ysB[i]!) * 0.5;
            const rg = ctx.createRadialGradient(x, y, 0, x, y, 4 + detNorm * 5);
            rg.addColorStop(0, hexAlpha(C_GLOW, 0.55 * detNorm * energy));
            rg.addColorStop(1, hexAlpha(C, 0));
            ctx.fillStyle = rg;
            ctx.beginPath();
            ctx.arc(x, y, 4 + detNorm * 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // LFO orbit sparks on both twins
      if (lfoAbs > 0.03) {
        const sparkN = 3 + Math.floor(lfoAbs * 6);
        for (let s = 0; s < sparkN; s++) {
          const u = (s / sparkN + now * 0.0005 * (1 + lfoAbs * 2.8) * (p.lfo >= 0 ? 1 : -1)) % 1;
          const uu = u < 0 ? u + 1 : u;
          const i = Math.floor(uu * (N - 1));
          const x = xL + uu * (xR - xL);
          for (const y of [ysA[i]!, ysB[i]!]) {
            const rad = 3.5 + lfoAbs * 5;
            const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
            rg.addColorStop(0, hexAlpha(C_LFO, 0.55 * lfoAbs * energy));
            rg.addColorStop(1, hexAlpha(C, 0));
            ctx.fillStyle = rg;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Octave ladder ticks on left
      const ladderN = 3 + Math.abs(p.oct);
      for (let r = 0; r < ladderN; r++) {
        const ly = mid - twinGap * 0.5 - amp * 0.7 + r * ((twinGap + amp) / Math.max(1, ladderN - 1));
        ctx.strokeStyle = hexAlpha(C_MID, 0.12 + (p.oct !== 0 ? 0.1 : 0));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, ly);
        ctx.lineTo(12, ly);
        ctx.stroke();
      }

      // Spectrum stubs — denser with morph
      const partials = 4 + Math.floor(livePos * 11);
      const barBase = Hh - 36;
      for (let k = 1; k <= partials; k++) {
        const px = xL + (k / (partials + 1)) * (xR - xL);
        const hgt = (2.5 + (1 - k / partials) * 11 * energy) * (0.75 + Math.sin(now / 380 + k * 1.3) * 0.2);
        ctx.fillStyle = hexAlpha(k % 2 === 0 ? C_TWIN : C_MID, 0.12 + energy * 0.16);
        ctx.fillRect(px - 1, barBase - hgt, 2.2, hgt);
      }

      // Dual morph rail (twin markers)
      const railY = Hh - 20;
      for (let f = 0; f < FRAME_COUNT; f++) {
        const fx = xL + (f / (FRAME_COUNT - 1)) * (xR - xL);
        ctx.fillStyle = hexAlpha(C_GLOW, f === lo || f === hi ? 0.5 : 0.16);
        ctx.fillRect(fx - 0.5, railY - 5, 1, 5);
      }
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(xL, railY, xR - xL, 5);
      const fillW = (xR - xL) * livePos;
      const mg = ctx.createLinearGradient(xL, railY, xL + fillW, railY);
      mg.addColorStop(0, hexAlpha(C_DEEP, 0.5));
      mg.addColorStop(0.5, hexAlpha(C, 0.85));
      mg.addColorStop(1, hexAlpha(C_GLOW, 0.98));
      ctx.fillStyle = mg;
      ctx.shadowBlur = 10;
      ctx.shadowColor = C;
      ctx.fillRect(xL, railY, fillW, 5);
      ctx.shadowBlur = 0;

      const mx = xL + livePos * (xR - xL);
      // Twin cursors offset by detune
      const mx2 = clamp(mx + detNorm * 10 * Math.sign(p.detune || 1), xL, xR);
      for (const [x, r] of [[mx, 4], [mx2, 3]] as const) {
        ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
        ctx.shadowBlur = 12;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.arc(x, railY + 2.5, r + flashRef.current * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (detNorm > 0.05) {
        ctx.strokeStyle = hexAlpha(C_TWIN, 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, railY + 2.5);
        ctx.lineTo(mx2, railY + 2.5);
        ctx.stroke();
      }

      const beam = ctx.createLinearGradient(mx, railY, mx, mid + amp * 0.2);
      beam.addColorStop(0, hexAlpha(C_GLOW, 0.7));
      beam.addColorStop(1, hexAlpha(C, 0.04));
      ctx.strokeStyle = beam;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mx, railY);
      ctx.lineTo(mx, mid + amp * 0.2);
      ctx.stroke();

      if (tf > 0.05) {
        const wipe = ctx.createLinearGradient(0, 0, W, 0);
        wipe.addColorStop(0, hexAlpha(C_GLOW, 0));
        wipe.addColorStop(0.35, hexAlpha(C_TWIN, 0.2 * tf));
        wipe.addColorStop(0.65, hexAlpha(C_GLOW, 0.18 * tf));
        wipe.addColorStop(1, hexAlpha(C_GLOW, 0));
        ctx.fillStyle = wipe;
        ctx.fillRect(0, 0, W, Hh);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.88);
      const octLabel = p.oct === 0 ? "±0" : p.oct > 0 ? `+${p.oct}` : `${p.oct}`;
      ctx.fillText(`OSC B · ${wavetableName(p.table).toUpperCase()} · ${octLabel}oct`, 12, Hh - 6);
      ctx.textAlign = "right";
      if (silent) {
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.fillText("SILENT · drag rail to morph", W - 12, Hh - 6);
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
        active: false,
        dragging: !!dragRef.current,
        particles: 0,
        motionKey: "",
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
        borderColor: hexAlpha(C, 0.5),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.07), 0 0 40px ${hexAlpha(C, 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
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
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.75) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.75) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexAlpha(C, 0.55) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexAlpha(C, 0.55) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.78) }}
      >
        Twin Voice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {Math.round(pos * 100)}%
        {Math.abs(detune) > 0.5 ? ` · ${detune > 0 ? "+" : ""}${Math.round(detune)}¢` : ""}
      </div>
    </div>
  );
}
