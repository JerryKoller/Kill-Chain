/**
 * FM Rack · Vector — Vector Lattice stage visualizer.
 * 4-op algorithm graph · operator levels/ratios · feedback · vector morph (Signal Path Mod · FC.fmRack).
 * Drag pad: Vec Rate ↔ / Vec Depth ↕. Drag orbs: Level ↕ / Ratio ↔ (Op2–4). Bottom: Feedback. Double-click: next alg.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FmEngineMode } from "@/audio/dsp/FireCommandSynth";
import { getEngine } from "@/audio/AudioEngine";
import { FC, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 188;
const C = FC.fmRack;
const C_DEEP = bandShade(FC.mod, 0.26);
const C_MID = bandShade(FC.mod, 0.48);
const C_HOT = bandShade(FC.mod, 0.66);
const C_GLOW = bandShade(FC.mod, 0.94);
const C_FB = bandShade(FC.mod, 0.72);
const C_VEC = bandShade(FC.mod, 0.82);
const C_OP = [
  bandShade(FC.mod, 0.95),
  bandShade(FC.mod, 0.75),
  bandShade(FC.mod, 0.58),
  bandShade(FC.mod, 0.42),
] as const;

const RATIO_MIN = 0.25;
const RATIO_MAX = 16;

/** Algorithm cable routes: [fromOp, toOp] (0-indexed). */
const ALG_ROUTES: Record<number, Array<[number, number]>> = {
  0: [[1, 0]],
  1: [[2, 1], [1, 0]],
  2: [[1, 0], [2, 0]],
  3: [[3, 2], [2, 1], [1, 0]],
  4: [[2, 1], [3, 1], [1, 0]],
  5: [[1, 0], [2, 0], [3, 0]],
  6: [[3, 2], [2, 0], [1, 0]],
  7: [[3, 0], [2, 0], [1, 0]],
};

const ALG_NAMES = ["Stack1", "Stack2", "Twin", "Cascade", "Fork", "Parallel", "Branch", "All→C"] as const;

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

type DragMode = "vec" | "fb" | "op" | null;

type OpKey = "fmOp1Level" | "fmOp2Level" | "fmOp3Level" | "fmOp4Level";
type RatioKey = "fmOp2Ratio" | "fmOp3Ratio" | "fmOp4Ratio";

const OP_LEVEL_KEYS: OpKey[] = ["fmOp1Level", "fmOp2Level", "fmOp3Level", "fmOp4Level"];
const OP_RATIO_KEYS: (RatioKey | null)[] = [null, "fmOp2Ratio", "fmOp3Ratio", "fmOp4Ratio"];

