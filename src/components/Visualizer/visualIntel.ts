/**
 * Visual Intelligence — THE shared analysis layer for every visualizer mode.
 *
 * One instance runs in the main window (the only high-rate analysis pipeline
 * in the app). It owns:
 *   - byte FFT + time-domain pulls from the shared post-chain analyser (the
 *     same arrays every renderer reads — zero extra analyser cost for them);
 *   - a dedicated FLOAT analyser (fft 4096, low smoothing) for transient and
 *     high-frequency detail the byte tap smooths away;
 *   - a stereo L/R split (small analysers) for width + phase correlation;
 *   - band-specific onset detection (kick / snare / hats / vocal presence);
 *   - a BPM estimator (onset autocorrelation) + beat/bar phase tracker;
 *   - an energy-section state machine (intro / verse / buildup / drop /
 *     breakdown);
 *   - a per-track palette derived from dominant bands + spectral centroid,
 *     optionally seeded from album art.
 *
 * The broadcast window NEVER runs this: the main window serializes the
 * per-frame IntelSnapshot into the IPC frame payload, so exactly one
 * pipeline exists no matter how many surfaces are drawing.
 *
 * Hot-path contract: update() allocates nothing; all buffers are created in
 * start(). Multiple consumers (overlay RAF + broadcast interval) may call
 * update() in the same frame — a timestamp guard makes the second call free.
 */

import { getEngine } from "@/audio/AudioEngine";
import { useAudioStore } from "@/state/audioStore";
import { usePlayerStore } from "@/state/playerStore";
import type { RGB } from "./renderers";

export type SectionId = "idle" | "intro" | "verse" | "buildup" | "drop" | "breakdown";

/** Everything a renderer can know about the music this frame. */
export interface IntelSnapshot {
  // ── level / spectrum summary (compatible with the legacy frame fields) ──
  rms: number;
  low: number;
  mid: number;
  high: number;
  centroid: number;
  /** Legacy adaptive beat: true on the detection frame / decaying envelope. */
  beatHit: boolean;
  beat: number;
  // ── tempo ──
  /** Smoothed tempo estimate, 0 when unknown. */
  bpm: number;
  /** 0..1 confidence in the BPM estimate. */
  bpmConf: number;
  /** 0..1 position inside the current beat (0 = on the beat). */
  beatPhase: number;
  /** 0..1 position inside the current 4-beat bar. */
  barPhase: number;
  /** True only on the frame the tracker crossed a beat boundary. */
  beatTick: boolean;
  /** True only on the frame the tracker crossed a bar boundary. */
  barTick: boolean;
  // ── band onsets (0..1 strengths; decay fast) ──
  kick: number;
  snare: number;
  hat: number;
  /** 0..1 sustained vocal-range presence (200 Hz – 4 kHz dominance). */
  vocal: number;
  /** True only on the frame a kick onset fired. */
  kickHit: boolean;
  snareHit: boolean;
  hatHit: boolean;
  // ── stereo ──
  /** 0 (mono) .. 1 (very wide) side/mid energy. */
  width: number;
  /** -1..1 L/R phase correlation (+1 mono, 0 decorrelated, -1 anti-phase). */
  phaseCorr: number;
  // ── structure ──
  section: SectionId;
  /** Seconds spent in the current section. */
  sectionAge: number;
  /** 0..1 slow overall energy (drives director + scene intensity). */
  energy: number;
  /** 1 on the frame Kill Chain engages/disengages, exponential decay. */
  engagePulse: number;
  // ── palette ──
  /** Primary / secondary / glow accents derived from track + album art. */
  colA: RGB;
  colB: RGB;
  colC: RGB;
}

/** Fields serialized over IPC to the broadcast window (plain data only). */
export interface IntelWire {
  rms: number; low: number; mid: number; high: number; centroid: number;
  beatHit: boolean; beat: number;
  bpm: number; bpmConf: number; beatPhase: number; barPhase: number;
  beatTick: boolean; barTick: boolean;
  kick: number; snare: number; hat: number; vocal: number;
  kickHit: boolean; snareHit: boolean; hatHit: boolean;
  width: number; phaseCorr: number;
  section: SectionId; sectionAge: number; energy: number;
  engagePulse: number;
  colA: RGB; colB: RGB; colC: RGB;
}

