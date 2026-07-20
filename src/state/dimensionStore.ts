import { create } from "zustand";
import { getEngine } from "@/audio/AudioEngine";
import { useEqStore } from "@/state/eqStore";
import type {
  MotionConfig,
  MotionPattern,
  VoiceFeed,
  VoiceSpec,
} from "@/audio/dsp/Spatializer3D";

/**
 * dimensionStore — single source of truth for the "3rd Dimension" feature.
 * Holds the room, the placed speakers (speaker mode) or band placements (band
 * mode) and pushes them into `engine.dimension` (the HRTF Spatializer3D).
 *
 * Positions are stored NORMALISED in [-1, 1] per axis (x = right, y = up,
 * z = front-negative) and converted to metres against the current room
 * half-extents at sync time, so growing the room spreads everything out and
 * the soundstage scales with it.
 */

export type SpeakerType =
  | "tower"
  | "bookshelf"
  | "center"
  | "surround"
  | "height"
  | "subwoofer"
  | "soundbar";

export type DimMode = "speaker" | "band" | "motion";
export type DimSignal = "eqd" | "raw";

/**
 * Motion Mode (headphone immersion): the track is split into these bands and
 * each one becomes a moving point of sound around the head — height follows
 * frequency, proximity/speed follow that band's own energy. A kick drum
 * pulses in near your chest while cymbals circle overhead; in Fly-by pattern
 * a sudden roar (truck, jet, drop) launches a pass right past your ear.
 *
 * The split is a LINKWITZ-RILEY crossover tree (adjacent bands share edges
 * and sum flat), not overlapping bandpasses — so with motion at rest the
 * sound is essentially untouched, and fidelity survives the flight. The two
 * lowest bands are ANCHOR candidates: pinned in place by "Solid bass" so the
 * fundament never smears.
 */
export const MOTION_BANDS: {
  id: string;
  label: string;
  lo: number | null;
  hi: number | null;
  anchor: boolean;
}[] = [
  { id: "mo-sub", label: "Sub", lo: null, hi: 70, anchor: true },
  { id: "mo-bass", label: "Bass", lo: 70, hi: 160, anchor: true },
  { id: "mo-body", label: "Body", lo: 160, hi: 420, anchor: false },
  { id: "mo-mid", label: "Mids", lo: 420, hi: 1200, anchor: false },
  { id: "mo-pres", label: "Presence", lo: 1200, hi: 3400, anchor: false },
  { id: "mo-bril", label: "Brilliance", lo: 3400, hi: 8500, anchor: false },
  { id: "mo-air", label: "Air", lo: 8500, hi: null, anchor: false },
];

/** Rough display centre for a motion band (colors, sort). */
export function motionBandCentre(b: { lo: number | null; hi: number | null }): number {
  return Math.sqrt((b.lo ?? 25) * (b.hi ?? 18000));
}

export const MOTION_PATTERNS: { id: MotionPattern; label: string; desc: string }[] = [
  { id: "orbit", label: "Orbit", desc: "Every band circles the head — loud bands pull in close and speed up" },
  { id: "flyby", label: "Fly-by", desc: "Calm drift until a sound surges — then it races right past your ear (trucks, jets, drops)" },
  { id: "swarm", label: "Swarm", desc: "Organic wander — bands weave around you like fireflies, dancing to their own energy" },
  { id: "pendulum", label: "Pendulum", desc: "Bands swing across the stage — lows sweep wide and slow, highs flick quick and tight" },
];

export const DEFAULT_MOTION: MotionConfig = {
  pattern: "orbit",
  speed: 0.4,
  intensity: 0.55,
  reactivity: 0.65,
  cohesion: 0.65,
  anchorLows: true,
};

