/**
 * LFO 1 — Phase Aurora stage visualizer.
 * Wave · rate · depth · dest · LFO→WT A/B/C (Signal Path Mod · FC.lfo).
 * Drag: Rate ↔ / Depth ↕. Bottom rail: →WT for focused osc. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import type { LfoWave } from "@/audio/dsp/FireCommandSynth";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.lfo;
const C_DEEP = bandShade(FC.mod, 0.18);
const C_MID = bandShade(FC.mod, 0.38);
const C_HOT = bandShade(FC.mod, 0.55);
const C_GLOW = bandShade(FC.mod, 0.9);
const C_RATE = bandShade(FC.mod, 0.45);
const C_DEPTH = bandShade(FC.mod, 0.65);
const C_DEST = bandShade(FC.mod, 0.78);
const C_OA = FC.oscA;
const C_OB = FC.oscB;
const C_OC = FC.oscC;

const RATE_MIN = 0.05;
const RATE_MAX = 30;

const WAVE_CYCLE: LfoWave[] = ["sine", "triangle", "sawtooth", "square", "sample-hold"];

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

function lfoShape(w: LfoWave, ph: number): number {
  const p = ((ph % 1) + 1) % 1;
  switch (w) {
    case "sine":
      return Math.sin(p * Math.PI * 2);
    case "triangle":
      return 1 - 4 * Math.abs(p - 0.5);
    case "sawtooth":
      return 1 - 2 * p;
    case "square":
      return p < 0.5 ? 1 : -1;
    case "sample-hold": {
      const step = Math.floor(ph * 8);
      const h = Math.sin(step * 127.1) * 43758.5453;
      return (h - Math.floor(h)) * 2 - 1;
    }
    default:
      return 0;
  }
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

type DragMode = "xy" | "morph" | null;
type MorphFocus = "a" | "b" | "c";

export function Lfo1StageViz() {
  const wave = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const depth = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const lfoA = useFireCommandStore((s) => s.patch.oscALfo) ?? 0;
  const lfoB = useFireCommandStore((s) => s.patch.oscBLfo) ?? 0;
  const lfoC = useFireCommandStore((s) => s.patch.oscCLfo) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const focusRef = useRef<MorphFocus>("a");
  const prevKey = useRef("");
  const st = useRef({ wave, rate, depth, dest, lfoA, lfoB, lfoC });
  st.current = { wave, rate, depth, dest, lfoA, lfoB, lfoC };

  const live =
    depth > 0.02 ||
    Math.abs(lfoA) > 0.04 ||
    Math.abs(lfoB) > 0.04 ||
    Math.abs(lfoC) > 0.04 ||
    dest !== "off";

  useEffect(() => {
    const key = `${wave}|${rate.toFixed(3)}|${depth.toFixed(3)}|${dest}|${lfoA.toFixed(3)}|${lfoB.toFixed(3)}|${lfoC.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1; // retrigger flash on any param change
    }
  }, [wave, rate, depth, dest, lfoA, lfoB, lfoC]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("lfo1Rate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("lfo1Depth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyMorph = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const signed = clamp(x * 2 - 1, -1, 1);
      const key = focusRef.current === "a" ? "oscALfo" : focusRef.current === "b" ? "oscBLfo" : "oscCLfo";
      setParam(key, Math.round(signed * 1000) / 1000);
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
        focusRef.current = x < 0.33 ? "a" : x < 0.66 ? "b" : "c";
        dragRef.current = "morph";
        wrap.setPointerCapture(e.pointerId);
        applyMorph(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMorph],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "morph") applyMorph(e.clientX);
    },
    [applyXy, applyMorph],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const i = WAVE_CYCLE.indexOf(st.current.wave);
    const next = WAVE_CYCLE[(i + 1) % WAVE_CYCLE.length]!;
    setParam("lfo1Wave", next);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const shards: Array<{ x: number; y: number; life: number; vx: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const PAD = 14;
      const mid = Hh * 0.4;
      const amp = Hh * (0.12 + Math.max(0.08, p.depth) * 0.28);
      const xL = PAD + 36;
      const xR = W - PAD;
      const span = xR - xL;
      const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
      const morphMag = Math.max(Math.abs(p.lfoA), Math.abs(p.lfoB), Math.abs(p.lfoC));
      const energy = 0.2 + p.depth * 0.45 + morphMag * 0.2 + (p.dest !== "off" ? 0.12 : 0) + flashRef.current * 0.25;
      const focus = focusRef.current;

      ctx.clearRect(0, 0, W, Hh);

      // Azure aurora chamber
      const bg = ctx.createRadialGradient(W * (0.35 + rateN * 0.2), mid, 4, W * 0.5, Hh * 0.45, W * 0.78);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.32 + flashRef.current * 0.25));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
      bg.addColorStop(1, "rgba(2,6,12,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Scope grid
      ctx.strokeStyle = hexAlpha(C_MID, 0.1 + p.depth * 0.08);
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = mid - amp + (amp * 2 * i) / 4;
        ctx.globalAlpha = i === 2 ? 0.4 : 0.15;
        ctx.beginPath();
        ctx.moveTo(xL, y + 0.5);
        ctx.lineTo(xR, y + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = hexAlpha(C_MID, 0.18);
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      ctx.lineTo(xR, mid);
      ctx.stroke();

      // Ghost phase layers
      for (let ghost = 2; ghost >= 0; ghost--) {
        ctx.beginPath();
        for (let x = xL; x <= xR; x += 2) {
          const ph = ((x - xL) / span) * 2 + ghost * 0.28;
          const y = mid - lfoShape(p.wave, ph) * amp * (0.45 + ghost * 0.12);
          if (x === xL) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_MID, (0.18 - ghost * 0.04) * (0.3 + p.depth));
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Ribbon fill
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      for (let x = xL; x <= xR; x += 1.5) {
        ctx.lineTo(x, mid - lfoShape(p.wave, ((x - xL) / span) * 2) * amp);
      }
      ctx.lineTo(xR, mid);
      ctx.closePath();
      const ribbon = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      ribbon.addColorStop(0, hexAlpha(C_GLOW, 0.28 + p.depth * 0.25));
      ribbon.addColorStop(0.5, hexAlpha(C, 0.1));
      ribbon.addColorStop(1, hexAlpha(C_DEEP, 0.04));
      ctx.fillStyle = ribbon;
      ctx.fill();

      // Main waveform
      const breathe = 0.88 + 0.12 * Math.sin(now / 600);
      ctx.beginPath();
      for (let x = xL; x <= xR; x++) {
        const y = mid - lfoShape(p.wave, ((x - xL) / span) * 2) * amp;
        if (x === xL) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.85 + flashRef.current * 0.15);
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 12 + p.depth * 14 + flashRef.current * 12 + breathe * 4;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Phase tracer — engine-true LFO sample when available
      let engT = now / 1000;
      let engVal: number | null = null;
      try {
        const eng = getEngine();
        engT = eng.ctx.currentTime;
        engVal = activeFireEngine().getLfoValue(1);
      } catch { /* fallback: local time math below */ }
      const ph = ((engT * p.rate) % 1 + 1) % 1;
      const px = xL + ph * span;
      const liveSample = engVal ?? lfoShape(p.wave, ph);
      const py = mid - liveSample * amp;

      for (let hist = 18; hist > 0; hist--) {
        const histPh = ((ph - hist * 0.02) % 1 + 1) % 1;
        const hx = xL + histPh * span;
        const hy = mid - lfoShape(p.wave, histPh) * amp;
        const a = (18 - hist) / 18;
        ctx.fillStyle = hexAlpha(C_HOT, a * 0.35 * (0.3 + p.depth));
        ctx.beginPath();
        ctx.arc(hx, hy, 1 + a * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      const bloom = ctx.createRadialGradient(px, py, 0, px, py, 14 + p.depth * 16);
      bloom.addColorStop(0, hexAlpha(C_GLOW, 0.65 + p.depth * 0.3));
      bloom.addColorStop(0.45, hexAlpha(C_DEST, 0.2));
      bloom.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(px, py, 16 + p.depth * 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8f4ff";
      ctx.shadowBlur = 16;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(px, py, 3.8 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Rate / depth crosshair
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

      // Destination badge / wash
      if (p.dest !== "off") {
        const destGlow = ctx.createLinearGradient(W - 70, 0, W, 0);
        destGlow.addColorStop(0, hexAlpha(C_DEST, 0));
        destGlow.addColorStop(1, hexAlpha(C_DEST, 0.14 + p.depth * 0.2));
        ctx.fillStyle = destGlow;
        ctx.fillRect(W - 70, 0, 70, Hh - 22);
      }

      // Left WT meters
      const dests: Array<{ v: number; col: string; label: string; id: MorphFocus }> = [
        { v: p.lfoA, col: C_OA, label: "A", id: "a" },
        { v: p.lfoB, col: C_OB, label: "B", id: "b" },
        { v: p.lfoC, col: C_OC, label: "C", id: "c" },
      ];
      dests.forEach((m, i) => {
        const my = 28 + i * 24;
        const bw = 26;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(10, my, bw, 8);
        const midX = 10 + bw / 2;
        const mag = Math.abs(m.v);
        if (mag > 0.02) {
          const w = (bw / 2) * mag;
          ctx.fillStyle = hexAlpha(m.col, 0.8);
          ctx.shadowBlur = 5;
          ctx.shadowColor = m.col;
          if (m.v >= 0) ctx.fillRect(midX, my, w, 8);
          else ctx.fillRect(midX - w, my, w, 8);
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = hexAlpha(m.col, focus === m.id ? 0.95 : 0.45);
        ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(m.label, 10 + bw + 4, my + 7);
      });

      // Morph shards when WT routing live
      if (morphMag > 0.06 && Math.random() < 0.1 + morphMag * 0.25) {
        shards.push({ x: xL + Math.random() * span, y: mid + (Math.random() - 0.5) * amp * 2, life: 1, vx: (Math.random() - 0.5) * 2 });
      }
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i]!;
        s.life -= 0.03;
        if (s.life <= 0) {
          shards.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        ctx.fillStyle = hexAlpha(C_HOT, s.life * 0.65);
        ctx.fillRect(s.x, s.y, 2, 2);
      }

      // Wave chip + retrigger flash rim
      const waveLabel = String(p.wave).toUpperCase().replace("SAMPLE-HOLD", "S&H");
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const modeW = ctx.measureText(waveLabel).width + 12;
      const chipX = W * 0.5 - modeW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, modeW, 13);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, modeW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(waveLabel, W * 0.5, 16);

      if (flashRef.current > 0.15) {
        ctx.fillStyle = hexAlpha(C_GLOW, flashRef.current * 0.22);
        ctx.fillRect(0, 0, W, 3);
        ctx.fillRect(0, Hh - 3, W, 3);
      }

      // →WT rail
      const railY = Hh - 16;
      const focusVal = focus === "a" ? p.lfoA : focus === "b" ? p.lfoB : p.lfoC;
      const focusCol = focus === "a" ? C_OA : focus === "b" ? C_OB : C_OC;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_DEPTH, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const midRail = 12 + (W - 24) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(midRail - 0.5, railY, 1, 7);
      const signedX = midRail + focusVal * ((W - 24) / 2);
      if (Math.abs(focusVal) > 0.02) {
        const left = Math.min(midRail, signedX);
        const right = Math.max(midRail, signedX);
        const rg = ctx.createLinearGradient(left, railY, right, railY);
        rg.addColorStop(0, hexAlpha(focusCol, 0.3));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.75));
        ctx.fillStyle = rg;
        ctx.fillRect(left, railY + 1, right - left, 5);
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(signedX, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_DEPTH, 0.75);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`→WT ${focus.toUpperCase()}`, 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("LFO1 · PHASE AURORA", 12, Hh - 2);
      ctx.textAlign = "right";
      const destLabel = p.dest === "off" ? "IDLE" : `→${p.dest.toUpperCase()}`;
      ctx.fillStyle = hexAlpha(p.dest !== "off" ? C_DEST : C_MID, 0.88);
      ctx.fillText(`${p.rate.toFixed(2)}Hz · D${Math.round(p.depth * 100)} · ${destLabel}`, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active:
          (st.current.depth ?? 0) > 0.02 ||
          st.current.dest !== "off" ||
          Math.abs(st.current.lfoA ?? 0) > 0.04 ||
          Math.abs(st.current.lfoB ?? 0) > 0.04 ||
          Math.abs(st.current.lfoC ?? 0) > 0.04,
        dragging: !!dragRef.current,
        particles: shards.length,
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
      title="Drag: Rate ↔ / Depth ↕ · Bottom: LFO→WT (thirds A/B/C) · Double-click: cycle wave"
      role="img"
      aria-label="LFO 1 phase aurora"
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
        Phase Aurora
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{
          color: hexAlpha(live ? C_HOT : C_MID, live ? 0.9 : 0.7),
          textShadow: live ? `0 0 10px ${hexAlpha(C, 0.65)}` : undefined,
        }}
      >
        {live ? "ACTIVE" : "IDLE"}
      </div>
    </div>
  );
}
