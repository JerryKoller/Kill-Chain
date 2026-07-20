/**
 * FireDrumKit — a fully synthesized drum machine for the Fire Command
 * sequencer. No samples: every hit is built from oscillators + shaped noise
 * on the audio clock, so hits can be scheduled sample-accurately and the kit
 * costs nothing while silent.
 *
 * Eight lanes, in FL-step-sequencer spirit:
 *   kick · snare · clap · closed hat · open hat · low tom · rim · crash
 *
 * Each trigger builds a tiny one-shot node graph and lets it garbage-collect
 * after `stop()`. Per-hit node counts are small (2–6 nodes) and hits are
 * short, so even dense 16th-note patterns stay cheap.
 */

export type DrumLane = "kick" | "snare" | "clap" | "chat" | "ohat" | "tom" | "rim" | "crash";

export const DRUM_LANES: { id: DrumLane; name: string; color: string }[] = [
  { id: "kick",  name: "Kick",     color: "#ff5c2e" },
  { id: "snare", name: "Snare",    color: "#ffb648" },
  { id: "clap",  name: "Clap",     color: "#ffd166" },
  { id: "chat",  name: "Hat",      color: "#9be564" },
  { id: "ohat",  name: "Open Hat", color: "#5ad1a5" },
  { id: "tom",   name: "Tom",      color: "#62b6ff" },
  { id: "rim",   name: "Rim",      color: "#c98bff" },
  { id: "crash", name: "Crash",    color: "#ff7bac" },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Fixed headroom trim on the kit's output.
 *
 * ROOT CAUSE (clipping, part 4): individual hits peaked near (or above) full
 * scale on their own — the kick alone ran 1.1·v body + 0.5·v click — and the
 * whole kit then summed with the synth on the engine's shared inputBus. On
 * sequencer downbeats (kick + hat + chord together) the bus peak stacked to
 * 2×+ and slammed the downstream limiter into audible pumping ("cut-out").
 * A -4.4 dB pad keeps the drums' own transient dynamics intact while leaving
 * the synth+drums SUM room under the limiter threshold. The user-facing
 * drumLevel range (0..1.2) is unchanged; it just scales inside this budget.
 */
const DRUM_TRIM = 0.6;

/**
 * Knee-style safety clip transfer, shared by the drum kit's output and the
 * engine's Fire-Command bus (see AudioEngine): EXACT identity up to ±0.7,
 * then a C1-smooth tanh shoulder that lands on a hard 0.98 (-0.18 dBFS)
 * ceiling. Evaluated over ±`range` — pair it with a 1/range pad gain going
 * into the WaveShaper so hot material is absorbed smoothly instead of
 * hard-clamping at the shaper's ±1 input boundary. Unity makeup: normal
 * program passes bit-exact, only genuine overs get rounded.
 */
export const SAFETY_CLIP_RANGE = 2;
export function makeSafetyClipCurve(range = SAFETY_CLIP_RANGE): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(n);
  const knee = 0.7;
  const span = 0.98 - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * range;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  }
  return curve;
}

