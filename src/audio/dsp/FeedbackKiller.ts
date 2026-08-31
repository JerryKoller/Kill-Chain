/**
 * FeedbackKiller — three-layer real-time feedback suppression for the
 * Exterior-Audio (system loopback) flow.
 *
 * Problem: on a single audio device, Windows loopback captures everything
 * coming out of the speakers — including this app's own processed output.
 * Even at low gain the loop slowly builds into a screech at whatever
 * frequency has the highest combined loop gain (typically 1–4 kHz where
 * EQ peaks, room/headphone resonances, and DSP coloration stack up).
 *
 * Defenses (all active simultaneously when on):
 *
 *   1. Frequency-disrupting vibrato.
 *      A ~4.7 Hz LFO modulates a ±1.5 ms delay. This continuously
 *      detunes the captured signal. A feedback loop needs the signal
 *      to return at exactly the same frequency to build a resonance;
 *      with a moving phase/freq target, the loop can't lock in.
 *      Live-sound engineers use the same trick (called "feedback
 *      destabilization") on monitor mixes.
 *
 *   2. Adaptive notch bank.
 *      Five notch filters track the loudest persistent peaks in the
 *      post-output spectrum. When a frequency is rising and dominant
 *      for ~300 ms, a notch is parked there and SLOWLY released. This
 *      surgically kills incipient ringing without dulling the music.
 *
 *   3. Auto-ducker.
 *      Tracks short-term RMS of the post-fx signal. If RMS keeps
 *      climbing for >250 ms while the *input* RMS isn't climbing, that's
 *      feedback build-up — drop the input gain by 24 dB for 0.8 s, then
 *      smoothly recover. Worst-case stops a screech in under half a
 *      second.
 */
export class FeedbackKiller {
  readonly input: GainNode;
  readonly output: GainNode;

  private ctx: BaseAudioContext;
  private delay: DelayNode;
  private lfoOsc: OscillatorNode;
  private lfoGain: GainNode;
  private notches: BiquadFilterNode[];
  private ducker: GainNode;
  private active = false;

  // Adaptive analysis
  private postAnalyser: AnalyserNode;
  private inputAnalyser: AnalyserNode;
  private freqBuf: Uint8Array<ArrayBuffer>;
  private inFreqBuf: Uint8Array<ArrayBuffer>;
  /**
   * Per-notch tracking. We record the recent loudest peak in each "spectrum
   * slot". A notch engages when a peak hovers within ±35 Hz of a moving
   * average for >220 ms (musical notes move around, feedback locks in).
   */
  private notchState: {
    targetHz: number;
    holdMs: number;
    lastSeenMs: number;
    history: { hz: number; mag: number }[];
  }[];
  private rmsHistoryOut: number[] = [];
  private rmsHistoryIn: number[] = [];
  private duckUntil = 0;
  private rafId = 0;
  private lastTickMs = 0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.delay = ctx.createDelay(0.05);
    this.delay.delayTime.value = 0.005; // 5ms baseline

    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = "sine";
    this.lfoOsc.frequency.value = 4.7;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0; // off when bypassed
    this.lfoOsc.connect(this.lfoGain);
    this.lfoGain.connect(this.delay.delayTime);
    try { this.lfoOsc.start(); } catch { /* already started */ }

    // 5 adaptive cut filters at musically-spaced startup positions — they'll
    // be re-tuned dynamically by the analyser tick.
    //
    // TYPE MATTERS: BiquadFilter "notch" IGNORES its gain param — a notch is
    // always fully carved at its Q. The old code used type:"notch" and drove
    // depth via gain, so all five filters sat permanently engaged (hollow,
    // phasey Exterior Audio) and "release" did nothing. "peaking" honours
    // gain: 0 dB = bit-transparent, negative dB = surgical cut, and the
    // release ramp back to 0 dB genuinely restores flat response.
    this.notches = [800, 1500, 2500, 4000, 6500].map((freq) => {
      const n = ctx.createBiquadFilter();
      n.type = "peaking";
      n.Q.value = 12;
      n.frequency.value = freq;
      n.gain.value = 0;
      return n;
    });

    this.ducker = ctx.createGain();
    this.ducker.gain.value = 1.0;

    this.postAnalyser = ctx.createAnalyser();
    this.postAnalyser.fftSize = 2048;
    this.postAnalyser.smoothingTimeConstant = 0.6;

    this.inputAnalyser = ctx.createAnalyser();
    this.inputAnalyser.fftSize = 2048;
    this.inputAnalyser.smoothingTimeConstant = 0.6;

    this.freqBuf = new Uint8Array(this.postAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    this.inFreqBuf = new Uint8Array(this.inputAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    this.notchState = this.notches.map(() => ({
      targetHz: 0,
      holdMs: 0,
      lastSeenMs: 0,
      history: [],
    }));

    this.wireBypass();
  }

  private wireBypass(): void {
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this.delay.disconnect(); } catch { /* ignore */ }
    this.notches.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
    try { this.ducker.disconnect(); } catch { /* ignore */ }
    // Pass-through: input → output, no modulation, no notches.
    this.input.connect(this.output);
  }

