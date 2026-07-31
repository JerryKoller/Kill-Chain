/**
 * Remaster factory presets for the current Fire Command synth.
 *
 * Curated banks were authored when resonance looked like a 0..1 "amount".
 * The live engine treats filterResonance as absolute Q (0.1..28), so nearly
 * every factory patch sat below Butterworth (~0.7) and sounded thin / similar.
 * This pass remaps legacy Q, injects category character, and keeps stacks
 * clip-safe without flattening uniqueness.
 */

import type { FirePatch } from "./FireCommandSynth";
import type { FirePreset, PresetCategory } from "./firePresetBank";
import { WAVETABLE_IDS } from "./wavetables";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rnd(h: { n: number }): number {
  h.n = (Math.imul(h.n, 1664525) + 1013904223) >>> 0;
  return (h.n & 0xffff) / 0xffff;
}

function pick<T>(h: { n: number }, arr: readonly T[]): T {
  return arr[Math.floor(rnd(h) * arr.length) % arr.length]!;
}

/** Map legacy 0..1-ish resonance authorship into musical Q. */
export function remasterResonance(
  q: number,
  category: PresetCategory,
  name: string,
  h: { n: number },
): number {
  if (!Number.isFinite(q)) q = 0.7;
  // Already in the musical absolute-Q range used by Studio knobs.
  if (q >= 1.45) return clamp(q, 0.1, 18);

  const n = clamp(q, 0, 1.2) / 1.2;
  const acid = /acid|squelch|scream|303|reso|zap|screech/i.test(name);
  const soft =
    /pad|silk|warm|soft|ambient|cloud|wash|drone|bloom/i.test(name)
    || category === "Pad"
    || category === "Atmos";

  if (acid) return clamp(7 + n * 9 + rnd(h) * 1.5, 6, 16);
  if (soft) return clamp(0.85 + n * 3.2 + rnd(h) * 0.6, 0.7, 5);
  if (category === "Bass") return clamp(1.6 + n * 8.5 + rnd(h) * 1.2, 1.2, 14);
  if (category === "Lead" || category === "Arp") return clamp(2 + n * 9 + rnd(h) * 1.4, 1.4, 15);
  if (category === "Pluck" || category === "Keys") return clamp(1.3 + n * 7 + rnd(h), 1, 12);
  if (category === "FM") return clamp(1.5 + n * 6.5 + rnd(h), 1.2, 12);
  if (category === "Chip") return clamp(1.1 + n * 5.5 + rnd(h), 0.9, 10);
  if (category === "Vintage") return clamp(1.4 + n * 6 + rnd(h), 1, 11);
  if (category === "FX") return clamp(1.8 + n * 10 + rnd(h) * 2, 1.2, 16);
  return clamp(1.2 + n * 7 + rnd(h) * 1.5, 0.9, 12);
}

function diversifyTable(current: string, h: { n: number }, prefer: readonly string[]): string {
  if (prefer.length && (current === "saw" || current === "basic" || current === "pulse")) {
    if (rnd(h) < 0.55) return pick(h, prefer);
  }
  if (rnd(h) < 0.18) return pick(h, WAVETABLE_IDS);
  return current;
}

