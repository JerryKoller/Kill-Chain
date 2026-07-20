import { NEUTRAL_PARAMS, normalizeParams, type SoundParams } from "@/audio/types";
import { PRESETS } from "@/audio/presets";

const VIBES = [
  { name: "Night Watch", emoji: "◐", bias: { warmth: 0.35, bass: 0.2, reverbAmount: 0.25, spatial: 0.15 } },
  { name: "Overdrive", emoji: "▲", bias: { punch: 0.4, compression: 0.3, saturation: 0.35, presence: 0.2 } },
  { name: "Open Sky", emoji: "◇", bias: { air: 0.35, sparkle: 0.3, reverbSize: 0.4, width: 0.25 } },
  { name: "Undertow", emoji: "▽", bias: { subBass: 0.3, width: -0.2, spatial: 0.35, texture: 0.2 } },
  { name: "Tape Relay", emoji: "▤", bias: { warmth: 0.25, harmonics: 0.3, saturation: 0.2, clarity: -0.1 } },
  { name: "Target Lock", emoji: "⌖", bias: { clarity: 0.35, presence: 0.3, compression: 0.25, width: -0.15 } },
  { name: "Deep Water", emoji: "≋", bias: { subBass: 0.4, body: 0.2, reverbAmount: 0.2, spatial: 0.3 } },
  { name: "First Light", emoji: "◎", bias: { air: 0.25, vocals: 0.2, width: 0.3, reverbAmount: 0.15 } },
];

const TWEAK_KEYS: (keyof SoundParams)[] = [
  "subBass", "bass", "warmth", "body", "mid", "vocals", "presence", "clarity", "air", "sparkle",
  "punch", "texture", "compression", "width", "reverbAmount", "reverbSize", "spatial",
  "harmonics", "saturation",
];

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface LuckyDipResult {
  name: string;
  emoji: string;
  tagline: string;
  params: SoundParams;
}

/**
 * Generate a musically-coherent random sculpt. Blends a random built-in
 * preset at low weight with a vibe bias and a handful of jittered params.
 */
export function luckyDip(): LuckyDipResult {
  const vibe = pick(VIBES);
  const preset = pick(PRESETS.filter((p) => p.id !== "neutral"));
  const presetWeight = rand(0.15, 0.45);

  const next: SoundParams = { ...NEUTRAL_PARAMS };

  // Blend preset
  for (const k of TWEAK_KEYS) {
    const pv = preset.params[k] ?? 0;
    next[k] = next[k] * (1 - presetWeight) + pv * presetWeight;
  }

  // Apply vibe bias
  for (const [k, v] of Object.entries(vibe.bias) as [keyof SoundParams, number][]) {
    next[k] = clamp(next[k] + v * rand(0.6, 1.0), k === "compression" || k === "harmonics" || k === "saturation" || k === "spatial" || k === "reverbAmount" ? 0 : -1, 1);
  }

  // Sprinkle 3-5 random micro-tweaks
  const nTweaks = Math.floor(rand(3, 6));
  const shuffled = [...TWEAK_KEYS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < nTweaks; i++) {
    const k = shuffled[i];
    const isUni = ["compression", "harmonics", "saturation", "spatial", "reverbAmount", "deEss", "mbCompLow", "mbCompMid", "mbCompHigh"].includes(k);
    const delta = rand(-0.25, 0.25);
    next[k] = clamp(next[k] + delta, isUni ? 0 : -1, 1);
  }

  const taglines = [
    "Randomized profile generated — audition before committing.",
    "No two rolls are identical.",
    "Statistically improbable. Sonically interesting.",
    "Generated within musical limits.",
  ];

  return {
    name: vibe.name,
    emoji: vibe.emoji,
    tagline: pick(taglines),
    params: normalizeParams(next),
  };
}
