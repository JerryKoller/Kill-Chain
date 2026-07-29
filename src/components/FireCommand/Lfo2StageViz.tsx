/**
 * LFO 2 — Twin Orbit stage visualizer.
 * Secondary Mod-band modulator (Signal Path · FC.lfo2).
 * Drag: Rate ↔ / Depth ↕. Bottom rail: sync ratio vs LFO 1. Double-click: cycle wave.
 * Ghost LFO 1 + dual orbital rings give it a twin identity distinct from Phase Aurora.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import type { LfoWave } from "@/audio/dsp/FireCommandSynth";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.lfo2;
const C1 = FC.lfo;
const C_DEEP = bandShade(FC.mod, 0.28);
const C_MID = bandShade(FC.mod, 0.48);
const C_HOT = bandShade(FC.mod, 0.68);
const C_GLOW = bandShade(FC.mod, 0.95);
const C_RATE = bandShade(FC.mod, 0.55);
const C_DEPTH = bandShade(FC.mod, 0.78);
const C_DEST = bandShade(FC.mod, 0.88);
const C_LINK = bandShade(FC.mod, 0.62);

const RATE_MIN = 0.05;
const RATE_MAX = 30;

const WAVE_CYCLE: LfoWave[] = ["sine", "triangle", "sawtooth", "square", "sample-hold"];

/** Bottom-rail sync ratios vs LFO 1 rate */
const SYNC_RATIOS = [0.25, 0.5, 1, 2, 4] as const;

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

