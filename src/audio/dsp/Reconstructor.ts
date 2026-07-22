/**
 * Reconstructor — the Sculptor's RESTORATION BAY.
 *
 * Rebuilds damaged / low-bitrate audio (240p YouTube rips, old uploads,
 * crushed encodes) in realtime with stock Web Audio nodes:
 *
 *   HF REBUILD ("upscale")  Lossy encodes brickwall the top end — bad ones
 *     as low as 4-6 kHz. True recovery is impossible, but the missing
 *     octaves are STRONGLY correlated with what survived below them. A
 *     TWO-STAGE harmonic ladder climbs back up:
 *       stage P: 1.2-3.5 kHz → harmonics → 3.5-8 kHz   (presence regen)
 *       stage A: (input + stage P) 3.5-7.5 kHz → harmonics → 7.5-16.5 kHz
 *     Because stage A eats stage P's output, even a source cut at 4 kHz
 *     climbs the whole ladder to a plausible "best guess HD" top octave.
 *
 *   BODY REBUILD  Thin, tinny rips lose low-end density. The 60-200 Hz
 *     band is saturated (adds harmonic thickness) and mixed back under the
 *     dry signal, restoring perceived weight without a boomy EQ shelf.
 *
 *   DE-CRUNCH  Codec crunch and clipping harshness live in 2.5-6 kHz. A
 *     dynamic peaking cut (sidechain-driven, like a wide de-esser) ducks
 *     that band only when it flares, leaving clean moments untouched.
 *
 *   HISS TAMER  A dynamic high shelf that closes on the noise floor: when
 *     the top octave carries only hiss (low + steady), it shelves down;
 *     when real content (cymbals, air) arrives, it opens back up.
 *
 * v2 additions (each its own module, wired around the core):
 *
 *   DE-CLICK  (DeClicker, FIRST in the chain so spikes never reach the
 *     harmonic ladders) — adaptive transient clamp for pops and crackle.
 *   DE-HUM  (DeHummer, after de-click) — 50/60 Hz notch ladder with
 *     auto-detection of the mains frequency.
 *   WIDEN  (PseudoStereo, LAST) — synthesized stereo for mono uploads.
 *
 * All amounts are 0..1; at 0 the module is a transparent wire (dry gain 1,
 * all wet paths silent, no timers running).
 */

import { DeHummer } from "./DeHummer";
import { DeClicker } from "./DeClicker";
import { PseudoStereo } from "./PseudoStereo";
import { DeClipper } from "./DeClipper";
import { VoiceRescue } from "./VoiceRescue";
import { StereoRepair } from "./StereoRepair";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface RestoreParams {
  hf: number;
  body: number;
  decrunch: number;
  hiss: number;
  /** v2 — mains-hum notch ladder (50/60 Hz auto-detected). */
  dehum: number;
  /** v2 — click / crackle clamp. */
  declick: number;
  /** v2 — synthesized stereo width for mono sources. */
  widen: number;
  /** v2.1 — soft de-clip: round flattened peaks + tame clipping buzz. */
  declip: number;
  /** v2.1 — Voice Rescue: floor cut, de-boom, presence, speech leveler. */
  voice: number;
  /** v2.1 — stereo / phase repair: bass anchor + anti-phase watchdog. */
  phase: number;
}

export const RESTORE_OFF: RestoreParams = {
  hf: 0, body: 0, decrunch: 0, hiss: 0, dehum: 0, declick: 0, widen: 0,
  declip: 0, voice: 0, phase: 0,
};

export function restoreActive(p: RestoreParams): boolean {
  return (
    p.hf > 0.001 || p.body > 0.001 || p.decrunch > 0.001 || p.hiss > 0.001 ||
    p.dehum > 0.001 || p.declick > 0.001 || p.widen > 0.001 ||
    p.declip > 0.001 || p.voice > 0.001 || p.phase > 0.001
  );
}

/** One-shot "Podcast / Voice" restoration loadout. */
export const RESTORE_VOICE_PRESET: RestoreParams = {
  hf: 0.25, body: 0.3, decrunch: 0.35, hiss: 0.5, dehum: 0.6, declick: 0.4, widen: 0,
  declip: 0.15, voice: 0.5, phase: 0,
};

