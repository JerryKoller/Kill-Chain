import { create } from "zustand";
import {
  advance,
  applyAnswer,
  createAdaptiveState,
  isComplete,
  nextQuestion,
  rewindOne,
  type AdaptiveProbe,
  type AdaptiveState,
} from "@/lib/adaptiveEngine";
import { NEUTRAL_PARAMS, normalizeParams, type SoundParams } from "@/audio/types";
import { useAudioStore } from "@/state/audioStore";

export type CalibMode = "quick" | "standard" | "deep";

export const MODE_STEPS: Record<CalibMode, number> = {
  quick: 12,
  standard: 30,
  deep: 60,
};

export type GenreId = "general" | "electronic" | "jazz" | "cinema" | "podcast" | "gaming" | "pop";

export interface GenrePresetSlot {
  id: GenreId;
  name: string;
  blurb: string;
  params: SoundParams;
}

export const DEFAULT_GENRES: GenrePresetSlot[] = [
  { id: "general",    name: "General",    blurb: "Everyday balance",          params: { ...NEUTRAL_PARAMS } },
  { id: "electronic", name: "Electronic", blurb: "EDM, techno, synth",        params: { ...NEUTRAL_PARAMS } },
  { id: "jazz",       name: "Jazz",       blurb: "Acoustic, intimate",        params: { ...NEUTRAL_PARAMS } },
  { id: "cinema",     name: "Cinema",     blurb: "Film & dialogue",           params: { ...NEUTRAL_PARAMS } },
  { id: "podcast",    name: "Podcast",    blurb: "Voice clarity",             params: { ...NEUTRAL_PARAMS } },
  { id: "gaming",     name: "Gaming",     blurb: "Spatial cues + impact",     params: { ...NEUTRAL_PARAMS } },
  { id: "pop",        name: "Pop",        blurb: "Polished modern radio",     params: { ...NEUTRAL_PARAMS } },
];

const STORAGE_KEY = "audio-playground.calibration.v2";

/** Result of the pure-tone hearing test. Thresholds are dBFS slider levels
 *  (relative sensitivity only — NOT clinical dB HL); a missing frequency
 *  means the tone was never heard at the maximum test level. */
export interface HearingTestRecord {
  testedAt: number;
  left: Partial<Record<number, number>>;
  right: Partial<Record<number, number>>;
}

interface PersistShape {
  activeGenre: GenreId;
  slots: GenrePresetSlot[];
  hearingTest?: HearingTestRecord | null;
}

function loadPersist(): PersistShape {
  const fallback: PersistShape = {
    activeGenre: "general",
    slots: DEFAULT_GENRES.map((g) => ({ ...g, params: { ...g.params } })),
    hearingTest: null,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as PersistShape;
    if (!Array.isArray(p.slots)) return fallback;
    // Clamp persisted params to legal ranges (corrupt / hand-edited storage
    // fed straight into the DSP otherwise).
    p.slots = p.slots.map((s) => ({ ...s, params: normalizeParams(s.params) }));
    // Backfill any missing genres so adding new defaults doesn't break.
    const have = new Set(p.slots.map((s) => s.id));
    for (const g of DEFAULT_GENRES) {
      if (!have.has(g.id)) p.slots.push({ ...g, params: { ...g.params } });
    }
    return p;
  } catch {
    return fallback;
  }
}

function savePersist(shape: PersistShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch { /* ignore */ }
}

interface CalibrationState {
  mode: CalibMode;
  state: AdaptiveState;
  current: AdaptiveProbe | null;
  preview: "A" | "B" | "none";
  done: boolean;
  totalSteps: number;

  /** Blind A/B test mode - randomizes the labels so A and B don't bias. */
  blind: boolean;
  /** When blind, swap[step] = true means visible "A" is actually internal B. */
  blindSwap: boolean[];

  activeGenre: GenreId;
  slots: GenrePresetSlot[];

  /** Most recent hearing-test result (persisted). */
  hearingTest: HearingTestRecord | null;
  setHearingTest: (r: HearingTestRecord | null) => void;

  start: (mode?: CalibMode) => void;
  answer: (visibleChoice: "A" | "B") => void;
  /** Repeat the same axis with a fresh probe — magnitude advances naturally. */
  skip: () => void;
  /** Undo the most recent answer and re-show the question. */
  back: () => void;
  canGoBack: () => boolean;
  setPreview: (p: "A" | "B" | "none") => void;
  setBlind: (b: boolean) => void;

