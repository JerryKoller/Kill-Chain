/**
 * VoiceRescue — pull a buried / muffled voice out of a bad recording (v2.1).
 *
 * Four moves that stack into "suddenly I can understand them":
 *
 *   FLOOR CUT     Highpass sweeping up to ~95 Hz — room rumble and handling
 *                 noise live below the voice, never in it.
 *   DE-BOOM      A dip at ~240 Hz clears proximity-effect boom and small-room
 *                 boxiness that masks consonants.
 *   PRESENCE     A broad lift centred at 2.7 kHz — the intelligibility band.
 *   LEVELER      A DynamicsCompressor tuned for speech (soft knee, 4:1,
 *                 ~5 dB of work at full amount) evens out a speaker who
 *                 drifts on and off mic.
 *
 * `amount` 0 = transparent wire (filters at 0 dB, compressor at ∞ threshold).
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class VoiceRescue {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private amount = 0;

  private readonly floor: BiquadFilterNode;
  private readonly deboom: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private readonly leveler: DynamicsCompressorNode;
  private readonly makeup: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.floor = ctx.createBiquadFilter();
    this.floor.type = "highpass";
    this.floor.frequency.value = 5; // effectively open until engaged
    this.floor.Q.value = Math.SQRT1_2;

    this.deboom = ctx.createBiquadFilter();
    this.deboom.type = "peaking";
    this.deboom.frequency.value = 240;
    this.deboom.Q.value = 0.9;
    this.deboom.gain.value = 0;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = "peaking";
    this.presence.frequency.value = 2700;
    this.presence.Q.value = 0.8;
    this.presence.gain.value = 0;

    this.leveler = ctx.createDynamicsCompressor();
    this.leveler.threshold.value = 0; // out of the way until engaged
    this.leveler.knee.value = 18;
    this.leveler.ratio.value = 4;
    this.leveler.attack.value = 0.008;
    this.leveler.release.value = 0.22;

    this.makeup = ctx.createGain();
    this.makeup.gain.value = 1;

    this.input
      .connect(this.floor)
      .connect(this.deboom)
      .connect(this.presence)
      .connect(this.leveler)
      .connect(this.makeup)
      .connect(this.output);
  }

  setAmount(a: number): void {
    const amt = clamp01(a);
    if (Math.abs(amt - this.amount) < 1e-4) return;
    this.amount = amt;
    const t = this.ctx.currentTime;
    if (amt <= 0.001) {
      this.floor.frequency.setTargetAtTime(5, t, 0.05);
      this.deboom.gain.setTargetAtTime(0, t, 0.05);
      this.presence.gain.setTargetAtTime(0, t, 0.05);
      this.leveler.threshold.setTargetAtTime(0, t, 0.05);
      this.makeup.gain.setTargetAtTime(1, t, 0.05);
      return;
    }
    this.floor.frequency.setTargetAtTime(5 + amt * 90, t, 0.05); // → 95 Hz
    this.deboom.gain.setTargetAtTime(-3.5 * amt, t, 0.05);
    this.presence.gain.setTargetAtTime(3.0 * amt, t, 0.05);
    // Threshold dips to ~-32 dB at full — roughly 5 dB of levelling on
    // typical speech, with soft-knee so music passing through stays intact.
    this.leveler.threshold.setTargetAtTime(-32 * amt, t, 0.05);
    this.makeup.gain.setTargetAtTime(1 + 0.35 * amt, t, 0.05);
  }

  getAmount(): number {
    return this.amount;
  }
}
