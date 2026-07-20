/**
 * airspaceMedia — bridges media playing inside the Airspace <webview> to the
 * rest of the app (transport bar deck, source arbiter).
 *
 * The webview stays mounted for the app's lifetime (AirspaceView), so this
 * module holds the element handle and polls it with `executeJavaScript`:
 * a tiny injected picker finds the page's "main" <video>/<audio> (the one
 * that's playing, else the longest), and reports position / duration /
 * paused / Media-Session metadata + artwork. Results land in
 * `airspaceStore.media`, which the transport bar renders as the Airspace
 * deck: the scrubber scrubs the actual page video, play/pause drives it,
 * and the thumbnail comes from Media-Session artwork (YouTube, Spotify,
 * SoundCloud all provide it) with a yt-thumbnail fallback.
 *
 * Everything is defensive: pages without media report null, navigation mid-
 * poll just misses one tick, and all injected code is side-effect-free
 * except the explicit play/pause/seek/volume controls.
 */

interface WebviewHandle extends HTMLElement {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getURL(): string;
}

export interface AirspaceMediaSnapshot {
  title: string;
  artist: string;
  artwork: string | null;
  duration: number;
  currentTime: number;
  paused: boolean;
  live: boolean;
  volume: number;
}

let webview: WebviewHandle | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPaused: boolean | null = null;

// ── Dead-capture watchdog ──
// Chromium's per-frame capture ("Route through Kill-Chain") is bound to the
// frame that existed when it started; navigating to the next video can kill
// the audio stream silently. When the page says "playing" but the engine
// hears nothing for a few polls, re-acquire the capture for the new frame.
let silentTicks = 0;
let lastCaptureRestart = 0;

async function watchdogTick(snap: AirspaceMediaSnapshot | null): Promise<void> {
  const playingAudibly = !!snap && !snap.paused && snap.volume > 0.01;
  if (!playingAudibly) {
    silentTicks = 0;
    return;
  }
  const { usePlayerStore } = await import("@/state/playerStore");
  const p = usePlayerStore.getState();
  if (!p.loopbackActive || p.loopbackMode !== "airspace") {
    silentTicks = 0;
    return;
  }
  const { peekEngine } = await import("@/audio/AudioEngine");
  const engine = peekEngine();
  if (!engine) return;
  silentTicks = engine.getInputRms() < 0.0015 ? silentTicks + 1 : 0;
  // ~3 s of "video playing but engine hears nothing" → the stream is dead.
  if (silentTicks >= 4 && performance.now() - lastCaptureRestart > 10_000) {
    lastCaptureRestart = performance.now();
    silentTicks = 0;
    void p.restartAirspaceCapture();
  }
}

/** Injected element picker — shared by the poll and every control call. */
const PICK_MEDIA = `
  const els = Array.from(document.querySelectorAll("video,audio"));
  const score = (m) => {
    let s = 0;
    if (!m.paused && !m.ended) s += 1e6;
    if (m.currentTime > 0) s += 1e3;
    const d = m.duration;
    s += (d && isFinite(d)) ? Math.min(d, 36000) : 10;
    return s;
  };
  const media = els
    .filter((m) => m.readyState > 0 || !m.paused)
    .sort((a, b) => score(b) - score(a))[0] || null;
`;

const READ_SNAPSHOT = `(() => {
  ${PICK_MEDIA}
  if (!media) return null;
  const md = (navigator.mediaSession && navigator.mediaSession.metadata) || null;
  let art = null;
  try {
    if (md && md.artwork && md.artwork.length) {
      art = md.artwork[md.artwork.length - 1].src || null;
    }
  } catch (e) { /* artwork getters can throw on some sites */ }
  if (!art && media.tagName === "VIDEO" && media.poster) art = media.poster;
  const dur = media.duration;
  return {
    title: (md && md.title) || document.title || "",
    artist: (md && md.artist) || location.hostname.replace(/^www\\./, ""),
    artwork: art,
    duration: dur && isFinite(dur) ? dur : 0,
    currentTime: media.currentTime || 0,
    paused: !!media.paused,
    live: !!dur && !isFinite(dur),
    volume: typeof media.volume === "number" ? media.volume : 1,
  };
})()`;

