/**
 * AutomationLane — draw parameter movement on the pattern timeline (v1.7).
 *
 * One collapsible strip under the piano roll. Pick a target (cutoff, reso,
 * osc A morph, delay/reverb mix, macros), then paint: left-drag sets points
 * on the 16th grid, right-drag erases. The scheduler interpolates between
 * points at play time and drives the ENGINE directly — the patch, presets and
 * undo history never see the sweeps. Lanes are per-section and land in
 * `.kcproj` saves.
 */

import { useEffect, useRef, useState } from "react";
import {
  useFireSequencerStore,
  getPlayheadStep,
  AUTO_PARAMS,
  autoValueAt,
  autoDenorm,
  STEPS_PER_BAR,
  type AutoParamId,
} from "@/state/fireSequencerStore";
import { useUIStore } from "@/state/uiStore";

const LANE_H = 92;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fmtValue(paramId: AutoParamId, n: number): string {
  const def = AUTO_PARAMS.find((d) => d.id === paramId)!;
  const v = autoDenorm(def, n);
  if (def.patchKey === "filterCutoff") {
    return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  }
  if (def.patchKey === "filterResonance") return `Q ${v.toFixed(1)}`;
  return `${Math.round(v * 100)}%`;
}

export function AutomationLane() {
  const automation = useFireSequencerStore((s) => s.automation);
  const bars = useFireSequencerStore((s) => s.bars);
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const setPoint = useFireSequencerStore((s) => s.setAutomationPoint);
  const clearLane = useFireSequencerStore((s) => s.clearAutomationLane);

  const [open, setOpen] = useState(false);
  const [param, setParam] = useState<AutoParamId>("cutoff");
  const [hover, setHover] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // Last painted (step, value) so fast drags fill the gap between events.
  const strokeRef = useRef<{ step: number; val: number; erase: boolean } | null>(null);

  const totalSteps = bars * STEPS_PER_BAR;
  const stepW = totalSteps > 32 ? 16 : 22;
  const gridW = totalSteps * stepW;
  const def = AUTO_PARAMS.find((d) => d.id === param)!;
  const lanesWithData = AUTO_PARAMS.filter((d) => automation[d.id]).length;

  // ── draw ──
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = gridW * dpr;
    canvas.height = LANE_H * dpr;
    canvas.style.width = `${gridW}px`;
    canvas.style.height = `${LANE_H}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, gridW, LANE_H);

    // step + bar grid
    for (let i = 0; i <= totalSteps; i++) {
      const x = i * stepW;
      const isBar = i % STEPS_PER_BAR === 0;
      const isBeat = i % 4 === 0;
      g.strokeStyle = isBar
        ? "rgba(255,150,80,0.28)"
        : isBeat
          ? "rgba(255,255,255,0.10)"
          : "rgba(255,255,255,0.04)";
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, LANE_H);
      g.stroke();
    }
    // horizontal midline
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.beginPath();
    g.moveTo(0, LANE_H / 2 + 0.5);
    g.lineTo(gridW, LANE_H / 2 + 0.5);
    g.stroke();

    const arr = automation[param];
    if (!arr || arr.length === 0) {
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.font = "11px Inter, sans-serif";
      g.fillText(`Draw ${def.label} movement — left-drag paints, right-drag erases`, 10, LANE_H / 2 + 4);
      return;
    }

    const yOf = (n: number) => (1 - clamp(n, 0, 1)) * (LANE_H - 8) + 4;

    // Interpolated curve + soft fill under it, sampled 4× per step.
    g.beginPath();
    let started = false;
    const SUB = 4;
    for (let i = 0; i <= totalSteps * SUB; i++) {
      const pos = i / SUB;
      const n = autoValueAt(arr, Math.min(pos, totalSteps - 0.001));
      if (n == null) continue;
      const x = pos * stepW;
      const y = yOf(n);
      if (!started) { g.moveTo(x, y); started = true; }
      else g.lineTo(x, y);
    }
    if (started) {
      g.strokeStyle = def.color;
      g.lineWidth = 1.8;
      g.stroke();
      g.lineTo(gridW, LANE_H);
      g.lineTo(0, LANE_H);
      g.closePath();
      g.fillStyle = `${def.color}22`;
      g.fill();
    }

    // Point markers
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (n == null) continue;
      g.beginPath();
      g.arc(i * stepW + stepW / 2, yOf(n), 3.2, 0, Math.PI * 2);
      g.fillStyle = def.color;
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 1;
      g.stroke();
    }
  }, [open, automation, param, gridW, totalSteps, stepW, def]);

  // ── playhead (RAF, DOM transform — same pattern as the drum grid) ──
  useEffect(() => {
    const el = playheadRef.current;
    if (!el || !open) return;
    if (!playing) { el.style.opacity = "0"; return; }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const step = getPlayheadStep(bpm, bars);
      el.style.opacity = step < 0 ? "0" : "1";
      el.style.transform = `translateX(${Math.max(0, step) * stepW}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, bpm, bars, stepW]);

  // ── paint ──
  const paintAt = (e: React.PointerEvent, erase: boolean) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const step = clamp(Math.floor((e.clientX - rect.left) / stepW), 0, totalSteps - 1);
    const val = clamp(1 - (e.clientY - rect.top - 4) / (LANE_H - 8), 0, 1);
    const prev = strokeRef.current;
    if (prev && prev.erase === erase && Math.abs(step - prev.step) > 1) {
      // Fill skipped steps so fast strokes stay continuous.
      const dir = step > prev.step ? 1 : -1;
      for (let i = prev.step + dir; i !== step; i += dir) {
        const t = (i - prev.step) / (step - prev.step);
        setPoint(param, i, erase ? null : prev.val + (val - prev.val) * t);
      }
    }
    setPoint(param, step, erase ? null : val);
    strokeRef.current = { step, val, erase };
    setHover(erase ? "erasing" : fmtValue(param, val));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    paintAt(e, e.button === 2);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!strokeRef.current) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const val = clamp(1 - (e.clientY - rect.top - 4) / (LANE_H - 8), 0, 1);
        setHover(fmtValue(param, val));
      }
      return;
    }
    paintAt(e, strokeRef.current.erase);
  };
  const onPointerUp = () => { strokeRef.current = null; };

  return (
    <div className="mt-2">
      {/* header row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-dim hover:text-white/70 transition"
          title="Automation: draw knob movement on the timeline — cutoff sweeps, morphs, FX sends. Per-section, plays back on Synth A."
        >
          <span>{open ? "▾" : "▸"} Automation</span>
          {lanesWithData > 0 && (
            <span className="text-[9px] font-mono normal-case tracking-normal px-1.5 py-0.5 rounded border border-white/12 text-white/50">
              {lanesWithData} lane{lanesWithData === 1 ? "" : "s"}
            </span>
          )}
        </button>
        {open && (
          <>
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            {AUTO_PARAMS.map((d) => (
              <button
                key={d.id}
                onClick={() => setParam(d.id)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition ${
                  param === d.id
                    ? "border-white/25 bg-white/[0.08]"
                    : "border-white/8 bg-white/[0.02] text-white/45 hover:bg-white/[0.06]"
                }`}
                style={param === d.id ? { color: d.color } : undefined}
                title={`Automate ${d.label} (Synth A)`}
              >
                {automation[d.id] && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                    style={{ background: d.color }}
                  />
                )}
                {d.label}
              </button>
            ))}
            <span className="flex-1" />
            {hover && <span className="text-[10px] font-mono text-white/45">{hover}</span>}
            {automation[param] && (
              <button
                onClick={() => {
                  clearLane(param);
                  useUIStore.getState().toast(`${def.label} lane cleared (Ctrl+Z restores)`);
                }}
                className="px-2 py-0.5 rounded-md text-[10px] border border-white/8 text-white/40 hover:text-rose-300 hover:border-rose-400/40 transition"
                title="Clear this lane in the active section"
              >
                ✕ Clear lane
              </button>
            )}
          </>
        )}
      </div>

      {open && (
        <div className="mt-1.5 overflow-x-auto rounded-xl border border-white/10 bg-black/45">
          <div className="relative" style={{ width: gridW, height: LANE_H }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => { if (!strokeRef.current) setHover(null); }}
              onContextMenu={(e) => e.preventDefault()}
              className="block touch-none select-none cursor-crosshair"
              aria-label={`Automation lane for ${def.label} — drag to draw, right-drag to erase`}
            />
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px pointer-events-none opacity-0"
              style={{
                background: "linear-gradient(180deg, rgba(255,220,150,0.9), rgba(255,110,50,0.65))",
                boxShadow: "0 0 8px rgba(255,140,60,0.8)",
                willChange: "transform",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
