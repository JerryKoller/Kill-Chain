import { useMemo } from "react";
import {
  SOUND_PARAM_META,
  isBipolar,
  type ParamMeta,
  type SoundParams,
} from "@/audio/types";

interface Props {
  /** The currently-audible params (what we render the slider position from). */
  values: SoundParams;
  /** Update a single param. */
  onChange: <K extends keyof SoundParams>(key: K, value: SoundParams[K]) => void;
  /** Optional: per-axis confidence in [-1, 1] from the adaptive engine. */
  confidence?: Partial<Record<keyof SoundParams, number>>;
}

const GROUPS: { title: string; keys: (keyof SoundParams)[] }[] = [
  {
    title: "Tone",
    keys: [
      "subBass", "bass", "warmth", "body", "mid",
      "vocals", "presence", "clarity", "air", "sparkle",
    ],
  },
  {
    title: "Dynamics",
    keys: ["punch", "texture", "compression"],
  },
  {
    title: "Space",
    keys: ["width", "spatial", "reverbAmount", "reverbSize"],
  },
  {
    title: "Color",
    keys: ["harmonics", "saturation"],
  },
];

/**
 * Direct, live-editable sliders for every signature attribute. Dragging
 * any slider applies the change to the engine immediately AND to the
 * running calibration profile so the radar / question state stays in sync.
 */
export function SignatureSliders({ values, onChange, confidence }: Props) {
  const grouped = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: g.keys
          .map((k) => SOUND_PARAM_META.find((m) => m.key === k))
          .filter((x): x is ParamMeta => Boolean(x)),
      })),
    [],
  );

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.title}>
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2">
            {group.title}
          </div>
          <div className="space-y-1.5">
            {group.items.map((meta) => (
              <SignatureSlider
                key={meta.key}
                meta={meta}
                value={values[meta.key]}
                onChange={(v) => onChange(meta.key, v)}
                confidence={confidence?.[meta.key]}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SignatureSlider({
  meta,
  value,
  onChange,
  confidence,
}: {
  meta: ParamMeta;
  value: number;
  onChange: (v: number) => void;
  confidence?: number;
}) {
  const bipolar = isBipolar(meta.key);
  const lo = bipolar ? -1 : 0;
  const hi = 1;
  const pct = ((value - lo) / (hi - lo)) * 100;
  // Bipolar centre at 50%; unipolar starts at 0.
  const fillFromPct = bipolar ? 50 : 0;
  const fillStart = Math.min(fillFromPct, pct);
  const fillWidth = Math.abs(pct - fillFromPct);

  const conf = confidence ?? 0;
  const confTint = Math.min(1, Math.abs(conf));

  return (
    <div className="group flex items-center gap-3">
      <div className="w-24 shrink-0 text-[11px] tracking-wide text-white/85 truncate" title={meta.hint}>
        {meta.label}
      </div>
      <div className="relative flex-1 h-7 flex items-center">
        {/* Track background */}
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/[0.06]" />
        {/* Centre tick for bipolar */}
        {bipolar && (
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-3 w-px bg-white/15" />
        )}
        {/* Fill */}
        <div
          className="absolute h-1.5 rounded-full transition-colors"
          style={{
            left: `${fillStart}%`,
            width: `${fillWidth}%`,
            background: meta.color,
            boxShadow: `0 0 14px ${meta.color}88`,
          }}
        />
        {/* Confidence halo */}
        {confTint > 0.05 && (
          <div
            className="absolute h-2 rounded-full pointer-events-none"
            style={{
              left: `${fillStart}%`,
              width: `${fillWidth}%`,
              background: meta.color,
              opacity: confTint * 0.35,
              filter: "blur(6px)",
            }}
          />
        )}
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full pointer-events-none transition-transform group-hover:scale-110"
          style={{
            left: `${pct}%`,
            background: "#fff",
            border: `2px solid ${meta.color}`,
            boxShadow: `0 0 12px ${meta.color}, 0 0 0 1px rgba(0,0,0,0.6)`,
          }}
        />
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0)}
          className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
          title={`${meta.label} · ${meta.hint} · double-click to reset`}
        />
      </div>
      <div className="w-12 shrink-0 text-right text-[10px] font-mono text-dim tabular-nums">
        {bipolar
          ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}`
          : `${Math.round(value * 100)}`}
      </div>
    </div>
  );
}