function controlScript(action: string): string {
  return `(() => { ${PICK_MEDIA} if (!media) return false; ${action} return true; })()`;
}

/** youtube.com/watch?v=ID → static thumbnail URL (Media-Session fallback). */
function youtubeThumb(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

async function pollOnce(): Promise<void> {
  const el = webview;
  if (!el) return;
  let snap: AirspaceMediaSnapshot | null = null;
  try {
    snap = (await el.executeJavaScript(READ_SNAPSHOT)) as AirspaceMediaSnapshot | null;
  } catch {
    // Guest navigating / not ready — treat as "no media" this tick but don't
    // clear an existing readout for a single hiccup.
    return;
  }
  const { useAirspaceStore } = await import("@/state/airspaceStore");
  if (snap && !snap.artwork) {
    try { snap.artwork = youtubeThumb(el.getURL()); } catch { /* guest busy */ }
  }
  // "One source at a time": the instant Airspace media starts playing, the
  // file player and the synth stand down.
  if (snap && lastPaused !== false && !snap.paused) {
    const { claimSource } = await import("@/lib/sourceArbiter");
    claimSource("airspace");
  }
  lastPaused = snap ? snap.paused : null;
  useAirspaceStore.getState().setMedia(snap);
  void watchdogTick(snap);
}

/** AirspaceView hands its (persistent) webview element over once mounted. */
export function registerAirspaceWebview(el: HTMLElement | null): void {
  webview = el as WebviewHandle | null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (webview) {
    pollTimer = setInterval(() => void pollOnce(), 700);
  } else {
    lastPaused = null;
    void import("@/state/airspaceStore").then(({ useAirspaceStore }) => {
      useAirspaceStore.getState().setMedia(null);
    });
  }
}

/** Play/pause toggle for the page's main media. Resolves true if it acted. */
export async function toggleAirspaceMedia(): Promise<boolean> {
  const el = webview;
  if (!el) return false;
  try {
    const acted = (await el.executeJavaScript(
      controlScript("if (media.paused) { media.play().catch(() => {}); } else { media.pause(); }"),
      true,
    )) as boolean;
    // Refresh the readout right away so the transport button flips instantly.
    void pollOnce();
    return acted;
  } catch {
    return false;
  }
}

export async function playAirspaceMedia(): Promise<boolean> {
  const el = webview;
  if (!el) return false;
  try {
    const acted = (await el.executeJavaScript(
      controlScript("media.play().catch(() => {});"),
      true,
    )) as boolean;
    void pollOnce();
    return acted;
  } catch {
    return false;
  }
}

export function pauseAirspaceMedia(): void {
  const el = webview;
  if (!el) return;
  el.executeJavaScript(controlScript("media.pause();"), true)
    .then(() => void pollOnce())
    .catch(() => { /* guest not ready */ });
}

/** Seek the page's media to `t` seconds (transport scrubber). */
export function seekAirspaceMedia(t: number): void {
  const el = webview;
  if (!el) return;
  const safe = Math.max(0, Number.isFinite(t) ? t : 0);
  el.executeJavaScript(
    controlScript(`try { media.currentTime = ${safe}; } catch (e) {}`),
    true,
  ).catch(() => { /* guest not ready */ });
  // Optimistic local update so the scrubber doesn't snap back for a tick.
  void import("@/state/airspaceStore").then(({ useAirspaceStore }) => {
    const s = useAirspaceStore.getState();
    if (s.media) s.setMedia({ ...s.media, currentTime: safe });
  });
}

/** Volume 0..1 for the page's media (transport volume in Airspace deck mode). */
export function setAirspaceMediaVolume(v: number): void {
  const el = webview;
  if (!el) return;
  const safe = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
  el.executeJavaScript(
    controlScript(`try { media.volume = ${safe}; media.muted = false; } catch (e) {}`),
    true,
  ).catch(() => { /* guest not ready */ });
  void import("@/state/airspaceStore").then(({ useAirspaceStore }) => {
    const s = useAirspaceStore.getState();
    if (s.media) s.setMedia({ ...s.media, volume: safe });
  });
}
