/**
 * SequencerPanel — Fire Command sequence workspace: transport + piano roll +
 * drum grid + pattern bank / arrangement playlist.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { PianoRoll } from "./PianoRoll";
import { DrumMachine } from "./DrumMachine";
import { AutomationLane } from "./AutomationLane";
import {
  useFireSequencerStore,
  MAX_BARS,
  STEPS_PER_BAR,
} from "@/state/fireSequencerStore";
import { FIRE_PRESETS, useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";
import {
  exportPatternWav,
  exportStems,
  saveProject,
  openProject,
  type ExportFormat,
} from "@/lib/fireStudio";
import { RollFitProvider } from "./useRollFit";
import { PIANO_GUTTER } from "./PianoRoll";
import { ArrangementPlaylist, PATTERN_COLORS } from "./ArrangementPlaylist";
import { CollapseToggle } from "./CollapseToggle";
import { useFireCollapsed } from "./useFireCollapsed";
import { PresetSearchCombobox, type PresetSearchOption } from "./PresetSearchCombobox";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const BRASS = "#e8b86d";
const BRASS_SOFT = "#f5d9a8";
const BRASS_GLOW = "rgba(232,184,109,0.35)";

type Tab = "roll" | "drums";

/** Auto-assigned pattern colors (editors chrome). */
const SECTION_COLORS = PATTERN_COLORS;

/**
 * Swing controls (v1.6): one knob when linked; unlink to give drums and the
 * sample deck their own groove separate from the melody.
 */
function SwingControls() {
  const swing = useFireSequencerStore((s) => s.swing);
  const swingDrums = useFireSequencerStore((s) => s.swingDrums);
  const swingSamples = useFireSequencerStore((s) => s.swingSamples);
  const swingLinked = useFireSequencerStore((s) => s.swingLinked);
  const setSwing = useFireSequencerStore((s) => s.setSwing);
  const setSwingDrums = useFireSequencerStore((s) => s.setSwingDrums);
  const setSwingSamples = useFireSequencerStore((s) => s.setSwingSamples);
  const setSwingLinked = useFireSequencerStore((s) => s.setSwingLinked);

  const slider = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    title: string,
  ) => (
    <div className="flex items-center gap-1" title={title}>
      <span className="text-[9px] uppercase tracking-[0.14em] text-white/40 w-8 text-right">{label}</span>
      <input
        type="range"
        min={0}
        max={0.6}
        step={0.02}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[58px] accent-[#e8b86d]"
      />
      <span className="text-[10px] font-mono text-white/50 w-7">{Math.round(value * 100)}%</span>
    </div>
  );

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[9px] font-black uppercase tracking-[0.18em]"
        style={{ color: "rgba(232,184,109,0.55)" }}
        title="Delays every off-beat 16th for groove"
      >Swing</span>
      <button
        onClick={() => setSwingLinked(!swingLinked)}
        className="h-6 px-1.5 rounded-md text-[9px] font-bold transition"
        style={
          swingLinked
            ? { color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }
            : { color: BRASS_SOFT, background: "rgba(232,184,109,0.14)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.4)" }
        }
        title={
          swingLinked
            ? "Linked: one groove for everything. Click to give drums and samples their own swing."
            : "Unlinked: melody, drums and samples each swing on their own. Click to re-link."
        }
      >
        {swingLinked ? "🔗" : "⛓️‍💥"}
      </button>
      {swingLinked ? (
        <div className="flex items-center gap-1" title="Delays every off-beat 16th for groove (all groups)">
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.02}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className="w-[74px] accent-[#e8b86d]"
          />
          <span className="text-[10px] font-mono tabular-nums" style={{ color: BRASS_SOFT, opacity: 0.7 }}>
            {Math.round(swing * 100)}%
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {slider("Mel", swing, setSwing, "Swing on the piano-roll notes (Synth A + B)")}
          {slider("Drm", swingDrums, setSwingDrums, "Swing on the drum kit lanes")}
          {slider("Smp", swingSamples, setSwingSamples, "Swing on the sample deck lanes")}
        </div>
      )}
    </div>
  );
}

