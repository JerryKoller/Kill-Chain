/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.5";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Curated preset library",
    body: "The old ~1000 near-duplicate factory patches are gone. Every category now has 20 hand-authored, sonically distinct presets — Bass through FM.",
  },
  {
    title: "Capability Missions",
    body: "Five new Missions showcase what the synth can do: Unison Width, Cross-FM Forge, Spectral Freeze, Gate · Matrix Pulse, and Vintage Age Bus — not genre templates.",
  },
  {
    title: "Synth · Sequencer workspaces",
    body: "Fire Command still splits sound design and sequencing into clear tabs with slim transport on Synth.",
  },
];
