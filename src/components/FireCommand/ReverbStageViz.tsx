/**
 * Reverb — Halo Vault stage visualizer.
 * Size · Diff · Damp · Pre · Early · LowDecay · Mix (Signal Path FX · FC.reverb).
 * Drag: Size ↔ / Diff ↕. Top: Pre. Right: Damp. Bottom: Mix.
 * Double-click: cycle mix 0→50→100.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 188;
const C = FC.reverb;
const C_DEEP = bandShade(FC.fx, 0.4);
const C_MID = bandShade(FC.fx, 0.55);
const C_HOT = bandShade(FC.fx, 0.72);
const C_GLOW = bandShade(FC.fx, 0.94);
const C_SIZE = bandShade(FC.fx, 0.58);
const C_DAMP = bandShade(FC.fx, 0.68);
const C_PRE = bandShade(FC.fx, 0.78);
const C_DIFF = bandShade(FC.fx, 0.84);
const C_MIX = bandShade(FC.fx, 0.9);

const SIZE_MIN = 0.3;
const SIZE_MAX = 6;
const PRE_MAX = 0.2;
const MIX_CYCLE = [0, 0.5, 1] as const;

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

type DragMode = "xy" | "mix" | "pre" | "damp" | null;

type RevState = { size: number; damp: number; pre: number; diff: number; mix: number; early: number; lowDecay: number };

export function ReverbStageViz() {
  const size = useFireCommandStore((s) => s.patch.reverbSize) ?? 2.2;
  const damp = useFireCommandStore((s) => s.patch.reverbDamp) ?? 0.45;
  const pre = useFireCommandStore((s) => s.patch.reverbPredelay) ?? 0.02;
  const diff = useFireCommandStore((s) => s.patch.reverbDiffusion) ?? 0.7;
  const mix = useFireCommandStore((s) => s.patch.reverbMix) ?? 0;
  const early = useFireCommandStore((s) => s.patch.reverbEarly) ?? 0.45;
  const lowDecay = useFireCommandStore((s) => s.patch.reverbLowDecay) ?? 0.55;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef<RevState>({ size, damp, pre, diff, mix, early, lowDecay });
  st.current = { size, damp, pre, diff, mix, early, lowDecay };

  const live = mix > 0.02;

  useEffect(() => {
    const key = [size, damp, pre, diff, mix, early, lowDecay].map((v) => v.toFixed(3)).join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [size, damp, pre, diff, mix, early, lowDecay]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0.04, 0.92);
      const y = clamp((clientY - rect.top - H * 0.12) / Math.max(1, rect.height * 0.6), 0, 1);
      setParam("reverbSize", Math.round(logLerp((x - 0.04) / 0.88, SIZE_MIN, SIZE_MAX) * 100) / 100);
      setParam("reverbDiffusion", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("reverbMix", Math.round(x * 1000) / 1000);
    },
    [setParam],
  );

  const applyPre = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("reverbPredelay", Math.round(x * PRE_MAX * 1000) / 1000);
    },
    [setParam],
  );

  const applyDamp = useCallback(
    (clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0.12, 0.78);
      setParam("reverbDamp", Math.round((1 - (y - 0.12) / 0.66) * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      if (y < H * 0.12) {
        dragRef.current = "pre";
        wrap.setPointerCapture(e.pointerId);
        applyPre(e.clientX);
        return;
      }
      if (x > rect.width * 0.92) {
        dragRef.current = "damp";
        wrap.setPointerCapture(e.pointerId);
        applyDamp(e.clientY);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix, applyPre, applyDamp],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "mix") applyMix(e.clientX);
      else if (dragRef.current === "pre") applyPre(e.clientX);
      else if (dragRef.current === "damp") applyDamp(e.clientY);
    },
    [applyXy, applyMix, applyPre, applyDamp],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const m = st.current.mix;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < MIX_CYCLE.length; i++) {
      const d = Math.abs(MIX_CYCLE[i]! - m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setParam("reverbMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const rings: Array<{ birth: number; x: number; y: number; early: boolean }> = [];
    const mist: Array<{ x: number; y: number; vx: number; vy: number; life: number; sz: number }> = [];
    let nextSpawn = 0;

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const sizeN = logNorm(p.size, SIZE_MIN, SIZE_MAX);
      const preN = p.pre / PRE_MAX;
      const earlyN = clamp(p.early ?? 0.45, 0, 1);
      const lowDec = clamp(p.lowDecay ?? 0.55, 0, 1);
      const isLive = p.mix > 0.02;
      const energy = 0.1 + p.mix * 0.42 + sizeN * 0.18 + flashRef.current * 0.22;
      const bright = 1 - p.damp * 0.55;

      ctx.clearRect(0, 0, W, Hh);

      // Violet vault chamber
      const bg = ctx.createRadialGradient(W * 0.5, Hh * 0.48, 4, W * 0.5, Hh * 0.5, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, (0.08 + energy * 0.35) * bright + flashRef.current * 0.18));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(5,2,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Tail cloud — size expands, lowDecay fattens low end bloom
      const bloomCx = W * 0.48;
      const bloomCy = Hh * 0.5;
      const bloomR = (22 + p.size * 22) * (0.75 + p.mix * 0.45) * (0.85 + (1 - earlyN) * 0.35);
      const bloom = ctx.createRadialGradient(bloomCx, bloomCy, 2, bloomCx, bloomCy, bloomR);
      bloom.addColorStop(0, hexAlpha(C_GLOW, (0.1 + p.mix * 0.18) * bright * (1 - earlyN * 0.35)));
      bloom.addColorStop(0.35, hexAlpha(C_HOT, (0.08 + p.mix * 0.12 + sizeN * 0.08 + lowDec * 0.06) * bright));
      bloom.addColorStop(0.7, hexAlpha(C_MID, 0.05 + p.mix * 0.08 * (1 - earlyN)));
      bloom.addColorStop(1, hexAlpha(C_DEEP, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, Hh);

      // Predelay arc (top rail visual)
      const preRailY = 22;
      const preX = 14 + preN * (W - 40);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(12, preRailY - 2, W - 36, 5);
      ctx.strokeStyle = hexAlpha(C_PRE, 0.25 + preN * 0.35);
      ctx.strokeRect(12.5, preRailY - 1.5, W - 37, 4);
      const preFill = ctx.createLinearGradient(12, preRailY, preX, preRailY);
      preFill.addColorStop(0, hexAlpha(C_PRE, 0.2));
      preFill.addColorStop(1, hexAlpha(C_GLOW, 0.7));
      ctx.fillStyle = preFill;
      ctx.fillRect(12, preRailY - 1, Math.max(2, preX - 12), 3);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(preX, preRailY + 0.5, 3 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_PRE, 0.8);
      ctx.textAlign = "left";
      ctx.fillText(`PRE ${Math.round(p.pre * 1000)}ms`, 14, preRailY - 6);

      // Early / LowDecay labels
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_HOT, 0.75);
      ctx.textAlign = "left";
      ctx.fillText(`EARLY ${Math.round(earlyN * 100)}`, 14, Hh * 0.2);
      ctx.fillStyle = hexAlpha(C_MID, 0.7);
      ctx.fillText(`LOW DEC ${Math.round(lowDec * 100)}`, 14, Hh * 0.2 + 11);

      // Damp vertical rail (right)
      const dampX = W - 10;
      const dampTop = Hh * 0.14;
      const dampH = Hh * 0.58;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(dampX - 3, dampTop, 5, dampH);
      ctx.fillStyle = hexAlpha(C_DAMP, 0.35 + p.damp * 0.5);
      const dampFillH = dampH * p.damp;
      ctx.fillRect(dampX - 2, dampTop + dampH - dampFillH, 3, dampFillH);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.beginPath();
      ctx.arc(dampX - 0.5, dampTop + dampH - dampFillH, 2.5 + flashRef.current * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 6px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_DAMP, 0.7);
      ctx.textAlign = "center";
      ctx.fillText("DMP", dampX - 0.5, dampTop - 4);

      // Early sparks (sharp discrete hits)
      const spawnEvery = Math.max(50, 280 - earlyN * 160 - p.mix * 60);
      if (now > nextSpawn && isLive) {
        const nEarly = Math.floor(1 + earlyN * 4);
        for (let k = 0; k < nEarly; k++) {
          rings.push({
            birth: now + k * 18 + p.pre * 400,
            x: bloomCx + (Math.random() - 0.5) * (20 + earlyN * 40),
            y: bloomCy + (Math.random() - 0.5) * (10 + earlyN * 18),
            early: true,
          });
        }
        // Tail cloud seeds
        const nTail = Math.floor(1 + (1 - earlyN) * 3 + p.diff * 2);
        for (let k = 0; k < nTail; k++) {
          rings.push({
            birth: now + 40 + k * 30 + p.pre * 200,
            x: bloomCx + (Math.random() - 0.5) * (40 + p.diff * 80 + p.size * 10),
            y: bloomCy + (Math.random() - 0.5) * (18 + p.diff * 36),
            early: false,
          });
        }
        nextSpawn = now + spawnEvery;
        while (rings.length > 20) rings.shift();
      }

      const lifeMs = 450 + p.size * 400 * (0.7 + lowDec * 0.5);
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]!;
        const age = (now - ring.birth) / (ring.early ? lifeMs * 0.45 : lifeMs);
        if (age < 0) continue;
        if (age > 1) {
          rings.splice(i, 1);
          continue;
        }
        if (ring.early) {
          // Sharp spark
          const hit = 1 - age;
          const sx = ring.x;
          const sy = ring.y;
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.85 * hit * earlyN * (0.5 + p.mix));
          ctx.lineWidth = 1.6;
          ctx.shadowBlur = 8;
          ctx.shadowColor = C;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 10 * hit);
          ctx.lineTo(sx, sy + 4);
          ctx.moveTo(sx - 5 * hit, sy - 2);
          ctx.lineTo(sx + 5 * hit, sy - 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = hexAlpha(C_HOT, 0.7 * hit);
          ctx.beginPath();
          ctx.arc(sx, sy, 1.5 + hit * 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Soft tail cloud puff
          const rad = 6 + age * (16 + p.size * 20) * (1 - p.damp * 0.28);
          const alpha = (1 - age) * (0.22 + p.mix * 0.5) * bright * (1 - earlyN * 0.35) * (0.6 + lowDec * 0.4);
          const rg = ctx.createRadialGradient(ring.x, ring.y, rad * 0.2, ring.x, ring.y, rad * 2.4);
          rg.addColorStop(0, hexAlpha(C_GLOW, alpha * 0.35));
          rg.addColorStop(0.5, hexAlpha(C_HOT, alpha * 0.15));
          rg.addColorStop(1, hexAlpha(C_HOT, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.ellipse(ring.x, ring.y, rad * 2, rad * (0.55 + p.diff * 0.35), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Diffusion mist (size↔diff coupled visually)
      if (isLive && p.diff > 0.1 && Math.random() < 0.14 * p.diff * p.mix) {
        mist.push({
          x: bloomCx + (Math.random() - 0.5) * bloomR * 1.2,
          y: bloomCy + (Math.random() - 0.5) * bloomR * 0.7,
          vx: (Math.random() - 0.5) * (0.4 + p.diff),
          vy: (Math.random() - 0.5) * (0.4 + p.diff),
          life: 1,
          sz: 2 + Math.random() * 3.5 * (0.5 + sizeN),
        });
      }
      for (let i = mist.length - 1; i >= 0; i--) {
        const m = mist[i]!;
        m.life -= 0.014;
        m.x += m.vx;
        m.y += m.vy;
        m.vx *= 0.98;
        m.vy *= 0.98;
        if (m.life <= 0) {
          mist.splice(i, 1);
          continue;
        }
        const a = m.life * (0.3 + p.mix * 0.4) * p.diff * bright;
        const mg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.sz * 4);
        mg.addColorStop(0, hexAlpha(C_GLOW, a));
        mg.addColorStop(1, hexAlpha(C_HOT, 0));
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.sz * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Size / Diff crosshair
      const hx = (0.04 + sizeN * 0.88) * W;
      const hy = Hh * 0.12 + (1 - p.diff) * (Hh * 0.6);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Chip
      const chip = !isLive ? "DRY" : p.size > 4 ? "HALL" : p.size < 1 ? "ROOM" : "VAULT";
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 4, chipW, 12);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 4, chipW, 12);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 13);

      // Mix rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_MIX, 0.25 + p.mix * 0.4);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const fill = ctx.createLinearGradient(12, railY, 12 + (W - 24) * p.mix, railY);
      fill.addColorStop(0, hexAlpha(C_MIX, 0.3));
      fill.addColorStop(1, hexAlpha(C_GLOW, 0.85));
      ctx.fillStyle = fill;
      ctx.fillRect(12, railY + 1, Math.max(2, (W - 24) * p.mix), 5);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * p.mix, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_MIX, 0.85);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`MIX ${Math.round(p.mix * 100)}%`, 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("REV · HALO VAULT", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? "DRY"
        : `${p.size.toFixed(1)}s · Δ${Math.round(p.diff * 100)} · E${Math.round(earlyN * 100)}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        particles: 0,
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
      title="Drag: Size ↔ / Diff ↕ · Top: Pre · Right: Damp · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Reverb halo vault"
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
        Halo Vault
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? `${size.toFixed(1)}s` : "DRY"}
      </div>
    </div>
  );
}
