import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { usePlayerStore } from "@/state/playerStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useAirspaceStore } from "@/state/airspaceStore";
import { useCoverStore } from "@/state/coverStore";
import { pathFromAudioSrc, useLibraryStore } from "@/state/libraryStore";
import { NeonButton } from "@/components/shared/NeonButton";
import { playUi } from "@/audio/uiSounds";
import {
  seekAirspaceMedia,
  setAirspaceMediaVolume,
  toggleAirspaceMedia,
} from "@/lib/airspaceMedia";
import { claimSource } from "@/lib/sourceArbiter";
import { useAppliedTractor } from "@/lib/tractorApplied";

export function TransportBar() {
  const status = usePlayerStore((s) => s.status);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const fileName = usePlayerStore((s) => s.fileName);
  const metadata = usePlayerStore((s) => s.metadata);
  const src = usePlayerStore((s) => s.src);
  const volume = usePlayerStore((s) => s.volume);
  const loopMode = usePlayerStore((s) => s.loopMode);
  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  const loopbackMode = usePlayerStore((s) => s.loopbackMode);
  const toggle = usePlayerStore((s) => s.toggle);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleLoop = usePlayerStore((s) => s.toggleLoop);
  const loadBlob = usePlayerStore((s) => s.loadBlob);
  const loadPath = usePlayerStore((s) => s.loadDataUrlOrPath);
  const startLoopback = usePlayerStore((s) => s.startLoopback);
  const stopLoopback = usePlayerStore((s) => s.stopLoopback);
  const ensureReady = useAudioStore((s) => s.ensureReady);
  const bypass = useAudioStore((s) => s.bypass);
  const toggleBypass = useAudioStore((s) => s.toggleBypass);
  const toast = useUIStore((s) => s.toast);
  const setView = useUIStore((s) => s.setView);
  const airMedia = useAirspaceStore((s) => s.media);

  const openFile = async () => {
    await ensureReady();
    if (typeof window !== "undefined" && window.playground?.openAudioFile) {
      const p = await window.playground.openAudioFile();
      if (p) {
        // Use the custom `playground-audio://` scheme registered in the
        // Electron main process. The file path travels as a single URL-
        // encoded query parameter so Chromium's standard-scheme URL parser
        // can't mangle Windows drive letters: a path-style URL like
        // `playground-audio:///C:/...` gets normalised to `playground-
        // audio://c/...` (host=c) and silently loses the drive prefix,
        // which only happens to work on drive C: by accident.
        const url = `playground-audio:///load?p=${encodeURIComponent(p)}`;
        await loadPath(url, p.split(/[\\/]/).pop() || "Track");
      }
    } else {
      // Browser fallback
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.onchange = async () => {
        const f = input.files?.[0];
        if (f) await loadBlob(f, f.name);
      };
      input.click();
    }
  };

  // ── Airspace deck ──
  // When the in-app browser has media and the local player isn't actively
  // playing a file, the transport bar becomes the deck for THAT media:
  // thumbnail, title, real scrubbing, play/pause and volume all drive the
  // page's video. While Airspace is ROUTED through the chain (direct
  // capture), the deck stays in charge too — pause/scrub act on the video
  // itself while the capture keeps flowing.
  const deck =
    airMedia != null &&
    (loopbackMode === "airspace" ||
      (status !== "playing" && (status === "empty" || !airMedia.paused)));

  const shownPos = deck ? airMedia.currentTime : position;
  const shownDur = deck ? airMedia.duration : duration;
  const pct = shownDur > 0 ? (shownPos / shownDur) * 100 : 0;
  const isPlaying = deck ? !airMedia.paused : status === "playing";

  // Now-playing album art via the shared lazy cover cache (keyed by file path).
  const coverPath = pathFromAudioSrc(src);
  const libCover = useCoverStore((s) => (coverPath ? s.covers[coverPath] : undefined));
  const requestCover = useCoverStore((s) => s.requestCover);
  const inLibrary = useLibraryStore((s) => !!(coverPath && s.tracks.some((t) => t.path === coverPath)));
  useEffect(() => {
    if (coverPath) requestCover(coverPath);
  }, [coverPath, requestCover]);
  const localCover = (libCover && libCover.length > 0 ? libCover : null) ?? metadata.coverUrl;
  const cover = deck ? airMedia.artwork : localCover;

  const hasTrack = deck || status !== "empty";
  const npTitle = deck
    ? airMedia.title || "Airspace"
    : metadata.title || fileName || "No track loaded";
  const npSub = deck
    ? `Airspace · ${airMedia.artist}`
    : metadata.artist || (hasTrack ? "Unknown artist" : "Load a track to begin");

  return (
    <div className="px-4 pb-4">
      <div className="glass-strong rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Now playing — always visible so you know what's loaded. The
            artwork wears an accent ring that breathes with the signal while
            playback is live (rides --beat-glow, zero JS cost). */}
        <div
          className={`flex items-center gap-2.5 min-w-0 w-[210px] shrink-0 ${
            deck || inLibrary ? "cursor-pointer" : ""
          }`}
          onClick={() => {
            if (deck) {
              setView("airspace");
              return;
            }
            if (coverPath && inLibrary) {
              setView("library");
              useLibraryStore.getState().revealTrack(coverPath);
            }
          }}
          title={
            deck
              ? "Playing in Airspace — click to open the browser"
              : inLibrary
                ? "Show this track in Library"
                : undefined
          }
        >
          <div
            className="relative w-11 h-11 rounded-xl border border-white/10 bg-white/[0.04] shrink-0 grid place-items-center text-base text-dim overflow-hidden"
            style={{
              ...(cover
                ? { background: `center/cover no-repeat url("${cover}")` }
                : {}),
              ...(isPlaying
                ? {
                    boxShadow:
                      "0 0 0 1px rgb(var(--c-cyan) / calc(0.3 + var(--beat-glow, 0) * 0.4)), 0 0 calc(14px * var(--glow)) rgb(var(--c-cyan) / calc(0.5 * var(--glow)))",
                  }
                : {}),
            }}
          >
            {!cover && (deck ? "▶" : "♪")}
            {deck && (
              <span className="absolute bottom-0 inset-x-0 bg-cyan/80 text-black text-[7px] font-bold uppercase tracking-[0.2em] text-center leading-[10px]">
                Airspace
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-white/90 truncate" title={npTitle}>
              {npTitle}
            </div>
            <div className="text-[10px] text-dim truncate" title={npSub}>
              {npSub}
            </div>
          </div>
          <TractorStatusChip />
        </div>

        <NeonButton onClick={openFile} variant="ghost" className="text-xs">
          + Load Track
        </NeonButton>

        {loopbackActive && loopbackMode === "loopback" && (
          <NeonButton
            variant="ghost"
            className="text-xs"
            onClick={() => {
              // Panic mute - drop the master to dead silence for 1.5s.
              const a = useAudioStore.getState();
              const restore = a.outputGainDb;
              a.setOutputGain(-60);
              setTimeout(() => {
                // Only restore if nothing else moved the gain in the window —
                // a stale restore used to stomp loopback teardown's own gain.
                if (useAudioStore.getState().outputGainDb === -60) {
                  useAudioStore.getState().setOutputGain(restore);
                }
              }, 1500);
              toast("Feedback cut — output muted for 1.5 s");
            }}
            title="Hard mute the output for 1.5 seconds to kill a feedback ring"
          >
            Cut Feedback
          </NeonButton>
        )}

        <NeonButton
          variant="ghost"
          active={loopbackActive}
          className="text-xs"
          onClick={async () => {
            await ensureReady();
            if (loopbackActive) {
              stopLoopback();
              toast("Exterior audio disabled");
            } else {
              const source = useSettingsStore.getState().audioInputSource;
              const ok = await startLoopback(source || undefined);
              if (ok) {
                if (source) {
                  toast(
                    "Exterior audio on - routed through your virtual cable. " +
                    "Set Windows default output to CABLE Input to capture everything.",
                  );
                } else if (usePlayerStore.getState().loopbackMode === "loopbackWithMute") {
                  toast(
                    "Exterior audio on - Windows output muted. " +
                    "You hear ONLY the processed feed on your chosen device.",
                  );
                } else {
                  // Legacy system-loopback path - warn about feedback.
                  let separateDeviceAvailable = false;
                  try {
                    const all = await navigator.mediaDevices.enumerateDevices();
                    separateDeviceAvailable =
                      all.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
                        .length > 1;
                  } catch { /* ignore */ }
                  const sinkId = useSettingsStore.getState().audioOutputDeviceId;
                  if (sinkId) {
                    toast("Exterior audio on - routed through your chosen output");
                  } else if (separateDeviceAvailable) {
                    toast(
                      "Exterior audio on. For zero feedback, install VB-Cable " +
                      "from Settings → Audio Routing (free, ~5 MB).",
                    );
                  } else {
                    toast(
                      "Exterior audio on. Install VB-Cable from Settings → " +
                      "Audio Routing for system-wide DSP with NO feedback.",
                    );
                  }
                }
              } else {
                toast(
                  "Couldn't enable exterior audio. " +
                  "If using a virtual cable, check it's still installed and selected in Settings.",
                );
              }
            }
          }}
          title={
            loopbackActive
              ? "Stop processing system audio"
              : "Pipe Windows / browser / game audio through the lab. " +
                "Use a virtual cable (Settings → Audio Routing) for zero feedback."
          }
        >
          {loopbackActive ? "Disable Exterior Audio" : "Enable Exterior Audio"}
        </NeonButton>

        {/* Primary transport control — one round, accent-lit play/pause. */}
        <button
          onClick={async () => {
            if (deck) {
              playUi("press");
              // Starting Airspace playback stands the other sources down.
              if (airMedia.paused) claimSource("airspace");
              await toggleAirspaceMedia();
              return;
            }
            if (!hasTrack) {
              playUi("denied");
              toast("Load a track first — hit “+ Load Track” or drop a file anywhere");
              return;
            }
            playUi("press");
            await ensureReady();
            await toggle();
          }}
          data-ui-sound="none" // voiced in the handler: press when a track is loaded, denied buzz otherwise
          className={`kc-btn kc-btn--primary !rounded-full !p-0 w-11 h-11 shrink-0 ${hasTrack ? "" : "opacity-45"}`}
          title={
            deck
              ? "Play / pause the media in Airspace"
              : hasTrack
                ? "Play / pause (Space)"
                : "No track loaded yet"
          }
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M8 5.4v13.2c0 .9 1 1.5 1.8 1L19 13a1.2 1.2 0 0 0 0-2L9.8 4.4c-.8-.5-1.8.1-1.8 1Z" />
            </svg>
          )}
        </button>

        {!deck && (
          <button
            onClick={() => toggleLoop()}
            className={`kc-btn kc-btn--ghost kc-btn--sm ${loopMode !== "off" ? "kc-on" : ""}`}
            title={
              loopMode === "off"
                ? "Loop off — click to loop the queue"
                : loopMode === "queue"
                  ? "Looping the queue — click to loop this track"
                  : "Looping this track — click to turn off"
            }
          >
            {loopMode === "track" ? "↻ Track" : loopMode === "queue" ? "↻ Queue" : "↻ Loop"}
          </button>
        )}

        <div className="flex-1 flex items-center gap-3">
          <span className="text-[11px] font-mono text-dim w-12 tabular-nums">
            {fmt(shownPos)}
          </span>
          <ScrubBar
            pct={pct}
            duration={shownDur}
            onSeek={deck ? seekAirspaceMedia : seek}
          />
          <span className="text-[11px] font-mono text-dim w-12 tabular-nums text-right">
            {deck && airMedia.live ? "LIVE" : fmt(shownDur)}
          </span>
        </div>

        <div className="flex items-center gap-2 w-40">
          <span className="text-[10px] uppercase text-dim tracking-widest">
            Vol
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={deck ? airMedia.volume : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (deck) setAirspaceMediaVolume(v);
              else setVolume(v);
            }}
            className="kc-slider w-full"
            style={{ ["--kc-fill" as string]: `${(deck ? airMedia.volume : volume) * 100}%` }}
            title={deck ? "Volume of the Airspace media" : "Player volume"}
          />
        </div>

        {/* Chain state — engaging replays the KCDS breach pulse. */}
        <button
          onClick={toggleBypass}
          data-ui-sound="none" // voiced centrally: bypass change plays engage/disengage
          className={`kc-btn kc-btn--sm relative font-mono tracking-[0.14em] ${
            bypass ? "kc-btn--danger" : "kc-btn--ghost text-lime border-lime/30 bg-lime/5"
          }`}
          title="A/B bypass entire DSP chain"
        >
          {!bypass && <span key="engaged" className="kc-breach" aria-hidden />}
          {bypass ? "BYPASSED" : "ENGAGED"}
        </button>
      </div>
    </div>
  );
}

