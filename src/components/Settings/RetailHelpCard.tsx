import { GlassPanel } from "@/components/shared/GlassPanel";
import { FIRST_60_SECONDS_STEPS, FIRST_60_SECONDS_TERM } from "@/lib/retailHelp";
import { useUIStore } from "@/state/uiStore";

function Section({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/90">{title}</div>
      {sub && <div className="text-[11px] text-dim mt-1 leading-relaxed">{sub}</div>}
    </div>
  );
}

/** Compact retail help — add → hear → sculpt without a new surface. */
export function RetailHelpCard() {
  const openGlossary = useUIStore((s) => s.openGlossary);

  return (
    <GlassPanel intense className="p-5">
      <Section
        title="First 60 seconds"
        sub="The everyday loop — deeper explanations live in the Field Manual"
      />
      <ol className="mt-3 space-y-2.5">
        {FIRST_60_SECONDS_STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3 text-[12px] leading-relaxed">
            <span className="shrink-0 w-5 h-5 rounded-full border border-cyan/40 bg-cyan/10 text-cyan text-[10px] font-bold grid place-items-center">
              {i + 1}
            </span>
            <div>
              <div className="font-semibold text-white/90">{step.title}</div>
              <div className="text-dim mt-0.5">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openGlossary(FIRST_60_SECONDS_TERM)}
          className="kc-btn kc-btn--sm kc-btn--accent"
        >
          Open in Field Manual
        </button>
        <button
          type="button"
          onClick={() => openGlossary()}
          className="kc-btn kc-btn--sm kc-btn--ghost"
        >
          Browse Glossary
        </button>
      </div>
    </GlassPanel>
  );
}
