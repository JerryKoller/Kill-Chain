/**
 * Shared Fire Command segmented control — one chrome for workspace + band tabs.
 */

import type { CSSProperties, ReactNode } from "react";

export type FireSegItem<T extends string> = {
  id: T;
  label: string;
  color: string;
  title?: string;
  /**
   * Optional count shown as a corner badge. Band tabs use it to show how many
   * modules in that band are awake, so an inactive band is visible without
   * opening it.
   */
  badge?: number;
  /** Dim the tab — nothing in it is doing anything. */
  dim?: boolean;
};

export function FireSegTabs<T extends string>({
  items,
  value,
  onChange,
  hint,
  hintDetail,
  size = "md",
  flush = false,
}: {
  items: FireSegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  hint?: string;
  hintDetail?: string;
  size?: "sm" | "md";
  /** Sit inside a parent console — no outer card chrome. */
  flush?: boolean;
}) {
  const pad =
    size === "md"
      ? "px-2 py-2 fc-text-primary tracking-[0.14em]"
      : "px-1.5 py-1.5 fc-text-secondary tracking-[0.12em]";
  return (
    <div
      className={
        flush
          ? "relative px-3 py-2 bg-gradient-to-b from-white/[0.025] to-transparent"
          : "rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      }
    >
      {flush && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)" }}
        />
      )}
      <div className="flex w-full rounded-xl border border-white/12 bg-black/35 p-1 gap-0.5">
        {items.map((item) => {
          const active = value === item.id;
          const style: CSSProperties = active
            ? {
                background: `${item.color}28`,
                color: item.color,
                boxShadow: `0 0 14px ${item.color}33`,
              }
            : { color: item.dim ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.42)" };
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`${pad} relative min-w-0 flex-1 font-black uppercase rounded-lg transition text-center`}
              style={style}
              title={item.title ?? item.label}
            >
              <span className="block truncate">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span
                  className="fc-seg-badge"
                  style={{
                    background: active ? item.color : "rgba(255,255,255,0.28)",
                    color: active ? "#07090d" : "rgba(0,0,0,0.72)",
                  }}
                  aria-hidden
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {(hint || hintDetail) && (
        <div className="fc-chrome-band-hint mt-1.5 min-w-0 px-0.5">
          {hint && <div className="fc-text-secondary font-semibold truncate">{hint}</div>}
          {hintDetail && <div className="fc-chrome-band-hint-detail fc-text-telemetry truncate">{hintDetail}</div>}
        </div>
      )}
    </div>
  );
}

/** Thin band label used when a band tab is already selected (no second fold chrome). */
export function FireBandLabel({
  title,
  color,
  hint,
  right,
}: {
  title: string;
  color: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ background: color, boxShadow: `0 0 10px ${color}` }}
          aria-hidden
        />
        <span className="text-[12px] font-black uppercase tracking-[0.2em]" style={{ color }}>
          {title}
        </span>
        {hint && (
          <span className="hidden sm:inline text-[9px] text-white/30 truncate">· {hint}</span>
        )}
      </div>
      {right}
    </div>
  );
}
