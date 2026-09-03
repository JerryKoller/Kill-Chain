import { inflateSync } from "node:zlib";

function u32(buf, off) {
  return buf.readUInt32BE(off);
}

/**
 * Decode a PNG enough to measure near-black coverage. No extra dependencies.
 */
export function pngStats(buf) {
  if (!buf || buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    return { ok: false, error: "not-png" };
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 2;
  const idats = [];
  while (off + 8 <= buf.length) {
    const len = u32(buf, off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    const end = start + len;
    if (end > buf.length) break;
    if (type === "IHDR") {
      width = u32(buf, start);
      height = u32(buf, start + 4);
      bitDepth = buf[start + 8];
      colorType = buf[start + 9];
    } else if (type === "IDAT") {
      idats.push(buf.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    off = end + 4;
  }
  const bytes = Buffer.concat(idats);
  let raw;
  try {
    raw = inflateSync(bytes);
  } catch (err) {
    return { ok: false, error: String(err.message || err), width, height, bytes: buf.length };
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const stride = width * channels;
  let black = 0;
  let dark = 0;
  let samples = 0;
  let maxLuma = 0;
  let y = 0;
  let i = 0;
  const recon = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  while (y < height && i < raw.length) {
    const filter = raw[i++];
    const row = raw.subarray(i, i + stride);
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? recon[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x] || 0;
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 255;
      }
      recon[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const o = x * channels;
      const r = recon[o];
      const g = channels > 1 ? recon[o + 1] : r;
      const bch = channels > 1 ? recon[o + 2] : r;
      const luma = (r * 299 + g * 587 + bch * 114) / 1000;
      samples += 1;
      if (luma <= 2) black += 1;
      if (luma <= 12) dark += 1;
      if (luma > maxLuma) maxLuma = luma;
    }
    prev.set(recon);
    y += 1;
  }
  const blackRatio = samples ? black / samples : 1;
  const darkRatio = samples ? dark / samples : 1;
  return {
    ok: true,
    width,
    height,
    bitDepth,
    colorType,
    bytes: buf.length,
    samples,
    blackRatio,
    darkRatio,
    maxLuma,
    likelyBlack: blackRatio >= 0.98 || (buf.length < 8000 && width >= 200),
    likelyUsable: blackRatio < 0.85 && maxLuma > 20 && buf.length > 12000,
  };
}
