/**
 * FireBreadcrumb — global application utility strip.
 * LEFT: location breadcrumb · CENTER: Fire meter · RIGHT: presentation controls
 */

import type { ReactNode } from "react";
import { useFireCommandStore, type FireLabelMode } from "@/state/fireCommandStore";
import { useFireLayout } from "./FireLayoutContext";
import { FIRE_BANDS, FIRE_MODULE_BY_ID, FIRE_MODULES } from "./fireModuleAtlas";
import { FIRE_PALETTE_EVENT } from "./FireCommandPalette";
import { jumpToModule } from "./fireNavigate";
import { writeFireWorkspace } from "./useFireWorkspace";
import { writeFireSynthBand } from "./useFireSynthBand";
import type { FireWorkspace } from "./useFireWorkspace";
import type { FireSynthBand } from "./useFireSynthBand";

/**
 * Live module budget readout.
 *
 * Presets and Natural Selection now sleep every module a patch doesn't use,
 * which is a large performance win but invisible without this: it shows how
 * many of the 42 modules are awake and gives one click to wake everything
 * back up, so a slept module never feels like a mystery.
 */
function FireModuleBudget() {
  const moduleEnable = useFireCommandStore((s) => s.patch.moduleEnable);
  const setParam = useFireCommandStore((s) => s.setParam);
  const total = FIRE_MODULES.length;
  const asleep = FIRE_MODULES.filter((m) => moduleEnable?.[m.id] === false);
  const awake = total - asleep.length;
  const tight = asleep.length > 0;
  return (
    <div className="fc-module-budget" role="group" aria-label="Module budget">
      <span
        className="fc-module-budget__count"
        title={
          tight
            ? `${awake} of ${total} modules awake. Asleep: ${asleep.map((m) => m.title).join(", ")}`
            : `All ${total} modules awake`
        }
      >
        <strong>{awake}</strong>
        <span aria-hidden>/</span>
        {total}
        <span className="fc-module-budget__unit"> mod</span>
      </span>
      {tight && (
        <button
          type="button"
          className="fc-module-budget__wake fc-focus"
          onClick={() => setParam("moduleEnable", {})}
          title={`Wake all ${asleep.length} sleeping modules`}
        >
          Wake all
        </button>
      )}
    </div>
  );
}

/**
 * Discoverability affordance for the command palette.
 *
 * Ctrl/Cmd+K opened the only cross-band launcher in the app, but it was bound
 * purely in code — no button, no hint, nothing in the chrome. A first-time
 * user had no way to learn the single most useful navigation shortcut.
 */
function FireJumpHint() {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
  return (
    <button
      type="button"
      className="fc-jump-hint fc-focus"
      onClick={() => window.dispatchEvent(new CustomEvent(FIRE_PALETTE_EVENT))}
      title="Jump to any module or parameter (Ctrl/Cmd + K)"
    >
      <span className="fc-jump-hint__label">Jump</span>
      <kbd>{mac ? "⌘" : "Ctrl"}</kbd>
      <kbd>K</kbd>
    </button>
  );
}

export function FireBreadcrumb({
  workspace,
  synthBand,
  meter,
}: {
  workspace: FireWorkspace;
  synthBand: FireSynthBand;
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
    else objectLabel = mod.title;
  }

  const labelModes: { id: FireLabelMode; label: string; hint: string }[] = [
    { id: "character", label: "Char", hint: "Character nicknames" },
    { id: "technical", label: "Tech", hint: "Canonical technical names" },
    { id: "both", label: "Both", hint: "Technical + character" },
  ];

  return (
    <div className="fc-utility-strip shrink-0" role="navigation" aria-label="Application status">
      <div className="fc-utility-strip__left">
        {/* Breadcrumb NAVIGATES now. It used to be read-only text while the
            band tabs and command deck did the navigating — so the one element
            that tells you where you are was the one element that couldn't
            take you anywhere. */}
        <div className="fc-breadcrumb" aria-label={`Location: ${modeLabel} / ${sectionLabel}`}>
          <button
            type="button"
            className="fc-crumb-link"
            onClick={() => writeFireWorkspace(workspace === "sequencer" ? "synth" : "sequencer")}
            title={workspace === "sequencer" ? "Go to Synth" : "Go to Sequencer"}
          >
            {modeLabel}
          </button>
          <span className="fc-crumb-sep" aria-hidden>/</span>
          <button
            type="button"
            className="fc-crumb-link"
            onClick={() => {
              writeFireWorkspace("synth");
              // Clicking the section returns to the band overview (Home shows
              // the full 42-module map).
              writeFireSynthBand(synthBand === "home" ? "home" : synthBand);
              if (synthBand === "home") return;
              writeFireSynthBand("home");
            }}
            title={synthBand === "home" ? "Synth home" : "Back to Home (all modules)"}
          >
            {sectionLabel}
          </button>
          {objectLabel && mod && (
            <>
              <span className="fc-crumb-sep" aria-hidden>/</span>
              <button
                type="button"
                className="fc-crumb-link fc-crumb-link--strong"
                onClick={() => jumpToModule(mod.id)}
                title={`Scroll to ${mod.title}`}
              >
                {objectLabel}
              </button>
              {labelMode === "both" && mod.short !== mod.title && (
                <span className="fc-text-telemetry normal-case tracking-normal">· {mod.short}</span>
              )}
            </>
          )}
        </div>
        <FireModuleBudget />
        <FireJumpHint />
      </div>

      <div className="fc-utility-strip__center">
        {meter}
      </div>

      <div className="fc-utility-strip__right">
        <div className="fc-utility-strip__pres" role="group" aria-label="Workspace presentation">
          <FireDensityToggle />
          <span className="fc-strip-divider" aria-hidden />
          <div className="fc-density-toggle" role="radiogroup" aria-label="Module label mode">
            {labelModes.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={labelMode === m.id}
                data-on={labelMode === m.id ? "1" : "0"}
                onClick={() => setLabelMode(m.id)}
                title={`Labels · ${m.hint}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="fc-strip-divider" aria-hidden />
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
              className="rounded-md border border-[#ff6a3d]/40 bg-[#ff6a3d]/10 px-2 h-7 text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffbfa0] hover:bg-[#ff6a3d]/20 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
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
    <div className="fc-density-toggle" role="radiogroup" aria-label="Interface density">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={density === m.id}
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
