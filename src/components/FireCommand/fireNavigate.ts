/**
 * Programmatic fold + scroll navigation for Fire Command.
 * Layout only — writes the same localStorage keys as useFireCollapsed.
 */

import { FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";

export const FIRE_FOLD_EVENT = "killchain.firecmd.fold";
export const foldStorageKey = (key: string) => `killchain.firecmd.fold.${key}`;

export function writeFold(key: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(foldStorageKey(key), collapsed ? "1" : "0");
  } catch { /* quota */ }
  window.dispatchEvent(
    new CustomEvent(FIRE_FOLD_EVENT, { detail: { key, collapsed } }),
  );
}

export function ensureExpanded(key: string): void {
  writeFold(key, false);
}

export function scrollToModule(moduleId: FireModuleId, behavior: ScrollBehavior = "smooth"): void {
  const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(moduleId)
    : moduleId.replace(/"/g, '\\"');
  const el = document.querySelector(`[data-fire-module="${safe}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior, block: "start" });
    el.classList.add("fire-module-flash");
    window.setTimeout(() => el.classList.remove("fire-module-flash"), 900);
  }
}

/** Expand band + module, wait for mount, then scroll into view. */
export function jumpToModule(moduleId: FireModuleId): void {
  const entry = FIRE_MODULE_BY_ID.get(moduleId);
  if (!entry) return;
  ensureExpanded(entry.bandKey);
  ensureExpanded(moduleId);
  // Band children remount after expand — give React a couple frames + a beat.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => scrollToModule(moduleId), 48);
    });
  });
}
