/**
 * Core Fire Command stage visualizations (v2.5.5) — display-only
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
      const cssW = Math.max(180, Math.floor(wrap.clientWidth));
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
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

/** Mixer · Unison — voice fan + sub/noise rails. */
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
  const sizeRef = useRef({ w: 360, h: 92 });
  const st = useRef({ unison, detune, width, stereo, sub, noise, drift, subWave });
  st.current = { unison, detune, width, stereo, sub, noise, drift, subWave };
  useHiDpiCanvas(wrapRef, canvasRef, 92, sizeRef);

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
      bg.addColorStop(0, "rgba(255,106,61,0.10)");
      bg.addColorStop(0.55, "rgba(10,6,4,0.55)");
      bg.addColorStop(1, "rgba(255,207,92,0.06)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W * 0.52;
      const cy = H * 0.48;
      const n = Math.max(1, Math.round(p.unison));
      const spread = 10 + p.width * 42 + p.stereo * 8;
      const det = p.detune / 50;
      const breath = 0.92 + 0.08 * Math.sin(t / 700);

      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const x = cx + u * spread;
        const lean = u * det * 18;
        const amp = (18 + (1 - Math.abs(u)) * 10) * breath;
        ctx.beginPath();
        ctx.moveTo(x + lean * 0.2, cy - amp);
        ctx.quadraticCurveTo(x + lean, cy, x + lean * 0.2, cy + amp);
        ctx.strokeStyle = hexAlpha(FIRE, 0.35 + (1 - Math.abs(u)) * 0.45);
        ctx.lineWidth = n === 1 ? 2.4 : 1.4;
        ctx.shadowBlur = 6;
        ctx.shadowColor = FIRE;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = hexAlpha(FIRE, 0.7);
        ctx.beginPath();
        ctx.arc(x + lean * 0.2, cy - amp, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const railY = H - 14;
      ctx.fillStyle = hexAlpha(GOLD, 0.15 + p.sub * 0.55);
      ctx.fillRect(10, railY - 4, 48 * Math.max(0.08, p.sub), 5);
      ctx.fillStyle = hexAlpha(ICE, 0.12 + p.noise * 0.5);
      ctx.fillRect(66, railY - 4, 48 * Math.max(0.05, p.noise), 5);
      if (p.drift > 0.02) {
        ctx.strokeStyle = hexAlpha(AMB, 0.35 + p.drift * 0.4);
        ctx.beginPath();
        for (let x = W * 0.72; x < W - 10; x += 3) {
          const y = cy + Math.sin(x * 0.08 + t / 400) * p.drift * 10;
          if (x === W * 0.72) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(`${n} VOICE FAN`, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,207,92,0.45)";
      ctx.fillText(`SUB ${(p.subWave as SubWave).slice(0, 3).toUpperCase()}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={92}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Filter — living frequency response bay. */
export function FilterStageViz() {
  const type = useFireCommandStore((s) => s.patch.filterType);
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff);
  const res = useFireCommandStore((s) => s.patch.filterResonance);
  const envAmt = useFireCommandStore((s) => s.patch.filterEnvAmount);
  const sat = useFireCommandStore((s) => s.patch.filterDrive);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 360, h: 96 });
  const st = useRef({ type, cutoff, res, envAmt, sat });
  st.current = { type, cutoff, res, envAmt, sat };
  useHiDpiCanvas(wrapRef, canvasRef, 96, sizeRef);

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
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(255,106,61,${0.08 + p.sat * 0.1})`);
      bg.addColorStop(0.5, "rgba(8,6,4,0.55)");
      bg.addColorStop(1, "rgba(255,106,61,0.05)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const PAD = 10;
      const usableH = H - 26;
      const xOf = (f: number) => PAD + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (W - PAD * 2);
      const peak = Math.min(1, Math.log10(Math.max(1, p.res)) * 0.75);
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

      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      for (const f of [100, 1000, 10000]) {
        const x = xOf(f);
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, 8 + usableH);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(PAD, 8 + usableH);
      for (let i = 0; i <= 96; i++) {
        const f = fLo * Math.pow(fHi / fLo, i / 96);
        const g = gain(f);
        const y = 8 + (1 - Math.min(1, g / 1.6)) * usableH;
        ctx.lineTo(xOf(f), y);
      }
      ctx.lineTo(W - PAD, 8 + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 8, 0, 8 + usableH);
      fill.addColorStop(0, hexAlpha(FIRE, 0.28));
      fill.addColorStop(1, hexAlpha(FIRE, 0.02));
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const f = fLo * Math.pow(fHi / fLo, i / 96);
        const g = gain(f);
        const y = 8 + (1 - Math.min(1, g / 1.6)) * usableH;
        const x = xOf(f);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const cx = xOf(Math.max(fLo, Math.min(fHi, p.cutoff)));
      ctx.strokeStyle = hexAlpha(FIRE, 0.45);
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, 8);
      ctx.lineTo(cx, 8 + usableH);
      ctx.stroke();
      ctx.setLineDash([]);

      if (Math.abs(p.envAmt) > 0.02) {
        const dx = p.envAmt * 28;
        ctx.fillStyle = hexAlpha(GRN, 0.55);
        ctx.beginPath();
        ctx.moveTo(cx, 14);
        ctx.lineTo(cx + dx, 14);
        ctx.lineTo(cx + dx - Math.sign(dx) * 4, 11);
        ctx.lineTo(cx + dx - Math.sign(dx) * 4, 17);
        ctx.closePath();
        ctx.fill();
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.55)";
      ctx.textAlign = "left";
      ctx.fillText((p.type as FireFilterType).toUpperCase(), 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(p.cutoff)} Hz · Q ${p.res.toFixed(1)}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={96}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

function EnvStageViz({
  a, d, s, r, color = GRN, label = "ADSR",
}: {
  a: number; d: number; s: number; r: number; color?: string; label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: 72 });
  const st = useRef({ a, d, s, r });
  st.current = { a, d, s, r };
  useHiDpiCanvas(wrapRef, canvasRef, 72, sizeRef);

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
      bg.addColorStop(0, hexAlpha(color, 0.10));
      bg.addColorStop(1, "rgba(4,10,6,0.5)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const PAD = 10;
      const usableW = W - PAD * 2;
      const usableH = H - 24;
      const seg = (v: number) => Math.pow(Math.max(0.001, v), 0.5);
      const tot = seg(p.a) + seg(p.d) + seg(p.r) + 0.35;
      const wA = (seg(p.a) / tot) * usableW;
      const wD = (seg(p.d) / tot) * usableW;
      const wR = (seg(p.r) / tot) * usableW;
      const wS = usableW - wA - wD - wR;
      const y = (lv: number) => PAD + (1 - lv) * usableH;
      const x0 = PAD;
      const x1 = x0 + wA;
      const x2 = x1 + wD;
      const x3 = x2 + Math.max(8, wS);
      const x4 = Math.min(W - PAD, x3 + wR);

      const path = () => {
        ctx.moveTo(x0, y(0));
        ctx.quadraticCurveTo(x0 + wA * 0.4, y(0.85), x1, y(1));
        ctx.quadraticCurveTo(x1 + wD * 0.35, y(p.s + (1 - p.s) * 0.25), x2, y(p.s));
        ctx.lineTo(x3, y(p.s));
        ctx.quadraticCurveTo(x3 + wR * 0.35, y(p.s * 0.25), x4, y(0));
      };

      ctx.beginPath();
      path();
      ctx.lineTo(x4, PAD + usableH);
      ctx.lineTo(x0, PAD + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, PAD, 0, PAD + usableH);
      fill.addColorStop(0, hexAlpha(color, 0.32));
      fill.addColorStop(1, hexAlpha(color, 0.02));
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      path();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const cycle = (t / 2200) % 1;
      const span = x4 - x0;
      const px = x0 + cycle * span;
      let py = y(0);
      if (px <= x1) py = y((px - x0) / Math.max(1, wA));
      else if (px <= x2) {
        const u = (px - x1) / Math.max(1, wD);
        py = y(1 - u * (1 - p.s));
      } else if (px <= x3) py = y(p.s);
      else {
        const u = (px - x3) / Math.max(1, wR);
        py = y(p.s * (1 - u));
      }
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = hexAlpha(color, 0.85);
      ctx.beginPath();
      ctx.arc(x1, y(1), 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x2, y(p.s), 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(color, 0.55);
      ctx.textAlign = "left";
      ctx.fillText(label, 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color, label]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(color, 0.28)} height={72}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

function LpgStageViz({ decay }: { decay: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: 72 });
  const decayRef = useRef(decay);
  decayRef.current = decay;
  useHiDpiCanvas(wrapRef, canvasRef, 72, sizeRef);
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
      const dec = decayRef.current;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,207,92,0.12)");
      bg.addColorStop(1, "rgba(10,8,2,0.5)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const PAD = 10;
      const k = 4 / Math.max(0.05, dec);
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        const tt = u * 2.5;
        const v = Math.min(1, tt / 0.012) * Math.exp(-k * tt * 0.4);
        const x = PAD + u * (W - PAD * 2);
        const y = PAD + (1 - v) * (H - 24);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = GOLD;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,207,92,0.55)";
      ctx.fillText("VACTROL PLUCK", 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,207,92,0.3)" height={72}>
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
  return <EnvStageViz a={a} d={d} s={sus} r={r} color={GRN} label="AMP ADSR" />;
}

export function ModEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.modAttack);
  const d = useFireCommandStore((s) => s.patch.modDecay);
  const s = useFireCommandStore((st) => st.patch.modSustain);
  const r = useFireCommandStore((st) => st.patch.modRelease);
  return <EnvStageViz a={a} d={d} s={s} r={r} color="#9be564" label="MOD → MORPH" />;
}

export function FiltEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.filtAttack);
  const d = useFireCommandStore((s) => s.patch.filtDecay);
  const s = useFireCommandStore((st) => st.patch.filtSustain);
  const r = useFireCommandStore((st) => st.patch.filtRelease);
  return <EnvStageViz a={a} d={d} s={s} r={r} color="#5ce0a0" label="FILTER ENV" />;
}

