/**
 * Fire Command Deck — Signal Path Theater + Command Map atlas.
 * Organizational chrome: jump, focus, live heat, per-stage On/Off.
 */

import { useEffect, useState } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { FirePatch } from "@/audio/dsp/FireCommandSynth";
import { FIRE_BANDS, FIRE_MODULE_BY_ID, SIGNAL_PATH, type FireModuleId, type SignalNodeId } from "./fireModuleAtlas";
import { useFireLayout } from "./FireLayoutContext";
import { scrollFireCommandTop } from "./fireNavigate";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Stable fallback — allocating {} inside the selector re-rendered on every store update. */
const EMPTY_ENABLE: Record<string, boolean> = {};

const PATH_KEYS: Record<SignalNodeId, keyof FirePatch> = {
  osc: "pathOsc",
  filter: "pathFilter",
  drive: "pathDrive",
  age: "pathAge",
  fx: "pathFx",
  mix: "pathMix",
  scope: "pathScope",
};

/** Live “heat” for signal-path nodes — polled so knob drags don’t thrash the deck. */
function useSignalHeat(): Record<SignalNodeId, number> {
  const [heat, setHeat] = useState<Record<SignalNodeId, number>>(() => ({
    osc: 0.35, filter: 0.35, drive: 0, age: 0, fx: 0, mix: 0.5, scope: 0.4,
  }));

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let prev = "";
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 140) return;
      last = t;
      const p = useFireCommandStore.getState().patch;
      const next = {
        osc: clamp01((p.oscALevel + p.oscBLevel + p.oscCLevel) / 2.2),
        filter: clamp01(0.25 + (1 - Math.log10(Math.max(30, p.filterCutoff)) / 4.3) * 0.55 + Math.min(1, p.filterResonance / 12) * 0.35),
        drive: clamp01(p.drive),
        age: clamp01(Math.max(p.cassetteGen ?? 0, p.wowFlutter ?? 0, p.bbdChorus ?? 0, p.hiss ?? 0, p.vhsColor ?? 0) * 1.2),
        fx: clamp01(Math.max(p.delayMix, p.reverbMix, p.phaserMix, p.chorusMix) * 1.15),
        mix: clamp01(p.masterGain / 1.2),
        scope: clamp01(0.35 + p.masterGain * 0.4 + Math.max(p.oscALevel, p.oscBLevel, p.oscCLevel) * 0.25),
      };
      const key = `${next.osc.toFixed(2)}|${next.filter.toFixed(2)}|${next.drive.toFixed(2)}|${next.age.toFixed(2)}|${next.fx.toFixed(2)}|${next.mix.toFixed(2)}|${next.scope.toFixed(2)}`;
      if (key === prev) return;
      prev = key;
      setHeat(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return heat;
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
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/45">Solo</div>
          <div className="truncate text-[12px] font-semibold" style={{ color: mod.color }}>
            {mod.title}
            <span className="ml-2 text-[10px] font-normal text-white/40">{mod.bandTitle}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => scrollFireCommandTop()}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/90 hover:bg-white/15 transition"
            title="Scroll to top"
          >
            Top
          </button>
          <button
            type="button"
            onClick={exitFocus}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/90 hover:bg-white/15 transition"
            title="Exit Solo — show all modules (Esc)"
          >
            Exit Solo
          </button>
        </div>
      </div>
    </div>
  );
}

