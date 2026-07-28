/**
 * WARP — Harmonic Forge stage visualizer.
 * Shared spectral remapping for all three oscillators (Signal Path Sources · FC.warp).
 * Stretch / Tilt / Comb reshape a live partial loom; canvas is interactive.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { applyWarp, NUM_PARTIALS } from "@/audio/dsp/wavetables";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const N = Math.min(32, NUM_PARTIALS);
const C = FC.warp;
const C_DEEP = bandShade(FC.sources, 0.35);
const C_MID = bandShade(FC.sources, 0.48);
const C_HOT = bandShade(FC.sources, 0.66);
const C_GLOW = bandShade(FC.sources, 0.88);
const C_ST = bandShade(FC.sources, 0.55);
const C_TL = bandShade(FC.sources, 0.72);
const C_CB = bandShade(FC.sources, 0.42);

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

/** Reference saw spectrum for forge preview (matches PeriodicWave imag layout). */
function makeSawImag(count: number): Float32Array {
  const imag = new Float32Array(count + 1);
  for (let n = 1; n <= count; n++) imag[n] = 1 / n;
  return imag;
}

const BASE_SAW = makeSawImag(N);

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

export function WarpStageViz() {
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragMode = useRef<"xy" | "comb" | null>(null);
  const prevKey = useRef("");
  const st = useRef({ stretch, tilt, comb });
  st.current = { stretch, tilt, comb };

  const active = Math.abs(stretch) > 0.01 || Math.abs(tilt) > 0.01 || comb > 0.01;

  useEffect(() => {
    const key = `${stretch.toFixed(3)}|${tilt.toFixed(3)}|${comb.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [stretch, tilt, comb]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyFromPointer = useCallback(
    (clientX: number, clientY: number, mode: "xy" | "comb") => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "comb") {
        setParam("warpComb", Math.round(x * 1000) / 1000);
        return;
      }
      // X → stretch (−1..1), Y → tilt (−1..1) inverted so up = bright
      setParam("warpStretch", Math.round((x * 2 - 1) * 1000) / 1000);
      setParam("warpTilt", Math.round((1 - y * 2) * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mode: "xy" | "comb" = y > H * 0.78 || e.shiftKey ? "comb" : "xy";
      dragMode.current = mode;
      wrap.setPointerCapture(e.pointerId);
      applyFromPointer(e.clientX, e.clientY, mode);
    },
    [applyFromPointer],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragMode.current) return;
      applyFromPointer(e.clientX, e.clientY, dragMode.current);
    },
    [applyFromPointer],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode.current) return;
    dragMode.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("warpStretch", 0);
    setParam("warpTilt", 0);
    setParam("warpComb", 0);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const { stretch: S, tilt: T, comb: Cb } = st.current;
      flashRef.current *= 0.88;

      const warped = applyWarp(BASE_SAW, S, T, Cb);
      const dormant = Math.abs(S) < 0.01 && Math.abs(T) < 0.01 && Cb < 0.01;
      const energy = dormant ? 0.12 : 0.35 + (Math.abs(S) + Math.abs(T) + Cb) * 0.35;

      ctx.clearRect(0, 0, W, Hh);

      // Crimson-coral forge field
      const cx = W * (0.4 + S * 0.15);
      const cy = Hh * (0.4 - T * 0.1);
      const bg = ctx.createRadialGradient(cx, cy, 4, W * 0.5, Hh * 0.5, W * 0.75);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.16 + energy * 0.28 + flashRef.current * 0.28));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(4,1,2,0.97)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Loom threads (diagonal)
      ctx.save();
      ctx.strokeStyle = hexAlpha(C_MID, 0.05 + energy * 0.05 + Cb * 0.06);
      ctx.lineWidth = 1;
      for (let i = -Hh; i < W + Hh; i += 8) {
        ctx.beginPath();
        ctx.moveTo(i + S * 20, 0);
        ctx.lineTo(i + Hh * 0.5 - S * 10, Hh);
        ctx.stroke();
      }
      ctx.restore();

      // Tilt polarity washes
      if (Math.abs(T) > 0.04) {
        const side = T >= 0 ? W * 0.15 : W * 0.85;
        const rb = ctx.createRadialGradient(side, Hh * 0.35, 0, side, Hh * 0.35, Hh * 0.55);
        rb.addColorStop(0, hexAlpha(T >= 0 ? C_TL : C_ST, 0.32 * Math.abs(T) * energy));
        rb.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = rb;
        ctx.fillRect(0, 0, W, Hh);
      }

      const PAD = 14;
      const top = 28;
      const railH = 18;
      const usableW = W - PAD * 2;
      const usableH = Hh - top - railH - 14;
      const baseY = top + usableH;
      const breath = 0.92 + 0.08 * Math.sin(now / 680);

      // Stretch mapping for bar X positions (visual echo of stiff-string law)
      const B = S * 0.05;
      type Node = { x: number; amp: number; baseAmp: number; n: number; even: boolean };
      const nodes: Node[] = [];
      let maxAmp = 0.001;
      for (let n = 1; n <= N; n++) {
        maxAmp = Math.max(maxAmp, warped[n]!, BASE_SAW[n]!);
      }

      for (let n = 1; n <= N; n++) {
        const denom = Math.max(0.3, 1 + B * n);
        const posN = n / denom; // stretched coordinate
        const x = PAD + ((posN - 0.5) / (N * 0.95)) * usableW;
        if (x < PAD - 4 || x > W - PAD + 4) continue;
        nodes.push({
          x,
          amp: warped[n]! / maxAmp,
          baseAmp: BASE_SAW[n]! / maxAmp,
          n,
          even: n % 2 === 0,
        });
      }

      // Ghost base (unwarped) contour
      ctx.beginPath();
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i]!;
        const y = baseY - nd.baseAmp * usableH * 0.85 * breath;
        if (i === 0) ctx.moveTo(nd.x, y);
        else ctx.lineTo(nd.x, y);
      }
      ctx.strokeStyle = hexAlpha(C_MID, dormant ? 0.35 : 0.14);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Comb notch guides
      if (Cb > 0.05) {
        for (let n = 2; n <= N; n++) {
          const notch = 0.5 + 0.5 * Math.cos((2 * Math.PI * n) / 4.3);
          if (notch < 0.35) continue;
          const denom = Math.max(0.3, 1 + B * n);
          const posN = n / denom;
          const x = PAD + ((posN - 0.5) / (N * 0.95)) * usableW;
          ctx.fillStyle = hexAlpha(C_CB, 0.08 + Cb * notch * 0.25);
          ctx.fillRect(x - 2, top, 4, usableH);
        }
      }

      // Contour through warped tips
      if (nodes.length > 1) {
        ctx.beginPath();
        nodes.forEach((nd, i) => {
          const y = baseY - nd.amp * usableH * breath;
          if (i === 0) ctx.moveTo(nd.x, y);
          else ctx.lineTo(nd.x, y);
        });
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + energy * 0.4 + flashRef.current * 0.3);
        ctx.lineWidth = 2;
        ctx.shadowBlur = 12 + energy * 14 + flashRef.current * 18;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Partial bars
      for (const nd of nodes) {
        const barH = Math.max(2, nd.amp * usableH * breath);
        const y = baseY - barH;
        const bw = Math.max(2.2, Math.min(7, usableW / (N * 1.1)));
        const evenCut = nd.even ? Math.max(0, T) : Math.max(0, -T);
        const alpha = (0.45 + energy * 0.4) * (1 - evenCut * 0.55) * (nd.even ? 1 - Cb * 0.35 : 1);
        const col = nd.even ? C_ST : C_TL;
        const g = ctx.createLinearGradient(0, y, 0, baseY);
        g.addColorStop(0, hexAlpha(nd.even ? C_HOT : C_GLOW, alpha));
        g.addColorStop(0.6, hexAlpha(col, alpha * 0.55));
        g.addColorStop(1, hexAlpha(C_DEEP, 0.05));
        ctx.fillStyle = g;
        ctx.fillRect(nd.x - bw / 2, y, bw, barH);

        if (nd.even && Cb > 0.08) {
          const notchY = y + barH * 0.4;
          ctx.fillStyle = `rgba(0,0,0,${0.3 + Cb * 0.5})`;
          ctx.fillRect(nd.x - bw / 2 - 0.5, notchY, bw + 1, 1.5 + Cb * 2.5);
        }

        // Tip node
        ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + alpha * 0.4);
        ctx.shadowBlur = 6 + flashRef.current * 10;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.arc(nd.x, y, nd.even ? 1.8 : 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Stretch ↔ compress arrows
      if (Math.abs(S) > 0.06) {
        ctx.strokeStyle = hexAlpha(C_ST, 0.45 + Math.abs(S) * 0.4);
        ctx.lineWidth = 1.5;
        const ay = top + 6;
        ctx.beginPath();
        if (S > 0) {
          ctx.moveTo(PAD + 8, ay);
          ctx.lineTo(PAD + 28 + S * 20, ay);
          ctx.lineTo(PAD + 24 + S * 20, ay - 3);
          ctx.moveTo(PAD + 28 + S * 20, ay);
          ctx.lineTo(PAD + 24 + S * 20, ay + 3);
        } else {
          ctx.moveTo(W - PAD - 8, ay);
          ctx.lineTo(W - PAD - 28 + S * 20, ay);
          ctx.lineTo(W - PAD - 24 + S * 20, ay - 3);
          ctx.moveTo(W - PAD - 28 + S * 20, ay);
          ctx.lineTo(W - PAD - 24 + S * 20, ay + 3);
        }
        ctx.stroke();
      }

      // Sparks along contour
      if (!dormant && nodes.length > 2) {
        const sparkN = 4 + Math.floor((Math.abs(S) + Math.abs(T) + Cb) * 5);
        for (let s = 0; s < sparkN; s++) {
          const u = (s / sparkN + now * 0.0004 * (1 + Math.abs(S) * 2)) % 1;
          const idx = u * (nodes.length - 1);
          const i0 = Math.floor(idx);
          const i1 = Math.min(i0 + 1, nodes.length - 1);
          const f = idx - i0;
          const a = nodes[i0]!;
          const b = nodes[i1]!;
          const x = a.x + (b.x - a.x) * f;
          const y0 = baseY - a.amp * usableH * breath;
          const y1 = baseY - b.amp * usableH * breath;
          const y = y0 + (y1 - y0) * f;
          const rad = 3 + Cb * 3;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
          rg.addColorStop(0, hexAlpha(C_GLOW, 0.55 * energy));
          rg.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Comb rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(PAD, railY, usableW, 5);
      const combW = usableW * Cb;
      const cg = ctx.createLinearGradient(PAD, railY, PAD + combW, railY);
      cg.addColorStop(0, hexAlpha(C_DEEP, 0.5));
      cg.addColorStop(1, hexAlpha(C_CB, 0.95));
      ctx.fillStyle = cg;
      ctx.shadowBlur = 8;
      ctx.shadowColor = C;
      ctx.fillRect(PAD, railY, combW, 5);
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.beginPath();
      ctx.arc(PAD + combW, railY + 2.5, 3.2 + flashRef.current * 2, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair for stretch/tilt pad center
      const hx = PAD + ((S + 1) / 2) * usableW;
      const hy = top + ((1 - T) / 2) * usableH;
      ctx.strokeStyle = hexAlpha(C_GLOW, dormant ? 0.15 : 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy);
      ctx.lineTo(hx + 6, hy);
      ctx.moveTo(hx, hy - 6);
      ctx.lineTo(hx, hy + 6);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_HOT, 0.7);
      ctx.beginPath();
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("WARP · HARMONIC FORGE", 12, Hh - 4);
      ctx.textAlign = "right";
      if (dormant) {
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.fillText("NEUTRAL · drag to forge", W - 12, Hh - 4);
      } else {
        const bits: string[] = [];
        if (Math.abs(S) > 0.02) bits.push(`ST ${S > 0 ? "+" : "−"}${Math.round(Math.abs(S) * 100)}`);
        if (Math.abs(T) > 0.02) bits.push(`TL ${T > 0 ? "+" : "−"}${Math.round(Math.abs(T) * 100)}`);
        if (Cb > 0.04) bits.push(`CMB ${Math.round(Cb * 100)}`);
        ctx.fillStyle = hexAlpha(C_HOT, 0.85);
        ctx.fillText(bits.join(" · "), W - 12, Hh - 4);
      }
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: false,
        particles: 0,
        motionKey: "",
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, active ? 0.5 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexAlpha(C, active ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Stretch↔ / Tilt↕ · Shift or bottom rail: Comb · Double-click: neutral"
      role="img"
      aria-label="Spectral warp harmonic forge"
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
        Harmonic Forge
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {active ? "FORGING" : "IDLE"}
      </div>
    </div>
  );
}
