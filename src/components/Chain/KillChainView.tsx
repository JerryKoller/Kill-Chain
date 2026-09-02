import { useEffect, useRef, useState } from "react";
import { ActionBar } from "@/components/shared/ActionBar";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useUIStore, type View } from "@/state/uiStore";
import { useAudioStore } from "@/state/audioStore";
import { usePlayerStore } from "@/state/playerStore";
import { useEqStore, eqIsActive } from "@/state/eqStore";
import { useDimensionStore } from "@/state/dimensionStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { peekEngine } from "@/audio/AudioEngine";
import { restoreActive } from "@/audio/dsp/Reconstructor";
import { useAppliedTractor } from "@/lib/tractorApplied";
import type { SoundParams } from "@/audio/types";

/**
 * Kill Chain — the live signal-flow map (issue #10).
 *
 * Every input source and every modulating stage of the engine, drawn in the
 * order the audio actually flows, with live state:
 *
 *   · click a block        → jump to the tool that owns it
 *   · click a block's ⏻    → temporarily zero that stage (A/B what it adds);
 *                            re-click — or leave this view — to restore
 *   · sources pulse        → shows exactly what is feeding the chain
 *   · meters at both ends  → input vs output level, plus latency readouts
 */

interface Stage {
  id: string;
  label: string;
  desc: string;
  view: View;
  /** SoundParams zeroed by the mute toggle. Absent = no toggle (structural). */
  keys?: (keyof SoundParams)[];
}

const CHAIN: Stage[] = [
  { id: "correction", label: "Correction", desc: "Headphone profile", view: "calibration" },
  { id: "restore", label: "Restoration", desc: "HF rebuild · repair", view: "playground" },
  { id: "clarityEngine", label: "Clarity", desc: "Mud duck · unveil", view: "playground" },
  { id: "sculpt", label: "Sculpt EQ", desc: "10-band tone", view: "playground",
    keys: ["subBass", "bass", "warmth", "body", "mid", "vocals", "presence", "clarity", "air", "sparkle"] },
  { id: "graphic", label: "Graphic EQ", desc: "User bands", view: "playground" },
  { id: "deess", label: "De-Esser", desc: "Sibilance", view: "playground", keys: ["deEss"] },
  { id: "harmonic", label: "Harmonics", desc: "Enhancer", view: "playground", keys: ["harmonics"] },
  { id: "saturator", label: "Saturator", desc: "Drive", view: "playground", keys: ["saturation"] },
  { id: "transient", label: "Transients", desc: "Punch · texture", view: "playground", keys: ["punch", "texture"] },
  { id: "multiband", label: "MB Comp", desc: "3-band dynamics", view: "playground",
    keys: ["mbCompLow", "mbCompMid", "mbCompHigh"] },
  { id: "glue", label: "Glue Comp", desc: "Bus compression", view: "playground", keys: ["compression"] },
  { id: "spatial", label: "Spatial", desc: "Crossfeed", view: "playground", keys: ["spatial"] },
  { id: "pbwidth", label: "Band Width", desc: "Per-band stereo", view: "playground",
    keys: ["subWidth", "presenceWidth", "airWidth"] },
  { id: "widener", label: "Widener", desc: "Stereo image", view: "playground", keys: ["width"] },
  { id: "lofi", label: "Lo-Fi Deck", desc: "Age · wear · flutter", view: "playground",
    keys: ["lofiAge", "lofiWear", "lofiWowFlutter"] },
  { id: "reverb", label: "Reverb", desc: "Space", view: "playground", keys: ["reverbAmount"] },
  { id: "rooms", label: "Room Sim", desc: "HRTF rooms", view: "playground" },
  { id: "limiter", label: "Limiter", desc: "-0.3 dB ceiling", view: "scope" },
];

const ACTIVE_EPS = 0.02;

function stageIsActive(stage: Stage, params: SoundParams): boolean {
  if (!stage.keys) return false;
  return stage.keys.some((k) => Math.abs(params[k]) > ACTIVE_EPS);
}

