/**
 * Shared StageViz RAF loop — throttles, pauses when idle, wakes on activity.
 *
 * Expanded modules used to paint forever (breath/sin) at ~45fps even when
 * knobs were still. This helper:
 *  - respects document.hidden
 *  - throttles to minIntervalMs
 *  - after idleGrace quiet frames, pauses RAF entirely
 *  - polls cheaply while paused so flash/param/playhead changes wake it
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
  /** Telemetry that must repaint when it changes (playStep, voiceCount…). */
  motionKey?: string | number;
};

export type StageVizLoopOptions = {
  /** Minimum ms between paints. Default 22 (~45fps cap). */
  minIntervalMs?: number;
  /** Quiet frames before pausing RAF. Default 10. */
  idleGrace?: number;
  /** While paused, poll hints this often (ms). Default 250. */
  idlePollMs?: number;
};

/**
 * Start a stage viz frame loop. `onFrame` should decay flash itself
 * (`flashRef.current *= 0.9`) and paint. Return a cleanup function.
 */
export function startStageVizLoop(
  onFrame: (now: number) => void,
  hints: () => StageVizIdleHints,
  opts: StageVizLoopOptions = {},
): () => void {
  const minMs = opts.minIntervalMs ?? 22;
  const idleGrace = opts.idleGrace ?? 10;
  const idlePollMs = opts.idlePollMs ?? 250;

  let raf = 0;
  let poll = 0 as ReturnType<typeof setInterval> | 0;
  let last = 0;
  let quiet = 0;
  let paused = false;
  let lastMotion = "\u0000";

  const busyNow = (): boolean => {
    const h = hints();
    const motion = String(h.motionKey ?? "");
    const motionChanged = motion !== lastMotion;
    lastMotion = motion;
    return (
      !!h.active ||
      !!h.dragging ||
      (h.particles ?? 0) > 0 ||
      h.flash > 0.025 ||
      motionChanged
    );
  };

  const stopPoll = () => {
    if (poll) {
      clearInterval(poll);
      poll = 0;
    }
  };

  const startPoll = () => {
    if (poll) return;
    poll = setInterval(() => {
      if (!paused) return;
      if (document.hidden) return;
      if (busyNow()) {
        quiet = 0;
        paused = false;
        stopPoll();
        raf = requestAnimationFrame(tick);
      }
    }, idlePollMs);
  };

  const tick = (t: number) => {
    raf = 0;
    if (paused) return;
    raf = requestAnimationFrame(tick);
    if (document.hidden) return;
    if (t - last < minMs) return;

    const busy = busyNow();
    if (!busy) {
      quiet++;
      if (quiet >= idleGrace) {
        // Final rest frame, then park the loop.
        last = t;
        onFrame(t);
        paused = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        startPoll();
        return;
      }
    } else {
      quiet = 0;
    }

    last = t;
    onFrame(t);
  };

  const onVis = () => {
    if (document.hidden || !paused) return;
    if (busyNow()) {
      quiet = 0;
      paused = false;
      stopPoll();
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener("visibilitychange", onVis);

  raf = requestAnimationFrame(tick);

  return () => {
    document.removeEventListener("visibilitychange", onVis);
    stopPoll();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    paused = true;
  };
}
