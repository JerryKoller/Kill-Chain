/**
 * Compact BPM field that commits on blur / Enter so typing "140"
 * does not clamp mid-keystroke (e.g. "1" → 40). Arrow keys update the
 * draft only and commit on key-up so holding the key cannot restart the
 * sequencer scheduler on every repeat tick.
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

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
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
      draftRef.current = String(value);
    }
  }, [value, focused]);

  const commit = () => {
    // An EMPTY field is a cancel, not a commit — Number("") is 0, so clearing
    // the field and clicking away used to slam the tempo to min BPM.
    const text = draftRef.current;
    if (!text.trim()) {
      setDraft(String(value));
      draftRef.current = String(value);
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      draftRef.current = String(value);
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(n)));
    setDraft(String(next));
    draftRef.current = String(next);
    if (next !== value) onCommit(next);
  };

  const nudgeDraft = (dir: 1 | -1) => {
    const base = Number(draftRef.current);
    const cur = Number.isFinite(base) ? base : value;
    const next = Math.max(min, Math.min(max, Math.round(cur + dir)));
    const s = String(next);
    draftRef.current = s;
    setDraft(s);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(String(value));
      draftRef.current = String(value);
      e.currentTarget.blur();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      nudgeDraft(e.key === "ArrowUp" ? 1 : -1);
    }
  };

  const onKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") commit();
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
        draftRef.current = next;
        setDraft(next);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      className={className}
      style={style}
      aria-label="Tempo BPM"
      title={`Tempo (${min}–${max} BPM) — type a value, then Enter. Arrow keys commit when released.`}
    />
  );
}
