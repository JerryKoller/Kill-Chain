/**
 * Scale panel helpers — Key Lattice characters, snaps, meters, actions.
 * Used by ScalePanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES, type ScaleId } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { FC_CHIP_EYEBROW, FcChip, FcSegStrip, fcChipCharacterFor, type FcSegOption } from "./fcChip";
import { SCALE_CYCLE, scaleMeta } from "./ScaleStageViz";
import { ModuleEnableToggle } from "./ModuleEnableToggle";

/** Performance band — faceted gem chips. */
const SCALE_CHAR = fcChipCharacterFor("scale");

export const SCALE_C = FC.scale;
export const SCALE_C_GLOW = bandShade(FC_BAND.perf, 0.94);
export const SCALE_C_HOT = bandShade(FC_BAND.perf, 0.6);
export const SCALE_C_ROOT = bandShade(FC_BAND.perf, 0.52);
export const SCALE_C_MODE = bandShade(FC_BAND.perf, 0.72);
export const SCALE_C_LOCK = bandShade(FC_BAND.perf, 0.82);

export { SCALE_CYCLE, scaleMeta };

export const SCALE_CHARS = [
  { id: "open", label: "Open", root: 0, scaleId: "off" as ScaleId, lock: false },
  { id: "amin", label: "A Min", root: 9, scaleId: "minor" as ScaleId, lock: true },
  { id: "cmaj", label: "C Maj", root: 0, scaleId: "major" as ScaleId, lock: true },
  { id: "epent", label: "E Pent", root: 4, scaleId: "pentMinor" as ScaleId, lock: true },
  { id: "dblues", label: "D Blues", root: 2, scaleId: "blues" as ScaleId, lock: true },
  { id: "gdor", label: "G Dor", root: 7, scaleId: "dorian" as ScaleId, lock: true },
  { id: "ephr", label: "E Phr", root: 4, scaleId: "phrygian" as ScaleId, lock: true },
  { id: "aharm", label: "A Harm", root: 9, scaleId: "harmMinor" as ScaleId, lock: true },
] as const;

function nearRoot(a: number, b: number) {
  return ((a % 12) + 12) % 12 === ((b % 12) + 12) % 12;
}

export function ScaleMeter({
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

export function ScaleCharacterStrip() {
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  const c = SCALE_C;
  const tone = { color: c, onText: SCALE_C_GLOW, glow: 10 };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${c}66` }}>
        Key
      </span>
      {SCALE_CHARS.map((p) => (
        <FcChip
          key={p.id}
          on={nearRoot(root, p.root) && scaleId === p.scaleId && lock === p.lock}
          tone={tone}
          character={SCALE_CHAR}
          caseMode="normal"
          onClick={() => {
            setScaleRoot(p.root);
            setScaleId(p.scaleId);
            setParam("scaleLock", p.lock);
          }}
          title={`${NOTE_NAMES[p.root]} ${scaleMeta(p.scaleId).label}${p.lock ? " · lock" : " · open"}`}
        >
          {p.label}
        </FcChip>
      ))}
    </div>
  );
}

export function ScaleRootStrip() {
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const tone = { color: SCALE_C_ROOT, onText: SCALE_C_GLOW, glow: 8 };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className={FC_CHIP_EYEBROW} style={{ color: `${SCALE_C}66` }}>
        Root
      </span>
      {NOTE_NAMES.map((name, i) => (
        <FcChip
          key={name}
          on={nearRoot(root, i)}
          tone={tone}
          character={SCALE_CHAR}
          caseMode="normal"
          mono
          padX="sm"
          extra="min-w-[1.6rem]"
          onClick={() => setScaleRoot(i)}
        >
          {name}
        </FcChip>
      ))}
    </div>
  );
}

/** Chromatic / Pent / Harm need hand-shortened labels; the rest clip to 5. */
function scaleShortLabel(id: ScaleId, label: string): string {
  if (id === "off") return "Chr";
  if (id === "pentMinor") return "Pent";
  if (id === "harmMinor") return "Harm";
  return label.slice(0, 5);
}

export function ScaleModeStrip() {
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  const opts: FcSegOption<ScaleId>[] = SCALES.map((m) => ({
    id: m.id,
    label: scaleShortLabel(m.id, m.label),
    tip: `${m.label} · ${m.steps.length} degrees`,
  }));
  return (
    <FcSegStrip<ScaleId>
      eyebrow="Mode"
      value={scaleId}
      onChange={setScaleId}
      options={opts}
      tone={{ color: SCALE_C_MODE, onText: SCALE_C_GLOW, glow: 8 }}
      caseMode="normal"
      character={SCALE_CHAR}
    />
  );
}

export function ScaleQuickActions() {
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  const detectAndApplyKey = useFireSequencerStore((s) => s.detectAndApplyKey);

  const cycleScale = (dir: 1 | -1) => {
    const i = SCALE_CYCLE.indexOf(scaleId);
    setScaleId(SCALE_CYCLE[(i + dir + SCALE_CYCLE.length) % SCALE_CYCLE.length]!);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => setScaleRoot((root + 11) % 12)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCALE_C}55`, color: SCALE_C_GLOW, background: `${SCALE_C}1c` }}
        title="Root −1"
      >
        ◂R
      </button>
      <button
        type="button"
        onClick={() => setScaleRoot((root + 1) % 12)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCALE_C}55`, color: SCALE_C_GLOW, background: `${SCALE_C}1c` }}
        title="Root +1"
      >
        R▸
      </button>
      <button
        type="button"
        onClick={() => cycleScale(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCALE_C}55`, color: SCALE_C_GLOW, background: `${SCALE_C}1c` }}
        title="Previous scale"
      >
        ◂S
      </button>
      <button
        type="button"
        onClick={() => cycleScale(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCALE_C}55`, color: SCALE_C_GLOW, background: `${SCALE_C}1c` }}
        title="Next scale"
      >
        S▸
      </button>
      <button
        type="button"
        onClick={() => {
          const hit = detectAndApplyKey();
          if (hit) setParam("scaleLock", true);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCALE_C}55`, color: SCALE_C_GLOW, background: `${SCALE_C}1c` }}
        title="Detect key from pattern notes"
      >
        Detect
      </button>
      <button
        type="button"
        onClick={() => setParam("scaleLock", !lock)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          lock
            ? {
                borderColor: `${SCALE_C}99`,
                color: SCALE_C_GLOW,
                background: `${SCALE_C}38`,
                boxShadow: `0 0 12px ${SCALE_C}44`,
              }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.35)" }
        }
        title={lock ? "Unlock live pitch snap" : "Lock live input to scale"}
      >
        {lock ? "Lock" : "Open"}
      </button>
      <ModuleEnableToggle moduleId="scale" color={SCALE_C} name="Scale Lock" onTextColor={SCALE_C_GLOW} />
    </div>
  );
}

