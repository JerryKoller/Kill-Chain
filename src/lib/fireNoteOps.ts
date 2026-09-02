/**
 * Piano-roll note transforms.
 *
 * The roll could place, drag, resize and erase notes, but had no editing
 * toolbox: no quantize, no length ops, no chord building, no transpose by
 * interval, no velocity shaping. Anything rhythmically or harmonically
 * involved meant dragging notes one at a time against a 16th grid.
 *
 * Pure functions over `RollNote[]` so they're testable and reusable from both
 * the store actions and the roll's own toolbar. Every op:
 *   - respects a scope (explicit selection, else the whole active channel),
 *   - stays inside the pattern (`total` steps) and legal pitch range,
 *   - returns a NEW array plus a count of what it touched (for toasts).
 */

import type { RollNote } from "@/state/fireSequencerStore";

/** Lowest legal note length, matching the roll's own minimum. */
export const MIN_LEN = 0.25;
const MIDI_LO = 0;
const MIDI_HI = 127;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Keep a note inside the pattern: start in range, length not past `total`. */
function fitNoteInPattern(n: RollNote, total: number): RollNote {
  const step = clamp(n.step, 0, Math.max(0, total - MIN_LEN));
  const maxLen = Math.max(MIN_LEN, total - step);
  const len = clamp(n.len, MIN_LEN, maxLen);
  if (step === n.step && len === n.len) return n;
  return { ...n, step, len };
}

export interface NoteOpScope {
  /** Only touch these note ids. Omit to touch every note in `channel`. */
  ids?: ReadonlySet<string>;
  /** Channel gate — ops never reach across instruments. */
  channel: number;
  /** Pattern length in steps; nothing may extend past it. */
  total: number;
}

export interface NoteOpResult {
  notes: RollNote[];
  /** How many notes the op actually changed / created. */
  touched: number;
}

/** True when this note is in scope for the current op. */
function inScope(n: RollNote, scope: NoteOpScope): boolean {
  if ((n.ch ?? 0) !== scope.channel) return false;
  return scope.ids ? scope.ids.has(n.id) : true;
}

/** Shared map-with-count helper: keeps every op's bookkeeping identical. */
function mapScoped(
  notes: RollNote[],
  scope: NoteOpScope,
  fn: (n: RollNote) => RollNote,
): NoteOpResult {
  let touched = 0;
  const out = notes.map((n) => {
    if (!inScope(n, scope)) return n;
    const next = fn(n);
    if (next !== n) touched++;
    return next;
  });
  return { notes: out, touched };
}

// ── Timing ───────────────────────────────────────────────────────────────

/**
 * Snap note starts to `grid` steps. `strength` 1 = hard snap, 0.5 = pull
 * halfway (keeps feel while tightening), 0 = no-op.
 *
 * Partial strength matters: hard-quantizing a hand-played line strips the
 * groove, which is why the roll's existing 1/16 record-quantize felt rigid.
 */
export function quantize(
  notes: RollNote[],
  scope: NoteOpScope,
  grid: number,
  strength = 1,
): NoteOpResult {
  const g = Math.max(MIN_LEN, grid);
  const amt = clamp(strength, 0, 1);
  if (amt === 0) return { notes, touched: 0 };
  return mapScoped(notes, scope, (n) => {
    const target = Math.round(n.step / g) * g;
    const step = n.step + (target - n.step) * amt;
    return Math.abs(step - n.step) < 1e-6 ? n : fitNoteInPattern({ ...n, step }, scope.total);
  });
}

/** Quantize note ENDS (length) to the grid, leaving starts alone. */
export function quantizeLength(
  notes: RollNote[],
  scope: NoteOpScope,
  grid: number,
): NoteOpResult {
  const g = Math.max(MIN_LEN, grid);
  return mapScoped(notes, scope, (n) => {
    const len = clamp(Math.max(g, Math.round(n.len / g) * g), MIN_LEN, scope.total - n.step);
    return Math.abs(len - n.len) < 1e-6 ? n : { ...n, len };
  });
}

