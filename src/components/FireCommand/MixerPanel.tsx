/**
 * MixerPanel (v1.6) — the Fire Command bus mixer.
 * Five strips (Synth A · Synth B · Drums · Samples · Master) with level,
 * pan, mute and solo; a master limiter switch; and the sidechain duck
 * (any drum lane pumps the synth path — amount + release).
 */

import { useEffect, useRef } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { DRUM_LANES } from "@/audio/dsp/FireDrumKit";
import { getEngine } from "@/audio/AudioEngine";
import {
  useFireSequencerStore,
  MIXER_PARTS,
  type MixerStripId,
} from "@/state/fireSequencerStore";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const GRN = "#9be564";
const AMB = "#ffcf5c";

const STRIP_META: Record<MixerStripId, { label: string; color: string; hint: string }> = {
  a: { label: "SYNTH A", color: FIRE, hint: "The playable Fire Command synth" },
  b: { label: "SYNTH B", color: ICE, hint: "The second instrument (preset-voiced)" },
  drums: { label: "DRUMS", color: GRN, hint: "The synthesized drum kit (incl. lane sample overrides)" },
  samples: { label: "SAMPLES", color: AMB, hint: "The sample deck lanes" },
  master: { label: "MASTER", color: "#ffffff", hint: "The summed Fire output (pre Kill-Chain FX)" },
};

const fmtDb = (level: number) =>
  level <= 0.001 ? "-∞" : `${(20 * Math.log10(level)).toFixed(1)} dB`;

/** Registry the RAF meter loop writes into (fill + peak-tick elements). */
type MeterEls = { fill: HTMLDivElement; peak: HTMLDivElement };

function Strip({
  id,
  registerMeter,
}: {
  id: MixerStripId;
  registerMeter: (id: MixerStripId, els: MeterEls | null) => void;
}) {
  const strip = useFireSequencerStore((s) => s.mixer[id]);
  const setMixerStrip = useFireSequencerStore((s) => s.setMixerStrip);
  const meta = STRIP_META[id];
  const isMaster = id === "master";
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fillRef.current && peakRef.current) {
      registerMeter(id, { fill: fillRef.current, peak: peakRef.current });
    }
    return () => registerMeter(id, null);
  }, [id, registerMeter]);

  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-2 min-w-[86px]"
      title={meta.hint}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-[0.18em]"
        style={{ color: strip.mute ? "rgba(255,255,255,0.3)" : meta.color }}
      >
        {meta.label}
      </span>

      {/* fader + live meter (v1.7) */}
      <div className="flex items-end gap-1.5">
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.02}
          value={strip.level}
          onChange={(e) => setMixerStrip(id, { level: Number(e.target.value) })}
          onDoubleClick={() => setMixerStrip(id, { level: 1 })}
          className="fire-fader"
          style={{
            writingMode: "vertical-lr",
            direction: "rtl",
            width: 18,
            height: 84,
            accentColor: meta.color,
          }}
          aria-label={`${meta.label} level`}
          title={`Level: ${fmtDb(strip.level)} — double-click to reset`}
        />
        <div
          className="relative w-[5px] rounded-full bg-black/60 border border-white/8 overflow-hidden"
          style={{ height: 84 }}
          title="Live level (RMS fill, peak tick)"
        >
          <div
            ref={fillRef}
            className="absolute bottom-0 left-0 right-0"
            style={{
              height: "0%",
              background: `linear-gradient(180deg, ${meta.color}, ${meta.color}66)`,
              transition: "height 60ms linear",
            }}
          />
          <div
            ref={peakRef}
            className="absolute left-0 right-0 h-[2px]"
            style={{ bottom: "0%", background: "rgba(255,255,255,0.85)", opacity: 0 }}
          />
        </div>
      </div>
      <span className="text-[9px] font-mono text-white/45">{fmtDb(strip.level)}</span>

      {/* pan (not on master) */}
      {!isMaster && (
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={strip.pan}
          onChange={(e) => setMixerStrip(id, { pan: Number(e.target.value) })}
          onDoubleClick={() => setMixerStrip(id, { pan: 0 })}
          className="w-[64px]"
          style={{ accentColor: meta.color }}
          aria-label={`${meta.label} pan`}
          title={`Pan: ${strip.pan === 0 ? "C" : strip.pan < 0 ? `L${Math.round(-strip.pan * 100)}` : `R${Math.round(strip.pan * 100)}`} — double-click to center`}
        />
      )}

      <div className="flex items-center gap-1">
        <button
          onClick={() => setMixerStrip(id, { mute: !strip.mute })}
          className={`w-6 h-6 rounded-md text-[10px] font-bold border transition ${
            strip.mute
              ? "border-rose-400/70 bg-rose-500/25 text-rose-200"
              : "border-white/10 bg-white/[0.03] text-white/45 hover:bg-white/[0.08]"
          }`}
          title="Mute"
        >M</button>
        {!isMaster && (
          <button
            onClick={() => setMixerStrip(id, { solo: !strip.solo })}
            className={`w-6 h-6 rounded-md text-[10px] font-bold border transition ${
              strip.solo
                ? "border-amber-400/70 bg-amber-400/25 text-amber-200"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:bg-white/[0.08]"
            }`}
            title="Solo (mutes every non-solo part)"
          >S</button>
        )}
      </div>
    </div>
  );
}

