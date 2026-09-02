/**
 * Scale Lock — Key Lattice stage visualizer.
 *
 * IDIOM: the key lattice. A chromatic key strip runs the full width — in-scale
 * keys lit and tied together by the lattice chain, out-of-scale keys dark. What
 * makes it a *lock* readout is the redirect layer: every off-scale key shows
 * what actually happens to a press under the current correction mode, drawn as
 * a ghost that travels sideways to the key it lands on.
 *
 *   guide  — nothing moves; off-scale presses pass through (dotted ghost)
 *   soft   — arrow to the nearest scale tone (ties resolve downward)
 *   fold   — arrow to the nearest tone in the direction of the press
 *   strict — no arrow: the press is rejected before it sounds
 *
 * Pitch-class cage (Signal Path Perf · FC.scale).
 * Click keys to set root · top strip cycles scale · bottom toggles lock.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import {
  useFireSequencerStore,
  NOTE_NAMES,
  SCALES,
  inScale,
  snapMidiToScale,
  type ScaleId,
} from "@/state/fireSequencerStore";
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
  motionHash,
  pill,
  plate,
  VIZ_FONT_LABEL,
  VIZ_FONT_TITLE,
  VIZ_FONT_VALUE,
  VIZ_TOP_LABEL_X,
  VIZ_TOP_LABEL_Y,
} from "./stageVizKit";

const H = 168;
const C = FC.scale;
const C_DEEP = bandShade(FC_BAND.perf, 0.36);
const C_MID = bandShade(FC_BAND.perf, 0.52);
const C_HOT = bandShade(FC_BAND.perf, 0.68);
const C_GLOW = bandShade(FC_BAND.perf, 0.94);
const C_ROOT = bandShade(FC_BAND.perf, 0.58);
const C_DEGREE = bandShade(FC_BAND.perf, 0.8);
const C_LOCK = bandShade(FC_BAND.perf, 0.74);

export const SCALE_CYCLE: ScaleId[] = SCALES.map((s) => s.id);

export function scaleMeta(id: ScaleId) {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]!;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

const BLACK_PC = [false, true, false, true, false, false, true, false, true, false, true, false];

export type ScaleLockMode = "guide" | "soft" | "strict" | "fold";

/** Where an off-scale press lands, resolved exactly like the live note path. */
export function redirectOf(pc: number, root: number, id: ScaleId, mode: ScaleLockMode): number {
  const m = 60 + pc;
  if (mode === "guide" || mode === "strict") return m;
  const snapped = snapMidiToScale(m, root, id);
  if (mode === "fold" && snapped < m) {
    const up = snapMidiToScale(m + 1, root, id);
    if (Math.abs(up - m) < Math.abs(snapped - m)) return up;
  }
  return snapped;
}

type HitZone = "scale" | "key" | "lock";

export type ScaleVizState = {
  lock: boolean;
  mode: ScaleLockMode;
  enabled: boolean;
  root: number;
  scaleId: ScaleId;
  /** Per pitch class (0..11). */
  inScale: boolean[];
  /** 1-based scale degree, 0 when off-scale. */
  degree: number[];
  /** Signed semitone move a press gets pushed by (0 = stays). */
  move: number[];
  pulseKey: number;
};

/**
 * Paint the key lattice. Exported and pure so it can be rendered headlessly
 * without mounting the component or waiting on a frame.
 */
