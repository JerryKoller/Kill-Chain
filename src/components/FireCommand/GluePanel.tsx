/**
 * Glue panel helpers — Press Anvil characters, snaps, meters.
 * Used by GluePanel in FireCommandView (needs FParamKnob / Section).
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { punchMacroToGlue, type GlueMode } from "@/audio/dsp/mixClarity";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { FC_CHIP_EYEBROW, FcChip, FcSegStrip, fcChipCharacterFor, type FcSegOption } from "./fcChip";
import { ModuleEnableToggle } from "./ModuleEnableToggle";

/** Mix band — console chips with an LED underline. */
const GLUE_CHAR = fcChipCharacterFor("glue");

export const GLUE_C = FC.glue;
export const GLUE_C_GLOW = bandShade(FC_BAND.mix, 0.9);
export const GLUE_C_HOT = bandShade(FC_BAND.mix, 0.58);
export const GLUE_C_THR = bandShade(FC_BAND.mix, 0.42);
export const GLUE_C_RAT = bandShade(FC_BAND.mix, 0.62);
export const GLUE_C_GR = bandShade(FC_BAND.mix, 0.72);
export const GLUE_C_MK = bandShade(FC_BAND.mix, 0.84);

export const GLUE_CHARS = [
  { id: "off", label: "Off", punch: 0, mode: "glue" as GlueMode },
  { id: "soft", label: "Soft", punch: 0.22, mode: "soft" as GlueMode },
  { id: "glue", label: "Glue", punch: 0.4, mode: "glue" as GlueMode },
  { id: "bus", label: "Bus", punch: 0.55, mode: "bus" as GlueMode },
  { id: "punch", label: "Punch", punch: 0.72, mode: "punch" as GlueMode },
  { id: "slam", label: "Slam", punch: 1, mode: "slam" as GlueMode },
] as const;

export const GLUE_SNAPS = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

export const GLUE_MODES: { id: GlueMode; label: string }[] = [
  { id: "soft", label: "Soft" },
  { id: "glue", label: "Glue" },
  { id: "bus", label: "Bus" },
  { id: "punch", label: "Punch" },
  { id: "slam", label: "Slam" },
];

function near(a: number, b: number, eps = 0.04) {
  return Math.abs(a - b) < eps;
}

export function glueStageLabel(p: number): string {
  if (p < 0.03) return "Open";
  if (p < 0.3) return "Soft";
  if (p < 0.55) return "Glue";
  if (p < 0.8) return "Crush";
  return "Slam";
}

export function glueMetrics(punch: number, mode: GlueMode = "glue") {
  const m = punchMacroToGlue(punch, mode);
  return {
    threshDb: m.threshDb,
    ratio: m.ratio,
    makeupDb: 20 * Math.log10(m.makeup),
    grDb: m.grEstimate,
    attack: m.attack,
    release: m.release,
    knee: m.knee,
  };
}

export function GlueMeter({
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
        {format()}
      </div>
    </div>
  );
}

export function GlueCharacterStrip() {
  const punch = useFireCommandStore((s) => s.patch.punch) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = GLUE_C;
  const tone = { color: c, onText: GLUE_C_GLOW, glow: 10 };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${c}66` }}>
        Anvil
      </span>
      {GLUE_CHARS.map((p) => (
        <FcChip
          key={p.id}
          on={near(punch, p.punch)}
          tone={tone}
          character={GLUE_CHAR}
          caseMode="normal"
          onClick={() => {
            setParam("punch", p.punch);
            setParam("glueMode", p.mode);
          }}
          title={`${p.label} · ${Math.round(p.punch * 100)}%`}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function GlueModeStrip() {
  const mode = (useFireCommandStore((s) => s.patch.glueMode) ?? "glue") as GlueMode;
  const setParam = useFireCommandStore((s) => s.setParam);
  const opts: FcSegOption<GlueMode>[] = GLUE_MODES.map((p) => ({ id: p.id, label: p.label }));
  return (
    <FcSegStrip<GlueMode>
      eyebrow="Mode"
      value={mode}
      onChange={(v) => setParam("glueMode", v)}
      options={opts}
      tone={{ color: GLUE_C, onText: GLUE_C_GLOW, glow: 0 }}
      caseMode="normal"
      character={GLUE_CHAR}
    />
  );
}

export function GlueSnapStrip() {
  const punch = useFireCommandStore((s) => s.patch.punch) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const tone = { color: GLUE_C_HOT, onText: GLUE_C_GLOW, glow: 8 };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${GLUE_C}66` }}>
        Snap
      </span>
      {GLUE_SNAPS.map((p) => (
        <FcChip
          key={p.label}
          on={near(punch, p.v)}
          tone={tone}
          character={GLUE_CHAR}
          caseMode="normal"
          mono
          onClick={() => setParam("punch", p.v)}
          title={`Punch ${p.label}%`}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function GlueQuickActions() {
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => setParam("punch", 0)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GLUE_C}55`, color: GLUE_C_GLOW, background: `${GLUE_C}1c` }}
        title="Release the press"
      >
        Open
      </button>
      <button
        type="button"
        onClick={() => setParam("punch", 0.4)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GLUE_C}55`, color: GLUE_C_GLOW, background: `${GLUE_C}1c` }}
        title="Classic bus glue"
      >
        Glue
      </button>
      <button
        type="button"
        onClick={() => setParam("punch", 1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${GLUE_C}55`, color: GLUE_C_GLOW, background: `${GLUE_C}1c` }}
        title="Maximum press"
      >
        Slam
      </button>
      <ModuleEnableToggle moduleId="glue" color={GLUE_C} name="Bus Glue" onTextColor={GLUE_C_GLOW} />
    </div>
  );
}
