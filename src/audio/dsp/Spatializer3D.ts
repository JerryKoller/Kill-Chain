/**
 * Spatializer3D — the audio engine behind the "3rd Dimension" feature.
 *
 * A bank of HRTF-panned "voices" placed around a single listener (the
 * character's ears = `AudioContext.listener`). Each voice taps one of a few
 * channel-derived buses (L / R / mono / decorrelated side / LFE), optionally
 * band-passes it (band mode), then runs through a 3D PannerNode so it is heard
 * from wherever it sits in the room. A size-scaled convolution reverb adds the
 * room ambience that makes the placement feel like a real space.
 *
 *   input(stereo) ─┬─ splitter ─ L/R/mono/side/sideInv/lfe buses
 *                  │      │
 *                  │      └─ voice[i]: bus → gain → [bandpass] → PannerNode ─┐
 *                  │                                                          │
 *                  └────────────────────────────────────── voiceBus ◄───────┘
 *                                       voiceBus → dry ───────────► output
 *                                       voiceBus → convolver → wet ► output
 *
 * Coordinate system (metres, listener at origin):
 *   +X = right, +Y = up (ceiling), -Z = in front of the listener.
 */

export type VoiceFeed = "left" | "right" | "mono" | "side" | "sideInv" | "lfe";

export interface VoiceSpec {
  id: string;
  feed: VoiceFeed;
  x: number;
  y: number;
  z: number;
  gainDb: number;
  /** When set, the voice is band-passed at this frequency (band mode). */
  bandHz?: number;
  bandQ?: number;
  /**
   * Proper crossover band (motion mode): Linkwitz-Riley 4th-order edges.
   * Unlike overlapping bandpasses, adjacent LR4 bands SUM FLAT — the split
   * is inaudible until the bands start moving. null = open on that side.
   */
  bandLoHz?: number | null;
  bandHiHz?: number | null;
  /** Anchored voices are pinned in place by the motion engine (solid bass). */
  anchor?: boolean;
}

// ── Motion mode (autonomous, audio-reactive movement) ─────────────────────

export type MotionPattern = "orbit" | "flyby" | "swarm" | "pendulum";

export interface MotionConfig {
  pattern: MotionPattern;
  /** 0..1 — base movement rate. */
  speed: number;
  /** 0..1 — how far / dramatic the movement is (radius, elevation swing). */
  intensity: number;
  /** 0..1 — how strongly the band's OWN energy drives it (louder → closer,
   *  faster; sharp onsets can launch fly-bys). */
  reactivity: number;
  /** 0..1 — how locked the bands are into one FORMATION. 1 = a single
   *  constellation rotating together (cohesive, musical), 0 = every band on
   *  its own trajectory (chaotic). */
  cohesion: number;
  /** Pin the low bands (sub/bass) dead centre — moving bass smears phase and
   *  wrecks the fundament; anchored lows are what make motion sound HI-FI. */
  anchorLows: boolean;
}

export interface MotionVoiceReadout {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Smoothed band energy 0..1 (drives the UI glow). */
  level: number;
}

interface MotionVoiceState {
  /** Band rank 0 (lowest) → N-1 (highest). */
  idx: number;
  theta: number;
  dir: 1 | -1;
  /** Free-running phase for pendulum/swarm wobble. */
  phase: number;
  energy: number;
  prevEnergy: number;
  /** Active fly-by pass, if any. */
  pass: { start: number; dur: number; fromTheta: number; dir: 1 | -1 } | null;
  lastPassEnd: number;
  x: number;
  y: number;
  z: number;
}

