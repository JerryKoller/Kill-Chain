/**
 * splashSound — the Kill-Chain signature boot sequence: "SYSTEM ARM".
 *
 * A 4.2-second cinematic arming sequence, procedurally synthesized — nothing
 * bundled. Rendered once through an OfflineAudioContext (44.1 kHz stereo) and
 * played back as a single AudioBuffer, deterministic on every machine.
 *
 * Timeline (synced to the splash visuals in index.html):
 *   0.00–0.12  CONTACT — power relay click + small dark thud. The machine
 *              notices you.
 *   0.10–2.55  SPOOL-UP — detuned dark saws through a slowly opening filter,
 *              a rising shimmer layer, and two radar pings answering each
 *              other L/R. Tension, not melody.
 *   2.05–2.85  ARMING RUN — accelerating mechanical ticks (like a charging
 *              handle ratcheting faster and faster) under a riser sweep.
 *   2.85       THE DROP — breach slam: broadband hit, hardened-steel ring,
 *              sub drop to 35 Hz, and a wide minor-add9 bloom that decays to
 *              dead silence by exactly 4.2 s. The title flash lands here.
 *
 * Mastering: bus glue → tanh soft clip; buffer peak-normalized to −2.5 dBFS.
 *
 * Playback goes through a small private AudioContext (like uiSounds) routed
 * to the user's chosen output device, so the sting never enters the main
 * DSP/limiter chain. Electron allows audible autoplay (main.ts switch); in a
 * plain browser we fall back to starting on the first gesture within a short
 * window after boot.
 */

export const SPLASH_SOUND_DURATION_S = 4.2;
/** Where the drop lands (s after the sound starts) — visuals flash here. */
export const SPLASH_DROP_AT_S = 2.85;

const SAMPLE_RATE = 44100;

/** Deterministic PRNG (mulberry32) so the noise beds render identically. */
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

function makeSoftClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.7) / Math.tanh(1.7);
  }
  return curve;
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

interface Bus {
  ctx: OfflineAudioContext;
  input: GainNode;
}

/** 0.00–0.12 s: power relay contact + small dark thud. */
function buildContact({ ctx, input }: Bus): void {
  const click = ctx.createBufferSource();
  click.buffer = makeNoiseBuffer(ctx, 0.015, 0xc11c);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2600;
  bp.Q.value = 2.4;
  const cEnv = ctx.createGain();
  cEnv.gain.setValueAtTime(0.4, 0);
  cEnv.gain.exponentialRampToValueAtTime(0.001, 0.014);
  click.connect(bp).connect(cEnv).connect(input);
  click.start(0);

  const thud = ctx.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(96, 0.004);
  thud.frequency.exponentialRampToValueAtTime(45, 0.1);
  const tEnv = ctx.createGain();
  tEnv.gain.setValueAtTime(0.0001, 0.004);
  tEnv.gain.exponentialRampToValueAtTime(0.5, 0.014);
  tEnv.gain.exponentialRampToValueAtTime(0.0008, 0.16);
  thud.connect(tEnv).connect(input);
  thud.start(0.004);
  thud.stop(0.18);
}

/** 0.10–2.55 s: dark spool-up pad + shimmer + radar pings. */
function buildSpoolUp({ ctx, input }: Bus): void {
  const start = 0.1;
  const end = 2.75;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(140, start);
  lp.frequency.exponentialRampToValueAtTime(900, end);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(0.16, start + 0.9);
  env.gain.setValueAtTime(0.16, end - 0.35);
  env.gain.linearRampToValueAtTime(0, end);
  lp.connect(env).connect(input);

  // Detuned dark saws (E1 + fifth), L/R split, right lags 9 ms (Haas width).
  const voices = [
    { freq: 41.2, detune: -8, pan: -0.5, delay: 0, level: 0.55 },
    { freq: 41.2, detune: +8, pan: +0.5, delay: 0.009, level: 0.55 },
    { freq: 61.7, detune: -5, pan: -0.22, delay: 0, level: 0.28 },
    { freq: 61.7, detune: +5, pan: +0.22, delay: 0.007, level: 0.28 },
  ];
  for (const v of voices) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = v.freq;
    osc.detune.value = v.detune;
    const level = ctx.createGain();
    level.gain.value = v.level;
    const pan = ctx.createStereoPanner();
    pan.pan.value = v.pan;
    if (v.delay > 0) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = v.delay;
      osc.connect(level).connect(d).connect(pan).connect(lp);
    } else {
      osc.connect(level).connect(pan).connect(lp);
    }
    osc.start(start);
    osc.stop(end + 0.05);
  }

  // Shimmer: high detuned sines fading in above the pad — the "energy" tell.
  const shimmerEnv = ctx.createGain();
  shimmerEnv.gain.setValueAtTime(0, start + 0.6);
  shimmerEnv.gain.linearRampToValueAtTime(0.05, end - 0.5);
  shimmerEnv.gain.linearRampToValueAtTime(0, end);
  shimmerEnv.connect(input);
  [1318.5, 1975.5, 2637].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.detune.value = i % 2 ? 6 : -6;
    const g = ctx.createGain();
    g.gain.value = 0.5 - i * 0.12;
    const p = ctx.createStereoPanner();
    p.pan.value = i === 0 ? -0.4 : i === 1 ? 0.4 : 0;
    o.connect(g).connect(p).connect(shimmerEnv);
    o.start(start + 0.6);
    o.stop(end);
  });

  // Two radar pings answering L → R.
  const pings = [
    { t: 0.85, f: 1560, pan: -0.6 },
    { t: 1.65, f: 2080, pan: +0.6 },
  ];
  for (const pg of pings) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = pg.f;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = pg.f;
    bp.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, pg.t);
    g.gain.exponentialRampToValueAtTime(0.07, pg.t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0003, pg.t + 0.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = pg.pan;
    osc.connect(bp).connect(g).connect(pan).connect(input);
    osc.start(pg.t);
    osc.stop(pg.t + 0.55);
  }
}

