/**
 * MOD — Morph Weaver MSEG visualizer.
 *
 * IDIOM: the breakpoint path. This one is deliberately an *editor*, not a
 * contour — graph paper, a time ruler in seconds, square node handles you can
 * grab, a control dot per segment showing where its curve bows, and a sustain
 * flag with loop brackets. Nothing about it reads like the smooth ADSR panels.
 *
 * Two traces, because an MSEG has two truths:
 *   · dashed / dim — the path as authored, every segment node to node.
 *   · solid / bright — what a held note actually does: rise to the sustain node
 *     then hold, or, with loop armed, cycle the loop span over and over. That
 *     continuation is what fills the letterbox: the breakpoints cluster at the
 *     left and the hold (or the repeats) stretch out across the rest.
 *
 * Points · Sustain · Loop · Env→WT A/B/C (Signal Path Tone · FC.envMod).
 * Drag nodes (time/level), mid-segment to cycle curve. Bottom rail: morph depth per osc. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { type ModEnvPoint, type EnvCurve, normalizeModEnvPoints, applyEnvCurve } from "@/audio/dsp/toneDifferentiation";
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
  lattice,
  lit,
  motionHash,
  pill,
  plate,
  roundRect,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const H = 176;
const C = FC.envMod;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.9);
const C_MORPH = bandShade(FC.tone, 0.85);
const C_OA = FC.oscA;
const C_OB = FC.oscB;
const C_OC = FC.oscC;

const T_MAX = 4;
const CURVE_CYCLE: EnvCurve[] = ["lin", "exp", "log", "s", "step", "overshoot", "spring"];

/** Editor geometry. Frozen: the node hit-tests and the drag math share it. */
const PAD = 14;
const TOP = 24;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function timeToX(t: number, maxT: number, pad: number, usableW: number): number {
  return pad + (t / Math.max(0.001, maxT)) * usableW;
}

function xToTime(x: number, maxT: number, pad: number, usableW: number): number {
  return clamp((x - pad) / Math.max(1, usableW), 0, 1) * maxT;
}

/**
 * Allocation-free digest of the point list, for the RAF pump's motion key.
 * `JSON.stringify` here would mint a string every frame for every visualizer.
 */
function pointsDigest(pts: ModEnvPoint[]): number {
  let h = 2166136261;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    h ^= ((p.t * 1000) | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h |= 0;
    h ^= ((p.level * 1000) | 0) + 0x85ebca6b + (h << 6) + (h >>> 2);
    h |= 0;
    h ^= (p.curve.length << 5) ^ (p.curve.charCodeAt(0) | 0);
    h |= 0;
  }
  return h;
}

/**
 * What a held note actually outputs at `t` — the engine's `evalModEnvHeld`
 * shape, minus the re-normalize, so the bright trace matches what you hear.
 */
function heldLevel(pts: ModEnvPoint[], susIdx: number, loop: boolean, t: number): number {
  const lastT = pts[pts.length - 1]!.t || 0.001;
  const susT = pts[susIdx]!.t;
  let x = Math.max(0, t);
  if (loop && x > lastT && lastT > 0.001) {
    const loopStart = pts[Math.min(1, susIdx)]!.t;
    const span = Math.max(0.001, lastT - loopStart);
    x = loopStart + ((x - loopStart) % span);
  }
  if (x <= 0) return pts[0]!.level;
  if (x >= susT) return pts[susIdx]!.level;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i]!.t || i === pts.length - 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dur = Math.max(0.0001, b.t - a.t);
      return a.level + (b.level - a.level) * applyEnvCurve((x - a.t) / dur, b.curve);
    }
  }
  return pts[pts.length - 1]!.level;
}

export type ModEnvVizState = {
  points: ModEnvPoint[];
  sustainIndex: number;
  loop: boolean;
  envA: number;
  envB: number;
  envC: number;
  /** Which osc the bottom rail is editing — the drag zone's third. */
  focus: "a" | "b" | "c";
  /** Live telemetry — passed in so the paint stays pure. */
  telPhase: number;
  telLevel: number;
  telReleasing: boolean;
  voices: number;
};

