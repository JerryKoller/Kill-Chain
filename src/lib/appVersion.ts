/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.3";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Stage visualizers elevated",
    body: "Every Fire Command module now has its own visual philosophy — FM Rack cables, grain storms, tectonic sub, iris pluck, VU glue, constellation scenes, and richer Core/FX stages.",
  },
  {
    title: "Window chrome & scroll",
    body: "Min/max/close stay reachable (no drag overlap). Fire Command can scroll to the absolute top; Focus HUD and header include a Top jump.",
  },
  {
    title: "Module On/Off honesty",
    body: "Matrix, macros, morph, vector, arp, pitch, and more fully honor All Modules bypass — including scenes that capture enable state.",
  },
  {
    title: "Arp + performance path",
    body: "Arpeggiator ticks respect Scale Lock and Humanize velocity; Arp module Off parks the scheduler so live notes play through.",
  },
];