/** 2.05–2.85 s: accelerating arming ticks + riser into the drop. */
function buildArmingRun({ ctx, input }: Bus): void {
  const start = 2.05;
  const dropAt = SPLASH_DROP_AT_S;

  // Ratcheting ticks that accelerate exponentially toward the drop.
  let t = start;
  let gap = 0.15;
  let i = 0;
  while (t < dropAt - 0.02) {
    const tick = ctx.createBufferSource();
    tick.buffer = makeNoiseBuffer(ctx, 0.012, 0x71c0 + i);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900 + i * 160;
    bp.Q.value = 3;
    const g = ctx.createGain();
    const lvl = 0.1 + (i / 14) * 0.16;
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    const pan = ctx.createStereoPanner();
    pan.pan.value = i % 2 ? 0.35 : -0.35;
    tick.connect(bp).connect(g).connect(pan).connect(input);
    tick.start(t);
    t += gap;
    gap *= 0.82;
    i++;
  }

  // Riser sweep underneath.
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, dropAt - start + 0.05, 0x0715e7);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(420, start);
  bp.frequency.exponentialRampToValueAtTime(6400, dropAt);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, start);
  ng.gain.exponentialRampToValueAtTime(0.3, dropAt - 0.02);
  ng.gain.linearRampToValueAtTime(0, dropAt + 0.01);
  noise.connect(bp).connect(ng).connect(input);
  noise.start(start);

  const tone = ctx.createOscillator();
  tone.type = "sine";
  tone.frequency.setValueAtTime(110, start);
  tone.frequency.exponentialRampToValueAtTime(233, dropAt);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, start);
  tg.gain.exponentialRampToValueAtTime(0.1, dropAt - 0.02);
  tg.gain.linearRampToValueAtTime(0, dropAt + 0.01);
  tone.connect(tg).connect(input);
  tone.start(start);
  tone.stop(dropAt + 0.05);
}

/** 2.85 s: the drop — breach slam + steel ring + sub + minor-add9 bloom. */
function buildDrop({ ctx, input }: Bus): void {
  const t0 = SPLASH_DROP_AT_S;
  const end = SPLASH_SOUND_DURATION_S;

  // Broadband hit.
  const slam = ctx.createBufferSource();
  slam.buffer = makeNoiseBuffer(ctx, 0.1, 0x7b00f);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(6500, t0);
  lp.frequency.exponentialRampToValueAtTime(260, t0 + 0.08);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.9, t0);
  sg.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.1);
  slam.connect(lp).connect(sg).connect(input);
  slam.start(t0);

  // Steel ring (inharmonic — the blade signature, same DNA as ENGAGE).
  [1244, 2087, 3163].forEach((f, i) => {
    const burst = ctx.createBufferSource();
    burst.buffer = makeNoiseBuffer(ctx, 0.025, 0xb1ade + i);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = 40;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4 - i * 0.09, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = i === 0 ? 0 : i % 2 ? 0.45 : -0.45;
    burst.connect(bp).connect(g).connect(pan).connect(input);
    burst.start(t0);
  });

  // Sub drop.
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(80, t0);
  sub.frequency.exponentialRampToValueAtTime(35, t0 + 0.3);
  const subG = ctx.createGain();
  subG.gain.setValueAtTime(0.0001, t0);
  subG.gain.exponentialRampToValueAtTime(1.0, t0 + 0.01);
  subG.gain.exponentialRampToValueAtTime(0.0008, end - 0.06);
  subG.gain.linearRampToValueAtTime(0, end - 0.01);
  sub.connect(subG).connect(input);
  sub.start(t0);
  sub.stop(end);

  // Wide bloom: Am(add9) voiced low, driven softly, decaying to silence.
  const bloomDrive = ctx.createWaveShaper();
  bloomDrive.curve = makeDriveCurve(2.4);
  const bloomLp = ctx.createBiquadFilter();
  bloomLp.type = "lowpass";
  bloomLp.frequency.setValueAtTime(2600, t0);
  bloomLp.frequency.exponentialRampToValueAtTime(700, end);
  const bloomEnv = ctx.createGain();
  bloomEnv.gain.setValueAtTime(0.0001, t0);
  bloomEnv.gain.exponentialRampToValueAtTime(0.34, t0 + 0.03);
  bloomEnv.gain.exponentialRampToValueAtTime(0.0006, end - 0.04);
  bloomEnv.gain.linearRampToValueAtTime(0, end - 0.005);
  bloomDrive.connect(bloomLp).connect(bloomEnv).connect(input);

  const chord = [
    { f: 110.0, pan: -0.3 },  // A2
    { f: 130.81, pan: 0.3 },  // C3
    { f: 164.81, pan: -0.15 },// E3
    { f: 246.94, pan: 0.15 }, // B3 (the add9 shimmer)
    { f: 220.0, pan: 0 },     // A3
  ];
  for (const c of chord) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = c.f;
    o.detune.value = c.pan * 10;
    const g = ctx.createGain();
    g.gain.value = 0.22;
    const p = ctx.createStereoPanner();
    p.pan.value = c.pan * 1.6;
    o.connect(g).connect(p).connect(bloomDrive);
    o.start(t0);
    o.stop(end);
  }
}

