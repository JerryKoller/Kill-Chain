/**
 * uiSoundsGrowl — the Kill-Chain ENGAGE / DISENGAGE slam.
 *
 * Half a second of violence when the chain goes live. No wobble, no growl
 * that overstays — a BREACH CHARGE:
 *
 *   ENGAGE (~0.5 s)
 *     - REVERSE SUCK (40 ms): bandswept noise inhaling INTO the hit.
 *     - THE HIT: broadband slam + a hardened-steel ring (three inharmonic
 *       high-Q partials struck at once, dying fast).
 *     - THE ZAP: a driven saw diving 240→58 Hz through a single fast filter
 *       sweep — one snarl, done.
 *     - SUB PUNCH: 74→40 Hz sine, tight 0.25 s decay. Felt in the chest.
 *     - Hard gate to silence — the room goes quiet like a door sealed.
 *
 *   DISENGAGE (~0.35 s): the power-down — soft contact, darker zap falling
 *   further, sub sinking to 30 Hz. Quieter, final.
 *
 * Rendered once through an OfflineAudioContext, peak-normalized, cached.
 * Playback rides the ui-sounds bus (Settings toggle + volume + output
 * device); an exclusivity window keeps rapid toggling from stacking slams.
 */

import { getUiAudio } from "@/audio/uiSounds";

const SAMPLE_RATE = 44100;
const ENGAGE_DURATION_S = 0.52;
const DISENGAGE_DURATION_S = 0.38;

// ── Shared DSP helpers ──────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) so noise layers render identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = mulberry32(seed);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return buf;
}

function makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

function normalize(buffer: AudioBuffer, targetDb = -2.5): AudioBuffer {
  const target = Math.pow(10, targetDb / 20);
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 0) {
    const scale = target / peak;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }
  }
  return buffer;
}

// ── The slam ────────────────────────────────────────────────────────────────

interface SlamSpec {
  /** Total render length (s). */
  dur: number;
  /** Reverse-suck length before the hit (s). 0 = hit instantly. */
  suck: number;
  /** Zap dive start → end (Hz). */
  zapFrom: number;
  zapTo: number;
  /** Zap filter sweep start → end (Hz). */
  zapFiltFrom: number;
  zapFiltTo: number;
  /** Sub punch start → end (Hz). */
  subFrom: number;
  subTo: number;
  /** Steel-ring partials (Hz) — inharmonic set = struck metal. */
  ring: number[];
  /** Ring decay (s). */
  ringDecay: number;
  /** Overall aggression 0..1 (impact + drive). */
  heat: number;
  seed: number;
}

function buildSlam(ctx: OfflineAudioContext, bus: GainNode, s: SlamSpec): void {
  const t0 = s.suck; // the hit lands here
  const end = s.dur;

  // ── REVERSE SUCK ── air inhaled into the hit (skipped when suck = 0).
  if (s.suck > 0.005) {
    const suck = ctx.createBufferSource();
    suck.buffer = makeNoiseBuffer(ctx, s.suck + 0.01, s.seed ^ 0x5c);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(500, 0);
    bp.frequency.exponentialRampToValueAtTime(5200, t0);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, 0);
    env.gain.exponentialRampToValueAtTime(0.5 * s.heat, t0 - 0.004);
    env.gain.linearRampToValueAtTime(0, t0);
    suck.connect(bp).connect(env).connect(bus);
    suck.start(0);
  }

  // ── THE HIT ── broadband slam, gone in 70 ms.
  const slam = ctx.createBufferSource();
  slam.buffer = makeNoiseBuffer(ctx, 0.08, s.seed);
  const slamLp = ctx.createBiquadFilter();
  slamLp.type = "lowpass";
  slamLp.frequency.setValueAtTime(6000, t0);
  slamLp.frequency.exponentialRampToValueAtTime(300, t0 + 0.06);
  const slamEnv = ctx.createGain();
  slamEnv.gain.setValueAtTime(1.0 * s.heat, t0);
  slamEnv.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.07);
  slam.connect(slamLp).connect(slamEnv).connect(bus);
  slam.start(t0);

  // ── STEEL RING ── inharmonic partials struck at once, dying fast.
  s.ring.forEach((freq, i) => {
    const burst = ctx.createBufferSource();
    burst.buffer = makeNoiseBuffer(ctx, 0.02, s.seed ^ (0xb1ade + i));
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 42;
    const env = ctx.createGain();
    const lvl = (0.5 - i * 0.1) * s.heat;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.05, lvl), t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0006, t0 + s.ringDecay);
    const pan = ctx.createStereoPanner();
    pan.pan.value = i === 0 ? 0 : i % 2 ? 0.4 : -0.4;
    burst.connect(bp).connect(env).connect(pan).connect(bus);
    burst.start(t0);
  });

  // ── THE ZAP ── one driven dive. No oscillation, no flatulence.
  const zap = ctx.createOscillator();
  zap.type = "sawtooth";
  zap.frequency.setValueAtTime(s.zapFrom, t0);
  zap.frequency.exponentialRampToValueAtTime(s.zapTo, t0 + 0.11);
  const zapDrive = ctx.createWaveShaper();
  zapDrive.curve = makeDriveCurve(9);
  zapDrive.oversample = "4x";
  const zapPre = ctx.createGain();
  zapPre.gain.value = 2.6;
  const zapBp = ctx.createBiquadFilter();
  zapBp.type = "bandpass";
  zapBp.Q.value = 1.6;
  zapBp.frequency.setValueAtTime(s.zapFiltFrom, t0);
  zapBp.frequency.exponentialRampToValueAtTime(s.zapFiltTo, t0 + 0.15);
  const zapEnv = ctx.createGain();
  zapEnv.gain.setValueAtTime(0.0001, t0);
  zapEnv.gain.exponentialRampToValueAtTime(0.85 * s.heat, t0 + 0.006);
  zapEnv.gain.setValueAtTime(0.85 * s.heat, t0 + 0.06);
  zapEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  zap.connect(zapPre).connect(zapDrive).connect(zapBp).connect(zapEnv).connect(bus);
  zap.start(t0);
  zap.stop(t0 + 0.26);

  // ── SUB PUNCH ── chest weight, tight.
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(s.subFrom, t0);
  sub.frequency.exponentialRampToValueAtTime(s.subTo, t0 + 0.16);
  const subEnv = ctx.createGain();
  subEnv.gain.setValueAtTime(0.0001, t0);
  subEnv.gain.exponentialRampToValueAtTime(1.0, t0 + 0.008);
  subEnv.gain.exponentialRampToValueAtTime(0.001, end - 0.02);
  subEnv.gain.linearRampToValueAtTime(0, end);
  sub.connect(subEnv).connect(bus);
  sub.start(t0);
  sub.stop(end);
}

