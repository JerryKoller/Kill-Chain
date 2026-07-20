/**
 * fireSequencerStore — the Fire Command pattern sequencer (FL-studio style).
 *
 * Owns:
 *   · a piano-roll pattern (notes with step/pitch/length/velocity),
 *   · an 8-lane × N-step drum grid,
 *   · transport (bpm, swing, bars, play state),
 *   · the look-ahead scheduler that fires both into the audio engine.
 *
 * Timing model: steps are 16th notes. The scheduler wakes every 25 ms and
 * schedules everything inside a 120 ms look-ahead window directly on the
 * AudioContext clock (`synth.playNote` / `drums.trigger` take `when`), so
 * playback is sample-accurate regardless of main-thread jank. The UI
 * playhead reads `getPlayheadStep()` from its own RAF loop — the scheduler
 * never touches React state while running.
 */

import { create } from "zustand";
import { getEngine } from "@/audio/AudioEngine";
import { DRUM_LANES, type DrumLane } from "@/audio/dsp/FireDrumKit";
import { DEFAULT_FIRE_PATCH, makeModMatrix } from "@/audio/dsp/FireCommandSynth";
import { audioUrlForPath } from "@/state/libraryStore";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Sample plumbing (drum overrides + the sample deck) ──
// Decoded AudioBuffers are cached per file path; the persisted state only
// carries paths, so projects stay small and buffers hydrate lazily.
const sampleBuffers = new Map<string, AudioBuffer>();

export async function loadSampleBuffer(filePath: string): Promise<AudioBuffer | null> {
  const cached = sampleBuffers.get(filePath);
  if (cached) return cached;
  try {
    const res = await fetch(audioUrlForPath(filePath));
    const raw = await res.arrayBuffer();
    const buf = await getEngine().ctx.decodeAudioData(raw);
    sampleBuffers.set(filePath, buf);
    return buf;
  } catch (err) {
    console.warn("[fireSeq] sample decode failed:", filePath, err);
    return null;
  }
}

export function peekSampleBuffer(filePath: string): AudioBuffer | null {
  return sampleBuffers.get(filePath) ?? null;
}

/** One row in the SAMPLE DECK: an operator-loaded sound step-sequenced like a drum lane. */
export interface SampleLane {
  id: string;
  name: string;
  path: string;
  level: number;
  steps: number[];
}

export const MAX_SAMPLE_LANES = 6;

// ── data model ──

/** Which instrument a piano-roll note fires: 0 = Synth A, 1 = Synth B. */
export type SynthChannel = 0 | 1;

export interface RollNote {
  id: string;
  /** start position in 16th-note steps (can be fractional for off-grid). */
  step: number;
  /** MIDI pitch. */
  midi: number;
  /** length in steps (min 0.25). */
  len: number;
  /** 0..1 */
  vel: number;
  /** Instrument channel (issue #11). Older saves default to Synth A. */
  ch: SynthChannel;
}

export const STEPS_PER_BAR = 16;
export const MAX_BARS = 8;

// ── Scales (piano-roll highlight + snap) ──

export type ScaleId =
  | "off" | "minor" | "major" | "pentMinor" | "blues"
  | "dorian" | "phrygian" | "harmMinor";

