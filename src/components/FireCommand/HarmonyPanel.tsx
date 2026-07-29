/**
 * Harmony panel helpers — Kin Halo characters, snaps, meters, actions.
 * Used by HarmonyPanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES } from "@/state/fireSequencerStore";
import type { HarmonyMode } from "@/audio/dsp/FireCommandSynth";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { HARMONY_MODES, harmonyModeLabel, harmonyVoiceCount } from "./HarmonyStageViz";

export const HARM_C = FC.harmony;
export const HARM_C_GLOW = bandShade(FC_BAND.perf, 0.92);
export const HARM_C_HOT = bandShade(FC_BAND.perf, 0.58);
export const HARM_C_LEVEL = bandShade(FC_BAND.perf, 0.7);
export const HARM_C_MODE = bandShade(FC_BAND.perf, 0.5);
export const HARM_C_ROOT = bandShade(FC_BAND.perf, 0.78);

export { HARMONY_MODES, harmonyModeLabel, harmonyVoiceCount };

export const HARM_LEVEL_SNAPS = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "60", v: 0.6 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

export const HARM_CHARS = [
  { id: "mute", label: "Mute", mode: "off" as HarmonyMode, level: 0 },
  { id: "soft3", label: "Soft 3", mode: "third" as HarmonyMode, level: 0.35 },
  { id: "kin3", label: "Kin 3", mode: "third" as HarmonyMode, level: 0.6 },
  { id: "power", label: "Power", mode: "fifth" as HarmonyMode, level: 0.7 },
  { id: "oct", label: "Oct", mode: "octave" as HarmonyMode, level: 0.55 },
  { id: "choir", label: "Choir", mode: "triad" as HarmonyMode, level: 0.65 },
  { id: "bloom", label: "Bloom", mode: "triad" as HarmonyMode, level: 0.9 },
] as const;

function near(a: number, b: number, eps = 0.05) {
  return Math.abs(a - b) < eps;
}

export function HarmMeter({
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

export function HarmCharacterStrip() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode) ?? "off";
  const level = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0.6;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = HARM_C;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Kin
      </span>
      {HARM_CHARS.map((p) => {
        const on = mode === p.mode && near(level, p.level, 0.08);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("harmonyMode", p.mode);
              setParam("harmonyLevel", p.level);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: HARM_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} · ${p.mode} @ ${Math.round(p.level * 100)}%`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function HarmModeStrip() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode) ?? "off";
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${HARM_C}66` }}>
        Mode
      </span>
      {HARMONY_MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setParam("harmonyMode", m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${HARM_C_MODE}99`,
                    background: `${HARM_C_MODE}28`,
                    color: HARM_C_GLOW,
                    boxShadow: `0 0 8px ${HARM_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${m.label} · ${m.intervals} · ${m.voices}v`}
          >
            {m.short}
          </button>
        );
      })}
    </div>
  );
}

export function HarmLevelStrip() {
  const level = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0.6;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${HARM_C}66` }}>
        Harmony Mix
      </span>
      {HARM_LEVEL_SNAPS.map((p) => {
        const on = near(level, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("harmonyLevel", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${HARM_C_LEVEL}99`,
                    background: `${HARM_C_LEVEL}28`,
                    color: HARM_C_GLOW,
                    boxShadow: `0 0 8px ${HARM_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label}%`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function HarmQuickActions() {
  const mode = useFireCommandStore((s) => s.patch.harmonyMode) ?? "off";
  const level = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0.6;
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["harmony"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);

  const cycle = (dir: 1 | -1) => {
    const ids = HARMONY_MODES.map((m) => m.id);
    const i = ids.indexOf(mode);
    setParam("harmonyMode", ids[(i + dir + ids.length) % ids.length]!);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => cycle(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HARM_C}55`, color: HARM_C_GLOW, background: `${HARM_C}1c` }}
        title="Previous mode"
      >
        ◂
      </button>
      <button
        type="button"
        onClick={() => cycle(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HARM_C}55`, color: HARM_C_GLOW, background: `${HARM_C}1c` }}
        title="Next mode"
      >
        ▸
      </button>
      <button
        type="button"
        onClick={() => setParam("harmonyLevel", Math.min(1, Math.round((level + 0.1) * 100) / 100))}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HARM_C}55`, color: HARM_C_GLOW, background: `${HARM_C}1c` }}
        title="Nudge level +"
      >
        +Lvl
      </button>
      <button
        type="button"
        onClick={() => setParam("harmonyLevel", Math.max(0, Math.round((level - 0.1) * 100) / 100))}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HARM_C}55`, color: HARM_C_GLOW, background: `${HARM_C}1c` }}
        title="Nudge level −"
      >
        −Lvl
      </button>
      <button
        type="button"
        onClick={() => setParam("harmonyMode", mode === "off" ? "third" : "off")}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          mode !== "off"
            ? {
                borderColor: `${HARM_C}99`,
                color: HARM_C_GLOW,
                background: `${HARM_C}38`,
                boxShadow: `0 0 12px ${HARM_C}44`,
              }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.35)" }
        }
        title={mode === "off" ? "Engage third" : "Silence companions"}
      >
        {mode === "off" ? "Arm" : "Live"}
      </button>
      <button
        type="button"
        onClick={() => setModuleEnable("harmony", !enabled)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          enabled
            ? { borderColor: `${HARM_C}66`, color: HARM_C_GLOW, background: `${HARM_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={enabled ? "Bypass harmony" : "Engage harmony"}
      >
        {enabled ? "On" : "Bypass"}
      </button>
    </div>
  );
}

export function HarmScaleBadge() {
  const scaleRoot = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const rootName = NOTE_NAMES[((scaleRoot % 12) + 12) % 12] ?? "?";
  const label = SCALES.find((s) => s.id === scaleId)?.label ?? scaleId;
  return (
    <div
      className="mb-2 rounded-lg border px-2.5 py-1.5 text-center"
      style={{
        borderColor: `${HARM_C_ROOT}44`,
        background: `linear-gradient(180deg, ${HARM_C}14, transparent)`,
      }}
    >
      <div className="text-[7px] font-black uppercase tracking-[0.22em]" style={{ color: `${HARM_C}77` }}>
        Scale Lock Source
      </div>
      <div className="font-mono text-[12px] font-semibold" style={{ color: HARM_C_GLOW }}>
        {rootName} · {label}
      </div>
      <div className="text-[9px] text-white/40">Companions snap to Patterns root + scale</div>
    </div>
  );
}

export function harmStageLabel(mode: HarmonyMode, enabled: boolean, level: number): string {
  if (!enabled) return "Bypass — module offline";
  if (mode === "off") return "Silent — wet level at zero";
  if (level < 0.08) return "Whisper — wet level at zero";
  if (mode === "triad" && level > 0.7) return "Choir — active under play";
  if (mode === "octave") return "Octave — active under play";
  if (mode === "fifth") return "Power — active under play";
  if (mode === "third") return "Kin — active under play";
  return "Live — active under play";
}
