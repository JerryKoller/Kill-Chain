/**
 * FENV — Cutoff Sweep stage visualizer.
 *
 * IDIOM: the cutoff trajectory. Same envelope the amp panel draws, but plotted
 * as *where the filter is* rather than how loud the voice is — the Y axis is
 * frequency in log Hz, so the trace is the path cutoff actually takes through
 * the spectrum. That makes the two envelope panels impossible to confuse: this
 * one has a Hz ruler down the left, a base-cutoff line the sweep departs from,
 * and a bracket marking how many octaves the env amount is worth.
 *
 * A second, thinner trace rides its own Q scale on the right gutter — the
 * resonance follow, so you can see the peak sharpening as the sweep climbs.
 * The response thumbnail shows the filter shape at the playhead's cutoff.
 *
 * A · D · S · R · Curves · EnvAmt · ResoFollow · Cutoff · Q (Tone · FC.envFilt).
 * Drag A/D/S↕/R zones. Bottom rail: Env Amt (bipolar). Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FireFilterType } from "@/audio/dsp/FireCommandSynth";
import { applyEnvCurve, type EnvCurve } from "@/audio/dsp/toneDifferentiation";
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
const C = FC.envFilt;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.9);
const C_A = bandShade(FC.tone, 0.42);
const C_D = bandShade(FC.tone, 0.55);
const C_S = bandShade(FC.tone, 0.68);
const C_R = bandShade(FC.tone, 0.78);
const C_AMT = bandShade(FC.tone, 0.85);
const C_FILT = FC.filter;

const A_MIN = 0.001;
const A_MAX = 3;
const D_MIN = 0.005;
const D_MAX = 3;
const R_MIN = 0.005;
const R_MAX = 4;
const F_LO = 20;
const F_HI = 20000;
const CUT_LO = 40;
const CUT_HI = 18000;
const Q_LO = 0.1;
const Q_HI = 28;

const F_TICKS = [50, 200, 1000, 5000, 20000] as const;
const Q_TICKS = [0.5, 2, 8, 28] as const;

const PAD_L = 42;
const PAD_R = 40;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Numeric stand-in for an enum string, so `motionHash` sees mode switches. */
function strCode(s: string): number {
  return (s.length << 9) ^ (s.charCodeAt(0) | 0) ^ ((s.charCodeAt(1) | 0) << 4);
}

function fmtT(v: number) {
  return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
}

