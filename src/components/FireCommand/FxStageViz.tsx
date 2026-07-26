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

      // Heat shimmer when forging
      if (d > 0.08) {
        for (let i = 0; i < 10; i++) {
          const sx = x0 + ((t / 30 + i * 41) % usable);
          const sy = mid + Math.sin(sx * 0.08 + t / 120 + i) * amp * 0.7;
          ctx.fillStyle = `rgba(255,140,80,${0.12 + d * 0.25})`;
          ctx.fillRect(sx, sy, 1.5, 1.5);
        }
      }

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,160,110,0.65)";
      ctx.textAlign = "center";
      ctx.fillText(
        d < 0.02 ? `${m.toUpperCase()} · CLEAN` : `${m.toUpperCase()} · MAGMA FORGE`,
        W * 0.5,
        H - 8,
      );
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

      // Comb floor as filled valleys (not just a stroke)
      const floorY = H - PAD;
      ctx.beginPath();
      ctx.moveTo(PAD, floorY);
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
        ctx.lineTo(px, py);
      }
      ctx.lineTo(W - PAD, floorY);
      ctx.closePath();
      const valley = ctx.createLinearGradient(0, PAD, 0, floorY);
      valley.addColorStop(0, `rgba(224,112,255,${0.28 + mx * 0.25})`);
      valley.addColorStop(0.55, `rgba(160,80,220,${0.1 + mx * 0.08})`);
      valley.addColorStop(1, "rgba(40,10,60,0.02)");
      ctx.fillStyle = valley;
      ctx.fill();

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
      ctx.lineWidth = 2;
      ctx.shadowBlur = 12 * mx;
      ctx.shadowColor = MAGENTA;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Crawling notch markers
      for (let n = 0; n < notches; n++) {
        const center = (n + 0.5) / notches + (sweep - 0.5) * 0.35;
        const x = PAD + center * (W - PAD * 2);
        ctx.strokeStyle = `rgba(98,182,255,${0.3 + mx * 0.45})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 6);
        ctx.lineTo(x, H - 10);
        ctx.stroke();
        ctx.fillStyle = `rgba(200,230,255,${0.45 + mx * 0.4})`;
        ctx.beginPath();
        ctx.arc(x, 10, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Center badge
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(224,112,255,${0.45 + mx * 0.35})`;
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
      const amp = H * 0.22;
      // L / C / R spatial stack — vertical offsets so chorus reads as ensemble sheets
      const voices = [
        { det: -1.0, yOff: -14, alpha: 0.45 + mx * 0.35, color: TEAL, label: "L" },
        { det: -0.5, yOff: -7, alpha: 0.35 + mx * 0.25, color: "rgba(92,224,200,0.75)", label: "" },
        { det: 0, yOff: 0, alpha: 0.55, color: "rgba(255,255,255,0.55)", label: "C" },
        { det: 0.5, yOff: 7, alpha: 0.35 + mx * 0.25, color: "rgba(98,182,255,0.75)", label: "" },
        { det: 1.0, yOff: 14, alpha: 0.45 + mx * 0.35, color: ICE, label: "R" },
      ];

      for (const v of voices) {
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const u = i / 100;
          const mod = Math.sin(t / 1000 * r * 2 + v.det) * d * 0.4;
          const y = Math.sin(u * Math.PI * 3 + t / 400 + v.det * 0.8 + mod * 4);
          const px = PAD + u * (W - PAD * 2);
          const py = mid + v.yOff - y * amp * (0.75 + Math.abs(v.det) * 0.1);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = v.color;
        ctx.globalAlpha = v.alpha;
        ctx.lineWidth = v.det === 0 ? 1.4 : 1.7;
        ctx.shadowBlur = v.det === 0 ? 0 : 7 * mx;
        ctx.shadowColor = TEAL;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        if (v.label) {
          ctx.fillStyle = v.color;
          ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(v.label, 8, mid + v.yOff + 3);
        }
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(92,224,200,0.55)";
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

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, `rgba(98,182,255,${0.1 + mx * 0.1})`);
      bg.addColorStop(0.5, "rgba(4,8,16,0.72)");
      bg.addColorStop(1, `rgba(98,182,255,${0.1 + mx * 0.1})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Dual tape lanes — L top / R bottom
      const laneL = H * 0.32;
      const laneR = H * 0.68;
      const pad = 14;
      const usable = W - pad * 2;

      ctx.strokeStyle = "rgba(98,182,255,0.14)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(pad, laneL); ctx.lineTo(W - pad, laneL);
      ctx.moveTo(pad, laneR); ctx.lineTo(W - pad, laneR);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(150,210,255,0.45)";
      ctx.textAlign = "left";
      ctx.fillText("L", 4, laneL + 3);
      ctx.fillText("R", 4, laneR + 3);

      const echoes = 1 + Math.round(fb * 7);
      const spacing = 0.08 + tm * 0.14;
      const phase = (t / (500 + tm * 900)) % 1;

      for (let i = 0; i < echoes; i++) {
        const life = Math.pow(fb, i) * (0.35 + mx * 0.65);
        const u = (phase + i * spacing) % 1;
        const isL = i % 2 === 0;
        const y = isL ? laneL : laneR;
        const x = pad + u * usable;
        const r = 3 + life * 8;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
        g.addColorStop(0, `rgba(220,240,255,${0.85 * life})`);
        g.addColorStop(0.45, `rgba(98,182,255,${0.5 * life})`);
        g.addColorStop(1, "rgba(98,182,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.fill();

        // Decay wake behind blip
        ctx.strokeStyle = `rgba(98,182,255,${0.2 * life})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.max(pad, x - 18 - i * 4), y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Inject pulse at start of both lanes
      const pulse = 0.55 + 0.45 * Math.sin(t / 180);
      ctx.fillStyle = `rgba(255,255,255,${0.45 * pulse * (0.4 + mx)})`;
      ctx.beginPath();
      ctx.arc(pad + 2, laneL, 2.5, 0, Math.PI * 2);
      ctx.arc(pad + 2, laneR, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(150,210,255,0.55)";
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
        // Impulse spike at birth
        if (age < 0.12) {
          const spikeA = (1 - age / 0.12) * (0.5 + mx * 0.4);
          ctx.strokeStyle = `rgba(230,235,255,${spikeA})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ring.x, ring.y - 14);
          ctx.lineTo(ring.x, ring.y + 4);
          ctx.stroke();
        }
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
    <StageFrame wrapRef={wrapRef} border="rgba(168,180,255,0.3)" height={88} chrome="bloom">
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
        ctx.fillText(W < 340 ? "SELECT A MODE" : "SELECT A MODE TO ARM THE FFT BAY", W / 2, H / 2 + 4);
        return;
      }

      // Analyzer grid (tech bay)
      const PAD = 8;
      const bw = (W - PAD * 2) / N;
      const sec = t / 1000;
      ctx.strokeStyle = "rgba(201,139,255,0.06)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = PAD + ((H - PAD * 2) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(W - PAD, y);
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
