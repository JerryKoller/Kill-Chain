import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "@/state/settingsStore";

interface TooltipProps {
  /** Body shown on hover. */
  content: ReactNode;
  /** The element that should trigger the tooltip. */
  children: ReactNode;
  /** Optional small uppercase label above the body. */
  label?: string;
  /** Where the tooltip prefers to sit relative to the target. */
  side?: "top" | "bottom" | "left" | "right";
  /** Delay before showing, in ms. */
  delay?: number;
  /** Force-disable (e.g. inside a drag handle). */
  disabled?: boolean;
}

/**
 * Lightweight tooltip — no portal libraries. Renders into a portal so it
 * always sits above its parent's `overflow:hidden` panel. Respects the
 * user's `tooltipsEnabled` preference.
 */
export function Tooltip({
  content,
  children,
  label,
  side = "top",
  delay = 250,
  disabled,
}: TooltipProps) {
  const enabled = useSettingsStore((s) => s.tooltipsEnabled);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);

  const place = () => {
    const el = wrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const margin = 10;
    let x = cx;
    let y = cy;
    if (side === "top") y = r.top - margin;
    else if (side === "bottom") y = r.bottom + margin;
    else if (side === "left") {
      x = r.left - margin;
      y = cy;
    } else {
      x = r.right + margin;
      y = cy;
    }
    setCoords({ x, y });
  };

  const onEnter = () => {
    if (!enabled || disabled) return;
    timer.current = window.setTimeout(() => {
      place();
      setOpen(true);
    }, delay);
  };

  const onLeave = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setOpen(false);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const translate =
    side === "top"
      ? "-translate-x-1/2 -translate-y-full"
      : side === "bottom"
        ? "-translate-x-1/2"
        : side === "left"
          ? "-translate-x-full -translate-y-1/2"
          : "-translate-y-1/2";

  return (
    <>
      <span
        ref={wrapperRef}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        className="contents"
      >
        {children}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                initial={{ opacity: 0, y: side === "top" ? 4 : -4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className={`fixed z-[100] pointer-events-none ${translate}`}
                style={{ left: coords.x, top: coords.y }}
              >
                <div className="max-w-[280px] rounded-xl border border-white/15 bg-black/85 backdrop-blur-md shadow-2xl px-3 py-2">
                  {label && (
                    <div className="text-[9px] uppercase tracking-[0.3em] text-cyan/80 mb-1">
                      {label}
                    </div>
                  )}
                  <div className="text-[12px] text-white/85 leading-snug">{content}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
