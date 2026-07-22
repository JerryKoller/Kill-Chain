import { getEngine } from "@/audio/AudioEngine";
import { usePlayerStore } from "@/state/playerStore";
import {
  getVisualIntel,
  snapshotToWire,
  defaultSnapshot,
  type IntelWire,
} from "@/components/Visualizer/visualIntel";

/**
 * Main-window side of the Visualizer broadcast mode: opens the satellite
 * broadcast window and streams frames to it over IPC at ~30 fps. Each frame
 * carries the raw analyser blocks PLUS the serialized Visual Intelligence
 * snapshot (BPM, beat/bar phase, onsets, stereo, section, palette) — the
 * broadcast window never touches the audio engine and never runs its own
 * analysis, so exactly ONE high-rate pipeline exists app-wide.
 */

export interface VizFramePayload {
  freq: Uint8Array;
  time: Uint8Array;
  sampleRate: number;
  lufs: number;
  title: string;
  playing: boolean;
  intel: IntelWire;
}

export interface BroadcastOptions {
  displayId?: number;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  transparent?: boolean;
}

const FPS_INTERVAL_MS = 33;

let timer: number | null = null;
let unsubClosed: (() => void) | null = null;
const listeners = new Set<(on: boolean) => void>();

function notify(on: boolean): void {
  for (const cb of listeners) cb(on);
}

export function isBroadcasting(): boolean {
  return timer !== null;
}

/** Subscribe to broadcast on/off changes (for button state). */
export function onBroadcastChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function startBroadcast(opts: BroadcastOptions = {}): Promise<boolean> {
  const viz = window.playground?.viz;
  if (!viz) return false;

  await viz.open(opts);

  if (timer !== null) return true; // window re-opened; stream already running

  const engine = getEngine();
  engine.ensureLufsMeter();
  const intel = getVisualIntel();
  intel.start();
  const wire = snapshotToWire(defaultSnapshot(), {} as IntelWire);

  timer = window.setInterval(() => {
    // Shared pipeline: if the in-app overlay already analysed this frame the
    // update is a timestamp-guarded no-op — never two detectors.
    intel.update(performance.now());
    snapshotToWire(intel.snapshot, wire);
    const p = usePlayerStore.getState();
    const payload: VizFramePayload = {
      freq: intel.freq,
      time: intel.time,
      sampleRate: intel.sampleRate,
      lufs: engine.lufs.momentaryLufs,
      title: p.metadata.title ?? p.fileName ?? "",
      playing: p.status === "playing",
      intel: wire,
    };
    viz.sendFrame(payload);
  }, FPS_INTERVAL_MS);

  unsubClosed = viz.onClosed(() => stopBroadcast(false));
  notify(true);
  return true;
}

export function stopBroadcast(closeWindow = true): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
    getEngine().releaseLufsMeter();
    getVisualIntel().stop();
  }
  unsubClosed?.();
  unsubClosed = null;
  if (closeWindow) void window.playground?.viz?.close();
  notify(false);
}
