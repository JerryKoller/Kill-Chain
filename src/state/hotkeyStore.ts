import { create } from "zustand";

/**
 * Remappable global hotkeys (v1.5). Only the single-letter command keys are
 * customizable; structural keys (Space, arrows, ?, digit view-switching,
 * Shift variants) stay fixed so the cheat sheet and docs remain sane.
 * Shift+<savePreset> quick-saves a session snapshot; Shift+<undo> is redo.
 */

const STORAGE_KEY = "killchain.hotkeys.v1";

export type HotkeyActionId =
  | "nextTrack"
  | "prevTrack"
  | "loop"
  | "mute"
  | "snapshotA"
  | "swapAB"
  | "clearAB"
  | "correction"
  | "bypass"
  | "savePreset"
  | "miniMode"
  | "undo";

export interface HotkeyActionDef {
  id: HotkeyActionId;
  label: string;
  /** Extra behavior on Shift+key, shown in the remap table. */
  shiftLabel?: string;
}

export const HOTKEY_ACTIONS: HotkeyActionDef[] = [
  { id: "nextTrack", label: "Next track in queue" },
  { id: "prevTrack", label: "Previous track in queue" },
  { id: "loop", label: "Toggle loop" },
  { id: "mute", label: "Toggle mute" },
  { id: "snapshotA", label: "Snapshot A (full chain)" },
  { id: "swapAB", label: "Swap A <-> B (loudness-matched)" },
  { id: "clearAB", label: "Clear A snapshot" },
  { id: "correction", label: "Toggle headphone correction" },
  { id: "bypass", label: "Toggle full-effect bypass" },
  { id: "savePreset", label: "Save tuning as preset", shiftLabel: "Shift: quick-save session snapshot" },
  { id: "miniMode", label: "Toggle mini-player mode" },
  { id: "undo", label: "Undo last tweak", shiftLabel: "Shift: redo" },
];

export const DEFAULT_BINDINGS: Record<HotkeyActionId, string> = {
  nextTrack: "n",
  prevTrack: "p",
  loop: "l",
  mute: "m",
  snapshotA: "a",
  swapAB: "b",
  clearAB: "c",
  correction: "e",
  bypass: "f",
  savePreset: "s",
  miniMode: "w",
  undo: "z",
};

/** Keys that can never be remap targets (structural app shortcuts). */
const RESERVED = new Set([
  " ", "?", "arrowleft", "arrowright", "arrowup", "arrowdown",
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
  "escape", "enter", "tab",
]);

function sanitize(raw: unknown): Record<HotkeyActionId, string> {
  const out = { ...DEFAULT_BINDINGS };
  if (!raw || typeof raw !== "object") return out;
  for (const def of HOTKEY_ACTIONS) {
    const v = (raw as Record<string, unknown>)[def.id];
    if (typeof v === "string" && v.length === 1 && !RESERVED.has(v.toLowerCase())) {
      out[def.id] = v.toLowerCase();
    }
  }
  return out;
}

function load(): Record<HotkeyActionId, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

interface HotkeyState {
  bindings: Record<HotkeyActionId, string>;
  /** Rebind an action. Returns false when the key is reserved/invalid.
   *  If another action already uses the key, the two actions swap keys. */
  setBinding: (action: HotkeyActionId, key: string) => boolean;
  resetBindings: () => void;
}

export const useHotkeyStore = create<HotkeyState>((set, get) => ({
  bindings: load(),

  setBinding: (action, key) => {
    const k = key.toLowerCase();
    if (k.length !== 1 || RESERVED.has(k)) return false;
    const bindings = { ...get().bindings };
    // Swap with any action that currently owns this key — no dead conflicts.
    const owner = (Object.keys(bindings) as HotkeyActionId[]).find(
      (id) => bindings[id] === k && id !== action,
    );
    if (owner) bindings[owner] = bindings[action];
    bindings[action] = k;
    set({ bindings });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    } catch (err) {
      void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
        reportStorageFailure("Hotkeys", err),
      );
    }
    return true;
  },

  resetBindings: () => {
    set({ bindings: { ...DEFAULT_BINDINGS } });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  },
}));

/** Which action (if any) the pressed key maps to. */
export function actionForKey(key: string): HotkeyActionId | null {
  const k = key.toLowerCase();
  const b = useHotkeyStore.getState().bindings;
  for (const id of Object.keys(b) as HotkeyActionId[]) {
    if (b[id] === k) return id;
  }
  return null;
}
