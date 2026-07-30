/**
 * Fire Command → Kill-Chain Library export.
 * Bounce dry Fire audio, tag (MP3), write into Music/Kill-Chain/Fire Exports,
 * and upsert the track into libraryStore.
 */

import {
  bounceFireDryAudio,
  encodeMp3,
  encodeWav,
  fireExportPreflight,
  toBase64,
  type ExportFormat,
  type ExportMethod,
  type ExportProgress,
} from "@/lib/fireStudio";
import { base64ToBytes, prependId3v24 } from "@/lib/id3Write";
import { useLibraryStore } from "@/state/libraryStore";
import { useCoverStore } from "@/state/coverStore";

export interface LibraryExportMeta {
  title: string;
  artist: string;
  album: string;
  genre?: string;
  format: ExportFormat;
  /** Optional album art (already loaded as base64). */
  artwork?: { base64: string; mime: string } | null;
}

export interface LibraryExportResult {
  path: string;
  method: ExportMethod;
  trackTitle: string;
}

function sanitizeFilePart(s: string): string {
  return s
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    || "Untitled";
}

function joinPath(dir: string, name: string): string {
  const sep = /\\/.test(dir) ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

function buildFileName(meta: LibraryExportMeta, format: ExportFormat): string {
  const artist = sanitizeFilePart(meta.artist || "Kill-Chain");
  const title = sanitizeFilePart(meta.title || "Fire Export");
  return `${artist} - ${title}.${format}`;
}

async function uniqueFileName(dir: string, name: string): Promise<string> {
  const stat = window.playground?.library?.statFile;
  if (!stat) return name;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let i = 2; i < 50; i++) {
    const hit = await stat(joinPath(dir, candidate));
    if (!hit) return candidate;
    candidate = `${stem} (${i})${ext}`;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Bounce the current Fire pattern/arrangement into the Library export folder.
 */
export async function exportFireToLibrary(
  meta: LibraryExportMeta,
  onProgress?: (p: ExportProgress) => void,
): Promise<LibraryExportResult | null> {
  const files = window.playground?.files;
  const lib = window.playground?.library;
  const writeIn = files?.writeIn;
  if (!files || !lib?.getExportDir || !writeIn) {
    throw new Error("Library export needs the desktop app.");
  }

  const gate = await fireExportPreflight();
  if (!gate.ok) throw new Error(gate.reason ?? "Nothing to export");

  // Artwork embeds only in MP3 — auto-upgrade when art is present.
  let format: ExportFormat = meta.format;
  if (meta.artwork?.base64 && format === "wav") format = "mp3";

  const dir = await lib.getExportDir();
  if (!dir) throw new Error("Could not create the Fire Exports folder.");

  const bounced = await bounceFireDryAudio(onProgress);
  if (!bounced) throw new Error("Export was silent — nothing written.");

  onProgress?.({
    stage: format === "mp3" ? "Encoding MP3…" : "Encoding WAV…",
    fraction: 0.88,
  });

  let data =
    format === "mp3"
      ? await encodeMp3(bounced.left, bounced.right, bounced.sampleRate)
      : await encodeWav(bounced.left, bounced.right, bounced.sampleRate);

  if (format === "mp3") {
    const art = meta.artwork?.base64
      ? {
          mime: meta.artwork.mime || "image/jpeg",
          data: base64ToBytes(meta.artwork.base64),
        }
      : null;
    data = prependId3v24(data, {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      genre: meta.genre ?? "Electronic",
      artwork: art,
    });
  }

  const fileName = await uniqueFileName(dir, buildFileName({ ...meta, format }, format));
  onProgress?.({ stage: "Saving to Library…", fraction: 0.95 });
  const path = await writeIn(dir, fileName, toBase64(data));
  if (!path) throw new Error("Could not write the export file.");

  const durationSec = bounced.left.length / bounced.sampleRate;
  await useLibraryStore.getState().ingestExportedTrack({
    path,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    durationSec,
    genre: meta.genre ?? "Electronic",
  });

  // Seed cover cache immediately when we have in-memory art.
  if (meta.artwork?.base64) {
    try {
      const bytes = base64ToBytes(meta.artwork.base64);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: meta.artwork.mime || "image/jpeg" });
      const url = URL.createObjectURL(blob);
      useCoverStore.setState((s) => ({
        covers: { ...s.covers, [path]: url },
      }));
    } catch { /* ignore */ }
  } else if (format === "mp3") {
    useCoverStore.getState().requestCover(path);
  }

  onProgress?.({ stage: "Done", fraction: 1 });
  return { path, method: bounced.method, trackTitle: meta.title };
}
