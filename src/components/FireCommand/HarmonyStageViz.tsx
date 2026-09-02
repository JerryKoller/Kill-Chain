/**
 * Harmony — Kin Halo stage visualizer.
 *
 * IDIOM: the interval stack on a pitch axis. Two octaves of semitones run
 * left→right, in-scale degrees standing taller than the chromatic dust between
 * them. The played root is lit at the origin and each companion is lit at its
 * real (scale-walked) distance, with a labelled span bracket drawn between them
 * — so the mode reads as a measured interval, not an abstract halo. `level` is
 * the companions' brightness and stem height; the root never dims.
 *
 * Scale-locked companion voices (Signal Path Perf · FC.harmony).
 * Click constellation to cycle mode · drag level rail · double-click cycles.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES, inScale, type ScaleId } from "@/state/fireSequencerStore";
import type { HarmonyMode } from "@/audio/dsp/FireCommandSynth";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { useStageCanvas } from "./useStageCanvas";
import {
  bezel,
  drawGlow,
  footer,
  glowStroke,
  grain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  strata,
  VIZ_FONT_LABEL,
  VIZ_FONT_VALUE,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 168;
const C = FC.harmony;
const C_DEEP = bandShade(FC_BAND.perf, 0.32);
const C_MID = bandShade(FC_BAND.perf, 0.48);
const C_HOT = bandShade(FC_BAND.perf, 0.62);
const C_GLOW = bandShade(FC_BAND.perf, 0.92);
const C_ROOT = bandShade(FC_BAND.perf, 0.55);
const C_KIN = bandShade(FC_BAND.perf, 0.78);
const C_LINK = bandShade(FC_BAND.perf, 0.7);

export const HARMONY_MODES: { id: HarmonyMode; label: string; short: string; voices: number; intervals: string }[] = [
  { id: "off", label: "Off", short: "OFF", voices: 1, intervals: "—" },
  { id: "third", label: "Third", short: "3rd", voices: 2, intervals: "+3" },
  { id: "fifth", label: "Fifth", short: "5th", voices: 2, intervals: "+5" },
  { id: "octave", label: "Octave", short: "Oct", voices: 2, intervals: "+8ve" },
  { id: "triad", label: "Triad", short: "Tri", voices: 3, intervals: "+3 · +5" },
];

export function harmonyVoiceCount(mode: HarmonyMode): number {
  return HARMONY_MODES.find((m) => m.id === mode)?.voices ?? 1;
}

export function harmonyModeLabel(mode: HarmonyMode): string {
  return HARMONY_MODES.find((m) => m.id === mode)?.label ?? mode;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Walk `degrees` scale tones up from `from` — mirrors the engine's companion walk. */
function scaleUp(from: number, degrees: number, root: number, id: ScaleId): number {
  let m = from;
  for (let d = 0; d < degrees; d++) {
    let next = m + 1;
    while (next <= m + 12 && !inScale(next, root, id)) next++;
    m = next;
  }
  return m;
}

/**
 * Companion distances in semitones above the played root, resolved the same way
 * the note path resolves them: diatonic walk in a scale, major-ish fallback
 * when the scale is chromatic.
 */
export function harmonyOffsets(mode: HarmonyMode, root: number, id: ScaleId): number[] {
  if (mode === "off") return [];
  if (mode === "octave") return [12];
  if (id === "off") return mode === "third" ? [4] : mode === "fifth" ? [7] : [4, 7];
  const base = 60 + (((root % 12) + 12) % 12);
  const third = scaleUp(base, 2, root, id) - base;
  const fifth = scaleUp(base, 4, root, id) - base;
  return mode === "third" ? [third] : mode === "fifth" ? [fifth] : [third, fifth];
}

/** Interval shorthand for the bracket labels. */
function ivName(n: number): string {
  if (n === 3) return "m3";
  if (n === 4) return "M3";
  if (n === 5) return "4th";
  if (n === 6) return "tt";
  if (n === 7) return "5th";
  if (n === 8) return "m6";
  if (n === 9) return "M6";
  if (n === 10) return "m7";
  if (n === 11) return "M7";
  if (n === 12) return "8ve";
  return `${n}st`;
}

type DragMode = "level" | "cycle" | null;

export type HarmonyVizState = {
  mode: HarmonyMode;
  level: number;
  enabled: boolean;
  scaleRoot: number;
  scaleId: ScaleId;
  /** Companion offsets in semitones above the root. */
  offsets: number[];
  /** In-scale degrees (0..11) of the current scale. */
  degrees: number[];
  /** Index into SCALES — two scales can share both offsets and degree count. */
  scaleIdx: number;
};

const AXIS_SEMIS = 24;

