/**
 * Scope panel helpers — Lumen Trace characters, view modes, meters, osc stacks.
 * Used by ScopePanel in FireCommandView (needs FParamKnob / Section).
 */

import { useEffect, useRef } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { FC, FC_BAND, bandShade } from "./fireColors";
import type { ScopeVizState } from "./ScopeStageViz";
import { SCOPE_DEFAULT_VIZ } from "./ScopeStageViz";
export const SCOPE_C = FC.scope;
export const SCOPE_C_GLOW = bandShade(FC_BAND.mix, 0.94);
export const SCOPE_C_HOT = bandShade(FC_BAND.mix, 0.68);
export const SCOPE_C_A = bandShade(FC_BAND.mix, 0.42);
export const SCOPE_C_B = bandShade(FC_BAND.mix, 0.58);
export const SCOPE_C_C = bandShade(FC_BAND.mix, 0.74);
export const SCOPE_C_MST = bandShade(FC_BAND.mix, 0.88);

export type ScopeViewMode = "all" | "master" | "oscs";

export { SCOPE_DEFAULT_VIZ };
export type { ScopeVizState };

export function ScopeMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format: () => string;
}) {
  const t = Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.1rem]" title={`${label} ${format()}`}>
      <div className="fc-text-floor font-black uppercase tracking-[0.06em]" style={{ color: `${color}aa` }}>
        {label}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {format()}
      </div>
    </div>
  );
}

