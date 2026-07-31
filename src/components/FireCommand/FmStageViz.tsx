/**
 * FM · Ring — Sideband Forge stage visualizer.
 *
 * IDIOM: the sideband spectrum. FM does exactly one legible thing — it splits a
 * carrier into a comb of sidebands spaced by the modulator, and the comb widens
 * as the index rises. A 10:1 letterbox is the perfect frame for that: the
 * carrier stands at the centre, sidebands march out symmetrically at ±k·ratio,
 * and their heights follow a Bessel-shaped envelope so energy visibly migrates
 * out of the carrier and into the skirts as FM amount (and B→A) climbs.
 *
 * Partials that fall past DC are drawn as dashed *fold* spikes — the aliasing
 * back around zero that makes high ratios sound inharmonic. Ring mod adds its
 * own sum/difference pair in its own colour. A small scope pane on the right
 * shows the resulting warped waveform, so the spectrum has its time-domain
 * counterpart alongside it.
 *
 * Drag: Ratio ↔ / Amount ↕. Bottom thirds: B→A | Ring | Ring Hz. Double-click: harmonic ratio.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
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
  roundRect,
  strata,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 176;
const C = FC.fm;
const C_DEEP = bandShade(FC.mod, 0.22);
const C_MID = bandShade(FC.mod, 0.42);
const C_HOT = bandShade(FC.mod, 0.62);
const C_GLOW = bandShade(FC.mod, 0.92);
const C_AMT = bandShade(FC.mod, 0.5);
const C_RATIO = bandShade(FC.mod, 0.68);
const C_BA = bandShade(FC.mod, 0.78);
const C_RING = bandShade(FC.mod, 0.88);
const C_A = FC.oscA;
const C_B = FC.oscB;

const RATIO_MIN = 0.5;
const RATIO_MAX = 12;
const RING_MIN = 20;
const RING_MAX = 4000;

/** Ring frequency is absolute Hz; read it against a nominal carrier for the axis. */
const REF_HZ = 220;

const HARMONIC_CYCLE = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 7] as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

/** Deterministic per-partial jitter — a fixed field, so tips don't crawl idle. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function nearestHarmonic(ratio: number): (typeof HARMONIC_CYCLE)[number] {
  let best: (typeof HARMONIC_CYCLE)[number] = HARMONIC_CYCLE[0]!;
  let bestD = Infinity;
  for (const r of HARMONIC_CYCLE) {
    const d = Math.abs(Math.log2(ratio / r));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/**
 * Bessel-ish sideband envelope. Real J_k(I) migrates energy outward as the index
 * grows and hollows the carrier; a Gaussian centred on the index reproduces that
 * shape closely enough to read correctly and costs one exp.
 */
function sidebandAmp(k: number, index: number): number {
  if (k === 0) return 0.32 + 0.68 * Math.exp(-index * 0.42);
  // Small-index rise (J_k vanishes at I=0) × outward-migrating peak.
  const rise = Math.min(1, Math.pow(index / (k + 0.6), k * 0.55 + 0.7));
  const w = 0.85 + index * 0.55;
  const d = k - index * 0.82;
  return (rise * Math.exp(-(d * d) / (2 * w * w))) / (1 + k * 0.05);
}

type DragMode = "xy" | "ba" | "ringAmt" | "ringHz" | null;

export type FmVizState = { fm: number; ratio: number; bToA: number; ring: number; ringHz: number };

/**
 * Paint the sideband spectrum. Exported and pure so it renders headlessly
 * without mounting the component.
 */
