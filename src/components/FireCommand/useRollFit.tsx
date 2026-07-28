/**
 * Fit-to-width step sizing for the piano roll / velocity / automation lanes.
 * zoom = 1 fills the host; zoom > 1 reveals horizontal scroll for detail.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

type RollFitValue = {
  hostRef: RefObject<HTMLDivElement | null>;
  viewportW: number;
  gutter: number;
  /** Pixels per 16th-note step (fits host when zoom === 1). */
  cellW: number;
  /** Full piano-roll canvas width including key gutter. */
  gridW: number;
  zoom: number;
  setZoom: (z: number | ((prev: number) => number)) => void;
  bumpZoom: (factor: number) => void;
  fitMode: boolean;
};

const RollFitContext = createContext<RollFitValue | null>(null);

export function RollFitProvider({
  totalSteps,
  gutter,
  children,
}: {
  totalSteps: number;
  gutter: number;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState(0);
  const [zoom, setZoomRaw] = useState(1);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setViewportW(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Changing bar count: snap back to fit so the pattern still fills the bay.
  useEffect(() => {
    setZoomRaw(1);
  }, [totalSteps]);

  const setZoom = useCallback((z: number | ((prev: number) => number)) => {
    setZoomRaw((prev) => {
      const next = typeof z === "function" ? z(prev) : z;
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    });
  }, []);

  const bumpZoom = useCallback(
    (factor: number) => setZoom((z) => z * factor),
    [setZoom],
  );

  const value = useMemo((): RollFitValue => {
    const steps = Math.max(1, totalSteps);
    const usable = Math.max(0, viewportW - gutter);
    // Fallback until first measure so first paint isn't a zero-width flash.
    const fitCell = usable > 0 ? usable / steps : 26;
    const cellW = fitCell * zoom;
    // Always derive grid from gutter + cells so paint/hit share one geometry
    // (avoid viewportW vs content-box drift from borders/padding).
    const snappedCell =
      zoom <= 1.001 && usable > 0 ? usable / steps : cellW;
    const gridW = gutter + steps * snappedCell;
    return {
      hostRef,
      viewportW,
      gutter,
      cellW: snappedCell,
      gridW,
      zoom,
      setZoom,
      bumpZoom,
      fitMode: zoom <= 1.001,
    };
  }, [totalSteps, gutter, viewportW, zoom, setZoom, bumpZoom]);

  return (
    <RollFitContext.Provider value={value}>
      <div ref={hostRef} className="w-full min-w-0">
        {children}
      </div>
    </RollFitContext.Provider>
  );
}

export function useRollFit(): RollFitValue {
  const ctx = useContext(RollFitContext);
  if (!ctx) {
    throw new Error("useRollFit must be used inside RollFitProvider");
  }
  return ctx;
}

/** Optional hook for lanes that may render outside the provider (graceful). */
export function useRollFitOptional(): RollFitValue | null {
  return useContext(RollFitContext);
}

export const ROLL_ZOOM_MIN = ZOOM_MIN;
export const ROLL_ZOOM_MAX = ZOOM_MAX;
