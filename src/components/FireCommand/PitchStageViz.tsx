/**
 * Pitch · Glide — Glide Horizon stage visualizer.
 * Pitch env (semitones) · env time · glide · mono (Signal Path Mod · FC.pitch).
 * Drag: Env Time ↔ / Amount ↕ (bipolar). Bottom: Glide. Double-click: flip polarity. Click: strike flash.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.pitch;
const C_DEEP = bandShade(FC.mod, 0.28);
const C_MID = bandShade(FC.mod, 0.5);
const C_HOT = bandShade(FC.mod, 0.7);
const C_GLOW = bandShade(FC.mod, 0.95);
const C_AMT = bandShade(FC.mod, 0.62);
const C_TIME = bandShade(FC.mod, 0.78);
const C_GLIDE = bandShade(FC.mod, 0.88);
const C_UP = bandShade(FC.mod, 0.92);
const C_DN = bandShade(FC.mod, 0.45);

const AMT_MIN = -48;
const AMT_MAX = 48;
const TIME_MIN = 0.01;
const TIME_MAX = 2;

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

type DragMode = "xy" | "glide" | null;

export function PitchStageViz() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount) ?? 0;
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime) ?? 0.2;
  const glide = useFireCommandStore((s) => s.patch.glide) ?? 0;
  const mono = useFireCommandStore((s) => s.patch.mono) ?? false;
  const glideMode = useFireCommandStore((s) => s.patch.glideMode) ?? "legato";
  const glideCurve = useFireCommandStore((s) => s.patch.glideCurve) ?? "exp";
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const strikeRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ amt, time, glide, mono, glideMode, glideCurve });
  st.current = { amt, time, glide, mono, glideMode, glideCurve };

  const live = Math.abs(amt) > 0.5 || glide > 0.02;

  useEffect(() => {
    const key = `${amt}|${time.toFixed(3)}|${glide.toFixed(3)}|${mono}|${glideMode}|${glideCurve}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [amt, time, glide, mono, glideMode, glideCurve]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      // Y bipolar: top = +48, mid = 0, bottom = -48
      const amtN = clamp(1 - y, 0, 1);
      const signed = Math.round(AMT_MIN + amtN * (AMT_MAX - AMT_MIN));
      setParam("pitchEnvAmount", signed);
      setParam("pitchEnvTime", Math.round(logLerp(x, TIME_MIN, TIME_MAX) * 1000) / 1000);
    },
    [setParam],
  );

  const applyGlide = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("glide", Math.round(x * 1000) / 1000);
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
        dragRef.current = "glide";
        wrap.setPointerCapture(e.pointerId);
        applyGlide(e.clientX);
        return;
      }
      dragRef.current = "xy";
      strikeRef.current = 1;
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyGlide],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "glide") applyGlide(e.clientX);
    },
    [applyXy, applyGlide],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const a = st.current.amt;
    if (Math.abs(a) < 0.5) setParam("pitchEnvAmount", 12);
    else setParam("pitchEnvAmount", -a);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; col: string }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;
      strikeRef.current *= 0.92;

      const mid = Hh * 0.4;
      const timeN = logNorm(p.time, TIME_MIN, TIME_MAX);
      const amtN = clamp((p.amt - AMT_MIN) / (AMT_MAX - AMT_MIN), 0, 1);
      const dir = Math.sign(p.amt) || 0;
      const energy =
        0.12 +
        Math.min(1, Math.abs(p.amt) / 24) * 0.4 +
        p.glide * 0.25 +
        (p.mono ? 0.08 : 0) +
        flashRef.current * 0.25 +
        strikeRef.current * 0.2;
      const isLive = Math.abs(p.amt) > 0.5 || p.glide > 0.02;

      let engT = now / 1000;
      try {
        engT = getEngine().ctx.currentTime;
      } catch { /* */ }

      ctx.clearRect(0, 0, W, Hh);

      // Horizon chamber
      const bg = ctx.createRadialGradient(W * (0.35 + timeN * 0.2), mid, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(dir >= 0 ? C_UP : C_DN, 0.08 + energy * 0.32 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(2,6,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      const railL = 28;
      const railR = W - 14;
      const ladderSpan = Math.min(42, 18 + Math.abs(p.amt) * 0.55);
      const semitones = 11;

      // Semitone ladder
      for (let i = 0; i < semitones; i++) {
        const st = i - Math.floor(semitones / 2);
        const y = mid - (st / (semitones / 2)) * ladderSpan;
        const isCtr = st === 0;
        const onRung = dir !== 0 && Math.sign(st) === dir && Math.abs(st) <= Math.abs(p.amt) / 4;
        ctx.strokeStyle = isCtr
          ? hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.2)
          : hexAlpha(onRung ? (dir > 0 ? C_UP : C_DN) : C_MID, onRung ? 0.35 + energy * 0.25 : 0.08);
        ctx.lineWidth = isCtr ? 1.6 : onRung ? 1.3 : 1;
        ctx.beginPath();
        ctx.moveTo(railL, y);
        ctx.lineTo(railR * 0.55, y);
        ctx.stroke();
        if (isCtr || st % 2 === 0) {
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(isCtr ? C_GLOW : C_MID, isCtr ? 0.7 : 0.35);
          ctx.textAlign = "right";
          ctx.fillText(`${st > 0 ? "+" : ""}${st}`, railL - 4, y + 2);
        }
      }

      // Pitch envelope contour (MIDI note-on strike → decay) — left zone
      const peakY = mid - (p.amt / 48) * ladderSpan * 1.05;
      const decayX = railL + 20 + timeN * (railR * 0.45 - railL);
      const envCol = dir > 0 ? C_UP : dir < 0 ? C_DN : C_MID;

      ctx.font = "800 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_AMT, 0.7);
      ctx.textAlign = "left";
      ctx.fillText("PITCH ENV · MIDI", railL, 22);

      if (Math.abs(p.amt) > 0.5) {
        ctx.beginPath();
        ctx.moveTo(railL + 6, mid);
        ctx.lineTo(railL + 22, peakY);
        ctx.quadraticCurveTo(railL + 22 + (decayX - railL - 22) * 0.4, peakY, decayX, mid);
        ctx.lineTo(railL + 6, mid);
        ctx.closePath();
        const fill = ctx.createLinearGradient(railL, peakY, decayX, mid);
        fill.addColorStop(0, hexAlpha(envCol, 0.28 + strikeRef.current * 0.25));
        fill.addColorStop(1, hexAlpha(envCol, 0.02));
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(railL + 6, mid);
        ctx.lineTo(railL + 22, peakY);
        ctx.quadraticCurveTo(railL + 22 + (decayX - railL - 22) * 0.4, peakY, decayX, mid);
        ctx.strokeStyle = hexAlpha(envCol, 0.9);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10 + Math.abs(p.amt) * 0.15 + strikeRef.current * 12;
        ctx.shadowColor = envCol;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Strike tracer along envelope
        const strikePh = strikeRef.current > 0.05 ? 1 - strikeRef.current : (engT / Math.max(0.05, p.time)) % 1;
        const u = clamp(strikePh, 0, 1);
        let sx: number;
        let sy: number;
        if (u < 0.15) {
          const t0 = u / 0.15;
          sx = railL + 6 + (16) * t0;
          sy = mid + (peakY - mid) * t0;
        } else {
          const t1 = (u - 0.15) / 0.85;
          const cpx = railL + 22 + (decayX - railL - 22) * 0.4;
          const x0 = railL + 22;
          const y0 = peakY;
          sx = (1 - t1) * (1 - t1) * x0 + 2 * (1 - t1) * t1 * cpx + t1 * t1 * decayX;
          sy = (1 - t1) * (1 - t1) * y0 + 2 * (1 - t1) * t1 * y0 + t1 * t1 * mid;
        }
        ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
        ctx.shadowBlur = 12;
        ctx.shadowColor = envCol;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5 + strikeRef.current * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Portamento / glide zone (right) — separate from pitch env
      const gStartX = W * 0.58;
      const gStartY = mid + 16;
      const gLen = 36 + p.glide * 100;
      const gEndX = Math.min(W - 20, gStartX + gLen);
      const gEndY = mid - 10 - p.glide * 8;
      const modeTag = String(p.glideMode ?? "legato").toUpperCase();
      const curveTag = String(p.glideCurve ?? "exp").toUpperCase();

      ctx.font = "800 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLIDE, 0.75);
      ctx.textAlign = "left";
      ctx.fillText(`GLIDE · ${modeTag} · ${curveTag}`, gStartX - 4, 22);

      if (p.mono) {
        // Mono comet
        if (p.glide > 0.01) {
          for (let trail = 14; trail >= 0; trail--) {
            const u = ((engT * (0.4 + p.glide) + trail * 0.05) % 1 + 1) % 1;
            const tx = gStartX + (gEndX - gStartX) * u;
            const ty = gStartY + (gEndY - gStartY) * u - Math.sin(u * Math.PI) * (8 + p.glide * 10);
            const a = ((14 - trail) / 14) * (0.25 + p.glide * 0.55);
            ctx.fillStyle = hexAlpha(C_GLIDE, a);
            ctx.beginPath();
            ctx.arc(tx, ty, 1.5 + ((14 - trail) / 14) * 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.moveTo(gStartX, gStartY);
          ctx.quadraticCurveTo(gStartX + gLen * 0.35, gStartY - 18 - p.glide * 8, gEndX, gEndY);
          ctx.strokeStyle = hexAlpha(C_GLIDE, 0.55 + p.glide * 0.4);
          ctx.lineWidth = 2.4;
          ctx.shadowBlur = 10 + p.glide * 12;
          ctx.shadowColor = C;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#eef6ff";
          ctx.shadowBlur = 14;
          ctx.shadowColor = C_GLIDE;
          ctx.beginPath();
          ctx.arc(gEndX, gEndY, 4 + flashRef.current, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          // Mono idle gem
          ctx.fillStyle = hexAlpha(C_HOT, 0.5);
          ctx.beginPath();
          ctx.arc(gStartX + 20, mid, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_GLIDE, 0.85);
        ctx.textAlign = "left";
        ctx.fillText(`MONO · ${modeTag}`, gStartX - 4, Hh * 0.72);
      } else {
        // Poly discrete notes
        for (let v = 0; v < 5; v++) {
          const vx = gStartX + v * 18;
          const vy = mid + 8 - (v % 3) * 8 + Math.sin(engT * 2 + v) * 2;
          const glow = ctx.createRadialGradient(vx, vy, 0, vx, vy, 9);
          glow.addColorStop(0, hexAlpha(C_GLOW, 0.35 + (p.glide > 0 ? 0.1 : 0)));
          glow.addColorStop(1, hexAlpha(C_GLOW, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(vx, vy, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = hexAlpha(C_HOT, 0.55 + (v === 2 ? 0.25 : 0));
          ctx.beginPath();
          ctx.arc(vx, vy, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.glide > 0.05) {
          // Glide in poly still shows faint arcs (portamento unused but visual hint)
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = hexAlpha(C_GLIDE, 0.2 + p.glide * 0.25);
          ctx.beginPath();
          ctx.moveTo(gStartX, mid + 8);
          ctx.quadraticCurveTo(gStartX + 40, mid - 10, gStartX + 72, mid + 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_MID, 0.75);
        ctx.textAlign = "left";
        ctx.fillText("POLY STEPS", gStartX - 4, Hh * 0.72);
      }

      // Amount / time crosshair
      const hx = timeN * W;
      const hy = (1 - amtN) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();
      // Zero line marker
      ctx.strokeStyle = hexAlpha(C_MID, 0.25);
      ctx.beginPath();
      ctx.moveTo(0, (1 - 0.5) * (Hh * 0.68));
      ctx.lineTo(W, (1 - 0.5) * (Hh * 0.68));
      ctx.stroke();

      // Sparks on strike / env
      if ((strikeRef.current > 0.3 || Math.abs(p.amt) > 8) && Math.random() < 0.15) {
        sparks.push({
          x: railL + 20 + Math.random() * 40,
          y: peakY + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.3) * 2,
          vy: (Math.random() - 0.5) * 1.5,
          life: 1,
          col: envCol,
        });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.03;
        s.x += s.vx;
        s.y += s.vy;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(s.col, s.life * 0.7);
        ctx.fillRect(s.x, s.y, 2, 2);
      }

      // Amount chip
      const chip = Math.abs(p.amt) < 0.5 ? "0 st" : `${p.amt > 0 ? "+" : ""}${Math.round(p.amt)} st`;
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, chipW, 13);
      ctx.strokeStyle = hexAlpha(Math.abs(p.amt) > 0.5 ? envCol : C_MID, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, chipW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 16);

      // Glide rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_GLIDE, 0.25 + p.glide * 0.4);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      if (p.glide > 0.02) {
        const rg = ctx.createLinearGradient(12, railY, 12 + (W - 24) * p.glide, railY);
        rg.addColorStop(0, hexAlpha(C_GLIDE, 0.35));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.8));
        ctx.fillStyle = rg;
        ctx.fillRect(12, railY + 1, (W - 24) * p.glide, 5);
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * p.glide, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_GLIDE, 0.8);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        p.mono ? `GLIDE · ${modeTag} · ${curveTag}` : `GLIDE · (arm mono) · ${curveTag}`,
        14,
        railY - 3,
      );

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("PITCH · GLIDE HORIZON", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? p.mono
          ? `MONO · ${modeTag} · IDLE`
          : "POLY · IDLE"
        : `ENV ${p.amt > 0 ? "+" : ""}${Math.round(p.amt)}st/${p.time < 1 ? `${Math.round(p.time * 1000)}ms` : `${p.time.toFixed(2)}s`}${p.glide > 0.02 ? ` · G${Math.round(p.glide * 100)} ${curveTag}` : ""}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: Math.abs(st.current.amt ?? 0) > 0.01 || (st.current.glide ?? 0) > 0.01,
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
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Env Time ↔ / Amount ↕ · Bottom: Glide · Double-click: flip polarity · Click: strike"
      role="img"
      aria-label="Pitch glide horizon"
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
        Glide Horizon
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(mono ? C_GLIDE : C_MID, 0.78) }}
      >
        {mono ? `${glideMode} · ${glideCurve}` : "POLY"}
      </div>
    </div>
  );
}

/** Alias for older imports */
export { PitchStageViz as PitchGlideStageViz };
