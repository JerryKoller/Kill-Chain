import { useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useAudioStore } from "@/state/audioStore";
import { useEqStore } from "@/state/eqStore";
import { useUIStore } from "@/state/uiStore";
import { usePlayerStore } from "@/state/playerStore";
import { NEUTRAL_PARAMS } from "@/audio/types";
import { deriveDeadflat, sampleCurveDb, type DeadflatResult } from "@/lib/tractorBeam";
import { measureLive } from "@/lib/tractorLive";

/**
 * DEADFLAT — the Calibration hammer. One button that drives the whole chain
 * toward dead-level frequency response for whatever is playing:
 *
 *   1. Engages the headphone correction profile (flattens the TRANSDUCER),
 *   2. Zeroes every creative tone control and room effect,
 *   3. Listens to the live signal for 12 s,
 *   4. Retunes the Sculptor bands so every 1/3-octave lands on one flat,
 *      even line (pink-noise reference — how balanced audio measures flat).
 *
 * Reports the measured deviation before → after so the flattening is a
 * number, not a feeling.
 */
export function DeadflatPanel() {
  const toast = useUIStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<DeadflatResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    if (busy) {
      abortRef.current?.abort();
      return;
    }
    const p = usePlayerStore.getState();
    const somethingPlays = p.status === "playing" || p.loopbackActive;
    if (!somethingPlays) {
      toast("Play something first — a track, or route Airspace through the chain");
      return;
    }
    setBusy(true);
    setProgress(0);
    setResult(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const audio = useAudioStore.getState();
      await audio.ensureReady();
      // Step 1+2: flatten the transducer, zero the colour.
      audio.setCorrectionEnabled(true);
      // Commit any open Calibration preview session so leave-restore doesn't
      // undo this intentional flatten.
      const { requestPreviewCommit } = await import("@/lib/previewCommitBus");
      requestPreviewCommit();
      audio.replaceParams({ ...NEUTRAL_PARAMS });
      audio.setRoom("off", 0);
      audio.setClarity(0);
      setStatus("Listening — keep it playing…");
      // Step 3: measure the live signal.
      const m = await measureLive({
        seconds: 12,
        signal: ac.signal,
        onProgress: (pr) => {
          if (abortRef.current !== ac) return;
          setStatus(pr.stage === "Listening…" ? "Listening — keep it playing…" : pr.stage);
          setProgress(pr.fraction);
        },
      });
      if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
      if (m.silent) {
        toast("Heard nothing — start playback and run Deadflat again");
        setStatus("");
        return;
      }
      // Step 4: drive every band to the flat line.
      const flat = deriveDeadflat(m, 1);
      useEqStore.getState().applyGainCurve((f) => sampleCurveDb(flat.curve, f));
      setResult(flat);
      setStatus("");
      toast(`Deadflat locked — deviation ${flat.flatnessBeforeDb.toFixed(1)} → ${flat.flatnessAfterDb.toFixed(1)} dB`);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") toast("Deadflat cancelled");
      else toast("Deadflat failed — engine tap unavailable");
      setStatus("");
    } finally {
      if (abortRef.current === ac) {
        setBusy(false);
        setProgress(0);
      }
    }
  };

  return (
    <GlassPanel className="p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="text-xs uppercase tracking-[0.3em] text-dim">Deadflat</div>
          <div className="text-base font-semibold mb-1">
            Level every frequency — the whole chain, one flat line
          </div>
          <div className="text-[12px] text-dim leading-relaxed">
            Engages headphone correction, zeroes every colour control, listens to what's
            playing for 12 seconds, then retunes the Sculptor so every band sits dead even
            (pink reference). The result is as flat as this rig can measure without a mic.
          </div>
          {result && !result.silent && (
            <div className="mt-2 flex gap-2 flex-wrap text-[11px] tabular-nums">
              <span className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1">
                deviation <span className="text-white/50">{result.flatnessBeforeDb.toFixed(1)} dB</span>
                <span className="text-dim mx-1">→</span>
                <span className="text-cyan">{result.flatnessAfterDb.toFixed(1)} dB</span>
              </span>
              <span className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1">
                max move <span className="text-cyan">{result.maxMoveDb.toFixed(1)} dB</span>
              </span>
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-stretch gap-2 w-[200px]">
          <button
            onClick={() => void run()}
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              busy
                ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                : "border-cyan/60 bg-cyan/15 hover:bg-cyan/25 text-cyan shadow-[0_0_22px_rgba(34,232,255,0.25)]"
            }`}
            title="Play a track (or route Airspace), then flatten everything"
          >
            {busy ? "◉ Listening… (cancel)" : "▭ DEADFLAT — listen & level"}
          </button>
          {busy && (
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-cyan transition-[width] duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
          {status && <div className="text-[10px] text-dim text-center">{status}</div>}
        </div>
      </div>
    </GlassPanel>
  );
}
