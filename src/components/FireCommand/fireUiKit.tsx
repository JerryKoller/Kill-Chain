/**
 * Shared Fire Command UI primitives.
 *
 * FireCommandView.tsx grew to ~15.8k lines, and the reason it could not be
 * split is that every one of its ~50 panels depends on primitives declared
 * INSIDE it (Section, FParamKnob, the value formatters). Moving a panel out
 * would have imported back into the view — a cycle.
 *
 * This module holds those primitives so panels can be lifted out file by
 * file, each importing from here instead of from the view. It deliberately
 * imports nothing from FireCommandView.
 */

import { useEffect, type ReactNode } from "react";
import type { FirePatch } from "@/audio/dsp/FireCommandSynth";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { FC } from "./fireColors";
import { FIRE_BANDS, FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";
import { ModuleBackdrop } from "./ModuleBackdrop";
import { useFireCollapsed } from "./useFireCollapsed";
import { useFireBandRegister } from "./FireBand";
import { useFireLayout } from "./FireLayoutContext";
import { ensureExpanded, foldStorageKey, writeFold } from "./fireNavigate";
import { ASLEEP_STATE, AsleepBadge } from "./ModuleEnableToggle";
import { CollapseToggle } from "./CollapseToggle";

/** Patch keys whose value is a number — the set Dial-backed knobs can bind. */
export type NumericKey = {
  [K in keyof FirePatch]: FirePatch[K] extends number ? K : never;
}[keyof FirePatch];

// ── Band accent shorthands ──
export const FIRE = FC.fire; // mix / destination coral
export const ICE = FC.lfo; // modulation sky
export const GRN = FC.envAmp; // envelope lime (Tone)

// ── Value formatters (shared by every knob / readout) ──
export const fmtHz = (v: number) =>
  (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${Math.round(v)}`);
export const fmtSec = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
export const fmtBi = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
export const fmtCents = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}¢`;
export const fmtSemi = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}st`;
export const fmtRatio = (v: number) => `${v.toFixed(2)}×`;
export const fmtOct = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : ""}${v}`);
export const fmtQ = (v: number) => v.toFixed(1);
export const fmtBpm = (v: number) => `${Math.round(v)}`;
export const fmtInt = (v: number) => `${Math.round(v)}`;
export const fmtHzRate = (v: number) => `${v.toFixed(2)}Hz`;

export function useCollapsed(key: string | undefined, def: boolean): [boolean, () => void] {
  return useFireCollapsed(key, def);
}

/* NOTE: FParamKnob deliberately stays in FireCommandView for now — it wraps
   `Dial`, which is still declared there. Moving Dial here is the next step of
   the split; until then a kit-side FParamKnob would import back into the view
   and create a cycle. */

