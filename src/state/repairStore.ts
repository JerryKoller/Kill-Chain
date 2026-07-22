import { create } from "zustand";
import type { CurvePoint } from "@/lib/tractorBeam";
import type { TargetReference } from "@/lib/targetLock";

/**
 * repairStore — session-only glue for the v2.1 repair workspace.
 *
 * Holds the latest analysis artefacts (detected brickwall cutoff, the
 * Target Lock reference + gap curve) so the Repair Stack's spectrogram can
 * overlay them, and any panel can read the current match numbers.
 */
interface RepairState {
  /** Brickwall cutoff (Hz) from the latest Auto-read / Read & Repair. */
  cutoffHz: number | null;
  /** Loaded Target Lock reference (name + measurement). */
  reference: TargetReference | null;
  /** Target Lock's suggested EQ curve (the spectral gap), for overlays. */
  refCurve: CurvePoint[] | null;
  matchBeforePct: number | null;
  matchAfterPct: number | null;

  setCutoffHz: (hz: number | null) => void;
  setReference: (ref: TargetReference | null) => void;
  setRefCurve: (curve: CurvePoint[] | null) => void;
  setMatch: (before: number | null, after: number | null) => void;
}

export const useRepairStore = create<RepairState>((set) => ({
  cutoffHz: null,
  reference: null,
  refCurve: null,
  matchBeforePct: null,
  matchAfterPct: null,

  setCutoffHz: (cutoffHz) => set({ cutoffHz }),
  setReference: (reference) => set({ reference }),
  setRefCurve: (refCurve) => set({ refCurve }),
  setMatch: (matchBeforePct, matchAfterPct) => set({ matchBeforePct, matchAfterPct }),
}));
