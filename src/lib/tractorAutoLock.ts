/**
 * tractorAutoLock — hands-free Tractor Beam.
 *
 * When armed, watches what's actually playing:
 *   · Airspace media (webview title changes — new YouTube video, next episode)
 *   · local file player (track changes)
 *
 * On a change it waits a beat for the audio to settle, listens to the live
 * signal for ~9 s, derives a fresh smart-profile correction (audio
 * fingerprint + the new title as a hint) and applies the FULL chain — EQ
 * curve plus the beyond-EQ master moves. Every track gets its own lock
 * without touching the Tractor view.
 *
 * The armed flag persists across sessions. All work is serialized: a track
 * change during a measurement aborts and restarts it.
 */

import { deriveCorrection, sampleCurveDb } from "@/lib/tractorBeam";
import { measureLive } from "@/lib/tractorLive";

const KEY = "kc-tractor-autolock-v1";

let armed = false;
let started = false;
let currentRun: AbortController | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let lastSig = "";
const listeners = new Set<(on: boolean) => void>();

export function isAutoLockArmed(): boolean {
  return armed;
}

export function onAutoLockChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setAutoLock(on: boolean): void {
  armed = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch { /* ignore */ }
  if (!on) {
    currentRun?.abort();
    currentRun = null;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
  } else {
    lastSig = ""; // re-lock whatever is playing right now
    void pollSignal();
  }
  for (const cb of listeners) cb(on);
}

/** What's playing right now, as a change-detection signature + title hint. */
async function readSignal(): Promise<{ sig: string; title: string; active: boolean }> {
  const { useAirspaceStore } = await import("@/state/airspaceStore");
  const { usePlayerStore } = await import("@/state/playerStore");
  const air = useAirspaceStore.getState().media;
  const p = usePlayerStore.getState();
  // Airspace media wins while it's routed (loopback active) and playing.
  if (air && !air.paused && p.loopbackActive && air.title) {
    return { sig: `air:${air.title}`, title: air.title, active: true };
  }
  if (p.status === "playing" && p.src) {
    const title = p.metadata.title ?? p.fileName ?? "";
    return { sig: `file:${p.src}`, title, active: true };
  }
  return { sig: "", title: "", active: false };
}

async function relock(title: string): Promise<void> {
  currentRun?.abort();
  const ac = new AbortController();
  currentRun = ac;
  const { useUIStore } = await import("@/state/uiStore");
  try {
    const m = await measureLive({ seconds: 9, signal: ac.signal });
    if (ac.signal.aborted || m.silent) return;
    const { useEqStore } = await import("@/state/eqStore");
    const { useAudioStore } = await import("@/state/audioStore");
    const { useSettingsStore } = await import("@/state/settingsStore");
    const { HEADPHONES } = await import("@/audio/headphoneProfiles");
    const result = deriveCorrection(m, {
      headphone: HEADPHONES[useSettingsStore.getState().headphone] ?? HEADPHONES.xm6,
      correctionEnabled: useAudioStore.getState().correctionEnabled,
      targetId: "smart",
      strength: 0.85,
      titleHint: title,
    });
    if (ac.signal.aborted || result.silent) return;
    useEqStore.getState().applyGainCurve((f) => sampleCurveDb(result.curve, f));
    if (Object.keys(result.masterMoves).length > 0) {
      useAudioStore.getState().setParams(result.masterMoves);
    }
    const label = result.content?.label ?? "signal";
    useUIStore.getState().toast(`◎ Auto-lock retuned — ${label}`);
  } catch {
    /* engine tap unavailable / aborted — silent */
  } finally {
    if (currentRun === ac) currentRun = null;
  }
}

async function pollSignal(): Promise<void> {
  if (!armed) return;
  const { sig, title, active } = await readSignal();
  if (!active) {
    lastSig = "";
    return;
  }
  if (sig === lastSig) return;
  lastSig = sig;
  // New material: give the stream a moment to stabilise (intros, ads ending,
  // volume normalisation) before listening.
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (armed) void relock(title);
  }, 2500);
}

/** Wire the watchers once (call at boot; safe to call again). */
export function initTractorAutoLock(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    armed = window.localStorage.getItem(KEY) === "1";
  } catch { /* ignore */ }
  // A light poll beats wiring three store subscriptions with dynamic imports;
  // 1.5 s latency is invisible next to the 2.5 s settle window.
  window.setInterval(() => {
    if (armed) void pollSignal();
  }, 1500);
}
