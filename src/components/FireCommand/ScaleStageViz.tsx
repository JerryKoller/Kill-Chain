/**
 * Scale Lock — Key Lattice stage visualizer.
 * Pitch-class cage (Signal Path Perf · FC.scale).
 * Click keys to set root · top strip cycles scale · bottom toggles lock.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES, type ScaleId } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

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

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function useHiDpi(
  wrapRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  cssH: number,
  sizeRef: MutableRefObject<{ w: number; h: number }>,
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wrapRef, canvasRef, cssH, sizeRef]);
}

type HitZone = "scale" | "key" | "lock";

export function ScaleStageViz() {
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scale"] !== false);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const pulseKeyRef = useRef(-1);
  const prevKey = useRef("");
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const st = useRef({ lock, enabled, root, scaleId });
  st.current = { lock, enabled, root, scaleId };

  const live = enabled && lock && scaleId !== "off";

  useEffect(() => {
    const key = `${lock ? 1 : 0}|${enabled ? 1 : 0}|${root}|${scaleId}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [lock, enabled, root, scaleId]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const hitZone = useCallback((clientY: number): HitZone => {
    const wrap = wrapRef.current;
    if (!wrap) return "key";
    const rect = wrap.getBoundingClientRect();
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    if (y < 0.16) return "scale";
    if (y > 0.84) return "lock";
    return "key";
  }, []);

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
      flashRef.current = 1;
    },
    [setScaleRoot],
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
      (t) => {
      flashRef.current *= 0.9;
      if (pulseKeyRef.current >= 0 && flashRef.current < 0.15) pulseKeyRef.current = -1;

      const { w: W, h: Hcss } = sizeRef.current;
      if (W < 2) return;
      const s = st.current;
      const flash = flashRef.current;
      const meta = scaleMeta(s.scaleId);
      const steps = meta.steps;
      const rootPc = ((s.root % 12) + 12) % 12;
      const locked = s.enabled && s.lock;
      const chromatic = s.scaleId === "off";
      const breathe = 0.92 + 0.08 * Math.sin(t / 720);
      const density = chromatic ? 1 : steps.length / 12;

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createLinearGradient(0, 0, W, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.75 + flash * 0.2));
      bg.addColorStop(0.5, "rgba(10,2,8,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.35 + (locked ? 0.15 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Scale strip (top)
      const stripY = 8;
      const stripH = 10;
      const padX = 10;
      const usable = W - padX * 2;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(padX, stripY, usable, stripH);
      const scaleIdx = Math.max(0, SCALE_CYCLE.indexOf(s.scaleId));
      const segW = usable / SCALE_CYCLE.length;
      for (let i = 0; i < SCALE_CYCLE.length; i++) {
        const on = i === scaleIdx;
        ctx.fillStyle = on ? hexAlpha(C_HOT, 0.75 + flash * 0.2) : hexAlpha(C, 0.12);
        ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, stripH - 2);
      }
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.textAlign = "left";
      ctx.fillText(`SCALE · ${meta.label.toUpperCase()}`, padX, stripY - 1);

      // Lattice grid behind keys
      const keyY = 28;
      const keyH = Hcss - 52;
      const keyW = W / 12;
      if (locked && !chromatic) {
        ctx.strokeStyle = hexAlpha(C, 0.08 + density * 0.06);
        ctx.lineWidth = 1;
        for (let d of steps) {
          const pc = (rootPc + d) % 12;
          const x = pc * keyW + keyW / 2;
          ctx.beginPath();
          ctx.moveTo(x, keyY);
          ctx.lineTo(x, keyY + keyH);
          ctx.stroke();
        }
        // Horizontal lattice rails
        for (let r = 0; r < 3; r++) {
          const y = keyY + keyH * (0.25 + r * 0.25);
          ctx.strokeStyle = hexAlpha(C, 0.05 + flash * 0.04);
          ctx.beginPath();
          ctx.moveTo(padX, y);
          ctx.lineTo(W - padX, y);
          ctx.stroke();
        }
      }

      // Pitch-class keys
      for (let i = 0; i < 12; i++) {
        const x = i * keyW;
        const deg = (i - rootPc + 12) % 12;
        const inS = chromatic || steps.includes(deg);
        const isRoot = i === rootPc;
        const black = [1, 3, 6, 8, 10].includes(i);
        const pulsed = pulseKeyRef.current === i;

        const g = ctx.createLinearGradient(x, keyY, x, keyY + keyH);
        if (locked && inS) {
          g.addColorStop(0, hexAlpha(isRoot ? C_ROOT : C_DEGREE, (isRoot ? 0.7 : 0.45) + breathe * 0.15 + (pulsed ? 0.25 : 0)));
          g.addColorStop(1, hexAlpha(C_DEEP, 0.35));
        } else if (black) {
          g.addColorStop(0, "rgba(20,8,16,0.7)");
          g.addColorStop(1, "rgba(8,2,6,0.85)");
        } else {
          g.addColorStop(0, "rgba(30,12,24,0.35)");
          g.addColorStop(1, "rgba(12,4,10,0.5)");
        }
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, keyY, keyW - 2, keyH);

        // Out-of-scale dim bars when locked
        if (locked && !inS && !chromatic) {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(x + 1, keyY, keyW - 2, keyH);
          // X hatch
          ctx.strokeStyle = hexAlpha(C, 0.12);
          ctx.beginPath();
          ctx.moveTo(x + 3, keyY + 4);
          ctx.lineTo(x + keyW - 3, keyY + keyH - 4);
          ctx.stroke();
        }

        // Degree gem
        const cx = x + keyW / 2;
        const cy = keyY + keyH * 0.55;
        const pulse = inS ? 0.7 + 0.3 * Math.sin(t / 180 + i * 0.55) : 0.2;
        const sz = isRoot ? 7 + (locked ? 2 : 0) : inS ? 5 : 2.4;
        if (locked && inS) {
          const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 2.6);
          halo.addColorStop(0, hexAlpha(C_GLOW, pulse * 0.55));
          halo.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(cx, cy, sz * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = locked && inS ? hexAlpha(C_GLOW, 0.85 + pulse * 0.15) : hexAlpha(C, 0.2);
        ctx.shadowBlur = locked && inS ? 8 + pulse * 6 : 0;
        ctx.shadowColor = hexAlpha(C_HOT, 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy, sz * breathe, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isRoot) {
          ctx.strokeStyle = hexAlpha(C_GLOW, locked ? 0.9 : 0.4);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(cx, cy, sz + 4 + flash * 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = isRoot ? hexAlpha(C_GLOW, 0.9) : hexAlpha(C, inS && locked ? 0.55 : 0.28);
        ctx.textAlign = "center";
        ctx.fillText(NOTE_NAMES[i]!, cx, keyY + keyH - 6);
      }

      // Connecting lattice arcs between in-scale degrees
      if (locked && !chromatic && steps.length > 1) {
        const pts = steps.map((d) => {
          const pc = (rootPc + d) % 12;
          return { x: pc * keyW + keyW / 2, y: keyY + keyH * 0.28 };
        });
        ctx.strokeStyle = hexAlpha(C_LOCK, 0.25 + density * 0.2);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % pts.length]!;
          if (i === 0) ctx.moveTo(a.x, a.y);
          const mx = (a.x + b.x) / 2;
          const my = Math.min(a.y, b.y) - 10 - Math.sin(t / 400 + i) * 3;
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
        }
        ctx.stroke();
      }

      // Sparks when locked
      if (locked) {
        if (Math.random() < 0.18 + density * 0.2) {
          const d = steps[Math.floor(Math.random() * steps.length)] ?? 0;
          const pc = (rootPc + d) % 12;
          sparks.current.push({
            x: pc * keyW + keyW / 2,
            y: keyY + keyH * (0.3 + Math.random() * 0.4),
            vx: (Math.random() - 0.5) * 0.6,
            vy: -0.3 - Math.random() * 0.5,
            life: 1,
          });
          if (sparks.current.length > 40) sparks.current.shift();
        }
        for (let i = sparks.current.length - 1; i >= 0; i--) {
          const p = sparks.current[i]!;
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.018;
          if (p.life <= 0) {
            sparks.current.splice(i, 1);
            continue;
          }
          ctx.fillStyle = hexAlpha(C_GLOW, p.life * 0.55);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.2 + p.life * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Lock rail
      const railY = Hcss - 10;
      ctx.strokeStyle = hexAlpha(C_LOCK, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(W - padX, railY);
      ctx.stroke();
      const lockT = !s.enabled ? 0 : s.lock ? 1 : 0.15;
      ctx.strokeStyle = hexAlpha(C_LOCK, 0.85);
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(padX + lockT * usable, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(padX + lockT * usable, railY, 4.5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      const status = !s.enabled
        ? "KEY LATTICE · BYPASS"
        : !s.lock
          ? "KEY LATTICE · OPEN"
          : chromatic
            ? "KEY LATTICE · CHROMATIC"
            : "KEY LATTICE · LOCKED";
      ctx.fillText(status, 10, Hcss - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(
        `${NOTE_NAMES[rootPc]} ${meta.label} · ${chromatic ? 12 : steps.length}°`,
        W - 10,
        Hcss - 8,
      );
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
        dragging: false,
        particles: 0,
        motionKey: "",
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, []);

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
