/**
 * FireBand — category shell for Fire Command modules (v2.5.8 / v2.6.5 focus).
 *
 * When the band is folded, only the band header shows.
 * When open, collapsed modules appear as equal-width chips;
 * expanded modules stack full-width (never side-by-side — that
 * crushes mixers / pads / scopes when several are open).
 *
 * Focus mode: if another band's module is focused, this band hides.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useFireCollapsed } from "./useFireCollapsed";
import { CollapseToggle } from "./CollapseToggle";
import { ASLEEP_STATE, AsleepBadge } from "./ModuleEnableToggle";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FIRE_BANDS, type FireBandId } from "./fireModuleAtlas";
import { ensureExpanded, setBandModulesFolded, writeFold } from "./fireNavigate";
import { useFireLayout } from "./FireLayoutContext";
import { FireBandLabel } from "./FireSegTabs";

export type BandModuleMeta = {
  id: string;
  /** Technical name — "Oscillator A". Shown in `technical` label mode. */
  title: string;
  /** Character nickname — "Osc A". Shown in `character` / `both` label mode. */
  short: string;
  color: string;
  collapsed: boolean;
  toggle: () => void;
};

type BandActions = {
  register: (meta: BandModuleMeta) => void;
  unregister: (id: string) => void;
};

/** Stable actions — register effects must NOT re-fire when module map updates. */
const BandActionsContext = createContext<BandActions | null>(null);
/** Module map for chips / group-header visibility (updates freely). */
const BandModsContext = createContext<Record<string, BandModuleMeta>>({});

/** Sections / panels call this so the parent band can render chips. */
export function useFireBandRegister(
  id: string | undefined,
  title: string,
  color: string,
  collapsed: boolean,
  toggle: () => void,
  enabled: boolean,
  /** Character nickname; defaults to the title when a module has no separate one. */
  short?: string,
) {
  const band = useContext(BandActionsContext);
  useLayoutEffect(() => {
    if (!band || !id || !enabled) return;
    band.register({ id, title, short: short ?? title, color, collapsed, toggle });
    return () => band.unregister(id);
    // Intentionally omit `band` — actions are stable; including a changing
    // context value here caused React #185 (register ↔ setMods ↔ new ctx loop).
  }, [band, id, title, short, color, collapsed, toggle, enabled]);
}

/**
 * Group headers (Mix Routing / Perf Control, …) use this so labels + bars
 * only render when at least one module in the group is expanded — matching
 * Modulation’s clean collapsed chip row.
 */
export function useBandAnyExpanded(ids: readonly string[]): boolean {
  const mods = useContext(BandModsContext);
  const { isFocused } = useFireLayout();
  if (ids.some((id) => isFocused(id))) return true;
  return ids.some((id) => {
    const m = mods[id];
    return !!m && !m.collapsed;
  });
}

function ChipGrid({ modules }: { modules: BandModuleMeta[] }) {
  const moduleEnable = useFireCommandStore((s) => s.patch.moduleEnable);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const labelMode = useFireCommandStore((s) => s.labelMode);
  const shown = modules.filter((m) => m.collapsed || moduleEnable?.[m.id] === false);
  if (shown.length === 0) return null;
  // Prefer even atlas-width grids (7 modules → 7 equal chips) so every band
  // reads as a symmetric row rather than a ragged 3× wrap. Below ~1100px that
  // crushes labels, so halve the row (7 → 4+3) and drop to 2-up when tiny.
  const n = shown.length;
  const cols = n <= 7 ? n : 4;
  return (
    <div
      className="fc-band-chips mb-2"
      style={
        {
          "--fc-chip-cols": String(cols),
          "--fc-chip-cols-md": String(Math.min(4, Math.ceil(n / 2))),
        } as CSSProperties
      }
    >
      {shown.map((m) => {
        const awake = moduleEnable?.[m.id] !== false;
        // Both mode keeps the tight character label and parks the technical
        // name in the tooltip — a chip has no room for two names.
        const label = labelMode === "technical" ? m.title : m.short;
        const alt = m.short === m.title ? "" : labelMode === "technical" ? ` (${m.short})` : ` (${m.title})`;
        const sleepNote = awake ? "" : ` — ${ASLEEP_STATE} (Signal Path Off)`;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              if (!awake) {
                setModuleEnable(m.id, true);
                if (m.collapsed) m.toggle();
                return;
              }
              m.toggle();
            }}
            className={`fc-focus relative flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition hover:bg-white/[0.06] ${awake ? "" : "fc-asleep"}`}
            style={{
              borderColor: awake ? `${m.color}44` : "rgba(255,255,255,0.12)",
              background: awake
                ? `linear-gradient(160deg, ${m.color}18, transparent)`
                : "linear-gradient(160deg, rgba(0,0,0,0.45), transparent)",
              boxShadow: awake
                ? `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 12px ${m.color}14`
                : undefined,
            }}
            title={awake ? `Expand ${label}${alt}` : `Wake ${label}${alt}${sleepNote}`}
            aria-label={awake ? `Expand ${label}` : `Wake ${label}${sleepNote}`}
            aria-expanded={false}
          >
            <CollapseToggle collapsed color={awake ? m.color : "rgba(255,255,255,0.35)"} />
            <span
              className="text-[10px] font-black uppercase tracking-[0.06em] truncate"
              style={{ color: awake ? m.color : "rgba(255,255,255,0.4)" }}
            >
              {label}
            </span>
            {!awake && <AsleepBadge compact className="fc-chip-zzz absolute right-1 top-1" />}
          </button>
        );
      })}
    </div>
  );
}

