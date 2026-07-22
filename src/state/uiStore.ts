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

/** v2.2 — toast flavors drive the status dot on the KCToast pill. */
export type ToastKind = "info" | "success" | "warn" | "error";

interface UIState {
  view: View;
  setView: (view: View) => void;
  toastMessage: string | null;
  toastKind: ToastKind;
  /** Re-keyed per toast so a repeat message still replays the entrance. */
  toastSeq: number;
  toast: (msg: string, kind?: ToastKind) => void;
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
  toastKind: "info",
  toastSeq: 0,
  toast: (msg, kind = "info") => {
    const seq = get().toastSeq + 1;
    set({ toastMessage: msg, toastKind: kind, toastSeq: seq });
    setTimeout(() => {
      // Only clear if a newer toast hasn't replaced this one.
      if (get().toastSeq === seq) set({ toastMessage: null });
    }, 2400);
  },
  hotkeyOverlayOpen: false,
  setHotkeyOverlay: (open) => set({ hotkeyOverlayOpen: open }),
  toggleHotkeyOverlay: () =>
    set({ hotkeyOverlayOpen: !get().hotkeyOverlayOpen }),
}));
