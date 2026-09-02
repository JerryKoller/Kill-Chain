import { create } from "zustand";
import { isBipolar, SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import { useAudioStore } from "@/state/audioStore";
import { suppressEngageSounds } from "@/audio/uiSounds";

/**
 * Macro Reactor — performance-surface state.
 *
 * Pads apply *deltas* on top of a baseline snapshot taken when the first pad
 * engages. Engagements ramp in/out over ~150 ms at a 30 Hz tick so strikes
 * never zipper, and all param writes go through `previewParams` (no undo
 * spam). Releasing the last pad — or leaving the view — restores exactly the
 * touched params from the baseline. "Keep" bakes the stack via
 * `replaceParams` (single undo step).
 *
 * Pad definitions (name / mode / deltas) and scenes persist under NEW
 * localStorage keys; factory content is merged in by id so stored data never
 * breaks across updates.
 */

export type PadMode = "latch" | "momentary";

export interface ReactorPad {
  id: string;
  name: string;
  icon: string;
  accent: string;
  mode: PadMode;
  description: string;
  deltas: Partial<SoundParams>;
}

export interface PadEngagement {
  /** 0..1 — scales the pad's deltas (vertical strike position / MIDI velocity). */
  intensity: number;
  /** 0..1 attack/release ramp position. */
  ramp: number;
  phase: "in" | "hold" | "out";
}

export interface ReactorScene {
  name: string;
  pads: { id: string; intensity: number }[];
  savedAt: number;
}

const PADS_KEY = "killchain.reactor.pads.v1";
const SCENES_KEY = "killchain.reactor.scenes.v1";

export const SCENE_SLOT_COUNT = 4;

const TICK_MS = 33; // ~30 Hz param pushes
const RAMP_IN_MS = 130;
const RAMP_OUT_MS = 170;
const MIN_INTENSITY = 0.05;

export const FACTORY_PADS: ReactorPad[] = [
  {
    id: "dive",
    name: "LOW-PASS DIVE",
    icon: "▼",
    accent: "#ffb648",
    mode: "momentary",
    description: "Shelves the top end into the floor — the classic filter dive. Hold it, then let go.",
    deltas: {
      air: -0.9, sparkle: -0.95, clarity: -0.6, presence: -0.4, vocals: -0.15,
      warmth: 0.3, bass: 0.2, subBass: 0.15, reverbAmount: 0.1,
    },
  },
  {
    id: "telephone",
    name: "TELEPHONE",
    icon: "☏",
    accent: "#ff8a48",
    mode: "latch",
    description: "Band-limited long-distance squawk: no lows, no highs, all midrange bark.",
    deltas: {
      subBass: -0.95, bass: -0.85, warmth: -0.55, mid: 0.55, vocals: 0.6,
      presence: 0.5, clarity: 0.15, air: -0.9, sparkle: -0.95, width: -0.85,
      reverbAmount: -0.4, saturation: 0.4, compression: 0.45, harmonics: 0.2,
    },
  },
  {
    id: "widen",
    name: "WIDEN",
    icon: "⇔",
    accent: "#48ffd1",
    mode: "latch",
    description: "Blows the stage open — width, crossfeed and high-band spread.",
    deltas: {
      width: 0.7, spatial: 0.55, airWidth: 0.45, presenceWidth: 0.2,
      air: 0.2, reverbAmount: 0.15, reverbSize: 0.25,
    },
  },
  {
    id: "crush",
    name: "CRUSH",
    icon: "▩",
    accent: "#ff5b8a",
    mode: "latch",
    description: "Drive, grit and glue — slams the mix through saturated iron.",
    deltas: {
      saturation: 0.75, harmonics: 0.55, compression: 0.5, punch: 0.35,
      lofiAge: 0.4, texture: 0.25, presence: 0.15,
    },
  },
  {
    id: "halfspeed",
    name: "HALF-SPEED",
    icon: "◐",
    accent: "#a06bff",
    mode: "latch",
    description: "Tape-slow space: reverb swells, transients melt, wow/flutter wobbles. Does not change playback speed.",
    deltas: {
      reverbAmount: 0.5, reverbSize: 0.75, texture: 0.5, punch: -0.4,
      air: -0.3, sparkle: -0.35, warmth: 0.25, body: 0.15,
      lofiWowFlutter: 0.3, compression: 0.2, spatial: 0.25,
    },
  },
  {
    id: "duck",
    name: "DUCK",
    icon: "▽",
    accent: "#48cfff",
    mode: "momentary",
    description: "Pulls the mix back into the floor — hold for talk-over and transition dips.",
    deltas: {
      body: -0.35, mid: -0.4, vocals: -0.25, presence: -0.25,
      compression: 0.45, width: -0.2, punch: -0.3, reverbAmount: 0.05,
    },
  },
  {
    id: "airraid",
    name: "AIR RAID",
    icon: "▲",
    accent: "#9dff5b",
    mode: "momentary",
    description: "High-pass climb — floor drops away, sirens up. Hold through the riser.",
    deltas: {
      subBass: -0.7, bass: -0.5, warmth: -0.3, presence: 0.5, clarity: 0.6,
      air: 0.85, sparkle: 0.9, width: 0.35, reverbSize: 0.35, harmonics: 0.3,
    },
  },
  {
    id: "comms",
    name: "RADIO COMMS",
    icon: "⌁",
    accent: "#c4b454",
    mode: "latch",
    description: "Dusty squad-net box: narrow, gritty, mission-audio midrange.",
    deltas: {
      lofiAge: 0.65, lofiWear: 0.5, saturation: 0.55, mid: 0.45, vocals: 0.4,
      presence: 0.35, subBass: -0.9, bass: -0.65, warmth: -0.35,
      air: -0.75, sparkle: -0.8, width: -0.7, compression: 0.55,
    },
  },
];

const VALID_KEYS = new Set<string>(SOUND_PARAM_META.map((m) => m.key));

function clampDelta(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function clampIntensity(v: number): number {
  return Math.max(MIN_INTENSITY, Math.min(1, Number.isFinite(v) ? v : 1));
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function sanitizeDeltas(raw: unknown): Partial<SoundParams> {
  const out: Partial<SoundParams> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_KEYS.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    // Zero deltas are kept: an editor row parked at 0 must not vanish.
    out[k as keyof SoundParams] = clampDelta(n);
  }
  return out;
}

function loadPads(): ReactorPad[] {
  const pads = FACTORY_PADS.map((p) => ({ ...p, deltas: { ...p.deltas } }));
  if (typeof window === "undefined") return pads;
  try {
    const raw = window.localStorage.getItem(PADS_KEY);
    if (!raw) return pads;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return pads;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const base = pads.find((p) => p.id === item.id);
      if (!base) continue;
      if (typeof item.name === "string" && item.name.trim()) {
        base.name = item.name.trim().slice(0, 40);
      }
      if (item.mode === "latch" || item.mode === "momentary") base.mode = item.mode;
      if (item.deltas && typeof item.deltas === "object") {
        base.deltas = sanitizeDeltas(item.deltas);
      }
    }
    return pads;
  } catch (err) {
    console.warn("[reactor] failed to load pads:", err);
    return pads;
  }
}

// Debounced — the PadEditor's delta sliders call updatePad per input event,
// and a synchronous localStorage write per pointermove janks the drag.
let padsPersistTimer: number | null = null;
let padsPending: ReactorPad[] | null = null;

function persistPadsImmediate(pads: ReactorPad[]): void {
  if (typeof window === "undefined") return;
  try {
    const slim = pads.map((p) => ({ id: p.id, name: p.name, mode: p.mode, deltas: p.deltas }));
    window.localStorage.setItem(PADS_KEY, JSON.stringify(slim));
  } catch (err) {
    console.warn("[reactor] failed to persist pads:", err);
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Reactor pads", err),
    );
  }
}