export function MixerPanel() {
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const setFireLimiterOn = useFireSequencerStore((s) => s.setFireLimiterOn);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const duckAmount = useFireSequencerStore((s) => s.duckAmount);
  const duckReleaseMs = useFireSequencerStore((s) => s.duckReleaseMs);
  const duckSource = useFireSequencerStore((s) => s.duckSource);
  const setDuck = useFireSequencerStore((s) => s.setDuck);

  // ── live meters (v1.7): one analyser per part tap + the master tap ──
  const meterEls = useRef(new Map<MixerStripId, MeterEls>());
  const registerMeter = useRef((id: MixerStripId, els: MeterEls | null) => {
    if (els) meterEls.current.set(id, els);
    else meterEls.current.delete(id);
  }).current;

  useEffect(() => {
    const engine = getEngine();
    const analysers = new Map<MixerStripId, AnalyserNode>();
    const taps = new Map<MixerStripId, AudioNode>();
    const buf = new Float32Array(1024);
    for (const id of [...MIXER_PARTS, "master"] as MixerStripId[]) {
      const an = engine.ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0;
      const tap = id === "master" ? engine.fireTap : engine.getFirePartTap(id);
      tap.connect(an);
      analysers.set(id, an);
      taps.set(id, tap);
    }
    // Peak-hold state per strip (decays ~1.5%/frame).
    const peakHold = new Map<MixerStripId, number>();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      for (const [id, an] of analysers) {
        const els = meterEls.current.get(id);
        if (!els) continue;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
          const a = Math.abs(v);
          if (a > peak) peak = a;
        }
        const rms = Math.sqrt(sum / buf.length);
        // -60 dB..0 dB → 0..1
        const norm = (v: number) =>
          v <= 0.001 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(v) + 60) / 60));
        const held = Math.max(peak, (peakHold.get(id) ?? 0) * 0.985);
        peakHold.set(id, held);
        els.fill.style.height = `${norm(rms) * 100}%`;
        const pn = norm(held);
        els.peak.style.bottom = `${pn * 100}%`;
        els.peak.style.opacity = pn > 0.01 ? "1" : "0";
        els.peak.style.background = held >= 1 ? "#ff5d5d" : "rgba(255,255,255,0.85)";
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const [id, an] of analysers) {
        try { taps.get(id)?.disconnect(an); } catch { /* already gone */ }
      }
    };
  }, []);

  return (
    <GlassPanel intense className="p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.25em] text-dim">
          Fire Mixer <span className="text-white/25 normal-case tracking-normal">· bus levels before the Kill-Chain</span>
        </span>
        <button
          onClick={() => setFireLimiterOn(!fireLimiterOn)}
          className={`h-6 px-2.5 rounded-md text-[10px] font-bold border transition ${
            fireLimiterOn
              ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]"
              : "border-white/10 bg-white/[0.03] text-white/40"
          }`}
          title="Master limiter on the Fire output — glue + overload protection (the hard safety clipper always stays on)"
        >
          {fireLimiterOn ? "● LIMITER" : "○ LIMITER"}
        </button>
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {([...MIXER_PARTS, "master"] as MixerStripId[]).map((id) => (
          <Strip key={id} id={id} registerMeter={registerMeter} />
        ))}

        {/* sidechain duck */}
        <div
          className={`flex flex-col gap-1.5 rounded-xl border px-3 py-2 min-w-[168px] transition ${
            duckEnabled ? "border-[#ff6a3d]/40 bg-[#ff6a3d]/[0.05]" : "border-white/8 bg-white/[0.02]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: duckEnabled ? FIRE : "rgba(255,255,255,0.4)" }}
            >Sidechain</span>
            <button
              onClick={() => setDuck({ enabled: !duckEnabled })}
              className={`h-5 px-2 rounded-md text-[10px] font-bold border transition ${
                duckEnabled
                  ? "border-[#ff6a3d]/70 bg-[#ff6a3d]/20 text-[#ffbfa0]"
                  : "border-white/10 bg-white/[0.03] text-white/45"
              }`}
              title="Duck the synth (A+B) path on every hit of the source lane — the classic EDM pump"
            >{duckEnabled ? "ON" : "OFF"}</button>
          </div>

          <label className="flex items-center gap-1.5 text-[10px] text-dim">
            <span className="w-12 uppercase tracking-wider">Source</span>
            <select
              value={duckSource}
              onChange={(e) => setDuck({ source: e.target.value as typeof duckSource })}
              className="flex-1 rounded-md border border-white/12 bg-black/40 px-1.5 py-0.5 text-[11px] text-white/85 outline-none"
              title="Which drum lane triggers the duck"
            >
              {DRUM_LANES.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[10px] text-dim">
            <span className="w-12 uppercase tracking-wider">Amount</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={duckAmount}
              onChange={(e) => setDuck({ amount: Number(e.target.value) })}
              className="flex-1"
              style={{ accentColor: FIRE }}
              title="How deep the synths dip on each hit"
            />
            <span className="w-8 text-right font-mono text-white/50">{Math.round(duckAmount * 100)}%</span>
          </label>

          <label className="flex items-center gap-1.5 text-[10px] text-dim">
            <span className="w-12 uppercase tracking-wider">Release</span>
            <input
              type="range"
              min={40}
              max={800}
              step={10}
              value={duckReleaseMs}
              onChange={(e) => setDuck({ releaseMs: Number(e.target.value) })}
              className="flex-1"
              style={{ accentColor: FIRE }}
              title="How long the synths take to swell back up"
            />
            <span className="w-8 text-right font-mono text-white/50">{duckReleaseMs}ms</span>
          </label>
        </div>
      </div>
    </GlassPanel>
  );
}
