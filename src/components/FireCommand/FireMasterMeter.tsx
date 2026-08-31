/**
 * Compact Fire bus meter — peak + hold + clip + lim GR + voices + corr stub.
 * Writes straight to the DOM from RAF (no per-frame React re-renders).
 * Sources engine.fireTap (post Fire safety clip · pre Kill-Chain).
 */

import { useEffect, useRef } from "react";
import { getEngine } from "@/audio/AudioEngine";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { fmtGrDb, peakToDbfs } from "@/audio/dsp/mixClarity";

export function FireMasterMeter() {
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  const holdRef = useRef<HTMLSpanElement>(null);
  const clipRef = useRef<HTMLSpanElement>(null);
  const grRef = useRef<HTMLSpanElement>(null);
  const voicesRef = useRef<HTMLSpanElement>(null);
  const corrRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let smoothedPeak = 0;
    let peakHold = 0;
    let holdDecay = 0;
    let analyser: AnalyserNode | null = null;
    let buf: Float32Array<ArrayBuffer> | null = null;
    let connected = false;
    // Real L/R taps for the correlation readout. An AnalyserNode downmixes
    // its input to MONO, so the old "interleaved" estimate was correlating
    // the signal with itself (always ≈ +1 — a meaningless meter).
    let split: ChannelSplitterNode | null = null;
    let anL: AnalyserNode | null = null;
    let anR: AnalyserNode | null = null;
    let bufL: Float32Array<ArrayBuffer> | null = null;
    let bufR: Float32Array<ArrayBuffer> | null = null;

    const ensureAnalyser = () => {
      if (analyser && connected) return analyser;
      try {
        const e = getEngine();
        if (!analyser) {
          analyser = e.ctx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0;
        }
        if (!split) {
          split = e.ctx.createChannelSplitter(2);
          anL = e.ctx.createAnalyser();
          anL.fftSize = 1024;
          anL.smoothingTimeConstant = 0;
          anR = e.ctx.createAnalyser();
          anR.fftSize = 1024;
          anR.smoothingTimeConstant = 0;
          split.connect(anL, 0);
          split.connect(anR, 1);
        }
        if (!connected) {
          e.fireTap.connect(analyser);
          e.fireTap.connect(split);
          connected = true;
        }
        return analyser;
      } catch {
        return null;
      }
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 80) return;
      last = t;
      try {
        const e = getEngine();
        const a = ensureAnalyser();
        if (!a) return;
        if (!buf || buf.length !== a.fftSize) {
          buf = new Float32Array(a.fftSize);
        }
        a.getFloatTimeDomainData(buf);
        let p = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]!);
          if (v > p) p = v;
        }
        smoothedPeak = smoothedPeak * 0.82 + p * 0.18;
        if (p >= peakHold) {
          peakHold = p;
          holdDecay = 28;
        } else if (holdDecay > 0) {
          holdDecay -= 1;
        } else {
          peakHold *= 0.985;
        }
        const clip = smoothedPeak > 0.98 || peakHold > 0.99;
        const gr = e.getFireLimiterReduction();
        const va = e.fireCommand.getActiveVoiceCount?.() ?? 0;
        const vb = e.peekFireCommandB()?.getActiveVoiceCount?.() ?? 0;
        const max = useFireCommandStore.getState().maxVoices;

        // True stereo correlation from the split L/R analysers.
        let corrTxt = "—";
        try {
          if (anL && anR) {
            if (!bufL || bufL.length !== anL.fftSize) bufL = new Float32Array(anL.fftSize);
            if (!bufR || bufR.length !== anR.fftSize) bufR = new Float32Array(anR.fftSize);
            anL.getFloatTimeDomainData(bufL);
            anR.getFloatTimeDomainData(bufR);
            let sumLR = 0;
            let sumL2 = 0;
            let sumR2 = 0;
            const n = bufL.length;
            for (let i = 0; i < n; i++) {
              const L = bufL[i];
              const R = bufR[i];
              sumLR += L * R;
              sumL2 += L * L;
              sumR2 += R * R;
            }
            const den = Math.sqrt(Math.max(1e-12, sumL2 * sumR2));
            if (den > 1e-8 && sumL2 + sumR2 > 1e-8) {
              const c = Math.max(-1, Math.min(1, sumLR / den));
              corrTxt = c.toFixed(2);
            }
          }
        } catch {
          corrTxt = "—";
        }

        const pct = Math.min(100, Math.round(smoothedPeak * 100));
        if (fillRef.current) fillRef.current.style.width = `${pct}%`;
        if (peakRef.current) {
          peakRef.current.textContent = peakToDbfs(smoothedPeak);
          peakRef.current.style.color = clip ? "#ff6a3d" : "rgba(255,255,255,0.7)";
        }
        if (holdRef.current) holdRef.current.textContent = peakToDbfs(peakHold);
        if (clipRef.current) {
          clipRef.current.style.opacity = clip ? "1" : "0.25";
          clipRef.current.style.color = clip ? "#ff6a3d" : "rgba(255,255,255,0.35)";
          clipRef.current.style.boxShadow = clip ? "0 0 8px #ff6a3d88" : "none";
        }
        if (grRef.current) {
          const g = fmtGrDb(gr);
          grRef.current.textContent = `LIM −${g}`;
          grRef.current.style.color = Number(g) > 0.2 ? "#ffb08a" : "rgba(255,255,255,0.4)";
        }
        if (voicesRef.current) {
          // Per-engine caps are identical; show A+B so dual-layer play reads honestly.
          voicesRef.current.textContent = `Voices ${va}+${vb}/${max}`;
          voicesRef.current.title = `Synth A ${va} · Synth B ${vb} · cap ${max} each`;
        }
        if (corrRef.current) corrRef.current.textContent = `Corr ${corrTxt}`;
      } catch {
        /* engine not ready */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (connected) {
        try {
          const e = getEngine();
          if (analyser) e.fireTap.disconnect(analyser);
          if (split) e.fireTap.disconnect(split);
        } catch { /* */ }
      }
      try { split?.disconnect(); } catch { /* */ }
    };
  }, []);

  return (
    <div
      className="fc-master-meter shrink-0"
      title="Fire bus · post safety clip · pre Kill-Chain"
      aria-label="Fire output meter"
    >
      <span className="uppercase tracking-[0.1em] text-white/55 text-[10px] font-bold">Fire</span>
      <div className="fc-meter-bar" title="Fire bus peak level" role="meter" aria-label="Peak level">
        <div ref={fillRef} className="fc-meter-fill" style={{ width: "0%" }} />
      </div>
      <span ref={peakRef} className="font-mono text-[10px] text-white/70" title="Instantaneous peak (dBFS)">−∞</span>
      <span ref={holdRef} className="font-mono text-[10px] text-white/45" title="Peak hold (dBFS)">−∞</span>
      <span
        ref={clipRef}
        className="font-mono text-[9px] font-black tracking-wider"
        style={{ opacity: 0.28, color: "rgba(255,255,255,0.4)" }}
        title="Clip indicator"
        aria-label="Clip indicator"
      >
        CLIP
      </span>
      <span ref={grRef} className="font-mono text-[10px] text-white/45" title="Limiter gain reduction">LIM −0.0</span>
      <span ref={voicesRef} className="font-mono text-[10px] text-white/50" title="Active voices / max">Voices 0/{maxVoices}</span>
      <span ref={corrRef} className="font-mono text-[10px] text-white/42" title="Stereo correlation (−1…+1)">Corr —</span>
    </div>
  );
}
