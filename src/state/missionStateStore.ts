import { create } from "zustand";

/**
 * MISSION STATE — the v2.4 session orchestrator.
 *
 * One service owns "what is the active source and what should be applied to
 * it". Before v2.4 four independent watchers reacted to a source change on
 * their own timers and could fight each other:
 *
 *   · missionLogStore's Airspace watcher   (instant chain restore)
 *   · libraryStore's player subscribe      (instant chain restore for files)
 *   · tractorAutoLock's 1.5 s poll         (2.5 s settle → 9 s scan → apply)
 *   · useAutoFlatten's per-track hook      (2 s wait → 8 s analyse → apply)
 *
 * All of that now funnels through ONE debounced source-settle pipeline
 * (~2.5 s) that runs the steps in strict priority order:
 *
 *   manual override  >  saved source memory  >  Auto-Lock  >  Auto-Flatten
 *
 * · Manual override — the moment the user touches the chain (tone params,
 *   Sculptor bands, restoration, clarity) for the current source, every
 *   automatic system stands down until the source changes. A manual change
 *   during a pending settle cancels the pipeline.
 * · Saved source memory — a Mission Log / SourceMemory record for the source
 *   restores verbatim; no scan runs against a remembered source.
 * · Auto-Lock — armed only. A valid Lock Library record restores instantly;
 *   otherwise a fresh 9 s scan derives and applies a manifest.
 * · Auto-Flatten — the default automation, preference-gated, files only.
 *
 * The store half is a small reactive surface for the Mission HUD: the active
 * source, what's pending, and which system last touched the chain.
 */

export type MissionSourceKind = "file" | "airspace";

export interface MissionSource {
  /** Change-detection signature: `file:<src>` or `air:<title>`. */
  sig: string;
  kind: MissionSourceKind;
  title: string;
}

export type MissionPendingOp =
  | "settling"
  | "restoring"
  | "scanning"
  | "flattening"
  | null;

export type MissionAppliedBy =
  | "manual"
  | "memory"
  | "lock"
  | "auto-lock"
  | "auto-flatten"
  | null;

interface MissionStateStore {
  source: MissionSource | null;
  pendingOp: MissionPendingOp;
  /** Which system last configured the chain for this source. */
  appliedBy: MissionAppliedBy;
  /** True once the user manually edited the chain for this source. */
  manualHold: boolean;
  /** Human-readable last pipeline action (Mission HUD tooltip). */
  lastAction: string | null;
}

export const useMissionStateStore = create<MissionStateStore>(() => ({
  source: null,
  pendingOp: null,
  appliedBy: null,
  manualHold: false,
  lastAction: null,
}));

const setState = useMissionStateStore.setState;
const getState = useMissionStateStore.getState;

// ── Automation guard ─────────────────────────────────────────────────────────
// Everything the pipeline applies goes through the same stores the user's own
// gestures use. This depth counter lets the manual-override watcher tell the
// difference: mutations inside runAsAutomation() are ours, everything else is
// the user.

let automationDepth = 0;

export function isAutomationApplying(): boolean {
  return automationDepth > 0;
}

export async function runAsAutomation<T>(fn: () => Promise<T> | T): Promise<T> {
  automationDepth++;
  try {
    return await fn();
  } finally {
    automationDepth--;
  }
}

/**
 * Record a manual chain edit for the current source. Called automatically by
 * the store watchers; exported so explicit "the user did this" paths (preset
 * apply, Tractor engage from the console) can flag it directly.
 */
export function noteManualOverride(): void {
  const s = getState();
  if (!s.source) return;
  // The chain no longer IS a deployed Armory loadout once edited by hand.
  void import("@/state/missionLogStore").then(({ noteArmoryApplied }) =>
    noteArmoryApplied(null),
  );
  // A manual move during the settle window cancels the pending automation.
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  currentRun?.abort();
  currentRun = null;
  if (!s.manualHold || s.pendingOp !== null) {
    setState({
      manualHold: true,
      appliedBy: "manual",
      pendingOp: null,
      lastAction: "Manual override — automation standing down",
    });
  }
}

// ── Signal detection ─────────────────────────────────────────────────────────

async function readSignal(): Promise<MissionSource | null> {
  const { useAirspaceStore } = await import("@/state/airspaceStore");
  const { usePlayerStore } = await import("@/state/playerStore");
  const air = useAirspaceStore.getState().media;
  const p = usePlayerStore.getState();
  // Airspace media wins while it's routed (loopback active) and playing.
  // Identity matches Mission Log keys (video id, not the flickering tab title).
  if (air && !air.paused && p.loopbackActive) {
    const { airspaceSourceId } = await import("@/lib/airspaceMedia");
    const id = airspaceSourceId(air);
    if (id) return { sig: id, kind: "airspace", title: air.title || "Airspace" };
  }
  if (p.status === "playing" && p.src) {
    const title = p.metadata.title ?? p.fileName ?? "";
    return { sig: `file:${p.src}`, kind: "file", title };
  }
  return null;
}

