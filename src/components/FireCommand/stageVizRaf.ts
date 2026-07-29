/**
 * Shared StageViz RAF loop — one global pump for all module visualizers.
 *
 * Expanded modules used to paint forever (breath/sin) at ~45fps even when
 * knobs were still. This helper:
 *  - respects document.hidden
 *  - throttles each entry to minIntervalMs
 *  - after idleGrace quiet frames, pauses painting for that entry
 *  - keeps a cheap global probe so flash / motionKey / active wake within 1 frame
 *    (the old 250ms setInterval left canvases frozen on outside-knob changes)
 *  - under high synth CPU pressure, stretches intervals so UI stays fluid
 */

export type StageVizIdleHints = {
  /** Decaying interaction flash (0..1). */
  flash: number;
  /** Module wants continuous animation (playhead, live voices, LFO, gate…). */
  active?: boolean;
  /** Pointer drag in progress. */
  dragging?: boolean;
  /** Particle / trail count still decaying. */
  particles?: number;
  /** Telemetry that must repaint when it changes (params, playStep, voiceCount…). */
  motionKey?: string | number;
};

export type StageVizLoopOptions = {
  /** Minimum ms between paints. Default 22 (~45fps cap). */
  minIntervalMs?: number;
  /** Quiet frames before pausing paint. Default 10. */
  idleGrace?: number;
  /**
   * @deprecated Idle wake is now a global rAF probe (1-frame latency).
   * Kept so existing call sites compile; ignored.
   */
  idlePollMs?: number;
};

type Entry = {
  onFrame: (now: number) => void;
  hints: () => StageVizIdleHints;
  minMs: number;
  idleGrace: number;
  last: number;
  quiet: number;
  paused: boolean;
  lastMotion: string;
};

const entries = new Set<Entry>();
let pumpRaf = 0;
/** Optional 0..1 CPU pressure from the synth — stretches paint intervals. */
let pressureSource: (() => number) | null = null;

/** Wire once from Fire Command mount so StageViz can back off under load. */
export function setStageVizPressureSource(fn: (() => number) | null): void {
  pressureSource = fn;
}

function isBusy(e: Entry): boolean {
  const h = e.hints();
  const motion = String(h.motionKey ?? "");
  const motionChanged = motion !== e.lastMotion;
  e.lastMotion = motion;
  return (
    !!h.active ||
    !!h.dragging ||
    (h.particles ?? 0) > 0 ||
    h.flash > 0.025 ||
    motionChanged
  );
}

function pump(t: number) {
  pumpRaf = 0;
  if (entries.size === 0) return;
  pumpRaf = requestAnimationFrame(pump);
  if (document.hidden) return;

  let pressure = 0;
  try {
    pressure = pressureSource?.() ?? 0;
  } catch {
    pressure = 0;
  }
  // 0 → 1× interval; 1 → ~2.6× (≈17fps if base was 45fps)
  const scale = 1 + Math.max(0, Math.min(1, pressure)) * 1.6;

  for (const e of entries) {
    if (e.paused) {
      // Probe every frame — param/flash changes resume without a 250ms wait.
      if (isBusy(e)) {
        e.paused = false;
        e.quiet = 0;
        e.last = t;
        e.onFrame(t);
      }
      continue;
    }

    if (t - e.last < e.minMs * scale) continue;

    const busy = isBusy(e);
    if (!busy) {
      e.quiet++;
      if (e.quiet >= e.idleGrace) {
        e.last = t;
        e.onFrame(t);
        e.paused = true;
        continue;
      }
    } else {
      e.quiet = 0;
    }

    e.last = t;
    e.onFrame(t);
  }
}

function ensurePump() {
  if (!pumpRaf) pumpRaf = requestAnimationFrame(pump);
}

/**
 * Start a stage viz frame loop. `onFrame` should decay flash itself
 * (`flashRef.current *= 0.9`) and paint. Return a cleanup function.
 */
export function startStageVizLoop(
  onFrame: (now: number) => void,
  hints: () => StageVizIdleHints,
  opts: StageVizLoopOptions = {},
): () => void {
  const entry: Entry = {
    onFrame,
    hints,
    minMs: opts.minIntervalMs ?? 22,
    idleGrace: opts.idleGrace ?? 10,
    last: 0,
    quiet: 0,
    paused: false,
    lastMotion: "\u0000",
  };

  entries.add(entry);
  ensurePump();

  const onVis = () => {
    if (document.hidden) return;
    entry.quiet = 0;
    if (entry.paused && isBusy(entry)) entry.paused = false;
    ensurePump();
  };
  document.addEventListener("visibilitychange", onVis);

  return () => {
    document.removeEventListener("visibilitychange", onVis);
    entries.delete(entry);
    if (entries.size === 0 && pumpRaf) {
      cancelAnimationFrame(pumpRaf);
      pumpRaf = 0;
    }
  };
}
