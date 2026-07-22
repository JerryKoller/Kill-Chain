import type { ParametricBand } from "./types";

/**
 * Global default correction — flat / neutral. Fresh installs and any code path
 * that does not have an explicit user or Companion Mode profile selection
 * starts here. Device-specific curves live in `headphoneProfiles.ts`.
 */
export const DEFAULT_CORRECTION_BANDS: ParametricBand[] = [];

/** Unity master gain — playback loudness matches the source at boot. */
export const DEFAULT_OUTPUT_GAIN_DB = 0.0;

/** Suggested slider defaults when no user tuning exists yet (all neutral). */
export const DEFAULT_PARAM_BIAS = {
  subBass: 0,
  bass: 0,
  warmth: 0,
  body: 0,
  mid: 0,
  vocals: 0,
  presence: 0,
  clarity: 0,
  air: 0,
  sparkle: 0,
  punch: 0,
  texture: 0,
  compression: 0,
  width: 0,
  reverbAmount: 0,
  reverbSize: 0.4,
  spatial: 0,
  harmonics: 0,
  saturation: 0,
} as const;