export const SequencerPanel = memo(function SequencerPanel({
  asWorkspace = true,
  flush = false,
}: {
  /** When true (default), stay expanded — Sequencer is its own Fire workspace. */
  asWorkspace?: boolean;
  /** Sit inside the shared Fire console — no outer card chrome. */
  flush?: boolean;
} = {}) {
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const bars = useFireSequencerStore((s) => s.bars);
  const synthEnabled = useFireSequencerStore((s) => s.synthEnabled);
  const drumsEnabled = useFireSequencerStore((s) => s.drumsEnabled);
  const synthBEnabled = useFireSequencerStore((s) => s.synthBEnabled);
  const synthBPresetId = useFireSequencerStore((s) => s.synthBPresetId);
  const activeChannel = useFireSequencerStore((s) => s.activeChannel);
  const drumLevel = useFireSequencerStore((s) => s.drumLevel);
  const noteCount = useFireSequencerStore((s) => s.notes.length);
  const togglePlay = useFireSequencerStore((s) => s.togglePlay);
  const setBpm = useFireSequencerStore((s) => s.setBpm);
  const setBars = useFireSequencerStore((s) => s.setBars);
  const setSynthEnabled = useFireSequencerStore((s) => s.setSynthEnabled);
  const setDrumsEnabled = useFireSequencerStore((s) => s.setDrumsEnabled);
  const setSynthBEnabled = useFireSequencerStore((s) => s.setSynthBEnabled);
  const setSynthBPresetId = useFireSequencerStore((s) => s.setSynthBPresetId);
  const setActiveChannel = useFireSequencerStore((s) => s.setActiveChannel);
  const setDrumLevel = useFireSequencerStore((s) => s.setDrumLevel);
  const clearNotes = useFireSequencerStore((s) => s.clearNotes);
  const clearDrums = useFireSequencerStore((s) => s.clearDrums);
  const collapsed = useFireSequencerStore((s) => s.collapsed);
  const setCollapsed = useFireSequencerStore((s) => s.setCollapsed);
  const playMode = useFireSequencerStore((s) => s.playMode);
  const playScope = useFireSequencerStore((s) => s.playScope);
  const recording = useFireSequencerStore((s) => s.recording);
  const recordQuantize = useFireSequencerStore((s) => s.recordQuantize);
  const setRecording = useFireSequencerStore((s) => s.setRecording);
  const setRecordQuantize = useFireSequencerStore((s) => s.setRecordQuantize);
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const setActiveSection = useFireSequencerStore((s) => s.setActiveSection);

  const [tab, setTab] = useState<Tab>("roll");
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const toast = useUIStore((s) => s.toast);
  const [editorCollapsed, toggleEditor] = useFireCollapsed("seq.editor", false);

  useEffect(() => {
    if (asWorkspace && collapsed) setCollapsed(false);
  }, [asWorkspace, collapsed, setCollapsed]);

  const doExportWav = async () => {
    if (exporting) return;
    if (noteCount === 0 && !drumsEnabled) {
      toast("Nothing to export — draw some notes or drums first");
      return;
    }
    setExporting("arming…");
    try {
      const res = await exportPatternWav(
        (p) => setExporting(`${p.stage} ${Math.round(p.fraction * 100)}%`),
        exportFormat,
      );
      if (!res?.path) {
        toast(res ? "Export cancelled" : "Export unavailable");
        return;
      }
      const how = res.method === "offline" ? "offline bounce" : "realtime capture";
      toast(`Exported (${how}) → ${res.path.split(/[\\/]/).pop()}`);
    } catch {
      toast("Export failed");
    } finally {
      setExporting(null);
    }
  };

  const doExportStems = async () => {
    if (exporting) return;
    if (noteCount === 0 && !drumsEnabled) {
      toast("Nothing to export — draw some notes or drums first");
      return;
    }
    setExporting("arming…");
    try {
      const res = await exportStems(
        (p) => setExporting(`${p.stage} ${Math.round(p.fraction * 100)}%`),
        exportFormat,
      );
      toast(
        res
          ? `${res.written.length} stems → ${res.dir.split(/[\\/]/).pop()}`
          : "Stems export cancelled",
      );
    } catch {
      toast("Stems export failed");
    } finally {
      setExporting(null);
    }
  };

  const doSaveProject = async () => {
    const path = await saveProject();
    toast(path ? `Project saved → ${path.split(/[\\/]/).pop()}` : "Save cancelled");
  };

  const doOpenProject = async () => {
    const res = await openProject();
    if (res.ok) toast("Project loaded — patch, pattern, samples");
    else if (res.error) toast(res.error);
  };

  const presetId = useFireCommandStore((s) => s.presetId);
  const loadPreset = useFireCommandStore((s) => s.loadPreset);
  const setEditTarget = useFireCommandStore((s) => s.setEditTarget);
  const userPresets = useFireCommandStore((s) => s.userPresets);

  // Typeahead options for the Draw A / Draw B instrument picker.
  const instrumentOptions = useMemo<PresetSearchOption[]>(() => {
    const factory = FIRE_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      user: false,
      desc: "desc" in p ? String((p as { desc?: string }).desc ?? "") : "",
    }));
    const user = userPresets.map((p) => ({
      id: p.id,
      name: p.name,
      category: ("category" in p && typeof p.category === "string" ? p.category : "User"),
      user: true,
      desc: "",
    }));
    return [...factory, ...user];
  }, [userPresets]);

  const synthBName = useMemo(
    () => instrumentOptions.find((p) => p.id === synthBPresetId)?.name ?? "—",
    [instrumentOptions, synthBPresetId],
  );

  const confirmClearTimeoutRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(confirmClearTimeoutRef.current), []);

  const doClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.clearTimeout(confirmClearTimeoutRef.current);
      confirmClearTimeoutRef.current = window.setTimeout(() => setConfirmClear(false), 2200);
      return;
    }
    setConfirmClear(false);
    if (tab === "roll") clearNotes();
    else clearDrums();
  };

  // Collapsed strip only when embedded historically; workspace mode stays full.
  if (collapsed && !asWorkspace) {
    return (
      <GlassPanel intense className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={togglePlay}
            className={`h-8 px-4 rounded-lg font-bold text-xs tracking-wide border transition ${
              playing
                ? "border-[#ff6a3d] bg-[#ff6a3d]/25 text-[#ffd9c9] shadow-[0_0_18px_rgb(255_106_61/0.4)]"
                : "border-[#ff6a3d]/50 bg-[#ff6a3d]/10 text-[#ffbfa0] hover:bg-[#ff6a3d]/20"
            }`}
            title="Play / stop the pattern (sequencer)"
          >
            {playing ? "■ Hold Fire" : "▶ Open Fire"}
          </button>
          <span className="text-[10px] uppercase tracking-[0.22em] text-dim">Sequencer</span>
          <span className="text-[11px] font-mono text-white/55">{bpm} BPM · {bars} bar{bars === 1 ? "" : "s"} · {noteCount} notes</span>
          <button
            onClick={() => setSynthEnabled(!synthEnabled)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
              synthEnabled ? "border-[#ff6a3d]/60 bg-[#ff6a3d]/12 text-[#ffbfa0]" : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute Layer A"
          >{synthEnabled ? "● SYNTH A" : "○ SYNTH A"}</button>
          <button
            onClick={() => setSynthBEnabled(!synthBEnabled)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
              synthBEnabled ? "border-[#62b6ff]/60 bg-[#62b6ff]/12 text-[#b8dcff]" : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title={`Arm / mute Layer B (voice: ${synthBName})`}
          >{synthBEnabled ? "● SYNTH B" : "○ SYNTH B"}</button>
          <button
            onClick={() => setDrumsEnabled(!drumsEnabled)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
              drumsEnabled ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]" : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute the drums layer"
          >{drumsEnabled ? "● DRUMS" : "○ DRUMS"}</button>
          <div className="flex-1" />
          <button
            onClick={() => setCollapsed(false)}
            className="h-7 px-2.5 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 text-[11px] text-white/75 transition"
            title="Show the piano roll / drum grid"
          >▼ Expand</button>
        </div>
      </GlassPanel>
    );
  }

  const body = (
    <>
      {/* Brass transport — matches Synth-side FireMiniTransport */}
      <div
        className={`relative overflow-hidden ${flush ? "" : "rounded-2xl mb-2.5"}`}
        style={
          flush
            ? {
                background: playing
                  ? "linear-gradient(180deg, rgba(232,184,109,0.12) 0%, rgba(22,18,14,0.3) 50%, rgba(34,211,238,0.05) 100%)"
                  : "linear-gradient(180deg, rgba(232,184,109,0.07) 0%, rgba(22,18,14,0.22) 55%, transparent 100%)",
              }
            : {
                border: "1px solid rgba(232,184,109,0.22)",
                background: "linear-gradient(180deg, #16120e 0%, #0e0c0a 100%)",
                boxShadow: playing
                  ? `0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.3), 0 0 40px ${BRASS_GLOW}`
                  : "0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.28)",
              }
        }
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: playing
              ? "radial-gradient(ellipse 55% 140% at 10% 50%, rgba(232,184,109,0.2), transparent 55%), radial-gradient(ellipse 40% 100% at 90% 50%, rgba(232,184,109,0.08), transparent 50%)"
              : "radial-gradient(ellipse 50% 120% at 50% 0%, rgba(232,184,109,0.1), transparent 55%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(245,217,168,0.4), transparent)" }}
        />
        {!flush && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] opacity-40"
          style={{
            background: "linear-gradient(90deg, transparent, #e8b86d, transparent)",
            maskImage: "repeating-linear-gradient(90deg, #000 0 8px, transparent 8px 14px)",
            WebkitMaskImage: "repeating-linear-gradient(90deg, #000 0 8px, transparent 8px 14px)",
          }}
        />
        )}

        <div className="relative z-10 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)] lg:items-center px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <button
              onClick={togglePlay}
              className="relative h-10 px-5 rounded-xl font-black text-[12px] uppercase tracking-[0.14em] transition overflow-hidden shrink-0"
              style={
                playing
                  ? {
                      color: "#1a1208",
                      background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                      boxShadow: `0 0 24px ${BRASS_GLOW}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                    }
                  : {
                      color: BRASS_SOFT,
                      background: "rgba(232,184,109,0.12)",
                      boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.45)",
                    }
              }
              title={
                playMode === "arrangement"
                  ? "Play / stop the arrangement timeline"
                  : playScope === "selection"
                    ? "Play / stop — looping the selected note range"
                    : "Play / stop the pattern open in the editor"
              }
            >
              {playing && (
                <span
                  className="pointer-events-none absolute inset-0 opacity-60 animate-[evolve-breathe_1.8s_ease-in-out_infinite]"
                  style={{ background: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.45), transparent 55%)" }}
                />
              )}
              <span className="relative inline-flex items-center gap-2">
                <span aria-hidden>{playing ? "■" : "▶"}</span>
                {playing ? "Hold Fire" : "Open Fire"}
              </span>
            </button>

            <span
              className="hidden sm:inline text-[9px] font-black uppercase tracking-[0.14em] px-2 py-1 rounded-md"
              style={{
                color: playMode === "arrangement" || playScope === "selection" ? BRASS_SOFT : "rgba(255,255,255,0.4)",
                background: "rgba(0,0,0,0.3)",
                boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.2)",
              }}
              title="Transport play scope — switch above the timeline or in the roll"
            >
              {playMode === "arrangement" ? "Arrangement" : playScope === "selection" ? "Selection" : "Pattern"}
            </span>

            <button
              onClick={() => setRecording(!recording)}
              className="h-10 px-3.5 rounded-xl font-black text-[12px] uppercase tracking-[0.1em] transition"
              style={
                recording
                  ? {
                      color: "#fecdd3",
                      background: "rgba(244,63,94,0.28)",
                      boxShadow: "0 0 18px rgba(244,63,94,0.4), inset 0 0 0 1px rgba(244,63,94,0.7)",
                    }
                  : {
                      color: "rgba(255,255,255,0.45)",
                      background: "rgba(0,0,0,0.25)",
                      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
                    }
              }
              title="Arm record: while playing, everything you play lands in the piano roll"
            >
              ● Rec
            </button>
            {recording && (
              <button
                onClick={() => setRecordQuantize(!recordQuantize)}
                className="h-8 px-2.5 rounded-lg text-[11px] font-semibold transition"
                style={
                  recordQuantize
                    ? { color: BRASS_SOFT, background: "rgba(232,184,109,0.16)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.45)" }
                    : { color: "rgba(255,255,255,0.35)", background: "rgba(0,0,0,0.25)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }
                }
                title="Quantize captured notes to the 1/16 grid"
              >
                ⧗ 1/16
              </button>
            )}

            <div
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5"
              style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.16)" }}
            >
              <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "rgba(232,184,109,0.5)" }}>BPM</span>
              <input
                type="number"
                min={40}
                max={240}
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value) || 128)}
                className="w-[58px] rounded-md bg-black/40 px-1.5 py-1 text-sm font-mono text-center outline-none"
                style={{ color: BRASS_SOFT, boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.2)" }}
              />
            </div>

            <div
              className="rounded-xl px-2 py-1"
              style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.16)" }}
            >
              <SwingControls />
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5"
            style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.16)" }}
          >
            <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "rgba(232,184,109,0.5)" }}>Bars</span>
            {[1, 2, 4, MAX_BARS].map((b) => (
              <button
                key={b}
                onClick={() => setBars(b)}
                className="w-8 h-8 rounded-lg text-xs font-mono transition"
                style={
                  bars === b
                    ? { color: "#1a1208", background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`, boxShadow: `0 0 12px ${BRASS_GLOW}` }
                    : { color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }
                }
              >{b}</button>
            ))}
            <button
              onClick={() => {
                const ok = useFireSequencerStore.getState().duplicatePattern();
                if (!ok) return;
              }}
              disabled={bars * 2 > MAX_BARS}
              className="h-8 px-2 rounded-lg text-[10px] font-semibold transition disabled:opacity-30"
              style={{ color: "rgba(245,217,168,0.7)", background: "rgba(232,184,109,0.08)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.22)" }}
              title="Double this pattern's length and repeat its contents"
            >
              Double length
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
            <div className="text-right hidden md:block mr-0.5">
              <div className="text-[8px] font-black uppercase tracking-[0.2em] leading-none" style={{ color: "rgba(232,184,109,0.45)" }}>
                Layers
              </div>
              <div className="text-[9px] text-white/30 mt-0.5">arm · mute</div>
            </div>
            <div
              className="inline-flex items-center gap-1 rounded-xl p-1"
              style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.16)" }}
            >
              {([
                { on: synthEnabled, toggle: () => setSynthEnabled(!synthEnabled), label: "A", accent: "#ff8f6b", soft: "#ffd0c0", title: "Arm / mute Synth A" },
                { on: synthBEnabled, toggle: () => setSynthBEnabled(!synthBEnabled), label: "B", accent: "#7dd3fc", soft: "#e0f2fe", title: "Arm / mute Synth B" },
                { on: drumsEnabled, toggle: () => setDrumsEnabled(!drumsEnabled), label: "DRM", accent: "#bef264", soft: "#ecfccb", title: "Arm / mute drums" },
              ] as const).map((ch) => (
                <button
                  key={ch.label}
                  onClick={ch.toggle}
                  className="h-8 min-w-[2.75rem] px-2.5 rounded-lg text-[11px] font-black tracking-wide transition inline-flex items-center justify-center gap-1.5"
                  style={
                    ch.on
                      ? { color: ch.soft, background: `${ch.accent}22`, boxShadow: `inset 0 0 0 1px ${ch.accent}66, 0 0 12px ${ch.accent}33` }
                      : { color: "rgba(255,255,255,0.28)", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }
                  }
                  title={ch.title}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: ch.on ? ch.accent : "rgba(255,255,255,0.2)", boxShadow: ch.on ? `0 0 8px ${ch.accent}` : undefined }}
                  />
                  {ch.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.02}
              value={drumLevel}
              onChange={(e) => setDrumLevel(Number(e.target.value))}
              className="w-[64px] accent-[#bef264]"
              title="Drum layer level"
              aria-label="Drum level"
            />
            {!asWorkspace && (
              <button
                onClick={() => setCollapsed(true)}
                className="h-8 px-2.5 rounded-lg text-[11px] transition"
                style={{ color: "rgba(245,217,168,0.7)", background: "rgba(232,184,109,0.08)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.22)" }}
                title="Collapse the sequencer to a compact transport strip"
              >▲</button>
            )}
          </div>
        </div>
      </div>

      <ArrangementPlaylist flush={flush} />

      {/* Editor chrome — left editor / center draw / right file */}
      <div
        className={
          flush
            ? "grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center px-2.5 py-2 bg-gradient-to-b from-white/[0.03] to-transparent"
            : "mb-2.5 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2"
        }
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={toggleEditor}
            className="inline-flex items-center gap-1.5 h-8 px-1.5 rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.06] transition"
            aria-expanded={!editorCollapsed}
            title={editorCollapsed ? "Expand piano roll / drums" : "Collapse piano roll / drums"}
          >
            <CollapseToggle collapsed={editorCollapsed} color={FIRE} />
            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/45 pr-1">
              {tab === "roll" ? "Piano roll" : "Drums"}
            </span>
          </button>
          {(() => {
            const idx = Math.max(0, sections.findIndex((s) => s.id === activeSectionId));
            const sec = sections[idx];
            const color = SECTION_COLORS[idx % SECTION_COLORS.length];
            return (
              <button
                type="button"
                onClick={() => {
                  if (sections.length < 2) return;
                  const next = sections[(idx + 1) % sections.length];
                  if (next) setActiveSection(next.id);
                }}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-bold max-w-[10rem] transition hover:brightness-125"
                style={{ borderColor: `${color}66`, background: `${color}12`, color }}
                title={
                  sections.length > 1
                    ? "Click to cycle the pattern open in the editors"
                    : "Piano roll and drums edit this pattern"
                }
              >
                <span className="text-[8px] uppercase tracking-[0.16em] opacity-60 shrink-0">Editing</span>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="truncate">{sec?.name ?? "?"}</span>
              </button>
            );
          })()}
          <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
            <button
              onClick={() => setTab("roll")}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md transition"
              style={
                tab === "roll"
                  ? { background: "rgba(255,106,61,0.2)", color: "#ffbfa0" }
                  : { color: "rgba(255,255,255,0.45)" }
              }
            >
              Piano <span className="opacity-55 font-mono">{noteCount}</span>
            </button>
            <button
              onClick={() => setTab("drums")}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md transition"
              style={
                tab === "drums"
                  ? { background: "rgba(155,229,100,0.2)", color: "#d3f5b0" }
                  : { color: "rgba(255,255,255,0.45)" }
              }
            >
              Drums
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 min-w-0">
          {tab === "roll" && (
            <>
              <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5 shrink-0">
                {([0, 1] as const).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => {
                      setActiveChannel(ch);
                      setEditTarget(ch === 0 ? "a" : "b");
                    }}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-md transition"
                    style={
                      activeChannel === ch
                        ? { background: "rgba(255,255,255,0.1)", color: ch === 0 ? FIRE : ICE }
                        : { color: "rgba(255,255,255,0.4)" }
                    }
                    title={
                      ch === 0
                        ? "Draw Synth A (orange) — also focuses the Synth rack on A"
                        : "Draw Synth B (blue) — also focuses the Synth rack on B"
                    }
                  >
                    Draw {ch === 0 ? "A" : "B"}
                  </button>
                ))}
              </div>
              <PresetSearchCombobox
                value={activeChannel === 0 ? presetId : synthBPresetId}
                color={activeChannel === 0 ? FIRE : ICE}
                options={instrumentOptions}
                onChange={(id) => {
                  if (activeChannel === 0) {
                    setEditTarget("a");
                    loadPreset(id);
                  } else {
                    setEditTarget("b");
                    setSynthBPresetId(id);
                  }
                }}
                placeholder={activeChannel === 0 ? "Search Synth A…" : "Search Synth B…"}
                className="max-w-[16rem]"
                minWidthClass="min-w-[12rem]"
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => void doSaveProject()}
            className="h-8 px-3 rounded-lg text-[11px] font-semibold border border-white/10 text-white/70 hover:text-white hover:border-white/25 transition"
            title="Save project (.kcproj)"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void doExportWav()}
            disabled={!!exporting}
            className={`h-8 px-3 rounded-lg text-[11px] font-semibold border transition disabled:opacity-50 ${
              exporting
                ? "border-cyan/50 bg-cyan/10 text-cyan"
                : "border-cyan/35 bg-cyan/10 text-cyan hover:border-cyan/55"
            }`}
            title={playMode === "arrangement" ? "Export arrangement (dry Fire bounce)" : "Export pattern (dry Fire bounce)"}
          >
            {exporting ?? (playMode === "arrangement" ? "Export song" : "Export")}
          </button>
          <div className="relative">
            <button
              onClick={() => setFileMenuOpen((v) => !v)}
              className={`h-8 px-3 rounded-lg text-[11px] font-semibold border transition ${
                fileMenuOpen
                  ? "border-cyan/50 bg-cyan/10 text-cyan"
                  : "border-white/10 text-white/55 hover:text-white/85 hover:border-white/25"
              }`}
              title="Open project, format, stems"
            >
              File ▾
            </button>
            {fileMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 cursor-default"
                  aria-label="Close file menu"
                  onClick={() => setFileMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-white/12 bg-[#12151c] shadow-xl p-1 space-y-0.5">
                  <button
                    onClick={() => { setFileMenuOpen(false); void doOpenProject(); }}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-white/70 hover:bg-white/8 hover:text-white transition"
                  >Open project…</button>
                  <div className="h-px bg-white/8 my-0.5" />
                  <div className="flex items-center gap-1 px-2 py-1">
                    <span className="text-[9px] uppercase tracking-wider text-white/35">Format</span>
                    <select
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                      className="flex-1 rounded border border-white/12 bg-black/40 px-1 py-0.5 text-[10px] text-white/75 outline-none"
                    >
                      <option value="wav">WAV</option>
                      <option value="mp3">MP3</option>
                    </select>
                  </div>
                  <button
                    onClick={() => { setFileMenuOpen(false); void doExportStems(); }}
                    disabled={!!exporting}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-violet-300/90 hover:bg-violet-500/10 transition disabled:opacity-40"
                  >Export stems…</button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={doClear}
            className={`h-8 px-2.5 rounded-lg text-[11px] border transition ${
              confirmClear
                ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
                : "border-white/10 text-white/40 hover:text-rose-300 hover:border-rose-400/40"
            }`}
            title={`Clear ${tab === "roll" ? "notes" : "drums"}`}
          >
            {confirmClear ? "Confirm?" : "Clear"}
          </button>
        </div>
      </div>

      {!editorCollapsed && (tab === "roll" ? (
        <RollFitProvider totalSteps={bars * STEPS_PER_BAR} gutter={PIANO_GUTTER}>
          <PianoRoll />
          <AutomationLane />
        </RollFitProvider>
      ) : (
        <div className="w-full min-w-0">
          <DrumMachine />
        </div>
      ))}
    </>
  );

  return flush ? (
    <div className="relative rounded-b-2xl bg-gradient-to-b from-transparent to-black/20">
      {body}
    </div>
  ) : (
    <GlassPanel intense className="p-3.5">
      {body}
    </GlassPanel>
  );
});
