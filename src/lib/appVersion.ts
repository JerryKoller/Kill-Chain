/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.6.2";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Visualizer fidelity pass",
    body: "Fire Command stages resize to their bay (no clipped edge labels). Osc WaveDisplay is hi-DPI. Morph Pad, Meter Bridge, Arp, Macros, Gate, and FX/Core stages fit the full-width band layout.",
  },
  {
    title: "Patch bar polish",
    body: "Keep winner no longer bleeds its box. Studio bay is three equal Undo / Redo / Library cells that fill the panel.",
  },
  {
    title: "Armory Deploy randomize",
    body: "Tumbling-dice deploy pod with category Scope — twin to Natural Selection.",
  },
  {
    title: "Natural Selection mutate",
    body: "Evolution bay with Mild→Wild pressure, Gen, rival A/B cards.",
  },
  {
    title: "Drum + piano roll fill width",
    body: "Step grids and the piano roll stretch across the sequencer — no dead black voids.",
  },
];
