/**
 * Compact A → B → C relationship map for the Sources band.
 * Clarifies Prime / Twin / Depth architecture vs Chip · Noise · Sub.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, bandShade } from "./fireColors";
import { jumpToModule } from "./fireNavigate";
import type { FireModuleId } from "./fireModuleAtlas";

function levelLit(level: number) {
  return level >= 0.02;
}

export function SourceRelationshipStrip() {
  const a = useFireCommandStore((s) => s.patch.oscALevel);
  const b = useFireCommandStore((s) => s.patch.oscBLevel);
  const c = useFireCommandStore((s) => s.patch.oscCLevel);
  const noise = useFireCommandStore((s) => s.patch.noiseLevel);
  const sub = useFireCommandStore((s) => s.patch.subLevel);
  const stretch = useFireCommandStore((s) => s.patch.warpStretch) ?? 0;
  const tilt = useFireCommandStore((s) => s.patch.warpTilt) ?? 0;
  const comb = useFireCommandStore((s) => s.patch.warpComb) ?? 0;
  const forging = Math.abs(stretch) > 0.01 || Math.abs(tilt) > 0.01 || comb > 0.01;

  const src = FC_BAND_SOURCES;
  const go = (id: FireModuleId) => jumpToModule(id);

  return (
    <div
      className="mb-3 rounded-xl border px-3 py-2.5"
      style={{
        borderColor: `${src}44`,
        background: `linear-gradient(135deg, ${src}18 0%, rgba(0,0,0,0.45) 55%, ${FC.warp}12 100%)`,
        boxShadow: `inset 0 1px 0 ${src}22`,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: `${src}aa` }}>
          Source architecture
        </div>
        <div className="font-mono text-[10px] tabular-nums" style={{ color: forging ? bandShade(FC.sources, 0.85) : "rgba(255,255,255,0.35)" }}>
          {forging ? "FORGE ON" : "FORGE OFF"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px] font-semibold leading-none">
        <NodeBtn label="A PRIME" lit={levelLit(a)} color={FC.oscA} onClick={() => go("osc.a")} title="Prime Voice — identity" />
        <Edge />
        <NodeBtn label="B TWIN" lit={levelLit(b)} color={FC.oscB} onClick={() => go("osc.b")} title="Twin Voice — relationship to A" />
        <Edge />
        <NodeBtn label="C DEPTH" lit={levelLit(c)} color={FC.oscC} onClick={() => go("osc.c")} title="Depth Voice — pitched body (not Sub)" />
        <span className="mx-1 text-[10px] font-black" style={{ color: `${FC.warp}99` }}>
          →
        </span>
        <NodeBtn
          label="HARMONIC FORGE"
          lit={forging}
          color={FC.warp}
          onClick={() => go("fire.sec.warp")}
          title="Shared spectral transform for A · B · C"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] font-semibold">
        <NodeBtn label="CHIP" lit={false} soft color={FC.chip} onClick={() => go("chip")} title="Acid Circuit — discrete digital character" />
        <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
        <NodeBtn label="NOISE" lit={levelLit(noise)} color={FC.noise} onClick={() => go("noise")} title="Grain Storm — stochastic texture" />
        <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
        <NodeBtn label="SUB" lit={levelLit(sub)} color={FC.sub} onClick={() => go("sub")} title="Tectonic — protected mono foundation" />
        <span className="ml-1 font-mono text-[9px] font-normal" style={{ color: "rgba(255,255,255,0.32)" }}>
          parallel · join at mixer
        </span>
      </div>

      <div className="mt-2 font-mono text-[10px] leading-snug" style={{ color: "rgba(255,255,255,0.38)" }}>
        A creates identity · B creates relationship · C creates body · Forge reshapes their harmonic DNA
      </div>
    </div>
  );
}

const FC_BAND_SOURCES = FC.sources;

function Edge() {
  return (
    <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }} aria-hidden>
      ──
    </span>
  );
}

function NodeBtn({
  label,
  lit,
  color,
  onClick,
  title,
  soft,
}: {
  label: string;
  lit: boolean;
  color: string;
  onClick: () => void;
  title: string;
  soft?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-md border px-2 py-1 transition hover:brightness-125"
      style={{
        borderColor: lit ? `${color}99` : soft ? `${color}33` : "rgba(255,255,255,0.12)",
        background: lit ? `${color}30` : soft ? `${color}10` : "rgba(0,0,0,0.35)",
        color: lit ? bandShade(FC.sources, 0.92) : soft ? `${color}bb` : "rgba(255,255,255,0.45)",
        boxShadow: lit ? `0 0 12px ${color}44` : undefined,
      }}
    >
      {label}
    </button>
  );
}
