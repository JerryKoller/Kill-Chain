/**
 * Scenes — Orbit Vault stage visualizer.
 * Eight patch-memory slots (Signal Path Perf · FC.scenes).
 * Click a node to act · top cycles Capture/Recall/Clear · bottom captures next empty.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import type { FirePatch } from "@/audio/dsp/FireCommandSynth";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.scenes;
const C_DEEP = bandShade(FC_BAND.perf, 0.48);
const C_MID = bandShade(FC_BAND.perf, 0.62);
const C_HOT = bandShade(FC_BAND.perf, 0.78);
const C_GLOW = bandShade(FC_BAND.perf, 0.98);
const C_EMPTY = bandShade(FC_BAND.perf, 0.4);
const C_FILL = bandShade(FC_BAND.perf, 0.7);
const C_ACTIVE = bandShade(FC_BAND.perf, 0.9);

export type SceneMode = "capture" | "recall" | "clear";

export const SCENE_MODES: { id: SceneMode; label: string; short: string }[] = [
  { id: "capture", label: "Capture", short: "CAP" },
  { id: "recall", label: "Recall", short: "REC" },
  { id: "clear", label: "Clear", short: "CLR" },
];

/** Visual fingerprint from a stored patch snapshot. */
export function sceneFingerprint(snap: Partial<FirePatch> | null | undefined): {
  energy: number;
  warmth: number;
  density: number;
} {
  if (!snap) return { energy: 0, warmth: 0, density: 0 };
  const g = typeof snap.masterGain === "number" ? snap.masterGain / 1.2 : 0.5;
  const drv = typeof snap.drive === "number" ? snap.drive : 0;
  const filt = typeof snap.filterCutoff === "number" ? snap.filterCutoff : 0.5;
  const rev = typeof snap.reverbMix === "number" ? snap.reverbMix : 0;
  const dly = typeof snap.delayMix === "number" ? snap.delayMix : 0;
  const macros =
    ((snap.macro1 ?? 0) + (snap.macro2 ?? 0) + (snap.macro3 ?? 0) + (snap.macro4 ?? 0)) / 4;
  const enabled = snap.moduleEnable ? Object.values(snap.moduleEnable).filter(Boolean).length / 24 : 0.5;
  return {
    energy: Math.max(0, Math.min(1, g * 0.35 + drv * 0.25 + macros * 0.2 + enabled * 0.2)),
    warmth: Math.max(0, Math.min(1, (1 - filt) * 0.5 + rev * 0.3 + dly * 0.2)),
    density: Math.max(0, Math.min(1, enabled * 0.5 + macros * 0.3 + drv * 0.2)),
  };
}

export function occupiedCount(scenes: (Partial<FirePatch> | null)[]): number {
  return scenes.filter(Boolean).length;
}

