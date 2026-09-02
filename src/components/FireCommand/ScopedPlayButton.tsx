/**
 * Tiny scoped play/pause — sets playScope then plays, or stops if already
 * playing that same scope. Used inside Arrangement / Piano Roll / Drums so
 * fullscreen editors can audition without hunting the global Open Fire.
 *
 * Circular + saturated so it never collides visually with CollapseToggle.
 */

import { useFireSequencerStore, type PlayScope } from "@/state/fireSequencerStore";
import { SEQ_PILL } from "./seqChrome";

/** @deprecated Use SEQ_PILL from seqChrome — re-exported for existing imports. */
export const SEQ_PILL_BTN = SEQ_PILL;

export const SEQ_ICON_BTN =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]";

function PlayGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="block">
      <path d="M3.2 1.6v8.8L10.4 6 3.2 1.6z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="block">
      <rect x="2.2" y="1.8" width="2.6" height="8.4" rx="0.6" fill="currentColor" />
      <rect x="7.2" y="1.8" width="2.6" height="8.4" rx="0.6" fill="currentColor" />
    </svg>
  );
}

export function ScopedPlayButton({
  scope,
  label,
  accent = "#ff6a3d",
  title,
  compact = true,
}: {
  scope: PlayScope;
  label?: string;
  accent?: string;
  title?: string;
  compact?: boolean;
}) {
  const playing = useFireSequencerStore((s) => s.playing);
  const playScope = useFireSequencerStore((s) => s.playScope);
  const setPlayScope = useFireSequencerStore((s) => s.setPlayScope);
  const play = useFireSequencerStore((s) => s.play);
  const stop = useFireSequencerStore((s) => s.stop);

  const armed = playing && playScope === scope;

  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          stop();
          return;
        }
        setPlayScope(scope);
        play();
      }}
      className={
        compact && !label
          ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer hover:brightness-110 active:scale-[0.97]"
          : "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[11px] font-black transition duration-150 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer hover:brightness-110 active:scale-[0.97]"
      }
      style={
        armed
          ? {
              color: "#04140c",
              background: "linear-gradient(145deg, #6ee7b7, #10b981)",
              boxShadow: "0 0 14px rgba(16,185,129,0.5), inset 0 1px 0 rgba(255,255,255,0.35)",
            }
          : {
              color: "#fff7ed",
              background: `linear-gradient(145deg, ${accent}, #ea580c)`,
              boxShadow: `0 0 12px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.28)`,
            }
      }
      title={title ?? (armed ? `Hold Fire · ${scope}` : `Open Fire · ${scope}`)}
      aria-pressed={armed}
      aria-label={armed ? `Hold Fire · ${scope}` : `Open Fire · ${scope}`}
    >
      {armed ? <PauseGlyph /> : <PlayGlyph />}
      {label ? <span className="text-[9px] uppercase tracking-[0.1em]">{label}</span> : null}
    </button>
  );
}