export function paintScale(
  ctx: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  p: ScaleVizState,
  now: number,
  flash: number,
): void {
  const meta = scaleMeta(p.scaleId);
  const steps = meta.steps;
  const rootPc = ((p.root % 12) + 12) % 12;
  const locked = p.enabled && p.lock;
  const chromatic = p.scaleId === "off";
  const mode: ScaleLockMode = !locked ? "guide" : p.mode === "guide" ? "soft" : p.mode;
  const dim = p.enabled ? 1 : 0.45;
  const density = chromatic ? 1 : steps.length / 12;
  const breath = 0.9 + 0.1 * Math.sin(now * 0.0014);

  ctx.clearRect(0, 0, W, Hh);
  plate(ctx, W, Hh, C, { energy: 0.08 + (locked ? 0.24 + density * 0.14 : 0.04) + flash * 0.16, horizon: 0.68 });

  const keyW = W / 12;
  // Keys start low enough that the ROOT tag above them clears the reserved
  // top strip the DOM chrome owns.
  const keyTop = 42;
  const keyBot = Hh - 40;
  const keyH = keyBot - keyTop;
  const capH = keyH * 0.6;
  const inset = keyW * 0.17;
  const arrowY = keyTop + keyH * 0.68;
  const nameY = keyBot - 11;

  // ── key bed ──
  const bed = cachedGrad(ctx, `bed|${keyTop}|${keyBot}`, (c) => {
    const g = c.createLinearGradient(0, keyTop, 0, keyBot);
    g.addColorStop(0, "rgba(16,6,14,0.85)");
    g.addColorStop(1, "rgba(4,1,4,0.92)");
    return g;
  });
  ctx.fillStyle = bed;
  ctx.fillRect(0, keyTop, W, keyH);

  // ── keys ──
  for (let i = 0; i < 12; i++) {
    const x0 = i * keyW;
    const black = BLACK_PC[i]!;
    const inS = p.inScale[i] ?? false;
    const isRoot = i === rootPc;
    const pulsed = p.pulseKey === i;
    const face = isRoot ? C_ROOT : inS ? C_DEGREE : C_DEEP;
    const shineA = locked && inS ? (isRoot ? 0.62 : 0.4) + (pulsed ? 0.22 : 0) : black ? 0.05 : 0.09;

    // Key body — one cached gradient per face colour, brightness via alpha.
    const body = cachedGrad(ctx, `keyf|${face}|${keyTop}|${keyBot}`, (c) => {
      const g = c.createLinearGradient(0, keyTop, 0, keyBot);
      g.addColorStop(0, hexA(face, 0.95));
      g.addColorStop(0.62, hexA(face, 0.5));
      g.addColorStop(1, hexA(face, 0.12));
      return g;
    });
    ctx.save();
    ctx.globalAlpha = shineA * dim * (locked && inS ? breath : 1);
    ctx.fillStyle = body;
    ctx.fillRect(x0 + 1.5, keyTop, keyW - 3, keyH);
    ctx.restore();

    // Front lip + column separators give the strip its key relief.
    ctx.fillStyle = hexA(locked && inS ? face : C_MID, (locked && inS ? 0.5 : 0.14) * dim);
    ctx.fillRect(x0 + 1.5, keyBot - 4, keyW - 3, 3);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x0, keyTop, 1.5, keyH);
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fillRect(x0 + 1.5, keyTop, keyW - 3, 1);

    // Black pitch classes carry a raised cap so the row reads as a keyboard.
    if (black) {
      const capG = cachedGrad(ctx, `cap|${locked && inS ? face : "none"}|${keyTop}|${capH | 0}`, (c) => {
        const g = c.createLinearGradient(0, keyTop, 0, keyTop + capH);
        g.addColorStop(0, locked && inS ? hexA(face, 0.55) : "rgba(26,10,22,0.96)");
        g.addColorStop(1, locked && inS ? hexA(face, 0.16) : "rgba(6,2,6,0.98)");
        return g;
      });
      ctx.fillStyle = capG;
      ctx.fillRect(x0 + inset, keyTop, keyW - inset * 2, capH);
      ctx.strokeStyle = hexA(locked && inS ? face : C_DEEP, 0.35 * dim);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + inset + 0.5, keyTop + 0.5, keyW - inset * 2 - 1, capH - 1);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x0 + inset + 1, keyTop + 1, keyW - inset * 2 - 2, 1);
    }

    // Out-of-scale keys go dark and hatched while the lock is engaged.
    if (locked && !inS && !chromatic) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x0 + 1.5, keyTop, keyW - 3, keyH);
      ctx.strokeStyle = hexA(C, 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const sx = x0 + 4 + k * ((keyW - 8) / 4);
        ctx.moveTo(sx, keyTop + 6);
        ctx.lineTo(sx + (keyW - 8) / 4, keyBot - 8);
      }
      ctx.stroke();
    }

    // Note name + scale degree.
    const cx = x0 + keyW * 0.5;
    ctx.textAlign = "center";
    ctx.font = VIZ_FONT_TITLE;
    ctx.fillStyle = isRoot
      ? hexA(C_GLOW, 0.95 * dim)
      : hexA(locked && inS ? C_GLOW : C_MID, (locked && inS ? 0.7 : 0.3) * dim);
    ctx.fillText(NOTE_NAMES[i]!, cx, nameY);
    if (inS && !chromatic) {
      ctx.font = VIZ_FONT_LABEL;
      ctx.fillStyle = hexA(isRoot ? C_ROOT : C_DEGREE, (locked ? 0.75 : 0.4) * dim);
      ctx.fillText(`${p.degree[i]}`, cx, keyTop + 13);
    }

    if (isRoot) {
      ctx.strokeStyle = hexA(C_GLOW, (locked ? 0.9 : 0.45) * dim);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0 + 4, keyTop - 6);
      ctx.lineTo(x0 + keyW - 4, keyTop - 6);
      ctx.stroke();
      ctx.font = VIZ_FONT_LABEL;
      ctx.fillStyle = hexA(C_GLOW, 0.8 * dim);
      ctx.fillText("ROOT", cx, keyTop - 10);
      if (locked) lit(ctx, () => drawGlow(ctx, cx, keyTop + keyH * 0.4, 30 + flash * 12, C_ROOT, 0.3));
    }
  }

  // ── lattice chain: the in-scale keys tied together across the width ──
  if (!chromatic && steps.length > 1) {
    const ly = keyTop + 24;
    glowStroke(
      ctx,
      () => {
        let started = false;
        for (let i = 0; i < 12; i++) {
          if (!(p.inScale[i] ?? false)) continue;
          const cx = i * keyW + keyW * 0.5;
          if (!started) {
            ctx.moveTo(cx, ly);
            started = true;
          } else ctx.lineTo(cx, ly);
        }
      },
      C_LOCK,
      { width: 1.2, glow: locked ? 0.8 : 0.2, alpha: (locked ? 0.35 + density * 0.25 : 0.14) * dim },
    );
    for (let i = 0; i < 12; i++) {
      if (!(p.inScale[i] ?? false)) continue;
      const cx = i * keyW + keyW * 0.5;
      ctx.fillStyle = hexA(i === rootPc ? C_GLOW : C_LOCK, (locked ? 0.8 : 0.3) * dim);
      ctx.beginPath();
      ctx.arc(cx, ly, i === rootPc ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── redirect layer: what a press on an off-scale key actually does ──
  if (!chromatic) {
    for (let i = 0; i < 12; i++) {
      if (p.inScale[i] ?? false) continue;
      const cx = i * keyW + keyW * 0.5;
      if (mode === "guide") {
        // Passes through untouched — a ghost that stays where it was pressed.
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = hexA(C_MID, 0.45 * dim);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, arrowY, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.font = VIZ_FONT_LABEL;
        ctx.textAlign = "center";
        ctx.fillStyle = hexA(C_MID, 0.5 * dim);
        ctx.fillText("PASS", cx, arrowY - 13);
        continue;
      }
      if (mode === "strict") {
        // Rejected before it sounds — no redirect, a hard block.
        ctx.strokeStyle = hexA(C_HOT, 0.6 * dim);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - 7, arrowY - 7);
        ctx.lineTo(cx + 7, arrowY + 7);
        ctx.moveTo(cx + 7, arrowY - 7);
        ctx.lineTo(cx - 7, arrowY + 7);
        ctx.stroke();
        ctx.font = VIZ_FONT_LABEL;
        ctx.textAlign = "center";
        ctx.fillStyle = hexA(C_HOT, 0.55 * dim);
        ctx.fillText("BLOCK", cx, arrowY - 13);
        continue;
      }
      const mv = p.move[i] ?? 0;
      if (mv === 0) continue;
      const tx = cx + mv * keyW;
      const lift = mode === "fold" ? 16 : 9;
      const drift = ((now * 0.0006 + i * 0.21) % 1);
      const a = (0.4 + density * 0.2) * dim;
      // Ghost sliding from the pressed key to the key it lands on.
      glowStroke(
        ctx,
        () => {
          ctx.moveTo(cx, arrowY);
          ctx.quadraticCurveTo((cx + tx) * 0.5, arrowY - lift, tx, arrowY);
        },
        C_LOCK,
        { width: 1.3, glow: 0.7, alpha: a },
      );
      const dir = mv > 0 ? 1 : -1;
      ctx.fillStyle = hexA(C_GLOW, a + 0.2);
      ctx.beginPath();
      ctx.moveTo(tx, arrowY + 1);
      ctx.lineTo(tx - dir * 6, arrowY - 4);
      ctx.lineTo(tx - dir * 6, arrowY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = hexA(C_MID, a * 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, arrowY, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      lit(ctx, () => {
        const gx = cx + (tx - cx) * drift;
        const gy = arrowY - Math.sin(drift * Math.PI) * lift;
        drawGlow(ctx, gx, gy, 6, C_GLOW, 0.5 * dim);
      });
      ctx.font = VIZ_FONT_LABEL;
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(C_LOCK, 0.55 * dim);
      ctx.fillText(`${mv > 0 ? "+" : ""}${mv}`, (cx + tx) * 0.5, arrowY - lift - 4);
    }
  }

  // ── scale strip (top drag zone) ──
  const padX = 10;
  const usable = W - padX * 2;
  const stripY = 18;
  const scaleIdx = Math.max(0, SCALE_CYCLE.indexOf(p.scaleId));
  const segW = usable / SCALE_CYCLE.length;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(padX, stripY, usable, 6);
  for (let i = 0; i < SCALE_CYCLE.length; i++) {
    ctx.fillStyle = i === scaleIdx ? hexA(C_HOT, 0.8 + flash * 0.2) : hexA(C, 0.12);
    ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, 4);
  }
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
  tel(`SCALE · ${meta.label.toUpperCase()}`, C_GLOW, 0.7 * dim, VIZ_FONT_LABEL);
  tel(`${NOTE_NAMES[rootPc]} · ${chromatic ? 12 : steps.length}°`, C_DEGREE, 0.72, VIZ_FONT_VALUE);

  pill(ctx, W * 0.5, 3, !p.enabled ? "ASLEEP" : mode.toUpperCase(), C_GLOW, { glow: flash });

  // ── lock rail (bottom drag zone) ──
  const railY = Hh - 25;
  const lockT = !p.enabled ? 0 : p.lock ? 1 : 0.15;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(padX, railY, usable, 6);
  ctx.fillStyle = hexA(C_LOCK, 0.5 * dim);
  ctx.fillRect(padX, railY + 1, Math.max(2, usable * lockT), 4);
  lit(ctx, () => drawGlow(ctx, padX + usable * lockT, railY + 3, 7 + flash * 4, C_GLOW, 0.8 * dim));

  grain(ctx, W, Hh, 0.026);
  bezel(ctx, W, Hh, C);
  footer(
    ctx,
    W,
    Hh,
    !p.enabled
      ? "KEY LATTICE · ASLEEP"
      : !p.lock
        ? "KEY LATTICE · OPEN"
        : chromatic
          ? "KEY LATTICE · CHROMATIC"
          : "KEY LATTICE · LOCKED",
    `${NOTE_NAMES[rootPc]} ${meta.label} · ${chromatic ? 12 : steps.length}°`,
    C_GLOW,
    C,
  );
}

export function ScaleStageViz() {
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const lockMode = useFireCommandStore((s) => s.patch.scaleMode) ?? "guide";
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scale"] !== false);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);

  const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
  const flashRef = useRef(0);
  const pulseKeyRef = useRef(-1);
  const prevKey = useRef(0);

  const effMode: ScaleLockMode = lock ? (lockMode === "guide" ? "soft" : lockMode) : "guide";
  const inS: boolean[] = [];
  const degree: number[] = [];
  const move: number[] = [];
  const steps = scaleMeta(scaleId).steps;
  for (let pc = 0; pc < 12; pc++) {
    const hit = inScale(60 + pc, root, scaleId);
    inS.push(hit);
    degree.push(hit ? steps.indexOf(((60 + pc - root) % 12 + 12) % 12) + 1 : 0);
    move.push(hit ? 0 : redirectOf(pc, root, scaleId, effMode) - (60 + pc));
  }

  const st = useRef<ScaleVizState>({
    lock,
    mode: effMode,
    enabled,
    root,
    scaleId,
    inScale: inS,
    degree,
    move,
    pulseKey: -1,
  });
  st.current = {
    lock,
    mode: effMode,
    enabled,
    root,
    scaleId,
    inScale: inS,
    degree,
    move,
    pulseKey: pulseKeyRef.current,
  };

  const live = enabled && lock && scaleId !== "off";

  useEffect(() => {
    const key = motionHash(lock, enabled, root, SCALE_CYCLE.indexOf(scaleId));
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [lock, enabled, root, scaleId]);

  const hitZone = useCallback(
    (clientY: number): HitZone => {
      const wrap = wrapRef.current;
      if (!wrap) return "key";
      const rect = wrap.getBoundingClientRect();
      const y = (clientY - rect.top) / Math.max(1, rect.height);
      if (y < 0.16) return "scale";
      if (y > 0.84) return "lock";
      return "key";
    },
    [wrapRef],
  );

  const cycleScale = useCallback(
    (dir = 1) => {
      const ids = SCALE_CYCLE;
      const i = ids.indexOf(st.current.scaleId);
      const next = ids[(i + dir + ids.length) % ids.length]!;
      setScaleId(next);
      flashRef.current = 1;
    },
    [setScaleId],
  );

  const setRootAt = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.999);
      const pc = Math.floor(x * 12);
      setScaleRoot(pc);
      pulseKeyRef.current = pc;
      st.current.pulseKey = pc;
      flashRef.current = 1;
    },
    [setScaleRoot, wrapRef],
  );

  const toggleLock = useCallback(() => {
    setParam("scaleLock", !st.current.lock);
    flashRef.current = 1;
  }, [setParam]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const zone = hitZone(e.clientY);
      if (zone === "scale") cycleScale(1);
      else if (zone === "lock") toggleLock();
      else setRootAt(e.clientX);
    },
    [cycleScale, hitZone, setRootAt, toggleLock],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!(e.buttons & 1)) return;
      if (hitZone(e.clientY) === "key") setRootAt(e.clientX);
    },
    [hitZone, setRootAt],
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
        if (pulseKeyRef.current >= 0 && flashRef.current < 0.15) {
          pulseKeyRef.current = -1;
          st.current.pulseKey = -1;
        }
        paintScale(ctx, W, Hh, st.current, now, flashRef.current);
      },
      () => ({
        flash: flashRef.current,
        // Only the redirect ghosts drift; an open or chromatic lattice is still.
        active: st.current.enabled && st.current.lock && st.current.scaleId !== "off",
        visible: visibleRef.current,
        motionKey: motionHash(
          st.current.lock,
          st.current.enabled,
          st.current.root,
          SCALE_CYCLE.indexOf(st.current.scaleId),
          st.current.pulseKey,
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
      role="img"
      aria-label="Key lattice — click keys for root, top cycles scale, bottom toggles lock"
      title="Keys: Root · Top: Scale · Bottom: Lock"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
