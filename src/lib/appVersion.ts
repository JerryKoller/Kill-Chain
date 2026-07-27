/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.12";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "10-track playlist",
    body: "Layer patterns on up to 10 arrangement tracks. Mute/solo per track; overlapping clips on different lanes play together.",
  },
  {
    title: "Arrangement tools",
    body: "Zoom the timeline, scrub the playhead from the ruler, nudge/dup clips, trim length, and set clip or track colors.",
  },
  {
    title: "Piano-roll erase",
    body: "Right-click erase is more reliable — fatter hit target and the context menu no longer steals the gesture.",
  },
];
