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
import { useFireBandRegister } from "./FireBand";
import { useFireLayout } from "./FireLayoutContext";
import { ensureExpanded } from "./fireNavigate";

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

/** Meter bridge — five equal channel columns that mirror the strips below. */
function MeterBridge({
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
  const sizeRef = useRef({ w: 480, h: 88 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      const cssH = 88;
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);

    let raf = 0;
    let last = 0;
    const ids: MixerStripId[] = [...MIXER_PARTS, "master"];
    const smooth = new Map<MixerStripId, number>(ids.map((id) => [id, 0] as const));
    const peakHold = new Map<MixerStripId, number>(ids.map((id) => [id, 0] as const));

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 28) return;
      last = t;
      const { w: W, h: H } = sizeRef.current;
      const lv = levelsRef.current;
      const liv = liveRef.current;
      ctx.clearRect(0, 0, W, H);

      // Dark console plate
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "rgba(18,14,12,0.95)");
      bg.addColorStop(1, "rgba(6,6,8,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Top rule
      ctx.strokeStyle = "rgba(255,106,61,0.22)";
      ctx.beginPath();
      ctx.moveTo(8, 1);
      ctx.lineTo(W - 8, 1);
      ctx.stroke();

      const padX = 12;
      const gap = 10;
      const slotW = (W - padX * 2 - gap * (ids.length - 1)) / ids.length;
      const meterTop = 14;
      const meterBot = H - 18;
      const meterH = meterBot - meterTop;
      const segs = 16;

      ids.forEach((id, i) => {
        const meta = STRIP_META[id];
        const fader = Math.max(0, Math.min(1.2, lv[id] ?? 0)) / 1.2;
        const signal = Math.max(0, Math.min(1, liv[id] ?? 0));
        const target = Math.max(fader * 0.35, signal);
        const prev = smooth.get(id) ?? 0;
        const v = prev + (target - prev) * 0.28;
        smooth.set(id, v);
        const held = Math.max(v, (peakHold.get(id) ?? 0) * 0.97);
        peakHold.set(id, held);

        const x = padX + i * (slotW + gap);
        const isMaster = id === "master";

        // Slot plate
        ctx.fillStyle = isMaster ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
        ctx.fillRect(x, meterTop - 4, slotW, meterH + 8);
        ctx.strokeStyle = isMaster ? "rgba(255,255,255,0.18)" : `${meta.color}33`;
        ctx.strokeRect(x + 0.5, meterTop - 3.5, slotW - 1, meterH + 7);

        // Activity bloom under live signal
        if (v > 0.04) {
          const bloom = ctx.createRadialGradient(x + slotW / 2, meterBot - v * meterH, 0, x + slotW / 2, meterBot, slotW * 0.7);
          bloom.addColorStop(0, `${meta.color}33`);
          bloom.addColorStop(1, `${meta.color}00`);
          ctx.fillStyle = bloom;
          ctx.fillRect(x, meterTop, slotW, meterH);
        }

        // Segmented LED meter
        const barW = Math.min(22, slotW * 0.38);
        const barX = x + (slotW - barW) / 2;
        for (let s = 0; s < segs; s++) {
          const thresh = (s + 1) / segs;
          const y = meterBot - (s + 1) * (meterH / segs) + 1;
          const segH = meterH / segs - 2;
          const on = v >= thresh - 0.02;
          let col = meta.color;
          if (thresh > 0.85) col = "#ff5d5d";
          else if (thresh > 0.7) col = "#ffcf5c";
          ctx.fillStyle = on ? col : "rgba(255,255,255,0.06)";
          if (on) {
            ctx.shadowBlur = 6;
            ctx.shadowColor = col;
          }
          ctx.fillRect(barX, y, barW, segH);
          ctx.shadowBlur = 0;
        }

        // Peak tick
        if (held > 0.02) {
          const py = meterBot - held * meterH;
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(barX - 2, py - 1, barW + 4, 2);
        }

        // Fader-level ghost (thin line showing trim, not live)
        const fy = meterBot - fader * meterH;
        ctx.strokeStyle = `${meta.color}66`;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(barX - 4, fy);
        ctx.lineTo(barX + barW + 4, fy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = meta.color;
        ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(meta.short, x + slotW / 2, H - 5);
      });

      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("METER BRIDGE", 12, 11);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillText("solid = live · dashed = fader", W - 12, 11);
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
      className="relative mb-3 overflow-hidden rounded-xl border border-white/12 bg-black/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      title="Live meters for each bus — same order as the channel strips below"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 88 }} aria-hidden />
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
      className={`flex h-full min-w-0 flex-col items-center gap-2 rounded-2xl border px-2 py-2.5 ${
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
      <div className="flex w-full items-center justify-between gap-1 min-w-0">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.16em] truncate min-w-0"
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 200, h: 44 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      const cssH = 44;
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 32) return;
      last = t;
      const W = sizeRef.current.w;
      const H = sizeRef.current.h;
      ctx.clearRect(0, 0, W, H);
      
      // Bus theater backdrop — gradient stage with depth
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      if (duckEnabled) {
        bgGrad.addColorStop(0, "rgba(255,106,61,0.14)");
        bgGrad.addColorStop(0.5, "rgba(20,10,8,0.85)");
        bgGrad.addColorStop(1, "rgba(255,106,61,0.08)");
      } else {
        bgGrad.addColorStop(0, "rgba(255,255,255,0.04)");
        bgGrad.addColorStop(0.5, "rgba(8,8,10,0.9)");
        bgGrad.addColorStop(1, "rgba(255,255,255,0.02)");
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);
      
      // Theater grid lines — stage depth markers
      ctx.strokeStyle = duckEnabled ? "rgba(255,106,61,0.1)" : "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const y = (H / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      
      // Center rail — ducking reference line
      const mid = H * 0.55;
      ctx.strokeStyle = duckEnabled ? "rgba(255,106,61,0.25)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
      
      const rel = Math.max(0.15, Math.min(1.2, duckReleaseMs / 400));
      const breathe = duckEnabled ? 0.95 + 0.05 * Math.sin(t / 1200) : 1;
      
      // Ghost trail curves — previous waveform echoes
      if (duckEnabled) {
        for (let ghost = 0; ghost < 2; ghost++) {
          ctx.beginPath();
          const ghostPhase = ghost * 0.15;
          for (let x = 0; x <= W; x++) {
            const u = x / Math.max(1, W);
            const pulse = Math.max(0, 1 - ((u * 2.6 + (t / 850) * (0.4 + duckAmount) - ghostPhase) % 1) * (1.2 + duckAmount * 0.9) / rel);
            const y = mid - pulse * (H * 0.38) * (0.3 + duckAmount * 0.7) * breathe;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(255,106,61,${0.15 - ghost * 0.08})`;
          ctx.lineWidth = 2 - ghost * 0.5;
          ctx.stroke();
        }
      }
      
      // Main ducking curve — primary performance wave
      ctx.beginPath();
      const curvePoints: [number, number][] = [];
      for (let x = 0; x <= W; x++) {
        const u = x / Math.max(1, W);
        const pulse = duckEnabled
          ? Math.max(0, 1 - ((u * 2.6 + (t / 850) * (0.4 + duckAmount)) % 1) * (1.2 + duckAmount * 0.9) / rel)
          : 0.12;
        const y = mid - pulse * (H * 0.38) * (0.3 + duckAmount * 0.7) * breathe;
        curvePoints.push([x, y]);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      
      // Outer glow stroke
      ctx.strokeStyle = duckEnabled ? FIRE : "rgba(255,255,255,0.18)";
      ctx.lineWidth = duckEnabled ? 3.5 : 1.8;
      ctx.shadowBlur = duckEnabled ? 12 : 0;
      ctx.shadowColor = duckEnabled ? FIRE : "transparent";
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      // Inner bright core
      if (duckEnabled) {
        ctx.beginPath();
        curvePoints.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "rgba(255,200,180,0.9)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      
      // Theatrical fill under curve — stage lighting effect
      if (duckEnabled) {
        ctx.beginPath();
        curvePoints.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.lineTo(W, mid);
        ctx.lineTo(0, mid);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, mid);
        fillGrad.addColorStop(0, "rgba(255,106,61,0.22)");
        fillGrad.addColorStop(1, "rgba(255,106,61,0.05)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }
      
      // Energy particles at peak points
      if (duckEnabled) {
        for (let i = 0; i < curvePoints.length; i += Math.floor(W / 12)) {
          const [px, py] = curvePoints[i];
          const intensity = 1 - (py / mid);
          if (intensity > 0.4) {
            const particleGrad = ctx.createRadialGradient(px, py, 0, px, py, 4 + intensity * 3);
            particleGrad.addColorStop(0, "rgba(255,220,200,0.9)");
            particleGrad.addColorStop(0.5, "rgba(255,106,61,0.5)");
            particleGrad.addColorStop(1, "rgba(255,106,61,0)");
            ctx.fillStyle = particleGrad;
            ctx.beginPath();
            ctx.arc(px, py, 4 + intensity * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [duckEnabled, duckAmount, duckReleaseMs]);

  return (
    <div
      className={`flex h-full min-w-0 flex-col gap-2 rounded-2xl border px-3 py-2.5 transition ${
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
          <div className="text-[9px] text-white/30">ducks Synth A · B stays solid</div>
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

      <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border border-white/8 bg-black/40">
        <canvas ref={canvasRef} className="block w-full" aria-hidden />
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
  );
}

export function MixerPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const [collapsed, toggle] = useFireCollapsed("mixer", false);
  const { focusActive, focusId, isFocused } = useFireLayout();
  useFireBandRegister("mixer", "Fire Mixer", FIRE, collapsed, toggle, chipHosted);
  useEffect(() => {
    if (isFocused("mixer") && collapsed) ensureExpanded("mixer");
  }, [collapsed, isFocused]);
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

  if (focusActive && focusId !== "mixer") return null;
  if (chipHosted && collapsed && !isFocused("mixer")) return null;

  return (
    <GlassPanel intense className="p-3" data-fire-module="mixer">
      <div className={`flex items-center justify-between gap-2 ${collapsed && !isFocused("mixer") ? "" : "mb-2"}`}>
        <button
          onClick={toggle}
          aria-expanded={!collapsed || isFocused("mixer")}
          className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={collapsed ? "Expand Fire Mixer" : "Collapse Fire Mixer"}
        >
          <CollapseToggle collapsed={collapsed && !isFocused("mixer")} color={FIRE} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: FIRE }}>
            Fire Mixer
          </span>
          <span className="text-[9px] normal-case tracking-normal text-white/35">· parts sum before Kill-Chain</span>
        </button>
        {(!collapsed || isFocused("mixer")) && (
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

      {(!collapsed || isFocused("mixer")) && (
        <>
          <MeterBridge levels={levels} live={liveRef.current} />

          <div className="mb-2 grid grid-cols-5 gap-1 text-center text-[8px] uppercase tracking-[0.16em] text-white/30">
            <span>Synth A</span>
            <span>Synth B</span>
            <span>Drums</span>
            <span>Samples</span>
            <span className="text-white/50">Master</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {([...MIXER_PARTS, "master"] as MixerStripId[]).map((id) => (
              <Strip key={id} id={id} registerMeter={registerMeter} />
            ))}
          </div>
          <div className="mt-2.5">
            <SidechainRack />
          </div>
        </>
      )}
    </GlassPanel>
  );
}
