import { NEUTRAL_PARAMS, type SoundParams } from "./types";

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  emoji: string;
  accent: string;
  params: SoundParams;
}

const make = (over: Partial<SoundParams>): SoundParams => ({
  ...NEUTRAL_PARAMS,
  ...over,
});

export const PRESETS: Preset[] = [
  {
    id: "neutral",
    name: "Neutral Reference",
    blurb: "Flat reference. No coloration — the honest starting point.",
    emoji: "◯",
    accent: "#22e8ff",
    params: make({}),
  },
  {
    id: "cinema",
    name: "Cinema",
    blurb: "Movies, scores, dialogue you can feel and hear.",
    emoji: "▶",
    accent: "#ff8a48",
    params: make({
      subBass: 0.4,
      bass: 0.2,
      vocals: 0.3,
      presence: 0.2,
      clarity: 0.15,
      width: 0.5,
      reverbAmount: 0.15,
      reverbSize: 0.6,
      spatial: 0.5,
      punch: 0.25,
    }),
  },
  {
    id: "studio",
    name: "Studio",
    blurb: "Surgical detail. Mixing-room accurate.",
    emoji: "◎",
    accent: "#9dff5b",
    params: make({
      presence: 0.2,
      clarity: 0.2,
      vocals: 0.15,
      air: 0.2,
      sparkle: 0.15,
      compression: 0.05,
      width: 0.1,
    }),
  },
  {
    id: "club",
    name: "Club",
    blurb: "Sub-bass that hits, energy that doesn't quit.",
    emoji: "✷",
    accent: "#ff2bd6",
    params: make({
      subBass: 0.6,
      bass: 0.35,
      presence: 0.15,
      punch: 0.5,
      compression: 0.3,
      width: 0.3,
      sparkle: 0.25,
    }),
  },
  {
    id: "vinyl",
    name: "Warm Vinyl",
    blurb: "Tape saturation, warm mids, relaxed highs.",
    emoji: "◐",
    accent: "#ffb648",
    params: make({
      warmth: 0.45,
      body: 0.2,
      bass: 0.2,
      vocals: 0.15,
      harmonics: 0.35,
      saturation: 0.3,
      air: -0.15,
      sparkle: -0.2,
    }),
  },
  {
    id: "crystal",
    name: "Crystal Clear",
    blurb: "Glassy highs, surgical vocals, airy stage.",
    emoji: "❖",
    accent: "#22e8ff",
    params: make({
      presence: 0.35,
      clarity: 0.4,
      vocals: 0.3,
      air: 0.45,
      sparkle: 0.4,
      width: 0.25,
      body: -0.1,
    }),
  },
  {
    id: "bass-arena",
    name: "Bass Arena",
    blurb: "Stadium subs. Maximum low-end real estate.",
    emoji: "▮",
    accent: "#7a3bff",
    params: make({
      subBass: 0.85,
      bass: 0.6,
      warmth: 0.15,
      body: -0.1,
      punch: 0.4,
      compression: 0.25,
      texture: 0.1,
    }),
  },
  {
    id: "late-night",
    name: "Late Night",
    blurb: "Lo-fi smoothness. Easy on tired ears.",
    emoji: "☾",
    accent: "#a06bff",
    params: make({
      warmth: 0.3,
      body: 0.15,
      bass: 0.15,
      compression: 0.45,
      saturation: 0.15,
      presence: -0.1,
      air: -0.1,
      sparkle: -0.25,
      reverbAmount: 0.1,
      reverbSize: 0.55,
    }),
  },
  {
    id: "immersive",
    name: "Immersive",
    blurb: "Out-of-head, wraparound imaging.",
    emoji: "◉",
    accent: "#48ffd1",
    params: make({
      width: 0.7,
      spatial: 0.7,
      reverbAmount: 0.25,
      reverbSize: 0.75,
      air: 0.2,
      presence: 0.1,
    }),
  },
];

export const findPreset = (id: string): Preset | undefined =>
  PRESETS.find((p) => p.id === id);

/**
 * Linearly blend two presets weighted by `mix` in [0, 1].
 */
export function blendPresets(
  a: SoundParams,
  b: SoundParams,
  mix: number,
): SoundParams {
  const m = Math.max(0, Math.min(1, mix));
  const out: SoundParams = { ...a };
  (Object.keys(a) as (keyof SoundParams)[]).forEach((k) => {
    out[k] = a[k] * (1 - m) + b[k] * m;
  });
  return out;
}

/**
 * Smooth morph between any number of presets given weights that sum to ~1.
 */
export function morphPresets(
  weighted: { params: SoundParams; weight: number }[],
): SoundParams {
  const total = weighted.reduce((s, w) => s + Math.max(0, w.weight), 0) || 1;
  const out: SoundParams = { ...NEUTRAL_PARAMS };
  for (const { params, weight } of weighted) {
    const w = Math.max(0, weight) / total;
    (Object.keys(out) as (keyof SoundParams)[]).forEach((k) => {
      out[k] += params[k] * w;
    });
  }
  return out;
}
