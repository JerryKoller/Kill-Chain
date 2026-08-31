/**
 * Natural Selection mutate cluster — breed two offspring, audition A/B,
 * keep the winner, evolve again. Visual: pedigree / pressure / organisms.
 */

import { useEffect, useRef, useState } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";

/** Compact vertical-drag dial — replaces the Mild↔Wild slider when the cluster is squished. */
function PressureKnob({
  value,
  onChange,
  size = 28,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startV = useRef(0);
  // Ref mirror: setState is async, so pointermoves arriving before the
  // re-render were dropped — the first stretch of every drag felt dead.
  const dragRef = useRef(false);
  const [drag, setDrag] = useState(false);
  const t = Math.max(0, Math.min(1, value));
  const color = "#34d399";

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startV.current = t;
    dragRef.current = true;
    setDrag(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const scale = e.shiftKey ? 2400 : 180;
    const next = Math.max(0, Math.min(1, startV.current + (startY.current - e.clientY) / scale));
    startY.current = e.clientY;
    startV.current = next;
    onChange(next);
  };
  const up = (e: React.PointerEvent) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = false;
    setDrag(false);
  };

  const nudgeRef = useRef<(dir: number, fine: boolean) => void>(() => {});
  nudgeRef.current = (dir, fine) => {
    onChange(Math.max(0, Math.min(1, t + dir * (fine ? 0.005 : 0.04))));
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      nudgeRef.current(ev.deltaY < 0 ? 1 : -1, ev.shiftKey);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const angle = -135 + t * 270;
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const pt = (deg: number, rr: number) => ({
    x: cx + Math.sin(rad(deg)) * rr,
    y: cy - Math.cos(rad(deg)) * rr,
  });
  const arc = (a0: number, a1: number) => {
    const s = pt(a1, r);
    const e = pt(a0, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
  };
  const tip = pt(angle, r - 1.5);

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Mutation pressure"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(t * 100)}
      aria-valuetext={`${Math.round(t * 100)}% — Mild to Wild`}
      className="relative shrink-0 cursor-ns-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
      style={{ width: size, height: size, touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onChange(0.35)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          nudgeRef.current(1, e.shiftKey);
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          nudgeRef.current(-1, e.shiftKey);
        } else if (e.key === "Home" || e.key === "0") {
          e.preventDefault();
          onChange(0.35);
        }
      }}
      title={`Pressure ${Math.round(t * 100)}% — drag/scroll · Mild↔Wild · Shift = fine · Double-click reset`}
    >
      <svg width={size} height={size} className="overflow-visible" aria-hidden>
        <circle cx={cx} cy={cy} r={r + 1.5} fill="rgba(0,0,0,0.4)" stroke="rgba(52,211,153,0.25)" strokeWidth={1} />
        <path d={arc(-135, 135)} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={2.5} strokeLinecap="round" />
        <path
          d={arc(-135, angle)}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ filter: drag ? `drop-shadow(0 0 4px ${color})` : `drop-shadow(0 0 1.5px ${color})` }}
        />
        <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={1.75} strokeLinecap="round" />
        <circle cx={tip.x} cy={tip.y} r={2.25} fill={color} />
      </svg>
    </div>
  );
}

