/**
 * MixerPanel — Sum Deck bus console (Signal Path Mix · FC.mixer).
 * Five strips + limiter + sidechain. Display polished; mixing math unchanged.
 */

import { useEffect, useRef } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ModuleBackdrop } from "./ModuleBackdrop";
import { DRUM_LANES } from "@/audio/dsp/FireDrumKit";
import { getEngine } from "@/audio/AudioEngine";
import { FIRE_LIMITER_CEILING_DB, fmtGrDb, peakToDbfs } from "@/audio/dsp/mixClarity";
import {
  useFireSequencerStore,
  MIXER_PARTS,
  type MixerStripId,
  type SoloMode,
} from "@/state/fireSequencerStore";
import { useFireCollapsed } from "./useFireCollapsed";
import { CollapseToggle } from "./CollapseToggle";
import { useFireBandRegister } from "./FireBand";
import { useFireLayout } from "./FireLayoutContext";
import { ensureExpanded } from "./fireNavigate";
import { MixerStageViz } from "./MixerStageViz";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { FC_CHIP_EYEBROW, FcChip, fcChipCharacterFor } from "./fcChip";

/** Mix band — console chips with an LED underline. */
const MIX_CHAR = fcChipCharacterFor("mixer");

const C = FC.mixer;
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
const C_HOT = bandShade(FC_BAND.mix, 0.65);

const STRIP_META: Record<MixerStripId, { label: string; short: string; color: string; hint: string }> = {
  a: { label: "SYNTH A", short: "A", color: bandShade(FC_BAND.mix, 0.38), hint: "Playable Fire Command synth" },
  b: { label: "SYNTH B", short: "B", color: bandShade(FC_BAND.mix, 0.5), hint: "Second instrument (editable rack)" },
  drums: { label: "DRUMS", short: "DRM", color: bandShade(FC_BAND.mix, 0.62), hint: "Synthesized drum kit" },
  samples: { label: "SAMPLES", short: "SMP", color: bandShade(FC_BAND.mix, 0.74), hint: "Sample deck lanes" },
  master: { label: "MASTER", short: "MST", color: bandShade(FC_BAND.mix, 0.9), hint: "Summed Fire output (pre Kill-Chain FX)" },
};

const fmtDb = (level: number) =>
  level <= 0.001 ? "-∞" : `${(20 * Math.log10(level)).toFixed(1)} dB`;

type MeterEls = { fill: HTMLDivElement; peak: HTMLDivElement; holdDb: HTMLSpanElement };

type MixChar = {
  id: string;
  label: string;
  strips: Partial<Record<MixerStripId, { level: number; pan?: number; mute?: boolean; solo?: boolean }>>;
  duck?: boolean;
  duckAmount?: number;
  limiter?: boolean;
};

const MIX_CHARS: MixChar[] = [
  {
    id: "unity",
    label: "Unity",
    strips: {
      a: { level: 1, pan: 0, mute: false, solo: false },
      b: { level: 1, pan: 0, mute: false, solo: false },
      drums: { level: 1, pan: 0, mute: false, solo: false },
      samples: { level: 1, pan: 0, mute: false, solo: false },
      master: { level: 1, mute: false },
    },
    duck: false,
    limiter: true,
  },
  {
    id: "lead",
    label: "A Lead",
    strips: {
      a: { level: 1.2, pan: 0, mute: false },
      b: { level: 0.55, pan: 0.25, mute: false },
      drums: { level: 0.85, pan: 0 },
      samples: { level: 0.7, pan: -0.15 },
      master: { level: 1 },
    },
  },
  {
    id: "rhythm",
    label: "Rhythm",
    strips: {
      a: { level: 0.65, pan: -0.2 },
      b: { level: 0.65, pan: 0.2 },
      drums: { level: 1.25, pan: 0 },
      samples: { level: 0.95, pan: 0 },
      master: { level: 1 },
    },
  },
  {
    id: "wide",
    label: "Wide",
    strips: {
      a: { level: 1, pan: -0.65 },
      b: { level: 1, pan: 0.65 },
      drums: { level: 1, pan: 0 },
      samples: { level: 0.85, pan: 0.2 },
      master: { level: 1 },
    },
  },
  {
    id: "duck",
    label: "Duck",
    strips: {
      a: { level: 1, pan: 0 },
      b: { level: 1, pan: 0 },
      drums: { level: 1.1, pan: 0 },
      samples: { level: 0.8, pan: 0 },
      master: { level: 1 },
    },
    duck: true,
    duckAmount: 0.7,
  },
  {
    id: "quiet",
    label: "Quiet",
    strips: {
      a: { level: 0.55 },
      b: { level: 0.55 },
      drums: { level: 0.6 },
      samples: { level: 0.5 },
      master: { level: 0.75 },
    },
    duck: false,
  },
];

