/**
 * Fire layout context — Focus Mode (solo one module) + shared jump helpers.
 * Display / organization only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FIRE_MODULE_BY_ID, type FireModuleId } from "./fireModuleAtlas";
import { ensureExpanded, jumpToModule } from "./fireNavigate";
import { registerFireFocusBridge, useFireMidiFocusStore } from "@/state/fireMidiFocusStore";
import { FIRE_FOCUS_RING } from "./fireKnobFocus";

type FireLayoutValue = {
  focusId: FireModuleId | null;
  enterFocus: (moduleId: FireModuleId, opts?: { density?: boolean }) => void;
  exitFocus: () => void;
  jump: (moduleId: FireModuleId) => void;
  isFocused: (moduleId: string | undefined) => boolean;
  /** True when some module is soloed */
  focusActive: boolean;
};

const FireLayoutContext = createContext<FireLayoutValue | null>(null);

export function FireLayoutProvider({ children }: { children: ReactNode }) {
  const [focusId, setFocusId] = useState<FireModuleId | null>(null);
  const focusIdRef = useRef<FireModuleId | null>(null);
  focusIdRef.current = focusId;

  // Pending scroll choreography — cancelled on unmount so nothing fires late.
  const pendingRafsRef = useRef<number[]>([]);
  const pendingTimeoutsRef = useRef<number[]>([]);
  useEffect(() => () => {
    for (const id of pendingRafsRef.current) window.cancelAnimationFrame(id);
    for (const id of pendingTimeoutsRef.current) window.clearTimeout(id);
    pendingRafsRef.current = [];
    pendingTimeoutsRef.current = [];
  }, []);

  const jump = useCallback((moduleId: FireModuleId) => {
    jumpToModule(moduleId);
  }, []);

  const enterFocus = useCallback((moduleId: FireModuleId, opts?: { density?: boolean }) => {
    const entry = FIRE_MODULE_BY_ID.get(moduleId);
    if (!entry) return;
    ensureExpanded(entry.bandKey);
    ensureExpanded(moduleId);
    setFocusId(moduleId);
    // Keep MPK Focus ring aligned when Solo is entered from the deck / map.
    const ringIdx = FIRE_FOCUS_RING.findIndex((m) => m.id === moduleId);
    if (ringIdx >= 0) {
      useFireMidiFocusStore.setState({ index: ringIdx, bankPage: 0 });
    }
    // Auto-offer Focus density on explicit Solo actions. MIDI ring nav opts
    // out — twisting PROG on an MPK must not collapse the whole console.
    if (opts?.density !== false) {
      void import("@/state/fireCommandStore").then(({ useFireCommandStore }) => {
        useFireCommandStore.getState().enterFireFocusDensity();
      });
    }
    pendingRafsRef.current.push(window.requestAnimationFrame(() => {
      pendingRafsRef.current.push(window.requestAnimationFrame(() => {
        pendingTimeoutsRef.current.push(window.setTimeout(() => jumpToModule(moduleId), 48));
      }));
    }));
  }, []);

  const exitFocus = useCallback(() => {
    setFocusId(null);
    void import("@/state/fireCommandStore").then(({ useFireCommandStore }) => {
      useFireCommandStore.getState().exitFireFocusDensity();
    });
  }, []);

  // Let MPK Focus MIDI drive Solo Mode (without hijacking UI density).
  useEffect(() => {
    registerFireFocusBridge({
      enterFocus: (moduleId) => enterFocus(moduleId as FireModuleId, { density: false }),
      exitFocus,
    });
    return () => registerFireFocusBridge(null);
  }, [enterFocus, exitFocus]);

  // Esc exits Focus / Solo mode from anywhere in Fire Command.
  // Routes through exitFocus so the auto-entered Focus density restores too.
  // Bubble-phase + preventDefault: consume the key so a live Open Fire is not
  // also panicked. Skip editors / inputs / modals — they own Escape first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      if (!focusIdRef.current) return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || (t instanceof HTMLElement && t.isContentEditable)
      ) return;
      if (document.querySelector("[aria-modal='true']")) return;
      if (document.querySelector("[data-fire-editor-fullscreen]")) return;
      const el = t instanceof Element ? t : null;
      const editorSel = "[data-fire-piano-roll], [data-fire-arrangement], [data-fire-drums]";
      const inEditor = !!el?.closest(editorSel);
      const editorHot = !!document.querySelector(
        "[data-fire-piano-roll]:hover, [data-fire-arrangement]:hover, [data-fire-drums]:hover",
      );
      const editorFocused = !!document.activeElement?.closest?.(editorSel);
      if (inEditor || editorHot || editorFocused) return;
      e.preventDefault();
      exitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitFocus]);

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
