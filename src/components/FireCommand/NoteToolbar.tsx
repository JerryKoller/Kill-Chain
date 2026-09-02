/**
 * Piano-roll editing toolbox.
 *
 * The roll could place, drag, resize and erase — and nothing else. Every
 * rhythmic or harmonic edit was manual: no quantize, no legato, no chord
 * stacking, no velocity ramp, no repeat. This surfaces the `applyNoteOp`
 * toolbox as a compact popover so the roll's own chrome stays uncluttered.
 *
 * Scope rule, shown in the header so it's never ambiguous: with a selection
 * ops apply to the selected notes, otherwise to every note on the active
 * channel.
 */

import { useEffect, useRef, useState } from "react";
import { useFireSequencerStore, type FireNoteOp } from "@/state/fireSequencerStore";
import { CHORD_RECIPES, NOTE_SCATTER_TIMING, NOTE_SCATTER_VELOCITY } from "@/lib/fireNoteOps";
import { useUIStore } from "@/state/uiStore";

type Group = "time" | "length" | "pitch" | "vel";

const GRIDS: { label: string; steps: number }[] = [
  { label: "1/4", steps: 4 },
  { label: "1/8", steps: 2 },
  { label: "1/8T", steps: 4 / 3 },
  { label: "1/16", steps: 1 },
  { label: "1/16T", steps: 2 / 3 },
  { label: "1/32", steps: 0.5 },
];

