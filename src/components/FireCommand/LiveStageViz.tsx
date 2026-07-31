/**
 * Live — Stage Pulse visualizer.
 *
 * IDIOM: voice slots. The polyphony allocator laid out as a row of cells across
 * the letterbox — one cell per slot up to the cap, each lighting as a voice
 * sounds and falling away as it releases. When the count reaches the cap the
 * wall at the end of the row lights and the slot the allocator is about to take
 * is flagged, so the steal policy is visible rather than merely configured.
 * Reads as system telemetry, which is what this panel is.
 *
 * Octave · mono/poly · voices · FX route · master (Signal Path Mix · FC.performance).
 * Click radar: Mono/Poly · keys: voice cap · right: FX · rail: Master · sides: Octave.
 * Double-click: Cease Fire flash.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import type { VoiceStealPolicy } from "@/audio/dsp/mixClarity";
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
const C = FC.performance;
const C_DEEP = bandShade(FC_BAND.mix, 0.34);
const C_MID = bandShade(FC_BAND.mix, 0.52);
const C_HOT = bandShade(FC_BAND.mix, 0.7);
const C_GLOW = bandShade(FC_BAND.mix, 0.95);
const C_POLY = bandShade(FC_BAND.mix, 0.62);
const C_FX = bandShade(FC_BAND.mix, 0.82);
const C_VOICE = bandShade(FC_BAND.mix, 0.48);

const VOICE_CAPS = [6, 8, 12, 16, 24, 32, 48] as const;
const CAP_MAX = 48;

/** Zone boundaries — these mirror `hitTest` so the hit zones are legible. */
const Z_OCT = 0.08;
const Z_MONO = 0.22;
const Z_FX = 0.9;

