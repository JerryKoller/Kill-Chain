import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { APP_VERSION, WHATS_NEW } from "@/lib/appVersion";
import { isLegalAccepted } from "@/lib/legal";
import { useSettingsStore } from "@/state/settingsStore";

/**
 * "What's new" panel (v1.5). Shows once per version — after the user has
 * been through onboarding — then remembers via settings.lastSeenVersion.
 * Can also be reopened from Settings.
 */

let openExternal: (() => void) | null = null;
export function openWhatsNew(): void {
  openExternal?.();
}

export function WhatsNewPanel() {
  const onboardingDone = useSettingsStore((s) => s.onboardingDone);
  const legalAcceptedAt = useSettingsStore((s) => s.legalAcceptedAt);
  const legalAcceptedVersion = useSettingsStore((s) => s.legalAcceptedVersion);
  const lastSeenVersion = useSettingsStore((s) => s.lastSeenVersion);
  const setSetting = useSettingsStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const legalOk = isLegalAccepted(legalAcceptedVersion, legalAcceptedAt);

  // Auto-open once per version (never on top of legal gate or onboarding).
  useEffect(() => {
    if (legalOk && onboardingDone && lastSeenVersion !== APP_VERSION) {
      setOpen(true);
    }
  }, [legalOk, onboardingDone, lastSeenVersion]);

  useEffect(() => {
    openExternal = () => setOpen(true);
    return () => {
      openExternal = null;
    };
  }, []);

  const close = () => {
    setSetting("lastSeenVersion", APP_VERSION);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[72] bg-black/60 backdrop-blur-sm grid place-items-center p-6"
          onClick={close}
        >
          <motion.div
            initial={{ y: 20, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -20, scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            className="glass-strong max-w-lg w-full rounded-2xl p-6 max-h-[85vh] overflow-y-auto sidebar-scroll"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`What's new in version ${APP_VERSION}`}
          >
            <div className="text-[10px] uppercase tracking-[0.3em] text-cyan mb-1">
              Version {APP_VERSION}
            </div>
            <div className="text-2xl font-semibold neon-text mb-4">
              What's new in Kill-Chain
            </div>
            <div className="flex flex-col gap-3">
              {WHATS_NEW.map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="text-sm font-semibold text-white/90">{item.title}</div>
                  <div className="text-[12px] text-dim mt-0.5 leading-relaxed">{item.body}</div>
                </div>
              ))}
            </div>
            <button
              onClick={close}
              className="mt-4 w-full rounded-lg border border-cyan/60 bg-cyan/20 hover:bg-cyan/30 px-4 py-2.5 text-sm font-semibold text-cyan"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
