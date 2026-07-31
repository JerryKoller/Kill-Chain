/**
 * LFO 2 — Twin Orbit stage visualizer.
 *
 * IDIOM: the interlocked pair. LFO 1 alone is a wave; LFO 2 is only interesting
 * as a *relationship*, so this panel draws the relationship rather than the
 * shape. LFO 1 runs ghosted behind, LFO 2 solid over it, and three devices make
 * the interlock literal across the 10:1 width:
 *
 *  · a vernier — LFO 1's cycle edges on the upper tick row, LFO 2's on the
 *    lower one, with a lock diamond wherever a pair coincides. 1:1 lines up
 *    every edge, 2:1 every other, a free ratio never settles.
 *  · a phase caliper measuring the gap between the first edge of each.
 *  · an interlock strip along the floor: |L2 − L1| across the window, which
 *    goes flat when the twins agree and beats when they are ratio-locked.
 *
 * Relation / phase offset / ratio / drift all move those three, so the panel
 * never reads as a copy of the LFO 1 stage.
 *
 * Drag: Rate ↔ / Depth ↕. Bottom rail: sync ratio vs LFO 1. Double-click: cycle wave.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { Lfo2DriftMode, Lfo2Relation, LfoDest, LfoWave } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  cachedGrad,
  drawGlow,
  footer,
  glowStroke,
  grain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  strata,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

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

const RELATIONS: Lfo2Relation[] = ["independent", "mirror", "invert", "phaseOffset", "ratio", "followLag"];
const DRIFTS: Lfo2DriftMode[] = ["locked", "elastic", "wandering"];
const DESTS: LfoDest[] = ["off", "pitch", "filter", "pan", "volume"];

const SH_STEPS = 8;

/** Sample budget for the twin traces — one scratch pass, no per-frame arrays. */
const SAMP_MAX = 1200;
const S1 = new Float64Array(SAMP_MAX + 1);
const S2 = new Float64Array(SAMP_MAX + 1);
/** LFO 1 cycle-edge positions for the vernier — scratch, never allocated per frame. */
const EDGES1 = new Float64Array(64);

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
      const step = Math.floor(ph * SH_STEPS);
      const h = Math.sin(step * 127.1) * 43758.5453;
      return (h - Math.floor(h)) * 2 - 1;
    }
    default:
      return 0;
  }
}