function HelixMark({ active, size = 22 }: { active: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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
  if (amount < 0.9) return "Cambrian burst";
  return "Natural selection";
}

export function MutateCluster({ compact = false }: { compact?: boolean }) {
  const mutation = useFireCommandStore((s) => s.mutation);
  const lineage = useFireCommandStore((s) => s.mutateLineage);
  const amount = useFireCommandStore((s) => s.mutateAmount);
  const genealogy = useFireCommandStore((s) => s.mutationGenealogy);
  const clearGenealogy = useFireCommandStore((s) => s.clearMutationGenealogy);
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
  const trail = (genealogy ?? []).slice(-4);

  const breed = () => {
    act().mutate();
    const next = act().mutation;
    toast(
      next && next.generation > 1
        ? `🧬 Gen ${next.generation} — offspring of the survivor. A is live.`
        : "🧬 Two mutations bred — A is playing. Tap B to compare, Keep to evolve.",
    );
  };

  const genealogyTrail = trail.length > 0 && (
    <div className="flex items-center gap-1 min-w-0 flex-wrap">
      {trail.map((g) => (
        <span
          key={`${g.generation}-${g.at}`}
          className="rounded px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider text-emerald-200/70 bg-emerald-400/10 ring-1 ring-emerald-400/25"
          title={`Gen ${g.generation} kept ${g.kept.toUpperCase()}`}
        >
          Gen{g.generation}→{g.kept.toUpperCase()}
        </span>
      ))}
      {typeof clearGenealogy === "function" && (
        <button
          type="button"
          onClick={() => clearGenealogy()}
          className="rounded px-1 py-0.5 text-[8px] uppercase tracking-wider text-white/35 hover:text-white/70 ring-1 ring-white/10"
          title="Clear mutation genealogy trail"
        >
          Clear
        </button>
      )}
    </div>
  );

  if (compact) {
    // Same chrome rhythm as Random Armory: full-width title + control row,
    // vertically centered in the bay. Mutate/Breed is flex-1 with overflow
    // clipped so it fills space without bleeding over Mild/Wild.
    return (
      <div className="relative flex h-full w-full min-w-0 flex-col justify-center gap-1.5">
        <div className="flex h-8 min-w-0 items-center gap-2">
          <HelixMark active={!!mutation || flash} size={18} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-200/90 leading-none">
              Natural Selection
            </div>
            <div className="mt-0.5 truncate text-[10px] leading-none text-white/48">
              {mutation
                ? `Gen ${mutation.generation} live — pick a survivor`
                : `${pressureLabel(amount)} · ${Math.round(amount * 100)}% · evolve or die`}
            </div>
          </div>
        </div>
        <div className="flex h-8 min-w-0 items-center gap-1.5">
          <button
            onClick={breed}
            className={`group relative h-8 min-w-0 flex-1 overflow-hidden rounded-md px-2.5 text-[10px] font-black uppercase tracking-[0.08em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-300/60 shadow-[0_0_16px_rgb(52_211_153/0.3)] hover:shadow-[0_0_22px_rgb(52_211_153/0.48)] ${
              mutation
                ? "bg-emerald-400/30 text-emerald-50 ring-1 ring-emerald-300/55"
                : "bg-emerald-500/18 text-emerald-100 hover:bg-emerald-500/32 ring-1 ring-emerald-400/40"
            }`}
            title="Breed two offspring of the current sound"
          >
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(167,243,208,0.35),transparent_55%)] opacity-70 group-hover:opacity-100 transition" />
            <span className="relative block truncate">{mutation ? "Breed" : "Mutate"}</span>
          </button>
          <div className="flex h-8 w-[5.25rem] shrink-0 items-center justify-center gap-1 rounded-md bg-black/25 ring-1 ring-emerald-400/20">
            <PressureKnob value={amount} onChange={(v) => act().setMutateAmount(v)} size={24} />
            <span className="flex flex-col items-start leading-none select-none" aria-hidden>
              <span className="fc-text-floor uppercase tracking-wider text-white/35">Mild</span>
              <span className="fc-text-floor mt-0.5 uppercase tracking-wider text-emerald-200/55">Wild</span>
            </span>
          </div>
          {mutation && (
            <div className="ml-0.5 flex shrink-0 items-center gap-1 border-l border-white/10 pl-1.5">
              {(["a", "b"] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => act().auditionMutation(w)}
                  className={`h-8 w-7 shrink-0 rounded-md text-[10px] font-black ${
                    mutation.listening === w
                      ? "bg-emerald-400/35 text-emerald-50 ring-1 ring-emerald-200/60"
                      : "bg-black/30 text-white/45 ring-1 ring-white/10 hover:text-white/80"
                  }`}
                  title={`Audition ${w.toUpperCase()}`}
                >
                  {w.toUpperCase()}
                </button>
              ))}
              <button
                onClick={() => {
                  act().commitMutation();
                  toast(`✓ Kept ${mutation.listening.toUpperCase()} — lineage Gen ${mutation.generation}.`);
                }}
                className="h-8 shrink-0 rounded-md bg-lime-400/20 px-1.5 text-[9px] font-black uppercase text-lime-100 ring-1 ring-lime-300/50"
                title="Keep winner"
              >
                Keep
              </button>
              <button
                onClick={() => {
                  act().discardMutation();
                  toast("↩ Round discarded — parent patch restored");
                }}
                className="h-8 w-7 shrink-0 rounded-md bg-black/25 text-[10px] text-white/45 ring-1 ring-white/10 hover:text-white/80"
                title="Discard round — restore the parent patch"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

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

          {genealogyTrail}

          <button
            onClick={breed}
            className={`group relative h-8 overflow-hidden rounded-xl border text-[11px] font-black uppercase tracking-[0.12em] transition truncate shadow-[0_0_16px_rgb(52_211_153/0.3)] hover:shadow-[0_0_22px_rgb(52_211_153/0.45)] ${
              mutation
                ? "border-emerald-300/70 bg-emerald-400/25 text-emerald-50 hover:bg-emerald-400/35"
                : "border-emerald-400/55 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/28"
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
                    <span className={`fc-text-floor relative block uppercase tracking-wider mt-0.5 ${live ? "text-emerald-100/70" : "text-white/30"}`}>
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
                title="Discard round — restore the parent patch"
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