/**
 * Paint the interval stack. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintHarmony(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: HarmonyVizState,
  now: number,
  flash: number,
): void {
  const meta = HARMONY_MODES.find((m) => m.id === p.mode) ?? HARMONY_MODES[0]!;
  const active = p.enabled && p.mode !== "off";
  const level = clamp(p.level, 0, 1);
  const dim = p.enabled ? 1 : 0.42;
  const rootPc = (((p.scaleRoot % 12) + 12) % 12);
  const breath = 0.9 + 0.1 * Math.sin(now * 0.0015);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy: 0.08 + (active ? level * 0.34 : 0) + flash * 0.16, horizon: 0.7 });
  strata(ctx, W, Hh, C, { count: 4, horizon: 0.14, alpha: 0.05 });

  const padL = 34;
  const padR = 34;
  const span = Math.max(80, W - padL - padR);
  const axisY = Hh * 0.7;
  const xOf = (semi: number) => padL + (clamp(semi, 0, AXIS_SEMIS) / AXIS_SEMIS) * span;

  // ── the pitch axis ──
  ctx.fillStyle = hexA(C_MID, 0.24);
  ctx.fillRect(padL, axisY, span, 1);
  for (let s = 0; s <= AXIS_SEMIS; s++) {
    const x = xOf(s);
    const deg = ((s % 12) + 12) % 12;
    const inS = p.degrees.length === 0 || p.degrees.includes(deg);
    const oct = s % 12 === 0;
    const h = oct ? 11 : inS ? 7 : 3;
    ctx.fillStyle = hexA(inS ? C_KIN : C, oct ? 0.5 : inS ? 0.3 : 0.12);
    ctx.fillRect(x - 0.5, axisY - h, 1, h);
    if (inS) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(inS ? C_MID : C, oct ? 0.6 : 0.34);
      ctx.fillText(NOTE_NAMES[(rootPc + s) % 12] ?? "", x, axisY + 12);
    }
    if (oct) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_MID, 0.42);
      ctx.fillText(s === 0 ? "0" : s === 12 ? "+12" : "+24", x, axisY + 23);
    }
  }

  /** One lit pitch: stem up from the axis, orb at the top, dim mirror below. */
  const litPitch = (semi: number, colr: string, stemH: number, a: number, label: string, side: boolean) => {
    const x = xOf(semi);
    const top = axisY - stemH;
    glowStroke(
      ctx,
      () => {
        ctx.moveTo(x, axisY);
        ctx.lineTo(x, top);
      },
      colr,
      { width: 1.6, glow: a, alpha: a * 0.85 },
    );
    ctx.fillStyle = hexA(colr, a * 0.22);
    ctx.fillRect(x - 0.5, axisY + 1, 1, stemH * 0.3);
    lit(ctx, () => {
      drawGlow(ctx, x, top, (7 + stemH * 0.22) * breath, C_GLOW, a);
      ctx.fillStyle = hexA(C_GLOW, Math.min(1, a + 0.2));
      ctx.beginPath();
      ctx.arc(x, top, 2.6 + a * 1.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = VIZ_FONT_LABEL;
    ctx.fillStyle = hexA(colr, Math.min(1, a + 0.15));
    if (side) {
      // Clear of the span brackets stacked directly above the companions.
      ctx.textAlign = "left";
      ctx.fillText(label, x + 7, top + 3);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(label, x, top - 8);
    }
  };

  // ── root + companions ──
  litPitch(0, C_ROOT, 30, 0.85 * dim, "ROOT", false);
  const nOff = p.offsets.length;
  for (let k = 0; k < nOff; k++) {
    const semi = p.offsets[k]!;
    const a = (active ? 0.28 + level * 0.62 : 0.16) * dim;
    litPitch(semi, C_KIN, 20 + level * 14, a, `+${semi}`, true);

    // Span bracket: root → companion, stacked so pairs never overlap.
    const by = axisY - 46 - k * 18;
    const x0 = xOf(0);
    const x1 = xOf(semi);
    const ba = (active ? 0.3 + level * 0.45 : 0.14) * dim;
    ctx.strokeStyle = hexA(C_LINK, ba);
    ctx.lineWidth = 1 + level * 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, by + 5);
    ctx.lineTo(x0, by);
    ctx.lineTo(x1, by);
    ctx.lineTo(x1, by + 5);
    ctx.stroke();
    const mx = (x0 + x1) * 0.5;
    ctx.font = VIZ_FONT_VALUE;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, (active ? 0.6 + level * 0.35 : 0.3) * dim);
    ctx.fillText(`${ivName(semi)} · +${semi}`, mx, by - 4);
    if (active && level > 0.05) {
      // A single travelling pip per span — the companion being fed.
      const t = (now * (0.00018 + level * 0.0004) + k * 0.37) % 1;
      lit(ctx, () => drawGlow(ctx, x0 + (x1 - x0) * t, by, 6 + level * 5, C_GLOW, 0.25 + level * 0.45));
    }
  }

  if (!active) {
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_MID, 0.4 * dim);
    ctx.fillText(p.enabled ? "NO COMPANIONS — ROOT ONLY" : "ASLEEP", W * 0.5, axisY - 60);
  }

  // ── telemetry ──
  const rootName = NOTE_NAMES[rootPc] ?? "?";
  const scaleLabel = SCALES.find((sc) => sc.id === p.scaleId)?.label ?? p.scaleId;
  // Packed left-to-right from the reserved top strip and stopped short of the
  // centred mode pill, so it can't collide at any panel width.
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
  tel(`KEY ${rootName.toUpperCase()} · ${scaleLabel.toUpperCase()}`, C_GLOW, 0.7 * dim, VIZ_FONT_LABEL);
  tel(`LEVEL ${Math.round(level * 100)} · ${meta.voices}v`, C_KIN, 0.72, VIZ_FONT_VALUE);

  pill(ctx, W * 0.5, 3, !p.enabled ? "ASLEEP" : meta.short.toUpperCase(), C_GLOW, { glow: flash });

  // ── level rail (bottom drag zone) ──
  const railY = Hh - 25;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(12, railY, W - 24, 6);
  ctx.fillStyle = hexA(C_HOT, 0.5 * dim);
  ctx.fillRect(12, railY + 1, Math.max(2, (W - 24) * level), 4);
  lit(ctx, () => drawGlow(ctx, 12 + (W - 24) * level, railY + 3, 7 + flash * 4, C_GLOW, 0.8 * dim));

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    !p.enabled ? "KIN HALO · ASLEEP" : active ? `KIN HALO · ${meta.short.toUpperCase()}` : "KIN HALO · SILENT",
    `${rootName} ${scaleLabel} · ${Math.round(level * 100)}% · ${meta.voices}v`,
    C_GLOW,
    C,
  );
}