function persistPads(pads: ReactorPad[]): void {
  if (typeof window === "undefined") return;
  padsPending = pads;
  if (padsPersistTimer != null) window.clearTimeout(padsPersistTimer);
  padsPersistTimer = window.setTimeout(() => {
    padsPersistTimer = null;
    const payload = padsPending;
    padsPending = null;
    if (payload) persistPadsImmediate(payload);
  }, 300);
}

/** Write a pending pad-edit debounce now (leave / refresh). */
export function flushPadsPersist(): void {
  if (typeof window === "undefined") return;
  if (padsPersistTimer != null) {
    window.clearTimeout(padsPersistTimer);
    padsPersistTimer = null;
  }
  if (!padsPending) return;
  const payload = padsPending;
  padsPending = null;
  persistPadsImmediate(payload);
}

function loadScenes(): (ReactorScene | null)[] {
  const empty: (ReactorScene | null)[] = Array.from({ length: SCENE_SLOT_COUNT }, () => null);
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(SCENES_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return empty;
    return empty.map((_, i) => {
      const s = parsed[i];
      if (!s || typeof s !== "object" || !Array.isArray(s.pads)) return null;
      const pads = s.pads
        .filter((p: unknown): p is { id: string; intensity: number } =>
          !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string")
        .map((p: { id: string; intensity: number }) => ({
          id: p.id,
          intensity: clampIntensity(Number(p.intensity)),
        }));
      if (pads.length === 0) return null;
      return {
        name: typeof s.name === "string" ? s.name.slice(0, 48) : `SCENE ${i + 1}`,
        pads,
        savedAt: Number(s.savedAt) || Date.now(),
      };
    });
  } catch (err) {
    console.warn("[reactor] failed to load scenes:", err);
    return empty;
  }
}

function persistScenes(scenes: (ReactorScene | null)[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCENES_KEY, JSON.stringify(scenes));
  } catch (err) {
    console.warn("[reactor] failed to persist scenes:", err);
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Reactor scenes", err),
    );
  }
}