/** Shift notes in time by whole/fractional steps. */
export function nudge(notes: RollNote[], scope: NoteOpScope, deltaSteps: number): NoteOpResult {
  if (deltaSteps === 0) return { notes, touched: 0 };
  return mapScoped(notes, scope, (n) =>
    fitNoteInPattern({ ...n, step: n.step + deltaSteps }, scope.total),
  );
}

/**
 * One-shot piano-roll scatter (Tools / Shift+H / roll Scatter). Independent of
 * the live Feel Grain knobs — those stay a playback-time overlay until Bake.
 */
export const NOTE_SCATTER_TIMING = 0.12;
export const NOTE_SCATTER_VELOCITY = 0.12;

/**
 * Deterministic timing/velocity scatter, seeded by note position so the same
 * pattern humanizes identically every render (offline export parity).
 */
export function humanize(
  notes: RollNote[],
  scope: NoteOpScope,
  timing: number,
  velocity: number,
  opts: { protectDownbeats?: boolean; seed?: number } = {},
): NoteOpResult {
  if (!(timing > 0) && !(velocity > 0)) return { notes, touched: 0 };
  const protect = opts.protectDownbeats !== false;
  const seed = (opts.seed ?? 0x4f1ce) >>> 0;
  return mapScoped(notes, scope, (n) => {
    if (protect && Math.abs(n.step % 16) < 1e-6) return n;
    // Hash on id + step: stable across re-runs, uncorrelated between notes.
    let h = (seed ^ Math.imul(Math.floor(n.step * 4) + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < n.id.length; i++) h = (Math.imul(h ^ n.id.charCodeAt(i), 0x85ebca6b) >>> 0);
    const r1 = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
    h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0;
    const r2 = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
    const dStep = (r1 * 2 - 1) * timing;
    const dVel = (r2 * 2 - 1) * velocity;
    if (dStep === 0 && dVel === 0) return n;
    return fitNoteInPattern(
      {
        ...n,
        step: n.step + dStep,
        vel: clamp(n.vel + dVel, 0.05, 1),
      },
      scope.total,
    );
  });
}

/**
 * Spread simultaneous notes into a strum/flam.
 *
 * Chords entered as blocks had no way to become guitar-like or rolled; this
 * offsets each note in a stack by `spread` steps, ordered low→high (or
 * reversed for a down-strum).
 */
export function strum(
  notes: RollNote[],
  scope: NoteOpScope,
  spread: number,
  down = false,
): NoteOpResult {
  // Group by rounded start so a slightly-humanized chord still counts as one.
  const groups = new Map<number, RollNote[]>();
  for (const n of notes) {
    if (!inScope(n, scope)) continue;
    const key = Math.round(n.step * 4) / 4;
    const list = groups.get(key);
    if (list) list.push(n); else groups.set(key, [n]);
  }
  const offset = new Map<string, number>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (down ? b.midi - a.midi : a.midi - b.midi));
    sorted.forEach((n, i) => offset.set(n.id, i * spread));
  }
  if (offset.size === 0) return { notes, touched: 0 };
  return mapScoped(notes, scope, (n) => {
    const off = offset.get(n.id);
    if (!off) return n;
    return fitNoteInPattern({ ...n, step: n.step + off }, scope.total);
  });
}

// ── Length ───────────────────────────────────────────────────────────────

export type LengthMode = "legato" | "staccato" | "double" | "half" | "toGrid";

/**
 * Length shaping.
 *
 * `legato` stretches each note to meet the next note on the same pitch lane
 * (the musically useful definition — stretching to the next note of ANY pitch
 * turns chords into mush).
 */
