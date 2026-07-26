import { useCallback, useState } from "react";

/**
 * Per-section fold state, persisted so the layout the user arranges survives
 * reloads. Key-less callers stay expanded (hook still runs unconditionally).
 */
export function useFireCollapsed(key: string | undefined, def = false): [boolean, () => void] {
  const storage = key ? `killchain.firecmd.fold.${key}` : null;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!storage) return false;
    try {
      const raw = window.localStorage.getItem(storage);
      return raw === null ? def : raw === "1";
    } catch {
      return def;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      if (storage) {
        try {
          window.localStorage.setItem(storage, c ? "0" : "1");
        } catch {
          /* ignore */
        }
      }
      return !c;
    });
  }, [storage]);
  return [collapsed, toggle];
}