// ── The settle pipeline ──────────────────────────────────────────────────────

const SETTLE_MS = 2500;
const POLL_MS = 1500;

let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let currentRun: AbortController | null = null;
let lastSig = "";

async function toast(msg: string, kind?: "info" | "success" | "warn" | "error"): Promise<void> {
  const { useUIStore } = await import("@/state/uiStore");
  useUIStore.getState().toast(msg, kind);
}

/** Step 2 — saved source memory (Mission Log / SourceMemory). */
async function tryMemoryRestore(src: MissionSource): Promise<boolean> {
  try {
    const mem = await import("@/state/missionLogStore");
    const log = mem.useMissionLogStore.getState();
    if (!log.autoRestore) return false;

    let entry: import("@/state/missionLogStore").SourceMemory | null = null;
    if (src.kind === "airspace") {
      const key = mem.currentAirspaceKey();
      entry = key !== null ? log.entries[key] ?? null : null;
    } else {
      const { pathFromAudioSrc, useLibraryStore } = await import("@/state/libraryStore");
      const path = pathFromAudioSrc(src.sig.slice(5));
      if (path) {
        const lib = useLibraryStore.getState();
        const track = lib.tracks.find((t) => t.path === path);
        const playlistId = lib.collection.startsWith("pl:") ? lib.collection.slice(3) : null;
        entry = mem.lookupForTrack(path, {
          artist: track?.artist,
          album: track?.album,
          playlistId,
        });
      }
    }
    if (!entry) return false;
    const found = entry;
    const { applyChain } = await import("@/lib/chainSnapshot");
    await runAsAutomation(() => applyChain(found.chain));
    void toast(`Mission Log — restored "${found.name}"`);
    return true;
  } catch {
    return false;
  }
}

/** Step 3a — Auto-Lock: restore a valid existing Lock Library record. */
async function tryLockRestore(src: MissionSource): Promise<boolean> {
  try {
    const { useLockLibraryStore } = await import("@/state/lockLibraryStore");
    let key: string | null = null;
    if (src.kind === "file") {
      const { pathFromAudioSrc } = await import("@/state/libraryStore");
      const path = pathFromAudioSrc(src.sig.slice(5));
      if (path) key = `file:${path}`;
    } else {
      const { currentAirspaceKey } = await import("@/state/missionLogStore");
      key = currentAirspaceKey();
    }
    if (!key) return false;
    const lib = useLockLibraryStore.getState();
    const rec = lib.records[key];
    if (!rec) return false;
    const ok = await runAsAutomation(() => lib.applyRecord(key!));
    if (ok) void toast(`◎ Lock restored — ${rec.name}`, "success");
    return ok;
  } catch {
    return false;
  }
}

/** Step 3b — Auto-Lock: fresh scan + manifest apply. */
async function tryAutoLockScan(src: MissionSource, ac: AbortController): Promise<boolean> {
  const { autoLockScan } = await import("@/lib/tractorAutoLock");
  const outcome = await autoLockScan(src.title, ac.signal);
  if (outcome === "silent") {
    void toast("Auto-Lock skipped — no signal reaching the engine", "warn");
  }
  return outcome === "applied";
}

/** Step 4 — Auto-Flatten (default automation, local files only). */
async function tryAutoFlatten(src: MissionSource, ac: AbortController): Promise<boolean> {
  if (src.kind !== "file") return false;
  const { useSettingsStore } = await import("@/state/settingsStore");
  if (!useSettingsStore.getState().autoFlatten) return false;
  const { autoFlatten } = await import("@/audio/AutoFlatten");
  if (ac.signal.aborted) return false;
  // Pass the abort signal through so a source change mid-analysis stops the
  // 8-second sampling loop instead of applying a stale correction.
  await runAsAutomation(() => autoFlatten(ac.signal));
  return !ac.signal.aborted;
}

