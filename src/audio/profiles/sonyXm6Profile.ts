import type { ParametricBand } from "../types";

/**
 * Compatibility correction bands for the Sony WH-1000XM6 profile only.
 * Not used as a global default — select this model in Playback Correction.
 *
 * Approach: gently counter the headphone's published stock tuning without
 * sounding heavily EQ'd. Boosts stay below ~2 dB.
 */
export const SONY_XM6_CORRECTION_BANDS: ParametricBand[] = [
  { id: "xm6-rumble", freq: 32, gain: 0.8, q: 0.7, type: "lowshelf", label: "Rumble", color: "#7a3bff" },
  { id: "xm6-bass-tame", freq: 120, gain: -0.7, q: 1.0, type: "peaking", label: "Bass Tame", color: "#5b6bff" },
  { id: "xm6-warm", freq: 240, gain: 0.3, q: 1.1, type: "peaking", label: "Warmth", color: "#ffb648" },
  { id: "xm6-mud", freq: 420, gain: -0.5, q: 1.3, type: "peaking", label: "De-Mud", color: "#a06bff" },
  { id: "xm6-presence", freq: 2800, gain: 1.4, q: 1.0, type: "peaking", label: "Presence", color: "#ff2bd6" },
  { id: "xm6-edge", freq: 5200, gain: -0.4, q: 1.4, type: "peaking", label: "Edge Polish", color: "#ff5b8a" },
  { id: "xm6-air", freq: 9000, gain: 0.9, q: 0.9, type: "peaking", label: "Air", color: "#22e8ff" },
  { id: "xm6-shimmer", freq: 14000, gain: 1.0, q: 0.7, type: "highshelf", label: "Top End", color: "#9dff5b" },
];
