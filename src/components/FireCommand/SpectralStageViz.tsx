/**
 * Spectral — Bin Lattice stage visualizer.
 *
 * IDIOM: a data grid. Stages are a ~10:1 letterbox, which is the natural shape
 * of a spectrogram row, so the width is the frequency axis and each bin is a
 * column of discrete cells rather than a smooth bar. That cell quantisation is
 * the point — this is the most digital of the six modules, and it should read as
 * a readout rather than a waveform.
 *
 * The modes act on the lattice itself: `freeze` locks the field and hatches it,
 * `smear` bleeds each column horizontally into its neighbours, `shift` slides
 * the whole grid along the axis, and `gate` punches the sub-threshold columns
 * out into empty cells.
 *
 * Mode · Amount · Mix · Low · High (Signal Path FX · FC.spectral).
 * Drag: Amount ↔ / Mix ↕. Bottom: Mix rail. Double-click: cycle mode.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { SpectralMode } from "@/audio/dsp/FireCommandSynth";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  drawGlow,
  footer,
  grain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  scanlines,
  VIZ_FONT_LABEL,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 176;
const C = FC.spectral;
const C_DEEP = bandShade(FC.fx, 0.48);
const C_MID = bandShade(FC.fx, 0.62);
const C_HOT = bandShade(FC.fx, 0.78);
const C_GLOW = bandShade(FC.fx, 0.96);
const C_AMT = bandShade(FC.fx, 0.7);
const C_MIX = bandShade(FC.fx, 0.88);

const MODE_CYCLE: SpectralMode[] = ["off", "freeze", "smear", "gate", "shift"];
/** Lattice width in bins — dense enough to read as a grid at any panel width. */
const N = 112;
/** Top of the analyser's usable range, matching the resample below. */
const F_TOP = 15400;

const SCRATCH = new Float32Array(N);
const SHOWN = new Float32Array(N);
/** Per-column state for the current frame: 1 = passing, 0 = punched out. */
const COLS = new Uint8Array(N);
/** Cell ramp, baked once — `bandShade` is far too heavy to call per cell. */
const CELL_RAMP = Array.from({ length: 8 }, (_, i) => bandShade(FC.fx, 0.5 + (i / 7) * 0.4));

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic per-bin fizz — a fixed noise floor, not a crawling one. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The resting field.
 *
 * The synth is silent whenever nobody is holding a note, so the analyser hands
 * back near-zero bins most of the time. Without a bed underneath, the lattice
 * would be blank exactly when someone is looking at it. This is a plausible
 * pink-tilted spectrum with slowly drifting formants and per-bin roughness, so
 * the grid stays legible and breathes at rest.
 */
function restBin(i: number, t: number): number {
  const u = (i + 0.5) / N;
  const tilt = 0.3 + 0.56 * Math.pow(1 - u, 0.85);
  const f1 = 0.3 * Math.exp(-((u - (0.09 + 0.03 * Math.sin(t * 0.37))) ** 2) * 110);
  const f2 = 0.24 * Math.exp(-((u - (0.3 + 0.05 * Math.sin(t * 0.23 + 1.9))) ** 2) * 170);
  const f3 = 0.17 * Math.exp(-((u - (0.57 + 0.04 * Math.sin(t * 0.17 + 3.4))) ** 2) * 300);
  // Per-bin roughness is what makes this read as a bin lattice and not a curve.
  const rough =
    (hash01(i * 1.7) - 0.5) * 0.2 + (hash01(i * 5.3) - 0.5) * 0.12 * Math.sin(t * 0.8 + i * 0.7);
  return clamp(tilt + f1 + f2 + f3 + rough, 0.06, 1);
}

/** Mean magnitude of the live field — how hard the analyser is being driven. */
function fieldEnergy(bins: Float32Array): number {
  let s = 0;
  for (let i = 0; i < N; i++) s += bins[i]!;
  return s / N;
}

/** Per-component lattice memory: what freeze holds and what smear smooths. */
export type SpectralField = {
  /** Analyser magnitudes, valid only while `hasLive` is true. */
  bins: Float32Array;
  hasLive: boolean;
  frozen: Float32Array;
  smooth: Float32Array;
  lastMode: SpectralMode;
  /** False until the first paint seeds `frozen` / `smooth`. */
  armed: boolean;
  byteBuf: Uint8Array<ArrayBuffer> | null;
};

export function createSpectralField(): SpectralField {
  return {
    bins: new Float32Array(N),
    hasLive: false,
    frozen: new Float32Array(N),
    smooth: new Float32Array(N),
    lastMode: "off",
    armed: false,
    byteBuf: null,
  };
}