interface Voice {
  id: string;
  feed: VoiceFeed;
  gain: GainNode;
  filter: BiquadFilterNode | null;
  /** LR4 crossover chain (motion mode) — kept for disposal. */
  xover: BiquadFilterNode[];
  /** Sort key for motion ordering (crossover centre or bandpass freq). */
  bandKey: number;
  anchor: boolean;
  panner: PannerNode;
  analyser: AnalyserNode;
  levelBuf: Uint8Array<ArrayBuffer>;
  x: number;
  y: number;
  z: number;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Cheap deterministic noise for the procedural room impulse. */
function pseudoRand(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// ───── Physical constants / models shared with the UI so the numbers the
// user reads are exactly what the audio graph computes. ─────

export const SPEED_OF_SOUND_MPS = 343;
/** Average human head radius used by the Woodworth ITD model. */
const HEAD_RADIUS_M = 0.0875;
/** True inverse-distance law: unity at 1 m, −6 dB per doubling. */
const REF_DISTANCE_M = 1;
const ROLLOFF_FACTOR = 1;

/**
 * Linear gain of the PannerNode "inverse" distance model with our params.
 * Matches the Web Audio spec formula, so UI readouts agree with the audio.
 */
export function distanceGain(distanceM: number): number {
  const d = Math.max(REF_DISTANCE_M, distanceM);
  return REF_DISTANCE_M / (REF_DISTANCE_M + ROLLOFF_FACTOR * (d - REF_DISTANCE_M));
}

export function distanceGainDb(distanceM: number): number {
  return 20 * Math.log10(Math.max(1e-6, distanceGain(distanceM)));
}

/**
 * Approximate interaural time difference (seconds) for a source at the given
 * azimuth relative to the listener's facing (0 = ahead, + = right).
 * Woodworth spherical-head model: ITD = (a/c)·(θ + sin θ) on the lateral angle.
 */
export function itdSeconds(azimuthRad: number): number {
  const lateral = Math.asin(Math.max(-1, Math.min(1, Math.sin(azimuthRad))));
  return (HEAD_RADIUS_M / SPEED_OF_SOUND_MPS) * (lateral + Math.sin(lateral));
}

/**
 * Sabine reverberation time for a shoebox room:
 * RT60 = 0.161·V / (S·ᾱ), with V in m³, S the total surface area in m²
 * and ᾱ the average absorption coefficient of the surfaces.
 */
export function computeRT60(
  widthM: number,
  heightM: number,
  depthM: number,
  absorption: number,
): number {
  const volume = widthM * heightM * depthM;
  const surface = 2 * (widthM * heightM + heightM * depthM + widthM * depthM);
  const a = Math.max(0.02, Math.min(0.9, absorption));
  return (0.161 * volume) / (surface * a);
}

export class Spatializer3D {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: AudioContext;

  // Channel-derived buses fed from the stereo input.
  private readonly splitter: ChannelSplitterNode;
  private readonly leftBus: GainNode;
  private readonly rightBus: GainNode;
  private readonly monoBus: GainNode;
  private readonly sideBus: GainNode;
  private readonly sideInvBus: GainNode;
  private readonly lfeBus: GainNode;

  // Wet/dry summing to the binaural output.
  private readonly voiceBus: GainNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly roomConvolver: ConvolverNode;

  // Per-ear analysers on the binaural output (truthful L/R meters in the UI).
  private readonly earSplitter: ChannelSplitterNode;
  private readonly earLeft: AnalyserNode;
  private readonly earRight: AnalyserNode;
  private readonly earLeftBuf: Uint8Array<ArrayBuffer>;
  private readonly earRightBuf: Uint8Array<ArrayBuffer>;

  private readonly voices = new Map<string, Voice>();
  private room = { width: 6, height: 3, depth: 6 };
  private absorption = 0.28;
  private roomKey = "";
  /** Staging profile: physical room vs headphone-first near field. */
  private stage: "room" | "head" = "room";
  /** User space/wet scale — 0 bone dry … 1 double the computed room wet. */
  private space = 0.5;

  // Motion mode plumbing.
  private motionTimer: ReturnType<typeof setInterval> | null = null;
  private motionCfg: MotionConfig | null = null;
  private readonly motionState = new Map<string, MotionVoiceState>();
  private motionLastTick = 0;
  private formationTheta = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Split the stereo input into L (0) and R (1).
    this.splitter = ctx.createChannelSplitter(2);
    this.input.connect(this.splitter);
    this.leftBus = ctx.createGain();
    this.rightBus = ctx.createGain();
    this.splitter.connect(this.leftBus, 0);
    this.splitter.connect(this.rightBus, 1);

    // mono = 0.5L + 0.5R
    this.monoBus = ctx.createGain();
    const mL = ctx.createGain(); mL.gain.value = 0.5;
    const mR = ctx.createGain(); mR.gain.value = 0.5;
    this.leftBus.connect(mL).connect(this.monoBus);
    this.rightBus.connect(mR).connect(this.monoBus);

    // side = (0.5L - 0.5R), delayed slightly for decorrelation (surrounds).
    this.sideBus = ctx.createGain();
    const sL = ctx.createGain(); sL.gain.value = 0.5;
    const sR = ctx.createGain(); sR.gain.value = -0.5;
    const sideSum = ctx.createGain();
    this.leftBus.connect(sL).connect(sideSum);
    this.rightBus.connect(sR).connect(sideSum);
    const sideDelay = ctx.createDelay(0.05);
    sideDelay.delayTime.value = 0.012;
    sideSum.connect(sideDelay).connect(this.sideBus);

    // The opposite surround gets the inverted side signal.
    this.sideInvBus = ctx.createGain();
    const sideInv = ctx.createGain(); sideInv.gain.value = -1;
    this.sideBus.connect(sideInv).connect(this.sideInvBus);

    // lfe = mono → 120 Hz low-pass (subwoofer feed).
    this.lfeBus = ctx.createGain();
    const lfeLP = ctx.createBiquadFilter();
    lfeLP.type = "lowpass";
    lfeLP.frequency.value = 120;
    lfeLP.Q.value = 0.7;
    this.monoBus.connect(lfeLP).connect(this.lfeBus);

    // Wet/dry mix into the binaural output. The dry path is the direct,
    // localised sound; the convolver only adds a light room sense. Keeping it
    // mostly dry is what stops the defaults sounding muddy / washed out.
    this.voiceBus = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0.07;
    this.roomConvolver = ctx.createConvolver();
    this.voiceBus.connect(this.dryGain).connect(this.output);
    this.voiceBus.connect(this.roomConvolver).connect(this.wetGain).connect(this.output);
    // Distance-normalised makeup: the physical 1/d law makes far speakers
    // genuinely quiet, so overall loudness is normalised against the average
    // speaker distance (recomputeMakeup). Relative levels between speakers
    // stay physically correct; only the ensemble loudness is levelled so an
    // A/B against the flat stereo path is fair.
    this.output.gain.value = 1.25;

    this.earSplitter = ctx.createChannelSplitter(2);
    this.output.connect(this.earSplitter);
    this.earLeft = ctx.createAnalyser();
    this.earLeft.fftSize = 64;
    this.earRight = ctx.createAnalyser();
    this.earRight.fftSize = 64;
    this.earSplitter.connect(this.earLeft, 0);
    this.earSplitter.connect(this.earRight, 1);
    this.earLeftBuf = new Uint8Array(this.earLeft.fftSize) as Uint8Array<ArrayBuffer>;
    this.earRightBuf = new Uint8Array(this.earRight.fftSize) as Uint8Array<ArrayBuffer>;

    this.setRoom(this.room.width, this.room.height, this.room.depth, this.absorption);
    this.setListenerYaw(0);
  }

  private busFor(feed: VoiceFeed): GainNode {
    switch (feed) {
      case "left": return this.leftBus;
      case "right": return this.rightBus;
      case "mono": return this.monoBus;
      case "side": return this.sideBus;
      case "sideInv": return this.sideInvBus;
      case "lfe": return this.lfeBus;
    }
  }

  private makeVoice(spec: VoiceSpec): Voice {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(spec.gainDb);

    let filter: BiquadFilterNode | null = null;
    const xover: BiquadFilterNode[] = [];
    let head: AudioNode = gain;
    const hasXover = spec.bandLoHz !== undefined || spec.bandHiHz !== undefined;
    if (hasXover) {
      // Linkwitz-Riley 4th-order edges: two cascaded Butterworth (Q=1/√2)
      // biquads per side. Adjacent bands built this way sum acoustically
      // flat — no comb-filter smear when the split is stationary.
      const mk = (type: "highpass" | "lowpass", freq: number) => {
        for (let i = 0; i < 2; i++) {
          const f = ctx.createBiquadFilter();
          f.type = type;
          f.frequency.value = freq;
          f.Q.value = Math.SQRT1_2;
          head.connect(f);
          head = f;
          xover.push(f);
        }
      };
      if (spec.bandLoHz) mk("highpass", spec.bandLoHz);
      if (spec.bandHiHz) mk("lowpass", spec.bandHiHz);
    } else if (spec.bandHz && spec.bandHz > 0) {
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = spec.bandHz;
      filter.Q.value = spec.bandQ ?? 1;
      gain.connect(filter);
      head = filter;
    }

    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    // Physically correct inverse-distance law (−6 dB per doubling past 1 m).
    // The UI's dB-at-distance readout uses the same formula (distanceGain),
    // and overall loudness is handled by recomputeMakeup().
    panner.distanceModel = "inverse";
    panner.refDistance = REF_DISTANCE_M;
    panner.maxDistance = 100;
    panner.rolloffFactor = ROLLOFF_FACTOR;
    head.connect(panner);
    panner.connect(this.voiceBus);

    // Tiny analyser for the live level glow in the UI. Tapped post-filter so a
    // band-mode voice glows by its own frequency content, not the bus level.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32;
    head.connect(analyser);

    const bandKey = hasXover
      ? Math.sqrt((spec.bandLoHz ?? 20) * (spec.bandHiHz ?? 20000))
      : spec.bandHz ?? 0;

    const v: Voice = {
      id: spec.id,
      feed: spec.feed,
      gain,
      filter,
      xover,
      bandKey,
      anchor: spec.anchor === true,
      panner,
      analyser,
      levelBuf: new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>,
      x: spec.x,
      y: spec.y,
      z: spec.z,
    };
    this.busFor(spec.feed).connect(gain);
    this.applyPos(v, spec.x, spec.y, spec.z);
    return v;
  }

  private disposeVoice(v: Voice): void {
    try { this.busFor(v.feed).disconnect(v.gain); } catch { /* ignore */ }
    try { v.gain.disconnect(); } catch { /* ignore */ }
    try { v.filter?.disconnect(); } catch { /* ignore */ }
    for (const f of v.xover) {
      try { f.disconnect(); } catch { /* ignore */ }
    }
    try { v.panner.disconnect(); } catch { /* ignore */ }
    try { v.analyser.disconnect(); } catch { /* ignore */ }
  }

  private applyPos(v: Voice, x: number, y: number, z: number): void {
    v.x = x; v.y = y; v.z = z;
    const t = this.ctx.currentTime;
    v.panner.positionX.setTargetAtTime(x, t, 0.03);
    v.panner.positionY.setTargetAtTime(y, t, 0.03);
    v.panner.positionZ.setTargetAtTime(z, t, 0.03);
  }

  /**
   * Rebuild the voice bank, reusing nodes whose structure is unchanged so a
   * structural resync doesn't click. Voices not present in `specs` are removed.
   */
  setVoices(specs: VoiceSpec[]): void {
    const incoming = new Set(specs.map((s) => s.id));
    for (const [id, v] of this.voices) {
      if (!incoming.has(id)) {
        this.disposeVoice(v);
        this.voices.delete(id);
      }
    }
    const t = this.ctx.currentTime;
    for (const spec of specs) {
      const existing = this.voices.get(spec.id);
      const wantsXover = spec.bandLoHz !== undefined || spec.bandHiHz !== undefined;
      const sameShape =
        existing &&
        existing.feed === spec.feed &&
        (existing.xover.length > 0) === wantsXover &&
        !!existing.filter === (!wantsXover && !!(spec.bandHz && spec.bandHz > 0));
      if (existing && sameShape) {
        existing.gain.gain.setTargetAtTime(dbToGain(spec.gainDb), t, 0.03);
        if (existing.filter && spec.bandHz) {
          existing.filter.frequency.setTargetAtTime(spec.bandHz, t, 0.03);
          existing.filter.Q.setTargetAtTime(spec.bandQ ?? 1, t, 0.03);
          existing.bandKey = spec.bandHz;
        }
        existing.anchor = spec.anchor === true;
        this.applyPos(existing, spec.x, spec.y, spec.z);
      } else {
        if (existing) {
          this.disposeVoice(existing);
          this.voices.delete(spec.id);
        }
        this.voices.set(spec.id, this.makeVoice(spec));
      }
    }
    this.recomputeMakeup();
  }

  /**
   * Level the ensemble loudness against the average distance attenuation so
   * engaging 3D doesn't collapse in volume, while per-speaker relative levels
   * remain physically true to the 1/d law.
   */
  private recomputeMakeup(): void {
    let sum = 0;
    let count = 0;
    for (const v of this.voices.values()) {
      sum += distanceGain(Math.hypot(v.x, v.y, v.z));
      count++;
    }
    const avg = count > 0 ? sum / count : 1;
    const target = Math.max(1, Math.min(4, 1.25 / avg));
    this.output.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  /** Cheap live update for a single voice (drag handlers). */
  updateVoice(
    id: string,
    patch: { x?: number; y?: number; z?: number; gainDb?: number },
  ): void {
    const v = this.voices.get(id);
    if (!v) return;
    if (patch.gainDb !== undefined) {
      v.gain.gain.setTargetAtTime(dbToGain(patch.gainDb), this.ctx.currentTime, 0.03);
    }
    if (patch.x !== undefined || patch.y !== undefined || patch.z !== undefined) {
      this.applyPos(v, patch.x ?? v.x, patch.y ?? v.y, patch.z ?? v.z);
      this.recomputeMakeup();
    }
  }

  /** Per-voice output level in [0,1] for the live glow. */
  getVoiceLevels(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, v] of this.voices) {
      v.analyser.getByteTimeDomainData(v.levelBuf);
      let sum = 0;
      for (let i = 0; i < v.levelBuf.length; i++) {
        const s = (v.levelBuf[i] - 128) / 128;
        sum += s * s;
      }
      out[id] = Math.min(1, Math.sqrt(sum / v.levelBuf.length) * 3.2);
    }
    return out;
  }

