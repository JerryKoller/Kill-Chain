/**
 * Modulation Matrix — Patch Loom stage visualizer.
 *
 * IDIOM: the patch bay. A routing table wants to be read as a diagram, and a
 * 10:1 letterbox is exactly a bay front panel: source jacks stacked in the left
 * gutter, every destination as its own column across the width, and each live
 * route as a patch cable running right out of its source, elbowing onto its
 * destination column, and posting into a terminal.
 *
 * Amount is cable thickness. Polarity is direction and colour — positive routes
 * post *up* into the top terminal rail, negative ones drop *down* into the
 * bottom rail, so the sign of a route is visible from across the room. Packets
 * flow along every live cable at a rate set by its own depth. Columns nobody has
 * patched stay as bare ticks, so the bay reads as mostly-empty hardware waiting
 * for cables rather than a grid of noise.
 *
 * Click cable/slot to focus · drag ↕ amount · bottom rail focuses slots · double-click clears focus.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ModSource, ModDest, ModRoute } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  drawGlow,
  footer,
  grain,
  hexA,
  lattice,
  lit,
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 168;
const C = FC.matrix;
const C_DEEP = bandShade(FC.mod, 0.3);
const C_MID = bandShade(FC.mod, 0.52);
const C_HOT = bandShade(FC.mod, 0.72);
const C_GLOW = bandShade(FC.mod, 0.96);
const C_POS = bandShade(FC.mod, 0.88);
const C_NEG = bandShade(FC.mod, 0.42);

const SRC_META: { id: ModSource; label: string }[] = [
  { id: "lfo1", label: "L1" },
  { id: "lfo2", label: "L2" },
  { id: "modenv", label: "ME" },
  { id: "velocity", label: "Vel" },
  { id: "keytrack", label: "Key" },
  { id: "macro1", label: "M1" },
  { id: "macro2", label: "M2" },
  { id: "macro3", label: "M3" },
  { id: "macro4", label: "M4" },
  { id: "random", label: "Rnd" },
];

const DST_META: { id: ModDest; label: string }[] = [
  { id: "pitch", label: "Pit" },
  { id: "cutoff", label: "Cut" },
  { id: "resonance", label: "Res" },
  { id: "wtA", label: "MoA" },
  { id: "wtB", label: "MoB" },
  { id: "wtC", label: "MoC" },
  { id: "levelA", label: "LvA" },
  { id: "levelB", label: "LvB" },
  { id: "levelC", label: "LvC" },
  { id: "fm", label: "FM" },
  { id: "pan", label: "Pan" },
  { id: "volume", label: "Vol" },
  { id: "reverb", label: "Rev" },
  { id: "delay", label: "Dly" },
  // Dests the bay used to have no column for at all.
  { id: "chorusMix", label: "Cho" },
  { id: "phaserMix", label: "Pha" },
  { id: "drive", label: "Drv" },
  { id: "spectral", label: "Spc" },
];

/** Column index / label lookups — built once, so the paint never scans. */
const DST_COL: Partial<Record<ModDest, number>> = {};
const DST_LABEL: Partial<Record<ModDest, string>> = {};
for (let i = 0; i < DST_META.length; i++) {
  DST_COL[DST_META[i]!.id] = i;
  DST_LABEL[DST_META[i]!.id] = DST_META[i]!.label;
}
const SRC_LABEL: Partial<Record<ModSource, string>> = {};
const SRC_ROW: Partial<Record<ModSource, number>> = {};
for (let i = 0; i < SRC_META.length; i++) {
  SRC_LABEL[SRC_META[i]!.id] = SRC_META[i]!.label;
  SRC_ROW[SRC_META[i]!.id] = i;
}

/** Which destination columns currently carry a cable. */
const COL_USED = new Uint8Array(DST_META.length);

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function activeRoutes(mx: ModRoute[]) {
  return mx
    .map((r, i) => ({ ...r, slot: i }))
    .filter((r) => r.source !== "none" && r.dest !== "none");
}

/** Allocation-free change key over the whole matrix. */
function matrixKey(mx: ModRoute[]): number {
  let h = 2166136261;
  for (let i = 0; i < mx.length; i++) {
    const r = mx[i]!;
    const s = (DST_COL[r.dest] ?? 31) * 37 + (SRC_ROW[r.source] ?? 29) * 11;
    h ^= s + ((r.amount * 200) | 0) * 131 + i * 17 + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h |= 0;
  }
  return h;
}