const STEAL_LABEL: Record<VoiceStealPolicy, string> = {
  oldest: "STEAL OLDEST",
  newest: "STEAL NEWEST",
  lowest: "STEAL LOWEST",
  highest: "STEAL HIGHEST",
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function nearestCap(n: number): number {
  let best: number = VOICE_CAPS[0]!;
  let bestD = Infinity;
  for (const c of VOICE_CAPS) {
    const d = Math.abs(c - n);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Slots fill left to right, so the policy resolves to an end of the row. */
function stealSlot(policy: VoiceStealPolicy, cells: number): number {
  return policy === "newest" || policy === "highest" ? cells - 1 : 0;
}

type HitZone = "mono" | "octave+" | "octave-" | "voices" | "fx" | "master" | null;

export type LiveVizState = {
  mono: boolean;
  harmony: string | undefined;
  maxVoices: number;
  fxOn: boolean;
  octave: number;
  masterGain: number;
  steal: VoiceStealPolicy;
  /** Live voice count from the engine. */
  voices: number;
  /** Per-slot brightness, index = slot. Carries the release tails. */
  levels: Float32Array;
  /** Decaying Cease-Fire flash, 0..1. */
  panic: number;
};

/**
 * Paint the voice rail. Exported and pure — the engine poll and the slot
 * envelopes live in the component and arrive on `p`.
 */
export function paintLive(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: LiveVizState,
  now: number,
  flash: number,
): void {
  const cells = clamp(Math.round(p.maxVoices), 1, CAP_MAX);
  const use = clamp(p.voices, 0, cells) / cells;
  const atCap = p.voices >= cells;
  const energy = 0.07 + use * 0.36 + p.panic * 0.3 + flash * 0.16;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.56 });

  const xOct = W * Z_OCT;
  const xMono = W * Z_MONO;
  const xFx = W * Z_FX;
  const artTop = 22;
  const barY = 26;
  const barH = 7;
  const slotTop = 38;
  const slotH = 66;
  const slotBot = slotTop + slotH;
  const railY = Hh - 28;

  // Zone seams — the panel's controls are invisible otherwise.
  for (const x of [xOct, xMono, xFx]) {
    ctx.fillStyle = hexA(C_MID, 0.1);
    ctx.fillRect(x, artTop, 1, railY - 12 - artTop);
  }

  if (p.panic > 0.05) {
    ctx.fillStyle = hexA(C_HOT, p.panic * 0.3);
    ctx.fillRect(0, 0, W, Hh);
  }

  // ── octave gutter ──
  const rungW = Math.min(Math.max(10, xOct - 14), 40);
  const rungX = 7;
  const ladderTop = slotTop - 6;
  const ladderH = slotH + 12;
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.fillText("OCT", rungX, artTop + 6);
  for (let i = 0; i <= 8; i++) {
    const oy = ladderTop + (8 - i) * (ladderH / 9);
    const on = p.octave === i;
    ctx.fillStyle = hexA(on ? C_GLOW : C, on ? 0.92 : 0.16);
    ctx.fillRect(rungX, oy, rungW, on ? 3 : 2);
    if (on) lit(ctx, () => drawGlow(ctx, rungX + rungW * 0.5, oy + 1, 12 + flash * 5, C_GLOW, 0.55));
  }
  // Halves: click above centre steps up, below steps down.
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(C_MID, 0.45);
  ctx.fillText("+", rungX + rungW * 0.5, ladderTop - 4);
  ctx.fillText("−", rungX + rungW * 0.5, ladderTop + ladderH + 10);
  ctx.font = VIZ_FONT_VALUE;
  ctx.fillStyle = hexA(C_GLOW, 0.85);
  ctx.fillText(String(p.octave), rungX + rungW * 0.5, slotBot + 22);

  // ── voice mode plate ──
  const mpX = xOct + 8;
  const mpW = Math.max(28, xMono - xOct - 16);
  const mpY = slotTop;
  const mpH = slotH;
  const modeCol = p.mono ? C_HOT : C_POLY;
  ctx.fillStyle = hexA(C_DEEP, 0.6);
  roundRect(ctx, mpX, mpY, mpW, mpH, 3);
  ctx.fill();
  ctx.strokeStyle = hexA(modeCol, 0.5 + flash * 0.3);
  ctx.lineWidth = 1;
  roundRect(ctx, mpX + 0.5, mpY + 0.5, mpW - 1, mpH - 1, 3);
  ctx.stroke();
  // One thick bar for mono, a stack for poly — the glyph is the state.
  const glyphW = Math.min(mpW - 12, 34);
  const glyphX = mpX + (mpW - glyphW) * 0.5;
  if (p.mono) {
    ctx.fillStyle = hexA(C_HOT, 0.85);
    ctx.fillRect(glyphX, mpY + mpH * 0.42, glyphW, 6);
  } else {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = hexA(C_POLY, 0.5 + i * 0.16);
      ctx.fillRect(glyphX + i * 2, mpY + mpH * 0.3 + i * 8, glyphW - i * 4, 3);
    }
  }
  ctx.font = VIZ_FONT_TITLE;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(modeCol, 0.9);
  ctx.fillText(p.mono ? "MONO" : "POLY", mpX + mpW * 0.5, mpY + mpH - 8);

  // ── voice field ──
  const fieldX = xMono + 8;
  const fieldW = Math.max(40, xFx - xMono - 16);
  const cellW = fieldW / cells;
  const gap = Math.min(3, cellW * 0.16);
  const cw = Math.max(1, cellW - gap);
  const stealIdx = stealSlot(p.steal, cells);
  const lvls = p.levels;

  // Utilisation across the field, with the cap as a hard right edge.
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(fieldX, barY, fieldW, barH);
  const uFill = cachedGrad(ctx, `use|${barY}|${barH}`, (c) => {
    const g = c.createLinearGradient(0, barY, 0, barY + barH);
    g.addColorStop(0, hexA(C_GLOW, 0.7));
    g.addColorStop(1, hexA(C_VOICE, 0.4));
    return g;
  });
  ctx.fillStyle = uFill;
  ctx.fillRect(fieldX, barY, fieldW * use, barH);
  ctx.strokeStyle = hexA(atCap ? C_HOT : C_MID, atCap ? 0.85 : 0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(fieldX + 0.5, barY + 0.5, fieldW - 1, barH - 1);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.fillText("VOICES", fieldX, barY - 3);
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(atCap ? C_HOT : C_GLOW, 0.85);
  ctx.fillText(`${p.voices} / ${cells}`, fieldX + fieldW, barY - 3);

  const cellFill = cachedGrad(ctx, `cell|${slotTop}|${slotH}`, (c) => {
    const g = c.createLinearGradient(0, slotTop, 0, slotBot);
    g.addColorStop(0, hexA(C_GLOW, 0.9));
    g.addColorStop(0.45, hexA(C_HOT, 0.6));
    g.addColorStop(1, hexA(C_VOICE, 0.3));
    return g;
  });

  for (let i = 0; i < cells; i++) {
    const x = fieldX + i * cellW;
    const lvl = clamp(lvls[i] ?? 0, 0, 1);
    const sounding = i < p.voices;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, x, slotTop, cw, slotH, 2);
    ctx.fill();

    if (lvl > 0.004) {
      // A voice's own little level cell — full while held, sinking on release.
      const flicker = sounding ? 0.9 + 0.1 * Math.sin(now * 0.006 + i * 0.7) : 1;
      const h = slotH * lvl * flicker;
      ctx.save();
      roundRect(ctx, x, slotTop, cw, slotH, 2);
      ctx.clip();
      ctx.fillStyle = cellFill;
      ctx.globalAlpha = 0.35 + lvl * 0.65;
      ctx.fillRect(x, slotBot - h, cw, h);
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.fillStyle = hexA(C_GLOW, 0.55 + lvl * 0.4);
      ctx.fillRect(x, slotBot - h - 1, cw, 2);
      lit(ctx, () => drawGlow(ctx, x + cw * 0.5, slotBot - h, 8 + cw * 0.4, C_GLOW, lvl * 0.7));
    }

    ctx.strokeStyle = hexA(lvl > 0.02 ? C_GLOW : C, lvl > 0.02 ? 0.45 + lvl * 0.35 : 0.14);
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, slotTop + 0.5, cw - 1, slotH - 1, 2);
    ctx.stroke();

    // The slot the allocator will take next when the cap is hit.
    if (atCap && i === stealIdx) {
      ctx.strokeStyle = hexA(C_HOT, 0.85 + flash * 0.15);
      ctx.lineWidth = 2;
      roundRect(ctx, x - 1.5, slotTop - 1.5, cw + 3, slotH + 3, 3);
      ctx.stroke();
      lit(ctx, () => drawGlow(ctx, x + cw * 0.5, slotTop + slotH * 0.5, 16, C_HOT, 0.5));
    }

    // Slot numbers where there is room for them.
    if (cw > 15 && (i % 4 === 0 || i === cells - 1)) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_MID, 0.4);
      ctx.fillText(String(i + 1), x + cw * 0.5, slotBot + 10);
    }
  }

  // Cap wall — where polyphony runs out.
  const wallX = fieldX + fieldW;
  ctx.fillStyle = hexA(atCap ? C_HOT : C_MID, atCap ? 0.9 : 0.3);
  ctx.fillRect(wallX + 1, slotTop - 4, 2, slotH + 8);
  if (atCap) {
    lit(ctx, () => drawGlow(ctx, wallX + 2, slotTop + slotH * 0.5, 20 + flash * 8, C_HOT, 0.7));
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(C_HOT, 0.95);
    ctx.fillText("CAP · STEAL", wallX - 4, slotTop - 6);
  }

  // ── cap ruler: the drag positions the voice zone actually resolves to ──
  const rulerY = slotBot + 20;
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "center";
  for (let i = 0; i < VOICE_CAPS.length; i++) {
    const cap = VOICE_CAPS[i]!;
    const cx = (i / (VOICE_CAPS.length - 1)) * W;
    const reachable = cx >= xMono && cx <= xFx;
    const on = cells === cap;
    ctx.fillStyle = hexA(on ? C_GLOW : C_MID, on ? 0.6 : reachable ? 0.2 : 0.1);
    ctx.fillRect(clamp(cx, 2, W - 3) - 0.5, rulerY - 12, 1, on ? 8 : 5);
    ctx.fillStyle = hexA(on ? C_GLOW : C_MID, on ? 0.9 : reachable ? 0.45 : 0.22);
    ctx.fillText(String(cap), clamp(cx, 10, W - 10), rulerY);
  }

  // ── FX route column ──
  const fxX = xFx + 6;
  const fxW = Math.max(24, W - xFx - 12);
  if (p.fxOn) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 300);
    const tint = cachedGrad(ctx, `fx|${W}`, (c) => {
      const g = c.createLinearGradient(xFx - 24, 0, W, 0);
      g.addColorStop(0, hexA(C_FX, 0));
      g.addColorStop(1, hexA(C_FX, 0.22));
      return g;
    });
    ctx.fillStyle = tint;
    ctx.fillRect(xFx - 24, slotTop - 4, W - xFx + 24, slotH + 8);
    ctx.fillStyle = hexA(C_FX, 0.4 + pulse * 0.4);
    ctx.fillRect(fxX, slotTop, 3, slotH);
    lit(ctx, () => drawGlow(ctx, fxX + 1.5, slotTop + slotH * 0.5, 18, C_FX, 0.5 + pulse * 0.3));
  } else {
    ctx.strokeStyle = hexA(C, 0.25);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(fxX + 1, slotTop);
    ctx.lineTo(fxX + 1, slotTop + slotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.font = VIZ_FONT_TITLE;
  ctx.textAlign = "center";
  ctx.fillStyle = hexA(p.fxOn ? C_FX : C_MID, 0.85);
  ctx.fillText(p.fxOn ? "→ FX" : "DRY", fxX + fxW * 0.5, slotTop + slotH * 0.5 + 3);

  pill(
    ctx,
    W * 0.5,
    2,
    atCap ? `CAP ${cells} · ${STEAL_LABEL[p.steal]}` : STEAL_LABEL[p.steal],
    atCap ? C_HOT : C_GLOW,
    { glow: flash + p.panic, height: 12 },
  );

  // ── master rail ──
  const railPad = 14;
  const railW = W - railPad * 2;
  const mg = clamp(p.masterGain / 1.2, 0, 1);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(railPad, railY, railW, 6);
  ctx.fillStyle = hexA(C_HOT, 0.55 + flash * 0.25);
  ctx.fillRect(railPad, railY + 1, Math.max(2, railW * mg), 4);
  for (const notch of [0, 0.25, 0.5, 0.75, 1] as const) {
    const nx = railPad + notch * railW;
    ctx.fillStyle = hexA(C_MID, 0.28);
    ctx.fillRect(nx - 1, railY - 2, 2, 10);
  }
  lit(ctx, () => drawGlow(ctx, railPad + railW * mg, railY + 3, 8 + flash * 5, C_GLOW, 0.85));
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_MID, 0.55);
  ctx.fillText("MASTER", railPad, railY - 5);

  grain(ctx, W, Hh, 0.028);
  bezel(ctx, W, Hh, C);
  const harm = p.harmony && p.harmony !== "off" ? ` · ${String(p.harmony).toUpperCase()}` : "";
  footer(
    ctx,
    W,
    Hh,
    "STAGE PULSE",
    `${p.voices}/${cells} · OCT ${p.octave}${harm} · MST ${Math.round(p.masterGain * 100)}%`,
    C_GLOW,
    p.voices > 0 ? C_HOT : C_MID,
  );
}