export function paintFm(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: FmVizState,
  now: number,
  flash: number,
): void {
  const t = now / 1000;
  const fm = clamp(p.fm, 0, 1);
  const bToA = clamp(p.bToA, 0, 1);
  const ring = clamp(p.ring, 0, 1);
  const ratio = clamp(p.ratio, RATIO_MIN, RATIO_MAX);
  const ratioN = logNorm(p.ratio, RATIO_MIN, RATIO_MAX);
  const ringN = logNorm(p.ringHz, RING_MIN, RING_MAX);
  const isLive = fm > 0.02 || bToA > 0.02 || ring > 0.02;
  // Modulation index — B→A cross-feed stacks onto it, as it does in the DSP.
  const index = fm * (1 + bToA * 0.9) * 7.5;
  const energy = 0.14 + fm * 0.4 + bToA * 0.14 + ring * 0.24 + flash * 0.24;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.62 });
  strata(ctx, W, Hh, C_DEEP, { count: 5, horizon: 0.2, alpha: 0.08 });

  // ── geometry: spectrum floor left→right, scope pane parked on the right ──
  const scopeW = W > 400 ? Math.min(180, W * 0.16) : 0;
  const padL = 20;
  const specR = W - 14 - (scopeW > 0 ? scopeW + 12 : 0);
  const span = Math.max(80, specR - padL);
  const floorY = Hh - 58;
  const maxSpikeH = floorY - 34;

  // Order count and pixel spacing: the comb always fills the width it needs.
  const orders = Math.max(2, Math.min(16, Math.ceil(index * 1.5) + 2));
  const xC = padL + span * 0.5;
  const halfSpan = span * 0.5 - 8;
  const pxPerH = halfSpan / Math.max(1.7, ratio * (orders + 0.4));
  const xOf = (h: number) => xC + (h - 1) * pxPerH;

  // Floor + its reflection gradient.
  ctx.fillStyle = hexA(C_MID, 0.24);
  ctx.fillRect(padL, floorY, span, 1);

  /** One partial: stem, mirrored reflection, bright cap. */
  const spike = (x: number, a01: number, col: string, wide: number, folded: boolean) => {
    if (x < padL - 2 || x > specR + 2 || a01 <= 0.004) return;
    const hpx = Math.max(1, a01 * maxSpikeH);
    ctx.save();
    if (folded) {
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = hexA(col, 0.28 + a01 * 0.4);
      ctx.lineWidth = Math.max(1, wide * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, floorY);
      ctx.lineTo(x, floorY - hpx * 0.7);
      ctx.stroke();
    } else {
      ctx.fillStyle = hexA(col, 0.3 + a01 * 0.55);
      ctx.fillRect(x - wide * 0.5, floorY - hpx, wide, hpx);
      // Reflection below the floor — the spectrum sits on glass.
      ctx.globalAlpha = 0.22;
      ctx.fillRect(x - wide * 0.5, floorY + 1, wide, hpx * 0.34);
    }
    ctx.restore();
  };

  // ── the comb ──
  // Lower sidebands first (dimmer), then upper, then the carrier on top.
  let visible = 0;
  for (let k = orders; k >= 1; k--) {
    const a = sidebandAmp(k, index);
    if (a < 0.02) continue;
    visible++;
    const shimmer = 0.86 + 0.14 * Math.sin(t * (2.2 + k * 0.35) + hash01(k) * 6.28);
    const col = k % 2 === 0 ? C_HOT : C_RATIO;
    const hUp = 1 + k * ratio;
    const hDn = 1 - k * ratio;
    spike(xOf(hUp), a * shimmer, col, 3.5, false);
    if (hDn > 0) spike(xOf(hDn), a * shimmer * 0.94, col, 3.5, false);
    else spike(xOf(-hDn), a * shimmer * 0.55, C_MID, 3, true); // folded past DC
  }

  // Carrier — hollows out as the index climbs, which is the whole point.
  const aC = sidebandAmp(0, index);
  spike(xC, aC, C_GLOW, 5, false);

  // Ring mod: its own sum / difference pair, unrelated to the FM comb.
  if (ring > 0.02) {
    const hRing = clamp(p.ringHz / REF_HZ, 0.05, 24);
    const xs = xOf(1 + hRing);
    const xd = xOf(Math.abs(1 - hRing));
    spike(xs, ring * 0.9, C_RING, 4.5, false);
    spike(xd, ring * 0.78, C_RING, 4.5, false);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_RING, 0.85);
    if (xs > padL && xs < specR) ctx.fillText("Σ", xs, floorY - ring * 0.9 * maxSpikeH - 5);
    if (xd > padL && xd < specR) ctx.fillText("Δ", xd, floorY - ring * 0.78 * maxSpikeH - 5);
    lit(ctx, () => {
      drawGlow(ctx, xs, floorY - ring * 0.9 * maxSpikeH, 12 + ring * 14, C_RING, 0.4 + ring * 0.4);
      drawGlow(ctx, xd, floorY - ring * 0.78 * maxSpikeH, 12 + ring * 14, C_RING, 0.4 + ring * 0.4);
    });
  }

  // Caps + bloom on the loud partials.
  lit(ctx, () => {
    drawGlow(ctx, xC, floorY - aC * maxSpikeH, 16 + fm * 16 + flash * 10, C_GLOW, 0.6 + fm * 0.3);
    for (let k = 1; k <= orders; k++) {
      const a = sidebandAmp(k, index);
      if (a < 0.06) continue;
      const hUp = 1 + k * ratio;
      const hDn = 1 - k * ratio;
      const r = 6 + a * 16;
      const xu = xOf(hUp);
      if (xu > padL && xu < specR) drawGlow(ctx, xu, floorY - a * maxSpikeH, r, C_HOT, a * 0.7);
      if (hDn > 0) {
        const xdn = xOf(hDn);
        if (xdn > padL && xdn < specR) drawGlow(ctx, xdn, floorY - a * maxSpikeH, r, C_HOT, a * 0.6);
      }
    }
  });

  // ── frequency ruler ──
  const xDC = xOf(0);
  if (xDC > padL - 1) {
    ctx.save();
    ctx.setLineDash([1, 3]);
    ctx.strokeStyle = hexA(C_MID, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xDC, 32);
    ctx.lineTo(xDC, floorY + 8);
    ctx.stroke();
    ctx.restore();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_MID, 0.6);
    ctx.fillText("DC", xDC, floorY + 17);
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_GLOW, 0.8);
  ctx.fillText("fc", xC, floorY + 17);
  const xUp1 = xOf(1 + ratio);
  const xDn1 = xOf(1 - ratio);
  ctx.fillStyle = hexA(C_RATIO, 0.7);
  if (xUp1 < specR - 8) ctx.fillText(`+${ratio.toFixed(2)}`, xUp1, floorY + 17);
  if (xDn1 > padL + 12) ctx.fillText(`−${ratio.toFixed(2)}`, xDn1, floorY + 17);

  // Index bracket over the comb — how far the energy has spread.
  const bracketY = 30;
  const bx0 = Math.max(padL, xOf(1 - Math.min(orders, index * 1.1) * ratio));
  const bx1 = Math.min(specR, xOf(1 + Math.min(orders, index * 1.1) * ratio));
  ctx.strokeStyle = hexA(C_AMT, 0.3 + fm * 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx0, bracketY + 4);
  ctx.lineTo(bx0, bracketY);
  ctx.lineTo(bx1, bracketY);
  ctx.lineTo(bx1, bracketY + 4);
  ctx.stroke();
  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_AMT, 0.8);
  ctx.fillText(`I ${index.toFixed(2)} · ${visible} SB`, (bx0 + bx1) * 0.5, bracketY - 3);

  // ── B→A cross-feed: a return path folded back under the comb ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  if (bToA > 0.02) {
    const ay = floorY + 26;
    const ax0 = padL + 6;
    const ax1 = padL + 6 + Math.min(span * 0.4, 40 + bToA * 120);
    const cross = cachedGrad(ctx, `fmba|${(ax0 / 8) | 0}|${(ax1 / 8) | 0}`, (c) => {
      const g = c.createLinearGradient(ax0, 0, ax1, 0);
      g.addColorStop(0, hexA(C_B, 0.85));
      g.addColorStop(1, hexA(C_A, 0.9));
      return g;
    });
    glowStroke(
      ctx,
      () => {
        ctx.moveTo(ax0, ay);
        ctx.bezierCurveTo(ax0 + (ax1 - ax0) * 0.35, ay + 10, ax1 - (ax1 - ax0) * 0.35, ay - 10, ax1, ay);
      },
      C_BA,
      { width: 1.4 + bToA * 2.2, glow: 0.6 + bToA, alpha: 0.85 },
    );
    ctx.strokeStyle = cross;
    ctx.lineWidth = 1 + bToA * 1.6;
    ctx.beginPath();
    ctx.moveTo(ax0, ay);
    ctx.bezierCurveTo(ax0 + (ax1 - ax0) * 0.35, ay + 10, ax1 - (ax1 - ax0) * 0.35, ay - 10, ax1, ay);
    ctx.stroke();
    ctx.fillStyle = hexA(C_B, 0.9);
    ctx.beginPath();
    ctx.arc(ax0, ay, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(C_A, 0.95);
    ctx.beginPath();
    ctx.arc(ax1, ay, 3 + flash, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(C_BA, 0.85);
    ctx.fillText(`B→A ${Math.round(bToA * 100)}`, ax1 + 6, ay + 3);
  }

  // ── scope pane: the warped waveform the comb corresponds to ──
  if (scopeW > 0) {
    const sx0 = W - 14 - scopeW;
    const sy0 = 30;
    const sh = floorY - 36 - sy0 + 20;
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    roundRect(ctx, sx0, sy0, scopeW, sh, 5);
    ctx.fill();
    ctx.strokeStyle = hexA(C_MID, 0.28);
    ctx.lineWidth = 1;
    roundRect(ctx, sx0 + 0.5, sy0 + 0.5, scopeW - 1, sh - 1, 5);
    ctx.stroke();
    const smid = sy0 + sh * 0.5;
    ctx.fillStyle = hexA(C_MID, 0.2);
    ctx.fillRect(sx0 + 4, smid, scopeW - 8, 1);
    const samp = Math.max(24, Math.floor(scopeW - 8));
    const wave = () => {
      for (let i = 0; i <= samp; i++) {
        const u = i / samp;
        const ph = u * Math.PI * 2 * 2 + t * 1.4;
        const mod = Math.sin(ph * ratio) * index * 0.32;
        let v = Math.sin(ph + mod);
        if (ring > 0.02) {
          const rr = Math.sin(ph * clamp(p.ringHz / REF_HZ, 0.05, 24));
          v = v * (1 - ring) + v * rr * ring;
        }
        const x = sx0 + 4 + u * (scopeW - 8);
        const y = smid - v * (sh * 0.36);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    lit(ctx, () => {
      glowStroke(ctx, wave, C_GLOW, { width: 1.6, glow: 0.6 + fm * 0.6, alpha: 0.8 });
    });
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_MID, 0.6);
    ctx.fillText("WAVE", sx0 + 5, sy0 - 3);
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(ring > 0.02 ? C_RING : C_MID, 0.65);
    ctx.fillText(ring > 0.02 ? `RING ${Math.round(p.ringHz)}Hz` : "DRY", sx0 + scopeW - 4, sy0 - 3);
  }

  // Ratio / amount crosshair — matches the drag mapping.
  const hx = ratioN * W;
  const hy = (1 - fm) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  const harm = nearestHarmonic(ratio);
  const near = Math.abs(Math.log2(ratio / harm)) < 0.08;
  pill(ctx, W * 0.5, 3, near ? `${harm}×` : `${ratio.toFixed(2)}×`, near ? C_GLOW : C_MID, { glow: flash });

  // ── bottom rail: B→A | Ring | Hz ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  const zoneW = railW / 3;
  for (let i = 0; i < 3; i++) {
    const label = i === 0 ? "B→A" : i === 1 ? "RING" : "Hz";
    const v = i === 0 ? bToA : i === 1 ? ring : ringN;
    const col = i === 0 ? C_BA : i === 1 ? C_RING : C_HOT;
    const x0 = railX + i * zoneW;
    const w = zoneW - 4;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(x0, railY, w, 7);
    ctx.strokeStyle = hexA(col, 0.22 + v * 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, railY + 0.5, w - 1, 6);
    if (v > 0.02) {
      ctx.fillStyle = hexA(col, 0.5 + v * 0.35);
      ctx.fillRect(x0 + 1, railY + 1, Math.max(2, (w - 2) * v), 5);
    }
    const thumbX = x0 + 1 + (w - 2) * v;
    lit(ctx, () => drawGlow(ctx, thumbX, railY + 3.5, 7 + flash * 4, C_GLOW, 0.75));
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(col, 0.8);
    ctx.fillText(label, x0 + 2, railY - 4);
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(col, 0.62);
    ctx.fillText(
      i === 0 ? `${Math.round(bToA * 100)}` : i === 1 ? `${Math.round(ring * 100)}` : `${Math.round(p.ringHz)}`,
      x0 + w - 2,
      railY - 4,
    );
  }

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "FM · SIDEBAND FORGE",
    !isLive
      ? "IDLE"
      : `I${Math.round(fm * 100)} · ${ratio.toFixed(2)}×${bToA > 0.02 ? ` · B→A${Math.round(bToA * 100)}` : ""}${ring > 0.02 ? ` · R${Math.round(p.ringHz)}` : ""}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function FmStageViz() {
  const fm = useFireCommandStore((s) => s.patch.fmAmount) ?? 0;
  const ratio = useFireCommandStore((s) => s.patch.fmRatio) ?? 2;
  const bToA = useFireCommandStore((s) => s.patch.fmBtoA) ?? 0;
  const ring = useFireCommandStore((s) => s.patch.ringAmount) ?? 0;
  const ringHz = useFireCommandStore((s) => s.patch.ringFreq) ?? 220;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<FmVizState>({ fm, ratio, bToA, ring, ringHz });
  st.current = { fm, ratio, bToA, ring, ringHz };

  const live = fm > 0.02 || bToA > 0.02 || ring > 0.02;

  useEffect(() => {
    const key = motionHash(fm, ratio, bToA, ring, ringHz);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [fm, ratio, bToA, ring, ringHz]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("fmRatio", Math.round(logLerp(x, RATIO_MIN, RATIO_MAX) * 100) / 100);
      setParam("fmAmount", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyRail = useCallback(
    (clientX: number, mode: Exclude<DragMode, "xy" | null>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      if (mode === "ba") {
        // First third local X
        const local = clamp((x - 0) / 0.33, 0, 1);
        setParam("fmBtoA", Math.round(local * 1000) / 1000);
      } else if (mode === "ringAmt") {
        const local = clamp((x - 0.33) / 0.34, 0, 1);
        setParam("ringAmount", Math.round(local * 1000) / 1000);
      } else {
        const local = clamp((x - 0.67) / 0.33, 0, 1);
        setParam("ringFreq", Math.round(logLerp(local, RING_MIN, RING_MAX)));
      }
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (y > H * 0.78) {
        const mode: DragMode = x < 0.33 ? "ba" : x < 0.67 ? "ringAmt" : "ringHz";
        dragRef.current = mode;
        wrap.setPointerCapture(e.pointerId);
        applyRail(e.clientX, mode);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyRail, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const m = dragRef.current;
      if (m === "xy") applyXy(e.clientX, e.clientY);
      else if (m) applyRail(e.clientX, m);
    },
    [applyXy, applyRail],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const cur = nearestHarmonic(st.current.ratio);
    const i = HARMONIC_CYCLE.indexOf(cur);
    const next = HARMONIC_CYCLE[(i + 1) % HARMONIC_CYCLE.length]!;
    setParam("fmRatio", next);
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
        paintFm(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          (st.current.fm ?? 0) > 0.02 ||
          (st.current.bToA ?? 0) > 0.02 ||
          (st.current.ring ?? 0) > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.fm,
          st.current.ratio,
          st.current.bToA,
          st.current.ring,
          st.current.ringHz,
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
      title="Drag: Ratio ↔ / Amount ↕ · Bottom: B→A | Ring | Hz · Double-click: next harmonic"
      role="img"
      aria-label="FM sideband forge"
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
        Sideband Forge
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        {live ? `${ratio.toFixed(2)}×` : "IDLE"}
      </div>
    </div>
  );
}

/** Alias for older imports */
export { FmStageViz as FmRingStageViz };
