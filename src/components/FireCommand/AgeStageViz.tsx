/**
 * Age — Oxide Archive stage visualizer.
 *
 * IDIOM: oxide strata. Stages are a ~10:1 letterbox, which is the exact shape of
 * a length of tape, so the panel is one: a horizontal band of programme material
 * running left → right, its centreline wavering with wow and flutter, with older
 * generations layered behind it as progressively dimmer, more damaged strata.
 * Dust, hiss and dropouts scatter along the width; bit depth and sample-rate
 * reduction quantize the band's own edge into visible steps.
 *
 * Everything scattered is hashed from its index, so the archive is a fixed piece
 * of damaged media that transports — not static that reshuffles every frame.
 *
 * Tape · VHS · bit · BBD · beds (Signal Path FX · FC.vintage).
 * Drag: Cass ↔ / Wow ↕. Bottom: Speed. Double-click: cycle bit depth.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FireBitDepth } from "@/audio/dsp/FireCommandSynth";
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
  scanlines,
  strata,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 188;
const C = FC.vintage;
const C_DEEP = bandShade(FC.fx, 0.22);
const C_MID = bandShade(FC.fx, 0.42);
const C_HOT = bandShade(FC.fx, 0.58);
const C_GLOW = bandShade(FC.fx, 0.88);
const C_CASS = bandShade(FC.fx, 0.38);
const C_WOW = bandShade(FC.fx, 0.5);
const C_VHS = bandShade(FC.fx, 0.62);
const C_BIT = bandShade(FC.fx, 0.72);
const C_BED = bandShade(FC.fx, 0.82);
const C_BBD = bandShade(FC.fx, 0.68);
const C_SPEED = bandShade(FC.fx, 0.45);

const BIT_CYCLE: FireBitDepth[] = ["off", "12bit", "8bit"];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic scatter — the damage is a fixed property of the tape. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Scratch for the frame's open dropouts — resolved once, then read hundreds of
// times while tracing the band contour.
const DROP_MAX = 12;
const DROP_X = new Float32Array(DROP_MAX);
const DROP_W = new Float32Array(DROP_MAX);
const DROP_LIFE = new Float32Array(DROP_MAX);

type DragMode = "xy" | "speed" | null;

export type AgeVizState = {
  cass: number;
  speed: number;
  wow: number;
  vhs: number;
  bit: FireBitDepth;
  srr: number;
  bbd: number;
  comp: number;
  dust: number;
  hiss: number;
  hum: number;
  print: number;
  evolve: number;
};

/** Quantization step count implied by bit depth + sample-rate reduction. */
function stepCount(bit: FireBitDepth, srr: number): number {
  if (bit === "8bit") return 7;
  if (bit === "12bit") return 13;
  if (srr > 0.04) return Math.max(4, Math.round(22 - srr * 17));
  return 0;
}

/**
 * Paint the archive. Exported and pure — a headless render of the same state at
 * the same `now` produces the same frame, dust and dropouts included.
 */
