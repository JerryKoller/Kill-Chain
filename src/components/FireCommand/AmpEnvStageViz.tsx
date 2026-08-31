/**
 * AMP — Breath Contour stage visualizer.
 *
 * IDIOM: the ADSR contour. Stages are a ~10:1 letterbox, so the envelope is
 * drawn the way a manual draws it — time left→right, level up, each stage
 * getting its own column of the width. The curve shapes are the real ones the
 * engine uses (`applyEnvCurve`), so a linear attack is a straight ramp, an
 * exponential decay dives then flattens, and a log one bulges the other way.
 * Hold holds the plateau, overshoot pokes a bump through the unity ceiling, and
 * velocity scaling is shown as a family of fainter contours underneath the live
 * one — you can see the whole dynamic range of the patch at a glance.
 *
 * Stage boundaries are thin verticals with the stage's own time printed above,
 * so the panel doubles as the numeric readout.
 *
 * When the LPG parks the amp envelope, the panel switches to the vactrol
 * contour that is actually driving amplitude, with the parked ADSR left behind
 * it as a ghost.
 *
 * A · D · S · R · Curves · Hold · Overshoot · Vel · LPG park (Tone · FC.envAmp).
 * Drag stage zones: A / D / S↕ / R. Bottom rail: Vel. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { applyEnvCurve, type AmpModel, type EnvCurve } from "@/audio/dsp/toneDifferentiation";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import { useToneTelemetryRef } from "./useToneTelemetry";
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
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 176;
const C = FC.envAmp;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.88);
const C_A = bandShade(FC.tone, 0.42);
const C_D = bandShade(FC.tone, 0.55);
const C_S = bandShade(FC.tone, 0.68);
const C_R = bandShade(FC.tone, 0.78);
const C_VEL = bandShade(FC.tone, 0.9);
const C_LPG = bandShade(FC.tone, 0.72);

const A_MIN = 0.001;
const A_MAX = 3;
const D_MIN = 0.005;
const D_MAX = 3;
const R_MIN = 0.005;
const R_MAX = 4;

/** Velocity contours drawn behind the live one — the patch's dynamic range. */
const VEL_FAMILY = [0.25, 0.5, 0.75, 1] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Numeric stand-in for an enum string, so `motionHash` sees curve switches. */
function strCode(s: string): number {
  return (s.length << 9) ^ (s.charCodeAt(0) | 0) ^ ((s.charCodeAt(1) | 0) << 4);
}

function fmtT(v: number) {
  return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
}

/**
 * Stage widths. Unchanged from the original so the A / D / S / R drag zones
 * land on exactly the columns they always did.
 */
function envSegments(a: number, d: number, s: number, r: number, usableW: number) {
  const seg = (v: number) => Math.pow(Math.max(0.001, v), 0.5);
  const tot = seg(a) + seg(d) + seg(r) + 0.35;
  const wA = (seg(a) / tot) * usableW;
  const wD = (seg(d) / tot) * usableW;
  const wR = (seg(r) / tot) * usableW;
  const wS = usableW - wA - wD - wR;
  return { wA, wD, wR, wS };
}

export type AmpEnvVizState = {
  a: number;
  d: number;
  sus: number;
  r: number;
  vel: number;
  parked: boolean;
  lpgDecay: number;
  lpgColor: number;
  atkCurve: EnvCurve;
  decCurve: EnvCurve;
  relCurve: EnvCurve;
  hold: number;
  overshoot: number;
  model: AmpModel;
  /** Live telemetry — passed in so the paint stays pure. */
  telStage: string;
  telPhase: number;
  telLevel: number;
  voices: number;
  lpgOn: boolean;
};

type Geo = {
  x0: number;
  x1: number;
  xH: number;
  x2: number;
  x3: number;
  x4: number;
  wA: number;
  wH: number;
  wD: number;
  wS: number;
  wR: number;
  floorY: number;
  peakY: number;
  plotH: number;
  top: number;
};

const PAD = 14;

