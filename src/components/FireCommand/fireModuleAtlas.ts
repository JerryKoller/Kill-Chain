/**
 * Fire Command module atlas — static map of bands → modules for the
 * Command Map, Signal Path Theater, and Focus Mode. Display/layout only.
 */

export type FireBandId =
  | "band.mix"
  | "band.sources"
  | "band.tone"
  | "band.mod"
  | "band.fx"
  | "band.perf";

export type FireModuleId = string;

export type FireModuleEntry = {
  id: FireModuleId;
  title: string;
  short: string;
  color: string;
  bandKey: FireBandId;
  bandTitle: string;
};

export type FireBandEntry = {
  id: FireBandId;
  title: string;
  short: string;
  color: string;
  hint: string;
  modules: FireModuleEntry[];
};

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const GRN = "#7cf6b0";

function m(
  id: string,
  title: string,
  short: string,
  color: string,
  bandKey: FireBandId,
  bandTitle: string,
): FireModuleEntry {
  return { id, title, short, color, bandKey, bandTitle };
}

export const FIRE_BANDS: FireBandEntry[] = [
  {
    id: "band.mix",
    title: "Mix & Output",
    short: "Mix",
    color: FIRE,
    hint: "bus · morph · scope · performance",
    modules: [
      m("mixer", "Fire Mixer", "Mix", FIRE, "band.mix", "Mix & Output"),
      m("morph", "Morph Pad", "Morph", FIRE, "band.mix", "Mix & Output"),
      m("output", "Output · Scope", "Scope", FIRE, "band.mix", "Mix & Output"),
      m("performance", "Performance", "Perf", FIRE, "band.mix", "Mix & Output"),
    ],
  },
  {
    id: "band.sources",
    title: "Sources",
    short: "Src",
    color: "#ff9a6b",
    hint: "oscillators · spectral warp",
    modules: [
      m("osc.a", "Oscillator A", "Osc A", FIRE, "band.sources", "Sources"),
      m("osc.b", "Oscillator B", "Osc B", "#ff9a6b", "band.sources", "Sources"),
      m("osc.c", "Oscillator C", "Osc C", "#ffcf5c", "band.sources", "Sources"),
      m("fire.sec.warp", "Spectral Warp", "Warp", "#ffcf5c", "band.sources", "Sources"),
    ],
  },
  {
    id: "band.tone",
    title: "Tone",
    short: "Tone",
    color: FIRE,
    hint: "unison · filter · envelopes",
    modules: [
      m("mixer.unison", "Mixer · Unison", "Uni", FIRE, "band.tone", "Tone"),
      m("filter", "Filter", "Filt", FIRE, "band.tone", "Tone"),
      m("env.amp", "Amp Envelope", "Amp", GRN, "band.tone", "Tone"),
      m("env.mod", "Mod Envelope", "Mod", "#9be564", "band.tone", "Tone"),
      m("env.filt", "Filter Envelope", "FEnv", "#5ce0a0", "band.tone", "Tone"),
    ],
  },
  {
    id: "band.mod",
    title: "Modulation",
    short: "Mod",
    color: ICE,
    hint: "lfos · fm · pitch · matrix · arp",
    modules: [
      m("lfo.1", "LFO 1", "LFO1", ICE, "band.mod", "Modulation"),
      m("lfo.2", "LFO 2", "LFO2", ICE, "band.mod", "Modulation"),
      m("fm", "FM · Ring", "FM", FIRE, "band.mod", "Modulation"),
      m("pitch", "Pitch · Glide", "Pitch", FIRE, "band.mod", "Modulation"),
      m("matrix", "Modulation Matrix", "Mtx", GRN, "band.mod", "Modulation"),
      m("arp", "Arpeggiator", "Arp", FIRE, "band.mod", "Modulation"),
    ],
  },
  {
    id: "band.fx",
    title: "FX",
    short: "FX",
    color: "#e070ff",
    hint: "drive through spectral",
    modules: [
      m("fx.drive", "Drive · Punch", "Drive", FIRE, "band.fx", "FX"),
      m("fx.phaser", "Phaser", "Phase", "#e070ff", "band.fx", "FX"),
      m("fx.chorus", "Chorus", "Chor", "#5ce0c8", "band.fx", "FX"),
      m("fx.delay", "Delay", "Dly", ICE, "band.fx", "FX"),
      m("fx.reverb", "Reverb", "Rev", "#a8b4ff", "band.fx", "FX"),
      m("fx.spectral", "Spectral", "Spec", "#c98bff", "band.fx", "FX"),
    ],
  },
  {
    id: "band.perf",
    title: "Performance Tools",
    short: "Perf",
    color: "#ffb35c",
    hint: "macros · trance gate",
    modules: [
      m("macros", "Macros", "Macro", "#ffb35c", "band.perf", "Performance Tools"),
      m("gate", "Trance Gate", "Gate", ICE, "band.perf", "Performance Tools"),
    ],
  },
];

export const FIRE_MODULES: FireModuleEntry[] = FIRE_BANDS.flatMap((b) => b.modules);

export const FIRE_MODULE_BY_ID = new Map(FIRE_MODULES.map((mod) => [mod.id, mod]));

/** Signal-path theater nodes — story order, not every module. */
export type SignalNodeId = "osc" | "filter" | "drive" | "fx" | "mix" | "scope";

export type SignalNode = {
  id: SignalNodeId;
  label: string;
  color: string;
  /** Primary module to open / focus */
  moduleId: FireModuleId;
  hint: string;
};

export const SIGNAL_PATH: SignalNode[] = [
  { id: "osc", label: "OSC", color: FIRE, moduleId: "osc.a", hint: "Wavetable sources" },
  { id: "filter", label: "FILTER", color: FIRE, moduleId: "filter", hint: "Tone sculpt" },
  { id: "drive", label: "DRIVE", color: "#ff8f5c", moduleId: "fx.drive", hint: "Magma forge" },
  { id: "fx", label: "FX", color: "#e070ff", moduleId: "fx.delay", hint: "Space & time" },
  { id: "mix", label: "MIX", color: "#ffcf5c", moduleId: "mixer", hint: "Bus console" },
  { id: "scope", label: "SCOPE", color: "#7cff5a", moduleId: "output", hint: "Master trace" },
];