export function paintAge(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: AgeVizState,
  now: number,
  flash: number,
): void {
  const beds = Math.max(p.dust, p.hiss, p.hum, p.print);
  const evolve = clamp(p.evolve ?? 0, 0, 1);
  const wowEff = clamp(p.wow + evolve * 0.08, 0, 1);
  const heat = Math.max(
    p.cass, wowEff, p.vhs, beds, p.srr, p.bbd, p.comp, Math.abs(p.speed), evolve,
    p.bit !== "off" ? 0.35 : 0,
  );
  const isLive = heat > 0.03;
  const speedN = (p.speed + 1) * 0.5;
  const energy = 0.1 + heat * 0.4 + flash * 0.2;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  // ── geometry: one length of tape across the whole width ──
  const padL = 24;
  const padR = 20;
  const spanW = Math.max(80, W - padL - padR);
  const top = 34;
  const bot = 126;
  const midY = (top + bot) * 0.5;
  const halfH = (bot - top) * 0.5;
  const floorY = 142;

  // Transport: tape speed scrolls the whole texture, and reverses under it.
  const transport = now * 0.012 * (0.25 + p.cass * 0.5 + p.speed * 0.9);
  const steps = stepCount(p.bit, p.srr);

  // Archive shelving behind the tape — quiet horizontal strata, one per dub.
  const gens = 1 + Math.round(p.cass * 4 + evolve * 1.5);
  strata(ctx, W, Hh, C_DEEP, { count: 3 + gens, horizon: 0.2, alpha: 0.06 + p.cass * 0.06 });

  /** Centreline at x: wow is the slow drift, flutter the fast tremble. */
  const centre = (x: number, gen: number): number => {
    const u = x / Math.max(1, W);
    const wowA = (1.2 + wowEff * 9) * (1 + gen * 0.5);
    const flutA = (0.4 + wowEff * 3.2) * (1 + gen * 0.6);
    return (
      midY
      + Math.sin(u * 5.1 + now * 0.0009 * (0.5 + wowEff * 2) + gen * 1.7) * wowA
      + Math.sin(u * 27 + now * 0.0062 * (0.4 + wowEff * 3)) * flutA
      + Math.sin(u * 2.3 + now * 0.0004) * evolve * 4
    );
  };

  /** Half-thickness of the band at x — the programme material's envelope. */
  const amp = (x: number, gen: number): number => {
    const u = x / Math.max(1, W);
    const env =
      0.42
      + 0.3 * Math.sin(u * 9.4 - transport * 0.06)
      + 0.16 * Math.sin(u * 23.7 - transport * 0.11 + 1.3)
      + 0.1 * Math.sin(u * 51 - transport * 0.2);
    // Compression squashes the peaks and lifts the floor.
    const comped = 0.5 + (clamp(env, 0.05, 1) - 0.5) * (1 - p.comp * 0.6) + p.comp * 0.12;
    let a = comped * halfH * 0.78 * (1 - gen * 0.16);
    // Bit depth / SRR land on the edge itself: the contour walks in stairs.
    if (steps > 0) a = Math.round((a / halfH) * steps) / steps * halfH;
    return Math.max(1.5, a);
  };

  // Dropouts: deterministic slots that open and heal on their own cycles.
  // Resolved once per frame — the band contour is sampled hundreds of times and
  // must not re-roll the whole slot table at every sample.
  const DROP_SLOTS = 26;
  const dropChance = 0.05 + p.dust * 0.35 + wowEff * 0.12 + evolve * 0.28;
  let dropN = 0;
  for (let s = 0; s < DROP_SLOTS && dropN < DROP_MAX; s++) {
    if (hash01(s * 4.77) > dropChance) continue;
    const phase = (now * 0.00013 * (0.4 + hash01(s * 8.3)) + hash01(s * 1.9)) % 1;
    if (phase > 0.34) continue;
    DROP_X[dropN] = padL + hash01(s * 3.31) * spanW;
    DROP_W[dropN] = (0.004 + hash01(s * 6.1) * 0.02) * (0.5 + p.dust) * spanW;
    DROP_LIFE[dropN] = 1 - phase / 0.34;
    dropN++;
  }
  const dropAt = (x: number): number => {
    let cut = 0;
    for (let i = 0; i < dropN; i++) {
      const d = Math.abs(x - DROP_X[i]!);
      const w = DROP_W[i]!;
      if (d < w) {
        const v = 1 - d / w;
        if (v > cut) cut = v;
      }
    }
    return cut;
  };

  const SEGS = Math.max(70, Math.min(220, Math.round(spanW / 9)));
  const GHOST_SEGS = Math.max(28, SEGS >> 2);

  /** One generation of the band: older gens sit behind, dimmer and looser. */
  const drawGeneration = (gen: number, alpha: number, color: string, segs: number) => {
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const x = padL + (i / segs) * spanW;
      ctx.lineTo(x, centre(x, gen) - amp(x, gen));
    }
    for (let i = segs; i >= 0; i--) {
      const x = padL + (i / segs) * spanW;
      ctx.lineTo(x, centre(x, gen) + amp(x, gen) * 0.9);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(color, alpha);
    ctx.fill();
  };

  // Older generations first — the stack of dubs behind the current one.
  for (let g = gens; g >= 1; g--) {
    drawGeneration(g, (0.05 + p.cass * 0.1) * (1 - g / (gens + 1)), C_CASS, GHOST_SEGS);
  }

  // Print-through: the ghost the next wrap of tape picked up.
  if (p.print > 0.05) {
    ctx.save();
    ctx.translate(-8 - p.print * 14, 6);
    drawGeneration(0.5, 0.05 + p.print * 0.16, C_BED, GHOST_SEGS);
    ctx.restore();
  }

  // BBD chorus: bucket-brigade copies smeared slightly off the master.
  if (p.bbd > 0.05) {
    for (let g = 1; g <= 2; g++) {
      const off = Math.sin(now * 0.0013 * g + g) * (2 + p.bbd * 9);
      ctx.save();
      ctx.translate(off, g * 2.2);
      ctx.beginPath();
      for (let i = 0; i <= SEGS; i++) {
        const x = padL + (i / SEGS) * spanW;
        if (i === 0) ctx.moveTo(x, centre(x, 0) - amp(x, 0) * (0.9 - g * 0.12));
        else ctx.lineTo(x, centre(x, 0) - amp(x, 0) * (0.9 - g * 0.12));
      }
      ctx.strokeStyle = hexA(C_BBD, 0.1 + p.bbd * 0.3);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Stable reference line — what the tape would have been without transport wow.
  ctx.strokeStyle = hexA(C_MID, 0.24);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, midY);
  ctx.lineTo(padL + spanW, midY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MID, 0.55);
  ctx.fillText("REF", padL, midY - 5);

  // Quantization ladder — the levels the edge is snapping to.
  if (steps > 0) {
    ctx.strokeStyle = hexA(C_BIT, 0.08 + (p.srr + (p.bit !== "off" ? 0.3 : 0)) * 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 1; s <= steps; s++) {
      const dy = (s / steps) * halfH * 0.78;
      ctx.moveTo(padL, midY - dy);
      ctx.lineTo(padL + spanW, midY - dy);
      ctx.moveTo(padL, midY + dy * 0.9);
      ctx.lineTo(padL + spanW, midY + dy * 0.9);
    }
    ctx.stroke();
  }

  // The master band.
  const bandGrad = cachedGrad(ctx, `oxide|${top}|${bot}`, (c) => {
    const g = c.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, hexA(C_HOT, 0.5));
    g.addColorStop(0.5, hexA(C_GLOW, 0.72));
    g.addColorStop(1, hexA(C_CASS, 0.42));
    return g;
  });
  ctx.beginPath();
  for (let i = 0; i <= SEGS; i++) {
    const x = padL + (i / SEGS) * spanW;
    const a = amp(x, 0) * (1 - dropAt(x));
    ctx.lineTo(x, centre(x, 0) - a);
  }
  for (let i = SEGS; i >= 0; i--) {
    const x = padL + (i / SEGS) * spanW;
    const a = amp(x, 0) * (1 - dropAt(x)) * 0.9;
    ctx.lineTo(x, centre(x, 0) + a);
  }
  ctx.closePath();
  ctx.save();
  ctx.globalAlpha = 0.34 + (1 - p.comp * 0.3) * 0.28;
  ctx.fillStyle = bandGrad;
  ctx.fill();
  ctx.restore();

  // Lit edge — the crisp oxide contour, stepped wherever the bits ran out.
  glowStroke(
    ctx,
    () => {
      for (let i = 0; i <= SEGS; i++) {
        const x = padL + (i / SEGS) * spanW;
        const a = amp(x, 0) * (1 - dropAt(x));
        if (i === 0) ctx.moveTo(x, centre(x, 0) - a);
        else ctx.lineTo(x, centre(x, 0) - a);
      }
    },
    C_GLOW,
    { width: 1.6 + p.cass * 1.2, glow: 0.5 + heat * 0.7, alpha: 0.45 + p.cass * 0.4 },
  );

  // Compression brackets — the ceiling the band is being held under.
  if (p.comp > 0.08) {
    const squeeze = halfH * 0.78 * (1 - p.comp * 0.45);
    ctx.strokeStyle = hexA(C_HOT, 0.2 + p.comp * 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, midY - squeeze);
    ctx.lineTo(padL + spanW, midY - squeeze);
    ctx.moveTo(padL, midY + squeeze * 0.9);
    ctx.lineTo(padL + spanW, midY + squeeze * 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Hum: mains bars standing across the width, breathing at their own rate.
  if (p.hum > 0.05) {
    ctx.strokeStyle = hexA(C_MID, 0.08 + p.hum * 0.24);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const y = top + 6 + i * ((bot - top - 12) / 3) + Math.sin(now * 0.003 + i) * p.hum * 3;
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + spanW, y);
    }
    ctx.stroke();
  }

  // VHS: scanline comb plus head-switching tears near the bottom of the band.
  if (p.vhs > 0.02) {
    scanlines(ctx, W, Hh, 0.03 + p.vhs * 0.16, 3);
    const tears = Math.round(p.vhs * 5);
    for (let i = 0; i < tears; i++) {
      const phase = (now * 0.0004 * (0.5 + hash01(i * 7.7)) + hash01(i * 2.3)) % 1;
      const y = top + phase * (bot - top);
      const shift = (hash01(i * 5.9) - 0.5) * p.vhs * 26;
      ctx.fillStyle = hexA(C_VHS, 0.06 + p.vhs * 0.18);
      ctx.fillRect(shift, y, W, 1 + p.vhs * 3);
    }
  }

  // Dropout scars — mark where the oxide actually let go.
  for (let i = 0; i < dropN; i++) {
    const life = DROP_LIFE[i]!;
    const x = DROP_X[i]!;
    const w = DROP_W[i]!;
    ctx.fillStyle = hexA(C_DEEP, 0.3 * life);
    ctx.fillRect(x - w, top, w * 2, bot - top);
    ctx.fillStyle = hexA(C_HOT, 0.22 * life);
    ctx.fillRect(x - w, top, 1, bot - top);
    ctx.fillRect(x + w, top, 1, bot - top);
  }

  // Dust: specks embedded in the emulsion, transporting with the tape.
  if (p.dust > 0.02) {
    const n = Math.round(20 + p.dust * 90);
    for (let i = 0; i < n; i++) {
      const x = (hash01(i * 1.73) * spanW + transport * 2.4) % spanW;
      const y = top + hash01(i * 3.91) * (bot - top);
      const sz = 1 + hash01(i * 7.13) * 2.4 * p.dust;
      ctx.fillStyle = hexA(C_BED, 0.14 + p.dust * 0.5 * hash01(i * 11.3));
      ctx.fillRect(padL + x, y, sz, sz);
    }
  }

  // Hiss: the fine bed, twinkling rather than drifting.
  if (p.hiss > 0.04) {
    const n = Math.round(p.hiss * 140);
    for (let i = 0; i < n; i++) {
      const x = padL + hash01(i * 2.11) * spanW;
      const y = top + hash01(i * 5.37) * (bot - top);
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.008 + i * 1.7));
      ctx.fillStyle = hexA(C_GLOW, (0.05 + p.hiss * 0.3) * tw);
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  // ── noise floor + telemetry ──
  ctx.fillStyle = hexA(C_BED, 0.2);
  ctx.fillRect(padL, floorY, spanW, 1);
  {
    const tickN = Math.round(14 + (p.dust + p.hiss + p.hum) * 40);
    ctx.fillStyle = hexA(C_BED, 0.16 + (p.dust + p.hiss) * 0.3);
    for (let i = 0; i < tickN; i++) {
      const x = padL + 84 + ((hash01(i * 1.37) * (spanW - 90) + transport) % Math.max(1, spanW - 90));
      const h = 1.5 + hash01(i * 4.9) * 6 * (0.3 + p.dust + p.hiss);
      ctx.fillRect(x, floorY - h, 1, h);
    }
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_BED, 0.5 + beds * 0.35);
  ctx.fillText("NOISE FLOOR", 12, floorY - 1);

  ctx.fillStyle = hexA(C_CASS, 0.68);
  ctx.fillText(`GEN ${gens}`, padL, 30);
  ctx.fillStyle = hexA(C_WOW, 0.66);
  ctx.fillText(`WOW ${Math.round(p.wow * 100)}`, padL + 62, 30);
  ctx.fillStyle = hexA(C_BIT, 0.66);
  ctx.fillText(steps > 0 ? `${p.bit === "off" ? "SRR" : p.bit.toUpperCase()} ${steps}L` : "FULL RATE", padL + 142, 30);
  ctx.fillStyle = hexA(C_VHS, 0.62);
  ctx.fillText(`VHS ${Math.round(p.vhs * 100)}`, padL + 232, 30);
  ctx.fillStyle = hexA(C_BBD, 0.62);
  ctx.fillText(`BBD ${Math.round(p.bbd * 100)}`, padL + 300, 30);
  ctx.fillStyle = hexA(C_HOT, 0.62);
  ctx.fillText(`COMP ${Math.round(p.comp * 100)}`, padL + 368, 30);
  ctx.fillStyle = hexA(C_BED, 0.62);
  ctx.fillText(`EVO ${Math.round(evolve * 100)}`, padL + 444, 30);

  // Cass / Wow crosshair (the drag target).
  const hx = p.cass * W;
  const hy = (1 - p.wow) * (Hh * 0.68);
  ctx.strokeStyle = hexA(C_GLOW, 0.3 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy);
  ctx.lineTo(hx + 7, hy);
  ctx.moveTo(hx, hy - 7);
  ctx.lineTo(hx, hy + 7);
  ctx.stroke();

  const chip =
    !isLive ? "CLEAN"
    : p.bit !== "off" ? p.bit.toUpperCase()
    : p.vhs > 0.4 ? "VHS"
    : p.bbd > 0.4 ? "BBD"
    : p.cass > 0.2 ? "TAPE" : "AGED";
  pill(ctx, W * 0.5, 3, chip, C_GLOW, { glow: flash });

  // Speed rail (bipolar around a centre detent).
  const railY = Hh - 26;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 6);
  ctx.fillStyle = hexA(C_MID, 0.4);
  ctx.fillRect(W * 0.5 - 0.5, railY, 1, 6);
  const thumbX = 12 + railW * speedN;
  if (p.speed !== 0) {
    const from = Math.min(W * 0.5, thumbX);
    const to = Math.max(W * 0.5, thumbX);
    ctx.fillStyle = hexA(C_SPEED, 0.4 + Math.abs(p.speed) * 0.35);
    ctx.fillRect(from, railY + 1, Math.max(2, to - from), 4);
  }
  lit(ctx, () => drawGlow(ctx, thumbX, railY + 3, 7 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_SPEED, 0.82);
  const spdLabel = p.speed === 0 ? "0" : `${p.speed > 0 ? "+" : ""}${Math.round(p.speed * 100)}`;
  ctx.fillText(`SPEED ${spdLabel}`, 14, railY - 3);

  grain(ctx, W, Hh, 0.032 + heat * 0.03);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "AGE · OXIDE ARCHIVE",
    !isLive
      ? "CLEAN"
      : `C${Math.round(p.cass * 100)} · W${Math.round(p.wow * 100)} · ${p.bit === "off" ? "FULL" : p.bit}`,
    C_GLOW,
    isLive ? C_HOT : C_MID,
  );
}