export const SCALES: { id: ScaleId; label: string; steps: number[] }[] = [
  { id: "off", label: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: "minor", label: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major", label: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "pentMinor", label: "Pent. Minor", steps: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  { id: "dorian", label: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: "harmMinor", label: "Harm. Minor", steps: [0, 2, 3, 5, 7, 8, 11] },
];

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function inScale(midi: number, root: number, id: ScaleId): boolean {
  if (id === "off") return true;
  const scale = SCALES.find((s) => s.id === id);
  if (!scale) return true;
  return scale.steps.includes(((midi - root) % 12 + 12) % 12);
}

/** Nearest scale tone (ties resolve downward — melodies fall more naturally). */
export function snapMidiToScale(midi: number, root: number, id: ScaleId): number {
  if (id === "off" || inScale(midi, root, id)) return midi;
  for (let d = 1; d <= 6; d++) {
    if (inScale(midi - d, root, id)) return midi - d;
    if (inScale(midi + d, root, id)) return midi + d;
  }
  return midi;
}

/** Euclidean rhythm (Bjorklund): `pulses` hits spread evenly over `steps`. */
export function euclidPattern(pulses: number, steps: number): boolean[] {
  const out: boolean[] = new Array(steps).fill(false);
  const p = clamp(Math.round(pulses), 0, steps);
  if (p === 0) return out;
  for (let i = 0; i < steps; i++) {
    out[i] = Math.floor(((i + 1) * p) / steps) !== Math.floor((i * p) / steps);
  }
  return out;
}

export interface DrumPattern {
  /** lane id → step array (0 = off, otherwise velocity 0..1). */
  steps: Record<DrumLane, number[]>;
}

export function emptyDrums(totalSteps: number): DrumPattern {
  const steps = {} as Record<DrumLane, number[]>;
  for (const l of DRUM_LANES) steps[l.id] = new Array(totalSteps).fill(0);
  return { steps };
}

// A tasteful default groove so the section makes sound out of the box.
function starterDrums(totalSteps: number): DrumPattern {
  const d = emptyDrums(totalSteps);
  for (let s = 0; s < totalSteps; s += 8) { d.steps.kick[s] = 1; }
  for (let s = 4; s < totalSteps; s += 8) { d.steps.snare[s] = 1; }
  for (let s = 0; s < totalSteps; s += 2) { d.steps.chat[s] = s % 8 === 6 ? 0 : 0.8; }
  for (let s = 6; s < totalSteps; s += 8) { d.steps.ohat[s] = 0.7; }
  return d;
}

function starterNotes(): RollNote[] {
  // A simple minor arp figure (A minor) across one bar to invite editing.
  const seq: [number, number, number][] = [
    [0, 57, 2], [2, 60, 2], [4, 64, 2], [6, 60, 2],
    [8, 57, 2], [10, 60, 2], [12, 64, 4],
  ];
  return seq.map(([step, midi, len], i) => ({
    id: `seed${i}`, step, midi, len, vel: 0.85, ch: 0 as SynthChannel,
  }));
}

/**
 * Synth B (issue #11) — a second, independent instrument for the sequencer.
 * It has its own FireCommandSynth instance in the engine (own oscillators,
 * filter, FX bus) voiced by any preset from the armory; piano-roll notes
 * carry a channel so the two instruments can play different parts at once.
 */
export const DEFAULT_SYNTH_B_PRESET = "hyperspace";

// The preset bank is resolved through a dynamic import: this store now sits
// in the MAIN chunk (the sidebar's activity hook reads it), and a static
// import of fireCommandStore would drag the ~500-entry generated bank into
// the boot bundle — the exact thing SystemMonitor's lazy import avoids.
let applySeq = 0;
function applySynthBPreset(presetId: string): void {
  const token = ++applySeq;
  void import("@/state/fireCommandStore").then(({ FIRE_PRESETS }) => {
    if (token !== applySeq) return; // a newer pick superseded this one
    const preset = FIRE_PRESETS.find((p) => p.id === presetId)
      ?? FIRE_PRESETS.find((p) => p.id === DEFAULT_SYNTH_B_PRESET);
    if (!preset) return;
    const patch = { ...DEFAULT_FIRE_PATCH, ...preset.patch };
    patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
    getEngine().fireCommandB.setPatch(patch);
  });
}

// ── persistence ──

const STORAGE_KEY = "killchain.firesequencer.v1";

interface PersistShape {
  bpm: number;
  swing: number; // 0..0.6 — delay applied to off-beat 16ths
  bars: number;  // 1..MAX_BARS
  notes: RollNote[];
  drums: DrumPattern;
  drumLevel: number;
  synthEnabled: boolean;
  drumsEnabled: boolean;
  /** Second instrument channel armed (issue #11). */
  synthBEnabled: boolean;
  /** Preset voicing Synth B — any id from the factory bank. */
  synthBPresetId: string;
  /** Which channel the piano roll draws new notes into. */
  activeChannel: SynthChannel;
  /** Sequencer panel collapsed to its compact transport strip. */
  collapsed: boolean;
  /** Scale highlight/snap for the piano roll. */
  scaleRoot: number;
  scaleId: ScaleId;
  scaleSnap: boolean;
  /** Per-lane user sample overrides (path + display name). */
  drumSamples: Partial<Record<DrumLane, { path: string; name: string }>>;
  /** The sample deck — operator sounds step-sequenced on the timeline. */
  samples: SampleLane[];
}

function defaults(): PersistShape {
  const totalSteps = 2 * STEPS_PER_BAR;
  return {
    bpm: 128,
    swing: 0,
    bars: 2,
    notes: starterNotes(),
    drums: starterDrums(totalSteps),
    drumLevel: 0.9,
    synthEnabled: true,
    drumsEnabled: true,
    synthBEnabled: false,
    synthBPresetId: DEFAULT_SYNTH_B_PRESET,
    activeChannel: 0,
    collapsed: false,
    scaleRoot: 9, // A — the starter riff is A minor
    scaleId: "off",
    scaleSnap: true,
    drumSamples: {},
    samples: [],
  };
}

/** Normalize an untrusted persisted/imported sample-lane list. */
function sanitizeSampleLanes(raw: unknown, total: number): SampleLane[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (l): l is SampleLane =>
        !!l && typeof l.path === "string" && typeof l.name === "string",
    )
    .slice(0, MAX_SAMPLE_LANES)
    .map((l) => {
      const steps = new Array<number>(total).fill(0);
      if (Array.isArray(l.steps)) {
        for (let i = 0; i < Math.min(total, l.steps.length); i++) {
          steps[i] = clamp(Number(l.steps[i]) || 0, 0, 1);
        }
      }
      return {
        id: typeof l.id === "string" ? l.id : `sl${Math.random().toString(36).slice(2, 9)}`,
        name: l.name.slice(0, 40),
        path: l.path,
        level: clamp(Number(l.level ?? 1) || 1, 0, 1.5),
        steps,
      };
    });
}

