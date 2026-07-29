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
import { ArrangementPlaylist } from "./ArrangementPlaylist";
import { CollapseToggle } from "./CollapseToggle";
import { useFireCollapsed } from "./useFireCollapsed";
import { PresetSearchCombobox, type PresetSearchOption } from "./PresetSearchCombobox";
import { PatternSelect } from "./PatternSelect";
import {
  SEQ,
  SEQ_CTRL,
  SEQ_GROUP_LABEL,
  SEQ_HINT,
  SEQ_META,
  SEQ_PILL,
  SEQ_PILL_DESTRUCTIVE,
  SEQ_PILL_DESTRUCTIVE_ARM,
  SEQ_TITLE,
  SeqGroup,
  SeqSegment,
  SeqSegmented,
} from "./seqChrome";
import { FullscreenEditorShell, EditorModeSwitch } from "./EditorShell";

const FIRE = SEQ.fire;
const ICE = SEQ.ice;
const BRASS = SEQ.brass;
const BRASS_SOFT = SEQ.brassSoft;
const BRASS_GLOW = "rgba(232,184,109,0.35)";

type Tab = "roll" | "drums";

/**
 * Swing controls (v1.6): one knobs when linked; unlink to give drums and the
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
    <div className="flex items-center gap-1.5" title={title}>
      <span className="text-[10px] uppercase tracking-[0.08em] text-white/55 w-8 text-right">{label}</span>
      <input
        type="range"
        min={0}
        max={0.6}
        step={0.02}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[58px] accent-[#e8b86d]"
        aria-label={`${label} swing ${Math.round(value * 100)} percent`}
      />
      <span className="text-[11px] font-mono tabular-nums text-[rgba(245,217,168,0.85)] w-8">
        {Math.round(value * 100)}%
      </span>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={SEQ_GROUP_LABEL} title="Delays every off-beat 16th for groove">
        Swing
      </span>
      <button
        type="button"
        onClick={() => setSwingLinked(!swingLinked)}
        className={`${SEQ_CTRL} !h-7 !px-2 text-[10px]`}
        style={
          swingLinked
            ? { color: "rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.06)" }
            : { color: BRASS_SOFT, background: "rgba(232,184,109,0.16)", borderColor: "rgba(232,184,109,0.45)" }
        }
        title={
          swingLinked
            ? "Linked: one groove for everything. Click to give drums and samples their own swing."
            : "Unlinked: melody, drums and samples each swing on their own. Click to re-link."
        }
        aria-pressed={!swingLinked}
        aria-label={swingLinked ? "Unlink swing groups" : "Link swing groups"}
      >
        {swingLinked ? "🔗" : "⛓️‍💥"}
      </button>
      {swingLinked ? (
        <div className="flex items-center gap-2" title="Delays every off-beat 16th for groove (all groups)">
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.02}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className="w-[88px] accent-[#e8b86d]"
            aria-label={`Swing ${Math.round(swing * 100)} percent`}
          />
          <span className="text-[11px] font-mono tabular-nums text-[rgba(245,217,168,0.9)] min-w-[2.25rem]">
            {Math.round(swing * 100)}%
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
  const setPlayScope = useFireSequencerStore((s) => s.setPlayScope);
  const recording = useFireSequencerStore((s) => s.recording);
  const recordQuantize = useFireSequencerStore((s) => s.recordQuantize);
  const recordMode = useFireSequencerStore((s) => s.recordMode);
  const recordCountIn = useFireSequencerStore((s) => s.recordCountIn);
  const metronome = useFireSequencerStore((s) => s.metronome);
  const setRecording = useFireSequencerStore((s) => s.setRecording);
  const setRecordQuantize = useFireSequencerStore((s) => s.setRecordQuantize);
  const setRecordMode = useFireSequencerStore((s) => s.setRecordMode);
  const setRecordCountIn = useFireSequencerStore((s) => s.setRecordCountIn);
  const setMetronome = useFireSequencerStore((s) => s.setMetronome);
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const selectedClipId = useFireSequencerStore((s) => s.selectedClipId);
  const playlistTracks = useFireSequencerStore((s) => s.playlistTracks);
  const arrangement = useFireSequencerStore((s) => s.arrangement);
  const notes = useFireSequencerStore((s) => s.notes);
  const selectionStart = useFireSequencerStore((s) => s.selectionStart);
  const selectionEnd = useFireSequencerStore((s) => s.selectionEnd);
  const linkedClipCount = useFireSequencerStore((s) => s.linkedClipCount);
  const varyPattern = useFireSequencerStore((s) => s.varyPattern);
  const humanizeNotes = useFireSequencerStore((s) => s.humanizeNotes);

  const [tab, setTab] = useState<Tab>("roll");
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [variationsOpen, setVariationsOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const toast = useUIStore((s) => s.toast);
  const [editorCollapsed, toggleEditor] = useFireCollapsed("seq.editor", false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditorFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorFullscreen]);

  useEffect(() => {
    if (asWorkspace && collapsed) setCollapsed(false);
  }, [asWorkspace, collapsed, setCollapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement
        || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable)
      ) return;
      const panel = panelRef.current;
      if (!panel) return;
      const target = e.target instanceof Node ? e.target : null;
      const focused = document.activeElement;
      const inside = (target && panel.contains(target))
        || (focused instanceof Node && panel.contains(focused));
      if (!inside) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      } else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setRecording(!recording);
      } else if ((e.key === "q" || e.key === "Q") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setRecordQuantize(!recordQuantize);
      } else if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        humanizeNotes();
        toast("Notes humanized");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, recordQuantize, setRecording, setRecordQuantize, humanizeNotes, toast]);

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

  const hasLoopSelection = useMemo(() => {
    if (selectionEnd <= selectionStart) return false;
    return notes.some((n) => n.step + n.len > selectionStart && n.step < selectionEnd);
  }, [notes, selectionStart, selectionEnd]);

  const selectedClip = selectedClipId
    ? arrangement.find((c) => c.id === selectedClipId) ?? null
    : null;
  const linkedN = linkedClipCount(activeSectionId);

  const toggleLoopScope = () => {
    if (!hasLoopSelection) {
      toast("Selection empty — select notes to loop a range");
      return;
    }
    setPlayScope(playScope === "selection" ? "pattern" : "selection");
  };

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
    <div ref={panelRef} tabIndex={-1} className="outline-none flex flex-col flex-1 min-h-0">
      {/* Brass transport — matches Synth-side FireMiniTransport */}
      <div
        className={`relative overflow-hidden shrink-0 ${flush ? "" : "rounded-2xl mb-2.5"}`}
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

        <div className="relative z-10 seq-header">
          {/* A — Primary application header */}
          <div className="seq-header__primary">
            <div className="seq-header__transport">
              <div className="seq-header__cluster">
                <button
                  onClick={togglePlay}
                  className="relative h-9 px-4 rounded-lg font-black text-[12px] uppercase tracking-[0.1em] transition overflow-hidden shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer"
                  style={
                    playing
                      ? {
                          color: "#1a1208",
                          background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                          boxShadow: `0 0 20px ${BRASS_GLOW}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                        }
                      : {
                          color: BRASS_SOFT,
                          background: "rgba(232,184,109,0.12)",
                          boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.45)",
                        }
                  }
                  title={`Open Fire — play/stop ${playScope}`}
                  aria-pressed={playing}
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
              </div>

              <SeqGroup label="Target">
                <SeqSegmented aria-label="Play target">
                  {([
                    { id: "pattern" as const, label: "Pattern" },
                    { id: "arrangement" as const, label: "Arrangement" },
                    { id: "selection" as const, label: "Selection" },
                  ]).map((opt) => (
                    <SeqSegment
                      key={opt.id}
                      brass
                      active={playScope === opt.id}
                      onClick={() => setPlayScope(opt.id)}
                      title={`Play target: ${opt.label}`}
                    >
                      {opt.label}
                    </SeqSegment>
                  ))}
                </SeqSegmented>
              </SeqGroup>

              <div className="seq-header__cluster" role="group" aria-label="Transport">
                <button
                  type="button"
                  onClick={toggleLoopScope}
                  className={SEQ_CTRL}
                  style={
                    playScope === "selection"
                      ? {
                          color: "#1a1208",
                          background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                          borderColor: "rgba(232,184,109,0.55)",
                          fontWeight: 700,
                        }
                      : undefined
                  }
                  title={
                    hasLoopSelection
                      ? "Loop the selected note range (toggle selection scope)"
                      : "Pattern / arrangement always loop — select notes to loop a range"
                  }
                  aria-pressed={playScope === "selection"}
                >
                  {playScope === "selection" ? "● Loop" : "Loop"}
                </button>

                <button
                  onClick={() => setRecording(!recording)}
                  className="h-8 px-3 rounded-lg font-bold text-[11px] uppercase tracking-[0.08em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400/60 cursor-pointer inline-flex items-center gap-1.5"
                  style={
                    recording
                      ? {
                          color: "#fecdd3",
                          background: "rgba(244,63,94,0.28)",
                          boxShadow: "0 0 14px rgba(244,63,94,0.35), inset 0 0 0 1px rgba(244,63,94,0.75)",
                          fontWeight: 800,
                        }
                      : {
                          color: "rgba(255,255,255,0.55)",
                          background: "rgba(0,0,0,0.28)",
                          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
                        }
                  }
                  title="Arm record: while playing, everything you play lands in the piano roll"
                  aria-pressed={recording}
                  aria-label={recording ? "Disarm record" : "Arm record"}
                >
                  <span
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: recording ? "#fb7185" : "rgba(255,255,255,0.35)",
                      boxShadow: recording ? "0 0 8px #fb7185" : undefined,
                    }}
                  />
                  Rec
                </button>

                <div
                  className="flex items-center gap-1.5 rounded-lg px-2.5 h-8"
                  style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.2)" }}
                >
                  <span className={SEQ_GROUP_LABEL}>BPM</span>
                  <input
                    type="number"
                    min={40}
                    max={240}
                    value={bpm}
                    onChange={(e) => setBpm(Number(e.target.value) || 128)}
                    className="w-[52px] h-6 rounded-md bg-black/40 px-1 text-[13px] font-mono text-center outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[rgba(232,184,109,0.65)]"
                    style={{ color: BRASS_SOFT, boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.22)" }}
                    aria-label="Tempo BPM"
                  />
                </div>
              </div>

              {recording && (
                <div className="seq-header__cluster">
                  <button
                    onClick={() => setRecordMode(recordMode === "overdub" ? "replace" : "overdub")}
                    className={SEQ_CTRL}
                    title="Toggle overdub vs replace"
                  >
                    {recordMode === "replace" ? "Replace" : "Overdub"}
                  </button>
                  <button
                    onClick={() => setRecordCountIn((recordCountIn + 1) % 5)}
                    className={SEQ_CTRL}
                    title="Count-in bars"
                  >
                    {recordCountIn === 0 ? "No count-in" : `${recordCountIn} bar count-in`}
                  </button>
                  <button
                    onClick={() => setMetronome(!metronome)}
                    className={SEQ_CTRL}
                    style={metronome ? { borderColor: "rgba(251,191,36,0.45)", color: "#fde68a" } : undefined}
                    aria-pressed={metronome}
                  >
                    Metro
                  </button>
                  <button
                    onClick={() => setRecordQuantize(!recordQuantize)}
                    className={SEQ_CTRL}
                    style={
                      recordQuantize
                        ? { color: BRASS_SOFT, background: "rgba(232,184,109,0.16)", borderColor: "rgba(232,184,109,0.45)" }
                        : undefined
                    }
                    title="Quantize captured notes to the 1/16 grid"
                    aria-pressed={recordQuantize}
                  >
                    ⧗ 1/16
                  </button>
                  <span className={`${SEQ_HINT} font-mono text-rose-200/80`}>
                    REC · {recordMode.toUpperCase()}
                    {recordCountIn > 0 ? ` · ${recordCountIn}b IN` : " · NO IN"}
                    {" · "}
                    {recordQuantize ? "1/16" : "FREE"}
                  </span>
                </div>
              )}

              <SwingControls />
            </div>

            <div className="seq-header__layers">
              <SeqGroup label="Layers" hint="arm · mute">
                <div
                  className="inline-flex items-center gap-1 rounded-lg p-1"
                  style={{ background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.18)" }}
                  role="group"
                  aria-label="Layer arm / mute"
                >
                  {([
                    { on: synthEnabled, toggle: () => setSynthEnabled(!synthEnabled), label: "A", accent: "#ff8f6b", soft: "#ffd0c0", title: "Synth A — click to arm or mute", name: "Synth A" },
                    { on: synthBEnabled, toggle: () => setSynthBEnabled(!synthBEnabled), label: "B", accent: "#7dd3fc", soft: "#e0f2fe", title: "Synth B — click to arm or mute", name: "Synth B" },
                    { on: drumsEnabled, toggle: () => setDrumsEnabled(!drumsEnabled), label: "DRM", accent: "#bef264", soft: "#ecfccb", title: "Drums — click to arm or mute", name: "Drums" },
                  ] as const).map((ch) => (
                    <button
                      key={ch.label}
                      onClick={ch.toggle}
                      className="h-8 min-w-[2.75rem] px-2.5 rounded-md text-[11px] font-black tracking-wide transition inline-flex items-center justify-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer"
                      style={
                        ch.on
                          ? { color: ch.soft, background: `${ch.accent}22`, boxShadow: `inset 0 0 0 1px ${ch.accent}70, 0 0 10px ${ch.accent}28` }
                          : { color: "rgba(255,255,255,0.38)", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }
                      }
                      title={ch.title}
                      aria-pressed={ch.on}
                      aria-label={`${ch.name} ${ch.on ? "armed" : "muted"}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: ch.on ? ch.accent : "rgba(255,255,255,0.22)", boxShadow: ch.on ? `0 0 6px ${ch.accent}` : undefined }}
                        aria-hidden
                      />
                      {ch.label}
                    </button>
                  ))}
                </div>
              </SeqGroup>
              <input
                type="range"
                min={0}
                max={1.2}
                step={0.02}
                value={drumLevel}
                onChange={(e) => setDrumLevel(Number(e.target.value))}
                className="w-[64px] accent-[#bef264]"
                title="Drum layer level"
                aria-label="Drum layer level"
              />
              {!asWorkspace && (
                <button
                  onClick={() => setCollapsed(true)}
                  className={SEQ_CTRL}
                  title="Collapse the sequencer to a compact transport strip"
                  aria-label="Collapse sequencer"
                >▲</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ArrangementPlaylist flush={flush} />

      {/* D — Editor toolbar */}
      <div
        className={
          flush
            ? "seq-editor-bar bg-gradient-to-b from-white/[0.03] to-transparent border-b border-white/[0.06]"
            : "mb-2.5 seq-editor-bar rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent"
        }
      >
        <div className="seq-editor-bar__group !pl-1 !border-l-0">
          <button
            type="button"
            onClick={toggleEditor}
            className="inline-flex items-center gap-2 h-8 min-w-0 text-left hover:opacity-90 transition rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
            aria-expanded={!editorCollapsed}
            title={editorCollapsed ? "Expand piano roll / drums" : "Collapse piano roll / drums"}
            aria-label={editorCollapsed ? "Expand editor" : "Collapse editor"}
          >
            <CollapseToggle collapsed={editorCollapsed} color={FIRE} />
            <span className={SEQ_TITLE}>
              {tab === "roll" ? "Piano roll" : "Drums"}
            </span>
          </button>
        </div>

        {/* Group 1: Editor type */}
        <div className="seq-editor-bar__group">
          <EditorModeSwitch tab={tab} onChange={setTab} noteCount={noteCount} />
        </div>

        {/* Group 2: View and pattern */}
        <div className="seq-editor-bar__group">
          <button
            type="button"
            onClick={() => setEditorFullscreen((v) => !v)}
            className={SEQ_PILL}
            title={editorFullscreen ? "Exit fullscreen editor (Esc)" : "Fullscreen piano roll / drums"}
          >
            {editorFullscreen ? "Exit FS" : "Fullscreen"}
          </button>
          <PatternSelect />
          {(() => {
            const clip = selectedClip;
            const tr = clip ? playlistTracks[clip.track] : null;
            const sec = sections.find((s) => s.id === activeSectionId);
            const unique = clip?.unique;
            return (
              <div className={`${SEQ_META} font-mono max-w-[16rem] hidden lg:block`} title="Editor status">
                {tr ? `${tr.name} / ` : ""}
                {sec ? `Pat ${sec.name}` : ""}
                {unique ? " · Unique" : clip ? " · Linked" : ""}
                {` / ${tab === "roll" ? "Roll" : "Drums"}`}
              </div>
            );
          })()}
          {(selectedClip?.unique || (!selectedClip?.unique && linkedN > 1)) && (
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.08em] px-2 h-8 inline-flex items-center rounded-lg border"
              style={
                selectedClip?.unique
                  ? { color: "#7ce8d5", borderColor: "rgba(124,232,213,0.4)", background: "rgba(124,232,213,0.1)" }
                  : { color: "#ffb648", borderColor: "rgba(255,182,72,0.45)", background: "rgba(255,182,72,0.12)" }
              }
            >
              {selectedClip?.unique ? "Unique clip" : `Source · ${linkedN} linked`}
            </div>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setVariationsOpen((v) => !v)}
              className={
                variationsOpen
                  ? "inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border border-violet-400/50 bg-violet-500/15 text-violet-200 transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-300/60"
                  : SEQ_PILL
              }
              title="Pattern variations — duplicate, mutate, simplify…"
              aria-expanded={variationsOpen}
            >
              Variations ▾
            </button>
            {variationsOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 cursor-default"
                  aria-label="Close variations menu"
                  onClick={() => setVariationsOpen(false)}
                />
                <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-xl border border-white/12 bg-[#12151c] shadow-xl p-1 space-y-0.5">
                  {([
                    ["duplicate", "Duplicate"],
                    ["mutate", "Mutate"],
                    ["simplify", "Simplify"],
                    ["densify", "Densify"],
                    ["fill", "Make fill"],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setVariationsOpen(false);
                        varyPattern(mode);
                        toast(`Variation: ${label}`);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-white/70 hover:bg-white/8 hover:text-white transition"
                    >
                      {label}
                    </button>
                  ))}
                  <div className="px-2.5 py-1 text-[10px] text-white/45 border-t border-white/8 mt-0.5">
                    Natural Selection lives in the mutate chrome.
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-[12px] font-bold border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400/60 ${
              showShortcuts
                ? "border-cyan/50 bg-cyan/10 text-cyan"
                : "border-white/14 text-white/55 hover:text-white/85 hover:bg-white/[0.06]"
            }`}
            title="Keyboard shortcuts (?)"
            aria-pressed={showShortcuts}
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
        </div>

        {tab === "roll" && (
          <>
            {/* Group 3: Drawing lane */}
            <div className="seq-editor-bar__group">
              <SeqSegmented aria-label="Draw lane">
                {([0, 1] as const).map((ch) => (
                  <SeqSegment
                    key={ch}
                    active={activeChannel === ch}
                    accent={ch === 0 ? FIRE : ICE}
                    onClick={() => {
                      setActiveChannel(ch);
                      setEditTarget(ch === 0 ? "a" : "b");
                    }}
                    title={
                      ch === 0
                        ? "Draw Synth A (orange) — also focuses the Synth rack on A"
                        : "Draw Synth B (blue) — also focuses the Synth rack on B"
                    }
                  >
                    Draw {ch === 0 ? "A" : "B"}
                  </SeqSegment>
                ))}
              </SeqSegmented>
            </div>

            {/* Group 4: Instrument */}
            <div className="seq-editor-bar__group">
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
            </div>
          </>
        )}

        <div className="seq-editor-bar__spacer" />

        {/* Group 5: File actions */}
        <div className="seq-editor-bar__file !border-l-0 sm:!border-l sm:border-white/10">
          <button
            type="button"
            onClick={() => void doSaveProject()}
            className={SEQ_PILL}
            title="Save project (.kcproj)"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void doExportWav()}
            disabled={!!exporting}
            className={`inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border transition shrink-0 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400/60 ${
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
              className={
                fileMenuOpen
                  ? "inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border border-cyan/50 bg-cyan/10 text-cyan transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400/60"
                  : SEQ_PILL
              }
              title="Open project, format, stems"
              aria-expanded={fileMenuOpen}
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
                    <span className="text-[10px] uppercase tracking-wider text-white/45">Format</span>
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
          <div className="seq-editor-bar__clear">
            <button
              onClick={doClear}
              className={confirmClear ? SEQ_PILL_DESTRUCTIVE_ARM : SEQ_PILL_DESTRUCTIVE}
              title={`Clear ${tab === "roll" ? "notes" : "drums"} — click twice to confirm`}
              aria-label={confirmClear ? `Confirm clear ${tab === "roll" ? "notes" : "drums"}` : `Clear ${tab === "roll" ? "notes" : "drums"}`}
            >
              {confirmClear ? "Confirm?" : "Clear"}
            </button>
          </div>
        </div>
      </div>

      {showShortcuts && (
        <div className="mb-2 rounded-xl border border-cyan/25 bg-cyan/5 px-3 py-2 text-[10px] text-white/70">
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan/80 mb-1.5">Sequencer shortcuts</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 font-mono">
            <span><kbd className="text-white/90">Space</kbd> Play / stop (count-in if REC armed)</span>
            <span><kbd className="text-white/90">R</kbd> Arm / disarm record</span>
            <span><kbd className="text-white/90">D</kbd> Draw tab (piano roll)</span>
            <span><kbd className="text-white/90">Q</kbd> Toggle 1/16 quantize</span>
            <span><kbd className="text-white/90">H</kbd> Humanize notes</span>
            <span><kbd className="text-white/90">M / S</kbd> Mute / solo tracks</span>
            <span><kbd className="text-white/90">Loop</kbd> Selection loop scope</span>
            <span><kbd className="text-white/90">?</kbd> This overlay</span>
          </div>
        </div>
      )}

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

      {editorFullscreen && (
        <FullscreenEditorShell
          title={tab === "roll" ? "Piano Roll" : "Drums"}
          context={
            sections.find((s) => s.id === activeSectionId)
              ? `Pattern ${sections.find((s) => s.id === activeSectionId)?.name ?? ""} · ${bars} bar${bars === 1 ? "" : "s"}`
              : undefined
          }
          onExit={() => setEditorFullscreen(false)}
          right={
            <>
              <EditorModeSwitch tab={tab} onChange={setTab} noteCount={noteCount} />
              <PatternSelect />
            </>
          }
        >
          <div className="flex-1 min-h-0 overflow-auto editor-scroll p-2">
            {tab === "roll" ? (
              <RollFitProvider totalSteps={bars * STEPS_PER_BAR} gutter={PIANO_GUTTER}>
                <PianoRoll tall />
                <AutomationLane />
              </RollFitProvider>
            ) : (
              <DrumMachine />
            )}
          </div>
        </FullscreenEditorShell>
      )}
    </div>
  );

  return flush ? (
    <div className="relative flex-1 min-h-0 flex flex-col rounded-b-2xl bg-gradient-to-b from-transparent to-black/20">
      {body}
    </div>
  ) : (
    <GlassPanel intense className="p-3.5">
      {body}
    </GlassPanel>
  );
});
