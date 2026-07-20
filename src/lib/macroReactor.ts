import { isBipolar, type SoundParams } from "@/audio/types";

export type MacroMode = "one-shot" | "latch" | "pulse";

export interface MacroPreset {
  id: string;
  name: string;
  icon: string;
  mode: MacroMode;
  durationMs: number;
  accent: string;
  description: string;
  deltas: Partial<SoundParams>;
}

export const MACRO_PRESETS: MacroPreset[] = [
  {
    id: "drop",
    name: "Drop Switch",
    icon: "↓",
    mode: "one-shot",
    durationMs: 7000,
    accent: "#ff2bd6",
    description: "Instant club lift: bigger sub, wider stage, harder transients.",
    deltas: {
      subBass: 0.42,
      bass: 0.2,
      punch: 0.35,
      compression: 0.18,
      width: 0.24,
      sparkle: 0.14,
    },
  },
  {
    id: "focus",
    name: "Focus Beam",
    icon: "◇",
    mode: "latch",
    durationMs: 0,
    accent: "#22e8ff",
    description: "Locks vocals and detail forward while narrowing the room.",
    deltas: {
      vocals: 0.28,
      presence: 0.22,
      clarity: 0.24,
      width: -0.18,
      reverbAmount: -0.12,
      compression: 0.1,
    },
  },
  {
    id: "orbit",
    name: "Orbit",
    icon: "◎",
    mode: "pulse",
    durationMs: 5200,
    accent: "#48ffd1",
    description: "Rhythmic space modulation that breathes width and crossfeed motion.",
    deltas: {
      width: 0.45,
      spatial: 0.42,
      reverbAmount: 0.18,
      reverbSize: 0.34,
      air: 0.18,
    },
  },
  {
    id: "analog",
    name: "Analog Bloom",
    icon: "◐",
    mode: "latch",
    durationMs: 0,
    accent: "#ffb648",
    description: "Warmer, thicker, softer top end. Great for harsh streams.",
    deltas: {
      warmth: 0.32,
      body: 0.18,
      harmonics: 0.32,
      saturation: 0.2,
      air: -0.12,
      sparkle: -0.18,
    },
  },
  {
    id: "cleanse",
    name: "Cleanse",
    icon: "✦",
    mode: "one-shot",
    durationMs: 7500,
    accent: "#9dff5b",
    description: "Scoops mud, lifts air, and snaps the mix into clarity.",
    deltas: {
      body: -0.22,
      mid: -0.12,
      clarity: 0.32,
      air: 0.3,
      sparkle: 0.18,
      deEss: 0.16,
    },
  },
  {
    id: "tiny-room",
    name: "Tiny Room",
    icon: "□",
    mode: "pulse",
    durationMs: 3600,
    accent: "#a06bff",
    description: "Mono-ish, dry, punchy tunnel effect for quick contrast drops.",
    deltas: {
      width: -0.5,
      spatial: -0.1,
      reverbAmount: -0.2,
      reverbSize: -0.55,
      punch: 0.25,
      compression: 0.2,
    },
  },
];

export function clampParam(key: keyof SoundParams, value: number): number {
  return Math.max(isBipolar(key) ? -1 : 0, Math.min(1, value));
}

export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutSine(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return -(Math.cos(Math.PI * x) - 1) / 2;
}
