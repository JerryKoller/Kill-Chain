/**
 * Programmatic fold + scroll navigation for Fire Command.
 * Layout only — writes the same localStorage keys as useFireCollapsed.
 */

import { FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";
import { writeFireWorkspace } from "./useFireWorkspace";
import { writeFireSynthBand } from "./useFireSynthBand";

export const FIRE_FOLD_EVENT = "killchain.firecmd.fold";
export const foldStorageKey = (key: string) => `killchain.firecmd.fold.${key}`;

/** Sticky FocusHud + deck chrome — keep jumped modules below the sticky bar. */
export const FIRE_SCROLL_MARGIN_TOP = 72;

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

/** Scroll the main app pane (not window) so Fire Command can reach y=0 and modules. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    const style = getComputedStyle(p);
    const oy = style.overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return p;
    p = p.parentElement;
  }
  return null;
}

export function scrollToModule(moduleId: FireModuleId, behavior: ScrollBehavior = "smooth"): void {
  const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(moduleId)
    : moduleId.replace(/"/g, '\\"');
  const el = document.querySelector(`[data-fire-module="${safe}"]`);
  if (!(el instanceof HTMLElement)) return;

  el.style.scrollMarginTop = `${FIRE_SCROLL_MARGIN_TOP}px`;
  const pane = scrollParentOf(el);
  if (pane) {
    const paneRect = pane.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const nextTop = pane.scrollTop + (elRect.top - paneRect.top) - FIRE_SCROLL_MARGIN_TOP;
    pane.scrollTo({ top: Math.max(0, nextTop), behavior });
  } else {
    el.scrollIntoView({ behavior, block: "start" });
  }
  el.classList.add("fire-module-flash");
  window.setTimeout(() => el.classList.remove("fire-module-flash"), 900);
}

/** Scroll Fire Command content pane to the absolute top (deck / header). */
export function scrollFireCommandTop(behavior: ScrollBehavior = "smooth"): void {
  const root = document.querySelector("[data-fire-root]");
  if (!(root instanceof HTMLElement)) return;
  let pane = scrollParentOf(root);
  if (!pane) {
    const mainPane = document.querySelector("main .overflow-auto, main [class*='overflow-auto']");
    if (mainPane instanceof HTMLElement) pane = mainPane;
  }
  if (pane) {
    pane.scrollTo({ top: 0, behavior });
    if (behavior === "smooth") {
      window.setTimeout(() => { if (pane && pane.scrollTop > 0 && pane.scrollTop < 8) pane.scrollTop = 0; }, 320);
    } else {
      pane.scrollTop = 0;
    }
  } else {
    root.scrollIntoView({ behavior, block: "start" });
  }
}

/** Expand band + module, wait for mount, then scroll into view. */
export function jumpToModule(moduleId: FireModuleId): void {
  const entry = FIRE_MODULE_BY_ID.get(moduleId);
  if (!entry) return;
  // Land on Synth workspace + the owning band tab so the module is mounted.
  writeFireWorkspace("synth");
  writeFireSynthBand(entry.bandKey);
  ensureExpanded(entry.bandKey);
  ensureExpanded(moduleId);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => scrollToModule(moduleId), 100);
    });
  });
}

/** Open the Signal Path homepage (Synth · Home). */
export function jumpToSynthHome(): void {
  writeFireWorkspace("synth");
  writeFireSynthBand("home");
  scrollFireCommandTop("smooth");
}
