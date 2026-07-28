/**
 * Second-level Synth tabs: Home (Signal Path hub) + SRC / TONE / MOD / FX / MIX / PERF.
 */

import { FIRE_BANDS } from "./fireModuleAtlas";
import type { FireSynthBand } from "./useFireSynthBand";
import { FireSegTabs } from "./FireSegTabs";

const HOME_COLOR = "#ffbfa0";

export function FireSynthBandTabs({
  band,
  onChange,
  flush = false,
}: {
  band: FireSynthBand;
  onChange: (b: FireSynthBand) => void;
  flush?: boolean;
}) {
  const items = [
    { id: "home" as const, label: "Home", color: HOME_COLOR, title: "Home — Signal Path and All Modules map" },
    ...FIRE_BANDS.map((b) => ({
      id: b.id as FireSynthBand,
      label: b.short,
      color: b.color,
      title: `${b.title} — ${b.hint}`,
    })),
  ];

  const active = band === "home"
    ? { hint: "Signal Path hub", detail: "Jump to any module · On/Off · Solo" }
    : (() => {
        const b = FIRE_BANDS.find((x) => x.id === band);
        return { hint: b?.title ?? "", detail: b?.hint ?? "" };
      })();

  return (
    <FireSegTabs
      items={items}
      value={band}
      onChange={onChange}
      hint={active.hint}
      hintDetail={active.detail}
      size="sm"
      flush={flush}
    />
  );
}
