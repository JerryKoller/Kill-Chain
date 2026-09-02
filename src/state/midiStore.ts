import { create } from "zustand";
import { useAudioStore } from "@/state/audioStore";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireMidiFocusStore } from "@/state/fireMidiFocusStore";
import { useUIStore } from "@/state/uiStore";
import { isBipolar, type SoundParams } from "@/audio/types";

const STORAGE_KEY = "audio-playground.midi.v1";

export type MidiTarget =
  | { kind: "param"; key: keyof SoundParams }
  | { kind: "macro"; name: "warmer" | "cleaner" | "punchier" | "wider" | "bigger" | "tighter" }
  | { kind: "transport"; action: "play-pause" | "next" | "prev" | "snapshot-a" | "swap-ab" }
  /** Macro Reactor pad by 0-based index (toggles; velocity = intensity). */
  | { kind: "reactorPad"; pad: number }
  /** Fire Command performance patch params (macros, gate, harmony mix, etc.). */
  | { kind: "fireParam"; key: string }
  /** Orbit Vault scene recall by 0-based slot. */
  | { kind: "fireScene"; slot: number };

/** Stable equality key — avoid JSON.stringify on every learn-button render. */
export function midiTargetId(t: MidiTarget): string {
  switch (t.kind) {
    case "param": return `param:${t.key}`;
    case "macro": return `macro:${t.name}`;
    case "transport": return `transport:${t.action}`;
    case "reactorPad": return `reactorPad:${t.pad}`;
    case "fireParam": return `fireParam:${t.key}`;
    case "fireScene": return `fireScene:${t.slot}`;
  }
}

export interface MidiMapping {
  /** Composite key = `<deviceId>:<channel>:<cc>` for CC, `<deviceId>:<channel>:N:<note>` for notes. */
  id: string;
  label: string;
  target: MidiTarget;
}

interface MidiState {
  available: boolean;
  /** True after a successful requestMIDIAccess. */
  listening: boolean;
  /** Last access error (permission / unsupported). */
  error: string | null;
  inputs: { id: string; name: string }[];
  mappings: MidiMapping[];
  learning: MidiTarget | null;
  lastMessage: { id: string; label: string; value: number } | null;
  /** Last note activity for UI flash (absolute MIDI pitch). */
  lastNote: { midi: number; vel: number; at: number } | null;
  /** Last activity timestamp per mapping id (for UI flash). */
  lastActiveAt: Record<string, number>;

  startListening: () => Promise<void>;
  /** Drop cached access and re-enumerate (after plugging a controller). */
  rescan: () => Promise<void>;
  setLearning: (target: MidiTarget | null) => void;
  removeMapping: (id: string) => void;
  clearAll: () => void;
}

function loadMappings(): MidiMapping[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // Drop structurally-broken entries — corrupt storage fed straight into
    // the message dispatcher otherwise.
    return (parsed as MidiMapping[]).filter(
      (m) =>
        !!m && typeof m === "object" &&
        typeof m.id === "string" &&
        !!m.target && typeof m.target === "object",
    );
  } catch { return []; }
}

function saveMappings(maps: MidiMapping[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(maps)); }
  catch { /* ignore */ }
}

/** Record a UI-flash timestamp, pruning stale ids so a controller sweep
 *  across many CCs doesn't accumulate hundreds of dead entries forever. */
function touchActivity(
  cur: Record<string, number>,
  id: string,
): Record<string, number> {
  const now = Date.now();
  const next: Record<string, number> = {};
  const keys = Object.keys(cur);
  if (keys.length > 48) {
    for (const k of keys) {
      if (now - cur[k] < 5000) next[k] = cur[k];
    }
  } else {
    Object.assign(next, cur);
  }
  next[id] = now;
  return next;
}

/** One Web MIDI access for the session — avoid stacking listeners on remount. */
let midiAccess: MIDIAccess | null = null;
/** Unsubscribe from native main-process MIDI messages. */
let unsubNativeMidi: (() => void) | null = null;
/** Running status per device (many controllers omit the status byte on subsequent notes). */
const runningStatusByDevice = new Map<string, number>();

