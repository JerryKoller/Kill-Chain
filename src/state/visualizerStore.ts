import { create } from "zustand";

/**
 * Library Visualizer state — which render mode is armed and whether the
 * full-panel overlay is open. The mode survives restarts (localStorage);
 * the open flag is session-only.
 */

export type VisualizerMode =
  | "spectrum"
  | "scope"
  | "radial"
  | "waterfall"
  | "strike"
  | "tunnel"
  | "lattice"
  | "aurora"
  | "singularity"
  | "cinema";

export interface VisualizerModeInfo {
  id: VisualizerMode;
  /** Full designation — shown in the mode-change flash. */
  name: string;
  /** Short label for the segmented control. */
  tab: string;
  desc: string;
}

export const VISUALIZER_MODES: readonly VisualizerModeInfo[] = [
  {
    id: "spectrum",
    name: "SPECTRUM ARRAY",
    tab: "Spectrum",
    desc: "Log-frequency FFT bar array with peak-hold caps and dB hairlines",
  },
  {
    id: "scope",
    name: "WAVEFORM SCOPE",
    tab: "Scope",
    desc: "Triggered oscilloscope trace with phosphor afterglow and RMS envelope",
  },
  {
    id: "radial",
    name: "RADIAL REACTOR",
    tab: "Reactor",
    desc: "Circular spectrum ring — radius rides the low band, live LUFS core",
  },
  {
    id: "waterfall",
    name: "WATERFALL SPECTROGRAM",
    tab: "Waterfall",
    desc: "Scrolling time–frequency heat map of the output signal",
  },
  {
    id: "strike",
    name: "STRIKE FIELD",
    tab: "Strike",
    desc: "Beat-triggered burst tracers on a tactical grid",
  },
  {
    id: "tunnel",
    name: "WARP TUNNEL",
    tab: "Tunnel",
    desc: "Fly through a starfield — speed rides the music, beats punch shock rings",
  },
  {
    id: "lattice",
    name: "PULSE LATTICE",
    tab: "Lattice",
    desc: "A field of nodes rippling with beat shockwaves, columns lit by frequency",
  },
  {
    id: "aurora",
    name: "AURORA FLOW",
    tab: "Aurora",
    desc: "Bass, mids and air as flowing ribbons of light — calm, hypnotic, alive",
  },
  {
    id: "singularity",
    name: "SINGULARITY",
    tab: "Singularity",
    desc: "Raymarched energy core — bass shockwaves, bloom and chromatic bursts (WebGL)",
  },
  {
    id: "cinema",
    name: "CINEMA LOCK",
    tab: "Cinema",
    desc: "Auto-director: reads the track's structure and cuts between scenes on the bar",
  },
] as const;

const STORAGE_KEY = "killchain.visualizer.v1";

function loadInitialMode(): VisualizerMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { mode?: string };
      if (VISUALIZER_MODES.some((m) => m.id === parsed.mode)) {
        return parsed.mode as VisualizerMode;
      }
    }
  } catch {
    /* corrupted / blocked storage — fall through to default */
  }
  // First run defaults to the calmest mode (also the reduced-motion pick).
  return "spectrum";
}

function persist(mode: VisualizerMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode }));
  } catch (err) {
    /* storage full/blocked — non-fatal */
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Visualizer", err),
    );
  }
}

interface VisualizerState {
  /** Overlay open (session-only, not persisted). */
  open: boolean;
  mode: VisualizerMode;
  setOpen: (open: boolean) => void;
  setMode: (mode: VisualizerMode) => void;
  /** Step to the next/previous mode, wrapping at the ends. */
  cycleMode: (dir: 1 | -1) => void;
}

export const useVisualizerStore = create<VisualizerState>((set, get) => ({
  open: false,
  mode: loadInitialMode(),

  setOpen: (open) => set({ open }),

  setMode: (mode) => {
    set({ mode });
    persist(mode);
  },

  cycleMode: (dir) => {
    const idx = VISUALIZER_MODES.findIndex((m) => m.id === get().mode);
    const n = VISUALIZER_MODES.length;
    const next = VISUALIZER_MODES[(idx + dir + n) % n].id;
    get().setMode(next);
  },
}));