// ── Renders ─────────────────────────────────────────────────────────────────

let engagePromise: Promise<AudioBuffer> | null = null;
let disengagePromise: Promise<AudioBuffer> | null = null;

function renderOffline(
  seconds: number,
  build: (ctx: OfflineAudioContext, bus: GainNode) => void,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.8, 0);
  bus.gain.setValueAtTime(0.8, seconds - 0.015);
  bus.gain.linearRampToValueAtTime(0, seconds); // true silence at the end
  const clip = ctx.createWaveShaper();
  clip.curve = makeDriveCurve(1.8);
  clip.oversample = "2x";
  bus.connect(clip).connect(ctx.destination);
  build(ctx, bus);
  return ctx.startRendering().then((b) => normalize(b));
}

/** Render + cache the ENGAGE slam (call early so the buffer is warm). */
export function preloadEngageGrowl(): Promise<AudioBuffer> {
  if (engagePromise) return engagePromise;
  engagePromise = renderOffline(ENGAGE_DURATION_S, (ctx, bus) => {
    buildSlam(ctx, bus, {
      dur: ENGAGE_DURATION_S,
      suck: 0.045,
      zapFrom: 240,
      zapTo: 58,
      zapFiltFrom: 1500,
      zapFiltTo: 280,
      subFrom: 74,
      subTo: 40,
      // Inharmonic set ≈ struck hardened steel (not a chord — a BLADE).
      ring: [1244, 2087, 3163],
      ringDecay: 0.2,
      heat: 1,
      seed: 0x6e6172,
    });
  });
  return engagePromise;
}

function preloadDisengageGrowl(): Promise<AudioBuffer> {
  if (disengagePromise) return disengagePromise;
  disengagePromise = renderOffline(DISENGAGE_DURATION_S, (ctx, bus) => {
    // Power-down: no suck, duller ring, everything falls further and softer.
    buildSlam(ctx, bus, {
      dur: DISENGAGE_DURATION_S,
      suck: 0,
      zapFrom: 130,
      zapTo: 38,
      zapFiltFrom: 640,
      zapFiltTo: 160,
      subFrom: 52,
      subTo: 29,
      ring: [742, 1188],
      ringDecay: 0.12,
      heat: 0.62,
      seed: 0x646f776e,
    });
  });
  return disengagePromise;
}

// ── Playback ────────────────────────────────────────────────────────────────

/** Engage/disengage share one exclusive window so rapid toggling never stacks. */
let exclusiveUntil = 0;

async function playBuffer(promise: Promise<AudioBuffer>, gain: number, seconds: number): Promise<void> {
  const ui = getUiAudio(); // null when UI sounds are disabled in Settings
  if (!ui) return;
  const now = performance.now();
  if (now < exclusiveUntil) return;
  exclusiveUntil = now + seconds * 1000;

  let buffer: AudioBuffer;
  try {
    buffer = await promise;
  } catch {
    exclusiveUntil = 0;
    return;
  }
  if (ui.ctx.state === "suspended") {
    try { await ui.ctx.resume(); } catch { /* leave it — next gesture rescues */ }
  }
  const src = ui.ctx.createBufferSource();
  src.buffer = buffer;
  const g = ui.ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ui.master);
  src.onended = () => {
    try { src.disconnect(); } catch { /* ignore */ }
    try { g.disconnect(); } catch { /* ignore */ }
  };
  src.start();
}

/** The ENGAGE growl — impactful, violent, gone in under a second. */
export function playEngageGrowl(): void {
  void playBuffer(preloadEngageGrowl(), 1.0, ENGAGE_DURATION_S);
}

/** The power-down growl for DISENGAGE. */
export function playDisengageGrowl(): void {
  void playBuffer(preloadDisengageGrowl(), 0.8, DISENGAGE_DURATION_S);
}