function hasNativeMidi(): boolean {
  return typeof window !== "undefined" && !!window.playground?.midi;
}

function refreshInputs(access: MIDIAccess): void {
  const ins: { id: string; name: string }[] = [];
  access.inputs.forEach((inp) => {
    // List every port Chromium exposes; state is usually "connected".
    const label = inp.name ?? "MIDI Input";
    ins.push({
      id: inp.id,
      name: inp.state === "disconnected" ? `${label} (disconnected)` : label,
    });
    try {
      // Some Chromium builds need an explicit open() before messages flow.
      void (inp as MIDIInput & { open?: () => Promise<unknown> }).open?.();
    } catch { /* ignore */ }
    inp.onmidimessage = (msg) => {
      if (msg.data) handleMessage(inp.id, msg.data);
    };
  });
  useMidiStore.setState({ inputs: ins, listening: true, error: null });
}

async function startNativeMidi(): Promise<boolean> {
  const api = window.playground?.midi;
  if (!api) return false;
  if (!unsubNativeMidi) {
    unsubNativeMidi = api.onMessage((msg) => {
      handleMessage(msg.id, msg.bytes);
    });
  }
  const r = await api.start();
  useMidiStore.setState({
    available: true,
    listening: r.ok || r.inputs.length > 0,
    inputs: r.inputs.map((i) => ({ id: i.id, name: i.name })),
    error: r.error,
  });
  if (r.error && r.inputs.length === 0) {
    useUIStore.getState().toast(r.error);
  }
  return r.inputs.length > 0 || r.ok;
}

