/**
 * One canvas hook for every stage visualizer.
 *
 * Replaces ~50 hand-rolled `useHiDpi` copies and adds the thing none of them
 * had: an IntersectionObserver, so a visualizer that is scrolled out of view,
 * inside a collapsed section, or on an inactive band tab stops painting
 * entirely instead of animating into a canvas nobody can see.
 *
 * Feed `visibleRef.current` into the RAF loop's `visible` hint.
 */

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

export type StageCanvas = {
  /** Attach to the framing element — sized/observed for width + visibility. */
  wrapRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  /** CSS pixel size the paint code should use (transform already scaled). */
  sizeRef: MutableRefObject<{ w: number; h: number }>;
  /** False when off-screen / display:none — gate painting on this. */
  visibleRef: MutableRefObject<boolean>;
};

/** Cap DPR: a 3x canvas costs 2.25× the fill of a 2x one for no visible gain. */
const MAX_DPR = 2;

export function useStageCanvas(cssHeight: number): StageCanvas {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 420, h: cssHeight });
  // Assume visible until the observer reports — a first paint is cheaper than
  // a blank panel on mount.
  const visibleRef = useRef(true);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastW = -1;
    let lastDpr = -1;
    const sync = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      sizeRef.current = { w: cssW, h: cssHeight };
      // Reassigning canvas.width clears the bitmap, so only touch it on a real
      // change — a ResizeObserver can fire with identical dimensions.
      if (cssW === lastW && dpr === lastDpr) return;
      lastW = cssW;
      lastDpr = dpr;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(wrap);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visibleRef.current = e.isIntersecting;
      },
      // Start painting slightly before it scrolls into view so nothing pops in.
      { rootMargin: "96px" },
    );
    io.observe(wrap);

    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [cssHeight]);

  return { wrapRef, canvasRef, sizeRef, visibleRef };
}