/** LFO stage — waveform bay with tracer + destination readout. */
export function LfoStageViz({ idx }: { idx: 1 | 2 }) {
  const wave = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Wave : s.patch.lfo2Wave));
  const rate = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Rate : s.patch.lfo2Rate));
  const depth = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Depth : s.patch.lfo2Depth));
  const dest = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Dest : s.patch.lfo2Dest));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: 78 });
  const st = useRef({ wave, rate, depth, dest });
  st.current = { wave, rate, depth, dest };
  useHiDpiCanvas(wrapRef, canvasRef, 78, sizeRef);

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
      bg.addColorStop(0, "rgba(98,182,255,0.12)");
      bg.addColorStop(0.5, "rgba(4,8,14,0.55)");
      bg.addColorStop(1, "rgba(98,182,255,0.05)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.42;
      const amp = (H * 0.28) * Math.max(0.14, p.depth);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.moveTo(8, mid);
      ctx.lineTo(W - 8, mid);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(8, mid);
      for (let x = 8; x <= W - 8; x++) {
        const y = mid - shape(p.wave, ((x - 8) / (W - 16)) * 2) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W - 8, mid);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      fill.addColorStop(0, hexAlpha(ICE, 0.22));
      fill.addColorStop(1, hexAlpha(ICE, 0.02));
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      for (let x = 8; x <= W - 8; x++) {
        const y = mid - shape(p.wave, ((x - 8) / (W - 16)) * 2) * amp;
        if (x === 8) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = ICE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      let engT = nowMs / 1000;
      try { engT = getEngine().ctx.currentTime; } catch { /* */ }
      const ph = (engT * p.rate) % 2;
      const px = 8 + (ph / 2) * (W - 16);
      const py = mid - shape(p.wave, ph) * amp;
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = ICE;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(98,182,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(`LFO ${idx} · ${String(p.wave).toUpperCase()}`, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText((p.dest as LfoDest) === "off" ? "IDLE" : `→ ${(p.dest as string).toUpperCase()}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(98,182,255,0.28)" height={78}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** FM · Ring — carrier/modulator lattice + ring beat. */
export function FmRingStageViz() {
  const fm = useFireCommandStore((s) => s.patch.fmAmount);
  const ratio = useFireCommandStore((s) => s.patch.fmRatio);
  const bToA = useFireCommandStore((s) => s.patch.fmBtoA);
  const ring = useFireCommandStore((s) => s.patch.ringAmount);
  const ringHz = useFireCommandStore((s) => s.patch.ringFreq);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: 78 });
  const st = useRef({ fm, ratio, bToA, ring, ringHz });
  st.current = { fm, ratio, bToA, ring, ringHz };
  useHiDpiCanvas(wrapRef, canvasRef, 78, sizeRef);

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
      bg.addColorStop(0, `rgba(255,106,61,${0.08 + p.fm * 0.12})`);
      bg.addColorStop(0.5, "rgba(10,4,6,0.55)");
      bg.addColorStop(1, `rgba(255,106,61,${0.04 + p.ring * 0.1})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.42;
      const amp = H * 0.26;
      ctx.beginPath();
      for (let i = 0; i <= W; i++) {
        const u = i / W;
        const mod = Math.sin(u * Math.PI * 6 * p.ratio + t / 400);
        const fmSig = Math.sin(u * Math.PI * 6 + mod * p.fm * 2.8);
        const ringSig = Math.sin(u * Math.PI * 2 * (p.ringHz / 220)) * Math.sin(u * Math.PI * 8 + t / 500);
        const y = mid - (fmSig * (1 - p.ring * 0.55) + ringSig * p.ring) * amp * (0.35 + p.fm * 0.5 + p.bToA * 0.2);
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 9;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const cx = W * 0.18;
      const cy = mid;
      const R = 16;
      ctx.strokeStyle = hexAlpha(FIRE, 0.35);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      const spokes = Math.min(12, Math.max(2, Math.round(p.ratio)));
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2 + t / 1800;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
        ctx.stroke();
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("FM LATTICE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.ring > 0.02 ? `RING ${Math.round(p.ringHz)}Hz` : `${p.ratio.toFixed(2)}×`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={78}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Pitch · Glide — pitch envelope ramp + portamento trail. */
export function PitchGlideStageViz() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount);
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime);
  const glide = useFireCommandStore((s) => s.patch.glide);
  const mono = useFireCommandStore((s) => s.patch.mono);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: 78 });
  const st = useRef({ amt, time, glide, mono });
  st.current = { amt, time, glide, mono };
  useHiDpiCanvas(wrapRef, canvasRef, 78, sizeRef);

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
      bg.addColorStop(0, "rgba(255,106,61,0.10)");
      bg.addColorStop(0.5, "rgba(8,6,4,0.55)");
      bg.addColorStop(1, "rgba(124,246,176,0.06)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.42;
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.moveTo(10, mid);
      ctx.lineTo(W - 10, mid);
      ctx.stroke();

      const dir = Math.sign(p.amt) || 1;
      const peak = mid - dir * Math.min(28, Math.abs(p.amt) * 0.55);
      const decayX = 20 + Math.min(W * 0.55, 40 + p.time * 90);
      ctx.beginPath();
      ctx.moveTo(16, mid);
      ctx.lineTo(28, peak);
      ctx.quadraticCurveTo(decayX * 0.55, peak, decayX, mid);
      ctx.strokeStyle = GRN;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = GRN;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const gLen = 30 + p.glide * 100;
      ctx.beginPath();
      ctx.moveTo(W * 0.55, mid + 12);
      ctx.quadraticCurveTo(W * 0.55 + gLen * 0.4, mid - 10, W * 0.55 + gLen, mid - 4);
      ctx.strokeStyle = p.mono ? hexAlpha(FIRE, 0.55 + p.glide * 0.35) : "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.setLineDash(p.mono ? [] : [4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = FIRE;
      ctx.beginPath();
      ctx.arc(W * 0.55 + gLen, mid - 4, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("PITCH RAIL", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.mono ? "GLIDE LIVE" : "GLIDE (MONO)", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={78}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Oscillator stage strip — morph stack + level glow. */
export function OscStageViz({ group, color }: { group: "a" | "b" | "c"; color: string }) {
  const table = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscATable : group === "b" ? s.patch.oscBTable : s.patch.oscCTable);
  const level = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscALevel : group === "b" ? s.patch.oscBLevel : s.patch.oscCLevel);
  const pos = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscAPos : group === "b" ? s.patch.oscBPos : s.patch.oscCPos);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 280, h: 70 });
  const st = useRef({ table, level, pos });
  st.current = { table, level, pos };
  useHiDpiCanvas(wrapRef, canvasRef, 70, sizeRef);

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
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 33) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      let livePos = p.pos;
      try { livePos = getEngine().fireCommand.getMorphPositions()[group]; } catch { /* */ }
      ensure(p.table);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, hexAlpha(color, 0.10 + p.level * 0.12));
      bg.addColorStop(1, "rgba(4,4,6,0.55)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cur = livePos * (FRAME_COUNT - 1);
      const lo = Math.floor(cur);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = cur - lo;
      const mid = H * 0.45;
      const amp = (H * 0.28) * (0.25 + p.level * 0.75);

      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const v = cache[lo][i] * (1 - frac) + cache[hi][i] * frac;
        const x = 10 + (i / (N - 1)) * (W - 20);
        const y = mid - v * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8 + p.level * 6;
      ctx.shadowColor = color;
      ctx.globalAlpha = 0.35 + p.level * 0.65;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      const mx = 10 + livePos * (W - 20);
      ctx.fillStyle = hexAlpha(color, 0.7);
      ctx.fillRect(mx - 1, H - 16, 2, 8);

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(color, 0.55);
      ctx.textAlign = "left";
      ctx.fillText(`OSC ${group.toUpperCase()}`, 10, H - 7);
      ctx.textAlign = "right";
      ctx.fillText(p.level < 0.01 ? "SILENT" : `${Math.round(p.level * 100)}%`, W - 10, H - 7);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [group, color]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexAlpha(color, 0.28)} height={70}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Performance strip — voice constellation + routing. */
