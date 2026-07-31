/**
 * FILT — Spectral Blade stage visualizer.
 *
 * IDIOM: the frequency response. Stages are a ~10:1 letterbox, so the panel is
 * one log-Hz axis running left→right with gain in dB running up — a real
 * analyzer trace rather than an abstract glow. Cutoff is where the curve turns,
 * resonance is how tall the peak stands, and slope is how steeply it falls:
 * cascaded stages read as 12 / 24 / 36 dB per octave because the trace lives in
 * a dB space where those are straight lines of different gradient.
 *
 * The four types draw their own silhouettes (LP falls, HP rises, BP is an
 * island, NT is a spike downward), drive blooms the peak and lifts a soft
 * shoulder around it, and the carve modes cut their own dip or blow the formant
 * pair open on top of everything else. Env amount ghosts a second trace at the
 * modulated cutoff; key track ghosts one an octave either side of the reference
 * note so you can see the cutoff being dragged along by the keyboard.
 *
 * Type · Cutoff · Reso · Slope · Carve · Env · KeyTrack · Drive (Tone · FC.filter).
 * Drag: Cutoff ↔ / Reso ↕. Bottom rail: Sat. Double-click: cycle LP→BP→HP→NT.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FireFilterType } from "@/audio/dsp/FireCommandSynth";
import type { FilterCarveMode, FilterModel } from "@/audio/dsp/toneDifferentiation";
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
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 176;
const C = FC.filter;
const C_DEEP = bandShade(FC.tone, 0.22);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.58);
const C_GLOW = bandShade(FC.tone, 0.88);
const C_CUT = bandShade(FC.tone, 0.48);
const C_RESO = bandShade(FC.tone, 0.62);
const C_ENV = bandShade(FC.tone, 0.72);
const C_KEY = bandShade(FC.tone, 0.78);
const C_SAT = bandShade(FC.tone, 0.85);

const F_LO = 20;
const F_HI = 20000;
const CUT_MIN = 20;
const CUT_MAX = 18000;
const RES_MIN = 0.1;
const RES_MAX = 28;

/** dB window the trace lives in — wide enough that 36 dB/oct still fits a decade. */
const DB_LO = -42;
const DB_HI = 24;

/** Harmonic carves key off the played note; A3 stands in for it in the readout. */
const F0_REF = 220;

const DECADES = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] as const;
const DB_TICKS = [18, 12, 6, 0, -6, -12, -18, -24, -30, -36] as const;

const TYPE_CYCLE: FireFilterType[] = ["lowpass", "bandpass", "highpass", "notch"];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(f: number, lo: number, hi: number) {
  return Math.log(clamp(f, lo, hi) / lo) / Math.log(hi / lo);
}

/** Deterministic scatter — a fixed speck field, so drive heat doesn't crawl. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Numeric stand-in for an enum string, so `motionHash` sees mode switches. */
function strCode(s: string): number {
  return (s.length << 9) ^ (s.charCodeAt(0) | 0) ^ ((s.charCodeAt(1) | 0) << 4);
}

/**
 * One biquad stage in dB. The analog prototype is used rather than an ad-hoc
 * bump, so the resonance peak grows out of Q the way it does in the filter.
 */
function stageDb(type: FireFilterType, r: number, q: number): number {
  const r2 = r * r;
  const gap = 1 - r2;
  const den = Math.sqrt(gap * gap + (r / q) * (r / q));
  let m: number;
  if (type === "highpass") m = r2 / den;
  else if (type === "bandpass") m = (r / q) / den;
  else if (type === "notch") m = Math.abs(gap) / den;
  else m = 1 / den;
  return 20 * Math.log10(Math.max(1e-7, m));
}

/** Peaking / notching bell in log-frequency — `q` narrows it, `gainDb` signs it. */
function bellDb(f: number, f0: number, q: number, gainDb: number): number {
  const oct = Math.log2(Math.max(1e-6, f / f0));
  return gainDb * Math.exp(-(oct * oct) * q * q * 0.5);
}