function geometry(p: AmpEnvVizState, W: number, Hh: number): Geo {
  const usableW = Math.max(60, W - PAD * 2);
  const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.sus, p.r, usableW);
  // Hold eats the front of the decay column, so the drag boundaries never move.
  const hFrac = p.hold > 0.0005 ? clamp(Math.sqrt(p.hold) / (Math.sqrt(p.hold) + Math.sqrt(Math.max(0.001, p.d))), 0, 0.7) : 0;
  const wH = wD * hFrac;
  const x0 = PAD;
  const x1 = x0 + wA;
  const xH = x1 + wH;
  const x2 = x1 + wD;
  const x3 = x2 + wS;
  const x4 = x3 + wR;
  // Floor sits clear of the vel rail; the plot keeps 20px of headroom above
  // unity so an overshoot bump has somewhere to poke into.
  const floorY = Hh - 34;
  const plotH = 90;
  return { x0, x1, xH, x2, x3, x4, wA, wH, wD: wD - wH, wS, wR, floorY, peakY: floorY - plotH, plotH, top: 26 };
}

/** Peak level including the overshoot poke above unity. */
function peakOf(p: AmpEnvVizState) {
  return 1 + clamp(p.overshoot, 0, 1) * 0.18;
}

/** Walk the contour into the current path. One code path for every contour. */
function contourPath(ctx: CanvasRenderingContext2D, p: AmpEnvVizState, g: Geo, velScale: number): void {
  const yOf = (lv: number) => g.floorY - clamp(lv, 0, 1.2) * g.plotH;
  const peak = peakOf(p);
  ctx.moveTo(g.x0, yOf(0));
  const nA = 22;
  for (let i = 1; i <= nA; i++) {
    const u = i / nA;
    ctx.lineTo(g.x0 + g.wA * u, yOf(applyEnvCurve(u, p.atkCurve) * peak * velScale));
  }
  // Hold plateau — overshoot settles back toward unity across it.
  if (g.wH > 0.5) {
    const nH = 10;
    for (let i = 1; i <= nH; i++) {
      const u = i / nH;
      ctx.lineTo(g.x1 + g.wH * u, yOf((1 + (peak - 1) * Math.exp(-u * 4)) * velScale));
    }
  }
  const startLv = g.wH > 0.5 ? 1 + (peak - 1) * Math.exp(-4) : peak;
  const nD = 26;
  for (let i = 1; i <= nD; i++) {
    const u = i / nD;
    ctx.lineTo(g.xH + g.wD * u, yOf((startLv + (p.sus - startLv) * applyEnvCurve(u, p.decCurve)) * velScale));
  }
  ctx.lineTo(g.x3, yOf(p.sus * velScale));
  const nR = 24;
  for (let i = 1; i <= nR; i++) {
    const u = i / nR;
    ctx.lineTo(g.x3 + g.wR * u, yOf(p.sus * (1 - applyEnvCurve(u, p.relCurve)) * velScale));
  }
}

/** The vactrol contour that replaces the ADSR while the LPG is parked. */
function lpgPath(ctx: CanvasRenderingContext2D, p: AmpEnvVizState, g: Geo, W: number, tilt: number): void {
  const yOf = (lv: number) => g.floorY - clamp(lv, 0, 1.2) * g.plotH;
  const decayN = logNorm(p.lpgDecay, 0.05, 2.5);
  const span = Math.max(60, W - PAD * 2);
  const k = 1.2 + (1 - decayN) * 4.2;
  ctx.moveTo(PAD, yOf(0));
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // A near-instant strike, then the vactrol's exponential fall.
    const rise = Math.min(1, t / 0.012);
    const env = rise * Math.exp(-Math.max(0, t - 0.012) * k * tilt) * (0.55 + p.lpgColor * 0.45);
    ctx.lineTo(PAD + t * span, yOf(env));
  }
}

/**
 * Paint the amp contour. Exported and pure so any A/D/S/R + curve combination
 * can be rendered headlessly without mounting the component.
 */
