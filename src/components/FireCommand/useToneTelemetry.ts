/**
 * Shared live Tone envelope telemetry for StageViz cursors.
 *
 * The poll itself lives in `fireLiveBus` — one loop for the whole view rather
 * than one per consumer, and it only pushes when the envelopes actually move.
 */

import { useEffect, useState } from "react";
import type { ToneVoiceTelemetry } from "@/audio/dsp/toneDifferentiation";
import { currentToneTelemetry, subscribeToneTelemetry } from "./fireLiveBus";

export function useToneTelemetry(_pollMs = 32): ToneVoiceTelemetry {
  const [tel, setTel] = useState<ToneVoiceTelemetry>(currentToneTelemetry);

  useEffect(() => subscribeToneTelemetry(setTel), []);

  return tel;
}
