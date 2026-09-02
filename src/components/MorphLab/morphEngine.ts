import {
  NEUTRAL_PARAMS,
  SOUND_PARAM_META,
  normalizeParams,
  type SoundParams,
} from "@/audio/types";
import { PRESETS, morphPresets } from "@/audio/presets";

/**
 * Morph Lab engine helpers — pure math + persistence for the 4-corner
 * bilinear morph surface. No React, no audio: the view drives everything.
 */

export type Corner = "a" | "b" | "c" | "d";
export const CORNERS: Corner[] = ["a", "b", "c", "d"];

/** A corner is either a library preset (by id) or a frozen params snapshot. */
export type CornerSource =
  | { kind: "preset"; id: string }
  | { kind: "snapshot"; label: string; params: SoundParams };

export type MotionPattern = "off" | "orbit" | "figure8" | "drift" | "gesture";

export interface MotionConfig {
  pattern: MotionPattern;
  /** Path revolutions per second (or gesture speed when pattern = gesture). */
  rate: number;
  /** 0..1 — radius of the path / scale of the gesture around its centroid. */
  depth: number;
}

/** Recorded puck gesture: flat [x0,y0,x1,y1,…] pairs sampled ~30 Hz. */
export interface GestureData {
  points: number[];
  durationMs: number;
  cx: number;
  cy: number;
}

export interface MorphLabConfig {
  corners: Record<Corner, CornerSource>;
  locks: string[];
  motion: MotionConfig;
  gesture: GestureData | null;
  pos: { x: number; y: number };
}

const STORAGE_KEY = "killchain.morphlab.v1";

export const GESTURE_SAMPLE_MS = 33;
export const GESTURE_MAX_POINTS = 900; // ~30 s of recording

export const MOTION_RATE_MIN = 0.02;
export const MOTION_RATE_MAX = 0.5;

export const DEFAULT_MOTION: MotionConfig = { pattern: "off", rate: 0.12, depth: 0.7 };

export const DEFAULT_CORNERS: Record<Corner, CornerSource> = {
  a: { kind: "preset", id: "vinyl" },
  b: { kind: "preset", id: "crystal" },
  c: { kind: "preset", id: "bass-arena" },
  d: { kind: "preset", id: "immersive" },
};

export const ALL_PARAM_KEYS: (keyof SoundParams)[] = SOUND_PARAM_META.map((m) => m.key);

const VALID_KEYS = new Set<string>(ALL_PARAM_KEYS);

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

/** Bilinear corner weights for a puck at (x, y) in [0..1]². */
export function bilinearWeights(x: number, y: number): Record<Corner, number> {
  return {
    a: (1 - x) * (1 - y),
    b: x * (1 - y),
    c: (1 - x) * y,
    d: x * y,
  };
}

/**
 * Full bilinear morph of the four corner param sets at puck position (x, y).
 */
export function morphAt(
  cornerParams: Record<Corner, SoundParams>,
  x: number,
  y: number,
): SoundParams {
  const w = bilinearWeights(x, y);
  return morphPresets(CORNERS.map((c) => ({ params: cornerParams[c], weight: w[c] })));
}

/**
 * Strip locked keys from a full param set, returning the partial that is
 * safe to push into the engine (locked params keep their live values).
 */
export function unlockKeys(
  full: SoundParams,
  locks: ReadonlySet<string>,
): { partial: Partial<SoundParams>; keys: (keyof SoundParams)[] } {
  const partial: Partial<SoundParams> = {};
  const keys: (keyof SoundParams)[] = [];
  for (const k of ALL_PARAM_KEYS) {
    if (locks.has(k)) continue;
    partial[k] = full[k];
    keys.push(k);
  }
  return { partial, keys };
}

/** Deterministic point on an auto-pilot path. Phase is in radians. */
export function motionPoint(
  pattern: MotionPattern,
  phase: number,
  depth: number,
): { x: number; y: number } {
  const r = 0.48 * clamp01(depth);
  switch (pattern) {
    case "orbit":
      return { x: 0.5 + r * Math.cos(phase), y: 0.5 + r * Math.sin(phase) };
    case "figure8":
      return {
        x: 0.5 + r * Math.sin(phase),
        y: 0.5 + r * Math.sin(phase) * Math.cos(phase),
      };
    case "drift": {
      // Incommensurate sines — a slow wander that never exactly repeats.
      const x = 0.5 + r * (0.62 * Math.sin(0.61 * phase) + 0.38 * Math.sin(1.137 * phase + 2.11));
      const y = 0.5 + r * (0.62 * Math.cos(0.473 * phase) + 0.38 * Math.sin(0.891 * phase + 0.63));
      return { x, y };
    }
    default:
      return { x: 0.5, y: 0.5 };
  }
}

/** Map the rate slider onto a gesture playback speed multiplier (0.25×–2.5×). */
export function gestureSpeed(rate: number): number {
  const t = (clampRange(rate, MOTION_RATE_MIN, MOTION_RATE_MAX) - MOTION_RATE_MIN) /
    (MOTION_RATE_MAX - MOTION_RATE_MIN);
  return 0.25 + t * 2.25;
}

