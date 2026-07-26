import { useCallback, useEffect, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { SequencerPanel } from "./SequencerPanel";
import {
  useFireCommandStore,
  FIRE_PRESETS,
  buildArpSequence,
  type ArpMode,
  type ArpDivision,
  type ArpSettings,
} from "@/state/fireCommandStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { getEngine } from "@/audio/AudioEngine";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { useMidiStore, registerMidiNoteHandler } from "@/state/midiStore";
import { DEFAULT_FIRE_PATCH, type FirePatch, type LfoWave, type FireFilterType, type LfoDest, type SubWave, type DriveMode, type ModSource, type ModDest, type ModRoute, type HarmonyMode, type SpectralMode } from "@/audio/dsp/FireCommandSynth";
import { WAVETABLES, FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { DriveStageViz, PhaserStageViz, ChorusStageViz, DelayStageViz, ReverbStageViz, SpectralStageViz, WarpStageViz } from "./FxStageViz";
import {
  UnisonStageViz,
  FilterStageViz,
  AmpEnvStageViz,
  ModEnvStageViz,
  FiltEnvStageViz,
  LfoStageViz,
  FmRingStageViz,
  PitchGlideStageViz,
  OscStageViz,
  PerformanceStageViz,
} from "./CoreStageViz";
import { useFireCollapsed } from "./useFireCollapsed";
import { CollapseToggle } from "./CollapseToggle";
import { FireBand, useFireBandRegister } from "./FireBand";
import { PresetBrowser } from "./PresetBrowser";
import { MixerPanel } from "./MixerPanel";
import { ModPatchGrid } from "./ModPatchGrid";
import { FireMorphPad } from "./FireMorphPad";
import { undoFire, redoFire, useFireHistoryStore } from "@/lib/fireHistory";
import { MutateCluster } from "./MutateCluster";
import { RandomizeCluster } from "./RandomizeCluster";
import { FireLayoutProvider, useFireLayout } from "./FireLayoutContext";
import { FireCommandDeck } from "./FireCommandDeck";
import { ensureExpanded } from "./fireNavigate";
import { FC, FC_BAND } from "./fireColors";

const FIRE = FC.fire; // mix / destination coral
const ICE = FC.lfo; // modulation sky
const GRN = FC.envAmp; // envelope lime (Tone)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type NumericKey = { [K in keyof FirePatch]: FirePatch[K] extends number ? K : never }[keyof FirePatch];

const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16,
};
const SEMITONE_TO_KEY: Record<number, string> = Object.fromEntries(
  Object.entries(KEY_TO_SEMITONE).map(([k, v]) => [v, k === ";" ? ";" : k.toUpperCase()]),
);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${Math.round(v)}`);
const fmtSec = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtBi = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
const fmtCents = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}¢`;
const fmtSemi = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}st`;
const fmtRatio = (v: number) => `${v.toFixed(2)}×`;
const fmtOct = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : ""}${v}`);
const fmtQ = (v: number) => v.toFixed(1);
const fmtBpm = (v: number) => `${Math.round(v)}`;
const fmtInt = (v: number) => `${Math.round(v)}`;
const fmtHzRate = (v: number) => `${v.toFixed(2)}Hz`;