/** Open modules always get the full band width — no multi-column squeeze. */
function openStackClass(): string {
  return "flex flex-col gap-2 min-w-0";
}

export function FireBand({
  title,
  color,
  bandKey,
  defaultCollapsed = false,
  hint,
  children,
  /** When false (band tab mode), skip fold chrome — the tab already selected the category. */
  foldable = true,
  /** Sit inside the Synth console — no outer GlassPanel card. */
  flush = false,
}: {
  title: string;
  color: string;
  bandKey: string;
  defaultCollapsed?: boolean;
  hint?: string;
  children: ReactNode;
  foldable?: boolean;
  flush?: boolean;
}) {
  const [bandCollapsed, toggleBand] = useFireCollapsed(bandKey, foldable ? defaultCollapsed : false);
  const [mods, setMods] = useState<Record<string, BandModuleMeta>>({});
  const { focusId, focusActive } = useFireLayout();

  const bandMeta = FIRE_BANDS.find((b) => b.id === bandKey);
  const bandModuleIds = useMemo(
    () => new Set((bandMeta?.modules ?? []).map((m) => m.id)),
    [bandMeta],
  );
  const holdsFocus = !!(focusId && bandModuleIds.has(focusId));

  const hiddenByFocus = focusActive && !holdsFocus;

  useEffect(() => {
    if (holdsFocus || !foldable) ensureExpanded(bandKey);
  }, [holdsFocus, bandKey, foldable]);

  const register = useCallback((meta: BandModuleMeta) => {
    setMods((prev) => {
      const cur = prev[meta.id];
      if (
        cur &&
        cur.title === meta.title &&
        cur.short === meta.short &&
        cur.color === meta.color &&
        cur.collapsed === meta.collapsed &&
        cur.toggle === meta.toggle
      ) {
        return prev;
      }
      return { ...prev, [meta.id]: meta };
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setMods((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const actions = useMemo(() => ({ register, unregister }), [register, unregister]);

  const list = Object.values(mods);
  const openCount = list.filter((m) => !m.collapsed).length;

  if (hiddenByFocus) return null;

  const showBody = !foldable || holdsFocus || !bandCollapsed;

  const inner = (
    <>
      <div className={`flex items-center justify-between gap-2 ${showBody ? "mb-2" : ""}`}>
        {foldable ? (
          <button
            type="button"
            onClick={toggleBand}
            aria-expanded={showBody}
            className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            title={showBody ? `Collapse ${title}` : `Expand ${title}`}
          >
            <CollapseToggle collapsed={!showBody} color={color} />
            {/* Same band-header tier as FireBandLabel (the non-foldable branch). */}
            <span
              className="text-[12px] font-black uppercase tracking-[0.2em]"
              style={{ color }}
            >
              {title}
            </span>
            {hint && (
              <span className="hidden sm:inline text-[9px] normal-case tracking-normal text-white/30">
                · {hint}
              </span>
            )}
            {holdsFocus && (
              <span
                className="fc-text-floor rounded-md border px-1.5 py-0.5 font-black uppercase tracking-[0.06em]"
                style={{ borderColor: `${color}66`, color, background: `${color}18` }}
              >
                Solo
              </span>
            )}
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <FireBandLabel
              title={title}
              color={color}
              hint={hint}
              right={
                holdsFocus ? (
                  <span
                    className="fc-text-floor rounded-md border px-1.5 py-0.5 font-black uppercase tracking-[0.06em]"
                    style={{ borderColor: `${color}66`, color, background: `${color}18` }}
                  >
                    Solo
                  </span>
                ) : undefined
              }
            />
          </div>
        )}
        {showBody && list.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {!foldable && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      const pinned = useFireCommandStore.getState().pinnedModules;
                      const band = FIRE_BANDS.find((b) => b.id === bandKey);
                      if (!band) return;
                      for (const mod of band.modules) {
                        const keepOpen =
                          pinned.includes(mod.id) || (!!focusId && mod.id === focusId);
                        writeFold(mod.id, !keepOpen);
                      }
                      return;
                    }
                    setBandModulesFolded(bandKey, false);
                  }}
                  className="rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/55 hover:bg-white/[0.08] hover:text-white/80 transition"
                  title="Expand all (Shift: pinned or soloed only)"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={() => setBandModulesFolded(bandKey, true)}
                  className="rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/55 hover:bg-white/[0.08] hover:text-white/80 transition"
                  title="Collapse all modules to chips"
                >
                  Collapse all
                </button>
              </>
            )}
            <span className="text-[9px] font-mono text-white/30">
              {openCount}/{list.length} open
            </span>
          </div>
        )}
      </div>

      {showBody && (
        <>
          {!holdsFocus && <ChipGrid modules={list} />}
          <div className={openStackClass()}>
            {children}
          </div>
        </>
      )}
    </>
  );

  return (
    <BandActionsContext.Provider value={actions}>
      <BandModsContext.Provider value={mods}>
        {flush ? (
          <div
            className="relative bg-gradient-to-b from-white/[0.025] to-transparent p-2.5"
            data-fire-band={bandKey as FireBandId}
            style={{ boxShadow: `inset 3px 0 0 0 ${color}55` }}
          >
            {inner}
          </div>
        ) : (
          <GlassPanel
            intense
            className="p-2.5"
            data-fire-band={bandKey as FireBandId}
          >
            {inner}
          </GlassPanel>
        )}
      </BandModsContext.Provider>
    </BandActionsContext.Provider>
  );
}
