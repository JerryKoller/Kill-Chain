/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.4.0";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill-Chain — a place to play with and reshape your audio.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Load music, sculpt tone, fix and restore tracks, and route sound through a full DSP chain — with Fire Command, Airspace, and Morph waiting when you want to go deeper.";

/** Boot splash subtitle — keep in sync with index.html `.boot-sub`. */
export const PRODUCT_BOOT_SUBTITLE = "Play & reshape audio";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Clean first launch",
    body: "Fresh installs start silent — Init patches only, empty sequencer, blank Airspace (no preset hum, no YouTube), and boot sound off by default.",
  },
  {
    title: "New Fire Command factory library",
    body: "All old factory presets wiped. 220 newly curated patches (20 × 11 categories) authored for the current synth — absolute Q, ladder/SVF, ops4 FM, warp, LPG, chip duty.",
  },
  {
    title: "Session storage bump",
    body: "Fire Command, Sequencer, and Airspace use new storage keys so dirty v3.3 sessions do not reopen humming or mid-stream.",
  },
];
