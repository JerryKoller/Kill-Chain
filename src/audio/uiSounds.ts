/**
 * uiSounds — synthesized, per-interaction UI feedback (no audio assets).
 *
 * Every interaction class gets its OWN voice — mil-spec hardware, not arcade:
 *
 *   tab          view/tab switch — filtered contact tick, pitch steps between
 *                two close notes on successive switches
 *   knob         ratchet tick stream for knob/slider drags — pitch tracks the
 *                control position, rate-limited so a drag never buzzes
 *   toggle-on    light two-stage settings switch, rising
 *   toggle-off   the same switch, falling
 *   engage       DSP chain goes live — firm two-stage click + faint ring
 *   disengage    DSP chain to standby — single lower click
 *   press        generic soft button click
 *   purge        destructive confirm — low damped thunk
 *   denied       dull double-buzz (action refused)
 *   success      brief affirmative blip pair
 *   modal-open   short servo/air swish up
 *   modal-close  the swish mirrored down
 *   preset       preset load — mechanical latch clack
 *
 * Architecture notes:
 *  - Self-contained private AudioContext (same pattern as splashSound.ts) so
 *    feedback never enters the main DSP/limiter chain or the analysers.
 *  - The context is created lazily and resumed on demand; useUiSounds also
 *    installs a pointerdown rescue that resumes a suspended context on the
 *    first real gesture (Electron allows autoplay, plain browsers don't).
 *  - WHY THE OLD VERSION WAS "SILENT": voices peaked at 0.07–0.16 and the
 *    master gain double-scaled (volume 0.5 × 0.5 internal = 0.25), landing
 *    the output at −28…−36 dBFS for 10–45 ms — measurably present at the
 *    destination but perceptually inaudible next to the −3 dBFS boot sting.
 *    Voices now peak at proper levels through a perceptual volume curve.
 *  - A global rate limiter (plus per-type floors) keeps rapid interaction
 *    bursts from stacking into a loud mess; specific sounds fired from store
 *    subscriptions naturally suppress the generic press that follows in the
 *    same click dispatch.
 */

export type UiSoundType =
  | "tab"
  | "knob"
  | "toggle-on"
  | "toggle-off"
  | "engage"
  | "disengage"
  | "press"
  | "purge"
  | "denied"
  | "success"
  | "modal-open"
  | "modal-close"
  | "preset";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = false;
let volume = 0.5; // 0..1 user pref (Settings → UI sound volume)
let sinkId = ""; // "" = system default output

/** Perceptual volume curve — default 0.5 lands at a clearly audible ~−9 dB bus. */
function masterGainFor(v: number): number {
  return 0.9 * Math.pow(Math.max(0, Math.min(1, v)), 1.35);
}

function applySink(c: AudioContext): void {
  const anyCtx = c as AudioContext & {
    setSinkId?: (id: string) => Promise<void>;
    sinkId?: string;
  };
  if (typeof anyCtx.setSinkId !== "function") return;
  if ((anyCtx.sinkId ?? "") === sinkId) return;
  anyCtx.setSinkId(sinkId).catch(() => {
    /* stale device id — stay on the default output */
  });
}

/**
 * Route UI feedback to the SAME output device as the main engine
 * (Settings → Audio Routing). Without this, UI sounds always went to the
 * Windows DEFAULT device — inaudible whenever the app is routed to a
 * different endpoint (headphones), which read as "UI sounds don't play".
 */
export function setUiSoundsSink(deviceId: string): void {
  sinkId = deviceId || "";
  if (ctx) applySink(ctx);
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor({ latencyHint: "interactive" });
      master = ctx.createGain();
      master.gain.value = masterGainFor(volume);
      master.connect(ctx.destination);
      if (sinkId) applySink(ctx);
    } catch {
      return null;
    }
  }
  // Contexts created before a gesture start suspended in plain browsers;
  // resuming inside a click/key handler is always permitted.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Resume the context if a browser left it suspended (pointerdown rescue). */
