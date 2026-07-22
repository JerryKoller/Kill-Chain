/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.4.0";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "MISSION STATE — one brain for all automation",
    body: "Every smart system now runs through a single orchestrator. A source change triggers ONE ordered pipeline after a short settle: manual override › saved source memory › Auto-Lock › Auto-Flatten. No more competing timers, no more systems fighting over the chain.",
  },
  {
    title: "Your hand always wins",
    body: "The moment you touch the chain — tone, Sculptor, restoration, clarity — automation stands down for that source until it changes. Automation's own moves don't count against you.",
  },
  {
    title: "Unified source memory",
    body: "Tractor locks, repair layers and chain snapshots now live in one versioned per-source record. Armory loadouts are referenced, not copied — update the loadout and every source that uses it follows. Old memories migrate automatically, and whole sessions export/import as .kcsession files.",
  },
  {
    title: "Mission HUD",
    body: "An always-visible strip under the title bar: what source is tracked, what automation is pending or applied, and any health issue that needs you — each with a one-click fix.",
  },
  {
    title: "Failures now speak up",
    body: "Silent failure paths are gone. Device loss, a suspended audio engine, storage that won't save, webview crashes and failed exports all surface as actionable alerts instead of dying in the console.",
  },
  {
    title: "Reset Audio Engine",
    body: "A one-click recovery action (Settings › Advanced) that re-wires the source, re-applies the output device and re-syncs every DSP stage from your saved state — no app restart needed.",
  },
  {
    title: "Hardened for long sessions",
    body: "Single-instance lock (a second launch focuses the running app), automatic renderer crash recovery, documented audio-graph lifecycle, and a repeatable critical-path smoke suite (npm run smoke) that walks playback, routing, 3D, locks, export and recovery end to end.",
  },
  {
    title: "Settings, reorganized",
    body: "Settings are now four clear sections — Audio, Automation, Appearance, Advanced — with all automation switches (Auto-Flatten, Auto-Lock, memory auto-restore) in one place.",
  },
];
