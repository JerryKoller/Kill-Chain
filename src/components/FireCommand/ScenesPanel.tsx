/**
 * Scenes panel helpers — Orbit Vault modes, meters, actions.
 * Used by ScenesPanel in FireCommandView.
 */

import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import type { FirePatch } from "@/audio/dsp/FireCommandSynth";
import { FC, FC_BAND, bandShade } from "./fireColors";
import {
  SCENE_MODES,
  type SceneMode,
  sceneFingerprint,
  occupiedCount,
  firstEmptySlot,
} from "./ScenesStageViz";

export const SCENES_C = FC.scenes;
export const SCENES_C_GLOW = bandShade(FC_BAND.perf, 0.98);
export const SCENES_C_HOT = bandShade(FC_BAND.perf, 0.72);
export const SCENES_C_FILL = bandShade(FC_BAND.perf, 0.58);
export const SCENES_C_EMPTY = bandShade(FC_BAND.perf, 0.42);
export const SCENES_C_MODE = bandShade(FC_BAND.perf, 0.85);

export { SCENE_MODES, SCENE_SLOTS, sceneFingerprint, occupiedCount, firstEmptySlot };
export type { SceneMode };

export function ScenesMeter({
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

export function ScenesModeStrip({
  mode,
  onModeChange,
}: {
  mode: SceneMode;
  onModeChange: (m: SceneMode) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${SCENES_C}66` }}>
        Mode
      </span>
      {SCENE_MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            className="rounded-md border px-2.5 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${SCENES_C_MODE}99`,
                    background: `${SCENES_C_MODE}28`,
                    color: SCENES_C_GLOW,
                    boxShadow: `0 0 8px ${SCENES_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={m.label}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScenesQuickActions({
  mode,
  onModeChange,
  onActiveSlot,
}: {
  mode: SceneMode;
  onModeChange: (m: SceneMode) => void;
  onActiveSlot: (i: number) => void;
}) {
  const scenes = useFireCommandStore((s) => s.scenes);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["scenes"] !== false);
  const sceneTransition = useFireCommandStore((s) => s.sceneTransition);
  const setSceneTransition = useFireCommandStore((s) => s.setSceneTransition);
  const captureScene = useFireCommandStore((s) => s.captureScene);
  const recallScene = useFireCommandStore((s) => s.recallScene);
  const clearScene = useFireCommandStore((s) => s.clearScene);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const occ = occupiedCount(scenes);

  const cycle = (dir: 1 | -1) => {
    const ids = SCENE_MODES.map((m) => m.id);
    const i = ids.indexOf(mode);
    onModeChange(ids[(i + dir + ids.length) % ids.length]!);
  };

  const captureNext = () => {
    const i = firstEmptySlot(scenes);
    onModeChange("capture");
    onActiveSlot(i);
    captureScene(i);
  };

  const clearAll = () => {
    for (let i = 0; i < SCENE_SLOTS; i++) {
      if (scenes[i]) clearScene(i);
    }
  };

  const recallFirst = () => {
    const i = scenes.findIndex(Boolean);
    if (i < 0) return;
    onModeChange("recall");
    onActiveSlot(i);
    recallScene(i);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <select
        value={sceneTransition}
        onChange={(e) =>
          setSceneTransition(e.target.value as "immediate" | "nextBar" | "morphMs")
        }
        className="h-6 rounded-md border bg-black/40 px-1 text-[9px] uppercase outline-none"
        style={{ borderColor: `${SCENES_C}44`, color: SCENES_C_GLOW }}
        title="Scene recall transition"
      >
        <option value="immediate">Immediate</option>
        <option value="nextBar">Next bar</option>
        <option value="morphMs">Morph</option>
      </select>
      <button
        type="button"
        onClick={() => cycle(-1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCENES_C}55`, color: SCENES_C_GLOW, background: `${SCENES_C}1c` }}
        title="Previous mode"
      >
        ◂
      </button>
      <button
        type="button"
        onClick={() => cycle(1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCENES_C}55`, color: SCENES_C_GLOW, background: `${SCENES_C}1c` }}
        title="Next mode"
      >
        ▸
      </button>
      <button
        type="button"
        onClick={captureNext}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${SCENES_C}55`, color: SCENES_C_GLOW, background: `${SCENES_C}1c` }}
        title="Capture patch into next empty slot"
      >
        Next
      </button>
      <button
        type="button"
        onClick={recallFirst}
        disabled={occ === 0}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125 disabled:opacity-30"
        style={{ borderColor: `${SCENES_C}55`, color: SCENES_C_GLOW, background: `${SCENES_C}1c` }}
        title="Recall first filled slot"
      >
        Jump
      </button>
      <button
        type="button"
        onClick={clearAll}
        disabled={occ === 0}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125 disabled:opacity-30"
        style={{ borderColor: `${SCENES_C}55`, color: SCENES_C_GLOW, background: `${SCENES_C}1c` }}
        title="Clear all scene slots"
      >
        Wipe
      </button>
      <button
        type="button"
        onClick={() => setModuleEnable("scenes", !enabled)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          enabled
            ? { borderColor: `${SCENES_C}66`, color: SCENES_C_GLOW, background: `${SCENES_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={enabled ? "Bypass scenes module UI" : "Engage scenes"}
      >
        {enabled ? "On" : "Asleep"}
      </button>
    </div>
  );
}

export function sceneStageLabel(occ: number, mode: SceneMode, enabled: boolean): string {
  if (!enabled) return "Asleep — module offline";
  if (occ === 0) return "Empty — no saved scene";
  if (occ >= SCENE_SLOTS) return "Full — scene bank in motion";
  if (mode === "capture") return "Capture — waiting for notes";
  if (mode === "clear") return "Clear — enabled, no activity";
  return "Orbit — scene bank in motion";
}

export function avgSceneEnergy(scenes: (Partial<FirePatch> | null)[]): number {
  const fps = scenes.filter(Boolean).map((s) => sceneFingerprint(s).energy);
  if (!fps.length) return 0;
  return fps.reduce((a, b) => a + b, 0) / fps.length;
}
