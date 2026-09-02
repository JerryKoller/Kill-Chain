/**
 * Favorites and recents for the patch library.
 *
 * 420 factory patches with a flat category rail and no way to mark the ones
 * you actually use: finding a patch you liked yesterday meant remembering
 * which of eight categories it lived in and scrolling. This adds two
 * persistent shelves — starred and recently loaded — stored locally so they
 * survive reloads.
 *
 * Kept out of the Zustand patch store on purpose: these are library
 * preferences, not part of a patch, and must never end up in undo history,
 * project files, or exported presets.
 */

const FAV_KEY = "killchain.fire.presetFavorites";
const RECENT_KEY = "killchain.fire.presetRecents";
const RECENT_MAX = 24;

/** Fired whenever favorites or recents change, so open UI re-reads. */
export const FIRE_SHELF_EVENT = "killchain.fire.presetShelf";

/** Node-side importers (bank generators, audits) pull this module in transitively. */
const hasDom = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

function readList(key: string): string[] {
  if (!hasDom) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  if (!hasDom) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota — shelves are a convenience, never fail a load over them */
  }
  window.dispatchEvent(new CustomEvent(FIRE_SHELF_EVENT));
}

export function readFavorites(): Set<string> {
  return new Set(readList(FAV_KEY));
}

export function isFavorite(id: string): boolean {
  return readFavorites().has(id);
}

/** Returns the new favorite state for `id`. */
export function toggleFavorite(id: string): boolean {
  const favs = readFavorites();
  const next = !favs.has(id);
  if (next) favs.add(id); else favs.delete(id);
  writeList(FAV_KEY, [...favs]);
  return next;
}

/** Most-recent-first list of preset ids. */
export function readRecents(): string[] {
  return readList(RECENT_KEY);
}

export function pushRecent(id: string): void {
  if (!id) return;
  const list = readRecents().filter((x) => x !== id);
  list.unshift(id);
  writeList(RECENT_KEY, list.slice(0, RECENT_MAX));
}

/** Drop ids that no longer exist (deleted user presets). */
export function pruneShelves(validIds: Set<string>): void {
  if (!hasDom) return;
  const favs = [...readFavorites()].filter((id) => validIds.has(id));
  const recents = readRecents().filter((id) => validIds.has(id));
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(FIRE_SHELF_EVENT));
}
