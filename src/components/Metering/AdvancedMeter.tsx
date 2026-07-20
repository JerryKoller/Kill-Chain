import { useEffect, useRef } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { getEngine } from "@/audio/AudioEngine";
import { usePlayerStore } from "@/state/playerStore";

interface MeterStats {
  rms: number;
  peak: number;
  peakHold: number;
  crestFactor: number;
  spectralCentroid: number;
  spectralSpread: number;
}

export function AdvancedMeter() {
  const playing = usePlayerStore((s) => s.status === "playing");
  const statsRef = useRef<MeterStats>({
    rms: 0,
    peak: 0,
    peakHold: 0,
    crestFactor: 0,
    spectralCentroid: 0,
    spectralSpread: 0,
  });
  const peakHoldLastTimeRef = useRef(performance.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastTick = 0;
    const engine = getEngine();
    const freqBuf = new Uint8Array(engine.analyserPost.frequencyBinCount);
    // Allocate time-domain buffer once outside the animation loop
    const timeBuf = new Uint8Array(engine.analyserPost.fftSize);
    const MIN_INTERVAL = 33; // ~30 fps — imperceptible for meters, half the cost

    const update = (now: number) => {
      raf = requestAnimationFrame(update);
      if (document.hidden || now - lastTick < MIN_INTERVAL) return;
      lastTick = now;

      // Idle: skip the spectral math entirely when nothing is playing.
      if (engine.ctx.state !== "running") {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.offsetWidth;
          const h = canvas.offsetHeight;
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
        }
        return;
      }

      engine.analyserPost.getByteFrequencyData(freqBuf);
      engine.analyserPost.getByteTimeDomainData(timeBuf);

      let sum = 0;
      let peak = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const norm = (timeBuf[i] - 128) / 128;
        sum += norm * norm;
        peak = Math.max(peak, Math.abs(norm));
      }
      const rms = Math.sqrt(sum / timeBuf.length);

      // Peak hold with real elapsed time (handles variable frame rates).
      // `now` is the rAF timestamp from the loop parameter.
      if (peak > statsRef.current.peakHold) {
        statsRef.current.peakHold = peak;
        peakHoldLastTimeRef.current = now;
      } else {
        const elapsed = now - peakHoldLastTimeRef.current;
        if (elapsed > 2000) {
          statsRef.current.peakHold = Math.max(
            peak,
            statsRef.current.peakHold * 0.9,
          );
          // Reset timer so decay steps are spaced out, not applied every frame
          peakHoldLastTimeRef.current = now;
        }
      }

      // Crest factor (peak / RMS)
      const crestFactor = rms > 0.01 ? peak / rms : 1;

      // Spectral centroid and spread
      const nyquist = engine.ctx.sampleRate / 2;
      let totalEnergy = 0;
      let weightedFreq = 0;
      for (let i = 0; i < freqBuf.length; i++) {
        const mag = freqBuf[i] / 255;
        const freq = (i / freqBuf.length) * nyquist;
        totalEnergy += mag;
        weightedFreq += mag * freq;
      }
      const centroid = totalEnergy > 0 ? weightedFreq / totalEnergy : 1000;

      let spreadSum = 0;
      for (let i = 0; i < freqBuf.length; i++) {
        const mag = freqBuf[i] / 255;
        const freq = (i / freqBuf.length) * nyquist;
        spreadSum += mag * Math.pow(freq - centroid, 2);
      }
      const spread = Math.sqrt(spreadSum / Math.max(totalEnergy, 1));

      statsRef.current = {
        rms: rms,
        peak: peak,
        peakHold: statsRef.current.peakHold,
        crestFactor,
        spectralCentroid: centroid,
        spectralSpread: spread,
      };

      // Draw
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.offsetWidth;
          const h = canvas.offsetHeight;
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          // Gradient background
          const grd = ctx.createLinearGradient(0, 0, 0, h);
          grd.addColorStop(0, "rgba(122,59,255,0.05)");
          grd.addColorStop(1, "rgba(34,232,255,0.05)");
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, w, h);

          // Draw meters as horizontal bars — rms/peak are 0..1 (amplitude fraction)
          const stats = statsRef.current;
          const meters = [
            {
              label: "RMS",
              value: stats.rms,
              color: "#22e8ff",
            },
            {
              label: "Peak",
              value: stats.peak,
              color: "#ff5b8a",
            },
            {
              label: "Peak Hold",
              value: stats.peakHold,
              color: "#ffb648",
            },
          ];

          // Reserve a left gutter wide enough for "Peak Hold" and a right
          // gutter for the value readout, so neither is ever covered by a bar.
          const LABEL_GUTTER = 76;
          const VALUE_GUTTER = 52;
          const trackX = LABEL_GUTTER;
          const trackW = Math.max(0, w - LABEL_GUTTER - VALUE_GUTTER);

          // Spectral readout occupies the bottom line — keep the bars above it.
          const barAreaH = h - 28;
          const barH = barAreaH / meters.length;
          meters.forEach((m, i) => {
            const y = 8 + i * barH;
            const barW = trackW * Math.min(1, m.value);
            const midY = y + barH / 2 + 4;

            ctx.font = "11px monospace";
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.textAlign = "left";
            ctx.fillText(m.label, 5, midY);

            // Background bar
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fillRect(trackX, y + 2, trackW, barH - 4);

            // Active bar
            ctx.fillStyle = m.color;
            ctx.fillRect(trackX, y + 2, barW, barH - 4);

            // Value text in its own right-hand gutter
            ctx.fillStyle = m.color;
            ctx.textAlign = "right";
            ctx.fillText((m.value * 100).toFixed(1) + "%", w - 6, midY);
          });

          // Spectral info
          ctx.font = "10px monospace";
          ctx.fillStyle = "rgba(255,255,255,0.4)";
          ctx.textAlign = "left";
          ctx.fillText(
            `Centroid: ${stats.spectralCentroid.toFixed(0)} Hz | Spread: ${stats.spectralSpread.toFixed(0)} Hz | Crest: ${stats.crestFactor.toFixed(2)}`,
            5,
            h - 5,
          );
        }
      }
    };

    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <GlassPanel className="h-[180px] p-3">
      <div className="text-xs text-white/60 mb-2 font-mono tracking-wider uppercase">
        Realtime Metering
      </div>
      <canvas ref={canvasRef} className="w-full h-[calc(100%-20px)]" />
    </GlassPanel>
  );
}
