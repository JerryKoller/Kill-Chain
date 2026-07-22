import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface KCChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected/latched state. */
  active?: boolean;
  /** Render as a static badge (span) instead of a button. */
  asBadge?: boolean;
  children: ReactNode;
}

/** KCDS chip — selectable pill (or static badge with `asBadge`). */
export function KCChip({ active, asBadge, className = "", children, ...rest }: KCChipProps) {
  const cls = `kc-chip ${active ? "kc-on" : ""} ${className}`;
  if (asBadge) return <span className={cls}>{children}</span>;
  return (
    <button className={cls} aria-pressed={active} {...rest}>
      {children}
    </button>
  );
}
