/**
 * airspaceModes — Cinema / Music voicing for the Airspace browser.
 *
 * Watching a film and listening to an album want different sounds: film mixes
 * live or die on dialog intelligibility, LFE weight and soundstage; music
 * wants tonal balance, punch and air. Each mode is a set of TOGGLEABLE
 * options, each option a small additive overlay on the friendly SoundParams
 * (the same params the Playground sliders drive, so everything stays visible
 * and undoable).
 *
 * Application is additive and reversible: engaging a mode snapshots the
 * pre-mode value of every key it touches, and switching modes / options (or
 * turning the mode off) first restores those baselines, then applies the new
 * overlay on top of whatever the user's sliders say. The overlay only shapes
 * the DSP — routing Airspace through Kill-Chain is what makes it audible.
 */

import type { SoundParams } from "@/audio/types";
import { useAudioStore } from "@/state/audioStore";

export type AirMode = "off" | "cinema" | "music";

export interface AirModeOption {
  id: string;
  label: string;
  desc: string;
  params: Partial<SoundParams>;
  defaultOn: boolean;
}

// Every option ships OFF — a mode is a menu of voicings the user opts into,
// not a preset that rewires the sound the moment it's selected.
export const CINEMA_OPTIONS: AirModeOption[] = [
  {
    id: "dialog",
    label: "Dialog Clarity",
    desc: "Voices cut through the mix — presence lift across 2-4 kHz with sibilance kept in check.",
    params: { vocals: 0.4, presence: 0.3, deEss: 0.2 },
    defaultOn: false,
  },
  {
    id: "impact",
    label: "Deep Impact",
    desc: "Theatrical LFE weight — sub rumble and transient punch for engines, hits and explosions.",
    params: { subBass: 0.5, bass: 0.2, punch: 0.35 },
    defaultOn: false,
  },
  {
    id: "stage",
    label: "Wide Stage",
    desc: "Out-of-head soundstage — width and crossfeed sized for film mixes.",
    params: { width: 0.45, spatial: 0.4, airWidth: 0.3 },
    defaultOn: false,
  },
  {
    id: "bigroom",
    label: "Big Room",
    desc: "A touch of theater acoustics — space and depth around the mix.",
    params: { reverbAmount: 0.22, reverbSize: 0.35, spatial: 0.25 },
    defaultOn: false,
  },
  {
    id: "softhighs",
    label: "Soft Highs",
    desc: "Tames harsh, edgy mixes — smooths 3-6 kHz and sibilance without dulling the sound.",
    params: { presence: -0.25, clarity: -0.2, deEss: 0.3, air: 0.1 },
    defaultOn: false,
  },
  {
    id: "night",
    label: "Night Mode",
    desc: "Late-night dynamics — tames explosions and lifts whispers so one volume works for the whole film.",
    params: { compression: 0.55, mbCompLow: 0.45, subBass: -0.2, punch: -0.2 },
    defaultOn: false,
  },
];

export const MUSIC_OPTIONS: AirModeOption[] = [
  {
    id: "punch",
    label: "Punch & Drive",
    desc: "Snappier transients with a touch of harmonic excitement.",
    params: { punch: 0.3, harmonics: 0.2 },
    defaultOn: false,
  },
  {
    id: "air",
    label: "Air & Sparkle",
    desc: "Opens the top end — space between instruments, detail up top.",
    params: { air: 0.3, sparkle: 0.25 },
    defaultOn: false,
  },
  {
    id: "deepbass",
    label: "Deep Bass",
    desc: "Weight below the kick — sub extension that stays tight.",
    params: { subBass: 0.4, bass: 0.2, mbCompLow: 0.2 },
    defaultOn: false,
  },
  {
    id: "warmth",
    label: "Tape Warmth",
    desc: "Analog glue — gentle saturation, low-mid richness, softened edge.",
    params: { saturation: 0.3, harmonics: 0.15, warmth: 0.2, texture: 0.15 },
    defaultOn: false,
  },
  {
    id: "vocal",
    label: "Vocal Presence",
    desc: "Sits the lead vocal in front of the band.",
    params: { vocals: 0.3, presence: 0.2 },
    defaultOn: false,
  },
  {
    id: "wide",
    label: "Wide Stereo",
    desc: "Broader image above the bass — lows stay anchored.",
    params: { width: 0.35, airWidth: 0.25, subWidth: -0.2 },
    defaultOn: false,
  },
  {
    id: "softhighs-m",
    label: "Soft Highs",
    desc: "Tames harsh masters — smooths the 3-6 kHz edge and sibilance.",
    params: { presence: -0.25, clarity: -0.2, deEss: 0.3 },
    defaultOn: false,
  },
];

export function optionsForMode(mode: AirMode): AirModeOption[] {
  return mode === "cinema" ? CINEMA_OPTIONS : mode === "music" ? MUSIC_OPTIONS : [];
}

export function defaultAirOpts(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const o of [...CINEMA_OPTIONS, ...MUSIC_OPTIONS]) out[o.id] = o.defaultOn;
  return out;
}

const clampParam = (v: number) => Math.max(-1, Math.min(1, v));

/** Pre-mode value of every param key the ACTIVE overlay touched. */
let baseline: Partial<SoundParams> = {};

/**
 * The pre-overlay values of the params the active mode is touching right now
 * (empty when no mode is engaged). ChainSnapshot uses this to capture the
 * UNDERLYING params so re-applying the mode later doesn't stack the overlay.
 */
export function getActiveAirBaseline(): Partial<SoundParams> {
  return { ...baseline };
}

/**
 * Apply (or clear, with mode "off") the Airspace voicing. Idempotent and
 * baseline-safe: always restores the previous overlay before applying the
 * next one, so repeated calls never stack.
 */
export function applyAirMode(mode: AirMode, opts: Record<string, boolean>): void {
  const audio = useAudioStore.getState();
  const cur = audio.params;

  // 1. Restore whatever the previous overlay changed.
  const restored: Partial<SoundParams> = { ...baseline };
  baseline = {};

  // 2. Sum the enabled options' overlays for the new mode.
  const overlay: Partial<SoundParams> = {};
  for (const opt of optionsForMode(mode)) {
    if (!(opts[opt.id] ?? opt.defaultOn)) continue;
    for (const [k, v] of Object.entries(opt.params) as [keyof SoundParams, number][]) {
      overlay[k] = (overlay[k] ?? 0) + v;
    }
  }

  // 3. Snapshot baselines for the new overlay keys (post-restore values) and
  //    build the final patch: baseline + overlay, clamped.
  const patch: Partial<SoundParams> = { ...restored };
  for (const [k, v] of Object.entries(overlay) as [keyof SoundParams, number][]) {
    const base = restored[k] !== undefined ? (restored[k] as number) : cur[k];
    baseline[k] = base;
    patch[k] = clampParam(base + v);
  }

  if (Object.keys(patch).length > 0) audio.setParams(patch);
}
