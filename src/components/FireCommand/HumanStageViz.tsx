/**
 * Humanize — Feel Grain stage visualizer.
 * Micro timing × velocity scatter (Signal Path Perf · FC.human).
 * Drag pad: X = Timing · Y = Velocity · bottom toggles feel · top cycles characters.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.human;
const C_DEEP = bandShade(FC_BAND.perf, 0.44);
const C_MID = bandShade(FC_BAND.perf, 0.58);
const C_HOT = bandShade(FC_BAND.perf, 0.74);
const C_GLOW = bandShade(FC_BAND.perf, 0.96);
const C_TIME = bandShade(FC_BAND.perf, 0.55);
const C_VEL = bandShade(FC_BAND.perf, 0.82);
const C_ARM = bandShade(FC_BAND.perf, 0.88);

export const HUMAN_CHARS = [
  { id: "grid", label: "Grid", timing: 0, vel: 0, on: false },
  { id: "soft", label: "Soft", timing: 0.12, vel: 0.1, on: true },
  { id: "pocket", label: "Pocket", timing: 0.25, vel: 0.2, on: true },
  { id: "loose", label: "Loose", timing: 0.45, vel: 0.35, on: true },
  { id: "drunk", label: "Drunk", timing: 0.7, vel: 0.55, on: true },
  { id: "wild", label: "Wild", timing: 0.9, vel: 0.85, on: true },
  { id: "time", label: "Time", timing: 0.65, vel: 0.08, on: true },
  { id: "dyn", label: "Dyn", timing: 0.08, vel: 0.7, on: true },
] as const;

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

function near(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

export function humanCharMatch(timing: number, vel: number, on: boolean) {
  return HUMAN_CHARS.find((c) => c.on === on && near(timing, c.timing) && near(vel, c.vel)) ?? null;
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

type DragMode = "pad" | "arm" | null;

export function HumanStageViz() {
  const on = useFireCommandStore((s) => s.patch.humanizeOn);
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming) ?? 0.25;
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity) ?? 0.2;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["human"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const grains = useRef(
    Array.from({ length: 36 }, (_, i) => ({
      bx: Math.random(),
      by: Math.random(),
      phase: i / 36,
      trail: [] as { x: number; y: number; age: number }[],
    })),
  );
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const st = useRef({ on, timing, vel, enabled });
  st.current = { on, timing, vel, enabled };

  const live = enabled && on && (timing > 0.02 || vel > 0.02);

  useEffect(() => {
    const key = `${on ? 1 : 0}|${enabled ? 1 : 0}|${timing.toFixed(3)}|${vel.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [on, enabled, timing, vel]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const cycleChar = useCallback(
    (dir = 1) => {
      const s = st.current;
      let best = 0;
      for (let i = 0; i < HUMAN_CHARS.length; i++) {
        const c = HUMAN_CHARS[i]!;
        if (c.on === s.on && near(s.timing, c.timing) && near(s.vel, c.vel)) {
          best = i;
          break;
        }
      }
      const next = HUMAN_CHARS[(best + dir + HUMAN_CHARS.length) % HUMAN_CHARS.length]!;
      setParam("humanizeOn", next.on);
      setParam("humanizeTiming", next.timing);
      setParam("humanizeVelocity", next.vel);
      flashRef.current = 1;
    },
    [setParam],
  );

  const applyPad = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const padTop = 0.14;
      const padBot = 0.84;
      const yNorm = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      // Invert Y so top = high velocity
      const yPad = clamp((yNorm - padTop) / Math.max(0.01, padBot - padTop), 0, 1);
      const timingV = Math.round(x * 1000) / 1000;
      const velV = Math.round((1 - yPad) * 1000) / 1000;
      setParam("humanizeTiming", timingV);
      setParam("humanizeVelocity", velV);
      if (!st.current.on) setParam("humanizeOn", true);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yNorm = (e.clientY - rect.top) / Math.max(1, rect.height);
      flashRef.current = 1;
      if (yNorm > 0.86) {
        dragRef.current = "arm";
        setParam("humanizeOn", !st.current.on);
        return;
      }
      if (yNorm < 0.12) {
        cycleChar(1);
        return;
      }
      dragRef.current = "pad";
      applyPad(e.clientX, e.clientY);
    },
    [applyPad, cycleChar, setParam],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragRef.current !== "pad") return;
      applyPad(e.clientX, e.clientY);
    },
    [applyPad],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

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
      const flash = flashRef.current;
      const active = s.enabled && s.on;
      const energy = (s.timing + s.vel) * 0.5;
      const breathe = 0.92 + 0.08 * Math.sin(t / 680);
      const char = humanCharMatch(s.timing, s.vel, s.on);

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createRadialGradient(W * 0.5, Hcss * 0.48, 4, W * 0.5, Hcss * 0.5, W * 0.72);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.75 + flash * 0.2));
      bg.addColorStop(0.55, "rgba(12,2,10,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.3 + (active ? 0.15 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Character strip (top)
      const padX = 10;
      const usable = W - padX * 2;
      const stripY = 6;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(padX, stripY, usable, 8);
      const segW = usable / HUMAN_CHARS.length;
      for (let i = 0; i < HUMAN_CHARS.length; i++) {
        const c = HUMAN_CHARS[i]!;
        const hit = char?.id === c.id;
        ctx.fillStyle = hit ? hexAlpha(C_HOT, 0.8 + flash * 0.2) : hexAlpha(C, 0.1);
        ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, 6);
      }
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.textAlign = "left";
      ctx.fillText(`FEEL · ${(char?.label ?? "Custom").toUpperCase()}`, padX, stripY - 1);

      const padTop = 22;
      const padBot = Hcss - 22;
      const padH = padBot - padTop;

      // Quantize grid — fades as feel increases
      const gridA = active ? Math.max(0.04, 0.18 - energy * 0.16) : 0.12;
      ctx.strokeStyle = hexAlpha(C, gridA);
      ctx.lineWidth = 1;
      ctx.setLineDash(active && energy > 0.2 ? [3, 5] : []);
      for (let i = 1; i < 8; i++) {
        const x = (i / 8) * W;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padBot);
        ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        const y = padTop + (i / 4) * padH;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Axis labels
      ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_TIME, 0.55);
      ctx.textAlign = "left";
      ctx.fillText("TIMING →", padX, padBot - 2);
      ctx.fillStyle = hexAlpha(C_VEL, 0.55);
      ctx.save();
      ctx.translate(8, padBot - 8);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("VEL →", 0, 0);
      ctx.restore();

      // Variance ellipse around cursor
      const cx = s.timing * W;
      const cy = padTop + (1 - s.vel) * padH;
      if (active) {
        const rx = 14 + s.timing * 48;
        const ry = 10 + s.vel * 36;
        ctx.strokeStyle = hexAlpha(C_HOT, 0.25 + energy * 0.25);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * breathe, ry * breathe, 0, 0, Math.PI * 2);
        ctx.stroke();
        const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
        fill.addColorStop(0, hexAlpha(C_GLOW, 0.12 + energy * 0.1));
        fill.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Grains
      for (const g of grains.current) {
        const jx = Math.sin(t * 0.0032 + g.phase * Math.PI * 2) * s.timing * 0.12;
        const jy = Math.cos(t * 0.0042 + g.phase * Math.PI * 2 * 1.3) * s.vel * 0.14;
        const x = clamp((g.bx + jx) * W, 0, W);
        const y = padTop + clamp(g.by + jy, 0, 1) * padH;

        if (active && energy > 0.08) {
          g.trail.push({ x, y, age: 0 });
          if (g.trail.length > 10) g.trail.shift();
        }
        for (const tr of g.trail) {
          tr.age += 0.12;
          if (tr.age > 1) continue;
          const life = 1 - tr.age;
          ctx.fillStyle = hexAlpha(C_GLOW, life * energy * 0.35);
          ctx.beginPath();
          ctx.arc(tr.x, tr.y, life * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        g.trail = g.trail.filter((tr) => tr.age <= 1);

        const alpha = active ? 0.55 + energy * 0.35 : 0.22;
        const sz = 2.2 + energy * 2.2;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, sz * 2.4);
        halo.addColorStop(0, hexAlpha(C_GLOW, alpha * 0.8));
        halo.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, sz * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexAlpha(C_GLOW, alpha + 0.1);
        ctx.shadowBlur = active ? 5 + energy * 8 : 0;
        ctx.shadowColor = hexAlpha(C_HOT, 0.7);
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Cursor gem
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 12 + flash * 8;
      ctx.shadowColor = hexAlpha(C_HOT, 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, 5 + flash * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexAlpha(C_TIME, 0.7);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();

      // Sparks
      if (active && energy > 0.1) {
        if (Math.random() < 0.15 + energy * 0.35) {
          sparks.current.push({
            x: cx + (Math.random() - 0.5) * (20 + s.timing * 40),
            y: cy + (Math.random() - 0.5) * (16 + s.vel * 30),
            vx: (Math.random() - 0.5) * (0.5 + s.timing),
            vy: (Math.random() - 0.5) * (0.5 + s.vel),
            life: 1,
          });
          if (sparks.current.length > 48) sparks.current.shift();
        }
        for (let i = sparks.current.length - 1; i >= 0; i--) {
          const p = sparks.current[i]!;
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.02;
          if (p.life <= 0) {
            sparks.current.splice(i, 1);
            continue;
          }
          ctx.fillStyle = hexAlpha(C_GLOW, p.life * 0.55);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.2 + p.life * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Arm rail
      const railY = Hcss - 10;
      ctx.strokeStyle = hexAlpha(C_ARM, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(W - padX, railY);
      ctx.stroke();
      const armT = !s.enabled ? 0 : s.on ? 1 : 0.12;
      ctx.strokeStyle = hexAlpha(C_ARM, 0.85);
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(padX + armT * usable, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(padX + armT * usable, railY, 4.5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      ctx.fillText(
        !s.enabled
          ? "FEEL GRAIN · BYPASS"
          : active
            ? `FEEL GRAIN · ${(char?.label ?? "CUSTOM").toUpperCase()}`
            : "FEEL GRAIN · GRID",
        10,
        Hcss - 8,
      );
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(`T${Math.round(s.timing * 100)} · V${Math.round(s.vel * 100)}`, W - 10, Hcss - 8);
      },
      () => ({
        flash: flashRef.current,
        active: !!(st.current.on && st.current.enabled),
        dragging: !!dragRef.current,
        particles: 0,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-crosshair touch-none select-none"
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
      role="img"
      aria-label="Feel grain — drag for timing and velocity, bottom arms feel"
      title="Pad: Timing × Vel · Top: character · Bottom: arm"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
