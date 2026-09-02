import { create } from "zustand";
import type { ParametricBand } from "@/audio/types";
import { paramsAreNeutral } from "@/audio/types";
import { getEngine } from "@/audio/AudioEngine";
import { restoreActive } from "@/audio/dsp/Reconstructor";
import { useAudioStore } from "@/state/audioStore";

/**
 * A single user-configurable EQ band in the Sculptor's graphic EQ. Unlike the
 * fixed "friendly" tone knobs, the user can add/remove these freely (1-20),
 * retune their frequency, gain, Q and filter type, and toggle each on/off.
 */
export interface EqBand {
  id: string;
  freq: number; // Hz (20 - 20000)
  gain: number; // dB (-15 - +15) — used by peaking / shelf types
  q: number; // 0.3 - 8
  type: BiquadFilterType;
  enabled: boolean;
  /** v2.1 — dynamic mode: the band's gain rides a sidechain (cuts engage on
   *  flares, boosts fill on dips) instead of sitting static. */
  dynamic?: boolean;
}

export const EQ_MIN_BANDS = 1;
export const EQ_MAX_BANDS = 20;
export const EQ_GAIN_LIMIT = 15; // dB
export const EQ_FREQ_MIN = 20;
export const EQ_FREQ_MAX = 20000;

/** Filter types offered in the band editor. */
export const EQ_TYPES: BiquadFilterType[] = [
  "peaking",
  "lowshelf",
  "highshelf",
  "lowpass",
  "highpass",
  "notch",
];

let bandSeq = 0;
const newId = () => `eq-${Date.now().toString(36)}-${(bandSeq++).toString(36)}`;

/** The starting band layout — a flat 6-band graphic EQ (no audible change). */
function defaultBands(): EqBand[] {
  const freqs = [60, 150, 400, 1000, 3000, 8000];
  return freqs.map((freq) => ({
    id: newId(),
    freq,
    gain: 0,
    q: freq < 200 ? 0.9 : 1.1,
    type: "peaking" as BiquadFilterType,
    enabled: true,
  }));
}

const STORAGE_KEY = "audio-playground.eq.v1";

function load(): EqBand[] {
  if (typeof window === "undefined") return defaultBands();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBands();
    const parsed = JSON.parse(raw) as EqBand[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultBands();
    // Re-issue ids so they're always unique within this session, and keep the
    // list sorted low→high so band numbering matches frequency order.
    const mapped = parsed.slice(0, EQ_MAX_BANDS).map((b) => ({
      id: newId(),
      freq: clampFreq(b.freq),
      gain: clampGain(b.gain),
      q: clampQ(b.q),
      type: EQ_TYPES.includes(b.type) ? b.type : "peaking",
      enabled: b.enabled !== false,
      dynamic: b.dynamic === true,
    }));
    return sortByFreq(mapped);
  } catch {
    return defaultBands();
  }
}

function persist(bands: EqBand[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bands));
  } catch {
    /* ignore */
  }
}

// Dragging a band fires many updates per second; debounce the disk write so
// we don't thrash localStorage on every pointermove. The snapshot is read at
// WRITE time (not schedule time) so a pending timer can never clobber a newer
// synchronous persist with stale bands.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(readBands: () => EqBand[]): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist(readBands());
  }, 400);
}
function cancelScheduledPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

export const clampFreq = (f: number) => {
  if (!Number.isFinite(f)) return EQ_FREQ_MIN;
  return Math.max(EQ_FREQ_MIN, Math.min(EQ_FREQ_MAX, Math.round(f)));
};
export const clampGain = (g: number) => {
  if (!Number.isFinite(g)) return 0;
  return Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, g));
};
export const clampQ = (q: number) => {
  if (!Number.isFinite(q)) return 1.1;
  return Math.max(0.3, Math.min(8, q));
};

/** Minimum frequency ratio kept between adjacent bands so they can't overlap. */
const BAND_GAP = 1.02;

/** Sort bands low→high so band numbering always matches frequency order. */
function sortByFreq(bands: EqBand[]): EqBand[] {
  return [...bands].sort((a, b) => a.freq - b.freq);
}

/**
 * Clamp a band's frequency so it stays strictly between its neighbours — bands
 * are not allowed to pass one another in the Sculptor.
 */
function neighborClampFreq(
  f: number,
  prevFreq: number | null,
  nextFreq: number | null,
): number {
  const lo = prevFreq !== null ? prevFreq * BAND_GAP : EQ_FREQ_MIN;
  const hi = nextFreq !== null ? nextFreq / BAND_GAP : EQ_FREQ_MAX;
  let out = clampFreq(f);
  if (lo <= hi) {
    out = Math.max(lo, Math.min(hi, out));
  } else {
    // Neighbours are too close to fit a gap — pin to the geometric midpoint.
    out = Math.sqrt((prevFreq ?? EQ_FREQ_MIN) * (nextFreq ?? EQ_FREQ_MAX));
  }
  return clampFreq(out);
}

