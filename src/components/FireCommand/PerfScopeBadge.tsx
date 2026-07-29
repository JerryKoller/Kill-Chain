/**
 * Compact SCOPE: LIVE · SEQUENCER · BAKED badge for Performance modules.
 */

import {
  formatPerfScope,
  PERF_MODULE_SCOPES,
  PERF_SCOPE_HINT,
  type PerfModuleScopeId,
} from "@/audio/dsp/perfClarity";
import { FC_BAND } from "./fireColors";

export function PerfScopeBadge({ moduleId }: { moduleId: PerfModuleScopeId }) {
  const scopes = PERF_MODULE_SCOPES[moduleId];
  const hint = scopes.map((s) => PERF_SCOPE_HINT[s]).join(" · ");
  const c = FC_BAND.perf;
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5"
      style={{ borderColor: `${c}40`, background: `${c}14` }}
      title={hint}
    >
      <span className="text-[8px] font-black uppercase tracking-[0.18em]" style={{ color: `${c}88` }}>
        Scope
      </span>
      <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color: `${c}dd` }}>
        {formatPerfScope(scopes)}
      </span>
    </div>
  );
}
