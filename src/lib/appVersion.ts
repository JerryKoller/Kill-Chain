/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.7.1";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Splash locked to the sting",
    body: "Reveal, drop, and hit pulses now start with the audio — no more laggy wall-clock desync.",
  },
  {
    title: "Dubstep that hits",
    body: "Dry square-LFO wobble, space between punches. No more wet-fart mush.",
  },
  {
    title: "Fire Command faster",
    body: "Idle mod timer sleeps, morph scrub skips React churn, note index for the sequencer, drum node cleanup.",
  },
  {
    title: "Fire Command clearer",
    body: "Signal-flow band order, Missions on the patch bay, Solo mode, less caption spam.",
  },
];
