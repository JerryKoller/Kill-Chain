/**
 * Tractor Beam — automatic, high-resolution EQ matching.
 *
 * HOW IT MEASURES (v2 — whole-track Welch analysis):
 * The ENTIRE track is scanned offline with a Welch-style averaged
 * periodogram: up to ~96 Hann-windowed radix-2 FFT frames (8192 samples)
 * spread evenly from the first sample to the last, silence-gated so quiet
 * gaps don't bias the average, and averaged in the power domain. The averaged
 * spectrum is then folded into 1/3-octave constant-Q band energies
 * (25 Hz – 16 kHz, ~29 bands). This replaces the old approach of rendering
 * only the first 30 s through a bank of offline bandpass filters.
 *
 * HOW IT DERIVES THE EQ:
 *   1. Preserve the track's natural tonal tilt (in a constant-Q view,
 *      balanced music is naturally bass-rich and treble-gentle — we must NOT
 *      flatten that or every track turns thin and harsh). The target curve is
 *      the track's own psychoacoustically-smoothed envelope, constrained to a
 *      pink-noise-anchored "comfortable tilt" window (SLOPE_MIN..SLOPE_MAX
 *      dB/oct in the constant-Q domain, where pink noise reads flat).
 *   2. Optionally re-voice that target with a selected TARGET PROFILE
 *      (warm / bright / bass-focus / vocal-forward) — a deliberate, bounded
 *      offset on top of the reference target.
 *   3. Tame narrow resonant peaks / fill notches toward that envelope.
 *   4. Voice for the headphone's own colour when correction is off.
 *   5. Loudness-weight all decisions (A-weighting-derived), cap boosts at
 *      +6 dB and cuts at -9 dB, smooth across bands, and fold in a
 *      loudness-preserving trim so the corrected track plays at the same
 *      perceived level (fair A/B).
 *
 * ARCHITECTURE (v3): the pipeline is split into two stages —
 *   measureTrack()      the expensive offline scan; returns a small,
 *                       serializable {@link TractorMeasurement}.
 *   deriveCorrection()  pure synchronous math over that measurement.
 * Strength, target profile and per-band vetoes are derivation inputs, so the
 * UI can re-derive instantly (and restore old measurements from history)
 * without re-scanning audio. analyzeTrack() remains as the one-shot wrapper.
 *
 * The result is a smooth correction curve (dB vs frequency) that can be
 * sampled at ANY frequency, so it maps onto however many Sculptor bands
 * (1-20) the user has, plus a match / confidence readout.
 */
import { NEUTRAL_PARAMS, type SoundParams } from "@/audio/types";
import { FRIENDLY_TO_EQ, type FriendlyKey } from "@/audio/AudioEngine";
import type { HeadphoneProfile } from "@/audio/headphoneProfiles";

export interface CurvePoint {
  freq: number;
  db: number;
}

export interface BandReading {
  freq: number;
  /** Measured energy in this band, relative to the track's average (dB). */
  relDb: number;
  /** Predicted post-EQ energy, same reference (dB) — the "after" spectrum. */
  afterDb: number;
  /** Suggested EQ move at this frequency (dB), after voicing + smoothing. */
  moveDb: number;
}

export interface TractorProgress {
  stage: string;
  /** 0..1 overall completion. */
  fraction: number;
}

/**
 * Everything the offline scan learned about the track — small, plain data
 * (safe to persist / restore) and enough to re-derive a correction with any
 * strength / target / veto combination without touching the audio again.
 */
export interface TractorMeasurement {
  sampleRate: number;
  analyzedSec: number;
  /** FFT windows that actually contained signal. */
  windowsUsed: number;
  /** 1/3-octave band centres actually measured (depends on sample rate). */
  centers: number[];
  /** Absolute band energies (dB, arbitrary reference), one per centre. */
  levelsDb: number[];
  /** True when the track had no measurable signal. */
  silent: boolean;

  // ── v4 content fingerprint (optional — old saved measurements lack them) ──
  /** Average peak-to-RMS crest factor (dB). Low = heavily limited master. */
  crestDb?: number;
  /** Std-dev of per-window loudness (dB) — macro-dynamics. Film mixes are
   *  far more dynamic than mastered music. */
  dynRangeDb?: number;
  /** Mean L/R correlation over the track (−1..1, 1 = mono). Null for mono
   *  files / live captures where it wasn't measurable. */
  stereoCorr?: number | null;
  /** Energy fraction below 150 Hz (0..1). */
  bassShare?: number;
  /** Energy fraction in the speech band 300–3400 Hz (0..1). */
  speechShare?: number;
  /** Energy fraction above 7 kHz (0..1). */
  airShare?: number;
}

// ── Content classification (v4) ───────────────────────────────────────────

export type ContentKind = "music" | "cinema" | "speech" | "bass";

export interface ContentReading {
  kind: ContentKind;
  label: string;
  blurb: string;
  /** 0..100 — margin of the winning class over the runner-up. */
  confidencePct: number;
  /** What decided it: the audio fingerprint, the title, or both agreeing. */
  via: "audio" | "title" | "audio+title";
}

const CONTENT_META: Record<ContentKind, { label: string; blurb: string }> = {
  music: {
    label: "Music",
    blurb: "Steady loudness and full-band energy — a mastered music track.",
  },
  cinema: {
    label: "Film / TV",
    blurb: "Very wide macro-dynamics with speech-band focus — a cinematic mix (dialog + effects swings).",
  },
  speech: {
    label: "Spoken word",
    blurb: "Energy concentrated in the voice band with little bass — podcast, audiobook or commentary.",
  },
  bass: {
    label: "Bass-heavy",
    blurb: "Low end truly dominates the energy — bass music or an LFE-forward mix.",
  },
};

// ── Title inference ─────────────────────────────────────────────────────────
// Video/track titles carry the strongest clue about what's playing ("Official
// Music Video", "Full Movie", "Podcast #213", "bass boosted"). Each rule is a
// regex + a weight; the summed per-kind weights bias the audio scores.

interface TitleRule {
  kind: ContentKind;
  re: RegExp;
  w: number;
}

