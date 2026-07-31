/**
 * FM Rack · Vector — Vector Lattice stage visualizer.
 *
 * IDIOM: the operator graph. Every other stage here is a curve; this one is a
 * *diagram*, and that is its identity. The four operators are laid out by their
 * position in the algorithm — modulators upstream on the left, the carrier last
 * on the right, feeding an output bus — which turns the 10:1 letterbox into
 * exactly the right frame for a signal-flow chart. Edges run left→right, so the
 * whole width is used to say who modulates whom.
 *
 * Node brightness and size read operator level, edge thickness reads how hard
 * that operator drives its target, the carrier carries the feedback loop, and
 * operators the current algorithm doesn't patch are drawn dashed and off to the
 * side — so switching algorithm visibly rewires the picture. The vector pad
 * sits on the output side, drawn at exactly the geometry the pointer maps to.
 *
 * Drag pad: fmVector X/Y (corner morph). Drag nodes: Level ↕ / Ratio ↔ (Op2–4).
 * Bottom: Feedback. Double-click: next alg.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FmEngineMode } from "@/audio/dsp/FireCommandSynth";
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
  lattice,
  lit,
  motionHash,
  pill,
  plate,
  roundRect,
  VIZ_FONT_LABEL,
  VIZ_FONT_TITLE,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 188;
const C = FC.fmRack;
const C_DEEP = bandShade(FC.mod, 0.26);
const C_MID = bandShade(FC.mod, 0.48);
const C_HOT = bandShade(FC.mod, 0.66);
const C_GLOW = bandShade(FC.mod, 0.94);
const C_FB = bandShade(FC.mod, 0.72);
const C_VEC = bandShade(FC.mod, 0.82);
const C_OP = [
  bandShade(FC.mod, 0.95),
  bandShade(FC.mod, 0.75),
  bandShade(FC.mod, 0.58),
  bandShade(FC.mod, 0.42),
] as const;

const RATIO_MIN = 0.25;
const RATIO_MAX = 16;

/** Alg 0–3 ≈ serial-ish stacks; Alg 4–7 ≈ parallel-ish blends (matches DSP). */
const ALG_ROUTES: Record<number, Array<[number, number]>> = {
  0: [[1, 0]], // serial stack
  1: [[2, 1], [1, 0]],
  2: [[1, 0], [2, 0]],
  3: [[3, 2], [2, 1], [1, 0]],
  4: [[2, 1], [3, 1], [1, 0]], // parallel-ish
  5: [[1, 0], [2, 0], [3, 0]],
  6: [[3, 2], [2, 0], [1, 0]],
  7: [[3, 0], [2, 0], [1, 0]],
};

const ALG_NAMES = [
  "Ser·Stack1",
  "Ser·Stack2",
  "Ser·Twin",
  "Ser·Cascade",
  "Par·Fork",
  "Par·Parallel",
  "Par·Branch",
  "Par·All→C",
] as const;

/** Scratch node geometry for the paint pass — never allocated per frame. */
const NODE_SCRATCH: number[] = [];
/** Column depth per operator, reused across passes. */
const DEPTH = new Int8Array(4);
const COL_COUNT = new Int8Array(6);
const COL_SEEN = new Int8Array(6);

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

type DragMode = "vec" | "fb" | "op" | null;

type OpKey = "fmOp1Level" | "fmOp2Level" | "fmOp3Level" | "fmOp4Level";
type RatioKey = "fmOp2Ratio" | "fmOp3Ratio" | "fmOp4Ratio";

const OP_LEVEL_KEYS: OpKey[] = ["fmOp1Level", "fmOp2Level", "fmOp3Level", "fmOp4Level"];
const OP_RATIO_KEYS: (RatioKey | null)[] = [null, "fmOp2Ratio", "fmOp3Ratio", "fmOp4Ratio"];

export type FmRackVizState = {
  engine: FmEngineMode;
  alg: number;
  feedback: number;
  op1: number;
  op2: number;
  op3: number;
  op4: number;
  r2: number;
  r3: number;
  r4: number;
  vecRate: number;
  vecDepth: number;
  fmVecX: number;
  fmVecY: number;
  /** Which node the pointer last grabbed — pointer state, not patch state. */
  focus: number;
};

