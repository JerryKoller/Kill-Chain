/**
 * Live — Stage Pulse visualizer.
 * Octave · mono/poly · voices · FX route · master (Signal Path Mix · FC.performance).
 * Click radar: Mono/Poly · keys: voice cap · right: FX · rail: Master · sides: Octave.
 * Double-click: Cease Fire flash.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.performance;
const C_DEEP = bandShade(FC_BAND.mix, 0.34);
const C_MID = bandShade(FC_BAND.mix, 0.52);
const C_HOT = bandShade(FC_BAND.mix, 0.7);
const C_GLOW = bandShade(FC_BAND.mix, 0.95);
const C_POLY = bandShade(FC_BAND.mix, 0.62);
const C_FX = bandShade(FC_BAND.mix, 0.82);
const C_VOICE = bandShade(FC_BAND.mix, 0.48);

const VOICE_CAPS = [6, 8, 12, 16, 24, 32] as const;

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

function nearestCap(n: number): number {
  let best: number = VOICE_CAPS[0]!;
  let bestD = Infinity;
  for (const c of VOICE_CAPS) {
    const d = Math.abs(c - n);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
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

type HitZone = "mono" | "octave+" | "octave-" | "voices" | "fx" | "master" | null;

export function LiveStageViz() {
  const mono = useFireCommandStore((s) => s.patch.mono);
  const harmony = useFireCommandStore((s) => s.patch.harmonyMode);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const octave = useFireCommandStore((s) => s.octave);
  const masterGain = useFireCommandStore((s) => s.patch.masterGain) ?? 0.72;
  const setParam = useFireCommandStore((s) => s.setParam);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  const setRouteThroughFx = useFireCommandStore((s) => s.setRouteThroughFx);
  const shiftOctave = useFireCommandStore((s) => s.shiftOctave);
  const panic = useFireCommandStore((s) => s.panic);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 520, h: H });
  const flashRef = useRef(0);
  const panicFlash = useRef(0);
  const dragRef = useRef<HitZone>(null);
  const prevKey = useRef("");
  const st = useRef({
    mono, harmony, maxVoices, fxOn, octave, masterGain, voices: 0,
  });
  st.current = {
    mono, harmony, maxVoices, fxOn, octave, masterGain, voices: st.current.voices,
  };

  const live = st.current.voices > 0 || masterGain > 0.05;

  useEffect(() => {
    const key = `${mono}|${maxVoices}|${fxOn}|${octave}|${masterGain.toFixed(3)}|${harmony}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mono, maxVoices, fxOn, octave, masterGain, harmony]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const hitTest = useCallback((clientX: number, clientY: number): HitZone => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);
    if (y > 0.82) return "master";
    if (x < 0.08) return y < 0.5 ? "octave+" : "octave-";
    if (x > 0.9) return "fx";
    if (x < 0.22) return "mono";
    return "voices";
  }, []);

  const applyAt = useCallback(
    (clientX: number, clientY: number, zone: HitZone) => {
      const wrap = wrapRef.current;
      if (!wrap || !zone) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      if (zone === "master") {
        setParam("masterGain", Math.round(x * 1.2 * 1000) / 1000);
        return;
      }
      if (zone === "voices") {
        const idx = Math.round(x * (VOICE_CAPS.length - 1));
        setMaxVoices(VOICE_CAPS[clamp(idx, 0, VOICE_CAPS.length - 1)]!);
      }
    },
    [setMaxVoices, setParam],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const zone = hitTest(e.clientX, e.clientY);
      dragRef.current = zone;
      flashRef.current = 1;
      if (zone === "mono") {
        setParam("mono", !st.current.mono);
      } else if (zone === "fx") {
        setRouteThroughFx(!st.current.fxOn);
      } else if (zone === "octave+") {
        shiftOctave(1);
      } else if (zone === "octave-") {
        shiftOctave(-1);
      } else {
        applyAt(e.clientX, e.clientY, zone);
      }
    },
    [applyAt, hitTest, setParam, setRouteThroughFx, shiftOctave],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const z = dragRef.current;
      if (z === "master" || z === "voices") applyAt(e.clientX, e.clientY, z);
    },
    [applyAt],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    panicFlash.current = 1;
    flashRef.current = 1;
    useFireSequencerStore.getState().stop();
    panic();
  }, [panic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stopLoop = startStageVizLoop(
      (t) => {
      flashRef.current *= 0.9;
      panicFlash.current *= 0.92;

      let n = 0;
      try {
        n = activeFireEngine().getActiveVoiceCount();
      } catch {
        n = 0;
      }
      st.current.voices = n;

      const { w: W, h: Hcss } = sizeRef.current;
      if (W < 2) return;
      const p = st.current;
      const flash = flashRef.current;
      const panicA = panicFlash.current;
      const voiceActivity = Math.min(1, p.voices / Math.max(1, p.maxVoices));
      const breath = 0.5 + 0.5 * Math.sin(t * 0.002);

      ctx.clearRect(0, 0, W, Hcss);

      // Stage plate
      const bg = ctx.createLinearGradient(0, 0, W, Hcss);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.6 + flash * 0.2 + panicA * 0.25));
      bg.addColorStop(0.5, "rgba(8,4,2,0.94)");
      bg.addColorStop(1, hexAlpha(p.fxOn ? C_FX : C_MID, 0.25 + voiceActivity * 0.2));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      if (panicA > 0.05) {
        ctx.fillStyle = hexAlpha(C_HOT, panicA * 0.35);
        ctx.fillRect(0, 0, W, Hcss);
      }

      // Octave ladder (left) — octave 0..8
      for (let i = 0; i <= 8; i++) {
        const oy = Hcss * 0.1 + (8 - i) * ((Hcss * 0.58) / 8);
        const rungOn = p.octave === i;
        ctx.fillStyle = hexAlpha(rungOn ? C_GLOW : C, rungOn ? 0.9 : 0.18);
        ctx.fillRect(4, oy, 10, 2.5);
      }
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.textAlign = "center";
      ctx.fillText(String(p.octave), 9, Hcss * 0.78);

      // Radar (mono/poly)
      const radarCx = W * 0.14;
      const radarCy = Hcss * 0.4;
      const radarR = 26 + voiceActivity * 6;
      for (let i = 1; i <= 3; i++) {
        ctx.strokeStyle = hexAlpha(C, 0.08 + voiceActivity * 0.1 + flash * 0.08);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(radarCx, radarCy, radarR * (i / 3), 0, Math.PI * 2);
        ctx.stroke();
      }
      const sweepAngle = (t / 1600) % (Math.PI * 2);
      ctx.strokeStyle = hexAlpha(p.mono ? C_HOT : C_POLY, 0.4 + voiceActivity * 0.45);
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 8 + voiceActivity * 14 + flash * 8;
      ctx.shadowColor = p.mono ? C_HOT : C_POLY;
      ctx.beginPath();
      ctx.moveTo(radarCx, radarCy);
      ctx.lineTo(
        radarCx + Math.cos(sweepAngle) * radarR,
        radarCy + Math.sin(sweepAngle) * radarR,
      );
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Voice blips on radar
      for (let v = 0; v < Math.min(8, p.voices); v++) {
        const a = sweepAngle + (v / Math.max(1, p.voices)) * Math.PI * 1.4 - Math.PI * 0.7;
        const rr = radarR * (0.35 + (v / Math.max(1, p.voices)) * 0.55);
        const bx = radarCx + Math.cos(a) * rr;
        const by = radarCy + Math.sin(a) * rr;
        const bg2 = ctx.createRadialGradient(bx, by, 0, bx, by, 4);
        bg2.addColorStop(0, hexAlpha(C_GLOW, 0.9));
        bg2.addColorStop(1, hexAlpha(C_VOICE, 0));
        ctx.fillStyle = bg2;
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(p.mono ? C_HOT : C_POLY, 0.85);
      ctx.textAlign = "center";
      ctx.fillText(p.mono ? "MONO" : "POLY", radarCx, radarCy + radarR + 14);

      // Piano keys
      const keyCount = Math.min(32, p.maxVoices);
      const keyPadL = W * 0.26;
      const keyPadR = W * 0.1;
      const keyW = (W - keyPadL - keyPadR) / keyCount;
      const keyH = 36;
      const keyY = Hcss * 0.32;

      for (let i = 0; i < keyCount; i++) {
        const active = i < p.voices;
        const x = keyPadL + i * keyW;
        const col = p.mono ? C_HOT : C_POLY;
        ctx.fillStyle = active
          ? hexAlpha(col, 0.55 + Math.sin(t / 260 + i * 0.45) * 0.2 + flash * 0.15)
          : "rgba(255,255,255,0.05)";
        ctx.fillRect(x + 0.4, keyY, Math.max(1, keyW - 1.2), keyH);
        ctx.strokeStyle = active ? hexAlpha(col, 0.5) : "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.4, keyY, Math.max(1, keyW - 1.2), keyH);
        if (active) {
          ctx.shadowBlur = 6;
          ctx.shadowColor = col;
          ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
          ctx.fillRect(x + 0.4, keyY, Math.max(1, keyW - 1.2), 3);
          ctx.shadowBlur = 0;
        }
      }

      // Cap markers under keys
      ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const cap of VOICE_CAPS) {
        if (cap > keyCount && cap !== p.maxVoices) continue;
        const u = (cap - 1) / Math.max(1, keyCount - 1);
        const mx = keyPadL + u * (W - keyPadL - keyPadR);
        const on = p.maxVoices === cap;
        ctx.fillStyle = hexAlpha(on ? C_GLOW : C, on ? 0.8 : 0.3);
        ctx.fillText(String(cap), mx, keyY + keyH + 12);
      }

      // FX route column (right)
      const fxX = W - 18;
      if (p.fxOn) {
        const pulse = 0.55 + 0.45 * Math.sin(t / 300);
        ctx.strokeStyle = hexAlpha(C_FX, 0.4 + pulse * 0.4);
        ctx.lineWidth = 3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = C_FX;
        ctx.beginPath();
        ctx.moveTo(fxX, keyY);
        ctx.lineTo(fxX, keyY + keyH);
        ctx.stroke();
        ctx.shadowBlur = 0;
        const tint = ctx.createLinearGradient(W - 48, 0, W, 0);
        tint.addColorStop(0, "rgba(0,0,0,0)");
        tint.addColorStop(1, hexAlpha(C_FX, 0.18 + pulse * 0.12));
        ctx.fillStyle = tint;
        ctx.fillRect(W - 48, keyY - 4, 48, keyH + 8);
      } else {
        ctx.strokeStyle = hexAlpha(C, 0.2);
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(fxX, keyY);
        ctx.lineTo(fxX, keyY + keyH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(p.fxOn ? C_FX : C, 0.75);
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(fxX - 2, keyY + keyH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(p.fxOn ? "→ FX" : "DRY", 0, 0);
      ctx.restore();

      // Pulse rings when voices active
      if (p.voices > 0) {
        const pr = 20 + voiceActivity * 40 + breath * 8;
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.08 + voiceActivity * 0.15);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(W * 0.55, keyY + keyH / 2, pr, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Master rail
      const railY = Hcss - 12;
      const railPad = 14;
      ctx.strokeStyle = hexAlpha(C, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(W - railPad, railY);
      ctx.stroke();
      const thumbX = railPad + clamp(p.masterGain / 1.2, 0, 1) * (W - railPad * 2);
      ctx.strokeStyle = hexAlpha(C_HOT, 0.75 + flash * 0.2);
      ctx.beginPath();
      ctx.moveTo(railPad, railY);
      ctx.lineTo(thumbX, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.shadowBlur = 8 + flash * 8;
      ctx.shadowColor = hexAlpha(C_HOT, 0.65);
      ctx.beginPath();
      ctx.arc(thumbX, railY, 5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Labels
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.35);
      ctx.textAlign = "left";
      ctx.fillText("STAGE PULSE", 10, Hcss - 8);
      ctx.textAlign = "right";
      const harm = p.harmony && p.harmony !== "off" ? ` · ${String(p.harmony).toUpperCase()}` : "";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(
        `${p.voices}/${p.maxVoices} · OCT ${p.octave}${harm} · MST ${Math.round(p.masterGain * 100)}%`,
        W - 10,
        Hcss - 8,
      );
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: 0,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 28 },
    );
    return stopLoop;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border-2 bg-black/50 cursor-pointer touch-none select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      style={{
        borderColor: `${C}${live ? "66" : "40"}`,
        height: H,
        boxShadow: live
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 28px ${C}28, 0 6px 18px rgba(0,0,0,0.3)`
          : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="img"
      aria-label="Stage pulse — live performance controls"
      title="Radar: Mono/Poly · Keys: voice cap · Right: FX · Rail: Master · Sides: Octave · Double-click: Cease Fire"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute left-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 70% 100%, 0 100%)", opacity: 0.65 }} />
      <span className="pointer-events-none absolute right-0 top-0 h-2 w-5" style={{ background: C, clipPath: "polygon(0 0, 100% 0, 100% 100%, 30% 100%)", opacity: 0.65 }} />
    </div>
  );
}

// silence unused nearestCap warning by exporting for panel use
export { nearestCap, VOICE_CAPS };