/** v2.1 damage profiles — sensible starting points per damage class. */
export interface RestoreProfile {
  id: string;
  label: string;
  blurb: string;
  params: RestoreParams;
}

export const RESTORE_PROFILES: RestoreProfile[] = [
  {
    id: "streaming",
    label: "Streaming Rip",
    blurb: "Low-bitrate re-encode: brickwalled top end, codec crunch, thin body.",
    params: {
      ...RESTORE_OFF,
      hf: 0.55, body: 0.25, decrunch: 0.45, hiss: 0.25, declip: 0.15, phase: 0.15,
    },
  },
  {
    id: "podcast",
    label: "Podcast",
    blurb: "Spoken word: hum, clicks, hiss, boom — and a buried voice pulled forward.",
    params: { ...RESTORE_VOICE_PRESET },
  },
  {
    id: "vinyl",
    label: "Vinyl",
    blurb: "Needle-drop: crackle and pops clamped, surface hiss tamed, rumble-safe lows.",
    params: {
      ...RESTORE_OFF,
      declick: 0.7, hiss: 0.45, dehum: 0.25, body: 0.15, hf: 0.2, phase: 0.3,
    },
  },
  {
    id: "crushed",
    label: "Crushed Master",
    blurb: "Loudness-war casualty: peaks rounded back out, harshness ducked, weight restored.",
    params: {
      ...RESTORE_OFF,
      declip: 0.65, decrunch: 0.5, body: 0.2, hf: 0.15,
    },
  },
];

/** Harmonic-generator transfer: asymmetric soft fold (even + odd content). */
function makeExciterCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // tanh drive with a rectified component — rich, musical harmonics.
    curve[i] = Math.tanh(x * 3.2) * 0.7 + Math.abs(x) * x * 0.5;
  }
  return curve;
}

/** Gentle saturation for the body layer. */
function makeBodyCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  return curve;
}

export class Reconstructor {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private params: RestoreParams = { ...RESTORE_OFF };

  // HF rebuild — stage P (presence regen).
  private readonly pSrcBand: BiquadFilterNode;
  private readonly pShaper: WaveShaperNode;
  private readonly pHp1: BiquadFilterNode;
  private readonly pHp2: BiquadFilterNode;
  private readonly pLp: BiquadFilterNode;
  private readonly pGain: GainNode;
  // HF rebuild — stage A (air regen, fed by input + stage P).
  private readonly aSrcSum: GainNode;
  private readonly hfSrcBand: BiquadFilterNode;
  private readonly hfShaper: WaveShaperNode;
  private readonly hfHp1: BiquadFilterNode;
  private readonly hfHp2: BiquadFilterNode;
  private readonly hfLp: BiquadFilterNode;
  private readonly hfGain: GainNode;

  // Body rebuild chain.
  private readonly bodyBand: BiquadFilterNode;
  private readonly bodyShaper: WaveShaperNode;
  private readonly bodyLp: BiquadFilterNode;
  private readonly bodyGain: GainNode;

  // De-crunch: dynamic peaking cut + sidechain.
  private readonly crunchFilter: BiquadFilterNode;
  private readonly crunchSide: BiquadFilterNode;
  private readonly crunchAnalyser: AnalyserNode;

  // Hiss tamer: dynamic high shelf + sidechains (top band vs whole signal).
  private readonly hissShelf: BiquadFilterNode;
  private readonly hissSideHi: BiquadFilterNode;
  private readonly hissHiAnalyser: AnalyserNode;
  private readonly fullAnalyser: AnalyserNode;

  private timer: number | null = null;
  private readonly buf: Float32Array<ArrayBuffer>;