interface ReactorState {
  pads: ReactorPad[];
  /** Live engagements keyed by pad id (includes ramping-out pads). */
  engaged: Record<string, PadEngagement>;
  /** Sound before the first pad engaged; null when the reactor is cold. */
  baseline: SoundParams | null;
  scenes: (ReactorScene | null)[];
  /** True while the Reactor view is mounted (gates MIDI triggers). */
  sessionActive: boolean;
  lastKept: string | null;

  setSessionActive: (active: boolean) => void;
  engagePad: (id: string, intensity: number) => void;
  releasePad: (id: string) => void;
  togglePad: (id: string, intensity: number) => void;
  setPadIntensity: (id: string, intensity: number) => void;
  /** MIDI note-on / CC rise (0-based index, velocity 0..1). Latch toggles; momentary engages. */
  midiTrigger: (padIndex: number, velocity: number) => void;
  /** MIDI note-off / CC fall — releases a momentary pad; latch is unchanged. */
  midiRelease: (padIndex: number) => void;
  /** Bake the current stack into the sculpt. Returns the kept label. */
  keep: () => string | null;
  /** Release everything and restore the baseline sound. */
  resetAll: () => void;

  updatePad: (
    id: string,
    patch: Partial<Pick<ReactorPad, "name" | "mode" | "deltas">>,
  ) => void;
  restorePad: (id: string) => void;
  restoreAllPads: () => void;

  saveScene: (slot: number) => boolean;
  recallScene: (slot: number) => boolean;
  clearScene: (slot: number) => void;
}

