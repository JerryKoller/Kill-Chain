import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

interface Props extends HTMLMotionProps<"button"> {
  variant?: "neon" | "ghost" | "danger";
  active?: boolean;
  children: ReactNode;
}

export function NeonButton({
  variant = "neon",
  active,
  className = "",
  children,
  disabled,
  ...rest
}: Props) {
  const base =
    variant === "neon"
      ? "btn-neon"
      : variant === "danger"
        ? "btn-ghost text-red-300 hover:text-red-200"
        : "btn-ghost";
  const ring = active ? "ring-neon" : "";
  const disabledCls = disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "";
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className={`${base} ${ring} ${disabledCls} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
