/**
 * Shared editor chrome for Arrangement / Piano Roll / Drums.
 * Presentation only — no sequencing or audio logic.
 */

import type { ReactNode } from "react";
import { SEQ, SEQ_PILL, SeqSegment, SeqSegmented } from "./seqChrome";

export const EDITOR = {
  ctrlH: 32,
  gapTight: 6,
  gapGroup: 12,
  gapSection: 18,
  fire: SEQ.fire,
  cyan: "#22d3ee",
  lime: "#9be564",
} as const;

/** Neutral editor region scrollbar (overrides global cyan→violet). */
export const EDITOR_SCROLL =
  "editor-scroll overflow-auto";

export function ExitFullscreenButton({
  onClick,
  label = "Exit fullscreen",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold border border-white/18 text-white/80 bg-white/[0.04] hover:bg-white/[0.09] hover:text-white transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
      title={`${label} (Esc)`}
      aria-label={label}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="opacity-80">
        <path
          d="M1.5 4.5V1.5h3M10.5 4.5V1.5h-3M1.5 7.5v3h3M10.5 7.5v3h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M4.2 4.2 1.8 1.8M7.8 4.2l2.4-2.4M4.2 7.8 1.8 10.2M7.8 7.8l2.4 2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      Exit Fullscreen
    </button>
  );
}

export function EditorToolbarGroup({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`editor-toolbar__group inline-flex flex-wrap items-center gap-1.5 min-w-0 ${className}`}>
      {label ? (
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/48 shrink-0 px-0.5">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

export function EditorToolbarDivider() {
  return <span aria-hidden className="hidden sm:inline-block w-px h-5 bg-white/12 shrink-0 self-center mx-0.5" />;
}

/**
 * Unified fullscreen overlay shell — same Exit + title treatment
 * for Arrangement / Piano Roll / Drums.
 */
export function FullscreenEditorShell({
  title,
  context,
  onExit,
  right,
  children,
}: {
  title: string;
  context?: ReactNode;
  onExit: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed left-0 right-0 bottom-0 top-9 z-[90] flex flex-col bg-[#06070b] p-2.5 gap-2 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <header className="editor-fs-header shrink-0 flex flex-wrap items-center gap-2 px-1 min-h-9">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ExitFullscreenButton onClick={onExit} />
          <div className="min-w-0 leading-tight">
            <div className="text-[12px] font-black uppercase tracking-[0.1em] text-white/80 truncate">
              {title}
            </div>
            {context ? (
              <div className="text-[10px] text-white/50 truncate mt-0.5">{context}</div>
            ) : null}
          </div>
        </div>
        {right ? (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 ml-auto">
            {right}
          </div>
        ) : null}
      </header>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0c12]">
        {children}
      </div>
    </div>
  );
}

/** Piano Roll / Drums mode switch — shared embedded + fullscreen. */
export function EditorModeSwitch({
  tab,
  onChange,
  noteCount,
}: {
  tab: "roll" | "drums";
  onChange: (t: "roll" | "drums") => void;
  noteCount?: number;
}) {
  return (
    <SeqSegmented aria-label="Editor type">
      <SeqSegment
        active={tab === "roll"}
        accent={EDITOR.fire}
        onClick={() => onChange("roll")}
        title="Piano roll editor"
      >
        Piano Roll{typeof noteCount === "number" ? (
          <span className="opacity-70 font-mono normal-case tracking-normal ml-1">{noteCount}</span>
        ) : null}
      </SeqSegment>
      <SeqSegment
        active={tab === "drums"}
        accent={EDITOR.lime}
        onClick={() => onChange("drums")}
        title="Drum bay editor"
      >
        Drums
      </SeqSegment>
    </SeqSegmented>
  );
}

export { SEQ_PILL };
