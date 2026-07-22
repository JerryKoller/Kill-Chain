import { useMissionStateStore } from "@/state/missionStateStore";
import { useAppHealthStore } from "@/lib/appHealth";
import { useAudioStore } from "@/state/audioStore";

/**
 * Mission HUD (v2.4) — the always-visible one-line status strip under the
 * title bar. Answers three questions at a glance:
 *
 *   1. What source is Mission State tracking?
 *   2. What did the automation pipeline do (or what is it doing right now)?
 *   3. Is anything broken that needs the user's attention?
 *
 * Health issues render as red/amber chips with their one-click fix.
 */

const PENDING_LABEL: Record<string, string> = {
  settling: "SETTLING",
  restoring: "RESTORING",
  scanning: "SCANNING",
  flattening: "FLATTENING",
};

const APPLIED_LABEL: Record<string, { text: string; cls: string }> = {
  manual: { text: "MANUAL", cls: "text-amber-300/90 border-amber-300/30" },
  memory: { text: "MEMORY", cls: "text-cyan border-cyan/30" },
  lock: { text: "LOCK", cls: "text-cyan border-cyan/30" },
  "auto-lock": { text: "AUTO-LOCK", cls: "text-cyan border-cyan/30" },
  "auto-flatten": { text: "FLATTENED", cls: "text-white/60 border-white/20" },
};

export function MissionHUD() {
  const source = useMissionStateStore((s) => s.source);
  const pendingOp = useMissionStateStore((s) => s.pendingOp);
  const appliedBy = useMissionStateStore((s) => s.appliedBy);
  const lastAction = useMissionStateStore((s) => s.lastAction);
  const issues = useAppHealthStore((s) => s.issues);
  const engaged = useAudioStore((s) => !s.bypass);

  const applied = appliedBy ? APPLIED_LABEL[appliedBy] : null;

  return (
    <div className="h-6 px-4 flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] border-b border-white/[0.06] bg-black/30 select-none shrink-0">
      <span className="text-dim">Mission</span>
      <span
        className={`font-semibold truncate max-w-[280px] ${source ? "text-white/80" : "text-white/30"}`}
        title={lastAction ?? undefined}
      >
        {source ? source.title || source.sig : "No source"}
      </span>

      {pendingOp && (
        <span className="px-1.5 py-px rounded border border-cyan/40 text-cyan animate-pulse">
          {PENDING_LABEL[pendingOp] ?? pendingOp}
        </span>
      )}
      {!pendingOp && applied && (
        <span
          className={`px-1.5 py-px rounded border ${applied.cls}`}
          title={lastAction ?? undefined}
        >
          {applied.text}
        </span>
      )}

      <span className={`ml-1 ${engaged ? "text-emerald-400/80" : "text-white/30"}`}>
        {engaged ? "Chain engaged" : "Bypass"}
      </span>

      {/* Health issues — pushed right, each with its one-click fix. */}
      <div className="ml-auto flex items-center gap-2 min-w-0">
        {issues.map((issue) => (
          <span
            key={issue.id}
            title={issue.detail}
            className={`flex items-center gap-1.5 px-1.5 py-px rounded border truncate ${
              issue.severity === "error"
                ? "border-plasma/50 text-plasma bg-plasma/10"
                : "border-amber-300/40 text-amber-300 bg-amber-300/5"
            }`}
          >
            <span className="truncate">{issue.title}</span>
            {issue.actionLabel && issue.action && (
              <button
                onClick={() => void issue.action?.()}
                className="underline decoration-dotted hover:text-white shrink-0"
              >
                {issue.actionLabel}
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
