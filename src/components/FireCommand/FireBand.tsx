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
  type ReactNode,
} from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useFireCollapsed } from "./useFireCollapsed";
import { CollapseToggle } from "./CollapseToggle";
import { FIRE_BANDS, type FireBandId } from "./fireModuleAtlas";
import { ensureExpanded } from "./fireNavigate";
import { useFireLayout } from "./FireLayoutContext";
import { FireBandLabel } from "./FireSegTabs";

export type BandModuleMeta = {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  toggle: () => void;
};

type BandContextValue = {
  register: (meta: BandModuleMeta) => void;
  unregister: (id: string) => void;
};

const BandContext = createContext<BandContextValue | null>(null);

/** Sections / panels call this so the parent band can render chips. */
export function useFireBandRegister(
  id: string | undefined,
  title: string,
  color: string,
  collapsed: boolean,
  toggle: () => void,
  enabled: boolean,
) {
  const band = useContext(BandContext);
  useLayoutEffect(() => {
    if (!band || !id || !enabled) return;
    band.register({ id, title, color, collapsed, toggle });
    return () => band.unregister(id);
  }, [band, id, title, color, collapsed, toggle, enabled]);
}

function ChipGrid({ modules }: { modules: BandModuleMeta[] }) {
  if (modules.length === 0) return null;
  // Prefer even atlas-width grids (7 modules → 7 equal chips) so every band
  // reads as a symmetric row rather than a ragged 3× wrap.
  const n = modules.length;
  const cols =
    n <= 4 ? n :
    n === 5 ? 5 :
    n === 6 ? 6 :
    n === 7 ? 7 :
    4;
  return (
    <div
      className="mb-2 grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {modules.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={m.toggle}
          className="flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          style={{
            borderColor: `${m.color}44`,
            background: `linear-gradient(160deg, ${m.color}18, transparent)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 12px ${m.color}14`,
          }}
          title={`Expand ${m.title}`}
          aria-expanded={false}
        >
          <CollapseToggle collapsed color={m.color} />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.16em] truncate"
            style={{ color: m.color }}
          >
            {m.title}
          </span>
        </button>
      ))}
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
}: {
  title: string;
  color: string;
  bandKey: string;
  defaultCollapsed?: boolean;
  hint?: string;
  children: ReactNode;
  foldable?: boolean;
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

  const ctx = useMemo(() => ({ register, unregister }), [register, unregister]);

  const list = Object.values(mods);
  const collapsedList = list.filter((m) => m.collapsed);
  const openCount = list.filter((m) => !m.collapsed).length;

  if (hiddenByFocus) return null;

  const showBody = !foldable || holdsFocus || !bandCollapsed;

  return (
    <BandContext.Provider value={ctx}>
      <GlassPanel
        intense
        className="p-2.5"
        data-fire-band={bandKey as FireBandId}
      >
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
              <span
                className="text-[12px] font-semibold uppercase tracking-[0.22em]"
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
                  className="rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                  style={{ borderColor: `${color}66`, color, background: `${color}18` }}
                >
                  Focus
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
                      className="rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                      style={{ borderColor: `${color}66`, color, background: `${color}18` }}
                    >
                      Focus
                    </span>
                  ) : undefined
                }
              />
            </div>
          )}
          {showBody && list.length > 0 && (
            <span className="text-[9px] font-mono text-white/30">
              {openCount}/{list.length} open
            </span>
          )}
        </div>

        {showBody && (
          <>
            {!holdsFocus && <ChipGrid modules={collapsedList} />}
            <div className={openStackClass()}>
              {children}
            </div>
          </>
        )}
      </GlassPanel>
    </BandContext.Provider>
  );
}