const TITLE_RULES: TitleRule[] = [
  // Music — strong signals first.
  { kind: "music", re: /official (music )?video|official audio|official visualizer/i, w: 2.2 },
  { kind: "music", re: /\b(m\/v|mv)\b|vevo|- topic\b/i, w: 2.0 },
  { kind: "music", re: /\b(lyrics?|lyric video|karaoke)\b/i, w: 2.0 },
  { kind: "music", re: /\b(remix|mashup|cover|acoustic|instrumental|unplugged)\b/i, w: 1.6 },
  { kind: "music", re: /\b(full album|album|EP|single|OST|soundtrack)\b/, w: 1.2 },
  { kind: "music", re: /\b(feat\.?|ft\.?)\s/i, w: 1.4 },
  { kind: "music", re: /\b(live at|live in|concert|tour|festival|session)\b/i, w: 1.4 },
  { kind: "music", re: /\b(mix|playlist|hits|greatest|classics|top \d+)\b/i, w: 1.2 },
  { kind: "music", re: /\b(song|music)\b/i, w: 0.7 },
  { kind: "music", re: /(\d+\s?(hour|hr)s?)/i, w: 0.6 },
  // Bass-forward genres override generic music.
  { kind: "bass", re: /\b(dubstep|riddim|phonk|bass boosted|bass test|808s?|neurofunk)\b/i, w: 2.4 },
  { kind: "bass", re: /\b(drum\s?(and|&|n)\s?bass|dnb|trap|hardstyle|tearout)\b/i, w: 2.0 },
  { kind: "bass", re: /\b(subwoofer|extreme bass|car audio)\b/i, w: 1.8 },
  // Cinema / TV.
  { kind: "cinema", re: /\b(full movie|movie|film)\b/i, w: 2.0 },
  { kind: "cinema", re: /\b(official trailer|trailer|teaser)\b/i, w: 2.2 },
  { kind: "cinema", re: /\b(scene|clip)\b.*\b(movie|film|hd|4k)\b|\b(movie|film)\b.*\b(scene|clip)\b/i, w: 2.0 },
  { kind: "cinema", re: /\b(scene|opening|ending|final battle|fight scene)\b/i, w: 1.4 },
  { kind: "cinema", re: /\b(documentary|series|season \d+|s\d{1,2}e\d{1,2}|netflix|imax)\b/i, w: 1.6 },
  { kind: "cinema", re: /\b(4k hdr|dolby (vision|atmos)|blu-?ray)\b/i, w: 1.2 },
  // Spoken word.
  { kind: "speech", re: /\b(podcast|audiobook|audio book)\b/i, w: 2.4 },
  { kind: "speech", re: /\b(interview|lecture|sermon|keynote|ted talk|q&a|commentary)\b/i, w: 2.0 },
  { kind: "speech", re: /\b(asmr|meditation|sleep story)\b/i, w: 1.8 },
  { kind: "speech", re: /\b(ep\.?\s?\d+|episode \d+)\b/i, w: 0.9 },
  { kind: "speech", re: /\b(news|debate|explained|review|reaction)\b/i, w: 1.0 },
];

export interface TitleReading {
  kind: ContentKind;
  /** Summed rule weight for the winning kind. */
  weight: number;
  /** All non-zero per-kind weights (for the blurb / debugging). */
  weights: Partial<Record<ContentKind, number>>;
}

/** What the TITLE says this is (null when nothing matches). */
export function inferContentFromTitle(title: string | null | undefined): TitleReading | null {
  if (!title || title.trim().length < 3) return null;
  const weights: Partial<Record<ContentKind, number>> = {};
  for (const rule of TITLE_RULES) {
    if (rule.re.test(title)) {
      weights[rule.kind] = (weights[rule.kind] ?? 0) + rule.w;
    }
  }
  const ranked = (Object.entries(weights) as [ContentKind, number][]).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  return { kind: ranked[0][0], weight: ranked[0][1], weights };
}

/**
 * Read what KIND of material this measurement looks like. Heuristic scores
 * over the v4 fingerprint, biased by the media TITLE when one is known —
 * "Official Music Video" beats a bass-tilted spectrum every time. Returns
 * null when the measurement predates the fingerprint or was silent.
 */
