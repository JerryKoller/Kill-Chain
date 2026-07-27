/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.9";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Fire Command — cleaner layout",
    body: "Synth and Sequencer share one tab chrome. Band tabs (Home · Src · Tone · Mod · FX · Mix · Perf) replace folding category shells, and the patch bar is a balanced three-bay strip.",
  },
  {
    title: "Missions retired",
    body: "Capability Missions are gone from Fire Command for now. Browse the curated patch library, Characters, and Init instead.",
  },
  {
    title: "Preset identity",
    body: "Neutral Init, hard module resets on load, and quieter note starts so presets keep their own voice.",
  },
];
