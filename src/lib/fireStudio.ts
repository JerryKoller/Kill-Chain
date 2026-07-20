/**
 * fireStudio — Fire Command's export + project I/O.
 *
 * WAV EXPORT: records ONE full pass of the pattern (plus a release tail)
 * from the engine's clean synth+drums tap — no player audio, no chain FX,
 * exactly what the sequencer produces — then encodes 16-bit PCM WAV and
 * hands it to the OS save dialog.
 *
 * PROJECTS (.kcproj): the synth patch + arp + the whole pattern (notes,
 * drums, sample lanes with their file paths) as JSON. Loading re-hydrates
 * sample buffers from the referenced files.
 */

import { getEngine } from "@/audio/AudioEngine";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useFireSequencerStore, STEPS_PER_BAR } from "@/state/fireSequencerStore";

const PROJECT_VERSION = 1;

// ── WAV encode ──────────────────────────────────────────────────────────────

function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
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

function toBase64(bytes: Uint8Array): string {
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

// ── Export ──────────────────────────────────────────────────────────────────

export interface ExportProgress {
  stage: string;
  fraction: number;
}

/**
 * Record one pattern pass to WAV and save it via the OS dialog.
 * Returns the saved path, or null (cancelled / unavailable / silent).
 */
export async function exportPatternWav(
  onProgress?: (p: ExportProgress) => void,
): Promise<string | null> {
  const files = window.playground?.files;
  if (!files) return null;
  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;
  const seq = useFireSequencerStore.getState();

  const stepSec = 60 / seq.bpm / 4;
  const patternSec = seq.bars * STEPS_PER_BAR * stepSec;
  const tailSec = 1.6;
  const totalSec = patternSec + tailSec;

  // Recorder: ScriptProcessor tap on the clean fire bus. Its output feeds a
  // muted gain so the node actually pulls (required), never audible.
  const proc = ctx.createScriptProcessor(4096, 2, 2);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  engine.fireTap.connect(proc);
  proc.connect(sink).connect(ctx.destination);

  const chunksL: Float32Array[] = [];
  const chunksR: Float32Array[] = [];
  let recording = false;
  proc.onaudioprocess = (e) => {
    if (!recording) return;
    chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
  };

  const wasPlaying = seq.playing;
  if (wasPlaying) seq.stop();

  try {
    recording = true;
    useFireSequencerStore.getState().play();
    onProgress?.({ stage: "Recording pattern…", fraction: 0 });
    const t0 = performance.now();
    while (performance.now() - t0 < totalSec * 1000) {
      await new Promise((r) => setTimeout(r, 120));
      onProgress?.({
        stage: "Recording pattern…",
        fraction: Math.min(0.85, ((performance.now() - t0) / 1000 / totalSec) * 0.85),
      });
    }
  } finally {
    recording = false;
    useFireSequencerStore.getState().stop();
    try { engine.fireTap.disconnect(proc); } catch { /* ignore */ }
    try { proc.disconnect(); } catch { /* ignore */ }
    try { sink.disconnect(); } catch { /* ignore */ }
  }

  onProgress?.({ stage: "Encoding WAV…", fraction: 0.9 });
  const frames = chunksL.reduce((n, c) => n + c.length, 0);
  if (frames === 0) return null;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let off = 0;
  for (let i = 0; i < chunksL.length; i++) {
    left.set(chunksL[i], off);
    right.set(chunksR[i], off);
    off += chunksL[i].length;
  }

  // Trim the scheduler's arming latency: find the first audible frame and
  // keep a 10 ms pre-roll.
  let first = 0;
  for (let i = 0; i < frames; i++) {
    if (Math.abs(left[i]) > 0.001 || Math.abs(right[i]) > 0.001) {
      first = Math.max(0, i - Math.round(ctx.sampleRate * 0.01));
      break;
    }
  }
  const want = Math.min(frames - first, Math.round(totalSec * ctx.sampleRate));
  if (want < ctx.sampleRate * 0.2) return null; // recorded silence

  const wav = encodeWav(
    left.subarray(first, first + want),
    right.subarray(first, first + want),
    ctx.sampleRate,
  );
  onProgress?.({ stage: "Saving…", fraction: 0.97 });
  return files.save(
    "kill-chain-pattern.wav",
    [{ name: "WAV audio", extensions: ["wav"] }],
    toBase64(wav),
  );
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function saveProject(): Promise<string | null> {
  const files = window.playground?.files;
  if (!files) return null;
  const fire = useFireCommandStore.getState();
  const seq = useFireSequencerStore.getState();
  const project = {
    kind: "kill-chain-project",
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    patch: fire.patch,
    arp: fire.arp,
    pattern: {
      bpm: seq.bpm,
      swing: seq.swing,
      bars: seq.bars,
      notes: seq.notes,
      drums: seq.drums,
      drumLevel: seq.drumLevel,
      synthEnabled: seq.synthEnabled,
      drumsEnabled: seq.drumsEnabled,
      synthBEnabled: seq.synthBEnabled,
      synthBPresetId: seq.synthBPresetId,
      activeChannel: seq.activeChannel,
      scaleRoot: seq.scaleRoot,
      scaleId: seq.scaleId,
      scaleSnap: seq.scaleSnap,
      drumSamples: seq.drumSamples,
      samples: seq.samples,
    },
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
