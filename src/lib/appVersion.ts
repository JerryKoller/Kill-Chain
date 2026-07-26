/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.5.7";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Fire Command category bands",
    body: "Below the piano roll, modules live in Mix & Output, Sources, Tone, Modulation, FX, and Performance Tools. Collapsed modules become equal-width chips — no more jagged multi-column header laundry list.",
  },
  {
    title: "Symmetry + deeper Fire Command stages",
    body: "Knob rows match Delay/Reverb even spacing. Fire Mixer gets a readable meter bridge. Morph Pad, Output, OSC, Spectral Warp (Harmonic Forge), Unison, Filter, Envelopes, LFOs, FM·Ring and Pitch·Glide all gain depth and individuality — display only.",
  },
  {
    title: "Fire Command core stages + lit collapse",
    body: "Collapse chevrons are bigger and accent-lit. Fire Mixer is a proper console deck with signal-flow bay. Morph Pad, OSC A–C, Performance, Spectral Warp, Unison, Filter, Envelopes, LFOs, FM·Ring and Pitch·Glide each get their own stage personality — display only.",
  },
  {
    title: "Collapsible Fire Command + Warp / Output / Mixer stages",
    body: "Everything below the piano roll folds away. Spectral Warp gets a gold harmonic lattice, Output gets a hi-DPI master trace stage, and Fire Mixer adds a bus-overview deck — all display-only.",
  },
  {
    title: "FX stages — Drive through Spectral",
    body: "Six FX modules get stage personalities: Magma Forge (Drive), Sweep Notches (Phaser), Ensemble Shimmer (Chorus), Ping-Pong Corridor (Delay), Room Bloom (Reverb), and Violet FFT Bay (Spectral). Display only — same engines.",
  },
];
