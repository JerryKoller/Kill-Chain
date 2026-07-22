/**
 * Canvas renderers for the Library Visualizer — five distinct modes, all
 * fed from the SAME shared post-chain analyser (engine.analyserPost, the
 * tap on destinationTap) so what you see is exactly what you hear, for any
 * source: library tracks, mic input, or Exterior Audio loopback capture.
 *
 * Performance contract (hot path, 60 fps):
 *   - every typed array / ImageData / LUT is allocated in the factory or
 *     in resize() — draw() never allocates arrays or objects;
 *   - colour strings used inside per-bar / per-particle loops come from
 *     LUTs precomputed once per session;
 *   - the one RenderFrame object is owned by the overlay and mutated in
 *     place each frame.
 */

// ─── shared types ────────────────────────────────────────────────────────────

import type { IntelSnapshot } from "./visualIntel";

export type RGB = [number, number, number];

export interface ThemePalette {
  cyan: RGB;
  plasma: RGB;
  violet: RGB;
  lime: RGB;
  amber: RGB;
  ink: RGB;
}

/** Mutable per-frame data bag — allocated once by the overlay. */
export interface RenderFrame {
  g: CanvasRenderingContext2D;
  /** Canvas size in CSS px (context is pre-scaled by dpr). */
  W: number;
  H: number;
  /** Byte FFT + time-domain from the shared post analyser. */
  freq: Uint8Array;
  time: Uint8Array;
  binCount: number;
  sampleRate: number;
  /** Seconds since last drawn frame, clamped to 50 ms. */
  dt: number;
  now: number;
  /** 0..1 full-band RMS of the time-domain block. */
  rms: number;
  /** 0..1 smoothed low-band (< ~160 Hz) energy. */
  low: number;
  /** 0..1 mid-band (~400 Hz – 2.5 kHz) energy. */
  mid: number;
  /** 0..1 high-band (> ~4 kHz) energy. */
  high: number;
  /** 0..1 spectral centroid (dark ↔ bright) — drives hue drifts. */
  centroid: number;
  /** True only on the frame a beat was detected. */
  beatHit: boolean;
  /** Beat envelope: jumps to 1 on a hit, exponential decay. */
  beat: number;
  /** Momentary LUFS from the engine meter (≤ -120 when silent/idle). */
  lufs: number;
  /** Currently playing track/media title ("" when unknown). */
  title: string;
  reduced: boolean;
  /**
   * Shared Visual Intelligence snapshot (v1.8): BPM + beat/bar phase, band
   * onsets (kick/snare/hat/vocal), stereo width & phase correlation, section
   * estimate, engage pulse and the per-track palette. Filled by the ONE
   * analysis pipeline (main window) or deserialized from IPC (broadcast) —
   * renderers must never run their own detectors.
   */
  intel: IntelSnapshot;
}

export interface ModeRenderer {
  /** Re-derive size-dependent state. Called on mount and on every resize. */
  resize(W: number, H: number): void;
  draw(f: RenderFrame): void;
}

// ─── small helpers ───────────────────────────────────────────────────────────

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate along a list of colour stops; t in 0..1. */
function sampleStops(stops: { t: number; c: RGB }[], t: number): RGB {
  if (t <= stops[0].t) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const k = (t - stops[i - 1].t) / (stops[i].t - stops[i - 1].t);
      const a = stops[i - 1].c;
      const b = stops[i].c;
      return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    }
  }
  return stops[stops.length - 1].c;
}

