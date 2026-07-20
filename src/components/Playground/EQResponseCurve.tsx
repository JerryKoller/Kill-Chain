import { useCallback, useEffect, useRef } from "react";
import { getEngine } from "@/audio/AudioEngine";
import { useAudioStore } from "@/state/audioStore";
import { useEqStore } from "@/state/eqStore";

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
// Matches the Parametric EQ panel's gain range so both views render the exact
// same curve at the same vertical scale — they are one.
const DB_MIN = -15;
const DB_MAX = 15;

function logFreq(f: number): number {
  return (Math.log2(f) - Math.log2(FREQ_MIN)) / (Math.log2(FREQ_MAX) - Math.log2(FREQ_MIN));
}

function freqToX(f: number, w: number): number {
  return logFreq(f) * w;
}

export function EQResponseCurve() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const params = useAudioStore((s) => s.params);
  const bands = useEqStore((s) => s.bands);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "rgba(34,232,255,0.08)");
    grd.addColorStop(1, "rgba(122,59,255,0.08)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.font = "9px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.3)";

    const decades = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    decades.forEach((f) => {
      const x = freqToX(f, w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(f < 1000 ? f.toString() : (f / 1000).toFixed(1) + "k", x + 2, 10);
    });

    // dB grid
    for (let db = DB_MIN; db <= DB_MAX; db += 5) {
      const y = h / 2 - ((db / (DB_MAX - DB_MIN)) * h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (db !== 0) {
        ctx.fillText((db > 0 ? "+" : "") + db + "dB", 2, y - 2);
      }
    }

    // 0 dB reference line (slightly brighter, drawn once)
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // EQ response curve from the actual live BiquadFilterNodes.
    const engine = getEngine();
    ctx.strokeStyle = "#22e8ff";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(34,232,255,0.5)";
    ctx.shadowBlur = 8;
    ctx.beginPath();

    const steps = 512;
    const freqs = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      freqs[i] = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
    }
    const responseDb = engine.friendlyEQ.computeResponse(freqs);
    // Add the user graphic EQ on top so this curve shows the *total* tone.
    const userDb = engine.computeUserEQResponseDb(freqs);
    for (let i = 0; i <= steps; i++) {
      const freq = freqs[i];
      const db = responseDb[i] + userDb[i];
      const clampedDb = Math.max(DB_MIN, Math.min(DB_MAX, db));
      const x = freqToX(freq, w);
      const y = h / 2 - ((clampedDb / (DB_MAX - DB_MIN)) * h);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowColor = "transparent";
  }, []);

  // Redraw whenever the sound params or user EQ bands change.
  useEffect(() => {
    draw();
  }, [params, bands, draw]);

  // Keep the curve crisp and correctly scaled when the panel resizes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-lg border border-cyan-400/20"
    />
  );
}
