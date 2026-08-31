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
    // Read the tag header first, then pull exactly the declared tag size —
    // the old fixed 256 KB slice truncated large embedded covers (broken /
    // missing art for anything past the cap).
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 10)).arrayBuffer());
    if (head.length < 10) return empty;
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return empty;

    const versionMajor = head[3];
    const flags = head[5];
    const declaredSize = synchsafeToInt(head[6], head[7], head[8], head[9]);
    // Sane ceiling (8 MB) so a corrupt size field can't allocate the world.
    const readLen = Math.min(blob.size, 10 + Math.min(declaredSize, 8 * 1024 * 1024));
    const buf = new Uint8Array(await blob.slice(0, readLen).arrayBuffer());
    const tagEnd = Math.min(buf.length, 10 + declaredSize);

    let p = 10;
    // Extended header (flag bit 6): skip it or every following frame
    // boundary is misaligned and the parse silently returns nothing.
    if (flags & 0x40 && tagEnd >= p + 6) {
      const extSize =
        versionMajor === 4
          ? synchsafeToInt(buf[p], buf[p + 1], buf[p + 2], buf[p + 3])
          : (((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0) + 4;
      p += Math.max(0, Math.min(extSize, tagEnd - p));
    }
    const out: TrackMetadata = { ...empty };
    while (p < tagEnd - 10) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      if (id === "\u0000\u0000\u0000\u0000") break;
      // v2.3 sizes are plain 32-bit big-endian; force unsigned — a signed
      // shift on a high bit produced a NEGATIVE size and a garbage dataEnd.
      const size =
        versionMajor === 4
          ? synchsafeToInt(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7])
          : ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
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