/**
 * Paint the breakpoint editor. Exported and pure so any point list can be
 * rendered headlessly without mounting the component.
 */
export function paintModEnv(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ModEnvVizState,
  now: number,
  flash: number,
): void {
  const pts = p.points;
  const n = pts.length;
  const usableW = Math.max(60, W - PAD * 2);
  const usableH = Hh - 48;
  const floorY = TOP + usableH;
  const lastT = pts[n - 1]!.t || 1;
  const maxT = Math.max(lastT, T_MAX);
  const susIdx = clamp(Math.round(p.sustainIndex), 0, n - 1);
  const susT = pts[susIdx]!.t;
  const loopStart = pts[Math.min(1, susIdx)]!.t;

  const xOf = (t: number) => timeToX(t, maxT, PAD, usableW);
  const yOf = (lv: number) => TOP + (1 - clamp(lv, 0, 1)) * usableH;

  const morphMag = Math.max(Math.abs(p.envA), Math.abs(p.envB), Math.abs(p.envC));
  const susLevel = pts[susIdx]!.level;
  const energy = 0.18 + susLevel * 0.18 + morphMag * 0.32 + flash * 0.24;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.74 });
  lattice(ctx, W, Hh, C_MID, 14, 0.06);

  // ── graph paper: level rows, half-second columns ──
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(yOf(i / 4)) + 0.5;
    ctx.strokeStyle = hexA(C_MID, i === 0 || i === 4 ? 0.2 : 0.08);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(PAD + usableW, y);
    ctx.stroke();
  }
  const steps = Math.max(4, Math.min(32, Math.round(maxT / 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * maxT;
    const x = Math.round(xOf(t)) + 0.5;
    const major = i % 2 === 0;
    ctx.strokeStyle = hexA(C_MID, major ? 0.14 : 0.06);
    ctx.beginPath();
    ctx.moveTo(x, TOP);
    ctx.lineTo(x, floorY);
    ctx.stroke();
  }
  ctx.restore();

  // Time ruler — whole seconds only, so the row stays readable.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let s = 1; s <= Math.floor(maxT); s++) {
    ctx.fillStyle = hexA(C_MID, 0.42);
    ctx.fillText(`${s}s`, xOf(s), floorY - 5);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.45);
  ctx.fillText("1.0", PAD - 2, yOf(1) + 3);
  ctx.fillStyle = hexA(C_MID, 0.34);
  ctx.fillText("0", PAD - 2, yOf(0) + 3);

  // ── the region a held note sits in: the hold shelf, or the loop span ──
  const holdX = xOf(p.loop ? loopStart : susT);
  if (holdX < PAD + usableW - 8) {
    ctx.fillStyle = hexA(C_MORPH, p.loop ? 0.06 : 0.04);
    ctx.fillRect(holdX, TOP, PAD + usableW - holdX, usableH);
  }

  // ── authored path: every segment, node to node, dashed ──
  const authored = () => {
    ctx.moveTo(xOf(pts[0]!.t), yOf(pts[0]!.level));
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const x1 = xOf(a.t);
      const x2 = xOf(b.t);
      const y1 = yOf(a.level);
      const y2 = yOf(b.level);
      const segs = Math.max(8, Math.min(48, Math.ceil((x2 - x1) / 4)));
      for (let s = 1; s <= segs; s++) {
        const u = s / segs;
        ctx.lineTo(x1 + (x2 - x1) * u, y1 + (y2 - y1) * applyEnvCurve(u, b.curve));
      }
    }
  };
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = hexA(C_MID, 0.4);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  authored();
  ctx.stroke();
  ctx.restore();

  // ── played path: rise, then hold or loop, all the way across ──
  const N = Math.max(80, Math.min(420, (usableW / 4) | 0));
  const played = () => {
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * maxT;
      const x = PAD + (i / N) * usableW;
      const y = yOf(heldLevel(pts, susIdx, p.loop, t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  ctx.beginPath();
  played();
  ctx.lineTo(PAD + usableW, floorY);
  ctx.lineTo(PAD, floorY);
  ctx.closePath();
  const fill = cachedGrad(ctx, `msegfill|${Hh}|${(susLevel * 10) | 0}|${(morphMag * 10) | 0}`, (c) => {
    const g = c.createLinearGradient(0, TOP, 0, floorY);
    g.addColorStop(0, hexA(C_GLOW, 0.22 + morphMag * 0.14));
    g.addColorStop(0.55, hexA(C_HOT, 0.1));
    g.addColorStop(1, hexA(C_DEEP, 0.03));
    return g;
  });
  ctx.fillStyle = fill;
  ctx.fill();
  glowStroke(ctx, played, C_GLOW, { width: 2.1, glow: 0.7 + morphMag * 0.7 + flash * 0.6, alpha: 0.9 });

  // ── per-segment curve tag + a control dot where the curve bows ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const x1 = xOf(a.t);
    const x2 = xOf(b.t);
    if (x2 - x1 < 14) continue;
    const mx = (x1 + x2) * 0.5;
    const my = yOf(a.level + (b.level - a.level) * applyEnvCurve(0.5, b.curve));
    ctx.fillStyle = hexA(C_HOT, 0.5);
    ctx.beginPath();
    ctx.arc(mx, my, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(C_HOT, 0.62);
    ctx.fillText(String(b.curve).slice(0, 3).toUpperCase(), mx, my - 7);
  }

  // ── node handles: square, editor-style, with the index beside them ──
  for (let i = 0; i < n; i++) {
    const px = xOf(pts[i]!.t);
    const py = yOf(pts[i]!.level);
    const isSus = i === susIdx;
    const col = isSus ? C_MORPH : C_HOT;
    const s = isSus ? 5 : 4;
    lit(ctx, () => drawGlow(ctx, px, py, 9 + flash * 4, col, isSus ? 0.6 : 0.4));
    ctx.fillStyle = "rgba(4,4,8,0.85)";
    ctx.strokeStyle = hexA(col, 0.95);
    ctx.lineWidth = 1.4;
    if (isSus) {
      ctx.beginPath();
      ctx.moveTo(px, py - s - 1);
      ctx.lineTo(px + s + 1, py);
      ctx.lineTo(px, py + s + 1);
      ctx.lineTo(px - s - 1, py);
      ctx.closePath();
    } else {
      roundRect(ctx, px - s, py - s, s * 2, s * 2, 1.5);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hexA(col, 0.95);
    ctx.beginPath();
    ctx.arc(px, py, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(col, 0.62);
    // Level-centred beside the node rather than above it — a node at full level
    // sits on TOP, and a label above that lands in the reserved top strip.
    ctx.fillText(`${i}`, px + s + 3, py + 3);
  }

  // Sustain flag — a stem up to the top rail with an S on it.
  const susX = xOf(susT);
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = hexA(C_MORPH, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(susX, TOP);
  ctx.lineTo(susX, yOf(susLevel));
  ctx.stroke();
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_MORPH, 0.85);
  ctx.fillText("S", susX, TOP + 8);

  // Loop brackets — the span that repeats while the note is held.
  if (p.loop && lastT > 0.001) {
    const lx = xOf(loopStart);
    const rx = xOf(lastT);
    const ly = TOP + 5;
    ctx.strokeStyle = hexA(C_GLOW, 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 5);
    ctx.lineTo(lx, ly);
    ctx.lineTo(rx, ly);
    ctx.lineTo(rx, ly + 5);
    ctx.stroke();
    ctx.fillStyle = hexA(C_GLOW, 0.8);
    ctx.beginPath();
    ctx.moveTo(rx, ly);
    ctx.lineTo(rx - 5, ly - 3);
    ctx.lineTo(rx - 5, ly + 3);
    ctx.closePath();
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.75);
    ctx.fillText(`LOOP ${((maxT - loopStart) / Math.max(0.001, lastT - loopStart)).toFixed(1)}×`, (lx + rx) * 0.5, ly - 4);
  } else {
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(C_MORPH, 0.55);
    ctx.fillText(
      susIdx < n - 1 ? "SUS HOLD — later nodes play on release" : "SUS HOLD",
      susX + 8,
      yOf(susLevel) - 10,
    );
  }

  // ── live playhead ──
  if (p.voices > 0) {
    const cx = PAD + clamp(p.telPhase, 0, 1) * usableW;
    const cy = yOf(clamp(p.telLevel, 0, 1));
    const col = p.telReleasing ? C_MORPH : C_GLOW;
    ctx.strokeStyle = hexA(col, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, TOP);
    ctx.lineTo(cx, floorY);
    ctx.stroke();
    lit(ctx, () => drawGlow(ctx, cx, cy, 16 + flash * 8, col, 0.85));
    ctx.fillStyle = hexA(C_GLOW, 0.98);
    ctx.beginPath();
    ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Env→WT destination meters, laid out along the top strip ──
  if (W >= 460) {
    const dests: Array<{ v: number; col: string; label: string; key: "a" | "b" | "c" }> = [
      { v: p.envA, col: C_OA, label: "A", key: "a" },
      { v: p.envB, col: C_OB, label: "B", key: "b" },
      { v: p.envC, col: C_OC, label: "C", key: "c" },
    ];
    ctx.font = VIZ_FONT_LABEL;
    for (let i = 0; i < dests.length; i++) {
      const m = dests[i]!;
      const bx = 136 + i * 100;
      const bw = 54;
      const by = 9;
      const focused = p.focus === m.key;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(bx, by, bw, 7);
      const mid = bx + bw * 0.5;
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(mid - 0.5, by, 1, 7);
      const mag = Math.abs(m.v);
      if (mag > 0.02) {
        const w = bw * 0.5 * mag;
        ctx.fillStyle = hexA(m.col, focused ? 0.9 : 0.6);
        ctx.fillRect(m.v >= 0 ? mid : mid - w, by + 1, Math.max(1, w), 5);
      }
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(m.col, focused ? 0.95 : 0.5);
      ctx.fillText(`→WT ${m.label}`, bx + bw + 4, by + 6);
    }
  }

  pill(ctx, W * 0.5, 3, p.loop ? "MSEG LOOP" : "MSEG", C_GLOW, { glow: flash });

  // ── bipolar morph rail for the focused osc, clear of the footer band ──
  const focusVal = p.focus === "a" ? p.envA : p.focus === "b" ? p.envB : p.envC;
  const focusCol = p.focus === "a" ? C_OA : p.focus === "b" ? C_OB : C_OC;
  const railY = Hh - 23;
  const railW = W - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, railW, 5);
  const midX = 12 + railW * 0.5;
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(midX - 0.5, railY, 1, 5);
  const signedX = midX + focusVal * railW * 0.5;
  if (Math.abs(focusVal) > 0.02) {
    ctx.fillStyle = hexA(focusCol, 0.7);
    const left = Math.min(midX, signedX);
    ctx.fillRect(left, railY + 1, Math.max(1, Math.abs(signedX - midX)), 3);
  }
  lit(ctx, () => drawGlow(ctx, signedX, railY + 2.5, 7 + flash * 4, focusCol, 0.8));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MORPH, 0.7);
  ctx.fillText(`→WT ${p.focus.toUpperCase()}`, PAD + 2, floorY - 5);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  const atkT = n > 1 ? pts[1]!.t : 0.02;
  footer(
    ctx,
    W,
    Hh,
    "MOD · MORPH WEAVER",
    `A${atkT < 1 ? `${Math.round(atkT * 1000)}ms` : `${atkT.toFixed(2)}s`} · S${Math.round(susLevel * 100)} · →${Math.round(morphMag * 100)} · ${n}pts`,
    C_GLOW,
    C_HOT,
  );
}

type DragMode = "node" | "segment" | "morph" | null;
type MorphFocus = "a" | "b" | "c";

export function ModEnvStageViz() {
  const points = useFireCommandStore((s) => normalizeModEnvPoints(s.patch.modEnvPoints));
  const sustainIndex = useFireCommandStore((s) => s.patch.modEnvSustainIndex ?? points.length - 1);
  const loop = useFireCommandStore((s) => s.patch.modEnvLoop) ?? false;
  const envA = useFireCommandStore((s) => s.patch.oscAEnv) ?? 0;
  const envB = useFireCommandStore((s) => s.patch.oscBEnv) ?? 0;
  const envC = useFireCommandStore((s) => s.patch.oscCEnv) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  // Ref-based telemetry: refreshed inside hints() so notes don't re-render
  // this component at 30 fps (see useToneTelemetryRef).
  const telRef = useToneTelemetryRef();
  const tel = telRef.current;

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const dragNodeIdxRef = useRef(-1);
  const dragSegmentIdxRef = useRef(-1);
  const focusRef = useRef<MorphFocus>("a");
  const prevKey = useRef(0);
  const st = useRef<ModEnvVizState>({
    points, sustainIndex, loop, envA, envB, envC, focus: focusRef.current,
    telPhase: tel.mod.phase, telLevel: tel.mod.level, telReleasing: tel.mod.releasing, voices: tel.voiceCount,
  });
  st.current = {
    points, sustainIndex, loop, envA, envB, envC, focus: focusRef.current,
    telPhase: tel.mod.phase, telLevel: tel.mod.level, telReleasing: tel.mod.releasing, voices: tel.voiceCount,
  };

  const morphAmt = Math.max(Math.abs(envA), Math.abs(envB), Math.abs(envC));
  const weaving = morphAmt > 0.04 || points.length > 3;

  useEffect(() => {
    const key = motionHash(pointsDigest(points), sustainIndex, loop, envA, envB, envC);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [points, sustainIndex, loop, envA, envB, envC]);

  const syncLegacyADSR = useCallback(
    (pts: ModEnvPoint[], susIdx: number) => {
      const attack = pts.length > 1 ? pts[1].t : 0.02;
      const lastT = pts[pts.length - 1]?.t || 0.5;
      const decay = lastT - attack;
      const sustain = pts[susIdx]?.level ?? 0.3;
      setParam("modAttack", Math.round(attack * 1000) / 1000);
      setParam("modDecay", Math.max(0.005, Math.round(decay * 1000) / 1000));
      setParam("modSustain", Math.round(sustain * 1000) / 1000);
    },
    [setParam],
  );

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      if (mode === "morph") {
        const signed = clamp(x * 2 - 1, -1, 1);
        const key = focusRef.current === "a" ? "oscAEnv" : focusRef.current === "b" ? "oscBEnv" : "oscCEnv";
        setParam(key, Math.round(signed * 1000) / 1000);
        return;
      }
      const usableH = H - 48;
      const usableW = rect.width - PAD * 2;
      const level = 1 - clamp((clientY - rect.top - TOP) / usableH, 0, 1);
      if (mode === "node") {
        const idx = dragNodeIdxRef.current;
        if (idx < 0 || idx >= points.length) return;
        const newPts = [...points];
        const lastT = points[points.length - 1]?.t || 1;
        const maxT = Math.max(lastT, T_MAX);
        const newT = idx === 0 ? 0 : xToTime(clientX - rect.left, maxT, PAD, usableW);
        const prevT = idx > 0 ? newPts[idx - 1].t : 0;
        const nextT = idx < newPts.length - 1 ? newPts[idx + 1].t : maxT;
        newPts[idx] = { ...newPts[idx], t: clamp(newT, prevT, nextT), level: clamp(level, 0, 1) };
        setParam("modEnvPoints", newPts);
        syncLegacyADSR(newPts, sustainIndex);
      }
    },
    [setParam, points, sustainIndex, syncLegacyADSR, wrapRef],
  );

  const hitZone = useCallback(
    (clientX: number, clientY: number): DragMode => {
      const wrap = wrapRef.current;
      if (!wrap) return null;
      const rect = wrap.getBoundingClientRect();
      const lx = clientX - rect.left;
      const ly = clientY - rect.top;
      if (ly > H * 0.78) {
        const t = lx / Math.max(1, rect.width);
        focusRef.current = t < 0.33 ? "a" : t < 0.66 ? "b" : "c";
        // Mirror it into the paint state so the rail retargets on this frame
        // rather than waiting for the store round-trip to re-render.
        st.current.focus = focusRef.current;
        return "morph";
      }
      const usableH = H - 48;
      const usableW = rect.width - PAD * 2;
      const lastT = points[points.length - 1]?.t || 1;
      const maxT = Math.max(lastT, T_MAX);
      const yLv = (lv: number) => TOP + (1 - clamp(lv, 0, 1)) * usableH;
      for (let i = 0; i < points.length; i++) {
        const px = timeToX(points[i].t, maxT, PAD, usableW);
        const py = yLv(points[i].level);
        const dist = Math.hypot(lx - px, ly - py);
        if (dist < 12) {
          dragNodeIdxRef.current = i;
          return "node";
        }
      }
      for (let i = 1; i < points.length; i++) {
        const x1 = timeToX(points[i - 1].t, maxT, PAD, usableW);
        const x2 = timeToX(points[i].t, maxT, PAD, usableW);
        const midX = (x1 + x2) / 2;
        if (Math.abs(lx - midX) < 16 && ly >= TOP && ly <= TOP + usableH) {
          dragSegmentIdxRef.current = i;
          return "segment";
        }
      }
      return null;
    },
    [points, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const mode = hitZone(e.clientX, e.clientY);
      if (mode === "segment") {
        const idx = dragSegmentIdxRef.current;
        if (idx >= 1 && idx < points.length) {
          const newPts = [...points];
          const currentCurve = newPts[idx].curve;
          const nextIdx = CURVE_CYCLE.indexOf(currentCurve);
          newPts[idx] = { ...newPts[idx], curve: CURVE_CYCLE[(nextIdx + 1) % CURVE_CYCLE.length] };
          setParam("modEnvPoints", newPts);
          flashRef.current = 1;
        }
        return;
      }
      dragRef.current = mode;
      wrap.setPointerCapture(e.pointerId);
      applyDrag(e.clientX, e.clientY, mode);
    },
    [hitZone, applyDrag, points, setParam, wrapRef],
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
    const defaultPts: ModEnvPoint[] = [
      { t: 0, level: 0, curve: "lin" },
      { t: 0.02, level: 1, curve: "exp" },
      { t: 0.52, level: 0.3, curve: "log" },
    ];
    setParam("modEnvPoints", defaultPts);
    setParam("modEnvSustainIndex", 2);
    setParam("modAttack", 0.02);
    setParam("modDecay", 0.5);
    setParam("modSustain", 0.3);
    setParam("modRelease", 0.4);
    setParam("oscAEnv", 0);
    setParam("oscBEnv", 0);
    setParam("oscCEnv", 0);
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
        paintModEnv(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        const tv = telRef.current;
        st.current.telPhase = tv.mod.phase;
        st.current.telLevel = tv.mod.level;
        st.current.telReleasing = tv.mod.releasing;
        st.current.voices = tv.voiceCount;
        return {
          flash: flashRef.current,
          active: st.current.voices > 0,
          dragging: !!dragRef.current,
          visible: visibleRef.current,
          motionKey: motionHash(
            pointsDigest(st.current.points),
            st.current.sustainIndex,
            st.current.loop,
            st.current.envA,
            st.current.envB,
            st.current.envC,
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
        borderColor: hexA(C, weaving ? 0.55 : 0.32),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, weaving ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag A/D/S/R zones · Bottom rail: Env→WT (thirds = A/B/C focus) · Double-click: defaults"
      role="img"
      aria-label="Mod envelope morph weaver"
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
        Morph Weaver
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        →WT
      </div>
    </div>
  );
}
