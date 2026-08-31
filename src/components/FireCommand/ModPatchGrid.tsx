/**
 * ModPatchGrid — Patch Loom bay (Signal Path Mod · FC.matrix).
 * Sources × destinations. Click to allocate a slot; drag ↕ bipolar amount; right-click clears.
 */

import { useEffect, useState, useRef } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ModSource, ModDest } from "@/audio/dsp/FireCommandSynth";
import { FC, bandShade } from "./fireColors";
import { MatrixStageViz } from "./MatrixStageViz";

const C = FC.matrix;
const C_POS = bandShade(FC.mod, 0.88);
const C_NEG = bandShade(FC.mod, 0.42);
const C_GLOW = bandShade(FC.mod, 0.96);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const MTX_SOURCES: { id: ModSource; label: string; hint: string; tint: string }[] = [
  { id: "lfo1", label: "LFO 1", hint: "LFO 1", tint: FC.lfo },
  { id: "lfo2", label: "LFO 2", hint: "LFO 2", tint: FC.lfo2 },
  { id: "modenv", label: "M.Env", hint: "Mod envelope (per note)", tint: bandShade(FC.mod, 0.7) },
  { id: "velocity", label: "Vel", hint: "Note velocity (per note)", tint: bandShade(FC.mod, 0.78) },
  { id: "keytrack", label: "Key", hint: "Key tracking (per note)", tint: bandShade(FC.mod, 0.82) },
  { id: "macro1", label: "M1", hint: "Macro 1", tint: bandShade(FC.mod, 0.55) },
  { id: "macro2", label: "M2", hint: "Macro 2", tint: bandShade(FC.mod, 0.6) },
  { id: "macro3", label: "M3", hint: "Macro 3", tint: bandShade(FC.mod, 0.65) },
  { id: "macro4", label: "M4", hint: "Macro 4", tint: bandShade(FC.mod, 0.7) },
  { id: "random", label: "Rnd", hint: "Random sample & hold", tint: bandShade(FC.mod, 0.92) },
];

export const MTX_DESTS: { id: ModDest; label: string; hint: string }[] = [
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
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const dragRef = useRef<{ slot: number; startY: number; startAmount: number } | null>(null);
  const flashTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimeoutRef.current), []);

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
        window.clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = window.setTimeout(() => setBudgetFlash(false), 900);
        return;
      }
      slot = free;
      startAmount = 0.5;
      setModRoute(slot, { source: src, dest, amount: startAmount });
    } else {
      startAmount = matrix[slot]!.amount;
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

  const onCellUp = (e: React.PointerEvent) => {
    // Release the capture taken in onCellDown. Without this the cell kept
    // ownership of the pointer after the drag, so later clicks anywhere else
    // in Fire Command were delivered here and appeared to do nothing.
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
    dragRef.current = null;
  };

  return (
    <div>
      <MatrixStageViz />

      <div
        className="overflow-x-auto rounded-xl border p-2"
        style={{
          borderColor: `${C}28`,
          background: `linear-gradient(180deg, ${C}10, rgba(0,0,0,0.35))`,
          boxShadow: `inset 0 1px 0 ${C}18`,
        }}
      >
        <table className="border-separate w-full" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="w-10" />
              {MTX_DESTS.map((dst, ci) => (
                <th
                  key={dst.id}
                  className="text-[8.5px] font-semibold uppercase tracking-wide pb-1 min-w-[26px] transition-colors"
                  style={{ color: hover?.c === ci ? C_GLOW : "rgba(255,255,255,0.38)" }}
                  title={dst.hint}
                >
                  {dst.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody onPointerLeave={() => setHover(null)}>
            {MTX_SOURCES.map((src, ri) => (
              <tr key={src.id}>
                <td
                  className="text-[9px] font-semibold uppercase tracking-wide pr-1.5 text-right whitespace-nowrap transition-colors"
                  style={{ color: hover?.r === ri ? src.tint : "rgba(255,255,255,0.42)" }}
                  title={src.hint}
                >
                  {src.label}
                </td>
                {MTX_DESTS.map((dst, ci) => {
                  const slot = slotOf(src.id, dst.id);
                  const amount = slot >= 0 ? matrix[slot]!.amount : 0;
                  const active = slot >= 0;
                  const mag = Math.abs(amount);
                  const color = amount >= 0 ? C_POS : C_NEG;
                  const inCross = hover !== null && (hover.r === ri || hover.c === ci);
                  return (
                    <td key={dst.id} className="p-0">
                      <div
                        onPointerDown={(e) => onCellDown(e, src.id, dst.id)}
                        onPointerMove={onCellMove}
                        onPointerUp={onCellUp}
                        onPointerCancel={onCellUp}
                        onPointerEnter={() => setHover({ r: ri, c: ci })}
                        onContextMenu={(e) => e.preventDefault()}
                        className="mx-auto flex h-[24px] w-[26px] items-center justify-center rounded-md border cursor-pointer touch-none select-none transition-all"
                        style={{
                          borderColor: active
                            ? `${color}88`
                            : inCross
                              ? `${src.tint}44`
                              : "rgba(255,255,255,0.06)",
                          background: active
                            ? `radial-gradient(circle at 50% 40%, ${color}33, ${color}0a)`
                            : inCross
                              ? `${src.tint}12`
                              : "rgba(255,255,255,0.02)",
                          boxShadow: active ? `inset 0 0 8px ${color}33, 0 0 ${4 + mag * 6}px ${color}22` : undefined,
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
                              background: `radial-gradient(circle at 35% 35%, #fff, ${color})`,
                              boxShadow: mag > 0.02 ? `0 0 ${4 + mag * 10}px ${color}` : undefined,
                              opacity: 0.5 + mag * 0.5,
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]" style={{ color: `${C}99` }}>
        <div className="flex items-center gap-2">
          <span
            className="font-mono px-1.5 py-0.5 rounded border transition"
            style={
              budgetFlash
                ? { borderColor: "rgba(251,113,133,0.7)", color: "#fda4af", background: "rgba(244,63,94,0.15)" }
                : { borderColor: `${C}33`, color: `${C}aa`, background: `${C}14` }
            }
          >
            {used}/{matrix.length} slots
          </span>
          <span className="flex items-center gap-[3px]" aria-hidden>
            {matrix.map((r, i) => {
              const on = r.source !== "none" && r.dest !== "none";
              const col = on ? (r.amount >= 0 ? C_POS : C_NEG) : "rgba(255,255,255,0.08)";
              return (
                <span
                  key={i}
                  className="h-[10px] w-[5px] rounded-[2px] transition-colors"
                  style={{
                    background: col,
                    boxShadow: on ? `0 0 5px ${col}66` : "none",
                  }}
                />
              );
            })}
          </span>
        </div>
        <span className="text-right">
          click to patch · drag ↕ depth ({" "}
          <span style={{ color: C_POS }}>sky +</span> /{" "}
          <span style={{ color: C_NEG }}>deep −</span> ) · right-click clears
        </span>
      </div>
    </div>
  );
}