/**
 * Node geometry as [x, y, r] × 4, written into `out`.
 *
 * Exported and pure so the pointer hit-test resolves against exactly the same
 * layout the paint drew, without either side owning the other's state.
 */
export function layoutFmOps(W: number, Hh: number, p: FmRackVizState, out: number[]): void {
  const algI = Math.round(clamp(p.alg, 0, 7));
  const routes = ALG_ROUTES[algI] ?? ALG_ROUTES[0]!;

  // Column = distance from the carrier along the modulation chain.
  DEPTH[0] = 0;
  DEPTH[1] = -1;
  DEPTH[2] = -1;
  DEPTH[3] = -1;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i]!;
      if (DEPTH[r[1]]! >= 0) DEPTH[r[0]] = Math.max(DEPTH[r[0]]!, DEPTH[r[1]]! + 1);
    }
  }
  let maxD = 0;
  for (let i = 0; i < 4; i++) if (DEPTH[i]! > maxD) maxD = DEPTH[i]!;
  // Operators this algorithm never patches park one column further upstream.
  const idleCol = maxD + 1;
  let anyIdle = false;
  for (let i = 0; i < 4; i++) {
    if (DEPTH[i]! < 0) {
      DEPTH[i] = idleCol;
      anyIdle = true;
    }
  }
  const cols = anyIdle ? idleCol : maxD;

  COL_COUNT.fill(0);
  COL_SEEN.fill(0);
  for (let i = 0; i < 4; i++) COL_COUNT[DEPTH[i]!] = COL_COUNT[DEPTH[i]!]! + 1;

  const xCar = Math.min(W * 0.6, Math.max(200, W - 210));
  const xUp = 116;
  const colGap = cols > 0 ? (xCar - xUp) / cols : 0;
  const cy = Hh * 0.44;
  const laneH = Hh * 0.52;

  const levels = [p.op1, p.op2, p.op3, p.op4];
  for (let i = 0; i < 4; i++) {
    const d = DEPTH[i]!;
    const m = COL_COUNT[d]!;
    const seen = COL_SEEN[d]!;
    COL_SEEN[d] = seen + 1;
    const rowGap = Math.min(40, laneH / Math.max(1, m));
    out[i * 3] = xCar - d * colGap;
    out[i * 3 + 1] = cy + (seen - (m - 1) * 0.5) * rowGap;
    out[i * 3 + 2] = 8 + clamp(levels[i]!, 0, 1) * 8;
  }
}

/** Cubic bezier point along an edge, for the flow packets. */
function bez(a: number, b: number, c: number, d: number, u: number): number {
  const m = 1 - u;
  return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d;
}

/**
 * Paint the operator graph. Exported and pure so it renders headlessly without
 * mounting the component.
 */
