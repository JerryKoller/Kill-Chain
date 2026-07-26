/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.6.4";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Morph Pad type-search",
    body: "Corner presets are searchable — type a name, category, or keyword instead of scrolling a dropdown. Living blend field follows the puck.",
  },
  {
    title: "Studio bay cleanup",
    body: "Duplicate Library removed from Undo/Redo — Patch bay Browse owns the library. History depth rails show stack fill.",
  },
  {
    title: "Deeper stage play",
    body: "Patchbay cables with dual packets, phosphor master scope, wavetable scan beams, meter bloom, reverb impulse spikes.",
  },
  {
    title: "Unique stage personalities",
    body: "Macros command cards and distinct chrome across FX/Core stages.",
  },
  {
    title: "Armory Deploy + Natural Selection",
    body: "Tumbling-dice randomize and evolution mutate bays — twin generative pods.",
  },
];
