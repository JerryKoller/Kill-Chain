import { useCallback, useEffect, useRef, useState } from "react";
import "./fireChrome.css";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { SequencerPanel } from "./SequencerPanel";
import {
  useFireCommandStore,
  activeFireEngine,
  FIRE_PRESETS,
  SCENE_SLOTS,
  type ArpMode,
  type ArpDivision,
  type ArpSettings,
  type FireKeyboardMode,
  DEFAULT_ARP,
} from "@/state/fireCommandStore";
import { FireBreadcrumb } from "./FireBreadcrumb";
import { FireMasterMeter } from "./FireMasterMeter";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { playUi } from "@/audio/uiSounds";
import { getEngine } from "@/audio/AudioEngine";
import { useFireSequencerStore, NOTE_NAMES, SCALES } from "@/state/fireSequencerStore";
import { useMidiStore, registerMidiNoteHandler } from "@/state/midiStore";
import { useFireMidiFocusStore, bootFireMidiFocus } from "@/state/fireMidiFocusStore";
import { focusPageKnobs, focusModuleAt, focusPageCount, FIRE_FOCUS_COUNT } from "./fireKnobFocus";
import { FIRE_BANDS, FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";
import { DEFAULT_FIRE_PATCH, type FirePatch, type LfoWave, type FireFilterType, type LfoDest, type SubWave, type DriveMode, type ModSource, type ModDest, type ModRoute, type SpectralMode, type FireBitDepth, type ChipNoiseMode, type FmEngineMode, type NoiseMode, type OscBInheritMode, type Lfo2Relation, type Lfo2DriftMode, type GlideMode, type GlideCurve, type GlideRateMode, type RingMode, type DriveTonePos, type PhaserStereoMode } from "@/audio/dsp/FireCommandSynth";
import { matrixArcsForParam, countRoutesFrom, MOD_DEST_LABELS } from "@/audio/dsp/modRouting";
import { fxTechState, fxTechBadge, FX_QUALITY_LABELS, type FxQuality, type LowProtect } from "@/audio/dsp/fxClarity";
import {
  MASTER_CHAIN_SCENES,
  MIX_CHAIN_COPY,
  MIX_GROUP_LABELS,
  fmtGrDb,
  punchMacroToGlue,
  widthScaleLegend,
  type AirArch,
  type CeaseMode,
  type GlueMode,
  type MasterChainScene,
  type MorphInterp,
  type MorphPadMode,
  type ScopeViewMode as MixScopeViewMode,
  type VoiceStealPolicy,
  type WidthMechanism,
} from "@/audio/dsp/mixClarity";
import { modEnvPresetPoints } from "@/audio/dsp/toneDifferentiation";
import { WAVETABLES, FRAME_COUNT, frameSamples, wavetableName } from "@/audio/dsp/wavetables";
import { DriveStageViz } from "./DriveStageViz";
import { AgeStageViz } from "./AgeStageViz";
import { PhaserStageViz } from "./PhaserStageViz";
import { ChorusStageViz } from "./ChorusStageViz";
import { DelayStageViz } from "./DelayStageViz";
import { ReverbStageViz } from "./ReverbStageViz";
import { SpectralStageViz } from "./SpectralStageViz";
import { WarpStageViz } from "./WarpStageViz";
import { ChipStageViz } from "./ChipStageViz";
import { NoiseStageViz } from "./NoiseStageViz";
import { SubStageViz } from "./SubStageViz";
import { SourceRelationshipStrip } from "./SourceRelationshipStrip";
import { PerfRelationshipStrip } from "./PerfRelationshipStrip";
import { PerfScopeBadge } from "./PerfScopeBadge";
import { PerfMidiLearnButton } from "./PerfMidiLearnButton";
import { levelVoiceState, forgeState, modActivityCount } from "./sourceModuleState";
import { UnisonStageViz } from "./UnisonStageViz";
import { AnalogLifeStageViz } from "./AnalogLifeStageViz";
import { FilterStageViz } from "./FilterStageViz";
import { AmpEnvStageViz } from "./AmpEnvStageViz";
import { ModEnvStageViz } from "./ModEnvStageViz";
import { FiltEnvStageViz } from "./FiltEnvStageViz";
import { PluckStageViz } from "./PluckStageViz";
import { Lfo1StageViz } from "./Lfo1StageViz";
import { Lfo2StageViz } from "./Lfo2StageViz";
import { FmStageViz } from "./FmStageViz";
import { FmRackStageViz } from "./FmRackStageViz";
import { PitchStageViz } from "./PitchStageViz";
import { HarmonyStageViz } from "./HarmonyStageViz";
import {
  HarmCharacterStrip,
  HarmModeStrip,
  HarmLevelStrip,
  HarmQuickActions,
  HarmScaleBadge,
  HarmMeter,
  harmStageLabel,
  harmonyVoiceCount,
  HARMONY_MODES,
  HARM_C,
  HARM_C_GLOW,
  HARM_C_LEVEL,
  HARM_C_MODE,
  HARM_C_ROOT,
} from "./HarmonyPanel";
import { ScaleStageViz } from "./ScaleStageViz";
import {
  ScaleCharacterStrip,
  ScaleRootStrip,
  ScaleModeStrip,
  ScaleCorrectStrip,
  ScaleQuickActions,
  ScaleMeter,
  scaleStageLabel,
  scaleMeta,
  SCALE_C,
  SCALE_C_GLOW,
  SCALE_C_ROOT,
  SCALE_C_MODE,
  SCALE_C_LOCK,
} from "./ScalePanel";
import { ChordStageViz } from "./ChordStageViz";
import {
  ChordCharacterStrip,
  ChordDegreeStrip,
  ChordQuickActions,
  ChordMeter,
  chordStageLabel,
  chordPresetLabel,
  normalizeChordIvs,
  CHORD_PRESETS,
  CHORD_C,
  CHORD_C_GLOW,
  CHORD_C_HOT,
  CHORD_C_ROOT,
  CHORD_C_VOICE,
  CHORD_C_ARM,
} from "./ChordPanel";
import { HumanStageViz } from "./HumanStageViz";
import {
  HumanCharacterStrip,
  HumanTimingStrip,
  HumanVelStrip,
  HumanQuickActions,
  HumanMeter,
  humanStageLabel,
  humanCharMatch,
  HUMAN_C,
  HUMAN_C_GLOW,
  HUMAN_C_TIME,
  HUMAN_C_VEL,
  HUMAN_C_ARM,
} from "./HumanPanel";
import { ScenesStageViz } from "./ScenesStageViz";
import {
  ScenesModeStrip,
  ScenesQuickActions,
  ScenesMeter,
  sceneStageLabel,
  sceneFingerprint,
  occupiedCount,
  avgSceneEnergy,
  SCENE_MODES,
  type SceneMode,
  SCENES_C,
  SCENES_C_GLOW,
  SCENES_C_HOT,
  SCENES_C_FILL,
  SCENES_C_EMPTY,
  SCENES_C_MODE,
} from "./ScenesPanel";
import { WidthStageViz } from "./WidthStageViz";
import {
  WidthCharacterStrip,
  WidthSnapStrip,
  WidthQuickActions,
  WidthMeter,
  widthStageLabel,
  widthMidSide,
  WIDTH_C,
  WIDTH_C_GLOW,
  WIDTH_C_MID,
  WIDTH_C_SIDE,
  WIDTH_C_CORR,
  WIDTH_MAX,
} from "./WidthPanel";
import { GlueStageViz } from "./GlueStageViz";
import {
  GlueCharacterStrip,
  GlueSnapStrip,
  GlueModeStrip,
  GlueQuickActions,
  GlueMeter,
  glueStageLabel,
  glueMetrics,
  GLUE_C,
  GLUE_C_GLOW,
  GLUE_C_THR,
  GLUE_C_RAT,
  GLUE_C_GR,
  GLUE_C_MK,
} from "./GluePanel";
import { AirStageViz } from "./AirStageViz";
import {
  AirCharacterStrip,
  AirAmountStrip,
  AirQuickActions,
  AirMeter,
  airStageLabel,
  airMetrics,
  AIR_C,
  AIR_C_GLOW,
  AIR_C_LOW,
  AIR_C_HIGH,
  AIR_C_AMT,
} from "./AirPanel";
import { ScopeStageViz } from "./ScopeStageViz";
import {
  ScopeOscWave,
  ScopeViewStrip,
  ScopeZoomStrip,
  ScopeQuickActions,
  ScopeMeter,
  ScopeVoiceBadge,
  SCOPE_C,
  SCOPE_C_GLOW,
  SCOPE_C_HOT,
  SCOPE_C_A,
  SCOPE_C_B,
  SCOPE_C_C,
  SCOPE_C_MST,
  SCOPE_DEFAULT_VIZ,
  type ScopeViewMode,
  type ScopeVizState,
} from "./ScopePanel";
import { LiveStageViz } from "./LiveStageViz";
import { readScopeFreeze, SCOPE_FREEZE_EVENT, writeScopeFreeze } from "./scopeFreezeBridge";
import {
  LiveCharacterStrip,
  LiveVoiceStrip,
  LiveOctaveStrip,
  LiveQuickActions,
  LiveMeter,
  LIVE_C,
  LIVE_C_GLOW,
  LIVE_C_HOT,
  LIVE_C_POLY,
  LIVE_C_FX,
  LIVE_C_MST,
  LIVE_C_OCT,
} from "./LivePanel";
import { MacroStageViz } from "./MacroStageViz";
import {
  MacroCharacterStrip,
  MacroSnapStrip,
  MacroQuickActions,
  MacroMeter,
  macroStageLabel,
  MACRO_C,
  MACRO_C_GLOW,
  MACRO_HELM_COLORS,
  MACRO_KEYS,
} from "./MacroPanel";
import { GateStageViz } from "./GateStageViz";
import {
  GateCharacterStrip,
  GateRateStrip,
  GateDepthStrip,
  GateStepsStrip,
  GateQuickActions,
  GateMeter,
  gateStageLabel,
  GATE_C,
  GATE_C_GLOW,
  GATE_C_RATE,
  GATE_C_DEPTH,
  GATE_C_STEPS,
  GATE_C_SMOOTH,
} from "./GatePanel";
import { useFireCollapsed } from "./useFireCollapsed";
import { CollapseToggle } from "./CollapseToggle";
import { FireBand, useFireBandRegister } from "./FireBand";
import { PresetBrowser } from "./PresetBrowser";
import { CharacterBrowser } from "./CharacterBrowser";
import { MixerPanel } from "./MixerPanel";
import { ModPatchGrid } from "./ModPatchGrid";
import { MatrixStageViz } from "./MatrixStageViz";
import { ArpStageViz } from "./ArpStageViz";
import { FireMorphPad } from "./FireMorphPad";
import { undoFire, redoFire, useFireHistoryStore } from "@/lib/fireHistory";
import { MutateCluster } from "./MutateCluster";
import { RandomizeCluster } from "./RandomizeCluster";
import { FireLayoutProvider, useFireLayout } from "./FireLayoutContext";
import { FireCommandDeck } from "./FireCommandDeck";
import { ensureExpanded, foldStorageKey, scrollFireCommandTop, writeFold } from "./fireNavigate";
import { useFireWorkspace, type FireWorkspace } from "./useFireWorkspace";
import { FireWorkspaceTabs } from "./FireWorkspaceTabs";
import { FireMiniTransport } from "./FireMiniTransport";
import { FireCommandPalette } from "./FireCommandPalette";
import { FireSaveTiers } from "./FireSaveTiers";
import { useFireSynthBand, type FireSynthBand } from "./useFireSynthBand";
import { FireSynthBandTabs } from "./FireSynthBandTabs";
import { OscAStageViz } from "./OscAStageViz";
import { OscBStageViz } from "./OscBStageViz";
import { OscCStageViz } from "./OscCStageViz";
import { FC, bandShade, FC_BAND } from "./fireColors";

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

function StudioBay({ compact = false }: { compact?: boolean }) {
  const undoDepth = useFireHistoryStore((s) => s.undoDepth);
  const redoDepth = useFireHistoryStore((s) => s.redoDepth);
  if (compact) {
    const btn = (on: boolean) =>
      `h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-[0.06em] transition inline-flex items-center gap-1.5 ${
        on
          ? "bg-white/[0.09] text-white/90 hover:bg-white/[0.14] ring-1 ring-white/15"
          : "bg-white/[0.03] text-white/25 cursor-default ring-1 ring-white/6"
      }`;
    return (
      <div className="flex flex-col justify-center gap-1.5 shrink-0 h-full min-h-[56px]">
        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40 leading-none">
          Studio
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => undoFire()} disabled={undoDepth === 0} className={btn(undoDepth > 0)} title="Undo (Ctrl+Z)">
            <span aria-hidden>↶</span>
            Undo
            <span className="font-mono tabular-nums text-[9px] opacity-50">{undoDepth}</span>
          </button>
          <button onClick={() => redoFire()} disabled={redoDepth === 0} className={btn(redoDepth > 0)} title="Redo (Ctrl+Y)">
            <span aria-hidden>↷</span>
            Redo
            <span className="font-mono tabular-nums text-[9px] opacity-50">{redoDepth}</span>
          </button>
        </div>
      </div>
    );
  }
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
      <div className="grid grid-cols-2 gap-1.5 w-full">
        {/* Neutral history bars — coral/sky here read as Snapshot A/B. */}
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" title={`${undoDepth} undo steps`}>
          <div
            className="h-full rounded-full bg-white/45 transition-[width] duration-200"
            style={{ width: `${Math.min(100, undoDepth * 8)}%` }}
          />
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" title={`${redoDepth} redo steps`}>
          <div
            className="h-full rounded-full bg-white/25 transition-[width] duration-200"
            style={{ width: `${Math.min(100, redoDepth * 8)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Soft vertical hairline — zones share one panel, no hard boxes. */
function CommandRailSep() {
  return (
    <div
      aria-hidden
      className="hidden lg:block w-px self-stretch shrink-0 my-1.5"
      style={{
        background:
          "linear-gradient(to bottom, transparent 10%, rgba(255,255,255,0.16) 40%, rgba(255,255,255,0.16) 60%, transparent 90%)",
      }}
    />
  );
}

export function FireCommandView() {
  const presetId = useFireCommandStore((s) => s.presetId);
  const presetIdB = useFireCommandStore((s) => s.presetIdB);
  const editTarget = useFireCommandStore((s) => s.editTarget);
  const setEditTarget = useFireCommandStore((s) => s.setEditTarget);
  const octave = useFireCommandStore((s) => s.octave);
  const midiInputs = useMidiStore((s) => s.inputs);
  const midiListening = useMidiStore((s) => s.listening);
  const midiLastNote = useMidiStore((s) => s.lastNote);
  const midiAvailable = useMidiStore((s) => s.available);
  const midiError = useMidiStore((s) => s.error);
  const rescanMidi = useMidiStore((s) => s.rescan);
  const mono = useFireCommandStore((s) => s.patch.mono);
  const keyboardMode = useFireCommandStore((s) => s.keyboardMode);
  const setKeyboardMode = useFireCommandStore((s) => s.setKeyboardMode);
  const cycleKeyboardMode = useFireCommandStore((s) => s.cycleKeyboardMode);
  const fireUiDensity = useFireCommandStore((s) => s.fireUiDensity);
  const setParam = useFireCommandStore((s) => s.setParam);
  const loadPreset = useFireCommandStore((s) => s.loadPreset);
  const resetToDefaults = useFireCommandStore((s) => s.resetToDefaults);
  const shiftOctave = useFireCommandStore((s) => s.shiftOctave);
  const setRouteThroughFx = useFireCommandStore((s) => s.setRouteThroughFx);
  const panic = useFireCommandStore((s) => s.panic);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  const bypass = useAudioStore((s) => s.bypass);
  const routeThroughFx = useFireCommandStore((s) => s.routeThroughFx);
  const fxOn = routeThroughFx && !bypass;
  const [browserOpen, setBrowserOpen] = useState(false);
  const [characterBrowserOpen, setCharacterBrowserOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  const [workspace, setWorkspaceRaw] = useFireWorkspace();
  const [synthBand, setSynthBandRaw] = useFireSynthBand();

  const setWorkspace = useCallback((ws: FireWorkspace) => {
    if (ws === "sequencer") {
      useFireSequencerStore.getState().setCollapsed(false);
      const mode = useFireCommandStore.getState().keyboardMode;
      // Full keyboard eats vertical space the roll needs — collapse to strip.
      if (mode === "full") useFireCommandStore.getState().setKeyboardMode("strip");
    }
    setWorkspaceRaw(ws);
    scrollFireCommandTop("smooth");
  }, [setWorkspaceRaw]);

  const setSynthBand = useCallback((band: FireSynthBand) => {
    setSynthBandRaw(band);
    scrollFireCommandTop("smooth");
  }, [setSynthBandRaw]);

  const activePresetId = editTarget === "b" ? presetIdB : presetId;
  const currentName =
    activePresetId === "custom"
      ? (editTarget === "b" ? "Custom B" : "Custom")
      : FIRE_PRESETS.find((p) => p.id === activePresetId)?.name ??
        useFireCommandStore.getState().userPresets.find((p) => p.id === activePresetId)?.name ??
        (editTarget === "b" ? "Synth B" : "Custom");

  // Prev/Next patch cycling — walks factory bank then user presets, wrapping
  // at the ends. From "Custom" it re-enters the bank at the start.
  const cyclePreset = useCallback(
    (dir: 1 | -1) => {
      const s = useFireCommandStore.getState();
      const ids = [...FIRE_PRESETS.map((p) => p.id), ...s.userPresets.map((p) => p.id)];
      if (ids.length === 0) return;
      const curId = s.editTarget === "b" ? s.presetIdB : s.presetId;
      const cur = ids.indexOf(curId);
      const next = cur === -1
        ? (dir === 1 ? 0 : ids.length - 1)
        : (cur + dir + ids.length) % ids.length;
      s.loadPreset(ids[next]);
      const all = [...FIRE_PRESETS, ...s.userPresets];
      const p = all.find((x) => x.id === ids[next]) ?? all[next];
      useUIStore.getState().toast(
        `♪ ${p.name}${s.editTarget === "b" ? " → B" : ""}${"category" in p ? ` · ${(p as { category?: string }).category ?? ""}` : ""}`,
      );
    },
    [],
  );

  useEffect(() => {
    useFireCommandStore.getState().sync();
    // Persisted mixer/limiter/duck state lands on the engine buses (v1.6).
    useFireSequencerStore.getState().syncFireMixer();
    // Warm the AudioContext so the first MIDI hit isn't waiting on resume().
    void getEngine().resume();
    return () => useFireCommandStore.getState().panic();
  }, []);

  // USB MIDI keyboard (e.g. Akai MPK Mini) → active edit target (A or B).
  // MPK Octave ± shifts note numbers on the device itself — no MIDI CC.
  // QWERTY Z/X still shift the on-screen / computer-key octave.
  // Knobs → Signal Path focus (see fireMidiFocusStore).
  useEffect(() => {
    void useMidiStore.getState().startListening();
    bootFireMidiFocus();
    registerMidiNoteHandler({
      noteOn: (midi, vel) => useFireCommandStore.getState().noteOn(midi, vel),
      noteOff: (midi) => useFireCommandStore.getState().noteOff(midi),
      octaveDelta: (d) => useFireCommandStore.getState().shiftOctave(d),
      octaveReset: () => useFireCommandStore.getState().setOctave(4),
    });
    return () => registerMidiNoteHandler(null);
  }, []);

  useEffect(() => {
    const pressed = new Map<string, number>();
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
        if (k === "k") {
          e.preventDefault();
          setPaletteOpen(true);
          return;
        }
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
      const midi = (store.octave + 1) * 12 + semi;
      pressed.set(k, midi);
      store.noteOn(midi);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const midi = pressed.get(k);
      if (midi === undefined) return;
      pressed.delete(k);
      useFireCommandStore.getState().noteOff(midi);
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

  const flush = true; // Synth + Sequencer share one continuous console

  return (
    <FireLayoutProvider>
    <div
      className="h-full min-h-0 flex flex-col"
      data-fire-root
      data-fire-density={fireUiDensity}
      data-fire-host={typeof window !== "undefined" && (window as Window & { __KILLCHAIN_PLUGIN__?: boolean }).__KILLCHAIN_PLUGIN__ ? "plugin" : "standalone"}
    >
      <div
        className="fire-console relative rounded-2xl flex-1 min-h-0 flex flex-col overflow-hidden"
        style={{
          border: "1px solid rgba(255,255,255,0.1)",
          background:
            "linear-gradient(180deg, #141218 0%, #0c0c10 42%, #0a0a0e 100%)",
          boxShadow:
            "0 0 0 1px rgba(0,0,0,0.35) inset, 0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
      <FireBreadcrumb workspace={workspace} synthBand={synthBand} meter={<FireMasterMeter />} />
      {/* Modules scroll; keyboard stays pinned to the console footer. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain min-h-[120px]">
      {/* One continuous command rail — fire → green gradient, soft zone seps */}
      <div
        className="fire-header relative overflow-hidden rounded-t-2xl"
        style={undefined}
      >
        {/* Master wash: red left → amber mid → green right */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(105deg, #2a100c 0%, #1a1210 18%, #121412 52%, #0c1612 78%, #0a1614 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,106,61,0.22) 0%, rgba(255,140,80,0.1) 28%, rgba(180,160,90,0.05) 50%, rgba(80,180,120,0.1) 72%, rgba(52,211,153,0.2) 100%)",
          }}
        />
        {/* Soft bloom accents */}
        <div
          className="pointer-events-none absolute -left-8 top-1/2 h-28 w-28 -translate-y-1/2 rounded-full blur-3xl opacity-50"
          style={{ background: "rgba(255,106,61,0.45)" }}
        />
        <div
          className="pointer-events-none absolute -right-6 top-1/2 h-28 w-36 -translate-y-1/2 rounded-full blur-3xl opacity-40"
          style={{ background: "rgba(52,211,153,0.4)" }}
        />
        {/* Specular sheen */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, rgba(255,160,100,0.35), rgba(255,255,255,0.12), rgba(120,230,180,0.3))" }}
        />
        {/* Soft handoff into the next zone (violet workspace / brass transport) */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(167,139,250,0.08) 55%, rgba(12,12,16,0.35) 100%)",
          }}
        />

        {/* Always allow wrapping — shrink-0 cluster contents overlap when the
            row is forced onto one line at sub-1600px widths. */}
        <div className="relative z-10 flex flex-wrap items-stretch gap-x-0 gap-y-1.5 px-1.5 py-2.5">
          {/* Brand */}
          <div className="flex items-center gap-2.5 px-3 py-1 shrink-0 min-h-[60px]">
            <div
              className="w-11 h-11 rounded-xl grid place-items-center shrink-0 animate-[evolve-breathe_4.5s_ease-in-out_infinite]"
              style={{
                background: "linear-gradient(145deg, rgba(255,106,61,0.32), rgba(10,10,10,0.92))",
                boxShadow: "0 0 26px rgba(255,106,61,0.35), inset 0 0 14px rgba(255,106,61,0.14)",
                border: "1px solid rgba(255,106,61,0.45)",
              }}
              title="Fire Command MK IV — weapons free"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="8" stroke="#ff6a3d" strokeWidth="1.4" opacity="0.95" />
                <circle cx="12" cy="12" r="3.4" stroke="#ffcf5c" strokeWidth="1.2" opacity="0.9" />
                <circle cx="12" cy="12" r="1" fill="#ff6a3d" />
                <path d="M12 1v4.4M12 18.6V23M1 12h4.4M18.6 12H23" stroke="#ff6a3d" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0 leading-none">
              <div className="fire-title text-[16px] font-black tracking-[0.1em]">FIRE COMMAND</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className="text-[9px] font-black tracking-[0.22em] px-1.5 py-0.5 rounded"
                  style={{ color: "#ffcf5c", background: "rgba(255,207,92,0.12)", boxShadow: "inset 0 0 0 1px rgba(255,207,92,0.35)" }}
                >
                  MK IV
                </span>
                <span className="text-[8px] uppercase tracking-[0.16em] text-[#ff9a6b]/70">weapons free</span>
              </div>
            </div>
          </div>

          <CommandRailSep />

          {/* Patch — row1 tools, row2 preset strip (aligned) */}
          <div className="flex flex-col justify-center gap-1.5 px-3 py-1 flex-[1.2] basis-[19rem] min-w-[19rem] min-h-[60px]">
            <div className="flex items-center gap-1.5 min-w-0 min-h-[2rem] flex-wrap">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40 leading-none shrink-0">
                Snapshot
              </div>
              <div className="inline-flex h-8 rounded-md bg-black/35 p-0.5 shrink-0 ring-1 ring-white/10 fc-snapshot-toggle">
                {(["a", "b"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEditTarget(t)}
                    className="h-full min-w-[30px] px-2.5 text-[10px] font-black uppercase tracking-[0.1em] rounded transition"
                    style={
                      editTarget === t
                        ? {
                            background: t === "b" ? "rgba(98,182,255,0.28)" : "rgba(255,106,61,0.32)",
                            color: t === "b" ? "#b8dcff" : "#ffbfa0",
                          }
                        : { color: "rgba(255,255,255,0.35)" }
                    }
                    title={t === "a" ? "Snapshot A — edit Synth A patch" : "Snapshot B — edit Synth B patch"}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Neutral chrome — the violet accent belonged to the Synth
                  workspace tab and made two unrelated violet CTAs. */}
              <button
                onClick={() => setCharacterBrowserOpen(true)}
                className="h-8 px-2.5 rounded-md text-[10px] font-semibold transition bg-white/[0.05] text-white/75 hover:bg-white/10 ring-1 ring-white/12 shrink-0"
                title="Characters — genesis character cards / starting personalities"
              >
                Characters
              </button>
              <button
                onClick={() => loadPreset("init")}
                className="h-8 px-2.5 rounded-md text-[10px] text-white/70 transition bg-white/[0.04] hover:bg-white/10 ring-1 ring-white/10 shrink-0"
                title="Reset to Init patch"
              >
                ↺ Init
              </button>
              <button
                type="button"
                data-ui-sound="none"
                onClick={() => {
                  if (confirmDefaults) {
                    playUi("purge");
                    resetToDefaults();
                    setConfirmDefaults(false);
                    useUIStore.getState().toast(
                      "Everything reset — patches, piano roll, sequencer, arrangement, mixer, and settings. Blank slate.",
                      "warn",
                    );
                  } else {
                    playUi("press");
                    setConfirmDefaults(true);
                    setTimeout(() => setConfirmDefaults(false), 2400);
                  }
                }}
                className={`h-8 px-2.5 rounded-md text-[10px] font-semibold transition shrink-0 ring-1 ${
                  confirmDefaults
                    ? "bg-rose-500/20 text-rose-200 ring-rose-400/70"
                    : "bg-rose-500/5 text-rose-200/80 hover:bg-rose-500/10 ring-rose-400/30"
                }`}
                title="Blank slate — wipe Fire Command entirely: synths, piano roll, drums, arrangement, mixer, and UI (tap again to confirm)"
              >
                {confirmDefaults ? "WIPE ALL?" : "✕ Defaults"}
              </button>
            </div>
            <div className="flex items-center gap-1 min-w-0 h-8">
              <button
                onClick={() => cyclePreset(-1)}
                className="w-8 h-8 shrink-0 rounded-md bg-white/[0.04] hover:bg-white/10 text-white/65 text-xs leading-none transition ring-1 ring-white/10"
                title="Previous preset"
                aria-label="Previous preset"
              >
                ◂
              </button>
              <button
                onClick={() => setBrowserOpen(true)}
                className="flex items-center gap-2 rounded-md bg-black/40 hover:bg-black/55 px-2.5 h-8 transition min-w-0 flex-1 ring-1 ring-white/10 hover:ring-white/20"
                title="Open the preset library"
              >
                <span className="text-sm leading-none shrink-0" style={{ color: FIRE }}>♪</span>
                <span className="text-[12px] font-semibold text-white truncate">{currentName}</span>
                <span className="ml-auto text-[9px] uppercase tracking-[0.14em] text-white/40 shrink-0">Browse</span>
              </button>
              <button
                onClick={() => cyclePreset(1)}
                className="w-8 h-8 shrink-0 rounded-md bg-white/[0.04] hover:bg-white/10 text-white/65 text-xs leading-none transition ring-1 ring-white/10"
                title="Next preset"
                aria-label="Next preset"
              >
                ▸
              </button>
            </div>
          </div>

          <CommandRailSep />

          {/* Random Armory */}
          <div className="fc-chrome-armory flex items-stretch px-3 py-1 flex-1 basis-[14rem] min-w-[14rem] min-h-[60px]">
            <RandomizeCluster compact />
          </div>

          <CommandRailSep />

          {/* Natural Selection */}
          <div className="fc-chrome-mutate flex items-stretch px-3 py-1 flex-1 basis-[14rem] min-w-[14rem] min-h-[60px]">
            <MutateCluster compact />
          </div>

          <CommandRailSep />

          {/* Studio — labeled Undo / Redo + save tiers */}
          <div className="fc-chrome-studio flex items-stretch px-3 py-1 shrink-0 min-h-[60px] gap-3">
            <StudioBay compact />
            <FireSaveTiers />
          </div>
        </div>
      </div>

      <FireCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onWorkspace={setWorkspace}
      />

      <FireWorkspaceTabs workspace={workspace} onChange={setWorkspace} flush={flush} />

      {workspace === "sequencer" ? (
        <SequencerPanel flush={flush} />
      ) : (
      <>
      {/* Synth chrome — transport + band tabs flush into the console */}
      <FireMiniTransport flush={flush} />
      <FireSynthBandTabs band={synthBand} onChange={setSynthBand} flush={flush} />

      {/* Home = Signal Path hub; band tabs mount only that category */}
      {synthBand === "home" && <FireCommandDeck flush={flush} />}

      {synthBand === "band.sources" && (
      <FireBand title="Sources" color={FC_BAND.sources} bandKey="band.sources" hint="prime · twin · depth · forge · circuit · storm · tectonic" foldable={false} flush={flush}>
        <SourceRelationshipStrip />
        <OscAPanel chipHosted />
        <OscBPanel chipHosted />
        <OscCPanel chipHosted />
        <WarpPanel chipHosted />
        <ChipPanel chipHosted />
        <NoisePanel chipHosted />
        <SubPanel chipHosted />
      </FireBand>
      )}

      {synthBand === "band.tone" && (
      <FireBand title="Tone" color={FC_BAND.tone} bandKey="band.tone" hint="unison · analog life · filter · envelopes" foldable={false} flush={flush}>
        <UnisonPanel chipHosted />
        <AnalogLifePanel chipHosted />
        <FilterPanel chipHosted />
        <AmpEnvPanel chipHosted />
        <ModEnvPanel chipHosted />
        <FiltEnvPanel chipHosted />
        <PluckPanel chipHosted />
      </FireBand>
      )}

      {synthBand === "band.mod" && (
      <FireBand title="Modulation" color={FC_BAND.mod} bandKey="band.mod" hint="lfos · fm · fm rack · pitch · matrix · arp" foldable={false} flush={flush}>
        <Lfo1Panel chipHosted />
        <Lfo2Panel chipHosted />
        <FmPanel chipHosted />
        <FmRackPanel chipHosted />
        <PitchPanel chipHosted />
        <ModMatrixPanel chipHosted />
        <ArpPanel chipHosted />
      </FireBand>
      )}

      {synthBand === "band.fx" && (
      <FireBand title="FX" color={FC_BAND.fx} bandKey="band.fx" hint="Drive → Age → Chorus → Phaser → Delay → Tone → Reverb → Spectral" foldable={false} flush={flush}>
        <FxRackChrome />
        <DrivePanel chipHosted />
        <AgePanel chipHosted />
        <ChorusPanel chipHosted />
        <PhaserPanel chipHosted />
        <DelayPanel chipHosted />
        <ReverbPanel chipHosted />
        <SpectralPanel chipHosted />
      </FireBand>
      )}

      {synthBand === "band.mix" && (
      <FireBand title="Mix & Output" color={FC_BAND.mix} bandKey="band.mix" hint="A/B/Drums/Samples → Mixer → Glue → Air → Width → Limiter → Scope · Morph/Live are state" foldable={false} flush={flush}>
        <MixRackChrome />
        <MixGroupHeader title="Routing" />
        <MixerPanel chipHosted />
        <MixGroupHeader title="Morph" />
        <FireMorphPad chipHosted />
        <MixGroupHeader title="Mastering" />
        <GluePanel chipHosted />
        <AirPanel chipHosted />
        <WidthPanel chipHosted />
        <MixGroupHeader title="Analysis" />
        <ScopePanel chipHosted />
        <MixGroupHeader title="Stage" />
        <LivePanel chipHosted />
      </FireBand>
      )}

      {synthBand === "band.perf" && (
      <FireBand title="Performance" color={FC_BAND.perf} bandKey="band.perf" hint="Control · Rhythm · Pitch" foldable={false} flush={flush}>
        <PerfRelationshipStrip />
        <PerfGroupHeader title="Control" subtitle="Macros · Scenes" />
        <MacrosPanel chipHosted />
        <ScenesPanel chipHosted />
        <PerfGroupHeader title="Rhythm" subtitle="Gate · Humanize" />
        <GatePanel chipHosted />
        <HumanPanel chipHosted />
        <PerfGroupHeader title="Pitch" subtitle="Scale · Chord · Harmony" />
        <ScalePanel chipHosted />
        <ChordPanel chipHosted />
        <HarmonyPanel chipHosted />
      </FireBand>
      )}

      </>
      )}
      </div>{/* /modules scroll */}

      {/* Keyboard — outside the scroll region so it stays docked above transport */}
      {(() => {
        const effectiveMode: FireKeyboardMode =
          workspace === "sequencer" && keyboardMode === "full" ? "strip" : keyboardMode;
        const midiText = !midiAvailable
          ? "MIDI unsupported"
          : midiError
            ? "MIDI error"
            : !midiListening
              ? "MIDI connecting…"
              : midiInputs.length === 0
                ? "No MIDI device"
                : midiInputs.map((i) => i.name).join(" · ");

        if (effectiveMode === "hidden") {
          return (
            <div className={`shrink-0 z-10 ${flush ? "rounded-b-2xl bg-black/30 backdrop-blur-md" : "pt-2"}`}>
              <div className="px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap">
                <div className="fc-text-secondary min-w-0 truncate">
                  <span className="uppercase tracking-[0.2em] mr-2 text-white/45">Keys</span>
                  {midiText} · OCT {octave}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => panic()}
                    className="rounded-md border border-[#ff6a3d]/40 bg-[#ff6a3d]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#ffbfa0]"
                    title="All notes off"
                  >
                    Panic
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyboardMode("strip")}
                    className="rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-2 py-1 text-[10px] text-white/80"
                  >
                    Show strip
                  </button>
                </div>
              </div>
            </div>
          );
        }

        if (effectiveMode === "strip") {
          return (
            <div className={`shrink-0 z-10 ${flush ? "rounded-b-2xl bg-black/30 backdrop-blur-md" : "pt-2"}`}>
              <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="fc-text-secondary min-w-0">
                  <span className="uppercase tracking-[0.2em] mr-2 text-white/45">Keyboard strip</span>
                  <span className="font-mono text-white/75">QWERTY · MIDI</span>
                  <span className="ml-2">OCT {octave}</span>
                  <span className="ml-2 text-white/40">· {midiText}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button" onClick={() => panic()} className="rounded-md border border-[#ff6a3d]/40 bg-[#ff6a3d]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#ffbfa0]">Panic</button>
                  <button type="button" onClick={() => setKeyboardMode("full")} className="rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-2 py-1 text-[10px] text-white/80">Full</button>
                  <button type="button" onClick={() => setKeyboardMode("hidden")} className="rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-2 py-1 text-[10px] text-white/80">Hide</button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <Keyboard
            octave={octave}
            onMinimize={cycleKeyboardMode}
            onCycleMode={cycleKeyboardMode}
            flush={flush}
            midiLabel={midiText}
            midiHot={!!midiLastNote && Date.now() - midiLastNote.at < 400}
            midiNote={midiLastNote?.midi ?? null}
            onRescanMidi={() => void rescanMidi()}
          />
        );
      })()}

      </div>

      <PresetBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
      />
      <CharacterBrowser
        open={characterBrowserOpen}
        onClose={() => setCharacterBrowserOpen(false)}
      />
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
      try { pos = activeFireEngine().getMorphPositions()[group]; } catch { /* not ready */ }
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
      try { n = activeFireEngine().getActiveVoiceCount(); } catch { n = 0; }
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

function ArpModeGlyph({ mode, active }: { mode: ArpMode; active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path
        d={ARP_MODE_GLYPHS[mode]}
        fill="none"
        stroke={active ? bandShade(FC.mod, 0.96) : "currentColor"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ════════════════════ OSC A — Prime Voice ════════════════════

function OscATableBrowser() {
  const table = useFireCommandStore((s) => s.patch.oscATable);
  const setParam = useFireCommandStore((s) => s.setParam);
  const idx = Math.max(0, WAVETABLES.findIndex((w) => w.id === table));
  const go = (dir: -1 | 1) => {
    const next = WAVETABLES[(idx + dir + WAVETABLES.length) % WAVETABLES.length]!;
    setParam("oscATable", next.id);
  };
  const c = FC.oscA;
  const cHot = bandShade(FC.sources, 0.75);
  return (
    <div className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={() => go(-1)}
        className="h-7 w-7 shrink-0 rounded-md border text-[11px] font-bold transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: cHot, background: `${c}18` }}
        title="Previous wavetable"
      >
        ‹
      </button>
      <select
        value={table}
        onChange={(e) => setParam("oscATable", e.target.value)}
        className="min-w-0 flex-1 truncate rounded-lg border px-2 py-1 text-[11px] font-semibold focus:outline-none cursor-pointer"
        style={{
          borderColor: `${c}55`,
          background: `linear-gradient(180deg, ${c}28, rgba(0,0,0,0.55))`,
          color: cHot,
        }}
        title={wavetableName(table)}
      >
        {WAVETABLES.map((w) => (
          <option key={w.id} value={w.id} className="bg-ink text-white">
            {w.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => go(1)}
        className="h-7 w-7 shrink-0 rounded-md border text-[11px] font-bold transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: cHot, background: `${c}18` }}
        title="Next wavetable"
      >
        ›
      </button>
    </div>
  );
}

function OscAModMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const abs = Math.abs(value);
  const pos = value >= 0;
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.25rem]" title={`${label} ${fmtBi(value)}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
          style={{
            width: `${abs * 50}%`,
            left: pos ? "50%" : `${50 - abs * 50}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: abs > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: abs > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {pos ? "+" : "−"}{Math.round(abs * 100)}
      </div>
    </div>
  );
}

function OscAOctaveStrip() {
  const oct = useFireCommandStore((s) => s.patch.oscAOctave);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscA;
  const cHot = bandShade(FC.sources, 0.8);
  return (
    <div className="flex items-stretch rounded-lg border p-0.5" style={{ borderColor: `${c}44`, background: "rgba(0,0,0,0.35)" }}>
      {([-2, -1, 0, 1, 2] as const).map((n) => {
        const on = oct === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setParam("oscAOctave", n)}
            className="min-w-[1.75rem] rounded-md px-1.5 py-1 text-[10px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    background: `linear-gradient(180deg, ${cHot}55, ${c}40)`,
                    color: "#ffe8e4",
                    boxShadow: `0 0 14px ${c}66`,
                  }
                : { color: "rgba(255,255,255,0.4)" }
            }
            aria-pressed={on}
          >
            {n > 0 ? `+${n}` : n === 0 ? "0" : String(n)}
          </button>
        );
      })}
    </div>
  );
}

function OscAWaveThumbs() {
  const table = useFireCommandStore((s) => s.patch.oscATable);
  const pos = useFireCommandStore((s) => s.patch.oscAPos);
  const setParam = useFireCommandStore((s) => s.setParam);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const c = FC.oscA;

  useEffect(() => {
    const frame = Math.round(pos * (FRAME_COUNT - 1));
    WAVETABLES.forEach((w, wi) => {
      const canvas = canvasRefs.current[wi];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const samples = frameSamples(w.id, frame / Math.max(1, FRAME_COUNT - 1), 48);
      ctx.clearRect(0, 0, W, H);
      const active = w.id === table;
      ctx.fillStyle = active ? `${c}22` : "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * (W - 2) + 1;
        const y = H * 0.5 - samples[i]! * H * 0.38;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = active ? c : "rgba(255,255,255,0.35)";
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.stroke();
    });
  }, [table, pos, c]);

  return (
    <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
      {WAVETABLES.map((w, wi) => {
        const on = w.id === table;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setParam("oscATable", w.id)}
            className="shrink-0 rounded-md border p-0.5 transition"
            style={{
              borderColor: on ? `${c}99` : "rgba(255,255,255,0.1)",
              boxShadow: on ? `0 0 12px ${c}44` : undefined,
              background: on ? `${c}14` : "transparent",
            }}
            title={w.name}
          >
            <canvas
              ref={(el) => { canvasRefs.current[wi] = el; }}
              width={56}
              height={28}
              className="block rounded-sm"
            />
          </button>
        );
      })}
    </div>
  );
}

function OscAFrameScrub() {
  const pos = useFireCommandStore((s) => s.patch.oscAPos);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscA;
  const cur = pos * (FRAME_COUNT - 1);
  const lo = Math.floor(cur);
  const hi = Math.min(lo + 1, FRAME_COUNT - 1);
  const frac = cur - lo;
  const morphPct = Math.round(pos * 100);
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: `${c}aa` }}>
          Frame {lo + 1} → {hi + 1}
        </span>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: bandShade(FC.sources, 0.88) }}>
          Morph {morphPct}% · {Math.round(frac * 100)}% into {hi + 1}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
          Table
        </span>
        <div className="relative flex flex-1 items-center gap-0.5">
          {Array.from({ length: FRAME_COUNT }, (_, i) => {
            const on = i === lo || i === hi;
            const near = Math.abs(i - cur) < 1.01;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setParam("oscAPos", FRAME_COUNT > 1 ? i / (FRAME_COUNT - 1) : 0)}
                className="h-7 flex-1 rounded-md border text-[10px] font-bold tabular-nums transition"
                style={
                  on
                    ? {
                        borderColor: `${c}aa`,
                        background: `linear-gradient(180deg, ${c}55, ${c}28)`,
                        color: "#ffe8e4",
                        boxShadow: `0 0 12px ${c}55`,
                      }
                    : {
                        borderColor: near ? `${c}44` : "rgba(255,255,255,0.08)",
                        background: near ? `${c}12` : "rgba(0,0,0,0.35)",
                        color: near ? `${c}cc` : "rgba(255,255,255,0.35)",
                      }
                }
                aria-pressed={on}
                title={`Frame ${i + 1}/${FRAME_COUNT}`}
              >
                {i + 1}
              </button>
            );
          })}
          {/* Interpolation marker between lo and hi */}
          <div
            className="pointer-events-none absolute top-0 h-full w-0.5 rounded-full"
            style={{
              left: `calc(${(cur / Math.max(1, FRAME_COUNT - 1)) * 100}% - 1px)`,
              background: bandShade(FC.sources, 0.95),
              boxShadow: `0 0 8px ${c}`,
            }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

function OscAQuickActions() {
  const level = useFireCommandStore((s) => s.patch.oscALevel);
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef(0.75);
  const c = FC.oscA;
  const muted = level < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (muted) setParam("oscALevel", savedRef.current > 0.02 ? savedRef.current : 0.75);
          else {
            savedRef.current = level;
            setParam("oscALevel", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: muted ? "rgba(255,255,255,0.2)" : `${c}66`,
          color: muted ? "rgba(255,255,255,0.45)" : bandShade(FC.sources, 0.9),
          background: muted ? "rgba(0,0,0,0.4)" : `${c}28`,
          boxShadow: muted ? undefined : `0 0 10px ${c}33`,
        }}
        title={muted ? "Restore level" : "Mute OSC A"}
      >
        {muted ? "Muted" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("oscAPos", 0.66);
          setParam("oscAEnv", 0);
          setParam("oscALfo", 0);
          setParam("oscADetune", 0);
          setParam("oscAOctave", 0);
          setParam("oscALevel", 0.75);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset OSC A to defaults"
      >
        Reset
      </button>
    </div>
  );
}

function OscAPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.oscA;
  const cEnv = bandShade(FC.sources, 0.55);
  const cLfo = bandShade(FC.sources, 0.72);
  const cDet = bandShade(FC.sources, 0.42);
  const cLvl = bandShade(FC.sources, 0.22);
  const env = useFireCommandStore((s) => s.patch.oscAEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscALfo);
  const level = useFireCommandStore((s) => s.patch.oscALevel);
  const pos = useFireCommandStore((s) => s.patch.oscAPos);
  const detune = useFireCommandStore((s) => s.patch.oscADetune);
  const oct = useFireCommandStore((s) => s.patch.oscAOctave);
  const table = useFireCommandStore((s) => s.patch.oscATable);
  const state = levelVoiceState(level, { role: "prime", wakeHint: "raise Level or unmute" });
  const mods = modActivityCount(env, lfo, detune);

  return (
    <Section
      title="Oscillator A"
      color={c}
      collapseKey="osc.a"
      chipHosted={chipHosted}
      right={<OscATableBrowser />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: `${c}40`,
          background: `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`,
          boxShadow: `inset 0 1px 0 ${c}22`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.88) }}>
            Prime Voice
            <span className="ml-2 font-mono text-[11px] font-normal text-white/45">
              {wavetableName(table)} · morph {Math.round(pos * 100)}% · {oct >= 0 ? `+${oct}` : oct}oct
              {Math.abs(detune) > 0.5 ? ` · ${detune > 0 ? "+" : ""}${Math.round(detune)}¢` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OscAQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: state.tech === "muted" ? "rgba(255,255,255,0.35)" : bandShade(FC.sources, 0.92),
              background: state.tech === "muted" ? "rgba(0,0,0,0.45)" : `${c}36`,
              border: `1px solid ${state.tech === "muted" ? "rgba(255,255,255,0.12)" : `${c}70`}`,
              boxShadow: state.tech === "active" ? `0 0 14px ${c}50` : undefined,
            }}
            title={state.detail}
          >
            {state.tech === "active" ? (mods > 0 ? `${mods} MOD` : "ACTIVE") : state.pill}
          </div>
        </div>
      </div>

      <OscAWaveThumbs />
      <OscAStageViz />
      <OscAFrameScrub />

      <div className="mb-2 flex items-center justify-center gap-4">
        <OscAModMeter label="Env→WT" value={env} color={cEnv} />
        <OscAOctaveStrip />
        <OscAModMeter label="LFO→WT" value={lfo} color={cLfo} />
      </div>

      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey="oscAPos" label="Morph" min={0} max={1} format={fmtPct} def={0.66} size={50} color={c} modEnv={env} modLfo={lfo} />
        <FParamKnob paramKey="oscAContinuity" label="Continuity" min={0} max={1} format={fmtPct} def={0.72} size={46} color={bandShade(FC.sources, 0.6)} />
        <FParamKnob paramKey="oscAEnv" label="Env→WT" min={-1} max={1} bipolar format={fmtBi} def={0} size={42} color={cEnv} />
        <FParamKnob paramKey="oscALfo" label="LFO→WT" min={-1} max={1} bipolar format={fmtBi} def={0} size={42} color={cLfo} />
        <FParamKnob paramKey="oscADetune" label="Detune" min={-50} max={50} integer bipolar format={fmtCents} def={0} size={42} color={cDet} />
        <FParamKnob paramKey="oscALevel" label="Level" min={0} max={1} format={fmtPct} def={0.75} size={48} color={cLvl} />
      </div>
      <div className="mt-1.5 text-center text-[12px] leading-snug" style={{ color: `${c}aa` }}>
        Continuity: low = stepped frames · high = smooth morph. Env/LFO arcs mark Morph travel.
      </div>
    </Section>
  );
}

// ════════════════════ OSC B — Twin Voice ════════════════════

function OscBTableBrowser() {
  const table = useFireCommandStore((s) => s.patch.oscBTable);
  const setParam = useFireCommandStore((s) => s.setParam);
  const idx = Math.max(0, WAVETABLES.findIndex((w) => w.id === table));
  const go = (dir: -1 | 1) => {
    const next = WAVETABLES[(idx + dir + WAVETABLES.length) % WAVETABLES.length]!;
    setParam("oscBTable", next.id);
  };
  const c = FC.oscB;
  const cHot = bandShade(FC.sources, 0.7);
  return (
    <div className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={() => go(-1)}
        className="h-7 w-7 shrink-0 rounded-md border text-[11px] font-bold transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: cHot, background: `${c}18` }}
        title="Previous wavetable"
      >
        ‹
      </button>
      <select
        value={table}
        onChange={(e) => setParam("oscBTable", e.target.value)}
        className="min-w-0 flex-1 truncate rounded-lg border px-2 py-1 text-[11px] font-semibold focus:outline-none cursor-pointer"
        style={{
          borderColor: `${c}55`,
          background: `linear-gradient(180deg, ${c}28, rgba(0,0,0,0.55))`,
          color: cHot,
        }}
        title={wavetableName(table)}
      >
        {WAVETABLES.map((w) => (
          <option key={w.id} value={w.id} className="bg-ink text-white">
            {w.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => go(1)}
        className="h-7 w-7 shrink-0 rounded-md border text-[11px] font-bold transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: cHot, background: `${c}18` }}
        title="Next wavetable"
      >
        ›
      </button>
    </div>
  );
}

function OscBModMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const abs = Math.abs(value);
  const pos = value >= 0;
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.25rem]" title={`${label} ${fmtBi(value)}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
          style={{
            width: `${abs * 50}%`,
            left: pos ? "50%" : `${50 - abs * 50}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: abs > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: abs > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {pos ? "+" : "−"}{Math.round(abs * 100)}
      </div>
    </div>
  );
}

function OscBOctaveStrip() {
  const oct = useFireCommandStore((s) => s.patch.oscBOctave);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscB;
  const cHot = bandShade(FC.sources, 0.75);
  return (
    <div className="flex items-stretch rounded-lg border p-0.5" style={{ borderColor: `${c}44`, background: "rgba(0,0,0,0.35)" }}>
      {([-2, -1, 0, 1, 2] as const).map((n) => {
        const on = oct === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setParam("oscBOctave", n)}
            className="min-w-[1.75rem] rounded-md px-1.5 py-1 text-[10px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    background: `linear-gradient(180deg, ${cHot}55, ${c}40)`,
                    color: "#ffe4ea",
                    boxShadow: `0 0 14px ${c}66`,
                  }
                : { color: "rgba(255,255,255,0.4)" }
            }
            aria-pressed={on}
          >
            {n > 0 ? `+${n}` : n === 0 ? "0" : String(n)}
          </button>
        );
      })}
    </div>
  );
}

function OscBWaveThumbs() {
  const table = useFireCommandStore((s) => s.patch.oscBTable);
  const pos = useFireCommandStore((s) => s.patch.oscBPos);
  const detune = useFireCommandStore((s) => s.patch.oscBDetune);
  const setParam = useFireCommandStore((s) => s.setParam);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const c = FC.oscB;
  const cTwin = bandShade(FC.sources, 0.4);

  useEffect(() => {
    const frame = Math.round(pos * (FRAME_COUNT - 1));
    const phase = Math.min(1, Math.abs(detune) / 50) * 6;
    WAVETABLES.forEach((w, wi) => {
      const canvas = canvasRefs.current[wi];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const samples = frameSamples(w.id, frame / Math.max(1, FRAME_COUNT - 1), 48);
      ctx.clearRect(0, 0, W, H);
      const active = w.id === table;
      ctx.fillStyle = active ? `${c}22` : "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      // Twin thumbnail strokes
      for (const [off, col, lw] of [[-2, active ? c : "rgba(255,255,255,0.28)", 1] as const, [2, active ? cTwin : "rgba(255,255,255,0.2)", 1] as const]) {
        ctx.beginPath();
        for (let i = 0; i < samples.length; i++) {
          const j = (i + (off > 0 ? phase : 0)) % samples.length;
          const x = (i / (samples.length - 1)) * (W - 2) + 1;
          const y = H * 0.5 + off - samples[Math.floor(j)]! * H * 0.32;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = active ? lw + 0.5 : lw;
        ctx.stroke();
      }
    });
  }, [table, pos, detune, c, cTwin]);

  return (
    <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
      {WAVETABLES.map((w, wi) => {
        const on = w.id === table;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setParam("oscBTable", w.id)}
            className="shrink-0 rounded-md border p-0.5 transition"
            style={{
              borderColor: on ? `${c}99` : "rgba(255,255,255,0.1)",
              boxShadow: on ? `0 0 12px ${c}44` : undefined,
              background: on ? `${c}14` : "transparent",
            }}
            title={w.name}
          >
            <canvas
              ref={(el) => { canvasRefs.current[wi] = el; }}
              width={56}
              height={28}
              className="block rounded-sm"
            />
          </button>
        );
      })}
    </div>
  );
}

function OscBFrameScrub() {
  const pos = useFireCommandStore((s) => s.patch.oscBPos);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscB;
  const frame = Math.round(pos * (FRAME_COUNT - 1));
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="shrink-0 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Frame
      </span>
      <div className="flex flex-1 items-center gap-0.5">
        {Array.from({ length: FRAME_COUNT }, (_, i) => {
          const on = i === frame;
          const near = Math.abs(i - frame) === 1;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setParam("oscBPos", FRAME_COUNT > 1 ? i / (FRAME_COUNT - 1) : 0)}
              className="h-6 flex-1 rounded-md border text-[9px] font-bold tabular-nums transition"
              style={
                on
                  ? {
                      borderColor: `${c}aa`,
                      background: `linear-gradient(180deg, ${c}55, ${c}28)`,
                      color: "#ffe4ea",
                      boxShadow: `0 0 12px ${c}55`,
                    }
                  : {
                      borderColor: near ? `${c}44` : "rgba(255,255,255,0.08)",
                      background: near ? `${c}12` : "rgba(0,0,0,0.35)",
                      color: near ? `${c}cc` : "rgba(255,255,255,0.35)",
                    }
              }
              aria-pressed={on}
              title={`Frame ${i + 1}/${FRAME_COUNT}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OscBDetunePresets() {
  const detune = useFireCommandStore((s) => s.patch.oscBDetune);
  const oct = useFireCommandStore((s) => s.patch.oscBOctave);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscB;
  const centPresets = [
    { label: "0¢", v: 0 },
    { label: "±7¢", v: 7 },
    { label: "±12¢", v: 12 },
    { label: "±24¢", v: 24 },
  ] as const;
  const intervalPresets = [
    { label: "0", oct: 0 as const },
    { label: "+8ve", oct: 1 as const },
    { label: "−8ve", oct: -1 as const },
  ] as const;
  return (
    <div className="mb-2 space-y-1.5">
      <div className="flex items-center justify-center gap-1 flex-wrap">
        <span className="mr-1 text-[9px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
          Interval
        </span>
        {intervalPresets.map((p) => {
          const on = oct === p.oct && Math.abs(detune) < 0.5;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setParam("oscBOctave", p.oct);
                setParam("oscBDetune", 0);
              }}
              className="rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums transition"
              style={
                on
                  ? {
                      borderColor: `${c}99`,
                      background: `${c}33`,
                      color: bandShade(FC.sources, 0.85),
                      boxShadow: `0 0 10px ${c}44`,
                    }
                  : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
              }
              title={`Pitch interval ${p.label} (semitone octaves)`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-1">
        <span className="mr-1 text-[9px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
          Cents
        </span>
        {centPresets.map((p) => {
          const on = Math.abs(detune) === p.v || (p.v === 0 && Math.abs(detune) < 0.5);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => setParam("oscBDetune", detune < 0 && p.v !== 0 ? -p.v : p.v)}
              className="rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums transition"
              style={
                on
                  ? {
                      borderColor: `${c}99`,
                      background: `${c}33`,
                      color: bandShade(FC.sources, 0.85),
                      boxShadow: `0 0 10px ${c}44`,
                    }
                  : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
              }
              title={`Beat / detune ${p.v === 0 ? "unison" : `${p.v} cents`}`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setParam("oscBDetune", -detune)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
          style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
          title="Polarity flip — invert detune sign (phase-side mirror of beat)"
        >
          Polarity
        </button>
      </div>
    </div>
  );
}

function OscBQuickActions() {
  const level = useFireCommandStore((s) => s.patch.oscBLevel);
  const inherit = useFireCommandStore((s) => s.patch.oscBInherit) ?? "off";
  const phaseLock = useFireCommandStore((s) => s.patch.oscBPhaseLock) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef(0.5);
  const c = FC.oscB;
  const muted = level < 0.02;
  const stampInherit = (mode: OscBInheritMode) => {
    const patch = useFireCommandStore.getState().patch;
    setParam("oscBInherit", mode);
    if (mode === "off") return;
    if (mode === "family") {
      setParam("oscBTable", patch.oscATable);
      return;
    }
    if (mode === "morph") {
      setParam("oscBPos", patch.oscAPos);
      return;
    }
    if (mode === "mirror") {
      setParam("oscBPos", 1 - patch.oscAPos);
      return;
    }
    if (mode === "offset") {
      setParam("oscBPos", Math.min(1, patch.oscAPos + 0.25));
      return;
    }
    if (mode === "lock") {
      setParam("oscBPhaseLock", true);
      return;
    }
    if (mode === "fm") {
      setParam("fmAtoB", Math.max(patch.fmAtoB ?? 0, 0.55));
    }
  };
  const inheritFromA = (mode: "copy" | "frame" | "morph" | "mirror" | "offset") => {
    const patch = useFireCommandStore.getState().patch;
    if (mode === "copy") {
      setParam("oscBTable", patch.oscATable);
      setParam("oscBPos", patch.oscAPos);
      setParam("oscBEnv", patch.oscAEnv);
      setParam("oscBLfo", patch.oscALfo);
      setParam("oscBOctave", patch.oscAOctave);
      return;
    }
    if (mode === "frame") {
      setParam("oscBTable", patch.oscATable);
      setParam("oscBInherit", "family");
      return;
    }
    if (mode === "morph") {
      setParam("oscBPos", patch.oscAPos);
      setParam("oscBInherit", "morph");
      return;
    }
    if (mode === "mirror") {
      setParam("oscBPos", 1 - patch.oscAPos);
      setParam("oscBInherit", "mirror");
      return;
    }
    setParam("oscBPos", Math.min(1, patch.oscAPos + 0.25));
    setParam("oscBInherit", "offset");
  };
  const liveModes: { id: OscBInheritMode; label: string; title: string }[] = [
    { id: "off", label: "Off", title: "Independent Twin" },
    { id: "morph", label: "Morph", title: "Continuously follow A's morph" },
    { id: "mirror", label: "Mirror", title: "Mirror morph (1 − A)" },
    { id: "offset", label: "+¼", title: "Offset morph +25% from A" },
    { id: "family", label: "Fam", title: "Follow waveform family + morph character" },
    { id: "lock", label: "Lock", title: "Phase-lock B frequency to A" },
    { id: "fm", label: "FM", title: "A frequency-modulates B" },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <div className="flex items-center gap-0.5 rounded-md border p-0.5" style={{ borderColor: `${c}44`, background: `${c}12` }}>
        <span className="px-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}99` }}>←A</span>
        {(
          [
            { id: "copy", label: "All", title: "One-shot copy from A" },
            { id: "frame", label: "Fam", title: "Follow waveform family" },
            { id: "morph", label: "Morph", title: "Follow morph" },
            { id: "mirror", label: "Mirror", title: "Mirror morph" },
            { id: "offset", label: "+¼", title: "Offset morph" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => inheritFromA(m.id)}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold transition hover:brightness-125"
            style={{ color: bandShade(FC.sources, 0.85), background: `${c}22` }}
            title={m.title}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-0.5 rounded-md border p-0.5" style={{ borderColor: `${c}55`, background: "rgba(0,0,0,0.35)" }}>
        <span className="px-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}99` }}>Live</span>
        {liveModes.map((m) => {
          const on = inherit === m.id || (m.id === "lock" && phaseLock && inherit === "lock");
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                if (m.id === "lock") setParam("oscBPhaseLock", !phaseLock || inherit !== "lock");
                stampInherit(inherit === m.id ? "off" : m.id);
              }}
              className="rounded px-1.5 py-0.5 text-[9px] font-bold transition"
              style={
                on
                  ? { color: "#ffe8e4", background: `${c}44`, boxShadow: `0 0 8px ${c}55` }
                  : { color: "rgba(255,255,255,0.45)", background: "transparent" }
              }
              title={m.title}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          if (muted) setParam("oscBLevel", savedRef.current > 0.02 ? savedRef.current : 0.5);
          else {
            savedRef.current = level;
            setParam("oscBLevel", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: muted ? "rgba(255,255,255,0.2)" : `${c}66`,
          color: muted ? "rgba(255,255,255,0.45)" : bandShade(FC.sources, 0.88),
          background: muted ? "rgba(0,0,0,0.4)" : `${c}28`,
          boxShadow: muted ? undefined : `0 0 10px ${c}33`,
        }}
        title={muted ? "Restore level" : "Mute OSC B"}
      >
        {muted ? "Muted" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("oscBPos", 0.4);
          setParam("oscBEnv", 0);
          setParam("oscBLfo", 0);
          setParam("oscBDetune", 0);
          setParam("oscBOctave", 0);
          setParam("oscBLevel", 0.5);
          setParam("oscBTable", "saw");
          setParam("oscBInherit", "off");
          setParam("oscBPhaseLock", false);
          setParam("fmAtoB", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset OSC B to twin defaults"
      >
        Reset
      </button>
    </div>
  );
}

function OscBPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.oscB;
  const cEnv = bandShade(FC.sources, 0.48);
  const cLfo = bandShade(FC.sources, 0.64);
  const cDet = bandShade(FC.sources, 0.36);
  const cLvl = bandShade(FC.sources, 0.28);
  const env = useFireCommandStore((s) => s.patch.oscBEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscBLfo);
  const level = useFireCommandStore((s) => s.patch.oscBLevel);
  const pos = useFireCommandStore((s) => s.patch.oscBPos);
  const detune = useFireCommandStore((s) => s.patch.oscBDetune);
  const oct = useFireCommandStore((s) => s.patch.oscBOctave);
  const table = useFireCommandStore((s) => s.patch.oscBTable);
  const state = levelVoiceState(level, { role: "twin", wakeHint: "raise Level or unmute" });
  const mods = modActivityCount(env, lfo, detune);

  return (
    <Section
      title="Oscillator B"
      color={c}
      collapseKey="osc.b"
      chipHosted={chipHosted}
      right={<OscBTableBrowser />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: `${c}40`,
          background: `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`,
          boxShadow: `inset 0 1px 0 ${c}22`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources · Twin of A
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.78) }}>
            Twin Voice
            <span className="ml-2 font-mono text-[11px] font-normal text-white/45">
              {wavetableName(table)} · morph {Math.round(pos * 100)}% · {oct >= 0 ? `+${oct}` : oct}oct
              {Math.abs(detune) > 0.5 ? ` · ${detune > 0 ? "+" : ""}${Math.round(detune)}¢` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OscBQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: state.tech === "muted" ? "rgba(255,255,255,0.35)" : bandShade(FC.sources, 0.88),
              background: state.tech === "muted" ? "rgba(0,0,0,0.45)" : `${c}36`,
              border: `1px solid ${state.tech === "muted" ? "rgba(255,255,255,0.12)" : `${c}70`}`,
              boxShadow: state.tech === "active" ? `0 0 14px ${c}50` : undefined,
            }}
            title={state.detail}
          >
            {state.tech === "active" ? (mods > 0 ? `${mods} MOD` : "ACTIVE") : state.pill}
          </div>
        </div>
      </div>

      <OscBWaveThumbs />
      <OscBStageViz />
      <OscBFrameScrub />
      <OscBDetunePresets />

      <div className="mb-2 flex items-center justify-center gap-4">
        <OscBModMeter label="Env→WT" value={env} color={cEnv} />
        <OscBOctaveStrip />
        <OscBModMeter label="LFO→WT" value={lfo} color={cLfo} />
      </div>

      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey="oscBPos" label="Morph" min={0} max={1} format={fmtPct} def={0.4} size={48} color={c} modEnv={env} modLfo={lfo} />
        <FParamKnob paramKey="oscBEnv" label="Env→WT" min={-1} max={1} bipolar format={fmtBi} def={0} size={42} color={cEnv} />
        <FParamKnob paramKey="oscBLfo" label="LFO→WT" min={-1} max={1} bipolar format={fmtBi} def={0} size={42} color={cLfo} />
        <FParamKnob paramKey="oscBDetune" label="Detune" min={-50} max={50} integer bipolar format={fmtCents} def={0} size={42} color={cDet} />
        <FParamKnob paramKey="fmAtoB" label="FM←A" min={0} max={1} format={fmtPct} def={0} size={44} color={bandShade(FC.sources, 0.55)} />
        <FParamKnob paramKey="oscBLevel" label="Level" min={0} max={1} format={fmtPct} def={0.5} size={48} color={cLvl} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Twin of the Signal Path — pull from A, spread the beat, snap frames, carve with Env / LFO.
      </div>
    </Section>
  );
}

// ════════════════════ OSC C — Depth Voice ════════════════════

function OscCTableBrowser() {
  const table = useFireCommandStore((s) => s.patch.oscCTable);
  const setParam = useFireCommandStore((s) => s.setParam);
  const idx = Math.max(0, WAVETABLES.findIndex((w) => w.id === table));
  const go = (dir: -1 | 1) => {
    const next = WAVETABLES[(idx + dir + WAVETABLES.length) % WAVETABLES.length]!;
    setParam("oscCTable", next.id);
  };
  const c = FC.oscC;
  const cHot = bandShade(FC.sources, 0.78);
  return (
    <div className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={() => go(-1)}
        className="h-7 w-7 shrink-0 rounded-md border text-[11px] font-bold transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: cHot, background: `${c}18` }}
        title="Previous wavetable"
      >
        ‹
      </button>
      <select
        value={table}
        onChange={(e) => setParam("oscCTable", e.target.value)}
        className="min-w-0 flex-1 truncate rounded-lg border px-2 py-1 text-[11px] font-semibold focus:outline-none cursor-pointer"
        style={{
          borderColor: `${c}55`,
          background: `linear-gradient(180deg, ${c}28, rgba(0,0,0,0.55))`,
          color: cHot,
        }}
        title={wavetableName(table)}
      >
        {WAVETABLES.map((w) => (
          <option key={w.id} value={w.id} className="bg-ink text-white">
            {w.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => go(1)}
        className="h-7 w-7 shrink-0 rounded-md border text-[11px] font-bold transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: cHot, background: `${c}18` }}
        title="Next wavetable"
      >
        ›
      </button>
    </div>
  );
}

function OscCModMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const abs = Math.abs(value);
  const pos = value >= 0;
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.25rem]" title={`${label} ${fmtBi(value)}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
          style={{
            width: `${abs * 50}%`,
            left: pos ? "50%" : `${50 - abs * 50}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: abs > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: abs > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {pos ? "+" : "−"}{Math.round(abs * 100)}
      </div>
    </div>
  );
}

function OscCOctaveStrip() {
  const oct = useFireCommandStore((s) => s.patch.oscCOctave);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscC;
  const cHot = bandShade(FC.sources, 0.8);
  return (
    <div className="flex items-stretch rounded-lg border p-0.5" style={{ borderColor: `${c}44`, background: "rgba(0,0,0,0.35)" }}>
      {([-2, -1, 0, 1, 2] as const).map((n) => {
        const on = oct === n;
        const depth = n <= -1;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setParam("oscCOctave", n)}
            className="min-w-[1.75rem] rounded-md px-1.5 py-1 text-[10px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    background: `linear-gradient(180deg, ${cHot}55, ${c}40)`,
                    color: "#ffe8f0",
                    boxShadow: `0 0 14px ${c}66`,
                  }
                : { color: depth ? `${c}99` : "rgba(255,255,255,0.4)" }
            }
            aria-pressed={on}
            title={n <= -1 ? `Depth ${n} oct` : `Octave ${n}`}
          >
            {n > 0 ? `+${n}` : n === 0 ? "0" : String(n)}
          </button>
        );
      })}
    </div>
  );
}

function OscCWaveThumbs() {
  const table = useFireCommandStore((s) => s.patch.oscCTable);
  const pos = useFireCommandStore((s) => s.patch.oscCPos);
  const oct = useFireCommandStore((s) => s.patch.oscCOctave);
  const setParam = useFireCommandStore((s) => s.setParam);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const c = FC.oscC;
  const cFloor = bandShade(FC.sources, 0.35);

  useEffect(() => {
    const frame = Math.round(pos * (FRAME_COUNT - 1));
    const sink = Math.max(0, -oct) * 1.5;
    WAVETABLES.forEach((w, wi) => {
      const canvas = canvasRefs.current[wi];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const samples = frameSamples(w.id, frame / Math.max(1, FRAME_COUNT - 1), 48);
      ctx.clearRect(0, 0, W, H);
      const active = w.id === table;
      ctx.fillStyle = active ? `${c}22` : "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      // Floor fill under wave
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * (W - 2) + 1;
        const y = H * 0.42 + sink - samples[i]! * H * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(W - 1, H - 1);
      ctx.lineTo(1, H - 1);
      ctx.closePath();
      ctx.fillStyle = active ? `${cFloor}33` : "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * (W - 2) + 1;
        const y = H * 0.42 + sink - samples[i]! * H * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = active ? c : "rgba(255,255,255,0.35)";
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.stroke();
    });
  }, [table, pos, oct, c, cFloor]);

  return (
    <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
      {WAVETABLES.map((w, wi) => {
        const on = w.id === table;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setParam("oscCTable", w.id)}
            className="shrink-0 rounded-md border p-0.5 transition"
            style={{
              borderColor: on ? `${c}99` : "rgba(255,255,255,0.1)",
              boxShadow: on ? `0 0 12px ${c}44` : undefined,
              background: on ? `${c}14` : "transparent",
            }}
            title={w.name}
          >
            <canvas
              ref={(el) => { canvasRefs.current[wi] = el; }}
              width={56}
              height={28}
              className="block rounded-sm"
            />
          </button>
        );
      })}
    </div>
  );
}

function OscCFrameScrub() {
  const pos = useFireCommandStore((s) => s.patch.oscCPos);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscC;
  const frame = Math.round(pos * (FRAME_COUNT - 1));
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="shrink-0 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Frame
      </span>
      <div className="flex flex-1 items-center gap-0.5">
        {Array.from({ length: FRAME_COUNT }, (_, i) => {
          const on = i === frame;
          const near = Math.abs(i - frame) === 1;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setParam("oscCPos", FRAME_COUNT > 1 ? i / (FRAME_COUNT - 1) : 0)}
              className="h-6 flex-1 rounded-md border text-[9px] font-bold tabular-nums transition"
              style={
                on
                  ? {
                      borderColor: `${c}aa`,
                      background: `linear-gradient(180deg, ${c}55, ${c}28)`,
                      color: "#ffe8f0",
                      boxShadow: `0 0 12px ${c}55`,
                    }
                  : {
                      borderColor: near ? `${c}44` : "rgba(255,255,255,0.08)",
                      background: near ? `${c}12` : "rgba(0,0,0,0.35)",
                      color: near ? `${c}cc` : "rgba(255,255,255,0.35)",
                    }
              }
              aria-pressed={on}
              title={`Frame ${i + 1}/${FRAME_COUNT}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OscCDepthPresets() {
  const oct = useFireCommandStore((s) => s.patch.oscCOctave);
  const level = useFireCommandStore((s) => s.patch.oscCLevel);
  const detune = useFireCommandStore((s) => s.patch.oscCDetune);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.oscC;
  const presets = [
    { id: "sub2", label: "Sub-oct", oct: -2 as const, lvl: 0.45, detune: 0, title: "Octave below — low-mid body (not Sub mono)" },
    { id: "sub1", label: "Depth −1", oct: -1 as const, lvl: 0.4, detune: 0, title: "Primary depth register" },
    { id: "root", label: "Root", oct: 0 as const, lvl: 0.35, detune: 0, title: "Same register as Prime — body reinforcement" },
    { id: "fifth", label: "5th body", oct: 0 as const, lvl: 0.32, detune: 7, title: "Approximate fifth body (fine cents)" },
  ] as const;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[9px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Body role
      </span>
      {presets.map((p) => {
        const on =
          oct === p.oct &&
          level >= 0.02 &&
          (p.detune === 0 ? Math.abs(detune) < 0.5 : Math.abs(detune) === p.detune);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("oscCOctave", p.oct);
              setParam("oscCDetune", p.detune);
              if (level < 0.02) setParam("oscCLevel", p.lvl);
            }}
            className="rounded-md border px-2 py-0.5 text-[10px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.88),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.title}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function OscCQuickActions() {
  const level = useFireCommandStore((s) => s.patch.oscCLevel);
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef(0.4);
  const c = FC.oscC;
  const dormant = level < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (dormant) {
            setParam("oscCLevel", savedRef.current > 0.02 ? savedRef.current : 0.4);
            setParam("oscCOctave", -1);
          } else {
            savedRef.current = level;
            setParam("oscCLevel", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: dormant ? `${c}88` : `${c}66`,
          color: dormant ? bandShade(FC.sources, 0.9) : bandShade(FC.sources, 0.75),
          background: dormant ? `${c}40` : `${c}22`,
          boxShadow: dormant ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={dormant ? "Wake Depth Voice (−1 oct @ 40%)" : "Sleep / mute OSC C"}
      >
        {dormant ? "Wake" : "Sleep"}
      </button>
      <button
        type="button"
        onClick={() => {
          const patch = useFireCommandStore.getState().patch;
          setParam("oscCTable", patch.oscATable);
          setParam("oscCPos", patch.oscAPos);
          setParam("oscCEnv", patch.oscAEnv);
          setParam("oscCLfo", patch.oscALfo);
        }}
        className="rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Copy table, morph, Env, LFO from OSC A (keeps C octave)"
      >
        ← A
      </button>
      <button
        type="button"
        onClick={() => {
          const patch = useFireCommandStore.getState().patch;
          setParam("oscCTable", patch.oscBTable);
          setParam("oscCPos", patch.oscBPos);
          setParam("oscCEnv", patch.oscBEnv);
          setParam("oscCLfo", patch.oscBLfo);
        }}
        className="rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Copy table, morph, Env, LFO from OSC B (keeps C octave)"
      >
        ← B
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("oscCTable", "harmonic");
          setParam("oscCPos", 0.4);
          setParam("oscCEnv", 0);
          setParam("oscCLfo", 0);
          setParam("oscCDetune", 0);
          setParam("oscCOctave", -1);
          setParam("oscCLevel", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset OSC C to depth defaults (dormant)"
      >
        Reset
      </button>
    </div>
  );
}

function OscCPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.oscC;
  const cEnv = bandShade(FC.sources, 0.5);
  const cLfo = bandShade(FC.sources, 0.7);
  const cDet = bandShade(FC.sources, 0.38);
  const cLvl = bandShade(FC.sources, 0.32);
  const env = useFireCommandStore((s) => s.patch.oscCEnv);
  const lfo = useFireCommandStore((s) => s.patch.oscCLfo);
  const level = useFireCommandStore((s) => s.patch.oscCLevel);
  const pos = useFireCommandStore((s) => s.patch.oscCPos);
  const detune = useFireCommandStore((s) => s.patch.oscCDetune);
  const oct = useFireCommandStore((s) => s.patch.oscCOctave);
  const table = useFireCommandStore((s) => s.patch.oscCTable);
  const dormant = level < 0.02;
  const state = levelVoiceState(level, { role: "depth", wakeHint: "press Wake or raise Level" });
  const mods = modActivityCount(env, lfo, detune);

  return (
    <Section
      title="Oscillator C"
      color={c}
      collapseKey="osc.c"
      chipHosted={chipHosted}
      right={<OscCTableBrowser />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: dormant ? `${c}28` : `${c}40`,
          background: dormant
            ? `linear-gradient(180deg, rgba(0,0,0,0.45), ${c}10)`
            : `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`,
          boxShadow: dormant ? undefined : `inset 0 1px 0 ${c}22`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources · Body ≠ Sub
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.82) }}>
            Depth Voice
            <span className="ml-2 font-mono text-[11px] font-normal text-white/45">
              {wavetableName(table)} · morph {Math.round(pos * 100)}% · {oct >= 0 ? `+${oct}` : oct}oct
              {Math.abs(detune) > 0.5 ? ` · ${detune > 0 ? "+" : ""}${Math.round(detune)}¢` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OscCQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: dormant ? "rgba(255,255,255,0.35)" : bandShade(FC.sources, 0.9),
              background: dormant ? "rgba(0,0,0,0.5)" : `${c}36`,
              border: `1px solid ${dormant ? "rgba(255,255,255,0.12)" : `${c}70`}`,
              boxShadow: !dormant ? `0 0 14px ${c}50` : undefined,
            }}
            title={state.detail}
          >
            {dormant ? state.pill : mods > 0 ? `${mods} MOD` : "ACTIVE"}
          </div>
        </div>
      </div>

      <OscCWaveThumbs />
      <OscCStageViz />
      <OscCFrameScrub />
      <OscCDepthPresets />

      <div className="mb-2 flex items-center justify-center gap-4">
        <OscCModMeter label="Env→WT" value={env} color={cEnv} />
        <OscCOctaveStrip />
        <OscCModMeter label="LFO→WT" value={lfo} color={cLfo} />
      </div>

      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey="oscCPos" label="Morph" min={0} max={1} format={fmtPct} def={0.4} size={50} color={c} modEnv={env} modLfo={lfo} />
        <FParamKnob paramKey="oscCEnv" label="Env→WT" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={cEnv} />
        <FParamKnob paramKey="oscCLfo" label="LFO→WT" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={cLfo} />
        <FParamKnob paramKey="oscCDetune" label="Body Sprd" min={-50} max={50} integer bipolar format={fmtCents} def={0} size={44} color={cDet} />
        <FParamKnob paramKey="oscCLevel" label="Level" min={0} max={1} format={fmtPct} def={0} size={50} color={cLvl} />
      </div>
      <div className="mt-1.5 text-center text-[12px] leading-snug" style={{ color: `${c}aa` }}>
        Pitched body & low-mid harmonics — Sub stays the protected mono foundation.
      </div>
    </Section>
  );
}

// ════════════════════ WARP — Harmonic Forge ════════════════════

function WarpModMeter({ label, value, bipolar, color }: { label: string; value: number; bipolar?: boolean; color: string }) {
  const abs = Math.abs(value);
  const pos = value >= 0;
  const width = bipolar ? abs * 50 : abs * 100;
  const left = bipolar ? (pos ? "50%" : `${50 - abs * 50}%`) : "0%";
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.5rem]" title={`${label} ${bipolar ? fmtBi(value) : fmtPct(value)}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
          style={{
            width: `${width}%`,
            left,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: abs > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
        {bipolar && <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: abs > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {bipolar ? `${pos ? "+" : "−"}${Math.round(abs * 100)}` : `${Math.round(abs * 100)}%`}
      </div>
    </div>
  );
}

const WARP_PRESETS = [
  { id: "neutral", label: "Neutral", stretch: 0, tilt: 0, comb: 0 },
  { id: "bell", label: "Bell", stretch: 0.55, tilt: 0.1, comb: 0.12 },
  { id: "hollow", label: "Hollow", stretch: 0.05, tilt: 0.72, comb: 0 },
  { id: "reed", label: "Reed", stretch: -0.1, tilt: -0.65, comb: 0.05 },
  { id: "squash", label: "Squash", stretch: -0.6, tilt: -0.15, comb: 0 },
  { id: "metal", label: "Metal", stretch: 0.25, tilt: 0.2, comb: 0.7 },
  { id: "piano", label: "Piano", stretch: 0.4, tilt: -0.2, comb: 0.18 },
] as const;

function WarpCharacterStrip() {
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.warp;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Character
      </span>
      {WARP_PRESETS.map((p) => {
        const on =
          Math.abs(stretch - p.stretch) < 0.04 &&
          Math.abs(tilt - p.tilt) < 0.04 &&
          Math.abs(comb - p.comb) < 0.04;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("warpStretch", p.stretch);
              setParam("warpTilt", p.tilt);
              setParam("warpComb", p.comb);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label}: ST ${p.stretch} · TL ${p.tilt} · CB ${p.comb}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function WarpQuickActions() {
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ stretch: 0.35, tilt: -0.15, comb: 0.2 });
  const c = FC.warp;
  const idle = Math.abs(stretch) < 0.01 && Math.abs(tilt) < 0.01 && comb < 0.01;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("warpStretch", savedRef.current.stretch);
            setParam("warpTilt", savedRef.current.tilt);
            setParam("warpComb", savedRef.current.comb);
          } else {
            savedRef.current = { stretch, tilt, comb };
            setParam("warpStretch", 0);
            setParam("warpTilt", 0);
            setParam("warpComb", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.sources, 0.9) : bandShade(FC.sources, 0.75),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore last forge" : "Bypass warp (neutral)"}
      >
        {idle ? "Forge" : "Bypass"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("warpStretch", -stretch);
          setParam("warpTilt", -tilt);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Invert Stretch & Tilt polarity"
      >
        Flip
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("warpStretch", 0);
          setParam("warpTilt", 0);
          setParam("warpComb", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset to neutral"
      >
        Reset
      </button>
    </div>
  );
}

function WarpPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.warp;
  const cSt = bandShade(FC.sources, 0.55);
  const cTl = bandShade(FC.sources, 0.72);
  const cCb = bandShade(FC.sources, 0.42);
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const amount = useFireCommandStore((s) => s.patch.warpAmount) ?? 1;
  const active = Math.abs(amount) > 0.01 && (
    Math.abs(stretch) > 0.01 || Math.abs(tilt) > 0.01 || comb > 0.01
  );
  const state = forgeState(active);

  return (
    <Section
      title="Spectral Warp"
      color={c}
      collapseKey="fire.sec.warp"
      chipHosted={chipHosted}
      right={
        <span className="text-[10px] normal-case tracking-normal" style={{ color: `${c}99` }}>
          reshapes A · B · C harmonics
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: active ? `${c}40` : `${c}28`,
          background: active
            ? `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: active ? `inset 0 1px 0 ${c}22` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.85) }}>
            Harmonic Forge
            <span className="ml-2 font-mono text-[11px] font-normal text-white/45">
              {active
                ? `ST ${stretch > 0 ? "+" : ""}${Math.round(stretch * 100)} · TL ${tilt > 0 ? "+" : ""}${Math.round(tilt * 100)} · CB ${Math.round(comb * 100)}`
                : "neutral · pass-through"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WarpQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: active ? bandShade(FC.sources, 0.92) : "rgba(255,255,255,0.35)",
              background: active ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${active ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: active ? `0 0 14px ${c}50` : undefined,
            }}
            title={state.detail}
          >
            {state.pill}
          </div>
        </div>
      </div>

      <WarpStageViz />
      <WarpCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-5">
        <WarpModMeter label="Stretch" value={stretch} bipolar color={cSt} />
        <WarpModMeter label="Tilt" value={tilt} bipolar color={cTl} />
        <WarpModMeter label="Comb" value={comb} color={cCb} />
      </div>

      <div className="flex items-center justify-evenly gap-2">
        <FParamKnob paramKey="warpAmount" label="Forge" min={-1} max={1} bipolar format={fmtBi} def={1} size={56} color={c} />
        <FParamKnob paramKey="warpStretch" label="Stretch" min={-1} max={1} bipolar format={fmtBi} def={0} size={48} color={cSt} />
        <FParamKnob paramKey="warpTilt" label="Tilt" min={-1} max={1} bipolar format={fmtBi} def={0} size={48} color={cTl} />
        <FParamKnob paramKey="warpComb" label="Comb" min={0} max={1} format={fmtPct} def={0} size={48} color={cCb} />
      </div>
      <div className="mt-1.5 text-center text-[12px] leading-snug" style={{ color: `${c}aa` }}>
        Forge amount scales Stretch/Tilt/Comb (− = inverse). Dim IN · bright OUT.
      </div>
    </Section>
  );
}

// ════════════════════ CHIP — Acid Circuit ════════════════════

function ChipPulsePresets() {
  const duty = useFireCommandStore((s) => s.patch.pulseDuty) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chip;
  const presets = [
    { label: "12%", v: 0.125 },
    { label: "25%", v: 0.25 },
    { label: "50%", v: 0.5 },
    { label: "75%", v: 0.75 },
  ] as const;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        PWM
      </span>
      {presets.map((p) => {
        const on = Math.abs(duty - p.v) < 0.03;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("pulseDuty", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`Pulse width ${p.label}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ChipNoiseModes() {
  const noise = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chip;
  const modes: { id: ChipNoiseMode; label: string; hint: string }[] = [
    { id: "white", label: "White", hint: "Analog hiss" },
    { id: "nes", label: "Hold", hint: "NES LFSR hold" },
    { id: "gb", label: "Soft", hint: "Softer stepped noise" },
    { id: "periodic", label: "Per", hint: "Metallic short loop" },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Noise
      </span>
      {modes.map((m) => {
        const on = noise === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setParam("chipNoise", m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={m.hint}
            aria-pressed={on}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function ChipVoiceStrip() {
  const voices = useFireCommandStore((s) => s.patch.chipVoiceLimit) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chip;
  return (
    <div className="mb-2 flex items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Poly
      </span>
      {[0, 1, 2, 3, 4, 6, 8].map((n) => {
        const on = Math.round(voices) === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setParam("chipVoiceLimit", n)}
            className="min-w-[1.6rem] rounded-md border px-1.5 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
            }
            title={n === 0 ? "Voice limit off" : `Cap at ${n} voices`}
          >
            {n === 0 ? "∞" : n}
          </button>
        );
      })}
    </div>
  );
}

function ChipQuickActions() {
  const sync = useFireCommandStore((s) => s.patch.hardSync) ?? false;
  const slide = useFireCommandStore((s) => s.patch.slideOn) ?? false;
  const accent = useFireCommandStore((s) => s.patch.accentAmount) ?? 0;
  const mix = useFireCommandStore((s) => s.patch.chipAcidMix) ?? 0.35;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chip;
  const acidOn = mix > 0.6 && sync && slide && accent > 0.25;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          setParam("chipAcidMix", 0.08);
          setParam("hardSync", false);
          setParam("slideOn", false);
          setParam("accentAmount", 0);
          setParam("chipVoiceLimit", 4);
          setParam("pulseDuty", 0.25);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: mix < 0.35 ? `${c}99` : `${c}44`,
          color: mix < 0.35 ? bandShade(FC.sources, 0.92) : `${c}bb`,
          background: mix < 0.35 ? `${c}40` : `${c}14`,
        }}
        title="Chip personality — pulse / grit / voice limits"
      >
        Chip
      </button>
      <button
        type="button"
        onClick={() => {
          if (acidOn) {
            setParam("chipAcidMix", 0.35);
            setParam("hardSync", false);
            setParam("slideOn", false);
            setParam("accentAmount", 0);
          } else {
            setParam("chipAcidMix", 0.92);
            setParam("hardSync", true);
            setParam("slideOn", true);
            setParam("accentAmount", 0.55);
            setParam("pulseDuty", 0.25);
            setParam("chipVoiceLimit", 1);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: acidOn ? `${c}99` : `${c}55`,
          color: acidOn ? bandShade(FC.sources, 0.92) : `${c}bb`,
          background: acidOn ? `${c}40` : `${c}18`,
          boxShadow: acidOn ? `0 0 14px ${c}55` : undefined,
        }}
        title={acidOn ? "Ease off Acid" : "Acid personality: Sync + Slide + Accent + mono-ish"}
      >
        {acidOn ? "Acid On" : "Acid"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("pulseDuty", 0.5);
          setParam("hardSync", false);
          setParam("slideOn", false);
          setParam("accentAmount", 0);
          setParam("chipVoiceLimit", 0);
          setParam("chipNoise", "white");
          setParam("chipAcidMix", 0.35);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset chip to defaults"
      >
        Reset
      </button>
    </div>
  );
}

function ChipPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.chip;
  const cPulse = bandShade(FC.sources, 0.58);
  const cVoices = bandShade(FC.sources, 0.7);
  const cAcc = bandShade(FC.sources, 0.78);
  const duty = useFireCommandStore((s) => s.patch.pulseDuty) ?? 0.5;
  const sync = useFireCommandStore((s) => s.patch.hardSync) ?? false;
  const slide = useFireCommandStore((s) => s.patch.slideOn) ?? false;
  const accent = useFireCommandStore((s) => s.patch.accentAmount) ?? 0;
  const voices = useFireCommandStore((s) => s.patch.chipVoiceLimit) ?? 0;
  const noise = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const acidMix = useFireCommandStore((s) => s.patch.chipAcidMix) ?? 0.35;
  const active =
    Math.abs(duty - 0.5) > 0.02 || sync || slide || accent > 0.02 || voices > 0 || noise !== "white";
  const persona = acidMix < 0.35 ? "CHIP" : acidMix > 0.65 ? "ACID" : "BLEND";

  return (
    <Section
      title="Chip · Acid"
      color={c}
      collapseKey="chip"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <FSeg<ChipNoiseMode>
          paramKey="chipNoise"
          color={c}
          options={[
            { id: "white", label: "Wht" },
            { id: "nes", label: "Hold" },
            { id: "gb", label: "Soft" },
            { id: "periodic", label: "Per" },
          ]}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: active ? `${c}40` : `${c}28`,
          background: active
            ? `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: active ? `inset 0 1px 0 ${c}22` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources · {persona}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.88) }}>
            Acid Circuit
            <span className="ml-2 font-mono text-[11px] font-normal text-white/45">
              PWM {Math.round(duty * 100)}% · {noise}
              {sync ? " · sync" : ""}
              {slide ? " · slide" : ""}
              {voices > 0 ? ` · V${Math.round(voices)}` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChipQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: active ? bandShade(FC.sources, 0.92) : "rgba(255,255,255,0.35)",
              background: active ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${active ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: active ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {persona}
          </div>
        </div>
      </div>

      <ChipStageViz />
      <ChipPulsePresets />
      <ChipNoiseModes />
      <ChipVoiceStrip />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        <BoolToggle paramKey="hardSync" label="Hard Sync" color={c} />
        <BoolToggle paramKey="slideOn" label="Slide" color={c} />
      </div>

      <div className="flex items-center justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="chipAcidMix" label="Chip↔Acid" min={0} max={1} format={fmtPct} def={0.35} size={52} color={c} />
        <FParamKnob paramKey="pulseDuty" label="Pulse" min={0.05} max={0.95} format={fmtPct} def={0.5} size={46} color={cPulse} />
        <FParamKnob paramKey="chipVoiceLimit" label="Voices" min={0} max={8} integer format={(v) => (v < 0.5 ? "Off" : fmtInt(v))} def={0} size={44} color={cVoices} />
        <FParamKnob paramKey="accentAmount" label="Accent" min={0} max={1} format={fmtPct} def={0} size={46} color={cAcc} />
      </div>
      <div className="mt-1.5 text-center text-[12px] leading-snug" style={{ color: `${c}aa` }}>
        Blend Chip (clocked grit) ↔ Acid (slide / accent / sync). Noise register is grit, not Grain Storm.
      </div>
    </Section>
  );
}

// ════════════════════ NOISE — Grain Storm ════════════════════

function NoiseModMeter({ label, value, bipolar, color }: { label: string; value: number; bipolar?: boolean; color: string }) {
  const abs = Math.abs(value);
  const pos = value >= 0;
  const width = bipolar ? abs * 50 : abs * 100;
  const left = bipolar ? (pos ? "50%" : `${50 - abs * 50}%`) : "0%";
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.5rem]" title={`${label} ${bipolar ? fmtBi(value) : fmtPct(value)}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
          style={{
            width: `${width}%`,
            left,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: abs > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
        {bipolar && <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: abs > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {bipolar ? `${pos ? "+" : "−"}${Math.round(abs * 100)}` : `${Math.round(abs * 100)}%`}
      </div>
    </div>
  );
}

const NOISE_COLOR_PRESETS = [
  { id: "rumble", label: "Rumble", color: -0.75, level: 0.35 },
  { id: "dark", label: "Dark", color: -0.4, level: 0.28 },
  { id: "flat", label: "Flat", color: 0, level: 0.25 },
  { id: "air", label: "Air", color: 0.45, level: 0.3 },
  { id: "hiss", label: "Hiss", color: 0.8, level: 0.22 },
] as const;

function NoiseCharacterStrip() {
  const level = useFireCommandStore((s) => s.patch.noiseLevel) ?? 0;
  const color = useFireCommandStore((s) => s.patch.noiseColor) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.noise;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Bed
      </span>
      {NOISE_COLOR_PRESETS.map((p) => {
        const on = Math.abs(color - p.color) < 0.08 && level >= 0.02 && Math.abs(level - p.level) < 0.15;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("noiseColor", p.color);
              if (level < 0.02) setParam("noiseLevel", p.level);
              else setParam("noiseLevel", Math.max(level, p.level * 0.6));
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.92),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label}: color ${p.color}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function NoiseGritModes() {
  const noise = useFireCommandStore((s) => s.patch.chipNoise) ?? "white";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.noise;
  const modes: { id: ChipNoiseMode; label: string; hint: string }[] = [
    { id: "white", label: "White", hint: "Fine analog hiss" },
    { id: "nes", label: "Hold", hint: "NES LFSR grit" },
    { id: "gb", label: "Soft", hint: "Softer stepped noise" },
    { id: "periodic", label: "Per", hint: "Metallic short loop" },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Grit
      </span>
      {modes.map((m) => {
        const on = noise === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setParam("chipNoise", m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.92),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${m.hint} (shared with Chip)`}
            aria-pressed={on}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function NoiseQuickActions() {
  const level = useFireCommandStore((s) => s.patch.noiseLevel) ?? 0;
  const color = useFireCommandStore((s) => s.patch.noiseColor) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ level: 0.28, color: 0 });
  const c = FC.noise;
  const silent = level < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (silent) {
            setParam("noiseLevel", savedRef.current.level > 0.02 ? savedRef.current.level : 0.28);
            setParam("noiseColor", savedRef.current.color);
          } else {
            savedRef.current = { level, color };
            setParam("noiseLevel", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: silent ? `${c}88` : `${c}66`,
          color: silent ? bandShade(FC.sources, 0.92) : bandShade(FC.sources, 0.78),
          background: silent ? `${c}40` : `${c}22`,
          boxShadow: silent ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={silent ? "Raise noise bed" : "Silence noise bed"}
      >
        {silent ? "Storm" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => setParam("noiseColor", -color)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Flip color tilt (dark ↔ bright)"
      >
        Flip
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("noiseLevel", 0);
          setParam("noiseColor", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset noise bed"
      >
        Reset
      </button>
    </div>
  );
}

function NoisePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.noise;
  const cLvl = bandShade(FC.sources, 0.55);
  const cCol = bandShade(FC.sources, 0.75);
  const cDens = bandShade(FC.sources, 0.68);
  const level = useFireCommandStore((s) => s.patch.noiseLevel) ?? 0;
  const color = useFireCommandStore((s) => s.patch.noiseColor) ?? 0;
  const stormMode = useFireCommandStore((s) => s.patch.noiseMode) ?? "bed";
  const silent = level < 0.02;
  const tiltLabel = color < -0.1 ? "Dark LP" : color > 0.1 ? "Bright HP" : "Flat";
  const setParam = useFireCommandStore((s) => s.setParam);
  const modes: { id: NoiseMode; label: string; title: string }[] = [
    { id: "bed", label: "Bed", title: "Continuous noise layer" },
    { id: "burst", label: "Burst", title: "Envelope-triggered grains" },
    { id: "storm", label: "Storm", title: "Granular clustered events" },
  ];

  return (
    <Section
      title="Noise"
      color={c}
      collapseKey="noise"
      chipHosted={chipHosted}
      defaultCollapsed
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: silent ? `${c}28` : `${c}40`,
          background: silent
            ? `linear-gradient(180deg, rgba(0,0,0,0.45), ${c}0c)`
            : `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`,
          boxShadow: silent ? undefined : `inset 0 1px 0 ${c}22`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources · {stormMode.toUpperCase()}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.88) }}>
            Grain Storm
            <span className="ml-2 font-mono text-[11px] font-normal text-white/45">
              {silent ? "muted" : `${tiltLabel} · ${Math.round(level * 100)}%`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NoiseQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: silent ? "rgba(255,255,255,0.35)" : bandShade(FC.sources, 0.92),
              background: silent ? "rgba(0,0,0,0.45)" : `${c}36`,
              border: `1px solid ${silent ? "rgba(255,255,255,0.12)" : `${c}70`}`,
              boxShadow: !silent ? `0 0 14px ${c}50` : undefined,
            }}
            title={levelVoiceState(level, { role: "storm" }).detail}
          >
            {silent ? "MUTED" : stormMode.toUpperCase()}
          </div>
        </div>
      </div>

      <NoiseStageViz />

      <div className="mb-2 flex items-center justify-center gap-1">
        <span className="mr-1 text-[9px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
          Mode
        </span>
        {modes.map((m) => {
          const on = stormMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setParam("noiseMode", m.id)}
              className="rounded-md border px-2.5 py-0.5 text-[10px] font-bold transition"
              style={
                on
                  ? {
                      borderColor: `${c}99`,
                      background: `${c}33`,
                      color: bandShade(FC.sources, 0.92),
                      boxShadow: `0 0 10px ${c}44`,
                    }
                  : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
              }
              title={m.title}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <NoiseCharacterStrip />
      <NoiseGritModes />

      <div className="mb-2 flex items-center justify-center gap-5">
        <NoiseModMeter label="Level" value={level} color={cLvl} />
        <NoiseModMeter label="Color" value={color} bipolar color={cCol} />
      </div>

      <div className="flex items-center justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="noiseLevel" label="Level" min={0} max={1} format={fmtPct} def={0} size={50} color={cLvl} />
        <FParamKnob paramKey="noiseColor" label="Color" min={-1} max={1} bipolar format={fmtBi} def={0} size={48} color={cCol} />
        <FParamKnob paramKey="noiseDensity" label="Density" min={0} max={1} format={fmtPct} def={0.45} size={48} color={cDens} />
        <FParamKnob paramKey="noiseGrain" label="Grain" min={0} max={1} format={fmtPct} def={0.35} size={48} color={bandShade(FC.sources, 0.8)} />
      </div>
      <div className="mt-1.5 text-center text-[12px] leading-snug" style={{ color: `${c}aa` }}>
        Drag the field: Color↔ · Level↕. Bed / Burst / Storm — grit register stays on Chip.
      </div>
    </Section>
  );
}

// ════════════════════ SUB — Tectonic ════════════════════

function SubWavePicker() {
  const wave = useFireCommandStore((s) => s.patch.subWave) ?? "sine";
  const setParam = useFireCommandStore((s) => s.setParam);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const c = FC.sub;
  const waves: { id: SubWave; label: string }[] = [
    { id: "sine", label: "Sin" },
    { id: "triangle", label: "Tri" },
    { id: "square", label: "Sqr" },
    { id: "sawtooth", label: "Saw" },
  ];

  useEffect(() => {
    waves.forEach((w, wi) => {
      const canvas = canvasRefs.current[wi];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const on = w.id === wave;
      ctx.fillStyle = on ? `${c}22` : "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      ctx.beginPath();
      for (let i = 0; i < 48; i++) {
        const u = (i / 47) * Math.PI * 2;
        let v = 0;
        if (w.id === "sine") v = Math.sin(u);
        else if (w.id === "triangle") v = (2 / Math.PI) * Math.asin(Math.sin(u));
        else if (w.id === "square") v = Math.sin(u) > 0 ? 1 : -1;
        else v = 2 * ((u / (Math.PI * 2)) % 1) - 1;
        const x = (i / 47) * (W - 2) + 1;
        const y = H * 0.5 - v * H * 0.35;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = on ? c : "rgba(255,255,255,0.35)";
      ctx.lineWidth = on ? 1.7 : 1;
      ctx.stroke();
    });
  }, [wave, c]);

  return (
    <div className="mb-2 flex gap-1 justify-center">
      {waves.map((w, wi) => {
        const on = w.id === wave;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setParam("subWave", w.id)}
            className="shrink-0 rounded-md border p-0.5 transition"
            style={{
              borderColor: on ? `${c}99` : "rgba(255,255,255,0.1)",
              boxShadow: on ? `0 0 12px ${c}44` : undefined,
              background: on ? `${c}14` : "transparent",
            }}
            title={w.label}
            aria-pressed={on}
          >
            <canvas
              ref={(el) => { canvasRefs.current[wi] = el; }}
              width={56}
              height={28}
              className="block rounded-sm"
            />
            <div className="text-center text-[8px] font-bold mt-0.5" style={{ color: on ? c : "rgba(255,255,255,0.4)" }}>
              {w.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SubOctaveStrip() {
  const oct = useFireCommandStore((s) => s.patch.subOctave ?? -1);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.sub;
  const cHot = bandShade(FC.sources, 0.88);
  return (
    <div className="mb-2 flex items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Oct
      </span>
      {([-2, -1, 0] as const).map((n) => {
        const on = oct === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setParam("subOctave", n)}
            className="min-w-[2.5rem] rounded-md border px-2 py-1 text-[10px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${c}aa`,
                    background: `linear-gradient(180deg, ${cHot}55, ${c}40)`,
                    color: "#fff5f0",
                    boxShadow: `0 0 14px ${c}66`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
            }
            aria-pressed={on}
            title={`Sub octave ${n}`}
          >
            {n === 0 ? "0" : String(n)}
          </button>
        );
      })}
    </div>
  );
}

const SUB_PRESETS = [
  { id: "sine-floor", label: "Sine −1", wave: "sine" as SubWave, oct: -1 as const, level: 0.4 },
  { id: "sine-deep", label: "Sine −2", wave: "sine" as SubWave, oct: -2 as const, level: 0.45 },
  { id: "sqr-punch", label: "Sqr Punch", wave: "square" as SubWave, oct: -1 as const, level: 0.35 },
  { id: "saw-growl", label: "Saw Growl", wave: "sawtooth" as SubWave, oct: -2 as const, level: 0.38 },
  { id: "tri-warm", label: "Tri Warm", wave: "triangle" as SubWave, oct: -1 as const, level: 0.42 },
] as const;

function SubCharacterStrip() {
  const wave = useFireCommandStore((s) => s.patch.subWave) ?? "sine";
  const oct = useFireCommandStore((s) => s.patch.subOctave ?? -1);
  const level = useFireCommandStore((s) => s.patch.subLevel) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.sub;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Foundation
      </span>
      {SUB_PRESETS.map((p) => {
        const on = wave === p.wave && oct === p.oct && level >= 0.02;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("subWave", p.wave);
              setParam("subOctave", p.oct);
              if (level < 0.02) setParam("subLevel", p.level);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.sources, 0.94),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} foundation`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function SubQuickActions() {
  const level = useFireCommandStore((s) => s.patch.subLevel) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef(0.4);
  const c = FC.sub;
  const silent = level < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (silent) {
            setParam("subLevel", savedRef.current > 0.02 ? savedRef.current : 0.4);
            setParam("subOctave", -1);
            setParam("subWave", "sine");
          } else {
            savedRef.current = level;
            setParam("subLevel", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: silent ? `${c}88` : `${c}66`,
          color: silent ? bandShade(FC.sources, 0.94) : bandShade(FC.sources, 0.8),
          background: silent ? `${c}40` : `${c}22`,
          boxShadow: silent ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={silent ? "Wake tectonic foundation (−1 sine)" : "Mute sub"}
      >
        {silent ? "Wake" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("subWave", "sine");
          setParam("subOctave", -1);
          setParam("subLevel", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset sub to defaults"
      >
        Reset
      </button>
    </div>
  );
}

function SubPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.sub;
  const cLvl = bandShade(FC.sources, 0.62);
  const cOct = bandShade(FC.sources, 0.78);
  const level = useFireCommandStore((s) => s.patch.subLevel) ?? 0;
  const oct = useFireCommandStore((s) => s.patch.subOctave ?? -1);
  const wave = useFireCommandStore((s) => s.patch.subWave) ?? "sine";
  const silent = level < 0.02;

  return (
    <Section
      title="Sub"
      color={c}
      collapseKey="sub"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <FSeg<SubWave>
          paramKey="subWave"
          color={c}
          options={[
            { id: "sine", label: "Sin" },
            { id: "triangle", label: "Tri" },
            { id: "square", label: "Sqr" },
            { id: "sawtooth", label: "Saw" },
          ]}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: silent ? `${c}28` : `${c}40`,
          background: silent
            ? `linear-gradient(180deg, rgba(0,0,0,0.45), ${c}0c)`
            : `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`,
          boxShadow: silent ? undefined : `inset 0 1px 0 ${c}22`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Sources
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.sources, 0.94) }}>
            Tectonic
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {silent ? "off" : `${wave} · ${oct}oct · ${Math.round(level * 100)}%`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SubQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: silent ? "rgba(255,255,255,0.35)" : bandShade(FC.sources, 0.95),
              background: silent ? "rgba(0,0,0,0.45)" : `${c}36`,
              border: `1px solid ${silent ? "rgba(255,255,255,0.12)" : `${c}70`}`,
              boxShadow: !silent ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {silent ? "Off" : `${Math.round(level * 100)}%`}
          </div>
        </div>
      </div>

      <SubWavePicker />
      <SubStageViz />
      <SubOctaveStrip />
      <SubCharacterStrip />

      <div className="flex items-center justify-evenly gap-2 flex-wrap">
        <FParamKnob paramKey="subLevel" label="Level" min={0} max={1} format={fmtPct} def={0} size={50} color={cLvl} />
        <FParamKnob paramKey="subOctave" label="Oct" min={-2} max={0} integer format={fmtOct} def={-1} size={48} color={cOct} />
        <FParamKnob paramKey="subTranslate" label="Translate" min={0} max={1} format={fmtPct} def={0} size={50} color={bandShade(FC.sources, 0.72)} />
      </div>
      <div className="mb-1 flex items-center justify-center gap-2">
        <BoolToggle paramKey="subPhaseAlign" label="Align to A" color={c} />
      </div>
      <div className="mt-1.5 text-center text-[12px] leading-snug" style={{ color: `${c}aa` }}>
        Protected mono foundation — Translate adds audible harmonics; Align locks phase wander off.
      </div>
    </Section>
  );
}

// ════════════════════ UNI — Voice Choir ════════════════════

function UniVoiceStrip({ deepMode, onToggleDeep }: { deepMode: boolean; onToggleDeep: () => void }) {
  const unison = useFireCommandStore((s) => s.patch.unison) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.unison;
  const maxVoices = deepMode ? 16 : 7;
  const voiceList = deepMode ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] : [1, 2, 3, 4, 5, 6, 7];
  return (
    <div className="mb-2">
      <div className="mb-1.5 flex items-center justify-center gap-2">
        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
          Voices 1–{maxVoices}
        </span>
        <button
          type="button"
          onClick={onToggleDeep}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
          style={
            deepMode
              ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.tone, 0.9), boxShadow: `0 0 10px ${c}44` }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
          }
          title={deepMode ? "Switch to 1–7 voice rail" : "Expand to 1–16 voices (Deep)"}
        >
          {deepMode ? "Deep 16" : "Deep"}
        </button>
      </div>
      <div className="flex items-center justify-center gap-1 flex-wrap">
        {voiceList.map((n) => {
          const on = Math.round(unison) === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setParam("unison", n)}
              className="min-w-[1.65rem] rounded-md border px-1.5 py-0.5 text-[9px] font-bold tabular-nums transition"
              style={
                on
                  ? {
                      borderColor: `${c}99`,
                      background: `${c}33`,
                      color: bandShade(FC.tone, 0.9),
                      boxShadow: `0 0 10px ${c}44`,
                    }
                  : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
              }
              title={n === 1 ? "Mono" : `${n}-voice unison`}
              aria-pressed={on}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UniDetunePresets() {
  const detune = useFireCommandStore((s) => s.patch.unisonDetune) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.unison;
  const presets = [
    { label: "0¢", v: 0 },
    { label: "8¢", v: 8 },
    { label: "14¢", v: 14 },
    { label: "22¢", v: 22 },
    { label: "35¢", v: 35 },
  ] as const;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Detune
      </span>
      {presets.map((p) => {
        const on = Math.abs(detune - p.v) < 1.5;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("unisonDetune", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

const UNI_CHARACTERS = [
  { id: "mono", label: "Mono", unison: 1, detune: 0, width: 0.5, drift: 0 },
  { id: "soft", label: "Soft", unison: 3, detune: 8, width: 0.55, drift: 0.1 },
  { id: "chorus", label: "Chorus", unison: 3, detune: 14, width: 0.7, drift: 0.15 },
  { id: "supersaw", label: "Supersaw", unison: 5, detune: 18, width: 0.85, drift: 0.12 },
  { id: "wall", label: "Wall", unison: 7, detune: 28, width: 1, drift: 0.2 },
] as const;

function UniCharacterStrip() {
  const unison = useFireCommandStore((s) => s.patch.unison) ?? 1;
  const detune = useFireCommandStore((s) => s.patch.unisonDetune) ?? 0;
  const width = useFireCommandStore((s) => s.patch.unisonWidth) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.unison;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Choir
      </span>
      {UNI_CHARACTERS.map((p) => {
        const on =
          Math.round(unison) === p.unison &&
          Math.abs(detune - p.detune) < 3 &&
          Math.abs(width - p.width) < 0.12;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("unison", p.unison);
              setParam("unisonDetune", p.detune);
              setParam("unisonWidth", p.width);
              setParam("drift", p.drift);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label}: ${p.unison}V · ${p.detune}¢ · W${Math.round(p.width * 100)}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function UniQuickActions() {
  const unison = useFireCommandStore((s) => s.patch.unison) ?? 1;
  const detune = useFireCommandStore((s) => s.patch.unisonDetune) ?? 0;
  const width = useFireCommandStore((s) => s.patch.unisonWidth) ?? 0.5;
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ unison: 5, detune: 18, width: 0.85, drift: 0.12 });
  const c = FC.unison;
  const mono = Math.round(unison) <= 1 && detune < 1;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (mono) {
            setParam("unison", savedRef.current.unison);
            setParam("unisonDetune", savedRef.current.detune);
            setParam("unisonWidth", savedRef.current.width);
            setParam("drift", savedRef.current.drift);
          } else {
            savedRef.current = { unison, detune, width, drift };
            setParam("unison", 1);
            setParam("unisonDetune", 0);
            setParam("unisonWidth", 0.5);
            setParam("drift", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: mono ? `${c}88` : `${c}66`,
          color: mono ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.75),
          background: mono ? `${c}40` : `${c}22`,
          boxShadow: mono ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={mono ? "Restore choir stack" : "Collapse to mono"}
      >
        {mono ? "Stack" : "Mono"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("unison", 1);
          setParam("unisonDetune", 0);
          setParam("unisonWidth", 0.5);
          setParam("drift", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset unison"
      >
        Reset
      </button>
    </div>
  );
}

function UniModMeter({ label, value, max = 1, format, color }: {
  label: string; value: number; max?: number; format: (v: number) => string; color: string;
}) {
  const t = Math.min(1, Math.abs(value) / max);
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.25rem]" title={`${label} ${format(value)}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.08 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.05 ? color : "rgba(255,255,255,0.3)" }}>
        {format(value)}
      </div>
    </div>
  );
}

function UnisonPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.unison;
  const cVoices = bandShade(FC.tone, 0.35);
  const cDet = bandShade(FC.tone, 0.48);
  const cWid = bandShade(FC.tone, 0.65);
  const cDrift = bandShade(FC.tone, 0.78);
  const unison = useFireCommandStore((s) => s.patch.unison) ?? 1;
  const detune = useFireCommandStore((s) => s.patch.unisonDetune) ?? 0;
  const width = useFireCommandStore((s) => s.patch.unisonWidth) ?? 0.5;
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const unisonMix = useFireCommandStore((s) => s.patch.unisonMix) ?? 1;
  const unisonAnchor = useFireCommandStore((s) => s.patch.unisonAnchor) ?? true;
  const unisonDistribution = useFireCommandStore((s) => s.patch.unisonDistribution) ?? "linear";
  const unisonPhase = useFireCommandStore((s) => s.patch.unisonPhase) ?? "locked";
  const unisonTemporalSpread = useFireCommandStore((s) => s.patch.unisonTemporalSpread) ?? 0;
  const unisonTemporalMode = useFireCommandStore((s) => s.patch.unisonTemporalMode) ?? "ltr";
  const setParam = useFireCommandStore((s) => s.setParam);
  const [deepMode, setDeepMode] = useState(false);
  const stacked = Math.round(unison) > 1 || detune > 1;
  const mono = Math.round(unison) === 1 && detune < 1;

  return (
    <Section
      title="Unison"
      color={c}
      collapseKey="mixer.unison"
      chipHosted={chipHosted}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: stacked ? `${c}40` : `${c}28`,
          background: stacked
            ? `linear-gradient(105deg, ${c}22 0%, ${c}0a 42%, transparent 70%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: stacked ? `inset 0 1px 0 ${c}22` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.88) }}>
            Voice Choir
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {mono ? "MONO — ONE VOICE" : `${Math.round(unison)}V · ${Math.round(detune)}¢ · W${Math.round(width * 100)}`}
              {drift > 0.04 ? ` · DR${Math.round(drift * 100)}` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <UniQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: stacked ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.35)",
              background: stacked ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${stacked ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: stacked ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stacked ? `${Math.round(unison)}V` : "Mono"}
          </div>
        </div>
      </div>

      <UnisonStageViz />
      <UniVoiceStrip deepMode={deepMode} onToggleDeep={() => setDeepMode(!deepMode)} />
      <UniDetunePresets />
      <UniCharacterStrip />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>Distribution</span>
          <select
            value={unisonDistribution}
            onChange={(e) => setParam("unisonDistribution", e.target.value as any)}
            className="rounded border bg-black/40 px-1.5 py-0.5 text-[9px] font-bold transition"
            style={{ borderColor: `${c}55`, color: `${c}dd` }}
          >
            <option value="linear">Linear</option>
            <option value="center">Center</option>
            <option value="edge">Edge</option>
            <option value="gaussian">Gaussian</option>
            <option value="alternating">Alternating</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>Phase</span>
          <select
            value={unisonPhase}
            onChange={(e) => setParam("unisonPhase", e.target.value as any)}
            className="rounded border bg-black/40 px-1.5 py-0.5 text-[9px] font-bold transition"
            style={{ borderColor: `${c}55`, color: `${c}dd` }}
          >
            <option value="locked">Locked</option>
            <option value="random">Random</option>
            <option value="even">Even</option>
            <option value="alternating">Alternating</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => setParam("unisonAnchor", !unisonAnchor)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
          style={
            unisonAnchor
              ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.tone, 0.9), boxShadow: `0 0 10px ${c}44` }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
          }
          title="Keep center voice locked (tune/pan/delay)"
        >
          Anchor
        </button>
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>Temporal</span>
          <select
            value={unisonTemporalMode}
            onChange={(e) => setParam("unisonTemporalMode", e.target.value as any)}
            className="rounded border bg-black/40 px-1.5 py-0.5 text-[9px] font-bold transition"
            style={{ borderColor: `${c}55`, color: `${c}dd` }}
          >
            <option value="ltr">L→R</option>
            <option value="center">Center</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-center gap-4">
        <UniModMeter label="Voices" value={unison} max={deepMode ? 16 : 7} format={(v) => `${Math.round(v)}`} color={cVoices} />
        <UniModMeter label="Detune" value={detune} max={50} format={(v) => `${Math.round(v)}¢`} color={cDet} />
        <UniModMeter label="Width" value={width} format={fmtPct} color={cWid} />
        <UniModMeter label="Drift" value={drift} format={fmtPct} color={cDrift} />
      </div>

      <div className="flex items-center justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="unisonMix" label="Choir Mix" min={0} max={1} format={fmtPct} def={1} size={48} color={cVoices} />
        <FParamKnob paramKey="unisonDetune" label="Detune" min={0} max={50} integer format={fmtCents} def={0} size={48} color={cDet} />
        <FParamKnob paramKey="unisonWidth" label="Width" min={0} max={1} format={fmtPct} def={0.5} size={48} color={cWid} />
        <FParamKnob paramKey="unisonTemporalSpread" label="Temporal" min={0} max={0.05} format={(v) => `${Math.round(v * 1000)}ms`} def={0} size={46} color={cDrift} />
        <FParamKnob paramKey="unisonEnvSpread" label="Env Sprd" min={0} max={1} format={fmtPct} def={0} size={44} color={bandShade(FC.tone, 0.75)} />
        <FParamKnob paramKey="drift" label="Drift" min={0} max={1} format={fmtPct} def={0} size={46} color={cDrift} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Tone stack choir — drag Width↔ / Detune↕, tap voice rail, Deep toggle 1–16, distribution shapes spread.
      </div>
    </Section>
  );
}

// ════════════════════ LIFE — Organic Pulse ════════════════════

const LIFE_CHARS = [
  { id: "still", label: "Still", drift: 0, rate: 0.35, instab: 0, tune: 0, env: 0 },
  { id: "warm", label: "Warm", drift: 0.18, rate: 0.32, instab: 0.1, tune: 0.08, env: 0.06 },
  { id: "vintage", label: "Vintage", drift: 0.28, rate: 0.4, instab: 0.18, tune: 0.12, env: 0.1 },
  { id: "unstable", label: "Unstable", drift: 0.4, rate: 0.55, instab: 0.35, tune: 0.22, env: 0.15 },
  { id: "chaos", label: "Chaos", drift: 0.65, rate: 0.8, instab: 0.55, tune: 0.4, env: 0.35 },
] as const;

const LIFE_TEMPO = [
  { id: "slow", label: "Largo", rate: 0.18 },
  { id: "andante", label: "Andante", rate: 0.35 },
  { id: "allegro", label: "Allegro", rate: 0.58 },
  { id: "presto", label: "Presto", rate: 0.88 },
] as const;

function lifeNear(a: number, b: number, tol = 0.07) {
  return Math.abs(a - b) < tol;
}

function LifeCharacterStrip() {
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.driftRate) ?? 0.35;
  const instab = useFireCommandStore((s) => s.patch.voiceInstability) ?? 0;
  const tune = useFireCommandStore((s) => s.patch.tuneVariance) ?? 0;
  const env = useFireCommandStore((s) => s.patch.envVariance) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.analogLife;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Pulse
      </span>
      {LIFE_CHARS.map((p) => {
        const on =
          (p.id === "still" && drift < 0.02 && instab < 0.02 && tune < 0.02 && env < 0.02) ||
          (p.id !== "still" &&
            lifeNear(drift, p.drift) &&
            lifeNear(instab, p.instab, 0.1) &&
            lifeNear(rate, p.rate, 0.12));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("drift", p.drift);
              setParam("driftRate", p.rate);
              setParam("voiceInstability", p.instab);
              setParam("tuneVariance", p.tune);
              setParam("envVariance", p.env);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} — drift ${Math.round(p.drift * 100)} · ~${Math.round(28 + p.rate * 92)}bpm`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function LifeTempoStrip() {
  const rate = useFireCommandStore((s) => s.patch.driftRate) ?? 0.35;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.analogLife;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Tempo
      </span>
      {LIFE_TEMPO.map((t) => {
        const on = lifeNear(rate, t.rate, 0.08);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setParam("driftRate", t.rate)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.tone, 0.5)}99`,
                    background: `${bandShade(FC.tone, 0.5)}28`,
                    color: bandShade(FC.tone, 0.88),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${t.label} · ~${Math.round(28 + t.rate * 92)} bpm`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function LifeQuickActions() {
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.driftRate) ?? 0.35;
  const instab = useFireCommandStore((s) => s.patch.voiceInstability) ?? 0;
  const tune = useFireCommandStore((s) => s.patch.tuneVariance) ?? 0;
  const env = useFireCommandStore((s) => s.patch.envVariance) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ drift: 0.28, rate: 0.4, instab: 0.18, tune: 0.12, env: 0.1 });
  const c = FC.analogLife;
  const still = drift < 0.02 && instab < 0.02 && tune < 0.02 && env < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (still) {
            setParam("drift", savedRef.current.drift);
            setParam("driftRate", savedRef.current.rate);
            setParam("voiceInstability", savedRef.current.instab);
            setParam("tuneVariance", savedRef.current.tune);
            setParam("envVariance", savedRef.current.env);
          } else {
            savedRef.current = { drift, rate, instab, tune, env };
            setParam("drift", 0);
            setParam("voiceInstability", 0);
            setParam("tuneVariance", 0);
            setParam("envVariance", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: still ? `${c}88` : `${c}66`,
          color: still ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.75),
          background: still ? `${c}40` : `${c}22`,
          boxShadow: still ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={still ? "Restore organic life" : "Freeze to still"}
      >
        {still ? "Wake" : "Still"}
      </button>
      <button
        type="button"
        onClick={() => {
          // Gentle vintage life — musical default
          setParam("drift", 0.28);
          setParam("driftRate", 0.4);
          setParam("voiceInstability", 0.18);
          setParam("tuneVariance", 0.12);
          setParam("envVariance", 0.1);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.tone, 0.82), background: `${c}1c` }}
        title="Stamp vintage organism"
      >
        Breathe
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("drift", 0);
          setParam("driftRate", 0.35);
          setParam("voiceInstability", 0);
          setParam("tuneVariance", 0);
          setParam("envVariance", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset analog life"
      >
        Reset
      </button>
    </div>
  );
}

function LifeModMeter({
  label,
  fullLabel,
  value,
  color,
  format,
}: {
  label: string;
  fullLabel?: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  const titleText = fullLabel ? `${fullLabel}: ${display}` : `${label} ${display}`;
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.75rem]" title={titleText}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function AnalogLifePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.analogLife;
  const cDrift = bandShade(FC.tone, 0.4);
  const cRate = bandShade(FC.tone, 0.52);
  const cInst = bandShade(FC.tone, 0.62);
  const cTune = bandShade(FC.tone, 0.72);
  const cEnv = bandShade(FC.tone, 0.82);
  const drift = useFireCommandStore((s) => s.patch.drift) ?? 0;
  const rate = useFireCommandStore((s) => s.patch.driftRate) ?? 0.35;
  const instab = useFireCommandStore((s) => s.patch.voiceInstability) ?? 0;
  const tune = useFireCommandStore((s) => s.patch.tuneVariance) ?? 0;
  const env = useFireCommandStore((s) => s.patch.envVariance) ?? 0;
  const analogDnaSeed = useFireCommandStore((s) => s.patch.analogDnaSeed) ?? 0x73a9c412;
  const analogDnaLock = useFireCommandStore((s) => s.patch.analogDnaLock) ?? false;
  const analogWake = useFireCommandStore((s) => s.patch.analogWake) ?? 0;
  const analogTremor = useFireCommandStore((s) => s.patch.analogTremor) ?? 0.55;
  const analogBreath = useFireCommandStore((s) => s.patch.analogBreath) ?? 0.45;
  const analogClimate = useFireCommandStore((s) => s.patch.analogClimate) ?? 0.3;
  const analogEvents = useFireCommandStore((s) => s.patch.analogEvents) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const alive = drift > 0.02 || instab > 0.02 || tune > 0.02 || env > 0.02;
  const bpm = Math.round(28 + rate * 92);
  const vitality = Math.min(1, drift * 0.45 + instab * 0.25 + tune * 0.15 + env * 0.15);

  return (
    <Section
      title="Analog Life"
      color={c}
      collapseKey="analog.life"
      chipHosted={chipHosted}
      defaultCollapsed
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: alive ? `${c}45` : `${c}28`,
          background: alive
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: alive ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.88) }}>
            Organic Pulse
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {alive
                ? `DR${Math.round(drift * 100)} · ${bpm}bpm · couples LFO/glide`
                : "STILL — MODULATION PAUSED"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LifeQuickActions />
          <div
            className="relative overflow-hidden rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{
              color: alive ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.35)",
              background: alive ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${alive ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: alive ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {alive && (
              <span
                className="pointer-events-none absolute inset-y-0 left-0 opacity-40"
                style={{
                  width: `${vitality * 100}%`,
                  background: `linear-gradient(90deg, transparent, ${c})`,
                }}
              />
            )}
            <span className="relative">{alive ? `${bpm} BPM` : "Still"}</span>
          </div>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 rounded border px-2 py-1.5" style={{ borderColor: `${c}40`, background: "rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>DNA</span>
          <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: `${c}dd` }} title={`Analog DNA Seed: ${analogDnaSeed.toString(16).toUpperCase()}`}>
            0x{analogDnaSeed.toString(16).toUpperCase().padStart(8, '0')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (!analogDnaLock) {
                setParam("analogDnaSeed", Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);
              }
            }}
            className="rounded border px-2 py-0.5 text-[9px] font-bold transition hover:brightness-125"
            style={{ 
              borderColor: analogDnaLock ? `${c}33` : `${c}77`, 
              color: analogDnaLock ? "rgba(255,255,255,0.3)" : `${c}dd`, 
              background: analogDnaLock ? "rgba(0,0,0,0.2)" : `${c}22`,
              cursor: analogDnaLock ? "not-allowed" : "pointer",
              opacity: analogDnaLock ? 0.5 : 1,
            }}
            disabled={analogDnaLock}
            title={analogDnaLock ? "Unlock DNA first to mutate" : "Randomize DNA seed"}
          >
            MUTATE
          </button>
          <button
            type="button"
            onClick={() => setParam("analogDnaLock", !analogDnaLock)}
            className="rounded border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              analogDnaLock
                ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.tone, 0.9), boxShadow: `0 0 10px ${c}44` }
                : { borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }
            }
            title={analogDnaLock ? "DNA locked against mutation" : "Lock DNA to prevent mutation"}
          >
            {analogDnaLock ? "LOCKED" : "LOCK"}
          </button>
        </div>
      </div>

      <AnalogLifeStageViz />
      <LifeCharacterStrip />
      <LifeTempoStrip />

      <div className="mb-2 flex items-center justify-center gap-3 flex-wrap">
        <LifeModMeter 
          label="Drift" 
          fullLabel="Drift (Organic Modulation)" 
          value={drift} 
          color={cDrift} 
        />
        <LifeModMeter 
          label="Rate" 
          fullLabel="Rate (Pulse Tempo)"
          value={(rate - 0.05) / 0.95} 
          color={cRate} 
          format={() => `${bpm}`} 
        />
        <LifeModMeter 
          label="Instab" 
          fullLabel="Instability (Voice Variance)"
          value={instab} 
          color={cInst} 
        />
        <LifeModMeter 
          label="Tune Δ" 
          fullLabel="Tune Variance (Pitch Drift)"
          value={tune} 
          color={cTune} 
        />
        <LifeModMeter 
          label="Env Δ" 
          fullLabel="Envelope Variance (Attack/Release Jitter)"
          value={env} 
          color={cEnv} 
        />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="drift" label="Life" min={0} max={1} format={fmtPct} def={0} size={52} color={cDrift} />
        <FParamKnob paramKey="driftRate" label="Rate" min={0.05} max={1} format={fmtPct} def={0.35} size={52} color={cRate} />
        <FParamKnob paramKey="analogWake" label="Wake" min={0} max={1} format={fmtPct} def={0} size={44} color={bandShade(FC.tone, 0.38)} />
        <FParamKnob paramKey="analogTremor" label="Tremor" min={0} max={1} format={fmtPct} def={0.55} size={44} color={bandShade(FC.tone, 0.48)} />
        <FParamKnob paramKey="analogBreath" label="Breath" min={0} max={1} format={fmtPct} def={0.45} size={44} color={bandShade(FC.tone, 0.58)} />
        <FParamKnob paramKey="analogClimate" label="Climate" min={0} max={1} format={fmtPct} def={0.3} size={44} color={bandShade(FC.tone, 0.68)} />
        <FParamKnob paramKey="analogEvents" label="Events" min={0} max={1} format={fmtPct} def={0} size={44} color={bandShade(FC.tone, 0.78)} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Tone organism — DNA seeds voice personalities, Wake/Tremor/Breath/Climate tune time layers, Events add chaos.
      </div>
    </Section>
  );
}

// ════════════════════ FILT — Spectral Blade ════════════════════

const FILT_CHARS = [
  { id: "open", label: "Open", type: "lowpass" as const, cut: 12000, reso: 0.5, env: 0, key: 0.2, sat: 0 },
  { id: "warm", label: "Warm", type: "lowpass" as const, cut: 1800, reso: 1.2, env: 0.35, key: 0.35, sat: 0.15 },
  { id: "scream", label: "Scream", type: "lowpass" as const, cut: 900, reso: 12, env: 0.55, key: 0.25, sat: 0.4 },
  { id: "band", label: "Band", type: "bandpass" as const, cut: 1400, reso: 4, env: 0.2, key: 0.4, sat: 0.1 },
  { id: "air", label: "Air", type: "highpass" as const, cut: 420, reso: 0.8, env: -0.15, key: 0.5, sat: 0 },
  { id: "notch", label: "Notch", type: "notch" as const, cut: 2200, reso: 6, env: 0, key: 0.3, sat: 0.2 },
] as const;

const FILT_CUT_PRESETS = [
  { label: "80", v: 80 },
  { label: "220", v: 220 },
  { label: "800", v: 800 },
  { label: "2k", v: 2000 },
  { label: "5k", v: 5000 },
  { label: "12k", v: 12000 },
] as const;

function filtNearHz(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(30, a) / Math.max(30, b))) < 0.18;
}

function FiltCarveChip({ mode }: { mode: "off" | "fundamental" | "odds" | "evens" | "noise" }) {
  const carve = useFireCommandStore((s) => s.patch.filterCarve) ?? "off";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.filter;
  const on = carve === mode;
  const labels: Record<typeof mode, string> = {
    off: "Carve Off",
    fundamental: "Fund",
    odds: "Odds",
    evens: "Evens",
    noise: "Noise",
  };
  return (
    <button
      type="button"
      onClick={() => {
        setParam("filterCarve", mode);
        if (mode !== "off") setParam("filterCarveAmount", Math.max(0.35, useFireCommandStore.getState().patch.filterCarveAmount ?? 0));
      }}
      className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{
        borderColor: on ? `${c}88` : "rgba(255,255,255,0.1)",
        color: on ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.4)",
        background: on ? `${c}30` : "rgba(0,0,0,0.3)",
      }}
      title={`Harmonic carve: ${labels[mode]}`}
    >
      {labels[mode]}
    </button>
  );
}

function FiltDrivePosChip() {
  const pos = useFireCommandStore((s) => s.patch.filterDrivePos) ?? "post";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.filter;
  return (
    <button
      type="button"
      onClick={() => setParam("filterDrivePos", pos === "pre" ? "post" : "pre")}
      className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{
        borderColor: `${c}55`,
        color: bandShade(FC.tone, 0.85),
        background: `${c}18`,
      }}
      title="Saturation before or after the blade"
    >
      Sat {pos === "pre" ? "Pre" : "Post"}
    </button>
  );
}

function FiltTypeStrip() {
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.filter;
  const opts: { id: FireFilterType; label: string; tip: string }[] = [
    { id: "lowpass", label: "LP", tip: "Lowpass — open the top" },
    { id: "bandpass", label: "BP", tip: "Bandpass — carve a window" },
    { id: "highpass", label: "HP", tip: "Highpass — thin the body" },
    { id: "notch", label: "NT", tip: "Notch — cut a slot" },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Blade
      </span>
      {opts.map((o) => {
        const on = type === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("filterType", o.id)}
            className="min-w-[2.1rem] rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.92),
                    boxShadow: `0 0 12px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={o.tip}
            aria-pressed={on}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FiltCharacterStrip() {
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const cut = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const reso = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.filter;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Edge
      </span>
      {FILT_CHARS.map((p) => {
        const on = type === p.type && filtNearHz(cut, p.cut) && Math.abs(Math.log10(Math.max(0.2, reso) / Math.max(0.2, p.reso))) < 0.25;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("filterType", p.type);
              setParam("filterCutoff", p.cut);
              setParam("filterResonance", p.reso);
              setParam("filterEnvAmount", p.env);
              setParam("filterKeyTrack", p.key);
              setParam("filterDrive", p.sat);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} · ${p.type} · ${p.cut}Hz · Q${p.reso}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FiltCutoffStrip() {
  const cut = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.filter;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Cut
      </span>
      {FILT_CUT_PRESETS.map((p) => {
        const on = filtNearHz(cut, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("filterCutoff", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.tone, 0.5)}99`,
                    background: `${bandShade(FC.tone, 0.5)}28`,
                    color: bandShade(FC.tone, 0.88),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${p.v} Hz`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FiltQuickActions() {
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const cut = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const reso = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const env = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const key = useFireCommandStore((s) => s.patch.filterKeyTrack) ?? 0.3;
  const sat = useFireCommandStore((s) => s.patch.filterDrive) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ type: "lowpass" as FireFilterType, cut: 1800, reso: 1.2, env: 0.35, key: 0.35, sat: 0.15 });
  const c = FC.filter;
  const open = cut > 9000 && reso < 1.5 && Math.abs(env) < 0.05 && sat < 0.05;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (open) {
            setParam("filterType", savedRef.current.type);
            setParam("filterCutoff", savedRef.current.cut);
            setParam("filterResonance", savedRef.current.reso);
            setParam("filterEnvAmount", savedRef.current.env);
            setParam("filterKeyTrack", savedRef.current.key);
            setParam("filterDrive", savedRef.current.sat);
          } else {
            savedRef.current = { type, cut, reso, env, key, sat };
            setParam("filterType", "lowpass");
            setParam("filterCutoff", 12000);
            setParam("filterResonance", 0.5);
            setParam("filterEnvAmount", 0);
            setParam("filterDrive", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: open ? `${c}88` : `${c}66`,
          color: open ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.75),
          background: open ? `${c}40` : `${c}22`,
          boxShadow: open ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={open ? "Restore sculpted edge" : "Bypass to open LP"}
      >
        {open ? "Sculpt" : "Open"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("filterType", "lowpass");
          setParam("filterCutoff", 1800);
          setParam("filterResonance", 2.8);
          setParam("filterEnvAmount", 0.45);
          setParam("filterKeyTrack", 0.4);
          setParam("filterDrive", 0.25);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.tone, 0.82), background: `${c}1c` }}
        title="Musical warm LP with env bite"
      >
        Carve
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("filterType", "lowpass");
          setParam("filterCutoff", 2600);
          setParam("filterResonance", 0.7);
          setParam("filterEnvAmount", 0);
          setParam("filterKeyTrack", 0.3);
          setParam("filterDrive", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset filter defaults"
      >
        Reset
      </button>
    </div>
  );
}

function FiltModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = bipolar ? Math.min(1, Math.abs(value)) : Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.75rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function FilterPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.filter;
  const cCut = bandShade(FC.tone, 0.42);
  const cRes = bandShade(FC.tone, 0.55);
  const cEnv = bandShade(FC.tone, 0.68);
  const cKey = bandShade(FC.tone, 0.78);
  const cSat = bandShade(FC.tone, 0.88);
  const type = useFireCommandStore((s) => s.patch.filterType) ?? "lowpass";
  const cut = useFireCommandStore((s) => s.patch.filterCutoff) ?? 2600;
  const reso = useFireCommandStore((s) => s.patch.filterResonance) ?? 0.7;
  const env = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const key = useFireCommandStore((s) => s.patch.filterKeyTrack) ?? 0.3;
  const sat = useFireCommandStore((s) => s.patch.filterDrive) ?? 0;
  const sculpted = Math.abs(Math.log10(cut / 2600)) > 0.08 || reso > 1.2 || Math.abs(env) > 0.05 || sat > 0.05;
  const cutNorm = Math.log(Math.max(20, cut) / 20) / Math.log(18000 / 20);
  const resNorm = Math.log(Math.max(0.1, reso) / 0.1) / Math.log(28 / 0.1);
  const typeShort = type === "lowpass" ? "LP" : type === "highpass" ? "HP" : type === "bandpass" ? "BP" : "NT";

  return (
    <Section
      title="Filter"
      color={c}
      collapseKey="filter"
      chipHosted={chipHosted}
      right={
        <div
          className="rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
          style={{
            color: bandShade(FC.tone, 0.9),
            background: `${c}28`,
            border: `1px solid ${c}55`,
          }}
          title="Blade type — change via Blade strip below or double-click the viz"
        >
          {typeShort}
        </div>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: sculpted ? `${c}45` : `${c}28`,
          background: sculpted
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: sculpted ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.88) }}>
            Spectral Blade
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {typeShort} · {fmtHz(cut)} · Q{reso.toFixed(1)}
              {Math.abs(env) > 0.04 ? ` · E${fmtBi(env)}` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FiltQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: sculpted ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.35)",
              background: sculpted ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${sculpted ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: sculpted ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {sculpted ? typeShort : "FLAT — ENV AMOUNT 0"}
          </div>
        </div>
      </div>

      <FilterStageViz />
      <FiltTypeStrip />
      <FiltCharacterStrip />
      <FiltCutoffStrip />

      <div className="mb-2 flex items-center justify-center gap-3 flex-wrap">
        <FiltModMeter label="Cut" value={cutNorm} color={cCut} format={() => fmtHz(cut)} />
        <FiltModMeter label="Reso" value={resNorm} color={cRes} format={() => reso.toFixed(1)} />
        <FiltModMeter label="Env" value={env} color={cEnv} bipolar format={fmtBi} />
        <FiltModMeter label="Key" value={key} color={cKey} />
        <FiltModMeter label="Sat" value={sat} color={cSat} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="filterCutoff" label="Cutoff" min={20} max={18000} curve="log" format={fmtHz} def={2600} size={50} color={cCut} />
        <FParamKnob paramKey="filterResonance" label="Reso" min={0.1} max={28} curve="log" format={fmtQ} def={0.7} size={50} color={cRes} />
        <FParamKnob paramKey="filterEnvAmount" label="Env→Cut" min={-1} max={1} bipolar format={fmtBi} def={0} size={42} color={cEnv} />
        <FParamKnob paramKey="filterEnvResoAmount" label="Env→Reso" min={-1} max={1} bipolar format={fmtBi} def={0} size={42} color={bandShade(FC.tone, 0.7)} />
        <FParamKnob paramKey="filterKeyTrack" label="Key Trk" min={0} max={1} format={fmtPct} def={0.3} size={40} color={cKey} />
        <FParamKnob paramKey="filterDrive" label="Sat" min={0} max={1} format={fmtPct} def={0} size={40} color={cSat} />
        <FParamKnob paramKey="filterSlope" label="Slope" min={1} max={3} integer format={(v) => `${Math.round(v) * 12}dB`} def={1} size={40} color={bandShade(FC.tone, 0.55)} />
        <FParamKnob paramKey="filterCarveAmount" label="Carve" min={0} max={1} format={fmtPct} def={0} size={40} color={bandShade(FC.tone, 0.8)} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
        {(["off", "fundamental", "odds", "evens", "noise"] as const).map((m) => (
          <FiltCarveChip key={m} mode={m} />
        ))}
        <FiltDrivePosChip />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Spectral blade — slope cascades, carve targets partials, Env→Reso for dual sweep.
      </div>
    </Section>
  );
}

// ════════════════════ AMP — Breath Contour ════════════════════

const A_MIN_UI = 0.001;

const AMP_CHARS = [
  { id: "snap", label: "Snap", a: 0.001, d: 0.08, s: 0.0, r: 0.08, vel: 1 },
  { id: "pluck", label: "Pluck", a: 0.002, d: 0.18, s: 0.15, r: 0.22, vel: 1 },
  { id: "punch", label: "Punch", a: 0.005, d: 0.22, s: 0.55, r: 0.28, vel: 0.9 },
  { id: "pad", label: "Pad", a: 0.45, d: 0.8, s: 0.85, r: 1.4, vel: 0.7 },
  { id: "swell", label: "Swell", a: 1.2, d: 0.6, s: 0.9, r: 2.0, vel: 0.55 },
  { id: "gate", label: "Gate", a: 0.001, d: 0.05, s: 1, r: 0.05, vel: 1 },
] as const;

function ampNearSec(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.001, a) / Math.max(0.001, b))) < 0.55;
}

function AmpCharacterStrip() {
  const a = useFireCommandStore((s) => s.patch.ampAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.ampDecay) ?? 0.25;
  const sus = useFireCommandStore((s) => s.patch.ampSustain) ?? 0.8;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.envAmp;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Contour
      </span>
      {AMP_CHARS.map((p) => {
        const on = ampNearSec(a, p.a) && ampNearSec(d, p.d) && Math.abs(sus - p.s) < 0.12;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("ampAttack", p.a);
              setParam("ampDecay", p.d);
              setParam("ampSustain", p.s);
              setParam("ampRelease", p.r);
              setParam("velAmount", p.vel);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} contour`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function AmpQuickActions() {
  const a = useFireCommandStore((s) => s.patch.ampAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.ampDecay) ?? 0.25;
  const sus = useFireCommandStore((s) => s.patch.ampSustain) ?? 0.8;
  const r = useFireCommandStore((s) => s.patch.ampRelease) ?? 0.35;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ a: 0.01, d: 0.25, s: 0.8, r: 0.35, vel: 1 });
  const c = FC.envAmp;
  const gated = sus > 0.95 && a < 0.02 && r < 0.12;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (!gated) {
            savedRef.current = { a, d, s: sus, r, vel };
            setParam("ampAttack", 0.001);
            setParam("ampDecay", 0.05);
            setParam("ampSustain", 1);
            setParam("ampRelease", 0.05);
            setParam("velAmount", 1);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: !gated ? `${c}88` : `${c}44`,
          color: !gated ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.6),
          background: !gated ? `${c}40` : `${c}15`,
          boxShadow: !gated ? `0 0 14px ${c}55` : undefined,
        }}
        title="VCA mode: full ADSR contour"
      >
        VCA
      </button>
      <button
        type="button"
        onClick={() => {
          if (gated) {
            setParam("ampAttack", savedRef.current.a);
            setParam("ampDecay", savedRef.current.d);
            setParam("ampSustain", savedRef.current.s);
            setParam("ampRelease", savedRef.current.r);
            setParam("velAmount", savedRef.current.vel);
          } else {
            savedRef.current = { a, d, s: sus, r, vel };
            setParam("ampAttack", 0.001);
            setParam("ampDecay", 0.05);
            setParam("ampSustain", 1);
            setParam("ampRelease", 0.05);
            setParam("velAmount", 1);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: gated ? `${c}88` : `${c}44`,
          color: gated ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.6),
          background: gated ? `${c}40` : `${c}15`,
          boxShadow: gated ? `0 0 14px ${c}55` : undefined,
        }}
        title={gated ? "Restore previous contour" : "Full gate — hold while key down"}
      >
        {gated ? "Shape" : "Gate"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("ampAttack", 0.01);
          setParam("ampDecay", 0.25);
          setParam("ampSustain", 0.8);
          setParam("ampRelease", 0.35);
          setParam("velAmount", 1);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset amp defaults"
      >
        Reset
      </button>
    </div>
  );
}

function AmpModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.75rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function AmpEnvPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.envAmp;
  const cA = bandShade(FC.tone, 0.42);
  const cD = bandShade(FC.tone, 0.55);
  const cS = bandShade(FC.tone, 0.68);
  const cR = bandShade(FC.tone, 0.78);
  const cVel = bandShade(FC.tone, 0.9);
  const a = useFireCommandStore((s) => s.patch.ampAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.ampDecay) ?? 0.25;
  const sus = useFireCommandStore((s) => s.patch.ampSustain) ?? 0.8;
  const r = useFireCommandStore((s) => s.patch.ampRelease) ?? 0.35;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const ampModel = useFireCommandStore((s) => s.patch.ampModel) ?? "vca";
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const pluckOn = useFireCommandStore((s) => s.patch.moduleEnable?.["pluck"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const aN = Math.log(Math.max(A_MIN_UI, a) / A_MIN_UI) / Math.log(3 / A_MIN_UI);
  const dN = Math.log(Math.max(0.005, d) / 0.005) / Math.log(3 / 0.005);
  const rN = Math.log(Math.max(0.005, r) / 0.005) / Math.log(4 / 0.005);

  return (
    <Section title="Amp Envelope" color={c} collapseKey="env.amp" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: `${c}40`,
          background: `linear-gradient(105deg, ${c}24 0%, ${c}0a 42%, transparent 70%)`,
          boxShadow: `inset 0 1px 0 ${c}22`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.88) }}>
            Breath Contour
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {`A${fmtSec(a)} · D${fmtSec(d)} · S${Math.round(sus * 100)} · R${fmtSec(r)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AmpQuickActions />
          <div className="flex rounded-md overflow-hidden border" style={{ borderColor: `${c}55` }}>
            {(["vca", "gate"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setParam("ampModel", m)}
                className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
                style={{
                  color: ampModel === m ? bandShade(FC.tone, 0.95) : `${c}88`,
                  background: ampModel === m ? `${c}40` : "transparent",
                }}
                title={m === "vca" ? "VCA — classic ADSR loudness" : "GATE — sustain holds full while key down"}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AmpEnvStageViz />
      
      {lpgOn && pluckOn && (
        <div className="mb-2 text-center text-[10px] leading-snug" style={{ color: `${FC.pluck}99` }}>
          Pluck Gate armed — LPG replaces amp/filter envelopes while sounding
        </div>
      )}
      
      <AmpCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-3 flex-wrap">
        <AmpModMeter label="A" value={aN} color={cA} format={() => fmtSec(a)} />
        <AmpModMeter label="D" value={dN} color={cD} format={() => fmtSec(d)} />
        <AmpModMeter label="S" value={sus} color={cS} />
        <AmpModMeter label="R" value={rN} color={cR} format={() => fmtSec(r)} />
        <AmpModMeter label="Vel" value={vel} color={cVel} />
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="ampAttack" label="Attack" min={0.001} max={3} curve="log" format={fmtSec} def={0.01} size={48} color={cA} />
        <FParamKnob paramKey="ampDecay" label="Decay" min={0.005} max={3} curve="log" format={fmtSec} def={0.25} size={48} color={cD} />
        <FParamKnob paramKey="ampSustain" label="Sustain" min={0} max={1} format={fmtPct} def={0.8} size={44} color={cS} />
        <FParamKnob paramKey="ampRelease" label="Release" min={0.005} max={4} curve="log" format={fmtSec} def={0.35} size={48} color={cR} />
        <FParamKnob paramKey="velAmount" label="Vel Peak" min={0} max={1} format={fmtPct} def={1} size={42} color={cVel} />
        <FParamKnob paramKey="velAttack" label="Vel→A" min={0} max={1} format={fmtPct} def={0} size={40} color={bandShade(FC.tone, 0.85)} />
        <FParamKnob paramKey="ampOvershoot" label="Punch" min={0} max={1} format={fmtPct} def={0} size={40} color={bandShade(FC.tone, 0.72)} />
        <FParamKnob paramKey="ampHold" label="Hold" min={0} max={0.5} format={fmtSec} def={0} size={40} color={bandShade(FC.tone, 0.6)} />
      </div>
      <AmpCurveRow />
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Loudness architecture — VCA or Gate model. Pluck Gate owns LPG strikes separately.
      </div>
    </Section>
  );
}

function AmpCurveRow() {
  const atk = useFireCommandStore((s) => s.patch.ampCurveAttack) ?? "lin";
  const dec = useFireCommandStore((s) => s.patch.ampCurveDecay) ?? "exp";
  const rel = useFireCommandStore((s) => s.patch.ampCurveRelease) ?? "exp";
  const retrig = useFireCommandStore((s) => s.patch.ampRetrigger) ?? "zero";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.envAmp;
  const curves = ["lin", "exp", "log", "s"] as const;
  const cycle = <K extends "ampCurveAttack" | "ampCurveDecay" | "ampCurveRelease">(
    key: K,
    cur: string,
  ) => {
    const i = curves.indexOf(cur as (typeof curves)[number]);
    setParam(key, curves[(i + 1) % curves.length]);
  };
  const chip = (label: string, value: string, onClick: () => void, title: string) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{ borderColor: `${c}55`, color: bandShade(FC.tone, 0.88), background: `${c}18` }}
      title={title}
    >
      {label} {value}
    </button>
  );
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
      {chip("Atk", atk, () => cycle("ampCurveAttack", atk), "Attack curve")}
      {chip("Dec", dec, () => cycle("ampCurveDecay", dec), "Decay curve")}
      {chip("Rel", rel, () => cycle("ampCurveRelease", rel), "Release curve")}
      {chip(
        "Retrig",
        retrig,
        () =>
          setParam(
            "ampRetrigger",
            retrig === "zero" ? "current" : retrig === "current" ? "legato" : "zero",
          ),
        "Retrigger: zero / current / legato",
      )}
    </div>
  );
}

// ════════════════════ MOD — Morph Weaver ════════════════════

const MOD_CHARS = [
  { id: "still", label: "Still", a: 0.02, d: 0.5, s: 0.3, r: 0.4, ea: 0, eb: 0, ec: 0 },
  { id: "nudge", label: "Nudge", a: 0.01, d: 0.35, s: 0.2, r: 0.3, ea: 0.25, eb: 0, ec: 0 },
  { id: "sweep", label: "Sweep", a: 0.08, d: 0.7, s: 0.15, r: 0.55, ea: 0.55, eb: 0.2, ec: 0 },
  { id: "cross", label: "Cross", a: 0.02, d: 0.4, s: 0.4, r: 0.45, ea: 0.4, eb: -0.35, ec: 0.2 },
  { id: "dive", label: "Dive", a: 0.005, d: 0.9, s: 0.05, r: 0.6, ea: -0.65, eb: -0.25, ec: 0 },
  { id: "weave", label: "Weave", a: 0.15, d: 0.55, s: 0.55, r: 0.8, ea: 0.45, eb: 0.35, ec: 0.3 },
] as const;

function modNearSec(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.001, a) / Math.max(0.001, b))) < 0.55;
}

function ModCharacterStrip() {
  const a = useFireCommandStore((s) => s.patch.modAttack) ?? 0.02;
  const envA = useFireCommandStore((s) => s.patch.oscAEnv) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.envMod;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Weave
      </span>
      {MOD_CHARS.map((p) => {
        const on =
          (p.id === "still" && Math.abs(envA) < 0.04) ||
          (p.id !== "still" && modNearSec(a, p.a) && Math.abs(envA - p.ea) < 0.12);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              const preset = modEnvPresetPoints(p.id);
              setParam("modEnvPoints", preset.points);
              setParam("modEnvSustainIndex", preset.sustainIndex);
              setParam("modAttack", preset.attack);
              setParam("modDecay", preset.decay);
              setParam("modSustain", preset.sustain);
              setParam("modRelease", preset.release);
              setParam("oscAEnv", p.ea);
              setParam("oscBEnv", p.eb);
              setParam("oscCEnv", p.ec);
            }}
            className="rounded-md border px-2 py-1 text-[10px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} morph weave`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ModQuickActions() {
  const a = useFireCommandStore((s) => s.patch.modAttack) ?? 0.02;
  const d = useFireCommandStore((s) => s.patch.modDecay) ?? 0.5;
  const sus = useFireCommandStore((s) => s.patch.modSustain) ?? 0.3;
  const r = useFireCommandStore((s) => s.patch.modRelease) ?? 0.4;
  const envA = useFireCommandStore((s) => s.patch.oscAEnv) ?? 0;
  const envB = useFireCommandStore((s) => s.patch.oscBEnv) ?? 0;
  const envC = useFireCommandStore((s) => s.patch.oscCEnv) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ a: 0.02, d: 0.5, s: 0.3, r: 0.4, ea: 0.4, eb: 0.15, ec: 0 });
  const c = FC.envMod;
  const idle = Math.abs(envA) < 0.02 && Math.abs(envB) < 0.02 && Math.abs(envC) < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("modAttack", savedRef.current.a);
            setParam("modDecay", savedRef.current.d);
            setParam("modSustain", savedRef.current.s);
            setParam("modRelease", savedRef.current.r);
            setParam("oscAEnv", savedRef.current.ea);
            setParam("oscBEnv", savedRef.current.eb);
            setParam("oscCEnv", savedRef.current.ec);
          } else {
            savedRef.current = { a, d, s: sus, r, ea: envA, eb: envB, ec: envC };
            setParam("oscAEnv", 0);
            setParam("oscBEnv", 0);
            setParam("oscCEnv", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.75),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore morph routing" : "Mute all Env→WT amounts"}
      >
        {idle ? "Weave" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("modAttack", 0.05);
          setParam("modDecay", 0.6);
          setParam("modSustain", 0.2);
          setParam("modRelease", 0.5);
          setParam("oscAEnv", 0.5);
          setParam("oscBEnv", 0.2);
          setParam("oscCEnv", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.tone, 0.82), background: `${c}1c` }}
        title="Classic WT morph sweep on A (+light B)"
      >
        Scan
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("modAttack", 0.02);
          setParam("modDecay", 0.5);
          setParam("modSustain", 0.3);
          setParam("modRelease", 0.4);
          setParam("oscAEnv", 0);
          setParam("oscBEnv", 0);
          setParam("oscCEnv", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset mod envelope + morph routing"
      >
        Reset
      </button>
    </div>
  );
}

function ModModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : bipolar ? fmtBi(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.5rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function ModEnvPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.envMod;
  const cA = bandShade(FC.tone, 0.42);
  const cD = bandShade(FC.tone, 0.55);
  const cS = bandShade(FC.tone, 0.68);
  const cR = bandShade(FC.tone, 0.78);
  const a = useFireCommandStore((s) => s.patch.modAttack) ?? 0.02;
  const d = useFireCommandStore((s) => s.patch.modDecay) ?? 0.5;
  const sus = useFireCommandStore((s) => s.patch.modSustain) ?? 0.3;
  const r = useFireCommandStore((s) => s.patch.modRelease) ?? 0.4;
  const envA = useFireCommandStore((s) => s.patch.oscAEnv) ?? 0;
  const envB = useFireCommandStore((s) => s.patch.oscBEnv) ?? 0;
  const envC = useFireCommandStore((s) => s.patch.oscCEnv) ?? 0;
  const morphAmt = Math.max(Math.abs(envA), Math.abs(envB), Math.abs(envC));
  const weaving = morphAmt > 0.04;
  const aN = Math.log(Math.max(0.001, a) / 0.001) / Math.log(3 / 0.001);
  const dN = Math.log(Math.max(0.005, d) / 0.005) / Math.log(3 / 0.005);
  const rN = Math.log(Math.max(0.005, r) / 0.005) / Math.log(4 / 0.005);

  return (
    <Section title="Mod Envelope → Morph" color={c} collapseKey="env.mod" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: weaving ? `${c}45` : `${c}28`,
          background: weaving
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: weaving ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.88) }}>
            Morph Weaver
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {weaving
                ? `A${fmtSec(a)} · →${Math.round(morphAmt * 100)} · S${Math.round(sus * 100)}`
                : `A${fmtSec(a)} · idle morph`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: weaving ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.35)",
              background: weaving ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${weaving ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: weaving ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {weaving ? "Scan" : "Still"}
          </div>
        </div>
      </div>

      <ModEnvStageViz />
      <ModCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <ModModMeter label="A" value={aN} color={cA} format={() => fmtSec(a)} />
        <ModModMeter label="D" value={dN} color={cD} format={() => fmtSec(d)} />
        <ModModMeter label="S" value={sus} color={cS} />
        <ModModMeter label="R" value={rN} color={cR} format={() => fmtSec(r)} />
        <ModModMeter label="→A" value={envA} color={FC.oscA} bipolar />
        <ModModMeter label="→B" value={envB} color={FC.oscB} bipolar />
        <ModModMeter label="→C" value={envC} color={FC.oscC} bipolar />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="modAttack" label="A" min={0.001} max={3} curve="log" format={fmtSec} def={0.02} size={44} color={cA} />
        <FParamKnob paramKey="modDecay" label="D" min={0.005} max={3} curve="log" format={fmtSec} def={0.5} size={44} color={cD} />
        <FParamKnob paramKey="modSustain" label="S" min={0} max={1} format={fmtPct} def={0.3} size={42} color={cS} />
        <FParamKnob paramKey="modRelease" label="R" min={0.005} max={4} curve="log" format={fmtSec} def={0.4} size={44} color={cR} />
        <FParamKnob paramKey="oscAEnv" label="A Morph" min={-1} max={1} bipolar format={fmtBi} def={0} size={46} color={FC.oscA} />
        <FParamKnob paramKey="oscBEnv" label="B Morph" min={-1} max={1} bipolar format={fmtBi} def={0} size={46} color={FC.oscB} />
        <FParamKnob paramKey="oscCEnv" label="C Depth" min={-1} max={1} bipolar format={fmtBi} def={0} size={46} color={FC.oscC} />
      </div>
      <ModLoopToggle />
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Multi-segment weaver — drag nodes · mid-segment cycles curves · destination lanes A/B/C morph.
      </div>
    </Section>
  );
}

function ModLoopToggle() {
  const loop = useFireCommandStore((s) => s.patch.modEnvLoop) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.envMod;
  return (
    <div className="mt-1.5 flex justify-center">
      <button
        type="button"
        onClick={() => setParam("modEnvLoop", !loop)}
        className="rounded-md border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
        style={{
          borderColor: loop ? `${c}88` : "rgba(255,255,255,0.12)",
          color: loop ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.45)",
          background: loop ? `${c}32` : "rgba(0,0,0,0.3)",
        }}
        title="Loop MSEG segments before release"
      >
        {loop ? "Loop On" : "Loop Off"}
      </button>
    </div>
  );
}

// ════════════════════ FENV — Cutoff Sweep ════════════════════

const FENV_CHARS = [
  { id: "flat", label: "Flat", a: 0.01, d: 0.3, s: 0.5, r: 0.3, amt: 0 },
  { id: "open", label: "Open", a: 0.005, d: 0.4, s: 0.35, r: 0.35, amt: 0.55 },
  { id: "pluck", label: "Pluck", a: 0.001, d: 0.18, s: 0.1, r: 0.2, amt: 0.7 },
  { id: "wah", label: "Wah", a: 0.08, d: 0.55, s: 0.45, r: 0.5, amt: 0.4 },
  { id: "close", label: "Close", a: 0.02, d: 0.5, s: 0.2, r: 0.4, amt: -0.45 },
  { id: "scream", label: "Scream", a: 0.002, d: 0.9, s: 0.05, r: 0.35, amt: 0.85 },
] as const;

function fenvNearSec(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.001, a) / Math.max(0.001, b))) < 0.55;
}

function FenvCharacterStrip() {
  const a = useFireCommandStore((s) => s.patch.filtAttack) ?? 0.01;
  const amt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.envFilt;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Sweep
      </span>
      {FENV_CHARS.map((p) => {
        const on =
          (p.id === "flat" && Math.abs(amt) < 0.04) ||
          (p.id !== "flat" && fenvNearSec(a, p.a) && Math.abs(amt - p.amt) < 0.12);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("filtAttack", p.a);
              setParam("filtDecay", p.d);
              setParam("filtSustain", p.s);
              setParam("filtRelease", p.r);
              setParam("filterEnvAmount", p.amt);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} · Env ${p.amt > 0 ? "+" : ""}${Math.round(p.amt * 100)}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FenvQuickActions() {
  const a = useFireCommandStore((s) => s.patch.filtAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.filtDecay) ?? 0.3;
  const sus = useFireCommandStore((s) => s.patch.filtSustain) ?? 0.5;
  const r = useFireCommandStore((s) => s.patch.filtRelease) ?? 0.3;
  const amt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ a: 0.01, d: 0.3, s: 0.5, r: 0.3, amt: 0.55 });
  const c = FC.envFilt;
  const flat = Math.abs(amt) < 0.03;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (flat) {
            setParam("filtAttack", savedRef.current.a);
            setParam("filtDecay", savedRef.current.d);
            setParam("filtSustain", savedRef.current.s);
            setParam("filtRelease", savedRef.current.r);
            setParam("filterEnvAmount", savedRef.current.amt);
          } else {
            savedRef.current = { a, d, s: sus, r, amt };
            setParam("filterEnvAmount", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: flat ? `${c}88` : `${c}66`,
          color: flat ? bandShade(FC.tone, 0.9) : bandShade(FC.tone, 0.75),
          background: flat ? `${c}40` : `${c}22`,
          boxShadow: flat ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={flat ? "Restore Env Amt sweep" : "Zero Env Amt (flat cutoff)"}
      >
        {flat ? "Sweep" : "Flat"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("filtAttack", 0.005);
          setParam("filtDecay", 0.35);
          setParam("filtSustain", 0.25);
          setParam("filtRelease", 0.3);
          setParam("filterEnvAmount", 0.6);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.tone, 0.82), background: `${c}1c` }}
        title="Classic opening filter bite"
      >
        Bite
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("filtAttack", 0.01);
          setParam("filtDecay", 0.3);
          setParam("filtSustain", 0.5);
          setParam("filtRelease", 0.3);
          setParam("filterEnvAmount", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset filter envelope defaults"
      >
        Reset
      </button>
    </div>
  );
}

function FenvModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : bipolar ? fmtBi(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function FiltEnvPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.envFilt;
  const cA = bandShade(FC.tone, 0.42);
  const cD = bandShade(FC.tone, 0.55);
  const cS = bandShade(FC.tone, 0.68);
  const cR = bandShade(FC.tone, 0.78);
  const cAmt = bandShade(FC.tone, 0.85);
  const a = useFireCommandStore((s) => s.patch.filtAttack) ?? 0.01;
  const d = useFireCommandStore((s) => s.patch.filtDecay) ?? 0.3;
  const sus = useFireCommandStore((s) => s.patch.filtSustain) ?? 0.5;
  const r = useFireCommandStore((s) => s.patch.filtRelease) ?? 0.3;
  const amt = useFireCommandStore((s) => s.patch.filterEnvAmount) ?? 0;
  const sweeping = Math.abs(amt) > 0.04;
  const aN = Math.log(Math.max(0.001, a) / 0.001) / Math.log(3 / 0.001);
  const dN = Math.log(Math.max(0.005, d) / 0.005) / Math.log(3 / 0.005);
  const rN = Math.log(Math.max(0.005, r) / 0.005) / Math.log(4 / 0.005);

  return (
    <Section title="Filter Envelope" color={c} collapseKey="env.filt" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: sweeping ? `${c}45` : `${c}28`,
          background: sweeping
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: sweeping ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.88) }}>
            Cutoff Sweep
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {sweeping
                ? `A${fmtSec(a)} · E${fmtBi(amt)} · S${Math.round(sus * 100)}`
                : `A${fmtSec(a)} · flat · S${Math.round(sus * 100)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FenvQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: sweeping ? bandShade(FC.tone, 0.92) : "rgba(255,255,255,0.35)",
              background: sweeping ? `${c}36` : "rgba(0,0,0,0.45)",
              border: `1px solid ${sweeping ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: sweeping ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {sweeping ? (amt > 0 ? "Open" : "Close") : "FLAT — ENVELOPE AMOUNT 0"}
          </div>
        </div>
      </div>

      <FiltEnvStageViz />
      <FenvCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-3 flex-wrap">
        <FenvModMeter label="A" value={aN} color={cA} format={() => fmtSec(a)} />
        <FenvModMeter label="D" value={dN} color={cD} format={() => fmtSec(d)} />
        <FenvModMeter label="S" value={sus} color={cS} />
        <FenvModMeter label="R" value={rN} color={cR} format={() => fmtSec(r)} />
        <FenvModMeter label="Amt" value={amt} color={cAmt} bipolar />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="filtAttack" label="A" min={0.001} max={3} curve="log" format={fmtSec} def={0.01} size={48} color={cA} />
        <FParamKnob paramKey="filtDecay" label="D" min={0.005} max={3} curve="log" format={fmtSec} def={0.3} size={48} color={cD} />
        <FParamKnob paramKey="filtSustain" label="S" min={0} max={1} format={fmtPct} def={0.5} size={44} color={cS} />
        <FParamKnob paramKey="filtRelease" label="R" min={0.005} max={4} curve="log" format={fmtSec} def={0.3} size={48} color={cR} />
        <FParamKnob paramKey="filterEnvAmount" label="Env→Cut" min={-1} max={1} bipolar format={fmtBi} def={0} size={46} color={cAmt} />
        <FParamKnob paramKey="filterEnvResoAmount" label="Env→Reso" min={-1} max={1} bipolar format={fmtBi} def={0} size={46} color={bandShade(FC.tone, 0.72)} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Dual sweep — cutoff and resonance depths; blade type shapes how the trajectory reads.
      </div>
    </Section>
  );
}

// ════════════════════ PLUCK — Vactrol Strike ════════════════════

const PLUCK_CHARS = [
  { id: "mute", label: "Mute", decay: 0.12, color: 0.15, vel: 0.7 },
  { id: "snap", label: "Snap", decay: 0.18, color: 0.55, vel: 1 },
  { id: "classic", label: "Classic", decay: 0.4, color: 0.7, vel: 1 },
  { id: "warm", label: "Warm", decay: 0.65, color: 0.85, vel: 0.85 },
  { id: "long", label: "Long", decay: 1.4, color: 0.6, vel: 0.9 },
  { id: "bright", label: "Bright", decay: 0.35, color: 1, vel: 1 },
] as const;

function pluckNearSec(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.05, a) / Math.max(0.05, b))) < 0.35;
}

function PluckCharacterStrip() {
  const decay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const color = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.pluck;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Strike
      </span>
      {PLUCK_CHARS.map((p) => {
        const on = pluckNearSec(decay, p.decay) && Math.abs(color - p.color) < 0.12;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("lpgOn", true);
              setParam("lpgDecay", p.decay);
              setParam("lpgColor", p.color);
              setParam("velAmount", p.vel);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.tone, 0.92),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} · ${Math.round(p.decay * 1000)}ms · C${Math.round(p.color * 100)}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PluckQuickActions() {
  const on = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const decay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const color = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ decay: 0.4, color: 0.7, vel: 1 });
  const c = FC.pluck;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (!on) savedRef.current = { decay, color, vel };
          setParam("lpgOn", !on);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: on ? `${c}88` : `${c}55`,
          color: on ? bandShade(FC.tone, 0.92) : bandShade(FC.tone, 0.75),
          background: on ? `${c}40` : `${c}18`,
          boxShadow: on ? `0 0 14px ${c}55` : `0 0 8px ${c}22`,
        }}
        title={on ? "Return loudness to amp ADSR" : "Arm vactrol LPG (replaces amp ADSR)"}
      >
        {on ? "Armed" : "Arm"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lpgOn", true);
          setParam("lpgDecay", 0.22);
          setParam("lpgColor", 0.75);
          setParam("velAmount", 1);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.tone, 0.85), background: `${c}1c` }}
        title="Snappy Buchla-style pluck"
      >
        Snap
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lpgDecay", 0.4);
          setParam("lpgColor", 0.7);
          setParam("velAmount", 1);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset pluck defaults"
      >
        Reset
      </button>
    </div>
  );
}

function PluckModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.75rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function PluckPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.pluck;
  const cDec = bandShade(FC.tone, 0.45);
  const cCol = bandShade(FC.tone, 0.65);
  const cVel = bandShade(FC.tone, 0.85);
  const on = useFireCommandStore((s) => s.patch.lpgOn) ?? false;
  const decay = useFireCommandStore((s) => s.patch.lpgDecay) ?? 0.4;
  const color = useFireCommandStore((s) => s.patch.lpgColor) ?? 0.7;
  const vel = useFireCommandStore((s) => s.patch.velAmount) ?? 1;
  const decN = Math.log(Math.max(0.05, decay) / 0.05) / Math.log(2.5 / 0.05);

  return (
    <Section
      title="Pluck Gate"
      color={c}
      collapseKey="pluck"
      chipHosted={chipHosted}
      defaultCollapsed
      right={<LpgToggle />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: on ? `${c}48` : `${c}28`,
          background: on
            ? `linear-gradient(105deg, ${c}2a 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: on ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}1a` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Tone
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.tone, 0.9) }}>
            Vactrol Strike
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {on
                ? `ARMED · ${fmtSec(decay)} · C${Math.round(color * 100)}`
                : "SLEEP — DSP DISABLED"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PluckQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: on ? bandShade(FC.tone, 0.94) : "rgba(255,255,255,0.35)",
              background: on ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${on ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: on ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {on ? "Armed" : "Sleep"}
          </div>
        </div>
      </div>

      <PluckStageViz />
      <PluckCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-4 flex-wrap">
        <PluckModMeter label="Decay" value={decN} color={cDec} format={() => fmtSec(decay)} />
        <PluckModMeter label="Color" value={color} color={cCol} />
        <PluckModMeter label="Vel" value={vel} color={cVel} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="lpgStrike" label="Strike" min={0} max={1} format={fmtPct} def={1} size={46} color={bandShade(FC.tone, 0.4)} />
        <FParamKnob paramKey="lpgDecay" label="Decay" min={0.05} max={2.5} curve="log" format={fmtSec} def={0.4} size={48} color={cDec} />
        <FParamKnob paramKey="lpgRing" label="Ring" min={0} max={1} format={fmtPct} def={1} size={44} color={bandShade(FC.tone, 0.55)} />
        <FParamKnob paramKey="lpgColor" label="Color" min={0} max={1} format={fmtPct} def={0.7} size={46} color={cCol} />
        <FParamKnob paramKey="lpgLeakage" label="Leak" min={0} max={1} format={fmtPct} def={0} size={40} color={bandShade(FC.tone, 0.7)} />
        <FParamKnob paramKey="lpgResoCouple" label="Reso" min={0} max={1} format={fmtPct} def={0} size={40} color={bandShade(FC.tone, 0.8)} />
        <FParamKnob paramKey="velAmount" label="Vel" min={0} max={1} format={fmtPct} def={1} size={42} color={cVel} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
        {(["fast", "classic", "slow", "aged", "sticky", "bright"] as const).map((m) => (
          <LpgModelChip key={m} model={m} />
        ))}
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Physical strike — models change vactrol timing; Reso couples into Spectral Blade.
      </div>
    </Section>
  );
}

function LpgModelChip({ model }: { model: "fast" | "classic" | "slow" | "aged" | "sticky" | "bright" }) {
  const cur = useFireCommandStore((s) => s.patch.lpgModel) ?? "classic";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.pluck;
  const on = cur === model;
  return (
    <button
      type="button"
      onClick={() => setParam("lpgModel", model)}
      className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{
        borderColor: on ? `${c}88` : "rgba(255,255,255,0.1)",
        color: on ? bandShade(FC.tone, 0.94) : "rgba(255,255,255,0.4)",
        background: on ? `${c}30` : "rgba(0,0,0,0.3)",
      }}
      title={`Vactrol model: ${model}`}
    >
      {model}
    </button>
  );
}

// ════════════════════ LFO 1 — Phase Aurora ════════════════════

const LFO1_WAVES: { id: LfoWave; label: string; tip: string }[] = [
  { id: "sine", label: "∿", tip: "Sine" },
  { id: "triangle", label: "△", tip: "Triangle" },
  { id: "sawtooth", label: "◺", tip: "Saw" },
  { id: "square", label: "⊓", tip: "Square" },
  { id: "sample-hold", label: "S&H", tip: "Sample & Hold" },
];

const LFO1_CHARS = [
  { id: "idle", label: "Idle", wave: "sine" as const, rate: 5, depth: 0, dest: "off" as const, a: 0, b: 0, c: 0 },
  { id: "trem", label: "Trem", wave: "sine" as const, rate: 5.5, depth: 0.35, dest: "volume" as const, a: 0, b: 0, c: 0 },
  { id: "vib", label: "Vib", wave: "sine" as const, rate: 5.2, depth: 0.22, dest: "pitch" as const, a: 0, b: 0, c: 0 },
  { id: "wah", label: "Wah", wave: "triangle" as const, rate: 1.2, depth: 0.55, dest: "filter" as const, a: 0, b: 0, c: 0 },
  { id: "scan", label: "Scan", wave: "sawtooth" as const, rate: 0.35, depth: 0.15, dest: "off" as const, a: 0.55, b: 0.2, c: 0 },
  { id: "chaos", label: "Chaos", wave: "sample-hold" as const, rate: 8, depth: 0.4, dest: "filter" as const, a: 0.3, b: -0.25, c: 0.15 },
] as const;

const LFO1_RATES = [
  { label: "0.2", v: 0.2 },
  { label: "1", v: 1 },
  { label: "3", v: 3 },
  { label: "5", v: 5 },
  { label: "8", v: 8 },
  { label: "16", v: 16 },
] as const;

function lfo1NearHz(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.05, a) / Math.max(0.05, b))) < 0.25;
}

function Lfo1WaveStrip() {
  const wave = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Wave
      </span>
      {LFO1_WAVES.map((o) => {
        const on = wave === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("lfo1Wave", o.id)}
            className="min-w-[2rem] rounded-md border px-2 py-0.5 text-[10px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.92),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={o.tip}
            aria-pressed={on}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo1DestStrip() {
  const dest = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo;
  const opts: { id: LfoDest; label: string }[] = [
    { id: "off", label: "Off" },
    { id: "pitch", label: "Pitch" },
    { id: "filter", label: "Filt" },
    { id: "volume", label: "Vol" },
    { id: "pan", label: "Pan" },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Quick Route
      </span>
      {opts.map((o) => {
        const on = dest === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("lfo1Dest", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.7)}99`,
                    background: `${bandShade(FC.mod, 0.7)}28`,
                    color: bandShade(FC.mod, 0.9),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo1CharacterStrip() {
  const depth = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const lfoA = useFireCommandStore((s) => s.patch.oscALfo) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Aura
      </span>
      {LFO1_CHARS.map((p) => {
        const on =
          (p.id === "idle" && depth < 0.02 && dest === "off" && Math.abs(lfoA) < 0.04) ||
          (p.id !== "idle" && dest === p.dest && Math.abs(depth - p.depth) < 0.1);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("lfo1Wave", p.wave);
              setParam("lfo1Rate", p.rate);
              setParam("lfo1Depth", p.depth);
              setParam("lfo1Dest", p.dest);
              setParam("oscALfo", p.a);
              setParam("oscBLfo", p.b);
              setParam("oscCLfo", p.c);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.9),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo1RateStrip() {
  const rate = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Rate
      </span>
      {LFO1_RATES.map((p) => {
        const on = lfo1NearHz(rate, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("lfo1Rate", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.5)}99`,
                    background: `${bandShade(FC.mod, 0.5)}28`,
                    color: bandShade(FC.mod, 0.88),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${p.v} Hz`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo1QuickActions() {
  const wave = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const depth = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const lfoA = useFireCommandStore((s) => s.patch.oscALfo) ?? 0;
  const lfoB = useFireCommandStore((s) => s.patch.oscBLfo) ?? 0;
  const lfoC = useFireCommandStore((s) => s.patch.oscCLfo) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ wave: "sine" as LfoWave, rate: 5, depth: 0.35, dest: "volume" as LfoDest, a: 0, b: 0, c: 0 });
  const c = FC.lfo;
  const idle = depth < 0.02 && dest === "off" && Math.abs(lfoA) < 0.02 && Math.abs(lfoB) < 0.02 && Math.abs(lfoC) < 0.02;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("lfo1Wave", savedRef.current.wave);
            setParam("lfo1Rate", savedRef.current.rate);
            setParam("lfo1Depth", savedRef.current.depth);
            setParam("lfo1Dest", savedRef.current.dest);
            setParam("oscALfo", savedRef.current.a);
            setParam("oscBLfo", savedRef.current.b);
            setParam("oscCLfo", savedRef.current.c);
          } else {
            savedRef.current = { wave, rate, depth, dest, a: lfoA, b: lfoB, c: lfoC };
            setParam("lfo1Depth", 0);
            setParam("lfo1Dest", "off");
            setParam("oscALfo", 0);
            setParam("oscBLfo", 0);
            setParam("oscCLfo", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.92) : bandShade(FC.mod, 0.75),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore aurora" : "Mute depth + dest + WT"}
      >
        {idle ? "Wake" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lfo1Wave", "sine");
          setParam("lfo1Rate", 5.5);
          setParam("lfo1Depth", 0.4);
          setParam("lfo1Dest", "filter");
          setParam("oscALfo", 0.25);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.85), background: `${c}1c` }}
        title="Musical filter aurora + light WT"
      >
        Glow
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lfo1Wave", "sine");
          setParam("lfo1Rate", 5);
          setParam("lfo1Depth", 0);
          setParam("lfo1Dest", "off");
          setParam("oscALfo", 0);
          setParam("oscBLfo", 0);
          setParam("oscCLfo", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset LFO 1 defaults"
      >
        Reset
      </button>
    </div>
  );
}

function Lfo1ModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : bipolar ? fmtBi(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.5rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function Lfo1Panel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.lfo;
  const cRate = bandShade(FC.mod, 0.45);
  const cDepth = bandShade(FC.mod, 0.65);
  const wave = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const depth = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const rateDisp = useFireCommandStore((s) => s.patch.lfo1RateDisplay) ?? "hz";
  const lfoA = useFireCommandStore((s) => s.patch.oscALfo) ?? 0;
  const lfoB = useFireCommandStore((s) => s.patch.oscBLfo) ?? 0;
  const lfoC = useFireCommandStore((s) => s.patch.oscCLfo) ?? 0;
  const matrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const setParam = useFireCommandStore((s) => s.setParam);
  const routes = countRoutesFrom(matrix, "lfo1");
  const live = depth > 0.02 || dest !== "off" || Math.abs(lfoA) > 0.04 || Math.abs(lfoB) > 0.04 || Math.abs(lfoC) > 0.04 || routes > 0;
  const rateN = Math.log(Math.max(0.05, rate) / 0.05) / Math.log(30 / 0.05);
  const syncLabel = rate >= 8 ? "1/32" : rate >= 4 ? "1/16" : rate >= 2 ? "1/8" : rate >= 1 ? "1/4" : rate >= 0.5 ? "1/2" : "1 bar";
  const rateReadout = rateDisp === "sync" ? syncLabel : `${rate.toFixed(2)}Hz`;

  return (
    <Section
      title="LFO 1"
      color={c}
      collapseKey="lfo.1"
      chipHosted={chipHosted}
      right={<FLfoWave paramKey="lfo1Wave" />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.9) }}>
            Phase Aurora
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${routes} routes · bipolar · GLOBAL · ${wave}`
                : `${wave} · idle`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="rounded-md border px-2 py-0.5 font-mono text-[9px] tabular-nums"
            style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.9), background: `${c}18` }}
            title="Cycle Hz ↔ sync division readout"
            onClick={() => setParam("lfo1RateDisplay", rateDisp === "hz" ? "sync" : "hz")}
          >
            {rateReadout}
          </button>
          <Lfo1QuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.94) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {live ? (dest === "off" ? "WT" : dest) : "Idle"}
          </div>
        </div>
      </div>

      <Lfo1StageViz />
      <Lfo1WaveStrip />
      <Lfo1DestStrip />
      <Lfo1CharacterStrip />
      <Lfo1RateStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <Lfo1ModMeter label="Rate" value={rateN} color={cRate} format={() => `${rate.toFixed(1)}`} />
        <Lfo1ModMeter label="Depth" value={depth} color={cDepth} />
        <Lfo1ModMeter label="OSC A" value={lfoA} color={FC.oscA} bipolar />
        <Lfo1ModMeter label="OSC B" value={lfoB} color={FC.oscB} bipolar />
        <Lfo1ModMeter label="OSC C" value={lfoC} color={FC.oscC} bipolar />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="lfo1Rate" label="Rate" min={0.05} max={30} curve="log" format={fmtHzRate} def={5} size={52} color={cRate} />
        <FParamKnob paramKey="lfo1Depth" label="Depth" min={0} max={1} format={fmtPct} def={0} size={52} color={cDepth} />
        <FParamKnob paramKey="oscALfo" label="OSC A MORPH" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={FC.oscA} />
        <FParamKnob paramKey="oscBLfo" label="OSC B MORPH" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={FC.oscB} />
        <FParamKnob paramKey="oscCLfo" label="OSC C MORPH" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={FC.oscC} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Quick Route writes Patch Loom slots · morph knobs are bipolar ± · click rate readout for Hz↔sync.
      </div>
    </Section>
  );
}

// ════════════════════ LFO 2 — Twin Orbit ════════════════════

const LFO2_WAVES: { id: LfoWave; label: string; tip: string }[] = [
  { id: "sine", label: "∿", tip: "Sine" },
  { id: "triangle", label: "△", tip: "Triangle" },
  { id: "sawtooth", label: "◺", tip: "Saw" },
  { id: "square", label: "⊓", tip: "Square" },
  { id: "sample-hold", label: "S&H", tip: "Sample & Hold" },
];

const LFO2_CHARS = [
  { id: "idle", label: "Idle", wave: "sine" as const, rate: 0.5, depth: 0, dest: "off" as const },
  { id: "drift", label: "Drift", wave: "sine" as const, rate: 0.15, depth: 0.45, dest: "pan" as const },
  { id: "crawl", label: "Crawl", wave: "triangle" as const, rate: 0.35, depth: 0.55, dest: "filter" as const },
  { id: "trem", label: "Trem", wave: "sine" as const, rate: 4.2, depth: 0.28, dest: "volume" as const },
  { id: "sway", label: "Sway", wave: "sine" as const, rate: 0.8, depth: 0.3, dest: "pitch" as const },
  { id: "glitch", label: "Glitch", wave: "sample-hold" as const, rate: 3.5, depth: 0.4, dest: "filter" as const },
] as const;

const LFO2_RATES = [
  { label: "0.1", v: 0.1 },
  { label: "0.5", v: 0.5 },
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "4", v: 4 },
  { label: "8", v: 8 },
] as const;

const LFO2_SYNC = [
  { label: "¼", r: 0.25 },
  { label: "½", r: 0.5 },
  { label: "1×", r: 1 },
  { label: "2×", r: 2 },
  { label: "4×", r: 4 },
] as const;

function lfo2NearHz(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.05, a) / Math.max(0.05, b))) < 0.25;
}

function lfo2NearRatio(rate2: number, rate1: number, ratio: number) {
  const target = Math.max(0.05, rate1) * ratio;
  return Math.abs(Math.log2(Math.max(0.05, rate2) / target)) < 0.12;
}

function Lfo2WaveStrip() {
  const wave = useFireCommandStore((s) => s.patch.lfo2Wave) ?? "sine";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo2;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
        Wave
      </span>
      {LFO2_WAVES.map((o) => {
        const on = wave === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("lfo2Wave", o.id)}
            className="min-w-[2rem] rounded-md border px-2 py-0.5 text-[10px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.94),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={o.tip}
            aria-pressed={on}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo2DestStrip() {
  const dest = useFireCommandStore((s) => s.patch.lfo2Dest) ?? "off";
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo2;
  const opts: { id: LfoDest; label: string }[] = [
    { id: "off", label: "Off" },
    { id: "pitch", label: "Pitch" },
    { id: "filter", label: "Filt" },
    { id: "volume", label: "Vol" },
    { id: "pan", label: "Pan" },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Quick Route
      </span>
      {opts.map((o) => {
        const on = dest === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("lfo2Dest", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.78)}99`,
                    background: `${bandShade(FC.mod, 0.78)}28`,
                    color: bandShade(FC.mod, 0.94),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo2RelationStrip() {
  const relation = (useFireCommandStore((s) => s.patch.lfo2Relation) ?? "independent") as Lfo2Relation;
  const phase = useFireCommandStore((s) => s.patch.lfo2PhaseOffset) ?? 90;
  const ratio = useFireCommandStore((s) => s.patch.lfo2Ratio) ?? 1;
  const drift = (useFireCommandStore((s) => s.patch.lfo2DriftMode) ?? "locked") as Lfo2DriftMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo2;
  const rels: { id: Lfo2Relation; label: string }[] = [
    { id: "independent", label: "Free" },
    { id: "mirror", label: "Mirror" },
    { id: "invert", label: "Invert" },
    { id: "phaseOffset", label: "Phase" },
    { id: "ratio", label: "Ratio" },
    { id: "followLag", label: "Lag" },
  ];
  const phases = [0, 45, 90, 180, 270];
  const ratios = [0.5, 1, 2, 0.25, 4];
  const drifts: { id: Lfo2DriftMode; label: string }[] = [
    { id: "locked", label: "Lock" },
    { id: "elastic", label: "Elastic" },
    { id: "wandering", label: "Wander" },
  ];
  return (
    <div className="mb-2 space-y-1.5 rounded-lg border px-2 py-1.5" style={{ borderColor: `${c}33`, background: `${c}0c` }}>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>
          Relation
        </span>
        {rels.map((o) => {
          const on = relation === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setParam("lfo2Relation", o.id)}
              className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
              style={
                on
                  ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.mod, 0.96), boxShadow: `0 0 10px ${c}44` }
                  : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {(relation === "phaseOffset" || relation === "mirror" || relation === "invert") && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>°</span>
          {phases.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setParam("lfo2PhaseOffset", p)}
              className="rounded-md border px-1.5 py-0.5 text-[9px] font-mono"
              style={
                Math.abs(phase - p) < 1
                  ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.mod, 0.94) }
                  : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }
              }
            >
              {p}°
            </button>
          ))}
        </div>
      )}
      {relation === "ratio" && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>×</span>
          {ratios.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setParam("lfo2Ratio", r)}
              className="rounded-md border px-1.5 py-0.5 text-[9px] font-mono"
              style={
                Math.abs(ratio - r) < 0.05
                  ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.mod, 0.94) }
                  : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }
              }
            >
              {r < 1 ? `1:${Math.round(1 / r)}` : `${r}:1`}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Drift</span>
        {drifts.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setParam("lfo2DriftMode", d.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={
              drift === d.id
                ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.mod, 0.94) }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }
            }
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Lfo2CharacterStrip() {
  const depth = useFireCommandStore((s) => s.patch.lfo2Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo2Dest) ?? "off";
  const rate = useFireCommandStore((s) => s.patch.lfo2Rate) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo2;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Orbit
      </span>
      {LFO2_CHARS.map((p) => {
        const on =
          (p.id === "idle" && depth < 0.02 && dest === "off") ||
          (p.id !== "idle" && dest === p.dest && Math.abs(depth - p.depth) < 0.1 && lfo2NearHz(rate, p.rate));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("lfo2Wave", p.wave);
              setParam("lfo2Rate", p.rate);
              setParam("lfo2Depth", p.depth);
              setParam("lfo2Dest", p.dest);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.94),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo2RateStrip() {
  const rate = useFireCommandStore((s) => s.patch.lfo2Rate) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo2;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Rate
      </span>
      {LFO2_RATES.map((p) => {
        const on = lfo2NearHz(rate, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("lfo2Rate", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.58)}99`,
                    background: `${bandShade(FC.mod, 0.58)}28`,
                    color: bandShade(FC.mod, 0.92),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${p.v} Hz`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo2SyncStrip() {
  const rate = useFireCommandStore((s) => s.patch.lfo2Rate) ?? 0.5;
  const rate1 = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.lfo2;
  const link = bandShade(FC.mod, 0.62);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        ×L1
      </span>
      {LFO2_SYNC.map((p) => {
        const on = lfo2NearRatio(rate, rate1, p.r);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              const next = Math.min(30, Math.max(0.05, rate1 * p.r));
              setParam("lfo2Rate", Math.round(next * 1000) / 1000);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${link}99`,
                    background: `${link}30`,
                    color: bandShade(FC.mod, 0.94),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`LFO2 = LFO1 × ${p.r}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function Lfo2QuickActions() {
  const wave = useFireCommandStore((s) => s.patch.lfo2Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo2Rate) ?? 0.5;
  const depth = useFireCommandStore((s) => s.patch.lfo2Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo2Dest) ?? "off";
  const wave1 = useFireCommandStore((s) => s.patch.lfo1Wave) ?? "sine";
  const rate1 = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const depth1 = useFireCommandStore((s) => s.patch.lfo1Depth) ?? 0;
  const dest1 = useFireCommandStore((s) => s.patch.lfo1Dest) ?? "off";
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ wave: "sine" as LfoWave, rate: 0.5, depth: 0.35, dest: "pan" as LfoDest });
  const c = FC.lfo2;
  const idle = depth < 0.02 && dest === "off";
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("lfo2Wave", savedRef.current.wave);
            setParam("lfo2Rate", savedRef.current.rate);
            setParam("lfo2Depth", savedRef.current.depth);
            setParam("lfo2Dest", savedRef.current.dest);
          } else {
            savedRef.current = { wave, rate, depth, dest };
            setParam("lfo2Depth", 0);
            setParam("lfo2Dest", "off");
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.94) : bandShade(FC.mod, 0.78),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore orbit" : "Mute depth + dest"}
      >
        {idle ? "Wake" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lfo2Relation", "ratio");
          setParam("lfo2Ratio", 0.5);
          setParam("lfo2PhaseOffset", 90);
          setParam("lfo2DriftMode", "locked");
          setParam("lfo2Wave", wave1);
          setParam("lfo2Rate", Math.min(30, Math.max(0.05, rate1 * 0.5)));
          setParam("lfo2Depth", Math.max(0.2, depth1 * 0.85 || 0.35));
          setParam("lfo2Dest", dest1 === "off" ? "pan" : dest1);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${FC.lfo}66`, color: bandShade(FC.mod, 0.88), background: `${FC.lfo}1c` }}
        title="Twin Orbit: lock relation ratio 1:2 to LFO 1"
      >
        Twin
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lfo2Wave", "sine");
          setParam("lfo2Rate", 0.2);
          setParam("lfo2Depth", 0.5);
          setParam("lfo2Dest", "pan");
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.88), background: `${c}1c` }}
        title="Slow stereo drift"
      >
        Drift
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("lfo2Wave", "sine");
          setParam("lfo2Rate", 0.5);
          setParam("lfo2Depth", 0);
          setParam("lfo2Dest", "off");
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset LFO 2 defaults"
      >
        Reset
      </button>
    </div>
  );
}

function Lfo2ModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.8rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function Lfo2Panel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.lfo2;
  const cRate = bandShade(FC.mod, 0.55);
  const cDepth = bandShade(FC.mod, 0.78);
  const cLink = bandShade(FC.mod, 0.62);
  const wave = useFireCommandStore((s) => s.patch.lfo2Wave) ?? "sine";
  const rate = useFireCommandStore((s) => s.patch.lfo2Rate) ?? 0.5;
  const depth = useFireCommandStore((s) => s.patch.lfo2Depth) ?? 0;
  const dest = useFireCommandStore((s) => s.patch.lfo2Dest) ?? "off";
  const rate1 = useFireCommandStore((s) => s.patch.lfo1Rate) ?? 5;
  const relation = (useFireCommandStore((s) => s.patch.lfo2Relation) ?? "independent") as Lfo2Relation;
  const matrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const routes = countRoutesFrom(matrix, "lfo2");
  const live = depth > 0.02 || dest !== "off" || relation !== "independent" || routes > 0;
  const rateN = Math.log(Math.max(0.05, rate) / 0.05) / Math.log(30 / 0.05);
  const linkRatio = rate / Math.max(0.05, rate1);
  const linked = relation !== "independent" || LFO2_SYNC.some((p) => lfo2NearRatio(rate, rate1, p.r));
  const relLabel = relation === "independent" ? "Free" : relation === "phaseOffset" ? "Phase" : relation === "followLag" ? "Lag" : relation;

  return (
    <Section
      title="LFO 2"
      color={c}
      collapseKey="lfo.2"
      chipHosted={chipHosted}
      right={<FLfoWave paramKey="lfo2Wave" />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.94) }}>
            Twin Orbit
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${relLabel} · ${routes} routes · GLOBAL`
                : `${wave} · idle`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Lfo2QuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.96) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {live ? (linked ? relLabel : dest === "off" ? "Live" : dest) : "Idle"}
          </div>
        </div>
      </div>

      <Lfo2StageViz />
      <Lfo2RelationStrip />
      <Lfo2WaveStrip />
      <Lfo2DestStrip />
      <Lfo2CharacterStrip />
      <Lfo2RateStrip />
      <Lfo2SyncStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <Lfo2ModMeter label="Rate" value={rateN} color={cRate} format={() => `${rate.toFixed(2)}`} />
        <Lfo2ModMeter label="Depth" value={depth} color={cDepth} />
        <Lfo2ModMeter
          label="×L1"
          value={linked ? 1 : Math.min(1, Math.abs(Math.log2(Math.max(0.05, linkRatio))) / 3)}
          color={cLink}
          format={() => (linked ? "sync" : `${linkRatio.toFixed(2)}×`)}
        />
        <Lfo2ModMeter label="Dest" value={dest === "off" ? 0 : 1} color={bandShade(FC.mod, 0.88)} format={() => (dest === "off" ? "—" : dest)} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="lfo2Rate" label="Rate" min={0.05} max={30} curve="log" format={fmtHzRate} def={0.5} size={56} color={cRate} />
        <FParamKnob paramKey="lfo2Depth" label="Depth" min={0} max={1} format={fmtPct} def={0} size={56} color={cDepth} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Twin Orbit relation is the centerpiece · Quick Route syncs Patch Loom · Twin presets lock ratio to LFO 1.
      </div>
    </Section>
  );
}

// ════════════════════ FM · Ring — Sideband Forge ════════════════════

const FM_CHARS = [
  { id: "idle", label: "Idle", amt: 0, ratio: 2, ba: 0, ring: 0, hz: 220, fb: 0 },
  { id: "soft", label: "Soft", amt: 0.22, ratio: 1, ba: 0, ring: 0, hz: 220, fb: 0.05 },
  { id: "bell", label: "Bell", amt: 0.55, ratio: 3.5, ba: 0, ring: 0, hz: 220, fb: 0.12 },
  { id: "brass", label: "Brass", amt: 0.42, ratio: 2, ba: 0.18, ring: 0, hz: 220, fb: 0.28 },
  { id: "clang", label: "Clang", amt: 0.78, ratio: 7, ba: 0.1, ring: 0, hz: 220, fb: 0.45 },
  { id: "cross", label: "Cross", amt: 0.15, ratio: 2, ba: 0.72, ring: 0, hz: 220, fb: 0.1 },
  { id: "ring", label: "Ring", amt: 0.08, ratio: 1, ba: 0, ring: 0.62, hz: 440, fb: 0 },
  { id: "swarm", label: "Swarm", amt: 0.38, ratio: 1.5, ba: 0.2, ring: 0.35, hz: 110, fb: 0.2 },
] as const;

const FM_RATIOS = [
  { label: "½", v: 0.5 },
  { label: "1", v: 1 },
  { label: "1½", v: 1.5 },
  { label: "2", v: 2 },
  { label: "3½", v: 3.5 },
  { label: "4", v: 4 },
  { label: "5", v: 5 },
  { label: "7", v: 7 },
] as const;

const FM_RING_HZ = [
  { label: "55", v: 55 },
  { label: "110", v: 110 },
  { label: "220", v: 220 },
  { label: "440", v: 440 },
  { label: "880", v: 880 },
  { label: "1.7k", v: 1760 },
] as const;

function fmNearRatio(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.5, a) / Math.max(0.5, b))) < 0.08;
}

function fmNearHz(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(20, a) / Math.max(20, b))) < 0.12;
}

function FmCharacterStrip() {
  const amt = useFireCommandStore((s) => s.patch.fmAmount) ?? 0;
  const ratio = useFireCommandStore((s) => s.patch.fmRatio) ?? 2;
  const ba = useFireCommandStore((s) => s.patch.fmBtoA) ?? 0;
  const ring = useFireCommandStore((s) => s.patch.ringAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.fm;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Forge
      </span>
      {FM_CHARS.map((p) => {
        const on =
          (p.id === "idle" && amt < 0.02 && ba < 0.02 && ring < 0.02) ||
          (p.id !== "idle" &&
            Math.abs(amt - p.amt) < 0.1 &&
            fmNearRatio(ratio, p.ratio) &&
            Math.abs(ba - p.ba) < 0.12 &&
            Math.abs(ring - p.ring) < 0.12);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("fmAmount", p.amt);
              setParam("fmRatio", p.ratio);
              setParam("fmBtoA", p.ba);
              setParam("ringAmount", p.ring);
              setParam("ringFreq", p.hz);
              setParam("fmFeedback", p.fb);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.94),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FmRatioStrip() {
  const ratio = useFireCommandStore((s) => s.patch.fmRatio) ?? 2;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.fm;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Ratio
      </span>
      {FM_RATIOS.map((p) => {
        const on = fmNearRatio(ratio, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("fmRatio", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.68)}99`,
                    background: `${bandShade(FC.mod, 0.68)}28`,
                    color: bandShade(FC.mod, 0.94),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${p.v}×`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FmRingHzStrip() {
  const hz = useFireCommandStore((s) => s.patch.ringFreq) ?? 220;
  const ring = useFireCommandStore((s) => s.patch.ringAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.fm;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Ring Hz
      </span>
      {FM_RING_HZ.map((p) => {
        const on = ring > 0.02 && fmNearHz(hz, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setParam("ringFreq", p.v);
              if (ring < 0.05) setParam("ringAmount", 0.45);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.88)}99`,
                    background: `${bandShade(FC.mod, 0.88)}28`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${p.v} Hz`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FmQuickActions() {
  const amt = useFireCommandStore((s) => s.patch.fmAmount) ?? 0;
  const ratio = useFireCommandStore((s) => s.patch.fmRatio) ?? 2;
  const ba = useFireCommandStore((s) => s.patch.fmBtoA) ?? 0;
  const ring = useFireCommandStore((s) => s.patch.ringAmount) ?? 0;
  const hz = useFireCommandStore((s) => s.patch.ringFreq) ?? 220;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ amt: 0.45, ratio: 3.5, ba: 0, ring: 0, hz: 220 });
  const c = FC.fm;
  const idle = amt < 0.02 && ba < 0.02 && ring < 0.02;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("fmAmount", savedRef.current.amt);
            setParam("fmRatio", savedRef.current.ratio);
            setParam("fmBtoA", savedRef.current.ba);
            setParam("ringAmount", savedRef.current.ring);
            setParam("ringFreq", savedRef.current.hz);
          } else {
            savedRef.current = { amt, ratio, ba, ring, hz };
            setParam("fmAmount", 0);
            setParam("fmBtoA", 0);
            setParam("ringAmount", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.94) : bandShade(FC.mod, 0.78),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore forge" : "Mute FM / B→A / Ring"}
      >
        {idle ? "Wake" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("fmAmount", 0.55);
          setParam("fmRatio", 3.5);
          setParam("fmBtoA", 0);
          setParam("ringAmount", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.88), background: `${c}1c` }}
        title="Classic FM bell"
      >
        Bell
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("fmAmount", 0.4);
          setParam("fmRatio", 2);
          setParam("fmBtoA", 0.35);
          setParam("ringAmount", 0.25);
          setParam("ringFreq", 220);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.88), background: `${c}1c` }}
        title="FM + cross + light ring"
      >
        Forge
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("fmAmount", 0);
          setParam("fmRatio", 2);
          setParam("fmBtoA", 0);
          setParam("ringAmount", 0);
          setParam("ringFreq", 220);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset FM · Ring defaults"
      >
        Reset
      </button>
    </div>
  );
}

function FmModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function FmPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.fm;
  const cAmt = bandShade(FC.mod, 0.5);
  const cRatio = bandShade(FC.mod, 0.68);
  const cBa = bandShade(FC.mod, 0.78);
  const cRing = bandShade(FC.mod, 0.88);
  const cFb = bandShade(FC.mod, 0.42);
  const amt = useFireCommandStore((s) => s.patch.fmAmount) ?? 0;
  const ratio = useFireCommandStore((s) => s.patch.fmRatio) ?? 2;
  const ba = useFireCommandStore((s) => s.patch.fmBtoA) ?? 0;
  const ring = useFireCommandStore((s) => s.patch.ringAmount) ?? 0;
  const hz = useFireCommandStore((s) => s.patch.ringFreq) ?? 220;
  const fb = useFireCommandStore((s) => s.patch.fmFeedback) ?? 0;
  const ringMode = (useFireCommandStore((s) => s.patch.ringMode) ?? "ratio") as RingMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = amt > 0.02 || ba > 0.02 || ring > 0.02 || fb > 0.02;
  const ratioN = Math.log(Math.max(0.5, ratio) / 0.5) / Math.log(12 / 0.5);
  const hzN = Math.log(Math.max(20, hz) / 20) / Math.log(4000 / 20);

  return (
    <Section title="FM · Ring" color={c} collapseKey="fm" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.94) }}>
            Sideband Forge
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `FM ${Math.round(amt * 100)} · Ring ${Math.round(ring * 100)} · Fbk ${Math.round(fb * 100)} · ${ringMode}`
                : `A/B/C/Noise · idle`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FmQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.96) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {live ? (ring > amt && ring > ba ? "Ring" : ba > amt ? "Cross" : "FM") : "Idle"}
          </div>
        </div>
      </div>

      <FmStageViz />
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Ring</span>
        {(["ratio", "fixed"] as RingMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setParam("ringMode", m)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase"
            style={
              ringMode === m
                ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.mod, 0.94) }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
          >
            {m}
          </button>
        ))}
        <span className="mx-2 text-[9px] text-white/35">Carrier A · Mod B/C · Noise bed</span>
      </div>
      <FmCharacterStrip />
      <FmRatioStrip />
      <FmRingHzStrip />

      <div className="mb-2 flex items-center justify-center gap-2 flex-wrap">
        <FmModMeter label="FM" value={amt} color={cAmt} />
        <FmModMeter label="Ratio" value={ratioN} color={cRatio} format={() => `${ratio.toFixed(2)}×`} />
        <FmModMeter label="B→A" value={ba} color={cBa} />
        <FmModMeter label="Ring" value={ring} color={cRing} />
        <FmModMeter label="Fbk" value={fb} color={cFb} />
        <FmModMeter label={ringMode === "ratio" ? "×" : "Hz"} value={hzN} color={bandShade(FC.mod, 0.72)} format={() => fmtHz(hz)} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="fmAmount" label="FM Amt" min={0} max={1} format={fmtPct} def={0} size={50} color={cAmt} />
        <FParamKnob paramKey="fmRatio" label="Ratio" min={0.5} max={12} curve="log" format={fmtRatio} def={2} size={50} color={cRatio} />
        <FParamKnob paramKey="fmFeedback" label="FM Fbk" min={0} max={1} format={fmtPct} def={0} size={46} color={cFb} />
        <FParamKnob paramKey="fmBtoA" label="B→A" min={0} max={1} format={fmtPct} def={0} size={46} color={cBa} />
        <FParamKnob paramKey="ringAmount" label="Ring" min={0} max={1} format={fmtPct} def={0} size={46} color={cRing} />
        <FParamKnob paramKey="ringFreq" label={ringMode === "ratio" ? "Ring ×" : "Ring Hz"} min={20} max={4000} curve="log" format={fmtHz} def={220} size={46} color={bandShade(FC.mod, 0.72)} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Sideband Forge — FM / Ring / Feedback are distinct · characters set ratio+feedback relationships · classic 2-op here, lattice in rack.
      </div>
    </Section>
  );
}

// ════════════════════ FM Rack · Vector — Vector Lattice ════════════════════

const RACK_ALG_NAMES = ["Ser·1", "Ser·2", "Ser·3", "Ser·4", "Par·1", "Par·2", "Par·3", "Par·4"] as const;

const RACK_CHARS = [
  {
    id: "idle",
    label: "Idle",
    engine: "classic" as const,
    alg: 0,
    fb: 0,
    ops: [1, 0.7, 0.5, 0.35] as const,
    ratios: [1, 2, 3] as const,
    vr: 0,
    vd: 0,
  },
  {
    id: "stack",
    label: "Stack",
    engine: "ops4" as const,
    alg: 3,
    fb: 0.15,
    ops: [1, 0.85, 0.65, 0.45] as const,
    ratios: [1, 2, 4] as const,
    vr: 0,
    vd: 0,
  },
  {
    id: "parallel",
    label: "Para",
    engine: "ops4" as const,
    alg: 5,
    fb: 0,
    ops: [1, 0.6, 0.55, 0.5] as const,
    ratios: [1, 1.5, 2] as const,
    vr: 0.2,
    vd: 0.25,
  },
  {
    id: "growl",
    label: "Growl",
    engine: "ops4" as const,
    alg: 1,
    fb: 0.65,
    ops: [1, 0.9, 0.4, 0.2] as const,
    ratios: [1.5, 2, 3] as const,
    vr: 0,
    vd: 0,
  },
  {
    id: "bell",
    label: "Bell",
    engine: "ops4" as const,
    alg: 0,
    fb: 0,
    ops: [1, 0.7, 0.35, 0.15] as const,
    ratios: [3.5, 7, 2] as const,
    vr: 0,
    vd: 0.1,
  },
  {
    id: "vector",
    label: "Vector",
    engine: "ops4" as const,
    alg: 4,
    fb: 0.1,
    ops: [1, 0.75, 0.6, 0.4] as const,
    ratios: [1, 2, 3] as const,
    vr: 0.55,
    vd: 0.7,
  },
  {
    id: "metal",
    label: "Metal",
    engine: "ops4" as const,
    alg: 6,
    fb: 0.35,
    ops: [0.9, 0.8, 0.7, 0.55] as const,
    ratios: [2.7, 5.1, 7] as const,
    vr: 0.3,
    vd: 0.4,
  },
] as const;

function rackNear(a: number, b: number, tol = 0.12) {
  return Math.abs(a - b) < tol;
}

function FmRackAlgStrip() {
  const alg = Math.round(useFireCommandStore((s) => s.patch.fmAlg) ?? 0);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.fmRack;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Alg
      </span>
      {RACK_ALG_NAMES.map((name, i) => {
        const on = alg === i;
        return (
          <button
            key={name}
            type="button"
            onClick={() => {
              setParam("fmAlg", i);
              setParam("fmEngine", "ops4");
            }}
            className="rounded-md border px-1.5 py-0.5 text-[8px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
            }
            title={`Algorithm ${i}: ${name}`}
          >
            {i}
          </button>
        );
      })}
    </div>
  );
}

function FmRackCharacterStrip() {
  const engine = useFireCommandStore((s) => s.patch.fmEngine) ?? "classic";
  const alg = Math.round(useFireCommandStore((s) => s.patch.fmAlg) ?? 0);
  const fb = useFireCommandStore((s) => s.patch.fmFeedback) ?? 0;
  const vd = useFireCommandStore((s) => s.patch.vectorDepth) ?? 0;
  const op2 = useFireCommandStore((s) => s.patch.fmOp2Level) ?? 0.7;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.fmRack;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Lattice
      </span>
      {RACK_CHARS.map((p) => {
        const on =
          (p.id === "idle" && engine === "classic" && fb < 0.02 && vd < 0.02) ||
          (p.id !== "idle" && engine === "ops4" && alg === p.alg && rackNear(fb, p.fb) && rackNear(vd, p.vd) && rackNear(op2, p.ops[1]));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("fmEngine", p.engine);
              setParam("fmAlg", p.alg);
              setParam("fmFeedback", p.fb);
              setParam("fmOp1Level", p.ops[0]);
              setParam("fmOp2Level", p.ops[1]);
              setParam("fmOp3Level", p.ops[2]);
              setParam("fmOp4Level", p.ops[3]);
              setParam("fmOp2Ratio", p.ratios[0]);
              setParam("fmOp3Ratio", p.ratios[1]);
              setParam("fmOp4Ratio", p.ratios[2]);
              setParam("vectorRate", p.vr);
              setParam("vectorDepth", p.vd);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function FmRackQuickActions() {
  const engine = useFireCommandStore((s) => s.patch.fmEngine) ?? "classic";
  const alg = useFireCommandStore((s) => s.patch.fmAlg) ?? 0;
  const fb = useFireCommandStore((s) => s.patch.fmFeedback) ?? 0;
  const op1 = useFireCommandStore((s) => s.patch.fmOp1Level) ?? 1;
  const op2 = useFireCommandStore((s) => s.patch.fmOp2Level) ?? 0.7;
  const op3 = useFireCommandStore((s) => s.patch.fmOp3Level) ?? 0.5;
  const op4 = useFireCommandStore((s) => s.patch.fmOp4Level) ?? 0.35;
  const r2 = useFireCommandStore((s) => s.patch.fmOp2Ratio) ?? 1;
  const r3 = useFireCommandStore((s) => s.patch.fmOp3Ratio) ?? 2;
  const r4 = useFireCommandStore((s) => s.patch.fmOp4Ratio) ?? 3;
  const vr = useFireCommandStore((s) => s.patch.vectorRate) ?? 0;
  const vd = useFireCommandStore((s) => s.patch.vectorDepth) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({
    engine: "ops4" as FmEngineMode,
    alg: 3,
    fb: 0.2,
    ops: [1, 0.8, 0.6, 0.4],
    ratios: [1, 2, 3],
    vr: 0.4,
    vd: 0.5,
  });
  const c = FC.fmRack;
  const idle = engine === "classic" || (fb < 0.02 && vd < 0.02 && op2 < 0.05 && op3 < 0.05 && op4 < 0.05);
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            const s = savedRef.current;
            setParam("fmEngine", s.engine);
            setParam("fmAlg", s.alg);
            setParam("fmFeedback", s.fb);
            setParam("fmOp1Level", s.ops[0]!);
            setParam("fmOp2Level", s.ops[1]!);
            setParam("fmOp3Level", s.ops[2]!);
            setParam("fmOp4Level", s.ops[3]!);
            setParam("fmOp2Ratio", s.ratios[0]!);
            setParam("fmOp3Ratio", s.ratios[1]!);
            setParam("fmOp4Ratio", s.ratios[2]!);
            setParam("vectorRate", s.vr);
            setParam("vectorDepth", s.vd);
          } else {
            savedRef.current = {
              engine: engine as FmEngineMode,
              alg,
              fb,
              ops: [op1, op2, op3, op4],
              ratios: [r2, r3, r4],
              vr,
              vd,
            };
            setParam("fmEngine", "classic");
            setParam("fmFeedback", 0);
            setParam("vectorDepth", 0);
            setParam("vectorRate", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.96) : bandShade(FC.mod, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore lattice" : "Park rack (2-op)"}
      >
        {idle ? "Arm" : "Park"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("fmEngine", "ops4");
          setParam("fmAlg", 3);
          setParam("fmFeedback", 0.2);
          setParam("fmOp1Level", 1);
          setParam("fmOp2Level", 0.85);
          setParam("fmOp3Level", 0.65);
          setParam("fmOp4Level", 0.45);
          setParam("fmOp2Ratio", 1);
          setParam("fmOp3Ratio", 2);
          setParam("fmOp4Ratio", 4);
          setParam("vectorRate", 0.35);
          setParam("vectorDepth", 0.45);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.9), background: `${c}1c` }}
        title="Arm 4-op cascade + light vector"
      >
        Lattice
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("fmEngine", "classic");
          setParam("fmAlg", 0);
          setParam("fmFeedback", 0);
          setParam("fmOp1Level", 1);
          setParam("fmOp2Level", 0.7);
          setParam("fmOp3Level", 0.5);
          setParam("fmOp4Level", 0.35);
          setParam("fmOp2Ratio", 1);
          setParam("fmOp3Ratio", 2);
          setParam("fmOp4Ratio", 3);
          setParam("vectorRate", 0);
          setParam("vectorDepth", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset FM Rack defaults"
      >
        Reset
      </button>
    </div>
  );
}

function FmRackModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.2rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function FmRackPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.fmRack;
  const cAlg = bandShade(FC.mod, 0.55);
  const cFb = bandShade(FC.mod, 0.72);
  const cVec = bandShade(FC.mod, 0.82);
  const cOps = [
    bandShade(FC.mod, 0.95),
    bandShade(FC.mod, 0.75),
    bandShade(FC.mod, 0.58),
    bandShade(FC.mod, 0.42),
  ] as const;
  const engine = useFireCommandStore((s) => s.patch.fmEngine) ?? "classic";
  const alg = Math.round(useFireCommandStore((s) => s.patch.fmAlg) ?? 0);
  const fb = useFireCommandStore((s) => s.patch.fmFeedback) ?? 0;
  const op1 = useFireCommandStore((s) => s.patch.fmOp1Level) ?? 1;
  const op2 = useFireCommandStore((s) => s.patch.fmOp2Level) ?? 0.7;
  const op3 = useFireCommandStore((s) => s.patch.fmOp3Level) ?? 0.5;
  const op4 = useFireCommandStore((s) => s.patch.fmOp4Level) ?? 0.35;
  const r2 = useFireCommandStore((s) => s.patch.fmOp2Ratio) ?? 1;
  const r3 = useFireCommandStore((s) => s.patch.fmOp3Ratio) ?? 2;
  const r4 = useFireCommandStore((s) => s.patch.fmOp4Ratio) ?? 3;
  const vr = useFireCommandStore((s) => s.patch.vectorRate) ?? 0;
  const vd = useFireCommandStore((s) => s.patch.vectorDepth) ?? 0;
  const ops4 = engine === "ops4";
  const live = ops4 && (fb > 0.02 || vd > 0.02 || op2 > 0.08 || op3 > 0.08 || op4 > 0.08);

  return (
    <Section
      title="FM Rack · Vector"
      color={c}
      collapseKey="fm.rack"
      chipHosted={chipHosted}
      right={
        <FSeg<FmEngineMode>
          paramKey="fmEngine"
          color={c}
          options={[
            { id: "classic", label: "2-op" },
            { id: "ops4", label: "4-op" },
          ]}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.96) }}>
            Vector Lattice
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {ops4
                ? `ALG ${alg} · ${RACK_ALG_NAMES[alg] ?? "?"} · FB${Math.round(fb * 100)} · V${Math.round(vd * 100)}`
                : "2-op classic · rack standby"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FmRackQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {ops4 ? (live ? "4-OP" : "Armed") : "2-OP"}
          </div>
        </div>
      </div>

      <FmRackStageViz />
      <FmRackAlgStrip />
      <FmRackCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-1.5 flex-wrap">
        <FmRackModMeter label="Alg" value={alg / 7} color={cAlg} format={() => String(alg)} />
        <FmRackModMeter label="Fbk" value={fb} color={cFb} />
        <FmRackModMeter label="VecR" value={vr} color={cVec} />
        <FmRackModMeter label="VecD" value={vd} color={bandShade(FC.mod, 0.88)} />
        <FmRackModMeter label="Op1" value={op1} color={cOps[0]} />
        <FmRackModMeter label="Op2" value={op2} color={cOps[1]} />
        <FmRackModMeter label="Op3" value={op3} color={cOps[2]} />
        <FmRackModMeter label="Op4" value={op4} color={cOps[3]} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap mb-1">
        <FParamKnob paramKey="fmAlg" label="Alg" min={0} max={7} integer format={fmtInt} def={0} size={44} color={cAlg} />
        <FParamKnob paramKey="fmFeedback" label="Fbk" min={0} max={1} format={fmtPct} def={0} size={44} color={cFb} />
        <FParamKnob paramKey="vectorRate" label="Vec Rate" min={0} max={1} format={fmtPct} def={0} size={44} color={cVec} />
        <FParamKnob paramKey="vectorDepth" label="Vec Depth" min={0} max={1} format={fmtPct} def={0} size={44} color={bandShade(FC.mod, 0.88)} />
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap mb-1">
        <FParamKnob paramKey="fmOp1Level" label="Op1" min={0} max={1} format={fmtPct} def={1} size={42} color={cOps[0]} />
        <FParamKnob paramKey="fmOp2Level" label="Op2" min={0} max={1} format={fmtPct} def={0.7} size={42} color={cOps[1]} />
        <FParamKnob paramKey="fmOp3Level" label="Op3" min={0} max={1} format={fmtPct} def={0.5} size={42} color={cOps[2]} />
        <FParamKnob paramKey="fmOp4Level" label="Op4" min={0} max={1} format={fmtPct} def={0.35} size={42} color={cOps[3]} />
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="fmOp2Ratio" label="R2" min={0.25} max={16} curve="log" format={fmtRatio} def={1} size={42} color={cOps[1]} />
        <FParamKnob paramKey="fmOp3Ratio" label="R3" min={0.25} max={16} curve="log" format={fmtRatio} def={2} size={42} color={cOps[2]} />
        <FParamKnob paramKey="fmOp4Ratio" label="R4" min={0.25} max={16} curve="log" format={fmtRatio} def={3} size={42} color={cOps[3]} />
        <div className="flex flex-col items-center gap-0.5 min-w-[2.8rem] pb-1" title={`R2 ${r2.toFixed(2)} · R3 ${r3.toFixed(2)} · R4 ${r4.toFixed(2)}`}>
          <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>Ratios</div>
          <div className="font-mono text-[9px] tabular-nums" style={{ color: bandShade(FC.mod, 0.9) }}>
            {r2.toFixed(1)}/{r3.toFixed(1)}/{r4.toFixed(1)}
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        4-op lattice — pad Vec Rate↔/Depth↕, drag orbs Level↕/Ratio↔, scrub Feedback, double-click cycles alg (arms 4-op). Needs FM module on.
      </div>
    </Section>
  );
}

// ════════════════════ Pitch · Glide — Glide Horizon ════════════════════

const PITCH_CHARS = [
  { id: "idle", label: "Idle", amt: 0, time: 0.2, glide: 0, mono: false },
  { id: "pluck", label: "Pluck", amt: 12, time: 0.08, glide: 0, mono: false },
  { id: "dive", label: "Dive", amt: -24, time: 0.35, glide: 0, mono: false },
  { id: "rise", label: "Rise", amt: 24, time: 0.45, glide: 0, mono: false },
  { id: "slide", label: "Slide", amt: 0, time: 0.2, glide: 0.45, mono: true },
  { id: "acid", label: "Acid", amt: -12, time: 0.12, glide: 0.55, mono: true },
  { id: "scream", label: "Scream", amt: 36, time: 0.25, glide: 0.2, mono: true },
] as const;

const PITCH_AMTS = [
  { label: "-24", v: -24 },
  { label: "-12", v: -12 },
  { label: "-7", v: -7 },
  { label: "0", v: 0 },
  { label: "+7", v: 7 },
  { label: "+12", v: 12 },
  { label: "+24", v: 24 },
] as const;

const PITCH_TIMES = [
  { label: "30ms", v: 0.03 },
  { label: "80ms", v: 0.08 },
  { label: "200ms", v: 0.2 },
  { label: "500ms", v: 0.5 },
  { label: "1s", v: 1 },
] as const;

function pitchNearAmt(a: number, b: number) {
  return Math.abs(a - b) < 1.5;
}

function pitchNearTime(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.01, a) / Math.max(0.01, b))) < 0.2;
}

function PitchCharacterStrip() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount) ?? 0;
  const glide = useFireCommandStore((s) => s.patch.glide) ?? 0;
  const mono = useFireCommandStore((s) => s.patch.mono) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.pitch;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Horizon
      </span>
      {PITCH_CHARS.map((p) => {
        const on =
          (p.id === "idle" && Math.abs(amt) < 1 && glide < 0.02) ||
          (p.id !== "idle" && pitchNearAmt(amt, p.amt) && Math.abs(glide - p.glide) < 0.12 && mono === p.mono);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("pitchEnvAmount", p.amt);
              setParam("pitchEnvTime", p.time);
              setParam("glide", p.glide);
              setParam("mono", p.mono);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PitchAmtStrip() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.pitch;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Env
      </span>
      {PITCH_AMTS.map((p) => {
        const on = pitchNearAmt(amt, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("pitchEnvAmount", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, p.v >= 0 ? 0.85 : 0.45)}99`,
                    background: `${bandShade(FC.mod, p.v >= 0 ? 0.85 : 0.45)}28`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${p.v} semitones`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PitchTimeStrip() {
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime) ?? 0.2;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.pitch;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Time
      </span>
      {PITCH_TIMES.map((p) => {
        const on = pitchNearTime(time, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("pitchEnvTime", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.mod, 0.78)}99`,
                    background: `${bandShade(FC.mod, 0.78)}28`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtSec(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PitchQuickActions() {
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount) ?? 0;
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime) ?? 0.2;
  const glide = useFireCommandStore((s) => s.patch.glide) ?? 0;
  const mono = useFireCommandStore((s) => s.patch.mono) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ amt: 12, time: 0.12, glide: 0.4, mono: true });
  const c = FC.pitch;
  const idle = Math.abs(amt) < 1 && glide < 0.02;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("pitchEnvAmount", savedRef.current.amt);
            setParam("pitchEnvTime", savedRef.current.time);
            setParam("glide", savedRef.current.glide);
            setParam("mono", savedRef.current.mono);
          } else {
            savedRef.current = { amt, time, glide, mono };
            setParam("pitchEnvAmount", 0);
            setParam("glide", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.96) : bandShade(FC.mod, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore horizon" : "Mute env + glide"}
      >
        {idle ? "Wake" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => setParam("mono", !mono)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{
          borderColor: mono ? `${c}88` : `${c}44`,
          color: mono ? bandShade(FC.mod, 0.96) : `${c}bb`,
          background: mono ? `${c}38` : `${c}14`,
          boxShadow: mono ? `0 0 12px ${c}44` : undefined,
        }}
        title="Toggle mono (needed for portamento)"
      >
        {mono ? "Mono" : "Poly"}
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("mono", true);
          setParam("glide", 0.5);
          setParam("pitchEnvAmount", -12);
          setParam("pitchEnvTime", 0.1);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.9), background: `${c}1c` }}
        title="Acid mono slide + dive"
      >
        Acid
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("pitchEnvAmount", 0);
          setParam("pitchEnvTime", 0.2);
          setParam("glide", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset pitch env + glide"
      >
        Reset
      </button>
    </div>
  );
}

function PitchModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function PitchPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.pitch;
  const cAmt = bandShade(FC.mod, 0.62);
  const cTime = bandShade(FC.mod, 0.78);
  const cGlide = bandShade(FC.mod, 0.88);
  const amt = useFireCommandStore((s) => s.patch.pitchEnvAmount) ?? 0;
  const time = useFireCommandStore((s) => s.patch.pitchEnvTime) ?? 0.2;
  const glide = useFireCommandStore((s) => s.patch.glide) ?? 0;
  const mono = useFireCommandStore((s) => s.patch.mono) ?? false;
  const glideMode = (useFireCommandStore((s) => s.patch.glideMode) ?? "legato") as GlideMode;
  const glideCurve = (useFireCommandStore((s) => s.patch.glideCurve) ?? "exp") as GlideCurve;
  const glideRateMode = (useFireCommandStore((s) => s.patch.glideRateMode) ?? "time") as GlideRateMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = Math.abs(amt) > 0.5 || glide > 0.02;
  const timeN = Math.log(Math.max(0.01, time) / 0.01) / Math.log(2 / 0.01);
  const amtN = amt / 48;

  return (
    <Section
      title="Pitch · Glide"
      color={c}
      collapseKey="pitch"
      chipHosted={chipHosted}
      right={
        <Seg<"poly" | "mono">
          value={mono ? "mono" : "poly"}
          onChange={(v) => useFireCommandStore.getState().setParam("mono", v === "mono")}
          options={[
            { id: "poly", label: "Poly" },
            { id: "mono", label: "Mono" },
          ]}
          color={c}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.96) }}>
            Glide Horizon
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `env ${amt > 0 ? "+" : ""}${Math.round(amt)}st · glide ${glideMode}/${glideCurve} · ${mono ? "mono" : "poly"}`
                : `${mono ? "mono" : "poly"} · idle`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PitchQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {live ? (glide > Math.abs(amt) / 48 ? "Glide" : amt > 0 ? "Rise" : "Dive") : mono ? "Mono" : "Poly"}
          </div>
        </div>
      </div>

      <PitchStageViz />
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Glide</span>
        {([
          { id: "legato" as GlideMode, label: "Legato" },
          { id: "always" as GlideMode, label: "Always" },
        ]).map((o) => (
          <button key={o.id} type="button" onClick={() => setParam("glideMode", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={glideMode === o.id ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.mod, 0.96) } : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
          >{o.label}</button>
        ))}
        <span className="mx-1 text-white/25">·</span>
        {([
          { id: "linear" as GlideCurve, label: "Lin" },
          { id: "exp" as GlideCurve, label: "Exp" },
          { id: "s" as GlideCurve, label: "S" },
        ]).map((o) => (
          <button key={o.id} type="button" onClick={() => setParam("glideCurve", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={glideCurve === o.id ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.mod, 0.96) } : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
          >{o.label}</button>
        ))}
        <span className="mx-1 text-white/25">·</span>
        {([
          { id: "time" as GlideRateMode, label: "Time" },
          { id: "rate" as GlideRateMode, label: "Rate" },
        ]).map((o) => (
          <button key={o.id} type="button" onClick={() => setParam("glideRateMode", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={glideRateMode === o.id ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.mod, 0.96) } : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
          >{o.label}</button>
        ))}
      </div>
      <PitchCharacterStrip />
      <PitchAmtStrip />
      <PitchTimeStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <PitchModMeter label="Env" value={amtN} color={cAmt} bipolar format={() => fmtSemi(amt)} />
        <PitchModMeter label="Time" value={timeN} color={cTime} format={() => fmtSec(time)} />
        <PitchModMeter label="Glide" value={glide} color={cGlide} format={() => (glide < 0.01 ? "off" : fmtSec(glide))} />
        <PitchModMeter label="Mode" value={mono ? 1 : 0} color={bandShade(FC.mod, 0.7)} format={() => (mono ? "mono" : "poly")} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="pitchEnvAmount" label="Pitch Env" min={-48} max={48} integer bipolar format={fmtSemi} def={0} size={52} color={cAmt} />
        <FParamKnob paramKey="pitchEnvTime" label="Env Time" min={0.01} max={2} curve="log" format={fmtSec} def={0.2} size={52} color={cTime} />
        <FParamKnob paramKey="glide" label="Glide" min={0} max={1} format={fmtSec} def={0} size={52} color={cGlide} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Pitch envelope = vertical leap · Glide = path between notes (legato/always · lin/exp/S · time/rate).
      </div>
    </Section>
  );
}

// ════════════════════ Live — Stage Pulse ════════════════════

function LivePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = LIVE_C;
  const mono = useFireCommandStore((s) => s.patch.mono);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const octave = useFireCommandStore((s) => s.octave);
  const masterGain = useFireCommandStore((s) => s.patch.masterGain) ?? 0.72;
  const voiceSteal = (useFireCommandStore((s) => s.patch.voiceSteal) ?? "oldest") as VoiceStealPolicy;
  const ceaseMode = (useFireCommandStore((s) => s.patch.ceaseMode) ?? "notes") as CeaseMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  const [voices, setVoices] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < 120) return;
      last = now;
      let n = 0;
      try {
        n = activeFireEngine().getActiveVoiceCount();
      } catch {
        n = 0;
      }
      setVoices((prev) => (prev === n ? prev : n));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ceaseFire = () => {
    useFireSequencerStore.getState().stop();
    const st = useFireCommandStore.getState();
    st.panic();
    if (ceaseMode === "notesTails" || ceaseMode === "total") {
      st.setParam("delayMix", 0);
      st.setParam("reverbMix", 0);
      st.setParam("delayFreeze", false);
      st.setParam("reverbFreeze", false);
    }
    if (ceaseMode === "total") {
      const eng = getEngine();
      eng.setFireMasterMix(0, true);
      window.setTimeout(() => {
        const mix = useFireSequencerStore.getState().mixer.master;
        eng.setFireMasterMix(mix.level, mix.mute);
      }, 120);
    }
  };

  const stageScenes: { id: string; label: string; mono: boolean; voices: number; fx: boolean; master: number }[] = [
    { id: "solo", label: "Solo", mono: true, voices: 6, fx: false, master: 0.75 },
    { id: "duo", label: "Duo", mono: false, voices: 8, fx: true, master: 0.72 },
    { id: "band", label: "Band", mono: false, voices: 12, fx: true, master: 0.72 },
    { id: "orch", label: "Orchestra", mono: false, voices: 24, fx: true, master: 0.7 },
    { id: "raw", label: "Raw", mono: false, voices: 12, fx: false, master: 0.8 },
  ];

  const steals: { id: VoiceStealPolicy; label: string }[] = [
    { id: "oldest", label: "Oldest" },
    { id: "newest", label: "Newest" },
    { id: "lowest", label: "Lowest" },
    { id: "highest", label: "Highest" },
  ];
  const ceases: { id: CeaseMode; label: string }[] = [
    { id: "notes", label: "Notes" },
    { id: "notesTails", label: "Notes+Tails" },
    { id: "total", label: "Total" },
  ];

  const live = voices > 0 || fxOn;

  return (
    <Section
      title="Live Controls"
      color={c}
      collapseKey="performance"
      chipHosted={chipHosted}
      statusLine={`${mono ? "Mono" : "Poly"} · ${voices}/${maxVoices} · out ${Math.round(masterGain * 100)}%`}
      right={
        <span className="font-mono text-[12px] font-black" style={{ color: LIVE_C_GLOW }}>
          {voices}/{maxVoices}
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mix
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: LIVE_C_GLOW }}>
            Stage Pulse
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {mono ? "MONO" : "POLY"} · N {voices}/{maxVoices} · {fxOn ? "FX" : "DRY"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={ceaseFire}
            className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ borderColor: `${LIVE_C_HOT}88`, color: LIVE_C_GLOW, background: `${LIVE_C_HOT}28` }}
            title={`Cease Fire · mode ${ceaseMode}`}
          >
            Cease Fire
          </button>
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? LIVE_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
            }}
          >
            {voices}/{maxVoices}
          </div>
        </div>
      </div>

      <LiveStageViz />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Stage</span>
        {stageScenes.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("mono", p.mono);
              setMaxVoices(p.voices);
              useFireCommandStore.getState().setRouteThroughFx(p.fx);
              setParam("masterGain", p.master);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)", background: "rgba(0,0,0,0.3)" }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>POLYPHONY</span>
        {[6, 8, 12, 16, 24].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setMaxVoices(v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums"
            style={
              maxVoices === v
                ? { borderColor: `${c}99`, background: `${c}33`, color: LIVE_C_GLOW }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
            title="Note polyphony (not Unison)"
          >
            {v}
          </button>
        ))}
        <span className="ml-2 text-[8px] text-white/30">vs Unison · Voice Choir</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Steal</span>
        {steals.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setParam("voiceSteal", s.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={
              voiceSteal === s.id
                ? { borderColor: `${c}99`, background: `${c}33`, color: LIVE_C_GLOW }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Cease</span>
        {ceases.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setParam("ceaseMode", s.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={
              ceaseMode === s.id
                ? { borderColor: `${LIVE_C_HOT}99`, background: `${LIVE_C_HOT}28`, color: LIVE_C_GLOW }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <LiveOctaveStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <LiveMeter label="N/LIMIT" value={voices / Math.max(1, maxVoices)} color={LIVE_C_HOT} format={() => `${voices}/${maxVoices}`} />
        <LiveMeter label="Mode" value={mono ? 0.35 : 1} color={mono ? LIVE_C_HOT : LIVE_C_POLY} format={() => (mono ? "MONO" : "POLY")} />
        <LiveMeter label="FX" value={fxOn ? 1 : 0} color={LIVE_C_FX} format={() => (fxOn ? "ON" : "DRY")} />
        <LiveMeter label="Master" value={masterGain / 1.2} color={LIVE_C_MST} format={() => `${Math.round(masterGain * 100)}%`} />
      </div>

      <div className="flex flex-wrap items-center justify-evenly gap-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: `${c}88` }}>Octave</span>
          <Stepper onClick={() => useFireCommandStore.getState().shiftOctave(-1)}>−</Stepper>
          <div className="w-6 text-center font-mono text-sm" style={{ color: LIVE_C_GLOW }}>{octave}</div>
          <Stepper onClick={() => useFireCommandStore.getState().shiftOctave(1)}>+</Stepper>
        </div>
        <Seg<"poly" | "mono">
          value={mono ? "mono" : "poly"}
          onChange={(v) => setParam("mono", v === "mono")}
          options={[{ id: "poly", label: "Poly" }, { id: "mono", label: "Mono" }]}
          color={c}
        />
        <FParamKnob paramKey="masterGain" label="Master" min={0} max={1.2} format={fmtPct} def={0.72} size={48} color={LIVE_C_MST} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        POLYPHONY = note count · Unison is Voice Choir. Cease Fire respects Notes / Notes+Tails / Total.
      </div>
    </Section>
  );
}

// ════════════════════ Scope — Lumen Trace ════════════════════

function ScopePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = SCOPE_C;
  const displayGain = useFireCommandStore((s) => s.patch.scopeDisplayGain) ?? 1;
  const pathOn = useFireCommandStore((s) => s.patch.pathScope !== false);
  const [viz, setViz] = useState<ScopeVizState>(() => ({
    ...SCOPE_DEFAULT_VIZ,
    freeze: typeof window !== "undefined" ? readScopeFreeze() : false,
  }));
  const [view, setView] = useState<ScopeViewMode>("all");
  const [mixView, setMixView] = useState<"oscilloscope" | "spectrum" | "vectorscope">("oscilloscope");
  const voicesRef = useRef<HTMLSpanElement>(null);
  const grRef = useRef<HTMLSpanElement>(null);
  const onVizChange = useCallback((patch: Partial<ScopeVizState>) => {
    setViz((v) => {
      const next = { ...v, ...patch };
      if (typeof patch.freeze === "boolean") writeScopeFreeze(patch.freeze);
      return next;
    });
  }, []);
  useEffect(() => {
    const onFreeze = (e: Event) => {
      const detail = (e as CustomEvent<{ freeze: boolean }>).detail;
      if (typeof detail?.freeze === "boolean") {
        setViz((v) => (v.freeze === detail.freeze ? v : { ...v, freeze: detail.freeze }));
      }
    };
    window.addEventListener(SCOPE_FREEZE_EVENT, onFreeze);
    return () => window.removeEventListener(SCOPE_FREEZE_EVENT, onFreeze);
  }, []);
  const live = pathOn && displayGain > 0.02;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 100) return;
      last = t;
      try {
        const e = getEngine();
        const n = activeFireEngine().getActiveVoiceCount?.() ?? 0;
        const gr = e.getFireLimiterReduction();
        if (voicesRef.current) voicesRef.current.textContent = `VOICES ${n}`;
        if (grRef.current) grRef.current.textContent = `LIM GR −${fmtGrDb(gr)}`;
      } catch { /* */ }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Section
      title="Output · Scope"
      color={c}
      collapseKey="output"
      chipHosted={chipHosted}
      defaultCollapsed
      statusLine={!pathOn ? "Bypassed" : `On · display ${Math.round(displayGain * 100)}%`}
      right={<ScopeVoiceBadge />}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mix
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: SCOPE_C_GLOW }}>
            Lumen Trace
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!pathOn ? "bypass" : `${mixView} · ×${viz.zoom.toFixed(1)}`}
            </span>
          </div>
        </div>
        <ScopeQuickActions viz={viz} onVizChange={onVizChange} />
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px]" style={{ color: `${c}aa` }}>
        <span ref={voicesRef}>VOICES 0</span>
        <span className="text-white/25">·</span>
        <span>PEAK</span>
        <span className="text-white/25">·</span>
        <span ref={grRef}>LIM GR −0.0</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>View</span>
        {([
          { id: "oscilloscope" as const, label: "Osc" },
          { id: "spectrum" as const, label: "FFT" },
          { id: "vectorscope" as const, label: "Vector" },
        ]).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setMixView(o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={
              mixView === o.id
                ? { borderColor: `${c}99`, background: `${c}33`, color: SCOPE_C_GLOW }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className={pathOn ? undefined : "opacity-40 grayscale"}>
        {(view === "all" || view === "master" || mixView !== "oscilloscope") && (
          <ScopeStageViz viz={viz} onVizChange={onVizChange} mode={mixView} />
        )}
        <ScopeViewStrip mode={view} onChange={setView} />
        <ScopeZoomStrip zoom={viz.zoom} onChange={(z) => onVizChange({ zoom: z })} />
        {(view === "all" || view === "oscs") && mixView === "oscilloscope" && (
          <div className="mb-2 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="rounded-xl border p-2" style={{ borderColor: `${SCOPE_C_A}33`, background: `linear-gradient(180deg, ${SCOPE_C_A}14, rgba(0,0,0,0.45))` }}>
              <ScopeOscWave group="a" color={SCOPE_C_A} />
            </div>
            <div className="rounded-xl border p-2" style={{ borderColor: `${SCOPE_C_B}33`, background: `linear-gradient(180deg, ${SCOPE_C_B}14, rgba(0,0,0,0.45))` }}>
              <ScopeOscWave group="b" color={SCOPE_C_B} />
            </div>
            <div className="rounded-xl border p-2" style={{ borderColor: `${SCOPE_C_C}33`, background: `linear-gradient(180deg, ${SCOPE_C_C}14, rgba(0,0,0,0.45))` }}>
              <ScopeOscWave group="c" color={SCOPE_C_C} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-evenly gap-1">
        <FParamKnob paramKey="scopeDisplayGain" label="Display" min={0} max={2} format={fmtPct} def={1} size={56} color={SCOPE_C_MST} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Display Gain scales the phosphor only — not Fire bus output.
      </div>
    </Section>
  );
}

// ════════════════════ Air — Sky Shelf ════════════════════

function AirPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = AIR_C;
  const low = useFireCommandStore((s) => s.patch.airLow) ?? 0;
  const high = useFireCommandStore((s) => s.patch.airHigh) ?? 0;
  const amt = useFireCommandStore((s) => s.patch.airAmount) ?? 0;
  const arch = (useFireCommandStore((s) => s.patch.airArch) ?? "dual") as AirArch;
  const msMode = useFireCommandStore((s) => s.patch.airMsMode) ?? false;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["air"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const m = airMetrics(enabled ? low : 0, enabled ? high : 0, enabled ? amt : 0);
  const live = enabled && amt > 0.03 && (Math.abs(low) > 0.04 || Math.abs(high) > 0.04);

  return (
    <Section
      title="Air"
      color={c}
      collapseKey="air"
      chipHosted={chipHosted}
      defaultCollapsed
      statusLine={!enabled ? "Off" : live ? `On · ${arch} · ${Math.round(amt * 100)}%` : `On · ${arch}`}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mix
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: AIR_C_GLOW }}>
            Sky Shelf
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled ? "bypass" : `${arch}${msMode ? " · M/S" : ""} · A${Math.round(amt * 100)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <AirQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? AIR_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
            }}
            title="Architecture"
          >
            {!enabled ? "Bypass" : arch === "tilt" ? "Tilt" : "Dual"}
          </div>
        </div>
      </div>

      <AirStageViz />
      <AirCharacterStrip />
      <AirAmountStrip />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Arch</span>
        {([
          { id: "dual" as AirArch, label: "Dual" },
          { id: "tilt" as AirArch, label: "Tilt" },
        ]).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("airArch", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={
              arch === o.id
                ? { borderColor: `${c}99`, background: `${c}33`, color: AIR_C_GLOW }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setParam("airMsMode", !msMode)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={
            msMode
              ? { borderColor: `${c}99`, background: `${c}33`, color: AIR_C_GLOW }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
          }
          title="M/S air: high sides / low mid"
        >
          M/S {msMode ? "On" : "Off"}
        </button>
      </div>

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <AirMeter label="Low" value={low} bipolar color={AIR_C_LOW} format={() => `${m.lowDb >= 0 ? "+" : ""}${m.lowDb.toFixed(1)}`} />
        <AirMeter label="High" value={high} bipolar color={AIR_C_HIGH} format={() => `${m.highDb >= 0 ? "+" : ""}${m.highDb.toFixed(1)}`} />
        <AirMeter label="Amt" value={amt} color={AIR_C_AMT} format={() => `${Math.round(amt * 100)}%`} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="airLow" label="Low" min={-1} max={1} bipolar format={fmtBi} def={0} size={48} color={AIR_C_LOW} />
        <FParamKnob paramKey="airHigh" label="High" min={-1} max={1} bipolar format={fmtBi} def={0} size={48} color={AIR_C_HIGH} />
        <FParamKnob paramKey="airAmount" label="Amount" min={0} max={1} format={fmtPct} def={0} size={52} color={AIR_C_AMT} />
        <FParamKnob paramKey="airInGain" label="In" min={0} max={2} format={fmtPct} def={1} size={44} color={c} />
        <FParamKnob paramKey="airOutGain" label="Out" min={0} max={2} format={fmtPct} def={1} size={44} color={c} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Architecture: Dual shelf vs Tilt · optional M/S · In/Out trims.
      </div>
    </Section>
  );
}

// ════════════════════ Glue — Press Anvil ════════════════════

function GluePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = GLUE_C;
  const punch = useFireCommandStore((s) => s.patch.punch) ?? 0;
  const glueMode = (useFireCommandStore((s) => s.patch.glueMode) ?? "glue") as GlueMode;
  const useAdv = useFireCommandStore((s) => s.patch.glueUseAdvanced) ?? false;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["glue"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const m = glueMetrics(enabled ? punch : 0, glueMode);
  const [liveGr, setLiveGr] = useState(0);
  const live = enabled && punch > 0.03;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 80) return;
      last = t;
      try {
        const gr = activeFireEngine().getPunchReduction();
        setLiveGr((prev) => (Math.abs(prev - gr) < 0.05 ? prev : gr));
      } catch {
        setLiveGr(0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const grDb = Math.max(0, -liveGr) || m.grDb;

  return (
    <Section
      title="Glue"
      color={c}
      collapseKey="glue"
      chipHosted={chipHosted}
      defaultCollapsed
      statusLine={!enabled ? "Off" : `On · ${Math.round(punch * 100)}% · GR −${grDb.toFixed(1)}`}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mix
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: GLUE_C_GLOW }}>
            Press Anvil
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : `${glueMode} · ${Math.round(punch * 100)}% · GR −${grDb.toFixed(1)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <GlueQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? GLUE_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
            }}
          >
            {!enabled ? "Bypass" : glueStageLabel(punch)}
          </div>
        </div>
      </div>

      <GlueStageViz />
      <GlueCharacterStrip />
      <GlueModeStrip />
      <GlueSnapStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <GlueMeter label="Punch" value={punch} color={c} format={() => `${Math.round(punch * 100)}%`} />
        <GlueMeter label="Thr" value={Math.min(1, Math.abs(m.threshDb) / 30)} color={GLUE_C_THR} format={() => `${m.threshDb.toFixed(0)}`} />
        <GlueMeter label="Ratio" value={Math.min(1, (m.ratio - 1) / 7)} color={GLUE_C_RAT} format={() => `${m.ratio.toFixed(1)}:1`} />
        <GlueMeter label="GR" value={Math.min(1, grDb / 14)} color={GLUE_C_GR} format={() => `−${grDb.toFixed(1)}`} />
        <GlueMeter label="Mkup" value={Math.min(1, m.makeupDb / 2.3)} color={GLUE_C_MK} format={() => `+${m.makeupDb.toFixed(1)}`} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="punch" label="Punch" min={0} max={1} format={fmtPct} def={0} size={52} color={c} />
        <FParamKnob paramKey="glueInGain" label="In" min={0} max={2} format={fmtPct} def={1} size={44} color={GLUE_C_THR} />
        <FParamKnob paramKey="glueOutGain" label="Out" min={0} max={2} format={fmtPct} def={1} size={44} color={GLUE_C_MK} />
        <FParamKnob paramKey="glueMix" label="Mix" min={0} max={1} format={fmtPct} def={1} size={44} color={GLUE_C_RAT} />
      </div>

      <div className="mt-2 mb-1 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setParam("glueUseAdvanced", !useAdv)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
          style={
            useAdv
              ? { borderColor: `${c}99`, background: `${c}33`, color: GLUE_C_GLOW }
              : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }
          }
        >
          Advanced {useAdv ? "On" : "Off"}
        </button>
      </div>

      {useAdv && (
        <div className="flex items-end justify-evenly gap-1 flex-wrap">
          <FParamKnob paramKey="glueThreshold" label="Thresh" min={-40} max={0} format={(v) => `${v.toFixed(0)}dB`} def={-18} size={44} color={GLUE_C_THR} />
          <FParamKnob paramKey="glueRatio" label="Ratio" min={1} max={20} format={(v) => `${v.toFixed(1)}:1`} def={3} size={44} color={GLUE_C_RAT} />
          <FParamKnob paramKey="glueAttack" label="Atk" min={0.001} max={0.1} curve="log" format={fmtSec} def={0.008} size={44} color={c} />
          <FParamKnob paramKey="glueRelease" label="Rel" min={0.02} max={1} curve="log" format={fmtSec} def={0.18} size={44} color={c} />
          <FParamKnob paramKey="glueKnee" label="Knee" min={0} max={20} format={(v) => v.toFixed(1)} def={6} size={44} color={c} />
          <FParamKnob paramKey="glueMakeup" label="Makeup" min={0.5} max={2} format={fmtPct} def={1} size={44} color={GLUE_C_MK} />
        </div>
      )}

      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Live GR from punch compressor · Punch macro maps via punchMacroToGlue · Advanced overrides when engaged.
      </div>
    </Section>
  );
}

// ════════════════════ Width — Side Horizon ════════════════════

function WidthPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = WIDTH_C;
  const w = useFireCommandStore((s) => s.patch.stereoWidth) ?? 1;
  const monoBelow = useFireCommandStore((s) => s.patch.monoBelow) ?? 0;
  const mech = (useFireCommandStore((s) => s.patch.widthMechanism) ?? "ms") as WidthMechanism;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["width"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const { mid, side, corr } = widthMidSide(enabled ? w : 1);
  const live = enabled && Math.abs(w - 1) > 0.03;
  const legend = widthScaleLegend(enabled ? w : 1);

  const mechs: { id: WidthMechanism; label: string }[] = [
    { id: "ms", label: "M/S" },
    { id: "microdelay", label: "μDelay" },
    { id: "decorrelate", label: "Decor" },
  ];

  return (
    <Section
      title="Width"
      color={c}
      collapseKey="width"
      chipHosted={chipHosted}
      defaultCollapsed
      statusLine={!enabled ? "Off" : `On · ${legend}`}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mix
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: WIDTH_C_GLOW }}>
            Side Horizon
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled ? "bypass · unity" : `${legend} · ${mech}${monoBelow > 20 ? ` · mono<${Math.round(monoBelow)}` : ""}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <WidthQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? WIDTH_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
            }}
          >
            {!enabled ? "Bypass" : widthStageLabel(w)}
          </div>
        </div>
      </div>

      <WidthStageViz />
      <WidthCharacterStrip />
      <WidthSnapStrip />

      <div className="mb-2 text-center font-mono text-[11px]" style={{ color: WIDTH_C_GLOW }}>
        {legend}
        <span className="ml-2 text-white/35">0% mono · 100% original · 140% extreme</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Mech</span>
        {mechs.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setParam("widthMechanism", o.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
            style={
              mech === o.id
                ? { borderColor: `${c}99`, background: `${c}33`, color: WIDTH_C_GLOW }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
            }
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setParam("stereoWidth", 0)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={{ borderColor: `${c}55`, color: WIDTH_C_GLOW, background: `${c}1c` }}
          title="Mono audition"
        >
          Mono
        </button>
        <button
          type="button"
          onClick={() => setParam("stereoWidth", 1)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={{ borderColor: `${c}55`, color: WIDTH_C_GLOW, background: `${c}1c` }}
          title="Mid / unity audition"
        >
          Mid
        </button>
      </div>

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <WidthMeter label="Width" value={w / WIDTH_MAX} color={c} format={() => `${Math.round(w * 100)}%`} />
        <WidthMeter label="Mid" value={mid} color={WIDTH_C_MID} format={() => `${Math.round(mid * 100)}`} />
        <WidthMeter label="Side" value={side} color={WIDTH_C_SIDE} format={() => `${Math.round(side * 100)}`} />
        <WidthMeter label="Corr" value={corr} color={WIDTH_C_CORR} format={() => corr.toFixed(2)} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="stereoWidth" label="Stereo" min={0} max={1.4} format={fmtPct} def={1} size={52} color={c} />
        <FParamKnob paramKey="monoBelow" label="Mono<" min={0} max={400} format={(v) => (v < 20 ? "off" : `${Math.round(v)}Hz`)} def={0} size={48} color={WIDTH_C_MID} />
        <FParamKnob paramKey="widthInGain" label="In" min={0} max={2} format={fmtPct} def={1} size={44} color={c} />
        <FParamKnob paramKey="widthOutGain" label="Out" min={0} max={2} format={fmtPct} def={1} size={44} color={c} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Scale legend + mono-below HPF · mechanism strip · Mono/Mid audition.
      </div>
    </Section>
  );
}

// ════════════════════ Mix Rack Chrome + group headers ════════════════════

function MixGroupHeader({ title }: { title: string }) {
  const c = FC_BAND.mix;
  return (
    <div className="mt-2 mb-1 flex items-center gap-2 px-0.5">
      <span className="text-[9px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
        {title}
      </span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${c}44, transparent)` }} />
    </div>
  );
}

function PerfGroupHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const c = FC_BAND.perf;
  return (
    <div className="mt-2 mb-1 flex items-center gap-2 px-0.5">
      <span className="text-[9px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
        {title}
      </span>
      <span className="text-[9px] font-semibold tracking-wide" style={{ color: `${c}66` }}>
        {subtitle}
      </span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${c}44, transparent)` }} />
    </div>
  );
}

function MixRackChrome() {
  const c = FC_BAND.mix;
  const delta = useFireCommandStore((s) => s.patch.mixDeltaAudition) ?? false;
  const scene = (useFireCommandStore((s) => s.patch.masterChainScene) ?? "glueAirWidth") as MasterChainScene;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div
      className="mb-2 flex flex-wrap items-center justify-center gap-2 rounded-xl border px-2 py-2"
      style={{ borderColor: `${c}33`, background: `linear-gradient(180deg, ${c}14, transparent)` }}
    >
      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>Mix Rack</span>
      <button
        type="button"
        onClick={() => setParam("mixDeltaAudition", !delta)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase"
        style={
          delta
            ? { borderColor: `${c}99`, background: `${c}40`, color: bandShade(FC_BAND.mix, 0.98) }
            : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }
        }
        title="Audition processed − bypass delta on mastering stages"
      >
        Δ Delta
      </button>
      <span className="mx-1 text-white/20">·</span>
      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Chain</span>
      {MASTER_CHAIN_SCENES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setParam("masterChainScene", s.id)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={
            scene === s.id
              ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC_BAND.mix, 0.95) }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
          }
          title={s.order}
        >
          {s.label}
        </button>
      ))}
      <span className="w-full text-center text-[9px] text-white/30">{MIX_CHAIN_COPY}</span>
    </div>
  );
}

// ════════════════════ FX Rack Chrome (Clarity Phase 1 + 6 scenes) ════════════════════

function FxRackChrome() {
  const c = FC.fx;
  const quality = (useFireCommandStore((s) => s.patch.fxQuality) ?? "live") as FxQuality;
  const lowProtect = (useFireCommandStore((s) => s.patch.lowProtect) ?? "off") as LowProtect;
  const delta = useFireCommandStore((s) => s.patch.fxDeltaAudition) ?? false;
  const scene = useFireCommandStore((s) => s.patch.fxRoutingScene) ?? "serial";
  const shared = useFireCommandStore((s) => s.patch.fxSharedMod) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const qualities: FxQuality[] = ["eco", "live", "high", "render"];
  const protects: LowProtect[] = ["off", "80", "120", "200", "custom"];
  const scenes: { id: typeof scene; label: string }[] = [
    { id: "serial", label: "Serial" },
    { id: "driveAgePrint", label: "Print" },
    { id: "spaceCascade", label: "Space" },
    { id: "spectralTail", label: "SpecTail" },
  ];
  const applyScene = (id: typeof scene) => {
    setParam("fxRoutingScene", id);
    const en = { ...(useFireCommandStore.getState().patch.moduleEnable ?? {}) };
    if (id === "serial") {
      setParam("fxSharedMod", false);
      setParam("spectralWetOnly", false);
    } else if (id === "driveAgePrint") {
      setParam("drive", Math.max(0.35, useFireCommandStore.getState().patch.drive));
      setParam("ageMacro", 0.45);
      setParam("fxSharedMod", false);
    } else if (id === "spaceCascade") {
      setParam("delayMix", Math.max(0.25, useFireCommandStore.getState().patch.delayMix));
      setParam("reverbMix", Math.max(0.3, useFireCommandStore.getState().patch.reverbMix));
      setParam("delayCascadeMode", "dub");
    } else if (id === "spectralTail") {
      setParam("spectralWetOnly", true);
      setParam("spectralMode", "smear");
      setParam("spectralMix", 0.55);
      setParam("reverbMix", Math.max(0.25, useFireCommandStore.getState().patch.reverbMix));
    }
    setParam("moduleEnable", en);
  };
  return (
    <div
      className="mb-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border px-2 py-2"
      style={{ borderColor: `${c}33`, background: `linear-gradient(180deg, ${c}14, transparent)` }}
    >
      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}88` }}>Rack</span>
      {qualities.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => setParam("fxQuality", q)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={
            quality === q
              ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
          }
        >
          {FX_QUALITY_LABELS[q]}
        </button>
      ))}
      <span className="mx-1 text-white/20">·</span>
      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Low</span>
      {protects.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setParam("lowProtect", p)}
          className="rounded-md border px-1.5 py-0.5 text-[9px] font-mono"
          style={
            lowProtect === p
              ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.fx, 0.95) }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
          }
        >
          {p === "off" ? "Off" : p === "custom" ? "Hz" : `${p}`}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setParam("fxDeltaAudition", !delta)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase"
        style={
          delta
            ? { borderColor: `${c}99`, background: `${c}40`, color: bandShade(FC.fx, 0.98) }
            : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }
        }
        title="Audition wet − dry delta"
      >
        Δ Delta
      </button>
      <button
        type="button"
        onClick={() => setParam("fxSharedMod", !shared)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
        style={
          shared
            ? { borderColor: `${c}99`, background: `${c}28`, color: bandShade(FC.fx, 0.95) }
            : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }
        }
        title="Share LFO between Phaser and Chorus"
      >
        Link LFO
      </button>
      <span className="mx-1 text-white/20">·</span>
      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Scene</span>
      {scenes.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => applyScene(s.id)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={
            scene === s.id
              ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
          }
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ════════════════════ Reverb — Halo Vault ════════════════════

const REVERB_CHARS = [
  { id: "dry", label: "Dry", size: 2.2, damp: 0.45, pre: 0.02, diff: 0.7, mix: 0 },
  { id: "room", label: "Room", size: 0.8, damp: 0.55, pre: 0.01, diff: 0.5, mix: 0.35 },
  { id: "hall", label: "Hall", size: 3.2, damp: 0.4, pre: 0.04, diff: 0.75, mix: 0.45 },
  { id: "plate", label: "Plate", size: 1.6, damp: 0.25, pre: 0.015, diff: 0.85, mix: 0.4 },
  { id: "cave", label: "Cave", size: 5.2, damp: 0.65, pre: 0.08, diff: 0.9, mix: 0.55 },
  { id: "tight", label: "Tight", size: 0.5, damp: 0.7, pre: 0.005, diff: 0.35, mix: 0.28 },
  { id: "lush", label: "Lush", size: 4.0, damp: 0.3, pre: 0.06, diff: 0.95, mix: 0.6 },
] as const;

const REVERB_SIZES = [
  { label: "0.5", v: 0.5 },
  { label: "1s", v: 1 },
  { label: "2.2", v: 2.2 },
  { label: "3.5", v: 3.5 },
  { label: "5s", v: 5 },
] as const;

const REVERB_MIXES = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

const REVERB_MIX_CYCLE = [0, 0.5, 1] as const;

function revNear(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function revNearSize(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.3, a) / Math.max(0.3, b))) < 0.2;
}

function ReverbCharacterStrip() {
  const size = useFireCommandStore((s) => s.patch.reverbSize) ?? 2.2;
  const damp = useFireCommandStore((s) => s.patch.reverbDamp) ?? 0.45;
  const mix = useFireCommandStore((s) => s.patch.reverbMix) ?? 0;
  const diff = useFireCommandStore((s) => s.patch.reverbDiffusion) ?? 0.7;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.reverb;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Vault
      </span>
      {REVERB_CHARS.map((p) => {
        const on =
          (p.id === "dry" && mix < 0.03) ||
          (p.id !== "dry" &&
            revNearSize(size, p.size) &&
            revNear(damp, p.damp) &&
            revNear(diff, p.diff, 0.12) &&
            revNear(mix, p.mix));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("reverbSize", p.size);
              setParam("reverbDamp", p.damp);
              setParam("reverbPredelay", p.pre);
              setParam("reverbDiffusion", p.diff);
              setParam("reverbMix", p.mix);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ReverbSizeStrip() {
  const size = useFireCommandStore((s) => s.patch.reverbSize) ?? 2.2;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.reverb;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Size
      </span>
      {REVERB_SIZES.map((p) => {
        const on = revNearSize(size, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("reverbSize", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.58)}99`,
                    background: `${bandShade(FC.fx, 0.58)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtSec(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ReverbMixStrip() {
  const mix = useFireCommandStore((s) => s.patch.reverbMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.reverb;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Mix
      </span>
      {REVERB_MIXES.map((p) => {
        const on = revNear(mix, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("reverbMix", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.9)}99`,
                    background: `${bandShade(FC.fx, 0.9)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtPct(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ReverbQuickActions() {
  const size = useFireCommandStore((s) => s.patch.reverbSize) ?? 2.2;
  const damp = useFireCommandStore((s) => s.patch.reverbDamp) ?? 0.45;
  const pre = useFireCommandStore((s) => s.patch.reverbPredelay) ?? 0.02;
  const diff = useFireCommandStore((s) => s.patch.reverbDiffusion) ?? 0.7;
  const mix = useFireCommandStore((s) => s.patch.reverbMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ size: 2.2, damp: 0.4, pre: 0.04, diff: 0.75, mix: 0.45 });
  const c = FC.reverb;
  const idle = mix < 0.03;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("reverbSize", savedRef.current.size);
            setParam("reverbDamp", savedRef.current.damp);
            setParam("reverbPredelay", savedRef.current.pre);
            setParam("reverbDiffusion", savedRef.current.diff);
            setParam("reverbMix", savedRef.current.mix);
          } else {
            savedRef.current = { size, damp, pre, diff, mix };
            setParam("reverbMix", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore vault" : "Bypass mix"}
      >
        {idle ? "Bloom" : "Dry"}
      </button>
      <button
        type="button"
        onClick={() => {
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < REVERB_MIX_CYCLE.length; i++) {
            const d = Math.abs(REVERB_MIX_CYCLE[i]! - mix);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          setParam("reverbMix", REVERB_MIX_CYCLE[(best + 1) % REVERB_MIX_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: bandShade(FC.fx, 0.92), background: `${c}22` }}
        title="Cycle mix 0 → 50 → 100"
      >
        Mix↻
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("reverbSize", 3.2);
          setParam("reverbDamp", 0.4);
          setParam("reverbPredelay", 0.04);
          setParam("reverbDiffusion", 0.75);
          setParam("reverbMix", 0.45);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Hall bloom"
      >
        Hall
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("reverbSize", 2.2);
          setParam("reverbDamp", 0.45);
          setParam("reverbPredelay", 0.02);
          setParam("reverbDiffusion", 0.7);
          setParam("reverbMix", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset reverb defaults"
      >
        Reset
      </button>
    </div>
  );
}

function ReverbModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.4rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function ReverbPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.reverb;
  const cSize = bandShade(FC.fx, 0.58);
  const cDamp = bandShade(FC.fx, 0.68);
  const cPre = bandShade(FC.fx, 0.78);
  const cDiff = bandShade(FC.fx, 0.84);
  const cMix = bandShade(FC.fx, 0.9);
  const cHi = bandShade(FC.fx, 0.74);
  const size = useFireCommandStore((s) => s.patch.reverbSize) ?? 2.2;
  const damp = useFireCommandStore((s) => s.patch.reverbDamp) ?? 0.45;
  const pre = useFireCommandStore((s) => s.patch.reverbPredelay) ?? 0.02;
  const diff = useFireCommandStore((s) => s.patch.reverbDiffusion) ?? 0.7;
  const mix = useFireCommandStore((s) => s.patch.reverbMix) ?? 0;
  const freeze = useFireCommandStore((s) => s.patch.reverbFreeze) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = mix > 0.02;
  const sizeN = Math.log(Math.max(0.3, size) / 0.3) / Math.log(6 / 0.3);
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathFx !== false;
  const tech = fxTechState("fx.reverb", patch, { mix, pathOn });
  const thematic = !live ? "Dry" : freeze ? "Freeze" : size > 4 ? "Hall" : size < 1 ? "Room" : "Vault";

  return (
    <Section title="Reverb" color={c} collapseKey="fx.reverb" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Halo Vault
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${size.toFixed(1)}s · d${Math.round(damp * 100)} · Δ${Math.round(diff * 100)} · M${Math.round(mix * 100)}`
                : `${size.toFixed(1)}s · dry`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ReverbQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <ReverbStageViz />
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${FC.reverb}66` }}>Early/Tail</span>
        <FParamKnob paramKey="reverbEarly" label="Early" min={0} max={1} format={fmtPct} def={0.45} size={40} color={bandShade(FC.fx, 0.7)} />
        <FParamKnob paramKey="reverbLowDecay" label="Low Dec" min={0} max={1} format={fmtPct} def={0.55} size={40} color={bandShade(FC.fx, 0.55)} />
        <FParamKnob paramKey="reverbHighCut" label="HiCut" min={1000} max={18000} curve="log" format={fmtHz} def={12000} size={40} color={cHi} />
        <button
          type="button"
          onClick={() => setParam("reverbFreeze", !freeze)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={freeze ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) } : { borderColor: `${c}55`, color: `${c}cc` }}
          title="Freeze reverb tail"
        >
          {freeze ? "● Freeze" : "○ Freeze"}
        </button>
      </div>
      <ReverbCharacterStrip />
      <ReverbSizeStrip />
      <ReverbMixStrip />

      <div className="mb-2 flex items-center justify-center gap-2 flex-wrap">
        <ReverbModMeter label="Size" value={sizeN} color={cSize} format={() => fmtSec(size)} />
        <ReverbModMeter label="Damp" value={damp} color={cDamp} format={() => fmtPct(damp)} />
        <ReverbModMeter label="Pre" value={pre / 0.2} color={cPre} format={() => fmtSec(pre)} />
        <ReverbModMeter label="Diff" value={diff} color={cDiff} format={() => fmtPct(diff)} />
        <ReverbModMeter label="Mix" value={mix} color={cMix} format={() => fmtPct(mix)} />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="reverbSize" label="Size" min={0.3} max={6} curve="log" format={fmtSec} def={2.2} size={50} color={cSize} />
        <FParamKnob paramKey="reverbDamp" label="Damp" min={0} max={1} format={fmtPct} def={0.45} size={50} color={cDamp} />
        <FParamKnob paramKey="reverbPredelay" label="Pre" min={0} max={0.2} format={fmtSec} def={0.02} size={50} color={cPre} />
        <FParamKnob paramKey="reverbDiffusion" label="Diff" min={0} max={1} format={fmtPct} def={0.7} size={50} color={cDiff} />
        <FParamKnob paramKey="reverbMix" label="Mix" min={0} max={1} format={fmtPct} def={0} size={50} color={cMix} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Halo vault — Early/Low Dec/HiCut · Freeze · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

// ════════════════════ Delay — Ping Cascade ════════════════════

const DELAY_CHARS = [
  { id: "idle", label: "Idle", time: 0.28, fbk: 0.3, mix: 0 },
  { id: "slap", label: "Slap", time: 0.06, fbk: 0.15, mix: 0.35 },
  { id: "echo", label: "Echo", time: 0.28, fbk: 0.4, mix: 0.45 },
  { id: "dub", label: "Dub", time: 0.45, fbk: 0.72, mix: 0.55 },
  { id: "bounce", label: "Bounce", time: 0.22, fbk: 0.55, mix: 0.5 },
  { id: "long", label: "Long", time: 0.85, fbk: 0.5, mix: 0.4 },
  { id: "infinite", label: "∞", time: 0.35, fbk: 0.88, mix: 0.6 },
] as const;

const DELAY_TIMES = [
  { label: "50ms", v: 0.05 },
  { label: "125", v: 0.125 },
  { label: "250", v: 0.25 },
  { label: "375", v: 0.375 },
  { label: "500", v: 0.5 },
  { label: "1s", v: 1 },
] as const;

const DELAY_MIXES = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

const DELAY_MIX_CYCLE = [0, 0.5, 1] as const;
const DELAY_FBK_MAX = 0.92;

function delayNear(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function delayNearTime(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.01, a) / Math.max(0.01, b))) < 0.18;
}

function DelayCharacterStrip() {
  const time = useFireCommandStore((s) => s.patch.delayTime) ?? 0.28;
  const fbk = useFireCommandStore((s) => s.patch.delayFeedback) ?? 0.3;
  const mix = useFireCommandStore((s) => s.patch.delayMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.delay;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Cascade
      </span>
      {DELAY_CHARS.map((p) => {
        const on =
          (p.id === "idle" && mix < 0.03) ||
          (p.id !== "idle" && delayNearTime(time, p.time) && delayNear(fbk, p.fbk) && delayNear(mix, p.mix));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("delayTime", p.time);
              setParam("delayFeedback", p.fbk);
              setParam("delayMix", p.mix);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function DelayTimeStrip() {
  const time = useFireCommandStore((s) => s.patch.delayTime) ?? 0.28;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.delay;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Time
      </span>
      {DELAY_TIMES.map((p) => {
        const on = delayNearTime(time, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("delayTime", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.58)}99`,
                    background: `${bandShade(FC.fx, 0.58)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtSec(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function DelayMixStrip() {
  const mix = useFireCommandStore((s) => s.patch.delayMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.delay;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Mix
      </span>
      {DELAY_MIXES.map((p) => {
        const on = delayNear(mix, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("delayMix", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.86)}99`,
                    background: `${bandShade(FC.fx, 0.86)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtPct(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function DelayQuickActions() {
  const time = useFireCommandStore((s) => s.patch.delayTime) ?? 0.28;
  const fbk = useFireCommandStore((s) => s.patch.delayFeedback) ?? 0.3;
  const mix = useFireCommandStore((s) => s.patch.delayMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ time: 0.28, fbk: 0.4, mix: 0.45 });
  const c = FC.delay;
  const idle = mix < 0.03;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("delayTime", savedRef.current.time);
            setParam("delayFeedback", savedRef.current.fbk);
            setParam("delayMix", savedRef.current.mix);
          } else {
            savedRef.current = { time, fbk, mix };
            setParam("delayMix", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore cascade" : "Bypass mix"}
      >
        {idle ? "Bounce" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < DELAY_MIX_CYCLE.length; i++) {
            const d = Math.abs(DELAY_MIX_CYCLE[i]! - mix);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          setParam("delayMix", DELAY_MIX_CYCLE[(best + 1) % DELAY_MIX_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: bandShade(FC.fx, 0.92), background: `${c}22` }}
        title="Cycle mix 0 → 50 → 100"
      >
        Mix↻
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("delayTime", 0.28);
          setParam("delayFeedback", 0.45);
          setParam("delayMix", 0.5);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Classic ping-pong echo"
      >
        Echo
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("delayTime", 0.28);
          setParam("delayFeedback", 0.3);
          setParam("delayMix", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset delay defaults"
      >
        Reset
      </button>
    </div>
  );
}

function DelayModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function DelayPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.delay;
  const cTime = bandShade(FC.fx, 0.58);
  const cFbk = bandShade(FC.fx, 0.72);
  const cMix = bandShade(FC.fx, 0.86);
  const cDuck = bandShade(FC.fx, 0.5);
  const cFilt = bandShade(FC.fx, 0.66);
  const cDrive = bandShade(FC.fx, 0.78);
  const time = useFireCommandStore((s) => s.patch.delayTime) ?? 0.28;
  const fbk = useFireCommandStore((s) => s.patch.delayFeedback) ?? 0.3;
  const mix = useFireCommandStore((s) => s.patch.delayMix) ?? 0;
  const cascade = useFireCommandStore((s) => s.patch.delayCascadeMode) ?? "echo";
  const sync = useFireCommandStore((s) => s.patch.delaySync) ?? false;
  const freeze = useFireCommandStore((s) => s.patch.delayFreeze) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = mix > 0.02;
  const timeN = Math.log(Math.max(0.01, time) / 0.01) / Math.log(1.5 / 0.01);
  const fbkN = fbk / DELAY_FBK_MAX;
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathFx !== false;
  const tech = fxTechState("fx.delay", patch, { mix, pathOn });
  const thematic = !live ? "Dry" : freeze ? "Freeze" : fbk > 0.7 ? "∞" : time < 0.08 ? "Slap" : "Ping";

  return (
    <Section title="Delay (Ping-Pong)" color={c} collapseKey="fx.delay" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Ping Cascade
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${fmtSec(time)} · FB${Math.round(fbk * 100)} · M${Math.round(mix * 100)}`
                : `${fmtSec(time)} · idle`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DelayQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <DelayStageViz />
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${FC.delay}66` }}>Cascade</span>
        {(["slap", "echo", "dub", "bounce", "long", "infinite"] as const).map((m) => {
          const on = cascade === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setParam("delayCascadeMode", m)}
              className="rounded-md border px-2 py-0.5 text-[9px] font-bold capitalize"
              style={on ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) } : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
            >
              {m}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setParam("delaySync", !sync)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={sync ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) } : { borderColor: `${c}55`, color: `${c}cc` }}
        >
          {sync ? "SYNC" : "Free"}
        </button>
        <button
          type="button"
          onClick={() => setParam("delayFreeze", !freeze)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={freeze ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) } : { borderColor: `${c}55`, color: `${c}cc` }}
          title="Freeze feedback loop"
        >
          {freeze ? "● Freeze" : "○ Freeze"}
        </button>
      </div>
      <DelayCharacterStrip />
      <DelayTimeStrip />
      <DelayMixStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <DelayModMeter label="Time" value={timeN} color={cTime} format={() => fmtSec(time)} />
        <DelayModMeter label="Fbk" value={fbkN} color={cFbk} format={() => fmtPct(fbk)} />
        <DelayModMeter label="Mix" value={mix} color={cMix} format={() => fmtPct(mix)} />
        <DelayModMeter
          label="R"
          value={timeN}
          color={bandShade(FC.fx, 0.8)}
          format={() => fmtSec(time * 1.5)}
        />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="delayTime" label="Time" min={0.01} max={1.5} curve="log" format={fmtSec} def={0.28} size={52} color={cTime} />
        <FParamKnob paramKey="delayFeedback" label="Fbk" min={0} max={0.92} format={fmtPct} def={0.3} size={52} color={cFbk} />
        <FParamKnob paramKey="delayDuck" label="Duck" min={0} max={1} format={fmtPct} def={0} size={44} color={cDuck} />
        <FParamKnob paramKey="delayFbFilter" label="FbFilt" min={0} max={1} format={fmtPct} def={0.35} size={44} color={cFilt} />
        <FParamKnob paramKey="delayFbDrive" label="FbDrv" min={0} max={1} format={fmtPct} def={0} size={44} color={cDrive} />
        <FParamKnob paramKey="delayMix" label="Mix" min={0} max={1} format={fmtPct} def={0} size={52} color={cMix} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Ping cascade — Duck/FbFilt/FbDrv · Freeze · Cascade/Sync · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

// ════════════════════ Chorus — Ensemble Drift ════════════════════

const CHORUS_CHARS = [
  { id: "idle", label: "Idle", rate: 0.6, depth: 0.4, mix: 0 },
  { id: "soft", label: "Soft", rate: 0.35, depth: 0.28, mix: 0.3 },
  { id: "classic", label: "Classic", rate: 0.6, depth: 0.45, mix: 0.5 },
  { id: "wide", label: "Wide", rate: 0.8, depth: 0.75, mix: 0.55 },
  { id: "slow", label: "Slow", rate: 0.12, depth: 0.55, mix: 0.48 },
  { id: "shimmer", label: "Shimmer", rate: 2.4, depth: 0.5, mix: 0.45 },
  { id: "thick", label: "Thick", rate: 0.5, depth: 0.9, mix: 0.7 },
] as const;

const CHORUS_RATES = [
  { label: "0.1", v: 0.1 },
  { label: "0.3", v: 0.3 },
  { label: "0.6", v: 0.6 },
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "4", v: 4 },
] as const;

const CHORUS_MIXES = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

const CHORUS_MIX_CYCLE = [0, 0.5, 1] as const;

function chorusNear(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function chorusNearRate(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.05, a) / Math.max(0.05, b))) < 0.2;
}

function ChorusCharacterStrip() {
  const rate = useFireCommandStore((s) => s.patch.chorusRate) ?? 0.6;
  const depth = useFireCommandStore((s) => s.patch.chorusDepth) ?? 0.4;
  const mix = useFireCommandStore((s) => s.patch.chorusMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chorus;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Drift
      </span>
      {CHORUS_CHARS.map((p) => {
        const on =
          (p.id === "idle" && mix < 0.03) ||
          (p.id !== "idle" && chorusNearRate(rate, p.rate) && chorusNear(depth, p.depth) && chorusNear(mix, p.mix));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("chorusRate", p.rate);
              setParam("chorusDepth", p.depth);
              setParam("chorusMix", p.mix);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ChorusRateStrip() {
  const rate = useFireCommandStore((s) => s.patch.chorusRate) ?? 0.6;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chorus;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Rate
      </span>
      {CHORUS_RATES.map((p) => {
        const on = chorusNearRate(rate, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("chorusRate", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.55)}99`,
                    background: `${bandShade(FC.fx, 0.55)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtHzRate(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ChorusMixStrip() {
  const mix = useFireCommandStore((s) => s.patch.chorusMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.chorus;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Mix
      </span>
      {CHORUS_MIXES.map((p) => {
        const on = chorusNear(mix, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("chorusMix", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.84)}99`,
                    background: `${bandShade(FC.fx, 0.84)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtPct(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ChorusQuickActions() {
  const rate = useFireCommandStore((s) => s.patch.chorusRate) ?? 0.6;
  const depth = useFireCommandStore((s) => s.patch.chorusDepth) ?? 0.4;
  const mix = useFireCommandStore((s) => s.patch.chorusMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ rate: 0.6, depth: 0.45, mix: 0.5 });
  const c = FC.chorus;
  const idle = mix < 0.03;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("chorusRate", savedRef.current.rate);
            setParam("chorusDepth", savedRef.current.depth);
            setParam("chorusMix", savedRef.current.mix);
          } else {
            savedRef.current = { rate, depth, mix };
            setParam("chorusMix", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore ensemble" : "Bypass mix"}
      >
        {idle ? "Bloom" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < CHORUS_MIX_CYCLE.length; i++) {
            const d = Math.abs(CHORUS_MIX_CYCLE[i]! - mix);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          setParam("chorusMix", CHORUS_MIX_CYCLE[(best + 1) % CHORUS_MIX_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: bandShade(FC.fx, 0.92), background: `${c}22` }}
        title="Cycle mix 0 → 50 → 100"
      >
        Mix↻
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("chorusRate", 0.6);
          setParam("chorusDepth", 0.45);
          setParam("chorusMix", 0.5);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Classic ensemble"
      >
        Classic
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("chorusRate", 0.6);
          setParam("chorusDepth", 0.4);
          setParam("chorusMix", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset chorus defaults"
      >
        Reset
      </button>
    </div>
  );
}

function ChorusModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function ChorusPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.chorus;
  const cRate = bandShade(FC.fx, 0.55);
  const cDepth = bandShade(FC.fx, 0.7);
  const cMix = bandShade(FC.fx, 0.84);
  const cDelay = bandShade(FC.fx, 0.62);
  const cLow = bandShade(FC.fx, 0.48);
  const rate = useFireCommandStore((s) => s.patch.chorusRate) ?? 0.6;
  const depth = useFireCommandStore((s) => s.patch.chorusDepth) ?? 0.4;
  const mix = useFireCommandStore((s) => s.patch.chorusMix) ?? 0;
  const model = useFireCommandStore((s) => s.patch.chorusModel) ?? "dual";
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = mix > 0.02;
  const rateN = Math.log(Math.max(0.05, rate) / 0.05) / Math.log(8 / 0.05);
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathFx !== false;
  const tech = fxTechState("fx.chorus", patch, { mix, pathOn });
  const thematic = !live ? "Dry" : rate > 3 ? "Wide" : rate < 0.25 ? "Slow" : "Ensemble";

  return (
    <Section title="Chorus" color={c} collapseKey="fx.chorus" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Ensemble Drift
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${fmtHzRate(rate)} · D${Math.round(depth * 100)} · M${Math.round(mix * 100)}`
                : `${fmtHzRate(rate)} · bypass`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChorusQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <ChorusStageViz />
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Model</span>
        {(["single", "dual", "triple", "ensemble", "dimension", "tape"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setParam("chorusModel", m)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold capitalize"
            style={model === m ? { borderColor: `${c}99`, background: `${c}33`, color: bandShade(FC.fx, 0.95) } : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
          >
            {m}
          </button>
        ))}
      </div>
      <ChorusCharacterStrip />
      <ChorusRateStrip />
      <ChorusMixStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <ChorusModMeter label="Rate" value={rateN} color={cRate} format={() => fmtHzRate(rate)} />
        <ChorusModMeter label="Depth" value={depth} color={cDepth} format={() => fmtPct(depth)} />
        <ChorusModMeter label="Mix" value={mix} color={cMix} format={() => fmtPct(mix)} />
        <ChorusModMeter
          label="Spread"
          value={depth * mix}
          color={bandShade(FC.fx, 0.76)}
          format={() => fmtPct(depth * mix)}
        />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="chorusRate" label="Rate" min={0.05} max={8} curve="log" format={fmtHzRate} def={0.6} size={52} color={cRate} />
        <FParamKnob paramKey="chorusDepth" label="Depth" min={0} max={1} format={fmtPct} def={0.4} size={52} color={cDepth} />
        <FParamKnob paramKey="chorusVoices" label="Voices" min={1} max={4} integer format={fmtInt} def={2} size={44} color={bandShade(FC.fx, 0.65)} />
        <FParamKnob paramKey="chorusSpread" label="Spread" min={0} max={1} format={fmtPct} def={0.7} size={44} color={bandShade(FC.fx, 0.75)} />
        <FParamKnob paramKey="chorusDelay" label="Delay" min={0.004} max={0.04} curve="log" format={fmtSec} def={0.012} size={44} color={cDelay} />
        <FParamKnob paramKey="chorusLowCut" label="LowCut" min={0} max={400} format={(v) => (v < 1 ? "Off" : fmtHz(v))} def={0} size={44} color={cLow} />
        <FParamKnob paramKey="chorusMix" label="Mix" min={0} max={1} format={fmtPct} def={0} size={52} color={cMix} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Ensemble drift — Voices/Spread · Delay/LowCut · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

// ════════════════════ Phaser — Sweep Veil ════════════════════

const PHASER_CHARS = [
  { id: "idle", label: "Idle", rate: 0.4, depth: 0.6, mix: 0 },
  { id: "slow", label: "Slow", rate: 0.12, depth: 0.75, mix: 0.5 },
  { id: "classic", label: "Classic", rate: 0.4, depth: 0.65, mix: 0.55 },
  { id: "deep", label: "Deep", rate: 0.22, depth: 1, mix: 0.7 },
  { id: "jet", label: "Jet", rate: 3.2, depth: 0.85, mix: 0.6 },
  { id: "subtle", label: "Subtle", rate: 0.55, depth: 0.35, mix: 0.28 },
  { id: "wild", label: "Wild", rate: 7.5, depth: 0.9, mix: 0.65 },
] as const;

const PHASER_RATES = [
  { label: "0.1", v: 0.1 },
  { label: "0.4", v: 0.4 },
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "4", v: 4 },
  { label: "8", v: 8 },
] as const;

const PHASER_MIXES = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

const PHASER_MIX_CYCLE = [0, 0.5, 1] as const;

function phaserNear(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function phaserNearRate(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(0.02, a) / Math.max(0.02, b))) < 0.2;
}

function PhaserCharacterStrip() {
  const rate = useFireCommandStore((s) => s.patch.phaserRate) ?? 0.4;
  const depth = useFireCommandStore((s) => s.patch.phaserDepth) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.phaserMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.phaser;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Veil
      </span>
      {PHASER_CHARS.map((p) => {
        const on =
          (p.id === "idle" && mix < 0.03) ||
          (p.id !== "idle" && phaserNearRate(rate, p.rate) && phaserNear(depth, p.depth) && phaserNear(mix, p.mix));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("phaserRate", p.rate);
              setParam("phaserDepth", p.depth);
              setParam("phaserMix", p.mix);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PhaserRateStrip() {
  const rate = useFireCommandStore((s) => s.patch.phaserRate) ?? 0.4;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.phaser;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Rate
      </span>
      {PHASER_RATES.map((p) => {
        const on = phaserNearRate(rate, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("phaserRate", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.52)}99`,
                    background: `${bandShade(FC.fx, 0.52)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtHzRate(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PhaserMixStrip() {
  const mix = useFireCommandStore((s) => s.patch.phaserMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.phaser;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Mix
      </span>
      {PHASER_MIXES.map((p) => {
        const on = phaserNear(mix, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("phaserMix", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.82)}99`,
                    background: `${bandShade(FC.fx, 0.82)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtPct(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PhaserQuickActions() {
  const rate = useFireCommandStore((s) => s.patch.phaserRate) ?? 0.4;
  const depth = useFireCommandStore((s) => s.patch.phaserDepth) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.phaserMix) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ rate: 0.4, depth: 0.65, mix: 0.55 });
  const c = FC.phaser;
  const idle = mix < 0.03;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("phaserRate", savedRef.current.rate);
            setParam("phaserDepth", savedRef.current.depth);
            setParam("phaserMix", savedRef.current.mix);
          } else {
            savedRef.current = { rate, depth, mix };
            setParam("phaserMix", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore veil" : "Bypass mix"}
      >
        {idle ? "Unveil" : "Veil"}
      </button>
      <button
        type="button"
        onClick={() => {
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < PHASER_MIX_CYCLE.length; i++) {
            const d = Math.abs(PHASER_MIX_CYCLE[i]! - mix);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          setParam("phaserMix", PHASER_MIX_CYCLE[(best + 1) % PHASER_MIX_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: bandShade(FC.fx, 0.92), background: `${c}22` }}
        title="Cycle mix 0 → 50 → 100"
      >
        Mix↻
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("phaserRate", 0.4);
          setParam("phaserDepth", 0.65);
          setParam("phaserMix", 0.55);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Classic sweep"
      >
        Classic
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("phaserRate", 0.4);
          setParam("phaserDepth", 0.6);
          setParam("phaserMix", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset phaser defaults"
      >
        Reset
      </button>
    </div>
  );
}

function PhaserModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function PhaserPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.phaser;
  const cRate = bandShade(FC.fx, 0.52);
  const cDepth = bandShade(FC.fx, 0.68);
  const cMix = bandShade(FC.fx, 0.82);
  const cStages = bandShade(FC.fx, 0.58);
  const cFb = bandShade(FC.fx, 0.74);
  const cCenter = bandShade(FC.fx, 0.64);
  const rate = useFireCommandStore((s) => s.patch.phaserRate) ?? 0.4;
  const depth = useFireCommandStore((s) => s.patch.phaserDepth) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.phaserMix) ?? 0;
  const stereo = (useFireCommandStore((s) => s.patch.phaserStereo) ?? "linked") as PhaserStereoMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = mix > 0.02;
  const rateN = Math.log(Math.max(0.02, rate) / 0.02) / Math.log(12 / 0.02);
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathFx !== false;
  const tech = fxTechState("fx.phaser", patch, { mix, pathOn });
  const thematic = !live ? "Bypass" : rate > 4 ? "Jet" : rate < 0.2 ? "Slow" : "Sweep";

  return (
    <Section title="Phaser" color={c} collapseKey="fx.phaser" chipHosted={chipHosted}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Sweep Veil
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${fmtHzRate(rate)} · D${Math.round(depth * 100)} · M${Math.round(mix * 100)}`
                : `${fmtHzRate(rate)} · bypass`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PhaserQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <PhaserStageViz />
      <PhaserCharacterStrip />
      <PhaserRateStrip />
      <PhaserMixStrip />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
          Stereo
        </span>
        {([
          { id: "linked" as const, label: "Linked" },
          { id: "opposed" as const, label: "Opposed" },
          { id: "quadrature" as const, label: "Quadrature" },
        ]).map((m) => {
          const on = stereo === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setParam("phaserStereo", m.id)}
              className="rounded-md border px-2 py-0.5 text-[9px] font-bold capitalize transition"
              style={
                on
                  ? {
                      borderColor: `${c}99`,
                      background: `${c}33`,
                      color: bandShade(FC.fx, 0.96),
                      boxShadow: `0 0 8px ${c}33`,
                    }
                  : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <PhaserModMeter label="Rate" value={rateN} color={cRate} format={() => fmtHzRate(rate)} />
        <PhaserModMeter label="Depth" value={depth} color={cDepth} format={() => fmtPct(depth)} />
        <PhaserModMeter label="Mix" value={mix} color={cMix} format={() => fmtPct(mix)} />
        <PhaserModMeter
          label="Fb"
          value={mix * 0.55}
          color={cFb}
          format={() => fmtPct(mix * 0.55)}
        />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="phaserRate" label="Rate" min={0.02} max={12} curve="log" format={fmtHzRate} def={0.4} size={52} color={cRate} />
        <FParamKnob paramKey="phaserDepth" label="Depth" min={0} max={1} format={fmtPct} def={0.6} size={52} color={cDepth} />
        <FParamKnob paramKey="phaserStages" label="Stages" min={2} max={12} integer format={fmtInt} def={4} size={44} color={cStages} />
        <FParamKnob paramKey="phaserFeedback" label="Fb" min={0} max={0.9} format={fmtPct} def={0.35} size={44} color={cFb} />
        <FParamKnob paramKey="phaserCenter" label="Center" min={100} max={8000} curve="log" format={fmtHz} def={800} size={44} color={cCenter} />
        <FParamKnob paramKey="phaserMix" label="Mix" min={0} max={1} format={fmtPct} def={0} size={52} color={cMix} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Sweep veil — Stages/Feedback/Center · Stereo {stereo} · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

// ════════════════════ Age — Oxide Archive ════════════════════

type AgeChar = {
  id: string;
  label: string;
  cass: number;
  speed: number;
  wow: number;
  vhs: number;
  bit: FireBitDepth;
  srr: number;
  bbd: number;
  comp: number;
  dust: number;
  hiss: number;
  hum: number;
  print: number;
};

const AGE_CHARS: AgeChar[] = [
  { id: "clean", label: "Clean", cass: 0, speed: 0, wow: 0, vhs: 0, bit: "off", srr: 0, bbd: 0, comp: 0, dust: 0, hiss: 0, hum: 0, print: 0 },
  { id: "warm", label: "Warm", cass: 0.32, speed: 0, wow: 0.18, vhs: 0, bit: "off", srr: 0, bbd: 0.12, comp: 0.15, dust: 0.08, hiss: 0.1, hum: 0.08, print: 0 },
  { id: "worn", label: "Worn", cass: 0.55, speed: -0.15, wow: 0.42, vhs: 0.15, bit: "off", srr: 0.12, bbd: 0.2, comp: 0.25, dust: 0.35, hiss: 0.28, hum: 0.22, print: 0.18 },
  { id: "vhs", label: "VHS", cass: 0.28, speed: 0.1, wow: 0.35, vhs: 0.72, bit: "12bit", srr: 0.35, bbd: 0.15, comp: 0.2, dust: 0.4, hiss: 0.3, hum: 0.15, print: 0.1 },
  { id: "lofi", label: "LoFi", cass: 0.4, speed: 0, wow: 0.25, vhs: 0.2, bit: "8bit", srr: 0.68, bbd: 0.3, comp: 0.35, dust: 0.25, hiss: 0.4, hum: 0.2, print: 0.15 },
  { id: "bbd", label: "BBD", cass: 0.22, speed: 0, wow: 0.3, vhs: 0, bit: "off", srr: 0.1, bbd: 0.75, comp: 0.18, dust: 0.1, hiss: 0.15, hum: 0.12, print: 0.25 },
  { id: "ghost", label: "Ghost", cass: 0.25, speed: -0.2, wow: 0.2, vhs: 0.18, bit: "off", srr: 0.08, bbd: 0.35, comp: 0.1, dust: 0.2, hiss: 0.35, hum: 0.45, print: 0.72 },
  { id: "relic", label: "Relic", cass: 0.7, speed: 0.25, wow: 0.55, vhs: 0.45, bit: "12bit", srr: 0.4, bbd: 0.4, comp: 0.4, dust: 0.55, hiss: 0.45, hum: 0.4, print: 0.4 },
];

const AGE_BITS: { id: FireBitDepth; label: string }[] = [
  { id: "off", label: "Full" },
  { id: "12bit", label: "12b" },
  { id: "8bit", label: "8b" },
];

const AGE_BIT_CYCLE: FireBitDepth[] = ["off", "12bit", "8bit"];

function ageNear(a: number, b: number, eps = 0.08) {
  return Math.abs(a - b) < eps;
}

function ageApplyChar(setParam: (k: keyof FirePatch, v: number | FireBitDepth) => void, p: AgeChar) {
  setParam("cassetteGen", p.cass);
  setParam("tapeSpeed", p.speed);
  setParam("wowFlutter", p.wow);
  setParam("vhsColor", p.vhs);
  setParam("bitDepth", p.bit);
  setParam("sampleRateReduce", p.srr);
  setParam("bbdChorus", p.bbd);
  setParam("analogComp", p.comp);
  setParam("dust", p.dust);
  setParam("hiss", p.hiss);
  setParam("hum", p.hum);
  setParam("printThrough", p.print);
}

function AgeCharacterStrip() {
  const cass = useFireCommandStore((s) => s.patch.cassetteGen) ?? 0;
  const wow = useFireCommandStore((s) => s.patch.wowFlutter) ?? 0;
  const vhs = useFireCommandStore((s) => s.patch.vhsColor) ?? 0;
  const bit = (useFireCommandStore((s) => s.patch.bitDepth) ?? "off") as FireBitDepth;
  const bbd = useFireCommandStore((s) => s.patch.bbdChorus) ?? 0;
  const print = useFireCommandStore((s) => s.patch.printThrough) ?? 0;
  const srr = useFireCommandStore((s) => s.patch.sampleRateReduce) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.vintage;
  const heat = Math.max(cass, wow, vhs, bbd, print, srr, bit !== "off" ? 0.3 : 0);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Archive
      </span>
      {AGE_CHARS.map((p) => {
        const on =
          (p.id === "clean" && heat < 0.04) ||
          (p.id !== "clean" &&
            ageNear(cass, p.cass) &&
            ageNear(wow, p.wow) &&
            ageNear(vhs, p.vhs) &&
            bit === p.bit &&
            ageNear(bbd, p.bbd, 0.12) &&
            ageNear(print, p.print, 0.12));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => ageApplyChar(setParam as (k: keyof FirePatch, v: number | FireBitDepth) => void, p)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function AgeBitStrip() {
  const bit = (useFireCommandStore((s) => s.patch.bitDepth) ?? "off") as FireBitDepth;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.vintage;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Bits
      </span>
      {AGE_BITS.map((m) => {
        const on = bit === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setParam("bitDepth", m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.72)}99`,
                    background: `${bandShade(FC.fx, 0.72)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={m.label}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function AgeBedStrip() {
  const setParam = useFireCommandStore((s) => s.setParam);
  const dust = useFireCommandStore((s) => s.patch.dust) ?? 0;
  const hiss = useFireCommandStore((s) => s.patch.hiss) ?? 0;
  const hum = useFireCommandStore((s) => s.patch.hum) ?? 0;
  const print = useFireCommandStore((s) => s.patch.printThrough) ?? 0;
  const c = FC.vintage;
  const beds = [
    { id: "dust", label: "Dust", v: 0.45, cur: dust, key: "dust" as const },
    { id: "hiss", label: "Hiss", v: 0.4, cur: hiss, key: "hiss" as const },
    { id: "hum", label: "Hum", v: 0.4, cur: hum, key: "hum" as const },
    { id: "print", label: "Print", v: 0.5, cur: print, key: "printThrough" as const },
    { id: "clear", label: "Clear", v: 0, cur: Math.max(dust, hiss, hum, print), key: null },
  ];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Beds
      </span>
      {beds.map((b) => {
        const on = b.key === null ? b.cur < 0.04 : ageNear(b.cur, b.v, 0.1) && b.cur > 0.08;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              if (b.key === null) {
                setParam("dust", 0);
                setParam("hiss", 0);
                setParam("hum", 0);
                setParam("printThrough", 0);
              } else {
                setParam(b.key, b.v);
              }
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.82)}99`,
                    background: `${bandShade(FC.fx, 0.82)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={b.label}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

function AgeQuickActions() {
  const cass = useFireCommandStore((s) => s.patch.cassetteGen) ?? 0;
  const speed = useFireCommandStore((s) => s.patch.tapeSpeed) ?? 0;
  const wow = useFireCommandStore((s) => s.patch.wowFlutter) ?? 0;
  const vhs = useFireCommandStore((s) => s.patch.vhsColor) ?? 0;
  const bit = (useFireCommandStore((s) => s.patch.bitDepth) ?? "off") as FireBitDepth;
  const srr = useFireCommandStore((s) => s.patch.sampleRateReduce) ?? 0;
  const bbd = useFireCommandStore((s) => s.patch.bbdChorus) ?? 0;
  const comp = useFireCommandStore((s) => s.patch.analogComp) ?? 0;
  const dust = useFireCommandStore((s) => s.patch.dust) ?? 0;
  const hiss = useFireCommandStore((s) => s.patch.hiss) ?? 0;
  const hum = useFireCommandStore((s) => s.patch.hum) ?? 0;
  const print = useFireCommandStore((s) => s.patch.printThrough) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef<AgeChar>({
    id: "saved", label: "Saved",
    cass: 0.45, speed: 0, wow: 0.3, vhs: 0.2, bit: "off", srr: 0.15, bbd: 0.2, comp: 0.2,
    dust: 0.25, hiss: 0.2, hum: 0.15, print: 0.1,
  });
  const c = FC.vintage;
  const idle = Math.max(cass, wow, vhs, bbd, dust, hiss, hum, print, srr, comp, Math.abs(speed), bit !== "off" ? 0.3 : 0) < 0.04;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            ageApplyChar(setParam as (k: keyof FirePatch, v: number | FireBitDepth) => void, savedRef.current);
          } else {
            savedRef.current = {
              id: "saved", label: "Saved",
              cass, speed, wow, vhs, bit, srr, bbd, comp, dust, hiss, hum, print,
            };
            ageApplyChar(setParam as (k: keyof FirePatch, v: number | FireBitDepth) => void, AGE_CHARS[0]!);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore archive" : "Clear aging"}
      >
        {idle ? "Awaken" : "Sleep"}
      </button>
      <button
        type="button"
        onClick={() => {
          const i = AGE_BIT_CYCLE.indexOf(bit);
          setParam("bitDepth", AGE_BIT_CYCLE[(i + 1) % AGE_BIT_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: bandShade(FC.fx, 0.92), background: `${c}22` }}
        title="Cycle bit depth"
      >
        Bits
      </button>
      <button
        type="button"
        onClick={() => ageApplyChar(setParam as (k: keyof FirePatch, v: number | FireBitDepth) => void, AGE_CHARS.find((x) => x.id === "worn")!)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Stamp worn tape"
      >
        Stamp
      </button>
      <button
        type="button"
        onClick={() => ageApplyChar(setParam as (k: keyof FirePatch, v: number | FireBitDepth) => void, AGE_CHARS[0]!)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset age stage"
      >
        Reset
      </button>
    </div>
  );
}

function AgeModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.4rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function AgePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.vintage;
  const cCass = bandShade(FC.fx, 0.38);
  const cSpeed = bandShade(FC.fx, 0.45);
  const cWow = bandShade(FC.fx, 0.5);
  const cVhs = bandShade(FC.fx, 0.58);
  const cSrr = bandShade(FC.fx, 0.64);
  const cBbd = bandShade(FC.fx, 0.7);
  const cComp = bandShade(FC.fx, 0.74);
  const cDust = bandShade(FC.fx, 0.78);
  const cHiss = bandShade(FC.fx, 0.82);
  const cHum = bandShade(FC.fx, 0.86);
  const cPrint = bandShade(FC.fx, 0.9);

  const cass = useFireCommandStore((s) => s.patch.cassetteGen) ?? 0;
  const speed = useFireCommandStore((s) => s.patch.tapeSpeed) ?? 0;
  const wow = useFireCommandStore((s) => s.patch.wowFlutter) ?? 0;
  const vhs = useFireCommandStore((s) => s.patch.vhsColor) ?? 0;
  const bit = (useFireCommandStore((s) => s.patch.bitDepth) ?? "off") as FireBitDepth;
  const srr = useFireCommandStore((s) => s.patch.sampleRateReduce) ?? 0;
  const bbd = useFireCommandStore((s) => s.patch.bbdChorus) ?? 0;
  const comp = useFireCommandStore((s) => s.patch.analogComp) ?? 0;
  const dust = useFireCommandStore((s) => s.patch.dust) ?? 0;
  const hiss = useFireCommandStore((s) => s.patch.hiss) ?? 0;
  const hum = useFireCommandStore((s) => s.patch.hum) ?? 0;
  const print = useFireCommandStore((s) => s.patch.printThrough) ?? 0;
  const beds = Math.max(dust, hiss, hum, print);
  const live = Math.max(cass, wow, vhs, beds, srr, bbd, comp, Math.abs(speed), bit !== "off" ? 0.35 : 0) > 0.03;
  const ageMacro = useFireCommandStore((s) => s.patch.ageMacro) ?? 0;
  const ageEvolve = useFireCommandStore((s) => s.patch.ageEvolve) ?? 0;
  const lockMed = useFireCommandStore((s) => s.patch.ageLockMedium) ?? false;
  const lockMot = useFireCommandStore((s) => s.patch.ageLockMotion) ?? false;
  const lockWear = useFireCommandStore((s) => s.patch.ageLockWear) ?? false;
  const lockRes = useFireCommandStore((s) => s.patch.ageLockResolution) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathAge !== false;
  const tech = fxTechState("fx.vintage", patch, { mix: live ? 1 : 0, pathOn });
  const thematic = !live ? "Clean" : bit !== "off" ? bit : vhs > 0.4 ? "VHS" : bbd > 0.45 ? "BBD" : "Aged";
  const cMacro = bandShade(FC.fx, 0.42);
  const cEvolve = bandShade(FC.fx, 0.48);
  const lockBtn = (on: boolean, label: string, key: "ageLockMedium" | "ageLockMotion" | "ageLockWear" | "ageLockResolution") => (
    <button
      key={key}
      type="button"
      onClick={() => setParam(key, !on)}
      className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
      style={
        on
          ? {
              borderColor: `${c}99`,
              background: `${c}33`,
              color: bandShade(FC.fx, 0.96),
              boxShadow: `0 0 8px ${c}44`,
            }
          : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
      }
      title={`${on ? "Unlock" : "Lock"} ${label}`}
    >
      {on ? `● ${label}` : `○ ${label}`}
    </button>
  );

  return (
    <Section
      title="Vintage Age"
      color={c}
      collapseKey="fx.vintage"
      chipHosted={chipHosted}
      right={
        <FSeg<FireBitDepth>
          paramKey="bitDepth"
          color={c}
          options={AGE_BITS}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Oxide Archive
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${bit === "off" ? "full" : bit} · C${Math.round(cass * 100)} · W${Math.round(wow * 100)}${vhs > 0.05 ? ` · V${Math.round(vhs * 100)}` : ""}`
                : `${bit === "off" ? "full" : bit} · clean`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AgeQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <AgeStageViz />
      <AgeCharacterStrip />
      <AgeBitStrip />
      <AgeBedStrip />

      <div className="mb-2 flex items-center justify-center gap-2 flex-wrap">
        <AgeModMeter label="Cass" value={cass} color={cCass} format={() => fmtPct(cass)} />
        <AgeModMeter label="Speed" value={speed} color={cSpeed} bipolar format={() => fmtBi(speed)} />
        <AgeModMeter label="Wow" value={wow} color={cWow} format={() => fmtPct(wow)} />
        <AgeModMeter label="VHS" value={vhs} color={cVhs} format={() => fmtPct(vhs)} />
        <AgeModMeter label="Beds" value={beds} color={cDust} format={() => fmtPct(beds)} />
        <AgeModMeter
          label="Bits"
          value={bit === "off" ? 0 : bit === "12bit" ? 0.5 : 1}
          color={bandShade(FC.fx, 0.72)}
          format={() => (bit === "off" ? "full" : bit.replace("bit", "b"))}
        />
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
          AGE
        </span>
        <FParamKnob paramKey="ageMacro" label="Macro" min={0} max={1} format={fmtPct} def={0} size={44} color={cMacro} />
        <FParamKnob paramKey="ageEvolve" label="Evolve" min={0} max={1} format={fmtPct} def={0} size={44} color={cEvolve} />
        <span className="mx-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
          Locks
        </span>
        {lockBtn(lockMed, "Medium", "ageLockMedium")}
        {lockBtn(lockMot, "Motion", "ageLockMotion")}
        {lockBtn(lockWear, "Wear", "ageLockWear")}
        {lockBtn(lockRes, "Resolution", "ageLockResolution")}
      </div>

      <div className="mb-1 text-center text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Medium{lockMed ? " · locked" : ""} · Macro {Math.round(ageMacro * 100)} · Evolve {Math.round(ageEvolve * 100)}
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="cassetteGen" label="Cass" min={0} max={1} format={fmtPct} def={0} size={46} color={cCass} />
        <FParamKnob paramKey="vhsColor" label="VHS" min={0} max={1} format={fmtPct} def={0} size={46} color={cVhs} />
        <FParamKnob paramKey="analogComp" label="Comp" min={0} max={1} format={fmtPct} def={0} size={44} color={cComp} />
      </div>

      <div className="mt-2 mb-1 text-center text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Motion{lockMot ? " · locked" : ""}
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="tapeSpeed" label="Speed" min={-1} max={1} bipolar format={fmtBi} def={0} size={46} color={cSpeed} />
        <FParamKnob paramKey="wowFlutter" label="Wow" min={0} max={1} format={fmtPct} def={0} size={46} color={cWow} />
        <FParamKnob paramKey="bbdChorus" label="BBD" min={0} max={1} format={fmtPct} def={0} size={44} color={cBbd} />
      </div>

      <div className="mt-2 mb-1 text-center text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Wear{lockWear ? " · locked" : ""}
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="dust" label="Dust" min={0} max={1} format={fmtPct} def={0} size={44} color={cDust} />
        <FParamKnob paramKey="hiss" label="Hiss" min={0} max={1} format={fmtPct} def={0} size={44} color={cHiss} />
        <FParamKnob paramKey="hum" label="Hum" min={0} max={1} format={fmtPct} def={0} size={44} color={cHum} />
        <FParamKnob paramKey="printThrough" label="Print" min={0} max={1} format={fmtPct} def={0} size={44} color={cPrint} />
      </div>

      <div className="mt-2 mb-1 text-center text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Resolution{lockRes ? " · locked" : ""} · bits in header
      </div>
      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="sampleRateReduce" label="SR↓" min={0} max={1} format={fmtPct} def={0} size={44} color={cSrr} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Oxide archive — Macro/Evolve age the chamber · lock Medium/Motion/Wear/Resolution · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

// ════════════════════ Drive — Shape Crucible ════════════════════

const DRIVE_CHARS = [
  { id: "clean", label: "Clean", drive: 0, mode: "soft" as DriveMode, crush: 0, tone: 15000 },
  { id: "warm", label: "Warm", drive: 0.28, mode: "soft" as DriveMode, crush: 0, tone: 11000 },
  { id: "tube", label: "Tube", drive: 0.55, mode: "tube" as DriveMode, crush: 0.08, tone: 8500 },
  { id: "fold", label: "Fold", drive: 0.62, mode: "fold" as DriveMode, crush: 0, tone: 14000 },
  { id: "hard", label: "Hard", drive: 0.72, mode: "hard" as DriveMode, crush: 0.12, tone: 7500 },
  { id: "fuzz", label: "Fuzz", drive: 0.88, mode: "fuzz" as DriveMode, crush: 0.22, tone: 5500 },
  { id: "crush", label: "Crush", drive: 0.22, mode: "soft" as DriveMode, crush: 0.78, tone: 9000 },
  { id: "lofi", label: "LoFi", drive: 0.45, mode: "tube" as DriveMode, crush: 0.58, tone: 4200 },
] as const;

const DRIVE_MODES: { id: DriveMode; label: string }[] = [
  { id: "soft", label: "Soft" },
  { id: "tube", label: "Tube" },
  { id: "fold", label: "Fold" },
  { id: "hard", label: "Hard" },
  { id: "fuzz", label: "Fuzz" },
];

const DRIVE_TONES = [
  { label: "2k", v: 2000 },
  { label: "4k", v: 4000 },
  { label: "8k", v: 8000 },
  { label: "12k", v: 12000 },
  { label: "15k", v: 15000 },
  { label: "18k", v: 18000 },
] as const;

const DRIVE_MODE_CYCLE: DriveMode[] = ["soft", "tube", "fold", "hard", "fuzz"];

function driveNear(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function driveNearTone(a: number, b: number) {
  return Math.abs(Math.log2(Math.max(1000, a) / Math.max(1000, b))) < 0.18;
}

function DriveCharacterStrip() {
  const drive = useFireCommandStore((s) => s.patch.drive) ?? 0;
  const mode = (useFireCommandStore((s) => s.patch.driveMode) ?? "soft") as DriveMode;
  const crush = useFireCommandStore((s) => s.patch.crush) ?? 0;
  const tone = useFireCommandStore((s) => s.patch.tone) ?? 15000;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.drive;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Crucible
      </span>
      {DRIVE_CHARS.map((p) => {
        const on =
          (p.id === "clean" && drive < 0.03 && crush < 0.03) ||
          (p.id !== "clean" &&
            driveNear(drive, p.drive) &&
            mode === p.mode &&
            driveNear(crush, p.crush) &&
            driveNearTone(tone, p.tone));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("drive", p.drive);
              setParam("driveMode", p.mode);
              setParam("crush", p.crush);
              setParam("tone", p.tone);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function DriveModeStrip() {
  const mode = (useFireCommandStore((s) => s.patch.driveMode) ?? "soft") as DriveMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.drive;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Shape
      </span>
      {DRIVE_MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setParam("driveMode", m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.72)}99`,
                    background: `${bandShade(FC.fx, 0.72)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={`${m.label} transfer`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function DriveToneStrip() {
  const tone = useFireCommandStore((s) => s.patch.tone) ?? 15000;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.drive;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Tone
      </span>
      {DRIVE_TONES.map((p) => {
        const on = driveNearTone(tone, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("tone", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.85)}99`,
                    background: `${bandShade(FC.fx, 0.85)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtHz(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function DriveQuickActions() {
  const drive = useFireCommandStore((s) => s.patch.drive) ?? 0;
  const mode = (useFireCommandStore((s) => s.patch.driveMode) ?? "soft") as DriveMode;
  const crush = useFireCommandStore((s) => s.patch.crush) ?? 0;
  const tone = useFireCommandStore((s) => s.patch.tone) ?? 15000;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ drive: 0.45, mode: "tube" as DriveMode, crush: 0.1, tone: 9000 });
  const c = FC.drive;
  const idle = drive < 0.03 && crush < 0.03;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("drive", savedRef.current.drive);
            setParam("driveMode", savedRef.current.mode);
            setParam("crush", savedRef.current.crush);
            setParam("tone", savedRef.current.tone);
          } else {
            savedRef.current = { drive, mode, crush, tone };
            setParam("drive", 0);
            setParam("crush", 0);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore last forge" : "Bypass drive + crush"}
      >
        {idle ? "Ignite" : "Cool"}
      </button>
      <button
        type="button"
        onClick={() => {
          const i = DRIVE_MODE_CYCLE.indexOf(mode);
          setParam("driveMode", DRIVE_MODE_CYCLE[(i + 1) % DRIVE_MODE_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{
          borderColor: `${c}66`,
          color: bandShade(FC.fx, 0.92),
          background: `${c}22`,
        }}
        title="Cycle transfer curve"
      >
        Cycle
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("drive", 0.58);
          setParam("driveMode", "tube");
          setParam("crush", 0.1);
          setParam("tone", 8000);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Warm tube forge"
      >
        Forge
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("drive", 0);
          setParam("driveMode", "soft");
          setParam("crush", 0);
          setParam("tone", 15000);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset drive stage"
      >
        Reset
      </button>
    </div>
  );
}

function DriveModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function DrivePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.drive;
  const cDrv = bandShade(FC.fx, 0.5);
  const cCrush = bandShade(FC.fx, 0.72);
  const cTone = bandShade(FC.fx, 0.85);
  const cIn = bandShade(FC.fx, 0.45);
  const cOut = bandShade(FC.fx, 0.92);
  const drive = useFireCommandStore((s) => s.patch.drive) ?? 0;
  const mode = (useFireCommandStore((s) => s.patch.driveMode) ?? "soft") as DriveMode;
  const crush = useFireCommandStore((s) => s.patch.crush) ?? 0;
  const tone = useFireCommandStore((s) => s.patch.tone) ?? 15000;
  const autoGain = useFireCommandStore((s) => s.patch.driveAutoGain) !== false;
  const tonePos = (useFireCommandStore((s) => s.patch.driveTonePos) ?? "post") as DriveTonePos;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = drive > 0.02 || crush > 0.02;
  const toneN = Math.log(Math.max(1000, tone) / 1000) / Math.log(18000 / 1000);
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathDrive !== false;
  const tech = fxTechState("fx.drive", patch, { mix: live ? 1 : 0, pathOn });
  const thematic = live ? (crush > drive ? "Crush" : mode) : "Clean";

  return (
    <Section
      title="Drive"
      color={c}
      collapseKey="fx.drive"
      chipHosted={chipHosted}
      right={
        <FSeg<DriveMode>
          paramKey="driveMode"
          color={c}
          options={DRIVE_MODES}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Shape Crucible
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${mode} · D${Math.round(drive * 100)} · C${Math.round(crush * 100)} · ${fmtHz(tone)}`
                : `${mode} · clean`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DriveQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <DriveStageViz />
      <DriveCharacterStrip />
      <DriveModeStrip />
      <DriveToneStrip />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
          Tone Pos
        </span>
        {([
          { id: "pre" as const, label: "Pre" },
          { id: "post" as const, label: "Post" },
          { id: "both" as const, label: "Both" },
        ]).map((m) => {
          const on = tonePos === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setParam("driveTonePos", m.id)}
              className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
              style={
                on
                  ? {
                      borderColor: `${c}99`,
                      background: `${c}33`,
                      color: bandShade(FC.fx, 0.96),
                      boxShadow: `0 0 8px ${c}33`,
                    }
                  : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
              }
            >
              {m.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setParam("driveAutoGain", !autoGain)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
          style={
            autoGain
              ? {
                  borderColor: `${c}99`,
                  background: `${c}33`,
                  color: bandShade(FC.fx, 0.96),
                  boxShadow: `0 0 8px ${c}33`,
                }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
          }
          title="Auto-gain after drive"
        >
          {autoGain ? "● Auto-Gain" : "○ Auto-Gain"}
        </button>
      </div>

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <DriveModMeter label="Drive" value={drive} color={cDrv} format={() => fmtPct(drive)} />
        <DriveModMeter label="Crush" value={crush} color={cCrush} format={() => fmtPct(crush)} />
        <DriveModMeter label="Tone" value={toneN} color={cTone} format={() => fmtHz(tone)} />
        <DriveModMeter
          label="Shape"
          value={live ? 0.35 + DRIVE_MODE_CYCLE.indexOf(mode) * 0.15 : 0}
          color={bandShade(FC.fx, 0.62)}
          format={() => (live ? mode : "clean")}
        />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob paramKey="driveInGain" label="In" min={0} max={2} format={fmtRatio} def={1} size={44} color={cIn} />
        <FParamKnob paramKey="drive" label="Drive" min={0} max={1} format={fmtPct} def={0} size={52} color={cDrv} />
        <FParamKnob paramKey="crush" label="Crush" min={0} max={1} format={fmtPct} def={0} size={52} color={cCrush} />
        <FParamKnob paramKey="driveBias" label="Bias" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={bandShade(FC.fx, 0.6)} />
        <FParamKnob paramKey="driveSymmetry" label="Sym" min={-1} max={1} bipolar format={fmtBi} def={0} size={44} color={bandShade(FC.fx, 0.7)} />
        <FParamKnob paramKey="tone" label="Tone" min={1000} max={18000} curve="log" format={fmtHz} def={15000} size={52} color={cTone} />
        <FParamKnob paramKey="driveOutGain" label="Out" min={0} max={2} format={fmtRatio} def={1} size={44} color={cOut} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Shape Crucible — Soft/Tube/Fold/Hard/Fuzz are distinct transfers · Bias/Sym · Auto-gain · Tone {tonePos} · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

// ════════════════════ Macros — Helm Quartet ════════════════════

function MacrosPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = MACRO_C;
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const matrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["macros"] !== false);
  const vals = [m1, m2, m3, m4];
  const energy = Math.max(...vals);
  const wired = MACRO_KEYS.map((key) =>
    matrix.filter((r) => r.source === key && r.dest !== "none").map((r) => r.dest),
  );
  const routeCount = wired.reduce((n, r) => n + r.length, 0);
  const live = enabled && energy > 0.03;

  return (
    <Section title="Macros" color={c} collapseKey="macros" defaultCollapsed chipHosted={chipHosted} statusLine={!enabled ? "Off" : `On · energy ${Math.round(energy * 100)} · ${routeCount} route${routeCount === 1 ? "" : "s"}`}>
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: MACRO_C_GLOW }}>
            Helm Quartet
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : `Σ${Math.round(energy * 100)} · ${routeCount} route${routeCount === 1 ? "" : "s"} · ${macroStageLabel(vals)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="macros" />
          <MacroQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? MACRO_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {!enabled ? "Bypass — module offline" : macroStageLabel(vals)}
          </div>
        </div>
      </div>

      <MacroStageViz />
      <MacroCharacterStrip />
      <MacroSnapStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        {MACRO_KEYS.map((key, i) => (
          <MacroMeter key={key} label={`M${i + 1}`} value={vals[i]!} color={MACRO_HELM_COLORS[i]!} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MACRO_KEYS.map((key, i) => {
          const routes = matrix.filter((r) => r.source === key && r.dest !== "none");
          const color = MACRO_HELM_COLORS[i]!;
          return (
            <div
              key={key}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-black/25 px-2 py-2.5 transition"
              style={{
                borderColor: `${color}${vals[i]! > 0.05 ? "55" : "22"}`,
                boxShadow: vals[i]! > 0.08 ? `0 0 16px ${color}22` : undefined,
              }}
            >
              <FParamKnob
                paramKey={key}
                label={`Macro ${i + 1}`}
                min={0}
                max={1}
                format={fmtPct}
                def={0}
                color={color}
                size={52}
              />
              <PerfMidiLearnButton target={{ kind: "fireParam", key }} label={`Macro ${i + 1}`} />
              <div className="min-h-[28px] w-full text-center text-[9px] leading-tight">
                {routes.length ? (
                  <div className="flex flex-col gap-0.5">
                    {routes.slice(0, 3).map((r, ri) => {
                      const amt = Math.round(r.amount * 100);
                      const label = MOD_DEST_LABELS[r.dest] ?? r.dest;
                      const pol = r.amount < 0 || r.invert ? "−" : "+";
                      return (
                        <span key={`${r.dest}-${ri}`} style={{ color: `${color}cc` }}>
                          {label} {pol}{Math.abs(amt)}
                        </span>
                      );
                    })}
                    {routes.length > 3 ? (
                      <span className="text-white/30">+{routes.length - 3} more</span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-white/25">unpatched</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Helm quartet — drag ↕ each column, stamp a character, snap all four. Double-click cycles shapes.
        Levels feed the mod matrix · Bypass zeros every macro source.
      </div>
    </Section>
  );
}

// ════════════════════ Gate — Rhythm Shutter ════════════════════

function GatePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = GATE_C;
  const on = useFireCommandStore((s) => s.patch.gateOn);
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const steps = useFireCommandStore((s) => s.patch.gateSteps);
  const depth = useFireCommandStore((s) => s.patch.gateDepth);
  const smooth = useFireCommandStore((s) => s.patch.gateSmooth ?? 0);
  const rate = useFireCommandStore((s) => s.patch.gateRate) ?? 8;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["gate"] !== false);
  const setGateStep = useFireCommandStore((s) => s.setGateStep);
  const padRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const playStepRef = useRef(-1);

  useEffect(() => {
    const clearPlay = () => {
      const prev = playStepRef.current;
      if (prev >= 0) {
        const el = padRefs.current[prev];
        if (el) el.dataset.play = "0";
      }
      playStepRef.current = -1;
    };
    if (!on || !enabled) {
      clearPlay();
      return;
    }
    const id = window.setInterval(() => {
      let step = -1;
      try {
        step = activeFireEngine().getGateStep();
      } catch {
        step = -1;
      }
      if (step === playStepRef.current) return;
      const prev = playStepRef.current;
      if (prev >= 0) {
        const el = padRefs.current[prev];
        if (el) el.dataset.play = "0";
      }
      playStepRef.current = step;
      if (step >= 0) {
        const el = padRefs.current[step];
        if (el) el.dataset.play = "1";
      }
    }, 40);
    return () => {
      window.clearInterval(id);
      clearPlay();
    };
  }, [on, enabled]);

  const n = Math.max(2, Math.min(16, Math.round(steps)));
  const openCount = pattern.slice(0, n).filter((v) => v > 0.5).length;
  const live = on && enabled;
  const stage = gateStageLabel(on, enabled, depth, rate);
  const rateN = Math.log(Math.max(0.5, rate) / 0.5) / Math.log(24 / 0.5);
  const stepsN = (n - 2) / 14;

  return (
    <Section
      title="Trance Gate"
      color={c}
      collapseKey="gate"
      defaultCollapsed
      chipHosted={chipHosted}
      statusLine={!enabled ? "Off" : on ? `On · ${openCount}/${n} steps open` : "Armed · idle"}
      right={
        <span className="font-mono text-[10px]" style={{ color: `${c}aa` }}>
          {openCount}/{n}
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: GATE_C_GLOW }}>
            Rhythm Shutter
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : `${n}st · ${rate.toFixed(1)}Hz · D${Math.round(depth * 100)} · S${Math.round(smooth * 100)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="gate" />
          <GateQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? GATE_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stage}
          </div>
        </div>
      </div>

      <GateStageViz />
      <GateCharacterStrip />
      <GateRateStrip />
      <GateDepthStrip />
      <GateStepsStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <GateMeter label="Rate" value={rateN} color={GATE_C_RATE} format={() => `${rate.toFixed(1)}Hz`} />
        <GateMeter label="Depth" value={depth} color={GATE_C_DEPTH} format={() => `${Math.round(depth * 100)}%`} />
        <GateMeter label="Steps" value={stepsN} color={GATE_C_STEPS} format={() => `${n}`} />
        <GateMeter label="Edge" value={smooth} color={GATE_C_SMOOTH} format={() => `${Math.round(smooth * 100)}%`} />
        <GateMeter label="Open" value={openCount / Math.max(1, n)} color={GATE_C_GLOW} format={() => `${openCount}/${n}`} />
      </div>

      {/* Step pads — magenta shutter grid. Playhead via data-play (no React 25fps). */}
      <div
        className="mb-3 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {pattern.slice(0, n).map((v, i) => {
          const lit = v > 0.5;
          const isBeat = i % 4 === 0;
          return (
            <button
              key={i}
              type="button"
              ref={(el) => { padRefs.current[i] = el; }}
              data-play="0"
              data-lit={lit ? "1" : "0"}
              onClick={() => setGateStep(i, !lit)}
              className="relative h-12 rounded-lg border transition gate-step-pad"
              style={{
                borderColor: lit ? `${c}99` : isBeat ? `${c}33` : "rgba(255,255,255,0.1)",
                background: lit
                  ? `linear-gradient(180deg, ${c}55, ${c}18)`
                  : "rgba(255,255,255,0.03)",
                boxShadow: lit ? `inset 0 0 12px ${c}44` : "none",
                // CSS vars for the playhead highlight without re-rendering.
                ["--gate-c" as string]: c,
              }}
              title={`Step ${i + 1}${lit ? " · open" : " · closed"}`}
            >
              <span
                className="absolute bottom-1 left-0 right-0 text-center text-[8px] font-mono"
                style={{ color: lit ? `${GATE_C_GLOW}aa` : "rgba(255,255,255,0.3)" }}
              >
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
      <style>{`
        .gate-step-pad[data-play="1"] {
          border-color: #fff !important;
          background: linear-gradient(180deg, color-mix(in srgb, var(--gate-c) 60%, transparent), color-mix(in srgb, var(--gate-c) 27%, transparent)) !important;
          box-shadow: 0 0 18px color-mix(in srgb, var(--gate-c) 47%, transparent), inset 0 0 14px color-mix(in srgb, var(--gate-c) 33%, transparent) !important;
        }
      `}</style>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            { key: "gateRate" as const, label: "Rate", min: 0.5, max: 24, curve: "log" as const, format: fmtHzRate, def: 8, color: GATE_C_RATE, int: false },
            { key: "gateDepth" as const, label: "Depth", min: 0, max: 1, curve: undefined, format: fmtPct, def: 1, color: GATE_C_DEPTH, int: false },
            { key: "gateSteps" as const, label: "Steps", min: 2, max: 16, curve: undefined, format: fmtInt, def: 16, color: GATE_C_STEPS, int: true },
            { key: "gateSmooth" as const, label: "Edge", min: 0, max: 1, curve: undefined, format: fmtPct, def: 0, color: GATE_C_SMOOTH, int: false },
          ] as const
        ).map((k) => (
          <div
            key={k.key}
            className="flex flex-col items-center gap-1.5 rounded-xl border bg-black/25 px-2 py-2.5 transition"
            style={{
              borderColor: `${k.color}44`,
              boxShadow: live ? `0 0 14px ${k.color}18` : undefined,
            }}
          >
            <FParamKnob
              paramKey={k.key}
              label={k.label}
              min={k.min}
              max={k.max}
              curve={k.curve}
              integer={k.int || undefined}
              format={k.format}
              def={k.def}
              color={k.color}
              size={52}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Rhythm shutter — click steps, scrub depth (top) and rate (bottom). Double-click cycles chops.
        Edge melts chop into a pump · playhead rides the crest.
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
  { id: "fm", label: "FM Amount" }, { id: "pan", label: "Pan" }, { id: "volume", label: "Volume" },
  { id: "reverb", label: "Reverb" }, { id: "delay", label: "Delay" },
  { id: "chorusMix", label: "Chorus Mix" }, { id: "phaserMix", label: "Phaser Mix" },
  { id: "drive", label: "Drive" }, { id: "spectral", label: "Spectral" },
];
const SELECT_CLS = "bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-xs text-white/85 focus:outline-none cursor-pointer";

type MtxPreset = { source: ModSource; dest: ModDest; amount: number };

const MTX_CHARS: { id: string; label: string; routes: MtxPreset[] }[] = [
  { id: "idle", label: "Idle", routes: [] },
  { id: "trem", label: "Trem", routes: [{ source: "lfo1", dest: "volume", amount: 0.4 }] },
  { id: "wah", label: "Wah", routes: [{ source: "lfo1", dest: "cutoff", amount: 0.55 }] },
  {
    id: "morph",
    label: "Morph",
    routes: [
      { source: "modenv", dest: "wtA", amount: 0.6 },
      { source: "lfo2", dest: "wtB", amount: 0.35 },
    ],
  },
  {
    id: "vel",
    label: "Vel",
    routes: [
      { source: "velocity", dest: "cutoff", amount: 0.45 },
      { source: "velocity", dest: "levelA", amount: 0.3 },
    ],
  },
  {
    id: "macro",
    label: "Macro",
    routes: [
      { source: "macro1", dest: "cutoff", amount: 0.7 },
      { source: "macro1", dest: "fm", amount: 0.4 },
    ],
  },
  {
    id: "stereo",
    label: "Stereo",
    routes: [{ source: "lfo2", dest: "pan", amount: 0.55 }],
  },
  {
    id: "chaos",
    label: "Chaos",
    routes: [
      { source: "random", dest: "pitch", amount: 0.18 },
      { source: "random", dest: "cutoff", amount: 0.35 },
      { source: "lfo1", dest: "resonance", amount: 0.25 },
    ],
  },
];

function applyMtxRoutes(setModRoute: (i: number, p: Partial<ModRoute>) => void, routes: MtxPreset[]) {
  for (let i = 0; i < 12; i++) {
    const r = routes[i];
    if (r) setModRoute(i, { source: r.source, dest: r.dest, amount: r.amount });
    else setModRoute(i, { source: "none", dest: "none", amount: 0 });
  }
}

function MtxCharacterStrip() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  const c = FC.matrix;
  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none");
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Weave
      </span>
      {MTX_CHARS.map((p) => {
        const on =
          (p.id === "idle" && used.length === 0) ||
          (p.id !== "idle" &&
            p.routes.length > 0 &&
            p.routes.every((want) =>
              used.some((r) => r.source === want.source && r.dest === want.dest && Math.abs(r.amount - want.amount) < 0.12),
            ) &&
            used.length === p.routes.length);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => applyMtxRoutes(setModRoute, p.routes)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function MtxQuickActions() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  const savedRef = useRef<ModRoute[]>([]);
  const c = FC.matrix;
  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none");
  const idle = used.length === 0;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            if (savedRef.current.length) {
              savedRef.current.forEach((r, i) => setModRoute(i, r));
            } else {
              applyMtxRoutes(setModRoute, MTX_CHARS.find((x) => x.id === "morph")!.routes);
            }
          } else {
            savedRef.current = matrix.map((r) => ({ ...r }));
            applyMtxRoutes(setModRoute, []);
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.96) : bandShade(FC.mod, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Restore weave" : "Clear all cables"}
      >
        {idle ? "Wake" : "Clear"}
      </button>
      <button
        type="button"
        onClick={() => {
          matrix.forEach((r, i) => {
            if (r.source !== "none" && r.dest !== "none") setModRoute(i, { amount: -r.amount });
          });
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.9), background: `${c}1c` }}
        title="Flip polarity of all live amounts"
      >
        Flip
      </button>
      <button
        type="button"
        onClick={() =>
          applyMtxRoutes(
            setModRoute,
            MTX_CHARS.find((x) => x.id === "wah")!.routes.concat(MTX_CHARS.find((x) => x.id === "stereo")!.routes),
          )
        }
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.9), background: `${c}1c` }}
        title="Wah + stereo weave"
      >
        Loom
      </button>
      <button
        type="button"
        onClick={() => applyMtxRoutes(setModRoute, [])}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset matrix empty"
      >
        Reset
      </button>
    </div>
  );
}

function MtxModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.4rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function ModMatrixPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  const [view, setView] = useState<"grid" | "list">(() =>
    (localStorage.getItem("fire.matrixView") as "grid" | "list") ?? "list",
  );
  const pickView = (v: "grid" | "list") => {
    setView(v);
    try { localStorage.setItem("fire.matrixView", v); } catch { /* ignore */ }
  };
  const c = FC.matrix;
  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none");
  const live = used.length > 0;
  const avgMag = used.length ? used.reduce((a, r) => a + Math.abs(r.amount), 0) / used.length : 0;
  const posN = used.filter((r) => r.amount >= 0).length;
  const negN = used.filter((r) => r.amount < 0).length;

  return (
    <Section
      title="Modulation Matrix"
      color={c}
      collapseKey="matrix"
      chipHosted={chipHosted}
      right={
        <Seg<"grid" | "list">
          value={view}
          onChange={pickView}
          options={[{ id: "grid", label: "⊞ Bay" }, { id: "list", label: "☰ Slots" }]}
          color={c}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.96) }}>
            Patch Loom
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live ? `${used.length}/12 cables · avg ${Math.round(avgMag * 100)}%` : "12 slots · idle"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MtxQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {live ? `${used.length} Live` : "Idle"}
          </div>
        </div>
      </div>

      <MtxCharacterStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <MtxModMeter label="Cables" value={used.length / 12} color={c} format={() => `${used.length}/12`} />
        <MtxModMeter label="Depth" value={avgMag} color={bandShade(FC.mod, 0.78)} />
        <MtxModMeter label="+" value={posN / Math.max(1, used.length)} color={bandShade(FC.mod, 0.88)} format={() => String(posN)} />
        <MtxModMeter label={"\u2212"} value={negN / Math.max(1, used.length)} color={bandShade(FC.mod, 0.42)} format={() => String(negN)} />
      </div>

      {view === "grid" ? (
        <ModPatchGrid />
      ) : (
        <ModMatrixRows matrix={matrix} setModRoute={setModRoute} />
      )}
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Mod loom — Slots table is default · Bay for patch cells · ⌀/UNI/SM transform routes · GLOBAL badge (RETRIGGER later with MPE).
      </div>
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
  const c = FC.matrix;
  const cPos = bandShade(FC.mod, 0.88);
  const cNeg = bandShade(FC.mod, 0.42);
  return (
    <>
      <MatrixStageViz />
      <div className="mb-1.5 flex items-center gap-2 px-1.5 text-[8px] font-black uppercase tracking-wider text-white/35">
        <span className="w-4 text-center">#</span>
        <span className="min-w-[104px]">Source</span>
        <span className="w-3" />
        <span className="min-w-[116px]">Dest</span>
        <span className="flex-1" />
        <span className="w-16 text-center">Amt</span>
        <span className="w-14 text-center">Xform</span>
      </div>
      <div className="space-y-1.5">
        {matrix.map((r, i) => {
          const active = r.source !== "none" && r.dest !== "none";
          const col = !active ? "rgba(255,255,255,0.3)" : r.amount >= 0 ? cPos : cNeg;
          const destLabel = MOD_DEST_LABELS[r.dest] ?? r.dest;
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border px-1.5 py-1"
              style={{
                borderColor: active ? `${col}44` : "rgba(255,255,255,0.06)",
                background: active ? `${col}12` : "rgba(0,0,0,0.25)",
              }}
            >
              <span className="text-[10px] font-mono w-4 text-center" style={{ color: active ? col : "rgba(255,255,255,0.3)" }}>{i + 1}</span>
              <select
                value={r.source}
                onChange={(e) => setModRoute(i, { source: e.target.value as ModSource })}
                className={`${SELECT_CLS} min-w-[104px]`}
                style={{ borderColor: active ? `${c}44` : undefined }}
              >
                {MOD_SOURCE_OPTS.map((o) => <option key={o.id} value={o.id} className="bg-ink">{o.label}</option>)}
              </select>
              <span className="text-white/35 text-xs">→</span>
              <select
                value={r.dest}
                onChange={(e) => setModRoute(i, { dest: e.target.value as ModDest })}
                className={`${SELECT_CLS} min-w-[116px]`}
                style={{ borderColor: active ? `${c}44` : undefined }}
                title={destLabel}
              >
                {MOD_DEST_OPTS.map((o) => <option key={o.id} value={o.id} className="bg-ink">{o.label}</option>)}
              </select>
              <div className="flex-1 min-w-[16px]" />
              <input
                type="range" min={-1} max={1} step={0.01} value={r.amount}
                onChange={(e) => setModRoute(i, { amount: Number(e.target.value) })}
                disabled={!active}
                className="w-24 sm:w-36 cursor-pointer"
                style={{ accentColor: col, opacity: active ? 1 : 0.4 }}
              />
              <span className="text-[10px] font-mono w-10 text-right" style={{ color: col }}>{fmtBi(r.amount)}</span>
              <div className="flex items-center gap-0.5 w-14 justify-end">
                <button
                  type="button"
                  disabled={!active}
                  title="Invert polarity"
                  onClick={() => setModRoute(i, { invert: !r.invert })}
                  className="rounded border px-1 text-[8px] font-black"
                  style={{
                    borderColor: r.invert ? `${c}99` : "rgba(255,255,255,0.12)",
                    color: r.invert ? bandShade(FC.mod, 0.95) : "rgba(255,255,255,0.35)",
                    background: r.invert ? `${c}33` : "transparent",
                    opacity: active ? 1 : 0.35,
                  }}
                >⌀</button>
                <button
                  type="button"
                  disabled={!active}
                  title="Unipolar convert"
                  onClick={() => setModRoute(i, { unipolar: !r.unipolar })}
                  className="rounded border px-1 text-[8px] font-black"
                  style={{
                    borderColor: r.unipolar ? `${c}99` : "rgba(255,255,255,0.12)",
                    color: r.unipolar ? bandShade(FC.mod, 0.95) : "rgba(255,255,255,0.35)",
                    background: r.unipolar ? `${c}33` : "transparent",
                    opacity: active ? 1 : 0.35,
                  }}
                >UNI</button>
                <button
                  type="button"
                  disabled={!active}
                  title="Smooth / slew"
                  onClick={() => setModRoute(i, { smooth: (r.smooth ?? 0) > 0.2 ? 0 : 0.55 })}
                  className="rounded border px-1 text-[8px] font-black"
                  style={{
                    borderColor: (r.smooth ?? 0) > 0.2 ? `${c}99` : "rgba(255,255,255,0.12)",
                    color: (r.smooth ?? 0) > 0.2 ? bandShade(FC.mod, 0.95) : "rgba(255,255,255,0.35)",
                    background: (r.smooth ?? 0) > 0.2 ? `${c}33` : "transparent",
                    opacity: active ? 1 : 0.35,
                  }}
                >SM</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ════════════════════ arp panel — Cascade Orbit ════════════════════

const ARP_CHARS = [
  { id: "idle", label: "Idle", enabled: false, mode: "up" as const, bpm: 120, division: "1/16" as const, octaves: 1, gate: 0.6, swing: 0, ratchet: 0, accent: 0, accentEvery: 4, hold: false },
  { id: "pulse", label: "Pulse", enabled: true, mode: "up" as const, bpm: 128, division: "1/16" as const, octaves: 1, gate: 0.45, swing: 0, ratchet: 0, accent: 0.4, accentEvery: 4, hold: true },
  { id: "cascade", label: "Cascade", enabled: true, mode: "updown" as const, bpm: 110, division: "1/16" as const, octaves: 2, gate: 0.55, swing: 0.08, ratchet: 0, accent: 0.25, accentEvery: 4, hold: true },
  { id: "swing", label: "Swing", enabled: true, mode: "up" as const, bpm: 96, division: "1/8" as const, octaves: 1, gate: 0.5, swing: 0.22, ratchet: 0, accent: 0.35, accentEvery: 2, hold: true },
  { id: "ratchet", label: "Ratchet", enabled: true, mode: "up" as const, bpm: 140, division: "1/16" as const, octaves: 1, gate: 0.35, swing: 0, ratchet: 0.7, accent: 0.2, accentEvery: 4, hold: true },
  { id: "pedal", label: "Pedal", enabled: true, mode: "pedal" as const, bpm: 120, division: "1/16" as const, octaves: 2, gate: 0.6, swing: 0, ratchet: 0, accent: 0.5, accentEvery: 2, hold: true },
  { id: "chaos", label: "Chaos", enabled: true, mode: "random" as const, bpm: 132, division: "1/16" as const, octaves: 3, gate: 0.4, swing: 0.12, ratchet: 0.35, accent: 0.45, accentEvery: 3, hold: true },
] as const;

function ArpCharacterStrip({ arp, setArp }: { arp: ArpSettings; setArp: (p: Partial<ArpSettings>) => void }) {
  const c = FC.arp;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Orbit
      </span>
      {ARP_CHARS.map((p) => {
        const on =
          (p.id === "idle" && !arp.enabled) ||
          (p.id !== "idle" && arp.enabled && arp.mode === p.mode && Math.abs(arp.bpm - p.bpm) < 8 && Math.abs((arp.swing ?? 0) - p.swing) < 0.05);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() =>
              setArp({
                enabled: p.enabled,
                mode: p.mode,
                bpm: p.bpm,
                division: p.division,
                octaves: p.octaves,
                gate: p.gate,
                swing: p.swing,
                ratchet: p.ratchet,
                accent: p.accent,
                accentEvery: p.accentEvery,
                hold: p.hold,
              })
            }
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.mod, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ArpQuickActions({ arp, setArp }: { arp: ArpSettings; setArp: (p: Partial<ArpSettings>) => void }) {
  const savedRef = useRef<Partial<ArpSettings> | null>(null);
  const c = FC.arp;
  const idle = !arp.enabled;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            if (savedRef.current) setArp({ ...savedRef.current, enabled: true });
            else setArp({ enabled: true, hold: true, mode: "up", bpm: 128, division: "1/16", gate: 0.5 });
          } else {
            savedRef.current = { ...arp };
            setArp({ enabled: false });
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.mod, 0.96) : bandShade(FC.mod, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Arm arpeggiator" : "Disarm"}
      >
        {idle ? "Arm" : "Park"}
      </button>
      <button
        type="button"
        onClick={() => setArp({ hold: !arp.hold })}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{
          borderColor: arp.hold ? `${c}88` : `${c}44`,
          color: arp.hold ? bandShade(FC.mod, 0.96) : `${c}bb`,
          background: arp.hold ? `${c}38` : `${c}14`,
          boxShadow: arp.hold ? `0 0 12px ${c}44` : undefined,
        }}
        title="Latch held notes"
      >
        {arp.hold ? "Hold" : "Latch"}
      </button>
      <button
        type="button"
        onClick={() =>
          setArp({
            enabled: true,
            hold: true,
            mode: "updown",
            bpm: 120,
            division: "1/16",
            octaves: 2,
            gate: 0.55,
            swing: 0.1,
            accent: 0.35,
            accentEvery: 4,
            ratchet: 0,
          })
        }
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.mod, 0.9), background: `${c}1c` }}
        title="Musical cascade preset"
      >
        Cascade
      </button>
      <button
        type="button"
        onClick={() => setArp({ ...DEFAULT_ARP })}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset arp defaults"
      >
        Reset
      </button>
    </div>
  );
}

function ArpModMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
}) {
  const t = Math.min(1, Math.abs(value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.4rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function ArpPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const arp = useFireCommandStore((s) => s.arp);
  const setArp = useFireCommandStore((s) => s.setArp);
  const modes: { id: ArpMode; label: string }[] = [
    { id: "up", label: "Up" }, { id: "down", label: "Dn" },
    { id: "updown", label: "Up/Dn" }, { id: "downup", label: "Dn/Up" },
    { id: "converge", label: "Converge" }, { id: "diverge", label: "Diverge" },
    { id: "pedal", label: "Pedal" }, { id: "random", label: "Rnd" },
    { id: "walk", label: "Walk" }, { id: "asplayed", label: "Play" },
  ];
  const c = FC.arp;
  const cBpm = bandShade(FC.mod, 0.62);
  const cGate = bandShade(FC.mod, 0.8);
  const cSwing = bandShade(FC.mod, 0.88);
  const live = arp.enabled;
  const bpmN = Math.log(Math.max(40, arp.bpm) / 40) / Math.log(300 / 40);
  const gateN = (arp.gate - 0.1) / 0.9;
  const swingN = (arp.swing ?? 0) / 0.33;

  return (
    <Section
      title="Arpeggiator"
      color={c}
      collapseKey="arp"
      chipHosted={chipHosted}
      right={
        <button
          type="button"
          onClick={() => setArp({ hold: !arp.hold })}
          className="rounded-lg border px-3 py-1 text-xs font-medium transition"
          style={
            arp.hold
              ? { borderColor: `${c}88`, background: `${c}28`, color: bandShade(FC.mod, 0.96), boxShadow: `0 0 12px ${c}40` }
              : { borderColor: "rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)" }
          }
          title="Latch — keep arpeggiating after you let go"
        >
          {arp.hold ? "● Hold" : "Hold"}
        </button>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Mod
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.mod, 0.96) }}>
            Cascade Orbit
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${arp.mode} · ${arp.bpm} · ${arp.division} · ${arp.octaves}º`
                : `${arp.mode} · standby`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ArpQuickActions arp={arp} setArp={setArp} />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.mod, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {live ? (arp.hold ? "Hold" : "Armed") : "Off"}
          </div>
        </div>
      </div>

      <ArpStageViz />
      <ArpCharacterStrip arp={arp} setArp={setArp} />
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>Rate</span>
        <span className="rounded-md border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: `${c}44`, color: bandShade(FC.mod, 0.9) }}>
          HOST {arp.bpm} BPM · SYNC {arp.division}
        </span>
        <button
          type="button"
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
          style={{ borderColor: `${c}55`, color: `${c}cc`, background: `${c}14` }}
          title="Copy current arp contour into the Fire Sequencer pattern (stub writes held scale steps when possible)"
          onClick={() => {
            try {
              const seq = useFireSequencerStore.getState();
              const held = useFireCommandStore.getState().heldNotes;
              const base = held.length ? held : [60, 64, 67, 72];
              if (typeof (seq as unknown as { paintArpCapture?: (n: number[]) => void }).paintArpCapture === "function") {
                (seq as unknown as { paintArpCapture: (n: number[]) => void }).paintArpCapture(base);
              } else {
                // Soft stub: stash on window for MIDI-drag helpers later.
                (window as unknown as { __fireArpCapture?: number[] }).__fireArpCapture = base;
              }
            } catch { /* */ }
          }}
        >
          Copy → Seq
        </button>
      </div>

      <div className="mb-2 flex items-center justify-center gap-2 flex-wrap">
        <ArpModMeter label="BPM" value={bpmN} color={cBpm} format={() => String(Math.round(arp.bpm))} />
        <ArpModMeter label="Gate" value={gateN} color={cGate} />
        <ArpModMeter label="Swing" value={swingN} color={cSwing} format={() => `${Math.round((arp.swing ?? 0) * 300)}%`} />
        <ArpModMeter label="Ratch" value={arp.ratchet ?? 0} color={bandShade(FC.mod, 0.72)} />
        <ArpModMeter label="Acc" value={arp.accent ?? 0} color={bandShade(FC.mod, 0.92)} />
      </div>

      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_7.5rem] gap-x-3 gap-y-3 items-center">
        <button
          type="button"
          onClick={() => setArp({ enabled: !arp.enabled })}
          className="relative h-10 overflow-hidden rounded-xl border px-2 text-[11px] font-semibold tracking-wide transition"
          style={
            arp.enabled
              ? {
                  borderColor: `${c}99`,
                  background: `linear-gradient(180deg, ${c}40, ${c}18)`,
                  color: bandShade(FC.mod, 0.98),
                  boxShadow: `0 0 22px ${c}55`,
                }
              : { borderColor: "rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)" }
          }
        >
          {arp.enabled && (
            <span className="pointer-events-none absolute inset-0 animate-pulse" style={{ background: `radial-gradient(circle at 30% 40%, ${c}40, transparent 60%)` }} />
          )}
          <span className="relative">{arp.enabled ? "● ARMED" : "ARM"}</span>
        </button>

        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {modes.map((m) => {
            const active = arp.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setArp({ mode: m.id })}
                title={m.label}
                className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border px-0.5 text-[10px] font-medium uppercase tracking-wide transition"
                style={
                  active
                    ? {
                        borderColor: `${c}99`,
                        background: `${c}30`,
                        color: bandShade(FC.mod, 0.96),
                        boxShadow: `0 0 10px ${c}40`,
                      }
                    : { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.5)" }
                }
              >
                <ArpModeGlyph mode={m.id} active={active} />
                <span className="hidden text-[8px] leading-none xl:inline">{m.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex h-10 items-stretch rounded-lg border p-0.5" style={{ borderColor: `${c}22`, background: "rgba(0,0,0,0.25)" }} title="Octave span">
          {[1, 2, 3, 4].map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setArp({ octaves: o })}
              className="flex-1 rounded-md text-xs font-semibold transition"
              style={
                arp.octaves === o
                  ? { background: `${c}35`, color: bandShade(FC.mod, 0.96) }
                  : { color: "rgba(255,255,255,0.45)" }
              }
            >
              {o}º
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1">
          {(["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"] as ArpDivision[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setArp({ division: d })}
              className="h-7 rounded-md border font-mono text-[10px] transition"
              style={
                arp.division === d
                  ? { borderColor: `${c}88`, background: `${c}28`, color: bandShade(FC.mod, 0.96) }
                  : { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.5)" }
              }
            >
              {d}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-evenly gap-1 px-1">
          <KnobMini label="Tempo" value={arp.bpm} min={40} max={300} integer format={fmtBpm} onChange={(v) => setArp({ bpm: Math.round(v) })} />
          <KnobMini label="Gate" value={arp.gate} min={0.1} max={1} format={fmtPct} onChange={(v) => setArp({ gate: v })} />
          <KnobMini label="Swing" value={arp.swing ?? 0} min={0} max={0.33} format={(v) => `${Math.round(v * 300)}%`} onChange={(v) => setArp({ swing: v })} />
          <KnobMini label="Ratchet" value={arp.ratchet ?? 0} min={0} max={1} format={fmtPct} onChange={(v) => setArp({ ratchet: v })} />
          <KnobMini label="Accent" value={arp.accent ?? 0} min={0} max={1} format={fmtPct} onChange={(v) => setArp({ accent: v })} />
        </div>

        <div className="flex flex-col items-stretch gap-0.5" title="Velocity accents every N steps">
          <div className="flex h-7 items-stretch rounded-md border p-0.5" style={{ borderColor: `${c}22`, background: "rgba(0,0,0,0.25)" }}>
            {[2, 3, 4, 6, 8].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setArp({ accentEvery: n })}
                className="flex-1 rounded text-[10px] font-semibold transition"
                style={
                  (arp.accentEvery ?? 4) === n
                    ? { background: `${bandShade(FC.mod, 0.92)}35`, color: bandShade(FC.mod, 0.96) }
                    : { color: "rgba(255,255,255,0.4)" }
                }
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-center text-[9px] uppercase tracking-wide" style={{ color: `${c}77` }}>Every</span>
        </div>
      </div>

      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Cascade orbit — drag BPM↔ / Gate↕, scrub Swing, top click Arms, double-click cycles mode. Hold a chord to feed the path.
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

/**
 * Per-CC MPK readouts, isolated so controller knob twists re-render these
 * two leaves instead of the whole keybed.
 */
function MpkTelemetry({ enabled }: { enabled: boolean }) {
  const lastKnob = useFireMidiFocusStore((s) => s.lastKnobLabel);
  const lastCc = useFireMidiFocusStore((s) => s.lastCc);
  const knobsBound = useFireMidiFocusStore((s) => s.knobsBound);
  const knobSet = useFireMidiFocusStore((s) => s.knobSet);
  return (
    <>
      {lastKnob && (
        <span className="ml-2 text-[10px] font-mono text-white/70">· {lastKnob}</span>
      )}
      {enabled && !knobSet && (
        <span className="ml-2 text-[10px] font-mono text-amber-200/80">
          learn {knobsBound}/8{lastCc != null ? ` · CC${lastCc}` : ""}
        </span>
      )}
      {enabled && knobSet && lastCc != null && (
        <span className="ml-2 text-[9px] font-mono text-white/40">CC{lastCc}</span>
      )}
    </>
  );
}

/** One knob-cell name — tints while it is the last-touched MPK knob. */
function MpkKnobName({ label, color }: { label: string | null; color?: string }) {
  const hot = useFireMidiFocusStore((s) => !!label && s.lastKnobLabel === label);
  return (
    <div
      className={`truncate text-[9px] font-semibold ${label ? "text-white/80" : "text-white/20"}`}
      style={hot && label ? { color } : undefined}
    >
      {label ?? "—"}
    </div>
  );
}

function Keyboard({
  octave,
  onMinimize,
  onCycleMode,
  flush = false,
  midiLabel,
  midiHot = false,
  midiNote = null,
  onRescanMidi,
}: {
  octave: number;
  onMinimize: () => void;
  onCycleMode?: () => void;
  flush?: boolean;
  midiLabel?: string;
  midiHot?: boolean;
  midiNote?: number | null;
  onRescanMidi?: () => void;
}) {
  const heldNotes = useFireCommandStore((s) => s.heldNotes);
  const arpOrder = useFireCommandStore((s) => s.arpOrder);
  const arpCurrent = useFireCommandStore((s) => s.arpCurrent);
  const arpEnabled = useFireCommandStore((s) => s.arp.enabled);
  const setOctave = useFireCommandStore((s) => s.setOctave);
  const kbdVelGain = useFireCommandStore((s) => s.kbdVelGain);
  const kbdVelCurve = useFireCommandStore((s) => s.kbdVelCurve);
  const kbdDelayMs = useFireCommandStore((s) => s.kbdDelayMs);
  const kbdAttackMs = useFireCommandStore((s) => s.kbdAttackMs);
  const setKbdVelGain = useFireCommandStore((s) => s.setKbdVelGain);
  const setKbdVelCurve = useFireCommandStore((s) => s.setKbdVelCurve);
  const setKbdDelayMs = useFireCommandStore((s) => s.setKbdDelayMs);
  const setKbdAttackMs = useFireCommandStore((s) => s.setKbdAttackMs);
  const focusEnabled = useFireMidiFocusStore((s) => s.enabled);
  const focusIndex = useFireMidiFocusStore((s) => s.index);
  const focusBank = useFireMidiFocusStore((s) => s.bankPage);
  // lastKnob* / lastCc / knobsBound live in MpkTelemetry + MpkKnobName —
  // subscribing here re-rendered the entire keybed on every controller CC.
  const cycleNext = useFireMidiFocusStore((s) => s.cycleNext);
  const cyclePrev = useFireMidiFocusStore((s) => s.cyclePrev);
  const toggleBank = useFireMidiFocusStore((s) => s.toggleBank);
  const setFocusEnabled = useFireMidiFocusStore((s) => s.setEnabled);
  const relearnKnobs = useFireMidiFocusStore((s) => s.relearnKnobs);
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

  const focusMod = focusModuleAt(focusIndex);
  const focusMeta = FIRE_MODULE_BY_ID.get(focusMod.id);
  const focusPages = focusPageCount(focusMod);
  const focusKnobs = focusPageKnobs(focusMod, focusBank);

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

  const kbdWash = (
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 15% 0%, rgba(255,106,61,0.12), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 100%, rgba(98,182,255,0.08), transparent 50%)",
          }}
        />
  );

  const kbdInner = (
    <>
        {kbdWash}
        <div className="relative flex items-center justify-between mb-2.5 px-1 gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/55 font-semibold">Keyboard</div>
            <span className="hidden sm:inline text-[9px] text-white/30">live · velocity · qwerty</span>
            {midiLabel && (
              <span
                className="inline-flex items-center gap-1.5 max-w-[18rem] truncate rounded-md border px-1.5 py-0.5 text-[9px] font-semibold transition"
                style={
                  midiHot
                    ? {
                        color: "#ffd9c9",
                        borderColor: "rgba(255,106,61,0.55)",
                        background: "rgba(255,106,61,0.18)",
                        boxShadow: "0 0 12px rgba(255,106,61,0.35)",
                      }
                    : {
                        color: "rgba(255,255,255,0.45)",
                        borderColor: "rgba(255,255,255,0.1)",
                        background: "rgba(0,0,0,0.25)",
                      }
                }
                title={
                  "USB MIDI keys play the active Edit A/B target. On an Akai MPK Mini, Octave − / + shifts the keybed on the device. If no device shows, Rescan after plugging in (Electron needs MIDI permission — restart the app once after this update)."
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background: midiHot ? "#ff6a3d" : midiLabel.startsWith("No") || midiLabel.includes("unsupported") || midiLabel.includes("error") ? "rgba(255,80,80,0.7)" : "#6ee7b7",
                    boxShadow: midiHot ? "0 0 8px #ff6a3d" : undefined,
                  }}
                />
                <span className="truncate">{midiLabel}</span>
                {midiHot && midiNote != null && (
                  <span className="font-mono tabular-nums opacity-80">{noteName(midiNote)}</span>
                )}
                {onRescanMidi && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRescanMidi();
                    }}
                    className="shrink-0 rounded px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-white/55 hover:text-white hover:bg-white/10 transition"
                    title="Re-scan USB MIDI inputs"
                  >
                    Rescan
                  </button>
                )}
              </span>
            )}
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
            <div
              className="flex items-center gap-2 flex-wrap rounded-lg border border-white/10 bg-black/40 px-2 py-1"
              title="Live MIDI / keyboard feel — does not change the saved patch Amp Attack"
            >
              <label className="flex items-center gap-1.5 text-[9px] text-white/45" title="Boost soft USB key velocities">
                <span className="uppercase tracking-wider text-white/35 font-semibold">Vel</span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={kbdVelGain}
                  onChange={(e) => setKbdVelGain(Number(e.target.value))}
                  className="w-16 h-1.5 cursor-pointer"
                  style={{ accentColor: FIRE }}
                  aria-label="Live velocity gain"
                />
                <span className="font-mono tabular-nums text-white/55 w-8">{kbdVelGain.toFixed(2)}×</span>
              </label>
              <label className="flex items-center gap-1.5 text-[9px] text-white/45" title="Curve: lower expands soft hits, higher favors hard hits">
                <span className="uppercase tracking-wider text-white/35 font-semibold">Curve</span>
                <input
                  type="range"
                  min={0.35}
                  max={1.8}
                  step={0.05}
                  value={kbdVelCurve}
                  onChange={(e) => setKbdVelCurve(Number(e.target.value))}
                  className="w-14 h-1.5 cursor-pointer"
                  style={{ accentColor: FIRE }}
                  aria-label="Live velocity curve"
                />
                <span className="font-mono tabular-nums text-white/55 w-7">{kbdVelCurve.toFixed(2)}</span>
              </label>
              <label className="flex items-center gap-1.5 text-[9px] text-white/45" title="Tightens live amp attack (keyboard / MIDI only)">
                <span className="uppercase tracking-wider text-white/35 font-semibold">Atk</span>
                <input
                  type="range"
                  min={1}
                  max={80}
                  step={1}
                  value={kbdAttackMs}
                  onChange={(e) => setKbdAttackMs(Number(e.target.value))}
                  className="w-14 h-1.5 cursor-pointer"
                  style={{ accentColor: FIRE }}
                  aria-label="Live attack milliseconds"
                />
                <span className="font-mono tabular-nums text-white/55 w-8">{Math.round(kbdAttackMs)}ms</span>
              </label>
              <label className="flex items-center gap-1.5 text-[9px] text-white/45" title="Adds schedule delay after the key press (0 = ASAP)">
                <span className="uppercase tracking-wider text-white/35 font-semibold">Delay</span>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={kbdDelayMs}
                  onChange={(e) => setKbdDelayMs(Number(e.target.value))}
                  className="w-14 h-1.5 cursor-pointer"
                  style={{ accentColor: FIRE }}
                  aria-label="Live note delay milliseconds"
                />
                <span className="font-mono tabular-nums text-white/55 w-8">{Math.round(kbdDelayMs)}ms</span>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-white/35 hidden xl:block">Strike low = loud · Vel/Atk fix soft MIDI lag</div>
            <button
              onClick={onCycleMode ?? onMinimize}
              className="rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs text-white/70 transition"
              title="Cycle keyboard: Full → Strip → Hidden"
            >
              ▼ Size
            </button>
          </div>
        </div>

        {/* MPK Focus — Signal Path source + knob page */}
        <div
          className="relative mb-2.5 flex flex-col gap-1.5 rounded-lg border px-2 py-1.5"
          style={{
            borderColor: focusEnabled ? `${focusMeta?.color ?? FIRE}55` : "rgba(255,255,255,0.08)",
            background: focusEnabled
              ? `linear-gradient(90deg, ${focusMeta?.color ?? FIRE}22, rgba(0,0,0,0.35) 45%)`
              : "rgba(0,0,0,0.25)",
          }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setFocusEnabled(!focusEnabled)}
              className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition ${
                focusEnabled
                  ? "border-white/25 bg-white/15 text-white"
                  : "border-white/10 text-white/40 hover:text-white/70"
              }`}
              title="MPK Focus — when on, controller knobs drive this Signal Path module and PROG/pads step through the ring"
            >
              MPK Focus {focusEnabled ? "On" : "Off"}
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[8px] font-black uppercase tracking-[0.22em] text-white/40">
                Prog {focusIndex + 1}/{FIRE_FOCUS_COUNT}
                <span className="ml-1.5 font-semibold tracking-normal text-white/55">
                  {focusMeta?.bandTitle ?? "Signal Path"}
                </span>
              </div>
              <div className="truncate text-[12px] font-semibold" style={{ color: focusMeta?.color ?? FIRE }}>
                {focusMeta?.title ?? focusMod.id}
                {focusPages > 1 && (
                  <span className="ml-2 text-[10px] font-bold text-white/50">
                    Bank {String.fromCharCode(65 + focusBank)}
                  </span>
                )}
                <MpkTelemetry enabled={focusEnabled} />
              </div>
              {focusEnabled && (
                <div className="text-[8px] text-white/35 mt-0.5">
                  Pads cycle PROG (prev/next/bank) · keys still play ·{" "}
                  <button
                    type="button"
                    onClick={() => relearnKnobs()}
                    className="underline decoration-white/30 hover:text-white/70"
                  >
                    re-bind knobs
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => cyclePrev()}
                disabled={!focusEnabled}
                className="rounded-md border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-bold text-white/70 hover:bg-white/10 disabled:opacity-30 transition"
                title="Previous source"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => cycleNext()}
                disabled={!focusEnabled}
                className="rounded-md border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white/90 hover:bg-white/10 disabled:opacity-30 transition"
                style={{ borderColor: `${focusMeta?.color ?? FIRE}66`, background: `${focusMeta?.color ?? FIRE}28` }}
                title="Next Signal Path source (also: Program Change / CC 113)"
              >
                Prog
              </button>
              <button
                type="button"
                onClick={() => cycleNext()}
                disabled={!focusEnabled}
                className="rounded-md border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-bold text-white/70 hover:bg-white/10 disabled:opacity-30 transition"
                title="Next source"
              >
                ▶
              </button>
              <button
                type="button"
                onClick={() => toggleBank()}
                disabled={!focusEnabled || focusPages <= 1}
                className="rounded-md border border-white/15 bg-black/30 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white/75 hover:bg-white/10 disabled:opacity-30 transition"
                title="BANK A/B — next knob page when this module has more than 8 knobs (CC 114)"
              >
                Bank {String.fromCharCode(65 + focusBank)}
              </button>
            </div>
          </div>
          {focusEnabled && (
            <div className="grid grid-cols-8 gap-1">
              {focusKnobs.map((knob, i) => (
                <div
                  key={`fk${i}`}
                  className="min-w-0 rounded-md border border-white/8 bg-black/30 px-1 py-0.5 text-center"
                  title={knob ? `K${i + 1} → ${knob.label}` : `K${i + 1} unused on this bank`}
                >
                  <div className="text-[7px] font-black uppercase tracking-wider text-white/35">K{i + 1}</div>
                  <MpkKnobName label={knob?.label ?? null} color={focusMeta?.color} />
                </div>
              ))}
            </div>
          )}
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
    </>
  );

  return (
    <div className={`shrink-0 z-10 max-h-[min(42vh,420px)] overflow-y-auto overscroll-y-contain ${flush ? "rounded-b-2xl" : "pt-2"}`}>
      {flush ? (
        <div className="relative overflow-hidden p-3 rounded-b-2xl bg-gradient-to-b from-white/[0.03] to-black/40">
          {kbdInner}
        </div>
      ) : (
        <GlassPanel intense className="relative overflow-hidden p-3">
          {kbdInner}
        </GlassPanel>
      )}
    </div>
  );
}

// ════════════════════ store-bound controls ════════════════════

function FParamKnob({
  paramKey, label, min, max, curve = "lin", integer = false, bipolar = false, format, def, color = FIRE, size = 40,
  modEnv, modLfo,
}: {
  paramKey: NumericKey; label: string; min: number; max: number; curve?: "lin" | "log"; integer?: boolean;
  bipolar?: boolean; format: (v: number) => string; def?: number; color?: string; size?: number;
  modEnv?: number; modLfo?: number;
}) {
  const value = useFireCommandStore((s) => s.patch[paramKey]) as number;
  const setNum = useFireCommandStore((s) => s.setParam) as (k: NumericKey, v: number) => void;
  const onChange = useCallback((v: number) => setNum(paramKey, v), [setNum, paramKey]);
  // Every store-bound knob gets a true "default position" from the init
  // patch, so the reset button always lands somewhere musical.
  const fallbackDef = DEFAULT_FIRE_PATCH[paramKey] as number | undefined;
  const effDef = def ?? (typeof fallbackDef === "number" ? clamp(fallbackDef, Math.min(min, max), Math.max(min, max)) : undefined);
  return <Dial label={label} value={value} min={min} max={max} curve={curve} integer={integer} bipolar={bipolar} format={format} def={effDef} color={color} size={size} onChange={onChange} modEnv={modEnv} modLfo={modLfo} paramKey={String(paramKey)} />;
}

/**
 * Harmonizer module — Kin Halo · scale-locked companion notes on live input.
 * Follows the sequencer's Root/Scale controls; sequenced notes are untouched.
 */
function HarmonyPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = HARM_C;
  const mode = useFireCommandStore((s) => s.patch.harmonyMode) ?? "off";
  const level = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0.6;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["harmony"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const meta = HARMONY_MODES.find((m) => m.id === mode) ?? HARMONY_MODES[0]!;
  const voices = harmonyVoiceCount(mode);
  const live = enabled && mode !== "off" && level > 0.02;
  const stage = harmStageLabel(mode, enabled, level);

  return (
    <Section
      title="Harmony"
      color={c}
      collapseKey="harmony"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <span className="font-mono text-[10px]" style={{ color: `${c}aa` }}>
          {meta.short} · {Math.round(level * 100)}%
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: HARM_C_GLOW }}>
            Kin Halo
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : mode === "off"
                  ? "silent"
                  : `${meta.intervals} · ${voices}v · L${Math.round(level * 100)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="harmony" />
          <HarmQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? HARM_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stage}
          </div>
        </div>
      </div>

      <HarmonyStageViz />
      <HarmCharacterStrip />
      <HarmModeStrip />
      <HarmLevelStrip />
      <HarmScaleBadge />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <HarmMeter
          label="Mode"
          value={mode === "off" ? 0 : mode === "third" ? 0.25 : mode === "fifth" ? 0.5 : mode === "octave" ? 0.75 : 1}
          color={HARM_C_MODE}
          format={() => meta.short}
        />
        <HarmMeter label="Harmony Mix" value={level} color={HARM_C_LEVEL} format={() => `${Math.round(level * 100)}%`} />
        <PerfMidiLearnButton target={{ kind: "fireParam", key: "harmonyLevel" }} label="Harmony Mix" />
        <HarmMeter
          label="Voices"
          value={(voices - 1) / 2}
          color={HARM_C_ROOT}
          format={() => `${voices}v`}
        />
        <HarmMeter
          label="Kin"
          value={live ? level * (voices / 3) : 0}
          color={HARM_C_GLOW}
          format={() => (live ? meta.intervals : "—")}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_minmax(0,1fr)] items-stretch">
        <div
          className="flex flex-col justify-center gap-2 rounded-xl border bg-black/25 px-3 py-2.5"
          style={{ borderColor: `${HARM_C_MODE}44` }}
        >
          <div className="text-[7px] font-black uppercase tracking-wider text-center" style={{ color: `${HARM_C_MODE}aa` }}>
            Interval
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {HARMONY_MODES.map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setParam("harmonyMode", m.id)}
                  className="min-w-[3.2rem] rounded-lg border px-2 py-1.5 text-[10px] font-bold transition"
                  style={
                    on
                      ? {
                          borderColor: `${c}99`,
                          background: `linear-gradient(180deg, ${c}55, ${c}22)`,
                          color: HARM_C_GLOW,
                          boxShadow: `0 0 14px ${c}44`,
                        }
                      : {
                          borderColor: "rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.45)",
                          background: "rgba(0,0,0,0.3)",
                        }
                  }
                  title={m.intervals}
                >
                  {m.short}
                  <div className="mt-0.5 text-[8px] font-mono font-normal opacity-70">{m.intervals}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="flex flex-col items-center gap-1.5 rounded-xl border bg-black/25 px-2 py-2.5 transition"
          style={{
            borderColor: `${HARM_C_LEVEL}44`,
            boxShadow: live ? `0 0 14px ${HARM_C_LEVEL}18` : undefined,
          }}
        >
          <FParamKnob
            paramKey="harmonyLevel"
            label="Harmony Mix"
            min={0}
            max={1}
            format={fmtPct}
            def={0.6}
            color={HARM_C_LEVEL}
            size={56}
          />
        </div>
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Kin halo — click the constellation to cycle modes, scrub the level rail. Companions follow Patterns root + scale · live input only.
      </div>
    </Section>
  );
}

function ScalePanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = SCALE_C;
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scale"] !== false);
  const scaleRoot = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  const meta = scaleMeta(scaleId);
  const rootPc = ((scaleRoot % 12) + 12) % 12;
  const rootName = NOTE_NAMES[rootPc] ?? "?";
  const degCount = scaleId === "off" ? 12 : meta.steps.length;
  const live = enabled && lock && scaleId !== "off";
  const stage = scaleStageLabel(lock, enabled, scaleId);
  const modeIdx = Math.max(0, SCALES.findIndex((s) => s.id === scaleId));

  return (
    <Section
      title="Scale Lock"
      color={c}
      collapseKey="scale"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <span className="font-mono text-[10px]" style={{ color: `${c}aa` }}>
          {rootName} · {meta.label}
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: SCALE_C_GLOW }}>
            Key Lattice
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : !lock
                  ? "open"
                  : `${rootName} ${meta.label} · ${degCount}°`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="scale" />
          <ScaleQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? SCALE_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stage}
          </div>
        </div>
      </div>

      <ScaleStageViz />
      <ScaleCorrectStrip />
      <ScaleCharacterStrip />
      <ScaleRootStrip />
      <ScaleModeStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <ScaleMeter label="Root" value={rootPc / 11} color={SCALE_C_ROOT} format={() => rootName} />
        <ScaleMeter
          label="Mode"
          value={modeIdx / Math.max(1, SCALES.length - 1)}
          color={SCALE_C_MODE}
          format={() => (meta.id === "off" ? "Chr" : meta.label.slice(0, 6))}
        />
        <ScaleMeter label="Degrees" value={degCount / 12} color={SCALE_C_GLOW} format={() => `${degCount}°`} />
        <ScaleMeter label="Lock" value={enabled && lock ? 1 : 0} color={SCALE_C_LOCK} format={() => (lock && enabled ? "ON" : "OFF")} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_minmax(0,1fr)] items-stretch mb-1">
        <div
          className="rounded-xl border bg-black/25 px-2.5 py-2.5"
          style={{ borderColor: `${SCALE_C_MODE}44` }}
        >
          <div className="mb-1.5 text-center text-[7px] font-black uppercase tracking-wider" style={{ color: `${SCALE_C_MODE}aa` }}>
            Pitch Cage
          </div>
          <div className="grid grid-cols-12 gap-0.5">
            {NOTE_NAMES.map((name, i) => {
              const deg = (i - rootPc + 12) % 12;
              const inS = scaleId === "off" || meta.steps.includes(deg);
              const isRoot = i === rootPc;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setScaleRoot(i)}
                  className="relative h-10 rounded-md border text-[9px] font-bold transition"
                  style={{
                    borderColor: isRoot ? "#fff" : inS && lock ? `${c}88` : "rgba(255,255,255,0.08)",
                    background: isRoot
                      ? `linear-gradient(180deg, ${c}99, ${c}44)`
                      : inS && lock
                        ? `linear-gradient(180deg, ${c}44, ${c}14)`
                        : "rgba(255,255,255,0.03)",
                    color: isRoot || (inS && lock) ? SCALE_C_GLOW : "rgba(255,255,255,0.3)",
                    boxShadow: isRoot ? `0 0 12px ${c}55` : undefined,
                    opacity: lock && !inS && meta.id !== "off" ? 0.35 : 1,
                  }}
                  title={`${name}${isRoot ? " · root" : inS ? " · in scale" : " · out"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-black/25 px-3 py-2.5"
          style={{
            borderColor: `${SCALE_C_LOCK}44`,
            boxShadow: live ? `0 0 14px ${SCALE_C_LOCK}18` : undefined,
          }}
        >
          <button
            type="button"
            onClick={() => setParam("scaleLock", !lock)}
            className="w-full rounded-lg border px-3 py-2.5 text-[11px] font-black uppercase tracking-wider transition"
            style={
              lock
                ? {
                    borderColor: `${c}99`,
                    background: `linear-gradient(180deg, ${c}55, ${c}22)`,
                    color: SCALE_C_GLOW,
                    boxShadow: `0 0 16px ${c}44`,
                  }
                : {
                    borderColor: "rgba(255,255,255,0.15)",
                    background: "rgba(0,0,0,0.35)",
                    color: "rgba(255,255,255,0.5)",
                  }
            }
          >
            {lock ? "● Locked" : "Open"}
          </button>
          <div className="flex flex-wrap justify-center gap-1">
            {SCALES.filter((s) => s.id !== "off").slice(0, 4).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setScaleId(m.id)}
                className="rounded border px-1.5 py-0.5 text-[8px] font-bold"
                style={
                  scaleId === m.id
                    ? { borderColor: `${c}88`, color: SCALE_C_GLOW, background: `${c}28` }
                    : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
                }
              >
                {m.label.slice(0, 4)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Key lattice — click keys for root, top strip cycles scale, bottom toggles lock. Live input snaps when locked · Patterns share this root + mode.
      </div>
    </Section>
  );
}

function ChordPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = CHORD_C;
  const on = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const intervals = useFireCommandStore((s) => s.patch.chordIntervals);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["chord"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const ivs = normalizeChordIvs(intervals);
  const label = chordPresetLabel(ivs);
  const live = enabled && on;
  const stage = chordStageLabel(on, enabled, ivs);
  const span = Math.max(1, Math.max(...ivs.map(Math.abs)));

  return (
    <Section
      title="Chord Memory"
      color={c}
      collapseKey="chord"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <span className="font-mono text-[10px]" style={{ color: `${c}aa` }}>
          {label} · {ivs.length}v
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: CHORD_C_GLOW }}>
            Stack Vault
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : !on
                  ? "idle"
                  : `${label} · ${ivs.map((n) => (n === 0 ? "0" : `+${n}`)).join(" ")}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="chord" />
          <ChordQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? CHORD_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stage}
          </div>
        </div>
      </div>

      <ChordStageViz />
      <ChordCharacterStrip />
      <ChordDegreeStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <ChordMeter label="Voices" value={(ivs.length - 1) / 5} color={CHORD_C_VOICE} format={() => `${ivs.length}v`} />
        <ChordMeter label="Span" value={Math.min(1, span / 19)} color={CHORD_C_HOT} format={() => `${span}st`} />
        <ChordMeter label="Shape" value={live ? 1 : 0.2} color={CHORD_C_ROOT} format={() => label} />
        <ChordMeter label="Arm" value={live ? 1 : 0} color={CHORD_C_ARM} format={() => (live ? "ON" : "OFF")} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_minmax(0,1fr)] items-stretch mb-1">
        <div
          className="rounded-xl border bg-black/25 px-2.5 py-2.5"
          style={{ borderColor: `${CHORD_C_VOICE}44` }}
        >
          <div className="mb-1.5 text-center text-[7px] font-black uppercase tracking-wider" style={{ color: `${CHORD_C_VOICE}aa` }}>
            Interval Stack
          </div>
          <div className="flex flex-col gap-1">
            {ivs.map((iv, i) => {
              const isRoot = iv === 0;
              return (
                <div key={`${iv}-${i}`} className="flex items-center gap-2">
                  <span
                    className="w-10 shrink-0 text-right font-mono text-[10px] font-bold"
                    style={{ color: isRoot ? CHORD_C_ROOT : CHORD_C_VOICE }}
                  >
                    {isRoot ? "ROOT" : `+${iv}`}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-black/50 border border-white/10">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-100"
                      style={{
                        width: `${(Math.abs(iv) / Math.max(12, span)) * 100}%`,
                        minWidth: isRoot ? 8 : undefined,
                        background: `linear-gradient(90deg, ${isRoot ? CHORD_C_ROOT : CHORD_C_VOICE}66, ${c})`,
                        boxShadow: live ? `0 0 8px ${c}66` : undefined,
                      }}
                    />
                  </div>
                  {!isRoot && (
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const next = ivs.slice();
                          next[i] = Math.max(1, iv - 1);
                          setParam("chordIntervals", normalizeChordIvs(next));
                        }}
                        className="h-6 w-6 rounded border text-[10px] font-bold"
                        style={{ borderColor: `${c}44`, color: CHORD_C_GLOW, background: `${c}18` }}
                        title="−1 semitone"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = ivs.slice();
                          next[i] = Math.min(24, iv + 1);
                          setParam("chordIntervals", normalizeChordIvs(next));
                        }}
                        className="h-6 w-6 rounded border text-[10px] font-bold"
                        style={{ borderColor: `${c}44`, color: CHORD_C_GLOW, background: `${c}18` }}
                        title="+1 semitone"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = ivs.filter((_, j) => j !== i);
                          setParam("chordIntervals", normalizeChordIvs(next.length ? next : [0, 4, 7]));
                        }}
                        className="h-6 w-6 rounded border text-[10px] font-bold"
                        style={{ borderColor: `${c}44`, color: "rgba(255,180,200,0.7)", background: "rgba(0,0,0,0.3)" }}
                        title="Remove voice"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-black/25 px-3 py-2.5"
          style={{
            borderColor: `${CHORD_C_ARM}44`,
            boxShadow: live ? `0 0 14px ${CHORD_C_ARM}18` : undefined,
          }}
        >
          <button
            type="button"
            onClick={() => setParam("chordMemoryOn", !on)}
            className="w-full rounded-lg border px-3 py-2.5 text-[11px] font-black uppercase tracking-wider transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `linear-gradient(180deg, ${c}55, ${c}22)`,
                    color: CHORD_C_GLOW,
                    boxShadow: `0 0 16px ${c}44`,
                  }
                : {
                    borderColor: "rgba(255,255,255,0.15)",
                    background: "rgba(0,0,0,0.35)",
                    color: "rgba(255,255,255,0.5)",
                  }
            }
          >
            {on ? "● Armed" : "Idle"}
          </button>
          <div className="flex flex-wrap justify-center gap-1">
            {CHORD_PRESETS.slice(0, 6).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setParam("chordIntervals", [...p.ivs]);
                  setParam("chordMemoryOn", true);
                }}
                className="rounded border px-1.5 py-0.5 text-[8px] font-bold"
                style={
                  chordPresetLabel(ivs) === p.short
                    ? { borderColor: `${c}88`, color: CHORD_C_GLOW, background: `${c}28` }
                    : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
                }
              >
                {p.short}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Stack vault — scrub voice bars to set intervals, top cycles voicings, bottom arms memory. Learn captures held notes · every key fires the stack.
      </div>
    </Section>
  );
}

function HumanPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = HUMAN_C;
  const on = useFireCommandStore((s) => s.patch.humanizeOn);
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming) ?? 0.25;
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity) ?? 0.2;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["human"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const energy = (timing + vel) * 0.5;
  const live = enabled && on && energy > 0.02;
  const stage = humanStageLabel(on, enabled, timing, vel);
  const char = humanCharMatch(timing, vel, on);

  return (
    <Section
      title="Humanize"
      color={c}
      collapseKey="human"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <span className="font-mono text-[10px]" style={{ color: `${c}aa` }}>
          T{Math.round(timing * 100)} · V{Math.round(vel * 100)}
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: HUMAN_C_GLOW }}>
            Feel Grain
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : !on
                  ? "grid"
                  : `${char?.label ?? "Custom"} · T${Math.round(timing * 100)} V${Math.round(vel * 100)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="human" />
          <HumanQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? HUMAN_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stage}
          </div>
        </div>
      </div>

      <HumanStageViz />
      <HumanCharacterStrip />
      <HumanTimingStrip />
      <HumanVelStrip />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <HumanMeter label="Timing" value={timing} color={HUMAN_C_TIME} format={() => `${Math.round(timing * 100)}%`} />
        <HumanMeter label="Vel" value={vel} color={HUMAN_C_VEL} format={() => `${Math.round(vel * 100)}%`} />
        <HumanMeter label="Feel" value={live ? energy : 0} color={HUMAN_C_GLOW} format={() => (live ? `${Math.round(energy * 100)}` : "0")} />
        <HumanMeter label="Arm" value={live ? 1 : 0} color={HUMAN_C_ARM} format={() => (live ? "ON" : "OFF")} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-stretch mb-1">
        <div
          className="flex flex-col items-center gap-1.5 rounded-xl border bg-black/25 px-2 py-2.5 transition"
          style={{
            borderColor: `${HUMAN_C_TIME}44`,
            boxShadow: live && timing > 0.05 ? `0 0 14px ${HUMAN_C_TIME}18` : undefined,
          }}
        >
          <FParamKnob
            paramKey="humanizeTiming"
            label="Timing"
            min={0}
            max={1}
            format={fmtPct}
            def={0.25}
            color={HUMAN_C_TIME}
            size={52}
          />
        </div>
        <div
          className="flex flex-col items-center gap-1.5 rounded-xl border bg-black/25 px-2 py-2.5 transition"
          style={{
            borderColor: `${HUMAN_C_VEL}44`,
            boxShadow: live && vel > 0.05 ? `0 0 14px ${HUMAN_C_VEL}18` : undefined,
          }}
        >
          <FParamKnob
            paramKey="humanizeVelocity"
            label="Velocity"
            min={0}
            max={1}
            format={fmtPct}
            def={0.2}
            color={HUMAN_C_VEL}
            size={52}
          />
        </div>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-black/25 px-3 py-2.5"
          style={{
            borderColor: `${HUMAN_C_ARM}44`,
            boxShadow: live ? `0 0 14px ${HUMAN_C_ARM}18` : undefined,
          }}
        >
          <button
            type="button"
            onClick={() => setParam("humanizeOn", !on)}
            className="w-full rounded-lg border px-3 py-2.5 text-[11px] font-black uppercase tracking-wider transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `linear-gradient(180deg, ${c}55, ${c}22)`,
                    color: HUMAN_C_GLOW,
                    boxShadow: `0 0 16px ${c}44`,
                  }
                : {
                    borderColor: "rgba(255,255,255,0.15)",
                    background: "rgba(0,0,0,0.35)",
                    color: "rgba(255,255,255,0.5)",
                  }
            }
          >
            {on ? "● Feel" : "Grid"}
          </button>
        </div>
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Feel grain — drag the pad (X timing · Y velocity), top cycles characters, bottom arms feel. Timing jitters pattern playback · velocity colors live hits · Bake writes into notes.
      </div>
    </Section>
  );
}

function ScenesPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = SCENES_C;
  const scenes = useFireCommandStore((s) => s.scenes);
  const editTarget = useFireCommandStore((s) => s.editTarget);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scenes"] !== false);
  const captureScene = useFireCommandStore((s) => s.captureScene);
  const recallScene = useFireCommandStore((s) => s.recallScene);
  const clearScene = useFireCommandStore((s) => s.clearScene);
  const [mode, setMode] = useState<SceneMode>("recall");
  const [activeSlot, setActiveSlot] = useState(0);
  const occ = occupiedCount(scenes);
  const energy = avgSceneEnergy(scenes);
  const live = enabled && occ > 0;
  const stage = sceneStageLabel(occ, mode, enabled);
  const modeMeta = SCENE_MODES.find((m) => m.id === mode) ?? SCENE_MODES[0]!;
  const targetTag = editTarget === "b" ? "B" : "A";

  const act = (i: number) => {
    setActiveSlot(i);
    if (mode === "capture") captureScene(i);
    else if (mode === "recall") {
      if (scenes[i]) recallScene(i);
    } else if (scenes[i]) clearScene(i);
  };

  return (
    <Section
      title="Scenes"
      color={c}
      collapseKey="scenes"
      chipHosted={chipHosted}
      defaultCollapsed
      right={
        <span className="font-mono text-[10px]" style={{ color: `${c}aa` }}>
          →{targetTag} · {occ}/{SCENE_SLOTS}
        </span>
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · Perf · Synth {targetTag}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: SCENES_C_GLOW }}>
            Orbit Vault
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {!enabled
                ? "bypass"
                : `${modeMeta.short} → ${targetTag} · ${occ}/${SCENE_SLOTS} saved · energy ${Math.round(energy * 100)}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
          <PerfScopeBadge moduleId="scenes" />
          <ScenesQuickActions mode={mode} onModeChange={setMode} onActiveSlot={setActiveSlot} />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? SCENES_C_GLOW : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {stage}
          </div>
        </div>
      </div>

      <ScenesStageViz
        mode={mode}
        onModeChange={setMode}
        activeSlot={activeSlot}
        onActiveSlot={setActiveSlot}
      />
      <ScenesModeStrip mode={mode} onModeChange={setMode} />

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <ScenesMeter label="Slots" value={occ / SCENE_SLOTS} color={SCENES_C_FILL} format={() => `${occ}/${SCENE_SLOTS}`} />
        <ScenesMeter label="Energy" value={energy} color={SCENES_C_HOT} format={() => `${Math.round(energy * 100)}`} />
        <ScenesMeter
          label="Mode"
          value={mode === "capture" ? 0.33 : mode === "recall" ? 0.66 : 1}
          color={SCENES_C_MODE}
          format={() => modeMeta.short}
        />
        <ScenesMeter label="Active" value={(activeSlot + 1) / SCENE_SLOTS} color={SCENES_C_GLOW} format={() => `${activeSlot + 1}`} />
      </div>

      <div className="mt-1 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {Array.from({ length: SCENE_SLOTS }, (_, i) => {
          const snap = scenes[i];
          const filled = !!snap;
          const fp = sceneFingerprint(snap);
          const focused = activeSlot === i;
          return (
            <div
              key={i}
              className="flex flex-col gap-0.5 rounded-xl border p-1.5 transition"
              style={{
                borderColor: focused ? `${c}99` : filled ? `${c}55` : "rgba(255,255,255,0.1)",
                background: filled
                  ? `linear-gradient(180deg, ${c}${Math.round(20 + fp.energy * 30).toString(16).padStart(2, "0")}, ${c}0c)`
                  : "rgba(0,0,0,0.25)",
                boxShadow: focused ? `0 0 14px ${c}44` : filled ? `0 0 8px ${c}18` : undefined,
              }}
            >
              <button
                type="button"
                onClick={() => act(i)}
                className="relative h-9 rounded-lg border text-[11px] font-black transition"
                style={{
                  borderColor: filled ? `${c}77` : "rgba(255,255,255,0.08)",
                  background: filled
                    ? `radial-gradient(circle at 50% 40%, ${SCENES_C_GLOW}55, ${c}22)`
                    : "rgba(255,255,255,0.03)",
                  color: filled ? SCENES_C_GLOW : SCENES_C_EMPTY,
                }}
                title={
                  mode === "capture"
                    ? `Capture to slot ${i + 1}`
                    : mode === "recall"
                      ? filled
                        ? `Recall slot ${i + 1}`
                        : `Empty · ${i + 1}`
                      : filled
                        ? `Clear slot ${i + 1}`
                        : `Empty · ${i + 1}`
                }
              >
                {i + 1}
                {filled && (
                  <span
                    className="absolute bottom-0.5 left-1 right-1 h-0.5 rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${c}33, ${c})`,
                      width: `${Math.max(20, fp.energy * 100)}%`,
                      margin: "0 auto",
                    }}
                  />
                )}
              </button>
              <div className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setMode("capture");
                    setActiveSlot(i);
                    captureScene(i);
                  }}
                  className="flex-1 rounded px-0.5 py-0.5 text-[8px] font-bold border transition"
                  style={{ borderColor: `${c}33`, color: SCENES_C_GLOW, background: `${c}14` }}
                  title={`Capture → ${i + 1}`}
                >
                  Cap
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!filled) return;
                    setMode("recall");
                    setActiveSlot(i);
                    recallScene(i);
                  }}
                  disabled={!filled}
                  className="flex-1 rounded px-0.5 py-0.5 text-[8px] font-bold border transition disabled:opacity-25"
                  style={{
                    borderColor: filled ? `${c}66` : "rgba(255,255,255,0.08)",
                    color: filled ? SCENES_C_GLOW : "rgba(255,255,255,0.25)",
                    background: filled ? `${c}28` : "transparent",
                  }}
                  title={`Recall ${i + 1}`}
                >
                  Rec
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!filled) return;
                    setMode("clear");
                    setActiveSlot(i);
                    clearScene(i);
                  }}
                  disabled={!filled}
                  className="flex-1 rounded px-0.5 py-0.5 text-[8px] font-bold border transition disabled:opacity-25"
                  style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,200,220,0.55)" }}
                  title={`Clear ${i + 1}`}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Orbit vault — click nodes to {mode}, top cycles Capture/Recall/Clear, bottom fills the next empty slot. Each gem fingerprints the stored patch.
      </div>
    </Section>
  );
}

/**
 * Spectral — Bin Lattice panel (STFT worklet between reverb and autopan).
 * Amount meaning follows mode: Hold / Time / Thresh / Shift.
 */

const SPECTRAL_CHARS = [
  { id: "off", label: "Off", mode: "off" as SpectralMode, amount: 0.6, mix: 0.5 },
  { id: "freeze", label: "Freeze", mode: "freeze" as SpectralMode, amount: 0.85, mix: 0.7 },
  { id: "smear", label: "Smear", mode: "smear" as SpectralMode, amount: 0.65, mix: 0.55 },
  { id: "gate", label: "Gate", mode: "gate" as SpectralMode, amount: 0.45, mix: 0.6 },
  { id: "shift", label: "Shift+", mode: "shift" as SpectralMode, amount: 0.75, mix: 0.55 },
  { id: "shiftDown", label: "Shift−", mode: "shift" as SpectralMode, amount: 0.25, mix: 0.55 },
  { id: "wash", label: "Wash", mode: "smear" as SpectralMode, amount: 0.9, mix: 0.8 },
] as const;

const SPECTRAL_MODES: { id: SpectralMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "freeze", label: "Freeze" },
  { id: "smear", label: "Smear" },
  { id: "gate", label: "Gate" },
  { id: "shift", label: "Shift" },
];

const SPECTRAL_MODE_CYCLE: SpectralMode[] = ["off", "freeze", "smear", "gate", "shift"];
const SPECTRAL_MIXES = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

function spectralNear(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function spectralAmountLabel(mode: SpectralMode) {
  return mode === "freeze" ? "Hold" : mode === "smear" ? "Time" : mode === "gate" ? "Thresh" : mode === "shift" ? "Shift" : "Amount";
}

function spectralFmtAmount(mode: SpectralMode, v: number) {
  if (mode === "shift") return `${v < 0.5 ? "−" : "+"}${Math.round(Math.abs(v * 2 - 1) * 100)}%`;
  return fmtPct(v);
}

function SpectralCharacterStrip() {
  const mode = (useFireCommandStore((s) => s.patch.spectralMode) ?? "off") as SpectralMode;
  const amount = useFireCommandStore((s) => s.patch.spectralAmount) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.spectral;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Lattice
      </span>
      {SPECTRAL_CHARS.map((p) => {
        const on =
          (p.id === "off" && mode === "off") ||
          (p.id !== "off" &&
            mode === p.mode &&
            spectralNear(amount, p.amount) &&
            spectralNear(mix, p.mix));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("spectralMode", p.mode);
              setParam("spectralAmount", p.amount);
              setParam("spectralMix", p.mix);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function SpectralModeStrip() {
  const mode = (useFireCommandStore((s) => s.patch.spectralMode) ?? "off") as SpectralMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.spectral;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Mode
      </span>
      {SPECTRAL_MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setParam("spectralMode", m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.78)}99`,
                    background: `${bandShade(FC.fx, 0.78)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={m.label}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function SpectralMixStrip() {
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.spectral;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Mix
      </span>
      {SPECTRAL_MIXES.map((p) => {
        const on = spectralNear(mix, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("spectralMix", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${bandShade(FC.fx, 0.88)}99`,
                    background: `${bandShade(FC.fx, 0.88)}28`,
                    color: bandShade(FC.fx, 0.96),
                    boxShadow: `0 0 8px ${c}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.25)" }
            }
            title={fmtPct(p.v)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function SpectralQuickActions() {
  const mode = (useFireCommandStore((s) => s.patch.spectralMode) ?? "off") as SpectralMode;
  const amount = useFireCommandStore((s) => s.patch.spectralAmount) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const setParam = useFireCommandStore((s) => s.setParam);
  const savedRef = useRef({ mode: "freeze" as SpectralMode, amount: 0.8, mix: 0.65 });
  const c = FC.spectral;
  const idle = mode === "off";
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (idle) {
            setParam("spectralMode", savedRef.current.mode === "off" ? "freeze" : savedRef.current.mode);
            setParam("spectralAmount", savedRef.current.amount);
            setParam("spectralMix", savedRef.current.mix);
          } else {
            savedRef.current = { mode, amount, mix };
            setParam("spectralMode", "off");
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: idle ? `${c}88` : `${c}66`,
          color: idle ? bandShade(FC.fx, 0.96) : bandShade(FC.fx, 0.8),
          background: idle ? `${c}40` : `${c}22`,
          boxShadow: idle ? `0 0 14px ${c}55` : `0 0 8px ${c}28`,
        }}
        title={idle ? "Arm lattice" : "Bypass spectral"}
      >
        {idle ? "Arm" : "Park"}
      </button>
      <button
        type="button"
        onClick={() => {
          const i = SPECTRAL_MODE_CYCLE.indexOf(mode);
          setParam("spectralMode", SPECTRAL_MODE_CYCLE[(i + 1) % SPECTRAL_MODE_CYCLE.length]!);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}66`, color: bandShade(FC.fx, 0.92), background: `${c}22` }}
        title="Cycle mode"
      >
        Mode↻
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("spectralMode", "freeze");
          setParam("spectralAmount", 0.85);
          setParam("spectralMix", 0.7);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}55`, color: bandShade(FC.fx, 0.9), background: `${c}1c` }}
        title="Freeze hold"
      >
        Freeze
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("spectralMode", "off");
          setParam("spectralAmount", 0.6);
          setParam("spectralMix", 0.5);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${c}44`, color: `${c}bb`, background: `${c}14` }}
        title="Reset spectral defaults"
      >
        Reset
      </button>
    </div>
  );
}

function SpectralModMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format?: (v: number) => string;
  bipolar?: boolean;
}) {
  const t = Math.min(1, Math.abs(bipolar ? value * 2 - 1 : value));
  const display = format ? format(value) : String(Math.round(t * 100));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${display}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        {bipolar ? (
          <>
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
              style={{
                left: value >= 0.5 ? "50%" : `${50 - t * 50}%`,
                width: `${t * 50}%`,
                background: `linear-gradient(90deg, ${color}55, ${color})`,
                boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
              }}
            />
          </>
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${t * 100}%`,
              background: `linear-gradient(90deg, ${color}55, ${color})`,
              boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
            }}
          />
        )}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {display}
      </div>
    </div>
  );
}

function SpectralPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const c = FC.spectral;
  const cAmt = bandShade(FC.fx, 0.7);
  const cMix = bandShade(FC.fx, 0.88);
  const cLow = bandShade(FC.fx, 0.55);
  const cHigh = bandShade(FC.fx, 0.8);
  const mode = (useFireCommandStore((s) => s.patch.spectralMode) ?? "off") as SpectralMode;
  const amount = useFireCommandStore((s) => s.patch.spectralAmount) ?? 0.6;
  const mix = useFireCommandStore((s) => s.patch.spectralMix) ?? 0.5;
  const fftSize = useFireCommandStore((s) => s.patch.spectralFftSize) ?? 2048;
  const wetOnly = useFireCommandStore((s) => s.patch.spectralWetOnly) ?? false;
  const setParam = useFireCommandStore((s) => s.setParam);
  const live = mode !== "off";
  const amountLabel = spectralAmountLabel(mode);
  const patch = useFireCommandStore((s) => s.patch);
  const pathOn = patch.pathFx !== false;
  const tech = fxTechState("fx.spectral", patch, { mix: live ? mix : 0, pathOn });
  const quality = (patch.fxQuality ?? "live") as FxQuality;
  const thematic = live ? `${mode} · ${FX_QUALITY_LABELS[quality]}` : "Off";

  return (
    <Section
      title="Spectral"
      color={c}
      collapseKey="fx.spectral"
      chipHosted={chipHosted}
      right={
        <Seg<SpectralMode>
          value={mode}
          onChange={(v) => useFireCommandStore.getState().setParam("spectralMode", v)}
          options={SPECTRAL_MODES}
          color={c}
        />
      }
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: live ? `${c}48` : `${c}28`,
          background: live
            ? `linear-gradient(105deg, ${c}28 0%, ${c}0c 38%, transparent 72%)`
            : `linear-gradient(180deg, rgba(0,0,0,0.4), ${c}0c)`,
          boxShadow: live ? `inset 0 1px 0 ${c}28, 0 0 18px ${c}18` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}99` }}>
            Signal Path · FX · {fxTechBadge(tech)} · {FX_QUALITY_LABELS[quality]}
          </div>
          <div className="truncate text-[13px] font-semibold" style={{ color: bandShade(FC.fx, 0.96) }}>
            Bin Lattice
            <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
              {live
                ? `${mode} · ${amountLabel} ${spectralFmtAmount(mode, amount)} · M${Math.round(mix * 100)}`
                : "off · bypass"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SpectralQuickActions />
          <div
            className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
            style={{
              color: live ? bandShade(FC.fx, 0.98) : "rgba(255,255,255,0.35)",
              background: live ? `${c}38` : "rgba(0,0,0,0.45)",
              border: `1px solid ${live ? `${c}70` : "rgba(255,255,255,0.12)"}`,
              boxShadow: live ? `0 0 14px ${c}50` : undefined,
            }}
          >
            {fxTechBadge(tech, thematic)}
          </div>
        </div>
      </div>

      <SpectralStageViz />
      <SpectralCharacterStrip />
      <SpectralModeStrip />
      <SpectralMixStrip />

      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
          FFT
        </span>
        <span
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums"
          title="Spectral STFT size is fixed at 2048 in the worklet (selectable sizes coming later)."
          style={{
            borderColor: `${c}99`,
            background: `${c}33`,
            color: bandShade(FC.fx, 0.96),
          }}
        >
          2048
        </span>
        <button
          type="button"
          onClick={() => setParam("spectralWetOnly", !wetOnly)}
          className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition"
          style={
            wetOnly
              ? {
                  borderColor: `${c}99`,
                  background: `${c}33`,
                  color: bandShade(FC.fx, 0.96),
                  boxShadow: `0 0 8px ${c}33`,
                }
              : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
          }
          title="Wet-only spectral path"
        >
          {wetOnly ? "● Wet Only" : "○ Wet Only"}
        </button>
      </div>

      <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
        <SpectralModMeter
          label={amountLabel}
          value={amount}
          color={cAmt}
          bipolar={mode === "shift"}
          format={() => spectralFmtAmount(mode, amount)}
        />
        <SpectralModMeter label="Mix" value={mix} color={cMix} format={() => fmtPct(mix)} />
        <SpectralModMeter
          label="Mode"
          value={live ? 0.25 + SPECTRAL_MODE_CYCLE.indexOf(mode) * 0.2 : 0}
          color={bandShade(FC.fx, 0.78)}
          format={() => mode}
        />
      </div>

      <div className="flex items-end justify-evenly gap-1 flex-wrap">
        <FParamKnob
          paramKey="spectralAmount"
          label={amountLabel}
          min={0}
          max={1}
          bipolar={mode === "shift"}
          format={(v) => spectralFmtAmount(mode, v)}
          def={mode === "shift" ? 0.5 : 0.6}
          size={52}
          color={cAmt}
        />
        <FParamKnob paramKey="spectralLow" label="Low" min={0} max={1} format={fmtPct} def={0} size={44} color={cLow} />
        <FParamKnob paramKey="spectralHigh" label="High" min={0} max={1} format={fmtPct} def={1} size={44} color={cHigh} />
        <FParamKnob paramKey="spectralMix" label="Mix" min={0} max={1} format={fmtPct} def={0.5} size={52} color={cMix} />
      </div>
      <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${c}99` }}>
        Bin lattice — Low/High region · FFT {fftSize} · {FX_QUALITY_LABELS[quality]} · {fxTechBadge(tech)}.
      </div>
    </Section>
  );
}

/** Lowpass-gate switch — swaps the amp ADSR for a struck vactrol. */
function LpgToggle() {
  const lpgOn = useFireCommandStore((s) => s.patch.lpgOn);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = FC.pluck;
  return (
    <button
      type="button"
      onClick={() => setParam("lpgOn", !lpgOn)}
      className="h-6 px-2.5 rounded-md text-[10px] font-bold border transition"
      style={
        lpgOn
          ? {
              borderColor: `${c}70`,
              background: `${c}22`,
              color: bandShade(FC.tone, 0.92),
              boxShadow: `0 0 10px ${c}40`,
            }
          : { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.4)" }
      }
      title="Arm Pluck Gate (LPG): vactrol strike drives both loudness AND brightness. Sleep to disable module."
    >
      {lpgOn ? "Armed" : "Sleep"}
    </button>
  );
}

/** Dim / pause scope chrome when Signal Path SCOPE is Off. */
function PathScopeGate({ children }: { children: React.ReactNode }) {
  const on = useFireCommandStore((s) => s.patch.pathScope !== false);
  return (
    <div className={on ? undefined : "opacity-35 pointer-events-none grayscale"} aria-disabled={!on}>
      {!on && (
        <div className="mb-2 text-center text-[10px] uppercase tracking-widest text-white/40">
          Scope bypassed on Signal Path
        </div>
      )}
      {children}
    </div>
  );
}

/** Boolean patch toggle (hard sync, slide, etc.). */
function BoolToggle({
  paramKey,
  label,
  color = FIRE,
}: {
  paramKey: { [K in keyof FirePatch]: FirePatch[K] extends boolean ? K : never }[keyof FirePatch];
  label: string;
  color?: string;
}) {
  const on = useFireCommandStore((s) => s.patch[paramKey]) as boolean;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <button
      onClick={() => setParam(paramKey, !on)}
      className="h-6 px-2.5 rounded-md text-[10px] font-bold border transition"
      style={
        on
          ? { color, borderColor: `${color}70`, background: `${color}18` }
          : { color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }
      }
    >
      {on ? `● ${label}` : `○ ${label}`}
    </button>
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

function Section({ title, color = FIRE, right, children, className, collapseKey, defaultCollapsed = false, chipHosted = false, statusLine }: {
  title: string; color?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
  /** When set, the section header toggles fold state (persisted under this key). */
  collapseKey?: string; defaultCollapsed?: boolean;
  /** When true inside a FireBand, collapsed sections disappear (chips show instead). */
  chipHosted?: boolean;
  /** Optional collapsed-card status (model, mods, lock). */
  statusLine?: string;
}) {
  const [collapsed, toggle] = useCollapsed(collapseKey, defaultCollapsed);
  const { focusActive, focusId, isFocused, enterFocus } = useFireLayout();
  const accordionMode = useFireCommandStore((s) => s.accordionMode);
  const pinnedModules = useFireCommandStore((s) => s.pinnedModules);
  const toggleModulePin = useFireCommandStore((s) => s.toggleModulePin);
  const toggleModuleLock = useFireCommandStore((s) => s.toggleModuleLock);
  const locked = useFireCommandStore((s) => !!(collapseKey && s.moduleLocks[collapseKey]));
  const atlas = collapseKey ? FIRE_MODULE_BY_ID.get(collapseKey) : undefined;
  const labelMode = useFireCommandStore((s) => s.labelMode);
  useFireBandRegister(collapseKey, title, color, collapsed, toggle, !!chipHosted && !!collapseKey);

  const displayTitle =
    labelMode === "character" && atlas ? atlas.short
      : labelMode === "technical" && atlas ? atlas.title
        : title;

  // Focus mode: keep the soloed module forced open
  useEffect(() => {
    if (collapseKey && isFocused(collapseKey) && collapsed) {
      ensureExpanded(collapseKey);
    }
  }, [collapseKey, collapsed, isFocused]);

  const onToggle = () => {
    if (!collapseKey) {
      toggle();
      return;
    }
    const opening = collapsed;
    if (opening && accordionMode && !pinnedModules.includes(collapseKey)) {
      // Smart accordion: collapse other non-pinned modules in the same band.
      const band = atlas?.bandKey;
      if (band) {
        const entry = FIRE_BANDS.find((b) => b.id === band);
        for (const mod of entry?.modules ?? []) {
          if (mod.id === collapseKey) continue;
          if (pinnedModules.includes(mod.id)) continue;
          // Already collapsed — skip the storage write + event fan-out.
          try {
            if (window.localStorage.getItem(foldStorageKey(mod.id)) === "1") continue;
          } catch { /* storage unavailable — fold anyway */ }
          writeFold(mod.id, true);
        }
      }
    }
    toggle();
  };

  // Hide non-focused modules while focus mode is on
  if (focusActive && collapseKey && focusId !== collapseKey) return null;

  if (chipHosted && collapseKey && collapsed && !isFocused(collapseKey)) return null;

  const open = !collapsed || isFocused(collapseKey);
  // Atlas subtitles fall back to the short name — only surface real ones.
  const subtitle =
    atlas?.subtitle && atlas.subtitle !== atlas.short && atlas.subtitle !== atlas.title
      ? atlas.subtitle
      : null;

  return (
    <GlassPanel
      className={`p-2.5 ${className ?? ""}`}
      data-fire-module={collapseKey || undefined}
    >
      <div className={`flex items-center justify-between gap-2 min-w-0 ${open ? "mb-2" : ""}`}>
        {collapseKey ? (
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-2 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 min-w-0"
            title={collapsed ? "Expand section" : "Collapse section"}
          >
            <CollapseToggle collapsed={!open} color={color} />
            <span className="fc-text-primary font-semibold uppercase tracking-[0.18em] truncate" style={{ color }}>{displayTitle}</span>
            {locked && <span className="fc-lock-badge" title="Protected from Random Armory / mutation">LOCK</span>}
          </button>
        ) : (
          <div className="fc-text-primary font-semibold uppercase tracking-[0.18em] truncate min-w-0" style={{ color }}>{displayTitle}</div>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Pin / Lock / Solo only on the open card — collapsed headers stay quiet. */}
          {collapseKey && open && (
            <>
              <button
                type="button"
                className="fc-pin-btn rounded border border-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
                data-on={pinnedModules.includes(collapseKey) ? "1" : "0"}
                title="Pin — stay open when accordion expands another module"
                onClick={(e) => { e.stopPropagation(); toggleModulePin(collapseKey); }}
              >
                Pin
              </button>
              <button
                type="button"
                className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-[#f5d9a8]"
                title="Lock against Random Armory / mutation"
                onClick={(e) => { e.stopPropagation(); toggleModuleLock(collapseKey); }}
              >
                {locked ? "Unlock" : "Lock"}
              </button>
              {!isFocused(collapseKey) && (
                <button
                  type="button"
                  className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
                  title="Solo this module — hide the others"
                  onClick={(e) => { e.stopPropagation(); enterFocus(collapseKey as FireModuleId); }}
                >
                  Solo
                </button>
              )}
            </>
          )}
          {open && right ? <div className="max-w-[55%] overflow-x-auto">{right}</div> : null}
        </div>
      </div>
      {!open && (statusLine || subtitle) && (
        <div className="fc-text-secondary mt-1 truncate opacity-80">
          {statusLine ?? subtitle}
        </div>
      )}
      {open && children}
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
  label, value, min, max, curve = "lin", integer = false, bipolar = false, format, def, color = FIRE, size = 40, onChange, modulated,
  modEnv, modLfo, paramKey,
}: {
  label: string; value: number; min: number; max: number; curve?: "lin" | "log"; integer?: boolean;
  bipolar?: boolean; format: (v: number) => string; def?: number; color?: string; size?: number; onChange: (v: number) => void;
  /** Explicit mod-matrix indicator; also auto-detected from label ↔ dest when omitted. */
  modulated?: boolean;
  /** Destination-knob envelope modulation depth (−1..1), drawn as a range arc. */
  modEnv?: number;
  /** Destination-knob LFO modulation depth (−1..1), drawn as a range arc. */
  modLfo?: number;
  /** FirePatch key — enables matrix-driven mod arcs. */
  paramKey?: string;
}) {
  const modMatrix = useFireCommandStore((s) => s.patch.modMatrix);
  const matrixArcs = paramKey ? matrixArcsForParam(paramKey, modMatrix) : [];
  const autoModulated = (() => {
    if (modulated != null) return modulated;
    if (matrixArcs.length > 0) return true;
    const ll = label.toLowerCase();
    const routes = modMatrix ?? [];
    const matchDest = (...dests: string[]) =>
      routes.some((r) => r.dest !== "none" && Math.abs(r.amount) > 0.05 && dests.includes(r.dest));
    if (ll.includes("cutoff")) return matchDest("cutoff");
    if (ll.includes("reso")) return matchDest("resonance");
    if (ll === "pitch" || ll.includes("pitch ")) return matchDest("pitch");
    if (ll === "pan") return matchDest("pan");
    return false;
  })();
  const [liveMod, setLiveMod] = useState(0);
  const matrixKey = matrixArcs.map((a) => `${a.source}:${a.amount}`).join("|");
  useEffect(() => {
    if (!matrixArcs.length) { setLiveMod(0); return; }
    let raf = 0;
    const tick = () => {
      try {
        const eng = activeFireEngine();
        let acc = 0;
        for (const a of matrixArcs) {
          let src = 0;
          if (a.source === "lfo1") src = eng.getLfoValue(1);
          else if (a.source === "lfo2") src = eng.getLfoValue(2);
          else if (a.source.startsWith("macro")) {
            const patch = useFireCommandStore.getState().patch;
            src = a.source === "macro1" ? patch.macro1 : a.source === "macro2" ? patch.macro2 : a.source === "macro3" ? patch.macro3 : patch.macro4;
          }
          acc += a.amount * src;
        }
        setLiveMod(acc);
      } catch { /* engine not ready */ }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [matrixKey]);
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
    const scale = e.shiftKey ? 2400 : 220;
    const nt = clamp(startT.current + (startY.current - e.clientY) / scale, 0, 1);
    startY.current = e.clientY;
    startT.current = nt;
    onChange(fromT(nt));
  };
  const up = (e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag(false);
  };
  const dbl = () => onChange(resetVal);

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
  const span = Math.max(min, max) - Math.min(min, max) || 1;
  const degAt = (v: number) => -135 + clamp(toT(clamp(v, min, max)), 0, 1) * 270;
  const liveVal = clamp(value + liveMod * span * (bipolar ? 0.5 : 0.45), min, max);
  const liveAngle = degAt(liveVal);
  const lx = cx + Math.sin((liveAngle * Math.PI) / 180) * (r + 6);
  const ly = cy - Math.cos((liveAngle * Math.PI) / 180) * (r + 6);
  return (
    <div className="group flex flex-col items-center relative" style={{ width: Math.max(size + 10, 50) }}>
      {autoModulated && (
        <span
          className="fc-dial-mod-dot pointer-events-none absolute z-[1]"
          style={{ top: 2, left: "50%", marginLeft: size / 2 - 2 }}
          title="Modulated by the matrix"
          aria-hidden
        />
      )}
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
          {(() => {
            const env = modEnv ?? 0;
            const lfo = modLfo ?? 0;
            if (Math.abs(env) < 0.04 && Math.abs(lfo) < 0.04 && !matrixArcs.length) return null;
            const arcs = [];
            if (Math.abs(env) >= 0.04) {
              const a0 = degAt(value);
              const a1 = degAt(value + env * span * (bipolar ? 0.5 : 1));
              arcs.push(
                <path key="env" d={arcPath(cx, cy, r + 5, Math.min(a0, a1), Math.max(a0, a1))} fill="none" stroke="rgba(120,220,180,0.75)" strokeWidth={2} strokeLinecap="round" />,
              );
            }
            if (Math.abs(lfo) >= 0.04) {
              const a0 = degAt(value - Math.abs(lfo) * span * (bipolar ? 0.35 : 0.5));
              const a1 = degAt(value + Math.abs(lfo) * span * (bipolar ? 0.35 : 0.5));
              arcs.push(
                <path key="lfo" d={arcPath(cx, cy, r + 8, Math.min(a0, a1), Math.max(a0, a1))} fill="none" stroke="rgba(120,180,255,0.7)" strokeWidth={1.75} strokeLinecap="round" strokeDasharray="2 2" />,
              );
            }
            matrixArcs.forEach((a, i) => {
              const mag = Math.abs(a.amount);
              const a0 = degAt(value - mag * span * (a.unipolar ? 0.15 : bipolar ? 0.35 : 0.45));
              const a1 = degAt(value + mag * span * (a.unipolar ? 0.55 : bipolar ? 0.35 : 0.45));
              arcs.push(
                <path
                  key={`mx${i}`}
                  d={arcPath(cx, cy, r + 5 + i * 3, Math.min(a0, a1), Math.max(a0, a1))}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  opacity={0.85}
                />,
              );
            });
            return arcs;
          })()}
          <line
            x1={cx + Math.sin((angle * Math.PI) / 180) * (r - 6)}
            y1={cy - Math.cos((angle * Math.PI) / 180) * (r - 6)}
            x2={cx + Math.sin((angle * Math.PI) / 180) * (r + 1)}
            y2={cy - Math.cos((angle * Math.PI) / 180) * (r + 1)}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <path d={arcPath(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" style={{ filter: drag ? `drop-shadow(0 0 5px ${color})` : `drop-shadow(0 0 2px ${color})` }} />
          <line x1={cx} y1={cy} x2={ix} y2={iy} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <circle cx={ix} cy={iy} r={3} fill={color} />
          {matrixArcs.length > 0 && Math.abs(liveMod) > 0.02 && (
            <circle cx={lx} cy={ly} r={2.5} fill={matrixArcs[0]!.color} opacity={0.9} style={{ filter: `drop-shadow(0 0 4px ${matrixArcs[0]!.color})` }} />
          )}
        </svg>
      </div>
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