export function LiveStageViz() {
  const mono = useFireCommandStore((s) => s.patch.mono);
  const harmony = useFireCommandStore((s) => s.patch.harmonyMode);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const octave = useFireCommandStore((s) => s.octave);
  const masterGain = useFireCommandStore((s) => s.patch.masterGain) ?? 0.72;
  const steal = (useFireCommandStore((s) => s.patch.voiceSteal) ?? "oldest") as VoiceStealPolicy;
  const setParam = useFireCommandStore((s) => s.setParam);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  const setRouteThroughFx = useFireCommandStore((s) => s.setRouteThroughFx);
  const shiftOctave = useFireCommandStore((s) => s.shiftOctave);
  const panic = useFireCommandStore((s) => s.panic);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const panicFlash = useRef(0);
  const dragRef = useRef<HitZone>(null);
  const prevKey = useRef(0);
  // Slot envelopes persist across renders; the store folds in around them.
  const st = useRef<LiveVizState>({
    mono: !!mono,
    harmony,
    maxVoices,
    fxOn,
    octave,
    masterGain,
    steal,
    voices: 0,
    levels: new Float32Array(CAP_MAX),
    panic: 0,
  });
  st.current.mono = !!mono;
  st.current.harmony = harmony;
  st.current.maxVoices = maxVoices;
  st.current.fxOn = fxOn;
  st.current.octave = octave;
  st.current.masterGain = masterGain;
  st.current.steal = steal;

  const live = st.current.voices > 0 || masterGain > 0.05;

  useEffect(() => {
    const key = motionHash(mono, maxVoices, fxOn, octave, masterGain, harmony ? 1 : 0);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mono, maxVoices, fxOn, octave, masterGain, harmony, steal]);

  const hitTest = useCallback((clientX: number, clientY: number): HitZone => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    if (y > 0.82) return "master";
    if (x < Z_OCT) return y < 0.5 ? "octave+" : "octave-";
    if (x > Z_FX) return "fx";
    if (x < Z_MONO) return "mono";
    return "voices";
  }, [wrapRef]);

  const applyAt = useCallback(
    (clientX: number, clientY: number, zone: HitZone) => {
      const wrap = wrapRef.current;
      if (!wrap || !zone) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      if (zone === "master") {
        setParam("masterGain", Math.round(x * 1.2 * 1000) / 1000);
        return;
      }
      if (zone === "voices") {
        const idx = Math.round(x * (VOICE_CAPS.length - 1));
        setMaxVoices(VOICE_CAPS[clamp(idx, 0, VOICE_CAPS.length - 1)]!);
      }
    },
    [setMaxVoices, setParam, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const zone = hitTest(e.clientX, e.clientY);
      dragRef.current = zone;
      flashRef.current = 1;
      if (zone === "mono") {
        setParam("mono", !st.current.mono);
      } else if (zone === "fx") {
        setRouteThroughFx(!st.current.fxOn);
      } else if (zone === "octave+") {
        shiftOctave(1);
      } else if (zone === "octave-") {
        shiftOctave(-1);
      } else {
        applyAt(e.clientX, e.clientY, zone);
      }
    },
    [applyAt, hitTest, setParam, setRouteThroughFx, shiftOctave],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const z = dragRef.current;
      if (z === "master" || z === "voices") applyAt(e.clientX, e.clientY, z);
    },
    [applyAt],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    panicFlash.current = 1;
    flashRef.current = 1;
    useFireSequencerStore.getState().stop();
    panic();
  }, [panic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /** Engine poll — cheap enough to run from the idle probe as well as the frame. */
    const pollVoices = () => {
      let n = 0;
      try {
        n = activeFireEngine().getActiveVoiceCount();
      } catch {
        n = 0;
      }
      st.current.voices = n;
      return n;
    };

    /** Slot envelopes: snap up when a slot is taken, sink on release. */
    const tickSlots = () => {
      const s = st.current;
      const cells = clamp(Math.round(s.maxVoices), 1, CAP_MAX);
      const lv = s.levels;
      let tail = 0;
      for (let i = 0; i < lv.length; i++) {
        const target = i < s.voices && i < cells ? 1 : 0;
        const v = lv[i]!;
        lv[i] = v + (target - v) * (target > v ? 0.55 : 0.07);
        if (lv[i]! > tail) tail = lv[i]!;
      }
      return tail;
    };

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.9;
        panicFlash.current *= 0.92;
        pollVoices();
        tickSlots();
        st.current.panic = panicFlash.current;
        paintLive(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        // Polling here (not just in the frame) is what lets a paused panel wake
        // on the first note — the voice count is not a store subscription.
        const v = pollVoices();
        let tail = 0;
        const lv = st.current.levels;
        for (let i = 0; i < lv.length; i++) if (lv[i]! > tail) tail = lv[i]!;
        return {
          flash: flashRef.current,
          active: v > 0 || tail > 0.004 || panicFlash.current > 0.02,
          dragging: !!dragRef.current,
          particles: 0,
          visible: visibleRef.current,
          motionKey: motionHash(
            st.current.mono,
            st.current.maxVoices,
            st.current.fxOn,
            st.current.octave,
            st.current.masterGain,
            v,
          ),
        };
      },
      { minIntervalMs: 28 },
    );
    return stopLoop;
  }, [canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-pointer touch-none select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
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
      aria-label="Stage pulse — live performance controls"
      title="Radar: Mono/Poly · Keys: voice cap · Right: FX · Rail: Master · Sides: Octave · Double-click: Cease Fire"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 70% 100%, 0 100%)", opacity: 0.65 }} />
      <span className="pointer-events-none absolute right-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 100% 100%, 30% 100%)", opacity: 0.65 }} />
    </div>
  );
}

// silence unused nearestCap warning by exporting for panel use
export { nearestCap, VOICE_CAPS };