/** High shelf — the hiss-region cut the `noise` carve applies. */
function shelfDb(f: number, f0: number, gainDb: number): number {
  const oct = Math.log2(Math.max(1e-6, f / f0));
  return gainDb * (0.5 + 0.5 * Math.tanh(oct * 1.6));
}

/** Carve contribution, mirroring the engine's peaking / notch / shelf choices. */
function carveDb(carve: FilterCarveMode, amt: number, f: number, cut: number): number {
  if (carve === "off" || amt < 0.02) return 0;
  if (carve === "formant") {
    const f1 = clamp(cut * (0.35 + amt * 0.2), 220, 1000);
    const f2 = clamp(cut * (0.95 + amt * 1.1), 650, 3800);
    return bellDb(f, f1, 2.2 + amt * 4.5, 1.5 + amt * 5) + bellDb(f, f2, 1.8 + amt * 3.5, 1.2 + amt * 4);
  }
  if (carve === "fundamental") return bellDb(f, F0_REF, 0.7 + amt * 8, -(6 + amt * 30));
  if (carve === "odds") return bellDb(f, F0_REF * 3, 1 + amt * 6, -amt * 18);
  if (carve === "evens") return bellDb(f, F0_REF * 2, 1 + amt * 6, -amt * 18);
  return shelfDb(f, 4500, -amt * 14);
}

/** Drive lifts a soft shoulder either side of cutoff before it saturates. */
function driveDb(drive: number, f: number, cut: number): number {
  if (drive < 0.02) return 0;
  const oct = Math.log2(Math.max(1e-6, f / cut));
  return drive * 3.2 * Math.exp(-(oct * oct) * 0.22);
}

/** Which partials the carve is aimed at — drawn as floor ticks. */
function carvePartials(carve: FilterCarveMode): readonly number[] {
  if (carve === "fundamental") return [1];
  if (carve === "odds") return [3, 5, 7];
  if (carve === "evens") return [2, 4, 6];
  return [];
}

export type FilterVizState = {
  type: FireFilterType;
  cutoff: number;
  res: number;
  envAmt: number;
  keyTrack: number;
  sat: number;
  slope: number;
  carve: FilterCarveMode;
  carveAmt: number;
  model: FilterModel;
};

/**
 * Paint the response. Exported and pure so a whole patch sweep can be rendered
 * headlessly without mounting the component or waiting on a RAF frame.
 */
