/**
 * "HRTF rooms" - in reality, procedurally-generated stereo impulse
 * responses with carefully-tuned early-reflection patterns and short
 * decay tails that pull headphone audio out of the listener's head.
 *
 * Three presets:
 *   - studio: tight near-field room (~120 ms tail)
 *   - cinema: medium room with delayed first reflection (~500 ms tail)
 *   - club:   diffuse big room with bass-heavy tail (~900 ms tail)
 *
 * Wet/dry mix is controlled externally via the parent engine. Stays
 * silent when no preset is selected.
 */
export type RoomId = "off" | "studio" | "cinema" | "club";

export class HRTFRooms {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly convolver: ConvolverNode;
  private mix = 0;
  private room: RoomId = "off";

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;

    this.convolver = ctx.createConvolver();

    this.input.connect(this.dryGain).connect(this.output);
    this.input.connect(this.convolver).connect(this.wetGain).connect(this.output);
  }

  setRoom(room: RoomId): void {
    if (room === this.room) return;
    this.room = room;
    if (room === "off") {
      this.convolver.buffer = null;
      return;
    }
    this.convolver.buffer = this.synthesize(room);
  }

  /** mix in [0, 1]: 0 = dry, 1 = full wet. */
  setMix(mix: number): void {
    const m = Math.max(0, Math.min(1, mix));
    if (Math.abs(m - this.mix) < 1e-4) return;
    this.mix = m;
    const t = this.ctx.currentTime;
    // Equal-power crossfade keeps perceived loudness flat.
    this.dryGain.gain.setTargetAtTime(Math.cos(m * Math.PI * 0.5), t, 0.05);
    this.wetGain.gain.setTargetAtTime(Math.sin(m * Math.PI * 0.5), t, 0.05);
  }

  private synthesize(room: RoomId): AudioBuffer {
    const sr = (this.ctx as AudioContext).sampleRate || 48000;
    if (room === "off") {
      // Should never be reached because setRoom("off") shortcircuits to
      // a null buffer, but TypeScript needs the narrowed branch.
      return this.ctx.createBuffer(2, 1, sr);
    }
    const cfg = ROOM_CFG[room];
    const n = Math.floor(sr * cfg.lengthSec);
    const buf = this.ctx.createBuffer(2, n, sr);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);

      // Early reflections - slightly different per ear for spatial cues.
      for (let i = 0; i < cfg.taps.length; i++) {
        const tap = cfg.taps[i];
        const sample = Math.floor(tap.delayMs * sr / 1000);
        if (sample >= n) continue;
        const sign = (i + ch) % 2 === 0 ? 1 : -1;
        const lr = ch === 0 ? tap.gainL : tap.gainR;
        data[sample] += sign * lr;
      }

      // Diffuse exponential-decay noise tail.
      const tail = Math.floor(sr * 0.005);  // start 5 ms in
      for (let i = tail; i < n; i++) {
        const env = Math.exp(-i / (sr * cfg.decayTau));
        // Slight per-channel decorrelation: different seed per ear.
        const noise = pseudoRand(i + (ch === 0 ? 1 : 23)) * 2 - 1;
        data[i] += noise * env * cfg.tailLevel;
      }
    }
    return buf;
  }
}

function pseudoRand(x: number): number {
  // Cheap deterministic pseudo-random for IR synthesis. Repeatable so
  // every render of the same room sounds identical.
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

interface Tap {
  delayMs: number;
  gainL: number;
  gainR: number;
}

const ROOM_CFG: Record<Exclude<RoomId, "off">, {
  lengthSec: number;
  decayTau: number;
  tailLevel: number;
  taps: Tap[];
}> = {
  studio: {
    lengthSec: 0.18,
    decayTau: 0.06,
    tailLevel: 0.08,
    taps: [
      { delayMs: 6.5, gainL: 0.55, gainR: 0.42 },
      { delayMs: 12.3, gainL: 0.35, gainR: 0.48 },
      { delayMs: 22.1, gainL: 0.22, gainR: 0.26 },
      { delayMs: 31.7, gainL: 0.15, gainR: 0.17 },
    ],
  },
  cinema: {
    lengthSec: 0.55,
    decayTau: 0.18,
    tailLevel: 0.12,
    taps: [
      { delayMs: 11.0, gainL: 0.48, gainR: 0.41 },
      { delayMs: 23.4, gainL: 0.36, gainR: 0.40 },
      { delayMs: 41.8, gainL: 0.28, gainR: 0.24 },
      { delayMs: 67.3, gainL: 0.20, gainR: 0.22 },
      { delayMs: 110.5, gainL: 0.15, gainR: 0.14 },
    ],
  },
  club: {
    lengthSec: 1.0,
    decayTau: 0.35,
    tailLevel: 0.15,
    taps: [
      { delayMs: 14.2, gainL: 0.42, gainR: 0.46 },
      { delayMs: 33.9, gainL: 0.32, gainR: 0.30 },
      { delayMs: 58.6, gainL: 0.28, gainR: 0.31 },
      { delayMs: 95.1, gainL: 0.22, gainR: 0.20 },
      { delayMs: 142.0, gainL: 0.18, gainR: 0.19 },
      { delayMs: 218.0, gainL: 0.12, gainR: 0.13 },
    ],
  },
};
