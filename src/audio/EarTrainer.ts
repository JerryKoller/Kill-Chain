/**
 * EarTrainer — a self-contained audio graph for the "Golden Ears" frequency
 * training arcade.
 *
 * It runs on the shared AudioContext but is deliberately isolated from the
 * main DSP chain: a looping source feeds a single peaking BiquadFilter (the
 * "secret boost") into its own gain stage and straight to the destination.
 *
 * Why isolated?  The whole point of ear training is a clean, uncolored
 * reference. Routing through the user's current sculpt (or the headphone
 * correction) would defeat the exercise. The trainer never touches the
 * user's params, undo history, or the player.
 */
import { getEngine } from "./AudioEngine";
import { getReferenceBuffer, makeSeamlessLoopBuffer, type ClipId } from "./ReferenceClips";

export interface TrainerBand {
  /** Stable id. */
  id: string;
  /** Center frequency in Hz. */
  freq: number;
  /** Short display label. */
  label: string;
  /** One-word character description shown on reveal. */
  character: string;
}

/** Master list of 10 bands spanning the audible spectrum. */
export const TRAINER_BANDS: TrainerBand[] = [
  { id: "b50",    freq: 50,    label: "50",    character: "Sub rumble" },
  { id: "b100",   freq: 100,   label: "100",   character: "Low bass" },
  { id: "b200",   freq: 200,   label: "200",   character: "Upper bass" },
  { id: "b400",   freq: 400,   label: "400",   character: "Low mid / boxy" },
  { id: "b800",   freq: 800,   label: "800",   character: "Midrange" },
  { id: "b1500",  freq: 1500,  label: "1.5k",  character: "Upper mid / nasal" },
  { id: "b3000",  freq: 3000,  label: "3k",    character: "Presence / bite" },
  { id: "b6000",  freq: 6000,  label: "6k",    character: "Brilliance / edge" },
  { id: "b10000", freq: 10000, label: "10k",   character: "Air" },
  { id: "b15000", freq: 15000, label: "15k",   character: "Top end" },
];

export type DifficultyId = "rookie" | "trained" | "pro" | "golden";

export interface Difficulty {
  id: DifficultyId;
  name: string;
  blurb: string;
  boostDb: number;
  q: number;
  /** How many bands are in play (evenly sampled from the master list). */
  bandCount: number;
  accent: string;
}

export const DIFFICULTIES: Difficulty[] = [
  { id: "rookie",  name: "Rookie",  blurb: "+10 dB · wide · 6 bands",  boostDb: 10, q: 1.8, bandCount: 6,  accent: "#9dff5b" },
  { id: "trained", name: "Trained", blurb: "+6 dB · 8 bands",          boostDb: 6,  q: 2.6, bandCount: 8,  accent: "#22e8ff" },
  { id: "pro",     name: "Pro",     blurb: "+4 dB · narrow · 10 bands", boostDb: 4,  q: 3.6, bandCount: 10, accent: "#ff2bd6" },
  { id: "golden",  name: "Golden",  blurb: "+3 dB · surgical · 10 bands", boostDb: 3, q: 4.5, bandCount: 10, accent: "#ffb648" },
];

/** Evenly sample `count` bands from the master list. */
export function bandsForDifficulty(d: Difficulty): TrainerBand[] {
  const n = TRAINER_BANDS.length;
  if (d.bandCount >= n) return [...TRAINER_BANDS];
  const out: TrainerBand[] = [];
  for (let i = 0; i < d.bandCount; i++) {
    const idx = Math.round((i * (n - 1)) / (d.bandCount - 1));
    out.push(TRAINER_BANDS[idx]);
  }
  return out;
}

export class EarTrainer {
  private ctx: AudioContext;
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private boostDb = 6;
  private running = false;
  /** Deferred stop from stop()'s fade-out — cancelled by a fresh start(). */
  private stopTimer: number | null = null;
  /** User-loaded track, used when the "custom" source is selected. */
  private customBuffer: AudioBuffer | null = null;
  private customName: string | null = null;
  /** Seamless (crossfaded) loop copies, so looping doesn't click. */
  private loopCache = new Map<string, AudioBuffer>();

  constructor() {
    const engine = getEngine();
    this.ctx = engine.ctx as AudioContext;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "peaking";
    this.filter.frequency.value = 1000;
    this.filter.Q.value = 2.5;
    this.filter.gain.value = 0;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;

    this.filter.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }

  /** Decode a user file into the custom training buffer. Returns its name. */
  async loadCustomFile(file: File): Promise<string> {
    const arrayBuf = await file.arrayBuffer();
    // decodeAudioData may detach the buffer; that's fine, we only need it once.
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
    // Crossfade a seamless loop so a song that doesn't start/end on silence
    // doesn't pop every time it wraps.
    this.customBuffer = makeSeamlessLoopBuffer(this.ctx, audioBuf, 0.06);
    this.customName = file.name;
    this.loopCache.delete("custom");
    return file.name;
  }

  /** Fetch (and cache) a click-free looping buffer for a clip. */
  private seamlessFor(clip: ClipId | "custom"): AudioBuffer {
    if (clip === "custom" && this.customBuffer) return this.customBuffer;
    const id = clip === "custom" ? "pink-noise" : clip;
    const cached = this.loopCache.get(id);
    if (cached) return cached;
    const seamless = makeSeamlessLoopBuffer(this.ctx, getReferenceBuffer(this.ctx, id), 0.04);
    this.loopCache.set(id, seamless);
    return seamless;
  }

  hasCustom(): boolean {
    return this.customBuffer !== null;
  }

  customTrackName(): string | null {
    return this.customName;
  }

  async start(clip: ClipId | "custom" = "pink-noise"): Promise<void> {
    const engine = getEngine();
    await engine.resume();
    // A pending fade-out stop from a recent stop() must not fire after this
    // start — it would kill the NEW source ~160 ms in (silent trainer).
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.stopSource();

    const buf = this.seamlessFor(clip);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.filter);
    src.start();
    this.src = src;
    this.running = true;

    // Fade in to avoid a click.
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0.85, t + 0.08);
  }

  /** Stop playback and fade out. */
  stop(): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + 0.12);
    // Stop the source slightly after the fade (tracked so start() can cancel).
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      this.stopTimer = null;
      this.stopSource();
    }, 160);
    this.running = false;
  }

  private stopSource(): void {
    if (this.src) {
      try { this.src.stop(); } catch { /* already stopped */ }
      try { this.src.disconnect(); } catch { /* ignore */ }
      this.src = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Configure the secret band for a new round (starts flat / un-boosted). */
  setRound(freq: number, q: number, boostDb: number): void {
    const t = this.ctx.currentTime;
    this.boostDb = boostDb;
    this.filter.frequency.setTargetAtTime(freq, t, 0.01);
    this.filter.Q.setTargetAtTime(q, t, 0.01);
    this.filter.gain.setTargetAtTime(0, t, 0.02);
  }

  /** Toggle the boost on/off for A/B comparison. */
  setBoosted(on: boolean): void {
    const t = this.ctx.currentTime;
    this.filter.gain.setTargetAtTime(on ? this.boostDb : 0, t, 0.03);
  }

  setVolume(v: number): void {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), t, 0.05);
  }
}

let _trainer: EarTrainer | null = null;
export function getEarTrainer(): EarTrainer {
  if (!_trainer) _trainer = new EarTrainer();
  return _trainer;
}
