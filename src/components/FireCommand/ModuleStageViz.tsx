/**
 * Stage visualizers for v3.0.2 module fill — each has a distinct personality.
 * Display only; audio lives in FireCommandSynth / store.
 */

import { useEffect, useRef, type ReactNode, type RefObject, type MutableRefObject } from "react";
import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import { useFireSequencerStore, NOTE_NAMES, SCALES } from "@/state/fireSequencerStore";
import { FC } from "./fireColors";

function useHiDpiCanvas(
  wrapRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  cssH: number,
  sizeRef: MutableRefObject<{ w: number; h: number }>,
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wrapRef, canvasRef, cssH, sizeRef]);
}

function Frame({
  children, border, height, wrapRef, radius = "rounded-xl",
}: {
  children: ReactNode; border: string; height: number;
  wrapRef: RefObject<HTMLDivElement | null>; radius?: string;
}) {
  return (
    <div
      ref={wrapRef as RefObject<HTMLDivElement>}
      className={`relative mb-2.5 overflow-hidden border bg-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${radius}`}
      style={{ borderColor: border, height }}
    >
      {children}
    </div>
  );
}

export { NoiseStageViz } from "./NoiseStageViz";
export { SubStageViz } from "./SubStageViz";

export { PluckStageViz } from "./PluckStageViz";

export { WidthStageViz } from "./WidthStageViz";
export { GlueStageViz } from "./GlueStageViz";
export { AirStageViz } from "./AirStageViz";

/** Constellation orbits -- Harmony (deep-dive lives in HarmonyStageViz). */
export { HarmonyStageViz } from "./HarmonyStageViz";

/** Piano-roll key lattice -- Scale Lock (deep-dive lives in ScaleStageViz). */
export { ScaleStageViz } from "./ScaleStageViz";

/** Stack vault -- Chord Memory (deep-dive lives in ChordStageViz). */
export { ChordStageViz } from "./ChordStageViz";

/** Feel grain -- Humanize (deep-dive lives in HumanStageViz). */
export { HumanStageViz } from "./HumanStageViz";

/** Orbit vault -- Scenes (deep-dive lives in ScenesStageViz). */
export { ScenesStageViz } from "./ScenesStageViz";

export { FmRackStageViz } from "./FmRackStageViz";
