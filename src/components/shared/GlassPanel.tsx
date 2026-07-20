import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

export interface GlassPanelProps extends HTMLMotionProps<"div"> {
  glow?: boolean;
  intense?: boolean;
  children?: ReactNode;
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  function GlassPanel({ glow, intense, className = "", children, ...rest }, ref) {
    // Intense (primary) panels get corner tick marks — a quiet
    // fire-control-display framing cue on the panels that matter.
    const tone = intense ? "glass-strong panel-ticks" : "glass";
    const glowCls = glow ? "ring-neon" : "";
    return (
      <motion.div
        ref={ref}
        className={`relative overflow-hidden rounded-2xl ${tone} ${glowCls} ${className}`}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
