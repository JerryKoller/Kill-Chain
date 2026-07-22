import { useEffect } from "react";
import { useUIStore } from "@/state/uiStore";
import { useAudioStore } from "@/state/audioStore";
import { useSettingsStore } from "@/state/settingsStore";
import { usePlayerStore, type PlayerStatus } from "@/state/playerStore";
import { useAirspaceStore } from "@/state/airspaceStore";
import { useDimensionStore } from "@/state/dimensionStore";
import { actionForKey, useHotkeyStore, type HotkeyActionId } from "@/state/hotkeyStore";
import type { AirspaceMediaSnapshot } from "@/lib/airspaceMedia";

/** Keys owned by 3rd Dimension Walk Mode while it is engaged. */
const WALK_KEYS = new Set(["w", "a", "s", "d", "r", "f"]);

/** The Airspace media snapshot IF the transport deck is currently showing it
 *  (mirrors TransportBar's deck rule). Null → local player owns the keys. */
function airspaceDeckMedia(status: PlayerStatus): AirspaceMediaSnapshot | null {
  const media = useAirspaceStore.getState().media;
  if (!media) return null;
  const loopbackMode = usePlayerStore.getState().loopbackMode;
  const deck =
    loopbackMode === "airspace" ||
    (status !== "playing" && (status === "empty" || !media.paused));
  return deck ? media : null;
}

/**
 * Cheat-sheet entries for the "?" overlay. Command keys come from the
 * remappable hotkey store (Settings → Hotkeys); structural keys are fixed.
 */
export function getHotkeyCheatSheet(
  bindings: Record<HotkeyActionId, string>,
): { keys: string[]; label: string }[] {
  const K = (id: HotkeyActionId) => bindings[id].toUpperCase();
  return [
    { keys: ["?"], label: "Open this cheat sheet" },
    { keys: ["Space"], label: "Play / pause" },
    { keys: ["Left", "Right"], label: "Seek -/+ 5 seconds" },
    { keys: ["Shift+Left", "Shift+Right"], label: "Seek -/+ 30 seconds" },
    { keys: [K("nextTrack"), K("prevTrack")], label: "Next / previous track in queue" },
    { keys: [K("loop")], label: "Toggle loop" },
    { keys: [K("mute")], label: "Toggle mute" },
    { keys: ["1"], label: "Go to Sculptor" },
    { keys: ["2"], label: "Go to Tractor Beam" },
    { keys: ["3"], label: "Go to Calibration" },
    { keys: ["4"], label: "Go to Presets" },
    { keys: ["5"], label: "Go to Scope" },
    { keys: ["6"], label: "Go to Library" },
    { keys: ["7"], label: "Go to Morph Lab" },
    { keys: ["8"], label: "Go to 3rd Dimension" },
    { keys: ["9"], label: "Go to Fire Command" },
    { keys: ["0"], label: "Go to Settings" },
    { keys: [K("snapshotA")], label: "Snapshot A (full chain)" },
    { keys: [K("swapAB")], label: "Swap A <-> B (loudness-matched)" },
    { keys: [K("clearAB")], label: "Clear A snapshot" },
    { keys: [K("correction")], label: "Toggle XM6 / headphone correction" },
    { keys: [K("bypass")], label: "Toggle full-effect bypass" },
    { keys: [K("savePreset")], label: "Save current tuning as preset" },
    { keys: [`Shift+${K("savePreset")}`], label: "Quick-save session snapshot (full chain)" },
    { keys: [K("undo")], label: "Undo last tweak" },
    { keys: [`Shift+${K("undo")}`], label: "Redo" },
    { keys: [K("miniMode")], label: "Toggle mini-player mode" },
  ];
}

