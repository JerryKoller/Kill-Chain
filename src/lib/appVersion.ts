/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.5.0";

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
    title: "Fire Command stays up",
    body: "Long sessions no longer collapse into distortion or silence. Natural Selection auditions no longer leak memory. Sequencer project load stays in sync with the engine.",
  },
  {
    title: "Sequencer on the other screen",
    body: "Expand puts the sequencer on the right display and the synth on the left. Arrangement and piano roll heights drag-resize and persist.",
  },
  {
    title: "Studio editing + 420 presets",
    body: "Piano-roll toolbox, arrangement markers and clip clipboard, preset favorites/recents, and 200 new factory patches on top of the v3.4 library.",
  },
];