export function firstEmptySlot(scenes: (Partial<FirePatch> | null)[]): number {
  const i = scenes.findIndex((s) => !s);
  return i >= 0 ? i : 0;
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
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

export function ScenesStageViz({
  mode,
  onModeChange,
  activeSlot,
  onActiveSlot,
}: {
  mode: SceneMode;
  onModeChange: (m: SceneMode) => void;
  activeSlot: number;
  onActiveSlot: (i: number) => void;
}) {
  const scenes = useFireCommandStore((s) => s.scenes);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scenes"] !== false);
  const captureScene = useFireCommandStore((s) => s.captureScene);
  const recallScene = useFireCommandStore((s) => s.recallScene);
  const clearScene = useFireCommandStore((s) => s.clearScene);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const flashSlotRef = useRef(-1);
  const prevKey = useRef("");
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const st = useRef({ scenes, enabled, mode, activeSlot });
  st.current = { scenes, enabled, mode, activeSlot };

  const filled = occupiedCount(scenes);
  const live = enabled && filled > 0;

  useEffect(() => {
    const key = `${filled}|${mode}|${activeSlot}|${enabled ? 1 : 0}|${scenes.map((s) => (s ? 1 : 0)).join("")}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [filled, mode, activeSlot, enabled, scenes]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const actOnSlot = useCallback(
    (i: number) => {
      if (!st.current.enabled) return;
      const m = st.current.mode;
      flashSlotRef.current = i;
      flashRef.current = 1;
      onActiveSlot(i);
      if (m === "capture") captureScene(i);
      else if (m === "recall") {
        if (st.current.scenes[i]) recallScene(i);
      } else if (st.current.scenes[i]) clearScene(i);
    },
    [captureScene, clearScene, onActiveSlot, recallScene],
  );

  const cycleMode = useCallback(
    (dir = 1) => {
      const ids = SCENE_MODES.map((m) => m.id);
      const i = ids.indexOf(st.current.mode);
      onModeChange(ids[(i + dir + ids.length) % ids.length]!);
      flashRef.current = 1;
    },
    [onModeChange],
  );

  const hitSlot = useCallback((clientX: number, clientY: number): number => {
    const wrap = wrapRef.current;
    if (!wrap) return -1;
    const rect = wrap.getBoundingClientRect();
    const { w: W, h: Hcss } = sizeRef.current;
    const cx = W * 0.5;
    const cy = Hcss * 0.5;
    const radius = Math.min(W, Hcss) * 0.34;
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * Hcss;
    let best = -1;
    let bestD = 28;
    for (let i = 0; i < SCENE_SLOTS; i++) {
      const angle = (i / SCENE_SLOTS) * Math.PI * 2 - Math.PI / 2;
      const nx = cx + Math.cos(angle) * radius;
      const ny = cy + Math.sin(angle) * radius;
      const d = Math.hypot(x - nx, y - ny);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yNorm = (e.clientY - rect.top) / Math.max(1, rect.height);
      flashRef.current = 1;
      if (yNorm < 0.12) {
        cycleMode(1);
        return;
      }
      if (yNorm > 0.88) {
        const empty = firstEmptySlot(st.current.scenes);
        onModeChange("capture");
        actOnSlot(empty);
        return;
      }
      const slot = hitSlot(e.clientX, e.clientY);
      if (slot >= 0) actOnSlot(slot);
    },
    [actOnSlot, cycleMode, hitSlot, onModeChange],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (t) => {
      flashRef.current *= 0.9;
      if (flashRef.current < 0.12) flashSlotRef.current = -1;

      const { w: W, h: Hcss } = sizeRef.current;
      if (W < 2) return;
      const s = st.current;
      const flash = flashRef.current;
      const breathe = 0.92 + 0.08 * Math.sin(t / 700);
      const n = SCENE_SLOTS;
      const occ = occupiedCount(s.scenes);
      const modeMeta = SCENE_MODES.find((m) => m.id === s.mode) ?? SCENE_MODES[0]!;

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createRadialGradient(W * 0.5, Hcss * 0.48, 4, W * 0.5, Hcss * 0.5, W * 0.72);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.8 + flash * 0.15));
      bg.addColorStop(0.55, "rgba(14,2,12,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.3 + (occ > 0 ? 0.12 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Mode strip
      const padX = 10;
      const usable = W - padX * 2;
      const stripY = 6;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(padX, stripY, usable, 8);
      const segW = usable / SCENE_MODES.length;
      for (let i = 0; i < SCENE_MODES.length; i++) {
        const hit = SCENE_MODES[i]!.id === s.mode;
        ctx.fillStyle = hit ? hexAlpha(C_HOT, 0.85 + flash * 0.15) : hexAlpha(C, 0.12);
        ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, 6);
      }
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.textAlign = "left";
      ctx.fillText(`MODE · ${modeMeta.label.toUpperCase()}`, padX, stripY - 1);

      const cx = W * 0.5;
      const cy = Hcss * 0.52;
      const radius = Math.min(W, Hcss) * 0.34;

      // Orbit ring
      ctx.strokeStyle = hexAlpha(C, 0.12 + occ * 0.03);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = hexAlpha(C, 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
      ctx.stroke();

      // Nebula wisps scale with occupancy
      for (let w = 0; w < Math.min(4, 1 + occ); w++) {
        const wx = cx + Math.sin(t * 0.0007 + w) * radius * 0.5;
        const wy = cy + Math.cos(t * 0.0005 + w * 1.3) * radius * 0.35;
        const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, 22 + occ * 4);
        wg.addColorStop(0, hexAlpha(C_HOT, 0.04 + occ * 0.015 + flash * 0.04));
        wg.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = wg;
        ctx.beginPath();
        ctx.arc(wx, wy, 22 + occ * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      const nodes: { x: number; y: number; i: number; filled: boolean; fp: ReturnType<typeof sceneFingerprint> }[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + t * 0.00035;
        const snap = s.scenes[i];
        const filledSlot = !!snap;
        const fp = sceneFingerprint(snap);
        const r = radius * (filledSlot ? 0.92 + fp.energy * 0.08 : 1);
        nodes.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          i,
          filled: filledSlot,
          fp,
        });
      }

      // Links between filled neighbors
      const filledNodes = nodes.filter((nd) => nd.filled);
      for (let i = 0; i < filledNodes.length; i++) {
        const a = filledNodes[i]!;
        const b = filledNodes[(i + 1) % filledNodes.length]!;
        if (filledNodes.length < 2) break;
        const pulse = 0.2 + 0.25 * Math.sin(t / 280 + i);
        ctx.strokeStyle = hexAlpha(C_FILL, pulse * (0.4 + a.fp.energy * 0.4));
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        const mx = (a.x + b.x) / 2 + (cy - (a.y + b.y) / 2) * 0.12;
        const my = (a.y + b.y) / 2 + ((a.x + b.x) / 2 - cx) * 0.12;
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();
      }

      // Nodes
      for (const nd of nodes) {
        const isActive = nd.i === s.activeSlot;
        const isFlash = nd.i === flashSlotRef.current;
        const sz = nd.filled
          ? 6.5 + nd.fp.energy * 3 + (isActive ? 1.5 : 0) + (isFlash ? 2 : 0)
          : 3.5;
        const col = nd.filled
          ? nd.fp.warmth > 0.55
            ? C_HOT
            : C_FILL
          : C_EMPTY;
        const alpha = nd.filled ? 0.7 + nd.fp.density * 0.25 : 0.25;

        if (nd.filled) {
          const halo = ctx.createRadialGradient(nd.x, nd.y, 0, nd.x, nd.y, sz * 3);
          halo.addColorStop(0, hexAlpha(C_GLOW, alpha * 0.55 * breathe));
          halo.addColorStop(1, hexAlpha(col, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, sz * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = hexAlpha(nd.filled ? C_GLOW : C, alpha);
        ctx.shadowBlur = nd.filled ? 8 + nd.fp.energy * 10 + (isFlash ? 12 : 0) : 0;
        ctx.shadowColor = hexAlpha(C_HOT, 0.75);
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isActive || isFlash) {
          ctx.strokeStyle = hexAlpha(C_ACTIVE, 0.9);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, sz + 5 + flash * 2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (nd.filled) {
          ctx.strokeStyle = hexAlpha(C, 0.35 + nd.fp.density * 0.25);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, sz + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.font = nd.filled ? "700 9px ui-sans-serif, system-ui, sans-serif" : "600 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = nd.filled ? "rgba(20,8,16,0.9)" : hexAlpha(C, 0.45);
        ctx.textAlign = "center";
        ctx.fillText(`${nd.i + 1}`, nd.x, nd.y + 3);

        // Density ticks
        if (nd.filled && nd.fp.density > 0.2) {
          const ticks = Math.round(nd.fp.density * 4);
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.35);
          ctx.lineWidth = 1;
          for (let k = 0; k < ticks; k++) {
            const a = -Math.PI / 2 + (k / ticks) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(nd.x + Math.cos(a) * (sz + 6), nd.y + Math.sin(a) * (sz + 6));
            ctx.lineTo(nd.x + Math.cos(a) * (sz + 9), nd.y + Math.sin(a) * (sz + 9));
            ctx.stroke();
          }
        }
      }

      // Center gem
      ctx.fillStyle = hexAlpha(C_GLOW, 0.35 + occ * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, 4 + occ * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Sparks from filled slots
      if (occ > 0 && s.enabled) {
        if (Math.random() < 0.12 + occ * 0.04) {
          const nd = filledNodes[Math.floor(Math.random() * filledNodes.length)];
          if (nd) {
            sparks.current.push({
              x: nd.x,
              y: nd.y,
              vx: (Math.random() - 0.5) * 0.8,
              vy: (Math.random() - 0.5) * 0.8,
              life: 1,
            });
            if (sparks.current.length > 40) sparks.current.shift();
          }
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
          ctx.arc(p.x, p.y, 1.2 + p.life * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Bottom hint rail
      const railY = Hcss - 10;
      ctx.strokeStyle = hexAlpha(C, 0.22);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(W - padX, railY);
      ctx.stroke();
      const fillT = occ / n;
      ctx.strokeStyle = hexAlpha(C_HOT, 0.85);
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(padX + fillT * usable, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(padX + fillT * usable, railY, 4.5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      ctx.fillText(
        !s.enabled
          ? "ORBIT VAULT · BYPASS"
          : `ORBIT VAULT · ${modeMeta.short} · ${occ}/${n}`,
        10,
        Hcss - 8,
      );
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(
        s.activeSlot >= 0 ? `SLOT ${s.activeSlot + 1}` : "TAP NODE",
        W - 10,
        Hcss - 8,
      );
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
        dragging: false,
        particles: 0,
        motionKey: `${st.current.mode}|${st.current.activeSlot}`,
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
        opacity: enabled ? 1 : 0.7,
      }}
      onPointerDown={onPointerDown}
      role="img"
      aria-label="Orbit vault — click slots, top cycles mode, bottom captures next empty"
      title="Nodes: act · Top: mode · Bottom: capture next empty"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
