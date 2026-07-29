/**
 * FENV — Cutoff Sweep stage visualizer.
 * Filter ADSR · Env Amt (Signal Path Tone · FC.envFilt).
 * Drag A/D/S↕/R zones. Bottom rail: Env Amt (bipolar). Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FireFilterType } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useToneTelemetry } from "./useToneTelemetry";

const H = 176;
const C = FC.envFilt;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.9);
const C_A = bandShade(FC.tone, 0.42);
const C_D = bandShade(FC.tone, 0.55);
const C_S = bandShade(FC.tone, 0.68);
const C_R = bandShade(FC.tone, 0.78);
const C_AMT = bandShade(FC.tone, 0.85);
const C_FILT = FC.filter;

const A_MIN = 0.001;
const A_MAX = 3;
const D_MIN = 0.005;
const D_MAX = 3;
const R_MIN = 0.005;
const R_MAX = 4;
const F_LO = 20;
const F_HI = 20000;

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

type DragMode = "A" | "D" | "S" | "R" | "amt" | null;

export function FiltEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.filtAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.filtDecay) ?? 0.3;
  const sus = useFireCommandStore((s) => s.patch.filtSustain) ?? 0.5;
  const r = useFireCommandStore((s) => s.patch.filtRelease) ?? 0.3;
  const envAmt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const reso = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const setParam = useFireCommandStore((s) => s.setParam);
  
  const tel = useToneTelemetry();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const zoneRef = useRef({ x0: 0, x1: 0, x2: 0, x3: 0, x4: 0 });
  const prevKey = useRef("");
  const st = useRef({ a, d, sus, r, envAmt, cutoff, reso, type });
  st.current = { a, d, sus, r, envAmt, cutoff, reso, type };

  const sweeping = Math.abs(envAmt) > 0.04 || a > 0.04 || Math.abs(sus - 0.5) > 0.1;

  useEffect(() => {
    const key = `${a.toFixed(3)}|${d.toFixed(3)}|${sus.toFixed(3)}|${r.toFixed(3)}|${envAmt.toFixed(3)}|${cutoff}|${reso.toFixed(2)}|${type}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [a, d, sus, r, envAmt, cutoff, reso, type]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "amt") {
        setParam("filterEnvAmount", Math.round(clamp(x * 2 - 1, -1, 1) * 1000) / 1000);
        return;
      }
      const level = 1 - clamp(y / 0.72, 0, 1);
      if (mode === "S") {
        setParam("filtSustain", Math.round(level * 1000) / 1000);
        return;
      }
      if (mode === "A") setParam("filtAttack", Math.round(logLerp(x, A_MIN, A_MAX) * 1000) / 1000);
      else if (mode === "D") setParam("filtDecay", Math.round(logLerp(x, D_MIN, D_MAX) * 1000) / 1000);
      else if (mode === "R") setParam("filtRelease", Math.round(logLerp(x, R_MIN, R_MAX) * 1000) / 1000);
    },
    [setParam],
  );

  const hitZone = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    if (ly > H * 0.78) return "amt";
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
    setParam("filtAttack", 0.01);
    setParam("filtDecay", 0.3);
    setParam("filtSustain", 0.5);
    setParam("filtRelease", 0.3);
    setParam("filterEnvAmount", 0);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; life: number; vx: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const PAD = 14;
      const top = 24;
      const usableH = Hh - 48;
      const usableW = W - PAD * 2;
      const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.sus, p.r, usableW);
      const x0 = PAD;
      const x1 = x0 + wA;
      const x2 = x1 + wD;
      const x3 = x2 + wS;
      const x4 = x3 + wR;
      zoneRef.current = { x0, x1, x2, x3, x4 };

      const yLv = (lv: number) => top + (1 - clamp(lv, 0, 1)) * usableH;
      const amt = Math.abs(p.envAmt);
      const energy = 0.2 + p.sus * 0.2 + amt * 0.4 + flashRef.current * 0.25;
      const breathe = 0.94 + 0.06 * Math.sin(now / 720);

      ctx.clearRect(0, 0, W, Hh);

      // Tone-gold sweep chamber
      const bg = ctx.createRadialGradient(x1, Hh * 0.36, 4, W * 0.5, Hh * 0.48, W * 0.78);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.3 + flashRef.current * 0.25));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(6,5,1,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Stage washes
      const bands: Array<{ xa: number; xb: number; col: string; a: number }> = [
        { xa: x0, xb: x1, col: C_A, a: 0.1 },
        { xa: x1, xb: x2, col: C_D, a: 0.08 },
        { xa: x2, xb: x3, col: C_S, a: 0.1 + p.sus * 0.12 },
        { xa: x3, xb: x4, col: C_R, a: 0.08 },
      ];
      for (const b of bands) {
        ctx.fillStyle = hexAlpha(b.col, b.a);
        ctx.fillRect(b.xa, top, Math.max(1, b.xb - b.xa), usableH);
      }

      // Frequency band sweeps (horizon lines crawling with amt)
      const nBands = 6 + Math.round(amt * 5);
      for (let b = 0; b < nBands; b++) {
        const bandY = top + (usableH / nBands) * b;
        const bandH = usableH / nBands - 1;
        const sweep = ((now / 1600 + b * 0.12) % 1);
        const dir = p.envAmt >= 0 ? sweep : 1 - sweep;
        ctx.fillStyle = hexAlpha(b % 2 === 0 ? C_FILT : C_HOT, (0.04 + (1 - b / nBands) * 0.07 + amt * 0.06) * breathe);
        ctx.fillRect(x0, bandY, (x4 - x0) * dir, bandH);
      }

      const sweepPath = () => {
        ctx.moveTo(x0, yLv(0));
        ctx.bezierCurveTo(x0 + wA * 0.5, yLv(0.92 * breathe), x1 - wA * 0.1, yLv(1 * breathe), x1, yLv(1 * breathe));
        ctx.bezierCurveTo(x1 + wD * 0.45, yLv(p.sus + 0.18), x2 - wD * 0.15, yLv(p.sus), x2, yLv(p.sus));
        ctx.lineTo(x3, yLv(p.sus));
        ctx.bezierCurveTo(x3 + wR * 0.5, yLv(p.sus * 0.45), x4 - wR * 0.25, yLv(0.08), x4, yLv(0));
      };

      // Layered fill
      for (let layer = 3; layer >= 0; layer--) {
        ctx.beginPath();
        sweepPath();
        ctx.lineTo(x4, top + usableH);
        ctx.lineTo(x0, top + usableH);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, top, 0, top + usableH);
        fill.addColorStop(0, hexAlpha(C_GLOW, (0.32 - layer * 0.06) * breathe));
        fill.addColorStop(0.5, hexAlpha(C_FILT, 0.14 - layer * 0.03));
        fill.addColorStop(1, hexAlpha(C_DEEP, 0.03));
        ctx.fillStyle = fill;
        ctx.fill();
      }

      ctx.beginPath();
      sweepPath();
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.88 + flashRef.current * 0.12);
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 12 + energy * 10 + flashRef.current * 14;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Handles
      const handles = [
        { x: x1, y: yLv(1 * breathe), col: C_A, label: "A" },
        { x: x2, y: yLv(p.sus), col: C_D, label: "D" },
        { x: (x2 + x3) / 2, y: yLv(p.sus), col: C_S, label: "S" },
        { x: x4, y: yLv(0), col: C_R, label: "R" },
      ];
      for (const h of handles) {
        ctx.fillStyle = hexAlpha(h.col, 0.92);
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

      // Live telemetry cursor + cutoff laser sync
      const active = tel.voiceCount > 0;
      const telData = tel.filt;
      let sx = x0;
      let envLv = 0;
      if (active && telData) {
        const phase = clamp(telData.phase, 0, 1);
        envLv = clamp(telData.level, 0, 1);
        const stage = telData.stage;
        if (stage === "attack") sx = x0 + phase * wA;
        else if (stage === "decay") sx = x1 + phase * wD;
        else if (stage === "sustain") sx = x2 + phase * wS;
        else if (stage === "release" || stage === "decay_out") sx = x3 + phase * wR;
        else sx = x0 + phase * (x4 - x0);
      } else {
        const cycle = (now / 1700) % 1;
        sx = x0 + cycle * (x4 - x0);
        if (sx <= x1) envLv = (sx - x0) / Math.max(1, wA);
        else if (sx <= x2) envLv = 1 - ((sx - x1) / Math.max(1, wD)) * (1 - p.sus);
        else if (sx <= x3) envLv = p.sus;
        else envLv = p.sus * (1 - (sx - x3) / Math.max(1, wR));
      }
      const sy = yLv(envLv);

      // Env-modulated cutoff for ghost Bode
      const cutMod = clamp(p.cutoff * Math.pow(2, p.envAmt * envLv * 3.5), 40, 18000);
      const xOfF = (f: number) => PAD + logNorm(f, F_LO, F_HI) * usableW;
      const yOfG = (g: number) => top + (1 - Math.min(1, g / 1.65)) * usableH * 0.55 + usableH * 0.2;

      // Ghost filter response at playhead env level
      if (amt > 0.03) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const f = F_LO * Math.pow(F_HI / F_LO, i / 60);
          const g = filterGain(p.type, f, cutMod, p.reso);
          const x = xOfF(f);
          const y = yOfG(g);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_FILT, 0.25 + amt * 0.45);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Cutoff laser at modulated freq
      const cx = xOfF(cutMod);
      const laser = ctx.createLinearGradient(cx, top, cx, top + usableH);
      laser.addColorStop(0, hexAlpha(C_GLOW, 0.1));
      laser.addColorStop(0.5, hexAlpha("#fff8e0", 0.45 + amt * 0.3 + flashRef.current * 0.2));
      laser.addColorStop(1, hexAlpha(C_FILT, 0.15));
      ctx.fillStyle = laser;
      ctx.shadowBlur = 8 + amt * 10;
      ctx.shadowColor = C_FILT;
      ctx.fillRect(cx - 1.5, top, 3, usableH);
      ctx.shadowBlur = 0;

      // Sweep marker (bright when active)
      ctx.strokeStyle = hexAlpha(C_GLOW, active ? 0.75 : 0.35);
      ctx.lineWidth = active ? 2 : 1.5;
      ctx.setLineDash(active ? [] : [2, 2]);
      ctx.beginPath();
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff8e0";
      ctx.shadowBlur = active ? 16 : 10;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(sx, sy, (active ? 4.5 : 3.2) + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (active && telData && telData.stage !== "idle") {
        ctx.font = "900 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
        ctx.fillText(String(telData.stage).slice(0, 6).toUpperCase(), sx, sy - 12);
      }

      // Sparks along laser when amt high
      if (amt > 0.08 && Math.random() < 0.15 + amt * 0.35) {
        sparks.push({ x: cx, y: top + Math.random() * usableH, life: 1, vx: (Math.random() - 0.5) * 2 });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.03;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        ctx.fillStyle = hexAlpha(C_FILT, s.life * 0.7);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + amt, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mini Bode thumbnail (right)
      const thumbW = 44;
      const thumbH = 28 + p.sus * 14 + amt * 8;
      const thumbX = W - PAD - thumbW;
      const thumbY = top + 4;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
      ctx.strokeStyle = hexAlpha(C_FILT, 0.4 + amt * 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(thumbX + 0.5, thumbY + 0.5, thumbW - 1, thumbH - 1);
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / 24);
        const g = filterGain(p.type, f, cutMod, p.reso);
        const tx = thumbX + (i / 24) * thumbW;
        const ty = thumbY + (1 - Math.min(1, g / 1.65)) * thumbH;
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.75);
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 4;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexAlpha(C_FILT, 0.7);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.type.slice(0, 2).toUpperCase(), thumbX + thumbW / 2, thumbY + thumbH + 9);

      // Env Amt bipolar rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_AMT, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const midX = 12 + (W - 24) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(midX - 0.5, railY, 1, 7);
      const signedX = midX + p.envAmt * ((W - 24) / 2);
      if (Math.abs(p.envAmt) > 0.02) {
        const left = Math.min(midX, signedX);
        const right = Math.max(midX, signedX);
        const rg = ctx.createLinearGradient(left, railY, right, railY);
        rg.addColorStop(0, hexAlpha(C_FILT, 0.3));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.8));
        ctx.fillStyle = rg;
        ctx.fillRect(left, railY + 1, right - left, 5);
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(signedX, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexAlpha(C_AMT, 0.75);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("ENV AMT", 14, railY - 3);

      // Zone labels
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      const labels = [
        { x: (x0 + x1) / 2, t: "ATK", c: C_A },
        { x: (x1 + x2) / 2, t: "DEC", c: C_D },
        { x: (x2 + x3) / 2, t: "SUS", c: C_S },
        { x: (x3 + x4) / 2, t: "REL", c: C_R },
      ];
      for (const lb of labels) {
        ctx.fillStyle = hexAlpha(lb.c, 0.5);
        ctx.fillText(lb.t, lb.x, top + usableH + 11);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("FENV · CUTOFF SWEEP", 12, Hh - 2);
      ctx.textAlign = "right";
      const fmt = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
      const amtStr = `${p.envAmt > 0 ? "+" : ""}${Math.round(p.envAmt * 100)}`;
      ctx.fillStyle = hexAlpha(C_HOT, 0.88);
      ctx.fillText(`A${fmt(p.a)} · S${Math.round(p.sus * 100)} · E${amtStr}`, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: tel.voiceCount > 0,
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
        borderColor: hexAlpha(C, sweeping ? 0.55 : 0.32),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, sweeping ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag A/D/S/R zones · Bottom rail: Env Amt (±) · Double-click: defaults"
      role="img"
      aria-label="Filter envelope cutoff sweep"
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
        Cutoff Sweep
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        {envAmt > 0.04 ? `+${Math.round(envAmt * 100)}` : envAmt < -0.04 ? `${Math.round(envAmt * 100)}` : "FLAT"}
      </div>
    </div>
  );
}
