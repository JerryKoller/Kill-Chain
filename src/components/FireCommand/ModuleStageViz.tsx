/**
 * Stage visualizers for v3.0.2 module fill — each has a distinct personality.
 * Display only; audio lives in FireCommandSynth / store.
 */

import { useEffect, useRef, type ReactNode, type RefObject, type MutableRefObject } from "react";
import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES } from "@/state/fireSequencerStore";
import { FC } from "./fireColors";

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

function Frame({
  children, border, height, wrapRef, radius = "rounded-xl",
}: {
  children: ReactNode; border: string; height: number;
  wrapRef: RefObject<HTMLDivElement | null>; radius?: string;
}) {
  return (
    <div
      ref={wrapRef as RefObject<HTMLDivElement>}
      className={`relative mb-2.5 overflow-hidden border bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${radius}`}
      style={{ borderColor: border, height }}
    >
      {children}
    </div>
  );
}

/** Static grain field — Noise Bed. */
export function NoiseStageViz() {
  const level = useFireCommandStore((s) => s.patch.noiseLevel);
  const color = useFireCommandStore((s) => s.patch.noiseColor);
  const mode = useFireCommandStore((s) => s.patch.chipNoise);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ level, color, mode });
  st.current = { level, color, mode };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

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
      ctx.fillStyle = "rgba(12,10,8,0.92)";
      ctx.fillRect(0, 0, W, H);
      const dens = Math.floor(40 + p.level * 180);
      const tilt = p.color;
      for (let i = 0; i < dens; i++) {
        const x = Math.random() * W;
        const yBias = tilt < 0 ? Math.pow(Math.random(), 1.4) : tilt > 0 ? 1 - Math.pow(Math.random(), 1.4) : Math.random();
        const y = yBias * H;
        const a = 0.15 + p.level * 0.55;
        ctx.fillStyle = `rgba(196,181,160,${a})`;
        const sz = p.mode === "periodic" ? 2.5 : p.mode === "nes" ? 2 : 1;
        ctx.fillRect(x, y, sz, sz);
      }
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(196,181,160,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(p.level < 0.02 ? "SILENT" : "NOISE BED", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(tilt < -0.1 ? "DARK" : tilt > 0.1 ? "BRIGHT" : "FLAT", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.noise}55`} height={88} radius="rounded-md">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Deep sine thump — Sub Osc. */
export function SubStageViz() {
  const level = useFireCommandStore((s) => s.patch.subLevel);
  const wave = useFireCommandStore((s) => s.patch.subWave);
  const oct = useFireCommandStore((s) => s.patch.subOctave ?? -1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ level, wave, oct });
  st.current = { level, wave, oct };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 20) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(40,20,10,0.9)");
      g.addColorStop(1, "rgba(8,4,2,0.95)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const mid = H * 0.5;
      const amp = H * 0.28 * (0.2 + p.level);
      const cycles = 1.5 + Math.abs(p.oct);
      ctx.strokeStyle = `rgba(255,176,122,${0.4 + p.level * 0.5})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const u = (x / W) * cycles * Math.PI * 2 + t * 0.003;
        let y = mid;
        if (p.wave === "sine") y = mid + Math.sin(u) * amp;
        else if (p.wave === "triangle") y = mid + (2 / Math.PI) * Math.asin(Math.sin(u)) * amp;
        else if (p.wave === "square") y = mid + (Math.sin(u) > 0 ? amp : -amp);
        else y = mid + (2 * ((u / (Math.PI * 2)) % 1) - 1) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,176,122,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(`${p.wave.toUpperCase()} · ${p.oct}oct`, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.level < 0.02 ? "OFF" : "SUB", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.sub}55`} height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Struck vactrol bloom — Pluck Gate. */
export function PluckStageViz() {
  const on = useFireCommandStore((s) => s.patch.lpgOn);
  const decay = useFireCommandStore((s) => s.patch.lpgDecay);
  const color = useFireCommandStore((s) => s.patch.lpgColor);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ on, decay, color });
  st.current = { on, decay, color };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    let strike = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.fillStyle = "rgba(20,12,6,0.9)";
      ctx.fillRect(0, 0, W, H);
      if (p.on && t - strike > 400 + p.decay * 600) strike = t;
      const age = p.on ? Math.min(1, (t - strike) / (180 + p.decay * 900)) : 1;
      const bright = (1 - age) * (0.4 + p.color * 0.6);
      const rad = 8 + age * (30 + p.decay * 40);
      const cx = W * 0.5;
      const cy = H * 0.48;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
      glow.addColorStop(0, `rgba(240,160,96,${bright})`);
      glow.addColorStop(1, "rgba(240,160,96,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = `rgba(240,160,96,${0.2 + bright * 0.5})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(240,160,96,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(p.on ? "STRIKE" : "ADSR MODE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${p.decay.toFixed(2)}s`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.pluck}55`} height={88} radius="rounded-2xl">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Mid/side fan — Stereo Width. */
export function WidthStageViz() {
  const w = useFireCommandStore((s) => s.patch.stereoWidth);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ w });
  st.current = { w };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 24) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const width = st.current.w;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(18,8,4,0.92)";
      ctx.fillRect(0, 0, W, H);
      const cx = W * 0.5;
      const cy = H * 0.5;
      const spread = 20 + width * 70;
      for (let i = -3; i <= 3; i++) {
        const a = (i / 3) * (0.15 + width * 0.55) + Math.sin(t * 0.001 + i) * 0.02;
        ctx.strokeStyle = `rgba(255,143,106,${0.25 + (1 - Math.abs(i) / 3) * 0.45})`;
        ctx.lineWidth = i === 0 ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(a) * spread, cy - Math.cos(a) * (H * 0.35));
        ctx.stroke();
      }
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,143,106,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(width < 0.05 ? "MONO" : width > 1.05 ? "WIDE" : "STEREO", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(width * 100)}%`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.width}55`} height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Compressor meter — Bus Glue. */
export function GlueStageViz() {
  const punch = useFireCommandStore((s) => s.patch.punch);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ punch });
  st.current = { punch };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    let gr = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current.punch;
      const target = p * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.004)));
      gr += (target - gr) * 0.12;
      ctx.fillStyle = "rgba(16,6,4,0.92)";
      ctx.fillRect(0, 0, W, H);
      const barH = H * 0.45;
      const y0 = H * 0.25;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(W * 0.15, y0, W * 0.7, barH);
      const fill = gr * W * 0.7;
      const g = ctx.createLinearGradient(W * 0.15, 0, W * 0.15 + fill, 0);
      g.addColorStop(0, "rgba(224,112,80,0.9)");
      g.addColorStop(1, "rgba(255,140,100,0.7)");
      ctx.fillStyle = g;
      ctx.fillRect(W * 0.15, y0, fill, barH);
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(224,112,80,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("GR", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p < 0.02 ? "CLEAN" : `−${(gr * 12).toFixed(1)} dB`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.glue}55`} height={88} radius="rounded-lg">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Dual shelf curves — Air · Tone. */
export function AirStageViz() {
  const low = useFireCommandStore((s) => s.patch.airLow);
  const high = useFireCommandStore((s) => s.patch.airHigh);
  const amt = useFireCommandStore((s) => s.patch.airAmount);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ low, high, amt });
  st.current = { low, high, amt };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

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
      ctx.fillStyle = "rgba(20,12,8,0.9)";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5);
      ctx.lineTo(W, H * 0.5);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,200,160,${0.35 + p.amt * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const u = x / W;
        const shelf = (u < 0.35 ? p.low * (1 - u / 0.35) : 0) + (u > 0.55 ? p.high * ((u - 0.55) / 0.45) : 0);
        const y = H * 0.5 - shelf * p.amt * H * 0.35 + Math.sin(u * 8 + t * 0.002) * 1.5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,200,160,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("LOW", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.amt < 0.02 ? "FLAT" : "AIR", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.air}55`} height={88} radius="rounded-2xl">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Interval constellation — Harmony. */