function sanitizeDrumSamples(
  raw: unknown,
): Partial<Record<DrumLane, { path: string; name: string }>> {
  const out: Partial<Record<DrumLane, { path: string; name: string }>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const lane of DRUM_LANES) {
    const v = (raw as Record<string, unknown>)[lane.id];
    if (
      v && typeof v === "object" &&
      typeof (v as { path?: unknown }).path === "string" &&
      typeof (v as { name?: unknown }).name === "string"
    ) {
      out[lane.id] = { path: (v as { path: string }).path, name: (v as { name: string }).name };
    }
  }
  return out;
}

function load(): PersistShape {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const p = JSON.parse(raw) as Partial<PersistShape>;
    const d = defaults();
    const bars = clamp(Math.round(p.bars ?? d.bars), 1, MAX_BARS);
    const total = bars * STEPS_PER_BAR;
    // Normalize drum lanes to the current lane set + length.
    const drums = emptyDrums(total);
    if (p.drums?.steps) {
      for (const l of DRUM_LANES) {
        const src = p.drums.steps[l.id];
        if (Array.isArray(src)) {
          for (let i = 0; i < Math.min(total, src.length); i++) {
            drums.steps[l.id][i] = clamp(Number(src[i]) || 0, 0, 1);
          }
        }
      }
    } else {
      return { ...d, bars, drums: starterDrums(total) };
    }
    return {
      bpm: clamp(Number(p.bpm) || d.bpm, 40, 240),
      swing: clamp(Number(p.swing) || 0, 0, 0.6),
      bars,
      notes: Array.isArray(p.notes)
        ? p.notes.filter((n) => n && typeof n.midi === "number").map((n) => ({
            id: String(n.id ?? Math.random().toString(36).slice(2)),
            step: clamp(Number(n.step) || 0, 0, total - 0.25),
            midi: clamp(Math.round(n.midi), 12, 108),
            len: clamp(Number(n.len) || 1, 0.25, total),
            vel: clamp(Number(n.vel) || 0.85, 0.05, 1),
            ch: (n.ch === 1 ? 1 : 0) as SynthChannel,
          }))
        : d.notes,
      drums,
      drumLevel: clamp(Number(p.drumLevel) || d.drumLevel, 0, 1.2),
      synthEnabled: p.synthEnabled !== false,
      drumsEnabled: p.drumsEnabled !== false,
      synthBEnabled: p.synthBEnabled === true,
      synthBPresetId: typeof p.synthBPresetId === "string" ? p.synthBPresetId : d.synthBPresetId,
      activeChannel: p.activeChannel === 1 ? 1 : 0,
      collapsed: p.collapsed === true,
      scaleRoot: clamp(Math.round(Number(p.scaleRoot ?? d.scaleRoot)), 0, 11),
      scaleId: SCALES.some((s) => s.id === p.scaleId) ? (p.scaleId as ScaleId) : d.scaleId,
      scaleSnap: p.scaleSnap !== false,
      drumSamples: sanitizeDrumSamples(p.drumSamples),
      samples: sanitizeSampleLanes(p.samples, total),
    };
  } catch {
    return defaults();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(get: () => FireSequencerState): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = get();
    const data: PersistShape = {
      bpm: s.bpm, swing: s.swing, bars: s.bars, notes: s.notes, drums: s.drums,
      drumLevel: s.drumLevel, synthEnabled: s.synthEnabled, drumsEnabled: s.drumsEnabled,
      synthBEnabled: s.synthBEnabled, synthBPresetId: s.synthBPresetId,
      activeChannel: s.activeChannel,
      collapsed: s.collapsed,
      scaleRoot: s.scaleRoot, scaleId: s.scaleId, scaleSnap: s.scaleSnap,
      drumSamples: s.drumSamples,
      samples: s.samples,
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, 400);
}