  // v2 stages: de-click → de-hum feed the core; pseudo-stereo sits last.
  private readonly declicker: DeClicker;
  private readonly dehummer: DeHummer;
  private readonly pseudo: PseudoStereo;
  // v2.1 stages: de-clip runs FIRST (rounding peaks before the ladders eat
  // them); voice rescue + stereo repair shape the merged core output.
  private readonly declipper: DeClipper;
  private readonly voiceRescue: VoiceRescue;
  private readonly stereoRepair: StereoRepair;
  /** Cleaned signal all core paths read from (post de-click / de-hum). */
  private readonly work: GainNode;
  /** Core merge point (pre pseudo-stereo). */
  private readonly sum: GainNode;
  /** v2.1 repair-stack A/B: crossfaded true bypass (click-safe). */
  private readonly directGain: GainNode;
  private readonly wetTail: GainNode;
  private bypassed = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // v2 front / back stages (transparent at amount 0).
    this.declicker = new DeClicker(ctx);
    this.dehummer = new DeHummer(ctx);
    this.pseudo = new PseudoStereo(ctx);
    this.declipper = new DeClipper(ctx);
    this.voiceRescue = new VoiceRescue(ctx);
    this.stereoRepair = new StereoRepair(ctx);
    this.work = ctx.createGain();
    this.sum = ctx.createGain();
    this.input.connect(this.declipper.input);
    this.declipper.output.connect(this.declicker.input);
    this.declicker.output.connect(this.dehummer.input);
    this.dehummer.output.connect(this.work);
    this.sum.connect(this.voiceRescue.input);
    this.voiceRescue.output.connect(this.stereoRepair.input);
    this.stereoRepair.output.connect(this.pseudo.input);
    this.wetTail = ctx.createGain();
    this.wetTail.gain.value = 1;
    this.pseudo.output.connect(this.wetTail).connect(this.output);
    // Silent parallel direct wire for the crossfaded repair-stack bypass.
    this.directGain = ctx.createGain();
    this.directGain.gain.value = 0;
    this.input.connect(this.directGain).connect(this.output);

    // Main path: dry through the two DYNAMIC filters (transparent at 0 dB).
    this.crunchFilter = ctx.createBiquadFilter();
    this.crunchFilter.type = "peaking";
    this.crunchFilter.frequency.value = 3600;
    this.crunchFilter.Q.value = 1.1;
    this.crunchFilter.gain.value = 0;

    this.hissShelf = ctx.createBiquadFilter();
    this.hissShelf.type = "highshelf";
    this.hissShelf.frequency.value = 9000;
    this.hissShelf.gain.value = 0;

    this.work.connect(this.crunchFilter).connect(this.hissShelf).connect(this.sum);

    // HF rebuild stage P: presence regen (1.2-3.5 kHz → 3.5-8 kHz).
    this.pSrcBand = ctx.createBiquadFilter();
    this.pSrcBand.type = "bandpass";
    this.pSrcBand.frequency.value = 2100;
    this.pSrcBand.Q.value = 0.7;
    this.pShaper = ctx.createWaveShaper();
    this.pShaper.curve = makeExciterCurve();
    this.pShaper.oversample = "2x";
    this.pHp1 = ctx.createBiquadFilter();
    this.pHp1.type = "highpass";
    this.pHp1.frequency.value = 3500;
    this.pHp1.Q.value = Math.SQRT1_2;
    this.pHp2 = ctx.createBiquadFilter();
    this.pHp2.type = "highpass";
    this.pHp2.frequency.value = 3500;
    this.pHp2.Q.value = Math.SQRT1_2;
    this.pLp = ctx.createBiquadFilter();
    this.pLp.type = "lowpass";
    this.pLp.frequency.value = 8000;
    this.pGain = ctx.createGain();
    this.pGain.gain.value = 0;
    this.work
      .connect(this.pSrcBand)
      .connect(this.pShaper)
      .connect(this.pHp1)
      .connect(this.pHp2)
      .connect(this.pLp);
    this.pLp.connect(this.pGain).connect(this.sum);

