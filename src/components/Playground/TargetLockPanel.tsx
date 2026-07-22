import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useUIStore } from "@/state/uiStore";
import { useRepairStore } from "@/state/repairStore";
import { measureLive } from "@/lib/tractorLive";
import type { TractorMeasurement } from "@/lib/tractorBeam";
import {
  loadReferenceFile,
  deriveTargetLock,
  applyTargetLock,
  type TargetLockPlan,
  type TargetLockSelection,
} from "@/lib/targetLock";

const ALL_ON: TargetLockSelection = {
  eq: true, hf: true, body: true, decrunch: true, clarity: true, width: true, deess: true,
};

/**
 * TARGET LOCK — reference matching for the Sculptor (v2.1).
 *
 * SOURCE = whatever is playing right now (measured live).
 * TARGET = a clean reference loaded from disk.
 * The gap between them becomes an explainable repair plan the user can
 * apply move-by-move, with before / predicted-after match percentages.
 */
export function TargetLockPanel() {
  const [open, setOpen] = useState(false);
  const toast = useUIStore((s) => s.toast);
  const reference = useRepairStore((s) => s.reference);
  const setReference = useRepairStore((s) => s.setReference);

  const [source, setSource] = useState<TractorMeasurement | null>(null);
  const [busy, setBusy] = useState<"ref" | "src" | null>(null);
  const [stage, setStage] = useState("");
  const [plan, setPlan] = useState<TargetLockPlan | null>(null);
  const [sel, setSel] = useState<TargetLockSelection>({ ...ALL_ON });
  const abortRef = useRef<AbortController | null>(null);

  const loadRef = async () => {
    if (busy) return;
    setBusy("ref");
    try {
      const ref = await loadReferenceFile((p) => setStage(p.stage));
      if (ref) {
        setReference(ref);
        setPlan(null);
        toast(`Target locked: "${ref.name}"`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load the reference");
    } finally {
      setBusy(null);
      setStage("");
    }
  };

  const measureSource = async () => {
    if (busy === "src") {
      abortRef.current?.abort();
      return;
    }
    if (busy) return;
    setBusy("src");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const m = await measureLive({
        seconds: 9,
        signal: ac.signal,
        onProgress: (p) => setStage(`${p.stage} ${Math.round(p.fraction * 100)}%`),
      });
      if (m.silent) {
        toast("Heard nothing — play the damaged source, then measure again");
      } else {
        setSource(m);
        toast("Source measured");
      }
    } catch {
      /* cancelled */
    } finally {
      setBusy(null);
      setStage("");
    }
  };

  const derive = () => {
    if (!source || !reference) return;
    const p = deriveTargetLock(source, reference.m);
    if (p.silent) {
      toast("Not enough overlap between source and target to compare");
      return;
    }
    setPlan(p);
    setSel({ ...ALL_ON });
    const repair = useRepairStore.getState();
    repair.setRefCurve(p.curve.length > 0 ? p.curve : null);
    repair.setMatch(p.matchBeforePct, p.matchAfterPct);
    if (p.srcCutoffHz !== null) repair.setCutoffHz(p.srcCutoffHz);
  };

  const apply = async () => {
    if (!plan) return;
    await applyTargetLock(plan, sel);
    toast(`Target Lock applied — predicted match ${plan.matchAfterPct}%`);
  };

  const hasMove = (id: string) => plan?.moves.some((m) => m.id === id) ?? false;
  const selKey = (id: string): keyof TargetLockSelection =>
    (id === "deess" ? "deess" : id) as keyof TargetLockSelection;

  return (
    <GlassPanel intense className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition"
      >
        <div className="text-left">
          <div className="text-xs uppercase tracking-[0.3em] text-dim flex items-center gap-2">
            Target Lock
            {reference && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan/20 text-cyan tracking-normal">
                REF LOADED
              </span>
            )}
          </div>
          <div className="text-base font-semibold">
            Reference match — make this sound like that
          </div>
        </div>
        <div className="text-sm text-cyan/80 font-mono">{open ? "\u25BC" : "\u25B6"}</div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-white/10"
          >
            <div className="p-5">
              {/* Two input slots */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-1.5">
                    Source · damaged
                  </div>
                  <button
                    onClick={() => void measureSource()}
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      busy === "src"
                        ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                        : "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {busy === "src" ? `◉ ${stage || "Listening…"} (cancel)` : source ? "↻ Re-measure what's playing" : "◉ Measure what's playing (~9 s)"}
                  </button>
                  <div className="text-[10px] text-white/45 mt-1.5">
                    {source ? "Measured — live capture off preTap." : "Play the poor-quality source, then measure."}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-1.5">
                    Target · reference
                  </div>
                  <button
                    onClick={() => void loadRef()}
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      busy === "ref"
                        ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                        : "border-cyan/40 bg-cyan/10 hover:bg-cyan/20 text-cyan"
                    }`}
                  >
                    {busy === "ref" ? `◉ ${stage || "Analyzing…"}` : reference ? `↻ ${reference.name}` : "⊕ Load a clean reference file"}
                  </button>
                  <div className="text-[10px] text-white/45 mt-1.5">
                    {reference ? "Whole file scanned offline (Welch average)." : "A good master of the same (or similar) material."}
                  </div>
                </div>
              </div>

              <button
                onClick={derive}
                disabled={!source || !reference || busy !== null}
                className={`mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-bold tracking-wide transition ${
                  source && reference && !busy
                    ? "border-fuchsia-400/50 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-300"
                    : "border-white/10 bg-white/[0.02] text-white/30 cursor-not-allowed"
                }`}
              >
                ⌖ MEASURE THE GAP
              </button>

              {/* Plan */}
              {plan && (
                <div className="mt-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <MatchDial label="Match now" pct={plan.matchBeforePct} color="#f43f5e" />
                    <div className="text-2xl text-white/30">→</div>
                    <MatchDial label="Predicted after" pct={plan.matchAfterPct} color="#34d399" />
                    <div className="text-[11px] text-white/55 leading-relaxed flex-1 min-w-[180px]">
                      {plan.srcCutoffHz !== null && plan.refCutoffHz !== null && (
                        <>Source reaches {(plan.srcCutoffHz / 1000).toFixed(1)} kHz, reference {(plan.refCutoffHz / 1000).toFixed(1)} kHz.<br /></>
                      )}
                      Loudness-weighted spectral match, Tractor-style. The overlay strip on the Repair Stack spectrogram shows the gap.
                    </div>
                  </div>

                  {plan.moves.length === 0 ? (
                    <div className="mt-3 text-sm text-white/60">
                      The source already sits close to the reference — nothing worth moving.
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      {plan.moves.map((mv) => (
                        <label
                          key={mv.id}
                          className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-black/25 px-3 py-2 cursor-pointer hover:border-white/20 transition"
                        >
                          <input
                            type="checkbox"
                            checked={sel[selKey(mv.id)]}
                            onChange={(e) =>
                              setSel((prev) => ({ ...prev, [selKey(mv.id)]: e.target.checked }))
                            }
                            className="mt-0.5 accent-cyan-400"
                          />
                          <div>
                            <div className="text-sm font-semibold text-white/90">{mv.label}</div>
                            <div className="text-[11px] text-white/60 leading-relaxed">{mv.detail}</div>
                          </div>
                        </label>
                      ))}
                      <button
                        onClick={() => void apply()}
                        disabled={!plan.moves.some((m) => sel[selKey(m.id)] && hasMove(m.id))}
                        className="mt-1 rounded-xl border border-cyan/50 bg-cyan/10 hover:bg-cyan/20 px-4 py-2.5 text-sm font-bold text-cyan transition"
                      >
                        ⌖ APPLY SELECTED MOVES
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}

function MatchDial({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-16 h-16 rounded-full grid place-items-center border-2"
        style={{
          borderColor: color,
          background: `conic-gradient(${color}44 ${pct * 3.6}deg, transparent 0deg)`,
          boxShadow: `0 0 18px ${color}33`,
        }}
      >
        <span className="text-sm font-bold font-mono" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="text-[10px] uppercase tracking-widest text-dim mt-1">{label}</div>
    </div>
  );
}
