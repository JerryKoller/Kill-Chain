import { useEffect, useRef } from "react";
import { FRIENDLY_EQ_LAYOUT, getEngine } from "@/audio/AudioEngine";
import { useAudioStore } from "@/state/audioStore";
import { SOUND_PARAM_META, TONE_KEYS, type SoundParams } from "@/audio/types";

const EQ_KEYS: (keyof SoundParams)[] = TONE_KEYS;
const EQ_FREQS: Record<string, number> = Object.fromEntries(
  Object.entries(FRIENDLY_EQ_LAYOUT).map(([k, v]) => [k, v.freq]),
);
const EQ_MAX_DB: Record<string, number> = Object.fromEntries(
  Object.entries(FRIENDLY_EQ_LAYOUT).map(([k, v]) => [k, v.maxDb]),
);

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const DB_MIN = -12;
const DB_MAX = 12;

interface Point {
  key: keyof SoundParams;
  color: string;
  label: string;
}

const POINTS: Point[] = EQ_KEYS.map((k) => {
  const meta = SOUND_PARAM_META.find((m) => m.key === k)!;
  return { key: k, color: meta.color, label: meta.label };
});

export function EQCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    key: keyof SoundParams;
    startY: number;
    startV: number;
  } | null>(null);
  const params = useAudioStore((s) => s.params);
  const setParam = useAudioStore((s) => s.setParam);

  // Draw spectrogram waterfall + EQ curve + node markers.
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const dpr = window.devicePixelRatio || 1;
    const engine = getEngine();
    const freqBuf = new Uint8Array(engine.analyserPre.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    const MIN_INTERVAL = 66; // ~15 fps — plenty for a static EQ canvas
    // Reused across frames — allocating these per frame caused steady GC churn.
    let freqs: Float32Array<ArrayBuffer> | null = null;
    let binX: Float32Array<ArrayBuffer> | null = null; // frequency-bin → x position (log scale)

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - lastTick < MIN_INTERVAL) return;
      if (engine.ctx.state !== "running") return;
      lastTick = now;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // ── Live spectrum backdrop (incoming signal) ──
      // One pass over the current analyser frame. (The old "waterfall" kept 96
      // historical frames and stacked ~100k full-height fillRects per redraw —
      // the columns all overlapped, so it burned CPU for a blur.)
      engine.analyserPre.getByteFrequencyData(freqBuf);
      const n = freqBuf.length;
      // Precompute each bin's x position once per canvas width.
      if (!binX || binX.length !== n + 1) binX = new Float32Array(n + 1);
      if (binX[n] !== W) {
        for (let i = 0; i <= n; i++) binX[i] = freqToX(xToFreq(i, n), W);
        binX[n] = W;
      }
      for (let i = 1; i < n; i++) {
        const f0 = xToFreq(i - 1, n);
        if (f0 < FREQ_MIN || f0 > FREQ_MAX) continue;
        const x0 = binX[i - 1];
        const bw = Math.max(1, binX[i] - x0);
        const t = freqBuf[i] / 255;
        if (t < 0.02) continue; // skip silent bins entirely
        const alpha = 0.12 + t * 0.72;
        const hue = 200 + t * 80;
        ctx.fillStyle = `hsla(${hue}, 90%, ${40 + t * 35}%, ${alpha})`;
        ctx.fillRect(x0, 0, bw, H);
      }

      // Grid
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      const decades = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      ctx.font = "10px JetBrains Mono, Consolas, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      for (const f of decades) {
        const x = freqToX(f, W);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.fillText(formatFreq(f), x + 4, H - 6);
      }
      for (let db = DB_MIN; db <= DB_MAX; db += 3) {
        const y = dbToY(db, H);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.strokeStyle =
          db === 0 ? "rgba(122,59,255,0.4)" : "rgba(255,255,255,0.04)";
        ctx.stroke();
      }

      // Compute response across the visible range (reuse the freq array).
      const N = Math.max(128, Math.floor(W));
      if (!freqs || freqs.length !== N) {
        freqs = new Float32Array(N);
        for (let i = 0; i < N; i++) freqs[i] = xToFreq(i, N);
      }
      const response = engine.computeFriendlyResponseDb(freqs);

      // Fill under curve
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgba(122,59,255,0.45)");
      grad.addColorStop(1, "rgba(34,232,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * W;
        const y = dbToY(response[i], H);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();

      // Curve
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.shadowColor = "rgba(122,59,255,0.6)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * W;
        const y = dbToY(response[i], H);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // The loop reads response data directly from the engine on each frame,
    // so it doesn't need to re-create when params change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag handlers
  const onPointerDown = (e: React.PointerEvent, p: Point) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { key: p.key, startY: e.clientY, startV: params[p.key] };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = drag.startY - e.clientY;
    const next = clamp(drag.startV + dy / 120, -1, 1);
    setParam(drag.key, next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  };

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block rounded-xl" />
      <div ref={overlayRef} className="absolute inset-0">
        {POINTS.map((p) => {
          const v = params[p.key];
          const db = v * EQ_MAX_DB[p.key];
          const x = `${(freqToX(EQ_FREQS[p.key], 1) * 100).toFixed(2)}%`;
          const y = `${(dbToY(db, 1) * 100).toFixed(2)}%`;
          return (
            <div
              key={p.key}
              className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
              style={{ left: x, top: y }}
            >
              <button
                onPointerDown={(e) => onPointerDown(e, p)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={() => setParam(p.key, 0)}
                className="group relative w-5 h-5 rounded-full cursor-grab active:cursor-grabbing"
                style={{
                  background: p.color,
                  boxShadow: `0 0 16px ${p.color}, 0 0 32px ${p.color}55`,
                  border: "1.5px solid rgba(255,255,255,0.85)",
                }}
              >
                <div
                  className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] tracking-widest uppercase opacity-0 group-hover:opacity-100 transition pointer-events-none"
                  style={{ color: p.color }}
                >
                  {p.label} · {db >= 0 ? "+" : ""}{db.toFixed(1)} dB
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────── helpers (assume normalized 0..1 layout) ─────────
function freqToX(f: number, W: number): number {
  const lo = Math.log10(FREQ_MIN);
  const hi = Math.log10(FREQ_MAX);
  return ((Math.log10(f) - lo) / (hi - lo)) * W;
}
function xToFreq(x: number, W: number): number {
  const lo = Math.log10(FREQ_MIN);
  const hi = Math.log10(FREQ_MAX);
  return Math.pow(10, lo + (x / W) * (hi - lo));
}
function dbToY(db: number, H: number): number {
  return ((DB_MAX - db) / (DB_MAX - DB_MIN)) * H;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function formatFreq(f: number): string {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
}
