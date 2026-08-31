import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAudioStore } from "@/state/audioStore";
import type { SoundParams } from "@/audio/types";

/**
 * XY morph pad — drag to sculpt two sonic axes at once:
 *   X: Warm / Bassy  ←→  Bright / Clear
 *   Y: Tight / Punchy ←→  Wide / Spacious
 *
 * `onInteract` fires the moment the user grabs the pad — hosts that wrap the
 * sound in a preview session (e.g. Morph Lab) use it to mark the change as a
 * real commit so it isn't reverted on navigation.
 */
export function MorphPad({ onInteract }: { onInteract?: () => void } = {}) {
  const params = useAudioStore((s) => s.params);
  const setParams = useAudioStore((s) => s.setParams);
  const padRef = useRef<HTMLDivElement>(null);
  // Ref mirror: setState is async, so early pointermoves after pointerdown
  // were dropped and the pad ignored the first pixels of every drag.
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // Derive pad position from current params (rough inverse of applyAt)
  const x = clamp(
    (params.clarity + params.air + params.sparkle - params.warmth - params.bass) / 3,
    -1,
    1,
  );
  const y = clamp(
    (params.width + params.spatial + params.reverbAmount - params.punch - params.compression) / 3,
    -1,
    1,
  );

  const applyAt = useCallback(
    (nx: number, ny: number) => {
      const partial: Partial<SoundParams> = {};
      // X axis
      const warm = clamp(-nx, -1, 1);
      const bright = clamp(nx, -1, 1);
      partial.warmth = warm * 0.6;
      partial.bass = warm * 0.4;
      partial.clarity = bright * 0.5;
      partial.air = bright * 0.35;
      partial.sparkle = bright * 0.25;
      // Y axis
      const tight = clamp(-ny, -1, 1);
      const wide = clamp(ny, -1, 1);
      partial.punch = tight * 0.5;
      partial.compression = tight * 0.3;
      partial.width = wide * 0.55;
      partial.spatial = wide * 0.35;
      partial.reverbAmount = wide * 0.2;
      setParams(partial);
    },
    [setParams],
  );

  const pointerToNorm = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const nx = clamp(((clientX - r.left) / r.width) * 2 - 1, -1, 1);
    const ny = clamp(1 - ((clientY - r.top) / r.height) * 2, -1, 1);
    return { x: nx, y: ny };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    onInteract?.();
    draggingRef.current = true;
    setDragging(true);
    const { x: nx, y: ny } = pointerToNorm(e.clientX, e.clientY);
    applyAt(nx, ny);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const { x: nx, y: ny } = pointerToNorm(e.clientX, e.clientY);
    applyAt(nx, ny);
  };
  const onUp = (e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    draggingRef.current = false;
    setDragging(false);
  };

  const dotX = ((x + 1) / 2) * 100;
  const dotY = ((1 - y) / 2) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-dim">
        <span>Warm</span>
        <span className="text-cyan">Morph Pad</span>
        <span>Bright</span>
      </div>
      <div
        ref={padRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => { onInteract?.(); applyAt(0, 0); }}
        className="relative aspect-square w-full max-w-[220px] mx-auto rounded-2xl border border-white/12 bg-black/40 cursor-crosshair overflow-hidden select-none touch-none"
        style={{
          boxShadow: dragging
            ? "0 0 40px rgba(34,232,255,0.25), inset 0 0 60px rgba(122,59,255,0.08)"
            : "inset 0 0 40px rgba(122,59,255,0.05)",
        }}
      >
        {/* Grid */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "radial-gradient(circle at 20% 80%, rgba(255,182,72,0.35), transparent 50%)," +
                "radial-gradient(circle at 80% 20%, rgba(34,232,255,0.35), transparent 50%)," +
                "radial-gradient(circle at 80% 80%, rgba(72,255,209,0.25), transparent 50%)," +
                "radial-gradient(circle at 20% 20%, rgba(255,91,138,0.25), transparent 50%)",
            }}
          />
        </div>
        <div className="absolute left-2 bottom-2 text-[9px] text-dim pointer-events-none">Tight</div>
        <div className="absolute left-2 top-2 text-[9px] text-dim pointer-events-none">Wide</div>

        <motion.div
          className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full pointer-events-none"
          style={{
            left: `${dotX}%`,
            top: `${dotY}%`,
            background: "radial-gradient(circle at 35% 35%, #fff, #22e8ff 60%, #7a3bff)",
            boxShadow: "0 0 20px #22e8ff, 0 0 40px rgba(122,59,255,0.5)",
            border: "2px solid rgba(255,255,255,0.9)",
          }}
          animate={{ scale: dragging ? 1.25 : 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        />
      </div>
      <p className="text-[10px] text-dim text-center leading-snug">
        Drag to morph tone & space · double-click to reset axes
      </p>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
