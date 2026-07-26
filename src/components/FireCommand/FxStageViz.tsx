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
      const cssW = Math.max(200, Math.floor(wrap.clientWidth));
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

/** Magma forge — living sine through the transfer curve. */
export function DriveStageViz() {
  const drive = useFireCommandStore((s) => s.patch.drive);
  const mode = useFireCommandStore((s) => s.patch.driveMode);
  const crush = useFireCommandStore((s) => s.patch.crush);
  const punch = useFireCommandStore((s) => s.patch.punch);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 100 });
  const st = useRef({ drive, mode, crush, punch });
  st.current = { drive, mode, crush, punch };
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
      const { drive: d, mode: m, crush: c, punch: p } = st.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createRadialGradient(W * 0.35, H * 0.4, 4, W * 0.5, H * 0.5, W * 0.55);
      bg.addColorStop(0, `rgba(255,106,61,${0.08 + d * 0.12})`);
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

      // Living sine → crushed (right)
      const x0 = W * 0.55;
      const usable = W - x0 - 12;
      const mid = H * 0.5;
      const amp = H * 0.28 * (0.55 + p * 0.45);
      const phase = t / 280;

      // Clean input (ghost)
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        const x = Math.sin(u * Math.PI * 4 + phase);
        const px = x0 + u * usable;
        const py = mid - x * amp * 0.55;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Driven output
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
        const py = mid - x * amp;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = 1.8;
      ctx.shadowBlur = 6 + d * 8;
      ctx.shadowColor = FIRE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,160,110,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(m.toUpperCase(), 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(d < 0.02 ? "CLEAN" : "FORGE", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,106,61,0.22)" height={100}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Sweep notches — allpass comb crawling across the spectrum. */
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

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { rate: r, depth: d, mix: mx } = st.current;
      ctx.clearRect(0, 0, W, H);

      const hue = 280 + Math.sin(t / 3000) * 20;
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `hsla(${hue}, 70%, 45%, ${0.06 + mx * 0.1})`);
      bg.addColorStop(0.5, "rgba(8,4,14,0.55)");
      bg.addColorStop(1, `hsla(${hue - 40}, 60%, 40%, 0.05)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const sweep = (Math.sin(t / 1000 * r * 2) * 0.5 + 0.5) * d;
      const notches = 4;
      const PAD = 10;

      // Spectrum floor
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        let y = 0.55 + 0.2 * Math.sin(u * 9 + t / 800);
        for (let n = 0; n < notches; n++) {
          const center = (n + 0.5) / notches + (sweep - 0.5) * 0.35;
          const dist = Math.abs(u - center);
          y -= Math.exp(-dist * dist * 180) * (0.35 + d * 0.35) * (0.4 + mx * 0.6);
        }
        y = Math.max(0.08, y);
        const px = PAD + u * (W - PAD * 2);
        const py = PAD + (1 - y) * (H - PAD * 2);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10 * mx;
      ctx.shadowColor = MAGENTA;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Notch markers
      for (let n = 0; n < notches; n++) {
        const center = (n + 0.5) / notches + (sweep - 0.5) * 0.35;
        const x = PAD + center * (W - PAD * 2);
        ctx.strokeStyle = `rgba(98,182,255,${0.25 + mx * 0.4})`;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, H - 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(224,112,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("SWEEP", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(mx < 0.02 ? "BYPASS" : "PHASE", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(224,112,255,0.22)" height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Ensemble shimmer — detuned copies breathing together. */
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

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { rate: r, depth: d, mix: mx } = st.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(92,224,200,${0.06 + mx * 0.1})`);
      bg.addColorStop(0.5, "rgba(4,14,12,0.55)");
      bg.addColorStop(1, "rgba(98,182,255,0.05)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const PAD = 10;
      const mid = H * 0.5;
      const amp = H * 0.28;
      const voices = [
        { det: 0, alpha: 0.35, color: "rgba(255,255,255,0.35)" },
        { det: -1, alpha: 0.55 + mx * 0.35, color: TEAL },
        { det: 1, alpha: 0.55 + mx * 0.35, color: ICE },
        { det: -0.5, alpha: 0.3 + mx * 0.3, color: "rgba(92,224,200,0.7)" },
        { det: 0.5, alpha: 0.3 + mx * 0.3, color: "rgba(98,182,255,0.7)" },
      ];

      for (const v of voices) {
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const u = i / 100;
          const mod = Math.sin(t / 1000 * r * 2 + v.det) * d * 0.35;
          const y = Math.sin(u * Math.PI * 3 + t / 400 + v.det * 0.8 + mod * 4);
          const px = PAD + u * (W - PAD * 2);
          const py = mid - y * amp * (0.7 + Math.abs(v.det) * 0.15);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = v.color;
        ctx.globalAlpha = v.alpha;
        ctx.lineWidth = v.det === 0 ? 1.2 : 1.6;
        ctx.shadowBlur = v.det === 0 ? 0 : 6 * mx;
        ctx.shadowColor = TEAL;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(92,224,200,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("ENSEMBLE", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(mx < 0.02 ? "DRY" : `${Math.round(mx * 100)}% WET`, W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(92,224,200,0.22)" height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Ping-pong corridor — echoes bouncing L↔R with feedback decay. */
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

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { time: tm, fbk: fb, mix: mx } = st.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, `rgba(98,182,255,${0.08 + mx * 0.1})`);
      bg.addColorStop(0.5, "rgba(4,8,16,0.55)");
      bg.addColorStop(1, `rgba(98,182,255,${0.08 + mx * 0.1})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Corridor walls
      ctx.strokeStyle = "rgba(98,182,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(W * 0.5, 6); ctx.lineTo(W * 0.5, H - 6);
      ctx.stroke();

      const midY = H * 0.5;
      const echoes = 1 + Math.round(fb * 7);
      const spacing = 18 + tm * 40;
      const phase = (t / (400 + tm * 800)) % 1;

      for (let i = 0; i < echoes; i++) {
        const life = Math.pow(fb, i);
        const side = i % 2 === 0 ? -1 : 1;
        const x = W * 0.5 + side * (20 + i * spacing * 0.55);
        const y = midY + Math.sin(phase * Math.PI * 2 + i * 0.7) * (10 + i * 2);
        const r = 4 + life * 10 * (0.5 + mx * 0.5);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
        g.addColorStop(0, `rgba(200,230,255,${0.7 * life * (0.4 + mx)})`);
        g.addColorStop(0.4, `rgba(98,182,255,${0.45 * life})`);
        g.addColorStop(1, "rgba(98,182,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Trail toward center
        ctx.strokeStyle = `rgba(98,182,255,${0.15 * life})`;
        ctx.beginPath();
        ctx.moveTo(W * 0.5, midY);
        ctx.quadraticCurveTo(x, midY - side * 20, x, y);
        ctx.stroke();
      }

      // Source pulse
      const pulse = 0.6 + 0.4 * Math.sin(t / 200);
      ctx.fillStyle = `rgba(255,255,255,${0.5 * pulse})`;
      ctx.beginPath();
      ctx.arc(W * 0.5, midY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(150,210,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("L", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText("R", W - 10, H - 8);
      ctx.textAlign = "center";
      ctx.fillText(mx < 0.02 ? "SILENT" : "PING-PONG", W * 0.5, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(98,182,255,0.22)" height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Room bloom — expanding impulse rings sized by reverb Size. */
export function ReverbStageViz() {
  const size = useFireCommandStore((s) => s.patch.reverbSize);
  const mix = useFireCommandStore((s) => s.patch.reverbMix);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 320, h: 88 });
  const st = useRef({ size, mix });
  st.current = { size, mix };
  useHiDpiCanvas(wrapRef, canvasRef, 88, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const rings: { birth: number; x: number; y: number }[] = [];
    let nextSpawn = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { size: sz, mix: mx } = st.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createRadialGradient(W * 0.5, H * 0.55, 4, W * 0.5, H * 0.5, W * 0.5);
      bg.addColorStop(0, `rgba(168,180,255,${0.08 + mx * 0.12})`);
      bg.addColorStop(0.55, "rgba(6,6,14,0.55)");
      bg.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Soft room haze
      const haze = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, 20 + sz * 18);
      haze.addColorStop(0, `rgba(168,180,255,${0.12 * mx})`);
      haze.addColorStop(1, "rgba(168,180,255,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, W, H);

      const spawnEvery = 280 + (6 - Math.min(6, sz)) * 80;
      if (t > nextSpawn && mx > 0.02) {
        rings.push({
          birth: t,
          x: W * 0.5 + (Math.random() - 0.5) * 30,
          y: H * 0.55 + (Math.random() - 0.5) * 10,
        });
        nextSpawn = t + spawnEvery;
        if (rings.length > 8) rings.shift();
      }

      const lifeMs = 600 + sz * 400;
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        const age = (t - ring.birth) / lifeMs;
        if (age > 1) { rings.splice(i, 1); continue; }
        const rad = 6 + age * (18 + sz * 22);
        const alpha = (1 - age) * (0.35 + mx * 0.5);
        ctx.strokeStyle = `rgba(168,180,255,${alpha})`;
        ctx.lineWidth = 1.5 * (1 - age * 0.5);
        ctx.beginPath();
        ctx.ellipse(ring.x, ring.y, rad * 1.6, rad * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Secondary denser early reflection
        if (age < 0.4) {
          ctx.strokeStyle = `rgba(200,210,255,${alpha * 0.6})`;
          ctx.beginPath();
          ctx.ellipse(ring.x, ring.y, rad * 0.7, rad * 0.25, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Center spark
      ctx.fillStyle = `rgba(220,230,255,${0.4 + mx * 0.4})`;
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.55, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(168,180,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(`${sz.toFixed(1)}s`, 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(mx < 0.02 ? "DRY" : "BLOOM", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(168,180,255,0.22)" height={88}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Violet FFT bay — mode-aware spectral personality. */
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

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { mode: m, amount: a, mix: mx } = st.current as {
        mode: SpectralMode; amount: number; mix: number;
      };
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgba(201,139,255,${0.07 + mx * 0.1})`);
      bg.addColorStop(0.5, "rgba(10,4,16,0.55)");
      bg.addColorStop(1, `rgba(98,182,255,${0.04})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.1, W * 0.5, H * 0.5, W * 0.55);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      if (m === "off") {
        ctx.fillStyle = "rgba(201,139,255,0.35)";
        ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("SELECT A MODE TO ARM THE FFT BAY", W / 2, H / 2 + 4);
        return;
      }

      const PAD = 8;
      const bw = (W - PAD * 2) / N;
      const sec = t / 1000;

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
          // Hold blends toward freeze
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
        const g = ctx.createLinearGradient(0, PAD + (H - PAD * 2 - barH), 0, H - PAD);
        g.addColorStop(0, `hsla(${hue}, 90%, 75%, ${dim ? 0.12 : 0.55 + v * 0.4})`);
        g.addColorStop(1, `hsla(${hue}, 80%, 45%, ${dim ? 0.05 : 0.15})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + 0.5, PAD + (H - PAD * 2 - barH), Math.max(1.5, bw - 1.5), barH);
      }

      if (m === "gate") {
        const thr = a * 0.5;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(PAD, PAD + (1 - thr) * (H - PAD * 2));
        ctx.lineTo(W - PAD, PAD + (1 - thr) * (H - PAD * 2));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Mix wetness edge wash
      if (mx > 0.05) {
        const eg = ctx.createLinearGradient(0, 0, W, 0);
        eg.addColorStop(0, `rgba(201,139,255,${mx * 0.15})`);
        eg.addColorStop(0.5, "rgba(201,139,255,0)");
        eg.addColorStop(1, `rgba(201,139,255,${mx * 0.15})`);
        ctx.fillStyle = eg;
        ctx.fillRect(0, 0, W, 2);
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(201,139,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText(m.toUpperCase(), 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText("FFT BAY", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(201,139,255,0.22)" height={100}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

const GOLD = "#ffcf5c";

/** Spectral Warp — gold harmonic lattice reshaped by Stretch / Tilt / Comb. */
export function WarpStageViz() {
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 400, h: 118 });
  const st = useRef({ stretch, tilt, comb });
  st.current = { stretch, tilt, comb };
  useHiDpiCanvas(wrapRef, canvasRef, 118, sizeRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const { stretch: S, tilt: T, comb: C } = st.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,207,92,0.10)");
      bg.addColorStop(0.5, "rgba(14,10,4,0.55)");
      bg.addColorStop(1, "rgba(255,106,61,0.05)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Soft harmonic guide lines
      ctx.strokeStyle = "rgba(255,207,92,0.06)";
      for (let i = 1; i <= 5; i++) {
        const y = (H / 6) * i;
        ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
      }

      const N = 32;
      const PAD = 14;
      const usableW = W - PAD * 2;
      const usableH = H - 28;
      const breath = 0.92 + 0.08 * Math.sin(t / 900);

      // Contour ribbon through tips
      ctx.beginPath();
      for (let n = 1; n <= N; n++) {
        let amp = 1 / n;
        amp *= Math.pow(n / 8, -T * 1.25);
        if (n % 2 === 0) amp *= 1 - C * 0.9;
        amp = Math.min(1, Math.max(0.02, amp)) * breath;
        const posN = n * (1 + S * 0.65 * ((n - 1) / N));
        const x = PAD + ((posN - 1) / (N * 1.55)) * usableW;
        const y = 12 + (1 - amp) * usableH;
        if (n === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(255,207,92,${0.35 + Math.abs(S) * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = GOLD;
      ctx.stroke();
      ctx.shadowBlur = 0;

      for (let n = 1; n <= N; n++) {
        let amp = 1 / n;
        amp *= Math.pow(n / 8, -T * 1.25);
        if (n % 2 === 0) amp *= 1 - C * 0.9;
        amp = Math.min(1, Math.max(0.02, amp)) * breath;
        const posN = n * (1 + S * 0.65 * ((n - 1) / N));
        const x = PAD + ((posN - 1) / (N * 1.55)) * usableW;
        if (x > W - PAD) continue;
        const barH = amp * usableH;
        const y = 12 + usableH - barH;
        const even = n % 2 === 0;
        const g = ctx.createLinearGradient(0, y, 0, y + barH);
        g.addColorStop(0, even ? `rgba(255,180,80,${0.55})` : `rgba(255,220,120,${0.9})`);
        g.addColorStop(1, "rgba(255,207,92,0.05)");
        ctx.fillStyle = g;
        const bw = Math.max(2.5, Math.min(7, usableW / (N * 1.2)));
        ctx.fillRect(x - bw / 2, y, bw, barH);

        // Tip glow
        ctx.fillStyle = even && C > 0.2 ? `rgba(255,140,60,${0.4})` : GOLD;
        ctx.beginPath();
        ctx.arc(x, y, even ? 1.8 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,207,92,0.5)";
      ctx.textAlign = "left";
      ctx.fillText("HARMONIC LATTICE", 10, H - 8);
      ctx.textAlign = "right";
      const bits = [
        Math.abs(S) > 0.02 ? (S > 0 ? "STRETCH+" : "STRETCH−") : null,
        Math.abs(T) > 0.02 ? (T > 0 ? "BRIGHT" : "DARK") : null,
        C > 0.05 ? "COMB" : null,
      ].filter(Boolean);
      ctx.fillText(bits.length ? bits.join(" · ") : "NEUTRAL", W - 10, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <StageFrame wrapRef={wrapRef} border="rgba(255,207,92,0.32)" height={118}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}