function StudioBay() {
  const undoDepth = useFireHistoryStore((s) => s.undoDepth);
  const redoDepth = useFireHistoryStore((s) => s.redoDepth);
  const cell = (enabled: boolean) =>
    `h-10 rounded-xl border text-[12px] font-semibold transition truncate ${
      enabled
        ? "border-white/14 bg-white/[0.06] hover:bg-white/10 text-white/85"
        : "border-white/6 bg-white/[0.02] text-white/25 cursor-default"
    }`;
  return (
    <div className="relative z-0 flex min-w-0 flex-col justify-center gap-2 overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2 min-h-[88px]">
      <div className="flex items-center gap-2 w-full">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Studio</span>
        <span className="text-[9px] text-white/25">undo · redo</span>
        <span className="ml-auto font-mono text-[9px] text-white/30 tabular-nums">
          {undoDepth}/{redoDepth}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 w-full">
        <button
          onClick={() => undoFire()}
          disabled={undoDepth === 0}
          className={cell(undoDepth > 0)}
          title="Undo (Ctrl+Z)"
        >↶ Undo</button>
        <button
          onClick={() => redoFire()}
          disabled={redoDepth === 0}
          className={cell(redoDepth > 0)}
          title="Redo (Ctrl+Y)"
        >↷ Redo</button>
      </div>
      {/* Depth rails — how deep the history stacks run */}
      <div className="grid grid-cols-2 gap-1.5 w-full">
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" title={`${undoDepth} undo steps`}>
          <div
            className="h-full rounded-full bg-[#ff6a3d]/55 transition-[width] duration-200"
            style={{ width: `${Math.min(100, undoDepth * 8)}%` }}
          />
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" title={`${redoDepth} redo steps`}>
          <div
            className="h-full rounded-full bg-[#62b6ff]/55 transition-[width] duration-200"
            style={{ width: `${Math.min(100, redoDepth * 8)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function FireCommandView() {
  const presetId = useFireCommandStore((s) => s.presetId);
  const octave = useFireCommandStore((s) => s.octave);
  const mono = useFireCommandStore((s) => s.patch.mono);
  const arp = useFireCommandStore((s) => s.arp);
  const keyboardMinimized = useFireCommandStore((s) => s.keyboardMinimized);
  const setParam = useFireCommandStore((s) => s.setParam);
  const loadPreset = useFireCommandStore((s) => s.loadPreset);
  const shiftOctave = useFireCommandStore((s) => s.shiftOctave);
  const toast = useUIStore((s) => s.toast);
  const setRouteThroughFx = useFireCommandStore((s) => s.setRouteThroughFx);
  const setArp = useFireCommandStore((s) => s.setArp);
  const toggleKeyboard = useFireCommandStore((s) => s.toggleKeyboard);
  const panic = useFireCommandStore((s) => s.panic);
  const userPresets = useFireCommandStore((s) => s.userPresets);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  const bypass = useAudioStore((s) => s.bypass);
  const fxOn = !bypass;
  const [browserOpen, setBrowserOpen] = useState(false);

  const currentName =
    presetId === "custom"
      ? "Custom"
      : FIRE_PRESETS.find((p) => p.id === presetId)?.name ??
        userPresets.find((p) => p.id === presetId)?.name ??
        "Custom";

  // Prev/Next patch cycling — walks factory bank then user presets, wrapping
  // at the ends. From "Custom" it re-enters the bank at the start.
  const cyclePreset = useCallback(
    (dir: 1 | -1) => {
      const s = useFireCommandStore.getState();
      const ids = [...FIRE_PRESETS.map((p) => p.id), ...s.userPresets.map((p) => p.id)];
      if (ids.length === 0) return;
      const cur = ids.indexOf(s.presetId);
      const next = cur === -1
        ? (dir === 1 ? 0 : ids.length - 1)
        : (cur + dir + ids.length) % ids.length;
      s.loadPreset(ids[next]);
      const all = [...FIRE_PRESETS, ...s.userPresets];
      const p = all[next];
      useUIStore.getState().toast(`♪ ${p.name}${"category" in p ? ` · ${(p as { category?: string }).category ?? ""}` : ""}`);
    },
    [],
  );

  useEffect(() => {
    useFireCommandStore.getState().sync();
    // Persisted mixer/limiter/duck state lands on the engine buses (v1.6).
    useFireSequencerStore.getState().syncFireMixer();
    return () => useFireCommandStore.getState().panic();
  }, []);

  // v1.6: a USB MIDI keyboard plays Synth A live while this view is open
  // (same noteOn/noteOff path as QWERTY — arp-aware, record-armed capture).
  useEffect(() => {
    void useMidiStore.getState().startListening();
    registerMidiNoteHandler({
      noteOn: (midi, vel) => useFireCommandStore.getState().noteOn(midi, vel),
      noteOff: (midi) => useFireCommandStore.getState().noteOff(midi),
    });
    return () => registerMidiNoteHandler(null);
  }, []);

  useEffect(() => {
    const pressed = new Set<string>();
    const isText = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      // SELECT included: letter keys drive native type-ahead on the wavetable
      // and mod-matrix dropdowns — they must not double as instrument keys.
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      // Undo/redo across the whole Fire workspace (v1.6). Bound here rather
      // than globally so Ctrl+Z elsewhere in the app keeps native behavior.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !isText(e.target)) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          if (!undoFire()) useUIStore.getState().toast("Nothing to undo");
          return;
        }
        if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          if (!redoFire()) useUIStore.getState().toast("Nothing to redo");
          return;
        }
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isText(e.target)) return;
      const k = e.key.toLowerCase();
      const store = useFireCommandStore.getState();
      if (k === "z") { e.preventDefault(); if (!e.repeat) store.shiftOctave(-1); return; }
      if (k === "x") { e.preventDefault(); if (!e.repeat) store.shiftOctave(1); return; }
      const semi = KEY_TO_SEMITONE[k];
      if (semi === undefined) return;
      e.preventDefault();
      if (e.repeat || pressed.has(k)) return;
      pressed.add(k);
      store.noteOn((store.octave + 1) * 12 + semi);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!pressed.has(k)) return;
      pressed.delete(k);
      const semi = KEY_TO_SEMITONE[k];
      if (semi === undefined) return;
      useFireCommandStore.getState().noteOff((useFireCommandStore.getState().octave + 1) * 12 + semi);
    };
    const onBlur = () => { pressed.clear(); useFireCommandStore.getState().panic(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <FireLayoutProvider>
    <div className="space-y-2 pb-6">
      {/* MK IV command-deck header — targeting-reticle mark, no mascot */}
      <div className="fire-header relative overflow-hidden rounded-2xl border border-[#ff6a3d]/25 px-4 py-2.5">
        {/* hazard chevrons along the bottom edge */}
        <div
          className="absolute inset-x-0 bottom-0 h-[3px] opacity-40 pointer-events-none"
          style={{ background: "repeating-linear-gradient(115deg, #ff6a3d 0 10px, transparent 10px 20px)" }}
        />
        <div className="relative z-10 flex flex-wrap items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg grid place-items-center shrink-0"
            style={{ background: "linear-gradient(145deg, #ff6a3d24, #0a0a0a)", border: "1px solid #ff6a3d55", boxShadow: "0 0 24px #ff6a3d2e, inset 0 0 12px #ff6a3d1a" }}
            title="Fire Command MK IV"
          >
            {/* targeting reticle */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="8" stroke="#ff6a3d" strokeWidth="1.4" opacity="0.9" />
              <circle cx="12" cy="12" r="3.4" stroke="#ffcf5c" strokeWidth="1.2" opacity="0.85" />
              <circle cx="12" cy="12" r="1" fill="#ff6a3d" />
              <path d="M12 1v4.4M12 18.6V23M1 12h4.4M18.6 12H23" stroke="#ff6a3d" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M5.2 5.2l1.8 1.8M18.8 5.2L17 7M5.2 18.8L7 17M18.8 18.8L17 17" stroke="#ff6a3d" strokeWidth="1" opacity="0.45" strokeLinecap="round" />
            </svg>
          </div>
          <div className="min-w-0 flex items-baseline gap-3">
            <h1 className="fire-title text-lg font-black tracking-[0.08em] leading-none">FIRE COMMAND</h1>
            <span
              className="text-[10px] font-black tracking-[0.18em] leading-none px-1.5 py-0.5 rounded"
              style={{ color: "#ffcf5c", border: "1px solid #ffcf5c44", background: "#ffcf5c12", textShadow: "0 0 10px #ffcf5c66" }}
            >MK IV</span>
            <div className="hidden sm:block text-[9px] uppercase tracking-[0.3em] text-[#ff9a6b]/80">
              Wavetable Weapons Platform
            </div>
          </div>
          <div className="flex-1" />
          <div className="hidden md:flex items-center gap-4 text-[9px] uppercase tracking-[0.22em] font-mono">
            <div className="flex items-center gap-1.5 text-[#9be564]">
              <span className="fire-status-dot" style={{ background: "#9be564" }} />
              Systems Nominal
            </div>
            <div className="text-white/35">3 OSC · 12-SLOT MATRIX · 1000 PATCHES</div>
          </div>
        </div>
      </div>

      {/* Patch bar — three balanced bays: library · generative · history */}
      <GlassPanel className="p-2.5">
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)_minmax(0,0.85fr)] xl:items-stretch">
          {/* Library bay */}
          <div className="flex flex-col justify-center gap-2 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2 min-h-[88px]">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Patch</span>
              <span className="text-[9px] text-white/25 truncate">library · browse · init</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={() => cyclePreset(-1)}
                className="w-8 h-8 shrink-0 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm leading-none transition"
                title="Previous preset"
                aria-label="Previous preset"
              >◂</button>
              <button
                onClick={() => setBrowserOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-white/12 bg-black/30 hover:bg-black/45 hover:border-white/25 px-2.5 py-1.5 transition min-w-0 flex-1"
                title="Open the preset library"
              >
                <span className="text-base leading-none shrink-0" style={{ color: FIRE }}>♪</span>
                <span className="text-sm font-semibold text-white truncate">{currentName}</span>
                <span className="ml-auto text-[9px] uppercase tracking-widest text-white/40 shrink-0">Browse</span>
              </button>
              <button
                onClick={() => cyclePreset(1)}
                className="w-8 h-8 shrink-0 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm leading-none transition"
                title="Next preset"
                aria-label="Next preset"
              >▸</button>
              <button
                onClick={() => loadPreset("init")}
                className="h-8 shrink-0 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 px-2.5 text-[11px] text-white/75 transition"
                title="Reset to Init patch"
              >↺ Init</button>
            </div>
          </div>

          {/* Generative bay — twin pods */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0 overflow-hidden">
            <RandomizeCluster />
            <MutateCluster />
          </div>

          {/* Studio bay — undo / redo only (library lives in Patch bay) */}
          <StudioBay />
        </div>
      </GlassPanel>

      {/* Pattern sequencer: piano roll + drum grid */}
      <SequencerPanel />

      {/* Signal Path Theater + Command Map */}
      <FireCommandDeck />

      {/* ── Category bands (v2.5.7) — collapsed chips, even open grids ── */}

      <FireBand title="Mix & Output" color={FC_BAND.mix} bandKey="band.mix" hint="bus · morph · scope · performance">
        <MixerPanel chipHosted />
        <FireMorphPad chipHosted />
        <Section title="Output · Scope" color={FC.scope} collapseKey="output" chipHosted right={<VoiceCount />}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
            <div className="rounded-xl border border-[#ff6a3d]/22 bg-gradient-to-b from-[#ff6a3d]/[0.08] to-black/40 p-2 shadow-[0_0_18px_rgba(255,106,61,0.08)] lg:col-span-1">
              <WaveDisplay group="a" color={FIRE} />
            </div>
            <div className="rounded-xl border border-[#ff9a6b]/22 bg-gradient-to-b from-[#ff9a6b]/[0.08] to-black/40 p-2 shadow-[0_0_18px_rgba(255,154,107,0.08)] lg:col-span-1">
              <WaveDisplay group="b" color="#ff9a6b" />
            </div>
            <div className="rounded-xl border border-[#ffcf5c]/22 bg-gradient-to-b from-[#ffcf5c]/[0.08] to-black/40 p-2 shadow-[0_0_18px_rgba(255,207,92,0.08)] lg:col-span-1">
              <WaveDisplay group="c" color="#ffcf5c" />
            </div>
            <div className="rounded-xl border border-[#ff6a3d]/28 bg-gradient-to-b from-[#ff6a3d]/[0.1] to-black/50 p-2 shadow-[0_0_22px_rgba(255,106,61,0.12)] lg:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2 min-w-0">
                <span className="text-[10px] uppercase tracking-widest text-dim shrink-0">Master Trace</span>
                <span className="text-[9px] text-white/30 truncate hidden sm:inline">post-synth · pre Kill-Chain</span>
              </div>
              <Scope />
            </div>
          </div>
          <div className="mt-2 text-center text-[10px] text-dim">
            Output bay — three wavetable stacks plus the living master trace.
          </div>
        </Section>
        <Section title="Performance" color={FIRE} collapseKey="performance" chipHosted>
          <PerformanceStageViz />
          <div className="flex flex-wrap items-center justify-evenly gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-dim">Octave</span>
              <Stepper onClick={() => shiftOctave(-1)}>−</Stepper>
              <div className="w-6 text-center font-mono text-sm" style={{ color: FIRE }}>{octave}</div>
              <Stepper onClick={() => shiftOctave(1)}>+</Stepper>
            </div>
            <Seg<"poly" | "mono">
              value={mono ? "mono" : "poly"}
              onChange={(v) => setParam("mono", v === "mono")}
              options={[{ id: "poly", label: "Poly" }, { id: "mono", label: "Mono" }]}
            />
            <HarmonyPicker />
            <button
              onClick={() => setRouteThroughFx(!fxOn)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                fxOn ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_18px_rgb(var(--c-cyan)/0.3)]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
              }`}
              title="Run the synth through the program's EQ/FX chain, or play it raw."
            >{fxOn ? "● Kill-Chain FX: ON" : "FX: OFF (raw)"}</button>
            <div className="flex items-center gap-1.5" title="Polyphony cap. Higher = richer chords but more CPU; lower this if audio crackles or drops out.">
              <span className="text-[10px] uppercase tracking-widest text-dim">Voices</span>
              <Seg<string>
                value={String(maxVoices)}
                onChange={(v) => setMaxVoices(Number(v))}
                options={[{ id: "6", label: "6" }, { id: "8", label: "8" }, { id: "12", label: "12" }, { id: "16", label: "16" }, { id: "24", label: "24" }, { id: "32", label: "32" }]}
              />
            </div>
            <FParamKnob paramKey="masterGain" label="Master" min={0} max={1.2} format={fmtPct} def={0.72} size={38} />
            <button
              onClick={() => {
                useFireSequencerStore.getState().stop();
                panic();
              }}
              className="rounded-lg border border-rose-400/40 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 transition"
              title="Stop the sequencer and silence every voice"
            >✕ Cease Fire</button>
          </div>
        </Section>
      </FireBand>

      <FireBand title="Sources" color={FC_BAND.sources} bandKey="band.sources" hint="oscillators · spectral warp">
        <OscPanel group="a" chipHosted />
        <OscPanel group="b" chipHosted />
        <OscPanel group="c" chipHosted />
        <Section
          title="Spectral Warp"
          color={FC.warp}
          collapseKey="fire.sec.warp"
          chipHosted
          right={
            <span className="text-[9px] text-dim normal-case tracking-normal">
              reshapes harmonics of all three oscillators
            </span>
          }
        >
          <WarpStageViz />
          <div className="flex items-center justify-evenly gap-2">
            <FParamKnob paramKey="warpStretch" label="Stretch" min={-1} max={1} bipolar format={fmtBi} def={0} color={FC.warp} />
            <FParamKnob paramKey="warpTilt" label="Tilt" min={-1} max={1} bipolar format={fmtBi} def={0} color={FC.warp} />
            <FParamKnob paramKey="warpComb" label="Comb" min={0} max={1} format={fmtPct} def={0} color={FC.warp} />
          </div>
          <div className="mt-2 text-center text-[10px] text-dim">
            Harmonic forge — Stretch slides partials · Tilt tips bright/dark · Comb notches even harmonics.
          </div>
        </Section>
      </FireBand>

      <FireBand title="Tone" color={FC_BAND.tone} bandKey="band.tone" hint="unison · filter · envelopes">
        <Section title="Mixer · Unison" color={FC.unison} collapseKey="mixer.unison" chipHosted right={
          <FSeg<SubWave> paramKey="subWave" options={[{ id: "sine", label: "Sin" }, { id: "triangle", label: "Tri" }, { id: "square", label: "Sqr" }, { id: "sawtooth", label: "Saw" }]} />
        }>
          <UnisonStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="subLevel" label="Sub" min={0} max={1} format={fmtPct} def={0.3} color={FC.unison} />
            <FParamKnob paramKey="noiseLevel" label="Noise" min={0} max={1} format={fmtPct} def={0} color={FC.unison} />
            <FParamKnob paramKey="noiseColor" label="Color" min={-1} max={1} bipolar format={fmtBi} def={0} color={FC.unison} />
            <FParamKnob paramKey="unison" label="Unison" min={1} max={7} integer format={fmtInt} def={3} color={FC.unison} />
            <FParamKnob paramKey="unisonDetune" label="Detune" min={0} max={50} integer format={fmtCents} def={14} color={FC.unison} />
            <FParamKnob paramKey="unisonWidth" label="Width" min={0} max={1} format={fmtPct} def={0.5} color={FC.unison} />
            <FParamKnob paramKey="stereoWidth" label="Stereo" min={0} max={1.4} format={fmtPct} def={1} color={FC.unison} />
            <FParamKnob paramKey="drift" label="Drift" min={0} max={1} format={fmtPct} def={0} color={FC.unison} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Voice fan — sub/noise rails below, detuned copies across the stereo field.</div>
        </Section>
        <Section title="Filter" color={FC.filter} collapseKey="filter" chipHosted right={
          <FSeg<FireFilterType> paramKey="filterType" options={[{ id: "lowpass", label: "LP" }, { id: "bandpass", label: "BP" }, { id: "highpass", label: "HP" }, { id: "notch", label: "NT" }]} />
        }>
          <FilterStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="filterCutoff" label="Cutoff" min={20} max={18000} curve="log" format={fmtHz} def={2600} size={46} color={FC.filter} />
            <FParamKnob paramKey="filterResonance" label="Reso" min={0.1} max={28} curve="log" format={fmtQ} def={3} color={FC.filter} />
            <FParamKnob paramKey="filterEnvAmount" label="Env Amt" min={-1} max={1} bipolar format={fmtBi} def={0} color={GRN} />
            <FParamKnob paramKey="filterKeyTrack" label="Key Trk" min={0} max={1} format={fmtPct} def={0.3} color={FC.filter} />
            <FParamKnob paramKey="filterDrive" label="Sat" min={0} max={1} format={fmtPct} def={0} color={FC.filter} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Frequency bay — response curve tracks type, cutoff, resonance and env push.</div>
        </Section>
        <Section title="Amp Envelope" color={FC.envAmp} collapseKey="env.amp" chipHosted right={<LpgToggle />}>
          <AmpEnvStageViz />
          <LpgAwareAmpRow />
        </Section>
        <Section title="Mod Envelope → Morph" color={FC.envMod} collapseKey="env.mod" chipHosted>
          <ModEnvStageViz />
          <AdsrRow a="modAttack" d="modDecay" s="modSustain" r="modRelease" color={FC.envMod} />
          <div className="mt-1.5 text-center text-[10px] text-dim">Morph pulse — shapes wavetable travel over the note.</div>
        </Section>
        <Section title="Filter Envelope" color={FC.envFilt} collapseKey="env.filt" chipHosted>
          <FiltEnvStageViz />
          <AdsrRow a="filtAttack" d="filtDecay" s="filtSustain" r="filtRelease" color={FC.envFilt} />
          <div className="mt-1.5 text-center text-[10px] text-dim">Cutoff sweep — opens and closes the filter over time.</div>
        </Section>
      </FireBand>

      <FireBand title="Modulation" color={FC_BAND.mod} bandKey="band.mod" hint="lfos · fm · pitch · matrix · arp">
        <LfoPanel idx={1} chipHosted />
        <LfoPanel idx={2} chipHosted />
        <Section title="FM · Ring" color={FC.fm} collapseKey="fm" chipHosted>
          <FmRingStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="fmAmount" label="FM Amt" min={0} max={1} format={fmtPct} def={0} color={FC.fm} />
            <FParamKnob paramKey="fmRatio" label="FM Ratio" min={0.5} max={12} curve="log" format={fmtRatio} def={2} color={FC.fm} />
            <FParamKnob paramKey="fmBtoA" label="B→A FM" min={0} max={1} format={fmtPct} def={0} color={FC.fm} />
            <FParamKnob paramKey="ringAmount" label="Ring" min={0} max={1} format={fmtPct} def={0} color={FC.fm} />
            <FParamKnob paramKey="ringFreq" label="Ring Hz" min={20} max={4000} curve="log" format={fmtHz} def={220} color={FC.fm} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">FM lattice + ring beat — ratio spokes, sidebands, metallic chew.</div>
        </Section>
        <Section title="Pitch · Glide" color={FC.pitch} collapseKey="pitch" chipHosted>
          <PitchGlideStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="pitchEnvAmount" label="Ptch Env" min={-48} max={48} integer bipolar format={fmtSemi} def={0} color={GRN} />
            <FParamKnob paramKey="pitchEnvTime" label="Env Time" min={0.01} max={2} curve="log" format={fmtSec} def={0.2} color={GRN} />
            <FParamKnob paramKey="glide" label="Glide" min={0} max={1} format={fmtSec} def={0.06} color={FC.pitch} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Pitch rail — envelope ramp left, portamento trail right (Mono).</div>
        </Section>
        <ModMatrixPanel chipHosted />
        <ArpPanel arp={arp} setArp={setArp} chipHosted />
      </FireBand>

      <FireBand title="FX" color={FC_BAND.fx} bandKey="band.fx" hint="drive through spectral">
        <Section title="Drive · Punch" color={FC.drive} collapseKey="fx.drive" chipHosted right={
          <FSeg<DriveMode> paramKey="driveMode" options={[{ id: "soft", label: "Soft" }, { id: "tube", label: "Tube" }, { id: "fold", label: "Fold" }, { id: "hard", label: "Hard" }, { id: "fuzz", label: "Fuzz" }]} />
        }>
          <DriveStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="drive" label="Drive" min={0} max={1} format={fmtPct} def={0.08} color={FC.drive} />
            <FParamKnob paramKey="crush" label="Crush" min={0} max={1} format={fmtPct} def={0} color={FC.drive} />
            <FParamKnob paramKey="tone" label="Tone" min={1000} max={18000} curve="log" format={fmtHz} def={15000} size={46} color={FC.drive} />
            <FParamKnob paramKey="punch" label="Punch" min={0} max={1} format={fmtPct} def={0} color={FC.drive} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Magma forge — transfer curve left, living sine crushed right.</div>
        </Section>
        <Section title="Phaser" color={FC.phaser} collapseKey="fx.phaser" chipHosted>
          <PhaserStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="phaserRate" label="Rate" min={0.02} max={12} curve="log" format={fmtHzRate} def={0.4} color={FC.phaser} />
            <FParamKnob paramKey="phaserDepth" label="Depth" min={0} max={1} format={fmtPct} def={0.6} color={FC.phaser} />
            <FParamKnob paramKey="phaserMix" label="Mix" min={0} max={1} format={fmtPct} def={0} color={FC.phaser} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Sweep notches crawl the spectrum — mix brings them in.</div>
        </Section>
        <Section title="Chorus" color={FC.chorus} collapseKey="fx.chorus" chipHosted>
          <ChorusStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="chorusRate" label="Rate" min={0.05} max={8} curve="log" format={fmtHzRate} def={0.6} color={FC.chorus} />
            <FParamKnob paramKey="chorusDepth" label="Depth" min={0} max={1} format={fmtPct} def={0.4} color={FC.chorus} />
            <FParamKnob paramKey="chorusMix" label="Mix" min={0} max={1} format={fmtPct} def={0.25} color={FC.chorus} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Ensemble shimmer — detuned voices breathe around the dry signal.</div>
        </Section>
        <Section title="Delay (Ping-Pong)" color={FC.delay} collapseKey="fx.delay" chipHosted>
          <DelayStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="delayTime" label="Time" min={0.01} max={1.5} curve="log" format={fmtSec} def={0.28} color={FC.delay} />
            <FParamKnob paramKey="delayFeedback" label="Fbk" min={0} max={0.92} format={fmtPct} def={0.3} color={FC.delay} />
            <FParamKnob paramKey="delayMix" label="Mix" min={0} max={1} format={fmtPct} def={0} color={FC.delay} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Ping-pong corridor — echoes bounce L↔R and decay with feedback.</div>
        </Section>
        <Section title="Reverb" color={FC.reverb} collapseKey="fx.reverb" chipHosted>
          <ReverbStageViz />
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob paramKey="reverbSize" label="Size" min={0.3} max={6} curve="log" format={fmtSec} def={2.2} color={FC.reverb} />
            <FParamKnob paramKey="reverbMix" label="Mix" min={0} max={1} format={fmtPct} def={0} color={FC.reverb} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">Room bloom — impulse rings expand with Size, denser with Mix.</div>
        </Section>
        <SpectralPanel chipHosted />
      </FireBand>

      <FireBand title="Performance Tools" color={FC_BAND.perf} bandKey="band.perf" hint="macros · trance gate" defaultCollapsed>
        <MacrosPanel chipHosted />
        <GatePanel chipHosted />
      </FireBand>

      {/* Keyboard */}
      {keyboardMinimized ? (
        <div className="sticky bottom-0 z-10 pt-2">
          <GlassPanel intense className="px-4 py-2.5 flex items-center justify-between">
            <div className="text-[11px] text-dim">
              <span className="uppercase tracking-[0.3em] mr-3">Keyboard hidden</span>
              <span className="font-mono text-white/70">A W S E D F T G…</span> still plays · octave {octave}
            </div>
            <button onClick={toggleKeyboard} className="rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs text-white/80 transition">▲ Show keyboard</button>
          </GlassPanel>
        </div>
      ) : (
        <Keyboard octave={octave} onMinimize={toggleKeyboard} />
      )}

      <PresetBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} />
    </div>
    </FireLayoutProvider>
  );
}

// ════════════════════ wavetable display ════════════════════

