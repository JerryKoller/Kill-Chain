/**
 * Minimal ID3v2.4 tag writer for Fire → Library MP3 exports.
 * Frames: TIT2 / TPE1 / TALB / TCON + optional APIC (cover art).
 */

export interface Id3Artwork {
  mime: string;
  data: Uint8Array;
}

export interface Id3Meta {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  artwork?: Id3Artwork | null;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function synchsafe(n: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (n >>> 21) & 0x7f;
  out[1] = (n >>> 14) & 0x7f;
  out[2] = (n >>> 7) & 0x7f;
  out[3] = n & 0x7f;
  return out;
}

function frame(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + body.length);
  out[0] = id.charCodeAt(0);
  out[1] = id.charCodeAt(1);
  out[2] = id.charCodeAt(2);
  out[3] = id.charCodeAt(3);
  // ID3v2.4 frame size is synchsafe.
  out.set(synchsafe(body.length), 4);
  out[8] = 0;
  out[9] = 0;
  out.set(body, 10);
  return out;
}

/** Text frame: encoding byte 0x03 (UTF-8) + text + null. */
function textFrame(id: string, value: string): Uint8Array {
  const text = encodeUtf8(value);
  const body = new Uint8Array(1 + text.length + 1);
  body[0] = 0x03;
  body.set(text, 1);
  body[1 + text.length] = 0;
  return frame(id, body);
}

function apicFrame(art: Id3Artwork): Uint8Array {
  const mime = encodeUtf8(art.mime || "image/jpeg");
  // encoding + mime\0 + picture type (0x03 = cover front) + description\0 + data
  const body = new Uint8Array(1 + mime.length + 1 + 1 + 1 + art.data.length);
  let o = 0;
  body[o++] = 0x03; // UTF-8
  body.set(mime, o); o += mime.length;
  body[o++] = 0;
  body[o++] = 0x03; // Front cover
  body[o++] = 0; // empty description
  body.set(art.data, o);
  return frame("APIC", body);
}

/** Prepend an ID3v2.4 tag to raw MPEG frames (strips any existing ID3 first). */
export function prependId3v24(mp3: Uint8Array, meta: Id3Meta): Uint8Array {
  let audio = mp3;
  // Strip existing ID3v2 header if present.
  if (audio.length >= 10 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    const size =
      ((audio[6] & 0x7f) << 21) |
      ((audio[7] & 0x7f) << 14) |
      ((audio[8] & 0x7f) << 7) |
      (audio[9] & 0x7f);
    audio = audio.subarray(10 + size);
  }

  const parts: Uint8Array[] = [];
  if (meta.title?.trim()) parts.push(textFrame("TIT2", meta.title.trim()));
  if (meta.artist?.trim()) parts.push(textFrame("TPE1", meta.artist.trim()));
  if (meta.album?.trim()) parts.push(textFrame("TALB", meta.album.trim()));
  if (meta.genre?.trim()) parts.push(textFrame("TCON", meta.genre.trim()));
  if (meta.artwork?.data?.length) parts.push(apicFrame(meta.artwork));

  if (parts.length === 0) return mp3;

  const tagBodyLen = parts.reduce((n, p) => n + p.length, 0);
  const header = new Uint8Array(10);
  header[0] = 0x49; // I
  header[1] = 0x44; // D
  header[2] = 0x33; // 3
  header[3] = 4; // v2.4
  header[4] = 0;
  header[5] = 0; // flags
  header.set(synchsafe(tagBodyLen), 6);

  const out = new Uint8Array(10 + tagBodyLen + audio.length);
  let o = 0;
  out.set(header, o); o += 10;
  for (const p of parts) { out.set(p, o); o += p.length; }
  out.set(audio, o);
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
