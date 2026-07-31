/**
 * Dial character — per-band knob physicality.
 *
 * Every knob in Fire Command was the same SVG with a different accent colour,
 * so a filter cutoff felt identical to a reverb mix. Each band now gets its own
 * cap, pointer and track treatment, so the control under your finger tells you
 * which part of the instrument you're in before you read a single label:
 *
 *   SRC  blade    hard-edged notched cap, triangular blade pointer  (raw voice)
 *   TONE rings    concentric grooves, fine crosshair pointer        (precision)
 *   MOD  orbit    stub pointer with a satellite riding the arc      (motion)
 *   FX   lens     soft glowing lens cap, no hard pointer            (atmosphere)
 *   MIX  console  flat fader cap, segmented LED ladder track        (metering)
 *   PERF gem      faceted diamond cap, bright vertex                (performance)
 *
 * The band is derived from the knob's `paramKey`, so the ~190 existing call
 * sites pick their character up for free. Geometry stays inside the same
 * `size` box and interaction is untouched — this is skin only.
 */

import { FIRE_FOCUS_RING } from "./fireKnobFocus";
import { FIRE_MODULES, type FireBandId } from "./fireModuleAtlas";

export type DialCharacter = "blade" | "rings" | "orbit" | "lens" | "console" | "gem" | "plain";

const BAND_CHARACTER: Record<FireBandId, DialCharacter> = {
  "band.sources": "blade",
  "band.tone": "rings",
  "band.mod": "orbit",
  "band.fx": "lens",
  "band.mix": "console",
  "band.perf": "gem",
};

/** paramKey → owning module id, from the MPK focus registry. */
const PARAM_MODULE = new Map<string, string>();
for (const mod of FIRE_FOCUS_RING) {
  for (const k of mod.knobs) {
    if (!PARAM_MODULE.has(k.key as string)) PARAM_MODULE.set(k.key as string, mod.id);
  }
}

const MODULE_BAND = new Map<string, FireBandId>();
for (const m of FIRE_MODULES) MODULE_BAND.set(m.id, m.bandKey);

/**
 * Params the focus registry doesn't list (it deliberately omits matrix, arp,
 * faders, morph and scenes) still need a band, so match on key prefix.
 */
const PREFIX_BAND: Array<[RegExp, FireBandId]> = [
  [/^(osc[ABC]|warp|chip|noise|sub|unison)/i, "band.sources"],
  [/^(filter|filt|amp|velAttack|lpg|pluck|drift|voiceInstability|tuneVariance|envVariance|analog)/i, "band.tone"],
  [/^(lfo|fm|ring|pitch|glide|bend|slide|arp|mod(Env|Matrix))/i, "band.mod"],
  [/^(drive|crush|tone|cassette|tape|wow|vhs|bit|sampleRate|bbd|analogComp|dust|hiss|hum|print|age|phaser|chorus|delay|reverb|spectral)/i, "band.fx"],
  [/^(mixer|master|glue|punch|air|width|mono|stereo|scope|limiter|ceiling|lowProtect)/i, "band.mix"],
  [/^(macro|scene|gate|harmony|chord|scale|human|velocity|kbd)/i, "band.perf"],
];

const charCache = new Map<string, DialCharacter>();

/** Resolve a knob's character from its patch key. Unknown keys stay `plain`. */
export function dialCharacterFor(paramKey?: string): DialCharacter {
  if (!paramKey) return "plain";
  const hit = charCache.get(paramKey);
  if (hit) return hit;
  let band: FireBandId | undefined;
  const modId = PARAM_MODULE.get(paramKey);
  if (modId) band = MODULE_BAND.get(modId);
  if (!band) {
    for (const [re, b] of PREFIX_BAND) {
      if (re.test(paramKey)) {
        band = b;
        break;
      }
    }
  }
  const out = band ? BAND_CHARACTER[band] : "plain";
  charCache.set(paramKey, out);
  return out;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const s = polar(cx, cy, r, a1);
  const e = polar(cx, cy, r, a0);
  const large = a1 - a0 <= 180 ? "0" : "1";
  return ["M", s.x, s.y, "A", r, r, 0, large, 0, e.x, e.y].join(" ");
}