/** Any live route keeps the packets flowing — a loop, so hints() never allocates. */
function anyPatched(mx: ModRoute[]): boolean {
  for (let i = 0; i < mx.length; i++) {
    const r = mx[i]!;
    if (r.source !== "none" && r.dest !== "none") return true;
  }
  return false;
}

type DragMode = "amt" | "slot" | null;

export type MatrixVizState = { routes: ModRoute[]; focus: number };

/**
 * Paint the patch bay. Exported and pure so it renders headlessly without
 * mounting the component.
 */
export function paintMatrix(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: MatrixVizState,
  now: number,
  flash: number,
): void {
  const t = now / 1000;
  const mx = p.routes;
  const focus = p.focus;

  let n = 0;
  for (let i = 0; i < mx.length; i++) {
    const r = mx[i]!;
    if (r.source !== "none" && r.dest !== "none") n++;
  }
  const energy = 0.12 + Math.min(1, n / 6) * 0.33 + flash * 0.24;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });
  lattice(ctx, W, Hh, C_MID, 14, 0.05);

  // ── bay geometry ──
  const jackX = 68;
  const topY = 24;
  const botY = Hh * 0.72;
  const bayL = jackX + 48;
  const bayR = W - 44;
  const cols = DST_META.length;
  const colGap = (bayR - bayL) / Math.max(1, cols - 1);
  // Rails hang low enough that the DST column names above them clear the
  // reserved top strip.
  const railTop = topY + 14;
  const railBot = botY - 8;
  const colX = (i: number) => bayL + i * colGap;

  // Source bay: the vertical strip every cable leaves from.
  ctx.fillStyle = hexA(C_MID, 0.1);
  ctx.fillRect(jackX - 12, topY - 6, 24, botY - topY + 12);
  ctx.strokeStyle = hexA(C_HOT, 0.26);
  ctx.lineWidth = 1;
  ctx.strokeRect(jackX - 11.5, topY - 5.5, 23, botY - topY + 11);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_GLOW, 0.7);
  ctx.fillText("SRC", jackX, botY + 4);

  // Destination terminal rails.
  ctx.fillStyle = hexA(C_POS, 0.16);
  ctx.fillRect(bayL - 6, railTop, bayR - bayL + 12, 1);
  ctx.fillStyle = hexA(C_NEG, 0.16);
  ctx.fillRect(bayL - 6, railBot, bayR - bayL + 12, 1);

  COL_USED.fill(0);
  for (let i = 0; i < mx.length; i++) {
    const r = mx[i]!;
    if (r.source === "none" || r.dest === "none") continue;
    const ci = DST_COL[r.dest];
    if (ci != null) COL_USED[ci] = 1;
  }

  // Bare column ticks for the whole bay.
  for (let i = 0; i < cols; i++) {
    const x = colX(i);
    const used = COL_USED[i] === 1;
    ctx.fillStyle = hexA(used ? C_HOT : C_MID, used ? 0.3 : 0.1);
    ctx.fillRect(x, railTop, 1, railBot - railTop);
    if (used) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_GLOW, 0.85);
      ctx.fillText(DST_META[i]!.label, x, railTop - 5);
    } else {
      ctx.fillStyle = hexA(C_MID, 0.22);
      ctx.fillRect(x - 1.5, railTop - 3, 3, 2);
    }
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_GLOW, 0.7);
  ctx.fillText("DST", W - 8, railTop - 6);

  if (n === 0) {
    ctx.fillStyle = hexA(C_MID, 0.55);
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LOOM IDLE — patch a cell below", W / 2, Hh * 0.44);
  } else {
    // ── cables ──
    let ai = 0;
    for (let slot = 0; slot < mx.length; slot++) {
      const r = mx[slot]!;
      if (r.source === "none" || r.dest === "none") continue;
      const i = ai++;
      const y1 = topY + ((i + 0.5) / n) * (botY - topY);
      const ci = DST_COL[r.dest] ?? 0;
      const cx = colX(ci);
      const mag = Math.abs(r.amount);
      const up = r.amount >= 0;
      const col = up ? C_POS : C_NEG;
      const focused = slot === focus;
      const endY = up ? railTop : railBot;
      const elbowX = Math.max(jackX + 14, cx - 8);
      const stubDir = up ? -1 : 1;
      const width = 1 + mag * 3.4 + (focused ? 1 : 0);

      // Cable: out of the jack, along the bay, elbow onto the column, post home.
      const path = () => {
        ctx.moveTo(jackX + 6, y1);
        ctx.lineTo(elbowX, y1);
        ctx.quadraticCurveTo(cx, y1, cx, y1 + stubDir * Math.min(9, Math.abs(endY - y1)));
        ctx.lineTo(cx, endY);
      };
      lit(ctx, () => {
        ctx.strokeStyle = hexA(col, (focused ? 0.2 : 0.1) + mag * 0.16);
        ctx.lineWidth = width + 5;
        ctx.beginPath();
        path();
        ctx.stroke();
      });
      ctx.strokeStyle = hexA(col, 0.42 + mag * 0.45 + (focused ? 0.15 : 0));
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      path();
      ctx.stroke();

      // Flowing packets — speed rides the route's own depth.
      const horiz = elbowX - (jackX + 6);
      const vert = Math.abs(endY - y1);
      const total = Math.max(1, horiz + vert);
      const pk = mag > 0.55 ? 3 : 2;
      lit(ctx, () => {
        for (let k = 0; k < pk; k++) {
          const u = ((t * (0.24 + mag * 0.5) + i * 0.13 + k / pk) % 1 + 1) % 1;
          const d = u * total;
          const px = d < horiz ? jackX + 6 + d : cx;
          const py = d < horiz ? y1 : y1 + stubDir * (d - horiz);
          drawGlow(ctx, px, py, 4 + mag * 5, C_GLOW, 0.45 + mag * 0.4);
        }
      });

      // Source jack.
      ctx.fillStyle = hexA(col, 0.9);
      ctx.beginPath();
      ctx.arc(jackX, y1, 3 + mag * 1.4 + (focused ? 1 : 0), 0, Math.PI * 2);
      ctx.fill();
      if (focused) lit(ctx, () => drawGlow(ctx, jackX, y1, 14, C_GLOW, 0.7));
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "right";
      ctx.fillStyle = hexA(col, focused ? 0.98 : 0.68);
      ctx.fillText(SRC_LABEL[r.source] ?? r.source, jackX - 14, y1 + 3);
      // Depth rides just above its own cable, clear of both terminal rails.
      ctx.font = VIZ_FONT_VALUE;
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(focused ? C_GLOW : col, focused ? 0.95 : 0.6);
      ctx.fillText(`${r.amount >= 0 ? "+" : ""}${Math.round(r.amount * 100)}`, jackX + 10, y1 - 3);

      // Terminal: an arrow into the rail, so polarity reads as direction.
      ctx.fillStyle = hexA(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(cx - 4, endY - stubDir * 5);
      ctx.lineTo(cx + 4, endY - stubDir * 5);
      ctx.lineTo(cx, endY + stubDir * 2);
      ctx.closePath();
      ctx.fill();
      if (focused) lit(ctx, () => drawGlow(ctx, cx, endY, 15, C_GLOW, 0.8));
    }
  }

  // Focus chip.
  const fr = mx[focus];
  pill(
    ctx,
    W * 0.5,
    3,
    fr && fr.source !== "none" && fr.dest !== "none"
      ? `S${focus + 1} · ${fr.source}→${fr.dest}`
      : `S${focus + 1} · empty`,
    C_GLOW,
    { glow: flash },
  );

  // ── slot rail ──
  const railY = Hh - 30;
  const railX = 12;
  const railW = W - 24;
  const slotW = railW / 12;
  for (let i = 0; i < 12; i++) {
    const r = mx[i];
    const on = !!r && r.source !== "none" && r.dest !== "none";
    const sx = railX + i * slotW;
    const col = !on ? C_MID : r!.amount >= 0 ? C_POS : C_NEG;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(sx + 1, railY, slotW - 2, 7);
    if (on) {
      const hBar = 5 * Math.abs(r!.amount);
      ctx.fillStyle = hexA(col, 0.72);
      ctx.fillRect(sx + 2, railY + 6 - hBar, slotW - 4, Math.max(1, hBar));
    }
    if (i === focus) {
      ctx.strokeStyle = hexA(C_GLOW, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, railY - 0.5, slotW - 1, 8);
      lit(ctx, () => drawGlow(ctx, sx + slotW * 0.5, railY + 3.5, 9 + flash * 4, C_GLOW, 0.5));
    }
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_HOT, 0.75);
  ctx.fillText("SLOTS · drag ↕ depth", railX + 2, railY - 4);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_HOT, 0.6);
  ctx.fillText(`${n}/12 PATCHED`, railX + railW - 2, railY - 4);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  footer(ctx, W, Hh, "MTX · PATCH LOOM", n ? `${n} LIVE` : "IDLE", C_GLOW, n ? C_HOT : C_MID);
}

