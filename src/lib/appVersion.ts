/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.2.1";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
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
