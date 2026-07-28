/**
 * Scope — Lumen Trace stage visualizer.
 * Master time-domain phosphor (Signal Path Mix · FC.scope).
 * Drag ↕: Zoom · ↔ / bottom rail: Phosphor depth.
 * Double-click: Freeze. masterGain scales the live amplitude.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.scope;
const C_DEEP = bandShade(FC_BAND.mix, 0.32);
const C_MID = bandShade(FC_BAND.mix, 0.52);
const C_HOT = bandShade(FC_BAND.mix, 0.68);
const C_GLOW = bandShade(FC_BAND.mix, 0.94);
const C_PEAK = bandShade(FC_BAND.mix, 0.8);
const C_RMS = bandShade(FC_BAND.mix, 0.58);

export type ScopeVizState = {
  zoom: number;
  phosphor: number;
  freeze: boolean;
};

export const SCOPE_DEFAULT_VIZ: ScopeVizState = { zoom: 1, phosphor: 5, freeze: false };

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

type DragMode = "xy" | "phosphor" | null;

export function ScopeStageViz({
  viz,
  onVizChange,
}: {
  viz: ScopeVizState;
  onVizChange: (patch: Partial<ScopeVizState>) => void;
}) {
  const masterGain = useFireCommandStore((s) => s.patch.masterGain) ?? 0.72;
  const pathOn = useFireCommandStore((s) => s.patch.pathScope !== false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 520, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const frozenBuf = useRef<Float32Array | null>(null);
  const peakHold = useRef(0);
  const rmsSmooth = useRef(0);
  const phosphor = useRef<Float32Array[]>([]);
  const bufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const floatBufRef = useRef<Float32Array | null>(null);
  const st = useRef({ masterGain, pathOn, viz });
  st.current = { masterGain, pathOn, viz };

  const live = pathOn && !viz.freeze;

  useEffect(() => {
    const key = `${masterGain.toFixed(3)}|${pathOn ? 1 : 0}|${viz.zoom.toFixed(2)}|${viz.phosphor}|${viz.freeze ? 1 : 0}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [masterGain, pathOn, viz.zoom, viz.phosphor, viz.freeze]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      onVizChange({
        zoom: Math.round((0.4 + (1 - y) * 2.6) * 100) / 100,
        phosphor: Math.round(1 + x * 7),
      });
    },
    [onVizChange],
  );

  const applyPhosphorRail = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      onVizChange({ phosphor: Math.round(1 + x * 7) });
    },
    [onVizChange],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = (e.clientY - rect.top) / Math.max(1, rect.height);
      const mode: DragMode = y > 0.82 ? "phosphor" : "xy";
      dragRef.current = mode;
      flashRef.current = 1;
      if (mode === "phosphor") applyPhosphorRail(e.clientX);
      else applyXy(e.clientX, e.clientY);
    },
    [applyPhosphorRail, applyXy],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      if (dragRef.current === "phosphor") applyPhosphorRail(e.clientX);
      else applyXy(e.clientX, e.clientY);
    },
    [applyPhosphorRail, applyXy],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    onVizChange({ freeze: !st.current.viz.freeze });
    flashRef.current = 1;
  }, [onVizChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (now) => {
      flashRef.current *= 0.9;

      const { w: W, h: Hcss } = sizeRef.current;
      if (W < 2) return;
      const { masterGain: gain, pathOn: on, viz: v } = st.current;
      const flash = flashRef.current;
      const zoom = clamp(v.zoom, 0.4, 3);
      const phN = clamp(Math.round(v.phosphor), 1, 8);

      let analyser: AnalyserNode | null = null;
      let running = false;
      try {
        const e = getEngine();
        analyser = e.analyserPost;
        running = e.ctx.state === "running";
      } catch {
        analyser = null;
      }

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createLinearGradient(0, 0, W, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.55 + flash * 0.2));
      bg.addColorStop(0.45, "rgba(6,3,1,0.94)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.28 + (on ? 0.12 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      ctx.fillStyle = "rgba(0,0,0,0.14)";
      for (let y = 0; y < Hcss; y += 3) ctx.fillRect(0, y, W, 1);

      ctx.strokeStyle = hexAlpha(C, 0.1);
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (Hcss / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.18);
      ctx.beginPath();
      ctx.moveTo(0, Hcss / 2);
      ctx.lineTo(W, Hcss / 2);
      ctx.stroke();
      for (let i = 1; i < 8; i++) {
        const x = (W / 8) * i;
        ctx.strokeStyle = hexAlpha(C, 0.06);
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, Hcss - 22);
        ctx.stroke();
      }

      let samples: Float32Array | null = null;
      let peak = 0;
      let rms = 0;

      if (analyser && running && on) {
        if (!bufRef.current || bufRef.current.length !== analyser.fftSize) {
          bufRef.current = new Uint8Array(analyser.fftSize);
        }
        const buf = bufRef.current;
        analyser.getByteTimeDomainData(buf);
        const N = buf.length;
        if (!floatBufRef.current || floatBufRef.current.length !== N) {
          floatBufRef.current = new Float32Array(N);
        }
        const fresh = floatBufRef.current;
        let sumSq = 0;
        for (let i = 0; i < N; i++) {
          const s = (buf[i]! - 128) / 128;
          fresh[i] = s;
          const a = Math.abs(s);
          if (a > peak) peak = a;
          sumSq += s * s;
        }
        rms = Math.sqrt(sumSq / N);

        if (v.freeze) {
          if (!frozenBuf.current || frozenBuf.current.length !== N) {
            frozenBuf.current = fresh.slice();
          }
          samples = frozenBuf.current;
        } else {
          frozenBuf.current = null;
          samples = fresh;
          // Ring-reuse phosphor slots to avoid per-frame Float32Array alloc.
          if (phosphor.current.length < phN) {
            phosphor.current.push(fresh.slice());
          } else {
            const slot = phosphor.current.shift()!;
            if (slot.length === N) {
              slot.set(fresh);
              phosphor.current.push(slot);
            } else {
              phosphor.current.push(fresh.slice());
            }
          }
          while (phosphor.current.length > phN) phosphor.current.shift();
        }
      } else if (v.freeze && frozenBuf.current) {
        samples = frozenBuf.current;
      }

      const amp = zoom * (0.55 + clamp(gain / 1.2, 0, 1) * 0.55);

      peakHold.current = Math.max(peakHold.current * 0.985, peak);
      rmsSmooth.current += (rms - rmsSmooth.current) * 0.12;

      if (samples && samples.length > 1) {
        const N = samples.length;

        if (!v.freeze) {
          for (let g = 0; g < phosphor.current.length; g++) {
            const ghost = phosphor.current[g]!;
            const age = (g + 1) / phosphor.current.length;
            ctx.beginPath();
            for (let i = 0; i < ghost.length; i++) {
              const x = (i / (ghost.length - 1)) * W;
              const y = Hcss / 2 - ghost[i]! * (Hcss / 2) * 0.82 * amp;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = hexAlpha(C_HOT, 0.06 + age * 0.16);
            ctx.lineWidth = 1 + age * 0.7;
            ctx.stroke();
          }
        }

        ctx.beginPath();
        ctx.moveTo(0, Hcss / 2);
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * W;
          const y = Hcss / 2 - samples[i]! * (Hcss / 2) * 0.82 * amp;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, Hcss / 2);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, Hcss);
        fill.addColorStop(0, hexAlpha(C_GLOW, 0.18 + flash * 0.1));
        fill.addColorStop(0.55, hexAlpha(C_HOT, 0.1));
        fill.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.lineWidth = 2.2 + flash * 0.8;
        ctx.strokeStyle = C_GLOW;
        ctx.shadowBlur = 12 + flash * 10 + zoom * 4;
        ctx.shadowColor = hexAlpha(C_HOT, 0.7);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * W;
          const y = Hcss / 2 - samples[i]! * (Hcss / 2) * 0.82 * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (!v.freeze) {
          const pipX = (now / (22 - zoom * 4)) % W;
          ctx.fillStyle = hexAlpha(C_GLOW, 0.35);
          ctx.fillRect(pipX, 8, 2, Hcss - 30);
        }
      } else {
        ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C, 0.4);
        ctx.textAlign = "center";
        ctx.fillText(on ? "WAITING FOR SIGNAL" : "SCOPE BYPASSED", W / 2, Hcss / 2);
      }

      const meterX = W - 18;
      const meterH = Hcss - 36;
      const meterY = 10;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(meterX, meterY, 6, meterH);
      const rmsH = clamp(rmsSmooth.current * amp, 0, 1) * meterH;
      const peakH = clamp(peakHold.current * amp, 0, 1) * meterH;
      ctx.fillStyle = hexAlpha(C_RMS, 0.75);
      ctx.fillRect(meterX, meterY + meterH - rmsH, 6, rmsH);
      ctx.fillStyle = hexAlpha(C_PEAK, 0.95);
      ctx.fillRect(meterX - 1, meterY + meterH - peakH - 1, 8, 2);

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.65);
      ctx.fillText(`×${zoom.toFixed(1)}`, 10, 14);
      ctx.fillStyle = hexAlpha(C, 0.55);
      ctx.fillText(`PH ${phN}`, 48, 14);
      ctx.fillStyle = hexAlpha(C_HOT, 0.7);
      ctx.fillText(`MST ${Math.round(gain * 100)}%`, 88, 14);
      if (v.freeze) {
        ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
        ctx.fillText("FREEZE", 160, 14);
      }

      const railY = Hcss - 12;
      const railPad = 14;
      ctx.strokeStyle = hexAlpha(C, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(W - railPad, railY);
      ctx.stroke();
      const phT = (phN - 1) / 7;
      const thumbX = railPad + phT * (W - railPad * 2);
      ctx.strokeStyle = hexAlpha(C_HOT, 0.75 + flash * 0.2);
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8 + flash * 8;
      ctx.shadowColor = hexAlpha(C_HOT, 0.6);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      ctx.fillText(on ? "LUMEN TRACE" : "LUMEN TRACE · BYPASS", 10, Hcss - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.65);
      const pkDb = peakHold.current > 0.001 ? (20 * Math.log10(peakHold.current)).toFixed(1) : "-∞";
      ctx.fillText(`PK ${pkDb} dB`, W - 28, Hcss - 8);

      const vig = ctx.createRadialGradient(W / 2, Hcss / 2, Hcss * 0.15, W / 2, Hcss / 2, W * 0.6);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.38)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, Hcss);

      if (!on) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, Hcss);
      }
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.pathOn,
        dragging: !!dragRef.current,
        particles: phosphor.current.length,
        motionKey: "",
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-md border-2 bg-[#080402]/95 cursor-ns-resize touch-none select-none shadow-[inset_0_0_32px_rgba(0,0,0,0.65)]"
      style={{
        borderColor: `${C}${live ? "66" : "33"}`,
        height: H,
        boxShadow: live
          ? `inset 0 0 0 1px ${C}22, inset 0 0 32px rgba(0,0,0,0.65), 0 0 24px ${C}28`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="img"
      aria-label="Master lumen trace — drag to zoom and set phosphor"
      title="Drag ↕ zoom · ↔ / rail phosphor · Double-click freeze"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-1 rounded-[3px] border" style={{ borderColor: `${C}18` }} />
    </div>
  );
}
