/**
 * Tiny bus so nested Calibration tools (Deadflat, Genre Load, hearing Apply,
 * Pure Tone edits) can mark the parent tab's preview session as committed
 * before they permanently rewrite the chain — without prop-drilling.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

export function onPreviewCommitRequest(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Call before intentional replaceParams / Deadflat / Genre Load / hearing Apply / Pure Tone. */
export function requestPreviewCommit(): void {
  for (const fn of listeners) fn();
}
