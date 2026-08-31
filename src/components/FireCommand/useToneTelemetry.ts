/**
 * Shared live Tone envelope telemetry for StageViz cursors.
 *
 * The poll itself lives in `fireLiveBus` — one loop for the whole view rather
 * than one per consumer, and it only pushes when the envelopes actually move.
 */

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ToneVoiceTelemetry } from "@/audio/dsp/toneDifferentiation";
import { currentToneTelemetry, subscribeToneTelemetry } from "./fireLiveBus";

export function useToneTelemetry(_pollMs = 32): ToneVoiceTelemetry {
  const [tel, setTel] = useState<ToneVoiceTelemetry>(currentToneTelemetry);

  useEffect(() => subscribeToneTelemetry(setTel), []);

  return tel;
}

/**
 * Ref-based variant for canvas visualizers: telemetry lands in a ref with NO
 * React re-render. The env StageViz components paint from refs inside the
 * shared RAF anyway — routing 30 fps telemetry through setState made each of
 * them re-render on every tick of every note for nothing.
 */
export function useToneTelemetryRef(): MutableRefObject<ToneVoiceTelemetry> {
  const ref = useRef<ToneVoiceTelemetry>(currentToneTelemetry());
  useEffect(
    () =>
      subscribeToneTelemetry((t) => {
        ref.current = t;
      }),
    [],
  );
  return ref;
}
