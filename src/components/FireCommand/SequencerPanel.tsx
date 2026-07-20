/**
 * SequencerPanel — the Fire Command "war room": transport + piano roll +
 * drum grid, FL-Studio style. Lives at the top of the synth view.
 */

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { PianoRoll } from "./PianoRoll";
import { DrumMachine } from "./DrumMachine";
import { useFireSequencerStore, MAX_BARS } from "@/state/fireSequencerStore";
import { FIRE_PRESETS, PRESET_CATEGORIES } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";
import { exportPatternWav, saveProject, openProject } from "@/lib/fireStudio";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";

type Tab = "roll" | "drums";

export function SequencerPanel() {
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const swing = useFireSequencerStore((s) => s.swing);
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
  const setSwing = useFireSequencerStore((s) => s.setSwing);
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

  const [tab, setTab] = useState<Tab>("roll");
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const toast = useUIStore((s) => s.toast);

  const doExportWav = async () => {
    if (exporting) return;
    if (noteCount === 0 && !drumsEnabled) {
      toast("Nothing to export — draw some notes or drums first");
      return;
    }
    setExporting("arming…");
    try {
      const path = await exportPatternWav((p) =>
        setExporting(`${p.stage} ${Math.round(p.fraction * 100)}%`),
      );
      toast(path ? `Exported → ${path.split(/[\\/]/).pop()}` : "Export cancelled");
    } catch {
      toast("Export failed");
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
    <GlassPanel intense className="p-3">
      {/* transport row */}
      <div className="flex flex-wrap items-center gap-2.5 mb-2.5">
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

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.22em] text-dim">BPM</span>
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value) || 128)}
            className="w-[62px] rounded-lg border border-white/12 bg-black/35 px-2 py-1.5 text-sm font-mono text-white text-center outline-none focus:border-[#ff6a3d]/60"
          />
        </div>

        <div className="flex items-center gap-1.5" title="Delays every off-beat 16th for groove">
          <span className="text-[10px] uppercase tracking-[0.22em] text-dim">Swing</span>
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

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.22em] text-dim">Bars</span>
          {[1, 2, 4, MAX_BARS].map((b) => (
            <button
              key={b}
              onClick={() => setBars(b)}
              className={`w-8 h-7 rounded-lg text-xs font-mono border transition ${
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
            className="h-7 px-2 rounded-lg text-xs font-mono border border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.08] hover:text-cyan disabled:opacity-30 transition"
            title="Duplicate the pattern: double the bars and repeat everything — then vary the second half"
          >
            ⧉ ×2
          </button>
        </div>

        <div className="flex-1" />

        {/* channel arm toggles */}
        <button
          onClick={() => setSynthEnabled(!synthEnabled)}
          className={`h-8 px-3 rounded-lg text-xs font-semibold border transition ${
            synthEnabled
              ? "border-[#ff6a3d]/60 bg-[#ff6a3d]/12 text-[#ffbfa0]"
              : "border-white/10 bg-white/[0.03] text-white/40"
          }`}
          title="Arm / mute the Synth A channel (the playable synth below)"
        >
          {synthEnabled ? "● SYNTH A" : "○ SYNTH A"}
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
          {synthBEnabled ? "● SYNTH B" : "○ SYNTH B"}
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
          {drumsEnabled ? "● DRUMS" : "○ DRUMS"}
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
        >▲ Collapse</button>
      </div>

      {/* editor tabs */}
      <div className="flex items-center gap-1.5 mb-2">
        <button
          onClick={() => setTab("roll")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            tab === "roll"
              ? "border-[#ff6a3d]/60 bg-[#ff6a3d]/12 text-[#ffbfa0]"
              : "border-white/8 bg-white/[0.02] text-white/50 hover:bg-white/[0.06]"
          }`}
        >
          ♪ Piano Roll <span className="opacity-60 font-mono">{noteCount}</span>
        </button>
        <button
          onClick={() => setTab("drums")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            tab === "drums"
              ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]"
              : "border-white/8 bg-white/[0.02] text-white/50 hover:bg-white/[0.06]"
          }`}
        >
          ▦ Drum Grid
        </button>

        {tab === "roll" && (
          <>
            <div className="w-px h-6 bg-white/10 mx-1" />
            {/* Which instrument new notes are drawn into (issue #11) */}
            <span className="text-[10px] uppercase tracking-[0.2em] text-dim">Draw</span>
            <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
              {([0, 1] as const).map((ch) => (
                <button
                  key={ch}
                  onClick={() => setActiveChannel(ch)}
                  className="px-2.5 py-1 text-[11px] font-bold rounded-md transition"
                  style={
                    activeChannel === ch
                      ? { background: "rgba(255,255,255,0.1)", color: ch === 0 ? FIRE : ICE }
                      : { color: "rgba(255,255,255,0.4)" }
                  }
                  title={ch === 0 ? "Draw notes for Synth A (orange)" : "Draw notes for Synth B (blue)"}
                >
                  {ch === 0 ? "A" : "B"}
                </button>
              ))}
            </div>
            {/* Synth B voice — any preset from the armory */}
            <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-dim">
              <span style={{ color: synthBEnabled ? ICE : undefined }}>B voice</span>
              <select
                value={synthBPresetId}
                onChange={(e) => setSynthBPresetId(e.target.value)}
                className="max-w-[150px] rounded-lg border border-white/12 bg-black/40 px-2 py-1 text-[11px] normal-case tracking-normal text-white/85 outline-none focus:border-[#62b6ff]/60"
                title="The preset voicing Synth B — its own oscillators, filter and FX"
              >
                {presetGroups.map((g) => (
                  <optgroup key={g.cat} label={g.cat}>
                    {g.items.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </>
        )}

        <div className="flex-1" />
        {/* Studio I/O: project save/open + WAV export */}
        <button
          onClick={() => void doOpenProject()}
          className="px-2.5 py-1 rounded-lg text-[11px] border border-white/8 text-white/50 hover:text-white/90 hover:border-white/25 transition"
          title="Open a .kcproj project — patch, pattern, drums, samples"
        >
          ⌸ Open
        </button>
        <button
          onClick={() => void doSaveProject()}
          className="px-2.5 py-1 rounded-lg text-[11px] border border-white/8 text-white/50 hover:text-white/90 hover:border-white/25 transition"
          title="Save everything (patch + pattern + samples) as a .kcproj project file"
        >
          ⛃ Save
        </button>
        <button
          onClick={() => void doExportWav()}
          disabled={!!exporting}
          className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${
            exporting
              ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
              : "border-cyan/40 bg-cyan/8 text-cyan hover:bg-cyan/15"
          }`}
          title="Record one pattern pass to a .wav file (clean synth+drums, no chain FX)"
        >
          {exporting ?? "⬇ Export WAV"}
        </button>
        <div className="w-px h-5 bg-white/10" />
        <button
          onClick={doClear}
          className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${
            confirmClear
              ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
              : "border-white/8 text-white/40 hover:text-rose-300 hover:border-rose-400/40"
          }`}
        >
          {confirmClear ? "CONFIRM PURGE" : `Clear ${tab === "roll" ? "notes" : "drums"}`}
        </button>
      </div>

      {tab === "roll" ? (
        <>
          <PianoRoll />
          <div className="mt-2 text-[10px] text-dim">
            Click to draw · drag to move · drag right edge to resize · hold right-click to erase ·
            Shift+drag sets velocity · Ctrl+wheel zooms · piano keys audition ·{" "}
            <span style={{ color: FIRE }}>orange</span> notes fire Synth A,{" "}
            <span style={{ color: ICE }}>blue</span> notes fire Synth B
          </div>
        </>
      ) : (
        <div className="overflow-x-auto pb-1">
          <DrumMachine />
        </div>
      )}
    </GlassPanel>
  );
}