export function HarmonyStageViz() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode) ?? "off";
  const level = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0.6;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["harmony"] !== false);
  const scaleRoot = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef(0);

  const offsets = harmonyOffsets(mode, scaleRoot, scaleId);
  const degrees = scaleId === "off" ? [] : SCALES.find((sc) => sc.id === scaleId)?.steps ?? [];
  const scaleIdx = SCALES.findIndex((sc) => sc.id === scaleId);
  const st = useRef<HarmonyVizState>({ mode, level, enabled, scaleRoot, scaleId, offsets, degrees, scaleIdx });
  st.current = { mode, level, enabled, scaleRoot, scaleId, offsets, degrees, scaleIdx };

  const live = enabled && mode !== "off" && level > 0.02;

  useEffect(() => {
    const key = motionHash(HARMONY_MODES.findIndex((m) => m.id === mode), level, enabled, scaleRoot, scaleIdx);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mode, level, enabled, scaleRoot, scaleIdx]);

  const cycleMode = useCallback(
    (dir = 1) => {
      const ids = HARMONY_MODES.map((m) => m.id);
      const i = ids.indexOf(st.current.mode);
      const next = ids[(i + dir + ids.length) % ids.length]!;
      setParam("harmonyMode", next);
      flashRef.current = 1;
    },
    [setParam],
  );

  const applyLevel = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("harmonyLevel", Math.round(x * 1000) / 1000);
    },
    [setParam, wrapRef],
  );

  const hitTest = useCallback(
    (clientY: number): DragMode => {
      const wrap = wrapRef.current;
      if (!wrap) return "cycle";
      const rect = wrap.getBoundingClientRect();
      const y = (clientY - rect.top) / Math.max(1, rect.height);
      if (y > 0.82) return "level";
      return "cycle";
    },
    [wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const modeHit = hitTest(e.clientY);
      dragRef.current = modeHit;
      flashRef.current = 1;
      if (modeHit === "level") applyLevel(e.clientX);
      else cycleMode(1);
    },
    [applyLevel, cycleMode, hitTest],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragRef.current !== "level") return;
      applyLevel(e.clientX);
    },
    [applyLevel],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintHarmony(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        // Only the span pips and the breath animate — silence can sleep.
        active: st.current.enabled && st.current.mode !== "off" && st.current.level > 0.02,
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          HARMONY_MODES.findIndex((m) => m.id === st.current.mode),
          st.current.level,
          st.current.enabled,
          st.current.scaleRoot,
          st.current.offsets.length,
          st.current.degrees.length,
        ),
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-pointer touch-none select-none"
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
      role="img"
      aria-label="Kin halo — click to cycle mode, scrub level"
      title="Click cycles mode · Bottom: Level"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
