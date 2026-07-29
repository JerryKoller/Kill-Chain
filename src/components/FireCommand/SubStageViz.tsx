/**
 * SUB — Tectonic stage visualizer.
 * Foundation oscillator under the Sources stack (Signal Path · FC.sub).
 * Wave · octave · level. Drag vertically for level; wave shapes react.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { SubWave } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 158;
const C = FC.sub;
const C_DEEP = bandShade(FC.sources, 0.55);
const C_MID = bandShade(FC.sources, 0.68);
const C_HOT = bandShade(FC.sources, 0.82);
const C_GLOW = bandShade(FC.sources, 0.94);
const C_FLOOR = bandShade(FC.sources, 0.48);

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

function waveAt(wave: SubWave, u: number): number {
  if (wave === "sine") return Math.sin(u);
  if (wave === "triangle") return (2 / Math.PI) * Math.asin(Math.sin(u));
  if (wave === "square") return Math.sin(u) > 0 ? 1 : -1;
  // sawtooth
  return 2 * ((u / (Math.PI * 2)) % 1) - 1;
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

export function SubStageViz() {
  const level = useFireCommandStore((s) => s.patch.subLevel) ?? 0;
  const wave = useFireCommandStore((s) => s.patch.subWave) ?? "sine";
  const oct = useFireCommandStore((s) => s.patch.subOctave ?? -1);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef("");
  const st = useRef({ level, wave, oct });
  st.current = { level, wave, oct };

  const silent = level < 0.02;

  useEffect(() => {
    const key = `${level.toFixed(3)}|${wave}|${oct}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [level, wave, oct]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const setLevelFromClientY = useCallback(
    (clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      setParam("subLevel", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
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
        const octs = [-2, -1, 0] as const;
        const idx = Math.min(2, Math.floor(x * 3));
        setParam("subOctave", octs[idx]!);
        return;
      }
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      setLevelFromClientY(e.clientY);
    },
    [setLevelFromClientY, setParam],
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
  }, []);

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
      const p = st.current;
      flashRef.current *= 0.88;

      const lvl = clamp(p.level, 0, 1);
      const dormant = lvl < 0.02;
      const energy = dormant ? 0.08 : 0.22 + lvl * 0.78;
      const depthBias = (-clamp(p.oct, -2, 0) + 0) / 2; // -2→1, 0→0
      const cycles = 1.5 + Math.abs(p.oct) * 0.85;

      ctx.clearRect(0, 0, W, Hh);

      // Molten foundation — Sources light coral
      const cy = Hh * (0.48 + depthBias * 0.08);
      const bg = ctx.createRadialGradient(W * 0.5, cy, 4, W * 0.5, Hh * 0.55, W * 0.72);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.14 + energy * 0.3 + flashRef.current * 0.28));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(4,1,2,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Tectonic strata
      const strata = 2 + Math.abs(p.oct);
      for (let s = 0; s < strata; s++) {
        const sy = Hh * 0.2 + s * ((Hh * 0.5) / strata) + depthBias * 10;
        ctx.strokeStyle = hexAlpha(C_MID, 0.06 + energy * 0.06);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, sy);
        ctx.lineTo(W - 8, sy);
        ctx.stroke();
      }

      // Floor bloom
      const floorGlow = ctx.createRadialGradient(W * 0.5, Hh * 0.88, 2, W * 0.5, Hh * 0.88, W * 0.4);
      floorGlow.addColorStop(0, hexAlpha(C_FLOOR, (dormant ? 0.04 : 0.22) + energy * 0.25 + flashRef.current * 0.15));
      floorGlow.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = floorGlow;
      ctx.fillRect(0, 0, W, Hh);

      const mid = Hh * (0.42 + depthBias * 0.06);
      const amp = Hh * 0.26 * energy * (0.85 + flashRef.current * 0.2);
      const phase = now * 0.0018 * (1 + Math.abs(p.oct) * 0.15);
      const breath = 0.94 + 0.06 * Math.sin(now / 700);

      // Ghost undertow harmonics
      for (let h = 2; h <= 4; h++) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const u = (x / W) * cycles * h * Math.PI * 2 + phase * h;
          const y = mid + waveAt("sine", u) * amp * (0.18 / h) * breath;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_MID, (0.06 + energy * 0.1) / h);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Under-fill toward floor
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const u = (x / W) * cycles * Math.PI * 2 + phase;
        const y = mid + waveAt(p.wave, u) * amp * breath;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(W, Hh - 22);
      ctx.lineTo(0, Hh - 22);
      ctx.closePath();
      const under = ctx.createLinearGradient(0, mid - amp, 0, Hh - 20);
      under.addColorStop(0, hexAlpha(C_GLOW, (0.25 + energy * 0.35) * (dormant ? 0.2 : 1)));
      under.addColorStop(0.55, hexAlpha(C_FLOOR, 0.14 * energy));
      under.addColorStop(1, hexAlpha(C_DEEP, 0.02));
      ctx.fillStyle = under;
      ctx.fill();

      // Main tectonic wave
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const u = (x / W) * cycles * Math.PI * 2 + phase;
        const y = mid + waveAt(p.wave, u) * amp * breath;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, (dormant ? 0.25 : 0.5) + energy * 0.45);
      ctx.lineWidth = 2.8;
      ctx.shadowBlur = 12 + energy * 16 + flashRef.current * 18;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Peak rumble nodes
      if (lvl > 0.12) {
        const peaks = Math.max(2, Math.floor(cycles + 1));
        for (let i = 0; i < peaks; i++) {
          const px = ((i + 0.5) / peaks) * W;
          const u = (px / W) * cycles * Math.PI * 2 + phase;
          const py = mid + waveAt(p.wave, u) * amp * breath;
          const pulse = 0.55 + 0.45 * Math.sin(now * 0.004 + i);
          const rg = ctx.createRadialGradient(px, py, 0, px, py, 7 + lvl * 8);
          rg.addColorStop(0, hexAlpha(C_HOT, 0.4 * pulse * lvl));
          rg.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(px, py, 7 + lvl * 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Floor shimmer
      if (lvl > 0.06) {
        for (let i = 0; i < 18; i++) {
          const x = (i / 18) * W + Math.sin(now * 0.003 + i) * 6;
          const y = Hh * 0.86 + Math.cos(now * 0.0025 + i * 1.2) * 3;
          ctx.fillStyle = hexAlpha(C_HOT, 0.08 + lvl * 0.18);
          ctx.fillRect(x, y, 2.5, 2.5);
        }
      }

      // Octave rail
      const railY = Hh - 18;
      const octs = [-2, -1, 0] as const;
      for (let i = 0; i < 3; i++) {
        const x0 = (i / 3) * W + 4;
        const x1 = ((i + 1) / 3) * W - 4;
        const on = p.oct === octs[i];
        ctx.fillStyle = on ? hexAlpha(C_HOT, 0.35 + energy * 0.25) : "rgba(255,255,255,0.04)";
        ctx.fillRect(x0, railY, x1 - x0, 8);
        if (on) {
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.7);
          ctx.lineWidth = 1;
          ctx.strokeRect(x0, railY, x1 - x0, 8);
        }
        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = on ? hexAlpha(C_GLOW, 0.95) : hexAlpha(C_MID, 0.45);
        ctx.fillText(`${octs[i]}`, (x0 + x1) / 2, railY + 6.5);
      }

      // Level needle on right
      const meterTop = 28;
      const meterH = Hh - 52;
      const lx = W - 14;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(lx, meterTop, 5, meterH);
      const lh = meterH * lvl;
      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.shadowBlur = 8;
      ctx.shadowColor = C;
      ctx.fillRect(lx, meterTop + meterH - lh, 5, lh);
      ctx.shadowBlur = 0;

      if (dormant) {
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        ctx.fillRect(0, 0, W, Hh - 20);
        ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.5 + Math.sin(now / 520) * 0.1);
        ctx.fillText("FOUNDATION OFF · drag up to wake", W * 0.5, Hh * 0.45);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText(`SUB · ${p.wave.toUpperCase()} · ${p.oct}oct`, 12, Hh - 4);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C_HOT, dormant ? 0.45 : 0.85);
      ctx.fillText(dormant ? "OFF" : `${Math.round(lvl * 100)}%`, W - 22, Hh - 4);
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.level ?? 0) > 0.02,
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
        borderColor: hexAlpha(C, silent ? 0.28 : 0.5),
        height: H,
        cursor: "ns-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexAlpha(C, silent ? 0.08 : 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
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
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexAlpha(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexAlpha(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.78) }}
      >
        Tectonic
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {silent ? "OFF" : `${oct}oct · ${Math.round(level * 100)}%`}
      </div>
    </div>
  );
}