/** Sample a recorded gesture at `elapsedMs` (wraps), scaled by depth around its centroid. */
export function sampleGesture(
  g: GestureData,
  elapsedMs: number,
  depth: number,
): { x: number; y: number } {
  const n = g.points.length >> 1;
  if (n === 0) return { x: 0.5, y: 0.5 };
  let x: number;
  let y: number;
  if (n === 1 || g.durationMs <= 0) {
    x = g.points[0];
    y = g.points[1];
  } else {
    const t = (((elapsedMs % g.durationMs) + g.durationMs) % g.durationMs) / g.durationMs;
    const f = t * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const frac = f - i;
    x = g.points[i * 2] * (1 - frac) + g.points[(i + 1) * 2] * frac;
    y = g.points[i * 2 + 1] * (1 - frac) + g.points[(i + 1) * 2 + 1] * frac;
  }
  const d = clamp01(depth);
  return {
    x: clamp01(g.cx + (x - g.cx) * d),
    y: clamp01(g.cy + (y - g.cy) * d),
  };
}

/** Build a GestureData from raw recorded pairs (computes centroid + duration). */
export function buildGesture(points: number[], durationMs: number): GestureData | null {
  const n = points.length >> 1;
  if (n < 2) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += points[i * 2];
    cy += points[i * 2 + 1];
  }
  return {
    points: points.slice(0, GESTURE_MAX_POINTS * 2),
    durationMs: Math.max(GESTURE_SAMPLE_MS, durationMs),
    cx: cx / n,
    cy: cy / n,
  };
}

// ── Persistence (new key — never touches existing saved data) ──

function sanitizeCorner(raw: unknown): CornerSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "preset" && typeof r.id === "string") {
    return { kind: "preset", id: r.id };
  }
  if (r.kind === "snapshot" && r.params && typeof r.params === "object") {
    return {
      kind: "snapshot",
      label: typeof r.label === "string" ? r.label.slice(0, 40) : "SNAPSHOT",
      params: normalizeParams(r.params as Partial<SoundParams>),
    };
  }
  return null;
}

export function loadMorphConfig(): MorphLabConfig {
  const fallback: MorphLabConfig = {
    corners: { ...DEFAULT_CORNERS },
    locks: [],
    motion: { ...DEFAULT_MOTION },
    gesture: null,
    pos: { x: 0.5, y: 0.5 },
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MorphLabConfig>;
    const corners = { ...DEFAULT_CORNERS };
    for (const c of CORNERS) {
      const got = sanitizeCorner(parsed.corners?.[c]);
      if (got) corners[c] = got;
    }
    const locks = Array.isArray(parsed.locks)
      ? parsed.locks.filter((k): k is string => typeof k === "string" && VALID_KEYS.has(k))
      : [];
    const m = parsed.motion;
    const motion: MotionConfig = {
      // Motion always restores disarmed — opening the tab must stay silent.
      pattern: "off",
      rate: clampRange(Number(m?.rate ?? DEFAULT_MOTION.rate), MOTION_RATE_MIN, MOTION_RATE_MAX),
      depth: clamp01(Number(m?.depth ?? DEFAULT_MOTION.depth)),
    };
    let gesture: GestureData | null = null;
    const g = parsed.gesture;
    if (g && Array.isArray(g.points) && g.points.length >= 4 && g.points.length % 2 === 0) {
      const pts = g.points
        .slice(0, GESTURE_MAX_POINTS * 2)
        .map((v) => clamp01(Number(v)));
      gesture = buildGesture(pts, Number(g.durationMs) || pts.length * GESTURE_SAMPLE_MS);
    }
    const pos = {
      x: clamp01(Number(parsed.pos?.x ?? 0.5)),
      y: clamp01(Number(parsed.pos?.y ?? 0.5)),
    };
    return { corners, locks, motion, gesture, pos };
  } catch (err) {
    console.warn("[morphlab] failed to load config:", err);
    return fallback;
  }
}

let saveTimer: number | null = null;
let pendingCfg: MorphLabConfig | null = null;

function writeMorphConfig(cfg: MorphLabConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch (err) {
    console.warn("[morphlab] failed to persist config:", err);
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Morph Lab", err),
    );
  }
}

/** Debounced write — call freely on every config change. */
export function saveMorphConfig(cfg: MorphLabConfig): void {
  if (typeof window === "undefined") return;
  pendingCfg = cfg;
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const next = pendingCfg;
    pendingCfg = null;
    if (next) writeMorphConfig(next);
  }, 400);
}

/** Flush a pending debounce (drag-end / unmount) so the last layout isn't lost. */
export function flushMorphConfig(): void {
  if (typeof window === "undefined") return;
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingCfg == null) return;
  const next = pendingCfg;
  pendingCfg = null;
  writeMorphConfig(next);
}

/** Resolve a corner source to its params, falling back to the first preset. */
export function resolveCornerParams(
  source: CornerSource,
  presetById: ReadonlyMap<string, { params: SoundParams }>,
): SoundParams {
  if (source.kind === "snapshot") return source.params;
  return presetById.get(source.id)?.params ?? PRESETS[0]?.params ?? NEUTRAL_PARAMS;
}