function spiceCategory(p: FirePatch, category: PresetCategory, name: string, h: { n: number }): void {
  const acid = /acid|squelch|303/i.test(name);

  switch (category) {
    case "Bass": {
      if ((p.filterModel ?? "biquad") === "biquad" && rnd(h) < 0.7) {
        p.filterModel = rnd(h) < 0.55 ? "ladder" : "svf";
      }
      if ((p.filterDrive ?? 0) < 0.15 && rnd(h) < 0.65) p.filterDrive = 0.2 + rnd(h) * 0.35;
      if ((p.subLevel ?? 0) < 0.12 && rnd(h) < 0.55) p.subLevel = 0.25 + rnd(h) * 0.35;
      if (acid) {
        p.filterEnvAmount = Math.max(p.filterEnvAmount ?? 0, 0.75);
        p.chipAcidMix = Math.max(p.chipAcidMix ?? 0, 0.45 + rnd(h) * 0.35);
        p.mono = true;
      }
      if (rnd(h) < 0.25) p.driveMode = pick(h, ["tube", "soft", "fold"] as const);
      break;
    }
    case "Lead": {
      if ((p.filterModel ?? "biquad") === "biquad" && rnd(h) < 0.55) {
        p.filterModel = rnd(h) < 0.5 ? "ladder" : "svf";
      }
      if (rnd(h) < 0.28) p.hardSync = true;
      if (rnd(h) < 0.35 && (p.pulseDuty ?? 0.5) === 0.5) p.pulseDuty = 0.12 + rnd(h) * 0.76;
      if ((p.drive ?? 0) < 0.12 && rnd(h) < 0.5) {
        p.drive = 0.18 + rnd(h) * 0.35;
        p.driveMode = pick(h, ["tube", "soft", "fuzz", "fold"] as const);
      }
      if (rnd(h) < 0.22) {
        p.warpMode = pick(h, ["scramble", "subharmonic", "classic"] as const);
        p.warpAmount = 0.55 + rnd(h) * 0.45;
        p.warpStretch = (rnd(h) * 2 - 1) * 0.55;
      }
      break;
    }
    case "Pluck": {
      if (!(p.lpgOn) && rnd(h) < 0.45) {
        p.lpgOn = true;
        p.lpgDecay = 0.2 + rnd(h) * 0.55;
        p.lpgColor = 0.45 + rnd(h) * 0.45;
      }
      if ((p.filterEnvAmount ?? 0) < 0.35) p.filterEnvAmount = 0.45 + rnd(h) * 0.4;
      if (rnd(h) < 0.3) p.filterCarve = pick(h, ["odds", "evens", "formant", "fundamental"] as const);
      break;
    }
    case "Pad":
    case "Atmos": {
      if ((p.unison ?? 1) < 3 && rnd(h) < 0.55) {
        p.unison = pick(h, [3, 5, 5, 7] as const);
        p.unisonDetune = 10 + Math.round(rnd(h) * 16);
        p.unisonWidth = 0.55 + rnd(h) * 0.4;
      }
      if ((p.chorusMix ?? 0) < 0.15 && rnd(h) < 0.6) p.chorusMix = 0.22 + rnd(h) * 0.28;
      if ((p.reverbMix ?? 0) < 0.12 && rnd(h) < 0.55) p.reverbMix = 0.18 + rnd(h) * 0.25;
      if ((p.drift ?? 0) < 0.08 && rnd(h) < 0.5) p.drift = 0.15 + rnd(h) * 0.35;
      if (rnd(h) < 0.25) {
        p.warpMode = "classic";
        p.warpTilt = (rnd(h) * 2 - 1) * 0.4;
        p.warpAmount = 0.4 + rnd(h) * 0.5;
      }
      break;
    }
    case "Keys": {
      if ((p.chorusMix ?? 0) < 0.1 && rnd(h) < 0.45) p.chorusMix = 0.15 + rnd(h) * 0.25;
      if (rnd(h) < 0.3) p.oscBDetune = Math.round(6 + rnd(h) * 14);
      break;
    }
    case "Arp": {
      if ((p.filterEnvAmount ?? 0) < 0.35) p.filterEnvAmount = 0.4 + rnd(h) * 0.45;
      if (rnd(h) < 0.4) p.filterModel = pick(h, ["ladder", "svf", "biquad"] as const);
      if ((p.delayMix ?? 0) < 0.1 && rnd(h) < 0.5) {
        p.delayMix = 0.15 + rnd(h) * 0.2;
        p.delayFeedback = 0.25 + rnd(h) * 0.25;
      }
      break;
    }
    case "FX": {
      if (rnd(h) < 0.55) {
        p.warpMode = pick(h, ["scramble", "subharmonic", "brickwall"] as const);
        p.warpStretch = (rnd(h) * 2 - 1) * 0.85;
        p.warpTilt = (rnd(h) * 2 - 1) * 0.75;
        p.warpComb = 0.2 + rnd(h) * 0.65;
        p.warpAmount = 0.7 + rnd(h) * 0.3;
      }
      if (rnd(h) < 0.35) {
        p.ringAmount = Math.max(p.ringAmount ?? 0, 0.2 + rnd(h) * 0.4);
        p.ringFreq = 40 + rnd(h) * 900;
      }
      if (rnd(h) < 0.3) p.noiseLevel = Math.max(p.noiseLevel ?? 0, 0.08 + rnd(h) * 0.22);
      if (rnd(h) < 0.22) {
        p.spectralMode = pick(h, ["smear", "shift", "gate"] as const);
        p.spectralMix = 0.2 + rnd(h) * 0.25;
        p.spectralAmount = 0.4 + rnd(h) * 0.4;
      }
      break;
    }
    case "Vintage": {
      if ((p.cassetteGen ?? 0) < 0.1) p.cassetteGen = 0.25 + rnd(h) * 0.4;
      if ((p.wowFlutter ?? 0) < 0.08) p.wowFlutter = 0.12 + rnd(h) * 0.3;
      if ((p.vhsColor ?? 0) < 0.05 && rnd(h) < 0.5) p.vhsColor = 0.1 + rnd(h) * 0.3;
      if ((p.ageMacro ?? 0) < 0.1) p.ageMacro = 0.2 + rnd(h) * 0.4;
      if (rnd(h) < 0.4) p.driveMode = pick(h, ["tube", "soft"] as const);
      break;
    }
    case "Chip": {
      p.oscATable = diversifyTable(p.oscATable, h, ["chip", "pulse", "basic"]);
      if (rnd(h) < 0.55) p.hardSync = true;
      p.pulseDuty = 0.08 + rnd(h) * 0.84;
      if ((p.chipAcidMix ?? 0) < 0.2) p.chipAcidMix = 0.35 + rnd(h) * 0.45;
      if (rnd(h) < 0.35) p.chipNoise = pick(h, ["white", "periodic", "nes", "gb"] as const);
      break;
    }
    case "FM": {
      if (rnd(h) < 0.65) {
        p.fmEngine = "ops4";
        p.fmAlg = Math.floor(rnd(h) * 8);
        p.fmOp2Ratio = pick(h, [0.5, 1, 1.5, 2, 3, 5, 7]);
        p.fmOp3Ratio = pick(h, [0.5, 1, 2, 3, 4, 6]);
        p.fmOp4Ratio = pick(h, [1, 2, 3, 5, 7, 11]);
        p.fmFeedback = rnd(h) * 0.55;
        p.fmOp2Level = 0.35 + rnd(h) * 0.65;
        p.fmOp3Level = 0.2 + rnd(h) * 0.6;
        p.fmOp4Level = 0.1 + rnd(h) * 0.5;
      }
      if ((p.fmAmount ?? 0) < 0.2) p.fmAmount = 0.25 + rnd(h) * 0.4;
      break;
    }
  }

  // Shared wavetable diversity — break the saw/basic monoculture.
  const tableBias =
    category === "Bass" ? ["growl", "saw", "harmonic", "fold"] as const
    : category === "Lead" ? ["saw", "pulse", "sync", "metallic", "fold"] as const
    : category === "Pad" || category === "Atmos" ? ["vocal", "harmonic", "bell", "additive", "formant2"] as const
    : category === "Keys" ? ["additive", "bell", "basic", "harmonic"] as const
    : category === "Pluck" ? ["bell", "pulse", "harmonic", "basic"] as const
    : WAVETABLE_IDS;
  p.oscATable = diversifyTable(p.oscATable, h, tableBias);
  if ((p.oscBLevel ?? 0) > 0.05) p.oscBTable = diversifyTable(p.oscBTable, h, tableBias);
}

