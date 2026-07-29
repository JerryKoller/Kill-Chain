/**
 * MOD — Morph Weaver MSEG visualizer.
 * Multi-segment envelope (up to 8 points) · Env→WT A/B/C (Signal Path Tone · FC.envMod).
 * Drag nodes (time/level), mid-segment to cycle curve. Bottom rail: morph depth per osc. Double-click: defaults.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";
import { type ModEnvPoint, type EnvCurve, normalizeModEnvPoints, applyEnvCurve } from "@/audio/dsp/toneDifferentiation";
import { useToneTelemetry } from "./useToneTelemetry";

const H = 176;
const C = FC.envMod;
const C_DEEP = bandShade(FC.tone, 0.2);
const C_MID = bandShade(FC.tone, 0.4);
const C_HOT = bandShade(FC.tone, 0.55);
const C_GLOW = bandShade(FC.tone, 0.9);
const C_MORPH = bandShade(FC.tone, 0.85);
const C_OA = FC.oscA;
const C_OB = FC.oscB;
const C_OC = FC.oscC;

const T_MIN = 0.001;
const T_MAX = 4;
const CURVE_CYCLE: EnvCurve[] = ["lin", "exp", "log", "s", "step", "overshoot", "spring"];

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

function timeToX(t: number, maxT: number, PAD: number, usableW: number): number {
  return PAD + (t / Math.max(0.001, maxT)) * usableW;
}

function xToTime(x: number, maxT: number, PAD: number, usableW: number): number {
  return clamp((x - PAD) / Math.max(1, usableW), 0, 1) * maxT;
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

type DragMode = "node" | "segment" | "morph" | null;
type MorphFocus = "a" | "b" | "c";

export function ModEnvStageViz() {
  const points = useFireCommandStore((s) => normalizeModEnvPoints(s.patch.modEnvPoints));
  const sustainIndex = useFireCommandStore((s) => s.patch.modEnvSustainIndex ?? points.length - 1);
  const envA = useFireCommandStore((s) => s.patch.oscAEnv) ?? 0;
  const envB = useFireCommandStore((s) => s.patch.oscBEnv) ?? 0;
  const envC = useFireCommandStore((s) => s.patch.oscCEnv) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const tel = useToneTelemetry();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const dragNodeIdxRef = useRef(-1);
  const dragSegmentIdxRef = useRef(-1);
  const focusRef = useRef<MorphFocus>("a");
  const prevKey = useRef("");
  const st = useRef({ points, sustainIndex, envA, envB, envC, tel });
  st.current = { points, sustainIndex, envA, envB, envC, tel };

  const morphAmt = Math.max(Math.abs(envA), Math.abs(envB), Math.abs(envC));
  const weaving = morphAmt > 0.04 || points.length > 3;

  useEffect(() => {
    const key = JSON.stringify({ points, sustainIndex, envA, envB, envC });
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [points, sustainIndex, envA, envB, envC]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const syncLegacyADSR = useCallback(
    (pts: ModEnvPoint[], susIdx: number) => {
      const attack = pts.length > 1 ? pts[1].t : 0.02;
      const lastT = pts[pts.length - 1]?.t || 0.5;
      const decay = lastT - attack;
      const sustain = pts[susIdx]?.level ?? 0.3;
      setParam("modAttack", Math.round(attack * 1000) / 1000);
      setParam("modDecay", Math.max(0.005, Math.round(decay * 1000) / 1000));
      setParam("modSustain", Math.round(sustain * 1000) / 1000);
    },
    [setParam],
  );

  const applyDrag = useCallback(
    (clientX: number, clientY: number, mode: DragMode) => {
      const wrap = wrapRef.current;
      if (!wrap || !mode) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      if (mode === "morph") {
        const signed = clamp(x * 2 - 1, -1, 1);
        const key = focusRef.current === "a" ? "oscAEnv" : focusRef.current === "b" ? "oscBEnv" : "oscCEnv";
        setParam(key, Math.round(signed * 1000) / 1000);
        return;
      }
      const PAD = 14;
      const usableH = H - 48;
      const usableW = rect.width - PAD * 2;
      const level = 1 - clamp((clientY - rect.top - 24) / usableH, 0, 1);
      if (mode === "node") {
        const idx = dragNodeIdxRef.current;
        if (idx < 0 || idx >= points.length) return;
        const newPts = [...points];
        const lastT = points[points.length - 1]?.t || 1;
        const maxT = Math.max(lastT, T_MAX);
        const newT = idx === 0 ? 0 : xToTime(clientX - rect.left, maxT, PAD, usableW);
        const prevT = idx > 0 ? newPts[idx - 1].t : 0;
        const nextT = idx < newPts.length - 1 ? newPts[idx + 1].t : maxT;
        newPts[idx] = { ...newPts[idx], t: clamp(newT, prevT, nextT), level: clamp(level, 0, 1) };
        setParam("modEnvPoints", newPts);
        syncLegacyADSR(newPts, sustainIndex);
      }
    },
    [setParam, points, sustainIndex, syncLegacyADSR],
  );

  const hitZone = useCallback(
    (clientX: number, clientY: number): DragMode => {
      const wrap = wrapRef.current;
      if (!wrap) return null;
      const rect = wrap.getBoundingClientRect();
      const lx = clientX - rect.left;
      const ly = clientY - rect.top;
      if (ly > H * 0.78) {
        const t = lx / Math.max(1, rect.width);
        focusRef.current = t < 0.33 ? "a" : t < 0.66 ? "b" : "c";
        return "morph";
      }
      const PAD = 14;
      const top = 24;
      const usableH = H - 48;
      const usableW = rect.width - PAD * 2;
      const lastT = points[points.length - 1]?.t || 1;
      const maxT = Math.max(lastT, T_MAX);
      const yLv = (lv: number) => top + (1 - clamp(lv, 0, 1)) * usableH;
      for (let i = 0; i < points.length; i++) {
        const px = timeToX(points[i].t, maxT, PAD, usableW);
        const py = yLv(points[i].level);
        const dist = Math.hypot(lx - px, ly - py);
        if (dist < 12) {
          dragNodeIdxRef.current = i;
          return "node";
        }
      }
      for (let i = 1; i < points.length; i++) {
        const x1 = timeToX(points[i - 1].t, maxT, PAD, usableW);
        const x2 = timeToX(points[i].t, maxT, PAD, usableW);
        const midX = (x1 + x2) / 2;
        if (Math.abs(lx - midX) < 16 && ly >= top && ly <= top + usableH) {
          dragSegmentIdxRef.current = i;
          return "segment";
        }
      }
      return null;
    },
    [points],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const mode = hitZone(e.clientX, e.clientY);
      if (mode === "segment") {
        const idx = dragSegmentIdxRef.current;
        if (idx >= 1 && idx < points.length) {
          const newPts = [...points];
          const currentCurve = newPts[idx].curve;
          const nextIdx = CURVE_CYCLE.indexOf(currentCurve);
          newPts[idx] = { ...newPts[idx], curve: CURVE_CYCLE[(nextIdx + 1) % CURVE_CYCLE.length] };
          setParam("modEnvPoints", newPts);
          flashRef.current = 1;
        }
        return;
      }
      dragRef.current = mode;
      wrap.setPointerCapture(e.pointerId);
      applyDrag(e.clientX, e.clientY, mode);
    },
    [hitZone, applyDrag, points, setParam],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyDrag(e.clientX, e.clientY, dragRef.current);
    },
    [applyDrag],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const defaultPts: ModEnvPoint[] = [
      { t: 0, level: 0, curve: "lin" },
      { t: 0.02, level: 1, curve: "exp" },
      { t: 0.52, level: 0.3, curve: "log" },
    ];
    setParam("modEnvPoints", defaultPts);
    setParam("modEnvSustainIndex", 2);
    setParam("modAttack", 0.02);
    setParam("modDecay", 0.5);
    setParam("modSustain", 0.3);
    setParam("modRelease", 0.4);
    setParam("oscAEnv", 0);
    setParam("oscBEnv", 0);
    setParam("oscCEnv", 0);
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const shards: Array<{ x: number; y: number; life: number; vx: number; phase: number }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
        const { w: W, h: Hh } = sizeRef.current;
        const p = st.current;
        flashRef.current *= 0.86;

        const PAD = 14;
        const top = 24;
        const usableH = Hh - 48;
        const usableW = W - PAD * 2;
        const pts = p.points;
        const susIdx = p.sustainIndex;
        const lastT = pts[pts.length - 1]?.t || 1;
        const maxT = Math.max(lastT, T_MAX);

        const yLv = (lv: number) => top + (1 - clamp(lv, 0, 1)) * usableH;
        const morphMag = Math.max(Math.abs(p.envA), Math.abs(p.envB), Math.abs(p.envC));
        const susLevel = pts[susIdx]?.level ?? 0.3;
        const energy = 0.22 + susLevel * 0.2 + morphMag * 0.35 + flashRef.current * 0.25;
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        const breathe = 0.94 + 0.06 * Math.sin(now / 680);
        const focus = focusRef.current;

        ctx.clearRect(0, 0, W, Hh);

        // Tone-gold morph chamber
        const cx = W * 0.35;
        const bg = ctx.createRadialGradient(cx, Hh * 0.36, 4, W * 0.5, Hh * 0.48, W * 0.78);
        bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + energy * 0.32 + flashRef.current * 0.25));
        bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.58));
        bg.addColorStop(1, "rgba(6,5,1,0.98)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, Hh);

        // Wavetable scan field — density from morph + sustain
        const scans = 5 + Math.round(morphMag * 6);
        for (let scan = 0; scan < scans; scan++) {
          const sy = top + 6 + scan * ((usableH - 12) / Math.max(1, scans - 1));
          ctx.strokeStyle = hexAlpha(C_MID, (0.08 + pulse * 0.07 + morphMag * 0.12) * breathe);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let xi = 0; xi <= usableW; xi += 2.5) {
            const t = (xi / usableW) * maxT;
            let envH = 0;
            for (let i = 1; i < pts.length; i++) {
              if (t <= pts[i].t || i === pts.length - 1) {
                const a = pts[i - 1];
                const b = pts[i];
                const dur = Math.max(0.0001, b.t - a.t);
                const u = applyEnvCurve((t - a.t) / dur, b.curve);
                envH = a.level + (b.level - a.level) * u;
                break;
              }
            }
            const x = PAD + xi;
            const wob =
              Math.sin((xi / usableW) * Math.PI * (5 + morphMag * 8) + now / 180 + scan * 0.7) *
              (3 + morphMag * 8 + susLevel * 4) *
              breathe;
            const yy = sy + wob * envH;
            if (xi === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }

        const morphPath = () => {
          ctx.beginPath();
          ctx.moveTo(timeToX(pts[0].t, maxT, PAD, usableW), yLv(pts[0].level));
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const x1 = timeToX(a.t, maxT, PAD, usableW);
            const y1 = yLv(a.level);
            const x2 = timeToX(b.t, maxT, PAD, usableW);
            const y2 = yLv(b.level);
            const steps = Math.max(16, Math.ceil((x2 - x1) / 3));
            for (let step = 1; step <= steps; step++) {
              const u = applyEnvCurve(step / steps, b.curve);
              const x = x1 + (x2 - x1) * (step / steps);
              const y = y1 + (y2 - y1) * u;
              ctx.lineTo(x, y);
            }
          }
        };

        // Layered weaver fill
        for (let layer = 3; layer >= 0; layer--) {
          morphPath();
          const x0 = PAD;
          const xEnd = timeToX(pts[pts.length - 1].t, maxT, PAD, usableW);
          ctx.lineTo(xEnd, top + usableH);
          ctx.lineTo(x0, top + usableH);
          ctx.closePath();
          const fill = ctx.createLinearGradient(x0, 0, xEnd, 0);
          fill.addColorStop(0, hexAlpha(C_HOT, (0.1 - layer * 0.02) * breathe));
          fill.addColorStop(0.35, hexAlpha(C_HOT, (0.28 + pulse * 0.1 - layer * 0.05) * breathe));
          fill.addColorStop(0.7, hexAlpha(C_MORPH, 0.16 - layer * 0.03));
          fill.addColorStop(1, hexAlpha(C_DEEP, 0.04));
          ctx.fillStyle = fill;
          ctx.fill();
        }

        // Dashed morph contour
        morphPath();
        ctx.strokeStyle = hexAlpha(C_GLOW, 0.85 + flashRef.current * 0.15);
        ctx.lineWidth = 2.4;
        ctx.setLineDash([6, 4]);
        ctx.shadowBlur = 12 + energy * 10 + flashRef.current * 14;
        ctx.shadowColor = C;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Node handles
        for (let i = 0; i < pts.length; i++) {
          const px = timeToX(pts[i].t, maxT, PAD, usableW);
          const py = yLv(pts[i].level);
          const isSus = i === susIdx;
          const col = isSus ? C_MORPH : C_HOT;
          ctx.fillStyle = hexAlpha(col, 0.92);
          ctx.shadowBlur = isSus ? 12 : 8;
          ctx.shadowColor = col;
          ctx.beginPath();
          ctx.arc(px, py, (isSus ? 5 : 4) + flashRef.current * 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = hexAlpha(col, 0.7);
          ctx.textAlign = "center";
          ctx.fillText(`${i}`, px, top - 4);
        }

        // Live cursor from telemetry (bright dot at phase×width, height by level)
        const tel = p.tel;
        const voiceActive = tel.voiceCount > 0;
        if (voiceActive) {
          const cursorX = PAD + tel.mod.phase * usableW;
          const cursorY = yLv(tel.mod.level);
          const cursorCol = tel.mod.releasing ? C_MORPH : C_GLOW;
          const orbGlow = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, 18 + pulse * 10);
          orbGlow.addColorStop(0, hexAlpha(C_GLOW, 0.85 + pulse * 0.15));
          orbGlow.addColorStop(0.4, hexAlpha(cursorCol, 0.45));
          orbGlow.addColorStop(1, hexAlpha(C, 0));
          ctx.fillStyle = orbGlow;
          ctx.beginPath();
          ctx.arc(cursorX, cursorY, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = hexAlpha("#fff", 0.95);
          ctx.shadowBlur = 16;
          ctx.shadowColor = cursorCol;
          ctx.beginPath();
          ctx.arc(cursorX, cursorY, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Frame scrub ticks (wavetable frames) — amount follows morph
        const frames = 8 + Math.round(morphMag * 10);
        for (let i = 0; i < frames; i++) {
          const fx = PAD + ((i + ((now / 400) % 1)) / frames) * usableW;
          const fh = 4 + morphMag * 10 * Math.abs(Math.sin(i + now / 300));
          ctx.fillStyle = hexAlpha(C_MORPH, 0.15 + morphMag * 0.35);
          ctx.fillRect(fx, top + usableH - fh, 1.5, fh);
        }

        // Morph shards
        if (morphMag > 0.05 && Math.random() < 0.12 + morphMag * 0.3) {
          shards.push({
            x: PAD + Math.random() * usableW,
            y: top + Math.random() * usableH,
            life: 1,
            vx: (Math.random() - 0.5) * 2,
            phase: Math.random() * Math.PI * 2,
          });
        }
        for (let i = shards.length - 1; i >= 0; i--) {
          const s = shards[i]!;
          s.life -= 0.025;
          if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
          }
          s.x += s.vx;
          s.y += Math.sin(now / 200 + s.phase) * 0.4;
          ctx.fillStyle = hexAlpha(C_HOT, s.life * 0.65);
          ctx.fillRect(s.x, s.y, 2 + morphMag * 2, 2);
        }

        // Destination meters (left stack) — Env→WT A/B/C
        const dests: Array<{ v: number; col: string; label: string }> = [
          { v: p.envA, col: C_OA, label: "A" },
          { v: p.envB, col: C_OB, label: "B" },
          { v: p.envC, col: C_OC, label: "C" },
        ];
        dests.forEach((m, i) => {
          const my = top + 4 + i * 22;
          const bw = 28;
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(PAD, my, bw, 8);
          const mid = PAD + bw / 2;
          const mag = Math.abs(m.v);
          if (mag > 0.02) {
            const w = (bw / 2) * mag;
            ctx.fillStyle = hexAlpha(m.col, 0.75);
            ctx.shadowBlur = 6;
            ctx.shadowColor = m.col;
            if (m.v >= 0) ctx.fillRect(mid, my, w, 8);
            else ctx.fillRect(mid - w, my, w, 8);
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = hexAlpha(m.col, focus === (i === 0 ? "a" : i === 1 ? "b" : "c") ? 0.95 : 0.5);
          ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(m.label, PAD + bw + 4, my + 7);
        });

      // Morph rail (bipolar for focused osc)
      const railY = Hh - 16;
      const focusVal = focus === "a" ? p.envA : focus === "b" ? p.envB : p.envC;
      const focusCol = focus === "a" ? C_OA : focus === "b" ? C_OB : C_OC;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_MORPH, 0.25);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      // center zero
      const midX = 12 + (W - 24) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(midX - 0.5, railY, 1, 7);
      const signedX = midX + focusVal * ((W - 24) / 2);
      ctx.fillStyle = hexAlpha(focusCol, 0.85);
      ctx.shadowBlur = 8;
      ctx.shadowColor = focusCol;
      ctx.beginPath();
      ctx.arc(signedX, railY + 3.5, 3.5 + flashRef.current * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // fill from center to knob
      if (Math.abs(focusVal) > 0.02) {
        const left = Math.min(midX, signedX);
        const right = Math.max(midX, signedX);
        const rg = ctx.createLinearGradient(left, railY, right, railY);
        rg.addColorStop(0, hexAlpha(focusCol, 0.25));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.7));
        ctx.fillStyle = rg;
        ctx.fillRect(left, railY + 1, right - left, 5);
      }
      ctx.fillStyle = hexAlpha(C_MORPH, 0.75);
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`→WT ${focus.toUpperCase()}`, 14, railY - 3);

      // Segment curve labels under nodes
      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      for (let i = 1; i < pts.length; i++) {
        const x1 = timeToX(pts[i - 1].t, maxT, PAD, usableW);
        const x2 = timeToX(pts[i].t, maxT, PAD, usableW);
        ctx.fillStyle = hexAlpha(C_HOT, 0.45);
        ctx.fillText(String(pts[i].curve).slice(0, 3).toUpperCase(), (x1 + x2) / 2, top + usableH + 11);
      }

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("MOD · MORPH WEAVER", 12, Hh - 2);
      ctx.textAlign = "right";
      const fmt = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
      const atkT = pts.length > 1 ? pts[1].t : 0.02;
      const susLvl = pts[Math.min(susIdx, pts.length - 1)]?.level ?? 0.3;
      ctx.fillStyle = hexAlpha(C_HOT, 0.88);
      ctx.fillText(`A${fmt(atkT)} · S${Math.round(susLvl * 100)} · →${Math.round(morphMag * 100)} · ${pts.length}pts`, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: tel.voiceCount > 0,
        dragging: !!dragRef.current,
        particles: shards.length,
        motionKey: JSON.stringify({ ...st.current, vc: tel.voiceCount, stg: tel.mod.stage, lv: tel.mod.level }),
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
        borderColor: hexAlpha(C, weaving ? 0.55 : 0.32),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, weaving ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag A/D/S/R zones · Bottom rail: Env→WT (thirds = A/B/C focus) · Double-click: defaults"
      role="img"
      aria-label="Mod envelope morph weaver"
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
        Morph Weaver
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums"
        style={{ color: hexAlpha(C_HOT, 0.75) }}
      >
        →WT
      </div>
    </div>
  );
}
