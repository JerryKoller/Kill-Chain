import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/state/settingsStore";
import { useAudioStore } from "@/state/audioStore";
import { usePlayerStore } from "@/state/playerStore";
import { getEngine } from "@/audio/AudioEngine";

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * When a LUFS target is set, periodically measure the short-term
 * loudness and trim outputGainDb so it converges on the target. Trim is
 * slew-rate limited to +/- 0.5 dB per check (every 4 seconds) so it
 * doesn't pump audibly while a song builds up.
 */
export function useLufsNormalize(): void {
  const target = useSettingsStore((s) => s.lufsTargetDb);
  const trackIdx = usePlayerStore((s) => s.currentIndex);
  // Anchor the gain trim to whatever the user explicitly set; we apply
  // adjustments on top, never below -18 dB / above +6 dB.
  const anchorRef = useRef<number | null>(null);
  // The last value THIS hook wrote — lets us tell auto-trim writes apart
  // from the user grabbing the fader.
  const lastAutoWriteRef = useRef<number | null>(null);

  useEffect(() => {
    anchorRef.current = useAudioStore.getState().outputGainDb;
    lastAutoWriteRef.current = null;
  }, [trackIdx]);

  useEffect(() => {
    if (target === null) return;
    getEngine().ensureLufsMeter();
    const id = window.setInterval(() => {
      const eng = getEngine();
      const stl = eng.lufs.shortTermLufs;
      if (stl < -70) return; // signal too quiet to measure reliably
      const cur = useAudioStore.getState().outputGainDb;
      // The user moved the fader since our last write → treat their new
      // level as the anchor instead of slowly dragging it back (the old
      // behavior read as "the volume knob fights me").
      if (
        lastAutoWriteRef.current !== null &&
        Math.abs(cur - lastAutoWriteRef.current) > 0.25
      ) {
        anchorRef.current = cur;
      }
      const anchor = anchorRef.current ?? cur;
      const err = target - stl;
      // Deadband: within ±0.75 dB of target, leave the gain alone — chasing
      // every short-term wiggle just pumps on dynamic material.
      if (Math.abs(err) < 0.75) return;
      // Move 30% of the way each cycle, clamped to +/- 0.5 dB per step.
      const step = Math.max(-0.5, Math.min(0.5, err * 0.3));
      let next = cur + step;
      next = Math.max(anchor - 18, Math.min(anchor + 6, next));
      if (Math.abs(next - cur) > 0.05) {
        useAudioStore.getState().setOutputGain(next);
        lastAutoWriteRef.current = useAudioStore.getState().outputGainDb;
      }
    }, 4000);
    return () => {
      window.clearInterval(id);
      getEngine().releaseLufsMeter();
    };
  }, [target]);
}
