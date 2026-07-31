/**
 * Shared Fire Command chip / segment recipe.
 *
 * Warp Mode, Filter Model, Blade, Carve, Character and the Chip strips each
 * hand-rolled the same rounded 9px pill with the same on-state glow. One
 * recipe keeps geometry, focus ring, `aria-pressed` and the glow identical
 * across every chip-class control.
 */

import type { CSSProperties, ReactNode } from "react";

/** Chip type scale — chips are `font-black`; body copy stays `font-semibold`. */
const FC_CHIP_BASE = "fc-focus rounded-md border px-2 py-0.5 text-[9px] font-black tracking-[0.06em] transition";

/** Eyebrow that titles a segment strip (Mode / Blade / Model / Character). */
export const FC_CHIP_EYEBROW = "mr-1 text-[8px] font-black uppercase tracking-[0.28em]";

export type FcChipTone = {
  /** Band accent the chip belongs to. */
  color: string;
  /** On-state text — normally `bandShade(FC.<band>, 0.9…0.92)`. */
  onText?: string;
  /** On-state glow radius in px. */
  glow?: number;
};

export function fcChipClass(opts?: {
  /** Character names keep their casing; state/mode chips shout. */
  caseMode?: "upper" | "normal";
  /** Numeric chips align on tabular figures. */
  mono?: boolean;
  /** Extra utilities (usually a `min-w-[…]` so a strip reads as even columns). */
  extra?: string;
}): string {
  const parts = [FC_CHIP_BASE, opts?.caseMode === "normal" ? "normal-case" : "uppercase"];
  if (opts?.mono) parts.push("tabular-nums");
  if (opts?.extra) parts.push(opts.extra);
  return parts.join(" ");
}

export function fcChipStyle(on: boolean, tone: FcChipTone): CSSProperties {
  const { color, onText, glow = 12 } = tone;
  return on
    ? {
        borderColor: `${color}99`,
        background: `${color}33`,
        color: onText ?? `${color}ee`,
        boxShadow: `0 0 ${glow}px ${color}44`,
      }
    : {
        borderColor: "rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.45)",
        background: "rgba(0,0,0,0.3)",
      };
}

export function FcChip({
  on,
  tone,
  onClick,
  title,
  caseMode,
  mono,
  extra,
  ariaLabel,
  children,
}: {
  on: boolean;
  tone: FcChipTone;
  onClick: () => void;
  title?: string;
  caseMode?: "upper" | "normal";
  mono?: boolean;
  extra?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={fcChipClass({ caseMode, mono, extra })}
      style={fcChipStyle(on, tone)}
      title={title}
      aria-pressed={on}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export type FcSegOption<T extends string> = { id: T; label: string; tip?: string };

/** Eyebrow + one chip per option — the Mode / Blade / Model / Character strip. */
export function FcSegStrip<T extends string>({
  eyebrow,
  value,
  onChange,
  options,
  tone,
  caseMode,
  mono,
  chipExtra,
  wrap = true,
}: {
  eyebrow?: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly FcSegOption<T>[];
  tone: FcChipTone;
  caseMode?: "upper" | "normal";
  mono?: boolean;
  chipExtra?: string;
  wrap?: boolean;
}) {
  return (
    <div className={`mb-2 flex items-center justify-center gap-1 ${wrap ? "flex-wrap" : ""}`}>
      {eyebrow && (
        <span className={FC_CHIP_EYEBROW} style={{ color: `${tone.color}88` }}>
          {eyebrow}
        </span>
      )}
      {options.map((o) => (
        <FcChip
          key={o.id}
          on={value === o.id}
          tone={tone}
          onClick={() => onChange(o.id)}
          title={o.tip}
          caseMode={caseMode}
          mono={mono}
          extra={chipExtra}
        >
          {o.label}
        </FcChip>
      ))}
    </div>
  );
}
