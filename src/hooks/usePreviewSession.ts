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
}

/**
 * Shared logic for "live preview" tabs (Morph Lab, Presets blend).
 *
 * Opening such a tab must NOT change the sound on its own, and leaving it
 * without committing must restore exactly what was playing before. This
 * snapshots the audio state when the tab mounts and reverts it on unmount
 * unless the preview was explicitly committed. Live previews are gated behind
 * `startedRef` so merely viewing the tab is silent until the user interacts.
 */
export function usePreviewSession(): PreviewSession {
  const baselineRef = useRef<{ params: SoundParams; bypass: boolean } | null>(null);
  const startedRef = useRef(false);
  const committedRef = useRef(false);

  useEffect(() => {
    const a = useAudioStore.getState();
    baselineRef.current = { params: { ...a.params }, bypass: a.bypass };
    return () => {
      // Nothing to undo if the user never previewed or already committed.
      if (committedRef.current || !startedRef.current || !baselineRef.current) return;
      const audio = useAudioStore.getState();
      audio.previewParams(baselineRef.current.params);
      if (audio.bypass !== baselineRef.current.bypass) {
        audio.setBypass(baselineRef.current.bypass);
      }
    };
  }, []);

  return {
    startedRef,
    start: () => {
      startedRef.current = true;
    },
    commit: () => {
      committedRef.current = true;
    },
  };
}
