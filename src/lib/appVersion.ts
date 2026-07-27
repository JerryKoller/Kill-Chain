/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.0.4";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Synth · Sequencer workspaces",
    body: "Fire Command splits into two clear tabs — build the sound on Synth, build the beat & melody on Sequencer. Slim transport keeps play reachable while you tweak the patch.",
  },
  {
    title: "Performance",
    body: "Idle workspace unmounts its visualizers and playheads. Signal Path heat is throttled so knob drags stay smooth.",
  },
  {
    title: "Beginner path",
    body: "Plain labels and short hints — Synth for sound, Sequencer for patterns, piano roll, and drums.",
  },
];
