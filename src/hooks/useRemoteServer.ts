import { useEffect } from "react";
import { useSettingsStore } from "@/state/settingsStore";
import { useUIStore } from "@/state/uiStore";
import { useAudioStore } from "@/state/audioStore";
import { usePlayerStore } from "@/state/playerStore";
import { isBipolar, type SoundParams } from "@/audio/types";

const MACROS: Record<string, Partial<SoundParams>> = {
  warmer:    { warmth: 0.2, bass: 0.1, harmonics: 0.1, sparkle: -0.05 },
  cleaner:   { clarity: 0.15, air: 0.15, harmonics: -0.05, saturation: -0.05 },
  punchier:  { punch: 0.2, compression: 0.15, bass: 0.1 },
  wider:     { width: 0.2, spatial: 0.15, reverbAmount: 0.05 },
  bigger:    { subBass: 0.2, reverbSize: 0.1, spatial: 0.1 },
  tighter:   { subBass: -0.1, bass: -0.05, compression: 0.1, punch: 0.1 },
};

function clampValue(v: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function applyMacroNamed(name: string): void {
  const m = MACROS[name];
  if (!m) return;
  const audio = useAudioStore.getState();
  const cur = audio.params;
  const next: SoundParams = { ...cur };
  for (const [k, dv] of Object.entries(m) as [keyof SoundParams, number][]) {
    const lo = isBipolar(k) ? -1 : 0;
    next[k] = clampValue(next[k] + dv, lo, 1);
  }
  audio.replaceParams(next);
}

/**
 * Boot the Electron-hosted remote-control server when settings.remotePort
 * is non-zero, and route incoming commands from the mobile PWA to the
 * appropriate stores.
 */
export function useRemoteServer(): void {
  const port = useSettingsStore((s) => s.remotePort);

  useEffect(() => {
    const api = window.playground?.remote;
    if (!api) return;
    (async () => {
      if (port > 0) {
        const res = await api.start(port);
        if (res) {
          useUIStore.getState().toast(`Remote @ ${res.url}`);
        } else {
          useUIStore.getState().toast("Remote failed to start");
        }
      } else {
        await api.stop();
      }
    })();
  }, [port]);

  useEffect(() => {
    const api = window.playground?.remote;
    if (!api?.onCommand) return;
    const off = api.onCommand((cmd) => {
      const ui = useUIStore.getState();
      const audio = useAudioStore.getState();
      const player = usePlayerStore.getState();
      switch (cmd) {
        case "play-pause":
          void player.toggle();
          break;
        case "next":
          void player.next();
          break;
        case "prev":
          void player.previous();
          break;
        case "snapshot-a":
          audio.storeAB();
          ui.toast("Snapshotted A (remote)");
          break;
        case "swap-ab":
          if (audio.abSnapshot) {
            audio.swapAB();
            ui.toast("Swapped A/B (remote)");
          } else {
            ui.toast("No A snapshot yet");
          }
          break;
        case "reset":
          audio.resetToNeutral();
          ui.toast("Reset (remote)");
          break;
        case "correction-toggle":
          audio.toggleCorrection();
          ui.toast(audio.correctionEnabled ? "Correction OFF" : "Correction ON");
          break;
        case "bypass-toggle":
          audio.toggleBypass();
          ui.toast(audio.bypass ? "FX bypass ON" : "FX bypass OFF");
          break;
        default:
          if (MACROS[cmd]) {
            applyMacroNamed(cmd);
            ui.toast(`Pushed ${cmd} (remote)`);
          }
      }
    });
    return off;
  }, []);
}
