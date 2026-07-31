/**
 * Scenes — Orbit Vault stage visualizer.
 *
 * IDIOM: the slot timeline. The eight patch-memory slots are stations laid out
 * left→right along a transport line; each station card carries its name and its
 * snapshot fingerprint (energy / warmth / density) as micro bars. The station
 * you last acted on is lit, and a recall sends a carriage travelling down the
 * line from the previous station to the new one, dragging an interpolation
 * trail whose length is the configured morph time.
 *
 * Eight patch-memory slots (Signal Path Perf · FC.scenes).
 * Click a node to act · top cycles Capture/Recall/Clear · bottom captures next empty.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import type { FirePatch } from "@/audio/dsp/FireCommandSynth";
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
  strata,
  VIZ_FONT_LABEL,
  VIZ_FONT_TITLE,
  VIZ_FONT_VALUE,
} from "./stageVizKit";

const H = 176;
const C = FC.scenes;
const C_DEEP = bandShade(FC_BAND.perf, 0.48);
const C_MID = bandShade(FC_BAND.perf, 0.62);
const C_HOT = bandShade(FC_BAND.perf, 0.78);
const C_GLOW = bandShade(FC_BAND.perf, 0.98);
const C_EMPTY = bandShade(FC_BAND.perf, 0.4);
const C_FILL = bandShade(FC_BAND.perf, 0.7);
const C_ACTIVE = bandShade(FC_BAND.perf, 0.9);

export type SceneMode = "capture" | "recall" | "clear";

export const SCENE_MODES: { id: SceneMode; label: string; short: string }[] = [
  { id: "capture", label: "Capture", short: "CAP" },
  { id: "recall", label: "Recall", short: "REC" },
  { id: "clear", label: "Clear", short: "CLR" },
];

/** Visual fingerprint from a stored patch snapshot. */
export function sceneFingerprint(snap: Partial<FirePatch> | null | undefined): {
  energy: number;
  warmth: number;
  density: number;
} {
  if (!snap) return { energy: 0, warmth: 0, density: 0 };
  const g = typeof snap.masterGain === "number" ? snap.masterGain / 1.2 : 0.5;
  const drv = typeof snap.drive === "number" ? snap.drive : 0;
  const filt = typeof snap.filterCutoff === "number" ? snap.filterCutoff : 0.5;
  const rev = typeof snap.reverbMix === "number" ? snap.reverbMix : 0;
  const dly = typeof snap.delayMix === "number" ? snap.delayMix : 0;
  const macros =
    ((snap.macro1 ?? 0) + (snap.macro2 ?? 0) + (snap.macro3 ?? 0) + (snap.macro4 ?? 0)) / 4;
  const enabled = snap.moduleEnable ? Object.values(snap.moduleEnable).filter(Boolean).length / 24 : 0.5;
  return {
    energy: Math.max(0, Math.min(1, g * 0.35 + drv * 0.25 + macros * 0.2 + enabled * 0.2)),
    warmth: Math.max(0, Math.min(1, (1 - filt) * 0.5 + rev * 0.3 + dly * 0.2)),
    density: Math.max(0, Math.min(1, enabled * 0.5 + macros * 0.3 + drv * 0.2)),
  };
}

export function occupiedCount(scenes: (Partial<FirePatch> | null)[]): number {
  return scenes.filter(Boolean).length;
}