  // ── Motion mode ──────────────────────────────────────────────────────────
  //
  // Autonomous, audio-reactive movement of the CURRENT voice bank around the
  // listener. Each voice (typically a frequency band) gets an orbit whose
  // radius, rate and elevation respond to that band's own energy: loud bands
  // press in close and speed up, quiet ones drift out wide; in "flyby"
  // pattern a sharp onset launches a fast pass right by the head — a truck
  // rolling past, a jet overhead, a synth line strafing the room.

  /** Start (or reconfigure) autonomous motion of the current voices. */
  startMotion(cfg: MotionConfig): void {
    this.motionCfg = { ...cfg };
    this.rebuildMotionStates();
    if (this.motionTimer === null) {
      this.motionLastTick = performance.now();
      this.motionTimer = setInterval(() => this.motionTick(), 33);
    }
  }

  /** Live-update the motion parameters without resetting phases. */
  setMotionConfig(cfg: MotionConfig): void {
    if (!this.motionCfg) {
      this.startMotion(cfg);
      return;
    }
    this.motionCfg = { ...cfg };
  }

  stopMotion(): void {
    if (this.motionTimer !== null) {
      clearInterval(this.motionTimer);
      this.motionTimer = null;
    }
    this.motionCfg = null;
    this.motionState.clear();
  }

