/**
 * Glue — Press Anvil stage visualizer.
 * Bus DynamicsCompressor via punch (Signal Path Mix · FC.glue).
 * Drag ↕/↔: Punch. Double-click: cycle Off → Soft → Bus → Crush → Slam.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 172;
const C = FC.glue;
const C_DEEP = bandShade(FC_BAND.mix, 0.28);
const C_MID = bandShade(FC_BAND.mix, 0.45);
const C_HOT = bandShade(FC_BAND.mix, 0.58);
const C_GLOW = bandShade(FC_BAND.mix, 0.9);
const C_GR = bandShade(FC_BAND.mix, 0.68);
const C_VU = bandShade(FC_BAND.mix, 0.78);
const C_MK = bandShade(FC_BAND.mix, 0.84);

const PUNCH_CYCLE = [0, 0.25, 0.45, 0.7, 1] as const;

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

function punchLabel(p: number): string {
  if (p < 0.03) return "OPEN";
  if (p < 0.3) return "SOFT";
  if (p < 0.55) return "GLUE";
  if (p < 0.8) return "CRUSH";
  return "SLAM";
}

/** Mirror DSP mapping for display. */
function glueMetrics(punch: number) {
  const p = clamp(punch, 0, 1);
  return {
    threshDb: -p * 30,
    ratio: 1 + p * 7,
    makeupDb: 20 * Math.log10(1 + p * 0.3),
    grDb: p * (6 + p * 8), // display-ballistic estimate
  };
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

export function GlueStageViz() {
  const punch = useFireCommandStore((s) => s.patch.punch) ?? 0;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["glue"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef("");
  const grRef = useRef(0);
  const vuRef = useRef(0.35);
  const history = useRef<number[]>([]);
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const st = useRef({ punch, enabled });
  st.current = { punch, enabled };

  const live = enabled && punch > 0.03;

  useEffect(() => {
    const key = `${punch.toFixed(3)}|${enabled ? 1 : 0}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [punch, enabled]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyPunch = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      // Prefer vertical press metaphor; blend with X for pad feel
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const v = clamp(1 - y * 0.75 + (x - 0.5) * 0.15, 0, 1);
      setParam("punch", Math.round(v * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = true;
      flashRef.current = 1;
      applyPunch(e.clientX, e.clientY);
    },
    [applyPunch],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      applyPunch(e.clientX, e.clientY);
    },
    [applyPunch],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = false;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.punch;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < PUNCH_CYCLE.length; i++) {
      const d = Math.abs(PUNCH_CYCLE[i]! - cur);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setParam("punch", PUNCH_CYCLE[(best + 1) % PUNCH_CYCLE.length]!);
    flashRef.current = 1;
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (t) => {
      flashRef.current *= 0.9;

      const { w: W, h: Hcss } = sizeRef.current;
      if (W < 2) return;
      const { punch: pRaw, enabled: on } = st.current;
      const p = on ? pRaw : 0;
      const flash = flashRef.current;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.0024);
      const m = glueMetrics(p);
      const cx = W * 0.5;

      ctx.clearRect(0, 0, W, Hcss);

      // Chassis
      const bg = ctx.createLinearGradient(0, 0, 0, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.7 + flash * 0.2));
      bg.addColorStop(0.45, "rgba(8,4,2,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.4 + p * 0.2));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Anvil bed glow
      const bedY = Hcss * 0.72;
      const bedG = ctx.createRadialGradient(cx, bedY, 4, cx, bedY, W * (0.22 + p * 0.18));
      bedG.addColorStop(0, hexAlpha(C_HOT, (0.2 + p * 0.35 + flash * 0.25) * (on ? 1 : 0.3)));
      bedG.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bedG;
      ctx.fillRect(0, 0, W, Hcss);

      // ── Press jaws (top plate descends with punch) ──
      const jawGap = Hcss * (0.28 - p * 0.16);
      const topJawY = Hcss * 0.18 + (1 - p) * 4;
      const botJawY = topJawY + jawGap + Hcss * 0.08;

      // Top plate
      ctx.fillStyle = hexAlpha(C_DEEP, 0.85);
      ctx.strokeStyle = hexAlpha(C, 0.55 + p * 0.35);
      ctx.lineWidth = 1.5;
      const plateW = W * (0.42 + p * 0.08);
      roundRect(ctx, cx - plateW / 2, topJawY - 10, plateW, 14 + p * 4, 3);
      ctx.fill();
      ctx.stroke();

      // Rivets on top plate
      for (let i = -2; i <= 2; i++) {
        const rx = cx + i * (plateW / 5.5);
        ctx.fillStyle = hexAlpha(C_GLOW, 0.45 + p * 0.4);
        ctx.beginPath();
        ctx.arc(rx, topJawY - 3, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bottom anvil
      ctx.fillStyle = hexAlpha(C_MID, 0.75);
      roundRect(ctx, cx - plateW / 2 - 6, botJawY, plateW + 12, 16, 2);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(C_HOT, 0.5 + p * 0.3);
      ctx.stroke();

      // Vertical guide posts
      for (const dir of [-1, 1] as const) {
        const px = cx + dir * (plateW / 2 + 10);
        ctx.strokeStyle = hexAlpha(C, 0.25 + p * 0.2);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, topJawY - 14);
        ctx.lineTo(px, botJawY + 16);
        ctx.stroke();
      }

      // Squashed waveform between jaws
      const waveY = (topJawY + botJawY) / 2;
      const waveH = Math.max(4, jawGap * 0.55);
      const squash = 1 - p * 0.72;
      ctx.beginPath();
      const pts = 64;
      for (let i = 0; i <= pts; i++) {
        const u = i / pts;
        const x = cx - plateW * 0.42 + u * plateW * 0.84;
        const sig =
          Math.sin(u * Math.PI * 6 + t * 0.006) * 0.55 +
          Math.sin(u * Math.PI * 13 + t * 0.009) * 0.3 +
          Math.sin(u * Math.PI * 2.2 + t * 0.003) * 0.25;
        const y = waveY - sig * waveH * squash * (0.85 + breath * 0.15);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.55 + p * 0.4 + flash * 0.2);
      ctx.lineWidth = 1.6 + p * 1.2;
      ctx.shadowBlur = 6 + p * 12 + flash * 8;
      ctx.shadowColor = hexAlpha(C_HOT, 0.6);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Compression "press" force lines when engaged
      if (p > 0.05) {
        for (let i = 0; i < 5; i++) {
          const lx = cx - plateW * 0.3 + (i / 4) * plateW * 0.6;
          const alpha = (0.15 + p * 0.45) * (0.6 + 0.4 * Math.sin(t * 0.008 + i));
          ctx.strokeStyle = hexAlpha(C_GR, alpha);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(lx, topJawY + 6);
          ctx.lineTo(lx, botJawY - 2);
          ctx.stroke();
        }
      }

      // Sparks when slamming / dragging
      if (on && (p > 0.55 || dragRef.current || flash > 0.35)) {
        if (Math.random() < 0.25 + p * 0.4) {
          const side = Math.random() < 0.5 ? -1 : 1;
          sparks.current.push({
            x: cx + side * (plateW * 0.35 + Math.random() * 8),
            y: waveY + (Math.random() - 0.5) * 6,
            vx: side * (0.4 + Math.random() * 1.5),
            vy: -0.5 - Math.random() * 1.8,
            life: 1,
          });
          if (sparks.current.length > 36) sparks.current.shift();
        }
      }
      for (let i = sparks.current.length - 1; i >= 0; i--) {
        const s = sparks.current[i]!;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.06;
        s.life -= 0.03;
        if (s.life <= 0) {
          sparks.current.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(C_GLOW, s.life * 0.9);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + s.life * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Right: GR VU gauge ──
      const gcx = W * 0.86;
      const gcy = Hcss * 0.48;
      const needleLen = Hcss * 0.28;

      const vuTarget = 0.35 + p * 0.45 + 0.08 * Math.sin(t * 0.005);
      vuRef.current += (vuTarget - vuRef.current) * 0.1;
      const grTarget = p * (0.4 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.0036)));
      grRef.current += (grTarget - grRef.current) * 0.16;
      const gr = grRef.current;
      const vu = vuRef.current;

      history.current.push(gr);
      if (history.current.length > 36) history.current.shift();

      ctx.strokeStyle = hexAlpha(C, 0.2);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(gcx, gcy, needleLen, Math.PI * 0.75, Math.PI * 0.25, false);
      ctx.stroke();

      // GR arc fill
      ctx.strokeStyle = hexAlpha(C_GR, 0.55 + gr * 0.35);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(gcx, gcy, needleLen, Math.PI * 0.75, Math.PI * 0.75 + gr * Math.PI * 1.5, false);
      ctx.stroke();

      history.current.forEach((h, i) => {
        const age = i / history.current.length;
        const a = Math.PI * 0.75 + h * Math.PI * 1.5;
        const r = needleLen * 0.72;
        ctx.fillStyle = hexAlpha(C_GLOW, age * 0.2 * p);
        ctx.fillRect(gcx + Math.cos(a) * r - 1, gcy + Math.sin(a) * r - 1, 2.5, 2.5);
      });

      const grA = Math.PI * 0.75 + gr * Math.PI * 1.5;
      ctx.strokeStyle = hexAlpha(C_HOT, 0.85);
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 8 + gr * 10;
      ctx.shadowColor = hexAlpha(C_HOT, 0.7);
      ctx.beginPath();
      ctx.moveTo(gcx, gcy);
      ctx.lineTo(gcx + Math.cos(grA) * needleLen, gcy + Math.sin(grA) * needleLen);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const vuA = Math.PI * 0.75 + vu * Math.PI * 1.5;
      ctx.strokeStyle = hexAlpha(C_VU, 0.4 + vu * 0.3);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(gcx, gcy);
      ctx.lineTo(gcx + Math.cos(vuA) * needleLen * 0.82, gcy + Math.sin(vuA) * needleLen * 0.82);
      ctx.stroke();

      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.beginPath();
      ctx.arc(gcx, gcy, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GR, 0.7);
      ctx.textAlign = "center";
      ctx.fillText(`−${m.grDb.toFixed(1)}`, gcx, gcy + needleLen * 0.55 + 10);

      // ── Left: threshold / ratio stack ──
      const lx = 14;
      const ly = 16;
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C, 0.55);
      ctx.fillText("THR", lx, ly);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText(`${m.threshDb.toFixed(0)} dB`, lx + 28, ly);

      ctx.fillStyle = hexAlpha(C, 0.55);
      ctx.fillText("RAT", lx, ly + 14);
      ctx.fillStyle = hexAlpha(C_HOT, 0.9);
      ctx.fillText(`${m.ratio.toFixed(1)}:1`, lx + 28, ly + 14);

      ctx.fillStyle = hexAlpha(C, 0.55);
      ctx.fillText("MKP", lx, ly + 28);
      ctx.fillStyle = hexAlpha(C_MK, 0.9);
      ctx.fillText(`+${m.makeupDb.toFixed(1)} dB`, lx + 28, ly + 28);

      // Ratio teeth bar
      const teethY = Hcss - 28;
      const teethW = W * 0.36;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(lx, teethY, teethW, 6);
      const teethFill = (p) * teethW;
      const tg = ctx.createLinearGradient(lx, 0, lx + teethFill, 0);
      tg.addColorStop(0, hexAlpha(C_MID, 0.7));
      tg.addColorStop(1, hexAlpha(C_HOT, 0.95));
      ctx.fillStyle = tg;
      ctx.fillRect(lx, teethY, teethFill, 6);
      for (let i = 0; i <= 8; i++) {
        const tx = lx + (i / 8) * teethW;
        ctx.fillStyle = hexAlpha(C_GLOW, i / 8 <= p ? 0.9 : 0.2);
        ctx.fillRect(tx - 0.5, teethY - 2, 1.2, 10);
      }

      // Bottom scrub rail
      const railY = Hcss - 12;
      const railPad = 14;
      ctx.strokeStyle = hexAlpha(C, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(W - railPad, railY);
      ctx.stroke();
      const thumbX = railPad + p * (W - railPad * 2);
      ctx.strokeStyle = hexAlpha(C_HOT, 0.75 + flash * 0.2);
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();
      for (const notch of PUNCH_CYCLE) {
        const nx = railPad + notch * (W - railPad * 2);
        const active = Math.abs(p - notch) < 0.04;
        ctx.fillStyle = hexAlpha(active ? C_GLOW : C, active ? 0.95 : 0.35);
        ctx.beginPath();
        ctx.arc(nx, railY, active ? 3.2 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8 + flash * 10;
      ctx.shadowColor = hexAlpha(C_HOT, 0.7);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 5 + flash * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Labels
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.35);
      ctx.textAlign = "left";
      ctx.fillText(on ? "PRESS ANVIL" : "PRESS ANVIL · BYPASS", 10, Hcss - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7 + flash * 0.25);
      ctx.fillText(`${punchLabel(p)} · ${Math.round(p * 100)}%`, W - 10, Hcss - 8);

      if (!on) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, Hcss);
      }
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
        dragging: !!dragRef.current,
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
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)] cursor-ns-resize touch-none select-none"
      style={{
        borderColor: `${C}${live ? "77" : "44"}`,
        height: H,
        boxShadow: live
          ? `inset 0 2px 8px rgba(0,0,0,0.45), 0 0 28px ${C}33, 0 6px 18px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="slider"
      aria-label="Bus glue punch — drag to press"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(punch * 100)}
      title="Drag ↕ punch · Double-click cycles Off → Soft → Bus → Crush → Slam"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 70% 100%, 0 100%)", opacity: 0.7 }} />
      <span className="pointer-events-none absolute right-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 100% 100%, 30% 100%)", opacity: 0.7 }} />
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
