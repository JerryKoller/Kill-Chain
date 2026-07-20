import { create } from "zustand";
import {
  applyAirMode,
  defaultAirOpts,
  type AirMode,
} from "@/lib/airspaceModes";
import type { AirspaceMediaSnapshot } from "@/lib/airspaceMedia";

/**
 * Airspace — the in-app browser. Engaging "Route through Kill-Chain" uses
 * direct per-frame capture of the webview (see AirspaceView / playerStore),
 * pulling its audio through the full Kill-Chain DSP path. This store holds
 * browser UI state (last URL, bookmarks, PiP, AdBlock), the Cinema/Music
 * voicing mode, and the LIVE media readout the transport-bar deck renders
 * (what's playing in the webview: title, artwork, position).
 */

export interface AirspaceBookmark {
  id: string;
  label: string;
  url: string;
}

const DEFAULT_BOOKMARKS: AirspaceBookmark[] = [
  { id: "yt", label: "YouTube", url: "https://www.youtube.com" },
  { id: "spotify", label: "Spotify", url: "https://open.spotify.com" },
  { id: "sc", label: "SoundCloud", url: "https://soundcloud.com" },
  { id: "twitch", label: "Twitch", url: "https://www.twitch.tv" },
];

const DEFAULT_URL = "https://www.youtube.com";

interface AirspaceState {
  /** Last URL the webview navigated to — restored on next launch. */
  lastUrl: string;
  bookmarks: AirspaceBookmark[];
  /** Picture-in-picture: keep a floating mini view while on other tabs. */
  pip: boolean;
  /** Ad / tracker blocking inside the embedded browser. */
  adblock: boolean;
  /** Cinema / Music voicing for the browser's audio (off = untouched). */
  airMode: AirMode;
  /** Per-option toggles for the modes (option id → enabled). */
  airOpts: Record<string, boolean>;
  /** Live readout of the media playing in the webview (not persisted). */
  media: AirspaceMediaSnapshot | null;

  setLastUrl: (url: string) => void;
  addBookmark: (label: string, url: string) => void;
  removeBookmark: (id: string) => void;
  setPip: (on: boolean) => void;
  setAdblock: (on: boolean) => void;
  setAirMode: (mode: AirMode) => void;
  setAirOpt: (id: string, on: boolean) => void;
  /** Re-push the persisted mode into the DSP (AirspaceView mount). */
  applyAirModeNow: () => void;
  setMedia: (m: AirspaceMediaSnapshot | null) => void;
}

const STORAGE_KEY = "audio-playground.airspace.v1";

/** Bumped when the option set / defaults change — stale airOpts reset once. */
const AIR_OPTS_REV = 2;

interface PersistedShape {
  lastUrl: string;
  bookmarks: AirspaceBookmark[];
  pip: boolean;
  adblock: boolean;
  airMode: AirMode;
  airOpts: Record<string, boolean>;
  airOptsRev?: number;
}

function load(): PersistedShape {
  const fallback: PersistedShape = {
    lastUrl: DEFAULT_URL,
    bookmarks: DEFAULT_BOOKMARKS,
    pip: true,
    adblock: true,
    airMode: "off",
    airOpts: defaultAirOpts(),
    airOptsRev: AIR_OPTS_REV,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return {
      lastUrl:
        typeof parsed.lastUrl === "string" && /^https?:\/\//i.test(parsed.lastUrl)
          ? parsed.lastUrl
          : DEFAULT_URL,
      bookmarks: Array.isArray(parsed.bookmarks) && parsed.bookmarks.length > 0
        ? parsed.bookmarks.filter(
            (b): b is AirspaceBookmark =>
              !!b && typeof b.id === "string" && typeof b.label === "string" &&
              typeof b.url === "string" && /^https?:\/\//i.test(b.url),
          )
        : DEFAULT_BOOKMARKS,
      pip: parsed.pip !== false,
      adblock: parsed.adblock !== false,
      airMode:
        parsed.airMode === "cinema" || parsed.airMode === "music"
          ? parsed.airMode
          : "off",
      // Option defaults changed (everything ships OFF now) — reset stale
      // saved toggles once instead of resurrecting the old always-on set.
      airOpts:
        parsed.airOptsRev === AIR_OPTS_REV
          ? { ...defaultAirOpts(), ...(parsed.airOpts ?? {}) }
          : defaultAirOpts(),
      airOptsRev: AIR_OPTS_REV,
    };
  } catch {
    return fallback;
  }
}

// Debounced persist — did-navigate can fire in bursts (redirect chains).
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(state: PersistedShape): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }, 300);
}

export const useAirspaceStore = create<AirspaceState>((set, get) => {
  const snapshot = (): PersistedShape => ({
    lastUrl: get().lastUrl,
    bookmarks: get().bookmarks,
    pip: get().pip,
    adblock: get().adblock,
    airMode: get().airMode,
    airOpts: get().airOpts,
    airOptsRev: AIR_OPTS_REV,
  });

  return {
    ...load(),
    media: null,

    setLastUrl: (url) => {
      if (!/^https?:\/\//i.test(url)) return;
      set({ lastUrl: url });
      schedulePersist({ ...snapshot(), lastUrl: url });
    },

    addBookmark: (label, url) => {
      if (!/^https?:\/\//i.test(url)) return;
      const cur = get().bookmarks;
      if (cur.some((b) => b.url === url)) return;
      const next = [
        ...cur,
        { id: Math.random().toString(36).slice(2, 10), label: label || url, url },
      ];
      set({ bookmarks: next });
      schedulePersist({ ...snapshot(), bookmarks: next });
    },

    removeBookmark: (id) => {
      const next = get().bookmarks.filter((b) => b.id !== id);
      set({ bookmarks: next });
      schedulePersist({ ...snapshot(), bookmarks: next });
    },

    setPip: (on) => {
      set({ pip: on });
      schedulePersist({ ...snapshot(), pip: on });
    },

    setAdblock: (on) => {
      set({ adblock: on });
      schedulePersist({ ...snapshot(), adblock: on });
      // Push into the main process (blocks at the network layer).
      void window.playground?.airspace?.setAdblock(on);
    },

    setAirMode: (mode) => {
      set({ airMode: mode });
      schedulePersist({ ...snapshot(), airMode: mode });
      applyAirMode(mode, get().airOpts);
    },

    setAirOpt: (id, on) => {
      const airOpts = { ...get().airOpts, [id]: on };
      set({ airOpts });
      schedulePersist({ ...snapshot(), airOpts });
      applyAirMode(get().airMode, airOpts);
    },

    applyAirModeNow: () => {
      const s = get();
      if (s.airMode !== "off") applyAirMode(s.airMode, s.airOpts);
    },

    setMedia: (m) => {
      // The poller fires ~1.4×/s; skip the set() when literally nothing moved
      // (paused page) so idle Airspace doesn't re-render the transport bar.
      const prev = get().media;
      if (prev === null && m === null) return;
      if (
        prev && m &&
        prev.paused === m.paused &&
        prev.currentTime === m.currentTime &&
        prev.duration === m.duration &&
        prev.title === m.title &&
        prev.artwork === m.artwork &&
        prev.volume === m.volume
      ) {
        return;
      }
      set({ media: m });
    },
  };
});
