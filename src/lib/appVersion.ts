/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.5.8";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Breathing room for open modules",
    body: "When several Fire Command modules in a band are open, they stack full-width instead of squeezing into multi-column grids. Mixer, Morph, Scope and friends keep their room.",
  },
  {
    title: "Sequencer chrome cleaned up",
    body: "Arrangement is one compact row (chain on demand). Piano / Drums, Draw A/B, and a File menu replace the stacked toolbars above the roll. Hint spam gone — tooltips carry the shortcuts.",
  },
  {
    title: "Fire Command category bands",
    body: "Below the piano roll, modules live in Mix & Output, Sources, Tone, Modulation, FX, and Performance Tools. Collapsed modules become equal-width chips.",
  },
  {
    title: "Symmetry + deeper Fire Command stages",
    body: "Knob rows match Delay/Reverb even spacing. Fire Mixer gets a readable meter bridge. Morph Pad, Output, OSC, Spectral Warp and more gain depth — display only.",
  },
  {
    title: "Collapsible Fire Command + lit collapse",
    body: "Everything below the piano roll folds away. Collapse chevrons are accent-lit. Stage personalities across Mixer, Morph, Warp, Output, FX — display only.",
  },
];
