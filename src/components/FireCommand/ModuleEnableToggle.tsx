/**
 * Canonical module sleep/wake vocabulary + the shared toggle.
 *
 * One concept, one pair of words everywhere: **Sleep** / **Wake** are the
 * actions, **Asleep** is the state, **Zzz** is the compact glyph for dense
 * chrome (Command Map, FX rack, band chips). Anything reading Mute / Bypass /
 * Park / Dry / Veil / Cool used to mean exactly this and now says Sleep.
 *
 * Pluck's Armed / Disarmed is a *different* concept (vactrol strike arming)
 * and deliberately keeps its own words.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { FcChipMark, fcChipCharacterFor, fcChipCharacterStyle, fcChipClass, useFcChipFocusRing } from "./fcChip";

export const SLEEP_ACTION = "Sleep";
export const WAKE_ACTION = "Wake";
/** State word — used by the Section badge and the ASLEEP hero pill. */
export const ASLEEP_STATE = "Asleep";
/** Compact glyph — only where a full word will not fit. */
export const ASLEEP_GLYPH = "Zzz";

/** Verb for the button that will flip the module. */
export function moduleEnableAction(enabled: boolean): string {
  return enabled ? SLEEP_ACTION : WAKE_ACTION;
}

/** Compact state readout for dense chrome: awake reads On, asleep reads Zzz. */
export function moduleEnableGlyph(enabled: boolean): string {
  return enabled ? "On" : ASLEEP_GLYPH;
}

export function moduleEnableTitle(enabled: boolean, name: string): string {
  return enabled
    ? `${SLEEP_ACTION} ${name} (same as Signal Path Off)`
    : `${WAKE_ACTION} ${name} (same as Signal Path On)`;
}

export function moduleEnableAria(enabled: boolean, name: string): string {
  return `${moduleEnableAction(enabled)} ${name}`;
}

/** Badge that marks a sleeping module — full word, or the glyph when tight. */
export function AsleepBadge({
  compact = false,
  className = "",
  title = "Module offline — same as Signal Path Off",
}: {
  compact?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded border border-white/15 bg-black/55 font-black uppercase tracking-[0.06em] text-white/45 ${
        compact ? "fc-text-floor px-1 py-px" : "fc-text-floor px-1.5 py-0.5"
      } ${className}`}
      title={title}
    >
      {compact ? ASLEEP_GLYPH : ASLEEP_STATE}
    </span>
  );
}

type Props = {
  moduleId: string;
  color: string;
  /** Friendly module name for tooltips / screen readers (defaults to the id). */
  name?: string;
  /** Label while awake — override only when the canonical verb will not fit. */
  onLabel?: string;
  /** Label while asleep. */
  offLabel?: string;
  titleOn?: string;
  titleOff?: string;
  /** Optional band shade for on-state text. */
  onTextColor?: string;
};

export function ModuleEnableToggle({
  moduleId,
  color,
  name,
  onLabel = SLEEP_ACTION,
  offLabel = WAKE_ACTION,
  titleOn,
  titleOff,
  onTextColor,
}: Props) {
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.[moduleId] !== false);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const label = name ?? moduleId;
  // Sleep/Wake is the one control every module owns, so it is the clearest
  // place to read a band's chip character.
  const character = fcChipCharacterFor(moduleId);
  const focus = useFcChipFocusRing();
  return (
    <button
      type="button"
      onClick={() => setModuleEnable(moduleId, !enabled)}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      className={fcChipClass({ character })}
      style={{
        ...(enabled
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
            }),
        ...fcChipCharacterStyle(character, enabled, color, {
          baseShadow: enabled ? `0 0 8px ${color}28` : undefined,
          unclip: focus.ring,
        }),
      }}
      title={enabled ? (titleOn ?? moduleEnableTitle(true, label)) : (titleOff ?? moduleEnableTitle(false, label))}
      aria-pressed={enabled}
      aria-label={moduleEnableAria(enabled, label)}
    >
      <FcChipMark character={character} on={enabled} color={color} />
      {enabled ? onLabel : offLabel}
    </button>
  );
}
