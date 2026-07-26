import { useCallback, useEffect, useState } from "react";
import { FIRE_FOLD_EVENT, foldStorageKey } from "./fireNavigate";

/**
 * Per-section fold state, persisted so the layout the user arranges survives
 * reloads. Key-less callers stay expanded (hook still runs unconditionally).
 * Listens for programmatic expand/collapse via fireNavigate.writeFold.
 */
export function useFireCollapsed(key: string | undefined, def = false): [boolean, () => void] {
  const storage = key ? foldStorageKey(key) : null;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!storage) return false;
    try {
      const raw = window.localStorage.getItem(storage);
      return raw === null ? def : raw === "1";
    } catch {
      return def;
    }
  });

  useEffect(() => {
    if (!key) return;
    const onFold = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; collapsed: boolean }>).detail;
      if (!detail || detail.key !== key) return;
      setCollapsed(!!detail.collapsed);
    };
    window.addEventListener(FIRE_FOLD_EVENT, onFold);
    return () => window.removeEventListener(FIRE_FOLD_EVENT, onFold);
  }, [key]);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      if (storage) {
        try {
          window.localStorage.setItem(storage, next ? "1" : "0");
        } catch { /* ignore */ }
      }
      return next;
    });
  }, [storage]);

  return [collapsed, toggle];
}
