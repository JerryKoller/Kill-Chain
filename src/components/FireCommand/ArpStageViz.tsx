/**
 * Arpeggiator — Cascade Orbit stage visualizer.
 * Mode · tempo · gate · swing · ratchet · accent (Signal Path Mod · FC.arp).
 * Drag: BPM ↔ / Gate ↕. Bottom: Swing. Click: arm toggle. Double-click: cycle mode.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, buildArpSequence, type ArpMode, type ArpSettings } from "@/state/fireCommandStore";
import { NOTE_NAMES } from "@/state/fireSequencerStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.arp;
const C_DEEP = bandShade(FC.mod, 0.32);
const C_MID = bandShade(FC.mod, 0.55);
const C_HOT = bandShade(FC.mod, 0.75);
const C_GLOW = bandShade(FC.mod, 0.96);
const C_BPM = bandShade(FC.mod, 0.62);
const C_GATE = bandShade(FC.mod, 0.8);
const C_SWING = bandShade(FC.mod, 0.88);
const C_ACCENT = bandShade(FC.mod, 0.92);

const BPM_MIN = 40;
const BPM_MAX = 300;
const GATE_MIN = 0.1;
const GATE_MAX = 1;

const MODE_CYCLE: ArpMode[] = [
  "up", "down", "updown", "downup", "converge", "diverge", "pedal", "random", "walk", "asplayed",
];

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

function logLerp(t: number, lo: number, hi: number) {
  return lo * Math.pow(hi / lo, clamp(t, 0, 1));
}

function logNorm(v: number, lo: number, hi: number) {
  return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
}

function noteName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
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

type DragMode = "xy" | "swing" | null;
type Pt = { x: number; y: number; midi: number; accented: boolean; i: number };
type Bloom = { x: number; y: number; life: number; accented: boolean };

export function ArpStageViz() {
  const arp = useFireCommandStore((s) => s.arp);
  const arpOrder = useFireCommandStore((s) => s.arpOrder);
  const setArp = useFireCommandStore((s) => s.setArp);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const bloomsRef = useRef<Bloom[]>([]);
  const lastStepRef = useRef(-1);
  const pulseRef = useRef(0);
  const prevKey = useRef("");
  const st = useRef({ arp, arpOrder });
  st.current = { arp, arpOrder };

  const live = arp.enabled && arpOrder.length > 0;

  useEffect(() => {
    const key = `${arp.enabled}|${arp.mode}|${arp.bpm}|${arp.gate.toFixed(2)}|${(arp.swing ?? 0).toFixed(2)}|${(arp.ratchet ?? 0).toFixed(2)}|${(arp.accent ?? 0).toFixed(2)}|${arp.accentEvery}|${arp.octaves}|${arp.division}|${arp.hold}|${arpOrder.join(",")}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [arp, arpOrder]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setArp({
        bpm: Math.round(logLerp(x, BPM_MIN, BPM_MAX)),
        gate: Math.round((GATE_MIN + (1 - y) * (GATE_MAX - GATE_MIN)) * 100) / 100,
      });
    },
    [setArp],
  );

  const applySwing = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setArp({ swing: Math.round(x * 0.33 * 1000) / 1000 });
    },
    [setArp],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "swing";
        wrap.setPointerCapture(e.pointerId);
        applySwing(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applySwing],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "swing") applySwing(e.clientX);
    },
    [applyXy, applySwing],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const i = MODE_CYCLE.indexOf(st.current.arp.mode);
    const next = MODE_CYCLE[(i + 1) % MODE_CYCLE.length]!;
    setArp({ mode: next });
  }, [setArp]);

  const onClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Only toggle arm on quick click without drag — handled via pointerup if no move
      // Use double-click for mode; single click on badge area toggles — simpler: Alt+click or we use a dedicated approach
      // Actually: short click without significant drag toggles enable when clicking top chrome zone
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (e.clientY - rect.top < 28) {
        setArp({ enabled: !st.current.arp.enabled });
      }
    },
    [setArp],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const drawContour = (pts: Pt[]) => {
      if (pts.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i]!.x + pts[i + 1]!.x) / 2;
        const yc = (pts[i]!.y + pts[i + 1]!.y) / 2;
        ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, xc, yc);
      }
      const lastPt = pts[pts.length - 1]!;
      ctx.quadraticCurveTo(lastPt.x, lastPt.y, lastPt.x, lastPt.y);
    };

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const { arp: a, arpOrder: order } = st.current;
      // Per-tick values read straight off the store — subscribing to them
      // re-rendered the whole component at note rate.
      const { arpStepIndex: stepIdx, arpCurrent: cur } = useFireCommandStore.getState();
      flashRef.current *= 0.86;

      const ghost = order.length === 0;
      const held = ghost ? [60, 64, 67] : order;
      const seq = buildArpSequence(held, a.mode, a.octaves);
      const bpmN = logNorm(a.bpm, BPM_MIN, BPM_MAX);
      const gateN = (a.gate - GATE_MIN) / (GATE_MAX - GATE_MIN);
      const swing = a.swing ?? 0;
      const ratchet = a.ratchet ?? 0;
      const accentAmt = a.accent ?? 0;
      const every = Math.max(0, Math.round(a.accentEvery ?? 4));
      const energy =
        0.12 +
        (a.enabled ? 0.25 : 0) +
        (ghost ? 0 : 0.15) +
        gateN * 0.15 +
        swing * 0.5 +
        ratchet * 0.15 +
        flashRef.current * 0.25;

      ctx.clearRect(0, 0, W, Hh);

      // Cascade chamber
      const bg = ctx.createRadialGradient(W * (0.35 + bpmN * 0.2), Hh * 0.4, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, (a.enabled ? 0.12 : 0.05) + energy * 0.32 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(2,6,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Soft stair grid (cascade identity)
      ctx.strokeStyle = hexAlpha(C_MID, 0.06 + gateN * 0.06);
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const y = 28 + i * ((Hh * 0.55) / 6);
        ctx.beginPath();
        ctx.moveTo(16, y);
        ctx.lineTo(W - 16, y);
        ctx.stroke();
      }

      if (seq.length === 0) {
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("HOLD A CHORD", W / 2, Hh * 0.42);
      } else {
        const lo = Math.min(...seq);
        const hi = Math.max(...seq);
        const span = Math.max(1, hi - lo);
        const n = Math.min(seq.length, 48);
        const PAD_X = 20;
        const PAD_Y = 28;
        const usableW = W - PAD_X * 2;
        const usableH = Hh * 0.62 - 8;
        const running = !ghost && a.enabled && stepIdx >= 0;
        const breath = ghost || !a.enabled ? 0.55 + 0.45 * Math.sin(now / 900) : 1;

        const pts: Pt[] = [];
        for (let i = 0; i < n; i++) {
          const midi = seq[i]!;
          const t = n === 1 ? 0.5 : i / (n - 1);
          const swingNudge = (i % 2 === 1 ? swing : -swing * 0.35) * (usableW / Math.max(1, n)) * 0.9;
          const x = PAD_X + t * usableW + swingNudge;
          const y = PAD_Y + (1 - (midi - lo) / span) * usableH;
          const accented = accentAmt > 0 && every > 0 && i % every === 0;
          pts.push({ x, y, midi, accented, i });
        }

        // Contour fill
        if (pts.length > 1) {
          drawContour(pts);
          ctx.lineTo(pts[pts.length - 1]!.x, Hh * 0.72);
          ctx.lineTo(pts[0]!.x, Hh * 0.72);
          ctx.closePath();
          const fill = ctx.createLinearGradient(0, PAD_Y, 0, Hh * 0.72);
          fill.addColorStop(0, hexAlpha(C_GLOW, 0.16 * breath + (a.enabled ? 0.08 : 0)));
          fill.addColorStop(1, hexAlpha(C_DEEP, 0));
          ctx.fillStyle = fill;
          ctx.fill();

          drawContour(pts);
          ctx.strokeStyle = hexAlpha(C_GLOW, (ghost ? 0.2 : a.enabled ? 0.85 : 0.4) * breath);
          ctx.lineWidth = 2.4;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.shadowBlur = a.enabled && !ghost ? 12 + flashRef.current * 8 : 0;
          ctx.shadowColor = C;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Gate columns + nodes
        const colW = Math.max(4, Math.min(16, (usableW / n) * 0.5));
        for (const p of pts) {
          const isLive = running && stepIdx === p.i;
          const barH = Math.max(8, (Hh * 0.72 - p.y) * (0.35 + a.gate * 0.65));
          const cg = ctx.createLinearGradient(p.x, p.y, p.x, p.y + barH);
          const baseA = ghost ? 0.06 * breath : isLive ? 0.45 : 0.12;
          cg.addColorStop(0, hexAlpha(p.accented ? C_ACCENT : C_HOT, baseA));
          cg.addColorStop(1, hexAlpha(C_HOT, 0));
          ctx.fillStyle = cg;
          const hw = colW / 2;
          ctx.beginPath();
          ctx.moveTo(p.x - hw, p.y);
          ctx.lineTo(p.x + hw, p.y);
          ctx.lineTo(p.x + hw * 0.7, p.y + barH);
          ctx.lineTo(p.x - hw * 0.7, p.y + barH);
          ctx.closePath();
          ctx.fill();

          const r = isLive ? 6 : p.accented ? 4.5 : 3.4;
          ctx.fillStyle = hexAlpha(isLive ? C_GLOW : p.accented ? C_ACCENT : C_HOT, ghost ? 0.35 * breath : 0.9);
          ctx.shadowBlur = isLive ? 14 : p.accented ? 8 : 0;
          ctx.shadowColor = p.accented ? C_ACCENT : C;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          if (p.accented && !ghost && accentAmt > 0.05) {
            ctx.strokeStyle = hexAlpha(C_ACCENT, 0.55 + accentAmt * 0.4);
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - r - 6);
            ctx.lineTo(p.x + 3.5, p.y - r - 1);
            ctx.lineTo(p.x - 3.5, p.y - r - 1);
            ctx.closePath();
            ctx.stroke();
          }
        }

        // Playhead
        if (running && stepIdx < pts.length) {
          const p = pts[stepIdx]!;
          const beam = ctx.createLinearGradient(p.x, 0, p.x, Hh);
          beam.addColorStop(0, hexAlpha(C_GLOW, 0));
          beam.addColorStop(0.35, hexAlpha(C_GLOW, 0.4));
          beam.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = beam;
          ctx.fillRect(p.x - 2, 0, 4, Hh);

          ctx.font = "700 11px ui-monospace, Menlo, monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
          ctx.shadowBlur = 10;
          ctx.shadowColor = C;
          ctx.fillText(noteName(p.midi), p.x, Math.max(16, p.y - 14));
          ctx.shadowBlur = 0;

          if (stepIdx !== lastStepRef.current) {
            bloomsRef.current.push({ x: p.x, y: p.y, life: 1, accented: p.accented });
            pulseRef.current = 1;
            lastStepRef.current = stepIdx;
          }
        } else {
          lastStepRef.current = -1;
        }

        // Blooms
        for (let i = bloomsRef.current.length - 1; i >= 0; i--) {
          const b = bloomsRef.current[i]!;
          b.life -= 0.038;
          if (b.life <= 0) {
            bloomsRef.current.splice(i, 1);
            continue;
          }
          const expand = (1 - b.life) * (b.accented ? 34 : 24);
          ctx.strokeStyle = hexAlpha(b.accented ? C_ACCENT : C_GLOW, b.life * b.life * 0.85);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 4 + expand, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Ratchet double rings
        if (running && ratchet > 0.05 && stepIdx < pts.length) {
          const p = pts[stepIdx]!;
          const shimmer = 0.5 + 0.5 * Math.sin(now / (55 - ratchet * 35));
          ctx.strokeStyle = hexAlpha(C_HOT, 0.28 * shimmer * ratchet);
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10 + shimmer * 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14 + shimmer * 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // BPM / Gate crosshair
      const hx = bpmN * W;
      const hy = (1 - gateN) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Mode chip
      const chip = a.mode.toUpperCase();
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(chip).width + 12;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, chipW, 13);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, chipW, 13);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(chip, W * 0.5, 16);

      // Swing rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_SWING, 0.25 + swing * 1.2);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      if (swing > 0.01) {
        const rg = ctx.createLinearGradient(12, railY, 12 + (W - 24) * (swing / 0.33), railY);
        rg.addColorStop(0, hexAlpha(C_SWING, 0.35));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.8));
        ctx.fillStyle = rg;
        ctx.fillRect(12, railY + 1, (W - 24) * (swing / 0.33), 5);
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * (swing / 0.33), railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_SWING, 0.8);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("SWING", 14, railY - 3);

      // Pulse edges
      if (pulseRef.current > 0) {
        ctx.fillStyle = hexAlpha(C, pulseRef.current * 0.25);
        ctx.fillRect(0, 0, W, 2);
        ctx.fillRect(0, Hh - 2, W, 2);
        pulseRef.current = Math.max(0, pulseRef.current - 0.05);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("ARP · CASCADE ORBIT", 12, Hh - 2);
      ctx.textAlign = "right";
      let status: string;
      if (ghost) status = "HOLD CHORD";
      else if (a.enabled) status = cur != null ? `● ${noteName(cur)} · ${a.bpm}` : `● LIVE · ${a.bpm}`;
      else status = `STANDBY · ${a.bpm} · ${a.octaves}º`;
      ctx.fillStyle = hexAlpha(a.enabled && !ghost ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: 0,
        motionKey: "",
      }),
      { minIntervalMs: 18 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, live ? 0.55 : arp.enabled ? 0.4 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      title="Drag: BPM ↔ / Gate ↕ · Bottom: Swing · Top click: Arm · Double-click: cycle mode"
      role="img"
      aria-label="Arpeggiator cascade orbit"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r-2 border-t-2" style={{ borderColor: hexAlpha(C_GLOW, 0.7) }} />
      <span className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b-2 border-l-2" style={{ borderColor: hexAlpha(C, 0.5) }} />
      <span className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b-2 border-r-2" style={{ borderColor: hexAlpha(C, 0.5) }} />
      <div
        className="pointer-events-none absolute left-3 top-2 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.78) }}
      >
        Cascade Orbit
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(arp.enabled ? C_HOT : C_MID, 0.78) }}
      >
        {arp.enabled ? (arp.hold ? "HOLD" : "ARMED") : "OFF"}
      </div>
    </div>
  );
}

/** Compat wrapper for older call sites that pass arp prop */
export function ArpViz(_props: { arp: ArpSettings }) {
  return <ArpStageViz />;
}