/**
 * Pull the post-master analyser into `field.bins`. Kept out of the paint so the
 * paint stays deterministic. `hasLive` only says whether an analyser answered —
 * a running-but-silent engine still reports live, and the paint fades its own
 * resting field in underneath whenever those bins are near zero.
 */
export function sampleSpectralField(field: SpectralField): void {
  try {
    const e = getEngine();
    const analyser = e.analyserPost;
    if (!analyser || e.ctx.state !== "running") {
      field.hasLive = false;
      return;
    }
    if (!field.byteBuf || field.byteBuf.length !== analyser.frequencyBinCount) {
      field.byteBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    const buf = field.byteBuf;
    analyser.getByteFrequencyData(buf);
    const srcN = buf.length;
    for (let i = 0; i < N; i++) {
      const a = Math.floor((i / N) * srcN * 0.7);
      const b = Math.floor(((i + 1) / N) * srcN * 0.7);
      let sum = 0;
      let c = 0;
      for (let j = a; j < Math.max(a + 1, b); j++) {
        sum += buf[j] ?? 0;
        c++;
      }
      field.bins[i] = (sum / Math.max(1, c)) / 255;
    }
    field.hasLive = true;
  } catch {
    field.hasLive = false;
  }
}

type DragMode = "xy" | "mix" | null;

export type SpectralVizState = {
  mode: SpectralMode;
  amount: number;
  mix: number;
  binLow: number;
  binHigh: number;
  /** Persistent lattice memory, owned by the component. */
  field: SpectralField;
};

/** Paint the lattice. Deterministic given (p, now, flash). */
export function paintSpectral(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: SpectralVizState,
  now: number,
  flash: number,
): void {
  const f = p.field;
  const isLive = p.mode !== "off";
  const amount = clamp(p.amount, 0, 1);
  const mix = clamp(p.mix, 0, 1);
  const lo = clamp(Math.min(p.binLow ?? 0, p.binHigh ?? 1), 0, 1);
  const hi = clamp(Math.max(p.binLow ?? 0, p.binHigh ?? 1), 0, 1);
  const energy = 0.08 + (isLive ? mix * 0.38 + amount * 0.14 : 0) + flash * 0.22;
  const sec = now / 1000;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.58 });

  // ── geometry ──
  const padL = 22;
  const padR = 18;
  const spanW = Math.max(80, W - padL - padR);
  const top = 32;
  const bot = 120;
  const gridH = bot - top;
  const rows = clamp(Math.round(gridH / 7), 8, 20);
  const cellH = gridH / rows;
  const colW = spanW / N;
  const cw = Math.max(1.2, colW - Math.min(2.4, colW * 0.22));
  const ch = Math.max(1.2, cellH - 1.6);

  if (f.lastMode !== p.mode) {
    f.lastMode = p.mode;
    f.frozen.fill(0);
    f.armed = false;
  }

  // ── source magnitudes ──
  // Live bins ride on top of the resting bed, and the bed fades out the moment
  // the analyser sees real energy — so the lattice is always populated, and
  // playing a note visibly takes the panel over.
  const drive = f.hasLive ? fieldEnergy(f.bins) : 0;
  const rest = 1 - clamp((drive - 0.012) / 0.08, 0, 1);
  const seeding = !f.armed;
  for (let i = 0; i < N; i++) {
    const live = f.hasLive ? clamp(f.bins[i]! * 1.35, 0, 1) : 0;
    SCRATCH[i] = clamp(Math.max(live, restBin(i, sec) * rest), 0.04, 1);
    if (seeding) {
      f.smooth[i] = SCRATCH[i]!;
      // Hold a moment-ago contour, so a freshly armed freeze already shows caps
      // that differ from the field instead of sitting exactly on top of it.
      f.frozen[i] = clamp(Math.max(live, restBin(i, sec - 0.9) * rest), 0.04, 1);
    }
  }
  if (seeding) f.armed = true;

  // ── mode processing ──
  let shiftCols = 0;
  if (p.mode === "freeze") {
    for (let i = 0; i < N; i++) SHOWN[i] = f.frozen[i]! * amount + SCRATCH[i]! * (1 - amount);
  } else if (p.mode === "smear") {
    const k = 1 - amount * 0.94;
    for (let i = 0; i < N; i++) f.smooth[i]! += (SCRATCH[i]! - f.smooth[i]!) * k;
    // Horizontal bleed: the whole point of smear is that a bin stops being
    // its own column.
    const r = 1 + Math.round(amount * 7);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      let wt = 0;
      for (let d = -r; d <= r; d++) {
        const j = i + d;
        if (j < 0 || j >= N) continue;
        const w = 1 - Math.abs(d) / (r + 1);
        sum += f.smooth[j]! * w;
        wt += w;
      }
      SHOWN[i] = sum / Math.max(1e-6, wt);
    }
  } else if (p.mode === "shift") {
    shiftCols = Math.round((amount * 2 - 1) * N * 0.28);
    for (let i = 0; i < N; i++) {
      const j = i - shiftCols;
      SHOWN[i] = j >= 0 && j < N ? SCRATCH[j]! : 0;
    }
  } else {
    for (let i = 0; i < N; i++) SHOWN[i] = SCRATCH[i]!;
  }

  // The gate threshold tracks the field's own peak, so it always has something
  // to cut into — a fixed level either punches everything out of a quiet field
  // or nothing out of a loud one.
  let peak = 0;
  for (let i = 0; i < N; i++) if (SHOWN[i]! > peak) peak = SHOWN[i]!;
  const thr = p.mode === "gate" ? amount * 0.92 * Math.max(0.25, peak) : 0;
  /** Magnitude → lit rows. Floored well above zero so mix never blanks the grid. */
  const vScale = 0.62 + mix * 0.38;
  const rowsOf = (v: number) => clamp(Math.round(clamp(v, 0, 1) * vScale * rows), 0, rows);

  // ── lattice frame ──
  ctx.strokeStyle = hexA(C_MID, 0.07 + (isLive ? mix * 0.06 : 0));
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 0; r <= rows; r += 2) {
    const y = top + r * cellH;
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + spanW, y);
  }
  for (let c = 0; c <= N; c += 8) {
    const x = padL + c * colW;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
  }
  ctx.stroke();

  // Frequency ruler along the bottom of the grid.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let khz = 0; khz <= 14; khz += 2) {
    const x = padL + (khz * 1000 / F_TOP) * spanW;
    ctx.fillStyle = hexA(C_MID, 0.16);
    ctx.fillRect(x, bot, 1, 4);
    ctx.fillStyle = hexA(C_MID, 0.4);
    ctx.fillText(khz === 0 ? "0" : `${khz}k`, x, bot + 14);
  }

  // ── the cells ──
  // Column state up front: a punched column still draws its empty lattice, just
  // dimmer, so a hole reads as a hole and not as missing data.
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    const gated = p.mode === "gate" && SHOWN[i]! < thr;
    COLS[i] = u >= lo && u <= hi && !gated ? 1 : 0;
  }

  // Bypassed still shows its grid — the panel should read as a spectral lattice
  // at a glance, not as an empty box waiting to be switched on.
  const dim = isLive ? 1 : 0.4;

  // Empty lattice first: every cell gets a body, so the structure is legible
  // even when the field is quiet. One fillStyle per pass keeps it cheap.
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = hexA(C_DEEP, 0.04 + (pass === 0 ? 0.1 : 0.26) * dim);
    for (let i = 0; i < N; i++) {
      if (COLS[i] !== pass) continue;
      const x = padL + i * colW;
      for (let r = 0; r < rows; r++) {
        ctx.fillRect(x, bot - (r + 1) * cellH + (cellH - ch) * 0.5, cw, ch);
      }
    }
  }

  // Then the lit cells on top.
  ctx.globalAlpha = dim;
  for (let i = 0; i < N; i++) {
    if (!COLS[i]) continue;
    const v = SHOWN[i]!;
    const x = padL + i * colW;
    const lit_ = rowsOf(v);
    for (let r = 0; r < lit_; r++) {
      const t = r / Math.max(1, rows - 1);
      const y = bot - (r + 1) * cellH + (cellH - ch) * 0.5;
      const isCap = r === lit_ - 1;
      ctx.fillStyle = isCap
        ? hexA(C_GLOW, 0.75 + v * 0.25)
        : hexA(CELL_RAMP[(t * 7) | 0]!, 0.28 + t * 0.34 + v * 0.2);
      ctx.fillRect(x, y, cw, ch);
    }

    // Freeze marks the held level even where the live signal has fallen away.
    // Quantised to the same grid so the hold reads as part of the lattice.
    if (isLive && p.mode === "freeze" && amount > 0.05) {
      const fy = bot - rowsOf(f.frozen[i]!) * cellH;
      ctx.fillStyle = hexA(C_GLOW, 0.24 + amount * 0.46);
      ctx.fillRect(x, fy - 1, cw, 1.6);
    }
  }
  ctx.globalAlpha = 1;

  // Bright caps get one batched additive pass — cheaper than glowing each cell.
  lit(ctx, () => {
    for (let i = 0; i < N; i += 2) {
      if (!COLS[i]) continue;
      const v = SHOWN[i]!;
      if (v < 0.32) continue;
      drawGlow(
        ctx,
        padL + i * colW + cw * 0.5,
        bot - rowsOf(v) * cellH,
        8 + v * 14,
        C_GLOW,
        (0.1 + mix * 0.3) * v * dim,
      );
    }
  });

  if (isLive) {
    // Smear: horizontal streaks tying the bleeding columns together.
    if (p.mode === "smear" && amount > 0.15) {
      ctx.fillStyle = hexA(C_HOT, 0.05 + amount * 0.12 * mix);
      for (let r = 1; r < rows; r += 2) {
        const y = bot - (r + 1) * cellH + (cellH - ch) * 0.5;
        ctx.fillRect(padL + lo * spanW, y, (hi - lo) * spanW, ch * 0.5);
      }
    }

    // Freeze: a lock hatch over the whole field.
    if (p.mode === "freeze" && amount > 0.2) {
      scanlines(ctx, W, Hh, 0.04 + amount * 0.06, 4);
      ctx.strokeStyle = hexA(C_GLOW, 0.06 + amount * 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = padL - gridH; x < padL + spanW; x += 26) {
        ctx.moveTo(x, bot);
        ctx.lineTo(x + gridH, top);
      }
      ctx.stroke();
    }

    // Gate: the threshold row the punch-outs are measured against.
    if (p.mode === "gate") {
      const ty = bot - rowsOf(thr) * cellH;
      ctx.strokeStyle = hexA(C_GLOW, 0.4 + amount * 0.35);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, ty);
      ctx.lineTo(padL + spanW, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "right";
      ctx.fillStyle = hexA(C_GLOW, 0.75);
      ctx.fillText(`THR ${Math.round(thr * 100)}`, padL + spanW - 2, ty - 3);
    }

    // Shift: how far the lattice has slid, and which way.
    if (p.mode === "shift" && shiftCols !== 0) {
      const dir = shiftCols > 0 ? 1 : -1;
      const mag = Math.abs(amount * 2 - 1);
      const ay = top + 24;
      const ax0 = W * 0.5;
      const ax1 = ax0 + dir * (20 + mag * 60);
      ctx.strokeStyle = hexA(C_HOT, 0.35 + mag * 0.45);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax0, ay);
      ctx.lineTo(ax1, ay);
      ctx.lineTo(ax1 - dir * 6, ay - 4);
      ctx.moveTo(ax1, ay);
      ctx.lineTo(ax1 - dir * 6, ay + 4);
      ctx.stroke();
      // The vacated edge: tinted rather than blacked out, so the empty lattice
      // still shows through and the slide reads as a slide.
      const gapW = Math.min(spanW, Math.abs(shiftCols) * colW);
      const gx = dir > 0 ? padL : padL + spanW - gapW;
      ctx.fillStyle = hexA(C_DEEP, 0.1);
      ctx.fillRect(gx, top, gapW, gridH);
      ctx.strokeStyle = hexA(C_HOT, 0.3 + mag * 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dir > 0 ? gx + gapW : gx, top);
      ctx.lineTo(dir > 0 ? gx + gapW : gx, bot);
      ctx.stroke();
    }
  } else {
    // Bypassed: the message sits on a scrim so it stays readable over the grid.
    const my = top + gridH * 0.46;
    ctx.fillStyle = hexA(C_DEEP, 0.62);
    ctx.fillRect(padL, my - 16, spanW, 34);
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    lit(ctx, () => drawGlow(ctx, W * 0.5, my, 46, C_GLOW, 0.3 + flash * 0.25));
    ctx.fillStyle = hexA(C_GLOW, 0.6 + flash * 0.3);
    ctx.fillText("ARM A MODE · DOUBLE-CLICK", W * 0.5, my);
    ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.fillText("Freeze · Smear · Gate · Shift", W * 0.5, my + 14);
  }

  // ── band window ──
  {
    const x0 = padL + lo * spanW;
    const x1 = padL + hi * spanW;
    ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.2);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x0, bot);
    ctx.moveTo(x1, top);
    ctx.lineTo(x1, bot);
    ctx.stroke();
    ctx.setLineDash([]);
    // Chips behind the edge readouts, which now sit over a populated lattice.
    ctx.font = VIZ_FONT_LABEL;
    const loText = `LO ${Math.round(lo * 100)}`;
    const hiText = `HI ${Math.round(hi * 100)}`;
    ctx.fillStyle = hexA(C_DEEP, 0.7);
    ctx.fillRect(x0 + 1, top + 2, ctx.measureText(loText).width + 4, 11);
    ctx.fillRect(x1 - 1 - ctx.measureText(hiText).width - 4, top + 2, ctx.measureText(hiText).width + 4, 11);
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_GLOW, 0.8);
    ctx.fillText(loText, x0 + 3, top + 10);
    ctx.textAlign = "right";
    ctx.fillText(hiText, x1 - 3, top + 10);
  }

  // ── telemetry row ──
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so it can't collide at any panel width.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  const amtLabel =
    p.mode === "shift"
      ? `${amount < 0.5 ? "−" : "+"}${Math.round(Math.abs(amount * 2 - 1) * 100)}`
      : `${Math.round(amount * 100)}`;
  let telX = VIZ_TOP_LABEL_X;
  const telRight = W * 0.5 - 52;
  const tel = (text: string, color: string, alpha: number) => {
    const w = ctx.measureText(text).width;
    if (telX + w > telRight) return;
    ctx.fillStyle = hexA(color, alpha);
    ctx.fillText(text, telX, VIZ_TOP_LABEL_Y);
    telX += w + 14;
  };
  tel(`${N} BINS · ${rows} LVL`, C_HOT, 0.72);
  tel(`AMT ${amtLabel}`, C_AMT, 0.7);
  tel(rest > 0.5 ? "REST FIELD" : "LIVE FFT", C_MID, 0.66);
  if (p.mode === "shift" && shiftCols !== 0) {
    tel(`SHIFT ${shiftCols > 0 ? "+" : ""}${shiftCols}`, C_GLOW, 0.66);
  }

  // Amount / Mix crosshair (the drag target).
  const hx = amount * W;
  const hy = (1 - mix) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.28 + flash * 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  pill(ctx, W * 0.5, 3, p.mode === "off" ? "OFF" : p.mode.toUpperCase(), C_GLOW, { glow: flash });

  // Mix rail, clear of the footer band.
  const railY = Hh - 26;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  ctx.fillStyle = hexA(C_MIX, 0.55);
  ctx.fillRect(12, railY + 1, Math.max(2, railW * mix), 4);
  lit(ctx, () => drawGlow(ctx, 12 + railW * mix, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MIX, 0.85);
  ctx.fillText(`MIX ${Math.round(mix * 100)}%`, 14, railY - 3);

  grain(ctx, W, Hh, 0.024);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "SPEC · BIN LATTICE",
    !isLive ? "BYPASS" : `${p.mode} · A${amtLabel} · ${Math.round(lo * 100)}–${Math.round(hi * 100)}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function SpectralStageViz() {
  const mode = (useFireCommandStore((s) => s.patch.spectralMode) ?? "off") as SpectralMode;
  const amount = useFireCommandStore((s) => s.patch.spectralAmount) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const binLow = useFireCommandStore((s) => s.patch.spectralLow) ?? 0;
  const binHigh = useFireCommandStore((s) => s.patch.spectralHigh) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const fieldRef = useRef<SpectralField>(createSpectralField());
  const st = useRef<SpectralVizState>({ mode, amount, mix, binLow, binHigh, field: fieldRef.current });
  st.current = { mode, amount, mix, binLow, binHigh, field: fieldRef.current };

  const live = mode !== "off";

  useEffect(() => {
    const key = motionHash(MODE_CYCLE.indexOf(mode), amount, mix, binLow, binHigh);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mode, amount, mix, binLow, binHigh]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("spectralAmount", Math.round(x * 1000) / 1000);
      setParam("spectralMix", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("spectralMix", Math.round(x * 1000) / 1000);
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
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix, wrapRef],
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
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const i = MODE_CYCLE.indexOf(st.current.mode);
    setParam("spectralMode", MODE_CYCLE[(i + 1) % MODE_CYCLE.length]!);
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
        // Analyser input can't arrive through the store, so it's pulled here —
        // the paint below stays pure and deterministic on what it's handed.
        sampleSpectralField(st.current.field);
        paintSpectral(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: st.current.mode !== "off" && (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          MODE_CYCLE.indexOf(st.current.mode),
          st.current.amount,
          st.current.mix,
          st.current.binLow,
          st.current.binHigh,
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
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Amount ↔ / Mix ↕ · Bottom: Mix · Double-click: cycle mode"
      role="img"
      aria-label="Spectral bin lattice"
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
        Bin Lattice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? mode : "OFF"}
      </div>
    </div>
  );
}