export function FireCommandDeck({ flush = false }: { flush?: boolean }) {
  const { focusId, focusActive, enterFocus, exitFocus, jump } = useFireLayout();
  const heat = useSignalHeat();
  const [mapOpen, setMapOpen] = useState(true);
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const moduleEnable = useFireCommandStore((s) => s.patch.moduleEnable) ?? EMPTY_ENABLE;
  const signalPathOrder = useFireCommandStore((s) => s.signalPathOrder);
  const setSignalPathOrder = useFireCommandStore((s) => s.setSignalPathOrder);
  const pathOsc = useFireCommandStore((s) => s.patch.pathOsc !== false);
  const pathFilter = useFireCommandStore((s) => s.patch.pathFilter !== false);
  const pathDrive = useFireCommandStore((s) => s.patch.pathDrive !== false);
  const pathAge = useFireCommandStore((s) => s.patch.pathAge !== false);
  const pathFx = useFireCommandStore((s) => s.patch.pathFx !== false);
  const pathMix = useFireCommandStore((s) => s.patch.pathMix !== false);
  const pathScope = useFireCommandStore((s) => s.patch.pathScope !== false);
  const pathOn: Record<SignalNodeId, boolean> = {
    osc: pathOsc, filter: pathFilter, drive: pathDrive, age: pathAge,
    fx: pathFx, mix: pathMix, scope: pathScope,
  };

  const orderedPath = (() => {
    if (!signalPathOrder.length) return SIGNAL_PATH;
    const byId = new Map(SIGNAL_PATH.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const out: typeof SIGNAL_PATH = [];
    for (const id of signalPathOrder) {
      const n = byId.get(id as SignalNodeId);
      if (n && !seen.has(n.id)) {
        out.push(n);
        seen.add(n.id);
      }
    }
    for (const n of SIGNAL_PATH) {
      if (!seen.has(n.id)) out.push(n);
    }
    return out.length ? out : SIGNAL_PATH;
  })();
  const pathCustomized =
    signalPathOrder.length > 0 &&
    (signalPathOrder.length !== SIGNAL_PATH.length ||
      signalPathOrder.some((id, i) => id !== SIGNAL_PATH[i]?.id));

  const swapPath = (index: number, dir: -1 | 1) => {
    const next = orderedPath.map((n) => n.id);
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[j]!;
    next[j] = tmp;
    setSignalPathOrder(next);
  };

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

  const togglePath = (id: SignalNodeId, e: React.MouseEvent) => {
    e.stopPropagation();
    const key = PATH_KEYS[id];
    setParam(key, !pathOn[id] as never);
  };

  return (
    <div className={flush ? "divide-y divide-white/[0.06]" : "space-y-2"}>
      <FocusHud />
    <div
      className={
        flush
          ? "bg-gradient-to-b from-white/[0.03] to-transparent overflow-hidden"
          : "rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.04] to-transparent overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      }
    >
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
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-white/65">Signal Path</div>
            <div className="hidden sm:block text-[9px] text-white/35 truncate">
              jump · On/Off bypass · Solo · ←→ arrange view (audio order fixed)
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {pathCustomized && (
              <button
                type="button"
                onClick={() => setSignalPathOrder([])}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/70 hover:bg-white/10 transition"
                title="Reset signal path order"
              >
                Reset order
              </button>
            )}
            {focusActive && focusId && (
              <button
                type="button"
                onClick={exitFocus}
                className="shrink-0 rounded-lg border border-[#ff6a3d]/40 bg-[#ff6a3d]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#ffb08a] hover:bg-[#ff6a3d]/25 transition"
                title="Exit Solo — show all bands (Esc)"
              >
                Exit Solo
              </button>
            )}
          </div>
        </div>

        <div className="flex w-full items-stretch gap-0 min-w-0">
          {orderedPath.map((node, i) => {
            const h = heat[node.id];
            const focused = focusId === node.moduleId;
            const on = pathOn[node.id];
            const lit = on && h > 0.08;
            const next = orderedPath[i + 1];
            return (
              <div key={node.id} className="flex min-w-0 flex-1 items-center">
                <div className={`relative flex w-full min-w-0 flex-col items-center gap-1 ${on ? "" : "opacity-45"}`}>
                  <button
                    type="button"
                    onClick={() => onNodeClick(node.moduleId)}
                    title={`${node.hint} — jump to ${node.label}`}
                    className="group relative flex h-12 w-full flex-col items-center justify-center rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    style={{
                      borderColor: focused ? node.color : lit ? `${node.color}55` : `${node.color}22`,
                      background: focused
                        ? `linear-gradient(160deg, ${node.color}44, ${node.color}14)`
                        : `linear-gradient(160deg, ${node.color}${Math.round(12 + h * 36).toString(16).padStart(2, "0")}, rgba(0,0,0,0.28))`,
                      boxShadow: lit
                        ? `0 0 ${8 + h * 18}px ${node.color}${Math.round(20 + h * 50).toString(16).padStart(2, "0")}`
                        : `inset 0 0 20px ${node.color}10`,
                      filter: on ? undefined : "grayscale(0.7)",
                    }}
                  >
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.14em]"
                      style={{ color: node.color }}
                    >
                      {node.label}
                    </span>
                    <span className="mt-1 h-0.5 w-[min(2rem,40%)] overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full transition-[width] duration-200"
                        style={{
                          width: `${Math.round((on ? h : 0) * 100)}%`,
                          background: node.color,
                        }}
                      />
                    </span>
                  </button>
                  <div className="flex items-center gap-0.5 flex-wrap justify-center">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); swapPath(i, -1); }}
                      disabled={i === 0}
                      className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[8px] font-bold text-white/45 hover:text-white/80 disabled:opacity-25 disabled:cursor-default transition"
                      title="Move earlier in the deck (display order only)"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={(e) => togglePath(node.id, e)}
                      className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider transition ${
                        on ? "" : "border-white/15 bg-black/40 text-white/35 hover:text-white/60"
                      }`}
                      style={
                        on
                          ? { borderColor: `${node.color}55`, background: `${node.color}1f`, color: node.color }
                          : undefined
                      }
                      title={on ? `Bypass ${node.label}` : `Enable ${node.label}`}
                      aria-pressed={on}
                    >
                      {on ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => onNodeFocus(node.moduleId, e)}
                      className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider transition ${
                        focused
                          ? "border-white/40 bg-white/15 text-white"
                          : "border-white/10 bg-black/30 text-white/40 hover:text-white/70 hover:border-white/25"
                      }`}
                      title={focused ? "Exit solo" : `Solo ${node.label} only`}
                      aria-pressed={focused}
                    >
                      {focused ? "Exit" : "Solo"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); swapPath(i, 1); }}
                      disabled={i >= orderedPath.length - 1}
                      className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[8px] font-bold text-white/45 hover:text-white/80 disabled:opacity-25 disabled:cursor-default transition"
                      title="Move later in the deck (display order only)"
                    >
                      →
                    </button>
                  </div>
                </div>
                {next && (
                  <div
                    className="mx-0.5 flex w-2.5 shrink-0 items-center self-center sm:mx-1 sm:w-3.5"
                    aria-hidden
                  >
                    <div
                      className="h-[3px] w-full rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${node.color}88, ${next.color}88)`,
                        animation: lit ? "fire-path-pulse 2.4s ease-in-out infinite" : undefined,
                        animationDelay: `${i * 0.2}s`,
                        boxShadow: lit ? `0 0 10px ${node.color}55` : `0 0 6px ${node.color}22`,
                        opacity: on && pathOn[next.id] ? 1 : 0.28,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Command Map atlas (open by default — Home jump-off to every module) ── */}
      <div className="px-3 py-2">
        <button
          type="button"
          onClick={() => setMapOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5 text-left hover:bg-white/[0.04] transition"
        >
          <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
            All modules
          </span>
          <span className="hidden md:inline text-[9px] text-white/25 flex-1 truncate">
            every stage · jump · On/Off
          </span>
          <span className="text-[10px] text-white/35">{mapOpen ? "▴" : "▾"}</span>
        </button>
        {mapOpen && (
        <div className="mt-2 flex gap-0 overflow-hidden rounded-xl border border-white/[0.07]">
          {FIRE_BANDS.map((band, bi) => {
            const bandHasFocus = focusId
              ? band.modules.some((mod) => mod.id === focusId)
              : false;
            const prev = FIRE_BANDS[bi - 1];
            const next = FIRE_BANDS[bi + 1];
            return (
              <div
                key={band.id}
                className="min-w-0 flex-1 px-1.5 py-1.5"
                style={{
                  backgroundImage: [
                    bandHasFocus
                      ? `linear-gradient(180deg, ${band.color}24, ${band.color}0a 55%, transparent)`
                      : `linear-gradient(180deg, ${band.color}14, transparent 78%)`,
                    prev ? `linear-gradient(90deg, ${prev.color}20, transparent 32%)` : null,
                    next ? `linear-gradient(270deg, ${next.color}20, transparent 32%)` : null,
                  ]
                    .filter(Boolean)
                    .join(", "),
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
                    const enabled = moduleEnable[mod.id] !== false;
                    return (
                      <div key={mod.id} className={`flex items-center gap-0.5 min-w-0 ${enabled ? "" : "opacity-40"}`}>
                        <button
                          type="button"
                          onClick={() => onNodeClick(mod.id)}
                          className="min-w-0 flex-1 truncate rounded-md border px-1.5 py-1 text-left text-[9px] font-semibold uppercase tracking-wide transition hover:bg-white/[0.06]"
                          style={{
                            color: mod.color,
                            borderColor: focused ? `${mod.color}88` : `${mod.color}28`,
                            background: focused ? `${mod.color}22` : "transparent",
                            filter: enabled ? undefined : "grayscale(0.6)",
                          }}
                          title={`${mod.title} — jump`}
                        >
                          {mod.short}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModuleEnable(mod.id, !enabled);
                          }}
                          className={`shrink-0 rounded-md border px-1 py-1 text-[8px] font-bold transition ${
                            enabled
                              ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                              : "border-white/12 bg-black/40 text-white/35 hover:text-white/60"
                          }`}
                          title={enabled ? `Bypass ${mod.title}` : `Enable ${mod.title}`}
                          aria-label={`${enabled ? "Disable" : "Enable"} ${mod.title}`}
                          aria-pressed={enabled}
                        >
                          {enabled ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
    </div>
  );
}
