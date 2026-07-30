/**
 * Fire Command Deck — Signal Path Theater + Command Map atlas.
 * Home Clarity: AUDIO PATH · CONTROL PATH · live status · matrix intelligence.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFireCommandStore, activeFireEngine } from "@/state/fireCommandStore";
import type { FirePatch, ModDest } from "@/audio/dsp/FireCommandSynth";
import { getEngine } from "@/audio/AudioEngine";
import {
  FIRE_BANDS,
  FIRE_MODULE_BY_ID,
  SIGNAL_PATH,
  type FireModuleId,
  type SignalNode,
  type SignalNodeId,
} from "./fireModuleAtlas";
import { useFireLayout } from "./FireLayoutContext";
import { jumpToModule, jumpToSynthBand, scrollFireCommandTop } from "./fireNavigate";
import { readScopeFreeze, SCOPE_FREEZE_EVENT, toggleScopeFreeze } from "./scopeFreezeBridge";
import { FC_BAND } from "./fireColors";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

const EMPTY_ENABLE: Record<string, boolean> = {};
const EMPTY_LOCKS: Record<string, boolean> = {};

const PATH_KEYS: Record<SignalNodeId, keyof FirePatch> = {
  osc: "pathOsc",
  filter: "pathFilter",
  drive: "pathDrive",
  age: "pathAge",
  fx: "pathFx",
  mix: "pathMix",
  scope: "pathScope",
};

const MOD_DEST_STAGE: Partial<Record<ModDest, SignalNodeId>> = {
  cutoff: "filter",
  resonance: "filter",
  wtA: "osc",
  wtB: "osc",
  wtC: "osc",
  levelA: "osc",
  levelB: "osc",
  levelC: "osc",
  pitch: "osc",
  fm: "osc",
  drive: "drive",
  reverb: "fx",
  delay: "fx",
  chorusMix: "fx",
  phaserMix: "fx",
  spectral: "fx",
  pan: "mix",
  volume: "mix",
};

const MODULE_MOD_DESTS: Partial<Record<string, ModDest[]>> = {
  "osc.a": ["wtA", "levelA"],
  "osc.b": ["wtB", "levelB"],
  "osc.c": ["wtC", "levelC"],
  filter: ["cutoff", "resonance"],
  "fx.drive": ["drive"],
  "fx.delay": ["delay"],
  "fx.reverb": ["reverb"],
  "fx.chorus": ["chorusMix"],
  "fx.phaser": ["phaserMix"],
  "fx.spectral": ["spectral"],
  mixer: ["volume", "pan"],
  pitch: ["pitch"],
  fm: ["fm"],
  matrix: ["cutoff", "resonance", "drive", "delay", "reverb", "volume", "pan", "pitch", "fm"],
};

const FX_RACK: { id: FireModuleId; label: string; wetKey?: keyof FirePatch; onKey?: keyof FirePatch }[] = [
  { id: "fx.drive", label: "Drive", wetKey: "drive" },
  { id: "fx.vintage", label: "Age", wetKey: "ageMacro" },
  { id: "fx.phaser", label: "Phaser", wetKey: "phaserMix" },
  { id: "fx.chorus", label: "Chorus", wetKey: "chorusMix" },
  { id: "fx.delay", label: "Delay", wetKey: "delayMix" },
  { id: "fx.reverb", label: "Reverb", wetKey: "reverbMix" },
  { id: "fx.spectral", label: "Spectral", wetKey: "spectralMix" },
];

type StageStatus = Record<SignalNodeId, string>;
type StageMenuState = { kind: "path"; id: SignalNodeId } | { kind: "mod"; id: FireModuleId } | null;
type InspectTarget = "filter" | "drive" | null;

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
        drive: clamp01(Math.max(p.drive, (p.crush ?? 0) * 0.8) * (p.pathDrive === false ? 0 : 1)),
        age: clamp01(Math.max(p.cassetteGen ?? 0, p.wowFlutter ?? 0, p.bbdChorus ?? 0, p.hiss ?? 0, p.vhsColor ?? 0, p.ageMacro ?? 0) * 1.2 * (p.pathAge === false ? 0 : 1)),
        fx: clamp01(Math.max(p.delayMix, p.reverbMix, p.phaserMix, p.chorusMix, p.spectralMode !== "off" ? (p.spectralMix ?? 0) : 0) * 1.15 * (p.pathFx === false ? 0 : 1)),
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

function useStageStatus(scopeFreeze: boolean): StageStatus {
  const [status, setStatus] = useState<StageStatus>(() => ({
    osc: "—", filter: "—", drive: "—", age: "—", fx: "—", mix: "—", scope: "—",
  }));

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let prev = "";
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 180) return;
      last = t;
      const p = useFireCommandStore.getState().patch;
      let voices = 0;
      let gr = 0;
      try {
        const e = getEngine();
        voices = activeFireEngine().getActiveVoiceCount?.() ?? 0;
        gr = e.getFireLimiterReduction?.() ?? 0;
      } catch { /* engine not ready */ }

      const groups = [
        p.oscALevel > 0.02 ? "A" : null,
        p.oscBLevel > 0.02 ? "B" : null,
        p.oscCLevel > 0.02 ? "C" : null,
        (p.subLevel ?? 0) > 0.02 ? "Sub" : null,
      ].filter(Boolean);
      const wets: [string, number][] = [
        ["Dly", p.delayMix],
        ["Rev", p.reverbMix],
        ["Cho", p.chorusMix],
        ["Phs", p.phaserMix],
        ["Spc", p.spectralMode !== "off" ? (p.spectralMix ?? 0) : 0],
      ];
      const activeFx = wets.filter(([, v]) => v > 0.02).length + ((p.drive ?? 0) > 0.02 ? 1 : 0) + ((p.ageMacro ?? 0) > 0.02 ? 1 : 0);
      const dominant = [...wets].sort((a, b) => b[1] - a[1])[0];
      const cutoff = p.filterCutoff >= 1000 ? `${(p.filterCutoff / 1000).toFixed(1)}k` : `${Math.round(p.filterCutoff)}`;
      const next: StageStatus = {
        osc: `${groups.length ? groups.join("+") : "quiet"} · ${voices}v`,
        filter: `${String(p.filterType).slice(0, 2).toUpperCase()} · ${cutoff} · Q${(p.filterResonance ?? 0).toFixed(1)}`,
        drive: `${p.driveMode ?? "soft"} · ${Math.round((p.drive ?? 0) * 100)}%${p.fxQuality ? ` · ${p.fxQuality}` : ""}`,
        age: `macro ${Math.round((p.ageMacro ?? 0) * 100)}% · evo ${Math.round((p.ageEvolve ?? 0) * 100)}%`,
        fx: `${Math.min(7, activeFx)}/7${dominant && dominant[1] > 0.02 ? ` · ${dominant[0]} ${Math.round(dominant[1] * 100)}%` : " · dry"}`,
        mix: `gain ${Math.round((p.masterGain ?? 0) * 100)}% · GR −${gr.toFixed(1)}`,
        scope: `${scopeFreeze ? "freeze" : "live"} · lumen`,
      };
      const key = Object.values(next).join("|");
      if (key === prev) return;
      prev = key;
      setStatus(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scopeFreeze]);

  return status;
}

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
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/45">Δ Focus</div>
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
            title="Exit Δ Focus — show all modules (Esc)"
          >
            Exit Δ
          </button>
        </div>
      </div>
    </div>
  );
}