export function classifyContent(
  m: TractorMeasurement,
  titleHint?: string | null,
): ContentReading | null {
  if (m.silent) return null;
  if (m.crestDb === undefined && m.dynRangeDb === undefined && m.speechShare === undefined) {
    return null;
  }
  const crest = m.crestDb ?? 12;
  const dyn = m.dynRangeDb ?? 4;
  const bass = m.bassShare ?? 0.35;
  const speech = m.speechShare ?? 0.3;
  const air = m.airShare ?? 0.05;

  // In a constant-Q (1/3-octave) view normal mastered music is naturally
  // bass-rich — 40-60% of summed band energy below 150 Hz is TYPICAL, not
  // "bass-heavy". Only a genuinely low-dominated spectrum (little air, big
  // low share) should read as bass content.
  const scores: Record<ContentKind, number> = {
    // Music: consistent loudness (small window-to-window variance).
    music: 0.6 + Math.max(0, 4.5 - Math.abs(dyn - 3)) * 0.08,
    // Cinema: huge macro-dynamics (whispers → explosions) + healthy crest.
    cinema: (dyn - 5.5) * 0.32 + Math.max(0, crest - 13) * 0.05,
    // Speech: voice band dominates, almost no bass, moderate dynamics.
    speech: (speech - 0.45) * 5 + (0.18 - bass) * 2.5 - Math.max(0, dyn - 10) * 0.15,
    // Bass-heavy: low bands must TRULY dominate, with a starved top end.
    bass: (bass - 0.62) * 6 + (0.03 - Math.min(air, 0.06)) * 8,
  };

  const audioKind = (Object.entries(scores) as [ContentKind, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  // Title bias: the title is usually the single best clue.
  const titleRead = inferContentFromTitle(titleHint);
  if (titleRead) {
    for (const [kind, w] of Object.entries(titleRead.weights) as [ContentKind, number][]) {
      scores[kind] += Math.min(2.5, w) * 0.75;
    }
  }

  const ranked = (Object.entries(scores) as [ContentKind, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [kind, top] = ranked[0];
  const margin = top - ranked[1][1];
  const confidencePct = Math.round(100 * clamp01(0.45 + margin * 0.6));
  const via: ContentReading["via"] =
    titleRead && titleRead.kind === kind
      ? audioKind === kind
        ? "audio+title"
        : "title"
      : "audio";
  const meta = CONTENT_META[kind];
  const blurb =
    via === "title"
      ? `${meta.blurb} Read from the title — the spectrum alone suggested ${CONTENT_META[audioKind].label.toLowerCase()}.`
      : via === "audio+title"
        ? `${meta.blurb} The title agrees.`
        : meta.blurb;
  return { kind, label: meta.label, blurb, confidencePct, via };
}

export interface TractorResult {
  /** Fine-grained per-band readings (used for the chart). */
  bands: BandReading[];
  /** Smooth correction curve, sorted by freq — sample with sampleCurveDb(). */
  curve: CurvePoint[];
  /** A 10-band "friendly" snapshot, for saving the match as a macro preset. */
  params: SoundParams;
  /** Net EQ move applied in the bass region (dB) — matches the curve's sign. */
  bassMoveDb: number;
  /** Net EQ move applied in the treble region (dB). */
  trebleMoveDb: number;
  analyzedSec: number;
  /** Largest absolute suggested move (dB) — a rough "how much work" readout. */
  maxMoveDb: number;
  /** Loudness-weighted spectral match vs the target BEFORE correction (%). */
  matchBeforePct: number;
  /** Predicted match AFTER the correction is applied (%). */
  matchAfterPct: number;
  /** How trustworthy the reading is (signal coverage + band confidence, %). */
  confidencePct: number;
  /** Loudness-preserving trim folded into the curve (dB, usually negative). */
  trimDb: number;
  /** FFT windows that actually contained signal. */
  windowsUsed: number;
  /** True when the track had no measurable signal — all moves are zero. */
  silent: boolean;
  /** Which target profile the user REQUESTED (e.g. "smart"). */
  targetId: string;
  /** The profile the correction was actually voiced with (Smart Lock's pick). */
  resolvedTargetId: string;
  /** What the analyzer read the content as (null for pre-v4 measurements). */
  content: ContentReading | null;
  /** Beyond-EQ recommendations: dynamics / width / de-ess moves derived from
   *  the fingerprint. Applied by "Engage full chain" in the UI. */
  masterMoves: Partial<SoundParams>;
  /** One human-readable line per master move (why it's recommended). */
  masterNotes: string[];
}

/** Max single-band boost (dB) — boosts eat headroom, keep them polite. */
export const TRACTOR_BOOST_CLAMP_DB = 6;
/** Max single-band cut (dB) — cuts are safe, allow a firmer hand. */
export const TRACTOR_CUT_CLAMP_DB = 9;
/** Chart display scale (largest magnitude either direction). */
export const TRACTOR_MOVE_CLAMP_DB = TRACTOR_CUT_CLAMP_DB;
/** Upper bound of the user strength scalar (1 = the recommended correction). */
export const TRACTOR_MAX_STRENGTH = 1.5;

// ── Spectrum measurement ──────────────────────────────────────────────────
const FFT_SIZE = 8192; // ~5.4 Hz bins @44.1k — resolves the 25 Hz band
const TARGET_WINDOWS = 96; // Welch frames spread across the whole track
const WINDOW_CHUNK = 8; // frames per event-loop yield (keeps UI alive)
const SILENCE_GATE_REL = 0.02; // window RMS < 2% of loudest → skipped
const THIRD_OCT = Math.pow(2, 1 / 3);
const HALF_BAND = Math.pow(2, 1 / 6);
const F_LOW = 25;
const F_HIGH = 16000;

// ── Matching weights ──────────────────────────────────────────────────────
const LOCAL_STRENGTH = 0.5; // how firmly to tame resonances toward the envelope
const TILT_STRENGTH = 0.5; // how firmly to correct an *extreme* overall tilt
const VOICE_STRENGTH = 0.6; // headphone voicing amount when correction is off
const ENV_SIGMA_OCT = 0.9; // envelope smoothing width (octaves)
const PIVOT_HZ = 900; // tilt pivot — moves below boost/cut bass, above treble
// Comfortable constant-Q slope band (dB/oct). Pink noise reads flat (0) in
// this domain; most mastered music lands in this window and is left alone.
// Only tracks outside it get a gentle tilt nudge back toward the edge.
const SLOPE_MIN = -4.5;
const SLOPE_MAX = 0.5;
// Residual (weighted-RMS dB) that maps to 0% match on the readout.
const MATCH_FLOOR_DB = 6;

/** 1/3-octave centre frequencies from 25 Hz to 16 kHz (~29 bands). */
function buildCenters(): number[] {
  const out: number[] = [];
  for (let f = F_LOW; f <= F_HIGH * 1.001; f *= THIRD_OCT) out.push(Math.round(f));
  return out;
}
const CENTERS = buildCenters();

/** Sample a sorted correction curve at any frequency (log-freq linear interp). */
export function sampleCurveDb(curve: CurvePoint[], freq: number): number {
  if (curve.length === 0) return 0;
  if (freq <= curve[0].freq) return curve[0].db;
  const last = curve[curve.length - 1];
  if (freq >= last.freq) return last.db;
  const lf = Math.log2(freq);
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (freq >= a.freq && freq <= b.freq) {
      const t = (lf - Math.log2(a.freq)) / (Math.log2(b.freq) - Math.log2(a.freq));
      return a.db + (b.db - a.db) * t;
    }
  }
  return 0;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const finite = (x: number) => (Number.isFinite(x) ? x : 0);

/**
 * Perceptual loudness weight per band, derived from A-weighting but applied
 * at half strength (10^(A/40)) so the deep bass still counts — full A-weight
 * would let the analysis ignore a booming 40 Hz shelf entirely.
 */
function perceptualWeight(freq: number): number {
  const f2 = freq * freq;
  const num = 12194 ** 2 * f2 * f2;
  const den =
    (f2 + 20.6 ** 2) *
    Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) *
    (f2 + 12194 ** 2);
  const aDb = den > 0 ? 20 * Math.log10(num / den) + 2.0 : -60;
  return Math.max(0.08, Math.min(1, Math.pow(10, aDb / 40)));
}

/** Gaussian smoothing across a log-frequency axis (sigma in octaves). */
function gaussianSmoothLog(vals: number[], lf: number[], sigma: number): number[] {
  const out = new Array<number>(vals.length);
  for (let i = 0; i < vals.length; i++) {
    let sum = 0;
    let wsum = 0;
    for (let j = 0; j < vals.length; j++) {
      const d = (lf[i] - lf[j]) / sigma;
      const w = Math.exp(-0.5 * d * d);
      sum += vals[j] * w;
      wsum += w;
    }
    out[i] = wsum > 0 ? sum / wsum : vals[i];
  }
  return out;
}

/** Weighted linear regression slope (dB per octave) of y over x (=log2 f). */
function weightedSlope(x: number[], y: number[], w: number[]): number {
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  for (let i = 0; i < x.length; i++) {
    const wi = w[i];
    sw += wi;
    swx += wi * x[i];
    swy += wi * y[i];
    swxx += wi * x[i] * x[i];
    swxy += wi * x[i] * y[i];
  }
  const denom = sw * swxx - swx * swx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (sw * swxy - swx * swy) / denom;
}

/** Approximate the headphone's correction gain at a frequency (dB). */
function corrGainAt(profile: HeadphoneProfile | undefined, freq: number): number {
  if (!profile) return 0;
  let g = 0;
  const lf = Math.log2(freq);
  for (const b of profile.bands) {
    const d = Math.abs(Math.log2(b.freq) - lf);
    const w = Math.max(0, 1 - d / 1.2);
    g += (b.gain ?? 0) * w;
  }
  return g;
}

// ── Radix-2 FFT (iterative, in-place) ─────────────────────────────────────
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

let hannCache: Float64Array | null = null;
function hannWindow(): Float64Array {
  if (!hannCache || hannCache.length !== FFT_SIZE) {
    hannCache = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      hannCache[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
    }
  }
  return hannCache;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Tractor Beam analysis cancelled", "AbortError");
  }
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

/** Mix all channels of `buffer` into `frame` starting at `start` (Hann'd). */
function fillFrame(
  buffer: AudioBuffer,
  channels: Float32Array[],
  start: number,
  frame: Float64Array,
  hann: Float64Array,
): void {
  const len = buffer.length;
  const chs = channels.length;
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = start + i;
    let s = 0;
    if (idx < len) {
      for (let c = 0; c < chs; c++) s += channels[c][idx];
      s /= chs;
    }
    frame[i] = s * hann[i];
  }
}

interface WelchOut {
  /** Averaged power spectrum, FFT_SIZE/2+1 bins (linear power). */
  power: Float64Array;
  windowsUsed: number;
  /** v4 fingerprint (undefined when the track was silent). */
  crestDb?: number;
  dynRangeDb?: number;
  stereoCorr?: number | null;
}

/**
 * Welch-style averaged periodogram over the WHOLE track: frames spread
 * evenly start→end, silence-gated, chunked with awaits so the UI stays
 * responsive, cancellable via AbortSignal. Also collects the v4 content
 * fingerprint (crest, macro-dynamics, stereo correlation) from the same
 * strided pass so classification costs nothing extra.
 */
async function welchSpectrum(
  buffer: AudioBuffer,
  signal: AbortSignal | undefined,
  onProgress: ((p: TractorProgress) => void) | undefined,
): Promise<WelchOut> {
  const len = buffer.length;
  const chs = buffer.numberOfChannels;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chs; c++) channels.push(buffer.getChannelData(c));

  const maxStart = Math.max(0, len - FFT_SIZE);
  // Cap frame count for short clips so we don't run near-duplicate windows
  // (75% overlap max), while long tracks get the full spread.
  const maxUseful = Math.floor(maxStart / (FFT_SIZE >> 2)) + 1;
  const count = Math.max(1, Math.min(TARGET_WINDOWS, maxUseful));
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(count === 1 ? 0 : Math.floor((i * maxStart) / (count - 1)));
  }

  // Pass 1 — strided per-window stats: mono RMS (silence gate), peak (crest),
  // and per-channel powers + cross-product (stereo correlation).
  const rmsAt: number[] = [];
  const peakAt: number[] = [];
  let maxRms = 0;
  let corrLL = 0;
  let corrRR = 0;
  let corrLR = 0;
  for (let p = 0; p < positions.length; p++) {
    const start = positions[p];
    let sum = 0;
    let n = 0;
    let peak = 0;
    // Stride through the window — full accuracy isn't needed for gating.
    for (let i = 0; i < FFT_SIZE; i += 4) {
      const idx = start + i;
      if (idx >= len) break;
      let s = 0;
      for (let c = 0; c < chs; c++) s += channels[c][idx];
      s /= chs;
      sum += s * s;
      const a = Math.abs(s);
      if (a > peak) peak = a;
      if (chs >= 2) {
        const l = channels[0][idx];
        const r = channels[1][idx];
        corrLL += l * l;
        corrRR += r * r;
        corrLR += l * r;
      }
      n++;
    }
    const r = n > 0 ? Math.sqrt(sum / n) : 0;
    rmsAt.push(r);
    peakAt.push(peak);
    if (r > maxRms) maxRms = r;
    if ((p & 31) === 31) {
      throwIfAborted(signal);
      onProgress?.({ stage: "Scanning levels…", fraction: (0.1 * p) / positions.length });
      await yieldToUI();
    }
  }

  const power = new Float64Array((FFT_SIZE >> 1) + 1);
  if (maxRms < 1e-6) return { power, windowsUsed: 0 };
  const gate = maxRms * SILENCE_GATE_REL;

  // Fingerprint over the gated (audible) windows.
  let crestSum = 0;
  let loudSum = 0;
  let loudSqSum = 0;
  let gatedN = 0;
  for (let p = 0; p < rmsAt.length; p++) {
    if (rmsAt[p] < gate) continue;
    const db = 20 * Math.log10(rmsAt[p] + 1e-9);
    loudSum += db;
    loudSqSum += db * db;
    if (peakAt[p] > 0 && rmsAt[p] > 0) {
      crestSum += 20 * Math.log10(peakAt[p] / rmsAt[p]);
    }
    gatedN++;
  }
  const crestDb = gatedN > 0 ? crestSum / gatedN : undefined;
  const dynRangeDb =
    gatedN > 1
      ? Math.sqrt(Math.max(0, loudSqSum / gatedN - (loudSum / gatedN) ** 2))
      : undefined;
  const stereoCorr =
    chs >= 2 && corrLL > 1e-9 && corrRR > 1e-9
      ? corrLR / Math.sqrt(corrLL * corrRR)
      : null;

  // Pass 2 — Hann + FFT + power-average the windows that contain signal.
  const hann = hannWindow();
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  let used = 0;
  let sinceYield = 0;
  for (let p = 0; p < positions.length; p++) {
    if (rmsAt[p] < gate) continue;
    fillFrame(buffer, channels, positions[p], re, hann);
    im.fill(0);
    fftInPlace(re, im);
    for (let k = 0; k < power.length; k++) {
      power[k] += re[k] * re[k] + im[k] * im[k];
    }
    used++;
    if (++sinceYield >= WINDOW_CHUNK) {
      sinceYield = 0;
      throwIfAborted(signal);
      onProgress?.({
        stage: `Averaging spectrum… ${Math.min(p + 1, positions.length)}/${positions.length}`,
        fraction: 0.1 + (0.8 * p) / positions.length,
      });
      await yieldToUI();
    }
  }
  if (used > 0) {
    for (let k = 0; k < power.length; k++) power[k] /= used;
  }
  return { power, windowsUsed: used, crestDb, dynRangeDb, stereoCorr };
}

