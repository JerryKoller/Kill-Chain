import { useCallback, useEffect, useRef, useState } from "react";
import { useAirspaceStore } from "@/state/airspaceStore";
import { usePlayerStore } from "@/state/playerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { NeonButton } from "@/components/shared/NeonButton";
import { MissionLogPanel } from "@/components/MissionLog/MissionLogPanel";
import { registerAirspaceWebview } from "@/lib/airspaceMedia";
import { optionsForMode, type AirMode } from "@/lib/airspaceModes";

/**
 * Airspace — in-app browser for YouTube / Spotify Web / SoundCloud / Twitch.
 *
 * Engaging "Route through Kill-Chain" prefers DIRECT CAPTURE: the main
 * process answers the display-media request with the webview's WebFrameMain
 * as the audio source, so ONLY this browser's audio is captured and its
 * local playback is muted while the capture runs — the user hears
 * exclusively the processed (EQ/FX) feed, with zero feedback risk on any
 * output-device setup. When direct capture is unavailable it falls back to
 * the same Exterior-Audio paths used by the transport bar (virtual cable /
 * system loopback). The component stays MOUNTED (hidden) when the user
 * switches views so playback continues while they sculpt the sound.
 */

/** Minimal typing for Electron's <webview> element (renderer has no electron types). */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

/**
 * Turn address-bar input into a navigable URL:
 * full http(s) URLs pass through, bare domains get https://, anything else
 * becomes a DuckDuckGo search.
 */
function normalizeInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[^\s]{2,}(\/\S*)?$/i.test(s) && !s.includes(" ")) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

