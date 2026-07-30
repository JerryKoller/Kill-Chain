/**
 * Scale panel helpers — Key Lattice characters, snaps, meters, actions.
 * Used by ScalePanel in FireCommandView.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES, type ScaleId } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { SCALE_CYCLE, scaleMeta } from "./ScaleStageViz";

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

export function ScaleCharacterStrip() {
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  const c = SCALE_C;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Key
      </span>
      {SCALE_CHARS.map((p) => {
        const on = nearRoot(root, p.root) && scaleId === p.scaleId && lock === p.lock;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setScaleRoot(p.root);
              setScaleId(p.scaleId);
              setParam("scaleLock", p.lock);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: SCALE_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${NOTE_NAMES[p.root]} ${scaleMeta(p.scaleId).label}${p.lock ? " · lock" : " · open"}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScaleRootStrip() {
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const setScaleRoot = useFireSequencerStore((s) => s.setScaleRoot);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${SCALE_C}66` }}>
        Root
      </span>
      {NOTE_NAMES.map((name, i) => {
        const on = nearRoot(root, i);
        return (
          <button
            key={name}
            type="button"
            onClick={() => setScaleRoot(i)}
            className="rounded-md border px-1.5 py-0.5 text-[9px] font-bold tabular-nums transition min-w-[1.6rem]"
            style={
              on
                ? {
                    borderColor: `${SCALE_C_ROOT}99`,
                    background: `${SCALE_C_ROOT}28`,
                    color: SCALE_C_GLOW,
                    boxShadow: `0 0 8px ${SCALE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

export function ScaleModeStrip() {
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const setScaleId = useFireSequencerStore((s) => s.setScaleId);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${SCALE_C}66` }}>
        Mode
      </span>
      {SCALES.map((m) => {
        const on = scaleId === m.id;
        const short =
          m.id === "off"
            ? "Chr"
            : m.id === "pentMinor"
              ? "Pent"
              : m.id === "harmMinor"
                ? "Harm"
                : m.label.slice(0, 5);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setScaleId(m.id)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${SCALE_C_MODE}99`,
                    background: `${SCALE_C_MODE}28`,
                    color: SCALE_C_GLOW,
                    boxShadow: `0 0 8px ${SCALE_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${m.label} · ${m.steps.length} degrees`}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}

export function ScaleQuickActions() {
  const lock = useFireCommandStore((s) => s.patch.scaleLock);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scale"] !== false);
  const scaleId = useFireSequencerStore((s) => s.scaleId);
  const root = useFireSequencerStore((s) => s.scaleRoot);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
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
      <button
        type="button"
        onClick={() => setModuleEnable("scale", !enabled)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          enabled
            ? { borderColor: `${SCALE_C}66`, color: SCALE_C_GLOW, background: `${SCALE_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={enabled ? "Bypass scale module" : "Engage scale"}
      >
        {enabled ? "On" : "Asleep"}
      </button>
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
  return (
    <div className="mb-2 flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${SCALE_C}66` }}>
          Correct
        </span>
        {modes.map((m) => {
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setParam("scaleMode", m.id);
                setParam("scaleLock", m.id !== "guide");
              }}
              className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition"
              style={
                on
                  ? { borderColor: `${SCALE_C_LOCK}99`, background: `${SCALE_C_LOCK}28`, color: SCALE_C_GLOW }
                  : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
              }
              title={`${m.label} correction mode`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${SCALE_C}66` }}>
          Followers
        </span>
        {([
          ["harmony", "Harmony"],
          ["chord", "Chord"],
          ["arp", "Arp"],
          ["pianoRoll", "Roll"],
        ] as const).map(([k, lab]) => {
          const on = !!followers[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => setParam("scaleFollowers", { ...followers, [k]: !on })}
              className="rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition"
              style={
                on
                  ? { borderColor: `${SCALE_C}88`, background: `${SCALE_C}22`, color: SCALE_C_GLOW }
                  : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)" }
              }
            >
              {lab}
            </button>
          );
        })}
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