/** One-click motion characters — pattern + feel, tuned by ear. */
export const MOTION_PRESETS: {
  id: string;
  label: string;
  desc: string;
  motion: MotionConfig;
  stage?: "room" | "head";
}[] = [
  {
    id: "halo",
    label: "Halo",
    desc: "Slow, cohesive constellation close around your head — immersive but hi-fi. Start here.",
    motion: { pattern: "orbit", speed: 0.28, intensity: 0.45, reactivity: 0.5, cohesion: 0.85, anchorLows: true },
    stage: "head",
  },
  {
    id: "theater",
    label: "Theater Sweep",
    desc: "Wide cinematic pendulum — effects sweep across the front stage while the bass holds the floor.",
    motion: { pattern: "pendulum", speed: 0.35, intensity: 0.7, reactivity: 0.55, cohesion: 0.7, anchorLows: true },
    stage: "room",
  },
  {
    id: "flyby",
    label: "Fly-bys",
    desc: "Quiet drift until something roars — then it tears right past your ear.",
    motion: { pattern: "flyby", speed: 0.5, intensity: 0.6, reactivity: 0.85, cohesion: 0.4, anchorLows: true },
    stage: "head",
  },
  {
    id: "storm",
    label: "Warp Storm",
    desc: "Everything alive at once — fast, wild, reactive. Maximum chaos.",
    motion: { pattern: "swarm", speed: 0.75, intensity: 0.85, reactivity: 0.9, cohesion: 0.15, anchorLows: false },
    stage: "head",
  },
];
export type LayoutId =
  | "soundbar"
  | "stereo20"
  | "stereo21"
  | "system31"
  | "surround51"
  | "surround71"
  | "surround72"
  | "atmos512";

export interface Vec3n {
  nx: number;
  ny: number;
  nz: number;
}

export interface Speaker {
  id: string;
  type: SpeakerType;
  nx: number;
  ny: number;
  nz: number;
  gainDb: number;
  enabled: boolean;
}

export const ROOM_LIMITS = {
  width: { min: 2, max: 16, default: 6 },
  height: { min: 2, max: 6, default: 3 },
  depth: { min: 2, max: 16, default: 6 },
};

/** Average wall absorption coefficient ᾱ (energy). */
export const ABSORPTION_LIMITS = { min: 0.05, max: 0.6, default: 0.28 };

export type RoomPresetId = "studio" | "living" | "hall";

/**
 * Acoustically sensible rooms: real-world dimensions with typical average
 * absorption (treated studio ≈ 0.45, furnished living room ≈ 0.25,
 * reflective hall ≈ 0.1). RT60 follows from Sabine in the DSP.
 */
export const ROOM_PRESETS: {
  id: RoomPresetId;
  label: string;
  desc: string;
  width: number;
  height: number;
  depth: number;
  absorption: number;
}[] = [
  { id: "studio", label: "Studio", desc: "Treated near-field room", width: 4.5, height: 2.7, depth: 5, absorption: 0.45 },
  { id: "living", label: "Living Room", desc: "Furnished domestic room", width: 5, height: 2.4, depth: 7, absorption: 0.25 },
  { id: "hall", label: "Hall", desc: "Large reflective space", width: 14, height: 6, depth: 16, absorption: 0.1 },
];

export const SPEAKER_META: Record<
  SpeakerType,
  { label: string; short: string; color: string }
> = {
  tower: { label: "Tower / Floorstanding", short: "Tower", color: "#22e8ff" },
  bookshelf: { label: "Bookshelf", short: "Bookshelf", color: "#5bd1ff" },
  center: { label: "Center", short: "Center", color: "#9dff5b" },
  surround: { label: "Surround", short: "Surround", color: "#ff8a48" },
  height: { label: "Height / Ceiling", short: "Height", color: "#ff2bd6" },
  subwoofer: { label: "Subwoofer", short: "Sub", color: "#7a5bff" },
  soundbar: { label: "Soundbar", short: "Soundbar", color: "#48ffd1" },
};

export const LAYOUTS: { id: LayoutId; label: string; desc: string }[] = [
  { id: "soundbar", label: "Soundbar", desc: "Single front bar" },
  { id: "stereo20", label: "2.0 Stereo", desc: "L + R" },
  { id: "stereo21", label: "2.1 Stereo", desc: "L + R + sub" },
  { id: "system31", label: "3.1", desc: "L/C/R + sub" },
  { id: "surround51", label: "5.1 Surround", desc: "L/C/R + 2 surround + sub" },
  { id: "surround71", label: "7.1 Surround", desc: "+ 2 rear surround" },
  { id: "surround72", label: "7.2 Surround", desc: "7.1 + dual subs" },
  { id: "atmos512", label: "5.1.2 Atmos", desc: "5.1 + 2 ceiling" },
];