export function paintFmRack(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: FmRackVizState,
  now: number,
  flash: number,
): void {
  const t = now / 1000;
  const ops4 = p.engine === "ops4";
  const dim = ops4 ? 1 : 0.42;
  const algI = Math.round(clamp(p.alg, 0, 7));
  const routes = ALG_ROUTES[algI] ?? ALG_ROUTES[0]!;
  const levels = [clamp(p.op1, 0, 1), clamp(p.op2, 0, 1), clamp(p.op3, 0, 1), clamp(p.op4, 0, 1)];
  const ratios = [1, p.r2, p.r3, p.r4];
  const fb = clamp(p.feedback, 0, 1);
  const vecDepth = clamp(p.vecDepth, 0, 1);
  const energy =
    0.12 + (ops4 ? 0.18 : 0) + fb * 0.22 + vecDepth * 0.26 +
    (levels[1]! + levels[2]! + levels[3]!) * 0.07 + flash * 0.24;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.48 });
  lattice(ctx, W, Hh, C_MID, 16, 0.05 + vecDepth * 0.05);

  layoutFmOps(W, Hh, p, NODE_SCRATCH);

  // ── output bus: the carrier's path off the right of the rack ──
  // Doglegs below the vector pad so the two never sit on top of each other.
  const cx0 = NODE_SCRATCH[0]!;
  const cy0 = NODE_SCRATCH[1]!;
  const cr0 = NODE_SCRATCH[2]!;
  const outX = W - 16;
  const busY = Hh * 0.68;
  const busKnee = Math.min(cx0 + cr0 + 46, outX - 30);
  ctx.strokeStyle = hexA(C_GLOW, (0.2 + levels[0]! * 0.4) * dim);
  ctx.lineWidth = 1 + levels[0]! * 2;
  ctx.beginPath();
  ctx.moveTo(cx0 + cr0, cy0);
  ctx.quadraticCurveTo(busKnee, cy0, busKnee, busY);
  ctx.lineTo(outX - 6, busY);
  ctx.stroke();
  ctx.fillStyle = hexA(C_GLOW, 0.7 * dim);
  ctx.beginPath();
  ctx.moveTo(outX - 6, busY - 4);
  ctx.lineTo(outX, busY);
  ctx.lineTo(outX - 6, busY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_GLOW, 0.6 * dim);
  ctx.fillText("OUT", outX, busY - 8);

  // ── edges: who modulates whom ──
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i]!;
    const from = r[0]!;
    const to = r[1]!;
    const fx = NODE_SCRATCH[from * 3]!;
    const fy = NODE_SCRATCH[from * 3 + 1]!;
    const fr = NODE_SCRATCH[from * 3 + 2]!;
    const tx = NODE_SCRATCH[to * 3]!;
    const ty = NODE_SCRATCH[to * 3 + 1]!;
    const tr = NODE_SCRATCH[to * 3 + 2]!;
    const drive = levels[from]!;
    const col = C_OP[from] ?? C_MID;
    const x0 = fx + fr;
    const x1 = tx - tr;
    const c0 = x0 + (x1 - x0) * 0.45;
    const c1 = x1 - (x1 - x0) * 0.45;
    const path = () => {
      ctx.moveTo(x0, fy);
      ctx.bezierCurveTo(c0, fy, c1, ty, x1, ty);
    };
    // Thickness is the modulation index this edge carries.
    lit(ctx, () => {
      glowStroke(ctx, path, col, {
        width: (1.1 + drive * 3.4) * (ops4 ? 1 : 0.6),
        glow: (0.4 + drive) * dim,
        alpha: (0.35 + drive * 0.55) * dim,
      });
    });
    // Arrowhead at the midpoint — direction of modulation.
    const mx = bez(x0, c0, c1, x1, 0.55);
    const my = bez(fy, fy, ty, ty, 0.55);
    const mx2 = bez(x0, c0, c1, x1, 0.62);
    const my2 = bez(fy, fy, ty, ty, 0.62);
    const ang = Math.atan2(my2 - my, mx2 - mx);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = hexA(col, (0.5 + drive * 0.4) * dim);
    ctx.beginPath();
    ctx.moveTo(-4, -3.4);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 3.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Flow packets — carrier of the animation, deterministic from `now`.
    if (ops4 && drive > 0.03) {
      const pk = drive > 0.55 ? 3 : 2;
      lit(ctx, () => {
        for (let k = 0; k < pk; k++) {
          const u = ((t * (0.35 + p.vecRate * 1.6 + drive * 0.5) + i * 0.17 + k / pk) % 1 + 1) % 1;
          const px = bez(x0, c0, c1, x1, u);
          const py = bez(fy, fy, ty, ty, u);
          drawGlow(ctx, px, py, 5 + drive * 6, C_GLOW, 0.5 + drive * 0.4);
        }
      });
    }
  }

  // ── feedback: a self-loop on the carrier ──
  if (fb > 0.02) {
    const loopR = cr0 + 10 + fb * 14;
    const pulse = 0.55 + 0.45 * Math.sin(t * (3 + fb * 7));
    const loop = () => {
      ctx.moveTo(cx0 + cr0 * 0.7, cy0 - cr0 * 0.6);
      ctx.bezierCurveTo(cx0 + loopR, cy0 - loopR, cx0 - loopR, cy0 - loopR, cx0 - cr0 * 0.7, cy0 - cr0 * 0.6);
    };
    lit(ctx, () => {
      glowStroke(ctx, loop, C_FB, { width: 1.2 + fb * 2.4, glow: 0.5 + fb * pulse, alpha: 0.4 + fb * 0.5 });
      drawGlow(ctx, cx0, cy0 - loopR * 0.55, 10 + fb * 18, C_FB, fb * 0.4 * pulse);
    });
    ctx.fillStyle = hexA(C_FB, 0.7);
    ctx.beginPath();
    ctx.moveTo(cx0 - cr0 * 0.7 - 3.6, cy0 - cr0 * 0.6 - 3.6);
    ctx.lineTo(cx0 - cr0 * 0.7 + 1, cy0 - cr0 * 0.6 + 1.6);
    ctx.lineTo(cx0 - cr0 * 0.7 - 4.6, cy0 - cr0 * 0.6 + 1.8);
    ctx.closePath();
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_FB, 0.8);
    ctx.fillText(`FB ${Math.round(fb * 100)}`, cx0, cy0 - loopR - 4);
  }

  // ── nodes ──
  for (let i = 0; i < 4; i++) {
    const x = NODE_SCRATCH[i * 3]!;
    const y = NODE_SCRATCH[i * 3 + 1]!;
    const r = NODE_SCRATCH[i * 3 + 2]!;
    const lv = levels[i]!;
    const col = C_OP[i]!;
    const isCarrier = i === 0;
    // Is this operator patched by the current algorithm?
    let patched = isCarrier;
    for (let k = 0; k < routes.length && !patched; k++) {
      if (routes[k]![0] === i || routes[k]![1] === i) patched = true;
    }
    const bright = (patched ? 0.35 + lv * 0.6 : 0.14) * dim;

    ctx.fillStyle = hexA(col, bright * 0.4);
    roundRect(ctx, x - r, y - r, r * 2, r * 2, isCarrier ? r * 0.5 : r * 0.9);
    ctx.fill();
    ctx.save();
    if (!patched) ctx.setLineDash([3, 3]);
    ctx.strokeStyle = hexA(patched ? col : C_MID, (patched ? 0.6 + lv * 0.35 : 0.3) * dim);
    ctx.lineWidth = isCarrier ? 2 : 1.4;
    roundRect(ctx, x - r, y - r, r * 2, r * 2, isCarrier ? r * 0.5 : r * 0.9);
    ctx.stroke();
    ctx.restore();
    if (patched && lv > 0.03) {
      lit(ctx, () => drawGlow(ctx, x, y, r * 1.9 + lv * 10, col, (0.18 + lv * 0.42) * dim));
    }
    if (p.focus === i) {
      ctx.strokeStyle = hexA(C_GLOW, 0.8);
      ctx.lineWidth = 1;
      roundRect(ctx, x - r - 4, y - r - 4, r * 2 + 8, r * 2 + 8, 4);
      ctx.stroke();
    }

    ctx.font = VIZ_FONT_TITLE;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(patched ? C_GLOW : C_MID, patched ? 0.95 : 0.5);
    ctx.fillText(`${i + 1}`, x, y + 3);

    // Level bar under the node.
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(x - 14, y + r + 6, 28, 3);
    ctx.fillStyle = hexA(col, 0.85 * dim);
    ctx.fillRect(x - 14, y + r + 6, 28 * lv, 3);

    // Role + ratio.
    ctx.font = VIZ_FONT_LABEL;
    ctx.fillStyle = hexA(isCarrier ? C_GLOW : col, 0.7 * dim);
    ctx.fillText(isCarrier ? "CARRIER" : patched ? "MOD" : "IDLE", x, y - r - 6);
    if (!isCarrier) {
      ctx.font = VIZ_FONT_VALUE;
      ctx.fillStyle = hexA(C_HOT, 0.72 * dim);
      ctx.fillText(`×${ratios[i]!.toFixed(2)}`, x, y + r + 20);
      const rn = logNorm(ratios[i]!, RATIO_MIN, RATIO_MAX);
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      ctx.fillRect(x - 14, y + r + 24, 28, 2);
      ctx.fillStyle = hexA(C_HOT, 0.6 * dim);
      ctx.fillRect(x - 14, y + r + 24, 28 * rn, 2);
    } else {
      ctx.font = VIZ_FONT_VALUE;
      ctx.fillStyle = hexA(C_GLOW, 0.7 * dim);
      ctx.fillText(`L${Math.round(lv * 100)}`, x, y + r + 20);
    }
  }

  // ── vector pad — drawn at the geometry the pointer maps to ──
  const padCx = W * 0.78;
  const padCy = Hh * 0.4;
  const padR = Math.min(W, Hh) * 0.09;
  const grab = padR * 1.35;
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = hexA(C_VEC, 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(padCx - grab, padCy - grab, grab * 2, grab * 2);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(padCx - padR, padCy - padR, padR * 2, padR * 2);
  ctx.strokeStyle = hexA(C_VEC, 0.3 + Math.max(vecDepth, Math.abs(p.fmVecX - 0.5) + Math.abs(p.fmVecY - 0.5)) * 0.4);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(padCx - padR, padCy - padR, padR * 2, padR * 2);
  ctx.strokeStyle = hexA(C_MID, 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padCx - padR, padCy);
  ctx.lineTo(padCx + padR, padCy);
  ctx.moveTo(padCx, padCy - padR);
  ctx.lineTo(padCx, padCy + padR);
  ctx.stroke();
  ctx.font = VIZ_FONT_LABEL;
  ctx.fillStyle = hexA(C_VEC, 0.45);
  ctx.textAlign = "center";
  ctx.fillText("A", padCx - padR + 4, padCy - padR + 8);
  ctx.fillText("B", padCx + padR - 4, padCy - padR + 8);
  ctx.fillText("C", padCx - padR + 4, padCy + padR - 2);
  ctx.fillText("D", padCx + padR - 4, padCy + padR - 2);

  // Slow vector orbit when rate/depth are dialled in.
  const phase = t * (0.3 + p.vecRate * 5);
  if (vecDepth > 0.02) {
    for (let k = 12; k > 0; k--) {
      const ph = phase - k * 0.15;
      const tx = padCx + Math.sin(ph) * vecDepth * (padR - 2);
      const ty = padCy + Math.cos(ph * 0.87) * vecDepth * (padR - 2);
      ctx.fillStyle = hexA(C_VEC, ((12 - k) / 12) * 0.28 * vecDepth);
      ctx.fillRect(tx - 0.8, ty - 0.8, 1.6, 1.6);
    }
  }
  const vhx = padCx - padR + clamp(p.fmVecX, 0, 1) * padR * 2;
  const vhy = padCy - padR + clamp(p.fmVecY, 0, 1) * padR * 2;
  const vdx = vecDepth > 0.02 ? Math.sin(phase) * vecDepth * (padR - 2) * 0.15 : 0;
  const vdy = vecDepth > 0.02 ? Math.cos(phase * 0.87) * vecDepth * (padR - 2) * 0.15 : 0;
  ctx.strokeStyle = hexA(C_GLOW, 0.4 + flash * 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(vhx - 5, vhy);
  ctx.lineTo(vhx + 5, vhy);
  ctx.moveTo(vhx, vhy - 5);
  ctx.lineTo(vhx, vhy + 5);
  ctx.stroke();
  lit(ctx, () => drawGlow(ctx, vhx + vdx, vhy + vdy, 10 + flash * 6, C_VEC, 0.8));
  ctx.fillStyle = hexA(C_GLOW, 0.95);
  ctx.beginPath();
  ctx.arc(vhx + vdx, vhy + vdy, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_VEC, 0.8);
  ctx.fillText("FM VEC", padCx, padCy - grab - 5);
  ctx.font = VIZ_FONT_VALUE;
  ctx.fillStyle = hexA(C_VEC, 0.65);
  ctx.fillText(`${p.fmVecX.toFixed(2)},${p.fmVecY.toFixed(2)}`, padCx, padCy + grab + 10);

  // Engine badge + alg chip.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(ops4 ? C_GLOW : C_MID, 0.85);
  ctx.fillText(ops4 ? "4-OP LIVE" : "2-OP · ARM RACK", 12, 30);
  ctx.fillStyle = hexA(C_MID, 0.6);
  ctx.fillText(algI <= 3 ? "SERIAL" : "PARALLEL", 12, 42);
  pill(ctx, W * 0.5, 3, `ALG ${algI} · ${ALG_NAMES[algI]}`, C_GLOW, { glow: flash, height: 14 });

  // ── feedback rail ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railX, railY, railW, 7);
  ctx.strokeStyle = hexA(C_FB, 0.22 + fb * 0.4);
  ctx.lineWidth = 1;
  ctx.strokeRect(railX + 0.5, railY + 0.5, railW - 1, 6);
  if (fb > 0.02) {
    const rg = cachedGrad(ctx, `fbrail|${railX}|${railW}`, (c) => {
      const g = c.createLinearGradient(railX, 0, railX + railW, 0);
      g.addColorStop(0, hexA(C_FB, 0.4));
      g.addColorStop(1, hexA(C_GLOW, 0.8));
      return g;
    });
    ctx.fillStyle = rg;
    ctx.fillRect(railX + 1, railY + 1, Math.max(2, (railW - 2) * fb), 5);
  }
  lit(ctx, () => drawGlow(ctx, railX + 1 + (railW - 2) * fb, railY + 3.5, 8 + flash * 4, C_GLOW, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_FB, 0.8);
  ctx.fillText("FEEDBACK", railX + 2, railY - 4);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_FB, 0.62);
  ctx.fillText(`${Math.round(fb * 100)}`, railX + railW - 2, railY - 4);

  grain(ctx, W, Hh, 0.03);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "RACK · VECTOR LATTICE",
    !ops4
      ? "STANDBY"
      : `ALG${algI}${algI <= 3 ? "·S" : "·P"} · FB${Math.round(fb * 100)} · XY ${p.fmVecX.toFixed(2)},${p.fmVecY.toFixed(2)}`,
    C_GLOW,
    ops4 ? C_HOT : C_MID,
  );
}

