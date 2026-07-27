/**
 * fireSequencerStore — the Fire Command pattern sequencer (FL-studio style).
 *
 * Owns:
 *   · up to 16 named PATTERNS (sections), each a full editing surface:
 *     piano-roll notes, drum grid, sample-deck step grids and a bar count,
 *   · an ARRANGEMENT (absolute-time pattern clips on one playlist lane) + play mode,
 *   · transport (bpm, swing, play state) and global lane definitions,
 *   · the look-ahead scheduler that fires everything into the audio engine.
 *
 * v1.6 arrangement model: the top-level `bars`/`notes`/`drums`/`samples[].steps`
 * fields are a live MIRROR of the ACTIVE section — every editor and editing
 * action keeps targeting them unchanged. The mirror is folded back into
 * `sections` whenever it matters (section switch, persist, capture, song
 * playback) via `sectionsWithActive()`.
 *
 * Timing model: steps are 16th notes. The scheduler wakes every 25 ms and
 * schedules everything inside a 120 ms look-ahead window directly on the
 * AudioContext clock (`synth.playNote` / `drums.trigger` take `when`), so
 * playback is sample-accurate regardless of main-thread jank. The UI
 * playhead reads `getPlayheadStep()` from its own RAF loop — the scheduler
 * never touches React state while running. In ARRANGEMENT mode the global
 * step counter maps through absolute clip ranges (gaps = silence).
 */

import { create } from "zustand";
import { getEngine } from "@/audio/AudioEngine";
import { DRUM_LANES, type DrumLane } from "@/audio/dsp/FireDrumKit";
import { DEFAULT_FIRE_PATCH, makeModMatrix, type FirePatch } from "@/audio/dsp/FireCommandSynth";
import { audioUrlForPath } from "@/state/libraryStore";
import { pushFireHistory, registerFireHistoryProvider } from "@/lib/fireHistory";
import { useFireCommandStore, slotsFromState } from "@/state/fireCommandStore";

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

// ── Arrangement (v1.6) ──

/** One named pattern in the arrangement — a full editing surface. */
export interface Section {
  id: string;
  name: string;
  bars: number;
  notes: RollNote[];
  drums: DrumPattern;
  /** sample lane id → this section's step grid (missing lane = silent). */
  sampleSteps: Record<string, number[]>;
  /** Automation lanes (v1.7): param id → per-step points. */
  automation: AutomationMap;
  /** Optional Synth A/B patch snapshots for this pattern (song timbre recall). */
  patchA?: FirePatch;
  patchB?: FirePatch;
}

export const MAX_SECTIONS = 16;
export const MAX_CLIPS = 64;
export const MAX_PLAYLIST_TRACKS = 10;
/** Soft ceiling for arrangement UI scroll (bars). */
export const MAX_ARRANGEMENT_BARS = 128;
export type PlayMode = "pattern" | "arrangement";

export const PLAYLIST_TRACK_COLORS = [
  "#ff6a3d", "#62b6ff", "#9be564", "#c98bff", "#ffd166",
  "#ff7bac", "#7ce8d5", "#ffb648", "#a78bfa", "#34d399",
];

/** One playlist row (mute / solo / color / name). */
export interface PlaylistTrack {
  name: string;
  mute: boolean;
  solo: boolean;
  color: string;
}

/** One placed pattern block on the arrangement timeline (absolute 16ths). */
export interface ArrangementClip {
  id: string;
  patternId: string;
  startStep: number;
  /** Playlist row 0..MAX_PLAYLIST_TRACKS-1 */
  track: number;
  /** Trimmed audible length in steps; omit = full pattern length. */
  lengthSteps?: number;
  /** Optional clip color override (else track / pattern color). */
  color?: string;
}

let clipSeq = 0;
const clipId = () => `clip${Date.now().toString(36)}${(clipSeq++).toString(36)}`;

function snapToBar(step: number): number {
  return Math.max(0, Math.round(step / STEPS_PER_BAR) * STEPS_PER_BAR);
}

function snapToStep(step: number): number {
  return Math.max(0, Math.round(step));
}

function sectionLenSteps(sec: { bars: number }): number {
  return Math.max(1, sec.bars) * STEPS_PER_BAR;
}

function clipAudibleLen(clip: ArrangementClip, sec: { bars: number }): number {
  const full = sectionLenSteps(sec);
  if (clip.lengthSteps == null) return full;
  return clamp(Math.round(clip.lengthSteps), 1, full);
}

function defaultPlaylistTracks(): PlaylistTrack[] {
  return Array.from({ length: MAX_PLAYLIST_TRACKS }, (_, i) => ({
    name: i === 0 ? "Track 1" : `Track ${i + 1}`,
    mute: false,
    solo: false,
    color: PLAYLIST_TRACK_COLORS[i % PLAYLIST_TRACK_COLORS.length],
  }));
}

function sanitizePlaylistTracks(raw: unknown): PlaylistTrack[] {
  const base = defaultPlaylistTracks();
  if (!Array.isArray(raw)) return base;
  return base.map((d, i) => {
    const t = raw[i] as Partial<PlaylistTrack> | undefined;
    if (!t || typeof t !== "object") return d;
    return {
      name: typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 18) : d.name,
      mute: t.mute === true,
      solo: t.solo === true,
      color: typeof t.color === "string" && t.color ? t.color : d.color,
    };
  });
}

function migratePlayMode(raw: unknown): PlayMode {
  if (raw === "arrangement" || raw === "song") return "arrangement";
  return "pattern";
}

/** Expand a legacy song-order chain into absolute-time clips on track 0. */
function chainToArrangement(chain: string[], sections: Section[]): ArrangementClip[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  let pos = 0;
  const out: ArrangementClip[] = [];
  for (const id of chain) {
    const sec = byId.get(id);
    if (!sec) continue;
    out.push({ id: clipId(), patternId: id, startStep: pos, track: 0 });
    pos += sectionLenSteps(sec);
    if (out.length >= MAX_CLIPS) break;
  }
  return out;
}

function sanitizeArrangement(raw: unknown, sections: Section[]): ArrangementClip[] {
  const ids = new Set(sections.map((s) => s.id));
  const byId = new Map(sections.map((s) => [s.id, s]));
  if (!Array.isArray(raw)) return [];
  const out: ArrangementClip[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const patternId = String((c as ArrangementClip).patternId ?? "");
    if (!ids.has(patternId)) continue;
    const sec = byId.get(patternId)!;
    const full = sectionLenSteps(sec);
    const startStep = snapToBar(Number((c as ArrangementClip).startStep) || 0);
    const maxStep = (MAX_ARRANGEMENT_BARS - sec.bars) * STEPS_PER_BAR;
    const track = clamp(Math.round(Number((c as ArrangementClip).track) || 0), 0, MAX_PLAYLIST_TRACKS - 1);
    const rawLen = (c as ArrangementClip).lengthSteps;
    const lengthSteps = rawLen == null ? undefined : clamp(Math.round(Number(rawLen)), 1, full);
    const color = typeof (c as ArrangementClip).color === "string" ? (c as ArrangementClip).color : undefined;
    out.push({
      id: String((c as ArrangementClip).id ?? clipId()),
      patternId,
      startStep: clamp(startStep, 0, Math.max(0, maxStep)),
      track,
      lengthSteps,
      color,
    });
    if (out.length >= MAX_CLIPS) break;
  }
  return out;
}
// ── Mixer + sidechain (v1.6) ──

export type MixerStripId = "a" | "b" | "drums" | "samples" | "master";
export const MIXER_PARTS = ["a", "b", "drums", "samples"] as const;

export interface MixerStrip {
  level: number; // 0..1.5 (1 = unity)
  pan: number;   // -1..1 (ignored on master)
  mute: boolean;
  solo: boolean; // ignored on master
}

const defaultStrip = (): MixerStrip => ({ level: 1, pan: 0, mute: false, solo: false });

function defaultMixer(): Record<MixerStripId, MixerStrip> {
  return {
    a: defaultStrip(), b: defaultStrip(), drums: defaultStrip(),
    samples: defaultStrip(), master: defaultStrip(),
  };
}

function sanitizeMixer(raw: unknown): Record<MixerStripId, MixerStrip> {
  const out = defaultMixer();
  if (!raw || typeof raw !== "object") return out;
  for (const id of [...MIXER_PARTS, "master"] as MixerStripId[]) {
    const v = (raw as Record<string, Partial<MixerStrip>>)[id];
    if (!v || typeof v !== "object") continue;
    out[id] = {
      level: clamp(Number(v.level ?? 1) || 0, 0, 1.5),
      pan: clamp(Number(v.pan ?? 0) || 0, -1, 1),
      mute: v.mute === true,
      solo: v.solo === true,
    };
  }
  return out;
}

/** Push the mixer + limiter + solo logic into the engine's part strips. */
function applyMixerToEngine(s: {
  mixer: Record<MixerStripId, MixerStrip>;
  fireLimiterOn: boolean;
}): void {
  const eng = getEngine();
  const anySolo = MIXER_PARTS.some((p) => s.mixer[p].solo);
  for (const p of MIXER_PARTS) {
    const m = s.mixer[p];
    eng.setFirePartMix(p, m.level, m.pan, m.mute || (anySolo && !m.solo));
  }
  eng.setFireMasterMix(s.mixer.master.level, s.mixer.master.mute);
  eng.setFireLimiterEnabled(s.fireLimiterOn);
}

let secSeq = 0;
const sectionId = () => `sec${Date.now().toString(36)}${(secSeq++).toString(36)}`;

/** Next free single-letter name: A, B, C… (falls back to S9, S10…). */
function nextSectionName(sections: Section[]): string {
  const used = new Set(sections.map((s) => s.name));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  return `S${sections.length + 1}`;
}

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

// ── Key detection (v1.6): Krumhansl-Schmuckler profiles ──

const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/**
 * Detect the key of a note set: duration+velocity-weighted pitch-class
 * histogram correlated against the 24 rotated Krumhansl profiles.
 * Returns null when there isn't enough material to call it.
 */
export function detectKeyFromNotes(
  notes: RollNote[],
): { root: number; scaleId: ScaleId; confidence: number } | null {
  if (notes.length < 3) return null;
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[((n.midi % 12) + 12) % 12] += Math.max(0.25, n.len) * n.vel;
  if (hist.every((v) => v === 0)) return null;
  let best = { root: 0, scaleId: "minor" as ScaleId, r: -Infinity };
  for (let root = 0; root < 12; root++) {
    // Rotate the histogram so index 0 = candidate tonic.
    const rotated = hist.map((_, i) => hist[(i + root) % 12]);
    const rMaj = correlate(rotated, KRUMHANSL_MAJOR);
    const rMin = correlate(rotated, KRUMHANSL_MINOR);
    if (rMaj > best.r) best = { root, scaleId: "major", r: rMaj };
    if (rMin > best.r) best = { root, scaleId: "minor", r: rMin };
  }
  return { root: best.root, scaleId: best.scaleId, confidence: best.r };
}

