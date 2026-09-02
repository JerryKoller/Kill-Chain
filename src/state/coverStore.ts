import { create } from "zustand";
import { audioUrlForPath } from "@/state/libraryStore";

/**
 * Lazy album-art cache. Covers are parsed on demand (only for the rows that
 * scroll into view and the now-playing track) so we never read every file's
 * artwork up front. Object URLs are capped + LRU-evicted to bound memory.
 *
 * Components subscribe to a single path via `useCoverStore(s => s.covers[path])`
 * so only the affected row re-renders when its art arrives. A value of "" means
 * "parsed, but this file has no embedded art" (so we don't keep retrying).
 */
interface CoverState {
  covers: Record<string, string>;
  requestCover: (path: string) => void;
}

let coverLibBroken = false;
const inflight = new Set<string>();
const queue: string[] = [];
let active = 0;
const order: string[] = [];
const MAX_ACTIVE = 3;
let cap = 500;

/** Raise the LRU cap (album-art grid shows far more covers than the list). */
export function raiseCoverCapacity(n: number): void {
  if (n > cap) cap = n;
}

export const useCoverStore = create<CoverState>((set, get) => {
  async function parse(path: string): Promise<string | null> {
    if (coverLibBroken) return "";
    try {
      const resp = await fetch(audioUrlForPath(path));
      // Transient (missing file, engine not ready) — don't cache, so a later
      // scroll/rescan can retry once the file is back.
      if (!resp.ok) return null;
      const blob = await resp.blob();
      let mm: typeof import("music-metadata");
      try {
        mm = await import("music-metadata");
      } catch {
        coverLibBroken = true;
        return "";
      }
      const { common } = await mm.parseBlob(blob, { duration: false, skipCovers: false });
      const pic = common.picture?.[0];
      if (!pic) return "";
      // Copy into a fresh ArrayBuffer-backed view so it's a valid BlobPart.
      const srcBytes = pic.data as Uint8Array;
      const bytes = new Uint8Array(srcBytes.byteLength);
      bytes.set(srcBytes);
      const coverBlob = new Blob([bytes], { type: pic.format || "image/jpeg" });
      return URL.createObjectURL(coverBlob);
    } catch {
      return null;
    }
  }

  function evictIfNeeded() {
    while (order.length > cap) {
      const old = order.shift();
      if (!old) break;
      const url = get().covers[old];
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
      set((s) => {
        const next = { ...s.covers };
        delete next[old];
        return { covers: next };
      });
    }
  }

  function pump() {
    while (active < MAX_ACTIVE && queue.length > 0) {
      const p = queue.shift()!;
      active += 1;
      parse(p)
        .then((url) => {
          inflight.delete(p);
          if (url === null) return;
          order.push(p);
          set((s) => ({ covers: { ...s.covers, [p]: url } }));
          evictIfNeeded();
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return {
    covers: {},
    requestCover: (path) => {
      if (!path || coverLibBroken) return;
      if (path in get().covers || inflight.has(path)) return;
      inflight.add(path);
      queue.push(path);
      pump();
    },
  };
});