function PathCable({
  from,
  to,
  lit,
  on,
  nextOn,
  monitor,
  delay,
}: {
  from: string;
  to: string;
  lit: boolean;
  on: boolean;
  nextOn: boolean;
  monitor?: boolean;
  delay: number;
}) {
  return (
    <div
      className="mx-0.5 flex w-3 shrink-0 flex-col items-center justify-center self-center sm:mx-1 sm:w-4"
      aria-hidden
      title={monitor ? "Monitor tap (analysis)" : "Serial audio"}
    >
      <div
        className="relative h-[3px] w-full rounded-full"
        style={{
          background: monitor
            ? `repeating-linear-gradient(90deg, ${from}99 0 3px, transparent 3px 6px)`
            : `linear-gradient(90deg, ${from}, ${to})`,
          animation: lit && !monitor ? "fire-path-pulse 2.4s ease-in-out infinite" : undefined,
          animationDelay: `${delay}s`,
          boxShadow: lit ? `0 0 10px ${from}66` : `0 0 4px ${from}22`,
          opacity: on && nextOn ? (monitor ? 0.75 : 1) : 0.22,
        }}
      />
      <span
        className="mt-0.5 text-[7px] leading-none"
        style={{ color: nextOn && on ? `${to}cc` : "rgba(255,255,255,0.2)" }}
      >
        {monitor ? "┊" : "▸"}
      </span>
    </div>
  );
}

