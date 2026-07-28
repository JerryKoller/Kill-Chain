/**
 * FILT — Spectral Blade stage visualizer.
 * Filter: type · cutoff · reso · env amt · key track · sat (Signal Path Tone · FC.filter).
 * Drag: Cutoff ↔ / Reso ↕. Bottom rail: Sat. Env ghosts the blade. Key track paints the ladder.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FireFilterType } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.filter;
const C_DEEP = bandShade(FC.tone, 0.22);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.58);
const C_GLOW = bandShade(FC.tone, 0.88);
const C_CUT = bandShade(FC.tone, 0.48);
const C_RESO = bandShade(FC.tone, 0.62);
const C_ENV = bandShade(FC.tone, 0.72);
const C_KEY = bandShade(FC.tone, 0.78);
const C_SAT = bandShade(FC.tone, 0.85);

const F_LO = 20;
const F_HI = 20000;
const CUT_MIN = 20;
const CUT_MAX = 18000;
const RES_MIN = 0.1;
const RES_MAX = 28;

const TYPE_CYCLE: FireFilterType[] = ["lowpass", "bandpass", "highpass", "notch"];

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

function logNorm(f: number, lo: number, hi: number) {
  return Math.log(clamp(f, lo, hi) / lo) / Math.log(hi / lo);
}

function filterGain(type: FireFilterType, f: number, cutoff: number, res: number): number {
  const r = f / Math.max(30, cutoff);
  const peak = Math.min(1, Math.log10(Math.max(1, res)) * 0.78);
  const bump = peak * Math.exp(-Math.pow(Math.log2(Math.max(1e-6, r)), 2) * 9);
  let g: number;
  if (type === "lowpass") g = 1 / Math.sqrt(1 + Math.pow(r, 4));
  else if (type === "highpass") g = 1 / Math.sqrt(1 + Math.pow(1 / Math.max(1e-6, r), 4));
  else if (type === "bandpass") g = Math.exp(-Math.pow(Math.log2(Math.max(1e-6, r)), 2) * 1.4);
  else g = 1 - Math.exp(-Math.pow(Math.log2(Math.max(1e-6, r)), 2) * 9);
  return Math.min(1.65, g + (type === "notch" ? 0 : bump));
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

export function FilterStageViz() {
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const res = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const envAmt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const keyTrack = useFireCommandStore((s) => s.patch.filterKeyTrack) ?? 0.3;
  const sat = useFireCommandStore((s) => s.patch.filterDrive) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<"xy" | "sat" | null>(null);
  const prevKey = useRef("");
  const waterfallRef = useRef<number[][]>([]);
  const st = useRef({ type, cutoff, res, envAmt, keyTrack, sat });
  st.current = { type, cutoff, res, envAmt, keyTrack, sat };

  const sculpted = Math.abs(Math.log10(cutoff / 2600)) > 0.08 || res > 1.2 || Math.abs(envAmt) > 0.05 || sat > 0.05 || keyTrack > 0.35;

  useEffect(() => {
    const key = `${type}|${cutoff.toFixed(1)}|${res.toFixed(2)}|${envAmt.toFixed(3)}|${keyTrack.toFixed(3)}|${sat.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [type, cutoff, res, envAmt, keyTrack, sat]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      const cut = logLerp(x, CUT_MIN, CUT_MAX);
      // Up = more reso (inverse Y)
      const q = logLerp(1 - y, RES_MIN, RES_MAX);
      setParam("filterCutoff", Math.round(cut));
      setParam("filterResonance", Math.round(q * 100) / 100);
    },
    [setParam],
  );

  const applySat = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("filterDrive", Math.round(x * 1000) / 1000);
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
        dragRef.current = "sat";
        wrap.setPointerCapture(e.pointerId);
        applySat(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applySat],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "sat") applySat(e.clientX);
    },
    [applyXy, applySat],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const i = TYPE_CYCLE.indexOf(st.current.type);
    const next = TYPE_CYCLE[(i + 1) % TYPE_CYCLE.length]!;
    setParam("filterType", next);
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
      const top = 22;
      const usableH = Hh - 42;
      const peak = Math.min(1, Math.log10(Math.max(1, p.res)) * 0.78);
      const heat = p.sat;
      const energy = 0.2 + peak * 0.45 + heat * 0.35 + Math.abs(p.envAmt) * 0.15 + flashRef.current * 0.2;

      const xOf = (f: number) => PAD + logNorm(f, F_LO, F_HI) * (W - PAD * 2);
      const yOf = (g: number) => top + (1 - Math.min(1, g / 1.65)) * usableH;

      ctx.clearRect(0, 0, W, Hh);

      // Tone-gold chamber
      const cxGlow = xOf(p.cutoff);
      const bg = ctx.createRadialGradient(cxGlow, Hh * 0.38, 4, W * 0.5, Hh * 0.5, W * 0.78);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.28 + heat * 0.22));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(6,5,1,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Saturation heat wash
      if (heat > 0.04) {
        const hg = ctx.createLinearGradient(0, top + usableH, 0, top);
        hg.addColorStop(0, hexAlpha(C_SAT, 0.08 + heat * 0.28));
        hg.addColorStop(0.55, hexAlpha(C_HOT, 0.04 * heat));
        hg.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, W, Hh);
      }

      // Log frequency grid
      ctx.strokeStyle = hexAlpha(C_MID, 0.1 + energy * 0.06);
      ctx.lineWidth = 1;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = xOf(f);
        ctx.globalAlpha = f === 1000 || f === 100 ? 0.45 : 0.18;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, top);
        ctx.lineTo(x + 0.5, top + usableH);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        const y = top + (usableH / 4) * i;
        ctx.globalAlpha = i === 2 ? 0.35 : 0.14;
        ctx.beginPath();
        ctx.moveTo(PAD, y + 0.5);
        ctx.lineTo(W - PAD, y + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Key-track ladder (right side) — denser / brighter with keyTrack
      if (p.keyTrack > 0.02) {
        const keys = Math.round(4 + p.keyTrack * 8);
        for (let i = 0; i < keys; i++) {
          const t = i / Math.max(1, keys - 1);
          const f = logLerp(t, 110, 3520);
          const x = xOf(f);
          const h = 6 + p.keyTrack * 10;
          ctx.fillStyle = hexAlpha(C_KEY, 0.18 + p.keyTrack * 0.45);
          ctx.fillRect(x - 1, top + usableH - h, 2, h);
          if (i % 2 === 0) {
            ctx.fillStyle = hexAlpha(C_KEY, 0.35 + p.keyTrack * 0.3);
            ctx.fillRect(x - 1.5, top + usableH - h - 3, 3, 3);
          }
        }
        // Sweep arc hint from cutoff
        ctx.strokeStyle = hexAlpha(C_KEY, 0.2 + p.keyTrack * 0.35);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(cxGlow, top + usableH, 18 + p.keyTrack * 28, -Math.PI * 0.85, -Math.PI * 0.15);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Sample response curve
      const N = 140;
      const pts: { x: number; y: number; g: number; f: number }[] = [];
      for (let i = 0; i <= N; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / N);
        const g = filterGain(p.type, f, p.cutoff, p.res);
        pts.push({ x: xOf(f), y: yOf(g), g, f });
      }

      // Waterfall history
      const hist = waterfallRef.current;
      hist.unshift(pts.map((pt) => pt.y));
      if (hist.length > 20) hist.pop();
      for (let h = hist.length - 1; h >= 1; h--) {
        const line = hist[h]!;
        const age = h / hist.length;
        ctx.beginPath();
        for (let i = 0; i < line.length; i++) {
          const x = pts[i]!.x;
          const y = line[i]! + h * 0.7;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_MID, (1 - age) * 0.18);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }

      // Env ghost curve (cutoff shifted by env amount)
      if (Math.abs(p.envAmt) > 0.03) {
        const envCut = clamp(p.cutoff * Math.pow(2, p.envAmt * 3.5), CUT_MIN, CUT_MAX);
        ctx.beginPath();
        for (let i = 0; i <= N; i += 2) {
          const f = F_LO * Math.pow(F_HI / F_LO, i / N);
          const g = filterGain(p.type, f, envCut, p.res);
          const x = xOf(f);
          const y = yOf(g);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_ENV, 0.35 + Math.abs(p.envAmt) * 0.4);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.shadowBlur = 6;
        ctx.shadowColor = C_ENV;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);

        // Env arrow
        const dx = p.envAmt * (W * 0.08);
        const ay = top + 10;
        ctx.strokeStyle = hexAlpha(C_ENV, 0.7);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cxGlow, ay);
        ctx.lineTo(cxGlow + dx, ay);
        ctx.stroke();
        ctx.fillStyle = hexAlpha(C_ENV, 0.85);
        ctx.beginPath();
        ctx.moveTo(cxGlow + dx, ay);
        ctx.lineTo(cxGlow + dx - Math.sign(dx || 1) * 7, ay - 4);
        ctx.lineTo(cxGlow + dx - Math.sign(dx || 1) * 7, ay + 4);
        ctx.closePath();
        ctx.fill();
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_ENV, 0.65);
        ctx.textAlign = "center";
        ctx.fillText("ENV", cxGlow + dx * 0.5, ay - 6);
      }

      // Filled blade body
      ctx.beginPath();
      ctx.moveTo(PAD, top + usableH);
      for (const pt of pts) ctx.lineTo(pt.x, pt.y);
      ctx.lineTo(W - PAD, top + usableH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, top, 0, top + usableH);
      fill.addColorStop(0, hexAlpha(C_GLOW, 0.35 + peak * 0.25 + heat * 0.15));
      fill.addColorStop(0.45, hexAlpha(C_HOT, 0.14 + energy * 0.1));
      fill.addColorStop(1, hexAlpha(C_DEEP, 0.04));
      ctx.fillStyle = fill;
      ctx.fill();

      // Resonance bloom at peak
      let peakPt = pts[0]!;
      for (const pt of pts) if (pt.g > peakPt.g) peakPt = pt;
      if (peak > 0.06) {
        for (let r = 0; r < 4; r++) {
          const ringPhase = ((now / 700) + r * 0.25) % 1;
          const ringR = 10 + ringPhase * (22 + peak * 30);
          ctx.strokeStyle = hexAlpha(C_RESO, (0.45 + peak * 0.35) * (1 - ringPhase));
          ctx.lineWidth = 2 - ringPhase * 1.4;
          ctx.shadowBlur = 8 + peak * 12;
          ctx.shadowColor = C;
          ctx.beginPath();
          ctx.arc(peakPt.x, peakPt.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        const bloom = ctx.createRadialGradient(peakPt.x, peakPt.y, 0, peakPt.x, peakPt.y, 20 + peak * 30);
        bloom.addColorStop(0, hexAlpha(C_GLOW, 0.5 + peak * 0.4 + flashRef.current * 0.25));
        bloom.addColorStop(0.5, hexAlpha(C_RESO, 0.18));
        bloom.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(peakPt.x, peakPt.y, 20 + peak * 30, 0, Math.PI * 2);
        ctx.fill();
      }

      // Main spectral blade stroke
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i]!;
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.75 + energy * 0.25);
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 12 + peak * 14 + flashRef.current * 16;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Type-shaped edge highlight (blade tip markers)
      if (p.type === "lowpass" || p.type === "highpass") {
        ctx.fillStyle = hexAlpha(C_CUT, 0.55);
        ctx.beginPath();
        ctx.moveTo(cxGlow, top + 4);
        ctx.lineTo(cxGlow + (p.type === "lowpass" ? -8 : 8), top + 14);
        ctx.lineTo(cxGlow + (p.type === "lowpass" ? 8 : -8), top + 14);
        ctx.closePath();
        ctx.fill();
      } else if (p.type === "bandpass") {
        ctx.strokeStyle = hexAlpha(C_CUT, 0.7);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cxGlow - 10, top + 4, 20, 8);
      } else {
        // Notch — cut mark
        ctx.strokeStyle = hexAlpha(C_CUT, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cxGlow - 7, top + 6);
        ctx.lineTo(cxGlow + 7, top + 14);
        ctx.moveTo(cxGlow + 7, top + 6);
        ctx.lineTo(cxGlow - 7, top + 14);
        ctx.stroke();
      }

      // Cutoff laser blade
      const pulse = 0.6 + 0.4 * Math.sin(now / 380);
      const laser = ctx.createLinearGradient(cxGlow - 2, top, cxGlow + 2, top + usableH);
      laser.addColorStop(0, hexAlpha(C_GLOW, 0.15 * pulse));
      laser.addColorStop(0.5, hexAlpha("#fff8e0", 0.55 * pulse + flashRef.current * 0.25));
      laser.addColorStop(1, hexAlpha(C_CUT, 0.2 * pulse));
      ctx.fillStyle = laser;
      ctx.shadowBlur = 10 * pulse + flashRef.current * 8;
      ctx.shadowColor = C;
      ctx.fillRect(cxGlow - 2, top, 4, usableH);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.55);
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cxGlow, top);
      ctx.lineTo(cxGlow, top + usableH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Crosshair at cutoff × reso
      const hy = yOf(filterGain(p.type, p.cutoff, p.cutoff, p.res));
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.45 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cxGlow - 8, hy);
      ctx.lineTo(cxGlow + 8, hy);
      ctx.moveTo(cxGlow, hy - 8);
      ctx.lineTo(cxGlow, hy + 8);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_HOT, 0.85);
      ctx.beginPath();
      ctx.arc(cxGlow, hy, 3 + flashRef.current * 2, 0, Math.PI * 2);
      ctx.fill();

      // Sat sparks along the floor
      if (heat > 0.06 && Math.random() < 0.15 + heat * 0.4) {
        sparks.push({
          x: PAD + Math.random() * (W - PAD * 2),
          y: top + usableH - 2,
          life: 1,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -1 - Math.random() * 2.5 * heat,
        });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.03;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        s.y += s.vy;
        ctx.fillStyle = hexAlpha(C_SAT, s.life * 0.75);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + heat * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sat rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_SAT, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const satW = (W - 24) * p.sat;
      if (p.sat > 0.01) {
        const sg = ctx.createLinearGradient(12, railY, 12 + satW, railY);
        sg.addColorStop(0, hexAlpha(C_HOT, 0.4));
        sg.addColorStop(1, hexAlpha(C_SAT, 0.95));
        ctx.fillStyle = sg;
        ctx.shadowBlur = 8 + heat * 10;
        ctx.shadowColor = C;
        ctx.fillRect(12, railY, satW, 7);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + satW, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_SAT, 0.7);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("SAT", 14, railY - 3);

      // Mode chip
      const modeLabel = p.type.toUpperCase();
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const modeW = ctx.measureText(modeLabel).width + 12;
      const chipX = W * 0.5 - modeW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, modeW, 13);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.55 + flashRef.current * 0.3);
      ctx.lineWidth = 1;
      ctx.strokeRect(chipX, 6, modeW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(modeLabel, W * 0.5, 16);

      // Footer
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("FILT · SPECTRAL BLADE", 12, Hh - 2);
      ctx.textAlign = "right";
      const bits: string[] = [];
      bits.push(p.cutoff >= 1000 ? `${(p.cutoff / 1000).toFixed(p.cutoff >= 10000 ? 1 : 2)}k` : `${Math.round(p.cutoff)}Hz`);
      bits.push(`Q${p.res.toFixed(1)}`);
      if (Math.abs(p.envAmt) > 0.04) bits.push(`E${p.envAmt > 0 ? "+" : ""}${Math.round(p.envAmt * 100)}`);
      if (p.keyTrack > 0.05) bits.push(`K${Math.round(p.keyTrack * 100)}`);
      if (p.sat > 0.04) bits.push(`S${Math.round(p.sat * 100)}`);
      ctx.fillStyle = hexAlpha(C_HOT, 0.88);
      ctx.fillText(bits.join(" · "), W - 12, Hh - 2);
    
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
        borderColor: hexAlpha(C, sculpted ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, sculpted ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Cutoff ↔ / Reso ↕ · Bottom rail: Sat · Double-click: cycle LP→BP→HP→NT"
      role="img"
      aria-label="Filter spectral blade"
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
        Spectral Blade
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        {type.slice(0, 2)}
      </div>
    </div>
  );
}