  isMotionActive(): boolean {
    return this.motionCfg !== null;
  }

  /** Live positions + energies for the room canvas. */
  getMotionPositions(): MotionVoiceReadout[] {
    const out: MotionVoiceReadout[] = [];
    for (const [id, st] of this.motionState) {
      out.push({ id, x: st.x, y: st.y, z: st.z, level: st.energy });
    }
    return out;
  }

  /** (Re)build per-voice motion state from the current voice bank. */
  private rebuildMotionStates(): void {
    const ids = Array.from(this.voices.entries())
      .sort((a, b) => a[1].bandKey - b[1].bandKey)
      .map(([id]) => id);
    const keep = new Set(ids);
    for (const id of this.motionState.keys()) {
      if (!keep.has(id)) this.motionState.delete(id);
    }
    ids.forEach((id, idx) => {
      const existing = this.motionState.get(id);
      if (existing) {
        existing.idx = idx;
        return;
      }
      const v = this.voices.get(id)!;
      this.motionState.set(id, {
        idx,
        theta: Math.atan2(v.x, -v.z) || (idx / Math.max(1, ids.length)) * 2 * Math.PI,
        dir: idx % 2 === 0 ? 1 : -1,
        phase: idx * 1.7,
        energy: 0,
        prevEnergy: 0,
        pass: null,
        lastPassEnd: 0,
        x: v.x,
        y: v.y,
        z: v.z,
      });
    });
  }