// ── Module-level engine internals (not reactive state) ──
let loopId: number | null = null;
let lastTickTs = 0;
const pendingIntensity = new Map<string, number>();
const touched = new Set<keyof SoundParams>();
/** Bypass state when the baseline was captured. Engaging a pad from clean
 *  standby flips the chain live (deltas must be audible); standing down must
 *  restore that too, or the app is left "ENGAGED" with neutral params and the
 *  bit-transparent bypass guarantee silently gone. */
let baselineBypass: boolean | null = null;

function restoreBaselineBypass(): void {
  if (baselineBypass === null) return;
  const want = baselineBypass;
  baselineBypass = null;
  const audio = useAudioStore.getState();
  if (audio.bypass !== want) {
    // Programmatic stand-down — keep it silent (no disengage clunk/chug).
    suppressEngageSounds();
    audio.setBypass(want);
  }
}

function startLoop(): void {
  if (loopId != null || typeof window === "undefined") return;
  lastTickTs = performance.now();
  loopId = window.setInterval(tick, TICK_MS);
}

function stopLoop(): void {
  if (loopId != null) {
    window.clearInterval(loopId);
    loopId = null;
  }
}

/** One 30 Hz engine tick: advance ramps, merge deltas, push to the DSP. */
function tick(): void {
  const now = performance.now();
  const dt = Math.min(100, now - lastTickTs);
  lastTickTs = now;

  const st = useReactorStore.getState();
  const { engaged, baseline, pads } = st;
  if (!baseline) {
    pendingIntensity.clear();
    stopLoop();
    return;
  }

  const next: Record<string, PadEngagement> = {};
  for (const [id, eng] of Object.entries(engaged)) {
    let { intensity, ramp, phase } = eng;
    const pend = pendingIntensity.get(id);
    if (pend != null) intensity = pend;
    if (phase === "in") {
      ramp = Math.min(1, ramp + dt / RAMP_IN_MS);
      if (ramp >= 1) phase = "hold";
    } else if (phase === "out") {
      ramp -= dt / RAMP_OUT_MS;
      if (ramp <= 0) continue; // fully released — drop the engagement
    }
    next[id] = { intensity, ramp, phase };
  }
  pendingIntensity.clear();

  const ids = Object.keys(next);
  if (ids.length === 0) {
    // Last pad released: restore exactly what we touched, then stand down.
    const restore: Partial<SoundParams> = {};
    for (const k of touched) restore[k] = baseline[k];
    touched.clear();
    useReactorStore.setState({ engaged: {}, baseline: null });
    if (Object.keys(restore).length > 0) {
      useAudioStore.getState().previewParams(restore);
    }
    restoreBaselineBypass();
    stopLoop();
    return;
  }

  // Merge: baseline + Σ pad.deltas × intensity × eased(ramp), clamped.
  const out: Partial<SoundParams> = {};
  for (const k of touched) out[k] = baseline[k];
  const padById = new Map(pads.map((p) => [p.id, p]));
  for (const id of ids) {
    const pad = padById.get(id);
    if (!pad) continue;
    const eng = next[id];
    const eff = eng.intensity * smoothstep(eng.ramp);
    if (eff <= 0) continue;
    for (const [k, d] of Object.entries(pad.deltas) as [keyof SoundParams, number][]) {
      const lo = isBipolar(k) ? -1 : 0;
      out[k] = Math.max(lo, Math.min(1, (out[k] ?? baseline[k]) + d * eff));
    }
  }
  if (Object.keys(out).length > 0) {
    useAudioStore.getState().previewParams(out);
  }
  useReactorStore.setState({ engaged: next });

  // Loop can idle once every ramp holds and no intensity edits are queued.
  const settled = ids.every((id) => next[id].phase === "hold");
  if (settled && pendingIntensity.size === 0) stopLoop();
}

