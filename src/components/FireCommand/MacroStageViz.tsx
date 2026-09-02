/**
 * Macros — Helm Quartet stage visualizer.
 *
 * IDIOM: the assignment fan. Four helm rails stand across the width, each
 * showing its macro's level as a filled carriage position; from every carriage
 * a fan line sweeps down to the destination bus that spans the whole panel. At
 * 10:1 the composition is the harness, not the meters — the rails are slim
 * markers and the fan is what reads.
 *
 * Line thickness is the route amount, solid lines land on a filled tap
 * (positive polarity) and dashed lines on a hollow one (inverted), and the
 * travelling dots only move while the driving macro is actually open — so a
 * wired-but-idle macro visibly sends nothing.
 *
 * Four performance macros → mod matrix (Signal Path Perf · FC.macros).
 * Drag each helm ↕ to set level. Double-click: cycle characters / zero.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
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
  mixHex,
  motionHash,
  pill,
  plate,
  roundRect,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 176;
const C = FC.macros;
const C_DEEP = bandShade(FC_BAND.perf, 0.22);
const C_MID = bandShade(FC_BAND.perf, 0.4);
const C_HOT = bandShade(FC_BAND.perf, 0.58);
const C_GLOW = bandShade(FC_BAND.perf, 0.9);

/** Four helms stay inside the Perf magenta family (deep → light). */
export const MACRO_HELM_COLORS = [
  bandShade(FC_BAND.perf, 0.32),
  bandShade(FC_BAND.perf, 0.48),
  bandShade(FC_BAND.perf, 0.64),
  bandShade(FC_BAND.perf, 0.8),
] as const;

export const MACRO_KEYS = ["macro1", "macro2", "macro3", "macro4"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

const CHAR_CYCLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 0],
  [0.25, 0.25, 0.25, 0.25],
  [0.5, 0.5, 0.5, 0.5],
  [0.2, 0.4, 0.6, 0.85],
  [1, 0, 0, 0],
  [0.75, 0.75, 0, 0],
  [1, 0, 1, 0],
  [0, 0.5, 1, 0.5],
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic phase offset — flow dots must not crawl on an idle canvas. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Point on a cubic bezier — the flow dots ride the fan lines. */
function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** One fan line: which helm drives which bus stop, and how hard. */
export type MacroLink = { m: number; d: number; amount: number };

export type MacroVizState = {
  /** Four macro levels, 0..1. */
  values: number[];
  enabled: boolean;
  /** Distinct wired destinations in matrix order — the bus stops. */
  dests: string[];
  links: MacroLink[];
  /** Checksum of the wiring, so a re-aimed route wakes a parked canvas. */
  sig: number;
};

