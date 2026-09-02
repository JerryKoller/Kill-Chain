/**
 * Fire Command clipboard — one JSON envelope for roll notes, drum lanes,
 * arrangement clips, and automation.
 *
 * navigator.clipboard.writeText is the OS path (survives reload, can leave
 * the app). Each kind also keeps an in-app RAM slot so paste still works when
 * clipboard permission is denied or the OS buffer was overwritten by unrelated
 * text. RAM is per-kind so copying a drum lane does not wipe copied notes.
 */

export const FIRE_CLIP_KIND = {
  rollNotes: "rollNotes",
  drumLane: "drumLane",
  arrangementClips: "arrangementClips",
  automationLane: "automationLane",
} as const;

export type FireClipKind = (typeof FIRE_CLIP_KIND)[keyof typeof FIRE_CLIP_KIND];

const APP = "killchain-fire";
const VERSION = 1;

interface FireClipEnvelope<T> {
  v: typeof VERSION;
  app: typeof APP;
  kind: FireClipKind;
  payload: T;
}

const ram = new Map<FireClipKind, string>();

function encode<T>(kind: FireClipKind, payload: T): string {
  const env: FireClipEnvelope<T> = { v: VERSION, app: APP, kind, payload };
  return JSON.stringify(env);
}

function decode<T>(text: string, kind: FireClipKind): T | null {
  try {
    const parsed = JSON.parse(text) as Partial<FireClipEnvelope<T>>;
    if (parsed?.v !== VERSION || parsed.app !== APP || parsed.kind !== kind) return null;
    if (parsed.payload === undefined) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

/** Write RAM immediately; OS clipboard is best-effort. */
export function writeFireClipboard<T>(kind: FireClipKind, payload: T): void {
  const json = encode(kind, payload);
  ram.set(kind, json);
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  void navigator.clipboard.writeText(json).catch(() => {
    /* RAM still holds the copy */
  });
}

export function peekFireClipboard<T>(kind: FireClipKind): T | null {
  const json = ram.get(kind);
  if (!json) return null;
  return decode<T>(json, kind);
}

export function hasFireClipboard(kind: FireClipKind): boolean {
  return ram.has(kind);
}

/**
 * Prefer the OS buffer when it is a Fire envelope of `kind`; otherwise the
 * in-app slot. Call from a user-gesture handler (Ctrl+V / button) so
 * clipboard.readText still has transient activation.
 */
export async function readFireClipboard<T>(kind: FireClipKind): Promise<T | null> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      const fromOs = decode<T>(text, kind);
      if (fromOs != null) {
        ram.set(kind, encode(kind, fromOs));
        return fromOs;
      }
    } catch {
      /* permission / empty — fall through to RAM */
    }
  }
  return peekFireClipboard<T>(kind);
}

/**
 * Where a copied block should land: playhead if the span fits, otherwise the
 * first gap (start of the pattern). Overflow past `limit` is the reason paste
 * used to toast “outside this pattern” and drop everything.
 */
export function pasteAnchorStep(
  origin: number,
  span: number,
  playhead: number,
  limit: number,
): number {
  if (!(limit > 0)) return 0;
  let dest = Number.isFinite(playhead) && playhead >= 0 ? playhead : 0;
  if (dest >= limit) dest %= limit;
  if (dest < 0) dest = 0;
  const safeSpan = Math.max(0, span);
  if (safeSpan <= 0) return dest;
  if (dest + safeSpan <= limit + 1e-9) return dest;
  return 0;
}
