/**
 * firePresetBank — Fire Command factory preset types + curated library export.
 *
 * The old ~1000 seeded near-duplicates were replaced by 220 hand-authored
 * presets in fireCuratedBank.ts (20 per category).
 */

import {
  DEFAULT_FIRE_PATCH,
  type FirePatch,
} from "./FireCommandSynth";

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

export const P = (over: Partial<FirePatch>): FirePatch => ({ ...DEFAULT_FIRE_PATCH, ...over });

/** Curated factory bank — 20 unique presets × 11 categories. */
export { CURATED_PRESETS as GENERATED_PRESETS } from "./fireCuratedBank";
