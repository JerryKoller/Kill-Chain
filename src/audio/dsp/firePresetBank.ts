/**
 * firePresetBank — Fire Command factory preset types + curated library export.
 *
 * 420 hand-authored curated presets (Wave 1: 20 × 11 categories, Wave 2: +200):
 *   - fireCuratedBank.ts — authored for the current synth (absolute Q, ladder/svf, ops4, warp, LPG)
 */

import type { FirePatch } from "./FireCommandSynth";
import { cloneFirePatch } from "./FireCommandSynth";
import { CURATED_PRESETS } from "./fireCuratedBank";

export type PresetCategory =
  | "Bass" | "Lead" | "Pluck" | "Pad" | "Keys" | "Arp" | "FX" | "Atmos"
  | "Vintage" | "Chip" | "FM";

export const PRESET_CATEGORIES: PresetCategory[] = [
  "Bass", "Lead", "Pluck", "Pad", "Keys", "Arp", "FX", "Atmos",
  "Vintage", "Chip", "FM",
];

/** Loose arp shape (matches the store's ArpSettings without importing it — avoids a cycle). */
export interface PresetArp {
  enabled?: boolean;
  /** Mirrors the engine's ArpMode — factory presets may use any mode the
   *  arpeggiator supports, not just the original four. */
  mode?:
    | "up" | "down" | "updown" | "downup"
    | "converge" | "diverge" | "pedal"
    | "random" | "walk" | "asplayed";
  bpm?: number;
  division?: "1/4" | "1/8" | "1/8T" | "1/16" | "1/16T" | "1/32";
  octaves?: number;
  gate?: number;
  hold?: boolean;
}

export interface FirePreset {
  id: string;
  name: string;
  desc: string;
  category: PresetCategory;
  patch: FirePatch;
  arp?: PresetArp;
}

/** Deep factory patch — never share DEFAULT nests across presets / NS. */
export const P = (over: Partial<FirePatch>): FirePatch => cloneFirePatch(over);

/**
 * Curated factory bank — 420 presets across 11 categories (Wave 1 + Wave 2).
 * Authored directly for current engine ranges; no legacy remaster pass.
 */
export const GENERATED_PRESETS: FirePreset[] = CURATED_PRESETS;
