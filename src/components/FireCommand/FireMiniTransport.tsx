/**
 * Slim transport for the Synth workspace — hear the song while tweaking the patch.
 * Brass / amber ordnance theme — distinct from the fire→emerald command rail
 * and the violet/cyan workspace switcher.
 */

import { useFireSequencerStore, type PlayScope } from "@/state/fireSequencerStore";

const BRASS = "#e8b86d";
const BRASS_SOFT = "#f5d9a8";
const BRASS_GLOW = "rgba(232,184,109,0.35)";

const SCOPE_OPTS: { id: PlayScope; label: string }[] = [
  { id: "pattern", label: "Pattern" },
  { id: "arrangement", label: "Arrangement" },
  { id: "selection", label: "Selection" },
];

function scopeLabel(scope: PlayScope): string {
  if (scope === "selection") return "Selection";
  if (scope === "arrangement") return "Arrangement";
  return "Pattern";
}

export function FireMiniTransport({ flush = false }: { flush?: boolean }) {
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const bars = useFireSequencerStore((s) => s.bars);
  const noteCount = useFireSequencerStore((s) => s.notes.length);
  const synthEnabled = useFireSequencerStore((s) => s.synthEnabled);
  const synthBEnabled = useFireSequencerStore((s) => s.synthBEnabled);
  const drumsEnabled = useFireSequencerStore((s) => s.drumsEnabled);
  const playScope = useFireSequencerStore((s) => s.playScope);
  const togglePlay = useFireSequencerStore((s) => s.togglePlay);
  const setPlayScope = useFireSequencerStore((s) => s.setPlayScope);
  const setSynthEnabled = useFireSequencerStore((s) => s.setSynthEnabled);
  const setSynthBEnabled = useFireSequencerStore((s) => s.setSynthBEnabled);
  const setDrumsEnabled = useFireSequencerStore((s) => s.setDrumsEnabled);

  const scopeName = scopeLabel(playScope);

  const channels = [
    {
      key: "a",
      label: "A",
      title: "Layer A — arm / mute Synth A",
      on: synthEnabled,
      toggle: () => setSynthEnabled(!synthEnabled),
      accent: "#ff8f6b",
      soft: "#ffd0c0",
    },
    {
      key: "b",
      label: "B",
      title: "Layer B — arm / mute Synth B",
      on: synthBEnabled,
      toggle: () => setSynthBEnabled(!synthBEnabled),
      accent: "#7dd3fc",
      soft: "#e0f2fe",
    },
    {
      key: "drm",
      label: "DRM",
      title: "Layer Drums — arm / mute drums",
      on: drumsEnabled,
      toggle: () => setDrumsEnabled(!drumsEnabled),
      accent: "#bef264",
      soft: "#ecfccb",
    },
  ] as const;

  return (
    <div
      className={`relative overflow-hidden ${flush ? "" : "rounded-2xl"}`}
      style={
        flush
          ? {
              background: playing
                ? "linear-gradient(180deg, rgba(232,184,109,0.12) 0%, rgba(22,18,14,0.35) 45%, rgba(167,139,250,0.05) 100%)"
                : "linear-gradient(180deg, rgba(232,184,109,0.07) 0%, rgba(22,18,14,0.28) 50%, transparent 100%)",
            }
          : {
              border: "1px solid rgba(232,184,109,0.22)",
              background: "linear-gradient(180deg, #16120e 0%, #0e0c0a 100%)",
              boxShadow: playing
                ? `0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.3), 0 0 40px ${BRASS_GLOW}`
                : "0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.28)",
            }
      }
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: playing
            ? "radial-gradient(ellipse 55% 140% at 12% 50%, rgba(232,184,109,0.22), transparent 55%), radial-gradient(ellipse 40% 100% at 88% 50%, rgba(232,184,109,0.08), transparent 50%)"
            : "radial-gradient(ellipse 50% 120% at 50% 0%, rgba(232,184,109,0.1), transparent 55%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(245,217,168,0.4), transparent)",
        }}
      />
      {!flush && (
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] opacity-40"
        style={{
          background: "linear-gradient(90deg, transparent, #e8b86d, transparent)",
          maskImage: "repeating-linear-gradient(90deg, #000 0 8px, transparent 8px 14px)",
          WebkitMaskImage: "repeating-linear-gradient(90deg, #000 0 8px, transparent 8px 14px)",
        }}
      />
      )}

      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5 min-h-[64px]">
        {/* Left — fire control */}
        <div className="flex items-center gap-2.5 min-w-0 sm:justify-self-start">
          <button
            type="button"
            onClick={togglePlay}
            className="group relative h-10 px-5 rounded-xl font-black text-[12px] uppercase tracking-[0.14em] transition overflow-hidden shrink-0"
            style={
              playing
                ? {
                    color: "#1a1208",
                    background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                    boxShadow: `0 0 24px ${BRASS_GLOW}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                  }
                : {
                    color: BRASS_SOFT,
                    background: "rgba(232,184,109,0.12)",
                    boxShadow: `inset 0 0 0 1px rgba(232,184,109,0.45)`,
                  }
            }
            title={`Open Fire — play/stop ${scopeName.toLowerCase()}`}
          >
            {playing && (
              <span
                className="pointer-events-none absolute inset-0 opacity-60 animate-[evolve-breathe_1.8s_ease-in-out_infinite]"
                style={{
                  background: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.45), transparent 55%)",
                }}
              />
            )}
            <span className="relative inline-flex items-center gap-2">
              <span aria-hidden className="text-[13px] leading-none">{playing ? "■" : "▶"}</span>
              {playing ? "Hold Fire" : "Open Fire"}
            </span>
          </button>
          <div className="min-w-0 hidden xs:block sm:block">
            <div
              className="text-[8px] font-black uppercase tracking-[0.2em] leading-none"
              style={{ color: playing ? BRASS : "rgba(232,184,109,0.45)" }}
            >
              {playing ? "Live fire" : "Standby"}
            </div>
            <div className="fc-text-secondary text-[10px] text-white/50 mt-0.5 truncate">
              Scope · {scopeName}
            </div>
          </div>
          <div
            className="inline-flex items-center rounded-lg p-0.5 shrink-0"
            style={{
              background: "rgba(0,0,0,0.35)",
              boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.18)",
            }}
            role="group"
            aria-label="Play scope"
          >
            {SCOPE_OPTS.map((opt) => {
              const on = playScope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPlayScope(opt.id)}
                  className="h-7 px-1.5 sm:px-2 rounded-md text-[9px] font-bold uppercase tracking-[0.08em] transition"
                  style={
                    on
                      ? {
                          color: "#1a1208",
                          background: `linear-gradient(145deg, ${BRASS_SOFT}, ${BRASS})`,
                        }
                      : {
                          color: "rgba(245,217,168,0.55)",
                          background: "transparent",
                        }
                  }
                  title={`Play ${opt.label}`}
                  aria-pressed={on}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center — readout */}
        <div
          className="justify-self-center rounded-xl px-4 py-1.5 min-w-[11rem] text-center"
          style={{
            background: "rgba(0,0,0,0.35)",
            boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.18)",
          }}
        >
          <div
            className="text-[8px] font-black uppercase tracking-[0.22em] leading-none"
            style={{ color: "rgba(232,184,109,0.55)" }}
          >
            Transport
          </div>
          <div
            className="mt-1 font-mono text-[12px] font-semibold tabular-nums tracking-wide"
            style={{ color: BRASS_SOFT }}
          >
            {bpm}
            <span className="text-[9px] opacity-50 ml-1">BPM</span>
            <span className="mx-1.5 opacity-30">·</span>
            {bars}
            <span className="text-[9px] opacity-50 ml-1">bar{bars === 1 ? "" : "s"}</span>
            <span className="mx-1.5 opacity-30">·</span>
            {noteCount}
            <span className="text-[9px] opacity-50 ml-1">notes</span>
          </div>
        </div>

        {/* Right — layer arms */}
        <div className="flex items-center gap-2 min-w-0 sm:justify-self-end sm:justify-end">
          <div className="text-right hidden md:block mr-1">
            <div
              className="fc-text-secondary text-[10px] font-black uppercase tracking-[0.16em] leading-none"
              style={{ color: "rgba(232,184,109,0.65)" }}
            >
              Layers
            </div>
            <div className="fc-text-secondary text-[10px] text-white/50 mt-0.5">arm · mute</div>
          </div>
          <div
            className="inline-flex items-center gap-1 rounded-full p-1 fc-layer-toggle"
            style={{
              background: "rgba(0,0,0,0.35)",
              boxShadow: "inset 0 0 0 1px rgba(232,184,109,0.16)",
            }}
          >
            {channels.map((ch) => (
              <button
                key={ch.key}
                type="button"
                onClick={ch.toggle}
                className="h-8 min-w-[2.75rem] px-2.5 rounded-full text-[11px] font-black tracking-wide transition inline-flex items-center justify-center gap-1.5"
                style={
                  ch.on
                    ? {
                        color: ch.soft,
                        background: `${ch.accent}22`,
                        boxShadow: `inset 0 0 0 1px ${ch.accent}66, 0 0 12px ${ch.accent}33`,
                      }
                    : {
                        color: "rgba(255,255,255,0.28)",
                        background: "transparent",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
                      }
                }
                title={ch.title}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background: ch.on ? ch.accent : "rgba(255,255,255,0.2)",
                    boxShadow: ch.on ? `0 0 8px ${ch.accent}` : undefined,
                  }}
                />
                {ch.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
