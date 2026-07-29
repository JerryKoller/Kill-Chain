/**
 * Modulation Matrix — Patch Loom stage visualizer.
 * 12-slot SRC→DST weave with bipolar depth (Signal Path Mod · FC.matrix).
 * Click cable/slot to focus · drag ↕ amount · bottom rail focuses slots · double-click clears focus.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ModSource, ModDest, ModRoute } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.matrix;
const C_DEEP = bandShade(FC.mod, 0.3);
const C_MID = bandShade(FC.mod, 0.52);
const C_HOT = bandShade(FC.mod, 0.72);
const C_GLOW = bandShade(FC.mod, 0.96);
const C_POS = bandShade(FC.mod, 0.88);
const C_NEG = bandShade(FC.mod, 0.42);

const SRC_META: { id: ModSource; label: string }[] = [
  { id: "lfo1", label: "L1" },
  { id: "lfo2", label: "L2" },
  { id: "modenv", label: "ME" },
  { id: "velocity", label: "Vel" },
  { id: "keytrack", label: "Key" },
  { id: "macro1", label: "M1" },
  { id: "macro2", label: "M2" },
  { id: "macro3", label: "M3" },
  { id: "macro4", label: "M4" },
  { id: "random", label: "Rnd" },
];

const DST_META: { id: ModDest; label: string }[] = [
  { id: "pitch", label: "Pit" },
  { id: "cutoff", label: "Cut" },
  { id: "resonance", label: "Res" },
  { id: "wtA", label: "MoA" },
  { id: "wtB", label: "MoB" },
  { id: "wtC", label: "MoC" },
  { id: "levelA", label: "LvA" },
  { id: "levelB", label: "LvB" },
  { id: "levelC", label: "LvC" },
  { id: "fm", label: "FM" },
  { id: "pan", label: "Pan" },
  { id: "volume", label: "Vol" },
  { id: "reverb", label: "Rev" },
  { id: "delay", label: "Dly" },
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

function activeRoutes(mx: ModRoute[]) {
  return mx
    .map((r, i) => ({ ...r, slot: i }))
    .filter((r) => r.source !== "none" && r.dest !== "none");
}

type DragMode = "amt" | "slot" | null;

export function MatrixStageViz() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const focusRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const dragStartY = useRef(0);
  const dragStartAmt = useRef(0);
  const prevKey = useRef("");
  const st = useRef(matrix);
  st.current = matrix;

  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none").length;
  const live = used > 0;

  useEffect(() => {
    const key = matrix.map((r) => `${r.source}>${r.dest}:${r.amount.toFixed(2)}`).join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [matrix]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const focusSlot = useCallback((slot: number) => {
    focusRef.current = clamp(slot, 0, Math.max(0, st.current.length - 1));
    flashRef.current = 1;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);

      if (y > H * 0.78) {
        const slot = clamp(Math.floor(x * 12), 0, 11);
        focusSlot(slot);
        dragRef.current = "slot";
        dragStartY.current = e.clientY;
        dragStartAmt.current = st.current[slot]?.amount ?? 0;
        wrap.setPointerCapture(e.pointerId);
        return;
      }

      // Focus nearest active route by Y, or first active
      const act = activeRoutes(st.current);
      if (act.length > 0) {
        const n = act.length;
        const idx = clamp(Math.floor(((y - 20) / Math.max(1, H * 0.7 - 20)) * n), 0, n - 1);
        const route = act[idx]!;
        focusSlot(route.slot);
        dragRef.current = "amt";
        dragStartY.current = e.clientY;
        dragStartAmt.current = route.amount;
        wrap.setPointerCapture(e.pointerId);
      }
    },
    [focusSlot],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const mode = dragRef.current;
      if (!mode) return;
      const slot = focusRef.current;
      const r = st.current[slot];
      if (!r || r.source === "none" || r.dest === "none") {
        // Slot focus only — still allow amount if we activate? skip
        if (mode === "slot" && r && (r.source !== "none" || r.dest !== "none")) {
          const amount = clamp(dragStartAmt.current + (dragStartY.current - e.clientY) / 110, -1, 1);
          setModRoute(slot, { amount: Math.round(amount * 100) / 100 });
        }
        return;
      }
      const amount = clamp(dragStartAmt.current + (dragStartY.current - e.clientY) / 110, -1, 1);
      setModRoute(slot, { amount: Math.round(amount * 100) / 100 });
    },
    [setModRoute],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const slot = focusRef.current;
    const r = st.current[slot];
    if (r && r.source !== "none" && r.dest !== "none") {
      setModRoute(slot, { source: "none", dest: "none", amount: 0 });
    } else {
      // Jump focus to next active
      const act = activeRoutes(st.current);
      if (act.length) {
        const i = act.findIndex((a) => a.slot === slot);
        const next = act[(i + 1) % act.length]!;
        focusSlot(next.slot);
      }
    }
  }, [setModRoute, focusSlot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const mx = st.current;
      flashRef.current *= 0.86;
      const routes = activeRoutes(mx);
      const focus = focusRef.current;
      const energy = 0.12 + Math.min(1, routes.length / 6) * 0.35 + flashRef.current * 0.25;

      ctx.clearRect(0, 0, W, Hh);

      const bg = ctx.createRadialGradient(W * 0.5, Hh * 0.42, 6, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.3 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(2,6,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Loom warp threads (vertical dest guides)
      ctx.strokeStyle = hexAlpha(C_MID, 0.06 + routes.length * 0.01);
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const x = W * (0.22 + i * 0.08);
        ctx.beginPath();
        ctx.moveTo(x, 22);
        ctx.lineTo(x, Hh * 0.72);
        ctx.stroke();
      }

      const leftX = 72;
      const rightX = W - 72;
      const topY = 24;
      const botY = Hh * 0.72;

      // SRC / DST rails
      ctx.fillStyle = hexAlpha(C_MID, 0.12);
      ctx.fillRect(12, 14, 48, Hh * 0.68);
      ctx.fillRect(W - 60, 14, 48, Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_HOT, 0.28);
      ctx.strokeRect(12.5, 14.5, 47, Hh * 0.68 - 1);
      ctx.strokeRect(W - 59.5, 14.5, 47, Hh * 0.68 - 1);
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.textAlign = "center";
      ctx.fillText("SRC", 36, Hh * 0.72 + 2);
      ctx.fillText("DST", W - 36, Hh * 0.72 + 2);

      if (routes.length === 0) {
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("LOOM IDLE — patch a cell below", W / 2, Hh * 0.42);
      } else {
        routes.forEach((r, i) => {
          const n = routes.length;
          const y1 = topY + ((i + 0.5) / n) * (botY - topY);
          const destIdx = Math.max(0, DST_META.findIndex((d) => d.id === r.dest));
          const y2 = topY + ((destIdx + 0.5) / DST_META.length) * (botY - topY);
          const mag = Math.abs(r.amount);
          const col = r.amount >= 0 ? C_POS : C_NEG;
          const focused = r.slot === focus;
          const cpx = (leftX + rightX) / 2;
          const bend = 22 + mag * 40;

          // Weave cable layers
          ctx.beginPath();
          ctx.moveTo(leftX, y1);
          ctx.bezierCurveTo(cpx - bend, y1, cpx + bend, y2, rightX, y2);
          ctx.strokeStyle = hexAlpha(col, (focused ? 0.35 : 0.15) + mag * 0.3);
          ctx.lineWidth = (focused ? 7 : 5) + mag * 5;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(leftX, y1);
          ctx.bezierCurveTo(cpx - bend, y1, cpx + bend, y2, rightX, y2);
          ctx.strokeStyle = hexAlpha(col, 0.45 + mag * 0.45 + (focused ? 0.2 : 0));
          ctx.lineWidth = 2 + mag * 3 + (focused ? 1 : 0);
          ctx.stroke();

          // Packets
          const pk = mag > 0.55 ? 3 : 2;
          for (let p = 0; p < pk; p++) {
            const u = ((now / (1000 - mag * 320)) + i * 0.12 + p / pk) % 1;
            const mt = 1 - u;
            const px =
              mt * mt * mt * leftX +
              3 * mt * mt * u * (cpx - bend) +
              3 * mt * u * u * (cpx + bend) +
              u * u * u * rightX;
            const py =
              mt * mt * mt * y1 +
              3 * mt * mt * u * y1 +
              3 * mt * u * u * y2 +
              u * u * u * y2;
            const wake = ctx.createRadialGradient(px, py, 0, px, py, 8 + mag * 5);
            wake.addColorStop(0, hexAlpha(col, 0.55));
            wake.addColorStop(1, hexAlpha(col, 0));
            ctx.fillStyle = wake;
            ctx.beginPath();
            ctx.arc(px, py, 8 + mag * 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
            ctx.beginPath();
            ctx.arc(px, py, 2 + mag * 2, 0, Math.PI * 2);
            ctx.fill();
          }

          // Junctions
          ctx.fillStyle = hexAlpha(col, 0.9);
          ctx.shadowBlur = focused ? 14 : 8;
          ctx.shadowColor = col;
          ctx.beginPath();
          ctx.arc(leftX, y1, 3.2 + mag * 1.5 + (focused ? 1 : 0), 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(rightX, y2, 3.2 + mag * 1.5 + (focused ? 1 : 0), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          const srcLab = SRC_META.find((s) => s.id === r.source)?.label ?? r.source;
          const dstLab = DST_META.find((d) => d.id === r.dest)?.label ?? r.dest;
          ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(col, focused ? 0.95 : 0.65);
          ctx.textAlign = "right";
          ctx.fillText(srcLab, leftX - 8, y1 + 3);
          ctx.textAlign = "left";
          ctx.fillText(dstLab, rightX + 8, y2 + 3);

          if (focused) {
            ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
            ctx.textAlign = "center";
            ctx.fillText(`${r.amount >= 0 ? "+" : ""}${Math.round(r.amount * 100)}`, W / 2, y1 < y2 ? y1 - 6 : y2 - 6);
          }
        });
      }

      // Focus chip
      const fr = mx[focus];
      const chip =
        fr && fr.source !== "none" && fr.dest !== "none"
          ? `S${focus + 1} · ${fr.source}→${fr.dest}`
          : `S${focus + 1} · empty`;
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 5, chipW, 13);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 5, chipW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 15);

      // Slot rail
      const railY = Hh - 16;
      const slotW = (W - 24) / 12;
      for (let i = 0; i < 12; i++) {
        const r = mx[i]!;
        const on = r.source !== "none" && r.dest !== "none";
        const sx = 12 + i * slotW;
        const col = !on ? C_MID : r.amount >= 0 ? C_POS : C_NEG;
        const focused = i === focus;
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(sx + 1, railY, slotW - 2, 7);
        if (on) {
          const hBar = 5 * Math.abs(r.amount);
          ctx.fillStyle = hexAlpha(col, 0.7);
          ctx.fillRect(sx + 2, railY + 6 - hBar, slotW - 4, hBar);
        }
        if (focused) {
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.9);
          ctx.strokeRect(sx + 0.5, railY - 0.5, slotW - 1, 8);
        }
      }
      ctx.fillStyle = hexAlpha(C_HOT, 0.75);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("SLOTS · drag ↕ depth", 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("MTX · PATCH LOOM", 12, Hh - 2);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(routes.length ? C_HOT : C_MID, 0.88);
      ctx.fillText(routes.length ? `${routes.length} LIVE` : "IDLE", W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
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
        cursor: "ns-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Click cable/slot to focus · drag ↕ amount · bottom: slots · double-click: clear focus"
      role="img"
      aria-label="Modulation matrix patch loom"
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
        Patch Loom
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        {used}/12
      </div>
    </div>
  );
}
