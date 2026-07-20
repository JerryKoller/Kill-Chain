import { create } from "zustand";
import type { SoundParams } from "@/audio/types";
import { normalizeParams } from "@/audio/types";
import { useAudioStore } from "@/state/audioStore";

/**
 * Per-track EQ memory. "Save current EQ to this track" snapshots the live
 * SoundParams under the track's file path; whenever that track starts
 * playing again (and auto-apply is on) the snapshot is restored through the
 * normal audioStore path, so undo history and the FX-chain engage logic all
 * behave exactly as if the user had dialled it in by hand.
 */

const STORAGE_KEY = "audio-playground.trackEq.v1";

interface TrackEqEntry {
  params: SoundParams;
  savedAt: number;
}

interface TrackEqState {
  /** Saved snapshots keyed by absolute track path. */
  entries: Record<string, TrackEqEntry>;
  /** Master switch for auto-applying snapshots on play. */
  autoApply: boolean;

  saveForTrack: (path: string) => void;
  clearForTrack: (path: string) => void;
  setAutoApply: (on: boolean) => void;
}

interface Persisted {
  entries: Record<string, TrackEqEntry>;
  autoApply: boolean;
}

function loadPersisted(): Persisted {
  const empty: Persisted = { entries: {}, autoApply: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw);
    const entries: Record<string, TrackEqEntry> = {};
    if (p.entries && typeof p.entries === "object") {
      for (const [path, e] of Object.entries(p.entries as Record<string, Partial<TrackEqEntry>>)) {
        if (!e || typeof e !== "object" || !e.params) continue;
        entries[path] = {
          params: normalizeParams(e.params),
          savedAt: Number(e.savedAt ?? Date.now()),
        };
      }
    }
    return { entries, autoApply: p.autoApply !== false };
  } catch {
    return empty;
  }
}

function persist(s: Pick<TrackEqState, "entries" | "autoApply">): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ entries: s.entries, autoApply: s.autoApply }),
    );
  } catch (err) {
    console.warn("[trackEq] persist failed:", err);
  }
}

export const useTrackEqStore = create<TrackEqState>((set, get) => {
  const initial = loadPersisted();
  return {
    entries: initial.entries,
    autoApply: initial.autoApply,

    saveForTrack: (path) => {
      const params = { ...useAudioStore.getState().params };
      const entries = {
        ...get().entries,
        [path]: { params, savedAt: Date.now() },
      };
      set({ entries });
      persist({ entries, autoApply: get().autoApply });
    },

    clearForTrack: (path) => {
      if (!get().entries[path]) return;
      const entries = { ...get().entries };
      delete entries[path];
      set({ entries });
      persist({ entries, autoApply: get().autoApply });
    },

    setAutoApply: (on) => {
      set({ autoApply: on });
      persist({ entries: get().entries, autoApply: on });
    },
  };
});

/** Called by the library's play-tracking hook when a track starts playing. */
export function autoApplyTrackEq(path: string): void {
  const s = useTrackEqStore.getState();
  if (!s.autoApply) return;
  const entry = s.entries[path];
  if (!entry) return;
  useAudioStore.getState().replaceParams(entry.params);
}
