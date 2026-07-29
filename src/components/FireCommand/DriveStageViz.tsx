/**
 * Drive — Shape Crucible stage visualizer.
 * Drive · mode · bias · symmetry · crush · tone (Signal Path FX · FC.drive).
 * Drag: Drive ↔ · Left zone Bias ↕ · Right zone Crush ↕. Bottom: Tone. Double-click: cycle mode.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { DriveMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.drive;
const C_DEEP = bandShade(FC.fx, 0.18);
const C_MID = bandShade(FC.fx, 0.4);
const C_HOT = bandShade(FC.fx, 0.62);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_DRV = bandShade(FC.fx, 0.5);
const C_CRUSH = bandShade(FC.fx, 0.72);
const C_TONE = bandShade(FC.fx, 0.85);

const TONE_MIN = 1000;
const TONE_MAX = 18000;

const MODE_CYCLE: DriveMode[] = ["soft", "tube", "fold", "hard", "fuzz"];

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

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

function xfer(xIn: number, mode: DriveMode, drive: number, bias = 0, symmetry = 0): number {
  const b = clamp(bias, -1, 1) * 0.35;
  const sym = clamp(symmetry, -1, 1);
  const x = xIn + b;
  if (drive <= 0.001) return clamp(xIn, -1.2, 1.2);
  switch (mode) {
    case "tube": {
      const k = 1 + drive * 7;
      let y = x >= 0 ? Math.tanh(k * x) : Math.tanh(k * (0.55 + sym * 0.25) * x);
      y /= Math.tanh(k) || 1;
      return clamp(y, -1.2, 1.2);
    }
    case "fold": {
      const g = 1 + drive * (5 + Math.abs(sym) * 2);
      let y = Math.sin(x * g * Math.PI * 0.5);
      if (sym > 0.2) y = Math.sin(y * Math.PI * (0.5 + sym * 0.4));
      return clamp(y, -1.2, 1.2);
    }
    case "hard": {
      const g = 1 + drive * 9;
      const pos = clamp(x * g * (1 + sym * 0.3), -1, 1);
      const neg = clamp(x * g * (1 - sym * 0.3), -1, 1);
      return x >= 0 ? pos : neg;
    }
    case "fuzz": {
      const k = 1 + drive * 22;
      let y = Math.tanh(k * x);
      if (sym > 0.35 && x > 0) y = Math.abs(y);
      return clamp(y, -1.2, 1.2);
    }
    default: {
      const k = 1 + drive * 8;
      return clamp(Math.tanh(k * x) / (Math.tanh(k) || 1), -1.2, 1.2);
    }
  }
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

type DragMode = "xy" | "tone" | null;
type VertTarget = "bias" | "crush";

export function DriveStageViz() {
  const drive = useFireCommandStore((s) => s.patch.drive) ?? 0;
  const mode = (useFireCommandStore((s) => s.patch.driveMode) ?? "soft") as DriveMode;
  const crush = useFireCommandStore((s) => s.patch.crush) ?? 0;
  const tone = useFireCommandStore((s) => s.patch.tone) ?? 15000;
  const bias = useFireCommandStore((s) => s.patch.driveBias) ?? 0;
  const symmetry = useFireCommandStore((s) => s.patch.driveSymmetry) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const vertRef = useRef<VertTarget>("crush");
  const prevKey = useRef("");
  const st = useRef({ drive, mode, crush, tone, bias, symmetry });
  st.current = { drive, mode, crush, tone, bias, symmetry };

  const live = drive > 0.02 || crush > 0.02 || Math.abs(bias) > 0.02;

  useEffect(() => {
    const key = `${drive.toFixed(3)}|${mode}|${crush.toFixed(3)}|${tone.toFixed(0)}|${bias.toFixed(3)}|${symmetry.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [drive, mode, crush, tone, bias, symmetry]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("drive", Math.round(x * 1000) / 1000);
      if (vertRef.current === "bias") {
        setParam("driveBias", Math.round((1 - y * 2) * 1000) / 1000);
      } else {
        setParam("crush", Math.round((1 - y) * 1000) / 1000);
      }
    },
    [setParam],
  );

  const applyTone = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("tone", Math.round(logLerp(x, TONE_MIN, TONE_MAX)));
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "tone";
        wrap.setPointerCapture(e.pointerId);
        applyTone(e.clientX);
        return;
      }
      const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      vertRef.current = x < 0.42 ? "bias" : "crush";
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyTone],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "tone") applyTone(e.clientX);
    },
    [applyXy, applyTone],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const i = MODE_CYCLE.indexOf(st.current.mode);
    const next = MODE_CYCLE[(i + 1) % MODE_CYCLE.length]!;
    setParam("driveMode", next);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; vx: number; life: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const toneN = logNorm(p.tone, TONE_MIN, TONE_MAX);
      const energy = 0.12 + p.drive * 0.45 + p.crush * 0.3 + flashRef.current * 0.25;
      const isLive = p.drive > 0.02 || p.crush > 0.02;

      ctx.clearRect(0, 0, W, Hh);

      // Violet crucible chamber
      const bg = ctx.createRadialGradient(W * (0.3 + p.drive * 0.2), Hh * 0.4, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.38 + flashRef.current * 0.22));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(6,2,12,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Tone brightness veil (bright = open, dark = closed)
      const veil = ctx.createLinearGradient(0, 0, W, 0);
      veil.addColorStop(0, hexAlpha(C_TONE, 0));
      veil.addColorStop(0.7 + toneN * 0.25, hexAlpha(C_TONE, 0));
      veil.addColorStop(1, hexAlpha(C_DEEP, (1 - toneN) * 0.35));
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, W, Hh);

      // ── Transfer curve crucible (left) ──
      const cx = W * 0.26;
      const cy = Hh * 0.4;
      const R = Math.min(Hh * 0.28, 48);

      // Crucible ring
      ctx.strokeStyle = hexAlpha(C_MID, 0.2 + p.drive * 0.25);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = hexAlpha(C_MID, 0.12);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy);
      ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx, cy + R);
      ctx.stroke();

      // Clip rails (±1)
      ctx.strokeStyle = hexAlpha(C_HOT, 0.12 + p.drive * 0.2);
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy - R);
      ctx.lineTo(cx + R, cy - R);
      ctx.moveTo(cx - R, cy + R);
      ctx.lineTo(cx + R, cy + R);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dim identity / input reference
      ctx.strokeStyle = hexAlpha(C_MID, 0.22);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + R);
      ctx.lineTo(cx + R, cy - R);
      ctx.stroke();
      ctx.setLineDash([]);

      // Clip highlight regions (where |output| saturates)
      {
        let clipLo: number | null = null;
        for (let i = 0; i <= 80; i++) {
          const x = (i / 80) * 2 - 1;
          const y = xfer(x, p.mode, p.drive, p.bias, p.symmetry);
          const clipped = Math.abs(y) >= 0.92;
          if (clipped && clipLo === null) clipLo = x;
          if ((!clipped || i === 80) && clipLo !== null) {
            const x1 = clipLo;
            const x2 = clipped && i === 80 ? x : (i - 1) / 80 * 2 - 1;
            const px1 = cx + x1 * R;
            const px2 = cx + x2 * R;
            const band = ctx.createLinearGradient(px1, cy - R, px1, cy + R);
            band.addColorStop(0, hexAlpha(C_HOT, 0.22 + p.drive * 0.2));
            band.addColorStop(0.5, hexAlpha(C_HOT, 0.04));
            band.addColorStop(1, hexAlpha(C_HOT, 0.22 + p.drive * 0.2));
            ctx.fillStyle = band;
            ctx.fillRect(Math.min(px1, px2), cy - R, Math.max(2, Math.abs(px2 - px1)), R * 2);
            clipLo = clipped ? x : null;
          }
        }
      }

      // Bright output transfer curve
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const x = (i / 100) * 2 - 1;
        const y = xfer(x, p.mode, p.drive, p.bias, p.symmetry);
        const px = cx + x * R;
        const py = cy - y * R;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.9 + flashRef.current * 0.1);
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 10 + p.drive * 14 + flashRef.current * 10;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Bias offset marker on input axis
      if (Math.abs(p.bias) > 0.02) {
        const bx = cx + clamp(p.bias, -1, 1) * R * 0.35;
        ctx.strokeStyle = hexAlpha(C_DRV, 0.55);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, cy - R - 2);
        ctx.lineTo(bx, cy + R + 2);
        ctx.stroke();
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_DRV, 0.75);
        ctx.textAlign = "center";
        ctx.fillText(`B${p.bias >= 0 ? "+" : ""}${Math.round(p.bias * 100)}`, bx, cy - R - 6);
      }

      // Tracer on curve
      const trX = Math.sin(now / 400);
      const trY = xfer(trX, p.mode, p.drive, p.bias, p.symmetry);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 12;
      ctx.shadowColor = C_HOT;
      ctx.beginPath();
      ctx.arc(cx + trX * R, cy - trY * R, 3.5 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Dim input sample → bright output sample
      ctx.strokeStyle = hexAlpha(C_MID, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + trX * R, cy - trX * R);
      ctx.lineTo(cx + trX * R, cy - trY * R);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_MID, 0.55);
      ctx.beginPath();
      ctx.arc(cx + trX * R, cy - trX * R, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_DRV, 0.8);
      ctx.textAlign = "center";
      ctx.fillText("XFER", cx, cy + R + 14);
      if (Math.abs(p.symmetry) > 0.05) {
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_MID, 0.7);
        ctx.fillText(`SYM ${Math.round(p.symmetry * 100)}`, cx, cy + R + 24);
      }

      // ── Living waveform (right) ──
      const x0 = W * 0.52;
      const usable = W - x0 - 16;
      const mid = Hh * 0.4;
      const ampBase = Hh * 0.22 * (0.55 + p.drive * 0.45);
      const phase = now / 280;

      // Clean ghost
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        const x = Math.sin(u * Math.PI * 4 + phase);
        const px = x0 + u * usable;
        const py = mid - x * ampBase * 0.45;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = hexAlpha(C_MID, 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Driven + crushed
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const u = i / 120;
        let x = Math.sin(u * Math.PI * 4 + phase);
        if (p.crush > 0.02) {
          const steps = Math.max(2, Math.round(2 + (1 - p.crush) * 48));
          x = Math.round(x * steps) / steps;
        }
        x = xfer(x, p.mode, p.drive, p.bias, p.symmetry);
        // Soft tone roll-off visual: high freq ripple fades when tone is low
        const ripple = Math.sin(u * Math.PI * 18 + phase * 2) * 0.08 * toneN * p.drive;
        x = clamp(x + ripple, -1.2, 1.2);
        const px = x0 + u * usable;
        const py = mid - x * ampBase;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.9);
      ctx.lineWidth = 2.3;
      ctx.shadowBlur = 8 + p.drive * 12 + p.crush * 8;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Crush stair levels
      if (p.crush > 0.06) {
        const steps = Math.max(2, Math.round(2 + (1 - p.crush) * 48));
        ctx.strokeStyle = hexAlpha(C_CRUSH, 0.18 + p.crush * 0.35);
        ctx.lineWidth = 1;
        for (let s = 0; s <= steps; s++) {
          const level = (s / steps) * 2 - 1;
          const y = mid - level * ampBase;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x0 + usable, y);
          ctx.stroke();
        }
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_CRUSH, 0.75);
        ctx.textAlign = "right";
        ctx.fillText(`${Math.max(2, Math.round((1 - p.crush) * 16))}b`, x0 + usable, mid - ampBase - 6);
      }

      // Sparks when forging
      if (isLive && Math.random() < 0.12 + p.drive * 0.2) {
        sparks.push({
          x: x0 + Math.random() * usable,
          y: mid + (Math.random() - 0.5) * ampBase * 2,
          vx: (Math.random() - 0.5) * 2,
          life: 1,
        });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.03;
        s.x += s.vx;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(C_HOT, s.life * 0.7);
        ctx.fillRect(s.x, s.y, 2, 2);
      }

      // Drive / crush crosshair
      const hx = p.drive * W;
      const hy = (1 - p.crush) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Mode chip
      const chip = p.drive < 0.02 ? "CLEAN" : p.mode.toUpperCase();
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, chipW, 13);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, chipW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 16);

      // Tone rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_TONE, 0.25 + toneN * 0.35);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const fill = ctx.createLinearGradient(12, railY, 12 + (W - 24) * toneN, railY);
      fill.addColorStop(0, hexAlpha(C_TONE, 0.3));
      fill.addColorStop(1, hexAlpha(C_GLOW, 0.8));
      ctx.fillStyle = fill;
      ctx.fillRect(12, railY + 1, Math.max(2, (W - 24) * toneN), 5);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * toneN, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_TONE, 0.8);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      const toneLabel = p.tone >= 1000 ? `${(p.tone / 1000).toFixed(1)}k` : `${Math.round(p.tone)}`;
      ctx.fillText(`TONE ${toneLabel}`, 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("DRIVE · SHAPE CRUCIBLE", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? "CLEAN"
        : `D${Math.round(p.drive * 100)} · C${Math.round(p.crush * 100)} · ${p.mode}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.drive ?? 0) > 0.02 || (st.current.crush ?? 0) > 0.02,
        dragging: !!dragRef.current,
        particles: sparks.length,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, live ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Drive ↔ · Left: Bias ↕ · Right: Crush ↕ · Bottom: Tone · Double-click: cycle mode"
      role="img"
      aria-label="Drive shape crucible"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexAlpha(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexAlpha(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.78) }}
      >
        Shape Crucible
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? mode : "CLEAN"}
      </div>
    </div>
  );
}
