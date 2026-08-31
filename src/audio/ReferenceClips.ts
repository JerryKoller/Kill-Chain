/**
 * Procedurally-synthesized reference clips for calibration & hearing
 * tests. Each clip produces a short stereo AudioBuffer offline so it can
 * be looped at any time with zero load latency. No external files.
 */

const SR_FALLBACK = 48000;

export type ClipId =
  | "pink-noise"
  | "white-noise"
  | "sub-sweep"
  | "kick"
  | "snare"
  | "vocal-aaah"
  | "vocal-sss"
  | "hihat"
  | "piano-c4"
  | "synth-pad"
  | "test-tone-1k";

export interface ReferenceClip {
  id: ClipId;
  name: string;
  blurb: string;
  durationSec: number;
}

export const CLIPS: ReferenceClip[] = [
  { id: "pink-noise", name: "Pink noise", blurb: "Equal energy per octave - reveals tonal balance issues", durationSec: 4 },
  { id: "white-noise", name: "White noise", blurb: "Equal energy per Hz - very treble-heavy", durationSec: 4 },
  { id: "sub-sweep", name: "Sub-bass sweep", blurb: "20 Hz to 200 Hz - test how low your headphones go", durationSec: 6 },
  { id: "kick", name: "Kick drum", blurb: "Punchy 60 Hz transient + click", durationSec: 2 },
  { id: "snare", name: "Snare drum", blurb: "Body around 200 Hz + crack at 4 kHz", durationSec: 2 },
  { id: "vocal-aaah", name: "Vocal 'aaah'", blurb: "Formant-rich vowel - tests vocal warmth", durationSec: 3 },
  { id: "vocal-sss", name: "Vocal 'sss'", blurb: "Sibilance pulse - tests de-esser & harshness", durationSec: 2 },
  { id: "hihat", name: "Hi-hat", blurb: "Closed hi-hat - tests upper treble snap", durationSec: 2 },
  { id: "piano-c4", name: "Piano C4", blurb: "Plucked sine + decay - tests mid-band clarity", durationSec: 3 },
  { id: "synth-pad", name: "Synth pad", blurb: "Wide, lush pad chord - tests stereo + ambience", durationSec: 4 },
  { id: "test-tone-1k", name: "1 kHz tone", blurb: "Pure sine at 1 kHz - the universal reference pitch", durationSec: 3 },
];

// Keyed by clip AND sample rate — a buffer synthesized for one context's
// rate plays at the wrong pitch/speed on a context running at another rate.
const bufferCache = new Map<string, AudioBuffer>();

export function getReferenceBuffer(ctx: BaseAudioContext, id: ClipId): AudioBuffer {
  const sr = (ctx as AudioContext).sampleRate || SR_FALLBACK;
  const cacheKey = `${id}@${sr}`;
  const cached = bufferCache.get(cacheKey);
  if (cached) return cached;
  const def = CLIPS.find((c) => c.id === id);
  const sec = def?.durationSec ?? 2;
  const n = Math.floor(sec * sr);
  const buf = ctx.createBuffer(2, n, sr);
  switch (id) {
    case "pink-noise": fillPinkNoise(buf); break;
    case "white-noise": fillWhiteNoise(buf); break;
    case "sub-sweep": fillSubSweep(buf, sr); break;
    case "kick": fillKick(buf, sr); break;
    case "snare": fillSnare(buf, sr); break;
    case "vocal-aaah": fillVocalAaah(buf, sr); break;
    case "vocal-sss": fillVocalSss(buf, sr); break;
    case "hihat": fillHihat(buf, sr); break;
    case "piano-c4": fillPiano(buf, sr, 261.63); break;
    case "synth-pad": fillSynthPad(buf, sr); break;
    case "test-tone-1k": fillTone(buf, sr, 1000); break;
  }
  bufferCache.set(cacheKey, buf);
  return buf;
}

/**
 * Return a loop-friendly copy of a buffer by crossfading its tail into its
 * head. When a normal AudioBufferSourceNode loops, the jump from the last
 * sample back to the first is a hard discontinuity — for noise or arbitrary
 * tracks that's an audible click/pop every loop (what reads as "clipping").
 *
 * We fold the final `fadeSec` of audio into the first `fadeSec` with an
 * equal-power crossfade and shorten the buffer by that amount, so the wrap
 * point becomes perfectly continuous.
 */
export function makeSeamlessLoopBuffer(
  ctx: BaseAudioContext,
  src: AudioBuffer,
  fadeSec = 0.04,
): AudioBuffer {
  const sr = src.sampleRate;
  const L = Math.min(Math.floor(fadeSec * sr), Math.floor(src.length / 4));
  if (L < 8) return src; // too short to bother
  const newLen = src.length - L;
  const out = ctx.createBuffer(src.numberOfChannels, newLen, sr);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const s = src.getChannelData(ch);
    const o = out.getChannelData(ch);
    // Body stays identical.
    for (let i = 0; i < newLen; i++) o[i] = s[i];
    // Crossfade the head with the folded tail (equal-power) so wrapping the
    // shortened buffer is continuous: out[0] ≈ tail start, out[L] = head.
    for (let i = 0; i < L; i++) {
      const w = i / L;
      const head = Math.sin(w * 0.5 * Math.PI); // 0 → 1
      const tail = Math.cos(w * 0.5 * Math.PI); // 1 → 0
      o[i] = s[i] * head + s[i + newLen] * tail;
    }
  }
  return out;
}

