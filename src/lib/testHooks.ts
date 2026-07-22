/**
 * DEV-only test hooks for the smoke suite (scripts/smoke.mjs).
 *
 * The suite drives the app over CDP. It can't just `import("/src/…")` from
 * the console: with a long-lived Vite dev server the app's modules carry HMR
 * `?t=` timestamps, so plain URLs would resolve to a SECOND module graph —
 * a second AudioEngine, stores with no attached <audio> element, etc.
 *
 * Instead the app exposes its own live module namespace here. Static import
 * specifiers inside app code always resolve to the instances the app runs on.
 * Never installed in production builds.
 */
export function installTestHooks(): void {
  if (typeof window === "undefined") return;
  // Dev server only (the packaged app loads from file:// / app://).
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(window.location.href)) return;
  (window as unknown as Record<string, unknown>).__KC_TEST = {
    load: async () => ({
      engine: await import("@/audio/AudioEngine"),
      playerStore: await import("@/state/playerStore"),
      audioStore: await import("@/state/audioStore"),
      settingsStore: await import("@/state/settingsStore"),
      airspaceStore: await import("@/state/airspaceStore"),
      dimensionStore: await import("@/state/dimensionStore"),
      fireSequencerStore: await import("@/state/fireSequencerStore"),
      userPresetsStore: await import("@/state/userPresetsStore"),
      libraryStore: await import("@/state/libraryStore"),
      missionStateStore: await import("@/state/missionStateStore"),
      missionLogStore: await import("@/state/missionLogStore"),
      lockLibraryStore: await import("@/state/lockLibraryStore"),
      sourceArbiter: await import("@/lib/sourceArbiter"),
      tractorAutoLock: await import("@/lib/tractorAutoLock"),
      appHealth: await import("@/lib/appHealth"),
      chainSnapshot: await import("@/lib/chainSnapshot"),
      fireStudio: await import("@/lib/fireStudio"),
    }),
  };
}
