/**
 * Fire Command Deck — Signal Path Theater + Command Map atlas.
 * Organizational chrome: jump, focus, live heat from patch params. Display only.
 */

import { useMemo } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { FIRE_BANDS, FIRE_MODULE_BY_ID, SIGNAL_PATH, type FireModuleId, type SignalNodeId } from "./fireModuleAtlas";
import { useFireLayout } from "./FireLayoutContext";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Live “heat” for signal-path nodes from patch params — decorative only. */
function useSignalHeat(): Record<SignalNodeId, number> {
  const oscA = useFireCommandStore((s) => s.patch.oscALevel);
  const oscB = useFireCommandStore((s) => s.patch.oscBLevel);
  const oscC = useFireCommandStore((s) => s.patch.oscCLevel);
  const cutoff = useFireCommandStore((s) => s.patch.filterCutoff);
  const res = useFireCommandStore((s) => s.patch.filterResonance);
  const drive = useFireCommandStore((s) => s.patch.drive);
  const delay = useFireCommandStore((s) => s.patch.delayMix);
  const reverb = useFireCommandStore((s) => s.patch.reverbMix);
  const phaser = useFireCommandStore((s) => s.patch.phaserMix);
  const chorus = useFireCommandStore((s) => s.patch.chorusMix);
  const master = useFireCommandStore((s) => s.patch.masterGain);

  return useMemo(() => ({
    osc: clamp01((oscA + oscB + oscC) / 2.2),
    filter: clamp01(0.25 + (1 - Math.log10(Math.max(30, cutoff)) / 4.3) * 0.55 + Math.min(1, res / 12) * 0.35),
    drive: clamp01(drive),
    fx: clamp01(Math.max(delay, reverb, phaser, chorus) * 1.15),
    mix: clamp01(master / 1.2),
    scope: clamp01(0.35 + master * 0.4 + Math.max(oscA, oscB, oscC) * 0.25),
  }), [oscA, oscB, oscC, cutoff, res, drive, delay, reverb, phaser, chorus, master]);
}

/** Sticky strip while Focus Mode is on — always one click from exit. */
function FocusHud() {
  const { focusId, focusActive, exitFocus } = useFireLayout();
  if (!focusActive || !focusId) return null;
  const mod = FIRE_MODULE_BY_ID.get(focusId);
  if (!mod) return null;
  return (
    <div className="sticky top-0 z-30 -mx-0.5">
      <div
        className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-md"
        style={{
          borderColor: `${mod.color}66`,
          background: `linear-gradient(90deg, ${mod.color}28, rgba(8,8,12,0.92) 40%)`,
        }}
      >
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/45">Focus Mode</div>
          <div className="truncate text-[12px] font-semibold" style={{ color: mod.color }}>
            {mod.title}
            <span className="ml-2 text-[10px] font-normal text-white/40">{mod.bandTitle}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={exitFocus}
          className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/90 hover:bg-white/15 transition"
        >
          ✕ Show all
        </button>
      </div>
    </div>
  );
}