/** Does this band actually colour the sound? Drives FX-engage / bypass. */
function bandActive(b: EqBand): boolean {
  if (!b.enabled) return false;
  const gainType = b.type === "peaking" || b.type === "lowshelf" || b.type === "highshelf";
  if (gainType) return Math.abs(b.gain) > 0.1;
  // lowpass / highpass / notch filter regardless of gain.
  return true;
}

export function eqIsActive(bands: EqBand[]): boolean {
  return bands.some(bandActive);
}

function toParametric(bands: EqBand[]): ParametricBand[] {
  return bands
    .filter((b) => b.enabled)
    .map((b) => ({
      id: b.id,
      freq: b.freq,
      gain: b.gain,
      q: b.q,
      type: b.type,
      dynamic: b.dynamic === true,
    }));
}

/**
 * Engage / disengage the FX chain in response to EQ activity. We never fight
 * the audio store's own neutrality logic: we only force OUT of bypass when the
 * EQ becomes audible, and only return to clean bypass when the EQ goes quiet
 * AND nothing else (tone params, correction, room) needs the chain.
 */
function syncEngage(active: boolean): void {
  const a = useAudioStore.getState();
  if (active) {
    if (a.bypass) a.setBypass(false);
  } else if (
    !a.bypass &&
    paramsAreNeutral(a.params) &&
    !a.correctionEnabled &&
    a.room === "off" &&
    a.clarity === 0 &&
    !restoreActive(a.restore)
  ) {
    a.setBypass(true);
  }
}

interface EqStore {
  bands: EqBand[];
  /** Shared band selection (session-only) — links the Sculptor's inspector
   *  with 3rd Dimension's Band Mode so picking a band highlights it in both. */
  selectedBandId: string | null;
  selectBand: (id: string | null) => void;
  /** Push the full band list into the engine + re-evaluate bypass. */
  syncEngine: () => void;
  /** Add a band. Optionally place it at an exact freq/gain (e.g. a click). */
  addBand: (at?: { freq: number; gain: number }) => string | null;
  removeBand: (id: string) => void;
  updateBand: (id: string, patch: Partial<Omit<EqBand, "id">>) => void;
  toggleBand: (id: string) => void;
  setBandCount: (n: number) => void;
  flatten: () => void;
  randomize: () => void;
  /** Replace every band from an external source (e.g. Tractor Beam) so the
   *  change shows up on the Sculptor handles, not just as hidden params. */
  setBands: (
    incoming: Array<{
      freq: number;
      gain: number;
      q?: number;
      type?: BiquadFilterType;
      enabled?: boolean;
      dynamic?: boolean;
    }>,
  ) => void;
  /** Retune EVERY existing band's gain from a curve sampler, preserving the
   *  user's band count, frequencies, Q and type (used by Tractor Beam so the
   *  match fits however many bands the user has). */
  applyGainCurve: (gainForFreq: (freqHz: number) => number) => void;
  reset: () => void;
}