function WaveDisplay({ group, color }: { group: "a" | "b" | "c"; color: string }) {
  const table = useFireCommandStore((s) => (group === "a" ? s.patch.oscATable : group === "b" ? s.patch.oscBTable : s.patch.oscCTable));
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastTick = 0;
    let lastPos = -1;
    const MIN_INTERVAL = 33;
    const cache: Float32Array[] = [];
    let cacheTable = "";
    const N = 96;
    const size = { w: 250, h: 96 };
    const ensureCache = (id: string) => {
      if (cacheTable === id && cache.length) return;
      cache.length = 0;
      for (let i = 0; i < FRAME_COUNT; i++) cache.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
      cacheTable = id;
    };
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      size.w = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      size.h = 96;
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastPos = -1; // force redraw after resize
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < MIN_INTERVAL) return;
      lastTick = nowMs;
      let pos = 0.5;
      try { pos = getEngine().fireCommand.getMorphPositions()[group]; } catch { /* not ready */ }
      if (lastPos >= 0 && Math.abs(pos - lastPos) < 0.0008) return;
      lastPos = pos;
      ensureCache(table);
      const w = size.w;
      const h = size.h;
      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, `${color}22`);
      bg.addColorStop(0.45, "rgba(4,4,8,0.85)");
      bg.addColorStop(1, `${color}10`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      for (let g = 0; g < 5; g++) {
        const y = 12 + g * ((h - 28) / 4);
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(w - 8, y);
        ctx.stroke();
      }

      const curFrame = pos * (FRAME_COUNT - 1);
      const padX = 14;
      const skew = Math.min(28, w * 0.08);
      const topY = 14;
      const usableW = Math.max(8, w - padX * 2 - skew);
      const amp = h * 0.075;
      for (let i = 0; i < FRAME_COUNT; i++) {
        const depth = i / (FRAME_COUNT - 1);
        const baseY = topY + depth * (h - topY - 24);
        const xoff = padX + (1 - depth) * skew;
        const near = 1 - Math.min(1, Math.abs(i - curFrame));
        ctx.beginPath();
        const samp = cache[i];
        for (let x = 0; x < N; x++) {
          const px = xoff + (x / (N - 1)) * usableW;
          const py = baseY - samp[x] * amp;
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = `rgba(255,255,255,${0.05 + depth * 0.07})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (near > 0.001) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = near * 0.85;
          ctx.lineWidth = 1.6;
          ctx.shadowBlur = 4;
          ctx.shadowColor = color;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }
      const lo = Math.floor(curFrame);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = curFrame - lo;
      const frontY = h - 14;
      ctx.beginPath();
      ctx.moveTo(padX, frontY);
      for (let x = 0; x < N; x++) {
        const v = cache[lo][x] * (1 - frac) + cache[hi][x] * frac;
        const px = padX + (x / (N - 1)) * (w - padX * 2);
        const py = frontY - v * (h * 0.14);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(w - padX, frontY);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, frontY - h * 0.2, 0, frontY);
      fill.addColorStop(0, `${color}44`);
      fill.addColorStop(1, `${color}00`);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      for (let x = 0; x < N; x++) {
        const v = cache[lo][x] * (1 - frac) + cache[hi][x] * frac;
        const px = padX + (x / (N - 1)) * (w - padX * 2);
        const py = frontY - v * (h * 0.14);
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 14;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const mx = padX + pos * (w - padX * 2);
      // Morph scan beam through the stack
      const beam = ctx.createLinearGradient(mx, 0, mx, h);
      beam.addColorStop(0, `${color}00`);
      beam.addColorStop(0.35, `${color}55`);
      beam.addColorStop(1, `${color}00`);
      ctx.fillStyle = beam;
      ctx.fillRect(mx - 1.5, 4, 3, h - 10);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(mx - 1, 4, 2, 8);

      ctx.font = "700 8px ui-monospace, Menlo, monospace";
      ctx.fillStyle = `${color}99`;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(pos * 100)}%`, w - 8, h - 6);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [table, group, color]);
  return (
    <div ref={wrapRef} className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
        <span className="text-[10px] uppercase tracking-widest text-dim shrink-0">Osc {group.toUpperCase()}</span>
        <span className="text-[10px] font-mono truncate" style={{ color }} title={wavetableName(table)}>{wavetableName(table)}</span>
      </div>
      <canvas
        ref={ref}
        className="block w-full h-[96px] rounded-md border bg-[#06060a]/90"
        style={{
          borderColor: `${color}44`,
          boxShadow: `inset 0 0 0 1px ${color}14, inset 0 0 28px ${color}18, 0 0 16px ${color}10`,
        }}
      />
    </div>
  );
}

function Scope() {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastTick = 0;
    let idleCleared = false;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const size = { w: 520, h: 100 };
    /** Phosphor persistence — recent frames fade behind the live trace. */
    const phosphor: Float32Array[] = [];
    const PHOSPHOR_N = 5;

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      size.w = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      size.h = 100;
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      phosphor.length = 0;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);

    const MIN_INTERVAL = 22;
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < MIN_INTERVAL) return;
      lastTick = nowMs;
      let analyser: AnalyserNode | null = null;
      let running = false;
      try { const e = getEngine(); analyser = e.analyserPost; running = e.ctx.state === "running"; } catch { analyser = null; }
      const w = size.w;
      const h = size.h;
      if (!analyser || !running) {
        if (!idleCleared) {
          ctx.clearRect(0, 0, w, h);
          const bg = ctx.createLinearGradient(0, 0, w, h);
          bg.addColorStop(0, "rgba(255,106,61,0.04)");
          bg.addColorStop(1, "rgba(0,0,0,0.3)");
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = "rgba(255,255,255,0.06)";
          ctx.beginPath();
          ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
          ctx.stroke();
          idleCleared = true;
        }
        return;
      }
      idleCleared = false;
      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "rgba(255,106,61,0.08)");
      bg.addColorStop(0.45, "rgba(4,6,4,0.88)");
      bg.addColorStop(1, "rgba(40,90,40,0.08)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // CRT scanlines
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

      ctx.strokeStyle = "rgba(120,255,140,0.06)";
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(120,255,140,0.12)";
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      const N = buf.length;
      const samples = new Float32Array(N);
      for (let i = 0; i < N; i++) samples[i] = (buf[i] - 128) / 128;
      phosphor.push(samples);
      if (phosphor.length > PHOSPHOR_N) phosphor.shift();

      // Phosphor ghosts (oldest → newest)
      for (let g = 0; g < phosphor.length; g++) {
        const ghost = phosphor[g];
        const age = (g + 1) / phosphor.length;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * w;
          const y = h / 2 - ghost[i] * (h / 2) * 0.88;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(140,255,120,${0.08 + age * 0.18})`;
        ctx.lineWidth = 1.2 + age * 0.8;
        ctx.stroke();
      }

      // Live under-fill
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = h / 2 - samples[i] * (h / 2) * 0.88;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h / 2);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, "rgba(160,255,120,0.22)");
      fill.addColorStop(0.55, "rgba(255,106,61,0.1)");
      fill.addColorStop(1, "rgba(255,106,61,0)");
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#b8ff8a";
      ctx.shadowBlur = 14;
      ctx.shadowColor = "#7cff5a";
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = h / 2 - samples[i] * (h / 2) * 0.88;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Sweep pip
      const pipX = ((nowMs / 18) % w);
      ctx.fillStyle = "rgba(200,255,160,0.35)";
      ctx.fillRect(pipX, 0, 2, h);

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(160,255,120,0.45)";
      ctx.textAlign = "left";
      ctx.fillText("MASTER SCOPE · PHOSPHOR", 8, h - 6);

      // Edge vignette
      const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.65);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-md border border-[#7cff5a]/28 bg-[#050805]/95 shadow-[inset_0_0_0_1px_rgba(120,255,140,0.06),inset_0_0_32px_rgba(0,0,0,0.75),0_0_22px_rgba(100,255,120,0.1)]"
    >
      <canvas ref={ref} className="block w-full" style={{ height: 100 }} />
      <span className="pointer-events-none absolute inset-1 rounded-[3px] border border-[#7cff5a]/10" />
    </div>
  );
}

function VoiceCount() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    let lastN = -1;
    const MIN_INTERVAL = 120; // ~8 fps — a voice counter doesn't need 60
    const tick = (nowMs: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (nowMs - lastTick < MIN_INTERVAL) return;
      lastTick = nowMs;
      if (!ref.current) return;
      let n = 0;
      try { n = getEngine().fireCommand.getActiveVoiceCount(); } catch { n = 0; }
      if (n === lastN) return;
      lastN = n;
      ref.current.textContent = `${n} voice${n === 1 ? "" : "s"}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span ref={ref} className="text-[10px] font-mono text-white/60">0 voices</span>;
}

// ════════════════════ module visualizations (MK IV eye candy) ════════════════════

/** ADSR curve — a live picture of the envelope the knobs describe. */
function EnvGraph({ a, d, s, r, color = GRN }: { a: NumericKey; d: NumericKey; s: NumericKey; r: NumericKey; color?: string }) {
  const av = useFireCommandStore((st) => st.patch[a]) as number;
  const dv = useFireCommandStore((st) => st.patch[d]) as number;
  const sv = useFireCommandStore((st) => st.patch[s]) as number;
  const rv = useFireCommandStore((st) => st.patch[r]) as number;
  const W = 220, H = 44, PAD = 3;
  // Log-ish time weighting so short attacks stay visible next to long tails.
  const seg = (t: number) => Math.pow(Math.max(0.001, t), 0.5);
  const holdW = 0.55; // fixed sustain-hold plateau share
  const tot = seg(av) + seg(dv) + seg(rv);
  const wA = (seg(av) / tot) * (1 - 0.22) * (W - PAD * 2) * (1 - holdW * 0.4);
  const wD = (seg(dv) / tot) * (1 - 0.22) * (W - PAD * 2) * (1 - holdW * 0.4);
  const wR = (seg(rv) / tot) * (1 - 0.22) * (W - PAD * 2) * (1 - holdW * 0.4);
  const wS = (W - PAD * 2) - wA - wD - wR;
  const y = (level: number) => PAD + (1 - level) * (H - PAD * 2);
  const x0 = PAD;
  const x1 = x0 + wA;
  const x2 = x1 + wD;
  const x3 = x2 + Math.max(6, wS);
  const x4 = Math.min(W - PAD, x3 + wR);
  const path = `M ${x0} ${y(0)} Q ${x0 + wA * 0.4} ${y(0.85)} ${x1} ${y(1)} Q ${x1 + wD * 0.35} ${y(sv + (1 - sv) * 0.25)} ${x2} ${y(sv)} L ${x3} ${y(sv)} Q ${x3 + wR * 0.35} ${y(sv * 0.25)} ${x4} ${y(0)}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block rounded-md bg-black/30 mb-1.5" style={{ height: H }} aria-hidden>
      <line x1={x3} y1={PAD} x2={x3} y2={H - PAD} stroke="rgba(255,255,255,0.06)" />
      <line x1={x1} y1={PAD} x2={x1} y2={H - PAD} stroke="rgba(255,255,255,0.06)" />
      <path d={`${path} L ${x4} ${H - PAD} L ${x0} ${H - PAD} Z`} fill={`${color}14`} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 3px ${color}88)` }} />
      <circle cx={x1} cy={y(1)} r={2} fill={color} />
      <circle cx={x2} cy={y(sv)} r={2} fill={color} />
    </svg>
  );
}

/** Vactrol pluck curve for LPG mode — strike, ring, die. */
function LpgGraph() {
  const decay = useFireCommandStore((s) => s.patch.lpgDecay);
  const color = "#ffcf5c";
  const W = 220, H = 44, PAD = 3;
  const k = 4 / Math.max(0.05, decay);
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * 2.5;
    const v = Math.min(1, t / 0.012) * Math.exp(-k * t * 0.4);
    pts.push(`${PAD + (i / 60) * (W - PAD * 2)},${PAD + (1 - v) * (H - PAD * 2)}`);
  }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block rounded-md bg-black/30 mb-1.5" style={{ height: H }} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 3px ${color}88)` }} />
    </svg>
  );
}

/** Animated LFO scope — the waveform with a phase-locked tracer dot. */
function LfoScope({ idx }: { idx: 1 | 2 }) {
  const wave = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Wave : s.patch.lfo2Wave));
  const rate = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Rate : s.patch.lfo2Rate));
  const depth = useFireCommandStore((s) => (idx === 1 ? s.patch.lfo1Depth : s.patch.lfo2Depth));
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ wave, rate, depth });
  stateRef.current = { wave, rate, depth };
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastTick = 0;
    const shape = (w: LfoWave, ph: number): number => {
      const p = ph - Math.floor(ph);
      switch (w) {
        case "sine": return Math.sin(p * Math.PI * 2);
        case "triangle": return 1 - 4 * Math.abs(p - 0.5);
        case "sawtooth": return 1 - 2 * p;
        case "square": return p < 0.5 ? 1 : -1;
        case "sample-hold": {
          // Deterministic pseudo-random stairs so the picture is stable.
          const step = Math.floor(ph * 8);
          const h = Math.sin(step * 127.1) * 43758.5453;
          return (h - Math.floor(h)) * 2 - 1;
        }
        default: return 0;
      }
    };
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < 40) return; // 25 fps is plenty
      lastTick = nowMs;
      const { wave: w, rate: rt, depth: dp } = stateRef.current;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const mid = H / 2;
      const amp = (H / 2 - 3) * Math.max(0.12, dp);
      // zero line
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
      // two cycles of the waveform
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 1.6;
      ctx.shadowBlur = 5; ctx.shadowColor = ICE;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = mid - shape(w, (x / W) * 2) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // tracer synced to the engine clock (same phase the DSP mod loop uses)
      let t = nowMs / 1000;
      try { t = getEngine().ctx.currentTime; } catch { /* fallback */ }
      const ph = (t * rt) % 2;
      const px = (ph / 2) * W;
      const py = mid - shape(w, ph) * amp;
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 8; ctx.shadowColor = ICE;
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={220} height={40} className="w-full h-[40px] rounded-md bg-black/30 mb-1.5" />;
}