function nearestSyncRatio(rate2: number, rate1: number): (typeof SYNC_RATIOS)[number] {
  const r1 = Math.max(RATE_MIN, rate1);
  const actual = rate2 / r1;
  let best: (typeof SYNC_RATIOS)[number] = SYNC_RATIOS[0]!;
  let bestD = Infinity;
  for (const r of SYNC_RATIOS) {
    const d = Math.abs(Math.log2(actual / r));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

function syncRatioLabel(r: number): string {
  if (r < 1) return `1/${Math.round(1 / r)}×`;
  return `${r}×`;
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

type DragMode = "xy" | "link" | null;

export function Lfo2StageViz() {
  const wave = useFireCommandStore((s) => s.patch.lfo2Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo2Rate) ?? 0.5;
  const depth = useFireCommandStore((s) => s.patch.lfo2Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo2Dest) ?? "off";
  const wave1 = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const rate1 = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const depth1 = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const relation = useFireCommandStore((s) => s.patch.lfo2Relation) ?? "independent";
  const phaseOffset = useFireCommandStore((s) => s.patch.lfo2PhaseOffset) ?? 90;
  const ratioParam = useFireCommandStore((s) => s.patch.lfo2Ratio) ?? 1;
  const driftMode = useFireCommandStore((s) => s.patch.lfo2DriftMode) ?? "locked";
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({
    wave,
    rate,
    depth,
    dest,
    wave1,
    rate1,
    depth1,
    relation,
    phaseOffset,
    ratioParam,
    driftMode,
  });
  st.current = {
    wave,
    rate,
    depth,
    dest,
    wave1,
    rate1,
    depth1,
    relation,
    phaseOffset,
    ratioParam,
    driftMode,
  };

  const live = depth > 0.02 || dest !== "off" || relation !== "independent";

  useEffect(() => {
    const key = `${wave}|${rate.toFixed(3)}|${depth.toFixed(3)}|${dest}|${rate1.toFixed(3)}|${relation}|${phaseOffset}|${ratioParam}|${driftMode}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1; // retrigger flash on param change
    }
  }, [wave, rate, depth, dest, rate1, relation, phaseOffset, ratioParam, driftMode]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("lfo2Rate", Math.round(logLerp(x, RATE_MIN, RATE_MAX) * 1000) / 1000);
      setParam("lfo2Depth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyLink = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const idx = clamp(Math.floor(x * SYNC_RATIOS.length), 0, SYNC_RATIOS.length - 1);
      const ratio = SYNC_RATIOS[idx]!;
      const r1 = Math.max(RATE_MIN, st.current.rate1);
      const next = clamp(r1 * ratio, RATE_MIN, RATE_MAX);
      setParam("lfo2Rate", Math.round(next * 1000) / 1000);
      setParam("lfo2Ratio", ratio);
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
        dragRef.current = "link";
        wrap.setPointerCapture(e.pointerId);
        applyLink(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyLink],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "link") applyLink(e.clientX);
    },
    [applyXy, applyLink],
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
    setParam("lfo2Wave", next);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ a: number; r: number; life: number; spin: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const PAD = 14;
      const mid = Hh * 0.38;
      const amp = Hh * (0.1 + Math.max(0.06, p.depth) * 0.26);
      const xL = PAD + 28;
      const xR = W - PAD;
      const span = xR - xL;
      const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
      const patchRatio = clamp(p.ratioParam ?? 1, 0.125, 8);
      const ratio = p.relation === "ratio" ? patchRatio : nearestSyncRatio(p.rate, p.rate1);
      const isLinked =
        p.relation === "ratio" ||
        p.relation === "mirror" ||
        p.relation === "invert" ||
        p.relation === "phaseOffset" ||
        p.relation === "followLag" ||
        Math.abs(Math.log2(Math.max(RATE_MIN, p.rate) / Math.max(RATE_MIN, p.rate1 * (typeof ratio === "number" ? ratio : 1)))) < 0.12;
      const energy =
        0.18 +
        p.depth * 0.5 +
        (p.dest !== "off" ? 0.14 : 0) +
        (isLinked ? 0.1 : 0) +
        flashRef.current * 0.28;

      ctx.clearRect(0, 0, W, Hh);

      // Twin orbit chamber — cooler, lighter Mod azure
      const bg = ctx.createRadialGradient(W * (0.55 - rateN * 0.15), mid, 6, W * 0.5, Hh * 0.42, W * 0.82);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.12 + energy * 0.34 + flashRef.current * 0.22));
      bg.addColorStop(0.4, hexAlpha(C_DEEP, 0.52));
      bg.addColorStop(1, "rgba(1,8,16,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Soft concentric orbit rings (unique vs LFO1 ribbon)
      const ox = W * 0.52;
      const oy = mid;
      for (let ring = 3; ring >= 1; ring--) {
        const rx = 28 + ring * (18 + p.depth * 10) + rateN * 8;
        const ry = 14 + ring * (8 + p.depth * 5);
        ctx.beginPath();
        ctx.ellipse(ox, oy, rx, ry, Math.sin(now / 4000 + ring) * 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(C_MID, (0.08 + p.depth * 0.1) * (1 - ring * 0.15));
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Scope baseline
      ctx.strokeStyle = hexAlpha(C_MID, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      ctx.lineTo(xR, mid);
      ctx.stroke();

      const phaseOff01 = ((p.phaseOffset ?? 0) / 360) % 1;
      const rate1Eff = Math.max(RATE_MIN, p.rate1);
      const rate2Eff =
        p.relation === "ratio" || p.relation === "mirror" || p.relation === "invert" || p.relation === "phaseOffset"
          ? rate1Eff * (p.relation === "ratio" ? patchRatio : 1)
          : Math.max(RATE_MIN, p.rate);

      // Samples along span for LFO1 ghost + LFO2 + difference band
      const sampN = Math.max(2, Math.floor(span));
      const y1: number[] = [];
      const y2: number[] = [];
      for (let i = 0; i <= sampN; i++) {
        const t = i / sampN;
        const ph1 = t * 2;
        const ph2 =
          p.relation === "independent"
            ? t * 2
            : p.relation === "ratio"
              ? t * 2 * patchRatio + phaseOff01
              : t * 2 + phaseOff01;
        let v1 = lfoShape(p.wave1, ph1);
        let v2 = lfoShape(p.relation !== "independent" ? p.wave1 : p.wave, ph2);
        if (p.relation === "invert") v2 = -v2;
        y1.push(mid - v1 * amp * (0.35 + Math.min(0.35, p.depth1 * 0.4)));
        y2.push(mid - v2 * amp);
      }

      // Shaded difference between twin waves
      ctx.beginPath();
      ctx.moveTo(xL, y1[0]!);
      for (let i = 1; i <= sampN; i++) ctx.lineTo(xL + (i / sampN) * span, y1[i]!);
      for (let i = sampN; i >= 0; i--) ctx.lineTo(xL + (i / sampN) * span, y2[i]!);
      ctx.closePath();
      const diffFill = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      diffFill.addColorStop(0, hexAlpha(C_LINK, 0.1 + p.depth * 0.12));
      diffFill.addColorStop(0.5, hexAlpha(C, 0.06));
      diffFill.addColorStop(1, hexAlpha(C1, 0.08));
      ctx.fillStyle = diffFill;
      ctx.fill();

      // Ghost LFO 1 (dim) — twin presence
      ctx.beginPath();
      for (let i = 0; i <= sampN; i++) {
        const x = xL + (i / sampN) * span;
        if (i === 0) ctx.moveTo(x, y1[i]!);
        else ctx.lineTo(x, y1[i]!);
      }
      ctx.strokeStyle = hexAlpha(C1, 0.14 + Math.min(0.22, p.depth1 * 0.28));
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // LFO 2 fill under curve
      ctx.beginPath();
      ctx.moveTo(xL, mid);
      for (let i = 0; i <= sampN; i++) ctx.lineTo(xL + (i / sampN) * span, y2[i]!);
      ctx.lineTo(xR, mid);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      fill.addColorStop(0, hexAlpha(C_GLOW, 0.22 + p.depth * 0.28));
      fill.addColorStop(0.55, hexAlpha(C, 0.08));
      fill.addColorStop(1, hexAlpha(C_DEEP, 0.03));
      ctx.fillStyle = fill;
      ctx.fill();

      // Main LFO 2 waveform (bright)
      ctx.beginPath();
      for (let i = 0; i <= sampN; i++) {
        const x = xL + (i / sampN) * span;
        if (i === 0) ctx.moveTo(x, y2[i]!);
        else ctx.lineTo(x, y2[i]!);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.88 + flashRef.current * 0.12);
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 10 + p.depth * 16 + flashRef.current * 10;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Engine-true twin samples for playheads + alignment
      let engT = now / 1000;
      let eng1: number | null = null;
      let eng2: number | null = null;
      try {
        const eng = getEngine();
        engT = eng.ctx.currentTime;
        eng1 = activeFireEngine().getLfoValue(1);
        eng2 = activeFireEngine().getLfoValue(2);
      } catch { /* local fallback below */ }
      const ph = ((engT * rate2Eff) % 1 + 1) % 1;
      const ph1 = ((engT * rate1Eff) % 1 + 1) % 1;
      const live1 = eng1 ?? lfoShape(p.wave1, ph1);
      const live2 =
        eng2 ??
        (p.relation === "invert"
          ? -lfoShape(p.wave1, (ph1 + phaseOff01) % 1)
          : lfoShape(p.relation !== "independent" ? p.wave1 : p.wave, ph));
      const px = xL + ph * span;
      const py = mid - live2 * amp;
      const gx = xL + ph1 * span;
      const gy = mid - live1 * amp * (0.35 + Math.min(0.35, p.depth1 * 0.4));
      const aligned = Math.abs(live1 - live2) < 0.08;

      // Orbit trail on LFO2
      for (let hist = 22; hist > 0; hist--) {
        const histPh = ((ph - hist * 0.018) % 1 + 1) % 1;
        const hx = xL + histPh * span;
        const hy = mid - lfoShape(p.relation !== "independent" ? p.wave1 : p.wave, histPh) * amp;
        const a = (22 - hist) / 22;
        ctx.fillStyle = hexAlpha(C_HOT, a * 0.4 * (0.25 + p.depth));
        ctx.beginPath();
        ctx.arc(hx, hy, 1.2 + a * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Dim LFO1 ghost cursor
      ctx.fillStyle = hexAlpha(C1, 0.4 + p.depth1 * 0.2);
      ctx.beginPath();
      ctx.arc(gx, gy, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(C1, 0.22);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(gx, gy);
      ctx.stroke();

      // Primary bloom (LFO2)
      const bloom = ctx.createRadialGradient(px, py, 0, px, py, 16 + p.depth * 14);
      bloom.addColorStop(0, hexAlpha(C_GLOW, 0.7 + p.depth * 0.25));
      bloom.addColorStop(0.4, hexAlpha(C_DEST, 0.22));
      bloom.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(px, py, 18 + p.depth * 12, 0, Math.PI * 2);
      ctx.fill();

      // Local orbit ring around tracer
      const spin = now / 900;
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + p.depth * 0.25 + flashRef.current * 0.2);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(px, py, 10 + p.depth * 8, 5 + p.depth * 4, spin, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px, py, 6 + p.depth * 5, 3 + p.depth * 2.5, -spin * 1.3, 0, Math.PI * 2);
      ctx.strokeStyle = hexAlpha(C_HOT, 0.25 + energy * 0.2);
      ctx.stroke();

      ctx.fillStyle = "#f0f8ff";
      ctx.shadowBlur = 14;
      ctx.shadowColor = C;
      ctx.beginPath();
      ctx.arc(px, py, 3.6 + flashRef.current * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Phase-alignment sparks when twin values near equal
      if (aligned && Math.random() < 0.35 + p.depth * 0.3) {
        sparks.push({
          a: Math.atan2(py - oy, px - ox) + (Math.random() - 0.5) * 0.6,
          r: 8 + Math.random() * 22,
          life: 1,
          spin: (Math.random() - 0.5) * 0.12,
        });
      }

      // Destination satellite body (orbits when live)
      if (p.dest !== "off") {
        const satA = spin * 0.7 + (p.dest === "pan" ? 1.2 : p.dest === "filter" ? 0.4 : 0);
        const satR = 22 + p.depth * 18;
        const sx = px + Math.cos(satA) * satR;
        const sy = py + Math.sin(satA) * (satR * 0.45);
        ctx.strokeStyle = hexAlpha(C_DEST, 0.35);
        ctx.beginPath();
        ctx.ellipse(px, py, satR, satR * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = hexAlpha(C_DEST, 0.85);
        ctx.shadowBlur = 8;
        ctx.shadowColor = C_DEST;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = hexAlpha(C_DEST, 0.9);
        ctx.font = "800 7px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.dest.slice(0, 3).toUpperCase(), sx, sy - 7);
      }

      // Rate / depth crosshair
      const hx = rateN * W;
      const hy = (1 - p.depth) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.32 + flashRef.current * 0.28);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(hx - 7, hy);
      ctx.lineTo(hx + 7, hy);
      ctx.moveTo(hx, hy - 7);
      ctx.lineTo(hx, hy + 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.strokeStyle = hexAlpha(C_RATE, 0.45);
      ctx.stroke();

      // Link / alignment sparks
      if ((isLinked || aligned) && Math.random() < 0.08 + p.depth * 0.15) {
        sparks.push({ a: Math.random() * Math.PI * 2, r: 20 + Math.random() * 30, life: 1, spin: (Math.random() - 0.5) * 0.08 });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.028;
        s.a += s.spin;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        const sx = ox + Math.cos(s.a) * s.r;
        const sy = oy + Math.sin(s.a) * s.r * 0.4;
        ctx.fillStyle = hexAlpha(aligned ? C_GLOW : C_LINK, s.life * 0.75);
        ctx.beginPath();
        ctx.arc(sx, sy, aligned ? 2 : 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Wave chip
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

      // Live relation / ratio readout
      const relLabel =
        p.relation === "independent"
          ? "INDEP"
          : p.relation === "ratio"
            ? `RATIO ${patchRatio % 1 === 0 ? patchRatio.toFixed(0) : patchRatio.toFixed(2)}×`
            : p.relation === "phaseOffset"
              ? `φ${Math.round(p.phaseOffset)}°`
              : p.relation === "followLag"
                ? "FOLLOW"
                : p.relation.toUpperCase();
      const driftTag = p.driftMode !== "locked" ? ` · ${String(p.driftMode).toUpperCase()}` : "";
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_LINK, 0.85);
      ctx.fillText(`${relLabel}${driftTag}`, 12, 28);

      // Sync link rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_LINK, isLinked ? 0.45 : 0.22);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);

      const slotW = (W - 24) / SYNC_RATIOS.length;
      const nearest = nearestSyncRatio(p.rate, p.rate1);
      SYNC_RATIOS.forEach((r, i) => {
        const sx = 12 + i * slotW;
        const on =
          (p.relation === "ratio" && Math.abs(Math.log2(patchRatio / r)) < 0.08) ||
          (p.relation !== "ratio" && Math.abs(r - nearest) < 0.01 && isLinked);
        if (on) {
          ctx.fillStyle = hexAlpha(C_LINK, 0.45 + flashRef.current * 0.25);
          ctx.fillRect(sx + 1, railY + 1, slotW - 2, 5);
        }
        ctx.fillStyle = hexAlpha(on ? C_GLOW : C_MID, on ? 0.95 : 0.45);
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(syncRatioLabel(r), sx + slotW / 2, railY - 3);
      });

      // Thumb on active ratio
      const thumbRatio = p.relation === "ratio" ? nearestSyncRatio(rate1Eff * patchRatio, rate1Eff) : nearest;
      const thumbI = SYNC_RATIOS.indexOf(thumbRatio as (typeof SYNC_RATIOS)[number]);
      const ti = thumbI >= 0 ? thumbI : 2;
      const tx = 12 + (ti + 0.5) * slotW;
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(tx, railY + 3.5, 3.2 + flashRef.current * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("LFO2 · TWIN ORBIT", 12, Hh - 2);
      ctx.textAlign = "right";
      const destLabel = p.dest === "off" ? "IDLE" : `→${p.dest.toUpperCase()}`;
      const ratioRead =
        p.relation === "ratio"
          ? ` · ${patchRatio % 1 === 0 ? patchRatio.toFixed(0) : patchRatio.toFixed(2)}×L1`
          : isLinked
            ? ` · ${syncRatioLabel(nearest)}L1`
            : "";
      ctx.fillStyle = hexAlpha(p.dest !== "off" || p.depth > 0.02 ? C_DEST : C_MID, 0.88);
      ctx.fillText(`${p.rate.toFixed(2)}Hz · D${Math.round(p.depth * 100)} · ${destLabel}${ratioRead}`, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active:
          (st.current.depth ?? 0) > 0.02 ||
          st.current.dest !== "off" ||
          (st.current.relation ?? "independent") !== "independent",
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
      title="Drag: Rate ↔ / Depth ↕ · Bottom: sync × LFO1 · Double-click: cycle wave"
      role="img"
      aria-label="LFO 2 twin orbit"
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
        Twin Orbit
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
