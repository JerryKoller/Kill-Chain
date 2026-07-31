/**
 * Mixer — Sum Deck stage visualizer.
 *
 * IDIOM: the channel ladder — a console laid on its side. Stages are a ~10:1
 * letterbox, so five vertical strips would be five hairlines; instead each bus
 * owns a full-width horizontal lane and the five stack as strata. Level is the
 * length of the lane's LED bar, pan slides the bar's anchor along the lane
 * (hard-panned + hot bars visibly pin against the wall), and mute / solo change
 * the whole lane's treatment rather than adding a badge to it.
 *
 * A/B/DRM/SMP + master (Signal Path Mix · FC.mixer).
 * Drag slot: Level ↕ / Pan ↔ (parts). Double-click: reset level.
 * Click label zone: toggle mute. Shift+click: solo.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import {
  useFireSequencerStore,
  MIXER_PARTS,
  type MixerStripId,
} from "@/state/fireSequencerStore";
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
const C = FC.mixer;
const C_DEEP = bandShade(FC_BAND.mix, 0.22);
const C_MID = bandShade(FC_BAND.mix, 0.45);
const C_HOT = bandShade(FC_BAND.mix, 0.62);
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
/** LED ramp toward the extremes of a lane — quiet → warm → peak. */
const C_WARN = bandShade(FC_BAND.mix, 0.85);
const C_PEAK = bandShade(FC_BAND.mix, 0.99);

const STRIP_COLORS: Record<MixerStripId, string> = {
  a: bandShade(FC_BAND.mix, 0.38),
  b: bandShade(FC_BAND.mix, 0.5),
  drums: bandShade(FC_BAND.mix, 0.62),
  samples: bandShade(FC_BAND.mix, 0.74),
  master: bandShade(FC_BAND.mix, 0.9),
};

const STRIP_SHORT: Record<MixerStripId, string> = {
  a: "A",
  b: "B",
  drums: "DRM",
  samples: "SMP",
  master: "MST",
};

const IDS: MixerStripId[] = [...MIXER_PARTS, "master"];

/** Fader travel: store level is 0..1.5 with unity at 1. */
const LEVEL_MAX = 1.5;
/** LED segments across a full lane — fixed so cost never scales with width. */
const SEGS = 48;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function panTag(pan: number): string {
  const p = Math.round(pan * 100);
  if (Math.abs(p) < 3) return "C";
  return p < 0 ? `L${-p}` : `R${p}`;
}

/** One console lane. `signal` / `peak` carry the component's meter ballistics. */
export type MixerLane = {
  id: MixerStripId;
  label: string;
  color: string;
  level: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  signal: number;
  peak: number;
};

export type MixerVizState = {
  lanes: MixerLane[];
  limiter: boolean;
  duck: boolean;
  duckAmount: number;
  anySolo: boolean;
};

/**
 * Paint the channel ladder. Exported and pure so the deck can be rendered
 * headlessly — every ballistic value arrives on `p`, nothing is sampled here.
 */
