import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface KCButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = accent-filled call to action · accent = outlined in the module
   *  accent · ghost = quiet · danger = destructive. */
  variant?: "primary" | "accent" | "ghost" | "danger";
  size?: "sm" | "md";
  /** Latched/engaged state (adds the shared kc-on treatment). */
  active?: boolean;
  children: ReactNode;
}

/**
 * KCDS button — the one button. All hover/press/active/disabled behavior
 * lives in kcds.css so every button in the app moves the same way.
 */
export function KCButton({
  variant = "ghost",
  size = "md",
  active,
  className = "",
  children,
  ...rest
}: KCButtonProps) {
  return (
    <button
      className={[
        "kc-btn",
        `kc-btn--${variant}`,
        size === "sm" ? "kc-btn--sm" : "",
        active ? "kc-on" : "",
        className,
      ].join(" ")}
      aria-pressed={active}
      {...rest}
    >
      {children}
    </button>
  );
}
