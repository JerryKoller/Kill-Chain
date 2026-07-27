/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.11";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Clearer arrangement",
    body: "Add to end replaces the confusing Place button. Empty timeline shows what to do; click a bar or drag a pattern chip onto the grid.",
  },
  {
    title: "Playlist track chrome",
    body: "Fixed track label, denser bar grid, and richer clips with start bar and length — plus Editing badge so the open pattern is obvious.",
  },
  {
    title: "Arrangement playlist",
    body: "FL-style pattern bank + timeline from 3.0.10 — gaps are silence; Loop pattern or Play arrangement.",
  },
];
