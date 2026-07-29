/**
 * PLUCK — Vactrol Strike stage visualizer.
 * LPG: on · decay · color · vel (Signal Path Tone · FC.pluck).
 * Drag: Decay ↔ / Color ↕. Bottom rail: Vel. Click: strike flash. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useToneTelemetry } from "./useToneTelemetry";

const H = 176;
const C = FC.pluck;
const C_DEEP = bandShade(FC.tone, 0.18);
const C_MID = bandShade(FC.tone, 0.38);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.92);
const C_DEC = bandShade(FC.tone, 0.48);
const C_COL = bandShade(FC.tone, 0.68);
const C_VEL = bandShade(FC.tone, 0.85);

const DEC_MIN = 0.05;
const DEC_MAX = 2.5;

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

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
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

type DragMode = "xy" | "vel" | null;

export function PluckStageViz() {
  const on = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const decay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const color = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  
  const tel = useToneTelemetry();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const strikeRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ on, decay, color, vel });
  st.current = { on, decay, color, vel };

  useEffect(() => {
    const key = `${on}|${decay.toFixed(3)}|${color.toFixed(3)}|${vel.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
      if (on) strikeRef.current = 1;
    }
  }, [on, decay, color, vel]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("lpgDecay", Math.round(logLerp(x, DEC_MIN, DEC_MAX) * 1000) / 1000);
      setParam("lpgColor", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyVel = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("velAmount", Math.round(x * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "vel";
        wrap.setPointerCapture(e.pointerId);
        applyVel(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
      strikeRef.current = 1;
      flashRef.current = 1;
    },
    [applyXy, applyVel],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "vel") applyVel(e.clientX);
    },
    [applyXy, applyVel],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("lpgDecay", 0.4);
    setParam("lpgColor", 0.7);
    setParam("velAmount", 1);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const rings: Array<{ birth: number }> = [];
    const sparks: Array<{ x: number; y: number; life: number; ang: number; spd: number }> = [];
    let autoStrike = 0;

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;
      strikeRef.current *= 0.92;

      const decayN = logNorm(p.decay, DEC_MIN, DEC_MAX);
      const energy = p.on ? 0.28 + p.color * 0.35 + p.vel * 0.15 + flashRef.current * 0.25 : 0.08;
      const cx = W * 0.5;
      const cy = Hh * 0.42;

      ctx.clearRect(0, 0, W, Hh);

      // Warm Tone gold iris chamber
      const bg = ctx.createRadialGradient(cx, cy, 4, W * 0.5, Hh * 0.5, W * 0.75);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.35 + strikeRef.current * 0.3));
      bg.addColorStop(0.5, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(6,4,1,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Auto strike pulse when LPG on
      if (p.on && now - autoStrike > 380 + p.decay * 700) {
        autoStrike = now;
        rings.push({ birth: now });
        if (rings.length > 6) rings.shift();
        strikeRef.current = Math.max(strikeRef.current, 0.85);
        for (let i = 0; i < 6 + Math.round(p.color * 8); i++) {
          sparks.push({
            x: cx,
            y: cy,
            life: 1,
            ang: Math.random() * Math.PI * 2,
            spd: 1.5 + Math.random() * 3 + p.color * 2,
          });
        }
      }

      const age = p.on ? Math.min(1, (now - autoStrike) / (180 + p.decay * 900)) : 1;
      const bright = p.on ? (1 - age) * (0.45 + p.color * 0.55) * (0.55 + p.vel * 0.45) : 0.08;

      // Rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]!;
        const rAge = Math.min(1, (now - ring.birth) / (260 + p.decay * 850));
        if (rAge >= 1) {
          rings.splice(i, 1);
          continue;
        }
        const rRad = 14 + rAge * (48 + p.decay * 40 + p.color * 20);
        ctx.strokeStyle = hexAlpha(C_GLOW, (1 - rAge) * (0.28 + p.color * 0.4));
        ctx.lineWidth = 2.2 - rAge;
        ctx.shadowBlur = 8 + (1 - rAge) * 10;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.arc(cx, cy, rRad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Dual curve: amp (top) + filter brightness (lower ghost) — color spreads them
      const PAD = 16;
      const curveTop = Hh * 0.62;
      const curveH = Hh * 0.22;
      const usableW = W - PAD * 2;
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const t = i / 80;
        const env = Math.exp(-t * (1.1 + (1 - decayN) * 4.2));
        const x = PAD + t * usableW;
        const y = curveTop + (1 - env * (0.5 + p.vel * 0.5)) * curveH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, p.on ? 0.75 : 0.2);
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = p.on ? 10 : 0;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Filter-color ghost (lags slightly — vactrol lag)
      if (p.on && p.color > 0.04) {
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const t = i / 80;
          const env = Math.exp(-t * (1.1 + (1 - decayN) * 4.2) * 0.85) * p.color;
          const x = PAD + t * usableW;
          const y = curveTop + 6 + (1 - env * (0.45 + p.vel * 0.4)) * curveH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_COL, 0.45 + p.color * 0.4);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Iris aperture
      const rad = 12 + (p.on ? age * (28 + p.decay * 38) : 8) + strikeRef.current * 10;
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.5);
      coreGlow.addColorStop(0, hexAlpha(C_GLOW, bright * 0.95 + flashRef.current * 0.3));
      coreGlow.addColorStop(0.35, hexAlpha(C_HOT, bright * 0.55));
      coreGlow.addColorStop(0.7, hexAlpha(C_COL, bright * 0.2 * p.color));
      coreGlow.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 1.5, 0, Math.PI * 2);
      ctx.fill();

      const blades = 8 + Math.round(p.color * 4);
      for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2 + now * 0.0008 * (0.5 + p.color);
        const r1 = rad * 0.18;
        const r2 = rad * (0.42 + age * 0.18 + p.color * 0.1);
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.25 + bright * 0.5);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Core
      ctx.fillStyle = hexAlpha("#fff8e0", bright * 0.8 + 0.12 + strikeRef.current * 0.4);
      ctx.shadowBlur = 10 + bright * 16 + strikeRef.current * 12;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 + bright * 3.5 + strikeRef.current * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.028;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += Math.cos(s.ang) * s.spd;
        s.y += Math.sin(s.ang) * s.spd;
        ctx.fillStyle = hexAlpha(C_HOT, s.life * 0.75);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + p.color, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crosshair for decay/color
      const hx = logNorm(p.decay, DEC_MIN, DEC_MAX) * W;
      const hy = (1 - p.color) * (Hh * 0.7);
      ctx.strokeStyle = hexAlpha(C_GLOW, p.on ? 0.4 + flashRef.current * 0.3 : 0.12);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_HOT, 0.8);
      ctx.beginPath();
      ctx.arc(hx, hy, 3 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Left meters DEC / COL / VEL
      const meters: Array<{ v: number; col: string; label: string }> = [
        { v: decayN, col: C_DEC, label: "DC" },
        { v: p.color, col: C_COL, label: "CL" },
        { v: p.vel, col: C_VEL, label: "VL" },
      ];
      meters.forEach((m, i) => {
        const my = 28 + i * 32;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(10, my, 8, 26);
        const fillH = 26 * clamp(m.v, 0, 1);
        const g = ctx.createLinearGradient(10, my + 26, 10, my + 26 - fillH);
        g.addColorStop(0, hexAlpha(m.col, 0.35));
        g.addColorStop(1, hexAlpha(m.col, 0.95));
        ctx.fillStyle = g;
        ctx.shadowBlur = m.v > 0.05 ? 6 : 0;
        ctx.shadowColor = m.col;
        ctx.fillRect(10, my + 26 - fillH, 8, fillH);
        ctx.shadowBlur = 0;
        ctx.fillStyle = hexAlpha(m.col, 0.6);
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(m.label, 22, my + 24);
      });

      const telData = tel.pluck;
      const active = tel.voiceCount > 0;
      let stageName = "SLEEP";
      if (p.on && telData) {
        if (!active && telData.stage === "idle") stageName = "ARMED";
        else if (telData.stage === "strike") stageName = "STRIKE";
        else if (telData.stage === "ring") stageName = "RING";
        else if (telData.stage === "decay_out" || telData.stage === "release") stageName = "DECAY";
        else if (active) stageName = String(telData.stage).toUpperCase();
        else stageName = "ARMED";
      }

      if (!p.on) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, Hh - 24);
        ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.5 + Math.sin(now / 500) * 0.12);
        ctx.fillText("SLEEP · DSP DISABLED", W * 0.5, Hh * 0.38);
      } else if (p.on && active && telData) {
        ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
        ctx.fillText(`◉ ${stageName}`, 14, Math.max(12, (typeof top === "number" ? top : 24) - 8));
      }

      // Vel rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_VEL, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const velW = (W - 24) * p.vel;
      if (p.vel > 0.01) {
        const vg = ctx.createLinearGradient(12, railY, 12 + velW, railY);
        vg.addColorStop(0, hexAlpha(C_HOT, 0.4));
        vg.addColorStop(1, hexAlpha(C_VEL, 0.95));
        ctx.fillStyle = vg;
        ctx.shadowBlur = 8;
        ctx.shadowColor = C;
        ctx.fillRect(12, railY, velW, 7);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + velW, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_VEL, 0.7);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("VEL", 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("PLUCK · VACTROL STRIKE", 12, Hh - 2);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C_HOT, 0.88);
      if (p.on) {
        ctx.fillText(`${Math.round(p.decay * 1000)}ms · C${Math.round(p.color * 100)} · V${Math.round(p.vel * 100)}`, W - 12, Hh - 2);
      } else {
        ctx.fillText("ADSR MODE", W - 12, Hh - 2);
      }
    
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.on,
        dragging: !!dragRef.current,
        particles: sparks.length,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, on ? 0.55 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, on ? 0.28 : 0.08)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Decay ↔ / Color ↕ · Bottom: Vel · Click: strike · Double-click: defaults"
      role="img"
      aria-label="Pluck gate vactrol strike"
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
        Vactrol Strike
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        {(() => {
          if (!on) return "SLEEP";
          const telData = tel.pluck;
          const active = tel.voiceCount > 0;
          if (!active || !telData) return "ARMED";
          if (telData.stage === "strike") return "STRIKE";
          if (telData.stage === "ring") return "RING";
          if (telData.stage === "decay_out" || telData.stage === "release") return "DECAY";
          return "ARMED";
        })()}
      </div>
    </div>
  );
}