export function paintMixer(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: MixerVizState,
  now: number,
  flash: number,
): void {
  const lanes = p.lanes;
  const n = lanes.length;

  let sumLevel = 0;
  let hottest = 0;
  for (let i = 0; i < n; i++) {
    const l = lanes[i]!;
    if (!l.mute) sumLevel += l.level;
    if (l.signal > hottest) hottest = l.signal;
  }
  const energy = 0.07 + (sumLevel / (n * LEVEL_MAX)) * 0.3 + hottest * 0.3 + flash * 0.18;

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy, horizon: 0.58 });

  // Geometry: a wide gutter on the left keeps canvas text clear of the DOM
  // eyebrow; the right gutter carries pan + state.
  const padL = 88;
  const padR = 78;
  const trackX = padL;
  const trackW = Math.max(60, W - padL - padR);
  const top = 24;
  const bot = Hh - 21;
  const slot = (bot - top) / n;
  const laneH = Math.max(12, slot - 3);
  const half = trackW * 0.5;
  const centreX = trackX + half;

  // ── pan axis: the one ruler every lane shares ──
  ctx.save();
  for (const u of [0, 0.25, 0.5, 0.75, 1] as const) {
    const x = trackX + trackW * u;
    const mid = u === 0.5;
    ctx.fillStyle = hexA(mid ? C_GLOW : C_MID, mid ? 0.16 : 0.07);
    ctx.fillRect(x - (mid ? 0.5 : 0), top - 2, 1, bot - top + 4);
  }
  ctx.restore();
  ctx.font = VIZ_FONT_LABEL;
  ctx.fillStyle = hexA(C_MID, 0.5);
  ctx.textAlign = "left";
  ctx.fillText("L", trackX, 19);
  ctx.textAlign = "right";
  ctx.fillText("R", trackX + trackW, 19);

  // ── lanes ──
  for (let i = 0; i < n; i++) {
    const l = lanes[i]!;
    const laneY = top + i * slot;
    const isMaster = l.id === "master";
    const dim = l.mute || (p.anySolo && !l.solo && !isMaster);
    const lev = clamp(l.level, 0, LEVEL_MAX) / LEVEL_MAX;
    const anchorX = trackX + half + l.pan * half;

    ctx.save();
    ctx.translate(0, laneY);

    // Lane bed — recessed slot the bar rides in.
    const bed = cachedGrad(ctx, `bed|${laneH}|${l.color}|${isMaster ? 1 : 0}`, (c) => {
      const g = c.createLinearGradient(0, 0, 0, laneH);
      g.addColorStop(0, "rgba(0,0,0,0.5)");
      g.addColorStop(0.5, hexA(l.color, isMaster ? 0.07 : 0.045));
      g.addColorStop(1, "rgba(0,0,0,0.42)");
      return g;
    });
    ctx.fillStyle = bed;
    roundRect(ctx, trackX, 0, trackW, laneH, 3);
    ctx.fill();

    // Frame: solo isolates with a bright 2px edge, mute goes to bare chrome.
    ctx.strokeStyle = l.solo
      ? hexA(C_GLOW, 0.8)
      : l.mute
        ? "rgba(255,255,255,0.07)"
        : hexA(l.color, 0.3 + flash * 0.22);
    ctx.lineWidth = l.solo ? 2 : 1;
    roundRect(ctx, trackX + 0.5, 0.5, trackW - 1, laneH - 1, 3);
    ctx.stroke();

    // Duck pumps the synth path (A + B) — a wedge eats the bar's outer ends.
    let duckCut = 0;
    if (p.duck && (l.id === "a" || l.id === "b")) {
      const period = 180 - p.duckAmount * 80;
      const pump = 0.5 + 0.5 * Math.sin((now / period) * Math.PI * 2);
      duckCut = p.duckAmount * pump * 0.45;
    }

    const barHalf = half * lev * (1 - duckCut);
    const segW = trackW / SEGS;
    const barY = 3;
    const barH = laneH - 6;

    // Unity ghost — where the fader would sit at 1.00, anchored to this pan.
    const unityHalf = half * (1 / LEVEL_MAX);
    ctx.fillStyle = hexA(l.color, dim ? 0.14 : 0.34);
    for (const dir of [-1, 1] as const) {
      const ux = anchorX + dir * unityHalf;
      if (ux > trackX && ux < trackX + trackW) ctx.fillRect(ux - 0.5, barY - 1, 1, barH + 2);
    }

    // Segmented LED bar, mirrored around the pan anchor. Colour ramps toward
    // the extremes exactly as a console meter ramps toward clip.
    if (!l.mute && lev > 0.001) {
      for (let s = 0; s < SEGS; s++) {
        const sx = trackX + s * segW;
        const scentre = sx + segW * 0.5;
        const d = Math.abs(scentre - anchorX) / half;
        if (d > lev * (1 - duckCut)) continue;
        const col = d > 0.85 ? C_PEAK : d > 0.7 ? C_WARN : l.color;
        const edge = 1 - Math.max(0, (d - lev * 0.82) / Math.max(0.02, lev * 0.18)) * 0.5;
        ctx.fillStyle = hexA(col, (0.36 + l.signal * 0.5) * (dim ? 0.4 : 1) * edge);
        ctx.fillRect(sx + 0.6, barY, Math.max(1, segW - 1.2), barH);
      }

      // Live core: the signal riding inside the fader's envelope.
      const coreHalf = Math.min(barHalf, half * l.signal);
      if (coreHalf > 1) {
        const x0 = Math.max(trackX, anchorX - coreHalf);
        const x1 = Math.min(trackX + trackW, anchorX + coreHalf);
        const core = cachedGrad(ctx, `core|${laneH}|${l.color}`, (c) => {
          const g = c.createLinearGradient(0, barY, 0, barY + barH);
          g.addColorStop(0, hexA(C_GLOW, 0.5));
          g.addColorStop(0.5, hexA(l.color, 0.85));
          g.addColorStop(1, hexA(C_DEEP, 0.6));
          return g;
        });
        ctx.fillStyle = core;
        ctx.fillRect(x0, barY + barH * 0.26, x1 - x0, barH * 0.48);
      }

      // Pinned ends: the bar has run out of lane.
      lit(ctx, () => {
        for (const dir of [-1, 1] as const) {
          const ex = anchorX + dir * barHalf;
          const wall = dir < 0 ? trackX : trackX + trackW;
          if (dir < 0 ? ex < wall : ex > wall) {
            ctx.fillStyle = hexA(C_PEAK, 0.75);
            ctx.fillRect(dir < 0 ? wall : wall - 2, barY, 2, barH);
            drawGlow(ctx, wall, barY + barH * 0.5, 9, C_PEAK, 0.7);
          }
        }
        drawGlow(ctx, anchorX, barY + barH * 0.5, 8 + l.signal * 14, C_GLOW, (0.2 + l.signal * 0.6) * (dim ? 0.35 : 1));
      });
    }

    // Peak hold — a hard cap tick either side of the anchor.
    if (l.peak > 0.02 && !l.mute) {
      const ph = Math.min(half, half * l.peak);
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      for (const dir of [-1, 1] as const) {
        const px = anchorX + dir * ph;
        if (px > trackX && px < trackX + trackW) ctx.fillRect(px - 1, barY - 1, 2, barH + 2);
      }
    }

    // Pan carriage — the anchor itself, straddling the lane.
    ctx.fillStyle = hexA(dim ? C_MID : C_GLOW, 0.5 + Math.abs(l.pan) * 0.45);
    ctx.fillRect(anchorX - 0.75, -2, 1.5, laneH + 4);

    // Mute: veil the lane rather than badge it.
    if (l.mute) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(ctx, trackX, 0, trackW, laneH, 3);
      ctx.fill();
      ctx.strokeStyle = hexA(C_WARN, 0.28);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(trackX + 2, laneH * 0.5);
      ctx.lineTo(trackX + trackW - 2, laneH * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Limiter cage on the master lane.
    if (isMaster && p.limiter) {
      ctx.strokeStyle = hexA(C_GLOW, 0.28 + flash * 0.3);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      roundRect(ctx, trackX - 3.5, -3.5, trackW + 7, laneH + 7, 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── left gutter: name + fader value ──
    ctx.font = VIZ_FONT_TITLE;
    ctx.textAlign = "left";
    ctx.fillStyle = l.mute ? "rgba(255,255,255,0.24)" : hexA(l.color, 0.95);
    ctx.fillText(l.label, 11, laneH * 0.5 + 3.5);
    ctx.font = VIZ_FONT_VALUE;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(l.mute ? C_MID : C_GLOW, l.mute ? 0.4 : 0.8);
    ctx.fillText(l.level.toFixed(2), padL - 8, laneH * 0.5 + 3.5);

    // ── right gutter: pan + state ──
    ctx.font = VIZ_FONT_VALUE;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(dim ? C_MID : l.color, 0.75);
    ctx.fillText(isMaster ? "—" : panTag(l.pan), trackX + trackW + 8, laneH * 0.5 + 3.5);
    ctx.font = VIZ_FONT_LABEL;
    ctx.textAlign = "right";
    if (l.solo) {
      ctx.fillStyle = hexA(C_GLOW, 0.95);
      ctx.fillText("SOLO", W - 10, laneH * 0.5 + 3.5);
    } else if (l.mute) {
      ctx.fillStyle = hexA(C_WARN, 0.8);
      ctx.fillText("MUTE", W - 10, laneH * 0.5 + 3.5);
    } else if (isMaster && p.limiter) {
      ctx.fillStyle = hexA(C_GLOW, 0.85);
      ctx.fillText("LIM", W - 10, laneH * 0.5 + 3.5);
    } else if (p.duck && (l.id === "a" || l.id === "b")) {
      ctx.fillStyle = hexA(C_HOT, 0.6 + duckCut);
      ctx.fillText("DUCK", W - 10, laneH * 0.5 + 3.5);
    }

    ctx.restore();
  }

  pill(
    ctx,
    W * 0.5,
    2,
    p.anySolo ? "SOLO ISOLATE" : p.duck ? "DUCK BUS" : "SUM BUS",
    p.anySolo ? C_GLOW : C_HOT,
    { glow: flash, height: 12 },
  );

  // Centre reference — the deck's zero-pan spine, under everything else.
  lit(ctx, () => drawGlow(ctx, centreX, bot + 2, 20 + flash * 10, C_MID, 0.1 + flash * 0.12));

  grain(ctx, W, Hh, 0.03);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    "MIX · SUM DECK",
    p.duck ? `DUCK ${Math.round(p.duckAmount * 100)}` : "BUS",
    C_GLOW,
    p.duck ? C_HOT : C_MID,
  );
}

type Props = {
  liveRef: MutableRefObject<Record<MixerStripId, number>>;
};

export function MixerStageViz({ liveRef }: Props) {
  const mixer = useFireSequencerStore((s) => s.mixer);
  const setMixerStrip = useFireSequencerStore((s) => s.setMixerStrip);
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const duckAmount = useFireSequencerStore((s) => s.duckAmount);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const dragId = useRef<MixerStripId | null>(null);
  const prevKey = useRef(0);
  // Lanes are allocated once; the store folds into them in place so the meter
  // ballistics (signal / peak) survive across renders.
  const st = useRef<MixerVizState>({
    lanes: IDS.map((id) => ({
      id,
      label: STRIP_SHORT[id],
      color: STRIP_COLORS[id],
      level: 1,
      pan: 0,
      mute: false,
      solo: false,
      signal: 0,
      peak: 0,
    })),
    limiter: true,
    duck: false,
    duckAmount: 0,
    anySolo: false,
  });

  for (let i = 0; i < IDS.length; i++) {
    const lane = st.current.lanes[i]!;
    const s = mixer[lane.id];
    lane.level = s.level;
    lane.pan = s.pan;
    lane.mute = s.mute;
    lane.solo = s.solo;
  }
  st.current.limiter = fireLimiterOn;
  st.current.duck = duckEnabled;
  st.current.duckAmount = duckAmount;
  st.current.anySolo = MIXER_PARTS.some((id) => mixer[id].solo);

  const anyLive =
    MIXER_PARTS.some((id) => !mixer[id].mute && mixer[id].level > 0.02) ||
    (!mixer.master.mute && mixer.master.level > 0.02);

  useEffect(() => {
    const key = motionHash(
      mixer.a.level, mixer.a.pan, mixer.a.mute, mixer.a.solo,
      mixer.b.level, mixer.b.pan, mixer.b.mute, mixer.b.solo,
      mixer.drums.level, mixer.drums.pan, mixer.drums.mute, mixer.drums.solo,
      mixer.samples.level, mixer.samples.pan, mixer.samples.mute, mixer.samples.solo,
      mixer.master.level, mixer.master.pan, mixer.master.mute, mixer.master.solo,
      fireLimiterOn, duckEnabled, duckAmount,
    );
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mixer, fireLimiterOn, duckEnabled, duckAmount]);

  const slotAt = useCallback((clientX: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const padX = 10;
    const gap = 8;
    const slotW = (rect.width - padX * 2 - gap * (IDS.length - 1)) / IDS.length;
    const i = Math.floor((x - padX) / (slotW + gap));
    if (i < 0 || i >= IDS.length) return null;
    return { id: IDS[i]!, i, slotW, padX, gap, rect };
  }, [wrapRef]);

  const applyDrag = useCallback(
    (clientX: number, clientY: number) => {
      const id = dragId.current;
      if (!id) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const slot = slotAt(clientX);
      const y = clamp((clientY - rect.top - 18) / Math.max(1, rect.height - 40), 0, 1);
      const level = Math.round((1 - y) * 1.5 * 50) / 50;
      setMixerStrip(id, { level: clamp(level, 0, 1.5) });
      if (id !== "master" && slot) {
        const localX = (clientX - rect.left - slot.padX - slot.i * (slot.slotW + slot.gap)) / slot.slotW;
        const pan = clamp(localX * 2 - 1, -1, 1);
        setMixerStrip(id, { pan: Math.round(pan * 20) / 20 });
      }
    },
    [setMixerStrip, slotAt, wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const slot = slotAt(e.clientX);
      if (!slot) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yRel = (e.clientY - rect.top) / rect.height;

      // Top label zone → mute
      if (yRel < 0.14) {
        const cur = useFireSequencerStore.getState().mixer[slot.id];
        setMixerStrip(slot.id, { mute: !cur.mute });
        return;
      }
      // Shift+click → solo (parts only)
      if (e.shiftKey && slot.id !== "master") {
        const cur = useFireSequencerStore.getState().mixer[slot.id];
        setMixerStrip(slot.id, { solo: !cur.solo });
        return;
      }

      dragId.current = slot.id;
      wrap.setPointerCapture(e.pointerId);
      applyDrag(e.clientX, e.clientY);
    },
    [slotAt, setMixerStrip, applyDrag, wrapRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragId.current) return;
      applyDrag(e.clientX, e.clientY);
    },
    [applyDrag],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragId.current) return;
    dragId.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, [wrapRef]);

  const onDoubleClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const slot = slotAt(e.clientX);
      if (!slot) return;
      setMixerStrip(slot.id, { level: 1, pan: 0, mute: false });
    },
    [slotAt, setMixerStrip],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /** Meter ballistics — the only per-frame state the paint can't derive. */
    const tickMeters = () => {
      const liv = liveRef.current;
      const lanes = st.current.lanes;
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes[i]!;
        const fader = clamp(l.mute ? 0 : l.level, 0, LEVEL_MAX) / LEVEL_MAX;
        const signal = l.mute ? 0 : clamp(liv[l.id] ?? 0, 0, 1);
        const target = Math.max(fader * 0.35, signal);
        l.signal += (target - l.signal) * 0.3;
        l.peak = Math.max(l.signal, l.peak * 0.972);
      }
    };

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.88;
        tickMeters();
        paintMixer(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        active: st.current.duck,
        dragging: !!dragId.current,
        particles: 0,
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.lanes[0]!.level, st.current.lanes[0]!.pan, st.current.lanes[0]!.mute, st.current.lanes[0]!.solo, st.current.lanes[0]!.signal,
          st.current.lanes[1]!.level, st.current.lanes[1]!.pan, st.current.lanes[1]!.mute, st.current.lanes[1]!.solo, st.current.lanes[1]!.signal,
          st.current.lanes[2]!.level, st.current.lanes[2]!.pan, st.current.lanes[2]!.mute, st.current.lanes[2]!.solo, st.current.lanes[2]!.signal,
          st.current.lanes[3]!.level, st.current.lanes[3]!.pan, st.current.lanes[3]!.mute, st.current.lanes[3]!.solo, st.current.lanes[3]!.signal,
          st.current.lanes[4]!.level, st.current.lanes[4]!.pan, st.current.lanes[4]!.mute, st.current.lanes[4]!.solo, st.current.lanes[4]!.signal,
          st.current.limiter, st.current.duck, st.current.duckAmount,
        ),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [liveRef, canvasRef, sizeRef, visibleRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-3 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexA(C, anyLive ? 0.5 : 0.28),
        height: H,
        cursor: "ns-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexA(C, anyLive ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Level ↕ / Pan ↔ · Top click: Mute · Shift+click: Solo · Double-click: unity"
      role="img"
      aria-label="Mixer sum deck"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <div
        className="pointer-events-none absolute left-3 top-1 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexA(C_GLOW, 0.7) }}
      >
        Sum Deck
      </div>
    </div>
  );
}