export function FireCommandDeck() {
  const { focusId, focusActive, enterFocus, exitFocus, jump } = useFireLayout();
  const heat = useSignalHeat();

  const onNodeClick = (moduleId: FireModuleId) => {
    if (focusActive && focusId === moduleId) {
      exitFocus();
      return;
    }
    jump(moduleId);
  };

  const onNodeFocus = (moduleId: FireModuleId, e: React.MouseEvent) => {
    e.stopPropagation();
    if (focusId === moduleId) exitFocus();
    else enterFocus(moduleId);
  };

  return (
    <div className="space-y-2">
      <FocusHud />
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <style>{`
        @keyframes fire-path-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.85; }
        }
        .fire-module-flash {
          outline: 2px solid rgba(255,106,61,0.65);
          outline-offset: 2px;
          transition: outline-color 0.85s ease-out;
        }
      `}</style>

      {/* ── Signal Path Theater ── */}
      <div className="border-b border-white/[0.06] px-3 pt-2.5 pb-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
              Signal Path
            </span>
            <span className="hidden sm:inline text-[9px] text-white/25 truncate">
              click to jump · ◉ to focus
            </span>
          </div>
          {focusActive && focusId && (
            <button
              type="button"
              onClick={exitFocus}
              className="shrink-0 rounded-lg border border-[#ff6a3d]/40 bg-[#ff6a3d]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#ffb08a] hover:bg-[#ff6a3d]/25 transition"
              title="Exit focus mode — show all bands again"
            >
              ✕ Exit focus
            </button>
          )}
        </div>

        <div className="flex items-stretch gap-0 min-w-0 overflow-x-auto pb-0.5">
          {SIGNAL_PATH.map((node, i) => {
            const h = heat[node.id];
            const focused = focusId === node.moduleId;
            const lit = h > 0.08;
            return (
              <div key={node.id} className="flex items-center min-w-0">
                <div className="relative flex flex-col items-center gap-1 min-w-[64px] sm:min-w-[76px]">
                  <button
                    type="button"
                    onClick={() => onNodeClick(node.moduleId)}
                    title={`${node.hint} — jump to ${node.label}`}
                    className="group relative flex h-12 w-full max-w-[76px] flex-col items-center justify-center rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    style={{
                      borderColor: focused ? node.color : lit ? `${node.color}66` : "rgba(255,255,255,0.1)",
                      background: focused
                        ? `linear-gradient(160deg, ${node.color}44, ${node.color}14)`
                        : `linear-gradient(160deg, ${node.color}${Math.round(10 + h * 40).toString(16).padStart(2, "0")}, rgba(0,0,0,0.35))`,
                      boxShadow: lit
                        ? `0 0 ${8 + h * 18}px ${node.color}${Math.round(20 + h * 50).toString(16).padStart(2, "0")}`
                        : undefined,
                    }}
                  >
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.14em]"
                      style={{ color: node.color }}
                    >
                      {node.label}
                    </span>
                    {/* Heat rail */}
                    <span className="mt-1 h-0.5 w-8 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full transition-[width] duration-200"
                        style={{
                          width: `${Math.round(h * 100)}%`,
                          background: node.color,
                        }}
                      />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => onNodeFocus(node.moduleId, e)}
                    className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider transition ${
                      focused
                        ? "border-white/40 bg-white/15 text-white"
                        : "border-white/10 bg-black/30 text-white/40 hover:text-white/70 hover:border-white/25"
                    }`}
                    title={focused ? "Exit focus" : `Focus ${node.label} only`}
                    aria-pressed={focused}
                  >
                    {focused ? "◉ ON" : "◌ FOC"}
                  </button>
                </div>
                {i < SIGNAL_PATH.length - 1 && (
                  <div className="mx-0.5 sm:mx-1 flex w-4 sm:w-7 shrink-0 items-center self-center" aria-hidden>
                    <div
                      className="h-px w-full"
                      style={{
                        background: `linear-gradient(90deg, ${node.color}55, ${SIGNAL_PATH[i + 1].color}55)`,
                        animation: lit ? "fire-path-pulse 2.4s ease-in-out infinite" : undefined,
                        animationDelay: `${i * 0.2}s`,
                        boxShadow: lit ? `0 0 6px ${node.color}44` : undefined,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Command Map atlas ── */}
      <div className="px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
            Command Map
          </span>
          <span className="hidden md:inline text-[9px] text-white/25">
            every stage · click jump · FOC solos the bay
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {FIRE_BANDS.map((band) => {
            const bandHasFocus = focusId
              ? band.modules.some((mod) => mod.id === focusId)
              : false;
            return (
              <div
                key={band.id}
                className="min-w-0 rounded-xl border px-1.5 py-1.5"
                style={{
                  borderColor: bandHasFocus ? `${band.color}66` : "rgba(255,255,255,0.08)",
                  background: bandHasFocus
                    ? `linear-gradient(180deg, ${band.color}18, transparent)`
                    : "rgba(0,0,0,0.25)",
                }}
              >
                <div className="mb-1 flex items-center gap-1 px-0.5">
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.16em] truncate"
                    style={{ color: band.color }}
                  >
                    {band.short}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {band.modules.map((mod) => {
                    const focused = focusId === mod.id;
                    return (
                      <div key={mod.id} className="flex items-center gap-0.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => onNodeClick(mod.id)}
                          className="min-w-0 flex-1 truncate rounded-md border px-1.5 py-1 text-left text-[9px] font-semibold uppercase tracking-wide transition hover:bg-white/[0.06]"
                          style={{
                            color: mod.color,
                            borderColor: focused ? `${mod.color}88` : `${mod.color}28`,
                            background: focused ? `${mod.color}22` : "transparent",
                          }}
                          title={`${mod.title} — jump`}
                        >
                          {mod.short}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => onNodeFocus(mod.id, e)}
                          className={`shrink-0 rounded-md border px-1 py-1 text-[8px] font-bold transition ${
                            focused
                              ? "border-white/35 bg-white/15 text-white"
                              : "border-white/8 text-white/30 hover:text-white/60"
                          }`}
                          title={focused ? "Exit focus" : `Focus ${mod.title}`}
                          aria-label={`Focus ${mod.title}`}
                          aria-pressed={focused}
                        >
                          ◉
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
