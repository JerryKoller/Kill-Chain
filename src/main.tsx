import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./styles/kcds.css";
import {
  playSplashSound,
  preloadSplashSound,
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

// Boot splash sequence. The inline script in index.html reveals the visuals
// after a short black lead-in and stamps `__introStart`; here we start the
// synthesized 5 s boot sting (src/audio/splashSound.ts) on that same instant
// and dismiss the splash exactly when the sting ends — which is also when the
// progress bar's 5 s fill animation completes.
(() => {
  if (IS_VIZ_WINDOW) return;
  const splash = document.getElementById("boot-splash");
  if (!splash) return;

  const w = window as unknown as { __introStart?: number; __bootStart?: number };
  const BLACK_MS = 900; // must match the inline script in index.html

  // Kick off the offline render immediately so the buffer is ready by reveal.
  void preloadSplashSound();

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    splash.classList.add("boot-hide");
    window.setTimeout(() => splash.remove(), 650);
  };

  // The reveal instant: already stamped if the inline timer fired before this
  // module ran, otherwise predicted from page load + the black lead-in.
  const now = performance.now();
  const revealAt =
    typeof w.__introStart === "number"
      ? w.__introStart
      : (typeof w.__bootStart === "number" ? w.__bootStart : now) + BLACK_MS;

  const startSound = () => {
    // Gated by Settings → Boot sound (its own switch) AND the master UI
    // sounds toggle; the volume slider scales the sting too. Skipping the
    // sound never blocks dismissal (timer below).
    const { uiSounds, uiSoundVolume, bootSound } = useSettingsStore.getState();
    if (!uiSounds || !bootSound) return;
    void playSplashSound(0.9 * uiSoundVolume);
  };
  window.setTimeout(startSound, Math.max(0, revealAt - now));

  // Dismiss when the sting (and the bar fill) complete. Timer-driven so it
  // works identically when the sound is disabled or autoplay is blocked.
  const target = revealAt + SPLASH_SOUND_DURATION_S * 1000;
  window.setTimeout(dismiss, Math.max(0, target - performance.now()));
})();

// Dev-only debug handles: the LIVE module instances (HMR-safe), so DevTools /
// automation can inspect the real engine + stores instead of accidentally
// importing duplicate module copies through un-timestamped URLs.
const IS_DEV = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
if (IS_DEV && !IS_VIZ_WINDOW) {
  void Promise.all([
    import("@/audio/AudioEngine"),
    import("@/state/audioStore"),
    import("@/state/playerStore"),
    import("@/state/uiStore"),
    import("@/state/airspaceStore"),
    import("@/state/dimensionStore"),
    import("@/state/fireCommandStore"),
    import("@/state/fireSequencerStore"),
    import("@/lib/airspaceMedia"),
    import("@/state/visualizerStore"),
    import("@/state/eqStore"),
    import("@/lib/chainSnapshot"),
  ]).then(([eng, audio, player, ui, air, dim, fire, seq, airMedia, viz, eq, chain]) => {
    (window as unknown as Record<string, unknown>).__kc = {
      eng, audio, player, ui, air, dim, fire, seq, airMedia, viz, eq, chain,
    };
  });
}
