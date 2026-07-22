import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

interface Props extends HTMLMotionProps<"button"> {
  variant?: "neon" | "ghost" | "danger";
  active?: boolean;
  children: ReactNode;
}

/**
 * v2.2 — NeonButton now renders through KCDS button classes, so every
 * existing call site picks up the shared interaction language (hover lift,
 * press scale, accent-lit active state) without an API change.
 */
export function NeonButton({
  variant = "neon",
  active,
  className = "",
  children,
  disabled,
  ...rest
}: Props) {
  const kind =
    variant === "neon" ? "kc-btn--primary" : variant === "danger" ? "kc-btn--danger" : "kc-btn--ghost";
  const disabledCls = disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "";
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className={`kc-btn ${kind} ${active ? "kc-on" : ""} ${disabledCls} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