export function paintFilter(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: FilterVizState,
  now: number,
  flash: number,
): void {
  const cut = clamp(p.cutoff, CUT_MIN, CUT_MAX);
  const res = clamp(p.res, RES_MIN, RES_MAX);
  const q = clamp(res, 0.5, 30);
  const slope = clamp(Math.round(p.slope || 1), 1, 3);
  const carve = p.carve ?? "off";
  const carveAmt = clamp(p.carveAmt ?? 0, 0, 1);
  const heat = clamp(p.sat, 0, 1);
  const envAmt = clamp(p.envAmt, -1, 1);
  const keyTrack = clamp(p.keyTrack, 0, 1);
  // Peak height in dB is the honest "how resonant is this" number.
  const peakDb = Math.max(0, 20 * Math.log10(q)) * (p.type === "notch" ? 0 : 1);
  const peakN = clamp(peakDb / 24, 0, 1);
  const energy = 0.18 + peakN * 0.4 + heat * 0.32 + Math.abs(envAmt) * 0.14 + flash * 0.2;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.72 });

  // ── geometry: one log-Hz axis across the whole width ──
  const padL = 44;
  const padR = 26;
  const span = Math.max(60, W - padL - padR);
  const top = 26;
  const floorY = Hh - 40;
  const plotH = floorY - top;

  const xOf = (f: number) => padL + logNorm(f, F_LO, F_HI) * span;
  const yOf = (db: number) => floorY - ((clamp(db, DB_LO, DB_HI) - DB_LO) / (DB_HI - DB_LO)) * plotH;

  const respDb = (f: number, cutoff: number) =>
    stageDb(p.type, f / Math.max(20, cutoff), q) * slope
    + carveDb(carve, carveAmt, f, cutoff)
    + driveDb(heat, f, cutoff);

  // ── graticule: decade verticals, dB horizontals ──
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < DECADES.length; i++) {
    const f = DECADES[i]!;
    const x = Math.round(xOf(f)) + 0.5;
    const major = f === 100 || f === 1000 || f === 10000;
    ctx.strokeStyle = hexA(C_MID, major ? 0.2 + energy * 0.08 : 0.09);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, floorY);
    ctx.stroke();
  }
  for (let i = 0; i < DB_TICKS.length; i++) {
    const db = DB_TICKS[i]!;
    const y = Math.round(yOf(db)) + 0.5;
    ctx.strokeStyle = hexA(C_MID, db === 0 ? 0.26 : 0.07);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + span, y);
    ctx.stroke();
  }
  ctx.restore();

  // Axis legends — Hz along the floor, dB up the left gutter.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_MID, 0.5);
  for (let i = 0; i < DECADES.length; i++) {
    const f = DECADES[i]!;
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, xOf(f), floorY + 10);
  }
  ctx.textAlign = "right";
  for (const db of [18, 0, -18, -36] as const) {
    ctx.fillStyle = hexA(C_MID, db === 0 ? 0.6 : 0.4);
    ctx.fillText(db > 0 ? `+${db}` : `${db}`, padL - 5, yOf(db) + 3);
  }

  // ── key-track ghosts: the same curve an octave either side of the note ──
  if (keyTrack > 0.02) {
    const swing = keyTrack * 2;
    for (const dir of [-1, 1] as const) {
      const ghostCut = clamp(cut * Math.pow(2, dir * swing), CUT_MIN, CUT_MAX);
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / 120);
        const x = xOf(f);
        const y = yOf(respDb(f, ghostCut));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexA(C_KEY, 0.1 + keyTrack * 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Keyboard pips on the frequency axis — the notes the tracking reads from.
    const keys = Math.round(5 + keyTrack * 9);
    for (let i = 0; i < keys; i++) {
      const f = logLerp(i / Math.max(1, keys - 1), 110, 3520);
      const x = xOf(f);
      const h = 4 + keyTrack * 8;
      ctx.fillStyle = hexA(C_KEY, 0.16 + keyTrack * 0.4);
      ctx.fillRect(x - 1, floorY - h, 2, h);
    }
  }

  // ── env ghost: where the filter envelope drags cutoff to ──
  const envCut = clamp(cut * Math.pow(2, envAmt * 3.5), CUT_MIN, CUT_MAX);
  if (Math.abs(envAmt) > 0.03) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const f = F_LO * Math.pow(F_HI / F_LO, i / 160);
      const x = xOf(f);
      const y = yOf(respDb(f, envCut));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hexA(C_ENV, 0.3 + Math.abs(envAmt) * 0.4);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // Sweep arrow along the cutoff rail at the top of the plot.
    const ax = xOf(cut);
    const bx = xOf(envCut);
    const ay = top + 9;
    const dir = Math.sign(bx - ax) || 1;
    ctx.strokeStyle = hexA(C_ENV, 0.62);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, ay);
    ctx.stroke();
    ctx.fillStyle = hexA(C_ENV, 0.85);
    ctx.beginPath();
    ctx.moveTo(bx, ay);
    ctx.lineTo(bx - dir * 7, ay - 4);
    ctx.lineTo(bx - dir * 7, ay + 4);
    ctx.closePath();
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_ENV, 0.7);
    ctx.fillText("ENV", (ax + bx) * 0.5, ay - 5);
  }

  // ── the response trace ──
  const N = 320;
  let peakX = xOf(cut);
  let peakY = yOf(0);
  let peakVal = -999;
  ctx.beginPath();
  ctx.moveTo(padL, floorY);
  for (let i = 0; i <= N; i++) {
    const f = F_LO * Math.pow(F_HI / F_LO, i / N);
    const db = respDb(f, cut);
    const x = padL + (i / N) * span;
    const y = yOf(db);
    if (db > peakVal) {
      peakVal = db;
      peakX = x;
      peakY = y;
    }
    ctx.lineTo(x, y);
  }
  ctx.lineTo(padL + span, floorY);
  ctx.closePath();
  const fill = cachedGrad(
    ctx,
    `fresp|${W}|${Hh}|${(peakN * 12) | 0}|${(heat * 12) | 0}`,
    (c) => {
      const g = c.createLinearGradient(0, top, 0, floorY);
      g.addColorStop(0, hexA(C_GLOW, 0.3 + peakN * 0.2 + heat * 0.12));
      g.addColorStop(0.45, hexA(C_HOT, 0.13));
      g.addColorStop(1, hexA(C_DEEP, 0.03));
      return g;
    },
  );
  ctx.fillStyle = fill;
  ctx.fill();

  const trace = () => {
    for (let i = 0; i <= N; i++) {
      const f = F_LO * Math.pow(F_HI / F_LO, i / N);
      const x = padL + (i / N) * span;
      const y = yOf(respDb(f, cut));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  glowStroke(ctx, trace, C_GLOW, {
    width: 2.2,
    glow: 0.7 + peakN * 0.8 + flash * 0.6,
    alpha: 0.82 + energy * 0.18,
  });

  // Resonance bloom — drive turns the peak into a saturating flare.
  if (peakN > 0.04 || heat > 0.05) {
    lit(ctx, () => {
      drawGlow(ctx, peakX, peakY, 12 + peakN * 34 + heat * 20, C_RESO, 0.22 + peakN * 0.4 + heat * 0.3);
      drawGlow(ctx, peakX, peakY, 5 + peakN * 12, C_GLOW, 0.3 + peakN * 0.45 + flash * 0.25);
    });
  }

  // Drive heat: specks lifting off the peak, hashed so the field never crawls.
  if (heat > 0.05) {
    lit(ctx, () => {
      const n = 6 + Math.round(heat * 12);
      for (let i = 0; i < n; i++) {
        const t = (hash01(i * 7.7) + now / (2800 - heat * 1400)) % 1;
        const x = peakX + (hash01(i * 3.3) - 0.5) * (70 + heat * 110);
        const y = peakY - t * (24 + heat * 40);
        drawGlow(ctx, x, y, 3 + heat * 4, C_SAT, (1 - t) * heat * 0.45);
      }
    });
  }

  // Carve markers: the partials (or formant pair) the carve is aimed at.
  const partials = carvePartials(carve);
  if (carveAmt > 0.02 && partials.length > 0) {
    ctx.save();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    for (let i = 0; i < partials.length; i++) {
      const n = partials[i]!;
      const x = xOf(clamp(F0_REF * n, F_LO, F_HI));
      const a = (0.5 - i * 0.12) * (0.35 + carveAmt * 0.65);
      ctx.strokeStyle = hexA(C_CUT, a);
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, floorY);
      ctx.lineTo(x, floorY - 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexA(C_CUT, a);
      ctx.fillText(`${n}f`, x, floorY - 19);
    }
    ctx.restore();
  } else if (carveAmt > 0.02 && carve === "formant") {
    const f1 = clamp(cut * (0.35 + carveAmt * 0.2), 220, 1000);
    const f2 = clamp(cut * (0.95 + carveAmt * 1.1), 650, 3800);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_CUT, 0.4 + carveAmt * 0.4);
    ctx.fillText("F1", xOf(f1), yOf(respDb(f1, cut)) - 8);
    ctx.fillText("F2", xOf(f2), yOf(respDb(f2, cut)) - 8);
  }

  // ── cutoff marker + type glyph ──
  const cx = xOf(cut);
  // Only breathes while drive is pushing it; otherwise a paused canvas would
  // freeze the marker at whatever brightness the last frame happened to hold.
  const pulse = heat > 0.05 ? 0.62 + 0.38 * Math.sin(now / 380) : 0.82;
  const laser = cachedGrad(ctx, `flaser|${Hh}|${top}|${floorY}`, (c) => {
    const g = c.createLinearGradient(0, top, 0, floorY);
    g.addColorStop(0, hexA(C_GLOW, 0.12));
    g.addColorStop(0.45, hexA(C_GLOW, 0.5));
    g.addColorStop(1, hexA(C_CUT, 0.16));
    return g;
  });
  ctx.save();
  ctx.globalAlpha = 0.55 * pulse + flash * 0.3;
  ctx.fillStyle = laser;
  ctx.fillRect(cx - 1.5, top, 3, plotH);
  ctx.restore();
  lit(ctx, () => drawGlow(ctx, cx, peakY, 10 + flash * 10, C_GLOW, 0.35 * pulse));

  ctx.save();
  ctx.translate(cx, top + 2);
  ctx.fillStyle = hexA(C_CUT, 0.62);
  ctx.strokeStyle = hexA(C_CUT, 0.75);
  ctx.lineWidth = 1.6;
  if (p.type === "lowpass" || p.type === "highpass") {
    const s = p.type === "lowpass" ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 8, 9);
    ctx.lineTo(s * -8, 9);
    ctx.closePath();
    ctx.fill();
  } else if (p.type === "bandpass") {
    ctx.strokeRect(-9, 1, 18, 8);
  } else {
    ctx.beginPath();
    ctx.moveTo(-6, 1);
    ctx.lineTo(6, 9);
    ctx.moveTo(6, 1);
    ctx.lineTo(-6, 9);
    ctx.stroke();
  }
  ctx.restore();

  // Crosshair at cutoff × its own gain — the drag handle's read-back.
  const hy = yOf(respDb(cut, cut));
  ctx.strokeStyle = hexA(C_GLOW, 0.42 + flash * 0.3);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 8, hy);
  ctx.lineTo(cx + 8, hy);
  ctx.moveTo(cx, hy - 8);
  ctx.lineTo(cx, hy + 8);
  ctx.stroke();
  ctx.fillStyle = hexA(C_HOT, 0.9);
  ctx.beginPath();
  ctx.arc(cx, hy, 3 + flash * 2, 0, Math.PI * 2);
  ctx.fill();

  // ── telemetry row (clear of the DOM eyebrow at the left, readout at the right) ──
  if (W >= 460) {
    const cols = Math.max(96, Math.min(150, (W - 240) / 5));
    const x0 = 136;
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_HOT, 0.72);
    ctx.fillText(`SLOPE ${slope * 12}dB/OCT`, x0, 16);
    ctx.fillStyle = hexA(C_RESO, 0.66);
    ctx.fillText(`PEAK +${peakDb.toFixed(1)}dB`, x0 + cols, 16);
    ctx.fillStyle = hexA(C_CUT, 0.64);
    ctx.fillText(
      carve === "off" || carveAmt < 0.02 ? "CARVE OFF" : `CARVE ${carve.toUpperCase()} ${Math.round(carveAmt * 100)}`,
      x0 + cols * 2,
      16,
    );
    ctx.fillStyle = hexA(C_KEY, 0.62);
    ctx.fillText(`KEY ${Math.round(keyTrack * 100)}`, x0 + cols * 3, 16);
    ctx.fillStyle = hexA(C_MID, 0.6);
    ctx.fillText(`${(p.model ?? "biquad").toUpperCase()}`, x0 + cols * 4, 16);
  }

  pill(ctx, W * 0.5, 3, p.type.toUpperCase(), C_GLOW, { glow: flash });

  // ── sat rail along the bottom, clear of the footer band ──
  const railY = Hh - 25;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  if (heat > 0.01) {
    const sg = cachedGrad(ctx, `satrail|${W}`, (c) => {
      const g = c.createLinearGradient(12, 0, 12 + railW, 0);
      g.addColorStop(0, hexA(C_HOT, 0.4));
      g.addColorStop(1, hexA(C_SAT, 0.92));
      return g;
    });
    ctx.fillStyle = sg;
    ctx.fillRect(12, railY + 1, Math.max(2, railW * heat), 4);
  }
  lit(ctx, () => drawGlow(ctx, 12 + railW * heat, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_SAT, 0.7);
  ctx.fillText("SAT", 14, railY - 3);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);

  const bits: string[] = [];
  bits.push(cut >= 1000 ? `${(cut / 1000).toFixed(cut >= 10000 ? 1 : 2)}k` : `${Math.round(cut)}Hz`);
  bits.push(`Q${res.toFixed(1)}`);
  if (slope > 1) bits.push(`${slope * 12}dB`);
  if (Math.abs(envAmt) > 0.04) bits.push(`E${envAmt > 0 ? "+" : ""}${Math.round(envAmt * 100)}`);
  if (keyTrack > 0.05) bits.push(`K${Math.round(keyTrack * 100)}`);
  if (heat > 0.04) bits.push(`S${Math.round(heat * 100)}`);
  if (carve !== "off" && carveAmt > 0.04) bits.push(`${carve.slice(0, 3).toUpperCase()}${Math.round(carveAmt * 100)}`);
  footer(ctx, W, Hh, "FILT · SPECTRAL BLADE", bits.join(" · "), C_GLOW, C_HOT);
}

