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
  /** Character / thematic nickname */
  short: string;
  /** Technical one-liner for tooltips / Both label mode */
  subtitle: string;
  /** Short abbreviation for dense chrome */
  abbrev: string;
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
  subtitle = "",
  abbrev = "",
): FireModuleEntry {
  return {
    id,
    title,
    short,
    subtitle: subtitle || short,
    abbrev: abbrev || short.slice(0, 4),
    color,
    bandKey,
    bandTitle,
  };
}

/** Every column targets 7 modules (MOD/FX full). */
export const FIRE_BANDS: FireBandEntry[] = [
  {
    id: "band.sources",
    title: "Sources",
    short: "SRC",
    color: FC_BAND.sources,
    hint: "oscillators · warp · chip · noise · sub",
    modules: [
      m("osc.a", "Oscillator A", "Osc A", FC.oscA, "band.sources", "Sources", "Prime Voice — primary sound identity", "OscA"),
      m("osc.b", "Oscillator B", "Osc B", FC.oscB, "band.sources", "Sources", "Twin Voice — relational companion to A", "OscB"),
      m("osc.c", "Oscillator C", "Osc C", FC.oscC, "band.sources", "Sources", "Depth Voice — pitched body reinforcement", "OscC"),
      m("fire.sec.warp", "Spectral Warp", "Warp", FC.warp, "band.sources", "Sources", "Harmonic Forge — shared spectral transform", "Warp"),
      m("chip", "Chip · Acid", "Chip", FC.chip, "band.sources", "Sources", "Acid Circuit — pulse, grit, retro", "Chip"),
      m("noise", "Noise", "Noise", FC.noise, "band.sources", "Sources", "Grain Storm — stochastic texture", "Nois"),
      m("sub", "Sub", "Sub", FC.sub, "band.sources", "Sources", "Tectonic — protected low-end foundation", "Sub"),
    ],
  },
  {
    id: "band.tone",
    title: "Tone",
    short: "TONE",
    color: FC_BAND.tone,
    hint: "unison · life · filter · envelopes · pluck",
    modules: [
      m("mixer.unison", "Unison", "Unison", FC.unison, "band.tone", "Tone", "Voice stack / detune spread", "Uni"),
      m("analog.life", "Analog Life", "Analog Life", FC.analogLife, "band.tone", "Tone", "Organic behavior engine", "Life"),
      m("filter", "Filter", "Filter", FC.filter, "band.tone", "Tone", "Spectral blade / cutoff", "Filt"),
      m("env.amp", "Amp Envelope", "Amp Env", FC.envAmp, "band.tone", "Tone", "Breath contour", "Amp"),
      m("env.mod", "Mod Envelope", "Morph Env", FC.envMod, "band.tone", "Tone", "Morph weaver", "ModE"),
      m("env.filt", "Filter Envelope", "Filter Env", FC.envFilt, "band.tone", "Tone", "Cutoff sweep", "FltE"),
      m("pluck", "Pluck Gate", "Pluck Gate", FC.pluck, "band.tone", "Tone", "Vactrol strike", "Plk"),
    ],
  },
  {
    id: "band.mod",
    title: "Modulation",
    short: "MOD",
    color: FC_BAND.mod,
    hint: "lfos · fm · fm rack · pitch · matrix · arp",
    modules: [
      m("lfo.1", "LFO 1", "LFO 1", FC.lfo, "band.mod", "Modulation", "Primary cyclic modulator", "Lfo1"),
      m("lfo.2", "LFO 2", "LFO 2", FC.lfo2, "band.mod", "Modulation", "Secondary cyclic modulator", "Lfo2"),
      m("fm", "FM · Ring", "FM · Ring", FC.fm, "band.mod", "Modulation", "FM / ring sidebands", "FM"),
      m("fm.rack", "FM Rack · Vector", "FM Rack", FC.fmRack, "band.mod", "Modulation", "Vector FM rack", "FmRk"),
      m("pitch", "Pitch · Glide", "Pitch", FC.pitch, "band.mod", "Modulation", "Portamento / pitch bend", "Ptch"),
      m("matrix", "Modulation Matrix", "Matrix", FC.matrix, "band.mod", "Modulation", "Route sources → destinations", "Mtx"),
      m("arp", "Arpeggiator", "Arp", FC.arp, "band.mod", "Modulation", "Note cascade / patterns", "Arp"),
    ],
  },
  {
    id: "band.fx",
    title: "FX",
    short: "FX",
    color: FC_BAND.fx,
    hint: "drive through vintage age · spectral",
    modules: [
      m("fx.drive", "Drive", "Drive", FC.drive, "band.fx", "FX", "Shape crucible — waveshaping", "Drv"),
      m("fx.vintage", "Vintage Age", "Age", FC.vintage, "band.fx", "FX", "Oxide archive — tape/bit wear", "Age"),
      m("fx.phaser", "Phaser", "Phaser", FC.phaser, "band.fx", "FX", "Sweep veil", "Phs"),
      m("fx.chorus", "Chorus", "Chorus", FC.chorus, "band.fx", "FX", "Ensemble drift", "Chr"),
      m("fx.delay", "Delay", "Delay", FC.delay, "band.fx", "FX", "Ping cascade", "Dly"),
      m("fx.reverb", "Reverb", "Reverb", FC.reverb, "band.fx", "FX", "Halo vault", "Rev"),
      m("fx.spectral", "Spectral", "Spectral", FC.spectral, "band.fx", "FX", "Bin lattice", "Spc"),
    ],
  },
  {
    id: "band.mix",
    title: "Mix & Output",
    short: "MIX",
    color: FC_BAND.mix,
    hint: "bus · morph · width · glue · air · scope · live",
    modules: [
      m("mixer", "Fire Mixer", "Fire Mixer", FC.mixer, "band.mix", "Mix & Output", "Sum deck / bus levels", "Mix"),
      m("morph", "Morph Pad", "Morph Pad", FC.morph, "band.mix", "Mix & Output", "Quad loom patch blend", "Mrp"),
      m("width", "Stereo Width", "Width", FC.width, "band.mix", "Mix & Output", "Side horizon", "Wid"),
      m("glue", "Bus Glue", "Glue", FC.glue, "band.mix", "Mix & Output", "Press anvil compression", "Glu"),
      m("air", "Air", "Air", FC.air, "band.mix", "Mix & Output", "Sky shelf tone", "Air"),
      m("output", "Output · Scope", "Lumen Trace", FC.scope, "band.mix", "Mix & Output", "Lumen trace", "Out"),
      m("performance", "Live Controls", "Live", FC.performance, "band.mix", "Mix & Output", "Stage pulse", "Liv"),
    ],
  },
  {
    id: "band.perf",
    title: "Performance",
    short: "PERF",
    color: FC_BAND.perf,
    hint: "Control · Rhythm · Pitch",
    modules: [
      m("macros", "Macros", "Macros", FC.macros, "band.perf", "Performance", "Helm quartet", "Mcr"),
      m("scenes", "Scenes", "Scenes", FC.scenes, "band.perf", "Performance", "Orbit vault", "Scn"),
      m("gate", "Trance Gate", "Gate", FC.gate, "band.perf", "Performance", "Rhythm shutter", "Gte"),
      m("human", "Humanize", "Humanize", FC.human, "band.perf", "Performance", "Feel grain", "Hum"),
      m("scale", "Scale Lock", "Scale", FC.scale, "band.perf", "Performance", "Key lattice", "Scl"),
      m("chord", "Chord Memory", "Chord", FC.chord, "band.perf", "Performance", "Stack vault", "Chd"),
      m("harmony", "Harmony", "Harmony", FC.harmony, "band.perf", "Performance", "Kin halo companions", "Hrm"),
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
  /** Monitor tap (analysis only — not a serial processor). */
  monitor?: boolean;
  /** Small badge under the stage label (e.g. Tone around FILTER). */
  badge?: string;
  subtitle?: string;
};

export const SIGNAL_PATH: SignalNode[] = [
  { id: "osc", label: "SOURCES", color: FC_BAND.sources, moduleId: "osc.a", hint: "Wavetable sources" },
  {
    id: "filter",
    label: "FILTER",
    color: FC_BAND.tone,
    moduleId: "filter",
    hint: "Tone sculpt",
    badge: "Tone",
    subtitle: "Filter stage; envelopes / voice surround the path",
  },
  { id: "drive", label: "DRIVE", color: FC.drive, moduleId: "fx.drive", hint: "Shape crucible" },
  { id: "age", label: "AGE", color: FC.vintage, moduleId: "fx.vintage", hint: "Oxide archive" },
  { id: "fx", label: "FX", color: FC_BAND.fx, moduleId: "fx.delay", hint: "Space cascade" },
  { id: "mix", label: "MIX", color: FC_BAND.mix, moduleId: "mixer", hint: "Sum deck" },
  {
    id: "scope",
    label: "SCOPE",
    color: FC.scope,
    moduleId: "output",
    hint: "Lumen Trace monitor",
    monitor: true,
    badge: "Monitor",
    subtitle: "Lumen Trace — analysis tap, not a processor",
  },
];

/** True unless explicitly disabled in moduleEnable. */
export function isModuleEnabled(enable: Record<string, boolean> | undefined, id: string): boolean {
  return enable?.[id] !== false;
}