export const useReactorStore = create<ReactorState>((set, get) => ({
  pads: loadPads(),
  engaged: {},
  baseline: null,
  scenes: loadScenes(),
  sessionActive: false,
  lastKept: null,

  setSessionActive: (active) => {
    set({ sessionActive: active });
    if (!active) get().resetAll();
  },

  engagePad: (id, intensity) => {
    const pad = get().pads.find((p) => p.id === id);
    if (!pad) return;
    if (!get().baseline) {
      const audio = useAudioStore.getState();
      baselineBypass = audio.bypass;
      // The first tick's previewParams may flip the chain live — that flip
      // must not fire the ENGAGE clunk + riff mid-performance (issue #3).
      if (audio.bypass) suppressEngageSounds();
      set({ baseline: { ...audio.params } });
    }
    for (const k of Object.keys(pad.deltas)) touched.add(k as keyof SoundParams);
    const prev = get().engaged[id];
    set({
      engaged: {
        ...get().engaged,
        [id]: {
          intensity: clampIntensity(intensity),
          ramp: prev ? prev.ramp : 0,
          phase: "in",
        },
      },
    });
    startLoop();
  },

  releasePad: (id) => {
    const eng = get().engaged[id];
    if (!eng || eng.phase === "out") return;
    set({ engaged: { ...get().engaged, [id]: { ...eng, phase: "out" } } });
    startLoop();
  },

  togglePad: (id, intensity) => {
    const eng = get().engaged[id];
    if (eng && eng.phase !== "out") get().releasePad(id);
    else get().engagePad(id, intensity);
  },

  setPadIntensity: (id, intensity) => {
    const eng = get().engaged[id];
    if (!eng || eng.phase === "out") return;
    pendingIntensity.set(id, clampIntensity(intensity));
    startLoop();
  },

  midiTrigger: (padIndex, velocity) => {
    if (!get().sessionActive) return;
    const pad = get().pads[padIndex];
    if (!pad) return;
    const intensity = clampIntensity(velocity);
    if (pad.mode === "momentary") get().engagePad(pad.id, intensity);
    else get().togglePad(pad.id, intensity);
  },

  midiRelease: (padIndex) => {
    if (!get().sessionActive) return;
    const pad = get().pads[padIndex];
    if (!pad || pad.mode !== "momentary") return;
    get().releasePad(pad.id);
  },

  keep: () => {
    const { engaged, baseline, pads } = get();
    const active = Object.entries(engaged).filter(([, e]) => e.phase !== "out");
    if (!baseline || active.length === 0) return null;
    const padById = new Map(pads.map((p) => [p.id, p]));
    // Bake at full ramp — the sound the user aimed for, not a mid-attack frame.
    const audio = useAudioStore.getState();
    const out = { ...audio.params };
    for (const k of touched) out[k] = baseline[k];
    for (const [id, eng] of active) {
      const pad = padById.get(id);
      if (!pad) continue;
      for (const [k, d] of Object.entries(pad.deltas) as [keyof SoundParams, number][]) {
        const lo = isBipolar(k) ? -1 : 0;
        out[k] = Math.max(lo, Math.min(1, out[k] + d * eng.intensity));
      }
    }
    const label = active
      .map(([id]) => padById.get(id)?.name ?? id)
      .join(" + ");
    // Preview frames never entered undo history. Snap params back to the
    // walk-in sound (DSP stays on the live stack until replaceParams) so
    // Undo after Keep restores the pre-reactor sculpt, not the last tick.
    const undoSnap = { ...audio.params };
    for (const k of touched) undoSnap[k] = baseline[k];
    pendingIntensity.clear();
    touched.clear();
    stopLoop();
    // Keeping bakes the engaged sound — the chain stays live, so just drop
    // the remembered bypass instead of restoring it.
    baselineBypass = null;
    set({ engaged: {}, baseline: null, lastKept: label });
    useAudioStore.setState({ params: undoSnap });
    useAudioStore.getState().replaceParams(out);
    return label;
  },

  resetAll: () => {
    const { baseline } = get();
    pendingIntensity.clear();
    stopLoop();
    if (baseline) {
      const restore: Partial<SoundParams> = {};
      for (const k of touched) restore[k] = baseline[k];
      if (Object.keys(restore).length > 0) {
        useAudioStore.getState().previewParams(restore);
      }
    }
    touched.clear();
    restoreBaselineBypass();
    set({ engaged: {}, baseline: null });
  },

  updatePad: (id, patch) => {
    const pads = get().pads.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (patch.name !== undefined) {
        next.name = patch.name.trim().slice(0, 40) || p.name;
      }
      if (patch.mode !== undefined) next.mode = patch.mode;
      if (patch.deltas !== undefined) next.deltas = sanitizeDeltas(patch.deltas);
      return next;
    });
    set({ pads });
    persistPads(pads);
    // Momentary means "only while held" — a latched pad flipped to Mom
    // must not stay on with nobody holding it.
    if (patch.mode === "momentary") {
      const live = get().engaged[id];
      if (live && live.phase !== "out") get().releasePad(id);
    }
    // Live-edit support: re-merge immediately if the pad is engaged.
    const eng = get().engaged[id];
    if (eng && eng.phase !== "out") {
      const pad = pads.find((p) => p.id === id);
      if (pad) {
        for (const k of Object.keys(pad.deltas)) touched.add(k as keyof SoundParams);
      }
      startLoop();
    }
  },

  restorePad: (id) => {
    const factory = FACTORY_PADS.find((p) => p.id === id);
    if (!factory) return;
    get().updatePad(id, {
      name: factory.name,
      mode: factory.mode,
      deltas: { ...factory.deltas },
    });
  },

  restoreAllPads: () => {
    const pads = FACTORY_PADS.map((p) => ({ ...p, deltas: { ...p.deltas } }));
    set({ pads });
    persistPads(pads);
    // Factory Dive / Duck / Air Raid are momentary — a latched custom
    // strike must not stay on after the pad is restored to "hold only".
    for (const [id, eng] of Object.entries(get().engaged)) {
      if (eng.phase === "out") continue;
      const pad = pads.find((p) => p.id === id);
      if (!pad) continue;
      if (pad.mode === "momentary") {
        get().releasePad(id);
        continue;
      }
      for (const k of Object.keys(pad.deltas)) touched.add(k as keyof SoundParams);
    }
    startLoop();
  },

  saveScene: (slot) => {
    if (slot < 0 || slot >= SCENE_SLOT_COUNT) return false;
    const { engaged, pads } = get();
    const active = Object.entries(engaged).filter(([, e]) => e.phase !== "out");
    if (active.length === 0) return false;
    const padById = new Map(pads.map((p) => [p.id, p]));
    const scene: ReactorScene = {
      name: active
        .map(([id]) => padById.get(id)?.name ?? id)
        .join(" + ")
        .slice(0, 48),
      pads: active.map(([id, e]) => ({ id, intensity: e.intensity })),
      savedAt: Date.now(),
    };
    const scenes = [...get().scenes];
    scenes[slot] = scene;
    set({ scenes });
    persistScenes(scenes);
    return true;
  },

  recallScene: (slot) => {
    const scene = get().scenes[slot];
    if (!scene) return false;
    const valid = scene.pads.filter((p) => get().pads.some((x) => x.id === p.id));
    if (valid.length === 0) return false;
    const inScene = new Set(valid.map((p) => p.id));
    for (const [id, eng] of Object.entries(get().engaged)) {
      if (!inScene.has(id) && eng.phase !== "out") get().releasePad(id);
    }
    for (const p of valid) get().engagePad(p.id, p.intensity);
    return true;
  },

  clearScene: (slot) => {
    if (slot < 0 || slot >= SCENE_SLOT_COUNT) return;
    const scenes = [...get().scenes];
    scenes[slot] = null;
    set({ scenes });
    persistScenes(scenes);
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    flushPadsPersist();
  });
}