export function FilterStageViz() {
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const res = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const envAmt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const keyTrack = useFireCommandStore((s) => s.patch.filterKeyTrack) ?? 0.3;
  const sat = useFireCommandStore((s) => s.patch.filterDrive) ?? 0;
  const slope = useFireCommandStore((s) => s.patch.filterSlope) ?? 1;
  const carve = useFireCommandStore((s) => s.patch.filterCarve) ?? "off";
  const carveAmt = useFireCommandStore((s) => s.patch.filterCarveAmount) ?? 0;
  const model = useFireCommandStore((s) => s.patch.filterModel) ?? "biquad";
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<"xy" | "sat" | null>(null);
  const prevKey = useRef(0);
  const st = useRef<FilterVizState>({ type, cutoff, res, envAmt, keyTrack, sat, slope, carve, carveAmt, model });
  st.current = { type, cutoff, res, envAmt, keyTrack, sat, slope, carve, carveAmt, model };

  const sculpted = Math.abs(Math.log10(cutoff / 2600)) > 0.08 || res > 1.2 || Math.abs(envAmt) > 0.05 || sat > 0.05 || keyTrack > 0.35;

  useEffect(() => {
    const key = motionHash(cutoff, res, envAmt, keyTrack, sat, slope, carveAmt, strCode(type), strCode(carve));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [type, cutoff, res, envAmt, keyTrack, sat, slope, carve, carveAmt]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      const cut = logLerp(x, CUT_MIN, CUT_MAX);
      // Up = more reso (inverse Y)
      const q = logLerp(1 - y, RES_MIN, RES_MAX);
      setParam("filterCutoff", Math.round(cut));
      setParam("filterResonance", Math.round(q * 100) / 100);
    },
    [setParam, wrapRef],
  );

  const applySat = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("filterDrive", Math.round(x * 1000) / 1000);
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
        dragRef.current = "sat";
        wrap.setPointerCapture(e.pointerId);
        applySat(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applySat, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "sat") applySat(e.clientX);
    },
    [applyXy, applySat],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const i = TYPE_CYCLE.indexOf(st.current.type);
    const next = TYPE_CYCLE[(i + 1) % TYPE_CYCLE.length]!;
    setParam("filterType", next);
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
        paintFilter(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: (st.current.sat ?? 0) > 0.05,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.cutoff,
          st.current.res,
          st.current.envAmt,
          st.current.keyTrack,
          st.current.sat,
          st.current.slope,
          st.current.carveAmt,
          strCode(st.current.type),
          strCode(st.current.carve),
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
        borderColor: hexA(C, sculpted ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, sculpted ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Cutoff ↔ / Reso ↕ · Bottom rail: Sat · Double-click: cycle LP→BP→HP→NT"
      role="img"
      aria-label="Filter spectral blade"
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
        Spectral Blade
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        {type.slice(0, 2)}
      </div>
    </div>
  );
}
