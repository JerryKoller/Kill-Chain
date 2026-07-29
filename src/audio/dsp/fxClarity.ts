/**
 * FX Clarity helpers — technical state language, quality/low-protect labels,
 * and shared badge copy for the effects rack.
 */

import type { FirePatch, ModDest } from "@/audio/dsp/FireCommandSynth";

export type FxTechState = "enabled" | "dry" | "bypassed" | "suspended";
export type FxQuality = "eco" | "live" | "high" | "render";
export type LowProtect = "off" | "80" | "120" | "200" | "custom";

export const FX_QUALITY_LABELS: Record<FxQuality, string> = {
  eco: "Eco",
  live: "Live",
  high: "High",
  render: "Render",
};

export const LOW_PROTECT_HZ: Record<Exclude<LowProtect, "custom" | "off">, number> = {
  "80": 80,
  "120": 120,
  "200": 200,
};

export function lowProtectHz(p: FirePatch): number {
  const mode = (p.lowProtect ?? "off") as LowProtect;
  if (mode === "off") return 0;
  if (mode === "custom") return Math.max(20, Math.min(500, p.lowProtectHz ?? 100));
  return LOW_PROTECT_HZ[mode] ?? 0;
}

/** Map moduleEnable + mix/path into Enabled / Dry / Bypassed / Suspended. */
export function fxTechState(
  moduleId: string,
  patch: FirePatch,
  opts: { mix?: number; pathOn?: boolean; suspended?: boolean } = {},
): FxTechState {
  if (opts.suspended) return "suspended";
  const pathOn = opts.pathOn !== false;
  const enabled = patch.moduleEnable?.[moduleId] !== false;
  if (!pathOn || !enabled) return "bypassed";
  const mix = opts.mix;
  if (typeof mix === "number" && mix < 0.02) return "dry";
  return "enabled";
}

export function fxTechBadge(state: FxTechState, thematic?: string): string {
  switch (state) {
    case "enabled":
      return thematic ?? "Enabled";
    case "dry":
      return thematic ?? "Dry";
    case "bypassed":
      return "Bypassed";
    case "suspended":
      return "Suspended";
  }
}

/** Oversampling factor from fxQuality (Drive). */
export function driveOversample(quality: FxQuality | undefined): 1 | 2 | 4 {
  switch (quality) {
    case "eco":
      return 1;
    case "high":
    case "render":
      return 4;
    case "live":
    default:
      return 2;
  }
}

/** Extra ModDest keys used by FX Clarity (also declared on FirePatch ModDest). */
export const FX_MOD_DESTS: ModDest[] = [
  "reverb",
  "delay",
  "chorusMix",
  "phaserMix",
  "drive",
  "spectral",
];