  setProfileAxis: <K extends keyof SoundParams>(key: K, value: SoundParams[K]) => void;
  reset: () => void;
  result: () => SoundParams;

  // Per-genre profile slots
  setActiveGenre: (id: GenreId) => void;
  saveToActiveGenre: (params: SoundParams) => void;
  loadActiveGenre: () => SoundParams;
}

const persist = loadPersist();

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  mode: "standard",
  state: createAdaptiveState(MODE_STEPS.standard),
  current: null,
  preview: "none",
  done: false,
  totalSteps: MODE_STEPS.standard,

  blind: false,
  blindSwap: [],

  activeGenre: persist.activeGenre,
  slots: persist.slots,
  hearingTest: persist.hearingTest ?? null,

  setHearingTest: (r) => {
    set({ hearingTest: r });
    savePersist({ activeGenre: get().activeGenre, slots: get().slots, hearingTest: r });
  },

  start: (mode = get().mode) => {
    const steps = MODE_STEPS[mode];
    const state = createAdaptiveState(steps);
    // Seed from the live Sculptor chain so opening Calibration (or restarting)
    // builds on the user's current tuning instead of wiping back to NEUTRAL.
    state.profile = { ...useAudioStore.getState().params };
    const current = nextQuestion(state);
    set({
      mode,
      state,
      current,
      preview: "none",
      done: false,
      totalSteps: steps,
      blindSwap: [],
    });
  },

  answer: (visibleChoice) => {
    const { state, current, blind, blindSwap } = get();
    if (!current) return;
    // Decide whether to swap based on blind mode (deterministic per-step).
    let internalChoice = visibleChoice;
    let swap = false;
    if (blind) {
      // Deterministic per step so a back-button doesn't flip the question.
      swap = blindSwap[state.history.length] ?? Math.random() < 0.5;
      if (swap) {
        internalChoice = visibleChoice === "A" ? "B" : "A";
      }
    }
    const next = applyAnswer(state, current, internalChoice);
    const newSwap = [...blindSwap];
    newSwap[state.history.length] = swap;
    if (isComplete(next)) {
      set({
        state: next,
        current: null,
        done: true,
        preview: "none",
        blindSwap: newSwap,
      });
      return;
    }
    const q = nextQuestion(next);
    set({ state: next, current: q, preview: "none", blindSwap: newSwap });
  },

  skip: () => {
    // Advance the cursor so Skip shows a genuinely different question rather
    // than re-rolling the same slot.
    const next = advance(get().state);
    const q = nextQuestion(next);
    set({ state: next, current: q, preview: "none" });
  },

  back: () => {
    const { state, blindSwap } = get();
    if (state.history.length === 0) return;
    const prevState = rewindOne(state);
    const q = nextQuestion(prevState);
    const newSwap = blindSwap.slice(0, -1);
    set({ state: prevState, current: q, preview: "none", done: false, blindSwap: newSwap });
  },

  canGoBack: () => get().state.history.length > 0,

  setPreview: (p) => set({ preview: p }),

  setBlind: (b) => set({ blind: b }),

  setProfileAxis: (key, value) => {
    const { state } = get();
    const profile = { ...state.profile, [key]: value };
    set({ state: { ...state, profile } });
  },

  reset: () => {
    const state = createAdaptiveState(get().totalSteps);
    set({ state, current: null, done: false, preview: "none", blindSwap: [] });
  },

  result: () => get().state.profile,

  // Per-genre slots
  setActiveGenre: (id) => {
    set({ activeGenre: id });
    savePersist({ activeGenre: id, slots: get().slots, hearingTest: get().hearingTest });
  },
  saveToActiveGenre: (params) => {
    const slots = get().slots.map((s) =>
      s.id === get().activeGenre ? { ...s, params: { ...params } } : s,
    );
    set({ slots });
    savePersist({ activeGenre: get().activeGenre, slots, hearingTest: get().hearingTest });
  },
  loadActiveGenre: () => {
    const slot = get().slots.find((s) => s.id === get().activeGenre);
    return slot ? { ...slot.params } : { ...NEUTRAL_PARAMS };
  },
}));