/** Energy fraction of `power`-domain band levels within [lo, hi] Hz. */
export function bandEnergyShare(
  centers: number[],
  levelsDb: number[],
  lo: number,
  hi: number,
): number {
  let inBand = 0;
  let total = 0;
  for (let i = 0; i < centers.length; i++) {
    const e = Math.pow(10, levelsDb[i] / 10);
    total += e;
    if (centers[i] >= lo && centers[i] <= hi) inBand += e;
  }
  return total > 1e-12 ? inBand / total : 0;
}

/** Fold the averaged FFT power spectrum into 1/3-octave band levels (dB). */
function bandLevelsDb(power: Float64Array, sr: number, centers: number[]): number[] {
  const binHz = sr / FFT_SIZE;
  return centers.map((freq) => {
    const lo = freq / HALF_BAND;
    const hi = freq * HALF_BAND;
    let kLo = Math.max(1, Math.floor(lo / binHz));
    const kHi = Math.min(power.length - 1, Math.ceil(hi / binHz));
    if (kLo > kHi) kLo = kHi; // extremely low bands at low sample rates
    let sum = 0;
    for (let k = kLo; k <= kHi; k++) sum += power[k];
    return 10 * Math.log10(sum + 1e-12);
  });
}

// ── Target profiles ───────────────────────────────────────────────────────
/**
 * A selectable voicing for the correction target. "reference" is the
 * neutral, track-respecting target the analyzer has always used; the others
 * add a deliberate, bounded offset on top of it. Offsets are expressed
 * relative to the REFERENCE target so switching profiles re-voices the same
 * measurement instantly.
 */
