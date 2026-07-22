import { useCallback, useEffect, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { SequencerPanel } from "./SequencerPanel";
import {
  useFireCommandStore,
  FIRE_PRESETS,
  type ArpMode,
  type ArpDivision,
  type ArpSettings,
} from "@/state/fireCommandStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { getEngine } from "@/audio/AudioEngine";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { useMidiStore, registerMidiNoteHandler } from "@/state/midiStore";
import type { FirePatch, LfoWave, FireFilterType, LfoDest, SubWave, DriveMode, ModSource, ModDest, ModRoute, HarmonyMode, SpectralMode } from "@/audio/dsp/FireCommandSynth";
import { WAVETABLES, FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { PresetBrowser } from "./PresetBrowser";
import { MixerPanel } from "./MixerPanel";
import { ModPatchGrid } from "./ModPatchGrid";
import { FireMorphPad } from "./FireMorphPad";
import { undoFire, redoFire, useFireHistoryStore } from "@/lib/fireHistory";

const FIRE = "#ff6a3d"; // primary
const ICE = "#62b6ff"; // LFOs
const GRN = "#7cf6b0"; // envelopes
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
const BLACK_SET = new Set([1, 3, 6, 8, 10, 13, 15]);
const BLACK_LEFT_INDEX: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5, 13: 7, 15: 8 };
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];

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