export function NoteToolbar({ selectedIds }: { selectedIds: ReadonlySet<string> }) {
  const applyNoteOp = useFireSequencerStore((s) => s.applyNoteOp);
  const toast = useUIStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<Group>("time");
  const [grid, setGrid] = useState(1);
  const [strength, setStrength] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const scoped = selectedIds.size;

  // Close on outside click / Escape. Escape stops here so it doesn't also
  // exit the roll's fullscreen — same cascade rule the rest of the UI uses.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const run = (op: FireNoteOp, label: string) => {
    const n = applyNoteOp(op, selectedIds);
    toast(n > 0 ? `${label} · ${n} note${n === 1 ? "" : "s"}` : `${label} · nothing to change`);
  };

  const btn = "rounded border border-white/12 bg-white/[0.04] px-1.5 py-1 text-[10px] font-semibold text-white/70 transition hover:border-white/30 hover:bg-white/[0.09] hover:text-white";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
          open
            ? "border-[#7ce8d5]/55 bg-[#7ce8d5]/15 text-[#bdf5ea]"
            : "border-white/12 bg-white/[0.04] text-white/60 hover:text-white"
        }`}
        title="Note tools — quantize, length, chords, velocity"
      >
        Tools{scoped > 0 ? ` · ${scoped}` : ""}
      </button>

      {open && (
        <div
          className="absolute right-0 z-40 mt-1 w-[330px] rounded-xl border border-white/12 bg-[#0b0d12] p-2.5 shadow-2xl"
          role="dialog"
          aria-label="Note tools"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40">
              Note tools
            </div>
            <div className="text-[9px] font-mono text-white/45">
              {scoped > 0 ? `${scoped} selected` : "whole channel"}
            </div>
          </div>

          <div className="mb-2 flex gap-0.5 rounded-lg border border-white/10 bg-black/40 p-0.5">
            {(["time", "length", "pitch", "vel"] as Group[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={`flex-1 rounded px-1 py-1 text-[9px] font-black uppercase tracking-wider transition ${
                  group === g ? "bg-[#7ce8d5]/18 text-[#bdf5ea]" : "text-white/40 hover:text-white/70"
                }`}
              >
                {g === "vel" ? "Vel" : g}
              </button>
            ))}
          </div>

          {group === "time" && (
            <div className="space-y-2">
              <div>
                <Label>Grid</Label>
                <div className="flex flex-wrap gap-1">
                  {GRIDS.map((g) => (
                    <button
                      key={g.label}
                      type="button"
                      onClick={() => setGrid(g.steps)}
                      className={`${btn} ${Math.abs(grid - g.steps) < 1e-6 ? "!border-[#7ce8d5]/55 !bg-[#7ce8d5]/15 !text-[#bdf5ea]" : ""}`}
                    >{g.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Strength · {Math.round(strength * 100)}%</Label>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  className="w-full accent-[#7ce8d5]"
                  title="100% snaps hard to the grid; lower values pull toward it and keep the feel"
                />
              </div>
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "quantize", grid, strength }, "Quantize")}
                >Quantize</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "quantizeLength", grid }, "Quantize ends")}
                >Ends</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "humanize", timing: NOTE_SCATTER_TIMING, velocity: NOTE_SCATTER_VELOCITY }, "Scatter")}
                  title="Nudge starts and velocities (same as Shift+H / roll Scatter). Velocity lane 'Vel jitter' does not move timing."
                >Scatter</button>
              </Row>
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "nudge", steps: -grid }, "Nudge left")}
                >← Nudge</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "nudge", steps: grid }, "Nudge right")}
                >Nudge →</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "reverse" }, "Reverse")}
                >Reverse</button>
              </Row>
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "strum", spread: 0.25 }, "Strum up")}
                >Strum ↑</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "strum", spread: 0.25, down: true }, "Strum down")}
                >Strum ↓</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "repeat", times: 1 }, "Repeat")}
                >Repeat ×2</button>
              </Row>
            </div>
          )}

          {group === "length" && (
            <div className="space-y-2">
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "length", mode: "legato" }, "Legato")}
                  title="Stretch each note to the next note on the same pitch"
                >Legato</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "length", mode: "staccato" }, "Staccato")}
                >Staccato</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "length", mode: "toGrid", grid }, "Snap length")}
                >To grid</button>
              </Row>
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "length", mode: "double" }, "Double length")}
                >×2 len</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "length", mode: "half" }, "Halve length")}
                >÷2 len</button>
              </Row>
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "join" }, "Glue")}
                  title="Merge touching notes on the same pitch into one"
                >Glue</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "split", pieces: 2 }, "Split")}
                >Split ÷2</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "split", pieces: 4 }, "Ratchet")}
                  title="Cut each note into four — ratchet/roll"
                >÷4</button>
              </Row>
            </div>
          )}

          {group === "pitch" && (
            <div className="space-y-2">
              <div>
                <Label>Transpose</Label>
                <Row>
                  {[-12, -7, -5, -1, 1, 5, 7, 12].map((s) => (
                    <button key={s} type="button" className={btn}
                      onClick={() => run({ kind: "transpose", semitones: s }, `Transpose ${s > 0 ? "+" : ""}${s}`)}
                    >{s > 0 ? `+${s}` : s}</button>
                  ))}
                </Row>
              </div>
              <div>
                <Label>Stack chord</Label>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(CHORD_RECIPES).map(([name, intervals]) => (
                    <button key={name} type="button" className={btn}
                      onClick={() => run({ kind: "chord", intervals }, name)}
                    >{name}</button>
                  ))}
                </div>
              </div>
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "invertChord", times: 1 }, "Invert")}
                  title="Move the lowest note up an octave"
                >Invert</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "invertPitch" }, "Mirror")}
                  title="Mirror pitches around the selection's centre"
                >Mirror</button>
              </Row>
            </div>
          )}

          {group === "vel" && (
            <div className="space-y-2">
              <Row>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "velScale", mul: 1.15 }, "Louder")}
                >+15%</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "velScale", mul: 0.87 }, "Softer")}
                >−15%</button>
                <button type="button" className={btn}
                  onClick={() => run({ kind: "velSet", value: 0.85 }, "Flatten")}
                  title="Set every scoped note to the same velocity"
                >Flat</button>
              </Row>
              <div>
                <Label>Ramp</Label>
                <Row>
                  <button type="button" className={btn}
                    onClick={() => run({ kind: "velRamp", from: 0.35, to: 1 }, "Crescendo")}
                  >Cresc.</button>
                  <button type="button" className={btn}
                    onClick={() => run({ kind: "velRamp", from: 1, to: 0.35 }, "Diminuendo")}
                  >Dim.</button>
                </Row>
              </div>
              <div>
                <Label>Accent</Label>
                <Row>
                  <button type="button" className={btn}
                    onClick={() => run({ kind: "accent", every: 4, amount: 0.18 }, "Accent 1/4")}
                  >Every 1/4</button>
                  <button type="button" className={btn}
                    onClick={() => run({ kind: "accent", every: 8, amount: 0.18 }, "Accent 1/2")}
                  >Every 1/2</button>
                  <button type="button" className={btn}
                    onClick={() => run({ kind: "accent", every: 16, amount: 0.2 }, "Accent bar")}
                  >Bar</button>
                </Row>
              </div>
            </div>
          )}

          <div className="mt-2 border-t border-white/[0.07] pt-1.5 text-[9px] text-white/30">
            Every tool is one undo step (Ctrl+Z).
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/35">
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1">{children}</div>;
}
