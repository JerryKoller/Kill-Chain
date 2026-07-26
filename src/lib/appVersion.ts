/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.2";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "All Modules filled",
    body: "SRC · TONE · MIX · PERF now match MOD/FX at 7 each — Noise, Sub, Pluck, Width, Glue, Air, Harmony, Scale, Chord, Human, Scenes.",
  },
  {
    title: "Per-module On/Off",
    body: "Every entry in All Modules has a real bypass toggle — not just jump/solo.",
  },
  {
    title: "Unique stage identities",
    body: "Each new module ships its own visualizer personality — grain, sub sine, strike bloom, M/S fan, GR meter, air shelves, and more.",
  },
  {
    title: "Playable Perf bay",
    body: "Scale Lock, Chord Memory, Humanize, and 8 Scene slots for live capture/recall.",
  },
];