function UndoRedoButtons() {
  const undoDepth = useFireHistoryStore((s) => s.undoDepth);
  const redoDepth = useFireHistoryStore((s) => s.redoDepth);
  const btn = (enabled: boolean) =>
    `rounded-lg border px-2.5 py-1 text-xs transition ${
      enabled
        ? "border-white/12 bg-white/5 hover:bg-white/10 text-white/80"
        : "border-white/5 bg-white/[0.02] text-white/25 cursor-default"
    }`;
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => undoFire()}
        disabled={undoDepth === 0}
        className={btn(undoDepth > 0)}
        title="Undo (Ctrl+Z) — piano roll, drums, samples and patch edits share one timeline"
      >↶ Undo</button>
      <button
        onClick={() => redoFire()}
        disabled={redoDepth === 0}
        className={btn(redoDepth > 0)}
        title="Redo (Ctrl+Y)"
      >↷ Redo</button>
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
  const randomPreset = useFireCommandStore((s) => s.randomPreset);
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
    <div className="space-y-2 pb-6">
      {/* Fire Command command-deck header — compact strip */}
      <div className="fire-header relative overflow-hidden rounded-2xl border border-[#ff6a3d]/25 px-4 py-2.5">
        <div className="relative z-10 flex flex-wrap items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg grid place-items-center text-lg shrink-0"
            style={{ background: "linear-gradient(145deg, #ff6a3d2e, #ff2e1a1a)", border: "1px solid #ff6a3d55", boxShadow: "0 0 24px #ff6a3d33" }}
          >🔥</div>
          <div className="min-w-0 flex items-baseline gap-3">
            <h1 className="fire-title text-lg font-black tracking-[0.08em] leading-none">FIRE COMMAND</h1>
            <div className="hidden sm:block text-[9px] uppercase tracking-[0.3em] text-[#ff9a6b]/80">
              Wavetable Weapons Platform · MK III
            </div>
          </div>
          <div className="flex-1" />
          <div className="hidden md:flex items-center gap-4 text-[9px] uppercase tracking-[0.22em] font-mono">
            <div className="flex items-center gap-1.5 text-[#9be564]">
              <span className="fire-status-dot" style={{ background: "#9be564" }} />
              Systems Nominal
            </div>
            <div className="text-white/35">3 OSC · 8-SLOT MATRIX · SEQ ARMED</div>
          </div>
        </div>
      </div>

      {/* Compact preset bar — full library lives in its own browser */}
      <GlassPanel className="p-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.22em] text-dim pl-1">Patch</span>
          <button
            onClick={() => setBrowserOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/25 px-3 py-1 transition min-w-[180px]"
            title="Open the preset library"
          >
            <span className="text-base leading-none" style={{ color: FIRE }}>♪</span>
            <span className="text-sm font-semibold text-white truncate">{currentName}</span>
            <span className="ml-auto text-[10px] uppercase tracking-widest text-white/40">Browse ▾</span>
          </button>
          <button
            onClick={() => loadPreset("init")}
            className="rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 px-3 py-1 text-xs text-white/75 transition"
          >↺ Init</button>
          <button
            onClick={() => {
              // Announce the pick — "Randomize" used to change the sound with
              // no readout of what it landed on (issue #2).
              const p = randomPreset();
              toast(`🎲 Deployed: ${p.name} · ${p.category}`);
            }}
            className="rounded-lg border border-[#ff6a3d]/60 bg-[#ff6a3d]/15 hover:bg-[#ff6a3d]/25 px-3 py-1 text-xs font-bold transition shadow-[0_0_18px_rgb(255_106_61/0.25)]"
            style={{ color: "#ffd9c9" }}
            title="Deploy a random preset from the armory (the name shows here and in the Patch box)"
          >🎲 Randomize</button>
          <button
            onClick={() => {
              useFireCommandStore.getState().mutate();
              toast("🧬 Mutated — the patch evolved a little");
            }}
            className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-200 transition"
            title="Evolve the CURRENT sound: every shaping parameter drifts a few percent. Hammer it to walk somewhere new — the patch keeps its identity but grows quirks."
          >🧬 Mutate</button>
          <div className="flex-1" />
          <UndoRedoButtons />
          <button
            onClick={() => setBrowserOpen(true)}
            className="rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 px-3 py-1 text-xs text-white/80 transition"
            title="Save / manage presets"
          >＋ Save · Library</button>
        </div>
      </GlassPanel>

      {/* Pattern sequencer: piano roll + drum grid */}
      <SequencerPanel />

      {/* Bus mixer + sidechain (v1.6) */}
      <MixerPanel />

      {/* Patch morph pad (v1.6) */}
      <FireMorphPad />

      {/* HERO: wavetable displays + scope */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <GlassPanel intense className="p-2 lg:col-span-1">
          <WaveDisplay group="a" color={FIRE} />
        </GlassPanel>
        <GlassPanel intense className="p-2 lg:col-span-1">
          <WaveDisplay group="b" color="#ff9a6b" />
        </GlassPanel>
        <GlassPanel intense className="p-2 lg:col-span-1">
          <WaveDisplay group="c" color="#ffcf5c" />
        </GlassPanel>
        <GlassPanel intense className="p-2 lg:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-widest text-dim">Output</span>
            <VoiceCount />
          </div>
          <Scope />
        </GlassPanel>
      </div>

      {/* Global control strip */}
      <GlassPanel className="p-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-dim">Octave</span>
            <Stepper onClick={() => shiftOctave(-1)}>−</Stepper>
            <div className="w-6 text-center font-mono text-sm" style={{ color: FIRE }}>{octave}</div>
            <Stepper onClick={() => shiftOctave(1)}>+</Stepper>
          </div>
          <div className="h-7 w-px bg-white/10" />
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
          <div className="flex-1" />
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
      </GlassPanel>

      {/* OSC A / B / C */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <OscPanel group="a" />
        <OscPanel group="b" />
        <OscPanel group="c" />
      </div>

      {/* Spectral warps (v1.7): Razor-style harmonic reshaping of all 3 oscs */}
      <Section
        title="Spectral Warp"
        color="#ffcf5c"
        collapseKey="fire.sec.warp"
        right={
          <span className="text-[9px] text-dim normal-case tracking-normal">
            reshapes the harmonics of all three wavetable oscillators
          </span>
        }
      >
        <KnobRow>
          <FParamKnob paramKey="warpStretch" label="Stretch" min={-1} max={1} bipolar format={fmtBi} def={0} color="#ffcf5c" />
          <FParamKnob paramKey="warpTilt" label="Tilt" min={-1} max={1} bipolar format={fmtBi} def={0} color="#ffcf5c" />
          <FParamKnob paramKey="warpComb" label="Comb" min={0} max={1} format={fmtPct} def={0} color="#ffcf5c" />
        </KnobRow>
      </Section>

      {/* Mixer/Unison + Filter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Section title="Mixer · Unison" color={FIRE} right={
          <FSeg<SubWave> paramKey="subWave" options={[{ id: "sine", label: "Sin" }, { id: "triangle", label: "Tri" }, { id: "square", label: "Sqr" }, { id: "sawtooth", label: "Saw" }]} />
        }>
          <KnobRow>
            <FParamKnob paramKey="subLevel" label="Sub" min={0} max={1} format={fmtPct} def={0.3} />
            <FParamKnob paramKey="noiseLevel" label="Noise" min={0} max={1} format={fmtPct} def={0} />
            <FParamKnob paramKey="noiseColor" label="Color" min={-1} max={1} bipolar format={fmtBi} def={0} />
            <div className="w-px h-12 bg-white/8 self-center mx-0.5" />
            <FParamKnob paramKey="unison" label="Unison" min={1} max={7} integer format={fmtInt} def={3} />
            <FParamKnob paramKey="unisonDetune" label="Detune" min={0} max={50} integer format={fmtCents} def={14} />
            <FParamKnob paramKey="unisonWidth" label="Width" min={0} max={1} format={fmtPct} def={0.5} />
            <FParamKnob paramKey="stereoWidth" label="Stereo" min={0} max={1.4} format={fmtPct} def={1} />
            <FParamKnob paramKey="drift" label="Drift" min={0} max={1} format={fmtPct} def={0} />
          </KnobRow>
        </Section>
        <Section title="Filter" color={FIRE} right={
          <FSeg<FireFilterType> paramKey="filterType" options={[{ id: "lowpass", label: "LP" }, { id: "bandpass", label: "BP" }, { id: "highpass", label: "HP" }, { id: "notch", label: "NT" }]} />
        }>
          <KnobRow>
            <FParamKnob paramKey="filterCutoff" label="Cutoff" min={20} max={18000} curve="log" format={fmtHz} def={2600} size={46} />
            <FParamKnob paramKey="filterResonance" label="Reso" min={0.1} max={28} curve="log" format={fmtQ} def={3} />
            <FParamKnob paramKey="filterEnvAmount" label="Env Amt" min={-1} max={1} bipolar format={fmtBi} def={0} color={GRN} />
            <FParamKnob paramKey="filterKeyTrack" label="Key Trk" min={0} max={1} format={fmtPct} def={0.3} />
            <FParamKnob paramKey="filterDrive" label="Sat" min={0} max={1} format={fmtPct} def={0} />
          </KnobRow>
        </Section>
      </div>

      {/* Envelopes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Section title="Amp Envelope" color={GRN} right={<LpgToggle />}>
          <LpgAwareAmpRow />
        </Section>
        <Section title="Mod Envelope → Morph" color={GRN}>
          <AdsrRow a="modAttack" d="modDecay" s="modSustain" r="modRelease" />
        </Section>
        <Section title="Filter Envelope" color={GRN}>
          <AdsrRow a="filtAttack" d="filtDecay" s="filtSustain" r="filtRelease" />
        </Section>
      </div>

      {/* LFOs + FM/Ring + Pitch/Glide */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        <LfoPanel idx={1} />
        <LfoPanel idx={2} />
        <Section title="FM · Ring" color={FIRE}>
          <KnobRow>
            <FParamKnob paramKey="fmAmount" label="FM Amt" min={0} max={1} format={fmtPct} def={0} />
            <FParamKnob paramKey="fmRatio" label="FM Ratio" min={0.5} max={12} curve="log" format={fmtRatio} def={2} />
            <FParamKnob paramKey="fmBtoA" label="B→A FM" min={0} max={1} format={fmtPct} def={0} />
            <FParamKnob paramKey="ringAmount" label="Ring" min={0} max={1} format={fmtPct} def={0} />
            <FParamKnob paramKey="ringFreq" label="Ring Hz" min={20} max={4000} curve="log" format={fmtHz} def={220} />
          </KnobRow>
        </Section>
        <Section title="Pitch · Glide" color={FIRE}>
          <KnobRow>
            <FParamKnob paramKey="pitchEnvAmount" label="Ptch Env" min={-48} max={48} integer bipolar format={fmtSemi} def={0} color={GRN} />
            <FParamKnob paramKey="pitchEnvTime" label="Env Time" min={0.01} max={2} curve="log" format={fmtSec} def={0.2} color={GRN} />
            <FParamKnob paramKey="glide" label="Glide" min={0} max={1} format={fmtSec} def={0.06} />
          </KnobRow>
          <div className="mt-1 text-[10px] text-dim">Glide applies in Mono mode.</div>
        </Section>
      </div>

      {/* FX */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        <Section title="Drive · Punch" color={FIRE} right={
          <FSeg<DriveMode> paramKey="driveMode" options={[{ id: "soft", label: "Soft" }, { id: "tube", label: "Tube" }, { id: "fold", label: "Fold" }, { id: "hard", label: "Hard" }, { id: "fuzz", label: "Fuzz" }]} />
        }>
          <KnobRow>
            <FParamKnob paramKey="drive" label="Drive" min={0} max={1} format={fmtPct} def={0.08} />
            <FParamKnob paramKey="crush" label="Crush" min={0} max={1} format={fmtPct} def={0} />
            <FParamKnob paramKey="tone" label="Tone" min={1000} max={18000} curve="log" format={fmtHz} def={15000} size={46} />
            <FParamKnob paramKey="punch" label="Punch" min={0} max={1} format={fmtPct} def={0} />
          </KnobRow>
        </Section>
        <Section title="Phaser" color={ICE}>
          <KnobRow>
            <FParamKnob paramKey="phaserRate" label="Rate" min={0.02} max={12} curve="log" format={fmtHzRate} def={0.4} color={ICE} />
            <FParamKnob paramKey="phaserDepth" label="Depth" min={0} max={1} format={fmtPct} def={0.6} color={ICE} />
            <FParamKnob paramKey="phaserMix" label="Mix" min={0} max={1} format={fmtPct} def={0} color={ICE} />
          </KnobRow>
        </Section>
        <Section title="Chorus" color={ICE}>
          <KnobRow>
            <FParamKnob paramKey="chorusRate" label="Rate" min={0.05} max={8} curve="log" format={fmtHzRate} def={0.6} color={ICE} />
            <FParamKnob paramKey="chorusDepth" label="Depth" min={0} max={1} format={fmtPct} def={0.4} color={ICE} />
            <FParamKnob paramKey="chorusMix" label="Mix" min={0} max={1} format={fmtPct} def={0.25} color={ICE} />
          </KnobRow>
        </Section>
        <Section title="Delay (Ping-Pong)" color={ICE}>
          <KnobRow>
            <FParamKnob paramKey="delayTime" label="Time" min={0.01} max={1.5} curve="log" format={fmtSec} def={0.28} color={ICE} />
            <FParamKnob paramKey="delayFeedback" label="Fbk" min={0} max={0.92} format={fmtPct} def={0.3} color={ICE} />
            <FParamKnob paramKey="delayMix" label="Mix" min={0} max={1} format={fmtPct} def={0} color={ICE} />
          </KnobRow>
        </Section>
        <Section title="Reverb" color={ICE}>
          <KnobRow>
            <FParamKnob paramKey="reverbSize" label="Size" min={0.3} max={6} curve="log" format={fmtSec} def={2.2} color={ICE} />
            <FParamKnob paramKey="reverbMix" label="Mix" min={0} max={1} format={fmtPct} def={0} color={ICE} />
          </KnobRow>
        </Section>
        <SpectralPanel />
      </div>

      {/* Less-used sections — collapsible, folded away by default */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <MacrosPanel />
        <GatePanel />
      </div>
      <ModMatrixPanel />
      <ArpPanel arp={arp} setArp={setArp} />

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
  );
}

// ════════════════════ wavetable display ════════════════════

function WaveDisplay({ group, color }: { group: "a" | "b" | "c"; color: string }) {
  const table = useFireCommandStore((s) => (group === "a" ? s.patch.oscATable : group === "b" ? s.patch.oscBTable : s.patch.oscCTable));
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastTick = 0;
    let lastPos = -1;
    const MIN_INTERVAL = 33; // cap at ~30 fps — plenty for a morph readout
    const cache: Float32Array[] = [];
    let cacheTable = "";
    const N = 96;
    const ensureCache = (id: string) => {
      if (cacheTable === id && cache.length) return;
      cache.length = 0;
      for (let i = 0; i < FRAME_COUNT; i++) cache.push(frameSamples(id, i / (FRAME_COUNT - 1), N));
      cacheTable = id;
    };
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < MIN_INTERVAL) return;
      lastTick = nowMs;
      let pos = 0.5;
      try { pos = getEngine().fireCommand.getMorphPositions()[group]; } catch { /* not ready */ }
      // The wavetable stack is static unless the morph position actually moves
      // (a note's mod-env / LFO, or dragging the Morph knob). Skip the whole
      // redraw when nothing changed — the common idle case on this page.
      if (lastPos >= 0 && Math.abs(pos - lastPos) < 0.0008) return;
      lastPos = pos;
      ensureCache(table);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const curFrame = pos * (FRAME_COUNT - 1);
      const padX = 14;
      const skew = 26;
      const topY = 16;
      const usableW = w - padX * 2 - skew;
      const amp = h * 0.07;
      // back-to-front stack of frames
      for (let i = 0; i < FRAME_COUNT; i++) {
        const depth = i / (FRAME_COUNT - 1);
        const baseY = topY + depth * (h - topY - 22);
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
        ctx.strokeStyle = `rgba(255,255,255,${0.06 + depth * 0.06})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (near > 0.001) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = near * 0.9;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      // current interpolated waveform, bold at front
      const lo = Math.floor(curFrame);
      const hi = Math.min(lo + 1, FRAME_COUNT - 1);
      const frac = curFrame - lo;
      const frontY = h - 16;
      ctx.beginPath();
      for (let x = 0; x < N; x++) {
        const v = cache[lo][x] * (1 - frac) + cache[hi][x] * frac;
        const px = padX + (x / (N - 1)) * (w - padX * 2);
        const py = frontY - v * (h * 0.12);
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [table, group, color]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-dim">Osc {group.toUpperCase()}</span>
        <span className="text-[10px] font-mono" style={{ color }}>{wavetableName(table)}</span>
      </div>
      <canvas ref={ref} width={250} height={88} className="w-full h-[88px] rounded-lg bg-black/40" />
    </div>
  );
}

function Scope() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastTick = 0;
    let idleCleared = false;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const MIN_INTERVAL = 28; // ~36 fps — smooth trace without pegging a core
    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (nowMs - lastTick < MIN_INTERVAL) return;
      lastTick = nowMs;
      let analyser: AnalyserNode | null = null;
      let running = false;
      try { const e = getEngine(); analyser = e.analyserPost; running = e.ctx.state === "running"; } catch { analyser = null; }
      const w = canvas.width;
      const h = canvas.height;
      // While the context is suspended (nothing playing) the trace is a flat
      // line — clear it once and stop doing per-frame analyser reads + paints.
      if (!analyser || !running) {
        if (!idleCleared) { ctx.clearRect(0, 0, w, h); idleCleared = true; }
        return;
      }
      idleCleared = false;
      ctx.clearRect(0, 0, w, h);
      if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      ctx.lineWidth = 2;
      ctx.strokeStyle = FIRE;
      ctx.shadowBlur = 8;
      ctx.shadowColor = FIRE;
      ctx.beginPath();
      const N = buf.length;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const v = (buf[i] - 128) / 128;
        const y = h / 2 - v * (h / 2) * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={520} height={88} className="w-full h-[88px] rounded-lg bg-black/40" />;
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

// ════════════════════ osc panel ════════════════════

function OscPanel({ group }: { group: "a" | "b" | "c" }) {
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
  return (
    <Section title={`Oscillator ${cap}${group === "c" ? "  (off at 0)" : ""}`} color={FIRE} right={<TableSelect paramKey={tableKey} />}>
      <KnobRow>
        <FParamKnob paramKey={posKey} label="Morph" min={0} max={1} format={fmtPct} def={group === "a" ? 0.66 : 0.4} size={46} />
        <FParamKnob paramKey={envKey} label="Env→WT" min={-1} max={1} bipolar format={fmtBi} def={0} color={GRN} />
        <FParamKnob paramKey={lfoKey} label="LFO→WT" min={-1} max={1} bipolar format={fmtBi} def={0} color={ICE} />
        <div className="w-px h-12 bg-white/8 self-center mx-0.5" />
        <FParamKnob paramKey={octKey} label="Octave" min={-2} max={2} integer bipolar format={fmtOct} def={defOct} />
        <FParamKnob paramKey={detKey} label="Detune" min={-50} max={50} integer bipolar format={fmtCents} def={0} />
        <FParamKnob paramKey={lvlKey} label="Level" min={0} max={1} format={fmtPct} def={defLevel} />
      </KnobRow>
    </Section>
  );
}

function LfoPanel({ idx }: { idx: 1 | 2 }) {
  const waveKey = `lfo${idx}Wave` as keyof FirePatch;
  const destKey = `lfo${idx}Dest` as keyof FirePatch;
  const rateKey = `lfo${idx}Rate` as NumericKey;
  const depthKey = `lfo${idx}Depth` as NumericKey;
  return (
    <Section title={`LFO ${idx}`} color={ICE} right={<FLfoWave paramKey={waveKey} />}>
      <div className="mb-2">
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
      <KnobRow>
        <FParamKnob paramKey={rateKey} label="Rate" min={0.05} max={30} curve="log" format={fmtHzRate} def={idx === 1 ? 5 : 0.5} color={ICE} />
        <FParamKnob paramKey={depthKey} label="Depth" min={0} max={1} format={fmtPct} def={0} color={ICE} />
      </KnobRow>
      {idx === 1 && <div className="mt-1 text-[10px] text-dim">LFO 1 also feeds each osc's LFO→WT amount.</div>}
    </Section>
  );
}

// ════════════════════ macros · gate · matrix ════════════════════

function MacrosPanel() {
  return (
    <Section title="Macros" color={GRN} collapseKey="macros" defaultCollapsed>
      <KnobRow>
        <FParamKnob paramKey="macro1" label="Macro 1" min={0} max={1} format={fmtPct} def={0} color={GRN} />
        <FParamKnob paramKey="macro2" label="Macro 2" min={0} max={1} format={fmtPct} def={0} color={GRN} />
        <FParamKnob paramKey="macro3" label="Macro 3" min={0} max={1} format={fmtPct} def={0} color={GRN} />
        <FParamKnob paramKey="macro4" label="Macro 4" min={0} max={1} format={fmtPct} def={0} color={GRN} />
      </KnobRow>
      <div className="mt-1 text-[10px] text-dim">Hands-on controls — wire them to anything in the matrix below.</div>
    </Section>
  );
}

function GatePanel() {
  const on = useFireCommandStore((s) => s.patch.gateOn);
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const steps = useFireCommandStore((s) => s.patch.gateSteps);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setGateStep = useFireCommandStore((s) => s.setGateStep);
  return (
    <Section title="Trance Gate" color={ICE} collapseKey="gate" defaultCollapsed right={
      <button
        onClick={() => setParam("gateOn", !on)}
        className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${on ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_14px_rgb(var(--c-cyan)/0.3)]" : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"}`}
      >{on ? "● ON" : "OFF"}</button>
    }>
      <div className="flex gap-1 mb-3">
        {pattern.map((v, i) => {
          const active = i < steps;
          const lit = v > 0.5;
          return (
            <button
              key={i}
              onClick={() => setGateStep(i, !lit)}
              className="flex-1 h-7 rounded-md border transition"
              style={{
                borderColor: lit && active ? `${ICE}aa` : "rgba(255,255,255,0.1)",
                background: !active ? "rgba(255,255,255,0.02)" : lit ? `${ICE}33` : "rgba(255,255,255,0.05)",
                opacity: active ? 1 : 0.3,
                boxShadow: lit && active ? `inset 0 0 10px ${ICE}55` : "none",
              }}
              title={`Step ${i + 1}`}
            />
          );
        })}
      </div>
      <KnobRow>
        <FParamKnob paramKey="gateRate" label="Rate" min={0.5} max={24} curve="log" format={fmtHzRate} def={8} color={ICE} />
        <FParamKnob paramKey="gateDepth" label="Depth" min={0} max={1} format={fmtPct} def={1} color={ICE} />
        <FParamKnob paramKey="gateSteps" label="Steps" min={2} max={16} integer format={fmtInt} def={16} color={ICE} />
      </KnobRow>
      <div className="mt-1 text-[10px] text-dim">Rhythmic amplitude gate — chops the synth into a pattern.</div>
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

function ModMatrixPanel() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  // v1.7: the patch GRID is the primary view; the slot list stays for
  // precise numeric edits.
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
      color={GRN}
      collapseKey="matrix"
      defaultCollapsed
      right={
        <Seg<"grid" | "list">
          value={view}
          onChange={pickView}
          options={[{ id: "grid", label: "⊞ Grid" }, { id: "list", label: "☰ Slots" }]}
          color={GRN}
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

function ArpPanel({ arp, setArp }: { arp: ArpSettings; setArp: (p: Partial<ArpSettings>) => void }) {
  return (
    <Section title="Arpeggiator" color={FIRE} collapseKey="arp" defaultCollapsed right={
      <button
        onClick={() => setArp({ hold: !arp.hold })}
        className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${arp.hold ? "border-cyan/60 bg-cyan/15 text-cyan" : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"}`}
        title="Latch — keep arpeggiating after you let go"
      >Hold</button>
    }>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setArp({ enabled: !arp.enabled })}
          className={`rounded-xl border px-4 py-1.5 text-sm font-semibold transition ${arp.enabled ? "border-[#ff6a3d]/70 bg-[#ff6a3d]/15 shadow-[0_0_16px_rgb(255_106_61/0.25)]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
          style={arp.enabled ? { color: "#ffd9c9" } : undefined}
        >{arp.enabled ? "● Arp ON" : "Arp OFF"}</button>
        <Seg<ArpMode>
          value={arp.mode}
          onChange={(v) => setArp({ mode: v })}
          options={[
            { id: "up", label: "Up" }, { id: "down", label: "Dn" }, { id: "updown", label: "Up/Dn" },
            { id: "random", label: "Rnd" }, { id: "asplayed", label: "Play" },
          ]}
        />
        <Seg<string>
          value={String(arp.octaves)}
          onChange={(v) => setArp({ octaves: Number(v) })}
          options={[{ id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }, { id: "4", label: "4" }]}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Seg<ArpDivision>
          value={arp.division}
          onChange={(v) => setArp({ division: v })}
          options={[
            { id: "1/4", label: "1/4" }, { id: "1/8", label: "1/8" }, { id: "1/8T", label: "1/8T" },
            { id: "1/16", label: "1/16" }, { id: "1/16T", label: "1/16T" }, { id: "1/32", label: "1/32" },
          ]}
        />
        <div className="flex items-center gap-3">
          <KnobMini label="Tempo" value={arp.bpm} min={40} max={300} integer format={fmtBpm} onChange={(v) => setArp({ bpm: Math.round(v) })} />
          <KnobMini label="Gate" value={arp.gate} min={0.1} max={1} format={fmtPct} onChange={(v) => setArp({ gate: v })} />
        </div>
      </div>
    </Section>
  );
}

// ════════════════════ keyboard ════════════════════

function Keyboard({ octave, onMinimize }: { octave: number; onMinimize: () => void }) {
  const heldNotes = useFireCommandStore((s) => s.heldNotes);
  const arpOrder = useFireCommandStore((s) => s.arpOrder);
  const arpCurrent = useFireCommandStore((s) => s.arpCurrent);
  const arpEnabled = useFireCommandStore((s) => s.arp.enabled);
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
  const press = (midi: number) => {
    const store = useFireCommandStore.getState();
    if (mouseNote.current !== null && mouseNote.current !== midi) store.noteOff(mouseNote.current);
    mouseNote.current = midi;
    store.noteOn(midi);
  };
  const enter = (midi: number, buttons: number) => { if (buttons & 1) press(midi); };
  const base = (octave + 1) * 12;
  const keyStyle = (midi: number, black: boolean) => {
    const lit = litSet.has(midi);
    const cur = arpCurrent === midi;
    if (cur) return { background: `linear-gradient(180deg, #fff2ec 0%, ${FIRE} 100%)`, boxShadow: `0 0 30px ${FIRE}` };
    if (lit) return {
      background: black ? `linear-gradient(180deg, ${FIRE} 0%, #8f2a14 100%)` : `linear-gradient(180deg, ${FIRE} 0%, #b8351a 100%)`,
      boxShadow: `0 0 24px ${FIRE}`,
    };
    return black
      ? { background: "linear-gradient(180deg, #2a2d36 0%, #05060a 100%)", boxShadow: "0 4px 8px rgba(0,0,0,0.5)" }
      : { background: "linear-gradient(180deg, #e9ecf5 0%, #b9c0d0 100%)", boxShadow: "inset 0 -6px 10px rgba(0,0,0,0.18)" };
  };
  return (
    <div className="sticky bottom-0 z-10 pt-2">
      <GlassPanel intense className="p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">Keyboard</div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-dim hidden sm:block">Click &amp; drag · hold computer keys to perform</div>
            <button onClick={onMinimize} className="rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs text-white/70 transition">▼ Hide</button>
          </div>
        </div>
        <div className="relative h-36 select-none" style={{ touchAction: "none" }}>
          <div className="absolute inset-0 flex gap-[2px]">
            {WHITE_SEMITONES.map((semi) => {
              const midi = base + semi;
              const lit = litSet.has(midi) || arpCurrent === midi;
              return (
                <div
                  key={semi}
                  onPointerDown={() => press(midi)}
                  onPointerEnter={(e) => enter(midi, e.buttons)}
                  className="flex-1 rounded-b-lg border border-white/15 flex flex-col items-center justify-end pb-2 cursor-pointer transition-colors"
                  style={keyStyle(midi, false)}
                >
                  <span className={`text-[11px] font-mono font-bold ${lit ? "text-white" : "text-black/55"}`}>{SEMITONE_TO_KEY[semi] ?? ""}</span>
                  <span className={`text-[8px] ${lit ? "text-white/80" : "text-black/35"}`}>{noteName(midi)}</span>
                </div>
              );
            })}
          </div>
          <div className="absolute inset-0 pointer-events-none">
            {[...BLACK_SET].sort((a, b) => a - b).map((semi) => {
              const midi = base + semi;
              const leftIdx = BLACK_LEFT_INDEX[semi];
              return (
                <div
                  key={semi}
                  onPointerDown={() => press(midi)}
                  onPointerEnter={(e) => enter(midi, e.buttons)}
                  className="absolute top-0 h-[62%] rounded-b-md border border-black/60 flex items-end justify-center pb-1.5 cursor-pointer pointer-events-auto"
                  style={{ width: "6%", left: `calc(${(leftIdx + 1) * 10}% - 3%)`, zIndex: 2, ...keyStyle(midi, true) }}
                >
                  <span className="text-[10px] font-mono font-bold text-white/85">{SEMITONE_TO_KEY[semi] ?? ""}</span>
                </div>
              );
            })}
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
  return <Dial label={label} value={value} min={min} max={max} curve={curve} integer={integer} bipolar={bipolar} format={format} def={def} color={color} size={size} onChange={onChange} />;
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
const SPECTRAL_VIOLET = "#c98bff";
function SpectralPanel() {
  const mode = useFireCommandStore((s) => s.patch.spectralMode);
  const setParam = useFireCommandStore((s) => s.setParam);
  const m = mode ?? "off";
  const amountLabel = m === "freeze" ? "Hold" : m === "smear" ? "Time" : m === "gate" ? "Thresh" : m === "shift" ? "Shift" : "Amount";
  return (
    <Section
      title="Spectral"
      color={SPECTRAL_VIOLET}
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
      {m === "off" ? (
        <div className="text-[10px] text-dim leading-relaxed px-1 py-2">
          FFT effect on the synth bus — <span className="text-white/60">Freeze</span> holds the
          spectrum (reverb tails become pads), <span className="text-white/60">Smear</span> washes
          it out, <span className="text-white/60">Gate</span> keeps only the loudest partials,{" "}
          <span className="text-white/60">Shift</span> slides every partial up or down.
        </div>
      ) : (
        <KnobRow>
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
        </KnobRow>
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

/** Amp panel body: ADSR knobs normally, strike controls in LPG mode. */
function LpgAwareAmpRow() {
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn);
  if (lpgOn) {
    return (
      <>
        <KnobRow>
          <FParamKnob paramKey="lpgDecay" label="Decay" min={0.05} max={2.5} curve="log" format={fmtSec} def={0.4} color="#ffcf5c" size={46} />
          <FParamKnob paramKey="lpgColor" label="Color" min={0} max={1} format={fmtPct} def={0.7} color="#ffcf5c" size={46} />
          <FParamKnob paramKey="velAmount" label="Vel" min={0} max={1} format={fmtPct} def={1} color={GRN} />
        </KnobRow>
        <div className="mt-1 text-[10px] text-dim">
          Vactrol mode: every note is a struck pluck that rings out on its own. Color = how much the strike drives the filter.
        </div>
      </>
    );
  }
  return (
    <KnobRow>
      <FParamKnob paramKey="ampAttack" label="A" min={0.001} max={3} curve="log" format={fmtSec} color={GRN} />
      <FParamKnob paramKey="ampDecay" label="D" min={0.005} max={3} curve="log" format={fmtSec} color={GRN} />
      <FParamKnob paramKey="ampSustain" label="S" min={0} max={1} format={fmtPct} color={GRN} />
      <FParamKnob paramKey="ampRelease" label="R" min={0.005} max={4} curve="log" format={fmtSec} color={GRN} />
      <FParamKnob paramKey="velAmount" label="Vel" min={0} max={1} format={fmtPct} def={1} color={GRN} />
    </KnobRow>
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

function AdsrRow({ a, d, s, r }: { a: NumericKey; d: NumericKey; s: NumericKey; r: NumericKey }) {
  return (
    <KnobRow>
      <FParamKnob paramKey={a} label="A" min={0.001} max={3} curve="log" format={fmtSec} color={GRN} />
      <FParamKnob paramKey={d} label="D" min={0.005} max={3} curve="log" format={fmtSec} color={GRN} />
      <FParamKnob paramKey={s} label="S" min={0} max={1} format={fmtPct} color={GRN} />
      <FParamKnob paramKey={r} label="R" min={0.005} max={4} curve="log" format={fmtSec} color={GRN} />
    </KnobRow>
  );
}

// ════════════════════ primitives ════════════════════

/**
 * Per-section fold state, persisted to localStorage so the layout the user
 * arranges survives reloads. Key-less callers get a plain never-collapsed
 * section (hook is still called unconditionally to satisfy hook rules).
 */
function useCollapsed(key: string | undefined, def: boolean): [boolean, () => void] {
  const storage = key ? `killchain.firecmd.fold.${key}` : null;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!storage) return false;
    try {
      const raw = window.localStorage.getItem(storage);
      return raw === null ? def : raw === "1";
    } catch { return def; }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      if (storage) { try { window.localStorage.setItem(storage, c ? "0" : "1"); } catch { /* ignore */ } }
      return !c;
    });
  }, [storage]);
  return [collapsed, toggle];
}

function Section({ title, color = FIRE, right, children, className, collapseKey, defaultCollapsed = false }: {
  title: string; color?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
  /** When set, the section header toggles fold state (persisted under this key). */
  collapseKey?: string; defaultCollapsed?: boolean;
}) {
  const [collapsed, toggle] = useCollapsed(collapseKey, defaultCollapsed);
  return (
    <GlassPanel className={`p-2.5 ${className ?? ""}`}>
      <div className={`flex items-center justify-between gap-2 ${collapsed ? "" : "mb-2"}`}>
        {collapseKey ? (
          <button
            onClick={toggle}
            aria-expanded={!collapsed}
            className="flex items-center gap-1.5 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            title={collapsed ? "Expand section" : "Collapse section"}
          >
            <span className="text-[9px] text-white/45">{collapsed ? "▸" : "▾"}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color }}>{title}</span>
          </button>
        ) : (
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color }}>{title}</div>
        )}
        {!collapsed && right}
      </div>
      {!collapsed && children}
    </GlassPanel>
  );
}

function KnobRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-1.5 gap-y-1.5 justify-center sm:justify-start items-start">{children}</div>;
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
  const toT = (v: number) => (curve === "log" ? Math.log(clamp(v, min, max) / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (tt: number) => {
    const raw = curve === "log" ? min * Math.pow(max / min, tt) : min + (max - min) * tt;
    return integer ? Math.round(raw) : raw;
  };
  const t = clamp(toT(value), 0, 1);
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startT.current = t;
    setDrag(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const scale = e.shiftKey ? 640 : 220;
    const nt = clamp(startT.current + (startY.current - e.clientY) / scale, 0, 1);
    onChange(fromT(nt));
  };
  const up = (e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag(false);
  };
  const dbl = () => onChange(def !== undefined ? def : fromT(0.5));

  // Wheel + arrow-key adjust, matching the shared Knob. Wheel is registered
  // non-passively so tweaking a dial doesn't scroll the synth page.
  const nudgeRef = useRef<(dir: number, fine: boolean) => void>(() => {});
  nudgeRef.current = (dir, fine) => {
    if (integer && !fine) {
      onChange(clamp(Math.round(value) + dir, min, max));
    } else {
      onChange(fromT(clamp(t + dir * (fine ? 0.01 : 0.04), 0, 1)));
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
  };

  const angle = -135 + t * 270;
  const fillFrom = bipolar ? Math.min(0, angle) : -135;
  const fillTo = bipolar ? Math.max(0, angle) : angle;
  const r = size / 2 - 5;
  const cx = size / 2;
  const cy = size / 2;
  const ix = cx + Math.sin((angle * Math.PI) / 180) * (r - 2);
  const iy = cy - Math.cos((angle * Math.PI) / 180) * (r - 2);
  return (
    // Width tracks knob size so small knobs pack densely (floor keeps the
    // value/label text readable).
    <div className="flex flex-col items-center" style={{ width: Math.max(size + 10, 50) }}>
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
        title="Drag or scroll · Shift = fine · Double-click reset"
      >
        <svg width={size} height={size} className="overflow-visible">
          <circle cx={cx} cy={cy} r={r + 2} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.07)" />
          <path d={arcPath(cx, cy, r, -135, 135)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3.5} strokeLinecap="round" />
          <path d={arcPath(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" style={{ filter: drag ? `drop-shadow(0 0 5px ${color})` : `drop-shadow(0 0 2px ${color})` }} />
          <line x1={cx} y1={cy} x2={ix} y2={iy} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <circle cx={ix} cy={iy} r={3} fill={color} />
        </svg>
      </div>
      <div className="text-[10px] font-mono text-white/85 -mt-0.5 leading-none">{format(value)}</div>
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
