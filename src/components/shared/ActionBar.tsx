import { useState } from "react";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { useUserPresetsStore } from "@/state/userPresetsStore";
import { useCalibrationStore } from "@/state/calibrationStore";
import { useEqStore } from "@/state/eqStore";
import { playUi } from "@/audio/uiSounds";

/**
 * Sticky toolbar that appears at the top of any major view. Centralises
 * the "save everything" / "clear everything" actions so they're always
 * one click away regardless of which tab the user is in.
 */
export function ActionBar({
  title,
  subtitle,
  code,
  showActions = true,
}: {
  title: string;
  subtitle?: string;
  /** Classification-style module tag rendered before the title, e.g. "KC-01". */
  code?: string;
  /** Hide the EQ-tuning Save/Clear on views (like the synth) where they'd
   *  act on a different thing than what the user is looking at. */
  showActions?: boolean;
}) {
  const params = useAudioStore((s) => s.params);
  const resetToNeutral = useAudioStore((s) => s.resetToNeutral);
  const clearAB = useAudioStore((s) => s.clearAB);
  const correctionEnabled = useAudioStore((s) => s.correctionEnabled);
  const savePreset = useUserPresetsStore((s) => s.savePreset);
  const toast = useUIStore((s) => s.toast);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const doSave = () => {
    const name = saveName.trim() || "Untitled tuning";
    savePreset(name, params);
    playUi("success");
    setSaveOpen(false);
    setSaveName("");
    toast(`Saved "${name}"`);
  };

  const doReset = () => {
    playUi("purge");
    resetToNeutral();
    clearAB();
    // resetToNeutral() restores flat passthrough (bypass ON, correction OFF)
    // so playback matches the raw source again.
    // CRITICAL: also reset the in-flight calibration profile. Otherwise
    // the moment the Calibration tab mounts (or its preview effect fires)
    // it shoves the previously-tweaked profile back into the engine and
    // overrides this "clear" — making it feel like Clear All did nothing
    // for the sound signature.
    useCalibrationStore.getState().reset();
    // Also flatten the user graphic EQ so Clear All truly clears everything.
    useEqStore.getState().reset();
    setConfirmReset(false);
    toast("All parameters purged — chain reset to neutral");
  };

  return (
    <div className="sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-ink/85 backdrop-blur-md border-b border-white/[0.05]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-dim">
            {code && <span className="module-tag">{code}</span>}
            <span>{title}</span>
          </div>
          {subtitle && (
            <div className="text-sm text-white/70 truncate">{subtitle}</div>
          )}
        </div>
        {showActions && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { playUi(saveOpen ? "modal-close" : "modal-open"); setSaveOpen((v) => !v); }}
            data-ui-sound="none"
            className="rounded-xl border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-4 py-2 text-sm font-semibold text-cyan transition whitespace-nowrap"
          >
            ⊕ Save Preset
          </button>
          <button
            onClick={() => {
              if (confirmReset) doReset();
              else {
                playUi("press"); // arming tap — the confirm tap lands the purge thunk
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 2400);
              }
            }}
            data-ui-sound="none"
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition whitespace-nowrap ${
              confirmReset
                ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
                : "border-rose-400/30 bg-rose-500/5 text-rose-200/80 hover:bg-rose-500/10"
            }`}
            title="Resets every slider, snapshot, and re-enables XM6 correction"
          >
            {confirmReset ? "CONFIRM PURGE" : "✕ Purge All"}
          </button>
        </div>
        )}
      </div>
      {saveOpen && (
        <div className="mt-3 rounded-xl border border-cyan/30 bg-cyan/5 p-3 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSave();
              if (e.key === "Escape") setSaveOpen(false);
            }}
            placeholder="Name this tuning (saves ALL current sliders & toggles)…"
            maxLength={60}
            className="flex-1 min-w-[260px] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
          />
          <button
            onClick={doSave}
            data-ui-sound="none"
            className="rounded-lg bg-cyan/20 hover:bg-cyan/30 border border-cyan/50 px-4 py-2 text-sm font-semibold text-cyan transition"
          >
            Save
          </button>
          <button
            onClick={() => { playUi("modal-close"); setSaveOpen(false); setSaveName(""); }}
            data-ui-sound="none"
            className="rounded-lg border border-white/10 hover:border-white/25 hover:bg-white/5 px-3 py-2 text-sm text-white/70 transition"
          >
            Cancel
          </button>
          <div className="text-[10px] text-dim w-full">
            Correction layer: {correctionEnabled ? "ON (XM6)" : "OFF (raw)"} — toggle in Sculptor.
          </div>
        </div>
      )}
    </div>
  );
}
