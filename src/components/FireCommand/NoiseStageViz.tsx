/**
 * NOISE — Grain Storm stage visualizer.
 * Noise bed level + spectral tilt (Signal Path Sources · FC.noise).
 * Chip noise mode shapes grit. Drag: Color ↔ / Level ↕.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ChipNoiseMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 158;
const C = FC.noise;
const C_DEEP = bandShade(FC.sources, 0.5);
const C_MID = bandShade(FC.sources, 0.62);
const C_HOT = bandShade(FC.sources, 0.78);
const C_GLOW = bandShade(FC.sources, 0.92);
const C_DARK = bandShade(FC.sources, 0.38);
const C_BRIGHT = bandShade(FC.sources, 0.85);

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

function gritSize(mode: ChipNoiseMode): number {
  if (mode === "periodic") return 3.2;
  if (mode === "nes") return 2.6;
  if (mode === "gb") return 1.8;
  return 1.15;
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

export function NoiseStageViz() {
  const level = useFireCommandStore((s) => s.patch.noiseLevel) ?? 0;
  const color = useFireCommandStore((s) => s.patch.noiseColor) ?? 0;
  const mode = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const stormMode = useFireCommandStore((s) => s.patch.noiseMode) ?? "bed";
  const density = useFireCommandStore((s) => s.patch.noiseDensity) ?? 0.45;
  const grain = useFireCommandStore((s) => s.patch.noiseGrain) ?? 0.35;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["noise"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<"xy" | "grain" | null>(null);
  const prevKey = useRef("");
  const st = useRef({ level, color, mode, stormMode, density, grain, enabled });
  st.current = { level, color, mode, stormMode, density, grain, enabled };

  const silent = !enabled || level < 0.02;

  useEffect(() => {
    const key = `${enabled ? 1 : 0}|${level.toFixed(3)}|${color.toFixed(3)}|${mode}|${stormMode}|${density.toFixed(3)}|${grain.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [enabled, level, color, mode, stormMode, density, grain]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyFromPointer = useCallback(
    (clientX: number, clientY: number, kind: "xy" | "grain") => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (kind === "grain") {
        setParam("noiseDensity", Math.round(x * 1000) / 1000);
        setParam("noiseGrain", Math.round((1 - y) * 1000) / 1000);
        return;
      }
      // X → color (−1..1), Y → level (1 at top) — particle editor mapping
      setModuleEnable("noise", true);
      setParam("noiseColor", Math.round((x * 2 - 1) * 1000) / 1000);
      setParam("noiseLevel", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, setModuleEnable],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const kind = e.shiftKey || e.clientY - rect.top > H * 0.82 ? "grain" : "xy";
      dragRef.current = kind;
      wrap.setPointerCapture(e.pointerId);
      applyFromPointer(e.clientX, e.clientY, kind);
    },
    [applyFromPointer],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyFromPointer(e.clientX, e.clientY, dragRef.current);
    },
    [applyFromPointer],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("noiseLevel", 0);
    setParam("noiseColor", 0);
    setParam("noiseDensity", 0.45);
    setParam("noiseGrain", 0.35);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const particles = Array.from({ length: 96 }, () => ({
      x: Math.random(),
      y: Math.random(),
      age: Math.random(),
      speed: 0.018 + Math.random() * 0.045,
      size: 0.6 + Math.random() * 2,
    }));

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.88;

      const lvl = clamp(p.level, 0, 1);
      const tilt = clamp(p.color, -1, 1);
      const dens = clamp(p.density ?? 0.45, 0, 1);
      const grain = clamp(p.grain ?? 0.35, 0, 1);
      const storm = p.stormMode ?? "bed";
      const dormant = lvl < 0.02;
      const energy = dormant ? 0.08 : 0.2 + lvl * 0.8;
      const szBase = gritSize(p.mode) * (0.55 + grain * 1.1);

      ctx.clearRect(0, 0, W, Hh);

      // Storm field — pivots with color
      const cx = W * (0.5 + tilt * 0.18);
      const cy = Hh * (0.55 - tilt * 0.12);
      const bg = ctx.createRadialGradient(cx, cy, 4, W * 0.5, Hh * 0.5, W * 0.75);
      bg.addColorStop(0, hexAlpha(tilt >= 0 ? C_BRIGHT : C_DARK, 0.12 + energy * 0.28 + flashRef.current * 0.25));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(3,1,2,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Spectral bands: dark sinks low, bright rises high
      if (Math.abs(tilt) > 0.04) {
        const band = ctx.createLinearGradient(0, 0, 0, Hh);
        if (tilt < 0) {
          band.addColorStop(0, hexAlpha(C_DARK, 0));
          band.addColorStop(0.65, hexAlpha(C_DARK, 0.08 * Math.abs(tilt)));
          band.addColorStop(1, hexAlpha(C_DARK, 0.35 * Math.abs(tilt) * energy));
        } else {
          band.addColorStop(0, hexAlpha(C_BRIGHT, 0.32 * tilt * energy));
          band.addColorStop(0.4, hexAlpha(C_HOT, 0.1 * tilt));
          band.addColorStop(1, hexAlpha(C, 0));
        }
        ctx.fillStyle = band;
        ctx.fillRect(0, 0, W, Hh);
      }

      // Living grain storm — density drives count; grain drives size
      const densN = Math.floor((storm === "bed" ? 40 : storm === "burst" ? 55 : 70) + dens * 280 * lvl);
      const breathe = 0.88 + 0.12 * Math.sin(now * 0.003);
      for (let i = 0; i < densN; i++) {
        if (storm === "storm" && Math.random() > 0.35 + dens * 0.55) continue;
        if (storm === "burst" && Math.sin(now * 0.008 + i) < 0.15) continue;
        const x = Math.random() * W;
        const yBias =
          tilt < 0
            ? Math.pow(Math.random(), 1.55)
            : tilt > 0
              ? 1 - Math.pow(Math.random(), 1.55)
              : Math.random();
        const y = yBias * Hh;
        const shimmer = 0.15 + lvl * 0.7 + Math.sin((x + y) * 0.04 + now * 0.004) * 0.12;
        const sz = szBase * (0.7 + Math.random() * 0.8);
        const col = tilt < -0.15 ? C_DARK : tilt > 0.15 ? C_BRIGHT : C_MID;
        ctx.fillStyle = hexAlpha(col, shimmer * breathe * (dormant ? 0.25 : 1));
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        if (lvl > 0.35 && shimmer > 0.72) {
          ctx.fillStyle = hexAlpha(C_GLOW, 0.1 * lvl);
          ctx.fillRect(x - sz * 2, y - 1, sz * 4, 2);
        }
      }

      // Drift motes
      particles.forEach((pt) => {
        pt.age += pt.speed * (0.25 + lvl * 0.85);
        if (pt.age > 1) {
          pt.age = 0;
          pt.y = tilt < 0 ? 0.05 : tilt > 0 ? 0.95 : Math.random();
          pt.x = Math.random();
        }
        const x = pt.x * W;
        const drift = tilt * 0.2;
        const y = clamp((pt.y + (tilt < 0 ? pt.age : tilt > 0 ? -pt.age : pt.age * 0.3) + drift * pt.age * 0.2), 0, 1) * Hh;
        const life = 1 - pt.age;
        const alpha = life * (dormant ? 0.08 : lvl * 0.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, pt.size * 4);
        g.addColorStop(0, hexAlpha(C_GLOW, alpha * 0.85));
        g.addColorStop(0.45, hexAlpha(C_HOT, alpha * 0.35));
        g.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, pt.size * 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // Spectrum tilt meter (left)
      const meterX = 10;
      const meterTop = 28;
      const meterH = Hh - 48;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(meterX, meterTop, 6, meterH);
      const mg = ctx.createLinearGradient(0, meterTop, 0, meterTop + meterH);
      mg.addColorStop(0, hexAlpha(C_BRIGHT, 0.9));
      mg.addColorStop(0.5, hexAlpha(C_MID, 0.5));
      mg.addColorStop(1, hexAlpha(C_DARK, 0.9));
      ctx.fillStyle = mg;
      ctx.fillRect(meterX, meterTop, 6, meterH);
      const needleY = meterTop + ((1 - tilt) / 2) * meterH;
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8;
      ctx.shadowColor = C;
      ctx.fillRect(meterX - 2, needleY - 1.5, 10, 3);
      ctx.shadowBlur = 0;

      // Level bar (right)
      const lx = W - 16;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(lx, meterTop, 6, meterH);
      const lh = meterH * lvl;
      const lg = ctx.createLinearGradient(0, meterTop + meterH - lh, 0, meterTop + meterH);
      lg.addColorStop(0, hexAlpha(C_GLOW, 0.95));
      lg.addColorStop(1, hexAlpha(C_DEEP, 0.5));
      ctx.fillStyle = lg;
      ctx.shadowBlur = 8;
      ctx.shadowColor = C;
      ctx.fillRect(lx, meterTop + meterH - lh, 6, lh);
      ctx.shadowBlur = 0;

      // Crosshair at color/level position
      const hx = ((tilt + 1) / 2) * W;
      const hy = (1 - lvl) * Hh;
      ctx.strokeStyle = hexAlpha(C_GLOW, dormant ? 0.15 : 0.4 + flashRef.current * 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_HOT, 0.85);
      ctx.beginPath();
      ctx.arc(hx, hy, 2.8 + flashRef.current * 2, 0, Math.PI * 2);
      ctx.fill();

      // Filter type badge
      const filtLabel = tilt < -0.08 ? "LP DARK" : tilt > 0.08 ? "HP BRIGHT" : "FLAT";
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55);
      ctx.fillText(filtLabel, W * 0.5, 18);

      if (dormant) {
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        ctx.fillRect(0, 0, W, Hh);
        ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.5 + Math.sin(now / 500) * 0.1);
        ctx.fillText("MUTED — drag up to raise storm", W * 0.5, Hh * 0.5);
      }

      ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      const stormLabel = storm === "bed" ? "BED" : storm === "burst" ? "BURST" : "STORM";
      const modeLabel = p.mode === "periodic" ? "PER" : p.mode === "nes" ? "HOLD" : p.mode === "gb" ? "SOFT" : "WHT";
      ctx.fillText(`NOISE · ${stormLabel} · ${modeLabel}`, 12, Hh - 6);
      ctx.textAlign = "right";
      if (dormant) {
        ctx.fillStyle = hexAlpha(C_MID, 0.5);
        ctx.fillText("OFF", W - 12, Hh - 6);
      } else {
        ctx.fillStyle = hexAlpha(C_HOT, 0.85);
        ctx.fillText(
          `${Math.round(lvl * 100)}% · ${tilt > 0 ? "+" : ""}${Math.round(tilt * 100)}`,
          W - 12,
          Hh - 6,
        );
      }
    
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
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexAlpha(C, silent ? 0.08 : 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Color ↔ / Level ↕ · Shift or bottom: Density ↔ / Grain ↕ · Double-click: silence"
      role="img"
      aria-label="Noise bed grain storm"
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
        Grain Storm
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {!enabled ? "ASLEEP" : silent ? "SILENT" : `${Math.round(level * 100)}%`}
      </div>
    </div>
  );
}
