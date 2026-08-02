/**
 * firePresetBank — Fire Command factory preset types + curated library export.
 *
 * 220 hand-authored curated presets (20 per category × 11 categories):
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
  mode?: "up" | "down" | "updown" | "random" | "asplayed";
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
 * Curated factory bank — 20 unique presets × 11 categories = 220 total.
 * Authored directly for current engine ranges; no legacy remaster pass.
 */
export const GENERATED_PRESETS: FirePreset[] = CURATED_PRESETS;