function applyMixChar(char: MixChar) {
  const setMixerStrip = useFireSequencerStore.getState().setMixerStrip;
  const setDuck = useFireSequencerStore.getState().setDuck;
  const setFireLimiterOn = useFireSequencerStore.getState().setFireLimiterOn;
  for (const id of [...MIXER_PARTS, "master"] as MixerStripId[]) {
    const p = char.strips[id];
    if (!p) continue;
    setMixerStrip(id, {
      level: p.level,
      ...(p.pan !== undefined ? { pan: p.pan } : {}),
      ...(p.mute !== undefined ? { mute: p.mute } : { mute: false }),
      ...(id !== "master" && p.solo !== undefined ? { solo: p.solo } : id !== "master" ? { solo: false } : {}),
    });
  }
  // Behavioral scenes: Duck always enables sidechain; Quiet disables it.
  if (char.id === "duck" || char.duck === true) {
    setDuck({ enabled: true, amount: char.duckAmount ?? 0.7, attackMs: 6, holdMs: 30 });
  } else if (char.duck === false || char.id === "quiet" || char.id === "unity") {
    setDuck({ enabled: false });
  } else if (char.duck !== undefined) {
    setDuck({ enabled: char.duck, amount: char.duckAmount ?? 0.6 });
  }
  if (char.limiter !== undefined) setFireLimiterOn(char.limiter);
  else if (char.id === "unity") setFireLimiterOn(true);
}

