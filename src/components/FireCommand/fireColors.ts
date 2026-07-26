/**
 * Fire Command color language — where you are (band) + what you're doing (role).
 * Bands own a unique hue family; modules stay inside that family so navigation
 * reads at a glance.
 */

/** Band landmark colors */
export const FC_BAND = {
  mix: "#ff6a3d",      // coral fire — destination / mix / output
  sources: "#ff9a6b",  // warm peach — oscillators / raw voice
  tone: "#e8b84a",     // gold — filter body & tone sculpt
  mod: "#5eb0ff",      // sky blue — time & modulation
  fx: "#b388ff",       // violet — effects chain
  perf: "#ffb35c",     // amber — macros / gate / perform
} as const;

/** Role accents (still sit inside band families where possible) */
export const FC = {
  fire: FC_BAND.mix,
  sources: FC_BAND.sources,
  tone: FC_BAND.tone,
  mod: FC_BAND.mod,
  fx: FC_BAND.fx,
  perf: FC_BAND.perf,

  /** Osc A/B/C — peach family, rising brightness */
  oscA: "#ff6a3d",
  oscB: "#ff9a6b",
  oscC: "#ffcf5c",
  warp: "#e8b84a",

  /** Tone sculpt */
  unison: "#e8b84a",
  filter: "#f0c14a",
  /** Envelopes — lime family (shape over time), nested under Tone */
  envAmp: "#7cf6b0",
  envMod: "#9be564",
  envFilt: "#5ce0a0",

  /** Modulation */
  lfo: "#5eb0ff",
  fm: "#7ec4ff",
  pitch: "#9ad0ff",
  matrix: "#6ee7b7",
  arp: "#5eb0ff",

  /** FX chain — violet family with per-stage tint */
  drive: "#ff8f5c",
  phaser: "#c792ea",
  chorus: "#7dd3c0",
  delay: "#82b4ff",
  reverb: "#a8b4ff",
  spectral: "#d4a5ff",

  /** Mix & output */
  mixer: "#ff6a3d",
  morph: "#ff8a5c",
  scope: "#9be564",
  performance: "#ff9a6b",

  /** Performance tools */
  macros: "#ffb35c",
  gate: "#62b6ff",
} as const;