/** Filter response sketch — type/cutoff/reso drawn on a log frequency axis. */
function FilterCurveViz() {
  const type = useFireCommandStore((s) => s.patch.filterType);
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff);
  const res = useFireCommandStore((s) => s.patch.filterResonance);
  const W = 220, H = 44, PAD = 3;
  const fLo = 20, fHi = 20000;
  const xOf = (f: number) => PAD + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (W - PAD * 2);
  const peak = Math.min(1, Math.log10(Math.max(1, res)) * 0.75); // resonance bump 0..1
  const gain = (f: number): number => {
    const r = f / Math.max(30, cutoff);
    const bump = peak * Math.exp(-Math.pow(Math.log2(r), 2) * 9);
    let g: number;
    if (type === "lowpass") g = 1 / Math.sqrt(1 + Math.pow(r, 4));
    else if (type === "highpass") g = 1 / Math.sqrt(1 + Math.pow(1 / r, 4));
    else if (type === "bandpass") g = Math.exp(-Math.pow(Math.log2(r), 2) * 1.4);
    else g = 1 - Math.exp(-Math.pow(Math.log2(r), 2) * 9); // notch
    return Math.min(1.6, g + (type === "notch" ? 0 : bump));
  };
  const pts: string[] = [];
  for (let i = 0; i <= 72; i++) {
    const f = fLo * Math.pow(fHi / fLo, i / 72);
    const g = gain(f);
    pts.push(`${xOf(f)},${PAD + (1 - Math.min(1, g / 1.6)) * (H - PAD * 2)}`);
  }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block rounded-md bg-black/30 mb-1.5" style={{ height: H }} aria-hidden>
      {[100, 1000, 10000].map((f) => (
        <line key={f} x1={xOf(f)} y1={PAD} x2={xOf(f)} y2={H - PAD} stroke="rgba(255,255,255,0.05)" />
      ))}
      <polyline points={pts.join(" ")} fill="none" stroke={FIRE} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 3px ${FIRE}88)` }} />
      <line x1={xOf(Math.max(fLo, Math.min(fHi, cutoff)))} y1={PAD} x2={xOf(Math.max(fLo, Math.min(fHi, cutoff)))} y2={H - PAD} stroke={`${FIRE}55`} strokeDasharray="2 3" />
    </svg>
  );
}

/** Mini contour glyphs for each arp mode — pure decoration, no behavior change. */
const ARP_MODE_GLYPHS: Record<ArpMode, string> = {
  up: "M2 14 L6 10 L10 6 L14 2",
  down: "M2 2 L6 6 L10 10 L14 14",
  updown: "M2 12 L5 4 L8 12 L11 4 L14 12",
  downup: "M2 4 L5 12 L8 4 L11 12 L14 4",
  converge: "M2 2 L8 8 L2 14 M14 2 L8 8 L14 14",
  diverge: "M8 8 L2 2 M8 8 L2 14 M8 8 L14 2 M8 8 L14 14",
  pedal: "M2 12 L6 4 L6 12 L10 4 L10 12 L14 4",
  random: "M3 10 L5 4 L8 11 L11 3 L13 9",
  walk: "M2 8 Q5 2 8 8 T14 8",
  asplayed: "M2 10 L5 10 L5 6 L8 6 L8 12 L11 12 L11 4 L14 4",
};

type ArpPt = { x: number; y: number; midi: number; accented: boolean; i: number; hue: number };
type ArpBloom = { x: number; y: number; life: number; accented: boolean; hue: number };
type ArpAfterglow = { i: number; life: number; hue: number };

/** Pitch → hue: lows ember, mids amber, highs ice — shifts slowly with time. */
function arpHue(midi: number, lo: number, span: number, tMs: number): number {
  const n = (midi - lo) / Math.max(1, span);
  return 12 + n * 38 + Math.sin(tMs / 2800 + n * 2.4) * 10;
}

/** Arp sequence stage — hi-DPI depth field, color-shifting contour, targeting blooms. Display only. */
function ArpViz({ arp }: { arp: ArpSettings }) {
  const arpOrder = useFireCommandStore((s) => s.arpOrder);
  const arpStepIndex = useFireCommandStore((s) => s.arpStepIndex);
  const arpCurrent = useFireCommandStore((s) => s.arpCurrent);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bloomsRef = useRef<ArpBloom[]>([]);
  const afterglowRef = useRef<ArpAfterglow[]>([]);
  const lastStepRef = useRef(-1);
  const pulseRef = useRef(0);
  const sizeRef = useRef({ w: 720, h: 132, dpr: 1 });
  const stateRef = useRef({ arp, arpOrder, arpStepIndex, arpCurrent });
  stateRef.current = { arp, arpOrder, arpStepIndex, arpCurrent };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const syncSize = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      const cssH = 132;
      sizeRef.current = { w: cssW, h: cssH, dpr };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(wrap);

    let raf = 0;
    let lastTick = 0;

    const drawContourPath = (pts: ArpPt[]) => {
      if (pts.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) return;
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      const last = pts[pts.length - 1];
      ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
    };

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < 22) return;
      lastTick = nowMs;
      const { arp: a, arpOrder: order, arpStepIndex: stepIdx, arpCurrent: cur } = stateRef.current;
      const { w: W, h: H } = sizeRef.current;
      const ghost = order.length === 0;
      const held = ghost ? [60, 64, 67] : order;
      const seq = buildArpSequence(held, a.mode, a.octaves);
      ctx.clearRect(0, 0, W, H);

      // Depth field: drifting aurora wash
      const drift = (nowMs / 9000) % 1;
      const gBg = ctx.createLinearGradient(0, 0, W, H);
      const hA = 18 + Math.sin(nowMs / 3200) * 8;
      const hB = 205 + Math.cos(nowMs / 4100) * 12;
      gBg.addColorStop(0, `hsla(${hA}, 85%, 48%, 0.11)`);
      gBg.addColorStop(0.35 + drift * 0.15, "rgba(8,10,16,0.55)");
      gBg.addColorStop(0.7, `hsla(${hB}, 70%, 42%, 0.07)`);
      gBg.addColorStop(1, `hsla(${hA + 20}, 80%, 40%, 0.05)`);
      ctx.fillStyle = gBg;
      ctx.fillRect(0, 0, W, H);

      // Parallax depth grid
      const gridOff = (nowMs / 40) % 28;
      ctx.save();
      ctx.globalAlpha = 0.045;
      for (let x = -28 + gridOff; x < W + 28; x += 28) {
        ctx.strokeStyle = "rgba(255,180,120,0.9)";
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 18; y < H; y += 22) {
        ctx.strokeStyle = "rgba(140,190,255,0.7)";
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();

      // Soft vignette
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.15, W * 0.5, H * 0.5, W * 0.62);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      if (seq.length === 0) return;

      const lo = Math.min(...seq);
      const hi = Math.max(...seq);
      const span = Math.max(1, hi - lo);
      const n = Math.min(seq.length, 48);
      const PAD_X = 18;
      const PAD_Y = 22;
      const usableW = W - PAD_X * 2;
      const usableH = H - PAD_Y * 2 - 10;
      const swing = a.swing ?? 0;
      const gate = a.gate;
      const every = Math.max(0, Math.round(a.accentEvery ?? 4));
      const accentAmt = a.accent ?? 0;
      const running = !ghost && a.enabled && stepIdx >= 0;
      const breath = ghost || !a.enabled ? 0.55 + 0.45 * Math.sin(nowMs / 900) : 1;

      const pts: ArpPt[] = [];
      for (let i = 0; i < n; i++) {
        const midi = seq[i];
        const t = n === 1 ? 0.5 : i / (n - 1);
        const swingNudge = (i % 2 === 1 ? swing : -swing * 0.35) * (usableW / Math.max(1, n)) * 0.9;
        const x = PAD_X + t * usableW + swingNudge;
        const y = PAD_Y + (1 - (midi - lo) / span) * usableH;
        const accented = accentAmt > 0 && every > 0 && i % every === 0;
        pts.push({ x, y, midi, accented, i, hue: arpHue(midi, lo, span, nowMs) });
      }

      // Contour under-fill (depth volume)
      if (pts.length > 1) {
        drawContourPath(pts);
        ctx.lineTo(pts[pts.length - 1].x, H - 4);
        ctx.lineTo(pts[0].x, H - 4);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, H);
        fill.addColorStop(0, `hsla(${pts[Math.floor(pts.length / 2)].hue}, 90%, 55%, ${0.14 * breath})`);
        fill.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = fill;
        ctx.fill();

        // Wide soft glow pass
        drawContourPath(pts);
        ctx.strokeStyle = ghost
          ? `rgba(255,255,255,${0.08 * breath})`
          : `hsla(${pts[0].hue}, 90%, 60%, ${0.2 * breath})`;
        ctx.lineWidth = 8;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        // Color-shifting ribbon (hue travels along the path)
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1];
          const p1 = pts[i];
          const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
          const alpha = ghost ? 0.18 * breath : a.enabled ? 0.85 * breath : 0.4 * breath;
          g.addColorStop(0, `hsla(${p0.hue}, 95%, 62%, ${alpha})`);
          g.addColorStop(1, `hsla(${p1.hue}, 95%, 62%, ${alpha})`);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = g;
          ctx.lineWidth = 2.25;
          ctx.lineCap = "round";
          ctx.shadowBlur = a.enabled && !ghost ? 12 : 0;
          ctx.shadowColor = `hsla(${p1.hue}, 100%, 55%, 0.7)`;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Gate columns + nodes
      const colW = Math.max(4, Math.min(16, (usableW / n) * 0.5));
      for (const p of pts) {
        const isLive = running && stepIdx === p.i;
        const ag = afterglowRef.current.find((g) => g.i === p.i);
        const glowLife = ag?.life ?? 0;
        const barH = Math.max(8, (H - p.y - 8) * (0.35 + gate * 0.65));

        const cg = ctx.createLinearGradient(p.x, p.y, p.x, p.y + barH);
        const baseA = ghost ? 0.06 * breath : isLive ? 0.42 : 0.1 + glowLife * 0.25;
        cg.addColorStop(0, `hsla(${p.hue}, 90%, 65%, ${baseA})`);
        cg.addColorStop(1, `hsla(${p.hue}, 80%, 40%, 0)`);
        ctx.fillStyle = cg;
        const hw = colW / 2;
        ctx.beginPath();
        ctx.moveTo(p.x - hw, p.y);
        ctx.lineTo(p.x + hw, p.y);
        ctx.lineTo(p.x + hw * 0.7, p.y + barH);
        ctx.lineTo(p.x - hw * 0.7, p.y + barH);
        ctx.closePath();
        ctx.fill();

        const r = isLive ? 6 : p.accented ? 4.5 : 3.4;
        const core = ctx.createRadialGradient(p.x - 1, p.y - 1, 0, p.x, p.y, r * 1.8);
        if (ghost) {
          core.addColorStop(0, `rgba(255,255,255,${0.35 * breath})`);
          core.addColorStop(1, "rgba(255,255,255,0)");
        } else if (isLive) {
          core.addColorStop(0, "#fff");
          core.addColorStop(0.45, `hsla(${p.hue}, 100%, 72%, 1)`);
          core.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`);
        } else if (p.accented) {
          core.addColorStop(0, `hsla(42, 100%, 72%, ${0.9 + accentAmt * 0.1})`);
          core.addColorStop(1, "hsla(42, 100%, 50%, 0)");
        } else {
          core.addColorStop(0, `hsla(${p.hue}, 95%, 62%, 0.95)`);
          core.addColorStop(1, `hsla(${p.hue}, 90%, 45%, 0)`);
        }
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = isLive ? "#fff" : ghost ? `rgba(255,255,255,${0.35 * breath})` : `hsla(${p.hue}, 100%, 85%, 0.95)`;
        ctx.fill();

        if (p.accented && !ghost && accentAmt > 0.05) {
          ctx.strokeStyle = `hsla(42, 100%, 65%, ${0.55 + accentAmt * 0.4})`;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - r - 6);
          ctx.lineTo(p.x + 3.5, p.y - r - 1);
          ctx.lineTo(p.x - 3.5, p.y - r - 1);
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Playhead beam + note label
      if (running && stepIdx < pts.length) {
        const p = pts[stepIdx];
        const beam = ctx.createLinearGradient(p.x, 0, p.x, H);
        beam.addColorStop(0, `hsla(${p.hue}, 100%, 75%, 0)`);
        beam.addColorStop(0.35, `hsla(${p.hue}, 100%, 65%, 0.45)`);
        beam.addColorStop(1, `hsla(${p.hue}, 90%, 50%, 0)`);
        ctx.fillStyle = beam;
        ctx.fillRect(p.x - 2, 0, 4, H);

        ctx.font = "600 12px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.shadowBlur = 10;
        ctx.shadowColor = `hsla(${p.hue}, 100%, 55%, 0.9)`;
        ctx.fillText(noteName(p.midi), p.x, Math.max(14, p.y - 14));
        ctx.shadowBlur = 0;
      }

      // Targeting bloom + afterglow (not particle confetti)
      if (running && stepIdx !== lastStepRef.current && stepIdx >= 0 && stepIdx < pts.length) {
        const p = pts[stepIdx];
        bloomsRef.current.push({ x: p.x, y: p.y, life: 1, accented: p.accented, hue: p.hue });
        afterglowRef.current.push({ i: p.i, life: 1, hue: p.hue });
        if (afterglowRef.current.length > 12) afterglowRef.current.shift();
        pulseRef.current = 1;
        lastStepRef.current = stepIdx;
      }
      if (!running) lastStepRef.current = -1;

      for (let i = afterglowRef.current.length - 1; i >= 0; i--) {
        afterglowRef.current[i].life -= 0.028;
        if (afterglowRef.current[i].life <= 0) afterglowRef.current.splice(i, 1);
      }

      // Expanding reticle rings + crosshair ticks
      const blooms = bloomsRef.current;
      for (let i = blooms.length - 1; i >= 0; i--) {
        const b = blooms[i];
        b.life -= 0.038;
        if (b.life <= 0) { blooms.splice(i, 1); continue; }
        const expand = (1 - b.life) * (b.accented ? 34 : 24);
        const alpha = b.life * b.life;
        ctx.strokeStyle = `hsla(${b.hue}, 95%, 68%, ${alpha * 0.85})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 + expand, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = `hsla(${b.hue + (b.accented ? 24 : 0)}, 90%, 70%, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2 + expand * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const tick = 3 + expand * 0.15;
        const gap = 5 + expand * 0.35;
        ctx.strokeStyle = `hsla(${b.hue}, 100%, 80%, ${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(b.x - gap - tick, b.y); ctx.lineTo(b.x - gap, b.y);
        ctx.moveTo(b.x + gap, b.y); ctx.lineTo(b.x + gap + tick, b.y);
        ctx.moveTo(b.x, b.y - gap - tick); ctx.lineTo(b.x, b.y - gap);
        ctx.moveTo(b.x, b.y + gap); ctx.lineTo(b.x, b.y + gap + tick);
        ctx.stroke();
      }

      // Ratchet: double-ring pulse
      if (running && (a.ratchet ?? 0) > 0.05 && stepIdx < pts.length) {
        const p = pts[stepIdx];
        const shimmer = 0.5 + 0.5 * Math.sin(nowMs / (55 - (a.ratchet ?? 0) * 35));
        ctx.strokeStyle = `hsla(150, 70%, 65%, ${0.28 * shimmer * (a.ratchet ?? 0)})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 + shimmer * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14 + shimmer * 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Soft edge flash
      if (pulseRef.current > 0) {
        const eg = ctx.createLinearGradient(0, 0, W, 0);
        eg.addColorStop(0, `rgba(255,106,61,${pulseRef.current * 0.2})`);
        eg.addColorStop(0.5, `rgba(255,180,100,${pulseRef.current * 0.08})`);
        eg.addColorStop(1, `rgba(98,182,255,${pulseRef.current * 0.15})`);
        ctx.fillStyle = eg;
        ctx.fillRect(0, 0, W, 2);
        ctx.fillRect(0, H - 2, W, 2);
        pulseRef.current = Math.max(0, pulseRef.current - 0.05);
      }

      // Status chrome
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.fillText(a.mode.toUpperCase(), 12, H - 10);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillText(`${a.octaves} OCT`, 12 + ctx.measureText(a.mode.toUpperCase()).width + 10, H - 10);
      ctx.textAlign = "right";
      if (ghost) {
        ctx.fillStyle = `rgba(180,210,255,${0.28 * breath})`;
        ctx.fillText("HOLD A CHORD", W - 12, H - 10);
      } else if (a.enabled) {
        ctx.fillStyle = "rgba(255,160,110,0.85)";
        ctx.fillText(cur != null ? `● ${noteName(cur)}` : "● LIVE", W - 12, H - 10);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fillText("STANDBY", W - 12, H - 10);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-3 overflow-hidden rounded-2xl border border-[#ff6a3d]/22 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_28px_rgba(255,106,61,0.1),0_8px_28px_rgba(0,0,0,0.35)]"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 132 }} aria-hidden />
      <span className="pointer-events-none absolute inset-x-4 top-1.5 h-px bg-[#ff6a3d]/35" />
      <span className="pointer-events-none absolute inset-x-4 bottom-1.5 h-px bg-[#62b6ff]/25" />
    </div>
  );
}

function ArpModeGlyph({ mode, active }: { mode: ArpMode; active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path
        d={ARP_MODE_GLYPHS[mode]}
        fill="none"
        stroke={active ? "#ffd9c9" : "currentColor"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ════════════════════ osc panel ════════════════════

function OscPanel({ group, chipHosted = false }: { group: "a" | "b" | "c"; chipHosted?: boolean }) {
  const cap = group.toUpperCase();
  const tableKey = `osc${cap}Table` as keyof FirePatch;
  const posKey = `osc${cap}Pos` as NumericKey;
  const envKey = `osc${cap}Env` as NumericKey;
  const lfoKey = `osc${cap}Lfo` as NumericKey;
  const octKey = `osc${cap}Octave` as NumericKey;
  const detKey = `osc${cap}Detune` as NumericKey;
  const lvlKey = `osc${cap}Level` as NumericKey;
  const defLevel = group === "a" ? 0.75 : group === "b" ? 0.5 : 0;
  const defOct = group === "c" ? -1 : 0;
  const color = group === "a" ? FIRE : group === "b" ? "#ff9a6b" : "#ffcf5c";
  return (
    <Section
      title={`Oscillator ${cap}${group === "c" ? "  (off at 0)" : ""}`}
      color={color}
      collapseKey={`osc.${group}`}
      chipHosted={chipHosted}
      right={<TableSelect paramKey={tableKey} />}
    >
      <OscStageViz group={group} color={color} />
      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey={posKey} label="Morph" min={0} max={1} format={fmtPct} def={group === "a" ? 0.66 : 0.4} size={46} />
        <FParamKnob paramKey={envKey} label="Env→WT" min={-1} max={1} bipolar format={fmtBi} def={0} color={GRN} />
        <FParamKnob paramKey={lfoKey} label="LFO→WT" min={-1} max={1} bipolar format={fmtBi} def={0} color={ICE} />
        <FParamKnob paramKey={octKey} label="Octave" min={-2} max={2} integer bipolar format={fmtOct} def={defOct} />
        <FParamKnob paramKey={detKey} label="Detune" min={-50} max={50} integer bipolar format={fmtCents} def={0} />
        <FParamKnob paramKey={lvlKey} label="Level" min={0} max={1} format={fmtPct} def={defLevel} />
      </div>
    </Section>
  );
}

function LfoPanel({ idx, chipHosted = false }: { idx: 1 | 2; chipHosted?: boolean }) {
  const waveKey = `lfo${idx}Wave` as keyof FirePatch;
  const destKey = `lfo${idx}Dest` as keyof FirePatch;
  const rateKey = `lfo${idx}Rate` as NumericKey;
  const depthKey = `lfo${idx}Depth` as NumericKey;
  return (
    <Section title={`LFO ${idx}`} color={ICE} collapseKey={`lfo.${idx}`} chipHosted={chipHosted} right={<FLfoWave paramKey={waveKey} />}>
      <LfoStageViz idx={idx} />
      <div className="mb-2 flex justify-center">
        <FSeg<LfoDest>
          paramKey={destKey}
          color={ICE}
          options={[
            { id: "off", label: "Off" },
            { id: "pitch", label: "Pitch" },
            { id: "filter", label: "Filter" },
            { id: "volume", label: "Vol" },
            { id: "pan", label: "Pan" },
          ]}
        />
      </div>
      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey={rateKey} label="Rate" min={0.05} max={30} curve="log" format={fmtHzRate} def={idx === 1 ? 5 : 0.5} color={ICE} />
        <FParamKnob paramKey={depthKey} label="Depth" min={0} max={1} format={fmtPct} def={0} color={ICE} />
      </div>
      {idx === 1 && <div className="mt-1.5 text-center text-[10px] text-dim">LFO 1 also feeds each osc's LFO→WT amount.</div>}
      {idx === 2 && <div className="mt-1.5 text-center text-[10px] text-dim">LFO 2 — secondary modulator, independent destination.</div>}
    </Section>
  );
}

// ════════════════════ macros · gate · matrix ════════════════════

const MACRO_COLORS = [FC.macros, FC.drive, FC.oscC, FC.performance] as const;
const MACRO_KEYS = ["macro1", "macro2", "macro3", "macro4"] as const;

/** Per-macro ring meter — lives inside each command card. */
function MacroRingMeter({ value, color }: { value: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const size = 72;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const v = value;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const R = 28;
      // Track
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      // Value arc
      const start = -Math.PI * 0.75;
      const span = Math.PI * 1.5 * v;
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.shadowBlur = 8 + v * 10;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(cx, cy, R, start, start + span);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Hub pulse
      const pulse = 0.85 + 0.15 * Math.sin(t / 400 + v * 4);
      const hub = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, 12 * pulse);
      hub.addColorStop(0, "#fff8");
      hub.addColorStop(0.45, color);
      hub.addColorStop(1, `${color}00`);
      ctx.fillStyle = hub;
      ctx.beginPath();
      ctx.arc(cx, cy, 7 + v * 4, 0, Math.PI * 2);
      ctx.fill();
      // Readout
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "700 11px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${Math.round(v * 100)}`, cx, cy + 0.5);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [value, color]);
  return <canvas ref={ref} className="block mx-auto" aria-hidden />;
}

/**
 * Macros personality — four equal command cards (not a cramped radar).
 * Each card: ring meter + dest chips. Fills the bay; text never clips.
 */
function MacroClusterViz() {
  const m1 = useFireCommandStore((s) => s.patch.macro1);
  const m2 = useFireCommandStore((s) => s.patch.macro2);
  const m3 = useFireCommandStore((s) => s.patch.macro3);
  const m4 = useFireCommandStore((s) => s.patch.macro4);
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const values = [m1, m2, m3, m4];

  return (
    <div className="mb-3 grid grid-cols-2 lg:grid-cols-4 gap-2 min-w-0">
      {MACRO_KEYS.map((key, i) => {
        const routes = matrix.filter((r) => r.source === key && r.dest !== "none");
        const color = MACRO_COLORS[i];
        return (
          <div
            key={key}
            className="relative min-w-0 overflow-hidden rounded-xl border bg-gradient-to-b from-black/50 to-black/30 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            style={{ borderColor: `${color}44` }}
          >
            <div
              className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full blur-2xl opacity-40"
              style={{ background: color }}
            />
            <div className="relative flex items-center justify-between gap-1 mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color }}>
                Macro {i + 1}
              </span>
              <span className="text-[9px] font-mono text-white/35">{Math.round(values[i] * 100)}%</span>
            </div>
            <MacroRingMeter value={values[i]} color={color} />
            <div className="mt-2 min-h-[32px]">
              {routes.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/10 px-1.5 py-1 text-center text-[9px] text-white/30">
                  unpatched
                </div>
              ) : (
                <div className="flex flex-wrap gap-1 justify-center">
                  {routes.slice(0, 3).map((r) => (
                    <span
                      key={`${r.source}-${r.dest}`}
                      className="max-w-full truncate rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider"
                      style={{ borderColor: `${color}55`, color, background: `${color}18` }}
                      title={r.dest}
                    >
                      {r.dest}
                    </span>
                  ))}
                  {routes.length > 3 && (
                    <span className="text-[8px] text-white/35">+{routes.length - 3}</span>
                  )}
                </div>
              )}
            </div>
            {/* Level rail */}
            <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-75"
                style={{ width: `${Math.round(values[i] * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MacrosPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const wired = (key: typeof MACRO_KEYS[number]) =>
    matrix.filter((r) => r.source === key && r.dest !== "none").map((r) => r.dest);
  return (
    <Section title="Macros" color={FC.macros} collapseKey="macros" defaultCollapsed chipHosted={chipHosted}>
      <MacroClusterViz />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MACRO_KEYS.map((key, i) => {
          const dests = wired(key);
          return (
            <div
              key={key}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.06] bg-black/25 px-2 py-2.5"
              style={{ borderColor: `${MACRO_COLORS[i]}22` }}
            >
              <FParamKnob
                paramKey={key}
                label={`Macro ${i + 1}`}
                min={0}
                max={1}
                format={fmtPct}
                def={0}
                color={MACRO_COLORS[i]}
                size={52}
              />
              <div className="min-h-[14px] text-center text-[9px] leading-tight text-dim">
                {dests.length ? (
                  <span style={{ color: `${MACRO_COLORS[i]}cc` }}>{dests.slice(0, 2).join(" · ")}{dests.length > 2 ? "…" : ""}</span>
                ) : (
                  <span className="text-white/25">unpatched</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-center text-[10px] text-dim">
        Performance cluster — twist the knobs; cards above show live level and matrix destinations.
      </div>
    </Section>
  );
}

/** Named gate patterns — classic trance/electro chop shapes. */
const GATE_PRESETS: { name: string; steps: number[] }[] = [
  { name: "Offbeat", steps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { name: "Four Floor", steps: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0] },
  { name: "Gallop", steps: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1] },
  { name: "3-3-2", steps: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0] },
  { name: "Stutter", steps: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0] },
  { name: "Sparse", steps: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0] },
  { name: "Long-Short", steps: [1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0] },
];

/** Trance Gate personality: ice chop field — shutter silhouette with playhead beam. */
function GateChopViz({
  pattern, steps, on, playStep, depth, smooth,
}: {
  pattern: number[];
  steps: number;
  on: boolean;
  playStep: number;
  depth: number;
  smooth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ pattern, steps, on, playStep, depth, smooth });
  stateRef.current = { pattern, steps, on, playStep, depth, smooth };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const size = { w: 400, h: 96 };

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      size.w = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      size.h = 96;
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const s = stateRef.current;
      const { w: W, h: H } = size;
      ctx.clearRect(0, 0, W, H);

      // Ice depth field
      const hueShift = 195 + Math.sin(t / 3500) * 12;
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `hsla(${hueShift}, 70%, 45%, 0.10)`);
      bg.addColorStop(0.5, "rgba(4,10,18,0.55)");
      bg.addColorStop(1, `hsla(${hueShift + 20}, 60%, 40%, 0.06)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const n = Math.max(2, Math.min(16, Math.round(s.steps)));
      const padX = 12;
      const usable = W - padX * 2;
      const stepW = usable / n;
      const floor = H - 10;
      const ceil = 14;
      const ampH = floor - ceil;
      const closed = 1 - s.depth; // how far down closed steps go

      // Softened step heights (smooth blurs edges)
      const heights: number[] = [];
      for (let i = 0; i < n; i++) {
        const open = (s.pattern[i] ?? 0) > 0.5 ? 1 : closed;
        heights.push(open);
      }
      if (s.smooth > 0.01) {
        const blur = Math.max(1, Math.round(s.smooth * 3));
        const soft = heights.slice();
        for (let i = 0; i < n; i++) {
          let acc = 0, w = 0;
          for (let k = -blur; k <= blur; k++) {
            const j = (i + k + n) % n;
            const wt = 1 - Math.abs(k) / (blur + 1);
            acc += heights[j] * wt;
            w += wt;
          }
          soft[i] = acc / w;
        }
        for (let i = 0; i < n; i++) heights[i] = soft[i];
      }

      // Fill silhouette
      ctx.beginPath();
      ctx.moveTo(padX, floor);
      for (let i = 0; i < n; i++) {
        const x0 = padX + i * stepW;
        const y = floor - heights[i] * ampH;
        ctx.lineTo(x0, y);
        ctx.lineTo(x0 + stepW, y);
      }
      ctx.lineTo(padX + usable, floor);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, ceil, 0, floor);
      fill.addColorStop(0, `hsla(${hueShift}, 80%, 65%, ${s.on ? 0.35 : 0.12})`);
      fill.addColorStop(1, `hsla(${hueShift}, 70%, 40%, 0.02)`);
      ctx.fillStyle = fill;
      ctx.fill();

      // Top contour
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x0 = padX + i * stepW;
        const y = floor - heights[i] * ampH;
        if (i === 0) ctx.moveTo(x0, y);
        ctx.lineTo(x0, y);
        ctx.lineTo(x0 + stepW, y);
      }
      ctx.strokeStyle = s.on ? `hsla(${hueShift}, 90%, 70%, 0.85)` : `hsla(${hueShift}, 60%, 60%, 0.35)`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = s.on ? 10 : 0;
      ctx.shadowColor = ICE;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Step ticks
      for (let i = 0; i <= n; i++) {
        const x = padX + i * stepW;
        ctx.strokeStyle = i % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(x, ceil - 2);
        ctx.lineTo(x, floor + 2);
        ctx.stroke();
      }

      // Playhead beam
      if (s.on && s.playStep >= 0 && s.playStep < n) {
        const x = padX + s.playStep * stepW + stepW / 2;
        const beam = ctx.createLinearGradient(x, 0, x, H);
        beam.addColorStop(0, "rgba(200,240,255,0)");
        beam.addColorStop(0.4, "rgba(150,230,255,0.5)");
        beam.addColorStop(1, "rgba(98,182,255,0)");
        ctx.fillStyle = beam;
        ctx.fillRect(x - 2, 0, 4, H);

        // Pulse ring at crest
        const y = floor - heights[s.playStep] * ampH;
        const pulse = 0.5 + 0.5 * Math.sin(t / 80);
        ctx.strokeStyle = `rgba(200,240,255,${0.55 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 5 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(150,210,255,0.4)";
      ctx.fillText(s.on ? "CHOP LIVE" : "STANDBY", 12, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${n} STEPS`, W - 12, H - 8);
    };

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-3 overflow-hidden rounded-md border border-cyan/25 bg-[#050a10]/90 shadow-[inset_0_0_0_1px_rgba(98,182,255,0.06),inset_0_0_28px_rgba(0,0,0,0.55),0_6px_18px_rgba(0,0,0,0.3)]"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 96 }} aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px bg-cyan/35" />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px bg-cyan/35" />
    </div>
  );
}

function GatePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const on = useFireCommandStore((s) => s.patch.gateOn);
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const steps = useFireCommandStore((s) => s.patch.gateSteps);
  const depth = useFireCommandStore((s) => s.patch.gateDepth);
  const smooth = useFireCommandStore((s) => s.patch.gateSmooth ?? 0);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setGateStep = useFireCommandStore((s) => s.setGateStep);
  const [playStep, setPlayStep] = useState(-1);
  useEffect(() => {
    if (!on) { setPlayStep(-1); return; }
    const id = window.setInterval(() => {
      setPlayStep(getEngine().fireCommand.getGateStep());
    }, 45);
    return () => window.clearInterval(id);
  }, [on]);
  const setPattern = (p: number[]) => setParam("gatePattern", p.slice(0, 16));
  const shift = (dir: 1 | -1) => {
    const n = pattern.length;
    setPattern(pattern.map((_, i) => pattern[(i - dir + n) % n]));
  };
  return (
    <Section title="Trance Gate" color={FC.gate} collapseKey="gate" defaultCollapsed chipHosted={chipHosted} right={
      <button
        onClick={() => setParam("gateOn", !on)}
        className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${on ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_14px_rgb(98_182_255/0.35)]" : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"}`}
      >{on ? "● CHOP" : "ARM"}</button>
    }>
      <GateChopViz pattern={pattern} steps={steps} on={on} playStep={playStep} depth={depth} smooth={smooth} />

      {/* Preset strip — even chips */}
      <div className="mb-2.5 grid grid-cols-4 gap-1 sm:grid-cols-7">
        {GATE_PRESETS.map((g) => (
          <button
            key={g.name}
            onClick={() => setPattern([...g.steps])}
            className="h-7 truncate rounded-md border border-white/10 bg-white/[0.03] px-1 text-[9px] font-medium uppercase tracking-wide text-white/55 transition hover:border-cyan/40 hover:bg-cyan/10 hover:text-cyan"
            title={g.name}
          >{g.name}</button>
        ))}
      </div>

      {/* Step pads — tall, even */}
      <div className="mb-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(2, Math.min(16, Math.round(steps)))}, minmax(0, 1fr))` }}>
        {pattern.slice(0, Math.max(2, Math.min(16, Math.round(steps)))).map((v, i) => {
          const lit = v > 0.5;
          const isPlay = on && i === playStep;
          return (
            <button
              key={i}
              onClick={() => setGateStep(i, !lit)}
              className="relative h-12 rounded-lg border transition"
              style={{
                borderColor: isPlay ? "#fff" : lit ? `${ICE}99` : "rgba(255,255,255,0.1)",
                background: lit
                  ? isPlay
                    ? `linear-gradient(180deg, ${ICE}88, ${ICE}33)`
                    : `linear-gradient(180deg, ${ICE}44, ${ICE}14)`
                  : "rgba(255,255,255,0.03)",
                boxShadow: isPlay ? `0 0 16px ${ICE}66, inset 0 0 12px ${ICE}44` : lit ? `inset 0 0 10px ${ICE}33` : "none",
              }}
              title={`Step ${i + 1}`}
            >
              <span className="absolute bottom-1 left-0 right-0 text-center text-[8px] font-mono text-white/35">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbox + knobs — symmetric rails */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 items-center">
        <div className="flex flex-col gap-1">
          <button onClick={() => shift(-1)} className="h-7 rounded-md border border-white/12 bg-white/[0.03] px-2.5 text-[10px] text-white/65 transition hover:bg-white/8" title="Rotate left">◂ Shift</button>
          <button onClick={() => shift(1)} className="h-7 rounded-md border border-white/12 bg-white/[0.03] px-2.5 text-[10px] text-white/65 transition hover:bg-white/8" title="Rotate right">Shift ▸</button>
          <button onClick={() => setPattern(pattern.map((v) => (v > 0.5 ? 0 : 1)))} className="h-7 rounded-md border border-white/12 bg-white/[0.03] px-2.5 text-[10px] text-white/65 transition hover:bg-white/8" title="Invert">Invert</button>
          <button onClick={() => setPattern(Array.from({ length: 16 }, () => (Math.random() < 0.55 ? 1 : 0)))} className="h-7 rounded-md border border-white/12 bg-white/[0.03] px-2.5 text-[10px] text-white/65 transition hover:bg-white/8" title="Random">Rand</button>
        </div>
        <div className="flex items-center justify-evenly gap-2">
          <FParamKnob paramKey="gateRate" label="Rate" min={0.5} max={24} curve="log" format={fmtHzRate} def={8} color={ICE} />
          <FParamKnob paramKey="gateDepth" label="Depth" min={0} max={1} format={fmtPct} def={1} color={ICE} />
          <FParamKnob paramKey="gateSteps" label="Steps" min={2} max={16} integer format={fmtInt} def={16} color={ICE} />
          <FParamKnob paramKey="gateSmooth" label="Smooth" min={0} max={1} format={fmtPct} def={0} color={ICE} />
        </div>
      </div>
      <div className="mt-2 text-center text-[10px] text-dim">
        Ice chop field — silhouette is your amplitude. Smooth melts edges into a pump; playhead rides the crest.
      </div>
    </Section>
  );
}

const MOD_SOURCE_OPTS: { id: ModSource; label: string }[] = [
  { id: "none", label: "— off —" }, { id: "lfo1", label: "LFO 1" }, { id: "lfo2", label: "LFO 2" },
  { id: "modenv", label: "Mod Env" }, { id: "velocity", label: "Velocity" }, { id: "keytrack", label: "Key Track" },
  { id: "macro1", label: "Macro 1" }, { id: "macro2", label: "Macro 2" }, { id: "macro3", label: "Macro 3" }, { id: "macro4", label: "Macro 4" },
  { id: "random", label: "Random S&H" },
];
const MOD_DEST_OPTS: { id: ModDest; label: string }[] = [
  { id: "none", label: "— off —" }, { id: "pitch", label: "Pitch" }, { id: "cutoff", label: "Filter Cutoff" }, { id: "resonance", label: "Resonance" },
  { id: "wtA", label: "Morph A" }, { id: "wtB", label: "Morph B" }, { id: "wtC", label: "Morph C" },
  { id: "levelA", label: "Level A" }, { id: "levelB", label: "Level B" }, { id: "levelC", label: "Level C" },
  { id: "fm", label: "FM Amount" }, { id: "pan", label: "Pan" }, { id: "volume", label: "Volume" }, { id: "reverb", label: "Reverb" }, { id: "delay", label: "Delay" },
];
const SELECT_CLS = "bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-xs text-white/85 focus:outline-none focus:border-[#7cf6b0]/60 cursor-pointer";

function ModMatrixPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  const [view, setView] = useState<"grid" | "list">(() =>
    (localStorage.getItem("fire.matrixView") as "grid" | "list") ?? "grid",
  );
  const pickView = (v: "grid" | "list") => {
    setView(v);
    try { localStorage.setItem("fire.matrixView", v); } catch { /* ignore */ }
  };
  return (
    <Section
      title="Modulation Matrix"
      color={FC.matrix}
      collapseKey="matrix"
      defaultCollapsed
      chipHosted={chipHosted}
      right={
        <Seg<"grid" | "list">
          value={view}
          onChange={pickView}
          options={[{ id: "grid", label: "⊞ Bay" }, { id: "list", label: "☰ Slots" }]}
          color={FC.matrix}
        />
      }
    >
      {view === "grid" ? (
        <ModPatchGrid />
      ) : (
        <ModMatrixRows matrix={matrix} setModRoute={setModRoute} />
      )}
    </Section>
  );
}

function ModMatrixRows({
  matrix,
  setModRoute,
}: {
  matrix: ModRoute[];
  setModRoute: (index: number, partial: Partial<ModRoute>) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        {matrix.map((r, i) => {
          const active = r.source !== "none" && r.dest !== "none";
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-dim w-4 text-center">{i + 1}</span>
              <select
                value={r.source}
                onChange={(e) => setModRoute(i, { source: e.target.value as ModSource })}
                className={`${SELECT_CLS} min-w-[104px]`}
              >
                {MOD_SOURCE_OPTS.map((o) => <option key={o.id} value={o.id} className="bg-ink">{o.label}</option>)}
              </select>
              <span className="text-white/35 text-xs">→</span>
              <select
                value={r.dest}
                onChange={(e) => setModRoute(i, { dest: e.target.value as ModDest })}
                className={`${SELECT_CLS} min-w-[116px]`}
              >
                {MOD_DEST_OPTS.map((o) => <option key={o.id} value={o.id} className="bg-ink">{o.label}</option>)}
              </select>
              <div className="flex-1 min-w-[16px]" />
              <input
                type="range" min={-1} max={1} step={0.01} value={r.amount}
                onChange={(e) => setModRoute(i, { amount: Number(e.target.value) })}
                disabled={!active}
                className="w-24 sm:w-36 cursor-pointer"
                style={{ accentColor: GRN, opacity: active ? 1 : 0.4 }}
              />
              <span className="text-[10px] font-mono w-10 text-right" style={{ color: active ? GRN : "rgba(255,255,255,0.3)" }}>{fmtBi(r.amount)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-dim">{matrix.length} slots · pick a source &amp; destination, then dial bipolar depth. Velocity / Key Track / Mod Env are per-note.</div>
    </>
  );
}

// ════════════════════ arp panel ════════════════════

function ArpPanel({ arp, setArp, chipHosted = false }: { arp: ArpSettings; setArp: (p: Partial<ArpSettings>) => void; chipHosted?: boolean }) {
  const modes: { id: ArpMode; label: string }[] = [
    { id: "up", label: "Up" }, { id: "down", label: "Dn" },
    { id: "updown", label: "Up/Dn" }, { id: "downup", label: "Dn/Up" },
    { id: "converge", label: "Converge" }, { id: "diverge", label: "Diverge" },
    { id: "pedal", label: "Pedal" }, { id: "random", label: "Rnd" },
    { id: "walk", label: "Walk" }, { id: "asplayed", label: "Play" },
  ];
  const chip = (active: boolean) =>
    `rounded-md border text-[10px] font-medium uppercase tracking-wide transition ${
      active
        ? "border-[#5eb0ff]/70 bg-[#5eb0ff]/20 text-[#d6ecff] shadow-[0_0_10px_rgb(94_176_255/0.25)]"
        : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:bg-white/[0.06] hover:text-white/80"
    }`;
  return (
    <Section title="Arpeggiator" color={FC.arp} collapseKey="arp" defaultCollapsed chipHosted={chipHosted} right={
      <button
        onClick={() => setArp({ hold: !arp.hold })}
        className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${arp.hold ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_12px_rgb(34_211_238/0.25)]" : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"}`}
        title="Latch — keep arpeggiating after you let go"
      >{arp.hold ? "● Hold" : "Hold"}</button>
    }>
      <ArpViz arp={arp} />

      {/* Symmetric 3-column rails: left arm/div · center modes/knobs · right oct/every */}
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_7.5rem] gap-x-3 gap-y-3 items-center">
        {/* Row 1 left — arm */}
        <button
          onClick={() => setArp({ enabled: !arp.enabled })}
          className={`relative h-10 overflow-hidden rounded-xl border px-2 text-[11px] font-semibold tracking-wide transition ${
            arp.enabled
              ? "border-[#5eb0ff]/80 bg-gradient-to-b from-[#5eb0ff]/30 to-[#5eb0ff]/10 text-[#d6ecff] shadow-[0_0_22px_rgb(94_176_255/0.35)]"
              : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          {arp.enabled && (
            <span className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_30%_40%,rgba(214,236,255,0.18),transparent_60%)]" />
          )}
          <span className="relative">{arp.enabled ? "● ARMED" : "ARM"}</span>
        </button>

        {/* Row 1 center — modes evenly spaced */}
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {modes.map((m) => {
            const active = arp.mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setArp({ mode: m.id })}
                title={m.label}
                className={`flex h-10 flex-col items-center justify-center gap-0.5 px-0.5 ${chip(active)}`}
              >
                <ArpModeGlyph mode={m.id} active={active} />
                <span className="hidden text-[8px] leading-none xl:inline">{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* Row 1 right — octaves */}
        <div className="flex h-10 items-stretch rounded-lg border border-white/10 bg-black/20 p-0.5" title="Octave span">
          {[1, 2, 3, 4].map((o) => (
            <button
              key={o}
              onClick={() => setArp({ octaves: o })}
              className={`flex-1 rounded-md text-xs font-semibold transition ${
                arp.octaves === o
                  ? "bg-[#5eb0ff]/25 text-[#d6ecff]"
                  : "text-white/45 hover:bg-white/5 hover:text-white/80"
              }`}
            >{o}º</button>
          ))}
        </div>

        {/* Row 2 left — divisions */}
        <div className="grid grid-cols-2 gap-1">
          {(["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"] as ArpDivision[]).map((d) => (
            <button
              key={d}
              onClick={() => setArp({ division: d })}
              className={`h-7 rounded-md border font-mono text-[10px] transition ${
                arp.division === d
                  ? "border-[#5eb0ff]/60 bg-[#5eb0ff]/15 text-[#d6ecff]"
                  : "border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/5"
              }`}
            >{d}</button>
          ))}
        </div>

        {/* Row 2 center — knobs evenly spaced */}
        <div className="flex items-center justify-evenly gap-1 px-1">
          <KnobMini label="Tempo" value={arp.bpm} min={40} max={300} integer format={fmtBpm} onChange={(v) => setArp({ bpm: Math.round(v) })} />
          <KnobMini label="Gate" value={arp.gate} min={0.1} max={1} format={fmtPct} onChange={(v) => setArp({ gate: v })} />
          <KnobMini label="Swing" value={arp.swing ?? 0} min={0} max={0.33} format={(v) => `${Math.round(v * 300)}%`} onChange={(v) => setArp({ swing: v })} />
          <KnobMini label="Ratchet" value={arp.ratchet ?? 0} min={0} max={1} format={fmtPct} onChange={(v) => setArp({ ratchet: v })} />
          <KnobMini label="Accent" value={arp.accent ?? 0} min={0} max={1} format={fmtPct} onChange={(v) => setArp({ accent: v })} />
        </div>

        {/* Row 2 right — accent every (mirrors octave rail) */}
        <div className="flex flex-col items-stretch gap-0.5" title="Velocity accents every N steps">
          <div className="flex h-7 items-stretch rounded-md border border-white/10 bg-black/20 p-0.5">
            {[2, 3, 4, 6, 8].map((n) => (
              <button
                key={n}
                onClick={() => setArp({ accentEvery: n })}
                className={`flex-1 rounded text-[10px] font-semibold transition ${
                  (arp.accentEvery ?? 4) === n
                    ? "bg-[#ffcf5c]/25 text-[#ffcf5c]"
                    : "text-white/40 hover:text-white/70"
                }`}
              >{n}</button>
            ))}
          </div>
          <span className="text-center text-[9px] uppercase tracking-wide text-dim">Every</span>
        </div>
      </div>

      <div className="mt-2.5 text-center text-[10px] text-dim leading-relaxed">
        Contour = note path · gold tips = accents · columns = gate · odd steps swing · reticle blooms on hits
      </div>
    </Section>
  );
}

// ════════════════════ keyboard (1–4 octaves · default 2) ════════════════════

const KBD_OCT_KEY = "killchain.firecmd.kbd.octaves";
const WHITE_IN_OCT = [0, 2, 4, 5, 7, 9, 11];
const BLACK_IN_OCT = [1, 3, 6, 8, 10];
/** White-key index (within an octave) that each black key sits after. */
const BLACK_AFTER_WHITE: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
type KbdOctaves = 1 | 2 | 3 | 4;

function loadKbdOctaves(): KbdOctaves {
  try {
    const v = Number(window.localStorage.getItem(KBD_OCT_KEY));
    if (v === 1 || v === 2 || v === 3 || v === 4) return v;
  } catch { /* ignore */ }
  return 2;
}

function Keyboard({ octave, onMinimize }: { octave: number; onMinimize: () => void }) {
  const heldNotes = useFireCommandStore((s) => s.heldNotes);
  const arpOrder = useFireCommandStore((s) => s.arpOrder);
  const arpCurrent = useFireCommandStore((s) => s.arpCurrent);
  const arpEnabled = useFireCommandStore((s) => s.arp.enabled);
  const setOctave = useFireCommandStore((s) => s.setOctave);
  const [octaves, setOctaves] = useState<KbdOctaves>(loadKbdOctaves);
  const [hoverMidi, setHoverMidi] = useState<number | null>(null);
  const litSet = new Set(arpEnabled ? arpOrder : heldNotes);
  const mouseNote = useRef<number | null>(null);
  useEffect(() => {
    const release = () => {
      if (mouseNote.current !== null) { useFireCommandStore.getState().noteOff(mouseNote.current); mouseNote.current = null; }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); };
  }, []);
  const pickOctaves = (n: KbdOctaves) => {
    setOctaves(n);
    try { window.localStorage.setItem(KBD_OCT_KEY, String(n)); } catch { /* ignore */ }
  };
  // Velocity from strike position: near the base = loud, near the fulcrum = soft.
  const press = (midi: number, e?: React.PointerEvent) => {
    const store = useFireCommandStore.getState();
    if (mouseNote.current !== null && mouseNote.current !== midi) store.noteOff(mouseNote.current);
    mouseNote.current = midi;
    let vel = 0.9;
    if (e) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      vel = clamp(0.45 + ((e.clientY - r.top) / r.height) * 0.55, 0.45, 1);
    }
    store.noteOn(midi, vel);
  };
  const enter = (midi: number, e: React.PointerEvent) => { if (e.buttons & 1) press(midi, e); };
  const base = (octave + 1) * 12;
  const totalWhites = octaves * WHITE_IN_OCT.length;
  const whiteW = 100 / totalWhites;
  const endOct = octave + octaves - 1;
  const keyH = octaves >= 4 ? "h-36" : octaves === 3 ? "h-[9.5rem]" : "h-40";

  const keyVisual = (midi: number, black: boolean): React.CSSProperties => {
    const lit = litSet.has(midi);
    const cur = arpCurrent === midi;
    const hover = hoverMidi === midi && !lit && !cur;
    const pressed = lit || cur;
    const style: React.CSSProperties = pressed
      ? cur
        ? {
            background: `linear-gradient(180deg, #fff6f0 0%, ${FIRE} 55%, #c43a18 100%)`,
            boxShadow: `0 0 28px ${FIRE}cc, inset 0 1px 0 rgba(255,255,255,0.45)`,
          }
        : {
            background: black
              ? `linear-gradient(180deg, #ff9a6b 0%, ${FIRE} 55%, #8f2a14 100%)`
              : `linear-gradient(180deg, #ffe0d0 0%, ${FIRE} 70%, #b8351a 100%)`,
            boxShadow: `0 0 22px ${FIRE}aa, inset 0 1px 0 rgba(255,255,255,0.35)`,
          }
      : black
        ? {
            background: hover
              ? "linear-gradient(180deg, #3a4050 0%, #141820 92%)"
              : "linear-gradient(180deg, #2a2e38 0%, #08090e 92%)",
            boxShadow: "0 6px 12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.14)",
          }
        : {
            background: hover
              ? "linear-gradient(180deg, #ffffff 0%, #e8edf8 70%, #cfd6e8 100%)"
              : "linear-gradient(180deg, #f7f8fc 0%, #d5dbea 88%, #b8c0d4 100%)",
            boxShadow: "inset 0 -8px 14px rgba(0,0,0,0.18), inset 0 1px 0 #fff, 0 1px 0 rgba(0,0,0,0.25)",
          };
    style.transform = pressed ? "translateY(3px) scaleY(0.978)" : hover ? "translateY(1px)" : undefined;
    style.transformOrigin = "top";
    return style;
  };

  return (
    <div className="sticky bottom-0 z-10 pt-2">
      <GlassPanel intense className="relative overflow-hidden p-3">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 15% 0%, rgba(255,106,61,0.12), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 100%, rgba(98,182,255,0.08), transparent 50%)",
          }}
        />
        <div className="relative flex items-center justify-between mb-2.5 px-1 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/55 font-semibold">Keyboard</div>
            <span className="hidden sm:inline text-[9px] text-white/30">live · velocity · qwerty</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap" title="Scroll range (Z/X) · span on screen">
            <span className="text-[9px] font-mono text-white/50">C{Math.max(0, octave)}</span>
            <input
              type="range"
              min={0}
              max={7}
              step={1}
              value={clamp(octave, 0, 7)}
              onChange={(e) => setOctave(Number(e.target.value))}
              className="w-36 h-1.5 cursor-pointer"
              style={{ accentColor: FIRE }}
              aria-label="Keyboard base octave"
            />
            <span className="text-[9px] font-mono text-white/50">C{Math.min(9, octave + octaves)}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border border-[#ff6a3d]/30 bg-[#ff6a3d]/10 text-[#ffd9c9]">
              OCT {octaves === 1 ? String(octave) : `${octave}–${endOct}`}
            </span>
            <div className="flex items-stretch rounded-lg border border-white/12 bg-black/35 p-0.5 shadow-inner" title="Octaves on screen">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickOctaves(n)}
                  className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                    octaves === n
                      ? "bg-[#ff6a3d]/30 text-[#ffe8dc] shadow-[0_0_12px_rgba(255,106,61,0.35)]"
                      : "text-white/40 hover:bg-white/5 hover:text-white/80"
                  }`}
                  aria-pressed={octaves === n}
                >
                  {n}
                </button>
              ))}
              <span className="self-center px-1.5 text-[8px] uppercase tracking-wider text-white/30">oct</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-white/35 hidden xl:block">Strike low = loud · computer keys play too</div>
            <button
              onClick={onMinimize}
              className="rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs text-white/70 transition"
            >
              ▼ Hide
            </button>
          </div>
        </div>

        <div
          className={`relative ${keyH} select-none rounded-xl overflow-hidden`}
          style={{
            touchAction: "none",
            background: "linear-gradient(180deg, #0c0e14 0%, #06070b 100%)",
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.55)",
          }}
          onPointerLeave={() => setHoverMidi(null)}
        >
          <div
            className="absolute top-0 inset-x-0 h-1.5 z-[3]"
            style={{
              background: `linear-gradient(90deg, transparent, ${FIRE}88 18%, #ffcf5c66 50%, ${FIRE}88 82%, transparent)`,
              boxShadow: `0 0 16px ${FIRE}44`,
            }}
          />
          <div className="absolute inset-0 flex gap-[2px] px-0.5 pt-1.5 pb-0.5">
            {Array.from({ length: octaves }, (_, o) =>
              WHITE_IN_OCT.map((semi) => {
                const midi = base + o * 12 + semi;
                const lit = litSet.has(midi) || arpCurrent === midi;
                const qwerty = SEMITONE_TO_KEY[midi - base];
                const isC = semi === 0;
                return (
                  <div
                    key={`${o}-${semi}`}
                    onPointerDown={(e) => press(midi, e)}
                    onPointerEnter={(e) => { setHoverMidi(midi); enter(midi, e); }}
                    className="flex-1 rounded-b-[10px] border border-black/25 flex flex-col items-center justify-end pb-1.5 cursor-pointer transition-[background,transform,box-shadow] duration-75"
                    style={keyVisual(midi, false)}
                  >
                    {qwerty && (
                      <span
                        className={`text-[11px] font-mono font-black leading-none mb-0.5 ${
                          lit ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]" : "text-[#1a1f2e]"
                        }`}
                        style={lit ? undefined : { textShadow: "0 1px 0 rgba(255,255,255,0.35)" }}
                      >
                        {qwerty}
                      </span>
                    )}
                    <span
                      className={`text-[8px] font-bold leading-none ${
                        lit ? "text-white/90" : isC ? "text-[#3a4258]" : "text-[#5a6578]"
                      }`}
                    >
                      {isC || lit ? noteName(midi) : ""}
                    </span>
                  </div>
                );
              }),
            )}
          </div>
          <div className="absolute inset-0 pointer-events-none pt-1.5 px-0.5">
            {Array.from({ length: octaves }, (_, o) =>
              BLACK_IN_OCT.map((semi) => {
                const midi = base + o * 12 + semi;
                const whiteIdx = o * WHITE_IN_OCT.length + BLACK_AFTER_WHITE[semi];
                const qwerty = SEMITONE_TO_KEY[midi - base];
                const lit = litSet.has(midi) || arpCurrent === midi;
                return (
                  <div
                    key={`${o}-${semi}`}
                    onPointerDown={(e) => press(midi, e)}
                    onPointerEnter={(e) => { setHoverMidi(midi); enter(midi, e); }}
                    className="absolute top-1.5 h-[58%] rounded-b-lg border border-black/70 flex items-end justify-center pb-1.5 cursor-pointer pointer-events-auto transition-[background,transform,box-shadow] duration-75"
                    style={{
                      width: `${whiteW * 0.58}%`,
                      left: `${(whiteIdx + 1) * whiteW - whiteW * 0.29}%`,
                      zIndex: 2,
                      ...keyVisual(midi, true),
                    }}
                  >
                    {qwerty && (
                      <span
                        className={`text-[10px] font-mono font-black leading-none ${
                          lit ? "text-white" : "text-[#ffc4a8]"
                        }`}
                        style={
                          lit
                            ? { textShadow: "0 0 8px rgba(255,106,61,0.9)" }
                            : { textShadow: "0 0 6px rgba(255,106,61,0.45), 0 1px 2px rgba(0,0,0,0.9)" }
                        }
                      >
                        {qwerty}
                      </span>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

// ════════════════════ store-bound controls ════════════════════

function FParamKnob({
  paramKey, label, min, max, curve = "lin", integer = false, bipolar = false, format, def, color = FIRE, size = 40,
}: {
  paramKey: NumericKey; label: string; min: number; max: number; curve?: "lin" | "log"; integer?: boolean;
  bipolar?: boolean; format: (v: number) => string; def?: number; color?: string; size?: number;
}) {
  const value = useFireCommandStore((s) => s.patch[paramKey]) as number;
  const setNum = useFireCommandStore((s) => s.setParam) as (k: NumericKey, v: number) => void;
  const onChange = useCallback((v: number) => setNum(paramKey, v), [setNum, paramKey]);
  // Every store-bound knob gets a true "default position" from the init
  // patch, so the reset button always lands somewhere musical.
  const fallbackDef = DEFAULT_FIRE_PATCH[paramKey] as number | undefined;
  const effDef = def ?? (typeof fallbackDef === "number" ? clamp(fallbackDef, Math.min(min, max), Math.max(min, max)) : undefined);
  return <Dial label={label} value={value} min={min} max={max} curve={curve} integer={integer} bipolar={bipolar} format={format} def={effDef} color={color} size={size} onChange={onChange} />;
}

/**
 * Harmonizer picker (v1.7) — scale-locked companion notes on live input.
 * Follows the sequencer's Root/Scale controls; sequenced notes are untouched.
 */
function HarmonyPicker() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode);
  const level = useFireCommandStore((s) => s.patch.harmonyLevel);
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div
      className="flex items-center gap-1.5"
      title="Harmonizer: every key you play brings scale-locked companion notes (uses the piano roll's Root + Scale). Live input only."
    >
      <span className="text-[10px] uppercase tracking-widest text-dim">Harmony</span>
      <Seg<HarmonyMode>
        value={mode ?? "off"}
        onChange={(v) => setParam("harmonyMode", v)}
        options={[
          { id: "off", label: "Off" },
          { id: "third", label: "3rd" },
          { id: "fifth", label: "5th" },
          { id: "octave", label: "Oct" },
          { id: "triad", label: "Triad" },
        ]}
        color={GRN}
      />
      {mode !== "off" && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={level ?? 0.6}
          onChange={(e) => setParam("harmonyLevel", Number(e.target.value))}
          className="w-[56px]"
          style={{ accentColor: GRN }}
          aria-label="Harmony level"
          title={`Companion note level: ${Math.round((level ?? 0.6) * 100)}%`}
        />
      )}
    </div>
  );
}

/**
 * Spectral FX panel (v1.7) — the STFT worklet between reverb and autopan.
 * The amount knob means something different per mode, so the label follows.
 */
const SPECTRAL_VIOLET = FC.spectral;

function SpectralPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const mode = useFireCommandStore((s) => s.patch.spectralMode);
  const setParam = useFireCommandStore((s) => s.setParam);
  const m = mode ?? "off";
  const amountLabel = m === "freeze" ? "Hold" : m === "smear" ? "Time" : m === "gate" ? "Thresh" : m === "shift" ? "Shift" : "Amount";
  return (
    <Section
      title="Spectral"
      color={SPECTRAL_VIOLET}
      collapseKey="fx.spectral"
      chipHosted={chipHosted}
      right={
        <Seg<SpectralMode>
          value={m}
          onChange={(v) => setParam("spectralMode", v)}
          options={[
            { id: "off", label: "Off" },
            { id: "freeze", label: "Freeze" },
            { id: "smear", label: "Smear" },
            { id: "gate", label: "Gate" },
            { id: "shift", label: "Shift" },
          ]}
          color={SPECTRAL_VIOLET}
        />
      }
    >
      <SpectralStageViz />
      {m === "off" ? (
        <div className="text-center text-[10px] text-dim leading-relaxed px-1 pb-1">
          Violet FFT bay — <span className="text-white/60">Freeze</span> holds,{" "}
          <span className="text-white/60">Smear</span> washes,{" "}
          <span className="text-white/60">Gate</span> keeps loudest partials,{" "}
          <span className="text-white/60">Shift</span> slides the spectrum.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-evenly gap-1">
            <FParamKnob
              paramKey="spectralAmount"
              label={amountLabel}
              min={0} max={1}
              bipolar={m === "shift"}
              format={m === "shift" ? (v) => `${v < 0.5 ? "−" : "+"}${Math.round(Math.abs(v * 2 - 1) * 100)}%` : fmtPct}
              def={m === "shift" ? 0.5 : 0.6}
              color={SPECTRAL_VIOLET}
            />
            <FParamKnob paramKey="spectralMix" label="Mix" min={0} max={1} format={fmtPct} def={0.5} color={SPECTRAL_VIOLET} />
          </div>
          <div className="mt-1.5 text-center text-[10px] text-dim">
            Mode colors the bay — Hold freezes bins, Time smears, Thresh gates, Shift slides.
          </div>
        </>
      )}
    </Section>
  );
}

/** Lowpass-gate switch (v1.7) — swaps the amp ADSR for a struck vactrol. */
function LpgToggle() {
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn);
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <button
      onClick={() => setParam("lpgOn", !lpgOn)}
      className={`h-6 px-2.5 rounded-md text-[10px] font-bold border transition ${
        lpgOn
          ? "border-[#ffcf5c]/70 bg-[#ffcf5c]/15 text-[#ffe4a0]"
          : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70"
      }`}
      title="Lowpass gate (Aalto-style): notes become struck vactrol plucks — one strike drives both loudness AND brightness, so loud is bright and quiet is dark. Replaces the ADSR while on."
    >
      {lpgOn ? "● LPG" : "○ LPG"}
    </button>
  );
}

/** Amp panel body: knobs only — stage viz lives above in the Section. */
function LpgAwareAmpRow() {
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn);
  if (lpgOn) {
    return (
      <>
        <div className="flex items-center justify-evenly gap-1">
          <FParamKnob paramKey="lpgDecay" label="Decay" min={0.05} max={2.5} curve="log" format={fmtSec} def={0.4} color="#ffcf5c" size={46} />
          <FParamKnob paramKey="lpgColor" label="Color" min={0} max={1} format={fmtPct} def={0.7} color="#ffcf5c" size={46} />
          <FParamKnob paramKey="velAmount" label="Vel" min={0} max={1} format={fmtPct} def={1} color={GRN} />
        </div>
        <div className="mt-1.5 text-center text-[10px] text-dim">
          Vactrol mode: every note is a struck pluck that rings out on its own. Color = how much the strike drives the filter.
        </div>
      </>
    );
  }
  return (
    <>
      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey="ampAttack" label="A" min={0.001} max={3} curve="log" format={fmtSec} color={GRN} />
        <FParamKnob paramKey="ampDecay" label="D" min={0.005} max={3} curve="log" format={fmtSec} color={GRN} />
        <FParamKnob paramKey="ampSustain" label="S" min={0} max={1} format={fmtPct} color={GRN} />
        <FParamKnob paramKey="ampRelease" label="R" min={0.005} max={4} curve="log" format={fmtSec} color={GRN} />
        <FParamKnob paramKey="velAmount" label="Vel" min={0} max={1} format={fmtPct} def={1} color={GRN} />
      </div>
      <div className="mt-1.5 text-center text-[10px] text-dim">Amp mountain — loudness contour of every note.</div>
    </>
  );
}

function FSeg<T extends string>({ paramKey, options, color }: { paramKey: keyof FirePatch; options: { id: T; label: string }[]; color?: string }) {
  const value = useFireCommandStore((s) => s.patch[paramKey]) as T;
  const set = useFireCommandStore((s) => s.setParam) as (k: keyof FirePatch, v: T) => void;
  return <Seg<T> value={value} onChange={(v) => set(paramKey, v)} options={options} color={color} />;
}

const LFO_WAVE_OPTS: { id: LfoWave; label: string }[] = [
  { id: "sine", label: "∿" }, { id: "triangle", label: "△" }, { id: "sawtooth", label: "◺" },
  { id: "square", label: "⊓" }, { id: "sample-hold", label: "S&H" },
];
function FLfoWave({ paramKey }: { paramKey: keyof FirePatch }) {
  const value = useFireCommandStore((s) => s.patch[paramKey]) as LfoWave;
  const set = useFireCommandStore((s) => s.setParam) as (k: keyof FirePatch, v: LfoWave) => void;
  return (
    <div className="inline-flex rounded-lg bg-black/30 border border-white/10 p-0.5">
      {LFO_WAVE_OPTS.map((o) => (
        <button key={o.id} onClick={() => set(paramKey, o.id)} className={`px-2 py-0.5 rounded-md text-xs transition ${value === o.id ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"}`}>{o.label}</button>
      ))}
    </div>
  );
}

function TableSelect({ paramKey }: { paramKey: keyof FirePatch }) {
  const value = useFireCommandStore((s) => s.patch[paramKey]) as string;
  const set = useFireCommandStore((s) => s.setParam) as (k: keyof FirePatch, v: string) => void;
  return (
    <select
      value={value}
      onChange={(e) => set(paramKey, e.target.value)}
      className="bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-xs text-white/85 focus:outline-none focus:border-[#ff6a3d]/60 cursor-pointer"
    >
      {WAVETABLES.map((w) => <option key={w.id} value={w.id} className="bg-ink">{w.name}</option>)}
    </select>
  );
}

function AdsrRow({ a, d, s, r, color = GRN }: { a: NumericKey; d: NumericKey; s: NumericKey; r: NumericKey; color?: string }) {
  return (
    <div className="flex items-center justify-evenly gap-1">
      <FParamKnob paramKey={a} label="A" min={0.001} max={3} curve="log" format={fmtSec} color={color} />
      <FParamKnob paramKey={d} label="D" min={0.005} max={3} curve="log" format={fmtSec} color={color} />
      <FParamKnob paramKey={s} label="S" min={0} max={1} format={fmtPct} color={color} />
      <FParamKnob paramKey={r} label="R" min={0.005} max={4} curve="log" format={fmtSec} color={color} />
    </div>
  );
}

// ════════════════════ primitives ════════════════════

function useCollapsed(key: string | undefined, def: boolean): [boolean, () => void] {
  return useFireCollapsed(key, def);
}

function Section({ title, color = FIRE, right, children, className, collapseKey, defaultCollapsed = false, chipHosted = false }: {
  title: string; color?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
  /** When set, the section header toggles fold state (persisted under this key). */
  collapseKey?: string; defaultCollapsed?: boolean;
  /** When true inside a FireBand, collapsed sections disappear (chips show instead). */
  chipHosted?: boolean;
}) {
  const [collapsed, toggle] = useCollapsed(collapseKey, defaultCollapsed);
  const { focusActive, focusId, isFocused } = useFireLayout();
  useFireBandRegister(collapseKey, title, color, collapsed, toggle, !!chipHosted && !!collapseKey);

  // Focus mode: keep the soloed module forced open
  useEffect(() => {
    if (collapseKey && isFocused(collapseKey) && collapsed) {
      ensureExpanded(collapseKey);
    }
  }, [collapseKey, collapsed, isFocused]);

  // Hide non-focused modules while focus mode is on
  if (focusActive && collapseKey && focusId !== collapseKey) return null;

  if (chipHosted && collapseKey && collapsed && !isFocused(collapseKey)) return null;

  return (
    <GlassPanel
      className={`p-2.5 ${className ?? ""}`}
      data-fire-module={collapseKey || undefined}
    >
      <div className={`flex items-center justify-between gap-2 min-w-0 ${collapsed && !isFocused(collapseKey) ? "" : "mb-2"}`}>
        {collapseKey ? (
          <button
            onClick={toggle}
            aria-expanded={!collapsed || isFocused(collapseKey)}
            className="flex items-center gap-2 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 min-w-0"
            title={collapsed ? "Expand section" : "Collapse section"}
          >
            <CollapseToggle collapsed={collapsed && !isFocused(collapseKey)} color={color} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] truncate" style={{ color }}>{title}</span>
          </button>
        ) : (
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] truncate min-w-0" style={{ color }}>{title}</div>
        )}
        {(!collapsed || isFocused(collapseKey)) && right ? <div className="shrink-0 max-w-[55%] overflow-x-auto">{right}</div> : null}
      </div>
      {(!collapsed || isFocused(collapseKey)) && children}
    </GlassPanel>
  );
}

function KnobRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-evenly gap-1">{children}</div>;
}

function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="w-7 h-7 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 text-base leading-none transition">{children}</button>;
}

function Seg<T extends string>({ value, onChange, options, color }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; color?: string }) {
  // KCDS segmented geometry/motion, but keeps Fire Command's per-section
  // color override (the accent tint that identifies each engine panel).
  return (
    <div className="kc-seg flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`kc-seg-btn ${value === o.id ? "text-white" : ""}`}
          style={value === o.id ? { background: `${color ?? FIRE}28`, boxShadow: `inset 0 0 0 1px ${color ?? FIRE}66`, color: "#fff" } : undefined}
        >{o.label}</button>
      ))}
    </div>
  );
}

