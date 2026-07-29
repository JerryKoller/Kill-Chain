/**
 * Sequencer workspace chrome — shared geometry, labels, and presentational
 * helpers. Visual/layout only; no audio or sequencing logic.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export const SEQ = {
  h: 32,
  fire: "#ff6a3d",
  fireSoft: "#ffbfa0",
  brass: "#e8b86d",
  brassSoft: "#f5d9a8",
  ice: "#62b6ff",
  lime: "#bef264",
} as const;

/** Neutral control shell — h-8, shared radius/border/focus. */
export const SEQ_CTRL =
  "inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border border-white/14 text-white/70 bg-white/[0.03] hover:bg-white/[0.07] hover:text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] transition-[background,color,border-color,box-shadow] duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0";

export const SEQ_PILL =
  "inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border border-white/14 text-white/65 bg-transparent hover:bg-white/[0.06] hover:text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] transition duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0";

export const SEQ_PILL_DESTRUCTIVE =
  "inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border border-rose-400/35 text-rose-200/75 bg-rose-500/[0.06] hover:bg-rose-500/15 hover:text-rose-100 hover:border-rose-400/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400/60 transition duration-150 cursor-pointer shrink-0";

export const SEQ_PILL_DESTRUCTIVE_ARM =
  "inline-flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-lg text-[11px] font-bold border border-rose-400/80 text-rose-50 bg-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-300 transition duration-150 cursor-pointer shrink-0";

/** @deprecated Prefer SEQ_PILL — kept for ScopedPlayButton re-exports */
export const SEQ_PILL_BTN = SEQ_PILL;

export const SEQ_TITLE =
  "text-[11px] font-black uppercase tracking-[0.12em] text-white/78 leading-none";

export const SEQ_META =
  "text-[10px] text-white/52 leading-snug truncate";

export const SEQ_GROUP_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.1em] text-[rgba(232,184,109,0.82)] leading-none";

export const SEQ_HINT =
  "text-[10px] text-white/48 leading-none";

export function SeqDivider({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`hidden sm:inline-block w-px h-5 bg-white/12 shrink-0 self-center ${className}`}
    />
  );
}

export function SeqGroup({
  label,
  hint,
  children,
  className = "",
  labelClassName = "",
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      {(label || hint) && (
        <div className={`shrink-0 ${labelClassName}`}>
          {label ? <div className={SEQ_GROUP_LABEL}>{label}</div> : null}
          {hint ? <div className={`${SEQ_HINT} mt-0.5`}>{hint}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

export function SeqSegmented({
  children,
  "aria-label": ariaLabel,
  className = "",
}: {
  children: ReactNode;
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex items-center h-8 rounded-lg p-0.5 gap-0.5 bg-black/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] shrink-0 ${className}`}
    >
      {children}
    </div>
  );
}

type SegmentProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  /** When set, active state uses accent wash + border instead of brass fill. */
  accent?: string;
  brass?: boolean;
};

export function SeqSegment({
  active,
  accent,
  brass = false,
  className = "",
  style,
  children,
  ...rest
}: SegmentProps) {
  const activeStyle: CSSProperties | undefined = active
    ? brass || !accent
      ? {
          color: "#1a1208",
          background: `linear-gradient(145deg, ${SEQ.brassSoft}, ${SEQ.brass})`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
          fontWeight: 700,
        }
      : {
          color: accent,
          background: `${accent}24`,
          boxShadow: `inset 0 0 0 1px ${accent}70`,
          fontWeight: 700,
        }
    : {
        color: "rgba(245,217,168,0.62)",
        background: "transparent",
      };

  return (
    <button
      type="button"
      aria-pressed={!!active}
      className={`relative h-7 px-2.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.06em] transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer ${
        active ? "" : "hover:bg-white/[0.06] hover:text-white/85"
      } ${className}`}
      style={{ ...activeStyle, ...style }}
      {...rest}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-current opacity-90"
        />
      )}
      <span className={active ? "pl-2" : undefined}>{children}</span>
    </button>
  );
}

/**
 * Standardized collapsible workspace row:
 * [expand] [play?] [title + meta] …… [tools]
 */
export function SeqSectionRow({
  collapsed,
  onToggle,
  title,
  meta,
  collapseControl,
  play,
  tools,
  className = "",
}: {
  collapsed: boolean;
  onToggle: () => void;
  title: string;
  meta?: ReactNode;
  collapseControl: ReactNode;
  play?: ReactNode;
  tools?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 min-h-11 py-1.5 ${className}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] hover:brightness-110 transition"
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
      >
        {collapseControl}
      </button>
      {play}
      <button
        type="button"
        onClick={onToggle}
        className="min-w-0 flex-1 basis-[8rem] flex items-center text-left hover:opacity-90 transition rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
      >
        <div className="min-w-0 leading-tight">
          <div className={SEQ_TITLE}>{title}</div>
          {meta != null && meta !== false ? (
            <div className={`${SEQ_META} mt-0.5`}>{meta}</div>
          ) : null}
        </div>
      </button>
      {tools ? (
        <div className="flex flex-wrap items-center gap-1.5 ml-auto shrink-0">{tools}</div>
      ) : null}
    </div>
  );
}
