/**
 * MixerPanel (v2.5.5) — Fire Command bus console.
 * Five strips (Synth A · Synth B · Drums · Samples · Master) with level,
 * pan, mute and solo; master limiter; sidechain duck. Display stage only —
 * mixing math unchanged.
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
import { CollapseToggle } from "./CollapseToggle";

const FIRE = "#ff6a3d";
const ICE = "#62b6ff";
const GRN = "#9be564";
const AMB = "#ffcf5c";

const STRIP_META: Record<MixerStripId, { label: string; short: string; color: string; hint: string }> = {
  a: { label: "SYNTH A", short: "A", color: FIRE, hint: "Playable Fire Command synth" },
  b: { label: "SYNTH B", short: "B", color: ICE, hint: "Second instrument (preset-voiced)" },
  drums: { label: "DRUMS", short: "DRM", color: GRN, hint: "Synthesized drum kit" },
  samples: { label: "SAMPLES", short: "SMP", color: AMB, hint: "Sample deck lanes" },
  master: { label: "MASTER", short: "MST", color: "#ffffff", hint: "Summed Fire output (pre Kill-Chain FX)" },
};

const fmtDb = (level: number) =>
  level <= 0.001 ? "-∞" : `${(20 * Math.log10(level)).toFixed(1)} dB`;

type MeterEls = { fill: HTMLDivElement; peak: HTMLDivElement };

/** Signal-flow summing bay — parts feed Master left→right. Display only. */
function BusFlowViz({
  levels,
  live,
}: {
  levels: Record<MixerStripId, number>;
  live: Record<MixerStripId, number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const levelsRef = useRef(levels);
  const liveRef = useRef(live);
  levelsRef.current = levels;
  liveRef.current = live;
  const sizeRef = useRef({ w: 480, h: 72 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(280, Math.floor(wrap.clientWidth));
      const cssH = 72;
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
    const parts: MixerStripId[] = [...MIXER_PARTS];
    const smooth = new Map<MixerStripId, number>(
      ([...parts, "master" as const] as MixerStripId[]).map((id) => [id, 0]),
    );

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 33) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const lv = levelsRef.current;
      const liv = liveRef.current;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(255,106,61,0.08)");
      bg.addColorStop(0.5, "rgba(6,8,12,0.55)");
      bg.addColorStop(1, "rgba(255,255,255,0.04)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const masterX = W - 70;
      const masterY = H * 0.42;
      const partY = H * 0.42;
      const gap = (masterX - 90) / Math.max(1, parts.length - 1);

      // Feed lines into master
      parts.forEach((id, i) => {
        const meta = STRIP_META[id];
        const target = Math.max(lv[id] ?? 0, liv[id] ?? 0);
        const prev = smooth.get(id) ?? 0;
        const v = prev + (target - prev) * 0.22;
        smooth.set(id, v);
        const x = 36 + i * gap;
        ctx.strokeStyle = `${meta.color}${Math.round(40 + v * 140).toString(16).padStart(2, "0")}`;
        ctx.lineWidth = 1.2 + v * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, partY + 10);
        ctx.quadraticCurveTo((x + masterX) / 2, H * 0.78, masterX - 16, masterY + 4);
        ctx.stroke();

        const barH = 10 + v * 22;
        const g = ctx.createLinearGradient(0, partY - barH, 0, partY + 8);
        g.addColorStop(0, meta.color);
        g.addColorStop(1, `${meta.color}22`);
        ctx.fillStyle = g;
        ctx.fillRect(x - 10, partY - barH, 20, barH + 8);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(meta.short, x, H - 8);
      });

      const mPrev = smooth.get("master") ?? 0;
      const mTarget = Math.max(lv.master ?? 0, liv.master ?? 0);
      const mV = mPrev + (mTarget - mPrev) * 0.22;
      smooth.set("master", mV);
      const mH = 14 + mV * 26;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + mV * 0.55})`;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(255,255,255,0.4)";
      ctx.fillRect(masterX - 14, masterY - mH, 28, mH + 10);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("MASTER", masterX, H - 8);

      ctx.fillStyle = "rgba(255,106,61,0.45)";
      ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("PARTS → SUM", 10, 12);
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
      className="relative mb-3 overflow-hidden rounded-xl border border-[#ff6a3d]/22 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 72 }} aria-hidden />
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

  const panLabel =
    strip.pan === 0 ? "C" : strip.pan < 0 ? `L${Math.round(-strip.pan * 100)}` : `R${Math.round(strip.pan * 100)}`;

  return (
    <div
      className={`flex min-w-[96px] flex-1 flex-col items-center gap-2 rounded-2xl border px-2.5 py-2.5 ${
        isMaster
          ? "border-white/25 bg-gradient-to-b from-white/[0.07] to-white/[0.02]"
          : "border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent"
      }`}
      style={{
        boxShadow: isMaster
          ? "0 0 24px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)"
          : `0 0 18px ${meta.color}14, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
      title={meta.hint}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ color: strip.mute ? "rgba(255,255,255,0.28)" : meta.color }}
        >
          {meta.label}
        </span>
        {!isMaster && (
          <span className="font-mono text-[9px] text-white/35">{panLabel}</span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="relative flex flex-col items-center">
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
              width: 22,
              height: 110,
              accentColor: meta.color,
            }}
            aria-label={`${meta.label} level`}
            title={`Level: ${fmtDb(strip.level)} — double-click to reset`}
          />
        </div>
        <div
          className="relative w-[7px] overflow-hidden rounded-full border border-white/10 bg-black/70"
          style={{ height: 110 }}
          title="Live level (RMS fill, peak tick)"
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-2 opacity-40"
            style={{ background: "linear-gradient(180deg, #ff5d5d, transparent)" }}
          />
          <div
            ref={fillRef}
            className="absolute bottom-0 left-0 right-0"
            style={{
              height: "0%",
              background: `linear-gradient(180deg, ${meta.color}, ${meta.color}55)`,
              transition: "height 60ms linear",
              boxShadow: `0 0 8px ${meta.color}`,
            }}
          />
          <div
            ref={peakRef}
            className="absolute left-0 right-0 h-[2px]"
            style={{ bottom: "0%", background: "rgba(255,255,255,0.85)", opacity: 0 }}
          />
        </div>
      </div>

      <span className="font-mono text-[10px] text-white/55">{fmtDb(strip.level)}</span>

      {!isMaster && (
        <div className="flex w-full flex-col items-center gap-0.5">
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={strip.pan}
            onChange={(e) => setMixerStrip(id, { pan: Number(e.target.value) })}
            onDoubleClick={() => setMixerStrip(id, { pan: 0 })}
            className="w-full"
            style={{ accentColor: meta.color }}
            aria-label={`${meta.label} pan`}
            title={`Pan: ${panLabel} — double-click to center`}
          />
          <div className="flex w-full justify-between px-0.5 text-[8px] uppercase tracking-wider text-white/25">
            <span>L</span><span>C</span><span>R</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setMixerStrip(id, { mute: !strip.mute })}
          className={`h-7 w-7 rounded-lg border text-[11px] font-bold transition ${
            strip.mute
              ? "border-rose-400/70 bg-rose-500/25 text-rose-200 shadow-[0_0_12px_rgba(251,113,133,0.35)]"
              : "border-white/12 bg-white/[0.04] text-white/45 hover:bg-white/[0.1]"
          }`}
          title="Mute"
        >M</button>
        {!isMaster && (
          <button
            onClick={() => setMixerStrip(id, { solo: !strip.solo })}
            className={`h-7 w-7 rounded-lg border text-[11px] font-bold transition ${
              strip.solo
                ? "border-amber-400/70 bg-amber-400/25 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                : "border-white/12 bg-white/[0.04] text-white/45 hover:bg-white/[0.1]"
            }`}
            title="Solo (mutes every non-solo part)"
          >S</button>
        )}
      </div>
    </div>
  );
}

