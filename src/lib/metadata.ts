import type { TrackMetadata } from "@/state/playerStore";

/**
 * Minimal ID3v2 (2.3 + 2.4) parser. Pulls title / artist / album + the
 * first embedded picture (APIC). Falls back to silent no-op for any file
 * that doesn't start with an ID3 tag — that includes FLAC, OGG, raw
 * formats, and most plain WAVs.
 *
 * Designed to be dependency-free; small and fast enough to run on every
 * loaded track. Returns nulls when nothing useful is found.
 */
export async function extractMetadata(blob: Blob): Promise<TrackMetadata> {
  const empty: TrackMetadata = {
    title: null,
    artist: null,
    album: null,
    coverUrl: null,
  };

  try {
    // We only need the first ~256 KB to parse most tags (APIC can be big).
    const headerSlice = blob.slice(0, Math.min(blob.size, 256 * 1024));
    const buf = new Uint8Array(await headerSlice.arrayBuffer());
    if (buf.length < 10) return empty;
    if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return empty;

    const versionMajor = buf[3];
    const tagSize = synchsafeToInt(buf[6], buf[7], buf[8], buf[9]);
    const tagEnd = Math.min(buf.length, 10 + tagSize);

    let p = 10;
    const out: TrackMetadata = { ...empty };
    while (p < tagEnd - 10) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      if (id === "\u0000\u0000\u0000\u0000") break;
      const size =
        versionMajor === 4
          ? synchsafeToInt(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7])
          : (buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7];
      const dataStart = p + 10;
      const dataEnd = dataStart + size;
      if (size === 0 || dataEnd > tagEnd) break;

      const frame = buf.subarray(dataStart, dataEnd);
      if (id === "TIT2") out.title = decodeText(frame);
      else if (id === "TPE1" || id === "TPE2") {
        if (!out.artist) out.artist = decodeText(frame);
      } else if (id === "TALB") out.album = decodeText(frame);
      else if (id === "APIC" && !out.coverUrl) {
        const cover = extractPicture(frame);
        if (cover) {
          const blobCover = new Blob([cover.data as BlobPart], { type: cover.mime });
          out.coverUrl = URL.createObjectURL(blobCover);
        }
      }
      p = dataEnd;
    }
    return out;
  } catch (err) {
    console.warn("[metadata] parse failed:", err);
    return empty;
  }
}

function synchsafeToInt(a: number, b: number, c: number, d: number): number {
  return ((a & 0x7f) << 21) | ((b & 0x7f) << 14) | ((c & 0x7f) << 7) | (d & 0x7f);
}

function decodeText(frame: Uint8Array): string | null {
  if (frame.length < 2) return null;
  const enc = frame[0];
  const payload = frame.subarray(1);
  let text: string;
  try {
    if (enc === 0) {
      text = new TextDecoder("iso-8859-1").decode(payload);
    } else if (enc === 1 || enc === 2) {
      // UTF-16 with BOM (enc 1) or BE without BOM (enc 2).
      text = new TextDecoder("utf-16").decode(payload);
    } else {
      text = new TextDecoder("utf-8").decode(payload);
    }
  } catch {
    return null;
  }
  return text.replace(/\0+$/, "").trim() || null;
}

function extractPicture(frame: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (frame.length < 4) return null;
  const enc = frame[0];
  // Find null-terminated MIME (ASCII).
  let i = 1;
  while (i < frame.length && frame[i] !== 0) i++;
  if (i >= frame.length) return null;
  const mime = new TextDecoder("iso-8859-1").decode(frame.subarray(1, i));
  i += 1; // skip null
  if (i >= frame.length) return null;
  i += 1; // picture type byte
  // Description: null-terminated, encoding-aware.
  if (enc === 1 || enc === 2) {
    // UTF-16 description ends with a UTF-16 null (two zeros aligned).
    while (i < frame.length - 1 && !(frame[i] === 0 && frame[i + 1] === 0)) i++;
    i += 2;
  } else {
    while (i < frame.length && frame[i] !== 0) i++;
    i += 1;
  }
  if (i >= frame.length) return null;
  return { mime, data: frame.subarray(i) };
}
