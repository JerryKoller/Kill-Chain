/**
 * CHIP — Acid Circuit stage visualizer.
 * PWM · hard sync · chip noise · accent/slide (Signal Path Sources · FC.chip).
 * Drag horizontally to set pulse duty. Every chip control paints the cart.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ChipNoiseMode } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 158;
const C = FC.chip;
const C_DEEP = bandShade(FC.sources, 0.42);
const C_MID = bandShade(FC.sources, 0.55);
const C_HOT = bandShade(FC.sources, 0.72);
const C_GLOW = bandShade(FC.sources, 0.9);
const C_SYNC = bandShade(FC.sources, 0.62);
const C_NOISE = bandShade(FC.sources, 0.48);
const C_ACC = bandShade(FC.sources, 0.78);

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

function noiseHold(mode: ChipNoiseMode): number {
  if (mode === "nes") return 7;
  if (mode === "gb") return 4;
  if (mode === "periodic") return 2;
  return 1;
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

export function ChipStageViz() {
  const duty = useFireCommandStore((s) => s.patch.pulseDuty) ?? 0.5;
  const sync = useFireCommandStore((s) => s.patch.hardSync) ?? false;
  const noise = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const accent = useFireCommandStore((s) => s.patch.accentAmount) ?? 0;
  const slide = useFireCommandStore((s) => s.patch.slideOn) ?? false;
  const voices = useFireCommandStore((s) => s.patch.chipVoiceLimit) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef("");
  const st = useRef({ duty, sync, noise, accent, slide, voices });
  st.current = { duty, sync, noise, accent, slide, voices };

  const active = Math.abs(duty - 0.5) > 0.02 || sync || slide || accent > 0.02 || voices > 0 || noise !== "white";

  useEffect(() => {
    const key = `${duty.toFixed(3)}|${sync}|${noise}|${accent.toFixed(3)}|${slide}|${voices}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [duty, sync, noise, accent, slide, voices]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const setDutyFromClientX = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const t = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      // Map full width to 5%–95%
      const d = 0.05 + t * 0.9;
      setParam("pulseDuty", Math.round(d * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Duty scrub on upper/mid wave region; lower third reserved for reading
      if (y > H * 0.72) return;
      dragRef.current = true;
      wrap.setPointerCapture(e.pointerId);
      setDutyFromClientX(e.clientX);
    },
    [setDutyFromClientX],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      setDutyFromClientX(e.clientX);
    },
    [setDutyFromClientX],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setParam("pulseDuty", 0.5);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparkles: Array<{ x: number; y: number; life: number; vx: number; vy: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.88;

      const dutyC = clamp(p.duty, 0.05, 0.95);
      const energy = 0.25 + Math.abs(dutyC - 0.5) * 0.8 + p.accent * 0.45 + (p.sync ? 0.15 : 0);

      ctx.clearRect(0, 0, W, Hh);

      // Cart CRT field — Sources coral
      const bg = ctx.createRadialGradient(W * (0.35 + dutyC * 0.3), Hh * 0.35, 4, W * 0.5, Hh * 0.5, W * 0.72);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.14 + energy * 0.25 + flashRef.current * 0.28));
      bg.addColorStop(0.5, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(4,1,2,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Pixel grid
      const grid = 10;
      ctx.strokeStyle = hexAlpha(C_MID, 0.08 + p.accent * 0.08);
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, Hh);
        ctx.stroke();
      }
      for (let y = 0; y < Hh; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(W, y + 0.5);
        ctx.stroke();
      }

      // Accent wash
      if (p.accent > 0.04) {
        const rb = ctx.createRadialGradient(W * 0.5, Hh * 0.3, 0, W * 0.5, Hh * 0.3, Hh * 0.55);
        rb.addColorStop(0, hexAlpha(C_ACC, 0.28 * p.accent * energy));
        rb.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = rb;
        ctx.fillRect(0, 0, W, Hh);
      }

      const mid = Hh * 0.4;
      const amp = Hh * 0.2 * (1 + p.accent * 0.4) * (0.9 + flashRef.current * 0.15);
      const cycles = 4 + (p.sync ? 1 : 0);
      const scroll = now * 0.00115 * (p.slide ? 0.55 : 1);

      // Slide trail ghost (lagged duty)
      if (p.slide) {
        const lagDuty = clamp(dutyC + Math.sin(now / 400) * 0.08, 0.05, 0.95);
        ctx.beginPath();
        let first = true;
        for (let i = 0; i <= W; i += 2) {
          const u = (i / W) * cycles + scroll * 0.7;
          const phase = ((u % 1) + 1) % 1;
          const y = mid - (phase < lagDuty ? amp * 0.7 : -amp * 0.7);
          if (first) {
            ctx.moveTo(i, y);
            first = false;
          } else ctx.lineTo(i, y);
        }
        ctx.strokeStyle = hexAlpha(C_MID, 0.28);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Pixel PWM square
      ctx.beginPath();
      {
        let first = true;
        let prevY = mid;
        for (let i = 0; i <= W; i++) {
          const u = (i / W) * cycles + scroll;
          const phase = ((u % 1) + 1) % 1;
          const y = mid - (phase < dutyC ? amp : -amp);
          if (first) {
            ctx.moveTo(i, y);
            first = false;
            prevY = y;
          } else if (y !== prevY) {
            // Hard pixel edge
            ctx.lineTo(i, prevY);
            ctx.lineTo(i, y);
            prevY = y;
          } else ctx.lineTo(i, y);
        }
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.55 + energy * 0.4);
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 10 + p.accent * 12 + flashRef.current * 16;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill under pulse high
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i <= W; i += 2) {
        const u = (i / W) * cycles + scroll;
        const phase = ((u % 1) + 1) % 1;
        ctx.lineTo(i, mid - (phase < dutyC ? amp : -amp));
      }
      ctx.lineTo(W, mid);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      fill.addColorStop(0, hexAlpha(C_HOT, 0.22 + energy * 0.2));
      fill.addColorStop(0.5, hexAlpha(C, 0.08));
      fill.addColorStop(1, hexAlpha(C_DEEP, 0.12));
      ctx.fillStyle = fill;
      ctx.fill();

      // Duty marker
      const dutyX = dutyC * W;
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(dutyX, mid - amp - 8);
      ctx.lineTo(dutyX, mid + amp + 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.beginPath();
      ctx.arc(dutyX, mid - amp - 8, 3 + flashRef.current * 2, 0, Math.PI * 2);
      ctx.fill();

      // Hard sync reset ticks
      if (p.sync) {
        ctx.strokeStyle = hexAlpha(C_SYNC, 0.85);
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = C_SYNC;
        for (let c = 0; c < cycles; c++) {
          const x = (((c - (scroll % 1)) / cycles) * W + W) % W;
          ctx.beginPath();
          ctx.moveTo(x, mid - amp - 8);
          ctx.lineTo(x, mid + amp + 8);
          ctx.stroke();
          ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
          ctx.beginPath();
          ctx.arc(x, mid - amp - 8, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      // Chip noise grit band
      const noiseY = Hh * 0.78;
      const hold = noiseHold(p.noise);
      if (p.noise !== "white") {
        ctx.fillStyle = hexAlpha(C_NOISE, 0.12 + energy * 0.08);
        ctx.fillRect(0, noiseY - 12, W, 24);
        ctx.fillStyle = hexAlpha(C_HOT, 0.45 + energy * 0.2);
        ctx.shadowBlur = 5;
        ctx.shadowColor = C;
        for (let x = 0; x < W; x += hold) {
          const seed = Math.sin(x * 0.37 + now * 0.008 * (hold < 3 ? 2 : 1));
          const bit = seed > 0 ? 1 : -1;
          ctx.fillRect(x, noiseY + bit * 6, Math.max(1, hold - 1), 3);
        }
        ctx.shadowBlur = 0;
      } else {
        // Soft white hiss dots
        ctx.fillStyle = hexAlpha(C_MID, 0.15);
        for (let i = 0; i < 40; i++) {
          const x = ((i * 47 + now * 0.05) % W);
          const y = noiseY + Math.sin(i * 1.7 + now * 0.01) * 8;
          ctx.fillRect(x, y, 1.5, 1.5);
        }
      }

      // Accent sparkles at edges
      if (p.accent > 0.12 && Math.random() < 0.18 * p.accent) {
        const u = Math.random();
        const phase = ((u * cycles + scroll) % 1 + 1) % 1;
        if (Math.abs(phase - dutyC) < 0.06 || phase < 0.04) {
          sparkles.push({
            x: u * W,
            y: mid - (phase < dutyC ? amp : -amp),
            life: 1,
            vx: (Math.random() - 0.5) * 2.5,
            vy: (Math.random() - 0.5) * 2 - 1.2,
          });
        }
      }
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i]!;
        sp.life -= 0.028;
        if (sp.life <= 0) {
          sparkles.splice(i, 1);
          continue;
        }
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.12;
        const rg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 4);
        rg.addColorStop(0, hexAlpha(C_ACC, sp.life * 0.85));
        rg.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Voice poly bars
      const vCount = Math.round(p.voices);
      if (vCount > 0) {
        const barW = 4;
        const gap = 2;
        const total = vCount * (barW + gap);
        let sx = W - 12 - total;
        for (let v = 0; v < vCount; v++) {
          const pulse = Math.sin(now / 140 + v * 0.55) * 0.5 + 0.5;
          ctx.fillStyle = hexAlpha(C_GLOW, 0.45 + pulse * 0.5);
          ctx.shadowBlur = 4 * pulse;
          ctx.shadowColor = C;
          ctx.fillRect(sx + v * (barW + gap), 10, barW, 6 + pulse * 6);
          ctx.shadowBlur = 0;
        }
      }

      // Slide arrow
      if (p.slide) {
        ctx.strokeStyle = hexAlpha(C_HOT, 0.55);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(W * 0.72, 14);
        ctx.lineTo(W * 0.88, 14);
        ctx.lineTo(W * 0.84, 11);
        ctx.moveTo(W * 0.88, 14);
        ctx.lineTo(W * 0.84, 17);
        ctx.stroke();
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText(`CHIP · PWM ${Math.round(dutyC * 100)}% · ${String(p.noise).toUpperCase()}`, 12, Hh - 6);
      ctx.textAlign = "right";
      const tags = [
        p.sync ? "SYNC" : null,
        p.slide ? "SLIDE" : null,
        p.accent > 0.04 ? `ACC ${Math.round(p.accent * 100)}` : null,
        vCount > 0 ? `V${vCount}` : null,
      ].filter(Boolean);
      ctx.fillStyle = hexAlpha(C_HOT, 0.8);
      ctx.fillText(tags.length ? tags.join(" · ") : "IDLE CART", W - 12, Hh - 6);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: sparkles.length,
        motionKey: "",
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, active ? 0.5 : 0.28),
        height: H,
        cursor: "ew-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexAlpha(C, active ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
        imageRendering: "pixelated",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag to set pulse width · double-click = 50% square"
      role="slider"
      aria-label="Chip pulse duty"
      aria-valuemin={5}
      aria-valuemax={95}
      aria-valuenow={Math.round(duty * 100)}
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
        Acid Circuit
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.7) }}
      >
        {Math.round(duty * 100)}%
      </div>
    </div>
  );
}
