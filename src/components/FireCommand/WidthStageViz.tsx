/**
 * Width — Side Horizon stage visualizer.
 * Mid/side stereo span (Signal Path Mix · FC.width).
 * Drag ↔: Stereo width. Double-click: cycle Mono → Unity → Wide → Hyper.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const W_MAX = 1.4;
const C = FC.width;
const C_DEEP = bandShade(FC_BAND.mix, 0.32);
const C_MID = bandShade(FC_BAND.mix, 0.48);
const C_HOT = bandShade(FC_BAND.mix, 0.62);
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
const C_SIDE = bandShade(FC_BAND.mix, 0.72);
const C_L = bandShade(FC_BAND.mix, 0.42);
const C_R = bandShade(FC_BAND.mix, 0.78);

const WIDTH_CYCLE = [0, 0.5, 1, 1.2, 1.4] as const;

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

function widthLabel(w: number): string {
  if (w < 0.04) return "MONO";
  if (w < 0.55) return "NARROW";
  if (w < 0.95) return "STEREO";
  if (w < 1.15) return "WIDE";
  return "HYPER";
}

/** Approximate M/S energy share for display (w=1 → equal mid/side scale). */
function midSide(w: number): { mid: number; side: number; corr: number } {
  const side = clamp(w / W_MAX, 0, 1);
  const mid = clamp(1 - side * 0.55, 0.2, 1);
  // Correlation ≈ 1 at mono, falls as sides grow
  const corr = clamp(1 - side * 0.85, 0.05, 1);
  return { mid, side, corr };
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

export function WidthStageViz() {
  const width = useFireCommandStore((s) => s.patch.stereoWidth) ?? 1;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["width"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef(false);
  const prevKey = useRef("");
  const particles = useRef<{ x: number; y: number; vx: number; life: number; side: number }[]>([]);
  const st = useRef({ width, enabled });
  st.current = { width, enabled };

  const live = enabled && Math.abs(width - 1) > 0.03;

  useEffect(() => {
    const key = `${width.toFixed(3)}|${enabled ? 1 : 0}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [width, enabled]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyWidth = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("stereoWidth", Math.round(x * W_MAX * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = true;
      flashRef.current = 1;
      applyWidth(e.clientX);
    },
    [applyWidth],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      applyWidth(e.clientX);
    },
    [applyWidth],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = false;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current.width;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WIDTH_CYCLE.length; i++) {
      const d = Math.abs(WIDTH_CYCLE[i]! - cur);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = WIDTH_CYCLE[(best + 1) % WIDTH_CYCLE.length]!;
    setParam("stereoWidth", next);
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
      const { width: wVal, enabled: on } = st.current;
      const w = on ? wVal : 1;
      const flash = flashRef.current;
      const { mid, side, corr } = midSide(w);
      const breath = 0.5 + 0.5 * Math.sin(t * 0.0018);
      const cx = W * 0.5;
      const cy = Hcss * 0.46;
      const n = clamp(w / W_MAX, 0, 1);

      ctx.clearRect(0, 0, W, Hcss);

      // Chamber plate
      const bg = ctx.createLinearGradient(0, 0, W, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.55 + flash * 0.2));
      bg.addColorStop(0.5, "rgba(6,3,1,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.35 + flash * 0.15));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Horizon glow band — widens with stereo
      const horizonY = cy + Hcss * 0.08;
      const hzW = W * (0.12 + n * 0.42 + flash * 0.06);
      const hz = ctx.createRadialGradient(cx, horizonY, 2, cx, horizonY, hzW);
      hz.addColorStop(0, hexAlpha(C_GLOW, (0.18 + n * 0.35 + flash * 0.25) * (on ? 1 : 0.35)));
      hz.addColorStop(0.55, hexAlpha(C_HOT, 0.1 + n * 0.12));
      hz.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, W, Hcss);

      // Mid corridor (narrows as sides grow)
      const midHalf = W * (0.08 + mid * 0.1) * (1 - n * 0.25);
      const midG = ctx.createLinearGradient(cx - midHalf, 0, cx + midHalf, 0);
      midG.addColorStop(0, "rgba(0,0,0,0)");
      midG.addColorStop(0.35, hexAlpha(C, 0.12 + mid * 0.18));
      midG.addColorStop(0.5, hexAlpha(C_GLOW, 0.22 + mid * 0.2 + flash * 0.15));
      midG.addColorStop(0.65, hexAlpha(C, 0.12 + mid * 0.18));
      midG.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = midG;
      ctx.fillRect(cx - midHalf * 1.4, 8, midHalf * 2.8, Hcss - 28);

      // Side wings
      const wingReach = W * (0.08 + n * 0.38);
      for (const dir of [-1, 1] as const) {
        const col = dir < 0 ? C_L : C_R;
        const wx = cx + dir * (midHalf * 0.6 + wingReach * 0.35);
        const wg = ctx.createRadialGradient(wx, cy, 0, wx, cy, wingReach);
        wg.addColorStop(0, hexAlpha(col, (0.12 + side * 0.45 + flash * 0.2) * (on ? 1 : 0.25)));
        wg.addColorStop(0.55, hexAlpha(col, 0.08 + side * 0.15));
        wg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = wg;
        ctx.beginPath();
        ctx.ellipse(wx, cy, wingReach * 0.95, Hcss * (0.22 + side * 0.18), 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // L / R speaker lobes
      const lobeY = cy;
      const lobeSep = W * (0.12 + n * 0.28);
      for (const dir of [-1, 1] as const) {
        const col = dir < 0 ? C_L : C_R;
        const lx = cx + dir * lobeSep;
        const r = 10 + n * 14 + breath * 2;
        const lg = ctx.createRadialGradient(lx - dir * 3, lobeY - 2, 1, lx, lobeY, r * 1.6);
        lg.addColorStop(0, hexAlpha(C_GLOW, 0.55 + n * 0.3));
        lg.addColorStop(0.4, hexAlpha(col, 0.45 + n * 0.35));
        lg.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(lx, lobeY, r * 1.4, 0, Math.PI * 2);
        ctx.fill();

        // Cone chevrons pointing outward
        ctx.strokeStyle = hexAlpha(col, 0.35 + n * 0.45);
        ctx.lineWidth = 1.4;
        for (let k = 1; k <= 3; k++) {
          const ox = lx + dir * (8 + k * (6 + n * 8));
          const oh = 4 + k * (3 + n * 4);
          ctx.beginPath();
          ctx.moveTo(lx + dir * 6, lobeY);
          ctx.lineTo(ox, lobeY - oh);
          ctx.moveTo(lx + dir * 6, lobeY);
          ctx.lineTo(ox, lobeY + oh);
          ctx.stroke();
        }

        ctx.font = "800 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(col, 0.75 + n * 0.2);
        ctx.textAlign = "center";
        ctx.fillText(dir < 0 ? "L" : "R", lx, lobeY + 3.5);
      }

      // Link arc between L and R (tight when mono, arched when wide)
      ctx.beginPath();
      const arcLift = 8 + n * 28 + breath * 4;
      ctx.moveTo(cx - lobeSep, lobeY);
      ctx.quadraticCurveTo(cx, lobeY - arcLift, cx + lobeSep, lobeY);
      ctx.strokeStyle = hexAlpha(C_SIDE, 0.25 + n * 0.45 + flash * 0.2);
      ctx.lineWidth = 1.5 + n * 2;
      ctx.stroke();

      // Lissajous M/S figure
      const points = 100;
      const phase = t * 0.0022;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const u = (i / points) * Math.PI * 2;
        const m = Math.sin(u + phase) * mid;
        const s = Math.sin(u * 2 + phase + w * Math.PI * 0.4) * side * (0.55 + n * 0.45);
        const x = cx + m * W * 0.22;
        const y = cy + 4 - s * Hcss * 0.28;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = hexAlpha(C, 0.35 + n * 0.4 + flash * 0.25);
      ctx.lineWidth = 1.6 + n * 1.2;
      ctx.shadowBlur = 6 + n * 14 + flash * 10;
      ctx.shadowColor = hexAlpha(C_HOT, 0.55);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexAlpha(C, 0.04 + n * 0.08);
      ctx.fill();

      // Fan beams from center
      const beams = 6;
      const spread = 18 + n * 70;
      for (let i = -beams; i <= beams; i++) {
        const norm = i / beams;
        const a = norm * (0.15 + n * 0.7) * (0.85 + breath * 0.15);
        const alpha = (1 - Math.abs(norm)) * (0.12 + n * 0.4) * (on ? 1 : 0.3);
        if (alpha < 0.02) continue;
        const ex = cx + Math.sin(a) * spread;
        const ey = cy - Math.cos(a) * (Hcss * 0.32);
        ctx.strokeStyle = hexAlpha(i === 0 ? C_GLOW : C_SIDE, alpha);
        ctx.lineWidth = i === 0 ? 2 : 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 5 + n * 3);
        eg.addColorStop(0, hexAlpha(C_GLOW, alpha * 0.9));
        eg.addColorStop(1, hexAlpha(C, 0));
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex, ey, 5 + n * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Emit side particles when wide / dragging
      if (on && (n > 0.08 || dragRef.current || flash > 0.2)) {
        if (Math.random() < 0.35 + n * 0.45 + (dragRef.current ? 0.3 : 0)) {
          const sideDir = Math.random() < 0.5 ? -1 : 1;
          particles.current.push({
            x: cx,
            y: cy + (Math.random() - 0.5) * 16,
            vx: sideDir * (0.6 + n * 2.8 + Math.random()),
            life: 1,
            side: sideDir,
          });
          if (particles.current.length > 48) particles.current.shift();
        }
      }
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i]!;
        p.x += p.vx;
        p.y += Math.sin(t * 0.01 + p.x * 0.05) * 0.4;
        p.life -= 0.022 + (1 - n) * 0.01;
        if (p.life <= 0) {
          particles.current.splice(i, 1);
          continue;
        }
        const col = p.side < 0 ? C_L : C_R;
        const pr = 1.5 + p.life * 2.5;
        const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 2.5);
        pg.addColorStop(0, hexAlpha(C_GLOW, p.life * 0.85));
        pg.addColorStop(0.5, hexAlpha(col, p.life * 0.5));
        pg.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Center mono/wide jewel
      const jr = 3.5 + n * 3 + flash * 2;
      const jg = ctx.createRadialGradient(cx, cy, 0, cx, cy, jr * 2.2);
      jg.addColorStop(0, hexAlpha(C_GLOW, 0.9));
      jg.addColorStop(0.5, hexAlpha(C_HOT, 0.55));
      jg.addColorStop(1, hexAlpha(C, 0));
      ctx.fillStyle = jg;
      ctx.beginPath();
      ctx.arc(cx, cy, jr * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, jr * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Bottom scrub rail with notches
      const railY = Hcss - 14;
      const railPad = 14;
      ctx.strokeStyle = hexAlpha(C, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(W - railPad, railY);
      ctx.stroke();

      // Fill to width
      const thumbX = railPad + (w / W_MAX) * (W - railPad * 2);
      ctx.strokeStyle = hexAlpha(C_HOT, 0.7 + flash * 0.25);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();

      for (const notch of WIDTH_CYCLE) {
        const nx = railPad + (notch / W_MAX) * (W - railPad * 2);
        const active = Math.abs(w - notch) < 0.05;
        ctx.fillStyle = hexAlpha(active ? C_GLOW : C, active ? 0.95 : 0.35);
        ctx.beginPath();
        ctx.arc(nx, railY, active ? 3.2 : 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Thumb
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8 + flash * 10;
      ctx.shadowColor = hexAlpha(C_HOT, 0.7);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 5 + flash * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Correlation stub meter (top-right)
      const corrW = 52;
      const corrH = 5;
      const corrX = W - corrW - 10;
      const corrY = 10;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(corrX, corrY, corrW, corrH);
      ctx.fillStyle = hexAlpha(C_SIDE, 0.75);
      ctx.fillRect(corrX, corrY, corrW * corr, corrH);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C, 0.55);
      ctx.textAlign = "right";
      ctx.fillText("CORR", corrX - 4, corrY + 5);

      // Labels
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.35);
      ctx.textAlign = "left";
      ctx.fillText(on ? "SIDE HORIZON" : "SIDE HORIZON · BYPASS", 10, Hcss - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7 + flash * 0.25);
      ctx.fillText(
        `${widthLabel(w)} · ${Math.round(w * 100)}%`,
        W - 10,
        Hcss - 8,
      );

      // Bypass veil
      if (!on) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, Hcss);
      }
      },
      () => ({
        flash: flashRef.current,
        active: !!st.current.enabled,
        dragging: !!dragRef.current,
        particles: particles.current.length,
        motionKey: "",
      }),
      { minIntervalMs: 22 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] cursor-ew-resize touch-none select-none"
      style={{
        borderColor: `${C}${live || dragRef.current ? "77" : "44"}`,
        height: H,
        boxShadow: live
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 28px ${C}33, 0 6px 20px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="slider"
      aria-label="Stereo width — drag horizontally"
      aria-valuemin={0}
      aria-valuemax={140}
      aria-valuenow={Math.round(width * 100)}
      title="Drag ↔ width · Double-click cycles Mono → Unity → Wide → Hyper"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r" style={{ borderColor: `${C}88` }} />
    </div>
  );
}
