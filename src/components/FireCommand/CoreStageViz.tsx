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

function StageFrame({
  children,
  border,
  height,
  wrapRef,
}: {
  children: ReactNode;
  border: string;
  height: number;
  wrapRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={wrapRef as RefObject<HTMLDivElement>}
      className="relative mb-2.5 overflow-hidden rounded-xl border bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.28)]"
      style={{ borderColor: border, height }}
    >
      {children}
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: border }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: border }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: border }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: border }} />
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

/** Mixer · Unison — voice fan + stereo L/R rails, sub/noise meters, drift shimmer. */
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

      // L/R stereo rails
      const railTop = cy - 38;
      const railBot = cy + 38;
      ctx.strokeStyle = hexAlpha(ICE, 0.12 + stereoAmt * 0.18);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(14, railTop);
      ctx.lineTo(W - 14, railTop);
      ctx.moveTo(14, railBot);
      ctx.lineTo(W - 14, railBot);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(ICE, 0.35);
      ctx.textAlign = "left";
      ctx.fillText("L", 6, railTop + 3);
      ctx.textAlign = "right";
      ctx.fillText("R", W - 6, railBot + 3);

      // Fan base arc
      ctx.beginPath();
      ctx.arc(cx, cy + 6, spread * 0.55, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = hexAlpha(FIRE, 0.08);
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const pan = u * stereoAmt;
        const x = cx + u * spread;
        const lean = u * det * 22 + pan * 6;
        const amp = (22 + (1 - Math.abs(u)) * 14) * breath;
        const hueShift = Math.abs(u) * 0.3;
        const col = hueShift > 0.15 ? AMB : FIRE;

        // Voice stem glow
        const stem = ctx.createLinearGradient(x, cy - amp, x, cy + amp);
        stem.addColorStop(0, hexAlpha(col, 0.55 + (1 - Math.abs(u)) * 0.3));
        stem.addColorStop(0.5, hexAlpha(col, 0.25));
        stem.addColorStop(1, hexAlpha(col, 0.05));
        ctx.beginPath();
        ctx.moveTo(x + lean * 0.15, cy - amp);
        ctx.quadraticCurveTo(x + lean, cy, x + lean * 0.15, cy + amp);
        ctx.strokeStyle = stem;
        ctx.lineWidth = n === 1 ? 2.8 : 1.6 + (1 - Math.abs(u)) * 0.6;
        ctx.shadowBlur = 8 + (1 - Math.abs(u)) * 6;
        ctx.shadowColor = col;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Pan rail connectors
        const tipY = cy - amp;
        ctx.strokeStyle = hexAlpha(ICE, 0.08 + stereoAmt * 0.12);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + lean * 0.15, tipY);
        ctx.lineTo(14 + (W - 28) * ((pan + 1) / 2), railTop + 2);
        ctx.stroke();

        ctx.fillStyle = hexAlpha(col, 0.85);
        ctx.beginPath();
        ctx.arc(x + lean * 0.15, tipY, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Detune lean indicator
      if (Math.abs(p.detune) > 0.5) {
        const leanX = cx + Math.sign(p.detune) * Math.min(28, Math.abs(p.detune) * 0.4);
        ctx.strokeStyle = hexAlpha(AMB, 0.4);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy + 22);
        ctx.lineTo(leanX, cy + 22);
        ctx.stroke();
        ctx.fillStyle = hexAlpha(AMB, 0.7);
        ctx.beginPath();
        ctx.moveTo(leanX, cy + 22);
        ctx.lineTo(leanX - Math.sign(p.detune) * 5, cy + 19);
        ctx.lineTo(leanX - Math.sign(p.detune) * 5, cy + 25);
        ctx.closePath();
        ctx.fill();
      }

      // Drift shimmer
      if (p.drift > 0.02) {
        for (let layer = 0; layer < 3; layer++) {
          ctx.strokeStyle = hexAlpha(AMB, (0.12 + p.drift * 0.2) / (layer + 1));
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = W * 0.68; x < W - 10; x += 2) {
            const y = cy + Math.sin(x * 0.07 + t / (350 + layer * 80) + layer) * p.drift * (12 + layer * 3);
            if (x === W * 0.68) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Sub / noise meters
      const meterY = H - 22;
      const meterW = 56;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(10, meterY, meterW, 6);
      ctx.fillRect(76, meterY, meterW, 6);
      const subFill = meterW * Math.max(0.06, p.sub);
      const subGrad = ctx.createLinearGradient(10, 0, 10 + subFill, 0);
      subGrad.addColorStop(0, hexAlpha(GOLD, 0.35));
      subGrad.addColorStop(1, hexAlpha(GOLD, 0.85));
      ctx.fillStyle = subGrad;
      ctx.fillRect(10, meterY, subFill, 6);
      const noiseFill = meterW * Math.max(0.04, p.noise);
      const noiseGrad = ctx.createLinearGradient(76, 0, 76 + noiseFill, 0);
      noiseGrad.addColorStop(0, hexAlpha(ICE, 0.3));
      noiseGrad.addColorStop(1, hexAlpha(ICE, 0.75));
      ctx.fillStyle = noiseGrad;
      ctx.fillRect(76, meterY, noiseFill, 6);

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.6)";
      ctx.textAlign = "left";
      ctx.fillText(`${n} VOICE FAN`, 10, H - 7);
      ctx.fillStyle = "rgba(255,207,92,0.5)";
      ctx.textAlign = "right";
      ctx.fillText(`SUB ${(p.subWave as SubWave).slice(0, 3).toUpperCase()}`, W - 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={UNISON_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Filter — cinematic frequency response bay. */
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

      // Filled response
      const pts: { x: number; y: number; g: number }[] = [];
      for (let i = 0; i <= 120; i++) {
        const f = fLo * Math.pow(fHi / fLo, i / 120);
        const g = gain(f);
        const y = top + (1 - Math.min(1, g / 1.6)) * usableH;
        pts.push({ x: xOf(f), y, g });
      }
      ctx.beginPath();
      ctx.moveTo(PAD, top + usableH);
      for (const pt of pts) ctx.lineTo(pt.x, pt.y);
      ctx.lineTo(W - PAD, top + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, top, 0, top + usableH);
      fill.addColorStop(0, hexAlpha(FIRE, 0.38 + heat));
      fill.addColorStop(0.6, hexAlpha(FIRE, 0.08));
      fill.addColorStop(1, hexAlpha(FIRE, 0.01));
      ctx.fillStyle = fill;
      ctx.fill();

      // Resonance bloom at peak
      let peakPt = pts[0];
      for (const pt of pts) if (pt.g > peakPt.g) peakPt = pt;
      if (peak > 0.08) {
        const bloom = ctx.createRadialGradient(peakPt.x, peakPt.y, 0, peakPt.x, peakPt.y, 18 + peak * 22);
        bloom.addColorStop(0, hexAlpha(FIRE, 0.35 + peak * 0.25));
        bloom.addColorStop(1, hexAlpha(FIRE, 0));
        ctx.fillStyle = bloom;
        ctx.fillRect(peakPt.x - 40, peakPt.y - 40, 80, 80);
      }

      // Curve stroke
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 12 + peak * 8;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Cutoff laser
      const cx = xOf(Math.max(fLo, Math.min(fHi, p.cutoff)));
      const pulse = 0.65 + 0.35 * Math.sin(t / 420);
      const laser = ctx.createLinearGradient(cx - 1, top, cx + 1, top + usableH);
      laser.addColorStop(0, hexAlpha(FIRE, 0.15 * pulse));
      laser.addColorStop(0.5, hexAlpha("#fff", 0.55 * pulse));
      laser.addColorStop(1, hexAlpha(FIRE, 0.1 * pulse));
      ctx.fillStyle = laser;
      ctx.fillRect(cx - 1.5, top, 3, usableH);
      ctx.strokeStyle = hexAlpha(FIRE, 0.5);
      ctx.setLineDash([4, 5]);
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

      // Sat heat shimmer
      if (p.sat > 0.05) {
        ctx.fillStyle = hexAlpha("#ff9040", p.sat * 0.06);
        for (let i = 0; i < 6; i++) {
          const sx = PAD + ((t / 80 + i * 47) % (W - PAD * 2));
          ctx.fillRect(sx, top + usableH - 4 - (i % 3) * 2, 2, 2);
        }
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.6)";
      ctx.textAlign = "left";
      ctx.fillText((p.type as FireFilterType).toUpperCase(), 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(p.cutoff)} Hz · Q ${p.res.toFixed(1)}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={FILTER_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Amp envelope — green volume mountain / energy silhouette. */
function AmpEnvViz({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
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
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, hexAlpha(GRN, 0.14));
      bg.addColorStop(1, "rgba(2,8,5,0.6)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 26;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.s, p.r, usableW);
      const { y, x0, x1, x2, x3, x4, s: sus } = envPoints(PAD, usableH, wA, wD, wS, wR, p.s, W);
      const mountain = () => {
        ctx.moveTo(x0, y(0));
        ctx.quadraticCurveTo(x0 + wA * 0.35, y(0.92), x1, y(1));
        ctx.quadraticCurveTo(x1 + wD * 0.4, y(sus + (1 - sus) * 0.2), x2, y(sus));
        ctx.lineTo(x3, y(sus));
        ctx.quadraticCurveTo(x3 + wR * 0.4, y(sus * 0.2), x4, y(0));
      };
      for (let layer = 3; layer >= 0; layer--) {
        const inset = layer * 3;
        ctx.beginPath();
        mountain();
        ctx.lineTo(x4 - inset, PAD + usableH);
        ctx.lineTo(x0 + inset, PAD + usableH);
        ctx.closePath();
        const mg = ctx.createLinearGradient(0, PAD, 0, PAD + usableH);
        mg.addColorStop(0, hexAlpha(GRN, 0.18 - layer * 0.03));
        mg.addColorStop(1, hexAlpha(GRN, 0.01));
        ctx.fillStyle = mg;
        ctx.fill();
      }
      ctx.beginPath();
      mountain();
      ctx.strokeStyle = GRN;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = GRN;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const bars = 8;
      for (let i = 0; i < bars; i++) {
        const bx = x2 + ((x3 - x2) / bars) * i + 2;
        const bh = 4 + sus * 10 * (0.7 + 0.3 * Math.sin(t / 300 + i));
        ctx.fillStyle = hexAlpha(GRN, 0.15 + sus * 0.25);
        ctx.fillRect(bx, PAD + usableH - bh, Math.max(3, (x3 - x2) / bars - 4), bh);
      }
      const cycle = (t / 2400) % 1;
      const px = x0 + cycle * (x4 - x0);
      let py = y(0);
      if (px <= x1) py = y((px - x0) / Math.max(1, wA));
      else if (px <= x2) py = y(1 - ((px - x1) / Math.max(1, wD)) * (1 - sus));
      else if (px <= x3) py = y(sus);
      else py = y(sus * (1 - (px - x3) / Math.max(1, wR)));
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 12;
      ctx.shadowColor = GRN;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(GRN, 0.6);
      ctx.textAlign = "left";
      ctx.fillText("AMP · VOLUME", 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(GRN, 0.28)} height={ENV_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Mod envelope — lime morph-pulse / wavetable modulation feel. */
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
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, hexAlpha(LIME, 0.12));
      bg.addColorStop(0.5, "rgba(6,10,2,0.55)");
      bg.addColorStop(1, hexAlpha(LIME, 0.06));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 26;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.s, p.r, usableW);
      const { y, x0, x1, x2, x3, x4, s: sus } = envPoints(PAD, usableH, wA, wD, wS, wR, p.s, W);
      const pulse = 0.5 + 0.5 * Math.sin(t / 280);
      for (let scan = 0; scan < 5; scan++) {
        const sy = PAD + 8 + scan * ((usableH - 16) / 4);
        ctx.strokeStyle = hexAlpha(LIME, 0.06 + pulse * 0.04);
        ctx.beginPath();
        for (let x = x0; x <= x4; x += 3) {
          const u = (x - x0) / Math.max(1, x4 - x0);
          const wob = Math.sin(u * Math.PI * 6 + t / 200 + scan) * 3 * (0.3 + sus * 0.7);
          if (x === x0) ctx.moveTo(x, sy + wob);
          else ctx.lineTo(x, sy + wob);
        }
        ctx.stroke();
      }
      const morph = () => {
        ctx.moveTo(x0, y(0));
        ctx.lineTo(x1, y(1));
        ctx.lineTo(x2, y(sus));
        ctx.lineTo(x3, y(sus));
        ctx.lineTo(x4, y(0));
      };
      ctx.beginPath();
      morph();
      ctx.lineTo(x4, PAD + usableH);
      ctx.lineTo(x0, PAD + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(x0, 0, x4, 0);
      fill.addColorStop(0, hexAlpha(LIME, 0.05));
      fill.addColorStop(0.3, hexAlpha(LIME, 0.28 + pulse * 0.1));
      fill.addColorStop(0.7, hexAlpha(LIME, 0.15));
      fill.addColorStop(1, hexAlpha(LIME, 0.02));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      morph();
      ctx.strokeStyle = LIME;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.shadowBlur = 8 + pulse * 6;
      ctx.shadowColor = LIME;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const orbX = x2 + (x3 - x2) * ((t / 1200) % 1);
      ctx.fillStyle = hexAlpha(LIME, 0.5 + pulse * 0.3);
      ctx.shadowBlur = 14;
      ctx.shadowColor = LIME;
      ctx.beginPath();
      ctx.arc(orbX, y(sus), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(LIME, 0.6);
      ctx.textAlign = "left";
      ctx.fillText("MOD → MORPH", 10, H - 7);
      ctx.textAlign = "right";
      ctx.fillText("WT SCAN", W - 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(LIME, 0.28)} height={ENV_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Filter envelope — teal cutoff-sweep metaphor. */
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
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, hexAlpha(TEAL, 0.1));
      bg.addColorStop(1, "rgba(2,10,8,0.58)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 26;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.s, p.r, usableW);
      const { y, x0, x1, x2, x3, x4, s: sus } = envPoints(PAD, usableH, wA, wD, wS, wR, p.s, W);
      const bands = 6;
      for (let b = 0; b < bands; b++) {
        const bandY = PAD + (usableH / bands) * b;
        const bandH = usableH / bands - 1;
        const sweep = ((t / 1800 + b * 0.12) % 1);
        ctx.fillStyle = hexAlpha(TEAL, 0.04 + (1 - b / bands) * 0.06);
        ctx.fillRect(x0, bandY, (x4 - x0) * sweep, bandH);
      }
      const sweepPath = () => {
        ctx.moveTo(x0, y(0));
        ctx.bezierCurveTo(x0 + wA * 0.5, y(0.95), x1 - wA * 0.1, y(1), x1, y(1));
        ctx.bezierCurveTo(x1 + wD * 0.5, y(sus + 0.15), x2 - wD * 0.2, y(sus), x2, y(sus));
        ctx.lineTo(x3, y(sus));
        ctx.bezierCurveTo(x3 + wR * 0.5, y(sus * 0.5), x4 - wR * 0.3, y(0.1), x4, y(0));
      };
      ctx.beginPath();
      sweepPath();
      ctx.lineTo(x4, PAD + usableH);
      ctx.lineTo(x0, PAD + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, PAD, 0, PAD + usableH);
      fill.addColorStop(0, hexAlpha(TEAL, 0.3));
      fill.addColorStop(0.5, hexAlpha(TEAL, 0.1));
      fill.addColorStop(1, hexAlpha(TEAL, 0.02));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      sweepPath();
      ctx.strokeStyle = TEAL;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 9;
      ctx.shadowColor = TEAL;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const sweepT = (t / 2000) % 1;
      const sx = x0 + sweepT * (x4 - x0);
      let sy = y(0);
      if (sx <= x1) sy = y((sx - x0) / Math.max(1, wA));
      else if (sx <= x2) sy = y(1 - ((sx - x1) / Math.max(1, wD)) * (1 - sus));
      else if (sx <= x3) sy = y(sus);
      else sy = y(sus * (1 - (sx - x3) / Math.max(1, wR)));
      ctx.strokeStyle = hexAlpha(TEAL, 0.5);
      ctx.beginPath();
      ctx.moveTo(sx, PAD);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = TEAL;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(TEAL, 0.6);
      ctx.textAlign = "left";
      ctx.fillText("FILTER ENV · CUTOFF", 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(TEAL, 0.28)} height={ENV_H}>
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
      ctx.fillStyle = "rgba(255,207,92,0.6)";
      ctx.fillText("VACTROL PLUCK", 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,207,92,0.3)" height={ENV_H}>
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

/** LFO stage — dual-layer waveform, depth ribbon, tracer bloom, destination readout. */
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
      bg.addColorStop(0, "rgba(98,182,255,0.14)");
      bg.addColorStop(0.5, "rgba(4,8,14,0.6)");
      bg.addColorStop(1, "rgba(98,182,255,0.06)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.44;
      const amp = (H * 0.3) * Math.max(0.14, p.depth);
      const xL = 10;
      const xR = W - 10;
      const span = xR - xL;

      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      ctx.lineTo(xR, mid);
      ctx.stroke();

      // Back ghost layer (phase offset)
      ctx.beginPath();
      for (let x = xL; x <= xR; x++) {
        const ph = ((x - xL) / span) * 2 + 0.25;
        const y = mid - shape(p.wave, ph) * amp * 0.55;
        if (x === xL) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(ICE, 0.2);
      ctx.lineWidth = 1.2;
      ctx.stroke();

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
      ribbon.addColorStop(0, hexAlpha(ICE, 0.28));
      ribbon.addColorStop(0.5, hexAlpha(ICE, 0.12));
      ribbon.addColorStop(1, hexAlpha(ICE, 0.02));
      ctx.fillStyle = ribbon;
      ctx.fill();

      // Front waveform
      ctx.beginPath();
      for (let x = xL; x <= xR; x++) {
        const y = mid - shape(p.wave, ((x - xL) / span) * 2) * amp;
        if (x === xL) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = ICE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      let engT = nowMs / 1000;
      try { engT = getEngine().ctx.currentTime; } catch { /* */ }
      const ph = (engT * p.rate) % 2;
      const px = xL + (ph / 2) * span;
      const py = mid - shape(p.wave, ph) * amp;

      // Tracer bloom
      const bloom = ctx.createRadialGradient(px, py, 0, px, py, 14 + p.depth * 10);
      bloom.addColorStop(0, hexAlpha(ICE, 0.45));
      bloom.addColorStop(1, hexAlpha(ICE, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(px - 20, py - 20, 40, 40);
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 16;
      ctx.shadowColor = ICE;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(98,182,255,0.6)";
      ctx.textAlign = "left";
      ctx.fillText(`LFO ${idx} · ${String(p.wave).toUpperCase()}`, 10, H - 8);
      ctx.textAlign = "right";
      const destLabel = (p.dest as LfoDest) === "off" ? "IDLE" : `→ ${(p.dest as string).toUpperCase()}`;
      ctx.fillStyle = (p.dest as LfoDest) === "off" ? "rgba(98,182,255,0.3)" : "rgba(98,182,255,0.7)";
      ctx.fillText(destLabel, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(98,182,255,0.28)" height={LFO_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** FM · Ring — sideband chaos, carrier/mod spokes, ring interference, shimmer particles. */
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
      bg.addColorStop(0, `rgba(255,106,61,${0.1 + p.fm * 0.14})`);
      bg.addColorStop(0.5, "rgba(10,4,6,0.62)");
      bg.addColorStop(1, `rgba(255,106,61,${0.05 + p.ring * 0.12})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.44;
      const amp = H * 0.28;

      // Ring interference field
      if (p.ring > 0.02) {
        for (let layer = 0; layer < 3; layer++) {
          ctx.strokeStyle = hexAlpha(FIRE, 0.06 + p.ring * 0.08);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let i = 0; i <= W; i++) {
            const u = i / W;
            const beat = Math.sin(u * Math.PI * 2 * (p.ringHz / 180) + t / (300 + layer * 60));
            const y = mid + beat * amp * 0.35 * p.ring;
            if (i === 0) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          }
          ctx.stroke();
        }
      }

      // Main FM waveform
      ctx.beginPath();
      for (let i = 0; i <= W; i++) {
        const u = i / W;
        const mod = Math.sin(u * Math.PI * 6 * p.ratio + t / 380);
        const fmSig = Math.sin(u * Math.PI * 6 + mod * p.fm * 3);
        const ringSig = Math.sin(u * Math.PI * 2 * (p.ringHz / 220)) * Math.sin(u * Math.PI * 8 + t / 480);
        const y = mid - (fmSig * (1 - p.ring * 0.5) + ringSig * p.ring) * amp * (0.35 + p.fm * 0.55 + p.bToA * 0.2);
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 11;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Carrier hub + modulator spokes
      const cx = W * 0.2;
      const cy = mid;
      const R = 18 + p.fm * 8;
      ctx.strokeStyle = hexAlpha(FIRE, 0.4);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      const spokes = Math.min(14, Math.max(2, Math.round(p.ratio * 2)));
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2 + t / 1600;
        const len = R + 4 + Math.sin(t / 400 + i) * 3;
        ctx.strokeStyle = hexAlpha(i % 2 === 0 ? FIRE : AMB, 0.3 + p.fm * 0.3);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        ctx.stroke();
      }
      ctx.fillStyle = hexAlpha(FIRE, 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Metallic shimmer particles
      const particleN = Math.floor(8 + p.fm * 12 + p.ring * 8);
      for (let i = 0; i < particleN; i++) {
        const px = ((t / 40 + i * 37) % W);
        const py = mid + Math.sin(px * 0.05 + t / 200 + i) * amp * 0.6;
        const alpha = 0.15 + 0.35 * Math.sin(t / 150 + i * 2.1);
        ctx.fillStyle = hexAlpha(i % 3 === 0 ? "#fff" : FIRE, alpha * (0.4 + p.fm * 0.4));
        ctx.fillRect(px, py, 1.5, 1.5);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.6)";
      ctx.textAlign = "left";
      ctx.fillText("FM · RING", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.ring > 0.02 ? `RING ${Math.round(p.ringHz)}Hz` : `${p.ratio.toFixed(2)}×`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={FM_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Pitch · Glide — semitone ladder, portamento comet, mono vs poly. */
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
      bg.addColorStop(0, "rgba(255,106,61,0.12)");
      bg.addColorStop(0.5, "rgba(8,6,4,0.6)");
      bg.addColorStop(1, "rgba(124,246,176,0.08)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.44;
      const railL = 14;
      const railR = W - 14;

      // Semitone ladder rails
      const semitones = 7;
      for (let i = 0; i < semitones; i++) {
        const y = mid - (semitones / 2 - i) * 8;
        ctx.strokeStyle = i === Math.floor(semitones / 2) ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
        ctx.beginPath();
        ctx.moveTo(railL, y);
        ctx.lineTo(railR, y);
        ctx.stroke();
        if (i % 2 === 0) {
          ctx.font = "600 6px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.textAlign = "left";
          ctx.fillText(`${i - 3}`, railL - 2, y + 2);
        }
      }

      const dir = Math.sign(p.amt) || 1;
      const peak = mid - dir * Math.min(32, Math.abs(p.amt) * 0.6);
      const decayX = 24 + Math.min(W * 0.5, 44 + p.time * 95);
      ctx.beginPath();
      ctx.moveTo(railL + 4, mid);
      ctx.lineTo(32, peak);
      ctx.quadraticCurveTo(decayX * 0.55, peak, decayX, mid);
      ctx.strokeStyle = GRN;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 9;
      ctx.shadowColor = GRN;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Portamento comet trail
      const gLen = 36 + p.glide * 110;
      const startX = W * 0.52;
      const startY = mid + 10;
      const endX = startX + gLen;
      const endY = mid - 6;
      if (p.mono && p.glide > 0.01) {
        for (let trail = 8; trail >= 0; trail--) {
          const u = (t / 1200 + trail * 0.08) % 1;
          const tx = startX + (endX - startX) * u;
          const ty = startY + (endY - startY) * u - Math.sin(u * Math.PI) * 8;
          const alpha = (1 - trail / 9) * (0.15 + p.glide * 0.4);
          ctx.fillStyle = hexAlpha(FIRE, alpha);
          ctx.beginPath();
          ctx.arc(tx, ty, 2 + (1 - trail / 9) * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(startX + gLen * 0.35, startY - 14, endX, endY);
        ctx.strokeStyle = hexAlpha(FIRE, 0.55 + p.glide * 0.35);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = FIRE;
        ctx.shadowBlur = 12;
        ctx.shadowColor = FIRE;
        ctx.beginPath();
        ctx.arc(endX, endY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // Poly: multiple discrete note dots
        for (let v = 0; v < 4; v++) {
          const vx = startX + v * 18;
          const vy = mid + 8 - (v % 2) * 6;
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.beginPath();
          ctx.arc(vx, vy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.moveTo(startX, mid + 10);
        ctx.lineTo(startX + 54, mid + 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.6)";
      ctx.textAlign = "left";
      ctx.fillText("PITCH · GLIDE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = p.mono ? hexAlpha(FIRE, 0.7) : "rgba(255,255,255,0.35)";
      ctx.fillText(p.mono ? "MONO · GLIDE" : "POLY · PER VOICE", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={PITCH_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Oscillator — perspective wavetable stack + glow fill + morph tick. */
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
      bg.addColorStop(0, hexAlpha(color, 0.12 + p.level * 0.14));
      bg.addColorStop(1, "rgba(4,4,6,0.58)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cur = livePos * (FRAME_COUNT - 1);
      const lo = Math.floor(cur);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = cur - lo;
      const mid = H * 0.46;
      const amp = (H * 0.3) * (0.25 + p.level * 0.75);
      const xL = 10;
      const xR = W - 10;

      // Ghost frames (perspective stack)
      const ghosts = [-2, -1, 1, 2];
      for (const offset of ghosts) {
        const fIdx = Math.max(0, Math.min(FRAME_COUNT - 1, lo + offset));
        const depth = 1 - Math.abs(offset) * 0.22;
        const yShift = offset * 3;
        const xInset = Math.abs(offset) * 4;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = sampleAt(fIdx, i);
          const x = xL + xInset + (i / (N - 1)) * (xR - xL - xInset * 2);
          const y = mid + yShift - v * amp * depth * 0.7;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(color, 0.08 * depth);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Glow fill under front wave
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const v = cache[lo][i] * (1 - frac) + cache[hi][i] * frac;
        const x = xL + (i / (N - 1)) * (xR - xL);
        const y = mid - v * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xR, mid + amp * 0.3);
      ctx.lineTo(xL, mid + amp * 0.3);
      ctx.closePath();
      const glow = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      glow.addColorStop(0, hexAlpha(color, 0.25 + p.level * 0.2));
      glow.addColorStop(1, hexAlpha(color, 0.01));
      ctx.fillStyle = glow;
      ctx.fill();

      // Front wave
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const v = cache[lo][i] * (1 - frac) + cache[hi][i] * frac;
        const x = xL + (i / (N - 1)) * (xR - xL);
        const y = mid - v * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10 + p.level * 8;
      ctx.shadowColor = color;
      ctx.globalAlpha = 0.4 + p.level * 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Morph position tick
      const mx = xL + livePos * (xR - xL);
      ctx.strokeStyle = hexAlpha(color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, H - 18);
      ctx.lineTo(mx, mid + amp * 0.35);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(color, 0.85);
      ctx.fillRect(mx - 1.5, H - 18, 3, 10);

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(color, 0.6);
      ctx.textAlign = "left";
      ctx.fillText(`OSC ${group.toUpperCase()}`, 10, H - 7);
      ctx.textAlign = "right";
      ctx.fillText(p.level < 0.01 ? "SILENT" : `${Math.round(p.level * 100)}%`, W - 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [group, color]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(color, 0.28)} height={OSC_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Performance — voice constellation with depth + routing. */
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

      const slots = Math.min(32, p.maxVoices);
      const pad = 12;
      const usable = W - pad * 2;
      const gap = usable / Math.max(1, slots);
      const baseY = H * 0.52;

      // Depth layers (back constellation)
      for (let layer = 2; layer >= 0; layer--) {
        for (let i = 0; i < slots; i++) {
          const active = i < p.voices;
          const x = pad + i * gap + gap * 0.25 + layer * 0.5;
          const bh = (active ? 10 + Math.sin(t / 220 + i * 0.7) * 5 : 5) - layer * 2;
          const y = baseY - layer * 3;
          ctx.fillStyle = active
            ? hexAlpha(layer === 0 ? FIRE : AMB, (0.7 - layer * 0.2) * (active ? 1 : 0.3))
            : `rgba(255,255,255,${0.04 - layer * 0.01})`;
          if (active && layer === 0) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = FIRE;
          }
          ctx.beginPath();
          ctx.ellipse(x, y, Math.max(2, gap * 0.28), bh / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Connect active voices with faint lines
      if (p.voices > 1) {
        ctx.strokeStyle = hexAlpha(FIRE, 0.08);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < p.voices - 1; i++) {
          const x1 = pad + i * gap + gap * 0.25;
          const x2 = pad + (i + 1) * gap + gap * 0.25;
          ctx.moveTo(x1, baseY);
          ctx.lineTo(x2, baseY - 4);
        }
        ctx.stroke();
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(`${p.voices}/${p.maxVoices} VOICES`, 10, H - 8);
      ctx.textAlign = "right";
      const mode = p.mono ? "MONO" : "POLY";
      const harm = p.harmony && p.harmony !== "off" ? ` · ${String(p.harmony).toUpperCase()}` : "";
      ctx.fillStyle = p.fxOn ? "rgba(98,182,255,0.7)" : "rgba(255,106,61,0.55)";
      ctx.fillText(`${mode}${harm} · ${p.fxOn ? "FX" : "RAW"}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={PERF_H}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}
