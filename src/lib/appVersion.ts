/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "3.1.0";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Editable Synth B",
    body: "Edit A | Edit B on the Synth rack — full patch editing for the second instrument. Draw B focuses the rack. Arp and QWERTY stay on Synth A.",
  },
  {
    title: "Pattern sound recall",
    body: "Each pattern snapshots Synth A + B when you switch — arrangement play restores that pattern’s timbre automatically.",
  },
  {
    title: "Offline dry bounce",
    body: "Save and Export sit on the transport. Export prefers OfflineAudioContext dry Fire bounce (realtime fallback); stems stay realtime.",
  },
  {
    title: "Automation + drum grooves",
    body: "Automation opens by default with a Cutoff preview. House / Trap / Break / Clear grooves and Synth Kit clear in the Drum Bay.",
  },
];
