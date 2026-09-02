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
  fireExportPreflight,
  type ExportFormat,
} from "@/lib/fireStudio";
import {
  retryHydrateFireSamples,
  toastFireMissingOnExport,
  toastFireMissingOnOpen,
  toastFireRetryResult,
} from "@/lib/fireSampleRepair";
import { FIRE_MISSING_SAMPLES_TERM } from "@/lib/retailHelp";
import { FireExportToLibraryModal } from "./FireExportToLibraryModal";
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
  SEQ_META,
  SEQ_PILL,
  SEQ_PILL_DESTRUCTIVE,
  SEQ_PILL_DESTRUCTIVE_ARM,
  SEQ_TITLE,
  SeqSegment,
  SeqSegmented,
} from "./seqChrome";
import { FullscreenEditorShell, EditorModeSwitch } from "./EditorShell";

const FIRE = SEQ.fire;
const ICE = SEQ.ice;

type Tab = "roll" | "drums";

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
  const noteCount = useFireSequencerStore((s) => s.notes.length);
  const togglePlay = useFireSequencerStore((s) => s.togglePlay);
  const setSynthEnabled = useFireSequencerStore((s) => s.setSynthEnabled);
  const setDrumsEnabled = useFireSequencerStore((s) => s.setDrumsEnabled);
  const setSynthBEnabled = useFireSequencerStore((s) => s.setSynthBEnabled);
  const setSynthBPresetId = useFireSequencerStore((s) => s.setSynthBPresetId);
  const setActiveChannel = useFireSequencerStore((s) => s.setActiveChannel);
  const clearNotes = useFireSequencerStore((s) => s.clearNotes);
  const clearDrums = useFireSequencerStore((s) => s.clearDrums);
  const collapsed = useFireSequencerStore((s) => s.collapsed);
  const setCollapsed = useFireSequencerStore((s) => s.setCollapsed);
  const playMode = useFireSequencerStore((s) => s.playMode);
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
  const linkedClipCount = useFireSequencerStore((s) => s.linkedClipCount);
  const varyPattern = useFireSequencerStore((s) => s.varyPattern);
  const humanizeNotes = useFireSequencerStore((s) => s.humanizeNotes);

  const [tab, setTab] = useState<Tab>("roll");
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [libraryExportOpen, setLibraryExportOpen] = useState(false);
  const [variationsOpen, setVariationsOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [missingSamples, setMissingSamples] = useState<string[]>([]);
  const [retryingSamples, setRetryingSamples] = useState(false);
  const toast = useUIStore((s) => s.toast);
  const openGlossary = useUIStore((s) => s.openGlossary);
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
      } else if ((e.key === "h" || e.key === "H") && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const n = humanizeNotes();
        toast(n > 0 ? `Scattered · ${n} note${n === 1 ? "" : "s"}` : "Scatter · nothing to change");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, recordQuantize, setRecording, setRecordQuantize, humanizeNotes, toast]);

  const doExportWav = async () => {
    if (exporting) return;
    const gate = await fireExportPreflight();
    if (!gate.ok) {
      toast(gate.reason ?? "Nothing to export");
      return;
    }
    if (gate.missingSamples.length > 0) {
      toastFireMissingOnExport(toast, gate.missingSamples.length, "wav");
    }
    setExporting("arming…");
    try {
      const res = await exportPatternWav(
        (p) => setExporting(`${p.stage} ${Math.round(p.fraction * 100)}%`),
        exportFormat,
      );
      if (!res?.path) {
        toast(res ? "Export cancelled or silent" : "Export unavailable", "warn");
        return;
      }
      const how = res.method === "offline"
        ? "Fire dry · offline (no live ARP)"
        : "Fire dry · realtime (Kill-Chain master on this fallback)";
      toast(`Exported (${how}) → ${res.path.split(/[\\/]/).pop()}`, "success");
    } catch {
      toast("Export failed", "error");
    } finally {
      setExporting(null);
    }
  };

  const doExportStems = async () => {
    if (exporting) return;
    const gate = await fireExportPreflight();
    if (!gate.ok) {
      toast(gate.reason ?? "Nothing to export");
      return;
    }
    if (gate.missingSamples.length > 0) {
      toastFireMissingOnExport(toast, gate.missingSamples.length, "stems");
    }
    setExporting("arming…");
    try {
      const res = await exportStems(
        (p) => setExporting(`${p.stage} ${Math.round(p.fraction * 100)}%`),
        exportFormat,
      );
      if (!res) {
        toast("Stems export cancelled", "warn");
        return;
      }
      const how = res.method === "offline" ? "offline" : "realtime";
      const kcNote = res.method === "offline" ? " (dry; Kill-Chain master on realtime fallback)" : "";
      toast(`${res.written.length} stems (${how})${kcNote} → ${res.dir.split(/[\\/]/).pop()}`, "success");
    } catch {
      toast("Stems export failed", "error");
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
    if (res.ok) {
      const paths = res.missingSamples ?? [];
      const n = paths.length;
      setMissingSamples(paths);
      if (n > 0) {
        toastFireMissingOnOpen(toast, n, paths);
      } else {
        toast("Project loaded — patch, pattern, samples", "success");
      }
    } else if (res.error) toast(res.error, "error");
  };

  const doRetrySamples = async () => {
    if (retryingSamples) return;
    setRetryingSamples(true);
    try {
      const stillMissing = await retryHydrateFireSamples();
      setMissingSamples(stillMissing);
      toastFireRetryResult(toast, stillMissing);
    } finally {
      setRetryingSamples(false);
    }
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

  const selectedClip = selectedClipId
    ? arrangement.find((c) => c.id === selectedClipId) ?? null
    : null;
  const linkedN = linkedClipCount(activeSectionId);

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
    <div ref={panelRef} tabIndex={-1} data-fire-sequencer className="outline-none flex flex-col flex-1 min-h-0">
      <ArrangementPlaylist flush={flush} />

      {missingSamples.length > 0 && (
        <div
          className={
            flush
              ? "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-amber-400/25 bg-amber-500/10 text-[11px] text-amber-100/90"
              : "mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90"
          }
        >
          <span>
            {missingSamples.length} sample{missingSamples.length === 1 ? "" : "s"} not found on disk
          </span>
          <button
            type="button"
            onClick={() => void doRetrySamples()}
            disabled={retryingSamples}
            className="kc-btn kc-btn--sm kc-btn--ghost"
          >
            {retryingSamples ? "Retrying…" : "Retry sample load"}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("drums");
              openGlossary(FIRE_MISSING_SAMPLES_TERM);
            }}
            className="kc-btn kc-btn--sm kc-btn--ghost"
          >
            Repair tip
          </button>
          <button
            type="button"
            onClick={() => setMissingSamples([])}
            className="ml-auto text-[10px] uppercase tracking-widest text-amber-200/60 hover:text-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}

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
            title={playMode === "arrangement" ? "Export arrangement — Fire dry bounce (offline omits live ARP)" : "Export pattern — Fire dry bounce (offline omits live ARP)"}
          >
            {exporting ?? (playMode === "arrangement" ? "Export song (dry)" : "Export dry")}
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
                <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-white/12 bg-[#12151c] shadow-xl p-1 space-y-0.5">
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
                  <button
                    onClick={() => { setFileMenuOpen(false); setLibraryExportOpen(true); }}
                    disabled={!!exporting}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-[#f5d9a8]/90 hover:bg-[rgba(232,184,109,0.1)] transition disabled:opacity-40"
                  >Export to Library (Fire dry)…</button>
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
            <span><kbd className="text-white/90">Q</kbd> Toggle 1/16 quantize</span>
            <span><kbd className="text-white/90">Shift+H</kbd> Scatter notes (timing + velocity)</span>
            <span><kbd className="text-white/90">Loop</kbd> Selection loop scope</span>
            <span><kbd className="text-white/90">?</kbd> This overlay</span>
          </div>
        </div>
      )}

      {!editorCollapsed && !editorFullscreen && (tab === "roll" ? (
        <RollFitProvider totalSteps={bars * STEPS_PER_BAR} gutter={PIANO_GUTTER}>
          <PianoRoll />
          <AutomationLane />
        </RollFitProvider>
      ) : !editorCollapsed && !editorFullscreen ? (
        <div className="w-full min-w-0">
          <DrumMachine />
        </div>
      ) : null)}

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
      <FireExportToLibraryModal
        open={libraryExportOpen}
        onClose={() => setLibraryExportOpen(false)}
      />
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