export function defaultSnapshot(): IntelSnapshot {
  return {
    rms: 0, low: 0, mid: 0, high: 0, centroid: 0, beatHit: false, beat: 0,
    bpm: 0, bpmConf: 0, beatPhase: 0, barPhase: 0, beatTick: false, barTick: false,
    kick: 0, snare: 0, hat: 0, vocal: 0, kickHit: false, snareHit: false, hatHit: false,
    width: 0, phaseCorr: 1,
    section: "idle", sectionAge: 0, energy: 0, engagePulse: 0,
    colA: [84, 180, 214], colB: [255, 64, 64], colC: [122, 92, 255],
  };
}

/** Copy every snapshot field into a wire object (used for the IPC payload). */
export function snapshotToWire(s: IntelSnapshot, out: IntelWire): IntelWire {
  out.rms = s.rms; out.low = s.low; out.mid = s.mid; out.high = s.high;
  out.centroid = s.centroid; out.beatHit = s.beatHit; out.beat = s.beat;
  out.bpm = s.bpm; out.bpmConf = s.bpmConf; out.beatPhase = s.beatPhase;
  out.barPhase = s.barPhase; out.beatTick = s.beatTick; out.barTick = s.barTick;
  out.kick = s.kick; out.snare = s.snare; out.hat = s.hat; out.vocal = s.vocal;
  out.kickHit = s.kickHit; out.snareHit = s.snareHit; out.hatHit = s.hatHit;
  out.width = s.width; out.phaseCorr = s.phaseCorr;
  out.section = s.section; out.sectionAge = s.sectionAge; out.energy = s.energy;
  out.engagePulse = s.engagePulse;
  out.colA = s.colA; out.colB = s.colB; out.colC = s.colC;
  return out;
}

/** Apply a received wire object onto a snapshot (broadcast-window side). */
export function wireToSnapshot(w: IntelWire, out: IntelSnapshot): void {
  out.rms = w.rms; out.low = w.low; out.mid = w.mid; out.high = w.high;
  out.centroid = w.centroid; out.beatHit = w.beatHit; out.beat = w.beat;
  out.bpm = w.bpm; out.bpmConf = w.bpmConf; out.beatPhase = w.beatPhase;
  out.barPhase = w.barPhase; out.beatTick = w.beatTick; out.barTick = w.barTick;
  out.kick = w.kick; out.snare = w.snare; out.hat = w.hat; out.vocal = w.vocal;
  out.kickHit = w.kickHit; out.snareHit = w.snareHit; out.hatHit = w.hatHit;
  out.width = w.width; out.phaseCorr = w.phaseCorr;
  out.section = w.section; out.sectionAge = w.sectionAge; out.energy = w.energy;
  out.engagePulse = w.engagePulse;
  if (Array.isArray(w.colA)) out.colA = w.colA;
  if (Array.isArray(w.colB)) out.colB = w.colB;
  if (Array.isArray(w.colC)) out.colC = w.colC;
}

// ── onset-envelope ring for the BPM estimator ──
const ONSET_HZ = 100; // resample grid
const ONSET_LEN = 1024; // ≈ 10.2 s of history
const BPM_MIN = 68;
const BPM_MAX = 182;

/** One frequency band's flux-onset detector (adaptive threshold). */
class BandOnset {
  private avg = 0;
  private cooldown = 0;
  env = 0;
  hit = false;
  constructor(
    private readonly thresholdK: number,
    private readonly cooldownS: number,
    private readonly decayRate: number,
  ) {}
  update(flux: number, dt: number): void {
    const adaptK = 1 - Math.exp(-dt / 1.3);
    this.avg += (flux - this.avg) * adaptK;
    this.cooldown -= dt;
    this.hit = false;
    if (this.cooldown <= 0 && flux > this.avg * this.thresholdK + 0.012) {
      this.hit = true;
      this.env = Math.min(1, 0.4 + flux * 3);
      this.cooldown = this.cooldownS;
    }
    this.env *= Math.exp(-dt * this.decayRate);
  }
}

export class VisualIntel {
  readonly snapshot: IntelSnapshot = defaultSnapshot();

