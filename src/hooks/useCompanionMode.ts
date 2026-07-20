import { useEffect } from "react";
import { useSettingsStore } from "@/state/settingsStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { matchHeadphoneByDeviceName, HEADPHONES } from "@/audio/headphoneProfiles";

/**
 * When Companion Mode is enabled, every few seconds we ask the OS for the
 * active output device name. If the name matches a known headphone
 * profile, we activate that profile + enable correction. If it stops
 * matching (e.g. the user switched to laptop speakers), we disable the
 * correction so speakers don't get wrecked by a headphone EQ.
 *
 * Gracefully no-ops when window.playground.audioDevices isn't wired up
 * (non-Electron or older Electron build).
 */
export function useCompanionMode(): void {
  const enabled = useSettingsStore((s) => s.companionMode);

  useEffect(() => {
    if (!enabled) return;
    const api = window.playground?.audioDevices;
    if (!api) {
      console.warn(
        "[companion] window.playground.audioDevices not exposed - companion mode is a no-op",
      );
      return;
    }

    let lastName = "";
    let lastApplied: string | null = null;

    const poll = async () => {
      try {
        const name = (await api.getDefaultOutputName()) ?? "";
        if (name === lastName) return;
        lastName = name;
        const matched = matchHeadphoneByDeviceName(name);
        const audio = useAudioStore.getState();
        const settings = useSettingsStore.getState();

        if (matched) {
          if (matched !== lastApplied) {
            settings.set("headphone", matched);
            audio.setHeadphoneProfile(matched);
            audio.setCorrectionEnabled(true);
            useUIStore
              .getState()
              .toast(`Auto: ${HEADPHONES[matched].name} - correction ON`);
            lastApplied = matched;
          }
        } else {
          if (lastApplied !== null) {
            audio.setCorrectionEnabled(false);
            useUIStore
              .getState()
              .toast("Auto: unknown device - correction OFF");
            lastApplied = null;
          }
        }
      } catch (err) {
        console.warn("[companion] poll failed:", err);
      }
    };

    void poll();
    const id = window.setInterval(poll, 4000);
    return () => window.clearInterval(id);
  }, [enabled]);
}