export function useGlobalHotkeys(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Never hijack OS-level shortcuts (Ctrl+C, Ctrl+S, Alt+Tab remnants…).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.tagName === "SELECT" ||
          tgt.isContentEditable ||
          // Focused knobs/sliders own the arrow keys for value nudging.
          tgt.getAttribute?.("role") === "slider")
      ) {
        return;
      }

      const ui = useUIStore.getState();
      const audio = useAudioStore.getState();
      const settings = useSettingsStore.getState();
      const player = usePlayerStore.getState();

      // While Fire Command is open, the QWERTY keys are the instrument — let
      // them play notes instead of firing app shortcuts. (The "?" cheat sheet
      // still works.)
      if (ui.view === "fire" && e.key !== "?") return;

      // While Walk Mode is engaged in the 3rd Dimension view, W/A/S/D/R/F
      // belong to the legs — don't fire command hotkeys (mini-player,
      // snapshot, save-preset, bypass…) off the same keys.
      if (ui.view === "dimension" && WALK_KEYS.has(e.key.toLowerCase())) {
        if (useDimensionStore.getState().walkMode) return;
      }

      const isShift = e.shiftKey;
      const key = e.key;

      if (key === "?") {
        e.preventDefault();
        ui.toggleHotkeyOverlay();
        return;
      }
      // While the transport is in Airspace-deck mode, Space and seek keys
      // drive the media playing in the browser — same keys, same muscle
      // memory, whichever deck is live.
      const airMedia = airspaceDeckMedia(player.status);
      if (key === " " || key === "Spacebar") {
        e.preventDefault();
        if (airMedia) {
          void import("@/lib/airspaceMedia").then((m) => void m.toggleAirspaceMedia());
        } else if (player.status === "playing") {
          player.pause();
        } else {
          void player.play();
        }
        return;
      }
      if (key === "ArrowLeft") {
        e.preventDefault();
        const delta = isShift ? -30 : -5;
        if (airMedia) {
          void import("@/lib/airspaceMedia").then((m) =>
            m.seekAirspaceMedia(Math.max(0, airMedia.currentTime + delta)),
          );
        } else {
          player.seek(Math.max(0, (player.currentTime ?? 0) + delta));
        }
        return;
      }
      if (key === "ArrowRight") {
        e.preventDefault();
        const delta = isShift ? 30 : 5;
        if (airMedia) {
          void import("@/lib/airspaceMedia").then((m) =>
            m.seekAirspaceMedia(airMedia.currentTime + delta),
          );
        } else {
          player.seek((player.currentTime ?? 0) + delta);
        }
        return;
      }
      // Fixed view-switching digits.
      switch (key) {
        case "1":
          ui.setView("playground");
          return;
        case "2":
          ui.setView("tractor");
          return;
        case "3":
          ui.setView("calibration");
          return;
        case "4":
          ui.setView("presets");
          return;
        case "5":
          ui.setView("scope");
          return;
        case "6":
          ui.setView("library");
          return;
        case "7":
          ui.setView("morphlab");
          return;
        case "8":
          ui.setView("dimension");
          return;
        case "9":
          ui.setView("fire");
          return;
        case "0":
          ui.setView("settings");
          return;
      }

      // Remappable command keys (Settings → Hotkeys).
      const action = actionForKey(key);
      if (!action) return;
      switch (action) {
        case "undo":
          e.preventDefault();
          if (isShift) audio.redo();
          else audio.undo();
          return;
        case "nextTrack":
          player.next();
          return;
        case "prevTrack":
          player.previous();
          return;
        case "loop":
          player.toggleLoop();
          return;
        case "mute":
          player.setMuted(!player.muted);
          return;
        case "snapshotA":
          audio.storeAB();
          ui.toast("Snapshot A locked (full chain)");
          return;
        case "swapAB":
          if (audio.abSnapshot) {
            audio.swapAB();
            ui.toast("Swapped A <-> B (level-matched)");
          } else {
            ui.toast(`Snapshot A first (press ${useHotkeyStore.getState().bindings.snapshotA.toUpperCase()})`);
          }
          return;
        case "clearAB":
          audio.clearAB();
          ui.toast("Snapshot A released");
          return;
        case "correction":
          audio.toggleCorrection();
          ui.toast(
            audio.correctionEnabled
              ? "Correction OFF (raw)"
              : "Correction ON",
          );
          return;
        case "bypass":
          audio.toggleBypass();
          ui.toast(audio.bypass ? "FX bypass ON" : "FX bypass OFF");
          return;
        case "savePreset": {
          if (isShift) {
            // Shift — quick-save the FULL chain as a session snapshot.
            import("@/state/sessionSnapshotsStore").then(({ useSessionSnapshotsStore }) => {
              const name = useSessionSnapshotsStore.getState().saveSnapshot();
              ui.toast(`⧉ Snapshot saved — "${name}"`);
            });
            return;
          }
          // window.prompt is unsupported in Electron, so save immediately
          // with a timestamped name — rename later from the Presets view.
          const name = `Tuning ${new Date().toLocaleTimeString()}`;
          import("@/state/userPresetsStore").then(({ useUserPresetsStore }) => {
            useUserPresetsStore.getState().savePreset(name, audio.params);
            ui.toast(`Saved "${name}"`);
          });
          return;
        }
        case "miniMode":
          settings.set("miniMode", !settings.miniMode);
          return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
