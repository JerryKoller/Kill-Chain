/**
 * Shared Fire Command segmented control — one chrome for workspace + band tabs.
 */

import type { CSSProperties, ReactNode } from "react";

export type FireSegItem<T extends string> = {
  id: T;
  label: string;
  color: string;
  title?: string;
};

export function FireSegTabs<T extends string>({
  items,
  value,
  onChange,
  hint,
  hintDetail,
  size = "md",
}: {
  items: FireSegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  hint?: string;
  hintDetail?: string;
  size?: "sm" | "md";
}) {
  const pad = size === "md" ? "px-3.5 py-2 text-[12px] tracking-[0.14em]" : "px-3 py-1.5 text-[11px] tracking-[0.12em]";
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex flex-wrap rounded-xl border border-white/12 bg-black/35 p-1 gap-0.5">
          {items.map((item) => {
            const active = value === item.id;
            const style: CSSProperties = active
              ? {
                  background: `${item.color}28`,
                  color: item.color,
                  boxShadow: `0 0 14px ${item.color}33`,
                }
              : { color: "rgba(255,255,255,0.42)" };
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                className={`${pad} font-black uppercase rounded-lg transition`}
                style={style}
                title={item.title ?? item.label}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {/* hint */}
        {(hint || hintDetail) && (
          <div className="min-w-0 flex-1">
            {hint && <div className="text-[10px] font-semibold text-white/65 truncate">{hint}</div>}
            {hintDetail && <div className="text-[9px] text-white/35 truncate">{hintDetail}</div>}
          </div>
        )}
      </div>
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