  // Shared byte arrays every renderer reads (owned here, filled by update()).
  freq!: Uint8Array<ArrayBuffer>;
  time!: Uint8Array<ArrayBuffer>;
  binCount = 0;
  sampleRate = 48000;
  /** Float spectrum (dB) from the detail analyser — for future/HD consumers. */
  freqFloat!: Float32Array<ArrayBuffer>;
  floatBinCount = 0;

  private started = 0; // ref count
  private lastUpdateAt = -1;

  // audio nodes (created in start, released in stop)
  private detail: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private anL: AnalyserNode | null = null;
  private anR: AnalyserNode | null = null;
  private timeL!: Float32Array<ArrayBuffer>;
  private timeR!: Float32Array<ArrayBuffer>;
  private prevFloat!: Float32Array<ArrayBuffer>;
  private prevFreq!: Uint8Array<ArrayBuffer>;

  // band bin ranges on the detail analyser
  private kickB0 = 0; private kickB1 = 0;
  private snareB0 = 0; private snareB1 = 0;
  private snareC0 = 0; private snareC1 = 0;
  private hatB0 = 0; private hatB1 = 0;
  private vocB0 = 0; private vocB1 = 0;
  // legacy band ranges on the byte analyser
  private lowBins = 0;
  private fluxBins = 0;
  private midLoBin = 0; private midHiBin = 0;
  private highLoBin = 0;

  private readonly kickDet = new BandOnset(1.9, 0.16, 7);
  private readonly snareDet = new BandOnset(2.1, 0.14, 8);
  private readonly hatDet = new BandOnset(2.0, 0.06, 12);

  // legacy beat detector (kept bit-compatible with the old overlay feel)
  private lowAvg = 0;
  private fluxAvg = 0;
  private beatEnv = 0;
  private beatCooldown = 0;

  // BPM / phase tracking
  private readonly onsetRing = new Float32Array(ONSET_LEN);
  private ringPos = 0;
  private ringTime = 0; // seconds accumulated into the current slot
  private bpmRecalcIn = 1.2;
  private period = 0; // seconds per beat (0 = unknown)
  private lastBeatAt = 0; // in intel-clock seconds
  private clock = 0;
  private beatIndex = 0;
  private readonly beatSlotKick = new Float32Array(4); // downbeat voting
  private downbeatShift = 0;
  private offGridKicks = 0; // consecutive kicks landing off the phase grid

  // sections
  private energyFast = 0;
  private energySlow = 0;
  private onsetDensity = 0;
  private kickPresence = 0;
  private sectionT = 0;

  // engage pulse
  private unsubEngage: (() => void) | null = null;
  private prevBypass: boolean | null = null;

  // palette
  private paletteHue = 0.55;
  private coverUrl: string | null = null;
  private coverCols: [RGB, RGB] | null = null;
  private coverToken = 0;

