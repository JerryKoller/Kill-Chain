/**
 * Friendly, exploration-first parameters exposed by the UI.
 * Internally, each one drives one or many DSP nodes inside the engine.
 *
 * Two value conventions:
 *   - Bipolar params live in [-1, 1] where 0 is "neutral". EQ bands,
 *     punch/texture, width and reverbSize work this way.
 *   - Unipolar params live in [0, 1] where 0 is fully OFF and 1 is max.
 *     Effect amounts (harmonics, saturation, spatial, reverbAmount,
 *     compression) work this way. See SOUND_PARAM_META for the per-param
 *     flag.
 */
export interface SoundParams {
  // Tonal balance — drives the parametric EQ. All bipolar.
  subBass: number;
  bass: number;
  warmth: number;
  body: number;     // 350 Hz — low-mid mud / body
  mid: number;      // 700 Hz — overall fullness
  vocals: number;
  presence: number; // 3 kHz — articulation
  clarity: number;
  air: number;
  sparkle: number;

  // Dynamics
  punch: number;       // bipolar — boost or cut transient attack
  texture: number;     // bipolar — boost or cut sustain
  compression: number; // unipolar — glue amount

  // Space
  width: number;        // bipolar (-1 = mono, 0 = stereo, +1 = wide)
  reverbAmount: number; // unipolar
  reverbSize: number;   // bipolar (-1 = booth, +1 = cathedral)
  spatial: number;      // unipolar — crossfeed / out-of-head

  // Color
  harmonics: number;  // unipolar — even-order excitation
  saturation: number; // unipolar — analog drive

  // Pro tools (introduced after v1; existing presets get safe defaults)
  deEss: number;          // unipolar — sibilance reduction depth
  subWidth: number;       // bipolar — width of <250 Hz band
  presenceWidth: number;  // bipolar — width of 250 Hz - 3 kHz band
  airWidth: number;       // bipolar — width of > 3 kHz band
  mbCompLow: number;      // unipolar — multiband comp depth (low band)
  mbCompMid: number;      // unipolar — mid band
  mbCompHigh: number;     // unipolar — high band

  // Lo-Fi Deck
  lofiAge: number;        // unipolar — filters, bandwidth reduction
  lofiWear: number;       // unipolar — dropouts, mechanical noise
  lofiWowFlutter: number; // unipolar — pitch modulation
}

export interface ParametricBand {
  id: string;
  freq: number; // Hz
  gain: number; // dB
  q: number; // quality factor
  type: BiquadFilterType;
  label?: string;
  color?: string;
}

export interface EngineSnapshot {
  params: SoundParams;
  bands: ParametricBand[];
  enabled: boolean;
  bypassed: boolean;
  outputGain: number; // dB
  preset?: string;
  ts: number;
}

export const NEUTRAL_PARAMS: SoundParams = {
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

  deEss: 0,
  subWidth: 0,
  presenceWidth: 0,
  airWidth: 0,
  mbCompLow: 0,
  mbCompMid: 0,
  mbCompHigh: 0,

  lofiAge: 0,
  lofiWear: 0,
  lofiWowFlutter: 0,
};

/**
 * Coerce any partially-typed SoundParams (e.g. from a v1 saved preset) to
 * a fully-populated v2 SoundParams by back-filling missing keys with their
 * neutral defaults.
 */
export function normalizeParams(p: Partial<SoundParams>): SoundParams {
  return { ...NEUTRAL_PARAMS, ...p };
}

/**
 * True when every param equals its neutral default — i.e. the DSP would be
 * acoustically transparent. Used to decide whether to leave the engine in
 * clean bypass (bit-identical to the source) or engage the FX chain.
 */
export function paramsAreNeutral(p: SoundParams): boolean {
  return (Object.keys(NEUTRAL_PARAMS) as (keyof SoundParams)[]).every(
    (k) => p[k] === NEUTRAL_PARAMS[k],
  );
}

export type ParamMeta = {
  key: keyof SoundParams;
  label: string;
  hint: string;
  color: string;
  /** False = unipolar (0..1, 0 = off). Defaults to true. */
  bipolar?: boolean;
  /** True = part of the EQ tone band stack (driven by the friendly EQ). */
  isEqBand?: boolean;
};

