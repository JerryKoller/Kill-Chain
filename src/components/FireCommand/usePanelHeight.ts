/**
 * Persisted, drag-resizable panel height.
 *
 * The sequencer stacks Patterns, Arrangement, Piano Roll, Velocity and
 * Automation vertically. Two of those had no give: the arrangement's viewport
 * was hard-sized to `MAX_PLAYLIST_TRACKS × laneH` (ten tracks, ~390 px) whether
 * or not ten tracks existed, and the piano roll's height was draggable but
 * reset to 360 px on every mount. Stacked on one display — especially the
 * second monitor, where the sequencer has the full height to itself — the lower
 * lanes got squeezed off the bottom.
 *
 * `AutomationLane` already implemented exactly this pattern inline; this is the
 * same behaviour factored out so every resizable section persists identically.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export interface PanelHeight {
  height: number;
  /** Bind to a grab handle's onPointerDown. */
  onResizeStart: (e: React.PointerEvent) => void;
  /** True while dragging, for handle styling. */
  dragging: boolean;
  reset: () => void;
}

export function usePanelHeight(
  storageKey: string,
  defaultH: number,
  minH: number,
  maxH: number,
): PanelHeight {
  const read = useCallback((): number => {
    if (typeof window === "undefined") return defaultH;
    try {
      const v = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(v) && v > 0) return clamp(Math.round(v), minH, maxH);
    } catch { /* private mode */ }
    return defaultH;
  }, [storageKey, defaultH, minH, maxH]);

  const [height, setHeight] = useState(read);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  // Re-clamp if the bounds change (fullscreen raises the ceiling).
  useEffect(() => {
    setHeight((h) => clamp(h, minH, maxH));
  }, [minH, maxH]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startY: e.clientY, startH: height };
    setDragging(true);
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setHeight(clamp(Math.round(d.startH + (ev.clientY - d.startY)), minH, maxH));
    };
    // Persist on release, not per move: a drag is ~60 writes a second and
    // localStorage is synchronous.
    const onUp = () => {
      drag.current = null;
      setDragging(false);
      try { el.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setHeight((h) => {
        try { window.localStorage.setItem(storageKey, String(h)); } catch { /* quota */ }
        return h;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [height, minH, maxH, storageKey]);

  const reset = useCallback(() => {
    setHeight(defaultH);
    try { window.localStorage.removeItem(storageKey); } catch { /* quota */ }
  }, [defaultH, storageKey]);

  return { height, onResizeStart, dragging, reset };
}