export function resumeUiAudioIfSuspended(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/** Internal handle for sibling modules (uiSoundsRiff) — same bus, same gate. */
export function getUiAudio(): { ctx: AudioContext; master: GainNode } | null {
  if (!enabled) return null;
  const c = ensureCtx();
  if (!c || !master) return null;
  return { ctx: c, master };
}

export function setUiSoundsEnabled(on: boolean): void {
  enabled = on;
  if (on) ensureCtx();
}

export function setUiSoundsVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterGainFor(volume);
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/** Minimum gap between ANY two sounds — a specific sound played from a store
 *  subscription silences the generic press arriving in the same dispatch. */
const GLOBAL_MIN_GAP_MS = 26;

/** Per-type floors so even spammed controls stay tasteful. */
const TYPE_MIN_GAP_MS: Record<UiSoundType, number> = {
  tab: 80,
  knob: 30,
  "toggle-on": 110,
  "toggle-off": 110,
  engage: 150,
  disengage: 150,
  press: 50,
  purge: 250,
  denied: 180,
  success: 120,
  "modal-open": 120,
  "modal-close": 120,
  preset: 150,
};

let lastPlayAt = -1e9;
const lastTypeAt: Partial<Record<UiSoundType, number>> = {};

// ── Performance-context suppression ─────────────────────────────────────────
// The Macro Reactor flips the DSP chain live when a pad engages from clean
// standby (and back on stand-down). During a live performance the ENGAGE
// clunk + metal riff on every first strike ruins the effect (issue #3), so
// the reactor marks its programmatic bypass flips as "quiet" and the store
// subscription in useUiSounds skips the engage/disengage voices for them.
let engageSuppressUntil = 0;

/** Mark the next `ms` milliseconds of bypass flips as silent (no clunk/riff). */
export function suppressEngageSounds(ms = 500): void {
  engageSuppressUntil = Math.max(engageSuppressUntil, performance.now() + ms);
}

export function engageSoundsSuppressed(): boolean {
  return performance.now() < engageSuppressUntil;
}

/** Did `type` play within the last `ms` milliseconds? (used by the riff module
 *  to e.g. skip the disengage down-chug right after a purge thunk). */
export function uiSoundRecentlyPlayed(type: UiSoundType, ms: number): boolean {
  const at = lastTypeAt[type];
  return at !== undefined && performance.now() - at < ms;
}

// ── Small synth helpers ─────────────────────────────────────────────────────

interface ToneSpec {
  freq: number;
  /** Exponential glide target; defaults to a slight downward settle. */
  endFreq?: number;
  dur: number;
  type?: OscillatorType;
  peak: number;
  delay?: number;
  attack?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
}

function tone(c: AudioContext, out: GainNode, s: ToneSpec): void {
  const t0 = c.currentTime + (s.delay ?? 0);
  const atk = s.attack ?? 0.003;
  const osc = c.createOscillator();
  osc.type = s.type ?? "sine";
  osc.frequency.setValueAtTime(s.freq, t0);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(30, s.endFreq ?? s.freq * 0.82),
    t0 + s.dur,
  );
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(s.peak, t0 + atk);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);
  let head: AudioNode = osc;
  if (s.filter) {
    const f = c.createBiquadFilter();
    f.type = s.filter.type;
    f.frequency.value = s.filter.freq;
    f.Q.value = s.filter.q ?? 1;
    head.connect(f);
    head = f;
  }
  head.connect(env).connect(out);
  osc.start(t0);
  osc.stop(t0 + s.dur + 0.03);
  osc.onended = () => {
    try { osc.disconnect(); } catch { /* ignore */ }
    try { env.disconnect(); } catch { /* ignore */ }
  };
}

interface NoiseSpec {
  dur: number;
  peak: number;
  delay?: number;
  attack?: number;
  bp?: { freq: number; endFreq?: number; q?: number };
  lp?: { from: number; to: number };
}

let noiseBuf: AudioBuffer | null = null;

