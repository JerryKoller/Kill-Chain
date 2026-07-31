/**
 * Scope — Lumen Trace stage visualizer.
 *
 * IDIOM: measurement gear. This is the one panel in the rack that reads real
 * audio, so it is drawn as an instrument rather than as art: a dot-mesh
 * graticule with major divisions and centre-axis ticks, a sweep head that runs
 * the width and drags a hot phosphor wake behind it, and calibrated ms/div and
 * V/div annotations. The letterbox is an asset here — a 10:1 CRT is exactly what
 * a chart-style scope wants.
 *
 * Master phosphor · FFT spectrum · L/R vectorscope (Signal Path Mix · FC.scope).
 * Drag ↕: Zoom · ↔ / bottom rail: Phosphor depth.
 * Double-click: Freeze. scopeDisplayGain scales display amplitude only.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  cachedGrad,
  drawGlow,
  footer,
  glowStroke,
  grain,
  hexA,
  lattice,
  lit,
  motionHash,
  pill,
  plate,
  scanlines,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

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

/** Vector trail capacity — the mono fallback yields ~510 points. */
const VEC_CAP = 768;
/** Beam sweep period at zoom 1, in ms. */
const SWEEP_BASE_MS = 2600;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

type DragMode = "xy" | "phosphor" | null;

type ScopeTaps = {
  mono: AnalyserNode;
  left: AnalyserNode;
  right: AnalyserNode;
  split: ChannelSplitterNode;
  tap: AudioNode;
};

/**
 * Everything the paint needs. Audio buffers arrive here as plain typed arrays so
 * the paint routine never touches an analyser — the component samples, the paint
 * only draws. Named `ScopePaintState` because `ScopeVizState` is the (public)
 * zoom/phosphor/freeze prop shape.
 */
export type ScopePaintState = {
  mode: ScopeTraceMode;
  zoom: number;
  phosphor: number;
  freeze: boolean;
  on: boolean;
  displayGain: number;
  /** Time domain, −1..1. Null when there is nothing to draw. */
  samples: Float32Array | null;
  /** Previous frames, oldest first — the persistence trails. */
  ghosts: Float32Array[];
  /** Byte FFT magnitudes. */
  bins: Uint8Array | null;
  /** Decaying per-bin peak hold, 0..1, parallel to `bins`. */
  binPeaks: Float32Array | null;
  /** L/R trail as parallel arrays: no per-sample object churn. */
  vecX: Float32Array | null;
  vecY: Float32Array | null;
  vecN: number;
  peakHold: number;
  rms: number;
  corr: number;
};

/** Sweep phase, 0..1 across the screen. */
function sweepPhase(now: number, zoom: number): number {
  const period = Math.max(400, SWEEP_BASE_MS - zoom * 600);
  const t = (now % period) / period;
  return t < 0 ? t + 1 : t;
}

/** Dot mesh + major divisions + centre-axis ticks: the graticule. */
function graticule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  centreY: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = hexA(C_DEEP, 0.34);
  ctx.fillRect(x, y, w, h);
  lattice(ctx, x + w, y + h, C_MID, 11, 0.07);
  ctx.restore();

  const divX = 10;
  const divY = 8;
  for (let i = 0; i <= divX; i++) {
    const gx = x + (i / divX) * w;
    ctx.fillStyle = hexA(C_MID, i === divX * 0.5 ? 0.16 : 0.1);
    ctx.fillRect(gx - 0.5, y, 1, h);
  }
  for (let i = 0; i <= divY; i++) {
    const gy = y + (i / divY) * h;
    ctx.fillStyle = hexA(C_MID, 0.09);
    ctx.fillRect(x, gy, w, 1);
  }
  // Centre axis + fifth-division ticks, the way a real graticule is scored.
  ctx.fillStyle = hexA(C_GLOW, 0.22);
  ctx.fillRect(x, centreY, w, 1);
  for (let i = 0; i <= divX * 5; i++) {
    const tx = x + (i / (divX * 5)) * w;
    const long = i % 5 === 0;
    ctx.fillStyle = hexA(C_GLOW, long ? 0.28 : 0.16);
    ctx.fillRect(tx, centreY - (long ? 4 : 2), 1, long ? 8 : 4);
  }
  ctx.strokeStyle = hexA(C_MID, 0.2);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/**
 * Paint the trace. Exported and pure — hand it a sample array and it renders the
 * same frame every time, with no analyser, store or RAF involvement.
 */
