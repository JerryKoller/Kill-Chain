/**
 * tractorAutoLock — hands-free Tractor Beam.
 *
 * v2.4: this module no longer runs its own poll/settle timers. MISSION STATE
 * (missionStateStore) owns the single source-settle pipeline and calls
 * `autoLockScan()` when its priority rules say a fresh scan is warranted
 * (armed + no manual hold + no saved memory + no existing lock record).
 *
 * What stays here: the armed flag (persisted), its change listeners, and the
 * scan itself — listen to the live signal for ~9 s, build a full-chain lock
 * manifest (health-guarded), apply it, and record it in the Lock Library so
 * the source restores instantly next time.
 */

import { measureLive } from "@/lib/tractorLive";

const KEY = "kc-tractor-autolock-v1";

let armed = false;
let loaded = false;
const listeners = new Set<(on: boolean) => void>();

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    armed = window.localStorage.getItem(KEY) === "1";
  } catch { /* ignore */ }
}

export function isAutoLockArmed(): boolean {
  ensureLoaded();
  return armed;
}

export function onAutoLockChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setAutoLock(on: boolean): void {
  ensureLoaded();
  armed = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch { /* ignore */ }
  for (const cb of listeners) cb(on);
}

/** Kept for boot-order compatibility: loads the persisted armed flag. The
 *  watcher itself now lives in missionStateStore (initMissionState). */
export function initTractorAutoLock(): void {
  ensureLoaded();
}

export type AutoLockOutcome = "applied" | "silent" | "aborted" | "failed";

/**
 * One full Auto-Lock scan: measure the live signal (~9 s), derive the
 * full-chain manifest with the health guard, apply every layer, and persist
 * a Lock Library record for instant restore. Serialized by the caller
 * (MISSION STATE aborts a run when the source changes mid-scan).
 */
export async function autoLockScan(
  title: string,
  signal: AbortSignal,
): Promise<AutoLockOutcome> {
  const { useUIStore } = await import("@/state/uiStore");
  try {
    const m = await measureLive({ seconds: 9, signal });
    if (signal.aborted) return "aborted";
    if (m.silent) return "silent";
    const { useAudioStore } = await import("@/state/audioStore");
    const { useSettingsStore } = await import("@/state/settingsStore");
    const { HEADPHONES } = await import("@/audio/headphoneProfiles");
    const { buildLockManifest, applyLockManifest, ALL_LAYERS } = await import(
      "@/lib/tractorLock"
    );
    // The full manifest path — restoration / clarity / trim included, with
    // the health guard capping strength on already-clean masters.
    const manifest = buildLockManifest(m, {
      headphone: HEADPHONES[useSettingsStore.getState().headphone] ?? HEADPHONES.xm6,
      correctionEnabled: useAudioStore.getState().correctionEnabled,
      targetId: "smart",
      strength: 0.85,
      titleHint: title,
    });
    if (signal.aborted) return "aborted";
    if (manifest.silent) return "silent";
    // Flag the apply as automation so the manual-override watcher doesn't
    // mistake our own store writes for a user edit (which would abort us).
    const { runAsAutomation } = await import("@/state/missionStateStore");
    await runAsAutomation(() => applyLockManifest(manifest, ALL_LAYERS, title || null));
    if (signal.aborted) return "aborted";

    // Record the lock so this source restores instantly next time.
    void saveAutoLockRecord(m, manifest, title);

    const label = manifest.contentLabel ?? "signal";
    const capped = manifest.strengthLimited ? " (healthy master — gentle)" : "";
    useUIStore.getState().toast(`◎ Auto-lock retuned — ${label}${capped}`);
    return "applied";
  } catch {
    return signal.aborted ? "aborted" : "failed";
  }
}

/** Persist an auto-lock into the Lock Library under the current source key. */
async function saveAutoLockRecord(
  m: import("@/lib/tractorBeam").TractorMeasurement,
  manifest: import("@/lib/tractorLock").LockManifest,
  title: string,
): Promise<void> {
  try {
    const { useLockLibraryStore, lockKeyForCurrentSource, measurementFingerprint } =
      await import("@/state/lockLibraryStore");
    const { ALL_LAYERS } = await import("@/lib/tractorLock");
    const src = await lockKeyForCurrentSource();
    const ident = src ?? {
      key: `live:${title || "unknown"}`,
      kind: "live" as const,
      name: title || "Live capture",
      sub: "",
    };
    const now = Date.now();
    useLockLibraryStore.getState().upsert({
      ...ident,
      favorite: false,
      savedAt: now,
      updatedAt: now,
      measurement: {
        ...m,
        levelsDb: m.levelsDb.map((v) => Math.round(v * 100) / 100),
      },
      targetId: manifest.targetId,
      strength: manifest.strength,
      vetoes: [],
      curveEdits: {},
      layers: { ...ALL_LAYERS },
      curve: manifest.curve,
      masterMoves: manifest.masterMoves,
      restore: manifest.restore,
      clarity: manifest.clarity,
      outputTrimDb: manifest.outputTrimDb,
      matchBeforePct: manifest.matchBeforePct,
      matchAfterPct: manifest.matchAfterPct,
      contentLabel: manifest.contentLabel,
      fingerprint: measurementFingerprint(m),
      v: 1,
    });
  } catch {
    /* library unavailable — the lock still applied */
  }
}