let seq = 0;
const sid = () => `spk-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function spk(
  type: SpeakerType,
  nx: number,
  ny: number,
  nz: number,
  gainDb = 0,
): Speaker {
  return { id: sid(), type, nx, ny, nz, gainDb, enabled: true };
}

/** Standard speaker placements per layout, normalised to the room. */
export function layoutSpeakers(id: LayoutId): Speaker[] {
  switch (id) {
    case "soundbar":
      return [spk("soundbar", 0, -0.15, -0.92)];
    case "stereo20":
      return [spk("tower", -0.6, 0, -0.72), spk("tower", 0.6, 0, -0.72)];
    case "stereo21":
      return [
        spk("tower", -0.6, 0, -0.72),
        spk("tower", 0.6, 0, -0.72),
        spk("subwoofer", -0.45, -0.85, -0.6, 2),
      ];
    case "system31":
      return [
        spk("tower", -0.62, 0, -0.72),
        spk("tower", 0.62, 0, -0.72),
        spk("center", 0, -0.05, -0.9),
        spk("subwoofer", -0.45, -0.85, -0.6, 2),
      ];
    case "surround51":
      return [
        spk("tower", -0.6, 0, -0.72),
        spk("tower", 0.6, 0, -0.72),
        spk("center", 0, -0.05, -0.9),
        spk("subwoofer", -0.5, -0.85, -0.62, 2),
        spk("surround", -0.85, 0, 0.45),
        spk("surround", 0.85, 0, 0.45),
      ];
    case "surround71":
      return [
        spk("tower", -0.6, 0, -0.74),
        spk("tower", 0.6, 0, -0.74),
        spk("center", 0, -0.05, -0.9),
        spk("subwoofer", -0.5, -0.85, -0.62, 2),
        spk("surround", -0.9, 0, 0.05),
        spk("surround", 0.9, 0, 0.05),
        spk("surround", -0.45, 0, 0.92),
        spk("surround", 0.45, 0, 0.92),
      ];
    case "surround72":
      return [
        spk("tower", -0.6, 0, -0.74),
        spk("tower", 0.6, 0, -0.74),
        spk("center", 0, -0.05, -0.9),
        spk("subwoofer", -0.55, -0.85, -0.62, 2),
        spk("subwoofer", 0.55, -0.85, 0.6, 2),
        spk("surround", -0.9, 0, 0.05),
        spk("surround", 0.9, 0, 0.05),
        spk("surround", -0.45, 0, 0.92),
        spk("surround", 0.45, 0, 0.92),
      ];
    case "atmos512":
      return [
        spk("tower", -0.6, 0, -0.74),
        spk("tower", 0.6, 0, -0.74),
        spk("center", 0, -0.05, -0.9),
        spk("subwoofer", -0.5, -0.85, -0.62, 2),
        spk("surround", -0.88, 0, 0.4),
        spk("surround", 0.88, 0, 0.4),
        spk("height", -0.5, 0.92, -0.4),
        spk("height", 0.5, 0.92, -0.4),
      ];
  }
}

/** Which input bus a speaker draws from, derived from its type + side. */
export function feedForSpeaker(s: Speaker): VoiceFeed {
  switch (s.type) {
    case "subwoofer":
      return "lfe";
    case "center":
    case "soundbar":
      return "mono";
    case "surround":
      return s.nx < 0 ? "side" : "sideInv";
    default:
      return s.nx < -0.02 ? "left" : s.nx > 0.02 ? "right" : "mono";
  }
}

/** Default placement for the Nth (of total) band, spread across a front arc. */
export function bandPlacementFor(rank: number, total: number): Vec3n {
  const t = total <= 1 ? 0.5 : rank / (total - 1);
  const angle = (-100 + t * 200) * (Math.PI / 180); // -100deg .. +100deg
  const r = 0.78;
  return {
    nx: Math.sin(angle) * r,
    ny: -0.2 + t * 0.7,
    nz: -Math.cos(angle) * r,
  };
}

interface PersistShape {
  mode: DimMode;
  signal: DimSignal;
  room: { width: number; height: number; depth: number };
  absorption: number;
  listenerYaw: number;
  layout: LayoutId;
  speakers: Speaker[];
  bandPlacements: Record<string, Vec3n>;
  paletteType: SpeakerType;
  /** Motion Mode parameters (pattern, speed, intensity, reactivity…). */
  motion: MotionConfig;
  /** Room Stage (physical placement) vs Headphone Stage (near-field halo). */
  stage: "room" | "head";
  /** Ambience amount: 0 dry … 0.5 physical room … 1 lush. */
  space: number;
}

const STORAGE_KEY = "killchain.dimension.v1";
// Pre-rebrand key, read once as a fallback so saved room/speaker layouts
// survive the Pulse-Fire → Kill-Chain rename.
const LEGACY_STORAGE_KEY = "pulsefire.dimension.v1";

function defaults(): PersistShape {
  return {
    mode: "speaker",
    signal: "eqd",
    room: {
      width: ROOM_LIMITS.width.default,
      height: ROOM_LIMITS.height.default,
      depth: ROOM_LIMITS.depth.default,
    },
    absorption: ABSORPTION_LIMITS.default,
    listenerYaw: 0,
    layout: "stereo20",
    speakers: layoutSpeakers("stereo20"),
    bandPlacements: {},
    paletteType: "tower",
    motion: { ...DEFAULT_MOTION },
    stage: "head",
    space: 0.5,
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function sanitizeMotion(m: Partial<MotionConfig> | undefined): MotionConfig {
  const d = DEFAULT_MOTION;
  if (!m) return { ...d };
  const pattern = MOTION_PATTERNS.some((p) => p.id === m.pattern)
    ? (m.pattern as MotionPattern)
    : d.pattern;
  return {
    pattern,
    speed: clamp01(Number(m.speed ?? d.speed)),
    intensity: clamp01(Number(m.intensity ?? d.intensity)),
    reactivity: clamp01(Number(m.reactivity ?? d.reactivity)),
    cohesion: clamp01(Number(m.cohesion ?? d.cohesion)),
    anchorLows: m.anchorLows !== false,
  };
}

function load(): PersistShape {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    const d = defaults();
    return {
      ...d,
      ...parsed,
      mode: parsed.mode === "band" || parsed.mode === "motion" ? parsed.mode : "speaker",
      room: { ...d.room, ...(parsed.room ?? {}) },
      speakers:
        Array.isArray(parsed.speakers) && parsed.speakers.length > 0
          ? parsed.speakers.map((s) => ({ ...s, id: s.id || sid() }))
          : d.speakers,
      bandPlacements: parsed.bandPlacements ?? {},
      motion: sanitizeMotion(parsed.motion),
      stage: parsed.stage === "room" ? "room" : "head",
      space: clamp01(Number(parsed.space ?? d.space)),
    };
  } catch {
    return defaults();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(state: DimensionState): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const data: PersistShape = {
      mode: state.mode,
      signal: state.signal,
      room: state.room,
      absorption: state.absorption,
      listenerYaw: state.listenerYaw,
      layout: state.layout,
      speakers: state.speakers,
      bandPlacements: state.bandPlacements,
      paletteType: state.paletteType,
      motion: state.motion,
      stage: state.stage,
      space: state.space,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }, 350);
}

const clampN = (v: number) => Math.max(-1, Math.min(1, v));

export interface DimensionState extends PersistShape {
  active: boolean;
  selectedId: string | null;

  // ── Head tracking (issue #9) — opentrack-protocol UDP → listener yaw ──
  /** True while the UDP listener is running and steering the listener. */
  headTracking: boolean;
  /** UDP port the tracker sends to (opentrack default: 4242). */
  headTrackPort: number;
  /** Latest raw yaw from the tracker (degrees), null before first packet. */
  headTrackYawDeg: number | null;
  /** Yaw captured as "straight ahead" by Recenter (degrees). */
  headTrackZeroDeg: number;
  /** Error string when the listener failed to bind (port in use etc.). */
  headTrackError: string | null;

  setActive: (on: boolean) => void;
  setMode: (mode: DimMode) => void;
  setSignal: (signal: DimSignal) => void;
  setRoom: (patch: Partial<{ width: number; height: number; depth: number }>) => void;
  setAbsorption: (absorption: number) => void;
  applyRoomPreset: (id: RoomPresetId) => void;
  setListenerYaw: (yaw: number) => void;
  setPaletteType: (type: SpeakerType) => void;

  setHeadTracking: (on: boolean) => Promise<void>;
  setHeadTrackPort: (port: number) => void;
  recenterHeadTracking: () => void;

  /** Motion Mode: live-update pattern / speed / intensity / reactivity… */
  setMotion: (patch: Partial<MotionConfig>) => void;
  /** Apply a one-click motion preset (pattern + feel + stage). */
  applyMotionPreset: (id: string) => void;
  /** Room Stage vs Headphone Stage. */
  setStage: (stage: "room" | "head") => void;
  /** Ambience amount 0..1. */
  setSpace: (space: number) => void;

  applyLayout: (id: LayoutId) => void;
  addSpeaker: (type: SpeakerType, at?: { nx: number; nz: number }) => string;
  removeSpeaker: (id: string) => void;
  setSpeakerType: (id: string, type: SpeakerType) => void;
  setSpeakerGain: (id: string, gainDb: number) => void;
  toggleSpeakerEnabled: (id: string) => void;
  moveSpeaker: (id: string, pos: Partial<Vec3n>) => void;

  placeBand: (bandId: string, pos: Partial<Vec3n>) => void;
  autoArrangeBands: () => void;

  select: (id: string | null) => void;
  /** Rebuild the engine voice bank from current state (structural changes). */
  syncStructure: () => void;
  reset: () => void;
}

function buildVoiceSpecs(state: DimensionState): VoiceSpec[] {
  const hx = state.room.width / 2;
  const hy = state.room.height / 2;
  const hz = state.room.depth / 2;
  if (state.mode === "speaker") {
    return state.speakers
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        feed: feedForSpeaker(s),
        x: s.nx * hx,
        y: s.ny * hy,
        z: s.nz * hz,
        gainDb: s.gainDb,
      }));
  }
  if (state.mode === "motion") {
    // Crossover bands arranged in a starting arc; the motion engine takes
    // over their positions the moment 3D is engaged.
    return MOTION_BANDS.map((b, i) => {
      const p = bandPlacementFor(i, MOTION_BANDS.length);
      return {
        id: b.id,
        feed: "mono" as VoiceFeed,
        x: p.nx * hx,
        y: p.ny * hy,
        z: p.nz * hz,
        gainDb: 0,
        bandLoHz: b.lo,
        bandHiHz: b.hi,
        anchor: b.anchor,
      };
    });
  }
  const bands = useEqStore.getState().bands.filter((b) => b.enabled);
  return bands.map((b, i) => {
    const p = state.bandPlacements[b.id] ?? bandPlacementFor(i, bands.length);
    return {
      id: b.id,
      feed: "mono" as VoiceFeed,
      x: p.nx * hx,
      y: p.ny * hy,
      z: p.nz * hz,
      gainDb: 0,
      bandHz: b.freq,
      bandQ: Math.max(0.7, Math.min(8, b.q)),
    };
  });
}

// Module-level head-tracker plumbing (not reactive state): the UDP feed
// steers the engine listener directly at ~30 Hz; the store only gets a
// throttled yaw readout so the UI doesn't re-render per packet.
let headTrackUnsub: (() => void) | null = null;
let headTrackLastUiPush = 0;

export const useDimensionStore = create<DimensionState>((set, get) => {
  const persist = () => schedulePersist(get());

  const pushStructure = () => {
    const engine = getEngine();
    const s = get();
    engine.dimension.setStageProfile(s.stage);
    engine.dimension.setSpace(s.space);
    engine.dimension.setRoom(s.room.width, s.room.height, s.room.depth, s.absorption);
    engine.dimension.setListenerYaw(s.listenerYaw);
    engine.dimension.setVoices(buildVoiceSpecs(s));
    // Motion engine follows the mode: animate the band voices while Motion
    // Mode is engaged, stand down (and leave positions static) otherwise.
    if (s.mode === "motion" && s.active) {
      engine.dimension.startMotion(s.motion);
    } else {
      engine.dimension.stopMotion();
    }
  };

  const stopHeadTracking = () => {
    headTrackUnsub?.();
    headTrackUnsub = null;
    void window.playground?.headtrack?.stop();
    // Return the listener to the manual facing slider.
    getEngine().dimension.setListenerYaw(get().listenerYaw);
  };

  return {
    ...load(),
    active: false,
    selectedId: null,
    headTracking: false,
    headTrackPort: 4242,
    headTrackYawDeg: null,
    headTrackZeroDeg: 0,
    headTrackError: null,

    setActive: (on) => {
      set({ active: on });
      const engine = getEngine();
      if (on) {
        void engine.resume();
        engine.setDimensionSignal(get().signal);
        pushStructure();
      } else {
        engine.dimension.stopMotion();
      }
      engine.setDimensionActive(on);
    },

    setMode: (mode) => {
      set({ mode, selectedId: null });
      pushStructure();
      persist();
    },

    setSignal: (signal) => {
      set({ signal });
      getEngine().setDimensionSignal(signal);
      persist();
    },

    setRoom: (patch) => {
      const room = { ...get().room, ...patch };
      room.width = Math.max(ROOM_LIMITS.width.min, Math.min(ROOM_LIMITS.width.max, room.width));
      room.height = Math.max(ROOM_LIMITS.height.min, Math.min(ROOM_LIMITS.height.max, room.height));
      room.depth = Math.max(ROOM_LIMITS.depth.min, Math.min(ROOM_LIMITS.depth.max, room.depth));
      set({ room });
      pushStructure();
      persist();
    },

    setAbsorption: (absorption) => {
      const a = Math.max(ABSORPTION_LIMITS.min, Math.min(ABSORPTION_LIMITS.max, absorption));
      set({ absorption: a });
      const s = get();
      getEngine().dimension.setRoom(s.room.width, s.room.height, s.room.depth, a);
      persist();
    },

    applyRoomPreset: (id) => {
      const p = ROOM_PRESETS.find((r) => r.id === id);
      if (!p) return;
      set({
        room: { width: p.width, height: p.height, depth: p.depth },
        absorption: p.absorption,
      });
      pushStructure();
      persist();
    },

    setListenerYaw: (yaw) => {
      set({ listenerYaw: yaw });
      // While head tracking drives the listener, the slider only stores the
      // base facing; the tracker keeps ownership of the live yaw.
      if (!get().headTracking) getEngine().dimension.setListenerYaw(yaw);
      persist();
    },

    setHeadTracking: async (on) => {
      const api = window.playground?.headtrack;
      if (!on) {
        stopHeadTracking();
        set({ headTracking: false, headTrackYawDeg: null, headTrackError: null });
        return;
      }
      if (!api) {
        set({ headTrackError: "Head tracking needs the desktop app." });
        return;
      }
      const res = await api.start(get().headTrackPort);
      if (!res.running) {
        set({
          headTracking: false,
          headTrackError: res.error ? `Couldn't open UDP port: ${res.error}` : "Couldn't open the UDP port.",
        });
        return;
      }
      headTrackUnsub?.();
      headTrackUnsub = api.onData((d) => {
        const s = get();
        if (!s.headTracking) return;
        // Tracker yaw is degrees, positive = head turned LEFT in opentrack's
        // convention for most sources; our engine yaw is radians, positive =
        // facing right of front. Apply the recenter offset, then steer.
        const relDeg = d.yaw - s.headTrackZeroDeg;
        const yawRad = (relDeg * Math.PI) / 180 + s.listenerYaw;
        getEngine().dimension.setListenerYaw(yawRad);
        const now = performance.now();
        if (now - headTrackLastUiPush > 150) {
          headTrackLastUiPush = now;
          set({ headTrackYawDeg: d.yaw });
        }
      });
      set({ headTracking: true, headTrackError: null });
    },

    setHeadTrackPort: (port) => {
      const p = Math.max(1, Math.min(65535, Math.round(port) || 4242));
      set({ headTrackPort: p });
      // Rebind live if the tracker is currently running.
      if (get().headTracking) void get().setHeadTracking(true);
    },

    recenterHeadTracking: () => {
      const yaw = get().headTrackYawDeg;
      if (yaw !== null) set({ headTrackZeroDeg: yaw });
    },

    setMotion: (patch) => {
      const motion = sanitizeMotion({ ...get().motion, ...patch });
      set({ motion });
      const s = get();
      if (s.mode === "motion" && s.active) {
        getEngine().dimension.setMotionConfig(motion);
      }
      persist();
    },

    applyMotionPreset: (id) => {
      const preset = MOTION_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      const motion = sanitizeMotion(preset.motion);
      set({ motion, ...(preset.stage ? { stage: preset.stage } : {}) });
      const s = get();
      const engine = getEngine();
      engine.dimension.setStageProfile(s.stage);
      if (s.mode === "motion" && s.active) {
        engine.dimension.setMotionConfig(motion);
      }
      persist();
    },

    setStage: (stage) => {
      set({ stage });
      getEngine().dimension.setStageProfile(stage);
      persist();
    },

    setSpace: (space) => {
      const v = clamp01(space);
      set({ space: v });
      getEngine().dimension.setSpace(v);
      persist();
    },

    setPaletteType: (type) => {
      set({ paletteType: type });
      persist();
    },

    applyLayout: (id) => {
      set({ layout: id, speakers: layoutSpeakers(id), selectedId: null });
      pushStructure();
      persist();
    },

    addSpeaker: (type, at) => {
      const s = spk(
        type,
        at ? clampN(at.nx) : 0,
        type === "height" ? 0.9 : type === "subwoofer" ? -0.85 : 0,
        at ? clampN(at.nz) : -0.5,
      );
      set({ speakers: [...get().speakers, s], selectedId: s.id });
      pushStructure();
      persist();
      return s.id;
    },

    removeSpeaker: (id) => {
      set({
        speakers: get().speakers.filter((s) => s.id !== id),
        selectedId: get().selectedId === id ? null : get().selectedId,
      });
      pushStructure();
      persist();
    },

    setSpeakerType: (id, type) => {
      set({
        speakers: get().speakers.map((s) => (s.id === id ? { ...s, type } : s)),
      });
      pushStructure();
      persist();
    },

    setSpeakerGain: (id, gainDb) => {
      const g = Math.max(-12, Math.min(12, gainDb));
      set({
        speakers: get().speakers.map((s) => (s.id === id ? { ...s, gainDb: g } : s)),
      });
      // Gain is a cheap live param.
      getEngine().dimension.updateVoice(id, { gainDb: g });
      persist();
    },

    toggleSpeakerEnabled: (id) => {
      set({
        speakers: get().speakers.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled } : s,
        ),
      });
      pushStructure();
      persist();
    },

    moveSpeaker: (id, pos) => {
      const s = get().speakers.find((sp) => sp.id === id);
      if (!s) return;
      const nx = pos.nx !== undefined ? clampN(pos.nx) : s.nx;
      const ny = pos.ny !== undefined ? clampN(pos.ny) : s.ny;
      const nz = pos.nz !== undefined ? clampN(pos.nz) : s.nz;
      set({
        speakers: get().speakers.map((sp) =>
          sp.id === id ? { ...sp, nx, ny, nz } : sp,
        ),
      });
      const st = get();
      // Side-derived surrounds can flip channel when crossing centre — a
      // structural change. Otherwise update the single voice live.
      const feedChanged =
        s.type === "surround" && Math.sign(s.nx || 0) !== Math.sign(nx || 0);
      if (feedChanged) {
        pushStructure();
      } else {
        getEngine().dimension.updateVoice(id, {
          x: nx * (st.room.width / 2),
          y: ny * (st.room.height / 2),
          z: nz * (st.room.depth / 2),
        });
      }
      persist();
    },

    placeBand: (bandId, pos) => {
      const cur = get().bandPlacements[bandId] ??
        bandPlacementFor(0, 1);
      const next: Vec3n = {
        nx: pos.nx !== undefined ? clampN(pos.nx) : cur.nx,
        ny: pos.ny !== undefined ? clampN(pos.ny) : cur.ny,
        nz: pos.nz !== undefined ? clampN(pos.nz) : cur.nz,
      };
      set({ bandPlacements: { ...get().bandPlacements, [bandId]: next } });
      const st = get();
      getEngine().dimension.updateVoice(bandId, {
        x: next.nx * (st.room.width / 2),
        y: next.ny * (st.room.height / 2),
        z: next.nz * (st.room.depth / 2),
      });
      persist();
    },

    autoArrangeBands: () => {
      const bands = useEqStore.getState().bands.filter((b) => b.enabled);
      const placements: Record<string, Vec3n> = { ...get().bandPlacements };
      bands.forEach((b, i) => {
        placements[b.id] = bandPlacementFor(i, bands.length);
      });
      set({ bandPlacements: placements });
      pushStructure();
      persist();
    },

    select: (id) => set({ selectedId: id }),

    syncStructure: () => {
      pushStructure();
    },

    reset: () => {
      const d = defaults();
      set({ ...d, selectedId: null });
      const engine = getEngine();
      engine.dimension.stopMotion();
      engine.setDimensionActive(false);
      set({ active: false });
      pushStructure();
      persist();
    },
  };
});