function fmtHz(f: number) {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)}k` : `${Math.round(f)}`;
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

/** Magnitude of the filter at `f`, for the response thumbnail. */
function filterGain(type: FireFilterType, f: number, cutoff: number, res: number): number {
  const r = f / Math.max(30, cutoff);
  const peak = Math.min(1, Math.log10(Math.max(1, res)) * 0.78);
  const bump = peak * Math.exp(-Math.pow(Math.log2(Math.max(1e-6, r)), 2) * 9);
  let g: number;
  if (type === "lowpass") g = 1 / Math.sqrt(1 + Math.pow(r, 4));
  else if (type === "highpass") g = 1 / Math.sqrt(1 + Math.pow(1 / Math.max(1e-6, r), 4));
  else if (type === "bandpass") g = Math.exp(-Math.pow(Math.log2(Math.max(1e-6, r)), 2) * 1.4);
  else g = 1 - Math.exp(-Math.pow(Math.log2(Math.max(1e-6, r)), 2) * 9);
  return Math.min(1.65, g + (type === "notch" ? 0 : bump));
}

export type FiltEnvVizState = {
  a: number;
  d: number;
  sus: number;
  r: number;
  envAmt: number;
  resoAmt: number;
  cutoff: number;
  reso: number;
  type: FireFilterType;
  atkCurve: EnvCurve;
  decCurve: EnvCurve;
  relCurve: EnvCurve;
  /** Live telemetry — passed in so the paint stays pure. */
  telStage: string;
  telPhase: number;
  telLevel: number;
  voices: number;
};

type Geo = {
  x0: number;
  x1: number;
  x2: number;
  x3: number;
  x4: number;
  wA: number;
  wD: number;
  wS: number;
  wR: number;
  top: number;
  floorY: number;
  plotH: number;
};

function geometry(p: FiltEnvVizState, W: number, Hh: number): Geo {
  const usableW = Math.max(60, W - PAD_L - PAD_R);
  const { wA, wD, wR, wS } = envSegments(p.a, p.d, p.sus, p.r, usableW);
  const x0 = PAD_L;
  const x1 = x0 + wA;
  const x2 = x1 + wD;
  const x3 = x2 + wS;
  const x4 = x3 + wR;
  // Floor sits clear of the env-amount rail below it.
  const floorY = Hh - 34;
  const top = 30;
  return { x0, x1, x2, x3, x4, wA, wD, wS, wR, top, floorY, plotH: floorY - top };
}

/** Envelope level 0..1 at a point in the stage layout. */
function envLevelAt(p: FiltEnvVizState, g: Geo, x: number): number {
  if (x <= g.x1) return applyEnvCurve(g.wA > 0.5 ? (x - g.x0) / g.wA : 1, p.atkCurve);
  if (x <= g.x2) {
    const u = g.wD > 0.5 ? (x - g.x1) / g.wD : 1;
    return 1 + (p.sus - 1) * applyEnvCurve(u, p.decCurve);
  }
  if (x <= g.x3) return p.sus;
  const u = g.wR > 0.5 ? (x - g.x3) / g.wR : 1;
  return p.sus * (1 - applyEnvCurve(u, p.relCurve));
}

/**
 * Paint the cutoff sweep. Exported and pure so any envelope + amount pairing
 * can be rendered headlessly without mounting the component.
 */
export function paintFiltEnv(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: FiltEnvVizState,
  now: number,
  flash: number,
): void {
  const g = geometry(p, W, Hh);
  const amt = Math.abs(clamp(p.envAmt, -1, 1));
  const resoAmt = clamp(p.resoAmt, -1, 1);
  const base = clamp(p.cutoff, CUT_LO, CUT_HI);
  const energy = 0.18 + p.sus * 0.18 + amt * 0.38 + flash * 0.24;

  const yF = (f: number) => g.floorY - logNorm(f, F_LO, F_HI) * g.plotH;
  const yQ = (q: number) => g.floorY - logNorm(q, Q_LO, Q_HI) * g.plotH;
  const cutAt = (lv: number) => clamp(base * Math.pow(2, p.envAmt * lv * 3.5), CUT_LO, CUT_HI);
  const qAt = (lv: number) => clamp(p.reso * (1 + resoAmt * lv * 3), Q_LO, Q_HI);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.72 });

  // ── stage columns ──
  const cols: Array<{ a: number; b: number; col: string; alpha: number; label: string; time: string }> = [
    { a: g.x0, b: g.x1, col: C_A, alpha: 0.09, label: "ATK", time: fmtT(p.a) },
    { a: g.x1, b: g.x2, col: C_D, alpha: 0.07, label: "DEC", time: fmtT(p.d) },
    { a: g.x2, b: g.x3, col: C_S, alpha: 0.09 + p.sus * 0.08, label: "SUS", time: `${Math.round(p.sus * 100)}%` },
    { a: g.x3, b: g.x4, col: C_R, alpha: 0.07, label: "REL", time: fmtT(p.r) },
  ];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]!;
    if (c.b - c.a < 0.5) continue;
    ctx.fillStyle = hexA(c.col, c.alpha);
    ctx.fillRect(c.a, g.top, c.b - c.a, g.plotH);
  }

  // ── the two rulers: Hz down the left, Q up the right ──
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < F_TICKS.length; i++) {
    const f = F_TICKS[i]!;
    const y = Math.round(yF(f)) + 0.5;
    ctx.strokeStyle = hexA(C_MID, f === 1000 ? 0.2 : 0.08);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(W - PAD_R, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  for (let i = 0; i < F_TICKS.length; i++) {
    const f = F_TICKS[i]!;
    ctx.fillStyle = hexA(C_MID, f === 1000 ? 0.62 : 0.44);
    ctx.fillText(fmtHz(f), PAD_L - 4, yF(f) + 3);
  }
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.fillText("Hz", PAD_L - 4, g.top - 4);
  if (Math.abs(resoAmt) > 0.02) {
    ctx.textAlign = "left";
    for (let i = 0; i < Q_TICKS.length; i++) {
      const q = Q_TICKS[i]!;
      ctx.fillStyle = hexA(C_FILT, 0.4);
      ctx.fillText(`${q}`, W - PAD_R + 4, yQ(q) + 3);
    }
    ctx.fillStyle = hexA(C_FILT, 0.55);
    ctx.fillText("Q", W - PAD_R + 4, g.top - 4);
  }

  // ── base cutoff: the line the sweep departs from ──
  const baseY = yF(base);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = hexA(C_FILT, 0.42);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(PAD_L, baseY);
  ctx.lineTo(W - PAD_R, baseY);
  ctx.stroke();
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_FILT, 0.62);
  ctx.fillText(`BASE ${fmtHz(base)}`, PAD_L + 4, baseY - 4);

  // ── the cutoff trajectory ──
  const N = 200;
  const sweep = () => {
    for (let i = 0; i <= N; i++) {
      const x = g.x0 + ((g.x4 - g.x0) * i) / N;
      const y = yF(cutAt(envLevelAt(p, g, x)));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  ctx.beginPath();
  sweep();
  ctx.lineTo(g.x4, baseY);
  ctx.lineTo(g.x0, baseY);
  ctx.closePath();
  const fill = cachedGrad(ctx, `fenvfill|${Hh}|${(amt * 12) | 0}|${p.envAmt >= 0 ? 1 : 0}`, (c) => {
    const gr = c.createLinearGradient(0, g.top, 0, g.floorY);
    gr.addColorStop(0, hexA(C_GLOW, 0.24 + amt * 0.16));
    gr.addColorStop(0.5, hexA(C_FILT, 0.12));
    gr.addColorStop(1, hexA(C_DEEP, 0.03));
    return gr;
  });
  ctx.fillStyle = fill;
  ctx.fill();
  glowStroke(ctx, sweep, C_GLOW, { width: 2.3, glow: 0.8 + amt * 0.8 + flash * 0.6, alpha: 0.9 });

  // ── resonance follow: a thinner trace on its own scale ──
  if (Math.abs(resoAmt) > 0.02) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = g.x0 + ((g.x4 - g.x0) * i) / 80;
      const y = yQ(qAt(envLevelAt(p, g, x)));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hexA(C_FILT, 0.45 + Math.abs(resoAmt) * 0.4);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_FILT, 0.62);
    ctx.fillText("RESO FOLLOW", W - PAD_R - 4, yQ(qAt(1)) - 4);
  }

  // ── sweep-range bracket at the envelope's peak column ──
  if (amt > 0.03) {
    const bx = Math.min(g.x1 + 14, W - PAD_R - 8);
    const topY = yF(cutAt(1));
    const dir = topY < baseY ? -1 : 1;
    ctx.strokeStyle = hexA(C_AMT, 0.6);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(bx, baseY);
    ctx.lineTo(bx, topY);
    ctx.stroke();
    ctx.fillStyle = hexA(C_AMT, 0.85);
    ctx.beginPath();
    ctx.moveTo(bx, topY);
    ctx.lineTo(bx - 4, topY - dir * 7);
    ctx.lineTo(bx + 4, topY - dir * 7);
    ctx.closePath();
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_AMT, 0.8);
    ctx.fillText(
      `${p.envAmt > 0 ? "+" : "−"}${(amt * 3.5).toFixed(1)} OCT → ${fmtHz(cutAt(1))}`,
      bx + 6,
      topY + (dir < 0 ? -6 : 14),
    );
  }

  // ── playhead ──
  const liveLv = p.voices > 0 ? clamp(p.telLevel, 0, 1) : p.sus;
  let sx = g.x2 + g.wS * 0.5;
  if (p.voices > 0) {
    const ph = clamp(p.telPhase, 0, 1);
    const stage = p.telStage;
    if (stage === "attack") sx = g.x0 + ph * g.wA;
    else if (stage === "decay") sx = g.x1 + ph * g.wD;
    else if (stage === "sustain") sx = g.x2 + ph * g.wS;
    else if (stage === "release" || stage === "decay_out") sx = g.x3 + ph * g.wR;
    else sx = g.x0 + ph * (g.x4 - g.x0);
  }
  const liveCut = cutAt(liveLv);
  const sy = yF(liveCut);
  ctx.strokeStyle = hexA(C_GLOW, p.voices > 0 ? 0.7 : 0.3);
  ctx.lineWidth = p.voices > 0 ? 1.8 : 1.2;
  ctx.setLineDash(p.voices > 0 ? [] : [2, 2]);
  ctx.beginPath();
  ctx.moveTo(sx, g.top);
  ctx.lineTo(sx, g.floorY);
  ctx.stroke();
  ctx.setLineDash([]);
  lit(ctx, () => drawGlow(ctx, sx, sy, (p.voices > 0 ? 16 : 10) + flash * 8, C_GLOW, p.voices > 0 ? 0.85 : 0.45));
  ctx.fillStyle = hexA(C_GLOW, 0.98);
  ctx.beginPath();
  ctx.arc(sx, sy, (p.voices > 0 ? 4 : 3) + flash * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_GLOW, 0.9);
  ctx.fillText(`${fmtHz(liveCut)}Hz`, sx, sy - 9);
  if (p.voices > 0 && p.telStage !== "idle") {
    ctx.fillStyle = hexA(C_HOT, 0.8);
    ctx.fillText(p.telStage.slice(0, 6).toUpperCase(), sx, g.top - 4);
  }

  // ── response thumbnail at the playhead's cutoff ──
  const thumbW = Math.min(96, Math.max(48, (W - PAD_L - PAD_R) * 0.06));
  const thumbH = 34;
  const thumbX = W - PAD_R - thumbW - 2;
  const thumbY = g.top + 4;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
  ctx.strokeStyle = hexA(C_FILT, 0.38 + amt * 0.3);
  ctx.lineWidth = 1;
  ctx.strokeRect(thumbX + 0.5, thumbY + 0.5, thumbW - 1, thumbH - 1);
  ctx.beginPath();
  for (let i = 0; i <= 32; i++) {
    const f = F_LO * Math.pow(F_HI / F_LO, i / 32);
    const gain = filterGain(p.type, f, liveCut, qAt(liveLv));
    const tx = thumbX + (i / 32) * thumbW;
    const ty = thumbY + (1 - Math.min(1, gain / 1.65)) * thumbH;
    if (i === 0) ctx.moveTo(tx, ty);
    else ctx.lineTo(tx, ty);
  }
  ctx.strokeStyle = hexA(C_GLOW, 0.78);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_FILT, 0.7);
  ctx.fillText(p.type.slice(0, 2).toUpperCase(), thumbX + thumbW * 0.5, thumbY + thumbH + 9);

  // Stage name · curve · time, one row riding just inside the floor line so
  // the strip below stays clear for the env-amount rail.
  const curves: string[] = [p.atkCurve, p.decCurve, "", p.relCurve];
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]!;
    if (c.b - c.a < 26) continue;
    const curve = curves[i] ?? "";
    const text = curve ? `${c.label} ${curve.toUpperCase()} ${c.time}` : `${c.label} ${c.time}`;
    ctx.fillStyle = hexA(c.col, 0.56);
    ctx.fillText(text, (c.a + c.b) * 0.5, g.floorY - 5);
  }

  // Telemetry row — clear of the DOM eyebrow / readout.
  if (W >= 460) {
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_AMT, 0.7);
    ctx.fillText(`ENV ${p.envAmt > 0 ? "+" : ""}${Math.round(p.envAmt * 100)}`, 136, 16);
    ctx.fillStyle = hexA(C_FILT, 0.64);
    ctx.fillText(`Q FOLLOW ${resoAmt > 0 ? "+" : ""}${Math.round(resoAmt * 100)}`, 224, 16);
    ctx.fillStyle = hexA(C_HOT, 0.62);
    ctx.fillText(`Q ${p.reso.toFixed(1)}`, 348, 16);
    ctx.fillStyle = hexA(C_MID, 0.58);
    ctx.fillText(`SWEEP ${fmtHz(cutAt(0))}→${fmtHz(cutAt(1))}`, 408, 16);
  }

  pill(
    ctx,
    W * 0.5,
    3,
    amt < 0.04 ? "FLAT" : p.envAmt > 0 ? "SWEEP UP" : "SWEEP DOWN",
    C_GLOW,
    { glow: flash },
  );

  // ── bipolar env-amount rail, clear of the footer band ──
  const railY = Hh - 25;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  const midX = 12 + railW * 0.5;
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(midX - 0.5, railY, 1, 6);
  const signedX = midX + p.envAmt * railW * 0.5;
  if (amt > 0.02) {
    const left = Math.min(midX, signedX);
    const right = Math.max(midX, signedX);
    const rg = cachedGrad(ctx, `fenvrail|${W}`, (c) => {
      const gr = c.createLinearGradient(12, 0, 12 + railW, 0);
      gr.addColorStop(0, hexA(C_FILT, 0.34));
      gr.addColorStop(1, hexA(C_GLOW, 0.82));
      return gr;
    });
    ctx.fillStyle = rg;
    ctx.fillRect(left, railY + 1, Math.max(1, right - left), 4);
  }
  lit(ctx, () => drawGlow(ctx, signedX, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_AMT, 0.72);
  ctx.fillText("ENV AMT", 14, railY - 3);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "FENV · CUTOFF SWEEP",
    `A${fmtT(p.a)} · S${Math.round(p.sus * 100)} · E${p.envAmt > 0 ? "+" : ""}${Math.round(p.envAmt * 100)}`,
    C_GLOW,
    C_HOT,
  );
}

type DragMode = "A" | "D" | "S" | "R" | "amt" | null;

export function FiltEnvStageViz() {
  const a = useFireCommandStore((s) => s.patch.filtAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.filtDecay) ?? 0.3;
  const sus = useFireCommandStore((s) => s.patch.filtSustain) ?? 0.5;
  const r = useFireCommandStore((s) => s.patch.filtRelease) ?? 0.3;
  const envAmt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const resoAmt = useFireCommandStore((s) => s.patch.filterEnvResoAmount) ?? 0;
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const reso = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const atkCurve = useFireCommandStore((s) => s.patch.filtCurveAttack) ?? "lin";
  const decCurve = useFireCommandStore((s) => s.patch.filtCurveDecay) ?? "exp";
  const relCurve = useFireCommandStore((s) => s.patch.filtCurveRelease) ?? "exp";
  const setParam = useFireCommandStore((s) => s.setParam);

  // Ref-based telemetry: refreshed inside hints() so notes don't re-render
  // this component at 30 fps (see useToneTelemetryRef).
  const telRef = useToneTelemetryRef();

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const tel0 = telRef.current;
  const st = useRef<FiltEnvVizState>({
    a, d, sus, r, envAmt, resoAmt, cutoff, reso, type, atkCurve, decCurve, relCurve,
    telStage: tel0.filt.stage, telPhase: tel0.filt.phase, telLevel: tel0.filt.level, voices: tel0.voiceCount,
  });
  st.current = {
    a, d, sus, r, envAmt, resoAmt, cutoff, reso, type, atkCurve, decCurve, relCurve,
    telStage: st.current.telStage, telPhase: st.current.telPhase, telLevel: st.current.telLevel, voices: st.current.voices,
  };

  const sweeping = Math.abs(envAmt) > 0.04 || a > 0.04 || Math.abs(sus - 0.5) > 0.1;

  useEffect(() => {
    const key = motionHash(a, d, sus, r, envAmt, resoAmt, cutoff, reso, strCode(type), strCode(atkCurve), strCode(decCurve), strCode(relCurve));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [a, d, sus, r, envAmt, resoAmt, cutoff, reso, type, atkCurve, decCurve, relCurve]);

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "amt") {
        setParam("filterEnvAmount", Math.round(clamp(x * 2 - 1, -1, 1) * 1000) / 1000);
        return;
      }
      const level = 1 - clamp(y / 0.72, 0, 1);
      if (mode === "S") {
        setParam("filtSustain", Math.round(level * 1000) / 1000);
        return;
      }
      if (mode === "A") setParam("filtAttack", Math.round(logLerp(x, A_MIN, A_MAX) * 1000) / 1000);
      else if (mode === "D") setParam("filtDecay", Math.round(logLerp(x, D_MIN, D_MAX) * 1000) / 1000);
      else if (mode === "R") setParam("filtRelease", Math.round(logLerp(x, R_MIN, R_MAX) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const hitZone = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    if (ly > H * 0.78) return "amt";
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
    setParam("filtAttack", 0.01);
    setParam("filtDecay", 0.3);
    setParam("filtSustain", 0.5);
    setParam("filtRelease", 0.3);
    setParam("filterEnvAmount", 0);
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
        paintFiltEnv(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        const tv = telRef.current;
        st.current.telStage = tv.filt.stage;
        st.current.telPhase = tv.filt.phase;
        st.current.telLevel = tv.filt.level;
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
            st.current.envAmt,
            st.current.resoAmt,
            st.current.cutoff,
            st.current.reso,
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
        borderColor: hexA(C, sweeping ? 0.55 : 0.32),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, sweeping ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag A/D/S/R zones · Bottom rail: Env Amt (±) · Double-click: defaults"
      role="img"
      aria-label="Filter envelope cutoff sweep"
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
        Cutoff Sweep
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        {envAmt > 0.04 ? `+${Math.round(envAmt * 100)}` : envAmt < -0.04 ? `${Math.round(envAmt * 100)}` : "FLAT"}
      </div>
    </div>
  );
}
