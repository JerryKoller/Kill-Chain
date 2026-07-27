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
import { useRollFit } from "./useRollFit";

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

  const lanesWithData = AUTO_PARAMS.filter((d) => automation[d.id]).length;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      if (window.localStorage.getItem("killchain.fire.autoOpen") === "1") return true;
    } catch { /* ignore */ }
    return false;
  });
  const [param, setParam] = useState<AutoParamId>("cutoff");
  const [hover, setHover] = useState<string | null>(null);

  // Open when any lane has data, or once on first Sequencer visit.
  useEffect(() => {
    if (lanesWithData > 0) {
      setOpen(true);
      return;
    }
    try {
      if (window.localStorage.getItem("killchain.fire.autoOpen") !== "1") {
        setOpen(true);
        window.localStorage.setItem("killchain.fire.autoOpen", "1");
      }
    } catch { /* ignore */ }
  }, [lanesWithData]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // Last painted (step, value) so fast drags fill the gap between events.
  const strokeRef = useRef<{ step: number; val: number; erase: boolean } | null>(null);

  const { cellW: stepW, gridW, gutter, fitMode } = useRollFit();
  const totalSteps = bars * STEPS_PER_BAR;
  const def = AUTO_PARAMS.find((d) => d.id === param)!;

  // Collapsed Cutoff preview sparkline (normalized points).
  const cutoffPreview = automation.cutoff ?? null;

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

    // Match piano-roll stage + gutter so timelines share an edge
    g.fillStyle = "rgba(10,12,18,1)";
    g.fillRect(0, 0, gridW, LANE_H);
    g.fillStyle = "rgba(8,6,10,0.96)";
    g.fillRect(0, 0, gutter, LANE_H);
    g.fillStyle = "rgba(255,120,60,0.45)";
    g.fillRect(gutter - 2, 0, 2, LANE_H);

    // step + bar grid (gutter-aligned with the piano roll)
    for (let i = 0; i <= totalSteps; i++) {
      const x = gutter + i * stepW;
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
    g.moveTo(gutter, LANE_H / 2 + 0.5);
    g.lineTo(gridW, LANE_H / 2 + 0.5);
    g.stroke();

    const arr = automation[param];
    if (!arr || arr.length === 0) {
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.font = "11px ui-sans-serif, system-ui, sans-serif";
      g.fillText(`Draw ${def.label} — left-drag paints, right-drag erases`, gutter + 10, LANE_H / 2 + 4);
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
      const x = gutter + pos * stepW;
      const y = yOf(n);
      if (!started) { g.moveTo(x, y); started = true; }
      else g.lineTo(x, y);
    }
    if (started) {
      g.strokeStyle = def.color;
      g.lineWidth = 1.8;
      g.stroke();
      g.lineTo(gridW, LANE_H);
      g.lineTo(gutter, LANE_H);
      g.closePath();
      g.fillStyle = `${def.color}22`;
      g.fill();
    }

    // Point markers
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (n == null) continue;
      g.beginPath();
      g.arc(gutter + i * stepW + stepW / 2, yOf(n), 3.2, 0, Math.PI * 2);
      g.fillStyle = def.color;
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 1;
      g.stroke();
    }
  }, [open, automation, param, gridW, totalSteps, stepW, gutter, def]);

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
      el.style.transform = `translateX(${gutter + Math.max(0, step) * stepW}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, bpm, bars, stepW, gutter]);

  // ── paint ──
  const paintAt = (e: React.PointerEvent, erase: boolean) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < gutter) return;
    const step = clamp(Math.floor((x - gutter) / stepW), 0, totalSteps - 1);
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
          title="Automation: draw knob movement on the timeline — cutoff sweeps, morphs, FX sends. Per-section, plays back on Synth A. Live engine only — restores to the patch on stop."
        >
          <span>{open ? "▾" : "▸"} Automation</span>
          {lanesWithData > 0 && (
            <span className="text-[9px] font-mono normal-case tracking-normal px-1.5 py-0.5 rounded border border-white/12 text-white/50">
              {lanesWithData} lane{lanesWithData === 1 ? "" : "s"}
            </span>
          )}
        </button>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left"
            title="Open automation — draw cutoff motion"
          >
            <span className="text-[10px] text-white/40 normal-case tracking-normal shrink-0">
              {cutoffPreview ? "Cutoff motion" : "draw motion"}
            </span>
            <svg
              width="120"
              height="14"
              viewBox="0 0 120 14"
              className="opacity-80"
              aria-hidden
            >
              <path
                d={cutoffSparkPath(cutoffPreview, totalSteps)}
                fill="none"
                stroke="rgba(255,140,60,0.85)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
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
            <span className="text-[9px] text-white/30 normal-case tracking-normal" title="Automation drives the live engine; the patch restores on stop">
              live → restores on stop
            </span>
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
        <div className={`mt-1.5 rounded-xl border border-white/12 bg-[#0a0c12] ${
          fitMode ? "overflow-hidden" : "overflow-x-auto"
        }`}>
          <div className="relative" style={{ width: gridW, height: LANE_H, minWidth: "100%" }}>
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

function cutoffSparkPath(arr: (number | null)[] | null | undefined, totalSteps: number): string {
  const w = 120;
  const h = 14;
  if (!arr || arr.length === 0) {
    // Gentle invitation curve when empty
    return `M 2 ${h * 0.65} Q ${w * 0.35} ${h * 0.2}, ${w * 0.55} ${h * 0.55} T ${w - 2} ${h * 0.4}`;
  }
  const pts: string[] = [];
  const n = Math.max(totalSteps, arr.length);
  for (let i = 0; i < n; i++) {
    const v = autoValueAt(arr, i);
    const y = v == null ? h * 0.5 : (1 - clamp(v, 0, 1)) * (h - 4) + 2;
    const x = (i / Math.max(1, n - 1)) * (w - 4) + 2;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}
