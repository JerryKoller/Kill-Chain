/**
 * SequencerPanel — the Fire Command "war room": transport + piano roll +
 * drum grid, FL-Studio style. Lives at the top of the synth view.
 */

import { useEffect, useMemo, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { PianoRoll } from "./PianoRoll";
import { DrumMachine } from "./DrumMachine";
import { AutomationLane } from "./AutomationLane";
import {
  useFireSequencerStore,
  getPlayingSectionId,
  getPlayingChainIndex,
  MAX_BARS,
  MAX_SECTIONS,
  MAX_CHAIN,
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

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";

type Tab = "roll" | "drums";

/** Auto-assigned section colors (block timeline + tabs). */
const SECTION_COLORS = [
  "#ff6a3d", "#62b6ff", "#9be564", "#c98bff",
  "#ffd166", "#ff7bac", "#7ce8d5", "#ffb648",
];

/**
 * ArrangementStrip (v1.6) — section tabs + the song chain.
 * Sections are full pattern variants; the chain strings them into a song.
 */
function ArrangementStrip() {
  const sections = useFireSequencerStore((s) => s.sections);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const chain = useFireSequencerStore((s) => s.chain);
  const playMode = useFireSequencerStore((s) => s.playMode);
  const playing = useFireSequencerStore((s) => s.playing);
  const setActiveSection = useFireSequencerStore((s) => s.setActiveSection);
  const addSection = useFireSequencerStore((s) => s.addSection);
  const renameSection = useFireSequencerStore((s) => s.renameSection);
  const removeSection = useFireSequencerStore((s) => s.removeSection);
  const appendToChain = useFireSequencerStore((s) => s.appendToChain);
  const removeChainAt = useFireSequencerStore((s) => s.removeChainAt);
  const moveChainTo = useFireSequencerStore((s) => s.moveChainTo);
  const setPlayMode = useFireSequencerStore((s) => s.setPlayMode);
  const toast = useUIStore((s) => s.toast);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [playingSection, setPlayingSection] = useState<string | null>(null);
  const [playingSlot, setPlayingSlot] = useState(-1);
  // Drag-reorder state for the block timeline.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // Glow the section + chain block the song is currently sounding.
  useEffect(() => {
    if (!playing || playMode !== "song") {
      setPlayingSection(null);
      setPlayingSlot(-1);
      return;
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      setPlayingSection((prev) => {
        const cur = getPlayingSectionId();
        return cur === prev ? prev : cur;
      });
      setPlayingSlot((prev) => {
        const cur = getPlayingChainIndex();
        return cur === prev ? prev : cur;
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, playMode]);

  const nameOf = (id: string) => sections.find((s) => s.id === id)?.name ?? "?";
  /** Stable per-section color: index in the section list drives the palette. */
  const colorOf = (id: string) =>
    SECTION_COLORS[Math.max(0, sections.findIndex((s) => s.id === id)) % SECTION_COLORS.length];

  const commitRename = (id: string) => {
    renameSection(id, renameValue);
    setRenaming(null);
  };

  // Help is opt-in (v2.5.8) — never eat a full row on first launch.
  const [showHelp, setShowHelp] = useState(false);
  // Chain row stays visible in Song mode; otherwise starts folded.
  const [chainOpen, setChainOpen] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem("killchain.firecmd.chainopen");
      if (saved === "1") return true;
      if (saved === "0") return false;
    } catch { /* ignore */ }
    return false;
  });
  const showChain = playMode === "song" || chainOpen;

  const toggleChainOpen = () => {
    const next = !chainOpen;
    setChainOpen(next);
    try { window.localStorage.setItem("killchain.firecmd.chainopen", next ? "1" : "0"); } catch { /* ignore */ }
  };

  return (
    <div className="mb-2.5 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.045] to-white/[0.015] px-3 py-2.5 space-y-2">
      {/* One primary row: sections + play mode */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45 shrink-0"
          title="Pattern variants — the editors below edit the highlighted one"
        >Sections</span>
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
        {sections.map((sec) => {
          const active = sec.id === activeSectionId;
          const sounding = playingSection === sec.id;
          if (renaming === sec.id) {
            return (
              <input
                key={sec.id}
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(sec.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(sec.id);
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="w-20 rounded-lg border border-[#ff6a3d]/60 bg-black/40 px-2 py-1 text-xs text-white outline-none"
              />
            );
          }
          const color = colorOf(sec.id);
          return (
            <span key={sec.id} className="group inline-flex items-center">
              <button
                onClick={() => setActiveSection(sec.id)}
                onDoubleClick={() => { setRenaming(sec.id); setRenameValue(sec.name); }}
                className={`h-7 px-2.5 rounded-l-lg ${sections.length > 1 ? "" : "rounded-r-lg"} text-[11px] font-bold border transition ${
                  active ? "" : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08]"
                }`}
                style={{
                  ...(active
                    ? { borderColor: `${color}b0`, background: `${color}22`, color }
                    : undefined),
                  ...(sounding ? { boxShadow: `0 0 12px ${color}80` } : undefined),
                }}
                title={`Edit section "${sec.name}" (${sec.bars} bar${sec.bars === 1 ? "" : "s"}) — double-click to rename`}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                  style={{ background: color, opacity: active ? 1 : 0.55 }}
                />
                {sec.name}
                <span className="ml-1 font-mono font-normal opacity-50">{sec.bars}</span>
              </button>
              {sections.length > 1 && (
                <button
                  onClick={() => removeSection(sec.id)}
                  className="h-7 px-1.5 rounded-r-lg text-[10px] border border-l-0 text-white/25 hover:text-rose-300 hover:bg-rose-500/10 transition"
                  style={active ? { borderColor: `${color}b0` } : { borderColor: "rgba(255,255,255,0.1)" }}
                  title={`Delete section "${sec.name}" (also removed from the chain)`}
                >✕</button>
              )}
            </span>
          );
        })}
        <button
          onClick={() => {
            const id = addSection();
            if (!id) toast(`Max ${MAX_SECTIONS} sections`);
          }}
          disabled={sections.length >= MAX_SECTIONS}
          className="h-7 px-2.5 rounded-lg text-[11px] border border-dashed border-white/20 text-white/50 hover:text-[#ffbfa0] hover:border-[#ff6a3d]/50 disabled:opacity-30 transition"
          title="New section — starts as a copy of the current one"
        >＋</button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        <div className="inline-flex rounded-lg border border-white/10 bg-black/25 p-0.5">
          {(["section", "song"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPlayMode(m)}
              className="px-2.5 py-1 text-[10px] font-bold rounded-md transition"
              style={
                playMode === m
                  ? { background: "rgba(255,106,61,0.2)", color: FIRE }
                  : { color: "rgba(255,255,255,0.4)" }
              }
              title={
                m === "section"
                  ? "Loop the section you're editing"
                  : "Play the chain start-to-finish, then loop"
              }
            >
              {m === "section" ? "Section" : "Song"}
            </button>
          ))}
        </div>

        <button
          onClick={toggleChainOpen}
          className={`h-7 px-2.5 rounded-lg text-[10px] border transition ${
            showChain
              ? "border-[#ff6a3d]/40 bg-[#ff6a3d]/10 text-[#ffbfa0]"
              : "border-white/10 text-white/45 hover:text-white/70"
          }`}
          title={showChain ? "Hide song chain" : "Show song chain"}
        >
          Chain {chain.length > 0 ? `(${chain.length})` : ""} {showChain ? "▴" : "▾"}
        </button>

        <button
          onClick={() => setShowHelp((v) => !v)}
          className="h-7 w-7 rounded-full border border-white/15 text-[11px] text-white/45 hover:text-white hover:border-white/40 transition"
          title="How sections and the chain work"
        >?</button>
        </div>
      </div>

      {showHelp && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#ff6a3d]/20 bg-[#ff6a3d]/[0.05] px-2 py-1 text-[10px] leading-relaxed text-white/65">
          <span><b className="text-[#ffbfa0]">Sections</b> — each tab is a full pattern variant. Editors below always edit the highlighted one.</span>
          <span><b className="text-[#ffbfa0]">Chain</b> — drag blocks into song order, then hit Song to play front to back.</span>
          <button onClick={() => setShowHelp(false)} className="ml-auto px-1.5 rounded border border-white/15 text-white/50 hover:text-white transition">Got it</button>
        </div>
      )}

      {showChain && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5 border-t border-white/[0.06]">
          <span
            className={`text-[9px] uppercase tracking-[0.18em] ${playMode === "song" ? "text-[#ffbfa0]" : "text-dim"}`}
            title="Sections play in this order. Drag to rearrange; click to edit."
          >Chain</span>
          {chain.length === 0 && (
            <span className="text-[10px] text-white/35 italic">empty — Song falls back to active section</span>
          )}
          {chain.map((id, i) => {
            const sec = sections.find((s) => s.id === id);
            const barsOf = sec?.bars ?? 1;
            const color = colorOf(id);
            const sounding = playingSlot === i;
            const isDropTarget = dropAt === i && dragFrom !== null && dragFrom !== i;
            return (
              <div
                key={`${id}-${i}`}
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropAt !== i) setDropAt(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null && dragFrom !== i) moveChainTo(dragFrom, i);
                  setDragFrom(null);
                  setDropAt(null);
                }}
                onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
                onClick={() => setActiveSection(id)}
                className={`group relative h-7 rounded-md border cursor-grab active:cursor-grabbing select-none overflow-hidden transition ${
                  isDropTarget ? "ring-2 ring-white/60" : ""
                } ${dragFrom === i ? "opacity-40" : ""}`}
                style={{
                  width: Math.max(40, barsOf * 24),
                  borderColor: sounding ? color : `${color}55`,
                  background: `linear-gradient(180deg, ${color}${sounding ? "38" : "1f"}, ${color}${sounding ? "22" : "10"})`,
                  boxShadow: sounding ? `0 0 14px ${color}66` : undefined,
                }}
                title={`${sec?.name ?? "?"} — ${barsOf} bar${barsOf === 1 ? "" : "s"}. Click to edit · drag to reorder`}
              >
                <span
                  className="absolute inset-0 flex items-center justify-center gap-1 text-[10px] font-bold"
                  style={{ color: sounding ? "#fff" : color }}
                >
                  {nameOf(id)}
                  <span className="font-mono font-normal opacity-55 text-[9px]">{barsOf}</span>
                </span>
                {barsOf > 1 && Array.from({ length: barsOf - 1 }, (_, b) => (
                  <span
                    key={b}
                    className="absolute top-0 bottom-0 w-px opacity-25"
                    style={{ left: `${((b + 1) / barsOf) * 100}%`, background: color }}
                  />
                ))}
                <button
                  onClick={(e) => { e.stopPropagation(); removeChainAt(i); }}
                  className="absolute top-0 right-0 hidden group-hover:flex items-center justify-center w-4 h-4 text-[9px] rounded-bl bg-black/60 text-white/60 hover:text-rose-300"
                  title="Remove from the chain"
                >✕</button>
              </div>
            );
          })}
          <button
            onClick={() => {
              if (chain.length >= MAX_CHAIN) { toast(`Max ${MAX_CHAIN} chain slots`); return; }
              appendToChain(activeSectionId);
            }}
            className="h-7 px-2 rounded-md text-[10px] border border-dashed border-white/20 text-white/50 hover:text-[#ffbfa0] hover:border-[#ff6a3d]/50 transition"
            title="Append the ACTIVE section to the end of the chain"
          >＋ {nameOf(activeSectionId)}</button>
        </div>
      )}
    </div>
  );
}

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

