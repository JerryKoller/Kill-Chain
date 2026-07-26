/** Displayed app version — keep in sync with package.json on release. */
export const APP_VERSION = "2.5.1";

/** Primary product line — use in onboarding, About, and marketing copy. */
export const PRODUCT_TAGLINE =
  "Kill Chain — a universal Windows audio engine for headphones, speakers, and home theater.";

/** Secondary description for About and README surfaces. */
export const PRODUCT_DESCRIPTION =
  "Correction profiles for headphones, portable speakers, soundbars, and TVs; spatial processing for headphone and room layouts; full DSP, analysis, and restoration.";

/** Headline changes shown in the "What's new" panel for this version. */
export const WHATS_NEW: { title: string; body: string }[] = [
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
  {
    title: "Deeper arp, gate, and mod matrix",
    body: "New arp modes (down-up, converge, diverge, pedal, walk) with swing, accents, and ratchets; trance gate presets, shift/invert, smoothing, and a live playhead; and a 12-slot mod matrix with crosshair highlighting and color-coded sources.",
  },
];
