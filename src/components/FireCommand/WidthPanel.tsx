/**
 * Width panel helpers — Side Horizon characters, snaps, meters.
 * Used by WidthPanel in FireCommandView (needs FParamKnob / Section).
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { ModuleEnableToggle } from "./ModuleEnableToggle";

export const WIDTH_C = FC.width;
export const WIDTH_C_GLOW = bandShade(FC_BAND.mix, 0.92);
export const WIDTH_C_HOT = bandShade(FC_BAND.mix, 0.62);
export const WIDTH_C_MID = bandShade(FC_BAND.mix, 0.48);
export const WIDTH_C_SIDE = bandShade(FC_BAND.mix, 0.72);
export const WIDTH_C_CORR = bandShade(FC_BAND.mix, 0.84);
export const WIDTH_MAX = 1.4;

export const WIDTH_CHARS = [
  { id: "mono", label: "Mono", w: 0 },
  { id: "narrow", label: "Narrow", w: 0.45 },
  { id: "natural", label: "Natural", w: 1 },
  { id: "wide", label: "Wide", w: 1.15 },
  { id: "cinema", label: "Cinema", w: 1.25 },
  { id: "hyper", label: "Hyper", w: 1.4 },
] as const;

export const WIDTH_SNAPS = [
  { label: "0", v: 0 },
  { label: "50", v: 0.5 },
  { label: "100", v: 1 },
  { label: "120", v: 1.2 },
  { label: "140", v: 1.4 },
] as const;

function near(a: number, b: number, eps = 0.04) {
  return Math.abs(a - b) < eps;
}

export function widthStageLabel(w: number): string {
  if (w < 0.04) return "Mono";
  if (w < 0.55) return "Narrow";
  if (w < 0.95) return "Stereo";
  if (w < 1.15) return "Wide";
  return "Hyper";
}

export function widthMidSide(w: number): { mid: number; side: number; corr: number } {
  const side = Math.max(0, Math.min(1, w / WIDTH_MAX));
  const mid = Math.max(0.2, Math.min(1, 1 - side * 0.55));
  const corr = Math.max(0.05, Math.min(1, 1 - side * 0.85));
  return { mid, side, corr };
}

export function WidthMeter({
  label,
  value,
  color,
  format,
}: {
  label: string;
  value: number;
  color: string;
  format: () => string;
}) {
  const t = Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.1rem]" title={`${label} ${format()}`}>
      <div className="fc-text-floor font-black uppercase tracking-[0.06em]" style={{ color: `${color}aa` }}>
        {label}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.05 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {format()}
      </div>
    </div>
  );
}

export function WidthCharacterStrip() {
  const w = useFireCommandStore((s) => s.patch.stereoWidth) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = WIDTH_C;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${c}66` }}>
        Horizon
      </span>
      {WIDTH_CHARS.map((p) => {
        const on = near(w, p.w);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setParam("stereoWidth", p.w)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-black transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: WIDTH_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`${p.label} · ${Math.round(p.w * 100)}%`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function WidthSnapStrip() {
  const w = useFireCommandStore((s) => s.patch.stereoWidth) ?? 1;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${WIDTH_C}66` }}>
        Snap
      </span>
      {WIDTH_SNAPS.map((p) => {
        const on = near(w, p.v);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("stereoWidth", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-black tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${WIDTH_C_HOT}99`,
                    background: `${WIDTH_C_HOT}28`,
                    color: WIDTH_C_GLOW,
                    boxShadow: `0 0 8px ${WIDTH_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`Width ${p.label}%`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function WidthQuickActions() {
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => setParam("stereoWidth", 0)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${WIDTH_C}55`, color: WIDTH_C_GLOW, background: `${WIDTH_C}1c` }}
        title="Collapse to mono"
      >
        Mono
      </button>
      <button
        type="button"
        onClick={() => setParam("stereoWidth", 1)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${WIDTH_C}55`, color: WIDTH_C_GLOW, background: `${WIDTH_C}1c` }}
        title="True stereo (identity)"
      >
        Unity
      </button>
      <button
        type="button"
        onClick={() => setParam("stereoWidth", 1.4)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${WIDTH_C}55`, color: WIDTH_C_GLOW, background: `${WIDTH_C}1c` }}
        title="Maximum side boost"
      >
        Hyper
      </button>
      <ModuleEnableToggle
        moduleId="width"
        color={WIDTH_C}
        name="Stereo Width"
        onTextColor={WIDTH_C_GLOW}
        titleOn="Sleep Stereo Width (forces unity — same as Signal Path Off)"
      />
    </div>
  );
}
