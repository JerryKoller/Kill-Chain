/**
 * Age — Oxide Archive stage visualizer.
 * Tape · VHS · bit · BBD · beds (Signal Path FX · FC.vintage).
 * Drag: Cass ↔ / Wow ↕. Bottom: Speed. Double-click: cycle bit depth.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FireBitDepth } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 188;
const C = FC.vintage;
const C_DEEP = bandShade(FC.fx, 0.22);
const C_MID = bandShade(FC.fx, 0.42);
const C_HOT = bandShade(FC.fx, 0.58);
const C_GLOW = bandShade(FC.fx, 0.88);
const C_CASS = bandShade(FC.fx, 0.38);
const C_WOW = bandShade(FC.fx, 0.5);
const C_VHS = bandShade(FC.fx, 0.62);
const C_BIT = bandShade(FC.fx, 0.72);
const C_BED = bandShade(FC.fx, 0.82);
const C_BBD = bandShade(FC.fx, 0.68);
const C_SPEED = bandShade(FC.fx, 0.45);

const BIT_CYCLE: FireBitDepth[] = ["off", "12bit", "8bit"];

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

type DragMode = "xy" | "speed" | null;

type AgeState = {
  cass: number;
  speed: number;
  wow: number;
  vhs: number;
  bit: FireBitDepth;
  srr: number;
  bbd: number;
  comp: number;
  dust: number;
  hiss: number;
  hum: number;
  print: number;
};

export function AgeStageViz() {
  const cass = useFireCommandStore((s) => s.patch.cassetteGen) ?? 0;
  const speed = useFireCommandStore((s) => s.patch.tapeSpeed) ?? 0;
  const wow = useFireCommandStore((s) => s.patch.wowFlutter) ?? 0;
  const vhs = useFireCommandStore((s) => s.patch.vhsColor) ?? 0;
  const bit = (useFireCommandStore((s) => s.patch.bitDepth) ?? "off") as FireBitDepth;
  const srr = useFireCommandStore((s) => s.patch.sampleRateReduce) ?? 0;
  const bbd = useFireCommandStore((s) => s.patch.bbdChorus) ?? 0;
  const comp = useFireCommandStore((s) => s.patch.analogComp) ?? 0;
  const dust = useFireCommandStore((s) => s.patch.dust) ?? 0;
  const hiss = useFireCommandStore((s) => s.patch.hiss) ?? 0;
  const hum = useFireCommandStore((s) => s.patch.hum) ?? 0;
  const print = useFireCommandStore((s) => s.patch.printThrough) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef<AgeState>({ cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print });
  st.current = { cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print };

  const heat = Math.max(cass, wow, vhs, dust, hiss, hum, print, srr, bbd, comp, Math.abs(speed), bit !== "off" ? 0.35 : 0);
  const live = heat > 0.03;

  useEffect(() => {
    const key = [
      cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print,
    ].map((v) => (typeof v === "number" ? v.toFixed(3) : v)).join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("cassetteGen", Math.round(x * 1000) / 1000);
      setParam("wowFlutter", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applySpeed = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("tapeSpeed", Math.round((x * 2 - 1) * 1000) / 1000);
    },
    [setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > H * 0.78) {
        dragRef.current = "speed";
        wrap.setPointerCapture(e.pointerId);
        applySpeed(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applySpeed],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "speed") applySpeed(e.clientX);
    },
    [applyXy, applySpeed],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const i = BIT_CYCLE.indexOf(st.current.bit);
    setParam("bitDepth", BIT_CYCLE[(i + 1) % BIT_CYCLE.length]!);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const dustParts: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }> = [];
    const grain: Array<{ x: number; y: number; life: number; size: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const beds = Math.max(p.dust, p.hiss, p.hum, p.print);
      const heatN = Math.max(
        p.cass, p.wow, p.vhs, beds, p.srr, p.bbd, p.comp, Math.abs(p.speed),
        p.bit !== "off" ? 0.35 : 0,
      );
      const isLive = heatN > 0.03;
      const speedN = (p.speed + 1) * 0.5;
      const spinRate = (0.35 + p.cass * 2.2 + Math.abs(p.speed) * 1.8) * (p.speed < 0 ? -1 : 1);
      const wobble = Math.sin(now * 0.002 * (0.4 + p.wow * 5)) * (1.5 + p.wow * 7);

      ctx.clearRect(0, 0, W, Hh);

      // Violet oxide chamber
      const bg = ctx.createRadialGradient(W * (0.35 + p.cass * 0.15), Hh * 0.42, 6, W * 0.5, Hh * 0.48, W * 0.75);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + heatN * 0.35 + flashRef.current * 0.2));
      bg.addColorStop(0.5, hexAlpha(C_DEEP, 0.62));
      bg.addColorStop(1, "rgba(6,2,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // VHS scanlines + chromatic drift
      if (p.vhs > 0.02) {
        const scanA = 0.04 + p.vhs * 0.28;
        for (let y = 0; y < Hh; y += 3) {
          const shift = Math.sin(y * 0.18 + now * 0.003) * p.vhs * 3.5;
          ctx.fillStyle = hexAlpha(C_VHS, scanA * (0.35 + ((y + now * 0.04) % 7) / 12));
          ctx.fillRect(shift, y, W, 1);
          if (p.vhs > 0.35 && y % 9 === 0) {
            ctx.fillStyle = hexAlpha(C_GLOW, scanA * 0.35);
            ctx.fillRect(shift + 1.5, y, W - 3, 1);
          }
        }
        if (p.vhs > 0.45 && Math.random() < 0.06 + p.vhs * 0.08) {
          const ey = Math.random() * Hh;
          ctx.fillStyle = hexAlpha(C_HOT, 0.12 + p.vhs * 0.22);
          ctx.fillRect(0, ey, W, 2 + Math.random() * 5);
        }
      }

      // Film perforations when aged
      if (heatN > 0.28) {
        ctx.fillStyle = hexAlpha("#000000", 0.35 + heatN * 0.3);
        for (let py = 4; py < Hh - 20; py += 14) {
          ctx.fillRect(3, py, 3.5, 5);
          ctx.fillRect(W - 6.5, py, 3.5, 5);
        }
      }

      // ── Dual oxide reels ──
      const reelY = Hh * 0.38 + wobble * 0.12;
      const drawReel = (cx: number, spin: number, fill: number) => {
        const R = 17 + p.cass * 3;
        const rg = ctx.createRadialGradient(cx, reelY, 1, cx, reelY, R);
        rg.addColorStop(0, hexAlpha(C_GLOW, 0.12 + fill * 0.25));
        rg.addColorStop(0.65, hexAlpha(C_CASS, 0.35 + fill * 0.4));
        rg.addColorStop(1, hexAlpha(C_DEEP, 0.5));
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(cx, reelY, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.4 + fill * 0.45 + flashRef.current * 0.2);
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = 6 + fill * 10;
        ctx.shadowColor = C;
        ctx.beginPath();
        ctx.arc(cx, reelY, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Oxide fill wedge (cassette generation)
        ctx.fillStyle = hexAlpha(C_HOT, 0.15 + fill * 0.35);
        ctx.beginPath();
        ctx.moveTo(cx, reelY);
        ctx.arc(cx, reelY, R - 3, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = hexAlpha(C_MID, 0.55 + fill * 0.3);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = spin + (i / 6) * Math.PI * 2;
          ctx.moveTo(cx, reelY);
          ctx.lineTo(cx + Math.cos(a) * (R - 3), reelY + Math.sin(a) * (R - 3));
        }
        ctx.stroke();
        ctx.fillStyle = hexAlpha(C_DEEP, 0.85);
        ctx.beginPath();
        ctx.arc(cx, reelY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      };

      const spin = (now / 1000) * spinRate * Math.PI * 2;
      const leftFill = clamp(0.15 + p.cass * 0.7 - p.speed * 0.15, 0.08, 0.95);
      const rightFill = clamp(0.15 + p.cass * 0.7 + p.speed * 0.15, 0.08, 0.95);
      drawReel(W * 0.22, spin, leftFill);
      drawReel(W * 0.78, -spin * (1.02 + Math.abs(p.speed) * 0.15), rightFill);

      // Tape bridge with wow warp
      const xL = W * 0.22 + 18;
      const xR = W * 0.78 - 18;
      ctx.beginPath();
      ctx.moveTo(xL, reelY);
      for (let x = xL; x <= xR; x += 3) {
        const u = (x - xL) / Math.max(1, xR - xL);
        const y =
          reelY +
          Math.sin(x * 0.07 + now * 0.004 + p.wow * 10) * (1 + p.wow * 6) +
          Math.sin(u * Math.PI * 2 + now * 0.001) * p.cass * 2;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + p.cass * 0.5);
      ctx.lineWidth = 2 + p.cass * 1.5;
      ctx.shadowBlur = 5 + p.cass * 10;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Print-through ghost tape (offset echo)
      if (p.print > 0.05) {
        ctx.beginPath();
        ctx.moveTo(xL, reelY + 8);
        for (let x = xL; x <= xR; x += 4) {
          const y =
            reelY + 8 +
            Math.sin(x * 0.07 + now * 0.004 - 1.2 + p.wow * 10) * (1 + p.wow * 4);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hexAlpha(C_BED, 0.15 + p.print * 0.45);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── Living aged waveform (center-bottom of main stage) ──
      const wx0 = W * 0.28;
      const wUsable = W * 0.44;
      const mid = Hh * 0.62;
      const ampBase = Hh * 0.12 * (1 - p.comp * 0.45) * (0.7 + p.cass * 0.35);
      const phase = now / (320 - p.speed * 120);

      // BBD ghost trails
      if (p.bbd > 0.05) {
        for (let g = 1; g <= 2; g++) {
          const delay = g * (0.15 + p.bbd * 0.35);
          ctx.beginPath();
          for (let i = 0; i <= 80; i++) {
            const u = i / 80;
            let x = Math.sin(u * Math.PI * 5 + phase - delay);
            x += Math.sin(u * Math.PI * 2 + now * 0.001) * p.hum * 0.25;
            if (p.srr > 0.05) {
              const steps = Math.max(4, Math.round(40 - p.srr * 34));
              x = Math.round(x * steps) / steps;
            }
            if (p.bit === "8bit") x = Math.round(x * 8) / 8;
            else if (p.bit === "12bit") x = Math.round(x * 16) / 16;
            const px = wx0 + u * wUsable;
            const py = mid - x * ampBase * (0.55 - g * 0.12);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = hexAlpha(C_BBD, 0.18 + p.bbd * 0.35);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }

      // Primary aged wave
      ctx.beginPath();
      for (let i = 0; i <= 110; i++) {
        const u = i / 110;
        let x = Math.sin(u * Math.PI * 5 + phase);
        // Wow pitch wobble
        x = Math.sin(u * Math.PI * 5 + phase + Math.sin(now * 0.008) * p.wow * 1.8);
        // Hum ripple
        x += Math.sin(u * Math.PI * 2 + now * 0.0015) * p.hum * 0.28;
        // SR reduce stairs
        if (p.srr > 0.04) {
          const steps = Math.max(3, Math.round(48 - p.srr * 42));
          x = Math.round(x * steps) / steps;
        }
        // Bit depth
        if (p.bit === "8bit") x = Math.round(x * 7) / 7;
        else if (p.bit === "12bit") x = Math.round(x * 14) / 14;
        // Comp squeeze
        x *= 1 - p.comp * 0.4;
        const px = wx0 + u * wUsable;
        const py = mid - x * ampBase;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.88 + flashRef.current * 0.12);
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 8 + heatN * 12 + flashRef.current * 8;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Bit/SR stair guides
      if (p.bit !== "off" || p.srr > 0.08) {
        const steps = p.bit === "8bit" ? 7 : p.bit === "12bit" ? 12 : Math.max(5, Math.floor(18 - p.srr * 12));
        ctx.strokeStyle = hexAlpha(C_BIT, 0.12 + (p.srr + (p.bit !== "off" ? 0.3 : 0)) * 0.25);
        ctx.lineWidth = 1;
        for (let s = 0; s <= steps; s++) {
          const level = (s / steps) * 2 - 1;
          const y = mid - level * ampBase;
          ctx.beginPath();
          ctx.moveTo(wx0, y);
          ctx.lineTo(wx0 + wUsable, y);
          ctx.stroke();
        }
      }

      // Comp squeeze brackets
      if (p.comp > 0.08) {
        const top = mid - ampBase * (1 - p.comp * 0.35);
        const bot = mid + ampBase * (1 - p.comp * 0.35);
        ctx.strokeStyle = hexAlpha(C_HOT, 0.25 + p.comp * 0.4);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(wx0, top);
        ctx.lineTo(wx0 + wUsable, top);
        ctx.moveTo(wx0, bot);
        ctx.lineTo(wx0 + wUsable, bot);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Dust particles
      if (p.dust > 0.02 && Math.random() < 0.15 + p.dust * 0.35) {
        dustParts.push({
          x: Math.random() * W,
          y: Math.random() * (Hh - 22),
          vx: (Math.random() - 0.5) * (0.4 + p.dust),
          vy: (Math.random() - 0.5) * 0.3,
          life: 1,
          size: 1 + Math.random() * 2.5,
        });
      }
      for (let i = dustParts.length - 1; i >= 0; i--) {
        const d = dustParts[i]!;
        d.life -= 0.018;
        d.x += d.vx;
        d.y += d.vy;
        if (d.life <= 0) {
          dustParts.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(C_BED, d.life * (0.25 + p.dust * 0.55));
        ctx.fillRect(d.x, d.y, d.size, d.size);
      }

      // Hiss grain field
      if (p.hiss > 0.04) {
        const n = Math.floor(p.hiss * 55);
        for (let i = 0; i < n; i++) {
          const x = (Math.sin(i * 19.7 + now * 0.002) * 0.5 + 0.5) * W;
          const y = (Math.cos(i * 11.3 + now * 0.0025) * 0.5 + 0.5) * (Hh - 20);
          ctx.fillStyle = hexAlpha(C_GLOW, 0.08 + p.hiss * 0.35 * (0.4 + Math.sin(now * 0.01 + i) * 0.5));
          ctx.fillRect(x, y, 1.2, 1.2);
        }
      }

      // Hum standing wave bars
      if (p.hum > 0.05) {
        ctx.strokeStyle = hexAlpha(C_MID, 0.12 + p.hum * 0.35);
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const y = Hh * 0.15 + i * Hh * 0.12 + Math.sin(now * 0.003 + i) * p.hum * 4;
          ctx.beginPath();
          ctx.moveTo(8, y);
          ctx.lineTo(W - 8, y);
          ctx.stroke();
        }
      }

      // Dynamic flash grain
      if (isLive && Math.random() < 0.12 + heatN * 0.2) {
        grain.push({
          x: Math.random() * W,
          y: Math.random() * (Hh - 20),
          life: 0.5 + Math.random() * 0.5,
          size: 1 + Math.random() * 2,
        });
      }
      for (let i = grain.length - 1; i >= 0; i--) {
        const g = grain[i]!;
        g.life -= 0.04;
        if (g.life <= 0) {
          grain.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(C_GLOW, g.life * heatN * 0.4);
        ctx.fillRect(g.x, g.y, g.size, g.size);
      }

      // Cass / Wow crosshair
      const hx = p.cass * W;
      const hy = (1 - p.wow) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Mode / bit chip
      const chip =
        !isLive ? "CLEAN" :
        p.bit !== "off" ? p.bit.toUpperCase() :
        p.vhs > 0.4 ? "VHS" :
        p.bbd > 0.4 ? "BBD" :
        p.cass > 0.2 ? "TAPE" : "AGED";
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

      // Speed rail (bipolar)
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_SPEED, 0.3 + Math.abs(p.speed) * 0.4);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      // Center mark
      ctx.fillStyle = hexAlpha(C_MID, 0.45);
      ctx.fillRect(W * 0.5 - 0.5, railY, 1, 7);
      const thumbX = 12 + (W - 24) * speedN;
      if (p.speed !== 0) {
        const from = Math.min(W * 0.5, thumbX);
        const to = Math.max(W * 0.5, thumbX);
        ctx.fillStyle = hexAlpha(C_SPEED, 0.45 + Math.abs(p.speed) * 0.35);
        ctx.fillRect(from, railY + 1, Math.max(2, to - from), 5);
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(thumbX, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_SPEED, 0.85);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      const spdLabel = p.speed === 0 ? "0" : `${p.speed > 0 ? "+" : ""}${Math.round(p.speed * 100)}`;
      ctx.fillText(`SPEED ${spdLabel}`, 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("AGE · OXIDE ARCHIVE", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !isLive
        ? "CLEAN"
        : `C${Math.round(p.cass * 100)} · W${Math.round(p.wow * 100)} · ${p.bit === "off" ? "FULL" : p.bit}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: dustParts.length,
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
        borderColor: hexAlpha(C, live ? 0.55 : 0.3),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.28 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Cass ↔ / Wow ↕ · Bottom: Speed · Double-click: cycle bit depth"
      role="img"
      aria-label="Age oxide archive"
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
        Oxide Archive
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? (bit !== "off" ? bit : "AGED") : "CLEAN"}
      </div>
    </div>
  );
}

/** Alias for FxStageViz re-export compatibility. */
export const VintageAgeStageViz = AgeStageViz;
