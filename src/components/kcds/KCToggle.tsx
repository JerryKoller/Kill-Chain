import type { ReactNode } from "react";

export interface KCToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Optional inline row: label (+ hint) to the left, switch to the right. */
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** KCDS switch — snap-animated thumb, accent when engaged. */
export function KCToggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
  className = "",
}: KCToggleProps) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`kc-toggle ${checked ? "kc-on" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""} ${label ? "" : className}`}
    />
  );
  if (!label) return sw;
  return (
    <label
      className={`flex items-center justify-between gap-4 cursor-pointer select-none ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-sm text-white/85">{label}</span>
        {hint && <span className="block text-[11px] text-dim mt-0.5">{hint}</span>}
      </span>
      {sw}
    </label>
  );
}