function StageMenu({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 z-40 mb-1 w-40 -translate-x-1/2 rounded-lg border border-white/18 bg-[#12121a] py-1 shadow-xl"
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className={`block w-full px-2.5 py-1.5 text-left text-[10px] font-semibold transition hover:bg-white/10 ${
            it.danger ? "text-rose-300/90" : "text-white/75"
          }`}
          onClick={() => {
            it.onClick();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function FireCommandDeck({ flush = false }: { flush?: boolean }) {
  const { focusId, focusActive, enterFocus, exitFocus, jump } = useFireLayout();
  const heat = useSignalHeat();
  const [mapOpen, setMapOpen] = useState(true);
  const [menu, setMenu] = useState<StageMenuState>(null);
  const [fxExpanded, setFxExpanded] = useState(false);
  const [inspect, setInspect] = useState<InspectTarget>(null);
  const [routingPreview, setRoutingPreview] = useState(false);
  const [scopeFreeze, setScopeFreeze] = useState(() =>
    typeof window !== "undefined" ? readScopeFreeze() : false,
  );
  const [hoverCable, setHoverCable] = useState<number | null>(null);

  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const toggleModuleLock = useFireCommandStore((s) => s.toggleModuleLock);
  const moduleEnable = useFireCommandStore((s) => s.patch.moduleEnable) ?? EMPTY_ENABLE;
  const moduleLocks = useFireCommandStore((s) => s.moduleLocks) ?? EMPTY_LOCKS;
  const modMatrix = useFireCommandStore((s) => s.patch.modMatrix) ?? [];
  const signalPathOrder = useFireCommandStore((s) => s.signalPathOrder);
  const setSignalPathOrder = useFireCommandStore((s) => s.setSignalPathOrder);
  const activeSceneSlot = useFireCommandStore((s) => s.activeSceneSlot);
  const gateOn = useFireCommandStore((s) => s.patch.gateOn);
  const arpOn = useFireCommandStore((s) => s.arp?.enabled);

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

  const patchSlice = useFireCommandStore(useShallow((s) => ({
    filterCutoff: s.patch.filterCutoff,
    filterResonance: s.patch.filterResonance,
    filterEnvAmount: s.patch.filterEnvAmount,
    drive: s.patch.drive,
    driveMode: s.patch.driveMode,
    delayMix: s.patch.delayMix,
    reverbMix: s.patch.reverbMix,
    phaserMix: s.patch.phaserMix,
    chorusMix: s.patch.chorusMix,
    spectralMix: s.patch.spectralMix,
    spectralMode: s.patch.spectralMode,
    ageMacro: s.patch.ageMacro,
    pathDrive: s.patch.pathDrive,
    pathAge: s.patch.pathAge,
    pathFx: s.patch.pathFx,
  })));

  const status = useStageStatus(scopeFreeze);

  useEffect(() => {
    const onFreeze = (e: Event) => {
      const detail = (e as CustomEvent<{ freeze: boolean }>).detail;
      if (typeof detail?.freeze === "boolean") setScopeFreeze(detail.freeze);
    };
    window.addEventListener(SCOPE_FREEZE_EVENT, onFreeze);
    return () => window.removeEventListener(SCOPE_FREEZE_EVENT, onFreeze);
  }, []);

  const orderedPath = useMemo(() => {
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
  }, [signalPathOrder]);

  const pathCustomized =
    signalPathOrder.length > 0 &&
    (signalPathOrder.length !== SIGNAL_PATH.length ||
      signalPathOrder.some((id, i) => id !== SIGNAL_PATH[i]?.id));

  const stageModCounts = useMemo(() => {
    const counts: Record<SignalNodeId, number> = {
      osc: 0, filter: 0, drive: 0, age: 0, fx: 0, mix: 0, scope: 0,
    };
    for (const r of modMatrix) {
      if (!r || r.source === "none" || r.dest === "none" || Math.abs(r.amount) < 0.01) continue;
      const stage = MOD_DEST_STAGE[r.dest];
      if (stage) counts[stage] += 1;
    }
    return counts;
  }, [modMatrix]);

  const swapPath = (index: number, dir: -1 | 1) => {
    const next = orderedPath.map((n) => n.id);
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[j]!;
    next[j] = tmp;
    setSignalPathOrder(next);
  };

  const onNodeClick = (node: SignalNode, e?: ReactMouseEvent) => {
    if (e?.shiftKey) {
      if (focusId === node.moduleId) exitFocus();
      else enterFocus(node.moduleId);
      return;
    }
    if (node.id === "fx") {
      setFxExpanded((v) => !v);
      setInspect(null);
      return;
    }
    if (focusActive && focusId === node.moduleId) {
      exitFocus();
      return;
    }
    jump(node.moduleId);
  };

  const onNodeFocus = (moduleId: FireModuleId, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (focusId === moduleId) exitFocus();
    else enterFocus(moduleId);
  };

  const togglePath = (id: SignalNodeId, e: ReactMouseEvent) => {
    e.stopPropagation();
    const key = PATH_KEYS[id];
    setParam(key, !pathOn[id] as never);
  };

  const routeCountForModule = useCallback(
    (modId: string) => {
      const dests = MODULE_MOD_DESTS[modId];
      if (!dests) return 0;
      return modMatrix.filter(
        (r) => r && r.source !== "none" && dests.includes(r.dest) && Math.abs(r.amount) >= 0.01,
      ).length;
    },
    [modMatrix],
  );

  const moduleActiveHint = useCallback(
    (modId: string, enabled: boolean) => {
      if (!enabled) return false;
      if (modId.startsWith("osc.") || modId === "sub" || modId === "noise" || modId === "chip") {
        return heat.osc > 0.12;
      }
      if (modId.startsWith("fx.")) return heat.fx > 0.08 || heat.drive > 0.08 || heat.age > 0.08;
      if (modId === "gate") return !!gateOn;
      if (modId === "arp") return !!arpOn;
      if (modId === "scenes") return activeSceneSlot != null;
      if (modId === "filter") return heat.filter > 0.2;
      return false;
    },
    [heat, gateOn, arpOn, activeSceneSlot],
  );

  const pathMenuItems = (node: SignalNode, index: number) => {
    const items: { label: string; onClick: () => void; danger?: boolean }[] = [
      { label: "Open section", onClick: () => jump(node.moduleId) },
      {
        label: pathOn[node.id] ? "Bypass stage" : "Enable stage",
        onClick: () => setParam(PATH_KEYS[node.id], !pathOn[node.id] as never),
      },
      {
        label: moduleLocks[node.moduleId] ? "Unlock from randomize" : "Lock from randomize",
        onClick: () => toggleModuleLock(node.moduleId),
      },
    ];
    if (node.id === "filter" || node.id === "drive") {
      items.push({
        label: "Inspect strip",
        onClick: () => {
          setInspect(node.id === "filter" ? "filter" : "drive");
          setFxExpanded(false);
        },
      });
    }
    if (node.id === "fx") {
      items.push({
        label: fxExpanded ? "Collapse FX rack" : "Expand FX rack",
        onClick: () => setFxExpanded((v) => !v),
      });
    }
    if (!node.monitor) {
      items.push({
        label: "Δ Focus module",
        onClick: () => {
          if (focusId === node.moduleId) exitFocus();
          else enterFocus(node.moduleId);
        },
      });
    }
    items.push({
      label: "Move earlier (view-only)",
      onClick: () => swapPath(index, -1),
    });
    items.push({
      label: "Move later (view-only)",
      onClick: () => swapPath(index, 1),
    });
    if (pathCustomized) {
      items.push({
        label: "Reset order view",
        onClick: () => setSignalPathOrder([]),
        danger: true,
      });
    }
    return items;
  };

  const modMenuItems = (modId: FireModuleId) => {
    const enabled = moduleEnable[modId] !== false;
    return [
      { label: "Open", onClick: () => jump(modId) },
      {
        label: enabled ? "Sleep module" : "Wake module",
        onClick: () => setModuleEnable(modId, !enabled),
      },
      {
        label: moduleLocks[modId] ? "Unlock from randomize" : "Lock from randomize",
        onClick: () => toggleModuleLock(modId),
      },
      {
        label: focusId === modId ? "Exit Δ Focus" : "Δ Focus",
        onClick: () => {
          if (focusId === modId) exitFocus();
          else enterFocus(modId);
        },
      },
      {
        label: "Open Matrix routes",
        onClick: () => jumpToModule("matrix"),
      },
    ];
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
          @keyframes fire-mod-halo {
            0%, 100% { box-shadow: 0 0 0 1px rgba(96,165,250,0.25); }
            50% { box-shadow: 0 0 12px 2px rgba(96,165,250,0.45); }
          }
          .fire-module-flash {
            outline: 2px solid rgba(255,106,61,0.65);
            outline-offset: 2px;
            transition: outline-color 0.85s ease-out;
          }
        `}</style>

        {/* ── Audio Path Theater ── */}
        <div className="border-b border-white/[0.06] px-3 pt-2.5 pb-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-white/70">Audio Path</div>
              <div className="hidden sm:block text-[9px] text-white/35 truncate">
                jump · On/Off · Δ Focus · Scope = monitor · ←→ view-only · FX expands inline
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRoutingPreview((v) => !v)}
                className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
                  routingPreview
                    ? "border-sky-400/45 bg-sky-400/15 text-sky-200"
                    : "border-white/15 bg-white/[0.06] text-white/65 hover:bg-white/10"
                }`}
                title="Display-only routing preview (no DSP reconnect)"
              >
                Routing
              </button>
              {pathCustomized && (
                <button
                  type="button"
                  onClick={() => setSignalPathOrder([])}
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/70 hover:bg-white/10 transition"
                  title="Reset signal path order (view-only)"
                >
                  Reset order
                </button>
              )}
              {focusActive && focusId && (
                <button
                  type="button"
                  onClick={exitFocus}
                  className="shrink-0 rounded-lg border border-[#ff6a3d]/40 bg-[#ff6a3d]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#ffb08a] hover:bg-[#ff6a3d]/25 transition"
                  title="Exit Δ Focus — show all bands (Esc)"
                >
                  Exit Δ
                </button>
              )}
            </div>
          </div>

          {routingPreview && (
            <div className="mb-2 rounded-lg border border-dashed border-sky-400/35 bg-sky-400/[0.06] px-2.5 py-2">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-sky-300/80">
                Routing preview · display only
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-white/55">
                <span style={{ color: FC_BAND.sources }}>Sub</span>
                <span className="text-white/25">∥</span>
                <span style={{ color: FC_BAND.mix }}>MIX</span>
                <span className="text-white/25">·</span>
                <span className="text-white/40">Scope tap @ MIX/OUT</span>
                <span className="text-white/25">·</span>
                <span style={{ color: FC_BAND.fx }}>FX dry/wet sketch</span>
                <span className="text-white/25">·</span>
                <span className="text-amber-200/70">Protected bass callout</span>
              </div>
              <div className="mt-1 text-[8px] text-white/30">
                No DSP reconnect — architecture teaching sketch until Routing roadmap.
              </div>
            </div>
          )}

          <div className="flex w-full items-stretch gap-0 min-w-0">
            {orderedPath.map((node, i) => {
              const h = heat[node.id];
              const focused = focusId === node.moduleId;
              const on = pathOn[node.id];
              const lit = on && h > 0.08;
              const next = orderedPath[i + 1];
              const isMonitor = !!node.monitor;
              const modN = stageModCounts[node.id];
              const cableToMonitor = next?.monitor;
              return (
                <div key={node.id} className="flex min-w-0 flex-1 items-center">
                  <div className={`relative flex w-full min-w-0 flex-col items-center gap-0.5 ${on ? "" : "opacity-45"}`}>
                    <button
                      type="button"
                      onClick={(e) => onNodeClick(node, e)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ kind: "path", id: node.id });
                      }}
                      title={`${node.hint}${node.subtitle ? ` — ${node.subtitle}` : ""} — ${isMonitor ? "monitor" : "jump / Shift=Δ Focus"}`}
                      className={`group relative flex min-h-[3.25rem] w-full flex-col items-center justify-center rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                        isMonitor ? "border-dashed" : ""
                      }`}
                      style={{
                        borderColor: focused
                          ? node.color
                          : lit
                            ? `${node.color}${isMonitor ? "66" : "55"}`
                            : `${node.color}${isMonitor ? "38" : "22"}`,
                        background: focused
                          ? `linear-gradient(160deg, ${node.color}44, ${node.color}14)`
                          : isMonitor
                            ? `linear-gradient(160deg, ${node.color}14, rgba(0,0,0,0.35))`
                            : `linear-gradient(160deg, ${node.color}${Math.round(12 + h * 36).toString(16).padStart(2, "0")}, rgba(0,0,0,0.28))`,
                        boxShadow: modN > 0
                          ? undefined
                          : lit
                            ? `0 0 ${8 + h * 18}px ${node.color}${Math.round(20 + h * 50).toString(16).padStart(2, "0")}`
                            : `inset 0 0 20px ${node.color}10`,
                        animation: modN > 0 ? "fire-mod-halo 2.8s ease-in-out infinite" : undefined,
                        filter: on ? undefined : "grayscale(0.7)",
                        opacity: isMonitor ? 0.92 : 1,
                      }}
                    >
                      {node.badge && (
                        <span
                          className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded border px-1 py-px text-[7px] font-black uppercase tracking-wider"
                          style={{
                            borderColor: `${node.color}55`,
                            background: "rgba(8,8,12,0.92)",
                            color: node.color,
                          }}
                        >
                          {node.badge}
                        </span>
                      )}
                      {modN > 0 && (
                        <span
                          className="absolute -top-1 -right-0.5 rounded-full border border-sky-400/50 bg-sky-500/25 px-1 text-[7px] font-bold text-sky-200"
                          title={`${modN} mod route${modN === 1 ? "" : "s"}`}
                        >
                          {modN}
                        </span>
                      )}
                      <span
                        className={`font-black uppercase tracking-[0.12em] ${isMonitor ? "text-[9px]" : "text-[10px]"}`}
                        style={{ color: node.color }}
                      >
                        {node.label}
                      </span>
                      <span className="mt-0.5 max-w-full truncate px-0.5 font-mono text-[7px] leading-tight text-white/40">
                        {status[node.id]}
                      </span>
                      <span className="mt-0.5 h-0.5 w-[min(2rem,40%)] overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full transition-[width] duration-200"
                          style={{
                            width: `${Math.round((on ? h : 0) * 100)}%`,
                            background: node.color,
                          }}
                        />
                      </span>
                    </button>

                    <div className="relative flex items-center gap-0.5 flex-wrap justify-center">
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
                        title={isMonitor
                          ? (on ? "Mute analysis tap" : "Enable analysis tap")
                          : (on ? `Bypass ${node.label}` : `Enable ${node.label}`)}
                        aria-pressed={on}
                      >
                        {on ? "On" : "Off"}
                      </button>
                      {isMonitor ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextF = toggleScopeFreeze();
                            setScopeFreeze(nextF);
                          }}
                          className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider transition ${
                            scopeFreeze
                              ? "border-sky-300/50 bg-sky-400/20 text-sky-100"
                              : "border-white/10 bg-black/30 text-white/40 hover:text-white/70 hover:border-white/25"
                          }`}
                          title={scopeFreeze ? "Unfreeze Lumen Trace" : "Freeze Lumen Trace"}
                          aria-pressed={scopeFreeze}
                        >
                          {scopeFreeze ? "Frozen" : "Freeze"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => onNodeFocus(node.moduleId, e)}
                          className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider transition ${
                            focused
                              ? "border-white/40 bg-white/15 text-white"
                              : "border-white/10 bg-black/30 text-white/40 hover:text-white/70 hover:border-white/25"
                          }`}
                          title={focused ? "Exit Δ Focus" : `Δ Focus ${node.label}`}
                          aria-pressed={focused}
                        >
                          {focused ? "Δ·" : "Δ"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu(menu?.kind === "path" && menu.id === node.id ? null : { kind: "path", id: node.id });
                        }}
                        className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[8px] font-bold text-white/45 hover:text-white/80 transition"
                        title="Stage menu"
                      >
                        ⋯
                      </button>
                      {menu?.kind === "path" && menu.id === node.id && (
                        <StageMenu
                          open
                          onClose={() => setMenu(null)}
                          items={pathMenuItems(node, i)}
                        />
                      )}
                    </div>
                  </div>
                  {next && (
                    <div
                      onMouseEnter={() => setHoverCable(i)}
                      onMouseLeave={() => setHoverCable(null)}
                      style={{ filter: hoverCable === i ? "brightness(1.35)" : undefined }}
                    >
                      <PathCable
                        from={node.color}
                        to={next.color}
                        lit={lit}
                        on={on}
                        nextOn={pathOn[next.id]}
                        monitor={!!cableToMonitor || isMonitor}
                        delay={i * 0.2}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Control Path rail */}
          <div className="mt-2.5 flex flex-wrap items-stretch gap-1.5">
            <div className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/25 px-2 py-1.5">
              <div className="text-[8px] font-black uppercase tracking-[0.2em] text-white/35">Control Path</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => jumpToSynthBand("band.mod")}
                  className="rounded-md border px-2 py-1 text-left transition hover:bg-white/[0.06]"
                  style={{ borderColor: `${FC_BAND.mod}44`, color: FC_BAND.mod }}
                  title="Jump to Modulation band"
                >
                  <div className="text-[9px] font-black uppercase tracking-wider">MOD</div>
                  <div className="text-[8px] text-white/40">→ Sources / Filter / FX / Mix</div>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToSynthBand("band.perf")}
                  className="rounded-md border px-2 py-1 text-left transition hover:bg-white/[0.06]"
                  style={{ borderColor: `${FC_BAND.perf}44`, color: FC_BAND.perf }}
                  title="Jump to Performance band"
                >
                  <div className="text-[9px] font-black uppercase tracking-wider">PERF</div>
                  <div className="text-[8px] text-white/40">→ notes / rhythm / scenes / macros</div>
                </button>
              </div>
            </div>
          </div>

          {/* FX mini-rack */}
          {fxExpanded && (
            <div className="mt-2 rounded-lg border border-white/[0.09] bg-black/30 px-2 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: FC_BAND.fx }}>
                  FX rack
                </span>
                <button
                  type="button"
                  className="text-[9px] text-white/40 hover:text-white/70"
                  onClick={() => setFxExpanded(false)}
                >
                  Collapse
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-7">
                {FX_RACK.map((fx) => {
                  const enabled = moduleEnable[fx.id] !== false;
                  const wet = fx.wetKey ? Number(patchSlice[fx.wetKey as keyof typeof patchSlice] ?? 0) : 0;
                  const wetPct = Math.round(clamp01(wet) * 100);
                  return (
                    <div
                      key={fx.id}
                      className={`rounded-md border px-1.5 py-1 ${enabled ? "" : "opacity-45 grayscale"}`}
                      style={{
                        borderColor: enabled ? `${FC_BAND.fx}33` : "rgba(255,255,255,0.12)",
                        background: enabled ? `${FC_BAND.fx}0c` : "rgba(0,0,0,0.35)",
                      }}
                    >
                      <button
                        type="button"
                        className="w-full truncate text-left text-[9px] font-semibold"
                        style={{ color: enabled ? FC_BAND.fx : "rgba(255,255,255,0.4)" }}
                        onClick={() => jump(fx.id)}
                        title={enabled ? `Open ${fx.label}` : `${fx.label} — Asleep`}
                      >
                        {fx.label}
                        {!enabled && <span className="ml-1 text-[7px] text-white/35">zzz</span>}
                      </button>
                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        <button
                          type="button"
                          onClick={() => setModuleEnable(fx.id, !enabled)}
                          className={`rounded border px-1 text-[7px] font-bold ${
                            enabled
                              ? "border-emerald-400/40 text-emerald-200"
                              : "border-white/15 text-white/40"
                          }`}
                          title={enabled ? `Sleep ${fx.label}` : `Wake ${fx.label}`}
                        >
                          {enabled ? "On" : "Zzz"}
                        </button>
                        <span className="font-mono text-[8px] text-white/45">{wetPct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inspect strip */}
          {inspect && (
            <div className="mt-2 rounded-lg border border-white/[0.09] bg-black/30 px-2.5 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/55">
                  Inspect · {inspect === "filter" ? "FILTER" : "DRIVE"}
                </span>
                <button type="button" className="text-[9px] text-white/40 hover:text-white/70" onClick={() => setInspect(null)}>
                  Close
                </button>
              </div>
              {inspect === "filter" ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block text-[8px] uppercase tracking-wider text-white/40">
                    Cutoff
                    <input
                      type="range"
                      min={30}
                      max={18000}
                      step={1}
                      value={patchSlice.filterCutoff}
                      onChange={(e) => setParam("filterCutoff", Number(e.target.value))}
                      className="mt-1 w-full accent-orange-400"
                    />
                    <span className="font-mono text-[9px] text-white/55">{Math.round(patchSlice.filterCutoff)} Hz</span>
                  </label>
                  <label className="block text-[8px] uppercase tracking-wider text-white/40">
                    Resonance
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={0.1}
                      value={patchSlice.filterResonance}
                      onChange={(e) => setParam("filterResonance", Number(e.target.value))}
                      className="mt-1 w-full accent-orange-400"
                    />
                    <span className="font-mono text-[9px] text-white/55">{patchSlice.filterResonance.toFixed(1)}</span>
                  </label>
                  <label className="block text-[8px] uppercase tracking-wider text-white/40">
                    Env amount
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={patchSlice.filterEnvAmount ?? 0}
                      onChange={(e) => setParam("filterEnvAmount", Number(e.target.value))}
                      className="mt-1 w-full accent-orange-400"
                    />
                    <span className="font-mono text-[9px] text-white/55">
                      {Math.round((patchSlice.filterEnvAmount ?? 0) * 100)}%
                    </span>
                  </label>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-[8px] uppercase tracking-wider text-white/40">
                    Drive
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={patchSlice.drive ?? 0}
                      onChange={(e) => setParam("drive", Number(e.target.value))}
                      className="mt-1 w-full accent-rose-400"
                    />
                    <span className="font-mono text-[9px] text-white/55">
                      {Math.round((patchSlice.drive ?? 0) * 100)}% · {patchSlice.driveMode}
                    </span>
                  </label>
                  <div className="flex flex-wrap items-end gap-1">
                    {(["soft", "hard", "tube", "fold"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setParam("driveMode", mode)}
                        className={`rounded border px-2 py-1 text-[9px] font-semibold capitalize ${
                          patchSlice.driveMode === mode
                            ? "border-rose-400/50 bg-rose-400/20 text-rose-100"
                            : "border-white/15 text-white/45 hover:text-white/70"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Command Map atlas ── */}
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
              lock · MUT · routes · Shift=Δ Focus
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
                      borderTop: `2px solid ${band.color}88`,
                    }}
                  >
                    <div className="mb-0.5 px-0.5">
                      <div
                        className="text-[9px] font-black uppercase tracking-[0.16em] truncate"
                        style={{ color: band.color }}
                      >
                        {band.short}
                      </div>
                      <div className="truncate text-[7px] leading-tight text-white/30">{band.hint}</div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {band.modules.map((mod) => {
                        const focused = focusId === mod.id;
                        const enabled = moduleEnable[mod.id] !== false;
                        const locked = !!moduleLocks[mod.id];
                        const routes = routeCountForModule(mod.id);
                        const hot = moduleActiveHint(mod.id, enabled);
                        const sceneHint = mod.id === "scenes" && activeSceneSlot != null
                          ? `S${activeSceneSlot + 1}`
                          : mod.id === "gate" && gateOn
                            ? "gate"
                            : mod.id === "arp" && arpOn
                              ? "arp"
                              : null;
                        return (
                          <div
                            key={mod.id}
                            className={`relative flex items-center gap-0.5 min-w-0 ${enabled ? "" : "opacity-45"}`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                if (e.shiftKey) {
                                  if (focusId === mod.id) exitFocus();
                                  else enterFocus(mod.id);
                                  return;
                                }
                                jump(mod.id);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setMenu({ kind: "mod", id: mod.id });
                              }}
                              className="min-w-0 flex-1 truncate rounded-md border px-1.5 py-1 text-left text-[9px] font-semibold uppercase tracking-wide transition hover:bg-white/[0.06]"
                              style={{
                                color: enabled ? mod.color : "rgba(255,255,255,0.4)",
                                borderColor: focused
                                  ? `${mod.color}88`
                                  : enabled
                                    ? `${mod.color}28`
                                    : "rgba(255,255,255,0.12)",
                                background: focused
                                  ? `${mod.color}22`
                                  : enabled
                                    ? "transparent"
                                    : "rgba(0,0,0,0.35)",
                                filter: enabled ? undefined : "grayscale(0.75)",
                                boxShadow: hot && enabled ? `0 0 8px ${mod.color}33` : undefined,
                              }}
                              title={`${mod.title}${mod.subtitle ? ` — ${mod.subtitle}` : ""}${!enabled ? " · ASLEEP" : ""}${routes ? ` · ${routes} routes` : ""}${locked ? " · LOCKED" : " · MUT eligible"}`}
                            >
                              {mod.short}
                              {!enabled && (
                                <span className="ml-1 font-mono text-[7px] text-white/35 normal-case tracking-normal">
                                  zzz
                                </span>
                              )}
                              {sceneHint && (
                                <span className="ml-1 font-mono text-[7px] text-white/40 normal-case tracking-normal">
                                  {sceneHint}
                                </span>
                              )}
                            </button>
                            <span className="flex shrink-0 items-center gap-px">
                              {locked && (
                                <span className="rounded border border-amber-400/40 px-0.5 text-[7px] font-bold text-amber-200/90" title="Locked from randomize">
                                  L
                                </span>
                              )}
                              {!locked && (
                                <span className="rounded border border-violet-400/30 px-0.5 text-[7px] font-bold text-violet-200/70" title="Eligible for Natural Selection / mutate">
                                  M
                                </span>
                              )}
                              {routes > 0 && (
                                <span className="rounded border border-sky-400/35 px-0.5 font-mono text-[7px] text-sky-200/80" title="Mod routes">
                                  {routes}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setModuleEnable(mod.id, !enabled);
                                }}
                                className={`rounded-md border px-1 py-1 text-[8px] font-bold transition ${
                                  enabled
                                    ? hot
                                      ? "border-emerald-300/55 bg-emerald-400/25 text-emerald-100"
                                      : "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                                    : "border-white/15 bg-black/55 text-white/40 hover:text-white/65"
                                }`}
                                title={enabled ? `Sleep ${mod.title} (module offline)` : `Wake ${mod.title}`}
                                aria-label={`${enabled ? "Sleep" : "Wake"} ${mod.title}`}
                                aria-pressed={enabled}
                                style={hot && enabled ? { animation: "fire-path-pulse 1.8s ease-in-out infinite" } : undefined}
                              >
                                {enabled ? "On" : "Zzz"}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenu(menu?.kind === "mod" && menu.id === mod.id ? null : { kind: "mod", id: mod.id });
                                }}
                                className="rounded border border-white/10 px-0.5 py-1 text-[8px] text-white/35 hover:text-white/70"
                                title="Module menu"
                              >
                                ⋯
                              </button>
                            </span>
                            {menu?.kind === "mod" && menu.id === mod.id && (
                              <div className="absolute right-0 top-full z-40">
                                <StageMenu open onClose={() => setMenu(null)} items={modMenuItems(mod.id)} />
                              </div>
                            )}
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
