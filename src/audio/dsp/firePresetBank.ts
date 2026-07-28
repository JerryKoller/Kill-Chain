/**
 * firePresetBank — Fire Command factory preset types + curated library export.
 *
 * 440 hand-authored curated presets (40 per category × 11 categories):
 *   - fireCuratedBank.ts: Vol.1 — 220 presets (fc-* IDs)
 *   - fireCuratedBankVol2.ts: Vol.2 — 220 presets (fc2-* IDs)
 */

import {
  DEFAULT_FIRE_PATCH,
  type FirePatch,
} from "./FireCommandSynth";
import { CURATED_PRESETS } from "./fireCuratedBank";
import { CURATED_PRESETS_V2 } from "./fireCuratedBankVol2";

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

/** Curated factory bank — 40 unique presets × 11 categories = 440 total. */
export const GENERATED_PRESETS = [...CURATED_PRESETS, ...CURATED_PRESETS_V2];