/** Precompute `steps` rgba() strings along colour stops at a fixed alpha. */
function gradientLut(
  stops: { t: number; c: RGB }[],
  steps: number,
  alpha: number,
): string[] {
  const out = new Array<string>(steps);
  for (let i = 0; i < steps; i++) {
    const c = sampleStops(stops, i / (steps - 1));
    out[i] = `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
  }
  return out;
}

/**
 * Fill `out` (2 entries per band) with FFT bin ranges for `count` bands
 * log-spaced between fLo..fHi. Guarantees each band spans ≥ 1 bin.
 */
function logBinRanges(
  out: Uint16Array,
  count: number,
  binCount: number,
  sampleRate: number,
  fLo: number,
  fHi: number,
): void {
  const nyq = sampleRate / 2;
  const ratio = fHi / fLo;
  for (let i = 0; i < count; i++) {
    const f0 = fLo * Math.pow(ratio, i / count);
    const f1 = fLo * Math.pow(ratio, (i + 1) / count);
    let b0 = Math.floor((f0 / nyq) * binCount);
    let b1 = Math.ceil((f1 / nyq) * binCount);
    b0 = Math.max(1, Math.min(binCount - 2, b0));
    b1 = Math.max(b0 + 1, Math.min(binCount - 1, b1));
    out[i * 2] = b0;
    out[i * 2 + 1] = b1;
  }
}

/** Peak (max) byte value across a bin range, normalised 0..1. */
function bandPeak(freq: Uint8Array, b0: number, b1: number): number {
  let p = 0;
  for (let b = b0; b < b1; b++) {
    const v = freq[b];
    if (v > p) p = v;
  }
  return p / 255;
}

const MONO_FONT = "JetBrains Mono, Consolas, monospace";

// Reactor's data core speaks in half-width katakana + mono digits — a
// deliberately different face from the rest of the app (Windows ships the
// glyphs in MS Gothic; the stack degrades to mono elsewhere).
const MATRIX_FONT = '"MS Gothic", "Yu Gothic", "Meiryo", "JetBrains Mono", monospace';
const KATA_START = 0xff66;
const KATA_SPAN = 0xff9d - KATA_START;
function kataChar(): string {
  return String.fromCharCode(KATA_START + ((Math.random() * KATA_SPAN) | 0));
}

// ─── shared Kill-Chain flavor passes (drawn OVER any mode by the hosts) ─────

/**
 * Tactical HUD framing: corner brackets + tick marks. Cheap (8 strokes),
 * alpha follows the music so the frame breathes instead of sitting static.
 */
export function drawTacticalFrame(f: RenderFrame): void {
  const { g, W, H } = f;
  const m = 14;
  const L = Math.min(46, Math.min(W, H) * 0.06);
  const a = 0.14 + f.intel.energy * 0.12 + f.beat * 0.1;
  g.strokeStyle = `rgba(140,200,230,${a.toFixed(3)})`;
  g.lineWidth = 1;
  g.beginPath();
  // four corner brackets
  g.moveTo(m, m + L); g.lineTo(m, m); g.lineTo(m + L, m);
  g.moveTo(W - m - L, m); g.lineTo(W - m, m); g.lineTo(W - m, m + L);
  g.moveTo(W - m, H - m - L); g.lineTo(W - m, H - m); g.lineTo(W - m - L, H - m);
  g.moveTo(m + L, H - m); g.lineTo(m, H - m); g.lineTo(m, H - m - L);
  g.stroke();
  // bar-phase tick crawling along the top edge (only when the clock is locked)
  if (f.intel.bpm > 0 && f.intel.bpmConf > 0.2) {
    const x = m + L + (W - 2 * (m + L)) * f.intel.barPhase;
    g.strokeStyle = `rgba(140,200,230,${(a * 2).toFixed(3)})`;
    g.beginPath();
    g.moveTo(x, m - 3);
    g.lineTo(x, m + 5);
    g.stroke();
  }
}

/**
 * Breach pulse — fired by the intel layer whenever Kill Chain engages or
 * disengages: an expanding double shock ring + brief edge flash. Drawn over
 * the active mode by both hosts; self-skips when the pulse has decayed.
 */
export function drawEngagePulse(f: RenderFrame): void {
  const p = f.intel.engagePulse;
  if (p < 0.02) return;
  const { g, W, H } = f;
  const cx = W / 2;
  const cy = H / 2;
  const t = 1 - p; // 0 at trigger → 1 fully decayed
  const maxR = Math.hypot(W, H) * 0.6;
  const r = 20 + t * maxR;
  g.save();
  g.strokeStyle = `rgba(255,96,64,${(p * 0.8).toFixed(3)})`;
  g.lineWidth = 2 + p * 3;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = `rgba(150,210,240,${(p * 0.5).toFixed(3)})`;
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  g.stroke();
  // edge flash
  g.fillStyle = `rgba(255,120,80,${(p * p * 0.1).toFixed(3)})`;
  g.fillRect(0, 0, W, H);
  g.restore();
}

// ─── 1 · SPECTRUM ARRAY ─────────────────────────────────────────────────────
// Tactical HUD bar spectrum: log frequency scale, dB grid hairlines,
// gravity-driven peak-hold caps.

const SPEC_DB_MARKS = [0, -12, -24, -36, -48, -60, -72];
const SPEC_FREQ_MARKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

export function createSpectrumArray(
  pal: ThemePalette,
  binCount: number,
  sampleRate: number,
): ModeRenderer {
  const MAX_BARS = 128;
  const ranges = new Uint16Array(MAX_BARS * 2);
  const vals = new Float32Array(MAX_BARS);
  const peaks = new Float32Array(MAX_BARS);
  const peakVel = new Float32Array(MAX_BARS);
  const lut = gradientLut(
    [
      { t: 0, c: pal.cyan },
      { t: 0.55, c: pal.violet },
      { t: 0.8, c: pal.plasma },
      { t: 1, c: pal.amber },
    ],
    48,
    0.92,
  );
  const gridCol = rgba(pal.cyan, 0.07);
  const gridStrong = rgba(pal.cyan, 0.14);
  const labelCol = rgba(pal.cyan, 0.4);
  const capCol = rgba(pal.amber, 0.95);
  const F_LO = 30;
  const F_HI = 18000;

  let bars = 96;
  const PAD_L = 34;
  const PAD_B = 18;
  const PAD_T = 10;

  return {
    resize(W: number, _H: number) {
      bars = Math.max(40, Math.min(MAX_BARS, Math.floor((W - PAD_L) / 9)));
      logBinRanges(ranges, bars, binCount, sampleRate, F_LO, F_HI);
      vals.fill(0);
      peaks.fill(0);
      peakVel.fill(0);
    },

    draw(f: RenderFrame) {
      const { g, W, H, freq, dt } = f;
      const plotW = W - PAD_L - 8;
      const plotH = H - PAD_T - PAD_B;

      g.fillStyle = "#04050a";
      g.fillRect(0, 0, W, H);

      // Floor glow that breathes with the low band — the room lights up
      // when the bass moves.
      if (f.low > 0.04) {
        const glow = g.createLinearGradient(0, PAD_T + plotH * 0.55, 0, PAD_T + plotH);
        glow.addColorStop(0, "rgba(4,5,10,0)");
        glow.addColorStop(1, rgba(pal.violet, 0.05 + f.low * 0.16 + f.beat * 0.08));
        g.fillStyle = glow;
        g.fillRect(PAD_L, PAD_T, plotW, plotH);
      }

      // dB hairlines (display grid: 0 dB at top → -72 dB near bottom)
      g.font = `9px ${MONO_FONT}`;
      g.textAlign = "left";
      g.lineWidth = 1;
      for (let i = 0; i < SPEC_DB_MARKS.length; i++) {
        const db = SPEC_DB_MARKS[i];
        const y = PAD_T + (db / -78) * plotH;
        g.strokeStyle = db === 0 ? gridStrong : gridCol;
        g.beginPath();
        g.moveTo(PAD_L, y);
        g.lineTo(W - 8, y);
        g.stroke();
        g.fillStyle = labelCol;
        g.fillText(db === 0 ? "0 dB" : `${db}`, 4, y + 3);
      }
      // frequency ticks
      const logLo = Math.log10(F_LO);
      const logHi = Math.log10(F_HI);
      g.textAlign = "center";
      for (let i = 0; i < SPEC_FREQ_MARKS.length; i++) {
        const fr = SPEC_FREQ_MARKS[i];
        const x = PAD_L + ((Math.log10(fr) - logLo) / (logHi - logLo)) * plotW;
        g.strokeStyle = gridCol;
        g.beginPath();
        g.moveTo(x, PAD_T);
        g.lineTo(x, PAD_T + plotH);
        g.stroke();
        g.fillStyle = labelCol;
        g.fillText(fr >= 1000 ? `${fr / 1000}k` : `${fr}`, x, H - 6);
      }

      // bars + caps
      const bw = plotW / bars;
      const gap = Math.max(1, bw * 0.22);
      const riseK = 1 - Math.exp(-dt * 42);
      const fallK = 1 - Math.exp(-dt * 9);
      const G = 2.6; // cap gravity, canvas-heights / s²
      // Beat punch: the whole array leans into the hit, then relaxes.
      const punch = 1 + f.beat * 0.05;
      // Brightness rides the centroid: dark songs sit low in the LUT,
      // bright songs climb toward plasma/amber.
      const lutShift = (f.centroid * 8) | 0;

      for (let i = 0; i < bars; i++) {
        const raw = bandPeak(freq, ranges[i * 2], ranges[i * 2 + 1]);
        const v = Math.pow(raw, 1.25);
        const prev = vals[i];
        vals[i] = v > prev ? prev + (v - prev) * riseK : prev + (v - prev) * fallK;

        // peak-hold with gravity fall
        if (vals[i] >= peaks[i]) {
          peaks[i] = vals[i];
          peakVel[i] = 0;
        } else {
          peakVel[i] += G * dt;
          peaks[i] = Math.max(vals[i], peaks[i] - peakVel[i] * dt);
        }

        const h = vals[i] * plotH * punch;
        if (h > 0.5) {
          const x = PAD_L + i * bw;
          g.fillStyle = lut[Math.min(47, ((vals[i] * 47) | 0) + lutShift)];
          g.fillRect(x + gap * 0.5, PAD_T + plotH - h, bw - gap, h);
          // Hot tip: the top 3 px of a tall bar burns white-hot.
          if (vals[i] > 0.55) {
            g.fillStyle = "rgba(255,250,240,0.85)";
            g.fillRect(x + gap * 0.5, PAD_T + plotH - h, bw - gap, 2.5);
          }
        }
        const ph = peaks[i] * plotH;
        if (ph > 1) {
          const x = PAD_L + i * bw;
          g.fillStyle = capCol;
          g.fillRect(x + gap * 0.5, PAD_T + plotH - ph - 2, bw - gap, 2);
        }
      }
    },
  };
}

// ─── 2 · WAVEFORM SCOPE ─────────────────────────────────────────────────────
// Zero-cross-triggered oscilloscope with phosphor afterglow (alpha-fade,
// never a full clear) and a thin scrolling RMS envelope band.

export function createWaveformScope(pal: ThemePalette): ModeRenderer {
  const HISTORY = 240;
  const rmsHist = new Float32Array(HISTORY);
  let histIdx = 0;
  let firstFrame = true;

  // Trace colour follows the spectral centroid: dark material draws violet,
  // bright material draws ice — the beam itself tells you the timbre.
  const traceLut = gradientLut(
    [
      { t: 0, c: pal.violet },
      { t: 0.45, c: pal.cyan },
      { t: 1, c: [235, 250, 255] as RGB },
    ],
    17,
    0.95,
  );
  const gridCol = rgba(pal.cyan, 0.08);
  const centerCol = rgba(pal.cyan, 0.16);
  const envFill = rgba(pal.amber, 0.32);
  const envLine = rgba(pal.amber, 0.75);
  const labelCol = rgba(pal.cyan, 0.4);

  return {
    resize(_W: number, _H: number) {
      firstFrame = true;
      rmsHist.fill(0);
      histIdx = 0;
    },

    draw(f: RenderFrame) {
      const { g, W, H, time, reduced } = f;
      const envH = Math.min(90, H * 0.16);
      const scopeH = H - envH - 12;
      const cy = scopeH / 2;

      // Afterglow: translucent ink wash instead of a clear. Reduced motion
      // gets a heavier wash = much shorter phosphor trail.
      if (firstFrame) {
        g.fillStyle = "#04050a";
        g.fillRect(0, 0, W, H);
        firstFrame = false;
      } else {
        g.fillStyle = reduced ? "rgba(4,5,10,0.55)" : "rgba(4,5,10,0.16)";
        g.fillRect(0, 0, W, H);
      }

      // reticle grid (redrawn so it survives the fade)
      g.lineWidth = 1;
      g.strokeStyle = gridCol;
      g.beginPath();
      g.moveTo(0, cy - scopeH * 0.25);
      g.lineTo(W, cy - scopeH * 0.25);
      g.moveTo(0, cy + scopeH * 0.25);
      g.lineTo(W, cy + scopeH * 0.25);
      g.stroke();
      g.strokeStyle = centerCol;
      g.beginPath();
      g.moveTo(0, cy);
      g.lineTo(W, cy);
      g.stroke();

      // Trigger: first rising crossing through the midpoint in the first
      // half of the block → stable trace instead of a rolling smear.
      const N = time.length;
      const half = N >> 1;
      let start = 0;
      for (let i = 1; i < half; i++) {
        if (time[i - 1] < 128 && time[i] >= 128) {
          start = i;
          break;
        }
      }

      const traceCol = traceLut[Math.min(16, (f.centroid * 16) | 0)];
      g.strokeStyle = traceCol;
      // The beam fattens on the beat — a physical pulse, not a flash.
      g.lineWidth = 1.6 + f.beat * 1.6;
      if (!reduced) {
        g.shadowColor = traceCol;
        g.shadowBlur = 7 + f.beat * 8;
      }
      g.beginPath();
      const span = half; // draw exactly half a block from the trigger
      for (let i = 0; i < span; i++) {
        const x = (i / (span - 1)) * W;
        const y = cy - ((time[start + i] - 128) / 128) * scopeH * 0.44;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;

      // ── RMS envelope band (thin strip chart along the bottom) ──
      rmsHist[histIdx] = f.rms;
      histIdx = (histIdx + 1) % HISTORY;

      const bandTop = scopeH + 12;
      const bandMid = bandTop + envH / 2;
      g.fillStyle = "rgba(4,5,10,0.9)";
      g.fillRect(0, bandTop, W, envH);
      g.strokeStyle = gridCol;
      g.beginPath();
      g.moveTo(0, bandMid);
      g.lineTo(W, bandMid);
      g.stroke();

      g.beginPath();
      const step = W / (HISTORY - 1);
      for (let i = 0; i < HISTORY; i++) {
        const v = rmsHist[(histIdx + i) % HISTORY];
        const hh = Math.min(1, v * 2.6) * (envH * 0.46);
        const x = i * step;
        if (i === 0) g.moveTo(x, bandMid - hh);
        else g.lineTo(x, bandMid - hh);
      }
      for (let i = HISTORY - 1; i >= 0; i--) {
        const v = rmsHist[(histIdx + i) % HISTORY];
        const hh = Math.min(1, v * 2.6) * (envH * 0.46);
        g.lineTo(i * step, bandMid + hh);
      }
      g.closePath();
      g.fillStyle = envFill;
      g.fill();
      g.strokeStyle = envLine;
      g.lineWidth = 1;
      g.stroke();

      g.font = `9px ${MONO_FONT}`;
      g.textAlign = "left";
      g.fillStyle = labelCol;
      g.fillText("RMS ENVELOPE", 6, bandTop + 11);
    },
  };
}

// ─── 3 · RADIAL REACTOR ─────────────────────────────────────────────────────
// Circular spectrum ring: segment length per log band, core radius pulses
// with low-band energy, slow rotation, live LUFS readout in the core.

export function createRadialReactor(
  pal: ThemePalette,
  binCount: number,
  sampleRate: number,
): ModeRenderer {
  const SEG = 108;
  const ranges = new Uint16Array(SEG * 2);
  logBinRanges(ranges, SEG, binCount, sampleRate, 40, 16000);
  const vals = new Float32Array(SEG);
  const segPeaks = new Float32Array(SEG);
  const lut = gradientLut(
    [
      { t: 0, c: pal.cyan },
      { t: 0.6, c: pal.violet },
      { t: 1, c: pal.plasma },
    ],
    33,
    0.9,
  );
  const ringCol = rgba(pal.cyan, 0.25);
  const ringGlow = rgba(pal.cyan, 0.1);
  const peakCol = rgba(pal.amber, 0.55);
  const coreText = rgba(pal.cyan, 0.95);
  const coreLabel = rgba(pal.cyan, 0.45);
  const tickCol = rgba(pal.cyan, 0.14);

  let rot = 0;
  let sweep = 0;
  let lufsStr = "──·─";
  let lastLufs = -999;
  let smoothLow = 0;

  // ── Matrix data core: track-relevant intel flashing like code. ──
  const HEX = "0123456789ABCDEF";
  const DATA_SLOTS = 5;
  const dataLines = new Array<string>(DATA_SLOTS).fill("");
  const dataAge = new Float32Array(DATA_SLOTS).fill(9);
  let dataTimer = 0;
  let dataCursor = 0;

  // Digital rain — katakana columns falling through the core disc. Beats
  // spawn fresh columns; column speed rides the track energy.
  interface RainCol { x: number; y: number; speed: number; len: number; glyphs: string[]; hot: number }
  const rain: RainCol[] = [];
  const MAX_RAIN = 16;
  function spawnRain(radius: number) {
    if (rain.length >= MAX_RAIN) return;
    const len = 5 + ((Math.random() * 9) | 0);
    rain.push({
      x: (Math.random() * 2 - 1) * radius * 0.85,
      y: -radius - Math.random() * radius,
      speed: radius * (0.55 + Math.random() * 0.9),
      len,
      glyphs: Array.from({ length: len }, kataChar),
      hot: 1,
    });
  }

  /** One line of core intel. Mixes real telemetry with katakana static. */
  function makeToken(f: RenderFrame): string {
    const kata = (n: number) => Array.from({ length: n }, kataChar).join("");
    const pick = (Math.random() * 14) | 0;
    switch (pick) {
      case 0: {
        // A shard of the actual title, uppercased — the track bleeding through.
        const t = f.title.replace(/\s+/g, " ").trim().toUpperCase();
        if (t.length < 3) return `SIG ${HEX[(Math.random() * 16) | 0]}${HEX[(Math.random() * 16) | 0]} ${kata(3)}`;
        const len = 6 + ((Math.random() * 8) | 0);
        const at = (Math.random() * Math.max(1, t.length - len)) | 0;
        return t.slice(at, at + len);
      }
      case 1: return `LOW ${((f.low * 100) | 0).toString().padStart(2, "0")}% ${kata(2)}`;
      case 2: return `MID ${((f.mid * 100) | 0).toString().padStart(2, "0")}% ${kata(2)}`;
      case 3: return `AIR ${((f.high * 100) | 0).toString().padStart(2, "0")}% ${kata(2)}`;
      case 4: return f.lufs <= -99 ? `SIG LOST ${kata(4)}` : `${f.lufs.toFixed(1)} LU`;
      case 5: return `CTR ${(220 + f.centroid * 7800) | 0}Hz`;
      case 6: {
        const bpm = f.intel.bpm;
        return bpm > 0 && f.intel.bpmConf > 0.25
          ? `TEMPO LOCK ${bpm.toFixed(0)} ${kata(2)}`
          : `TEMPO SCAN ${kata(4)}`;
      }
      case 7: return `PHASE ${f.intel.phaseCorr >= 0 ? "+" : ""}${f.intel.phaseCorr.toFixed(2)}`;
      case 8: return `SECTOR ${f.intel.section.toUpperCase()}`;
      case 9: {
        const drums = [];
        if (f.intel.kick > 0.25) drums.push("KCK");
        if (f.intel.snare > 0.25) drums.push("SNR");
        if (f.intel.hat > 0.25) drums.push("HAT");
        return drums.length ? `HIT ${drums.join("·")}` : `SWEEP ${kata(3)}`;
      }
      case 10: return `GRID ${(Math.random() * 90) | 0}°${(Math.random() * 60) | 0}'${(Math.random() * 60) | 0}"`;
      case 11: {
        let b = "";
        for (let i = 0; i < 8; i++) b += Math.random() < 0.5 ? "0" : "1";
        return `${b} ${kata(2)}`;
      }
      case 12: return kata(8 + ((Math.random() * 6) | 0));
      default: {
        let s = "0x";
        for (let i = 0; i < 6; i++) s += HEX[(Math.random() * 16) | 0];
        return s;
      }
    }
  }

  return {
    resize(_W: number, _H: number) {
      vals.fill(0);
      segPeaks.fill(0);
    },

    draw(f: RenderFrame) {
      const { g, W, H, freq, dt, reduced } = f;
      g.fillStyle = "#04050a";
      g.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const unit = Math.min(W, H);

      smoothLow += (f.low - smoothLow) * (1 - Math.exp(-dt * 12));
      const baseR = unit * (0.17 + smoothLow * 0.05 + f.beat * 0.018);
      const maxLen = unit * 0.24;

      // Living background: a radial tint that drifts with the centroid and
      // swells on the low band, plus a slow radar sweep behind the ring.
      const bgC = sampleStops(
        [
          { t: 0, c: pal.violet },
          { t: 0.6, c: pal.cyan },
          { t: 1, c: pal.plasma },
        ],
        f.centroid,
      );
      const bg = g.createRadialGradient(cx, cy, unit * 0.05, cx, cy, unit * 0.75);
      bg.addColorStop(0, `rgba(${bgC[0] | 0},${bgC[1] | 0},${bgC[2] | 0},${0.05 + smoothLow * 0.1 + f.beat * 0.06})`);
      bg.addColorStop(1, "rgba(4,5,10,0)");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      if (!reduced) {
        sweep += dt * (0.5 + f.rms * 1.6);
        const sa = sweep % (Math.PI * 2);
        const sweepGrad = g.createLinearGradient(
          cx, cy,
          cx + Math.cos(sa) * unit * 0.7,
          cy + Math.sin(sa) * unit * 0.7,
        );
        sweepGrad.addColorStop(0, rgba(pal.cyan, 0.12));
        sweepGrad.addColorStop(1, "rgba(4,5,10,0)");
        g.strokeStyle = sweepGrad;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(sa) * unit * 0.7, cy + Math.sin(sa) * unit * 0.7);
        g.stroke();
      }

      // slow rotation, plus a nudge from the beat (frozen in reduced motion)
      if (!reduced) rot += dt * (0.12 + smoothLow * 0.25 + f.beat * 0.4);

      // range rings
      g.lineWidth = 1;
      g.strokeStyle = tickCol;
      g.beginPath();
      g.arc(cx, cy, baseR + maxLen, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, baseR + maxLen * 0.5, 0, Math.PI * 2);
      g.stroke();

      // spectrum segments
      const riseK = 1 - Math.exp(-dt * 38);
      const fallK = 1 - Math.exp(-dt * 8);
      const segW = Math.max(1.5, ((Math.PI * 2 * baseR) / SEG) * 0.5);
      g.lineWidth = segW;
      for (let i = 0; i < SEG; i++) {
        const raw = Math.pow(bandPeak(freq, ranges[i * 2], ranges[i * 2 + 1]), 1.3);
        const prev = vals[i];
        vals[i] = raw > prev ? prev + (raw - prev) * riseK : prev + (raw - prev) * fallK;
        segPeaks[i] = Math.max(vals[i], segPeaks[i] - dt * 0.35);

        const a = rot + (i / SEG) * Math.PI * 2;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const len = vals[i] * maxLen;
        if (len > 0.8) {
          g.strokeStyle = lut[Math.min(32, (vals[i] * 32) | 0)];
          g.beginPath();
          g.moveTo(cx + cosA * baseR, cy + sinA * baseR);
          g.lineTo(cx + cosA * (baseR + len), cy + sinA * (baseR + len));
          g.stroke();
        }
      }

      // peak dots (kept outside the segment pass so lineWidth stays put)
      g.fillStyle = peakCol;
      for (let i = 0; i < SEG; i++) {
        const pl = segPeaks[i] * maxLen;
        if (pl < 2) continue;
        const a = rot + (i / SEG) * Math.PI * 2;
        const r = baseR + pl + 2;
        g.fillRect(cx + Math.cos(a) * r - 1, cy + Math.sin(a) * r - 1, 2, 2);
      }

      // core ring + glow
      g.strokeStyle = ringCol;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, baseR - segW, 0, Math.PI * 2);
      g.stroke();
      const glowR = baseR - segW - 2;
      if (glowR > 4) {
        g.fillStyle = ringGlow;
        g.beginPath();
        g.arc(cx, cy, glowR, 0, Math.PI * 2);
        g.fill();
      }

      // ── Digital rain through the core disc (clipped to the circle). ──
      if (glowR > 20 && !reduced) {
        if (f.beatHit) { spawnRain(glowR); spawnRain(glowR); }
        if (rain.length < 6 && Math.random() < dt * 3) spawnRain(glowR);
        const cell = Math.max(9, glowR * 0.085);
        g.save();
        g.beginPath();
        g.arc(cx, cy, glowR, 0, Math.PI * 2);
        g.clip();
        g.font = `${cell | 0}px ${MATRIX_FONT}`;
        g.textAlign = "center";
        for (let i = rain.length - 1; i >= 0; i--) {
          const c = rain[i];
          c.y += c.speed * dt * (0.6 + f.rms * 1.8 + f.beat * 0.8);
          c.hot = Math.max(0.35, c.hot - dt * 0.4);
          // Glyphs mutate as they fall — the signature matrix shimmer.
          if (Math.random() < dt * 14) c.glyphs[(Math.random() * c.len) | 0] = kataChar();
          for (let jj = 0; jj < c.len; jj++) {
            const gy = c.y - jj * cell;
            if (gy < -glowR || gy > glowR) continue;
            const head = jj === 0;
            const a = head ? 0.95 * c.hot : (1 - jj / c.len) * 0.42 * c.hot;
            g.fillStyle = head ? "rgba(235,255,240,0.9)" : rgba(pal.cyan, a);
            g.fillText(c.glyphs[jj], cx + c.x, cy + gy);
          }
          if (c.y - c.len * cell > glowR) rain.splice(i, 1);
        }
        g.restore();
      }

      // LUFS readout (string rebuilt only when the value moves ≥ 0.1 LU)
      if (Math.abs(f.lufs - lastLufs) >= 0.1) {
        lastLufs = f.lufs;
        lufsStr = f.lufs <= -99 ? "──·─" : f.lufs.toFixed(1);
      }
      g.textAlign = "center";
      g.fillStyle = coreText;
      g.font = `600 ${Math.max(18, unit * 0.055) | 0}px ${MONO_FONT}`;
      g.fillText(lufsStr, cx, cy - unit * 0.006);
      g.fillStyle = coreLabel;
      g.font = `9px ${MONO_FONT}`;
      g.fillText("LUFS · MOMENTARY", cx, cy + unit * 0.028);

      // ── Matrix intel: track data flashing through the core. ──
      dataTimer -= dt;
      if (dataTimer <= 0 && f.rms > 0.003) {
        dataTimer = reduced ? 0.55 : 0.16 + Math.random() * 0.2;
        dataLines[dataCursor] = makeToken(f);
        dataAge[dataCursor] = 0;
        dataCursor = (dataCursor + 1) % DATA_SLOTS;
      }
      g.font = `${Math.max(10, unit * 0.017) | 0}px ${MATRIX_FONT}`;
      for (let i = 0; i < DATA_SLOTS; i++) {
        if (dataAge[i] > 1.6) continue;
        dataAge[i] += dt;
        const a = Math.max(0, 1 - dataAge[i] / 1.6);
        // Fresh lines burn bright; old ones ghost out. Flicker via age.
        const flick = dataAge[i] < 0.1 ? 1 : 0.55 + 0.45 * Math.sin(f.now * 0.02 + i * 7);
        g.fillStyle = rgba(i === (dataCursor + DATA_SLOTS - 1) % DATA_SLOTS ? pal.plasma : pal.cyan, a * flick * 0.8);
        const yOff = (i - (DATA_SLOTS - 1) / 2) * unit * 0.026;
        g.fillText(dataLines[i], cx, cy + unit * 0.058 + yOff + unit * 0.052);
      }
    },
  };
}

