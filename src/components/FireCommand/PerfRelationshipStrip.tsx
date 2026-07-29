/**
 * Performance architecture strip — Scale → Chord → Harmony,
 * Gate → Humanize → Output, Helm modulates · Orbit captures.
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { jumpToModule } from "./fireNavigate";
import type { FireModuleId } from "./fireModuleAtlas";

export function PerfRelationshipStrip() {
  const scaleLock = useFireCommandStore((s) => s.patch.scaleLock);
  const scaleEn = useFireCommandStore((s) => s.patch.moduleEnable?.["scale"] !== false);
  const chordOn = useFireCommandStore((s) => s.patch.chordMemoryOn);
  const chordEn = useFireCommandStore((s) => s.patch.moduleEnable?.["chord"] !== false);
  const harmMode = useFireCommandStore((s) => s.patch.harmonyMode);
  const harmEn = useFireCommandStore((s) => s.patch.moduleEnable?.["harmony"] !== false);
  const harmLevel = useFireCommandStore((s) => s.patch.harmonyLevel) ?? 0;
  const gateOn = useFireCommandStore((s) => s.patch.gateOn);
  const gateEn = useFireCommandStore((s) => s.patch.moduleEnable?.["gate"] !== false);
  const humanOn = useFireCommandStore((s) => s.patch.humanizeOn);
  const humanEn = useFireCommandStore((s) => s.patch.moduleEnable?.["human"] !== false);
  const macrosEn = useFireCommandStore((s) => s.patch.moduleEnable?.["macros"] !== false);
  const m1 = useFireCommandStore((s) => s.patch.macro1) ?? 0;
  const m2 = useFireCommandStore((s) => s.patch.macro2) ?? 0;
  const m3 = useFireCommandStore((s) => s.patch.macro3) ?? 0;
  const m4 = useFireCommandStore((s) => s.patch.macro4) ?? 0;
  const scenes = useFireCommandStore((s) => s.scenes);
  const scaleId = useFireSequencerStore((s) => s.scaleId);

  const latticeLit = scaleEn && (scaleLock || scaleId !== "off");
  const stackLit = chordEn && chordOn;
  const kinLit = harmEn && harmMode !== "off" && harmLevel > 0.02;
  const shutterLit = gateEn && gateOn;
  const grainLit = humanEn && humanOn;
  const helmLit = macrosEn && Math.max(m1, m2, m3, m4) > 0.03;
  const orbitLit = (scenes ?? []).some((s) => s != null);

  const perf = FC_BAND.perf;
  const go = (id: FireModuleId) => jumpToModule(id);

  return (
    <div
      className="mb-3 rounded-xl border px-3 py-2.5"
      style={{
        borderColor: `${perf}44`,
        background: `linear-gradient(135deg, ${perf}18 0%, rgba(0,0,0,0.45) 55%, ${FC.scenes}12 100%)`,
        boxShadow: `inset 0 1px 0 ${perf}22`,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: `${perf}aa` }}>
          Performance architecture
        </div>
        <div
          className="font-mono text-[10px] tabular-nums"
          style={{ color: latticeLit ? bandShade(FC_BAND.perf, 0.85) : "rgba(255,255,255,0.35)" }}
        >
          {latticeLit ? "LATTICE ON" : "LATTICE OPEN"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px] font-semibold leading-none">
        <NodeBtn
          label="KEY LATTICE"
          lit={latticeLit}
          color={FC.scale}
          onClick={() => go("scale")}
          title="Pitch law — allowed notes / correction"
        />
        <Edge />
        <NodeBtn
          label="STACK VAULT"
          lit={stackLit}
          color={FC.chord}
          onClick={() => go("chord")}
          title="Chord construction & memory"
        />
        <Edge />
        <NodeBtn
          label="KIN HALO"
          lit={kinLit}
          color={FC.harmony}
          onClick={() => go("harmony")}
          title="Companion voices around what is played"
        />
        <span className="mx-1 text-[10px] font-black" style={{ color: `${perf}99` }}>
          →
        </span>
        <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
          OUTPUT
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] font-semibold">
        <NodeBtn
          label="RHYTHM SHUTTER"
          lit={shutterLit}
          color={FC.gate}
          onClick={() => go("gate")}
          title="Rhythmic audio gate"
        />
        <Edge />
        <NodeBtn
          label="FEEL GRAIN"
          lit={grainLit}
          color={FC.human}
          onClick={() => go("human")}
          title="Timing & velocity humanization"
        />
        <span className="mx-1 text-[10px] font-black" style={{ color: `${perf}99` }}>
          →
        </span>
        <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>
          OUTPUT
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-semibold">
        <NodeBtn
          label="HELM QUARTET"
          lit={helmLit}
          soft
          color={FC.macros}
          onClick={() => go("macros")}
          title="Macros modulate the synth via the matrix"
        />
        <span className="font-mono text-[9px] font-normal" style={{ color: "rgba(255,255,255,0.32)" }}>
          modulates
        </span>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
        <NodeBtn
          label="ORBIT VAULT"
          lit={orbitLit}
          soft
          color={FC.scenes}
          onClick={() => go("scenes")}
          title="Scenes capture and recall performance state"
        />
        <span className="font-mono text-[9px] font-normal" style={{ color: "rgba(255,255,255,0.32)" }}>
          captures
        </span>
      </div>

      <div className="mt-2 font-mono text-[10px] leading-snug" style={{ color: "rgba(255,255,255,0.38)" }}>
        Lattice sets pitch law · Stack builds chords · Kin adds companions · Shutter chops · Grain humanizes · Helm
        steers · Orbit remembers
      </div>
    </div>
  );
}

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
        color: lit ? bandShade(FC_BAND.perf, 0.92) : soft ? `${color}bb` : "rgba(255,255,255,0.45)",
        boxShadow: lit ? `0 0 12px ${color}44` : undefined,
      }}
    >
      {label}
    </button>
  );
}