export interface TargetProfile {
  id: string;
  label: string;
  blurb: string;
  /** Broad spectral tilt around the 900 Hz pivot (dB/octave). */
  tiltDbPerOct: number;
  /** Additional target offset at a frequency (dB) — shelves / bumps. */
  shapeDb: (freqHz: number) => number;
}

const LOG2_110 = Math.log2(110);
const LOG2_2800 = Math.log2(2800);
const LOG2_38 = Math.log2(38);
const LOG2_95 = Math.log2(95);

/** Gaussian bump helper (dB peak at centreHz, sigma in octaves). */
function bump(freq: number, centreHz: number, sigmaOct: number, db: number): number {
  const d = (Math.log2(freq) - Math.log2(centreHz)) / sigmaOct;
  return db * Math.exp(-0.5 * d * d);
}

export const TARGET_PROFILES: TargetProfile[] = [
  {
    id: "smart",
    label: "Smart Lock",
    blurb:
      "Reads the content — film, music, speech or bass-heavy — and voices the target for it automatically. Airspace's Cinema/Music switch feeds it too.",
    tiltDbPerOct: 0,
    shapeDb: () => 0, // resolved per-measurement in deriveCorrection
  },
  {
    id: "reference",
    label: "Reference",
    blurb: "Balanced master — corrects only what strays from the track's own comfortable envelope.",
    tiltDbPerOct: 0,
    shapeDb: () => 0,
  },
  {
    id: "cinema",
    label: "Cinema",
    // Film & TV: dialog intelligibility (kept POLITE — a hot 2-4 kHz bump
    // reads as piercing within minutes), controlled infrasonic rumble
    // (below ~35 Hz headphones just distort), kept LFE weight around
    // 40-90 Hz, and air lifted INSTEAD of presence for the "HD" sheen.
    blurb: "Film & TV voicing — dialog cuts through politely, LFE stays weighty but controlled, air for the effects field.",
    tiltDbPerOct: 0,
    shapeDb: (f) =>
      bump(f, 2300, 0.9, 1.4) +
      bump(f, 60, 0.7, 1.5) +
      bump(f, 10500, 0.9, 1.4) -
      bump(f, 4200, 0.5, 0.8) -
      3.0 / (1 + Math.exp((Math.log2(f) - LOG2_38) / 0.3)),
  },
  {
    id: "dialog",
    label: "Dialog",
    // Spoken word: presence forward but smooth, rolled-off rumble below
    // ~95 Hz (nothing useful lives there in a podcast), de-mud at 300 Hz.
    blurb: "Spoken word — presence forward, rumble rolled off, mud cleared. Podcasts, audiobooks, commentary.",
    tiltDbPerOct: 0,
    shapeDb: (f) =>
      bump(f, 2400, 1.0, 2.0) -
      bump(f, 300, 0.7, 1.2) -
      bump(f, 5500, 0.5, 0.9) -
      4.0 / (1 + Math.exp((Math.log2(f) - LOG2_95) / 0.35)),
  },
  {
    id: "warm",
    label: "Warm",
    blurb: "Gentle downward tilt — fuller lows, relaxed top end.",
    tiltDbPerOct: -0.6,
    shapeDb: () => 0,
  },
  {
    id: "bright",
    label: "Bright",
    blurb: "Gentle upward tilt — more air and bite, leaner lows.",
    tiltDbPerOct: 0.6,
    shapeDb: () => 0,
  },
  {
    id: "bass-focus",
    label: "Bass Focus",
    // Smooth low shelf: full +3.5 dB by ~50 Hz, fading out by ~250 Hz —
    // polite enough to survive the +6 dB boost clamp and the level trim.
    blurb: "Controlled low-shelf emphasis below ~120 Hz, level-trimmed to stay polite.",
    tiltDbPerOct: 0,
    shapeDb: (f) => 3.5 / (1 + Math.exp((Math.log2(f) - LOG2_110) / 0.45)),
  },
  {
    id: "vocal",
    label: "Vocal Forward",
    // Gaussian presence lift centred at 2.8 kHz (sigma 0.75 oct) — covers
    // the classic 2-4 kHz intelligibility region without getting shouty.
    blurb: "Presence lift across 2-4 kHz so voices and leads sit in front.",
    tiltDbPerOct: 0,
    shapeDb: (f) => {
      const d = (Math.log2(f) - LOG2_2800) / 0.75;
      return 2.5 * Math.exp(-0.5 * d * d);
    },
  },
];

export const DEFAULT_TARGET_ID = TARGET_PROFILES[0].id;

export function getTargetProfile(id: string | undefined): TargetProfile {
  return TARGET_PROFILES.find((t) => t.id === id) ?? TARGET_PROFILES[0];
}

// ── Stage 1: measurement ──────────────────────────────────────────────────

export interface MeasureOptions {
  /** Abort to cancel — measurement throws an AbortError DOMException. */
  signal?: AbortSignal;
  onProgress?: (p: TractorProgress) => void;
}

/**
 * Scan a decoded track into a {@link TractorMeasurement}. This is the only
 * expensive stage; everything downstream (strength, target profile, vetoes)
 * derives from this result synchronously.
 */
export async function measureTrack(
  buffer: AudioBuffer,
  opts: MeasureOptions = {},
): Promise<TractorMeasurement> {
  const sr = buffer.sampleRate;
  const analyzedSec = buffer.length / sr;
  const centers = CENTERS.filter((f) => f < sr * 0.45);

  const welch = await welchSpectrum(buffer, opts.signal, opts.onProgress);
  if (welch.windowsUsed === 0) {
    return {
      sampleRate: sr,
      analyzedSec,
      windowsUsed: 0,
      centers,
      levelsDb: centers.map(() => 0),
      silent: true,
    };
  }
  opts.onProgress?.({ stage: "Folding into bands…", fraction: 0.94 });
  const levelsDb = bandLevelsDb(welch.power, sr, centers);
  return {
    sampleRate: sr,
    analyzedSec,
    windowsUsed: welch.windowsUsed,
    centers,
    levelsDb,
    silent: false,
    crestDb: welch.crestDb,
    dynRangeDb: welch.dynRangeDb,
    stereoCorr: welch.stereoCorr,
    bassShare: bandEnergyShare(centers, levelsDb, 0, 150),
    speechShare: bandEnergyShare(centers, levelsDb, 300, 3400),
    airShare: bandEnergyShare(centers, levelsDb, 7000, 24000),
  };
}

