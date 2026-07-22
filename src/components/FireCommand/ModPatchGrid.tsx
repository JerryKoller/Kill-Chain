/**
 * ModPatchGrid (v1.7) — the mod matrix as a patch-bay grid.
 *
 * Sources are rows, destinations are columns. Click an empty cell to allocate
 * one of the 8 matrix slots to that (source → destination) pair; drag
 * vertically to set the bipolar amount (dot grows/changes color); right-click
 * clears the cell back into the free pool. It's purely a VIEW over the same
 * 8-slot `modMatrix` array — presets, undo and the engine see nothing new.
 */

import { useRef, useState } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ModSource, ModDest } from "@/audio/dsp/FireCommandSynth";

const GRN = "#7cf6b0";
const AMB = "#ffb35c";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SOURCES: { id: ModSource; label: string; hint: string }[] = [
  { id: "lfo1", label: "LFO 1", hint: "LFO 1" },
  { id: "lfo2", label: "LFO 2", hint: "LFO 2" },
  { id: "modenv", label: "M.Env", hint: "Mod envelope (per note)" },
  { id: "velocity", label: "Vel", hint: "Note velocity (per note)" },
  { id: "keytrack", label: "Key", hint: "Key tracking (per note)" },
  { id: "macro1", label: "M1", hint: "Macro 1" },
  { id: "macro2", label: "M2", hint: "Macro 2" },
  { id: "macro3", label: "M3", hint: "Macro 3" },
  { id: "macro4", label: "M4", hint: "Macro 4" },
  { id: "random", label: "Rnd", hint: "Random sample & hold" },
];

const DESTS: { id: ModDest; label: string; hint: string }[] = [
  { id: "pitch", label: "Pit", hint: "Pitch" },
  { id: "cutoff", label: "Cut", hint: "Filter cutoff" },
  { id: "resonance", label: "Res", hint: "Filter resonance" },
  { id: "wtA", label: "MoA", hint: "Osc A morph" },
  { id: "wtB", label: "MoB", hint: "Osc B morph" },
  { id: "wtC", label: "MoC", hint: "Osc C morph" },
  { id: "levelA", label: "LvA", hint: "Osc A level" },
  { id: "levelB", label: "LvB", hint: "Osc B level" },
  { id: "levelC", label: "LvC", hint: "Osc C level" },
  { id: "fm", label: "FM", hint: "FM amount" },
  { id: "pan", label: "Pan", hint: "Stereo pan" },
  { id: "volume", label: "Vol", hint: "Volume" },
  { id: "reverb", label: "Rev", hint: "Reverb send" },
  { id: "delay", label: "Dly", hint: "Delay send" },
];

export function ModPatchGrid() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  const [budgetFlash, setBudgetFlash] = useState(false);
  const dragRef = useRef<{ slot: number; startY: number; startAmount: number } | null>(null);

  const slotOf = (src: ModSource, dest: ModDest) =>
    matrix.findIndex((r) => r.source === src && r.dest === dest);
  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none").length;

  const onCellDown = (e: React.PointerEvent, src: ModSource, dest: ModDest) => {
    e.preventDefault();
    let slot = slotOf(src, dest);
    if (e.button === 2) {
      if (slot >= 0) setModRoute(slot, { source: "none", dest: "none", amount: 0 });
      return;
    }
    let startAmount: number;
    if (slot === -1) {
      const free = matrix.findIndex((r) => r.source === "none" || r.dest === "none");
      if (free === -1) {
        setBudgetFlash(true);
        setTimeout(() => setBudgetFlash(false), 900);
        return;
      }
      slot = free;
      startAmount = 0.5;
      setModRoute(slot, { source: src, dest, amount: startAmount });
    } else {
      startAmount = matrix[slot].amount;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { slot, startY: e.clientY, startAmount };
  };

  const onCellMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const amount = clamp(d.startAmount + (d.startY - e.clientY) / 110, -1, 1);
    setModRoute(d.slot, { amount: Math.round(amount * 100) / 100 });
  };

  const onCellUp = () => { dragRef.current = null; };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {DESTS.map((dst) => (
                <th
                  key={dst.id}
                  className="text-[8.5px] font-semibold uppercase tracking-wide text-white/40 pb-0.5 min-w-[26px]"
                  title={dst.hint}
                >
                  {dst.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((src) => (
              <tr key={src.id}>
                <td
                  className="text-[9px] font-semibold uppercase tracking-wide text-white/45 pr-1.5 text-right whitespace-nowrap"
                  title={src.hint}
                >
                  {src.label}
                </td>
                {DESTS.map((dst) => {
                  const slot = slotOf(src.id, dst.id);
                  const amount = slot >= 0 ? matrix[slot].amount : 0;
                  const active = slot >= 0;
                  const mag = Math.abs(amount);
                  const color = amount >= 0 ? GRN : AMB;
                  return (
                    <td key={dst.id} className="p-0">
                      <div
                        onPointerDown={(e) => onCellDown(e, src.id, dst.id)}
                        onPointerMove={onCellMove}
                        onPointerUp={onCellUp}
                        onPointerCancel={onCellUp}
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-[26px] h-[22px] rounded-[5px] border flex items-center justify-center cursor-pointer touch-none select-none transition-colors"
                        style={{
                          borderColor: active ? `${color}66` : "rgba(255,255,255,0.06)",
                          background: active ? `${color}14` : "rgba(255,255,255,0.015)",
                        }}
                        title={
                          active
                            ? `${src.hint} → ${dst.hint}: ${amount >= 0 ? "+" : ""}${Math.round(amount * 100)}% · drag ↕ = amount · right-click = clear`
                            : `${src.hint} → ${dst.hint} — click to patch (slot budget: ${used}/${matrix.length})`
                        }
                        role="button"
                        aria-label={`${src.hint} to ${dst.hint}${active ? `, amount ${Math.round(amount * 100)} percent` : ", unpatched"}`}
                      >
                        {active && (
                          <span
                            className="rounded-full"
                            style={{
                              width: 4 + mag * 12,
                              height: 4 + mag * 12,
                              background: color,
                              boxShadow: mag > 0.02 ? `0 0 ${3 + mag * 8}px ${color}aa` : undefined,
                              opacity: 0.45 + mag * 0.55,
                            }}
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-dim">
        <span
          className={`font-mono px-1.5 py-0.5 rounded border transition ${
            budgetFlash
              ? "border-rose-400/70 text-rose-300 bg-rose-500/15"
              : "border-white/10 text-white/50"
          }`}
        >
          {used}/{matrix.length} slots
        </span>
        <span>
          click a cell to patch · drag ↕ sets depth ({" "}
          <span style={{ color: GRN }}>green +</span> /{" "}
          <span style={{ color: AMB }}>amber −</span> ) · right-click clears
        </span>
      </div>
    </div>
  );
}
