/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.6.10";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Missions that hit",
    body: "Genre demos rebuilt hard — fat drums, solid bass on Synth B, color on A. No more ducked 808s.",
  },
  {
    title: "Sidechain that makes sense",
    body: "Duck pumps Synth A only. Bass, 808s, and wobbles on B stay locked.",
  },
  {
    title: "Splash with bite",
    body: "Centered boot still clean — HUD brackets, scanline, crosshair ticks, punch on the drop.",
  },
  {
    title: "Signal Path Theater",
    body: "OSC → Filter → Drive → FX → Mix → Scope — live heat from your patch. Click to jump, FOC to solo.",
  },
];