export const SOUND_PARAM_META: ParamMeta[] = [
  { key: "subBass",  label: "Sub Bass", hint: "Felt, not heard. Floor-rumble lows.", color: "#7a3bff", isEqBand: true },
  { key: "bass",     label: "Bass",     hint: "Body, kick, low-end groove.",         color: "#5b6bff", isEqBand: true },
  { key: "warmth",   label: "Warmth",   hint: "Lower-mid weight and richness.",      color: "#ffb648", isEqBand: true },
  { key: "body",     label: "Body",     hint: "350 Hz — fullness without mud.",      color: "#ff7a48", isEqBand: true },
  { key: "mid",      label: "Mid",      hint: "700 Hz — overall presence.",          color: "#ff8a48", isEqBand: true },
  { key: "vocals",   label: "Vocals",   hint: "Forward presence for voices.",        color: "#ffa55b", isEqBand: true },
  { key: "presence", label: "Presence", hint: "3 kHz — articulation & bite.",        color: "#ff2bd6", isEqBand: true },
  { key: "clarity",  label: "Clarity",  hint: "Definition in upper mids.",           color: "#ff5bd1", isEqBand: true },
  { key: "air",      label: "Air",      hint: "Space between the instruments.",      color: "#22e8ff", isEqBand: true },
  { key: "sparkle",  label: "Top End",  hint: "Uppermost shelf — high-frequency detail.", color: "#9dff5b", isEqBand: true },

  { key: "punch",        label: "Punch",       hint: "Snappy transients & impact.",     color: "#ff5b8a" },
  { key: "texture",      label: "Texture",     hint: "Sustain & body of each note.",    color: "#a06bff" },
  { key: "compression",  label: "Glue",        hint: "Cohesion & loudness consistency.",color: "#48cfff", bipolar: false },

  { key: "width",        label: "Width",       hint: "Stereo spread & openness.",       color: "#48ffd1" },
  { key: "reverbAmount", label: "Space",       hint: "Ambient tail mixed in.",          color: "#7a3bff", bipolar: false },
  { key: "reverbSize",   label: "Room",        hint: "Small booth → cathedral.",        color: "#6a48ff" },
  { key: "spatial",      label: "Crossfeed",   hint: "Out-of-head speaker imaging.",    color: "#22e8ff", bipolar: false },

  { key: "harmonics",  label: "Harmonics",  hint: "Even-order excitation.", color: "#ff2bd6", bipolar: false },
  { key: "saturation", label: "Saturation", hint: "Subtle analog drive.",   color: "#ff8a48", bipolar: false },

  { key: "deEss",         label: "De-ess",        hint: "Dynamic taming of 5-9 kHz sibilance.",       color: "#ff5b8a", bipolar: false },
  { key: "subWidth",      label: "Sub Width",     hint: "Stereo of the lows. -1 = mono (recommended).", color: "#7a3bff" },
  { key: "presenceWidth", label: "Mid Width",     hint: "Stereo of vocals & mids.",                    color: "#ff2bd6" },
  { key: "airWidth",      label: "Air Width",     hint: "Stereo width above 3 kHz.",                   color: "#22e8ff" },
  { key: "mbCompLow",     label: "MB Comp Low",   hint: "Multiband compression on the low band.",      color: "#5b6bff", bipolar: false },
  { key: "mbCompMid",     label: "MB Comp Mid",   hint: "Multiband compression on the mid band.",      color: "#ff8a48", bipolar: false },
  { key: "mbCompHigh",    label: "MB Comp High",  hint: "Multiband compression on the high band.",     color: "#48cfff", bipolar: false },

  { key: "lofiAge",       label: "Age",           hint: "Bandwidth reduction and filter degradation.", color: "#ffb648", bipolar: false },
  { key: "lofiWear",      label: "Wear",          hint: "Dust, crackle, and dropout artifacts.",       color: "#c87a3a", bipolar: false },
  { key: "lofiWowFlutter",label: "Wow/Flutter",   hint: "Pitch instability and wobble.",               color: "#ff6f3c", bipolar: false },
];

export const TONE_KEYS: (keyof SoundParams)[] = SOUND_PARAM_META
  .filter((m) => m.isEqBand)
  .map((m) => m.key);

/**
 * Helper: returns the default value for a parameter (neutral or "off"
 * depending on whether the param is bipolar). Negative-half clamp for
 * unipolar params is handled inside the DSP modules.
 */
export function isBipolar(key: keyof SoundParams): boolean {
  const m = SOUND_PARAM_META.find((x) => x.key === key);
  return m?.bipolar !== false;
}
