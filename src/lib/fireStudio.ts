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
import { useFireCommandStore, slotsFromState } from "@/state/fireCommandStore";
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

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const frames = left.length;
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
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(o, (l * 32767) | 0, true);
    view.setInt16(o + 2, (r * 32767) | 0, true);
    o += 4;
  }
  return new Uint8Array(buf);
}

// ── MP3 encode (lazy-loaded lamejs, 320 kbps CBR) ───────────────────────────

function f32ToI16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = Math.max(-1, Math.min(1, src[i]));
    out[i] = (v * 32767) | 0;
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
  const l16 = f32ToI16(left);
  const r16 = f32ToI16(right);
  const BLOCK = 1152;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < l16.length; i += BLOCK) {
    const part = enc.encodeBuffer(l16.subarray(i, i + BLOCK), r16.subarray(i, i + BLOCK));
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
  const fireMasterGain = octx.createGain();
  const fireLimiter = octx.createDynamicsCompressor();
  fireLimiter.threshold.value = -3.0;
  fireLimiter.knee.value = 0;
  fireLimiter.ratio.value = 20;
  fireLimiter.attack.value = 0.002;
  fireLimiter.release.value = 0.08;
  const fireBusPad = octx.createGain();
  fireBusPad.gain.value = 1 / SAFETY_CLIP_RANGE;
  const fireBusClip = octx.createWaveShaper();
  fireBusClip.curve = makeSafetyClipCurve();
  fireBusClip.oversample = "2x";
  fireBus.connect(fireMasterGain);
  fireMasterGain.connect(fireLimiter);
  fireLimiter.connect(fireBusPad);
  fireBusPad.connect(fireBusClip).connect(octx.destination);

  const mkPart = () => {
    const gain = octx.createGain();
    const pan = octx.createStereoPanner();
    gain.connect(pan);
    return { gain, pan };
  };
  const parts = { a: mkPart(), b: mkPart(), drums: mkPart(), samples: mkPart() };
  const fireDuck = octx.createGain();
  parts.a.pan.connect(fireDuck);
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
  if (!seq.fireLimiterOn) {
    // Bypass: wire master gain straight to pad (keep graph simple — zero the compressor by high threshold).
    fireLimiter.threshold.value = 0;
    fireLimiter.ratio.value = 1;
  }
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
  const rendered = await octx.startRendering();
  const left = rendered.getChannelData(0).slice();
  const right = rendered.numberOfChannels > 1
    ? rendered.getChannelData(1).slice()
    : left.slice();
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
  ) => {
    if (left.length === 0) return;
    const first = firstAudibleFrame(left, right, sampleRate);
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
    const jobs: { name: string; solo: FireMixPart | "master" }[] = [
      ...STEM_PARTS.map(({ part, file }) => ({ name: file, solo: part as FireMixPart })),
      { name: "master-dry", solo: "master" as const },
    ];
    let i = 0;
    for (const job of jobs) {
      onProgress?.({
        stage: `Offline ${job.name}…`,
        fraction: 0.05 + (i / jobs.length) * 0.7,
      });
      const audio = await offlineDryBounce(undefined, job.solo);
      await writeStem(job.name, audio.left, audio.right, audio.sampleRate, audio.totalSec, i, jobs.length);
      i++;
    }

    // Kill-Chain master needs the live FX graph — only included in realtime fallback.
    onProgress?.({ stage: "Done", fraction: 1 });
    if (written.length === 0) return null;
    return { dir, written, method: "offline" };
  } catch (err) {
    console.warn("[fireStudio] offline stems failed, falling back to realtime:", err);
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
    const data = JSON.parse(res.text) as {
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
      pattern?: unknown;
    };
    if (data.kind !== "kill-chain-project") {
      return { ok: false, error: "Not a Kill-Chain project file." };
    }
    if (data.patch) useFireCommandStore.getState().importPatch(data.patch, data.arp);
    if (data.patchB) {
      useFireCommandStore.getState().importPatchB(data.patchB, data.presetIdB);
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
    if (Object.keys(fireExtra).length) useFireCommandStore.setState(fireExtra);
    if (data.editTarget === "a" || data.editTarget === "b") {
      useFireCommandStore.getState().setEditTarget(data.editTarget);
    }
    if (data.pattern) useFireSequencerStore.getState().importPattern(data.pattern);
    const { missing } = await useFireSequencerStore.getState().hydrateSamples();
    return { ok: true, missingSamples: missing };
  } catch {
    return { ok: false, error: "Project file is corrupted." };
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