/** Peak-normalise the rendered buffer to −2.5 dBFS. */
function normalize(buffer: AudioBuffer): AudioBuffer {
  const target = Math.pow(10, -2.5 / 20);
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

let renderPromise: Promise<AudioBuffer> | null = null;

/**
 * Render the boot sound offline (cached — subsequent calls reuse the buffer).
 * Call early during boot so the buffer is ready before the splash reveal.
 */
export function preloadSplashSound(): Promise<AudioBuffer> {
  if (renderPromise) return renderPromise;
  renderPromise = (async () => {
    const ctx = new OfflineAudioContext(
      2,
      Math.ceil(SPLASH_SOUND_DURATION_S * SAMPLE_RATE),
      SAMPLE_RATE,
    );

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.8, 0);
    bus.gain.setValueAtTime(0.8, SPLASH_SOUND_DURATION_S - 0.02);
    bus.gain.linearRampToValueAtTime(0, SPLASH_SOUND_DURATION_S);
    const clip = ctx.createWaveShaper();
    clip.curve = makeSoftClipCurve();
    clip.oversample = "2x";
    bus.connect(clip).connect(ctx.destination);

    const b: Bus = { ctx, input: bus };
    buildContact(b);
    buildSpoolUp(b);
    buildArmingRun(b);
    buildDrop(b);

    return normalize(await ctx.startRendering());
  })();
  return renderPromise;
}

// ── Playback ────────────────────────────────────────────────────────────────

let playCtx: AudioContext | null = null;

/** Only retry on a user gesture within this window after boot — a boot sting
 *  firing on a click minutes later would be jarring. */
const GESTURE_RETRY_WINDOW_MS = 10_000;

function ensurePlayCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!playCtx) {
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      playCtx = new Ctor({ latencyHint: "interactive" });
    } catch {
      return null;
    }
  }
  return playCtx;
}

/**
 * Route the boot sting to the SAME output device the engine uses (Settings →
 * Audio Routing). Its private context otherwise plays to the Windows default
 * endpoint, which is inaudible when the app is routed to headphones.
 */
async function applySplashSink(ctx: AudioContext): Promise<void> {
  try {
    const { useSettingsStore } = await import("../state/settingsStore");
    const id = useSettingsStore.getState().audioOutputDeviceId;
    if (!id) return;
    const anyCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof anyCtx.setSinkId === "function") {
      await anyCtx.setSinkId(id).catch(() => { /* stale id — default output */ });
    }
  } catch {
    /* settings unavailable — default output */
  }
}

function startBuffer(ctx: AudioContext, buffer: AudioBuffer, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(g).connect(ctx.destination);
    src.onended = () => {
      try { src.disconnect(); } catch { /* ignore */ }
      try { g.disconnect(); } catch { /* ignore */ }
      resolve();
    };
    src.start();
  });
}

/**
 * Play the signature boot sound once. Resolves when playback finishes (or
 * immediately if audio is unavailable). `volume` is 0..1 linear gain on top
 * of the −2.5 dBFS master.
 */
export async function playSplashSound(volume = 1): Promise<void> {
  const ctx = ensurePlayCtx();
  if (!ctx) return;

  let buffer: AudioBuffer;
  try {
    buffer = await preloadSplashSound();
  } catch {
    return;
  }

  await applySplashSink(ctx);

  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* fall through to gesture path */ }
  }

  if (ctx.state === "running") {
    await startBuffer(ctx, buffer, volume);
    return;
  }

  // Autoplay blocked: start on the first gesture, but only while it can still
  // plausibly read as part of the boot sequence.
  const armedAt = performance.now();
  await new Promise<void>((resolve) => {
    const once = () => {
      window.removeEventListener("pointerdown", once);
      window.removeEventListener("keydown", once);
      if (performance.now() - armedAt > GESTURE_RETRY_WINDOW_MS) {
        resolve();
        return;
      }
      void ctx.resume().then(
        () => startBuffer(ctx, buffer, volume).then(resolve),
        () => resolve(),
      );
    };
    window.addEventListener("pointerdown", once, { once: true });
    window.addEventListener("keydown", once, { once: true });
  });
}
