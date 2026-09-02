import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useUIStore } from "@/state/uiStore";
import { useHotkeyStore } from "@/state/hotkeyStore";
import { getHotkeyCheatSheet } from "@/hooks/useGlobalHotkeys";

export function HotkeyOverlay() {
  const open = useUIStore((s) => s.hotkeyOverlayOpen);
  const bindings = useHotkeyStore((s) => s.bindings);
  const hotkeys = useMemo(() => getHotkeyCheatSheet(bindings), [bindings]);
  const close = () => useUIStore.getState().setHotkeyOverlay(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong max-w-2xl w-full rounded-2xl p-6 relative"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
                  Keyboard
                </div>
                <div className="text-xl font-semibold neon-text">Shortcuts</div>
              </div>
              <button
                onClick={close}
                className="w-8 h-8 grid place-items-center rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25"
              >
                {"\u2715"}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {hotkeys.map((h) => (
                <div
                  key={h.label}
                  className="flex items-center justify-between gap-3 py-1 border-b border-white/[0.04]"
                >
                  <div className="flex gap-1 flex-wrap">
                    {h.keys.map((k) => (
                      <kbd
                        key={k}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-white/12 bg-white/[0.05]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                  <div className="text-[12px] text-white/75 text-right">
                    {h.label}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[10px] uppercase tracking-[0.3em] text-dim text-center">
              Press ? or Esc to close
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
