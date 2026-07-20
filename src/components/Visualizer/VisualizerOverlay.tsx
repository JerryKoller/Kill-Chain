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
  createSpectrumArray,
  createWaveformScope,
  createRadialReactor,
  createWaterfallSpectrogram,
  createStrikeField,
  createWarpTunnel,
  createPulseLattice,
  createAuroraFlow,
  type ModeRenderer,
  type RenderFrame,
  type ThemePalette,
  type RGB,
} from "./renderers";

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
    const analyser = engine.analyserPost; // shared post-EQ/limiter tap
    engine.ensureLufsMeter(); // ref-counted CPU meter for the Reactor core

    // All hot-path buffers allocated exactly once per mount.
    const binCount = analyser.frequencyBinCount;
    const freq = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
    const time = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
    const prevFreq = new Uint8Array(binCount);
    const sampleRate = engine.ctx.sampleRate;
    const palette = readPalette();

    // Beat detector state (spectral flux + low-band energy, both against
    // slow adaptive averages so it tracks any genre/loudness).
    const nyq = sampleRate / 2;
    const lowBins = Math.max(4, Math.round((180 / nyq) * binCount));
    const fluxBins = Math.max(lowBins, Math.round((400 / nyq) * binCount));
    // Band edges for the mid/high/centroid readouts the renderers consume.
    const midLoBin = Math.max(lowBins + 1, Math.round((400 / nyq) * binCount));
    const midHiBin = Math.min(binCount - 1, Math.round((2500 / nyq) * binCount));
    const highLoBin = Math.min(binCount - 2, Math.round((4000 / nyq) * binCount));
    let lowAvg = 0;
    let fluxAvg = 0;
    let beatEnv = 0;
    let beatCooldown = 0;

    const slots = new Map<VisualizerMode, RendererSlot>();
    const getSlot = (m: VisualizerMode): RendererSlot => {
      let s = slots.get(m);
      if (!s) {
        const r =
          m === "spectrum"
            ? createSpectrumArray(palette, binCount, sampleRate)
            : m === "scope"
              ? createWaveformScope(palette)
              : m === "radial"
                ? createRadialReactor(palette, binCount, sampleRate)
                : m === "waterfall"
                  ? createWaterfallSpectrogram(palette, binCount, sampleRate)
                  : m === "tunnel"
                    ? createWarpTunnel(palette)
                    : m === "lattice"
                      ? createPulseLattice(palette, binCount, sampleRate)
                      : m === "aurora"
                        ? createAuroraFlow(palette)
                        : createStrikeField(palette);
        s = { r, w: -1, h: -1 };
        slots.set(m, s);
      }
      return s;
    };

    // The one mutable frame bag — reused every tick, never reallocated.
    const frame: RenderFrame = {
      g,
      W: 0,
      H: 0,
      freq,
      time,
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

      // ── pull data from the SHARED analyser (no audio-graph work) ──
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);

      // full-band RMS from the time block
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const v = (time[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / time.length);

      // low-band energy + spectral flux vs adaptive baselines
      let lowSum = 0;
      for (let i = 1; i <= lowBins; i++) lowSum += freq[i];
      const low = lowSum / (lowBins * 255);
      let fluxSum = 0;
      for (let i = 1; i <= fluxBins; i++) {
        const d = freq[i] - prevFreq[i];
        if (d > 0) fluxSum += d;
      }
      prevFreq.set(freq);
      const flux = fluxSum / (fluxBins * 255);

      // mid / high band energies + spectral centroid (single pass).
      let midSum = 0;
      for (let i = midLoBin; i <= midHiBin; i++) midSum += freq[i];
      const midE = midSum / (Math.max(1, midHiBin - midLoBin + 1) * 255);
      let highSum = 0;
      for (let i = highLoBin; i < binCount; i++) highSum += freq[i];
      const highE = highSum / (Math.max(1, binCount - highLoBin) * 255);
      let centNum = 0;
      let centDen = 0;
      for (let i = 1; i < binCount; i += 2) {
        const v = freq[i];
        centNum += v * i;
        centDen += v;
      }
      const centroid = centDen > 0 ? Math.min(1, (centNum / centDen / binCount) * 3.2) : 0;

      const dt = Math.min(0.05, dtMs / 1000);
      const adaptK = 1 - Math.exp(-dt / 1.4); // ~1.4 s time constant
      lowAvg += (low - lowAvg) * adaptK;
      fluxAvg += (flux - fluxAvg) * adaptK;

      beatCooldown -= dt;
      let beatHit = false;
      if (
        beatCooldown <= 0 &&
        low > 0.05 &&
        (flux > fluxAvg * 1.9 + 0.01 || low > lowAvg * 1.35 + 0.03)
      ) {
        beatHit = true;
        beatEnv = 1;
        beatCooldown = 0.13;
      }
      beatEnv *= Math.exp(-dt * 5.5);

      // ── fill the frame bag & draw the active mode ──
      frame.W = cssW;
      frame.H = cssH;
      frame.dt = dt;
      frame.now = now;
      frame.rms = rms;
      frame.low = low;
      frame.mid = midE;
      frame.high = highE;
      frame.centroid = centroid;
      frame.beatHit = beatHit;
      frame.beat = beatEnv;
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
      </div>

      {/* top-right: fullscreen + close */}
      <div className="kc-vz-corner kc-vz-actions">
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
