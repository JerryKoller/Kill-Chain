/**
 * Core Fire Command stage visualizations — display-only personalities for the
 * oscillator bus and the LFOs, plus the barrel of stage exports the rest of the
 * signal path pulls from. Audio engines untouched.
 *
 * IDIOM (oscillator panels): the voice bus stack. Rather than each oscillator
 * showing a lone waveform in isolation, every panel draws the *whole* summed
 * voice — A / B / C / sub / noise as horizontal bands whose thickness is that
 * layer's level, stacked off a common floor, with the running total riding a
 * dashed headroom line. The panel's own layer is the lit one and carries its
 * live wavetable frame rippling through the band, so you still read the table
 * morph, but you read it in the context of the mix it is competing in. Bands
 * stacked along a wide short slot survive the letterbox where a lone waveform
 * just gets stretched.
 *
 * IDIOM (LFO panels): the aurora. Two cycles of the shape across the width, a
 * depth ribbon under it, and a comet tracer running the engine's own clock.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { getEngine } from "@/audio/AudioEngine";
import type { LfoWave, LfoDest } from "@/audio/dsp/FireCommandSynth";
import { FRAME_COUNT, frameSamples } from "@/audio/dsp/wavetables";
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
  plate,
  VIZ_FONT_LABEL,
} from "./stageVizKit";

const ENV_H = 88;
const LFO_H = 96;
const OSC_H = 88;
const PERF_H = 76;

/** Mod-band shades for the LFO panels; sources-band shades for the voice bus. */
const LFO_COLORS = [FC.lfo, FC.lfo2] as const;
const MOD_MID = bandShade(FC.mod, 0.45);
const MOD_HOT = bandShade(FC.mod, 0.66);
const MOD_GLOW = bandShade(FC.mod, 0.9);
const SRC_MID = bandShade(FC.sources, 0.45);
const SRC_GLOW = bandShade(FC.sources, 0.9);

/** The voice bus, bottom of the stack first. */
const BUS_LAYERS = [
  { key: "a", label: "A", col: FC.oscA },
  { key: "b", label: "B", col: FC.oscB },
  { key: "c", label: "C", col: FC.oscC },
  { key: "sub", label: "SUB", col: FC.sub },
  { key: "nz", label: "NZ", col: FC.noise },
] as const;

/** Bus scale headroom: the stack can run 40% past unity before it runs out. */
const BUS_FULL = 1.4;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

type StageChrome = "corners" | "rails" | "notch" | "plate" | "bloom" | "scope" | "keys";

