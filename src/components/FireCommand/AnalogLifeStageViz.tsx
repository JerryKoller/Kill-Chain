/**
 * LIFE — Organic Pulse stage visualizer.
 * Analog Life: drift · rate · instability · tune/env variance (Signal Path Tone · FC.analogLife).
 * Drag: Rate ↔ / Life ↕. Bottom rail: Env Δ. Every param paints the living scope.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.analogLife;
const C_DEEP = bandShade(FC.tone, 0.18);
const C_MID = bandShade(FC.tone, 0.38);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.88);
const C_DRIFT = bandShade(FC.tone, 0.42);
const C_RATE = bandShade(FC.tone, 0.5);
const C_INST = bandShade(FC.tone, 0.62);
const C_TUNE = bandShade(FC.tone, 0.72);
const C_ENV = bandShade(FC.tone, 0.82);

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

/** Classic QRS-ish ECG sample at phase 0..1 */
function ecgSample(phase: number, amt: number, instab: number, tune: number): number {
  const p = ((phase % 1) + 1) % 1;
  let y = 0;
  // P wave
  if (p > 0.08 && p < 0.18) y = Math.sin(((p - 0.08) / 0.1) * Math.PI) * 0.18 * amt;
  // Q
  if (p > 0.28 && p < 0.32) y = -0.22 * amt;
  // R spike
  if (p > 0.32 && p < 0.38) {
    const t = (p - 0.32) / 0.06;
    y = t < 0.5 ? t * 2 * amt : (1 - (t - 0.5) * 2) * amt;
  }
  // S
  if (p > 0.38 && p < 0.44) y = -0.28 * amt * (1 - (p - 0.38) / 0.06);
  // T wave
  if (p > 0.52 && p < 0.72) y = Math.sin(((p - 0.52) / 0.2) * Math.PI) * 0.32 * amt;
  // Tune bends baseline into a slow sine
  y += Math.sin(p * Math.PI * 2 + tune * 4) * tune * 0.12;
  // Instability noise
  if (instab > 0.02) y += (Math.random() - 0.5) * instab * 0.35;
  return y;
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

export function AnalogLifeStageViz() {
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.driftRate) ?? 0.35;
  const instab = useFireCommandStore((s) => s.patch.voiceInstability) ?? 0;
  const tune = useFireCommandStore((s) => s.patch.tuneVariance) ?? 0;
  const env = useFireCommandStore((s) => s.patch.envVariance) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<"xy" | "env" | null>(null);
  const prevKey = useRef("");
  const st = useRef({ drift, rate, instab, tune, env });
  st.current = { drift, rate, instab, tune, env };

  const alive = drift > 0.02 || instab > 0.02 || tune > 0.02 || env > 0.02;
  const bpm = Math.round(28 + rate * 92);

  useEffect(() => {
    const key = `${drift.toFixed(3)}|${rate.toFixed(3)}|${instab.toFixed(3)}|${tune.toFixed(3)}|${env.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [drift, rate, instab, tune, env]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      const r = 0.05 + x * 0.95;
      const life = 1 - y;
      setParam("driftRate", Math.round(r * 1000) / 1000);
      setParam("drift", Math.round(life * 0.7 * 1000) / 1000);
      setParam("voiceInstability", Math.round(life * 0.55 * 1000) / 1000);
      setParam("tuneVariance", Math.round(life * 0.4 * 1000) / 1000);
    },
    [setParam],
  );

  const applyEnv = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("envVariance", Math.round(x * 1000) / 1000);
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
        dragRef.current = "env";
        wrap.setPointerCapture(e.pointerId);
        applyEnv(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyEnv],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "env") applyEnv(e.clientX);
    },
    [applyXy, applyEnv],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("drift", 0);
    setParam("driftRate", 0.35);
    setParam("voiceInstability", 0);
    setParam("tuneVariance", 0);
    setParam("envVariance", 0);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const wander = [0, 0, 0, 0, 0];
    const wanderT = [0, 0, 0, 0, 0];
    const sparks: Array<{ x: number; y: number; life: number; vx: number; vy: number; hue: number }> = [];
    const envBeats: Array<{ x: number; life: number; amp: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const life = Math.max(p.drift, p.instab * 0.9, p.tune * 0.7, p.env * 0.6);
      const dormant = life < 0.02;
      const energy = dormant ? 0.08 : 0.22 + life * 0.78;
      const beatHz = 0.45 + p.rate * 2.4;
      const beatPhase = (now / 1000) * beatHz;

      ctx.clearRect(0, 0, W, Hh);

      // Warm Tone gold chamber — breathes with drift
      const breath = dormant ? 0 : (Math.sin(beatPhase * Math.PI * 2) * 0.5 + 0.5) * p.drift;
      const cx = W * (0.42 + p.tune * 0.08);
      const cy = Hh * (0.38 - breath * 0.04);
      const bg = ctx.createRadialGradient(cx, cy, 4, W * 0.5, Hh * 0.48, W * 0.78);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.32 + flashRef.current * 0.28 + breath * 0.12));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(6,4,1,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Soft organic vignette rings
      if (!dormant && p.drift > 0.05) {
        for (let r = 0; r < 3; r++) {
          const rad = 18 + r * 22 + breath * 14 + p.drift * 20;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.strokeStyle = hexAlpha(C_DRIFT, (0.12 - r * 0.03) * p.drift);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // Scope grid — denser with rate
      const grid = Math.max(10, 16 - Math.round(p.rate * 4));
      ctx.strokeStyle = hexAlpha(C_MID, 0.07 + life * 0.1);
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += grid) {
        ctx.globalAlpha = x % (grid * 4) === 0 ? 0.4 : 0.14;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, Hh - 22);
        ctx.stroke();
      }
      for (let y = 0; y < Hh - 22; y += grid) {
        ctx.globalAlpha = y % (grid * 3) === 0 ? 0.35 : 0.12;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(W, y + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Left vitality meters — one per param
      const meters: Array<{ v: number; col: string; label: string }> = [
        { v: p.drift, col: C_DRIFT, label: "DR" },
        { v: (p.rate - 0.05) / 0.95, col: C_RATE, label: "RT" },
        { v: p.instab, col: C_INST, label: "IN" },
        { v: p.tune, col: C_TUNE, label: "TN" },
        { v: p.env, col: C_ENV, label: "EV" },
      ];
      const mX = 10;
      const mH = 28;
      meters.forEach((m, i) => {
        const my = 28 + i * (mH + 4);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(mX, my, 8, mH);
        const fillH = mH * clamp(m.v, 0, 1);
        const g = ctx.createLinearGradient(mX, my + mH, mX, my + mH - fillH);
        g.addColorStop(0, hexAlpha(m.col, 0.35));
        g.addColorStop(1, hexAlpha(m.col, 0.95));
        ctx.fillStyle = g;
        ctx.shadowBlur = m.v > 0.05 ? 6 : 0;
        ctx.shadowColor = m.col;
        ctx.fillRect(mX, my + mH - fillH, 8, fillH);
        ctx.shadowBlur = 0;
        ctx.fillStyle = hexAlpha(m.col, 0.55 + m.v * 0.4);
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(m.label, mX + 11, my + mH - 2);
      });

      // Central breathing nucleus (Life amount)
      const nucleusR = 10 + p.drift * 22 + breath * 8 + flashRef.current * 6;
      const ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusR * 1.6);
      ng.addColorStop(0, hexAlpha(C_GLOW, dormant ? 0.08 : 0.35 + breath * 0.35));
      ng.addColorStop(0.45, hexAlpha(C_HOT, dormant ? 0.05 : 0.22 + p.drift * 0.25));
      ng.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusR * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusR * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(C_GLOW, dormant ? 0.15 : 0.55 + breath * 0.35);
      ctx.shadowBlur = 12 + p.drift * 16;
      ctx.shadowColor = C;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Wander targets for multi-voice traces
      const amt = Math.max(0.05, p.drift * 0.75 + p.instab * 0.85 + p.tune * 0.4);
      const spd = 0.02 + p.rate * 0.1;
      for (let i = 0; i < wander.length; i++) {
        if (Math.random() < 0.03 + p.rate * 0.08) wanderT[i] = (Math.random() * 2 - 1) * amt;
        wander[i]! += (wanderT[i]! - wander[i]!) * spd;
      }

      // Primary ECG ribbon (drift + rate)
      const midY = Hh * 0.42;
      const ampPx = Hh * (0.14 + p.drift * 0.22);
      const cycles = 2.2 + p.rate * 2.8;
      const scroll = beatPhase * 0.85;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const phase = (x / W) * cycles + scroll;
        const sample = ecgSample(phase, 1, p.instab, p.tune);
        const wob = wander[0]! * Hh * 0.06;
        const y = midY - sample * ampPx + wob;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, dormant ? 0.2 : 0.55 + energy * 0.4);
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 10 + life * 14 + flashRef.current * 16;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Ghost ECG fill
      if (!dormant) {
        ctx.beginPath();
        ctx.moveTo(0, midY);
        for (let x = 0; x <= W; x += 3) {
          const phase = (x / W) * cycles + scroll;
          const sample = ecgSample(phase, 1, p.instab * 0.5, p.tune);
          ctx.lineTo(x, midY - sample * ampPx * 0.85 + wander[0]! * Hh * 0.04);
        }
        ctx.lineTo(W, midY);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, midY - ampPx, 0, midY + ampPx * 0.4);
        fill.addColorStop(0, hexAlpha(C_HOT, 0.18 + energy * 0.15));
        fill.addColorStop(0.55, hexAlpha(C, 0.06));
        fill.addColorStop(1, hexAlpha(C_DEEP, 0.08));
        ctx.fillStyle = fill;
        ctx.fill();
      }

      // Secondary voice traces (instability / tune)
      for (let i = 1; i < 4; i++) {
        const y0 = Hh * (0.22 + i * 0.09);
        const col = i === 1 ? C_INST : i === 2 ? C_TUNE : C_DRIFT;
        const a = (0.18 + life * 0.4 - i * 0.03) * (dormant ? 0.25 : 1);
        ctx.beginPath();
        for (let x = 0; x <= W; x += 3) {
          const phase = (x / W) * (cycles * 0.7) + scroll * (0.7 + i * 0.08) + i * 0.2;
          const sample = ecgSample(phase, 0.55 + p.instab * 0.3, p.instab * 0.7, p.tune);
          const y = y0 - sample * ampPx * 0.45 + wander[i]! * Hh * 0.08;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(col, a);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Instability sparks
      if (p.instab > 0.08 && Math.random() < 0.12 + p.instab * 0.35) {
        sparks.push({
          x: Math.random() * W,
          y: midY + (Math.random() - 0.5) * ampPx * 2,
          life: 1,
          vx: (Math.random() - 0.5) * 2.5,
          vy: (Math.random() - 0.5) * 2,
          hue: Math.random() > 0.5 ? 0 : 1,
        });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.035 + (1 - p.instab) * 0.02;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        s.y += s.vy;
        const col = s.hue ? C_INST : C_HOT;
        ctx.fillStyle = hexAlpha(col, s.life * 0.8);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + p.instab * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Tune variance — pitch ladder ticks on right
      if (p.tune > 0.04) {
        const steps = 3 + Math.round(p.tune * 5);
        for (let i = 0; i < steps; i++) {
          const ty = Hh * 0.18 + (i / Math.max(1, steps - 1)) * Hh * 0.42;
          const wob = Math.sin(now * 0.003 + i) * p.tune * 4;
          ctx.strokeStyle = hexAlpha(C_TUNE, 0.25 + p.tune * 0.45);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(W - 36 + wob, ty);
          ctx.lineTo(W - 14, ty);
          ctx.stroke();
        }
      }

      // Env variance — spawn breath pulses along rail
      if (p.env > 0.05 && Math.random() < 0.08 + p.env * 0.2) {
        envBeats.push({ x: 14 + Math.random() * (W - 28) * p.env, life: 1, amp: 6 + p.env * 14 });
      }
      for (let i = envBeats.length - 1; i >= 0; i--) {
        const b = envBeats[i]!;
        b.life -= 0.03;
        if (b.life <= 0) {
          envBeats.splice(i, 1);
          continue;
        }
        const eh = b.amp * b.life;
        const eg = ctx.createLinearGradient(b.x, Hh - 22 - eh, b.x, Hh - 22);
        eg.addColorStop(0, hexAlpha(C_ENV, 0));
        eg.addColorStop(1, hexAlpha(C_ENV, b.life * 0.55));
        ctx.fillStyle = eg;
        ctx.fillRect(b.x - 2, Hh - 22 - eh, 4, eh);
      }

      // Env rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_ENV, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const envW = (W - 24) * p.env;
      if (p.env > 0.01) {
        const pulse = (Math.sin(now * 0.005) * 0.5 + 0.5) * p.env;
        const eg = ctx.createLinearGradient(12, railY, 12 + envW, railY);
        eg.addColorStop(0, hexAlpha(C_ENV, 0.35));
        eg.addColorStop(1, hexAlpha(C_GLOW, 0.95));
        ctx.fillStyle = eg;
        ctx.shadowBlur = 8 + pulse * 12;
        ctx.shadowColor = C;
        ctx.fillRect(12, railY, envW, 7);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + envW, railY + 3.5, 3.5 + flashRef.current * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_ENV, 0.7);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("ENV Δ", 14, railY - 3);

      // Rate / life crosshair
      const hx = ((p.rate - 0.05) / 0.95) * W;
      const lifeAmt = Math.max(p.drift / 0.7, p.instab / 0.55, p.tune / 0.4, 0);
      const hy = (1 - clamp(lifeAmt, 0, 1)) * (Hh * 0.7);
      ctx.strokeStyle = hexAlpha(C_GLOW, dormant ? 0.1 : 0.4 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 9, hy);
      ctx.lineTo(hx + 9, hy);
      ctx.moveTo(hx, hy - 9);
      ctx.lineTo(hx, hy + 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, 3 + flashRef.current * 2, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(C_HOT, 0.7 + flashRef.current * 0.3);
      ctx.fill();

      // Heartbeat ring (top-right) — rate drives needle speed via flash sync
      const gx = W - 30;
      const gy = 26;
      const gr = 14;
      ctx.strokeStyle = hexAlpha(C_MID, 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, -Math.PI * 0.75, Math.PI * 0.75);
      ctx.stroke();
      const beatFlash = Math.pow(Math.max(0, Math.sin(beatPhase * Math.PI * 2)), 8);
      const ang = -Math.PI * 0.75 + Math.PI * 1.5 * clamp(life, 0, 1);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.65 + beatFlash * 0.35);
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 8 + beatFlash * 10;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(ang) * (gr - 2), gy + Math.sin(ang) * (gr - 2));
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (beatFlash > 0.4 && !dormant) {
        ctx.beginPath();
        ctx.arc(gx, gy, gr + 2 + beatFlash * 4, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(C_HOT, beatFlash * 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (dormant) {
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        ctx.fillRect(0, 0, W, Hh - 24);
        ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.48 + Math.sin(now / 520) * 0.12);
        ctx.fillText("STILL · drag to wake organic life", W * 0.5, Hh * 0.4);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("LIFE · ORGANIC PULSE", 12, Hh - 2);
      ctx.textAlign = "right";
      if (dormant) {
        ctx.fillStyle = hexAlpha(C_MID, 0.5);
        ctx.fillText("STILL", W - 12, Hh - 2);
      } else {
        const bits: string[] = [];
        if (p.drift > 0.04) bits.push(`DR${Math.round(p.drift * 100)}`);
        if (p.instab > 0.04) bits.push(`IN${Math.round(p.instab * 100)}`);
        if (p.tune > 0.04) bits.push(`TN${Math.round(p.tune * 100)}`);
        if (p.env > 0.04) bits.push(`EV${Math.round(p.env * 100)}`);
        bits.push(`~${Math.round(28 + p.rate * 92)}bpm`);
        ctx.fillStyle = hexAlpha(C_HOT, 0.88);
        ctx.fillText(bits.join(" · "), W - 12, Hh - 2);
      }
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: sparks.length,
        motionKey: "",
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
        borderColor: hexAlpha(C, alive ? 0.55 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, alive ? 0.26 : 0.08)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Rate ↔ / Life ↕ · Bottom rail: Env Δ · Double-click: still"
      role="img"
      aria-label="Analog life organic pulse"
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
        Organic Pulse
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 flex items-center gap-1.5 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: alive ? C_GLOW : "rgba(255,255,255,0.2)",
            boxShadow: alive ? `0 0 8px ${C}` : undefined,
            animation: alive ? `lifePulse ${Math.max(0.35, 1.1 - rate * 0.7)}s ease-in-out infinite` : undefined,
          }}
        />
        {alive ? `${bpm} BPM` : "STILL"}
      </div>
      <style>{`@keyframes lifePulse { 0%,100%{opacity:.45;transform:scale(.85)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
    </div>
  );
}
