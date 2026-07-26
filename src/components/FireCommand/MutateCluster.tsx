/**
 * Natural Selection mutate cluster — breed two offspring, audition A/B,
 * keep the winner, evolve again. Visual: pedigree / pressure / organisms.
 */

import { useEffect, useState } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";

function HelixMark({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={active ? "animate-[evolve-spin_6s_linear_infinite]" : undefined}
    >
      <path
        d="M7 3c4 3.5 6 5.5 10 9-4 3.5-6 5.5-10 9"
        stroke="#6ee7b7"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M17 3c-4 3.5-6 5.5-10 9 4 3.5 6 5.5 10 9"
        stroke="#34d399"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.7"
      />
      {[5, 9, 13, 17].map((y) => (
        <line
          key={y}
          x1="8"
          x2="16"
          y1={y}
          y2={y}
          stroke="#a7f3d0"
          strokeWidth="1.2"
          opacity="0.55"
        />
      ))}
      <circle cx="12" cy="12" r="1.6" fill="#ecfdf5" opacity="0.9" />
    </svg>
  );
}

function pressureLabel(amount: number): string {
  if (amount < 0.25) return "Subtle drift";
  if (amount < 0.5) return "Adaptation";
  if (amount < 0.75) return "Speciation";
  return "Cambrian burst";
}