/**
 * Seek bar with true drag-to-scrub (pointer capture) and a hover time bubble.
 * The old bar was click-only, which felt broken when you tried to drag it.
 */
function ScrubBar({
  pct,
  duration,
  onSeek,
}: {
  pct: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Ref mirrors the scrub flag: setState is async, so the pointermoves that
  // arrive before the re-render were dropped and drag-scrub felt dead until
  // the first repaint.
  const scrubbingRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);

  const frac = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const hoverFrac = hoverX != null ? frac(hoverX) : null;

  return (
    <div
      ref={barRef}
      className="group/scrub relative h-2 flex-1 rounded-full bg-white/[0.06] cursor-pointer"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        if (duration <= 0) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        scrubbingRef.current = true;
        setScrubbing(true);
        onSeek(frac(e.clientX) * duration);
      }}
      onPointerMove={(e) => {
        setHoverX(e.clientX);
        if (scrubbingRef.current && duration > 0) onSeek(frac(e.clientX) * duration);
      }}
      onPointerUp={(e) => {
        try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        scrubbingRef.current = false;
        setScrubbing(false);
      }}
      onPointerCancel={() => { scrubbingRef.current = false; setScrubbing(false); }}
      onPointerLeave={() => { if (!scrubbingRef.current) setHoverX(null); }}
    >
      <div className="absolute inset-0 rounded-full overflow-hidden">
        <motion.div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, rgb(var(--c-cyan)), rgb(var(--c-violet)))",
            boxShadow: "0 0 18px rgb(var(--c-violet) / 0.55)",
          }}
          transition={{ ease: "linear", duration: 0.12 }}
        />
      </div>
      {/* Playhead grab handle — grows on hover so it's clearly draggable */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white transition-all ${
          scrubbing ? "w-3.5 h-3.5" : "w-0 h-0 group-hover/scrub:w-3 group-hover/scrub:h-3"
        }`}
        style={{ left: `${pct}%`, boxShadow: "0 0 10px rgb(var(--c-violet) / 0.8)" }}
      />
      {/* Hover time bubble */}
      {hoverFrac != null && duration > 0 && (
        <div
          className="absolute bottom-full mb-2 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-black/85 border border-white/15 text-[10px] font-mono text-white/90 pointer-events-none whitespace-nowrap"
          style={{ left: `${hoverFrac * 100}%` }}
        >
          {fmt(hoverFrac * duration)}
        </div>
      )}
    </div>
  );
}

function fmt(t: number): string {
  if (!isFinite(t) || t <= 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** v2.3 — live Tractor lock status, visible outside the Tractor view. */
function TractorStatusChip() {
  const applied = useAppliedTractor();
  const setView = useUIStore((s) => s.setView);
  if (!applied) return null;
  const pct = applied.matchPct;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setView("tractor");
      }}
      className="shrink-0 flex items-center gap-1 rounded-full border border-cyan/35 bg-cyan/[0.08] px-2 py-0.5 hover:bg-cyan/[0.15] transition"
      title={`Tractor lock engaged${applied.sourceName ? ` — ${applied.sourceName}` : ""}${
        applied.contentLabel ? ` (${applied.contentLabel})` : ""
      }${pct != null ? ` · ${pct}% match` : ""} — click to open Tractor Beam`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse" style={{ boxShadow: "0 0 6px rgb(var(--c-cyan))" }} />
      <span className="text-[9px] font-mono font-semibold text-cyan tabular-nums">
        TB{pct != null ? ` ${pct}%` : ""}
      </span>
    </button>
  );
}
