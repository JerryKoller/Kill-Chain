/**
 * Compact toolbar dropdown — trigger shows current value; panel holds controls.
 * Presentational only.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function ToolbarMenu({
  label,
  value,
  children,
  panelClassName = "w-56",
  align = "left",
}: {
  label: string;
  value: string;
  children: ReactNode;
  panelClassName?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        id={btnId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-black/30 px-2.5 text-[10px] font-semibold text-white/70 hover:text-white/90 hover:bg-white/[0.06] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
        title={`${label}: ${value}`}
      >
        <span className="uppercase tracking-[0.08em] text-white/45">{label}</span>
        <span className="font-mono text-white/85 tabular-nums max-w-[7rem] truncate">{value}</span>
        <span aria-hidden className="text-white/35 text-[9px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby={btnId}
          className={`absolute top-[calc(100%+4px)] z-50 rounded-xl border border-white/18 bg-[#0c0c12] p-2 shadow-[0_12px_32px_rgba(0,0,0,0.85)] ${panelClassName} ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
