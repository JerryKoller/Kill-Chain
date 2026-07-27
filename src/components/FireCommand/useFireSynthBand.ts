/**
 * Synth band tab within the Synth workspace: Home (Signal Path) or a module band.
 */

import { useCallback, useEffect, useState } from "react";
import type { FireBandId } from "./fireModuleAtlas";

export type FireSynthBand = "home" | FireBandId;

export const FIRE_SYNTH_BAND_KEY = "killchain.fire.synthBand";
export const FIRE_SYNTH_BAND_EVENT = "killchain.fire.synthBand";

const VALID = new Set<string>([
  "home",
  "band.sources",
  "band.tone",
  "band.mod",
  "band.fx",
  "band.mix",
  "band.perf",
]);

function readBand(): FireSynthBand {
  try {
    const raw = window.localStorage.getItem(FIRE_SYNTH_BAND_KEY);
    if (raw && VALID.has(raw)) return raw as FireSynthBand;
  } catch { /* quota */ }
  return "home";
}

export function writeFireSynthBand(band: FireSynthBand): void {
  try {
    window.localStorage.setItem(FIRE_SYNTH_BAND_KEY, band);
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(FIRE_SYNTH_BAND_EVENT, { detail: { band } }));
}

export function useFireSynthBand(): [FireSynthBand, (band: FireSynthBand) => void] {
  const [band, setBand] = useState<FireSynthBand>(() =>
    typeof window !== "undefined" ? readBand() : "home",
  );

  useEffect(() => {
    const onExt = (e: Event) => {
      const detail = (e as CustomEvent<{ band: FireSynthBand }>).detail;
      if (detail?.band && VALID.has(detail.band)) setBand(detail.band);
    };
    window.addEventListener(FIRE_SYNTH_BAND_EVENT, onExt);
    return () => window.removeEventListener(FIRE_SYNTH_BAND_EVENT, onExt);
  }, []);

  const set = useCallback((next: FireSynthBand) => {
    setBand(next);
    writeFireSynthBand(next);
  }, []);

  return [band, set];
}