// ── Automation lanes (v1.7) ──
// One normalized value (0..1) per 16th step, `null` = no point. The scheduler
// interpolates between points and writes the mapped value straight into the
// ENGINE (never the patch store), so automation moves knobs without dirtying
// the preset, undo history, or persistence.

export type AutoParamId =
  | "cutoff" | "resonance" | "wtA" | "delayMix" | "reverbMix"
  | "macro1" | "macro2" | "macro3" | "macro4";

/** Patch fields automation may drive — all numeric, all on Synth A. */
export type AutoPatchKey =
  | "filterCutoff" | "filterResonance" | "oscAPos" | "delayMix" | "reverbMix"
  | "macro1" | "macro2" | "macro3" | "macro4";

export interface AutoParamDef {
  id: AutoParamId;
  label: string;
  patchKey: AutoPatchKey;
  min: number;
  max: number;
  log?: boolean;
  color: string;
}

// Ranges mirror the knobs in FireCommandView so drawn lanes cover the same
// territory as hand-tweaking.
export const AUTO_PARAMS: AutoParamDef[] = [
  { id: "cutoff", label: "Cutoff", patchKey: "filterCutoff", min: 20, max: 18000, log: true, color: "#ff6a3d" },
  { id: "resonance", label: "Reso", patchKey: "filterResonance", min: 0.1, max: 28, log: true, color: "#ffb648" },
  { id: "wtA", label: "Osc A Morph", patchKey: "oscAPos", min: 0, max: 1, color: "#ffd166" },
  { id: "delayMix", label: "Delay", patchKey: "delayMix", min: 0, max: 1, color: "#62b6ff" },
  { id: "reverbMix", label: "Reverb", patchKey: "reverbMix", min: 0, max: 1, color: "#7ce8d5" },
  { id: "macro1", label: "Macro 1", patchKey: "macro1", min: 0, max: 1, color: "#7cf6b0" },
  { id: "macro2", label: "Macro 2", patchKey: "macro2", min: 0, max: 1, color: "#9be564" },
  { id: "macro3", label: "Macro 3", patchKey: "macro3", min: 0, max: 1, color: "#c98bff" },
  { id: "macro4", label: "Macro 4", patchKey: "macro4", min: 0, max: 1, color: "#ff7bac" },
];

export type AutomationMap = Partial<Record<AutoParamId, (number | null)[]>>;

/** Map a normalized 0..1 lane value onto the param's real (possibly log) range. */
export function autoDenorm(def: AutoParamDef, n: number): number {
  const t = clamp(n, 0, 1);
  return def.log ? def.min * Math.pow(def.max / def.min, t) : def.min + (def.max - def.min) * t;
}

/**
 * Interpolated lane value at a fractional step position. The lane is treated
 * as a LOOP: the segment after the last point wraps to the first. Returns
 * null when the lane has no points at all.
 */
export function autoValueAt(arr: (number | null)[], pos: number): number | null {
  const total = arr.length;
  if (total === 0) return null;
  // Previous point at or before floor(pos), scanning backward with wrap.
  const start = ((Math.floor(pos) % total) + total) % total;
  let pi = -1;
  for (let d = 0; d < total; d++) {
    const i = (start - d + total) % total;
    if (arr[i] != null) { pi = i; break; }
  }
  if (pi === -1) return null;
  // Next point strictly after it (wrapping).
  let ni = pi;
  for (let d = 1; d <= total; d++) {
    const i = (pi + d) % total;
    if (arr[i] != null) { ni = i; break; }
  }
  if (ni === pi) return arr[pi];
  const p = ((pos % total) + total) % total;
  const dPos = (p - pi + total) % total;
  const dSeg = ((ni - pi - 1 + total) % total) + 1;
  const t = clamp(dPos / dSeg, 0, 1);
  return (arr[pi] as number) * (1 - t) + (arr[ni] as number) * t;
}

function sanitizeAutomation(raw: unknown, total: number): AutomationMap {
  const out: AutomationMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const def of AUTO_PARAMS) {
    const src = (raw as Record<string, unknown>)[def.id];
    if (!Array.isArray(src)) continue;
    const arr = new Array<number | null>(total).fill(null);
    let any = false;
    for (let i = 0; i < Math.min(total, src.length); i++) {
      const v = src[i];
      if (typeof v === "number" && Number.isFinite(v)) {
        arr[i] = clamp(v, 0, 1);
        any = true;
      }
    }
    if (any) out[def.id] = arr;
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

/** Named pattern-only grooves for the Drum Bay (overwrites steps, not samples). */
export type DrumGrooveId = "house" | "trap" | "break" | "clear";

export function buildDrumGroove(id: DrumGrooveId, totalSteps: number): DrumPattern {
  if (id === "clear") return emptyDrums(totalSteps);
  if (id === "house") {
    const d = emptyDrums(totalSteps);
    for (let s = 0; s < totalSteps; s += 4) d.steps.kick[s] = 1; // four-on-the-floor
    for (let s = 4; s < totalSteps; s += 8) d.steps.clap[s] = 0.9;
    for (let s = 0; s < totalSteps; s += 2) d.steps.chat[s] = s % 4 === 2 ? 0.55 : 0.85;
    for (let s = 6; s < totalSteps; s += 8) d.steps.ohat[s] = 0.65;
    return d;
  }
  if (id === "trap") {
    const d = emptyDrums(totalSteps);
    for (let s = 0; s < totalSteps; s += 8) d.steps.kick[s] = 1;
    for (let s = 6; s < totalSteps; s += 16) d.steps.kick[s] = 0.85;
    for (let s = 4; s < totalSteps; s += 8) d.steps.snare[s] = 1;
    // Rolling hats
    for (let s = 0; s < totalSteps; s++) {
      d.steps.chat[s] = s % 2 === 0 ? 0.7 : 0.35;
    }
    for (let s = 14; s < totalSteps; s += 16) d.steps.ohat[s] = 0.6;
    return d;
  }
  // break — Amen-ish skeleton
  const d = emptyDrums(totalSteps);
  const kickHits = [0, 6, 10];
  const snareHits = [4, 12];
  for (let bar = 0; bar < Math.ceil(totalSteps / 16); bar++) {
    const o = bar * 16;
    for (const h of kickHits) if (o + h < totalSteps) d.steps.kick[o + h] = 1;
    for (const h of snareHits) if (o + h < totalSteps) d.steps.snare[o + h] = 1;
  }
  for (let s = 0; s < totalSteps; s += 2) d.steps.chat[s] = 0.75;
  for (let s = 2; s < totalSteps; s += 8) d.steps.ohat[s] = 0.5;
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

/** Push the committed Synth B patch from fireCommandStore into the engine. */
export function syncSynthBEngine(): void {
  void import("@/state/fireCommandStore").then(({ useFireCommandStore, slotsFromState }) => {
    const fire = useFireCommandStore.getState();
    const { patchB } = slotsFromState(fire);
    const patch = { ...DEFAULT_FIRE_PATCH, ...patchB };
    patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
    getEngine().fireCommandB.setPatch(patch);
  });
}

/** Load a factory preset into Synth B (editable patch, not voice-only). */
function applySynthBPreset(presetId: string): void {
  void import("@/state/fireCommandStore").then(({ useFireCommandStore, FIRE_PRESETS }) => {
    const preset = FIRE_PRESETS.find((p) => p.id === presetId)
      ?? FIRE_PRESETS.find((p) => p.id === DEFAULT_SYNTH_B_PRESET);
    if (!preset) return;
    useFireCommandStore.getState().importPatchB(preset.patch, preset.id);
  });
}

// ── persistence ──

const STORAGE_KEY = "killchain.firesequencer.v1";

interface PersistShape {
  bpm: number;
  swing: number; // 0..0.6 — delay applied to off-beat 16ths (synth group)
  /** Per-group swing (v1.6). Linked = every group follows `swing`. */
  swingDrums: number;
  swingSamples: number;
  swingLinked: boolean;
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
  /** The sample deck — lane definitions; step grids live inside sections. */
  samples: SampleLane[];
  /** Arrangement (v1.6+): pattern bank + absolute-time playlist clips. */
  sections: Section[];
  activeSectionId: string;
  arrangement: ArrangementClip[];
  /** Playlist rows (mute / solo / color / name) — clips live on `track`. */
  playlistTracks: PlaylistTrack[];
  playMode: PlayMode;
  /** Mixer (v1.6): per-part strips + Fire master limiter switch. */
  mixer: Record<MixerStripId, MixerStrip>;
  fireLimiterOn: boolean;
  /** Sidechain duck (v1.6): a drum lane pumps the synth (A+B) path. */
  duckEnabled: boolean;
  duckAmount: number;    // 0..1 depth
  duckReleaseMs: number; // 40..800
  duckSource: DrumLane;
  /** Live recording (v1.6): snap captured notes to the 1/16 grid. */
  recordQuantize: boolean;
}

/** Mirror of the active section — what the editors bind to and actions edit. */
interface ActiveMirror {
  bars: number;
  notes: RollNote[];
  drums: DrumPattern;
  automation: AutomationMap;
}

// ── Live recording (v1.6) ──
// Notes-in-flight while REC is armed: midi → { note id, capture start step }.
const pendingRec = new Map<number, { id: string; startStep: number }>();
/** One undo entry per record pass (reset on arm / play). */
let recPassPushed = false;

function starterSection(): Section {
  const bars = 2;
  const total = bars * STEPS_PER_BAR;
  return {
    id: sectionId(),
    name: "A",
    bars,
    notes: starterNotes(),
    drums: starterDrums(total),
    sampleSteps: {},
    automation: {},
  };
}

function defaults(): PersistShape {
  const sec = starterSection();
  return {
    bpm: 128,
    swing: 0,
    swingDrums: 0,
    swingSamples: 0,
    swingLinked: true,
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
    sections: [sec],
    activeSectionId: sec.id,
    arrangement: [{ id: clipId(), patternId: sec.id, startStep: 0, track: 0 }],
    playlistTracks: defaultPlaylistTracks(),
    playMode: "pattern",
    mixer: defaultMixer(),
    fireLimiterOn: true,
    duckEnabled: false,
    duckAmount: 0.6,
    duckReleaseMs: 220,
    duckSource: "kick",
    recordQuantize: true,
  };
}

function sanitizeNotes(raw: unknown, total: number): RollNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n) => n && typeof n.midi === "number")
    .map((n) => ({
      id: String(n.id ?? Math.random().toString(36).slice(2)),
      step: clamp(Number(n.step) || 0, 0, total - 0.25),
      midi: clamp(Math.round(n.midi), 12, 108),
      len: clamp(Number(n.len) || 1, 0.25, total),
      vel: clamp(Number(n.vel) || 0.85, 0.05, 1),
      ch: (n.ch === 1 ? 1 : 0) as SynthChannel,
    }));
}

