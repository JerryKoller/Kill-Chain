/**
 * Gate — Rhythm Shutter stage visualizer.
 * Trance gate chop (Signal Path Perf · FC.gate).
 * Click steps to toggle · bottom rail: Rate · drag depth zone.
 * Double-click: cycle pattern presets.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.gate;
const C_DEEP = bandShade(FC_BAND.perf, 0.26);
const C_MID = bandShade(FC_BAND.perf, 0.45);
const C_HOT = bandShade(FC_BAND.perf, 0.62);
const C_GLOW = bandShade(FC_BAND.perf, 0.92);
const C_RATE = bandShade(FC_BAND.perf, 0.55);
const C_DEPTH = bandShade(FC_BAND.perf, 0.7);

export const GATE_PRESETS: { id: string; name: string; steps: number[] }[] = [
  { id: "offbeat", name: "Offbeat", steps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { id: "four", name: "Four", steps: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0] },
  { id: "gallop", name: "Gallop", steps: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1] },
  { id: "332", name: "3-3-2", steps: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0] },
  { id: "stutter", name: "Stutter", steps: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0] },
  { id: "sparse", name: "Sparse", steps: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0] },
  { id: "long", name: "Long", steps: [1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0] },
  { id: "solid", name: "Solid", steps: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
];

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

type DragMode = "step" | "rate" | "depth" | null;

export function GateStageViz() {
  const on = useFireCommandStore((s) => s.patch.gateOn);
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const steps = useFireCommandStore((s) => s.patch.gateSteps);
  const depth = useFireCommandStore((s) => s.patch.gateDepth);
  const smooth = useFireCommandStore((s) => s.patch.gateSmooth) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.gateRate) ?? 8;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["gate"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setGateStep = useFireCommandStore((s) => s.setGateStep);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const paintValRef = useRef<boolean | null>(null);
  const lastPaintRef = useRef(-1);
  const playStepRef = useRef(-1);
  const prevKey = useRef("");
  const particles = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const st = useRef({ on, pattern, steps, depth, smooth, rate, enabled });
  st.current = { on, pattern, steps, depth, smooth, rate, enabled };

  const live = on && enabled;

  useEffect(() => {
    const key = `${on}|${steps}|${depth.toFixed(3)}|${smooth.toFixed(3)}|${rate.toFixed(2)}|${pattern.join("")}|${enabled ? 1 : 0}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [on, steps, depth, smooth, rate, pattern, enabled]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  // Playhead poll
  useEffect(() => {
    if (!on || !enabled) {
      playStepRef.current = -1;
      return;
    }
    const id = window.setInterval(() => {
      try {
        playStepRef.current = activeFireEngine().getGateStep();
      } catch {
        playStepRef.current = -1;
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [on, enabled]);

  const hitTest = useCallback((clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return "step";
    const rect = wrap.getBoundingClientRect();
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    if (y > 0.84) return "rate";
    if (y < 0.14) return "depth";
    return "step";
  }, []);

  const paintStepAt = useCallback(
    (clientX: number, first: boolean) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const n = Math.max(2, Math.min(16, Math.round(st.current.steps)));
      const padX = 12;
      const usable = Math.max(1, rect.width - padX * 2);
      const x = clientX - rect.left - padX;
      const i = clamp(Math.floor((x / usable) * n), 0, n - 1);
      if (!first && i === lastPaintRef.current) return;
      lastPaintRef.current = i;
      const lit = (st.current.pattern[i] ?? 0) > 0.5;
      if (first) paintValRef.current = !lit;
      const next = paintValRef.current ?? !lit;
      if (lit !== next) setGateStep(i, next);
    },
    [setGateStep],
  );

  const applyRate = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("gateRate", Math.round(logLerp(x, 0.5, 24) * 100) / 100);
    },
    [setParam],
  );

  const applyDepth = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("gateDepth", Math.round(x * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const mode = hitTest(e.clientY);
      dragRef.current = mode;
      flashRef.current = 1;
      lastPaintRef.current = -1;
      paintValRef.current = null;
      if (mode === "step") paintStepAt(e.clientX, true);
      else if (mode === "rate") applyRate(e.clientX);
      else applyDepth(e.clientX);
    },
    [applyDepth, applyRate, hitTest, paintStepAt],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const mode = dragRef.current;
      if (!mode) return;
      if (mode === "step") paintStepAt(e.clientX, false);
      else if (mode === "rate") applyRate(e.clientX);
      else applyDepth(e.clientX);
    },
    [applyDepth, applyRate, paintStepAt],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    paintValRef.current = null;
    lastPaintRef.current = -1;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.pattern;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < GATE_PRESETS.length; i++) {
      const p = GATE_PRESETS[i]!.steps;
      let d = 0;
      for (let j = 0; j < 16; j++) d += Math.abs((p[j] ?? 0) - (cur[j] ?? 0));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = GATE_PRESETS[(best + 1) % GATE_PRESETS.length]!;
    setParam("gatePattern", [...next.steps]);
    flashRef.current = 1;
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (t) => {
      flashRef.current *= 0.9;

      const { w: W, h: Hcss } = sizeRef.current;
      if (W < 2) return;
      const s = st.current;
      const active = s.on && s.enabled;
      const flash = flashRef.current;
      const playStep = playStepRef.current;
      const rateT = logNorm(s.rate, 0.5, 24);
      const tempo = 0.55 + rateT * 1.6;
      const breathe = 0.92 + 0.08 * Math.sin((t / 700) * tempo);

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createLinearGradient(0, 0, W, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.7 + flash * 0.2));
      bg.addColorStop(0.5, "rgba(8,2,6,0.95)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.4 + (active ? 0.15 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Magenta scanlines — intensity follows depth
      if (s.depth > 0.02) {
        ctx.strokeStyle = hexAlpha(C, 0.04 + s.depth * 0.06);
        ctx.lineWidth = 1;
        for (let y = 18; y < Hcss - 18; y += 5) {
          ctx.beginPath();
          ctx.moveTo(8, y + Math.sin(t / 400 + y * 0.08) * s.depth);
          ctx.lineTo(W - 8, y);
          ctx.stroke();
        }
      }

      const n = Math.max(2, Math.min(16, Math.round(s.steps)));
      const padX = 12;
      const usable = W - padX * 2;
      const stepW = usable / n;
      const floor = Hcss - 22;
      const ceil = 22;
      const ampH = floor - ceil;
      const closed = 1 - s.depth;

      // Depth strip (top)
      const depthFill = s.depth * usable;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(padX, 6, usable, 6);
      ctx.fillStyle = hexAlpha(C_DEPTH, 0.75 + flash * 0.2);
      ctx.fillRect(padX, 6, depthFill, 6);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_DEPTH, 0.7);
      ctx.textAlign = "left";
      ctx.fillText(`DEPTH ${Math.round(s.depth * 100)}`, padX, 5);

      let heights: number[] = [];
      for (let i = 0; i < n; i++) {
        const open = (s.pattern[i] ?? 0) > 0.5 ? 1 : closed;
        heights.push(open);
      }
      if (s.smooth > 0.01) {
        const blur = Math.max(1, Math.round(s.smooth * 3));
        const soft = heights.slice();
        for (let i = 0; i < n; i++) {
          let acc = 0;
          let w = 0;
          for (let k = -blur; k <= blur; k++) {
            const j = (i + k + n) % n;
            const wt = 1 - Math.abs(k) / (blur + 1);
            acc += heights[j]! * wt;
            w += wt;
          }
          soft[i] = acc / w;
        }
        heights = soft;
      }

      // Shutter blades -- closed steps drop magenta louvers
      for (let i = 0; i < n; i++) {
        const lit = (s.pattern[i] ?? 0) > 0.5;
        if (lit) continue;
        const x0 = padX + i * stepW;
        const bladeH = Math.max(2, ampH * (0.55 + s.depth * 0.4) * (1 - s.smooth * 0.45));
        const g = ctx.createLinearGradient(x0, ceil, x0, ceil + bladeH);
        g.addColorStop(0, hexAlpha(C_HOT, 0.55 + flash * 0.15));
        g.addColorStop(1, hexAlpha(C_DEEP, 0.35));
        ctx.fillStyle = g;
        ctx.fillRect(x0 + 1, ceil, stepW - 2, bladeH);
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.18);
        ctx.lineWidth = 1;
        for (let slat = 4; slat < bladeH; slat += 5) {
          ctx.beginPath();
          ctx.moveTo(x0 + 2, ceil + slat);
          ctx.lineTo(x0 + stepW - 2, ceil + slat);
          ctx.stroke();
        }
      }

      // Silhouette layers
      for (let layer = 2; layer >= 0; layer--) {
        ctx.beginPath();
        ctx.moveTo(padX, floor);
        for (let i = 0; i < n; i++) {
          const x0 = padX + i * stepW;
          const y = floor - heights[i]! * ampH * (1 - layer * 0.05) * breathe;
          ctx.lineTo(x0, y);
          ctx.lineTo(x0 + stepW, y);
        }
        ctx.lineTo(padX + usable, floor);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, ceil, 0, floor);
        fill.addColorStop(0, hexAlpha(C_GLOW, (active ? 0.35 : 0.12) * (1 - layer * 0.15)));
        fill.addColorStop(0.55, hexAlpha(C_HOT, (active ? 0.18 : 0.06) * (1 - layer * 0.1)));
        fill.addColorStop(1, hexAlpha(C, 0.02));
        ctx.fillStyle = fill;
        ctx.fill();
      }

      // Contour — smooth softens stroke
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x0 = padX + i * stepW;
        const y = floor - heights[i]! * ampH * breathe;
        if (i === 0) ctx.moveTo(x0, y);
        ctx.lineTo(x0, y);
        ctx.lineTo(x0 + stepW, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, active ? 0.9 - s.smooth * 0.25 : 0.4);
      ctx.lineWidth = 2.4 + s.smooth * 1.6;
      ctx.lineJoin = s.smooth > 0.2 ? "round" : "miter";
      ctx.shadowBlur = active ? 12 + flash * 8 + s.smooth * 6 : 0;
      ctx.shadowColor = hexAlpha(C_HOT, 0.7);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Step ticks + hit pads glow
      for (let i = 0; i < n; i++) {
        const x = padX + i * stepW;
        const lit = (s.pattern[i] ?? 0) > 0.5;
        const isBeat = i % 4 === 0;
        ctx.strokeStyle = hexAlpha(C, isBeat ? 0.22 : 0.08);
        ctx.lineWidth = isBeat ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x, ceil);
        ctx.lineTo(x, floor);
        ctx.stroke();
        if (lit) {
          ctx.fillStyle = hexAlpha(C_HOT, 0.12 + flash * 0.1);
          ctx.fillRect(x + 1, ceil, stepW - 2, ampH);
        }
      }

      // Particles — spawn/speed scale with rate & depth
      if (active) {
        if (Math.random() < 0.18 + s.depth * 0.22 + rateT * 0.2) {
          particles.current.push({
            x: padX + Math.random() * usable,
            y: ceil + Math.random() * ampH,
            vx: (Math.random() - 0.5) * (0.4 + rateT * 0.8),
            vy: -0.2 - Math.random() * (0.5 + rateT * 0.6),
            life: 1,
          });
          if (particles.current.length > 48) particles.current.shift();
        }
        for (let i = particles.current.length - 1; i >= 0; i--) {
          const pt = particles.current[i]!;
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.life -= 0.012 + rateT * 0.01;
          if (pt.life <= 0) {
            particles.current.splice(i, 1);
            continue;
          }
          const r = 1.2 + pt.life * (1.2 + s.smooth);
          ctx.fillStyle = hexAlpha(C_GLOW, pt.life * 0.55);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Playhead
      if (active && playStep >= 0 && playStep < n) {
        const x = padX + playStep * stepW + stepW / 2;
        const beam = ctx.createLinearGradient(x, 0, x, Hcss);
        beam.addColorStop(0, hexAlpha(C_GLOW, 0));
        beam.addColorStop(0.4, hexAlpha(C_GLOW, 0.55));
        beam.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = beam;
        ctx.shadowBlur = 12;
        ctx.shadowColor = hexAlpha(C_HOT, 0.7);
        ctx.fillRect(x - 2.5, 0, 5, Hcss);
        ctx.shadowBlur = 0;

        const y = floor - heights[playStep]! * ampH * breathe;
        const pulse = 0.6 + 0.4 * Math.sin(t / 70);
        const bloom = ctx.createRadialGradient(x, y, 0, x, y, 16 + pulse * 8);
        bloom.addColorStop(0, hexAlpha(C_GLOW, 0.8 * pulse));
        bloom.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(x, y, 16 + pulse * 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rate rail
      const railY = Hcss - 10;
      ctx.strokeStyle = hexAlpha(C_RATE, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(W - padX, railY);
      ctx.stroke();
      const thumbX = padX + rateT * usable;
      ctx.strokeStyle = hexAlpha(C_RATE, 0.8);
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 4.5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      ctx.fillText(
        !s.enabled ? "RHYTHM SHUTTER · BYPASS" : active ? "RHYTHM SHUTTER · LIVE" : "RHYTHM SHUTTER · ARMED",
        10,
        Hcss - 8,
      );
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(
        `${n}st · ${s.rate.toFixed(1)}Hz · D${Math.round(s.depth * 100)} · S${Math.round(s.smooth * 100)}`,
        W - 10,
        Hcss - 8,
      );
      },
      () => ({
        flash: flashRef.current,
        active: !!(st.current.on && st.current.enabled),
        dragging: !!dragRef.current,
        particles: particles.current.length,
        motionKey: playStepRef.current,
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-pointer touch-none select-none"
      style={{
        borderColor: `${C}${live ? "66" : "40"}`,
        height: H,
        boxShadow: live
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 28px ${C}28, 0 6px 18px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="img"
      aria-label="Rhythm shutter — click steps, scrub rate and depth"
      title="Paint steps · Top: Depth · Bottom: Rate · Double-click cycles presets"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