// ─── 4 · WATERFALL SPECTROGRAM ──────────────────────────────────────────────
// Scrolling time–frequency map: an offscreen canvas is shifted 1 px per
// drawn frame and the freshest FFT column is painted at the right edge
// through an inferno-style palette built from the active theme.

export function createWaterfallSpectrogram(
  pal: ThemePalette,
  binCount: number,
  sampleRate: number,
): ModeRenderer {
  // Palette: ink → violet → plasma → amber → white-hot (256 RGB entries).
  const PAL_N = 256;
  const palette = new Uint8Array(PAL_N * 3);
  const stops = [
    { t: 0, c: [Math.min(10, pal.ink[0] + 2), pal.ink[1], Math.min(16, pal.ink[2] + 4)] as RGB },
    { t: 0.3, c: pal.violet },
    { t: 0.62, c: pal.plasma },
    { t: 0.85, c: pal.amber },
    { t: 1, c: [255, 250, 240] as RGB },
  ];
  for (let i = 0; i < PAL_N; i++) {
    // Perceptual-ish lift so quiet content stays visible without washing out.
    const c = sampleStops(stops, Math.pow(i / (PAL_N - 1), 0.85));
    palette[i * 3] = c[0];
    palette[i * 3 + 1] = c[1];
    palette[i * 3 + 2] = c[2];
  }

  const off = document.createElement("canvas");
  const og = off.getContext("2d")!;
  let col: ImageData | null = null;
  // Fractional row → bin mapping (bin index + frac) for bilinear sampling —
  // kills the banded "stairs" the old nearest-bin lookup produced.
  let rowBinF: Float32Array = new Float32Array(0);
  let ow = 0;
  let oh = 0;
  let frameParity = 0;

  const F_LO = 25;
  const F_HI = 18000;
  const nyq = sampleRate / 2;
  const labelCol = rgba(pal.cyan, 0.45);
  const gridCol = rgba(pal.cyan, 0.1);

  return {
    resize(W: number, H: number) {
      // 1:1 CSS-pixel backing store, capped — the self-scroll copy must stay
      // pixel-exact and cheap even on very large / hiDPI windows.
      ow = Math.max(64, Math.min(1920, Math.floor(W)));
      oh = Math.max(64, Math.min(1080, Math.floor(H)));
      off.width = ow;
      off.height = oh;
      og.fillStyle = "#04050a";
      og.fillRect(0, 0, ow, oh);
      col = og.createImageData(1, oh);
      // Row → fractional FFT bin (log scale, low frequencies at the bottom).
      rowBinF = new Float32Array(oh);
      const logLo = Math.log10(F_LO);
      const logHi = Math.log10(F_HI);
      for (let y = 0; y < oh; y++) {
        const frac = 1 - y / (oh - 1);
        const hz = Math.pow(10, logLo + frac * (logHi - logLo));
        rowBinF[y] = Math.max(1, Math.min(binCount - 2, (hz / nyq) * binCount));
      }
    },

    draw(f: RenderFrame) {
      const { g, W, H, freq, reduced } = f;
      if (!col) return;

      // Reduced motion: scroll at half rate for a calmer drift.
      frameParity ^= 1;
      const advance = !reduced || frameParity === 0;

      if (advance) {
        // shift the existing image 1 px left…
        og.drawImage(off, 1, 0, ow - 1, oh, 0, 0, ow - 1, oh);
        // …and paint the newest FFT column on the right edge, sampling the
        // spectrum bilinearly so tones render as smooth ridges, not stairs.
        const d = col.data;
        const boost = 1 + f.beat * 0.12; // hits flash the fresh column hotter
        for (let y = 0; y < oh; y++) {
          const bf = rowBinF[y];
          const b0 = bf | 0;
          const fr = bf - b0;
          let v = freq[b0] * (1 - fr) + freq[b0 + 1] * fr;
          v *= boost;
          const p = (v > 255 ? 255 : v | 0) * 3;
          const o = y * 4;
          d[o] = palette[p];
          d[o + 1] = palette[p + 1];
          d[o + 2] = palette[p + 2];
          d[o + 3] = 255;
        }
        og.putImageData(col, ow - 1, 0);
      }

      g.imageSmoothingEnabled = true;
      g.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);

      // frequency scale overlay (right edge)
      g.font = `9px ${MONO_FONT}`;
      g.textAlign = "right";
      const logLo = Math.log10(F_LO);
      const logHi = Math.log10(F_HI);
      for (let i = 0; i < SPEC_FREQ_MARKS.length; i++) {
        const fr = SPEC_FREQ_MARKS[i];
        const y = H * (1 - (Math.log10(fr) - logLo) / (logHi - logLo));
        if (y < 10 || y > H - 4) continue;
        g.strokeStyle = gridCol;
        g.beginPath();
        g.moveTo(W - 34, y);
        g.lineTo(W - 4, y);
        g.stroke();
        g.fillStyle = labelCol;
        g.fillText(fr >= 1000 ? `${fr / 1000}k` : `${fr}`, W - 38, y + 3);
      }
    },
  };
}

// ─── 5 · STRIKE FIELD ───────────────────────────────────────────────────────
// A war fought to the beat. Hostile contacts (drones, jets, tanks, comm
// towers, blimps) patrol the grid; the crosshair hunts the nearest LIVE
// contact, tracks it while it moves, locks, and the next beat on the BPM
// grid FIRES. Kicks launch arcing missiles from the corners, snares call
// cluster strikes, hats burst flak. Downed aircraft fall as burning wrecks;
// a ground skyline flashes with artillery on heavy kicks; drops unleash a
// full salvo. Fixed-size pools, zero GC churn.

