/**
 * Core Fire Command stage visualizations (v2.5.6) — display-only
 * personalities for Unison, Filter, Envelopes, LFOs, FM·Ring, Pitch·Glide,
 * Oscillators, and Performance. Audio engines untouched.
 */

import { useEffect, useRef, type ReactNode, type RefObject, type MutableRefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import type { FireFilterType, LfoWave, LfoDest, SubWave } from "@/audio/dsp/FireCommandSynth";
import { FRAME_COUNT, frameSamples } from "@/audio/dsp/wavetables";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const GRN = "#7cf6b0";
const GOLD = "#ffcf5c";
const AMB = "#ffb35c";
const LIME = "#9be564";
const TEAL = "#5ce0a0";

const UNISON_H = 114;
const FILTER_H = 116;
const ENV_H = 88;
const LFO_H = 96;
const FM_H = 100;
const PITCH_H = 96;
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

function envSegments(a: number, d: number, s: number, r: number, usableW: number) {
  const seg = (v: number) => Math.pow(Math.max(0.001, v), 0.5);
  const tot = seg(a) + seg(d) + seg(r) + 0.35;
  const wA = (seg(a) / tot) * usableW;
  const wD = (seg(d) / tot) * usableW;
  const wR = (seg(r) / tot) * usableW;
  const wS = usableW - wA - wD - wR;
  return { wA, wD, wR, wS };
}

function envPoints(
  PAD: number, usableH: number, wA: number, wD: number, wS: number, wR: number, s: number, W: number,
) {
  const y = (lv: number) => PAD + (1 - lv) * usableH;
  const x0 = PAD;
  const x1 = x0 + wA;
  const x2 = x1 + wD;
  const x3 = x2 + Math.max(8, wS);
  const x4 = Math.min(W - PAD, x3 + wR);
  return { y, x0, x1, x2, x3, x4, s };
}

/** Mixer · Unison — choir of detuned ribbons / voice fan with stereo L/R rails, shimmer when drift/detune high. */
export function UnisonStageViz() {
  const unison = useFireCommandStore((s) => s.patch.unison);
  const detune = useFireCommandStore((s) => s.patch.unisonDetune);
  const width = useFireCommandStore((s) => s.patch.unisonWidth);
  const stereo = useFireCommandStore((s) => s.patch.stereoWidth);
  const sub = useFireCommandStore((s) => s.patch.subLevel);
  const noise = useFireCommandStore((s) => s.patch.noiseLevel);
  const drift = useFireCommandStore((s) => s.patch.drift);
  const subWave = useFireCommandStore((s) => s.patch.subWave);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 360, h: UNISON_H });
  const st = useRef({ unison, detune, width, stereo, sub, noise, drift, subWave });
  st.current = { unison, detune, width, stereo, sub, noise, drift, subWave };
  useHiDpiCanvas(wrapRef, canvasRef, UNISON_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const particles: { x: number; y: number; vx: number; vy: number; life: number; alpha: number }[] = [];
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 28) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,106,61,0.14)");
      bg.addColorStop(0.45, "rgba(10,6,4,0.62)");
      bg.addColorStop(1, "rgba(255,207,92,0.08)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      drawVignette(ctx, W, H, 0.48);

      const cx = W * 0.5;
      const cy = H * 0.44;
      const n = Math.max(1, Math.round(p.unison));
      const spread = 14 + p.width * 48 + p.stereo * 12;
      const det = p.detune / 50;
      const breath = 0.9 + 0.1 * Math.sin(t / 680);
      const stereoAmt = 0.35 + p.stereo * 0.65;

      // L/R stereo rails with glow
      const railTop = cy - 38;
      const railBot = cy + 38;
      const railGlow = ctx.createLinearGradient(0, railTop, 0, railBot);
      railGlow.addColorStop(0, hexAlpha(ICE, 0.05 + stereoAmt * 0.1));
      railGlow.addColorStop(0.5, hexAlpha(ICE, 0));
      railGlow.addColorStop(1, hexAlpha(ICE, 0.05 + stereoAmt * 0.1));
      ctx.fillStyle = railGlow;
      ctx.fillRect(14, railTop - 8, W - 28, railBot - railTop + 16);

      ctx.strokeStyle = hexAlpha(ICE, 0.18 + stereoAmt * 0.25);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 6]);
      ctx.shadowBlur = 6 + stereoAmt * 8;
      ctx.shadowColor = ICE;
      ctx.beginPath();
      ctx.moveTo(14, railTop);
      ctx.lineTo(W - 14, railTop);
      ctx.moveTo(14, railBot);
      ctx.lineTo(W - 14, railBot);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(ICE, 0.55);
      ctx.textAlign = "left";
      ctx.fillText("L", 6, railTop + 4);
      ctx.textAlign = "right";
      ctx.fillText("R", W - 6, railBot + 4);

      // Fan base arc with shimmer
      ctx.beginPath();
      ctx.arc(cx, cy + 6, spread * 0.55, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = hexAlpha(FIRE, 0.12 + det * 0.1);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Detuned waveform ribbons (multi-layer choir with harmonic motion)
      for (let layer = 4; layer >= 0; layer--) {
        const layerAlpha = (layer === 0 ? 0.22 : 0.08) * Math.max(0.3, det);
        const layerPhase = t / (320 + layer * 60);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
          const pan = u * stereoAmt;
          const x = cx + u * spread;
          const lean = u * det * 22 + pan * 6;
          const amp = (22 + (1 - Math.abs(u)) * 14) * breath;
          const y = cy - amp * 0.65 + layer * 3.5;
          const wobble = Math.sin(layerPhase + u * 2.5) * det * 4 + Math.cos(layerPhase * 1.3 + u) * det * 2;
          if (i === 0) ctx.moveTo(x + lean * 0.15 + wobble, y);
          else ctx.lineTo(x + lean * 0.15 + wobble, y);
        }
        const ribbonColor = layer === 0 ? FIRE : AMB;
        ctx.strokeStyle = hexAlpha(ribbonColor, layerAlpha);
        ctx.lineWidth = layer === 0 ? 2 : 1.5;
        if (layer === 0) {
          ctx.shadowBlur = 6 + det * 8;
          ctx.shadowColor = ribbonColor;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Voice stems with enhanced glow and breathing
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const pan = u * stereoAmt;
        const x = cx + u * spread;
        const lean = u * det * 22 + pan * 6;
        const amp = (22 + (1 - Math.abs(u)) * 14) * breath;
        const hueShift = Math.abs(u) * 0.3;
        const col = hueShift > 0.15 ? AMB : FIRE;
        const centerBoost = 1 - Math.abs(u);

        // Radial glow halo
        const halo = ctx.createRadialGradient(x, cy - amp * 0.3, 0, x, cy - amp * 0.3, 18 + centerBoost * 12);
        halo.addColorStop(0, hexAlpha(col, 0.35 + centerBoost * 0.25));
        halo.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(x - 25, cy - amp - 20, 50, 60);

        // Voice stem with curve
        const stem = ctx.createLinearGradient(x, cy - amp, x, cy + amp);
        stem.addColorStop(0, hexAlpha(col, 0.75 + centerBoost * 0.2));
        stem.addColorStop(0.5, hexAlpha(col, 0.35));
        stem.addColorStop(1, hexAlpha(col, 0.05));
        ctx.beginPath();
        ctx.moveTo(x + lean * 0.15, cy - amp);
        ctx.quadraticCurveTo(x + lean, cy, x + lean * 0.15, cy + amp);
        ctx.strokeStyle = stem;
        ctx.lineWidth = n === 1 ? 3.2 : 2 + centerBoost * 0.8;
        ctx.shadowBlur = 10 + centerBoost * 8;
        ctx.shadowColor = col;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Pan rail connectors with fade
        const tipY = cy - amp;
        const railY = pan < 0 ? railTop + 2 : railBot + 2;
        const connector = ctx.createLinearGradient(x, tipY, 14 + (W - 28) * ((pan + 1) / 2), railY);
        connector.addColorStop(0, hexAlpha(col, 0.35));
        connector.addColorStop(1, hexAlpha(ICE, 0.15 + stereoAmt * 0.15));
        ctx.strokeStyle = connector;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + lean * 0.15, tipY);
        ctx.lineTo(14 + (W - 28) * ((pan + 1) / 2), railY);
        ctx.stroke();

        // Voice tip gem
        ctx.fillStyle = hexAlpha("#fff", 0.9);
        ctx.shadowBlur = 14;
        ctx.shadowColor = col;
        ctx.beginPath();
        ctx.arc(x + lean * 0.15, tipY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Drift shimmer particles (high detune/drift)
      if (p.drift > 0.02 || det > 0.15) {
        const shimmerIntensity = p.drift + det * 0.5;
        if (Math.random() < 0.3 * shimmerIntensity) {
          particles.push({
            x: W * 0.7 + Math.random() * (W * 0.28),
            y: cy + (Math.random() - 0.5) * 60,
            vx: -0.5 - Math.random() * 0.8,
            vy: (Math.random() - 0.5) * 0.4,
            life: 1,
            alpha: 0.3 + Math.random() * 0.4,
          });
        }
        for (let i = particles.length - 1; i >= 0; i--) {
          const pt = particles[i];
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.life -= 0.015;
          if (pt.life <= 0) {
            particles.splice(i, 1);
            continue;
          }
          ctx.fillStyle = hexAlpha(AMB, pt.alpha * pt.life);
          ctx.fillRect(pt.x, pt.y, 2.5, 2.5);
        }

        // Drift waveform layers
        for (let layer = 0; layer < 4; layer++) {
          ctx.strokeStyle = hexAlpha(AMB, (0.15 + p.drift * 0.25) / (layer + 1));
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let x = W * 0.68; x < W - 10; x += 1.5) {
            const y = cy + Math.sin(x * 0.08 + t / (350 + layer * 70) + layer * 0.5) * shimmerIntensity * (14 + layer * 4);
            if (x === W * 0.68) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Sub / noise meters with glow
      const meterY = H - 22;
      const meterW = 56;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(10, meterY, meterW, 6);
      ctx.fillRect(76, meterY, meterW, 6);
      const subFill = meterW * Math.max(0.06, p.sub);
      const subGrad = ctx.createLinearGradient(10, 0, 10 + subFill, 0);
      subGrad.addColorStop(0, hexAlpha(GOLD, 0.45));
      subGrad.addColorStop(1, hexAlpha(GOLD, 0.95));
      ctx.fillStyle = subGrad;
      ctx.shadowBlur = p.sub > 0.1 ? 8 : 0;
      ctx.shadowColor = GOLD;
      ctx.fillRect(10, meterY, subFill, 6);
      ctx.shadowBlur = 0;
      const noiseFill = meterW * Math.max(0.04, p.noise);
      const noiseGrad = ctx.createLinearGradient(76, 0, 76 + noiseFill, 0);
      noiseGrad.addColorStop(0, hexAlpha(ICE, 0.4));
      noiseGrad.addColorStop(1, hexAlpha(ICE, 0.85));
      ctx.fillStyle = noiseGrad;
      ctx.shadowBlur = p.noise > 0.1 ? 6 : 0;
      ctx.shadowColor = ICE;
      ctx.fillRect(76, meterY, noiseFill, 6);
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(`STEREO CHOIR · ${n}V`, 10, H - 7);
      ctx.fillStyle = "rgba(255,207,92,0.55)";
      ctx.textAlign = "right";
      const subLabel = p.sub > 0.01 ? `SUB ${(p.subWave as SubWave).slice(0, 3).toUpperCase()}` : "NO SUB";
      ctx.fillText(subLabel, W - 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={UNISON_H} chrome="rails">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Filter — liquid cutoff waterfall + resonance bloom rings; react to filter type. */
export function FilterStageViz() {
  const type = useFireCommandStore((s) => s.patch.filterType);
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff);
  const res = useFireCommandStore((s) => s.patch.filterResonance);
  const envAmt = useFireCommandStore((s) => s.patch.filterEnvAmount);
  const sat = useFireCommandStore((s) => s.patch.filterDrive);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 360, h: FILTER_H });
  const st = useRef({ type, cutoff, res, envAmt, sat });
  st.current = { type, cutoff, res, envAmt, sat };
  const waterfallRef = useRef<number[][]>([]);
  useHiDpiCanvas(wrapRef, canvasRef, FILTER_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const fLo = 20;
    const fHi = 20000;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 28) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);

      const heat = p.sat * 0.18;
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(255,106,61,${0.1 + heat})`);
      bg.addColorStop(0.5, "rgba(6,4,3,0.65)");
      bg.addColorStop(1, `rgba(255,80,40,${0.04 + heat * 0.5})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const PAD = 12;
      const top = 10;
      const usableH = H - 30;
      const xOf = (f: number) => PAD + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (W - PAD * 2);
      const peak = Math.min(1, Math.log10(Math.max(1, p.res)) * 0.78);
      const gain = (f: number): number => {
        const r = f / Math.max(30, p.cutoff);
        const bump = peak * Math.exp(-Math.pow(Math.log2(r), 2) * 9);
        let g: number;
        if (p.type === "lowpass") g = 1 / Math.sqrt(1 + Math.pow(r, 4));
        else if (p.type === "highpass") g = 1 / Math.sqrt(1 + Math.pow(1 / r, 4));
        else if (p.type === "bandpass") g = Math.exp(-Math.pow(Math.log2(r), 2) * 1.4);
        else g = 1 - Math.exp(-Math.pow(Math.log2(r), 2) * 9);
        return Math.min(1.6, g + (p.type === "notch" ? 0 : bump));
      };

      // Log grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = xOf(f);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + usableH);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      for (let i = 0; i <= 4; i++) {
        const y = top + (usableH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(W - PAD, y);
        ctx.stroke();
      }

      // Liquid waterfall history (store and scroll response curves)
      const waterfallHistory = waterfallRef.current;
      const pts: { x: number; y: number; g: number }[] = [];
      for (let i = 0; i <= 120; i++) {
        const f = fLo * Math.pow(fHi / fLo, i / 120);
        const g = gain(f);
        const y = top + (1 - Math.min(1, g / 1.6)) * usableH;
        pts.push({ x: xOf(f), y, g });
      }
      const currentLine = pts.map((pt) => pt.y);
      waterfallHistory.unshift(currentLine);
      if (waterfallHistory.length > 24) waterfallHistory.pop();

      // Draw waterfall cascade (historical curves fading back)
      for (let h = waterfallHistory.length - 1; h >= 0; h--) {
        const histLine = waterfallHistory[h];
        const age = h / waterfallHistory.length;
        const yOffset = h * 0.8;
        ctx.beginPath();
        for (let i = 0; i < histLine.length; i++) {
          const x = pts[i].x;
          const y = histLine[i] + yOffset;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(FIRE, (1 - age) * 0.15);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Filled response
      ctx.beginPath();
      ctx.moveTo(PAD, top + usableH);
      for (const pt of pts) ctx.lineTo(pt.x, pt.y);
      ctx.lineTo(W - PAD, top + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, top, 0, top + usableH);
      fill.addColorStop(0, hexAlpha(FIRE, 0.48 + heat));
      fill.addColorStop(0.6, hexAlpha(FIRE, 0.12));
      fill.addColorStop(1, hexAlpha(FIRE, 0.01));
      ctx.fillStyle = fill;
      ctx.fill();

      // Resonance bloom rings (multi-ring expansion)
      let peakPt = pts[0];
      for (const pt of pts) if (pt.g > peakPt.g) peakPt = pt;
      if (peak > 0.08) {
        const ringCount = 4;
        for (let r = 0; r < ringCount; r++) {
          const ringPhase = (t / 600 + r * 0.25) % 1;
          const ringR = 12 + ringPhase * (28 + peak * 26);
          const ringAlpha = (0.4 + peak * 0.3) * (1 - ringPhase);
          ctx.strokeStyle = hexAlpha(FIRE, ringAlpha);
          ctx.lineWidth = 2 - ringPhase * 1.5;
          ctx.shadowBlur = 8 + peak * 10;
          ctx.shadowColor = FIRE;
          ctx.beginPath();
          ctx.arc(peakPt.x, peakPt.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Central bloom
        const bloom = ctx.createRadialGradient(peakPt.x, peakPt.y, 0, peakPt.x, peakPt.y, 22 + peak * 28);
        bloom.addColorStop(0, hexAlpha(FIRE, 0.55 + peak * 0.35));
        bloom.addColorStop(0.5, hexAlpha(FIRE, 0.15));
        bloom.addColorStop(1, hexAlpha(FIRE, 0));
        ctx.fillStyle = bloom;
        ctx.fillRect(peakPt.x - 50, peakPt.y - 50, 100, 100);
      }

      // Curve stroke
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 14 + peak * 10;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Cutoff laser with type-dependent color
      const cx = xOf(Math.max(fLo, Math.min(fHi, p.cutoff)));
      const pulse = 0.65 + 0.35 * Math.sin(t / 420);
      const typeColor = p.type === "highpass" ? ICE : p.type === "bandpass" ? GRN : FIRE;
      const laser = ctx.createLinearGradient(cx - 1.5, top, cx + 1.5, top + usableH);
      laser.addColorStop(0, hexAlpha(typeColor, 0.2 * pulse));
      laser.addColorStop(0.5, hexAlpha("#fff", 0.65 * pulse));
      laser.addColorStop(1, hexAlpha(typeColor, 0.15 * pulse));
      ctx.fillStyle = laser;
      ctx.shadowBlur = 12 * pulse;
      ctx.shadowColor = typeColor;
      ctx.fillRect(cx - 2, top, 4, usableH);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexAlpha(typeColor, 0.6);
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, top + usableH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Env amount arrow
      if (Math.abs(p.envAmt) > 0.02) {
        const dx = p.envAmt * 36;
        const ay = top + 12;
        ctx.strokeStyle = hexAlpha(GRN, 0.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, ay);
        ctx.lineTo(cx + dx, ay);
        ctx.stroke();
        ctx.fillStyle = hexAlpha(GRN, 0.75);
        ctx.beginPath();
        ctx.moveTo(cx + dx, ay);
        ctx.lineTo(cx + dx - Math.sign(dx) * 6, ay - 4);
        ctx.lineTo(cx + dx - Math.sign(dx) * 6, ay + 4);
        ctx.closePath();
        ctx.fill();
        ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(GRN, 0.5);
        ctx.textAlign = "center";
        ctx.fillText("ENV", cx + dx * 0.5, ay - 5);
      }

      // Sat heat shimmer particles
      if (p.sat > 0.05) {
        for (let i = 0; i < 12; i++) {
          const sx = PAD + ((t / 60 + i * 31) % (W - PAD * 2));
          const sy = top + usableH - 8 + Math.sin(t / 200 + i) * 3;
          const sAlpha = p.sat * (0.08 + Math.sin(t / 150 + i * 2) * 0.04);
          ctx.fillStyle = hexAlpha("#ff9040", sAlpha);
          ctx.shadowBlur = 4;
          ctx.shadowColor = "#ff9040";
          ctx.fillRect(sx, sy, 2.5, 2.5);
        }
        ctx.shadowBlur = 0;
      }

      // Mode chip (top notch)
      const modeLabel = (p.type as FireFilterType).toUpperCase();
      ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
      const modeW = ctx.measureText(modeLabel).width + 8;
      const chipX = W * 0.5 - modeW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(chipX, 8, modeW, 11);
      ctx.strokeStyle = hexAlpha(typeColor, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(chipX, 8, modeW, 11);
      ctx.fillStyle = hexAlpha(typeColor, 0.9);
      ctx.textAlign = "center";
      ctx.fillText(modeLabel, W * 0.5, 16);

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.6)";
      ctx.textAlign = "left";
      ctx.fillText("LIQUID WATERFALL", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(p.cutoff)}Hz · Q${p.res.toFixed(1)}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={FILTER_H} chrome="notch">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Amp envelope — breathing ADSR silhouette with fire fill + energy pulses. */
function AmpEnvViz({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: ENV_H });
  const st = useRef({ a, d, s, r });
  st.current = { a, d, s, r };
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  useHiDpiCanvas(wrapRef, canvasRef, ENV_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, hexAlpha(GRN, 0.16));
      bg.addColorStop(1, "rgba(2,8,5,0.6)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 26;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.s, p.r, usableW);
      const { y, x0, x1, x2, x3, x4, s: sus } = envPoints(PAD, usableH, wA, wD, wS, wR, p.s, W);
      const breathe = 0.92 + 0.08 * Math.sin(t / 800);
      const mountain = () => {
        ctx.moveTo(x0, y(0));
        ctx.quadraticCurveTo(x0 + wA * 0.35, y(0.92 * breathe), x1, y(1 * breathe));
        ctx.quadraticCurveTo(x1 + wD * 0.4, y(sus + (1 - sus) * 0.2), x2, y(sus));
        ctx.lineTo(x3, y(sus));
        ctx.quadraticCurveTo(x3 + wR * 0.4, y(sus * 0.2), x4, y(0));
      };

      // Multi-layer silhouette with breathing depth
      for (let layer = 4; layer >= 0; layer--) {
        const inset = layer * 2.5;
        const layerBreath = breathe + layer * 0.01;
        ctx.beginPath();
        mountain();
        ctx.lineTo(x4 - inset, PAD + usableH);
        ctx.lineTo(x0 + inset, PAD + usableH);
        ctx.closePath();
        const mg = ctx.createLinearGradient(0, PAD, 0, PAD + usableH);
        mg.addColorStop(0, hexAlpha(GRN, (0.28 - layer * 0.04) * layerBreath));
        mg.addColorStop(0.5, hexAlpha(GRN, (0.12 - layer * 0.02)));
        mg.addColorStop(1, hexAlpha(GRN, 0.01));
        ctx.fillStyle = mg;
        ctx.fill();
      }

      // Fire energy particles rising from attack/peak
      const particles = particlesRef.current;
      if (Math.random() < 0.25) {
        const px = x0 + Math.random() * (x2 - x0);
        particles.push({ x: px, y: y(0.8), vx: (Math.random() - 0.5) * 0.3, vy: -0.8 - Math.random() * 0.6, life: 1 });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life -= 0.012;
        if (pt.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(GRN, pt.life * 0.6);
        ctx.shadowBlur = 6;
        ctx.shadowColor = GRN;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.5 + pt.life * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Top contour with glow
      ctx.beginPath();
      mountain();
      ctx.strokeStyle = GRN;
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 12 + breathe * 6;
      ctx.shadowColor = GRN;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Sustain energy bars (breathing)
      const bars = 10;
      for (let i = 0; i < bars; i++) {
        const bx = x2 + ((x3 - x2) / bars) * i + 2;
        const bh = 4 + sus * 12 * (0.7 + 0.3 * Math.sin(t / 300 + i)) * breathe;
        const barGrad = ctx.createLinearGradient(bx, PAD + usableH - bh, bx, PAD + usableH);
        barGrad.addColorStop(0, hexAlpha(GRN, 0.45 + sus * 0.35));
        barGrad.addColorStop(1, hexAlpha(GRN, 0.08));
        ctx.fillStyle = barGrad;
        ctx.shadowBlur = 4;
        ctx.shadowColor = GRN;
        ctx.fillRect(bx, PAD + usableH - bh, Math.max(3, (x3 - x2) / bars - 4), bh);
      }
      ctx.shadowBlur = 0;

      // Playhead with comet trail
      const cycle = (t / 2400) % 1;
      const px = x0 + cycle * (x4 - x0);
      let py = y(0);
      if (px <= x1) py = y((px - x0) / Math.max(1, wA));
      else if (px <= x2) py = y(1 - ((px - x1) / Math.max(1, wD)) * (1 - sus));
      else if (px <= x3) py = y(sus);
      else py = y(sus * (1 - (px - x3) / Math.max(1, wR)));

      // Comet trail
      for (let trail = 6; trail > 0; trail--) {
        const tcycle = (cycle - trail * 0.02 + 1) % 1;
        const tx = x0 + tcycle * (x4 - x0);
        let ty = y(0);
        if (tx <= x1) ty = y((tx - x0) / Math.max(1, wA));
        else if (tx <= x2) ty = y(1 - ((tx - x1) / Math.max(1, wD)) * (1 - sus));
        else if (tx <= x3) ty = y(sus);
        else ty = y(sus * (1 - (tx - x3) / Math.max(1, wR)));
        ctx.fillStyle = hexAlpha(GRN, (1 - trail / 7) * 0.25);
        ctx.beginPath();
        ctx.arc(tx, ty, 1.5 + (1 - trail / 7) * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 16;
      ctx.shadowColor = GRN;
      ctx.beginPath();
      ctx.arc(px, py, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(GRN, 0.75);
      ctx.textAlign = "center";
      ctx.fillText("FIRE MOUNTAIN", W * 0.5, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(GRN, 0.28)} height={ENV_H} chrome="bloom">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Mod envelope — violet breathing pulse with scan lines + wavetable morph feel. */
function ModEnvViz({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: ENV_H });
  const st = useRef({ a, d, s, r });
  st.current = { a, d, s, r };
  useHiDpiCanvas(wrapRef, canvasRef, ENV_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const VIOLET = "#b084ff";
    const MAGENTA = "#ff6bde";
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, hexAlpha(VIOLET, 0.15));
      bg.addColorStop(0.5, "rgba(12,6,18,0.6)");
      bg.addColorStop(1, hexAlpha(MAGENTA, 0.08));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 26;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.s, p.r, usableW);
      const { y, x0, x1, x2, x3, x4, s: sus } = envPoints(PAD, usableH, wA, wD, wS, wR, p.s, W);
      const pulse = 0.5 + 0.5 * Math.sin(t / 280);
      const breathe = 0.94 + 0.06 * Math.sin(t / 720);

      // Scan line field (morphing intensity)
      for (let scan = 0; scan < 7; scan++) {
        const sy = PAD + 8 + scan * ((usableH - 16) / 6);
        ctx.strokeStyle = hexAlpha(VIOLET, (0.08 + pulse * 0.06) * breathe);
        ctx.beginPath();
        for (let x = x0; x <= x4; x += 2.5) {
          const u = (x - x0) / Math.max(1, x4 - x0);
          const wob = Math.sin(u * Math.PI * 7 + t / 200 + scan * 0.8) * 4 * (0.3 + sus * 0.7) * breathe;
          if (x === x0) ctx.moveTo(x, sy + wob);
          else ctx.lineTo(x, sy + wob);
        }
        ctx.stroke();
      }

      const morph = () => {
        ctx.moveTo(x0, y(0));
        ctx.bezierCurveTo(x0 + wA * 0.4, y(0.85 * breathe), x0 + wA * 0.7, y(1 * breathe), x1, y(1 * breathe));
        ctx.bezierCurveTo(x1 + wD * 0.3, y(sus + 0.2), x1 + wD * 0.7, y(sus), x2, y(sus));
        ctx.lineTo(x3, y(sus));
        ctx.bezierCurveTo(x3 + wR * 0.4, y(sus * 0.6), x3 + wR * 0.7, y(0.1), x4, y(0));
      };

      // Multi-layer silhouette with violet gradient
      for (let layer = 3; layer >= 0; layer--) {
        ctx.beginPath();
        morph();
        ctx.lineTo(x4, PAD + usableH);
        ctx.lineTo(x0, PAD + usableH);
        ctx.closePath();
        const fill = ctx.createLinearGradient(x0, 0, x4, 0);
        fill.addColorStop(0, hexAlpha(VIOLET, (0.08 - layer * 0.02) * breathe));
        fill.addColorStop(0.3, hexAlpha(MAGENTA, (0.32 + pulse * 0.12 - layer * 0.06) * breathe));
        fill.addColorStop(0.7, hexAlpha(VIOLET, (0.18 - layer * 0.03)));
        fill.addColorStop(1, hexAlpha(VIOLET, 0.02));
        ctx.fillStyle = fill;
        ctx.fill();
      }

      // Top contour with breathing glow
      ctx.beginPath();
      morph();
      ctx.strokeStyle = VIOLET;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([7, 4]);
      ctx.shadowBlur = 10 + pulse * 8 + breathe * 4;
      ctx.shadowColor = VIOLET;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Plasma orb at sustain midpoint
      const orbX = x2 + (x3 - x2) * ((t / 1200) % 1);
      const orbGlow = ctx.createRadialGradient(orbX, y(sus), 0, orbX, y(sus), 12 + pulse * 6);
      orbGlow.addColorStop(0, hexAlpha(MAGENTA, 0.75 + pulse * 0.2));
      orbGlow.addColorStop(0.5, hexAlpha(VIOLET, 0.35));
      orbGlow.addColorStop(1, hexAlpha(VIOLET, 0));
      ctx.fillStyle = orbGlow;
      ctx.fillRect(orbX - 18, y(sus) - 18, 36, 36);
      ctx.fillStyle = hexAlpha("#fff", 0.8 + pulse * 0.2);
      ctx.shadowBlur = 16;
      ctx.shadowColor = MAGENTA;
      ctx.beginPath();
      ctx.arc(orbX, y(sus), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(VIOLET, 0.75);
      ctx.textAlign = "left";
      ctx.fillText("VIOLET MORPH PULSE", 10, H - 7);
      ctx.textAlign = "right";
      ctx.fillText("WT SCAN", W - 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha("#b084ff", 0.28)} height={ENV_H} chrome="rails">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Filter envelope — cyan breathing sweep with frequency bands + Bode thumbnail. */
function FiltEnvViz({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: ENV_H });
  const st = useRef({ a, d, s, r });
  st.current = { a, d, s, r };
  useHiDpiCanvas(wrapRef, canvasRef, ENV_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const CYAN = "#5ce0a0";
    const AQUA = "#62f4f4";
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, hexAlpha(CYAN, 0.12));
      bg.addColorStop(1, "rgba(2,12,10,0.6)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 26;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.s, p.r, usableW);
      const { y, x0, x1, x2, x3, x4, s: sus } = envPoints(PAD, usableH, wA, wD, wS, wR, p.s, W);
      const breathe = 0.93 + 0.07 * Math.sin(t / 850);

      // Frequency bands sweeping (animated layers)
      const bands = 8;
      for (let b = 0; b < bands; b++) {
        const bandY = PAD + (usableH / bands) * b;
        const bandH = usableH / bands - 1;
        const sweep = ((t / 1800 + b * 0.1) % 1);
        const bandAlpha = (0.06 + (1 - b / bands) * 0.08) * breathe;
        ctx.fillStyle = hexAlpha(b % 2 === 0 ? CYAN : AQUA, bandAlpha);
        ctx.fillRect(x0, bandY, (x4 - x0) * sweep, bandH);
      }

      const sweepPath = () => {
        ctx.moveTo(x0, y(0));
        ctx.bezierCurveTo(x0 + wA * 0.5, y(0.95 * breathe), x1 - wA * 0.1, y(1 * breathe), x1, y(1 * breathe));
        ctx.bezierCurveTo(x1 + wD * 0.5, y(sus + 0.15), x2 - wD * 0.2, y(sus), x2, y(sus));
        ctx.lineTo(x3, y(sus));
        ctx.bezierCurveTo(x3 + wR * 0.5, y(sus * 0.5), x4 - wR * 0.3, y(0.1), x4, y(0));
      };

      // Multi-layer cyan fill with breathing
      for (let layer = 2; layer >= 0; layer--) {
        ctx.beginPath();
        sweepPath();
        ctx.lineTo(x4, PAD + usableH);
        ctx.lineTo(x0, PAD + usableH);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, PAD, 0, PAD + usableH);
        fill.addColorStop(0, hexAlpha(CYAN, (0.38 - layer * 0.1) * breathe));
        fill.addColorStop(0.5, hexAlpha(CYAN, (0.15 - layer * 0.04)));
        fill.addColorStop(1, hexAlpha(CYAN, 0.02));
        ctx.fillStyle = fill;
        ctx.fill();
      }

      // Top sweep contour
      ctx.beginPath();
      sweepPath();
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 11 + breathe * 6;
      ctx.shadowColor = CYAN;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Sweep marker with vertical line
      const sweepT = (t / 2000) % 1;
      const sx = x0 + sweepT * (x4 - x0);
      let sy = y(0);
      if (sx <= x1) sy = y((sx - x0) / Math.max(1, wA));
      else if (sx <= x2) sy = y(1 - ((sx - x1) / Math.max(1, wD)) * (1 - sus));
      else if (sx <= x3) sy = y(sus);
      else sy = y(sus * (1 - (sx - x3) / Math.max(1, wR)));
      
      const sweepGrad = ctx.createLinearGradient(sx, PAD, sx, sy);
      sweepGrad.addColorStop(0, hexAlpha(AQUA, 0.3));
      sweepGrad.addColorStop(1, hexAlpha(CYAN, 0.7));
      ctx.strokeStyle = sweepGrad;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = CYAN;
      ctx.beginPath();
      ctx.moveTo(sx, PAD);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 14;
      ctx.shadowColor = CYAN;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inset Bode thumbnail (right side, rises with sustain + breathing)
      const thumbW = 32;
      const thumbH = (18 + sus * 12) * breathe;
      const thumbX = W - 12 - thumbW;
      const thumbY = PAD + usableH - thumbH;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
      ctx.strokeStyle = hexAlpha(CYAN, 0.3 + sus * 0.35);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(thumbX, thumbY, thumbW, thumbH);
      
      // Mini frequency response in thumbnail
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const tx = thumbX + (i / 20) * thumbW;
        const ty = thumbY + (1 - sus * breathe) * thumbH + Math.sin(i * 0.5) * sus * 3;
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = hexAlpha(CYAN, 0.7 + sus * 0.25);
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 4;
      ctx.shadowColor = CYAN;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(CYAN, 0.75);
      ctx.textAlign = "left";
      ctx.fillText("CYAN CUTOFF SWEEP", 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha("#5ce0a0", 0.28)} height={ENV_H} chrome="notch">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

function LpgStageViz({ decay }: { decay: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: ENV_H });
  const decayRef = useRef(decay);
  decayRef.current = decay;
  useHiDpiCanvas(wrapRef, canvasRef, ENV_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || performance.now() - last < 32) return;
      last = performance.now();
      const { w: W, h: H } = sizeRef.current;
      const dec = decayRef.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(W * 0.3, H * 0.3, 10, W * 0.5, H * 0.5, W * 0.6);
      bg.addColorStop(0, "rgba(255,207,92,0.18)");
      bg.addColorStop(1, "rgba(10,8,2,0.58)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const k = 4 / Math.max(0.05, dec);
      const usableH = H - 26;
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const u = i / 90;
        const tt = u * 2.5;
        const v = Math.min(1, tt / 0.012) * Math.exp(-k * tt * 0.4);
        const x = PAD + u * (W - PAD * 2);
        const yy = PAD + (1 - v) * usableH;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.lineTo(W - PAD, PAD + usableH);
      ctx.lineTo(PAD, PAD + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, PAD, 0, PAD + usableH);
      fill.addColorStop(0, hexAlpha(GOLD, 0.35));
      fill.addColorStop(1, hexAlpha(GOLD, 0.02));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const u = i / 90;
        const tt = u * 2.5;
        const v = Math.min(1, tt / 0.012) * Math.exp(-k * tt * 0.4);
        const x = PAD + u * (W - PAD * 2);
        const yy = PAD + (1 - v) * usableH;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 12;
      ctx.shadowColor = GOLD;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,207,92,0.65)";
      ctx.textAlign = "center";
      ctx.fillText("VACTROL PLUCK", W * 0.5, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,207,92,0.3)" height={ENV_H} chrome="plate">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

export function AmpEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.ampAttack);
  const d = useFireCommandStore((s) => s.patch.ampDecay);
  const sus = useFireCommandStore((s) => s.patch.ampSustain);
  const r = useFireCommandStore((s) => s.patch.ampRelease);
  const lpg = useFireCommandStore((s) => s.patch.lpgOn);
  const lpgDecay = useFireCommandStore((s) => s.patch.lpgDecay);
  if (lpg) return <LpgStageViz decay={lpgDecay} />;
  return <AmpEnvViz a={a} d={d} s={sus} r={r} />;
}

export function ModEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.modAttack);
  const d = useFireCommandStore((s) => s.patch.modDecay);
  const s = useFireCommandStore((st) => st.patch.modSustain);
  const r = useFireCommandStore((st) => st.patch.modRelease);
  return <ModEnvViz a={a} d={d} s={s} r={r} />;
}

export function FiltEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.filtAttack);
  const d = useFireCommandStore((s) => s.patch.filtDecay);
  const s = useFireCommandStore((st) => st.patch.filtSustain);
  const r = useFireCommandStore((st) => st.patch.filtRelease);
  return <FiltEnvViz a={a} d={d} s={s} r={r} />;
}

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
    let raf = 0;
    let last = 0;
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
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || nowMs - last < 28) return;
      last = nowMs;
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
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(98,182,255,0.28)" height={LFO_H} chrome="scope">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** FM · Ring — metallic interference moiré, carrier/mod Venn with sideband spokes, shimmer particles. */
export function FmRingStageViz() {
  const fm = useFireCommandStore((s) => s.patch.fmAmount);
  const ratio = useFireCommandStore((s) => s.patch.fmRatio);
  const bToA = useFireCommandStore((s) => s.patch.fmBtoA);
  const ring = useFireCommandStore((s) => s.patch.ringAmount);
  const ringHz = useFireCommandStore((s) => s.patch.ringFreq);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: FM_H });
  const st = useRef({ fm, ratio, bToA, ring, ringHz });
  st.current = { fm, ratio, bToA, ring, ringHz };
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; type: number }[]>([]);
  useHiDpiCanvas(wrapRef, canvasRef, FM_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 28) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(255,106,61,${0.12 + p.fm * 0.16})`);
      bg.addColorStop(0.5, "rgba(10,4,6,0.65)");
      bg.addColorStop(1, `rgba(255,106,61,${0.06 + p.ring * 0.14})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.44;
      const amp = H * 0.3;

      // Ring interference moiré field (multiple overlapping frequencies)
      if (p.ring > 0.02) {
        for (let layer = 0; layer < 5; layer++) {
          ctx.strokeStyle = hexAlpha(FIRE, (0.08 + p.ring * 0.12) / (layer + 1));
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i <= W; i++) {
            const u = i / W;
            const beat1 = Math.sin(u * Math.PI * 2 * (p.ringHz / 160) + t / (280 + layer * 50));
            const beat2 = Math.sin(u * Math.PI * 2 * (p.ringHz / 200) * 1.3 + t / (320 + layer * 40));
            const y = mid + (beat1 * 0.6 + beat2 * 0.4) * amp * 0.4 * p.ring;
            if (i === 0) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          }
          ctx.stroke();
        }
      }

      // Main FM waveform with enhanced modulation
      ctx.beginPath();
      for (let i = 0; i <= W; i++) {
        const u = i / W;
        const mod = Math.sin(u * Math.PI * 6 * p.ratio + t / 380) * p.fm * 3.5;
        const fmSig = Math.sin(u * Math.PI * 6 + mod);
        const ringSig = Math.sin(u * Math.PI * 2 * (p.ringHz / 220)) * Math.sin(u * Math.PI * 8 + t / 480);
        const y = mid - (fmSig * (1 - p.ring * 0.5) + ringSig * p.ring) * amp * (0.4 + p.fm * 0.5 + p.bToA * 0.2);
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 13 + p.fm * 8;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Carrier/Modulator Venn with enhanced sideband spokes
      const cx = W * 0.2;
      const cy = mid;
      const R = 20 + p.fm * 10;
      const sep = R * 0.9;

      // Carrier circle (left) with glow
      const carrierGlow = ctx.createRadialGradient(cx - sep * 0.5, cy, 0, cx - sep * 0.5, cy, R * 1.5);
      carrierGlow.addColorStop(0, hexAlpha(FIRE, 0.15));
      carrierGlow.addColorStop(1, hexAlpha(FIRE, 0));
      ctx.fillStyle = carrierGlow;
      ctx.fillRect(cx - sep * 0.5 - R * 1.5, cy - R * 1.5, R * 3, R * 3);
      ctx.strokeStyle = hexAlpha(FIRE, 0.65 + p.fm * 0.25);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = FIRE;
      ctx.beginPath();
      ctx.arc(cx - sep * 0.5, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(FIRE, 0.12);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Modulator circle (right) with glow
      const modGlow = ctx.createRadialGradient(cx + sep * 0.5, cy, 0, cx + sep * 0.5, cy, R * 1.5);
      modGlow.addColorStop(0, hexAlpha(AMB, 0.15));
      modGlow.addColorStop(1, hexAlpha(AMB, 0));
      ctx.fillStyle = modGlow;
      ctx.fillRect(cx + sep * 0.5 - R * 1.5, cy - R * 1.5, R * 3, R * 3);
      ctx.strokeStyle = hexAlpha(AMB, 0.65 + p.fm * 0.25);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = AMB;
      ctx.beginPath();
      ctx.arc(cx + sep * 0.5, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(AMB, 0.12);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Sideband spokes with rotation
      const spokes = Math.min(16, Math.max(3, Math.round(p.ratio * 3)));
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2 + t / 1400;
        const len = R * (1.5 + Math.sin(t / 350 + i) * 0.4);
        const side = i % 2 === 0 ? -1 : 1;
        const spokeColor = i % 2 === 0 ? FIRE : AMB;
        const spokeGrad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.7);
        spokeGrad.addColorStop(0, hexAlpha(spokeColor, 0.5 + p.fm * 0.4));
        spokeGrad.addColorStop(1, hexAlpha(spokeColor, 0));
        ctx.strokeStyle = spokeGrad;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 4;
        ctx.shadowColor = spokeColor;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.7);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Center labels with glow
      ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
      ctx.shadowBlur = 6;
      ctx.fillStyle = hexAlpha(FIRE, 0.9);
      ctx.shadowColor = FIRE;
      ctx.textAlign = "center";
      ctx.fillText("C", cx - sep * 0.5, cy + 2);
      ctx.fillStyle = hexAlpha(AMB, 0.9);
      ctx.shadowColor = AMB;
      ctx.fillText("M", cx + sep * 0.5, cy + 2);
      ctx.shadowBlur = 0;

      // Metallic shimmer particles with types
      const particles = particlesRef.current;
      const particleN = Math.floor(10 + p.fm * 16 + p.ring * 10);
      if (Math.random() < 0.4) {
        particles.push({
          x: Math.random() * W,
          y: mid + (Math.random() - 0.5) * amp * 0.8,
          vx: (Math.random() - 0.5) * 0.8,
          vy: (Math.random() - 0.5) * 0.6,
          life: 1,
          type: Math.floor(Math.random() * 3),
        });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life -= 0.015;
        if (pt.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        const ptColor = pt.type === 0 ? "#fff" : pt.type === 1 ? FIRE : AMB;
        const alpha = (0.2 + 0.5 * Math.sin(t / 120 + i * 2)) * pt.life * (0.5 + p.fm * 0.5);
        ctx.fillStyle = hexAlpha(ptColor, alpha);
        ctx.shadowBlur = 3 + pt.life * 3;
        ctx.shadowColor = ptColor;
        ctx.fillRect(pt.x, pt.y, 2, 2);
      }
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.75)";
      ctx.textAlign = "left";
      ctx.fillText("METALLIC MOIRÉ", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.ring > 0.02 ? `RING ${Math.round(p.ringHz)}Hz` : `RATIO ${p.ratio.toFixed(2)}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={FM_H} chrome="plate">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Pitch · Glide — portamento comet trail + semitone ladder with mono/poly states. */
export function PitchGlideStageViz() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount);
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime);
  const glide = useFireCommandStore((s) => s.patch.glide);
  const mono = useFireCommandStore((s) => s.patch.mono);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: PITCH_H });
  const st = useRef({ amt, time, glide, mono });
  st.current = { amt, time, glide, mono };
  useHiDpiCanvas(wrapRef, canvasRef, PITCH_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,106,61,0.14)");
      bg.addColorStop(0.5, "rgba(8,6,4,0.62)");
      bg.addColorStop(1, "rgba(124,246,176,0.1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.44;
      const railL = 14;
      const railR = W - 14;

      // Semitone ladder rails with labels
      const semitones = 9;
      for (let i = 0; i < semitones; i++) {
        const y = mid - (semitones / 2 - i) * 9;
        const isCtr = i === Math.floor(semitones / 2);
        ctx.strokeStyle = isCtr ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
        ctx.lineWidth = isCtr ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(railL, y);
        ctx.lineTo(railR, y);
        ctx.stroke();
        if (i % 2 === 0 || isCtr) {
          ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = isCtr ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.12)";
          ctx.textAlign = "left";
          const st = i - Math.floor(semitones / 2);
          ctx.fillText(`${st >= 0 ? "+" : ""}${st}`, 3, y + 3);
        }
      }

      // Pitch envelope curve
      const dir = Math.sign(p.amt) || 1;
      const peak = mid - dir * Math.min(38, Math.abs(p.amt) * 0.7);
      const decayX = 24 + Math.min(W * 0.5, 50 + p.time * 100);
      
      // Envelope glow fill
      ctx.beginPath();
      ctx.moveTo(railL + 4, mid);
      ctx.lineTo(32, peak);
      ctx.quadraticCurveTo(decayX * 0.55, peak, decayX, mid);
      ctx.lineTo(railL + 4, mid);
      ctx.closePath();
      const envGrad = ctx.createLinearGradient(railL, peak, decayX, mid);
      envGrad.addColorStop(0, hexAlpha(GRN, 0.25));
      envGrad.addColorStop(1, hexAlpha(GRN, 0.02));
      ctx.fillStyle = envGrad;
      ctx.fill();

      // Envelope contour
      ctx.beginPath();
      ctx.moveTo(railL + 4, mid);
      ctx.lineTo(32, peak);
      ctx.quadraticCurveTo(decayX * 0.55, peak, decayX, mid);
      ctx.strokeStyle = GRN;
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 11;
      ctx.shadowColor = GRN;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Portamento comet trail (mono)
      const gLen = 40 + p.glide * 120;
      const startX = W * 0.52;
      const startY = mid + 12;
      const endX = startX + gLen;
      const endY = mid - 8;
      if (p.mono && p.glide > 0.01) {
        // Comet particles trailing
        for (let trail = 12; trail >= 0; trail--) {
          const u = (t / 1100 + trail * 0.06) % 1;
          const tx = startX + (endX - startX) * u;
          const ty = startY + (endY - startY) * u - Math.sin(u * Math.PI) * 10;
          const alpha = (1 - trail / 13) * (0.2 + p.glide * 0.5);
          const size = 2 + (1 - trail / 13) * 3;
          const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, size * 2);
          glow.addColorStop(0, hexAlpha(FIRE, alpha));
          glow.addColorStop(1, hexAlpha(FIRE, 0));
          ctx.fillStyle = glow;
          ctx.fillRect(tx - size * 2, ty - size * 2, size * 4, size * 4);
        }

        // Portamento curve
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(startX + gLen * 0.35, startY - 16, endX, endY);
        const curveGrad = ctx.createLinearGradient(startX, startY, endX, endY);
        curveGrad.addColorStop(0, hexAlpha(FIRE, 0.3 + p.glide * 0.3));
        curveGrad.addColorStop(1, hexAlpha(FIRE, 0.7 + p.glide * 0.25));
        ctx.strokeStyle = curveGrad;
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10 + p.glide * 8;
        ctx.shadowColor = FIRE;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Head comet gem
        ctx.fillStyle = "#fff";
        ctx.shadowBlur = 16;
        ctx.shadowColor = FIRE;
        ctx.beginPath();
        ctx.arc(endX, endY, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Tail glow
        const tailGlow = ctx.createRadialGradient(startX, startY, 0, startX, startY, 14);
        tailGlow.addColorStop(0, hexAlpha(FIRE, 0.45));
        tailGlow.addColorStop(1, hexAlpha(FIRE, 0));
        ctx.fillStyle = tailGlow;
        ctx.fillRect(startX - 14, startY - 14, 28, 28);
      } else {
        // Poly: multiple discrete note dots with connection lines
        for (let v = 0; v < 5; v++) {
          const vx = startX + v * 20;
          const vy = mid + 10 - (v % 3) * 7 + Math.sin(t / 400 + v) * 2;
          const vGlow = ctx.createRadialGradient(vx, vy, 0, vx, vy, 8);
          vGlow.addColorStop(0, "rgba(255,255,255,0.35)");
          vGlow.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = vGlow;
          ctx.fillRect(vx - 8, vy - 8, 16, 16);
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.shadowBlur = 6;
          ctx.shadowColor = "#fff";
          ctx.beginPath();
          ctx.arc(vx, vy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Poly connection dashes
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, mid + 12);
        ctx.lineTo(startX + 80, mid + 12);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.75)";
      ctx.textAlign = "left";
      ctx.fillText("SEMITONE LADDER", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = p.mono ? hexAlpha(FIRE, 0.85) : "rgba(255,255,255,0.45)";
      ctx.fillText(p.mono ? "MONO COMET" : "POLY DISCRETE", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={PITCH_H} chrome="rails">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

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
    let raf = 0;
    let last = 0;
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
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = performance.now();
      if (document.hidden || t - last < 33) return;
      last = t;
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
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [group, color]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(color, 0.28)} height={OSC_H} chrome="corners">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Performance — macro radar with expression arcs, voice constellation, routing beams. */
export function PerformanceStageViz() {
  const mono = useFireCommandStore((s) => s.patch.mono);
  const harmony = useFireCommandStore((s) => s.patch.harmonyMode);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 520, h: PERF_H });
  const st = useRef({ mono, harmony, maxVoices, fxOn, voices: 0 });
  st.current = { mono, harmony, maxVoices, fxOn, voices: st.current.voices };
  useHiDpiCanvas(wrapRef, canvasRef, PERF_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 40) return;
      last = t;
      let n = 0;
      try { n = getEngine().fireCommand.getActiveVoiceCount(); } catch { n = 0; }
      st.current.voices = n;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,106,61,0.12)");
      bg.addColorStop(0.5, "rgba(8,6,4,0.55)");
      bg.addColorStop(1, p.fxOn ? "rgba(98,182,255,0.1)" : "rgba(255,255,255,0.03)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Radar sweep arc (performance expression metaphor)
      const radarCx = W * 0.12;
      const radarCy = H * 0.5;
      const radarR = 28;
      const sweepAngle = (t / 1800) % (Math.PI * 2);
      const voiceActivity = Math.min(1, p.voices / Math.max(1, p.maxVoices));
      
      // Radar rings
      for (let i = 1; i <= 3; i++) {
        ctx.strokeStyle = `rgba(255,106,61,${0.06 + voiceActivity * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(radarCx, radarCy, radarR * (i / 3), 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Sweep beam
      ctx.strokeStyle = `rgba(255,106,61,${0.35 + voiceActivity * 0.45})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8 + voiceActivity * 12;
      ctx.shadowColor = FIRE;
      ctx.beginPath();
      ctx.moveTo(radarCx, radarCy);
      ctx.lineTo(radarCx + Math.cos(sweepAngle) * radarR, radarCy + Math.sin(sweepAngle) * radarR);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Expression arcs showing voice spread
      if (p.voices > 0) {
        for (let v = 0; v < Math.min(6, p.voices); v++) {
          const arcAngle = sweepAngle + (v / Math.max(1, p.voices - 1)) * Math.PI * 0.6 - Math.PI * 0.3;
          const arcR = radarR * (0.4 + (v / Math.max(1, p.voices)) * 0.5);
          const arcAlpha = 0.25 + (1 - v / Math.max(1, p.voices)) * 0.35;
          ctx.strokeStyle = p.mono ? hexAlpha(FIRE, arcAlpha) : hexAlpha(AMB, arcAlpha);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(radarCx, radarCy, arcR, arcAngle - 0.1, arcAngle + 0.1);
          ctx.stroke();
        }
      }

      // Mini piano-key silhouette row (performance metaphor)
      const keyCount = Math.min(24, p.maxVoices);
      const keyPad = 14;
      const keyW = (W - keyPad * 2) / keyCount;
      const keyH = 32;
      const keyY = H * 0.42;

      for (let i = 0; i < keyCount; i++) {
        const active = i < p.voices;
        const x = keyPad + i * keyW;
        
        // Key body
        ctx.fillStyle = active
          ? hexAlpha(p.mono ? FIRE : AMB, 0.65 + Math.sin(t / 280 + i * 0.5) * 0.15)
          : "rgba(255,255,255,0.06)";
        ctx.fillRect(x + 0.5, keyY, Math.max(1, keyW - 1.5), keyH);
        
        // Key edge
        ctx.strokeStyle = active
          ? hexAlpha(p.mono ? FIRE : FIRE, 0.45)
          : "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, keyY, Math.max(1, keyW - 1.5), keyH);

        // Glow for active keys
        if (active) {
          ctx.shadowBlur = 6;
          ctx.shadowColor = p.mono ? FIRE : AMB;
          ctx.fillStyle = hexAlpha(p.mono ? FIRE : GOLD, 0.8);
          ctx.fillRect(x + 0.5, keyY, Math.max(1, keyW - 1.5), 3);
          ctx.shadowBlur = 0;
        }
      }

      // FX routing beam (right edge)
      if (p.fxOn) {
        const beamX = W - keyPad - 8;
        const beamPulse = 0.6 + 0.4 * Math.sin(t / 320);
        ctx.strokeStyle = hexAlpha(ICE, 0.35 + beamPulse * 0.25);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = ICE;
        ctx.beginPath();
        ctx.moveTo(beamX, keyY);
        ctx.lineTo(beamX, keyY + keyH);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // FX glow wash
        const tintW = 40;
        const tint = ctx.createLinearGradient(W - keyPad - tintW, 0, W - keyPad, 0);
        tint.addColorStop(0, "rgba(98,182,255,0)");
        tint.addColorStop(1, `rgba(98,182,255,${0.12 + beamPulse * 0.08})`);
        ctx.fillStyle = tint;
        ctx.fillRect(W - keyPad - tintW, keyY, tintW, keyH);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(`PERFORMANCE · ${p.voices}/${p.maxVoices}`, 10, H - 8);
      ctx.textAlign = "right";
      const mode = p.mono ? "MONO" : "POLY";
      const harm = p.harmony && p.harmony !== "off" ? ` ${String(p.harmony).toUpperCase()}` : "";
      ctx.fillStyle = p.fxOn ? "rgba(98,182,255,0.75)" : "rgba(255,106,61,0.6)";
      ctx.fillText(`${mode}${harm} ${p.fxOn ? "→FX" : "DRY"}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={PERF_H} chrome="keys">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}