export function HarmonyStageViz() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode);
  const level = useFireCommandStore((s) => s.patch.harmonyLevel);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ mode, level });
  st.current = { mode, level };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 30) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.fillStyle = "rgba(18,12,6,0.92)";
      ctx.fillRect(0, 0, W, H);
      const count = p.mode === "off" ? 1 : p.mode === "triad" ? 3 : 2;
      const cx = W * 0.5;
      const cy = H * 0.45;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i / Math.max(1, count)) * Math.PI * 2 + t * 0.0008;
        const r = 18 + i * 10 + p.level * 8;
        const x = cx + Math.cos(a) * r * 0.4;
        const y = cy + Math.sin(a) * r * 0.25;
        ctx.fillStyle = `rgba(255,179,92,${0.35 + p.level * 0.4 - i * 0.08})`;
        ctx.beginPath();
        ctx.arc(x, y, 5 - i, 0, Math.PI * 2);
        ctx.fill();
        if (i > 0) {
          ctx.strokeStyle = "rgba(255,179,92,0.25)";
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,179,92,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(p.mode === "off" ? "OFF" : p.mode.toUpperCase(), 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(p.level * 100)}%`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.harmony}55`} height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Piano-roll scale dots — Scale Lock. */
export function ScaleStageViz() {
  const on = useFireCommandStore((s) => s.patch.scaleLock);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ on, root, scaleId });
  st.current = { on, root, scaleId };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

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
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.fillStyle = "rgba(6,12,20,0.92)";
      ctx.fillRect(0, 0, W, H);
      const scale = SCALES.find((s) => s.id === p.scaleId);
      const steps = scale?.steps ?? [0, 2, 4, 5, 7, 9, 11];
      for (let i = 0; i < 12; i++) {
        const x = ((i + 0.5) / 12) * W;
        const inS = steps.includes(i);
        const y = H * 0.45;
        ctx.fillStyle = inS
          ? `rgba(98,182,255,${p.on ? 0.85 : 0.35})`
          : "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.arc(x, y, inS ? 5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (i === 0) {
          ctx.strokeStyle = "rgba(98,182,255,0.6)";
          ctx.stroke();
        }
      }
      const label = `${NOTE_NAMES[p.root] ?? "C"} ${scale?.label ?? "Chromatic"}`;
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(98,182,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(p.on ? "LOCKED" : "FREE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(label, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.scale}55`} height={88} radius="rounded-md">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Stacked interval bars — Chord Memory. */
export function ChordStageViz() {
  const on = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const ivs = useFireCommandStore((s) => s.patch.chordIntervals);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ on, ivs });
  st.current = { on, ivs };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

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
      ctx.fillStyle = "rgba(18,10,6,0.92)";
      ctx.fillRect(0, 0, W, H);
      const list = p.ivs?.length ? p.ivs : [0, 4, 7];
      const max = Math.max(12, ...list.map(Math.abs));
      list.forEach((iv, i) => {
        const y = H * 0.22 + i * (H * 0.18);
        const len = (Math.abs(iv) / max) * W * 0.55 + W * 0.12;
        ctx.fillStyle = `rgba(255,154,107,${p.on ? 0.55 : 0.2})`;
        ctx.fillRect(W * 0.2, y, len, 8);
        ctx.fillStyle = "rgba(255,154,107,0.7)";
        ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(iv === 0 ? "R" : `+${iv}`, 10, y + 8);
      });
      ctx.fillStyle = "rgba(255,154,107,0.55)";
      ctx.textAlign = "right";
      ctx.fillText(p.on ? "ARMED" : "IDLE", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.chord}55`} height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Jitter cloud — Humanize. */
export function HumanStageViz() {
  const on = useFireCommandStore((s) => s.patch.humanizeOn);
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming);
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ on, timing, vel });
  st.current = { on, timing, vel };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const pts = Array.from({ length: 24 }, () => ({ x: Math.random(), y: Math.random() }));
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 26) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.fillStyle = "rgba(8,14,8,0.9)";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(155,229,100,0.12)";
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5);
      ctx.lineTo(W, H * 0.5);
      ctx.stroke();
      pts.forEach((pt, i) => {
        const jx = (Math.sin(t * 0.003 + i) * p.timing * 0.08);
        const jy = (Math.cos(t * 0.004 + i * 1.3) * p.vel * 0.12);
        const x = (pt.x + jx) * W;
        const y = H * 0.5 + (pt.y - 0.5) * H * 0.55 + jy * H;
        ctx.fillStyle = `rgba(155,229,100,${p.on ? 0.55 : 0.2})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(155,229,100,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(p.on ? "HUMAN" : "QUANTIZED", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`T${Math.round(p.timing * 100)} V${Math.round(p.vel * 100)}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.human}55`} height={88} radius="rounded-xl">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** Slot constellation — Scenes (interactive chrome lives outside). */
export function ScenesStageViz() {
  const scenes = useFireCommandStore((s) => s.scenes);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 72 });
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
      if (document.hidden || t - last < 40) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      ctx.fillStyle = "rgba(16,12,4,0.92)";
      ctx.fillRect(0, 0, W, H);
      const n = SCENE_SLOTS;
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * W;
        const filled = !!scenes[i];
        const pulse = filled ? 0.55 + 0.25 * Math.sin(t * 0.004 + i) : 0.15;
        ctx.fillStyle = `rgba(255,207,92,${pulse})`;
        ctx.beginPath();
        ctx.arc(x, H * 0.42, filled ? 7 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (filled) {
          ctx.strokeStyle = "rgba(255,207,92,0.4)";
          ctx.beginPath();
          ctx.arc(x, H * 0.42, 11, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,207,92,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("SCENES", 10, H - 8);
      ctx.textAlign = "right";
      const filled = scenes.filter(Boolean).length;
      ctx.fillText(`${filled}/${n}`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scenes]);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.scenes}55`} height={72} radius="rounded-lg">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}
