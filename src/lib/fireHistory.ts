import { create } from "zustand";

/**
 * fireHistory — unified undo/redo for the whole Fire Command workspace
 * (v1.6): piano roll, drum grid, sample deck, transport values, and the
 * synth patch all share ONE timeline, so Ctrl+Z walks back through edits
 * in the order they actually happened.
 *
 * Design: provider registration instead of store imports. fireCommandStore
 * is intentionally lazy-loaded (it drags the ~500-preset factory bank),
 * while fireSequencerStore sits in the boot chunk — a static import from
 * here would pull the bank into the boot bundle. Each store registers a
 * {capture, restore} pair when its module loads; snapshots contain
 * whichever providers were alive at push time.
 */

const HISTORY_CAP = 50;
/** A continuous drag (same coalesce key) collapses into ONE undo step. */
const DRAG_COALESCE_MS = 500;

interface HistoryProvider {
  /** Return a deep-cloneable snapshot of the provider's undoable state. */
  capture: () => unknown;
  /** Apply a snapshot back onto the store + audio engine. */
  restore: (snap: unknown) => void;
}

type Snapshot = Record<string, unknown>;

const providers = new Map<string, HistoryProvider>();

let history: Snapshot[] = [];
let future: Snapshot[] = [];
let lastKey: string | null = null;
let lastTs = 0;

/** Tiny reactive mirror so UI buttons can enable/disable. */
interface FireHistoryUiState {
  undoDepth: number;
  redoDepth: number;
}
export const useFireHistoryStore = create<FireHistoryUiState>(() => ({
  undoDepth: 0,
  redoDepth: 0,
}));

function syncUi(): void {
  useFireHistoryStore.setState({
    undoDepth: history.length,
    redoDepth: future.length,
  });
}

export function registerFireHistoryProvider(
  id: string,
  provider: HistoryProvider,
): void {
  providers.set(id, provider);
}

function captureAll(): Snapshot {
  const snap: Snapshot = {};
  for (const [id, p] of providers) {
    try {
      snap[id] = structuredClone(p.capture());
    } catch (err) {
      console.warn(`[fireHistory] capture failed for "${id}":`, err);
    }
  }
  return snap;
}

function restoreAll(snap: Snapshot): void {
  for (const [id, p] of providers) {
    if (!(id in snap)) continue;
    try {
      // Clone on the way out too — restore handlers may mutate what they get.
      p.restore(structuredClone(snap[id]));
    } catch (err) {
      console.warn(`[fireHistory] restore failed for "${id}":`, err);
    }
  }
}

/**
 * Record the CURRENT state as an undo point — call at the top of every
 * mutating action, before the change. Passing the same `coalesceKey`
 * within 500 ms skips the push, so per-mousemove knob/note drags cost one
 * history entry (the pre-drag state) instead of hundreds.
 *
 * Capture runs via queueMicrotask when coalescing starts a new key, so the
 * first move of a drag stays cheap on the pointer path; non-coalesced pushes
 * still capture synchronously (needed for correctness before the mutation).
 */
/**
 * End the current coalescing run.
 *
 * Time alone couldn't tell "still dragging" from "grabbed it again": the
 * window slid forward on every mousemove, so a second, separate grab of the
 * same knob moments later got swallowed into the previous entry and undo
 * skipped the intermediate value. A pointer release is the real boundary of a
 * gesture, so one window listener closes the run for every draggable control
 * without each of them having to remember to.
 */
export function endFireHistoryCoalesce(): void {
  lastKey = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerup", endFireHistoryCoalesce, { passive: true, capture: true });
  window.addEventListener("pointercancel", endFireHistoryCoalesce, { passive: true, capture: true });
}

export function pushFireHistory(coalesceKey?: string): void {
  const now = performance.now();
  if (coalesceKey && coalesceKey === lastKey && now - lastTs < DRAG_COALESCE_MS) {
    // Keep the run alive for the rest of this gesture so a continuous drag
    // still costs ONE entry. The gesture ends on pointerup (above), not on a
    // timer, so a fresh grab always starts a new entry.
    lastTs = now;
    return;
  }
  lastKey = coalesceKey ?? null;
  lastTs = now;
  history = [...history, captureAll()].slice(-HISTORY_CAP);
  future = [];
  syncUi();
}

export function undoFire(): boolean {
  const prev = history[history.length - 1];
  if (!prev) return false;
  history = history.slice(0, -1);
  future = [captureAll(), ...future].slice(0, HISTORY_CAP);
  lastKey = null; // an undo breaks any drag coalescing run
  restoreAll(prev);
  syncUi();
  return true;
}

export function redoFire(): boolean {
  const next = future[0];
  if (!next) return false;
  future = future.slice(1);
  history = [...history, captureAll()].slice(-HISTORY_CAP);
  lastKey = null;
  restoreAll(next);
  syncUi();
  return true;
}

export function canUndoFire(): boolean {
  return history.length > 0;
}

export function canRedoFire(): boolean {
  return future.length > 0;
}

/** Drop the undo/redo stacks (call on project open so Ctrl+Z cannot restore the previous song). */
export function clearFireHistory(): void {
  history = [];
  future = [];
  lastKey = null;
  lastTs = 0;
  syncUi();
}
