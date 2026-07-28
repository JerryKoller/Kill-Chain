/**
 * Chord panel helpers — Stack Vault characters, snaps, meters, actions.
 * Used by ChordPanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import {
  CHORD_PRESETS,
  chordMatch,
  chordPresetLabel,
  normalizeChordIvs,
} from "./ChordStageViz";

export const CHORD_C = FC.chord;
export const CHORD_C_GLOW = bandShade(FC_BAND.perf, 0.95);
export const CHORD_C_HOT = bandShade(FC_BAND.perf, 0.62);
export const CHORD_C_ROOT = bandShade(FC_BAND.perf, 0.52);
export const CHORD_C_VOICE = bandShade(FC_BAND.perf, 0.78);
export const CHORD_C_ARM = bandShade(FC_BAND.perf, 0.85);

export { CHORD_PRESETS, chordMatch, chordPresetLabel, normalizeChordIvs };

/** Common interval toggles (semitones from root). */
export const CHORD_DEGREE_TOGGLES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 19] as const;

export function ChordMeter({
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

export function ChordCharacterStrip() {
  const ivs = useFireCommandStore((s) => s.patch.chordIntervals);
  const on = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = CHORD_C;
  const cur = normalizeChordIvs(ivs);

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Stack
      </span>
      {CHORD_PRESETS.map((p) => {
        const hit = chordMatch(cur, p.ivs);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("chordIntervals", [...p.ivs]);
              if (!on) setParam("chordMemoryOn", true);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              hit
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: CHORD_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.name} · ${p.ivs.map((n) => (n === 0 ? "0" : `+${n}`)).join(" ")}`}
          >
            {p.short}
          </button>
        );
      })}
    </div>
  );
}

export function ChordDegreeStrip() {
  const ivs = useFireCommandStore((s) => s.patch.chordIntervals);
  const setParam = useFireCommandStore((s) => s.setParam);
  const cur = normalizeChordIvs(ivs);

  const toggle = (semi: number) => {
    const set = new Set(cur);
    if (set.has(semi)) set.delete(semi);
    else set.add(semi);
    set.add(0);
    setParam("chordIntervals", normalizeChordIvs([...set]));
  };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${CHORD_C}66` }}>
        Deg
      </span>
      <span
        className="rounded-md border px-2 py-0.5 text-[9px] font-bold"
        style={{
          borderColor: `${CHORD_C_ROOT}99`,
          background: `${CHORD_C_ROOT}28`,
          color: CHORD_C_GLOW,
        }}
        title="Root (always on)"
      >
        0
      </span>
      {CHORD_DEGREE_TOGGLES.map((d) => {
        const hit = cur.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className="rounded-md border px-1.5 py-0.5 text-[9px] font-bold tabular-nums transition min-w-[1.7rem]"
            style={
              hit
                ? {
                    borderColor: `${CHORD_C_VOICE}99`,
                    background: `${CHORD_C_VOICE}28`,
                    color: CHORD_C_GLOW,
                    boxShadow: `0 0 8px ${CHORD_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`Toggle +${d} semitones`}
          >
            +{d}
          </button>
        );
      })}
    </div>
  );
}

export function ChordQuickActions() {
  const on = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const ivs = useFireCommandStore((s) => s.patch.chordIntervals);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["chord"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const learnChordFromHeld = useFireCommandStore((s) => s.learnChordFromHeld);
  const cur = normalizeChordIvs(ivs);

  const cycle = (dir: 1 | -1) => {
    let best = 0;
    for (let i = 0; i < CHORD_PRESETS.length; i++) {
      if (chordMatch(cur, CHORD_PRESETS[i]!.ivs)) {
        best = i;
        break;
      }
    }
    const next = CHORD_PRESETS[(best + dir + CHORD_PRESETS.length) % CHORD_PRESETS.length]!;
    setParam("chordIntervals", [...next.ivs]);
  };

  const invert = () => {
    // Drop lowest non-root up an octave (classic invert)
    if (cur.length < 2) return;
    const rest = cur.filter((n) => n !== 0);
    const low = rest[0]!;
    const moved = [...rest.slice(1), low + 12];
    setParam("chordIntervals", normalizeChordIvs([0, ...moved]));
  };

  const drop2 = () => {
    // Move second-highest voice down an octave if possible
    if (cur.length < 3) return;
    const sorted = [...cur].sort((a, b) => a - b);
    const second = sorted[sorted.length - 2]!;
    if (second <= 0) return;
    const next = sorted.map((n) => (n === second ? n - 12 : n));
    setParam("chordIntervals", normalizeChordIvs(next));
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => cycle(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${CHORD_C}55`, color: CHORD_C_GLOW, background: `${CHORD_C}1c` }}
        title="Previous voicing"
      >
        ◂
      </button>
      <button
        type="button"
        onClick={() => cycle(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${CHORD_C}55`, color: CHORD_C_GLOW, background: `${CHORD_C}1c` }}
        title="Next voicing"
      >
        ▸
      </button>
      <button
        type="button"
        onClick={invert}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${CHORD_C}55`, color: CHORD_C_GLOW, background: `${CHORD_C}1c` }}
        title="Invert (rotate lowest up octave)"
      >
        Inv
      </button>
      <button
        type="button"
        onClick={drop2}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${CHORD_C}55`, color: CHORD_C_GLOW, background: `${CHORD_C}1c` }}
        title="Drop-2 voicing"
      >
        Drop2
      </button>
      <button
        type="button"
        onClick={() => learnChordFromHeld()}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${CHORD_C}55`, color: CHORD_C_GLOW, background: `${CHORD_C}1c` }}
        title="Learn intervals from held notes"
      >
        Learn
      </button>
      <button
        type="button"
        onClick={() => setParam("chordIntervals", [0, 4, 7])}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${CHORD_C}55`, color: CHORD_C_GLOW, background: `${CHORD_C}1c` }}
        title="Reset to major triad"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => setParam("chordMemoryOn", !on)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          on
            ? {
                borderColor: `${CHORD_C}99`,
                color: CHORD_C_GLOW,
                background: `${CHORD_C}38`,
                boxShadow: `0 0 12px ${CHORD_C}44`,
              }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.35)" }
        }
        title={on ? "Disarm chord memory" : "Arm chord memory"}
      >
        {on ? "Armed" : "Idle"}
      </button>
      <button
        type="button"
        onClick={() => setModuleEnable("chord", !enabled)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          enabled
            ? { borderColor: `${CHORD_C}66`, color: CHORD_C_GLOW, background: `${CHORD_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={enabled ? "Bypass chord module" : "Engage chord"}
      >
        {enabled ? "On" : "Bypass"}
      </button>
    </div>
  );
}

export function chordStageLabel(on: boolean, enabled: boolean, ivs: number[]): string {
  if (!enabled) return "Bypass";
  if (!on) return "Idle";
  const n = normalizeChordIvs(ivs).length;
  if (n <= 2) return "Power";
  if (n >= 4) return "Rich";
  return chordPresetLabel(ivs);
}