function sanitizeDrums(raw: unknown, total: number): DrumPattern {
  const drums = emptyDrums(total);
  const steps = (raw as DrumPattern | undefined)?.steps;
  if (steps && typeof steps === "object") {
    for (const l of DRUM_LANES) {
      const src = steps[l.id];
      if (Array.isArray(src)) {
        for (let i = 0; i < Math.min(total, src.length); i++) {
          drums.steps[l.id][i] = clamp(Number(src[i]) || 0, 0, 1);
        }
      }
    }
  }
  return drums;
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

function clonePatchSnap(raw: unknown): FirePatch | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const patch = { ...DEFAULT_FIRE_PATCH, ...(raw as Partial<FirePatch>) };
  patch.modMatrix = makeModMatrix(Array.isArray(patch.modMatrix) ? patch.modMatrix : []);
  if ((raw as Partial<FirePatch>).moduleEnable) {
    patch.moduleEnable = { ...((raw as Partial<FirePatch>).moduleEnable as Record<string, boolean>) };
  }
  return patch;
}

/** Read live A/B patches from the synth store. */
function liveFireSlots(): { patchA: FirePatch; patchB: FirePatch } {
  return slotsFromState(useFireCommandStore.getState());
}

/** Push section snapshots into the synth store + both engines. */
function restoreSectionPatches(sec: Section): void {
  if (!sec.patchA && !sec.patchB) return;
  const fire = useFireCommandStore.getState();
  if (sec.patchA) {
    const patch = clonePatchSnap(sec.patchA)!;
    if (fire.editTarget === "a") {
      useFireCommandStore.setState({ patch, patchA: patch });
    } else {
      useFireCommandStore.setState({ patchA: patch });
    }
    getEngine().fireCommand.setPatch(patch);
  }
  if (sec.patchB) {
    const patch = clonePatchSnap(sec.patchB)!;
    if (fire.editTarget === "b") {
      useFireCommandStore.setState({ patch, patchB: patch });
    } else {
      useFireCommandStore.setState({ patchB: patch });
    }
    getEngine().fireCommandB.setPatch(patch);
  }
}

/** Stamp current live patches onto a section (always, per plan). */
function withLivePatchSnapshots(sec: Section): Section {
  try {
    const { patchA, patchB } = liveFireSlots();
    return {
      ...sec,
      patchA: structuredClone(patchA),
      patchB: structuredClone(patchB),
    };
  } catch {
    return sec;
  }
}

/** Last section whose sound was applied during arrangement play. */
let lastArrSoundSec: string | null = null;

function maybeRestoreArrSound(sectionId: string | null): void {
  if (!sectionId || sectionId === lastArrSoundSec) return;
  lastArrSoundSec = sectionId;
  const s = useFireSequencerStore.getState();
  const synced = sectionsWithActive(s).find((x) => x.id === sectionId)
    ?? s.sections.find((x) => x.id === sectionId);
  if (synced) restoreSectionPatches(synced);
}

function sanitizeSection(raw: unknown, fallbackName: string): Section | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Section>;
  const bars = clamp(Math.round(Number(r.bars) || 1), 1, MAX_BARS);
  const total = bars * STEPS_PER_BAR;
  const sampleSteps: Record<string, number[]> = {};
  if (r.sampleSteps && typeof r.sampleSteps === "object") {
    for (const [laneId, arr] of Object.entries(r.sampleSteps)) {
      if (!Array.isArray(arr)) continue;
      const steps = new Array<number>(total).fill(0);
      for (let i = 0; i < Math.min(total, arr.length); i++) {
        steps[i] = clamp(Number(arr[i]) || 0, 0, 1);
      }
      sampleSteps[laneId] = steps;
    }
  }
  return {
    id: typeof r.id === "string" ? r.id : sectionId(),
    name: typeof r.name === "string" && r.name.trim() ? r.name.slice(0, 24) : fallbackName,
    bars,
    notes: sanitizeNotes(r.notes, total),
    drums: sanitizeDrums(r.drums, total),
    sampleSteps,
    automation: sanitizeAutomation(r.automation, total),
    patchA: clonePatchSnap(r.patchA),
    patchB: clonePatchSnap(r.patchB),
  };
}

/** Steps for a lane inside a section (padded/zeroed to the section length). */
function laneStepsFor(sec: Section, laneId: string): number[] {
  const total = sec.bars * STEPS_PER_BAR;
  const src = sec.sampleSteps[laneId];
  const out = new Array<number>(total).fill(0);
  if (Array.isArray(src)) {
    for (let i = 0; i < Math.min(total, src.length); i++) out[i] = src[i];
  }
  return out;
}

/** Build the active-section editing mirror (samples get the section's grids). */
function mirrorOf(sec: Section, laneDefs: SampleLane[]): ActiveMirror & { samples: SampleLane[] } {
  return {
    bars: sec.bars,
    notes: sec.notes,
    drums: sec.drums,
    automation: sec.automation,
    samples: laneDefs.map((l) => ({ ...l, steps: laneStepsFor(sec, l.id) })),
  };
}

function load(): PersistShape & ActiveMirror {
  const d = defaults();
  const finish = (p: PersistShape): PersistShape & ActiveMirror => {
    const active = p.sections.find((s) => s.id === p.activeSectionId) ?? p.sections[0];
    const m = mirrorOf(active, p.samples);
    return {
      ...p,
      activeSectionId: active.id,
      samples: m.samples,
      bars: m.bars,
      notes: m.notes,
      drums: m.drums,
      automation: m.automation,
    };
  };
  if (typeof window === "undefined") return finish(d);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return finish(d);
    const p = JSON.parse(raw) as Partial<PersistShape> & {
      // v1 (pre-arrangement) top-level pattern fields:
      bars?: number; notes?: unknown; drums?: unknown;
    };

    let sections: Section[];
    let activeSectionId: string;
    let arrangement: ArrangementClip[];
    if (Array.isArray(p.sections) && p.sections.length > 0) {
      sections = p.sections
        .slice(0, MAX_SECTIONS)
        .map((s, i) => sanitizeSection(s, String.fromCharCode(65 + i)))
        .filter((s): s is Section => s !== null);
      if (sections.length === 0) sections = [starterSection()];
      activeSectionId = sections.some((s) => s.id === p.activeSectionId)
        ? (p.activeSectionId as string)
        : sections[0].id;
      const ids = new Set(sections.map((s) => s.id));
      const rawArr = (p as { arrangement?: unknown }).arrangement;
      if (Array.isArray(rawArr) && rawArr.length > 0) {
        arrangement = sanitizeArrangement(rawArr, sections);
      } else if (Array.isArray((p as { chain?: unknown }).chain)) {
        const chain = ((p as { chain: unknown[] }).chain)
          .filter((id): id is string => typeof id === "string" && ids.has(id))
          .slice(0, MAX_CLIPS);
        arrangement = chainToArrangement(chain, sections);
      } else {
        arrangement = [{ id: clipId(), patternId: sections[0].id, startStep: 0, track: 0 }];
      }
      if (arrangement.length === 0) {
        arrangement = [{ id: clipId(), patternId: sections[0].id, startStep: 0, track: 0 }];
      }
    } else {
      // ── v1 migration: the single persisted pattern becomes section "A". ──
      const bars = clamp(Math.round(p.bars ?? 2), 1, MAX_BARS);
      const total = bars * STEPS_PER_BAR;
      const hadDrums = !!(p.drums as DrumPattern | undefined)?.steps;
      const lanes = sanitizeSampleLanes(p.samples, total);
      const sec: Section = {
        id: sectionId(),
        name: "A",
        bars,
        notes: sanitizeNotes(p.notes, total),
        drums: hadDrums ? sanitizeDrums(p.drums, total) : starterDrums(total),
        sampleSteps: Object.fromEntries(lanes.map((l) => [l.id, l.steps])),
        automation: {},
      };
      sections = [sec];
      activeSectionId = sec.id;
      arrangement = [{ id: clipId(), patternId: sec.id, startStep: 0, track: 0 }];
    }

    const anySection = sections[0];
    const laneDefs = sanitizeSampleLanes(p.samples, anySection.bars * STEPS_PER_BAR);
    return finish({
      bpm: clamp(Number(p.bpm) || d.bpm, 40, 240),
      swing: clamp(Number(p.swing) || 0, 0, 0.6),
      swingDrums: clamp(Number(p.swingDrums) || 0, 0, 0.6),
      swingSamples: clamp(Number(p.swingSamples) || 0, 0, 0.6),
      swingLinked: p.swingLinked !== false,
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
      samples: laneDefs,
      sections,
      activeSectionId,
      arrangement,
      playlistTracks: sanitizePlaylistTracks((p as { playlistTracks?: unknown }).playlistTracks),
      playMode: migratePlayMode(p.playMode),
      mixer: sanitizeMixer(p.mixer),
      fireLimiterOn: p.fireLimiterOn !== false,
      duckEnabled: p.duckEnabled === true,
      duckAmount: clamp(Number(p.duckAmount ?? 0.6) || 0, 0, 1),
      duckReleaseMs: clamp(Number(p.duckReleaseMs ?? 220) || 220, 40, 800),
      duckSource: DRUM_LANES.some((l) => l.id === p.duckSource)
        ? (p.duckSource as DrumLane)
        : "kick",
      recordQuantize: p.recordQuantize !== false,
    });
  } catch {
    return finish(d);
  }
}

/** Fold the editing mirror back into the section list. */
function sectionsWithActive(s: {
  sections: Section[];
  activeSectionId: string;
  bars: number;
  notes: RollNote[];
  drums: DrumPattern;
  automation: AutomationMap;
  samples: SampleLane[];
}): Section[] {
  return s.sections.map((sec) =>
    sec.id === s.activeSectionId
      ? {
          ...sec,
          bars: s.bars,
          notes: s.notes,
          drums: s.drums,
          automation: s.automation,
          sampleSteps: Object.fromEntries(s.samples.map((l) => [l.id, l.steps])),
        }
      : sec,
  );
}

