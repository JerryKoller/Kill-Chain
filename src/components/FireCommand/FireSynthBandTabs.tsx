/**
 * Second-level Synth tabs: Home (Signal Path hub) + SRC / TONE / MOD / FX / MIX / PERF.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
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
  // Band tabs were identical regardless of what was actually running inside
  // them. With presets sleeping modules for performance, a band could be
  // entirely inert and look exactly like a busy one. Badge = awake count.
  const moduleEnable = useFireCommandStore((s) => s.patch.moduleEnable);
  const items = [
    { id: "home" as const, label: "Home", color: HOME_COLOR, title: "Home — Signal Path and All Modules map" },
    ...FIRE_BANDS.map((b) => {
      const awake = b.modules.filter((m) => moduleEnable?.[m.id] !== false).length;
      const asleep = b.modules.length - awake;
      return {
        id: b.id as FireSynthBand,
        label: b.short,
        color: b.color,
        badge: awake,
        dim: awake === 0,
        title: asleep > 0
          ? `${b.title} — ${b.hint} · ${awake}/${b.modules.length} modules awake`
          : `${b.title} — ${b.hint} · all ${b.modules.length} modules awake`,
      };
    }),
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
