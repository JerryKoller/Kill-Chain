import { useEffect, useRef, useState } from "react";
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
import {
  defaultSnapshot,
  wireToSnapshot,
  type IntelSnapshot,
} from "./visualIntel";
import { createLumaKey, type LumaKey } from "./lumaKey";
import type { VizFramePayload } from "@/lib/vizBroadcast";

/**
 * Broadcast window root — rendered when the bundle boots with ?viz=1 in a
 * second frameless BrowserWindow. No audio engine and NO analysis here:
 * frames arrive over IPC (~30 fps) carrying the raw analyser blocks plus the
 * serialized Visual Intelligence snapshot, and are drawn with the SAME
 * renderers as the in-app overlay. With ?transparent=1 the scene is
 * luma-keyed so darkness becomes window transparency (OBS overlay mode).
 *
 * Hotkeys: ←/→ cycle modes · F fullscreen · H pin HUD · S screenshot ·
 * Esc close.
 */

const IDLE_HIDE_MS = 2600;
const MAX_DPR = 2;
/** No frames for this long → show the standby card (main window gone/idle). */
const STALE_MS = 1500;

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
  w: number;
  h: number;
}

const TRANSPARENT =
  new URLSearchParams(window.location.search).get("transparent") === "1";

export function BroadcastWindow() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const mode = useVisualizerStore((s) => s.mode);

  const [hudVisible, setHudVisible] = useState(true);
  const [hudPinned, setHudPinned] = useState(false);
  const [title, setTitle] = useState("");
  const [live, setLive] = useState(false);
  const [hudIntel, setHudIntel] = useState({ bpm: 0, section: "idle" });
  const [shotFlash, setShotFlash] = useState(false);
  const idleTimer = useRef<number>(0);
  const fullscreenRef = useRef(false);

  // Transparent overlay mode: strip every opaque layer under the canvas.
  useEffect(() => {
    if (!TRANSPARENT) return;
    const html = document.documentElement;
    const prevHtml = html.style.background;
    const prevBody = document.body.style.background;
    html.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      html.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, []);

  // ── auto-fading HUD ──
  useEffect(() => {
    if (hudPinned) {
      setHudVisible(true);
      return;
    }
    const poke = () => {
      setHudVisible(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setHudVisible(false), IDLE_HIDE_MS);
    };
    poke();
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerdown", poke);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerdown", poke);
    };
  }, [hudPinned]);

  // ── hotkeys ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        useVisualizerStore.getState().cycleMode(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "f" || e.key === "F") {
        fullscreenRef.current = !fullscreenRef.current;
        void window.playground?.viz?.setFullscreen(fullscreenRef.current);
      } else if (e.key === "h" || e.key === "H") {
        setHudPinned((v) => !v);
      } else if (e.key === "s" || e.key === "S") {
        // Screenshot: dump the visible canvas as a PNG download.
        const cv = canvasRef.current;
        if (cv) {
          cv.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            a.download = `killchain-viz-${ts}.png`;
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 5000);
            setShotFlash(true);
            window.setTimeout(() => setShotFlash(false), 900);
          });
        }
      } else if (e.key === "Escape") {
        void window.playground?.viz?.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── IPC frame consumer + draw ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    // Transparent mode: modes draw into an offscreen opaque canvas, which is
    // luma-keyed onto the visible WebGL canvas. Opaque mode: draw directly.
    let g: CanvasRenderingContext2D | null = null;
    let offscreen: HTMLCanvasElement | null = null;
    let luma: LumaKey | null = null;
    if (TRANSPARENT) {
      luma = createLumaKey(canvas);
      if (luma) {
        offscreen = document.createElement("canvas");
        g = offscreen.getContext("2d", { alpha: false });
      }
    }
    if (!g) {
      luma = null;
      offscreen = null;
      g = canvas.getContext("2d", { alpha: false });
    }
    if (!g) return;
    const ctx2d = g;

    const palette = readPalette();

    // Everything below is lazily initialized on the FIRST frame — bin count
    // and sample rate come from the stream, not from a local engine.
    const intel: IntelSnapshot = defaultSnapshot();
    let frame: RenderFrame | null = null;
    let binCount = 0;
    let sampleRate = 48000;
    const slots = new Map<VisualizerMode, RendererSlot>();

    const getSlot = (m: VisualizerMode): RendererSlot => {
      let s = slots.get(m);
      if (!s) {
        s = { r: createModeRenderer(m, palette, binCount, sampleRate), w: -1, h: -1 };
        slots.set(m, s);
      }
      return s;
    };

    let cssW = 0;
    let cssH = 0;
    const applySize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (luma && offscreen) {
        luma.resize(w, h);
        if (offscreen.width !== w || offscreen.height !== h) {
          offscreen.width = w;
          offscreen.height = h;
        }
      } else if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    let lastFrameAt = 0;
    let lastTitle = "";
    let prevLive = false;
    let lastHudPush = 0;

    const onFrame = (raw: unknown) => {
      const p = raw as VizFramePayload;
      if (!p || !p.freq || !p.time) return;
      const now = performance.now();
      const dt = Math.min(0.05, lastFrameAt === 0 ? 0.033 : (now - lastFrameAt) / 1000);
      lastFrameAt = now;

      if (!frame || binCount !== p.freq.length) {
        binCount = p.freq.length;
        sampleRate = p.sampleRate || 48000;
        for (const s of slots.values()) {
          try { s.r.dispose?.(); } catch { /* ignore */ }
        }
        slots.clear();
        frame = {
          g: ctx2d,
          W: 0,
          H: 0,
          freq: p.freq,
          time: p.time,
          binCount,
          sampleRate,
          dt,
          now,
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
          intel,
        };
      }
      if (!frame || cssW < 2 || cssH < 2 || document.hidden) return;

      // The ONLY analysis here is deserialization — the pipeline lives in
      // the main window.
      if (p.intel) wireToSnapshot(p.intel, intel);

      frame.freq = p.freq;
      frame.time = p.time;
      frame.W = cssW;
      frame.H = cssH;
      frame.dt = dt;
      frame.now = now;
      frame.rms = intel.rms;
      frame.low = intel.low;
      frame.mid = intel.mid;
      frame.high = intel.high;
      frame.centroid = intel.centroid;
      frame.beatHit = intel.beatHit;
      frame.beat = intel.beat;
      frame.lufs = p.lufs;
      frame.title = p.title;

      const m = useVisualizerStore.getState().mode;
      const slot = getSlot(m);
      if (slot.w !== cssW || slot.h !== cssH) {
        slot.r.resize(cssW, cssH);
        slot.w = cssW;
        slot.h = cssH;
      }
      slot.r.draw(frame);
      if (!TRANSPARENT) drawTacticalFrame(frame);
      drawEngagePulse(frame);

      // Transparent overlay: luma-key the offscreen scene onto the window.
      if (luma && offscreen) luma.blit(offscreen);

      const isLive = intel.rms > 0.001;
      if (isLive !== prevLive) {
        prevLive = isLive;
        setLive(isLive);
      }
      if (p.title !== lastTitle) {
        lastTitle = p.title;
        setTitle(p.title);
      }
      if (now - lastHudPush > 500) {
        lastHudPush = now;
        const bpm = intel.bpmConf > 0.2 ? Math.round(intel.bpm) : 0;
        setHudIntel((prev) =>
          prev.bpm === bpm && prev.section === intel.section
            ? prev
            : { bpm, section: intel.section },
        );
      }
    };

    const unsub = window.playground?.viz?.onFrame(onFrame);

    // Stale-stream watchdog → standby card when the feed stops.
    const staleTimer = window.setInterval(() => {
      if (prevLive && performance.now() - lastFrameAt > STALE_MS) {
        prevLive = false;
        setLive(false);
      }
    }, 500);

    return () => {
      unsub?.();
      window.clearInterval(staleTimer);
      ro.disconnect();
      for (const s of slots.values()) {
        try { s.r.dispose?.(); } catch { /* ignore */ }
      }
      slots.clear();
      luma?.dispose();
    };
  }, []);

  const info = VISUALIZER_MODES.find((m) => m.id === mode) ?? VISUALIZER_MODES[0];

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 overflow-hidden select-none"
      style={{
        background: TRANSPARENT ? "transparent" : "#04050a",
        cursor: hudVisible ? "default" : "none",
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onClick={() => useVisualizerStore.getState().cycleMode(1)}
      />

      {/* mode flash (re-keyed per mode) */}
      <div key={mode} className="kc-vz-flash" aria-hidden>
        <div className="kc-vz-flash-name">{info.name}</div>
        <div className="kc-vz-flash-desc">{info.desc}</div>
      </div>

      {/* minimal HUD */}
      <div
        className="absolute left-4 top-3 transition-opacity duration-500"
        style={{ opacity: hudVisible ? 1 : 0, fontFamily: "JetBrains Mono, monospace" }}
      >
        <div className="text-[9px] uppercase tracking-[0.4em] text-white/40">
          KILL-CHAIN · BROADCAST{live ? "" : " · STANDBY"}
        </div>
        <div className="text-sm text-white/85 max-w-[60vw] truncate">
          {title || "NO SIGNAL"}
        </div>
        <div className="text-[9px] uppercase tracking-[0.3em] text-white/40 mt-0.5">
          {hudIntel.bpm > 0 ? `${hudIntel.bpm} BPM · ` : ""}
          {hudIntel.section.toUpperCase()}
        </div>
      </div>

      <div
        className="absolute right-4 top-3 text-right transition-opacity duration-500"
        style={{ opacity: hudVisible ? 1 : 0, fontFamily: "JetBrains Mono, monospace" }}
      >
        <div className="text-[9px] uppercase tracking-[0.3em] text-white/40">{info.name}</div>
        <div className="text-[9px] text-white/30 mt-0.5">
          ←/→ mode · F fullscreen · H pin HUD · S screenshot · Esc close
        </div>
        {shotFlash && (
          <div className="text-[9px] text-white/70 mt-0.5">◉ FRAME CAPTURED</div>
        )}
      </div>

      {/* drag region so the frameless window can be moved */}
      <div
        className="absolute left-0 right-0 top-0 h-8"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
    </div>
  );
}
