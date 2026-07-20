/**
 * DrumMachine — FL-Studio-style step sequencer for the Fire Command drum kit.
 *
 * 8 synthesized lanes × pattern steps. Click toggles a step; drag paints;
 * Shift+click cycles velocity (100% → 70% → 40%). Lane name auditions the
 * sound. The step playhead is a DOM highlight driven by a RAF loop that only
 * runs while playing.
 *
 * Any lane can swap its synthesized hit for the operator's OWN sample (📁 on
 * hover), and below the kit sits the SAMPLE DECK — up to six loaded sounds
 * step-sequenced exactly like drum lanes.
 */

import { memo, useEffect, useRef } from "react";
import { DRUM_LANES, type DrumLane } from "@/audio/dsp/FireDrumKit";
import {
  useFireSequencerStore,
  getPlayheadStep,
  STEPS_PER_BAR,
  MAX_SAMPLE_LANES,
} from "@/state/fireSequencerStore";
import { getEngine } from "@/audio/AudioEngine";
import { useUIStore } from "@/state/uiStore";

export function DrumMachine() {
  const drums = useFireSequencerStore((s) => s.drums);
  const bars = useFireSequencerStore((s) => s.bars);
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const toggleStep = useFireSequencerStore((s) => s.toggleDrumStep);
  const setStep = useFireSequencerStore((s) => s.setDrumStep);
  const euclidLane = useFireSequencerStore((s) => s.euclidLane);
  const randomLane = useFireSequencerStore((s) => s.randomLane);
  const clearLane = useFireSequencerStore((s) => s.clearLane);
  const drumSamples = useFireSequencerStore((s) => s.drumSamples);
  const setDrumSample = useFireSequencerStore((s) => s.setDrumSample);
  const hydrateSamples = useFireSequencerStore((s) => s.hydrateSamples);
  const toast = useUIStore((s) => s.toast);

  // Re-load persisted sample buffers into the engine on mount.
  useEffect(() => { void hydrateSamples(); }, [hydrateSamples]);

  const pickSampleFor = async (lane: DrumLane) => {
    const path = await window.playground?.openAudioFile();
    if (!path) return;
    const ok = await setDrumSample(lane, path);
    toast(ok ? `${lane} now fires your sample` : "Couldn't decode that file");
  };

  const totalSteps = bars * STEPS_PER_BAR;
  const paintRef = useRef<{ value: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Playhead: highlight the current step column via a moving DOM bar.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    if (!playing) { el.style.opacity = "0"; return; }
    el.style.opacity = "1";
    let raf = 0;
    let lastStep = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const step = Math.floor(getPlayheadStep(bpm, bars));
      if (step === lastStep) return;
      lastStep = step;
      el.style.transform = `translateX(calc(${step} * (var(--step-w) + 3px)))`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, bpm, bars]);

  const audition = (lane: DrumLane) => {
    const eng = getEngine();
    void eng.resume();
    eng.fireDrums.trigger(lane, eng.ctx.currentTime, 1);
  };

  const onCellDown = (lane: DrumLane, step: number, vel: number, shift: boolean) => {
    if (shift && vel > 0) {
      // Cycle velocity accents: 1 → 0.7 → 0.4 → 1 …
      const next = vel > 0.85 ? 0.7 : vel > 0.55 ? 0.4 : 1;
      setStep(lane, step, next);
      paintRef.current = { value: next };
    } else {
      const next = vel > 0 ? 0 : 1;
      setStep(lane, step, next);
      paintRef.current = { value: next };
      if (next > 0) audition(lane);
    }
  };

  const onCellEnter = (lane: DrumLane, step: number, vel: number) => {
    const paint = paintRef.current;
    if (!paint) return;
    if ((paint.value > 0) !== (vel > 0)) setStep(lane, step, paint.value);
  };

  useEffect(() => {
    const up = () => { paintRef.current = null; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  return (
    <div
      className="select-none"
      style={{ ["--step-w" as string]: totalSteps > 32 ? "16px" : "22px" }}
    >
      {/* step ruler + playhead */}
      <div className="relative ml-[86px] mb-1 h-3 overflow-hidden">
        <div className="flex gap-[3px]">
          {Array.from({ length: totalSteps }, (_, s) => (
            <div
              key={s}
              className="text-center text-[8px] leading-3 font-mono shrink-0"
              style={{
                width: "var(--step-w)",
                color: s % STEPS_PER_BAR === 0 ? "rgba(255,150,80,0.9)" : s % 4 === 0 ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.15)",
              }}
            >
              {s % 4 === 0 ? s / 4 + 1 : "·"}
            </div>
          ))}
        </div>
        <div
          ref={headerRef}
          className="absolute top-0 h-full pointer-events-none opacity-0 rounded-sm"
          style={{
            width: "var(--step-w)",
            background: "rgba(255,150,70,0.3)",
            boxShadow: "0 0 8px rgba(255,140,60,0.5)",
            willChange: "transform",
            transition: "opacity 0.2s",
          }}
        />
      </div>

      <div className="space-y-[3px]">
        {DRUM_LANES.map((lane) => (
          <DrumRow
            key={lane.id}
            laneId={lane.id}
            name={drumSamples[lane.id]?.name ?? lane.name}
            isSample={!!drumSamples[lane.id]}
            color={lane.color}
            steps={drums.steps[lane.id]}
            totalSteps={totalSteps}
            onDown={onCellDown}
            onEnter={onCellEnter}
            onAudition={audition}
            onToggle={toggleStep}
            onEuclid={euclidLane}
            onRandom={randomLane}
            onClear={clearLane}
            onPickSample={(l) => void pickSampleFor(l)}
            onResetSample={(l) => void setDrumSample(l, null)}
          />
        ))}
      </div>
      <div className="mt-2 text-[10px] text-dim">
        Click to toggle · drag to paint · Shift+click cycles accent (100/70/40%) · lane name auditions ·
        Ⓔ euclid rhythm · ⚄ random fill · 📁 load your own hit · ✕ clear lane
      </div>

      <SampleDeck totalSteps={totalSteps} />
    </div>
  );
}

/** SAMPLE DECK — operator sounds step-sequenced like drum lanes. */
function SampleDeck({ totalSteps }: { totalSteps: number }) {
  const samples = useFireSequencerStore((s) => s.samples);
  const addSampleLane = useFireSequencerStore((s) => s.addSampleLane);
  const removeSampleLane = useFireSequencerStore((s) => s.removeSampleLane);
  const setSampleStep = useFireSequencerStore((s) => s.setSampleStep);
  const setSampleLevel = useFireSequencerStore((s) => s.setSampleLevel);
  const clearSampleLane = useFireSequencerStore((s) => s.clearSampleLane);
  const auditionSample = useFireSequencerStore((s) => s.auditionSample);
  const toast = useUIStore((s) => s.toast);
  const paintRef = useRef<{ value: number } | null>(null);

  useEffect(() => {
    const up = () => { paintRef.current = null; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const addSample = async () => {
    const path = await window.playground?.openAudioFile();
    if (!path) return;
    const name = path.split(/[\\/]/).pop() ?? "Sample";
    const ok = await addSampleLane(path, name.replace(/\.[^.]+$/, ""));
    toast(ok ? "Sample racked — paint its steps" : "Couldn't decode that file");
  };

  return (
    <div className="mt-3 pt-3 border-t border-white/8">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-[0.25em] text-dim">Sample Deck</span>
        <span className="text-[9px] text-white/30">{samples.length}/{MAX_SAMPLE_LANES}</span>
        <button
          onClick={() => void addSample()}
          disabled={samples.length >= MAX_SAMPLE_LANES}
          className="ml-auto px-2.5 py-1 rounded-lg border border-cyan/40 bg-cyan/10 text-cyan text-[10px] uppercase tracking-[0.12em] hover:bg-cyan/20 disabled:opacity-30 transition"
          title="Load any sound (wav/mp3/flac…) as a new sequenced lane"
        >
          ⊕ Rack a sample
        </button>
      </div>
      {samples.length === 0 ? (
        <div className="text-[10px] text-white/30 italic">
          Rack your own sounds — risers, vocal chops, FX — and paint them on the same step grid.
        </div>
      ) : (
        <div className="space-y-[3px]">
          {samples.map((sl) => (
            <div key={sl.id} className="flex items-center gap-2 group/lane">
              <button
                onClick={() => auditionSample(sl.id)}
                className="w-[78px] shrink-0 text-left text-[11px] font-semibold tracking-wide px-2 py-1 rounded-md border border-fuchsia-400/25 bg-fuchsia-500/[0.06] hover:bg-fuchsia-500/[0.14] transition truncate text-fuchsia-300"
                title={`Audition ${sl.name}`}
              >
                {sl.name}
              </button>
              <div className="flex gap-[3px]">
                {Array.from({ length: totalSteps }, (_, s) => {
                  const vel = sl.steps[s] ?? 0;
                  const on = vel > 0;
                  const beatGroup = Math.floor(s / 4) % 2 === 0;
                  return (
                    <button
                      key={s}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        const next = on ? 0 : 1;
                        setSampleStep(sl.id, s, next);
                        paintRef.current = { value: next };
                        if (next > 0) auditionSample(sl.id);
                      }}
                      onPointerEnter={() => {
                        const paint = paintRef.current;
                        if (paint && (paint.value > 0) !== on) setSampleStep(sl.id, s, paint.value);
                      }}
                      className="rounded-[4px] border transition-colors shrink-0"
                      style={{
                        width: "var(--step-w)",
                        height: 22,
                        borderColor: on ? "rgba(232,121,249,0.8)" : "rgba(255,255,255,0.07)",
                        background: on
                          ? "rgba(232,121,249,0.75)"
                          : beatGroup
                            ? "rgba(255,255,255,0.045)"
                            : "rgba(255,255,255,0.016)",
                        boxShadow: on ? "0 0 7px rgba(232,121,249,0.4)" : "none",
                      }}
                      aria-label={`${sl.name} step ${s + 1}${on ? " (on)" : ""}`}
                    />
                  );
                })}
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/lane:opacity-100 transition-opacity">
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={sl.level}
                  onChange={(e) => setSampleLevel(sl.id, Number(e.target.value))}
                  className="w-14 accent-fuchsia-400"
                  title={`Level ${(sl.level * 100).toFixed(0)}%`}
                />
                <button
                  onClick={() => clearSampleLane(sl.id)}
                  className="w-6 h-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-white/60 hover:text-rose-300 hover:border-rose-400/40 transition"
                  title="Clear steps"
                >
                  ✕
                </button>
                <button
                  onClick={() => removeSampleLane(sl.id)}
                  className="w-6 h-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-white/60 hover:text-rose-300 hover:border-rose-400/40 transition"
                  title="Remove this sample lane"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Euclid pulse counts cycled by repeated clicks — the classic groove set. */
const EUCLID_CYCLE = [2, 3, 4, 5, 7, 0];

/** One lane row — memoized so painting one lane doesn't re-render the rest. */
const DrumRow = memo(function DrumRow({
  laneId, name, isSample, color, steps, totalSteps,
  onDown, onEnter, onAudition, onEuclid, onRandom, onClear, onPickSample, onResetSample,
}: {
  laneId: DrumLane;
  name: string;
  isSample: boolean;
  color: string;
  steps: number[];
  totalSteps: number;
  onDown: (lane: DrumLane, step: number, vel: number, shift: boolean) => void;
  onEnter: (lane: DrumLane, step: number, vel: number) => void;
  onAudition: (lane: DrumLane) => void;
  onToggle: (lane: DrumLane, step: number) => void;
  onEuclid: (lane: DrumLane, pulses: number) => void;
  onRandom: (lane: DrumLane, density: number) => void;
  onClear: (lane: DrumLane) => void;
  onPickSample: (lane: DrumLane) => void;
  onResetSample: (lane: DrumLane) => void;
}) {
  const euclidIdx = useRef(0);
  const hasSteps = steps.some((v) => v > 0);
  return (
    <div className="flex items-center gap-2 group/lane">
      <button
        onClick={() => onAudition(laneId)}
        className={`w-[78px] shrink-0 text-left text-[11px] font-semibold tracking-wide px-2 py-1 rounded-md border bg-white/[0.03] hover:bg-white/[0.08] transition truncate ${
          isSample ? "border-fuchsia-400/40" : "border-white/8"
        }`}
        style={{ color }}
        title={isSample ? `Audition ${name} (your sample)` : `Audition ${name}`}
      >
        {name}
      </button>
      <div className="flex gap-[3px]">
        {Array.from({ length: totalSteps }, (_, s) => {
          const vel = steps[s] ?? 0;
          const on = vel > 0;
          const beatGroup = Math.floor(s / 4) % 2 === 0;
          return (
            <button
              key={s}
              onPointerDown={(e) => {
                e.preventDefault();
                onDown(laneId, s, vel, e.shiftKey);
              }}
              onPointerEnter={() => onEnter(laneId, s, vel)}
              className="rounded-[4px] border transition-colors shrink-0"
              style={{
                width: "var(--step-w)",
                height: 22,
                borderColor: on ? `${color}cc` : "rgba(255,255,255,0.07)",
                background: on
                  ? `${color}${vel > 0.85 ? "e8" : vel > 0.55 ? "99" : "55"}`
                  : beatGroup
                    ? "rgba(255,255,255,0.045)"
                    : "rgba(255,255,255,0.016)",
                boxShadow: on && vel > 0.85 ? `0 0 7px ${color}66` : "none",
              }}
              aria-label={`${name} step ${s + 1}${on ? " (on)" : ""}`}
            />
          );
        })}
      </div>
      {/* Lane tools — visible on row hover so the grid stays clean. */}
      <div className="flex gap-1 shrink-0 opacity-0 group-hover/lane:opacity-100 transition-opacity">
        <button
          onClick={() => {
            const pulses = EUCLID_CYCLE[euclidIdx.current % EUCLID_CYCLE.length];
            euclidIdx.current++;
            onEuclid(laneId, pulses);
          }}
          className="w-6 h-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-white/60 hover:text-cyan hover:border-cyan/40 transition"
          title="Euclidean rhythm — evenly spread pulses. Click again to cycle 2·3·4·5·7·off"
        >
          Ⓔ
        </button>
        <button
          onClick={() => onRandom(laneId, 0.3)}
          className="w-6 h-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-white/60 hover:text-cyan hover:border-cyan/40 transition"
          title="Random fill (~30% density, some soft hits)"
        >
          ⚄
        </button>
        <button
          onClick={() => (isSample ? onResetSample(laneId) : onPickSample(laneId))}
          className={`w-6 h-6 grid place-items-center rounded-md border text-[10px] transition ${
            isSample
              ? "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-300 hover:text-white"
              : "border-white/10 bg-white/[0.03] text-white/60 hover:text-fuchsia-300 hover:border-fuchsia-400/40"
          }`}
          title={isSample ? "Revert to the synthesized hit" : "Load your own kick/snare/hat for this lane"}
        >
          {isSample ? "↺" : "📁"}
        </button>
        <button
          onClick={() => onClear(laneId)}
          disabled={!hasSteps}
          className="w-6 h-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-white/60 hover:text-rose-300 hover:border-rose-400/40 disabled:opacity-30 transition"
          title="Clear this lane"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
