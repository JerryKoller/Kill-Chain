/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.6.3";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Macros command cards",
    body: "Four equal macro cards with ring meters and destination chips — no more cramped radar or clipped text.",
  },
  {
    title: "Unique stage personalities",
    body: "Each Fire Command visualizer gets its own chrome and metaphor — forge plate, CRT scope, comb bloom, piano keys, ping-pong lanes, and more.",
  },
  {
    title: "Visualizer fidelity pass",
    body: "Stages resize to their bay. Morph Pad, Meter Bridge, Arp, Gate, and FX/Core stages fit the full-width band layout.",
  },
  {
    title: "Armory Deploy + Natural Selection",
    body: "Tumbling-dice randomize and evolution mutate bays — twin generative pods.",
  },
  {
    title: "Drum + piano roll fill width",
    body: "Step grids and the piano roll stretch across the sequencer — no dead black voids.",
  },
];