// ── look-ahead scheduler (module scope: survives store re-renders) ──

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

let timer: ReturnType<typeof setInterval> | null = null;
/** AudioContext time corresponding to pattern step 0 of the current loop pass. */
let loopStartTime = 0;
/** Next step index (fractional steps scheduled as whole numbers here). */
let nextStep = 0;
/** Monotonic token — a stale async start (resume still in flight when the
 *  user hit stop / changed tempo) must never arm the timer. */
let startToken = 0;

function stepDur(bpm: number): number {
  return 60 / bpm / 4; // one 16th
}

function stopScheduler(): void {
  startToken++;
  if (timer) { clearInterval(timer); timer = null; }
}

function startScheduler(get: () => FireSequencerState): void {
  stopScheduler();
  const engine = getEngine();
  engine.fireDrums.setLevel(get().drumLevel);
  const ctx = engine.ctx;
  const token = startToken;
  // Park the playhead at step 0 until the clock is actually anchored below
  // (getPlayheadStep clamps negative elapsed time to 0).
  loopStartTime = Number.MAX_SAFE_INTEGER;

  // ROOT CAUSE (silent play): this used to fire `void engine.resume()` and
  // immediately anchor `loopStartTime = ctx.currentTime + 0.06`. Autoplay
  // policy keeps a fresh AudioContext SUSPENDED until a gesture-driven
  // resume() completes, and while suspended `ctx.currentTime` is frozen — so
  // the anchor (and every step time derived from it) referenced the frozen
  // clock. Scheduled voices couldn't render yet, but their wall-clock
  // setTimeout cleanups (voice end timers) kept running and force-stopped
  // them before the context ever produced a sample. By the time resume()
  // actually finished, the whole first look-ahead batch was dead → pressing
  // play produced nothing until a lucky retry found the context already
  // running. The fix: await resume() and only anchor/arm the timer once the
  // context is genuinely running, so step 0 lands on a live, advancing clock.
  const begin = () => {
    if (token !== startToken || !get().playing) return; // superseded/stopped
    loopStartTime = ctx.currentTime + 0.08;
    nextStep = 0;

    const tick = () => {
      const s = get();
      if (!s.playing) return;
      const dur = stepDur(s.bpm);
      const total = s.bars * STEPS_PER_BAR;
      const now = ctx.currentTime;
      const horizon = now + LOOKAHEAD_S;

      // Schedule every whole step whose start time falls inside the window.
      while (loopStartTime + nextStep * dur < horizon) {
        const step = nextStep % total;
        const swingDelay = step % 2 === 1 ? s.swing * dur * 0.5 : 0;
        const when = loopStartTime + nextStep * dur + swingDelay;

        // A step already well in the past (main thread stalled / background
        // throttling) is skipped rather than clamped to "now" — otherwise a
        // long stall fires the whole backlog as one machine-gun burst.
        if (when < now - 0.03) { nextStep++; continue; }

        if (s.drumsEnabled) {
          for (const lane of DRUM_LANES) {
            const v = s.drums.steps[lane.id][step];
            if (v > 0) engine.fireDrums.trigger(lane.id, when, v);
          }
        }
        // Sample deck lanes (fire regardless of the drum arm — they're their
        // own instrument rows).
        for (const sl of s.samples) {
          const v = sl.steps[step] ?? 0;
          if (v <= 0) continue;
          const buf = sampleBuffers.get(sl.path);
          if (buf) engine.fireDrums.playBuffer(buf, when, v, sl.level);
          else void loadSampleBuffer(sl.path); // hydrate for the next pass
        }
        if (s.synthEnabled || s.synthBEnabled) {
          // Notes may start on fractional steps; bucket by floor(step).
          for (const n of s.notes) {
            if (Math.floor(n.step) !== step) continue;
            // Route by channel: A = the playable Fire Command synth,
            // B = the second instrument voiced by its own preset.
            const isB = n.ch === 1;
            if (isB ? !s.synthBEnabled : !s.synthEnabled) continue;
            const target = isB ? engine.fireCommandB : engine.fireCommand;
            const offset = (n.step - step) * dur;
            target.playNote(
              n.midi, n.vel, when + offset, Math.max(0.03, n.len * dur * 0.98),
            );
          }
        }
        nextStep++;
        // Keep loopStartTime anchored so long sessions don't lose float precision.
        if (nextStep >= total * 4) {
          loopStartTime += nextStep * dur;
          nextStep = 0;
        }
      }
    };

    tick();
    timer = setInterval(tick, TICK_MS);
  };

  if (ctx.state === "running") {
    begin();
  } else {
    // Play is always user-initiated, so resume() is gesture-blessed. If it
    // still fails (device wedged), retry the anchor once the context flips to
    // running rather than silently doing nothing.
    engine.resume().then(begin).catch(() => {
      const onState = () => {
        ctx.removeEventListener("statechange", onState);
        begin();
      };
      ctx.addEventListener("statechange", onState);
    });
  }
}

