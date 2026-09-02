/**
 * fireStudio — Fire Command's export + project I/O.
 *
 * AUDIO EXPORT (WAV or MP3 320): records ONE full pass (pattern loop or the
 * arrangement playlist, plus a release tail) from the engine's clean synth+drums
 * tap — no player audio, no chain FX — then encodes and hands it to the OS
 * save dialog.
 *
 * STEMS EXPORT (v1.6, arrangement-aware): the same single real-time pass captured
 * from SIX taps at once — four dry part stems (Synth A, Synth B, drums,
 * sample deck), the dry Fire master, and the THROUGH-CHAIN master (what the
 * full Kill-Chain engine makes of it). All six land in one folder, sample-
 * aligned, ready for a DAW A/B.
 *
 * PROJECTS (.kcproj v2): the synth patch + arp + the whole arrangement
 * (sections, arrangement clips, play mode, sample lanes with their file paths) as JSON.
 * v1 files still open — the store migrates them to a one-pattern arrangement.
 */

import { getEngine, type FireMixPart } from "@/audio/AudioEngine";
import { FireCommandSynth } from "@/audio/dsp/FireCommandSynth";
import { FireDrumKit, makeSafetyClipCurve, SAFETY_CLIP_RANGE, DRUM_LANES } from "@/audio/dsp/FireDrumKit";
import { useFireCommandStore, slotsFromState, SCENE_SLOTS } from "@/state/fireCommandStore";
import { useAudioStore } from "@/state/audioStore";
import {
  useFireSequencerStore,
  serializePattern,
  songTotalSteps,
  STEPS_PER_BAR,
  scheduleFirePass,
  peekSampleBuffer,
  loadSampleBuffer,
  MIXER_PARTS,
  peekArrangementCueStep,
  setArrangementCueStep,
  stampLivePatchesOntoActiveSectionNow,
  type FireSequencerState,
} from "@/state/fireSequencerStore";
import { coerceDrumStep } from "@/components/FireCommand/drumClarity";
import { clearFireHistory } from "@/lib/fireHistory";

const PROJECT_VERSION = 3;

export type ExportFormat = "wav" | "mp3";

function drumGridHasHits(drums: FireSequencerState["drums"]): boolean {
  for (const lane of DRUM_LANES) {
    const steps = drums.steps[lane.id];
    if (!steps) continue;
    for (const cell of steps) {
      if (coerceDrumStep(cell).vel > 0) return true;
    }
  }
  return false;
}

/** True when pattern / arrangement / sample deck has something to bounce. */
export function hasFireAudibleContent(seq: FireSequencerState = useFireSequencerStore.getState()): boolean {
  if (seq.notes.length > 0) return true;
  if (seq.drumsEnabled && drumGridHasHits(seq.drums)) return true;
  for (const sl of seq.samples) {
    for (const cell of sl.steps) {
      if (coerceDrumStep(cell).vel > 0) return true;
    }
  }
  for (const sec of seq.sections) {
    if (sec.notes.length > 0) return true;
    if (drumGridHasHits(sec.drums)) return true;
    for (const steps of Object.values(sec.sampleSteps ?? {})) {
      for (const cell of steps) {
        if (coerceDrumStep(cell).vel > 0) return true;
      }
    }
  }
  for (const clip of seq.arrangement) {
    if ((clip.local?.notes?.length ?? 0) > 0) return true;
    if (clip.local?.drums && drumGridHasHits(clip.local.drums)) return true;
    for (const steps of Object.values(clip.local?.sampleSteps ?? {})) {
      for (const cell of steps) {
        if (coerceDrumStep(cell).vel > 0) return true;
      }
    }
  }
  return false;
}

/** Resolve sample paths; returns filenames that failed to decode. */
export async function findMissingSamplePaths(
  seq: FireSequencerState = useFireSequencerStore.getState(),
): Promise<string[]> {
  const paths = new Set<string>();
  for (const sl of seq.samples) if (sl.path) paths.add(sl.path);
  for (const lane of DRUM_LANES) {
    const hit = seq.drumSamples[lane.id];
    if (hit?.path) paths.add(hit.path);
  }
  const missing: string[] = [];
  for (const p of paths) {
    const buf = peekSampleBuffer(p) ?? await loadSampleBuffer(p);
    if (!buf) missing.push(p);
  }
  return missing;
}

export interface ExportPreflight {
  ok: boolean;
  reason?: string;
  missingSamples: string[];
}

/** Shared gate for WAV / stems export. */
export async function fireExportPreflight(): Promise<ExportPreflight> {
  const seq = useFireSequencerStore.getState();
  if (!hasFireAudibleContent(seq)) {
    return {
      ok: false,
      reason: "Nothing to export — draw notes, drums, or sample-deck hits first",
      missingSamples: [],
    };
  }
  const missingSamples = await findMissingSamplePaths(seq);
  return { ok: true, missingSamples };
}

// ── WAV encode ──────────────────────────────────────────────────────────────

/** Float sample → PCM16 with symmetric rounding: −1.0 maps to −32768 and
 *  values round to nearest instead of truncating toward zero (truncation put
 *  a subtle DC/quantization bias on every export). */