export type DialCapProps = {
  character: DialCharacter;
  size: number;
  cx: number;
  cy: number;
  r: number;
  /** Pointer angle in degrees, −135..135. */
  angle: number;
  /** Fill sweep (bipolar dials fill out from centre). */
  fillFrom: number;
  fillTo: number;
  /** Normalized value 0..1. */
  t: number;
  color: string;
  dragging: boolean;
};

/**
 * The band-specific body of a dial: cap, track, fill and pointer. The caller
 * still owns the modulation arcs and the live-mod dot so those stay uniform
 * across every band (they mean the same thing everywhere).
 */
export function DialCap({
  character, size, cx, cy, r, angle, fillFrom, fillTo, t, color, dragging,
}: DialCapProps) {
  const glow = dragging ? `drop-shadow(0 0 5px ${color})` : `drop-shadow(0 0 2px ${color})`;
  const tip = polar(cx, cy, r - 2, angle);

  // ── shared base plate ──
  const base = (
    <>
      <circle cx={cx} cy={cy} r={r + 2} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.07)" />
      <path d={arc(cx, cy, r, -135, 135)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3.5} strokeLinecap="round" />
    </>
  );

  if (character === "blade") {
    // Notched cap + triangular blade. Three hard notches mark min / mid / max.
    const w = r * 0.42;
    const bladeL = polar(cx, cy, r - 5, angle - 12);
    const bladeR = polar(cx, cy, r - 5, angle + 12);
    return (
      <>
        {base}
        <circle cx={cx} cy={cy} r={r - 3} fill="rgba(10,4,6,0.85)" stroke={`${color}33`} />
        {[-135, 0, 135].map((d) => {
          const a = polar(cx, cy, r - 1, d);
          const b = polar(cx, cy, r - 4.5, d);
          return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.22)" strokeWidth={1.2} />;
        })}
        <path d={arc(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="butt" style={{ filter: glow }} />
        <path
          d={`M ${cx} ${cy} L ${bladeL.x} ${bladeL.y} L ${tip.x} ${tip.y} L ${bladeR.x} ${bladeR.y} Z`}
          fill={color}
          opacity={0.95}
        />
        <circle cx={cx} cy={cy} r={Math.max(1.5, w * 0.16)} fill="rgba(0,0,0,0.65)" />
      </>
    );
  }

  if (character === "rings") {
    // Concentric grooves + a fine crosshair pointer: reads as a lab instrument.
    const cross = polar(cx, cy, r - 7, angle);
    const armA = polar(cx, cy, r - 4, angle - 90);
    const armB = polar(cx, cy, r - 4, angle + 90);
    return (
      <>
        {base}
        <circle cx={cx} cy={cy} r={r - 3} fill="rgba(12,10,3,0.8)" stroke={`${color}2e`} />
        <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke="rgba(255,255,255,0.07)" />
        <circle cx={cx} cy={cy} r={r - 9} fill="none" stroke="rgba(255,255,255,0.05)" />
        {Array.from({ length: 11 }, (_, i) => {
          const d = -135 + (i / 10) * 270;
          const a = polar(cx, cy, r - 0.5, d);
          const b = polar(cx, cy, r - (i % 5 === 0 ? 4 : 2.5), d);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.16)" strokeWidth={0.8} />;
        })}
        <path d={arc(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" style={{ filter: glow }} />
        <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={1.3} strokeLinecap="round" />
        <line x1={armA.x} y1={armA.y} x2={armB.x} y2={armB.y} stroke={`${color}66`} strokeWidth={0.9} />
        <circle cx={cross.x} cy={cross.y} r={1.6} fill="#fff" opacity={0.8} />
      </>
    );
  }

  if (character === "orbit") {
    // Short stub + a satellite riding outside the track, with a motion trail.
    const stub = polar(cx, cy, r * 0.52, angle);
    const sat = polar(cx, cy, r + 4.5, angle);
    const trailFrom = Math.max(-135, angle - 26);
    return (
      <>
        {base}
        <circle cx={cx} cy={cy} r={r - 4} fill="rgba(3,9,16,0.82)" stroke={`${color}2b`} />
        <circle cx={cx} cy={cy} r={r - 7} fill="none" stroke={`${color}1c`} strokeDasharray="1 3" />
        <path d={arc(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" style={{ filter: glow }} />
        <path d={arc(cx, cy, r + 4.5, trailFrom, angle)} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" opacity={0.4} />
        <line x1={cx} y1={cy} x2={stub.x} y2={stub.y} stroke={`${color}cc`} strokeWidth={2} strokeLinecap="round" />
        <circle cx={sat.x} cy={sat.y} r={2.6} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      </>
    );
  }

  if (character === "lens") {
    // Soft lens: no hard pointer, the light itself moves round the rim.
    const dot = polar(cx, cy, r - 4, angle);
    return (
      <>
        {base}
        <defs>
          <radialGradient id={`fcLens${Math.round(cx)}-${Math.round(r)}`} cx="38%" cy="32%">
            <stop offset="0%" stopColor={`${color}55`} />
            <stop offset="60%" stopColor="rgba(8,4,16,0.9)" />
            <stop offset="100%" stopColor="rgba(4,2,10,0.95)" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r - 2.5} fill={`url(#fcLens${Math.round(cx)}-${Math.round(r)})`} stroke={`${color}3a`} />
        <path d={arc(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.6} strokeLinecap="round" style={{ filter: glow }} />
        <circle cx={dot.x} cy={dot.y} r={3.2} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        <circle cx={dot.x} cy={dot.y} r={1.2} fill="#fff" opacity={0.85} />
      </>
    );
  }

  if (character === "console") {
    // Flat fader cap + a segmented LED ladder instead of a smooth arc.
    const segs = 14;
    const capW = r * 1.15;
    const capH = r * 0.5;
    const lit = Math.round(t * segs);
    return (
      <>
        {base}
        {Array.from({ length: segs }, (_, i) => {
          const a0 = -135 + (i / segs) * 270 + 1.5;
          const a1 = -135 + ((i + 1) / segs) * 270 - 1.5;
          const on = i < lit;
          return (
            <path
              key={i}
              d={arc(cx, cy, r, a0, a1)}
              fill="none"
              stroke={on ? color : "rgba(255,255,255,0.09)"}
              strokeWidth={3.4}
              strokeLinecap="butt"
              style={on && i >= lit - 1 ? { filter: glow } : undefined}
            />
          );
        })}
        <g transform={`rotate(${angle} ${cx} ${cy})`}>
          <rect
            x={cx - capW / 2}
            y={cy - capH / 2}
            width={capW}
            height={capH}
            rx={capH * 0.28}
            fill="rgba(14,8,3,0.9)"
            stroke={`${color}44`}
          />
          <rect x={cx - capW / 2 + 1.5} y={cy - 1} width={capW - 3} height={1.6} fill={color} opacity={0.9} />
        </g>
      </>
    );
  }

  if (character === "gem") {
    // Faceted diamond cap with a bright leading vertex.
    const far = polar(cx, cy, r - 3.5, angle);
    const near = polar(cx, cy, r * 0.5, angle + 180);
    const sideA = polar(cx, cy, r * 0.55, angle - 90);
    const sideB = polar(cx, cy, r * 0.55, angle + 90);
    return (
      <>
        {base}
        <path d={arc(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" style={{ filter: glow }} />
        <path d={arc(cx, cy, r - 4, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={1} strokeLinecap="round" opacity={0.45} />
        <path
          d={`M ${far.x} ${far.y} L ${sideA.x} ${sideA.y} L ${near.x} ${near.y} L ${sideB.x} ${sideB.y} Z`}
          fill="rgba(16,4,12,0.88)"
          stroke={`${color}66`}
        />
        <path d={`M ${far.x} ${far.y} L ${sideA.x} ${sideA.y} L ${cx} ${cy} Z`} fill={color} opacity={0.3} />
        <circle cx={far.x} cy={far.y} r={2.4} fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      </>
    );
  }

  // plain — the original treatment, for anything unmapped.
  return (
    <>
      {base}
      <line
        x1={polar(cx, cy, r - 6, angle).x}
        y1={polar(cx, cy, r - 6, angle).y}
        x2={polar(cx, cy, r + 1, angle).x}
        y2={polar(cx, cy, r + 1, angle).y}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path d={arc(cx, cy, r, fillFrom, fillTo)} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" style={{ filter: glow }} />
      <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle cx={tip.x} cy={tip.y} r={3} fill={color} />
    </>
  );
}
