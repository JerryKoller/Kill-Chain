/**
 * Chord Memory — Stack Vault stage visualizer.
 *
 * IDIOM: interval columns. A root line runs the width and each memorised voice
 * stands on it as a column whose height is its distance in semitones, spread
 * left→right in voicing order. Every chord tone also throws a full-width
 * horizontal rule labelled at the right edge, so the stack reads like a chord
 * chart: an inversion visibly reorders the column profile, an added interval
 * adds a column and pushes a new rule up the plot.
 *
 * Memorized interval stack for live input (Signal Path Perf · FC.chord).
 * Click bars to nudge intervals · bottom toggles memory · double-click cycles presets.
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
  grain,
  hexA,
  lit,
  motionHash,
  pill,
  plate,
  roundRect,
  VIZ_FONT_LABEL,
  VIZ_FONT_TITLE,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 168;
const C = FC.chord;
const C_DEEP = bandShade(FC_BAND.perf, 0.4);
const C_MID = bandShade(FC_BAND.perf, 0.55);
const C_HOT = bandShade(FC_BAND.perf, 0.7);
const C_GLOW = bandShade(FC_BAND.perf, 0.95);
const C_ROOT = bandShade(FC_BAND.perf, 0.58);
const C_VOICE = bandShade(FC_BAND.perf, 0.82);
const C_ARM = bandShade(FC_BAND.perf, 0.75);

export const CHORD_PRESETS: { id: string; name: string; short: string; ivs: number[] }[] = [
  { id: "maj", name: "Major", short: "Maj", ivs: [0, 4, 7] },
  { id: "min", name: "Minor", short: "Min", ivs: [0, 3, 7] },
  { id: "sus2", name: "Sus2", short: "Sus2", ivs: [0, 2, 7] },
  { id: "sus4", name: "Sus4", short: "Sus4", ivs: [0, 5, 7] },
  { id: "power", name: "Power", short: "5", ivs: [0, 7] },
  { id: "maj7", name: "Maj7", short: "M7", ivs: [0, 4, 7, 11] },
  { id: "min7", name: "Min7", short: "m7", ivs: [0, 3, 7, 10] },
  { id: "dom7", name: "Dom7", short: "7", ivs: [0, 4, 7, 10] },
  { id: "dim", name: "Dim", short: "Dim", ivs: [0, 3, 6] },
  { id: "aug", name: "Aug", short: "Aug", ivs: [0, 4, 8] },
  { id: "add9", name: "Add9", short: "Add9", ivs: [0, 4, 7, 14] },
  { id: "min9", name: "Min9", short: "m9", ivs: [0, 3, 7, 14] },
];

export function normalizeChordIvs(ivs: number[] | undefined): number[] {
  const raw = (ivs?.length ? ivs : [0, 4, 7]).map((n) => Math.round(n));
  const uniq = Array.from(new Set(raw)).sort((a, b) => a - b);
  if (!uniq.includes(0)) uniq.unshift(0);
  return uniq.slice(0, 6);
}

export function chordMatch(a: number[], b: number[]): boolean {
  const aa = normalizeChordIvs(a);
  const bb = normalizeChordIvs(b);
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

export function chordPresetLabel(ivs: number[]): string {
  const hit = CHORD_PRESETS.find((p) => chordMatch(ivs, p.ivs));
  return hit?.short ?? "Custom";
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Interval shorthand for the column and rule labels. */
function ivName(n: number): string {
  if (n === 0) return "root";
  if (n === 1) return "m2";
  if (n === 2) return "M2";
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
  if (n === 14) return "9th";
  if (n === 17) return "11th";
  return `+${n}`;
}

type DragMode = "nudge" | "arm" | null;

/** Semitones the plot spans — matches the nudge range so drag tracks the column. */
const IV_SPAN = 19;

export type ChordVizState = {
  on: boolean;
  /** Normalized interval stack, root first. */
  ivs: number[];
  enabled: boolean;
  /** Preset shorthand for the chip (resolved outside the paint path). */
  label: string;
  /** Voice being dragged, −1 when idle. */
  dragVoice: number;
};

