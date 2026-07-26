/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.5.9";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Piano roll fills the bay",
    body: "The pattern grid now fit-to-widths the sequencer — no more dead black void on the right. Zoom in for detail; Fit snaps back to full width. Velocity and automation stay aligned.",
  },
  {
    title: "Sequencer symmetry + polish",
    body: "Transport splits into balanced Play / Bars / Channels zones. Editor chrome uses a three-column layout. Arrangement and tool bars get roomier controls and stage plating.",
  },
  {
    title: "Breathing room for open modules",
    body: "When several Fire Command modules in a band are open, they stack full-width instead of squeezing into multi-column grids.",
  },
  {
    title: "Sequencer chrome cleaned up",
    body: "Arrangement is one compact row (chain on demand). Piano / Drums, Draw A/B, and a File menu replace stacked toolbars above the roll.",
  },
  {
    title: "Fire Command category bands",
    body: "Below the piano roll, modules live in Mix & Output, Sources, Tone, Modulation, FX, and Performance Tools with equal-width collapsed chips.",
  },
];