/** 180 ms deterministic white-noise buffer, built once, offsets randomized. */
function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.ceil(0.18 * c.sampleRate);
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let seed = 0x9e3779b9;
  for (let i = 0; i < len; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
  }
  return noiseBuf;
}

function noise(c: AudioContext, out: GainNode, s: NoiseSpec): void {
  const t0 = c.currentTime + (s.delay ?? 0);
  const atk = s.attack ?? 0.002;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  let head: AudioNode = src;
  if (s.bp) {
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(s.bp.freq, t0);
    if (s.bp.endFreq) f.frequency.exponentialRampToValueAtTime(s.bp.endFreq, t0 + s.dur);
    f.Q.value = s.bp.q ?? 1.4;
    head.connect(f);
    head = f;
  }
  if (s.lp) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(s.lp.from, t0);
    f.frequency.exponentialRampToValueAtTime(s.lp.to, t0 + s.dur);
    head.connect(f);
    head = f;
  }
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(s.peak, t0 + atk);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);
  head.connect(env).connect(out);
  src.start(t0);
  src.stop(t0 + s.dur + 0.03);
  src.onended = () => {
    try { src.disconnect(); } catch { /* ignore */ }
    try { env.disconnect(); } catch { /* ignore */ }
  };
}

// ── Per-type voices ─────────────────────────────────────────────────────────

let tabFlip = false;
let lastKnobNorm = 0.5;

function synthesize(c: AudioContext, out: GainNode, type: UiSoundType, norm: number): void {
  switch (type) {
    case "tab": {
      // Channel-selector tick: contact spike + short filtered body that steps
      // between two close pitches on successive switches.
      tabFlip = !tabFlip;
      const body = tabFlip ? 908 : 760;
      tone(c, out, { freq: 2300, dur: 0.009, peak: 0.16 });
      tone(c, out, {
        freq: body, endFreq: body * 0.9, dur: 0.046, type: "square", peak: 0.2,
        filter: { type: "bandpass", freq: body, q: 3.2 }, delay: 0.004,
      });
      noise(c, out, { dur: 0.012, peak: 0.07, bp: { freq: 4200, q: 2 } });
      break;
    }
    case "knob": {
      // Detented ratchet: a dry, woody tick whose pitch tracks the position —
      // rising as the value climbs, falling as it drops.
      const f = 1150 + norm * 950;
      tone(c, out, {
        freq: f, endFreq: f * 0.75, dur: 0.013, type: "triangle", peak: 0.15,
        filter: { type: "highpass", freq: 650, q: 0.7 }, attack: 0.0015,
      });
      noise(c, out, { dur: 0.007, peak: 0.045, bp: { freq: 3200, q: 1.6 } });
      break;
    }
    case "toggle-on":
      // Light settings switch — rising two-step.
      tone(c, out, { freq: 520, dur: 0.038, peak: 0.24 });
      tone(c, out, { freq: 780, dur: 0.05, peak: 0.26, delay: 0.045 });
      break;
    case "toggle-off":
      tone(c, out, { freq: 640, dur: 0.038, peak: 0.22 });
      tone(c, out, { freq: 430, dur: 0.05, peak: 0.24, delay: 0.045 });
      break;
    case "engage": {
      // Breaker thrown: small arming tick, then a solid low contact with a
      // faint metallic ring. Firm, positive, two-stage.
      tone(c, out, { freq: 1900, dur: 0.009, peak: 0.18 });
      tone(c, out, {
        freq: 250, endFreq: 165, dur: 0.064, type: "square", peak: 0.46,
        filter: { type: "lowpass", freq: 900, q: 0.8 }, delay: 0.03,
      });
      noise(c, out, { dur: 0.05, peak: 0.09, bp: { freq: 2900, q: 14 }, delay: 0.03 });
      break;
    }
    case "disengage":
      // Breaker released — one lower, softer contact.
      tone(c, out, { freq: 850, dur: 0.008, peak: 0.11 });
      tone(c, out, {
        freq: 200, endFreq: 128, dur: 0.058, type: "square", peak: 0.36,
        filter: { type: "lowpass", freq: 700, q: 0.8 }, delay: 0.006,
      });
      break;
    case "press":
      // Neutral soft click for any ordinary button.
      tone(c, out, { freq: 1700, dur: 0.01, peak: 0.19 });
      tone(c, out, { freq: 470, endFreq: 330, dur: 0.034, peak: 0.27, delay: 0.002 });
      break;
    case "purge":
      // Destructive confirm: a low, damped thunk. No ring, no shine.
      tone(c, out, { freq: 130, endFreq: 52, dur: 0.115, peak: 0.5, attack: 0.004 });
      noise(c, out, { dur: 0.04, peak: 0.26, lp: { from: 1400, to: 240 } });
      break;
    case "denied": {
      // Dull double-buzz — flat, low, unmistakably "no".
      const buzz = (delay: number, f: number) =>
        tone(c, out, {
          freq: f, endFreq: f * 0.94, dur: 0.052, type: "square", peak: 0.3,
          filter: { type: "lowpass", freq: 520, q: 0.9 }, delay, attack: 0.004,
        });
      buzz(0, 150);
      buzz(0.066, 138);
      break;
    }
    case "success":
      // Brief affirmative pair — restrained, not a jingle.
      tone(c, out, { freq: 640, dur: 0.04, peak: 0.2 });
      tone(c, out, { freq: 962, dur: 0.046, peak: 0.2, delay: 0.042 });
      break;
    case "modal-open":
      // Short servo/air swish upward with a soft seat tick at the end.
      noise(c, out, { dur: 0.085, peak: 0.15, attack: 0.012, bp: { freq: 380, endFreq: 1500, q: 1.4 } });
      tone(c, out, { freq: 1400, dur: 0.009, peak: 0.09, delay: 0.078 });
      break;
    case "modal-close":
      noise(c, out, { dur: 0.08, peak: 0.13, attack: 0.01, bp: { freq: 1400, endFreq: 360, q: 1.4 } });
      tone(c, out, { freq: 900, dur: 0.009, peak: 0.09, delay: 0.072 });
      break;
    case "preset":
      // Magazine seated: metallic contact then the body clack.
      noise(c, out, { dur: 0.016, peak: 0.26, bp: { freq: 2600, q: 7 } });
      tone(c, out, { freq: 1800, dur: 0.007, peak: 0.1, delay: 0.024 });
      tone(c, out, {
        freq: 340, endFreq: 225, dur: 0.05, type: "square", peak: 0.38,
        filter: { type: "lowpass", freq: 1200, q: 0.8 }, delay: 0.024,
      });
      break;
  }
}

