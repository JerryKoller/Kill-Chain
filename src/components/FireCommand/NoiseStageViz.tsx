/**
 * NOISE — Grain Storm stage visualizer.
 *
 * IDIOM: the grain storm. This is a particle field and nothing else — density
 * sets how many specks the letterbox holds, grain sets how coarse each one is,
 * and the colour tilt tips the whole field's vertical distribution (dark rumble
 * settles on the floor, bright hiss lifts to the ceiling). Burst gates the field
 * into columns; Storm sweeps sheets of it across the width.
 *
 * Every speck comes from a hash of its index, so the field is a fixed
 * constellation that drifts rather than a new random dust cloud each frame.
 *
 * Level · Color · Density · Grain · Storm mode · Chip grit (Sources · FC.noise).
 * Drag: Color ↔ / Level ↕. Shift or bottom: Density ↔ / Grain ↕.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ChipNoiseMode, NoiseMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  cachedGrad,
  drawGlow,
  footer,
  grain as filmGrain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 158;
const C = FC.noise;
const C_DEEP = bandShade(FC.sources, 0.5);
const C_MID = bandShade(FC.sources, 0.62);
const C_HOT = bandShade(FC.sources, 0.78);
const C_GLOW = bandShade(FC.sources, 0.92);
const C_DARK = bandShade(FC.sources, 0.38);
const C_BRIGHT = bandShade(FC.sources, 0.85);

/** Burst gating resolution across the width. */
const GATES = 16;
/** Storm mode as a number, so it can ride in the allocation-free motion hash. */
const STORM_IX: Record<NoiseMode, number> = { bed: 0, burst: 1, storm: 2 };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic scatter — the field is a fixed constellation, not fresh dust. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function gritSize(mode: ChipNoiseMode): number {
  if (mode === "periodic") return 3.2;
  if (mode === "nes") return 2.6;
  if (mode === "gb") return 1.8;
  return 1.15;
}

function gritLabel(mode: ChipNoiseMode): string {
  if (mode === "periodic") return "PER";
  if (mode === "nes") return "HOLD";
  if (mode === "gb") return "SOFT";
  return "WHT";
}

/**
 * Field scratch. Preallocated so a 1000-speck storm costs no garbage: one pass
 * bins specks into three brightness tiers, each tier drawn as a single path.
 */
const MAX_SPECKS = 1200;
const sxBuf = new Float32Array(MAX_SPECKS * 3);
const syBuf = new Float32Array(MAX_SPECKS * 3);
const szBuf = new Float32Array(MAX_SPECKS * 3);
const tierN = new Int32Array(3);
const gate = new Float32Array(GATES);

export type NoiseState = {
  level: number;
  color: number;
  mode: ChipNoiseMode;
  stormMode: NoiseMode;
  density: number;
  grain: number;
  enabled: boolean;
};

