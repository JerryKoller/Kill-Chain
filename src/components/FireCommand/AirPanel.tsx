/**
 * Air panel helpers — Sky Shelf characters, snaps, meters.
 * Used by AirPanel in FireCommandView (needs FParamKnob / Section).
 */

import { useFireCommandStore } from "@/state/fireCommandStore";
import { FC, FC_BAND, bandShade } from "./fireColors";

export const AIR_C = FC.air;
export const AIR_C_GLOW = bandShade(FC_BAND.mix, 0.92);
export const AIR_C_HOT = bandShade(FC_BAND.mix, 0.66);
export const AIR_C_LOW = bandShade(FC_BAND.mix, 0.4);
export const AIR_C_HIGH = bandShade(FC_BAND.mix, 0.78);
export const AIR_C_AMT = bandShade(FC_BAND.mix, 0.86);

export const AIR_CHARS = [
  { id: "flat", label: "Flat", low: 0, high: 0, amt: 0 },
  { id: "warm", label: "Warm", low: 0.45, high: -0.15, amt: 0.55 },
  { id: "bright", label: "Bright", low: -0.1, high: 0.55, amt: 0.6 },
  { id: "air", label: "Air", low: 0, high: 0.7, amt: 0.65 },
  { id: "bass", label: "Bass", low: 0.6, high: 0, amt: 0.5 },
  { id: "scoop", label: "Scoop", low: -0.35, high: 0.5, amt: 0.55 },
  { id: "lift", label: "Lift", low: 0.35, high: 0.4, amt: 0.5 },
] as const;

export const AIR_AMT_SNAPS = [
  { label: "0", v: 0 },
  { label: "25", v: 0.25 },
  { label: "50", v: 0.5 },
  { label: "75", v: 0.75 },
  { label: "100", v: 1 },
] as const;

function near(a: number, b: number, eps = 0.06) {
  return Math.abs(a - b) < eps;
}

export function airStageLabel(low: number, high: number, amt: number): string {
  if (amt < 0.03) return "Flat";
  if (Math.abs(low) < 0.08 && Math.abs(high) < 0.08) return "Idle";
  if (low > 0.2 && high < -0.05) return "Warm";
  if (high > 0.35 && low < 0.1) return "Air";
  if (low > 0.25 && high > 0.2) return "Lift";
  if (low < -0.2 && high > 0.2) return "Scoop";
  if (low > 0.3) return "Bass";
  if (high > 0.25) return "Bright";
  return "Shelf";
}

export function airMetrics(low: number, high: number, amt: number) {
  const a = Math.max(0, Math.min(1, amt));
  return {
    lowDb: Math.max(-1, Math.min(1, low)) * 12 * a,
    highDb: Math.max(-1, Math.min(1, high)) * 10 * a,
  };
}

export function AirMeter({
  label,
  value,
  color,
  format,
  bipolar,
}: {
  label: string;
  value: number;
  color: string;
  format: () => string;
  bipolar?: boolean;
}) {
  const abs = Math.abs(value);
  const pos = value >= 0;
  const width = bipolar ? abs * 50 : Math.max(0, Math.min(1, value)) * 100;
  const left = bipolar ? (pos ? "50%" : `${50 - abs * 50}%`) : "0%";
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.1rem]" title={`${label} ${format()}`}>
      <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: `${color}aa` }}>
        {label}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute top-0 h-full rounded-full transition-[width,left] duration-75"
          style={{
            width: `${width}%`,
            left,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: abs > 0.04 ? `0 0 8px ${color}88` : undefined,
          }}
        />
        {bipolar && <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />}
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: abs > 0.03 ? color : "rgba(255,255,255,0.3)" }}>
        {format()}
      </div>
    </div>
  );
}

export function AirCharacterStrip() {
  const low = useFireCommandStore((s) => s.patch.airLow) ?? 0;
  const high = useFireCommandStore((s) => s.patch.airHigh) ?? 0;
  const amt = useFireCommandStore((s) => s.patch.airAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  const c = AIR_C;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${c}66` }}>
        Sky
      </span>
      {AIR_CHARS.map((p) => {
        const on =
          (p.id === "flat" && amt < 0.04) ||
          (p.id !== "flat" && near(low, p.low) && near(high, p.high) && near(amt, p.amt, 0.1));
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setParam("airLow", p.low);
              setParam("airHigh", p.high);
              setParam("airAmount", p.amt);
            }}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold transition"
            style={
              on
                ? {
                    borderColor: `${c}99`,
                    background: `${c}33`,
                    color: AIR_C_GLOW,
                    boxShadow: `0 0 10px ${c}44`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function AirAmountStrip() {
  const amt = useFireCommandStore((s) => s.patch.airAmount) ?? 0;
  const setParam = useFireCommandStore((s) => s.setParam);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-1 text-[8px] font-black uppercase tracking-wider" style={{ color: `${AIR_C}66` }}>
        Amt
      </span>
      {AIR_AMT_SNAPS.map((p) => {
        const on = near(amt, p.v, 0.04);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => setParam("airAmount", p.v)}
            className="rounded-md border px-2 py-0.5 text-[9px] font-bold tabular-nums transition"
            style={
              on
                ? {
                    borderColor: `${AIR_C_AMT}99`,
                    background: `${AIR_C_AMT}28`,
                    color: AIR_C_GLOW,
                    boxShadow: `0 0 8px ${AIR_C}33`,
                  }
                : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
            }
            title={`Amount ${p.label}%`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function AirQuickActions() {
  const setParam = useFireCommandStore((s) => s.setParam);
  const setModuleEnable = useFireCommandStore((s) => s.setModuleEnable);
  const enabled = useFireCommandStore((s) => s.patch.moduleEnable?.["air"] !== false);
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={() => {
          setParam("airLow", 0);
          setParam("airHigh", 0);
          setParam("airAmount", 0);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${AIR_C}55`, color: AIR_C_GLOW, background: `${AIR_C}1c` }}
        title="Flatten shelves"
      >
        Flat
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("airLow", 0);
          setParam("airHigh", 0.65);
          setParam("airAmount", 0.6);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${AIR_C}55`, color: AIR_C_GLOW, background: `${AIR_C}1c` }}
        title="Classic air lift"
      >
        Air
      </button>
      <button
        type="button"
        onClick={() => {
          setParam("airLow", 0.4);
          setParam("airHigh", -0.2);
          setParam("airAmount", 0.55);
        }}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
        style={{ borderColor: `${AIR_C}55`, color: AIR_C_GLOW, background: `${AIR_C}1c` }}
        title="Warm low shelf"
      >
        Warm
      </button>
      <button
        type="button"
        onClick={() => setModuleEnable("air", !enabled)}
        className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
        style={
          enabled
            ? { borderColor: `${AIR_C}66`, color: AIR_C_GLOW, background: `${AIR_C}22` }
            : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
        }
        title={enabled ? "Bypass air shelves" : "Engage air"}
      >
        {enabled ? "On" : "Bypass"}
      </button>
    </div>
  );
}
