/**
 * FM · Ring — Sideband Forge stage visualizer.
 * Classic 2-op FM + ring + B→A cross (Signal Path Mod · FC.fm).
 * Drag: Ratio ↔ / Amount ↕. Bottom thirds: B→A | Ring | Ring Hz. Double-click: harmonic ratio.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.fm;
const C_DEEP = bandShade(FC.mod, 0.22);
const C_MID = bandShade(FC.mod, 0.42);
const C_HOT = bandShade(FC.mod, 0.62);
const C_GLOW = bandShade(FC.mod, 0.92);
const C_AMT = bandShade(FC.mod, 0.5);
const C_RATIO = bandShade(FC.mod, 0.68);
const C_BA = bandShade(FC.mod, 0.78);
const C_RING = bandShade(FC.mod, 0.88);
const C_A = FC.oscA;
const C_B = FC.oscB;

const RATIO_MIN = 0.5;
const RATIO_MAX = 12;
const RING_MIN = 20;
const RING_MAX = 4000;

const HARMONIC_CYCLE = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 7] as const;

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

type DragMode = "xy" | "ba" | "ringAmt" | "ringHz" | null;

function nearestHarmonic(ratio: number): (typeof HARMONIC_CYCLE)[number] {
  let best: (typeof HARMONIC_CYCLE)[number] = HARMONIC_CYCLE[0]!;
  let bestD = Infinity;
  for (const r of HARMONIC_CYCLE) {
    const d = Math.abs(Math.log2(ratio / r));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function FmStageViz() {
  const fm = useFireCommandStore((s) => s.patch.fmAmount) ?? 0;
  const ratio = useFireCommandStore((s) => s.patch.fmRatio) ?? 2;
  const bToA = useFireCommandStore((s) => s.patch.fmBtoA) ?? 0;
  const ring = useFireCommandStore((s) => s.patch.ringAmount) ?? 0;
  const ringHz = useFireCommandStore((s) => s.patch.ringFreq) ?? 220;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ fm, ratio, bToA, ring, ringHz });
  st.current = { fm, ratio, bToA, ring, ringHz };

  const live = fm > 0.02 || bToA > 0.02 || ring > 0.02;

  useEffect(() => {
    const key = `${fm.toFixed(3)}|${ratio.toFixed(3)}|${bToA.toFixed(3)}|${ring.toFixed(3)}|${ringHz.toFixed(1)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [fm, ratio, bToA, ring, ringHz]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("fmRatio", Math.round(logLerp(x, RATIO_MIN, RATIO_MAX) * 100) / 100);
      setParam("fmAmount", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyRail = useCallback(
    (clientX: number, mode: Exclude<DragMode, "xy" | null>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      if (mode === "ba") {
        // First third local X
        const local = clamp((x - 0) / 0.33, 0, 1);
        setParam("fmBtoA", Math.round(local * 1000) / 1000);
      } else if (mode === "ringAmt") {
        const local = clamp((x - 0.33) / 0.34, 0, 1);
        setParam("ringAmount", Math.round(local * 1000) / 1000);
      } else {
        const local = clamp((x - 0.67) / 0.33, 0, 1);
        setParam("ringFreq", Math.round(logLerp(local, RING_MIN, RING_MAX)));
      }
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (y > H * 0.78) {
        const mode: DragMode = x < 0.33 ? "ba" : x < 0.67 ? "ringAmt" : "ringHz";
        dragRef.current = mode;
        wrap.setPointerCapture(e.pointerId);
        applyRail(e.clientX, mode);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyRail],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const m = dragRef.current;
      if (m === "xy") applyXy(e.clientX, e.clientY);
      else if (m) applyRail(e.clientX, m);
    },
    [applyXy, applyRail],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = nearestHarmonic(st.current.ratio);
    const i = HARMONIC_CYCLE.indexOf(cur);
    const next = HARMONIC_CYCLE[(i + 1) % HARMONIC_CYCLE.length]!;
    setParam("fmRatio", next);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; vx: number; life: number; col: string }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const mid = Hh * 0.4;
      const amp = Hh * (0.12 + p.fm * 0.28 + p.ring * 0.08);
      const ratioN = logNorm(p.ratio, RATIO_MIN, RATIO_MAX);
      const ringN = logNorm(p.ringHz, RING_MIN, RING_MAX);
      const energy = 0.15 + p.fm * 0.4 + p.bToA * 0.15 + p.ring * 0.25 + flashRef.current * 0.25;
      const isLive = p.fm > 0.02 || p.bToA > 0.02 || p.ring > 0.02;

      let engT = now / 1000;
      try {
        engT = getEngine().ctx.currentTime;
      } catch { /* */ }

      ctx.clearRect(0, 0, W, Hh);

      // Forge chamber
      const bg = ctx.createRadialGradient(W * (0.4 + ratioN * 0.15), mid, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.35 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(2,6,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Ring interference field
      if (p.ring > 0.02) {
        for (let layer = 0; layer < 4; layer++) {
          ctx.beginPath();
          for (let i = 0; i <= W; i += 2) {
            const u = i / W;
            const beat =
              Math.sin(u * Math.PI * 2 * (2 + ringN * 10) + engT * (3 + layer) + layer) *
              Math.sin(u * Math.PI * 2 * (1.3 + ringN * 4) - engT * 2.2);
            const y = mid + beat * amp * 0.55 * p.ring;
            if (i === 0) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          }
          ctx.strokeStyle = hexAlpha(C_RING, (0.1 + p.ring * 0.18) / (layer + 1));
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // Sideband spectrum forge (left cluster)
      const specX = 18;
      const specW = Math.min(110, W * 0.28);
      const bands = Math.min(11, Math.max(3, Math.round(2 + p.ratio * 1.4 + p.fm * 4)));
      const carrierI = Math.floor(bands / 2);
      for (let i = 0; i < bands; i++) {
        const order = i - carrierI;
        const bx = specX + (i + 0.5) * (specW / bands);
        // Bessel-ish envelope: sidebands grow with index, peak near ±ratio-ish
        const env =
          order === 0
            ? 0.55 + p.fm * 0.35
            : Math.exp(-Math.abs(order) * (0.35 - p.fm * 0.2)) * (0.25 + p.fm * 0.9);
        const hBar = env * amp * 1.6 * (0.4 + p.fm);
        const col = order === 0 ? C_GLOW : order % 2 === 0 ? C_HOT : C_MID;
        ctx.fillStyle = hexAlpha(col, 0.25 + env * 0.55 + flashRef.current * 0.15);
        ctx.shadowBlur = order === 0 ? 8 : 3;
        ctx.shadowColor = col;
        ctx.fillRect(bx - 2.5, mid - hBar, 5, hBar * 2);
        ctx.shadowBlur = 0;
        // tick label for carrier
        if (order === 0) {
          ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("C", bx, mid + hBar + 10);
        }
      }
      // ratio braces between sidebands
      ctx.strokeStyle = hexAlpha(C_RATIO, 0.35 + p.fm * 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(specX, mid - amp * 1.7);
      ctx.lineTo(specX + specW, mid - amp * 1.7);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_RATIO, 0.75);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${p.ratio.toFixed(2)}×`, specX, mid - amp * 1.7 - 4);

      // Main FM waveform
      const xL = specX + specW + 16;
      const xR = W - 14;
      const span = Math.max(1, xR - xL);
      ctx.beginPath();
      for (let x = xL; x <= xR; x += 1) {
        const u = (x - xL) / span;
        const mod = Math.sin(u * Math.PI * 2 * p.ratio + engT * 4) * p.fm * (2.2 + p.bToA);
        const carrier = Math.sin(u * Math.PI * 2 * 3 + mod + engT * 2.5);
        const ringSig =
          Math.sin(u * Math.PI * 2 * (1 + ringN * 6) + engT * 3) *
          Math.sin(u * Math.PI * 2 * 5 - engT * 1.5);
        const y =
          mid -
          (carrier * (1 - p.ring * 0.45) + ringSig * p.ring * 0.85) *
            amp *
            (0.45 + p.fm * 0.55 + p.bToA * 0.15);
        if (x === xL) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.88 + flashRef.current * 0.12);
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 10 + p.fm * 14 + flashRef.current * 10;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill under FM ribbon
      ctx.lineTo(xR, mid);
      ctx.lineTo(xL, mid);
      ctx.closePath();
      const ribbon = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      ribbon.addColorStop(0, hexAlpha(C_GLOW, 0.18 + p.fm * 0.22));
      ribbon.addColorStop(0.5, hexAlpha(C, 0.06));
      ribbon.addColorStop(1, hexAlpha(C_DEEP, 0.02));
      ctx.fillStyle = ribbon;
      ctx.fill();

      // Carrier / Modulator forge nodes (right cluster)
      const cx = W * 0.78;
      const cy = mid;
      const R = 16 + p.fm * 10;
      const sep = R * (0.85 + p.ratio * 0.04);
      // C
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.7 + p.fm * 0.25);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(cx - sep * 0.5, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C, 0.12 + p.fm * 0.1);
      ctx.fill();
      // M
      ctx.strokeStyle = hexAlpha(C_HOT, 0.7 + p.fm * 0.25);
      ctx.shadowColor = C_HOT;
      ctx.beginPath();
      ctx.arc(cx + sep * 0.5, cy, R * (0.7 + Math.min(0.4, p.ratio / 12)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_HOT, 0.1 + p.fm * 0.12);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Sideband spokes from modulator into carrier
      const spokes = Math.min(14, Math.max(3, Math.round(p.ratio * 2 + p.fm * 6)));
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2 + engT * 0.8;
        const len = R * (1.2 + p.fm * 0.9 + Math.sin(engT * 3 + i) * 0.2);
        const mx = cx + sep * 0.5;
        const my = cy;
        ctx.strokeStyle = hexAlpha(i % 2 ? C_HOT : C_GLOW, 0.25 + p.fm * 0.35);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(ang) * len, my + Math.sin(ang) * len * 0.65);
        ctx.stroke();
      }

      // Link C↔M
      ctx.strokeStyle = hexAlpha(C_RATIO, 0.4 + p.fm * 0.35);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - sep * 0.5 + R * 0.7, cy);
      ctx.lineTo(cx + sep * 0.5 - R * 0.55, cy);
      ctx.stroke();
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.fillText("C", cx - sep * 0.5, cy + 3);
      ctx.fillStyle = hexAlpha(C_HOT, 0.9);
      ctx.fillText("M", cx + sep * 0.5, cy + 3);

      // B→A crossfire bolt
      if (p.bToA > 0.02) {
        const ax = 28;
        const ay = Hh * 0.72;
        const bx = 28 + 70 * p.bToA;
        const by = Hh * 0.58 - p.bToA * 18;
        const bolt = ctx.createLinearGradient(ax, ay, bx, by);
        bolt.addColorStop(0, hexAlpha(C_B, 0.85));
        bolt.addColorStop(1, hexAlpha(C_A, 0.9));
        ctx.strokeStyle = bolt;
        ctx.lineWidth = 2 + p.bToA * 3;
        ctx.shadowBlur = 8 + p.bToA * 10;
        ctx.shadowColor = C_BA;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(ax + 20, ay - 30 * p.bToA, bx, by);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = hexAlpha(C_A, 0.95);
        ctx.beginPath();
        ctx.arc(bx, by, 3.5 + flashRef.current, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexAlpha(C_B, 0.9);
        ctx.beginPath();
        ctx.arc(ax, ay, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillStyle = hexAlpha(C_BA, 0.8);
        ctx.fillText("B→A", ax + 4, ay + 12);
      }

      // Ratio / amount crosshair
      const hx = ratioN * W;
      const hy = (1 - p.fm) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = hexAlpha(C_AMT, 0.5);
      ctx.stroke();

      // Sparks when forging
      if (energy > 0.35 && Math.random() < 0.12 + p.fm * 0.2) {
        sparks.push({
          x: xL + Math.random() * span,
          y: mid + (Math.random() - 0.5) * amp * 2,
          vx: (Math.random() - 0.5) * 2.5,
          life: 1,
          col: Math.random() > 0.5 ? C_GLOW : C_HOT,
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
        ctx.fillStyle = hexAlpha(s.col, s.life * 0.7);
        ctx.fillRect(s.x, s.y, 2, 2);
      }

      // Harmonic chip
      const harm = nearestHarmonic(p.ratio);
      const near = Math.abs(Math.log2(p.ratio / harm)) < 0.08;
      const chip = near ? `${harm}×` : `${p.ratio.toFixed(2)}×`;
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, chipW, 13);
      ctx.strokeStyle = hexAlpha(near ? C_GLOW : C_MID, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, chipW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 16);

      // Bottom rail — B→A | Ring | Hz
      const railY = Hh - 16;
      const zones = [
        { label: "B→A", v: p.bToA, col: C_BA, x0: 12, w: (W - 24) * 0.33 },
        { label: "RING", v: p.ring, col: C_RING, x0: 12 + (W - 24) * 0.33, w: (W - 24) * 0.34 },
        { label: "Hz", v: ringN, col: C_HOT, x0: 12 + (W - 24) * 0.67, w: (W - 24) * 0.33 },
      ];
      zones.forEach((z) => {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(z.x0, railY, z.w - 2, 7);
        ctx.strokeStyle = hexAlpha(z.col, 0.25 + z.v * 0.35);
        ctx.strokeRect(z.x0 + 0.5, railY + 0.5, z.w - 3, 6);
        if (z.v > 0.02) {
          const fill = ctx.createLinearGradient(z.x0, railY, z.x0 + z.w * z.v, railY);
          fill.addColorStop(0, hexAlpha(z.col, 0.35));
          fill.addColorStop(1, hexAlpha(C_GLOW, 0.75));
          ctx.fillStyle = fill;
          ctx.fillRect(z.x0 + 1, railY + 1, Math.max(2, (z.w - 4) * z.v), 5);
        }
        const thumbX = z.x0 + 1 + (z.w - 4) * z.v;
        ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
        ctx.beginPath();
        ctx.arc(thumbX, railY + 3.5, 2.8 + flashRef.current, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexAlpha(z.col, 0.8);
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(z.label, z.x0 + 2, railY - 3);
      });

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("FM · SIDEBAND FORGE", 12, Hh - 2);
      ctx.textAlign = "right";
      const status =
        p.fm < 0.02 && p.ring < 0.02 && p.bToA < 0.02
          ? "IDLE"
          : `I${Math.round(p.fm * 100)} · ${p.ratio.toFixed(2)}×${p.bToA > 0.02 ? ` · B→A${Math.round(p.bToA * 100)}` : ""}${p.ring > 0.02 ? ` · R${Math.round(p.ringHz)}` : ""}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
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
      title="Drag: Ratio ↔ / Amount ↕ · Bottom: B→A | Ring | Hz · Double-click: next harmonic"
      role="img"
      aria-label="FM sideband forge"
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
        Sideband Forge
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        {live ? `${ratio.toFixed(2)}×` : "IDLE"}
      </div>
    </div>
  );
}

/** Alias for older imports */
export { FmStageViz as FmRingStageViz };