// ── Stage 2: correction derivation ────────────────────────────────────────

export interface DeriveOptions {
  headphone?: HeadphoneProfile;
  correctionEnabled: boolean;
  /** 0..1.5 scalar on the recommended moves (1 = recommended, 0 = none). */
  strength: number;
  /** Target profile id — defaults to "smart" (content-aware voicing). */
  targetId?: string;
  /** Band centre freqs (Hz) vetoed by the user — they contribute 0 dB. */
  excluded?: ReadonlySet<number>;
  /** External media-type hint (Airspace's Cinema/Music switch) — steers
   *  Smart Lock when the user has already declared what they're watching. */
  mediaHint?: "cinema" | "music" | null;
  /** The video/track TITLE — the classifier reads it ("Official Music
   *  Video", "Full Movie", "Podcast #213") alongside the spectrum. */
  titleHint?: string | null;
}

/** Smart Lock: pick the concrete voicing for this content + user hint. */
function resolveSmartProfile(
  content: ContentReading | null,
  hint: "cinema" | "music" | null,
): TargetProfile {
  const byId = (id: string) => TARGET_PROFILES.find((t) => t.id === id)!;
  if (hint === "cinema") {
    // The user said "I'm watching a film" — dialog-heavy film content still
    // reads better with the full cinema voicing than the podcast target.
    return byId("cinema");
  }
  switch (content?.kind) {
    case "cinema": return byId("cinema");
    case "speech": return hint === "music" ? byId("reference") : byId("dialog");
    default: return byId("reference");
  }
}

/**
 * Physics of the transducer: open-back and on-ear headphones can't move the
 * air a big sub shelf asks for — they just distort. Cap deep-bass BOOSTS per
 * form factor (cuts are always safe).
 */
function boostCapDb(freq: number, headphone: HeadphoneProfile | undefined): number {
  if (!headphone || freq > 90) return TRACTOR_BOOST_CLAMP_DB;
  const ff = headphone.formFactor;
  if (ff === "open-back" || ff === "on-ear") {
    return freq < 60 ? 3 : 4.5;
  }
  return TRACTOR_BOOST_CLAMP_DB;
}

/** Beyond-EQ moves (dynamics / width / de-ess) from the v4 fingerprint. */
function deriveMasterMoves(
  m: TractorMeasurement,
  content: ContentReading | null,
): { moves: Partial<SoundParams>; notes: string[] } {
  const moves: Partial<SoundParams> = {};
  const notes: string[] = [];
  const crest = m.crestDb;
  const dyn = m.dynRangeDb;
  const corr = m.stereoCorr ?? null;

  if (crest !== undefined && crest < 9.5) {
    moves.punch = 0.35;
    notes.push("Heavily limited master — restoring transient punch.");
  } else if (crest !== undefined && crest < 11.5) {
    moves.punch = 0.2;
    notes.push("Dense master — a touch of transient punch.");
  }

  if (content?.kind === "cinema") {
    if (dyn !== undefined && dyn > 6.5) {
      moves.compression = Math.min(0.4, 0.12 + (dyn - 6.5) * 0.06);
      notes.push("Wide cinematic dynamics — gentle glue keeps whispers audible without squashing impacts.");
    }
    // Theater space: depth AROUND the mix instead of brightness on top of it.
    moves.spatial = Math.max(moves.spatial ?? 0, 0.3);
    moves.reverbAmount = 0.1;
    notes.push("Theater staging — light room depth and crossfeed around the mix.");
  }

  if (content?.kind === "speech") {
    moves.deEss = 0.25;
    moves.compression = Math.max(moves.compression ?? 0, 0.25);
    moves.mbCompMid = 0.15;
    notes.push("Voice content — evened level and tamed sibilance.");
  }

  if (corr !== null) {
    if (corr > 0.92) {
      moves.width = 0.3;
      moves.spatial = Math.max(moves.spatial ?? 0, 0.3);
      notes.push("Nearly mono image — widened with crossfeed depth.");
    } else if (corr < 0.15) {
      moves.subWidth = -0.4;
      notes.push("Extremely wide mix — anchored the lows in mono for solidity.");
    }
  }

  if (content?.kind === "bass") {
    moves.mbCompLow = 0.3;
    notes.push("Bass-dominant content — multiband control keeps the low end tight.");
  }

  // Starved top end (heavy lossy encode) — regenerate sheen with harmonics
  // instead of just EQ-boosting the noise that's left up there.
  if ((m.airShare ?? 1) < 0.006 && (crest === undefined || crest > 7)) {
    moves.harmonics = Math.max(moves.harmonics ?? 0, 0.25);
    notes.push("Starved top octave (lossy upload?) — harmonic excitement regenerates sparkle.");
  }

  return { moves, notes };
}

function silentResult(
  centers: number[],
  analyzedSec: number,
  targetId: string,
): TractorResult {
  const bands: BandReading[] = centers.map((freq) => ({
    freq,
    relDb: 0,
    afterDb: 0,
    moveDb: 0,
  }));
  return {
    bands,
    curve: bands.map((b) => ({ freq: b.freq, db: 0 })),
    params: { ...NEUTRAL_PARAMS },
    bassMoveDb: 0,
    trebleMoveDb: 0,
    analyzedSec,
    maxMoveDb: 0,
    matchBeforePct: 0,
    matchAfterPct: 0,
    confidencePct: 0,
    trimDb: 0,
    windowsUsed: 0,
    silent: true,
    targetId,
    resolvedTargetId: targetId,
    content: null,
    masterMoves: {},
    masterNotes: [],
  };
}

/**
 * Derive the full correction (curve, preview, stats) from a measurement.
 * Pure and fast (~29 bands) — safe to call on every slider tick.
 */
