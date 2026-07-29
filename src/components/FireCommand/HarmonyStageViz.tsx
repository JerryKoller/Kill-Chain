/**
 * Harmony — Kin Halo stage visualizer.
 * Scale-locked companion voices (Signal Path Perf · FC.harmony).
 * Click constellation to cycle mode · drag level rail · double-click cycles.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES } from "@/state/fireSequencerStore";
import type { HarmonyMode } from "@/audio/dsp/FireCommandSynth";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.harmony;
const C_DEEP = bandShade(FC_BAND.perf, 0.32);
const C_MID = bandShade(FC_BAND.perf, 0.48);
const C_HOT = bandShade(FC_BAND.perf, 0.62);
const C_GLOW = bandShade(FC_BAND.perf, 0.92);
const C_ROOT = bandShade(FC_BAND.perf, 0.55);
const C_KIN = bandShade(FC_BAND.perf, 0.78);
const C_LINK = bandShade(FC_BAND.perf, 0.7);

export const HARMONY_MODES: { id: HarmonyMode; label: string; short: string; voices: number; intervals: string }[] = [
  { id: "off", label: "Off", short: "OFF", voices: 1, intervals: "—" },
  { id: "third", label: "Third", short: "3rd", voices: 2, intervals: "+3" },
  { id: "fifth", label: "Fifth", short: "5th", voices: 2, intervals: "+5" },
  { id: "octave", label: "Octave", short: "Oct", voices: 2, intervals: "+8ve" },
  { id: "triad", label: "Triad", short: "Tri", voices: 3, intervals: "+3 · +5" },
];

export function harmonyVoiceCount(mode: HarmonyMode): number {
  return HARMONY_MODES.find((m) => m.id === mode)?.voices ?? 1;
}

export function harmonyModeLabel(mode: HarmonyMode): string {
  return HARMONY_MODES.find((m) => m.id === mode)?.label ?? mode;
}

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

type DragMode = "level" | "cycle" | null;

export function HarmonyStageViz() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode) ?? "off";
  const level = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0.6;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["harmony"] !== false);
  const scaleRoot = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number; hue: number }[]>([]);
  const trails = useRef<{ x: number; y: number; age: number; voice: number }[]>([]);
  const st = useRef({ mode, level, enabled, scaleRoot, scaleId });
  st.current = { mode, level, enabled, scaleRoot, scaleId };

  const live = enabled && mode !== "off" && level > 0.02;

  useEffect(() => {
    const key = `${mode}|${level.toFixed(3)}|${enabled ? 1 : 0}|${scaleRoot}|${scaleId}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mode, level, enabled, scaleRoot, scaleId]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const cycleMode = useCallback(
    (dir = 1) => {
      const ids = HARMONY_MODES.map((m) => m.id);
      const i = ids.indexOf(st.current.mode);
      const next = ids[(i + dir + ids.length) % ids.length]!;
      setParam("harmonyMode", next);
      flashRef.current = 1;
    },
    [setParam],
  );

  const applyLevel = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("harmonyLevel", Math.round(x * 1000) / 1000);
    },
    [setParam],
  );

  const hitTest = useCallback((clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return "cycle";
    const rect = wrap.getBoundingClientRect();
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    if (y > 0.82) return "level";
    return "cycle";
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const modeHit = hitTest(e.clientY);
      dragRef.current = modeHit;
      flashRef.current = 1;
      if (modeHit === "level") applyLevel(e.clientX);
      else cycleMode(1);
    },
    [applyLevel, cycleMode, hitTest],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragRef.current !== "level") return;
      applyLevel(e.clientX);
    },
    [applyLevel],
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
      const active = s.enabled && s.mode !== "off";
      const meta = HARMONY_MODES.find((m) => m.id === s.mode) ?? HARMONY_MODES[0]!;
      const count = meta.voices;
      const breathe = 0.92 + 0.08 * Math.sin(t / 680);
      const spin = t * (0.00055 + s.level * 0.0009);

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createRadialGradient(W * 0.5, Hcss * 0.42, 4, W * 0.5, Hcss * 0.5, W * 0.72);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.85 + flash * 0.15));
      bg.addColorStop(0.55, "rgba(10,2,8,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.35 + (active ? 0.12 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Halo rings — expand with level
      const cx = W * 0.5;
      const cy = Hcss * 0.42;
      for (let ring = 0; ring < 4; ring++) {
        const rr = (18 + ring * 14 + s.level * 22) * breathe;
        ctx.strokeStyle = hexAlpha(C, (active ? 0.1 : 0.04) + s.level * 0.06 - ring * 0.015);
        ctx.lineWidth = 1 + (ring === 0 ? 0.6 : 0);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr * 1.15, rr * 0.55, spin * 0.15, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Scale degree arc (12 pitch classes)
      const scale = SCALES.find((sc) => sc.id === s.scaleId);
      const steps = scale?.steps ?? [0, 2, 4, 5, 7, 9, 11];
      const arcR = Math.min(W * 0.38, 70 + s.level * 18);
      const rootPc = ((s.scaleRoot % 12) + 12) % 12;
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
        const deg = (i - rootPc + 12) % 12;
        const inScale = steps.includes(deg);
        const isRoot = i === rootPc;
        const x = cx + Math.cos(a) * arcR * 0.92;
        const y = cy + Math.sin(a) * arcR * 0.42;
        const sz = isRoot ? 3.5 + s.level : inScale ? 2.2 : 1.2;
        ctx.fillStyle = isRoot
          ? hexAlpha(C_GLOW, 0.9)
          : inScale
            ? hexAlpha(C_KIN, 0.45 + s.level * 0.35)
            : hexAlpha(C, 0.12);
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
        if (isRoot) {
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.5);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, sz + 3 + flash * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Voice nodes
      const nodes: { x: number; y: number; i: number; label: string }[] = [];
      const labels =
        s.mode === "off"
          ? ["Root"]
          : s.mode === "third"
            ? ["Root", "+3"]
            : s.mode === "fifth"
              ? ["Root", "+5"]
              : s.mode === "octave"
                ? ["Root", "+8"]
                : ["Root", "+3", "+5"];

      for (let i = 0; i < count; i++) {
        const spread = count === 1 ? 0 : (i / (count - 1) - 0.5) * Math.PI * 1.1;
        const a = -Math.PI / 2 + spread + spin * (1 + i * 0.35);
        const r = (22 + i * 16 + s.level * 20) * breathe;
        const x = cx + Math.cos(a) * r * 0.95;
        const y = cy + Math.sin(a) * r * 0.48;
        nodes.push({ x, y, i, label: labels[i] ?? `V${i}` });
      }

      // Kin links
      if (count > 1 && active) {
        for (let i = 1; i < nodes.length; i++) {
          const root = nodes[0]!;
          const n = nodes[i]!;
          const g = ctx.createLinearGradient(root.x, root.y, n.x, n.y);
          g.addColorStop(0, hexAlpha(C_ROOT, 0.55 + s.level * 0.35));
          g.addColorStop(1, hexAlpha(C_KIN, 0.35 + s.level * 0.4));
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.4 + s.level * 1.8;
          ctx.shadowBlur = 8 + s.level * 10;
          ctx.shadowColor = hexAlpha(C_LINK, 0.6);
          ctx.beginPath();
          ctx.moveTo(root.x, root.y);
          // slight arc
          const mx = (root.x + n.x) / 2 + Math.sin(spin * 2 + i) * 6;
          const my = (root.y + n.y) / 2 - 8 - s.level * 6;
          ctx.quadraticCurveTo(mx, my, n.x, n.y);
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Mid spark
          const pulse = 0.5 + 0.5 * Math.sin(t / 90 + i);
          ctx.fillStyle = hexAlpha(C_GLOW, pulse * s.level * 0.7);
          ctx.beginPath();
          ctx.arc(mx, my, 2 + pulse * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Nodes
      for (const n of nodes) {
        const isRoot = n.i === 0;
        const sz = (isRoot ? 7 : 5.5 - n.i * 0.4) + s.level * (isRoot ? 4 : 3);
        const alpha = active ? (isRoot ? 0.85 : 0.6 + s.level * 0.3) : 0.35;
        const col = isRoot ? C_ROOT : C_KIN;

        const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, sz * 2.8);
        halo.addColorStop(0, hexAlpha(C_GLOW, alpha * 0.7));
        halo.addColorStop(0.45, hexAlpha(col, alpha * 0.35));
        halo.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.x, n.y, sz * 2.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexAlpha(C_GLOW, alpha + 0.1);
        ctx.shadowBlur = 8 + s.level * 12 + flash * 6;
        ctx.shadowColor = hexAlpha(C_HOT, 0.75);
        ctx.beginPath();
        ctx.arc(n.x, n.y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Core gem
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(n.x - sz * 0.2, n.y - sz * 0.25, Math.max(1.2, sz * 0.28), 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
        ctx.textAlign = "center";
        ctx.fillText(n.label, n.x, n.y + sz + 11);

        if (active && s.level > 0.08) {
          trails.current.push({ x: n.x, y: n.y, age: 0, voice: n.i });
          if (trails.current.length > 80) trails.current.shift();
        }
      }

      // Ghost trails
      for (let i = trails.current.length - 1; i >= 0; i--) {
        const tr = trails.current[i]!;
        tr.age += 0.018;
        if (tr.age > 1) {
          trails.current.splice(i, 1);
          continue;
        }
        const life = 1 - tr.age;
        ctx.fillStyle = hexAlpha(tr.voice === 0 ? C_ROOT : C_KIN, life * s.level * 0.35);
        const sz = life * (2.5 + s.level);
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, sz, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sparks when live
      if (active) {
        if (Math.random() < 0.2 + s.level * 0.35) {
          const ang = Math.random() * Math.PI * 2;
          const rr = 20 + Math.random() * (30 + s.level * 40);
          sparks.current.push({
            x: cx + Math.cos(ang) * rr * 0.9,
            y: cy + Math.sin(ang) * rr * 0.45,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -0.2 - Math.random() * 0.6,
            life: 1,
            hue: Math.random(),
          });
          if (sparks.current.length > 50) sparks.current.shift();
        }
        for (let i = sparks.current.length - 1; i >= 0; i--) {
          const p = sparks.current[i]!;
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.016;
          if (p.life <= 0) {
            sparks.current.splice(i, 1);
            continue;
          }
          ctx.fillStyle = hexAlpha(p.hue > 0.5 ? C_GLOW : C_HOT, p.life * 0.6);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.2 + p.life * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Level rail
      const padX = 12;
      const usable = W - padX * 2;
      const railY = Hcss - 10;
      ctx.strokeStyle = hexAlpha(C, 0.22);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(W - padX, railY);
      ctx.stroke();
      const thumbX = padX + s.level * usable;
      ctx.strokeStyle = hexAlpha(C_HOT, 0.85);
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 4.5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();

      const rootName = NOTE_NAMES[((s.scaleRoot % 12) + 12) % 12] ?? "?";
      const scaleLabel = SCALES.find((sc) => sc.id === s.scaleId)?.label ?? s.scaleId;

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      ctx.fillText(
        !s.enabled
          ? "KIN HALO · BYPASS"
          : active
            ? `KIN HALO · ${meta.short.toUpperCase()}`
            : "KIN HALO · SILENT",
        10,
        Hcss - 8,
      );
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(
        `${rootName} ${scaleLabel} · ${Math.round(s.level * 100)}% · ${count}v`,
        W - 10,
        Hcss - 8,
      );
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
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
      role="img"
      aria-label="Kin halo — click to cycle mode, scrub level"
      title="Click cycles mode · Bottom: Level"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
