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
      // Smoke needs LEGAL_VERSION to clear the first-boot legal gate.
      legal: await import("@/lib/legal"),
      // Fire audio probe (scripts/fire-audio-probe.mjs) drives the synth.
      fireCommandStore: await import("@/state/fireCommandStore"),
      // NS batch audit (scripts/fire-ns-audit.mjs) measures offspring.
      fireNsAudition: await import("@/lib/fireNsAudition"),
      // Bank audit (scripts/fire-bank-audit.mjs) prunes + measures presets.
      fireModuleUsage: await import("@/lib/fireModuleUsage"),
      // Edit check (scripts/fire-edit-check.mjs) exercises the note toolbox,
      // markers, clip clipboard and preset shelves.
      fireNoteOps: await import("@/lib/fireNoteOps"),
      firePresetShelf: await import("@/lib/firePresetShelf"),
      fireHistory: await import("@/lib/fireHistory"),
    }),
  };
}
