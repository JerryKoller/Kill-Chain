/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.13";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "FL-style piano roll",
    body: "Draw / Select / Erase tools, paint-drag notes, brush length chips, and left+right edge resize — closer to FL mouse editing.",
  },
  {
    title: "Fluid arrangement editing",
    body: "Pointer-drag clips with a live ghost, no silent overlap parking, Shift+click to place, Del/arrows on clips, rename tracks.",
  },
  {
    title: "Clearer pattern workflow",
    body: "New + place, Duplicate pattern vs Double len, rename pencil, transport shows Pattern/Arrangement, Editing badge cycles patterns.",
  },
];