/** Collapsible module card — the frame every Fire Command panel renders into. */
export function Section({
  title, color = FIRE, right, children, className, collapseKey,
  defaultCollapsed = false, chipHosted = false, statusLine,
}: {
  title: string; color?: string; right?: ReactNode; children: ReactNode; className?: string;
  /** When set, the section header toggles fold state (persisted under this key). */
  collapseKey?: string; defaultCollapsed?: boolean;
  /** When true inside a FireBand, collapsed sections disappear (chips show instead). */
  chipHosted?: boolean;
  /** Optional collapsed-card status (model, mods, lock). */
  statusLine?: string;
}) {
  const [collapsed, toggle] = useCollapsed(collapseKey, defaultCollapsed);
  const { focusActive, focusId, isFocused, enterFocus } = useFireLayout();
  const accordionMode = useFireCommandStore((s) => s.accordionMode);
  const pinnedModules = useFireCommandStore((s) => s.pinnedModules);
  const toggleModulePin = useFireCommandStore((s) => s.toggleModulePin);
  const toggleModuleLock = useFireCommandStore((s) => s.toggleModuleLock);
  const locked = useFireCommandStore((s) => !!(collapseKey && s.moduleLocks[collapseKey]));
  const moduleAwake = useFireCommandStore((s) =>
    !collapseKey ? true : s.patch.moduleEnable?.[collapseKey] !== false,
  );
  const atlas = collapseKey ? FIRE_MODULE_BY_ID.get(collapseKey) : undefined;
  const labelMode = useFireCommandStore((s) => s.labelMode);
  // Register both name forms so the band chips can honor labelMode too.
  useFireBandRegister(
    collapseKey,
    atlas?.title ?? title,
    color,
    collapsed,
    toggle,
    !!chipHosted && !!collapseKey,
    atlas?.short ?? title,
  );

  const displayTitle =
    labelMode === "character" && atlas ? atlas.short
      : labelMode === "technical" && atlas ? atlas.title
        : title;

  // Focus mode: keep the soloed module forced open
  useEffect(() => {
    if (collapseKey && isFocused(collapseKey) && collapsed) {
      ensureExpanded(collapseKey);
    }
  }, [collapseKey, collapsed, isFocused]);

  const onToggle = () => {
    if (!collapseKey) {
      toggle();
      return;
    }
    const opening = collapsed;
    if (opening && accordionMode && !pinnedModules.includes(collapseKey)) {
      // Smart accordion: collapse other non-pinned modules in the same band.
      const band = atlas?.bandKey;
      if (band) {
        const entry = FIRE_BANDS.find((b) => b.id === band);
        for (const mod of entry?.modules ?? []) {
          if (mod.id === collapseKey) continue;
          if (pinnedModules.includes(mod.id)) continue;
          // Already collapsed — skip the storage write + event fan-out.
          try {
            if (window.localStorage.getItem(foldStorageKey(mod.id)) === "1") continue;
          } catch { /* storage unavailable — fold anyway */ }
          writeFold(mod.id, true);
        }
      }
    }
    toggle();
  };

  // Hide non-focused modules while focus mode is on
  if (focusActive && collapseKey && focusId !== collapseKey) return null;

  if (chipHosted && collapseKey && collapsed && !isFocused(collapseKey)) return null;

  const open = !collapsed || isFocused(collapseKey);
  // Atlas subtitles fall back to the short name — only surface real ones.
  const subtitle =
    atlas?.subtitle && atlas.subtitle !== atlas.short && atlas.subtitle !== atlas.title
      ? atlas.subtitle
      : null;
  const asleepStatus = !moduleAwake
    ? `${ASLEEP_STATE} — press Wake here, on the Signal Path, or on the Command Map`
    : null;

  return (
    <GlassPanel
      className={`fc-mod-card transition-[opacity,filter] ${!moduleAwake ? "fc-asleep" : ""} ${className ?? ""}`}
      data-fire-module={collapseKey || undefined}
      data-fire-asleep={!moduleAwake ? "1" : undefined}
    >
      <ModuleBackdrop moduleId={collapseKey} color={color} awake={moduleAwake} />
      <div className="fc-mod-content-well">
      <div className={`flex items-center justify-between gap-2 min-w-0 ${open ? "mb-1.5" : ""}`}>
        {collapseKey ? (
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-2 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 min-w-0"
            title={collapsed ? "Expand section" : "Collapse section"}
          >
            <CollapseToggle collapsed={!open} color={moduleAwake ? color : "rgba(255,255,255,0.35)"} />
            <span
              className="fc-text-primary font-semibold uppercase tracking-[0.18em] truncate"
              style={{ color: moduleAwake ? color : "rgba(255,255,255,0.42)" }}
            >
              {displayTitle}
            </span>
            {!moduleAwake && <AsleepBadge />}
            {locked && <span className="fc-lock-badge" title="Protected from Random Armory / mutation">LOCK</span>}
          </button>
        ) : (
          <div className="fc-text-primary font-semibold uppercase tracking-[0.18em] truncate min-w-0" style={{ color }}>{displayTitle}</div>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Pin / Lock / Solo only on the open card — collapsed headers stay quiet. */}
          {collapseKey && open && (
            <>
              <button
                type="button"
                className="fc-pin-btn rounded border border-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
                data-on={pinnedModules.includes(collapseKey) ? "1" : "0"}
                title="Pin — stay open when accordion expands another module"
                onClick={(e) => { e.stopPropagation(); toggleModulePin(collapseKey); }}
              >
                Pin
              </button>
              <button
                type="button"
                className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-[#f5d9a8]"
                title="Lock against Random Armory / mutation"
                onClick={(e) => { e.stopPropagation(); toggleModuleLock(collapseKey); }}
              >
                {locked ? "Unlock" : "Lock"}
              </button>
              {!isFocused(collapseKey) && (
                <button
                  type="button"
                  className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
                  title="Solo this module — hide the others"
                  onClick={(e) => { e.stopPropagation(); enterFocus(collapseKey as FireModuleId); }}
                >
                  Solo
                </button>
              )}
            </>
          )}
          {open && right ? <div className="max-w-[55%] overflow-x-auto">{right}</div> : null}
        </div>
      </div>
      {!open && (asleepStatus || statusLine || subtitle) && (
        <div className="fc-text-secondary mt-1 truncate opacity-80">
          {asleepStatus ?? statusLine ?? subtitle}
        </div>
      )}
      {open && children}
      </div>
    </GlassPanel>
  );
}

export function KnobRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-evenly gap-1">{children}</div>;
}
