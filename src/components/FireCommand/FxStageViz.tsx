/**
 * FX stage visualizations (v2.5.3) — display-only personalities for
 * Drive, Phaser, Chorus, Delay, Reverb, and Spectral. Audio untouched.
 */

import { useEffect, useRef, type ReactNode, type RefObject, type MutableRefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { DriveMode, SpectralMode } from "@/audio/dsp/FireCommandSynth";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const TEAL = "#5ce0c8";
const MAGENTA = "#e070ff";

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

type StageChrome = "corners" | "rails" | "notch" | "plate" | "bloom" | "scope";

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
    </div>
  );
}

/** Magma forge — living sine through the transfer curve + bitcrush staircase. Drive+Crush ONLY. */
export function DriveStageViz() {
  const drive = useFireCommandStore((s) => s.patch.drive);
  const mode = useFireCommandStore((s) => s.patch.driveMode);
  const crush = useFireCommandStore((s) => s.patch.crush);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 100 });
  const st = useRef({ drive, mode, crush });
  st.current = { drive, mode, crush };
  useHiDpiCanvas(wrapRef, canvasRef, 100, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;

    const xfer = (x: number, mode: DriveMode, drive: number): number => {
      const k = 1 + drive * 14;
      switch (mode) {
        case "tube": {
          const y = Math.tanh(k * x * 0.8);
          return y + 0.15 * drive * Math.tanh(3 * x) * (1 - Math.abs(y));
        }
        case "fold": {
          const y = k * x * 0.7;
          return Math.sin(y * Math.min(2, 0.5 + drive * 2));
        }
        case "hard":
          return Math.max(-0.8, Math.min(0.8, k * x * 0.6)) / 0.8;
        case "fuzz":
          return Math.sign(x) * Math.pow(Math.min(1, Math.abs(k * x * 0.6)), 0.4);
        default:
          return Math.tanh(k * x * 0.7);
      }
    };

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { drive: d, mode: m, crush: c } = st.current;
      ctx.clearRect(0, 0, W, H);

      const heat = d * 0.18 + c * 0.14;
      const bg = ctx.createRadialGradient(W * 0.35, H * 0.4, 4, W * 0.5, H * 0.5, W * 0.55);
      bg.addColorStop(0, `rgba(255,106,61,${0.08 + heat})`);
      bg.addColorStop(0.55, "rgba(12,6,4,0.55)");
      bg.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Transfer curve (left half)
      const cx = W * 0.28;
      const cy = H * 0.5;
      const R = Math.min(H * 0.36, 34);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const x = (i / 80) * 2 - 1;
        const y = xfer(x, m, d);
        const px = cx + x * R;
        const py = cy - y * R;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Living sine → crushed (right) — amp from drive+crush only
      const x0 = W * 0.55;
      const usable = W - x0 - 12;
      const mid = H * 0.5;
      const ampBase = H * 0.28 * (0.65 + d * 0.35);
      const phase = t / 280;

      // Clean input (ghost)
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        const x = Math.sin(u * Math.PI * 4 + phase);
        const px = x0 + u * usable;
        const py = mid - x * ampBase * 0.5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Driven output with bitcrush staircase
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        let x = Math.sin(u * Math.PI * 4 + phase);
        // Bitcrush stair
        if (c > 0.02) {
          const steps = Math.max(2, Math.round(2 + (1 - c) * 48));
          x = Math.round(x * steps) / steps;
        }
        x = xfer(x, m, d);
        const px = x0 + u * usable;
        const py = mid - x * ampBase;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 8 + d * 10 + c * 6;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Bitcrush staircase overlay (when crushing)
      if (c > 0.08) {
        const steps = Math.max(2, Math.round(2 + (1 - c) * 48));
        ctx.strokeStyle = `rgba(255,140,90,${0.2 + c * 0.35})`;
        ctx.lineWidth = 1.2;
        for (let s = 0; s < steps; s++) {
          const level = ((s / steps) * 2 - 1);
          const y = mid - level * ampBase;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x0 + usable, y);
          ctx.stroke();
        }
      }

      // Heat shimmer + crush sparkle when forging
      if (d > 0.08 || c > 0.08) {
        const particles = Math.floor(10 + c * 14);
        for (let i = 0; i < particles; i++) {
          const sx = x0 + ((t / 30 + i * 41) % usable);
          const sy = mid + Math.sin(sx * 0.08 + t / 120 + i) * ampBase * 0.7;
          const col = c > 0.15 && i % 3 === 0 ? "255,200,100" : "255,140,80";
          ctx.fillStyle = `rgba(${col},${0.12 + d * 0.2 + c * 0.18})`;
          ctx.fillRect(sx, sy, c > 0.15 ? 2 : 1.5, c > 0.15 ? 2 : 1.5);
        }
      }

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,160,110,0.65)";
      ctx.textAlign = "center";
      const tags = [
        d < 0.02 ? "CLEAN" : m.toUpperCase(),
        c > 0.08 ? `${Math.round((1 - c) * 16)}BIT` : null,
      ].filter(Boolean).join(" · ");
      ctx.fillText(tags || "BYPASS", W * 0.5, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.35)" height={100} chrome="plate">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Sweep notches — spectral crawl with animated allpass phase curtains and particle trails. */