export function setLengths(
  notes: RollNote[],
  scope: NoteOpScope,
  mode: LengthMode,
  grid = 1,
): NoteOpResult {
  if (mode === "legato") {
    // Next start per pitch lane, so overlaps are resolved per-voice.
    const byPitch = new Map<number, number[]>();
    for (const n of notes) {
      if ((n.ch ?? 0) !== scope.channel) continue;
      const list = byPitch.get(n.midi);
      if (list) list.push(n.step); else byPitch.set(n.midi, [n.step]);
    }
    for (const list of byPitch.values()) list.sort((a, b) => a - b);
    return mapScoped(notes, scope, (n) => {
      const lane = byPitch.get(n.midi);
      const next = lane?.find((s) => s > n.step + 1e-6);
      const end = next ?? scope.total;
      const len = clamp(end - n.step, MIN_LEN, scope.total - n.step);
      return Math.abs(len - n.len) < 1e-6 ? n : { ...n, len };
    });
  }
  return mapScoped(notes, scope, (n) => {
    let len = n.len;
    if (mode === "staccato") len = Math.max(MIN_LEN, Math.min(n.len, 0.5));
    else if (mode === "double") len = n.len * 2;
    else if (mode === "half") len = n.len / 2;
    else if (mode === "toGrid") len = Math.max(grid, Math.round(n.len / grid) * grid);
    len = clamp(len, MIN_LEN, scope.total - n.step);
    return Math.abs(len - n.len) < 1e-6 ? n : { ...n, len };
  });
}

/**
 * Glue touching/overlapping same-pitch notes into one.
 *
 * Recording a held note across a loop boundary, or drawing over an existing
 * note, left stacked duplicates that retrigger — audible as a stutter.
 */
export function joinNotes(notes: RollNote[], scope: NoteOpScope): NoteOpResult {
  const scoped: RollNote[] = [];
  const rest: RollNote[] = [];
  for (const n of notes) (inScope(n, scope) ? scoped : rest).push(n);
  if (scoped.length < 2) return { notes, touched: 0 };

  const byPitch = new Map<number, RollNote[]>();
  for (const n of scoped) {
    const list = byPitch.get(n.midi);
    if (list) list.push(n); else byPitch.set(n.midi, [n]);
  }
  const merged: RollNote[] = [];
  let touched = 0;
  for (const list of byPitch.values()) {
    const sorted = [...list].sort((a, b) => a.step - b.step);
    let cur = { ...sorted[0] };
    for (let i = 1; i < sorted.length; i++) {
      const n = sorted[i];
      // Touching counts as joinable: a gap under a 64th is not a rest.
      if (n.step <= cur.step + cur.len + 0.0625) {
        const end = Math.max(cur.step + cur.len, n.step + n.len);
        cur.len = clamp(end - cur.step, MIN_LEN, scope.total - cur.step);
        cur.vel = Math.max(cur.vel, n.vel);
        touched++;
      } else {
        merged.push(cur);
        cur = { ...n };
      }
    }
    merged.push(cur);
  }
  if (touched === 0) return { notes, touched: 0 };
  return { notes: [...rest, ...merged], touched };
}

/** Cut each scoped note into `pieces` equal parts (ratchet as real notes). */
export function splitNotes(
  notes: RollNote[],
  scope: NoteOpScope,
  pieces: number,
  makeId: () => string,
): NoteOpResult {
  const n = Math.max(2, Math.floor(pieces));
  const out: RollNote[] = [];
  let touched = 0;
  for (const note of notes) {
    if (!inScope(note, scope) || note.len / n < MIN_LEN) {
      out.push(note);
      continue;
    }
    const piece = note.len / n;
    for (let i = 0; i < n; i++) {
      out.push({
        ...note,
        id: i === 0 ? note.id : makeId(),
        step: clamp(note.step + i * piece, 0, scope.total - MIN_LEN),
        len: piece,
      });
    }
    touched++;
  }
  return { notes: out, touched };
}

// ── Pitch ────────────────────────────────────────────────────────────────

