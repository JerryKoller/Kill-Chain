import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useAudioStore } from "@/state/audioStore";
import type { SoundParams } from "@/audio/types";

export interface PreviewSession {
  /** Gate for the live-preview effect — only preview once the user interacts. */
  startedRef: MutableRefObject<boolean>;
  /** Begin previewing — call from the first real user interaction. */
  start: () => void;
  /** Keep the current sound when leaving — call from Apply / Commit actions. */
  commit: () => void;
  /**
   * Preview a partial (or full) patch: starts the session, tracks touched
   * keys, and writes through audioStore.previewParams.
   */
  push: (next: Partial<SoundParams>) => void;
  /** Mark keys as owned by this session without writing (MorphLab RAF path). */
  touch: (keys: Iterable<keyof SoundParams>) => void;
}

/**
 * Shared logic for "live preview" tabs (Morph Lab, Presets blend, Calibration).
 *
 * Opening such a tab must NOT change the sound on its own, and leaving it
 * without committing must restore exactly what was playing before — but ONLY
 * for keys this session actually touched, so concurrent Mission / Tractor /
 * Sculptor writes to other keys survive the leave.
 */
export function usePreviewSession(): PreviewSession {
  const baselineRef = useRef<{ params: SoundParams; bypass: boolean } | null>(null);
  const startedRef = useRef(false);
  const committedRef = useRef(false);
  const touchedRef = useRef<Set<keyof SoundParams>>(new Set());

  useEffect(() => {
    const a = useAudioStore.getState();
    baselineRef.current = { params: { ...a.params }, bypass: a.bypass };
    return () => {
      // Nothing to undo if the user never previewed or already committed.
      if (committedRef.current || !startedRef.current || !baselineRef.current) return;
      const audio = useAudioStore.getState();
      const base = baselineRef.current.params;
      const touched = touchedRef.current;
      if (touched.size === 0) {
        // Legacy full-snapshot path (session started but no keys recorded).
        audio.previewParams(base);
      } else {
        const restore: Partial<SoundParams> = {};
        for (const k of touched) restore[k] = base[k];
        audio.previewParams(restore);
      }
      if (audio.bypass !== baselineRef.current.bypass) {
        audio.setBypass(baselineRef.current.bypass);
      }
    };
  }, []);

  const touch = (keys: Iterable<keyof SoundParams>) => {
    for (const k of keys) touchedRef.current.add(k);
  };

  return {
    startedRef,
    start: () => {
      startedRef.current = true;
    },
    commit: () => {
      committedRef.current = true;
    },
    touch,
    push: (next) => {
      startedRef.current = true;
      touch(Object.keys(next) as (keyof SoundParams)[]);
      useAudioStore.getState().previewParams(next);
    },
  };
}
