/**
 * UNI — Voice Choir stage visualizer.
 * Unison stack · detune · stereo width · drift (Signal Path Tone · FC.unison).
 * Drag: Width ↔ / Detune ↕. Voice count paints the fan.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.unison;
const C_DEEP = bandShade(FC.tone, 0.12);
const C_MID = bandShade(FC.tone, 0.35);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.82);
const C_DET = bandShade(FC.tone, 0.42);
const C_WID = bandShade(FC.tone, 0.68);
const C_DRIFT = bandShade(FC.tone, 0.75);

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

export function UnisonStageViz() {
  const unison = useFireCommandStore((s) => s.patch.unison) ?? 1;
  const detune = useFireCommandStore((s) => s.patch.unisonDetune) ?? 0;
  const width = useFireCommandStore((s) => s.patch.unisonWidth) ?? 0.5;
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef("");
  const st = useRef({ unison, detune, width, drift });
  st.current = { unison, detune, width, drift };

  const stacked = Math.round(unison) > 1 || detune > 1 || width > 0.55 || drift > 0.02;

  useEffect(() => {
    const key = `${unison}|${detune}|${width.toFixed(3)}|${drift.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [unison, detune, width, drift]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      // X → width, Y → detune (up = more)
      setParam("unisonWidth", Math.round(x * 1000) / 1000);
      setParam("unisonDetune", Math.round((1 - y) * 50));
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Bottom rail: voice count 1–7
      if (y > H * 0.82) {
        const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const v = 1 + Math.min(6, Math.floor(x * 7));
        setParam("unison", v);
        return;
      }
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      applyFromPointer(e.clientX, e.clientY);
    },
    [applyFromPointer, setParam],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyFromPointer(e.clientX, e.clientY);
    },
    [applyFromPointer],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("unison", 1);
    setParam("unisonDetune", 0);
    setParam("unisonWidth", 0.5);
    setParam("drift", 0);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const particles: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.88;

      const n = Math.max(1, Math.min(7, Math.round(p.unison)));
      const det = clamp(p.detune / 50, 0, 1);
      const wid = clamp(p.width, 0, 1);
      const dri = clamp(p.drift, 0, 1);
      const mono = n === 1 && det < 0.04;
      const energy = mono ? 0.2 : 0.35 + det * 0.35 + wid * 0.25 + (n / 7) * 0.2;

      ctx.clearRect(0, 0, W, Hh);

      // Gold choir chamber
      const bg = ctx.createRadialGradient(W * 0.5, Hh * 0.4, 4, W * 0.5, Hh * 0.5, W * 0.75);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.14 + energy * 0.28 + flashRef.current * 0.28));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(6,4,1,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      const cx = W * 0.5;
      const cy = Hh * 0.42;
      const spread = 12 + wid * 52;
      const breath = 0.92 + 0.08 * Math.sin(now / 640);
      const driftWobble = dri * Math.sin(now * 0.003) * 6;

      // L/R stereo rails
      const railTop = cy - 36 - wid * 8;
      const railBot = cy + 36 + wid * 8;
      ctx.strokeStyle = hexAlpha(C_WID, 0.15 + wid * 0.35);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(16, railTop);
      ctx.lineTo(W - 16, railTop);
      ctx.moveTo(16, railBot);
      ctx.lineTo(W - 16, railBot);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_WID, 0.55);
      ctx.textAlign = "left";
      ctx.fillText("L", 6, railTop + 3);
      ctx.textAlign = "right";
      ctx.fillText("R", W - 6, railBot + 3);

      // Fan arc
      ctx.beginPath();
      ctx.arc(cx, cy + 8, spread * 0.55, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = hexAlpha(C_DET, 0.12 + det * 0.25);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Choir ribbons
      for (let layer = 3; layer >= 0; layer--) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
          const x = cx + u * spread;
          const lean = u * det * 24 + driftWobble * u;
          const amp = (20 + (1 - Math.abs(u)) * 12) * breath;
          const y = cy - amp * 0.6 + layer * 3 + Math.sin(now * 0.002 + u * 2 + layer) * det * 3;
          if (i === 0) ctx.moveTo(x + lean * 0.2, y);
          else ctx.lineTo(x + lean * 0.2, y);
        }
        ctx.strokeStyle = hexAlpha(layer === 0 ? C_GLOW : C_MID, (layer === 0 ? 0.35 : 0.1) * (0.4 + det));
        ctx.lineWidth = layer === 0 ? 2 : 1.2;
        if (layer === 0) {
          ctx.shadowBlur = 8 + det * 10 + flashRef.current * 12;
          ctx.shadowColor = C;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Voice stems
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const x = cx + u * spread;
        const lean = u * det * 24 + driftWobble * u * 0.5;
        const amp = (22 + (1 - Math.abs(u)) * 14) * breath;
        const col = Math.abs(u) > 0.4 ? C_DET : C_HOT;
        const centerBoost = 1 - Math.abs(u);

        const halo = ctx.createRadialGradient(x, cy - amp * 0.3, 0, x, cy - amp * 0.3, 16 + centerBoost * 10);
        halo.addColorStop(0, hexAlpha(col, 0.3 + centerBoost * 0.25 + energy * 0.15));
        halo.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(x - 22, cy - amp - 16, 44, 55);

        ctx.beginPath();
        ctx.moveTo(x + lean * 0.15, cy - amp);
        ctx.quadraticCurveTo(x + lean, cy, x + lean * 0.15, cy + amp);
        ctx.strokeStyle = hexAlpha(col, 0.55 + centerBoost * 0.35);
        ctx.lineWidth = n === 1 ? 3.2 : 2 + centerBoost * 0.7;
        ctx.shadowBlur = 10 + centerBoost * 8 + flashRef.current * 10;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Pan connector
        const tipY = cy - amp;
        const railY = u < 0 ? railTop + 2 : railBot + 2;
        const panX = 16 + (W - 32) * ((u * wid + 1) / 2);
        ctx.strokeStyle = hexAlpha(C_WID, 0.12 + wid * 0.25);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + lean * 0.15, tipY);
        ctx.lineTo(panX, railY);
        ctx.stroke();

        ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
        ctx.beginPath();
        ctx.arc(x + lean * 0.15, tipY, 2.8 + flashRef.current * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Drift particles
      if (dri > 0.03 || det > 0.2) {
        const intensity = dri + det * 0.4;
        if (Math.random() < 0.25 * intensity) {
          particles.push({
            x: cx + (Math.random() - 0.5) * spread * 2,
            y: cy + (Math.random() - 0.5) * 50,
            vx: (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.5) * 0.8,
            life: 1,
          });
        }
        for (let i = particles.length - 1; i >= 0; i--) {
          const pt = particles[i]!;
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.life -= 0.02;
          if (pt.life <= 0) {
            particles.splice(i, 1);
            continue;
          }
          ctx.fillStyle = hexAlpha(C_DRIFT, pt.life * 0.55);
          ctx.fillRect(pt.x, pt.y, 2.2, 2.2);
        }
      }

      // Voice count rail
      const railY = Hh - 16;
      for (let v = 1; v <= 7; v++) {
        const x0 = ((v - 1) / 7) * W + 3;
        const x1 = (v / 7) * W - 3;
        const on = n === v;
        ctx.fillStyle = on ? hexAlpha(C_HOT, 0.4 + energy * 0.2) : "rgba(255,255,255,0.04)";
        ctx.fillRect(x0, railY, x1 - x0, 8);
        if (on) {
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.75);
          ctx.lineWidth = 1;
          ctx.strokeRect(x0, railY, x1 - x0, 8);
        }
        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = on ? hexAlpha(C_GLOW, 0.95) : hexAlpha(C_MID, 0.4);
        ctx.fillText(String(v), (x0 + x1) / 2, railY + 6.5);
      }

      // Crosshair width/detune
      const hx = wid * W;
      const hy = (1 - det) * (Hh * 0.75);
      ctx.strokeStyle = hexAlpha(C_GLOW, mono ? 0.12 : 0.35 + flashRef.current * 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - 7, hy);
      ctx.lineTo(hx + 7, hy);
      ctx.moveTo(hx, hy - 7);
      ctx.lineTo(hx, hy + 7);
      ctx.stroke();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText(`UNI · ${n}V CHOIR`, 12, Hh - 4);
      ctx.textAlign = "right";
      if (mono) {
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.fillText("MONO · tap rail for voices", W - 12, Hh - 4);
      } else {
        const bits = [`${Math.round(p.detune)}¢`, `W${Math.round(wid * 100)}`];
        if (dri > 0.04) bits.push(`DR${Math.round(dri * 100)}`);
        ctx.fillStyle = hexAlpha(C_HOT, 0.85);
        ctx.fillText(bits.join(" · "), W - 12, Hh - 4);
      }
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: particles.length,
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
        borderColor: hexAlpha(C, stacked ? 0.5 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexAlpha(C, stacked ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Width ↔ / Detune ↕ · Bottom rail: voices · Double-click: mono"
      role="img"
      aria-label="Unison voice choir"
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
        Voice Choir
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {Math.round(unison)}V · {Math.round(detune)}¢
      </div>
    </div>
  );
}
