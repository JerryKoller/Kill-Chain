/**
 * Live panel helpers — Stage Pulse characters, strips, meters.
 * Used by LivePanel in FireCommandView (needs FParamKnob / Section).
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { VOICE_CAPS } from "./LiveStageViz";

export const LIVE_C = FC.performance;
export const LIVE_C_GLOW = bandShade(FC_BAND.mix, 0.95);
export const LIVE_C_HOT = bandShade(FC_BAND.mix, 0.7);
export const LIVE_C_POLY = bandShade(FC_BAND.mix, 0.62);
export const LIVE_C_FX = bandShade(FC_BAND.mix, 0.82);
export const LIVE_C_MST = bandShade(FC_BAND.mix, 0.88);
export const LIVE_C_OCT = bandShade(FC_BAND.mix, 0.5);

export const LIVE_CHARS = [
  { id: "solo", label: "Solo", mono: true, voices: 6, fx: false, master: 0.75 },
  { id: "duo", label: "Duo", mono: false, voices: 8, fx: true, master: 0.72 },
  { id: "band", label: "Band", mono: false, voices: 12, fx: true, master: 0.72 },
  { id: "orch", label: "Orch", mono: false, voices: 24, fx: true, master: 0.7 },
  { id: "raw", label: "Raw", mono: false, voices: 12, fx: false, master: 0.8 },
  { id: "chain", label: "Chain", mono: false, voices: 16, fx: true, master: 0.68 },
] as const;

export function LiveMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format: () => string;
}) {
  const t = Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.1rem]" title={`${label} ${format()}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>
        {label}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {format()}
      </div>
    </div>
  );
}

export function LiveCharacterStrip() {
  const mono = useFireCommandStore((s) => s.patch.mono);
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const master = useFireCommandStore((s) => s.patch.masterGain) ?? 0.72;
  const setParam = useFireCommandStore((s) => s.setParam);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  const setRouteThroughFx = useFireCommandStore((s) => s.setRouteThroughFx);
  const c = LIVE_C;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Stage
      </span>
      {LIVE_CHARS.map((p) => {
        const on =
          mono === p.mono &&
          maxVoices === p.voices &&
          fxOn === p.fx &&
          Math.abs(master - p.master) < 0.08;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("mono", p.mono);
              setMaxVoices(p.voices);
              setRouteThroughFx(p.fx);
              setParam("masterGain", p.master);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: LIVE_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} · ${p.mono ? "mono" : "poly"} · ${p.voices}v · ${p.fx ? "FX" : "dry"}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function LiveVoiceStrip() {
  const maxVoices = useFireCommandStore((s) => s.maxVoices);
  const setMaxVoices = useFireCommandStore((s) => s.setMaxVoices);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${LIVE_C}66` }}>
        Voices
      </span>
      {VOICE_CAPS.map((v) => {
        const on = maxVoices === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => setMaxVoices(v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${LIVE_C_HOT}99`,
                    background: `${LIVE_C_HOT}28`,
                    color: LIVE_C_GLOW,
                    boxShadow: `0 0 8px ${LIVE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

export function LiveOctaveStrip() {
  const octave = useFireCommandStore((s) => s.octave);
  const setOctave = useFireCommandStore((s) => s.setOctave);
  const octs = [2, 3, 4, 5, 6];
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${LIVE_C}66` }}>
        Oct
      </span>
      {octs.map((o) => {
        const on = octave === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => setOctave(o)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${LIVE_C_OCT}99`,
                    background: `${LIVE_C_OCT}28`,
                    color: LIVE_C_GLOW,
                    boxShadow: `0 0 8px ${LIVE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function LiveQuickActions() {
  const mono = useFireCommandStore((s) => s.patch.mono);
  const fxOn = useFireCommandStore((s) => s.routeThroughFx);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setRouteThroughFx = useFireCommandStore((s) => s.setRouteThroughFx);
  const shiftOctave = useFireCommandStore((s) => s.shiftOctave);
  const panic = useFireCommandStore((s) => s.panic);

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => shiftOctave(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${LIVE_C}55`, color: LIVE_C_GLOW, background: `${LIVE_C}1c` }}
        title="Octave down"
      >
        Oct−
      </button>
      <button
        type="button"
        onClick={() => shiftOctave(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${LIVE_C}55`, color: LIVE_C_GLOW, background: `${LIVE_C}1c` }}
        title="Octave up"
      >
        Oct+
      </button>
      <button
        type="button"
        onClick={() => setParam("mono", !mono)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          mono
            ? { borderColor: `${LIVE_C_HOT}99`, color: LIVE_C_GLOW, background: `${LIVE_C_HOT}33` }
            : { borderColor: `${LIVE_C_POLY}66`, color: LIVE_C_GLOW, background: `${LIVE_C_POLY}22` }
        }
        title={mono ? "Switch to poly" : "Switch to mono"}
      >
        {mono ? "Mono" : "Poly"}
      </button>
      <button
        type="button"
        onClick={() => setRouteThroughFx(!fxOn)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          fxOn
            ? { borderColor: `${LIVE_C_FX}99`, color: LIVE_C_GLOW, background: `${LIVE_C_FX}33` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title="Route through Kill-Chain FX"
      >
        {fxOn ? "FX On" : "Dry"}
      </button>
      <button
        type="button"
        onClick={() => {
          useFireSequencerStore.getState().stop();
          panic();
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${LIVE_C_HOT}88`, color: LIVE_C_GLOW, background: `${LIVE_C_HOT}28` }}
        title="Stop sequencer and silence every voice"
      >
        Cease
      </button>
    </div>
  );
}
