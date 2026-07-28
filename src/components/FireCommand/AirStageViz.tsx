/**
 * Air — Sky Shelf stage visualizer.
 * Low/high shelves × amount (Signal Path Mix · FC.air).
 * Drag left: Low ↕ · right: High ↕ · bottom rail: Amount.
 * Double-click: flatten / cycle characters.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.air;
const C_DEEP = bandShade(FC_BAND.mix, 0.3);
const C_MID = bandShade(FC_BAND.mix, 0.5);
const C_HOT = bandShade(FC_BAND.mix, 0.66);
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
const C_LOW = bandShade(FC_BAND.mix, 0.4);
const C_HIGH = bandShade(FC_BAND.mix, 0.78);
const C_AMT = bandShade(FC_BAND.mix, 0.86);

const CHAR_CYCLE = [
  { low: 0, high: 0, amt: 0 },
  { low: 0.45, high: -0.15, amt: 0.55 },
  { low: -0.1, high: 0.55, amt: 0.6 },
  { low: 0, high: 0.7, amt: 0.65 },
  { low: 0.55, high: 0.35, amt: 0.5 },
  { low: -0.35, high: 0.5, amt: 0.55 },
] as const;

type DragMode = "low" | "high" | "amt" | null;

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

function airLabel(low: number, high: number, amt: number): string {
  if (amt < 0.03) return "FLAT";
  if (Math.abs(low) < 0.08 && Math.abs(high) < 0.08) return "IDLE";
  if (low > 0.2 && high < -0.05) return "WARM";
  if (high > 0.35 && low < 0.1) return "AIR";
  if (low > 0.25 && high > 0.2) return "LIFT";
  if (low < -0.2 && high > 0.2) return "SCOOP";
  if (low > 0.3) return "BASS";
  if (high > 0.25) return "BRIGHT";
  return "SHELF";
}

/** Mirror DSP: low ±12 dB · high ±10 dB, scaled by amount. */
function airMetrics(low: number, high: number, amt: number) {
  const a = clamp(amt, 0, 1);
  return {
    lowDb: clamp(low, -1, 1) * 12 * a,
    highDb: clamp(high, -1, 1) * 10 * a,
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

export function AirStageViz() {
  const low = useFireCommandStore((s) => s.patch.airLow) ?? 0;
  const high = useFireCommandStore((s) => s.patch.airHigh) ?? 0;
  const amt = useFireCommandStore((s) => s.patch.airAmount) ?? 0;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["air"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const motes = useRef<{ x: number; y: number; vx: number; vy: number; life: number; band: number }[]>([]);
  const st = useRef({ low, high, amt, enabled });
  st.current = { low, high, amt, enabled };

  const live = enabled && amt > 0.03 && (Math.abs(low) > 0.04 || Math.abs(high) > 0.04);

  useEffect(() => {
    const key = `${low.toFixed(3)}|${high.toFixed(3)}|${amt.toFixed(3)}|${enabled ? 1 : 0}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [low, high, amt, enabled]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const hitTest = useCallback((clientX: number, clientY: number): DragMode => {
    const wrap = wrapRef.current;
    if (!wrap) return "amt";
    const rect = wrap.getBoundingClientRect();
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    if (y > 0.82) return "amt";
    return x < 0.5 ? "low" : "high";
  }, []);

  const applyAt = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "amt") {
        setParam("airAmount", Math.round(x * 1000) / 1000);
        return;
      }
      // Vertical: top = +1, bottom = -1 (within main plot area)
      const plotY = clamp((y - 0.06) / 0.72, 0, 1);
      const v = Math.round((1 - plotY * 2) * 1000) / 1000; // 1 → -1
      if (mode === "low") setParam("airLow", clamp(v, -1, 1));
      else setParam("airHigh", clamp(v, -1, 1));
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const mode = hitTest(e.clientX, e.clientY);
      dragRef.current = mode;
      flashRef.current = 1;
      applyAt(e.clientX, e.clientY, mode);
    },
    [applyAt, hitTest],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      applyAt(e.clientX, e.clientY, dragRef.current);
    },
    [applyAt],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    const cur = st.current;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < CHAR_CYCLE.length; i++) {
      const c = CHAR_CYCLE[i]!;
      const d = Math.abs(c.low - cur.low) + Math.abs(c.high - cur.high) + Math.abs(c.amt - cur.amt);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = CHAR_CYCLE[(best + 1) % CHAR_CYCLE.length]!;
    setParam("airLow", next.low);
    setParam("airHigh", next.high);
    setParam("airAmount", next.amt);
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
      const { low: lo, high: hi, amt: am, enabled: on } = st.current;
      const lowV = on ? lo : 0;
      const highV = on ? hi : 0;
      const amtV = on ? am : 0;
      const flash = flashRef.current;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.0022);
      const metrics = airMetrics(lowV, highV, amtV);
      const midY = Hcss * 0.42;
      const plotH = Hcss * 0.32;

      ctx.clearRect(0, 0, W, Hcss);

      // Sky chamber
      const bg = ctx.createLinearGradient(0, 0, 0, Hcss);
      bg.addColorStop(0, hexAlpha(C_HIGH, 0.22 + amtV * 0.18 + flash * 0.12));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, hexAlpha(C_LOW, 0.35 + Math.max(0, lowV) * amtV * 0.2));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Horizon glow — brighter when high shelf up
      const skyG = ctx.createRadialGradient(W * 0.72, Hcss * 0.18, 2, W * 0.65, Hcss * 0.25, W * 0.45);
      skyG.addColorStop(0, hexAlpha(C_GLOW, (0.08 + Math.max(0, highV) * amtV * 0.45 + flash * 0.2) * (on ? 1 : 0.25)));
      skyG.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = skyG;
      ctx.fillRect(0, 0, W, Hcss);

      // Ground bloom — warmer when low shelf up
      const groundG = ctx.createRadialGradient(W * 0.28, Hcss * 0.7, 2, W * 0.3, Hcss * 0.65, W * 0.4);
      groundG.addColorStop(0, hexAlpha(C_LOW, (0.06 + Math.max(0, lowV) * amtV * 0.4 + flash * 0.15) * (on ? 1 : 0.25)));
      groundG.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = groundG;
      ctx.fillRect(0, 0, W, Hcss);

      // Zero line
      ctx.strokeStyle = hexAlpha(C, 0.18);
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(8, midY);
      ctx.lineTo(W - 8, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Frequency grid
      for (const u of [0.15, 0.35, 0.55, 0.75]) {
        ctx.strokeStyle = hexAlpha(C, 0.08);
        ctx.beginPath();
        ctx.moveTo(u * W, 12);
        ctx.lineTo(u * W, Hcss * 0.78);
        ctx.stroke();
      }

      // EQ curve
      const points = 110;
      const curveY: number[] = [];
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const u = i / points;
        let shelf = 0;
        if (u < 0.38) shelf += lowV * (1 - u / 0.38);
        if (u > 0.52) shelf += highV * ((u - 0.52) / 0.48);
        const shimmer = Math.sin(u * 14 + t * 0.0024) * 0.035 * amtV * breath;
        const y = midY - shelf * amtV * plotH - shimmer * plotH;
        curveY.push(y);
        if (i === 0) ctx.moveTo(u * W, y);
        else ctx.lineTo(u * W, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.4 + amtV * 0.5 + flash * 0.2);
      ctx.lineWidth = 2.3 + amtV * 1.2;
      ctx.shadowBlur = 8 + amtV * 16 + flash * 10;
      ctx.shadowColor = hexAlpha(C_HOT, 0.55);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill to zero
      ctx.lineTo(W, midY);
      ctx.lineTo(0, midY);
      ctx.closePath();
      const fillG = ctx.createLinearGradient(0, Math.min(...curveY, midY), 0, Math.max(...curveY, midY));
      fillG.addColorStop(0, hexAlpha(C_HIGH, 0.12 + amtV * 0.2));
      fillG.addColorStop(0.5, hexAlpha(C, 0.06 + amtV * 0.1));
      fillG.addColorStop(1, hexAlpha(C_LOW, 0.1 + amtV * 0.15));
      ctx.fillStyle = fillG;
      ctx.fill();

      // Low / High handles
      const lowX = W * 0.18;
      const highX = W * 0.78;
      const lowY = midY - lowV * amtV * plotH;
      const highY = midY - highV * amtV * plotH;

      for (const hnd of [
        { x: lowX, y: lowY, col: C_LOW, active: Math.abs(lowV) > 0.05 && amtV > 0.02, label: "L" },
        { x: highX, y: highY, col: C_HIGH, active: Math.abs(highV) > 0.05 && amtV > 0.02, label: "H" },
      ]) {
        ctx.strokeStyle = hexAlpha(hnd.col, hnd.active ? 0.45 : 0.18);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(hnd.x, Hcss * 0.78);
        ctx.lineTo(hnd.x, hnd.y);
        ctx.stroke();

        const r = 5 + (hnd.active ? 2 : 0) + flash * 2;
        const hg = ctx.createRadialGradient(hnd.x, hnd.y, 0, hnd.x, hnd.y, r * 2);
        hg.addColorStop(0, hexAlpha(C_GLOW, 0.85));
        hg.addColorStop(0.45, hexAlpha(hnd.col, 0.7));
        hg.addColorStop(1, hexAlpha(hnd.col, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(hnd.x, hnd.y, r * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
        ctx.beginPath();
        ctx.arc(hnd.x, hnd.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(hnd.col, 0.8);
        ctx.textAlign = "center";
        ctx.fillText(hnd.label, hnd.x, hnd.y - 10);
      }

      // Floating motes (air particles) — drift with shelves
      if (on && amtV > 0.05) {
        if (Math.random() < 0.2 + amtV * 0.35) {
          const band = Math.random() < 0.45 ? -1 : 1; // low vs high side
          motes.current.push({
            x: band < 0 ? W * (0.05 + Math.random() * 0.35) : W * (0.55 + Math.random() * 0.4),
            y: Hcss * (0.15 + Math.random() * 0.5),
            vx: (Math.random() - 0.5) * 0.4,
            vy: -0.15 - Math.random() * 0.35 - Math.max(0, band < 0 ? lowV : highV) * amtV * 0.4,
            life: 1,
            band,
          });
          if (motes.current.length > 40) motes.current.shift();
        }
      }
      for (let i = motes.current.length - 1; i >= 0; i--) {
        const m = motes.current[i]!;
        m.x += m.vx;
        m.y += m.vy;
        m.life -= 0.012 + (1 - amtV) * 0.01;
        if (m.life <= 0 || m.y < 0) {
          motes.current.splice(i, 1);
          continue;
        }
        const col = m.band < 0 ? C_LOW : C_HIGH;
        const pg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 3 + m.life * 3);
        pg.addColorStop(0, hexAlpha(C_GLOW, m.life * 0.7 * amtV));
        pg.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 3 + m.life * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Freq labels
      ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = hexAlpha(C_LOW, 0.55 + Math.abs(lowV) * amtV * 0.35);
      ctx.fillText("180 Hz", W * 0.18, Hcss * 0.78 + 2);
      ctx.fillStyle = hexAlpha(C, 0.35);
      ctx.fillText("1 kHz", W * 0.5, Hcss * 0.78 + 2);
      ctx.fillStyle = hexAlpha(C_HIGH, 0.55 + Math.abs(highV) * amtV * 0.35);
      ctx.fillText("6.5 kHz", W * 0.78, Hcss * 0.78 + 2);

      // dB readouts
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_LOW, 0.7);
      ctx.fillText(`L ${metrics.lowDb >= 0 ? "+" : ""}${metrics.lowDb.toFixed(1)} dB`, 10, 14);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C_HIGH, 0.7);
      ctx.fillText(`H ${metrics.highDb >= 0 ? "+" : ""}${metrics.highDb.toFixed(1)} dB`, W - 10, 14);

      // Amount rail
      const railY = Hcss - 12;
      const railPad = 14;
      ctx.strokeStyle = hexAlpha(C_AMT, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(W - railPad, railY);
      ctx.stroke();
      const thumbX = railPad + amtV * (W - railPad * 2);
      ctx.strokeStyle = hexAlpha(C_AMT, 0.75 + flash * 0.2);
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();
      for (const notch of [0, 0.25, 0.5, 0.75, 1]) {
        const nx = railPad + notch * (W - railPad * 2);
        const active = Math.abs(amtV - notch) < 0.04;
        ctx.fillStyle = hexAlpha(active ? C_GLOW : C_AMT, active ? 0.95 : 0.35);
        ctx.beginPath();
        ctx.arc(nx, railY, active ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8 + flash * 10;
      ctx.shadowColor = hexAlpha(C_HOT, 0.65);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 5 + flash * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Identity
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.35);
      ctx.textAlign = "left";
      ctx.fillText(on ? "SKY SHELF" : "SKY SHELF · BYPASS", 10, Hcss - 8);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7 + flash * 0.25);
      ctx.fillText(`${airLabel(lowV, highV, amtV)} · A${Math.round(amtV * 100)}`, W - 10, Hcss - 8);

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
      className="relative mb-2.5 overflow-hidden rounded-2xl border-2 bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] cursor-crosshair touch-none select-none"
      style={{
        borderColor: `${C}${live ? "77" : "44"}`,
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
      role="img"
      aria-label="Air sky shelf — left Low, right High, bottom Amount"
      title="Left ↕ Low · Right ↕ High · Bottom rail Amount · Double-click cycles characters"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t rounded-tl" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t rounded-tr" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l rounded-bl" style={{ borderColor: `${C}88` }} />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r rounded-br" style={{ borderColor: `${C}88` }} />
    </div>
  );
}
