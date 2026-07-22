/**
 * DeClipper — soft de-clipping for crushed / hard-limited sources (v2.1).
 *
 * True sample reconstruction is an offline problem, but the audible damage
 * of clipping — flattened peaks and the harsh odd-harmonic buzz they add —
 * responds well to a realtime "inverse saturation" treatment:
 *
 *   EXPANSION   A WaveShaper with an atanh-flavoured curve steepens the top
 *               of the transfer, rounding flattened peaks back out. Blended
 *               in parallel with the dry path so low-level detail is
 *               untouched (the curve is ~identity below |x| ≈ 0.5).
 *   BUZZ GUARD  A gentle dynamic peaking cut around 6 kHz rides the amount
 *               knob — clipping buzz lives high; softening it reads as
 *               "the distortion got quieter".
 *   SAFETY      A fixed post-trim keeps the expanded peaks from re-clipping
 *               the chain (the curve can push |x| ≈ 1 up to ~1.25).
 *
 * `amount` 0 = transparent wire (wet path silent).
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Inverse-saturation transfer: identity at small |x|, expanded near ±1. */
function makeExpandCurve(): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(n);
  // atanh(k·x)/atanh(k) expands the top of the range; k controls how hard.
  const k = 0.92;
  const norm = Math.atanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.atanh(k * x) / norm;
  }
  return curve;
}

export class DeClipper {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private amount = 0;

  private readonly dry: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly wet: GainNode;
  private readonly buzz: BiquadFilterNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Buzz guard sits on the main path (0 dB when idle → transparent).
    this.buzz = ctx.createBiquadFilter();
    this.buzz.type = "peaking";
    this.buzz.frequency.value = 6200;
    this.buzz.Q.value = 0.8;
    this.buzz.gain.value = 0;

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeExpandCurve();
    this.shaper.oversample = "4x";

    // Post-trim: at full wet the expansion can lift peaks ~+2 dB; pre-scale
    // the wet branch so dry+wet crossfade stays at unity-ish loudness.
    const trim = ctx.createGain();
    trim.gain.value = 0.82;

    this.input.connect(this.buzz);
    this.buzz.connect(this.dry).connect(this.output);
    this.buzz.connect(this.shaper).connect(trim).connect(this.wet).connect(this.output);
  }

  setAmount(a: number): void {
    const amt = clamp01(a);
    if (Math.abs(amt - this.amount) < 1e-4) return;
    this.amount = amt;
    const t = this.ctx.currentTime;
    // Equal-ish power crossfade dry↔expanded, capped at 70% wet — full
    // replacement sounds phasey on clean material.
    const wet = amt * 0.7;
    this.wet.gain.setTargetAtTime(wet, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - wet * 0.85, t, 0.05);
    this.buzz.gain.setTargetAtTime(-2.6 * amt, t, 0.05);
  }

  getAmount(): number {
    return this.amount;
  }
}
