import { useEffect } from "react";
import { usePlayerStore, type QueueItem } from "@/state/playerStore";
import { useUIStore } from "@/state/uiStore";
import { extractMetadata } from "@/lib/metadata";

// Containers Electron's Chromium can actually decode through <audio>. WAV
// (PCM) + FLAC carry hi-res lossless; the rest are the common lossy/web
// containers. (wma/alac/aiff/dsd are intentionally absent — Chromium can't
// decode them, so accepting them would only fail silently on play.)
const AUDIO_EXTS = [
  "mp3", "wav", "wave", "flac", "ogg", "oga", "opus",
  "m4a", "m4b", "mp4", "aac", "webm", "weba", "mka",
];

/**
 * Global drop target on `window`. Accepts files dropped from File Explorer
 * (Electron exposes `file.path`) and from in-browser file pickers. Folders
 * dropped on Windows are unwrapped via webkitGetAsEntry.
 *
 * All dropped audio files become queue items appended to the player. The
 * first dropped file auto-plays if the queue was empty.
 */
export function useFileDrop(): void {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      const items = await collectAudioFiles(e.dataTransfer);
      if (items.length === 0) {
        useUIStore.getState().toast("No supported audio files in the drop");
        return;
      }
      const player = usePlayerStore.getState();
      const wasEmpty = player.queue.length === 0;
      player.enqueue(items);
      useUIStore
        .getState()
        .toast(
          items.length === 1
            ? `Added "${items[0].name}"`
            : `Queued ${items.length} tracks`,
        );
      // Kick off auto-play + metadata enrich after enqueue ran.
      if (wasEmpty) {
        await usePlayerStore.getState().play();
      }
      void enrichMetadataFor(items);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}

async function collectAudioFiles(dt: DataTransfer): Promise<QueueItem[]> {
  const out: QueueItem[] = [];
  const entries = Array.from(dt.items)
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() ?? null : null))
    .filter((e): e is FileSystemEntry => Boolean(e));

  // If we got entries (folders/files via the standard FS Access API), walk
  // them recursively. Otherwise fall back to dt.files (Electron path case).
  if (entries.length > 0) {
    for (const entry of entries) {
      await walkEntry(entry, out);
    }
  } else {
    for (const f of Array.from(dt.files)) {
      const item = await fileToItem(f);
      if (item) out.push(item);
    }
  }
  return out;
}

async function walkEntry(entry: FileSystemEntry, out: QueueItem[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return new Promise((resolve) => {
      fileEntry.file(async (f) => {
        const item = await fileToItem(f);
        if (item) out.push(item);
        resolve();
      });
    });
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    return new Promise((resolve) => {
      const collected: FileSystemEntry[] = [];
      const read = () => {
        reader.readEntries(async (batch) => {
          if (batch.length === 0) {
            for (const e of collected) await walkEntry(e, out);
            resolve();
            return;
          }
          collected.push(...batch);
          read();
        });
      };
      read();
    });
  }
}

async function fileToItem(f: File): Promise<QueueItem | null> {
  const ext = (f.name.split(".").pop() ?? "").toLowerCase();
  if (!AUDIO_EXTS.includes(ext)) return null;
  // Electron's File has a `.path` property (full FS path). Prefer it so we
  // can serve via the playground-audio protocol (better seek + range support).
  const electronPath = (f as File & { path?: string }).path;
  let src: string;
  if (electronPath && window.playground) {
    src = `playground-audio:///load?p=${encodeURIComponent(electronPath)}`;
  } else {
    src = URL.createObjectURL(f);
  }
  return {
    id: Math.random().toString(36).slice(2, 10),
    src,
    name: f.name,
  };
}

async function enrichMetadataFor(items: QueueItem[]): Promise<void> {
  for (const item of items) {
    try {
      const resp = await fetch(item.src);
      const blob = await resp.blob();
      const meta = await extractMetadata(blob);
      item.metadata = meta;
      const player = usePlayerStore.getState();
      const cur = player.queue.find((q) => q.id === item.id);
      if (cur) cur.metadata = meta;
      // If this is the currently-loaded item, push metadata immediately.
      if (player.queue[player.currentIndex]?.id === item.id) {
        player.setMetadata(meta);
      }
    } catch (err) {
      console.warn("[metadata] enrich failed for", item.name, err);
    }
  }
}
