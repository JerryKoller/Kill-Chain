import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEngine } from "@/audio/AudioEngine";
import { usePlayerStore } from "@/state/playerStore";
import { useSettingsStore } from "@/state/settingsStore";
import {
  useVisualizerStore,
  VISUALIZER_MODES,
  type VisualizerMode,
} from "@/state/visualizerStore";
import {
  drawEngagePulse,
  drawTacticalFrame,
  type ModeRenderer,
  type RenderFrame,
  type ThemePalette,
  type RGB,
} from "./renderers";
import { createModeRenderer } from "./modeFactory";
import { getVisualIntel } from "./visualIntel";
import {
  isBroadcasting,
  onBroadcastChange,
  startBroadcast,
  stopBroadcast,
} from "@/lib/vizBroadcast";

/**
 * Full-panel visualizer for the Library — a portal overlay that fills the
 * workspace (everything below the title bar) with a canvas fed from the
 * shared post-chain analyser. One RAF loop runs only while the overlay is
 * mounted AND the document is visible; it pauses cleanly otherwise.
 */

const IDLE_HIDE_MS = 2600;
/** Backing-store resolution cap — 4K+ hiDPI canvases melt fill-rate. */
const MAX_DPR = 2;

// ── theme palette (read from CSS custom properties once per mount) ──────────

function cssRgb(styles: CSSStyleDeclaration, name: string, fallback: RGB): RGB {
  const raw = styles.getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/).map((p) => Number(p));
  if (parts.length < 3 || parts.some((n) => !isFinite(n))) return fallback;
  return [parts[0], parts[1], parts[2]];
}

function readPalette(): ThemePalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    cyan: cssRgb(styles, "--c-cyan", [84, 180, 214]),
    plasma: cssRgb(styles, "--c-plasma", [255, 64, 64]),
    violet: cssRgb(styles, "--c-violet", [122, 92, 255]),
    lime: cssRgb(styles, "--c-lime", [95, 211, 138]),
    amber: cssRgb(styles, "--c-amber", [255, 176, 72]),
    ink: cssRgb(styles, "--c-ink", [7, 8, 11]),
  };
}

interface RendererSlot {
  r: ModeRenderer;
  /** Size the renderer was last resize()d at — re-sync lazily on demand. */
  w: number;
  h: number;
}

