import { create } from "zustand";

export type ThemeId =
  | "obsidian"
  | "crimson"
  | "military"
  | "abyss"
  | "toxic"
  | "ember"
  | "mono"
  | "neon"
  | "studio"
  | "vinyl"
  | "gunmetal"
  | "carbon"
  | "nightops";

/** Optional accent override applied on top of the active theme. */
export type AccentId =
  | "theme"
  | "steel"
  | "blood"
  | "amber"
  | "ice"
  | "lime"
  | "violet"
  | "mono";
/**
 * Headphones are intentionally loose-typed (string) so adding a new model
 * is a single-file change in `headphoneProfiles.ts` — no second touchpoint
 * needed here.
 */
export type HeadphoneId = string;

export interface SettingsState {
  theme: ThemeId;
  /**
   * Bumped whenever the *default* appearance (theme/density) changes so an
   * existing install adopts the new defaults once, without clobbering the
   * user's other settings (headphone, routing, etc).
   */
  appearanceRev: number;
  /** Optional accent override (changes the primary hue across the UI). */
  accent: AccentId;
  /**
   * Global bloom/glow multiplier 0..1. Lower = sharper, flatter, less neon.
   * Scales every accent glow (buttons, text, rings, orbs).
   */
  uiGlow: number;
  /** UI density — content zoom factor. <1 = more compact, less scrolling. */
  uiScale: number;
  headphone: HeadphoneId;
  /** When true, app tries to auto-enable correction only when the active
   *  output device name matches a known headphone signature. */
  companionMode: boolean;
  /** Onboarding tour shown / dismissed. */
  onboardingDone: boolean;
  /** Mini-player mode (compact always-on-top strip). */
  miniMode: boolean;
  /** Show tooltips on hover. */
  tooltipsEnabled: boolean;
  /** Play subtle synthesized sound feedback for clicks / slider moves. */
  uiSounds: boolean;
  /** UI-sound feedback volume, 0..1. */
  uiSoundVolume: number;
  /** Play the signature boot sting on launch. */
  bootSound: boolean;
  /** Force reduced motion (calmer than the OS setting). */
  forceReducedMotion: boolean;
  /** Ambient background orbs + grid field. */
  bgFx: boolean;
  /** Auto-flatten new tracks (analyse + tilt EQ on load). */
  autoFlatten: boolean;
  /** Loudness target in LUFS for auto-normalize. null = disabled. */
  lufsTargetDb: number | null;
  /** Local WebSocket remote-control port (0 = disabled). */
  remotePort: number;
  /**
   * Device ID for the audio output sink the app uses. Empty string = system
   * default. Critical for the Exterior-Audio (loopback) flow on Windows —
   * if the app outputs to the same device it captures from, feedback occurs.
   */
  audioOutputDeviceId: string;
  /**
   * Set true once the user has acknowledged that single-device loopback will
   * echo. Suppresses the nag toast on subsequent toggles.
   */
  loopbackEchoAck: boolean;
  /**
   * Audio capture source for Exterior Audio. Determines what feeds the DSP
   * chain when the "Enable Exterior Audio" button is pressed.
   *
   *   ""               → system-default loopback via getDisplayMedia (the
   *                       legacy path; captures speakers' loopback which
   *                       includes the app's own output → feedback risk).
   *   "vbcable"        → captures from VB-Audio CABLE Output (an input
   *                       device exposed by the free VB-Cable driver).
   *                       Recommended for single-device users. No feedback
   *                       because the captured device is virtual.
   *   "<deviceId>"     → captures from a specific audioinput by deviceId
   *                       (line-in, USB mic, another virtual cable, etc.).
   */
  audioInputSource: string;

  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  toggle: (
    key:
      | "companionMode"
      | "onboardingDone"
      | "miniMode"
      | "tooltipsEnabled"
      | "uiSounds"
      | "autoFlatten"
      | "loopbackEchoAck"
      | "bootSound"
      | "forceReducedMotion"
      | "bgFx",
  ) => void;
}

const STORAGE_KEY = "audio-playground.settings.v1";

/** Increment to re-apply the appearance defaults below to existing installs. */
const APPEARANCE_REV = 1;

const DEFAULTS: Omit<SettingsState, "set" | "toggle"> = {
  theme: "nightops",
  appearanceRev: APPEARANCE_REV,
  accent: "theme",
  uiGlow: 0.4,
  uiScale: 1.0,
  headphone: "xm6",
  companionMode: false,
  onboardingDone: false,
  miniMode: false,
  tooltipsEnabled: true,
  uiSounds: true,
  uiSoundVolume: 0.5,
  bootSound: true,
  forceReducedMotion: false,
  bgFx: true,
  autoFlatten: false,
  lufsTargetDb: null,
  remotePort: 0,
  audioOutputDeviceId: "",
  loopbackEchoAck: false,
  audioInputSource: "",
};

function load(): typeof DEFAULTS {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    // Appearance migration: if this install predates the current default
    // appearance, force the new theme + density once (everything else kept).
    if ((parsed.appearanceRev ?? 0) < APPEARANCE_REV) {
      merged.theme = DEFAULTS.theme;
      merged.uiScale = DEFAULTS.uiScale;
      merged.appearanceRev = APPEARANCE_REV;
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(state: typeof DEFAULTS): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// Debounced persist — dragging UI Glow / UI Scale fires set() per mousemove,
// and a synchronous JSON.stringify + localStorage write per event janks the
// slider. 300 ms after the last change is plenty durable.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(state: typeof DEFAULTS): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persist(state), 300);
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = load();
  // Persist immediately so a one-time appearance migration sticks even if the
  // user never changes another setting this session.
  persist(initial);
  return {
    ...initial,
    set: (key, value) => {
      set({ [key]: value } as Partial<SettingsState>);
      const snap = { ...DEFAULTS };
      const cur = get() as unknown as Record<string, unknown>;
      (Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).forEach((k) => {
        (snap as unknown as Record<string, unknown>)[k] = cur[k];
      });
      schedulePersist(snap);
    },
    toggle: (key) => {
      const cur = get()[key];
      get().set(key, !cur as never);
    },
  };
});
