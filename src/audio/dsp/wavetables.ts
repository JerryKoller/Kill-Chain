/**
 * Wavetable definitions for Fire Command.
 *
 * Each wavetable is a series of single-cycle "frames". A frame is described by
 * the amplitude of its harmonics (a sine series). The synth turns each frame
 * into a `PeriodicWave` and crossfades between adjacent frames as the morph
 * position moves; the UI renders the same frames as waveforms for the display.
 *
 * Keeping this pure (no AudioContext) means audio + visuals are guaranteed to
 * agree, and the module can be unit-reasoned about on its own.
 */

export interface WavetableDef {
  id: string;
  name: string;
}

export const WAVETABLES: WavetableDef[] = [
  { id: "basic", name: "Basic Shapes" },
  { id: "saw", name: "Saw Sweep" },
  { id: "pulse", name: "PWM" },
  { id: "harmonic", name: "Harmonics" },
  { id: "vocal", name: "Vocal" },
  { id: "metallic", name: "Metallic" },
  { id: "growl", name: "Bass Growl" },
  { id: "bell", name: "Bell / FM" },
  { id: "sync", name: "Sync Sweep" },
  { id: "additive", name: "Additive Organ" },
  { id: "formant2", name: "Formant II" },
  { id: "chip", name: "Chiptune" },
  { id: "fold", name: "Folded Metal" },
];

export const WAVETABLE_IDS = WAVETABLES.map((w) => w.id);
export const FRAME_COUNT = 8;
export const NUM_PARTIALS = 32;
/** Resolution of the pre-interpolated wave bank the engine plays back. */
export const SUBFRAMES = 32;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── base spectra ──
const sineAmp = (n: number) => (n === 1 ? 1 : 0);
const sawAmp = (n: number) => 1 / n;
const squareAmp = (n: number) => (n % 2 === 1 ? 1 / n : 0);
const triAmp = (n: number) => (n % 2 === 1 ? 1 / (n * n) : 0);

/**
 * Amplitude of harmonic `n` (1-based) for a given table at morph `f` ∈ [0,1].
 */
export function partialAmp(tableId: string, f: number, n: number): number {
  f = clamp(f, 0, 1);
  switch (tableId) {
    case "basic": {
      // sine → triangle → saw → square across the morph.
      if (f < 1 / 3) return lerp(sineAmp(n), triAmp(n), f * 3);
      if (f < 2 / 3) return lerp(triAmp(n), sawAmp(n), (f - 1 / 3) * 3);
      return lerp(sawAmp(n), squareAmp(n), (f - 2 / 3) * 3);
    }
    case "saw": {
      // mellow (few partials) → buzzy (many partials) with a soft knee.
      const maxN = 1 + f * 30;
      const roll = clamp(maxN - n + 1, 0, 1);
      return (1 / n) * roll;
    }
    case "pulse": {
      // duty 0.5 (square) → 0.06 (thin pulse): classic PWM.
      const d = lerp(0.5, 0.06, f);
      return Math.abs((2 / (n * Math.PI)) * Math.sin(n * Math.PI * d));
    }
    case "harmonic": {
      // a moving band of emphasised harmonics.
      const center = 1 + f * 22;
      const width = 3.5;
      const g = Math.exp(-(((n - center) / width) ** 2));
      return g + (0.12 / n);
    }
    case "vocal": {
      // two formant peaks sweeping like a vowel morph.
      const f1 = lerp(3, 9, f);
      const f2 = lerp(7, 20, f);
      const w1 = 1.6;
      const w2 = 2.6;
      const peak =
        Math.exp(-(((n - f1) / w1) ** 2)) + 0.7 * Math.exp(-(((n - f2) / w2) ** 2));
      return (peak * 0.9 + 0.08 / n) / Math.sqrt(n);
    }
    case "metallic": {
      // shifting comb over the harmonics → clangy / digital.
      const comb = 0.5 + 0.5 * Math.cos(n * (1 + f * 3.2));
      const tilt = clamp((n - 1) / 18, 0, 1) * 0.6 + 0.4;
      return (1 / Math.sqrt(n)) * comb * tilt;
    }
    case "growl": {
      // warm low harmonics that thicken into a mid-rich growl.
      const maxN = 2 + f * 12;
      const roll = clamp(maxN - n + 1, 0, 1);
      const midBump = 1 + f * 1.4 * Math.exp(-(((n - (3 + f * 6)) / 3) ** 2));
      return (1 / Math.pow(n, 1 - f * 0.25)) * roll * midBump;
    }
    case "bell": {
      // sparse, FM/bell-like partials that gain overtones as the morph rises.
      const set = [1, 2, 3, 5, 7, 11, 13];
      const idx = set.indexOf(n);
      if (idx === -1) return 0;
      const appear = clamp(f * set.length - idx + 1, 0, 1);
      return (1 / Math.pow(n, 0.7)) * appear;
    }
    case "sync": {
      // a saw with a moving resonant emphasis — hard-sync-style sweep.
      const center = 1 + f * 16;
      const w = 2 + f * 4;
      return (1 / n) * (0.4 + Math.exp(-(((n - center) / w) ** 2)));
    }
    case "additive": {
      // organ-style drawbars filling in as the morph rises.
      const set = [1, 2, 3, 4, 5, 6, 8, 10];
      const idx = set.indexOf(n);
      if (idx === -1) return 0;
      const appear = clamp(f * set.length - idx + 1, 0, 1);
      return (1 / Math.sqrt(n)) * appear;
    }
    case "formant2": {
      // two sweeping formant peaks — a different vowel character to "vocal".
      const f1 = 3 + f * 5;
      const f2 = 9 + f * 10;
      const w = 2.2;
      return (1 / Math.sqrt(n)) * (Math.exp(-(((n - f1) / w) ** 2)) + 0.7 * Math.exp(-(((n - f2) / (w * 1.6)) ** 2)) + 0.04);
    }
    case "chip": {
      // chiptune: odd harmonics (square) morphing toward a brighter pulse.
      const odd = n % 2 === 1;
      return odd ? 1 / n : (f * 0.9) / n;
    }
    case "fold": {
      // moving harmonic comb — metallic / wavefolder-like as the morph rises.
      const comb = 0.5 + 0.5 * Math.cos(n * (0.5 + f * 3));
      return (1 / Math.pow(n, 0.7)) * (0.2 + comb);
    }
    default:
      return sawAmp(n);
  }
}

