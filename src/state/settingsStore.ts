import { create } from "zustand";

/**
 * v2.2 — the theme roster was culled from 13 to 6: three signature themes
 * (Night Ops, Obsidian, Carbon) plus three alternates (Abyss, Crimson,
 * Mono). Removed ids are migrated to their nearest surviving look in
 * `load()` so existing installs keep a coherent appearance.
 */
export type ThemeId =
  | "nightops"
  | "obsidian"
  | "carbon"
  | "abyss"
  | "crimson"
  | "mono";

/** Where each retired theme lands (v2.2 migration). */
export const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  military: "nightops",
  toxic: "nightops",
  ember: "carbon",
  vinyl: "carbon",
  neon: "abyss",
  studio: "obsidian",
  gunmetal: "mono",
};

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
  /**
   * ISO timestamp when the user accepted the current legal package.
   * Null until first-run agree. Re-run tour does not clear this.
   */
  legalAcceptedAt: string | null;
  /**
   * LEGAL_VERSION string that was accepted. Must match the current package
   * or the gate re-opens (version bump).
   */
  legalAcceptedVersion: string | null;
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
  /** v2.2 — per-module accent colors (headers/active controls). When false
   *  the whole app runs monochrome on the theme primary. */
  moduleColor: boolean;
  /** v2.2 — optional texture layer over the UI. Off by default. */
  fxOverlay: "off" | "scanlines" | "grain";
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
  /** Opt-in error/crash logging (local crash.log; Sentry only if a DSN is
   *  configured at build time). Default OFF — nothing leaves the machine. */
  crashReports: boolean;
  /** Last app version whose "What's new" panel was shown. */
  lastSeenVersion: string;

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
      | "bgFx"
      | "moduleColor"
      | "crashReports",
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
  headphone: "neutral",
  companionMode: false,
  onboardingDone: false,
  legalAcceptedAt: null,
  legalAcceptedVersion: null,
  miniMode: false,
  tooltipsEnabled: true,
  uiSounds: true,
  uiSoundVolume: 0.5,
  bootSound: false,
  forceReducedMotion: false,
  bgFx: true,
  moduleColor: true,
  fxOverlay: "off",
  autoFlatten: false,
  lufsTargetDb: null,
  remotePort: 0,
  audioOutputDeviceId: "",
  loopbackEchoAck: false,
  audioInputSource: "",
  crashReports: false,
  lastSeenVersion: "",
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
    // v2.2 theme cull: retired ids fall back to their nearest survivor.
    if (LEGACY_THEME_MAP[merged.theme as string]) {
      merged.theme = LEGACY_THEME_MAP[merged.theme as string];
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
  } catch (err) {
    // v2.4: storage failures surface in the Mission HUD instead of vanishing.
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Settings", err),
    );
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
