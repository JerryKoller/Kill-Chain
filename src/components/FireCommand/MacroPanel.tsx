/**
 * Macro panel helpers — Helm Quartet characters, snaps, meters.
 * Used by MacrosPanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { DEFAULT_FIRE_PATCH, type FirePatch } from "@/audio/dsp/FireCommandSynth";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { FC_CHIP_EYEBROW, FcChip, fcChipCharacterFor } from "./fcChip";
import { MACRO_HELM_COLORS, MACRO_KEYS, type MacroKey } from "./MacroStageViz";
import { MOD_DEST_LABELS } from "@/audio/dsp/modRouting";
import { ModuleEnableToggle } from "./ModuleEnableToggle";

/** Performance band — faceted gem chips. */
const MACRO_CHAR = fcChipCharacterFor("macros");

export const MACRO_C = FC.macros;
export const MACRO_C_GLOW = bandShade(FC_BAND.perf, 0.92);
export const MACRO_C_HOT = bandShade(FC_BAND.perf, 0.58);
export { MACRO_HELM_COLORS, MACRO_KEYS };
export type { MacroKey };

export const MACRO_CHARS = [
  { id: "zero", label: "Zero", vals: [0, 0, 0, 0] as const },
  { id: "soft", label: "Soft", vals: [0.25, 0.25, 0.25, 0.25] as const },
  { id: "half", label: "Half", vals: [0.5, 0.5, 0.5, 0.5] as const },
  { id: "rise", label: "Rise", vals: [0.2, 0.4, 0.6, 0.85] as const },
  { id: "focus", label: "Lead", vals: [1, 0, 0, 0] as const },
  { id: "dual", label: "Dual", vals: [0.75, 0.75, 0, 0] as const },
  { id: "cross", label: "Cross", vals: [1, 0, 1, 0] as const },
  { id: "wave", label: "Wave", vals: [0, 0.5, 1, 0.5] as const },
] as const;

export const MACRO_SNAPS = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

function near(a: number, b: number, eps = 0.05) {
  return Math.abs(a - b) < eps;
}

function nearAll(vals: number[], target: readonly number[]) {
  return vals.every((v, i) => near(v, target[i]!, 0.08));
}

export function MacroMeter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const t = Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.6rem]" title={`${label} ${Math.round(t * 100)}%`}>
      <div className="fc-text-floor font-black uppercase tracking-[0.06em]" style={{ color: `${color}aa` }}>
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
        {Math.round(t * 100)}
      </div>
    </div>
  );
}

export function MacroCharacterStrip() {
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const vals = [m1, m2, m3, m4];
  const c = MACRO_C;
  const tone = { color: c, onText: MACRO_C_GLOW, glow: 10 };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${c}66` }}>
        Helm
      </span>
      {MACRO_CHARS.map((p) => (
        <FcChip
          key={p.id}
          on={nearAll(vals, p.vals)}
          tone={tone}
          character={MACRO_CHAR}
          caseMode="normal"
          onClick={() => {
            setParam("macro1", p.vals[0]);
            setParam("macro2", p.vals[1]);
            setParam("macro3", p.vals[2]);
            setParam("macro4", p.vals[3]);
          }}
          title={p.label}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function MacroSnapStrip() {
  const setParam = useFireCommandStore((s) => s.setParam);
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const allSame = near(m1, m2) && near(m2, m3) && near(m3, m4);
  const tone = { color: MACRO_C_HOT, onText: MACRO_C_GLOW, glow: 8 };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${MACRO_C}66` }}>
        All
      </span>
      {MACRO_SNAPS.map((p) => (
        <FcChip
          key={p.label}
          on={allSame && near(m1, p.v)}
          tone={tone}
          character={MACRO_CHAR}
          caseMode="normal"
          mono
          onClick={() => {
            setParam("macro1", p.v);
            setParam("macro2", p.v);
            setParam("macro3", p.v);
            setParam("macro4", p.v);
          }}
          title={`Set all macros to ${p.label}%`}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function MacroQuickActions() {
  const setParam = useFireCommandStore((s) => s.setParam);
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const matrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const response = useFireCommandStore((s) => s.patch.macroResponse) ?? "absolute";

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <select
        value={response}
        onChange={(e) => setParam("macroResponse", e.target.value as FirePatch["macroResponse"])}
        className="h-6 rounded-md border bg-black/40 px-1 text-[9px] uppercase tracking-wider outline-none"
        style={{ borderColor: `${MACRO_C}44`, color: MACRO_C_GLOW }}
        title="Macro response mode"
      >
        <option value="absolute">Absolute</option>
        <option value="relative">Relative (zero at arm)</option>
        <option value="bipolar">Bipolar</option>
        <option value="smoothed">Smoothed</option>
      </select>
      <button
        type="button"
        onClick={() => {
          setParam("macro1", 0);
          setParam("macro2", 0);
          setParam("macro3", 0);
          setParam("macro4", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${MACRO_C}55`, color: MACRO_C_GLOW, background: `${MACRO_C}1c` }}
        title="Zero — return all macros to neutral (0)"
      >
        Zero
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("macro1", 1 - m1);
          setParam("macro2", 1 - m2);
          setParam("macro3", 1 - m3);
          setParam("macro4", 1 - m4);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${MACRO_C}55`, color: MACRO_C_GLOW, background: `${MACRO_C}1c` }}
        title="Invert — invert current macro values"
      >
        Invert
      </button>
      <button
        type="button"
        onClick={() => {
          const next = matrix.map((r) => {
            if (!r.source.startsWith("macro") || r.dest === "none") return r;
            return { ...r, amount: -r.amount };
          });
          setParam("modMatrix", next);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${MACRO_C}55`, color: MACRO_C_GLOW, background: `${MACRO_C}1c` }}
        title="Flip — negate destination amounts for all macro routes (swap min/max sense)"
      >
        Flip
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("macro1", DEFAULT_FIRE_PATCH.macro1);
          setParam("macro2", DEFAULT_FIRE_PATCH.macro2);
          setParam("macro3", DEFAULT_FIRE_PATCH.macro3);
          setParam("macro4", DEFAULT_FIRE_PATCH.macro4);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${MACRO_C}55`, color: MACRO_C_GLOW, background: `${MACRO_C}1c` }}
        title="Reset — restore default patch macro positions"
      >
        Reset
      </button>
      <ModuleEnableToggle
        moduleId="macros"
        color={MACRO_C}
        name="Macros"
        onTextColor={MACRO_C_GLOW}
        titleOn="Sleep Macros (matrix reads 0 — same as Signal Path Off)"
      />
    </div>
  );
}

export function macroStageLabel(vals: number[]): string {
  const e = Math.max(...vals);
  if (e < 0.03) return "Idle — enabled, no activity";
  if (vals.every((v) => near(v, vals[0]!))) return "Uniform — enabled, no activity";
  if (vals[0]! > 0.7 && vals[1]! < 0.15 && vals[2]! < 0.15 && vals[3]! < 0.15) return "Lead — active under play";
  if (vals[0]! > 0.5 && vals[2]! > 0.5 && vals[1]! < 0.2 && vals[3]! < 0.2) return "Cross — active under play";
  if (vals[0]! < vals[1]! && vals[1]! < vals[2]! && vals[2]! < vals[3]!) return "Rise — active under play";
  return "Live — active under play";
}
