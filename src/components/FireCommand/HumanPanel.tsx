/**
 * Humanize panel helpers — Feel Grain characters, snaps, meters, actions.
 * Used by HumanPanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { FC_CHIP_EYEBROW, FcChip, fcChipCharacterFor } from "./fcChip";
import { HUMAN_CHARS, humanCharMatch } from "./HumanStageViz";
import { ModuleEnableToggle } from "./ModuleEnableToggle";

/** Performance band — faceted gem chips. */
const HUMAN_CHAR = fcChipCharacterFor("human");

export const HUMAN_C = FC.human;
export const HUMAN_C_GLOW = bandShade(FC_BAND.perf, 0.96);
export const HUMAN_C_HOT = bandShade(FC_BAND.perf, 0.64);
export const HUMAN_C_TIME = bandShade(FC_BAND.perf, 0.52);
export const HUMAN_C_VEL = bandShade(FC_BAND.perf, 0.8);
export const HUMAN_C_ARM = bandShade(FC_BAND.perf, 0.88);

export { HUMAN_CHARS, humanCharMatch };

export const HUMAN_TIME_SNAPS = [
  { label: "0", v: 0 },
  { label: "12", v: 0.12 },
  { label: "25", v: 0.25 },
  { label: "45", v: 0.45 },
  { label: "70", v: 0.7 },
  { label: "100", v: 1 },
] as const;

export const HUMAN_VEL_SNAPS = [
  { label: "0", v: 0 },
  { label: "10", v: 0.1 },
  { label: "20", v: 0.2 },
  { label: "35", v: 0.35 },
  { label: "55", v: 0.55 },
  { label: "100", v: 1 },
] as const;

function near(a: number, b: number, eps = 0.05) {
  return Math.abs(a - b) < eps;
}

export function HumanMeter({
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

export function HumanCharacterStrip() {
  const on = useFireCommandStore((s) => s.patch.humanizeOn);
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming) ?? 0.25;
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity) ?? 0.2;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = HUMAN_C;
  const tone = { color: c, onText: HUMAN_C_GLOW, glow: 10 };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${c}66` }}>
        Feel
      </span>
      {HUMAN_CHARS.map((p) => (
        <FcChip
          key={p.id}
          on={p.on === on && near(timing, p.timing) && near(vel, p.vel)}
          tone={tone}
          character={HUMAN_CHAR}
          caseMode="normal"
          onClick={() => {
            setParam("humanizeOn", p.on);
            setParam("humanizeTiming", p.timing);
            setParam("humanizeVelocity", p.vel);
          }}
          title={`${p.label} · T${Math.round(p.timing * 100)} V${Math.round(p.vel * 100)}`}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function HumanTimingStrip() {
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming) ?? 0.25;
  const setParam = useFireCommandStore((s) => s.setParam);
  const tone = { color: HUMAN_C_TIME, onText: HUMAN_C_GLOW, glow: 8 };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${HUMAN_C}66` }}>
        Time
      </span>
      {HUMAN_TIME_SNAPS.map((p) => (
        <FcChip
          key={p.label}
          on={near(timing, p.v, 0.04)}
          tone={tone}
          character={HUMAN_CHAR}
          caseMode="normal"
          mono
          onClick={() => {
            setParam("humanizeTiming", p.v);
            if (p.v > 0) setParam("humanizeOn", true);
          }}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function HumanVelStrip() {
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity) ?? 0.2;
  const setParam = useFireCommandStore((s) => s.setParam);
  const tone = { color: HUMAN_C_VEL, onText: HUMAN_C_GLOW, glow: 8 };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${HUMAN_C}66` }}>
        Vel
      </span>
      {HUMAN_VEL_SNAPS.map((p) => (
        <FcChip
          key={p.label}
          on={near(vel, p.v, 0.04)}
          tone={tone}
          character={HUMAN_CHAR}
          caseMode="normal"
          mono
          onClick={() => {
            setParam("humanizeVelocity", p.v);
            if (p.v > 0) setParam("humanizeOn", true);
          }}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function HumanQuickActions() {
  const on = useFireCommandStore((s) => s.patch.humanizeOn);
  const timing = useFireCommandStore((s) => s.patch.humanizeTiming) ?? 0.25;
  const vel = useFireCommandStore((s) => s.patch.humanizeVelocity) ?? 0.2;
  const setParam = useFireCommandStore((s) => s.setParam);
  const humanizeNotes = useFireSequencerStore((s) => s.humanizeNotes);

  const cycle = (dir: 1 | -1) => {
    let best = 0;
    for (let i = 0; i < HUMAN_CHARS.length; i++) {
      const c = HUMAN_CHARS[i]!;
      if (c.on === on && near(timing, c.timing) && near(vel, c.vel)) {
        best = i;
        break;
      }
    }
    const next = HUMAN_CHARS[(best + dir + HUMAN_CHARS.length) % HUMAN_CHARS.length]!;
    setParam("humanizeOn", next.on);
    setParam("humanizeTiming", next.timing);
    setParam("humanizeVelocity", next.vel);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => cycle(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HUMAN_C}55`, color: HUMAN_C_GLOW, background: `${HUMAN_C}1c` }}
        title="Previous feel"
      >
        ◂
      </button>
      <button
        type="button"
        onClick={() => cycle(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HUMAN_C}55`, color: HUMAN_C_GLOW, background: `${HUMAN_C}1c` }}
        title="Next feel"
      >
        ▸
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("humanizeTiming", vel);
          setParam("humanizeVelocity", timing);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HUMAN_C}55`, color: HUMAN_C_GLOW, background: `${HUMAN_C}1c` }}
        title="Swap timing ↔ velocity"
      >
        Swap
      </button>
      <button
        type="button"
        onClick={() => humanizeNotes()}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HUMAN_C}55`, color: HUMAN_C_GLOW, background: `${HUMAN_C}1c` }}
        title="Bake humanize into pattern notes"
      >
        Bake
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("humanizeTiming", 0);
          setParam("humanizeVelocity", 0);
          setParam("humanizeOn", false);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${HUMAN_C}55`, color: HUMAN_C_GLOW, background: `${HUMAN_C}1c` }}
        title="Return to grid"
      >
        Grid
      </button>
      <button
        type="button"
        onClick={() => setParam("humanizeOn", !on)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          on
            ? {
                borderColor: `${HUMAN_C}99`,
                color: HUMAN_C_GLOW,
                background: `${HUMAN_C}38`,
                boxShadow: `0 0 12px ${HUMAN_C}44`,
              }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.35)" }
        }
        title={on ? "Disable feel" : "Enable feel"}
      >
        {on ? "Feel" : "Grid"}
      </button>
      <ModuleEnableToggle moduleId="human" color={HUMAN_C} name="Humanize" onTextColor={HUMAN_C_GLOW} />
    </div>
  );
}

export function humanStageLabel(on: boolean, enabled: boolean, timing: number, vel: number): string {
  if (!enabled) return "Asleep — module offline";
  if (!on || (timing < 0.03 && vel < 0.03)) return "Grid — humanize bypassed";
  const hit = humanCharMatch(timing, vel, on);
  if (hit) return `${hit.label} — active under play`;
  if (timing > 0.55 && vel < 0.2) return "Time — active under play";
  if (vel > 0.55 && timing < 0.2) return "Dyn — active under play";
  if (timing + vel > 1.2) return "Wild — active under play";
  return "Feel — active under play";
}