function MixerCharacterStrip() {
  const mixer = useFireSequencerStore((s) => s.mixer);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const tone = { color: C, onText: C_GLOW, glow: 10 };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${C}66` }}>
        Deck
      </span>
      {MIX_CHARS.map((p) => (
        <FcChip
          key={p.id}
          on={
            (p.id === "unity" &&
              Math.abs(mixer.a.level - 1) < 0.08 &&
              Math.abs(mixer.b.level - 1) < 0.08 &&
              Math.abs(mixer.drums.level - 1) < 0.08 &&
              !duckEnabled) ||
            (p.id === "duck" && duckEnabled) ||
            (p.id === "lead" && mixer.a.level > 1.05 && mixer.b.level < 0.7) ||
            (p.id === "rhythm" && mixer.drums.level > 1.1) ||
            (p.id === "wide" && Math.abs(mixer.a.pan) > 0.4 && Math.abs(mixer.b.pan) > 0.4) ||
            (p.id === "quiet" && mixer.master.level < 0.85 && mixer.a.level < 0.7)
          }
          tone={tone}
          character={MIX_CHAR}
          caseMode="normal"
          onClick={() => applyMixChar(p)}
          title={p.label}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

function MixerQuickActions() {
  const mixer = useFireSequencerStore((s) => s.mixer);
  const setMixerStrip = useFireSequencerStore((s) => s.setMixerStrip);
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const setFireLimiterOn = useFireSequencerStore((s) => s.setFireLimiterOn);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const setDuck = useFireSequencerStore((s) => s.setDuck);
  const soloMode = useFireSequencerStore((s) => s.soloMode);
  const setSoloMode = useFireSequencerStore((s) => s.setSoloMode);
  const savedRef = useRef({
    mixer: null as null | typeof mixer,
    duck: false,
    lim: true,
  });

  const muted = MIXER_PARTS.every((id) => mixer[id].mute) && mixer.master.mute;
  const soloModes: { id: SoloMode; label: string }[] = [
    { id: "exclusive", label: "Solo" },
    { id: "additive", label: "Add" },
    { id: "dim", label: "Dim" },
  ];

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          if (muted && savedRef.current.mixer) {
            for (const id of [...MIXER_PARTS, "master"] as MixerStripId[]) {
              setMixerStrip(id, { mute: savedRef.current.mixer[id].mute });
            }
            setDuck({ enabled: savedRef.current.duck });
            setFireLimiterOn(savedRef.current.lim);
          } else {
            savedRef.current = { mixer: { ...mixer }, duck: duckEnabled, lim: fireLimiterOn };
            for (const id of [...MIXER_PARTS, "master"] as MixerStripId[]) {
              setMixerStrip(id, { mute: true });
            }
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: muted ? `${C}88` : `${C}66`,
          color: muted ? C_GLOW : `${C}bb`,
          background: muted ? `${C}40` : `${C}22`,
          boxShadow: muted ? `0 0 14px ${C}55` : undefined,
        }}
        title={muted ? "Unmute all" : "Mute all buses"}
      >
        {muted ? "Open" : "Kill"}
      </button>
      {soloModes.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setSoloMode(m.id)}
          className="rounded-md border px-1.5 py-0.5 text-[9px] font-bold transition"
          style={
            soloMode === m.id
              ? { borderColor: `${C_GLOW}88`, color: C_GLOW, background: `${C}30` }
              : { borderColor: `${C}33`, color: `${C}99`, background: `${C}10` }
          }
          title={`Solo mode: ${m.id}`}
        >
          {m.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDuck({ enabled: !duckEnabled })}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={{
          borderColor: duckEnabled ? `${C_HOT}88` : `${C}44`,
          color: duckEnabled ? C_GLOW : `${C}bb`,
          background: duckEnabled ? `${C}30` : `${C}14`,
        }}
        title="Sidechain duck"
      >
        {duckEnabled ? "Duck" : "Duck○"}
      </button>
      <button
        type="button"
        onClick={() => applyMixChar(MIX_CHARS[0]!)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${C}44`, color: `${C}bb`, background: `${C}14` }}
        title="Reset to unity"
      >
        Reset
      </button>
    </div>
  );
}

