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
  { id: "chat",  name: "Closed Hat", color: "#9be564" },
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
const DRUM_TRIM = 0.62;

/**
 * Knee-style safety clip transfer, shared by the drum kit's output and the
 * engine's Fire-Command bus (see AudioEngine): EXACT identity up to ±0.85,
 * then a C1-smooth tanh shoulder that lands on a hard 0.98 (-0.18 dBFS)
 * ceiling. Evaluated over ±`range` — pair it with a 1/range pad gain going
 * into the WaveShaper so hot material is absorbed smoothly instead of
 * hard-clamping at the shaper's ±1 input boundary. Unity makeup: normal
 * program passes bit-exact, only genuine overs get rounded.
 *
 * Knee raised 0.7 → 0.85: the Fire bus is now guarded by a true lookahead
 * limiter (ceiling 0.84) IN FRONT of this stage, so under normal operation
 * the clipper sits entirely in its identity region — it exists purely as a
 * last-resort ceiling for limiter-bypass / inter-sample overshoot. The old
 * 0.7 knee meant any healthy signal above −3.1 dBFS picked up tanh
 * coloration — one of the "always slightly crunchy" contributors.
 */
export const SAFETY_CLIP_RANGE = 2;
export function makeSafetyClipCurve(range = SAFETY_CLIP_RANGE): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(n);
  const knee = 0.85;
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
  /** Sample-deck one-shots sum here (own mixer strip since v1.6). */
  readonly sampleOutput: GainNode;
  private readonly clipPad: GainNode;
  private readonly clip: WaveShaperNode;
  private readonly sampleClipPad: GainNode;
  private readonly sampleClip: WaveShaperNode;
  private readonly ctx: AudioContext;
  private noiseBuf: AudioBuffer | null = null;
  /** Live one-shot sources — stopped on transport silence. */
  private readonly liveSources = new Set<AudioScheduledSourceNode>();
  private kitLevel = 0.9;
  private sampleLevel = 0.9;
  private silenced = false;

  constructor(ctx: BaseAudioContext, dest: AudioNode, sampleDest?: AudioNode) {
    this.ctx = ctx as AudioContext;
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
    // Sample deck: same trim + own knee clipper (was unclipped into fireBus —
    // sample one-shots piled with drums/synths were a major seq clipping source).
    this.sampleOutput = ctx.createGain();
    this.sampleOutput.gain.value = 0.9 * DRUM_TRIM;
    this.sampleClipPad = ctx.createGain();
    this.sampleClipPad.gain.value = 1 / SAFETY_CLIP_RANGE;
    this.sampleClip = ctx.createWaveShaper();
    this.sampleClip.curve = makeSafetyClipCurve();
    this.sampleClip.oversample = "2x";
    this.sampleOutput.connect(this.sampleClipPad).connect(this.sampleClip).connect(sampleDest ?? dest);
  }

  setLevel(v: number): void {
    this.kitLevel = clamp(v, 0, 1.2);
    if (this.silenced) return;
    this.output.gain.setTargetAtTime(this.kitLevel * DRUM_TRIM, this.ctx.currentTime, 0.02);
  }

  /**
   * Transport stop: hard-stop live one-shots and mute buses so open hats /
   * crash / samples don't ring after Stop.
   */
  silence(): void {
    this.silenced = true;
    const t = this.ctx.currentTime;
    try {
      for (const src of [...this.liveSources]) {
        try { src.stop(t); } catch { /* already stopped */ }
      }
      this.liveSources.clear();
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(0, t);
      this.sampleOutput.gain.cancelScheduledValues(t);
      this.sampleOutput.gain.setValueAtTime(0, t);
      this.chokeOpenHat(t);
      this.ohatGain = null;
    } catch { /* ignore */ }
  }

  /** Re-open kit buses after a transport silence (next trigger / play). */
  unsilence(): void {
    if (!this.silenced) return;
    this.silenced = false;
    const t = this.ctx.currentTime;
    try {
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(this.kitLevel * DRUM_TRIM, t);
      this.sampleOutput.gain.cancelScheduledValues(t);
      this.sampleOutput.gain.setValueAtTime(this.sampleLevel * DRUM_TRIM, t);
    } catch { /* ignore */ }
  }

  private trackSource(src: AudioScheduledSourceNode): void {
    this.liveSources.add(src);
    const prev = src.onended;
    src.onended = (ev) => {
      this.liveSources.delete(src);
      if (typeof prev === "function") prev.call(src, ev);
    };
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

  /**
   * Generic one-shot buffer trigger. Drum-lane sample overrides ride the
   * drum output; the SAMPLE DECK passes `toSampleBus` to land on its own
   * mixer strip (v1.6).
   */
  playBuffer(
    buffer: AudioBuffer,
    when: number,
    velocity = 1,
    level = 1,
    toSampleBus = false,
    pan = 0,
    /** When true, this buffer is tracked as the open-hat voice for choke. */
    asOpenHat = false,
    /** −1 inverts phase (kick polarity). */
    polarity = 1,
  ): void {
    this.unsilence();
    const t = Math.max(this.ctx.currentTime, when);
    const v = clamp(Math.abs(velocity), 0.05, 1) * clamp(level, 0, 1.5) * (polarity < 0 ? -1 : 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (asOpenHat) this.ohatGain = g;
    const bus = toSampleBus ? this.sampleOutput : this.output;
    const dest = Math.abs(pan) > 0.01 ? this.pannedInto(bus, pan) : bus;
    const nodes: AudioNode[] = [src, g];
    src.connect(g).connect(dest);
    if (dest !== bus) nodes.push(dest);
    src.onended = () => {
      if (asOpenHat && this.ohatGain === g) this.ohatGain = null;
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
    };
    this.trackSource(src);
    src.start(t);
  }

  private ohatGain: GainNode | null = null;

  private pannedInto(bus: AudioNode, pan: number): AudioNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(bus);
    return p;
  }

  private panned(pan: number): AudioNode {
    if (Math.abs(pan) < 0.01) return this.output;
    return this.pannedInto(this.output, pan);
  }

  private chokeOpenHat(when: number): void {
    const g = this.ohatGain;
    if (!g) return;
    const t = Math.max(this.ctx.currentTime, when);
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    } catch { /* ignore */ }
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

  trigger(lane: DrumLane, when: number, velocity = 1, opts?: {
    pan?: number;
    polarity?: number;
    chokeOpenHat?: boolean;
  }): void {
    this.unsilence();
    if (opts?.chokeOpenHat) this.chokeOpenHat(when);
    // A loaded user sample replaces the synthesized hit for this lane.
    const sample = this.samples.get(lane);
    if (sample) {
      const polarity = opts?.polarity === -1 ? -1 : 1;
      this.playBuffer(
        sample, when, velocity, 1, false, opts?.pan ?? 0,
        lane === "ohat",
        lane === "kick" ? polarity : 1,
      );
      return;
    }
    const t = Math.max(this.ctx.currentTime, when);
    const v = clamp(velocity, 0.05, 1);
    const polarity = opts?.polarity === -1 ? -1 : 1;
    const pan = opts?.pan ?? 0;
    const dest = this.panned(pan);
    switch (lane) {
      case "kick": this.kick(t, Math.abs(v) * (polarity < 0 ? -1 : 1), dest); break;
      case "snare": this.snare(t, v, dest); break;
      case "clap": this.clap(t, v, dest); break;
      case "chat": this.hat(t, v, false, dest); break;
      case "ohat": this.hat(t, v, true, dest); break;
      case "tom": this.tom(t, v, dest); break;
      case "rim": this.rim(t, v, dest); break;
      case "crash": this.crash(t, v, dest); break;
    }
  }

  /**
   * Disconnect synth-hit nodes after they finish to cut GC pressure.
   * Pass the per-hit dest so a StereoPanner created for this voice is
   * swept up with it — a shared slot raced overlapping triggers.
   */
  private disposeOnEnd(last: AudioScheduledSourceNode, nodes: AudioNode[], dest?: AudioNode): void {
    if (dest && dest !== this.output) nodes = [...nodes, dest];
    for (const n of nodes) {
      if ("stop" in n && typeof (n as AudioScheduledSourceNode).stop === "function") {
        this.liveSources.add(n as AudioScheduledSourceNode);
      }
    }
    last.onended = () => {
      for (const n of nodes) {
        if ("stop" in n) this.liveSources.delete(n as AudioScheduledSourceNode);
        try { n.disconnect(); } catch { /* ignore */ }
      }
      // The synth open-hat parks its gain in ohatGain for choking — clear the
      // pointer when that gain was ours, or a later choke targets a
      // disconnected node and the REAL ringing hat never gets choked.
      for (const n of nodes) {
        if (n === this.ohatGain) this.ohatGain = null;
      }
    };
  }

  // ── voices ──

  private kick(t: number, v: number, dest: AudioNode = this.output): void {
    const ctx = this.ctx;
    const pol = v < 0 ? -1 : 1;
    const av = Math.abs(v);
    const polGain = ctx.createGain();
    polGain.gain.value = pol;
    // Body: deep sine pitch drop — longer sustain for club weight.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    g.gain.setValueAtTime(1.05 * av, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
    // Sub layer — fat bottom without raising the click.
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(32, t + 0.18);
    sg.gain.setValueAtTime(0.55 * av, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    // Short hard click (not hissy noise)
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = "triangle";
    click.frequency.setValueAtTime(2400, t);
    click.frequency.exponentialRampToValueAtTime(400, t + 0.018);
    cg.gain.setValueAtTime(0.28 * av, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    osc.connect(g).connect(polGain);
    sub.connect(sg).connect(polGain);
    click.connect(cg).connect(polGain);
    polGain.connect(dest);
    osc.start(t); osc.stop(t + 0.65);
    sub.start(t); sub.stop(t + 0.55);
    click.start(t); click.stop(t + 0.04);
    this.disposeOnEnd(osc, [osc, g, sub, sg, click, cg, polGain], dest);
  }

  private snare(t: number, v: number, dest: AudioNode = this.output): void {
    const ctx = this.ctx;
    // Body thud
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(210, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    bg.gain.setValueAtTime(0.55 * v, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    // Tone snap
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const og = ctx.createGain();
    o1.type = "triangle"; o1.frequency.value = 185;
    o2.type = "triangle"; o2.frequency.value = 330;
    og.gain.setValueAtTime(0.32 * v, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    // Rattle — bandpass, less harsh than pure HP
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 2800;
    nf.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    body.connect(bg).connect(dest);
    o1.connect(og); o2.connect(og); og.connect(dest);
    n.connect(nf).connect(ng).connect(dest);
    body.start(t); body.stop(t + 0.2);
    o1.start(t); o1.stop(t + 0.15);
    o2.start(t); o2.stop(t + 0.15);
    n.start(t); n.stop(t + 0.24);
    this.disposeOnEnd(n, [body, bg, o1, o2, og, n, nf, ng], dest);
  }

  private clap(t: number, v: number, dest: AudioNode = this.output): void {
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
      g.gain.setValueAtTime(0.85 * v, bt);
      g.gain.exponentialRampToValueAtTime(0.15 * v, bt + burst * 0.9);
    }
    g.gain.setValueAtTime(0.75 * v, t + 3 * burst);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3 * burst + 0.24);
    n.connect(f).connect(g).connect(dest);
    n.start(t); n.stop(t + 0.32);
    this.disposeOnEnd(n, [n, f, g], dest);
  }

  private hat(t: number, v: number, open: boolean, dest: AudioNode = this.output): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6200;
    // Mild metallic peak — not a sandpaper screech.
    const pk = ctx.createBiquadFilter();
    pk.type = "peaking";
    pk.frequency.value = 9000;
    pk.Q.value = 1.8;
    pk.gain.value = 4.5;
    const g = ctx.createGain();
    const dur = open ? 0.42 : 0.045;
    g.gain.setValueAtTime((open ? 0.42 : 0.4) * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (open) this.ohatGain = g;
    n.connect(hp).connect(pk).connect(g).connect(dest);
    n.start(t); n.stop(t + dur + 0.03);
    this.disposeOnEnd(n, [n, hp, pk, g], dest);
  }

  private tom(t: number, v: number, dest: AudioNode = this.output): void {
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
    osc.connect(g).connect(dest);
    n.connect(nf).connect(ng).connect(dest);
    osc.start(t); osc.stop(t + 0.4);
    n.start(t); n.stop(t + 0.1);
    this.disposeOnEnd(osc, [osc, g, n, nf, ng], dest);
  }

  private rim(t: number, v: number, dest: AudioNode = this.output): void {
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
    osc.connect(f).connect(g).connect(dest);
    osc.start(t); osc.stop(t + 0.06);
    this.disposeOnEnd(osc, [osc, f, g], dest);
  }

  private crash(t: number, v: number, dest: AudioNode = this.output): void {
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
    n.connect(hp).connect(shimmer).connect(g).connect(dest);
    n.start(t); n.stop(t + 1.5);
    this.disposeOnEnd(n, [n, hp, shimmer, g], dest);
  }
}