export function transpose(notes: RollNote[], scope: NoteOpScope, semitones: number): NoteOpResult {
  if (semitones === 0) return { notes, touched: 0 };
  return mapScoped(notes, scope, (n) => ({
    ...n,
    midi: clamp(Math.round(n.midi + semitones), MIDI_LO, MIDI_HI),
  }));
}

/** Chord recipes, as semitone offsets above the played note. */
export const CHORD_RECIPES: Record<string, number[]> = {
  "Oct": [12],
  "5th": [7],
  "maj": [4, 7],
  "min": [3, 7],
  "sus2": [2, 7],
  "sus4": [5, 7],
  "dim": [3, 6],
  "aug": [4, 8],
  "maj7": [4, 7, 11],
  "min7": [3, 7, 10],
  "dom7": [4, 7, 10],
  "maj9": [4, 7, 11, 14],
  "min9": [3, 7, 10, 14],
  "6th": [4, 7, 9],
  "Oct+5": [7, 12],
  "Power": [7, 12],
};

/**
 * Stack chord tones above each scoped note.
 *
 * Duplicates are skipped so applying "maj" twice doesn't pile up unison notes
 * that just double the gain.
 */
export function buildChord(
  notes: RollNote[],
  scope: NoteOpScope,
  intervals: number[],
  makeId: () => string,
): NoteOpResult {
  if (intervals.length === 0) return { notes, touched: 0 };
  const occupied = new Set<string>();
  for (const n of notes) {
    if ((n.ch ?? 0) !== scope.channel) continue;
    occupied.add(`${Math.round(n.step * 4)}:${n.midi}`);
  }
  const added: RollNote[] = [];
  for (const n of notes) {
    if (!inScope(n, scope)) continue;
    for (const iv of intervals) {
      const midi = clamp(Math.round(n.midi + iv), MIDI_LO, MIDI_HI);
      const key = `${Math.round(n.step * 4)}:${midi}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      // Upper voices slightly softer — a raw copy makes chords front-heavy.
      added.push({ ...n, id: makeId(), midi, vel: clamp(n.vel * 0.92, 0.05, 1) });
    }
  }
  return added.length === 0
    ? { notes, touched: 0 }
    : { notes: [...notes, ...added], touched: added.length };
}

/** Invert a chord: move the lowest scoped note(s) up an octave, `times` over. */
export function invertChord(notes: RollNote[], scope: NoteOpScope, times = 1): NoteOpResult {
  const scoped = notes.filter((n) => inScope(n, scope));
  if (scoped.length < 2) return { notes, touched: 0 };
  const moved = new Map<string, number>();
  const pool = [...scoped].sort((a, b) => a.midi - b.midi);
  for (let t = 0; t < Math.max(1, times) && t < pool.length; t++) {
    const n = pool[t];
    moved.set(n.id, clamp(n.midi + 12, MIDI_LO, MIDI_HI));
  }
  return mapScoped(notes, scope, (n) => {
    const midi = moved.get(n.id);
    return midi == null || midi === n.midi ? n : { ...n, midi };
  });
}

// ── Velocity ─────────────────────────────────────────────────────────────

export function scaleVelocity(notes: RollNote[], scope: NoteOpScope, mul: number): NoteOpResult {
  return mapScoped(notes, scope, (n) => {
    const vel = clamp(n.vel * mul, 0.05, 1);
    return Math.abs(vel - n.vel) < 1e-4 ? n : { ...n, vel };
  });
}

export function setVelocity(notes: RollNote[], scope: NoteOpScope, value: number): NoteOpResult {
  const v = clamp(value, 0.05, 1);
  return mapScoped(notes, scope, (n) => (Math.abs(n.vel - v) < 1e-4 ? n : { ...n, vel: v }));
}

/**
 * Linear velocity ramp across the scoped notes in time order — crescendo and
 * diminuendo without touching each note's velocity bar individually.
 */
export function velocityRamp(
  notes: RollNote[],
  scope: NoteOpScope,
  from: number,
  to: number,
): NoteOpResult {
  const scoped = notes.filter((n) => inScope(n, scope)).sort((a, b) => a.step - b.step);
  if (scoped.length === 0) return { notes, touched: 0 };
  const lo = scoped[0].step;
  const hi = scoped[scoped.length - 1].step;
  const span = hi - lo;
  const vals = new Map<string, number>();
  for (const n of scoped) {
    const t = span < 1e-6 ? 0 : (n.step - lo) / span;
    vals.set(n.id, clamp(from + (to - from) * t, 0.05, 1));
  }
  return mapScoped(notes, scope, (n) => {
    const vel = vals.get(n.id);
    return vel == null || Math.abs(vel - n.vel) < 1e-4 ? n : { ...n, vel };
  });
}

/**
 * Accent every Nth step — instant backbeat/downbeat emphasis.
 */
export function accentEvery(
  notes: RollNote[],
  scope: NoteOpScope,
  every: number,
  amount: number,
): NoteOpResult {
  const n0 = Math.max(1, Math.floor(every));
  return mapScoped(notes, scope, (n) => {
    const on = Math.abs(Math.round(n.step) % n0) < 1e-6;
    const vel = clamp(n.vel + (on ? amount : -amount * 0.35), 0.05, 1);
    return Math.abs(vel - n.vel) < 1e-4 ? n : { ...n, vel };
  });
}

// ── Duplication ──────────────────────────────────────────────────────────

/**
 * Repeat the scoped notes forward by their own span, `times` more copies —
 * the "duplicate the bar I just wrote" gesture, which previously required
 * copy, click, paste, repeat.
 */
export function repeatBlock(
  notes: RollNote[],
  scope: NoteOpScope,
  times: number,
  makeId: () => string,
): NoteOpResult {
  const scoped = notes.filter((n) => inScope(n, scope));
  if (scoped.length === 0) return { notes, touched: 0 };
  const lo = Math.min(...scoped.map((n) => n.step));
  const hi = Math.max(...scoped.map((n) => n.step + n.len));
  // Round the span up to a whole step so repeats stay on the grid.
  const span = Math.max(1, Math.ceil(hi - lo));
  const added: RollNote[] = [];
  for (let t = 1; t <= Math.max(1, times); t++) {
    for (const n of scoped) {
      const step = n.step + span * t;
      if (step >= scope.total) continue;
      added.push({
        ...n,
        id: makeId(),
        step,
        len: Math.min(n.len, scope.total - step),
      });
    }
  }
  return added.length === 0
    ? { notes, touched: 0 }
    : { notes: [...notes, ...added], touched: added.length };
}

/** Mirror the scoped notes in pitch around their own centre. */
export function invertPitch(notes: RollNote[], scope: NoteOpScope): NoteOpResult {
  const scoped = notes.filter((n) => inScope(n, scope));
  if (scoped.length === 0) return { notes, touched: 0 };
  const lo = Math.min(...scoped.map((n) => n.midi));
  const hi = Math.max(...scoped.map((n) => n.midi));
  const axis = lo + hi;
  return mapScoped(notes, scope, (n) => ({
    ...n,
    midi: clamp(axis - n.midi, MIDI_LO, MIDI_HI),
  }));
}

/** Reverse the scoped notes in time within their own span. */
export function reverseTime(notes: RollNote[], scope: NoteOpScope): NoteOpResult {
  const scoped = notes.filter((n) => inScope(n, scope));
  if (scoped.length === 0) return { notes, touched: 0 };
  const lo = Math.min(...scoped.map((n) => n.step));
  const hi = Math.max(...scoped.map((n) => n.step + n.len));
  return mapScoped(notes, scope, (n) => ({
    ...n,
    step: clamp(lo + (hi - (n.step + n.len)), 0, scope.total - MIN_LEN),
  }));
}
