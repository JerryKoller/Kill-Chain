import { create } from "zustand";

export type View =
  | "playground"
  | "library"
  | "morphlab"
  | "calibration"
  | "trainer"
  | "reactor"
  | "scope"
  | "tractor"
  | "dimension"
  | "fire"
  | "airspace"
  | "chain"
  | "presets"
  | "glossary"
  | "settings";

interface UIState {
  view: View;
  setView: (view: View) => void;
  toastMessage: string | null;
  toast: (msg: string) => void;
  hotkeyOverlayOpen: boolean;
  setHotkeyOverlay: (open: boolean) => void;
  toggleHotkeyOverlay: () => void;
}

const VIEW_KEY = "killchain.lastView.v1";

const ALL_VIEWS: View[] = [
  "playground", "library", "morphlab", "calibration", "trainer", "reactor",
  "scope", "tractor", "dimension", "fire", "airspace", "chain", "presets",
  "glossary", "settings",
];

/** Reopen where the user left off (falls back to the Sculptor). */
function loadLastView(): View {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (raw && ALL_VIEWS.includes(raw as View)) return raw as View;
  } catch { /* storage blocked */ }
  return "playground";
}

export const useUIStore = create<UIState>((set, get) => ({
  view: loadLastView(),
  setView: (view) => {
    set({ view });
    try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  },
  toastMessage: null,
  toast: (msg) => {
    set({ toastMessage: msg });
    setTimeout(() => set({ toastMessage: null }), 2400);
  },
  hotkeyOverlayOpen: false,
  setHotkeyOverlay: (open) => set({ hotkeyOverlayOpen: open }),
  toggleHotkeyOverlay: () =>
    set({ hotkeyOverlayOpen: !get().hotkeyOverlayOpen }),
}));
