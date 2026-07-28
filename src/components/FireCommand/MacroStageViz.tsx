/**
 * Macros — Helm Quartet stage visualizer.
 * Four performance macros → mod matrix (Signal Path Perf · FC.macros).
 * Drag each helm ↕ to set level. Double-click: cycle characters / zero.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.macros;
const C_DEEP = bandShade(FC_BAND.perf, 0.22);
const C_MID = bandShade(FC_BAND.perf, 0.4);
const C_HOT = bandShade(FC_BAND.perf, 0.58);
const C_GLOW = bandShade(FC_BAND.perf, 0.9);

/** Four helms stay inside the Perf magenta family (deep → light). */
export const MACRO_HELM_COLORS = [
  bandShade(FC_BAND.perf, 0.32),
  bandShade(FC_BAND.perf, 0.48),
  bandShade(FC_BAND.perf, 0.64),
  bandShade(FC_BAND.perf, 0.8),
] as const;

export const MACRO_KEYS = ["macro1", "macro2", "macro3", "macro4"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

const CHAR_CYCLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 0],
  [0.25, 0.25, 0.25, 0.25],
  [0.5, 0.5, 0.5, 0.5],
  [0.2, 0.4, 0.6, 0.85],
  [1, 0, 0, 0],
  [0.75, 0.75, 0, 0],
  [1, 0, 1, 0],
  [0, 0.5, 1, 0.5],
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