/** Continuous-morph harmonic coefficients for any position `f` ∈ [0,1]. */
export function harmonicsAt(tableId: string, f: number): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(NUM_PARTIALS + 1);
  const imag = new Float32Array(NUM_PARTIALS + 1);
  for (let n = 1; n <= NUM_PARTIALS; n++) imag[n] = partialAmp(tableId, f, n);
  return { real, imag };
}

/**
 * Harmonic coefficients (sine series) for one of the FRAME_COUNT display
 * frames, ready for `AudioContext.createPeriodicWave`.
 */
export function frameHarmonics(tableId: string, frameIndex: number): { real: Float32Array; imag: Float32Array } {
  return harmonicsAt(tableId, FRAME_COUNT > 1 ? frameIndex / (FRAME_COUNT - 1) : 0);
}

/**
 * Render one cycle of a frame to `count` samples for the UI display.
 * `f` is a continuous morph position (0..1), interpolated across frames.
 */
export function frameSamples(tableId: string, f: number, count: number): Float32Array {
  const out = new Float32Array(count);
  let peak = 1e-6;
  for (let i = 0; i < count; i++) {
    const x = i / count;
    let s = 0;
    for (let n = 1; n <= NUM_PARTIALS; n++) {
      const a = partialAmp(tableId, f, n);
      if (a !== 0) s += a * Math.sin(2 * Math.PI * n * x);
    }
    out[i] = s;
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
  }
  const norm = 1 / peak;
  for (let i = 0; i < count; i++) out[i] *= norm;
  return out;
}

export function wavetableName(id: string): string {
  return WAVETABLES.find((w) => w.id === id)?.name ?? id;
}

// ── Spectral warps (v1.7, Razor-inspired) ──
// `PeriodicWave` partials sit at fixed integer harmonics, so true inharmonic
// stretch isn't possible — instead these warps remap ENERGY across the
// harmonic series, which reads to the ear as stretch/tilt/comb while staying
// perfectly band-limited and CPU-free at play time.

/**
 * Warp a sine-series amplitude array (index 0 unused, 1..N = harmonics).
 *
 * - `stretch` (-1..1): spectral stretch/compress. Positive pushes energy
 *   toward stretched partial positions (bell/piano-like); negative compresses
 *   the series (darker, formant-squashed).
 * - `tilt` (-1..1): even/odd balance. Positive strips even harmonics toward a
 *   hollow square-like tone; negative strips odds (minus the fundamental)
 *   for a reedy, octave-doubled character.
 * - `comb` (0..1): periodic notches carved across the series — metallic,
 *   flanged spectra at full depth.
 *
 * All zeros returns the input untouched (bit-identical fast path).
 */
export function applyWarp(
  imag: Float32Array,
  stretch: number,
  tilt: number,
  comb: number,
): Float32Array {
  stretch = clamp(stretch, -1, 1);
  tilt = clamp(tilt, -1, 1);
  comb = clamp(comb, 0, 1);
  if (stretch === 0 && tilt === 0 && comb === 0) return imag;

  const N = imag.length - 1; // harmonics 1..N
  const out = new Float32Array(imag.length);

  // 1) Stretch: resample the series along n' = n · (1 + B·n) — the classic
  //    stiff-string partial law, applied to amplitudes via inverse mapping.
  const B = stretch * 0.05;
  for (let m = 1; m <= N; m++) {
    const denom = Math.max(0.3, 1 + B * m);
    const src = m / denom; // fractional source harmonic
    const lo = Math.floor(src);
    const hi = lo + 1;
    const t = src - lo;
    const aLo = lo >= 1 && lo <= N ? imag[lo] : 0;
    const aHi = hi >= 1 && hi <= N ? imag[hi] : 0;
    out[m] = aLo * (1 - t) + aHi * t;
  }

  // 2) Tilt: even/odd emphasis (fundamental always survives).
  if (tilt !== 0) {
    for (let n = 2; n <= N; n++) {
      const even = n % 2 === 0;
      const cut = even ? Math.max(0, tilt) : Math.max(0, -tilt);
      out[n] *= 1 - cut * 0.96;
    }
  }

  // 3) Comb: cosine notches, ~4-harmonic tooth spacing.
  if (comb > 0) {
    for (let n = 2; n <= N; n++) {
      const notch = 0.5 + 0.5 * Math.cos((2 * Math.PI * n) / 4.3);
      out[n] *= 1 - comb * notch;
    }
  }

  // Keep overall energy in the same ballpark so warping doesn't duck the osc
  // (createPeriodicWave normalizes peak, but relative frame loudness matters).
  let eIn = 0;
  let eOut = 0;
  for (let n = 1; n <= N; n++) {
    eIn += imag[n] * imag[n];
    eOut += out[n] * out[n];
  }
  if (eOut > 1e-9) {
    const g = Math.sqrt(eIn / eOut);
    for (let n = 1; n <= N; n++) out[n] *= g;
  } else {
    out[1] = imag[1] || 1; // fully notched-out frame — keep a fundamental
  }
  return out;
}
