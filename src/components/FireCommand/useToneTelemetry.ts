/**
 * Shared live Tone envelope telemetry for StageViz cursors.
 */

import { useEffect, useRef, useState } from "react";
import { activeFireEngine } from "@/state/fireCommandStore";
import { idleTelemetry, type ToneVoiceTelemetry } from "@/audio/dsp/toneDifferentiation";

const IDLE: ToneVoiceTelemetry = {
  voiceCount: 0,
  amp: idleTelemetry(),
  mod: idleTelemetry(),
  filt: idleTelemetry(),
  pluck: idleTelemetry(),
};

export function useToneTelemetry(pollMs = 32): ToneVoiceTelemetry {
  const [tel, setTel] = useState<ToneVoiceTelemetry>(IDLE);
  const raf = useRef(0);

  useEffect(() => {
    let alive = true;
    let last = 0;
    const tick = (now: number) => {
      if (!alive) return;
      if (now - last >= pollMs) {
        last = now;
        try {
          const t = activeFireEngine().getToneTelemetry?.() ?? IDLE;
          setTel(t);
        } catch {
          setTel(IDLE);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
    };
  }, [pollMs]);

  return tel;
}
