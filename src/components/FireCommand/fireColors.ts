/**
 * Fire Command color language — band tabs own a distinct hue family;
 * modules under a tab ramp deep → light with enough step + hue walk
 * that siblings stay readable and distinguishable on a dark UI.
 */

/**
 * Band landmark colors — spaced around the wheel so adjacent tabs
 * (SRC↔MIX, TONE↔PERF) don't collide.
 */
export const FC_BAND = {
  sources: "#ff3d4a", // crimson — raw voice / oscillators
  tone: "#efc53d", // gold — filter body & tone sculpt
  mod: "#3da9ff", // azure — time & modulation
  fx: "#b57aff", // violet — effects chain
  mix: "#ff8a2e", // tangerine — destination / mix / output
  perf: "#ff6aad", // magenta — macros / gate / stage
} as const;

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [n[0]!, n[1]!, n[2]!];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  let T = t;
  if (T < 0) T += 1;
  if (T > 1) T -= 1;
  if (T < 1 / 6) return p + (q - p) * 6 * T;
  if (T < 1 / 2) return q;
  if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** sRGB relative luminance — HSL L lies for blues/violets on dark UI. */
function relLum(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Lift HSL until text-grade luminance clears the dark-chrome floor. */
function ensureReadable(hex: string, minY = 0.28): string {
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  let out = hex;
  for (let i = 0; i < 28 && relLum(out) < minY && l < 0.92; i++) {
    l += 0.025;
    out = rgbToHex(...hslToRgb(h, s, l));
  }
  return out;
}

/**
 * Shade of a band landmark. `t = 0` → deep (still legible); `t = 1` → pastel light.
 * Lightness steps are wide; a small hue walk + sat falloff separates siblings.
 * Blues/violets are luminance-clamped so labels never sink into the background.
 */
export function bandShade(baseHex: string, t: number): string {
  const [h0, s0] = rgbToHsl(...hexToRgb(baseHex));
  const u = clamp01(t);
  // Mild ease-out so early siblings separate more than a flat dark mud
  const e = 1 - Math.pow(1 - u, 1.2);

  // HSL floor — then luminance clamp (below) catches blue/violet lies
  const deepL = 0.48;
  const lightL = 0.90;
  const l = deepL + e * (lightL - deepL);

  // ±~30° walk across the ramp — same family, clearer Osc A ≠ Osc B
  const h = (h0 + (u - 0.5) * 0.085 + 1) % 1;

  // Punchy at the deep end, softer pastel toward light
  const sat = clamp01(0.42 + s0 * 0.58 * (1 - u * 0.45));
  // Deep end needs more luminance; light end can sit softer
  const minY = 0.28 - u * 0.04;
  return ensureReadable(rgbToHex(...hslToRgb(h, sat, l)), minY);
}

/** Deep→light ramp with stretched early steps so adjacent modules read apart. */
export function bandRamp(baseHex: string, count: number): string[] {
  if (count <= 1) return [bandShade(baseHex, 0.35)];
  return Array.from({ length: count }, (_, i) => {
    const raw = i / (count - 1);
    // Pull early steps further along the ramp (dark mud → distinct siblings)
    const t = Math.pow(raw, 0.78);
    return bandShade(baseHex, t);
  });
}

const SRC = bandRamp(FC_BAND.sources, 7);
const TONE = bandRamp(FC_BAND.tone, 7);
const MOD = bandRamp(FC_BAND.mod, 7);
const FX = bandRamp(FC_BAND.fx, 7);
const MIX = bandRamp(FC_BAND.mix, 7);
const PERF = bandRamp(FC_BAND.perf, 7);

/** Role / module accents — always a shade of their parent band tab. */
export const FC = {
  fire: FC_BAND.mix,
  sources: FC_BAND.sources,
  tone: FC_BAND.tone,
  mod: FC_BAND.mod,
  fx: FC_BAND.fx,
  perf: FC_BAND.perf,

  /** Sources — Osc A (deep crimson) → Sub (light) */
  oscA: SRC[0]!,
  oscB: SRC[1]!,
  oscC: SRC[2]!,
  warp: SRC[3]!,
  chip: SRC[4]!,
  noise: SRC[5]!,
  sub: SRC[6]!,

  /** Tone — Unison (deep gold) → Pluck (light) */
  unison: TONE[0]!,
  analogLife: TONE[1]!,
  filter: TONE[2]!,
  envAmp: TONE[3]!,
  envMod: TONE[4]!,
  envFilt: TONE[5]!,
  pluck: TONE[6]!,

  /** Mod — LFO 1 (deep azure) → Arp (light) */
  lfo: MOD[0]!,
  lfo2: MOD[1]!,
  fm: MOD[2]!,
  fmRack: MOD[3]!,
  pitch: MOD[4]!,
  matrix: MOD[5]!,
  arp: MOD[6]!,

  /** FX — Drive (deep violet) → Spectral (light) */
  drive: FX[0]!,
  vintage: FX[1]!,
  phaser: FX[2]!,
  chorus: FX[3]!,
  delay: FX[4]!,
  reverb: FX[5]!,
  spectral: FX[6]!,

  /** Mix — Mixer (deep tangerine) → Live (light) */
  mixer: MIX[0]!,
  morph: MIX[1]!,
  width: MIX[2]!,
  glue: MIX[3]!,
  air: MIX[4]!,
  scope: MIX[5]!,
  performance: MIX[6]!,

  /** Perf — Macros (deep magenta) → Scenes (light) */
  macros: PERF[0]!,
  gate: PERF[1]!,
  harmony: PERF[2]!,
  scale: PERF[3]!,
  chord: PERF[4]!,
  human: PERF[5]!,
  scenes: PERF[6]!,
} as const;