  private motionTick(): void {
    const cfg = this.motionCfg;
    if (!cfg) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.motionLastTick) / 1000);
    this.motionLastTick = now;

    // Fresh voices may have appeared (structure resync) — track them.
    if (this.motionState.size !== this.voices.size) this.rebuildMotionStates();
    const n = Math.max(1, this.motionState.size);

    const levels = this.getVoiceLevels();
    const hy = this.room.height / 2;
    // Headphone Stage: an intimate near-field halo (max ~2.4 m) instead of
    // room-sized sweeps — closer sources image far more precisely on HRTF.
    const head = this.stage === "head";
    const maxR = head
      ? 2.4
      : Math.max(1.6, Math.min(this.room.width / 2, this.room.depth / 2) * 0.92);
    const minR = head ? 0.85 : 0.7;
    const t = this.ctx.currentTime;

    // The FORMATION: one shared rotation the bands can lock into. Cohesion
    // blends each band between its own trajectory and its formation slot —
    // at 1.0 the whole constellation turns as a single, musical unit.
    this.formationTheta += (0.1 + cfg.speed * 0.85) * dt;
    const cohesion = Math.max(0, Math.min(1, cfg.cohesion));

    let movingRank = 0;
    const movingTotal = Math.max(
      1,
      [...this.motionState.keys()].filter((id) => {
        const vv = this.voices.get(id);
        return vv && !(cfg.anchorLows && vv.anchor);
      }).length - 1,
    );

    for (const [id, st] of this.motionState) {
      const v = this.voices.get(id);
      if (!v) continue;

      // Smoothed band energy: fast attack, slow release (glow + reactivity).
      const raw = levels[id] ?? 0;
      st.prevEnergy = st.energy;
      st.energy = raw > st.energy ? st.energy + (raw - st.energy) * 0.5 : st.energy + (raw - st.energy) * 0.08;

      // SOLID BASS: anchored lows stay planted just ahead of the listener —
      // the fundament never smears, everything above it dances.
      if (cfg.anchorLows && v.anchor) {
        const ax = 0;
        const ay = -hy * 0.25;
        const az = -1.1;
        if (Math.abs(st.x - ax) > 1e-3 || Math.abs(st.z - az) > 1e-3 || Math.abs(st.y - ay) > 1e-3) {
          st.x = ax; st.y = ay; st.z = az;
          v.x = ax; v.y = ay; v.z = az;
          v.panner.positionX.setTargetAtTime(ax, t, 0.12);
          v.panner.positionY.setTargetAtTime(ay, t, 0.12);
          v.panner.positionZ.setTargetAtTime(az, t, 0.12);
        }
        continue;
      }

      // Rank among the MOVING bands (anchored ones don't consume formation
      // slots, so the constellation stays evenly spaced).
      const rank = movingRank++;
      const lift = movingTotal > 0 ? rank / movingTotal : 0.5; // 0 low → 1 high
      // Low bands move less than highs — big slow lows read as smear, quick
      // agile highs read as life.
      const agility = 0.45 + 0.55 * lift;

      // Base angular rate: each band gets its own speed & direction so the
      // field never phase-locks; energy accelerates it (reactivity-scaled).
      const omega =
        (0.12 + cfg.speed * 1.15) *
        (0.5 + 0.18 * rank) * agility *
        (1 + st.energy * cfg.reactivity * 1.8) *
        st.dir;

      // Radius: quiet bands sit out wide, loud bands press in close.
      const baseR = maxR * (0.85 - 0.15 * cfg.intensity);
      let r = baseR * (1 - 0.6 * st.energy * cfg.reactivity * agility);

      // Elevation: frequency = height (lows low, air overhead), with a slow
      // intensity-scaled bob so nothing sits perfectly still.
      const yRange = head ? Math.min(hy, 1.1) : hy;
      let y =
        yRange * ((lift - 0.35) * 1.1) * (0.35 + 0.65 * cfg.intensity) +
        Math.sin(st.phase * 0.6 + rank) * 0.25 * cfg.intensity * yRange * agility;

      st.phase += dt * (0.7 + cfg.speed * 1.6) * (1 + st.energy * cfg.reactivity) * agility;

      let theta = st.theta;
      switch (cfg.pattern) {
        case "orbit": {
          theta += omega * dt;
          break;
        }
        case "pendulum": {
          // Swing across the front stage; lows swing wide & slow, highs
          // tight & quick. theta here is driven by phase, not integrated.
          const width = (0.6 + cfg.intensity * 1.15) * (1.25 - 0.09 * rank);
          theta = Math.sin(st.phase * (0.5 + 0.13 * rank)) * width + (rank % 2 ? Math.PI : 0);
          break;
        }
        case "swarm": {
          theta += omega * dt;
          theta += Math.sin(st.phase * 1.7 + rank * 2.1) * 0.02 * (1 + cfg.intensity * 2);
          r *= 0.75 + 0.25 * Math.sin(st.phase * 1.13 + rank);
          y += Math.sin(st.phase * 0.9 + rank * 1.3) * 0.28 * cfg.intensity * yRange;
          break;
        }
        case "flyby": {
          // Gentle drift until an onset launches a pass right by the head.
          const onset = st.energy - st.prevEnergy;
          const canPass =
            st.pass === null &&
            now - st.lastPassEnd > 2600 &&
            st.energy > 0.22 &&
            onset > 0.1 + (1 - cfg.reactivity) * 0.22;
          if (canPass) {
            st.pass = {
              start: now,
              dur: 1500 - cfg.speed * 600,
              fromTheta: theta,
              dir: st.dir,
            };
          }
          if (st.pass) {
            const k = (now - st.pass.start) / st.pass.dur;
            if (k >= 1) {
              st.theta = st.pass.fromTheta + Math.PI * st.pass.dir;
              theta = st.theta;
              st.lastPassEnd = now;
              st.pass = null;
            } else {
              // Sweep half a turn while the radius dives in and back out —
              // the classic drive-by. Ease the sweep for a natural feel.
              const ease = k * k * (3 - 2 * k);
              theta = st.pass.fromTheta + Math.PI * st.pass.dir * ease;
              const dive = 1 - Math.pow(2 * k - 1, 2); // 0→1→0
              r = baseR - (baseR - Math.max(minR, 0.75)) * dive;
            }
          } else {
            theta += omega * 0.4 * dt;
          }
          break;
        }
      }
      if (cfg.pattern !== "pendulum") st.theta = theta;

      // Cohesion: pull the band toward its slot in the shared formation.
      // Fly-by passes stay exempt — a drive-by must complete its arc.
      if (cohesion > 0 && !(cfg.pattern === "flyby" && st.pass)) {
        const slot =
          cfg.pattern === "pendulum"
            ? Math.sin(this.formationTheta * 2.2) * (0.7 + cfg.intensity) + (rank % 2 ? Math.PI : 0)
            : this.formationTheta * (st.dir >= 0 ? 1 : -1) + (rank / (movingTotal + 1)) * 2 * Math.PI;
        // Blend on the unit circle so ±π wrap-arounds don't spin the voice.
        const bx = Math.sin(theta) * (1 - cohesion) + Math.sin(slot) * cohesion;
        const bz = -Math.cos(theta) * (1 - cohesion) - Math.cos(slot) * cohesion;
        theta = Math.atan2(bx, -bz);
        if (cfg.pattern !== "pendulum") st.theta = theta;
      }

      r = Math.max(minR, Math.min(maxR, r));
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;
      y = Math.max(-yRange * 0.9, Math.min(yRange * 0.9, y));

      st.x = x;
      st.y = y;
      st.z = z;
      v.x = x;
      v.y = y;
      v.z = z;
      // Slightly slower smoothing than a drag — glides, never zippers.
      v.panner.positionX.setTargetAtTime(x, t, 0.055);
      v.panner.positionY.setTargetAtTime(y, t, 0.08);
      v.panner.positionZ.setTargetAtTime(z, t, 0.055);
    }
  }

  /** Aim the listener (the character's facing direction) by yaw in radians. */
  setListenerYaw(yaw: number): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    const fx = Math.sin(yaw);
    const fz = -Math.cos(yaw);
    // Smoothed so dragging the facing slider is zipper/click-free.
    l.positionX.setTargetAtTime(0, t, 0.03);
    l.positionY.setTargetAtTime(0, t, 0.03);
    l.positionZ.setTargetAtTime(0, t, 0.03);
    l.forwardX.setTargetAtTime(fx, t, 0.03);
    l.forwardY.setTargetAtTime(0, t, 0.03);
    l.forwardZ.setTargetAtTime(fz, t, 0.03);
    l.upX.setTargetAtTime(0, t, 0.03);
    l.upY.setTargetAtTime(1, t, 0.03);
    l.upZ.setTargetAtTime(0, t, 0.03);
  }

  /** RMS level per ear in [0,1] straight off the binaural output. */
  getEarLevels(): { left: number; right: number } {
    const rms = (a: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number => {
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = (buf[i] - 128) / 128;
        sum += s * s;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
    };
    return {
      left: rms(this.earLeft, this.earLeftBuf),
      right: rms(this.earRight, this.earRightBuf),
    };
  }

  /**
   * Room dimensions in metres plus the average wall absorption coefficient
   * (0.05 ≈ bare concrete/glass … 0.6 ≈ heavily treated studio). Drives the
   * geometry-derived early reflections, Sabine RT60 tail and wet amount.
   */
  setRoom(width: number, height: number, depth: number, absorption?: number): void {
    this.room = { width, height, depth };
    if (absorption !== undefined) {
      this.absorption = Math.max(0.02, Math.min(0.9, absorption));
    }
    const key =
      `${width.toFixed(1)}x${height.toFixed(1)}x${depth.toFixed(1)}` +
      `@${this.absorption.toFixed(2)}`;
    if (key !== this.roomKey) {
      this.roomKey = key;
      this.roomConvolver.buffer = this.synthRoomIR();
    }
    this.updateWet();
  }

  /**
   * Wet level tracks the actual reverberance of the room (dead studio stays
   * dry, live hall blooms), scaled by the user's Space control and pulled
   * WAY down in Headphone Stage — near-field intimacy wants direct sound.
   */
  private updateWet(): void {
    const rt60 = Math.min(
      2.5,
      computeRT60(this.room.width, this.room.height, this.room.depth, this.absorption),
    );
    const base = Math.max(0.04, Math.min(0.3, 0.04 + rt60 * 0.11));
    const stageScale = this.stage === "head" ? 0.35 : 1;
    const wet = base * (this.space * 2) * stageScale;
    this.wetGain.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.1);
  }

  /** Room Stage (physical placement) vs Headphone Stage (near-field). */
  setStageProfile(stage: "room" | "head"): void {
    if (stage === this.stage) return;
    this.stage = stage;
    this.updateWet();
  }

  getStageProfile(): "room" | "head" {
    return this.stage;
  }

  /** User space/ambience amount (0 = dry, 0.5 = physical, 1 = lush). */
  setSpace(amount: number): void {
    this.space = Math.max(0, Math.min(1, amount));
    this.updateWet();
  }

  /** Current RT60 in seconds (Sabine) for the configured room. */
  getRT60(): number {
    return computeRT60(this.room.width, this.room.height, this.room.depth, this.absorption);
  }

  /**
   * Stereo room impulse computed from the actual geometry:
   *  - 1st/2nd-order early reflections off the six surfaces, delayed by the
   *    real round-trip path (2·d/c per bounce from the room centre) and
   *    attenuated by the wall reflectivity √(1−ᾱ) per bounce plus 1/r
   *    spreading over the path length.
   *  - Lateral (side-wall) taps are ear-weighted so width reads binaurally.
   *  - Diffuse tail with exponential decay whose time constant comes from
   *    Sabine RT60 (τ = RT60/6.91, since −60 dB = e^{−6.91}).
   */
  private synthRoomIR(): AudioBuffer {
    const sr = this.ctx.sampleRate || 48000;
    const { width, height, depth } = this.room;
    const alpha = this.absorption;
    const rt60 = Math.min(2.5, computeRT60(width, height, depth, alpha));
    const decayTau = rt60 / 6.91;
    const lengthSec = Math.max(0.12, Math.min(1.8, rt60));
    const n = Math.floor(sr * lengthSec);
    const buf = this.ctx.createBuffer(2, n, sr);

    // Wall reflectivity (amplitude): ᾱ is an energy coefficient.
    const refl = Math.sqrt(Math.max(0, 1 - alpha));
    // Six surfaces, distances from the listener at the room centre.
    // side: -1 = left wall, +1 = right wall, 0 = floor/ceiling/front/back.
    const surfaces = [
      { d: width / 2, side: -1 },
      { d: width / 2, side: 1 },
      { d: height / 2, side: 0 },
      { d: height / 2, side: 0 },
      { d: depth / 2, side: 0 },
      { d: depth / 2, side: 0 },
    ];

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);

      surfaces.forEach((s, i) => {
        for (let order = 1; order <= 2; order++) {
          const pathM = 2 * s.d * order;
          const at = Math.floor((pathM / SPEED_OF_SOUND_MPS) * sr);
          if (at >= n) continue;
          let amp = Math.pow(refl, order) / (1 + pathM);
          if (s.side !== 0) {
            // Same-side ear hears the lateral reflection nearly full,
            // opposite ear is head-shadowed.
            const nearEar = (s.side === -1) === (ch === 0);
            amp *= nearEar ? 1 : 0.45;
          } else {
            // Slight per-ear decorrelation for non-lateral surfaces.
            amp *= 0.8 + 0.2 * pseudoRand(i * 7 + ch * 13);
          }
          const sign = (i + order + ch) % 2 === 0 ? 1 : -1;
          data[at] += sign * amp;
        }
      });

      // Diffuse tail starts roughly when the first reflection arrives.
      const nearestWall = Math.min(width, height, depth) / 2;
      const tailStart = Math.floor(((2 * nearestWall) / SPEED_OF_SOUND_MPS) * sr);
      const tailLevel = 0.1 * refl;
      let prev = 0;
      for (let i = tailStart; i < n; i++) {
        const env = Math.exp(-i / (sr * decayTau));
        const noise = pseudoRand(i + (ch === 0 ? 1 : 23)) * 2 - 1;
        // One-pole LP (~0.35 coefficient) darkens the diffuse tail.
        prev = prev * 0.35 + noise * 0.65;
        data[i] += prev * env * tailLevel;
      }
    }
    return buf;
  }
}