/** Current playhead in pattern steps (fractional) — read from RAF, not state. */
export function getPlayheadStep(bpm: number, bars: number): number {
  const ctx = getEngine().ctx;
  const dur = stepDur(bpm);
  const total = bars * STEPS_PER_BAR;
  const t = (ctx.currentTime - loopStartTime) / dur;
  if (t < 0) return 0;
  return t % total;
}

// ── store ──

let noteSeq = 0;
const noteId = () => `n${Date.now().toString(36)}${(noteSeq++).toString(36)}`;

export interface FireSequencerState extends PersistShape {
  playing: boolean;

  play: () => void;
  stop: () => void;
  togglePlay: () => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setBars: (bars: number) => void;
  setSynthEnabled: (on: boolean) => void;
  setDrumsEnabled: (on: boolean) => void;
  setSynthBEnabled: (on: boolean) => void;
  setSynthBPresetId: (id: string) => void;
  setActiveChannel: (ch: SynthChannel) => void;
  /** Preview one note on a channel's instrument (piano-roll audition). */
  audition: (midi: number, vel: number, ch: SynthChannel) => void;
  setDrumLevel: (v: number) => void;
  setCollapsed: (v: boolean) => void;

  addNote: (note: Omit<RollNote, "id">) => string;
  updateNote: (id: string, partial: Partial<Omit<RollNote, "id">>) => void;
  /** Batch update (group drags) — one state commit for N notes. */
  updateNotes: (entries: Array<{ id: string } & Partial<Omit<RollNote, "id">>>) => void;
  removeNote: (id: string) => void;
  removeNotes: (ids: string[]) => void;
  clearNotes: () => void;
  replaceNotes: (notes: RollNote[]) => void;
  /** Copy notes `offsetSteps` to the right; returns the new ids. */
  duplicateNotes: (ids: string[], offsetSteps: number) => string[];
  /** Shift notes by semitones (scale-snapped when snap is on). */
  transposeNotes: (ids: string[], semis: number) => void;
  /** Loose-groove pass: small velocity + micro-timing jitter. */
  humanizeNotes: () => void;
  /** Double the pattern length, repeating notes + drums (up to MAX_BARS). */
  duplicatePattern: () => boolean;

  setScaleRoot: (root: number) => void;
  setScaleId: (id: ScaleId) => void;
  setScaleSnap: (on: boolean) => void;

  toggleDrumStep: (lane: DrumLane, step: number) => void;
  setDrumStep: (lane: DrumLane, step: number, vel: number) => void;
  clearDrums: () => void;
  /** Euclidean fill: `pulses` hits per bar, evenly spread. */
  euclidLane: (lane: DrumLane, pulses: number) => void;
  randomLane: (lane: DrumLane, density: number) => void;
  clearLane: (lane: DrumLane) => void;

  /** Swap a drum lane's synthesized hit for the operator's own sample. */
  setDrumSample: (lane: DrumLane, path: string | null, name?: string) => Promise<boolean>;
  /** Load persisted sample buffers + push drum overrides into the engine. */
  hydrateSamples: () => Promise<void>;

  addSampleLane: (path: string, name: string) => Promise<boolean>;
  removeSampleLane: (id: string) => void;
  setSampleStep: (id: string, step: number, vel: number) => void;
  setSampleLevel: (id: string, level: number) => void;
  clearSampleLane: (id: string) => void;
  auditionSample: (id: string) => void;

  /** Replace the whole pattern from a project file (sanitized). */
  importPattern: (data: unknown) => boolean;
}

