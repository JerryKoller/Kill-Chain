/**
 * Modulation routing helpers — map FirePatch params ↔ matrix destinations,
 * sync LFO quick routes, and summarize routes for destination knobs / headers.
 */

import type { LfoDest, ModDest, ModRoute, ModSource } from "@/audio/dsp/FireCommandSynth";
import { MOD_SLOTS } from "@/audio/dsp/FireCommandSynth";

export const MOD_SOURCE_COLORS: Record<ModSource, string> = {
  none: "rgba(255,255,255,0.2)",
  lfo1: "rgba(120,180,255,0.9)",
  lfo2: "rgba(160,140,255,0.9)",
  modenv: "rgba(120,220,180,0.9)",
  velocity: "rgba(255,180,100,0.85)",
  keytrack: "rgba(255,210,120,0.85)",
  macro1: "rgba(255,120,160,0.85)",
  macro2: "rgba(255,140,180,0.85)",
  macro3: "rgba(255,160,200,0.85)",
  macro4: "rgba(255,180,210,0.85)",
  random: "rgba(200,200,120,0.85)",
};

export const MOD_DEST_LABELS: Record<ModDest, string> = {
  none: "—",
  pitch: "Pitch",
  cutoff: "Cutoff",
  resonance: "Reso",
  wtA: "Morph A",
  wtB: "Morph B",
  wtC: "Morph C",
  levelA: "Level A",
  levelB: "Level B",
  levelC: "Level C",
  fm: "FM",
  pan: "Pan",
  volume: "Volume",
  reverb: "Reverb",
  delay: "Delay",
  chorusMix: "Chorus",
  phaserMix: "Phaser",
  drive: "Drive",
  spectral: "Spectral",
};

/** Map a FirePatch numeric key to matrix destination(s) it represents. */
export function paramKeyToModDests(paramKey: string): ModDest[] {
  switch (paramKey) {
    case "filterCutoff":
      return ["cutoff"];
    case "filterResonance":
      return ["resonance"];
    case "pitchEnvAmount":
    case "glide":
      return ["pitch"];
    case "fmAmount":
      return ["fm"];
    case "oscAPos":
      return ["wtA"];
    case "oscBPos":
      return ["wtB"];
    case "oscCPos":
      return ["wtC"];
    case "oscALevel":
      return ["levelA"];
    case "oscBLevel":
      return ["levelB"];
    case "oscCLevel":
      return ["levelC"];
    case "masterGain":
      return ["volume"];
    case "stereoWidth":
      return ["pan"];
    case "reverbMix":
      return ["reverb"];
    case "delayMix":
      return ["delay"];
    case "chorusMix":
      return ["chorusMix"];
    case "phaserMix":
      return ["phaserMix"];
    case "drive":
      return ["drive"];
    case "spectralMix":
    case "spectralAmount":
      return ["spectral"];
    default:
      return [];
  }
}

export function lfoDestToModDest(dest: LfoDest): ModDest | null {
  switch (dest) {
    case "pitch":
      return "pitch";
    case "filter":
      return "cutoff";
    case "pan":
      return "pan";
    case "volume":
      return "volume";
    case "off":
    default:
      return null;
  }
}

export function modDestToLfoDest(dest: ModDest): LfoDest | null {
  switch (dest) {
    case "pitch":
      return "pitch";
    case "cutoff":
      return "filter";
    case "pan":
      return "pan";
    case "volume":
      return "volume";
    default:
      return null;
  }
}

export type KnobModArc = {
  amount: number;
  color: string;
  source: ModSource;
  inverted: boolean;
  unipolar: boolean;
};

