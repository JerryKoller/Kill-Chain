/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.6.8";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Signal Path Theater",
    body: "OSC → Filter → Drive → FX → Mix → Scope — live heat from your patch. Click to jump, FOC to solo.",
  },
  {
    title: "Command Map",
    body: "Every Fire Command stage on one atlas. Jump any module; Focus Mode solos it full-bay.",
  },
  {
    title: "Focus Mode",
    body: "Hide every other band and work one instrument at a time. Sticky HUD always offers Show all.",
  },
  {
    title: "Morph Pad type-search",
    body: "Corner presets are searchable across the factory + user bank.",
  },
  {
    title: "Unique stage personalities",
    body: "Distinct chrome and metaphors across Macros, FX, Core, Scope, and Matrix.",
  },
];
