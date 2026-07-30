/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.2.1";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill-Chain — a place to play with and reshape your audio.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Load music, sculpt tone, fix and restore tracks, and route sound through a full DSP chain — with Fire Command, Airspace, and Morph waiting when you want to go deeper.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Retail first-run",
    body: "Legal agree gate, a 7-step basic tour (Library → Sculptor → Tractor → Armory), and Kill-Chain backup for Settings + Library + Mission Log.",
  },
  {
    title: "Library repair",
    body: "Missing-file badges, prune orphans, Reveal in Explorer, and clearer playback errors when a track was moved.",
  },
  {
    title: "Fire Command stability audit",
    body: "Live keys follow Edit A/B, morph/scene scrub no longer corrupts patches, FX knobs update the bus live, and project open while editing B loads A correctly.",
  },
  {
    title: "Sequencer ↔ synth bridge",
    body: "Harmony/chord expansions for A and B, per-channel humanize, delay sync tracks BPM, offline bounce matches live expansions (ARP stays live-only).",
  },
  {
    title: "Meters & MIDI",
    body: "StageViz and tone meters follow the active synth; MIDI Focus no longer steals Learn/mapped CCs; Scale Strict rejects no longer record into the roll.",
  },
  {
    title: "Projects v3",
    body: ".kcproj now saves edit target, presets, FX route, scenes, octave, and voice count — and restores them on open.",
  },
];
