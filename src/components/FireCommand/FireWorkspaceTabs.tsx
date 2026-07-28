/**
 * Synth | Sequencer workspace switcher — twin-mode deck.
 * Violet (sound) vs cyan (time) — deliberately distinct from the
 * fire→emerald command rail above.
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
    glow: "rgba(167,139,250,0.38)",
  },
  {
    id: "sequencer",
    label: "Sequencer",
    tag: "Time & groove",
    detail: "Patterns · arrangement · piano · drums",
    accent: "#22d3ee",
    accentSoft: "#a5f3fc",
    glow: "rgba(34,211,238,0.32)",
  },
];

function SynthMark({ active }: { active: boolean }) {
  const stroke = active ? "#ddd6fe" : "rgba(255,255,255,0.35)";
  const hot = active ? "#a78bfa" : "rgba(255,255,255,0.25)";
  const tip = active ? "#c4b5fd" : "rgba(255,255,255,0.2)";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M3 14c2-4 3.5-6 5-6s2.5 3 4 6 2.5 6 4 6 3-2 5-6"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.4" fill={hot} />
      <circle cx="16" cy="20" r="1.4" fill={tip} />
    </svg>
  );
}

function SeqMark({ active }: { active: boolean }) {
  const a = active ? "#a5f3fc" : "rgba(255,255,255,0.3)";
  const b = active ? "#22d3ee" : "rgba(255,255,255,0.28)";
  const fillA = active ? "rgba(34,211,238,0.22)" : "transparent";
  const fillB = active ? "rgba(34,211,238,0.3)" : "transparent";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <rect x="3.5" y="4.5" width="4" height="15" rx="1" stroke={a} strokeWidth="1.4" fill={fillA} />
      <rect x="10" y="8.5" width="4" height="11" rx="1" stroke={b} strokeWidth="1.4" fill={fillB} />
      <rect x="16.5" y="6" width="4" height="13.5" rx="1" stroke={a} strokeWidth="1.4" fill={fillA} />
      <circle cx="5.5" cy="7" r="1.1" fill={active ? "#22d3ee" : "rgba(255,255,255,0.25)"} />
      <circle cx="12" cy="11" r="1.1" fill={active ? "#67e8f9" : "rgba(255,255,255,0.2)"} />
      <circle cx="18.5" cy="9" r="1.1" fill={active ? "#22d3ee" : "rgba(255,255,255,0.25)"} />
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
  /** Sit inside the Synth console — no floating card chrome. */
  flush?: boolean;
}) {
  const active = MODES.find((m) => m.id === workspace) ?? MODES[0];

  return (
    <div
      className={`relative overflow-hidden ${flush ? "" : "rounded-2xl"}`}
      style={
        flush
          ? {
              background:
                workspace === "synth"
                  ? "linear-gradient(180deg, rgba(167,139,250,0.1) 0%, rgba(18,20,28,0.25) 40%, rgba(232,184,109,0.06) 100%)"
                  : "linear-gradient(180deg, rgba(34,211,238,0.1) 0%, rgba(18,20,28,0.25) 40%, rgba(232,184,109,0.06) 100%)",
            }
          : {
              border: "1px solid rgba(160,180,220,0.14)",
              background: "linear-gradient(180deg, #12141c 0%, #0c0e14 100%)",
              boxShadow: `0 0 0 1px rgba(0,0,0,0.35) inset, 0 8px 28px rgba(0,0,0,0.3), 0 0 36px ${active.glow}`,
            }
      }
    >
      {/* Cool slate field — no warm fire→green wash */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{
          background:
            workspace === "synth"
              ? "radial-gradient(ellipse 70% 120% at 18% 50%, rgba(167,139,250,0.18), transparent 58%), linear-gradient(180deg, rgba(30,28,48,0.5), transparent)"
              : "radial-gradient(ellipse 70% 120% at 82% 50%, rgba(34,211,238,0.16), transparent 58%), linear-gradient(180deg, rgba(18,32,40,0.5), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            workspace === "synth"
              ? "linear-gradient(90deg, rgba(196,181,253,0.45), rgba(255,255,255,0.06), transparent 70%)"
              : "linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.06), rgba(103,232,249,0.45))",
        }}
      />
      <div
        className="pointer-events-none absolute -left-8 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full blur-3xl transition-opacity duration-500"
        style={{ background: "rgba(167,139,250,0.5)", opacity: workspace === "synth" ? 0.45 : 0.08 }}
      />
      <div
        className="pointer-events-none absolute -right-8 top-1/2 h-24 w-28 -translate-y-1/2 rounded-full blur-3xl transition-opacity duration-500"
        style={{ background: "rgba(34,211,238,0.45)", opacity: workspace === "sequencer" ? 0.45 : 0.08 }}
      />

      <div className="relative z-10 grid grid-cols-2 gap-0 min-h-[64px]">
        {MODES.map((mode, i) => {
          const on = workspace === mode.id;
          const isSynth = mode.id === "synth";
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChange(mode.id)}
              aria-pressed={on}
              title={mode.detail}
              className={`group relative flex items-center gap-3 px-4 py-3 text-left transition duration-300 ${
                i === 0 ? "border-r border-white/[0.07]" : ""
              }`}
              style={{
                background: on
                  ? `linear-gradient(${isSynth ? "120deg" : "240deg"}, ${mode.accent}20, transparent 72%)`
                  : "transparent",
              }}
            >
              <span
                className="pointer-events-none absolute inset-x-4 bottom-0 h-[2px] rounded-full transition-all duration-300"
                style={{
                  background: mode.accent,
                  opacity: on ? 0.95 : 0,
                  boxShadow: on ? `0 0 12px ${mode.glow}` : undefined,
                  transform: on ? "scaleX(1)" : "scaleX(0.4)",
                }}
              />

              <span
                className="grid place-items-center w-10 h-10 rounded-xl shrink-0 transition duration-300"
                style={{
                  background: on
                    ? `linear-gradient(145deg, ${mode.accent}36, rgba(8,10,16,0.85))`
                    : "rgba(255,255,255,0.03)",
                  boxShadow: on
                    ? `0 0 18px ${mode.glow}, inset 0 0 10px ${mode.accent}20`
                    : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                  border: on ? `1px solid ${mode.accent}70` : "1px solid transparent",
                }}
              >
                {isSynth ? <SynthMark active={on} /> : <SeqMark active={on} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="fc-text-primary font-black uppercase tracking-[0.14em] transition-colors"
                    style={{ color: on ? mode.accentSoft : "rgba(255,255,255,0.4)" }}
                  >
                    {mode.label}
                  </span>
                  {on && (
                    <span
                      className="text-[8px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded"
                      style={{
                        color: mode.accentSoft,
                        background: `${mode.accent}22`,
                        boxShadow: `inset 0 0 0 1px ${mode.accent}50`,
                      }}
                    >
                      Live
                    </span>
                  )}
                </span>
                <span
                  className="block fc-text-secondary font-semibold mt-0.5 truncate transition-colors"
                  style={{ color: on ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.28)" }}
                >
                  {mode.tag}
                </span>
                <span
                  className="fc-chrome-workspace-detail block fc-text-secondary mt-0.5 truncate transition-colors"
                  style={{ color: on ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.18)" }}
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
