import { create } from "zustand";

/**
 * appHealth — v2.4 error & recovery surface.
 *
 * Silent failure paths (storage full, suspended AudioContext, lost output
 * device, failed export, crashed webview) now raise a visible, actionable
 * ISSUE instead of dying in a catch block. Issues render in the Mission HUD
 * as a red/amber chip with a one-click fix where one exists.
 */

export type HealthIssueId =
  | "storage"
  | "context-suspended"
  | "device-lost"
  | "export-failed"
  | "webview-crash"
  | "no-signal";

export interface HealthIssue {
  id: HealthIssueId;
  severity: "warn" | "error";
  title: string;
  detail: string;
  actionLabel?: string;
  action?: () => void | Promise<void>;
  raisedAt: number;
}

interface AppHealthState {
  issues: HealthIssue[];
  raise: (issue: Omit<HealthIssue, "raisedAt">) => void;
  clear: (id: HealthIssueId) => void;
  clearAll: () => void;
}

export const useAppHealthStore = create<AppHealthState>((set, get) => ({
  issues: [],
  raise: (issue) => {
    const rest = get().issues.filter((i) => i.id !== issue.id);
    set({ issues: [...rest, { ...issue, raisedAt: Date.now() }] });
  },
  clear: (id) => {
    if (!get().issues.some((i) => i.id === id)) return;
    set({ issues: get().issues.filter((i) => i.id !== id) });
  },
  clearAll: () => set({ issues: [] }),
}));

// ── Reporters (call sites live in stores / export paths) ────────────────────

const storageReported = new Set<string>();

/** A localStorage write failed — data loss risk. Raised once per area. */
export function reportStorageFailure(area: string, err: unknown): void {
  if (storageReported.has(area)) return;
  storageReported.add(area);
  useAppHealthStore.getState().raise({
    id: "storage",
    severity: "error",
    title: "Save failed",
    detail:
      `${area} could not be written to disk storage ` +
      `(${err instanceof Error ? err.message : "quota or permission error"}). ` +
      "Recent changes may not survive a restart.",
    actionLabel: "Retry saves",
    action: () => {
      storageReported.clear();
      useAppHealthStore.getState().clear("storage");
    },
  });
}

/** A user-initiated save/export failed. */
export function reportExportFailure(what: string, err: unknown): void {
  useAppHealthStore.getState().raise({
    id: "export-failed",
    severity: "error",
    title: "Export failed",
    detail: `${what} did not complete: ${err instanceof Error ? err.message : String(err ?? "unknown error")}`,
    actionLabel: "Dismiss",
    action: () => useAppHealthStore.getState().clear("export-failed"),
  });
}

/** The Airspace webview renderer died (we auto-reload, but tell the user). */
export function reportWebviewCrash(): void {
  useAppHealthStore.getState().raise({
    id: "webview-crash",
    severity: "warn",
    title: "Airspace crashed",
    detail: "The embedded browser process died and was reloaded. Playback/capture may need to be restarted.",
    actionLabel: "Dismiss",
    action: () => useAppHealthStore.getState().clear("webview-crash"),
  });
}

/** Output device disappeared (device watcher). */
export function reportDeviceLost(reverted: boolean): void {
  useAppHealthStore.getState().raise({
    id: "device-lost",
    severity: reverted ? "warn" : "error",
    title: "Output device lost",
    detail: reverted
      ? "The selected output device disappeared — audio was rerouted to the system default."
      : "The selected output device disappeared and rerouting failed. Pick a new output in Settings.",
    actionLabel: "Open Settings",
    action: () => {
      void import("@/state/uiStore").then(({ useUIStore }) => {
        useUIStore.getState().setView("settings");
        useAppHealthStore.getState().clear("device-lost");
      });
    },
  });
}

// ── AudioContext watcher ────────────────────────────────────────────────────

let ctxWatchStarted = false;

/**
 * Watch the engine's AudioContext: if it lands in "suspended" or
 * "interrupted" after boot (device churn, OS audio session loss), try one
 * auto-resume; if that fails, raise an actionable issue.
 */
