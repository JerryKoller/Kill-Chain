/**
 * Tone differentiation helpers — MSEG evaluation, unison formations,
 * envelope curves, and live voice telemetry shapes shared by FireCommandSynth
 * and StageViz panels.
 */

export type EnvCurve = "lin" | "exp" | "log" | "s" | "step" | "overshoot" | "spring";

export type ModEnvPoint = {
  /** Absolute time from note-on (seconds), monotonic non-decreasing. */
  t: number;
  /** Level 0..1 (bipolar destinations scale this separately). */
  level: number;
  /** Curve INTO this point from the previous one. */
  curve: EnvCurve;
};

export type UnisonDistribution = "linear" | "center" | "edge" | "gaussian" | "alternating";
export type UnisonPhaseMode = "locked" | "random" | "even" | "alternating";
export type UnisonTemporalMode = "ltr" | "center" | "random";
export type AmpModel = "vca" | "gate";
export type AmpRetrigger = "zero" | "current" | "legato";
export type FilterDrivePos = "pre" | "post";
export type FilterCarveMode = "off" | "fundamental" | "odds" | "evens" | "noise" | "formant";
export type FilterModel = "biquad" | "ladder" | "svf";
export type LpgModel = "fast" | "classic" | "slow" | "aged" | "sticky" | "bright";
export type FilterSlope = 1 | 2 | 3;

export type ToneEnvTelemetry = {
  /** 0..1 current envelope output (amp / mod / filt / lpg). */
  level: number;
  /** Normalized 0..1 playhead through the visual envelope. */
  phase: number;
  stage: "idle" | "attack" | "decay" | "sustain" | "release" | "strike" | "ring" | "decay_out";
  releasing: boolean;
  startedAt: number;
  releaseAt: number | null;
};

export type ToneVoiceTelemetry = {
  voiceCount: number;
  amp: ToneEnvTelemetry;
  mod: ToneEnvTelemetry;
  filt: ToneEnvTelemetry;
  pluck: ToneEnvTelemetry;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Apply a 0..1 segment progress through a named curve. */
export function applyEnvCurve(u: number, curve: EnvCurve): number {
  const t = clamp(u, 0, 1);
  switch (curve) {
    case "exp":
      return 1 - Math.exp(-4.5 * t);
    case "log":
      return Math.log1p(9 * t) / Math.log(10);
    case "s":
      return t * t * (3 - 2 * t);
    case "step":
      return t < 0.5 ? 0 : 1;
    case "overshoot": {
      const o = Math.sin(t * Math.PI) * 0.18;
      return clamp(t + o, 0, 1.15);
    }
    case "spring": {
      const d = Math.exp(-3 * t) * Math.sin(t * Math.PI * 3) * 0.22;
      return clamp(t + d, 0, 1.2);
    }
    case "lin":
    default:
      return t;
  }
}

/** Classic ADSR → 4-point MSEG (attack peak, sustain start, sustain end placeholder handled at eval). */
export function adsrToModEnvPoints(
  attack: number,
  decay: number,
  sustain: number,
  _release: number,
): ModEnvPoint[] {
  const a = Math.max(0.001, attack);
  const d = Math.max(0.001, decay);
  const s = clamp(sustain, 0, 1);
  return [
    { t: 0, level: 0, curve: "lin" },
    { t: a, level: 1, curve: "exp" },
    { t: a + d, level: s, curve: "log" },
  ];
}

export function defaultModEnvPoints(): ModEnvPoint[] {
  return adsrToModEnvPoints(0.02, 0.5, 0.3, 0.4);
}

/** Ensure points are sorted, clamped, and capped at 8. */
export function normalizeModEnvPoints(raw: ModEnvPoint[] | undefined | null): ModEnvPoint[] {
  if (!raw || raw.length < 2) return defaultModEnvPoints();
  const pts = raw
    .slice(0, 8)
    .map((p, i) => ({
      t: Math.max(0, Number.isFinite(p.t) ? p.t : i * 0.1),
      level: clamp(Number.isFinite(p.level) ? p.level : 0, 0, 1),
      curve: (p.curve ?? "lin") as EnvCurve,
    }))
    .sort((a, b) => a.t - b.t);
  pts[0] = { ...pts[0], t: 0 };
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t < pts[i - 1].t) pts[i].t = pts[i - 1].t;
  }
  return pts;
}

/**
 * Evaluate MSEG while note is held. Sustain holds at the last point's level
 * after reaching it (sustainIndex points at the sustain node).
 */