export function FmRackStageViz() {
  const engine = (useFireCommandStore((s) => s.patch.fmEngine) ?? "classic") as FmEngineMode;
  const alg = useFireCommandStore((s) => s.patch.fmAlg) ?? 0;
  const feedback = useFireCommandStore((s) => s.patch.fmFeedback) ?? 0;
  const op1 = useFireCommandStore((s) => s.patch.fmOp1Level) ?? 1;
  const op2 = useFireCommandStore((s) => s.patch.fmOp2Level) ?? 0.7;
  const op3 = useFireCommandStore((s) => s.patch.fmOp3Level) ?? 0.5;
  const op4 = useFireCommandStore((s) => s.patch.fmOp4Level) ?? 0.35;
  const r2 = useFireCommandStore((s) => s.patch.fmOp2Ratio) ?? 1;
  const r3 = useFireCommandStore((s) => s.patch.fmOp3Ratio) ?? 2;
  const r4 = useFireCommandStore((s) => s.patch.fmOp4Ratio) ?? 3;
  const vecRate = useFireCommandStore((s) => s.patch.vectorRate) ?? 0;
  const vecDepth = useFireCommandStore((s) => s.patch.vectorDepth) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 420, h: H });
  const flashRef = useRef(0);
  const dragRef = useRef<DragMode>(null);
  const focusOpRef = useRef(0);
  const opPosRef = useRef<Array<{ x: number; y: number; r: number }>>([]);
  const prevKey = useRef("");
  const st = useRef({
    engine,
    alg,
    feedback,
    op1,
    op2,
    op3,
    op4,
    r2,
    r3,
    r4,
    vecRate,
    vecDepth,
  });
  st.current = { engine, alg, feedback, op1, op2, op3, op4, r2, r3, r4, vecRate, vecDepth };

  const ops4 = engine === "ops4";
  const live = ops4 && (feedback > 0.02 || vecDepth > 0.02 || op2 > 0.05 || op3 > 0.05 || op4 > 0.05);

  useEffect(() => {
    const key = `${engine}|${alg}|${feedback.toFixed(3)}|${op1.toFixed(2)}|${op2.toFixed(2)}|${op3.toFixed(2)}|${op4.toFixed(2)}|${r2.toFixed(2)}|${r3.toFixed(2)}|${r4.toFixed(2)}|${vecRate.toFixed(3)}|${vecDepth.toFixed(3)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [engine, alg, feedback, op1, op2, op3, op4, r2, r3, r4, vecRate, vecDepth]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const hitOp = useCallback((clientX: number, clientY: number): number => {
    const wrap = wrapRef.current;
    if (!wrap) return -1;
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ops = opPosRef.current;
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i]!;
      const dx = x - o.x;
      const dy = y - o.y;
      if (dx * dx + dy * dy <= (o.r + 8) * (o.r + 8)) return i;
    }
    return -1;
  }, []);

  const applyVec = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      setParam("vectorRate", Math.round(x * 1000) / 1000);
      setParam("vectorDepth", Math.round((1 - y) * 1000) / 1000);
    },
    [setParam],
  );

  const applyFb = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setParam("fmFeedback", Math.round(x * 1000) / 1000);
    },
    [setParam],
  );

  const applyOp = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const y = clamp((clientY - rect.top) / Math.max(1, rect.height * 0.78), 0, 1);
      const i = focusOpRef.current;
      const lvlKey = OP_LEVEL_KEYS[i];
      if (lvlKey) setParam(lvlKey, Math.round((1 - y) * 1000) / 1000);
      const ratioKey = OP_RATIO_KEYS[i];
      if (ratioKey) {
        setParam(ratioKey, Math.round(logLerp(x, RATIO_MIN, RATIO_MAX) * 100) / 100);
      }
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
        dragRef.current = "fb";
        wrap.setPointerCapture(e.pointerId);
        applyFb(e.clientX);
        return;
      }
      const hit = hitOp(e.clientX, e.clientY);
      if (hit >= 0) {
        focusOpRef.current = hit;
        dragRef.current = "op";
        wrap.setPointerCapture(e.pointerId);
        applyOp(e.clientX, e.clientY);
        return;
      }
      dragRef.current = "vec";
      wrap.setPointerCapture(e.pointerId);
      applyVec(e.clientX, e.clientY);
    },
    [applyFb, applyOp, applyVec, hitOp],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const m = dragRef.current;
      if (m === "vec") applyVec(e.clientX, e.clientY);
      else if (m === "fb") applyFb(e.clientX);
      else if (m === "op") applyOp(e.clientX, e.clientY);
    },
    [applyVec, applyFb, applyOp],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    const next = (Math.round(st.current.alg) + 1) % 8;
    setParam("fmAlg", next);
    if (st.current.engine !== "ops4") setParam("fmEngine", "ops4");
  }, [setParam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const sparks: Array<{ x: number; y: number; vx: number; life: number; col: string }> = [];

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.86;

      const ops4Live = p.engine === "ops4";
      const levels = [p.op1, p.op2, p.op3, p.op4];
      const ratios = [1, p.r2, p.r3, p.r4];
      const algI = Math.round(clamp(p.alg, 0, 7));
      const routes = ALG_ROUTES[algI] ?? ALG_ROUTES[0]!;
      const energy =
        0.12 +
        (ops4Live ? 0.2 : 0) +
        p.feedback * 0.25 +
        p.vecDepth * 0.3 +
        levels.slice(1).reduce((a, b) => a + b, 0) * 0.08 +
        flashRef.current * 0.25;

      let engT = now / 1000;
      try {
        engT = getEngine().ctx.currentTime;
      } catch { /* */ }

      ctx.clearRect(0, 0, W, Hh);

      // Lattice chamber
      const bg = ctx.createRadialGradient(W * 0.42, Hh * 0.4, 6, W * 0.5, Hh * 0.45, W * 0.82);
      bg.addColorStop(0, hexAlpha(C_HOT, (ops4Live ? 0.12 : 0.04) + energy * 0.3 + flashRef.current * 0.2));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.55));
      bg.addColorStop(1, "rgba(2,7,14,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Soft lattice grid
      ctx.strokeStyle = hexAlpha(C_MID, 0.06 + p.vecDepth * 0.08);
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const gx = W * (0.15 + i * 0.15);
        ctx.beginPath();
        ctx.moveTo(gx, 22);
        ctx.lineTo(gx, Hh * 0.72);
        ctx.stroke();
      }

      // Operator positions — diamond lattice
      const cx = W * 0.38;
      const cy = Hh * 0.42;
      const opPositions = [
        { x: cx, y: cy + 28 }, // Op1 carrier
        { x: cx - 42, y: cy - 8 },
        { x: cx + 42, y: cy - 8 },
        { x: cx, y: cy - 40 },
      ];
      opPosRef.current = opPositions.map((pos, i) => ({
        x: pos.x,
        y: pos.y,
        r: 9 + levels[i]! * 10,
      }));

      // Algorithm cables with flow
      routes.forEach(([from, to]) => {
        const fPos = opPositions[from]!;
        const tPos = opPositions[to]!;
        const modLevel = levels[from]!;
        const alpha = (ops4Live ? 0.3 : 0.12) + modLevel * 0.45;
        ctx.strokeStyle = hexAlpha(C_OP[from] ?? C_MID, alpha);
        ctx.lineWidth = 1.6 + modLevel * 1.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(fPos.x, fPos.y);
        ctx.quadraticCurveTo((fPos.x + tPos.x) / 2, (fPos.y + tPos.y) / 2 - 12, tPos.x, tPos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const flow = ((engT * (0.6 + p.vecRate * 2) + from * 0.25) % 1 + 1) % 1;
        const fx = fPos.x + (tPos.x - fPos.x) * flow;
        const fy = fPos.y + (tPos.y - fPos.y) * flow - Math.sin(flow * Math.PI) * 12;
        ctx.fillStyle = hexAlpha(C_GLOW, modLevel * 0.7 * (ops4Live ? 1 : 0.35));
        ctx.beginPath();
        ctx.arc(fx, fy, 2.5 + modLevel * 2, 0, Math.PI * 2);
        ctx.fill();
      });

      // Feedback loop on carrier
      if (p.feedback > 0.02) {
        const c0 = opPositions[0]!;
        const fbRad = 16 + p.feedback * 14;
        const pulse = 0.5 + 0.5 * Math.sin(engT * (4 + p.feedback * 8));
        ctx.strokeStyle = hexAlpha(C_FB, 0.35 + p.feedback * 0.5);
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(c0.x, c0.y - fbRad * 0.35, fbRad * 0.55, Math.PI * 0.15, Math.PI * 0.85, false);
        ctx.stroke();
        const fbg = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, fbRad * 1.4);
        fbg.addColorStop(0, hexAlpha(C_FB, p.feedback * 0.18 * pulse));
        fbg.addColorStop(1, hexAlpha(C_FB, 0));
        ctx.fillStyle = fbg;
        ctx.beginPath();
        ctx.arc(c0.x, c0.y, fbRad * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Operator orbs + ratio rings
      const focus = focusOpRef.current;
      opPositions.forEach((pos, i) => {
        const lv = levels[i]!;
        const sz = 9 + lv * 10;
        const col = C_OP[i]!;
        const ratioN = i === 0 ? 0 : logNorm(ratios[i]!, RATIO_MIN, RATIO_MAX);

        // Ratio orbit (ops 2–4)
        if (i > 0) {
          const rr = sz + 6 + ratioN * 14;
          ctx.strokeStyle = hexAlpha(col, 0.2 + lv * 0.35 + (ops4Live ? 0.1 : 0));
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, rr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // Ratio tick
          const ang = -Math.PI / 2 + ratioN * Math.PI * 1.6;
          ctx.fillStyle = hexAlpha(C_GLOW, 0.7);
          ctx.beginPath();
          ctx.arc(pos.x + Math.cos(ang) * rr, pos.y + Math.sin(ang) * rr, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, sz * 2.4);
        g.addColorStop(0, hexAlpha(col, (0.45 + lv * 0.4) * (ops4Live ? 1 : 0.45)));
        g.addColorStop(0.55, hexAlpha(col, 0.12));
        g.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sz * 2.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexAlpha(col, 0.75 + lv * 0.2);
        ctx.shadowBlur = 8 + lv * 12 + (focus === i ? 8 : 0);
        ctx.shadowColor = col;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (focus === i) {
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.85);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, sz + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.font = "800 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(6,12,20,0.9)";
        ctx.textAlign = "center";
        ctx.fillText(`${i + 1}`, pos.x, pos.y + 3);

        // Level micro-bar under orb
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(pos.x - 12, pos.y + sz + 5, 24, 3);
        ctx.fillStyle = hexAlpha(col, 0.85);
        ctx.fillRect(pos.x - 12, pos.y + sz + 5, 24 * lv, 3);
      });

      // Vector morph pad (right)
      const vx = W * 0.78;
      const vy = Hh * 0.4;
      const vr = 36;
      ctx.strokeStyle = hexAlpha(C_VEC, 0.25 + p.vecDepth * 0.35);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(vx - vr, vy - vr, vr * 2, vr * 2);
      ctx.beginPath();
      ctx.moveTo(vx - vr, vy);
      ctx.lineTo(vx + vr, vy);
      ctx.moveTo(vx, vy - vr);
      ctx.lineTo(vx, vy + vr);
      ctx.strokeStyle = hexAlpha(C_MID, 0.2);
      ctx.stroke();

      // Orbit trail
      const phase = engT * (0.3 + p.vecRate * 5);
      const vdx = Math.sin(phase) * p.vecDepth * (vr - 4);
      const vdy = Math.cos(phase * 0.87) * p.vecDepth * (vr - 4);
      if (p.vecDepth > 0.02) {
        for (let h = 12; h > 0; h--) {
          const ph = phase - h * 0.15;
          const tx = vx + Math.sin(ph) * p.vecDepth * (vr - 4);
          const ty = vy + Math.cos(ph * 0.87) * p.vecDepth * (vr - 4);
          ctx.fillStyle = hexAlpha(C_VEC, ((12 - h) / 12) * 0.35 * p.vecDepth);
          ctx.beginPath();
          ctx.arc(tx, ty, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Crosshair of current rate/depth setting
      const hx = vx - vr + p.vecRate * vr * 2;
      const hy = vy + vr - p.vecDepth * vr * 2;
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.4 + flashRef.current * 0.3);
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy);
      ctx.lineTo(hx + 6, hy);
      ctx.moveTo(hx, hy - 6);
      ctx.lineTo(hx, hy + 6);
      ctx.stroke();

      ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
      ctx.shadowBlur = 10;
      ctx.shadowColor = C_VEC;
      ctx.beginPath();
      ctx.arc(vx + vdx, vy + vdy, 3.5 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexAlpha(C_VEC, 0.8);
      ctx.textAlign = "center";
      ctx.fillText("VECTOR", vx, vy - vr - 6);

      // Sparks along cables when live
      if (ops4Live && energy > 0.4 && Math.random() < 0.1 + p.feedback * 0.15) {
        const r = routes[Math.floor(Math.random() * routes.length)];
        if (r) {
          const a = opPositions[r[0]]!;
          const b = opPositions[r[1]]!;
          sparks.push({
            x: a.x + (b.x - a.x) * Math.random(),
            y: a.y + (b.y - a.y) * Math.random(),
            vx: (Math.random() - 0.5) * 1.5,
            life: 1,
            col: C_OP[r[0]] ?? C_GLOW,
          });
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= 0.03;
        s.x += s.vx;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = hexAlpha(s.col, s.life * 0.7);
        ctx.fillRect(s.x, s.y, 2, 2);
      }

      // Alg chip
      const algLabel = `ALG ${algI} · ${ALG_NAMES[algI]}`;
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      const chipW = ctx.measureText(algLabel).width + 14;
      const chipX = W * 0.5 - chipW * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(chipX, 6, chipW, 14);
      ctx.strokeStyle = hexAlpha(C_GLOW, 0.5 + flashRef.current * 0.3);
      ctx.strokeRect(chipX, 6, chipW, 14);
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.textAlign = "center";
      ctx.fillText(algLabel, W * 0.5, 16);

      // Engine badge left
      ctx.font = "800 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(ops4Live ? C_GLOW : C_MID, 0.85);
      ctx.fillText(ops4Live ? "4-OP LIVE" : "2-OP · ARM RACK", 12, 16);

      // Feedback rail
      const railY = Hh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(12, railY, W - 24, 7);
      ctx.strokeStyle = hexAlpha(C_FB, 0.25 + p.feedback * 0.4);
      ctx.strokeRect(12.5, railY + 0.5, W - 25, 6);
      if (p.feedback > 0.02) {
        const rg = ctx.createLinearGradient(12, railY, 12 + (W - 24) * p.feedback, railY);
        rg.addColorStop(0, hexAlpha(C_FB, 0.35));
        rg.addColorStop(1, hexAlpha(C_GLOW, 0.8));
        ctx.fillStyle = rg;
        ctx.fillRect(12, railY + 1, (W - 24) * p.feedback, 5);
      }
      ctx.fillStyle = hexAlpha(C_GLOW, 0.95);
      ctx.beginPath();
      ctx.arc(12 + (W - 24) * p.feedback, railY + 3.5, 3.2 + flashRef.current, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexAlpha(C_FB, 0.8);
      ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("FEEDBACK", 14, railY - 3);

      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
      ctx.fillText("RACK · VECTOR LATTICE", 12, Hh - 2);
      ctx.textAlign = "right";
      const status = !ops4Live
        ? "STANDBY"
        : `FB${Math.round(p.feedback * 100)} · V${Math.round(p.vecDepth * 100)}/${Math.round(p.vecRate * 100)}`;
      ctx.fillStyle = hexAlpha(ops4Live ? C_HOT : C_MID, 0.88);
      ctx.fillText(status, W - 12, Hh - 2);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: !!dragRef.current,
        particles: sparks.length,
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
        borderColor: hexAlpha(C, live ? 0.55 : ops4 ? 0.4 : 0.28),
        height: H,
        cursor: "crosshair",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px ${hexAlpha(C, live ? 0.26 : 0.1)}, 0 10px 28px rgba(0,0,0,0.42)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Pad: Vec Rate↔ / Depth↕ · Drag orbs: Level↕ / Ratio↔ · Bottom: Feedback · Double-click: next alg (arms 4-op)"
      role="img"
      aria-label="FM Rack vector lattice"
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
        Vector Lattice
      </div>
      <div
        className="pointer-events-none absolute right-3 top-2 font-mono text-[9px] tabular-nums uppercase"
        style={{ color: hexAlpha(ops4 ? C_HOT : C_MID, 0.78) }}
      >
        {ops4 ? `ALG ${Math.round(alg)}` : "2-OP"}
      </div>
    </div>
  );
}