function isStepped(w: LfoWave): boolean {
  return w === "sawtooth" || w === "square" || w === "sample-hold";
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

/** Smallest whole-number ratio the twins are riding, for the vernier verdict. */
function lockLabel(ratio: number): string {
  for (let d = 1; d <= 8; d++) {
    const n = ratio * d;
    if (Math.abs(n - Math.round(n)) < 0.02 && Math.round(n) <= 8) {
      return d === 1 ? `${Math.round(n)}:1 LOCK` : `${Math.round(n)}:${d} LOCK`;
    }
  }
  return "FREE RUN";
}

type DragMode = "xy" | "link" | null;

export type Lfo2VizState = {
  wave: LfoWave;
  rate: number;
  depth: number;
  dest: LfoDest;
  wave1: LfoWave;
  rate1: number;
  depth1: number;
  relation: Lfo2Relation;
  phaseOffset: number;
  ratioParam: number;
  driftMode: Lfo2DriftMode;
};

/**
 * Paint the twin interlock. Exported and pure so it renders headlessly without
 * mounting the component.
 */
export function paintLfo2(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: Lfo2VizState,
  now: number,
  flash: number,
): void {
  const t = now / 1000;
  const depth = clamp(p.depth, 0, 1);
  const depth1 = clamp(p.depth1, 0, 1);
  const destOn = p.dest !== "off";
  const bound = p.relation !== "independent";

  // Drift wanders the offset and the ratio — deterministic so idle frames hold.
  const driftAmt =
    p.driftMode === "elastic"
      ? Math.sin(t * 0.62) * 0.08
      : p.driftMode === "wandering"
        ? Math.sin(t * 0.9) * 0.14 + Math.sin(t * 0.28) * 0.06
        : 0;

  const rate1Eff = Math.max(RATE_MIN, p.rate1);
  const patchRatio = clamp((p.ratioParam ?? 1) * (1 + driftAmt * 0.25), 0.125, 8);
  const phaseOff = (p.phaseOffset ?? 0) / 360 + driftAmt * 0.5;
  const ratioEff =
    p.relation === "ratio"
      ? patchRatio
      : p.relation === "independent"
        ? clamp(Math.max(RATE_MIN, p.rate) / rate1Eff, 0.02, 60)
        : 1;
  const rate2Eff = p.relation === "independent" ? Math.max(RATE_MIN, p.rate) : rate1Eff * ratioEff;
  const wave2 = bound ? p.wave1 : p.wave;
  const nearest = nearestSyncRatio(p.rate, p.rate1);
  const isLinked = bound || Math.abs(Math.log2(ratioEff / nearest)) < 0.12;

  const energy =
    0.16 + depth * 0.44 + (destOn ? 0.14 : 0) + (isLinked ? 0.1 : 0) + flash * 0.26;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.46 });
  strata(ctx, W, Hh, C_DEEP, { count: 5, horizon: 0.18, alpha: 0.08 });

  // ── geometry ──
  const xL = 62;
  const xR = Math.max(xL + 80, W - 92);
  const span = xR - xL;
  const vernA = 24;
  const vernB = 32;
  const laneTop = 42;
  const laneBot = Hh - 56;
  const mid = (laneTop + laneBot) * 0.5;
  const ampMax = (laneBot - laneTop) * 0.5 - 2;
  const amp2 = ampMax * (0.08 + depth * 0.92);
  const amp1 = ampMax * (0.1 + depth1 * 0.8) * 0.66;

  const rateN1 = logNorm(rate1Eff, RATE_MIN, RATE_MAX);
  const cycles1 = 0.6 + Math.pow(rateN1, 2.2) * 10;
  const cycles2 = clamp(cycles1 * ratioEff, 0.12, 40);
  const scroll1 = t * (0.25 + rateN1 * 1.4);
  const scroll2 = p.relation === "independent" ? scroll1 * ratioEff : scroll1 * ratioEff + phaseOff;

  // ── sample both twins once ──
  const n = Math.max(48, Math.min(SAMP_MAX, Math.ceil(span / 3)));
  const lagK = clamp((cycles1 * 10) / n, 0.02, 0.6);
  let follow = lfoShape(p.wave1, scroll1);
  let agree = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const v1 = lfoShape(p.wave1, u * cycles1 + scroll1);
    let v2: number;
    if (p.relation === "followLag") {
      follow += (v1 - follow) * lagK;
      v2 = follow;
    } else {
      v2 = lfoShape(wave2, u * cycles2 + scroll2);
      if (p.relation === "invert") v2 = -v2;
    }
    S1[i] = v1;
    S2[i] = v2;
    agree += Math.abs(v2 - v1);
  }
  const agreement = clamp(1 - agree / (n + 1) / 2, 0, 1);

  // Zero line + full-depth rails.
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = hexA(C_DEPTH, 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xL, mid - ampMax);
  ctx.lineTo(xR, mid - ampMax);
  ctx.moveTo(xL, mid + ampMax);
  ctx.lineTo(xR, mid + ampMax);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = hexA(C_MID, 0.24);
  ctx.fillRect(xL, mid, span, 1);

  // ── the gap between the twins, shaded ──
  const gapFill = cachedGrad(ctx, `l2gap|${mid}|${ampMax}`, (c) => {
    const g = c.createLinearGradient(0, mid - ampMax, 0, mid + ampMax);
    g.addColorStop(0, hexA(C_LINK, 0.26));
    g.addColorStop(0.5, hexA(C, 0.1));
    g.addColorStop(1, hexA(C1, 0.2));
    return g;
  });
  ctx.beginPath();
  ctx.moveTo(xL, mid - S1[0]! * amp1);
  for (let i = 1; i <= n; i++) ctx.lineTo(xL + (i / n) * span, mid - S1[i]! * amp1);
  for (let i = n; i >= 0; i--) ctx.lineTo(xL + (i / n) * span, mid - S2[i]! * amp2);
  ctx.closePath();
  ctx.save();
  ctx.globalAlpha = 0.45 + depth * 0.35;
  ctx.fillStyle = gapFill;
  ctx.fill();
  ctx.restore();

  // ── LFO 1, ghosted behind ──
  const step1 = isStepped(p.wave1);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hexA(C1, 0.3 + depth1 * 0.34);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(xL, mid - S1[0]! * amp1);
  for (let i = 1; i <= n; i++) {
    const x = xL + (i / n) * span;
    if (step1 && Math.abs(S1[i]! - S1[i - 1]!) > 0.3) ctx.lineTo(x, mid - S1[i - 1]! * amp1);
    ctx.lineTo(x, mid - S1[i]! * amp1);
  }
  ctx.stroke();
  ctx.restore();

  // ── LFO 2, solid over it ──
  const step2 = isStepped(wave2) && p.relation !== "followLag";
  const trace2 = () => {
    ctx.moveTo(xL, mid - S2[0]! * amp2);
    for (let i = 1; i <= n; i++) {
      const x = xL + (i / n) * span;
      if (step2 && Math.abs(S2[i]! - S2[i - 1]!) > 0.3) ctx.lineTo(x, mid - S2[i - 1]! * amp2);
      ctx.lineTo(x, mid - S2[i]! * amp2);
    }
  };
  lit(ctx, () => {
    glowStroke(ctx, trace2, C_GLOW, {
      width: 2.2,
      glow: 0.5 + depth * 0.8 + flash * 0.5,
      alpha: 0.82 + flash * 0.18,
    });
  });

  // Crossings — where the twins actually meet.
  lit(ctx, () => {
    let prev = S2[0]! - S1[0]!;
    for (let i = 1; i <= n; i++) {
      const d = S2[i]! - S1[i]!;
      if ((d <= 0 && prev > 0) || (d >= 0 && prev < 0)) {
        const x = xL + (i / n) * span;
        drawGlow(ctx, x, mid - S1[i]! * amp1, 7 + depth * 6, C_GLOW, 0.5);
      }
      prev = d;
    }
  });

  // ── vernier: cycle edges of each twin, lock diamonds where they coincide ──
  ctx.fillStyle = hexA(C1, 0.5);
  ctx.fillRect(xL, vernA + 3, span, 1);
  ctx.fillStyle = hexA(C_GLOW, 0.5);
  ctx.fillRect(xL, vernB + 3, span, 1);
  let nEdges1 = 0;
  ctx.fillStyle = hexA(C1, 0.62);
  for (let k = Math.ceil(scroll1); k <= Math.floor(cycles1 + scroll1); k++) {
    const u = (k - scroll1) / cycles1;
    if (nEdges1 < EDGES1.length) EDGES1[nEdges1++] = u;
    ctx.fillRect(xL + u * span, vernA, 1, 7);
  }
  const edgeCount2 = Math.floor(cycles2 + scroll2) - Math.ceil(scroll2);
  const tickStride = edgeCount2 > 90 ? Math.ceil(edgeCount2 / 90) : 1;
  let ki = 0;
  for (let k = Math.ceil(scroll2); k <= Math.floor(cycles2 + scroll2); k++, ki++) {
    if (ki % tickStride !== 0) continue;
    const u = (k - scroll2) / cycles2;
    const x = xL + u * span;
    ctx.fillStyle = hexA(C_GLOW, 0.7);
    ctx.fillRect(x, vernB, 1, 7);
    // Lock diamond when an LFO 1 edge lands within a hair of this one.
    let near = Infinity;
    for (let j = 0; j < nEdges1; j++) near = Math.min(near, Math.abs(EDGES1[j]! - u));
    if (near * span < 3) {
      ctx.fillStyle = hexA(C_LINK, 0.9);
      ctx.beginPath();
      ctx.moveTo(x, vernA + 1);
      ctx.lineTo(x + 3, vernA + 5);
      ctx.lineTo(x, vernB + 6);
      ctx.lineTo(x - 3, vernA + 5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C1, 0.7);
  ctx.fillText("L1", xL - 6, vernA + 7);
  ctx.fillStyle = hexA(C_GLOW, 0.85);
  ctx.fillText("L2", xL - 6, vernB + 8);

  // ── phase caliper between the leading edge of each twin ──
  if (bound && nEdges1 > 0) {
    const u1 = EDGES1[0]!;
    const first2 = Math.ceil(scroll2);
    const u2 = (first2 - scroll2) / cycles2;
    const x1 = xL + u1 * span;
    const x2 = xL + u2 * span;
    const cy = laneBot - 6;
    ctx.strokeStyle = hexA(C_LINK, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, cy - 4);
    ctx.lineTo(x1, cy + 4);
    ctx.moveTo(x2, cy - 4);
    ctx.lineTo(x2, cy + 4);
    ctx.moveTo(x1, cy);
    ctx.lineTo(x2, cy);
    ctx.stroke();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_LINK, 0.85);
    ctx.fillText(`φ${Math.round(((phaseOff % 1) + 1) % 1 * 360)}°`, (x1 + x2) * 0.5, cy - 6);
  }

  // ── interlock strip: |L2 − L1| along the floor ──
  const stripTop = laneBot + 10;
  const stripH = 16;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(xL, stripTop, span, stripH);
  const stripFill = cachedGrad(ctx, `l2strip|${stripTop}|${stripH}`, (c) => {
    const g = c.createLinearGradient(0, stripTop, 0, stripTop + stripH);
    g.addColorStop(0, hexA(C_HOT, 0.62));
    g.addColorStop(1, hexA(C_DEEP, 0.12));
    return g;
  });
  ctx.beginPath();
  ctx.moveTo(xL, stripTop + stripH);
  for (let i = 0; i <= n; i++) {
    const d = Math.abs(S2[i]! - S1[i]!) * 0.5;
    ctx.lineTo(xL + (i / n) * span, stripTop + stripH - d * stripH);
  }
  ctx.lineTo(xR, stripTop + stripH);
  ctx.closePath();
  ctx.fillStyle = stripFill;
  ctx.fill();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_HOT, 0.6);
  ctx.fillText("INTERLOCK", xL + 3, stripTop - 2);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_LINK, 0.8);
  ctx.fillText(`AGREE ${Math.round(agreement * 100)}%`, xR - 3, stripTop - 2);

  // ── right gutter: the verdict + destination ──
  const gx = W - 44;
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(isLinked ? C_GLOW : C_MID, isLinked ? 0.92 : 0.5);
  ctx.fillText(lockLabel(ratioEff), gx, mid - 14);
  ctx.font = VIZ_FONT_VALUE;
  ctx.fillStyle = hexA(C_RATE, 0.7);
  ctx.fillText(`${rate2Eff.toFixed(2)}Hz`, gx, mid);
  ctx.font = VIZ_FONT_LABEL;
  ctx.fillStyle = hexA(destOn ? C_DEST : C_MID, destOn ? 0.9 : 0.45);
  ctx.fillText(p.dest === "off" ? "NO DEST" : `→${p.dest.toUpperCase()}`, gx, mid + 14);
  if (destOn) {
    lit(ctx, () => drawGlow(ctx, gx, mid + 11, 16 + depth * 12, C_DEST, 0.3 + depth * 0.35));
  }

  // Relation / drift readout.
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
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_LINK, 0.85);
  ctx.fillText(`${relLabel}${driftTag}`, 12, laneTop - 4);
  ctx.fillStyle = hexA(C_DEPTH, 0.6);
  ctx.fillText(`D${Math.round(depth * 100)}`, 12, laneTop + 8);

  // Rate / depth crosshair — matches the drag mapping.
  const rateN = logNorm(p.rate, RATE_MIN, RATE_MAX);
  const hx = rateN * W;
  const hy = (1 - depth) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.26 + flash * 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, String(p.wave).toUpperCase().replace("SAMPLE-HOLD", "S&H"), C_GLOW, { glow: flash });

  // ── sync link rail ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railX, railY, railW, 7);
  ctx.strokeStyle = hexA(C_LINK, isLinked ? 0.45 : 0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(railX + 0.5, railY + 0.5, railW - 1, 6);
  const slotW = railW / SYNC_RATIOS.length;
  for (let i = 0; i < SYNC_RATIOS.length; i++) {
    const r = SYNC_RATIOS[i]!;
    const sx = railX + i * slotW;
    const on =
      (p.relation === "ratio" && Math.abs(Math.log2(patchRatio / r)) < 0.08) ||
      (p.relation !== "ratio" && Math.abs(r - nearest) < 0.01 && isLinked);
    if (on) {
      ctx.fillStyle = hexA(C_LINK, 0.45 + flash * 0.25);
      ctx.fillRect(sx + 1, railY + 1, slotW - 2, 5);
    }
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(on ? C_GLOW : C_MID, on ? 0.95 : 0.45);
    ctx.fillText(syncRatioLabel(r), sx + slotW * 0.5, railY - 4);
  }
  const thumbRatio = p.relation === "ratio" ? nearestSyncRatio(rate1Eff * patchRatio, rate1Eff) : nearest;
  const thumbI = SYNC_RATIOS.indexOf(thumbRatio);
  const tx = railX + ((thumbI >= 0 ? thumbI : 2) + 0.5) * slotW;
  lit(ctx, () => drawGlow(ctx, tx, railY + 3.5, 8 + flash * 4, C_GLOW, 0.85));
  ctx.fillStyle = hexA(C_GLOW, 0.95);
  ctx.beginPath();
  ctx.arc(tx, railY + 3.5, 2.6, 0, Math.PI * 2);
  ctx.fill();

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  const ratioRead =
    p.relation === "ratio"
      ? ` · ${patchRatio % 1 === 0 ? patchRatio.toFixed(0) : patchRatio.toFixed(2)}×L1`
      : isLinked
        ? ` · ${syncRatioLabel(nearest)}L1`
        : "";
  footer(
    ctx,
    W,
    Hh,
    "LFO2 · TWIN ORBIT",
    `${p.rate.toFixed(2)}Hz · D${Math.round(depth * 100)} · ${p.dest === "off" ? "IDLE" : `→${p.dest.toUpperCase()}`}${ratioRead}`,
    C_GLOW,
    destOn || depth > 0.02 ? C_DEST : C_MID,
  );
}

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

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<Lfo2VizState>({
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
    const key = motionHash(
      WAVE_CYCLE.indexOf(wave),
      rate,
      depth,
      DESTS.indexOf(dest),
      rate1,
      RELATIONS.indexOf(relation),
      phaseOffset,
      ratioParam,
      DRIFTS.indexOf(driftMode),
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1; // retrigger flash on param change
    }
  }, [wave, rate, depth, dest, rate1, relation, phaseOffset, ratioParam, driftMode]);

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
    [setParam, wrapRef],
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
    [setParam, wrapRef],
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
    [applyXy, applyLink, wrapRef],
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
  }, [wrapRef]);

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

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintLfo2(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          (st.current.depth ?? 0) > 0.02 ||
          st.current.dest !== "off" ||
          (st.current.relation ?? "independent") !== "independent",
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          WAVE_CYCLE.indexOf(st.current.wave),
          st.current.rate,
          st.current.depth,
          DESTS.indexOf(st.current.dest),
          WAVE_CYCLE.indexOf(st.current.wave1),
          st.current.rate1,
          st.current.depth1,
          RELATIONS.indexOf(st.current.relation),
          st.current.phaseOffset,
          st.current.ratioParam,
          DRIFTS.indexOf(st.current.driftMode),
        ),
      }),
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, live ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
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
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexA(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexA(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexA(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.78) }}
      >
        Twin Orbit
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{
          color: hexA(live ? C_HOT : C_MID, live ? 0.9 : 0.7),
          textShadow: live ? `0 0 10px ${hexA(C, 0.65)}` : undefined,
        }}
      >
        {live ? "ACTIVE" : "IDLE"}
      </div>
    </div>
  );
}