export const useMidiStore = create<MidiState>((set, get) => ({
  available:
    (typeof window !== "undefined" && !!window.playground?.midi) ||
    (typeof navigator !== "undefined" && "requestMIDIAccess" in navigator),
  listening: false,
  error: null,
  inputs: [],
  mappings: loadMappings(),
  learning: null,
  lastMessage: null,
  lastNote: null,
  lastActiveAt: {},

  startListening: async () => {
    // Prefer native WinMM (Electron) — matches FL Studio's MIDI stack on Windows.
    if (hasNativeMidi()) {
      try {
        await startNativeMidi();
        if (get().inputs.length > 0) return;
        // Fall through to Web MIDI if native saw nothing (rare).
      } catch (err) {
        console.warn("[midi] native host failed:", err);
      }
    }

    if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
      if (!get().inputs.length) {
        set({
          available: hasNativeMidi(),
          error: get().error ?? "No MIDI backend available",
        });
      }
      return;
    }
    try {
      if (!midiAccess) {
        const req = (navigator as Navigator & {
          requestMIDIAccess?: (opts?: { sysex?: boolean; software?: boolean }) => Promise<MIDIAccess>;
        }).requestMIDIAccess;
        if (!req) {
          if (!get().inputs.length) set({ error: "requestMIDIAccess missing" });
          return;
        }
        // Prefer plain access first — `software: true` alone has been observed
        // to confuse some Chromium/Electron builds on Windows.
        // Also race a timeout: WinRT MIDI (before we disable it in main) can
        // hang forever without rejecting.
        const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
          new Promise((resolve, reject) => {
            const t = window.setTimeout(() => reject(new Error("MIDI access timed out")), ms);
            p.then(
              (v) => { window.clearTimeout(t); resolve(v); },
              (e) => { window.clearTimeout(t); reject(e); },
            );
          });
        let access: MIDIAccess;
        try {
          access = await withTimeout(req({ sysex: false }), 5000);
        } catch {
          access = await withTimeout(req(), 5000);
        }
        midiAccess = access;
        access.onstatechange = () => {
          if (midiAccess) refreshInputs(midiAccess);
        };
      }
      // Don't clobber a working native input list with an empty Web MIDI list.
      if (get().inputs.length === 0) refreshInputs(midiAccess);
      else {
        // Still attach Web MIDI listeners as a secondary source.
        midiAccess.inputs.forEach((inp) => {
          inp.onmidimessage = (msg) => {
            if (msg.data) handleMessage(inp.id, msg.data);
          };
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[midi] requestMIDIAccess failed:", err);
      if (get().inputs.length === 0) {
        set({ listening: false, error: msg, inputs: [] });
        useUIStore.getState().toast("MIDI access failed — fully quit and relaunch Kill-Chain");
      }
    }
  },

  rescan: async () => {
    runningStatusByDevice.clear();
    midiAccess = null;
    set({ inputs: [], listening: false, error: null, lastNote: null });
    if (hasNativeMidi()) {
      try {
        await window.playground!.midi!.stop();
      } catch { /* ignore */ }
    }
    await get().startListening();
    const n = get().inputs.length;
    const err = get().error;
    useUIStore.getState().toast(
      n > 0
        ? `MIDI: ${n} input${n === 1 ? "" : "s"} found`
        : err ?? "MIDI: no inputs — quit FL Studio / other DAWs, then Rescan",
    );
  },

  setLearning: (target) => set({ learning: target }),

  removeMapping: (id) => {
    const next = get().mappings.filter((m) => m.id !== id);
    set({ mappings: next });
    saveMappings(next);
  },

  clearAll: () => {
    set({ mappings: [] });
    saveMappings([]);
  },
}));

// ── Raw note forwarding (v1.6) ──
// A registered instrument receives every note-on/off (with velocity) in
// addition to the mapping system — this is how a USB MIDI keyboard plays
// Fire Command live. Registration is view-scoped: the Fire view registers
// on mount and unregisters on unmount, so stray notes never sound while
// you're elsewhere in the app.
export interface MidiNoteHandler {
  noteOn: (midi: number, velocity: number) => void;
  noteOff: (midi: number) => void;
  /** Optional: CC / button octave shifts (rare — MPK Mini does this in hardware). */
  octaveDelta?: (delta: number) => void;
  octaveReset?: () => void;
}

let noteHandler: MidiNoteHandler | null = null;

export function registerMidiNoteHandler(h: MidiNoteHandler | null): void {
  noteHandler = h;
}

function handleMessage(deviceId: string, data: ArrayLike<number>): void {
  if (!data || data.length < 1) return;
  const bytes = Array.from(data);
  let statusByte = bytes[0]!;
  let data1 = 0;
  let data2 = 0;

  // Realtime messages (clock, active sensing) — ignore, keep running status.
  if (statusByte >= 0xf8) return;

  if (statusByte < 0x80) {
    // Running status: reuse last channel voice status for this device.
    const run = runningStatusByDevice.get(deviceId);
    if (run === undefined) return;
    statusByte = run;
    data1 = bytes[0] ?? 0;
    data2 = bytes[1] ?? 0;
  } else if (statusByte >= 0xf0) {
    // SysEx / song select / etc. — clear running status.
    runningStatusByDevice.delete(deviceId);
    return;
  } else {
    runningStatusByDevice.set(deviceId, statusByte);
    data1 = bytes[1] ?? 0;
    data2 = bytes[2] ?? 0;
  }

  const status = statusByte & 0xf0;
  const channel = statusByte & 0x0f;
  // Focus writes Fire knobs / pad nav / PC. Persist still remembers On, but
  // do not mutate the Fire store after the user leaves the Fire view.
  const fireView = useUIStore.getState().view === "fire";

  // Program Change → MPK Focus module jump (Prog Select / Prog Change pads).
  if (status === 0xc0) {
    if (fireView) useFireMidiFocusStore.getState().handleProgramChange(data1);
    useMidiStore.setState({
      lastMessage: { id: `${deviceId}:${channel}:pc:${data1}`, label: `PC ${data1}`, value: data1 / 127 },
    });
    return;
  }

  // Forward raw notes to the live instrument (0x90 vel 0 = note-off).
  // Focus mode steals pad-range notes for PROG / BANK navigation.
  if (noteHandler) {
    if (status === 0x90 && data2 > 0) {
      const stolen = fireView && useFireMidiFocusStore.getState().handleNoteOn(data1, data2 / 127);
      if (!stolen) {
        noteHandler.noteOn(data1, data2 / 127);
        useMidiStore.setState({
          lastNote: { midi: data1, vel: data2 / 127, at: Date.now() },
        });
      } else {
        useMidiStore.setState({
          lastMessage: {
            id: `${deviceId}:${channel}:pad:${data1}`,
            label: `Pad ${data1} (PROG)`,
            value: data2 / 127,
          },
        });
      }
    } else if (status === 0x80 || (status === 0x90 && data2 === 0)) {
      // Always release — pads may have been stolen on note-on but keys need offs.
      noteHandler.noteOff(data1);
    }

    // Optional software octave — some controllers expose ± as CC (not MPK Mini default).
    // Common community mappings: CC 102/103 or CC 16/17 as momentary buttons.
    if (status === 0xb0 && data2 >= 64 && noteHandler.octaveDelta) {
      if (data1 === 102 || data1 === 16) noteHandler.octaveDelta(-1);
      else if (data1 === 103 || data1 === 17) noteHandler.octaveDelta(1);
    }
  }

  let id = "";
  let value = 0;
  let label = "";
  if (status === 0xb0) {
    id = `${deviceId}:${channel}:cc:${data1}`;
    value = data2 / 127;
    label = `CC ${data1} ch${channel + 1}`;

    // Signal Path focus knobs / PROG·BANK nav — but never steal while learning,
    // and never override CCs that already have a MIDI learn mapping.
    const midiSnap = useMidiStore.getState();
    const mapped = midiSnap.mappings.some((m) => m.id === id);
    if (fireView && !midiSnap.learning && !mapped) {
      if (useFireMidiFocusStore.getState().handleCc(data1, value, data2)) {
        useMidiStore.setState({
          lastMessage: { id, label, value },
          lastActiveAt: touchActivity(useMidiStore.getState().lastActiveAt, id),
        });
        return;
      }
    }
  } else if (status === 0x90 && data2 > 0) {
    id = `${deviceId}:${channel}:note:${data1}`;
    value = data2 / 127;
    label = `Note ${data1} ch${channel + 1}`;
  } else {
    return;
  }

  const store = useMidiStore.getState();
  useMidiStore.setState({
    lastMessage: { id, label, value },
    lastActiveAt: touchActivity(store.lastActiveAt, id),
  });

  // Learn mode: create a new mapping for the active target.
  if (store.learning) {
    const target = store.learning;
    const existing = store.mappings.find((m) => m.id === id);
    const mapping: MidiMapping = {
      id,
      label: label + " -> " + describeTarget(target),
      target,
    };
    const maps = existing
      ? store.mappings.map((m) => (m.id === id ? mapping : m))
      : [...store.mappings, mapping];
    useMidiStore.setState({ mappings: maps, learning: null });
    saveMappings(maps);
    useUIStore.getState().toast(`Mapped ${label}`);
    // Drop through and apply the value too.
  }

  // Dispatch to mapped target.
  const mapping = useMidiStore.getState().mappings.find((m) => m.id === id);
  if (!mapping) return;
  applyMidi(mapping.target, value);
}

function describeTarget(t: MidiTarget): string {
  if (t.kind === "param") return t.key;
  if (t.kind === "macro") return `macro:${t.name}`;
  if (t.kind === "reactorPad") return `reactor pad ${t.pad + 1}`;
  if (t.kind === "fireParam") return `fire:${t.key}`;
  if (t.kind === "fireScene") return `scene ${t.slot + 1}`;
  return `transport:${t.action}`;
}

/**
 * Map a 0..1 CC onto a Fire patch value. Mixes / macros stay 0–1; Hz, cents,
 * voice counts, and octaves get the ranges the knobs actually use.
 */
export function mapFireMidiValue(key: string, n01: number): number {
  const n = Math.max(0, Math.min(1, n01));
  switch (key) {
    case "filterCutoff":
      return 20 * Math.pow(18000 / 20, n);
    case "filterResonance":
      return 0.1 + n * 27.9;
    case "unison":
      return Math.round(1 + n * 6);
    case "unisonDetune":
      return n * 50;
    case "oscAOctave":
    case "oscBOctave":
    case "oscCOctave":
    case "subOctave":
      return Math.round(-2 + n * 4);
    case "oscADetune":
    case "oscBDetune":
    case "oscCDetune":
      return (n * 2 - 1) * 50;
    case "lfo1Rate":
    case "lfo2Rate":
      return 0.05 + n * 29.95;
    case "ampAttack":
    case "ampDecay":
    case "ampRelease":
    case "filterAttack":
    case "filterDecay":
    case "filterRelease":
      return 0.001 + n * 2.999;
    case "delayTime":
      return 0.01 + n * 1.49;
    case "masterGain":
      return n * 1.2;
    default:
      return n;
  }
}

function applyMidi(target: MidiTarget, normalized: number): void {
  // Focus CC/PC/pads already skip off Fire. Learned fireParam / fireScene
  // used to keep writing the synth from Library, Sculptor, etc.
  if (
    (target.kind === "fireParam" || target.kind === "fireScene") &&
    useUIStore.getState().view !== "fire"
  ) {
    return;
  }
  const audio = useAudioStore.getState();
  if (target.kind === "param") {
    const v = isBipolar(target.key) ? normalized * 2 - 1 : normalized;
    const next = { ...audio.params, [target.key]: v };
    audio.replaceParams(next);
    return;
  }
  if (target.kind === "fireParam") {
    const key = target.key as keyof import("@/audio/dsp/FireCommandSynth").FirePatch;
    const value = mapFireMidiValue(target.key, normalized);
    useFireCommandStore.getState().setParam(key, value as never);
    return;
  }
  if (target.kind === "fireScene") {
    if (normalized < 0.4) return;
    useFireCommandStore.getState().recallScene(target.slot);
    return;
  }
  if (target.kind === "macro") {
    // Fire only on a value rise (note-on / button press above 50%).
    if (normalized < 0.4) return;
    // Same effect as the macro buttons. We re-implement here to avoid
    // a circular import with useRemoteServer.
    const MACROS: Record<string, Partial<SoundParams>> = {
      warmer:    { warmth: 0.2, bass: 0.1, harmonics: 0.1, sparkle: -0.05 },
      cleaner:   { clarity: 0.15, air: 0.15, harmonics: -0.05, saturation: -0.05 },
      punchier:  { punch: 0.2, compression: 0.15, bass: 0.1 },
      wider:     { width: 0.2, spatial: 0.15, reverbAmount: 0.05 },
      bigger:    { subBass: 0.2, reverbSize: 0.1, spatial: 0.1 },
      tighter:   { subBass: -0.1, bass: -0.05, compression: 0.1, punch: 0.1 },
    };
    const m = MACROS[target.name];
    if (!m) return;
    const cur = audio.params;
    const next: SoundParams = { ...cur };
    for (const [k, dv] of Object.entries(m) as [keyof SoundParams, number][]) {
      const lo = isBipolar(k) ? -1 : 0;
      next[k] = Math.max(lo, Math.min(1, cur[k] + dv));
    }
    audio.replaceParams(next);
    return;
  }
  if (target.kind === "reactorPad") {
    // Fire only on a value rise (note-on / button press above 40%);
    // velocity scales the pad's intensity. Dispatch is dynamic to avoid
    // a circular import (reactorStore -> audioStore -> ...).
    if (normalized < 0.4) return;
    import("@/state/reactorStore").then(({ useReactorStore }) => {
      useReactorStore.getState().midiTrigger(target.pad, normalized);
    });
    return;
  }
  if (target.kind === "transport") {
    if (normalized < 0.4) return;
    import("@/state/playerStore").then(({ usePlayerStore }) => {
      const p = usePlayerStore.getState();
      switch (target.action) {
        case "play-pause": void p.toggle(); break;
        case "next":       void p.next(); break;
        case "prev":       void p.previous(); break;
        case "snapshot-a": audio.storeAB(); break;
        case "swap-ab":    if (audio.abSnapshot) audio.swapAB(); break;
      }
    });
  }
}
