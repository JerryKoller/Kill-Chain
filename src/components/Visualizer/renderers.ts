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

  function makeToken(f: RenderFrame): string {
    const pick = (Math.random() * 7) | 0;
    switch (pick) {
      case 0: {
        // A shard of the actual title, uppercased — the track bleeding through.
        const t = f.title.replace(/\s+/g, " ").trim().toUpperCase();
        if (t.length < 3) return `SIG ${HEX[(Math.random() * 16) | 0]}${HEX[(Math.random() * 16) | 0]}`;
        const len = 6 + ((Math.random() * 8) | 0);
        const at = (Math.random() * Math.max(1, t.length - len)) | 0;
        return t.slice(at, at + len);
      }
      case 1: return `LOW ${((f.low * 100) | 0).toString().padStart(2, "0")}%`;
      case 2: return `MID ${((f.mid * 100) | 0).toString().padStart(2, "0")}%`;
      case 3: return `AIR ${((f.high * 100) | 0).toString().padStart(2, "0")}%`;
      case 4: return f.lufs <= -99 ? "SIG LOST" : `${f.lufs.toFixed(1)} LU`;
      case 5: return `CTR ${(220 + f.centroid * 7800 | 0)}Hz`;
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
      g.font = `${Math.max(9, unit * 0.016) | 0}px ${MONO_FONT}`;
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
// A musical warzone. The crosshair HUNTS: it picks a target, races to it,
// locks, and the next beat FIRES — the munition depends on what the music
// did (bass = artillery shell + screen shake, mids = cluster strike, highs =
// flak burst). Sustained highs stream tracer fire from the screen corner;
// mid onsets crackle small-arms bursts around the target. Fixed-size pools,
// zero GC churn.

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

  // Muzzle streaks (artillery trails from the corner to the target).
  const MZ = 3;
  const mzX0 = new Float32Array(MZ);
  const mzY0 = new Float32Array(MZ);
  const mzX1 = new Float32Array(MZ);
  const mzY1 = new Float32Array(MZ);
  const mzAge = new Float32Array(MZ).fill(9);
  let mzCursor = 0;

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
  let chState: 0 | 1 | 2 = 0; // 0 seek · 1 locked · 2 cooldown
  let stateT = 0;
  let kills = 0;

  let driftTimer = 0;
  let tracerTimer = 0;
  let prevMid = 0;
  let shake = 0;

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

  function retarget(): void {
    tgX = 0.14 + Math.random() * 0.72;
    tgY = 0.14 + Math.random() * 0.68;
    chState = 0;
    stateT = 0;
  }

  return {
    resize(_W: number, _H: number) {
      plife.fill(0);
      rlife.fill(0);
      mzAge.fill(9);
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

      // ── Crosshair hunt/lock/fire cycle ──
      stateT += dt;
      const seekK = 1 - Math.exp(-dt * (reduced ? 3 : 5.5));
      if (chState === 0) {
        chX += (tgX - chX) * seekK;
        chY += (tgY - chY) * seekK;
        if (Math.abs(tgX - chX) + Math.abs(tgY - chY) < 0.012) {
          chState = 1;
          stateT = 0;
        }
        // Bored of a target that never gets a beat? Move on.
        if (stateT > 3.5) retarget();
      } else if (chState === 1 && stateT > 4) {
        retarget();
      } else if (chState === 2 && stateT > 0.28) {
        retarget();
      }

      const cxp = chX * W;
      const cyp = chY * H;

      // FIRE on the beat while locked.
      if (f.beatHit && chState === 1) {
        chState = 2;
        stateT = 0;
        kills++;
        const strength = Math.min(1, f.low * 1.4 + f.rms * 0.8 + 0.25);
        // Which munition? The loudest band decides.
        if (f.low >= f.mid && f.low >= f.high) {
          // ARTILLERY SHELL: muzzle streak from the nearest corner, big
          // double ring, heavy shake.
          const corner = cxp < W / 2 ? W : 0;
          const m = mzCursor;
          mzCursor = (mzCursor + 1) % MZ;
          mzX0[m] = corner;
          mzY0[m] = H + 20;
          mzX1[m] = cxp;
          mzY1[m] = cyp;
          mzAge[m] = 0;
          spawnParticles(cxp, cyp, strength, 0, 34 + ((strength * 22) | 0), reduced);
          ring(cxp, cyp, true);
          ring(cxp, cyp, false);
          shake = 9 + strength * 8;
        } else if (f.mid >= f.high) {
          // CLUSTER STRIKE: three bomblets land staggered around the target.
          for (let i = 0; i < 3; i++) {
            const q = cqCursor;
            cqCursor = (cqCursor + 1) % CQ;
            cqX[q] = cxp + (Math.random() - 0.5) * 130;
            cqY[q] = cyp + (Math.random() - 0.5) * 110;
            cqDelay[q] = i * 0.09;
            cqStr[q] = strength * (0.55 + Math.random() * 0.3);
          }
          shake = 5;
        } else {
          // FLAK: white starburst high above the target.
          spawnParticles(cxp, cyp - H * 0.12, strength, 2, 26, reduced);
          ring(cxp, cyp - H * 0.12, false);
          shake = 4;
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

      // Muzzle streaks.
      for (let i = 0; i < MZ; i++) {
        if (mzAge[i] > 0.16) continue;
        mzAge[i] += dt;
        const a = Math.max(0, 1 - mzAge[i] / 0.16);
        g.strokeStyle = ringBigCol;
        g.globalAlpha = a * 0.8;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(mzX0[i], mzY0[i]);
        g.lineTo(mzX1[i], mzY1[i]);
        g.stroke();
      }
      g.globalAlpha = 1;

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
      g.fillText(
        locked ? "TARGET LOCKED — AWAITING BEAT" : chState === 2 ? "IMPACT CONFIRMED" : "ACQUIRING…",
        8, 14,
      );
      g.textAlign = "right";
      g.fillText(`STRIKES ${kills}`, W - 8, 14);
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
  let seeded = false;
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
      // and a hard beat slams the throttle open for a moment.
      if (f.beatHit) boost = Math.min(1.6, boost + 0.55 + f.low * 0.6);
      boost = Math.max(0, boost - dt * 1.7);
      if (!reduced) {
        rot += dt * (0.06 + f.centroid * 0.5 + f.beat * 0.35);
        hue = (hue + dt * (0.05 + f.high * 0.25)) % 1;
      }
      const twistK = Math.sin(f.now * 0.00013) * 1.4; // slow breathing spiral
      const warp = (0.16 + f.rms * 2.4 + f.beat * 1.5 + boost) * (reduced ? 0.45 : 1);
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
        const a0 = ang[i] + rot + twistK * (1 - r0);
        const a1 = ang[i] + rot + twistK * (1 - r1);
        const x0 = cx + Math.cos(a0) * r0 * maxR;
        const y0 = cy + Math.sin(a0) * r0 * maxR;
        const x1 = cx + Math.cos(a1) * r1 * maxR;
        const y1 = cy + Math.sin(a1) * r1 * maxR;
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

      // Beat shock rings racing outward down the tunnel.
      if (f.beatHit) {
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
        g.arc(cx, cy, rr, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Breathing core.
      const coreR = unit * (0.035 + f.low * 0.05 + f.beat * 0.02);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
      grad.addColorStop(0, rgba(pal.cyan, 0.5 + f.beat * 0.4));
      grad.addColorStop(0.4, coreCol);
      grad.addColorStop(1, "rgba(4,5,10,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
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
      if (f.beatHit && !reduced) {
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
      const smoothK = 1 - Math.exp(-dt * 8);

      for (let rb = 0; rb < RIBBONS; rb++) {
        const lvl = Math.min(1, bands[rb] * 1.9);
        smooth[rb] += (lvl - smooth[rb]) * smoothK;
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