export function initAppHealth(): void {
  if (ctxWatchStarted || typeof window === "undefined") return;
  ctxWatchStarted = true;

  const tryWire = () => {
    void import("@/audio/AudioEngine").then(({ peekEngine }) => {
      const engine = peekEngine();
      if (!engine) {
        window.setTimeout(tryWire, 2000);
        return;
      }
      const ctx = engine.ctx;
      const health = useAppHealthStore.getState();
      const onState = () => {
        if (ctx.state === "running") {
          health.clear("context-suspended");
          return;
        }
        if (ctx.state === "closed") return;
        // Suspended mid-session — try a silent auto-resume first (allowed
        // once the page has had a user gesture, which boot guarantees).
        void ctx.resume().then(
          () => health.clear("context-suspended"),
          () => {
            health.raise({
              id: "context-suspended",
              severity: "error",
              title: "Audio engine suspended",
              detail:
                "The audio context stopped running (device change or OS audio session loss). Click Resume to restart it.",
              actionLabel: "Resume",
              action: async () => {
                try {
                  await ctx.resume();
                  useAppHealthStore.getState().clear("context-suspended");
                } catch {
                  /* still stuck — the issue stays visible */
                }
              },
            });
          },
        );
      };
      ctx.addEventListener("statechange", onState);
    });
  };
  tryWire();
}

// ── Reset Audio Engine ──────────────────────────────────────────────────────

/**
 * The visible "Reset Audio Engine" action (Settings → Advanced + Mission
 * HUD). The AudioContext itself is kept (a MediaElementSource can never be
 * re-created for the same <audio> element), but everything above it is
 * rebuilt from store state:
 *
 *   1. Abort any pending automation run.
 *   2. Re-attach the player source (re-wires the cached element source).
 *   3. Re-apply the output sink.
 *   4. Re-sync every DSP stage from its owning store (params, correction,
 *      Sculptor bands, restoration, clarity, room, balance, output gain,
 *      bypass, repair bypass, 3D engagement).
 *   5. Resume the context.
 *
 * Fixes desyncs, muted buses and half-applied transitions without an app
 * restart.
 */
export async function resetAudioEngine(): Promise<boolean> {
  try {
    const { getEngine } = await import("@/audio/AudioEngine");
    const { useAudioStore } = await import("@/state/audioStore");
    const { useEqStore } = await import("@/state/eqStore");
    const { useSettingsStore } = await import("@/state/settingsStore");
    const { usePlayerStore } = await import("@/state/playerStore");

    // 1. Stand down automation so nothing fights the reset.
    const { noteManualOverride } = await import("@/state/missionStateStore");
    noteManualOverride();

    const engine = getEngine();
    const a = useAudioStore.getState();

    // 2. Source: re-wire the cached media element (idempotent when healthy).
    const el = usePlayerStore.getState().element;
    if (el && !usePlayerStore.getState().loopbackActive) {
      engine.detachSource();
      engine.attachAudioElement(el);
    }

    // 3. Output sink.
    try {
      const sink = useSettingsStore.getState().audioOutputDeviceId;
      await engine.setOutputDevice(sink || "");
    } catch { /* sink re-apply is best-effort */ }

    // 4. Full DSP re-sync from store state.
    engine.applyParams(a.params);
    engine.replaceCorrectionBands(a.correctionBands);
    engine.setCorrectionEnabled(a.correctionEnabled);
    engine.setOutputGainDb(a.outputGainDb);
    engine.setRoom(a.room, a.roomMix);
    engine.setBalance(a.balanceLDb, a.balanceRDb, a.balanceDelayMs);
    engine.setRestore(a.restore);
    engine.setClarity(a.clarity);
    engine.setRepairBypass(a.repairBypass);
    engine.setBypass(a.bypass);
    useEqStore.getState().syncEngine();

    // 3D engagement follows the dimension store's view of the world.
    try {
      const { useDimensionStore } = await import("@/state/dimensionStore");
      const dim = useDimensionStore.getState();
      engine.setDimensionActive(dim.active);
    } catch { /* dimension store optional */ }

    // 5. Run.
    await engine.resume();

    useAppHealthStore.getState().clear("context-suspended");
    const { useUIStore } = await import("@/state/uiStore");
    useUIStore.getState().toast("Audio engine reset — graph re-synced from state", "success");
    return true;
  } catch (err) {
    const { useUIStore } = await import("@/state/uiStore");
    useUIStore
      .getState()
      .toast(`Audio engine reset failed: ${err instanceof Error ? err.message : "unknown"}`, "error");
    return false;
  }
}
