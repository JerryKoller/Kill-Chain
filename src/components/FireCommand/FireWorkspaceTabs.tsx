/**
 * Synth | Sequencer workspace switcher — beginner-clear segmented control.
 */

import type { FireWorkspace } from "./useFireWorkspace";

const HINT: Record<FireWorkspace, string> = {
  synth: "Build the sound",
  sequencer: "Build the beat & melody",
};

export function FireWorkspaceTabs({
  workspace,
  onChange,
}: {
  workspace: FireWorkspace;
  onChange: (ws: FireWorkspace) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-white/12 bg-black/35 p-1">
          <button
            type="button"
            onClick={() => onChange("synth")}
            className="px-4 py-2 text-[12px] font-black uppercase tracking-[0.14em] rounded-lg transition"
            style={
              workspace === "synth"
                ? { background: "rgba(255,106,61,0.22)", color: "#ffbfa0", boxShadow: "0 0 18px rgba(255,106,61,0.25)" }
                : { color: "rgba(255,255,255,0.42)" }
            }
            title="Synth — oscillators, filter, FX, keyboard"
          >
            Synth
          </button>
          <button
            type="button"
            onClick={() => onChange("sequencer")}
            className="px-4 py-2 text-[12px] font-black uppercase tracking-[0.14em] rounded-lg transition"
            style={
              workspace === "sequencer"
                ? { background: "rgba(98,182,255,0.2)", color: "#b8dcff", boxShadow: "0 0 18px rgba(98,182,255,0.22)" }
                : { color: "rgba(255,255,255,0.42)" }
            }
            title="Sequencer — patterns, song order, piano roll, drums"
          >
            Sequencer
          </button>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-white/70">{HINT[workspace]}</div>
          <div className="text-[9px] text-white/35">
            {workspace === "synth"
              ? "Patch · modules · on-screen keys"
              : "Patterns · song · piano · drums"}
          </div>
        </div>
      </div>
    </div>
  );
}