export const useFireSequencerStore = create<FireSequencerState>((set, get) => {
  const persist = () => schedulePersist(get);

  /** Resize note/drum/sample arrays when bar count changes. */
  const resizeTo = (bars: number): Partial<FireSequencerState> => {
    const total = bars * STEPS_PER_BAR;
    const s = get();
    const drums = emptyDrums(total);
    for (const l of DRUM_LANES) {
      const src = s.drums.steps[l.id];
      for (let i = 0; i < total; i++) {
        // Growing repeats the existing pattern; shrinking truncates.
        drums.steps[l.id][i] = src[i % src.length] ?? 0;
      }
    }
    const samples = s.samples.map((sl) => {
      const steps = new Array<number>(total).fill(0);
      for (let i = 0; i < total; i++) steps[i] = sl.steps[i % Math.max(1, sl.steps.length)] ?? 0;
      return { ...sl, steps };
    });
    return {
      bars,
      drums,
      samples,
      notes: s.notes.filter((n) => n.step < total),
    };
  };

  return {
    ...load(),
    playing: false,

    play: () => {
      if (get().playing) return;
      // One source at a time: the pattern silences the file player and any
      // media playing in Airspace.
      void import("@/lib/sourceArbiter").then(({ claimSource }) => claimSource("fire"));
      // Voice Synth B before its first note renders (lazy instantiation).
      const s = get();
      if (s.synthBEnabled && s.notes.some((n) => n.ch === 1)) {
        applySynthBPreset(s.synthBPresetId);
      }
      set({ playing: true });
      startScheduler(get);
    },

    stop: () => {
      set({ playing: false });
      stopScheduler();
      const engine = getEngine();
      engine.fireCommand.allNotesOff();
      engine.peekFireCommandB()?.allNotesOff();
    },

    togglePlay: () => (get().playing ? get().stop() : get().play()),

    setBpm: (bpm) => {
      const v = clamp(Math.round(bpm), 40, 240);
      // Re-anchor so the tempo change applies cleanly from "now".
      const wasPlaying = get().playing;
      set({ bpm: v });
      if (wasPlaying) startScheduler(get);
      persist();
    },

    setSwing: (swing) => { set({ swing: clamp(swing, 0, 0.6) }); persist(); },

    setBars: (bars) => {
      const b = clamp(Math.round(bars), 1, MAX_BARS);
      if (b === get().bars) return;
      const wasPlaying = get().playing;
      set(resizeTo(b));
      if (wasPlaying) startScheduler(get);
      persist();
    },

    setSynthEnabled: (on) => { set({ synthEnabled: on }); persist(); },
    setDrumsEnabled: (on) => { set({ drumsEnabled: on }); persist(); },

    setSynthBEnabled: (on) => {
      set({ synthBEnabled: on });
      if (on) {
        applySynthBPreset(get().synthBPresetId);
      } else {
        getEngine().peekFireCommandB()?.allNotesOff();
        // Drawing into a disarmed channel would be silent and confusing.
        if (get().activeChannel === 1) set({ activeChannel: 0 });
      }
      persist();
    },

    setSynthBPresetId: (id) => {
      set({ synthBPresetId: id });
      if (get().synthBEnabled) applySynthBPreset(id);
      persist();
    },

    setActiveChannel: (ch) => {
      set({ activeChannel: ch });
      // Arm the channel you're about to draw into.
      if (ch === 1 && !get().synthBEnabled) get().setSynthBEnabled(true);
      persist();
    },

    audition: (midi, vel, ch) => {
      const engine = getEngine();
      void engine.resume();
      if (ch === 1) {
        // Make sure B is voiced even before the first playback.
        if (!engine.peekFireCommandB()) applySynthBPreset(get().synthBPresetId);
        engine.fireCommandB.playNote(midi, vel, engine.ctx.currentTime, 0.18);
      } else {
        engine.fireCommand.playNote(midi, vel, engine.ctx.currentTime, 0.18);
      }
    },

    setCollapsed: (v) => { set({ collapsed: v }); persist(); },
    setDrumLevel: (v) => {
      const lvl = clamp(v, 0, 1.2);
      set({ drumLevel: lvl });
      getEngine().fireDrums.setLevel(lvl);
      persist();
    },

    addNote: (note) => {
      const id = noteId();
      const total = get().bars * STEPS_PER_BAR;
      const n: RollNote = {
        id,
        step: clamp(note.step, 0, total - 0.25),
        midi: clamp(Math.round(note.midi), 12, 108),
        len: clamp(note.len, 0.25, total),
        vel: clamp(note.vel, 0.05, 1),
        ch: note.ch === 1 ? 1 : 0,
      };
      set({ notes: [...get().notes, n] });
      persist();
      return id;
    },

    updateNote: (id, partial) => {
      const total = get().bars * STEPS_PER_BAR;
      set({
        notes: get().notes.map((n) => {
          if (n.id !== id) return n;
          const merged = { ...n, ...partial };
          return {
            ...merged,
            step: clamp(merged.step, 0, total - 0.25),
            midi: clamp(Math.round(merged.midi), 12, 108),
            len: clamp(merged.len, 0.25, total),
            vel: clamp(merged.vel, 0.05, 1),
          };
        }),
      });
      persist();
    },

    updateNotes: (entries) => {
      const total = get().bars * STEPS_PER_BAR;
      const byId = new Map(entries.map((e) => [e.id, e]));
      set({
        notes: get().notes.map((n) => {
          const e = byId.get(n.id);
          if (!e) return n;
          const merged = { ...n, ...e };
          return {
            ...merged,
            step: clamp(merged.step, 0, total - 0.25),
            midi: clamp(Math.round(merged.midi), 12, 108),
            len: clamp(merged.len, 0.25, total),
            vel: clamp(merged.vel, 0.05, 1),
          };
        }),
      });
      persist();
    },

    removeNote: (id) => { set({ notes: get().notes.filter((n) => n.id !== id) }); persist(); },
    removeNotes: (ids) => {
      const kill = new Set(ids);
      set({ notes: get().notes.filter((n) => !kill.has(n.id)) });
      persist();
    },
    clearNotes: () => { set({ notes: [] }); persist(); },
    replaceNotes: (notes) => { set({ notes }); persist(); },

    duplicateNotes: (ids, offsetSteps) => {
      const s = get();
      const total = s.bars * STEPS_PER_BAR;
      const src = s.notes.filter((n) => ids.includes(n.id));
      const copies: RollNote[] = [];
      for (const n of src) {
        const step = n.step + offsetSteps;
        if (step >= total) continue;
        copies.push({ ...n, id: noteId(), step });
      }
      if (copies.length === 0) return [];
      set({ notes: [...s.notes, ...copies] });
      persist();
      return copies.map((c) => c.id);
    },

    transposeNotes: (ids, semis) => {
      const s = get();
      const sel = new Set(ids);
      set({
        notes: s.notes.map((n) => {
          if (!sel.has(n.id)) return n;
          let midi = clamp(n.midi + semis, 12, 108);
          if (s.scaleSnap && s.scaleId !== "off" && Math.abs(semis) === 1) {
            // Single-semitone nudges walk the SCALE, not the chromatic grid.
            const dir = semis > 0 ? 1 : -1;
            midi = n.midi;
            for (let step = 1; step <= 6; step++) {
              const cand = clamp(n.midi + dir * step, 12, 108);
              if (inScale(cand, s.scaleRoot, s.scaleId)) { midi = cand; break; }
            }
          }
          return { ...n, midi };
        }),
      });
      persist();
    },

    humanizeNotes: () => {
      const s = get();
      const total = s.bars * STEPS_PER_BAR;
      set({
        notes: s.notes.map((n) => ({
          ...n,
          vel: clamp(n.vel + (Math.random() * 2 - 1) * 0.09, 0.05, 1),
          step: clamp(n.step + (Math.random() * 2 - 1) * 0.045, 0, total - 0.25),
        })),
      });
      persist();
    },

    duplicatePattern: () => {
      const s = get();
      const newBars = s.bars * 2;
      if (newBars > MAX_BARS) return false;
      const oldTotal = s.bars * STEPS_PER_BAR;
      const wasPlaying = s.playing;
      // resizeTo repeats the drum pattern when growing; notes repeat here.
      const grown = resizeTo(newBars);
      const shifted = s.notes.map((n) => ({ ...n, id: noteId(), step: n.step + oldTotal }));
      set({ ...grown, notes: [...s.notes, ...shifted] });
      if (wasPlaying) startScheduler(get);
      persist();
      return true;
    },

    setScaleRoot: (root) => { set({ scaleRoot: clamp(Math.round(root), 0, 11) }); persist(); },
    setScaleId: (id) => { set({ scaleId: id }); persist(); },
    setScaleSnap: (on) => { set({ scaleSnap: on }); persist(); },

    toggleDrumStep: (lane, step) => {
      const s = get();
      const cur = s.drums.steps[lane][step] ?? 0;
      get().setDrumStep(lane, step, cur > 0 ? 0 : 1);
    },

    setDrumStep: (lane, step, vel) => {
      const s = get();
      const steps = { ...s.drums.steps };
      const arr = [...steps[lane]];
      arr[step] = clamp(vel, 0, 1);
      steps[lane] = arr;
      set({ drums: { steps } });
      persist();
    },

    clearDrums: () => {
      set({ drums: emptyDrums(get().bars * STEPS_PER_BAR) });
      persist();
    },

    euclidLane: (lane, pulses) => {
      const s = get();
      const total = s.bars * STEPS_PER_BAR;
      const perBar = euclidPattern(pulses, STEPS_PER_BAR);
      const steps = { ...s.drums.steps };
      const arr = new Array<number>(total).fill(0);
      for (let i = 0; i < total; i++) {
        if (perBar[i % STEPS_PER_BAR]) arr[i] = 1;
      }
      steps[lane] = arr;
      set({ drums: { steps } });
      persist();
    },

    randomLane: (lane, density) => {
      const s = get();
      const total = s.bars * STEPS_PER_BAR;
      const steps = { ...s.drums.steps };
      const arr = new Array<number>(total).fill(0);
      for (let i = 0; i < total; i++) {
        if (Math.random() < density) {
          arr[i] = Math.random() < 0.3 ? 0.7 : 1;
        }
      }
      steps[lane] = arr;
      set({ drums: { steps } });
      persist();
    },

    clearLane: (lane) => {
      const s = get();
      const steps = { ...s.drums.steps };
      steps[lane] = new Array<number>(s.bars * STEPS_PER_BAR).fill(0);
      set({ drums: { steps } });
      persist();
    },

    setDrumSample: async (lane, filePath, name) => {
      if (!filePath) {
        const drumSamples = { ...get().drumSamples };
        delete drumSamples[lane];
        set({ drumSamples });
        getEngine().fireDrums.setSample(lane, null);
        persist();
        return true;
      }
      const buf = await loadSampleBuffer(filePath);
      if (!buf) return false;
      const display = name ?? filePath.split(/[\\/]/).pop() ?? "Sample";
      set({ drumSamples: { ...get().drumSamples, [lane]: { path: filePath, name: display } } });
      getEngine().fireDrums.setSample(lane, buf);
      persist();
      return true;
    },

    hydrateSamples: async () => {
      const s = get();
      for (const lane of DRUM_LANES) {
        const spec = s.drumSamples[lane.id];
        if (!spec) continue;
        const buf = await loadSampleBuffer(spec.path);
        if (buf) getEngine().fireDrums.setSample(lane.id, buf);
      }
      await Promise.all(s.samples.map((sl) => loadSampleBuffer(sl.path)));
    },

    addSampleLane: async (filePath, name) => {
      const s = get();
      if (s.samples.length >= MAX_SAMPLE_LANES) return false;
      const buf = await loadSampleBuffer(filePath);
      if (!buf) return false;
      const lane: SampleLane = {
        id: `sl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: name.slice(0, 40),
        path: filePath,
        level: 1,
        steps: new Array<number>(s.bars * STEPS_PER_BAR).fill(0),
      };
      set({ samples: [...s.samples, lane] });
      persist();
      return true;
    },

    removeSampleLane: (id) => {
      set({ samples: get().samples.filter((l) => l.id !== id) });
      persist();
    },

    setSampleStep: (id, step, vel) => {
      set({
        samples: get().samples.map((l) =>
          l.id === id
            ? { ...l, steps: l.steps.map((v, i) => (i === step ? clamp(vel, 0, 1) : v)) }
            : l,
        ),
      });
      persist();
    },

    setSampleLevel: (id, level) => {
      set({
        samples: get().samples.map((l) =>
          l.id === id ? { ...l, level: clamp(level, 0, 1.5) } : l,
        ),
      });
      persist();
    },

    clearSampleLane: (id) => {
      const total = get().bars * STEPS_PER_BAR;
      set({
        samples: get().samples.map((l) =>
          l.id === id ? { ...l, steps: new Array<number>(total).fill(0) } : l,
        ),
      });
      persist();
    },

    auditionSample: (id) => {
      const lane = get().samples.find((l) => l.id === id);
      if (!lane) return;
      const engine = getEngine();
      void engine.resume();
      const buf = sampleBuffers.get(lane.path);
      if (buf) engine.fireDrums.playBuffer(buf, engine.ctx.currentTime, 1, lane.level);
      else void loadSampleBuffer(lane.path);
    },

    importPattern: (data) => {
      if (!data || typeof data !== "object") return false;
      const wasPlaying = get().playing;
      if (wasPlaying) get().stop();
      try {
        // Round-trip the import through the same normalization the loader
        // uses — write it into storage, re-load, apply.
        const merged = { ...defaults(), ...(data as Partial<PersistShape>) };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        set({ ...load() });
        void get().hydrateSamples();
        return true;
      } catch {
        return false;
      }
    },
  };
});
