/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.1";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Ambiguous Character names",
    body: "All Character cards use original names — no brand fingerprints. Patch Library chrome cleaned (no emoji).",
  },
  {
    title: "Signal Path On/Off",
    body: "Every stage on the Signal Path rack (OSC → SCOPE) can bypass independently.",
  },
  {
    title: "Stage visualizers",
    body: "Vintage Age, Chip, and Analog Life get their own viz; Reverb blooms with Damp / Pre / Diff; Sidechain is hi-DPI sharp.",
  },
  {
    title: "Chip + Analog Life feel",
    body: "Stronger PWM, sync grit, chip-noise bed, drift/instability/tune/env variance — actually audible now.",
  },
];
