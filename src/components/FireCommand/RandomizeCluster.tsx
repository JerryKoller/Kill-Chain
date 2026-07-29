/**
 * Armory Deploy (Randomize) — visual twin to Natural Selection.
 * Spin the chamber, optionally lock to a category, land on a factory voice.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFireCommandStore,
  FIRE_PRESETS,
  PRESET_CATEGORIES,
} from "@/state/fireCommandStore";
import { lockedModuleCount } from "@/lib/fireModuleLocks";
import { useUIStore } from "@/state/uiStore";

function DiceMark({ spinning, size = 22 }: { spinning: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={spinning ? "animate-[dice-tumble_0.65s_ease-in-out]" : undefined}
      style={{ transformOrigin: "50% 50%" }}
    >
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="4"
        stroke="#ffb48a"
        strokeWidth="1.6"
        fill="rgba(255,106,61,0.12)"
      />
      <circle cx="8.2" cy="8.2" r="1.35" fill="#ffd9c9" />
      <circle cx="12" cy="12" r="1.35" fill="#ffd9c9" />
      <circle cx="15.8" cy="15.8" r="1.35" fill="#ffd9c9" />
      <circle cx="15.8" cy="8.2" r="1.15" fill="#ff9a6b" opacity="0.85" />
      <circle cx="8.2" cy="15.8" r="1.15" fill="#ff9a6b" opacity="0.85" />
    </svg>
  );
}

const SCOPES = ["all", ...PRESET_CATEGORIES] as const;

export function RandomizeCluster({ compact = false }: { compact?: boolean }) {
  const presetId = useFireCommandStore((s) => s.presetId);
  const moduleLocks = useFireCommandStore((s) => s.moduleLocks);
  const lockedCount = lockedModuleCount(moduleLocks);
  const toast = useUIStore((s) => s.toast);
  const [scope, setScope] = useState<string>("all");
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<{ name: string; category: string } | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => () => {
    for (const id of timeoutsRef.current) window.clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  const poolSize = useMemo(() => {
    return FIRE_PRESETS.filter(
      (p) =>
        p.id !== presetId &&
        p.id !== "init" &&
        (scope === "all" || p.category === scope),
    ).length;
  }, [presetId, scope]);

  const deploy = () => {
    if (poolSize === 0) {
      toast("Armory empty for that filter — try All");
      return;
    }
    setSpinning(true);
    // Brief spin so the dice animation can read, then land.
    timeoutsRef.current.push(window.setTimeout(() => {
      // Store-side deploy keeps locked modules untouched.
      const preset = useFireCommandStore.getState().deployArmoryPreset(scope);
      if (!preset) {
        setSpinning(false);
        toast("Armory empty for that filter — try All");
        return;
      }
      setLast({ name: preset.name, category: preset.category });
      toast(
        `🎲 Deployed: ${preset.name} · ${preset.category}${
          lockedCount > 0 ? ` · ${lockedCount} locked kept` : ""
        }`,
      );
      timeoutsRef.current.push(window.setTimeout(() => setSpinning(false), 120));
    }, 280));
  };

  if (compact) {
    return (
      <div className="relative flex h-full w-full flex-col justify-center gap-1.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0 h-8">
          <DiceMark spinning={spinning} size={18} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#ffc9b0] leading-none">
              Random Armory
            </div>
            <div
              className="text-[10px] text-white/48 truncate leading-none mt-0.5"
              title={last ? `${last.name} · ${last.category}` : "Spin the chamber — chance draw"}
            >
              {spinning
                ? "Spinning the chamber…"
                : last
                  ? `Hit: ${last.name}${lockedCount > 0 ? ` · ${lockedCount} locked` : ""}`
                  : `Feel lucky? · ${poolSize} in the chamber${lockedCount > 0 ? ` · ${lockedCount} locked` : ""}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 min-w-0 h-8">
          <button
            onClick={deploy}
            disabled={spinning}
            className="group h-8 flex-1 min-w-0 rounded-md px-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#ffe8dc] transition disabled:opacity-70 bg-[#ff6a3d]/22 hover:bg-[#ff6a3d]/35 ring-1 ring-[#ff6a3d]/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(255,106,61,0.65)]"
            title="Deploy a random factory preset from the armory"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <span className={spinning ? "animate-[dice-tumble_0.65s_ease-in-out]" : "group-hover:animate-[dice-tumble_0.65s_ease-in-out]"} aria-hidden>
                🎲
              </span>
              {spinning ? "Rolling…" : "Randomize"}
            </span>
          </button>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 w-[5.75rem] rounded-md bg-black/35 px-1.5 text-[10px] text-white/75 outline-none ring-1 ring-white/10 shrink-0"
            title="Limit the random draw to one preset category"
          >
            {SCOPES.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All" : c}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-stretch gap-2 rounded-2xl border px-2.5 py-2 min-h-[88px] transition ${
        spinning
          ? "border-[#ff6a3d]/70 bg-gradient-to-br from-[#ff6a3d]/22 via-[#ff9a6b]/10 to-transparent shadow-[0_0_32px_rgb(255_106_61/0.28)]"
          : "border-[#ff6a3d]/35 bg-gradient-to-br from-[#ff6a3d]/[0.12] to-transparent"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div
          className={`absolute -right-4 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-[#ff6a3d]/25 blur-2xl ${
            spinning
              ? "animate-[evolve-bloom_0.65s_ease-out]"
              : "animate-[evolve-breathe_3.4s_ease-in-out_infinite]"
          }`}
        />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#ff9a6b]/55 to-transparent" />
        {spinning && (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_40%,rgba(255,180,120,0.2),transparent_55%)]" />
        )}
      </div>

      <div className="relative z-10 flex flex-col justify-center gap-1 min-w-[158px] flex-1">
        <div className="flex items-center gap-1.5">
          <DiceMark spinning={spinning} />
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#ffd9c9] leading-none">
              Random Armory
            </div>
            <div className="text-[9px] text-[#ffbfa0]/50 mt-0.5 truncate">
              {last
                ? `${last.name}`
                : spinning
                  ? "Spinning the chamber…"
                  : `${poolSize} voices in play`}
            </div>
          </div>
        </div>

        <button
          onClick={deploy}
          disabled={spinning}
          className="group relative h-8 overflow-hidden rounded-xl border border-[#ff6a3d]/65 bg-[#ff6a3d]/20 hover:bg-[#ff6a3d]/30 text-[11px] font-black uppercase tracking-[0.14em] text-[#ffe8dc] transition shadow-[0_0_16px_rgb(255_106_61/0.3)] disabled:opacity-70"
          title="Deploy a random factory preset from the armory (optionally filtered by category)"
        >
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(255,217,201,0.35),transparent_55%)] opacity-70 group-hover:opacity-100 transition" />
          <span className="relative">{spinning ? "Deploying…" : "Randomize"}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-[8px] uppercase tracking-wider text-[#ffbfa0]/40 shrink-0">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="flex-1 min-w-0 h-6 rounded-md border border-[#ff6a3d]/25 bg-black/40 px-1.5 text-[9px] text-[#ffd9c9]/85 outline-none focus:border-[#ff6a3d]/60"
            title="Limit the random draw to one preset category"
          >
            {SCOPES.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All categories" : c}
              </option>
            ))}
          </select>
          <span
            className="shrink-0 text-[8px] font-mono uppercase tracking-[0.12em] text-[#ff9a6b]/75"
            title={lockedCount > 0 ? `${lockedCount} module(s) locked from mutation/random` : "No modules locked"}
          >
            LOCKED {lockedCount}
          </span>
        </div>
      </div>

      <div className="relative z-10 hidden xl:flex flex-col justify-center max-w-[110px] pl-2 border-l border-[#ff6a3d]/20">
        <div className="text-[9px] leading-snug text-[#ffbfa0]/40">
          Spin the chamber. Land on a factory voice. Instant armory strike.
        </div>
        {last && (
          <div className="mt-1 text-[8px] uppercase tracking-[0.14em] text-[#ff9a6b]/70 truncate" title={last.category}>
            {last.category}
          </div>
        )}
      </div>
    </div>
  );
}
