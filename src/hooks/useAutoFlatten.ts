import { useEffect } from "react";
import { usePlayerStore } from "@/state/playerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { autoFlatten } from "@/audio/AutoFlatten";

/**
 * If the "Auto-flatten new tracks" preference is on, fire the
 * auto-flatten analyser every time the currentIndex changes (i.e. a new
 * track is queued up). Triggers ~2 seconds after the new track starts to
 * let it stabilize, runs over the next 8 seconds.
 */
export function useAutoFlatten(): void {
  const idx = usePlayerStore((s) => s.currentIndex);
  const status = usePlayerStore((s) => s.status);
  const enabled = useSettingsStore((s) => s.autoFlatten);

  useEffect(() => {
    if (!enabled || status !== "playing" || idx < 0) return;
    const t = window.setTimeout(() => {
      void autoFlatten();
    }, 2000);
    return () => window.clearTimeout(t);
  }, [idx, status, enabled]);
}
