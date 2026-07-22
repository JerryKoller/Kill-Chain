/**
 * bounceExport — "print what I'm hearing" for the Sculptor (v2.1).
 *
 * PROCESSED pass: the loaded track is played once from the top while a
 * ScriptProcessor records engine.destinationTap — the exact end of the
 * Kill Chain (EQ, restoration, dynamics, rooms, limiter). By construction
 * the bounce IS the active chain; no offline replica to drift out of sync.
 * (Same recorder pattern as Fire Studio's stem export.)
 *
 * DRY pass: the decoded source file itself — no capture needed.
 *
 * NORMALIZED pass: the processed capture measured with an offline
 * BS.1770-style K-weighted integration (OfflineAudioContext pre-filters +
 * gated 400 ms blocks) and gained to ≈ −14 LUFS, peak-protected.
 *
 * Formats: WAV always; MP3 via the already-shipped lamejs encoder.
 */

import { getEngine } from "@/audio/AudioEngine";
import { encodeWav, encodeMp3, toBase64, type ExportFormat } from "@/lib/fireStudio";
import { audioUrlForPath, pathFromAudioSrc } from "@/state/libraryStore";
import { usePlayerStore } from "@/state/playerStore";

export interface BounceOptions {
  processed: boolean;
  dry: boolean;
  /** Also write a −14 LUFS-normalized copy of the processed pass. */
  normalized: boolean;
  format: ExportFormat;
  signal?: AbortSignal;
  onProgress?: (p: { stage: string; fraction: number }) => void;
}

export interface BounceResult {
  dir: string;
  written: string[];
}

export const BOUNCE_TARGET_LUFS = -14;

/** Can the current source be bounced? Needs a decodable local file. */
export function bounceAvailability(): {
  ok: boolean;
  path: string | null;
  name: string | null;
  reason: string | null;
} {
  const p = usePlayerStore.getState();
  if (p.loopbackActive) {
    return { ok: false, path: null, name: null, reason: "Exterior Audio / Airspace capture can't be re-rendered — play a local file." };
  }
  const path = pathFromAudioSrc(p.src);
  if (!path) {
    return { ok: false, path: null, name: null, reason: "Load a track from the Library first — bouncing needs the source file." };
  }
  const name = path.split(/[\\/]/).pop() ?? "track";
  return { ok: true, path, name, reason: null };
}

const baseName = (path: string) =>
  (path.split(/[\\/]/).pop() ?? "track").replace(/\.[^.]+$/, "");

/**
 * Bounce the currently-loaded track. Plays it once (audibly) for the
 * processed pass; writes every requested file into a user-picked folder.
 * Returns null when unavailable or cancelled.
 */
export async function bounceCurrentTrack(opts: BounceOptions): Promise<BounceResult | null> {
  const files = window.playground?.files;
  if (!files?.pickOutputFolder || !files.writeIn) return null;
  const avail = bounceAvailability();
  if (!avail.ok || !avail.path) return null;
  if (!opts.processed && !opts.dry) return null;

  const dir = await files.pickOutputFolder();
  if (!dir) return null;

  const engine = getEngine();
  await engine.resume();
  const ctx = engine.ctx;
  const report = opts.onProgress;

  // ── Decode the source (dry master + the duration reference) ──
  report?.({ stage: "Decoding source…", fraction: 0.02 });
  const resp = await fetch(audioUrlForPath(avail.path));
  if (!resp.ok) throw new Error(`Couldn't read the source file (${resp.status})`);
  const bytes = await resp.arrayBuffer();
  const dryBuf = await ctx.decodeAudioData(bytes);
  throwIfAborted(opts.signal);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const base = baseName(avail.path);
  const ext = opts.format;
  const written: string[] = [];

  const writeBuffer = async (
    name: string,
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
  ) => {
    const data =
      opts.format === "mp3"
        ? await encodeMp3(left, right, sampleRate)
        : encodeWav(left, right, sampleRate);
    const fileName = `${base}.${name}.${stamp}.${ext}`;
    const out = await files.writeIn!(dir, fileName, toBase64(data));
    if (out) written.push(fileName);
  };

  // ── Processed pass: play the track once, record the chain output ──
  let procL: Float32Array | null = null;
  let procR: Float32Array | null = null;
  if (opts.processed) {
    const cap = await captureProcessedPass(dryBuf.duration, opts.signal, report);
    if (cap) {
      procL = cap.left;
      procR = cap.right;
    }
  }

  // ── Encode + write ──
  if (opts.dry) {
    report?.({ stage: "Encoding dry master…", fraction: 0.86 });
    const l = dryBuf.getChannelData(0);
    const r = dryBuf.numberOfChannels > 1 ? dryBuf.getChannelData(1) : l;
    await writeBuffer("dry", l, r, dryBuf.sampleRate);
    throwIfAborted(opts.signal);
  }
  if (procL && procR) {
    report?.({ stage: "Encoding processed master…", fraction: 0.9 });
    await writeBuffer("killchain", procL, procR, ctx.sampleRate);
    throwIfAborted(opts.signal);

    if (opts.normalized) {
      report?.({ stage: `Normalizing to ${BOUNCE_TARGET_LUFS} LUFS…`, fraction: 0.94 });
      const lufs = await integratedLufs(procL, procR, ctx.sampleRate);
      const gainDb = lufs > -70 ? BOUNCE_TARGET_LUFS - lufs : 0;
      const { left, right } = applyGainPeakSafe(procL, procR, gainDb);
      await writeBuffer(`killchain.-14LUFS`, left, right, ctx.sampleRate);
    }
  }

  report?.({ stage: "Done", fraction: 1 });
  return { dir, written };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Bounce cancelled", "AbortError");
}