function toPcm16(v: number): number {
  const x = Math.max(-1, Math.min(1, v));
  const s = Math.round(x < 0 ? x * 32768 : x * 32767);
  return Math.max(-32768, Math.min(32767, s));
}

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  // Mismatched channel lengths would read undefined → NaN → encode garbage.
  const frames = Math.min(left.length, right.length);
  const bytesPerSample = 2;
  const blockAlign = 2 * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(o, toPcm16(left[i]), true);
    view.setInt16(o + 2, toPcm16(right[i]), true);
    o += 4;
  }
  return new Uint8Array(buf);
}

// ── MP3 encode (lazy-loaded lamejs, 320 kbps CBR) ───────────────────────────

function f32ToI16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = toPcm16(src[i]);
  }
  return out;
}

export async function encodeMp3(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Promise<Uint8Array> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(2, sampleRate, 320);
  // Encode only the frames BOTH channels have, exactly like encodeWav. This
  // used to iterate on the left channel alone, so a realtime capture whose
  // taps ended a few frames apart fed the encoder a short/undefined right
  // block and produced channel-skewed audio at the tail.
  const frames = Math.min(left.length, right.length);
  const l16 = f32ToI16(left.subarray(0, frames));
  const r16 = f32ToI16(right.subarray(0, frames));
  const BLOCK = 1152;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < frames; i += BLOCK) {
    const end = Math.min(i + BLOCK, frames);
    const part = enc.encodeBuffer(l16.subarray(i, end), r16.subarray(i, end));
    if (part.length > 0) chunks.push(part);
  }
  const tail = enc.flush();
  if (tail.length > 0) chunks.push(tail);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function encodeAs(
  format: ExportFormat,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Promise<Uint8Array> {
  return format === "mp3" ? encodeMp3(left, right, sampleRate) : encodeWav(left, right, sampleRate);
}

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(out);
}

// ── Real-time multi-tap recorder ────────────────────────────────────────────

export interface ExportProgress {
  stage: string;
  fraction: number;
}

interface TapRecorder {
  chunksL: Float32Array[];
  chunksR: Float32Array[];
  detach: () => void;
}

/** ScriptProcessor tap: output feeds a muted gain so the node pulls. */
function attachRecorder(
  ctx: AudioContext,
  tap: AudioNode,
  isRecording: () => boolean,
): TapRecorder {
  const proc = ctx.createScriptProcessor(4096, 2, 2);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  tap.connect(proc);
  proc.connect(sink).connect(ctx.destination);
  const chunksL: Float32Array[] = [];
  const chunksR: Float32Array[] = [];
  proc.onaudioprocess = (e) => {
    if (!isRecording()) return;
    chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
  };
  return {
    chunksL,
    chunksR,
    detach: () => {
      try { tap.disconnect(proc); } catch { /* ignore */ }
      try { proc.disconnect(); } catch { /* ignore */ }
      try { sink.disconnect(); } catch { /* ignore */ }
    },
  };
}

function joined(rec: TapRecorder): { left: Float32Array; right: Float32Array } {
  const frames = rec.chunksL.reduce((n, c) => n + c.length, 0);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let off = 0;
  for (let i = 0; i < rec.chunksL.length; i++) {
    left.set(rec.chunksL[i], off);
    right.set(rec.chunksR[i], off);
    off += rec.chunksL[i].length;
  }
  return { left, right };
}

/** First frame above the noise floor, minus a 10 ms pre-roll. */
function firstAudibleFrame(left: Float32Array, right: Float32Array, sampleRate: number): number {
  for (let i = 0; i < left.length; i++) {
    if (Math.abs(left[i]) > 0.001 || Math.abs(right[i]) > 0.001) {
      return Math.max(0, i - Math.round(sampleRate * 0.01));
    }
  }
  return 0;
}

/** One full pass duration (seconds) for the current play mode, tail included. */
function passSeconds(): { totalSec: number; song: boolean } {
  const seq = useFireSequencerStore.getState();
  const stepSec = 60 / seq.bpm / 4;
  const song = seq.playMode === "arrangement";
  let steps: number;
  if (song) {
    steps = songTotalSteps(seq);
  } else if (seq.playScope === "selection") {
    const patternTotal = seq.bars * STEPS_PER_BAR;
    const selStart = Math.max(0, Math.min(patternTotal - 1, seq.selectionStart ?? 0));
    const selEnd = Math.max(selStart + 1, Math.min(patternTotal, seq.selectionEnd ?? patternTotal));
    steps = Math.max(1, selEnd - selStart);
  } else {
    steps = seq.bars * STEPS_PER_BAR;
  }
  return { totalSec: steps * stepSec + 1.6, song };
}

/** Play one pass while the recorders roll, reporting progress. */
async function recordOnePass(
  totalSec: number,
  stageLabel: string,
  setRecording: (on: boolean) => void,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  const seq = useFireSequencerStore.getState();
  if (seq.playing) seq.stop();
  // Realtime export must start at bar 0 — offline bounce already does.
  const savedCue = peekArrangementCueStep();
  setArrangementCueStep(0);
  try {
    setRecording(true);
    useFireSequencerStore.getState().play();
    onProgress?.({ stage: stageLabel, fraction: 0 });
    const t0 = performance.now();
    while (performance.now() - t0 < totalSec * 1000) {
      await new Promise((r) => setTimeout(r, 120));
      onProgress?.({
        stage: stageLabel,
        fraction: Math.min(0.8, ((performance.now() - t0) / 1000 / totalSec) * 0.8),
      });
    }
  } finally {
    setRecording(false);
    useFireSequencerStore.getState().stop();
    setArrangementCueStep(savedCue);
  }
}

