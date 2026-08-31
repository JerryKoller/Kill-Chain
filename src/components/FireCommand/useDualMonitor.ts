/**
 * Dual-monitor layout for Fire Command.
 *
 * Goal: synth on one monitor, sequencer on the other. Implemented by spanning
 * the SINGLE app window across two side-by-side displays and splitting the
 * layout on the physical bezel — not by opening a second BrowserWindow.
 *
 * A second window would get its own renderer process, and therefore its own
 * AudioContext and AudioEngine. It could not share the audio graph with the
 * main window, so the sequencer over there would be editing state that a
 * different engine was playing. Making that work means mirroring the whole
 * sequencer store across processes and forwarding every mutation. Spanning one
 * window reaches the same end state with one engine and no state sync.
 *
 * The seam offset comes from the main process (the real bezel position), so on
 * mismatched monitor widths the split still lands on the physical edge rather
 * than at an arbitrary 50%.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "killchain.fire.dualMonitor";

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  isCurrent: boolean;
}

export interface DualMonitorState {
  /**
   * True when the sequencer is expanded onto a second display: the window
   * spans both, ONLY the sequencer occupies the right one, and everything else
   * (title bar, sidebar, synth, keyboard, transport) is confined to the left.
   *
   * An earlier variant split Synth | Sequencer down the middle but left the
   * keyboard and transport spanning both screens, which put controls across
   * the bezel. It was removed rather than kept as a second mode.
   */
  active: boolean;
  /** Distance in CSS px from the window's left edge to the bezel. */
  seamPx: number;
  /** Width of the right region (the second display), from the main process. */
  rightPx: number;
  /** Connected displays, left to right. */
  displays: DisplayInfo[];
  /** Whether spanning is even possible (desktop app + 2 side-by-side screens). */
  available: boolean;
  /** Why spanning is unavailable, for the button tooltip. */
  reason: string | null;
  /** Expand the sequencer onto `targetId` (default: nearest other display). */
  span: (targetId?: number) => Promise<void>;
  /** Collapse back to one screen, restoring the previous window bounds. */
  unspan: () => Promise<void>;
  /** Move the whole window onto one display (no expansion). */
  moveTo: (targetId: number) => Promise<void>;
  toggle: () => Promise<void>;
}

export function useDualMonitor(): DualMonitorState {
  const [active, setActive] = useState(false);
  const [seamPx, setSeamPx] = useState(0);
  /**
   * Right-region width, taken from the main process rather than derived from
   * `window.innerWidth`.
   *
   * The window resize is asynchronous: right after `span()` resolves,
   * innerWidth is still the OLD (single-screen) value, so
   * `innerWidth - seamPx` went negative and clamped to zero. The layout then
   * ran with no right region at all — the synth stretched across both
   * displays on the FIRST expand and only corrected itself after enough
   * dock/undock cycles happened to re-run the effect with a fresh width.
   */
  const [rightPx, setRightPx] = useState(0);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [reason, setReason] = useState<string | null>(null);

  const api = typeof window !== "undefined" ? window.playground?.displays : undefined;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setDisplays(await api.list());
    } catch { /* main process not ready */ }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Latest seam without making the resize listener depend on it (it would
  // re-bind on every geometry change).
  const seamPxRef = useRef(seamPx);
  seamPxRef.current = seamPx;

  // Re-measure on resize: the user can drag the window off the span, and a
  // monitor can be unplugged while spanned.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      void refresh();
      setActive((cur) => {
        if (!cur) return cur;
        // Spanned windows are wider than any single display; if the window has
        // been dragged back onto one screen the expanded layout must stop or
        // the sequencer would sit off-screen.
        const stillSpanned =
          window.innerWidth > 1.4 * Math.max(1, window.screen.availWidth * 0.75);
        if (!stillSpanned) return false;
        // Still spanned but the geometry moved (monitor resolution change, DPI
        // change, the user dragged an edge). Re-derive the right region from
        // the real width so the two halves can never drift apart — this is
        // what previously left the layout stuck in a wrong state until a few
        // dock/undock cycles happened to fix it.
        setRightPx((prevRight) => {
          const nextRight = Math.max(0, window.innerWidth - seamPxRef.current);
          return Math.abs(nextRight - prevRight) > 2 ? nextRight : prevRight;
        });
        return true;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [refresh]);

  const span = useCallback(async (targetId?: number) => {
    if (!api) { setReason("Desktop app only"); return; }
    const res = await api.span(targetId);
    if (!res.ok) {
      setReason(res.reason ?? "Could not span displays");
      setActive(false);
      return;
    }
    setReason(null);
    const totalW = res.bounds?.width ?? window.innerWidth;
    const seam = res.seamX ?? Math.floor(totalW / 2);
    setSeamPx(seam);
    setRightPx(Math.max(0, totalW - seam));
    setActive(true);
    try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* quota */ }
    void refresh();
  }, [api, refresh]);

  const unspan = useCallback(async () => {
    if (!api) return;
    await api.unspan();
    setActive(false);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* quota */ }
    void refresh();
  }, [api, refresh]);

  const moveTo = useCallback(async (targetId: number) => {
    if (!api) return;
    await api.moveTo(targetId);
    setActive(false);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* quota */ }
    void refresh();
  }, [api, refresh]);

  const toggle = useCallback(async () => {
    if (active) await unspan(); else await span();
  }, [active, span, unspan]);

  // Drive the layout from the document so non-Fire chrome (title bar, sidebar,
  // transport dock) can be constrained to the left display by CSS alone,
  // without every one of those components needing to know about this mode.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const clear = () => {
      delete document.body.dataset.fcSnap;
      root.style.removeProperty("--fc-snap-w");
      root.style.removeProperty("--fc-left-w");
    };
    if (!active) { clear(); return clear; }
    document.body.dataset.fcSnap = "right";
    root.style.setProperty("--fc-snap-w", `${rightPx}px`);
    root.style.setProperty("--fc-left-w", `${seamPx}px`);
    return clear;
  }, [active, seamPx, rightPx]);

  // Restore a spanned layout on boot. Deliberately does NOT move the window —
  // the OS already restored its bounds; this only re-derives the seam so the
  // split renders in the right place.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      let wanted = false;
      try { wanted = window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* private mode */ }
      if (!wanted) return;
      const list = await api.list().catch(() => [] as DisplayInfo[]);
      if (cancelled || list.length < 2) return;
      // Only re-span if the window still covers more than one display.
      const covered = list.filter((d) => window.innerWidth > d.workArea.width * 1.2).length;
      if (covered === 0) return;
      await span();
    })();
    return () => { cancelled = true; };
  }, [api, span]);

  const available = !!api && displays.length >= 2;

  return {
    active,
    seamPx,
    rightPx,
    displays,
    available,
    reason: reason ?? (!api ? "Desktop app only" : displays.length < 2 ? "Only one display detected" : null),
    span,
    unspan,
    moveTo,
    toggle,
  };
}
