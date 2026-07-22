/**
 * tractorApplied — remembers the LAST Tractor Beam correction that was
 * actually applied to the chain (manually from the Tractor view or by
 * Auto-Lock). ChainSnapshot / Mission Log read this so a saved chain knows
 * which lock produced it — and Auto-Lock can skip re-measuring a source
 * whose lock is already on file.
 *
 * v2.3: carries the predicted match % + source name and notifies listeners,
 * so the transport bar and Kill Chain map can show live Tractor status
 * outside the Tractor view.
 */

import { useSyncExternalStore } from "react";
import type { CurvePoint } from "@/lib/tractorBeam";

export interface AppliedTractorInfo {
  curve: CurvePoint[];
  targetId: string;
  strength: number;
  /** Content classification label ("music", "cinema", …) if known. */
  contentLabel: string | null;
  /** Whether the beyond-EQ master moves were applied too. */
  fullChain: boolean;
  at: number;
  /** v2.3 — predicted target match after this lock (%) for status badges. */
  matchPct?: number | null;
  /** v2.3 — display name of the locked source. */
  sourceName?: string | null;
}

let lastApplied: AppliedTractorInfo | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function setLastAppliedTractor(info: AppliedTractorInfo | null): void {
  lastApplied = info;
  notify();
}

export function getLastAppliedTractor(): AppliedTractorInfo | null {
  return lastApplied;
}

/** Called when the playing source changes so a stale lock isn't snapshotted. */
export function clearLastAppliedTractor(): void {
  lastApplied = null;
  notify();
}

export function subscribeAppliedTractor(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook — live view of the applied Tractor lock (null when none). */
export function useAppliedTractor(): AppliedTractorInfo | null {
  return useSyncExternalStore(subscribeAppliedTractor, getLastAppliedTractor);
}
