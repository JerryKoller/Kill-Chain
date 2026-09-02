import { create } from "zustand";
import { getEngine } from "@/audio/AudioEngine";
import { claimSource } from "@/lib/sourceArbiter";

export type PlayerStatus = "empty" | "loaded" | "playing" | "paused";
export type LoopMode = "off" | "track" | "queue";

/**
 * How Exterior Audio is currently capturing.
 *   "device"           getUserMedia from a specific input (virtual cable).
 *   "loopback"         system loopback; user still hears raw Windows audio.
 *   "loopbackWithMute" system loopback with the Windows default output
 *                      muted by Chromium — user hears ONLY the processed
 *                      feed (requires the app to output to a different
 *                      device than the Windows default).
 *   "airspace"         per-frame tab capture of the Airspace webview. Only
 *                      the webview's audio is captured, and its local
 *                      playback is muted by Chromium for the duration —
 *                      user hears ONLY the processed feed. No feedback
 *                      risk, works on a single output device.
 */
export type LoopbackMode = "device" | "loopback" | "loopbackWithMute" | "airspace";

export interface TrackMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Object URL pointing to cover art bitmap (null = none). */
  coverUrl: string | null;
}

export interface QueueItem {
  id: string;
  /** Absolute filesystem path OR an object URL OR a custom URL. */
  src: string;
  /** Display name (file name or stream name). */
  name: string;
  /** Best-effort metadata. */
  metadata?: TrackMetadata;
}

interface PlayerState {
  status: PlayerStatus;
  src: string | null;
  fileName: string | null;
  duration: number;
  /** Seconds. Alias of currentTime to keep older code working. */
  position: number;
  /** Same number, but the name external callers expect. */
  currentTime: number;
  volume: number;
  muted: boolean;
  loopMode: LoopMode;
  /** Back-compat: true when loopMode is "track" or "queue". */
  loop: boolean;
  /** Active queue + the index that is currently loaded. */
  queue: QueueItem[];
  currentIndex: number;
  /** Best-effort live metadata for the currently loaded track. */
  metadata: TrackMetadata;
  /** True when audio is being captured from a system source (loopback). */
  loopbackActive: boolean;
  /** Active capture mode, null when Exterior Audio is off. */
  loopbackMode: LoopbackMode | null;
  element: HTMLAudioElement | null;

  attachElement: (el: HTMLAudioElement) => void;
  loadDataUrlOrPath: (src: string, fileName?: string) => Promise<void>;
  loadBlob: (blob: Blob, fileName?: string) => Promise<void>;

  /** Replace the queue with a new list; auto-load the first item. */
  setQueue: (items: QueueItem[], startIndex?: number) => Promise<void>;
  /** Append items to the end of the queue. */
  enqueue: (items: QueueItem[]) => void;
  /** Insert items right after the currently playing index ("play next"). */
  insertNext: (items: QueueItem[]) => void;
  /** Remove a queue item by id. */
  dequeue: (id: string) => void;
  /** Clear the queue and stop. */
  clearQueue: () => void;
  /** Jump to a specific queue index. */
  jumpTo: (index: number) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;

  setMetadata: (m: Partial<TrackMetadata>) => void;

  /** Begin a system-audio loopback session via getDisplayMedia. */
  /**
   * Start Exterior Audio capture.
   * @param inputDeviceId  "" / undefined → system-default loopback via
   *                       getDisplayMedia (legacy path; risks feedback).
   *                       Any other string → getUserMedia from that specific
   *                       audio input (e.g. VB-Cable Output, line-in).
   * @param target         "airspace" → try direct per-frame capture of the
   *                       Airspace webview first (best mode: only the
   *                       webview's audio, local playback muted while
   *                       captured). Falls back to the generic paths above
   *                       when unavailable.
   */
  startLoopback: (inputDeviceId?: string, target?: "system" | "airspace") => Promise<boolean>;
  stopLoopback: () => void;
  /**
   * Quietly re-acquire a RUNNING "airspace" direct capture. Chromium's
   * per-frame capture is tied to the frame that existed when it started —
   * when the browser navigates (next video, new site) that stream can go
   * permanently silent without firing "ended". This swaps in a fresh stream
   * for the CURRENT frame without tearing down the session state.
   */
  restartAirspaceCapture: () => Promise<boolean>;

  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  setLoop: (l: boolean) => void;
  setLoopMode: (m: LoopMode) => void;
  toggleLoop: () => void;
  tick: () => void;
}