export function KillChainView() {
  const setView = useUIStore((s) => s.setView);
  const toast = useUIStore((s) => s.toast);
  const params = useAudioStore((s) => s.params);
  const bypass = useAudioStore((s) => s.bypass);
  const setBypass = useAudioStore((s) => s.setBypass);
  const correctionEnabled = useAudioStore((s) => s.correctionEnabled);
  const setCorrectionEnabled = useAudioStore((s) => s.setCorrectionEnabled);
  const room = useAudioStore((s) => s.room);
  const roomMix = useAudioStore((s) => s.roomMix);
  const previewParams = useAudioStore((s) => s.previewParams);
  const restore = useAudioStore((s) => s.restore);
  const clarityAmt = useAudioStore((s) => s.clarity);
  const eqBands = useEqStore((s) => s.bands);
  const dimActive = useDimensionStore((s) => s.active);

  // Track player / loopback / synth as chain inputs.
  const playerStatus = usePlayerStore((s) => s.status);
  const fileName = usePlayerStore((s) => s.fileName);
  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  const loopbackMode = usePlayerStore((s) => s.loopbackMode);
  const seqPlaying = useFireSequencerStore((s) => s.playing);

  // ── temporary stage mutes: stageId → the params we zeroed ──
  const [muted, setMuted] = useState<Record<string, Partial<SoundParams>>>({});
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const toggleStage = (stage: Stage) => {
    if (!stage.keys) return;
    const cur = mutedRef.current[stage.id];
    if (cur) {
      previewParams(cur);
      setMuted((m) => {
        const next = { ...m };
        delete next[stage.id];
        return next;
      });
    } else {
      const p = useAudioStore.getState().params;
      const snap: Partial<SoundParams> = {};
      const zero: Partial<SoundParams> = {};
      for (const k of stage.keys) {
        snap[k] = p[k];
        zero[k] = 0;
      }
      previewParams(zero);
      setMuted((m) => ({ ...m, [stage.id]: snap }));
      toast(`${stage.label} muted — click ⏻ again to restore`);
    }
  };

  // Leaving the map restores every temporarily-muted stage — a bypassed
  // stage you can no longer see would just read as "the app sounds wrong".
  useEffect(() => () => {
    const leftovers = mutedRef.current;
    const restore: Partial<SoundParams> = {};
    for (const snap of Object.values(leftovers)) Object.assign(restore, snap);
    if (Object.keys(restore).length > 0) {
      useAudioStore.getState().previewParams(restore);
    }
  }, []);

  // ── live meters + engine stats (~10 Hz) ──
  // Meter fills are driven straight through DOM refs — pushing RMS through
  // setState re-rendered the ENTIRE chain map (40+ cards) ten times a second
  // whenever audio was playing.
  const meterFills = useRef<Record<string, HTMLDivElement | null>>({});
  const [engineInfo, setEngineInfo] = useState<{
    sampleRate: number | null;
    latencyMs: number | null;
    voices: number;
    state: string;
  }>({ sampleRate: null, latencyMs: null, voices: 0, state: "idle" });

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const paintFill = (key: string, v: number) => {
      const el = meterFills.current[key];
      if (!el) return;
      const pct = Math.min(100, v * 260);
      el.style.width = `${pct}%`;
      el.style.background =
        pct > 88
          ? "rgb(255 96 96)"
          : "linear-gradient(90deg, rgb(var(--c-cyan)), rgb(var(--c-violet)))";
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - last < 100) return;
      last = now;
      const e = peekEngine();
      if (!e) return;
      try {
        const ctx = e.ctx as AudioContext & { outputLatency?: number };
        const latency = (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0);
        let voices = e.fireCommand.getActiveVoiceCount();
        voices += e.peekFireCommandB()?.getActiveVoiceCount() ?? 0;
        const outRms = e.getOutputRms();
        paintFill("in", e.getInputRms());
        paintFill("out", outRms);
        paintFill("outCard", outRms);
        const latencyMs = latency > 0 ? Math.round(latency * 10000) / 10 : null;
        // Rare-change stats only re-render when a value actually moved.
        setEngineInfo((prev) =>
          prev.sampleRate === ctx.sampleRate &&
          prev.latencyMs === latencyMs &&
          prev.voices === voices &&
          prev.state === ctx.state
            ? prev
            : { sampleRate: ctx.sampleRate, latencyMs, voices, state: ctx.state },
        );
      } catch { /* engine mid-teardown */ }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sources = [
    {
      id: "library" as View,
      label: "Track Player",
      desc: playerStatus === "playing" ? (fileName || "Playing") : "Library · transport",
      live: playerStatus === "playing" && !loopbackActive,
    },
    {
      id: "fire" as View,
      label: "Fire Command",
      desc: "Synth · drums",
      live: seqPlaying || engineInfo.voices > 0,
    },
    {
      id: "airspace" as View,
      label: "Airspace",
      desc: "Browser capture",
      live: loopbackActive && loopbackMode === "airspace",
    },
    {
      id: "settings" as View,
      label: "Exterior Audio",
      desc: "System loopback",
      live: loopbackActive && loopbackMode !== "airspace",
    },
  ];

  const stageState = (stage: Stage): "muted" | "active" | "neutral" => {
    // Master bypass takes the clean wire — don't leave blocks "shaping".
    if (bypass) return "neutral";
    if (muted[stage.id]) return "muted";
    if (stage.id === "correction") return correctionEnabled ? "active" : "neutral";
    if (stage.id === "restore") {
      return restoreActive(restore) ? "active" : "neutral";
    }
    if (stage.id === "clarityEngine") return clarityAmt > 0.01 ? "active" : "neutral";
    if (stage.id === "graphic") return eqIsActive(eqBands) ? "active" : "neutral";
    if (stage.id === "rooms") return room !== "off" && roomMix > 0.01 ? "active" : "neutral";
    if (stage.id === "limiter") return "active";
    return stageIsActive(stage, params) ? "active" : "neutral";
  };

  return (
    <div className="space-y-4 pb-6">
      <ActionBar
        title="Kill Chain"
        code="KC-00"
        subtitle="The full signal path, live — click a block to jump to it, hit ⏻ to hear the chain without it"
      />

      {/* Master status strip */}
      <GlassPanel className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <button
            onClick={() => setBypass(!bypass)}
            className={`kc-btn relative font-bold tracking-wide uppercase text-xs ${
              bypass ? "kc-btn--danger" : "kc-btn--accent kc-on"
            }`}
            title="Master A/B — bit-transparent passthrough vs the full chain"
          >
            {!bypass && <span key="engaged" className="kc-breach" aria-hidden />}
            {bypass ? "○ Chain bypassed" : "● Chain engaged"}
          </button>

          <Meter label="IN" fillRef={(el) => { meterFills.current.in = el; }} />
          <Meter label="OUT" fillRef={(el) => { meterFills.current.out = el; }} />

          <TractorLockStat />

          <div className="flex-1" />

          <Stat label="Sample rate" value={engineInfo.sampleRate ? `${(engineInfo.sampleRate / 1000).toFixed(1)} kHz` : "—"} />
          <Stat
            label="Output latency"
            value={engineInfo.latencyMs !== null ? `${engineInfo.latencyMs.toFixed(1)} ms` : "—"}
            hint="AudioContext base + output latency — the whole chain renders inside this budget"
          />
          <Stat label="Synth voices" value={String(engineInfo.voices)} />
          <Stat label="Engine" value={engineInfo.state} />
        </div>
      </GlassPanel>

      {/* Input sources */}
      <div>
        <SectionLabel>Inputs — what's feeding the chain</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {sources.map((s) => (
            <button
              key={s.label}
              onClick={() => setView(s.id)}
              className={`text-left rounded-xl border px-3 py-2.5 transition kc-lift ${
                s.live
                  ? "border-cyan/50 bg-cyan/[0.08] shadow-[0_0_16px_rgb(var(--c-cyan)/0.15)]"
                  : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
              }`}
              title={`Open ${s.label}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${s.live ? "bg-cyan animate-pulse" : "bg-white/15"}`}
                  style={s.live ? { boxShadow: "0 0 8px rgb(var(--c-cyan))" } : undefined}
                />
                <span className={`text-sm font-semibold ${s.live ? "text-white" : "text-white/70"}`}>
                  {s.label}
                </span>
                <span className={`ml-auto text-[9px] uppercase tracking-[0.2em] ${s.live ? "text-cyan" : "text-white/30"}`}>
                  {s.live ? "LIVE" : "idle"}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-dim truncate">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* The chain itself */}
      <div className={bypass ? "opacity-45 transition-opacity" : "transition-opacity"}>
        <SectionLabel>
          Processing chain — in signal order{bypass ? " (bypassed: signal takes the clean wire below)" : ""}
        </SectionLabel>
        <GlassPanel intense className="p-3">
          <div className="flex flex-wrap items-stretch gap-y-3">
            {CHAIN.map((stage, i) => {
              const state = stageState(stage);
              return (
                <div key={stage.id} className="flex items-center">
                  {i > 0 && (
                    <span className="px-1 text-white/25 text-sm select-none" aria-hidden>
                      →
                    </span>
                  )}
                  <div
                    className={`relative rounded-xl border px-2.5 py-2 w-[118px] transition cursor-pointer group ${
                      state === "active"
                        ? "border-cyan/50 bg-cyan/[0.08]"
                        : state === "muted"
                          ? "border-rose-400/50 bg-rose-500/[0.08]"
                          : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    }`}
                    onClick={() => setView(stage.view)}
                    title={`Open ${stage.label} controls`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[11px] font-semibold truncate ${
                          state === "active" ? "text-cyan" : state === "muted" ? "text-rose-300" : "text-white/75"
                        }`}
                      >
                        {stage.label}
                      </span>
                      {(stage.keys || stage.id === "correction") && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (stage.id === "correction") {
                              setCorrectionEnabled(!correctionEnabled);
                            } else {
                              toggleStage(stage);
                            }
                          }}
                          className={`shrink-0 w-5 h-5 grid place-items-center rounded-md border text-[10px] transition ${
                            state === "muted"
                              ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
                              : "border-white/10 text-white/35 hover:text-white hover:border-white/40"
                          }`}
                          title={
                            state === "muted"
                              ? "Restore this stage"
                              : "Temporarily mute this stage (hear the chain without it)"
                          }
                        >
                          ⏻
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 text-[9px] text-dim truncate">{stage.desc}</div>
                    <div
                      className={`mt-1 text-[8px] uppercase tracking-[0.2em] ${
                        state === "active" ? "text-cyan/80" : state === "muted" ? "text-rose-300/80" : "text-white/25"
                      }`}
                    >
                      {state === "active" ? "shaping" : state === "muted" ? "muted" : "transparent"}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 3D branch + output */}
            <div className="flex items-center">
              <span className="px-1 text-white/25 text-sm select-none" aria-hidden>→</span>
              <div
                onClick={() => setView("dimension")}
                className={`rounded-xl border px-2.5 py-2 w-[118px] transition cursor-pointer ${
                  dimActive
                    ? "border-violet-400/60 bg-violet-500/[0.1]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25 border-dashed"
                }`}
                title="Open 3rd Dimension"
              >
                <div className={`text-[11px] font-semibold ${dimActive ? "text-violet-300" : "text-white/60"}`}>
                  3rd Dimension
                </div>
                <div className="mt-0.5 text-[9px] text-dim">HRTF binaural room</div>
                <div className={`mt-1 text-[8px] uppercase tracking-[0.2em] ${dimActive ? "text-violet-300/90" : "text-white/25"}`}>
                  {dimActive ? "replacing output" : "standby"}
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <span className="px-1 text-white/25 text-sm select-none" aria-hidden>→</span>
              <div className="rounded-xl border border-white/20 bg-white/[0.05] px-2.5 py-2 w-[118px]">
                <div className="text-[11px] font-semibold text-white/90">Output</div>
                <div className="mt-0.5 text-[9px] text-dim">Final limiter · DAC</div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    ref={(el) => { meterFills.current.outCard = el; }}
                    className="h-full rounded-full transition-[width] duration-100"
                    style={{
                      width: "0%",
                      background: "linear-gradient(90deg, rgb(var(--c-cyan)), rgb(var(--c-violet)))",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </GlassPanel>
      </div>

      {bypass && (
        <GlassPanel className="px-4 py-3">
          <div className="flex items-center gap-3 text-[11px] text-dim">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
            <span className="text-emerald-300/90 uppercase tracking-[0.25em] shrink-0">
              Clean wire — source → output, bit-transparent
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
          </div>
        </GlassPanel>
      )}

      <div className="text-[11px] text-dim leading-relaxed px-1">
        Blocks light up <span className="text-cyan">cyan</span> when they're actually shaping the
        signal, stay dim when transparent, and turn <span className="text-rose-300">rose</span> while
        temporarily muted from here. Muting is non-destructive: your dialed-in settings come back
        when you restore the stage or leave this view.
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2 px-1">{children}</div>
  );
}

function Meter({ label, fillRef }: { label: string; fillRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] uppercase tracking-widest text-white/40 w-7">{label}</span>
      <div className="relative h-2 w-28 rounded-full bg-white/10 overflow-hidden">
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-100"
          style={{
            width: "0%",
            background: "linear-gradient(90deg, rgb(var(--c-cyan)), rgb(var(--c-violet)))",
          }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col" title={hint}>
      <span className="text-[9px] uppercase tracking-widest text-white/35">{label}</span>
      <span className="text-xs font-mono tabular-nums text-white/85">{value}</span>
    </div>
  );
}

/** v2.3 — the engaged Tractor lock, surfaced on the chain map. */
function TractorLockStat() {
  const applied = useAppliedTractor();
  const setView = useUIStore((s) => s.setView);
  if (!applied) return null;
  return (
    <button
      onClick={() => setView("tractor")}
      className="flex items-center gap-2 rounded-lg border border-cyan/30 bg-cyan/[0.06] px-2.5 py-1 hover:bg-cyan/[0.12] transition"
      title={`Tractor lock engaged${applied.sourceName ? ` — ${applied.sourceName}` : ""}${
        applied.contentLabel ? ` (${applied.contentLabel})` : ""
      } — click to open Tractor Beam`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse"
        style={{ boxShadow: "0 0 6px rgb(var(--c-cyan))" }}
      />
      <span className="flex flex-col text-left">
        <span className="text-[9px] uppercase tracking-widest text-cyan/70">Tractor lock</span>
        <span className="text-xs font-mono tabular-nums text-cyan">
          {applied.matchPct != null ? `${applied.matchPct}% match` : applied.fullChain ? "full chain" : "EQ"}
        </span>
      </span>
    </button>
  );
}
