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

/** Grain storm — Noise Bed with cascading particles and spectral drift. */
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
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random(),
      y: Math.random(),
      age: Math.random(),
      speed: 0.02 + Math.random() * 0.04,
      size: 0.6 + Math.random() * 1.8,
    }));
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 28) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      
      // Radial dark vignette
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 4, W * 0.5, H * 0.5, W * 0.6);
      bg.addColorStop(0, `rgba(24,20,16,${0.88 + p.level * 0.08})`);
      bg.addColorStop(1, "rgba(8,6,4,0.95)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Living grain storm
      const dens = Math.floor(60 + p.level * 220);
      const tilt = p.color;
      const breathe = 0.85 + 0.15 * Math.sin(t * 0.003);
      
      for (let i = 0; i < dens; i++) {
        const x = Math.random() * W;
        const yBias = tilt < 0 
          ? Math.pow(Math.random(), 1.6) 
          : tilt > 0 
            ? 1 - Math.pow(Math.random(), 1.6) 
            : Math.random();
        const y = yBias * H;
        const shimmer = 0.2 + p.level * 0.7 + Math.sin((x + y) * 0.05 + t * 0.005) * 0.15;
        const sz = p.mode === "periodic" ? 3 : p.mode === "nes" ? 2.5 : 1.2;
        const hue = 42 - tilt * 12;
        ctx.fillStyle = `hsla(${hue}, 20%, ${58 + shimmer * 25}%, ${shimmer * breathe})`;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        
        // Ghost trails on hot grains
        if (p.level > 0.3 && shimmer > 0.75) {
          ctx.fillStyle = `rgba(220,200,180,${0.08 * p.level})`;
          ctx.fillRect(x - sz * 2, y - 1, sz * 4, 2);
        }
      }

      // Drifting motes with trails
      particles.forEach((pt) => {
        pt.age += pt.speed * (0.3 + p.level * 0.7);
        if (pt.age > 1) {
          pt.age = 0;
          pt.y = tilt < 0 ? 0 : tilt > 0 ? 1 : Math.random();
          pt.x = Math.random();
        }
        const x = pt.x * W;
        const drift = tilt * 0.15;
        const y = (pt.y + pt.age + drift * pt.age) * H;
        const life = 1 - pt.age;
        const alpha = life * p.level * 0.55;
        
        // Particle with glow
        const g = ctx.createRadialGradient(x, y, 0, x, y, pt.size * 4);
        g.addColorStop(0, `rgba(220,200,180,${alpha * 0.85})`);
        g.addColorStop(0.45, `rgba(196,181,160,${alpha * 0.4})`);
        g.addColorStop(1, "rgba(196,181,160,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, pt.size * 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Subtle trail
        if (pt.age > 0.05 && p.level > 0.15) {
          ctx.strokeStyle = `rgba(196,181,160,${alpha * 0.25})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y - pt.size * 6);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      });

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(220,200,180,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(p.level < 0.02 ? "SILENT" : "GRAIN STORM", 10, H - 8);
      ctx.textAlign = "right";
      const modeLabel = p.mode === "periodic" ? "PER" : p.mode === "nes" ? "NES" : p.mode === "gb" ? "GB" : "WHT";
      ctx.fillText(`${modeLabel} · ${tilt < -0.1 ? "DARK" : tilt > 0.1 ? "BRIGHT" : "FLAT"}`, W - 10, H - 8);
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

/** Tectonic sine with harmonic undertow — Sub Osc. */
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
      
      // Molten core gradient
      const g = ctx.createRadialGradient(W * 0.5, H * 0.5, 2, W * 0.5, H * 0.5, W * 0.5);
      g.addColorStop(0, `rgba(60,30,12,${0.85 + p.level * 0.1})`);
      g.addColorStop(0.5, "rgba(28,14,6,0.92)");
      g.addColorStop(1, "rgba(6,3,1,0.96)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.5;
      const amp = H * 0.32 * (0.25 + p.level * 0.75);
      const cycles = 1.8 + Math.abs(p.oct) * 0.6;
      const phase = t * 0.002;

      // Ghost harmonics beneath
      for (let h = 2; h <= 3; h++) {
        ctx.beginPath();
        for (let x = 0; x <= W; x++) {
          const u = (x / W) * cycles * h * Math.PI * 2 + phase * h;
          const y = mid + Math.sin(u) * amp * (0.15 / h);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(255,140,90,${0.08 + p.level * 0.12})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Main waveform
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const u = (x / W) * cycles * Math.PI * 2 + phase;
        let y = mid;
        if (p.wave === "sine") {
          y = mid + Math.sin(u) * amp;
        } else if (p.wave === "triangle") {
          y = mid + (2 / Math.PI) * Math.asin(Math.sin(u)) * amp;
        } else if (p.wave === "square") {
          y = mid + (Math.sin(u) > 0 ? amp : -amp);
        } else {
          y = mid + (2 * ((u / (Math.PI * 2)) % 1) - 1) * amp;
        }
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      
      // Glowing stroke
      ctx.strokeStyle = `rgba(255,176,122,${0.5 + p.level * 0.45})`;
      ctx.lineWidth = 2.8;
      ctx.shadowBlur = 10 + p.level * 12;
      ctx.shadowColor = "rgba(255,140,90,0.6)";
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Rumble particles at peaks
      if (p.level > 0.15) {
        const peaks = Math.floor(cycles);
        for (let i = 0; i < peaks; i++) {
          const px = (i / peaks) * W + (W / peaks) * 0.5;
          const py = mid + Math.sin(((px / W) * cycles * Math.PI * 2 + phase)) * amp;
          const pulse = 0.6 + 0.4 * Math.sin(t * 0.005 + i);
          const rg = ctx.createRadialGradient(px, py, 0, px, py, 8 + p.level * 6);
          rg.addColorStop(0, `rgba(255,200,150,${0.4 * pulse * p.level})`);
          rg.addColorStop(1, "rgba(255,176,122,0)");
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(px, py, 8 + p.level * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Undertow floor shimmer
      if (p.level > 0.08) {
        for (let i = 0; i < 16; i++) {
          const x = (i / 16) * W + (Math.sin(t * 0.004 + i) * 8);
          const y = H * 0.85 + Math.cos(t * 0.003 + i * 1.3) * 3;
          ctx.fillStyle = `rgba(255,140,90,${0.08 + p.level * 0.15})`;
          ctx.fillRect(x, y, 2, 2);
        }
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = `rgba(255,176,122,${0.65 + p.level * 0.2})`;
      ctx.textAlign = "left";
      ctx.fillText(`${p.wave.toUpperCase()} · ${p.oct}oct`, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.level < 0.02 ? "OFF" : "TECTONIC", W - 10, H - 8);
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

/** Iris strike bloom with vactrol rings — Pluck Gate. */
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
    const rings: { birth: number }[] = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      
      // Warm iris chamber
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.48, 4, W * 0.5, H * 0.5, W * 0.55);
      bg.addColorStop(0, "rgba(40,24,12,0.88)");
      bg.addColorStop(0.6, "rgba(16,8,4,0.94)");
      bg.addColorStop(1, "rgba(4,2,1,0.97)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      if (p.on && t - strike > 420 + p.decay * 650) {
        strike = t;
        rings.push({ birth: t });
        if (rings.length > 5) rings.shift();
      }
      
      const age = p.on ? Math.min(1, (t - strike) / (200 + p.decay * 950)) : 1;
      const bright = (1 - age) * (0.5 + p.color * 0.5);
      const cx = W * 0.5;
      const cy = H * 0.48;

      // Expanding rings from each strike
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        const rAge = Math.min(1, (t - ring.birth) / (280 + p.decay * 800));
        if (rAge >= 1) { rings.splice(i, 1); continue; }
        const rRad = 12 + rAge * (42 + p.decay * 35);
        const rAlpha = (1 - rAge) * (0.3 + p.color * 0.35);
        ctx.strokeStyle = `rgba(240,160,96,${rAlpha})`;
        ctx.lineWidth = 2 - rAge;
        ctx.beginPath();
        ctx.arc(cx, cy, rRad, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Core iris glow
      const rad = 10 + age * (35 + p.decay * 45);
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.4);
      coreGlow.addColorStop(0, `rgba(255,200,130,${bright * 0.9})`);
      coreGlow.addColorStop(0.3, `rgba(240,160,96,${bright * 0.65})`);
      coreGlow.addColorStop(0.7, `rgba(220,120,60,${bright * 0.25})`);
      coreGlow.addColorStop(1, "rgba(240,160,96,0)");
      ctx.fillStyle = coreGlow;
      ctx.fillRect(0, 0, W, H);

      // Iris aperture lines
      const blades = 8;
      for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2 + t * 0.001;
        const r1 = rad * 0.2;
        const r2 = rad * (0.45 + age * 0.15);
        ctx.strokeStyle = `rgba(240,180,120,${0.35 + bright * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Central strike point
      ctx.fillStyle = `rgba(255,220,150,${bright * 0.85 + 0.15})`;
      ctx.shadowBlur = 8 + bright * 14;
      ctx.shadowColor = "rgba(255,180,100,0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, 2 + bright * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Decay tail sparks
      if (age < 0.6 && p.on) {
        const sparks = Math.floor(8 + p.decay * 12);
        for (let i = 0; i < sparks; i++) {
          const sa = (i / sparks) * Math.PI * 2 + t * 0.002 + age * 2;
          const sr = rad + (Math.random() * 8 - 4);
          const sx = cx + Math.cos(sa) * sr;
          const sy = cy + Math.sin(sa) * sr;
          ctx.fillStyle = `rgba(255,200,120,${(0.6 - age) * (0.3 + p.color * 0.4)})`;
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
        }
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(240,160,96,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(p.on ? "VACTROL STRIKE" : "ADSR MODE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${p.decay.toFixed(2)}s · ${p.color.toFixed(1)}`, W - 10, H - 8);
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

/** M/S Lissajous with breathing phase — Stereo Width. */
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
      
      // Dark rust gradient
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(28,12,6,0.94)");
      bg.addColorStop(1, "rgba(10,4,2,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W * 0.5;
      const cy = H * 0.5;
      const breathe = Math.sin(t * 0.002) * 0.5 + 0.5;

      // M/S crosshair guides
      ctx.strokeStyle = "rgba(255,143,106,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - H * 0.4);
      ctx.lineTo(cx, cy + H * 0.4);
      ctx.moveTo(cx - W * 0.4, cy);
      ctx.lineTo(cx + W * 0.4, cy);
      ctx.stroke();

      // Lissajous figure — X = L+R (Mid), Y = L-R (Side)
      const points = 120;
      const phase = t * 0.002;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const u = (i / points) * Math.PI * 2;
        const mid = Math.sin(u + phase);
        const side = Math.sin(u + phase + width * Math.PI * 0.5) * width;
        const x = cx + mid * W * 0.35;
        const y = cy - side * H * 0.35;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(255,143,106,${0.45 + width * 0.45})`;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10 + width * 12;
      ctx.shadowColor = "rgba(255,143,106,0.6)";
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Ghost fill
      ctx.fillStyle = `rgba(255,143,106,${0.05 + width * 0.08})`;
      ctx.fill();

      // Stereo beam array
      const beams = 5;
      const spread = 25 + width * 75;
      for (let i = -beams; i <= beams; i++) {
        const norm = i / beams;
        const a = norm * (0.2 + width * 0.6) * breathe + Math.sin(t * 0.0012 + i * 0.5) * 0.03;
        const alpha = (1 - Math.abs(norm)) * (0.22 + width * 0.4);
        ctx.strokeStyle = `rgba(255,143,106,${alpha})`;
        ctx.lineWidth = i === 0 ? 2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(a) * spread, cy - Math.cos(a) * (H * 0.38));
        ctx.stroke();
        
        // Endpoint glow
        const ex = cx + Math.sin(a) * spread;
        const ey = cy - Math.cos(a) * (H * 0.38);
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 6);
        eg.addColorStop(0, `rgba(255,180,120,${alpha * 0.85})`);
        eg.addColorStop(1, "rgba(255,143,106,0)");
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex, ey, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Central mono/wide indicator
      ctx.fillStyle = `rgba(255,180,120,${0.55 + width * 0.35})`;
      ctx.shadowBlur = 8 + width * 10;
      ctx.shadowColor = "rgba(255,143,106,0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, 3 + width * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,143,106,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(width < 0.05 ? "MONO" : width > 1.05 ? "HYPER" : "STEREO", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`M/S · ${Math.round(width * 100)}%`, W - 10, H - 8);
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

/** VU + GR ballistic needle with ghost trails — Bus Glue. */
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
    let vu = 0;
    const history: number[] = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current.punch;
      
      // Studio chassis
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "rgba(24,10,6,0.94)");
      bg.addColorStop(0.5, "rgba(14,6,4,0.96)");
      bg.addColorStop(1, "rgba(8,4,2,0.97)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // VU breathe (input level)
      const vuTarget = 0.4 + p * 0.5 + 0.1 * Math.sin(t * 0.005);
      vu += (vuTarget - vu) * 0.08;
      
      // GR (gain reduction)
      const grTarget = p * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.0038)));
      gr += (grTarget - gr) * 0.14;
      
      history.push(gr);
      if (history.length > 40) history.shift();

      const cx = W * 0.5;
      const cy = H * 0.58;
      const needleLen = H * 0.42;

      // VU meter arc backdrop
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, needleLen * 0.95, Math.PI * 0.75, Math.PI * 0.25, false);
      ctx.stroke();

      // Scale ticks
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * (Math.PI * 1.5);
        const r1 = needleLen * 0.88;
        const r2 = needleLen * 0.94;
        ctx.strokeStyle = "rgba(224,112,80,0.25)";
        ctx.lineWidth = i % 2 === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Ghost trails from needle history
      history.forEach((h, i) => {
        const age = i / history.length;
        const a = Math.PI * 0.75 + h * (Math.PI * 1.5);
        const r = needleLen * 0.75;
        const ex = cx + Math.cos(a) * r;
        const ey = cy + Math.sin(a) * r;
        ctx.fillStyle = `rgba(255,180,120,${age * 0.15 * p})`;
        ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      });

      // GR needle (gain reduction)
      const grAngle = Math.PI * 0.75 + gr * (Math.PI * 1.5);
      ctx.strokeStyle = `rgba(224,112,80,${0.75 + gr * 0.2})`;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8 + gr * 12;
      ctx.shadowColor = "rgba(224,112,80,0.7)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(grAngle) * needleLen, cy + Math.sin(grAngle) * needleLen);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Needle tip glow
      const tipX = cx + Math.cos(grAngle) * needleLen;
      const tipY = cy + Math.sin(grAngle) * needleLen;
      const tipG = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 8);
      tipG.addColorStop(0, `rgba(255,160,100,${0.85 + gr * 0.15})`);
      tipG.addColorStop(1, "rgba(224,112,80,0)");
      ctx.fillStyle = tipG;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 8, 0, Math.PI * 2);
      ctx.fill();

      // VU ghost needle (lighter, below GR)
      const vuAngle = Math.PI * 0.75 + vu * (Math.PI * 1.5);
      ctx.strokeStyle = `rgba(255,200,150,${0.35 + vu * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(vuAngle) * needleLen * 0.85, cy + Math.sin(vuAngle) * needleLen * 0.85);
      ctx.stroke();

      // Center pivot rivet
      ctx.fillStyle = "rgba(200,180,160,0.75)";
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(224,112,80,0.5)";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Bar meter ghost (old layout)
      const barH = H * 0.12;
      const y0 = H * 0.14;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(W * 0.18, y0, W * 0.64, barH);
      const fill = gr * W * 0.64;
      const barG = ctx.createLinearGradient(W * 0.18, 0, W * 0.18 + fill, 0);
      barG.addColorStop(0, "rgba(224,112,80,0.65)");
      barG.addColorStop(1, "rgba(255,140,100,0.45)");
      ctx.fillStyle = barG;
      ctx.fillRect(W * 0.18, y0, fill, barH);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(224,112,80,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(p < 0.02 ? "BYPASS" : "COMPRESS", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`GR −${(gr * 14).toFixed(1)} dB`, W - 10, H - 8);
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

/** EQ curve with ghost fill and breathing harmonics — Air · Tone. */
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
      
      // Warm amber chamber
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(32,20,12,${0.88 + p.amt * 0.08})`);
      bg.addColorStop(0.6, "rgba(18,10,6,0.94)");
      bg.addColorStop(1, "rgba(8,4,2,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Zero-line reference
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5);
      ctx.lineTo(W, H * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // EQ curve with dynamic breathing
      const breathe = Math.sin(t * 0.0025) * 0.5 + 0.5;
      const points = 100;
      const curveY: number[] = [];
      
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const u = i / points;
        let shelf = 0;
        // Low shelf (left third)
        if (u < 0.35) shelf += p.low * (1 - u / 0.35);
        // High shelf (right half)
        if (u > 0.55) shelf += p.high * ((u - 0.55) / 0.45);
        // Add harmonics shimmer
        const shimmer = Math.sin(u * 12 + t * 0.0022) * 0.03 * p.amt * breathe;
        const y = H * 0.5 - shelf * p.amt * H * 0.38 - shimmer * H;
        curveY.push(y);
        const x = u * W;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      
      // Glowing stroke
      ctx.strokeStyle = `rgba(255,200,160,${0.45 + p.amt * 0.5})`;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 8 + p.amt * 14;
      ctx.shadowColor = "rgba(255,200,160,0.6)";
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Ghost fill beneath curve
      ctx.lineTo(W, H * 0.5);
      ctx.lineTo(0, H * 0.5);
      ctx.closePath();
      const fillG = ctx.createLinearGradient(0, Math.min(...curveY), 0, H * 0.5);
      fillG.addColorStop(0, `rgba(255,200,160,${0.18 + p.amt * 0.22})`);
      fillG.addColorStop(0.7, `rgba(255,180,140,${0.06 + p.amt * 0.08})`);
      fillG.addColorStop(1, "rgba(255,200,160,0)");
      ctx.fillStyle = fillG;
      ctx.fill();

      // Frequency markers
      const markers = [
        { u: 0.15, label: "80", active: Math.abs(p.low) > 0.08 },
        { u: 0.5, label: "1k", active: false },
        { u: 0.75, label: "8k", active: Math.abs(p.high) > 0.08 },
      ];
      markers.forEach(({ u, label, active }) => {
        const x = u * W;
        const idx = Math.floor(u * points);
        const y = curveY[idx] ?? H * 0.5;
        
        ctx.strokeStyle = `rgba(255,200,160,${active ? 0.45 : 0.15})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, H * 0.88);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        if (active) {
          const mg = ctx.createRadialGradient(x, y, 0, x, y, 6);
          mg.addColorStop(0, `rgba(255,220,180,${0.75 + p.amt * 0.2})`);
          mg.addColorStop(1, "rgba(255,200,160,0)");
          ctx.fillStyle = mg;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        
        ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = `rgba(255,200,160,${active ? 0.65 : 0.35})`;
        ctx.textAlign = "center";
        ctx.fillText(label, x, H - 4);
      });

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,200,160,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(p.amt < 0.02 ? "FLAT" : "SHELF EQ", 10, H - 8);
      ctx.textAlign = "right";
      const lr = [p.low > 0.05 ? "L+" : p.low < -0.05 ? "L−" : null, p.high > 0.05 ? "H+" : p.high < -0.05 ? "H−" : null].filter(Boolean).join(" ");
      ctx.fillText(lr || "NEUTRAL", W - 10, H - 8);
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

/** Constellation orbits with voice trails — Harmony. */
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
    const trails: Array<{ x: number; y: number; age: number; voice: number }> = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 30) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      
      // Deep amber constellation field
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 4, W * 0.5, H * 0.5, W * 0.6);
      bg.addColorStop(0, "rgba(30,18,8,0.9)");
      bg.addColorStop(0.6, "rgba(16,10,4,0.94)");
      bg.addColorStop(1, "rgba(6,4,2,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const count = p.mode === "off" ? 1 : p.mode === "triad" ? 3 : 2;
      const cx = W * 0.5;
      const cy = H * 0.45;
      const breathe = Math.sin(t * 0.0018) * 0.5 + 0.5;

      // Orbit rings (faint guides)
      for (let i = 0; i < count; i++) {
        const orbitR = 22 + i * 14 + p.level * 10;
        ctx.strokeStyle = `rgba(255,179,92,${0.06 + p.level * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, orbitR * 0.5, orbitR * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Voice nodes + connections
      const nodes: Array<{ x: number; y: number; i: number }> = [];
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i / Math.max(1, count - 1)) * Math.PI * 1.8 + t * 0.0009 * (1 + i * 0.3);
        const r = 24 + i * 15 + p.level * 12 + Math.sin(t * 0.003 + i) * 3;
        const x = cx + Math.cos(a) * r * 0.5;
        const y = cy + Math.sin(a) * r * 0.3;
        nodes.push({ x, y, i });
        
        // Trail to root (only for harmonics, not root itself)
        if (i > 0) {
          const rootN = nodes[0];
          ctx.strokeStyle = `rgba(255,179,92,${0.15 + p.level * 0.25})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(rootN.x, rootN.y);
          ctx.lineTo(x, y);
          ctx.stroke();
          
          // Connection sparkle midpoint
          const mx = (rootN.x + x) / 2;
          const my = (rootN.y + y) / 2;
          const sparkle = (Math.sin(t * 0.004 + i) * 0.5 + 0.5) * p.level;
          ctx.fillStyle = `rgba(255,200,130,${sparkle * 0.45})`;
          ctx.fillRect(mx - 1, my - 1, 2, 2);
        }
      }

      // Node spheres with glow
      nodes.forEach(({ x, y, i }) => {
        const sz = i === 0 ? 6 + p.level * 3 : 5 - i * 0.5 + p.level * 2;
        const alpha = i === 0 ? 0.75 + p.level * 0.2 : 0.55 + p.level * 0.3 - i * 0.08;
        
        // Glow halo
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 2.5);
        g.addColorStop(0, `rgba(255,220,150,${alpha * 0.65})`);
        g.addColorStop(0.4, `rgba(255,179,92,${alpha * 0.35})`);
        g.addColorStop(1, "rgba(255,179,92,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Core sphere
        ctx.fillStyle = `rgba(255,200,130,${alpha + 0.15})`;
        ctx.shadowBlur = 6 + p.level * 8;
        ctx.shadowColor = "rgba(255,179,92,0.7)";
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Orbital trails
        if (p.level > 0.15) {
          trails.push({ x, y, age: 0, voice: i });
          if (trails.length > 60) trails.shift();
        }
      });

      // Ghost trails
      trails.forEach((tr) => {
        tr.age += 0.02;
        if (tr.age > 1) return;
        const life = 1 - tr.age;
        ctx.fillStyle = `rgba(255,200,130,${life * p.level * 0.25})`;
        const sz = life * 2;
        ctx.fillRect(tr.x - sz / 2, tr.y - sz / 2, sz, sz);
      });
      trails.splice(0, trails.length, ...trails.filter((tr) => tr.age <= 1));

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,179,92,0.65)";
      ctx.textAlign = "left";
      const label = p.mode === "off" ? "OFF" : p.mode === "octave" ? "OCTAVE" : p.mode === "fifth" ? "FIFTH" : p.mode.toUpperCase();
      ctx.fillText(label, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(p.level * 100)}% · ${count}v`, W - 10, H - 8);
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

/** Piano-roll rainbow keyboard with scale highlight — Scale Lock. */
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
      
      // Deep blue keyboard chamber
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(8,16,28,0.92)");
      bg.addColorStop(1, "rgba(4,8,14,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const scale = SCALES.find((s) => s.id === p.scaleId);
      const steps = scale?.steps ?? [0, 2, 4, 5, 7, 9, 11];
      const breathe = Math.sin(t * 0.002) * 0.5 + 0.5;

      // Piano keyboard backdrop
      const keyW = W / 12;
      const keyH = H * 0.55;
      const keyY = H * 0.22;
      
      for (let i = 0; i < 12; i++) {
        const x = i * keyW;
        const inScale = steps.includes(i);
        const isRoot = i === 0;
        const blackKey = [1, 3, 6, 8, 10].includes(i);
        
        // Key backdrop
        const keyG = ctx.createLinearGradient(x, keyY, x, keyY + keyH);
        if (blackKey) {
          keyG.addColorStop(0, "rgba(20,30,45,0.6)");
          keyG.addColorStop(1, "rgba(10,15,22,0.8)");
        } else {
          keyG.addColorStop(0, "rgba(40,55,75,0.25)");
          keyG.addColorStop(1, "rgba(25,35,50,0.4)");
        }
        ctx.fillStyle = keyG;
        ctx.fillRect(x + 1, keyY, keyW - 2, keyH);
        
        // Scale highlight bar
        if (inScale && p.on) {
          const hue = 200 + (i / 12) * 60;
          const sat = 70 + breathe * 20;
          const light = isRoot ? 65 : 55;
          const highlightG = ctx.createLinearGradient(x, keyY, x, keyY + keyH);
          highlightG.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${0.7 + breathe * 0.25})`);
          highlightG.addColorStop(1, `hsla(${hue}, ${sat}%, ${light - 15}%, 0.4)`);
          ctx.fillStyle = highlightG;
          ctx.fillRect(x + 2, keyY, keyW - 4, keyH);
        }
      }

      // Scale dots on keyboard
      for (let i = 0; i < 12; i++) {
        const x = ((i + 0.5) / 12) * W;
        const inS = steps.includes(i);
        const isRoot = i === 0;
        const y = H * 0.52;
        const pulse = inS ? 0.7 + 0.3 * Math.sin(t * 0.004 + i * 0.5) : 0.15;
        const sz = inS ? (isRoot ? 7 : 5.5) : 2.8;
        const hue = 200 + (i / 12) * 60;
        
        // Dot glow
        if (inS && p.on) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 2.5);
          g.addColorStop(0, `hsla(${hue}, 75%, 70%, ${pulse * 0.6})`);
          g.addColorStop(1, "rgba(98,182,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, sz * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        
        // Dot core
        ctx.fillStyle = inS && p.on
          ? `hsla(${hue}, 80%, 75%, ${pulse})`
          : "rgba(98,182,255,0.15)";
        ctx.shadowBlur = inS && p.on ? 6 + pulse * 6 : 0;
        ctx.shadowColor = `hsla(${hue}, 75%, 70%, 0.7)`;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Root ring
        if (isRoot) {
          ctx.strokeStyle = `rgba(98,182,255,${p.on ? 0.75 : 0.35})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, sz + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Lock indicator beams
      if (p.on) {
        steps.forEach((s, i) => {
          const x = ((s + 0.5) / 12) * W;
          const hue = 200 + (s / 12) * 60;
          ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${0.12 + breathe * 0.08})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, H * 0.1);
          ctx.lineTo(x, H * 0.52);
          ctx.stroke();
        });
      }

      const label = `${NOTE_NAMES[p.root] ?? "C"} ${scale?.label ?? "Chromatic"}`;
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(98,182,255,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(p.on ? "LOCKED" : "CHROMATIC", 10, H - 8);
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

/** Stacked interval bars with glow and harmonic shimmer — Chord Memory. */
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
      
      // Warm rust chamber
      const bg = ctx.createRadialGradient(W * 0.4, H * 0.45, 4, W * 0.5, H * 0.5, W * 0.6);
      bg.addColorStop(0, "rgba(30,16,8,0.9)");
      bg.addColorStop(0.6, "rgba(16,8,4,0.94)");
      bg.addColorStop(1, "rgba(6,4,2,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const list = p.ivs?.length ? p.ivs : [0, 4, 7];
      const max = Math.max(12, ...list.map(Math.abs));
      const breathe = Math.sin(t * 0.0025) * 0.5 + 0.5;
      
      list.forEach((iv, i) => {
        const y = H * 0.24 + i * (H * 0.19);
        const len = (Math.abs(iv) / max) * W * 0.58 + W * 0.14;
        const barH = 10;
        const pulse = i === 0 ? 1 : 0.85 + 0.15 * Math.sin(t * 0.003 + i);
        const hue = 22 - i * 4;
        
        // Ghost floor bar
        ctx.fillStyle = "rgba(255,154,107,0.06)";
        ctx.fillRect(W * 0.18, y, W * 0.68, barH);
        
        // Main bar with gradient
        const barG = ctx.createLinearGradient(W * 0.18, y, W * 0.18 + len, y);
        barG.addColorStop(0, `hsla(${hue}, 75%, ${p.on ? 65 : 45}%, ${p.on ? 0.7 * pulse : 0.25})`);
        barG.addColorStop(0.7, `hsla(${hue}, 70%, ${p.on ? 55 : 35}%, ${p.on ? 0.5 * pulse : 0.18})`);
        barG.addColorStop(1, `hsla(${hue}, 65%, ${p.on ? 45 : 25}%, ${p.on ? 0.3 * pulse : 0.12})`);
        ctx.fillStyle = barG;
        ctx.fillRect(W * 0.18, y, len, barH);
        
        // Bar glow
        if (p.on) {
          ctx.shadowBlur = 8 + pulse * 6;
          ctx.shadowColor = `hsla(${hue}, 75%, 60%, ${0.5 * pulse})`;
          ctx.fillStyle = `hsla(${hue}, 80%, 70%, ${0.15 * pulse})`;
          ctx.fillRect(W * 0.18, y, len, barH);
          ctx.shadowBlur = 0;
        }
        
        // Endpoint marker
        const ex = W * 0.18 + len;
        ctx.fillStyle = `hsla(${hue}, 85%, ${p.on ? 75 : 50}%, ${p.on ? 0.85 * pulse : 0.35})`;
        ctx.shadowBlur = p.on ? 6 + pulse * 6 : 0;
        ctx.shadowColor = `hsla(${hue}, 80%, 70%, 0.7)`;
        ctx.beginPath();
        ctx.arc(ex, y + barH / 2, p.on ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Interval label
        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = `rgba(255,180,130,${p.on ? 0.8 : 0.5})`;
        ctx.textAlign = "left";
        const label = iv === 0 ? "ROOT" : `+${iv}st`;
        ctx.fillText(label, 8, y + barH - 1);
        
        // Semitone count indicator
        if (p.on && iv > 0) {
          ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = `rgba(255,200,150,${0.45 * breathe})`;
          ctx.textAlign = "center";
          ctx.fillText(`${iv}`, W * 0.18 + len / 2, y + barH / 2 + 2);
        }
      });

      // Connection lines between intervals
      if (p.on && list.length > 1) {
        for (let i = 0; i < list.length - 1; i++) {
          const y1 = H * 0.24 + i * (H * 0.19) + 5;
          const y2 = H * 0.24 + (i + 1) * (H * 0.19) + 5;
          ctx.strokeStyle = `rgba(255,154,107,${0.15 + breathe * 0.1})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(W * 0.15, y1);
          ctx.lineTo(W * 0.15, y2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,154,107,0.65)";
      ctx.textAlign = "right";
      ctx.fillText(p.on ? `ARMED · ${list.length}v` : "IDLE", W - 10, H - 8);
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

/** Jitter scatter cloud with ghost trails — Humanize. */
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
    const pts = Array.from({ length: 32 }, (_, i) => ({ 
      x: Math.random(), 
      y: Math.random(),
      phase: i / 32,
      trail: [] as Array<{ x: number; y: number; age: number }>,
    }));
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 26) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      
      // Organic green field
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 4, W * 0.5, H * 0.5, W * 0.6);
      bg.addColorStop(0, "rgba(12,20,12,0.9)");
      bg.addColorStop(0.6, "rgba(6,12,6,0.94)");
      bg.addColorStop(1, "rgba(3,6,3,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Grid reference (quantized)
      if (!p.on || (p.timing < 0.15 && p.vel < 0.15)) {
        ctx.strokeStyle = "rgba(155,229,100,0.08)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        for (let i = 1; i < 4; i++) {
          const y = (i / 4) * H;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
        for (let i = 1; i < 8; i++) {
          const x = (i / 8) * W;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Center reference line
      ctx.strokeStyle = "rgba(155,229,100,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5);
      ctx.lineTo(W, H * 0.5);
      ctx.stroke();

      // Particles with jitter + trails
      pts.forEach((pt, i) => {
        const jx = Math.sin(t * 0.0032 + pt.phase * Math.PI * 2 + i) * p.timing * 0.1;
        const jy = Math.cos(t * 0.0042 + pt.phase * Math.PI * 2 + i * 1.4) * p.vel * 0.14;
        const baseX = (pt.x + jx) * W;
        const baseY = H * 0.5 + (pt.y - 0.5) * H * 0.6 + jy * H;
        
        // Update trail
        pt.trail.push({ x: baseX, y: baseY, age: 0 });
        if (pt.trail.length > 8) pt.trail.shift();
        pt.trail.forEach((tr) => { tr.age += 0.15; });
        
        // Draw ghost trail
        if (p.on && (p.timing > 0.12 || p.vel > 0.12)) {
          pt.trail.forEach((tr) => {
            if (tr.age > 1) return;
            const life = 1 - tr.age;
            const alpha = life * (0.25 + (p.timing + p.vel) * 0.25);
            ctx.fillStyle = `rgba(180,240,140,${alpha})`;
            const sz = life * 2.5;
            ctx.fillRect(tr.x - sz / 2, tr.y - sz / 2, sz, sz);
          });
        }
        
        // Main particle with glow
        const alpha = p.on ? 0.65 + (p.timing + p.vel) * 0.25 : 0.25;
        const sz = 2.5 + (p.timing + p.vel) * 1.5;
        
        const g = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, sz * 2.5);
        g.addColorStop(0, `rgba(200,245,140,${alpha * 0.9})`);
        g.addColorStop(0.5, `rgba(155,229,100,${alpha * 0.6})`);
        g.addColorStop(1, "rgba(155,229,100,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(baseX, baseY, sz * 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Core dot
        ctx.fillStyle = `rgba(200,245,140,${alpha + 0.15})`;
        ctx.shadowBlur = p.on ? 5 + (p.timing + p.vel) * 6 : 0;
        ctx.shadowColor = "rgba(155,229,100,0.7)";
        ctx.beginPath();
        ctx.arc(baseX, baseY, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Variance zone indicators
      if (p.on && p.timing > 0.15) {
        ctx.strokeStyle = `rgba(155,229,100,${0.15 + p.timing * 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        const tZone = W * 0.1 * p.timing;
        ctx.beginPath();
        ctx.moveTo(W * 0.5 - tZone, H * 0.1);
        ctx.lineTo(W * 0.5 - tZone, H * 0.9);
        ctx.moveTo(W * 0.5 + tZone, H * 0.1);
        ctx.lineTo(W * 0.5 + tZone, H * 0.9);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(155,229,100,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(p.on ? "HUMANIZED" : "QUANTIZED", 10, H - 8);
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

/** Rich constellation — Scenes with occupied orbits, slot labels, connection arcs, breathing nebula. */
export function ScenesStageViz() {
  const scenes = useFireCommandStore((s) => s.scenes);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 96 });
  useHiDpiCanvas(wrapRef, canvasRef, 96, sizeRef);

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
      ctx.clearRect(0, 0, W, H);

      // Nebula chamber with golden aurora
      const breathe = Math.sin(t * 0.0018) * 0.5 + 0.5;
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 4, W * 0.5, H * 0.5, W * 0.58);
      bg.addColorStop(0, `rgba(40,28,12,${0.88 + breathe * 0.06})`);
      bg.addColorStop(0.5, "rgba(20,14,6,0.92)");
      bg.addColorStop(1, "rgba(8,6,4,0.95)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Ambient nebula wisps
      for (let w = 0; w < 3; w++) {
        const wx = W * (0.15 + w * 0.3) + Math.sin(t * 0.0008 * (1 + w * 0.2) + w) * 18;
        const wy = H * (0.4 + w * 0.12) + Math.cos(t * 0.0006 * (1 + w * 0.15)) * 10;
        const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, 28 + w * 12);
        wg.addColorStop(0, `rgba(255,207,92,${0.04 + breathe * 0.03})`);
        wg.addColorStop(1, "rgba(255,207,92,0)");
        ctx.fillStyle = wg;
        ctx.fillRect(0, 0, W, H);
      }

      const n = SCENE_SLOTS;
      const cx = W * 0.5;
      const cy = H * 0.48;
      const radius = Math.min(W, H) * 0.32;

      // Orbit rings for filled slots
      const filled = scenes.map((s, i) => ({ idx: i, active: !!s })).filter(s => s.active);
      filled.forEach(({ idx }, ring) => {
        const orbitR = radius * (0.45 + ring * 0.18);
        ctx.strokeStyle = `rgba(255,207,92,${0.08 + breathe * 0.06})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, orbitR, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Slot nodes with orbits
      const nodes: Array<{ x: number; y: number; idx: number; active: boolean }> = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + t * 0.0005;
        const active = !!scenes[i];
        const orbitIdx = filled.findIndex(f => f.idx === i);
        const r = active ? radius * (0.45 + orbitIdx * 0.18) : radius * 0.88;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        nodes.push({ x, y, idx: i, active });
      }

      // Connection arcs between adjacent filled slots
      for (let i = 0; i < filled.length - 1; i++) {
        const a = nodes.find(n => n.idx === filled[i].idx)!;
        const b = nodes.find(n => n.idx === filled[i + 1].idx)!;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const arcPulse = (Math.sin(t * 0.003 + i) * 0.5 + 0.5) * 0.35 + 0.15;
        
        // Arc glow
        const arcG = ctx.createRadialGradient(midX, midY, 0, midX, midY, 12);
        arcG.addColorStop(0, `rgba(255,220,140,${arcPulse * 0.4})`);
        arcG.addColorStop(1, "rgba(255,207,92,0)");
        ctx.fillStyle = arcG;
        ctx.fillRect(midX - 12, midY - 12, 24, 24);

        // Connection line
        ctx.strokeStyle = `rgba(255,207,92,${arcPulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(midX + (cy - midY) * 0.15, midY + (midX - cx) * 0.15, b.x, b.y);
        ctx.stroke();
      }

      // Slot nodes with halos
      nodes.forEach(({ x, y, idx, active }) => {
        const sz = active ? 7 + breathe * 2 : 3.5;
        const pulse = active ? 0.7 + 0.3 * Math.sin(t * 0.004 + idx) : 0.18;
        
        // Halo for active slots
        if (active) {
          const haloG = ctx.createRadialGradient(x, y, 0, x, y, sz * 3.2);
          haloG.addColorStop(0, `rgba(255,220,140,${pulse * 0.6})`);
          haloG.addColorStop(0.4, `rgba(255,207,92,${pulse * 0.35})`);
          haloG.addColorStop(1, "rgba(255,207,92,0)");
          ctx.fillStyle = haloG;
          ctx.beginPath();
          ctx.arc(x, y, sz * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        
        // Core sphere
        ctx.fillStyle = active 
          ? `rgba(255,220,140,${pulse})` 
          : "rgba(255,207,92,0.15)";
        ctx.shadowBlur = active ? 8 + pulse * 10 : 0;
        ctx.shadowColor = "rgba(255,207,92,0.7)";
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Orbit ring for active
        if (active) {
          ctx.strokeStyle = `rgba(255,207,92,${0.35 + pulse * 0.25})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, sz + 4 + breathe * 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Slot label
        ctx.font = active ? "700 8px ui-sans-serif, system-ui, sans-serif" : "600 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = active ? "rgba(20,16,8,0.85)" : "rgba(255,207,92,0.35)";
        ctx.textAlign = "center";
        ctx.fillText(`${idx + 1}`, x, y + 2.5);
      });

      // Particle trails for filled slots
      if (filled.length > 0) {
        const trail = ((t * 0.001) % 1);
        filled.forEach(({ idx }, i) => {
          const node = nodes.find(n => n.idx === idx)!;
          const orbitR = radius * (0.45 + i * 0.18);
          const angle = (idx / n) * Math.PI * 2 - Math.PI / 2 + trail * Math.PI * 2;
          const tx = cx + Math.cos(angle) * orbitR;
          const ty = cy + Math.sin(angle) * orbitR;
          const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 3);
          tg.addColorStop(0, `rgba(255,240,180,${0.6 + breathe * 0.3})`);
          tg.addColorStop(1, "rgba(255,207,92,0)");
          ctx.fillStyle = tg;
          ctx.beginPath();
          ctx.arc(tx, ty, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,207,92,0.65)";
      ctx.textAlign = "left";
      ctx.fillText("CONSTELLATION", 10, H - 8);
      ctx.textAlign = "right";
      const count = filled.length;
      ctx.fillText(count > 0 ? `${count}/${n} OCCUPIED` : `${n} EMPTY`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scenes]);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.scenes}55`} height={96} radius="rounded-lg">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}

/** 4-operator orbs with algorithm cable routing and vector XY crosshair — FM Rack. */
export function FmRackStageViz() {
  const alg = useFireCommandStore((s) => s.patch.fmAlg ?? 0);
  const feedback = useFireCommandStore((s) => s.patch.fmFeedback ?? 0);
  const op1 = useFireCommandStore((s) => s.patch.fmOp1Level ?? 1);
  const op2 = useFireCommandStore((s) => s.patch.fmOp2Level ?? 0.7);
  const op3 = useFireCommandStore((s) => s.patch.fmOp3Level ?? 0.5);
  const op4 = useFireCommandStore((s) => s.patch.fmOp4Level ?? 0.35);
  const vecRate = useFireCommandStore((s) => s.patch.vectorRate ?? 0);
  const vecDepth = useFireCommandStore((s) => s.patch.vectorDepth ?? 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 100 });
  const st = useRef({ alg, feedback, op1, op2, op3, op4, vecRate, vecDepth });
  st.current = { alg, feedback, op1, op2, op3, op4, vecRate, vecDepth };
  useHiDpiCanvas(wrapRef, canvasRef, 100, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;

    // Algorithm routing (simplified 8 classic patterns)
    const algRoutes: Record<number, Array<[number, number]>> = {
      0: [[1, 0]], // 1→0 carrier
      1: [[2, 1], [1, 0]], // 2→1→0 stack
      2: [[1, 0], [2, 0]], // 1→0, 2→0 parallel
      3: [[3, 2], [2, 1], [1, 0]], // 3→2→1→0 full stack
      4: [[2, 1], [3, 1], [1, 0]], // 2→1, 3→1, 1→0
      5: [[1, 0], [2, 0], [3, 0]], // all parallel to carrier
      6: [[3, 2], [2, 0], [1, 0]], // 3→2→0, 1→0
      7: [[3, 0], [2, 0], [1, 0]], // all direct to carrier (most parallel)
    };

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      ctx.clearRect(0, 0, W, H);

      // Cyan FM chamber
      const bg = ctx.createRadialGradient(W * 0.35, H * 0.45, 4, W * 0.5, H * 0.5, W * 0.55);
      bg.addColorStop(0, "rgba(20,32,45,0.9)");
      bg.addColorStop(0.6, "rgba(10,16,24,0.94)");
      bg.addColorStop(1, "rgba(4,8,12,0.96)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const opLevels = [p.op1, p.op2, p.op3, p.op4];
      const opPositions = [
        { x: W * 0.28, y: H * 0.48 }, // Op 0 (carrier)
        { x: W * 0.48, y: H * 0.32 },
        { x: W * 0.62, y: H * 0.52 },
        { x: W * 0.48, y: H * 0.68 },
      ];

      const routes = algRoutes[p.alg % 8] ?? [];

      // Draw algorithm cable routes with flow particles
      routes.forEach(([from, to]) => {
        const fPos = opPositions[from];
        const tPos = opPositions[to];
        const modLevel = opLevels[from];
        
        // Cable line
        ctx.strokeStyle = `rgba(142,197,255,${0.25 + modLevel * 0.45})`;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(fPos.x, fPos.y);
        ctx.lineTo(tPos.x, tPos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Flow particle along cable
        const flow = ((t * 0.003 * (1 + vecRate) + from * 0.3) % 1);
        const fx = fPos.x + (tPos.x - fPos.x) * flow;
        const fy = fPos.y + (tPos.y - fPos.y) * flow;
        const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 4);
        fg.addColorStop(0, `rgba(180,220,255,${modLevel * 0.75})`);
        fg.addColorStop(1, "rgba(142,197,255,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(fx, fy, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // Feedback loop on carrier (Op 0)
      if (p.feedback > 0.05) {
        const c = opPositions[0];
        const fbRad = 14 + p.feedback * 10;
        ctx.strokeStyle = `rgba(255,180,120,${0.35 + p.feedback * 0.45})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y - fbRad, fbRad * 0.6, Math.PI * 0.2, Math.PI * 0.8, false);
        ctx.stroke();
        
        // Feedback glow
        const fbPulse = Math.sin(t * 0.006) * 0.5 + 0.5;
        const fbg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, fbRad * 1.5);
        fbg.addColorStop(0, `rgba(255,180,120,${p.feedback * 0.15 * fbPulse})`);
        fbg.addColorStop(1, "rgba(255,180,120,0)");
        ctx.fillStyle = fbg;
        ctx.fillRect(0, 0, W, H);
      }

      // Operator orbs
      opPositions.forEach((pos, i) => {
        const lv = opLevels[i];
        const sz = 8 + lv * 10;
        const isCarrier = i === 0;
        const pulse = Math.sin(t * 0.004 + i) * 0.5 + 0.5;
        
        // Glow halo
        const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, sz * 2.2);
        g.addColorStop(0, `rgba(${isCarrier ? "180,220,255" : "142,197,255"},${(0.4 + lv * 0.45) * pulse})`);
        g.addColorStop(0.5, `rgba(142,197,255,${(0.15 + lv * 0.25) * pulse})`);
        g.addColorStop(1, "rgba(142,197,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sz * 2.2, 0, Math.PI * 2);
        ctx.fill();
        
        // Core sphere
        ctx.fillStyle = isCarrier 
          ? `rgba(200,230,255,${0.75 + lv * 0.2})` 
          : `rgba(142,197,255,${0.65 + lv * 0.3})`;
        ctx.shadowBlur = 8 + lv * 12;
        ctx.shadowColor = "rgba(142,197,255,0.7)";
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Operator label
        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = isCarrier ? "rgba(20,20,40,0.9)" : "rgba(10,20,30,0.85)";
        ctx.textAlign = "center";
        ctx.fillText(`${i + 1}`, pos.x, pos.y + 3);
      });

      // Vector XY crosshair (bottom right)
      if (vecDepth > 0.05) {
        const vx = W * 0.82;
        const vy = H * 0.72;
        const vr = 16;
        
        // Crosshair axes
        ctx.strokeStyle = "rgba(142,197,255,0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vx - vr, vy);
        ctx.lineTo(vx + vr, vy);
        ctx.moveTo(vx, vy - vr);
        ctx.lineTo(vx, vy + vr);
        ctx.stroke();
        
        // Vector morph position
        const phase = t * 0.001 * vecRate;
        const vdx = Math.sin(phase) * vecDepth * vr;
        const vdy = Math.cos(phase) * vecDepth * vr;
        
        ctx.fillStyle = `rgba(180,220,255,${0.65 + vecDepth * 0.3})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(142,197,255,0.7)";
        ctx.beginPath();
        ctx.arc(vx + vdx, vy + vdy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Trail
        ctx.strokeStyle = `rgba(142,197,255,${0.15 + vecDepth * 0.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(vx, vy, vecDepth * vr, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(142,197,255,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(`ALG ${p.alg}`, 10, H - 8);
      ctx.textAlign = "right";
      const tags = [
        p.feedback > 0.05 ? `FB${Math.round(p.feedback * 100)}` : null,
        vecDepth > 0.05 ? `VEC` : null,
      ].filter(Boolean).join(" · ");
      ctx.fillText(tags || "4-OP", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Frame wrapRef={wrapRef} border={`${FC.fmRack}55`} height={100} radius="rounded-xl">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </Frame>
  );
}