export function paintNoise(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: NoiseState,
  now: number,
  flash: number,
): void {
  const lvl = clamp(p.level, 0, 1);
  const tilt = clamp(p.color, -1, 1);
  const dens = clamp(p.density ?? 0.45, 0, 1);
  const grn = clamp(p.grain ?? 0.35, 0, 1);
  const storm = p.stormMode ?? "bed";
  const dormant = lvl < 0.02;
  const energy = dormant ? 0.08 : 0.2 + lvl * 0.8;
  const szBase = gritSize(p.mode) * (0.55 + grn * 1.35);
  const eBucket = (energy * 12) | 0;

  ctx.clearRect(0, 0, W, Hh);
  // Tilt lifts the chamber's light: rumble pools low, hiss floats high.
  plate(ctx, W, Hh, C, { energy, horizon: clamp(0.55 - tilt * 0.26, 0.18, 0.86) });

  const fx0 = 24;
  const fx1 = Math.max(fx0 + 20, W - 26);
  const fw = fx1 - fx0;
  const fy0 = 22;
  const fy1 = Hh - 26;
  const fh = fy1 - fy0;

  // Spectral wash — which half of the band the noise actually occupies.
  if (Math.abs(tilt) > 0.04) {
    ctx.fillStyle = cachedGrad(ctx, `noiseBand|${Hh}|${(tilt * 10) | 0}|${eBucket}`, (c) => {
      const g = c.createLinearGradient(0, 0, 0, Hh);
      if (tilt < 0) {
        g.addColorStop(0, hexA(C_DARK, 0));
        g.addColorStop(0.62, hexA(C_DARK, 0.07 * Math.abs(tilt)));
        g.addColorStop(1, hexA(C_DARK, 0.3 * Math.abs(tilt)));
      } else {
        g.addColorStop(0, hexA(C_BRIGHT, 0.3 * tilt));
        g.addColorStop(0.4, hexA(C_HOT, 0.09 * tilt));
        g.addColorStop(1, hexA(C, 0));
      }
      return g;
    });
    ctx.fillRect(0, 0, W, Hh);
  }

  // ── burst gating: the field only exists inside open columns ──
  for (let g = 0; g < GATES; g++) {
    if (storm === "bed") {
      gate[g] = 1;
      continue;
    }
    const ph = (((now * (storm === "burst" ? 0.0016 : 0.0009) + hash01(g * 5.17)) % 1) + 1) % 1;
    const width = storm === "burst" ? 0.22 + dens * 0.4 : 0.45 + dens * 0.5;
    gate[g] = ph < width ? 1 - (ph / width) * 0.35 : 0;
  }
  if (storm !== "bed") {
    for (let g = 0; g < GATES; g++) {
      const open = gate[g]!;
      if (open <= 0) continue;
      const gx = fx0 + (g / GATES) * fw;
      const gw = fw / GATES;
      ctx.fillStyle = hexA(C_MID, 0.03 + open * 0.05 * energy);
      ctx.fillRect(gx, fy0, gw - 1, fh);
      ctx.fillStyle = hexA(C_GLOW, 0.1 + open * 0.3 * energy);
      ctx.fillRect(gx, fy0, gw - 1, 1);
      ctx.fillRect(gx, fy1 - 1, gw - 1, 1);
    }
  }

  // ── the field ──
  // Specks are keyed off their index, so the constellation is stable and only
  // the drift term moves. One pass sorts them into three brightness tiers, then
  // each tier goes down as a single path — three fills for the whole storm.
  const nSpecks = Math.min(
    MAX_SPECKS,
    Math.floor((storm === "bed" ? 48 : storm === "burst" ? 62 : 80) + dens * 320 * (0.25 + lvl * 0.75)) *
      Math.max(1, Math.round(W / 900)),
  );
  const drift = now * 0.00004 * (1 + lvl * 2);
  const quant = 1 + grn * 9;
  const tiltDir = tilt >= 0 ? 1 : -1;
  tierN[0] = 0;
  tierN[1] = 0;
  tierN[2] = 0;
  for (let i = 0; i < nSpecks; i++) {
    const bx = hash01(i * 1.13);
    if (gate[Math.floor(bx * GATES) % GATES]! <= 0) continue;
    const b = hash01(i * 9.71);
    const tier = b < 0.55 ? 0 : b < 0.87 ? 1 : 2;
    const speed = 0.4 + hash01(i * 4.41) * 1.6;
    const ux = (((bx + drift * speed * tiltDir) % 1) + 1) % 1;
    const hy = hash01(i * 2.71);
    // Tilt tips the distribution: dark settles low, bright climbs high.
    const uy = tilt < -0.05
      ? Math.pow(hy, 1 / (1 + Math.abs(tilt) * 1.4))
      : tilt > 0.05
        ? 1 - Math.pow(1 - hy, 1 / (1 + tilt * 1.4))
        : hy;
    const cnt = tierN[tier]!;
    const slot = tier * MAX_SPECKS + cnt;
    sxBuf[slot] = Math.round((fx0 + ux * fw) / quant) * quant;
    syBuf[slot] = fy0 + uy * fh;
    szBuf[slot] = szBase * (0.7 + hash01(i * 3.77) * 0.85);
    tierN[tier] = cnt + 1;
  }
  const shimmer = 0.82 + 0.18 * Math.sin(now * 0.003);
  const fieldA = (dormant ? 0.16 : 0.35 + lvl * 0.5) * shimmer;
  const tierColor = tilt < -0.15 ? C_DARK : tilt > 0.15 ? C_BRIGHT : C_MID;
  const tierStyle = [
    hexA(C_DEEP, fieldA * 0.45),
    hexA(tierColor, fieldA * 0.8),
    hexA(C_GLOW, fieldA),
  ];
  for (let t = 0; t < 3; t++) {
    const n = tierN[t]!;
    if (n === 0) continue;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const slot = t * MAX_SPECKS + k;
      ctx.rect(sxBuf[slot]!, syBuf[slot]!, szBuf[slot]!, szBuf[slot]!);
    }
    ctx.fillStyle = tierStyle[t]!;
    ctx.fill();
  }

  // Storm sheets: the field visibly travels rather than just sitting there.
  if (storm === "storm" && !dormant) {
    lit(ctx, () => {
      for (let s = 0; s < 4; s++) {
        const u = ((now * 0.00022 * (1 + s * 0.4) + s * 0.27) % 1 + 1) % 1;
        drawGlow(ctx, fx0 + u * fw, fy0 + (0.3 + hash01(s * 6.3) * 0.4) * fh, 34 + dens * 40, C_HOT, 0.05 + dens * 0.12);
      }
    });
  }

  // ── grain hairline: the noise as a signal, roughness = grain ──
  if (!dormant) {
    const midY = fy0 + (0.5 - tilt * 0.22) * fh;
    const hAmp = fh * 0.16 * lvl;
    const stepPx = 2 + grn * 12;
    const tick = Math.floor(now * 0.05);
    ctx.strokeStyle = hexA(C_GLOW, 0.16 + lvl * 0.3);
    ctx.lineWidth = 1 + grn * 1.4;
    ctx.beginPath();
    for (let x = 0; x <= fw; x += stepPx) {
      const y = midY + (hash01(Math.floor(x / stepPx) * 1.91 + tick * 0.37) - 0.5) * 2 * hAmp;
      if (x === 0) ctx.moveTo(fx0 + x, y);
      else ctx.lineTo(fx0 + x, y);
    }
    ctx.stroke();
  }

  // ── spectrum tilt meter (left) ──
  const meterX = 10;
  const meterTop = 28;
  const meterH = Hh - 56;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(meterX, meterTop, 6, meterH);
  ctx.save();
  ctx.translate(meterX, meterTop);
  ctx.fillStyle = cachedGrad(ctx, `noiseTilt|${meterH | 0}`, (c) => {
    const g = c.createLinearGradient(0, 0, 0, meterH);
    g.addColorStop(0, hexA(C_BRIGHT, 0.9));
    g.addColorStop(0.5, hexA(C_MID, 0.5));
    g.addColorStop(1, hexA(C_DARK, 0.9));
    return g;
  });
  ctx.fillRect(0, 0, 6, meterH);
  ctx.restore();
  const needleY = meterTop + ((1 - tilt) / 2) * meterH;
  lit(ctx, () => drawGlow(ctx, meterX + 3, needleY, 9, C_GLOW, 0.8));
  ctx.fillStyle = hexA(C_GLOW, 0.95);
  ctx.fillRect(meterX - 2, needleY - 1.5, 10, 3);

  // ── level bar (right) ──
  const lx = W - 16;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(lx, meterTop, 6, meterH);
  const lh = meterH * lvl;
  ctx.fillStyle = hexA(C_GLOW, 0.4 + lvl * 0.5);
  ctx.fillRect(lx, meterTop + meterH - lh, 6, lh);
  lit(ctx, () => drawGlow(ctx, lx + 3, meterTop + meterH - lh, 8, C_GLOW, 0.75));

  // Crosshair at the colour / level the drag pad maps to.
  const hx = ((tilt + 1) / 2) * W;
  const hyc = (1 - lvl) * Hh;
  ctx.strokeStyle = hexA(C_GLOW, dormant ? 0.15 : 0.4 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 8, hyc);
  ctx.lineTo(hx + 8, hyc);
  ctx.moveTo(hx, hyc - 8);
  ctx.lineTo(hx, hyc + 8);
  ctx.stroke();
  ctx.fillStyle = hexA(C_HOT, 0.85);
  ctx.beginPath();
  ctx.arc(hx, hyc, 2.6 + flash * 2, 0, Math.PI * 2);
  ctx.fill();

  // Density / grain readout — the shift-drag axes finally have numbers.
  // Starts past VIZ_TOP_LABEL_X so it clears the DOM character eyebrow.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  const lx0 = VIZ_TOP_LABEL_X;
  ctx.fillStyle = hexA(C_MID, 0.6);
  ctx.fillText(`DENS ${Math.round(dens * 100)}`, lx0, VIZ_TOP_LABEL_Y);
  ctx.fillStyle = hexA(C_HOT, 0.6);
  ctx.fillText(`GRAIN ${Math.round(grn * 100)}`, lx0 + 60, VIZ_TOP_LABEL_Y);
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.fillText(`GRIT ${gritLabel(p.mode)}`, lx0 + 130, VIZ_TOP_LABEL_Y);

  pill(
    ctx,
    W * 0.5,
    3,
    tilt < -0.08 ? "LP DARK" : tilt > 0.08 ? "HP BRIGHT" : "FLAT",
    C_GLOW,
    { glow: flash },
  );

  if (dormant) {
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillRect(0, 0, W, Hh);
    ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.5 + Math.sin(now / 500) * 0.1);
    ctx.fillText("MUTED — drag up to raise storm", W * 0.5, Hh * 0.5);
  }

  filmGrain(ctx, W, Hh, 0.03);
  bezel(ctx, W, Hh, C);
  const stormLabel = storm === "bed" ? "BED" : storm === "burst" ? "BURST" : "STORM";
  footer(
    ctx,
    W,
    Hh,
    `NOISE · ${stormLabel} · ${gritLabel(p.mode)}`,
    dormant ? "OFF" : `${Math.round(lvl * 100)}% · ${tilt > 0 ? "+" : ""}${Math.round(tilt * 100)}`,
    C_GLOW,
    dormant ? C_MID : C_HOT,
  );
}