/**
 * Paint the assignment fan. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintMacro(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: MacroVizState,
  now: number,
  flash: number,
): void {
  const on = p.enabled;
  const vals = p.values;
  let peak = 0;
  for (let i = 0; i < 4; i++) {
    const v = on ? vals[i] ?? 0 : 0;
    if (v > peak) peak = v;
  }
  const dim = on ? 1 : 0.32;
  const energy = 0.06 + peak * 0.34 + flash * 0.16;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.8 });

  const padL = 16;
  const padR = 16;
  const span = Math.max(60, W - padL - padR);
  // Rails start below the reserved top strip so the per-helm name that sits
  // above each channel clears the DOM chrome.
  const railTop = Hh * 0.2;
  const railBot = Hh * 0.72;
  const railH = railBot - railTop;
  const busY = Hh * 0.8;
  const nDest = p.dests.length;
  const wired = p.links.length;

  // ── destination bus: every wired mod-matrix target, spread over the width ──
  ctx.fillStyle = hexA(C_MID, 0.14 + peak * 0.1);
  ctx.fillRect(padL, busY, span, 1);
  const stopW = nDest > 0 ? span / nDest : span;
  const busX = (d: number) => padL + (d + 0.5) * stopW;

  if (nDest === 0) {
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_MID, 0.34);
    ctx.fillText("NO ROUTES WIRED — MATRIX EMPTY", W * 0.5, busY - 7);
  }
  for (let d = 0; d < nDest; d++) {
    const bx = busX(d);
    ctx.fillStyle = hexA(C_MID, 0.3 * dim);
    ctx.fillRect(bx - 0.5, busY, 1, 5);
    const name = p.dests[d] ?? "";
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_HOT, 0.5 * dim);
    ctx.fillText(name.length > 13 ? `${name.slice(0, 12)}…` : name, bx, busY - 7);
  }

  // ── the fan: one sweep per wired route ──
  for (let li = 0; li < wired; li++) {
    const link = p.links[li]!;
    const col = MACRO_HELM_COLORS[link.m] ?? C_HOT;
    const v = on ? vals[link.m] ?? 0 : 0;
    const amt = clamp(link.amount, -1, 1);
    const mag = Math.abs(amt);
    const pos = amt >= 0;
    const x0 = padL + span * ((link.m + 0.5) / 4);
    const y0 = railBot - v * railH;
    const x1 = busX(link.d);
    const bend = (busY - y0) * 0.58;
    const path = () => {
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0, y0 + bend, x1, busY - bend, x1, busY);
    };
    // Idle macros keep their wiring visible but stop delivering.
    const carry = 0.14 + v * 0.86;
    const a = (0.08 + mag * 0.46) * carry * dim;
    const width = 0.6 + mag * 2.6;
    const color = pos ? col : mixHex(col, C_DEEP, 0.55);

    ctx.save();
    if (!pos) ctx.setLineDash([3, 4]);
    if (a > 0.24) {
      glowStroke(ctx, path, color, { width, glow: 0.7 * carry, alpha: a });
    } else {
      ctx.strokeStyle = hexA(color, a);
      ctx.lineWidth = width;
      ctx.beginPath();
      path();
      ctx.stroke();
    }
    ctx.restore();

    // Landing tap: filled triangle into the bus for +, hollow out of it for −.
    ctx.beginPath();
    if (pos) {
      ctx.moveTo(x1 - 3.4, busY - 5);
      ctx.lineTo(x1 + 3.4, busY - 5);
      ctx.lineTo(x1, busY);
      ctx.closePath();
      ctx.fillStyle = hexA(color, (0.35 + mag * 0.55) * carry * dim);
      ctx.fill();
    } else {
      ctx.moveTo(x1 - 3.4, busY);
      ctx.lineTo(x1 + 3.4, busY);
      ctx.lineTo(x1, busY - 5);
      ctx.closePath();
      ctx.strokeStyle = hexA(color, (0.4 + mag * 0.5) * carry * dim);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Flow dot — travels only while the macro is open. Phase from a hash so an
    // idle panel renders identically every time.
    if (v > 0.03 && mag > 0.02 && on) {
      const speed = 0.00012 + mag * v * 0.00042;
      const t = (now * speed + hash01(li * 7.77)) % 1;
      const fx = cubicAt(x0, x0, x1, x1, t);
      const fy = cubicAt(y0, y0 + bend, busY - bend, busY, t);
      lit(ctx, () => {
        drawGlow(ctx, fx, fy, 5 + mag * 5, C_GLOW, (0.3 + mag * 0.5) * v);
        ctx.fillStyle = hexA(C_GLOW, 0.8 * v);
        ctx.fillRect(fx - 0.9, fy - 0.9, 1.8, 1.8);
      });
    }
  }

  // ── four helm rails ──
  for (let i = 0; i < 4; i++) {
    const v = on ? vals[i] ?? 0 : 0;
    const col = MACRO_HELM_COLORS[i] ?? C_HOT;
    const cx = padL + span * ((i + 0.5) / 4);
    const vy = railBot - v * railH;

    // Recessed channel + quarter ladder.
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    roundRect(ctx, cx - 5, railTop, 10, railH, 5);
    ctx.fill();
    ctx.strokeStyle = hexA(col, 0.16 * dim);
    ctx.lineWidth = 1;
    roundRect(ctx, cx - 4.5, railTop + 0.5, 9, railH - 1, 4.5);
    ctx.stroke();
    for (let q = 0; q <= 4; q++) {
      const ty = railBot - (q / 4) * railH;
      ctx.fillStyle = hexA(C_MID, q === 0 || q === 4 ? 0.28 : 0.14);
      ctx.fillRect(cx - 11, ty, 5, 1);
    }

    // Filled position — a fixed-span gradient clipped to the value.
    const body = cachedGrad(ctx, `helm|${col}|${railTop | 0}|${railBot | 0}`, (c) => {
      const g = c.createLinearGradient(0, railBot, 0, railTop);
      g.addColorStop(0, hexA(col, 0.18));
      g.addColorStop(1, hexA(col, 0.78));
      return g;
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 4, vy, 8, railBot - vy);
    ctx.clip();
    ctx.globalAlpha = dim;
    ctx.fillStyle = body;
    ctx.fillRect(cx - 4, railTop, 8, railH);
    ctx.restore();

    // Carriage cap — the "helm" the pointer drags.
    const capW = 30;
    ctx.fillStyle = "rgba(6,3,8,0.9)";
    roundRect(ctx, cx - capW * 0.5, vy - 4.5, capW, 9, 3);
    ctx.fill();
    ctx.fillStyle = hexA(col, (0.55 + v * 0.4) * dim);
    roundRect(ctx, cx - capW * 0.5 + 1.5, vy - 3, capW - 3, 6, 2);
    ctx.fill();
    ctx.fillStyle = hexA(C_GLOW, (0.6 + v * 0.35) * dim);
    ctx.fillRect(cx - capW * 0.5 + 3, vy - 0.5, capW - 6, 1);
    if (on) {
      lit(ctx, () => drawGlow(ctx, cx, vy, 12 + v * 14 + flash * 6, col, 0.2 + v * 0.5));
    }

    // Readouts: name above the channel, level on the carriage.
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(col, 0.72 * dim);
    ctx.fillText(`M${i + 1}`, cx, railTop - 5);
    ctx.font = VIZ_FONT_VALUE;
    ctx.fillStyle = hexA(C_GLOW, (0.6 + v * 0.35) * dim);
    ctx.fillText(`${Math.round(v * 100)}`, cx + capW * 0.5 + 13, vy + 3);

    // Per-helm fan-out count, so an unwired helm is obvious.
    let n = 0;
    for (let li = 0; li < wired; li++) if (p.links[li]!.m === i) n++;
    ctx.font = VIZ_FONT_LABEL;
    ctx.fillStyle = hexA(n > 0 ? C_HOT : C_MID, (n > 0 ? 0.6 : 0.3) * dim);
    ctx.fillText(n > 0 ? `→${n}` : "→0", cx, railBot + 11);
  }

  // Top telemetry row — packed left-to-right from the reserved top strip and
  // stopped short of the centred mode pill, so it can't collide at any width.
  ctx.textAlign = "left";
  let telX = VIZ_TOP_LABEL_X;
  const telRight = W * 0.5 - 52;
  const tel = (text: string, color: string, alpha: number, font: string) => {
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    if (telX + tw > telRight) return;
    ctx.fillStyle = hexA(color, alpha);
    ctx.fillText(text, telX, VIZ_TOP_LABEL_Y);
    telX += tw + 14;
  };
  tel("ASSIGN FAN", C_GLOW, 0.66 * dim, VIZ_FONT_LABEL);
  tel(`${wired}/12 SLOTS · ${nDest} DEST`, C_MID, 0.7, VIZ_FONT_VALUE);

  pill(ctx, W * 0.5, 3, !on ? "ASLEEP" : wired === 0 ? "UNWIRED" : `${wired} WIRED`, C_GLOW, {
    glow: flash,
  });

  if (!on) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, Hh);
  }

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    on ? "HELM QUARTET" : "HELM QUARTET · ASLEEP",
    `Σ${Math.round(peak * 100)} · ${wired} route${wired === 1 ? "" : "s"}`,
    C_GLOW,
    C,
  );
}

export function MacroStageViz() {
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const matrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["macros"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragIdx = useRef<number | null>(null);
  const prevKey = useRef(0);
  const st = useRef<MacroVizState>({ values: [m1, m2, m3, m4], enabled, dests: [], links: [], sig: 0 });

  // Flatten the matrix into bus stops + fan lines once per render, never per frame.
  const dests: string[] = [];
  const links: MacroLink[] = [];
  let sig = 0;
  for (const r of matrix) {
    const m = MACRO_KEYS.indexOf(r.source as MacroKey);
    if (m < 0 || r.dest === "none" || !r.amount) continue;
    let d = dests.indexOf(r.dest);
    if (d < 0) {
      d = dests.length;
      dests.push(r.dest);
    }
    links.push({ m, d, amount: r.amount });
    sig = (sig * 31 + ((r.amount * 1000) | 0) + m * 7 + d * 131) | 0;
  }
  st.current = { values: [m1, m2, m3, m4], enabled, dests, links, sig };

  const energy = Math.max(m1, m2, m3, m4);
  const live = enabled && energy > 0.03;

  useEffect(() => {
    const key = motionHash(m1, m2, m3, m4, enabled, sig);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [m1, m2, m3, m4, enabled, sig]);

  const helmAt = useCallback(
    (clientX: number): number => {
      const wrap = wrapRef.current;
      if (!wrap) return 0;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.999);
      return Math.floor(x * 4);
    },
    [wrapRef],
  );

  const applyHelm = useCallback(
    (clientX: number, clientY: number, idx: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      // Leave bottom rail margin — main area maps 0.08..0.78 → 1..0
      const plot = clamp((y - 0.06) / 0.72, 0, 1);
      const v = Math.round((1 - plot) * 1000) / 1000;
      setParam(MACRO_KEYS[idx]!, clamp(v, 0, 1));
    },
    [setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const idx = helmAt(e.clientX);
      dragIdx.current = idx;
      flashRef.current = 1;
      applyHelm(e.clientX, e.clientY, idx);
    },
    [applyHelm, helmAt],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragIdx.current === null) return;
      applyHelm(e.clientX, e.clientY, dragIdx.current);
    },
    [applyHelm],
  );

  const onPointerUp = useCallback(() => {
    dragIdx.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.values;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < CHAR_CYCLE.length; i++) {
      const c = CHAR_CYCLE[i]!;
      const d =
        Math.abs(c[0] - (cur[0] ?? 0)) +
        Math.abs(c[1] - (cur[1] ?? 0)) +
        Math.abs(c[2] - (cur[2] ?? 0)) +
        Math.abs(c[3] - (cur[3] ?? 0));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = CHAR_CYCLE[(best + 1) % CHAR_CYCLE.length]!;
    setParam("macro1", next[0]);
    setParam("macro2", next[1]);
    setParam("macro3", next[2]);
    setParam("macro4", next[3]);
    flashRef.current = 1;
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
        paintMacro(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        const s = st.current;
        const v = s.values;
        const peak = Math.max(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
        return {
          flash: flashRef.current,
          // Flow dots only need frames when a wired macro is actually open.
          active: s.enabled && s.links.length > 0 && peak > 0.02,
          dragging: dragIdx.current !== null,
          visible: visibleRef.current,
          motionKey: motionHash(v[0], v[1], v[2], v[3], s.enabled, s.sig, s.dests.length),
        };
      },
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 bg-black/50 cursor-ns-resize touch-none select-none"
      style={{
        borderColor: `${C}${live ? "66" : "40"}`,
        height: H,
        boxShadow: live
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 28px ${C}28, 0 6px 18px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="img"
      aria-label="Macro helm quartet — drag each column to set macro level"
      title="Drag ↕ each helm · Double-click cycles characters"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: `${C}88` }} />
    </div>
  );
}
