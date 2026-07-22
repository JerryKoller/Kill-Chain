import type { ReactNode } from "react";

export interface KCEmptyStateProps {
  /** A KCDS icon (or any glyph) rendered dim above the title. */
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  /** Primary call to action (usually a KCButton). */
  action?: ReactNode;
  className?: string;
}

/** KCDS empty state — dashed holding pattern with one clear next step. */
export function KCEmptyState({ icon, title, hint, action, className = "" }: KCEmptyStateProps) {
  return (
    <div className={`kc-empty ${className}`}>
      {icon}
      <div className="text-sm font-semibold text-white/80">{title}</div>
      {hint && <div className="text-xs text-dim max-w-sm leading-relaxed">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