function MasterLimiterBlock() {
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const setFireLimiterOn = useFireSequencerStore((s) => s.setFireLimiterOn);
  const grRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 80) return;
      last = t;
      if (!grRef.current) return;
      try {
        const gr = getEngine().getFireLimiterReduction();
        grRef.current.textContent = `GR −${fmtGrDb(gr)}`;
      } catch {
        grRef.current.textContent = "GR −0.0";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5"
      style={{
        borderColor: fireLimiterOn ? `${C_GLOW}66` : "rgba(255,255,255,0.12)",
        background: fireLimiterOn ? `${C}22` : "rgba(0,0,0,0.35)",
        boxShadow: fireLimiterOn ? `0 0 14px ${C}33` : undefined,
      }}
    >
      <span className="text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: `${C}99` }}>
        Master Limiter
      </span>
      <button
        type="button"
        onClick={() => setFireLimiterOn(!fireLimiterOn)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
        style={
          fireLimiterOn
            ? { borderColor: `${C_GLOW}88`, color: C_GLOW, background: `${C}38` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
        }
        title="Fire bus DynamicsCompressor — one engine"
      >
        {fireLimiterOn ? "ON" : "OFF"}
      </button>
      <span className="font-mono text-[10px] text-white/55">
        CEILING {FIRE_LIMITER_CEILING_DB.toFixed(1)}
      </span>
      <span ref={grRef} className="font-mono text-[10px]" style={{ color: C_GLOW }}>
        GR −0.0
      </span>
      <span className="text-[9px] text-white/35" title="Soft-clip after limiter">
        Safety clip · always on
      </span>
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
  const masterDim = useFireSequencerStore((s) => s.masterDim);
  const masterMono = useFireSequencerStore((s) => s.masterMono);
  const setMasterDim = useFireSequencerStore((s) => s.setMasterDim);
  const setMasterMono = useFireSequencerStore((s) => s.setMasterMono);
  const meta = STRIP_META[id];
  const isMaster = id === "master";
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const holdDbRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (fillRef.current && peakRef.current && holdDbRef.current) {
      registerMeter(id, { fill: fillRef.current, peak: peakRef.current, holdDb: holdDbRef.current });
    }
    return () => registerMeter(id, null);
  }, [id, registerMeter]);

  const panLabel =
    strip.pan === 0 ? "C" : strip.pan < 0 ? `L${Math.round(-strip.pan * 100)}` : `R${Math.round(strip.pan * 100)}`;
  const trim = strip.trim ?? 1;

  return (
    <div
      className="flex h-full min-w-0 flex-col items-center gap-2 rounded-2xl border px-2 py-2.5 transition"
      style={{
        borderColor: strip.solo ? `${C_GLOW}88` : strip.mute ? "rgba(255,255,255,0.08)" : `${meta.color}44`,
        background: isMaster
          ? `linear-gradient(180deg, ${meta.color}18, transparent)`
          : `linear-gradient(180deg, ${meta.color}12, transparent)`,
        boxShadow: strip.solo
          ? `0 0 20px ${C}40`
          : strip.mute
            ? undefined
            : `0 0 16px ${meta.color}18, inset 0 1px 0 rgba(255,255,255,0.04)`,
        opacity: strip.mute ? 0.55 : 1,
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
          <span className="font-mono text-[9px]" style={{ color: `${meta.color}88` }}>{panLabel}</span>
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-0.5">
        <span className="fc-text-floor font-black uppercase tracking-[0.06em]" style={{ color: `${meta.color}77` }}>Trim</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.02}
          value={trim}
          onChange={(e) => setMixerStrip(id, { trim: Number(e.target.value) })}
          onDoubleClick={() => setMixerStrip(id, { trim: 1 })}
          className="w-full"
          style={{ accentColor: meta.color }}
          aria-label={`${meta.label} trim`}
          title={`Trim ${fmtDb(trim)} — double-click unity`}
        />
        <span className="font-mono text-[8px]" style={{ color: `${meta.color}88` }}>{fmtDb(trim)}</span>
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

      <span className="font-mono text-[10px]" style={{ color: `${meta.color}aa` }}>{fmtDb(strip.level)}</span>
      <span ref={holdDbRef} className="font-mono text-[8px] text-white/40" title="Peak hold">−∞</span>

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
          className="h-7 w-7 rounded-lg border text-[11px] font-bold transition"
          style={
            strip.mute
              ? { borderColor: "#fb718888", background: "#fb718830", color: "#fecdd3", boxShadow: "0 0 12px rgba(251,113,133,0.35)" }
              : { borderColor: `${meta.color}33`, background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.45)" }
          }
          title="Mute"
        >M</button>
        {!isMaster && (
          <button
            onClick={() => setMixerStrip(id, { solo: !strip.solo })}
            className="h-7 w-7 rounded-lg border text-[11px] font-bold transition"
            style={
              strip.solo
                ? { borderColor: `${C_GLOW}88`, background: `${C}35`, color: C_GLOW, boxShadow: `0 0 12px ${C}44` }
                : { borderColor: `${meta.color}33`, background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.45)" }
            }
            title="Solo"
          >S</button>
        )}
        {isMaster && (
          <>
            <button
              onClick={() => setMasterDim(!masterDim)}
              className="h-7 px-1.5 rounded-lg border text-[9px] font-bold transition"
              style={
                masterDim
                  ? { borderColor: `${C_GLOW}88`, background: `${C}35`, color: C_GLOW }
                  : { borderColor: `${meta.color}33`, background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.45)" }
              }
              title="Dim −12 dB listen cut"
            >DIM</button>
            <button
              onClick={() => setMasterMono(!masterMono)}
              className="h-7 px-1.5 rounded-lg border text-[9px] font-bold transition"
              style={
                masterMono
                  ? { borderColor: `${C_GLOW}88`, background: `${C}35`, color: C_GLOW }
                  : { borderColor: `${meta.color}33`, background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.45)" }
              }
              title="Mono fold"
            >MONO</button>
          </>
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
  const duckAttackMs = useFireSequencerStore((s) => s.duckAttackMs);
  const duckHoldMs = useFireSequencerStore((s) => s.duckHoldMs);
  const duckHpfHz = useFireSequencerStore((s) => s.duckHpfHz);
  const duckListen = useFireSequencerStore((s) => s.duckListen);
  const setDuck = useFireSequencerStore((s) => s.setDuck);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 200, h: 48 });
  const flashRef = useRef(0);

  useEffect(() => {
    flashRef.current = 1;
  }, [duckEnabled, duckAmount, duckReleaseMs, duckSource]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sync = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      const cssH = 48;
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
      if (document.hidden || t - last < 28) return;
      last = t;
      flashRef.current *= 0.9;
      const W = sizeRef.current.w;
      const H = sizeRef.current.h;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      if (duckEnabled) {
        bg.addColorStop(0, `${C_HOT}28`);
        bg.addColorStop(0.5, "rgba(12,6,2,0.9)");
        bg.addColorStop(1, `${C}18`);
      } else {
        bg.addColorStop(0, "rgba(255,255,255,0.04)");
        bg.addColorStop(1, "rgba(8,8,10,0.9)");
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const mid = H * 0.55;
      const rel = Math.max(0.15, Math.min(1.2, duckReleaseMs / 400));
      const breathe = duckEnabled ? 0.95 + 0.05 * Math.sin(t / 1200) : 1;

      ctx.beginPath();
      const pts: [number, number][] = [];
      for (let x = 0; x <= W; x++) {
        const u = x / Math.max(1, W);
        const pulse = duckEnabled
          ? Math.max(0, 1 - ((u * 2.6 + (t / 850) * (0.4 + duckAmount)) % 1) * (1.2 + duckAmount * 0.9) / rel)
          : 0.12;
        const y = mid - pulse * (H * 0.38) * (0.3 + duckAmount * 0.7) * breathe;
        pts.push([x, y]);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = duckEnabled ? C : "rgba(255,255,255,0.18)";
      ctx.lineWidth = duckEnabled ? 2.8 : 1.5;
      ctx.shadowBlur = duckEnabled ? 10 + flashRef.current * 8 : 0;
      ctx.shadowColor = C;
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (duckEnabled) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.lineTo(W, mid);
        ctx.lineTo(0, mid);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, mid);
        fill.addColorStop(0, `${C}40`);
        fill.addColorStop(1, `${C}08`);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [duckEnabled, duckAmount, duckReleaseMs]);

  return (
    <div
      className="flex h-full min-w-0 flex-col gap-2 rounded-2xl border px-3 py-2.5 transition"
      style={{
        borderColor: duckEnabled ? `${C}70` : "rgba(255,255,255,0.1)",
        background: duckEnabled
          ? `linear-gradient(180deg, ${C}18, transparent)`
          : "rgba(255,255,255,0.02)",
        boxShadow: duckEnabled ? `0 0 20px ${C}22` : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color: duckEnabled ? C_HOT : "rgba(255,255,255,0.4)" }}
          >
            Sidechain
          </div>
          <div className="text-[9px] text-white/30">ducks Synth A · B stays solid</div>
        </div>
        <button
          onClick={() => setDuck({ enabled: !duckEnabled })}
          className="h-7 px-2.5 rounded-lg text-[10px] font-bold border transition"
          style={
            duckEnabled
              ? { borderColor: `${C}88`, background: `${C}30`, color: C_GLOW, boxShadow: `0 0 12px ${C}40` }
              : { borderColor: "rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.45)" }
          }
          title="Duck the synth (A+B) path on every hit of the source lane"
        >
          {duckEnabled ? "ON" : "OFF"}
        </button>
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
          className="flex-1" style={{ accentColor: C }}
        />
        <span className="w-8 text-right font-mono text-white/50">{Math.round(duckAmount * 100)}%</span>
      </label>

      <label className="flex items-center gap-1.5 text-[10px] text-dim">
        <span className="w-12 uppercase tracking-wider">Attack</span>
        <input
          type="range" min={1} max={80} step={1} value={duckAttackMs}
          onChange={(e) => setDuck({ attackMs: Number(e.target.value) })}
          className="flex-1" style={{ accentColor: C }}
        />
        <span className="w-8 text-right font-mono text-white/50">{duckAttackMs}ms</span>
      </label>

      <label className="flex items-center gap-1.5 text-[10px] text-dim">
        <span className="w-12 uppercase tracking-wider">Hold</span>
        <input
          type="range" min={0} max={200} step={5} value={duckHoldMs}
          onChange={(e) => setDuck({ holdMs: Number(e.target.value) })}
          className="flex-1" style={{ accentColor: C }}
        />
        <span className="w-8 text-right font-mono text-white/50">{duckHoldMs}ms</span>
      </label>

      <label className="flex items-center gap-1.5 text-[10px] text-dim">
        <span className="w-12 uppercase tracking-wider">Release</span>
        <input
          type="range" min={40} max={800} step={10} value={duckReleaseMs}
          onChange={(e) => setDuck({ releaseMs: Number(e.target.value) })}
          className="flex-1" style={{ accentColor: C }}
        />
        <span className="w-8 text-right font-mono text-white/50">{duckReleaseMs}ms</span>
      </label>

      <label className="flex items-center gap-1.5 text-[10px] text-dim">
        <span className="w-12 uppercase tracking-wider">HPF</span>
        <input
          type="range" min={0} max={500} step={10} value={duckHpfHz}
          onChange={(e) => setDuck({ hpfHz: Number(e.target.value) })}
          className="flex-1" style={{ accentColor: C }}
        />
        <span className="w-10 text-right font-mono text-white/50">{duckHpfHz}Hz</span>
      </label>

      <button
        type="button"
        onClick={() => setDuck({ listen: !duckListen })}
        className="self-start rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
        style={
          duckListen
            ? { borderColor: `${C_HOT}88`, color: C_GLOW, background: `${C}30` }
            : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
        }
        title="Listen / preview sidechain detector"
      >
        {duckListen ? "Listen ON" : "Listen"}
      </button>
    </div>
  );
}


export function MixerPanel({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const [collapsed, toggle] = useFireCollapsed("mixer", false);
  const { focusActive, focusId, isFocused } = useFireLayout();
  useFireBandRegister("mixer", "Fire Mixer", C, collapsed, toggle, chipHosted);
  useEffect(() => {
    if (isFocused("mixer") && collapsed) ensureExpanded("mixer");
  }, [collapsed, isFocused]);
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  // Narrow slices, not the whole mixer object: every strip already subscribes
  // to its own `s.mixer[id]` (see MixerStrip), so a whole-object subscription
  // here only meant one fader move re-rendered the panel and all five strips.
  // These two derive to primitives, so they change far less often.
  const live = useFireSequencerStore((s) =>
    MIXER_PARTS.some((id) => !s.mixer[id].mute && s.mixer[id].level > 0.02)
    || (!s.mixer.master.mute && s.mixer.master.level > 0.02),
  );
  const masterLevel = useFireSequencerStore((s) => s.mixer.master.level);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);

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
      // Skip the analyser reads when there are no meter elements to paint.
      // The panel returns null while collapsed to a band chip, but its hooks
      // keep running — so five analysers were being read every frame to
      // update nothing. registerMeter empties on unmount of the strips.
      if (document.hidden || meterEls.current.size === 0) return;
      for (const [id, an] of analysers) {
        const els = meterEls.current.get(id);
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i]!;
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
        if (els.holdDb) els.holdDb.textContent = peakToDbfs(held);
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
      <ModuleBackdrop moduleId="mixer" color={C} awake />
      <div className="fc-mod-content-well">
      <div className={`flex items-center justify-between gap-2 ${collapsed && !isFocused("mixer") ? "" : "mb-2"}`}>
        <button
          onClick={toggle}
          aria-expanded={!collapsed || isFocused("mixer")}
          className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={collapsed ? "Expand Fire Mixer" : "Collapse Fire Mixer"}
        >
          <CollapseToggle collapsed={collapsed && !isFocused("mixer")} color={C} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: C }}>
            Fire Mixer
          </span>
          <span className="text-[9px] normal-case tracking-normal text-white/35">· Sum Deck</span>
        </button>
        {(!collapsed || isFocused("mixer")) && <MasterLimiterBlock />}
      </div>

      {(!collapsed || isFocused("mixer")) && (
        <>
          <div
            className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
            style={{
              borderColor: live ? `${C}48` : `${C}28`,
              background: live
                ? `linear-gradient(105deg, ${C}28 0%, ${C}0c 38%, transparent 72%)`
                : `linear-gradient(180deg, rgba(0,0,0,0.4), ${C}0c)`,
              boxShadow: live ? `inset 0 1px 0 ${C}28` : undefined,
            }}
          >
            <div className="min-w-0">
              <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${C}99` }}>
                Signal Path · Mix
              </div>
              <div className="truncate text-[13px] font-semibold" style={{ color: C_GLOW }}>
                Sum Deck
                <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
                  {live
                    ? `${fireLimiterOn ? "lim" : "open"}${duckEnabled ? " · duck" : ""} · MST ${fmtDb(masterLevel)}`
                    : "idle"}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <MixerQuickActions />
              <div
                className="rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
                style={{
                  color: live ? C_GLOW : "rgba(255,255,255,0.35)",
                  background: live ? `${C}38` : "rgba(0,0,0,0.45)",
                  border: `1px solid ${live ? `${C}70` : "rgba(255,255,255,0.12)"}`,
                  boxShadow: live ? `0 0 14px ${C}50` : undefined,
                }}
              >
                {!live ? "Idle" : duckEnabled ? "Duck" : fireLimiterOn ? "Lim" : "Sum"}
              </div>
            </div>
          </div>

          <MixerStageViz liveRef={liveRef} />
          <MixerCharacterStrip />

          <div className="mb-2 grid grid-cols-5 gap-1 text-center text-[8px] uppercase tracking-[0.16em]" style={{ color: `${C}66` }}>
            <span>Synth A</span>
            <span>Synth B</span>
            <span>Drums</span>
            <span>Samples</span>
            <span style={{ color: `${C}aa` }}>Master</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {([...MIXER_PARTS, "master"] as MixerStripId[]).map((id) => (
              <Strip key={id} id={id} registerMeter={registerMeter} />
            ))}
          </div>
          <div className="mt-2.5">
            <SidechainRack />
          </div>
          <div className="mt-1.5 text-center text-[10px] leading-snug" style={{ color: `${C}99` }}>
            Sum deck — drag Level↕ / Pan↔ on the bridge, top-click mute, Shift+solo, double-click unity. Every twist lights the bus.
          </div>
        </>
      )}
      </div>
    </GlassPanel>
  );
}