export function AgeStageViz() {
  const cass = useFireCommandStore((s) => s.patch.cassetteGen) ?? 0;
  const speed = useFireCommandStore((s) => s.patch.tapeSpeed) ?? 0;
  const wow = useFireCommandStore((s) => s.patch.wowFlutter) ?? 0;
  const vhs = useFireCommandStore((s) => s.patch.vhsColor) ?? 0;
  const bit = (useFireCommandStore((s) => s.patch.bitDepth) ?? "off") as FireBitDepth;
  const srr = useFireCommandStore((s) => s.patch.sampleRateReduce) ?? 0;
  const bbd = useFireCommandStore((s) => s.patch.bbdChorus) ?? 0;
  const comp = useFireCommandStore((s) => s.patch.analogComp) ?? 0;
  const dust = useFireCommandStore((s) => s.patch.dust) ?? 0;
  const hiss = useFireCommandStore((s) => s.patch.hiss) ?? 0;
  const hum = useFireCommandStore((s) => s.patch.hum) ?? 0;
  const print = useFireCommandStore((s) => s.patch.printThrough) ?? 0;
  const ageEvolve = useFireCommandStore((s) => s.patch.ageEvolve) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);
  const st = useRef<AgeVizState>({
    cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print, evolve: ageEvolve,
  });
  st.current = { cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print, evolve: ageEvolve };

  const heat = Math.max(cass, wow, vhs, dust, hiss, hum, print, srr, bbd, comp, Math.abs(speed), ageEvolve, bit !== "off" ? 0.35 : 0);
  const live = heat > 0.03;

  useEffect(() => {
    const key = motionHash(
      cass, speed, wow, vhs, BIT_CYCLE.indexOf(bit), srr, bbd, comp, dust, hiss, hum, print, ageEvolve,
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print, ageEvolve]);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("cassetteGen", Math.round(x * 1000) / 1000);
      setParam("wowFlutter", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applySpeed = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("tapeSpeed", Math.round((x * 2 - 1) * 1000) / 1000);
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
        dragRef.current = "speed";
        wrap.setPointerCapture(e.pointerId);
        applySpeed(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applySpeed, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "speed") applySpeed(e.clientX);
    },
    [applyXy, applySpeed],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const i = BIT_CYCLE.indexOf(st.current.bit);
    setParam("bitDepth", BIT_CYCLE[(i + 1) % BIT_CYCLE.length]!);
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
        paintAge(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          Math.max(
            st.current.cass,
            st.current.wow,
            st.current.vhs,
            st.current.dust,
            st.current.hiss,
            st.current.hum,
            st.current.print,
            st.current.srr,
            st.current.bbd,
            st.current.comp,
            Math.abs(st.current.speed),
            st.current.evolve,
            st.current.bit !== "off" ? 0.35 : 0,
          ) > 0.03,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.cass,
          st.current.speed,
          st.current.wow,
          st.current.vhs,
          BIT_CYCLE.indexOf(st.current.bit),
          st.current.srr,
          st.current.bbd,
          st.current.comp,
          st.current.dust,
          st.current.hiss,
          st.current.hum,
          st.current.print,
          st.current.evolve,
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
      title="Drag: Cass ↔ / Wow ↕ · Bottom: Speed · Double-click: cycle bit depth"
      role="img"
      aria-label="Age oxide archive"
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
        Oxide Archive
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? (bit !== "off" ? bit : "AGED") : "CLEAN"}
      </div>
    </div>
  );
}

/** Alias for FxStageViz re-export compatibility. */
export const VintageAgeStageViz = AgeStageViz;