/** Active matrix routes affecting a param key (for Dial arcs). */
export function matrixArcsForParam(
  paramKey: string,
  matrix: ModRoute[] | undefined | null,
): KnobModArc[] {
  const dests = paramKeyToModDests(paramKey);
  if (!dests.length || !matrix) return [];
  const out: KnobModArc[] = [];
  for (const r of matrix) {
    if (r.source === "none" || r.dest === "none") continue;
    if (!dests.includes(r.dest)) continue;
    if (Math.abs(r.amount) < 0.04) continue;
    const inverted = !!(r as ModRoute & { invert?: boolean }).invert;
    const unipolar = !!(r as ModRoute & { unipolar?: boolean }).unipolar;
    const amt = inverted ? -r.amount : r.amount;
    out.push({
      amount: amt,
      color: MOD_SOURCE_COLORS[r.source] ?? "rgba(120,180,255,0.8)",
      source: r.source,
      inverted,
      unipolar,
    });
  }
  return out.slice(0, 3);
}

/** Count active routes from a given source. */
export function countRoutesFrom(matrix: ModRoute[] | undefined | null, source: ModSource): number {
  if (!matrix) return 0;
  return matrix.filter((r) => r.source === source && r.dest !== "none" && Math.abs(r.amount) > 0.02).length;
}

export function countRoutesTo(matrix: ModRoute[] | undefined | null, dest: ModDest): number {
  if (!matrix) return 0;
  return matrix.filter((r) => r.dest === dest && r.source !== "none" && Math.abs(r.amount) > 0.02).length;
}

/**
 * Upsert LFO quick-route into matrix: find existing lfoN→quick dest or first empty slot.
 * Clears other quick-dest routes from the same LFO that are only the previous quick dest.
 */
export function upsertLfoQuickRoute(
  matrix: ModRoute[],
  lfo: 1 | 2,
  dest: LfoDest,
  depth: number,
): ModRoute[] {
  const source: ModSource = lfo === 1 ? "lfo1" : "lfo2";
  const next = matrix.map((r) => ({ ...r }));
  const modDest = lfoDestToModDest(dest);
  const amount = dest === "off" ? 0 : Math.max(0.15, Math.min(1, depth || 0.35)) * (depth < 0 ? -1 : 1);

  // Clear previous quick-style routes from this LFO to pitch/cutoff/pan/volume
  // that look like the dedicated quick dest (we'll re-add if needed).
  const quickDests: ModDest[] = ["pitch", "cutoff", "pan", "volume"];
  for (let i = 0; i < next.length; i++) {
    if (next[i].source === source && quickDests.includes(next[i].dest)) {
      // Keep if amount looks like a deliberate matrix edit (we'll still update matching dest)
      if (modDest && next[i].dest === modDest) {
        next[i] = { ...next[i], amount: Math.abs(amount) < 0.02 ? 0.25 : Math.abs(amount) };
        return padMatrix(next);
      }
      next[i] = { source: "none", dest: "none", amount: 0 };
    }
  }

  if (!modDest || dest === "off") return padMatrix(next);

  const empty = next.findIndex((r) => r.source === "none" || r.dest === "none");
  if (empty >= 0) {
    next[empty] = { source, dest: modDest, amount: Math.abs(amount) < 0.02 ? 0.35 : Math.abs(amount) };
  }
  return padMatrix(next);
}

function padMatrix(routes: ModRoute[]): ModRoute[] {
  const out: ModRoute[] = [];
  for (let i = 0; i < MOD_SLOTS; i++) {
    out.push(routes[i] ?? { source: "none", dest: "none", amount: 0 });
  }
  return out;
}

/** If matrix edits a quick dest for lfo1/2, mirror into lfoNDest. */
export function inferLfoDestFromMatrix(matrix: ModRoute[], lfo: 1 | 2): LfoDest | null {
  const source: ModSource = lfo === 1 ? "lfo1" : "lfo2";
  const hit = matrix.find(
    (r) =>
      r.source === source &&
      (r.dest === "pitch" || r.dest === "cutoff" || r.dest === "pan" || r.dest === "volume") &&
      Math.abs(r.amount) > 0.05,
  );
  if (!hit) return "off";
  return modDestToLfoDest(hit.dest);
}
