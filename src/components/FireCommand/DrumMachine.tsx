/**
 * DrumMachine — FL-Studio-style step sequencer for the Fire Command drum kit.
 *
 * Lanes stretch to fill the bay (no dead black void). Click toggles; drag paints;
 * Shift+click cycles velocity. Lane tools stay in a fixed right rail.
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

const LABEL_W = 92;
const TOOLS_W = 112;

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

  useEffect(() => { void hydrateSamples(); }, [hydrateSamples]);

  const pickSampleFor = async (lane: DrumLane) => {
    const path = await window.playground?.openAudioFile();
    if (!path) return;
    const ok = await setDrumSample(lane, path);
    toast(ok ? `${lane} now fires your sample` : "Couldn't decode that file");
  };

  const totalSteps = bars * STEPS_PER_BAR;
  const paintRef = useRef<{ value: number } | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = playheadRef.current;
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
      el.style.opacity = step < 0 ? "0" : "1";
      if (step < 0) return;
      el.style.left = `${(step / totalSteps) * 100}%`;
      el.style.width = `${100 / totalSteps}%`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, bpm, bars, totalSteps]);

  const audition = (lane: DrumLane) => {
    const eng = getEngine();
    void eng.resume();
    eng.fireDrums.trigger(lane, eng.ctx.currentTime, 1);
  };

  const onCellDown = (lane: DrumLane, step: number, vel: number, shift: boolean) => {
    if (shift && vel > 0) {
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
    <div className="select-none w-full min-w-0 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-[#12151c] via-[#0c0e14] to-[#090b10] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/80">Drum Bay</div>
          <div className="text-[9px] text-white/35 mt-0.5">{bars} bar{bars === 1 ? "" : "s"} · {totalSteps} steps · paint the grid</div>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => {
            useFireSequencerStore.getState().generateDrumFill();
            useUIStore.getState().toast("Fill dropped on the last bar — press again to reroll, Ctrl+Z to undo");
          }}
          className="px-3 py-1.5 rounded-xl border border-amber-400/45 bg-amber-400/10 text-amber-200 text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-amber-400/20 transition shadow-[0_0_16px_rgb(251_191_36/0.15)]"
          title="Fill generator: rewrites the last bar — snare ramp, tom tumble, kick thin-out, crash on the loop point."
        >
          ⚡ Fill last bar
        </button>
      </div>

      {/* Column chrome: label | expanding step grid | tools */}
      <div
        className="grid gap-2 items-center mb-1.5"
        style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) ${TOOLS_W}px` }}
      >
        <div className="text-[8px] uppercase tracking-[0.18em] text-white/30 pl-1">Lane</div>
        <div className="relative" ref={gridRef}>
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: totalSteps }, (_, s) => (
              <div
                key={s}
                className="text-center text-[8px] leading-3 font-mono truncate"
                style={{
                  color:
                    s % STEPS_PER_BAR === 0
                      ? "rgba(255,150,80,0.9)"
                      : s % 4 === 0
                        ? "rgba(255,255,255,0.45)"
                        : "rgba(255,255,255,0.15)",
                }}
              >
                {s % STEPS_PER_BAR === 0 ? Math.floor(s / STEPS_PER_BAR) + 1 : s % 4 === 0 ? "·" : ""}
              </div>
            ))}
          </div>
          <div
            ref={playheadRef}
            className="absolute top-0 h-full pointer-events-none opacity-0 rounded-sm"
            style={{
              background: "rgba(255,150,70,0.28)",
              boxShadow: "0 0 10px rgba(255,140,60,0.45)",
              willChange: "left, width, opacity",
              transition: "opacity 0.2s",
            }}
          />
        </div>
        <div className="text-[8px] uppercase tracking-[0.18em] text-white/30 text-right pr-1">Tools</div>
      </div>

      <div className="space-y-1">
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

      <div className="mt-2.5 text-[9px] text-white/30 leading-relaxed">
        Click toggle · drag paint · Shift+click accent · name auditions · Ⓔ euclid · ⚄ random · 📁 sample · ✕ clear
      </div>

      <SampleDeck totalSteps={totalSteps} />
    </div>
  );
}

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
    <div className="mt-3.5 pt-3 border-t border-white/[0.07]">
      <div className="flex items-center gap-2 mb-2.5">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/80">Sample Deck</div>
          <div className="text-[9px] text-white/30 mt-0.5">{samples.length}/{MAX_SAMPLE_LANES} racks · same step grid</div>
        </div>
        <button
          onClick={() => void addSample()}
          disabled={samples.length >= MAX_SAMPLE_LANES}
          className="ml-auto px-3 py-1.5 rounded-xl border border-fuchsia-400/45 bg-fuchsia-500/10 text-fuchsia-200 text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-fuchsia-500/20 disabled:opacity-30 transition shadow-[0_0_14px_rgb(232_121_249/0.12)]"
          title="Load any sound (wav/mp3/flac…) as a new sequenced lane"
        >
          ⊕ Rack a sample
        </button>
      </div>
      {samples.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-[10px] text-white/35 italic">
          Rack risers, vocal chops, FX — they paint on the same full-width step grid.
        </div>
      ) : (
        <div className="space-y-1">
          {samples.map((sl) => (
            <div
              key={sl.id}
              className="grid gap-2 items-center group/lane"
              style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) ${TOOLS_W}px` }}
            >
              <button
                onClick={() => auditionSample(sl.id)}
                className="h-7 text-left text-[11px] font-semibold tracking-wide px-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/[0.08] hover:bg-fuchsia-500/[0.16] transition truncate text-fuchsia-300"
                title={`Audition ${sl.name}`}
              >
                {sl.name}
              </button>
              <div
                className="grid gap-[3px] min-w-0"
                style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: totalSteps }, (_, s) => {
                  const vel = sl.steps[s] ?? 0;
                  const on = vel > 0;
                  const beatGroup = Math.floor(s / 4) % 2 === 0;
                  const barStart = s % STEPS_PER_BAR === 0;
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
                      className="h-[26px] rounded-md border transition-colors min-w-0"
                      style={{
                        borderColor: on
                          ? "rgba(232,121,249,0.85)"
                          : barStart
                            ? "rgba(255,255,255,0.12)"
                            : "rgba(255,255,255,0.06)",
                        background: on
                          ? "rgba(232,121,249,0.78)"
                          : beatGroup
                            ? "rgba(255,255,255,0.05)"
                            : "rgba(255,255,255,0.02)",
                        boxShadow: on ? "0 0 8px rgba(232,121,249,0.4)" : "none",
                      }}
                      aria-label={`${sl.name} step ${s + 1}${on ? " (on)" : ""}`}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-1 opacity-70 group-hover/lane:opacity-100 transition-opacity">
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={sl.level}
                  onChange={(e) => setSampleLevel(sl.id, Number(e.target.value))}
                  className="w-12 accent-fuchsia-400"
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

const EUCLID_CYCLE = [2, 3, 4, 5, 7, 0];

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
    <div
      className="grid gap-2 items-center group/lane rounded-xl px-0.5 py-0.5 hover:bg-white/[0.02] transition-colors"
      style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) ${TOOLS_W}px` }}
    >
      <button
        onClick={() => onAudition(laneId)}
        className={`h-7 text-left text-[11px] font-semibold tracking-wide px-2 rounded-lg border bg-black/30 hover:bg-black/45 transition truncate ${
          isSample ? "border-fuchsia-400/45" : "border-white/10"
        }`}
        style={{
          color,
          boxShadow: `inset 3px 0 0 ${color}99`,
        }}
        title={isSample ? `Audition ${name} (your sample)` : `Audition ${name}`}
      >
        {name}
      </button>
      <div
        className="grid gap-[3px] min-w-0"
        style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: totalSteps }, (_, s) => {
          const vel = steps[s] ?? 0;
          const on = vel > 0;
          const beatGroup = Math.floor(s / 4) % 2 === 0;
          const barStart = s % STEPS_PER_BAR === 0;
          return (
            <button
              key={s}
              onPointerDown={(e) => {
                e.preventDefault();
                onDown(laneId, s, vel, e.shiftKey);
              }}
              onPointerEnter={() => onEnter(laneId, s, vel)}
              className="h-[26px] rounded-md border transition-colors min-w-0"
              style={{
                borderColor: on
                  ? `${color}dd`
                  : barStart
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.06)",
                background: on
                  ? `${color}${vel > 0.85 ? "ee" : vel > 0.55 ? "a0" : "5c"}`
                  : beatGroup
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(255,255,255,0.02)",
                boxShadow: on && vel > 0.85 ? `0 0 9px ${color}77` : "none",
              }}
              aria-label={`${name} step ${s + 1}${on ? " (on)" : ""}`}
            />
          );
        })}
      </div>
      <div className="flex gap-1 justify-end opacity-55 group-hover/lane:opacity-100 transition-opacity">
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