let loopbackStream: MediaStream | null = null;
/** Output gain (dB) before loopback dropped it - restored on stop. */
let loopbackGainAnchor: number | null = null;
/**
 * The track that was loaded before Exterior Audio took over. Restored when
 * loopback stops so the user can resume the song they were on instead of
 * landing on an empty player (which used to wedge playback).
 */
let preLoopbackTrack: {
  src: string | null;
  fileName: string | null;
  metadata: TrackMetadata;
  status: PlayerStatus;
} | null = null;

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Release a blob: object URL (and a queue item's cover blob) once nothing
 * references it anymore. Dropped files used to stay pinned in memory for the
 * whole session because their object URLs were never revoked.
 */
function revokeIfBlob(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) {
    try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
  }
}

function releaseQueueItem(
  item: QueueItem,
  inUse: { src: string | null; coverUrl: string | null },
): void {
  if (item.src !== inUse.src) revokeIfBlob(item.src);
  const cover = item.metadata?.coverUrl;
  if (cover && cover !== inUse.coverUrl) revokeIfBlob(cover);
}

/**
 * True when it's safe to capture with "loopbackWithMute" (which mutes the
 * WINDOWS DEFAULT output endpoint): the app must be outputting to a
 * *different physical device*, otherwise the mute silences our own processed
 * feed too and the user hears nothing.
 *
 * We compare the media-devices groupId of the app's chosen sink against the
 * groupId of the "default" output. Same group (or no explicit sink, or
 * anything indeterminate) → not safe → plain "loopback".
 */