export function evalModEnvHeld(
  points: ModEnvPoint[],
  sustainIndex: number,
  elapsed: number,
  loop: boolean,
): { level: number; phase: number; stage: ToneEnvTelemetry["stage"] } {
  const pts = normalizeModEnvPoints(points);
  const susIdx = clamp(Math.round(sustainIndex), 0, pts.length - 1);
  const susT = pts[susIdx].t;
  const lastT = pts[pts.length - 1].t || 0.001;

  let t = Math.max(0, elapsed);
  if (loop && t > lastT && lastT > 0.001) {
    const loopStart = pts[Math.min(1, susIdx)].t;
    const span = Math.max(0.001, lastT - loopStart);
    t = loopStart + ((t - loopStart) % span);
  }

  if (t <= 0) return { level: pts[0].level, phase: 0, stage: "attack" };
  if (t >= susT) {
    return {
      level: pts[susIdx].level,
      phase: clamp(susT / Math.max(lastT, susT, 0.001), 0, 1),
      stage: "sustain",
    };
  }

  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t || i === pts.length - 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const dur = Math.max(0.0001, b.t - a.t);
      const u = applyEnvCurve((t - a.t) / dur, b.curve);
      const level = a.level + (b.level - a.level) * u;
      const stage: ToneEnvTelemetry["stage"] =
        i <= 1 ? "attack" : t < susT ? "decay" : "sustain";
      return { level: clamp(level, 0, 1.2), phase: clamp(t / Math.max(lastT, 0.001), 0, 1), stage };
    }
  }
  return { level: pts[pts.length - 1].level, phase: 1, stage: "sustain" };
}

export function evalModEnvRelease(
  points: ModEnvPoint[],
  sustainIndex: number,
  levelAtRelease: number,
  releaseSec: number,
  sinceRelease: number,
): { level: number; phase: number; stage: ToneEnvTelemetry["stage"] } {
  const r = Math.max(0.001, releaseSec);
  if (sinceRelease >= r) return { level: 0, phase: 1, stage: "release" };
  const u = applyEnvCurve(sinceRelease / r, "exp");
  return {
    level: clamp(levelAtRelease * (1 - u), 0, 1),
    phase: clamp(0.75 + 0.25 * (sinceRelease / r), 0, 1),
    stage: "release",
  };
}

/** Character stamps → structural MSEG point sets. */
export function modEnvPresetPoints(
  id: "still" | "nudge" | "sweep" | "cross" | "dive" | "weave",
): { points: ModEnvPoint[]; sustainIndex: number; attack: number; decay: number; sustain: number; release: number } {
  switch (id) {
    case "still":
      return {
        points: [
          { t: 0, level: 0, curve: "lin" },
          { t: 0.4, level: 0.08, curve: "lin" },
          { t: 1.2, level: 0.05, curve: "lin" },
        ],
        sustainIndex: 2,
        attack: 0.4,
        decay: 0.8,
        sustain: 0.05,
        release: 0.6,
      };
    case "nudge":
      return {
        points: [
          { t: 0, level: 0, curve: "lin" },
          { t: 0.08, level: 0.45, curve: "exp" },
          { t: 0.35, level: 0.2, curve: "log" },
        ],
        sustainIndex: 2,
        attack: 0.08,
        decay: 0.27,
        sustain: 0.2,
        release: 0.35,
      };
    case "sweep":
      return {
        points: [
          { t: 0, level: 0, curve: "lin" },
          { t: 0.9, level: 1, curve: "s" },
          { t: 1.6, level: 0.55, curve: "log" },
        ],
        sustainIndex: 2,
        attack: 0.9,
        decay: 0.7,
        sustain: 0.55,
        release: 0.8,
      };
    case "cross":
      return {
        points: [
          { t: 0, level: 0, curve: "lin" },
          { t: 0.12, level: 1, curve: "exp" },
          { t: 0.4, level: 0, curve: "lin" },
          { t: 0.7, level: 0.7, curve: "s" },
          { t: 1.1, level: 0.25, curve: "log" },
        ],
        sustainIndex: 4,
        attack: 0.12,
        decay: 0.98,
        sustain: 0.25,
        release: 0.5,
      };
    case "dive":
      return {
        points: [
          { t: 0, level: 0, curve: "lin" },
          { t: 0.04, level: 1, curve: "exp" },
          { t: 0.55, level: 0.05, curve: "log" },
        ],
        sustainIndex: 2,
        attack: 0.04,
        decay: 0.51,
        sustain: 0.05,
        release: 0.7,
      };
    case "weave":
    default:
      return {
        points: [
          { t: 0, level: 0, curve: "lin" },
          { t: 0.15, level: 0.85, curve: "exp" },
          { t: 0.4, level: 0.35, curve: "s" },
          { t: 0.75, level: 0.9, curve: "spring" },
          { t: 1.2, level: 0.4, curve: "log" },
        ],
        sustainIndex: 4,
        attack: 0.15,
        decay: 1.05,
        sustain: 0.4,
        release: 0.55,
      };
  }
}

