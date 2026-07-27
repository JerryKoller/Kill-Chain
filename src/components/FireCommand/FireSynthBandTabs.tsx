/**
 * Second-level Synth tabs: Home (Signal Path hub) + SRC / TONE / MOD / FX / MIX / PERF.
 */

import { FIRE_BANDS } from "./fireModuleAtlas";
import type { FireSynthBand } from "./useFireSynthBand";

const HOME_COLOR = "#ffbfa0";

export function FireSynthBandTabs({
  band,
  onChange,
}: {
  band: FireSynthBand;
  onChange: (b: FireSynthBand) => void;
}) {
  const hint =
    band === "home"
      ? "Signal Path · jump to any module"
      : (FIRE_BANDS.find((b) => b.id === band)?.hint ?? "");

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-xl border border-white/12 bg-black/35 p-1 gap-0.5">
          <button
            type="button"
            onClick={() => onChange("home")}
            className="px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] rounded-lg transition"
            style={
              band === "home"
                ? { background: `${HOME_COLOR}28`, color: HOME_COLOR, boxShadow: `0 0 14px ${HOME_COLOR}33` }
                : { color: "rgba(255,255,255,0.42)" }
            }
            title="Home — Signal Path and All Modules map"
          >
            Home
          </button>
          {FIRE_BANDS.map((b) => {
            const active = band === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onChange(b.id)}
                className="px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] rounded-lg transition"
                style={
                  active
                    ? { background: `${b.color}28`, color: b.color, boxShadow: `0 0 14px ${b.color}33` }
                    : { color: "rgba(255,255,255,0.42)" }
                }
                title={`${b.title} — ${b.hint}`}
              >
                {b.short}
              </button>
            );
          })}
        </div>
        <div className="min-w-0 text-[9px] text-white/40 truncate">{hint}</div>
      </div>
    </div>
  );
}