/** Generate a sine tone of given freq at given sample-rate - utility. */
export function makeToneBuffer(
  ctx: BaseAudioContext,
  freq: number,
  durationSec: number,
  amp = 0.5,
): AudioBuffer {
  const sr = (ctx as AudioContext).sampleRate || SR_FALLBACK;
  const n = Math.max(1, Math.floor(durationSec * sr));
  const buf = ctx.createBuffer(2, n, sr);
  const omega = 2 * Math.PI * freq / sr;
  // Fade in / out 50 ms to avoid clicks (halved for very short buffers so the
  // in/out ramps never overlap).
  const fade = Math.min(Math.floor(sr * 0.05), Math.floor(n / 2));
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < fade) env = i / fade;
      else if (i > n - fade) env = (n - i) / fade;
      d[i] = Math.sin(omega * i) * amp * env;
    }
  }
  return buf;
}

// ────────── individual fillers ──────────

function fillWhiteNoise(buf: AudioBuffer): void {
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
  }
}

function fillPinkNoise(buf: AudioBuffer): void {
  // Paul Kellett's pink noise generator.
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      d[i] = pink * 0.11;
    }
  }
}

function fillSubSweep(buf: AudioBuffer, sr: number): void {
  const start = 20;
  const end = 200;
  const n = buf.length;
  const fade = Math.floor(sr * 0.05);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const f = start * Math.pow(end / start, t);
      phase += 2 * Math.PI * f / sr;
      let env = 0.7;
      if (i < fade) env *= i / fade;
      else if (i > n - fade) env *= (n - i) / fade;
      d[i] = Math.sin(phase) * env;
    }
  }
}

function fillKick(buf: AudioBuffer, sr: number): void {
  const n = buf.length;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 9);
      const f = 90 * Math.exp(-t * 12) + 35;
      phase += 2 * Math.PI * f / sr;
      const click = Math.exp(-t * 80) * (Math.random() * 2 - 1) * 0.3;
      d[i] = (Math.sin(phase) * env + click) * 0.85;
    }
  }
}

function fillSnare(buf: AudioBuffer, sr: number): void {
  const n = buf.length;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 7);
      const body = Math.sin(phase) * 0.4;
      phase += 2 * Math.PI * 220 / sr;
      const noise = (Math.random() * 2 - 1) * 0.7 * Math.exp(-t * 11);
      // High-passed noise simulated as differentiated noise
      d[i] = (body + noise) * env;
    }
  }
}

function fillVocalAaah(buf: AudioBuffer, sr: number): void {
  const n = buf.length;
  const formants = [
    { f: 700, amp: 1.0 },
    { f: 1220, amp: 0.6 },
    { f: 2600, amp: 0.4 },
    { f: 3800, amp: 0.15 },
  ];
  const f0 = 130;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const phases = formants.map(() => 0);
    let f0phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t * 4) * Math.min(1, (n - i) / sr * 4);
      // Sawtooth-ish source.
      f0phase += 2 * Math.PI * f0 / sr;
      const src = Math.sin(f0phase) + 0.4 * Math.sin(2 * f0phase) + 0.2 * Math.sin(3 * f0phase);
      // Sum of formant resonances (just additive sines tracking the source).
      let s = 0;
      for (let k = 0; k < formants.length; k++) {
        phases[k] += 2 * Math.PI * formants[k].f / sr;
        s += Math.sin(phases[k]) * formants[k].amp * (Math.abs(src) > 0.5 ? 1 : 0.6);
      }
      d[i] = s * 0.08 * env;
    }
  }
}

function fillVocalSss(buf: AudioBuffer, sr: number): void {
  const n = buf.length;
  // Highpassed noise pulse: synth as band-passed noise centred ~7 kHz.
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-Math.abs(t - 1) * 4);
      const w = Math.random() * 2 - 1;
      // simple first-order high-pass diff to brighten the noise
      const hp = w - prev * 0.4;
      prev = w;
      d[i] = hp * env * 0.45;
    }
  }
}

function fillHihat(buf: AudioBuffer, sr: number): void {
  const n = buf.length;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 30);
      const w = Math.random() * 2 - 1;
      const hp = w - prev * 0.92;
      prev = w;
      d[i] = hp * env * 0.55;
    }
  }
}

function fillPiano(buf: AudioBuffer, sr: number, freq: number): void {
  const n = buf.length;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let phase = 0;
    let phase2 = 0;
    let phase3 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 3) * (1 - Math.exp(-t * 200));
      phase += 2 * Math.PI * freq / sr;
      phase2 += 2 * Math.PI * (freq * 2) / sr;
      phase3 += 2 * Math.PI * (freq * 3) / sr;
      d[i] = (Math.sin(phase) * 1 + Math.sin(phase2) * 0.55 * Math.exp(-t * 5) + Math.sin(phase3) * 0.25 * Math.exp(-t * 8)) * env * 0.18;
    }
  }
}

function fillSynthPad(buf: AudioBuffer, sr: number): void {
  const n = buf.length;
  const partials = [220, 277.18, 329.63, 440]; // A3 major chord
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const phases = partials.map(() => Math.random() * Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t * 2) * Math.min(1, (n - i) / sr * 2);
      // Slight per-channel detune for stereo lushness.
      let s = 0;
      for (let k = 0; k < partials.length; k++) {
        const detune = ch === 0 ? 1 : 1.003;
        phases[k] += 2 * Math.PI * partials[k] * detune / sr;
        s += Math.sin(phases[k]) * 0.25;
      }
      d[i] = s * env * 0.6;
    }
  }
}

function fillTone(buf: AudioBuffer, sr: number, freq: number): void {
  const n = buf.length;
  const fade = Math.floor(sr * 0.05);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let env = 0.5;
      if (i < fade) env *= i / fade;
      else if (i > n - fade) env *= (n - i) / fade;
      d[i] = Math.sin(2 * Math.PI * freq * i / sr) * env;
    }
  }
}