export function VisualizerOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const mode = useVisualizerStore((s) => s.mode);
  const setMode = useVisualizerStore((s) => s.setMode);
  const cycleMode = useVisualizerStore((s) => s.cycleMode);
  const setOpen = useVisualizerStore((s) => s.setOpen);

  const title = usePlayerStore(
    (s) => s.metadata.title ?? s.fileName ?? "NO SIGNAL",
  );
  const artist = usePlayerStore((s) => s.metadata.artist);
  const playing = usePlayerStore((s) => s.status === "playing");
  const loopback = usePlayerStore((s) => s.loopbackActive);

  // Latest title, readable from inside the RAF loop without re-registering it
  // (the Reactor's matrix core flashes shards of it).
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title === "NO SIGNAL" ? "" : title;
  }, [title]);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const idleTimer = useRef<number>(0);

  // ── broadcast mode (second-window) state ──
  const [broadcasting, setBroadcasting] = useState(isBroadcasting);
  const [bcOpen, setBcOpen] = useState(false);
  const [displays, setDisplays] = useState<VizDisplayInfo[]>([]);
  const [bcDisplayId, setBcDisplayId] = useState<number | undefined>(undefined);
  const [bcFullscreen, setBcFullscreen] = useState(false);
  const [bcOnTop, setBcOnTop] = useState(true);
  const [bcTransparent, setBcTransparent] = useState(false);

  // v1.8: pre/post-chain comparison inset + low-rate intel HUD readout
  const [abCompare, setAbCompare] = useState(false);
  const abCompareRef = useRef(false);
  useEffect(() => {
    abCompareRef.current = abCompare;
  }, [abCompare]);
  const [hudIntel, setHudIntel] = useState({ bpm: 0, section: "idle" });
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = getVisualIntel().snapshot;
      setHudIntel((prev) => {
        const bpm = s.bpmConf > 0.2 ? Math.round(s.bpm) : 0;
        if (prev.bpm === bpm && prev.section === s.section) return prev;
        return { bpm, section: s.section };
      });
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => onBroadcastChange(setBroadcasting), []);
  useEffect(() => {
    if (!bcOpen) return;
    void window.playground?.viz?.displays().then((d) => setDisplays(d ?? []));
  }, [bcOpen]);

  // Reduced motion: calmer default mode + toned-down renderers. Honors BOTH
  // the OS setting and the in-app Settings → Reduce motion override.
  const reducedRef = useRef(false);
  const forceReduced = useSettingsStore((s) => s.forceReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches || forceReduced;
    if (reducedRef.current) setMode("spectrum");
    const onChange = (e: MediaQueryListEvent) => {
      reducedRef.current = e.matches || forceReduced;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setMode, forceReduced]);

  // NOTE: the "sync the store on unmount" cleanup lives in LibraryView, not
  // here — a self-closing cleanup on this component trips React StrictMode's
  // simulated remount (mount → cleanup → mount) and instantly setOpen(false)s
  // the overlay it belongs to, so it could never open in dev.

  // ── auto-fading controls ──
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const poke = () => {
      setControlsVisible(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(
        () => setControlsVisible(false),
        IDLE_HIDE_MS,
      );
    };
    poke();
    root.addEventListener("pointermove", poke);
    root.addEventListener("pointerdown", poke);
    return () => {
      window.clearTimeout(idleTimer.current);
      root.removeEventListener("pointermove", poke);
      root.removeEventListener("pointerdown", poke);
    };
  }, []);

  // ── keyboard: ←/→ cycle modes, Esc closes (capture phase so the global
  //    seek hotkeys never see the arrows while the visualizer is up) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        // Immediate: the global seek-hotkey listener also lives on window.
        e.stopImmediatePropagation();
        useVisualizerStore.getState().cycleMode(e.key === "ArrowRight" ? 1 : -1);
        setControlsVisible(true);
        window.clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(
          () => setControlsVisible(false),
          IDLE_HIDE_MS,
        );
      } else if (e.key === "Escape") {
        // In fullscreen, Esc is the native exit — don't also close the panel.
        if (document.fullscreenElement) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        useVisualizerStore.getState().setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // ── fullscreen ──
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void rootRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  // ── the render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    // Opaque backing store: skips per-frame alpha compositing with the page.
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) return;

    const engine = getEngine();
    engine.ensureLufsMeter(); // ref-counted CPU meter for the Reactor core

    // THE shared analysis pipeline — the intel service owns every analyser
    // pull and detector; this loop only reads its snapshot.
    const intel = getVisualIntel();
    intel.start();
    const binCount = intel.binCount;
    const sampleRate = intel.sampleRate;
    const palette = readPalette();

    // Pre-chain inset buffer (display-only read of the existing pre analyser;
    // pulled ONLY while the A/B inset is open).
    const preAnalyser = engine.analyserPre;
    const preFreq = new Uint8Array(preAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    const slots = new Map<VisualizerMode, RendererSlot>();
    const getSlot = (m: VisualizerMode): RendererSlot => {
      let s = slots.get(m);
      if (!s) {
        s = { r: createModeRenderer(m, palette, binCount, sampleRate), w: -1, h: -1 };
        slots.set(m, s);
      }
      return s;
    };

    // The one mutable frame bag — reused every tick, never reallocated.
    const frame: RenderFrame = {
      g,
      W: 0,
      H: 0,
      freq: intel.freq,
      time: intel.time,
      binCount,
      sampleRate,
      dt: 1 / 60,
      now: 0,
      rms: 0,
      low: 0,
      mid: 0,
      high: 0,
      centroid: 0,
      beatHit: false,
      beat: 0,
      lufs: -120,
      title: "",
      reduced: false,
      intel: intel.snapshot,
    };

    // DPR-aware sizing via ResizeObserver (canvas fills the overlay).
    let cssW = 0;
    let cssH = 0;
    const applySize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 1 || rect.height < 1) return;
      cssW = rect.width;
      cssH = rect.height;
      applySize();
    });
    ro.observe(root);
    const rect0 = root.getBoundingClientRect();
    cssW = rect0.width;
    cssH = rect0.height;
    applySize();

    // Adaptive degrade: when the average draw cost climbs past ~14 ms we
    // render every other RAF tick (skip frames, never accumulate work).
    let drawCostEma = 0;
    let halfRate = false;
    let parity = 0;

    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      parity ^= 1;
      if (halfRate && parity === 1) return;

      const dtMs = last === 0 ? 16.7 : now - last;
      last = now;
      if (dtMs < 4) return; // duplicate RAF burst — skip, don't double-draw
      const t0 = performance.now();

      if (cssW < 2 || cssH < 2) return;

      // ── ONE analysis pass (shared intel pipeline), then draw ──
      intel.update(now);
      const s = intel.snapshot;
      const dt = Math.min(0.05, dtMs / 1000);

      frame.W = cssW;
      frame.H = cssH;
      frame.dt = dt;
      frame.now = now;
      frame.rms = s.rms;
      frame.low = s.low;
      frame.mid = s.mid;
      frame.high = s.high;
      frame.centroid = s.centroid;
      frame.beatHit = s.beatHit;
      frame.beat = s.beat;
      frame.lufs = engine.lufs.momentaryLufs;
      frame.title = titleRef.current;
      frame.reduced = reducedRef.current;

      const m = useVisualizerStore.getState().mode;
      const slot = getSlot(m);
      if (slot.w !== cssW || slot.h !== cssH) {
        slot.r.resize(cssW, cssH);
        slot.w = cssW;
        slot.h = cssH;
      }
      slot.r.draw(frame);

      // Kill-Chain flavor passes over every mode.
      drawTacticalFrame(frame);
      drawEngagePulse(frame);

      // Pre/post-chain comparison inset (optional, bottom-right).
      if (abCompareRef.current) {
        preAnalyser.getByteFrequencyData(preFreq);
        const iw = Math.min(300, cssW * 0.3);
        const ih = 84;
        const ix = cssW - iw - 16;
        const iy = cssH - ih - 42;
        g.fillStyle = "rgba(4,6,10,0.72)";
        g.fillRect(ix, iy, iw, ih);
        g.strokeStyle = "rgba(140,200,230,0.3)";
        g.lineWidth = 1;
        g.strokeRect(ix, iy, iw, ih);
        const plotBins = 96;
        // pre-chain trace (amber) vs post-chain trace (cyan), log-ish sweep
        for (let pass = 0; pass < 2; pass++) {
          const src = pass === 0 ? preFreq : intel.freq;
          const srcBins = pass === 0 ? preFreq.length : binCount;
          g.strokeStyle = pass === 0 ? "rgba(255,176,72,0.75)" : "rgba(84,200,240,0.9)";
          g.lineWidth = 1.2;
          g.beginPath();
          for (let i = 0; i < plotBins; i++) {
            const tN = i / (plotBins - 1);
            const bin = Math.min(srcBins - 1, Math.max(1, Math.round(Math.pow(tN, 2.2) * (srcBins - 1))));
            const v = src[bin] / 255;
            const x = ix + 4 + tN * (iw - 8);
            const y = iy + ih - 4 - v * (ih - 18);
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
        g.font = `8px JetBrains Mono, monospace`;
        g.textAlign = "left";
        g.fillStyle = "rgba(255,176,72,0.8)";
        g.fillText("PRE-CHAIN", ix + 6, iy + 11);
        g.fillStyle = "rgba(84,200,240,0.9)";
        g.fillText("POST-CHAIN", ix + 62, iy + 11);
      }

      // degrade check
      const cost = performance.now() - t0;
      drawCostEma = drawCostEma === 0 ? cost : drawCostEma * 0.92 + cost * 0.08;
      if (!halfRate && drawCostEma > 14) halfRate = true;
      else if (halfRate && drawCostEma < 8) halfRate = false;
    };

    // RAF runs ONLY while the overlay is mounted and the document is
    // visible — hidden window = zero visualizer work.
    const start = () => {
      if (raf === 0) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      engine.releaseLufsMeter();
      intel.stop();
      // Free GPU-backed renderers (Singularity / Cinema) — closing the
      // overlay used to strand their WebGL contexts until process exit.
      for (const s of slots.values()) {
        try { s.r.dispose?.(); } catch { /* ignore */ }
      }
      slots.clear();
    };
  }, []);

  const info = VISUALIZER_MODES.find((m) => m.id === mode) ?? VISUALIZER_MODES[0];
  const hidden = !controlsVisible;

  return createPortal(
    <div
      ref={rootRef}
      className={`kc-vz-root ${hidden ? "kc-vz-idle" : ""}`}
      role="region"
      aria-label="Visualizer"
    >
      <canvas
        ref={canvasRef}
        className="kc-vz-canvas"
        onClick={() => cycleMode(1)}
        title="Click to cycle modes · ←/→ keys · Esc to exit"
      />

      {/* mode designation flash — re-keyed per mode so the animation replays */}
      <div key={mode} className="kc-vz-flash" aria-hidden>
        <div className="kc-vz-flash-name">{info.name}</div>
        <div className="kc-vz-flash-desc">{info.desc}</div>
      </div>

      {/* top-left: now playing */}
      <div className="kc-vz-corner kc-vz-track">
        <div className="kc-vz-track-label">
          {loopback ? "SOURCE · EXTERIOR CAPTURE" : "NOW PLAYING"}
          {!playing && <span className="kc-vz-standby"> · STANDBY</span>}
        </div>
        <div className="kc-vz-track-title">{title}</div>
        {artist && <div className="kc-vz-track-artist">{artist}</div>}
        <div className="kc-vz-track-label" style={{ marginTop: 4 }}>
          {hudIntel.bpm > 0 ? `${hudIntel.bpm} BPM · ` : ""}
          {hudIntel.section.toUpperCase()}
        </div>
      </div>

      {/* top-right: broadcast + fullscreen + close */}
      <div className="kc-vz-corner kc-vz-actions">
        {window.playground?.viz && (
          <button
            className="kc-vz-btn"
            onClick={() => {
              if (broadcasting) stopBroadcast();
              else setBcOpen((v) => !v);
            }}
            title={
              broadcasting
                ? "Close the broadcast window"
                : "Open a second window for streaming / OBS capture / another monitor"
            }
          >
            {broadcasting ? "◉ END BROADCAST" : "⧉ BROADCAST"}
          </button>
        )}
        <button
          className="kc-vz-btn"
          onClick={() => setAbCompare((v) => !v)}
          title="Toggle the pre-chain vs post-chain spectrum comparison inset"
        >
          {abCompare ? "◪ A/B ON" : "◫ A/B"}
        </button>
        <button
          className="kc-vz-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "True fullscreen"}
        >
          {isFullscreen ? "⤢ EXIT FS" : "⛶ FULLSCREEN"}
        </button>
        <button
          className="kc-vz-btn kc-vz-btn-close"
          onClick={() => setOpen(false)}
          title="Close visualizer (Esc)"
        >
          ✕ CLOSE
        </button>

        {/* broadcast launch options */}
        {bcOpen && !broadcasting && (
          <div
            className="absolute right-0 top-10 w-64 rounded-xl border border-white/15 bg-black/85 backdrop-blur-md p-3 text-left"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            <div className="text-[9px] uppercase tracking-[0.3em] text-white/40 mb-2">
              Broadcast window
            </div>
            {displays.length > 1 && (
              <select
                value={bcDisplayId ?? ""}
                onChange={(e) =>
                  setBcDisplayId(e.target.value === "" ? undefined : Number(e.target.value))
                }
                className="w-full mb-2 bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              >
                <option value="">Primary display</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.width}×{d.height}){d.primary ? " · primary" : ""}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-xs text-white/70 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={bcFullscreen}
                onChange={(e) => setBcFullscreen(e.target.checked)}
              />
              Borderless fullscreen
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={bcOnTop}
                onChange={(e) => setBcOnTop(e.target.checked)}
              />
              Always on top (OBS capture)
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={bcTransparent}
                onChange={(e) => setBcTransparent(e.target.checked)}
              />
              Transparent background (overlay)
            </label>
            <button
              className="w-full mt-2 rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-1.5 text-xs font-semibold text-cyan transition"
              onClick={() => {
                setBcOpen(false);
                void startBroadcast({
                  displayId: bcDisplayId,
                  fullscreen: bcFullscreen,
                  alwaysOnTop: bcOnTop,
                  transparent: bcTransparent,
                });
              }}
            >
              ⧉ Launch broadcast
            </button>
            <div className="text-[9px] text-white/35 mt-2 leading-relaxed">
              In the window: ←/→ mode · F fullscreen · H pin HUD · S screenshot ·
              Esc close. For OBS use Window Capture on "Kill-Chain — Broadcast".
            </div>
          </div>
        )}
      </div>

      {/* bottom-center: segmented mode control */}
      <div className="kc-vz-segbar">
        <div className="kc-vz-seg">
          {VISUALIZER_MODES.map((m) => (
            <button
              key={m.id}
              className={`kc-vz-seg-btn ${m.id === mode ? "kc-vz-seg-on" : ""}`}
              onClick={() => setMode(m.id)}
              title={`${m.name} — ${m.desc}`}
            >
              {m.tab}
            </button>
          ))}
        </div>
        <div className="kc-vz-hint">← → cycle · click canvas · esc exit</div>
      </div>
    </div>,
    document.body,
  );
}
