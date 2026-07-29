/**
 * Chorus — Ensemble Drift stage visualizer.
 * Rate · Depth · Mix (Signal Path FX · FC.chorus).
 * Drag: Rate ↔ / Depth ↕. Bottom: Mix. Double-click: cycle mix 0→50→100.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ChorusModel } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.chorus;
const C_DEEP = bandShade(FC.fx, 0.32);
const C_MID = bandShade(FC.fx, 0.5);
const C_HOT = bandShade(FC.fx, 0.68);
const C_GLOW = bandShade(FC.fx, 0.92);
const C_RATE = bandShade(FC.fx, 0.55);
const C_DEPTH = bandShade(FC.fx, 0.7);
const C_MIX = bandShade(FC.fx, 0.84);
const C_L = bandShade(FC.fx, 0.58);
const C_R = bandShade(FC.fx, 0.78);

const RATE_MIN = 0.05;
const RATE_MAX = 8;
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

type DragMode = "xy" | "mix" | null;

export function ChorusStageViz() {
  const rate = useFireCommandStore((s) => s.patch.chorusRate) ?? 0.6;
  const depth = useFireCommandStore((s) => s.patch.chorusDepth) ?? 0.4;
  const mix = useFireCommandStore((s) => s.patch.chorusMix) ?? 0;
  const voicesN = useFireCommandStore((s) => s.patch.chorusVoices) ?? 2;
  const baseDelay = useFireCommandStore((s) => s.patch.chorusDelay) ?? 0.012;
  const spread = useFireCommandStore((s) => s.patch.chorusSpread) ?? 0.7;
  const model = (useFireCommandStore((s) => s.patch.chorusModel) ?? "dual") as ChorusModel;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ rate, depth, mix, voicesN, baseDelay, spread, model });
  st.current = { rate, depth, mix, voicesN, baseDelay, spread, model };

  const live = mix > 0.02;

  useEffect(() => {
    const key = `${rate.toFixed(3)}|${depth.toFixed(3)}|${mix.toFixed(3)}|${voicesN}|${baseDelay.toFixed(4)}|${spread.toFixed(3)}|${model}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [rate, depth, mix, voicesN, baseDelay, spread, model]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("chorusRate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("chorusDepth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("chorusMix", Math.round(x * 1000) / 1000);
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
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "mix") applyMix(e.clientX);
    },
    [applyXy, applyMix],
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
    setParam("chorusMix", MIX_CYCLE[(best + 1) % MIX_CYCLE.length]!);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const shimmer: Array<{ x: number; y: number; vx: number; life: number; side: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
      const isLive = p.mix > 0.02;
      const energy = 0.1 + p.mix * 0.45 + p.depth * 0.22 + flashRef.current * 0.25;
      const PAD = 12;
      const stageH = Hh * 0.72;
      const mid = stageH * 0.42;
      const delayLaneY = stageH * 0.78;
      const nVoices = clamp(Math.round(p.voicesN ?? 2), 1, 4);
      const spreadN = clamp(p.spread ?? 0.7, 0, 1);
      const delayMs = clamp(p.baseDelay ?? 0.012, 0.004, 0.04) * 1000;
      const model = p.model ?? "dual";
      const rateMul = model === "tape" ? 0.55 : model === "ensemble" ? 1.4 : model === "dimension" ? 0.9 : 1;
      const rateL = p.rate * rateMul;
      const rateR = p.rate * rateMul * (model === "dimension" ? 1.01 : 1.18);

      // Build voice set from chorusVoices + model
      const voiceDefs: Array<{ pan: number; delayMul: number; label: string; color: string; rate: number; phase: number }> = [];
      if (nVoices === 1 || model === "single") {
        voiceDefs.push({ pan: 0, delayMul: 1, label: "C", color: C_GLOW, rate: rateL, phase: 0 });
      } else if (nVoices === 2 || model === "dual") {
        voiceDefs.push(
          { pan: -spreadN, delayMul: 1, label: "L", color: C_L, rate: rateL, phase: 0 },
          { pan: spreadN, delayMul: 1.05 + spreadN * 0.25, label: "R", color: C_R, rate: rateR, phase: 1.2 },
        );
      } else if (nVoices === 3 || model === "triple") {
        voiceDefs.push(
          { pan: -spreadN, delayMul: 1, label: "L", color: C_L, rate: rateL, phase: 0 },
          { pan: 0, delayMul: 1.08, label: "C", color: C_GLOW, rate: rateL * 0.97, phase: 0.7 },
          { pan: spreadN, delayMul: 1.05 + spreadN * 0.25, label: "R", color: C_R, rate: rateR, phase: 1.4 },
        );
      } else {
        voiceDefs.push(
          { pan: -spreadN, delayMul: 0.95, label: "L", color: C_L, rate: rateL, phase: 0 },
          { pan: -spreadN * 0.35, delayMul: 1.05, label: "", color: C_MID, rate: rateL * 0.95, phase: 0.4 },
          { pan: 0, delayMul: 1.12, label: "C", color: C_GLOW, rate: rateL, phase: 0.9 },
          { pan: spreadN, delayMul: 1.05 + spreadN * 0.25, label: "R", color: C_R, rate: rateR, phase: 1.5 },
        );
      }

      ctx.clearRect(0, 0, W, Hh);

      // Violet ensemble chamber
      const bg = ctx.createRadialGradient(W * 0.5, Hh * 0.38, 6, W * 0.5, Hh * 0.45, W * 0.75);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.08 + energy * 0.38 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(5,2,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Stereo field guides respond to spread
      const fieldY = mid;
      ctx.strokeStyle = hexAlpha(C_L, 0.12 + p.mix * 0.15 * spreadN);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD, fieldY - 10 - spreadN * 18);
      ctx.lineTo(W - PAD, fieldY - 10 - spreadN * 18);
      ctx.moveTo(PAD, fieldY + 10 + spreadN * 18);
      ctx.lineTo(W - PAD, fieldY + 10 + spreadN * 18);
      ctx.stroke();
      ctx.setLineDash([]);

      // Per-voice delay trajectories (time on X, pan on Y)
      const maxDelayVis = 40;
      for (let vi = 0; vi < voiceDefs.length; vi++) {
        const v = voiceDefs[vi]!;
        const baseX = PAD + (delayMs * v.delayMul / maxDelayVis) * (W - PAD * 2) * 0.85;
        const panY = mid + v.pan * (22 + spreadN * 16);
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const u = i / 60;
          const mod = Math.sin(now / 1000 * v.rate * 2 * Math.PI + v.phase + u * 2) * p.depth * (6 + delayMs * 0.4);
          const px = baseX + u * (W - PAD * 2 - baseX) * 0.35 + mod;
          const py = panY + Math.sin(u * Math.PI * 2 + now / 500 + v.phase) * (3 + p.depth * 6);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = hexAlpha(v.color, 0.35 + p.mix * 0.5);
        ctx.lineWidth = v.label === "C" ? 1.6 : 2;
        ctx.shadowBlur = 6 + p.mix * 8;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Voice node
        const nodeX = baseX + Math.sin(now / 1000 * v.rate * 2 * Math.PI + v.phase) * p.depth * 8;
        const nodeY = panY;
        ctx.fillStyle = hexAlpha(v.color, 0.85 + p.mix * 0.15);
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, 3.5 + flashRef.current, 0, Math.PI * 2);
        ctx.fill();

        if (v.label) {
          const labelA = 0.45 + spreadN * 0.5 + (v.label === "C" ? 0.2 : 0);
          ctx.font = "800 9px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(v.color, clamp(labelA, 0.3, 1));
          ctx.textAlign = "right";
          ctx.fillText(v.label, Math.max(PAD + 14, nodeX - 8), nodeY + 3);
        }

        if (Math.abs(v.pan) > 0.5 && isLive && Math.random() < 0.1 * p.mix) {
          shimmer.push({
            x: nodeX,
            y: nodeY,
            vx: v.pan * (0.3 + Math.random() * 0.6),
            life: 1,
            side: v.pan > 0 ? 1 : -1,
          });
        }
      }

      // Delay scale ticks
      ctx.strokeStyle = hexAlpha(C_DEPTH, 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, delayLaneY);
      ctx.lineTo(W - PAD, delayLaneY);
      ctx.stroke();
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_DEPTH, 0.65);
      ctx.textAlign = "left";
      ctx.fillText(`${delayMs.toFixed(1)}ms · ${model.toUpperCase()} · ${nVoices}v`, PAD, delayLaneY - 4);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C_L, 0.55 + spreadN * 0.4);
      ctx.fillText("L", PAD + 10, mid - 10 - spreadN * 18);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.5 + (1 - Math.abs(spreadN - 0.5)) * 0.3);
      ctx.textAlign = "center";
      ctx.fillText("C", W * 0.5, mid - 14);
      ctx.fillStyle = hexAlpha(C_R, 0.55 + spreadN * 0.4);
      ctx.textAlign = "right";
      ctx.fillText("R", W - PAD, mid + 10 + spreadN * 18);

      // Shimmer particles
      for (let i = shimmer.length - 1; i >= 0; i--) {
        const s = shimmer[i]!;
        s.life -= 0.022;
        s.x += s.vx;
        s.y += Math.sin(now * 0.01 + s.x) * 0.3;
        if (s.life <= 0) {
          shimmer.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(s.side > 0 ? C_R : C_L, s.life * 0.75);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.4 + s.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rate / Depth crosshair
      const hx = rateN * W;
      const hy = (1 - p.depth) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Status chip
      const chip = !isLive ? "BYPASS" : model === "ensemble" ? "WIDE" : model === "tape" ? "TAPE" : "ENSEMBLE";
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
      ctx.fillText("CHOR · ENSEMBLE DRIFT", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? "BYPASS"
        : `${nVoices}v · ${delayMs.toFixed(1)}ms · S${Math.round(spreadN * 100)}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        particles: shimmer.length,
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
      title="Drag: Rate ↔ / Depth ↕ · Bottom: Mix · Double-click: cycle mix"
      role="img"
      aria-label="Chorus ensemble drift"
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
        Ensemble Drift
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? `${rate < 1 ? rate.toFixed(2) : rate.toFixed(1)}Hz` : "BYPASS"}
      </div>
    </div>
  );
}
