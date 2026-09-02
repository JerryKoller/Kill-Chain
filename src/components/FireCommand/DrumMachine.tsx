/**
 * DrumMachine — Drum Bay Clarity: rich steps, playhead beam, inspectors,
 * Pattern vs Kit, fills, Feel Grain, Sample Deck parity.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DRUM_LANES, type DrumLane } from "@/audio/dsp/FireDrumKit";
import {
  useFireSequencerStore,
  getPlayheadStep,
  STEPS_PER_BAR,
  MAX_SAMPLE_LANES,
  DRUM_GROOVE_OPTIONS,
  type DrumStep,
  type FillPersonality,
  type DrumFeel,
} from "@/state/fireSequencerStore";
import {
  coerceDrumStep,
  DEFAULT_LANE_MIX,
  emptyStep,
  isStepOn,
  laneLocalStep,
  onStep,
  stepVel,
} from "./drumClarity";
import { getEngine } from "@/audio/AudioEngine";
import { useUIStore } from "@/state/uiStore";
import { FIRE_CLIP_KIND, readFireClipboard } from "@/lib/fireClipboard";
import { PatternBarsControls } from "./PatternBarsControls";
import { ScopedPlayButton } from "./ScopedPlayButton";
import { PatternSelect } from "./PatternSelect";
import { EditorToolbarGroup, EditorToolbarDivider } from "./EditorShell";
import { useFireCollapsed } from "./useFireCollapsed";
import { CollapseToggle } from "./CollapseToggle";

const LABEL_W = 92;
const TOOLS_W = 96;

const FILL_PERSONAS: { id: FillPersonality; label: string }[] = [
  { id: "snareRoll", label: "Snare roll" },
  { id: "tomDescent", label: "Tom descent" },
  { id: "kickBurst", label: "Kick burst" },
  { id: "hatRush", label: "Hat rush" },
  { id: "breakbeat", label: "Breakbeat" },
  { id: "trap", label: "Trap" },
  { id: "minimal", label: "Minimal" },
];

const FEEL_OPTS: { id: DrumFeel; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "pocket", label: "Pocket" },
  { id: "loose", label: "Loose" },
  { id: "drunk", label: "Drunk" },
];

type StepInspect = { kind: "drum"; lane: DrumLane; step: number } | { kind: "sample"; id: string; step: number } | null;
type PaintMode = { value: DrumStep } | null;

function beatLabel(s: number): string {
  if (s % STEPS_PER_BAR === 0) return String(Math.floor(s / STEPS_PER_BAR) + 1);
  if (s % 4 === 0) return "";
  return "";
}

export function DrumMachine() {
  const drums = useFireSequencerStore((s) => s.drums);
  const fillPreview = useFireSequencerStore((s) => s.drumFillPreview);
  const bars = useFireSequencerStore((s) => s.bars);
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const follow = useFireSequencerStore((s) => s.drumFollowPlayhead !== false);
  const setFollow = useFireSequencerStore((s) => s.setDrumFollowPlayhead);
  const locks = useFireSequencerStore((s) => s.drumLaneLocks) ?? {};
  const laneMix = useFireSequencerStore((s) => s.drumLaneMix) ?? {};
  const drumSamples = useFireSequencerStore((s) => s.drumSamples);
  const fillIntensity = useFireSequencerStore((s) => s.drumFillIntensity) ?? 0.55;
  const fillPersonality = useFireSequencerStore((s) => s.drumFillPersonality) ?? "snareRoll";
  const fillAuto = useFireSequencerStore((s) => s.drumFillAuto);
  const hatChoke = useFireSequencerStore((s) => s.drumHatChoke !== false);
  const kickPol = useFireSequencerStore((s) => s.drumKickPolarity) ?? 1;
  const toast = useUIStore((s) => s.toast);

  const [playStep, setPlayStep] = useState(-1);
  const playStepRef = useRef(-1);
  const playheadBeamRef = useRef<HTMLDivElement>(null);
  const [inspect, setInspect] = useState<StepInspect>(null);
  const [expandedLane, setExpandedLane] = useState<DrumLane | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const [laneMenu, setLaneMenu] = useState<DrumLane | null>(null);
  const [grooveOpen, setGrooveOpen] = useState(false);
  const [activeGroove, setActiveGroove] = useState<string | null>(null);
  const paintRef = useRef<PaintMode>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  const displayDrums = fillPreview ?? drums;
  const totalSteps = bars * STEPS_PER_BAR;

  useEffect(() => {
    void useFireSequencerStore.getState().hydrateSamples();
  }, []);

  useEffect(() => {
    if (!playing) {
      setPlayStep(-1);
      playStepRef.current = -1;
      const el = playheadBeamRef.current;
      if (el) el.style.opacity = "0";
      return;
    }
    let raf = 0;
    let last = -2;
    let lastLabel = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const step = Math.floor(getPlayheadStep(bpm, bars));
      if (step === last) return;
      last = step;
      playStepRef.current = step;
      // Move the beam via DOM — avoid re-rendering every drum cell each step.
      const playheadEl = playheadBeamRef.current;
      if (playheadEl) {
        if (step < 0) {
          playheadEl.style.opacity = "0";
        } else {
          playheadEl.style.opacity = "1";
          playheadEl.style.left = `calc(${LABEL_W}px + 0.5rem + (100% - ${LABEL_W}px - ${TOOLS_W}px - 1rem) * ${step / totalSteps})`;
          playheadEl.style.width = `calc((100% - ${LABEL_W}px - ${TOOLS_W}px - 1rem) / ${totalSteps})`;
        }
      }
      // Beat readout ~8 Hz is enough.
      if (t - lastLabel > 120) {
        lastLabel = t;
        setPlayStep(step);
      }
      if (follow && gridScrollRef.current && step >= 0) {
        const el = gridScrollRef.current;
        const cell = el.scrollWidth / Math.max(1, totalSteps);
        const playX = step * cell;
        const viewL = el.scrollLeft;
        const viewR = viewL + el.clientWidth;
        if (playX < viewL + cell || playX > viewR - cell * 2) {
          el.scrollLeft = Math.max(0, playX - el.clientWidth * 0.45);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, bpm, bars, totalSteps, follow]);

  // Auto fill on last bar entry
  const lastBarEntered = useRef(false);
  useEffect(() => {
    if (!playing || !fillAuto) { lastBarEntered.current = false; return; }
    const lastStart = totalSteps - STEPS_PER_BAR;
    if (playStep >= lastStart && playStep < totalSteps) {
      if (!lastBarEntered.current) {
        lastBarEntered.current = true;
        useFireSequencerStore.getState().generateDrumFill({ preview: true });
        setFillOpen(true);
      }
    } else {
      lastBarEntered.current = false;
    }
  }, [playStep, playing, fillAuto, totalSteps]);

  useEffect(() => {
    const up = () => { paintRef.current = null; };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // Dismiss fill / lane / groove menus on outside click
  useEffect(() => {
    if (!fillOpen && !laneMenu && !grooveOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-drum-popover]")) return;
      setFillOpen(false);
      setLaneMenu(null);
      setGrooveOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [fillOpen, laneMenu, grooveOpen]);

  const audition = (lane: DrumLane) => {
    const eng = getEngine();
    void eng.resume();
    eng.fireDrums.trigger(lane, eng.ctx.currentTime, 1, {
      pan: laneMix[lane]?.pan ?? 0,
      polarity: lane === "kick" ? kickPol : 1,
    });
  };

  const setStep = useFireSequencerStore((s) => s.setDrumStep);

  const onCellDown = (
    lane: DrumLane,
    step: number,
    cell: DrumStep,
    e: ReactPointerEvent,
  ) => {
    // Piano-roll style: right-click (hold) erases across cells.
    if (e.button === 2) {
      e.preventDefault();
      const blank = emptyStep();
      if (isStepOn(cell)) setStep(lane, step, blank);
      paintRef.current = { value: blank };
      return;
    }
    if (e.detail === 2) {
      setInspect({ kind: "drum", lane, step });
      return;
    }
    const vel = stepVel(cell);
    if (e.shiftKey && vel > 0) {
      const next = vel > 0.85 ? 0.7 : vel > 0.55 ? 0.4 : 1;
      const st = onStep(next, { accent: next > 0.85 });
      setStep(lane, step, st);
      paintRef.current = { value: st };
      return;
    }
    if (e.altKey && vel > 0) {
      const st = { ...cell, prob: Math.max(0.1, Math.min(1, (cell.prob ?? 1) - 0.2)) };
      setStep(lane, step, st);
      paintRef.current = { value: st };
      return;
    }
    if ((e.ctrlKey || e.metaKey) && vel > 0) {
      const st = { ...cell, micro: Math.max(-1, Math.min(1, (cell.micro ?? 0) + 0.15)) };
      setStep(lane, step, st);
      paintRef.current = { value: st };
      return;
    }
    const next = vel > 0 ? emptyStep() : onStep(1);
    setStep(lane, step, next);
    paintRef.current = { value: next };
    if (next.vel > 0) audition(lane);
  };

  const onCellEnter = (lane: DrumLane, step: number, cell: DrumStep) => {
    const paint = paintRef.current;
    if (!paint) return;
    if (isStepOn(paint.value) !== isStepOn(cell)) setStep(lane, step, paint.value);
  };

  const beatReadout = playStep < 0
    ? "idle"
    : `${Math.floor(playStep / STEPS_PER_BAR) + 1}.${Math.floor((playStep % STEPS_PER_BAR) / 4) + 1}.${(playStep % STEPS_PER_BAR) + 1}`;

  return (
    <div className="select-none w-full min-w-0 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-[#12151c] via-[#0c0e14] to-[#090b10] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="editor-toolbar mb-2 rounded-xl border border-white/[0.06] bg-black/20 px-1 py-1">
        <EditorToolbarGroup>
          <ScopedPlayButton
            scope="pattern"
            accent="#fbbf24"
            title="Play / pause this pattern only"
          />
          <PatternSelect accent="#fbbf24" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase tracking-[0.1em] text-amber-200/90">Drum Bay</div>
            <div className="text-[10px] text-white/50 mt-0.5 font-mono tabular-nums whitespace-nowrap">
              {bars}×{STEPS_PER_BAR} · {totalSteps}st · {beatReadout}
            </div>
          </div>
        </EditorToolbarGroup>
        <EditorToolbarDivider />
        <EditorToolbarGroup label="Length" className="shrink-0">
          <PatternBarsControls accent="#fbbf24" />
          <label className="flex items-center gap-1.5 text-[10px] text-white/60 cursor-pointer h-8 px-1.5 rounded-md hover:bg-white/[0.04] shrink-0">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-amber-400" />
            Follow
          </label>
        </EditorToolbarGroup>
        <span className="flex-1 min-w-[8px]" />
        <EditorToolbarGroup>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              useFireSequencerStore.getState().generateDrumFill({ preview: true, intensity: fillIntensity, personality: fillPersonality });
              toast("Fill preview — Accept to commit, or Regenerate");
              setFillOpen(true);
            }}
            onContextMenu={(e) => { e.preventDefault(); setFillOpen((v) => !v); }}
            className="h-8 px-2.5 rounded-lg border border-amber-400/45 bg-amber-400/10 text-amber-200 text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-amber-400/20 transition"
            title="Fill last bar — right-click for intensity / personality"
          >
            Fill last bar
          </button>
          {fillOpen && (
            <div data-drum-popover="1" className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-white/18 bg-[#0c0c12] p-2 shadow-[0_12px_32px_rgba(0,0,0,0.85)]">
              <div className="text-[8px] font-black uppercase tracking-wider text-white/40 mb-1">Fill intensity</div>
              <input
                type="range" min={0} max={1} step={0.01} value={fillIntensity}
                onChange={(e) => useFireSequencerStore.getState().setDrumFillIntensity(Number(e.target.value))}
                className="w-full accent-amber-400 mb-2"
              />
              <div className="text-[8px] font-black uppercase tracking-wider text-white/40 mb-1">Personality</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {FILL_PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => useFireSequencerStore.getState().setDrumFillPersonality(p.id)}
                    className={`rounded border px-1.5 py-0.5 text-[8px] ${
                      fillPersonality === p.id ? "border-amber-400/50 text-amber-100 bg-amber-400/15" : "border-white/10 text-white/50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-[9px] text-white/55 mb-2">
                <input
                  type="checkbox"
                  checked={!!fillAuto}
                  onChange={(e) => useFireSequencerStore.getState().setDrumFillAuto(e.target.checked)}
                  className="accent-amber-400"
                />
                Auto on last bar (preview)
              </label>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="rounded border border-emerald-400/40 px-2 py-1 text-[9px] text-emerald-200" onClick={() => { useFireSequencerStore.getState().acceptDrumFillPreview(); setFillOpen(false); toast("Fill committed"); }}>Accept</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] text-white/70" onClick={() => useFireSequencerStore.getState().generateDrumFill({ preview: true })}>Regenerate</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] text-white/50" onClick={() => { useFireSequencerStore.getState().revertDrumFillPreview(); setFillOpen(false); }}>Revert</button>
              </div>
            </div>
          )}
        </div>
        </EditorToolbarGroup>
      </div>

      {/* Pattern presets vs Kit */}
      <div className="mb-2.5 editor-toolbar">
        <EditorToolbarGroup label="Pattern presets">
          <div className="relative">
            <button
              type="button"
              onClick={() => setGrooveOpen((v) => !v)}
              className="h-8 px-2.5 rounded-lg border border-white/12 bg-white/[0.04] text-[10px] font-bold uppercase tracking-[0.06em] text-white/75 hover:text-amber-200 hover:border-amber-400/40 transition inline-flex items-center gap-1.5 max-w-[11rem]"
              title="Load a drum groove preset — locked lanes are kept"
              aria-haspopup="listbox"
              aria-expanded={grooveOpen}
            >
              <span className="truncate">
                {activeGroove
                  ? (DRUM_GROOVE_OPTIONS.find((o) => o.id === activeGroove)?.label ?? activeGroove)
                  : "Grooves"}
              </span>
              <span aria-hidden className="text-white/40 shrink-0">▾</span>
            </button>
            {grooveOpen && (
              <div
                data-drum-popover="1"
                role="listbox"
                aria-label="Drum groove presets"
                className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-white/18 bg-[#0c0c12] py-1 shadow-xl"
              >
                {DRUM_GROOVE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={activeGroove === opt.id}
                    className={`block w-full px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-white/10 ${
                      activeGroove === opt.id ? "text-amber-200 bg-amber-400/10" : "text-white/78"
                    }`}
                    onClick={() => {
                      useFireSequencerStore.getState().applyDrumGroove(opt.id);
                      setActiveGroove(opt.id);
                      toast(`${opt.label} pattern loaded (locked lanes kept)`);
                      setGrooveOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <div className="my-1 border-t border-white/10" />
                <button
                  type="button"
                  className="block w-full px-2.5 py-1.5 text-left text-[11px] font-semibold text-rose-300/90 hover:bg-rose-500/15"
                  onClick={() => {
                    useFireSequencerStore.getState().applyDrumGroove("clear");
                    setActiveGroove(null);
                    toast("Cleared unlocked lanes (locks kept)");
                    setGrooveOpen(false);
                  }}
                >
                  Clear unlocked
                </button>
              </div>
            )}
          </div>
        </EditorToolbarGroup>
        <EditorToolbarDivider />
        <EditorToolbarGroup label="Kit">
          {(() => {
            const sampleCount = Object.keys(drumSamples ?? {}).length;
            const usingSynth = sampleCount === 0;
            return (
              <button
                type="button"
                onClick={() => {
                  useFireSequencerStore.getState().clearDrumKitSamples();
                  audition("kick");
                  toast(
                    sampleCount > 0
                      ? `Cleared ${sampleCount} lane sample${sampleCount === 1 ? "" : "s"} — using Synth Kit`
                      : "Already on Synth Kit — synthesized drums (no samples)",
                  );
                }}
                className={`h-8 px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-[0.06em] transition border ${
                  usingSynth
                    ? "border-amber-400/55 bg-amber-400/18 text-amber-100"
                    : "border-white/14 bg-white/[0.04] text-white/65 hover:border-amber-400/40 hover:text-amber-200"
                }`}
                title={
                  usingSynth
                    ? "Synth Kit active — built-in synthesized drums (no sample overrides)"
                    : `Restore Synth Kit — clear ${sampleCount} loaded lane sample${sampleCount === 1 ? "" : "s"}`
                }
                aria-pressed={usingSynth}
              >
                Synth Kit{usingSynth ? "" : ` · ${sampleCount}`}
              </button>
            );
          })()}
        </EditorToolbarGroup>
        <EditorToolbarDivider />
        <EditorToolbarGroup label="Transform">
          {(["rotate", "reverse", "invert"] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => useFireSequencerStore.getState().transformAllDrums(op)}
              className="h-8 px-2 rounded-lg border border-white/12 text-[10px] uppercase text-white/55 hover:text-white/85 hover:bg-white/[0.05] transition"
              title={`${op} all unlocked lanes`}
              aria-label={`${op} unlocked drum lanes`}
            >
              {op}
            </button>
          ))}
        </EditorToolbarGroup>
      </div>

      {fillPreview && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-amber-400/40 bg-amber-400/[0.07] px-2 py-1.5 text-[9px] text-amber-100/80">
          <span className="flex-1 min-w-[10rem]">Fill preview (last bar striped) — not yet in audio until Accept</span>
          <button
            type="button"
            className="rounded border border-emerald-400/40 px-2 py-0.5 text-emerald-200"
            onClick={() => { useFireSequencerStore.getState().acceptDrumFillPreview(); setFillOpen(false); toast("Fill committed"); }}
          >Accept</button>
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-0.5 text-white/70"
            onClick={() => useFireSequencerStore.getState().generateDrumFill({ preview: true })}
          >Regenerate</button>
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-0.5 text-white/50"
            onClick={() => { useFireSequencerStore.getState().revertDrumFillPreview(); setFillOpen(false); }}
          >Revert</button>
        </div>
      )}

      <div ref={gridScrollRef} className="overflow-x-auto min-w-0">
        <div className="min-w-[520px]">
          {/* Column chrome */}
          <div
            className="grid gap-2 items-center mb-1.5"
            style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) ${TOOLS_W}px` }}
          >
            <div className="text-[8px] uppercase tracking-[0.18em] text-white/45 pl-1">Lane</div>
            <div className="relative">
              <div
                className="grid gap-[3px]"
                style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(var(--drum-step-min, 18px), var(--drum-step-max, 36px)))`, justifyContent: "start" }}
              >
                {Array.from({ length: totalSteps }, (_, s) => {
                  const q = s % 4 === 0;
                  const bar = s % STEPS_PER_BAR === 0;
                  return (
                    <div
                      key={s}
                      className="text-center text-[8px] leading-3 font-mono truncate border-l"
                      style={{
                        color: bar ? "rgba(255,150,80,0.95)" : q ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.22)",
                        borderColor: bar ? "rgba(255,150,80,0.45)" : q ? "rgba(255,255,255,0.18)" : "transparent",
                      }}
                    >
                      {beatLabel(s)}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-[8px] uppercase tracking-[0.18em] text-white/45 text-right pr-1">M / S</div>
          </div>

          <div className="relative space-y-1">
            {/* Full-height playhead beam (DOM-updated while playing — no per-cell re-render) */}
            <div
              ref={playheadBeamRef}
              className="pointer-events-none absolute top-0 bottom-0 z-20 opacity-0"
              style={{
                width: `calc((100% - ${LABEL_W}px - ${TOOLS_W}px - 1rem) / ${totalSteps})`,
                background: "linear-gradient(90deg, transparent, rgba(255,160,70,0.22), transparent)",
                boxShadow: "inset 0 0 0 1.5px rgba(255,170,80,0.85), 0 0 14px rgba(255,140,60,0.35)",
                borderRadius: 4,
              }}
            />

            {DRUM_LANES.map((lane) => (
              <DrumRow
                key={lane.id}
                laneId={lane.id}
                name={drumSamples[lane.id]?.name ?? lane.name}
                isSample={!!drumSamples[lane.id]}
                color={lane.color}
                steps={displayDrums.steps[lane.id]}
                totalSteps={totalSteps}
                playStep={-1}
                preview={!!fillPreview}
                locked={!!locks[lane.id]}
                mix={laneMix[lane.id] ?? DEFAULT_LANE_MIX()}
                expanded={expandedLane === lane.id}
                menuOpen={laneMenu === lane.id}
                linkedOhat={lane.id === "chat" && hatChoke}
                onToggleExpand={() => setExpandedLane((v) => (v === lane.id ? null : lane.id))}
                onToggleMenu={() => setLaneMenu((v) => (v === lane.id ? null : lane.id))}
                onDown={onCellDown}
                onEnter={onCellEnter}
                onContextStep={(step) => setInspect({ kind: "drum", lane: lane.id, step })}
                onAudition={audition}
              />
            ))}
          </div>
        </div>
      </div>

      {expandedLane && (
        <LaneInspector
          lane={expandedLane}
          mix={laneMix[expandedLane] ?? DEFAULT_LANE_MIX()}
          locked={!!locks[expandedLane]}
          isSample={!!drumSamples[expandedLane]}
          hatChoke={hatChoke}
          kickPol={kickPol}
          onClose={() => setExpandedLane(null)}
        />
      )}

      {inspect && (
        <StepInspector
          target={inspect}
          onClose={() => setInspect(null)}
        />
      )}

      <div className="mt-2.5 text-[9px] text-white/45 leading-relaxed">
        Click toggle · drag paint · Shift accent · Alt probability · Ctrl/Cmd micro · double-click inspect · right-click step · lane name expands inspector
      </div>

      <SampleDeck
        totalSteps={totalSteps}
        playStep={-1}
        onInspect={(id, step) => setInspect({ kind: "sample", id, step })}
      />
    </div>
  );
}

function LaneInspector({
  lane, mix, locked, isSample, hatChoke, kickPol, onClose,
}: {
  lane: DrumLane;
  mix: ReturnType<typeof DEFAULT_LANE_MIX>;
  locked: boolean;
  isSample: boolean;
  hatChoke: boolean;
  kickPol: 1 | -1;
  onClose: () => void;
}) {
  const setMix = useFireSequencerStore((s) => s.setDrumLaneMix);
  const toggleLock = useFireSequencerStore((s) => s.toggleDrumLaneLock);
  const meta = DRUM_LANES.find((l) => l.id === lane)!;
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: meta.color }}>
          {meta.name} inspector {isSample ? "· Sample" : "· Synth Kit"}
        </div>
        <button type="button" className="text-[9px] text-white/40 hover:text-white/70" onClick={onClose}>Close</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-[8px] uppercase text-white/40">
          Level
          <input type="range" min={0} max={1.5} step={0.01} value={mix.level}
            onChange={(e) => setMix(lane, { level: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-400" />
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Pan
          <input type="range" min={-1} max={1} step={0.01} value={mix.pan}
            onChange={(e) => setMix(lane, { pan: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-400" />
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Length (0=full)
          <input type="range" min={0} max={128} step={1} value={mix.length}
            onChange={(e) => setMix(lane, { length: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-400" />
          <span className="font-mono text-[9px] text-white/50">{mix.length || "pattern"}</span>
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Rate
          <select
            value={mix.rate}
            onChange={(e) => setMix(lane, { rate: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-1 py-1 text-[10px] text-white/80"
          >
            <option value={0.5}>½</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>
      {/* Per-lane groove. Global swing moved the whole kit together, so
          shuffled hats over a straight kick were impossible; flam adds the
          grace hit a step grid otherwise can't express. */}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-[8px] uppercase text-white/40">
          Lane swing
          <input type="range" min={-0.3} max={0.3} step={0.01} value={mix.swing ?? 0}
            onChange={(e) => setMix(lane, { swing: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-400"
            title="Offsets this lane's off-beats against the global drum swing. Negative = pushed early." />
          <span className="font-mono text-[9px] text-white/50">
            {(mix.swing ?? 0) === 0 ? "global" : `${(mix.swing ?? 0) > 0 ? "+" : ""}${Math.round((mix.swing ?? 0) * 100)}%`}
          </span>
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Flam
          <input type="range" min={0} max={0.5} step={0.01} value={mix.flam ?? 0}
            onChange={(e) => setMix(lane, { flam: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-400"
            title="Grace hit before each main hit, as a fraction of a 16th" />
          <span className="font-mono text-[9px] text-white/50">
            {(mix.flam ?? 0) === 0 ? "off" : `${Math.round((mix.flam ?? 0) * 100)}%`}
          </span>
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Flam level
          <input type="range" min={0} max={1} step={0.01} value={mix.flamVel ?? 0.55}
            onChange={(e) => setMix(lane, { flamVel: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-400"
            disabled={(mix.flam ?? 0) === 0} />
          <span className="font-mono text-[9px] text-white/50">
            {Math.round((mix.flamVel ?? 0.55) * 100)}%
          </span>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[8px] uppercase text-white/40">Feel</span>
        {FEEL_OPTS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setMix(lane, { feel: f.id })}
            className={`rounded border px-1.5 py-0.5 text-[8px] ${
              mix.feel === f.id ? "border-amber-400/45 text-amber-100 bg-amber-400/15" : "border-white/12 text-white/45"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMix(lane, { direction: mix.direction === 1 ? -1 : 1 })}
          className="rounded border border-white/12 px-1.5 py-0.5 text-[8px] text-white/55"
        >
          Dir {mix.direction === 1 ? "→" : "←"}
        </button>
        <button
          type="button"
          onClick={() => toggleLock(lane)}
          className={`rounded border px-1.5 py-0.5 text-[8px] font-bold ${
            locked ? "border-amber-400/50 text-amber-100" : "border-white/12 text-white/45"
          }`}
        >
          {locked ? "LOCKED" : "Lock"}
        </button>
        {lane === "chat" && (
          <label className="flex items-center gap-1 text-[8px] text-white/50">
            <input type="checkbox" checked={hatChoke} onChange={(e) => useFireSequencerStore.getState().setDrumHatChoke(e.target.checked)} className="accent-amber-400" />
            Choke Open Hat
          </label>
        )}
        {lane === "kick" && (
          <button
            type="button"
            onClick={() => useFireSequencerStore.getState().setDrumKickPolarity(kickPol === 1 ? -1 : 1)}
            className="rounded border border-white/12 px-1.5 py-0.5 text-[8px] text-white/55"
          >
            Polarity {kickPol === 1 ? "+" : "−"}
          </button>
        )}
      </div>
    </div>
  );
}

function StepInspector({ target, onClose }: { target: Exclude<StepInspect, null>; onClose: () => void }) {
  const drums = useFireSequencerStore((s) => s.drums);
  const samples = useFireSequencerStore((s) => s.samples);
  const patchDrum = useFireSequencerStore((s) => s.patchDrumStep);
  const setSample = useFireSequencerStore((s) => s.setSampleStep);

  const cell = useMemo(() => {
    if (target.kind === "drum") return coerceDrumStep(drums.steps[target.lane]?.[target.step]);
    const sl = samples.find((s) => s.id === target.id);
    return coerceDrumStep(sl?.steps[target.step]);
  }, [target, drums, samples]);

  const apply = (partial: Partial<DrumStep>) => {
    if (target.kind === "drum") patchDrum(target.lane, target.step, partial);
    else setSample(target.id, target.step, { ...cell, ...partial });
  };

  return (
    <div className="mt-2 rounded-xl border border-sky-400/30 bg-sky-500/[0.06] px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-200/90">
          Step inspector · {target.kind === "drum" ? target.lane : "sample"} #{target.step + 1}
        </div>
        <button type="button" className="text-[9px] text-white/40" onClick={onClose}>Close</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <label className="text-[8px] uppercase text-white/40">
          Velocity
          <input type="range" min={0} max={1} step={0.01} value={cell.vel}
            onChange={(e) => apply({ vel: Number(e.target.value) })}
            className="mt-1 w-full accent-sky-400" />
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Probability
          <input type="range" min={0} max={1} step={0.01} value={cell.prob ?? 1}
            onChange={(e) => apply({ prob: Number(e.target.value) })}
            className="mt-1 w-full accent-sky-400" />
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Ratchet
          <input type="range" min={1} max={4} step={1} value={cell.ratchet ?? 1}
            onChange={(e) => apply({ ratchet: Number(e.target.value) })}
            className="mt-1 w-full accent-sky-400" />
        </label>
        <label className="text-[8px] uppercase text-white/40">
          Micro
          <input type="range" min={-1} max={1} step={0.01} value={cell.micro ?? 0}
            onChange={(e) => apply({ micro: Number(e.target.value) })}
            className="mt-1 w-full accent-sky-400" />
        </label>
        <label className="flex items-center gap-2 text-[9px] text-white/55 mt-4">
          <input type="checkbox" checked={!!cell.accent} onChange={(e) => apply({ accent: e.target.checked })} className="accent-sky-400" />
          Accent
        </label>
      </div>
    </div>
  );
}

const DrumRow = memo(function DrumRow({
  laneId, name, isSample, color, steps, totalSteps, playStep, preview, locked, mix,
  expanded, menuOpen, linkedOhat,
  onToggleExpand, onToggleMenu, onDown, onEnter, onContextStep, onAudition,
}: {
  laneId: DrumLane;
  name: string;
  isSample: boolean;
  color: string;
  steps: DrumStep[];
  totalSteps: number;
  playStep: number;
  preview: boolean;
  locked: boolean;
  mix: ReturnType<typeof DEFAULT_LANE_MIX>;
  expanded: boolean;
  menuOpen: boolean;
  linkedOhat: boolean;
  onToggleExpand: () => void;
  onToggleMenu: () => void;
  onDown: (lane: DrumLane, step: number, cell: DrumStep, e: ReactPointerEvent) => void;
  onEnter: (lane: DrumLane, step: number, cell: DrumStep) => void;
  onContextStep: (step: number) => void;
  onAudition: (lane: DrumLane) => void;
}) {
  const setMix = useFireSequencerStore((s) => s.setDrumLaneMix);
  const toggleLock = useFireSequencerStore((s) => s.toggleDrumLaneLock);
  const toast = useUIStore((s) => s.toast);
  const soundingStep = playStep >= 0 ? laneLocalStep(playStep, mix, totalSteps) : -1;
  const fillStart = totalSteps - STEPS_PER_BAR;

  const runLockedAware = (label: string, run: () => void) => {
    if (locked && label !== "Unlock" && label !== "Lock" && !label.includes("sample") && !label.includes("Synth")) {
      toast(`${name} is locked — unlock to ${label.toLowerCase()}`);
      onToggleMenu();
      return;
    }
    run();
    onToggleMenu();
  };

  return (
    <div>
      <div
        className="grid gap-2 items-center group/lane rounded-xl px-0.5 py-0.5 hover:bg-white/[0.02] transition-colors"
        style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) ${TOOLS_W}px` }}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          onDoubleClick={() => onAudition(laneId)}
          className={`h-7 text-left text-[11px] font-semibold tracking-wide px-2 rounded-lg border bg-black/30 hover:bg-black/45 transition truncate ${
            isSample ? "border-fuchsia-400/45" : expanded ? "border-white/30" : "border-white/10"
          }`}
          style={{
            color,
            boxShadow: `inset 3px 0 0 ${color}99`,
            opacity: mix.muted ? 0.4 : 1,
          }}
          title={`${name} — click expand · double-click audition${linkedOhat ? " · chokes Open Hat" : ""}${locked ? " · locked (generators skipped)" : ""}`}
        >
          {locked ? "🔒 " : ""}{name}{linkedOhat ? " ↔" : ""}
        </button>
        <div
          className="grid gap-[3px] min-w-0"
          style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(var(--drum-step-min, 18px), var(--drum-step-max, 36px)))`, justifyContent: "start" }}
        >
          {Array.from({ length: totalSteps }, (_, s) => {
            const cell = coerceDrumStep(steps[s]);
            const on = cell.vel > 0;
            const beatGroup = Math.floor(s / 4) % 2 === 0;
            const barStart = s % STEPS_PER_BAR === 0;
            const qStart = s % 4 === 0;
            const current = soundingStep === s;
            const microOff = (cell.micro ?? 0) * 18;
            const inFillZone = preview && s >= fillStart;
            return (
              <button
                key={s}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onDown(laneId, s, cell, e);
                }}
                onPointerEnter={() => onEnter(laneId, s, cell)}
                onContextMenu={(e) => { e.preventDefault(); }}
                className="relative h-[26px] rounded-md border transition-colors min-w-0"
                style={{
                  borderColor: current
                    ? "rgba(255,200,120,0.95)"
                    : on
                      ? `${color}dd`
                      : barStart
                        ? "rgba(255,255,255,0.16)"
                        : qStart
                          ? "rgba(255,255,255,0.1)"
                          : "rgba(255,255,255,0.06)",
                  background: on
                    ? inFillZone
                      ? `repeating-linear-gradient(135deg, ${color}cc 0 4px, ${color}66 4px 8px)`
                      : `${color}${cell.vel > 0.85 ? "ee" : cell.vel > 0.55 ? "a0" : "5c"}`
                    : beatGroup
                      ? "rgba(255,255,255,0.05)"
                      : "rgba(255,255,255,0.02)",
                  boxShadow: on && cell.accent ? `0 0 9px ${color}88` : current ? "0 0 8px rgba(255,160,80,0.5)" : "none",
                  opacity: on && (cell.prob ?? 1) < 0.85 ? 0.55 + (cell.prob ?? 1) * 0.45 : 1,
                }}
                aria-label={`${name} step ${s + 1}${on ? " (on)" : ""}`}
                title="LMB paint · RMB hold erase · double-click inspect"
              >
                {on && Math.abs(cell.micro ?? 0) > 0.05 && (
                  <span
                    className="absolute top-0.5 h-1 w-1 rounded-full bg-white/80"
                    style={{ left: `calc(50% + ${microOff}%)`, transform: "translateX(-50%)" }}
                  />
                )}
                {on && (cell.ratchet ?? 1) > 1 && (
                  <span className="absolute bottom-0.5 left-0 right-0 flex justify-center gap-px">
                    {Array.from({ length: cell.ratchet ?? 1 }, (_, i) => (
                      <span key={i} className="h-0.5 w-0.5 rounded-full bg-white/70" />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative flex gap-1 justify-end items-center">
          <button
            type="button"
            onClick={() => setMix(laneId, { muted: !mix.muted })}
            className="arr-track-btn"
            data-on={mix.muted ? "1" : "0"}
            data-kind="mute"
            title={mix.muted ? "Unmute lane" : "Mute lane"}
            aria-label={mix.muted ? `Unmute ${name}` : `Mute ${name}`}
            aria-pressed={mix.muted}
          >
            M
          </button>
          <button
            type="button"
            onClick={() => setMix(laneId, { solo: !mix.solo })}
            className="arr-track-btn"
            data-on={mix.solo ? "1" : "0"}
            data-kind="solo"
            title={mix.solo ? "Unsolo lane" : "Solo lane"}
            aria-label={mix.solo ? `Unsolo ${name}` : `Solo ${name}`}
            aria-pressed={mix.solo}
          >
            S
          </button>
          <button
            type="button"
            onClick={onToggleMenu}
            className="w-6 h-6 grid place-items-center rounded-md border border-white/15 text-[10px] text-white/55 hover:text-white/80"
            title="Lane menu"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              data-drum-popover="1"
              className="absolute right-full top-0 z-50 mr-1 w-40 rounded-lg border border-white/18 bg-[#0c0c12] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.85)]"
            >
              {[
                { label: "Euclid", run: () => useFireSequencerStore.getState().euclidLane(laneId, 3) },
                { label: "Random", run: () => useFireSequencerStore.getState().randomLane(laneId, 0.3) },
                { label: isSample ? "Reset Synth Kit" : "Load sample", run: () => {
                  if (isSample) void useFireSequencerStore.getState().setDrumSample(laneId, null);
                  else void (async () => {
                    const path = await window.playground?.openAudioFile();
                    if (path) await useFireSequencerStore.getState().setDrumSample(laneId, path);
                  })();
                } },
                { label: "Clear", run: () => useFireSequencerStore.getState().clearLane(laneId) },
                { label: locked ? "Unlock" : "Lock", run: () => toggleLock(laneId) },
                { label: "Rotate", run: () => useFireSequencerStore.getState().transformDrumLane(laneId, "rotate") },
                { label: "Reverse", run: () => useFireSequencerStore.getState().transformDrumLane(laneId, "reverse") },
                // Lane clipboard: moving a groove between lanes/patterns used
                // to mean redrawing it by hand.
                { label: "Copy lane", run: () => {
                  const n = useFireSequencerStore.getState().copyDrumLane(laneId);
                  useUIStore.getState().toast(`Copied ${n} steps`);
                } },
                { label: "Paste lane", run: () => {
                  void (async () => {
                    await readFireClipboard(FIRE_CLIP_KIND.drumLane);
                    const n = useFireSequencerStore.getState().pasteDrumLane(laneId);
                    useUIStore.getState().toast(n > 0 ? `Pasted ${n} steps` : "Nothing copied yet");
                  })();
                } },
                { label: "Ramp up", run: () => {
                  const n = useFireSequencerStore.getState().rampDrumLane(laneId, 0.35, 1);
                  useUIStore.getState().toast(n > 0 ? `Ramped ${n} hits` : "No hits in lane");
                } },
                { label: "Ramp down", run: () => {
                  const n = useFireSequencerStore.getState().rampDrumLane(laneId, 1, 0.35);
                  useUIStore.getState().toast(n > 0 ? `Ramped ${n} hits` : "No hits in lane");
                } },
                { label: "Inspect step…", run: () => onContextStep(0) },
              ].map((it) => (
                <button
                  key={it.label}
                  type="button"
                  className="block w-full px-2.5 py-1.5 text-left text-[11px] font-semibold text-white/78 hover:bg-white/10"
                  onClick={() => runLockedAware(it.label, it.run)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function SampleDeck({
  totalSteps, playStep, onInspect,
}: {
  totalSteps: number;
  playStep: number;
  onInspect: (id: string, step: number) => void;
}) {
  const samples = useFireSequencerStore((s) => s.samples);
  const addSampleLane = useFireSequencerStore((s) => s.addSampleLane);
  const removeSampleLane = useFireSequencerStore((s) => s.removeSampleLane);
  const setSampleStep = useFireSequencerStore((s) => s.setSampleStep);
  const setSampleLevel = useFireSequencerStore((s) => s.setSampleLevel);
  const clearSampleLane = useFireSequencerStore((s) => s.clearSampleLane);
  const auditionSample = useFireSequencerStore((s) => s.auditionSample);
  const toast = useUIStore((s) => s.toast);
  const paintRef = useRef<PaintMode>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [deckCollapsed, toggleDeck] = useFireCollapsed("seq.sampleDeck", true);

  useEffect(() => {
    const up = () => { paintRef.current = null; };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const addSample = useCallback(async (path?: string) => {
    const p = path ?? await window.playground?.openAudioFile();
    if (!p) return;
    const name = p.split(/[\\/]/).pop() ?? "Sample";
    const ok = await addSampleLane(p, name.replace(/\.[^.]+$/, ""));
    toast(ok ? "Sample racked — paint its steps" : "Couldn't decode that file");
  }, [addSampleLane, toast]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // Electron / playground may expose path on File
    const anyFile = file as File & { path?: string };
    if (anyFile.path) void addSample(anyFile.path);
    else toast("Drop supported via file path — use Rack a sample");
  };

  return (
    <div
      ref={dropRef}
      className="mt-3.5 pt-3 border-t border-white/[0.07]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <button
        type="button"
        onClick={toggleDeck}
        className="flex w-full items-center gap-2 mb-0 text-left rounded-lg px-0.5 py-0.5 hover:bg-white/[0.03] transition"
        aria-expanded={!deckCollapsed}
      >
        <CollapseToggle
          collapsed={deckCollapsed}
          color="#e879f9"
          title={deckCollapsed ? "Expand Sample Deck" : "Collapse Sample Deck"}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.1em] text-fuchsia-300/90">Sample Deck</div>
          <div className="text-[10px] text-white/48 mt-0.5">
            {samples.length}/{MAX_SAMPLE_LANES} racks
            {deckCollapsed ? " · collapsed" : " · drag-drop or rack · same rich steps"}
          </div>
        </div>
        {!deckCollapsed && samples.length > 0 && (
          <span
            role="presentation"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="shrink-0"
          >
            <button
              type="button"
              onClick={() => void addSample()}
              disabled={samples.length >= MAX_SAMPLE_LANES}
              className="h-8 px-3 rounded-lg border border-fuchsia-400/45 bg-fuchsia-500/10 text-fuchsia-200 text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-fuchsia-500/20 disabled:opacity-30 transition"
            >
              Rack a sample
            </button>
          </span>
        )}
      </button>

      {!deckCollapsed && (samples.length === 0 ? (
        <div className="sample-deck-empty mt-2.5">
          <div className="text-[11px] font-black uppercase tracking-[0.1em] text-fuchsia-200/90">Sample Deck</div>
          <div className="text-[10px] text-white/55">0/{MAX_SAMPLE_LANES} racks · empty</div>
          <p className="text-[10px] text-white/48 max-w-sm leading-relaxed">
            Rack one-shots onto the same step grid as Drum Bay. Drag audio here or use the button.
          </p>
          <button
            type="button"
            onClick={() => void addSample()}
            disabled={samples.length >= MAX_SAMPLE_LANES}
            className="h-8 px-3 rounded-lg border border-fuchsia-400/45 bg-fuchsia-500/12 text-fuchsia-100 text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-fuchsia-500/22 disabled:opacity-30 transition"
          >
            Rack a sample
          </button>
          <div className="text-[10px] text-white/40">or drag audio here</div>
        </div>
      ) : (
        <div className="space-y-1 mt-2.5">
          {samples.map((sl) => (
            <div
              key={sl.id}
              className="grid gap-2 items-center group/lane"
              style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) ${TOOLS_W}px` }}
            >
              <button
                type="button"
                onClick={() => auditionSample(sl.id)}
                className="h-7 text-left text-[11px] font-semibold tracking-wide px-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/[0.08] hover:bg-fuchsia-500/[0.16] transition truncate text-fuchsia-300"
              >
                {sl.name}
              </button>
              <div
                className="grid gap-[3px] min-w-0 relative"
                style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(var(--drum-step-min, 18px), var(--drum-step-max, 36px)))`, justifyContent: "start" }}
              >
                {Array.from({ length: totalSteps }, (_, s) => {
                  const cell = coerceDrumStep(sl.steps[s]);
                  const on = cell.vel > 0;
                  const beatGroup = Math.floor(s / 4) % 2 === 0;
                  const barStart = s % STEPS_PER_BAR === 0;
                  const current = playStep === s;
                  const microOff = (cell.micro ?? 0) * 18;
                  return (
                    <button
                      key={s}
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        if (e.button === 2) {
                          const blank = emptyStep();
                          if (on) setSampleStep(sl.id, s, blank);
                          paintRef.current = { value: blank };
                          return;
                        }
                        if (e.detail === 2) { onInspect(sl.id, s); return; }
                        if (e.shiftKey && on) {
                          const nextVel = cell.vel > 0.85 ? 0.7 : cell.vel > 0.55 ? 0.4 : 1;
                          const next = onStep(nextVel, { accent: nextVel > 0.85 });
                          setSampleStep(sl.id, s, next);
                          paintRef.current = { value: next };
                          return;
                        }
                        if (e.altKey && on) {
                          const next = { ...cell, prob: Math.max(0.1, Math.min(1, (cell.prob ?? 1) - 0.2)) };
                          setSampleStep(sl.id, s, next);
                          paintRef.current = { value: next };
                          return;
                        }
                        if ((e.ctrlKey || e.metaKey) && on) {
                          const next = { ...cell, micro: Math.max(-1, Math.min(1, (cell.micro ?? 0) + 0.15)) };
                          setSampleStep(sl.id, s, next);
                          paintRef.current = { value: next };
                          return;
                        }
                        const next = on ? emptyStep() : onStep(1);
                        setSampleStep(sl.id, s, next);
                        paintRef.current = { value: next };
                        if (next.vel > 0) auditionSample(sl.id);
                      }}
                      onPointerEnter={() => {
                        const paint = paintRef.current;
                        if (paint && isStepOn(paint.value) !== on) setSampleStep(sl.id, s, paint.value);
                      }}
                      onContextMenu={(e) => { e.preventDefault(); }}
                      className="relative h-[26px] rounded-md border transition-colors min-w-0"
                      style={{
                        borderColor: current ? "rgba(255,200,120,0.9)" : on ? "rgba(232,121,249,0.85)" : barStart ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                        background: on
                          ? `rgba(232,121,249,${cell.vel > 0.85 ? 0.9 : cell.vel > 0.55 ? 0.65 : 0.4})`
                          : beatGroup ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                        boxShadow: on && cell.accent ? "0 0 8px rgba(232,121,249,0.55)" : on ? "0 0 8px rgba(232,121,249,0.4)" : "none",
                        opacity: on && (cell.prob ?? 1) < 0.85 ? 0.55 + (cell.prob ?? 1) * 0.45 : 1,
                      }}
                    >
                      {on && Math.abs(cell.micro ?? 0) > 0.05 && (
                        <span
                          className="absolute top-0.5 h-1 w-1 rounded-full bg-white/80"
                          style={{ left: `calc(50% + ${microOff}%)`, transform: "translateX(-50%)" }}
                        />
                      )}
                      {on && (cell.ratchet ?? 1) > 1 && (
                        <span className="absolute bottom-0.5 left-0 right-0 flex justify-center gap-px">
                          {Array.from({ length: cell.ratchet ?? 1 }, (_, i) => (
                            <span key={i} className="h-0.5 w-0.5 rounded-full bg-white/70" />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-1 opacity-80">
                <input
                  type="range" min={0} max={1.5} step={0.05} value={sl.level}
                  onChange={(e) => setSampleLevel(sl.id, Number(e.target.value))}
                  className="w-12 accent-fuchsia-400"
                />
                <button type="button" onClick={() => clearSampleLane(sl.id)} className="w-6 h-6 grid place-items-center rounded-md border border-white/12 text-[10px] text-white/55" title="Clear">✕</button>
                <button type="button" onClick={() => removeSampleLane(sl.id)} className="w-6 h-6 grid place-items-center rounded-md border border-white/12 text-[10px] text-white/55" title="Remove">🗑</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
