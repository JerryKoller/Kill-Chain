/**
 * Slim transport for the Synth workspace — hear the song while tweaking the patch.
 */

import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { writeFireWorkspace } from "./useFireWorkspace";
import { scrollFireCommandTop } from "./fireNavigate";

export function FireMiniTransport() {
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const bars = useFireSequencerStore((s) => s.bars);
  const noteCount = useFireSequencerStore((s) => s.notes.length);
  const synthEnabled = useFireSequencerStore((s) => s.synthEnabled);
  const synthBEnabled = useFireSequencerStore((s) => s.synthBEnabled);
  const drumsEnabled = useFireSequencerStore((s) => s.drumsEnabled);
  const togglePlay = useFireSequencerStore((s) => s.togglePlay);
  const setSynthEnabled = useFireSequencerStore((s) => s.setSynthEnabled);
  const setSynthBEnabled = useFireSequencerStore((s) => s.setSynthBEnabled);
  const setDrumsEnabled = useFireSequencerStore((s) => s.setDrumsEnabled);
  const setCollapsed = useFireSequencerStore((s) => s.setCollapsed);

  const openSequencer = () => {
    setCollapsed(false);
    writeFireWorkspace("sequencer");
    scrollFireCommandTop("smooth");
  };

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          className={`h-8 px-4 rounded-lg font-bold text-xs tracking-wide border transition ${
            playing
              ? "border-[#ff6a3d] bg-[#ff6a3d]/25 text-[#ffd9c9] shadow-[0_0_18px_rgb(255_106_61/0.4)]"
              : "border-[#ff6a3d]/50 bg-[#ff6a3d]/10 text-[#ffbfa0] hover:bg-[#ff6a3d]/20"
          }`}
          title="Play / stop the sequencer"
        >
          {playing ? "■ HOLD FIRE" : "▶ OPEN FIRE"}
        </button>
        <span className="text-[10px] uppercase tracking-[0.22em] text-dim">Transport</span>
        <span className="text-[11px] font-mono text-white/55">
          {bpm} BPM · {bars} bar{bars === 1 ? "" : "s"} · {noteCount} notes
        </span>
        <button
          type="button"
          onClick={() => setSynthEnabled(!synthEnabled)}
          className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
            synthEnabled ? "border-[#ff6a3d]/60 bg-[#ff6a3d]/12 text-[#ffbfa0]" : "border-white/10 bg-white/[0.03] text-white/40"
          }`}
          title="Arm / mute Synth A"
        >
          {synthEnabled ? "● A" : "○ A"}
        </button>
        <button
          type="button"
          onClick={() => setSynthBEnabled(!synthBEnabled)}
          className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
            synthBEnabled ? "border-[#62b6ff]/60 bg-[#62b6ff]/12 text-[#b8dcff]" : "border-white/10 bg-white/[0.03] text-white/40"
          }`}
          title="Arm / mute Synth B"
        >
          {synthBEnabled ? "● B" : "○ B"}
        </button>
        <button
          type="button"
          onClick={() => setDrumsEnabled(!drumsEnabled)}
          className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
            drumsEnabled ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]" : "border-white/10 bg-white/[0.03] text-white/40"
          }`}
          title="Arm / mute drums"
        >
          {drumsEnabled ? "● DRM" : "○ DRM"}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openSequencer}
          className="h-7 px-2.5 rounded-lg border border-[#62b6ff]/35 bg-[#62b6ff]/10 hover:bg-[#62b6ff]/18 text-[11px] font-semibold text-[#b8dcff] transition"
          title="Open Sequencer workspace"
        >
          Sequencer →
        </button>
      </div>
    </div>
  );
}
