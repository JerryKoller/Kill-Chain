/**
 * AMP — Breath Contour stage visualizer.
 * Amp ADSR · velocity · LPG park (Signal Path Tone · FC.envAmp).
 * Drag stage zones: A / D / S↕ / R. Bottom rail: Vel. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.envAmp;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.88);
const C_A = bandShade(FC.tone, 0.42);
const C_D = bandShade(FC.tone, 0.55);
const C_S = bandShade(FC.tone, 0.68);
const C_R = bandShade(FC.tone, 0.78);
const C_VEL = bandShade(FC.tone, 0.9);
const C_LPG = bandShade(FC.tone, 0.72);

const A_MIN = 0.001;
const A_MAX = 3;
const D_MIN = 0.005;
const D_MAX = 3;
const R_MIN = 0.005;
const R_MAX = 4;

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

function envSegments(a: number, d: number, s: number, r: number, usableW: number) {
  const seg = (v: number) => Math.pow(Math.max(0.001, v), 0.5);
  const tot = seg(a) + seg(d) + seg(r) + 0.35;
  const wA = (seg(a) / tot) * usableW;
  const wD = (seg(d) / tot) * usableW;
  const wR = (seg(r) / tot) * usableW;
  const wS = usableW - wA - wD - wR;
  return { wA, wD, wR, wS };
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

type DragMode = "A" | "D" | "S" | "R" | "vel" | "lpg" | null;

export function AmpEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.ampAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.ampDecay) ?? 0.25;
  const sus = useFireCommandStore((s) => s.patch.ampSustain) ?? 0.8;
  const r = useFireCommandStore((s) => s.patch.ampRelease) ?? 0.35;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const pluckOn = useFireCommandStore((s) => s.patch.moduleEnable?.["pluck"] !== false);
  const lpgDecay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const lpgColor = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const setParam = useFireCommandStore((s) => s.setParam);

  const parked = lpgOn && pluckOn;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const zoneRef = useRef({ x0: 0, x1: 0, x2: 0, x3: 0, x4: 0, top: 22, usableH: 110 });
  const prevKey = useRef("");
  const st = useRef({ a, d, sus, r, vel, parked, lpgDecay, lpgColor });
  st.current = { a, d, sus, r, vel, parked, lpgDecay, lpgColor };

  useEffect(() => {
    const key = parked
      ? `lpg|${lpgDecay.toFixed(3)}|${lpgColor.toFixed(3)}|${vel.toFixed(3)}`
      : `${a.toFixed(3)}|${d.toFixed(3)}|${sus.toFixed(3)}|${r.toFixed(3)}|${vel.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [a, d, sus, r, vel, parked, lpgDecay, lpgColor]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "vel") {
        setParam("velAmount", Math.round(x * 1000) / 1000);
        return;
      }
      if (mode === "lpg") {
        setParam("lpgDecay", Math.round(logLerp(x, 0.05, 2.5) * 1000) / 1000);
        setParam("lpgColor", Math.round((1 - clamp(y / 0.78, 0, 1)) * 1000) / 1000);
        return;
      }
      const level = 1 - clamp(y / 0.78, 0, 1);
      if (mode === "S") {
        setParam("ampSustain", Math.round(level * 1000) / 1000);
        return;
      }
      if (mode === "A") setParam("ampAttack", Math.round(logLerp(x, A_MIN, A_MAX) * 1000) / 1000);
      else if (mode === "D") setParam("ampDecay", Math.round(logLerp(x, D_MIN, D_MAX) * 1000) / 1000);
      else if (mode === "R") setParam("ampRelease", Math.round(logLerp(x, R_MIN, R_MAX) * 1000) / 1000);
    },
    [setParam],
  );

  const hitZone = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    if (ly > H * 0.78) return "vel";
    if (st.current.parked) return "lpg";
    const z = zoneRef.current;
    if (lx < z.x1) return "A";
    if (lx < z.x2) return "D";
    if (lx < z.x3) return "S";
    return "R";
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const mode = hitZone(e.clientX, e.clientY);
      dragRef.current = mode;
      wrap.setPointerCapture(e.pointerId);
      applyDrag(e.clientX, e.clientY, mode);
    },
    [hitZone, applyDrag],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyDrag(e.clientX, e.clientY, dragRef.current);
    },
    [applyDrag],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    if (st.current.parked) {
      setParam("lpgDecay", 0.4);
      setParam("lpgColor", 0.7);
      setParam("velAmount", 1);
      return;
    }
    setParam("ampAttack", 0.01);
    setParam("ampDecay", 0.25);
    setParam("ampSustain", 0.8);
    setParam("ampRelease", 0.35);
    setParam("velAmount", 1);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; life: number; vx: number; vy: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const PAD = 14;
      const top = 24;
      const usableH = Hh - 44;
      const usableW = W - PAD * 2;

      ctx.clearRect(0, 0, W, Hh);

      if (p.parked) {
        // ── LPG strike mode ──
        const energy = 0.3 + p.lpgColor * 0.4 + flashRef.current * 0.25;
        const bg = ctx.createRadialGradient(W * 0.35, Hh * 0.4, 4, W * 0.5, Hh * 0.5, W * 0.75);
        bg.addColorStop(0, hexAlpha(C_LPG, 0.14 + energy * 0.3));
        bg.addColorStop(0.5, hexAlpha(C_DEEP, 0.55));
        bg.addColorStop(1, "rgba(6,5,1,0.98)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, Hh);

        // Vactrol decay curve
        const decayNorm = logNorm(p.lpgDecay, 0.05, 2.5);
        ctx.beginPath();
        ctx.moveTo(PAD, top);
        for (let i = 0; i <= 80; i++) {
          const t = i / 80;
          const x = PAD + t * usableW;
          const env = Math.exp(-t * (1.2 + (1 - decayNorm) * 4)) * (0.55 + p.lpgColor * 0.45);
          const y = top + (1 - env) * usableH;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(PAD + usableW, top + usableH);
        ctx.lineTo(PAD, top + usableH);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, top, 0, top + usableH);
        fill.addColorStop(0, hexAlpha(C_GLOW, 0.4));
        fill.addColorStop(1, hexAlpha(C_DEEP, 0.05));
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(PAD, top);
        for (let i = 0; i <= 80; i++) {
          const t = i / 80;
          const x = PAD + t * usableW;
          const env = Math.exp(-t * (1.2 + (1 - decayNorm) * 4)) * (0.55 + p.lpgColor * 0.45);
          ctx.lineTo(x, top + (1 - env) * usableH);
        }
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.9);
        ctx.lineWidth = 2.4;
        ctx.shadowBlur = 12 + flashRef.current * 14;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Strike flash
        const strike = Math.pow(Math.max(0, Math.sin((now / 900) * Math.PI * 2)), 12);
        if (strike > 0.2) {
          const sg = ctx.createRadialGradient(PAD + 8, top + 8, 0, PAD + 8, top + 8, 40 + strike * 30);
          sg.addColorStop(0, hexAlpha(C_GLOW, strike * 0.7));
          sg.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = sg;
          ctx.fillRect(0, 0, W * 0.5, Hh * 0.6);
        }

        ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
        ctx.fillText("LPG PARKED · drag Decay↔ / Color↕", W * 0.5, Hh * 0.42);

        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
        ctx.fillText("AMP · BREATH CONTOUR", 12, Hh - 2);
        ctx.textAlign = "right";
        ctx.fillStyle = hexAlpha(C_HOT, 0.88);
        ctx.fillText(`LPG · ${Math.round(p.lpgDecay * 1000)}ms · C${Math.round(p.lpgColor * 100)}`, W - 12, Hh - 2);
      } else {
        // ── ADSR breath mountain ──
        const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.sus, p.r, usableW);
        const x0 = PAD;
        const x1 = x0 + wA;
        const x2 = x1 + wD;
        const x3 = x2 + wS;
        const x4 = x3 + wR;
        zoneRef.current = { x0, x1, x2, x3, x4, top, usableH };
        const yLv = (lv: number) => top + (1 - lv * (0.55 + p.vel * 0.45)) * usableH;

        const energy = 0.22 + p.sus * 0.25 + (1 - logNorm(p.a, A_MIN, A_MAX)) * 0.15 + flashRef.current * 0.25;
        const breathe = 0.94 + 0.06 * Math.sin(now / 700);

        const bg = ctx.createRadialGradient(x1, yLv(1), 6, W * 0.5, Hh * 0.45, W * 0.78);
        bg.addColorStop(0, hexAlpha(C_HOT, 0.12 + energy * 0.3 + flashRef.current * 0.25));
        bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
        bg.addColorStop(1, "rgba(6,5,1,0.98)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, Hh);

        // Stage wash bands
        const bands: Array<{ x0: number; x1: number; col: string; a: number }> = [
          { x0, x1, col: C_A, a: 0.1 },
          { x0: x1, x1: x2, col: C_D, a: 0.08 },
          { x0: x2, x1: x3, col: C_S, a: 0.12 + p.sus * 0.1 },
          { x0: x3, x1: x4, col: C_R, a: 0.08 },
        ];
        for (const b of bands) {
          ctx.fillStyle = hexAlpha(b.col, b.a);
          ctx.fillRect(b.x0, top, Math.max(1, b.x1 - b.x0), usableH);
        }

        // Grid
        ctx.strokeStyle = hexAlpha(C_MID, 0.12);
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          const gy = top + (usableH / 4) * i;
          ctx.beginPath();
          ctx.moveTo(PAD, gy + 0.5);
          ctx.lineTo(W - PAD, gy + 0.5);
          ctx.stroke();
        }

        const mountain = () => {
          ctx.moveTo(x0, yLv(0));
          ctx.quadraticCurveTo(x0 + wA * 0.4, yLv(0.85 * breathe), x1, yLv(1 * breathe));
          ctx.quadraticCurveTo(x1 + wD * 0.4, yLv(p.sus + (1 - p.sus) * 0.25), x2, yLv(p.sus));
          ctx.lineTo(x3, yLv(p.sus));
          ctx.quadraticCurveTo(x3 + wR * 0.45, yLv(p.sus * 0.25), x4, yLv(0));
        };

        // Layered fill
        for (let layer = 4; layer >= 0; layer--) {
          ctx.beginPath();
          mountain();
          ctx.lineTo(x4, top + usableH);
          ctx.lineTo(x0, top + usableH);
          ctx.closePath();
          const mg = ctx.createLinearGradient(0, top, 0, top + usableH);
          mg.addColorStop(0, hexAlpha(C_GLOW, (0.32 - layer * 0.05) * breathe));
          mg.addColorStop(0.5, hexAlpha(C_HOT, 0.14 - layer * 0.02));
          mg.addColorStop(1, hexAlpha(C_DEEP, 0.02));
          ctx.fillStyle = mg;
          ctx.fill();
        }

        // Contour stroke
        ctx.beginPath();
        mountain();
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.85 + flashRef.current * 0.15);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 12 + energy * 10 + flashRef.current * 14;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Stage handles
        const handles: Array<{ x: number; y: number; col: string; label: string }> = [
          { x: x1, y: yLv(1 * breathe), col: C_A, label: "A" },
          { x: x2, y: yLv(p.sus), col: C_D, label: "D" },
          { x: (x2 + x3) / 2, y: yLv(p.sus), col: C_S, label: "S" },
          { x: x4, y: yLv(0), col: C_R, label: "R" },
        ];
        for (const h of handles) {
          ctx.fillStyle = hexAlpha(h.col, 0.9);
          ctx.shadowBlur = 8;
          ctx.shadowColor = h.col;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4 + flashRef.current * 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(h.col, 0.75);
          ctx.textAlign = "center";
          ctx.fillText(h.label, h.x, top - 4);
        }

        // Sustain energy bars
        const bars = Math.max(4, Math.round(6 + p.sus * 8));
        for (let i = 0; i < bars; i++) {
          const bx = x2 + ((x3 - x2) / bars) * i + 1;
          const bh = 3 + p.sus * 14 * (0.65 + 0.35 * Math.sin(now / 280 + i)) * breathe * (0.55 + p.vel * 0.45);
          const barGrad = ctx.createLinearGradient(bx, top + usableH - bh, bx, top + usableH);
          barGrad.addColorStop(0, hexAlpha(C_S, 0.5 + p.sus * 0.35));
          barGrad.addColorStop(1, hexAlpha(C_S, 0.05));
          ctx.fillStyle = barGrad;
          ctx.fillRect(bx, top + usableH - bh, Math.max(2, (x3 - x2) / bars - 3), bh);
        }

        // Rising breath particles from attack
        if (Math.random() < 0.2 + (1 - logNorm(p.a, A_MIN, A_MAX)) * 0.25) {
          sparks.push({
            x: x0 + Math.random() * Math.max(8, wA),
            y: yLv(0.7 + Math.random() * 0.3),
            life: 1,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -0.6 - Math.random() * 1.2,
          });
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]!;
          s.life -= 0.02;
          if (s.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          s.x += s.vx;
          s.y += s.vy;
          ctx.fillStyle = hexAlpha(C_A, s.life * 0.7);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 1.2 + s.life, 0, Math.PI * 2);
          ctx.fill();
        }

        // Playhead comet
        const cycle = (now / (1800 + logNorm(p.a, A_MIN, A_MAX) * 800 + logNorm(p.r, R_MIN, R_MAX) * 600)) % 1;
        const px = x0 + cycle * (x4 - x0);
        let py = yLv(0);
        if (px <= x1) py = yLv(((px - x0) / Math.max(1, wA)) * breathe);
        else if (px <= x2) py = yLv(1 - ((px - x1) / Math.max(1, wD)) * (1 - p.sus));
        else if (px <= x3) py = yLv(p.sus);
        else py = yLv(p.sus * (1 - (px - x3) / Math.max(1, wR)));

        for (let trail = 7; trail > 0; trail--) {
          const tc = (cycle - trail * 0.018 + 1) % 1;
          const tx = x0 + tc * (x4 - x0);
          let ty = yLv(0);
          if (tx <= x1) ty = yLv(((tx - x0) / Math.max(1, wA)) * breathe);
          else if (tx <= x2) ty = yLv(1 - ((tx - x1) / Math.max(1, wD)) * (1 - p.sus));
          else if (tx <= x3) ty = yLv(p.sus);
          else ty = yLv(p.sus * (1 - (tx - x3) / Math.max(1, wR)));
          ctx.fillStyle = hexAlpha(C_GLOW, (1 - trail / 8) * 0.28);
          ctx.beginPath();
          ctx.arc(tx, ty, 1.4 + (1 - trail / 8) * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fff8e0";
        ctx.shadowBlur = 14;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.arc(px, py, 3.6 + flashRef.current * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Stage labels under zones
        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        const labels = [
          { x: (x0 + x1) / 2, t: "ATK", c: C_A },
          { x: (x1 + x2) / 2, t: "DEC", c: C_D },
          { x: (x2 + x3) / 2, t: "SUS", c: C_S },
          { x: (x3 + x4) / 2, t: "REL", c: C_R },
        ];
        for (const lb of labels) {
          ctx.fillStyle = hexAlpha(lb.c, 0.55);
          ctx.fillText(lb.t, lb.x, top + usableH + 11);
        }

        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
        ctx.fillText("AMP · BREATH CONTOUR", 12, Hh - 2);
        ctx.textAlign = "right";
        ctx.fillStyle = hexAlpha(C_HOT, 0.88);
        const fmt = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
        ctx.fillText(`A${fmt(p.a)} · D${fmt(p.d)} · S${Math.round(p.sus * 100)} · R${fmt(p.r)}`, W - 12, Hh - 2);
      }

      // Vel rail (always)
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_VEL, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const velW = (W - 24) * p.vel;
      if (p.vel > 0.01) {
        const vg = ctx.createLinearGradient(12, railY, 12 + velW, railY);
        vg.addColorStop(0, hexAlpha(C_HOT, 0.4));
        vg.addColorStop(1, hexAlpha(C_VEL, 0.95));
        ctx.fillStyle = vg;
        ctx.shadowBlur = 8;
        ctx.shadowColor = C;
        ctx.fillRect(12, railY, velW, 7);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + velW, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_VEL, 0.7);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("VEL", 14, railY - 3);
    
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
        borderColor: hexAlpha(C, parked ? 0.45 : 0.5),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, parked ? 0.18 : 0.24)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title={
        parked
          ? "LPG parked — drag Decay↔ / Color↕ · Bottom: Vel · Double-click: LPG defaults"
          : "Drag A/D/S/R zones · Bottom: Vel · Double-click: ADSR defaults"
      }
      role="img"
      aria-label="Amp envelope breath contour"
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
        Breath Contour
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        {parked ? "LPG" : "ADSR"}
      </div>
    </div>
  );
}
