import { create } from "zustand";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { isBipolar, type SoundParams } from "@/audio/types";

const STORAGE_KEY = "audio-playground.midi.v1";

export type MidiTarget =
  | { kind: "param"; key: keyof SoundParams }
  | { kind: "macro"; name: "warmer" | "cleaner" | "punchier" | "wider" | "bigger" | "tighter" }
  | { kind: "transport"; action: "play-pause" | "next" | "prev" | "snapshot-a" | "swap-ab" }
  /** Macro Reactor pad by 0-based index (toggles; velocity = intensity). */
  | { kind: "reactorPad"; pad: number };

export interface MidiMapping {
  /** Composite key = `<deviceId>:<channel>:<cc>` for CC, `<deviceId>:<channel>:N:<note>` for notes. */
  id: string;
  label: string;
  target: MidiTarget;
}

interface MidiState {
  available: boolean;
  inputs: { id: string; name: string }[];
  mappings: MidiMapping[];
  learning: MidiTarget | null;
  lastMessage: { id: string; label: string; value: number } | null;
  /** Last activity timestamp per mapping id (for UI flash). */
  lastActiveAt: Record<string, number>;

  startListening: () => Promise<void>;
  setLearning: (target: MidiTarget | null) => void;
  removeMapping: (id: string) => void;
  clearAll: () => void;
}

function loadMappings(): MidiMapping[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MidiMapping[]) : [];
  } catch { return []; }
}

function saveMappings(maps: MidiMapping[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(maps)); }
  catch { /* ignore */ }
}

export const useMidiStore = create<MidiState>((set, get) => ({
  available: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
  inputs: [],
  mappings: loadMappings(),
  learning: null,
  lastMessage: null,
  lastActiveAt: {},

  startListening: async () => {
    if (!get().available) return;
    try {
      const access = await (navigator as Navigator & {
        requestMIDIAccess?: () => Promise<MIDIAccess>;
      }).requestMIDIAccess?.();
      if (!access) return;

      const ins: { id: string; name: string }[] = [];
      access.inputs.forEach((inp) => {
        ins.push({ id: inp.id, name: inp.name ?? "MIDI Input" });
        inp.onmidimessage = (msg) => handleMessage(inp.id, msg);
      });
      set({ inputs: ins });
      access.onstatechange = () => {
        const cur: { id: string; name: string }[] = [];
        access.inputs.forEach((inp) => {
          cur.push({ id: inp.id, name: inp.name ?? "MIDI Input" });
          inp.onmidimessage = (m) => handleMessage(inp.id, m);
        });
        set({ inputs: cur });
      };
    } catch (err) {
      console.warn("[midi] requestMIDIAccess failed:", err);
    }
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

function handleMessage(deviceId: string, msg: MIDIMessageEvent): void {
  if (!msg.data || msg.data.length < 3) return;
  const [statusByte, data1, data2] = msg.data;
  const status = statusByte & 0xf0;
  const channel = statusByte & 0x0f;

  let id = "";
  let value = 0;
  let label = "";
  if (status === 0xb0) {
    id = `${deviceId}:${channel}:cc:${data1}`;
    value = data2 / 127;
    label = `CC ${data1} ch${channel + 1}`;
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
    lastActiveAt: { ...store.lastActiveAt, [id]: Date.now() },
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
  return `transport:${t.action}`;
}

function applyMidi(target: MidiTarget, normalized: number): void {
  const audio = useAudioStore.getState();
  if (target.kind === "param") {
    const v = isBipolar(target.key) ? normalized * 2 - 1 : normalized;
    const next = { ...audio.params, [target.key]: v };
    audio.replaceParams(next);
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