export function deriveCorrection(
  m: TractorMeasurement,
  opts: DeriveOptions,
): TractorResult {
  const requested = getTargetProfile(opts.targetId);
  if (m.silent || m.windowsUsed === 0 || m.centers.length === 0) {
    return silentResult(m.centers, m.analyzedSec, requested.id);
  }
  // Smart Lock resolves to a concrete voicing per content (+media/title hints).
  const content = classifyContent(m, opts.titleHint);
  const profile =
    requested.id === "smart"
      ? resolveSmartProfile(content, opts.mediaHint ?? null)
      : requested;

  const centers = m.centers;
  const levelsDb = m.levelsDb;
  const strength = Math.max(0, Math.min(TRACTOR_MAX_STRENGTH, finite(opts.strength)));
  const excluded = opts.excluded;
  const included = centers.map((f) => !(excluded?.has(f) ?? false));

  const meanDb = levelsDb.reduce((a, b) => a + b, 0) / Math.max(1, levelsDb.length);
  const maxLevel = Math.max(...levelsDb);
  const lf = centers.map((f) => Math.log2(f));

  // Confidence: fade out near-silent bands so we don't EQ noise where the
  // track has no content (empty deep sub-bass / extreme air).
  const conf = levelsDb.map((L) => clamp01((L - (maxLevel - 42)) / 14));
  // Loudness weighting: decisions matter most where the ear is sensitive.
  const pweight = centers.map(perceptualWeight);
  const w = conf.map((c, i) => c * pweight[i]);

  // Broad envelope keeps the natural tonal shape (incl. tilt) but not narrow
  // resonances — flattening toward it tames peaks / fills dips only.
  const env = gaussianSmoothLog(levelsDb, lf, ENV_SIGMA_OCT);

  // Overall tilt of the music (dB/oct, constant-Q domain where pink ≈ flat).
  // Left alone unless it's extreme.
  const slope = weightedSlope(lf, env, w);
  const targetSlope = Math.max(SLOPE_MIN, Math.min(SLOPE_MAX, slope));
  const pivot = Math.log2(PIVOT_HZ);

  // The selected profile's voicing, relative to the REFERENCE target. Applied
  // in full (it's an explicit user request, unlike the conservative auto-tilt)
  // but still confidence-scaled below so we never boost noise-only bands.
  const profOff = centers.map(
    (freq, i) => profile.tiltDbPerOct * (lf[i] - pivot) + profile.shapeDb(freq),
  );

  // Explicit target curve: the track's own envelope, tilt-constrained, plus
  // the profile voicing.
  const targetDb = env.map(
    (e, i) => e + (targetSlope - slope) * (lf[i] - pivot) + profOff[i],
  );

  const rawMove = centers.map((freq, i) => {
    const local = (env[i] - levelsDb[i]) * LOCAL_STRENGTH; // tame resonances
    const tilt = (targetSlope - slope) * (lf[i] - pivot) * TILT_STRENGTH; // gentle
    const voice = opts.correctionEnabled
      ? 0
      : corrGainAt(opts.headphone, freq) * VOICE_STRENGTH;
    return (local + tilt + profOff[i] + voice) * (0.3 + 0.7 * conf[i]);
  });

  // Light 3-point smoothing across log-bands → a musical, non-jagged curve.
  const smooth = rawMove.map((mv, i) => {
    const a = rawMove[i - 1] ?? mv;
    const b = rawMove[i + 1] ?? mv;
    return 0.25 * a + 0.5 * mv + 0.25 * b;
  });

  // User strength scalar; vetoed bands are forced to zero from here on.
  const preTrim = smooth.map((mv, i) => (included[i] ? finite(mv) * strength : 0));

  // Loudness-preserving trim: subtract the energy+loudness-weighted mean move
  // so the corrected track plays at the same perceived level (fair A/B).
  // The weights favour bands that actually carry the track's energy. Vetoed
  // bands stay at exactly 0 dB, so the trim is computed over (and folded
  // into) the active bands only — the weighted net move still sums to zero.
  let tSum = 0;
  let tw = 0;
  for (let i = 0; i < preTrim.length; i++) {
    if (!included[i]) continue;
    const eShare = Math.pow(10, (levelsDb[i] - maxLevel) / 10);
    const wi = w[i] * eShare;
    tSum += wi * preTrim[i];
    tw += wi;
  }
  // trimDb is the offset folded into the curve (negative when the raw match
  // was a net boost), so the corrected track keeps its perceived level.
  const trimDb = tw > 1e-9 ? -finite(tSum / tw) : 0;
  // Boost ceiling respects the transducer: open-back / on-ear phones get a
  // lower deep-bass cap (they can't deliver a +6 dB sub shelf — it distorts).
  const moves = preTrim.map((mv, i) =>
    included[i]
      ? Math.max(
          -TRACTOR_CUT_CLAMP_DB,
          Math.min(boostCapDb(centers[i], opts.headphone), finite(mv + trimDb)),
        )
      : 0,
  );

  // Harshness guard: boosts in the 2.2-6.3 kHz region read as "piercing"
  // long before any other band. Cap the net lift there — the excess is
  // mostly discarded (and traded for dynamic de-ess in the master moves).
  const HARSH_LO = 2200;
  const HARSH_HI = 6300;
  const HARSH_CAP_DB = 1.8;
  let harshCapped = false;
  for (let i = 0; i < centers.length; i++) {
    if (centers[i] >= HARSH_LO && centers[i] <= HARSH_HI && moves[i] > HARSH_CAP_DB) {
      moves[i] = HARSH_CAP_DB + (moves[i] - HARSH_CAP_DB) * 0.3;
      harshCapped = true;
    }
  }

  const bands: BandReading[] = centers.map((freq, i) => ({
    freq,
    relDb: finite(levelsDb[i] - meanDb),
    afterDb: finite(levelsDb[i] - meanDb + moves[i]),
    moveDb: moves[i],
  }));

  const curve: CurvePoint[] = bands.map((b) => ({ freq: b.freq, db: b.moveDb }));

  // Match readout: loudness-weighted RMS deviation from the target curve,
  // before vs after (predicted). MATCH_FLOOR_DB residual maps to 0%.
  const wrms = (dev: number[]): number => {
    let s = 0;
    let sw = 0;
    for (let i = 0; i < dev.length; i++) {
      s += w[i] * dev[i] * dev[i];
      sw += w[i];
    }
    return sw > 1e-9 ? Math.sqrt(s / sw) : 0;
  };
  const dev0 = levelsDb.map((L, i) => L - targetDb[i]);
  // For the predicted "after" match, use only the spectral-correction part of
  // the move (exclude headphone voicing — that targets the transducer, not
  // the track) and re-centre so the level trim doesn't read as mismatch.
  const corrOnly = centers.map((freq, i) => {
    if (!included[i]) return 0;
    const voice = opts.correctionEnabled
      ? 0
      : corrGainAt(opts.headphone, freq) * VOICE_STRENGTH * (0.3 + 0.7 * conf[i]) * strength;
    return moves[i] - voice;
  });
  let cSum = 0;
  let cw = 0;
  for (let i = 0; i < corrOnly.length; i++) {
    cSum += w[i] * corrOnly[i];
    cw += w[i];
  }
  const corrMean = cw > 1e-9 ? cSum / cw : 0;
  const dev1 = dev0.map((d, i) => d + corrOnly[i] - corrMean);
  const toPct = (r: number) => Math.round(100 * clamp01(1 - r / MATCH_FLOOR_DB));
  const matchBeforePct = toPct(wrms(dev0));
  const matchAfterPct = Math.max(matchBeforePct, toPct(wrms(dev1)));

  // Confidence: how much of the spectrum had real signal × window coverage.
  let confSum = 0;
  let confW = 0;
  for (let i = 0; i < conf.length; i++) {
    confSum += conf[i] * pweight[i];
    confW += pweight[i];
  }
  const avgConf = confW > 1e-9 ? confSum / confW : 0;
  const coverage = clamp01(m.windowsUsed / 48);
  const confidencePct = Math.round(100 * avgConf * (0.5 + 0.5 * coverage));

  // 10-band "friendly" snapshot for saving the match as a macro preset.
  const params: SoundParams = { ...NEUTRAL_PARAMS };
  (Object.keys(FRIENDLY_TO_EQ) as FriendlyKey[]).forEach((k) => {
    const meta = FRIENDLY_TO_EQ[k];
    params[k] = Math.max(-1, Math.min(1, sampleCurveDb(curve, meta.freq) / meta.maxDb));
  });

  // Readout: the NET EQ move in the bass / treble regions, so its sign
  // matches the curve (a cut reads negative, a boost positive).
  const avgMove = (lo: number, hi: number) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < centers.length; i++) {
      if (centers[i] >= lo && centers[i] <= hi) {
        s += bands[i].moveDb;
        n++;
      }
    }
    return n ? s / n : 0;
  };
  const bassMoveDb = avgMove(20, 200);
  const trebleMoveDb = avgMove(4000, 16000);
  const maxMoveDb = bands.reduce((mx, b) => Math.max(mx, Math.abs(b.moveDb)), 0);

  const master = deriveMasterMoves(m, content);
  if (harshCapped) {
    master.moves.deEss = Math.max(master.moves.deEss ?? 0, 0.22);
    master.notes.push("Capped a piercing 2-6 kHz build-up — smoothed the rest with dynamic de-ess.");
  }

  return {
    bands,
    curve,
    params,
    bassMoveDb,
    trebleMoveDb,
    analyzedSec: m.analyzedSec,
    maxMoveDb,
    matchBeforePct,
    matchAfterPct,
    confidencePct,
    trimDb,
    windowsUsed: m.windowsUsed,
    silent: false,
    targetId: requested.id,
    resolvedTargetId: profile.id,
    content,
    masterMoves: master.moves,
    masterNotes: master.notes,
  };
}

