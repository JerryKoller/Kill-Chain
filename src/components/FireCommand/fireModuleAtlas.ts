/**
 * Fire Command module atlas — static map of bands → modules for the
 * Command Map, Signal Path Theater, and Focus Mode. Display/layout only.
 */

import { FC, FC_BAND } from "./fireColors";

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
    id: "band.sources",
    title: "Sources",
    short: "Src",
    color: FC_BAND.sources,
    hint: "oscillators · spectral warp · chip",
    modules: [
      m("osc.a", "Oscillator A", "Osc A", FC.oscA, "band.sources", "Sources"),
      m("osc.b", "Oscillator B", "Osc B", FC.oscB, "band.sources", "Sources"),
      m("osc.c", "Oscillator C", "Osc C", FC.oscC, "band.sources", "Sources"),
      m("fire.sec.warp", "Spectral Warp", "Warp", FC.warp, "band.sources", "Sources"),
      m("chip", "Chip · Acid", "Chip", FC.chip, "band.sources", "Sources"),
    ],
  },
  {
    id: "band.tone",
    title: "Tone",
    short: "Tone",
    color: FC_BAND.tone,
    hint: "unison · analog life · filter · envelopes",
    modules: [
      m("mixer.unison", "Unison · Sub", "Uni", FC.unison, "band.tone", "Tone"),
      m("analog.life", "Analog Life", "Life", FC.analogLife, "band.tone", "Tone"),
      m("filter", "Filter", "Filt", FC.filter, "band.tone", "Tone"),
      m("env.amp", "Amp Envelope", "Amp", FC.envAmp, "band.tone", "Tone"),
      m("env.mod", "Mod Envelope", "Mod", FC.envMod, "band.tone", "Tone"),
      m("env.filt", "Filter Envelope", "FEnv", FC.envFilt, "band.tone", "Tone"),
    ],
  },
  {
    id: "band.mod",
    title: "Modulation",
    short: "Mod",
    color: FC_BAND.mod,
    hint: "lfos · fm · fm rack · pitch · matrix · arp",
    modules: [
      m("lfo.1", "LFO 1", "LFO1", FC.lfo, "band.mod", "Modulation"),
      m("lfo.2", "LFO 2", "LFO2", FC.lfo, "band.mod", "Modulation"),
      m("fm", "FM · Ring", "FM", FC.fm, "band.mod", "Modulation"),
      m("fm.rack", "FM Rack · Vector", "Rack", FC.fmRack, "band.mod", "Modulation"),
      m("pitch", "Pitch · Glide", "Pitch", FC.pitch, "band.mod", "Modulation"),
      m("matrix", "Modulation Matrix", "Mtx", FC.matrix, "band.mod", "Modulation"),
      m("arp", "Arpeggiator", "Arp", FC.arp, "band.mod", "Modulation"),
    ],
  },
  {
    id: "band.fx",
    title: "FX",
    short: "FX",
    color: FC_BAND.fx,
    hint: "drive through vintage age · spectral",
    modules: [
      m("fx.drive", "Drive · Punch", "Drive", FC.drive, "band.fx", "FX"),
      m("fx.vintage", "Vintage Age", "Age", FC.vintage, "band.fx", "FX"),
      m("fx.phaser", "Phaser", "Phase", FC.phaser, "band.fx", "FX"),
      m("fx.chorus", "Chorus", "Chor", FC.chorus, "band.fx", "FX"),
      m("fx.delay", "Delay", "Dly", FC.delay, "band.fx", "FX"),
      m("fx.reverb", "Reverb", "Rev", FC.reverb, "band.fx", "FX"),
      m("fx.spectral", "Spectral", "Spec", FC.spectral, "band.fx", "FX"),
    ],
  },
  {
    id: "band.mix",
    title: "Mix & Output",
    short: "Mix",
    color: FC_BAND.mix,
    hint: "bus · morph · scope · performance",
    modules: [
      m("mixer", "Fire Mixer", "Mix", FC.mixer, "band.mix", "Mix & Output"),
      m("morph", "Morph Pad", "Morph", FC.morph, "band.mix", "Mix & Output"),
      m("output", "Output · Scope", "Scope", FC.scope, "band.mix", "Mix & Output"),
      m("performance", "Live Controls", "Live", FC.performance, "band.mix", "Mix & Output"),
    ],
  },
  {
    id: "band.perf",
    title: "Macros & Gate",
    short: "Perf",
    color: FC_BAND.perf,
    hint: "macros · trance gate",
    modules: [
      m("macros", "Macros", "Macro", FC.macros, "band.perf", "Macros & Gate"),
      m("gate", "Trance Gate", "Gate", FC.gate, "band.perf", "Macros & Gate"),
    ],
  },
];

export const FIRE_MODULES: FireModuleEntry[] = FIRE_BANDS.flatMap((b) => b.modules);

export const FIRE_MODULE_BY_ID = new Map(FIRE_MODULES.map((mod) => [mod.id, mod]));

/** Signal-path theater nodes — story order, not every module. */
export type SignalNodeId = "osc" | "filter" | "drive" | "age" | "fx" | "mix" | "scope";

export type SignalNode = {
  id: SignalNodeId;
  label: string;
  color: string;
  /** Primary module to open / focus */
  moduleId: FireModuleId;
  hint: string;
};

export const SIGNAL_PATH: SignalNode[] = [
  { id: "osc", label: "OSC", color: FC_BAND.sources, moduleId: "osc.a", hint: "Wavetable sources" },
  { id: "filter", label: "FILTER", color: FC_BAND.tone, moduleId: "filter", hint: "Tone sculpt" },
  { id: "drive", label: "DRIVE", color: FC.drive, moduleId: "fx.drive", hint: "Magma forge" },
  { id: "age", label: "AGE", color: FC.vintage, moduleId: "fx.vintage", hint: "Tape · VHS · dust" },
  { id: "fx", label: "FX", color: FC_BAND.fx, moduleId: "fx.delay", hint: "Space & time" },
  { id: "mix", label: "MIX", color: FC_BAND.mix, moduleId: "mixer", hint: "Bus console" },
  { id: "scope", label: "SCOPE", color: FC.scope, moduleId: "output", hint: "Master trace" },
];
