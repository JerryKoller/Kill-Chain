/**
 * Core Fire Command stage visualizations (v2.5.6) — display-only
 * personalities for Unison, Filter, Envelopes, LFOs, FM·Ring, Pitch·Glide,
 * Oscillators, and Performance. Audio engines untouched.
 */

import { useEffect, useRef, type ReactNode, type RefObject, type MutableRefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import type { LfoWave, LfoDest } from "@/audio/dsp/FireCommandSynth";
import { FRAME_COUNT, frameSamples } from "@/audio/dsp/wavetables";
import { startStageVizLoop } from "./stageVizRaf";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const GRN = "#7cf6b0";
const GOLD = "#ffcf5c";
const AMB = "#ffb35c";
const LIME = "#9be564";
const TEAL = "#5ce0a0";

const ENV_H = 88;
const LFO_H = 96;
const OSC_H = 88;
const PERF_H = 76;

function useHiDpiCanvas(
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

type StageChrome = "corners" | "rails" | "notch" | "plate" | "bloom" | "scope" | "keys";

function StageFrame({
  children,
  border,
  height,
  wrapRef,
  chrome = "corners",
}: {
  children: ReactNode;
  border: string;
  height: number;
  wrapRef: RefObject<HTMLDivElement | null>;
  chrome?: StageChrome;
}) {
  const base =
    chrome === "plate"
      ? "relative mb-2.5 overflow-hidden rounded-lg border-2 bg-black/55 shadow-[inset_0_2px_8px_rgba(0,0,0,0.55),0_4px_14px_rgba(0,0,0,0.35)]"
      : chrome === "bloom"
        ? "relative mb-2.5 overflow-hidden rounded-2xl border bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_28px_rgba(0,0,0,0.35)]"
        : chrome === "scope"
          ? "relative mb-2.5 overflow-hidden rounded-md border bg-[#05080c]/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_24px_rgba(0,0,0,0.65),0_6px_18px_rgba(0,0,0,0.3)]"
          : chrome === "notch"
            ? "relative mb-2.5 overflow-hidden rounded-xl border bg-black/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.28)]"
            : chrome === "keys"
              ? "relative mb-2.5 overflow-hidden rounded-xl border bg-black/50 shadow-[inset_0_-2px_6px_rgba(255,255,255,0.04),0_6px_20px_rgba(0,0,0,0.28)]"
              : "relative mb-2.5 overflow-hidden rounded-xl border bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.28)]";

  return (
    <div
      ref={wrapRef as RefObject<HTMLDivElement>}
      className={base}
      style={{
        borderColor: border,
        height,
        boxShadow:
          chrome === "bloom"
            ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 32px ${border}, 0 6px 20px rgba(0,0,0,0.28)`
            : undefined,
      }}
    >
      {children}
      {chrome === "corners" && (
        <>
          <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: border }} />
          <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: border }} />
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: border }} />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: border }} />
        </>
      )}
      {chrome === "rails" && (
        <>
          <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: border }} />
          <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: border }} />
        </>
      )}
      {chrome === "notch" && (
        <>
          <span className="pointer-events-none absolute left-0 top-0 h-2 w-5" style={{ background: border, clipPath: "polygon(0 0, 100% 0, 70% 100%, 0 100%)" }} />
          <span className="pointer-events-none absolute right-0 top-0 h-2 w-5" style={{ background: border, clipPath: "polygon(0 0, 100% 0, 100% 100%, 30% 100%)" }} />
          <span className="pointer-events-none absolute bottom-1 left-2 right-2 h-px opacity-40" style={{ background: border }} />
        </>
      )}
      {chrome === "scope" && (
        <span
          className="pointer-events-none absolute inset-1 rounded-[4px] border border-white/[0.04]"
          aria-hidden
        />
      )}
      {chrome === "keys" && (
        <>
          <span className="pointer-events-none absolute inset-x-3 bottom-1.5 h-0.5" style={{ background: border }} />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-20" style={{ background: `linear-gradient(90deg, transparent, ${border}, transparent)` }} />
        </>
      )}
    </div>
  );
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number, strength = 0.55) {
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.15, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

export { UnisonStageViz } from "./UnisonStageViz";

/** Filter — liquid cutoff waterfall + resonance bloom rings; react to filter type. */
export { FilterStageViz } from "./FilterStageViz";

export { AmpEnvStageViz } from "./AmpEnvStageViz";

export { ModEnvStageViz } from "./ModEnvStageViz";

export { FiltEnvStageViz } from "./FiltEnvStageViz";

/** LFO stage — living waveform with depth aurora, phase tracer, and destination readout. */
export function LfoStageViz({ idx }: { idx: 1 | 2 }) {
  const wave = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Wave : s.patch.lfo2Wave));
  const rate = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Rate : s.patch.lfo2Rate));
  const depth = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Depth : s.patch.lfo2Depth));
  const dest = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Dest : s.patch.lfo2Dest));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: LFO_H });
  const st = useRef({ wave, rate, depth, dest });
  st.current = { wave, rate, depth, dest };
  useHiDpiCanvas(wrapRef, canvasRef, LFO_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const shape = (w: LfoWave, ph: number): number => {
      const p = ph - Math.floor(ph);
      switch (w) {
        case "sine": return Math.sin(p * Math.PI * 2);
        case "triangle": return 1 - 4 * Math.abs(p - 0.5);
        case "sawtooth": return 1 - 2 * p;
        case "square": return p < 0.5 ? 1 : -1;
        case "sample-hold": {
          const step = Math.floor(ph * 8);
          const h = Math.sin(step * 127.1) * 43758.5453;
          return (h - Math.floor(h)) * 2 - 1;
        }
        default: return 0;
      }
    };
    const stopLoop = startStageVizLoop(
      (nowMs) => {
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(98,182,255,0.16)");
      bg.addColorStop(0.5, "rgba(4,8,14,0.6)");
      bg.addColorStop(1, "rgba(98,182,255,0.08)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.44;
      const amp = (H * 0.32) * Math.max(0.14, p.depth);
      const xL = 10;
      const xR = W - 10;
      const span = xR - xL;

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      ctx.lineTo(xR, mid);
      ctx.stroke();

      // Depth aurora (glowing gradient field below waveform)
      const auroraGrad = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      auroraGrad.addColorStop(0, hexAlpha(ICE, p.depth * 0.18));
      auroraGrad.addColorStop(0.5, hexAlpha(GRN, p.depth * 0.08));
      auroraGrad.addColorStop(1, hexAlpha(ICE, p.depth * 0.05));
      ctx.fillStyle = auroraGrad;
      ctx.fillRect(xL, mid - amp, span, amp * 2);

      // Ghost layer waveforms (phase offset)
      for (let ghost = 2; ghost >= 0; ghost--) {
        ctx.beginPath();
        for (let x = xL; x <= xR; x += 1.5) {
          const ph = ((x - xL) / span) * 2 + (ghost * 0.3);
          const y = mid - shape(p.wave, ph) * amp * (0.5 + ghost * 0.15);
          if (x === xL) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(GRN, (0.22 - ghost * 0.06) * p.depth);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Depth ribbon fill
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      for (let x = xL; x <= xR; x++) {
        const y = mid - shape(p.wave, ((x - xL) / span) * 2) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(xR, mid);
      ctx.closePath();
      const ribbon = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      ribbon.addColorStop(0, hexAlpha(ICE, 0.35 + p.depth * 0.2));
      ribbon.addColorStop(0.5, hexAlpha(ICE, 0.15));
      ribbon.addColorStop(1, hexAlpha(ICE, 0.02));
      ctx.fillStyle = ribbon;
      ctx.fill();

      // Front waveform (ice phosphor with breathing glow)
      const breathe = 0.85 + 0.15 * Math.sin(nowMs / 650);
      ctx.beginPath();
      for (let x = xL; x <= xR; x++) {
        const y = mid - shape(p.wave, ((x - xL) / span) * 2) * amp;
        if (x === xL) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 12 + p.depth * 8 + breathe * 4;
      ctx.shadowColor = ICE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      let engT = nowMs / 1000;
      try { engT = getEngine().ctx.currentTime; } catch { /* */ }
      const ph = (engT * p.rate) % 2;
      const px = xL + (ph / 2) * span;
      const py = mid - shape(p.wave, ph) * amp;

      // Phase tracer history trail (comet particles)
      const historySteps = 20;
      for (let hist = historySteps; hist > 0; hist--) {
        const histPh = (ph - hist * 0.05) % 2;
        const hx = xL + (histPh / 2) * span;
        const hy = mid - shape(p.wave, histPh) * amp;
        const histAlpha = (historySteps - hist) / historySteps;
        ctx.fillStyle = hexAlpha(GRN, histAlpha * 0.35 * p.depth);
        ctx.shadowBlur = 2 + histAlpha * 4;
        ctx.shadowColor = GRN;
        ctx.beginPath();
        ctx.arc(hx, hy, 1 + histAlpha * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Tracer bloom halo
      const bloom = ctx.createRadialGradient(px, py, 0, px, py, 16 + p.depth * 14);
      bloom.addColorStop(0, hexAlpha(ICE, 0.6 + p.depth * 0.25));
      bloom.addColorStop(0.5, hexAlpha(GRN, 0.2));
      bloom.addColorStop(1, hexAlpha(ICE, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(px - 30, py - 30, 60, 60);

      // Tracer core
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 20;
      ctx.shadowColor = ICE;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Destination indicator glow
      const destActive = (p.dest as LfoDest) !== "off";
      if (destActive) {
        const destGlow = ctx.createLinearGradient(W - 60, 0, W, 0);
        destGlow.addColorStop(0, hexAlpha(GRN, 0));
        destGlow.addColorStop(1, hexAlpha(GRN, 0.12 + p.depth * 0.15));
        ctx.fillStyle = destGlow;
        ctx.fillRect(W - 60, 0, 60, H);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(98,182,255,0.75)";
      ctx.textAlign = "left";
      ctx.fillText(`LFO ${idx} AURORA · ${String(p.wave).toUpperCase()}`, 10, H - 8);
      ctx.textAlign = "right";
      const destLabel = (p.dest as LfoDest) === "off" ? "IDLE" : `→ ${(p.dest as string).toUpperCase()}`;
      ctx.fillStyle = destActive ? "rgba(124,246,176,0.85)" : "rgba(98,182,255,0.4)";
      ctx.fillText(destLabel, W - 10, H - 8);
    
      },
      () => ({
        flash: 0,
        active: (st.current.dest as LfoDest) !== "off" && st.current.depth > 0.02,
        dragging: false,
        particles: 0,
        motionKey: `${st.current.wave}|${st.current.rate.toFixed(2)}|${st.current.depth.toFixed(2)}`,
      }),
      { minIntervalMs: 28 },
    );
    return stopLoop;
  }, [idx]);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(98,182,255,0.28)" height={LFO_H} chrome="scope">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** FM · Ring — metallic interference moiré, carrier/mod Venn with sideband spokes, shimmer particles. */
export { FmStageViz as FmRingStageViz } from "./FmStageViz";

export { PitchStageViz as PitchGlideStageViz } from "./PitchStageViz";

/** Oscillator — morphing waveform DNA helix with ghost frames, glow fill, and live morph tracer. */
export function OscStageViz({ group, color }: { group: "a" | "b" | "c"; color: string }) {
  const table = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscATable : group === "b" ? s.patch.oscBTable : s.patch.oscCTable);
  const level = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscALevel : group === "b" ? s.patch.oscBLevel : s.patch.oscCLevel);
  const pos = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscAPos : group === "b" ? s.patch.oscBPos : s.patch.oscCPos);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: OSC_H });
  const st = useRef({ table, level, pos });
  st.current = { table, level, pos };
  useHiDpiCanvas(wrapRef, canvasRef, OSC_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cache: Float32Array[] = [];
    let cacheTable = "";
    const N = 64;
    const ensure = (id: string) => {
      if (cacheTable === id && cache.length) return;
      cache.length = 0;
      for (let i = 0; i < FRAME_COUNT; i++) cache.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
      cacheTable = id;
    };
    const sampleAt = (frameIdx: number, i: number) => cache[Math.max(0, Math.min(FRAME_COUNT - 1, frameIdx))][i];
    const stopLoop = startStageVizLoop(
      (t) => {
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      let livePos = p.pos;
      try { livePos = getEngine().fireCommand.getMorphPositions()[group]; } catch { /* */ }
      ensure(p.table);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, hexAlpha(color, 0.14 + p.level * 0.18));
      bg.addColorStop(1, "rgba(4,4,6,0.6)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cur = livePos * (FRAME_COUNT - 1);
      const lo = Math.floor(cur);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = cur - lo;
      const mid = H * 0.46;
      const amp = (H * 0.32) * (0.3 + p.level * 0.7);
      const xL = 10;
      const xR = W - 10;
      const breathe = 0.92 + 0.08 * Math.sin(t / 700);

      // Ghost frames DNA helix (perspective stack with rotation)
      const ghosts = [-3, -2, -1, 1, 2, 3];
      for (const offset of ghosts) {
        const fIdx = Math.max(0, Math.min(FRAME_COUNT - 1, lo + offset));
        const depth = 1 - Math.abs(offset) * 0.18;
        const helixAngle = (offset * Math.PI * 0.15) + (t / 3000);
        const yShift = Math.sin(helixAngle) * 5 + offset * 2.5;
        const xInset = Math.abs(offset) * 3 + Math.abs(Math.cos(helixAngle)) * 2;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = sampleAt(fIdx, i);
          const x = xL + xInset + (i / (N - 1)) * (xR - xL - xInset * 2);
          const y = mid + yShift - v * amp * depth * 0.7 * breathe;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(color, (0.12 * depth) * breathe);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Enhanced glow fill under front wave
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const v = cache[lo][i] * (1 - frac) + cache[hi][i] * frac;
        const x = xL + (i / (N - 1)) * (xR - xL);
        const y = mid - v * amp * breathe;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xR, mid + amp * 0.35);
      ctx.lineTo(xL, mid + amp * 0.35);
      ctx.closePath();
      const glow = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      glow.addColorStop(0, hexAlpha(color, (0.35 + p.level * 0.3) * breathe));
      glow.addColorStop(0.5, hexAlpha(color, (0.15 + p.level * 0.1)));
      glow.addColorStop(1, hexAlpha(color, 0.02));
      ctx.fillStyle = glow;
      ctx.fill();

      // Chromatic edge shimmer
      for (let i = 0; i < N; i += 4) {
        const v = cache[lo][i] * (1 - frac) + cache[hi][i] * frac;
        const x = xL + (i / (N - 1)) * (xR - xL);
        const y = mid - v * amp * breathe;
        const shimmer = ctx.createRadialGradient(x, y, 0, x, y, 4 + p.level * 4);
        shimmer.addColorStop(0, hexAlpha(color, (0.4 + Math.sin(t / 300 + i) * 0.2) * p.level));
        shimmer.addColorStop(1, hexAlpha(color, 0));
        ctx.fillStyle = shimmer;
        ctx.fillRect(x - 5, y - 5, 10, 10);
      }

      // Front wave with enhanced glow
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const v = cache[lo][i] * (1 - frac) + cache[hi][i] * frac;
        const x = xL + (i / (N - 1)) * (xR - xL);
        const y = mid - v * amp * breathe;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.8;
      ctx.shadowBlur = 12 + p.level * 12 + breathe * 4;
      ctx.shadowColor = color;
      ctx.globalAlpha = 0.5 + p.level * 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Morph position rail (bottom indicator with glow)
      const morphBarY = H - 20;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(xL, morphBarY, xR - xL, 3);
      const morphFill = (xR - xL) * livePos;
      const morphGrad = ctx.createLinearGradient(xL, morphBarY, xL + morphFill, morphBarY);
      morphGrad.addColorStop(0, hexAlpha(color, 0.4));
      morphGrad.addColorStop(1, hexAlpha(color, 0.9));
      ctx.fillStyle = morphGrad;
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.fillRect(xL, morphBarY, morphFill, 3);
      ctx.shadowBlur = 0;

      // Morph position tick with beam
      const mx = xL + livePos * (xR - xL);
      const beamGrad = ctx.createLinearGradient(mx, H - 20, mx, mid + amp * 0.35);
      beamGrad.addColorStop(0, hexAlpha(color, 0.6));
      beamGrad.addColorStop(1, hexAlpha(color, 0.1));
      ctx.strokeStyle = beamGrad;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 6;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.moveTo(mx, H - 20);
      ctx.lineTo(mx, mid + amp * 0.35);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Morph tick gem
      ctx.fillStyle = hexAlpha(color, 0.95);
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.fillRect(mx - 2, H - 20, 4, 12);
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(color, 0.75);
      ctx.textAlign = "left";
      ctx.fillText(`OSC ${group.toUpperCase()} HELIX · ${p.table.toUpperCase()}`, 10, H - 7);
      ctx.textAlign = "right";
      ctx.fillText(p.level < 0.01 ? "SILENT" : `${Math.round(p.level * 100)}%`, W - 10, H - 7);
      },
      () => {
        let livePos = st.current.pos;
        try { livePos = getEngine().fireCommand.getMorphPositions()[group]; } catch { /* */ }
        return {
          flash: 0,
          active: st.current.level > 0.01,
          dragging: false,
          particles: 0,
          motionKey: `${st.current.table}|${livePos.toFixed(3)}|${st.current.level.toFixed(2)}`,
        };
      },
      { minIntervalMs: 33 },
    );
    return stopLoop;
  }, [group, color]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(color, 0.28)} height={OSC_H} chrome="corners">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Performance — macro radar with expression arcs, voice constellation, routing beams. */
export { LiveStageViz as PerformanceStageViz } from "./LiveStageViz";

/** End of CoreStageViz — Performance moved to LiveStageViz (Stage Pulse). */
