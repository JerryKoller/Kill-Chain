/**
 * Shared On / Asleep control — same `moduleEnable` state as the Command Map.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";

type Props = {
  moduleId: string;
  color: string;
  /** Label while awake (puts module to sleep). */
  onLabel?: string;
  /** Label while asleep (wakes module). */
  offLabel?: string;
  titleOn?: string;
  titleOff?: string;
  /** Optional band shade for on-state text. */
  onTextColor?: string;
};

export function ModuleEnableToggle({
  moduleId,
  color,
  onLabel = "Sleep",
  offLabel = "Wake",
  titleOn,
  titleOff,
  onTextColor,
}: Props) {
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.[moduleId] !== false);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  return (
    <button
      type="button"
      onClick={() => setModuleEnable(moduleId, !enabled)}
      className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
      style={
        enabled
          ? {
              borderColor: `${color}66`,
              color: onTextColor ?? `${color}cc`,
              background: `${color}22`,
              boxShadow: `0 0 8px ${color}28`,
            }
          : {
              borderColor: "rgba(255,255,255,0.18)",
              color: "rgba(255,255,255,0.42)",
              background: "rgba(0,0,0,0.45)",
            }
      }
      title={
        enabled
          ? (titleOn ?? `Put ${moduleId} to sleep (same as Signal Path Off)`)
          : (titleOff ?? `Wake ${moduleId} (same as Signal Path On)`)
      }
      aria-pressed={enabled}
      aria-label={enabled ? `Sleep ${moduleId}` : `Wake ${moduleId}`}
    >
      {enabled ? onLabel : offLabel}
    </button>
  );
}
