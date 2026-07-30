/**
 * Compact BPM field that commits on blur / Enter so typing "140"
 * does not clamp mid-keystroke (e.g. "1" → 40).
 */

import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";

export function BpmInput({
  value,
  onCommit,
  min = 40,
  max = 240,
  className = "",
  style,
}: {
  value: number;
  onCommit: (bpm: number) => void;
  min?: number;
  max?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(n)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      return;
    }
    if (e.key === "Escape") {
      setDraft(String(value));
      e.currentTarget.blur();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = Number(draft);
      const cur = Number.isFinite(base) ? base : value;
      const next = Math.max(min, Math.min(max, Math.round(cur + (e.key === "ArrowUp" ? 1 : -1))));
      setDraft(String(next));
      onCommit(next);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={onKeyDown}
      className={className}
      style={style}
      aria-label="Tempo BPM"
      title={`Tempo (${min}–${max} BPM) — type a value, then Enter`}
    />
  );
}