function StageFrame({
  children,
  border,
  height,
  wrapRef,
  chrome = "corners",
}: {
  children: ReactNode;
  border: string;
  height: number;
  wrapRef: RefObject<HTMLDivElement | null>;
  chrome?: StageChrome;
}) {
  const base =
    chrome === "plate"
      ? "relative mb-2.5 overflow-hidden rounded-lg border-2 bg-black/55 shadow-[inset_0_2px_8px_rgba(0,0,0,0.55),0_4px_14px_rgba(0,0,0,0.35)]"
      : chrome === "bloom"
        ? "relative mb-2.5 overflow-hidden rounded-2xl border bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_28px_rgba(0,0,0,0.35)]"
        : chrome === "scope"
          ? "relative mb-2.5 overflow-hidden rounded-md border bg-[#05080c]/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_24px_rgba(0,0,0,0.65),0_6px_18px_rgba(0,0,0,0.3)]"
          : chrome === "notch"
            ? "relative mb-2.5 overflow-hidden rounded-xl border bg-black/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.28)]"
            : chrome === "keys"
              ? "relative mb-2.5 overflow-hidden rounded-xl border bg-black/50 shadow-[inset_0_-2px_6px_rgba(255,255,255,0.04),0_6px_20px_rgba(0,0,0,0.28)]"
              : "relative mb-2.5 overflow-hidden rounded-xl border bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.28)]";

  return (
    <div
      ref={wrapRef as RefObject<HTMLDivElement>}
      className={base}
      style={{
        borderColor: border,
        height,
        boxShadow:
          chrome === "bloom"
            ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 32px ${border}, 0 6px 20px rgba(0,0,0,0.28)`
            : undefined,
      }}
    >
      {children}
      {chrome === "corners" && (
        <>
          <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: border }} />
          <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: border }} />
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: border }} />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: border }} />
        </>
      )}
      {chrome === "rails" && (
        <>
          <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: border }} />
          <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: border }} />
        </>
      )}
      {chrome === "notch" && (
        <>
          <span className="pointer-events-none absolute left-0 top-0 h-2 w-5" style={{ background: border, clipPath: "polygon(0 0, 100% 0, 70% 100%, 0 100%)" }} />
          <span className="pointer-events-none absolute right-0 top-0 h-2 w-5" style={{ background: border, clipPath: "polygon(0 0, 100% 0, 100% 100%, 30% 100%)" }} />
          <span className="pointer-events-none absolute bottom-1 left-2 right-2 h-px opacity-40" style={{ background: border }} />
        </>
      )}
      {chrome === "scope" && (
        <span
          className="pointer-events-none absolute inset-1 rounded-[4px] border border-white/[0.04]"
          aria-hidden
        />
      )}
      {chrome === "keys" && (
        <>
          <span className="pointer-events-none absolute inset-x-3 bottom-1.5 h-0.5" style={{ background: border }} />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-20" style={{ background: `linear-gradient(90deg, transparent, ${border}, transparent)` }} />
        </>
      )}
    </div>
  );
}

export { UnisonStageViz } from "./UnisonStageViz";

/** Filter — a true log-Hz response trace with resonance, slope and carve. */
export { FilterStageViz } from "./FilterStageViz";

export { AmpEnvStageViz } from "./AmpEnvStageViz";

export { ModEnvStageViz } from "./ModEnvStageViz";

export { FiltEnvStageViz } from "./FiltEnvStageViz";

// ── LFO aurora ───────────────────────────────────────────────────────────

/** Shape sample at a phase — pure, so the tracer and the trail agree. */
function lfoShape(w: LfoWave, ph: number): number {
  const p = ph - Math.floor(ph);
  switch (w) {
    case "sine": return Math.sin(p * Math.PI * 2);
    case "triangle": return 1 - 4 * Math.abs(p - 0.5);
    case "sawtooth": return 1 - 2 * p;
    case "square": return p < 0.5 ? 1 : -1;
    case "sample-hold": {
      const step = Math.floor(ph * 8);
      const h = Math.sin(step * 127.1) * 43758.5453;
      return (h - Math.floor(h)) * 2 - 1;
    }
    default: return 0;
  }
}

export type CoreLfoVizState = {
  idx: 1 | 2;
  wave: LfoWave;
  rate: number;
  depth: number;
  dest: LfoDest;
  /** Engine clock, sampled outside the paint so the paint stays pure. */
  engT: number;
};

/**
 * Paint one LFO aurora. Exported and pure so any wave / rate / depth can be
 * rendered headlessly without mounting the component.
 */
export function paintCoreLfo(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: CoreLfoVizState,
  now: number,
  flash: number,
): void {
  const C = LFO_COLORS[p.idx === 2 ? 1 : 0]!;
  const depth = clamp01(p.depth);
  const destActive = p.dest !== "off";
  const energy = 0.12 + depth * 0.4 + (destActive ? 0.12 : 0) + flash * 0.2;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.5 });

  const mid = Hh * 0.44;
  const amp = Hh * 0.32 * Math.max(0.14, depth);
  const xL = 10;
  const xR = W - 10;
  const span = Math.max(20, xR - xL);

  // Zero axis.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xL, mid);
  ctx.lineTo(xR, mid);
  ctx.stroke();

  // Depth aurora — the band the modulation can actually reach.
  const aurora = cachedGrad(ctx, `aurora|${Hh}|${(depth * 12) | 0}|${p.idx}`, (c) => {
    const g = c.createLinearGradient(0, mid - amp, 0, mid + amp);
    g.addColorStop(0, hexA(C, depth * 0.2));
    g.addColorStop(0.5, hexA(MOD_HOT, depth * 0.09));
    g.addColorStop(1, hexA(C, depth * 0.05));
    return g;
  });
  ctx.fillStyle = aurora;
  ctx.fillRect(xL, mid - amp, span, amp * 2);

  // Ghost layers behind the front wave — phase-offset copies for depth.
  for (let ghost = 2; ghost >= 0; ghost--) {
    ctx.beginPath();
    for (let x = xL; x <= xR; x += 2) {
      const ph = ((x - xL) / span) * 2 + ghost * 0.3;
      const y = mid - lfoShape(p.wave, ph) * amp * (0.5 + ghost * 0.15);
      if (x === xL) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hexA(MOD_HOT, (0.2 - ghost * 0.055) * depth);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // Depth ribbon under the front wave.
  ctx.beginPath();
  ctx.moveTo(xL, mid);
  for (let x = xL; x <= xR; x++) {
    ctx.lineTo(x, mid - lfoShape(p.wave, ((x - xL) / span) * 2) * amp);
  }
  ctx.lineTo(xR, mid);
  ctx.closePath();
  const ribbon = cachedGrad(ctx, `ribbon|${Hh}|${(depth * 12) | 0}|${p.idx}`, (c) => {
    const g = c.createLinearGradient(0, mid - amp, 0, mid + amp);
    g.addColorStop(0, hexA(C, 0.34 + depth * 0.2));
    g.addColorStop(0.5, hexA(C, 0.14));
    g.addColorStop(1, hexA(C, 0.02));
    return g;
  });
  ctx.fillStyle = ribbon;
  ctx.fill();

  // Front wave.
  const breathe = 0.85 + 0.15 * Math.sin(now / 650);
  glowStroke(
    ctx,
    () => {
      for (let x = xL; x <= xR; x++) {
        const y = mid - lfoShape(p.wave, ((x - xL) / span) * 2) * amp;
        if (x === xL) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    },
    C,
    { width: 2.4, glow: 0.9 + depth * 0.8 + breathe * 0.2 + flash * 0.5, alpha: 0.95 },
  );

  // Phase tracer, running the engine's clock, with a comet trail behind it.
  const ph = (p.engT * p.rate) % 2;
  const px = xL + (ph / 2) * span;
  const py = mid - lfoShape(p.wave, ph) * amp;
  lit(ctx, () => {
    for (let hist = 20; hist > 0; hist--) {
      const hp = ((ph - hist * 0.05) % 2 + 2) % 2;
      const hx = xL + (hp / 2) * span;
      const hy = mid - lfoShape(p.wave, hp) * amp;
      const a = (20 - hist) / 20;
      drawGlow(ctx, hx, hy, 2 + a * 4, MOD_HOT, a * 0.35 * depth);
    }
    drawGlow(ctx, px, py, 14 + depth * 12, C, 0.7 + depth * 0.25);
  });
  ctx.fillStyle = hexA(MOD_GLOW, 0.98);
  ctx.beginPath();
  ctx.arc(px, py, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Destination glow — the right edge lights when the LFO is patched.
  if (destActive) {
    const destGrad = cachedGrad(ctx, `dest|${W}|${Hh}|${(depth * 10) | 0}`, (c) => {
      const g = c.createLinearGradient(W - 60, 0, W, 0);
      g.addColorStop(0, hexA(MOD_HOT, 0));
      g.addColorStop(1, hexA(MOD_HOT, 0.12 + depth * 0.15));
      return g;
    });
    ctx.fillStyle = destGrad;
    ctx.fillRect(W - 60, 0, 60, Hh);
  }

  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(MOD_MID, 0.6);
  ctx.fillText(`${p.rate.toFixed(2)}Hz · D${Math.round(depth * 100)}`, 10, 14);

  grain(ctx, W, Hh, 0.024);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    `LFO ${p.idx} AURORA · ${String(p.wave).toUpperCase()}`,
    destActive ? `→ ${String(p.dest).toUpperCase()}` : "IDLE",
    C,
    destActive ? MOD_HOT : MOD_MID,
  );
}

/** LFO stage — living waveform with depth aurora, phase tracer, and destination readout. */
export function LfoStageViz({ idx }: { idx: 1 | 2 }) {
  const wave = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Wave : s.patch.lfo2Wave));
  const rate = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Rate : s.patch.lfo2Rate));
  const depth = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Depth : s.patch.lfo2Depth));
  const dest = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Dest : s.patch.lfo2Dest));

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(LFO_H);
  const st = useRef<CoreLfoVizState>({ idx, wave, rate, depth, dest, engT: 0 });
  st.current = { idx, wave, rate, depth, dest, engT: st.current.engT };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        paintCoreLfo(ctx, W, Hh, st.current, now, 0);
      },
      () => {
        // Engine clock is sampled here so the frame callback stays one paint call.
        let engT = performance.now() / 1000;
        try { engT = getEngine().ctx.currentTime; } catch { /* */ }
        st.current.engT = engT;
        return {
          flash: 0,
          active: st.current.dest !== "off" && st.current.depth > 0.02,
          dragging: false,
          visible: visibleRef.current,
          motionKey: motionHash(st.current.rate, st.current.depth, st.current.wave.length, st.current.wave.charCodeAt(0)),
        };
      },
      { minIntervalMs: 28 },
    );
    return stopLoop;
  }, [idx, canvasRef, sizeRef, visibleRef]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexA(LFO_COLORS[idx === 2 ? 1 : 0]!, 0.28)} height={LFO_H} chrome="scope">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** FM · Ring — metallic interference moiré, carrier/mod Venn with sideband spokes, shimmer particles. */
export { FmStageViz as FmRingStageViz } from "./FmStageViz";

export { PitchStageViz as PitchGlideStageViz } from "./PitchStageViz";

// ── voice bus stack ──────────────────────────────────────────────────────

export type CoreVizState = {
  group: "a" | "b" | "c";
  /** The caller's accent for this oscillator — honoured for the lit band. */
  color: string;
  table: string;
  level: number;
  livePos: number;
  levelA: number;
  levelB: number;
  levelC: number;
  levelSub: number;
  levelNoise: number;
  /** Interpolated wavetable frame for this group; null in headless renders. */
  wave: Float32Array | null;
};

/**
 * Paint the voice bus. Exported and pure so any mix can be rendered headlessly
 * without mounting the component or reaching into the engine.
 */
export function paintCore(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: CoreVizState,
  now: number,
  flash: number,
): void {
  const levels = [
    clamp01(p.levelA),
    clamp01(p.levelB),
    clamp01(p.levelC),
    clamp01(p.levelSub),
    clamp01(p.levelNoise),
  ];
  const focusIdx = p.group === "a" ? 0 : p.group === "b" ? 1 : 2;
  let total = 0;
  for (let i = 0; i < levels.length; i++) total += levels[i]!;
  const energy = 0.12 + Math.min(1, total) * 0.34 + flash * 0.2;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, p.color, { energy, horizon: 0.66 });

  const padL = 26;
  const padR = 36;
  const busW = Math.max(40, W - padL - padR);
  const top = 12;
  const floorY = Hh - 30;
  const busH = floorY - top;
  const scale = busH / BUS_FULL;
  const headroomY = floorY - scale;

  // Gain ladder behind the stack.
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const y = Math.round(floorY - (i / 4) * scale * 0.8) + 0.5;
    if (y < top) break;
    ctx.strokeStyle = hexA(SRC_MID, 0.06);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + busW, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = hexA(SRC_MID, 0.2);
  ctx.fillRect(padL, Math.round(floorY) + 0.5, busW, 1);

  // ── the stack ──
  let y = floorY;
  for (let i = 0; i < BUS_LAYERS.length; i++) {
    const layer = BUS_LAYERS[i]!;
    const lv = levels[i]!;
    const h = lv * scale;
    const focused = i === focusIdx;
    if (h < 0.4) {
      // A silent layer still gets a hairline so the stack shows every slot.
      ctx.fillStyle = hexA(layer.col, focused ? 0.35 : 0.14);
      ctx.fillRect(padL, y - 1, busW, 1);
    } else {
      const bandTop = y - h;
      ctx.fillStyle = hexA(layer.col, focused ? 0.3 : 0.14);
      ctx.fillRect(padL, bandTop, busW, h);
      ctx.fillStyle = hexA(focused ? p.color : layer.col, focused ? 0.95 : 0.5);
      ctx.fillRect(padL, bandTop, busW, focused ? 1.6 : 1);
      if (focused) {
        lit(ctx, () => drawGlow(ctx, padL + busW * 0.5, bandTop, Math.min(60, h + 20), p.color, 0.3 + flash * 0.2));
        // The lit band carries this group's live wavetable frame.
        const wave = p.wave;
        if (wave && wave.length > 1) {
          const waveAmp = Math.min(h * 0.42, 14);
          const cy = bandTop + h * 0.5;
          const scroll = (now / 2600) % 1;
          ctx.beginPath();
          const steps = Math.max(48, Math.min(320, (busW / 4) | 0));
          for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const wi = ((u * 2 + scroll) * wave.length) | 0;
            const v = wave[wi % wave.length]!;
            const wx = padL + u * busW;
            const wy = cy - v * waveAmp;
            if (s === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          ctx.strokeStyle = hexA(SRC_GLOW, 0.75);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }
      // Name inside the band, level in the right gutter.
      if (h >= 9) {
        ctx.font = VIZ_FONT_LABEL;
        ctx.textAlign = "right";
        ctx.fillStyle = hexA(layer.col, focused ? 0.95 : 0.6);
        ctx.fillText(layer.label, padL - 4, y - h * 0.5 + 3);
      }
    }
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(layer.col, focused ? 0.9 : lv > 0.01 ? 0.5 : 0.24);
    ctx.fillText(`${Math.round(lv * 100)}`, padL + busW + 4, Math.max(top + 6, y - Math.max(h * 0.5, 1) + 3));
    y -= Math.max(h, 1.5);
  }

  // ── headroom line + the running total riding it ──
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = hexA(total > 1 ? FC.fire : SRC_MID, total > 1 ? 0.7 : 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(headroomY) + 0.5);
  ctx.lineTo(padL + busW, Math.round(headroomY) + 0.5);
  ctx.stroke();
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(total > 1 ? FC.fire : SRC_MID, total > 1 ? 0.85 : 0.45);
  ctx.fillText(total > 1 ? `OVER ${Math.round((total - 1) * 100)}` : "HEADROOM", padL + 3, headroomY - 3);

  const totalY = Math.max(top, floorY - Math.min(total, BUS_FULL) * scale);
  glowStroke(
    ctx,
    () => {
      ctx.moveTo(padL, totalY);
      ctx.lineTo(padL + busW, totalY);
    },
    total > 1 ? FC.fire : SRC_GLOW,
    { width: 1.4, glow: 0.6 + flash * 0.5, alpha: 0.7 },
  );

  // ── morph rail for this group ──
  const railY = Hh - 24;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padL, railY, busW, 3);
  const morphFill = busW * clamp01(p.livePos);
  const morphGrad = cachedGrad(ctx, `morph|${W}|${p.color}`, (c) => {
    const g = c.createLinearGradient(padL, 0, padL + busW, 0);
    g.addColorStop(0, hexA(p.color, 0.4));
    g.addColorStop(1, hexA(p.color, 0.9));
    return g;
  });
  ctx.fillStyle = morphGrad;
  ctx.fillRect(padL, railY, morphFill, 3);
  const mx = padL + morphFill;
  lit(ctx, () => drawGlow(ctx, mx, railY + 1.5, 7, p.color, 0.85));
  ctx.fillStyle = hexA(p.color, 0.95);
  ctx.fillRect(mx - 1.5, railY - 2, 3, 7);
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(SRC_MID, 0.5);
  ctx.fillText("MORPH", padL - 4, railY + 4);

  grain(ctx, W, Hh, 0.024);
  bezel(ctx, W, Hh, p.color);
  footer(
    ctx,
    W,
    Hh,
    `OSC ${p.group.toUpperCase()} HELIX · ${p.table.toUpperCase()}`,
    p.level < 0.01 ? "SILENT" : `${Math.round(p.level * 100)}%`,
    p.color,
    total > 1 ? FC.fire : p.color,
  );
}

/** Oscillator — the voice bus stack with this group's band lit and morphing. */
export function OscStageViz({ group, color }: { group: "a" | "b" | "c"; color: string }) {
  const table = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscATable : group === "b" ? s.patch.oscBTable : s.patch.oscCTable);
  const level = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscALevel : group === "b" ? s.patch.oscBLevel : s.patch.oscCLevel);
  const pos = useFireCommandStore((s) =>
    group === "a" ? s.patch.oscAPos : group === "b" ? s.patch.oscBPos : s.patch.oscCPos);
  const levelA = useFireCommandStore((s) => s.patch.oscALevel) ?? 0;
  const levelB = useFireCommandStore((s) => s.patch.oscBLevel) ?? 0;
  const levelC = useFireCommandStore((s) => s.patch.oscCLevel) ?? 0;
  const levelSub = useFireCommandStore((s) => s.patch.subLevel) ?? 0;
  const levelNoise = useFireCommandStore((s) => s.patch.noiseLevel) ?? 0;

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(OSC_H);
  const st = useRef<CoreVizState>({
    group, color, table, level, livePos: pos, levelA, levelB, levelC, levelSub, levelNoise, wave: null,
  });
  st.current = {
    group, color, table, level,
    livePos: st.current.livePos || pos,
    levelA, levelB, levelC, levelSub, levelNoise,
    wave: st.current.wave,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Frame bank is expensive to build (64 partials × 64 samples × 8 frames),
    // so it is cached per table and only the cheap crossfade runs per frame.
    const N = 64;
    const cache: Float32Array[] = [];
    const scratch = new Float32Array(N);
    let cacheTable = "";
    const ensure = (id: string) => {
      if (cacheTable === id && cache.length) return;
      cache.length = 0;
      for (let i = 0; i < FRAME_COUNT; i++) cache.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
      cacheTable = id;
    };

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        paintCore(ctx, W, Hh, st.current, now, 0);
      },
      () => {
        // Live morph position and the crossfaded frame are resolved here so the
        // frame callback stays one paint call and the paint stays pure.
        let livePos = st.current.livePos;
        try { livePos = activeFireEngine().getMorphPositions()[group]; } catch { /* */ }
        st.current.livePos = livePos;
        ensure(st.current.table);
        if (cache.length === FRAME_COUNT) {
          const cur = clamp01(livePos) * (FRAME_COUNT - 1);
          const lo = Math.floor(cur);
          const hi = Math.min(lo + 1, FRAME_COUNT - 1);
          const frac = cur - lo;
          const A = cache[lo]!;
          const B = cache[hi]!;
          for (let i = 0; i < N; i++) scratch[i] = A[i]! * (1 - frac) + B[i]! * frac;
          st.current.wave = scratch;
        }
        return {
          flash: 0,
          active: st.current.level > 0.01,
          dragging: false,
          visible: visibleRef.current,
          motionKey: motionHash(
            livePos,
            st.current.level,
            st.current.levelA,
            st.current.levelB,
            st.current.levelC,
            st.current.levelSub,
            st.current.levelNoise,
            st.current.table.length,
            st.current.table.charCodeAt(0),
          ),
        };
      },
      { minIntervalMs: 33 },
    );
    return stopLoop;
  }, [group, color, canvasRef, sizeRef, visibleRef]);

  return (
    <StageFrame wrapRef={wrapRef} border={hexA(color, 0.28)} height={OSC_H} chrome="corners">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </StageFrame>
  );
}

/** Performance — macro radar with expression arcs, voice constellation, routing beams. */
export { LiveStageViz as PerformanceStageViz } from "./LiveStageViz";

/** End of CoreStageViz — Performance moved to LiveStageViz (Stage Pulse). */