// ── Pattern / song export ───────────────────────────────────────────────────

function copyBufferTo(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const dst = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    dst.copyToChannel(src.getChannelData(c), c);
  }
  return dst;
}

/**
 * Dry Fire bounce on OfflineAudioContext (A/B/drums/samples + mixer → destination).
 * Does not run the Kill-Chain mastering chain.
 * @param solo When set, mute every other part bus (for offline stems).
 */
async function offlineDryBounce(
  onProgress?: (p: ExportProgress) => void,
  solo?: FireMixPart | "master",
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number; totalSec: number; song: boolean }> {
  // Flush any pending Cave stamp before freezing section snapshots for bounce.
  stampLivePatchesOntoActiveSectionNow();
  const live = getEngine();
  const sr = live.ctx.sampleRate || 48000;
  const seq = useFireSequencerStore.getState();
  const { totalSec, song } = passSeconds();

  // Prefetch any sample paths so the offline kit can copy them.
  const paths = new Set<string>();
  for (const sl of seq.samples) if (sl.path) paths.add(sl.path);
  for (const lane of DRUM_LANES) {
    const hit = seq.drumSamples[lane.id];
    if (hit?.path) paths.add(hit.path);
  }
  await Promise.all([...paths].map((p) => loadSampleBuffer(p)));

  const frames = Math.max(1, Math.ceil(totalSec * sr));
  const octx = new OfflineAudioContext(2, frames, sr);

  const fireBus = octx.createGain();
  // Mirror the LIVE bus exactly (AudioEngine): same −1.4 dB summing pad —
  // the offline graph used to leave this at unity, so exports ran ~4.7 dB
  // hotter into the limiter than live playback and sounded crunchier than
  // what the user had dialed in.
  fireBus.gain.value = 0.85;
  const fireMasterGain = octx.createGain();
  const fireBusPad = octx.createGain();
  fireBusPad.gain.value = 1 / SAFETY_CLIP_RANGE;
  const fireBusClip = octx.createWaveShaper();
  fireBusClip.curve = makeSafetyClipCurve();
  fireBusClip.oversample = "2x";
  fireBus.connect(fireMasterGain);
  // Same kc-limiter worklet as live (lookahead, no auto-makeup). Fall back
  // to a DynamicsCompressor only if the module fails to load offline.
  let limiterIn: AudioNode;
  let limiterOut: AudioNode;
  let setLimiterBypassed: (b: boolean) => void;
  try {
    const url = new URL("worklets/limiter-processor.js", document.baseURI).toString();
    await octx.audioWorklet.addModule(url);
    const worklet = new AudioWorkletNode(octx, "kc-limiter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    limiterIn = worklet;
    limiterOut = worklet;
    setLimiterBypassed = (b) => worklet.parameters.get("bypass")?.setValueAtTime(b ? 1 : 0, 0);
  } catch (err) {
    console.warn("[fireStudio] offline limiter worklet failed — DynComp fallback:", err);
    // Settings match AudioEngine's live stand-in exactly (−2.8 / knee 10 /
    // ratio 10 / 0.1 release). They used to differ (−3.0 / knee 0 / ratio 20),
    // so a worklet load failure exported noticeably harsher than it sounded.
    const dyn = octx.createDynamicsCompressor();
    dyn.threshold.value = -2.8;
    dyn.knee.value = 10;
    dyn.ratio.value = 10;
    dyn.attack.value = 0.002;
    dyn.release.value = 0.1;
    limiterIn = dyn;
    limiterOut = dyn;
    setLimiterBypassed = (b) => {
      dyn.threshold.value = b ? 0 : -2.8;
      dyn.ratio.value = b ? 1 : 10;
    };
  }
  fireMasterGain.connect(limiterIn);
  limiterOut.connect(fireBusPad);
  fireBusPad.connect(fireBusClip).connect(octx.destination);

  const mkPart = () => {
    const gain = octx.createGain();
    const pan = octx.createStereoPanner();
    gain.connect(pan);
    return { gain, pan };
  };
  const parts = { a: mkPart(), b: mkPart(), drums: mkPart(), samples: mkPart() };
  const fireDuck = octx.createGain();
  // Duck HPF split — mirrors AudioEngine's wiring. Without it the bounce
  // ducked Synth A full-band while live let the highs bypass the duck, so any
  // patch with a duck HPF exported with the wrong sidechain character.
  {
    const duckHpfHz = Math.max(0, Math.min(500, seq.duckHpfHz ?? 0));
    const split = duckHpfHz > 20;
    if (split) {
      const mkLr2 = (type: "lowpass" | "highpass") => {
        const a = octx.createBiquadFilter();
        const b = octx.createBiquadFilter();
        a.type = type; b.type = type;
        a.frequency.value = duckHpfHz; b.frequency.value = duckHpfHz;
        a.Q.value = 0.7071; b.Q.value = 0.7071;
        a.connect(b);
        return { in: a, out: b };
      };
      const duckLp = mkLr2("lowpass");
      const duckHp = mkLr2("highpass");
      parts.a.pan.connect(duckLp.in);
      duckLp.out.connect(fireDuck);      // lows are ducked
      parts.a.pan.connect(duckHp.in);
      duckHp.out.connect(fireBus);       // highs bypass the duck
    } else {
      parts.a.pan.connect(fireDuck);
    }
  }
  fireDuck.connect(fireBus);
  parts.b.pan.connect(fireBus);
  parts.drums.pan.connect(fireBus);
  parts.samples.pan.connect(fireBus);

  const fireCommand = new FireCommandSynth(octx, parts.a.gain);
  fireCommand.offlineSafe = true;
  const fireCommandB = new FireCommandSynth(octx, parts.b.gain);
  fireCommandB.offlineSafe = true;
  const fireDrums = new FireDrumKit(octx, parts.drums.gain, parts.samples.gain);

  const fire = useFireCommandStore.getState();
  const { patchA, patchB } = slotsFromState(fire);
  fireCommand.setPatch(patchA);
  fireCommandB.setPatch(patchB);
  // Await the async worklets BEFORE any note is scheduled: an offline render
  // starts immediately, so ladder/SVF voices were being built while the filter
  // worklet was still loading and silently fell back to the biquad path (and
  // spectral FX could miss the render window outright).
  await Promise.all([
    fireCommand.prewarmWorkletsForRender(),
    fireCommandB.prewarmWorkletsForRender(),
  ]);
  fireCommand.setMaxVoices(fire.maxVoices);
  fireCommandB.setMaxVoices(fire.maxVoices);
  fireCommand.setHostBpm(seq.bpm);
  fireCommandB.setHostBpm(seq.bpm);

  // Mixer levels (immediate — offline clock starts at 0). Match live
  // applyMixerToEngine: trim, soloMode, master trim/dim.
  const anySolo = MIXER_PARTS.some((p) => seq.mixer[p].solo);
  const soloMode = seq.soloMode ?? "exclusive";
  for (const p of MIXER_PARTS) {
    const m = seq.mixer[p];
    const trim = Math.max(0, Math.min(2, m.trim ?? 1));
    let muted = m.mute;
    let level = m.level * trim;
    if (anySolo) {
      if (soloMode === "exclusive") muted = muted || !m.solo;
      else if (soloMode === "dim" && !m.solo) level = level * 0.25;
      // additive: leave non-solo audible at full level
    }
    // Stem solo: silence every bus except the requested part.
    if (solo && solo !== "master" && solo !== p) {
      muted = true;
      level = 0;
    }
    parts[p].gain.gain.value = muted ? 0 : Math.max(0, Math.min(1.5, level));
    parts[p].pan.pan.value = Math.max(-1, Math.min(1, m.pan));
  }
  const masterTrim = Math.max(0, Math.min(2, seq.mixer.master.trim ?? 1));
  const dim = seq.masterDim ? 0.25 : 1;
  fireMasterGain.gain.value = seq.mixer.master.mute
    ? 0
    : Math.max(0, Math.min(1.5, seq.mixer.master.level * masterTrim * dim));
  if (!seq.fireLimiterOn) setLimiterBypassed(true);
  fireDrums.setLevel(seq.drumLevel);

  // Copy drum overrides + sample-deck buffers into the offline kit.
  for (const lane of DRUM_LANES) {
    const hit = seq.drumSamples[lane.id];
    if (!hit?.path) continue;
    const src = peekSampleBuffer(hit.path);
    if (src) fireDrums.setSample(lane.id, copyBufferTo(octx, src));
  }
  // Sample deck paths are looked up at schedule time via peekSampleBuffer on the
  // live cache — copy into a path→offline buffer map used by a thin wrapper.
  const offlineSampleByPath = new Map<string, AudioBuffer>();
  for (const sl of seq.samples) {
    if (!sl.path) continue;
    const src = peekSampleBuffer(sl.path);
    if (src) offlineSampleByPath.set(sl.path, copyBufferTo(octx, src));
  }

  const duck = (when: number, amount: number, releaseSec: number) => {
    // Solo drums/samples: keep duck math but it only affects A which may be muted.
    if (solo && solo !== "master" && solo !== "a") return;
    const g = fireDuck.gain;
    const t = Math.max(0, when);
    const dip = Math.max(0.02, 1 - Math.max(0, Math.min(1, amount)));
    // Match live AudioEngine.fireDuckTrigger attack → hold → release.
    const atk = Math.max(0.001, (seq.duckAttackMs ?? 8) / 1000);
    const hold = Math.max(0, (seq.duckHoldMs ?? 40) / 1000);
    const gg = g as AudioParam & { cancelAndHoldAtTime?: (at: number) => void };
    if (typeof gg.cancelAndHoldAtTime === "function") gg.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(dip, t + atk);
    g.setValueAtTime(dip, t + atk + hold);
    g.linearRampToValueAtTime(1, t + atk + hold + Math.max(0.02, releaseSec));
  };

  const stageLabel = solo && solo !== "master"
    ? `Offline stem (${solo})…`
    : song ? "Offline bounce (song)…" : "Offline bounce…";
  onProgress?.({ stage: stageLabel, fraction: 0.15 });

  // Wrap drums so sample-deck playBuffer uses offline-copied buffers,
  // and trigger opts (pan / polarity / hat choke) match the live kit.
  const drumsProxy = {
    trigger: (
      lane: (typeof DRUM_LANES)[number]["id"],
      when: number,
      velocity?: number,
      opts?: { pan?: number; polarity?: number; chokeOpenHat?: boolean },
    ) => fireDrums.trigger(lane, when, velocity, opts),
    playBuffer: (
      buffer: AudioBuffer,
      when: number,
      velocity?: number,
      level?: number,
      toSampleBus?: boolean,
    ) => {
      // Prefer offline copy when the live buffer was passed from the sequencer cache.
      let buf = buffer;
      for (const [path, offlineBuf] of offlineSampleByPath) {
        const liveBuf = peekSampleBuffer(path);
        if (liveBuf === buffer) { buf = offlineBuf; break; }
      }
      fireDrums.playBuffer(buf, when, velocity, level, toSampleBus);
    },
  };

  scheduleFirePass(
    seq,
    {
      fireCommand,
      fireCommandB,
      fireDrums: drumsProxy,
      fireDuckTrigger: duck,
    },
    0.05,
    1.6,
  );

  onProgress?.({ stage: "Rendering…", fraction: 0.45 });

  // ── Drive the 60 Hz modulation loop through the render ──
  // The live engine shapes the trance gate, sample-hold LFOs, matrix routes
  // and analog drift from a wall-clock timer that deliberately does not run
  // offline — so every bounce used to export with the gate wide open and
  // those modulators frozen at their initial value. OfflineAudioContext
  // suspends at a given render time, which lets us run the REAL tick (same
  // code as live) and resume, instead of reimplementing four subsystems.
  const MOD_STEP_SEC = 1 / 60;
  const quantum = 128 / sr; // suspend times must land on a render quantum
  const tickMods = () => {
    fireCommand.tickModulationForRender();
    fireCommandB.tickModulationForRender();
  };
  tickMods();
  const quantizeUp = (t: number) => Math.ceil(t / quantum) * quantum;
  // The FIRST suspension must be primed BEFORE startRendering: an offline
  // render runs as fast as the CPU allows, so a suspend requested afterwards
  // is already in the past and rejects (which silently disabled all of this).
  // Every subsequent suspension is scheduled while still paused, so it is
  // always ahead of the render head.
  let at = quantizeUp(MOD_STEP_SEC);
  let pending: Promise<void> | null = null;
  try {
    pending = at < totalSec ? octx.suspend(at) : null;
  } catch {
    pending = null;
  }
  const renderPromise = octx.startRendering();
  try {
    let lastReport = 0;
    while (pending) {
      await pending;
      tickMods();
      if (onProgress && at - lastReport > 1) {
        lastReport = at;
        onProgress({ stage: "Rendering…", fraction: 0.45 + 0.4 * (at / totalSec) });
      }
      const nextAt = quantizeUp(at + MOD_STEP_SEC);
      pending = nextAt < totalSec ? octx.suspend(nextAt) : null;
      at = nextAt;
      await octx.resume();
    }
  } catch {
    // suspend/resume unavailable in this runtime — let the render finish.
    // Worst case the bounce reverts to the old static-modulation behavior.
  }
  const rendered = await renderPromise;
  const left = rendered.getChannelData(0).slice();
  const right = rendered.numberOfChannels > 1
    ? rendered.getChannelData(1).slice()
    : left.slice();
  // Release the two throwaway synths built for this render. Each is a full
  // ~150-node graph with a generated reverb impulse response and its own
  // rendered wavetable banks, so every export (and every stem, since stems
  // bounce once per part) used to strand two of them for the rest of the
  // session. Measured at ~0.4 MB retained per synth.
  try { fireCommand.dispose(); } catch { /* best effort */ }
  try { fireCommandB.dispose(); } catch { /* best effort */ }
  return { left, right, sampleRate: sr, totalSec, song };
}

async function realtimeDryCapture(
  onProgress?: (p: ExportProgress) => void,
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number; totalSec: number; song: boolean }> {
  stampLivePatchesOntoActiveSectionNow();
  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;
  const { totalSec, song } = passSeconds();
  let recording = false;
  const rec = attachRecorder(ctx, engine.fireTap, () => recording);
  try {
    await recordOnePass(
      totalSec,
      song ? "Recording arrangement…" : "Recording pattern…",
      (on) => { recording = on; },
      onProgress,
    );
  } finally {
    rec.detach();
  }
  const { left, right } = joined(rec);
  return { left, right, sampleRate: ctx.sampleRate, totalSec, song };
}

export type ExportMethod = "offline" | "realtime";

/** Bounce Fire dry audio (trimmed). Used by OS save + Library export. */
export async function bounceFireDryAudio(
  onProgress?: (p: ExportProgress) => void,
): Promise<{
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  totalSec: number;
  song: boolean;
  method: ExportMethod;
} | null> {
  let method: ExportMethod = "offline";
  let audio: Awaited<ReturnType<typeof offlineDryBounce>>;
  try {
    audio = await offlineDryBounce(onProgress);
  } catch (err) {
    console.warn("[fireStudio] offline bounce failed, falling back to realtime:", err);
    method = "realtime";
    onProgress?.({ stage: "Realtime fallback…", fraction: 0.05 });
    audio = await realtimeDryCapture(onProgress);
  }
  const { left, right, sampleRate, totalSec, song } = audio;
  if (left.length === 0) return null;
  const first = firstAudibleFrame(left, right, sampleRate);
  const want = Math.min(left.length - first, Math.round(totalSec * sampleRate));
  if (want < sampleRate * 0.2) return null;
  return {
    left: left.subarray(first, first + want),
    right: right.subarray(first, first + want),
    sampleRate,
    totalSec,
    song,
    method,
  };
}

/**
 * Bounce one pass (section or whole song) and save via the OS dialog.
 * Prefers OfflineAudioContext dry Fire bounce; falls back to real-time capture.
 */
export async function exportPatternWav(
  onProgress?: (p: ExportProgress) => void,
  format: ExportFormat = "wav",
): Promise<{ path: string | null; method: ExportMethod } | null> {
  const files = window.playground?.files;
  if (!files) return null;

  const bounced = await bounceFireDryAudio(onProgress);
  if (!bounced) return { path: null, method: "offline" };
  const { left, right, sampleRate, song, method } = bounced;

  onProgress?.({ stage: format === "mp3" ? "Encoding MP3…" : "Encoding WAV…", fraction: 0.9 });
  const data = await encodeAs(format, left, right, sampleRate);
  onProgress?.({ stage: "Saving…", fraction: 0.97 });
  const base = song ? "kill-chain-arrangement" : "kill-chain-pattern";
  const path = await files.save(
    `${base}.${format}`,
    [format === "mp3"
      ? { name: "MP3 audio", extensions: ["mp3"] }
      : { name: "WAV audio", extensions: ["wav"] }],
    toBase64(data),
  );
  return { path, method };
}

// ── Chain-aware stems export (v1.6) ─────────────────────────────────────────

const STEM_PARTS: { part: FireMixPart; file: string; label: string }[] = [
  { part: "a", file: "stem-synth-a", label: "Synth A" },
  { part: "b", file: "stem-synth-b", label: "Synth B" },
  { part: "drums", file: "stem-drums", label: "Drums" },
  { part: "samples", file: "stem-samples", label: "Sample deck" },
];

export interface StemsResult {
  dir: string;
  written: string[];
  method: ExportMethod;
}

/**
 * Prefer offline per-bus bounces (4 parts + dry master). Kill-Chain master
 * (through the live FX graph) is included only on the realtime fallback path.
 */
export async function exportStems(
  onProgress?: (p: ExportProgress) => void,
  format: ExportFormat = "wav",
): Promise<StemsResult | null> {
  const files = window.playground?.files;
  const writeIn = files?.writeIn;
  if (!files?.pickOutputFolder || !writeIn) return null;
  const dir = await files.pickOutputFolder();
  if (!dir) return null;

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const written: string[] = [];

  const writeStem = async (
    name: string,
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
    totalSec: number,
    index: number,
    total: number,
    /**
     * Shared leading-silence trim, in frames. Every stem MUST use the same
     * offset or the files drift apart when imported together — each stem used
     * to run firstAudibleFrame on itself, so a part that entered late got its
     * own silence trimmed and started early relative to the others.
     */
    trimFrom?: number,
  ) => {
    if (left.length === 0) return;
    const first = trimFrom ?? firstAudibleFrame(left, right, sampleRate);
    const want = Math.min(left.length - first, Math.round(totalSec * sampleRate));
    if (want < sampleRate * 0.05) return; // allow near-silent soloed stems
    onProgress?.({
      stage: `Encoding ${name}…`,
      fraction: 0.7 + (index / Math.max(1, total)) * 0.25,
    });
    const data = await encodeAs(
      format,
      left.subarray(first, first + want),
      right.subarray(first, first + want),
      sampleRate,
    );
    const fileName = `kc-${stamp}-${name}.${format}`;
    const out = await writeIn(dir, fileName, toBase64(data));
    if (out) written.push(fileName);
  };

  // ── Offline dry stems (preferred) ───────────────────────────────────────
  try {
    // master-dry runs FIRST on purpose: it contains every part, so its first
    // audible frame is the earliest onset in the song and makes a safe shared
    // trim for the individual stems (it can never cut into one of them).
    const jobs: { name: string; solo: FireMixPart | "master" }[] = [
      { name: "master-dry", solo: "master" as const },
      ...STEM_PARTS.map(({ part, file }) => ({ name: file, solo: part as FireMixPart })),
    ];
    let i = 0;
    let sharedTrim: number | undefined;
    for (const job of jobs) {
      onProgress?.({
        stage: `Offline ${job.name}…`,
        fraction: 0.05 + (i / jobs.length) * 0.7,
      });
      const audio = await offlineDryBounce(undefined, job.solo);
      if (sharedTrim === undefined) {
        sharedTrim = firstAudibleFrame(audio.left, audio.right, audio.sampleRate);
      }
      await writeStem(
        job.name, audio.left, audio.right, audio.sampleRate, audio.totalSec,
        i, jobs.length, sharedTrim,
      );
      i++;
    }

    // Kill-Chain master needs the live FX graph — only included in realtime fallback.
    onProgress?.({ stage: "Done", fraction: 1 });
    if (written.length === 0) return null;
    return { dir, written, method: "offline" };
  } catch (err) {
    console.warn("[fireStudio] offline stems failed, falling back to realtime:", err);
    // Only fall back if NOTHING landed on disk. Otherwise the realtime pass
    // would write into the same folder alongside the offline files already
    // there — a silent mix of two rendering methods with different gain
    // staging, limiter behavior and alignment. A partial offline set is at
    // least internally consistent.
    if (written.length > 0) {
      onProgress?.({ stage: "Done (partial)", fraction: 1 });
      return { dir, written, method: "offline" };
    }
  }

  // ── Realtime fallback (all six taps) ────────────────────────────────────
  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;

  const { totalSec, song } = passSeconds();
  let recording = false;
  const isRec = () => recording;
  const recs: { name: string; rec: TapRecorder }[] = [
    ...STEM_PARTS.map(({ part, file }) => ({
      name: file,
      rec: attachRecorder(ctx, engine.getFirePartTap(part), isRec),
    })),
    { name: "master-dry", rec: attachRecorder(ctx, engine.fireTap, isRec) },
    // destinationTap = the very end of the Kill-Chain (post EQ/FX/3D/limiter):
    // the "after" in the before/after pair.
    { name: "master-killchain", rec: attachRecorder(ctx, engine.destinationTap, isRec) },
  ];

  try {
    await recordOnePass(
      totalSec,
      song ? "Recording arrangement stems…" : "Recording stems…",
      (on) => { recording = on; },
      onProgress,
    );
  } finally {
    for (const r of recs) r.rec.detach();
  }

  // ONE trim offset (from the dry master) keeps all six sample-aligned.
  const master = joined(recs[recs.length - 2].rec);
  if (master.left.length === 0) return null;
  const first = firstAudibleFrame(master.left, master.right, ctx.sampleRate);
  const want = Math.min(master.left.length - first, Math.round(totalSec * ctx.sampleRate));
  if (want < ctx.sampleRate * 0.2) return null;

  for (let i = 0; i < recs.length; i++) {
    const { name, rec } = recs[i];
    onProgress?.({
      stage: `Encoding ${name}…`,
      fraction: 0.82 + (i / recs.length) * 0.15,
    });
    const { left, right } = joined(rec);
    if (left.length < first + want) continue; // tap glitched — skip, keep going
    const data = await encodeAs(
      format,
      left.subarray(first, first + want),
      right.subarray(first, first + want),
      ctx.sampleRate,
    );
    const fileName = `kc-${stamp}-${name}.${format}`;
    const out = await writeIn(dir, fileName, toBase64(data));
    if (out) written.push(fileName);
  }
  onProgress?.({ stage: "Done", fraction: 1 });
  return written.length ? { dir, written, method: "realtime" } : null;
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function saveProject(): Promise<string | null> {
  const files = window.playground?.files;
  if (!files) return null;
  const { slotsFromState } = await import("@/state/fireCommandStore");
  const fire = useFireCommandStore.getState();
  const { patchA, patchB } = slotsFromState(fire);
  const project = {
    kind: "kill-chain-project",
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    patch: patchA,
    patchB,
    presetId: fire.presetId,
    presetIdB: fire.presetIdB,
    editTarget: fire.editTarget,
    arp: fire.arp,
    routeThroughFx: fire.routeThroughFx,
    octave: fire.octave,
    maxVoices: fire.maxVoices,
    scenes: fire.scenes,
    sceneMeta: fire.sceneMeta,
    sceneTransition: fire.sceneTransition,
    sceneMorphMs: fire.sceneMorphMs,
    // These were missing, so a save → open cycle quietly dropped the user's
    // Random Armory / mutation locks, their scene recall guards, and which
    // scene slot was active.
    activeSceneSlot: fire.activeSceneSlot,
    sceneProtect: fire.sceneProtect,
    moduleLocks: fire.moduleLocks,
    pinnedModules: fire.pinnedModules,
    // Full arrangement: sections (with the live edits folded in), clips,
    // play mode, lanes, scale — everything the loader needs.
    pattern: serializePattern(),
  };
  const json = JSON.stringify(project, null, 2);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return files.save(
    "session.kcproj",
    [{ name: "Kill-Chain project", extensions: ["kcproj", "json"] }],
    base64,
  );
}

export async function openProject(): Promise<{
  ok: boolean;
  error?: string;
  missingSamples?: string[];
}> {
  const files = window.playground?.files;
  if (!files) return { ok: false, error: "Projects need the desktop app." };
  const res = await files.openText([
    { name: "Kill-Chain project", extensions: ["kcproj", "json"] },
  ]);
  if (!res) return { ok: false };
  try {
    return await applyProjectText(res.text);
  } catch {
    return { ok: false, error: "Project file is corrupted." };
  }
}

/**
 * Apply a project payload that has already been read off disk.
 *
 * Split out of `openProject` so the load path can be exercised without a file
 * dialog — a project that only misbehaves on open is otherwise impossible to
 * reproduce in a harness.
 */
export async function applyProjectText(text: string): Promise<{
  ok: boolean;
  error?: string;
  missingSamples?: string[];
}> {
  {
    const data = JSON.parse(text) as {
      kind?: string;
      patch?: unknown;
      patchB?: unknown;
      presetId?: string;
      presetIdB?: string;
      editTarget?: string;
      arp?: unknown;
      routeThroughFx?: boolean;
      octave?: number;
      maxVoices?: number;
      scenes?: unknown;
      sceneMeta?: unknown;
      sceneTransition?: string;
      sceneMorphMs?: number;
      activeSceneSlot?: number;
      sceneProtect?: unknown;
      moduleLocks?: unknown;
      pinnedModules?: unknown;
      pattern?: unknown;
    };
    if (data.kind !== "kill-chain-project") {
      return { ok: false, error: "Not a Kill-Chain project file." };
    }
    // fromUserProject: this is a sound the user deliberately saved, so keep
    // their freeze / infinite-delay choices instead of softening them away.
    const asProject = { fromUserProject: true } as const;
    if (data.patch) useFireCommandStore.getState().importPatch(data.patch, data.arp, asProject);
    if (data.patchB) {
      useFireCommandStore.getState().importPatchB(data.patchB, data.presetIdB, asProject);
    } else if (data.pattern && typeof data.pattern === "object") {
      const pid = (data.pattern as { synthBPresetId?: string }).synthBPresetId;
      if (typeof pid === "string") {
        const { FIRE_PRESETS } = await import("@/state/fireCommandStore");
        const preset = FIRE_PRESETS.find((p) => p.id === pid);
        if (preset) useFireCommandStore.getState().importPatchB(preset.patch, pid);
      }
    }
    // Restore Fire session fields that aren't part of importPatch/B.
    const fireExtra: Record<string, unknown> = {};
    if (typeof data.presetId === "string") fireExtra.presetId = data.presetId;
    if (typeof data.routeThroughFx === "boolean") {
      fireExtra.routeThroughFx = data.routeThroughFx;
      useAudioStore.getState().setBypass(!data.routeThroughFx);
    }
    if (typeof data.octave === "number") fireExtra.octave = data.octave;
    if (typeof data.maxVoices === "number") {
      fireExtra.maxVoices = data.maxVoices;
      try {
        const eng = getEngine();
        eng.fireCommand.setMaxVoices(data.maxVoices);
        eng.fireCommandB.setMaxVoices(data.maxVoices);
      } catch { /* */ }
    }
    if (Array.isArray(data.scenes)) fireExtra.scenes = data.scenes;
    if (Array.isArray(data.sceneMeta)) fireExtra.sceneMeta = data.sceneMeta;
    if (typeof data.sceneTransition === "string") fireExtra.sceneTransition = data.sceneTransition;
    if (typeof data.sceneMorphMs === "number") fireExtra.sceneMorphMs = data.sceneMorphMs;
    // Counterparts of the fields added to saveProject — clamped / shape-checked
    // because a project file is user-editable on disk.
    if (typeof data.activeSceneSlot === "number" && Number.isFinite(data.activeSceneSlot)) {
      fireExtra.activeSceneSlot = Math.max(0, Math.min(SCENE_SLOTS - 1, Math.floor(data.activeSceneSlot)));
    }
    if (data.sceneProtect && typeof data.sceneProtect === "object" && !Array.isArray(data.sceneProtect)) {
      fireExtra.sceneProtect = data.sceneProtect;
    }
    if (data.moduleLocks && typeof data.moduleLocks === "object" && !Array.isArray(data.moduleLocks)) {
      fireExtra.moduleLocks = data.moduleLocks;
    }
    if (Array.isArray(data.pinnedModules)) {
      fireExtra.pinnedModules = data.pinnedModules.filter((m): m is string => typeof m === "string");
    }
    if (Object.keys(fireExtra).length) useFireCommandStore.setState(fireExtra);
    if (data.editTarget === "a" || data.editTarget === "b") {
      useFireCommandStore.getState().setEditTarget(data.editTarget);
    }
    if (data.pattern) useFireSequencerStore.getState().importPattern(data.pattern);
    const { missing } = await useFireSequencerStore.getState().hydrateSamples();
    // After a successful open, drop undo of the previous song (importPatch
    // itself pushes a snapshot of whatever was loaded before).
    clearFireHistory();
    return { ok: true, missingSamples: missing };
  }
}

/** Load a project payload directly (mission packs / templates). */
export function loadProjectData(data: {
  patch?: unknown;
  patchB?: unknown;
  presetIdB?: string;
  arp?: unknown;
  pattern?: unknown;
}): void {
  if (data.patch) useFireCommandStore.getState().importPatch(data.patch, data.arp);
  if (data.patchB) useFireCommandStore.getState().importPatchB(data.patchB, data.presetIdB);
  if (data.pattern) useFireSequencerStore.getState().importPattern(data.pattern);
}