function KnobMini({ label, value, min, max, integer = false, format, onChange }: { label: string; value: number; min: number; max: number; integer?: boolean; format: (v: number) => string; onChange: (v: number) => void }) {
  return <Dial label={label} value={value} min={min} max={max} integer={integer} format={format} onChange={onChange} size={38} color={FIRE} />;
}

/**
 * Extract the numeric part of a formatted knob readout (or user-typed text)
 * and normalize unit suffixes onto the format's own scale: "500ms" → 0.5 (s),
 * "1.20k" → 1200 (Hz), "−35%" → -35. Lets typed text be compared directly
 * against what `format()` prints.
 */
function parseDisplayNumber(s: string): number {
  const cleaned = s.replace(/\u2212/g, "-").replace(/,/g, "").trim().toLowerCase();
  const m = cleaned.match(/^([+-]?\d*\.?\d+)\s*([a-z%×¢°]*)/);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const unit = m[2] ?? "";
  if (unit.startsWith("ms")) n /= 1000;
  else if (unit.startsWith("k")) n *= 1000;
  return n;
}

function Dial({
  label, value, min, max, curve = "lin", integer = false, bipolar = false, format, def, color = FIRE, size = 40, onChange,
}: {
  label: string; value: number; min: number; max: number; curve?: "lin" | "log"; integer?: boolean;
  bipolar?: boolean; format: (v: number) => string; def?: number; color?: string; size?: number; onChange: (v: number) => void;
}) {
  const knobRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startT = useRef(0);
  const [drag, setDrag] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const toT = (v: number) => (curve === "log" ? Math.log(clamp(v, min, max) / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (tt: number) => {
    const raw = curve === "log" ? min * Math.pow(max / min, tt) : min + (max - min) * tt;
    return integer ? Math.round(raw) : raw;
  };
  const t = clamp(toT(value), 0, 1);
  const resetVal = def !== undefined ? def : bipolar ? fromT(0.5) : min;
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startT.current = t;
    setDrag(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    // Shift = ultra-fine: ~½ display unit per pixel, so any exact percentage
    // is reachable by hand (the old 640 still skipped values on small knobs).
    const scale = e.shiftKey ? 2400 : 220;
    const nt = clamp(startT.current + (startY.current - e.clientY) / scale, 0, 1);
    // Re-anchor while shift is toggled mid-drag so the value doesn't jump.
    startY.current = e.clientY;
    startT.current = nt;
    onChange(fromT(nt));
  };
  const up = (e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag(false);
  };
  const dbl = () => onChange(resetVal);

  /** Type-in commit: bisect t until format(value) prints the typed number. */
  const commitTyped = (raw: string) => {
    setEditing(false);
    const target = parseDisplayNumber(raw);
    if (!Number.isFinite(target)) return;
    const dispNum = (tt: number) => parseDisplayNumber(format(fromT(tt)));
    const ascending = dispNum(1) >= dispNum(0);
    let lo = 0, hi = 1;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if ((dispNum(mid) < target) === ascending) lo = mid; else hi = mid;
    }
    const best = Math.abs(dispNum(hi) - target) <= Math.abs(dispNum(lo) - target) ? hi : lo;
    onChange(fromT(best));
  };

  // Wheel + arrow-key adjust, matching the shared Knob. Wheel is registered
  // non-passively so tweaking a dial doesn't scroll the synth page.
  const nudgeRef = useRef<(dir: number, fine: boolean) => void>(() => {});
  nudgeRef.current = (dir, fine) => {
    if (integer && !fine) {
      onChange(clamp(Math.round(value) + dir, min, max));
    } else {
      onChange(fromT(clamp(t + dir * (fine ? 0.005 : 0.04), 0, 1)));
    }
  };
  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      nudgeRef.current(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); nudgeRef.current(1, e.shiftKey); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); nudgeRef.current(-1, e.shiftKey); }
    else if (e.key === "Enter") { e.preventDefault(); setEditText(""); setEditing(true); }
    else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); onChange(resetVal); }
  };

  const angle = -135 + t * 270;
  const fillFrom = bipolar ? Math.min(0, angle) : -135;
  const fillTo = bipolar ? Math.max(0, angle) : angle;
  const r = size / 2 - 5;
  const cx = size / 2;
  const cy = size / 2;
  const ix = cx + Math.sin((angle * Math.PI) / 180) * (r - 2);
  const iy = cy - Math.cos((angle * Math.PI) / 180) * (r - 2);
  const atDefault = Math.abs(value - resetVal) < Math.abs(max - min) * 1e-4;
  return (
    // Width tracks knob size so small knobs pack densely (floor keeps the
    // value/label text readable).
    <div className="group flex flex-col items-center relative" style={{ width: Math.max(size + 10, 50) }}>
      <div
        ref={knobRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="cursor-ns-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        style={{ width: size, height: size, touchAction: "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={dbl}
        onKeyDown={onKeyDown}
        title="Drag or scroll · Shift = ultra-fine · Double-click reset · Click the value to type it"
      >
        <svg width={size} height={size} className="overflow-visible">
          <circle cx={cx} cy={cy} r={r + 2} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.07)" />
          <path d={arcPath(cx, cy, r, -135, 135)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3.5} strokeLinecap="round" />
          <path d={arcPath(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" style={{ filter: drag ? `drop-shadow(0 0 5px ${color})` : `drop-shadow(0 0 2px ${color})` }} />
          <line x1={cx} y1={cy} x2={ix} y2={iy} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <circle cx={ix} cy={iy} r={3} fill={color} />
        </svg>
      </div>
      {/* Reset pip — fades in on hover, hidden while already at default. */}
      {!atDefault && (
        <button
          onClick={() => onChange(resetVal)}
          tabIndex={-1}
          className="absolute -top-1 -right-0.5 w-[14px] h-[14px] rounded-full border border-white/20 bg-black/70 text-white/60 hover:text-white hover:border-white/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center leading-none"
          style={{ fontSize: 9 }}
          title={`Reset to ${format(resetVal)}`}
          aria-label={`Reset ${label} to ${format(resetVal)}`}
        >⟲</button>
      )}
      {editing ? (
        <input
          autoFocus
          value={editText}
          placeholder={format(value)}
          onChange={(e) => setEditText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commitTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTyped((e.target as HTMLInputElement).value);
            else if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
          className="w-[46px] text-[10px] font-mono text-center bg-black/70 border rounded -mt-0.5 leading-none text-white outline-none"
          style={{ borderColor: color }}
        />
      ) : (
        <button
          onClick={() => { setEditText(""); setEditing(true); }}
          tabIndex={-1}
          className="text-[10px] font-mono text-white/85 -mt-0.5 leading-none hover:text-white rounded px-0.5 hover:bg-white/10 transition-colors cursor-text"
          title="Click to type an exact value"
        >{format(value)}</button>
      )}
      <div className="text-[9px] uppercase tracking-wide text-dim leading-tight text-center">{label}</div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const start = polar(cx, cy, r, a1);
  const end = polar(cx, cy, r, a0);
  const large = a1 - a0 <= 180 ? "0" : "1";
  return ["M", start.x, start.y, "A", r, r, 0, large, 0, end.x, end.y].join(" ");
}

export default FireCommandView;