    // HF rebuild stage A: air regen. Eats the ORIGINAL + stage P's output so
    // the ladder climbs even when the source stops at 4 kHz.
    this.aSrcSum = ctx.createGain();
    this.work.connect(this.aSrcSum);
    const pFeed = ctx.createGain();
    pFeed.gain.value = 0.8;
    this.pLp.connect(pFeed).connect(this.aSrcSum);
    this.hfSrcBand = ctx.createBiquadFilter();
    this.hfSrcBand.type = "bandpass";
    this.hfSrcBand.frequency.value = 4800;
    this.hfSrcBand.Q.value = 0.55; // wide 3-7.5 kHz source band
    this.hfShaper = ctx.createWaveShaper();
    this.hfShaper.curve = makeExciterCurve();
    this.hfShaper.oversample = "2x";
    this.hfHp1 = ctx.createBiquadFilter();
    this.hfHp1.type = "highpass";
    this.hfHp1.frequency.value = 7500;
    this.hfHp1.Q.value = Math.SQRT1_2;
    this.hfHp2 = ctx.createBiquadFilter();
    this.hfHp2.type = "highpass";
    this.hfHp2.frequency.value = 7500;
    this.hfHp2.Q.value = Math.SQRT1_2;
    this.hfLp = ctx.createBiquadFilter();
    this.hfLp.type = "lowpass";
    this.hfLp.frequency.value = 16500;
    this.hfGain = ctx.createGain();
    this.hfGain.gain.value = 0;
    this.aSrcSum
      .connect(this.hfSrcBand)
      .connect(this.hfShaper)
      .connect(this.hfHp1)
      .connect(this.hfHp2)
      .connect(this.hfLp)
      .connect(this.hfGain)
      .connect(this.sum);

    // Body rebuild (parallel wet).
    this.bodyBand = ctx.createBiquadFilter();
    this.bodyBand.type = "bandpass";
    this.bodyBand.frequency.value = 110;
    this.bodyBand.Q.value = 0.6; // ~60-200 Hz
    this.bodyShaper = ctx.createWaveShaper();
    this.bodyShaper.curve = makeBodyCurve();
    this.bodyShaper.oversample = "2x";
    this.bodyLp = ctx.createBiquadFilter();
    this.bodyLp.type = "lowpass";
    this.bodyLp.frequency.value = 320;
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.value = 0;
    this.work
      .connect(this.bodyBand)
      .connect(this.bodyShaper)
      .connect(this.bodyLp)
      .connect(this.bodyGain)
      .connect(this.sum);

    // Sidechains.
    this.crunchSide = ctx.createBiquadFilter();
    this.crunchSide.type = "bandpass";
    this.crunchSide.frequency.value = 3800;
    this.crunchSide.Q.value = 0.9;
    this.crunchAnalyser = ctx.createAnalyser();
    this.crunchAnalyser.fftSize = 1024;
    this.crunchAnalyser.smoothingTimeConstant = 0;
    this.work.connect(this.crunchSide).connect(this.crunchAnalyser);

    this.hissSideHi = ctx.createBiquadFilter();
    this.hissSideHi.type = "highpass";
    this.hissSideHi.frequency.value = 8500;
    this.hissHiAnalyser = ctx.createAnalyser();
    this.hissHiAnalyser.fftSize = 1024;
    this.hissHiAnalyser.smoothingTimeConstant = 0;
    this.work.connect(this.hissSideHi).connect(this.hissHiAnalyser);

    this.fullAnalyser = ctx.createAnalyser();
    this.fullAnalyser.fftSize = 1024;
    this.fullAnalyser.smoothingTimeConstant = 0;
    this.work.connect(this.fullAnalyser);

