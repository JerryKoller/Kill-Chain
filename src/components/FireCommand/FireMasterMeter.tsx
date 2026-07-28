/**
 * Compact master meter — peak + clip + voices + load hint.
 * Writes straight to the DOM from RAF (no per-frame React re-renders).
 */

import { useEffect, useRef } from "react";
import { getEngine } from "@/audio/AudioEngine";
import { useFireCommandStore } from "@/state/fireCommandStore";

export function FireMasterMeter() {
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fillRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const voicesRef = useRef<HTMLSpanElement>(null);
  const loadRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let smoothedPeak = 0;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 80) return;
      last = t;
      try {
        const e = getEngine();
        const a = e.analyserPost;
        if (!a) return;
        if (!buf || buf.length !== a.fftSize) buf = new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(buf);
        let p = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs((buf[i]! - 128) / 128);
          if (v > p) p = v;
        }
        smoothedPeak = smoothedPeak * 0.85 + p * 0.15;
        const pct = Math.min(100, Math.round(smoothedPeak * 100));
        const clip = smoothedPeak > 0.98;
        const va = e.fireCommand.getActiveVoiceCount?.() ?? 0;
        const vb = e.peekFireCommandB()?.getActiveVoiceCount?.() ?? 0;
        const voices = va + vb;
        const max = useFireCommandStore.getState().maxVoices;
        // Rough engine-load hint from active voices vs the polyphony ceiling
        // (both synths can run `max` voices each).
        const load = Math.min(100, Math.round((voices / Math.max(1, max * 2)) * 100));

        if (fillRef.current) fillRef.current.style.width = `${pct}%`;
        if (pctRef.current) {
          pctRef.current.textContent = clip ? "CLIP" : `${pct}%`;
          pctRef.current.style.color = clip ? "#ff6a3d" : "rgba(255,255,255,0.55)";
        }
        if (voicesRef.current) voicesRef.current.textContent = `Voices ${voices}/${max}`;
        if (loadRef.current) loadRef.current.textContent = `Load ${load}%`;
      } catch {
        /* engine not ready */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fc-master-meter shrink-0 fc-text-secondary">
      <span className="uppercase tracking-[0.16em] text-white/45 text-[10px] font-bold">Master</span>
      <div className="fc-meter-bar" title="Post-chain peak">
        <div ref={fillRef} className="fc-meter-fill" style={{ width: "0%" }} />
      </div>
      <span ref={pctRef} className="font-mono text-[10px] text-white/55">0%</span>
      <span ref={voicesRef} className="font-mono text-[10px] text-white/45">Voices 0/{maxVoices}</span>
      <span ref={loadRef} className="font-mono text-[10px] text-white/35">Load 0%</span>
    </div>
  );
}
