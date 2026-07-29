/**
 * Scope — Lumen Trace stage visualizer.
 * Master phosphor · FFT spectrum · L/R vectorscope (Signal Path Mix · FC.scope).
 * Drag ↕: Zoom · ↔ / bottom rail: Phosphor depth.
 * Double-click: Freeze. scopeDisplayGain scales display amplitude only.
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

export type ScopeTraceMode = "oscilloscope" | "spectrum" | "vectorscope";

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

type ScopeTaps = {
  mono: AnalyserNode;
  left: AnalyserNode;
  right: AnalyserNode;
  split: ChannelSplitterNode;
  tap: AudioNode;
};

export function ScopeStageViz({
  viz,
  onVizChange,
  mode = "oscilloscope",
}: {
  viz: ScopeVizState;
  onVizChange: (patch: Partial<ScopeVizState>) => void;
  mode?: ScopeTraceMode;
}) {
  const displayGain = useFireCommandStore((s) => s.patch.scopeDisplayGain) ?? 1;
  const pathOn = useFireCommandStore((s) => s.patch.pathScope !== false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 520, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const frozenBuf = useRef<Float32Array | null>(null);
  const frozenFreq = useRef<Uint8Array | null>(null);
  const peakHold = useRef(0);
  const rmsSmooth = useRef(0);
  const phosphor = useRef<Float32Array[]>([]);
  const bufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const floatBufRef = useRef<Float32Array | null>(null);
  const leftBuf = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rightBuf = useRef<Float32Array<ArrayBuffer> | null>(null);
  const vectorTrail = useRef<{ x: number; y: number }[]>([]);
  const tapsRef = useRef<ScopeTaps | null>(null);
  const st = useRef({ displayGain, pathOn, viz, mode });
  st.current = { displayGain, pathOn, viz, mode };

  const live = pathOn && !viz.freeze;

  useEffect(() => {
    const key = `${displayGain.toFixed(3)}|${pathOn ? 1 : 0}|${viz.zoom.toFixed(2)}|${viz.phosphor}|${viz.freeze ? 1 : 0}|${mode}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [displayGain, pathOn, viz.zoom, viz.phosphor, viz.freeze, mode]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  // Fire-bus taps: mono analyser + L/R for vectorscope (post clip, pre Kill-Chain).
  useEffect(() => {
    let taps: ScopeTaps | null = null;
    try {
      const e = getEngine();
      const mono = e.ctx.createAnalyser();
      mono.fftSize = 2048;
      mono.smoothingTimeConstant = 0.65;
      const left = e.ctx.createAnalyser();
      left.fftSize = 1024;
      left.smoothingTimeConstant = 0;
      const right = e.ctx.createAnalyser();
      right.fftSize = 1024;
      right.smoothingTimeConstant = 0;
      const split = e.ctx.createChannelSplitter(2);
      const tap = e.fireTap;
      tap.connect(mono);
      tap.connect(split);
      split.connect(left, 0);
      split.connect(right, 1);
      taps = { mono, left, right, split, tap };
      tapsRef.current = taps;
    } catch {
      tapsRef.current = null;
    }
    return () => {
      const t = tapsRef.current;
      if (!t) return;
      try {
        t.tap.disconnect(t.mono);
        t.tap.disconnect(t.split);
      } catch { /* ignore */ }
      tapsRef.current = null;
    };
  }, []);

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
      const drag: DragMode = y > 0.82 ? "phosphor" : "xy";
      dragRef.current = drag;
      flashRef.current = 1;
      if (drag === "phosphor") applyPhosphorRail(e.clientX);
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
        const { displayGain: gain, pathOn: on, viz: v, mode: traceMode } = st.current;
        const flash = flashRef.current;
        const zoom = clamp(v.zoom, 0.4, 3);
        const phN = clamp(Math.round(v.phosphor), 1, 8);
        const amp = zoom * (0.45 + clamp(gain / 2, 0, 1) * 0.7);

        let running = false;
        try {
          running = getEngine().ctx.state === "running";
        } catch { /* */ }

        const taps = tapsRef.current;
        let mono: AnalyserNode | null = taps?.mono ?? null;
        if (!mono) {
          try { mono = getEngine().analyserPost; } catch { mono = null; }
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

        // ── Spectrum (FFT) ──────────────────────────────────────────
        if (traceMode === "spectrum") {
          ctx.strokeStyle = hexAlpha(C, 0.1);
          ctx.lineWidth = 1;
          for (let i = 1; i < 4; i++) {
            const y = (Hcss / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
          }

          let bins: Uint8Array | null = null;
          let peak = 0;
          if (mono && running && on) {
            const n = mono.frequencyBinCount;
            if (!freqRef.current || freqRef.current.length !== n) {
              freqRef.current = new Uint8Array(n);
            }
            mono.getByteFrequencyData(freqRef.current);
            if (v.freeze) {
              if (!frozenFreq.current || frozenFreq.current.length !== n) {
                frozenFreq.current = freqRef.current.slice();
              }
              bins = frozenFreq.current;
            } else {
              frozenFreq.current = null;
              bins = freqRef.current;
            }
            for (let i = 0; i < bins.length; i++) {
              const a = bins[i]! / 255;
              if (a > peak) peak = a;
            }
          } else if (v.freeze && frozenFreq.current) {
            bins = frozenFreq.current;
          }

          peakHold.current = Math.max(peakHold.current * 0.985, peak);
          rmsSmooth.current += (peak - rmsSmooth.current) * 0.12;

          if (bins && bins.length > 4) {
            const use = Math.min(bins.length, Math.floor(bins.length * 0.55));
            const barW = Math.max(1, W / use);
            for (let i = 0; i < use; i++) {
              const mag = Math.pow(bins[i]! / 255, 0.85) * amp;
              const h = mag * (Hcss - 28);
              const x = (i / use) * W;
              const grad = ctx.createLinearGradient(0, Hcss - 22 - h, 0, Hcss - 22);
              grad.addColorStop(0, hexAlpha(C_GLOW, 0.95));
              grad.addColorStop(0.55, hexAlpha(C_HOT, 0.75));
              grad.addColorStop(1, hexAlpha(C, 0.35));
              ctx.fillStyle = grad;
              ctx.fillRect(x, Hcss - 22 - h, Math.max(1, barW - 0.5), h);
            }
            ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = hexAlpha(C, 0.5);
            ctx.textAlign = "left";
            ctx.fillText("20Hz", 8, Hcss - 8);
            ctx.textAlign = "right";
            ctx.fillText("~10k", W - 28, Hcss - 8);
          } else {
            ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = hexAlpha(C, 0.4);
            ctx.textAlign = "center";
            ctx.fillText(on ? "WAITING FOR SPECTRUM" : "SCOPE BYPASSED", W / 2, Hcss / 2);
          }

          ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillStyle = hexAlpha(C_GLOW, 0.65);
          ctx.fillText("FFT", 10, 14);
          ctx.fillStyle = hexAlpha(C_HOT, 0.7);
          ctx.fillText(`DISP ${Math.round(gain * 100)}%`, 44, 14);
          if (v.freeze) {
            ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
            ctx.fillText("FREEZE", 120, 14);
          }
        }

        // ── Vectorscope ─────────────────────────────────────────────
        else if (traceMode === "vectorscope") {
          const cx = W / 2;
          const cy = (Hcss - 14) / 2;
          const r = Math.min(W, Hcss - 20) * 0.38 * (0.7 + amp * 0.35);

          ctx.strokeStyle = hexAlpha(C, 0.14);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - r, cy);
          ctx.lineTo(cx + r, cy);
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx, cy + r);
          ctx.stroke();
          ctx.strokeStyle = hexAlpha(C_HOT, 0.22);
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.7, cy - r * 0.7);
          ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
          ctx.stroke();

          let peak = 0;
          let corr = 1;
          const leftAn = taps?.left ?? null;
          const rightAn = taps?.right ?? null;

          if (leftAn && rightAn && running && on && !v.freeze) {
            const n = leftAn.fftSize;
            if (!leftBuf.current || leftBuf.current.length !== n) leftBuf.current = new Float32Array(n);
            if (!rightBuf.current || rightBuf.current.length !== n) rightBuf.current = new Float32Array(n);
            leftAn.getFloatTimeDomainData(leftBuf.current);
            rightAn.getFloatTimeDomainData(rightBuf.current);
            const L = leftBuf.current;
            const R = rightBuf.current;
            let sumLR = 0;
            let sumL2 = 0;
            let sumR2 = 0;
            const step = Math.max(1, Math.floor(n / 256));
            const trail = vectorTrail.current;
            trail.length = 0;
            for (let i = 0; i < n; i += step) {
              const l = L[i]!;
              const rS = R[i]!;
              const a = Math.max(Math.abs(l), Math.abs(rS));
              if (a > peak) peak = a;
              sumLR += l * rS;
              sumL2 += l * l;
              sumR2 += rS * rS;
              trail.push({ x: l, y: rS });
            }
            corr = sumLR / Math.sqrt(Math.max(1e-12, sumL2) * Math.max(1e-12, sumR2));
            if (!Number.isFinite(corr)) corr = 1;
          } else if (mono && running && on && !v.freeze) {
            if (!bufRef.current || bufRef.current.length !== mono.fftSize) {
              bufRef.current = new Uint8Array(mono.fftSize);
            }
            mono.getByteTimeDomainData(bufRef.current);
            const buf = bufRef.current;
            const trail = vectorTrail.current;
            trail.length = 0;
            const delay = 8;
            for (let i = delay; i < buf.length; i += 4) {
              const l = (buf[i]! - 128) / 128;
              const rS = (buf[i - delay]! - 128) / 128;
              const a = Math.max(Math.abs(l), Math.abs(rS));
              if (a > peak) peak = a;
              trail.push({ x: l, y: rS });
            }
            corr = 0.85;
          }

          peakHold.current = Math.max(peakHold.current * 0.985, peak);
          rmsSmooth.current += (peak - rmsSmooth.current) * 0.12;

          const trail = vectorTrail.current;
          if (trail.length > 2 && on) {
            ctx.beginPath();
            for (let i = 0; i < trail.length; i++) {
              const p = trail[i]!;
              const x = cx + p.x * r * amp * 1.1;
              const y = cy - p.y * r * amp * 1.1;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.25);
            ctx.lineWidth = 1.2;
            ctx.shadowBlur = 8;
            ctx.shadowColor = hexAlpha(C_HOT, 0.5);
            ctx.stroke();
            ctx.shadowBlur = 0;

            const last = trail[trail.length - 1]!;
            ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
            ctx.beginPath();
            ctx.arc(cx + last.x * r * amp * 1.1, cy - last.y * r * amp * 1.1, 2.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = hexAlpha(C, 0.4);
            ctx.textAlign = "center";
            ctx.fillText(on ? "WAITING FOR STEREO" : "SCOPE BYPASSED", W / 2, cy);
          }

          ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillStyle = hexAlpha(C_GLOW, 0.65);
          ctx.fillText("VECTOR", 10, 14);
          ctx.fillStyle = corr < 0.25 ? "#ff6a3d" : hexAlpha(C_HOT, 0.75);
          ctx.fillText(`ρ ${corr >= 0 ? "+" : ""}${corr.toFixed(2)}`, 70, 14);
          ctx.fillStyle = hexAlpha(C, 0.55);
          ctx.textAlign = "right";
          ctx.fillText("L↔R", W - 10, 14);
          ctx.textAlign = "left";
          ctx.fillStyle = hexAlpha(C, 0.45);
          ctx.fillText("L", 10, Hcss - 8);
          ctx.textAlign = "right";
          ctx.fillText("R", W - 10, Hcss - 8);
        }

        // ── Oscilloscope (default) ──────────────────────────────────
        else {
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

          if (mono && running && on) {
            if (!bufRef.current || bufRef.current.length !== mono.fftSize) {
              bufRef.current = new Uint8Array(mono.fftSize);
            }
            const buf = bufRef.current;
            mono.getByteTimeDomainData(buf);
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
          ctx.fillText(`DISP ${Math.round(gain * 100)}%`, 88, 14);
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
        }

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
        particles: phosphor.current.length + vectorTrail.current.length,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, []);

  const modeLabel =
    mode === "spectrum" ? "FFT spectrum" : mode === "vectorscope" ? "L/R vectorscope" : "time-domain phosphor";

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
      aria-label={`Lumen Trace ${modeLabel} — drag to zoom`}
      title="Drag ↕ zoom · ↔ / rail phosphor · Double-click freeze · Fire bus tap"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-1 rounded-[3px] border" style={{ borderColor: `${C}18` }} />
    </div>
  );
}