export function MatrixStageViz() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const focusRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const dragStartY = useRef(0);
  const dragStartAmt = useRef(0);
  const prevKey = useRef(0);
  const st = useRef<MatrixVizState>({ routes: matrix, focus: focusRef.current });
  st.current = { routes: matrix, focus: focusRef.current };

  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none").length;
  const live = used > 0;

  useEffect(() => {
    const key = matrixKey(matrix);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [matrix]);

  const focusSlot = useCallback((slot: number) => {
    focusRef.current = clamp(slot, 0, Math.max(0, st.current.routes.length - 1));
    st.current.focus = focusRef.current;
    flashRef.current = 1;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);

      if (y > H * 0.78) {
        const slot = clamp(Math.floor(x * 12), 0, 11);
        focusSlot(slot);
        dragRef.current = "slot";
        dragStartY.current = e.clientY;
        dragStartAmt.current = st.current.routes[slot]?.amount ?? 0;
        wrap.setPointerCapture(e.pointerId);
        return;
      }

      // Focus nearest active route by Y, or first active
      const act = activeRoutes(st.current.routes);
      if (act.length > 0) {
        const n = act.length;
        const idx = clamp(Math.floor(((y - 20) / Math.max(1, H * 0.7 - 20)) * n), 0, n - 1);
        const route = act[idx]!;
        focusSlot(route.slot);
        dragRef.current = "amt";
        dragStartY.current = e.clientY;
        dragStartAmt.current = route.amount;
        wrap.setPointerCapture(e.pointerId);
      }
    },
    [focusSlot, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const mode = dragRef.current;
      if (!mode) return;
      const slot = focusRef.current;
      const r = st.current.routes[slot];
      if (!r || r.source === "none" || r.dest === "none") {
        // Slot focus only — still allow amount if we activate? skip
        if (mode === "slot" && r && (r.source !== "none" || r.dest !== "none")) {
          const amount = clamp(dragStartAmt.current + (dragStartY.current - e.clientY) / 110, -1, 1);
          setModRoute(slot, { amount: Math.round(amount * 100) / 100 });
        }
        return;
      }
      const amount = clamp(dragStartAmt.current + (dragStartY.current - e.clientY) / 110, -1, 1);
      setModRoute(slot, { amount: Math.round(amount * 100) / 100 });
    },
    [setModRoute],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(() => {
    const slot = focusRef.current;
    const r = st.current.routes[slot];
    if (r && r.source !== "none" && r.dest !== "none") {
      setModRoute(slot, { source: "none", dest: "none", amount: 0 });
    } else {
      // Jump focus to next active
      const act = activeRoutes(st.current.routes);
      if (act.length) {
        const i = act.findIndex((a) => a.slot === slot);
        const next = act[(i + 1) % act.length]!;
        focusSlot(next.slot);
      }
    }
  }, [setModRoute, focusSlot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintMatrix(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        // Packets crawl the live cables, so any patched route keeps painting.
        active: anyPatched(st.current.routes),
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(matrixKey(st.current.routes), st.current.focus),
      }),
      { minIntervalMs: 22 },
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
        cursor: "ns-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexA(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Click cable/slot to focus · drag ↕ amount · bottom: slots · double-click: clear focus"
      role="img"
      aria-label="Modulation matrix patch loom"
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
        Patch Loom
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexA(C_HOT, 0.75) }}
      >
        {used}/12
      </div>
    </div>
  );
}
