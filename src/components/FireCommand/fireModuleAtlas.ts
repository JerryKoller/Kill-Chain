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
    short: "Src",
    color: FC_BAND.sources,
    hint: "oscillators · warp · chip · noise · sub",
    modules: [
      m("osc.a", "Oscillator A", "Osc A", FC.oscA, "band.sources", "Sources", "Primary wavetable voice", "OscA"),
      m("osc.b", "Oscillator B", "Osc B", FC.oscB, "band.sources", "Sources", "Secondary wavetable voice", "OscB"),
      m("osc.c", "Oscillator C", "Osc C", FC.oscC, "band.sources", "Sources", "Tertiary wavetable voice", "OscC"),
      m("fire.sec.warp", "Spectral Warp", "Warp", FC.warp, "band.sources", "Sources", "Spectral morph engine", "Warp"),
      m("chip", "Chip · Acid", "Chip", FC.chip, "band.sources", "Sources", "8-bit / acid grit", "Chip"),
      m("noise", "Noise Bed", "Noise", FC.noise, "band.sources", "Sources", "Texture / noise floor", "Nois"),
      m("sub", "Sub Osc", "Sub", FC.sub, "band.sources", "Sources", "Low-end foundation", "Sub"),
    ],
  },
  {
    id: "band.tone",
    title: "Tone",
    short: "Tone",
    color: FC_BAND.tone,
    hint: "unison · life · filter · envelopes · pluck",
    modules: [
      m("mixer.unison", "Unison", "Uni", FC.unison, "band.tone", "Tone", "Voice stack / detune spread", "Uni"),
      m("analog.life", "Analog Life", "Analog Life", FC.analogLife, "band.tone", "Tone", "Organic behavior engine", "Life"),
      m("filter", "Filter", "Filter", FC.filter, "band.tone", "Tone", "Spectral blade / cutoff", "Filt"),
      m("env.amp", "Amp Envelope", "Amp Env", FC.envAmp, "band.tone", "Tone", "Breath contour", "Amp"),
      m("env.mod", "Mod Envelope", "Mod Env", FC.envMod, "band.tone", "Tone", "Morph weaver", "ModE"),
      m("env.filt", "Filter Envelope", "Filt Env", FC.envFilt, "band.tone", "Tone", "Cutoff sweep", "FltE"),
      m("pluck", "Pluck Gate", "Pluck", FC.pluck, "band.tone", "Tone", "Vactrol strike", "Plk"),
    ],
  },
  {
    id: "band.mod",
    title: "Modulation",
    short: "Mod",
    color: FC_BAND.mod,
    hint: "lfos · fm · fm rack · pitch · matrix · arp",
    modules: [
      m("lfo.1", "LFO 1", "Phase Aurora", FC.lfo, "band.mod", "Modulation", "Primary cyclic modulator", "Lfo1"),
      m("lfo.2", "LFO 2", "Twin Orbit", FC.lfo2, "band.mod", "Modulation", "Secondary cyclic modulator", "Lfo2"),
      m("fm", "FM · Ring", "Sideband Forge", FC.fm, "band.mod", "Modulation", "FM / ring sidebands", "FM"),
      m("fm.rack", "FM Rack · Vector", "Vector Lattice", FC.fmRack, "band.mod", "Modulation", "Vector FM rack", "FmRk"),
      m("pitch", "Pitch · Glide", "Glide Horizon", FC.pitch, "band.mod", "Modulation", "Portamento / pitch bend", "Ptch"),
      m("matrix", "Modulation Matrix", "Patch Loom", FC.matrix, "band.mod", "Modulation", "Route sources → destinations", "Mtx"),
      m("arp", "Arpeggiator", "Cascade Orbit", FC.arp, "band.mod", "Modulation", "Note cascade / patterns", "Arp"),
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
    short: "Mix",
    color: FC_BAND.mix,
    hint: "bus · morph · width · glue · air · scope · live",
    modules: [
      m("mixer", "Fire Mixer", "Mixer", FC.mixer, "band.mix", "Mix & Output", "Sum deck / bus levels", "Mix"),
      m("morph", "Morph Pad", "Morph", FC.morph, "band.mix", "Mix & Output", "Quad loom patch blend", "Mrp"),
      m("width", "Stereo Width", "Width", FC.width, "band.mix", "Mix & Output", "Side horizon", "Wid"),
      m("glue", "Bus Glue", "Glue", FC.glue, "band.mix", "Mix & Output", "Press anvil compression", "Glu"),
      m("air", "Air", "Air", FC.air, "band.mix", "Mix & Output", "Sky shelf tone", "Air"),
      m("output", "Output · Scope", "Scope", FC.scope, "band.mix", "Mix & Output", "Lumen trace", "Out"),
      m("performance", "Live Controls", "Live", FC.performance, "band.mix", "Mix & Output", "Stage pulse", "Liv"),
    ],
  },
  {
    id: "band.perf",
    title: "Macros & Gate",
    short: "Perf",
    color: FC_BAND.perf,
    hint: "macros · gate · harmony · scale · chord · humanize · scenes",
    modules: [
      m("macros", "Macros", "Macros", FC.macros, "band.perf", "Macros & Gate", "Helm quartet", "Mcr"),
      m("gate", "Trance Gate", "Gate", FC.gate, "band.perf", "Macros & Gate", "Rhythm shutter", "Gte"),
      m("harmony", "Harmony", "Harmony", FC.harmony, "band.perf", "Macros & Gate", "Kin halo companions", "Hrm"),
      m("scale", "Scale Lock", "Scale", FC.scale, "band.perf", "Macros & Gate", "Key lattice", "Scl"),
      m("chord", "Chord Memory", "Chord", FC.chord, "band.perf", "Macros & Gate", "Stack vault", "Chd"),
      m("human", "Humanize", "Human", FC.human, "band.perf", "Macros & Gate", "Feel grain", "Hum"),
      m("scenes", "Scenes", "Scenes", FC.scenes, "band.perf", "Macros & Gate", "Orbit vault", "Scn"),
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
  { id: "drive", label: "DRIVE", color: FC.drive, moduleId: "fx.drive", hint: "Shape crucible" },
  { id: "age", label: "AGE", color: FC.vintage, moduleId: "fx.vintage", hint: "Oxide archive" },
  { id: "fx", label: "FX", color: FC_BAND.fx, moduleId: "fx.delay", hint: "Ping cascade" },
  { id: "mix", label: "MIX", color: FC_BAND.mix, moduleId: "mixer", hint: "Sum deck" },
  { id: "scope", label: "SCOPE", color: FC.scope, moduleId: "output", hint: "Lumen Trace" },
];

/** True unless explicitly disabled in moduleEnable. */
export function isModuleEnabled(enable: Record<string, boolean> | undefined, id: string): boolean {
  return enable?.[id] !== false;
}
