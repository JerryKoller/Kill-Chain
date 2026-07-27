/**
 * SequencerPanel — Fire Command sequence workspace: transport + piano roll +
 * drum grid + pattern bank / arrangement playlist.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { PianoRoll } from "./PianoRoll";
import { DrumMachine } from "./DrumMachine";
import { AutomationLane } from "./AutomationLane";
import {
  useFireSequencerStore,
  MAX_BARS,
  STEPS_PER_BAR,
} from "@/state/fireSequencerStore";
import { FIRE_PRESETS, PRESET_CATEGORIES } from "@/state/fireCommandStore";
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
import { writeFireWorkspace } from "./useFireWorkspace";
import { scrollFireCommandTop } from "./fireNavigate";
import { ArrangementPlaylist, PATTERN_COLORS } from "./ArrangementPlaylist";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";

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
        className="w-[58px] accent-[#ff6a3d]"
      />
      <span className="text-[10px] font-mono text-white/50 w-7">{Math.round(value * 100)}%</span>
    </div>
  );

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[10px] uppercase tracking-[0.22em] text-dim"
        title="Delays every off-beat 16th for groove"
      >Swing</span>
      <button
        onClick={() => setSwingLinked(!swingLinked)}
        className={`h-5 px-1.5 rounded-md text-[9px] font-bold border transition ${
          swingLinked
            ? "border-white/15 bg-white/[0.06] text-white/60"
            : "border-[#ff6a3d]/50 bg-[#ff6a3d]/10 text-[#ffbfa0]"
        }`}
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
            className="w-[74px] accent-[#ff6a3d]"
          />
          <span className="text-[10px] font-mono text-white/50 w-7">{Math.round(swing * 100)}%</span>
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
}: {
  /** When true (default), stay expanded — Sequencer is its own Fire workspace. */
  asWorkspace?: boolean;
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

  useEffect(() => {
    if (asWorkspace && collapsed) setCollapsed(false);
  }, [asWorkspace, collapsed, setCollapsed]);

  const openSynth = () => {
    writeFireWorkspace("synth");
    scrollFireCommandTop("smooth");
  };

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

  // Grouped options for the Synth B voice picker (built once — 500+ entries).
  const presetGroups = useMemo(
    () =>
      PRESET_CATEGORIES.map((cat) => ({
        cat,
        items: FIRE_PRESETS.filter((p) => p.category === cat),
      })).filter((g) => g.items.length > 0),
    [],
  );
  const synthBName = useMemo(
    () => FIRE_PRESETS.find((p) => p.id === synthBPresetId)?.name ?? "—",
    [synthBPresetId],
  );

  const doClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 2200);
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
            {playing ? "■ HOLD FIRE" : "▶ OPEN FIRE"}
          </button>
          <span className="text-[10px] uppercase tracking-[0.22em] text-dim">Sequencer</span>
          <span className="text-[11px] font-mono text-white/55">{bpm} BPM · {bars} bar{bars === 1 ? "" : "s"} · {noteCount} notes</span>
          <button
            onClick={() => setSynthEnabled(!synthEnabled)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
              synthEnabled ? "border-[#ff6a3d]/60 bg-[#ff6a3d]/12 text-[#ffbfa0]" : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute the Synth A channel"
          >{synthEnabled ? "● SYNTH A" : "○ SYNTH A"}</button>
          <button
            onClick={() => setSynthBEnabled(!synthBEnabled)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
              synthBEnabled ? "border-[#62b6ff]/60 bg-[#62b6ff]/12 text-[#b8dcff]" : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title={`Arm / mute the Synth B channel (voice: ${synthBName})`}
          >{synthBEnabled ? "● SYNTH B" : "○ SYNTH B"}</button>
          <button
            onClick={() => setDrumsEnabled(!drumsEnabled)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
              drumsEnabled ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]" : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute the drum channel"
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

  return (
    <GlassPanel intense className="p-3.5">
      {/* Transport — three balanced zones */}
      <div className="mb-2.5 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_auto_minmax(0,1fr)] lg:items-center">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            onClick={togglePlay}
            className={`h-10 px-5 rounded-xl font-bold text-sm tracking-wide border transition ${
              playing
                ? "border-[#ff6a3d] bg-[#ff6a3d]/25 text-[#ffd9c9] shadow-[0_0_22px_rgb(255_106_61/0.4)]"
                : "border-[#ff6a3d]/50 bg-[#ff6a3d]/10 text-[#ffbfa0] hover:bg-[#ff6a3d]/20"
            }`}
            title={
              playMode === "arrangement"
                ? "Play / stop the arrangement timeline"
                : "Play / stop the pattern open in the editor"
            }
          >
            {playing ? "■ HOLD FIRE" : "▶ OPEN FIRE"}
          </button>
          <span
            className="hidden sm:inline text-[9px] font-bold uppercase tracking-[0.14em] px-2 py-1 rounded-md border border-white/10 text-white/40"
            title="Transport play mode — switch above the timeline"
          >
            {playMode === "arrangement" ? "Arrangement" : "Pattern"}
          </span>

          <button
            onClick={() => setRecording(!recording)}
            className={`h-10 px-3.5 rounded-xl font-bold text-sm border transition ${
              recording
                ? "border-rose-500 bg-rose-500/25 text-rose-200 shadow-[0_0_18px_rgb(244_63_94/0.45)] animate-pulse"
                : "border-white/12 bg-white/[0.03] text-white/50 hover:text-rose-300 hover:border-rose-400/50"
            }`}
            title="Arm record: while playing, everything you play (QWERTY, on-screen keys, USB MIDI) lands in the piano roll with velocity and timing. Overdubs layer onto what's there."
          >
            ● REC
          </button>
          {recording && (
            <button
              onClick={() => setRecordQuantize(!recordQuantize)}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
                recordQuantize
                  ? "border-[#62b6ff]/60 bg-[#62b6ff]/12 text-[#b8dcff]"
                  : "border-white/10 bg-white/[0.03] text-white/40"
              }`}
              title="Quantize captured notes to the 1/16 grid (off = keep your exact timing)"
            >
              ⧗ 1/16
            </button>
          )}

          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-2.5 py-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-white/40">BPM</span>
            <input
              type="number"
              min={40}
              max={240}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value) || 128)}
              className="w-[58px] rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-sm font-mono text-white text-center outline-none focus:border-[#ff6a3d]/60"
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-black/25 px-2 py-1">
            <SwingControls />
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-2.5 py-1.5">
          <span className="text-[9px] uppercase tracking-[0.2em] text-white/40">Bars</span>
          {[1, 2, 4, MAX_BARS].map((b) => (
            <button
              key={b}
              onClick={() => setBars(b)}
              className={`w-8 h-8 rounded-lg text-xs font-mono border transition ${
                bars === b
                  ? "border-[#ff6a3d]/70 bg-[#ff6a3d]/15 text-[#ffbfa0]"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08]"
              }`}
            >{b}</button>
          ))}
          <button
            onClick={() => {
              const ok = useFireSequencerStore.getState().duplicatePattern();
              if (!ok) return;
            }}
            disabled={bars * 2 > MAX_BARS}
            className="h-8 px-2 rounded-lg text-[10px] font-semibold border border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08] hover:text-cyan disabled:opacity-30 transition"
            title="Double this pattern's length and repeat its contents (then vary the second half)"
          >
            Double len
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
          <span
            className="text-[9px] uppercase tracking-[0.2em] text-white/40"
            title="The three instruments this sequencer drives: Synth A (the big synth below), Synth B (a second preset voice) and the drum kit"
          >Channels</span>
          <button
            onClick={() => setSynthEnabled(!synthEnabled)}
            className={`h-8 px-3 rounded-lg text-xs font-semibold border transition ${
              synthEnabled
                ? "border-[#ff6a3d]/60 bg-[#ff6a3d]/12 text-[#ffbfa0]"
                : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute the Synth A channel (the playable synth below)"
          >
            {synthEnabled ? "● A" : "○ A"}
          </button>
          <button
            onClick={() => setSynthBEnabled(!synthBEnabled)}
            className={`h-8 px-3 rounded-lg text-xs font-semibold border transition ${
              synthBEnabled
                ? "border-[#62b6ff]/60 bg-[#62b6ff]/12 text-[#b8dcff]"
                : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute Synth B — a second instrument with its own voice and oscillators"
          >
            {synthBEnabled ? "● B" : "○ B"}
          </button>
          <button
            onClick={() => setDrumsEnabled(!drumsEnabled)}
            className={`h-8 px-3 rounded-lg text-xs font-semibold border transition ${
              drumsEnabled
                ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]"
                : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Arm / mute the drum channel"
          >
            {drumsEnabled ? "● DRM" : "○ DRM"}
          </button>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.02}
            value={drumLevel}
            onChange={(e) => setDrumLevel(Number(e.target.value))}
            className="w-[64px] accent-[#9be564]"
            title="Drum channel level"
            aria-label="Drum level"
          />
          {asWorkspace ? (
            <button
              type="button"
              onClick={openSynth}
              className="h-8 px-2.5 rounded-lg border border-[#ff6a3d]/35 bg-[#ff6a3d]/10 hover:bg-[#ff6a3d]/18 text-[11px] font-semibold text-[#ffbfa0] transition"
              title="Open Synth workspace"
            >
              ← Synth
            </button>
          ) : (
            <button
              onClick={() => setCollapsed(true)}
              className="h-8 px-2.5 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 text-[11px] text-white/75 transition"
              title="Collapse the sequencer to a compact transport strip"
            >▲</button>
          )}
        </div>
      </div>

      <ArrangementPlaylist />

      {/* Editor chrome — left editor / center draw / right file */}
      <div className="mb-2.5 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
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

        <div className="flex flex-wrap items-center justify-center gap-2">
          {tab === "roll" && (
            <>
              <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
                {([0, 1] as const).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setActiveChannel(ch)}
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
              <select
                value={synthBPresetId}
                onChange={(e) => setSynthBPresetId(e.target.value)}
                className="max-w-[160px] h-8 rounded-lg border border-white/12 bg-black/40 px-2 text-[11px] text-white/85 outline-none focus:border-[#62b6ff]/60"
                title="Load a factory preset into Synth B (editable in the Synth rack when Edit B is on)"
                style={{ color: synthBEnabled ? ICE : undefined }}
              >
                {presetGroups.map((g) => (
                  <optgroup key={g.cat} label={g.cat}>
                    {g.items.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
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

      {tab === "roll" ? (
        <RollFitProvider totalSteps={bars * STEPS_PER_BAR} gutter={PIANO_GUTTER}>
          <PianoRoll />
          <AutomationLane />
        </RollFitProvider>
      ) : (
        <div className="w-full min-w-0">
          <DrumMachine />
        </div>
      )}
    </GlassPanel>
  );
});
