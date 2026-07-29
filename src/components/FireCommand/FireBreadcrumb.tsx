/**
 * FireBreadcrumb — the console utility strip.
 * Left: SYNTH / SOURCE / OSCILLATOR A hierarchy path.
 * Right: master meter (slot) · density · label mode · accordion · exit.
 */

import type { ReactNode } from "react";
import { useFireCommandStore, type FireLabelMode } from "@/state/fireCommandStore";
import { useFireLayout } from "./FireLayoutContext";
import { FIRE_BANDS, FIRE_MODULE_BY_ID } from "./fireModuleAtlas";
import type { FireWorkspace } from "./useFireWorkspace";
import type { FireSynthBand } from "./useFireSynthBand";

export function FireBreadcrumb({
  workspace,
  synthBand,
  meter,
}: {
  workspace: FireWorkspace;
  synthBand: FireSynthBand;
  /** Inline master-meter slot (rendered in the right control cluster). */
  meter?: ReactNode;
}) {
  const { focusId, exitFocus, focusActive } = useFireLayout();
  const density = useFireCommandStore((s) => s.fireUiDensity);
  const exitDensity = useFireCommandStore((s) => s.exitFireFocusDensity);
  const labelMode = useFireCommandStore((s) => s.labelMode);
  const setLabelMode = useFireCommandStore((s) => s.setLabelMode);
  const accordionMode = useFireCommandStore((s) => s.accordionMode);
  const setAccordionMode = useFireCommandStore((s) => s.setAccordionMode);

  const modeLabel = workspace === "sequencer" ? "Sequencer" : "Synth";
  let sectionLabel = "Home";
  if (workspace === "sequencer") sectionLabel = "Arrangement";
  else if (synthBand !== "home") {
    sectionLabel = FIRE_BANDS.find((b) => b.id === synthBand)?.title ?? synthBand;
  }

  const mod = focusId ? FIRE_MODULE_BY_ID.get(focusId) : null;
  let objectLabel: string | null = null;
  if (mod) {
    if (labelMode === "character") objectLabel = mod.short;
    else objectLabel = mod.title; // technical + both — canonical name leads
  }

  const labelModes: { id: FireLabelMode; label: string; hint: string }[] = [
    { id: "character", label: "Char", hint: "Character nicknames" },
    { id: "technical", label: "Tech", hint: "Canonical technical names" },
    { id: "both", label: "Both", hint: "Technical + character" },
  ];

  return (
    <div className="fc-utility-strip shrink-0">
      <div className="fc-breadcrumb">
        <span>{modeLabel}</span>
        <span className="fc-crumb-sep" aria-hidden>/</span>
        <span>{sectionLabel}</span>
        {objectLabel && (
          <>
            <span className="fc-crumb-sep" aria-hidden>/</span>
            <strong>{objectLabel}</strong>
            {labelMode === "both" && mod && mod.short !== mod.title && (
              <span className="fc-text-telemetry normal-case tracking-normal">· {mod.short}</span>
            )}
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2.5 flex-wrap">
        {meter}
        {meter && <span className="fc-strip-divider" aria-hidden />}
        <FireDensityToggle />
        <span className="fc-strip-divider" aria-hidden />
        <div className="fc-density-toggle" role="group" aria-label="Module label mode">
          {labelModes.map((m) => (
            <button
              key={m.id}
              type="button"
              data-on={labelMode === m.id ? "1" : "0"}
              onClick={() => setLabelMode(m.id)}
              title={`Labels · ${m.hint}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="fc-density-toggle" role="group" aria-label="Accordion mode">
          <button
            type="button"
            data-on={accordionMode ? "1" : "0"}
            onClick={() => setAccordionMode(!accordionMode)}
            aria-pressed={accordionMode}
            title={
              accordionMode
                ? "Accordion on — opening a module folds the others (pinned stay). Click to turn off."
                : "Accordion off — modules open independently. Click to turn on."
            }
          >
            Accordion
          </button>
        </div>
        {(focusActive || density === "focus") && (
          <button
            type="button"
            className="rounded-md border border-[#ff6a3d]/40 bg-[#ff6a3d]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffbfa0] hover:bg-[#ff6a3d]/20 transition"
            onClick={() => {
              exitFocus();
              if (density === "focus") exitDensity();
            }}
            title={focusActive ? "Exit Δ Focus — show all modules" : "Exit Focus density — restore chrome"}
          >
            {focusActive ? "Exit Δ" : "Exit Focus"}
          </button>
        )}
      </div>
    </div>
  );
}

export function FireDensityToggle() {
  const density = useFireCommandStore((s) => s.fireUiDensity);
  const setDensity = useFireCommandStore((s) => s.setFireUiDensity);
  const modes = [
    { id: "studio" as const, label: "Studio", hint: "Full chrome" },
    { id: "compact" as const, label: "Compact", hint: "Trimmed header + hints" },
    { id: "focus" as const, label: "Focus", hint: "Work area only" },
  ];
  return (
    <div className="fc-density-toggle" role="group" aria-label="Interface density">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          data-on={density === m.id ? "1" : "0"}
          onClick={() => setDensity(m.id)}
          title={`${m.label} density — ${m.hint}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
