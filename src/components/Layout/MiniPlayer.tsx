import { useEffect, useRef } from "react";
import { usePlayerStore } from "@/state/playerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { getEngine } from "@/audio/AudioEngine";

/**
 * Compact always-on-top strip. Keeps cover art, transport, and a tiny
 * spectrum strip visible while taking ~120px of vertical space.
 *
 * Asks the Electron main process to flip the window into always-on-top +
 * a small fixed size when active, and reverts on exit.
 */
export function MiniPlayer() {
  const status = usePlayerStore((s) => s.status);
  const meta = usePlayerStore((s) => s.metadata);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const setMini = useSettingsStore((s) => s.set);

  const audioEl = usePlayerStore((s) => s.element);
  const tick = usePlayerStore((s) => s.tick);

  // Spectrum canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const winApi = window.playground?.window;
    if (winApi?.setMiniSize) void winApi.setMiniSize(true);
    if (winApi?.setAlwaysOnTop) void winApi.setAlwaysOnTop(true);
    return () => {
      if (winApi?.setMiniSize) void winApi.setMiniSize(false);
      if (winApi?.setAlwaysOnTop) void winApi.setAlwaysOnTop(false);
    };
  }, []);

  useEffect(() => {
    if (!audioEl) return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [audioEl, tick]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const eng = getEngine();
    const freq = new Uint8Array(eng.analyserPost.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    const time = new Uint8Array(eng.analyserPost.fftSize) as Uint8Array<ArrayBuffer>;
    let raf = 0;
    let lastTick = 0;
    let cleared = false;
    const MIN_INTERVAL = 33; // ~30 fps is plenty for a 26px strip
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - lastTick < MIN_INTERVAL) return;
      lastTick = now;

      const W = c.width;
      const H = c.height;
      // Idle: clear once and stop hammering the analyser when silent.
      if (eng.ctx.state !== "running") {
        if (!cleared) { ctx.clearRect(0, 0, W, H); cleared = true; }
        return;
      }
      cleared = false;

      eng.readPost({ freq, time });
      ctx.clearRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "#22e8ff");
      grad.addColorStop(1, "#ff2bd6");
      ctx.fillStyle = grad;
      const N = 48;
      const bw = W / N;
      for (let i = 0; i < N; i++) {
        const v = freq[Math.floor((i / N) * freq.length)] / 255;
        const h = v * H * 0.9;
        ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pct = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="w-screen h-screen flex flex-col bg-ink text-white select-none">
      <div className="titlebar-drag h-7 px-3 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-dim border-b border-white/10">
        <span>Kill-Chain - mini</span>
        <button
          onClick={() => setMini("miniMode", false)}
          className="titlebar-no-drag rounded px-2 py-0.5 text-cyan hover:bg-white/10"
        >
          expand
        </button>
      </div>
      <div className="flex-1 flex items-center gap-3 px-4 py-2">
        <div
          className="w-16 h-16 rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden grid place-items-center text-2xl text-dim"
          style={
            meta.coverUrl
              ? { background: `center/cover no-repeat url("${meta.coverUrl}")` }
              : undefined
          }
        >
          {!meta.coverUrl && "\u266B"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-[0.25em] text-dim truncate">
            {meta.artist ?? "Unknown artist"}
          </div>
          <div className="text-sm font-semibold truncate">
            {meta.title ?? "Nothing loaded"}
          </div>
          <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan to-plasma"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <MiniBtn label="\u23EE" aria="Previous track" onClick={() => previous()} />
          <MiniBtn
            label={status === "playing" ? "\u275A\u275A" : "\u25B6"}
            aria={status === "playing" ? "Pause" : "Play"}
            big
            onClick={() => void toggle()}
          />
          <MiniBtn label="\u23ED" aria="Next track" onClick={() => next()} />
        </div>
      </div>
      <div className="px-4 pb-2">
        <canvas ref={canvasRef} width={480} height={26} className="w-full h-[26px]" />
      </div>
    </div>
  );
}

function MiniBtn({
  label,
  aria,
  onClick,
  big,
}: {
  label: string;
  /** Accessible name — the glyph labels are invisible to screen readers. */
  aria: string;
  onClick: () => void;
  big?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={aria}
      title={aria}
      className={`grid place-items-center rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 transition ${
        big ? "w-10 h-10 text-lg" : "w-8 h-8 text-sm"
      }`}
    >
      {label}
    </button>
  );
}