    this.buf = new Float32Array(1024) as Float32Array<ArrayBuffer>;
  }

  setParams(next: Partial<RestoreParams>): void {
    const p: RestoreParams = {
      hf: clamp01(next.hf ?? this.params.hf),
      body: clamp01(next.body ?? this.params.body),
      decrunch: clamp01(next.decrunch ?? this.params.decrunch),
      hiss: clamp01(next.hiss ?? this.params.hiss),
      dehum: clamp01(next.dehum ?? this.params.dehum),
      declick: clamp01(next.declick ?? this.params.declick),
      widen: clamp01(next.widen ?? this.params.widen),
      declip: clamp01(next.declip ?? this.params.declip),
      voice: clamp01(next.voice ?? this.params.voice),
      phase: clamp01(next.phase ?? this.params.phase),
    };
    this.params = p;
    this.dehummer.setAmount(p.dehum);
    this.declicker.setAmount(p.declick);
    this.pseudo.setAmount(p.widen);
    this.declipper.setAmount(p.declip);
    this.voiceRescue.setAmount(p.voice);
    this.stereoRepair.setAmount(p.phase);
    const t = this.ctx.currentTime;
    // Wet levels: perceptibly useful without swamping the dry signal. The
    // presence stage engages progressively harder (^1.6) — it only really
    // matters for severely bandlimited sources where hf is cranked.
    this.hfGain.gain.setTargetAtTime(p.hf * 0.6, t, 0.05);
    this.pGain.gain.setTargetAtTime(Math.pow(p.hf, 1.6) * 0.42, t, 0.05);
    this.bodyGain.gain.setTargetAtTime(p.body * 0.5, t, 0.05);
    if (p.decrunch <= 0.001) {
      this.crunchFilter.gain.setTargetAtTime(0, t, 0.05);
    }
    if (p.hiss <= 0.001) {
      this.hissShelf.gain.setTargetAtTime(0, t, 0.05);
    }
    if (p.decrunch > 0.001 || p.hiss > 0.001) this.startTimer();
    else this.stopTimer();
  }

  getParams(): RestoreParams {
    return { ...this.params };
  }

  private rms(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Smoothed hiss-band envelope for the "steady noise floor" detection. */
  private hissEnv = 0;
  private hissVar = 0;

  private tick(): void {
    const t = this.ctx.currentTime;
    const p = this.params;

    if (p.decrunch > 0.001) {
      const harsh = this.rms(this.crunchAnalyser);
      const full = this.rms(this.fullAnalyser) + 1e-6;
      // Duck when the harsh band flares ABOVE its usual share of the mix.
      const share = harsh / full;
      const threshold = 0.5 - 0.25 * p.decrunch;
      const excess = Math.max(0, share - threshold);
      const cutDb = -Math.min(12, excess * (24 + 20 * p.decrunch) * (0.4 + full));
      this.crunchFilter.gain.setTargetAtTime(cutDb, t, 0.02);
    }

    if (p.hiss > 0.001) {
      const hi = this.rms(this.hissHiAnalyser);
      const full = this.rms(this.fullAnalyser) + 1e-6;
      // Track the hi-band envelope and its variability: HISS is quiet and
      // STEADY; cymbals/air are louder and spiky. Close the shelf only on
      // the steady-quiet case.
      const dev = Math.abs(hi - this.hissEnv);
      this.hissEnv += (hi - this.hissEnv) * 0.2;
      this.hissVar += (dev - this.hissVar) * 0.1;
      const steady = this.hissVar < this.hissEnv * 0.35 + 1e-4;
      const quiet = this.hissEnv < full * 0.12 + 0.0015;
      const closeDb = steady && quiet ? -(4 + 9 * p.hiss) : 0;
      this.hissShelf.gain.setTargetAtTime(closeDb, t, 0.08);
    }
  }

  /** Detected (or pinned) mains-hum fundamental, for the UI readout. */
  getHumBaseHz(): number {
    return this.dehummer.getBaseHz();
  }

  /** Pin the hum fundamental — used by the offline batch renderer. */
  setHumBaseHz(hz: 50 | 60): void {
    this.dehummer.setBaseHz(hz);
  }

  /** Pin the de-click threshold — used by the offline batch renderer. */
  setDeclickStaticThresholdDb(db: number): void {
    this.declicker.setStaticThresholdDb(db);
  }

  /**
   * v2.1 repair-stack A/B — true bypass with a 30 ms crossfade so toggling
   * never clicks. The processed graph keeps running (its tail is muted), so
   * un-bypassing is instant and glitch-free.
   */
  setBypassed(b: boolean): void {
    if (this.bypassed === b) return;
    this.bypassed = b;
    const t = this.ctx.currentTime;
    this.directGain.gain.setTargetAtTime(b ? 1 : 0, t, 0.03);
    this.wetTail.gain.setTargetAtTime(b ? 0 : 1, t, 0.03);
  }

  dispose(): void {
    this.stopTimer();
    this.dehummer.dispose();
    this.declicker.dispose();
    this.stereoRepair.dispose();
  }
}
