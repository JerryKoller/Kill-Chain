import { useEffect } from "react";
import { useSettingsStore } from "@/state/settingsStore";
import { useUIStore } from "@/state/uiStore";
import { getEngine } from "@/audio/AudioEngine";

/**
 * Output-device disconnect handling (v1.5). When the app is routed to a
 * specific output sink (Settings → Audio Output Device) and that device
 * vanishes (Bluetooth dies, USB DAC unplugged), Chromium keeps "playing"
 * into a dead sink and the app just goes silent. This watcher detects the
 * disappearance, falls back to the system default, and tells the user.
 */
export function useDeviceWatch(): void {
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let disposed = false;
    let checking = false;

    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const wantedId = useSettingsStore.getState().audioOutputDeviceId;
        if (!wantedId) return; // already on system default — nothing to lose
        const devices = await navigator.mediaDevices.enumerateDevices();
        const stillThere = devices.some(
          (d) => d.kind === "audiooutput" && d.deviceId === wantedId,
        );
        if (stillThere || disposed) return;
        // Device is gone → revert to default so audio keeps flowing.
        useSettingsStore.getState().set("audioOutputDeviceId", "");
        const ok = await getEngine().setOutputDevice("");
        useUIStore
          .getState()
          .toast(
            ok
              ? "Output device lost — reverted to system default"
              : "Output device lost — pick a new output in Settings",
          );
        // v2.4: also raise an actionable Mission HUD issue.
        void import("@/lib/appHealth").then(({ reportDeviceLost }) =>
          reportDeviceLost(ok),
        );
      } catch {
        /* enumeration can fail transiently; next devicechange retries */
      } finally {
        checking = false;
      }
    };

    const onChange = () => void check();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => {
      disposed = true;
      navigator.mediaDevices.removeEventListener("devicechange", onChange);
    };
  }, []);
}