async function canUseLoopbackWithMute(sinkId: string): Promise<boolean> {
  if (!sinkId) return false;
  if (!window.playground?.loopback?.setMode) return false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outs = devices.filter((d) => d.kind === "audiooutput");
    const def = outs.find((d) => d.deviceId === "default");
    const chosen = outs.find((d) => d.deviceId === sinkId);
    if (!def || !chosen) return false;
    if (!def.groupId || !chosen.groupId) return false;
    return def.groupId !== chosen.groupId;
  } catch {
    return false;
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  status: "empty",
  src: null,
  fileName: null,
  duration: 0,
  position: 0,
  currentTime: 0,
  volume: 1,
  muted: false,
  loopMode: "queue",
  loop: true,
  queue: [],
  currentIndex: -1,
  metadata: { title: null, artist: null, album: null, coverUrl: null },
  loopbackActive: false,
  loopbackMode: null,
  element: null,

  attachElement: (el) => {
    // Same element re-attach (TransportBar remount effect, StrictMode): keep
    // listeners as-is and just ensure the engine graph is wired.
    if (get().element === el) {
      el.preload = "auto";
      el.loop = get().loopMode === "track";
      el.volume = get().volume;
      el.muted = get().muted;
      try {
        getEngine().attachAudioElement(el);
      } catch (err) {
        console.warn("[player] re-attach failed (will retry on play):", err);
      }
      return;
    }

    el.preload = "auto";
    el.loop = get().loopMode === "track";
    el.volume = get().volume;
    el.muted = get().muted;
    el.addEventListener("loadedmetadata", () => {
      set({ duration: el.duration || 0 });
    });
    el.addEventListener("error", () => {
      const err = el.error;
      console.error(
        `[player] <audio> error: code=${err?.code} message="${err?.message ?? ""}"`,
      );
      const src = el.currentSrc || el.src || get().src || "";
      let path: string | null = null;
      try {
        if (src.includes("?p=")) {
          const encoded = src.split("?p=")[1]?.split("&")[0];
          path = encoded ? decodeURIComponent(encoded) : null;
        }
      } catch {
        path = null;
      }
      const code = err?.code ?? 0;
      // MEDIA_ERR_SRC_NOT_SUPPORTED (4) / NETWORK (2) usually mean a moved file.
      const moved =
        code === 2 ||
        code === 4 ||
        /not found|failed to load|no supported/i.test(err?.message ?? "");
      const detail = moved
        ? "File not found — was it moved or renamed? Re-add the folder or prune missing tracks in Library."
        : code === 3
          ? "Could not decode this file. The format may be unsupported or the file is damaged."
          : `Playback error${err?.message ? `: ${err.message}` : ""}.`;
      void import("@/state/uiStore").then(({ useUIStore }) => {
        useUIStore.getState().toast(detail, "error");
      });
      void import("@/lib/appHealth").then(({ reportPlaybackFailure }) => {
        reportPlaybackFailure(detail, path);
      });
      if (path) {
        void import("@/state/libraryStore").then(({ useLibraryStore }) => {
          useLibraryStore.getState().markMissing(path!);
        });
      }
      set({ status: get().src ? "loaded" : "empty" });
    });
    el.addEventListener("ended", () => {
      const s = get();
      // "track" loop is handled by <audio>.loop. For "queue" / "off" we
      // step forward.
      if (s.loopMode === "track") return;
      const lastIndex = s.queue.length - 1;
      if (s.currentIndex < lastIndex) {
        void s.next();
      } else if (s.loopMode === "queue" && s.queue.length > 0) {
        void s.jumpTo(0).then(() => s.play());
      } else {
        set({ status: "paused" });
      }
    });

    // If the previous <audio> was destroyed (e.g. TransportBar unmounted),
    // the store still knows the track — rehydrate src + scrub position so
    // play-bar resume works on the replacement element.
    const savedSrc = get().src;
    const savedPos = get().position;
    const savedStatus = get().status;
    if (savedSrc && el.getAttribute("src") !== savedSrc && el.src !== savedSrc) {
      el.src = savedSrc;
      el.load();
      const restorePos = () => {
        if (savedPos > 0 && Number.isFinite(savedPos)) {
          try {
            el.currentTime = Math.min(savedPos, el.duration || savedPos);
          } catch { /* ignore seek race */ }
        }
        set({
          duration: el.duration || get().duration,
          position: el.currentTime || savedPos,
          // Dead element may have left status stuck on "playing".
          status: savedStatus === "playing" ? "paused" : savedStatus,
        });
      };
      if (el.readyState >= 1) restorePos();
      else el.addEventListener("loadedmetadata", restorePos, { once: true });
    }

    set({ element: el });
    try {
      getEngine().attachAudioElement(el);
    } catch (err) {
      console.warn("[player] initial attach failed (will retry on play):", err);
    }
  },

  loadDataUrlOrPath: async (src, fileName) => {
    const el = get().element;
    if (!el) return;
    if (get().loopbackActive) get().stopLoopback();
    const prevSrc = get().src;
    el.src = src;
    el.load();
    // Revoke any old cover art object URL. Covers referenced by a queue item
    // stay alive (releaseQueueItem frees them when the item leaves the queue).
    const m = get().metadata;
    const coverInQueue = m.coverUrl && get().queue.some((q) => q.metadata?.coverUrl === m.coverUrl);
    if (m.coverUrl && !coverInQueue) revokeIfBlob(m.coverUrl);
    set({
      src,
      fileName: fileName ?? null,
      status: "loaded",
      position: 0,
      currentTime: 0,
      metadata: { title: fileName ?? null, artist: null, album: null, coverUrl: null },
    });
    // Free the replaced track's blob unless a queue item still references it.
    if (prevSrc && prevSrc !== src && !get().queue.some((q) => q.src === prevSrc)) {
      revokeIfBlob(prevSrc);
    }
  },

  loadBlob: async (blob, fileName) => {
    const el = get().element;
    if (!el) return;
    if (get().loopbackActive) get().stopLoopback();
    const prevSrc = get().src;
    const url = URL.createObjectURL(blob);
    el.src = url;
    el.load();
    const m = get().metadata;
    const coverInQueue = m.coverUrl && get().queue.some((q) => q.metadata?.coverUrl === m.coverUrl);
    if (m.coverUrl && !coverInQueue) revokeIfBlob(m.coverUrl);
    set({
      src: url,
      fileName: fileName ?? null,
      status: "loaded",
      position: 0,
      currentTime: 0,
      metadata: { title: fileName ?? null, artist: null, album: null, coverUrl: null },
    });
    if (prevSrc && prevSrc !== url && !get().queue.some((q) => q.src === prevSrc)) {
      revokeIfBlob(prevSrc);
    }
  },

  setQueue: async (items, startIndex = 0) => {
    set({ queue: items, currentIndex: -1 });
    if (items.length > 0) {
      await get().jumpTo(Math.max(0, Math.min(items.length - 1, startIndex)));
    }
  },

  enqueue: (items) => {
    const cur = get().queue;
    const wasEmpty = cur.length === 0;
    const next = [...cur, ...items];
    set({ queue: next });
    if (wasEmpty && next.length > 0) {
      void get().jumpTo(0);
    }
  },

  insertNext: (items) => {
    const { queue, currentIndex } = get();
    const wasEmpty = queue.length === 0;
    const at = currentIndex >= 0 ? currentIndex + 1 : 0;
    const next = [...queue.slice(0, at), ...items, ...queue.slice(at)];
    set({ queue: next });
    if (wasEmpty && next.length > 0) {
      void get().jumpTo(0);
    }
  },

  dequeue: (id) => {
    const cur = get().queue;
    const idx = cur.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const removed = cur[idx];
    const next = cur.filter((q) => q.id !== id);
    let curIdx = get().currentIndex;
    if (idx < curIdx) curIdx -= 1;
    else if (idx === curIdx) curIdx = -1;
    set({ queue: next, currentIndex: curIdx });
    // Free the removed item's blob memory unless it's still loaded/playing.
    const s = get();
    releaseQueueItem(removed, { src: s.src, coverUrl: s.metadata.coverUrl });
  },

  clearQueue: () => {
    get().pause();
    const items = get().queue;
    const el = get().element;
    const prevSrc = get().src;
    const prevCover = get().metadata.coverUrl;
    set({
      queue: [],
      currentIndex: -1,
      status: "empty",
      src: null,
      fileName: null,
      metadata: { title: null, artist: null, album: null, coverUrl: null },
    });
    // Detach the element from the last blob and release everything —
    // the transport used to keep showing the stale title after a clear.
    if (el) {
      try { el.removeAttribute("src"); el.load(); } catch { /* ignore */ }
    }
    revokeIfBlob(prevSrc);
    revokeIfBlob(prevCover);
    for (const item of items) {
      releaseQueueItem(item, { src: null, coverUrl: null });
    }
  },

  jumpTo: async (index) => {
    const q = get().queue;
    if (index < 0 || index >= q.length) return;
    const item = q[index];
    set({ currentIndex: index });
    await get().loadDataUrlOrPath(item.src, item.name);
    if (item.metadata) {
      get().setMetadata(item.metadata);
    }
  },

  next: async () => {
    const { queue, currentIndex, loopMode } = get();
    if (queue.length === 0) return;
    const ni = currentIndex + 1;
    if (ni >= queue.length) {
      if (loopMode === "queue") {
        await get().jumpTo(0);
        await get().play();
      }
      return;
    }
    await get().jumpTo(ni);
    await get().play();
  },

  previous: async () => {
    const { queue, currentIndex, element } = get();
    if (queue.length === 0) return;
    // If we've played more than 3s, restart current track instead of stepping back.
    if (element && element.currentTime > 3) {
      element.currentTime = 0;
      return;
    }
    const pi = Math.max(0, currentIndex - 1);
    await get().jumpTo(pi);
    await get().play();
  },

  setMetadata: (m) => {
    const cur = get().metadata;
    if (m.coverUrl !== undefined && cur.coverUrl && cur.coverUrl !== m.coverUrl) {
      // Covers can be shared with a queue item's metadata — only revoke when
      // nothing in the queue still references this URL.
      const shared = get().queue.some((q) => q.metadata?.coverUrl === cur.coverUrl);
      if (!shared) revokeIfBlob(cur.coverUrl);
    }
    set({ metadata: { ...cur, ...m } });
  },

  startLoopback: async (inputDeviceId?: string, target?: "system" | "airspace") => {
    if (get().loopbackActive) return true;

    // One source at a time: the synth / sequencer stand down before capture
    // becomes the live source. (The file player is paused just below.)
    claimSource("loopback");

    // Remember the current track so we can return to it when loopback stops.
    {
      const s0 = get();
      preLoopbackTrack = {
        src: s0.src,
        fileName: s0.fileName,
        metadata: s0.metadata,
        status: s0.status,
      };
    }

    // Pause any currently-playing file so its samples don't double-feed
    // the graph alongside the loopback.
    const el = get().element;
    if (el && !el.paused) {
      try { el.pause(); } catch { /* ignore */ }
    }

    let stream: MediaStream | null = null;
    let captureMode: LoopbackMode = "loopback";

    if (target === "airspace" && window.playground?.loopback?.setMode) {
      // AIRSPACE DIRECT CAPTURE:
      // Per-frame tab capture of the in-app webview. Main answers the
      // display-media request with the webview's WebFrameMain as the audio
      // source (enableLocalEcho: false), so ONLY the webview's audio is
      // captured and its local playback is muted while the capture runs —
      // the user hears exclusively the processed feed. Structurally
      // feedback-free on any output-device setup. setMode() returns the
      // mode the main process actually accepted; anything other than
      // "airspace" (e.g. no webview attached yet) falls through to the
      // generic device / system-loopback paths below.
      try {
        const granted = await window.playground.loopback.setMode("airspace");
        if (granted === "airspace") {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 1, height: 1 },
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            } as MediaTrackConstraints,
          } as DisplayMediaStreamOptions);
          captureMode = "airspace";
          console.log("[loopback] airspace direct capture engaged (webview frame audio)");
        } else {
          console.warn(`[loopback] airspace mode unavailable (got "${granted}"), falling back`);
        }
      } catch (err) {
        console.warn("[loopback] airspace direct capture failed, falling back:", err);
        stream = null;
        captureMode = "loopback";
      }
    }

    if (stream) {
      /* airspace capture succeeded — skip the generic paths */
    } else if (inputDeviceId && inputDeviceId !== "") {
      // VIRTUAL-CABLE / DEVICE PATH:
      // Capture from a specific audio input (typically VB-Cable Output).
      console.log("[loopback] requesting device capture, id=", inputDeviceId);
      try {
        // Don't constrain channelCount — let the device report its native
        // count. Constraining to 2 on a multi-channel virtual cable (e.g.
        // "CABLE In 16ch") forces a 16→2 downmix which adds artifacts and
        // can lose the actual stereo pair (some routing configs put L/R
        // on channels other than 1+2). The AudioContext destination is
        // stereo by default, so anything more arrives as native and is
        // mixed cleanly by the standard channel-mixing rules.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: inputDeviceId },
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          } as MediaTrackConstraints,
        });
        captureMode = "device";
        const tracks = stream.getAudioTracks();
        console.log(
          "[loopback] device capture obtained, tracks=",
          tracks.map((t) => ({
            label: t.label,
            enabled: t.enabled,
            muted: t.muted,
            settings: t.getSettings(),
          })),
        );
        if (tracks.length === 0) {
          console.error("[loopback] device returned 0 audio tracks - the deviceId may be stale");
          stream.getTracks().forEach((t) => t.stop());
          return false;
        }
      } catch (err) {
        // Stale device IDs (e.g. after Windows reassigned its hardware
        // string between launches) reject with OverconstrainedError. Don't
        // silently swallow that - log loudly so the user can fix it in
        // Settings → Audio Routing.
        const name = (err as Error)?.name ?? "Error";
        const msg = (err as Error)?.message ?? String(err);
        console.error(
          `[loopback] device capture failed (${name}): ${msg}. ` +
          `deviceId=${inputDeviceId}. ` +
          `Re-pick the source in Settings → Audio Routing.`,
        );
        return false;
      }
    } else {
      // SYSTEM-DEFAULT LOOPBACK PATH:
      // getDisplayMedia + Electron's setDisplayMediaRequestHandler captures
      // the system mix (WASAPI loopback on the default render endpoint).
      //
      // Preferred mode: "loopbackWithMute". Chromium mutes the default
      // endpoint's master volume while the loopback tap (pre-mute) keeps
      // capturing — so the user hears ONLY our processed output and there
      // is no double-audio and no acoustic feedback loop. Only safe when
      // the app outputs to a DIFFERENT device than the Windows default;
      // otherwise the mute would silence our own feed too.
      let sinkId = "";
      try {
        const settings = await import("@/state/settingsStore");
        sinkId = settings.useSettingsStore.getState().audioOutputDeviceId;
      } catch { /* ignore */ }
      const withMute = await canUseLoopbackWithMute(sinkId);
      try {
        await window.playground?.loopback?.setMode(
          withMute ? "loopbackWithMute" : "loopback",
        );
        if (withMute) captureMode = "loopbackWithMute";
      } catch (err) {
        console.warn("[loopback] setMode failed, using plain loopback:", err);
      }
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1 },
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          } as MediaTrackConstraints,
        } as DisplayMediaStreamOptions);
      } catch (err) {
        console.warn("[loopback] primary getDisplayMedia failed:", err);
        // Legacy Chromium fallback (plain loopback semantics only).
        captureMode = "loopback";
        try {
          const constraints = {
            audio: {
              mandatory: {
                chromeMediaSource: "desktop",
              },
            },
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                maxWidth: 1,
                maxHeight: 1,
              },
            },
          } as unknown as MediaStreamConstraints;
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err2) {
          console.error("[loopback] fallback getUserMedia failed:", err2);
          return false;
        }
      }
    }

    if (!stream) return false;

    // Drop video tracks immediately - we only need audio. Some Chromium
    // builds return zero audio tracks if the user clicked through a picker
    // and didn't tick "Share audio". Detect that and clean up.
    stream.getVideoTracks().forEach((t) => t.stop());
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      console.warn(
        "[loopback] no audio track on the captured stream. On Windows, " +
        "the system loopback handler in main.ts must request `audio: \"loopback\"`.",
      );
      return false;
    }

    loopbackStream = stream;
    const engine = getEngine();
    await engine.resume();
    engine.attachMicStream(stream);
    console.log(
      "[loopback] attached MediaStream to engine. ctx.state=",
      engine.ctx.state,
      "sinkId=",
      engine.getOutputDevice() || "(default)",
    );
    audioTracks[0].addEventListener("ended", () => {
      get().stopLoopback();
    });

    // FEEDBACK MITIGATION:
    // Only needed for plain system loopback, where the user's default device
    // both plays our processed output and is being captured. The other modes
    // are structurally feedback-free:
    //   "device"           captured device is a virtual cable; our output
    //                      never enters it.
    //   "loopbackWithMute" our output goes to a separate (non-default)
    //                      device that isn't captured, and the captured
    //                      default endpoint is muted anyway.
    //   "airspace"         only the webview frame's audio is captured (our
    //                      output never enters the capture), and its local
    //                      playback is muted by Chromium for the duration.
    // Feedback protection:
    //   "loopback"           — same-device capture; MUST run FeedbackKiller
    //   "loopbackWithMute"   — mute usually breaks the ring, but mute can fail
    //                          silently — keep FeedbackKiller on as a safety net
    //   "device" / "airspace"— virtual cable / webview frame; structurally free
    if (captureMode === "loopback" || captureMode === "loopbackWithMute") {
      try {
        engine.setFeedbackKillerActive(true);
      } catch (err) {
        console.warn("[loopback] feedback killer engage failed:", err);
      }
      try {
        const audio = await import("@/state/audioStore");
        const a = audio.useAudioStore.getState();
        loopbackGainAnchor = a.outputGainDb;
        // Modest trim for plain loopback; muted path can stay louder.
        const floor = captureMode === "loopback" ? -12 : -6;
        a.setOutputGain(Math.min(a.outputGainDb, floor));
      } catch { /* ignore */ }
    } else {
      // Virtual-cable / Airspace paths: full quality, no gain trim,
      // no feedback killer.
      try {
        engine.setFeedbackKillerActive(false);
      } catch { /* ignore */ }
    }

    set({
      loopbackActive: true,
      loopbackMode: captureMode,
      status: "playing",
      src:
        captureMode === "device"
          ? `audioin://${inputDeviceId}`
          : captureMode === "airspace"
            ? "airspace://webview"
            : "loopback://system",
      fileName:
        captureMode === "device"
          ? "External audio source"
          : captureMode === "airspace"
            ? "Airspace (direct capture)"
            : captureMode === "loopbackWithMute"
              ? "System audio (loopback, exclusive)"
              : "System audio (loopback)",
      metadata: {
        title: captureMode === "airspace" ? "Airspace" : "Exterior audio",
        artist:
          captureMode === "device"
            ? "Routed input"
            : captureMode === "airspace"
              ? "Webview direct capture — EQ'd feed only"
              : captureMode === "loopbackWithMute"
                ? "Windows loopback — direct output muted"
                : "Windows loopback",
        album: null,
        coverUrl: null,
      },
    });
    return true;
  },

  restartAirspaceCapture: async () => {
    const s = get();
    if (!s.loopbackActive || s.loopbackMode !== "airspace") return false;
    try {
      const granted = await window.playground?.loopback?.setMode("airspace");
      if (granted !== "airspace") return false;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1 },
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        } as MediaTrackConstraints,
      } as DisplayMediaStreamOptions);
      stream.getVideoTracks().forEach((t) => t.stop());
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      // Swap streams: attach the fresh one, then drop the dead one.
      const old = loopbackStream;
      loopbackStream = stream;
      getEngine().attachMicStream(stream);
      old?.getTracks().forEach((t) => t.stop());
      tracks[0].addEventListener("ended", () => {
        // Only tear down if this stream is still the active one.
        if (loopbackStream === stream) get().stopLoopback();
      });
      console.log("[loopback] airspace capture re-acquired after navigation");
      return true;
    } catch (err) {
      console.warn("[loopback] airspace capture restart failed:", err);
      return false;
    }
  },

  stopLoopback: () => {
    if (loopbackStream) {
      // Stopping the tracks also makes Chromium restore (unmute) the system
      // output if the capture ran in "loopbackWithMute" mode.
      loopbackStream.getTracks().forEach((t) => t.stop());
      loopbackStream = null;
    }
    // Reset the main-process handler to the safe default for any future
    // getDisplayMedia call.
    try { void window.playground?.loopback?.setMode("loopback"); } catch { /* ignore */ }
    try {
      const engine = getEngine();
      engine.detachSource();
      engine.setFeedbackKillerActive(false);
    } catch {
      /* ignore */
    }
    // Restore the user's pre-loopback output gain.
    if (loopbackGainAnchor !== null) {
      try {
        void import("@/state/audioStore").then(({ useAudioStore }) => {
          useAudioStore.getState().setOutputGain(loopbackGainAnchor!);
          loopbackGainAnchor = null;
        });
      } catch { /* ignore */ }
    }
    // Restore the pre-loopback track (if any) so the user can resume it.
    const prev = preLoopbackTrack;
    preLoopbackTrack = null;
    if (prev && prev.src) {
      set({
        loopbackActive: false,
        loopbackMode: null,
        status: prev.status === "playing" ? "paused" : prev.status,
        src: prev.src,
        fileName: prev.fileName,
        metadata: prev.metadata,
      });
    } else {
      set({
        loopbackActive: false,
        loopbackMode: null,
        status: "empty",
        src: null,
        fileName: null,
        metadata: { title: null, artist: null, album: null, coverUrl: null },
      });
    }
    // Re-attach the <audio> element so file playback can resume. The engine
    // re-wires the cached MediaElementSource, so this no longer breaks audio.
    const el = get().element;
    if (el) {
      try {
        getEngine().attachAudioElement(el);
      } catch {
        /* already attached */
      }
    }
  },

  play: async () => {
    if (get().loopbackActive) {
      claimSource("loopback");
      set({ status: "playing" });
      return;
    }
    const el = get().element;
    if (!el) return;
    // Defensive: if the <audio> node was replaced without src, rehydrate
    // from the store before attempting play (Fire dock swap / remount).
    const savedSrc = get().src;
    if (savedSrc && !el.currentSrc && !el.getAttribute("src")) {
      el.src = savedSrc;
      el.load();
      const pos = get().position;
      if (pos > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            try {
              el.currentTime = Math.min(pos, el.duration || pos);
            } catch { /* ignore */ }
            resolve();
          };
          if (el.readyState >= 1) done();
          else el.addEventListener("loadedmetadata", done, { once: true });
        });
      }
    }
    // One source at a time: playing a file silences the synth/sequencer and
    // pauses whatever is playing inside Airspace.
    claimSource("file");
    const engine = getEngine();
    await engine.resume();
    try {
      engine.attachAudioElement(el);
    } catch {
      /* element already attached */
    }
    try {
      await el.play();
      set({ status: "playing" });
    } catch (err) {
      console.error("[player] el.play() REJECTED:", err);
      const msg =
        err instanceof DOMException && err.name === "NotSupportedError"
          ? "File not found — was it moved or renamed?"
          : err instanceof Error
            ? err.message
            : "Playback was blocked";
      void import("@/state/uiStore").then(({ useUIStore }) => {
        useUIStore.getState().toast(msg, "error");
      });
      void import("@/lib/appHealth").then(({ reportPlaybackFailure }) => {
        reportPlaybackFailure(msg, get().src);
      });
      const src = get().src;
      if (src?.includes("?p=")) {
        try {
          const encoded = src.split("?p=")[1]?.split("&")[0];
          const path = encoded ? decodeURIComponent(encoded) : null;
          if (path) {
            void import("@/state/libraryStore").then(({ useLibraryStore }) => {
              useLibraryStore.getState().markMissing(path);
            });
          }
        } catch {
          /* ignore */
        }
      }
    }
  },

  pause: () => {
    if (get().loopbackActive) {
      set({ status: "paused" });
      return;
    }
    const el = get().element;
    if (!el) return;
    el.pause();
    set({ status: "paused" });
  },

  toggle: async () => {
    if (get().status === "playing") {
      get().pause();
    } else {
      await get().play();
    }
  },

  seek: (t) => {
    const el = get().element;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(get().duration || 0, t));
    set({ position: el.currentTime, currentTime: el.currentTime });
  },

  setVolume: (v) => {
    const el = get().element;
    const vv = Math.max(0, Math.min(1, v));
    set({ volume: vv });
    if (el) el.volume = vv;
  },

  setMuted: (m) => {
    const el = get().element;
    set({ muted: m });
    if (el) el.muted = m;
  },

  setLoop: (l) => {
    get().setLoopMode(l ? "queue" : "off");
  },

  setLoopMode: (mode) => {
    const el = get().element;
    set({ loopMode: mode, loop: mode !== "off" });
    if (el) el.loop = mode === "track";
  },

  toggleLoop: () => {
    const m = get().loopMode;
    const next: LoopMode = m === "off" ? "queue" : m === "queue" ? "track" : "off";
    get().setLoopMode(next);
  },

  tick: () => {
    const el = get().element;
    if (!el) return;
    set({
      position: el.currentTime,
      currentTime: el.currentTime,
      duration: el.duration || get().duration,
    });
  },
}));