export function MacroStageViz() {
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const matrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["macros"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const values = [m1, m2, m3, m4] as const;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const dragIdx = useRef<number | null>(null);
  const prevKey = useRef("");
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number; m: number }[]>([]);
  const st = useRef({ values, enabled, routes: [] as string[][] });
  st.current = {
    values,
    enabled,
    routes: MACRO_KEYS.map((k) =>
      matrix.filter((r) => r.source === k && r.dest !== "none").map((r) => r.dest),
    ),
  };

  const energy = Math.max(m1, m2, m3, m4);
  const live = enabled && energy > 0.03;

  useEffect(() => {
    const key = `${m1.toFixed(3)}|${m2.toFixed(3)}|${m3.toFixed(3)}|${m4.toFixed(3)}|${enabled ? 1 : 0}|${matrix.length}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [m1, m2, m3, m4, enabled, matrix]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const helmAt = useCallback((clientX: number): number => {
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.999);
    return Math.floor(x * 4);
  }, []);

  const applyHelm = useCallback(
    (clientX: number, clientY: number, idx: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      // Leave bottom rail margin — main area maps 0.08..0.78 → 1..0
      const plot = clamp((y - 0.06) / 0.72, 0, 1);
      const v = Math.round((1 - plot) * 1000) / 1000;
      setParam(MACRO_KEYS[idx]!, clamp(v, 0, 1));
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const idx = helmAt(e.clientX);
      dragIdx.current = idx;
      flashRef.current = 1;
      applyHelm(e.clientX, e.clientY, idx);
    },
    [applyHelm, helmAt],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragIdx.current === null) return;
      applyHelm(e.clientX, e.clientY, dragIdx.current);
    },
    [applyHelm],
  );

  const onPointerUp = useCallback(() => {
    dragIdx.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.values;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < CHAR_CYCLE.length; i++) {
      const c = CHAR_CYCLE[i]!;
      const d =
        Math.abs(c[0] - cur[0]) +
        Math.abs(c[1] - cur[1]) +
        Math.abs(c[2] - cur[2]) +
        Math.abs(c[3] - cur[3]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = CHAR_CYCLE[(best + 1) % CHAR_CYCLE.length]!;
    setParam("macro1", next[0]);
    setParam("macro2", next[1]);
    setParam("macro3", next[2]);
    setParam("macro4", next[3]);
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
      const { values: vals, enabled: on, routes } = st.current;
      const flash = flashRef.current;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.002);

      ctx.clearRect(0, 0, W, Hcss);

      // Magenta chamber
      const bg = ctx.createLinearGradient(0, 0, W, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.65 + flash * 0.2));
      bg.addColorStop(0.5, "rgba(8,2,6,0.95)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.35));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Center constellation glow
      const eg = Math.max(...vals);
      const core = ctx.createRadialGradient(W * 0.5, Hcss * 0.42, 4, W * 0.5, Hcss * 0.42, W * 0.35);
      core.addColorStop(0, hexAlpha(C_GLOW, (0.06 + eg * 0.22 + flash * 0.15) * (on ? 1 : 0.25)));
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, W, Hcss);

      const slotW = W / 4;
      const baseY = Hcss * 0.72;
      const topY = Hcss * 0.14;

      // Connecting web between active helms
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const a = vals[i]! * (on ? 1 : 0);
          const b = vals[j]! * (on ? 1 : 0);
          if (a < 0.08 || b < 0.08) continue;
          const xi = slotW * (i + 0.5);
          const xj = slotW * (j + 0.5);
          const yi = baseY - a * (baseY - topY);
          const yj = baseY - b * (baseY - topY);
          ctx.strokeStyle = hexAlpha(C_HOT, 0.08 + Math.min(a, b) * 0.25);
          ctx.lineWidth = 1 + Math.min(a, b) * 2;
          ctx.beginPath();
          ctx.moveTo(xi, yi);
          ctx.quadraticCurveTo(W * 0.5, Hcss * 0.35 + breath * 8, xj, yj);
          ctx.stroke();
        }
      }

      for (let i = 0; i < 4; i++) {
        const v = on ? vals[i]! : 0;
        const col = MACRO_HELM_COLORS[i]!;
        const cx = slotW * (i + 0.5);
        const cy = baseY - v * (baseY - topY);
        const R = 14 + v * 16 + flash * 3;

        // Column guide
        ctx.strokeStyle = hexAlpha(col, 0.15 + v * 0.2);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(cx, baseY + 8);
        ctx.stroke();
        ctx.setLineDash([]);

        // Fill column
        const colG = ctx.createLinearGradient(cx, cy, cx, baseY);
        colG.addColorStop(0, hexAlpha(col, 0.35 + v * 0.35));
        colG.addColorStop(1, hexAlpha(col, 0.02));
        ctx.fillStyle = colG;
        ctx.fillRect(cx - 4 - v * 4, cy, 8 + v * 8, baseY - cy);

        // Helm orb
        const og = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, R);
        og.addColorStop(0, hexAlpha(C_GLOW, 0.95));
        og.addColorStop(0.35, hexAlpha(col, 0.85));
        og.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = og;
        ctx.shadowBlur = 10 + v * 18 + flash * 8;
        ctx.shadowColor = hexAlpha(col, 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Ring meter
        ctx.strokeStyle = hexAlpha(col, 0.25);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, R + 6, -Math.PI * 0.75, Math.PI * 0.75);
        ctx.stroke();
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.7 + v * 0.25);
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, R + 6, -Math.PI * 0.75, -Math.PI * 0.75 + Math.PI * 1.5 * v);
        ctx.stroke();

        // Label
        ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(col, 0.85);
        ctx.textAlign = "center";
        ctx.fillText(`M${i + 1}`, cx, baseY + 18);
        ctx.font = "700 9px ui-monospace, Menlo, monospace";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.7 + v * 0.25);
        ctx.fillText(`${Math.round(v * 100)}`, cx, cy + 3);

        // Route chips under helm
        const dests = routes[i] ?? [];
        if (dests.length > 0 && v > 0.05) {
          ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(col, 0.55);
          const label = dests.slice(0, 2).join(" · ");
          ctx.fillText(label.length > 14 ? label.slice(0, 13) + "…" : label, cx, topY - 2);
        }

        // Sparks when high
        if (on && v > 0.35 && Math.random() < 0.2 * v) {
          const ang = Math.random() * Math.PI * 2;
          sparks.current.push({
            x: cx,
            y: cy,
            vx: Math.cos(ang) * (0.4 + v),
            vy: Math.sin(ang) * (0.4 + v) - 0.3,
            life: 1,
            m: i,
          });
          if (sparks.current.length > 48) sparks.current.shift();
        }
      }

      for (let i = sparks.current.length - 1; i >= 0; i--) {
        const s = sparks.current[i]!;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.04;
        s.life -= 0.025;
        if (s.life <= 0) {
          sparks.current.splice(i, 1);
          continue;
        }
        const col = MACRO_HELM_COLORS[s.m]!;
        const pg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 3 + s.life * 2);
        pg.addColorStop(0, hexAlpha(C_GLOW, s.life * 0.85));
        pg.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3 + s.life * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Identity
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.35);
      ctx.textAlign = "left";
      ctx.fillText(on ? "HELM QUARTET" : "HELM QUARTET · BYPASS", 10, Hcss - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      const wired = routes.reduce((n, r) => n + r.length, 0);
      ctx.fillText(`Σ${Math.round(eg * 100)} · ${wired} route${wired === 1 ? "" : "s"}`, W - 10, Hcss - 8);

      if (!on) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, Hcss);
      }
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
        dragging: false,
        particles: 0,
        motionKey: "",
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 bg-black/50 cursor-ns-resize touch-none select-none"
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
      aria-label="Macro helm quartet — drag each column to set macro level"
      title="Drag ↕ each helm · Double-click cycles characters"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: `${C}88` }} />
    </div>
  );
}
