/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.5.2";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
  {
    title: "Macros, Gate & Matrix — stage overhaul",
    body: "Three modules get their own personalities: amber Macro command cluster with radar + wiring readout, ice Trance Gate chop field with amplitude silhouette, and a green Mod Matrix signal bay with traveling cable packets. Function unchanged — look and feel leveled up.",
  },
  {
    title: "Arp stage — visual overhaul",
    body: "Hi-DPI contour stage with depth field, pitch-linked color shifting, targeting-reticle blooms on every hit, and a symmetrical control layout. Same arp engine — just sharper and more fun to watch.",
  },
  {
    title: "Fire Command MK IV",
    body: "The wavetable weapons platform gets its biggest overhaul yet: a redesigned MK IV banner, 1000 factory presets, next/previous patch cycling, and a rebuilt two-octave keyboard with octave scroll and click-position velocity.",
  },
  {
    title: "Natural Selection mutate",
    body: "Mutate now breeds two candidate patches from your current sound. Audition A and B, keep the one you like, and evolve in that direction — with a strength slider from subtle drift to full mutation.",
  },
  {
    title: "Precision knobs",
    body: "Every knob supports shift-drag fine tuning, click-to-type exact values, double-click reset, and a hover reset pip — no more fighting to land on an exact percentage.",
  },
];