export function paintScope(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ScopePaintState,
  now: number,
  flash: number,
): void {
  const on = p.on;
  const zoom = clamp(p.zoom, 0.4, 3);
  const phN = clamp(Math.round(p.phosphor), 1, 8);
  const amp = zoom * (0.45 + clamp(p.displayGain / 2, 0, 1) * 0.7);
  const energy = 0.08 + (on ? 0.16 : 0) + p.rms * 0.5 + flash * 0.18;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  const padL = 10;
  const padR = 28;
  const span = Math.max(60, W - padL - padR);
  const plotTop = 20;
  const plotBot = Hh - 32;
  const plotH = plotBot - plotTop;
  const centreY = Math.round(plotTop + plotH * 0.5);
  const railY = Hh - 28;

  // ── Spectrum (FFT) ──────────────────────────────────────────
  if (p.mode === "spectrum") {
    graticule(ctx, padL, plotTop, span, plotH, centreY);
    const bins = p.bins;
    if (bins && bins.length > 4) {
      const use = Math.min(bins.length, Math.floor(bins.length * 0.55));
      // One bar per column at most — a 1900px panel does not need 500 hairlines.
      const cols = Math.max(24, Math.min(use, Math.floor(span / 3)));
      const barW = span / cols;
      const grad = cachedGrad(ctx, `fft|${plotTop}|${plotBot}`, (c) => {
        const g = c.createLinearGradient(0, plotTop, 0, plotBot);
        g.addColorStop(0, hexA(C_GLOW, 0.95));
        g.addColorStop(0.45, hexA(C_HOT, 0.7));
        g.addColorStop(1, hexA(C, 0.28));
        return g;
      });
      // Clip to the graticule: an over-driven display should slam into the
      // screen edge the way real gear does, not paint over the chrome.
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, plotTop, span, plotH);
      ctx.clip();
      ctx.fillStyle = grad;
      for (let i = 0; i < cols; i++) {
        const b0 = Math.floor((i / cols) * use);
        const b1 = Math.max(b0 + 1, Math.floor(((i + 1) / cols) * use));
        let m = 0;
        for (let b = b0; b < b1; b++) {
          const v = bins[b]!;
          if (v > m) m = v;
        }
        const h = Math.pow(m / 255, 0.85) * amp * plotH;
        if (h < 0.6) continue;
        ctx.fillRect(padL + i * barW, plotBot - h, Math.max(1, barW - 0.6), h);
      }
      // Peak hold contour — the reading that survives a transient.
      const peaks = p.binPeaks;
      if (peaks && peaks.length >= use) {
        ctx.strokeStyle = hexA(C_PEAK, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < cols; i++) {
          const b0 = Math.floor((i / cols) * use);
          const b1 = Math.max(b0 + 1, Math.floor(((i + 1) / cols) * use));
          let m = 0;
          for (let b = b0; b < b1; b++) if (peaks[b]! > m) m = peaks[b]!;
          const y = plotBot - Math.pow(m, 0.85) * amp * plotH;
          const x = padL + i * barW + barW * 0.5;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.font = VIZ_FONT_LABEL;
      ctx.fillStyle = hexA(C, 0.5);
      ctx.textAlign = "left";
      ctx.fillText("20Hz", padL + 2, plotBot + 10);
      ctx.textAlign = "right";
      ctx.fillText("~10k", padL + span - 2, plotBot + 10);
    } else {
      ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexA(C, 0.4);
      ctx.textAlign = "center";
      ctx.fillText(on ? "WAITING FOR SPECTRUM" : "SCOPE BYPASSED", W / 2, centreY);
    }

    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.7);
    ctx.fillText("FFT", padL + 2, 14);
    ctx.fillStyle = hexA(C_HOT, 0.72);
    ctx.fillText(`DISP ${Math.round(p.displayGain * 100)}%`, padL + 34, 14);
    if (p.freeze) {
      ctx.fillStyle = hexA(C_GLOW, 0.92);
      ctx.fillText("FREEZE", padL + 110, 14);
    }
  }

  // ── Vectorscope ─────────────────────────────────────────────
  else if (p.mode === "vectorscope") {
    // The XY figure stays a small inset — a circle cannot carry a 10:1 slot — and
    // the width goes to a proper correlation scale instead.
    const r = Math.min(plotH * 0.44, span * 0.2);
    const cx = padL + span * 0.5;
    const cy = centreY;

    ctx.strokeStyle = hexA(C_MID, 0.16);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * (i / 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    // The mono diagonal — where a correlated signal collapses.
    ctx.strokeStyle = hexA(C_HOT, 0.24);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.72, cy + r * 0.72);
    ctx.lineTo(cx + r * 0.72, cy - r * 0.72);
    ctx.stroke();
    ctx.setLineDash([]);

    const n = p.vecN;
    const vx = p.vecX;
    const vy = p.vecY;
    if (vx && vy && n > 2 && on) {
      const trace = () => {
        for (let i = 0; i < n; i++) {
          const x = cx + vx[i]! * r * amp * 1.1;
          const y = cy - vy[i]! * r * amp * 1.1;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, plotTop, span, plotH);
      ctx.clip();
      glowStroke(ctx, trace, C_GLOW, { width: 1.2, glow: 1, alpha: 0.6 + flash * 0.25 });
      lit(ctx, () => {
        const lx = cx + vx[n - 1]! * r * amp * 1.1;
        const ly = cy - vy[n - 1]! * r * amp * 1.1;
        drawGlow(ctx, lx, ly, 9, C_GLOW, 0.85);
      });
      ctx.restore();
    } else {
      ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexA(C, 0.4);
      ctx.textAlign = "center";
      ctx.fillText(on ? "WAITING FOR STEREO" : "SCOPE BYPASSED", cx, cy);
    }

    // Correlation scale across the full width: −1 … 0 … +1.
    const scaleY = plotBot - 6;
    const sx0 = padL + 40;
    const sx1 = padL + span - 40;
    ctx.fillStyle = hexA(C_MID, 0.18);
    ctx.fillRect(sx0, scaleY, sx1 - sx0, 1);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    for (const t of [-1, -0.5, 0, 0.5, 1] as const) {
      const x = sx0 + ((t + 1) / 2) * (sx1 - sx0);
      ctx.fillStyle = hexA(C_MID, t === 0 ? 0.3 : 0.16);
      ctx.fillRect(x - 0.5, scaleY - 4, 1, 9);
      ctx.fillStyle = hexA(C_MID, 0.42);
      ctx.fillText(t === 0 ? "0" : t > 0 ? `+${t}` : `${t}`, x, scaleY + 15);
    }
    const corrX = sx0 + ((clamp(p.corr, -1, 1) + 1) / 2) * (sx1 - sx0);
    const corrCol = p.corr < 0.25 ? C_PEAK : C_GLOW;
    ctx.fillStyle = hexA(corrCol, 0.95);
    ctx.fillRect(corrX - 1.5, scaleY - 7, 3, 15);
    lit(ctx, () => drawGlow(ctx, corrX, scaleY, 10 + flash * 5, corrCol, 0.8));
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_MID, 0.5);
    ctx.fillText("CORR", sx0 - 6, scaleY + 4);

    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.7);
    ctx.fillText("VECTOR", padL + 2, 14);
    ctx.fillStyle = p.corr < 0.25 ? hexA(C_PEAK, 0.9) : hexA(C_HOT, 0.78);
    ctx.fillText(`ρ ${p.corr >= 0 ? "+" : ""}${p.corr.toFixed(2)}`, padL + 56, 14);
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C, 0.55);
    ctx.fillText("L↔R", padL + span, 14);
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C, 0.5);
    ctx.fillText("L", cx - r - 12, cy + 3);
    ctx.textAlign = "right";
    ctx.fillText("R", cx + r + 12, cy + 3);
  }

  // ── Oscilloscope (default) ──────────────────────────────────
  else {
    graticule(ctx, padL, plotTop, span, plotH, centreY);

    const samples = p.samples;
    if (samples && samples.length > 1) {
      const N = samples.length;
      const half = plotH * 0.5 * 0.82;
      const yAt = (i: number, src: Float32Array) => centreY - src[i]! * half * amp;
      // One vertex per pixel column at most: a 2048-point buffer over 1900px is
      // fine, but never sub-pixel-step the path.
      const stride = Math.max(1, Math.floor(N / Math.max(64, span)));

      // Clip to the graticule: an over-driven display should slam into the
      // screen edge the way real gear does, not paint over the chrome.
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, plotTop, span, plotH);
      ctx.clip();

      // Persistence: older frames sit behind the live trace.
      if (!p.freeze) {
        const g = p.ghosts;
        for (let k = 0; k < g.length; k++) {
          const ghost = g[k]!;
          const age = (k + 1) / g.length;
          ctx.beginPath();
          for (let i = 0; i < ghost.length; i += stride) {
            const x = padL + (i / (ghost.length - 1)) * span;
            const y = centreY - ghost[i]! * half * amp;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = hexA(C_HOT, 0.05 + age * 0.15);
          ctx.lineWidth = 1 + age * 0.7;
          ctx.stroke();
        }
      }

      const trace = () => {
        for (let i = 0; i < N; i += stride) {
          const x = padL + (i / (N - 1)) * span;
          const y = yAt(i, samples);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      // Envelope wash under the trace.
      ctx.beginPath();
      ctx.moveTo(padL, centreY);
      for (let i = 0; i < N; i += stride) {
        ctx.lineTo(padL + (i / (N - 1)) * span, yAt(i, samples));
      }
      ctx.lineTo(padL + span, centreY);
      ctx.closePath();
      const fill = cachedGrad(ctx, `osc|${plotTop}|${plotBot}`, (c) => {
        const g = c.createLinearGradient(0, plotTop, 0, plotBot);
        g.addColorStop(0, hexA(C_GLOW, 0.16));
        g.addColorStop(0.5, hexA(C_HOT, 0.09));
        g.addColorStop(1, hexA(C, 0));
        return g;
      });
      ctx.fillStyle = fill;
      ctx.fill();

      glowStroke(ctx, trace, C_GLOW, { width: 1.9 + flash * 0.6, glow: 1, alpha: 0.92 });

      // Sweep: a hot wake just behind the beam, clipped so the phosphor decays
      // with distance rather than lighting the whole trace at once.
      if (!p.freeze && on) {
        const ph = sweepPhase(now, zoom);
        const beamX = padL + ph * span;
        const wake = Math.max(40, span * 0.16);
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(padL, beamX - wake), plotTop, Math.min(wake, beamX - padL) + 1, plotH);
        ctx.clip();
        lit(ctx, () => {
          ctx.strokeStyle = hexA(C_GLOW, 0.5);
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          trace();
          ctx.stroke();
        });
        ctx.restore();
        ctx.fillStyle = hexA(C_GLOW, 0.4);
        ctx.fillRect(beamX, plotTop, 1.5, plotH);
        lit(ctx, () => drawGlow(ctx, beamX, centreY, 16 + zoom * 6, C_GLOW, 0.5));
      }
      ctx.restore();
    } else {
      ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexA(C, 0.4);
      ctx.textAlign = "center";
      ctx.fillText(on ? "WAITING FOR SIGNAL" : "SCOPE BYPASSED", W / 2, centreY);
    }

    // ── right-edge level column ──
    const meterX = W - 20;
    const meterY = plotTop;
    const meterH = plotH;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(meterX, meterY, 6, meterH);
    const rmsH = clamp(p.rms * amp, 0, 1) * meterH;
    const peakH = clamp(p.peakHold * amp, 0, 1) * meterH;
    ctx.fillStyle = hexA(C_RMS, 0.78);
    ctx.fillRect(meterX, meterY + meterH - rmsH, 6, rmsH);
    ctx.fillStyle = hexA(C_PEAK, 0.95);
    ctx.fillRect(meterX - 1, meterY + meterH - peakH - 1, 8, 2);
    lit(ctx, () => drawGlow(ctx, meterX + 3, meterY + meterH - peakH, 7, C_PEAK, 0.6));

    // ── calibration row ──
    const sweepMs = Math.max(400, SWEEP_BASE_MS - zoom * 600);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.72);
    ctx.fillText(`×${zoom.toFixed(1)}`, padL + 2, 14);
    ctx.fillStyle = hexA(C, 0.6);
    ctx.fillText(`PH ${phN}`, padL + 36, 14);
    ctx.fillStyle = hexA(C_HOT, 0.74);
    ctx.fillText(`DISP ${Math.round(p.displayGain * 100)}%`, padL + 74, 14);
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.fillText(`${(sweepMs / 10).toFixed(0)} ms/div`, padL + 152, 14);
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.fillText(`${(1 / Math.max(0.05, amp) / 4).toFixed(2)} V/div`, padL + 226, 14);
    if (p.freeze) {
      ctx.fillStyle = hexA(C_GLOW, 0.92);
      ctx.fillText("FREEZE", padL + 300, 14);
    }

    // ── phosphor rail ──
    const railPad = 14;
    const railW = W - railPad * 2;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(railPad, railY, railW, 6);
    ctx.fillStyle = hexA(C_HOT, 0.55 + flash * 0.25);
    ctx.fillRect(railPad, railY + 1, Math.max(2, railW * ((phN - 1) / 7)), 4);
    for (let i = 1; i <= 8; i++) {
      const nx = railPad + ((i - 1) / 7) * railW;
      const active = i === phN;
      ctx.fillStyle = hexA(active ? C_GLOW : C_MID, active ? 0.9 : 0.28);
      ctx.fillRect(nx - 1, railY - 2, 2, 10);
    }
    lit(ctx, () => drawGlow(ctx, railPad + ((phN - 1) / 7) * railW, railY + 3, 8 + flash * 5, C_GLOW, 0.85));
  }

  pill(
    ctx,
    W * 0.5,
    2,
    !on ? "BYPASS" : p.freeze ? "FREEZE" : p.mode === "spectrum" ? "FFT" : p.mode === "vectorscope" ? "VECTOR" : "SWEEP",
    on ? (p.freeze ? C_PEAK : C_GLOW) : C_MID,
    { glow: flash, height: 12 },
  );

  scanlines(ctx, W, Hh, 0.09, 3);
  grain(ctx, W, Hh, 0.024);
  bezel(ctx, W, Hh, C);
  const pkDb = p.peakHold > 0.001 ? (20 * Math.log10(p.peakHold)).toFixed(1) : "-∞";
  footer(
    ctx,
    W,
    Hh,
    on ? "LUMEN TRACE" : "LUMEN TRACE · BYPASS",
    `PK ${pkDb} dB`,
    C_GLOW,
    on ? C_HOT : C_MID,
  );

  if (!on) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, Hh);
  }
}

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

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const frozenBuf = useRef<Float32Array | null>(null);
  const frozenFreq = useRef<Uint8Array | null>(null);
  const peakHold = useRef(0);
  const rmsSmooth = useRef(0);
  const phosphor = useRef<Float32Array[]>([]);
  const bufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const binPeaks = useRef<Float32Array | null>(null);
  const floatBufRef = useRef<Float32Array | null>(null);
  const leftBuf = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rightBuf = useRef<Float32Array<ArrayBuffer> | null>(null);
  const vecX = useRef<Float32Array>(new Float32Array(VEC_CAP));
  const vecY = useRef<Float32Array>(new Float32Array(VEC_CAP));
  const tapsRef = useRef<ScopeTaps | null>(null);
  const st = useRef({ displayGain, pathOn, viz, mode });
  st.current = { displayGain, pathOn, viz, mode };

  // Paint state is allocated once; the sampler fills it in place each frame.
  const ps = useRef<ScopePaintState>({
    mode,
    zoom: viz.zoom,
    phosphor: viz.phosphor,
    freeze: viz.freeze,
    on: pathOn,
    displayGain,
    samples: null,
    ghosts: phosphor.current,
    bins: null,
    binPeaks: null,
    vecX: vecX.current,
    vecY: vecY.current,
    vecN: 0,
    peakHold: 0,
    rms: 0,
    corr: 1,
  });
  ps.current.mode = mode;
  ps.current.zoom = viz.zoom;
  ps.current.phosphor = viz.phosphor;
  ps.current.freeze = viz.freeze;
  ps.current.on = pathOn;
  ps.current.displayGain = displayGain;

  const live = pathOn && !viz.freeze;

  useEffect(() => {
    const key = motionHash(
      displayGain,
      pathOn,
      viz.zoom,
      viz.phosphor,
      viz.freeze,
      mode === "spectrum" ? 1 : mode === "vectorscope" ? 2 : 0,
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [displayGain, pathOn, viz.zoom, viz.phosphor, viz.freeze, mode]);

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
    [onVizChange, wrapRef],
  );

  const applyPhosphorRail = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      onVizChange({ phosphor: Math.round(1 + x * 7) });
    },
    [onVizChange, wrapRef],
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
    [applyPhosphorRail, applyXy, wrapRef],
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

    /**
     * Pull the analysers into the paint state. This is the one thing the paint
     * routine cannot do itself, so it stays here — and stays the only work the
     * frame callback does besides painting.
     */
    const sampleAudio = () => {
      const { pathOn: on, viz: v, mode: traceMode } = st.current;
      const out = ps.current;
      const phN = clamp(Math.round(v.phosphor), 1, 8);

      let running = false;
      try {
        running = getEngine().ctx.state === "running";
      } catch { /* */ }

      const taps = tapsRef.current;
      let mono: AnalyserNode | null = taps?.mono ?? null;
      if (!mono) {
        try { mono = getEngine().analyserPost; } catch { mono = null; }
      }

      out.samples = null;
      out.bins = null;
      out.binPeaks = null;

      if (traceMode === "spectrum") {
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

        if (bins) {
          if (!binPeaks.current || binPeaks.current.length !== bins.length) {
            binPeaks.current = new Float32Array(bins.length);
          }
          const bp = binPeaks.current;
          for (let i = 0; i < bins.length; i++) {
            const a = bins[i]! / 255;
            bp[i] = a > bp[i]! ? a : bp[i]! * 0.97;
          }
          out.binPeaks = bp;
        }
        out.bins = bins;
      } else if (traceMode === "vectorscope") {
        let peak = 0;
        let corr = 1;
        let count = 0;
        const xs = vecX.current;
        const ys = vecY.current;
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
          for (let i = 0; i < n && count < VEC_CAP; i += step) {
            const l = L[i]!;
            const rS = R[i]!;
            const a = Math.max(Math.abs(l), Math.abs(rS));
            if (a > peak) peak = a;
            sumLR += l * rS;
            sumL2 += l * l;
            sumR2 += rS * rS;
            xs[count] = l;
            ys[count] = rS;
            count++;
          }
          corr = sumLR / Math.sqrt(Math.max(1e-12, sumL2) * Math.max(1e-12, sumR2));
          if (!Number.isFinite(corr)) corr = 1;
          out.vecN = count;
          out.corr = corr;
        } else if (mono && running && on && !v.freeze) {
          if (!bufRef.current || bufRef.current.length !== mono.fftSize) {
            bufRef.current = new Uint8Array(mono.fftSize);
          }
          mono.getByteTimeDomainData(bufRef.current);
          const buf = bufRef.current;
          const delay = 8;
          for (let i = delay; i < buf.length && count < VEC_CAP; i += 4) {
            const l = (buf[i]! - 128) / 128;
            const rS = (buf[i - delay]! - 128) / 128;
            const a = Math.max(Math.abs(l), Math.abs(rS));
            if (a > peak) peak = a;
            xs[count] = l;
            ys[count] = rS;
            count++;
          }
          out.vecN = count;
          out.corr = 0.85;
        }

        peakHold.current = Math.max(peakHold.current * 0.985, peak);
        rmsSmooth.current += (peak - rmsSmooth.current) * 0.12;
      } else {
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
        out.samples = samples;
        out.ghosts = phosphor.current;
      }

      out.peakHold = peakHold.current;
      out.rms = rmsSmooth.current;
    };

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.9;
        sampleAudio();
        paintScope(ctx, W, Hh, ps.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.pathOn,
        dragging: !!dragRef.current,
        particles: phosphor.current.length + ps.current.vecN,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.displayGain,
          st.current.pathOn,
          st.current.viz.zoom,
          st.current.viz.phosphor,
          st.current.viz.freeze,
          st.current.mode === "spectrum" ? 1 : st.current.mode === "vectorscope" ? 2 : 0,
        ),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

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
