/**
 * Compact pattern chip for the Arrangement Patterns strip.
 * Presentational only — callers wire existing select / rename / duplicate /
 * delete / place / drag handlers. Does not change sequencing behavior.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type PatternMenuAction = {
  id: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

function GripIcon() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden className="block opacity-55">
      <circle cx="2" cy="2" r="1" fill="currentColor" />
      <circle cx="6" cy="2" r="1" fill="currentColor" />
      <circle cx="2" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="2" cy="10" r="1" fill="currentColor" />
      <circle cx="6" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="block">
      <circle cx="6" cy="2.5" r="1.15" fill="currentColor" />
      <circle cx="6" cy="6" r="1.15" fill="currentColor" />
      <circle cx="6" cy="9.5" r="1.15" fill="currentColor" />
    </svg>
  );
}

function PatternOverflowMenu({
  open,
  onClose,
  items,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  items: PatternMenuAction[];
  labelledBy: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-labelledby={labelledBy}
      className="pattern-item-menu absolute right-0 top-[calc(100%+4px)] z-40 min-w-[10.5rem] rounded-lg border border-white/18 bg-[#12121a] py-1 shadow-xl"
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          className={`block w-full px-2.5 py-1.5 text-left text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgba(232,184,109,0.65)] disabled:opacity-40 disabled:cursor-not-allowed ${
            it.danger
              ? "text-rose-300/90 hover:bg-rose-500/15"
              : "text-white/78 hover:bg-white/10"
          }`}
          onClick={() => {
            if (it.disabled) return;
            it.onClick();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function PatternItem({
  id,
  name,
  bars,
  color,
  selected,
  playing,
  draggable = true,
  menuActions,
  renaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onDragStart,
  onDoubleClick,
  tabIndex,
  onKeyDown,
}: {
  id: string;
  name: string;
  bars: number;
  color: string;
  selected: boolean;
  playing?: boolean;
  draggable?: boolean;
  menuActions: PatternMenuAction[];
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (v: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onSelect: () => void;
  onDragStart?: (e: DragEvent) => void;
  onDoubleClick?: () => void;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragMoved = useRef(false);
  const menuBtnId = useId();

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  if (renaming) {
    return (
      <input
        autoFocus
        value={renameValue ?? ""}
        onChange={(e) => onRenameChange?.(e.target.value)}
        onBlur={() => onRenameCommit?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRenameCommit?.();
          if (e.key === "Escape") onRenameCancel?.();
        }}
        className="pattern-item pattern-item--rename h-[30px] w-[7.5rem] max-w-[9rem] shrink-0 rounded-lg border border-[#ff6a3d]/60 bg-black/45 px-2 text-[11px] font-semibold text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
        aria-label={`Rename pattern ${name}`}
      />
    );
  }

  const barsLabel = `${bars} ${bars === 1 ? "bar" : "bars"}`;
  const tooltip = [
    `Pattern ${name}`,
    barsLabel,
    selected ? "Selected — editing below" :     "Click to edit",
    "Drag onto arrangement",
    "Double-click to duplicate and place",
  ].join(" · ");

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`Pattern ${name}, ${barsLabel}${playing ? ", playing" : ""}`}
      data-pattern-id={id}
      data-selected={selected ? "1" : "0"}
      data-playing={playing ? "1" : "0"}
      data-dragging={dragging ? "1" : "0"}
      tabIndex={tabIndex ?? -1}
      className={`pattern-item group relative inline-flex h-[30px] max-w-[11rem] min-w-[5.5rem] shrink-0 items-stretch rounded-lg border transition-[background,border-color,box-shadow,opacity,color] duration-150 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] ${
        dragging ? "opacity-55" : ""
      }`}
      style={
        selected
          ? {
              borderColor: `${color}c0`,
              background: `linear-gradient(90deg, ${color}33 0%, ${color}18 100%)`,
              color,
              boxShadow: playing
                ? `inset 3px 0 0 ${color}, 0 0 0 1px ${color}55, 0 0 10px ${color}40`
                : `inset 3px 0 0 ${color}, 0 0 0 1px ${color}40`,
            }
          : {
              borderColor: "rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.62)",
              boxShadow: playing ? `0 0 0 1px ${color}70, 0 0 10px ${color}35` : undefined,
            }
      }
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        onClick={() => {
          if (dragMoved.current) return;
          onSelect();
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDoubleClick?.();
        }}
        className="pattern-item__main inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-l-[7px] pl-1.5 pr-1 text-left cursor-pointer"
        title={tooltip}
        aria-label={`Select pattern ${name}`}
      >
        <span
          draggable={draggable}
          onDragStart={(e) => {
            e.stopPropagation();
            dragMoved.current = true;
            setDragging(true);
            e.dataTransfer.effectAllowed = "copy";
            onDragStart?.(e);
          }}
          onDragEnd={() => {
            setDragging(false);
            window.setTimeout(() => {
              dragMoved.current = false;
            }, 0);
          }}
          onClick={(e) => e.stopPropagation()}
          className="pattern-item__grip inline-flex h-5 w-3 shrink-0 items-center justify-center text-current opacity-40 group-hover:opacity-70 group-focus-within:opacity-70 transition-opacity duration-150 cursor-grab active:cursor-grabbing"
          aria-hidden
          title="Drag onto arrangement"
        >
          <GripIcon />
        </span>
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: color, opacity: selected ? 1 : 0.55 }}
          aria-hidden
        />
        <span className="min-w-0 flex flex-col justify-center leading-none gap-0.5">
          <span
            className={`truncate text-[11px] font-bold ${
              selected ? "text-current" : "text-white/72 group-hover:text-white/90"
            }`}
          >
            {name}
          </span>
          <span
            className={`font-mono text-[10px] tabular-nums tracking-normal ${
              selected ? "text-current opacity-70" : "text-white/42"
            }`}
          >
            {barsLabel}
          </span>
        </span>
        {selected ? (
          <span
            className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-[0.06em] opacity-70"
            aria-hidden
          >
            ✓
          </span>
        ) : null}
      </button>

      <div className="relative flex shrink-0 items-center" style={{ borderLeft: "1px solid rgba(255,255,255,0.12)" }}>
        <button
          type="button"
          id={menuBtnId}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Pattern ${name} actions`}
          title={`Pattern ${name} actions`}
          className={`pattern-item__more inline-flex h-full w-7 items-center justify-center rounded-r-[7px] text-current transition duration-150 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgba(232,184,109,0.65)] ${
            menuOpen || selected
              ? "opacity-80"
              : "opacity-0 group-hover:opacity-70 group-focus-within:opacity-70 focus:opacity-80"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreIcon />
        </button>
        <PatternOverflowMenu
          open={menuOpen}
          onClose={closeMenu}
          items={menuActions}
          labelledBy={menuBtnId}
        />
      </div>
    </div>
  );
}

export function PatternsStrip({
  children,
  empty,
  "aria-label": ariaLabel = "Patterns",
}: {
  children?: ReactNode;
  empty?: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className="patterns-strip editor-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden py-0.5"
    >
      {empty ?? children}
    </div>
  );
}

export function PatternsEmptyState({
  onNew,
  onNewAndPlace,
  canCreate,
  canPlace,
}: {
  onNew: () => void;
  onNewAndPlace: () => void;
  canCreate: boolean;
  canPlace: boolean;
}) {
  return (
    <div className="patterns-empty inline-flex min-h-[30px] items-center gap-2 rounded-lg border border-dashed border-white/14 bg-black/25 px-2.5 py-1 text-[11px] text-white/55">
      <div className="min-w-0 leading-tight">
        <div className="font-semibold text-white/70">No patterns yet</div>
        <div className="text-[10px] text-white/45">Create a pattern to begin sequencing</div>
      </div>
      <button
        type="button"
        disabled={!canPlace}
        onClick={onNewAndPlace}
        className="inline-flex h-7 shrink-0 items-center px-2 rounded-md text-[10px] font-semibold border border-[#ff6a3d]/45 bg-[#ff6a3d]/14 text-[#ffbfa0] hover:bg-[#ff6a3d]/22 disabled:opacity-30 transition"
        title="Create a pattern and place it on the arrangement"
      >
        New + Place
      </button>
      <button
        type="button"
        disabled={!canCreate}
        onClick={onNew}
        className="inline-flex h-7 shrink-0 items-center px-2 rounded-md text-[10px] font-semibold border border-white/14 text-white/65 bg-white/[0.03] hover:bg-white/[0.07] disabled:opacity-30 transition"
        title="Create a new pattern"
      >
        New
      </button>
    </div>
  );
}