function persistShapeOf(s: FireSequencerState): PersistShape {
  return {
    bpm: s.bpm, swing: s.swing,
    swingDrums: s.swingDrums, swingSamples: s.swingSamples, swingLinked: s.swingLinked,
    drumLevel: s.drumLevel, synthEnabled: s.synthEnabled, drumsEnabled: s.drumsEnabled,
    synthBEnabled: s.synthBEnabled, synthBPresetId: s.synthBPresetId,
    activeChannel: s.activeChannel,
    collapsed: s.collapsed,
    scaleRoot: s.scaleRoot, scaleId: s.scaleId, scaleSnap: s.scaleSnap,
    drumSamples: s.drumSamples,
    samples: s.samples,
    sections: sectionsWithActive(s),
    activeSectionId: s.activeSectionId,
    arrangement: s.arrangement,
    playlistTracks: s.playlistTracks,
    playMode: s.playMode,
    mixer: s.mixer,
    fireLimiterOn: s.fireLimiterOn,
    duckEnabled: s.duckEnabled,
    duckAmount: s.duckAmount,
    duckReleaseMs: s.duckReleaseMs,
    duckSource: s.duckSource,
    recordQuantize: s.recordQuantize,
  };
}

/** Snapshot the full persisted pattern (sections synced) — .kcproj payload. */
export function serializePattern(): Record<string, unknown> {
  return persistShapeOf(useFireSequencerStore.getState()) as unknown as Record<string, unknown>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(get: () => FireSequencerState): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const data = persistShapeOf(get());
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

// Arrangement-mode clip map (rebuilt on start + whenever the arrangement changes).
interface SongSlot {
  clipId: string;
  sectionId: string;
  start: number;
  len: number;
  track: number;
}
let songMap: SongSlot[] = [];
let songTotal = 0;
/** Cue / scrub position when arrangement is stopped (absolute 16ths). */
let arrangementCueStep = 0;

function stepDur(bpm: number): number {
  return 60 / bpm / 4; // one 16th
}

function trackIsAudible(tracks: PlaylistTrack[], track: number): boolean {
  const anySolo = tracks.some((t) => t.solo);
  const t = tracks[track] ?? tracks[0];
  if (!t) return true;
  if (anySolo) return t.solo;
  return !t.mute;
}

function slotsCovering(globalStep: number, tracks: PlaylistTrack[]): SongSlot[] {
  return songMap.filter(
    (m) =>
      globalStep >= m.start
      && globalStep < m.start + m.len
      && trackIsAudible(tracks, m.track),
  );
}

/** Absolute clip layout. Empty arrangement → loop the active pattern once. */
function computeSongMap(s: FireSequencerState): { map: SongSlot[]; total: number } {
  const secs = sectionsWithActive(s);
  const byId = new Map(secs.map((x) => [x.id, x]));
  const clips = [...s.arrangement]
    .filter((c) => byId.has(c.patternId))
    .sort((a, b) => a.startStep - b.startStep || a.track - b.track || a.id.localeCompare(b.id));

  if (clips.length === 0) {
    const active = byId.get(s.activeSectionId) ?? secs[0];
    const len = active ? sectionLenSteps(active) : STEPS_PER_BAR;
    return {
      map: active
        ? [{ clipId: "_active", sectionId: active.id, start: 0, len, track: 0 }]
        : [],
      total: Math.max(len, 1),
    };
  }

  const map: SongSlot[] = [];
  let end = 0;
  for (const c of clips) {
    const sec = byId.get(c.patternId)!;
    const len = clipAudibleLen(c, sec);
    map.push({
      clipId: c.id,
      sectionId: c.patternId,
      start: c.startStep,
      len,
      track: clamp(c.track ?? 0, 0, MAX_PLAYLIST_TRACKS - 1),
    });
    end = Math.max(end, c.startStep + len);
  }
  return { map, total: Math.max(end, 1) };
}

/** Rebuild the live arrangement map mid-play (edits shouldn't stop the music). */
function refreshSongMap(get: () => FireSequencerState): void {
  const s = get();
  if (!s.playing || s.playMode !== "arrangement") return;
  const { map, total } = computeSongMap(s);
  songMap = map;
  songTotal = total;
}

/** Notes indexed by Math.floor(step) — WeakMap so edits that replace the
 *  array invalidate automatically; avoids O(notes) scans every scheduler step. */
const notesByStepCache = new WeakMap<RollNote[], Map<number, RollNote[]>>();

function notesByStep(notes: RollNote[]): Map<number, RollNote[]> {
  let m = notesByStepCache.get(notes);
  if (m) return m;
  m = new Map();
  for (const n of notes) {
    const k = Math.floor(n.step);
    const arr = m.get(k);
    if (arr) arr.push(n);
    else m.set(k, [n]);
  }
  notesByStepCache.set(notes, m);
  return m;
}

/** Pattern content the scheduler reads for one section (active = live mirror). */
function contentFor(s: FireSequencerState, secId: string): {
  notes: RollNote[];
  notesByStep: Map<number, RollNote[]>;
  drums: DrumPattern;
  laneSteps: (laneId: string) => number[] | undefined;
} {
  if (secId === s.activeSectionId) {
    return {
      notes: s.notes,
      notesByStep: notesByStep(s.notes),
      drums: s.drums,
      laneSteps: (laneId) => s.samples.find((l) => l.id === laneId)?.steps,
    };
  }
  const sec = s.sections.find((x) => x.id === secId);
  if (!sec) {
    return {
      notes: [],
      notesByStep: notesByStep([]),
      drums: emptyDrums(STEPS_PER_BAR),
      laneSteps: () => undefined,
    };
  }
  return {
    notes: sec.notes,
    notesByStep: notesByStep(sec.notes),
    drums: sec.drums,
    laneSteps: (laneId) => sec.sampleSteps[laneId],
  };
}

function stopScheduler(): void {
  startToken++;
  if (timer) { clearInterval(timer); timer = null; }
  lastArrSoundSec = null;
}

// ── automation playback (v1.7) ──
// Values go straight into the ENGINE's synth, bypassing fireCommandStore, so
// the patch/undo/persist pipeline never sees the sweeps. `autoTouched` tracks
// which knobs we moved, so stop() can put them back where the patch says.
const autoLastSent = new Map<AutoPatchKey, number>();
let autoTouched = new Set<AutoPatchKey>();

function applyAutomationTick(s: FireSequencerState, now: number): void {
  if (loopStartTime > now + 10) return; // clock not anchored yet
  const dur = stepDur(s.bpm);
  const song = s.playMode === "arrangement";
  const total = song ? songTotal : s.bars * STEPS_PER_BAR;
  if (total <= 0) return;
  const t = (now - loopStartTime) / dur;
  const g = (t < 0 ? 0 : t) % total;
  let auto: AutomationMap = s.automation;
  let pos = g;
  if (song) {
    const slots = slotsCovering(g, s.playlistTracks);
    // Prefer the active pattern's automation when layered; else first clip.
    const slot = slots.find((m) => m.sectionId === s.activeSectionId) ?? slots[0];
    if (!slot) return; // gap — silence, leave knobs alone this tick
    maybeRestoreArrSound(slot.sectionId);
    pos = g - slot.start;
    auto = slot.sectionId === s.activeSectionId
      ? s.automation
      : s.sections.find((x) => x.id === slot.sectionId)?.automation ?? {};
  }
  const fc = getEngine().fireCommand;
  for (const def of AUTO_PARAMS) {
    const arr = auto[def.id];
    if (!arr) continue;
    const n = autoValueAt(arr, pos);
    if (n == null) continue;
    const v = autoDenorm(def, n);
    const last = autoLastSent.get(def.patchKey);
    if (last !== undefined && Math.abs(v - last) < 1e-5 * Math.max(1, Math.abs(v))) continue;
    autoLastSent.set(def.patchKey, v);
    autoTouched.add(def.patchKey);
    fc.set(def.patchKey, v);
  }
}

/** Put every automated knob back where the store patch says it belongs. */
function restoreAutomationBaseline(): void {
  autoLastSent.clear();
  if (autoTouched.size === 0) return;
  const keys = [...autoTouched];
  autoTouched = new Set();
  // Dynamic import keeps the ~500-preset bank out of the boot chunk (same
  // reason as applySynthBPreset above).
  void import("@/state/fireCommandStore").then(({ useFireCommandStore }) => {
    const patch = useFireCommandStore.getState().patch;
    const fc = getEngine().fireCommand;
    for (const k of keys) fc.set(k, patch[k]);
  });
}

/** Fire drums + samples + synth for one pattern at a local step. */
function schedulePatternAtStep(
  s: FireSequencerState,
  engine: FireScheduleEngine,
  content: ReturnType<typeof contentFor>,
  step: number,
  whenSynth: number,
  whenDrums: number,
  whenSamples: number,
  dur: number,
): void {
  if (s.drumsEnabled) {
    for (const lane of DRUM_LANES) {
      const v = content.drums.steps[lane.id]?.[step] ?? 0;
      if (v > 0) {
        engine.fireDrums.trigger(lane.id, whenDrums, v);
        if (s.duckEnabled && lane.id === s.duckSource) {
          engine.fireDuckTrigger(whenDrums, s.duckAmount * v, s.duckReleaseMs / 1000);
        }
      }
    }
  }
  for (const sl of s.samples) {
    const v = content.laneSteps(sl.id)?.[step] ?? 0;
    if (v <= 0) continue;
    const buf = sampleBuffers.get(sl.path);
    if (buf) engine.fireDrums.playBuffer(buf, whenSamples, v, sl.level, true);
    else void loadSampleBuffer(sl.path);
  }
  if (s.synthEnabled || s.synthBEnabled) {
    const bucket = content.notesByStep.get(step);
    if (bucket) {
      for (const n of bucket) {
        const isB = n.ch === 1;
        if (isB ? !s.synthBEnabled : !s.synthEnabled) continue;
        const target = isB ? engine.fireCommandB : engine.fireCommand;
        const offset = (n.step - step) * dur;
        const fp = engine.fireCommand.getPatch();
        const humanOn = fp.moduleEnable?.["human"] !== false && fp.humanizeOn;
        let when = whenSynth + offset;
        let vel = n.vel;
        if (humanOn) {
          const tj = (fp.humanizeTiming ?? 0.25) * dur * 0.35;
          const vj = (fp.humanizeVelocity ?? 0.2) * 0.4;
          when += (Math.random() * 2 - 1) * tj;
          vel = Math.max(0.05, Math.min(1, n.vel * (1 + (Math.random() * 2 - 1) * vj)));
        }
        target.playNote(
          n.midi, vel, when, Math.max(0.03, n.len * dur * 0.98),
        );
      }
    }
  }
}

/** Engine surface used by the live scheduler and offline dry bounce. */
export type FireScheduleEngine = {
  fireCommand: { playNote: (midi: number, velocity: number, when: number, duration: number) => void; getPatch: () => { moduleEnable?: Record<string, boolean>; humanizeOn?: boolean; humanizeTiming?: number; humanizeVelocity?: number }; setPatch: (p: FirePatch) => void };
  fireCommandB: { playNote: (midi: number, velocity: number, when: number, duration: number) => void; setPatch: (p: FirePatch) => void };
  fireDrums: {
    trigger: (lane: import("@/audio/dsp/FireDrumKit").DrumLane, when: number, velocity?: number) => void;
    playBuffer: (buffer: AudioBuffer, when: number, velocity?: number, level?: number, toSampleBus?: boolean) => void;
  };
  fireDuckTrigger: (when: number, amount: number, releaseSec: number) => void;
};

/**
 * Schedule one full pattern or arrangement pass onto a Fire engine graph
 * (live or OfflineAudioContext). Returns duration including release tail.
 */
export function scheduleFirePass(
  s: FireSequencerState,
  engine: FireScheduleEngine,
  t0 = 0.05,
  tailSec = 1.6,
): { durationSec: number } {
  const dur = stepDur(s.bpm);
  const song = s.playMode === "arrangement";
  const { map, total } = song
    ? computeSongMap(s)
    : { map: [] as SongSlot[], total: s.bars * STEPS_PER_BAR };
  let lastSoundSec: string | null = null;
  const applySound = (sectionId: string) => {
    if (sectionId === lastSoundSec) return;
    lastSoundSec = sectionId;
    const sec = sectionsWithActive(s).find((x) => x.id === sectionId)
      ?? s.sections.find((x) => x.id === sectionId);
    if (!sec) return;
    if (sec.patchA) {
      const patch = clonePatchSnap(sec.patchA);
      if (patch) engine.fireCommand.setPatch(patch);
    }
    if (sec.patchB) {
      const patch = clonePatchSnap(sec.patchB);
      if (patch) engine.fireCommandB.setPatch(patch);
    }
  };

  for (let globalStep = 0; globalStep < total; globalStep++) {
    const base = t0 + globalStep * dur;
    if (song) {
      const slots = map.filter(
        (m) =>
          globalStep >= m.start
          && globalStep < m.start + m.len
          && trackIsAudible(s.playlistTracks, m.track),
      );
      if (slots.length === 0) continue;
      const primary = slots.find((m) => m.sectionId === s.activeSectionId) ?? slots[0];
      applySound(primary.sectionId);
      for (const slot of slots) {
        const step = globalStep - slot.start;
        const content = contentFor(s, slot.sectionId);
        const halfDur = dur * 0.5;
        const odd = step % 2 === 1;
        const whenSynth = base + (odd ? s.swing * halfDur : 0);
        const whenDrums = base + (odd ? (s.swingLinked ? s.swing : s.swingDrums) * halfDur : 0);
        const whenSamples = base + (odd ? (s.swingLinked ? s.swing : s.swingSamples) * halfDur : 0);
        schedulePatternAtStep(s, engine, content, step, whenSynth, whenDrums, whenSamples, dur);
      }
    } else {
      const step = globalStep;
      const content = contentFor(s, s.activeSectionId);
      const halfDur = dur * 0.5;
      const odd = step % 2 === 1;
      const whenSynth = base + (odd ? s.swing * halfDur : 0);
      const whenDrums = base + (odd ? (s.swingLinked ? s.swing : s.swingDrums) * halfDur : 0);
      const whenSamples = base + (odd ? (s.swingLinked ? s.swing : s.swingSamples) * halfDur : 0);
      schedulePatternAtStep(s, engine, content, step, whenSynth, whenDrums, whenSamples, dur);
    }
  }
  return { durationSec: t0 + total * dur + tailSec };
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

  if (get().playMode === "arrangement") {
    const { map, total } = computeSongMap(get());
    songMap = map;
    songTotal = total;
  }

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
    const cue = get().playMode === "arrangement"
      ? clamp(Math.floor(arrangementCueStep), 0, Math.max(0, songTotal - 1))
      : 0;
    loopStartTime = ctx.currentTime + 0.08 - cue * stepDur(get().bpm);
    nextStep = cue;

    const tick = () => {
      const s = get();
      if (!s.playing) return;
      const dur = stepDur(s.bpm);
      const song = s.playMode === "arrangement";
      const total = song ? songTotal : s.bars * STEPS_PER_BAR;
      const now = ctx.currentTime;
      const horizon = now + LOOKAHEAD_S;

      // Schedule every whole step whose start time falls inside the window.
      while (loopStartTime + nextStep * dur < horizon) {
        const globalStep = nextStep % total;

        const base = loopStartTime + nextStep * dur;
        // A step already well in the past (main thread stalled / background
        // throttling) is skipped rather than clamped to "now" — otherwise a
        // long stall fires the whole backlog as one machine-gun burst.
        if (base < now - 0.03) { nextStep++; continue; }

        if (song) {
          const slots = slotsCovering(globalStep, s.playlistTracks);
          if (slots.length === 0) { nextStep++; continue; } // gap / muted = silence
          const primary = slots.find((m) => m.sectionId === s.activeSectionId) ?? slots[0];
          maybeRestoreArrSound(primary.sectionId);
          for (const slot of slots) {
            const step = globalStep - slot.start;
            const content = contentFor(s, slot.sectionId);
            const halfDur = dur * 0.5;
            const odd = step % 2 === 1;
            const whenSynth = base + (odd ? s.swing * halfDur : 0);
            const whenDrums = base + (odd ? (s.swingLinked ? s.swing : s.swingDrums) * halfDur : 0);
            const whenSamples = base + (odd ? (s.swingLinked ? s.swing : s.swingSamples) * halfDur : 0);
            schedulePatternAtStep(s, engine, content, step, whenSynth, whenDrums, whenSamples, dur);
          }
        } else {
          const step = globalStep;
          const content = contentFor(s, s.activeSectionId);
          const halfDur = dur * 0.5;
          const odd = step % 2 === 1;
          const whenSynth = base + (odd ? s.swing * halfDur : 0);
          const whenDrums = base + (odd ? (s.swingLinked ? s.swing : s.swingDrums) * halfDur : 0);
          const whenSamples = base + (odd ? (s.swingLinked ? s.swing : s.swingSamples) * halfDur : 0);
          schedulePatternAtStep(s, engine, content, step, whenSynth, whenDrums, whenSamples, dur);
        }

        nextStep++;
        // Keep loopStartTime anchored so long sessions don't lose float precision.
        if (nextStep >= total * 4) {
          loopStartTime += nextStep * dur;
          nextStep = 0;
        }
      }

      // Automation rides the same tick: ~40 Hz control-rate knob movement.
      applyAutomationTick(s, now);
    };

    autoLastSent.clear();
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

/**
 * Current playhead in ACTIVE-PATTERN steps (fractional) — read from RAF, not
 * state. In arrangement mode it returns the local step while a clip of the
 * active pattern is sounding, and -1 while another pattern / gap plays.
 */
export function getPlayheadStep(bpm: number, bars: number): number {
  const ctx = getEngine().ctx;
  const dur = stepDur(bpm);
  const s = useFireSequencerStore.getState();
  if (s.playMode === "arrangement" && s.playing && songTotal > 0) {
    const t = (ctx.currentTime - loopStartTime) / dur;
    if (t < 0) return 0;
    const g = t % songTotal;
    const slots = slotsCovering(g, s.playlistTracks);
    const slot = slots.find((m) => m.sectionId === s.activeSectionId);
    if (!slot) return -1;
    return g - slot.start;
  }
  const total = bars * STEPS_PER_BAR;
  const t = (ctx.currentTime - loopStartTime) / dur;
  if (t < 0) return 0;
  return t % total;
}

/** Which pattern is currently sounding (for the pattern-chip glow). */
export function getPlayingSectionId(): string | null {
  const s = useFireSequencerStore.getState();
  if (!s.playing) return null;
  if (s.playMode !== "arrangement" || songTotal <= 0) return s.activeSectionId;
  const ctx = getEngine().ctx;
  const t = (ctx.currentTime - loopStartTime) / stepDur(s.bpm);
  if (t < 0) {
    const first = slotsCovering(0, s.playlistTracks)[0] ?? songMap[0];
    return first && first.start === 0 ? first.sectionId : null;
  }
  const g = t % songTotal;
  return slotsCovering(g, s.playlistTracks)[0]?.sectionId ?? null;
}

/** Total steps of one full arrangement pass — used by the exporter. */
export function songTotalSteps(s: FireSequencerState): number {
  return computeSongMap(s).total;
}

/** Which arrangement clip is sounding right now. null = gap / n/a. */
export function getPlayingClipId(): string | null {
  const ids = getPlayingClipIds();
  return ids[0] ?? null;
}

/** All audible arrangement clips under the playhead (multi-lane layering). */
export function getPlayingClipIds(): string[] {
  const s = useFireSequencerStore.getState();
  if (!s.playing || s.playMode !== "arrangement" || songTotal <= 0) return [];
  const t = (getEngine().ctx.currentTime - loopStartTime) / stepDur(s.bpm);
  const g = t < 0 ? 0 : t % songTotal;
  return slotsCovering(g, s.playlistTracks).map((m) => m.clipId);
}

/** Absolute arrangement playhead in 16th steps (for the timeline scrubber). */
export function getArrangementPlayheadStep(): number {
  const s = useFireSequencerStore.getState();
  if (s.playMode !== "arrangement") return 0;
  if (!s.playing || songTotal <= 0) return arrangementCueStep;
  const t = (getEngine().ctx.currentTime - loopStartTime) / stepDur(s.bpm);
  if (t < 0) return arrangementCueStep;
  return t % songTotal;
}

// ── store ──

let noteSeq = 0;
const noteId = () => `n${Date.now().toString(36)}${(noteSeq++).toString(36)}`;

export interface FireSequencerState extends PersistShape, ActiveMirror {
  playing: boolean;
  /** REC armed: live notes (QWERTY / on-screen / MIDI) land in the roll. */
  recording: boolean;

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
  /** Key assist (v1.6): detect key from the roll → apply to the scale. */
  detectAndApplyKey: () => { root: number; scaleId: ScaleId } | null;
  /** Key assist (v1.6): snap every note into the current scale. Returns moved count. */
  conformNotesToScale: () => number;

  // ── per-group swing (v1.6) ──
  setSwingDrums: (v: number) => void;
  setSwingSamples: (v: number) => void;
  setSwingLinked: (on: boolean) => void;

  /** Fill generator (v1.6): rewrite the LAST BAR of the drum grid as a fill. */
  generateDrumFill: () => void;

  // ── automation lanes (v1.7) ──
  /** Set (or erase with null) one lane point in the ACTIVE section. */
  setAutomationPoint: (param: AutoParamId, step: number, value: number | null) => void;
  /** Wipe a whole lane in the active section. */
  clearAutomationLane: (param: AutoParamId) => void;

  toggleDrumStep: (lane: DrumLane, step: number) => void;
  setDrumStep: (lane: DrumLane, step: number, vel: number) => void;
  clearDrums: () => void;
  /** Pattern-only groove presets (House / Trap / Break / Clear). */
  applyDrumGroove: (id: DrumGrooveId) => void;
  /** Clear all drum-lane sample overrides → back to Synth Kit. */
  clearDrumKitSamples: () => void;
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

  // ── arrangement (pattern bank + playlist) ──
  /** Switch the editors to another pattern (mirror swap). */
  setActiveSection: (id: string) => void;
  /** New blank pattern; returns its id (null = full). Does not place on timeline. */
  addSection: () => string | null;
  /** Duplicate the active pattern; returns new id (null = full). */
  duplicateSection: () => string | null;
  renameSection: (id: string, name: string) => void;
  removeSection: (id: string) => void;
  /** Place a pattern clip (snapped to bar). Overlap only blocked on the same track. */
  placeClip: (patternId: string, startStep: number, track?: number) => string | null;
  removeClip: (clipId: string) => void;
  /** Move a clip; optional track change. Same-track overlaps park after last free end. */
  moveClip: (clipId: string, startStep: number, track?: number) => void;
  duplicateClip: (clipId: string) => string | null;
  /** Nudge clip start by whole bars (negative = earlier). */
  nudgeClip: (clipId: string, barsDelta: number) => void;
  /** Trim audible length in steps (1..pattern length). Pass null to restore full. */
  trimClip: (clipId: string, lengthSteps: number | null) => void;
  setClipColor: (clipId: string, color: string | null) => void;
  setPlaylistTrack: (index: number, partial: Partial<PlaylistTrack>) => void;
  /** Scrub arrangement playhead (snapped to bar). Works while stopped or playing. */
  seekArrangement: (absoluteStep: number) => void;
  setPlayMode: (mode: PlayMode) => void;

  // ── mixer + sidechain (v1.6) ──
  setMixerStrip: (id: MixerStripId, partial: Partial<MixerStrip>) => void;
  setFireLimiterOn: (on: boolean) => void;
  setDuck: (partial: Partial<{
    enabled: boolean; amount: number; releaseMs: number; source: DrumLane;
  }>) => void;
  /** Re-apply the persisted mixer to the engine (view mount / project load). */
  syncFireMixer: () => void;

  // ── live recording (v1.6) ──
  setRecording: (on: boolean) => void;
  setRecordQuantize: (on: boolean) => void;
  /** Capture a live note-on into the roll (no-op unless playing + armed). */
  recordNoteOn: (midi: number, velocity: number) => void;
  /** Finalize the captured note's length. */
  recordNoteOff: (midi: number) => void;

  /** Replace the whole pattern from a project file (sanitized). */
  importPattern: (data: unknown) => boolean;
}

export const useFireSequencerStore = create<FireSequencerState>((set, get) => {
  const persist = () => schedulePersist(get);

  /** Resize note/drum/sample arrays when bar count changes (active section). */
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
    const automation: AutomationMap = {};
    for (const def of AUTO_PARAMS) {
      const src = s.automation[def.id];
      if (!src || src.length === 0) continue;
      const arr = new Array<number | null>(total).fill(null);
      // Growing repeats the lane; shrinking truncates (same rule as drums).
      for (let i = 0; i < total; i++) arr[i] = src[i % src.length] ?? null;
      automation[def.id] = arr;
    }
    return {
      bars,
      drums,
      samples,
      automation,
      notes: s.notes.filter((n) => n.step < total),
    };
  };

  return {
    ...load(),
    playing: false,
    recording: false,

    play: () => {
      if (get().playing) return;
      // One source at a time: the pattern silences the file player and any
      // media playing in Airspace.
      void import("@/lib/sourceArbiter").then(({ claimSource }) => claimSource("fire"));
      // Voice Synth B before its first note renders (lazy instantiation).
      const s = get();
      const anyB = s.notes.some((n) => n.ch === 1)
        || s.sections.some((sec) => sec.id !== s.activeSectionId && sec.notes.some((n) => n.ch === 1));
      if (s.synthBEnabled && anyB) {
        syncSynthBEngine();
      }
      // Persisted mixer/limiter state must be live before the first note.
      applyMixerToEngine(s);
      pendingRec.clear();
      recPassPushed = false;
      set({ playing: true });
      startScheduler(get);
    },

    stop: () => {
      const s = get();
      if (s.playing && s.playMode === "arrangement" && songTotal > 0) {
        const t = (getEngine().ctx.currentTime - loopStartTime) / stepDur(s.bpm);
        if (t >= 0) arrangementCueStep = Math.floor(t % songTotal);
      }
      set({ playing: false });
      stopScheduler();
      pendingRec.clear();
      const engine = getEngine();
      engine.fireCommand.allNotesOff();
      engine.peekFireCommandB()?.allNotesOff();
      // Automated knobs return to their patch positions.
      restoreAutomationBaseline();
    },

    togglePlay: () => (get().playing ? get().stop() : get().play()),

    setBpm: (bpm) => {
      const v = clamp(Math.round(bpm), 40, 240);
      pushFireHistory("bpm");
      // Re-anchor so the tempo change applies cleanly from "now".
      const wasPlaying = get().playing;
      set({ bpm: v });
      if (wasPlaying) startScheduler(get);
      persist();
    },

    setSwing: (swing) => {
      pushFireHistory("swing");
      set({ swing: clamp(swing, 0, 0.6) });
      persist();
    },

    setBars: (bars) => {
      const b = clamp(Math.round(bars), 1, MAX_BARS);
      if (b === get().bars) return;
      pushFireHistory();
      const wasPlaying = get().playing;
      set(resizeTo(b));
      if (wasPlaying) startScheduler(get);
      persist();
    },

    setSynthEnabled: (on) => { pushFireHistory(); set({ synthEnabled: on }); persist(); },
    setDrumsEnabled: (on) => { pushFireHistory(); set({ drumsEnabled: on }); persist(); },

    setSynthBEnabled: (on) => {
      pushFireHistory();
      set({ synthBEnabled: on });
      if (on) {
        syncSynthBEngine();
      } else {
        getEngine().peekFireCommandB()?.allNotesOff();
        // Drawing into a disarmed channel would be silent and confusing.
        if (get().activeChannel === 1) set({ activeChannel: 0 });
      }
      persist();
    },

    setSynthBPresetId: (id) => {
      pushFireHistory("synthBPreset");
      set({ synthBPresetId: id });
      applySynthBPreset(id);
      persist();
    },

    setActiveChannel: (ch) => {
      set({ activeChannel: ch });
      // Arm the channel you're about to draw into.
      if (ch === 1 && !get().synthBEnabled) get().setSynthBEnabled(true);
      // Keep Synth rack edit target in sync with Draw A/B.
      void import("@/state/fireCommandStore").then(({ useFireCommandStore }) => {
        useFireCommandStore.getState().setEditTarget(ch === 1 ? "b" : "a");
      });
      persist();
    },

    audition: (midi, vel, ch) => {
      const engine = getEngine();
      void engine.resume();
      if (ch === 1) {
        if (!engine.peekFireCommandB()) syncSynthBEngine();
        engine.fireCommandB.playNote(midi, vel, engine.ctx.currentTime, 0.18);
      } else {
        engine.fireCommand.playNote(midi, vel, engine.ctx.currentTime, 0.18);
      }
    },

    setCollapsed: (v) => { set({ collapsed: v }); persist(); },
    setDrumLevel: (v) => {
      const lvl = clamp(v, 0, 1.2);
      pushFireHistory("drumLevel");
      set({ drumLevel: lvl });
      getEngine().fireDrums.setLevel(lvl);
      persist();
    },

    addNote: (note) => {
      pushFireHistory("addNote");
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
      pushFireHistory(`note:${id}`);
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
      pushFireHistory("notesBatch");
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

    removeNote: (id) => {
      pushFireHistory();
      set({ notes: get().notes.filter((n) => n.id !== id) });
      persist();
    },
    removeNotes: (ids) => {
      pushFireHistory();
      const kill = new Set(ids);
      set({ notes: get().notes.filter((n) => !kill.has(n.id)) });
      persist();
    },
    clearNotes: () => { pushFireHistory(); set({ notes: [] }); persist(); },
    replaceNotes: (notes) => { pushFireHistory(); set({ notes }); persist(); },

    duplicateNotes: (ids, offsetSteps) => {
      pushFireHistory();
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
      pushFireHistory("transpose");
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
      pushFireHistory();
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
      pushFireHistory();
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

    setScaleRoot: (root) => {
      pushFireHistory("scaleRoot");
      set({ scaleRoot: clamp(Math.round(root), 0, 11) });
      persist();
    },
    setScaleId: (id) => { pushFireHistory(); set({ scaleId: id }); persist(); },
    setScaleSnap: (on) => { set({ scaleSnap: on }); persist(); },

    detectAndApplyKey: () => {
      const s = get();
      const hit = detectKeyFromNotes(s.notes);
      if (!hit) return null;
      pushFireHistory();
      set({ scaleRoot: hit.root, scaleId: hit.scaleId });
      persist();
      return { root: hit.root, scaleId: hit.scaleId };
    },

    conformNotesToScale: () => {
      const s = get();
      if (s.scaleId === "off") return 0;
      let moved = 0;
      const notes = s.notes.map((n) => {
        const midi = snapMidiToScale(n.midi, s.scaleRoot, s.scaleId);
        if (midi === n.midi) return n;
        moved++;
        return { ...n, midi };
      });
      if (moved === 0) return 0;
      pushFireHistory();
      set({ notes });
      persist();
      return moved;
    },

    setSwingDrums: (v) => {
      pushFireHistory("swingDrums");
      set({ swingDrums: clamp(v, 0, 0.6) });
      persist();
    },
    setSwingSamples: (v) => {
      pushFireHistory("swingSamples");
      set({ swingSamples: clamp(v, 0, 0.6) });
      persist();
    },
    setSwingLinked: (on) => { set({ swingLinked: on }); persist(); },

    generateDrumFill: () => {
      pushFireHistory();
      const s = get();
      const total = s.bars * STEPS_PER_BAR;
      const start = total - STEPS_PER_BAR; // the fill owns the last bar
      const steps = {} as Record<DrumLane, number[]>;
      for (const l of DRUM_LANES) steps[l.id] = [...s.drums.steps[l.id]];
      const clearBar = (lane: DrumLane) => {
        for (let i = start; i < total; i++) steps[lane][i] = 0;
      };

      // Kick thins out — keep the downbeat, drop the rest of the bar.
      clearBar("kick");
      steps.kick[start] = 1;
      // Snare density ramps toward the turnaround, velocities swelling.
      clearBar("snare");
      for (let i = 0; i < STEPS_PER_BAR; i++) {
        const pos = i / (STEPS_PER_BAR - 1); // 0..1 through the bar
        const density = 0.12 + pos * pos * 0.85;
        if (Math.random() < density) {
          steps.snare[start + i] = clamp(0.45 + pos * 0.55 + (Math.random() - 0.5) * 0.15, 0.3, 1);
        }
      }
      // Guarantee the classic closing burst.
      for (let i = STEPS_PER_BAR - 3; i < STEPS_PER_BAR; i++) {
        steps.snare[start + i] = clamp(0.7 + (i - (STEPS_PER_BAR - 3)) * 0.15, 0, 1);
      }
      // A couple of toms tumbling down the second half.
      clearBar("tom");
      for (let i = STEPS_PER_BAR / 2; i < STEPS_PER_BAR; i += 2) {
        if (Math.random() < 0.5) steps.tom[start + i] = 0.6 + Math.random() * 0.3;
      }
      // Open the hats up in the back half; drop the closed hats out for tension.
      for (let i = STEPS_PER_BAR / 2; i < STEPS_PER_BAR; i++) steps.chat[start + i] = 0;
      steps.ohat[start + STEPS_PER_BAR - 2] = 0.8;
      // Crash lands on the loop's downbeat — the payoff.
      steps.crash[0] = 1;

      set({ drums: { steps } });
      persist();
    },

    setAutomationPoint: (param, step, value) => {
      const s = get();
      const total = s.bars * STEPS_PER_BAR;
      const i = clamp(Math.round(step), 0, total - 1);
      // Paint strokes stream one call per crossed step — one undo entry per stroke.
      pushFireHistory(`auto:${param}`);
      const src = s.automation[param];
      const arr = src && src.length === total
        ? [...src]
        : new Array<number | null>(total).fill(null);
      arr[i] = value === null ? null : clamp(value, 0, 1);
      const automation: AutomationMap = { ...s.automation, [param]: arr };
      if (arr.every((v) => v == null)) delete automation[param];
      set({ automation });
      persist();
    },

    clearAutomationLane: (param) => {
      const s = get();
      if (!s.automation[param]) return;
      pushFireHistory();
      const automation = { ...s.automation };
      delete automation[param];
      set({ automation });
      persist();
    },

    toggleDrumStep: (lane, step) => {
      const s = get();
      const cur = s.drums.steps[lane][step] ?? 0;
      get().setDrumStep(lane, step, cur > 0 ? 0 : 1);
    },

    setDrumStep: (lane, step, vel) => {
      // Coalesce per lane: paint-drags across a row become one undo step.
      pushFireHistory(`drum:${lane}`);
      const s = get();
      const steps = { ...s.drums.steps };
      const arr = [...steps[lane]];
      arr[step] = clamp(vel, 0, 1);
      steps[lane] = arr;
      set({ drums: { steps } });
      persist();
    },

    clearDrums: () => {
      pushFireHistory();
      set({ drums: emptyDrums(get().bars * STEPS_PER_BAR) });
      persist();
    },

    applyDrumGroove: (id) => {
      pushFireHistory();
      const total = get().bars * STEPS_PER_BAR;
      set({ drums: buildDrumGroove(id, total) });
      persist();
    },

    clearDrumKitSamples: () => {
      pushFireHistory();
      const eng = getEngine().fireDrums;
      for (const lane of DRUM_LANES) eng.setSample(lane.id, null);
      set({ drumSamples: {} });
      persist();
    },

    euclidLane: (lane, pulses) => {
      pushFireHistory(`euclid:${lane}`);
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
      pushFireHistory();
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
      pushFireHistory();
      const s = get();
      const steps = { ...s.drums.steps };
      steps[lane] = new Array<number>(s.bars * STEPS_PER_BAR).fill(0);
      set({ drums: { steps } });
      persist();
    },

    setDrumSample: async (lane, filePath, name) => {
      pushFireHistory();
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
      pushFireHistory();
      const lane: SampleLane = {
        id: `sl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: name.slice(0, 40),
        path: filePath,
        level: 1,
        steps: new Array<number>(get().bars * STEPS_PER_BAR).fill(0),
      };
      set({ samples: [...get().samples, lane] });
      persist();
      return true;
    },

    removeSampleLane: (id) => {
      pushFireHistory();
      const s = get();
      // Drop the lane's step grids from every section too.
      const sections = s.sections.map((sec) => {
        if (!(id in sec.sampleSteps)) return sec;
        const rest = { ...sec.sampleSteps };
        delete rest[id];
        return { ...sec, sampleSteps: rest };
      });
      set({ samples: s.samples.filter((l) => l.id !== id), sections });
      persist();
    },

    setSampleStep: (id, step, vel) => {
      pushFireHistory(`sampleStep:${id}`);
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
      pushFireHistory(`sampleLevel:${id}`);
      set({
        samples: get().samples.map((l) =>
          l.id === id ? { ...l, level: clamp(level, 0, 1.5) } : l,
        ),
      });
      persist();
    },

    clearSampleLane: (id) => {
      pushFireHistory();
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
      if (buf) engine.fireDrums.playBuffer(buf, engine.ctx.currentTime, 1, lane.level, true);
      else void loadSampleBuffer(lane.path);
    },

    // ── arrangement (pattern bank + playlist) ──

    setActiveSection: (id) => {
      const s = get();
      if (id === s.activeSectionId) return;
      // Snapshot live A/B into the leaving section, then restore target if it has snaps.
      const sections = sectionsWithActive(s).map((sec) =>
        sec.id === s.activeSectionId ? withLivePatchSnapshots(sec) : sec,
      );
      const target = sections.find((x) => x.id === id);
      if (!target) return;
      const m = mirrorOf(target, s.samples);
      set({ sections, activeSectionId: id, ...m });
      restoreSectionPatches(target);
      lastArrSoundSec = id;
      if (s.playing && s.playMode === "pattern") startScheduler(get);
      refreshSongMap(get);
      persist();
    },

    addSection: () => {
      const s = get();
      if (s.sections.length >= MAX_SECTIONS) return null;
      pushFireHistory();
      const sections = sectionsWithActive(s);
      const bars = 2;
      const total = bars * STEPS_PER_BAR;
      const sec: Section = {
        id: sectionId(),
        name: nextSectionName(sections),
        bars,
        notes: [],
        drums: emptyDrums(total),
        sampleSteps: Object.fromEntries(s.samples.map((l) => [l.id, new Array(total).fill(0)])),
        automation: {},
      };
      const m = mirrorOf(sec, s.samples);
      set({
        sections: [...sections, sec],
        activeSectionId: sec.id,
        ...m,
      });
      if (s.playing && s.playMode === "pattern") startScheduler(get);
      refreshSongMap(get);
      persist();
      return sec.id;
    },

    duplicateSection: () => {
      const s = get();
      if (s.sections.length >= MAX_SECTIONS) return null;
      pushFireHistory();
      const sections = sectionsWithActive(s);
      const src = sections.find((x) => x.id === s.activeSectionId) ?? sections[0];
      const sec: Section = {
        id: sectionId(),
        name: nextSectionName(sections),
        bars: src.bars,
        notes: src.notes.map((n) => ({ ...n, id: noteId() })),
        drums: structuredClone(src.drums),
        sampleSteps: structuredClone(src.sampleSteps),
        automation: structuredClone(src.automation),
        patchA: src.patchA ? structuredClone(src.patchA) : undefined,
        patchB: src.patchB ? structuredClone(src.patchB) : undefined,
      };
      const m = mirrorOf(sec, s.samples);
      set({
        sections: [...sections, sec],
        activeSectionId: sec.id,
        ...m,
      });
      if (s.playing && s.playMode === "pattern") startScheduler(get);
      refreshSongMap(get);
      persist();
      return sec.id;
    },

    renameSection: (id, name) => {
      const trimmed = name.trim().slice(0, 24);
      if (!trimmed) return;
      pushFireHistory();
      set({
        sections: get().sections.map((sec) =>
          sec.id === id ? { ...sec, name: trimmed } : sec,
        ),
      });
      persist();
    },

    removeSection: (id) => {
      const s = get();
      if (s.sections.length <= 1) return;
      pushFireHistory();
      const synced = sectionsWithActive(s).filter((x) => x.id !== id);
      const arrangement = s.arrangement.filter((c) => c.patternId !== id);
      if (id === s.activeSectionId) {
        const target = synced[0];
        const m = mirrorOf(target, s.samples);
        set({ sections: synced, arrangement, activeSectionId: target.id, ...m });
        if (s.playing && s.playMode === "pattern") startScheduler(get);
      } else {
        set({ sections: synced, arrangement });
      }
      refreshSongMap(get);
      persist();
    },

    placeClip: (patternId, startStep, track = 0) => {
      const s = get();
      if (s.arrangement.length >= MAX_CLIPS) return null;
      const secs = sectionsWithActive(s);
      const sec = secs.find((x) => x.id === patternId);
      if (!sec) return null;
      pushFireHistory();
      const len = sectionLenSteps(sec);
      const tr = clamp(Math.round(track), 0, MAX_PLAYLIST_TRACKS - 1);
      let start = snapToBar(startStep);
      const maxStart = (MAX_ARRANGEMENT_BARS - sec.bars) * STEPS_PER_BAR;
      start = clamp(start, 0, Math.max(0, maxStart));

      const occupied = s.arrangement
        .filter((c) => (c.track ?? 0) === tr)
        .map((c) => {
          const p = secs.find((x) => x.id === c.patternId);
          return p ? { start: c.startStep, len: clipAudibleLen(c, p) } : null;
        })
        .filter((x): x is { start: number; len: number } => !!x);

      const overlaps = (st: number) =>
        occupied.some((o) => st < o.start + o.len && o.start < st + len);

      if (overlaps(start)) return null;

      const id = clipId();
      set({
        arrangement: [...s.arrangement, { id, patternId, startStep: start, track: tr }],
      });
      refreshSongMap(get);
      persist();
      return id;
    },

    removeClip: (id) => {
      const s = get();
      if (!s.arrangement.some((c) => c.id === id)) return;
      pushFireHistory();
      set({ arrangement: s.arrangement.filter((c) => c.id !== id) });
      refreshSongMap(get);
      persist();
    },

    moveClip: (id, startStep, track) => {
      const s = get();
      const clip = s.arrangement.find((c) => c.id === id);
      if (!clip) return;
      const secs = sectionsWithActive(s);
      const sec = secs.find((x) => x.id === clip.patternId);
      if (!sec) return;
      pushFireHistory();
      const len = clipAudibleLen(clip, sec);
      const tr = clamp(
        Math.round(track == null ? (clip.track ?? 0) : track),
        0,
        MAX_PLAYLIST_TRACKS - 1,
      );
      let start = snapToBar(startStep);
      const maxStart = (MAX_ARRANGEMENT_BARS - sec.bars) * STEPS_PER_BAR;
      start = clamp(start, 0, Math.max(0, maxStart));

      const occupied = s.arrangement
        .filter((c) => c.id !== id && (c.track ?? 0) === tr)
        .map((c) => {
          const p = secs.find((x) => x.id === c.patternId);
          return p ? { start: c.startStep, len: clipAudibleLen(c, p) } : null;
        })
        .filter((x): x is { start: number; len: number } => !!x);

      const overlaps = (st: number) =>
        occupied.some((o) => st < o.start + o.len && o.start < st + len);

      if (overlaps(start)) return;

      set({
        arrangement: s.arrangement.map((c) =>
          c.id === id ? { ...c, startStep: start, track: tr } : c,
        ),
      });
      refreshSongMap(get);
      persist();
    },

    duplicateClip: (id) => {
      const s = get();
      const clip = s.arrangement.find((c) => c.id === id);
      if (!clip || s.arrangement.length >= MAX_CLIPS) return null;
      const secs = sectionsWithActive(s);
      const sec = secs.find((x) => x.id === clip.patternId);
      if (!sec) return null;
      const len = clipAudibleLen(clip, sec);
      const newId = get().placeClip(clip.patternId, clip.startStep + len, clip.track ?? 0);
      if (!newId) return null;
      if (clip.lengthSteps != null || clip.color) {
        set({
          arrangement: get().arrangement.map((c) =>
            c.id === newId
              ? {
                  ...c,
                  lengthSteps: clip.lengthSteps,
                  color: clip.color,
                }
              : c,
          ),
        });
        refreshSongMap(get);
        persist();
      }
      return newId;
    },

    nudgeClip: (id, barsDelta) => {
      const s = get();
      const clip = s.arrangement.find((c) => c.id === id);
      if (!clip || !Number.isFinite(barsDelta) || barsDelta === 0) return;
      get().moveClip(id, clip.startStep + Math.round(barsDelta) * STEPS_PER_BAR, clip.track);
    },

    trimClip: (id, lengthSteps) => {
      const s = get();
      const clip = s.arrangement.find((c) => c.id === id);
      if (!clip) return;
      const secs = sectionsWithActive(s);
      const sec = secs.find((x) => x.id === clip.patternId);
      if (!sec) return;
      pushFireHistory();
      const full = sectionLenSteps(sec);
      const nextLen = lengthSteps == null
        ? undefined
        : clamp(snapToStep(lengthSteps), 1, full);
      set({
        arrangement: s.arrangement.map((c) =>
          c.id === id
            ? { ...c, lengthSteps: nextLen === full ? undefined : nextLen }
            : c,
        ),
      });
      refreshSongMap(get);
      persist();
    },

    setClipColor: (id, color) => {
      const s = get();
      if (!s.arrangement.some((c) => c.id === id)) return;
      pushFireHistory();
      set({
        arrangement: s.arrangement.map((c) =>
          c.id === id
            ? { ...c, color: color && color.trim() ? color.trim() : undefined }
            : c,
        ),
      });
      persist();
    },

    setPlaylistTrack: (index, partial) => {
      const i = clamp(Math.round(index), 0, MAX_PLAYLIST_TRACKS - 1);
      const s = get();
      pushFireHistory(`playlist:${i}`);
      const next = [...(s.playlistTracks.length === MAX_PLAYLIST_TRACKS
        ? s.playlistTracks
        : sanitizePlaylistTracks(s.playlistTracks))];
      const t = next[i];
      next[i] = {
        name: typeof partial.name === "string" && partial.name.trim()
          ? partial.name.trim().slice(0, 18)
          : t.name,
        mute: partial.mute ?? t.mute,
        solo: partial.solo ?? t.solo,
        color: typeof partial.color === "string" && partial.color ? partial.color : t.color,
      };
      set({ playlistTracks: next });
      // Mute/solo changes affect live layering without restarting.
      refreshSongMap(get);
      persist();
    },

    seekArrangement: (absoluteStep) => {
      const s = get();
      if (s.playMode !== "arrangement") return;
      const { map, total } = computeSongMap(s);
      songMap = map;
      songTotal = total;
      const step = clamp(snapToBar(absoluteStep), 0, Math.max(0, total - STEPS_PER_BAR));
      arrangementCueStep = step;
      if (!s.playing) return;
      const ctx = getEngine().ctx;
      const dur = stepDur(s.bpm);
      // Re-anchor so the live playhead jumps without stopping transport.
      loopStartTime = ctx.currentTime - step * dur;
      nextStep = step;
      const engine = getEngine();
      engine.fireCommand.allNotesOff();
      engine.peekFireCommandB()?.allNotesOff();
    },

    setPlayMode: (mode) => {
      if (mode === get().playMode) return;
      const wasPlaying = get().playing;
      set({ playMode: mode });
      if (wasPlaying) startScheduler(get);
      persist();
    },

    // ── mixer + sidechain (v1.6) ──

    setMixerStrip: (id, partial) => {
      pushFireHistory(`mixer:${id}`);
      const s = get();
      const cur = s.mixer[id];
      const strip: MixerStrip = {
        level: clamp(Number(partial.level ?? cur.level), 0, 1.5),
        pan: clamp(Number(partial.pan ?? cur.pan), -1, 1),
        mute: partial.mute ?? cur.mute,
        solo: partial.solo ?? cur.solo,
      };
      const mixer = { ...s.mixer, [id]: strip };
      set({ mixer });
      applyMixerToEngine({ mixer, fireLimiterOn: s.fireLimiterOn });
      persist();
    },

    setFireLimiterOn: (on) => {
      pushFireHistory();
      set({ fireLimiterOn: on });
      applyMixerToEngine(get());
      persist();
    },

    setDuck: (partial) => {
      pushFireHistory("duck");
      const s = get();
      set({
        duckEnabled: partial.enabled ?? s.duckEnabled,
        duckAmount: clamp(Number(partial.amount ?? s.duckAmount), 0, 1),
        duckReleaseMs: clamp(Number(partial.releaseMs ?? s.duckReleaseMs), 40, 800),
        duckSource: partial.source ?? s.duckSource,
      });
      // Turning duck off mid-play: release the gain back to unity.
      if (partial.enabled === false) {
        getEngine().fireDuckTrigger(0, 0, 0.05);
      }
      persist();
    },

    syncFireMixer: () => applyMixerToEngine(get()),

    // ── live recording (v1.6) ──

    setRecording: (on) => {
      pendingRec.clear();
      recPassPushed = false;
      set({ recording: on });
    },

    setRecordQuantize: (on) => { set({ recordQuantize: on }); persist(); },

    recordNoteOn: (midi, velocity) => {
      const s = get();
      if (!s.recording || !s.playing) return;
      // Playhead in ACTIVE-section steps; -1 = song mode is elsewhere.
      const raw = getPlayheadStep(s.bpm, s.bars);
      if (raw < 0) return;
      const total = s.bars * STEPS_PER_BAR;
      let step = s.recordQuantize ? Math.round(raw) % total : raw;
      step = clamp(step, 0, total - 0.25);
      // The whole pass is ONE undo entry — capture state before its first note.
      if (!recPassPushed) { pushFireHistory(); recPassPushed = true; }
      const id = noteId();
      const n: RollNote = {
        id,
        step,
        midi: clamp(Math.round(midi), 12, 108),
        len: 1,
        vel: clamp(velocity, 0.05, 1),
        ch: s.activeChannel,
      };
      pendingRec.set(midi, { id, startStep: step });
      set({ notes: [...get().notes, n] });
      persist();
    },

    recordNoteOff: (midi) => {
      const rec = pendingRec.get(midi);
      if (!rec) return;
      pendingRec.delete(midi);
      const s = get();
      const raw = getPlayheadStep(s.bpm, s.bars);
      if (raw < 0) return; // song moved on — keep the default length
      const total = s.bars * STEPS_PER_BAR;
      // Wrapped past the loop point: add a full pass to get a positive length.
      const end = raw >= rec.startStep ? raw : raw + total;
      const len = clamp(end - rec.startStep, 0.25, total);
      set({
        notes: s.notes.map((n) => (n.id === rec.id ? { ...n, len } : n)),
      });
      persist();
    },

    importPattern: (data) => {
      if (!data || typeof data !== "object") return false;
      pushFireHistory();
      const wasPlaying = get().playing;
      if (wasPlaying) get().stop();
      try {
        // Round-trip the import through the same normalization + v1→v2
        // migration the loader uses — write to storage, re-load, apply.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        set({ ...load() });
        void get().hydrateSamples();
        applyMixerToEngine(get());
        return true;
      } catch {
        return false;
      }
    },
  };
});

// ── undo/redo provider (v1.6) ──
// Everything user-editable in the arrangement is one history slice; playback /
// panel-collapse flags are deliberately excluded so undo never stops audio.
registerFireHistoryProvider("fireSequencer", {
  capture: () => {
    const s = useFireSequencerStore.getState();
    return {
      bpm: s.bpm, swing: s.swing, bars: s.bars, notes: s.notes, drums: s.drums,
      automation: s.automation,
      swingDrums: s.swingDrums, swingSamples: s.swingSamples, swingLinked: s.swingLinked,
      drumLevel: s.drumLevel, synthEnabled: s.synthEnabled,
      drumsEnabled: s.drumsEnabled, synthBEnabled: s.synthBEnabled,
      synthBPresetId: s.synthBPresetId, activeChannel: s.activeChannel,
      scaleRoot: s.scaleRoot, scaleId: s.scaleId, scaleSnap: s.scaleSnap,
      drumSamples: s.drumSamples, samples: s.samples,
      // Mirror + sections are captured consistent with each other.
      sections: sectionsWithActive(s),
      activeSectionId: s.activeSectionId,
      arrangement: s.arrangement,
      playlistTracks: s.playlistTracks,
      playMode: s.playMode,
      mixer: s.mixer,
      fireLimiterOn: s.fireLimiterOn,
      duckEnabled: s.duckEnabled,
      duckAmount: s.duckAmount,
      duckReleaseMs: s.duckReleaseMs,
      duckSource: s.duckSource,
    };
  },
  restore: (snap) => {
    const wasPlaying = useFireSequencerStore.getState().playing;
    const raw = snap as Partial<FireSequencerState> & { playlistTracks?: unknown };
    useFireSequencerStore.setState({
      ...raw,
      playlistTracks: sanitizePlaylistTracks(raw.playlistTracks),
    } as Partial<FireSequencerState>);
    const ns = useFireSequencerStore.getState();
    const engine = getEngine();
    engine.fireDrums.setLevel(ns.drumLevel);
    // Drum-lane overrides that no longer exist in the snapshot must be
    // cleared in the engine; hydrateSamples re-applies the ones that do.
    for (const lane of DRUM_LANES) {
      if (!ns.drumSamples[lane.id]) engine.fireDrums.setSample(lane.id, null);
    }
    void ns.hydrateSamples();
    if (ns.synthBEnabled) syncSynthBEngine();
    applyMixerToEngine(ns);
    if (wasPlaying) startScheduler(useFireSequencerStore.getState);
    schedulePersist(useFireSequencerStore.getState);
  },
});