export function MutateCluster() {
  const mutation = useFireCommandStore((s) => s.mutation);
  const lineage = useFireCommandStore((s) => s.mutateLineage);
  const amount = useFireCommandStore((s) => s.mutateAmount);
  const toast = useUIStore((s) => s.toast);
  const act = useFireCommandStore.getState;
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!mutation) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 700);
    return () => window.clearTimeout(t);
  }, [mutation?.generation]);

  const displayGen = mutation?.generation ?? (lineage > 0 ? lineage : null);

  const breed = () => {
    act().mutate();
    const next = act().mutation;
    toast(
      next && next.generation > 1
        ? `🧬 Gen ${next.generation} — offspring of the survivor. A is live.`
        : "🧬 Two mutations bred — A is playing. Tap B to compare, Keep to evolve.",
    );
  };

  return (
    <div
      className={`relative min-w-0 overflow-hidden rounded-2xl border px-2 py-2 min-h-[88px] transition ${
        mutation
          ? "border-emerald-400/45 bg-gradient-to-br from-emerald-500/15 via-teal-500/[0.07] to-lime-500/[0.05] shadow-[0_0_28px_rgb(52_211_153/0.18)]"
          : "border-emerald-400/25 bg-gradient-to-br from-emerald-500/[0.08] to-transparent"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div
          className={`absolute -left-6 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-emerald-400/20 blur-2xl ${
            flash ? "animate-[evolve-bloom_0.7s_ease-out]" : "animate-[evolve-breathe_3.8s_ease-in-out_infinite]"
          }`}
        />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-300/50 to-transparent" />
      </div>

      <div className="relative z-10 grid min-w-0 gap-2" style={{ gridTemplateColumns: mutation ? "minmax(0,1fr) auto" : "1fr" }}>
        {/* Left — title, breed, pressure */}
        <div className="flex min-w-0 flex-col justify-center gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <HelixMark active={!!mutation} />
            <div className="min-w-0">
              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-200/90 leading-none truncate">
                Natural Selection
              </div>
              <div className="text-[9px] text-emerald-100/45 mt-0.5 truncate">
                {pressureLabel(amount)} · {Math.round(amount * 100)}%
                {displayGen != null && !mutation ? ` · lineage ${displayGen}` : ""}
              </div>
            </div>
          </div>

          <button
            onClick={breed}
            className={`group relative h-8 overflow-hidden rounded-xl border text-[11px] font-black uppercase tracking-[0.12em] transition truncate ${
              mutation
                ? "border-emerald-300/70 bg-emerald-400/25 text-emerald-50 shadow-[0_0_16px_rgb(52_211_153/0.35)] hover:bg-emerald-400/35"
                : "border-emerald-400/55 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
            }`}
            title="Breed two offspring of the current sound. Audition A/B, keep a winner, mutate again to evolve."
          >
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(167,243,208,0.35),transparent_55%)] opacity-70 group-hover:opacity-100 transition" />
            <span className="relative">{mutation ? "Breed next gen" : "Mutate · Breed"}</span>
          </button>

          <div className="flex items-center gap-1.5 px-0.5 min-w-0">
            <span className="text-[8px] uppercase tracking-wider text-emerald-200/35 shrink-0">Mild</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={amount}
              onChange={(e) => act().setMutateAmount(Number(e.target.value))}
              className="min-w-0 flex-1 h-1.5 cursor-pointer accent-emerald-400"
              aria-label="Mutation pressure"
              title={`Mutation pressure: ${Math.round(amount * 100)}% — small = subtle drift, large = wild offspring`}
            />
            <span className="text-[8px] uppercase tracking-wider text-lime-300/50 shrink-0">Wild</span>
          </div>
        </div>

        {/* Right — gen / A-B / keep — contained, never bleeds */}
        {mutation && (
          <div className="flex min-w-0 shrink-0 items-center gap-1 border-l border-emerald-400/20 pl-1.5">
            <div className="flex flex-col items-center gap-0.5 px-0.5">
              <span className="text-[8px] font-mono uppercase tracking-[0.18em] text-emerald-300/60">Gen</span>
              <span className="text-sm font-black font-mono text-emerald-100 tabular-nums leading-none">
                {mutation.generation}
              </span>
            </div>

            <div className="flex items-end gap-1">
              {(["a", "b"] as const).map((w) => {
                const live = mutation.listening === w;
                return (
                  <button
                    key={w}
                    onClick={() => act().auditionMutation(w)}
                    className={`relative h-10 w-9 rounded-xl border text-[11px] font-black transition overflow-hidden ${
                      live
                        ? "border-emerald-200 bg-emerald-400/30 text-emerald-50 shadow-[0_0_18px_rgb(52_211_153/0.45)]"
                        : "border-white/15 bg-black/35 text-white/45 hover:text-white/80 hover:border-emerald-400/40"
                    }`}
                    title={`Audition offspring ${w.toUpperCase()}`}
                  >
                    {live && (
                      <span className="pointer-events-none absolute inset-0 animate-[evolve-breathe_2.2s_ease-in-out_infinite] bg-[radial-gradient(circle_at_50%_30%,rgba(236,253,245,0.35),transparent_65%)]" />
                    )}
                    <span className="relative block leading-none">{w.toUpperCase()}</span>
                    <span className={`relative block text-[7px] uppercase tracking-wider mt-0.5 ${live ? "text-emerald-100/70" : "text-white/30"}`}>
                      {live ? "live" : "rival"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex w-[76px] flex-col gap-1 shrink-0">
              <button
                onClick={() => {
                  act().commitMutation();
                  toast(`✓ Kept ${mutation.listening.toUpperCase()} — lineage Gen ${mutation.generation}. Mutate again to evolve.`);
                }}
                className="h-9 rounded-xl border border-lime-300/60 bg-lime-400/20 hover:bg-lime-400/30 px-1.5 text-[8px] font-black uppercase tracking-[0.06em] leading-tight text-lime-100 transition shadow-[0_0_12px_rgb(163_230_53/0.25)]"
                title="Keep the offspring you're hearing — it becomes the new parent"
              >
                Keep<br />winner
              </button>
              <button
                onClick={() => {
                  act().discardMutation();
                  toast("↩ Round discarded — parent patch restored");
                }}
                className="h-7 rounded-lg border border-white/12 bg-white/[0.04] hover:bg-white/10 px-1.5 text-[8px] uppercase tracking-[0.08em] text-white/50 hover:text-white/80 transition"
                title="Discard both offspring and restore the parent"
              >
                Extinct
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