function tameOscSum(p: FirePatch): void {
  const sum = (p.oscALevel ?? 0) + (p.oscBLevel ?? 0) + (p.oscCLevel ?? 0);
  // Leave headroom for sub/noise/unison — factory stacks were routinely >2.
  if (sum > 1.85) {
    const s = 1.75 / sum;
    p.oscALevel = (p.oscALevel ?? 0) * s;
    p.oscBLevel = (p.oscBLevel ?? 0) * s;
    p.oscCLevel = (p.oscCLevel ?? 0) * s;
  }
  if ((p.masterGain ?? 0.72) > 0.78) p.masterGain = 0.75;
  else if (p.masterGain == null) p.masterGain = 0.7;
}

/**
 * Remaster one factory preset in place (clone first if you need isolation).
 * Returns the same object for chaining.
 */
export function remasterFactoryPreset(preset: FirePreset): FirePreset {
  const h = { n: hashId(preset.id + ":" + preset.category) };
  const p = preset.patch;

  p.filterResonance = remasterResonance(p.filterResonance ?? 0.7, preset.category, preset.name, h);

  // Env→filter bite often authored assuming louder resonance; lift mild amounts.
  if ((p.filterEnvAmount ?? 0) > 0.35 && (p.filterEnvAmount ?? 0) < 0.9) {
    p.filterEnvAmount = clamp((p.filterEnvAmount ?? 0) * (1.05 + rnd(h) * 0.12), -1, 1);
  }

  spiceCategory(p, preset.category, preset.name, h);
  tameOscSum(p);

  // Keep wet tails musical but present — many presets relied on FX identity.
  if (preset.category === "Pad" || preset.category === "Atmos") {
    p.reverbMix = Math.min(0.48, Math.max(p.reverbMix ?? 0, 0.12));
  }

  return preset;
}

/** Remaster an entire factory bank (mutates patches). */
export function remasterFactoryBank(presets: FirePreset[]): FirePreset[] {
  for (const preset of presets) remasterFactoryPreset(preset);
  return presets;
}
