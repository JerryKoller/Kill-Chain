/**
 * Spectral — Bin Lattice stage visualizer.
 * Mode · Amount · Mix (Signal Path FX · FC.spectral).
 * Drag: Amount ↔ / Mix ↕. Bottom: Mix rail. Double-click: cycle mode.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { SpectralMode } from "@/audio/dsp/FireCommandSynth";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 176;
const C = FC.spectral;
const C_DEEP = bandShade(FC.fx, 0.48);
const C_MID = bandShade(FC.fx, 0.62);
const C_HOT = bandShade(FC.fx, 0.78);
const C_GLOW = bandShade(FC.fx, 0.96);
const C_AMT = bandShade(FC.fx, 0.7);
const C_MIX = bandShade(FC.fx, 0.88);

const MODE_CYCLE: SpectralMode[] = ["off", "freeze", "smear", "gate", "shift"];
const N = 52;

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

type DragMode = "xy" | "mix" | null;

export function SpectralStageViz() {
  const mode = (useFireCommandStore((s) => s.patch.spectralMode) ?? "off") as SpectralMode;
  const amount = useFireCommandStore((s) => s.patch.spectralAmount) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const binLow = useFireCommandStore((s) => s.patch.spectralLow) ?? 0;
  const binHigh = useFireCommandStore((s) => s.patch.spectralHigh) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const prevKey = useRef("");
  const st = useRef({ mode, amount, mix, binLow, binHigh });
  st.current = { mode, amount, mix, binLow, binHigh };

  const live = mode !== "off";

  useEffect(() => {
    const key = `${mode}|${amount.toFixed(3)}|${mix.toFixed(3)}|${binLow.toFixed(3)}|${binHigh.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mode, amount, mix, binLow, binHigh]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const applyXy = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("spectralAmount", Math.round(x * 1000) / 1000);
      setParam("spectralMix", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyMix = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("spectralMix", Math.round(x * 1000) / 1000);
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
        dragRef.current = "mix";
        wrap.setPointerCapture(e.pointerId);
        applyMix(e.clientX);
        return;
      }
      dragRef.current = "xy";
      wrap.setPointerCapture(e.pointerId);
      applyXy(e.clientX, e.clientY);
    },
    [applyXy, applyMix],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current === "xy") applyXy(e.clientX, e.clientY);
      else if (dragRef.current === "mix") applyMix(e.clientX);
    },
    [applyXy, applyMix],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const i = MODE_CYCLE.indexOf(st.current.mode);
    setParam("spectralMode", MODE_CYCLE[(i + 1) % MODE_CYCLE.length]!);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const cur = new Float32Array(N).fill(0.15);
    const frozen = new Float32Array(N).fill(0);
    const trails = Array.from({ length: N }, () => new Float32Array(6).fill(0));
    const sparkles: Array<{ x: number; y: number; life: number; bin: number }> = [];
    let lastMode: SpectralMode = "off";
    let freqBuf: Uint8Array<ArrayBuffer> | null = null;

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      if (p.mode !== lastMode) {
        lastMode = p.mode;
        frozen.fill(0);
        cur.fill(0.15);
        for (const t of trails) t.fill(0);
      }

      const isLive = p.mode !== "off";
      const energy = 0.08 + (isLive ? p.mix * 0.4 + p.amount * 0.15 : 0) + flashRef.current * 0.25;
      const PAD = 10;
      const stageH = Hh * 0.72;
      const usableH = stageH - PAD * 2;
      const bw = (W - PAD * 2) / N;
      const sec = now / 1000;
      const lo = clamp(Math.min(p.binLow ?? 0, p.binHigh ?? 1), 0, 1);
      const hi = clamp(Math.max(p.binLow ?? 0, p.binHigh ?? 1), 0, 1);

      // Pull live frequency bins when analyserPost is available
      let liveBins: Float32Array | null = null;
      try {
        const e = getEngine();
        const analyser = e.analyserPost;
        if (analyser && e.ctx.state === "running") {
          if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
            freqBuf = new Uint8Array(analyser.frequencyBinCount);
          }
          analyser.getByteFrequencyData(freqBuf);
          liveBins = new Float32Array(N);
          const srcN = freqBuf.length;
          for (let i = 0; i < N; i++) {
            const a = Math.floor((i / N) * srcN * 0.7);
            const b = Math.floor(((i + 1) / N) * srcN * 0.7);
            let sum = 0;
            let c = 0;
            for (let j = a; j < Math.max(a + 1, b); j++) {
              sum += freqBuf[j] ?? 0;
              c++;
            }
            liveBins[i] = (sum / Math.max(1, c)) / 255;
          }
        }
      } catch { /* engine not ready */ }

      ctx.clearRect(0, 0, W, Hh);

      // Lightest FX violet lattice chamber
      const bg = ctx.createRadialGradient(W * 0.5, Hh * 0.4, 4, W * 0.5, Hh * 0.45, W * 0.8);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.08 + energy * 0.4 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(6,2,16,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Lattice grid
      ctx.strokeStyle = hexAlpha(C_MID, 0.06 + (isLive ? p.mix * 0.08 : 0));
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = PAD + (usableH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(W - PAD, y);
        ctx.stroke();
      }
      for (let v = 1; v < 8; v++) {
        const x = PAD + ((W - PAD * 2) / 8) * v;
        ctx.beginPath();
        ctx.moveTo(x, PAD);
        ctx.lineTo(x, stageH - PAD);
        ctx.stroke();
      }

      // spectralLow / spectralHigh region overlay
      {
        const x0 = PAD + lo * (W - PAD * 2);
        const x1 = PAD + hi * (W - PAD * 2);
        ctx.fillStyle = hexAlpha(C_MID, 0.08);
        ctx.fillRect(PAD, PAD, x0 - PAD, usableH);
        ctx.fillRect(x1, PAD, W - PAD - x1, usableH);
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.35 + flashRef.current * 0.2);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x0, PAD);
        ctx.lineTo(x0, PAD + usableH);
        ctx.moveTo(x1, PAD);
        ctx.lineTo(x1, PAD + usableH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.65);
        ctx.textAlign = "left";
        ctx.fillText(`LO ${Math.round(lo * 100)}`, x0 + 2, PAD + 10);
        ctx.textAlign = "right";
        ctx.fillText(`HI ${Math.round(hi * 100)}`, x1 - 2, PAD + 10);
      }

      if (!isLive) {
        ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flashRef.current * 0.3);
        ctx.textAlign = "center";
        ctx.shadowBlur = 12;
        ctx.shadowColor = C;
        ctx.fillText("ARM A MODE · DOUBLE-CLICK", W * 0.5, stageH * 0.48);
        ctx.shadowBlur = 0;
        ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_MID, 0.55);
        ctx.fillText("Freeze · Smear · Gate · Shift", W * 0.5, stageH * 0.48 + 16);
      } else {
        // Mode wash accents
        if (p.mode === "smear" && p.amount > 0.2) {
          const smear = ctx.createLinearGradient(0, PAD, W, PAD);
          smear.addColorStop(0, hexAlpha(C_HOT, 0.06 * p.amount));
          smear.addColorStop(0.5, hexAlpha(C_GLOW, 0.14 * p.amount * p.mix));
          smear.addColorStop(1, hexAlpha(C_HOT, 0.06 * p.amount));
          ctx.fillStyle = smear;
          ctx.fillRect(PAD, PAD, W - PAD * 2, 4 + p.amount * 6);
        }
        if (p.mode === "freeze" && p.amount > 0.25) {
          ctx.fillStyle = hexAlpha(C_GLOW, 0.04 * p.amount);
          ctx.fillRect(PAD, PAD, W - PAD * 2, usableH);
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.1 * p.amount);
          ctx.lineWidth = 1;
          for (let i = 0; i < N; i += 4) {
            const x = PAD + i * bw;
            ctx.beginPath();
            ctx.moveTo(x, PAD);
            ctx.lineTo(x + bw * 3, PAD + 2);
            ctx.stroke();
          }
        }

        for (let i = 0; i < N; i++) {
          const u = i / N;
          const inBand = u >= lo && u <= hi;
          const synth =
            (0.72 / (1 + i * 0.11)) * (0.55 + 0.45 * Math.sin(sec * (1.15 + i * 0.28) + i * 1.6));
          const live = liveBins ? clamp(liveBins[i]! * 1.35, 0.03, 1) : Math.max(0.03, synth);
          let v = live;
          let x = PAD + i * bw;
          let dim = !inBand;

          if (p.mode === "freeze") {
            if (frozen[i]! < 0.01) frozen[i] = live;
            // Hold frozen snapshot; amount blends hold vs live
            cur[i] = frozen[i]! * p.amount + live * (1 - p.amount);
            v = cur[i]!;
          } else if (p.mode === "smear") {
            frozen[i] = 0;
            cur[i]! += (live - cur[i]!) * (1 - p.amount * 0.94);
            v = cur[i]!;
            // Trail history for smear streaks
            const hist = trails[i]!;
            for (let t = hist.length - 1; t > 0; t--) hist[t] = hist[t - 1]!;
            hist[0] = v;
          } else if (p.mode === "gate") {
            frozen[i] = 0;
            const thr = p.amount * 0.5;
            dim = dim || live < thr;
            v = live;
            cur[i] = live;
          } else if (p.mode === "shift") {
            frozen[i] = 0;
            cur[i] = live;
            v = live;
            x += (p.amount * 2 - 1) * bw * 10;
            if (x < PAD - bw || x > W - PAD) continue;
          }

          // Smear trails behind bars
          if (p.mode === "smear" && inBand) {
            const hist = trails[i]!;
            for (let t = hist.length - 1; t >= 1; t--) {
              const tv = hist[t]!;
              const th = tv * usableH * (0.55 + p.mix * 0.45) * (1 - t * 0.12);
              const ty = PAD + usableH - th;
              ctx.fillStyle = hexAlpha(C_HOT, (0.06 + p.amount * 0.1) * (1 - t / hist.length) * p.mix);
              ctx.fillRect(x + 0.4, ty, Math.max(1.2, bw - 1.4), th);
            }
          }

          const barH = v * usableH * (0.55 + p.mix * 0.45) * (inBand ? 1 : 0.25);
          const y0 = PAD + usableH - barH;
          const tShade = 0.55 + (i / N) * 0.4;

          if (!dim && inBand) {
            const glow = ctx.createRadialGradient(x + bw / 2, y0, 0, x + bw / 2, y0, bw * 3);
            glow.addColorStop(0, hexAlpha(C_GLOW, (0.12 + v * 0.18) * p.mix));
            glow.addColorStop(1, hexAlpha(C_HOT, 0));
            ctx.fillStyle = glow;
            ctx.fillRect(x - bw, y0 - 4, bw * 3, barH + 8);
          }

          const g = ctx.createLinearGradient(0, y0, 0, PAD + usableH);
          g.addColorStop(0, hexAlpha(bandShade(FC.fx, tShade), dim ? 0.1 : 0.55 + v * 0.4));
          g.addColorStop(1, hexAlpha(C_DEEP, dim ? 0.04 : 0.25));
          ctx.fillStyle = g;
          ctx.fillRect(x + 0.4, y0, Math.max(1.4, bw - 1.2), barH);

          // Freeze hold cap
          if (p.mode === "freeze" && inBand && frozen[i]! > 0.05) {
            const fh = frozen[i]! * usableH * (0.55 + p.mix * 0.45);
            const fy = PAD + usableH - fh;
            ctx.strokeStyle = hexAlpha(C_GLOW, 0.45 * p.amount);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 0.4, fy);
            ctx.lineTo(x + bw - 0.4, fy);
            ctx.stroke();
          }

          if (!dim && v > 0.12 && inBand) {
            ctx.fillStyle = hexAlpha(C_GLOW, 0.7 + v * 0.3);
            ctx.shadowBlur = 6 + v * 8;
            ctx.shadowColor = C;
            ctx.fillRect(x + 0.4, y0, Math.max(1.4, bw - 1.2), 2);
            ctx.shadowBlur = 0;
          }

          if (!dim && inBand && v > 0.5 && p.mix > 0.1 && Math.random() < 0.07 * v * p.mix) {
            sparkles.push({ x: x + bw / 2, y: y0, life: 1, bin: i });
          }
        }

        // Gate threshold
        if (p.mode === "gate") {
          const thr = p.amount * 0.5;
          const ty = PAD + (1 - thr) * usableH;
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.45 + p.amount * 0.35);
          ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(PAD, ty);
          ctx.lineTo(W - PAD, ty);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(C_GLOW, 0.75);
          ctx.textAlign = "right";
          ctx.fillText(`THR ${Math.round(thr * 100)}`, W - PAD - 2, ty - 3);
        }

        // Shift arrow cue
        if (p.mode === "shift") {
          const dir = p.amount >= 0.5 ? 1 : -1;
          const mag = Math.abs(p.amount * 2 - 1);
          ctx.strokeStyle = hexAlpha(C_HOT, 0.35 + mag * 0.45);
          ctx.lineWidth = 1.5;
          const ay = PAD + 10;
          const ax0 = W * 0.5;
          const ax1 = ax0 + dir * (20 + mag * 40);
          ctx.beginPath();
          ctx.moveTo(ax0, ay);
          ctx.lineTo(ax1, ay);
          ctx.lineTo(ax1 - dir * 6, ay - 4);
          ctx.moveTo(ax1, ay);
          ctx.lineTo(ax1 - dir * 6, ay + 4);
          ctx.stroke();
        }

        for (let i = sparkles.length - 1; i >= 0; i--) {
          const sp = sparkles[i]!;
          sp.life -= 0.025;
          sp.y -= 0.55;
          if (sp.life <= 0) {
            sparkles.splice(i, 1);
            continue;
          }
          ctx.fillStyle = hexAlpha(C_GLOW, sp.life * 0.7 * p.mix);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 1.5 + sp.life, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Amount / Mix crosshair
      const hx = p.amount * W;
      const hy = (1 - p.mix) * (Hh * 0.68);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.3 + flashRef.current * 0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy);
      ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8);
      ctx.lineTo(hx, hy + 8);
      ctx.stroke();

      // Mode chip
      const chip = p.mode === "off" ? "OFF" : p.mode.toUpperCase();
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

      // Mix rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_MIX, 0.25 + p.mix * 0.4);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      const fill = ctx.createLinearGradient(12, railY, 12 + (W - 24) * p.mix, railY);
      fill.addColorStop(0, hexAlpha(C_MIX, 0.3));
      fill.addColorStop(1, hexAlpha(C_GLOW, 0.85));
      ctx.fillStyle = fill;
      ctx.fillRect(12, railY + 1, Math.max(2, (W - 24) * p.mix), 5);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * p.mix, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_MIX, 0.85);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`MIX ${Math.round(p.mix * 100)}%`, 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("SPEC · BIN LATTICE", 12, Hh - 2);
      ctx.textAlign = "right";
      const amtLabel =
        p.mode === "shift"
          ? `${p.amount < 0.5 ? "−" : "+"}${Math.round(Math.abs(p.amount * 2 - 1) * 100)}`
          : `${Math.round(p.amount * 100)}`;
      const status = !isLive ? "BYPASS" : `${p.mode} · A${amtLabel} · ${Math.round(lo * 100)}–${Math.round(hi * 100)}`;
      ctx.fillStyle = hexAlpha(isLive ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: st.current.mode !== "off" && (st.current.mix ?? 0) > 0.01,
        dragging: !!dragRef.current,
        particles: sparkles.length,
        motionKey: JSON.stringify(st.current),
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
      title="Drag: Amount ↔ / Mix ↕ · Bottom: Mix · Double-click: cycle mode"
      role="img"
      aria-label="Spectral bin lattice"
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
        Bin Lattice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(live ? C_HOT : C_MID, 0.78) }}
      >
        {live ? mode : "OFF"}
      </div>
    </div>
  );
}
