import { useEffect, useRef } from "react";
import { getEngine } from "@/audio/AudioEngine";
import { usePlayerStore } from "@/state/playerStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { useAirspaceStore } from "@/state/airspaceStore";

/**
 * Tiny live spectrum analyzer for the sidebar — always shows whether
 * audio is flowing, even when you're not on the Visualizer tab.
 */
export function SpectrumStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Audio can flow from the file player, Exterior Audio capture, the Fire
  // sequencer, or Airspace — gating on the file player alone left the strip
  // dark for every other source.
  const filePlaying = usePlayerStore((s) => s.status === "playing" || s.loopbackActive);
  const seqPlaying = useFireSequencerStore((s) => s.playing);
  const airPlaying = useAirspaceStore((s) => s.media != null && !s.media.paused);
  const playing = filePlaying || seqPlaying || airPlaying;

  useEffect(() => {
    if (!playing) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastTick = 0;
    let idleCleared = false;
    const dpr = window.devicePixelRatio || 1;
    const engine = getEngine();
    const buf = new Uint8Array(engine.analyserPost.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    const MIN_INTERVAL = 33; // ~30 fps

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (now - lastTick < MIN_INTERVAL) return;
      lastTick = now;

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
      }

      // Idle: when the context isn't running, clear once and stop drawing.
      if (engine.ctx.state !== "running") {
        if (!idleCleared) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);
          idleCleared = true;
        }
        return;
      }
      idleCleared = false;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      engine.analyserPost.getByteFrequencyData(buf);
      const n = buf.length;
      const bars = Math.min(32, Math.floor(W / 4));
      const step = Math.floor(n / bars);

      // One gradient reused for every bar instead of allocating 32/frame.
      const grad = ctx.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0, "rgba(34,232,255,0.9)");
      grad.addColorStop(0.6, "rgba(122,59,255,0.85)");
      grad.addColorStop(1, "rgba(255,43,214,0.7)");
      ctx.fillStyle = grad;

      const bw = W / bars - 2;
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        for (let j = 0; j < step; j++) {
          const v = buf[i * step + j];
          if (v > peak) peak = v;
        }
        const h = (peak / 255) * H;
        const x = (i / bars) * W + 1;
        ctx.fillRect(x, H - h, bw, h);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className="mt-3 rounded-xl border border-white/8 bg-black/30 overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-10 block" />
      <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-dim text-center">
        Live signal
      </div>
    </div>
  );
}
