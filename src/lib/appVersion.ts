/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.10";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Arrangement playlist",
    body: "Song Order is gone. Drag patterns onto a horizontal timeline, leave gaps for silence, and play the full arrangement — FL Playlist-style.",
  },
  {
    title: "Expand all · Collapse all",
    body: "Each Synth band header can open or chip-collapse every module in one click.",
  },
  {
    title: "Blank patterns",
    body: "New creates an empty pattern; Duplicate copies the one you're editing. Patterns no longer auto-join the arrangement.",
  },
];
