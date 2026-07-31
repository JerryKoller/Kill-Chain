/**
 * Shared Fire Command chip / segment recipe.
 *
 * Warp Mode, Filter Model, Blade, Carve, Character and the Chip strips each
 * hand-rolled the same rounded 9px pill with the same on-state glow. One
 * recipe keeps geometry, focus ring, `aria-pressed` and the glow identical
 * across every chip-class control.
 *
 * On top of that, a chip carries its band's *character* — the small-control
 * counterpart to `dialCharacter`. Chips are too small for the knob caps'
 * detail, so each band differs by silhouette and edge instead of ornament:
 *
 *   SRC  blade    notched corner, hard 90° edges       (raw voice)
 *   TONE rings    pill with a grooved hairline ring    (precision)
 *   MOD  orbit    pill with a leading satellite dot    (motion)
 *   FX   lens     fully round, soft glow + inner bloom (atmosphere)
 *   MIX  console  square-ish with an LED underline     (metering)
 *   PERF gem      chamfered corners, bright facet      (performance)
 *
 * Every treatment stays inside the chip's existing footprint — padding, type
 * scale and line box are untouched, so a strip never reflows. Character is
 * optional and defaults to the original pill, so unspecified call sites keep
 * exactly the look they had.
 */

import { useState, type CSSProperties, type FocusEvent, type ReactNode } from "react";
import { FIRE_MODULE_BY_ID, type FireBandId } from "./fireModuleAtlas";

/** Chip type scale — chips are `font-black`; body copy stays `font-semibold`. */
const FC_CHIP_BASE = "fc-focus rounded-md border py-0.5 text-[9px] font-black tracking-[0.06em] transition";

/** Eyebrow that titles a segment strip (Mode / Blade / Model / Character). */
export const FC_CHIP_EYEBROW = "mr-1 text-[8px] font-black uppercase tracking-[0.28em]";

/** Horizontal padding steps — the only size lever a chip is allowed to pull. */
export type FcChipPad = "sm" | "md" | "lg";

const FC_CHIP_PAD: Record<FcChipPad, string> = {
  sm: "px-1.5",
  md: "px-2",
  lg: "px-2.5",
};

export type FcChipCharacter = "blade" | "rings" | "orbit" | "lens" | "console" | "gem" | "plain";

const BAND_CHARACTER: Record<FireBandId, FcChipCharacter> = {
  "band.sources": "blade",
  "band.tone": "rings",
  "band.mod": "orbit",
  "band.fx": "lens",
  "band.mix": "console",
  "band.perf": "gem",
};

const CHARACTER_BY_BAND = new Map<string, FcChipCharacter>(Object.entries(BAND_CHARACTER));

const characterCache = new Map<string, FcChipCharacter>();

/**
 * Resolve a chip's character from a module id (`"fx.delay"`) or a band key
 * (`"band.fx"`). Anything the atlas doesn't know stays `plain`.
 */
export function fcChipCharacterFor(moduleIdOrBandKey?: string): FcChipCharacter {
  if (!moduleIdOrBandKey) return "plain";
  const cached = characterCache.get(moduleIdOrBandKey);
  if (cached) return cached;
  let out = CHARACTER_BY_BAND.get(moduleIdOrBandKey);
  if (!out) {
    const mod = FIRE_MODULE_BY_ID.get(moduleIdOrBandKey);
    out = mod ? CHARACTER_BY_BAND.get(mod.bandKey) : undefined;
  }
  const resolved = out ?? "plain";
  characterCache.set(moduleIdOrBandKey, resolved);
  return resolved;
}

/** Cut corners are 5px — a third of the chip's height, readable but not brutal. */
const BLADE_CLIP = "polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 0 100%)";
const GEM_CLIP =
  "polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)";

function shadow(...layers: (string | undefined)[]): string | undefined {
  const used = layers.filter(Boolean);
  return used.length ? used.join(", ") : undefined;
}

/**
 * The band-specific edge of a chip, merged over whatever colour recipe the
 * caller already computed. `baseShadow` is the caller's outer glow so a
 * character can extend it; `unclip` drops the cut while a keyboard focus ring
 * is showing, because `clip-path` would otherwise eat the outline.
 */
