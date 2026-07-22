import type { ReactNode } from "react";

export interface KCSegOption<T extends string> {
  id: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface KCSegmentedProps<T extends string> {
  options: ReadonlyArray<KCSegOption<T>>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
  "aria-label"?: string;
}

/** KCDS segmented control — one selected option, accent-lit. */
export function KCSegmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
  ...rest
}: KCSegmentedProps<T>) {
  return (
    <div role="radiogroup" className={`kc-seg ${className}`} {...rest}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={`kc-seg-btn ${value === o.id ? "kc-on" : ""} ${o.disabled ? "opacity-35 pointer-events-none" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
