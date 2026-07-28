/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.2.0";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Fire Command UX overhaul",
    body: "Studio / Compact / Focus density, breadcrumb + master meter utility strip, accordion pin cards, randomize locks, Cmd+K palette, and Patch / Pattern / Scene / Project save tiers.",
  },
  {
    title: "Open Fire transport",
    body: "Unified Pattern | Arrangement | Selection play scopes, arrangement arm/meters, and clearer Mix / Perf / Layers naming across the rack.",
  },
  {
    title: "Signal path + genealogy",
    body: "Reorderable signal-path display, mutation genealogy for kept generations, and editable atlas labels with Short / Full / Tech modes.",
  },
  {
    title: "Stability pass",
    body: "Morph Pad and meter RAF coalescing, arrangement idle guards, Focus vs Solo vs MPK Focus clarified, and module-lock respect on Armory deploy.",
  },
];