export function fcChipCharacterStyle(
  character: FcChipCharacter | undefined,
  on: boolean,
  color: string,
  opts?: { baseShadow?: string; unclip?: boolean },
): CSSProperties {
  const glow = opts?.baseShadow;
  switch (character) {
    case "blade":
      // Clipped corner + square edges; the glow moves inside since the cut
      // would clip an outer one away.
      return {
        borderRadius: 0,
        clipPath: opts?.unclip ? undefined : BLADE_CLIP,
        boxShadow: on
          ? `inset 0 0 9px ${color}55, inset 0 -1.5px 0 ${color}99`
          : "inset 0 -1px 0 rgba(255,255,255,0.06)",
      };
    case "rings":
      // Dark 1px gap then a hairline ring — a grooved instrument bezel.
      return {
        borderRadius: 9999,
        boxShadow: shadow(
          "inset 0 0 0 1px rgba(0,0,0,0.5)",
          on ? `inset 0 0 0 2px ${color}55` : "inset 0 0 0 2px rgba(255,255,255,0.08)",
          glow,
        ),
      };
    case "orbit":
      // Pill; the satellite dot rides in the left padding (see FcChipMark).
      return { borderRadius: 9999, boxShadow: glow };
    case "lens":
      return {
        borderRadius: 9999,
        boxShadow: on
          ? shadow(glow, `0 0 18px ${color}2e`, `inset 0 3px 7px -3px ${color}cc`)
          : "inset 0 3px 7px -4px rgba(255,255,255,0.22)",
      };
    case "console":
      return {
        borderRadius: 2,
        boxShadow: on ? shadow(glow, `inset 0 -3px 6px -4px ${color}`) : glow,
      };
    case "gem":
      return {
        borderRadius: 0,
        clipPath: opts?.unclip ? undefined : GEM_CLIP,
        boxShadow: on ? `inset 0 0 10px ${color}4d` : undefined,
      };
    default:
      return {};
  }
}

/**
 * Orbit's satellite, console's LED underline and gem's facet edges. Each sits
 * absolutely inside the chip's existing padding so nothing reflows.
 */
export function FcChipMark({
  character,
  on,
  color,
}: {
  character?: FcChipCharacter;
  on: boolean;
  color: string;
}) {
  if (character === "orbit") {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute left-[2px] top-1/2 h-[3px] w-[3px] -translate-y-1/2 rounded-full"
        style={{
          background: on ? color : "rgba(255,255,255,0.26)",
          boxShadow: on ? `0 0 5px ${color}` : undefined,
        }}
      />
    );
  }
  if (character === "console") {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 bottom-[1px] h-[1.5px] rounded-full"
        style={{
          background: on ? color : "rgba(255,255,255,0.13)",
          boxShadow: on ? `0 0 6px ${color}` : undefined,
        }}
      />
    );
  }
  if (character === "gem") {
    // Bands are measured from the padding box, so they start ~2px in to land
    // flush against the 5px chamfer the clip cuts out of the border box.
    const edge = on ? color : "rgba(255,255,255,0.16)";
    return (
      <>
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 h-3 w-3"
          style={{ background: `linear-gradient(135deg, transparent 0 2px, ${edge} 2px 3.6px, transparent 3.6px)` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 h-3 w-3"
          style={{ background: `linear-gradient(315deg, transparent 0 2px, ${edge} 2px 3.6px, transparent 3.6px)` }}
        />
      </>
    );
  }
  return null;
}

/**
 * `clip-path` clips the focus outline too, so blade and gem un-cut themselves
 * while they hold a keyboard focus ring.
 */
export function useFcChipFocusRing() {
  const [ring, setRing] = useState(false);
  return {
    ring,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      let visible = true;
      try {
        visible = e.currentTarget.matches(":focus-visible");
      } catch {
        /* engine without :focus-visible — assume the ring is showing */
      }
      setRing(visible);
    },
    onBlur: () => setRing(false),
  };
}

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
  /** Band character — shape only; geometry is unchanged. */
  character?: FcChipCharacter;
  /** Horizontal padding step. Defaults to the original `px-2`. */
  padX?: FcChipPad;
}): string {
  const parts = [
    FC_CHIP_BASE,
    FC_CHIP_PAD[opts?.padX ?? "md"],
    opts?.caseMode === "normal" ? "normal-case" : "uppercase",
  ];
  if (opts?.mono) parts.push("tabular-nums");
  if (opts?.character && opts.character !== "plain") parts.push("relative");
  if (opts?.extra) parts.push(opts.extra);
  return parts.join(" ");
}

export function fcChipStyle(
  on: boolean,
  tone: FcChipTone,
  character?: FcChipCharacter,
  opts?: { unclip?: boolean },
): CSSProperties {
  const { color, onText, glow = 12 } = tone;
  const base: CSSProperties = on
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
  return {
    ...base,
    ...fcChipCharacterStyle(character, on, color, {
      baseShadow: on ? `0 0 ${glow}px ${color}44` : undefined,
      unclip: opts?.unclip,
    }),
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
  character,
  padX,
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
  character?: FcChipCharacter;
  padX?: FcChipPad;
  children: ReactNode;
}) {
  const focus = useFcChipFocusRing();
  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      className={fcChipClass({ caseMode, mono, extra, character, padX })}
      style={fcChipStyle(on, tone, character, { unclip: focus.ring })}
      title={title}
      aria-pressed={on}
      aria-label={ariaLabel}
    >
      <FcChipMark character={character} on={on} color={tone.color} />
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
  character,
  padX,
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
  character?: FcChipCharacter;
  padX?: FcChipPad;
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
          character={character}
          padX={padX}
        >
          {o.label}
        </FcChip>
      ))}
    </div>
  );
}
