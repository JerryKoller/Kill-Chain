import { create } from "zustand";
import type { DifficultyId } from "@/audio/EarTrainer";

/**
 * Persistent stats for the Golden Ears trainer. Lives in localStorage so
 * progress (XP, best streak, per-band accuracy) survives restarts.
 */
export interface BandStat {
  seen: number;
  correct: number;
}

export interface EarTrainerState {
  xp: number;
  gamesPlayed: number;
  rounds: number;
  correct: number;
  bestStreak: number;
  /** Per-band accuracy keyed by band id — powers the "weak spots" readout. */
  bandStats: Record<string, BandStat>;
  /** Last difficulty the user played, so we can default to it. */
  lastDifficulty: DifficultyId;

  recordRound: (args: {
    bandId: string;
    correct: boolean;
    points: number;
    streak: number;
  }) => void;
  recordGameStart: (difficulty: DifficultyId) => void;
  reset: () => void;
}

const STORAGE_KEY = "audio-playground.eartrainer.v1";

interface Persisted {
  xp: number;
  gamesPlayed: number;
  rounds: number;
  correct: number;
  bestStreak: number;
  bandStats: Record<string, BandStat>;
  lastDifficulty: DifficultyId;
}

const DEFAULTS: Persisted = {
  xp: 0,
  gamesPlayed: 0,
  rounds: 0,
  correct: 0,
  bestStreak: 0,
  bandStats: {},
  lastDifficulty: "trained",
};

function load(): Persisted {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = { ...DEFAULTS, ...JSON.parse(raw) } as Persisted;
    // Corrupt storage must never produce NaN XP / negative counters.
    const nat = (v: unknown): number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    p.xp = nat(p.xp);
    p.gamesPlayed = nat(p.gamesPlayed);
    p.rounds = nat(p.rounds);
    p.correct = nat(p.correct);
    p.bestStreak = nat(p.bestStreak);
    if (!p.bandStats || typeof p.bandStats !== "object" || Array.isArray(p.bandStats)) {
      p.bandStats = {};
    }
    return p;
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(s: Persisted): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const useEarTrainerStore = create<EarTrainerState>((set, get) => ({
  ...load(),

  recordRound: ({ bandId, correct, points, streak }) => {
    const s = get();
    const prev = s.bandStats[bandId] ?? { seen: 0, correct: 0 };
    const bandStats = {
      ...s.bandStats,
      [bandId]: {
        seen: prev.seen + 1,
        correct: prev.correct + (correct ? 1 : 0),
      },
    };
    const next: Persisted = {
      xp: s.xp + Math.max(0, points),
      gamesPlayed: s.gamesPlayed,
      rounds: s.rounds + 1,
      correct: s.correct + (correct ? 1 : 0),
      bestStreak: Math.max(s.bestStreak, streak),
      bandStats,
      lastDifficulty: s.lastDifficulty,
    };
    set(next);
    persist(next);
  },

  recordGameStart: (difficulty) => {
    const s = get();
    const next: Persisted = {
      xp: s.xp,
      gamesPlayed: s.gamesPlayed + 1,
      rounds: s.rounds,
      correct: s.correct,
      bestStreak: s.bestStreak,
      bandStats: s.bandStats,
      lastDifficulty: difficulty,
    };
    set(next);
    persist(next);
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist({ ...DEFAULTS });
  },
}));

/** Derive a rank title + level from XP. */
export function rankForXp(xp: number): {
  level: number;
  title: string;
  levelStart: number;
  nextAt: number;
} {
  const TITLES = [
    "Tin Ear", "Listener", "Tuned In", "Sharp", "Keen",
    "Discerning", "Engineer", "Maestro", "Golden Ears", "Legendary",
  ];
  let level = 1;
  let threshold = 0;
  let step = 150;
  while (xp >= threshold + step && level < 50) {
    threshold += step;
    level += 1;
    step = Math.round(step * 1.25);
  }
  const title = TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))];
  return { level, title, levelStart: threshold, nextAt: threshold + step };
}
