/**
 * MixerPanel (v1.6 + v2.5.4 stage) — the Fire Command bus mixer.
 * Five strips (Synth A · Synth B · Drums · Samples · Master) with level,
 * pan, mute and solo; a master limiter; sidechain duck; collapsible chrome
 * and a bus-overview stage (display only).
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
import { useFireCollapsed } from "./useFireCollapsed";

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

type MeterEls = { fill: HTMLDivElement; peak: HTMLDivElement };

/** Bus overview — five glowing channels with live energy. Display only. */
function BusOverviewViz({ levels }: { levels: Record<MixerStripId, number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const sizeRef = useRef({ w: 400, h: 56 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(240, Math.floor(wrap.clientWidth));
      const cssH = 56;
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);

    let raf = 0;
    let last = 0;
    const ids: MixerStripId[] = [...MIXER_PARTS, "master"];
    const smooth = new Map<MixerStripId, number>(ids.map((id) => [id, 0]));

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 33) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const lv = levelsRef.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,106,61,0.06)");
      bg.addColorStop(0.5, "rgba(6,8,12,0.5)");
      bg.addColorStop(1, "rgba(98,182,255,0.05)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const gap = 8;
      const pad = 10;
      const slotW = (W - pad * 2 - gap * (ids.length - 1)) / ids.length;

      ids.forEach((id, i) => {
        const meta = STRIP_META[id];
        const target = Math.max(0, Math.min(1.2, lv[id] ?? 0)) / 1.2;
        const prev = smooth.get(id) ?? 0;
        const v = prev + (target - prev) * 0.25;
        smooth.set(id, v);
        const x = pad + i * (slotW + gap);
        const barH = 8 + v * (H - 28);
        const y = H - 14 - barH;

        const g = ctx.createLinearGradient(0, y, 0, H - 14);
        g.addColorStop(0, meta.color);
        g.addColorStop(1, `${meta.color}22`);
        ctx.fillStyle = g;
        ctx.beginPath();
        const r = 4;
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + slotW, y, x + slotW, y + barH, r);
        ctx.arcTo(x + slotW, H - 14, x, H - 14, r);
        ctx.arcTo(x, H - 14, x, y, r);
        ctx.arcTo(x, y, x + slotW, y, r);
        ctx.closePath();
        ctx.fill();

        if (v > 0.05) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = meta.color;
          ctx.fillStyle = `rgba(255,255,255,${0.15 + v * 0.25})`;
          ctx.fillRect(x + 2, y, slotW - 4, 2);
          ctx.shadowBlur = 0;
        }

        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(meta.label.split(" ")[0], x + slotW / 2, H - 3);
      });
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border border-[#ff6a3d]/18 bg-black/40"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 56 }} aria-hidden />
    </div>
  );
}

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
      className="flex min-w-[86px] flex-1 flex-col items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-2"
      title={meta.hint}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-[0.18em]"
        style={{ color: strip.mute ? "rgba(255,255,255,0.3)" : meta.color }}
      >
        {meta.label}
      </span>

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
          className="relative w-[5px] overflow-hidden rounded-full border border-white/8 bg-black/60"
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
      <span className="font-mono text-[9px] text-white/45">{fmtDb(strip.level)}</span>

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
          className={`h-6 w-6 rounded-md border text-[10px] font-bold transition ${
            strip.mute
              ? "border-rose-400/70 bg-rose-500/25 text-rose-200"
              : "border-white/10 bg-white/[0.03] text-white/45 hover:bg-white/[0.08]"
          }`}
          title="Mute"
        >M</button>
        {!isMaster && (
          <button
            onClick={() => setMixerStrip(id, { solo: !strip.solo })}
            className={`h-6 w-6 rounded-md border text-[10px] font-bold transition ${
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
  const [collapsed, toggle] = useFireCollapsed("mixer", false);
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const setFireLimiterOn = useFireSequencerStore((s) => s.setFireLimiterOn);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const duckAmount = useFireSequencerStore((s) => s.duckAmount);
  const duckReleaseMs = useFireSequencerStore((s) => s.duckReleaseMs);
  const duckSource = useFireSequencerStore((s) => s.duckSource);
  const setDuck = useFireSequencerStore((s) => s.setDuck);
  const mixer = useFireSequencerStore((s) => s.mixer);

  const levels: Record<MixerStripId, number> = {
    a: mixer.a.mute ? 0 : mixer.a.level,
    b: mixer.b.mute ? 0 : mixer.b.level,
    drums: mixer.drums.mute ? 0 : mixer.drums.level,
    samples: mixer.samples.mute ? 0 : mixer.samples.level,
    master: mixer.master.mute ? 0 : mixer.master.level,
  };

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
      <div className={`flex items-center justify-between gap-2 ${collapsed ? "" : "mb-2"}`}>
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={collapsed ? "Expand Fire Mixer" : "Collapse Fire Mixer"}
        >
          <span className="text-[9px] text-white/45">{collapsed ? "▸" : "▾"}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: FIRE }}>
            Fire Mixer
          </span>
          <span className="text-[9px] normal-case tracking-normal text-white/30">· bus before Kill-Chain</span>
        </button>
        {!collapsed && (
          <button
            onClick={() => setFireLimiterOn(!fireLimiterOn)}
            className={`h-6 px-2.5 rounded-md text-[10px] font-bold border transition ${
              fireLimiterOn
                ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0]"
                : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title="Master limiter on the Fire output — glue + overload protection"
          >
            {fireLimiterOn ? "● LIMITER" : "○ LIMITER"}
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <BusOverviewViz levels={levels} />

          <div className="flex flex-wrap items-stretch gap-2">
            {([...MIXER_PARTS, "master"] as MixerStripId[]).map((id) => (
              <Strip key={id} id={id} registerMeter={registerMeter} />
            ))}

            <div
              className={`flex min-w-[168px] flex-col gap-1.5 rounded-xl border px-3 py-2 transition ${
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
                  title="Duck the synth (A+B) path on every hit of the source lane"
                >{duckEnabled ? "ON" : "OFF"}</button>
              </div>

              <label className="flex items-center gap-1.5 text-[10px] text-dim">
                <span className="w-12 uppercase tracking-wider">Source</span>
                <select
                  value={duckSource}
                  onChange={(e) => setDuck({ source: e.target.value as typeof duckSource })}
                  className="flex-1 rounded-md border border-white/12 bg-black/40 px-1.5 py-0.5 text-[11px] text-white/85 outline-none"
                >
                  {DRUM_LANES.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-[10px] text-dim">
                <span className="w-12 uppercase tracking-wider">Amount</span>
                <input
                  type="range" min={0} max={1} step={0.02} value={duckAmount}
                  onChange={(e) => setDuck({ amount: Number(e.target.value) })}
                  className="flex-1" style={{ accentColor: FIRE }}
                />
                <span className="w-8 text-right font-mono text-white/50">{Math.round(duckAmount * 100)}%</span>
              </label>

              <label className="flex items-center gap-1.5 text-[10px] text-dim">
                <span className="w-12 uppercase tracking-wider">Release</span>
                <input
                  type="range" min={40} max={800} step={10} value={duckReleaseMs}
                  onChange={(e) => setDuck({ releaseMs: Number(e.target.value) })}
                  className="flex-1" style={{ accentColor: FIRE }}
                />
                <span className="w-8 text-right font-mono text-white/50">{duckReleaseMs}ms</span>
              </label>
            </div>
          </div>
          <div className="mt-2 text-center text-[10px] text-dim">
            Bus deck — overview bars mirror fader levels · meters show live RMS/peak · sidechain pumps A+B.
          </div>
        </>
      )}
    </GlassPanel>
  );
}