export function AirspaceView({ visible }: { visible: boolean }) {
  const lastUrl = useAirspaceStore((s) => s.lastUrl);
  const bookmarks = useAirspaceStore((s) => s.bookmarks);
  const setLastUrl = useAirspaceStore((s) => s.setLastUrl);
  const addBookmark = useAirspaceStore((s) => s.addBookmark);
  const removeBookmark = useAirspaceStore((s) => s.removeBookmark);
  const pip = useAirspaceStore((s) => s.pip);
  const setPip = useAirspaceStore((s) => s.setPip);
  const adblock = useAirspaceStore((s) => s.adblock);
  const setAdblock = useAirspaceStore((s) => s.setAdblock);
  const airMode = useAirspaceStore((s) => s.airMode);
  const airOpts = useAirspaceStore((s) => s.airOpts);
  const setAirMode = useAirspaceStore((s) => s.setAirMode);
  const setAirOpt = useAirspaceStore((s) => s.setAirOpt);

  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  const loopbackMode = usePlayerStore((s) => s.loopbackMode);
  const startLoopback = usePlayerStore((s) => s.startLoopback);
  const stopLoopback = usePlayerStore((s) => s.stopLoopback);
  const ensureReady = useAudioStore((s) => s.ensureReady);
  const setView = useUIStore((s) => s.setView);
  const toast = useUIStore((s) => s.toast);

  const webviewRef = useRef<WebviewElement | null>(null);
  // Initial src is frozen so re-renders never re-navigate the guest.
  const initialUrl = useRef(lastUrl).current;
  const domReady = useRef(false);

  const [urlInput, setUrlInput] = useState(initialUrl);
  const [pageTitle, setPageTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [adsBlocked, setAdsBlocked] = useState(0);
  const [missionLogOpen, setMissionLogOpen] = useState(false);

  // Push the persisted AdBlock preference into the main process once, then
  // keep the blocked-counter fresh while the view is on screen.
  useEffect(() => {
    const api = window.playground?.airspace;
    if (!api) return;
    void api.setAdblock(useAirspaceStore.getState().adblock).then((st) => {
      if (st) setAdsBlocked(st.blocked);
    });
  }, []);

  // Persisted Cinema/Music voicing re-applies once the browser exists.
  useEffect(() => {
    useAirspaceStore.getState().applyAirModeNow();
  }, []);

  // Hand the (persistent) webview to the media bridge: the transport-bar deck
  // and the source arbiter read/drive the page's video through it.
  useEffect(() => {
    registerAirspaceWebview(webviewRef.current);
    return () => registerAirspaceWebview(null);
  }, []);
  useEffect(() => {
    const api = window.playground?.airspace;
    if (!api || !visible) return;
    let alive = true;
    const poll = async () => {
      try {
        const st = await api.getAdblockStatus();
        if (alive && st) setAdsBlocked(st.blocked);
      } catch { /* main process busy */ }
    };
    void poll();
    const id = window.setInterval(poll, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, [visible, adblock]);

  const syncNav = useCallback(() => {
    const el = webviewRef.current;
    if (!el || !domReady.current) return;
    try {
      setCanBack(el.canGoBack());
      setCanForward(el.canGoForward());
    } catch { /* guest not ready yet */ }
  }, []);

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;
    const onDomReady = () => {
      domReady.current = true;
      syncNav();
    };
    const onStartLoading = () => setLoading(true);
    const onStopLoading = () => {
      setLoading(false);
      syncNav();
    };
    const onNavigate = (e: Event) => {
      const url = (e as Event & { url?: string }).url;
      if (url && /^https?:\/\//i.test(url)) {
        setUrlInput(url);
        setLastUrl(url);
      }
      syncNav();
    };
    const onTitle = (e: Event) => {
      const title = (e as Event & { title?: string }).title;
      if (title) setPageTitle(title);
    };
    const onFailLoad = (e: Event) => {
      setLoading(false);
      const { errorCode, errorDescription, isMainFrame } =
        e as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      // -3 = ERR_ABORTED (fires on normal in-page redirects) — not an error.
      if (isMainFrame && errorCode !== undefined && errorCode !== -3) {
        toast(`Page failed to load (${errorDescription || errorCode})`);
      }
    };
    // A crashed guest (heavy video pages + capture) leaves a dead grey
    // webview forever — reload it so browsing recovers on its own, and
    // raise a Mission HUD issue so the crash isn't silent (v2.4).
    const onGuestGone = () => {
      void import("@/lib/appHealth").then(({ reportWebviewCrash }) =>
        reportWebviewCrash(),
      );
      window.setTimeout(() => {
        try { el.reload(); } catch { /* element detached */ }
      }, 400);
    };
    el.addEventListener("dom-ready", onDomReady);
    el.addEventListener("did-start-loading", onStartLoading);
    el.addEventListener("did-stop-loading", onStopLoading);
    el.addEventListener("did-navigate", onNavigate);
    el.addEventListener("did-navigate-in-page", onNavigate);
    el.addEventListener("page-title-updated", onTitle);
    el.addEventListener("did-fail-load", onFailLoad);
    el.addEventListener("render-process-gone", onGuestGone);
    el.addEventListener("crashed", onGuestGone);
    return () => {
      el.removeEventListener("dom-ready", onDomReady);
      el.removeEventListener("did-start-loading", onStartLoading);
      el.removeEventListener("did-stop-loading", onStopLoading);
      el.removeEventListener("did-navigate", onNavigate);
      el.removeEventListener("did-navigate-in-page", onNavigate);
      el.removeEventListener("page-title-updated", onTitle);
      el.removeEventListener("did-fail-load", onFailLoad);
      el.removeEventListener("render-process-gone", onGuestGone);
      el.removeEventListener("crashed", onGuestGone);
    };
  }, [syncNav, setLastUrl, toast]);

  const navigate = useCallback((raw: string) => {
    const url = normalizeInput(raw);
    const el = webviewRef.current;
    if (!url || !el) return;
    el.loadURL(url).catch((err: unknown) => {
      console.warn("[airspace] loadURL failed:", err);
    });
  }, []);

  const engageRouting = useCallback(async () => {
    await ensureReady();
    const source = useSettingsStore.getState().audioInputSource;
    // Prefer direct per-frame capture of THIS webview; startLoopback falls
    // back to the virtual-cable / system-loopback paths when unavailable.
    const ok = await startLoopback(source || undefined, "airspace");
    if (!ok) {
      toast("Couldn't engage capture. Check Settings → Audio Routing.");
      return;
    }
    const mode = usePlayerStore.getState().loopbackMode;
    if (mode === "airspace") {
      toast("Routed through Kill-Chain - direct capture. You hear only this browser's audio, fully EQ'd.");
    } else if (mode === "device") {
      toast("Routed through Kill-Chain via your virtual cable.");
    } else if (mode === "loopbackWithMute") {
      toast("Routed through Kill-Chain - direct Windows output muted, you hear only the processed feed.");
    } else {
      toast("Routed through Kill-Chain. Processed feed is layered under direct audio - see Settings → Audio Routing for the zero-double-audio setup.");
    }
  }, [ensureReady, startLoopback, toast]);

  const routeStatus = !loopbackActive
    ? null
    : loopbackMode === "airspace"
      ? "DIRECT CAPTURE - this browser only, EQ'd feed only"
      : loopbackMode === "loopbackWithMute"
        ? "EXCLUSIVE - Windows output muted, EQ'd feed only"
        : loopbackMode === "device"
          ? "VIRTUAL CABLE - full quality, zero feedback"
          : "LAYERED - processed feed under direct audio";

  const isHttps = /^https:\/\//i.test(urlInput);

  // Picture-in-picture (issue #6): when the user leaves the tab with PiP on,
  // the SAME mounted webview shrinks into a floating mini window instead of
  // hiding — so you can see your video swap to an ad, click through, etc.
  // The element is never unmounted, so playback and logins are untouched.
  const pipMode = !visible && pip;

  const containerClass = visible
    ? "absolute inset-0 z-20 flex flex-col gap-2 px-4 pt-2 pb-2"
    : pipMode
      ? "fixed bottom-24 right-5 z-40 w-[380px] flex flex-col rounded-2xl border border-white/15 shadow-[0_18px_50px_rgba(0,0,0,0.6)] overflow-hidden bg-black/95"
      : "absolute inset-0 -z-10 opacity-0 pointer-events-none overflow-hidden flex flex-col gap-2 px-4 pt-2 pb-2";

  return (
    <div aria-hidden={!visible && !pipMode} className={containerClass}>
      {/* Header: title + route-through banner (full view only) */}
      {!pipMode && (
        <div className="glass-strong rounded-2xl px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] tracking-[0.4em] uppercase text-white/40">
              Airspace · in-app browser
            </div>
            <div className="text-sm font-medium text-white/90 truncate" title={pageTitle}>
              {pageTitle || "—"}
            </div>
          </div>

          {loopbackActive ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">
                  {routeStatus}
                </span>
              </div>
              <NeonButton
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  stopLoopback();
                  toast("Kill-Chain routing disengaged");
                }}
              >
                Disengage
              </NeonButton>
            </div>
          ) : (
            <NeonButton
              className="text-xs"
              onClick={() => void engageRouting()}
              title="Capture this browser's audio and pipe it through the full EQ / FX chain (you'll hear only the processed feed)"
            >
              ⦿ Route through Kill-Chain
            </NeonButton>
          )}
        </div>
      )}

      {/* Toolbar: nav buttons + URL bar (full view only) */}
      {!pipMode && (
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-2 shrink-0">
          <button
            className={`btn-ghost text-sm px-2 ${canBack ? "" : "opacity-30 pointer-events-none"}`}
            onClick={() => webviewRef.current?.goBack()}
            title="Back"
          >
            ←
          </button>
          <button
            className={`btn-ghost text-sm px-2 ${canForward ? "" : "opacity-30 pointer-events-none"}`}
            onClick={() => webviewRef.current?.goForward()}
            title="Forward"
          >
            →
          </button>
          <button
            className="btn-ghost text-sm px-2"
            onClick={() => {
              if (loading) webviewRef.current?.stop();
              else webviewRef.current?.reload();
            }}
            title={loading ? "Stop loading" : "Reload"}
          >
            {loading ? "✕" : "↻"}
          </button>

          <form
            className="flex-1 min-w-[200px] flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(urlInput);
            }}
          >
            <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-1.5 focus-within:border-white/25 transition">
              <span
                className={`text-[10px] ${isHttps ? "text-emerald-400" : "text-dim"}`}
                title={isHttps ? "Secure connection" : "Not HTTPS"}
              >
                {isHttps ? "🔒" : "○"}
              </span>
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onFocus={(e) => e.target.select()}
                spellCheck={false}
                placeholder="Enter URL or search…"
                className="flex-1 bg-transparent outline-none text-xs text-white/90 placeholder:text-white/25"
              />
              {loading && (
                <span className="w-3 h-3 rounded-full border border-cyan-300/70 border-t-transparent animate-spin shrink-0" />
              )}
            </div>
          </form>

          {/* Cinema / Music voicing — media-type DSP for the browser */}
          <div className="kc-seg">
            {(["off", "cinema", "music"] as AirMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (m === airMode) return;
                  setAirMode(m);
                  toast(
                    m === "off"
                      ? "Airspace voicing off — sound untouched"
                      : m === "cinema"
                        ? "Cinema mode — dialog, impact and stage voiced for film"
                        : "Music mode — punch, air and balance voiced for music",
                  );
                }}
                className={`kc-seg-btn ${airMode === m ? "kc-on" : ""}`}
                title={
                  m === "off"
                    ? "No extra voicing"
                    : m === "cinema"
                      ? "Voice the sound for movies & TV (dialog clarity, LFE impact, wide stage)"
                      : "Voice the sound for music (punch, air, balance)"
                }
              >
                {m === "off" ? "○" : m === "cinema" ? "🎬 Cinema" : "♫ Music"}
              </button>
            ))}
          </div>

          {/* AdBlock (issue #8) — network-layer blocking in the main process */}
          <button
            onClick={() => {
              setAdblock(!adblock);
              toast(adblock ? "AdBlock disengaged" : "AdBlock engaged — ads and trackers are intercepted");
            }}
            className={`kc-btn kc-btn--sm kc-btn--ghost ${adblock ? "kc-on" : ""}`}
            title={
              adblock
                ? `AdBlock on — ${adsBlocked} requests shot down this session. Blocks ad/tracker domains network-wide; some in-player video ads (e.g. YouTube) are served from the same servers as the video and can slip through.`
                : "AdBlock off — click to block ad and tracker requests inside Airspace"
            }
          >
            {adblock ? `⛨ ${adsBlocked}` : "⛨ off"}
          </button>

          {/* Mission Log: save the current chain for this video / stream */}
          <button
            onClick={() => {
              void import("@/state/missionLogStore").then(async (m) => {
                const name = await m.logCurrentSource();
                if (name) toast(`◎ Logged chain for "${name}"`);
                else toast("Route audio through Kill-Chain and start playback first");
              });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMissionLogOpen(true);
            }}
            className="kc-btn kc-btn--sm kc-btn--accent"
            title="Log the current chain to the Mission Log for this video/stream — restored automatically next time it plays. Right-click to browse the log."
          >
            ◎ Log
          </button>

          {/* PiP toggle (issue #6) */}
          <button
            onClick={() => {
              setPip(!pip);
              toast(pip ? "Picture-in-picture off" : "Picture-in-picture on — leave this tab to see the mini view");
            }}
            className={`kc-btn kc-btn--sm kc-btn--ghost ${pip ? "kc-on" : ""}`}
            title="Picture-in-picture: keep a floating mini view of this browser while you work in other tabs"
          >
            ⧉ PiP
          </button>

          <button
            className="btn-ghost text-sm px-2"
            onClick={() => {
              const el = webviewRef.current;
              if (!el) return;
              try {
                const url = el.getURL();
                addBookmark(pageTitle || url, url);
                toast("Bookmarked");
              } catch { /* guest not ready */ }
            }}
            title="Bookmark current page"
          >
            ☆
          </button>
        </div>
      )}

      {/* Per-mode options (full view only, when a voicing mode is active) */}
      {!pipMode && airMode !== "off" && (
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-2 shrink-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.25em] text-dim shrink-0">
            {airMode === "cinema" ? "Cinema options" : "Music options"}
          </span>
          {optionsForMode(airMode).map((opt) => {
            const on = airOpts[opt.id] ?? opt.defaultOn;
            return (
              <button
                key={opt.id}
                onClick={() => setAirOpt(opt.id, !on)}
                data-ui-sound="toggle"
                data-ui-on={on ? "true" : "false"}
                className={`kc-chip ${on ? "kc-on" : ""}`}
                title={opt.desc}
              >
                {on ? "●" : "○"} {opt.label}
              </button>
            );
          })}
          {!loopbackActive && (
            <span className="text-[10px] text-amber-300/80 ml-1">
              Route through Kill-Chain to hear the voicing on this browser's audio.
            </span>
          )}
        </div>
      )}

      {/* Quick-launch bookmarks (full view only) */}
      {!pipMode && (
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap px-1">
          {bookmarks.map((b) => (
            <span key={b.id} className="group relative inline-flex">
              <button
                onClick={() => navigate(b.url)}
                className="kc-chip"
                title={b.url}
              >
                {b.label}
              </button>
              <button
                onClick={() => removeBookmark(b.id)}
                className="absolute -top-1.5 -right-1.5 hidden group-hover:grid place-items-center w-3.5 h-3.5 rounded-full bg-black/80 border border-white/20 text-[8px] text-white/70 hover:text-red-300"
                title="Remove bookmark"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* PiP mini header */}
      {pipMode && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.04] border-b border-white/10 shrink-0">
          {loopbackActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Routed through Kill-Chain" />
          )}
          <span className="flex-1 min-w-0 text-[10px] text-white/70 truncate" title={pageTitle}>
            {pageTitle || "Airspace"}
          </span>
          <button
            onClick={() => setView("airspace")}
            className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/60 hover:text-cyan hover:border-cyan/40 transition"
            title="Back to the full Airspace view"
          >
            ⤢
          </button>
          <button
            onClick={() => setPip(false)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/60 hover:text-rose-300 hover:border-rose-400/40 transition"
            title="Hide the mini view (audio keeps playing). Re-enable from the Airspace toolbar."
          >
            ✕
          </button>
        </div>
      )}

      {/* The guest page. persist: partition keeps logins across launches;
          node/context settings are force-hardened in main via
          will-attach-webview. This wrapper (and the webview inside) is the
          SAME element in full, PiP and hidden modes — only its size changes. */}
      <div
        className={
          pipMode
            ? "w-full h-[214px] bg-black shrink-0"
            : "flex-1 min-h-0 rounded-2xl overflow-hidden border border-white/10 bg-black/40"
        }
      >
        <webview
          ref={(node) => {
            webviewRef.current = node as WebviewElement | null;
          }}
          src={initialUrl}
          partition="persist:airspace"
          allowpopups={true}
          className="w-full h-full"
          style={{ display: "flex", width: "100%", height: "100%" }}
        />
      </div>

      {missionLogOpen && <MissionLogPanel onClose={() => setMissionLogOpen(false)} />}
    </div>
  );
}