export function FmRackStageViz() {
  const engine = (useFireCommandStore((s) => s.patch.fmEngine) ?? "classic") as FmEngineMode;
  const alg = useFireCommandStore((s) => s.patch.fmAlg) ?? 0;
  const feedback = useFireCommandStore((s) => s.patch.fmFeedback) ?? 0;
  const op1 = useFireCommandStore((s) => s.patch.fmOp1Level) ?? 1;
  const op2 = useFireCommandStore((s) => s.patch.fmOp2Level) ?? 0.7;
  const op3 = useFireCommandStore((s) => s.patch.fmOp3Level) ?? 0.5;
  const op4 = useFireCommandStore((s) => s.patch.fmOp4Level) ?? 0.35;
  const r2 = useFireCommandStore((s) => s.patch.fmOp2Ratio) ?? 1;
  const r3 = useFireCommandStore((s) => s.patch.fmOp3Ratio) ?? 2;
  const r4 = useFireCommandStore((s) => s.patch.fmOp4Ratio) ?? 3;
  const vecRate = useFireCommandStore((s) => s.patch.vectorRate) ?? 0;
  const vecDepth = useFireCommandStore((s) => s.patch.vectorDepth) ?? 0;
  const fmVecX = useFireCommandStore((s) => s.patch.fmVectorX) ?? 0.5;
  const fmVecY = useFireCommandStore((s) => s.patch.fmVectorY) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const focusOpRef = useRef(0);
  const hitScratch = useRef<number[]>([]);
  const prevKey = useRef(0);
  const st = useRef<FmRackVizState>({
    engine,
    alg,
    feedback,
    op1,
    op2,
    op3,
    op4,
    r2,
    r3,
    r4,
    vecRate,
    vecDepth,
    fmVecX,
    fmVecY,
    focus: focusOpRef.current,
  });
  st.current = {
    engine,
    alg,
    feedback,
    op1,
    op2,
    op3,
    op4,
    r2,
    r3,
    r4,
    vecRate,
    vecDepth,
    fmVecX,
    fmVecY,
    focus: focusOpRef.current,
  };

  const ops4 = engine === "ops4";
  const live = ops4 && (feedback > 0.02 || vecDepth > 0.02 || op2 > 0.05 || op3 > 0.05 || op4 > 0.05 || Math.abs(fmVecX - 0.5) > 0.02 || Math.abs(fmVecY - 0.5) > 0.02);

  useEffect(() => {
    const key = motionHash(
      ops4 ? 1 : 0,
      alg,
      feedback,
      op1,
      op2,
      op3,
      op4,
      r2,
      r3,
      r4,
      vecRate,
      vecDepth,
      fmVecX,
      fmVecY,
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [ops4, alg, feedback, op1, op2, op3, op4, r2, r3, r4, vecRate, vecDepth, fmVecX, fmVecY]);

  const hitOp = useCallback((clientX: number, clientY: number): number => {
    const wrap = wrapRef.current;
    if (!wrap) return -1;
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { w: W, h: Hh } = sizeRef.current;
    const pos = hitScratch.current;
    layoutFmOps(W, Hh, st.current, pos);
    for (let i = 0; i < 4; i++) {
      const dx = x - pos[i * 3]!;
      const dy = y - pos[i * 3 + 1]!;
      const rr = pos[i * 3 + 2]! + 8;
      if (dx * dx + dy * dy <= rr * rr) return i;
    }
    return -1;
  }, [sizeRef, wrapRef]);

  const applyVec = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      // Map into the vector pad region (right lattice) when possible; else full pad
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      // Prefer pad-local mapping: pad is centered ~78% W / 40% H with radius ~36 CSS px.
      // Fall back to normalized stage XY so drag still works anywhere on the stage.
      const padCx = rect.left + rect.width * 0.78;
      const padCy = rect.top + rect.height * 0.4;
      const padR = Math.min(rect.width, rect.height) * 0.09;
      const inPad = Math.abs(clientX - padCx) <= padR * 1.35 && Math.abs(clientY - padCy) <= padR * 1.35;
      if (inPad) {
        const vx = clamp(0.5 + (clientX - padCx) / (padR * 2), 0, 1);
        const vy = clamp(0.5 + (clientY - padCy) / (padR * 2), 0, 1);
        setParam("fmVectorX", Math.round(vx * 1000) / 1000);
        setParam("fmVectorY", Math.round(vy * 1000) / 1000);
      } else {
        setParam("fmVectorX", Math.round(x * 1000) / 1000);
        setParam("fmVectorY", Math.round(y * 1000) / 1000);
      }
    },
    [setParam, wrapRef],
  );

  const applyFb = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("fmFeedback", Math.round(x * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const applyOp = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      const i = focusOpRef.current;
      const lvlKey = OP_LEVEL_KEYS[i];
      if (lvlKey) setParam(lvlKey, Math.round((1 - y) * 1000) / 1000);
      const ratioKey = OP_RATIO_KEYS[i];
      if (ratioKey) {
        setParam(ratioKey, Math.round(logLerp(x, RATIO_MIN, RATIO_MAX) * 100) / 100);
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
      if (y > H * 0.78) {
        dragRef.current = "fb";
        wrap.setPointerCapture(e.pointerId);
        applyFb(e.clientX);
        return;
      }
      const hit = hitOp(e.clientX, e.clientY);
      if (hit >= 0) {
        focusOpRef.current = hit;
        st.current.focus = hit;
        dragRef.current = "op";
        wrap.setPointerCapture(e.pointerId);
        applyOp(e.clientX, e.clientY);
        return;
      }
      dragRef.current = "vec";
      wrap.setPointerCapture(e.pointerId);
      applyVec(e.clientX, e.clientY);
    },
    [applyFb, applyOp, applyVec, hitOp, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const m = dragRef.current;
      if (m === "vec") applyVec(e.clientX, e.clientY);
      else if (m === "fb") applyFb(e.clientX);
      else if (m === "op") applyOp(e.clientX, e.clientY);
    },
    [applyVec, applyFb, applyOp],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const next = (Math.round(st.current.alg) + 1) % 8;
    setParam("fmAlg", next);
    if (st.current.engine !== "ops4") setParam("fmEngine", "ops4");
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
        paintFmRack(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active:
          st.current.engine === "ops4" &&
          ((st.current.feedback ?? 0) > 0.02 ||
            (st.current.vecDepth ?? 0) > 0.02 ||
            (st.current.op2 ?? 0) > 0.05 ||
            (st.current.op3 ?? 0) > 0.05 ||
            (st.current.op4 ?? 0) > 0.05),
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.engine === "ops4" ? 1 : 0,
          st.current.alg,
          st.current.feedback,
          st.current.op1,
          st.current.op2,
          st.current.op3,
          st.current.op4,
          st.current.r2,
          st.current.r3,
          st.current.r4,
          st.current.vecRate,
          st.current.vecDepth,
          st.current.fmVecX,
          st.current.fmVecY,
          st.current.focus,
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
        borderColor: hexA(C, live ? 0.55 : ops4 ? 0.4 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Pad: fmVector X/Y · Drag orbs: Level↕ / Ratio↔ · Bottom: Feedback · Double-click: next alg (arms 4-op)"
      role="img"
      aria-label="FM Rack vector lattice"
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
        Vector Lattice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(ops4 ? C_HOT : C_MID, 0.78) }}
      >
        {ops4 ? `ALG ${Math.round(alg)}` : "2-OP"}
      </div>
    </div>
  );
}