/** Unison voice positions in -1..+1 with distribution shaping. */
export function unisonPositions(n: number, dist: UnisonDistribution): number[] {
  if (n <= 1) return [0];
  const linear: number[] = [];
  for (let i = 0; i < n; i++) linear.push((i / (n - 1)) * 2 - 1);

  switch (dist) {
    case "center":
      return linear.map((x) => Math.sign(x) * Math.pow(Math.abs(x), 1.65));
    case "edge":
      return linear.map((x) => Math.sign(x) * Math.pow(Math.abs(x), 0.55));
    case "gaussian":
      return linear.map((x) => {
        const g = Math.exp(-2.2 * x * x);
        return x * (0.35 + 0.65 * (1 - g));
      });
    case "alternating":
      return linear.map((x, i) => (i % 2 === 0 ? x * 0.35 : x));
    case "linear":
    default:
      return linear;
  }
}

export function unisonPhaseOffsets(n: number, mode: UnisonPhaseMode, seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    switch (mode) {
      case "random": {
        const r = Math.sin((seed + i * 19.17) * 12.9898) * 43758.5453;
        out.push((r - Math.floor(r)) * Math.PI * 2);
        break;
      }
      case "even":
        out.push((i / Math.max(1, n)) * Math.PI * 2);
        break;
      case "alternating":
        out.push(i % 2 === 0 ? 0 : Math.PI);
        break;
      case "locked":
      default:
        out.push(0);
        break;
    }
  }
  return out;
}

export function unisonDelaySec(
  i: number,
  n: number,
  spreadSec: number,
  mode: UnisonTemporalMode,
  seed: number,
): number {
  const max = clamp(spreadSec, 0, 0.05);
  if (max <= 0.00005 || n <= 1) return 0;
  const pos = n <= 1 ? 0 : i / (n - 1);
  switch (mode) {
    case "center": {
      const mid = (n - 1) / 2;
      return (Math.abs(i - mid) / Math.max(mid, 1)) * max;
    }
    case "random": {
      const r = Math.sin((seed + i * 7.13) * 78.233) * 43758.5453;
      return (r - Math.floor(r)) * max;
    }
    case "ltr":
    default:
      return pos * max;
  }
}

/** Deterministic -1..1 from seed + slot. */
export function voiceIdentityUnit(seed: number, slot: number, channel: number): number {
  const r = Math.sin((seed * 0.001 + slot * 12.9898 + channel * 78.233) * 43758.5453);
  return (r - Math.floor(r)) * 2 - 1;
}

export function lpgModelTimes(model: LpgModel, decay: number, velocity: number): {
  strike: number;
  decay: number;
  colorBias: number;
} {
  const v = clamp(velocity, 0, 1);
  const d = clamp(decay, 0.05, 2.5);
  switch (model) {
    case "fast":
      return { strike: 0.0008 + (1 - v) * 0.001, decay: d * 0.7, colorBias: 0.15 };
    case "slow":
      return { strike: 0.004 + (1 - v) * 0.006, decay: d * 1.35, colorBias: -0.05 };
    case "aged":
      return { strike: 0.002 + (1 - v) * 0.004, decay: d * (0.9 + v * 0.4), colorBias: -0.12 };
    case "sticky":
      return { strike: 0.003 + (1 - v) * 0.008, decay: d * 1.15, colorBias: 0.05 };
    case "bright":
      return { strike: 0.001 + (1 - v) * 0.0015, decay: d * 0.95, colorBias: 0.28 };
    case "classic":
    default:
      return { strike: 0.001 + (1 - v) * 0.002, decay: d, colorBias: 0 };
  }
}

export function idleTelemetry(): ToneEnvTelemetry {
  return {
    level: 0,
    phase: 0,
    stage: "idle",
    releasing: false,
    startedAt: 0,
    releaseAt: null,
  };
}
