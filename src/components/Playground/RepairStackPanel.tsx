import { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useAudioStore } from "@/state/audioStore";
import { useEqStore, eqIsActive } from "@/state/eqStore";
import { useUIStore } from "@/state/uiStore";
import { useRepairStore } from "@/state/repairStore";
import { restoreActive } from "@/audio/dsp/Reconstructor";
import { getEngine } from "@/audio/AudioEngine";
import { sampleCurveDb } from "@/lib/tractorBeam";
import {
  readAndRepair,
  applyRepairReport,
  type RepairReport,
  type RepairReportItem,
} from "@/lib/readRepair";

/**
 * Repair Stack — the v2.1 command deck at the top of the Sculptor.
 *
 *   · The ordered stack (Restoration → Clarity → Sculptor EQ) with live
 *     stage indicators.
 *   · ONE A/B bypass for the whole repair stack (toggle, click-safe).
 *   · Conflict warnings when two stages fight each other.
 *   · READ & REPAIR: one-button analysis → readable report → user-approved
 *     apply. Nothing changes without confirmation.
 *   · A live spectrogram with the detected cutoff and Target Lock overlays.
 */
export function RepairStackPanel() {
  const restore = useAudioStore((s) => s.restore);
  const clarity = useAudioStore((s) => s.clarity);
  const params = useAudioStore((s) => s.params);
  const repairBypass = useAudioStore((s) => s.repairBypass);
  const setRepairBypass = useAudioStore((s) => s.setRepairBypass);
  const bands = useEqStore((s) => s.bands);
  const toast = useUIStore((s) => s.toast);

  const restoreOn = restoreActive(restore);
  const clarityOn = clarity > 0.001;
  const eqOn = eqIsActive(bands);
  const anyOn = restoreOn || clarityOn || eqOn;

  // ── READ & REPAIR state ──
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [report, setReport] = useState<RepairReport | null>(null);
  const [accepted, setAccepted] = useState<Set<RepairReportItem["id"]>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const runReadRepair = async () => {
    if (reading) {
      abortRef.current?.abort();
      return;
    }
    setReading(true);
    setReport(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const rep = await readAndRepair({
        seconds: 8,
        signal: ac.signal,
        onProgress: setProgress,
      });
      if (!rep) {
        toast("Heard nothing to repair — play the damaged source first");
      } else {
        setReport(rep);
        setAccepted(new Set(rep.items.filter((i) => i.recommended).map((i) => i.id)));
        if (rep.cutoffHz !== null) {
          useRepairStore.getState().setCutoffHz(rep.cutoffHz);
        }
      }
    } catch {
      /* cancelled */
    } finally {
      setReading(false);
      setProgress(null);
    }
  };

  const applyReport = async () => {
    if (!report) return;
    const applied = await applyRepairReport(report, accepted);
    setReport(null);
    toast(
      applied.length > 0
        ? `Read & Repair applied: ${applied.join(" · ")}`
        : "Nothing selected — chain untouched",
    );
  };

  // ── Conflict warnings ──
  const warnings = useMemo(() => {
    const out: string[] = [];
    if (restore.widen > 0.25 && restore.phase > 0.25) {
      out.push("Widen synthesizes stereo while Phase Repair folds it back — pick one.");
    }
    if (restore.hiss > 0.4 && bands.some((b) => b.enabled && b.freq >= 6000 && b.gain > 3)) {
      out.push("Hiss Tamer is closing the top end your EQ treble boost is lifting.");
    }
    if (restore.hf > 0.4 && bands.some((b) => b.enabled && b.type === "lowpass" && b.freq < 16000)) {
      out.push("HF Rebuild regenerates highs that a lowpass band then removes.");
    }
    if (restore.dehum > 0.3 && bands.some((b) => b.enabled && b.type === "notch" && b.freq >= 45 && b.freq <= 70)) {
      out.push("De-hum and a 50/60 Hz notch band are both cutting the same fundamental.");
    }
    if (restore.declip > 0.4 && params.saturation > 0.35) {
      out.push("De-clip is rounding peaks that Saturation re-clips downstream.");
    }
    if (restore.decrunch > 0.5 && clarity > 0.7) {
      out.push("De-crunch + high Clarity both duck the presence region — may dull transients.");
    }
    return out;
  }, [restore, bands, params.saturation, clarity]);

  return (
    <GlassPanel intense className="p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-dim">
            Repair Stack
          </div>
          <div className="text-base font-semibold">
            Restoration → Clarity → Sculptor EQ
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void runReadRepair()}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              reading
                ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                : "border-fuchsia-400/50 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-300"
            }`}
            title="Listen for ~8 seconds, then show a repair report (restoration, clarity, gentle EQ, −14 LUFS trim). Nothing is applied until you confirm."
          >
            {reading
              ? `◉ ${progress?.stage ?? "Listening…"} (click to cancel)`
              : "⚕ READ & REPAIR"}
          </button>
          <button
            onClick={() => {
              const next = !repairBypass;
              setRepairBypass(next);
              toast(next ? "Repair stack BYPASSED — hearing the damage" : "Repair stack ENGAGED");
            }}
            disabled={!anyOn && !repairBypass}
            className={`rounded-xl border px-4 py-2 text-sm font-bold tracking-wide transition ${
              repairBypass
                ? "border-rose-400/70 bg-rose-500/20 text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.35)]"
                : anyOn
                  ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  : "border-white/10 bg-white/[0.02] text-white/30 cursor-not-allowed"
            }`}
            title="One-click A/B for the complete repair stack (Restoration + Clarity + Sculptor EQ). Crossfaded — safe to hammer."
          >
            {repairBypass ? "⊘ REPAIR BYPASSED" : "A/B REPAIR"}
          </button>
        </div>
      </div>

      {/* Ordered stage chips */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <StageChip name="Restoration Bay" on={restoreOn} dimmed={repairBypass} />
        <span className="text-white/25">→</span>
        <StageChip name="Clarity" on={clarityOn} dimmed={repairBypass} />
        <span className="text-white/25">→</span>
        <StageChip
          name="Sculptor EQ"
          on={eqOn}
          dimmed={repairBypass}
          extra={bands.some((b) => b.enabled && b.dynamic) ? "DYN" : undefined}
        />
        {repairBypass && (
          <span className="text-[10px] uppercase tracking-widest text-rose-300/90">
            — stack muted for compare, settings intact
          </span>
        )}
      </div>

      {/* Conflict warnings */}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.25em] text-amber-300/90 mb-1">
            ⚠ Conflicting settings
          </div>
          <ul className="text-[11px] text-amber-100/80 leading-relaxed list-disc list-inside">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Live spectrogram + overlays */}
      <RepairSpectrogram />

      {/* READ & REPAIR report */}
      {report && (
        <div className="mt-3 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/[0.06] p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-[0.25em] text-fuchsia-300">
              Damage report — approve before anything changes
            </div>
            {report.lufs !== null && (
              <div className="text-[11px] font-mono text-white/60">
                {report.lufs.toFixed(1)} LUFS
                {report.cutoffHz !== null && ` · cutoff ≈ ${(report.cutoffHz / 1000).toFixed(1)} kHz`}
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {report.items.map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-black/25 px-3 py-2 cursor-pointer hover:border-white/20 transition"
              >
                <input
                  type="checkbox"
                  checked={accepted.has(item.id)}
                  onChange={(e) => {
                    setAccepted((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    });
                  }}
                  className="mt-0.5 accent-fuchsia-400"
                />
                <div>
                  <div className="text-sm font-semibold text-white/90">{item.label}</div>
                  <ul className="text-[11px] text-white/65 leading-relaxed list-disc list-inside">
                    {item.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void applyReport()}
              disabled={accepted.size === 0}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                accepted.size > 0
                  ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-200 hover:bg-fuchsia-500/30"
                  : "border-white/10 bg-white/[0.02] text-white/30 cursor-not-allowed"
              }`}
            >
              Apply {accepted.size} selected
            </button>
            <button
              onClick={() => setReport(null)}
              className="rounded-lg border border-white/15 hover:bg-white/5 px-4 py-2 text-sm text-white/70 transition"
            >
              Discard report
            </button>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

