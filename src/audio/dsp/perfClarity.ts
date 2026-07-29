/**
 * Performance Clarity — scope badges, dual-state terminology, subgroup copy.
 * Reflects current DSP truth (Phase 1); later phases extend followers / bake.
 */

export type PerfScope = "live" | "sequencer" | "baked";

export type PerfModuleScopeId =
  | "macros"
  | "gate"
  | "scenes"
  | "human"
  | "scale"
  | "chord"
  | "harmony";

/** Current truth: what each Performance module actually touches. */
export const PERF_MODULE_SCOPES: Record<PerfModuleScopeId, readonly PerfScope[]> = {
  macros: ["live", "sequencer"], // mod matrix drives synth for all voices
  gate: ["live", "sequencer"], // audio bus gate
  scenes: ["live", "sequencer"], // full patch recall
  human: ["live", "sequencer", "baked"], // live/seq jitter + piano-roll bake
  scale: ["live"], // noteOn snap (+ arp); seq plays stored MIDI
  chord: ["live"],
  harmony: ["live"],
};

export const PERF_SCOPE_LABEL: Record<PerfScope, string> = {
  live: "LIVE",
  sequencer: "SEQUENCER",
  baked: "BAKED",
};

export const PERF_SCOPE_HINT: Record<PerfScope, string> = {
  live: "Keyboard / MIDI note path",
  sequencer: "Pattern playback or shared synth bus",
  baked: "Permanently written into notes",
};

/** Thematic state + technical gloss (Phase 1 terminology). */
export type PerfTechState =
  | "bypass"
  | "armed"
  | "silent"
  | "empty"
  | "open"
  | "idle"
  | "grid"
  | "live"
  | "orbit"
  | "locked"
  | "active";

export const PERF_TECH_GLOSS: Record<PerfTechState, string> = {
  bypass: "module offline",
  armed: "waiting for notes",
  silent: "wet level at zero",
  empty: "no saved scene",
  open: "scale correction disabled",
  idle: "enabled, no activity",
  grid: "humanize bypassed",
  live: "active under play",
  orbit: "scene bank in motion",
  locked: "correction engaged",
  active: "engaged",
};

/** Format dual-state pill: thematic · gloss */
export function perfDualState(thematic: string, tech: PerfTechState): string {
  return `${thematic} — ${PERF_TECH_GLOSS[tech]}`;
}

export function formatPerfScope(scopes: readonly PerfScope[]): string {
  return scopes.map((s) => PERF_SCOPE_LABEL[s]).join(" · ");
}