export function firstEmptySlot(scenes: (Partial<FirePatch> | null)[]): number {
  const i = scenes.findIndex((s) => !s);
  return i >= 0 ? i : 0;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep — the carriage should ease into a station, not arrive linearly. */
function ease(t: number) {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** One station on the line. */
export type SceneSlotViz = {
  filled: boolean;
  energy: number;
  warmth: number;
  density: number;
  name: string;
};

export type ScenesVizState = {
  slots: SceneSlotViz[];
  enabled: boolean;
  mode: SceneMode;
  /** Slot the panel is pointed at. */
  activeSlot: number;
  /** Slot the store last committed (−1 when none). */
  lastSlot: number;
  transition: "immediate" | "nextBar" | "morphMs";
  morphMs: number;
  /** Carriage run: station indices plus the clock it started on. */
  travel: { from: number; to: number; t0: number; ms: number };
};

/**
 * Paint the slot timeline. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintScenes(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ScenesVizState,
  now: number,
  flash: number,
): void {
  const n = p.slots.length;
  let occ = 0;
  for (let i = 0; i < n; i++) if (p.slots[i]!.filled) occ++;
  const on = p.enabled;
  const dim = on ? 1 : 0.42;
  const modeMeta = SCENE_MODES.find((m) => m.id === p.mode) ?? SCENE_MODES[0]!;

  const trav = p.travel;
  const tRaw = trav.ms > 0 ? (now - trav.t0) / trav.ms : 1;
  const moving = trav.from >= 0 && trav.from !== trav.to && tRaw < 1;
  const prog = ease(tRaw);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy: 0.08 + (occ / Math.max(1, n)) * 0.3 + flash * 0.2, horizon: 0.6 });
  strata(ctx, W, Hh, C, { count: 5, horizon: 0.2, alpha: 0.06 });

  const padL = 14;
  const padR = 14;
  const span = Math.max(80, W - padL - padR);
  const stopW = span / Math.max(1, n);
  const stX = (i: number) => padL + (i + 0.5) * stopW;
  const cardTop = 26;
  const cardH = 60;
  const cardW = Math.min(212, stopW * 0.82);
  const trackY = Hh * 0.59;
  const railY = Hh * 0.75;

  // ── the transport line ──
  ctx.fillStyle = hexA(C_MID, 0.18);
  ctx.fillRect(padL, trackY, span, 1);
  ctx.fillStyle = hexA(C_DEEP, 0.3);
  ctx.fillRect(padL, trackY + 1, span, 1);
  // Sleepers between stations — reads as distance travelled, not a plain rule.
  for (let i = 0; i < n; i++) {
    for (let k = 1; k < 4; k++) {
      const x = stX(i) + (k / 4) * stopW - stopW * 0.5;
      ctx.fillStyle = hexA(C_MID, 0.08);
      ctx.fillRect(x, trackY - 2, 1, 5);
    }
  }

  // ── stations ──
  for (let i = 0; i < n; i++) {
    const s = p.slots[i]!;
    const cx = stX(i);
    const x0 = cx - cardW * 0.5;
    const isActive = i === p.activeSlot;
    const isLast = i === p.lastSlot;
    const warmCol = s.warmth > 0.55 ? C_HOT : C_FILL;

    // Card body.
    if (s.filled) {
      const wq = (s.warmth * 5) | 0;
      const eq = (s.energy * 5) | 0;
      const body = cachedGrad(ctx, `bay|${warmCol}|${wq}|${eq}|${cardH}|${cardTop}`, (c) => {
        const g = c.createLinearGradient(0, cardTop, 0, cardTop + cardH);
        g.addColorStop(0, hexA(warmCol, 0.16 + s.energy * 0.2));
        g.addColorStop(1, hexA(C_DEEP, 0.1));
        return g;
      });
      ctx.fillStyle = body;
      roundRect(ctx, x0, cardTop, cardW, cardH, 6);
      ctx.fill();
      ctx.strokeStyle = hexA(isActive ? C_ACTIVE : C, (isActive ? 0.8 : 0.3 + s.density * 0.2) * dim);
      ctx.lineWidth = isActive ? 1.6 : 1;
      roundRect(ctx, x0 + 0.5, cardTop + 0.5, cardW - 1, cardH - 1, 6);
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      roundRect(ctx, x0, cardTop, cardW, cardH, 6);
      ctx.fill();
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = hexA(C_EMPTY, (isActive ? 0.55 : 0.22) * dim);
      ctx.lineWidth = 1;
      roundRect(ctx, x0 + 0.5, cardTop + 0.5, cardW - 1, cardH - 1, 6);
      ctx.stroke();
      ctx.restore();
    }

    // Slot index + name.
    ctx.font = VIZ_FONT_TITLE;
    ctx.textAlign = "left";
    ctx.fillStyle = hexA(s.filled ? C_GLOW : C_EMPTY, (s.filled ? 0.92 : 0.45) * dim);
    ctx.fillText(`${i + 1}`, x0 + 10, cardTop + 15);
    ctx.font = VIZ_FONT_VALUE;
    ctx.fillStyle = hexA(s.filled ? C_HOT : C_EMPTY, (s.filled ? 0.72 : 0.34) * dim);
    const nm = s.filled ? s.name : "EMPTY";
    const maxChars = Math.max(3, Math.floor((cardW - 34) / 5.6));
    ctx.fillText(nm.length > maxChars ? `${nm.slice(0, maxChars - 1)}…` : nm, x0 + 20, cardTop + 15);

    // Fingerprint micro bars — the snapshot's shape at a glance.
    const barL = x0 + 24;
    const barW = Math.max(20, cardW - 34);
    const rows: [string, number, string][] = [
      ["E", s.energy, C_GLOW],
      ["W", s.warmth, C_HOT],
      ["D", s.density, C_FILL],
    ];
    for (let r = 0; r < 3; r++) {
      const [tag, val, col] = rows[r]!;
      const by = cardTop + 26 + r * 11;
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "left";
      ctx.fillStyle = hexA(C_MID, 0.42 * dim);
      ctx.fillText(tag, x0 + 10, by + 3.5);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(barL, by, barW, 4);
      if (s.filled) {
        ctx.fillStyle = hexA(col, (0.3 + val * 0.5) * dim);
        ctx.fillRect(barL, by, Math.max(1, barW * val), 4);
      }
    }

    // Station post down to the line.
    ctx.fillStyle = hexA(s.filled ? C_FILL : C_EMPTY, (s.filled ? 0.35 : 0.16) * dim);
    ctx.fillRect(cx - 0.5, cardTop + cardH, 1, trackY - cardTop - cardH);
    const nodeR = s.filled ? 3.4 + s.energy * 1.8 : 2.2;
    ctx.fillStyle = hexA(s.filled ? C_GLOW : C_EMPTY, (s.filled ? 0.85 : 0.3) * dim);
    ctx.beginPath();
    ctx.arc(cx, trackY + 1, nodeR, 0, Math.PI * 2);
    ctx.fill();

    if (isActive && on) {
      lit(ctx, () => {
        drawGlow(ctx, cx, cardTop + cardH * 0.5, 34 + flash * 12, C_ACTIVE, 0.16 + flash * 0.2);
        drawGlow(ctx, cx, trackY + 1, 9 + flash * 5, C_GLOW, 0.6);
      });
      // Selection brackets on the lit station.
      ctx.strokeStyle = hexA(C_ACTIVE, 0.85);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0 - 3, cardTop + 8);
      ctx.lineTo(x0 - 3, cardTop - 3);
      ctx.lineTo(x0 + 8, cardTop - 3);
      ctx.moveTo(x0 + cardW - 8, cardTop - 3);
      ctx.lineTo(x0 + cardW + 3, cardTop - 3);
      ctx.lineTo(x0 + cardW + 3, cardTop + 8);
      ctx.stroke();
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_ACTIVE, 0.9);
      ctx.fillText(modeMeta.short, cx, cardTop - 7);
    }
    if (isLast && !isActive) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_HOT, 0.55 * dim);
      ctx.fillText("LAST", cx, cardTop - 7);
    }
  }

  // ── travelling carriage + interpolation trail ──
  const fromX = stX(trav.from < 0 ? trav.to : trav.from);
  const toX = stX(trav.to);
  const carX = fromX + (toX - fromX) * prog;
  if (moving) {
    for (let k = 1; k <= 12; k++) {
      const tt = ease(Math.max(0, tRaw - k * 0.055));
      const gx = fromX + (toX - fromX) * tt;
      const a = (1 - k / 13) * 0.4;
      ctx.fillStyle = hexA(C_GLOW, a);
      ctx.beginPath();
      ctx.arc(gx, trackY + 1, 1 + (1 - k / 13) * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = VIZ_FONT_VALUE;
    ctx.textAlign = "center";
    ctx.fillStyle = hexA(C_GLOW, 0.7);
    ctx.fillText(`${Math.round(prog * 100)}%`, carX, trackY + 22);
  }
  ctx.fillStyle = "rgba(6,3,8,0.9)";
  roundRect(ctx, carX - 9, trackY - 4.5, 18, 10, 4);
  ctx.fill();
  ctx.fillStyle = hexA(moving ? C_ACTIVE : C_FILL, (moving ? 0.95 : 0.6) * dim);
  roundRect(ctx, carX - 7.5, trackY - 3, 15, 7, 3);
  ctx.fill();
  if (on) {
    lit(ctx, () => drawGlow(ctx, carX, trackY + 0.5, moving ? 16 : 9, C_GLOW, moving ? 0.85 : 0.4));
  }

  // ── occupancy rail ──
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padL, railY, span, 5);
  ctx.fillStyle = hexA(C_HOT, 0.5 * dim);
  ctx.fillRect(padL, railY + 1, Math.max(1, span * (occ / Math.max(1, n))), 3);
  for (let i = 1; i < n; i++) {
    ctx.fillStyle = hexA(C_DEEP, 0.5);
    ctx.fillRect(padL + (i / n) * span, railY, 1, 5);
  }
  lit(ctx, () => drawGlow(ctx, padL + span * (occ / Math.max(1, n)), railY + 2.5, 7 + flash * 4, C_GLOW, 0.75 * dim));

  // ── header telemetry ──
  ctx.font = VIZ_FONT_LABEL;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(C_GLOW, 0.7 * dim);
  ctx.fillText(`MODE · ${modeMeta.label.toUpperCase()}`, 11, 16);
  ctx.font = VIZ_FONT_VALUE;
  ctx.textAlign = "right";
  ctx.fillStyle = hexA(C_MID, 0.72);
  ctx.fillText(
    p.transition === "morphMs"
      ? `XFER · MORPH ${Math.round(p.morphMs)}ms`
      : p.transition === "nextBar"
        ? "XFER · NEXT BAR"
        : "XFER · IMMEDIATE",
    W - 11,
    16,
  );

  pill(ctx, W * 0.5, 3, !on ? "BYPASS" : moving ? "MORPH" : modeMeta.short, C_GLOW, { glow: flash });

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    !on ? "ORBIT VAULT · BYPASS" : `ORBIT VAULT · ${modeMeta.short} · ${occ}/${n}`,
    p.activeSlot >= 0 ? `SLOT ${p.activeSlot + 1}` : "TAP NODE",
    C_GLOW,
    C,
  );
}

export function ScenesStageViz({
  mode,
  onModeChange,
  activeSlot,
  onActiveSlot,
}: {
  mode: SceneMode;
  onModeChange: (m: SceneMode) => void;
  activeSlot: number;
  onActiveSlot: (i: number) => void;
}) {
  const scenes = useFireCommandStore((s) => s.scenes);
  const sceneMeta = useFireCommandStore((s) => s.sceneMeta);
  const transition = useFireCommandStore((s) => s.sceneTransition);
  const morphMs = useFireCommandStore((s) => s.sceneMorphMs);
  const lastSlot = useFireCommandStore((s) => s.activeSceneSlot);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scenes"] !== false);
  const captureScene = useFireCommandStore((s) => s.captureScene);
  const recallScene = useFireCommandStore((s) => s.recallScene);
  const clearScene = useFireCommandStore((s) => s.clearScene);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const prevKey = useRef(0);
  const prevActive = useRef(activeSlot);
  const travelRef = useRef({ from: -1, to: activeSlot, t0: 0, ms: 240 });

  const slots: SceneSlotViz[] = [];
  for (let i = 0; i < SCENE_SLOTS; i++) {
    const snap = scenes[i];
    const fp = sceneFingerprint(snap);
    slots.push({
      filled: !!snap,
      energy: fp.energy,
      warmth: fp.warmth,
      density: fp.density,
      name: sceneMeta?.[i]?.name ?? `Scene ${i + 1}`,
    });
  }

  const st = useRef<ScenesVizState>({
    slots,
    enabled,
    mode,
    activeSlot,
    lastSlot: lastSlot ?? -1,
    transition,
    morphMs,
    travel: travelRef.current,
  });
  st.current = {
    slots,
    enabled,
    mode,
    activeSlot,
    lastSlot: lastSlot ?? -1,
    transition,
    morphMs,
    travel: travelRef.current,
  };

  const filled = occupiedCount(scenes);
  const live = enabled && filled > 0;
  // Bitmask so re-capturing an occupied slot still counts as a change.
  let fillMask = 0;
  for (let i = 0; i < SCENE_SLOTS; i++) if (scenes[i]) fillMask |= 1 << i;

  // A recall/capture on a new slot launches the carriage; the run length is the
  // transition the store will actually use.
  useEffect(() => {
    if (activeSlot === prevActive.current) return;
    travelRef.current = {
      from: prevActive.current,
      to: activeSlot,
      t0: performance.now(),
      ms: transition === "morphMs" ? Math.max(60, morphMs) : transition === "nextBar" ? 800 : 240,
    };
    prevActive.current = activeSlot;
  }, [activeSlot, transition, morphMs]);

  useEffect(() => {
    const key = motionHash(fillMask, SCENE_MODES.findIndex((m) => m.id === mode), activeSlot, enabled);
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [fillMask, mode, activeSlot, enabled]);

  const actOnSlot = useCallback(
    (i: number) => {
      if (!st.current.enabled) return;
      const m = st.current.mode;
      flashRef.current = 1;
      onActiveSlot(i);
      if (m === "capture") captureScene(i);
      else if (m === "recall") {
        if (st.current.slots[i]?.filled) recallScene(i);
      } else if (st.current.slots[i]?.filled) clearScene(i);
    },
    [captureScene, clearScene, onActiveSlot, recallScene],
  );

  const cycleMode = useCallback(
    (dir = 1) => {
      const ids = SCENE_MODES.map((m) => m.id);
      const i = ids.indexOf(st.current.mode);
      onModeChange(ids[(i + dir + ids.length) % ids.length]!);
      flashRef.current = 1;
    },
    [onModeChange],
  );

  /** Nearest station along the width — the timeline's stations are the hit grid. */
  const hitSlot = useCallback(
    (clientX: number, _clientY: number): number => {
      const wrap = wrapRef.current;
      if (!wrap) return -1;
      const rect = wrap.getBoundingClientRect();
      const padL = 14;
      const span = Math.max(80, rect.width - padL * 2);
      const x = ((clientX - rect.left) - padL) / span;
      const i = Math.floor(x * SCENE_SLOTS);
      return Math.max(0, Math.min(SCENE_SLOTS - 1, i));
    },
    [wrapRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yNorm = (e.clientY - rect.top) / Math.max(1, rect.height);
      flashRef.current = 1;
      if (yNorm < 0.12) {
        cycleMode(1);
        return;
      }
      if (yNorm > 0.88) {
        const empty = firstEmptySlot(scenes);
        onModeChange("capture");
        actOnSlot(empty);
        return;
      }
      const slot = hitSlot(e.clientX, e.clientY);
      if (slot >= 0) actOnSlot(slot);
    },
    [actOnSlot, cycleMode, hitSlot, onModeChange, scenes, wrapRef],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        flashRef.current *= 0.86;
        paintScenes(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => {
        const s = st.current;
        const t = travelRef.current;
        // Only the carriage animates; a parked timeline can sleep.
        const running = t.from >= 0 && t.from !== t.to && performance.now() - t.t0 < t.ms + 60;
        let mask = 0;
        for (let i = 0; i < s.slots.length; i++) if (s.slots[i]!.filled) mask |= 1 << i;
        return {
          flash: flashRef.current,
          active: s.enabled && running,
          visible: visibleRef.current,
          motionKey: motionHash(
            s.activeSlot,
            s.lastSlot,
            s.enabled,
            t.t0,
            mask,
            s.mode === "capture" ? 0 : s.mode === "recall" ? 1 : 2,
          ),
        };
      },
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
        opacity: enabled ? 1 : 0.7,
      }}
      onPointerDown={onPointerDown}
      role="img"
      aria-label="Orbit vault — click slots, top cycles mode, bottom captures next empty"
      title="Nodes: act · Top: mode · Bottom: capture next empty"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
