import { useCallback, type ChangeEvent } from "react";

export interface KCSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** Accessible name; also shown as a kc-label above when `showLabel`. */
  label?: string;
  showLabel?: boolean;
  /** Formatted readout on the right of the label row (e.g. "-3.5 dB"). */
  readout?: string;
  className?: string;
}

/**
 * KCDS range slider — native input for real a11y/scrubbing behavior, with
 * the accent fill painted through the --kc-fill custom property.
 */
export function KCSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  disabled,
  label,
  showLabel = true,
  readout,
  className = "",
}: KCSliderProps) {
  const handle = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)),
    [onChange],
  );
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={`w-full ${className}`}>
      {label && showLabel && (
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="kc-label">{label}</span>
          {readout !== undefined && <span className="kc-value">{readout}</span>}
        </div>
      )}
      <input
        type="range"
        className="kc-slider"
        style={{ ["--kc-fill" as string]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={handle}
      />
    </div>
  );
}