export class FireDrumKit {
  readonly output: GainNode;
  private readonly clipPad: GainNode;
  private readonly clip: WaveShaperNode;
  private readonly ctx: AudioContext;
  private noiseBuf: AudioBuffer | null = null;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.9 * DRUM_TRIM;
    /**
     * ROOT CAUSE (clipping, part 7): the kit had NO clipper of its own —
     * only the trim above. Per-hit worst-case peaks (velocity 1, coherent
     * alignment): kick ≈ 0.95 body + 0.42·HP click ≈ 1.3 · snare ≈ 0.84
     * tone + 0.7 rattle ≈ 1.54 · clap ≈ 0.62 · closed hat ≈ 0.85 (its
     * +10 dB 10.5 kHz peaking bell can push filtered noise past its 0.55
     * gain) · open hat ≈ 0.8 · tom ≈ 1.0 · rim ≈ 1.15 (square fundamental
     * is 4/π and the Q=5 bandpass rings) · crash ≈ 0.95. An 8-lane downbeat
     * at full velocity therefore sums to ≈ 8.2 × 0.54 trim ≈ 4.4 peak — far
     * past full scale, and the engine's DynamicsCompressor "limiter" (1 ms
     * attack, not brickwall) let those transients straight through to the
     * DAC. The knee clipper below bounds the kit at 0.98 with unity makeup:
     * a lone kick (≈ 1.3 × 0.54 = 0.7) stays in the identity region,
     * untouched; only genuine multi-lane pile-ups get rounded.
     */
    this.clipPad = ctx.createGain();
    this.clipPad.gain.value = 1 / SAFETY_CLIP_RANGE;
    this.clip = ctx.createWaveShaper();
    this.clip.curve = makeSafetyClipCurve();
    this.clip.oversample = "2x";
    this.output.connect(this.clipPad).connect(this.clip).connect(dest);
  }

  setLevel(v: number): void {
    this.output.gain.setTargetAtTime(clamp(v, 0, 1.2) * DRUM_TRIM, this.ctx.currentTime, 0.02);
  }

  // ── User samples ──────────────────────────────────────────────────────────
  // Any lane can swap its synthesized hit for the operator's own sample
  // (kicks, snares, whatever). Samples ride the same output/clipper, so gain
  // staging and safety stay identical.
  private readonly samples = new Map<DrumLane, AudioBuffer>();

  setSample(lane: DrumLane, buffer: AudioBuffer | null): void {
    if (buffer) this.samples.set(lane, buffer);
    else this.samples.delete(lane);
  }

  hasSample(lane: DrumLane): boolean {
    return this.samples.has(lane);
  }

  /** Generic one-shot buffer trigger (sample lanes / pads). */
  playBuffer(buffer: AudioBuffer, when: number, velocity = 1, level = 1): void {
    const t = Math.max(this.ctx.currentTime, when);
    const v = clamp(velocity, 0.05, 1) * clamp(level, 0, 1.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = v;
    src.connect(g).connect(this.output);
    src.onended = () => {
      try { src.disconnect(); } catch { /* ignore */ }
      try { g.disconnect(); } catch { /* ignore */ }
    };
    src.start(t);
  }

  /** Lazily built 1s white-noise loop shared by all noise-based hits. */
  private noise(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const len = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  trigger(lane: DrumLane, when: number, velocity = 1): void {
    // A loaded user sample replaces the synthesized hit for this lane.
    const sample = this.samples.get(lane);
    if (sample) {
      this.playBuffer(sample, when, velocity);
      return;
    }
    const t = Math.max(this.ctx.currentTime, when);
    const v = clamp(velocity, 0.05, 1);
    switch (lane) {
      case "kick": this.kick(t, v); break;
      case "snare": this.snare(t, v); break;
      case "clap": this.clap(t, v); break;
      case "chat": this.hat(t, v, false); break;
      case "ohat": this.hat(t, v, true); break;
      case "tom": this.tom(t, v); break;
      case "rim": this.rim(t, v); break;
      case "crash": this.crash(t, v); break;
    }
  }

  // ── voices ──

  private kick(t: number, v: number): void {
    const ctx = this.ctx;
    // Body: sine with fast pitch drop 160→45 Hz.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    // 0.95 (was 1.1): body + click summed past full scale per hit.
    g.gain.setValueAtTime(0.95 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    // Click transient: tiny burst of highpassed noise.
    const click = ctx.createBufferSource();
    click.buffer = this.noise();
    const cf = ctx.createBiquadFilter();
    cf.type = "highpass";
    cf.frequency.value = 1200;
    const cg = ctx.createGain();
    // 0.42 (was 0.5): body + click summed to ~1.45/hit; ~1.25 keeps a lone
    // full-velocity kick inside the output clipper's identity region.
    cg.gain.setValueAtTime(0.42 * v, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    osc.connect(g).connect(this.output);
    click.connect(cf).connect(cg).connect(this.output);
    osc.start(t); osc.stop(t + 0.5);
    click.start(t); click.stop(t + 0.03);
  }

  private snare(t: number, v: number): void {
    const ctx = this.ctx;
    // Tone: two detuned triangles ~180/330 Hz, short.
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const og = ctx.createGain();
    o1.type = "triangle"; o1.frequency.value = 185;
    o2.type = "triangle"; o2.frequency.value = 330;
    // 0.42 (was 0.5): the two triangles sum coherently at onset (±2 → ±1.0
    // through this gain), which put tone + rattle at ~1.75 per hit.
    og.gain.setValueAtTime(0.42 * v, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    // Rattle: bandpassed noise.
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const nf = ctx.createBiquadFilter();
    nf.type = "highpass";
    nf.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.7 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    o1.connect(og); o2.connect(og); og.connect(this.output);
    n.connect(nf).connect(ng).connect(this.output);
    o1.start(t); o1.stop(t + 0.15);
    o2.start(t); o2.stop(t + 0.15);
    n.start(t); n.stop(t + 0.22);
  }

  private clap(t: number, v: number): void {
    const ctx = this.ctx;
    // Classic 3-burst clap: gated noise re-triggered at ~11 ms, then a tail.
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1400;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    const burst = 0.011;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const bt = t + i * burst;
      g.gain.setValueAtTime(0.9 * v, bt);
      g.gain.exponentialRampToValueAtTime(0.15 * v, bt + burst * 0.9);
    }
    g.gain.setValueAtTime(0.8 * v, t + 3 * burst);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3 * burst + 0.24);
    n.connect(f).connect(g).connect(this.output);
    n.start(t); n.stop(t + 0.32);
  }

  private hat(t: number, v: number, open: boolean): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    // A resonant peak gives it a metallic ring rather than pure hiss.
    const pk = ctx.createBiquadFilter();
    pk.type = "peaking";
    pk.frequency.value = 10500;
    pk.Q.value = 3;
    pk.gain.value = 10;
    const g = ctx.createGain();
    const dur = open ? 0.5 : 0.055;
    g.gain.setValueAtTime((open ? 0.5 : 0.55) * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp).connect(pk).connect(g).connect(this.output);
    n.start(t); n.stop(t + dur + 0.03);
  }

  private tom(t: number, v: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.18);
    g.gain.setValueAtTime(0.9 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(this.output);
    n.connect(nf).connect(ng).connect(this.output);
    osc.start(t); osc.stop(t + 0.4);
    n.start(t); n.stop(t + 0.1);
  }

  private rim(t: number, v: number): void {
    const ctx = this.ctx;
    // Short square blip through a tight bandpass — woody click.
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1750;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1750;
    f.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(f).connect(g).connect(this.output);
    osc.start(t); osc.stop(t + 0.06);
  }

  private crash(t: number, v: number): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    n.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5200;
    const shimmer = ctx.createBiquadFilter();
    shimmer.type = "peaking";
    shimmer.frequency.value = 8600;
    shimmer.Q.value = 1.1;
    shimmer.gain.value = 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    n.connect(hp).connect(shimmer).connect(g).connect(this.output);
    n.start(t); n.stop(t + 1.5);
  }
}
