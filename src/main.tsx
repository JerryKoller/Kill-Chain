import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./styles/kcds.css";
import {
  playSplashSound,
  preloadSplashSound,
  prepareSplashPlayback,
  SPLASH_HIT_MS,
  SPLASH_SOUND_DURATION_S,
} from "./audio/splashSound";
import { useSettingsStore } from "./state/settingsStore";

// ?viz=1 → this instance is the Visualizer BROADCAST window (a second
// frameless BrowserWindow). It renders analyser frames streamed over IPC and
// must NOT boot the full app (no engine, no splash, no stores beyond the
// visualizer's own).
const IS_VIZ_WINDOW =
  new URLSearchParams(window.location.search).get("viz") === "1";

if (IS_VIZ_WINDOW) {
  document.getElementById("boot-splash")?.remove();
  void import("./components/Visualizer/BroadcastWindow").then(
    ({ BroadcastWindow }) => {
      ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
          <BroadcastWindow />
        </React.StrictMode>,
      );
    },
  );
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

/**
 * Boot splash — single clock owned here.
 * index.html only stamps __bootStart and stays black until we add `.reveal`
 * at the same instant the sting starts (after preload + sink + resume).
 * Hit classes fire from SPLASH_HIT_MS so visuals lock to audio t=0.
 */
(() => {
  if (IS_VIZ_WINDOW) return;
  const splash = document.getElementById("boot-splash");
  const stage = document.getElementById("boot-stage");
  if (!splash || !stage) return;

  const w = window as unknown as { __introStart?: number; __bootStart?: number };
  const BLACK_MS = 900; // black lead-in before reveal + sting

  void preloadSplashSound();
  void prepareSplashPlayback();

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    splash.classList.add("boot-hide");
    window.setTimeout(() => splash.remove(), 650);
  };

  const hitTimers: number[] = [];
  const clearHits = () => {
    for (const id of hitTimers) window.clearTimeout(id);
    hitTimers.length = 0;
  };

  const pulse = (cls: string, holdMs = 180) => {
    splash.classList.add(cls);
    hitTimers.push(window.setTimeout(() => splash.classList.remove(cls), holdMs));
  };

  const armVisualHits = () => {
    clearHits();
    pulse("hit-contact", 220);
    hitTimers.push(window.setTimeout(() => pulse("hit-radar-l", 280), SPLASH_HIT_MS.radarL));
    hitTimers.push(window.setTimeout(() => pulse("hit-radar-r", 280), SPLASH_HIT_MS.radarR));
    hitTimers.push(window.setTimeout(() => {
      splash.classList.add("hit-arming");
    }, SPLASH_HIT_MS.arming));
    hitTimers.push(window.setTimeout(() => {
      splash.classList.remove("hit-arming");
      pulse("hit-drop", 520);
    }, SPLASH_HIT_MS.drop));
  };

  const bootStart = typeof w.__bootStart === "number" ? w.__bootStart : performance.now();
  const revealAt = bootStart + BLACK_MS;

  const run = async () => {
    const wait = Math.max(0, revealAt - performance.now());
    if (wait > 0) await new Promise<void>((r) => window.setTimeout(r, wait));

    // Finish warm-up so the first sample lands with `.reveal`.
    await prepareSplashPlayback();

    const { uiSounds, uiSoundVolume, bootSound } = useSettingsStore.getState();
    const soundOn = uiSounds && bootSound;

    let started = false;
    const beginSequence = () => {
      if (started) return;
      started = true;
      stage.classList.add("reveal");
      w.__introStart = performance.now();
      armVisualHits();
      window.setTimeout(dismiss, SPLASH_SOUND_DURATION_S * 1000);
    };

    // Safety net if autoplay stalls — never leave a permanent black screen.
    const safety = window.setTimeout(beginSequence, 2200);

    if (!soundOn) {
      window.clearTimeout(safety);
      beginSequence();
      return;
    }

    // Reveal when the buffer actually starts — never before.
    void playSplashSound(0.9 * uiSoundVolume, () => {
      window.clearTimeout(safety);
      beginSequence();
    });
  };

  void run();
})();

// Dev-only debug handles: LIVE module instances (HMR-safe). Skip fireCommandStore
// so the ~1000-preset bank isn't forced into every cold boot.
const IS_DEV = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
if (IS_DEV && !IS_VIZ_WINDOW) {
  void Promise.all([
    import("@/audio/AudioEngine"),
    import("@/state/audioStore"),
    import("@/state/playerStore"),
    import("@/state/uiStore"),
    import("@/state/airspaceStore"),
    import("@/state/dimensionStore"),
    import("@/state/fireSequencerStore"),
    import("@/lib/airspaceMedia"),
    import("@/state/visualizerStore"),
    import("@/state/eqStore"),
    import("@/lib/chainSnapshot"),
  ]).then(([eng, audio, player, ui, air, dim, seq, airMedia, viz, eq, chain]) => {
    (window as unknown as Record<string, unknown>).__kc = {
      eng, audio, player, ui, air, dim, seq, airMedia, viz, eq, chain,
      // Lazy: open Fire Command (or call) to load the preset bank.
      fire: () => import("@/state/fireCommandStore"),
    };
  });
}
