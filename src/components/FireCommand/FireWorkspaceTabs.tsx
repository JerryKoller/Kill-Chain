/**
 * Synth | Sequencer primary workspace switcher — compact twin-mode deck.
 * Violet (sound) vs cyan (time). Active workspace gets the strongest treatment.
 */

import type { FireWorkspace } from "./useFireWorkspace";

const MODES: {
  id: FireWorkspace;
  label: string;
  tag: string;
  detail: string;
  accent: string;
  accentSoft: string;
  glow: string;
}[] = [
  {
    id: "synth",
    label: "Synth",
    tag: "Sound design",
    detail: "Oscillators · filter · FX · keys",
    accent: "#a78bfa",
    accentSoft: "#ddd6fe",
    glow: "rgba(167,139,250,0.32)",
  },
  {
    id: "sequencer",
    label: "Sequencer",
    tag: "Time & groove",
    detail: "Patterns · arrangement · piano · drums",
    accent: "#22d3ee",
    accentSoft: "#a5f3fc",
    glow: "rgba(34,211,238,0.36)",
  },
];

function SynthMark({ active }: { active: boolean }) {
  const stroke = active ? "#ddd6fe" : "rgba(255,255,255,0.4)";
  const hot = active ? "#a78bfa" : "rgba(255,255,255,0.28)";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M3 14c2-4 3.5-6 5-6s2.5 3 4 6 2.5 6 4 6 3-2 5-6"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.4" fill={hot} />
      <circle cx="16" cy="20" r="1.4" fill={active ? "#c4b5fd" : "rgba(255,255,255,0.22)"} />
    </svg>
  );
}

function SeqMark({ active }: { active: boolean }) {
  const a = active ? "#a5f3fc" : "rgba(255,255,255,0.35)";
  const b = active ? "#22d3ee" : "rgba(255,255,255,0.32)";
  const fillA = active ? "rgba(34,211,238,0.22)" : "transparent";
  const fillB = active ? "rgba(34,211,238,0.3)" : "transparent";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <rect x="3.5" y="4.5" width="4" height="15" rx="1" stroke={a} strokeWidth="1.4" fill={fillA} />
      <rect x="10" y="8.5" width="4" height="11" rx="1" stroke={b} strokeWidth="1.4" fill={fillB} />
      <rect x="16.5" y="6" width="4" height="13.5" rx="1" stroke={a} strokeWidth="1.4" fill={fillA} />
    </svg>
  );
}

export function FireWorkspaceTabs({
  workspace,
  onChange,
  flush = false,
}: {
  workspace: FireWorkspace;
  onChange: (ws: FireWorkspace) => void;
  flush?: boolean;
}) {
  return (
    <div
      className={`fc-workspace-tabs ${flush ? "" : "rounded-2xl"}`}
      style={
        flush
          ? {
              background:
                workspace === "synth"
                  ? "linear-gradient(180deg, rgba(167,139,250,0.08) 0%, rgba(18,20,28,0.2) 55%, transparent 100%)"
                  : "linear-gradient(180deg, rgba(34,211,238,0.1) 0%, rgba(18,20,28,0.2) 55%, transparent 100%)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }
          : {
              border: "1px solid rgba(160,180,220,0.14)",
              background: "linear-gradient(180deg, #12141c 0%, #0c0e14 100%)",
            }
      }
      role="tablist"
      aria-label="Primary workspace"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            workspace === "synth"
              ? "radial-gradient(ellipse 55% 100% at 18% 50%, rgba(167,139,250,0.12), transparent 60%)"
              : "radial-gradient(ellipse 55% 100% at 82% 50%, rgba(34,211,238,0.14), transparent 60%)",
        }}
      />

      <div className="fc-workspace-tabs__grid">
        {MODES.map((mode, i) => {
          const on = workspace === mode.id;
          const isSynth = mode.id === "synth";
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(mode.id)}
              title={`${mode.label} — ${mode.detail}`}
              className={`fc-workspace-tabs__btn group ${i === 0 ? "border-r border-white/[0.07]" : ""}`}
              style={{
                background: on
                  ? `linear-gradient(${isSynth ? "120deg" : "240deg"}, ${mode.accent}22, transparent 75%)`
                  : "transparent",
              }}
            >
              <span
                className="pointer-events-none absolute inset-x-3 bottom-0 h-[2px] rounded-full transition-transform duration-150"
                style={{
                  background: mode.accent,
                  opacity: on ? 1 : 0,
                  boxShadow: on ? `0 0 10px ${mode.glow}` : undefined,
                  transform: on ? "scaleX(1)" : "scaleX(0.35)",
                }}
              />

              <span
                className="grid place-items-center w-8 h-8 rounded-lg shrink-0 transition duration-150"
                style={{
                  background: on
                    ? `linear-gradient(145deg, ${mode.accent}32, rgba(8,10,16,0.85))`
                    : "rgba(255,255,255,0.03)",
                  boxShadow: on
                    ? `0 0 14px ${mode.glow}, inset 0 0 0 1px ${mode.accent}55`
                    : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                }}
              >
                {isSynth ? <SynthMark active={on} /> : <SeqMark active={on} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="text-[12px] font-black uppercase tracking-[0.1em] transition-colors"
                    style={{ color: on ? mode.accentSoft : "rgba(255,255,255,0.48)" }}
                  >
                    {mode.label}
                  </span>
                  {on && (
                    <span
                      className="text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
                      style={{
                        color: mode.accentSoft,
                        background: `${mode.accent}24`,
                        boxShadow: `inset 0 0 0 1px ${mode.accent}55`,
                      }}
                    >
                      Live
                    </span>
                  )}
                </span>
                <span
                  className="fc-workspace-tabs__tag block text-[10px] font-semibold mt-0.5 truncate"
                  style={{ color: on ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.38)" }}
                >
                  {mode.tag}
                </span>
                <span
                  className="fc-workspace-tabs__detail fc-chrome-workspace-detail text-[10px] mt-0.5 truncate"
                  style={{ color: on ? "rgba(255,255,255,0.48)" : "rgba(255,255,255,0.28)" }}
                >
                  {mode.detail}
                </span>
              </span>

              {!on && (
                <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/[0.03]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
