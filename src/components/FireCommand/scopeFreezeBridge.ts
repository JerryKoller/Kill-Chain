/**
 * Shared Scope freeze flag — Home deck ↔ Scope panel (UI only).
 */

export const SCOPE_FREEZE_EVENT = "killchain.fire.scopeFreeze";
const KEY = "killchain.fire.scopeFreeze";

export function readScopeFreeze(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeScopeFreeze(freeze: boolean): void {
  try {
    window.localStorage.setItem(KEY, freeze ? "1" : "0");
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(SCOPE_FREEZE_EVENT, { detail: { freeze } }));
}

export function toggleScopeFreeze(): boolean {
  const next = !readScopeFreeze();
  writeScopeFreeze(next);
  return next;
}