export function paintAmpEnv(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: AmpEnvVizState,
  now: number,
  flash: number,
): void {
  const g = geometry(p, W, Hh);
  const yOf = (lv: number) => g.floorY - clamp(lv, 0, 1.2) * g.plotH;
  const velScale = 0.55 + clamp(p.vel, 0, 1) * 0.45;
  const fast = 1 - logNorm(p.a, A_MIN, A_MAX);
  const energy = p.parked
    ? 0.2 + p.lpgColor * 0.34 + flash * 0.24
    : 0.18 + p.sus * 0.24 + fast * 0.14 + flash * 0.24;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.72 });

  // ── level graticule: unity ceiling + quarter lines ──
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const lv = i / 4;
    const y = Math.round(yOf(lv)) + 0.5;
    ctx.strokeStyle = hexA(C_MID, i === 4 ? 0.26 : 0.08);
    ctx.setLineDash(i === 4 ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.fillText("1.0", PAD - 2, yOf(1) + 3);
  ctx.fillStyle = hexA(C_MID, 0.36);
  ctx.fillText("0", PAD - 2, yOf(0) + 3);

  if (p.parked) {
    // ── LPG park: the vactrol is driving amplitude, ADSR left as a ghost ──
    ctx.beginPath();
    contourPath(ctx, p, g, velScale);
    ctx.strokeStyle = hexA(C_MID, 0.22);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // The bright band dies sooner than the dark one — colour tilts the pair.
    ctx.beginPath();
    lpgPath(ctx, p, g, W, 0.72);
    ctx.lineTo(W - PAD, g.floorY);
    ctx.lineTo(PAD, g.floorY);
    ctx.closePath();
    const fill = cachedGrad(ctx, `lpgfill|${Hh}|${(p.lpgColor * 10) | 0}`, (c) => {
      const gr = c.createLinearGradient(0, g.peakY, 0, g.floorY);
      gr.addColorStop(0, hexA(C_LPG, 0.34));
      gr.addColorStop(1, hexA(C_DEEP, 0.03));
      return gr;
    });
    ctx.fillStyle = fill;
    ctx.fill();

    glowStroke(ctx, () => lpgPath(ctx, p, g, W, 1.35), C_HOT, { width: 1.3, glow: 0.5, alpha: 0.4 + p.lpgColor * 0.35 });
    glowStroke(ctx, () => lpgPath(ctx, p, g, W, 0.72), C_GLOW, { width: 2.2, glow: 0.9 + flash * 0.6, alpha: 0.9 });

    lit(ctx, () => drawGlow(ctx, PAD + 4, yOf(0.55 + p.lpgColor * 0.45), 16 + flash * 14, C_GLOW, 0.45 + flash * 0.3));

    ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.7);
    ctx.fillText("LPG PARKED · drag Decay↔ / Color↕", W * 0.5, g.top + 16);

    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_LPG, 0.66);
    ctx.fillText(`DECAY ${Math.round(p.lpgDecay * 1000)}ms`, 136, 16);
    ctx.fillStyle = hexA(C_HOT, 0.62);
    ctx.fillText(`COLOR ${Math.round(p.lpgColor * 100)}`, 260, 16);
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.fillText("ADSR BYPASSED", 368, 16);
  } else {
    // ── stage columns ──
    const cols: Array<{ a: number; b: number; col: string; alpha: number; label: string; time: string }> = [
      { a: g.x0, b: g.x1, col: C_A, alpha: 0.09, label: "ATK", time: fmtT(p.a) },
      { a: g.x1, b: g.xH, col: C_D, alpha: 0.12, label: "HOLD", time: fmtT(p.hold) },
      { a: g.xH, b: g.x2, col: C_D, alpha: 0.07, label: "DEC", time: fmtT(p.d) },
      { a: g.x2, b: g.x3, col: C_S, alpha: 0.1 + p.sus * 0.08, label: "SUS", time: `${Math.round(p.sus * 100)}%` },
      { a: g.x3, b: g.x4, col: C_R, alpha: 0.07, label: "REL", time: fmtT(p.r) },
    ];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]!;
      if (c.b - c.a < 0.5) continue;
      ctx.fillStyle = hexA(c.col, c.alpha);
      ctx.fillRect(c.a, g.top, c.b - c.a, g.floorY - g.top);
    }
    // Boundary verticals — thin, with the stage time printed above them.
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexA(C_MID, 0.3);
    for (const x of [g.x1, g.xH, g.x2, g.x3, g.x4]) {
      if (x <= g.x0 + 0.5 || x >= W - PAD) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, g.top);
      ctx.lineTo(Math.round(x) + 0.5, g.floorY);
      ctx.stroke();
    }
    ctx.restore();

    // ── the velocity family, dimmest first ──
    for (let i = 0; i < VEL_FAMILY.length; i++) {
      const v = VEL_FAMILY[i]!;
      if (Math.abs(v - p.vel) < 0.06) continue;
      ctx.beginPath();
      contourPath(ctx, p, g, 0.55 + v * 0.45);
      ctx.strokeStyle = hexA(C_MID, 0.1 + i * 0.035);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── the live contour ──
    ctx.beginPath();
    contourPath(ctx, p, g, velScale);
    ctx.lineTo(g.x4, g.floorY);
    ctx.lineTo(g.x0, g.floorY);
    ctx.closePath();
    const fill = cachedGrad(ctx, `ampfill|${Hh}|${(p.sus * 10) | 0}|${(p.vel * 10) | 0}`, (c) => {
      const gr = c.createLinearGradient(0, g.peakY, 0, g.floorY);
      gr.addColorStop(0, hexA(C_GLOW, 0.3));
      gr.addColorStop(0.5, hexA(C_HOT, 0.13));
      gr.addColorStop(1, hexA(C_DEEP, 0.03));
      return gr;
    });
    ctx.fillStyle = fill;
    ctx.fill();

    glowStroke(ctx, () => contourPath(ctx, p, g, velScale), C_GLOW, {
      width: 2.3,
      glow: 0.8 + energy * 0.7 + flash * 0.6,
      alpha: 0.88,
    });

    // Overshoot flag — only when it actually pokes through unity.
    if (p.overshoot > 0.02) {
      const oy = yOf(peakOf(p) * velScale);
      lit(ctx, () => drawGlow(ctx, g.x1, oy, 10 + p.overshoot * 14, C_GLOW, 0.3 + p.overshoot * 0.4));
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(C_GLOW, 0.7);
      ctx.fillText(`+${Math.round(p.overshoot * 18)}%`, g.x1 + 4, oy - 4);
    }

    // Stage handles at the corners the drag zones move.
    const handles: Array<{ x: number; y: number; col: string }> = [
      { x: g.x1, y: yOf(peakOf(p) * velScale), col: C_A },
      { x: g.x2, y: yOf(p.sus * velScale), col: C_D },
      { x: (g.x2 + g.x3) * 0.5, y: yOf(p.sus * velScale), col: C_S },
      { x: g.x4, y: yOf(0), col: C_R },
    ];
    lit(ctx, () => {
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i]!;
        drawGlow(ctx, h.x, h.y, 7 + flash * 4, h.col, 0.55);
      }
    });
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i]!;
      ctx.fillStyle = hexA(h.col, 0.92);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3.4 + flash * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stage name · curve · time, one row riding just inside the floor line so
    // the strip below stays clear for the vel rail.
    const curves: string[] = [p.atkCurve, "", p.decCurve, "", p.relCurve];
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]!;
      if (c.b - c.a < 26) continue;
      const curve = curves[i] ?? "";
      const text = curve ? `${c.label} ${curve.toUpperCase()} ${c.time}` : `${c.label} ${c.time}`;
      ctx.fillStyle = hexA(c.col, 0.58);
      ctx.fillText(text, (c.a + c.b) * 0.5, g.floorY - 5);
    }

    // ── live playhead ──
    if (p.voices > 0) {
      const ph = clamp(p.telPhase, 0, 1);
      const stage = p.telStage;
      let cx = g.x0;
      if (stage === "attack") cx = g.x0 + ph * g.wA;
      else if (stage === "decay") cx = g.x1 + ph * (g.wH + g.wD);
      else if (stage === "sustain") cx = g.x2 + ph * g.wS;
      else if (stage === "release" || stage === "decay_out") cx = g.x3 + ph * g.wR;
      else if (stage === "strike") cx = g.x0 + ph * (g.wA + g.wH + g.wD) * 0.35;
      else if (stage === "ring") cx = g.x1 + ph * (g.wD + g.wS) * 0.5;
      else cx = g.x0 + ph * (g.x4 - g.x0);
      const cy = yOf(clamp(p.telLevel, 0, 1) * velScale);
      ctx.strokeStyle = hexA(C_GLOW, 0.6);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(cx, g.top);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      lit(ctx, () => drawGlow(ctx, cx, cy, 14 + flash * 8, C_GLOW, 0.8));
      ctx.fillStyle = hexA(C_GLOW, 0.98);
      ctx.beginPath();
      ctx.arc(cx, cy, 3.6 + flash * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_GLOW, 0.9);
      ctx.fillText(stage.slice(0, 6).toUpperCase(), cx, cy - 10);
    }

    // Telemetry row — clear of the DOM eyebrow / readout.
    if (W >= 460) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(C_A, 0.68);
      ctx.fillText(`ATK ${p.atkCurve.toUpperCase()}`, 136, 16);
      ctx.fillStyle = hexA(C_D, 0.64);
      ctx.fillText(`HOLD ${fmtT(p.hold)}`, 236, 16);
      ctx.fillStyle = hexA(C_GLOW, 0.62);
      ctx.fillText(`OVER ${Math.round(p.overshoot * 100)}`, 340, 16);
      ctx.fillStyle = hexA(C_VEL, 0.62);
      ctx.fillText(`VEL ${Math.round(p.vel * 100)}`, 434, 16);
    }
  }

  pill(ctx, W * 0.5, 3, p.parked ? "LPG PARK" : p.model === "gate" ? "GATE" : "ADSR", C_GLOW, { glow: flash });

  // ── vel rail along the bottom, clear of the footer band ──
  const railY = Hh - 25;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  if (p.vel > 0.01) {
    const vg = cachedGrad(ctx, `velrail|${W}`, (c) => {
      const gr = c.createLinearGradient(12, 0, 12 + railW, 0);
      gr.addColorStop(0, hexA(C_HOT, 0.4));
      gr.addColorStop(1, hexA(C_VEL, 0.92));
      return gr;
    });
    ctx.fillStyle = vg;
    ctx.fillRect(12, railY + 1, Math.max(2, railW * p.vel), 4);
  }
  lit(ctx, () => drawGlow(ctx, 12 + railW * p.vel, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_VEL, 0.7);
  ctx.fillText("VEL", 14, railY - 3);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "AMP · BREATH CONTOUR",
    p.parked
      ? `LPG · ${Math.round(p.lpgDecay * 1000)}ms · C${Math.round(p.lpgColor * 100)}`
      : `A${fmtT(p.a)} · D${fmtT(p.d)} · S${Math.round(p.sus * 100)} · R${fmtT(p.r)}`,
    C_GLOW,
    C_HOT,
  );
}