export function createStrikeField(pal: ThemePalette): ModeRenderer {
  const MAX = 640;
  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const pvx = new Float32Array(MAX);
  const pvy = new Float32Array(MAX);
  const plife = new Float32Array(MAX);
  const pttl = new Float32Array(MAX);
  const pkind = new Uint8Array(MAX); // 0 spark · 1 tracer · 2 flak star
  let cursor = 0;

  const RINGS = 12;
  const rx = new Float32Array(RINGS);
  const ry = new Float32Array(RINGS);
  const rlife = new Float32Array(RINGS);
  const rttl = new Float32Array(RINGS);
  const rbig = new Uint8Array(RINGS);
  let ringCursor = 0;

  // Delayed cluster bomblets.
  const CQ = 8;
  const cqX = new Float32Array(CQ);
  const cqY = new Float32Array(CQ);
  const cqDelay = new Float32Array(CQ).fill(-1);
  const cqStr = new Float32Array(CQ);
  let cqCursor = 0;

  // Missiles — arcing munitions launched from a corner, timed so the WARHEAD
  // lands exactly on the next beat tick (launch leads the beat by the flight
  // time). Quadratic arc: origin → control → target.
  const MS = 4;
  const msX0 = new Float32Array(MS);
  const msY0 = new Float32Array(MS);
  const msCX = new Float32Array(MS);
  const msCY = new Float32Array(MS);
  const msX1 = new Float32Array(MS);
  const msY1 = new Float32Array(MS);
  const msT = new Float32Array(MS).fill(9); // 0..1 progress, ≥9 = idle
  const msDur = new Float32Array(MS).fill(1);
  const msTarget = new Int8Array(MS).fill(-1); // contact index to damage on impact
  let msCursor = 0;

  // Hostile contacts — the things being shot down.
  // kind: 0 drone · 1 jet · 2 tank · 3 comm tower · 4 blimp
  const CT = 7;
  const ctKind = new Uint8Array(CT);
  const ctX = new Float32Array(CT); // normalized
  const ctY = new Float32Array(CT);
  const ctVX = new Float32Array(CT);
  const ctHp = new Int8Array(CT);
  const ctAlive = new Uint8Array(CT);
  const ctPhase = new Float32Array(CT);
  const ctTag = new Array<string>(CT).fill("");
  const CT_NAMES = ["UAV", "FALCON", "ARMOR", "RELAY", "ZEPPELIN"];
  let ctSerial = 1;
  let spawnCooldown = 0;

  // Falling wrecks — downed aircraft burn on the way to the ground.
  const WK = 4;
  const wkX = new Float32Array(WK);
  const wkY = new Float32Array(WK);
  const wkVX = new Float32Array(WK);
  const wkVY = new Float32Array(WK);
  const wkRot = new Float32Array(WK);
  const wkLife = new Float32Array(WK).fill(0);
  let wkCursor = 0;

  const GROUND = 0.88; // normalized y of the ground line
  let horizonFlash = 0; // artillery glow on the skyline (kick-driven)
  // Deterministic skyline: heights hashed so resize doesn't reshuffle it.
  const skyH = (i: number) => 0.35 + (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.65;

  const lut = gradientLut(
    [
      { t: 0, c: pal.plasma },
      { t: 0.45, c: pal.amber },
      { t: 0.8, c: [255, 244, 224] as RGB },
      { t: 1, c: [255, 255, 255] as RGB },
    ],
    33,
    0.9,
  );
  const flakCol = rgba([235, 250, 255] as RGB, 0.95);
  const gridCol = rgba(pal.cyan, 0.06);
  const gridHot = rgba(pal.cyan, 0.16);
  const ringCol = rgba(pal.plasma, 0.5);
  const ringBigCol = rgba(pal.amber, 0.65);
  const seekCol = rgba(pal.cyan, 0.75);
  const lockCol = rgba(pal.plasma, 0.95);
  const labelCol = rgba(pal.cyan, 0.5);

  // Crosshair state machine.
  let chX = 0.5;
  let chY = 0.5; // normalized coords (survive resizes)
  let tgX = 0.5;
  let tgY = 0.5;
  let chTarget = -1; // contact index the crosshair is hunting
  let chState: 0 | 1 | 2 = 0; // 0 seek · 1 locked · 2 cooldown
  let stateT = 0;
  let kills = 0;

  let driftTimer = 0;
  let tracerTimer = 0;
  let prevMid = 0;
  let shake = 0;
  // v1.8 intel choreography: drop salvo queue + section tracking.
  let prevSection = "";
  let salvoQueue = 0;
  let salvoTimer = 0;

  function spawnParticles(
    x: number, y: number, strength: number, kind: 0 | 1 | 2, count: number, reduced: boolean,
  ): void {
    const n = reduced ? (count >> 1) : count;
    for (let i = 0; i < n; i++) {
      const k = cursor;
      cursor = (cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 340) * (0.5 + strength * 0.8) * (reduced ? 0.55 : 1);
      px[k] = x;
      py[k] = y;
      pvx[k] = Math.cos(a) * sp;
      pvy[k] = Math.sin(a) * sp - (kind === 2 ? 30 : 0);
      pttl[k] = (kind === 2 ? 0.8 : 0.5) + Math.random() * 0.9;
      plife[k] = pttl[k];
      pkind[k] = kind === 2 ? 2 : Math.random() < 0.3 ? 1 : 0;
    }
  }

  function ring(x: number, y: number, big: boolean): void {
    const r = ringCursor;
    ringCursor = (ringCursor + 1) % RINGS;
    rx[r] = x;
    ry[r] = y;
    rttl[r] = big ? 0.8 : 0.5;
    rlife[r] = rttl[r];
    rbig[r] = big ? 1 : 0;
  }

  function spawnContact(energetic: boolean): void {
    let slot = -1;
    for (let i = 0; i < CT; i++) if (!ctAlive[i]) { slot = i; break; }
    if (slot < 0) return;
    // Energetic sections favour fast movers; quiet ones favour static targets.
    const roll = Math.random();
    const kind = energetic
      ? roll < 0.35 ? 1 : roll < 0.65 ? 0 : roll < 0.85 ? 2 : 4
      : roll < 0.3 ? 0 : roll < 0.55 ? 3 : roll < 0.8 ? 2 : 4;
    ctKind[slot] = kind;
    ctPhase[slot] = Math.random() * 10;
    ctTag[slot] = `${CT_NAMES[kind]}-${(ctSerial++ % 90) + 10}`;
    ctAlive[slot] = 1;
    switch (kind) {
      case 0: // drone: hovers mid-air, jitters
        ctX[slot] = 0.15 + Math.random() * 0.7;
        ctY[slot] = 0.18 + Math.random() * 0.4;
        ctVX[slot] = (Math.random() - 0.5) * 0.03;
        ctHp[slot] = 1;
        break;
      case 1: // jet: streaks across the sky
        ctVX[slot] = (Math.random() < 0.5 ? 1 : -1) * (0.09 + Math.random() * 0.08);
        ctX[slot] = ctVX[slot] > 0 ? -0.05 : 1.05;
        ctY[slot] = 0.12 + Math.random() * 0.3;
        ctHp[slot] = 1;
        break;
      case 2: // tank: crawls along the ground
        ctVX[slot] = (Math.random() < 0.5 ? 1 : -1) * (0.008 + Math.random() * 0.008);
        ctX[slot] = ctVX[slot] > 0 ? -0.04 : 1.04;
        ctY[slot] = GROUND;
        ctHp[slot] = 2;
        break;
      case 3: // comm tower: static ground installation
        ctX[slot] = 0.1 + Math.random() * 0.8;
        ctY[slot] = GROUND;
        ctVX[slot] = 0;
        ctHp[slot] = 2;
        break;
      default: // blimp: slow drift, high altitude, soaks hits
        ctVX[slot] = (Math.random() < 0.5 ? 1 : -1) * 0.012;
        ctX[slot] = ctVX[slot] > 0 ? -0.08 : 1.08;
        ctY[slot] = 0.1 + Math.random() * 0.14;
        ctHp[slot] = 3;
        break;
    }
  }

  /** Pick the nearest live contact and start hunting it. */
  function retarget(): void {
    let best = -1;
    let bestD = 1e9;
    for (let i = 0; i < CT; i++) {
      if (!ctAlive[i]) continue;
      const d = Math.abs(ctX[i] - chX) + Math.abs(ctY[i] - chY);
      if (d < bestD) { bestD = d; best = i; }
    }
    chTarget = best;
    if (best < 0) {
      tgX = 0.14 + Math.random() * 0.72;
      tgY = 0.14 + Math.random() * 0.68;
    }
    chState = 0;
    stateT = 0;
  }

  /** Damage a contact; on kill spawn the appropriate death (wreck / boom). */
  function damageContact(idx: number, W: number, H: number, reduced: boolean): void {
    if (idx < 0 || !ctAlive[idx]) return;
    ctHp[idx]--;
    const x = ctX[idx] * W;
    const y = ctY[idx] * H;
    if (ctHp[idx] > 0) {
      // Wounded — sparks, keeps flying.
      spawnParticles(x, y, 0.5, 0, 12, reduced);
      ring(x, y, false);
      return;
    }
    ctAlive[idx] = 0;
    kills++;
    const airborne = ctKind[idx] === 0 || ctKind[idx] === 1 || ctKind[idx] === 4;
    spawnParticles(x, y, 1, 0, airborne ? 30 : 40, reduced);
    ring(x, y, true);
    if (airborne && !reduced) {
      // Falling wreck with a burning trail.
      const w = wkCursor;
      wkCursor = (wkCursor + 1) % WK;
      wkX[w] = x;
      wkY[w] = y;
      wkVX[w] = ctVX[idx] * W * 2 + (Math.random() - 0.5) * 60;
      wkVY[w] = 30;
      wkRot[w] = Math.random() * Math.PI * 2;
      wkLife[w] = 3;
    }
    if (idx === chTarget) chTarget = -1;
  }

  return {
    resize(_W: number, _H: number) {
      plife.fill(0);
      rlife.fill(0);
      msT.fill(9);
      wkLife.fill(0);
      cqDelay.fill(-1);
    },

    draw(f: RenderFrame) {
      const { g, W, H, dt, reduced } = f;

      // afterglow wash (heavier in reduced motion = shorter trails)
      g.fillStyle = reduced ? "rgba(4,5,10,0.5)" : "rgba(4,5,10,0.2)";
      g.fillRect(0, 0, W, H);

      // Screen shake from the last shell.
      shake = Math.max(0, shake - dt * 26);
      const shX = reduced ? 0 : (Math.random() - 0.5) * shake;
      const shY = reduced ? 0 : (Math.random() - 0.5) * shake;
      g.save();
      g.translate(shX, shY);

      // tactical grid, brightening on the beat envelope
      const it = f.intel;
      const spacing = 48;
      g.lineWidth = 1;
      g.strokeStyle = f.beat > 0.25 ? gridHot : gridCol;
      g.beginPath();
      for (let x = (W / 2) % spacing; x < W; x += spacing) {
        g.moveTo(x, 0);
        g.lineTo(x, H);
      }
      for (let y = (H / 2) % spacing; y < H; y += spacing) {
        g.moveTo(0, y);
        g.lineTo(W, y);
      }
      g.stroke();

      // BPM-locked bar sweep: a radar line crawls the grid once per bar and
      // slams bright on the downbeat.
      const gridLocked = it.bpm > 0 && it.bpmConf > 0.3;
      if (gridLocked) {
        const sx = it.barPhase * W;
        const sweepA = 0.1 + (it.barTick ? 0.5 : 0) + Math.max(0, 0.25 - it.beatPhase * 0.6);
        g.strokeStyle = rgba(pal.cyan, Math.min(0.6, sweepA));
        g.lineWidth = it.beatPhase < 0.1 ? 2 : 1;
        g.beginPath();
        g.moveTo(sx, 0);
        g.lineTo(sx, H);
        g.stroke();
      }

      // ── Contact management: keep the sky populated to match the music ──
      const energetic = it.section === "drop" || it.section === "buildup";
      const budget =
        it.section === "drop" ? 5 :
        it.section === "buildup" ? 4 :
        it.section === "breakdown" || it.section === "idle" ? 2 : 3;
      let aliveCount = 0;
      for (let i = 0; i < CT; i++) if (ctAlive[i]) aliveCount++;
      spawnCooldown -= dt;
      if (aliveCount < budget && spawnCooldown <= 0 && f.rms > 0.003) {
        spawnCooldown = 0.5 + Math.random() * 0.8;
        spawnContact(energetic);
      }
      // Movement per kind.
      for (let i = 0; i < CT; i++) {
        if (!ctAlive[i]) continue;
        ctPhase[i] += dt;
        ctX[i] += ctVX[i] * dt * (ctKind[i] === 1 ? (1 + f.rms) : 1);
        if (ctKind[i] === 0) {
          // drone hover jitter + slow bob
          ctY[i] += Math.sin(ctPhase[i] * 2.2) * dt * 0.015;
          ctX[i] += Math.sin(ctPhase[i] * 1.4) * dt * 0.02;
        }
        // Off-screen movers despawn quietly (never the crosshair's target mid-lock).
        if ((ctX[i] < -0.12 || ctX[i] > 1.12) && ctVX[i] !== 0) {
          ctAlive[i] = 0;
          if (chTarget === i) chTarget = -1;
        }
      }

      // ── Crosshair hunt/lock/fire cycle — hunts LIVE contacts ──
      stateT += dt;
      if (chTarget < 0 || !ctAlive[chTarget]) retarget();
      if (chTarget >= 0 && ctAlive[chTarget]) {
        // Track the moving target continuously (lock survives movement).
        tgX = ctX[chTarget];
        tgY = ctY[chTarget] - (ctKind[chTarget] === 3 ? 0.06 : 0); // aim at the mast head
      }
      const seekK = 1 - Math.exp(-dt * (reduced ? 3 : 5.5));
      if (chState === 0) {
        chX += (tgX - chX) * seekK;
        chY += (tgY - chY) * seekK;
        if (Math.abs(tgX - chX) + Math.abs(tgY - chY) < 0.02) {
          chState = 1;
          stateT = 0;
        }
        // Bored of a target that never gets a beat? Move on.
        if (stateT > 3.5) retarget();
      } else if (chState === 1) {
        // Locked: ride the target.
        chX += (tgX - chX) * seekK * 1.6;
        chY += (tgY - chY) * seekK * 1.6;
        if (stateT > 4) retarget();
      } else if (chState === 2 && stateT > 0.28) {
        retarget();
      }

      const cxp = chX * W;
      const cyp = chY * H;

      // ── DROP EVENT: entering a drop unloads a full salvo across the grid ──
      if (it.section !== prevSection) {
        if (it.section === "drop" && prevSection !== "") {
          salvoQueue = reduced ? 3 : 6;
          salvoTimer = 0;
          shake = 14;
        }
        prevSection = it.section;
      }
      if (salvoQueue > 0) {
        salvoTimer -= dt;
        if (salvoTimer <= 0) {
          salvoTimer = 0.11;
          salvoQueue--;
          const sxp = (0.12 + Math.random() * 0.76) * W;
          const syp = (0.12 + Math.random() * 0.72) * H;
          spawnParticles(sxp, syp, 0.9, 0, 30, reduced);
          ring(sxp, syp, true);
          horizonFlash = 1;
        }
      }

      // ── FIRE CONTROL ──
      // The munition (chosen by the strongest drum onset) detonates ON the
      // beat. With a confident BPM grid the missile launches EARLY, leading
      // the beat by its flight time so the warhead lands exactly on the tick;
      // without the grid, strikes fall back to the adaptive onset detector.
      const impactAt = (ix: number, iy: number, targetIdx: number) => {
        chState = 2;
        stateT = 0;
        const strength = Math.min(1, f.low * 1.4 + f.rms * 0.8 + 0.25);
        const drums = it.kick + it.snare + it.hat;
        const kickCall = drums > 0.1 ? it.kick >= it.snare && it.kick >= it.hat : f.low >= f.mid && f.low >= f.high;
        const snareCall = drums > 0.1 ? it.snare >= it.hat : f.mid >= f.high;
        if (kickCall) {
          // WARHEAD: big double ring, heavy shake, artillery on the horizon.
          spawnParticles(ix, iy, strength, 0, 34 + ((strength * 22) | 0), reduced);
          ring(ix, iy, true);
          ring(ix, iy, false);
          shake = 9 + strength * 8;
          horizonFlash = Math.max(horizonFlash, 0.8);
        } else if (snareCall) {
          // CLUSTER STRIKE: three bomblets land staggered around the target.
          for (let i = 0; i < 3; i++) {
            const q = cqCursor;
            cqCursor = (cqCursor + 1) % CQ;
            cqX[q] = ix + (Math.random() - 0.5) * 130;
            cqY[q] = iy + (Math.random() - 0.5) * 110;
            cqDelay[q] = i * 0.09;
            cqStr[q] = strength * (0.55 + Math.random() * 0.3);
          }
          shake = 5;
        } else {
          // FLAK: white starburst bursting around the target.
          spawnParticles(ix, iy - H * 0.04, strength, 2, 26, reduced);
          ring(ix, iy - H * 0.04, false);
          shake = 4;
        }
        damageContact(targetIdx, W, H, reduced);
      };

      let missileInFlight = false;
      for (let i = 0; i < MS; i++) if (msT[i] <= 1) missileInFlight = true;

      if (gridLocked && chState === 1 && !missileInFlight && it.beatPhase >= 0.68 && it.beatPhase < 0.97) {
        // Launch from the bottom corner nearest the target, arcing high.
        const period = 60 / it.bpm;
        const m = msCursor;
        msCursor = (msCursor + 1) % MS;
        msX0[m] = cxp < W / 2 ? W + 16 : -16;
        msY0[m] = H + 16;
        msX1[m] = cxp;
        msY1[m] = cyp;
        msCX[m] = (msX0[m] + cxp) / 2;
        msCY[m] = Math.min(msY0[m], cyp) - H * (0.2 + Math.random() * 0.15);
        msDur[m] = Math.max(0.09, (1 - it.beatPhase) * period);
        msT[m] = 0;
        msTarget[m] = chTarget;
      } else if (!gridLocked && f.beatHit && chState === 1) {
        // No tempo lock — instant strike on the onset.
        impactAt(cxp, cyp, chTarget);
      }

      // Missiles in flight: advance along the arc, draw exhaust, detonate at
      // t = 1 — which lands on the beat tick by construction.
      for (let i = 0; i < MS; i++) {
        if (msT[i] > 1) continue;
        msT[i] += dt / msDur[i];
        const t = Math.min(1, msT[i]);
        const omt = 1 - t;
        const mx = omt * omt * msX0[i] + 2 * omt * t * msCX[i] + t * t * msX1[i];
        const my = omt * omt * msY0[i] + 2 * omt * t * msCY[i] + t * t * msY1[i];
        const tt = Math.max(0, t - 0.1);
        const omtt = 1 - tt;
        const tx = omtt * omtt * msX0[i] + 2 * omtt * tt * msCX[i] + tt * tt * msX1[i];
        const ty = omtt * omtt * msY0[i] + 2 * omtt * tt * msCY[i] + tt * tt * msY1[i];
        g.strokeStyle = ringBigCol;
        g.globalAlpha = 0.85;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(mx, my);
        g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = flakCol;
        g.fillRect(mx - 1.5, my - 1.5, 3, 3);
        if (!reduced && Math.random() < dt * 40) {
          const k = cursor;
          cursor = (cursor + 1) % MAX;
          px[k] = mx;
          py[k] = my;
          pvx[k] = (Math.random() - 0.5) * 30;
          pvy[k] = (Math.random() - 0.5) * 30 + 20;
          pttl[k] = 0.35;
          plife[k] = pttl[k];
          pkind[k] = 0;
        }
        if (msT[i] >= 1) {
          msT[i] = 9;
          impactAt(msX1[i], msY1[i], msTarget[i]);
        }
      }

      // Delayed cluster bomblets going off.
      for (let i = 0; i < CQ; i++) {
        if (cqDelay[i] < 0) continue;
        cqDelay[i] -= dt;
        if (cqDelay[i] <= 0) {
          cqDelay[i] = -1;
          spawnParticles(cqX[i], cqY[i], cqStr[i], 0, 18, reduced);
          ring(cqX[i], cqY[i], false);
        }
      }

      // Small-arms chatter on mid onsets (fires even mid-seek — the war
      // doesn't wait for the crosshair).
      const midOnset = f.mid - prevMid;
      prevMid += (f.mid - prevMid) * (1 - Math.exp(-dt * 10));
      if (midOnset > 0.13 && f.mid > 0.2) {
        spawnParticles(
          cxp + (Math.random() - 0.5) * 200,
          cyp + (Math.random() - 0.5) * 160,
          0.35, 0, 7, reduced,
        );
      }

      // Sustained highs: tracer stream from the top corner toward the target.
      tracerTimer -= dt;
      if (f.high > 0.32 && tracerTimer <= 0 && !reduced) {
        tracerTimer = 0.045;
        const srcX = f.now % 2000 < 1000 ? -10 : W + 10;
        const srcY = -10;
        const dx = cxp - srcX;
        const dy = cyp - srcY;
        const len = Math.hypot(dx, dy) || 1;
        const sp = 900 + f.high * 600;
        const k = cursor;
        cursor = (cursor + 1) % MAX;
        px[k] = srcX;
        py[k] = srcY;
        pvx[k] = (dx / len) * sp + (Math.random() - 0.5) * 90;
        pvy[k] = (dy / len) * sp + (Math.random() - 0.5) * 90;
        pttl[k] = len / sp;
        plife[k] = pttl[k];
        pkind[k] = 1;
      }

      // quiet-time drift sparks so the field never reads as dead
      driftTimer -= dt;
      if (driftTimer <= 0 && f.rms > 0.004) {
        driftTimer = reduced ? 0.9 : 0.45;
        const k = cursor;
        cursor = (cursor + 1) % MAX;
        px[k] = Math.random() * W;
        py[k] = Math.random() * H;
        const a = Math.random() * Math.PI * 2;
        pvx[k] = Math.cos(a) * 14;
        pvy[k] = Math.sin(a) * 14;
        pttl[k] = 1.6;
        plife[k] = pttl[k];
        pkind[k] = 0;
      }

      // ── Ground skyline: dark silhouette strip with artillery flashes ──
      const gy = GROUND * H;
      horizonFlash = Math.max(0, horizonFlash - dt * 2.2);
      if (horizonFlash > 0.01 && !reduced) {
        const hf = g.createLinearGradient(0, gy - H * 0.16, 0, gy);
        hf.addColorStop(0, "rgba(4,5,10,0)");
        hf.addColorStop(1, rgba(pal.amber, horizonFlash * 0.28));
        g.fillStyle = hf;
        g.fillRect(0, gy - H * 0.16, W, H * 0.16);
      }
      g.fillStyle = "rgba(2,3,6,0.92)";
      g.fillRect(0, gy, W, H - gy);
      // Buildings (deterministic heights — stable across frames/resizes).
      g.fillStyle = "rgba(8,10,16,0.95)";
      const bw = Math.max(26, W / 30);
      for (let i = 0; i * bw < W; i++) {
        const bh = skyH(i) * H * 0.055;
        g.fillRect(i * bw, gy - bh, bw - 3, bh);
      }
      g.strokeStyle = rgba(pal.cyan, 0.2);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, gy);
      g.lineTo(W, gy);
      g.stroke();

      // ── Searchlights sweeping from the ground (brighten with the highs) ──
      if (!reduced && f.rms > 0.01) {
        for (let s = 0; s < 2; s++) {
          const baseX = s === 0 ? W * 0.16 : W * 0.84;
          const a = -Math.PI / 2 + Math.sin(f.now * 0.00023 + s * 2.4) * 0.55;
          const bx = baseX + Math.cos(a) * H * 0.9;
          const by = gy + Math.sin(a) * H * 0.9;
          const sl = g.createLinearGradient(baseX, gy, bx, by);
          sl.addColorStop(0, rgba(pal.cyan, 0.1 + f.high * 0.14));
          sl.addColorStop(1, "rgba(4,5,10,0)");
          g.strokeStyle = sl;
          g.lineWidth = 14;
          g.beginPath();
          g.moveTo(baseX, gy);
          g.lineTo(bx, by);
          g.stroke();
        }
      }

      // ── Hostile contacts: silhouettes with designation tags ──
      g.font = `8px ${MONO_FONT}`;
      g.textAlign = "center";
      const czUnit = Math.min(W, H);
      for (let i = 0; i < CT; i++) {
        if (!ctAlive[i]) continue;
        const x = ctX[i] * W;
        const y = ctY[i] * H;
        const s = Math.max(9, czUnit * 0.016); // half-size of the silhouette
        const hostile = rgba(pal.plasma, 0.85);
        const hurt = ctHp[i] === 1 && (ctKind[i] === 2 || ctKind[i] === 3 || ctKind[i] === 4);
        g.strokeStyle = hurt ? rgba(pal.amber, 0.9) : hostile;
        g.lineWidth = 1.4;
        g.beginPath();
        switch (ctKind[i]) {
          case 0: { // drone: X-frame quad with rotor tips
            g.moveTo(x - s, y - s); g.lineTo(x + s, y + s);
            g.moveTo(x + s, y - s); g.lineTo(x - s, y + s);
            g.stroke();
            g.beginPath();
            g.arc(x - s, y - s, s * 0.34, 0, Math.PI * 2);
            g.arc(x + s, y - s, s * 0.34, 0, Math.PI * 2);
            g.stroke();
            break;
          }
          case 1: { // jet: delta wing pointing along velocity
            const dir = ctVX[i] >= 0 ? 1 : -1;
            g.moveTo(x + dir * s * 1.5, y);
            g.lineTo(x - dir * s, y - s * 0.7);
            g.lineTo(x - dir * s * 0.5, y);
            g.lineTo(x - dir * s, y + s * 0.7);
            g.closePath();
            g.stroke();
            // vapor trail
            g.strokeStyle = rgba(pal.cyan, 0.18);
            g.beginPath();
            g.moveTo(x - dir * s * 1.6, y);
            g.lineTo(x - dir * s * 5, y);
            g.stroke();
            break;
          }
          case 2: { // tank: hull + turret + barrel, sits on the ground line
            const ty2 = gy - s * 0.5;
            g.rect(x - s, ty2 - s * 0.5, s * 2, s * 0.55);
            g.rect(x - s * 0.4, ty2 - s * 0.95, s * 0.8, s * 0.45);
            g.moveTo(x + s * 0.4, ty2 - s * 0.75);
            g.lineTo(x + s * 1.6 * (ctVX[i] >= 0 ? 1 : -1), ty2 - s * 0.85);
            g.stroke();
            break;
          }
          case 3: { // comm tower: mast + dish, blinking beacon
            g.moveTo(x - s * 0.7, gy);
            g.lineTo(x, gy - s * 2.4);
            g.lineTo(x + s * 0.7, gy);
            g.moveTo(x - s * 0.45, gy - s * 0.9);
            g.lineTo(x + s * 0.45, gy - s * 0.9);
            g.stroke();
            if ((f.now * 0.002 + i) % 2 < 1) {
              g.fillStyle = rgba(pal.plasma, 0.95);
              g.fillRect(x - 1.5, gy - s * 2.4 - 3, 3, 3);
            }
            break;
          }
          default: { // blimp: fat ellipse + tail fins + gondola
            g.ellipse(x, y, s * 1.7, s * 0.75, 0, 0, Math.PI * 2);
            g.stroke();
            g.beginPath();
            const dir = ctVX[i] >= 0 ? -1 : 1;
            g.moveTo(x + dir * s * 1.6, y - s * 0.6);
            g.lineTo(x + dir * s * 2.3, y);
            g.lineTo(x + dir * s * 1.6, y + s * 0.6);
            g.stroke();
            g.strokeRect(x - s * 0.3, y + s * 0.75, s * 0.6, s * 0.35);
            break;
          }
        }
        // Designation tag under the contact (the crosshair's mark runs hot).
        g.fillStyle = i === chTarget ? rgba(pal.amber, 0.85) : rgba(pal.cyan, 0.4);
        g.fillText(ctTag[i], x, (ctKind[i] === 2 || ctKind[i] === 3 ? gy : y + s * 1.6) + 12);
      }

      // ── Falling wrecks: burning debris tumbling to the ground ──
      for (let i = 0; i < WK; i++) {
        if (wkLife[i] <= 0) continue;
        wkLife[i] -= dt;
        wkVY[i] += 340 * dt; // gravity
        wkX[i] += wkVX[i] * dt;
        wkY[i] += wkVY[i] * dt;
        wkRot[i] += dt * 4;
        if (wkY[i] >= gy) {
          // Ground impact — final burst.
          spawnParticles(wkX[i], gy, 0.7, 0, 20, reduced);
          ring(wkX[i], gy, false);
          horizonFlash = Math.max(horizonFlash, 0.5);
          wkLife[i] = 0;
          continue;
        }
        const ws = 5;
        g.save();
        g.translate(wkX[i], wkY[i]);
        g.rotate(wkRot[i]);
        g.strokeStyle = rgba(pal.amber, 0.9);
        g.lineWidth = 1.6;
        g.strokeRect(-ws, -ws * 0.4, ws * 2, ws * 0.8);
        g.restore();
        // burning trail
        if (!reduced && Math.random() < dt * 30) {
          const k = cursor;
          cursor = (cursor + 1) % MAX;
          px[k] = wkX[i];
          py[k] = wkY[i];
          pvx[k] = (Math.random() - 0.5) * 40;
          pvy[k] = -20 - Math.random() * 40;
          pttl[k] = 0.5;
          plife[k] = pttl[k];
          pkind[k] = 0;
        }
      }

      // expanding shock rings (shells get a fat double-walled ring)
      for (let i = 0; i < RINGS; i++) {
        if (rlife[i] <= 0) continue;
        rlife[i] -= dt;
        const t = 1 - Math.max(0, rlife[i]) / rttl[i];
        const rad = 6 + t * (rbig[i] ? 200 : 110);
        g.globalAlpha = (1 - t) * (rbig[i] ? 0.75 : 0.55);
        g.strokeStyle = rbig[i] ? ringBigCol : ringCol;
        g.lineWidth = rbig[i] ? 2.5 : 1.5;
        g.beginPath();
        g.arc(rx[i], ry[i], rad, 0, Math.PI * 2);
        g.stroke();
        if (rbig[i]) {
          g.globalAlpha *= 0.5;
          g.beginPath();
          g.arc(rx[i], ry[i], rad * 0.7, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.globalAlpha = 1;

      // particles
      const drag = Math.exp(-dt * 1.9);
      for (let i = 0; i < MAX; i++) {
        if (plife[i] <= 0) continue;
        plife[i] -= dt;
        if (plife[i] <= 0) continue;
        pvx[i] *= drag;
        pvy[i] *= drag;
        px[i] += pvx[i] * dt;
        py[i] += pvy[i] * dt;
        const lifeFrac = plife[i] / pttl[i];
        if (pkind[i] === 0) {
          const s = 1 + lifeFrac * 2;
          g.fillStyle = lut[Math.min(32, (lifeFrac * 32) | 0)];
          g.globalAlpha = 0.25 + lifeFrac * 0.75;
          g.fillRect(px[i] - s * 0.5, py[i] - s * 0.5, s, s);
        } else if (pkind[i] === 1) {
          g.strokeStyle = lut[Math.min(32, (lifeFrac * 32) | 0)];
          g.globalAlpha = 0.2 + lifeFrac * 0.7;
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(px[i], py[i]);
          g.lineTo(px[i] - pvx[i] * 0.045, py[i] - pvy[i] * 0.045);
          g.stroke();
        } else {
          // flak star: a small white cross that twinkles out
          const s = 1.5 + lifeFrac * 3;
          g.strokeStyle = flakCol;
          g.globalAlpha = lifeFrac;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px[i] - s, py[i]);
          g.lineTo(px[i] + s, py[i]);
          g.moveTo(px[i], py[i] - s);
          g.lineTo(px[i], py[i] + s);
          g.stroke();
        }
      }
      g.globalAlpha = 1;

      // ── Crosshair on top ──
      const locked = chState === 1;
      const col = locked ? lockCol : seekCol;
      const rr = Math.min(W, H) * (locked ? 0.032 : 0.046) + f.beat * 4;
      g.strokeStyle = col;
      g.lineWidth = locked ? 2 : 1.4;
      g.beginPath();
      g.arc(cxp, cyp, rr, 0, Math.PI * 2);
      g.stroke();
      // rotating quarter-arcs while seeking; solid brackets when locked
      if (!locked) {
        const spin = f.now * 0.004;
        g.beginPath();
        g.arc(cxp, cyp, rr + 7, spin, spin + Math.PI * 0.4);
        g.stroke();
        g.beginPath();
        g.arc(cxp, cyp, rr + 7, spin + Math.PI, spin + Math.PI * 1.4);
        g.stroke();
      } else {
        g.beginPath();
        g.moveTo(cxp - rr - 9, cyp);
        g.lineTo(cxp - rr - 2, cyp);
        g.moveTo(cxp + rr + 2, cyp);
        g.lineTo(cxp + rr + 9, cyp);
        g.moveTo(cxp, cyp - rr - 9);
        g.lineTo(cxp, cyp - rr - 2);
        g.moveTo(cxp, cyp + rr + 2);
        g.lineTo(cxp, cyp + rr + 9);
        g.stroke();
      }
      g.fillStyle = col;
      g.fillRect(cxp - 1, cyp - 1, 2, 2);

      g.restore();

      // HUD line (drawn unshaken).
      g.font = `9px ${MONO_FONT}`;
      g.textAlign = "left";
      g.fillStyle = labelCol;
      const tgTag = chTarget >= 0 && ctAlive[chTarget] ? ` ${ctTag[chTarget]}` : "";
      g.fillText(
        locked
          ? `LOCK${tgTag} — BIRD AWAY ON BEAT`
          : chState === 2
            ? "SPLASH — TARGET DOWN"
            : `ACQUIRING${tgTag}…`,
        8, 14,
      );
      g.textAlign = "right";
      const tempoTag = gridLocked ? ` · ${it.bpm.toFixed(0)} BPM GRID` : "";
      g.fillText(`KILLS ${kills} · ${it.section.toUpperCase()}${tempoTag}`, W - 8, 14);
    },
  };
}

// ─── 6 · WARP TUNNEL ────────────────────────────────────────────────────────
// Fly through a kaleidoscopic starfield: warp speed rides the music's
// energy, the whole field ROTATES (faster when the music brightens), a
// spiral twist bends star paths near the core, colours cycle continuously,
// and hard beats slam a warp overdrive + shock rings down the tunnel.

export function createWarpTunnel(pal: ThemePalette): ModeRenderer {
  const N = 640;
  const ang = new Float32Array(N);
  const rad = new Float32Array(N); // 0..1.3 normalized tunnel radius
  const spd = new Float32Array(N);
  const band = new Uint8Array(N); // 0 low, 1 mid, 2 high
  const RINGS = 8;
  const ringAge = new Float32Array(RINGS).fill(99);
  let ringCursor = 0;

  // Wider LUTs so the hue cycler has room to travel.
  const bandCols = [
    gradientLut(
      [{ t: 0, c: pal.amber }, { t: 0.5, c: pal.plasma }, { t: 1, c: pal.violet }],
      33, 0.95,
    ),
    gradientLut(
      [{ t: 0, c: pal.violet }, { t: 0.5, c: pal.plasma }, { t: 1, c: pal.cyan }],
      33, 0.95,
    ),
    gradientLut(
      [{ t: 0, c: pal.cyan }, { t: 0.5, c: [235, 250, 255] as RGB }, { t: 1, c: pal.lime }],
      33, 0.95,
    ),
  ];
  const ringCol = rgba(pal.cyan, 0.5);
  const coreCol = rgba(pal.cyan, 0.16);

  let rot = 0;      // global field rotation
  let hue = 0;      // colour cycle phase 0..1
  let boost = 0;    // warp overdrive (beat slam, decays)
  // v1.8: stereo camera + section segmentation state.
  let camX = 0;
  let camY = 0;
  let camPhase = 0;
  let prevSection = "";
  let sectionFlash = 0;
  let seeded = false;

  // v2.2 variation: wireframe ring GATES fly past on each bar, tumbling
  // DEBRIS drifts through the field, and entering a drop fires a short
  // HYPERJUMP (warp overload + streak stretch + white-out).
  const GATES = 6;
  const gateT = new Float32Array(GATES).fill(9); // 0..1 depth progress
  const gateRot = new Float32Array(GATES);
  const gateSides = new Uint8Array(GATES);
  let gateCursor = 0;
  let prevBarTick = false;
  const DEBRIS = 8;
  const dbAng = new Float32Array(DEBRIS);
  const dbRad = new Float32Array(DEBRIS);
  const dbSpin = new Float32Array(DEBRIS);
  const dbSides = new Uint8Array(DEBRIS);
  let dbSeeded = false;
  let jump = 0;
  const seed = () => {
    for (let i = 0; i < N; i++) {
      ang[i] = Math.random() * Math.PI * 2;
      rad[i] = Math.pow(Math.random(), 1.5) * 1.1 + 0.02;
      spd[i] = 0.55 + Math.random() * 0.9;
      band[i] = (i % 3) as 0 | 1 | 2;
    }
    seeded = true;
  };

  return {
    resize(_W: number, _H: number) {
      if (!seeded) seed();
    },

    draw(f: RenderFrame) {
      const { g, W, H, dt, reduced } = f;
      // Afterglow wash → light streaks with zero history buffers.
      g.fillStyle = reduced ? "rgba(4,5,10,0.5)" : "rgba(4,5,10,0.26)";
      g.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const unit = Math.min(W, H);
      const maxR = Math.hypot(W, H) * 0.55;

      // Kaleidoscope motion: rotation follows brightness, hue never rests,
      // and a hard beat slams the throttle open for a moment. When the BPM
      // clock is confident the slams land exactly on the grid.
      const it = f.intel;
      const gridLocked = it.bpm > 0 && it.bpmConf > 0.3;
      const beatSlam = gridLocked ? it.beatTick : f.beatHit;
      if (beatSlam) boost = Math.min(1.6, boost + 0.55 + f.low * 0.6);
      boost = Math.max(0, boost - dt * 1.7);
      if (!reduced) {
        rot += dt * (0.06 + f.centroid * 0.5 + f.beat * 0.35);
        hue = (hue + dt * (0.05 + f.high * 0.25)) % 1;
      }

      // Section segmentation: chorus/drop entries snap the hue a quarter turn
      // and flash the whole field; breakdowns cool the throttle. A drop
      // additionally punches a HYPERJUMP — a moment of overloaded warp.
      if (it.section !== prevSection) {
        if (prevSection !== "" && (it.section === "drop" || it.section === "buildup")) {
          hue = (hue + 0.25) % 1;
          sectionFlash = 1;
          boost = Math.min(2, boost + 0.8);
          if (it.section === "drop" && !reduced) jump = 1;
        }
        prevSection = it.section;
      }
      sectionFlash = Math.max(0, sectionFlash - dt * 1.6);
      jump = Math.max(0, jump - dt * 1.4);
      const sectionDrag = it.section === "breakdown" ? 0.55 : 1;

      // Bar gates: a wireframe ring spawns deep in the tunnel on each bar
      // and flies past the camera (sides vary so no two gates look alike).
      if (gridLocked && it.barTick && !prevBarTick && !reduced) {
        gateT[gateCursor] = 0.02;
        gateRot[gateCursor] = Math.random() * Math.PI;
        gateSides[gateCursor] = 5 + ((Math.random() * 4) | 0);
        gateCursor = (gateCursor + 1) % GATES;
      }
      prevBarTick = it.barTick;

      // Stereo camera: width swings the eye off-axis, phase-correlation
      // wobble adds drift. Near stars sweep harder than far ones (true depth
      // parallax below).
      camPhase += dt * (0.35 + it.width * 0.9);
      const spread = unit * (0.02 + it.width * 0.13) * (reduced ? 0.4 : 1);
      const camTX = Math.sin(camPhase) * spread;
      const camTY = Math.cos(camPhase * 0.73) * spread * 0.6;
      const camK = 1 - Math.exp(-dt * 2.2);
      camX += (camTX - camX) * camK;
      camY += (camTY - camY) * camK;

      const twistK = Math.sin(f.now * 0.00013) * (1.4 + it.width * 0.8);
      const warp =
        (0.16 + f.rms * 2.4 + f.beat * 1.5 + boost) * (reduced ? 0.45 : 1) * sectionDrag *
        (1 + jump * 3.2);
      const bandLvl = [f.low, f.mid, f.high];
      const hueShift = (hue * 16) | 0;

      for (let i = 0; i < N; i++) {
        const r0 = rad[i];
        const r1 = r0 * (1 + warp * spd[i] * dt * (0.35 + r0 * 1.6));
        rad[i] = r1;
        if (r1 > 1.25) {
          ang[i] = Math.random() * Math.PI * 2;
          rad[i] = 0.02 + Math.random() * 0.08;
          spd[i] = 0.55 + Math.random() * 0.9;
          continue;
        }
        const lvl = bandLvl[band[i]];
        const bright = 0.12 + lvl * 1.5;
        if (bright < 0.16) continue;
        // Spiral twist: stars near the core lead/lag the field rotation.
        // Depth parallax: the camera offset fades with distance (small r =
        // deep in the tunnel barely moves; close stars sweep with the eye).
        const a0 = ang[i] + rot + twistK * (1 - r0);
        const a1 = ang[i] + rot + twistK * (1 - r1);
        const px0 = cx + camX * r0;
        const py0 = cy + camY * r0;
        const px1 = cx + camX * r1;
        const py1 = cy + camY * r1;
        const x0 = px0 + Math.cos(a0) * r0 * maxR;
        const y0 = py0 + Math.sin(a0) * r0 * maxR;
        const x1 = px1 + Math.cos(a1) * r1 * maxR;
        const y1 = py1 + Math.sin(a1) * r1 * maxR;
        const lut = bandCols[band[i]];
        g.strokeStyle = lut[Math.min(32, ((Math.min(1, bright) * 16) | 0) + hueShift)];
        g.globalAlpha = Math.min(1, (0.1 + r1) * bright);
        g.lineWidth = 0.8 + r1 * 2.4;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Kaleidoscope spokes: six faint mirror seams rotating with the field.
      if (!reduced && f.rms > 0.01) {
        g.strokeStyle = rgba(pal.cyan, 0.05 + f.beat * 0.1);
        g.lineWidth = 1;
        g.beginPath();
        for (let s = 0; s < 6; s++) {
          const a = rot * 0.5 + (s / 6) * Math.PI * 2;
          g.moveTo(cx + Math.cos(a) * unit * 0.1, cy + Math.sin(a) * unit * 0.1);
          g.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        }
        g.stroke();
      }

      // ── Bar gates: wireframe polygon rings racing up the tunnel ──
      for (let i = 0; i < GATES; i++) {
        if (gateT[i] > 1.2) continue;
        gateT[i] += dt * (0.35 + warp * 0.22);
        const t = gateT[i];
        const rr = Math.pow(t, 2.2) * maxR * 1.15;
        if (rr < 3) continue;
        const alpha = Math.min(1, t * 4) * Math.max(0, 1.2 - t) * 0.55;
        const sides = gateSides[i];
        const ga = gateRot[i] + rot * 0.4;
        g.strokeStyle = rgba(pal.plasma, alpha);
        g.lineWidth = 1.2 + t * 3;
        g.beginPath();
        for (let v = 0; v <= sides; v++) {
          const a = ga + (v / sides) * Math.PI * 2;
          const x = cx + camX * t + Math.cos(a) * rr;
          const y = cy + camY * t + Math.sin(a) * rr;
          if (v === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        // Vertex beacons.
        g.fillStyle = rgba(pal.cyan, alpha * 1.3);
        for (let v = 0; v < sides; v++) {
          const a = ga + (v / sides) * Math.PI * 2;
          const x = cx + camX * t + Math.cos(a) * rr;
          const y = cy + camY * t + Math.sin(a) * rr;
          g.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }

      // ── Tumbling debris: sparse wireframe rocks drifting past ──
      if (!reduced) {
        if (!dbSeeded) {
          for (let i = 0; i < DEBRIS; i++) {
            dbAng[i] = Math.random() * Math.PI * 2;
            dbRad[i] = 0.15 + Math.random() * 0.9;
            dbSpin[i] = (Math.random() - 0.5) * 3;
            dbSides[i] = 3 + ((Math.random() * 3) | 0);
          }
          dbSeeded = true;
        }
        for (let i = 0; i < DEBRIS; i++) {
          dbRad[i] *= 1 + warp * 0.5 * dt * (0.3 + dbRad[i]);
          if (dbRad[i] > 1.25) {
            dbAng[i] = Math.random() * Math.PI * 2;
            dbRad[i] = 0.05 + Math.random() * 0.15;
            dbSpin[i] = (Math.random() - 0.5) * 3;
            dbSides[i] = 3 + ((Math.random() * 3) | 0);
          }
          const r = dbRad[i];
          if (r < 0.12) continue;
          const a = dbAng[i] + rot + twistK * (1 - r);
          const x = cx + camX * r + Math.cos(a) * r * maxR;
          const y = cy + camY * r + Math.sin(a) * r * maxR;
          const size = 2 + r * unit * 0.02;
          const spin = f.now * 0.001 * dbSpin[i];
          g.strokeStyle = rgba(pal.amber, Math.min(0.7, r * 0.9));
          g.lineWidth = 1.1;
          g.beginPath();
          for (let v = 0; v <= dbSides[i]; v++) {
            const va = spin + (v / dbSides[i]) * Math.PI * 2;
            const vx = x + Math.cos(va) * size;
            const vy = y + Math.sin(va) * size;
            if (v === 0) g.moveTo(vx, vy);
            else g.lineTo(vx, vy);
          }
          g.stroke();
        }
      }

      // Hyperjump white-out: a bloom that swallows the tunnel for a beat.
      if (jump > 0.01) {
        const j = jump * jump;
        const jg = g.createRadialGradient(cx + camX, cy + camY, 0, cx + camX, cy + camY, maxR);
        jg.addColorStop(0, `rgba(235,245,255,${j * 0.55})`);
        jg.addColorStop(0.4, rgba(pal.cyan, j * 0.25));
        jg.addColorStop(1, "rgba(4,5,10,0)");
        g.fillStyle = jg;
        g.fillRect(0, 0, W, H);
      }

      // Beat shock rings racing outward down the tunnel (grid-locked when
      // the BPM clock is confident, so they land dead on the beat).
      if (beatSlam) {
        ringAge[ringCursor] = 0;
        ringCursor = (ringCursor + 1) % RINGS;
      }
      g.strokeStyle = ringCol;
      for (let i = 0; i < RINGS; i++) {
        if (ringAge[i] > 1.1) continue;
        ringAge[i] += dt * (1.1 + warp * 0.5);
        const t = ringAge[i];
        const rr = Math.pow(t, 1.7) * maxR;
        if (rr < 2) continue;
        g.globalAlpha = Math.max(0, 1 - t) * 0.7;
        g.lineWidth = 1 + t * 6;
        g.beginPath();
        g.arc(cx + camX * t, cy + camY * t, rr, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Section-entry flash: the whole tunnel mouth ignites for a moment.
      if (sectionFlash > 0.01) {
        g.fillStyle = rgba(pal.plasma, sectionFlash * sectionFlash * 0.12);
        g.fillRect(0, 0, W, H);
      }

      // Breathing core (rides the camera so the vanishing point tracks it).
      const coreR = unit * (0.035 + f.low * 0.05 + f.beat * 0.02);
      const grad = g.createRadialGradient(cx + camX, cy + camY, 0, cx + camX, cy + camY, coreR * 3);
      grad.addColorStop(0, rgba(pal.cyan, 0.5 + f.beat * 0.4));
      grad.addColorStop(0.4, coreCol);
      grad.addColorStop(1, "rgba(4,5,10,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx + camX, cy + camY, coreR * 3, 0, Math.PI * 2);
      g.fill();
    },
  };
}

// ─── 7 · PULSE LATTICE ──────────────────────────────────────────────────────
// A field of nodes: every column is a frequency band (bass left → air right),
// node brightness/size track that band live, and every beat drops a
// shockwave that ripples the whole lattice outward from the strike point.

export function createPulseLattice(
  pal: ThemePalette,
  binCount: number,
  sampleRate: number,
): ModeRenderer {
  const MAX_COLS = 48;
  const MAX_ROWS = 28;
  const ranges = new Uint16Array(MAX_COLS * 2);
  const colLvl = new Float32Array(MAX_COLS);
  // Per-node level + y-offset kept for the constellation pass.
  const nodeLvl = new Float32Array(MAX_COLS * MAX_ROWS);
  const nodeOff = new Float32Array(MAX_COLS * MAX_ROWS);
  const WAVES = 8;
  const wx = new Float32Array(WAVES);
  const wy = new Float32Array(WAVES);
  const wage = new Float32Array(WAVES).fill(99);
  const wamp = new Float32Array(WAVES);
  let wCursor = 0;

  const lut = gradientLut(
    [
      { t: 0, c: pal.violet },
      { t: 0.45, c: pal.cyan },
      { t: 0.75, c: pal.plasma },
      { t: 1, c: [255, 245, 230] as RGB },
    ],
    49,
    0.95,
  );

  let cols = 32;
  let rows = 18;
  let spacing = 42;

  return {
    resize(W: number, H: number) {
      spacing = Math.max(34, Math.min(56, W / 34));
      cols = Math.max(16, Math.min(MAX_COLS, Math.floor(W / spacing)));
      rows = Math.max(10, Math.min(MAX_ROWS, Math.floor(H / spacing)));
      logBinRanges(ranges, cols, binCount, sampleRate, 35, 16000);
      colLvl.fill(0);
      wage.fill(99);
    },

    draw(f: RenderFrame) {
      const { g, W, H, freq, dt, reduced } = f;
      g.fillStyle = "#04050a";
      g.fillRect(0, 0, W, H);

      const ox = (W - (cols - 1) * spacing) / 2;
      const oy = (H - (rows - 1) * spacing) / 2;

      // Per-column band levels (attack fast, release slow). A gentle tilt
      // compensates music's natural bass dominance so the right half of the
      // lattice lives too.
      const riseK = 1 - Math.exp(-dt * 40);
      const fallK = 1 - Math.exp(-dt * 7);
      for (let c = 0; c < cols; c++) {
        const tilt = 0.6 + 0.55 * (c / (cols - 1));
        const raw = Math.min(1, Math.pow(bandPeak(freq, ranges[c * 2], ranges[c * 2 + 1]), 1.3) * tilt);
        const prev = colLvl[c];
        colLvl[c] = raw > prev ? prev + (raw - prev) * riseK : prev + (raw - prev) * fallK;
      }

      // Beat → spawn a shockwave at the loudest column, mid-height-ish.
      if (f.beatHit) {
        let best = 0;
        for (let c = 1; c < cols; c++) if (colLvl[c] > colLvl[best]) best = c;
        wx[wCursor] = ox + best * spacing;
        wy[wCursor] = oy + (0.25 + Math.random() * 0.5) * (rows - 1) * spacing;
        wage[wCursor] = 0;
        wamp[wCursor] = 0.6 + f.low * 0.9;
        wCursor = (wCursor + 1) % WAVES;
      }
      const waveSpeed = (reduced ? 240 : 380) + f.rms * 260;
      for (let i = 0; i < WAVES; i++) {
        if (wage[i] < 3) wage[i] += dt;
      }

      // Nodes. The beat pushes the whole lattice hotter up the LUT, and the
      // per-node level is remembered for the constellation pass below.
      const beatLift = (f.beat * 7) | 0;
      for (let r = 0; r < rows; r++) {
        const ny = oy + r * spacing;
        for (let c = 0; c < cols; c++) {
          const nx = ox + c * spacing;
          // Sum wave displacement at this node.
          let dz = 0;
          for (let i = 0; i < WAVES; i++) {
            const age = wage[i];
            if (age > 2.2) continue;
            const dist = Math.hypot(nx - wx[i], ny - wy[i]);
            const front = age * waveSpeed;
            const dd = (dist - front) / (spacing * 1.4);
            dz += Math.exp(-dd * dd) * wamp[i] * Math.max(0, 1 - age * 0.55);
          }
          const lvl = Math.min(1, colLvl[c] * 1.25 + dz * 0.8);
          const yOff = -dz * spacing * 0.45;
          nodeLvl[r * MAX_COLS + c] = lvl;
          nodeOff[r * MAX_COLS + c] = yOff;
          if (lvl < 0.03) {
            g.fillStyle = "rgba(120,160,200,0.07)";
            g.fillRect(nx - 0.75, ny - 0.75, 1.5, 1.5);
            continue;
          }
          const size = 1.2 + lvl * 5 + dz * 5;
          g.fillStyle = lut[Math.min(48, ((lvl * 48) | 0) + beatLift)];
          g.globalAlpha = 0.25 + lvl * 0.75;
          g.beginPath();
          g.arc(nx, ny + yOff, size, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;

      // Constellation pass: bright neighbours link up — loud music wires the
      // whole grid together, quiet music lets it fall apart.
      const TH = 0.42;
      g.lineWidth = 1;
      g.strokeStyle = rgba(pal.cyan, 0.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = nodeLvl[r * MAX_COLS + c];
          if (a < TH) continue;
          const b = nodeLvl[r * MAX_COLS + c + 1];
          const dn = r + 1 < rows ? nodeLvl[(r + 1) * MAX_COLS + c] : 0;
          const nx = ox + c * spacing;
          const ny = oy + r * spacing;
          if (b >= TH) {
            g.globalAlpha = (Math.min(a, b) - TH) * 1.3;
            g.beginPath();
            g.moveTo(nx, ny + nodeOff[r * MAX_COLS + c]);
            g.lineTo(nx + spacing, ny + nodeOff[r * MAX_COLS + c + 1]);
            g.stroke();
          }
          if (dn >= TH) {
            g.globalAlpha = (Math.min(a, dn) - TH) * 1.3;
            g.beginPath();
            g.moveTo(nx, ny + nodeOff[r * MAX_COLS + c]);
            g.lineTo(nx, ny + spacing + nodeOff[(r + 1) * MAX_COLS + c]);
            g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
    },
  };
}

// ─── 8 · AURORA FLOW ────────────────────────────────────────────────────────
// Bass, low-mids, presence and air as four flowing ribbons of light. Each
// ribbon's amplitude, speed and glow ride its own band; the whole sky drifts
// hue with the spectral centroid (dark music = deep violet, bright = ice).

export function createAuroraFlow(pal: ThemePalette): ModeRenderer {
  const POINTS = 56;
  const RIBBONS = 4;
  const phase = new Float32Array(RIBBONS);
  const smooth = new Float32Array(RIBBONS);
  // v1.8 inertia: each ribbon's energy is a damped spring, not a lowpass —
  // beats KICK it and it overshoots + settles like a physical curtain.
  const vel = new Float32Array(RIBBONS);
  const xs = new Float32Array(POINTS);
  const ys = new Float32Array(POINTS);

  // Beat pillars: vertical curtains of light that ignite on hits.
  const PILLARS = 6;
  const plX = new Float32Array(PILLARS);
  const plAge = new Float32Array(PILLARS).fill(9);
  const plHue = new Uint8Array(PILLARS);
  let plCursor = 0;

  const ribbonCols: RGB[] = [pal.plasma, pal.amber, pal.violet, pal.cyan];

  return {
    resize(W: number, _H: number) {
      for (let i = 0; i < POINTS; i++) xs[i] = (i / (POINTS - 1)) * W;
    },

    draw(f: RenderFrame) {
      const { g, W, H, dt, reduced } = f;
      if (xs[POINTS - 1] !== W) {
        for (let i = 0; i < POINTS; i++) xs[i] = (i / (POINTS - 1)) * W;
      }

      // Night-sky wash, hue-shifted by the centroid.
      const bgGrad = g.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, `rgba(${6 + f.centroid * 6},${5 + f.centroid * 10},${14 + f.centroid * 14},1)`);
      bgGrad.addColorStop(1, "rgba(3,4,8,1)");
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, W, H);

      // Beat → a light pillar ignites somewhere along the sky and washes out.
      // BPM-locked when the shared clock is confident, so pillars land in
      // strict time; kick onsets fire them too for extra punch.
      const it = f.intel;
      const gridLocked = it.bpm > 0 && it.bpmConf > 0.3;
      const beatNow = gridLocked ? it.beatTick : f.beatHit;
      if ((beatNow || it.kickHit) && !reduced) {
        plX[plCursor] = W * (0.08 + Math.random() * 0.84);
        plAge[plCursor] = 0;
        plHue[plCursor] = (Math.random() * RIBBONS) | 0;
        plCursor = (plCursor + 1) % PILLARS;
      }
      for (let i = 0; i < PILLARS; i++) {
        if (plAge[i] > 1.2) continue;
        plAge[i] += dt;
        const a = Math.max(0, 1 - plAge[i] / 1.2);
        const wPil = 30 + (1 - a) * 70;
        const c = ribbonCols[plHue[i]];
        const pil = g.createLinearGradient(plX[i] - wPil, 0, plX[i] + wPil, 0);
        pil.addColorStop(0, rgba(c, 0));
        pil.addColorStop(0.5, rgba(c, a * a * 0.2));
        pil.addColorStop(1, rgba(c, 0));
        g.fillStyle = pil;
        g.fillRect(plX[i] - wPil, 0, wPil * 2, H);
      }

      const bands = [f.low, f.mid * 0.9 + f.low * 0.1, f.mid, f.high];
      // reflection floor: ribbons mirror into still water below this line
      const floorY = H * 0.94;

      for (let rb = 0; rb < RIBBONS; rb++) {
        const lvl = Math.min(1, bands[rb] * 1.9);
        // damped spring (inertia): beats kick the velocity, mass settles
        const springK = reduced ? 30 : 55;
        const dampK = reduced ? 8 : 6.5;
        vel[rb] += (lvl - smooth[rb]) * springK * dt;
        if (beatNow) vel[rb] += 0.9 + f.low * 1.2;
        vel[rb] *= Math.exp(-dt * dampK);
        smooth[rb] = Math.max(0, Math.min(1.4, smooth[rb] + vel[rb] * dt));
        const energy = smooth[rb];
        // Lows drift slow and huge; airs flicker fast and tight.
        phase[rb] += dt * (0.25 + rb * 0.35 + energy * (1.6 + rb * 0.7) + f.beat * 1.1);

        const baseline = H * (0.78 - rb * 0.17);
        const amp =
          H * (0.045 + energy * (0.2 - rb * 0.015) + f.beat * 0.02) * (reduced ? 0.6 : 1);
        const k1 = 2.2 + rb * 1.3;
        const k2 = 5.1 + rb * 2.2;

        for (let i = 0; i < POINTS; i++) {
          const t = i / (POINTS - 1);
          ys[i] =
            baseline -
            Math.sin(phase[rb] + t * Math.PI * k1) * amp -
            Math.sin(phase[rb] * 1.7 + t * Math.PI * k2 + rb) * amp * 0.45 -
            energy * H * 0.05;
        }

        const c = ribbonCols[rb];
        // Fill down to the floor (soft veil)…
        const veil = g.createLinearGradient(0, baseline - amp * 2, 0, H);
        veil.addColorStop(0, rgba(c, 0.1 + energy * 0.22));
        veil.addColorStop(1, rgba(c, 0));
        g.fillStyle = veil;
        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        for (let i = 1; i < POINTS; i++) g.lineTo(xs[i], ys[i]);
        g.lineTo(W, H);
        g.lineTo(0, H);
        g.closePath();
        g.fill();
        // …and the bright crest line.
        g.strokeStyle = rgba(c, 0.35 + energy * 0.6);
        g.lineWidth = 1.4 + energy * 2.4;
        if (!reduced) {
          g.shadowColor = rgba(c, 0.9);
          g.shadowBlur = 10 + energy * 18;
        }
        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        for (let i = 1; i < POINTS; i++) g.lineTo(xs[i], ys[i]);
        g.stroke();
        g.shadowBlur = 0;

        // still-water reflection: the crest mirrored under the floor line,
        // dimmer and squashed — reads as a lake under the aurora.
        if (!reduced) {
          g.strokeStyle = rgba(c, (0.1 + energy * 0.2) * 0.8);
          g.lineWidth = 1 + energy * 1.6;
          g.beginPath();
          g.moveTo(xs[0], floorY + (floorY - ys[0]) * 0.22);
          for (let i = 1; i < POINTS; i++) {
            g.lineTo(xs[i], floorY + (floorY - ys[i]) * 0.22);
          }
          g.stroke();
        }
      }

      // Star dust twinkling with the high band (deterministic positions).
      const stars = 40;
      g.fillStyle = rgba(pal.cyan, 0.5);
      for (let i = 0; i < stars; i++) {
        const sx = ((i * 733) % 997) / 997 * W;
        const sy = ((i * 389) % 613) / 613 * H * 0.45;
        const tw = 0.5 + 0.5 * Math.sin(f.now * 0.001 * (1 + (i % 7)) + i);
        g.globalAlpha = tw * (0.12 + f.high * 0.75);
        g.fillRect(sx, sy, 1.6, 1.6);
      }
      g.globalAlpha = 1;
    },
  };
}
