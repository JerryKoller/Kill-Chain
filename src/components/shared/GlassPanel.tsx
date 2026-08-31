import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

export interface GlassPanelProps extends ComponentPropsWithoutRef<"div"> {
  glow?: boolean;
  intense?: boolean;
  /** v2.2 — interactive card: adds the shared hover lift. */
  lift?: boolean;
  children?: ReactNode;
}

/**
 * GlassPanel v2 (KCDS) — same API as v1, plus `lift` for interactive cards.
 * Intense (primary) panels keep the corner tick marks, which now follow the
 * module accent (see .panel-ticks in globals.css), and gain a hairline
 * accent edge along the top so key panels read as "powered".
 *
 * Renders a PLAIN div: no call site ever passed framer-motion props, yet
 * every panel in the app was paying motion.div's per-instance overhead.
 * Hover lift is pure CSS (.kc-lift).
 */
export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  function GlassPanel({ glow, intense, lift, className = "", children, ...rest }, ref) {
    const tone = intense ? "glass-strong panel-ticks" : "glass";
    const glowCls = glow ? "ring-neon" : "";
    const liftCls = lift ? "kc-lift" : "";
    return (
      <div
        ref={ref}
        className={`relative overflow-hidden rounded-2xl ${tone} ${glowCls} ${liftCls} ${className}`}
        {...rest}
      >
        {intense && (
          <div
            aria-hidden
            className="absolute top-0 left-4 right-4 h-px pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(var(--kc-accent, var(--c-cyan)) / 0.35) 30%, rgb(var(--kc-accent, var(--c-cyan)) / 0.35) 70%, transparent)",
            }}
          />
        )}
        {children}
      </div>
    );
  },
);
