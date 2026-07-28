/**
 * MOD — Morph Weaver stage visualizer.
 * Mod ADSR · Env→WT A/B/C (Signal Path Tone · FC.envMod).
 * Drag A/D/S↕/R zones. Bottom rail: cycle morph depth for focused osc. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.envMod;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.9);
const C_A = bandShade(FC.tone, 0.42);
const C_D = bandShade(FC.tone, 0.55);
const C_S = bandShade(FC.tone, 0.68);
const C_R = bandShade(FC.tone, 0.78);
const C_MORPH = bandShade(FC.tone, 0.85);
const C_OA = FC.oscA;
const C_OB = FC.oscB;
const C_OC = FC.oscC;

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

type DragMode = "A" | "D" | "S" | "R" | "morph" | null;
type MorphFocus = "a" | "b" | "c";

export function ModEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.modAttack) ?? 0.02;
  const d = useFireCommandStore((s) => s.patch.modDecay) ?? 0.5;
  const sus = useFireCommandStore((s) => s.patch.modSustain) ?? 0.3;
  const r = useFireCommandStore((s) => s.patch.modRelease) ?? 0.4;
  const envA = useFireCommandStore((s) => s.patch.oscAEnv) ?? 0;
  const envB = useFireCommandStore((s) => s.patch.oscBEnv) ?? 0;
  const envC = useFireCommandStore((s) => s.patch.oscCEnv) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const focusRef = useRef<MorphFocus>("a");
  const zoneRef = useRef({ x0: 0, x1: 0, x2: 0, x3: 0, x4: 0 });
  const prevKey = useRef("");
  const st = useRef({ a, d, sus, r, envA, envB, envC });
  st.current = { a, d, sus, r, envA, envB, envC };

  const morphAmt = Math.max(Math.abs(envA), Math.abs(envB), Math.abs(envC));
  const weaving = morphAmt > 0.04 || a > 0.05 || Math.abs(sus - 0.3) > 0.08;

  useEffect(() => {
    const key = `${a.toFixed(3)}|${d.toFixed(3)}|${sus.toFixed(3)}|${r.toFixed(3)}|${envA.toFixed(3)}|${envB.toFixed(3)}|${envC.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [a, d, sus, r, envA, envB, envC]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "morph") {
        // bipolar: left=−1, center=0, right=+1 — or map x as signed from center
        const signed = clamp(x * 2 - 1, -1, 1);
        const key = focusRef.current === "a" ? "oscAEnv" : focusRef.current === "b" ? "oscBEnv" : "oscCEnv";
        setParam(key, Math.round(signed * 1000) / 1000);
        return;
      }
      const level = 1 - clamp(y / 0.72, 0, 1);
      if (mode === "S") {
        setParam("modSustain", Math.round(level * 1000) / 1000);
        return;
      }
      if (mode === "A") setParam("modAttack", Math.round(logLerp(x, A_MIN, A_MAX) * 1000) / 1000);
      else if (mode === "D") setParam("modDecay", Math.round(logLerp(x, D_MIN, D_MAX) * 1000) / 1000);
      else if (mode === "R") setParam("modRelease", Math.round(logLerp(x, R_MIN, R_MAX) * 1000) / 1000);
    },
    [setParam],
  );

  const hitZone = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    if (ly > H * 0.78) {
      // Click thirds of morph rail to focus A/B/C
      const t = lx / Math.max(1, rect.width);
      focusRef.current = t < 0.33 ? "a" : t < 0.66 ? "b" : "c";
      return "morph";
    }
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
    setParam("modAttack", 0.02);
    setParam("modDecay", 0.5);
    setParam("modSustain", 0.3);
    setParam("modRelease", 0.4);
    setParam("oscAEnv", 0);
    setParam("oscBEnv", 0);
    setParam("oscCEnv", 0);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const shards: Array<{ x: number; y: number; life: number; vx: number; phase: number }> = [];

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
      const morphMag = Math.max(Math.abs(p.envA), Math.abs(p.envB), Math.abs(p.envC));
      const energy = 0.22 + p.sus * 0.2 + morphMag * 0.35 + flashRef.current * 0.25;
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      const breathe = 0.94 + 0.06 * Math.sin(now / 680);
      const focus = focusRef.current;

      ctx.clearRect(0, 0, W, Hh);

      // Tone-gold morph chamber
      const cx = x1 + (x2 - x1) * 0.3;
      const bg = ctx.createRadialGradient(cx, Hh * 0.36, 4, W * 0.5, Hh * 0.48, W * 0.78);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.32 + flashRef.current * 0.25));
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

      // Wavetable scan field — density from morph + sustain
      const scans = 5 + Math.round(morphMag * 6);
      for (let scan = 0; scan < scans; scan++) {
        const sy = top + 6 + scan * ((usableH - 12) / Math.max(1, scans - 1));
        ctx.strokeStyle = hexAlpha(C_MID, (0.08 + pulse * 0.07 + morphMag * 0.12) * breathe);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = x0; x <= x4; x += 2.5) {
          const u = (x - x0) / Math.max(1, x4 - x0);
          const wob =
            Math.sin(u * Math.PI * (5 + morphMag * 8) + now / 180 + scan * 0.7) *
            (3 + morphMag * 8 + p.sus * 4) *
            breathe;
          // Envelope-shaped amplitude
          let envH = 0;
          if (x <= x1) envH = (x - x0) / Math.max(1, wA);
          else if (x <= x2) envH = 1 - ((x - x1) / Math.max(1, wD)) * (1 - p.sus);
          else if (x <= x3) envH = p.sus;
          else envH = p.sus * (1 - (x - x3) / Math.max(1, wR));
          const yy = sy + wob * envH;
          if (x === x0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      const morphPath = () => {
        ctx.moveTo(x0, yLv(0));
        ctx.bezierCurveTo(x0 + wA * 0.4, yLv(0.85 * breathe), x0 + wA * 0.7, yLv(1 * breathe), x1, yLv(1 * breathe));
        ctx.bezierCurveTo(x1 + wD * 0.3, yLv(p.sus + 0.2), x1 + wD * 0.7, yLv(p.sus), x2, yLv(p.sus));
        ctx.lineTo(x3, yLv(p.sus));
        ctx.bezierCurveTo(x3 + wR * 0.4, yLv(p.sus * 0.55), x3 + wR * 0.75, yLv(0.08), x4, yLv(0));
      };

      // Layered weaver fill
      for (let layer = 3; layer >= 0; layer--) {
        ctx.beginPath();
        morphPath();
        ctx.lineTo(x4, top + usableH);
        ctx.lineTo(x0, top + usableH);
        ctx.closePath();
        const fill = ctx.createLinearGradient(x0, 0, x4, 0);
        fill.addColorStop(0, hexAlpha(C_A, (0.1 - layer * 0.02) * breathe));
        fill.addColorStop(0.35, hexAlpha(C_HOT, (0.28 + pulse * 0.1 - layer * 0.05) * breathe));
        fill.addColorStop(0.7, hexAlpha(C_S, 0.16 - layer * 0.03));
        fill.addColorStop(1, hexAlpha(C_DEEP, 0.04));
        ctx.fillStyle = fill;
        ctx.fill();
      }

      // Dashed morph contour
      ctx.beginPath();
      morphPath();
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.85 + flashRef.current * 0.15);
      ctx.lineWidth = 2.4;
      ctx.setLineDash([6, 4]);
      ctx.shadowBlur = 12 + energy * 10 + flashRef.current * 14;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.setLineDash([]);
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

      // Morph orb traveling sustain — driven by env amounts
      const orbT = (now / (900 + (1 - morphMag) * 800)) % 1;
      const orbX = x2 + (x3 - x2) * orbT;
      const orbY = yLv(p.sus);
      const orbCol = focus === "a" ? C_OA : focus === "b" ? C_OB : C_OC;
      const orbGlow = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, 14 + pulse * 8 + morphMag * 10);
      orbGlow.addColorStop(0, hexAlpha(C_GLOW, 0.7 + pulse * 0.2));
      orbGlow.addColorStop(0.4, hexAlpha(orbCol, 0.35 + morphMag * 0.25));
      orbGlow.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = orbGlow;
      ctx.beginPath();
      ctx.arc(orbX, orbY, 16 + morphMag * 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha("#fff8e0", 0.85);
      ctx.shadowBlur = 14;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(orbX, orbY, 3.8 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Frame scrub ticks (wavetable frames) — amount follows morph
      const frames = 8 + Math.round(morphMag * 10);
      for (let i = 0; i < frames; i++) {
        const fx = x0 + ((i + ((now / 400) % 1)) / frames) * usableW;
        const fh = 4 + morphMag * 10 * Math.abs(Math.sin(i + now / 300));
        ctx.fillStyle = hexAlpha(C_MORPH, 0.15 + morphMag * 0.35);
        ctx.fillRect(fx, top + usableH - fh, 1.5, fh);
      }

      // Morph shards
      if (morphMag > 0.05 && Math.random() < 0.12 + morphMag * 0.3) {
        shards.push({
          x: x0 + Math.random() * usableW,
          y: top + Math.random() * usableH,
          life: 1,
          vx: (Math.random() - 0.5) * 2,
          phase: Math.random() * Math.PI * 2,
        });
      }
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i]!;
        s.life -= 0.025;
        if (s.life <= 0) {
          shards.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        s.y += Math.sin(now / 200 + s.phase) * 0.4;
        ctx.fillStyle = hexAlpha(C_HOT, s.life * 0.65);
        ctx.fillRect(s.x, s.y, 2 + morphMag * 2, 2);
      }

      // Destination meters (left stack) — Env→WT A/B/C
      const dests: Array<{ v: number; col: string; label: string }> = [
        { v: p.envA, col: C_OA, label: "A" },
        { v: p.envB, col: C_OB, label: "B" },
        { v: p.envC, col: C_OC, label: "C" },
      ];
      dests.forEach((m, i) => {
        const my = top + 4 + i * 22;
        const bw = 28;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(PAD, my, bw, 8);
        const mid = PAD + bw / 2;
        const mag = Math.abs(m.v);
        if (mag > 0.02) {
          const w = (bw / 2) * mag;
          ctx.fillStyle = hexAlpha(m.col, 0.75);
          ctx.shadowBlur = 6;
          ctx.shadowColor = m.col;
          if (m.v >= 0) ctx.fillRect(mid, my, w, 8);
          else ctx.fillRect(mid - w, my, w, 8);
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = hexAlpha(m.col, focus === (i === 0 ? "a" : i === 1 ? "b" : "c") ? 0.95 : 0.5);
        ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(m.label, PAD + bw + 4, my + 7);
      });

      // Morph rail (bipolar for focused osc)
      const railY = Hh - 16;
      const focusVal = focus === "a" ? p.envA : focus === "b" ? p.envB : p.envC;
      const focusCol = focus === "a" ? C_OA : focus === "b" ? C_OB : C_OC;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_MORPH, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      // center zero
      const midX = 12 + (W - 24) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(midX - 0.5, railY, 1, 7);
      const signedX = midX + focusVal * ((W - 24) / 2);
      ctx.fillStyle = hexAlpha(focusCol, 0.85);
      ctx.shadowBlur = 8;
      ctx.shadowColor = focusCol;
      ctx.beginPath();
      ctx.arc(signedX, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // fill from center to knob
      if (Math.abs(focusVal) > 0.02) {
        const left = Math.min(midX, signedX);
        const right = Math.max(midX, signedX);
        const rg = ctx.createLinearGradient(left, railY, right, railY);
        rg.addColorStop(0, hexAlpha(focusCol, 0.25));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.7));
        ctx.fillStyle = rg;
        ctx.fillRect(left, railY + 1, right - left, 5);
      }
      ctx.fillStyle = hexAlpha(C_MORPH, 0.75);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`→WT ${focus.toUpperCase()}`, 14, railY - 3);

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
      ctx.fillText("MOD · MORPH WEAVER", 12, Hh - 2);
      ctx.textAlign = "right";
      const fmt = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
      ctx.fillStyle = hexAlpha(C_HOT, 0.88);
      ctx.fillText(`A${fmt(p.a)} · S${Math.round(p.sus * 100)} · →${Math.round(morphMag * 100)}`, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: shards.length,
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
        borderColor: hexAlpha(C, weaving ? 0.55 : 0.32),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, weaving ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag A/D/S/R zones · Bottom rail: Env→WT (thirds = A/B/C focus) · Double-click: defaults"
      role="img"
      aria-label="Mod envelope morph weaver"
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
        Morph Weaver
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        →WT
      </div>
    </div>
  );
}