export function ScopeViewStrip({
  mode,
  onChange,
}: {
  mode: ScopeViewMode;
  onChange: (m: ScopeViewMode) => void;
}) {
  const opts: { id: ScopeViewMode; label: string }[] = [
    { id: "all", label: "Dual" },
    { id: "master", label: "Master" },
    { id: "oscs", label: "Stacks" },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${SCOPE_C}66` }}>
        View
      </span>
      {opts.map((o) => {
        const on = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-black transition"
            style={
              on
                ? {
                    borderColor: `${SCOPE_C}99`,
                    background: `${SCOPE_C}33`,
                    color: SCOPE_C_GLOW,
                    boxShadow: `0 0 10px ${SCOPE_C}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScopeZoomStrip({
  zoom,
  onChange,
}: {
  zoom: number;
  onChange: (z: number) => void;
}) {
  const snaps = [0.5, 1, 1.5, 2, 2.5];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${SCOPE_C}66` }}>
        Zoom
      </span>
      {snaps.map((z) => {
        const on = Math.abs(zoom - z) < 0.08;
        return (
          <button
            key={z}
            type="button"
            onClick={() => onChange(z)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-black tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${SCOPE_C_HOT}99`,
                    background: `${SCOPE_C_HOT}28`,
                    color: SCOPE_C_GLOW,
                    boxShadow: `0 0 8px ${SCOPE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            ×{z}
          </button>
        );
      })}
    </div>
  );
}

export function ScopeQuickActions({
  viz,
  onVizChange,
}: {
  viz: ScopeVizState;
  onVizChange: (patch: Partial<ScopeVizState>) => void;
}) {
  const setParam = useFireCommandStore((s) => s.setParam);
  const pathOn = useFireCommandStore((s) => s.patch.pathScope !== false);
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => onVizChange({ freeze: !viz.freeze })}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          viz.freeze
            ? { borderColor: `${SCOPE_C}99`, color: SCOPE_C_GLOW, background: `${SCOPE_C}33`, boxShadow: `0 0 10px ${SCOPE_C}44` }
            : { borderColor: `${SCOPE_C}55`, color: SCOPE_C_GLOW, background: `${SCOPE_C}1c` }
        }
        title="Freeze the live trace"
      >
        {viz.freeze ? "Frozen" : "Freeze"}
      </button>
      <button
        type="button"
        onClick={() => onVizChange({ zoom: 1, phosphor: 5, freeze: false })}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCOPE_C}55`, color: SCOPE_C_GLOW, background: `${SCOPE_C}1c` }}
        title="Reset zoom + phosphor"
      >
        Reset
      </button>
      {/* Path tap ≠ module sleep: this bypasses the SCOPE node, the toggle below sleeps the module. */}
      <button
        type="button"
        onClick={() => setParam("pathScope", !pathOn)}
        className="fc-focus rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.06em] transition"
        style={
          pathOn
            ? { borderColor: `${SCOPE_C}66`, color: SCOPE_C_GLOW, background: `${SCOPE_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={pathOn ? "Bypass the Signal Path SCOPE tap" : "Engage the Signal Path SCOPE tap"}
        aria-pressed={pathOn}
      >
        {pathOn ? "Path On" : "Path Off"}
      </button>
    </div>
  );
}

/** Wavetable stack for Osc A/B/C — mix-band tangerine shades. */
export function ScopeOscWave({ group, color }: { group: "a" | "b" | "c"; color: string }) {
  const table = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscATable : group === "b" ? s.patch.oscBTable : s.patch.oscCTable,
  );
  const level = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscALevel : group === "b" ? s.patch.oscBLevel : s.patch.oscCLevel,
  ) ?? 0;
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef(0);
  const prevTable = useRef(table);

  useEffect(() => {
    if (prevTable.current !== table) {
      prevTable.current = table;
      flashRef.current = 1;
    }
  }, [table]);

  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastTick = 0;
    let lastPos = -1;
    const MIN_INTERVAL = 33;
    const cache: Float32Array[] = [];
    let cacheTable = "";
    const N = 96;
    const size = { w: 250, h: 88 };
    const ensureCache = (id: string) => {
      if (cacheTable === id && cache.length) return;
      cache.length = 0;
      for (let i = 0; i < FRAME_COUNT; i++) cache.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
      cacheTable = id;
    };
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      size.w = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      size.h = 88;
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastPos = -1;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < MIN_INTERVAL) return;
      lastTick = nowMs;
      flashRef.current *= 0.92;
      let pos = 0.5;
      try {
        pos = activeFireEngine().getMorphPositions()[group];
      } catch { /* */ }
      if (lastPos >= 0 && Math.abs(pos - lastPos) < 0.0008 && flashRef.current < 0.02) return;
      lastPos = pos;
      ensureCache(table);
      const w = size.w;
      const h = size.h;
      const flash = flashRef.current;
      const lvl = Math.max(0.15, level);
      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, `${color}${Math.round(0x18 + flash * 40).toString(16).padStart(2, "0")}`);
      bg.addColorStop(0.45, "rgba(4,3,2,0.88)");
      bg.addColorStop(1, `${color}12`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      for (let g = 0; g < 4; g++) {
        const y = 10 + g * ((h - 24) / 3);
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(w - 6, y);
        ctx.stroke();
      }

      const curFrame = pos * (FRAME_COUNT - 1);
      const padX = 12;
      const skew = Math.min(24, w * 0.08);
      const topY = 12;
      const usableW = Math.max(8, w - padX * 2 - skew);
      const amp = h * 0.07 * (0.7 + lvl * 0.5);
      for (let i = 0; i < FRAME_COUNT; i++) {
        const depth = i / (FRAME_COUNT - 1);
        const baseY = topY + depth * (h - topY - 20);
        const xoff = padX + (1 - depth) * skew;
        const near = 1 - Math.min(1, Math.abs(i - curFrame));
        ctx.beginPath();
        const samp = cache[i]!;
        for (let x = 0; x < N; x++) {
          const px = xoff + (x / (N - 1)) * usableW;
          const py = baseY - samp[x]! * amp;
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = `rgba(255,255,255,${0.04 + depth * 0.06})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (near > 0.001) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = near * 0.85 * (0.5 + lvl * 0.5);
          ctx.lineWidth = 1.5;
          ctx.shadowBlur = 4 + flash * 8;
          ctx.shadowColor = color;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }
      const lo = Math.floor(curFrame);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = curFrame - lo;
      const frontY = h - 12;
      ctx.beginPath();
      ctx.moveTo(padX, frontY);
      for (let x = 0; x < N; x++) {
        const v = cache[lo]![x]! * (1 - frac) + cache[hi]![x]! * frac;
        const px = padX + (x / (N - 1)) * (w - padX * 2);
        const py = frontY - v * (h * 0.13) * (0.7 + lvl * 0.5);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(w - padX, frontY);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, frontY - h * 0.18, 0, frontY);
      fill.addColorStop(0, `${color}44`);
      fill.addColorStop(1, `${color}00`);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      for (let x = 0; x < N; x++) {
        const v = cache[lo]![x]! * (1 - frac) + cache[hi]![x]! * frac;
        const px = padX + (x / (N - 1)) * (w - padX * 2);
        const py = frontY - v * (h * 0.13) * (0.7 + lvl * 0.5);
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 12 + flash * 10;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const mx = padX + pos * (w - padX * 2);
      const beam = ctx.createLinearGradient(mx, 0, mx, h);
      beam.addColorStop(0, `${color}00`);
      beam.addColorStop(0.35, `${color}55`);
      beam.addColorStop(1, `${color}00`);
      ctx.fillStyle = beam;
      ctx.fillRect(mx - 1.5, 4, 3, h - 10);

      ctx.font = "700 8px ui-monospace, Menlo, monospace";
      ctx.fillStyle = `${color}99`;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(pos * 100)}%`, w - 8, h - 5);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [table, group, color, level]);

  return (
    <div ref={wrapRef} className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-widest shrink-0" style={{ color: `${color}99` }}>
          Osc {group.toUpperCase()}
        </span>
        <span className="text-[10px] font-mono truncate" style={{ color }} title={wavetableName(table)}>
          {wavetableName(table)}
        </span>
      </div>
      <canvas
        ref={ref}
        className="block w-full h-[88px] rounded-md border bg-[#060402]/90"
        style={{
          borderColor: `${color}44`,
          boxShadow: `inset 0 0 0 1px ${color}14, inset 0 0 28px ${color}18, 0 0 16px ${color}10`,
          opacity: level < 0.02 ? 0.45 : 1,
        }}
      />
    </div>
  );
}

export function ScopeVoiceBadge() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    let lastN = -1;
    const tick = (nowMs: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (nowMs - lastTick < 120) return;
      lastTick = nowMs;
      if (!ref.current) return;
      let n = 0;
      try {
        n = activeFireEngine().getActiveVoiceCount();
      } catch {
        n = 0;
      }
      if (n === lastN) return;
      lastN = n;
      ref.current.textContent = `${n} voice${n === 1 ? "" : "s"}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span ref={ref} className="text-[10px] font-mono" style={{ color: `${SCOPE_C}aa` }}>
      0 voices
    </span>
  );
}
