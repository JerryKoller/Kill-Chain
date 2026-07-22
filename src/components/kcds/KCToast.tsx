import { AnimatePresence, motion } from "framer-motion";
import { useUIStore } from "@/state/uiStore";

/**
 * KCDS toast host — renders the single app toast (uiStore.toast) as a
 * status pill: accent dot per kind, glass body, consistent motion.
 * Mount once (App.tsx).
 */
export function KCToastHost() {
  const msg = useUIStore((s) => s.toastMessage);
  const kind = useUIStore((s) => s.toastKind);
  const seq = useUIStore((s) => s.toastSeq);
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          key={seq}
          initial={{ y: 18, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 12, opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.19, ease: [0.2, 0.7, 0.2, 1] }}
          className={`pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 z-[60] kc-toast ${
            kind !== "info" ? `kc-toast--${kind}` : ""
          }`}
          role="status"
        >
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