export const useEqStore = create<EqStore>((set, get) => {
  const commit = (bands: EqBand[], rebuild: boolean) => {
    const sorted = sortByFreq(bands);
    // A queued debounced write (from a drag) must not fire after this newer
    // synchronous write — that would resurrect the pre-commit band list.
    cancelScheduledPersist();
    persist(sorted);
    set({ bands: sorted });
    // Drop a selection that points at a band that no longer exists.
    const sel = get().selectedBandId;
    if (sel && !sorted.some((b) => b.id === sel)) set({ selectedBandId: null });
    const engine = getEngine();
    if (rebuild) engine.setUserEQBands(toParametric(sorted));
    syncEngage(eqIsActive(sorted));
  };

  return {
    bands: load(),
    selectedBandId: null,

    selectBand: (id) => {
      if (get().selectedBandId === id) return;
      set({ selectedBandId: id });
    },

    syncEngine: () => {
      const bands = get().bands;
      getEngine().setUserEQBands(toParametric(bands));
      syncEngage(eqIsActive(bands));
    },

    addBand: (at) => {
      const bands = get().bands;
      if (bands.length >= EQ_MAX_BANDS) return null;
      let freq = 1000;
      let gain = 0;
      if (at) {
        freq = at.freq;
        gain = at.gain;
      } else {
        // Drop the new band into the widest octave gap so it lands somewhere
        // useful instead of stacking on top of an existing one.
        const sorted = [...bands].sort((a, b) => a.freq - b.freq);
        const points = [EQ_FREQ_MIN, ...sorted.map((b) => b.freq), EQ_FREQ_MAX];
        let bestGap = 0;
        for (let i = 0; i < points.length - 1; i++) {
          const ratio = points[i + 1] / points[i];
          if (ratio > bestGap) {
            bestGap = ratio;
            freq = Math.round(Math.sqrt(points[i] * points[i + 1]));
          }
        }
      }
      const band: EqBand = {
        id: newId(),
        freq: clampFreq(freq),
        gain: clampGain(gain),
        q: 1.1,
        type: "peaking",
        enabled: true,
      };
      commit([...bands, band], true);
      return band.id;
    },

    removeBand: (id) => {
      const bands = get().bands;
      if (bands.length <= EQ_MIN_BANDS) return;
      commit(bands.filter((b) => b.id !== id), true);
    },

    updateBand: (id, patch) => {
      const cur = get().bands;
      const idx = cur.findIndex((b) => b.id === id);
      if (idx < 0) return;
      let rebuild = false;
      const next: EqBand = { ...cur[idx] };
      if (patch.freq !== undefined) {
        // Lock the band between its neighbours so it can't jump past them.
        next.freq = neighborClampFreq(
          patch.freq,
          idx > 0 ? cur[idx - 1].freq : null,
          idx < cur.length - 1 ? cur[idx + 1].freq : null,
        );
      }
      if (patch.gain !== undefined) next.gain = clampGain(patch.gain);
      if (patch.q !== undefined) next.q = clampQ(patch.q);
      if (patch.type !== undefined) { next.type = patch.type; rebuild = true; }
      if (patch.enabled !== undefined) { next.enabled = patch.enabled; rebuild = true; }
      if (patch.dynamic !== undefined) { next.dynamic = patch.dynamic; rebuild = true; }
      const bands = cur.map((b, i) => (i === idx ? next : b));
      if (rebuild) {
        commit(bands, true);
      } else {
        // Fast path — just retune the live node.
        schedulePersist(() => get().bands);
        set({ bands });
        const band = bands.find((b) => b.id === id);
        if (band && band.enabled) {
          getEngine().updateUserEQBand({
            id: band.id,
            freq: band.freq,
            gain: band.gain,
            q: band.q,
            type: band.type,
            dynamic: band.dynamic === true,
          });
        }
        syncEngage(eqIsActive(bands));
      }
    },

    toggleBand: (id) => {
      const bands = get().bands.map((b) =>
        b.id === id ? { ...b, enabled: !b.enabled } : b,
      );
      commit(bands, true);
    },

    setBandCount: (n) => {
      const target = Math.max(EQ_MIN_BANDS, Math.min(EQ_MAX_BANDS, Math.round(n)));
      let bands = [...get().bands];
      while (bands.length > target) bands.pop();
      while (bands.length < target) {
        // Spread additions across the spectrum logarithmically.
        const t = bands.length / Math.max(1, target - 1);
        const freq = clampFreq(EQ_FREQ_MIN * Math.pow(EQ_FREQ_MAX / EQ_FREQ_MIN, t));
        bands.push({ id: newId(), freq, gain: 0, q: 1.1, type: "peaking", enabled: true });
      }
      commit(bands, true);
    },

    flatten: () => {
      const bands = get().bands.map((b) => ({ ...b, gain: 0 }));
      commit(bands, true);
    },

    randomize: () => {
      // Randomise the band gains (and a little Q variety) for an instant new
      // voicing. Frequencies are left alone so band order stays intact.
      const bands = get().bands.map((b) => ({
        ...b,
        gain: clampGain(Math.round((Math.random() * 2 - 1) * 9 * 2) / 2),
        q: clampQ(0.6 + Math.random() * 2.6),
        enabled: true,
      }));
      commit(bands, true);
    },

    setBands: (incoming) => {
      const mapped: EqBand[] = incoming.slice(0, EQ_MAX_BANDS).map((b) => ({
        id: newId(),
        freq: clampFreq(b.freq),
        gain: clampGain(b.gain),
        q: clampQ(b.q ?? 1.1),
        type: b.type && EQ_TYPES.includes(b.type) ? b.type : "peaking",
        enabled: b.enabled !== false,
        dynamic: b.dynamic === true,
      }));
      if (mapped.length === 0) return;
      commit(mapped, true);
    },

    applyGainCurve: (gainForFreq) => {
      // Keep the user's band layout intact — only retune gains to the curve so
      // the match fits any band count (1-20). Enable each band so the full
      // match is actually heard.
      const bands = get().bands.map((b) => ({
        ...b,
        gain: clampGain(gainForFreq(b.freq)),
        enabled: true,
      }));
      commit(bands, true);
    },

    reset: () => {
      commit(defaultBands(), true);
    },
  };
});
