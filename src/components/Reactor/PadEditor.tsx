import { useEffect, useMemo, useRef, useState } from "react";
import { SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import { useReactorStore, type PadMode, type ReactorPad } from "@/state/reactorStore";
import { useMidiStore } from "@/state/midiStore";
import { useUIStore } from "@/state/uiStore";

const META_BY_KEY = new Map(SOUND_PARAM_META.map((m) => [m.key, m]));

/**
 * Compact per-pad editor: rename, latch/momentary mode, and the pad's target
 * param deltas (picker + amount). Edits persist immediately and re-merge live
 * if the pad is currently engaged. Also hosts MIDI learn when available.
 */
export function PadEditor({
  pad,
  index,
  onClose,
}: {
  pad: ReactorPad;
  index: number;
  onClose: () => void;
}) {
  const updatePad = useReactorStore((s) => s.updatePad);
  const restorePad = useReactorStore((s) => s.restorePad);
  const midiAvailable = useMidiStore((s) => s.available);
  const midiInputs = useMidiStore((s) => s.inputs);
  const learning = useMidiStore((s) => s.learning);
  const mappings = useMidiStore((s) => s.mappings);
  const setLearning = useMidiStore((s) => s.setLearning);
  const removeMapping = useMidiStore((s) => s.removeMapping);
  const toast = useUIStore((s) => s.toast);

  const [nameDraft, setNameDraft] = useState(pad.name);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreTimer = useRef<number | null>(null);

  useEffect(() => {
    setNameDraft(pad.name);
  }, [pad.name]);

  useEffect(() => {
    return () => {
      if (restoreTimer.current != null) window.clearTimeout(restoreTimer.current);
      const midi = useMidiStore.getState();
      if (midi.learning?.kind === "reactorPad" && midi.learning.pad === index) {
        midi.setLearning(null);
      }
    };
  }, [index]);

  const rows = useMemo(
    () =>
      (Object.entries(pad.deltas) as [keyof SoundParams, number][]).map(
        ([key, value]) => ({ key, value, meta: META_BY_KEY.get(key) }),
      ),
    [pad.deltas],
  );
  const usedKeys = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const addable = SOUND_PARAM_META.filter((m) => !usedKeys.has(m.key));

  const learningThis =
    learning?.kind === "reactorPad" && learning.pad === index;
  const padMappings = mappings.filter(
    (m) => m.target.kind === "reactorPad" && m.target.pad === index,
  );

  const commitName = () => {
    const clean = nameDraft.trim().slice(0, 40);
    if (!clean || clean === pad.name) {
      setNameDraft(pad.name);
      return;
    }
    updatePad(pad.id, { name: clean });
  };

  const setDelta = (key: keyof SoundParams, value: number) => {
    updatePad(pad.id, { deltas: { ...pad.deltas, [key]: value } });
  };

  const removeDelta = (key: keyof SoundParams) => {
    const next = { ...pad.deltas };
    delete next[key];
    updatePad(pad.id, { deltas: next });
  };

  const addDelta = (key: string) => {
    if (!key) return;
    setDelta(key as keyof SoundParams, 0.2);
  };

  return (
    <div
      className="mt-3 rounded-2xl border p-4"
      style={{ borderColor: `${pad.accent}55`, background: `${pad.accent}0d` }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0" style={{ color: pad.accent }}>
            {pad.icon}
          </span>
          <span className="module-tag shrink-0">PAD {index + 1}</span>
          <input
            type="text"
            value={nameDraft}
            maxLength={40}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setNameDraft(pad.name);
              }
            }}
            className="min-w-[160px] flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-cyan/60"
            aria-label="Pad name"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Trigger mode */}
          <div className="flex rounded-lg border border-white/12 overflow-hidden">
            {(["latch", "momentary"] as PadMode[]).map((m) => (
              <button
                key={m}
                onClick={() => updatePad(pad.id, { mode: m })}
                className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold transition ${
                  pad.mode === m
                    ? "bg-cyan/20 text-cyan"
                    : "text-white/45 hover:text-white/75"
                }`}
                title={
                  m === "latch"
                    ? "Tap engages, tap again releases"
                    : "Engages only while held (pointer, number key, or MIDI note)"
                }
              >
                {m === "latch" ? "Latch" : "Momentary"}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (confirmRestore) {
                if (restoreTimer.current != null) {
                  window.clearTimeout(restoreTimer.current);
                  restoreTimer.current = null;
                }
                setConfirmRestore(false);
                restorePad(pad.id);
                setNameDraft(
                  useReactorStore.getState().pads.find((p) => p.id === pad.id)
                    ?.name ?? pad.name,
                );
                toast("Pad restored to factory spec");
              } else {
                setConfirmRestore(true);
                if (restoreTimer.current != null) window.clearTimeout(restoreTimer.current);
                restoreTimer.current = window.setTimeout(() => setConfirmRestore(false), 2400);
              }
            }}
            className={`rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold transition ${
              confirmRestore
                ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
                : "border-white/12 text-white/50 hover:text-white/80 hover:border-white/25"
            }`}
          >
            {confirmRestore ? "CONFIRM RESTORE" : "Factory"}
          </button>

          <button
            onClick={onClose}
            className="rounded-lg border border-white/12 px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-white/60 hover:text-white/90 hover:border-white/30 transition"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mt-3 text-[10px] uppercase tracking-[0.25em] text-dim">
        Target params — deltas scale with strike intensity
      </div>

      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
        {rows.map(({ key, value, meta }) => (
          <div key={key} className="flex items-center gap-2">
            <div
              className="w-24 shrink-0 text-[11px] truncate"
              title={meta?.hint}
              style={{ color: meta?.color ?? "#fff" }}
            >
              {meta?.label ?? key}
            </div>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={value}
              onChange={(e) => setDelta(key, Number(e.target.value))}
              className="flex-1 accent-cyan"
              aria-label={`${meta?.label ?? key} delta`}
            />
            <div
              className={`w-12 text-[11px] font-mono text-right ${
                value > 0 ? "text-cyan" : value < 0 ? "text-amber" : "text-dim"
              }`}
            >
              {value > 0 ? "+" : ""}
              {value.toFixed(2)}
            </div>
            <button
              onClick={() => removeDelta(key)}
              className="shrink-0 w-6 h-6 rounded-md border border-white/10 text-[10px] text-white/40 hover:text-rose-200 hover:border-rose-400/40 transition"
              title="Remove this target"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <select
          value=""
          onChange={(e) => addDelta(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-cyan/60"
          aria-label="Add target param"
        >
          <option value="" disabled>
            + Add target param…
          </option>
          {addable.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        {midiAvailable && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() =>
                setLearning(
                  learningThis ? null : { kind: "reactorPad", pad: index },
                )
              }
              className={`rounded-lg border px-3 py-2 text-[10px] uppercase tracking-[0.15em] font-semibold transition ${
                learningThis
                  ? "border-lime/60 bg-lime/15 text-lime"
                  : "border-white/12 text-white/55 hover:text-white/85 hover:border-white/25"
              }`}
            >
              {learningThis ? "Waiting for MIDI input…" : "◍ MIDI learn"}
            </button>
            {learningThis && (
              <span className="text-[10px] text-dim">
                {midiInputs.length === 0
                  ? "No MIDI inputs detected — connect a controller."
                  : pad.mode === "momentary"
                    ? "Play a note — Momentary holds while the note is down."
                    : "Play a note — Latch toggles on each press."}
              </span>
            )}
            {padMappings.map((m) => (
              <span
                key={m.id}
                className="flex items-center gap-1.5 text-[10px] font-mono text-white/55 border border-white/10 rounded-full px-2 py-1"
              >
                {m.label}
                <button
                  onClick={() => removeMapping(m.id)}
                  className="text-white/35 hover:text-rose-200 transition"
                  title="Remove mapping"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
