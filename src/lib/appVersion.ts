/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.0";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Fire Command Genesis",
    body: "23 Character cards — Jupiter, Prophet, 303, Game Boy, DX7, Pigments DNA and more. Inspired voices, not clones.",
  },
  {
    title: "Vintage Age",
    body: "Cassette generations, tape speed, VHS Hi-Fi, 8/12-bit, BBD chorus, dust/hiss/hum/print-through — dry wire when off.",
  },
  {
    title: "Analog Life + Chip + FM",
    body: "Per-voice drift/tune/env variance, pulse duty, hard sync, chip noise, 303 accent/slide, 4-op FM rack, vector morph.",
  },
  {
    title: "Splash locked to the sting",
    body: "Reveal and drop hit pulses start with the audio — no wall-clock desync.",
  },
];
