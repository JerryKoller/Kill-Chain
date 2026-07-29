/**
 * Phaser — Sweep Veil stage visualizer.
 * Rate · Depth · Mix (Signal Path FX · FC.phaser).
 * Drag: Rate ↔ / Depth ↕. Bottom: Mix. Double-click: cycle mix 0→50→100.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.phaser;
const C_DEEP = bandShade(FC.fx, 0.28);
const C_MID = bandShade(FC.fx, 0.48);
const C_HOT = bandShade(FC.fx, 0.65);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_RATE = bandShade(FC.fx, 0.52);
const C_DEPTH = bandShade(FC.fx, 0.68);
const C_MIX = bandShade(FC.fx, 0.82);

const RATE_MIN = 0.02;
const RATE_MAX = 12;
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

export function PhaserStageViz() {
  const rate = useFireCommandStore((s) => s.patch.phaserRate) ?? 0.4;
  const depth = useFireCommandStore((s) => s.patch.phaserDepth) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.phaserMix) ?? 0;
  const stages = useFireCommandStore((s) => s.patch.phaserStages) ?? 4;
  const center = useFireCommandStore((s) => s.patch.phaserCenter) ?? 800;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ rate, depth, mix, stages, center });
  st.current = { rate, depth, mix, stages, center };

  const live = mix > 0.02;

  useEffect(() => {
    const key = `${rate.toFixed(3)}|${depth.toFixed(3)}|${mix.toFixed(3)}|${stages}|${center.toFixed(0)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [rate, depth, mix, stages, center]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("phaserRate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("phaserDepth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("phaserMix", Math.round(x * 1000) / 1000);
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
    setParam("phaserMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
      const isLive = p.mix > 0.02;
      const energy = 0.1 + p.mix * 0.45 + p.depth * 0.2 + flashRef.current * 0.25;
      const sweep = (Math.sin(now / 1000 * p.rate * 2 * Math.PI) * 0.5 + 0.5) * p.depth;
      const notches = clamp(Math.round(p.stages ?? 4), 4, 12);
      // Map center Hz (100–8000) onto log frequency axis
      const centerN = Math.log(clamp(p.center ?? 800, 100, 8000) / 100) / Math.log(80);
      const PAD = 12;
      const stageH = Hh * 0.62;
      const lfoY0 = Hh * 0.64;
      const lfoH = Hh * 0.1;

      ctx.clearRect(0, 0, W, Hh);

      // Violet veil chamber
      const bg = ctx.createRadialGradient(W * (0.35 + sweep * 0.3), Hh * 0.35, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.08 + energy * 0.4 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.6));
      bg.addColorStop(1, "rgba(5,2,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Freq axis ticks
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_MID, 0.45);
      ctx.textAlign = "center";
      for (const [lab, f] of [["100", 100], ["1k", 1000], ["8k", 8000]] as const) {
        const u = Math.log(f / 100) / Math.log(80);
        ctx.fillText(lab, PAD + u * (W - PAD * 2), stageH - 2);
      }

      // Dry ghost spectrum when mix low
      if (p.mix < 0.85) {
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const u = i / 80;
          const y = 0.55 + 0.12 * Math.sin(u * 8 + now / 900);
          const px = PAD + u * (W - PAD * 2);
          const py = PAD + (1 - y) * (stageH - PAD - 10);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = hexAlpha(C_MID, 0.12 + (1 - p.mix) * 0.18);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Frequency-response style notches (centers scaled by phaserCenter)
      const floorY = stageH - 12;
      const notchSpread = 0.55 + (1 - centerN) * 0.15;
      const notchBase = centerN * 0.35;

      ctx.beginPath();
      ctx.moveTo(PAD, floorY);
      for (let i = 0; i <= 120; i++) {
        const u = i / 120;
        let y = 0.62 + 0.1 * Math.sin(u * 6 + now / 900);
        for (let n = 0; n < notches; n++) {
          const centerU = notchBase + ((n + 0.5) / notches) * notchSpread + (sweep - 0.5) * 0.22 * p.depth;
          const dist = Math.abs(u - centerU);
          y -= Math.exp(-dist * dist * (180 + notches * 8)) * (0.28 + p.depth * 0.4) * (0.35 + p.mix * 0.65);
        }
        y = Math.max(0.05, y);
        const px = PAD + u * (W - PAD * 2);
        const py = PAD + (1 - y) * (floorY - PAD);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(W - PAD, floorY);
      ctx.closePath();
      const valley = ctx.createLinearGradient(0, PAD, 0, floorY);
      valley.addColorStop(0, hexAlpha(C_GLOW, 0.28 + p.mix * 0.35));
      valley.addColorStop(0.35, hexAlpha(C_HOT, 0.14 + p.mix * 0.18));
      valley.addColorStop(0.7, hexAlpha(C_DEEP, 0.08 + p.mix * 0.1));
      valley.addColorStop(1, "rgba(20,4,40,0.02)");
      ctx.fillStyle = valley;
      ctx.fill();

      // Notch crest stroke
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const u = i / 120;
        let y = 0.62 + 0.1 * Math.sin(u * 6 + now / 900);
        for (let n = 0; n < notches; n++) {
          const centerU = notchBase + ((n + 0.5) / notches) * notchSpread + (sweep - 0.5) * 0.22 * p.depth;
          const dist = Math.abs(u - centerU);
          y -= Math.exp(-dist * dist * (180 + notches * 8)) * (0.28 + p.depth * 0.4) * (0.35 + p.mix * 0.65);
        }
        y = Math.max(0.05, y);
        const px = PAD + u * (W - PAD * 2);
        const py = PAD + (1 - y) * (floorY - PAD);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.85 + flashRef.current * 0.15);
      ctx.lineWidth = 2.3;
      ctx.shadowBlur = 12 + p.mix * 14 + p.depth * 8 + flashRef.current * 10;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Allpass notch beams
      for (let n = 0; n < notches; n++) {
        const centerU = notchBase + ((n + 0.5) / notches) * notchSpread + (sweep - 0.5) * 0.22 * p.depth;
        const x = PAD + centerU * (W - PAD * 2);
        const beam = ctx.createLinearGradient(x, 8, x, floorY);
        beam.addColorStop(0, hexAlpha(C_GLOW, 0.55 + p.mix * 0.4));
        beam.addColorStop(0.5, hexAlpha(C_HOT, 0.25 + p.mix * 0.3));
        beam.addColorStop(1, hexAlpha(C_DEEP, 0.08 + p.mix * 0.15));
        ctx.strokeStyle = beam;
        ctx.lineWidth = 1.4 + p.mix * 1.8 + p.depth * 0.6;
        ctx.shadowBlur = 6 + p.mix * 10;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, floorY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        const pulse = 0.75 + 0.25 * Math.sin(now / 280 + n * 1.3);
        ctx.fillStyle = hexAlpha(C_GLOW, (0.55 + p.mix * 0.4) * pulse);
        ctx.beginPath();
        ctx.arc(x, 11, 2.2 + pulse * 1.4 + flashRef.current, 0, Math.PI * 2);
        ctx.fill();

        if (isLive && Math.random() < 0.12 * p.mix) {
          sparks.push({
            x,
            y: 12 + Math.random() * 18,
            vx: (Math.random() - 0.5) * 1.4,
            vy: 0.4 + Math.random() * 1.2,
            life: 1,
          });
        }
      }

      // Center marker
      ctx.strokeStyle = hexAlpha(C_RATE, 0.4);
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD + centerN * (W - PAD * 2), PAD);
      ctx.lineTo(PAD + centerN * (W - PAD * 2), floorY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_RATE, 0.7);
      ctx.textAlign = "center";
      const cHz = p.center ?? 800;
      ctx.fillText(cHz >= 1000 ? `${(cHz / 1000).toFixed(1)}k` : `${Math.round(cHz)}`, PAD + centerN * (W - PAD * 2), PAD + 10);

      // LFO trace (rate)
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(PAD, lfoY0, W - PAD * 2, lfoH);
      ctx.strokeStyle = hexAlpha(C_MID, 0.25);
      ctx.strokeRect(PAD + 0.5, lfoY0 + 0.5, W - PAD * 2 - 1, lfoH - 1);
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        const lfo = Math.sin((u * 4 + now / 1000 * p.rate) * Math.PI * 2);
        const px = PAD + u * (W - PAD * 2);
        const py = lfoY0 + lfoH * 0.5 - lfo * (lfoH * 0.35) * (0.4 + p.depth * 0.6);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.75 + p.mix * 0.2);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_RATE, 0.75);
      ctx.textAlign = "left";
      ctx.fillText(`LFO ${p.rate < 1 ? p.rate.toFixed(2) : p.rate.toFixed(1)}Hz · ${notches}stg`, PAD + 4, lfoY0 - 3);

      // Sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.02;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.05;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(C_GLOW, s.life * 0.7);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.5 + s.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rate / Depth crosshair
      const hx = rateN * W;
      const hy = (1 - p.depth) * (Hh * 0.58);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Status chip
      const chip = !isLive ? "BYPASS" : p.rate < 0.2 ? "SLOW" : p.rate > 4 ? "JET" : "SWEEP";
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
      ctx.fillText("PHASE · SWEEP VEIL", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? "BYPASS"
        : `${notches}n · ${p.rate < 1 ? p.rate.toFixed(2) : p.rate.toFixed(1)}Hz · D${Math.round(p.depth * 100)}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
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
      title="Drag: Rate ↔ / Depth ↕ · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Phaser sweep veil"
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
        Sweep Veil
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? `${rate < 1 ? rate.toFixed(2) : rate.toFixed(1)}Hz` : "BYPASS"}
      </div>
    </div>
  );
}
