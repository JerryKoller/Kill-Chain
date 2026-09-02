import { useEffect, useState } from "react";
import type { View } from "@/state/uiStore";
import { usePlayerStore } from "@/state/playerStore";
import { useAudioStore } from "@/state/audioStore";
import { useReactorStore } from "@/state/reactorStore";
import { useDimensionStore } from "@/state/dimensionStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { useAirspaceStore } from "@/state/airspaceStore";
import { peekEngine } from "@/audio/AudioEngine";
import { paramsAreNeutral } from "@/audio/types";
import { restoreActive } from "@/audio/dsp/Reconstructor";
import { eqIsActive, useEqStore } from "@/state/eqStore";

/**
 * Which sub-apps are currently GENERATING sound and which are MODULATING the
 * output (issue #5). Drives the little activity dots on the sidebar tabs so
 * you always know where sound is coming from — and what's shaping it — no
 * matter which view you're in.
 *
 *   "gen" → this tab is producing audio right now (pulses with the signal)
 *   "mod" → this tab is actively transforming the current output
 */
export type TabActivity = "gen" | "mod" | null;

const IDLE: Partial<Record<View, TabActivity>> = {};

export function useTabActivity(): Partial<Record<View, TabActivity>> {
  const [activity, setActivity] = useState<Partial<Record<View, TabActivity>>>(IDLE);

  useEffect(() => {
    const compute = (): Partial<Record<View, TabActivity>> => {
      const out: Partial<Record<View, TabActivity>> = {};
      const player = usePlayerStore.getState();
      const audio = useAudioStore.getState();

      // ── Generators ──
      if (player.status === "playing" && !player.loopbackActive) out.library = "gen";
      const air = useAirspaceStore.getState().media;
      if (
        (player.loopbackActive && player.loopbackMode === "airspace") ||
        (air != null && !air.paused)
      ) {
        out.airspace = "gen";
      }

      const engine = peekEngine();
      let synthVoices = 0;
      if (engine) {
        try {
          synthVoices = engine.fireCommand.getActiveVoiceCount();
          const b = engine.peekFireCommandB();
          if (b) synthVoices += b.getActiveVoiceCount();
        } catch { /* engine mid-teardown */ }
      }
      if (synthVoices > 0 || useFireSequencerStore.getState().playing) out.fire = "gen";

      // ── Modulators ──
      const engaged = !audio.bypass;
      if (engaged) {
        // Tone/dynamics/space/lo-fi/pro knobs live in params. Restoration,
        // Clarity, and the parametric EQ are separate stores — and the
        // repair-stack A/B mute those three without touching the rest.
        const repairLive =
          !audio.repairBypass &&
          (audio.clarity > 0.001 ||
            restoreActive(audio.restore) ||
            eqIsActive(useEqStore.getState().bands));
        const proLive =
          (audio.room !== "off" && audio.roomMix > 0.001) ||
          Math.abs(audio.balanceLDb) > 0.05 ||
          Math.abs(audio.balanceRDb) > 0.05 ||
          Math.abs(audio.balanceDelayMs) > 0.02;
        if (!paramsAreNeutral(audio.params) || repairLive || proLive) {
          out.playground = "mod";
        }
      }
      if (audio.correctionEnabled) out.calibration = "mod";
      const reactorLive = Object.values(useReactorStore.getState().engaged)
        .some((e) => e.phase !== "out");
      if (reactorLive) out.reactor = "mod";
      if (useDimensionStore.getState().active) out.dimension = "mod";

      return out;
    };

    let last = "";
    const tick = () => {
      if (document.hidden) return;
      const next = compute();
      // Only re-render the sidebar when something actually changed.
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setActivity(next);
      }
    };

    tick();
    const id = window.setInterval(tick, 600);
    return () => window.clearInterval(id);
  }, []);

  return activity;
}
