/**
 * Gate panel helpers — Rhythm Shutter characters, snaps, meters, actions.
 * Used by GatePanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { GATE_PRESETS } from "./GateStageViz";

export const GATE_C = FC.gate;
export const GATE_C_GLOW = bandShade(FC_BAND.perf, 0.92);
export const GATE_C_HOT = bandShade(FC_BAND.perf, 0.58);
export const GATE_C_RATE = bandShade(FC_BAND.perf, 0.48);
export const GATE_C_DEPTH = bandShade(FC_BAND.perf, 0.66);
export const GATE_C_STEPS = bandShade(FC_BAND.perf, 0.78);
export const GATE_C_SMOOTH = bandShade(FC_BAND.perf, 0.88);

export { GATE_PRESETS };

export const GATE_RATE_SNAPS = [
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "4", v: 4 },
  { label: "8", v: 8 },
  { label: "12", v: 12 },
  { label: "16", v: 16 },
] as const;

export const GATE_DEPTH_SNAPS = [
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

export const GATE_STEP_SNAPS = [
  { label: "4", v: 4 },
  { label: "8", v: 8 },
  { label: "12", v: 12 },
  { label: "16", v: 16 },
] as const;

function near(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

function patternMatch(a: number[], b: number[], n: number) {
  for (let i = 0; i < n; i++) {
    if (((a[i] ?? 0) > 0.5) !== ((b[i] ?? 0) > 0.5)) return false;
  }
  return true;
}

export function GateMeter({
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

export function GateCharacterStrip() {
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const steps = useFireCommandStore((s) => s.patch.gateSteps);
  const setParam = useFireCommandStore((s) => s.setParam);
  const n = Math.max(2, Math.min(16, Math.round(steps)));
  const c = GATE_C;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Chop
      </span>
      {GATE_PRESETS.map((p) => {
        const on = patternMatch(pattern, p.steps, n);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setParam("gatePattern", [...p.steps])}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: GATE_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.name}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

export function GateRateStrip() {
  const rate = useFireCommandStore((s) => s.patch.gateRate) ?? 8;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${GATE_C}66` }}>
        Rate
      </span>
      {GATE_RATE_SNAPS.map((p) => {
        const on = near(rate, p.v, 0.35);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("gateRate", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${GATE_C_RATE}99`,
                    background: `${GATE_C_RATE}28`,
                    color: GATE_C_GLOW,
                    boxShadow: `0 0 8px ${GATE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.v} Hz`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function GateDepthStrip() {
  const depth = useFireCommandStore((s) => s.patch.gateDepth) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${GATE_C}66` }}>
        Depth
      </span>
      {GATE_DEPTH_SNAPS.map((p) => {
        const on = near(depth, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("gateDepth", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${GATE_C_DEPTH}99`,
                    background: `${GATE_C_DEPTH}28`,
                    color: GATE_C_GLOW,
                    boxShadow: `0 0 8px ${GATE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${Math.round(p.v * 100)}%`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function GateStepsStrip() {
  const steps = useFireCommandStore((s) => s.patch.gateSteps) ?? 16;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${GATE_C}66` }}>
        Steps
      </span>
      {GATE_STEP_SNAPS.map((p) => {
        const on = Math.round(steps) === p.v;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("gateSteps", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${GATE_C_STEPS}99`,
                    background: `${GATE_C_STEPS}28`,
                    color: GATE_C_GLOW,
                    boxShadow: `0 0 8px ${GATE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function GateQuickActions() {
  const on = useFireCommandStore((s) => s.patch.gateOn);
  const pattern = useFireCommandStore((s) => s.patch.gatePattern);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["gate"] !== false);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);

  const setPattern = (p: number[]) => setParam("gatePattern", p.slice(0, 16));
  const shift = (dir: 1 | -1) => {
    const n = pattern.length;
    setPattern(pattern.map((_, i) => pattern[(i - dir + n) % n]!));
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GATE_C}55`, color: GATE_C_GLOW, background: `${GATE_C}1c` }}
        title="Rotate pattern left"
      >
        ◂
      </button>
      <button
        type="button"
        onClick={() => shift(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GATE_C}55`, color: GATE_C_GLOW, background: `${GATE_C}1c` }}
        title="Rotate pattern right"
      >
        ▸
      </button>
      <button
        type="button"
        onClick={() => setPattern(pattern.map((v) => (v > 0.5 ? 0 : 1)))}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GATE_C}55`, color: GATE_C_GLOW, background: `${GATE_C}1c` }}
        title="Invert open/closed"
      >
        Inv
      </button>
      <button
        type="button"
        onClick={() => setPattern([...pattern].reverse())}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GATE_C}55`, color: GATE_C_GLOW, background: `${GATE_C}1c` }}
        title="Reverse pattern"
      >
        Rev
      </button>
      <button
        type="button"
        onClick={() => {
          const steps = Math.max(2, Math.min(16, Math.round(useFireCommandStore.getState().patch.gateSteps)));
          const hits = Math.max(1, Math.round(steps * 0.4));
          const out = new Array(16).fill(0);
          for (let i = 0; i < hits; i++) {
            const idx = Math.floor((i * steps) / hits) % steps;
            out[idx] = 1;
          }
          setPattern(out);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GATE_C}55`, color: GATE_C_GLOW, background: `${GATE_C}1c` }}
        title="Euclidean fill (~40% density)"
      >
        Euc
      </button>
      <button
        type="button"
        onClick={() => setPattern(Array.from({ length: 16 }, () => (Math.random() < 0.55 ? 1 : 0)))}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GATE_C}55`, color: GATE_C_GLOW, background: `${GATE_C}1c` }}
        title="Randomize pattern"
      >
        Rand
      </button>
      <button
        type="button"
        onClick={() => setParam("gateOn", !on)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          on
            ? {
                borderColor: `${GATE_C}99`,
                color: GATE_C_GLOW,
                background: `${GATE_C}38`,
                boxShadow: `0 0 12px ${GATE_C}44`,
              }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.35)" }
        }
        title={on ? "Stop chopping" : "Arm trance gate"}
      >
        {on ? "Chop" : "Arm"}
      </button>
      <button
        type="button"
        onClick={() => setModuleEnable("gate", !enabled)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          enabled
            ? { borderColor: `${GATE_C}66`, color: GATE_C_GLOW, background: `${GATE_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={enabled ? "Bypass gate module" : "Engage gate"}
      >
        {enabled ? "On" : "Asleep"}
      </button>
    </div>
  );
}

export function gateStageLabel(on: boolean, enabled: boolean, depth: number, rate: number): string {
  if (!enabled) return "Asleep — module offline";
  if (!on) return "Armed — waiting for notes";
  if (depth < 0.15) return "Whisper — wet level at zero";
  if (rate >= 12) return "Strobe — active under play";
  if (rate <= 2) return "Pump — active under play";
  return "Live — active under play";
}
