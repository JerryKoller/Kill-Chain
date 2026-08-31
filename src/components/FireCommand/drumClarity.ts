/**
 * Drum Bay Clarity — rich step model + helpers.
 * Legacy number velocity migrates to DrumStep via coerceDrumStep.
 */

import type { DrumLane } from "@/audio/dsp/FireDrumKit";
import { DRUM_LANES } from "@/audio/dsp/FireDrumKit";

export type DrumStep = {
  /** 0 = off; else 0..1 velocity */
  vel: number;
  accent?: boolean;
  /** 0..1, default 1 */
  prob?: number;
  /** 1..4 repeats inside the step */
  ratchet?: number;
  /** -1..1 fraction of a 16th (early/late) */
  micro?: number;
};

export type DrumFeel = "grid" | "pocket" | "loose" | "drunk" | "custom";

export type FillPersonality =
  | "snareRoll"
  | "tomDescent"
  | "kickBurst"
  | "hatRush"
  | "breakbeat"
  | "trap"
  | "minimal";

export type DrumLaneMix = {
  level: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Polymeter: steps before wrapping (1..128). 0 / missing = pattern length */
  length: number;
  direction: 1 | -1;
  /** 1 = normal, 2 = double rate, 0.5 = half */
  rate: number;
  offset: number;
  feel: DrumFeel;
  /**
   * Per-lane swing offset added to the global drum swing, -0.3..+0.3 of a
   * half-step.
   *
   * Global swing moved every lane together, so the classic move of swinging
   * hats while the kick stays dead straight was impossible — the whole kit
   * had to lean or none of it did. Negative values pull the off-beats EARLY
   * (pushed feel), positive values lay them back.
   */
  swing?: number;
  /**
   * Flam: a grace hit `flam` × step-duration before each hit (0 = off).
   * Classic snare/tom articulation that step grids normally can't express
   * without hand-placing a second lane.
   */
  flam?: number;
  /** Grace-hit level relative to the main hit (0..1, default 0.55). */
  flamVel?: number;
};

export const DEFAULT_LANE_MIX = (): DrumLaneMix => ({
  level: 1,
  pan: 0,
  muted: false,
  solo: false,
  length: 0,
  direction: 1,
  rate: 1,
  offset: 0,
  feel: "grid",
  swing: 0,
  flam: 0,
  flamVel: 0.55,
});

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function emptyStep(): DrumStep {
  return { vel: 0 };
}

export function onStep(vel = 1, extra?: Partial<DrumStep>): DrumStep {
  return { vel: clamp01(vel), ...extra };
}

/** Accept legacy number or DrumStep. */
export function coerceDrumStep(raw: unknown): DrumStep {
  if (raw == null) return emptyStep();
  if (typeof raw === "number") {
    const vel = clamp01(Number(raw) || 0);
    return vel > 0 ? { vel } : emptyStep();
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const vel = clamp01(Number(o.vel) || 0);
    if (vel <= 0) return emptyStep();
    const step: DrumStep = { vel };
    if (o.accent === true) step.accent = true;
    if (typeof o.prob === "number") step.prob = clamp01(o.prob);
    if (typeof o.ratchet === "number") step.ratchet = Math.max(1, Math.min(4, Math.round(o.ratchet)));
    if (typeof o.micro === "number") step.micro = Math.max(-1, Math.min(1, o.micro));
    return step;
  }
  return emptyStep();
}

export function stepVel(s: DrumStep | number | undefined | null): number {
  if (s == null) return 0;
  if (typeof s === "number") return clamp01(s);
  return s.vel > 0 ? clamp01(s.vel) : 0;
}

export function isStepOn(s: DrumStep | number | undefined | null): boolean {
  return stepVel(s) > 0;
}

export function effectiveVel(s: DrumStep): number {
  if (s.vel <= 0) return 0;
  let v = s.vel;
  if (s.accent) v = Math.min(1, v * 1.15);
  return clamp01(v);
}

export function sanitizeStepArray(raw: unknown, total: number): DrumStep[] {
  const out: DrumStep[] = Array.from({ length: total }, () => emptyStep());
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < Math.min(total, raw.length); i++) {
    out[i] = coerceDrumStep(raw[i]);
  }
  return out;
}

export function cloneSteps(src: DrumStep[], total: number): DrumStep[] {
  const out: DrumStep[] = Array.from({ length: total }, () => emptyStep());
  for (let i = 0; i < total; i++) {
    const s = src[i % Math.max(1, src.length)];
    out[i] = s ? { ...s } : emptyStep();
  }
  return out;
}

export function mapDrumSteps(
  src: Record<DrumLane, DrumStep[]>,
  fn: (lane: DrumLane, steps: DrumStep[]) => DrumStep[],
): Record<DrumLane, DrumStep[]> {
  const out = {} as Record<DrumLane, DrumStep[]>;
  for (const l of DRUM_LANES) {
    out[l.id] = fn(l.id, src[l.id] ?? []);
  }
  return out;
}

/** Feel Grain character → timing / velocity jitter scales (relative to patch humanize). */
export function feelScales(feel: DrumFeel): { timing: number; velocity: number } {
  switch (feel) {
    case "grid": return { timing: 0, velocity: 0 };
    case "pocket": return { timing: 0.35, velocity: 0.25 };
    case "loose": return { timing: 0.7, velocity: 0.55 };
    case "drunk": return { timing: 1.15, velocity: 0.9 };
    case "custom": return { timing: 1, velocity: 1 };
  }
}

/** Map master step index through lane polymeter settings. */
export function laneLocalStep(
  masterStep: number,
  mix: DrumLaneMix | undefined,
  patternLen: number,
): number {
  const len = mix?.length && mix.length > 0 ? Math.min(patternLen, Math.max(1, Math.floor(mix.length))) : patternLen;
  const rate = mix?.rate && mix.rate > 0 ? mix.rate : 1;
  const dir = mix?.direction === -1 ? -1 : 1;
  const off = mix?.offset ?? 0;
  const advanced = Math.floor(masterStep * rate) + off;
  let local = ((advanced % len) + len) % len;
  if (dir < 0) local = (len - 1 - local + len) % len;
  return local;
}

export function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
