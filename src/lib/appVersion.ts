/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.4.1";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Universal output positioning",
    body: "Kill Chain is now framed as a universal Windows audio engine — not a single-headphone product. Fresh installs default to Neutral correction; Sony XM6 and every other model remain in the compatibility catalog.",
  },
  {
    title: "Playback Correction",
    body: "The device picker is now Playback Correction / Output Device Profile. Onboarding asks what you listen on — headphones, desktop speakers, soundbar/TV, home theater, or neutral — and loads a sensible starting profile.",
  },
  {
    title: "Legal & About",
    body: "Settings → Advanced includes trademark and content-responsibility notices, plus draft EULA and Privacy Policy links. Profiles are labeled as compatibility aids, not brand endorsements.",
  },
  {
    title: "Licensing hygiene",
    body: "Conflicting MIT/personal-use wording removed from the repo. Proprietary LICENSE, third-party notices, and attorney-review placeholders added for commercial distribution.",
  },
];
