/**
 * Fire layout context — Focus Mode (solo one module) + shared jump helpers.
 * Display / organization only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";
import { ensureExpanded, jumpToModule } from "./fireNavigate";

type FireLayoutValue = {
  focusId: FireModuleId | null;
  enterFocus: (moduleId: FireModuleId) => void;
  exitFocus: () => void;
  jump: (moduleId: FireModuleId) => void;
  isFocused: (moduleId: string | undefined) => boolean;
  /** True when some module is soloed */
  focusActive: boolean;
};

const FireLayoutContext = createContext<FireLayoutValue | null>(null);

export function FireLayoutProvider({ children }: { children: ReactNode }) {
  const [focusId, setFocusId] = useState<FireModuleId | null>(null);

  const jump = useCallback((moduleId: FireModuleId) => {
    jumpToModule(moduleId);
  }, []);

  const enterFocus = useCallback((moduleId: FireModuleId) => {
    const entry = FIRE_MODULE_BY_ID.get(moduleId);
    if (!entry) return;
    ensureExpanded(entry.bandKey);
    ensureExpanded(moduleId);
    setFocusId(moduleId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => jumpToModule(moduleId), 48);
      });
    });
  }, []);

  const exitFocus = useCallback(() => {
    setFocusId(null);
  }, []);

  const isFocused = useCallback(
    (moduleId: string | undefined) => !!focusId && !!moduleId && focusId === moduleId,
    [focusId],
  );

  const value = useMemo(
    () => ({
      focusId,
      enterFocus,
      exitFocus,
      jump,
      isFocused,
      focusActive: focusId !== null,
    }),
    [focusId, enterFocus, exitFocus, jump, isFocused],
  );

  return (
    <FireLayoutContext.Provider value={value}>
      {children}
    </FireLayoutContext.Provider>
  );
}

export function useFireLayout(): FireLayoutValue {
  const ctx = useContext(FireLayoutContext);
  if (!ctx) {
    // Safe no-op fallback so panels don't crash outside provider (tests / stray mounts)
    return {
      focusId: null,
      enterFocus: () => {},
      exitFocus: () => {},
      jump: jumpToModule,
      isFocused: () => false,
      focusActive: false,
    };
  }
  return ctx;
}