async function runPipeline(src: MissionSource): Promise<void> {
  currentRun?.abort();
  const ac = new AbortController();
  currentRun = ac;
  const finish = (appliedBy: MissionAppliedBy, action: string) => {
    if (ac.signal.aborted) return;
    setState({ pendingOp: null, appliedBy, lastAction: action });
  };

  try {
    // 1. Manual override — the user already voiced this source by hand.
    if (getState().manualHold) {
      finish("manual", "Manual override held");
      return;
    }

    // 2. Saved source memory.
    setState({ pendingOp: "restoring" });
    if (await tryMemoryRestore(src)) {
      finish("memory", `Restored source memory for "${src.title}"`);
      return;
    }
    if (ac.signal.aborted) return;

    // 3. Auto-Lock (armed only): existing lock first, then a fresh scan.
    const { isAutoLockArmed } = await import("@/lib/tractorAutoLock");
    if (isAutoLockArmed()) {
      if (await tryLockRestore(src)) {
        finish("lock", `Restored Tractor lock for "${src.title}"`);
        return;
      }
      if (ac.signal.aborted) return;
      setState({ pendingOp: "scanning" });
      if (await tryAutoLockScan(src, ac)) {
        finish("auto-lock", `Auto-Lock retuned for "${src.title}"`);
        return;
      }
      if (ac.signal.aborted) return;
    }

    // 4. Default automation — Auto-Flatten.
    setState({ pendingOp: "flattening" });
    if (await tryAutoFlatten(src, ac)) {
      finish("auto-flatten", `Auto-flattened "${src.title}"`);
      return;
    }

    finish(null, "No automation applied (nothing armed for this source)");
  } catch {
    finish(null, "Automation pipeline failed");
  } finally {
    if (currentRun === ac) currentRun = null;
  }
}

async function pollOnce(): Promise<void> {
  const src = await readSignal();
  if (!src) {
    if (lastSig !== "") {
      lastSig = "";
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      currentRun?.abort();
      setState({ source: null, pendingOp: null });
    }
    return;
  }
  if (src.sig === lastSig) return;
  lastSig = src.sig;

  // New source — reset per-source state and start ONE settle window.
  currentRun?.abort();
  if (settleTimer) clearTimeout(settleTimer);
  void import("@/lib/tractorApplied").then(({ clearLastAppliedTractor }) =>
    clearLastAppliedTractor(),
  );
  setState({
    source: src,
    pendingOp: "settling",
    appliedBy: null,
    manualHold: false,
    lastAction: null,
  });
  settleTimer = setTimeout(() => {
    settleTimer = null;
    // The source may have changed again during the settle — re-verify.
    void readSignal().then((now) => {
      if (now && now.sig === src.sig) void runPipeline(src);
      else setState({ pendingOp: null });
    }).catch(() => {
      if (lastSig !== src.sig) return;
      lastSig = "";
      setState({ pendingOp: null });
    });
  }, SETTLE_MS);
}

// ── Manual-override watchers ────────────────────────────────────────────────
// Watch the chain-shaping stores; any mutation not made by the pipeline while
// a source is active flags the manual hold. Output gain is deliberately NOT
// watched (LUFS normalize trims it on a timer).

let manualWatchUnsubs: Array<() => void> = [];

async function wireManualWatch(): Promise<void> {
  const { useAudioStore } = await import("@/state/audioStore");
  const { useEqStore } = await import("@/state/eqStore");

  let a = useAudioStore.getState();
  manualWatchUnsubs.push(
    useAudioStore.subscribe((s) => {
      const changed =
        s.params !== a.params || s.restore !== a.restore || s.clarity !== a.clarity;
      a = s;
      if (changed && !isAutomationApplying()) noteManualOverride();
    }),
  );

  let bands = useEqStore.getState().bands;
  manualWatchUnsubs.push(
    useEqStore.subscribe((s) => {
      const changed = s.bands !== bands;
      bands = s.bands;
      if (changed && !isAutomationApplying()) noteManualOverride();
    }),
  );
}

// ── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Wire the orchestrator once (call at boot; safe to call again). This is the
 * ONLY high-frequency "what's playing" watcher in the app.
 */
export function initMissionState(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void wireManualWatch();
  pollTimer = setInterval(() => void pollOnce(), POLL_MS);

  // Re-arming Auto-Lock mid-track re-runs the pipeline for the current
  // source (unless the user has a manual hold on it).
  void import("@/lib/tractorAutoLock").then(({ onAutoLockChange }) => {
    onAutoLockChange((armed) => {
      if (!armed) return;
      const s = getState();
      if (s.source && !s.manualHold) {
        lastSig = ""; // force re-detection → fresh settle → pipeline
      }
    });
  });
}

/** Stop the orchestrator (used by the smoke suite / reset paths). */
export function stopMissionState(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  currentRun?.abort();
  currentRun = null;
  // Drop the manual-override store subscriptions — a stop/start cycle used to
  // stack duplicate watchers that double-fired manual holds.
  for (const unsub of manualWatchUnsubs) {
    try { unsub(); } catch { /* ignore */ }
  }
  manualWatchUnsubs = [];
  started = false;
  lastSig = "";
}