function SidechainRack() {
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const duckAmount = useFireSequencerStore((s) => s.duckAmount);
  const duckReleaseMs = useFireSequencerStore((s) => s.duckReleaseMs);
  const duckSource = useFireSequencerStore((s) => s.duckSource);
  const setDuck = useFireSequencerStore((s) => s.setDuck);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 40) return;
      last = t;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = duckEnabled ? "rgba(255,106,61,0.08)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(0, 0, W, H);
      const mid = H * 0.55;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const u = x / W;
        const pulse = duckEnabled
          ? Math.max(0, 1 - ((u * 3 + (t / 900) * duckAmount) % 1) * (1.4 + duckAmount))
          : 0.15;
        const y = mid - pulse * (H * 0.35) * (0.35 + duckAmount * 0.65);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = duckEnabled ? FIRE : "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [duckEnabled, duckAmount]);

  return (
    <div
      className={`flex min-w-[200px] max-w-[240px] flex-col gap-2 rounded-2xl border px-3 py-2.5 transition ${
        duckEnabled
          ? "border-[#ff6a3d]/45 bg-gradient-to-b from-[#ff6a3d]/[0.1] to-transparent shadow-[0_0_20px_rgba(255,106,61,0.12)]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color: duckEnabled ? FIRE : "rgba(255,255,255,0.4)" }}
          >Sidechain</div>
          <div className="text-[9px] text-white/30">ducks Synth A+B</div>
        </div>
        <button
          onClick={() => setDuck({ enabled: !duckEnabled })}
          className={`h-7 px-2.5 rounded-lg text-[10px] font-bold border transition ${
            duckEnabled
              ? "border-[#ff6a3d]/70 bg-[#ff6a3d]/20 text-[#ffbfa0] shadow-[0_0_12px_rgba(255,106,61,0.3)]"
              : "border-white/10 bg-white/[0.03] text-white/45"
          }`}
          title="Duck the synth (A+B) path on every hit of the source lane"
        >{duckEnabled ? "ON" : "OFF"}</button>
      </div>

      <canvas ref={canvasRef} width={200} height={36} className="w-full rounded-lg border border-white/8 bg-black/40" aria-hidden />

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
  );
}

export function MixerPanel() {
  const [collapsed, toggle] = useFireCollapsed("mixer", false);
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const setFireLimiterOn = useFireSequencerStore((s) => s.setFireLimiterOn);
  const mixer = useFireSequencerStore((s) => s.mixer);

  const levels: Record<MixerStripId, number> = {
    a: mixer.a.mute ? 0 : mixer.a.level,
    b: mixer.b.mute ? 0 : mixer.b.level,
    drums: mixer.drums.mute ? 0 : mixer.drums.level,
    samples: mixer.samples.mute ? 0 : mixer.samples.level,
    master: mixer.master.mute ? 0 : mixer.master.level,
  };

  const liveRef = useRef<Record<MixerStripId, number>>({
    a: 0, b: 0, drums: 0, samples: 0, master: 0,
  });

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
        liveRef.current[id] = norm(rms);
        if (!els) continue;
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
          className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={collapsed ? "Expand Fire Mixer" : "Collapse Fire Mixer"}
        >
          <CollapseToggle collapsed={collapsed} color={FIRE} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: FIRE }}>
            Fire Mixer
          </span>
          <span className="text-[9px] normal-case tracking-normal text-white/35">· parts sum before Kill-Chain</span>
        </button>
        {!collapsed && (
          <button
            onClick={() => setFireLimiterOn(!fireLimiterOn)}
            className={`h-7 px-3 rounded-lg text-[10px] font-bold border transition ${
              fireLimiterOn
                ? "border-[#9be564]/60 bg-[#9be564]/12 text-[#d3f5b0] shadow-[0_0_12px_rgba(155,229,100,0.25)]"
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
          <BusFlowViz levels={levels} live={liveRef.current} />

          <div className="mb-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-white/30">
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5">Inputs</span>
            <span className="text-white/15">→</span>
            <span className="rounded-md border border-white/15 bg-white/[0.05] px-2 py-0.5 text-white/50">Master bus</span>
            <span className="text-white/15">→</span>
            <span className="rounded-md border border-[#ff6a3d]/25 bg-[#ff6a3d]/10 px-2 py-0.5 text-[#ffbfa0]">Kill-Chain</span>
          </div>

          <div className="flex flex-wrap items-stretch gap-2.5">
            {([...MIXER_PARTS] as MixerStripId[]).map((id) => (
              <Strip key={id} id={id} registerMeter={registerMeter} />
            ))}
            <div className="hidden w-px self-stretch bg-white/10 sm:block" aria-hidden />
            <Strip id="master" registerMeter={registerMeter} />
            <SidechainRack />
          </div>
          <div className="mt-2.5 text-center text-[10px] text-dim">
            Console deck — A/B/Drums/Samples feed Master · meters are live RMS/peak · sidechain pumps A+B.
          </div>
        </>
      )}
    </GlassPanel>
  );
}