  /** Ref-counted start: connects taps on first consumer. */
  start(): void {
    this.started++;
    if (this.started > 1) return;
    const engine = getEngine();
    const ctx = engine.ctx;
    this.sampleRate = ctx.sampleRate;

    const post = engine.analyserPost;
    this.binCount = post.frequencyBinCount;
    this.freq = new Uint8Array(this.binCount) as Uint8Array<ArrayBuffer>;
    this.time = new Uint8Array(post.fftSize) as Uint8Array<ArrayBuffer>;
    this.prevFreq = new Uint8Array(this.binCount) as Uint8Array<ArrayBuffer>;

    // detail analyser: bigger window, minimal smoothing → transients + highs
    this.detail = ctx.createAnalyser();
    this.detail.fftSize = 4096;
    this.detail.smoothingTimeConstant = 0.25;
    engine.destinationTap.connect(this.detail);
    this.floatBinCount = this.detail.frequencyBinCount;
    this.freqFloat = new Float32Array(this.floatBinCount) as Float32Array<ArrayBuffer>;
    this.prevFloat = new Float32Array(this.floatBinCount) as Float32Array<ArrayBuffer>;
    this.prevFloat.fill(-120);

    // stereo split for width / phase correlation
    this.splitter = ctx.createChannelSplitter(2);
    this.anL = ctx.createAnalyser();
    this.anR = ctx.createAnalyser();
    this.anL.fftSize = 1024;
    this.anR.fftSize = 1024;
    engine.destinationTap.connect(this.splitter);
    this.splitter.connect(this.anL, 0);
    this.splitter.connect(this.anR, 1);
    this.timeL = new Float32Array(1024) as Float32Array<ArrayBuffer>;
    this.timeR = new Float32Array(1024) as Float32Array<ArrayBuffer>;

    // band ranges (detail analyser resolution)
    const nyq = this.sampleRate / 2;
    const fb = (hz: number) => Math.max(1, Math.min(this.floatBinCount - 1, Math.round((hz / nyq) * this.floatBinCount)));
    this.kickB0 = fb(30); this.kickB1 = fb(120);
    this.snareB0 = fb(150); this.snareB1 = fb(450);
    this.snareC0 = fb(1500); this.snareC1 = fb(4000);
    this.hatB0 = fb(6000); this.hatB1 = fb(Math.min(15000, nyq - 200));
    this.vocB0 = fb(200); this.vocB1 = fb(4000);

    // legacy ranges (byte analyser resolution) — identical to the old code
    const bb = this.binCount;
    this.lowBins = Math.max(4, Math.round((180 / nyq) * bb));
    this.fluxBins = Math.max(this.lowBins, Math.round((400 / nyq) * bb));
    this.midLoBin = Math.max(this.lowBins + 1, Math.round((400 / nyq) * bb));
    this.midHiBin = Math.min(bb - 1, Math.round((2500 / nyq) * bb));
    this.highLoBin = Math.min(bb - 2, Math.round((4000 / nyq) * bb));

    // engage pulse: fire whenever the Kill Chain bypass flips either way
    this.prevBypass = useAudioStore.getState().bypass;
    this.unsubEngage = useAudioStore.subscribe((s) => {
      if (this.prevBypass !== null && s.bypass !== this.prevBypass) {
        this.snapshot.engagePulse = 1;
      }
      this.prevBypass = s.bypass;
    });

    this.lastUpdateAt = -1;
  }

  stop(): void {
    this.started = Math.max(0, this.started - 1);
    if (this.started > 0) return;
    const engine = getEngine();
    try { if (this.detail) engine.destinationTap.disconnect(this.detail); } catch { /* already gone */ }
    try { if (this.splitter) engine.destinationTap.disconnect(this.splitter); } catch { /* already gone */ }
    this.detail = null;
    this.splitter = null;
    this.anL = null;
    this.anR = null;
    this.unsubEngage?.();
    this.unsubEngage = null;
  }

  get running(): boolean { return this.started > 0; }