export function PhaserStageViz() {
  const rate = useFireCommandStore((s) => s.patch.phaserRate);
  const depth = useFireCommandStore((s) => s.patch.phaserDepth);
  const mix = useFireCommandStore((s) => s.patch.phaserMix);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ rate, depth, mix });
  st.current = { rate, depth, mix };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const particles: Array<{ x: number; y: number; life: number; vx: number; vy: number; notch: number }> = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { rate: r, depth: d, mix: mx } = st.current;
      
      const hue = 280 + Math.sin(t / 3000) * 20;
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 2, W * 0.5, H * 0.5, W * 0.65);
      bg.addColorStop(0, `hsla(${hue}, 75%, 52%, ${0.1 + mx * 0.15})`);
      bg.addColorStop(0.4, "rgba(18,8,28,0.65)");
      bg.addColorStop(1, `hsla(${hue - 40}, 70%, 35%, ${0.08 + mx * 0.08})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const sweep = (Math.sin(t / 1000 * r * 2) * 0.5 + 0.5) * d;
      const notches = 4;
      const PAD = 10;

      // Phase curtain waves behind notches
      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        const offset = layer * 0.15;
        for (let i = 0; i <= 120; i++) {
          const u = i / 120;
          let y = 0.5 + 0.12 * Math.sin(u * 12 + t / 700 - layer * 0.5);
          const px = PAD + u * (W - PAD * 2);
          const py = PAD + y * (H - PAD * 2) + offset * 12;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        const curtainHue = hue + layer * 10;
        ctx.strokeStyle = `hsla(${curtainHue}, 80%, 65%, ${(0.08 + mx * 0.12) * (1 - layer * 0.25)})`;
        ctx.lineWidth = 1.2 - layer * 0.3;
        ctx.stroke();
      }

      // Spectral notch comb with layered fills
      const floorY = H - PAD;
      ctx.beginPath();
      ctx.moveTo(PAD, floorY);
      const notchPoints: Array<{ u: number; y: number }> = [];
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        let y = 0.62 + 0.18 * Math.sin(u * 9 + t / 800);
        for (let n = 0; n < notches; n++) {
          const center = (n + 0.5) / notches + (sweep - 0.5) * 0.35;
          const dist = Math.abs(u - center);
          y -= Math.exp(-dist * dist * 180) * (0.38 + d * 0.38) * (0.4 + mx * 0.6);
        }
        y = Math.max(0.06, y);
        const px = PAD + u * (W - PAD * 2);
        const py = PAD + (1 - y) * (H - PAD * 2);
        notchPoints.push({ u, y });
        ctx.lineTo(px, py);
      }
      ctx.lineTo(W - PAD, floorY);
      ctx.closePath();
      
      const valley = ctx.createLinearGradient(0, PAD, 0, floorY);
      valley.addColorStop(0, `rgba(224,112,255,${0.35 + mx * 0.3})`);
      valley.addColorStop(0.3, `rgba(180,80,240,${0.18 + mx * 0.15})`);
      valley.addColorStop(0.65, `rgba(160,80,220,${0.1 + mx * 0.08})`);
      valley.addColorStop(1, "rgba(40,10,60,0.02)");
      ctx.fillStyle = valley;
      ctx.fill();

      // Notch crest outline with glow
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        let y = 0.62 + 0.18 * Math.sin(u * 9 + t / 800);
        for (let n = 0; n < notches; n++) {
          const center = (n + 0.5) / notches + (sweep - 0.5) * 0.35;
          const dist = Math.abs(u - center);
          y -= Math.exp(-dist * dist * 180) * (0.38 + d * 0.38) * (0.4 + mx * 0.6);
        }
        y = Math.max(0.06, y);
        const px = PAD + u * (W - PAD * 2);
        const py = PAD + (1 - y) * (H - PAD * 2);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 14 + mx * 10;
      ctx.shadowColor = MAGENTA;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Crawling notch markers with vertical phase lines
      for (let n = 0; n < notches; n++) {
        const center = (n + 0.5) / notches + (sweep - 0.5) * 0.35;
        const x = PAD + center * (W - PAD * 2);
        
        // Vertical gradient beam
        const beam = ctx.createLinearGradient(x, 6, x, H - 10);
        beam.addColorStop(0, `rgba(98,182,255,${0.6 + mx * 0.4})`);
        beam.addColorStop(0.5, `rgba(180,140,255,${0.3 + mx * 0.35})`);
        beam.addColorStop(1, `rgba(98,182,255,${0.15 + mx * 0.2})`);
        ctx.strokeStyle = beam;
        ctx.lineWidth = 2 + mx * 2;
        ctx.shadowBlur = 8 + mx * 12;
        ctx.shadowColor = ICE;
        ctx.beginPath();
        ctx.moveTo(x, 6);
        ctx.lineTo(x, H - 10);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Top marker pulse
        const pulse = 0.8 + 0.2 * Math.sin(t / 300 + n);
        ctx.fillStyle = `rgba(200,230,255,${(0.65 + mx * 0.35) * pulse})`;
        ctx.shadowBlur = 10 + mx * 8;
        ctx.shadowColor = ICE;
        ctx.beginPath();
        ctx.arc(x, 10, 2.5 + pulse * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Spawn particles near notch peaks
        if (mx > 0.08 && Math.random() < 0.15 * mx) {
          particles.push({
            x,
            y: 10 + Math.random() * 20,
            life: 1,
            vx: (Math.random() - 0.5) * 1.5,
            vy: Math.random() * 1.2 + 0.5,
            notch: n
          });
        }
      }

      // Particle system for spectral energy
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= 0.015;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        
        const alpha = p.life * (0.5 + mx * 0.5);
        const rad = 2 + p.life * 2;
        const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 2);
        pg.addColorStop(0, `rgba(240,180,255,${alpha})`);
        pg.addColorStop(0.5, `rgba(180,120,255,${alpha * 0.6})`);
        pg.addColorStop(1, "rgba(180,120,255,0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Frequency sparkles across spectrum
      if (mx > 0.05) {
        const sparkles = Math.floor(8 + mx * 18);
        for (let s = 0; s < sparkles; s++) {
          const sx = PAD + ((s * 37 + t * 0.05) % (W - PAD * 2));
          const sy = PAD + 8 + ((s * 23) % (H - PAD * 2 - 16));
          const slife = (Math.sin(t / 200 + s) * 0.5 + 0.5);
          ctx.fillStyle = `rgba(220,160,255,${0.15 * slife * mx})`;
          ctx.fillRect(sx, sy, 1.5, 1.5);
        }
      }

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(224,112,255,${0.55 + mx * 0.3})`;
      ctx.fillText(mx < 0.02 ? "BYPASS · COMB IDLE" : "ALLPASS COMB · SWEEP", W * 0.5, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(224,112,255,0.28)" height={88} chrome="bloom">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Ensemble shimmer — multi-voice phase curtains with detuned gauze and shimmer particles. */
export function ChorusStageViz() {
  const rate = useFireCommandStore((s) => s.patch.chorusRate);
  const depth = useFireCommandStore((s) => s.patch.chorusDepth);
  const mix = useFireCommandStore((s) => s.patch.chorusMix);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ rate, depth, mix });
  st.current = { rate, depth, mix };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const shimmer: Array<{ x: number; y: number; life: number; voice: number }> = [];

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { rate: r, depth: d, mix: mx } = st.current;

      const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 8, W * 0.5, H * 0.5, W * 0.7);
      bg.addColorStop(0, `rgba(92,224,200,${0.12 + mx * 0.15})`);
      bg.addColorStop(0.35, "rgba(10,28,26,0.65)");
      bg.addColorStop(0.7, "rgba(4,14,12,0.7)");
      bg.addColorStop(1, `rgba(98,182,255,${0.08 + mx * 0.08})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const PAD = 10;
      const mid = H * 0.5;
      const amp = H * 0.22;
      
      const voices = [
        { det: -1.0, yOff: -14, alpha: 0.45 + mx * 0.35, color: TEAL, label: "L", hue: 175 },
        { det: -0.5, yOff: -7, alpha: 0.35 + mx * 0.25, color: "rgba(92,224,200,0.75)", label: "", hue: 178 },
        { det: 0, yOff: 0, alpha: 0.55, color: "rgba(255,255,255,0.55)", label: "C", hue: 180 },
        { det: 0.5, yOff: 7, alpha: 0.35 + mx * 0.25, color: "rgba(98,182,255,0.75)", label: "", hue: 195 },
        { det: 1.0, yOff: 14, alpha: 0.45 + mx * 0.35, color: ICE, label: "R", hue: 200 },
      ];

      // Detuned gauze layers — vertical fill curtains behind each voice
      for (let v = 0; v < voices.length; v++) {
        const voice = voices[v];
        const mod = Math.sin(t / 1000 * r * 2 + voice.det) * d * 0.4;
        
        ctx.beginPath();
        ctx.moveTo(PAD, mid + voice.yOff);
        for (let i = 0; i <= 100; i++) {
          const u = i / 100;
          const y = Math.sin(u * Math.PI * 3 + t / 400 + voice.det * 0.8 + mod * 4);
          const px = PAD + u * (W - PAD * 2);
          const py = mid + voice.yOff - y * amp * (0.75 + Math.abs(voice.det) * 0.1);
          ctx.lineTo(px, py);
        }
        ctx.lineTo(W - PAD, mid + voice.yOff);
        ctx.closePath();
        
        const gauze = ctx.createLinearGradient(0, mid + voice.yOff - amp * 0.9, 0, mid + voice.yOff + 4);
        gauze.addColorStop(0, `hsla(${voice.hue}, 70%, 65%, ${voice.alpha * 0.15 * mx})`);
        gauze.addColorStop(0.6, `hsla(${voice.hue}, 65%, 55%, ${voice.alpha * 0.08 * mx})`);
        gauze.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gauze;
        ctx.fill();
      }

      // Draw voice waveform strokes with trails
      for (const v of voices) {
        const mod = Math.sin(t / 1000 * r * 2 + v.det) * d * 0.4;
        
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const u = i / 100;
          const y = Math.sin(u * Math.PI * 3 + t / 400 + v.det * 0.8 + mod * 4);
          const px = PAD + u * (W - PAD * 2);
          const py = mid + v.yOff - y * amp * (0.75 + Math.abs(v.det) * 0.1);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = v.color;
        ctx.globalAlpha = v.alpha;
        ctx.lineWidth = v.det === 0 ? 1.6 : 2;
        ctx.shadowBlur = v.det === 0 ? 4 : 10 * mx;
        ctx.shadowColor = v.det === 0 ? "rgba(255,255,255,0.5)" : TEAL;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        
        if (v.label) {
          ctx.fillStyle = v.color;
          ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.shadowBlur = 6;
          ctx.shadowColor = v.color;
          ctx.fillText(v.label, 8, mid + v.yOff + 3);
          ctx.shadowBlur = 0;
        }
        
        // Spawn shimmer particles along outer voices
        if ((v.det === -1 || v.det === 1) && mx > 0.08 && Math.random() < 0.12 * mx) {
          const u = Math.random();
          const y = Math.sin(u * Math.PI * 3 + t / 400 + v.det * 0.8 + mod * 4);
          shimmer.push({
            x: PAD + u * (W - PAD * 2),
            y: mid + v.yOff - y * amp * (0.75 + Math.abs(v.det) * 0.1),
            life: 1,
            voice: v.det > 0 ? 1 : -1
          });
        }
      }

      // Shimmer particle rendering with trails
      for (let i = shimmer.length - 1; i >= 0; i--) {
        const p = shimmer[i];
        p.life -= 0.018;
        if (p.life <= 0) {
          shimmer.splice(i, 1);
          continue;
        }
        
        const alpha = p.life * (0.6 + mx * 0.4);
        const rad = 1.5 + p.life * 2.5;
        const hue = p.voice > 0 ? 200 : 175;
        const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 2.5);
        pg.addColorStop(0, `hsla(${hue}, 85%, 75%, ${alpha})`);
        pg.addColorStop(0.4, `hsla(${hue}, 75%, 65%, ${alpha * 0.5})`);
        pg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Detuned frequency sparkles
      if (mx > 0.05 && d > 0.1) {
        const sparkCount = Math.floor(12 + d * 20 + mx * 15);
        for (let s = 0; s < sparkCount; s++) {
          const sx = PAD + ((s * 43 + t * 0.06) % (W - PAD * 2));
          const sy = mid + Math.sin(s * 1.3 + t / 350) * (H * 0.35);
          const slife = (Math.sin(t / 180 + s) * 0.5 + 0.5);
          ctx.fillStyle = `rgba(180,240,230,${0.12 * slife * mx * d})`;
          ctx.shadowBlur = 4;
          ctx.shadowColor = TEAL;
          ctx.fillRect(sx, sy, 2, 2);
          ctx.shadowBlur = 0;
        }
      }

      // Phase modulation indicator ring
      if (mx > 0.1) {
        const phaseAng = (t / 1000 * r * 2) % (Math.PI * 2);
        const ringR = 8 + d * 4;
        const ringCx = W - 24;
        const ringCy = 14;
        
        ctx.strokeStyle = `rgba(92,224,200,${0.3 + mx * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
        ctx.stroke();
        
        const indX = ringCx + Math.cos(phaseAng) * ringR;
        const indY = ringCy + Math.sin(phaseAng) * ringR;
        ctx.fillStyle = TEAL;
        ctx.shadowBlur = 8;
        ctx.shadowColor = TEAL;
        ctx.beginPath();
        ctx.arc(indX, indY, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(92,224,200,0.65)";
      ctx.textAlign = "right";
      ctx.fillText(mx < 0.02 ? "DRY · ENSEMBLE" : `${Math.round(mx * 100)}% WET · ENSEMBLE`, W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(92,224,200,0.28)" height={88} chrome="rails">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Ping-pong corridor — echo trails with tempo grid ghosts, feedback glow, and decay particles. */
export function DelayStageViz() {
  const time = useFireCommandStore((s) => s.patch.delayTime);
  const fbk = useFireCommandStore((s) => s.patch.delayFeedback);
  const mix = useFireCommandStore((s) => s.patch.delayMix);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ time, fbk, mix });
  st.current = { time, fbk, mix };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const trails: Array<{ x: number; y: number; life: number; echo: number; isL: boolean }> = [];

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { time: tm, fbk: fb, mix: mx } = st.current;

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, `rgba(98,182,255,${0.15 + mx * 0.12})`);
      bg.addColorStop(0.3, "rgba(10,18,32,0.75)");
      bg.addColorStop(0.7, "rgba(4,8,16,0.8)");
      bg.addColorStop(1, `rgba(98,182,255,${0.12 + mx * 0.1})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const laneL = H * 0.32;
      const laneR = H * 0.68;
      const pad = 14;
      const usable = W - pad * 2;

      // Tempo grid ghosts — subtle vertical dividers
      const gridDivs = Math.max(4, Math.round(8 - tm * 4));
      for (let g = 1; g < gridDivs; g++) {
        const gx = pad + (g / gridDivs) * usable;
        const ghostAlpha = 0.04 + mx * 0.06;
        const gridGrad = ctx.createLinearGradient(gx, 0, gx, H);
        gridGrad.addColorStop(0, `rgba(98,182,255,${ghostAlpha * 0.5})`);
        gridGrad.addColorStop(0.5, `rgba(98,182,255,${ghostAlpha})`);
        gridGrad.addColorStop(1, `rgba(98,182,255,${ghostAlpha * 0.5})`);
        ctx.strokeStyle = gridGrad;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Dual tape lanes with glow
      ctx.strokeStyle = `rgba(98,182,255,${0.2 + mx * 0.15})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.shadowBlur = 6 + mx * 8;
      ctx.shadowColor = ICE;
      ctx.beginPath();
      ctx.moveTo(pad, laneL); ctx.lineTo(W - pad, laneL);
      ctx.moveTo(pad, laneR); ctx.lineTo(W - pad, laneR);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(150,210,255,0.55)";
      ctx.textAlign = "left";
      ctx.shadowBlur = 6;
      ctx.shadowColor = ICE;
      ctx.fillText("L", 4, laneL + 3);
      ctx.fillText("R", 4, laneR + 3);
      ctx.shadowBlur = 0;

      const echoes = 1 + Math.round(fb * 7);
      const spacing = 0.08 + tm * 0.14;
      const phase = (t / (500 + tm * 900)) % 1;

      // Echo blips with feedback glow and decay trails
      for (let i = 0; i < echoes; i++) {
        const life = Math.pow(fb, i) * (0.35 + mx * 0.65);
        const u = (phase + i * spacing) % 1;
        const isL = i % 2 === 0;
        const y = isL ? laneL : laneR;
        const x = pad + u * usable;
        const r = 3 + life * 8;
        
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
        g.addColorStop(0, `rgba(240,250,255,${0.9 * life})`);
        g.addColorStop(0.3, `rgba(180,220,255,${0.7 * life})`);
        g.addColorStop(0.6, `rgba(98,182,255,${0.4 * life})`);
        g.addColorStop(1, "rgba(98,182,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Core blip
        ctx.fillStyle = `rgba(255,255,255,${0.85 * life})`;
        ctx.shadowBlur = 10 + fb * 12;
        ctx.shadowColor = ICE;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Decay wake behind blip
        const wakeLen = 18 + i * 6 + fb * 20;
        const wakeGrad = ctx.createLinearGradient(Math.max(pad, x - wakeLen), y, x, y);
        wakeGrad.addColorStop(0, "rgba(98,182,255,0)");
        wakeGrad.addColorStop(0.5, `rgba(120,200,255,${0.15 * life})`);
        wakeGrad.addColorStop(1, `rgba(98,182,255,${0.3 * life})`);
        ctx.strokeStyle = wakeGrad;
        ctx.lineWidth = 2 + life * 2;
        ctx.beginPath();
        ctx.moveTo(Math.max(pad, x - wakeLen), y);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        // Spawn trail particles
        if (mx > 0.08 && Math.random() < 0.2 * life) {
          trails.push({
            x: x - Math.random() * 12,
            y: y + (Math.random() - 0.5) * 6,
            life: life * 0.8,
            echo: i,
            isL
          });
        }
      }

      // Trail particle system
      for (let i = trails.length - 1; i >= 0; i--) {
        const tr = trails[i];
        tr.life -= 0.02;
        if (tr.life <= 0) {
          trails.splice(i, 1);
          continue;
        }
        tr.x -= 0.8;
        
        const alpha = tr.life * (0.5 + mx * 0.5);
        const tg = ctx.createRadialGradient(tr.x, tr.y, 0, tr.x, tr.y, 4);
        tg.addColorStop(0, `rgba(180,220,255,${alpha})`);
        tg.addColorStop(0.5, `rgba(98,182,255,${alpha * 0.6})`);
        tg.addColorStop(1, "rgba(98,182,255,0)");
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Inject pulse at start of both lanes with glow
      const pulse = 0.55 + 0.45 * Math.sin(t / 180);
      const pulseAlpha = 0.55 * pulse * (0.4 + mx * 0.6);
      ctx.shadowBlur = 12 * pulse;
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.fillStyle = `rgba(255,255,255,${pulseAlpha})`;
      ctx.beginPath();
      ctx.arc(pad + 2, laneL, 3, 0, Math.PI * 2);
      ctx.arc(pad + 2, laneR, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // Pulse corona
      const pulseCor = ctx.createRadialGradient(pad + 2, laneL, 0, pad + 2, laneL, 8 * pulse);
      pulseCor.addColorStop(0, `rgba(180,220,255,${pulseAlpha * 0.4})`);
      pulseCor.addColorStop(1, "rgba(180,220,255,0)");
      ctx.fillStyle = pulseCor;
      ctx.beginPath();
      ctx.arc(pad + 2, laneL, 8 * pulse, 0, Math.PI * 2);
      ctx.arc(pad + 2, laneR, 8 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Feedback glow bar (intensity indicator)
      if (fb > 0.15) {
        const fbBarH = 3;
        const fbBarW = W * 0.3 * fb;
        const fbGrad = ctx.createLinearGradient(W - pad - fbBarW, H - 22, W - pad, H - 22);
        fbGrad.addColorStop(0, "rgba(98,182,255,0)");
        fbGrad.addColorStop(0.5, `rgba(180,220,255,${0.3 + fb * 0.4})`);
        fbGrad.addColorStop(1, `rgba(240,250,255,${0.5 + fb * 0.5})`);
        ctx.fillStyle = fbGrad;
        ctx.shadowBlur = 8 + fb * 10;
        ctx.shadowColor = ICE;
        ctx.fillRect(W - pad - fbBarW, H - 22, fbBarW, fbBarH);
        ctx.shadowBlur = 0;
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(150,210,255,0.65)";
      ctx.fillText(mx < 0.02 ? "TAPE IDLE" : `PING-PONG · FB ${Math.round(fb * 100)}%`, W * 0.5, H - 7);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(98,182,255,0.32)" height={88} chrome="scope">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Room bloom — space expansion with IR tail cloud, diffusion mist, predelay arc, and shimmer particles. */
export function ReverbStageViz() {
  const size = useFireCommandStore((s) => s.patch.reverbSize);
  const mix = useFireCommandStore((s) => s.patch.reverbMix);
  const damp = useFireCommandStore((s) => s.patch.reverbDamp ?? 0.45);
  const pre = useFireCommandStore((s) => s.patch.reverbPredelay ?? 0.02);
  const diff = useFireCommandStore((s) => s.patch.reverbDiffusion ?? 0.7);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 100 });
  const st = useRef({ size, mix, damp, pre, diff });
  st.current = { size, mix, damp, pre, diff };
  useHiDpiCanvas(wrapRef, canvasRef, 100, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const rings: Array<{ birth: number; x: number; y: number; early: boolean }> = [];
    const mist: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }> = [];
    let nextSpawn = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 20) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { size: sz, mix: mx, damp: dm, pre: pd, diff: df } = st.current;

      const warm = 0.35 + dm * 0.55;
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 4, W * 0.5, H * 0.5, W * 0.62);
      bg.addColorStop(0, `rgba(${Math.round(188 + warm * 35)},${Math.round(195 - warm * 25)},${Math.round(255 - warm * 50)},${0.14 + mx * 0.18})`);
      bg.addColorStop(0.4, `rgba(40,45,70,${0.6 + mx * 0.1})`);
      bg.addColorStop(0.7, "rgba(6,6,14,0.65)");
      bg.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Space bloom nebula - expands with size
      const bloomCx = W * 0.5;
      const bloomCy = H * 0.55;
      const bloomR = (18 + sz * 50) * (0.8 + mx * 0.4);
      const bloom = ctx.createRadialGradient(bloomCx, bloomCy, 0, bloomCx, bloomCy, bloomR);
      bloom.addColorStop(0, `rgba(200,210,255,${0.18 + mx * 0.2})`);
      bloom.addColorStop(0.35, `rgba(168,180,255,${0.1 + mx * 0.12 + sz * 0.08})`);
      bloom.addColorStop(0.65, `rgba(120,140,220,${0.05 + mx * 0.06})`);
      bloom.addColorStop(1, "rgba(80,100,180,0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);

      // Predelay arc indicator with glow
      const preX = 14 + (pd / 0.2) * (W * 0.22);
      const arcGrad = ctx.createLinearGradient(12, H * 0.22, preX, H * 0.22);
      arcGrad.addColorStop(0, `rgba(180,200,255,${0.15 + mx * 0.25})`);
      arcGrad.addColorStop(1, `rgba(220,230,255,${0.35 + mx * 0.45})`);
      ctx.strokeStyle = arcGrad;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8 + mx * 10;
      ctx.shadowColor = "rgba(200,210,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(12, H * 0.22);
      ctx.lineTo(preX, H * 0.22);
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = `rgba(240,245,255,${0.65 + mx * 0.35})`;
      ctx.shadowBlur = 12;
      ctx.shadowColor = "rgba(230,235,255,0.8)";
      ctx.beginPath();
      ctx.arc(preX, H * 0.22, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      const preCorona = ctx.createRadialGradient(preX, H * 0.22, 0, preX, H * 0.22, 10);
      preCorona.addColorStop(0, `rgba(220,230,255,${0.25 + mx * 0.3})`);
      preCorona.addColorStop(1, "rgba(220,230,255,0)");
      ctx.fillStyle = preCorona;
      ctx.beginPath();
      ctx.arc(preX, H * 0.22, 10, 0, Math.PI * 2);
      ctx.fill();

      const spawnEvery = Math.max(90, 320 - df * 180 - mx * 60);
      if (t > nextSpawn && mx > 0.02) {
        const n = 1 + Math.floor(df * 2);
        for (let k = 0; k < n; k++) {
          rings.push({
            birth: t + k * 28,
            x: W * 0.5 + (Math.random() - 0.5) * (40 + df * 50),
            y: H * 0.58 + (Math.random() - 0.5) * 14,
            early: k === 0,
          });
        }
        nextSpawn = t + spawnEvery;
        while (rings.length > 14) rings.shift();
      }

      const lifeMs = 550 + sz * 420;
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        const age = (t - ring.birth) / lifeMs;
        if (age < 0) continue;
        if (age > 1) { rings.splice(i, 1); continue; }
        const rad = 5 + age * (16 + sz * 24) * (1 - dm * 0.25);
        const alpha = (1 - age) * (0.35 + mx * 0.6) * (1 - dm * 0.35);
        
        const ringGrad = ctx.createRadialGradient(ring.x, ring.y, rad * 1.2, ring.x, ring.y, rad * 2);
        ringGrad.addColorStop(0, `rgba(180,200,255,${alpha * 0.15})`);
        ringGrad.addColorStop(1, "rgba(180,200,255,0)");
        ctx.fillStyle = ringGrad;
        ctx.beginPath();
        ctx.ellipse(ring.x, ring.y, rad * 2, rad * (0.6 + df * 0.25), 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = `rgba(168,180,255,${alpha})`;
        ctx.lineWidth = (ring.early ? 2 : 1.4) * (1 - age * 0.5);
        ctx.shadowBlur = ring.early ? 10 + mx * 8 : 6;
        ctx.shadowColor = "rgba(168,180,255,0.6)";
        ctx.beginPath();
        ctx.ellipse(ring.x, ring.y, rad * 1.7, rad * (0.45 + df * 0.2), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        if (ring.early && age < 0.15) {
          const impactAlpha = (1 - age / 0.15);
          ctx.strokeStyle = `rgba(240,245,255,${0.8 * impactAlpha})`;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 14 * impactAlpha;
          ctx.shadowColor = "rgba(240,245,255,0.9)";
          ctx.beginPath();
          ctx.moveTo(ring.x, ring.y - 14);
          ctx.lineTo(ring.x, ring.y + 3);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Spawn diffusion mist particles
      if (mx > 0.08 && df > 0.2 && Math.random() < 0.15 * df * mx) {
        mist.push({
          x: W * 0.5 + (Math.random() - 0.5) * (W * 0.4),
          y: H * 0.58 + (Math.random() - 0.5) * (H * 0.3),
          vx: (Math.random() - 0.5) * 0.8,
          vy: (Math.random() - 0.5) * 0.8,
          life: 1,
          size: 2 + Math.random() * 3
        });
      }

      // Diffusion mist cloud rendering
      for (let i = mist.length - 1; i >= 0; i--) {
        const m = mist[i];
        m.life -= 0.012;
        if (m.life <= 0) {
          mist.splice(i, 1);
          continue;
        }
        m.x += m.vx;
        m.y += m.vy;
        m.vx *= 0.98;
        m.vy *= 0.98;
        
        const alpha = m.life * (0.4 + mx * 0.4) * df;
        const mg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 4);
        mg.addColorStop(0, `rgba(190,200,255,${alpha})`);
        mg.addColorStop(0.5, `rgba(168,180,255,${alpha * 0.6})`);
        mg.addColorStop(1, "rgba(168,180,255,0)");
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Diffusion grain field
      if (mx > 0.05) {
        const grains = Math.floor(12 + df * 35);
        for (let g = 0; g < grains; g++) {
          const gx = ((g * 97 + t * 0.025) % W);
          const gy = H * 0.35 + ((g * 53) % (H * 0.45));
          const pulse = (Math.sin(t / 300 + g * 0.3) * 0.5 + 0.5);
          ctx.fillStyle = `rgba(190,200,255,${(0.08 + df * 0.15 * mx) * pulse})`;
          ctx.shadowBlur = 3 * pulse;
          ctx.shadowColor = "rgba(190,200,255,0.4)";
          ctx.fillRect(gx, gy, 1.8, 1.8);
          ctx.shadowBlur = 0;
        }
      }

      // IR tail shimmer particles
      if (mx > 0.15 && sz > 0.3) {
        const shimmerCount = Math.floor(6 + sz * 12);
        for (let s = 0; s < shimmerCount; s++) {
          const sx = W * 0.5 + Math.sin(t / 800 + s * 0.8) * (20 + sz * 40);
          const sy = H * 0.6 + Math.cos(t / 650 + s * 0.6) * (12 + sz * 18);
          const slife = (Math.sin(t / 250 + s) * 0.5 + 0.5);
          const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 3 + slife * 2);
          sg.addColorStop(0, `rgba(220,230,255,${0.5 * slife * mx})`);
          sg.addColorStop(0.6, `rgba(180,200,255,${0.25 * slife * mx})`);
          sg.addColorStop(1, "rgba(180,200,255,0)");
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.arc(sx, sy, 3 + slife * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(180,190,255,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(`${sz.toFixed(1)}s · d${Math.round(dm * 100)}`, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(mx < 0.02 ? "DRY" : `PRE ${Math.round(pd * 1000)}ms`, W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(168,180,255,0.3)" height={100} chrome="bloom">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Violet FFT bay — freeze lattice with spectral bins, gate personality, and smear trails. */
export function SpectralStageViz() {
  const mode = useFireCommandStore((s) => s.patch.spectralMode) ?? "off";
  const amount = useFireCommandStore((s) => s.patch.spectralAmount) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 100 });
  const st = useRef({ mode, amount, mix });
  st.current = { mode, amount, mix };
  useHiDpiCanvas(wrapRef, canvasRef, 100, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const N = 48;
    const cur = new Float32Array(N).fill(0.15);
    const frozen = new Float32Array(N).fill(0);
    const sparkles: Array<{ x: number; y: number; life: number; bin: number }> = [];

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { mode: m, amount: a, mix: mx } = st.current as {
        mode: SpectralMode; amount: number; mix: number;
      };

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(201,139,255,${0.1 + mx * 0.14})`);
      bg.addColorStop(0.3, "rgba(25,10,40,0.65)");
      bg.addColorStop(0.7, "rgba(10,4,16,0.7)");
      bg.addColorStop(1, `rgba(98,182,255,${0.05})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.1, W * 0.5, H * 0.5, W * 0.58);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(0.75, "rgba(0,0,0,0.25)");
      vig.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      if (m === "off") {
        ctx.fillStyle = "rgba(201,139,255,0.45)";
        ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(201,139,255,0.6)";
        ctx.fillText(W < 340 ? "SELECT A MODE" : "SELECT A MODE TO ARM THE FFT BAY", W / 2, H / 2 + 4);
        ctx.shadowBlur = 0;
        return;
      }

      const PAD = 8;
      const bw = (W - PAD * 2) / N;
      const sec = t / 1000;
      
      // Analyzer grid lattice with glow
      ctx.strokeStyle = `rgba(201,139,255,${0.08 + mx * 0.06})`;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = PAD + ((H - PAD * 2) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(W - PAD, y);
        ctx.stroke();
      }
      
      // Vertical lattice lines (frequency divisions)
      const vLines = 8;
      for (let v = 1; v < vLines; v++) {
        const x = PAD + ((W - PAD * 2) / vLines) * v;
        ctx.strokeStyle = `rgba(180,120,255,${0.04 + mx * 0.04})`;
        ctx.beginPath();
        ctx.moveTo(x, PAD);
        ctx.lineTo(x, H - PAD);
        ctx.stroke();
      }

      for (let i = 0; i < N; i++) {
        const live = Math.max(
          0.03,
          (0.7 / (1 + i * 0.12)) * (0.55 + 0.45 * Math.sin(sec * (1.2 + i * 0.31) + i * 1.7)),
        );
        let v = live;
        let x = PAD + i * bw;
        let dim = false;

        if (m === "freeze") {
          if (frozen[i] < 0.01) frozen[i] = live;
          cur[i] = frozen[i] * a + live * (1 - a);
          v = cur[i];
        } else if (m === "smear") {
          frozen[i] = 0;
          cur[i] += (live - cur[i]) * (1 - a * 0.94);
          v = cur[i];
        } else if (m === "gate") {
          frozen[i] = 0;
          const thr = a * 0.5;
          dim = live < thr;
          v = live;
          cur[i] = live;
        } else if (m === "shift") {
          frozen[i] = 0;
          cur[i] = live;
          v = live;
          x += (a * 2 - 1) * bw * 8;
          if (x < PAD - bw || x > W - PAD) continue;
        }

        const barH = v * (H - PAD * 2);
        const hue = 270 + (i / N) * 40 + Math.sin(sec + i * 0.2) * 8;
        
        const barGlow = ctx.createRadialGradient(x + bw / 2, PAD + (H - PAD * 2 - barH) / 2, 0, x + bw / 2, PAD + (H - PAD * 2 - barH) / 2, bw * 3);
        barGlow.addColorStop(0, `hsla(${hue}, 85%, 70%, ${dim ? 0.02 : (0.15 + v * 0.15) * mx})`);
        barGlow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = barGlow;
        ctx.fillRect(x - bw, PAD + (H - PAD * 2 - barH) - 4, bw * 3, barH + 8);
        
        const g = ctx.createLinearGradient(0, PAD + (H - PAD * 2 - barH), 0, H - PAD);
        g.addColorStop(0, `hsla(${hue}, 90%, 75%, ${dim ? 0.15 : 0.65 + v * 0.35})`);
        g.addColorStop(0.5, `hsla(${hue}, 85%, 60%, ${dim ? 0.1 : 0.45 + v * 0.25})`);
        g.addColorStop(1, `hsla(${hue}, 80%, 45%, ${dim ? 0.05 : 0.2})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + 0.5, PAD + (H - PAD * 2 - barH), Math.max(1.5, bw - 1.5), barH);
        
        // Top cap glow
        if (!dim && v > 0.1) {
          ctx.fillStyle = `hsla(${hue}, 95%, 85%, ${0.7 + v * 0.3})`;
          ctx.shadowBlur = 8 + v * 8;
          ctx.shadowColor = `hsla(${hue}, 90%, 75%, 0.8)`;
          ctx.fillRect(x + 0.5, PAD + (H - PAD * 2 - barH), Math.max(1.5, bw - 1.5), 2);
          ctx.shadowBlur = 0;
        }
        
        // Spawn sparkles on high peaks
        if (!dim && v > 0.5 && mx > 0.1 && Math.random() < 0.08 * v * mx) {
          sparkles.push({
            x: x + bw / 2,
            y: PAD + (H - PAD * 2 - barH),
            life: 1,
            bin: i
          });
        }
      }

      // Spectral sparkle particles
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i];
        sp.life -= 0.02;
        if (sp.life <= 0) {
          sparkles.splice(i, 1);
          continue;
        }
        sp.y -= 0.5;
        
        const alpha = sp.life * (0.6 + mx * 0.4);
        const hue = 270 + (sp.bin / N) * 40;
        const sg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 5);
        sg.addColorStop(0, `hsla(${hue}, 95%, 85%, ${alpha})`);
        sg.addColorStop(0.5, `hsla(${hue}, 85%, 70%, ${alpha * 0.6})`);
        sg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (m === "gate") {
        const thr = a * 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${0.5 + a * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        ctx.moveTo(PAD, PAD + (1 - thr) * (H - PAD * 2));
        ctx.lineTo(W - PAD, PAD + (1 - thr) * (H - PAD * 2));
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
      }

      // Freeze lattice overlay
      if (m === "freeze" && a > 0.3) {
        ctx.strokeStyle = `rgba(180,140,255,${0.1 * a})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < N; i += 4) {
          const x = PAD + i * bw;
          const barH = frozen[i] * (H - PAD * 2);
          ctx.beginPath();
          ctx.moveTo(x, PAD + (H - PAD * 2 - barH));
          ctx.lineTo(x + bw * 4, PAD + (H - PAD * 2 - barH));
          ctx.stroke();
        }
      }

      // Smear trail effect
      if (m === "smear" && a > 0.3) {
        const smearGrad = ctx.createLinearGradient(0, 0, W, 0);
        smearGrad.addColorStop(0, `rgba(201,139,255,${0.08 * a})`);
        smearGrad.addColorStop(0.5, `rgba(180,120,255,${0.12 * a})`);
        smearGrad.addColorStop(1, `rgba(201,139,255,${0.08 * a})`);
        ctx.fillStyle = smearGrad;
        ctx.fillRect(0, PAD, W, 3);
      }

      // Mix wetness edge wash
      if (mx > 0.05) {
        const eg = ctx.createLinearGradient(0, 0, W, 0);
        eg.addColorStop(0, `rgba(201,139,255,${mx * 0.18})`);
        eg.addColorStop(0.5, "rgba(201,139,255,0)");
        eg.addColorStop(1, `rgba(201,139,255,${mx * 0.18})`);
        ctx.fillStyle = eg;
        ctx.fillRect(0, 0, W, 2);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(201,139,255,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(m.toUpperCase(), 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText("FFT BAY", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(201,139,255,0.32)" height={100} chrome="notch">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

const GOLD = "#ffcf5c";
const WARP_H = 145;

type HarmonicNode = { x: number; y: number; amp: number; n: number; even: boolean };

function warpHarmonics(
  n: number, N: number, S: number, T: number, C: number, breath: number,
): { amp: number; posN: number } {
  let amp = 1 / n;
  amp *= Math.pow(n / 8, -T * 1.35);
  if (n % 2 === 0) amp *= 1 - C * 0.96;
  amp = Math.min(1, Math.max(0.015, amp)) * breath;
  const posN = n * (1 + S * 0.72 * ((n - 1) / N));
  return { amp, posN };
}

/** Spectral Warp — gold aurora harmonic forge reshaped by Stretch / Tilt / Comb. */
export function WarpStageViz() {
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 400, h: WARP_H });
  const st = useRef({ stretch, tilt, comb });
  st.current = { stretch, tilt, comb };
  useHiDpiCanvas(wrapRef, canvasRef, WARP_H, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const N = 28;
    const sparks = Array.from({ length: 14 }, (_, i) => ({
      phase: i / 14,
      speed: 0.18 + (i % 5) * 0.04,
      size: 1.2 + (i % 3) * 0.6,
    }));

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { stretch: S, tilt: T, comb: C } = st.current;
      ctx.clearRect(0, 0, W, H);

      const sec = t / 1000;
      const breath = 0.9 + 0.1 * Math.sin(t / 820);
      const PAD = 16;
      const top = 14;
      const usableW = W - PAD * 2;
      const usableH = H - 34;

      // Gold aurora / nebula — reacts to Stretch, Tilt, Comb
      const aurCx = W * (0.42 + S * 0.12 + Math.sin(sec * 0.35) * 0.04);
      const aurCy = H * (0.38 + T * 0.08 + Math.cos(sec * 0.28) * 0.03);
      const aurR = W * (0.42 + Math.abs(S) * 0.12 + C * 0.08);
      const aur = ctx.createRadialGradient(aurCx, aurCy, 2, W * 0.5, H * 0.45, aurR);
      aur.addColorStop(0, `rgba(255,220,130,${0.14 + Math.abs(T) * 0.08 + C * 0.06})`);
      aur.addColorStop(0.35, `rgba(255,160,60,${0.07 + Math.abs(S) * 0.06})`);
      aur.addColorStop(0.65, "rgba(18,10,4,0.62)");
      aur.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = aur;
      ctx.fillRect(0, 0, W, H);

      // Drifting nebula wisps
      for (let w = 0; w < 3; w++) {
        const wx = W * (0.2 + w * 0.28) + Math.sin(sec * (0.4 + w * 0.15) + w) * 22;
        const wy = H * (0.55 + w * 0.08) + Math.cos(sec * (0.35 + w * 0.1)) * 12;
        const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, 38 + w * 14);
        wg.addColorStop(0, `rgba(255,207,92,${0.04 + C * 0.05})`);
        wg.addColorStop(1, "rgba(255,207,92,0)");
        ctx.fillStyle = wg;
        ctx.fillRect(0, 0, W, H);
      }

      // Harmonic guide lattice
      ctx.strokeStyle = "rgba(255,207,92,0.045)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 6; i++) {
        const y = top + (usableH / 7) * i;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      }

      const nodes: HarmonicNode[] = [];
      for (let n = 1; n <= N; n++) {
        const { amp, posN } = warpHarmonics(n, N, S, T, C, breath);
        const x = PAD + ((posN - 1) / (N * 1.48)) * usableW;
        if (x > W - PAD + 2) continue;
        const barH = amp * usableH;
        const y = top + usableH - barH;
        nodes.push({ x, y, amp, n, even: n % 2 === 0 });
      }

      // Lattice ribbons — vertical + diagonal cross-links between tips
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const linkA = a.even ? 0.12 + (1 - C) * 0.18 : 0.22 + Math.abs(T) * 0.12;
        ctx.strokeStyle = `rgba(255,207,92,${linkA * 0.35})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (i % 3 === 0 && i + 2 < nodes.length) {
          const c = nodes[i + 2];
          ctx.strokeStyle = `rgba(255,180,80,${0.06 + Math.abs(S) * 0.08})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(c.x, c.y);
          ctx.stroke();
        }
      }

      // Contour ribbon through tips
      if (nodes.length > 1) {
        ctx.beginPath();
        nodes.forEach((nd, i) => {
          if (i === 0) ctx.moveTo(nd.x, nd.y); else ctx.lineTo(nd.x, nd.y);
        });
        ctx.strokeStyle = `rgba(255,207,92,${0.28 + Math.abs(S) * 0.3 + C * 0.1})`;
        ctx.lineWidth = 1.6;
        ctx.shadowBlur = 10 + Math.abs(S) * 6;
        ctx.shadowColor = GOLD;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Harmonic bars + tip nodes
      const tiltBright = Math.max(0, T);
      const tiltDark = Math.max(0, -T);
      for (const nd of nodes) {
        const barH = nd.amp * usableH;
        const y = top + usableH - barH;
        const bw = Math.max(2.5, Math.min(8, usableW / (N * 1.05)));
        const combDim = nd.even ? C : 0;
        const tipLum = nd.even
          ? 55 - tiltDark * 35 - combDim * 40
          : 72 + tiltBright * 22 - combDim * 10;
        const tipAlpha = nd.even ? 0.35 + (1 - combDim) * 0.45 : 0.65 + tiltBright * 0.3;

        const g = ctx.createLinearGradient(0, y, 0, y + barH);
        g.addColorStop(0, `hsla(42, 95%, ${tipLum}%, ${tipAlpha})`);
        g.addColorStop(0.55, `hsla(38, 80%, ${tipLum - 12}%, ${tipAlpha * 0.55})`);
        g.addColorStop(1, "rgba(255,207,92,0.03)");
        ctx.fillStyle = g;
        ctx.fillRect(nd.x - bw / 2, y, bw, barH);

        // Comb notch on even harmonics
        if (nd.even && C > 0.08) {
          const notchY = y + barH * 0.35;
          ctx.fillStyle = `rgba(8,4,2,${0.35 + C * 0.45})`;
          ctx.fillRect(nd.x - bw / 2 - 0.5, notchY, bw + 1, 2 + C * 2);
        }

        // Tip node
        const nodeR = nd.even ? 1.6 + (1 - combDim) * 1.2 : 2.2 + tiltBright * 1.4;
        const nodeHue = 42 - tiltDark * 18 + tiltBright * 8;
        ctx.fillStyle = `hsla(${nodeHue}, 90%, ${tipLum + 8}%, ${tipAlpha + 0.15})`;
        ctx.shadowBlur = nd.even ? 3 + (1 - combDim) * 5 : 6 + tiltBright * 8;
        ctx.shadowColor = GOLD;
        ctx.beginPath();
        ctx.arc(nd.x, y, nodeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Orbiting spark particles along contour
      if (nodes.length > 2) {
        const contourLen = nodes.length - 1;
        for (const sp of sparks) {
          const u = (sp.phase + sec * sp.speed) % 1;
          const idx = u * contourLen;
          const i0 = Math.floor(idx);
          const i1 = Math.min(i0 + 1, nodes.length - 1);
          const f = idx - i0;
          const a = nodes[i0];
          const b = nodes[i1];
          const sx = a.x + (b.x - a.x) * f;
          const sy = a.y + (b.y - a.y) * f;
          const orbit = 5 + Math.sin(sec * 3 + sp.phase * 12) * 3;
          const ang = sec * 2.2 + sp.phase * Math.PI * 2;
          const px = sx + Math.cos(ang) * orbit;
          const py = sy + Math.sin(ang) * orbit * 0.45;
          const sg = ctx.createRadialGradient(px, py, 0, px, py, sp.size * 3);
          sg.addColorStop(0, `rgba(255,240,180,${0.75 + Math.abs(S) * 0.2})`);
          sg.addColorStop(0.4, `rgba(255,207,92,${0.35})`);
          sg.addColorStop(1, "rgba(255,207,92,0)");
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.arc(px, py, sp.size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Soft vignette
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.08, W * 0.5, H * 0.5, W * 0.58);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(0.72, "rgba(0,0,0,0.12)");
      vig.addColorStop(1, "rgba(0,0,0,0.52)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // Corner labels
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,207,92,0.58)";
      ctx.textAlign = "left";
      ctx.fillText(W < 360 ? "FORGE" : "HARMONIC FORGE", 10, H - 8);
      ctx.textAlign = "right";
      const bits = [
        Math.abs(S) > 0.02 ? (S > 0 ? "ST+" : "ST−") : null,
        Math.abs(T) > 0.02 ? (T > 0 ? "BRT" : "DRK") : null,
        C > 0.05 ? `CMB ${Math.round(C * 100)}` : null,
      ].filter(Boolean);
      const right = bits.length ? bits.join(" · ") : "NEUTRAL";
      ctx.fillText(W < 280 && bits.length > 1 ? bits.slice(0, 2).join(" · ") : right, W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,207,92,0.4)" height={WARP_H} chrome="plate">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Tape / VHS / dust — aging theater with film grain, reel mechanics, and degradation artifacts. */
export function VintageAgeStageViz() {
  const cassette = useFireCommandStore((s) => s.patch.cassetteGen);
  const wow = useFireCommandStore((s) => s.patch.wowFlutter);
  const vhs = useFireCommandStore((s) => s.patch.vhsColor);
  const dust = useFireCommandStore((s) => s.patch.dust);
  const hiss = useFireCommandStore((s) => s.patch.hiss);
  const bit = useFireCommandStore((s) => s.patch.bitDepth);
  const srr = useFireCommandStore((s) => s.patch.sampleRateReduce);
  const bbd = useFireCommandStore((s) => s.patch.bbdChorus);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 100 });
  const st = useRef({ cassette, wow, vhs, dust, hiss, bit, srr, bbd });
  st.current = { cassette, wow, vhs, dust, hiss, bit, srr, bbd };
  useHiDpiCanvas(wrapRef, canvasRef, 100, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const grainMap: Array<{ x: number; y: number; life: number; size: number }> = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 24) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      const heat = Math.max(p.cassette, p.wow, p.vhs, p.dust, p.hiss, p.srr, p.bbd, p.bit !== "off" ? 0.4 : 0);

      const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 8, W * 0.5, H * 0.5, W * 0.6);
      bg.addColorStop(0, `rgba(60,42,20,${0.65 + heat * 0.2})`);
      bg.addColorStop(0.5, `rgba(28,20,12,${0.75 + heat * 0.15})`);
      bg.addColorStop(1, "rgba(8,6,4,0.9)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // VHS scanlines with chromatic shift
      const scanA = 0.05 + p.vhs * 0.22;
      for (let y = 0; y < H; y += 3) {
        const shift = p.vhs > 0.3 ? Math.sin(y * 0.2 + t * 0.003) * p.vhs * 2 : 0;
        ctx.fillStyle = `rgba(201,166,107,${scanA * (0.4 + ((y + t * 0.04) % 7) / 10)})`;
        ctx.fillRect(shift, y, W, 1);
        if (p.vhs > 0.3 && y % 9 === 0) {
          ctx.fillStyle = `rgba(255,180,120,${scanA * 0.3})`;
          ctx.fillRect(shift + 1, y, W - 2, 1);
        }
      }

      // Film strip perforations (if heavy aging)
      if (heat > 0.4) {
        const perfSize = 3;
        const perfSpacing = 16;
        ctx.fillStyle = `rgba(0,0,0,${0.4 + heat * 0.3})`;
        for (let py = 0; py < H; py += perfSpacing) {
          ctx.fillRect(2, py, perfSize, perfSize * 1.5);
          ctx.fillRect(W - 2 - perfSize, py, perfSize, perfSize * 1.5);
        }
      }

      // Dual tape reels with wow flutter
      const wobble = Math.sin(t * 0.002 * (0.4 + p.wow * 4)) * (2 + p.wow * 6);
      const reelY = H * 0.48 + wobble * 0.15;
      const drawReel = (cx: number, spin: number) => {
        const reelGrad = ctx.createRadialGradient(cx, reelY, 0, cx, reelY, 18);
        reelGrad.addColorStop(0, `rgba(220,190,140,${0.15 + heat * 0.25})`);
        reelGrad.addColorStop(0.7, `rgba(201,166,107,${0.4 + heat * 0.4})`);
        reelGrad.addColorStop(1, `rgba(180,146,87,${0.3 + heat * 0.3})`);
        ctx.fillStyle = reelGrad;
        ctx.beginPath();
        ctx.arc(cx, reelY, 16, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = `rgba(201,166,107,${0.45 + heat * 0.45})`;
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 6 + heat * 8;
        ctx.shadowColor = "rgba(201,166,107,0.5)";
        ctx.beginPath();
        ctx.arc(cx, reelY, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        ctx.strokeStyle = `rgba(180,150,100,${0.6 + heat * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = spin + (i / 6) * Math.PI * 2;
          ctx.moveTo(cx, reelY);
          ctx.lineTo(cx + Math.cos(a) * 14, reelY + Math.sin(a) * 14);
        }
        ctx.stroke();
        
        ctx.fillStyle = `rgba(80,60,40,${0.6 + heat * 0.2})`;
        ctx.beginPath();
        ctx.arc(cx, reelY, 4, 0, Math.PI * 2);
        ctx.fill();
      };
      
      const spin = t * 0.003 * (0.5 + p.cassette * 2 + p.wow);
      drawReel(W * 0.28, spin);
      drawReel(W * 0.72, -spin * 1.05);
      
      // Tape bridge with flutter and tension waves
      const tapeGrad = ctx.createLinearGradient(W * 0.28 + 16, reelY - 2, W * 0.72 - 16, reelY + 2);
      tapeGrad.addColorStop(0, `rgba(220,190,130,${0.3 + p.cassette * 0.45})`);
      tapeGrad.addColorStop(0.5, `rgba(240,210,150,${0.35 + p.cassette * 0.5})`);
      tapeGrad.addColorStop(1, `rgba(220,190,130,${0.3 + p.cassette * 0.45})`);
      ctx.strokeStyle = tapeGrad;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 4 + p.cassette * 8;
      ctx.shadowColor = "rgba(220,190,130,0.5)";
      ctx.beginPath();
      ctx.moveTo(W * 0.28 + 16, reelY);
      for (let x = W * 0.28 + 16; x < W * 0.72 - 16; x += 4) {
        const y = reelY + Math.sin(x * 0.08 + t * 0.004 + p.wow * 8) * (1.2 + p.wow * 5);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Dust / hiss speckles with animated grain
      const specs = Math.floor((p.dust + p.hiss) * 45);
      for (let i = 0; i < specs; i++) {
        const x = (Math.sin(i * 12.3 + t * 0.001) * 0.5 + 0.5) * W;
        const y = (Math.cos(i * 7.1 + t * 0.0015) * 0.5 + 0.5) * H;
        const life = (Math.sin(t * 0.003 + i) * 0.5 + 0.5);
        ctx.fillStyle = `rgba(255,230,180,${(0.2 + p.dust * 0.5) * life})`;
        ctx.shadowBlur = 3 * life;
        ctx.shadowColor = "rgba(255,230,180,0.4)";
        ctx.fillRect(x, y, 2, 2);
        ctx.shadowBlur = 0;
      }
      
      // Dynamic film grain
      if (heat > 0.2) {
        if (Math.random() < 0.2) {
          grainMap.push({
            x: Math.random() * W,
            y: Math.random() * H,
            life: 0.5 + Math.random() * 0.5,
            size: 1 + Math.random() * 2
          });
        }
        
        for (let i = grainMap.length - 1; i >= 0; i--) {
          const g = grainMap[i];
          g.life -= 0.05;
          if (g.life <= 0) {
            grainMap.splice(i, 1);
            continue;
          }
          ctx.fillStyle = `rgba(240,220,180,${g.life * heat * 0.4})`;
          ctx.fillRect(g.x, g.y, g.size, g.size);
        }
      }

      // Bitcrush stair overlay with glow
      if (p.bit !== "off" || p.srr > 0.05) {
        const steps = p.bit === "8bit" ? 8 : p.bit === "12bit" ? 14 : Math.max(6, Math.floor(20 - p.srr * 14));
        const stairGrad = ctx.createLinearGradient(0, H * 0.78 - 10, 0, H * 0.78 + 10);
        stairGrad.addColorStop(0, `rgba(201,166,107,${0.15 + p.srr * 0.25})`);
        stairGrad.addColorStop(0.5, `rgba(220,186,127,${0.25 + p.srr * 0.4})`);
        stairGrad.addColorStop(1, `rgba(201,166,107,${0.15 + p.srr * 0.25})`);
        ctx.strokeStyle = stairGrad;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 6 + p.srr * 10;
        ctx.shadowColor = "rgba(220,186,127,0.5)";
        ctx.beginPath();
        const mid = H * 0.78;
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * W;
          const y = mid + Math.sin(i * 1.7 + t * 0.002) * (5 + p.srr * 12);
          if (i === 0) ctx.moveTo(x, y);
          else { 
            ctx.lineTo(x, mid + Math.sin((i - 1) * 1.7 + t * 0.002) * (5 + p.srr * 12)); 
            ctx.lineTo(x, y); 
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // VHS tracking error bars (if severe)
      if (p.vhs > 0.5 && Math.random() < 0.05) {
        const errorY = Math.random() * H;
        const errorH = 2 + Math.random() * 4;
        ctx.fillStyle = `rgba(255,100,150,${0.15 + p.vhs * 0.2})`;
        ctx.fillRect(0, errorY, W, errorH);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(201,166,107,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(heat < 0.04 ? "CLEAN PATH" : "AGED", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(p.bit === "off" ? "FULL" : p.bit.toUpperCase(), W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(201,166,107,0.4)" height={100} chrome="plate">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** PWM square · sync ticks · chip noise grit with retro grid and 8-bit sparkle particles. */
export function ChipStageViz() {
  const duty = useFireCommandStore((s) => s.patch.pulseDuty);
  const sync = useFireCommandStore((s) => s.patch.hardSync);
  const noise = useFireCommandStore((s) => s.patch.chipNoise);
  const accent = useFireCommandStore((s) => s.patch.accentAmount);
  const slide = useFireCommandStore((s) => s.patch.slideOn);
  const voices = useFireCommandStore((s) => s.patch.chipVoiceLimit);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ duty, sync, noise, accent, slide, voices });
  st.current = { duty, sync, noise, accent, slide, voices };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const sparkles: Array<{ x: number; y: number; life: number; vx: number; vy: number }> = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 20) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 4, W * 0.5, H * 0.5, W * 0.65);
      bg.addColorStop(0, "rgba(10,30,22,0.92)");
      bg.addColorStop(0.7, "rgba(4,14,10,0.95)");
      bg.addColorStop(1, "rgba(0,8,4,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Retro 8-bit grid with glow
      ctx.strokeStyle = `rgba(110,231,168,${0.1 + p.accent * 0.08})`;
      ctx.lineWidth = 1;
      const gridSize = 12;
      for (let x = 0; x < W; x += gridSize) { 
        ctx.beginPath(); 
        ctx.moveTo(x, 0); 
        ctx.lineTo(x, H); 
        ctx.stroke(); 
      }
      for (let y = 0; y < H; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      
      // Grid intersections glow
      for (let x = 0; x < W; x += gridSize * 2) {
        for (let y = 0; y < H; y += gridSize * 2) {
          const pulse = (Math.sin(t / 200 + x * 0.05 + y * 0.03) * 0.5 + 0.5);
          ctx.fillStyle = `rgba(110,231,168,${0.08 * pulse})`;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }

      // PWM square wave with pixel-perfect edges
      const mid = H * 0.42;
      const amp = H * 0.22 * (1 + p.accent * 0.35);
      const cycles = 4;
      const duty = clamp01(p.duty);
      
      ctx.strokeStyle = "rgba(110,231,168,0.9)";
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 10 + p.accent * 8;
      ctx.shadowColor = "rgba(110,231,168,0.7)";
      ctx.beginPath();
      let first = true;
      for (let i = 0; i <= W; i++) {
        const u = (i / W) * cycles + t * 0.0012;
        const phase = u % 1;
        const y = mid - (phase < duty ? amp : -amp);
        if (first) { ctx.moveTo(i, y); first = false; }
        else ctx.lineTo(i, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      // Waveform fill glow
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i <= W; i++) {
        const u = (i / W) * cycles + t * 0.0012;
        const phase = u % 1;
        const y = mid - (phase < duty ? amp : -amp);
        ctx.lineTo(i, y);
      }
      ctx.lineTo(W, mid);
      ctx.closePath();
      const waveGrad = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      waveGrad.addColorStop(0, "rgba(110,231,168,0.18)");
      waveGrad.addColorStop(0.5, "rgba(110,231,168,0.08)");
      waveGrad.addColorStop(1, "rgba(110,231,168,0.18)");
      ctx.fillStyle = waveGrad;
      ctx.fill();

      // Hard sync reset ticks with glow
      if (p.sync) {
        ctx.strokeStyle = "rgba(255,180,120,0.85)";
        ctx.lineWidth = 2;
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(255,180,120,0.7)";
        for (let c = 0; c < cycles; c++) {
          const x = ((c - (t * 0.0012) % 1) / cycles) * W;
          if (x < 0 || x > W) continue;
          ctx.beginPath();
          ctx.moveTo(x, mid - amp - 6);
          ctx.lineTo(x, mid + amp + 6);
          ctx.stroke();
          
          ctx.fillStyle = "rgba(255,200,140,0.7)";
          ctx.beginPath();
          ctx.arc(x, mid - amp - 6, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      // Noise grit band with texture
      if (p.noise !== "white") {
        const hold = p.noise === "nes" ? 6 : p.noise === "gb" ? 3 : 2;
        const noiseY = H * 0.78;
        
        ctx.fillStyle = "rgba(110,231,168,0.15)";
        ctx.fillRect(0, noiseY - 10, W, 20);
        
        ctx.fillStyle = "rgba(110,231,168,0.5)";
        ctx.shadowBlur = 6;
        ctx.shadowColor = "rgba(110,231,168,0.4)";
        for (let x = 0; x < W; x += hold) {
          const bit = Math.sin(x * 0.4 + t * 0.01) > 0 ? 1 : -1;
          const y = noiseY + bit * 7;
          ctx.fillRect(x, y, hold - 1, 3);
        }
        ctx.shadowBlur = 0;
        
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(110,231,168,0.45)";
        ctx.textAlign = "right";
        ctx.fillText(p.noise.toUpperCase(), W - 4, noiseY - 14);
      }

      // Spawn accent sparkles on high square transitions
      if (p.accent > 0.15 && Math.random() < 0.15 * p.accent) {
        const u = Math.random();
        const phase = ((u * cycles + t * 0.0012) % 1);
        if (Math.abs(phase - duty) < 0.05 || phase < 0.05) {
          sparkles.push({
            x: u * W,
            y: mid - (phase < duty ? amp : -amp),
            life: 1,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2 - 1
          });
        }
      }

      // Sparkle particles
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i];
        sp.life -= 0.025;
        if (sp.life <= 0) {
          sparkles.splice(i, 1);
          continue;
        }
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.1;
        
        const alpha = sp.life * 0.8;
        const sg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 4);
        sg.addColorStop(0, `rgba(180,255,200,${alpha})`);
        sg.addColorStop(0.5, `rgba(110,231,168,${alpha * 0.6})`);
        sg.addColorStop(1, "rgba(110,231,168,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Voice limit indicator bars
      if (p.voices > 0 && p.voices < 8) {
        const barW = 3;
        const barH = 8;
        const barGap = 2;
        const totalW = p.voices * (barW + barGap);
        let startX = W - 10 - totalW;
        for (let v = 0; v < p.voices; v++) {
          const pulse = (Math.sin(t / 150 + v * 0.5) * 0.5 + 0.5);
          ctx.fillStyle = `rgba(110,231,168,${0.5 + pulse * 0.4})`;
          ctx.shadowBlur = 4 * pulse;
          ctx.shadowColor = "rgba(110,231,168,0.6)";
          ctx.fillRect(startX + v * (barW + barGap), 8, barW, barH);
          ctx.shadowBlur = 0;
        }
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(110,231,168,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(`PWM ${Math.round(duty * 100)}%`, 10, H - 8);
      ctx.textAlign = "right";
      const tags = [p.sync ? "SYNC" : null, p.slide ? "SLIDE" : null, p.voices > 0 ? `V${Math.round(p.voices)}` : null].filter(Boolean);
      ctx.fillText(tags.length ? tags.join(" · ") : "CHIP", W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(110,231,168,0.35)" height={88} chrome="scope">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Organic pitch wander — drifting unstable needles with ECG life signs and variance pulses. */
export function AnalogLifeStageViz() {
  const drift = useFireCommandStore((s) => s.patch.drift);
  const rate = useFireCommandStore((s) => s.patch.driftRate);
  const instab = useFireCommandStore((s) => s.patch.voiceInstability);
  const tune = useFireCommandStore((s) => s.patch.tuneVariance);
  const env = useFireCommandStore((s) => s.patch.envVariance);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ drift, rate, instab, tune, env });
  st.current = { drift, rate, instab, tune, env };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const traces = [0, 0, 0, 0, 0];
    const targets = [0, 0, 0, 0, 0];
    const pulseParticles: Array<{ x: number; y: number; life: number; size: number }> = [];
    
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const p = st.current;
      const life = Math.max(p.drift, p.instab, p.tune, p.env);
      
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 8, W * 0.5, H * 0.5, W * 0.65);
      bg.addColorStop(0, `rgba(60,45,18,${0.6 + life * 0.25})`);
      bg.addColorStop(0.5, `rgba(25,20,10,${0.75 + life * 0.15})`);
      bg.addColorStop(1, "rgba(6,5,2,0.95)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // ECG grid lines
      ctx.strokeStyle = `rgba(212,176,106,${0.12 + life * 0.1})`;
      ctx.lineWidth = 1;
      const gridSpacing = 16;
      for (let x = 0; x < W; x += gridSpacing) {
        const heavy = x % (gridSpacing * 5) === 0;
        ctx.globalAlpha = heavy ? 0.25 : 0.12;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += gridSpacing) {
        const heavy = y % (gridSpacing * 3) === 0;
        ctx.globalAlpha = heavy ? 0.25 : 0.12;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Center reference line
      ctx.strokeStyle = `rgba(212,176,106,${0.2 + life * 0.15})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5);
      ctx.lineTo(W, H * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      const amt = Math.max(0.08, p.drift * 0.7 + p.instab * 0.9 + p.tune * 0.4);
      const spd = 0.02 + p.rate * 0.08;
      for (let i = 0; i < traces.length; i++) {
        if (Math.random() < 0.04 + p.rate * 0.08) targets[i] = (Math.random() * 2 - 1) * amt;
        traces[i] += (targets[i] - traces[i]) * spd;
      }

      // Draw ECG-style traces with glow
      for (let i = 0; i < traces.length; i++) {
        const y0 = H * (0.22 + i * 0.12);
        const traceLife = 0.25 + life * 0.55 - i * 0.04;
        
        const traceGrad = ctx.createLinearGradient(0, y0 - 20, 0, y0 + 20);
        traceGrad.addColorStop(0, `rgba(212,176,106,${traceLife * 0.15})`);
        traceGrad.addColorStop(0.5, `rgba(212,176,106,${traceLife * 0.25})`);
        traceGrad.addColorStop(1, `rgba(212,176,106,${traceLife * 0.15})`);
        
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= W; x += 3) {
          const wob = Math.sin(x * 0.02 + t * 0.002 * (1 + p.rate) + i) * traces[i] * H * 0.35;
          const instabJitter = p.instab > 0.2 ? (Math.random() - 0.5) * p.instab * 3 : 0;
          const y = y0 + wob + instabJitter;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, y0);
        ctx.closePath();
        ctx.fillStyle = traceGrad;
        ctx.fill();
        
        ctx.strokeStyle = `rgba(212,176,106,${traceLife})`;
        ctx.lineWidth = i === 0 ? 2 : 1.3;
        ctx.shadowBlur = i === 0 ? 10 + life * 8 : 6 + life * 4;
        ctx.shadowColor = "rgba(212,176,106,0.6)";
        ctx.beginPath();
        for (let x = 0; x <= W; x += 3) {
          const wob = Math.sin(x * 0.02 + t * 0.002 * (1 + p.rate) + i) * traces[i] * H * 0.35;
          const instabJitter = p.instab > 0.2 ? (Math.random() - 0.5) * p.instab * 3 : 0;
          const y = y0 + wob + instabJitter;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Trace label
        if (i === 0 || i === traces.length - 1) {
          ctx.fillStyle = `rgba(212,176,106,${0.4 + life * 0.3})`;
          ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(i === 0 ? "L" : "R", 4, y0 + 3);
        }
      }

      // Env variance pulse indicator with particles
      if (p.env > 0.02) {
        const pulse = (Math.sin(t * 0.004) * 0.5 + 0.5) * p.env;
        const pulseW = W * pulse;
        const pulseY = H * 0.82;
        
        const pulseGrad = ctx.createLinearGradient(0, pulseY, pulseW, pulseY);
        pulseGrad.addColorStop(0, `rgba(212,176,106,${0.12 + pulse * 0.25})`);
        pulseGrad.addColorStop(0.7, `rgba(232,196,126,${0.18 + pulse * 0.35})`);
        pulseGrad.addColorStop(1, `rgba(252,216,146,${0.25 + pulse * 0.45})`);
        ctx.fillStyle = pulseGrad;
        ctx.shadowBlur = 8 + pulse * 12;
        ctx.shadowColor = "rgba(232,196,126,0.5)";
        ctx.fillRect(0, pulseY, pulseW, 5);
        ctx.shadowBlur = 0;
        
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = `rgba(212,176,106,${0.5 + pulse * 0.4})`;
        ctx.textAlign = "left";
        ctx.fillText("ENV", 4, pulseY - 2);
        
        if (Math.random() < 0.12 * p.env && pulse > 0.5) {
          pulseParticles.push({
            x: pulseW - 5 + Math.random() * 10,
            y: pulseY + 2,
            life: 1,
            size: 2 + Math.random() * 2
          });
        }
      }

      // Pulse particles
      for (let i = pulseParticles.length - 1; i >= 0; i--) {
        const pp = pulseParticles[i];
        pp.life -= 0.025;
        if (pp.life <= 0) {
          pulseParticles.splice(i, 1);
          continue;
        }
        pp.y -= 0.8;
        
        const alpha = pp.life * 0.7;
        const pg = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, pp.size * 2);
        pg.addColorStop(0, `rgba(232,196,126,${alpha})`);
        pg.addColorStop(0.6, `rgba(212,176,106,${alpha * 0.5})`);
        pg.addColorStop(1, "rgba(212,176,106,0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Variance indicator needles
      if (life > 0.05) {
        const needleX = W - 32;
        const needleY = 20;
        const needleR = 14;
        
        ctx.strokeStyle = `rgba(212,176,106,${0.25 + life * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(needleX, needleY, needleR, 0, Math.PI * 2);
        ctx.stroke();
        
        const needleAng = -Math.PI * 0.75 + (Math.PI * 1.5 * amt);
        ctx.strokeStyle = `rgba(232,196,126,${0.6 + life * 0.4})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(232,196,126,0.6)";
        ctx.beginPath();
        ctx.moveTo(needleX, needleY);
        ctx.lineTo(
          needleX + Math.cos(needleAng) * (needleR - 2),
          needleY + Math.sin(needleAng) * (needleR - 2)
        );
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = `rgba(252,216,146,${0.7 + life * 0.3})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = "rgba(252,216,146,0.7)";
        ctx.beginPath();
        ctx.arc(needleX, needleY, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(212,176,106,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(life < 0.02 ? "STABLE" : "ALIVE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`Δ${Math.round(amt * 100)}¢`, W - 10, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(212,176,106,0.35)" height={88} chrome="rails">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}