export function ScaleCorrectStrip() {
  const mode = useFireCommandStore((s) => s.patch.scaleMode) ?? (useFireCommandStore.getState().patch.scaleLock ? "soft" : "guide");
  const followers = useFireCommandStore((s) => s.patch.scaleFollowers) ?? {
    harmony: true,
    chord: true,
    arp: true,
    pianoRoll: false,
  };
  const setParam = useFireCommandStore((s) => s.setParam);
  const modes = [
    { id: "guide" as const, label: "Guide" },
    { id: "soft" as const, label: "Soft" },
    { id: "strict" as const, label: "Strict" },
    { id: "fold" as const, label: "Fold" },
  ];
  // Both rows sit inside a shared column, so they keep their own wrappers
  // rather than FcSegStrip's `mb-2` row.
  const modeTone = { color: SCALE_C_LOCK, onText: SCALE_C_GLOW, glow: 0 };
  const followTone = { color: SCALE_C, onText: SCALE_C_GLOW, glow: 0 };
  return (
    <div className="mb-2 flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className={FC_CHIP_EYEBROW} style={{ color: `${SCALE_C}66` }}>
          Correct
        </span>
        {modes.map((m) => (
          <FcChip
            key={m.id}
            on={mode === m.id}
            tone={modeTone}
            character={SCALE_CHAR}
            onClick={() => {
              setParam("scaleMode", m.id);
              setParam("scaleLock", m.id !== "guide");
            }}
            title={`${m.label} correction mode`}
          >
            {m.label}
          </FcChip>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className={FC_CHIP_EYEBROW} style={{ color: `${SCALE_C}66` }}>
          Followers
        </span>
        {([
          ["harmony", "Harmony"],
          ["chord", "Chord"],
          ["arp", "Arp"],
          ["pianoRoll", "Roll"],
        ] as const).map(([k, lab]) => (
          <FcChip
            key={k}
            on={!!followers[k]}
            tone={followTone}
            character={SCALE_CHAR}
            onClick={() => setParam("scaleFollowers", { ...followers, [k]: !followers[k] })}
          >
            {lab}
          </FcChip>
        ))}
      </div>
    </div>
  );
}

export function scaleStageLabel(lock: boolean, enabled: boolean, scaleId: ScaleId): string {
  if (!enabled) return "Asleep — module offline";
  if (!lock) return "Open — scale correction disabled";
  if (scaleId === "off") return "Chromatic — scale correction disabled";
  if (scaleId === "pentMinor" || scaleId === "blues") return "Tight — correction engaged";
  return "Locked — correction engaged";
}