// ── Deadflat (Calibration) ────────────────────────────────────────────────

export interface DeadflatResult {
  /** Correction curve — sample with sampleCurveDb(), apply to the Sculptor. */
  curve: CurvePoint[];
  /** Loudness-weighted spectral deviation from flat BEFORE (dB RMS). */
  flatnessBeforeDb: number;
  /** Predicted deviation AFTER the curve is applied (dB RMS). */
  flatnessAfterDb: number;
  maxMoveDb: number;
  silent: boolean;
}

/**
 * DEADFLAT — the Calibration hammer. Unlike Tractor Beam (which respects the
 * track's own tonal character), this drives every 1/3-octave band toward a
 * TRUE FLAT constant-Q line (pink reads flat here): no tilt preservation, no
 * taste profiles. Confidence- and loudness-weighted so it doesn't EQ noise,
 * clamped ±9 dB, level-trimmed for a fair A/B.
 */
export function deriveDeadflat(m: TractorMeasurement, strength = 1): DeadflatResult {
  if (m.silent || m.windowsUsed === 0 || m.centers.length === 0) {
    return { curve: [], flatnessBeforeDb: 0, flatnessAfterDb: 0, maxMoveDb: 0, silent: true };
  }
  const centers = m.centers;
  const levelsDb = m.levelsDb;
  const lf = centers.map((f) => Math.log2(f));
  const maxLevel = Math.max(...levelsDb);
  const conf = levelsDb.map((L) => clamp01((L - (maxLevel - 42)) / 14));
  const pweight = centers.map(perceptualWeight);
  const w = conf.map((c, i) => c * pweight[i]);

  // The flat reference: the loudness-weighted mean level.
  let mSum = 0;
  let mW = 0;
  for (let i = 0; i < centers.length; i++) {
    mSum += levelsDb[i] * w[i];
    mW += w[i];
  }
  const mean = mW > 1e-9 ? mSum / mW : 0;

  const s = Math.max(0, Math.min(1.5, strength));
  const rawMove = levelsDb.map((L, i) => (mean - L) * (0.25 + 0.75 * conf[i]) * s);
  // Light smoothing so adjacent bands don't fight.
  const smooth = rawMove.map((mv, i) => {
    const a = rawMove[i - 1] ?? mv;
    const b = rawMove[i + 1] ?? mv;
    return 0.25 * a + 0.5 * mv + 0.25 * b;
  });
  // Level-preserving trim over energy-carrying bands.
  let tSum = 0;
  let tw = 0;
  for (let i = 0; i < smooth.length; i++) {
    const eShare = Math.pow(10, (levelsDb[i] - maxLevel) / 10);
    tSum += w[i] * eShare * smooth[i];
    tw += w[i] * eShare;
  }
  const trim = tw > 1e-9 ? -(tSum / tw) : 0;
  const moves = smooth.map((mv) => Math.max(-9, Math.min(9, finite(mv + trim))));

  const wrms = (dev: number[]): number => {
    let sum = 0;
    let sw = 0;
    for (let i = 0; i < dev.length; i++) {
      sum += w[i] * dev[i] * dev[i];
      sw += w[i];
    }
    return sw > 1e-9 ? Math.sqrt(sum / sw) : 0;
  };
  const before = levelsDb.map((L) => L - mean);
  const after = levelsDb.map((L, i) => L + moves[i] - mean - trim);

  return {
    curve: centers.map((freq, i) => ({ freq, db: moves[i] })),
    flatnessBeforeDb: wrms(before),
    flatnessAfterDb: wrms(after),
    maxMoveDb: moves.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0),
    silent: false,
  };
}

// ── One-shot wrapper (measure + derive) ───────────────────────────────────

export interface AnalyzeOptions extends DeriveOptions {
  /** Abort to cancel — analysis throws an AbortError DOMException. */
  signal?: AbortSignal;
  onProgress?: (p: TractorProgress) => void;
}

export async function analyzeTrack(
  buffer: AudioBuffer,
  opts: AnalyzeOptions,
): Promise<TractorResult> {
  const m = await measureTrack(buffer, { signal: opts.signal, onProgress: opts.onProgress });
  opts.onProgress?.({ stage: "Deriving correction…", fraction: 0.97 });
  const res = deriveCorrection(m, opts);
  opts.onProgress?.({ stage: "Done", fraction: 1 });
  return res;
}
