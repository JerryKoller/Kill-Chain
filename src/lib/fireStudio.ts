/**
 * fireStudio — Fire Command's export + project I/O.
 *
 * AUDIO EXPORT (WAV or MP3 320): records ONE full pass (section loop or the
 * whole song chain, plus a release tail) from the engine's clean synth+drums
 * tap — no player audio, no chain FX — then encodes and hands it to the OS
 * save dialog.
 *
 * STEMS EXPORT (v1.6, chain-aware): the same single real-time pass captured
 * from SIX taps at once — four dry part stems (Synth A, Synth B, drums,
 * sample deck), the dry Fire master, and the THROUGH-CHAIN master (what the
 * full Kill-Chain engine makes of it). All six land in one folder, sample-
 * aligned, ready for a DAW A/B.
 *
 * PROJECTS (.kcproj v2): the synth patch + arp + the whole arrangement
 * (sections, chain, play mode, sample lanes with their file paths) as JSON.
 * v1 files still open — the store migrates them to a one-section song.
 */

import { getEngine, type FireMixPart } from "@/audio/AudioEngine";
import { useFireCommandStore } from "@/state/fireCommandStore";
import {
  useFireSequencerStore,
  serializePattern,
  songTotalSteps,
  STEPS_PER_BAR,
} from "@/state/fireSequencerStore";

const PROJECT_VERSION = 2;

export type ExportFormat = "wav" | "mp3";

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
  const song = seq.playMode === "song";
  const steps = song ? songTotalSteps(seq) : seq.bars * STEPS_PER_BAR;
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
  }
}

// ── Pattern / song export ───────────────────────────────────────────────────

/**
 * Record one pass (section or whole song, per play mode) and save it via
 * the OS dialog as WAV or MP3. Returns the saved path, or null.
 */
export async function exportPatternWav(
  onProgress?: (p: ExportProgress) => void,
  format: ExportFormat = "wav",
): Promise<string | null> {
  const files = window.playground?.files;
  if (!files) return null;
  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;

  const { totalSec, song } = passSeconds();
  let recording = false;
  const rec = attachRecorder(ctx, engine.fireTap, () => recording);

  try {
    await recordOnePass(
      totalSec,
      song ? "Recording song…" : "Recording pattern…",
      (on) => { recording = on; },
      onProgress,
    );
  } finally {
    rec.detach();
  }

  onProgress?.({ stage: format === "mp3" ? "Encoding MP3…" : "Encoding WAV…", fraction: 0.9 });
  const { left, right } = joined(rec);
  if (left.length === 0) return null;

  const first = firstAudibleFrame(left, right, ctx.sampleRate);
  const want = Math.min(left.length - first, Math.round(totalSec * ctx.sampleRate));
  if (want < ctx.sampleRate * 0.2) return null; // recorded silence

  const data = await encodeAs(
    format,
    left.subarray(first, first + want),
    right.subarray(first, first + want),
    ctx.sampleRate,
  );
  onProgress?.({ stage: "Saving…", fraction: 0.97 });
  const base = song ? "kill-chain-song" : "kill-chain-pattern";
  return files.save(
    `${base}.${format}`,
    [format === "mp3"
      ? { name: "MP3 audio", extensions: ["mp3"] }
      : { name: "WAV audio", extensions: ["wav"] }],
    toBase64(data),
  );
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
}

/**
 * One real-time pass, six sample-aligned captures:
 *   4 dry part stems + dry Fire master + the through-Kill-Chain master.
 * Everything is written into a user-picked folder. Returns null on cancel.
 */
export async function exportStems(
  onProgress?: (p: ExportProgress) => void,
  format: ExportFormat = "wav",
): Promise<StemsResult | null> {
  const files = window.playground?.files;
  if (!files?.pickOutputFolder || !files.writeIn) return null;
  const dir = await files.pickOutputFolder();
  if (!dir) return null;

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
      song ? "Recording song stems…" : "Recording stems…",
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

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const written: string[] = [];
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
    const out = await files.writeIn(dir, fileName, toBase64(data));
    if (out) written.push(fileName);
  }
  onProgress?.({ stage: "Done", fraction: 1 });
  return { dir, written };
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function saveProject(): Promise<string | null> {
  const files = window.playground?.files;
  if (!files) return null;
  const fire = useFireCommandStore.getState();
  const project = {
    kind: "kill-chain-project",
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    patch: fire.patch,
    arp: fire.arp,
    // Full arrangement: sections (with the live edits folded in), chain,
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

export async function openProject(): Promise<{ ok: boolean; error?: string }> {
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
      arp?: unknown;
      pattern?: unknown;
    };
    if (data.kind !== "kill-chain-project") {
      return { ok: false, error: "Not a Kill-Chain project file." };
    }
    if (data.patch) useFireCommandStore.getState().importPatch(data.patch, data.arp);
    if (data.pattern) useFireSequencerStore.getState().importPattern(data.pattern);
    return { ok: true };
  } catch {
    return { ok: false, error: "Project file is corrupted." };
  }
}

/** Load a project payload directly (mission packs / templates). */
export function loadProjectData(data: {
  patch?: unknown;
  arp?: unknown;
  pattern?: unknown;
}): void {
  if (data.patch) useFireCommandStore.getState().importPatch(data.patch, data.arp);
  if (data.pattern) useFireSequencerStore.getState().importPattern(data.pattern);
}