type DragMode = "A" | "D" | "S" | "R" | "vel" | "lpg" | null;

export function AmpEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.ampAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.ampDecay) ?? 0.25;
  const sus = useFireCommandStore((s) => s.patch.ampSustain) ?? 0.8;
  const r = useFireCommandStore((s) => s.patch.ampRelease) ?? 0.35;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const pluckOn = useFireCommandStore((s) => s.patch.moduleEnable?.["pluck"] !== false);
  const lpgDecay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const lpgColor = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const atkCurve = useFireCommandStore((s) => s.patch.ampCurveAttack) ?? "lin";
  const decCurve = useFireCommandStore((s) => s.patch.ampCurveDecay) ?? "exp";
  const relCurve = useFireCommandStore((s) => s.patch.ampCurveRelease) ?? "exp";
  const hold = useFireCommandStore((s) => s.patch.ampHold) ?? 0;
  const overshoot = useFireCommandStore((s) => s.patch.ampOvershoot) ?? 0;
  const model = useFireCommandStore((s) => s.patch.ampModel) ?? "vca";
  const setParam = useFireCommandStore((s) => s.setParam);

  // Telemetry through a ref — the paint loop refreshes st.current from it in
  // hints(), so playing notes no longer re-renders this component at 30 fps.
  const telRef = useToneTelemetryRef();
  const parked = lpgOn && pluckOn;
  const telSrc = lpgOn ? telRef.current.pluck : telRef.current.amp;

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<AmpEnvVizState>({
    a, d, sus, r, vel, parked, lpgDecay, lpgColor,
    atkCurve, decCurve, relCurve, hold, overshoot, model,
    telStage: telSrc.stage, telPhase: telSrc.phase, telLevel: telSrc.level, voices: telRef.current.voiceCount, lpgOn,
  });
  st.current = {
    a, d, sus, r, vel, parked, lpgDecay, lpgColor,
    atkCurve, decCurve, relCurve, hold, overshoot, model,
    telStage: telSrc.stage, telPhase: telSrc.phase, telLevel: telSrc.level, voices: telRef.current.voiceCount, lpgOn,
  };

  useEffect(() => {
    const key = parked
      ? motionHash(1, lpgDecay, lpgColor, vel)
      : motionHash(a, d, sus, r, vel, hold, overshoot, strCode(atkCurve), strCode(decCurve), strCode(relCurve));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [a, d, sus, r, vel, parked, lpgDecay, lpgColor, hold, overshoot, atkCurve, decCurve, relCurve]);

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "vel") {
        setParam("velAmount", Math.round(x * 1000) / 1000);
        return;
      }
      if (mode === "lpg") {
        setParam("lpgDecay", Math.round(logLerp(x, 0.05, 2.5) * 1000) / 1000);
        setParam("lpgColor", Math.round((1 - clamp(y / 0.78, 0, 1)) * 1000) / 1000);
        return;
      }
      const level = 1 - clamp(y / 0.78, 0, 1);
      if (mode === "S") {
        setParam("ampSustain", Math.round(level * 1000) / 1000);
        return;
      }
      if (mode === "A") setParam("ampAttack", Math.round(logLerp(x, A_MIN, A_MAX) * 1000) / 1000);
      else if (mode === "D") setParam("ampDecay", Math.round(logLerp(x, D_MIN, D_MAX) * 1000) / 1000);
      else if (mode === "R") setParam("ampRelease", Math.round(logLerp(x, R_MIN, R_MAX) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const hitZone = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    if (ly > H * 0.78) return "vel";
    if (st.current.parked) return "lpg";
    // Same stage columns the paint lays out — one source of truth for both.
    const z = geometry(st.current, sizeRef.current.w, sizeRef.current.h);
    if (lx < z.x1) return "A";
    if (lx < z.x2) return "D";
    if (lx < z.x3) return "S";
    return "R";
  }, [sizeRef, wrapRef]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const mode = hitZone(e.clientX, e.clientY);
      dragRef.current = mode;
      wrap.setPointerCapture(e.pointerId);
      applyDrag(e.clientX, e.clientY, mode);
    },
    [hitZone, applyDrag, wrapRef],
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
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    if (st.current.parked) {
      setParam("lpgDecay", 0.4);
      setParam("lpgColor", 0.7);
      setParam("velAmount", 1);
      return;
    }
    setParam("ampAttack", 0.01);
    setParam("ampDecay", 0.25);
    setParam("ampSustain", 0.8);
    setParam("ampRelease", 0.35);
    setParam("velAmount", 1);
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
        paintAmpEnv(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        // Pull fresh telemetry straight from the bus ref each pump frame.
        const tv = telRef.current;
        const src = st.current.lpgOn ? tv.pluck : tv.amp;
        st.current.telStage = src.stage;
        st.current.telPhase = src.phase;
        st.current.telLevel = src.level;
        st.current.voices = tv.voiceCount;
        return {
          flash: flashRef.current,
          active: st.current.voices > 0,
          dragging: !!dragRef.current,
          visible: visibleRef.current,
          motionKey: motionHash(
            st.current.a,
            st.current.d,
            st.current.sus,
            st.current.r,
            st.current.vel,
            st.current.hold,
            st.current.overshoot,
            st.current.parked,
            st.current.lpgDecay,
            st.current.lpgColor,
            st.current.telLevel,
            st.current.voices,
          ),
        };
      },
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef, telRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, parked ? 0.45 : 0.5),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, parked ? 0.18 : 0.24)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title={
        parked
          ? "LPG parked — drag Decay↔ / Color↕ · Bottom: Vel · Double-click: LPG defaults"
          : "Drag A/D/S/R zones · Bottom: Vel · Double-click: ADSR defaults"
      }
      role="img"
      aria-label="Amp envelope breath contour"
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
        Breath Contour
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        {parked ? "LPG" : "ADSR"}
      </div>
    </div>
  );
}