export function NoiseStageViz() {
  const level = useFireCommandStore((s) => s.patch.noiseLevel) ?? 0;
  const color = useFireCommandStore((s) => s.patch.noiseColor) ?? 0;
  const mode = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const stormMode = useFireCommandStore((s) => s.patch.noiseMode) ?? "bed";
  const density = useFireCommandStore((s) => s.patch.noiseDensity) ?? 0.45;
  const grain = useFireCommandStore((s) => s.patch.noiseGrain) ?? 0.35;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["noise"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<"xy" | "grain" | null>(null);
  const prevKey = useRef(0);
  const st = useRef<NoiseState>({ level, color, mode, stormMode, density, grain, enabled });
  st.current = { level, color, mode, stormMode, density, grain, enabled };

  const silent = !enabled || level < 0.02;

  useEffect(() => {
    const key = motionHash(enabled, level, color, density, grain, gritSize(mode), STORM_IX[stormMode]);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [enabled, level, color, mode, stormMode, density, grain]);

  const applyFromPointer = useCallback(
    (clientX: number, clientY: number, kind: "xy" | "grain") => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (kind === "grain") {
        setParam("noiseDensity", Math.round(x * 1000) / 1000);
        setParam("noiseGrain", Math.round((1 - y) * 1000) / 1000);
        return;
      }
      // X → color (−1..1), Y → level (1 at top) — particle editor mapping
      setModuleEnable("noise", true);
      setParam("noiseColor", Math.round((x * 2 - 1) * 1000) / 1000);
      setParam("noiseLevel", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, setModuleEnable, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const kind = e.shiftKey || e.clientY - rect.top > H * 0.82 ? "grain" : "xy";
      dragRef.current = kind;
      wrap.setPointerCapture(e.pointerId);
      applyFromPointer(e.clientX, e.clientY, kind);
    },
    [applyFromPointer, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyFromPointer(e.clientX, e.clientY, dragRef.current);
    },
    [applyFromPointer],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    setParam("noiseLevel", 0);
    setParam("noiseColor", 0);
    setParam("noiseDensity", 0.45);
    setParam("noiseGrain", 0.35);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintNoise(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.level ?? 0) > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.enabled,
          st.current.level,
          st.current.color,
          st.current.density,
          st.current.grain,
          gritSize(st.current.mode),
          STORM_IX[st.current.stormMode],
        ),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, silent ? 0.28 : 0.5),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexA(C, silent ? 0.08 : 0.22)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Color ↔ / Level ↕ · Shift or bottom: Density ↔ / Grain ↕ · Double-click: silence"
      role="img"
      aria-label="Noise bed grain storm"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexA(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexA(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.78) }}
      >
        Grain Storm
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] uppercase tabular-nums"
        style={{ color: hexA(C_HOT, 0.7) }}
      >
        {!enabled ? "ASLEEP" : silent ? "SILENT" : `${Math.round(level * 100)}%`}
      </div>
    </div>
  );
}
