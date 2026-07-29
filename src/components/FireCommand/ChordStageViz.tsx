/**
 * Chord Memory — Stack Vault stage visualizer.
 * Memorized interval stack for live input (Signal Path Perf · FC.chord).
 * Click bars to nudge intervals · bottom toggles memory · double-click cycles presets.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.chord;
const C_DEEP = bandShade(FC_BAND.perf, 0.4);
const C_MID = bandShade(FC_BAND.perf, 0.55);
const C_HOT = bandShade(FC_BAND.perf, 0.7);
const C_GLOW = bandShade(FC_BAND.perf, 0.95);
const C_ROOT = bandShade(FC_BAND.perf, 0.58);
const C_VOICE = bandShade(FC_BAND.perf, 0.82);
const C_ARM = bandShade(FC_BAND.perf, 0.75);

export const CHORD_PRESETS: { id: string; name: string; short: string; ivs: number[] }[] = [
  { id: "maj", name: "Major", short: "Maj", ivs: [0, 4, 7] },
  { id: "min", name: "Minor", short: "Min", ivs: [0, 3, 7] },
  { id: "sus2", name: "Sus2", short: "Sus2", ivs: [0, 2, 7] },
  { id: "sus4", name: "Sus4", short: "Sus4", ivs: [0, 5, 7] },
  { id: "power", name: "Power", short: "5", ivs: [0, 7] },
  { id: "maj7", name: "Maj7", short: "M7", ivs: [0, 4, 7, 11] },
  { id: "min7", name: "Min7", short: "m7", ivs: [0, 3, 7, 10] },
  { id: "dom7", name: "Dom7", short: "7", ivs: [0, 4, 7, 10] },
  { id: "dim", name: "Dim", short: "Dim", ivs: [0, 3, 6] },
  { id: "aug", name: "Aug", short: "Aug", ivs: [0, 4, 8] },
  { id: "add9", name: "Add9", short: "Add9", ivs: [0, 4, 7, 14] },
  { id: "min9", name: "Min9", short: "m9", ivs: [0, 3, 7, 14] },
];

export function normalizeChordIvs(ivs: number[] | undefined): number[] {
  const raw = (ivs?.length ? ivs : [0, 4, 7]).map((n) => Math.round(n));
  const uniq = Array.from(new Set(raw)).sort((a, b) => a - b);
  if (!uniq.includes(0)) uniq.unshift(0);
  return uniq.slice(0, 6);
}

export function chordMatch(a: number[], b: number[]): boolean {
  const aa = normalizeChordIvs(a);
  const bb = normalizeChordIvs(b);
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

export function chordPresetLabel(ivs: number[]): string {
  const hit = CHORD_PRESETS.find((p) => chordMatch(ivs, p.ivs));
  return hit?.short ?? "Custom";
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

type DragMode = "nudge" | "arm" | null;

export function ChordStageViz() {
  const on = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const ivs = useFireCommandStore((s) => s.patch.chordIntervals);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["chord"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const dragVoiceRef = useRef(-1);
  const prevKey = useRef("");
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const st = useRef({ on, ivs, enabled });
  st.current = { on, ivs, enabled };

  const live = enabled && on;

  useEffect(() => {
    const key = `${on ? 1 : 0}|${enabled ? 1 : 0}|${normalizeChordIvs(ivs).join(",")}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [on, enabled, ivs]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const setIvs = useCallback(
    (next: number[]) => {
      setParam("chordIntervals", normalizeChordIvs(next));
      flashRef.current = 1;
    },
    [setParam],
  );

  const cyclePreset = useCallback(
    (dir = 1) => {
      const cur = normalizeChordIvs(st.current.ivs);
      let best = 0;
      for (let i = 0; i < CHORD_PRESETS.length; i++) {
        if (chordMatch(cur, CHORD_PRESETS[i]!.ivs)) {
          best = i;
          break;
        }
      }
      const next = CHORD_PRESETS[(best + dir + CHORD_PRESETS.length) % CHORD_PRESETS.length]!;
      setIvs([...next.ivs]);
    },
    [setIvs],
  );

  const hitVoice = useCallback((clientY: number): number => {
    const wrap = wrapRef.current;
    if (!wrap) return -1;
    const rect = wrap.getBoundingClientRect();
    const y = clientY - rect.top;
    const list = normalizeChordIvs(st.current.ivs);
    const top = 22;
    const bottom = rect.height - 22;
    const span = Math.max(1, bottom - top);
    const rowH = span / Math.max(1, list.length);
    const i = Math.floor((y - top) / rowH);
    return clamp(i, 0, list.length - 1);
  }, []);

  const nudgeVoice = useCallback(
    (clientX: number, voiceIdx: number) => {
      const wrap = wrapRef.current;
      if (!wrap || voiceIdx < 0) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      // Map x to interval 0..19 semitones (root fixed at 0)
      const list = normalizeChordIvs(st.current.ivs);
      if (voiceIdx === 0) return; // root stays 0
      const semis = Math.round(x * 19);
      const next = list.slice();
      next[voiceIdx] = Math.max(1, semis);
      setIvs(next);
    },
    [setIvs],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yNorm = (e.clientY - rect.top) / Math.max(1, rect.height);
      flashRef.current = 1;
      if (yNorm > 0.86) {
        dragRef.current = "arm";
        setParam("chordMemoryOn", !st.current.on);
        return;
      }
      if (yNorm < 0.12) {
        cyclePreset(1);
        return;
      }
      dragRef.current = "nudge";
      dragVoiceRef.current = hitVoice(e.clientY);
      nudgeVoice(e.clientX, dragVoiceRef.current);
    },
    [cyclePreset, hitVoice, nudgeVoice, setParam],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragRef.current !== "nudge") return;
      nudgeVoice(e.clientX, dragVoiceRef.current);
    },
    [nudgeVoice],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    dragVoiceRef.current = -1;
  }, []);

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
      const s = st.current;
      const flash = flashRef.current;
      const list = normalizeChordIvs(s.ivs);
      const armed = s.enabled && s.on;
      const breathe = 0.92 + 0.08 * Math.sin(t / 700);
      const label = chordPresetLabel(list);
      const maxIv = Math.max(12, ...list.map(Math.abs));

      ctx.clearRect(0, 0, W, Hcss);

      const bg = ctx.createRadialGradient(W * 0.35, Hcss * 0.4, 4, W * 0.5, Hcss * 0.5, W * 0.7);
      bg.addColorStop(0, hexAlpha(C_DEEP, 0.8 + flash * 0.15));
      bg.addColorStop(0.55, "rgba(12,2,10,0.96)");
      bg.addColorStop(1, hexAlpha(C_MID, 0.35 + (armed ? 0.15 : 0)));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hcss);

      // Preset strip (top)
      const padX = 10;
      const usable = W - padX * 2;
      const stripY = 6;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(padX, stripY, usable, 8);
      const presetIdx = Math.max(
        0,
        CHORD_PRESETS.findIndex((p) => chordMatch(list, p.ivs)),
      );
      const segW = usable / CHORD_PRESETS.length;
      for (let i = 0; i < CHORD_PRESETS.length; i++) {
        const hit = i === presetIdx && chordMatch(list, CHORD_PRESETS[i]!.ivs);
        ctx.fillStyle = hit ? hexAlpha(C_HOT, 0.8 + flash * 0.2) : hexAlpha(C, 0.1);
        ctx.fillRect(padX + i * segW + 1, stripY + 1, segW - 2, 6);
      }
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
      ctx.textAlign = "left";
      ctx.fillText(`VOICING · ${label.toUpperCase()}`, padX, stripY - 1);

      // Semitone ruler
      const top = 24;
      const bottom = Hcss - 24;
      const span = bottom - top;
      const barLeft = W * 0.2;
      const barMax = W * 0.62;

      ctx.strokeStyle = hexAlpha(C, 0.1);
      ctx.lineWidth = 1;
      for (let stn = 0; stn <= 12; stn++) {
        const x = barLeft + (stn / maxIv) * barMax;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }

      // Vault stack bars
      const rowH = span / Math.max(1, list.length);
      list.forEach((iv, i) => {
        const y = top + i * rowH + rowH * 0.2;
        const barH = Math.max(8, rowH * 0.5);
        const len = (Math.abs(iv) / maxIv) * barMax + (iv === 0 ? 8 : 0);
        const pulse = 0.85 + 0.15 * Math.sin(t / 200 + i);
        const isRoot = iv === 0;
        const col = isRoot ? C_ROOT : C_VOICE;

        // Floor
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(barLeft, y, barMax, barH);

        const g = ctx.createLinearGradient(barLeft, y, barLeft + len, y);
        g.addColorStop(0, hexAlpha(col, (armed ? 0.75 : 0.3) * pulse * breathe));
        g.addColorStop(1, hexAlpha(C_HOT, (armed ? 0.45 : 0.15) * pulse));
        ctx.fillStyle = g;
        ctx.shadowBlur = armed ? 10 + pulse * 6 + flash * 4 : 0;
        ctx.shadowColor = hexAlpha(C_HOT, 0.65);
        ctx.fillRect(barLeft, y, Math.max(6, len), barH);
        ctx.shadowBlur = 0;

        // Endpoint gem
        const ex = barLeft + Math.max(6, len);
        ctx.fillStyle = hexAlpha(C_GLOW, armed ? 0.9 : 0.4);
        ctx.beginPath();
        ctx.arc(ex, y + barH / 2, armed ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = hexAlpha(C_GLOW, armed ? 0.85 : 0.45);
        ctx.textAlign = "left";
        ctx.fillText(isRoot ? "ROOT" : `+${iv}`, 8, y + barH - 1);

        // Semitone ticks on bar
        if (armed && iv > 0) {
          ctx.fillStyle = hexAlpha(C_GLOW, 0.35 * pulse);
          for (let k = 1; k < iv; k++) {
            const tx = barLeft + (k / maxIv) * barMax;
            ctx.fillRect(tx, y + 2, 1, barH - 4);
          }
        }
      });

      // Vertical spine linking voices
      if (list.length > 1) {
        ctx.strokeStyle = hexAlpha(C_ARM, armed ? 0.35 + flash * 0.2 : 0.12);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barLeft - 6, top + rowH * 0.45);
        ctx.lineTo(barLeft - 6, top + (list.length - 0.55) * rowH);
        ctx.stroke();
        for (let i = 0; i < list.length; i++) {
          const y = top + i * rowH + rowH * 0.45;
          ctx.fillStyle = hexAlpha(i === 0 ? C_ROOT : C_VOICE, armed ? 0.8 : 0.35);
          ctx.beginPath();
          ctx.arc(barLeft - 6, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Sparks when armed
      if (armed) {
        if (Math.random() < 0.22 + list.length * 0.04) {
          const vi = Math.floor(Math.random() * list.length);
          const iv = list[vi]!;
          const y = top + vi * rowH + rowH * 0.45;
          const x = barLeft + (Math.abs(iv) / maxIv) * barMax * Math.random();
          sparks.current.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 0.7,
            vy: -0.25 - Math.random() * 0.5,
            life: 1,
          });
          if (sparks.current.length > 42) sparks.current.shift();
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

      // Arm rail
      const railY = Hcss - 10;
      ctx.strokeStyle = hexAlpha(C_ARM, 0.25);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(W - padX, railY);
      ctx.stroke();
      const armT = !s.enabled ? 0 : s.on ? 1 : 0.12;
      ctx.strokeStyle = hexAlpha(C_ARM, 0.85);
      ctx.beginPath();
      ctx.moveTo(padX, railY);
      ctx.lineTo(padX + armT * usable, railY);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(padX + armT * usable, railY, 4.5 + flash * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.55 + flash * 0.3);
      ctx.textAlign = "left";
      ctx.fillText(
        !s.enabled
          ? "STACK VAULT · BYPASS"
          : armed
            ? `STACK VAULT · ${label.toUpperCase()}`
            : "STACK VAULT · IDLE",
        10,
        Hcss - 8,
      );
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(C, 0.7);
      ctx.fillText(
        `${list.map((n) => (n === 0 ? "0" : `+${n}`)).join(" ")} · ${list.length}v`,
        W - 10,
        Hcss - 8,
      );
      },
      () => ({
        flash: flashRef.current,
        active: !!(st.current.on && st.current.enabled),
        dragging: !!dragRef.current,
        particles: 0,
        motionKey: JSON.stringify(st.current),
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
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="Stack vault — scrub voice intervals, top cycles presets, bottom arms memory"
      title="Bars: nudge interval · Top: preset · Bottom: arm"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px" style={{ background: `${C}55` }} />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px" style={{ background: `${C}55` }} />
    </div>
  );
}
