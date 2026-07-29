/**
 * Delay — Ping Cascade stage visualizer.
 * Time · Feedback · Mix (Signal Path FX · FC.delay).
 * Drag: Time ↔ / Feedback ↕. Bottom: Mix. Double-click: cycle mix 0→50→100.
 * R delay line runs 1.5× L (matches DSP ping-pong).
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { DelayCascadeMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.delay;
const C_DEEP = bandShade(FC.fx, 0.36);
const C_MID = bandShade(FC.fx, 0.52);
const C_HOT = bandShade(FC.fx, 0.7);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_TIME = bandShade(FC.fx, 0.58);
const C_FBK = bandShade(FC.fx, 0.72);
const C_MIX = bandShade(FC.fx, 0.86);
const C_L = bandShade(FC.fx, 0.6);
const C_R = bandShade(FC.fx, 0.8);

const TIME_MIN = 0.01;
const TIME_MAX = 1.5;
const FBK_MAX = 0.92;
const MIX_CYCLE = [0, 0.5, 1] as const;

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

function fmtTime(v: number) {
  return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
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

type DragMode = "xy" | "mix" | null;

export function DelayStageViz() {
  const time = useFireCommandStore((s) => s.patch.delayTime) ?? 0.28;
  const fbk = useFireCommandStore((s) => s.patch.delayFeedback) ?? 0.3;
  const mix = useFireCommandStore((s) => s.patch.delayMix) ?? 0;
  const cascade = (useFireCommandStore((s) => s.patch.delayCascadeMode) ?? "echo") as DelayCascadeMode;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ time, fbk, mix, cascade });
  st.current = { time, fbk, mix, cascade };

  const live = mix > 0.02;

  useEffect(() => {
    const key = `${time.toFixed(3)}|${fbk.toFixed(3)}|${mix.toFixed(3)}|${cascade}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [time, fbk, mix, cascade]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("delayTime", Math.round(logLerp(x, TIME_MIN, TIME_MAX) * 1000) / 1000);
      setParam("delayFeedback", Math.round((1 - y) * FBK_MAX * 1000) / 1000);
    },
    [setParam],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("delayMix", Math.round(x * 1000) / 1000);
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
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "mix") applyMix(e.clientX);
    },
    [applyXy, applyMix],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const m = st.current.mix;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < MIX_CYCLE.length; i++) {
      const d = Math.abs(MIX_CYCLE[i]! - m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setParam("delayMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const trails: Array<{ x: number; y: number; life: number; isL: boolean }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const timeN = logNorm(p.time, TIME_MIN, TIME_MAX);
      const fbkN = p.fbk / FBK_MAX;
      const isLive = p.mix > 0.02;
      const energy = 0.1 + p.mix * 0.42 + fbkN * 0.22 + flashRef.current * 0.25;
      const PAD = 14;
      const usable = W - PAD * 2;
      const stageH = Hh * 0.72;
      const mode = p.cascade ?? "echo";
      const rRatio = mode === "bounce" ? 1.5 : mode === "dub" ? 1.35 : 1.5;
      const timeR = p.time * rRatio;
      // Cascade layout: slap = tight lanes, bounce = crossed, long/infinite = wide spacing
      const laneSpread = mode === "slap" ? 0.18 : mode === "long" || mode === "infinite" ? 0.28 : 0.22;
      const laneL = stageH * (0.5 - laneSpread);
      const laneR = stageH * (0.5 + laneSpread);
      const echoes = mode === "infinite" ? 10 : mode === "slap" ? 2 : 1 + Math.round(p.fbk * 8);
      const spacing = mode === "slap" ? 0.05 : mode === "long" || mode === "infinite" ? 0.1 + timeN * 0.2 : 0.06 + timeN * 0.16;
      const phase = (now / (480 + p.time * 1100)) % 1;

      // Tap node positions (time on X, level/brightness from feedback)
      const tapLX = PAD + timeN * usable * 0.72;
      const tapRX = PAD + logNorm(clamp(timeR, TIME_MIN, TIME_MAX * 1.5), TIME_MIN, TIME_MAX * 1.5) * usable * 0.72;
      const tapBright = 0.35 + fbkN * 0.65;

      ctx.clearRect(0, 0, W, Hh);

      // Violet cascade chamber
      const bg = ctx.createRadialGradient(W * (0.2 + timeN * 0.4), Hh * 0.4, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.08 + energy * 0.38 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(5,2,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Mode chip early
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_TIME, 0.7);
      ctx.textAlign = "left";
      ctx.fillText(mode.toUpperCase(), PAD, 20);

      // Time grid ghosts
      const gridDivs = Math.max(3, Math.round(3 + (1 - timeN) * 8));
      for (let g = 1; g < gridDivs; g++) {
        const gx = PAD + (g / gridDivs) * usable;
        ctx.strokeStyle = hexAlpha(C_MID, 0.05 + p.mix * 0.08);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(gx, 8);
        ctx.lineTo(gx, stageH - 4);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // L/R lanes
      ctx.strokeStyle = hexAlpha(C_L, 0.2 + p.mix * 0.2);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD, laneL);
      ctx.lineTo(W - PAD, laneL);
      ctx.stroke();
      ctx.strokeStyle = hexAlpha(C_R, 0.2 + p.mix * 0.2);
      ctx.beginPath();
      ctx.moveTo(PAD, laneR);
      ctx.lineTo(W - PAD, laneR);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_L, 0.7);
      ctx.fillText("L", 4, laneL + 3);
      ctx.fillStyle = hexAlpha(C_R, 0.7);
      ctx.fillText("R", 4, laneR + 3);

      // Bounce / dub bridges
      if (isLive && p.fbk > 0.08 && (mode === "bounce" || mode === "dub" || mode === "echo")) {
        for (let i = 0; i < Math.min(echoes, 6); i++) {
          const u = (phase + i * spacing) % 1;
          const x = PAD + u * usable;
          const nextU = (u + spacing * 0.5) % 1;
          const x2 = PAD + nextU * usable;
          const fromL = i % 2 === 0;
          ctx.strokeStyle = hexAlpha(C_HOT, (0.08 + p.mix * 0.2) * Math.pow(p.fbk, i * 0.35));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, fromL ? laneL : laneR);
          const midX = (x + x2) * 0.5;
          const midY = (laneL + laneR) * 0.5 + Math.sin(now * 0.003 + i) * 4;
          ctx.quadraticCurveTo(midX, midY, x2, fromL ? laneR : laneL);
          ctx.stroke();
        }
      }

      // Echo blips along cascade
      for (let i = 0; i < echoes; i++) {
        const life = Math.pow(Math.max(0.15, mode === "infinite" ? 0.95 : p.fbk), i * 0.55) * (0.3 + p.mix * 0.7);
        const u = (phase + i * spacing) % 1;
        const isL = mode === "bounce" ? i % 2 === 0 : i % 2 === 0;
        const y = isL ? laneL : laneR;
        const x = PAD + u * usable;
        const r = 2.2 + life * 6 + flashRef.current * 2;
        const col = isL ? C_L : C_R;

        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
        g.addColorStop(0, hexAlpha(C_GLOW, 0.85 * life * tapBright));
        g.addColorStop(0.35, hexAlpha(col, 0.55 * life));
        g.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();

        if (isLive && Math.random() < 0.12 * life) {
          trails.push({ x: x - Math.random() * 10, y: y + (Math.random() - 0.5) * 5, life: life * 0.85, isL });
        }
      }

      // L/R tap nodes (time X, feedback brightness) — primary interactive markers
      const drawTap = (x: number, y: number, col: string, label: string, tLabel: string) => {
        const r = 7 + fbkN * 4 + flashRef.current * 2;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
        g.addColorStop(0, hexAlpha(C_GLOW, 0.9 * tapBright));
        g.addColorStop(0.4, hexAlpha(col, 0.55 * tapBright));
        g.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.7 + flashRef.current * 0.3);
        ctx.lineWidth = 1.8;
        ctx.shadowBlur = 10 + fbkN * 12;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(col, 0.9);
        ctx.textAlign = "center";
        ctx.fillText(label, x, y - r - 4);
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(col, 0.7);
        ctx.fillText(tLabel, x, y + r + 10);
      };
      drawTap(tapLX, laneL, C_L, "L", fmtTime(p.time));
      drawTap(tapRX, laneR, C_R, "R", fmtTime(timeR));

      // Inject pulse
      const pulse = 0.55 + 0.45 * Math.sin(now / 180);
      ctx.fillStyle = hexAlpha(C_GLOW, pulse * (0.35 + p.mix * 0.55));
      ctx.shadowBlur = 10 * pulse;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(PAD + 2, laneL, 2.8, 0, Math.PI * 2);
      ctx.arc(PAD + 2, laneR, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Trails
      for (let i = trails.length - 1; i >= 0; i--) {
        const tr = trails[i]!;
        tr.life -= 0.022;
        tr.x -= 0.9;
        if (tr.life <= 0) {
          trails.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(tr.isL ? C_L : C_R, tr.life * 0.65);
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, 1.5 + tr.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crosshair Time / Fbk (drag target)
      const hx = timeN * W;
      const hy = (1 - fbkN) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Chip
      const chip = !isLive ? "IDLE" : mode === "infinite" ? "INFINITE" : mode === "slap" ? "SLAP" : mode.toUpperCase();
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, chipW, 13);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, chipW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 16);

      // Mix rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_MIX, 0.25 + p.mix * 0.4);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const fill = ctx.createLinearGradient(12, railY, 12 + (W - 24) * p.mix, railY);
      fill.addColorStop(0, hexAlpha(C_MIX, 0.3));
      fill.addColorStop(1, hexAlpha(C_GLOW, 0.85));
      ctx.fillStyle = fill;
      ctx.fillRect(12, railY + 1, Math.max(2, (W - 24) * p.mix), 5);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * p.mix, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_MIX, 0.85);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`MIX ${Math.round(p.mix * 100)}%`, 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("DLY · PING CASCADE", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? "IDLE"
        : `${fmtTime(p.time)} · FB${Math.round(p.fbk * 100)} · ${mode}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        particles: 0,
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
        borderColor: hexAlpha(C, live ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag taps / stage: Time ↔ / Feedback ↕ · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Delay ping cascade"
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
        Ping Cascade
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? fmtTime(time) : "IDLE"}
      </div>
    </div>
  );
}