export function SequencerPanel() {
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

  const [tab, setTab] = useState<Tab>("roll");
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const toast = useUIStore((s) => s.toast);

  const doExportWav = async () => {
    if (exporting) return;
    if (noteCount === 0 && !drumsEnabled) {
      toast("Nothing to export — draw some notes or drums first");
      return;
    }
    setExporting("arming…");
    try {
      const path = await exportPatternWav(
        (p) => setExporting(`${p.stage} ${Math.round(p.fraction * 100)}%`),
        exportFormat,
      );
      toast(path ? `Exported → ${path.split(/[\\/]/).pop()}` : "Export cancelled");
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

  // Collapsed: a one-line strip that keeps the transport (play/stop, BPM,
  // channel arms) reachable without the editors taking any vertical space.
  if (collapsed) {
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
            title="Play / stop the pattern (sequencer)"
          >
            {playing ? "■ HOLD FIRE" : "▶ OPEN FIRE"}
          </button>

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
            className="h-8 px-2 rounded-lg text-xs font-mono border border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08] hover:text-cyan disabled:opacity-30 transition"
            title="Duplicate the pattern: double the bars and repeat everything — then vary the second half"
          >
            ⧉ ×2
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
          <button
            onClick={() => setCollapsed(true)}
            className="h-8 px-2.5 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 text-[11px] text-white/75 transition"
            title="Collapse the sequencer to a compact transport strip"
          >▲</button>
        </div>
      </div>

      <ArrangementStrip />

      {/* Editor chrome — left editor / center draw / right file */}
      <div className="mb-2.5 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {(() => {
            const idx = Math.max(0, sections.findIndex((s) => s.id === activeSectionId));
            const sec = sections[idx];
            const color = SECTION_COLORS[idx % SECTION_COLORS.length];
            return (
              <span
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-bold"
                style={{ borderColor: `${color}66`, background: `${color}12`, color }}
                title="Editors below edit this section"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                {sec?.name ?? "?"}
              </span>
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
                    title={ch === 0 ? "Draw Synth A (orange)" : "Draw Synth B (blue)"}
                  >
                    Draw {ch === 0 ? "A" : "B"}
                  </button>
                ))}
              </div>
              <select
                value={synthBPresetId}
                onChange={(e) => setSynthBPresetId(e.target.value)}
                className="max-w-[160px] h-8 rounded-lg border border-white/12 bg-black/40 px-2 text-[11px] text-white/85 outline-none focus:border-[#62b6ff]/60"
                title="Synth B voice preset"
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
          <div className="relative">
            <button
              onClick={() => setFileMenuOpen((v) => !v)}
              className={`h-8 px-3 rounded-lg text-[11px] font-semibold border transition ${
                fileMenuOpen || exporting
                  ? "border-cyan/50 bg-cyan/10 text-cyan"
                  : "border-white/10 text-white/55 hover:text-white/85 hover:border-white/25"
              }`}
              title="Open, save, export"
            >
              {exporting ?? "File ▾"}
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
                  <button
                    onClick={() => { setFileMenuOpen(false); void doSaveProject(); }}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-white/70 hover:bg-white/8 hover:text-white transition"
                  >Save project…</button>
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
                    onClick={() => { setFileMenuOpen(false); void doExportWav(); }}
                    disabled={!!exporting}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-cyan/90 hover:bg-cyan/10 transition disabled:opacity-40"
                  >{playMode === "song" ? "Export song…" : "Export…"}</button>
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
}
