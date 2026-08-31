/**
 * LoFiDeck — magnetic-tape degradation: bandwidth loss (age), pitch wobble
 * (wow & flutter), and hiss/crackle (wear).
 *
 * CRITICAL: at neutral (age = wear = wowFlutter = 0) the deck is a
 * bit-transparent dry wire. The tone-shaping path (HPF → LPF → modulated
 * delay) is only spliced into the signal when age or wowFlutter is dialed
 * up, so it never adds the always-on ~50 ms latency / filtering that used to
 * colour the whole chain. The hiss is a parallel additive source gated to
 * silence at wear = 0.
 */
export class LoFiDeck {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly lpf: BiquadFilterNode;
  private readonly hpf: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly wowLfo: OscillatorNode;
  private readonly flutterLfo: OscillatorNode;
  private readonly wowGain: GainNode;
  private readonly flutterGain: GainNode;

  private readonly noiseGain: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;

  private age = 0;
  private wear = 0;
  private wowFlutter = 0;
  /** Whether the tone path is currently spliced in (vs. direct dry wire). */
  private toneActive = false;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.lpf = ctx.createBiquadFilter();
    this.lpf.type = "lowpass";
    this.lpf.frequency.value = 20000;
    this.lpf.Q.value = 0.5;

    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = "highpass";
    this.hpf.frequency.value = 20;
    this.hpf.Q.value = 0.5;

    this.delay = ctx.createDelay(0.1);
    // Base delay must exceed the worst-case LFO swing (±5 ms at full
    // wow+flutter). Modulating around 0 meant the negative half of every
    // cycle clamped at 0 s — half-rectified warble with audible ticks.
    // 6 ms of fixed latency only exists while the tone path is spliced in.
    this.delay.delayTime.value = 0.006;

    this.wowLfo = ctx.createOscillator();
    this.wowLfo.type = "sine";
    this.wowLfo.frequency.value = 0.5;
    this.wowGain = ctx.createGain();
    this.wowGain.gain.value = 0;

    this.flutterLfo = ctx.createOscillator();
    this.flutterLfo.type = "sine";
    this.flutterLfo.frequency.value = 5.0;
    this.flutterGain = ctx.createGain();
    this.flutterGain.gain.value = 0;

    this.wowLfo.connect(this.wowGain).connect(this.delay.delayTime);
    this.flutterLfo.connect(this.flutterGain).connect(this.delay.delayTime);
    this.wowLfo.start();
    this.flutterLfo.start();

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseGain.connect(this.output);

    // Internal tone path graph (not yet wired into input/output).
    this.hpf.connect(this.lpf);
    this.lpf.connect(this.delay);

    // Neutral: clean dry wire.
    this.input.connect(this.output);
  }

  /** Lazily create + start the hiss source only when first needed. */
  private ensureNoise(): void {
    if (this.noiseSource) return;
    const sr = this.ctx.sampleRate;
    const len = sr * 2;
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      const crackle = Math.random() < 0.001 ? (Math.random() * 2 - 1) * 3 : 0;
      data[i] = white * 0.1 + crackle;
    }
    this.noiseBuffer = buf;
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start();
  }

  /** Splice the tone path in or out so neutral stays a clean wire. */
  private setToneActive(active: boolean): void {
    if (active === this.toneActive) return;
    this.toneActive = active;
    try { this.input.disconnect(this.output); } catch { /* ignore */ }
    try { this.input.disconnect(this.hpf); } catch { /* ignore */ }
    try { this.delay.disconnect(this.output); } catch { /* ignore */ }
    if (active) {
      this.input.connect(this.hpf);
      this.delay.connect(this.output);
    } else {
      this.input.connect(this.output);
    }
  }

  private refreshToneActive(): void {
    this.setToneActive(this.age > 0 || this.wowFlutter > 0);
  }

  setAge(amount: number) {
    if (amount === this.age) return;
    this.age = Math.max(0, Math.min(1, amount));
    const t = this.ctx.currentTime;
    const lpfFreq = 20000 * Math.pow(0.1, this.age);
    const hpfFreq = 20 + this.age * 380;
    this.lpf.frequency.setTargetAtTime(lpfFreq, t, 0.05);
    this.hpf.frequency.setTargetAtTime(hpfFreq, t, 0.05);
    this.refreshToneActive();
  }

  setWowFlutter(amount: number) {
    if (amount === this.wowFlutter) return;
    this.wowFlutter = Math.max(0, Math.min(1, amount));
    const t = this.ctx.currentTime;
    this.wowGain.gain.setTargetAtTime(this.wowFlutter * 0.004, t, 0.05);
    this.flutterGain.gain.setTargetAtTime(this.wowFlutter * 0.001, t, 0.05);
    this.refreshToneActive();
  }

  setWear(amount: number) {
    if (amount === this.wear) return;
    this.wear = Math.max(0, Math.min(1, amount));
    if (this.wear > 0) this.ensureNoise();
    const t = this.ctx.currentTime;
    this.noiseGain.gain.setTargetAtTime(this.wear * 0.03, t, 0.05);
  }
}
