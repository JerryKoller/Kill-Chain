import type { ParametricBand } from "./types";

/**
 * Baseline calibration tailored for the Sony WH-1000XM6.
 *
 * Approach: gently counter the headphone's stock tuning bumps (slight mid-bass
 * shelf, mildly recessed presence around 3 kHz, gently rolled-off top) without
 * sounding "EQ'd". Boosts are kept well below 2 dB so the corrected baseline
 * stays very close to the source signal — the rest of the playground is what
 * the user uses to add personality.
 *
 * The whole correction can be toggled OFF from the UI for a true reference A/B.
 */
export const XM6_CORRECTION_BANDS: ParametricBand[] = [
  { id: "xm6-rumble", freq: 32, gain: 0.8, q: 0.7, type: "lowshelf", label: "Rumble", color: "#7a3bff" },
  { id: "xm6-bass-tame", freq: 120, gain: -0.7, q: 1.0, type: "peaking", label: "Bass Tame", color: "#5b6bff" },
  { id: "xm6-warm", freq: 240, gain: 0.3, q: 1.1, type: "peaking", label: "Warmth", color: "#ffb648" },
  { id: "xm6-mud", freq: 420, gain: -0.5, q: 1.3, type: "peaking", label: "De-Mud", color: "#a06bff" },
  { id: "xm6-presence", freq: 2800, gain: 1.4, q: 1.0, type: "peaking", label: "Presence", color: "#ff2bd6" },
  { id: "xm6-edge", freq: 5200, gain: -0.4, q: 1.4, type: "peaking", label: "Edge Polish", color: "#ff5b8a" },
  { id: "xm6-air", freq: 9000, gain: 0.9, q: 0.9, type: "peaking", label: "Air", color: "#22e8ff" },
  { id: "xm6-shimmer", freq: 14000, gain: 1.0, q: 0.7, type: "highshelf", label: "Top End", color: "#9dff5b" },
];

/**
 * Default master gain. Unity (0 dB) so the boot-state loudness matches the
 * source exactly — i.e. identical to playing the file in Windows Media
 * Player. The safety limiter (transparent until ~-1 dBFS) catches stray
 * overs, and user EQ boosts have the limiter as a backstop, so we no longer
 * pre-attenuate and make everything quieter than the reference.
 */
export const XM6_DEFAULT_OUTPUT_GAIN_DB = 0.0;

/**
 * Suggested defaults for the "friendly" sliders after calibration.
 * They lean slightly warm-and-detailed, which complements the XM6 well.
 */
export const XM6_DEFAULT_PARAM_BIAS = {
  subBass: 0.1,
  bass: 0.05,
  warmth: 0.05,
  body: 0.0,
  mid: 0.0,
  vocals: 0.15,
  presence: 0.1,
  clarity: 0.1,
  air: 0.2,
  sparkle: 0.15,
  punch: 0.05,
  texture: 0.0,
  compression: 0.05,
  width: 0.1,
  reverbAmount: 0.0,
  reverbSize: 0.4,
  spatial: 0.05,
  harmonics: 0.05,
  saturation: 0.0,
} as const;