/** Play the loaded track from the top and record destinationTap. */
async function captureProcessedPass(
  durationSec: number,
  signal: AbortSignal | undefined,
  report?: (p: { stage: string; fraction: number }) => void,
): Promise<{ left: Float32Array; right: Float32Array } | null> {
  const engine = getEngine();
  const ctx = engine.ctx;
  const player = usePlayerStore.getState();

  let recording = false;
  const chunksL: Float32Array[] = [];
  const chunksR: Float32Array[] = [];
  const proc = ctx.createScriptProcessor(4096, 2, 2);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  engine.destinationTap.connect(proc);
  proc.connect(sink).connect(ctx.destination);
  proc.onaudioprocess = (e) => {
    if (!recording) return;
    chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
  };

  const prevPos = player.currentTime ?? 0;
  const wasPlaying = player.status === "playing";

  try {
    player.seek(0);
    recording = true;
    await player.play();
    report?.({ stage: "Recording through the chain… 0%", fraction: 0.08 });

    // Roll until the element reports the end (or we pass the duration with
    // a safety margin for the chain's own latency tail).
    const deadline = performance.now() + (durationSec + 4) * 1000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 200));
      if (signal?.aborted) throw new DOMException("Bounce cancelled", "AbortError");
      const st = usePlayerStore.getState();
      const t = st.currentTime ?? 0;
      const pct = durationSec > 0 ? Math.min(1, t / durationSec) : 0;
      report?.({
        stage: `Recording through the chain… ${Math.round(pct * 100)}%`,
        fraction: 0.08 + pct * 0.72,
      });
      const ended =
        st.status !== "playing" ||
        (durationSec > 0 && t >= durationSec - 0.05);
      if (ended || performance.now() > deadline) break;
    }
    // Half a second of chain tail (reverb / limiter release), then stop.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    recording = false;
    try { engine.destinationTap.disconnect(proc); } catch { /* ignore */ }
    try { proc.disconnect(); } catch { /* ignore */ }
    try { sink.disconnect(); } catch { /* ignore */ }
    const p2 = usePlayerStore.getState();
    p2.pause();
    p2.seek(prevPos);
    if (wasPlaying) void p2.play();
  }

  const total = chunksL.reduce((n, c) => n + c.length, 0);
  if (total < ctx.sampleRate * 0.5) return null;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let off = 0;
  for (let i = 0; i < chunksL.length; i++) {
    left.set(chunksL[i], off);
    right.set(chunksR[i], off);
    off += chunksL[i].length;
  }
  // Trim the record-start latency gap (first audible frame − 10 ms pre-roll)
  // and cap at the source duration + a short tail.
  let first = 0;
  for (let i = 0; i < left.length; i++) {
    if (Math.abs(left[i]) > 0.001 || Math.abs(right[i]) > 0.001) {
      first = Math.max(0, i - Math.round(ctx.sampleRate * 0.01));
      break;
    }
  }
  const want = Math.min(
    left.length - first,
    Math.round((durationSec + 1) * ctx.sampleRate),
  );
  return {
    left: left.subarray(first, first + want),
    right: right.subarray(first, first + want),
  };
}

/**
 * BS.1770-style integrated loudness: K-weighting via OfflineAudioContext
 * biquads (highpass ~38 Hz + high shelf +4 dB above ~1.5 kHz), then gated
 * 400 ms blocks (75% overlap, −70 LUFS absolute + −10 LU relative gates).
 */
export async function integratedLufs(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Promise<number> {
  const frames = left.length;
  if (frames === 0) return -120;
  const off = new OfflineAudioContext(2, frames, sampleRate);
  const buf = off.createBuffer(2, frames, sampleRate);
  buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  const src = off.createBufferSource();
  src.buffer = buf;
  const shelf = off.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 1500;
  shelf.gain.value = 4;
  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(off.destination);
  src.start();
  const rendered = await off.startRendering();

  const l = rendered.getChannelData(0);
  const r = rendered.getChannelData(1);
  const block = Math.round(sampleRate * 0.4);
  const hop = Math.round(sampleRate * 0.1);
  const blocks: number[] = [];
  for (let start = 0; start + block <= frames; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i++) {
      sum += l[i] * l[i] + r[i] * r[i];
    }
    const ms = sum / block;
    const lufs = ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120;
    if (lufs > -70) blocks.push(lufs);
  }
  if (blocks.length === 0) return -120;
  const mean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  const gated = blocks.filter((b) => b >= mean - 10);
  return gated.length > 0 ? gated.reduce((a, b) => a + b, 0) / gated.length : -120;
}

/** Apply a gain (dB), scaling back if the result would clip past −0.1 dBFS. */
function applyGainPeakSafe(
  left: Float32Array,
  right: Float32Array,
  gainDb: number,
): { left: Float32Array; right: Float32Array } {
  let g = Math.pow(10, gainDb / 20);
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > peak) peak = a;
  }
  const ceil = 0.9886; // −0.1 dBFS
  if (peak * g > ceil) g = ceil / peak;
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  for (let i = 0; i < left.length; i++) {
    outL[i] = left[i] * g;
    outR[i] = right[i] * g;
  }
  return { left: outL, right: outR };
}