/**
 * Paint the interval columns. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintChord(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ChordVizState,
  now: number,
  flash: number,
): void {
  const list = p.ivs;
  const n = Math.max(1, list.length);
  const armed = p.enabled && p.on;
  const dim = p.enabled ? 1 : 0.45;
  const breath = 0.92 + 0.08 * Math.sin(now * 0.0014);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy: 0.08 + (armed ? 0.26 : 0.02) + flash * 0.16, horizon: 0.74 });

  const padL = 34;
  const padR = 68;
  const span = Math.max(80, W - padL - padR);
  const topY = 30;
  const rootY = Hh - 44;
  const plotH = rootY - topY;
  const yOf = (iv: number) => rootY - (clamp(iv, 0, IV_SPAN) / IV_SPAN) * plotH;

  // ── semitone scale down the left edge ──
  for (let s = 0; s <= IV_SPAN; s++) {
    const y = yOf(s);
    const mark = s === 0 || s === 12 || s === 7 || s === 19;
    ctx.fillStyle = hexA(C_MID, mark ? 0.24 : 0.08);
    ctx.fillRect(padL - (mark ? 9 : 5), y, mark ? 9 : 5, 1);
    if (mark) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "right";
      ctx.fillStyle = hexA(C_MID, 0.45);
      ctx.fillText(`${s}`, padL - 11, y + 3);
    }
  }

  // ── one full-width rule per chord tone: the chart the columns are read against ──
  for (let i = 0; i < n; i++) {
    const iv = list[i]!;
    const y = yOf(iv);
    const isRoot = iv === 0;
    const col = isRoot ? C_ROOT : C_VOICE;
    const a = (armed ? 0.3 + (isRoot ? 0.2 : 0.1) : 0.12) * dim;
    ctx.save();
    if (!isRoot) ctx.setLineDash([6, 5]);
    ctx.strokeStyle = hexA(col, a);
    ctx.lineWidth = isRoot ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - 12, y);
    ctx.stroke();
    ctx.restore();
    ctx.font = VIZ_FONT_VALUE;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(isRoot ? C_ROOT : C_GLOW, (armed ? 0.8 : 0.4) * dim);
    ctx.fillText(isRoot ? "ROOT" : `+${iv} ${ivName(iv)}`, W - 14, y - 4);
  }

  // ── the columns ──
  const slotW = span / n;
  const colW = Math.min(104, slotW * 0.46);
  for (let i = 0; i < n; i++) {
    const iv = list[i]!;
    const isRoot = iv === 0;
    const cx = padL + (i + 0.5) * slotW;
    const top = yOf(iv);
    const h = Math.max(isRoot ? 7 : 3, rootY - top);
    const col = isRoot ? C_ROOT : C_VOICE;
    const held = p.dragVoice === i;

    // Plinth shadow so the column sits on the root line.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(ctx, cx - colW * 0.5 - 3, rootY - 2, colW + 6, 6, 2);
    ctx.fill();

    const body = cachedGrad(ctx, `col|${col}|${topY}|${rootY}|${armed ? 1 : 0}`, (c) => {
      const g = c.createLinearGradient(0, topY, 0, rootY);
      g.addColorStop(0, hexA(col, armed ? 0.85 : 0.34));
      g.addColorStop(1, hexA(C_DEEP, armed ? 0.3 : 0.12));
      return g;
    });
    ctx.save();
    ctx.globalAlpha = dim * (armed ? breath : 1);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.rect(cx - colW * 0.5, top, colW, h);
    ctx.clip();
    ctx.fillRect(cx - colW * 0.5, topY, colW, rootY - topY);
    ctx.restore();

    // Semitone rungs inside the column — you can count the interval.
    if (iv > 0) {
      ctx.fillStyle = hexA(C_GLOW, (armed ? 0.22 : 0.1) * dim);
      for (let k = 1; k <= Math.min(iv, IV_SPAN); k++) {
        const ry = yOf(k);
        ctx.fillRect(cx - colW * 0.5 + 2, ry, colW - 4, 1);
      }
    }

    // Cap + edges.
    ctx.fillStyle = hexA(C_GLOW, (armed ? 0.9 : 0.45) * dim);
    ctx.fillRect(cx - colW * 0.5, top - 1.5, colW, 2.5);
    ctx.strokeStyle = hexA(col, (held ? 0.95 : armed ? 0.5 : 0.22) * dim);
    ctx.lineWidth = held ? 1.8 : 1;
    ctx.strokeRect(cx - colW * 0.5 + 0.5, top + 0.5, colW - 1, h - 1);
    if (armed) {
      lit(ctx, () => drawGlow(ctx, cx, top, 14 + (held ? 10 : 0) + flash * 6, C_GLOW, 0.35 + (held ? 0.3 : 0)));
    }

    // Interval label on the cap, voice tag under the root line.
    ctx.textAlign = "center";
    ctx.font = VIZ_FONT_TITLE;
    ctx.fillStyle = hexA(C_GLOW, (armed ? 0.95 : 0.5) * dim);
    ctx.fillText(isRoot ? "0" : `+${iv}`, cx, top + (h > 22 ? 13 : -6));
    ctx.font = VIZ_FONT_LABEL;
    ctx.fillStyle = hexA(col, (armed ? 0.7 : 0.35) * dim);
    ctx.fillText(ivName(iv), cx, top + (h > 34 ? 24 : -15));

    ctx.fillStyle = hexA(col, (armed ? 0.7 : 0.3) * dim);
    ctx.beginPath();
    ctx.moveTo(cx - 4, rootY + 8);
    ctx.lineTo(cx + 4, rootY + 8);
    ctx.lineTo(cx, rootY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.font = VIZ_FONT_LABEL;
    ctx.fillStyle = hexA(C_MID, 0.5 * dim);
    ctx.fillText(`V${i + 1}`, cx, rootY + 17);
  }

  // ── root line ──
  ctx.fillStyle = hexA(C_ROOT, 0.5 * dim);
  ctx.fillRect(padL - 10, rootY, W - padL - 2, 1.6);
  if (armed) {
    lit(ctx, () => drawGlow(ctx, padL + span * 0.5, rootY, 40 + flash * 14, C_ROOT, 0.12));
  }

  // ── preset strip + telemetry ──
  const padX = 10;
  const usable = W - padX * 2;
  const stripY = 18;
  const presetIdx = CHORD_PRESETS.findIndex((q) => chordMatch(list, q.ivs));
  const segW = usable / CHORD_PRESETS.length;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(padX, stripY, usable, 6);
  for (let i = 0; i < CHORD_PRESETS.length; i++) {
    ctx.fillStyle = i === presetIdx ? hexA(C_HOT, 0.8 + flash * 0.2) : hexA(C, 0.1);
    ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, 4);
  }
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLOW, 0.7 * dim);
  ctx.fillText(`VOICING · ${p.label.toUpperCase()}`, padX, 16);
  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_VOICE, 0.72);
  ctx.fillText(`${n}v · SPREAD ${list[n - 1] ?? 0}st`, W - padX, 16);

  pill(ctx, W * 0.5, 3, !p.enabled ? "BYPASS" : armed ? p.label.toUpperCase() : "IDLE", C_GLOW, { glow: flash });

  // ── arm rail (bottom drag zone) ──
  const railY = Hh - 25;
  const armT = !p.enabled ? 0 : p.on ? 1 : 0.12;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padX, railY, usable, 6);
  ctx.fillStyle = hexA(C_ARM, 0.5 * dim);
  ctx.fillRect(padX, railY + 1, Math.max(2, usable * armT), 4);
  lit(ctx, () => drawGlow(ctx, padX + usable * armT, railY + 3, 7 + flash * 4, C_GLOW, 0.8 * dim));

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    !p.enabled ? "STACK VAULT · BYPASS" : armed ? `STACK VAULT · ${p.label.toUpperCase()}` : "STACK VAULT · IDLE",
    `${list.map((v) => (v === 0 ? "0" : `+${v}`)).join(" ")} · ${n}v`,
    C_GLOW,
    C,
  );
}

export function ChordStageViz() {
  const on = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const ivs = useFireCommandStore((s) => s.patch.chordIntervals);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["chord"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const dragVoiceRef = useRef(-1);
  const prevKey = useRef(0);
  const list = normalizeChordIvs(ivs);
  const st = useRef<ChordVizState>({
    on,
    ivs: list,
    enabled,
    label: chordPresetLabel(list),
    dragVoice: -1,
  });
  st.current = {
    on,
    ivs: list,
    enabled,
    label: chordPresetLabel(list),
    dragVoice: dragVoiceRef.current,
  };

  const live = enabled && on;

  useEffect(() => {
    const key = motionHash(on, enabled, list.length, list[1], list[2], list[3], list[4], list[5]);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [on, enabled, ivs, list]);

  const setIvs = useCallback(
    (next: number[]) => {
      setParam("chordIntervals", normalizeChordIvs(next));
      flashRef.current = 1;
    },
    [setParam],
  );

  const cyclePreset = useCallback(
    (dir = 1) => {
      const cur = normalizeChordIvs(st.current.ivs);
      let best = 0;
      for (let i = 0; i < CHORD_PRESETS.length; i++) {
        if (chordMatch(cur, CHORD_PRESETS[i]!.ivs)) {
          best = i;
          break;
        }
      }
      const next = CHORD_PRESETS[(best + dir + CHORD_PRESETS.length) % CHORD_PRESETS.length]!;
      setIvs([...next.ivs]);
    },
    [setIvs],
  );

  /** Columns are spread across the width, so the voice under the pointer is an x. */
  const hitVoice = useCallback(
    (clientX: number): number => {
      const wrap = wrapRef.current;
      if (!wrap) return -1;
      const rect = wrap.getBoundingClientRect();
      const cur = normalizeChordIvs(st.current.ivs);
      const padL = 34;
      const padR = 68;
      const span = Math.max(80, rect.width - padL - padR);
      const i = Math.floor(((clientX - rect.left - padL) / span) * Math.max(1, cur.length));
      return clamp(i, 0, cur.length - 1);
    },
    [wrapRef],
  );

  /** Column height is the interval, so a nudge is vertical. */
  const nudgeVoice = useCallback(
    (clientY: number, voiceIdx: number) => {
      const wrap = wrapRef.current;
      if (!wrap || voiceIdx < 0) return;
      const rect = wrap.getBoundingClientRect();
      const list0 = normalizeChordIvs(st.current.ivs);
      if (voiceIdx === 0) return; // root stays 0
      const topY = 30;
      const rootY = rect.height - 44;
      const t = clamp((rootY - (clientY - rect.top)) / Math.max(1, rootY - topY), 0, 1);
      const semis = Math.round(t * 19);
      const next = list0.slice();
      next[voiceIdx] = Math.max(1, semis);
      setIvs(next);
    },
    [setIvs, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yNorm = (e.clientY - rect.top) / Math.max(1, rect.height);
      flashRef.current = 1;
      if (yNorm > 0.86) {
        dragRef.current = "arm";
        setParam("chordMemoryOn", !st.current.on);
        return;
      }
      if (yNorm < 0.12) {
        cyclePreset(1);
        return;
      }
      dragRef.current = "nudge";
      dragVoiceRef.current = hitVoice(e.clientX);
      st.current.dragVoice = dragVoiceRef.current;
      nudgeVoice(e.clientY, dragVoiceRef.current);
    },
    [cyclePreset, hitVoice, nudgeVoice, setParam, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragRef.current !== "nudge") return;
      nudgeVoice(e.clientY, dragVoiceRef.current);
    },
    [nudgeVoice],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    dragVoiceRef.current = -1;
    st.current.dragVoice = -1;
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
        paintChord(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: !!(st.current.on && st.current.enabled),
        dragging: !!dragRef.current,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.on,
          st.current.enabled,
          st.current.ivs.length,
          st.current.ivs[1],
          st.current.ivs[2],
          st.current.ivs[3],
          st.current.ivs[4],
          st.current.ivs[5],
          st.current.dragVoice,
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
      aria-label="Stack vault — scrub voice intervals, top cycles presets, bottom arms memory"
      title="Bars: nudge interval · Top: preset · Bottom: arm"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