/**
 * Play one UI sound. `norm` (0..1) only affects the "knob" ratchet pitch.
 * Gated by the Settings toggle, globally rate-limited, per-type floored.
 */
export function playUi(type: UiSoundType, norm = 0.5): void {
  if (!enabled) return;
  const now = performance.now();
  if (now - lastPlayAt < GLOBAL_MIN_GAP_MS) return;
  const typeAt = lastTypeAt[type];
  if (typeAt !== undefined && now - typeAt < TYPE_MIN_GAP_MS[type]) return;
  const c = ensureCtx();
  if (!c || !master) return;
  lastPlayAt = now;
  lastTypeAt[type] = now;
  const clamped = Math.max(0, Math.min(1, norm));
  if (type === "knob") lastKnobNorm = clamped;
  synthesize(c, master, type, clamped);
}

// ── Legacy API (kept so existing call sites keep working unchanged) ─────────

/** @deprecated Use playUi("press"). */
export function uiClick(): void {
  playUi("press");
}

/** @deprecated Use playUi("knob", norm). Knob/slider ratchet tick. */
export function uiTick(norm = lastKnobNorm): void {
  playUi("knob", norm);
}

/** @deprecated Use playUi("toggle-on" | "toggle-off"). */
export function uiToggle(on: boolean): void {
  playUi(on ? "toggle-on" : "toggle-off");
}
