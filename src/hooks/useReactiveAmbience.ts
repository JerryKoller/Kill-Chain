import { useEffect } from "react";
import { getEngine } from "@/audio/AudioEngine";
import { usePlayerStore } from "@/state/playerStore";

/**
 * Drives CSS custom properties from live audio so the app chrome
 * breathes with the music — subtle, not distracting.
 *
 *   --beat-glow   0..1  → sidebar / orb intensity
 *   --beat-pulse  0..1  → momentary transient hit
 */
export function useReactiveAmbience(): void {
  const playing = usePlayerStore((s) => s.status === "playing");

  useEffect(() => {
    if (!playing) {
      document.documentElement.style.setProperty("--beat-glow", "0");
      document.documentElement.style.setProperty("--beat-pulse", "0");
      return;
    }
    let raf = 0;
    let prevRms = 0;
    let pulseDecay = 0;
    let lastGlow = -1;
    let lastPulse = -1;
    let lastTick = 0;
    const root = document.documentElement.style;

    // ~30 fps is plenty for ambient glow and halves the per-frame cost vs.
    // running at the display refresh rate.
    const MIN_INTERVAL = 33;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - lastTick < MIN_INTERVAL) return;
      lastTick = now;

      try {
        const engine = getEngine();
        // Skip all work while the context isn't actually producing audio.
        if (engine.ctx.state !== "running") {
          if (lastGlow !== 0) {
            root.setProperty("--beat-glow", "0");
            root.setProperty("--beat-pulse", "0");
            lastGlow = 0;
            lastPulse = 0;
          }
          return;
        }

        const inRms = engine.getInputRms();
        const outRms = engine.getOutputRms();
        const rms = Math.max(inRms, outRms);

        const glow = Math.min(1, Math.pow(rms / 0.25, 0.7));
        const jump = Math.max(0, rms - prevRms);
        if (jump > 0.04) pulseDecay = Math.min(1, jump * 8);
        pulseDecay *= 0.92;
        prevRms = rms * 0.85 + prevRms * 0.15;

        // Only touch the DOM when the value meaningfully changed — avoids
        // pointless style invalidation when the signal is steady or silent.
        if (Math.abs(glow - lastGlow) > 0.004) {
          root.setProperty("--beat-glow", glow.toFixed(3));
          lastGlow = glow;
        }
        if (Math.abs(pulseDecay - lastPulse) > 0.004) {
          root.setProperty("--beat-pulse", pulseDecay.toFixed(3));
          lastPulse = pulseDecay;
        }
      } catch {
        /* engine not ready */
      }
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      root.removeProperty("--beat-glow");
      root.removeProperty("--beat-pulse");
    };
  }, [playing]);
}