export function PerformanceStageViz() {
  const mono = useFireCommandStore((s) => s.patch.mono);
  const harmony = useFireCommandStore((s) => s.patch.harmonyMode);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 520, h: 56 });
  const st = useRef({ mono, harmony, maxVoices, fxOn, voices: 0 });
  st.current = { mono, harmony, maxVoices, fxOn, voices: st.current.voices };
  useHiDpiCanvas(wrapRef, canvasRef, 56, sizeRef);

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
      bg.addColorStop(0, "rgba(255,106,61,0.10)");
      bg.addColorStop(0.5, "rgba(8,6,4,0.5)");
      bg.addColorStop(1, p.fxOn ? "rgba(98,182,255,0.08)" : "rgba(255,255,255,0.03)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const slots = Math.min(32, p.maxVoices);
      const pad = 12;
      const usable = W - pad * 2 - 120;
      const gap = usable / Math.max(1, slots);
      for (let i = 0; i < slots; i++) {
        const active = i < p.voices;
        const x = pad + i * gap + gap * 0.2;
        const bh = 8 + (active ? 18 + Math.sin(t / 200 + i) * 4 : 6);
        ctx.fillStyle = active ? hexAlpha(FIRE, 0.75) : "rgba(255,255,255,0.08)";
        if (active) {
          ctx.shadowBlur = 6;
          ctx.shadowColor = FIRE;
        }
        ctx.fillRect(x, H * 0.55 - bh / 2, Math.max(2, gap * 0.55), bh);
        ctx.shadowBlur = 0;
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,106,61,0.6)";
      ctx.textAlign = "right";
      const mode = p.mono ? "MONO" : "POLY";
      const harm = p.harmony && p.harmony !== "off" ? ` · ${String(p.harmony).toUpperCase()}` : "";
      ctx.fillText(`${mode}${harm} · ${p.fxOn ? "FX" : "RAW"}`, W - 10, H - 8);
      ctx.textAlign = "left";
      ctx.fillText(`${p.voices}/${p.maxVoices} VOICES`, 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.28)" height={56}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}