function StageChip({
  name,
  on,
  dimmed,
  extra,
}: {
  name: string;
  on: boolean;
  dimmed: boolean;
  extra?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
        dimmed
          ? "border-white/10 text-white/30 line-through"
          : on
            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
            : "border-white/12 bg-white/[0.02] text-white/45"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          on && !dimmed ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-white/20"
        }`}
      />
      {name}
      {extra && (
        <span className="text-[9px] px-1 py-px rounded bg-cyan/20 text-cyan tracking-normal no-underline">
          {extra}
        </span>
      )}
    </span>
  );
}

// ── Live spectrogram with cutoff + Target Lock overlays ────────────────────

const SPEC_H = 132;
const F_MIN = 30;
const F_MAX = 20000;

function RepairSpectrogram() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cutoffHz = useRepairStore((s) => s.cutoffHz);
  const refCurve = useRepairStore((s) => s.refCurve);
  const reference = useRepairStore((s) => s.reference);
  const cutoffRef = useRef(cutoffHz);
  const curveRef = useRef(refCurve);
  cutoffRef.current = cutoffHz;
  curveRef.current = refCurve;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gfx = canvas.getContext("2d");
    if (!gfx) return;

    const engine = getEngine();
    const ctx = engine.ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 4096;
    an.smoothingTimeConstant = 0.35;
    try {
      engine.preTap.connect(an);
    } catch {
      return;
    }
    const bins = an.frequencyBinCount;
    const freqDb = new Float32Array(bins);
    const binHz = ctx.sampleRate / an.fftSize;

    let raf = 0;
    let alive = true;
    let lastCol = 0;
    const COL_MS = 50; // ~20 columns/s — plenty for a waterfall, ⅓ the old cost
    const OVERLAY_W = 26; // right-edge strip for the Target Lock gap

    const yForFreq = (f: number, h: number) =>
      h - ((Math.log2(f) - Math.log2(F_MIN)) / (Math.log2(F_MAX) - Math.log2(F_MIN))) * h;

    const draw = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      // Sculptor is the default view — don't burn a 4096 FFT + repaint when
      // the window is hidden, the context is stopped, or the frame budget
      // hasn't elapsed. (The waterfall simply pauses; nothing is lost.)
      if (document.hidden || ctx.state !== "running") return;
      if (now - lastCol < COL_MS) return;
      lastCol = now;
      const w = canvas.width;
      const h = canvas.height;
      const specW = w - OVERLAY_W;

      // Scroll the waterfall 2px left.
      gfx.drawImage(canvas, 2, 0, specW - 2, h, 0, 0, specW - 2, h);

      an.getFloatFrequencyData(freqDb);
      // Paint the newest column.
      for (let y = 0; y < h; y++) {
        const f = Math.pow(2, Math.log2(F_MIN) + ((h - y) / h) * (Math.log2(F_MAX) - Math.log2(F_MIN)));
        const k = Math.max(1, Math.min(bins - 1, Math.round(f / binHz)));
        const db = Math.max(-110, Math.min(-20, freqDb[k]));
        const t = (db + 110) / 90; // 0..1
        // Kill-Chain palette: void → deep violet → cyan → white-hot.
        const r = Math.round(20 + t * t * 90 + Math.max(0, t - 0.75) * 4 * 145);
        const g = Math.round(t * t * 180 + Math.max(0, t - 0.8) * 5 * 60);
        const b = Math.round(40 + t * 190);
        gfx.fillStyle = `rgb(${r},${g},${b})`;
        gfx.fillRect(specW - 2, y, 2, 1);
      }

      // Right strip: Target Lock gap overlay (boost = cyan, cut = rose).
      gfx.fillStyle = "rgba(6,8,16,0.95)";
      gfx.fillRect(specW, 0, OVERLAY_W, h);
      const curve = curveRef.current;
      if (curve && curve.length > 0) {
        for (let y = 0; y < h; y++) {
          const f = Math.pow(2, Math.log2(F_MIN) + ((h - y) / h) * (Math.log2(F_MAX) - Math.log2(F_MIN)));
          const db = sampleCurveDb(curve, f);
          const mag = Math.min(1, Math.abs(db) / 8);
          if (mag < 0.04) continue;
          gfx.fillStyle = db > 0
            ? `rgba(34,232,255,${0.15 + mag * 0.75})`
            : `rgba(244,63,94,${0.15 + mag * 0.75})`;
          gfx.fillRect(specW + 2, y, (OVERLAY_W - 4) * mag, 1);
        }
      }

      // Cutoff line.
      const cut = cutoffRef.current;
      if (cut !== null && cut > F_MIN && cut < F_MAX) {
        const y = yForFreq(cut, h);
        gfx.strokeStyle = "rgba(255,210,87,0.85)";
        gfx.setLineDash([6, 4]);
        gfx.beginPath();
        gfx.moveTo(0, y);
        gfx.lineTo(specW, y);
        gfx.stroke();
        gfx.setLineDash([]);
        gfx.fillStyle = "rgba(255,210,87,0.95)";
        gfx.font = "9px monospace";
        gfx.fillText(`cutoff ${(cut / 1000).toFixed(1)}k`, 6, Math.max(10, y - 4));
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      try { engine.preTap.disconnect(an); } catch { /* ignore */ }
      try { an.disconnect(); } catch { /* ignore */ }
    };
  }, []);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.25em] text-dim">
          Live spectrogram · pre-chain
        </div>
        <div className="text-[10px] text-white/45 font-mono">
          {reference ? `overlay: gap vs "${reference.name}"` : cutoffHz ? "overlay: detected cutoff" : "overlays appear after analysis"}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={860}
        height={SPEC_H}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/50"
        style={{ height: SPEC_H }}
      />
    </div>
  );
}