  private wireActive(): void {
    try { this.input.disconnect(); } catch { /* ignore */ }
    this.input.connect(this.ducker);
    this.ducker.connect(this.inputAnalyser); // measure pre-FB signal
    this.ducker.connect(this.delay);
    // Chain through notches
    let prev: AudioNode = this.delay;
    for (const n of this.notches) {
      prev.connect(n);
      prev = n;
    }
    prev.connect(this.output);
    // Tap the post-output stream for peak detection
    this.output.connect(this.postAnalyser);
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;

    if (on) {
      this.wireActive();
      // Ramp up vibrato gently to avoid a "wow" artifact.
      const t = this.ctx.currentTime;
      this.lfoGain.gain.cancelScheduledValues(t);
      this.lfoGain.gain.setTargetAtTime(0.0015, t, 0.2); // ±1.5ms
      this.ducker.gain.cancelScheduledValues(t);
      this.ducker.gain.setTargetAtTime(1.0, t, 0.05);
      // Reset notch state
      this.notchState = this.notches.map(() => ({
        targetHz: 0,
        holdMs: 0,
        lastSeenMs: 0,
        history: [],
      }));
      for (const n of this.notches) {
        n.gain.value = 0;
      }
      // Always (re)start analysis — a prior tick throw could leave rafId
      // non-zero while the loop is dead, which used to skip restart and leave
      // Exterior audio unprotected (feedback builds → sudden screech).
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.lastTickMs = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      // Ramp vibrato down then unwire.
      const t = this.ctx.currentTime;
      this.lfoGain.gain.cancelScheduledValues(t);
      this.lfoGain.gain.setTargetAtTime(0, t, 0.05);
      this.ducker.gain.cancelScheduledValues(t);
      this.ducker.gain.setTargetAtTime(1, t, 0.05);
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.wireBypass();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** Adaptive analysis loop — runs at the requestAnimationFrame rate (~60 Hz). */
  private tick = (): void => {
    if (!this.active) {
      this.rafId = 0;
      return;
    }

    try {
      this.runTickBody();
    } catch (err) {
      console.warn("[FeedbackKiller] analysis tick failed — will retry:", err);
    } finally {
      if (this.active) {
        this.rafId = requestAnimationFrame(this.tick);
      } else {
        this.rafId = 0;
      }
    }
  };

  private runTickBody(): void {
    const now = performance.now();
    const dt = now - this.lastTickMs;
    this.lastTickMs = now;

    this.postAnalyser.getByteFrequencyData(this.freqBuf);
    this.inputAnalyser.getByteFrequencyData(this.inFreqBuf);

    const nyq = (this.ctx as AudioContext).sampleRate / 2;
    const N = this.freqBuf.length;
    const binToHz = (i: number) => (i / N) * nyq;

    // -------- (a) Peak finding
    // Walk the spectrum, collect local maxima above a noise floor.
    // We only care about 200 Hz – 12 kHz where acoustic feedback lives.
    const peaks: { hz: number; mag: number; bin: number }[] = [];
    const minBin = Math.floor((200 / nyq) * N);
    const maxBin = Math.floor((12000 / nyq) * N);
    for (let i = minBin + 2; i < maxBin - 2; i++) {
      const v = this.freqBuf[i];
      if (v < 115) continue; // ~ -47 dBFS noise floor
      if (
        v > this.freqBuf[i - 1] &&
        v > this.freqBuf[i + 1] &&
        v >= this.freqBuf[i - 2] &&
        v >= this.freqBuf[i + 2]
      ) {
        peaks.push({ hz: binToHz(i), mag: v, bin: i });
      }
    }
    peaks.sort((a, b) => b.mag - a.mag);
    const topPeaks = peaks.slice(0, 10); // pool to assign to notch slots

    // -------- (b) Stability-based notch tracking
    // Musical tones MOVE (notes change in melody). Feedback tones LOCK IN.
    // For each notch slot, check whether any of the current top peaks is
    // within ±35 Hz of the slot's targetHz. If yes, accumulate hold time.
    // When holdMs exceeds 220 ms, the slot is confident it's feedback and
    // engages the notch. If the peak drifts away, holdMs resets.
    const STABILITY_HZ = 35;
    const ENGAGE_MS = 220;
    const RELEASE_DELAY_MS = 1500;
    const t = this.ctx.currentTime;

    for (let i = 0; i < this.notches.length; i++) {
      const slot = this.notchState[i];

      // If no target yet, take the loudest unclaimed peak.
      if (slot.targetHz === 0 && topPeaks.length > 0) {
        // Claim the loudest peak NOT already claimed by another notch slot.
        const claimed = (hz: number) =>
          this.notchState.some(
            (s) => s !== slot && s.targetHz > 0 && Math.abs(s.targetHz - hz) < STABILITY_HZ * 2,
          );
        const claim = topPeaks.find((p) => !claimed(p.hz));
        if (claim) {
          slot.targetHz = claim.hz;
          slot.lastSeenMs = now;
          slot.holdMs = 0;
        }
      }

      // Try to re-find our target in current peaks.
      const match = slot.targetHz > 0
        ? topPeaks.find((p) => Math.abs(p.hz - slot.targetHz) < STABILITY_HZ)
        : undefined;

      if (match) {
        // Smoothly drift the target toward the matched peak (in case of
        // slow pitch wobble).
        slot.targetHz = slot.targetHz * 0.85 + match.hz * 0.15;
        slot.holdMs += dt;
        slot.lastSeenMs = now;

        if (slot.holdMs >= ENGAGE_MS) {
          // Engage / refresh the notch.
          this.notches[i].frequency.setTargetAtTime(slot.targetHz, t, 0.01);
          this.notches[i].Q.setTargetAtTime(20, t, 0.05);
          // The longer it has held, the deeper the cut: ~-7 dB at first
          // confirmation ramping to -24 dB for a locked-in squeal (peaking
          // gain is in real dB, so depth 0..1 scales a 24 dB range).
          const depth = Math.min(1, (slot.holdMs - ENGAGE_MS) / 600 + 0.3);
          this.notches[i].gain.setTargetAtTime(-depth * 24, t, 0.04);
        }
      } else {
        // Peak gone. Hold the notch briefly in case it returns, then release.
        if (now - slot.lastSeenMs > RELEASE_DELAY_MS) {
          slot.targetHz = 0;
          slot.holdMs = 0;
          this.notches[i].gain.setTargetAtTime(0, t, 0.6);
        }
      }
    }

    // -------- (c) Auto-ducker — detect runaway RMS
    let postSum = 0;
    let inSum = 0;
    for (let i = 0; i < N; i++) {
      postSum += this.freqBuf[i];
      inSum += this.inFreqBuf[i];
    }
    const postRms = postSum / N;
    const inRms = inSum / N;

    this.rmsHistoryOut.push(postRms);
    this.rmsHistoryIn.push(inRms);
    if (this.rmsHistoryOut.length > 30) this.rmsHistoryOut.shift();
    if (this.rmsHistoryIn.length > 30) this.rmsHistoryIn.shift();

    if (this.rmsHistoryOut.length >= 15) {
      const recentOut = this.rmsHistoryOut.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const priorOut = this.rmsHistoryOut.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
      const recentIn = this.rmsHistoryIn.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const priorIn = this.rmsHistoryIn.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;

      const outDelta = recentOut - priorOut;
      const inDelta = recentIn - priorIn;

      // Output rising fast AND input not rising proportionally → feedback.
      // Or: output is just very loud (above ~140 byte ≈ -25 dBFS post-FK)
      // AND continued rising at all → duck.
      const screech =
        (outDelta > 15 && inDelta < outDelta * 0.5 && recentOut > 130) ||
        (recentOut > 165 && outDelta > 5);

      if (screech && now > this.duckUntil) {
        this.ducker.gain.cancelScheduledValues(t);
        this.ducker.gain.setValueAtTime(this.ducker.gain.value, t);
        this.ducker.gain.linearRampToValueAtTime(0.04, t + 0.015); // -28 dB in 15ms
        // Recover slower-hold then rise — old 1.4s ramp-to-unity let rings rebuild.
        this.ducker.gain.linearRampToValueAtTime(0.04, t + 0.45);
        this.ducker.gain.linearRampToValueAtTime(1.0, t + 1.1);
        this.duckUntil = now + 1100;
        // Force-engage all notches at strong peaks to nuke the resonances.
        for (let i = 0; i < this.notches.length && i < topPeaks.length; i++) {
          const p = topPeaks[i];
          this.notchState[i].targetHz = p.hz;
          this.notchState[i].holdMs = ENGAGE_MS + 100;
          this.notchState[i].lastSeenMs = now;
          this.notches[i].frequency.setTargetAtTime(p.hz, t, 0.005);
          this.notches[i].Q.setTargetAtTime(22, t, 0.02);
          this.notches[i].gain.setTargetAtTime(-24, t, 0.02);
        }
      }
    }
  }

  dispose(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    try { this.lfoOsc.stop(); } catch { /* ignore */ }
    try { this.lfoOsc.disconnect(); } catch { /* ignore */ }
    try { this.lfoGain.disconnect(); } catch { /* ignore */ }
    try { this.delay.disconnect(); } catch { /* ignore */ }
    this.notches.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
    try { this.ducker.disconnect(); } catch { /* ignore */ }
    try { this.postAnalyser.disconnect(); } catch { /* ignore */ }
    try { this.inputAnalyser.disconnect(); } catch { /* ignore */ }
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this.output.disconnect(); } catch { /* ignore */ }
  }
}