  /**
   * Analyse one frame. `now` is performance.now() ms. Safe to call from
   * multiple consumers per frame — repeat calls within 8 ms are no-ops.
   */
  update(now: number): void {
    if (!this.detail || !this.anL || !this.anR) return;
    if (this.lastUpdateAt >= 0 && now - this.lastUpdateAt < 8) return;
    const dt = Math.min(0.05, this.lastUpdateAt < 0 ? 0.0167 : (now - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = now;
    this.clock += dt;
    const s = this.snapshot;
    const engine = getEngine();

    // ── raw pulls ──
    engine.analyserPost.getByteFrequencyData(this.freq);
    engine.analyserPost.getByteTimeDomainData(this.time);
    this.detail.getFloatFrequencyData(this.freqFloat);
    this.anL.getFloatTimeDomainData(this.timeL);
    this.anR.getFloatTimeDomainData(this.timeR);

    // Silent bins come back as -Infinity dB, which would poison every flux
    // average with NaN — clamp the float spectrum to a finite floor first.
    {
      const ffc = this.freqFloat;
      for (let i = 0; i < ffc.length; i++) {
        const v = ffc[i];
        if (!(v > -140)) ffc[i] = -140; // catches -Inf and NaN
      }
    }

    // ── legacy summary features (byte tap — identical math to v1.5) ──
    const freq = this.freq;
    const time = this.time;
    const binCount = this.binCount;
    let sumSq = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      sumSq += v * v;
    }
    s.rms = Math.sqrt(sumSq / time.length);

    let lowSum = 0;
    for (let i = 1; i <= this.lowBins; i++) lowSum += freq[i];
    const low = lowSum / (this.lowBins * 255);
    s.low = low;
    let fluxSum = 0;
    for (let i = 1; i <= this.fluxBins; i++) {
      const d = freq[i] - this.prevFreq[i];
      if (d > 0) fluxSum += d;
    }
    this.prevFreq.set(freq);
    const flux = fluxSum / (this.fluxBins * 255);

    let midSum = 0;
    for (let i = this.midLoBin; i <= this.midHiBin; i++) midSum += freq[i];
    s.mid = midSum / (Math.max(1, this.midHiBin - this.midLoBin + 1) * 255);
    let highSum = 0;
    for (let i = this.highLoBin; i < binCount; i++) highSum += freq[i];
    s.high = highSum / (Math.max(1, binCount - this.highLoBin) * 255);
    let centNum = 0;
    let centDen = 0;
    for (let i = 1; i < binCount; i += 2) {
      const v = freq[i];
      centNum += v * i;
      centDen += v;
    }
    s.centroid = centDen > 0 ? Math.min(1, (centNum / centDen / binCount) * 3.2) : 0;

    const adaptK = 1 - Math.exp(-dt / 1.4);
    this.lowAvg += (low - this.lowAvg) * adaptK;
    this.fluxAvg += (flux - this.fluxAvg) * adaptK;
    this.beatCooldown -= dt;
    s.beatHit = false;
    if (
      this.beatCooldown <= 0 &&
      low > 0.05 &&
      (flux > this.fluxAvg * 1.9 + 0.01 || low > this.lowAvg * 1.35 + 0.03)
    ) {
      s.beatHit = true;
      this.beatEnv = 1;
      this.beatCooldown = 0.13;
    }
    this.beatEnv *= Math.exp(-dt * 5.5);
    s.beat = this.beatEnv;

    // ── band onsets from the FLOAT detail spectrum ──
    // Convert dB to linear-ish 0..1 per band, flux = positive dB delta sum.
    const ff = this.freqFloat;
    const pf = this.prevFloat;
    let kickFlux = 0;
    for (let i = this.kickB0; i <= this.kickB1; i++) {
      const d = ff[i] - pf[i];
      if (d > 0) kickFlux += d;
    }
    kickFlux /= (this.kickB1 - this.kickB0 + 1) * 12;
    let snFlux = 0;
    for (let i = this.snareB0; i <= this.snareB1; i++) {
      const d = ff[i] - pf[i];
      if (d > 0) snFlux += d;
    }
    for (let i = this.snareC0; i <= this.snareC1; i++) {
      const d = ff[i] - pf[i];
      if (d > 0) snFlux += d * 0.6;
    }
    snFlux /= (this.snareB1 - this.snareB0 + this.snareC1 - this.snareC0 + 2) * 10;
    let hatFlux = 0;
    for (let i = this.hatB0; i <= this.hatB1; i++) {
      const d = ff[i] - pf[i];
      if (d > 0) hatFlux += d;
    }
    hatFlux /= (this.hatB1 - this.hatB0 + 1) * 9;
    // vocal presence: energy ratio of the vocal band vs whole spectrum
    let vocE = 0;
    let allE = 0;
    for (let i = 1; i < this.floatBinCount; i += 2) {
      const lin = Math.pow(10, ff[i] / 20); // dB → amplitude
      allE += lin;
      if (i >= this.vocB0 && i <= this.vocB1) vocE += lin;
    }
    pf.set(ff);
    const vocRatio = allE > 1e-7 ? vocE / allE : 0;

    this.kickDet.update(kickFlux, dt);
    this.snareDet.update(snFlux, dt);
    this.hatDet.update(hatFlux, dt);
    s.kick = this.kickDet.env;
    s.snare = this.snareDet.env;
    s.hat = this.hatDet.env;
    s.kickHit = this.kickDet.hit;
    s.snareHit = this.snareDet.hit;
    s.hatHit = this.hatDet.hit;
    const vocalK = 1 - Math.exp(-dt / 0.6);
    s.vocal += (Math.min(1, Math.max(0, (vocRatio - 0.35) * 2.2)) - s.vocal) * vocalK;

    // ── stereo width + phase correlation ──
    const L = this.timeL;
    const R = this.timeR;
    let sumL = 0, sumR = 0, sumLR = 0, sumM = 0, sumS = 0;
    for (let i = 0; i < L.length; i++) {
      const l = L[i], r = R[i];
      sumL += l * l;
      sumR += r * r;
      sumLR += l * r;
      const m = (l + r) * 0.5;
      const sd = (l - r) * 0.5;
      sumM += m * m;
      sumS += sd * sd;
    }
    const denom = Math.sqrt(sumL * sumR);
    const corr = denom > 1e-9 ? sumLR / denom : 1;
    const widthRaw = sumM > 1e-9 ? Math.min(1, Math.sqrt(sumS / sumM) * 1.6) : 0;
    const stK = 1 - Math.exp(-dt / 0.25);
    s.phaseCorr += (Math.max(-1, Math.min(1, corr)) - s.phaseCorr) * stK;
    s.width += (widthRaw - s.width) * stK;

    // ── BPM ring (resampled onset strength) ──
    const onsetStrength = kickFlux * 1.4 + snFlux * 0.8 + flux * 0.6;
    this.ringTime += dt;
    const slotDur = 1 / ONSET_HZ;
    while (this.ringTime >= slotDur) {
      this.ringTime -= slotDur;
      this.ringPos = (this.ringPos + 1) % ONSET_LEN;
      this.onsetRing[this.ringPos] = 0;
    }
    if (onsetStrength > this.onsetRing[this.ringPos]) this.onsetRing[this.ringPos] = onsetStrength;

    this.bpmRecalcIn -= dt;
    if (this.bpmRecalcIn <= 0) {
      this.bpmRecalcIn = 2;
      this.estimateBpm();
    }

    // ── beat phase tracking (simple PLL on kick/snare onsets) ──
    s.beatTick = false;
    s.barTick = false;
    if (this.period > 0) {
      // strong onsets near the predicted beat pull the phase
      if ((s.kickHit || s.snareHit) && s.bpmConf > 0.15) {
        const since = this.clock - this.lastBeatAt;
        const frac = since / this.period;
        const nearest = Math.round(frac);
        const err = (frac - nearest) * this.period; // seconds off the grid
        if (Math.abs(err) < this.period * 0.22 && nearest >= 1) {
          this.lastBeatAt += err * 0.35; // gentle pull
          if (s.kickHit) this.offGridKicks = 0;
        } else if (s.kickHit) {
          // Kicks landing consistently OFF the grid mean the anchor is half a
          // beat out (hats fooled the initial lock) — re-anchor to the kick.
          this.offGridKicks++;
          if (this.offGridKicks >= 4) {
            this.lastBeatAt = this.clock;
            this.offGridKicks = 0;
          }
        }
      }
      let since = this.clock - this.lastBeatAt;
      while (since >= this.period) {
        this.lastBeatAt += this.period;
        since -= this.period;
        this.beatIndex++;
        s.beatTick = true;
        // downbeat voting: which of the 4 slots carries the kick weight?
        const slot = this.beatIndex & 3;
        this.beatSlotKick[slot] = this.beatSlotKick[slot] * 0.88 + s.kick * 0.12;
        if ((this.beatIndex & 15) === 0) {
          let best = 0;
          for (let i = 1; i < 4; i++) {
            if (this.beatSlotKick[i] > this.beatSlotKick[best]) best = i;
          }
          this.downbeatShift = best;
        }
        if (((this.beatIndex - this.downbeatShift) & 3) === 0) s.barTick = true;
      }
      s.beatPhase = Math.min(1, Math.max(0, since / this.period));
      const beatInBar = (this.beatIndex - this.downbeatShift) & 3;
      s.barPhase = (beatInBar + s.beatPhase) / 4;
    } else {
      s.beatPhase = 0;
      s.barPhase = 0;
    }

    // ── section state machine ──
    const fastK = 1 - Math.exp(-dt / 1.5);
    const slowK = 1 - Math.exp(-dt / 10);
    const loud = Math.min(1, s.rms * 2.6);
    this.energyFast += (loud - this.energyFast) * fastK;
    this.energySlow += (loud - this.energySlow) * slowK;
    this.onsetDensity += (((s.kickHit || s.snareHit) ? 1 : 0) - this.onsetDensity) * (1 - Math.exp(-dt / 2.2));
    this.kickPresence += ((s.kick > 0.12 ? 1 : 0) - this.kickPresence) * (1 - Math.exp(-dt / 2.5));
    s.energy = this.energyFast;
    this.sectionT += dt;
    const next = this.classifySection(s);
    if (next !== s.section && this.sectionT > 4) {
      s.section = next;
      this.sectionT = 0;
    }
    s.sectionAge = this.sectionT;

    // engage pulse decay
    s.engagePulse *= Math.exp(-dt * 2.2);

    // ── palette ──
    this.updatePalette(s, dt);
  }

  // ── BPM autocorrelation over the onset ring ──
  private estimateBpm(): void {
    const s = this.snapshot;
    const ring = this.onsetRing;
    const scr = this.bpmScratch; // mean-removed copy of the onset ring
    let mean = 0;
    for (let i = 0; i < ONSET_LEN; i++) mean += ring[i];
    mean /= ONSET_LEN;
    let energy = 0;
    for (let i = 0; i < ONSET_LEN; i++) {
      const v = ring[i] - mean;
      scr[i] = v;
      energy += v * v;
    }
    if (energy < 1e-6) {
      s.bpmConf = Math.max(0, s.bpmConf - 0.3);
      if (s.bpmConf <= 0.05) { s.bpm = 0; this.period = 0; }
      return;
    }
    const lagMin = Math.round((60 / BPM_MAX) * ONSET_HZ);
    const lagMax = Math.round((60 / BPM_MIN) * ONSET_HZ);
    const meanE = energy / ONSET_LEN;
    let bestLag = 0;
    let bestScore = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      // normalized autocorrelation (per-term, so long lags aren't penalized)
      let acc = 0;
      for (let i = lag; i < ONSET_LEN; i++) acc += scr[i] * scr[i - lag];
      let score = acc / ((ONSET_LEN - lag) * meanE);
      // reward the 2× harmonic — a true beat period repeats at double lag too
      const lag2 = lag * 2;
      if (lag2 < ONSET_LEN - 4) {
        let acc2 = 0;
        for (let i = lag2; i < ONSET_LEN; i++) acc2 += scr[i] * scr[i - lag2];
        score += (acc2 / ((ONSET_LEN - lag2) * meanE)) * 0.6;
      }
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (bestLag === 0) return;
    const conf = Math.min(1, bestScore * 0.75);
    const bpmRaw = (60 * ONSET_HZ) / bestLag;
    if (conf > 0.12) {
      // fold octave errors toward the current estimate when one exists
      let bpm = bpmRaw;
      if (s.bpm > 0) {
        if (bpm > s.bpm * 1.7 && bpm / 2 >= BPM_MIN) bpm /= 2;
        else if (bpm < s.bpm * 0.6 && bpm * 2 <= BPM_MAX) bpm *= 2;
      }
      // Tempo continuity: a big non-octave jump needs to clearly beat the
      // held estimate before it can move it — otherwise just bleed confidence.
      const jump = s.bpm > 0 ? Math.abs(bpm - s.bpm) / s.bpm : 0;
      if (s.bpm > 0 && jump > 0.08 && conf < s.bpmConf + 0.15) {
        s.bpmConf = Math.max(0.1, s.bpmConf - 0.08);
        return;
      }
      const blend = s.bpm === 0 ? 1 : jump > 0.08 ? 0.6 : 0.35;
      const newBpm = s.bpm === 0 ? bpm : s.bpm + (bpm - s.bpm) * blend;
      s.bpm = Math.round(newBpm * 10) / 10;
      this.period = 60 / s.bpm;
      if (this.lastBeatAt === 0) this.lastBeatAt = this.clock;
      s.bpmConf = s.bpmConf * 0.5 + conf * 0.5;
    } else {
      s.bpmConf = Math.max(0, s.bpmConf - 0.15);
    }
  }
  private readonly bpmScratch = new Float32Array(ONSET_LEN);

  private classifySection(s: IntelSnapshot): SectionId {
    const eF = this.energyFast;
    const eS = this.energySlow;
    const beats = this.onsetDensity;
    const kick = this.kickPresence;
    if (eF < 0.02) return "idle";
    if (eF > Math.max(0.3, eS * 1.25) && kick > 0.5 && beats > 0.28) return "drop";
    if (kick < 0.18 && eF < eS * 0.85) return "breakdown";
    if (eF > eS * 1.12 && eF > 0.12 && kick > 0.2) return "buildup";
    if (kick > 0.3 || beats > 0.2) return "verse";
    return "intro";
  }

  // ── palette: dominant-band hue + album-art accents ──
  private updatePalette(s: IntelSnapshot, dt: number): void {
    // hue drifts with the long-term spectral centroid: dark → red/violet,
    // bright → cyan/white-hot
    const target = 0.62 - s.centroid * 0.45 + (s.low > s.high ? 0.06 : -0.04);
    this.paletteHue += (target - this.paletteHue) * (1 - Math.exp(-dt / 6));

    const cover = usePlayerStore.getState().metadata.coverUrl ?? null;
    if (cover !== this.coverUrl) {
      this.coverUrl = cover;
      this.coverCols = null;
      if (cover) this.sampleCover(cover);
    }

    if (this.coverCols) {
      s.colA = this.coverCols[0];
      s.colB = this.coverCols[1];
    } else {
      s.colA = hueToRgb(this.paletteHue, 0.75, 0.62);
      s.colB = hueToRgb((this.paletteHue + 0.42) % 1, 0.85, 0.55);
    }
    // glow accent: warmth follows bass vs air balance
    const warm = Math.min(1, Math.max(0, 0.5 + (s.low - s.high) * 1.2));
    s.colC = [
      Math.round(180 + warm * 75),
      Math.round(190 - warm * 60),
      Math.round(255 - warm * 140),
    ];
  }

  /** Pull two accent colours out of the album art (async, non-blocking). */
  private sampleCover(url: string): void {
    const token = ++this.coverToken;
    const img = new Image();
    img.onload = () => {
      if (token !== this.coverToken) return;
      try {
        const N = 24;
        const cv = document.createElement("canvas");
        cv.width = N;
        cv.height = N;
        const c2 = cv.getContext("2d");
        if (!c2) return;
        c2.drawImage(img, 0, 0, N, N);
        const data = c2.getImageData(0, 0, N, N).data;
        // most-saturated bright pixel + average as the pair
        let bestSat = -1;
        let vib: RGB = [200, 200, 220];
        let ar = 0, ag = 0, ab = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          ar += r; ag += g; ab += b;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          const score = sat * (mx / 255);
          if (score > bestSat && mx > 70) {
            bestSat = score;
            vib = [r, g, b];
          }
        }
        const n = data.length / 4;
        const avg: RGB = [Math.round(ar / n), Math.round(ag / n), Math.round(ab / n)];
        // brighten the average so it survives on black
        const boost = 255 / Math.max(80, Math.max(avg[0], avg[1], avg[2]));
        const avgB: RGB = [
          Math.min(255, Math.round(avg[0] * boost * 0.8)),
          Math.min(255, Math.round(avg[1] * boost * 0.8)),
          Math.min(255, Math.round(avg[2] * boost * 0.8)),
        ];
        this.coverCols = [vib, avgB];
      } catch {
        /* canvas tainted or decode issue — keep procedural palette */
      }
    };
    img.onerror = () => undefined;
    img.src = url;
  }
}

function hueToRgb(h: number, sat: number, val: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = val * (1 - sat);
  const q = val * (1 - f * sat);
  const t = val * (1 - (1 - f) * sat);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = val; g = t; b = p; break;
    case 1: r = q; g = val; b = p; break;
    case 2: r = p; g = val; b = t; break;
    case 3: r = p; g = q; b = val; break;
    case 4: r = t; g = p; b = val; break;
    default: r = val; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** THE singleton — main window only. Broadcast windows receive wire data. */
let intelInstance: VisualIntel | null = null;
export function getVisualIntel(): VisualIntel {
  if (!intelInstance) {
    intelInstance = new VisualIntel();
    // debug handle (dev tooling / smoke tests inspect the live pipeline)
    (globalThis as Record<string, unknown>).__kcIntel = intelInstance;
  }
  return intelInstance;
}
