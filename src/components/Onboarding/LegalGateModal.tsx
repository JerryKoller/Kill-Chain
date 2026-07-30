import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  LEGAL_EULA_BODY,
  LEGAL_EULA_TITLE,
  LEGAL_PRIVACY_BODY,
  LEGAL_PRIVACY_TITLE,
  LEGAL_VERSION,
} from "@/lib/legal";
import { PRODUCT_TAGLINE } from "@/lib/appVersion";
import { useSettingsStore } from "@/state/settingsStore";

/**
 * First-run legal gate. Blocks the retail desktop UI until the user agrees
 * to the current LEGAL_VERSION. Re-run tour does not re-open this unless
 * the version was bumped.
 */
export function LegalGateModal() {
  const setSetting = useSettingsStore((s) => s.set);
  const [tab, setTab] = useState<"eula" | "privacy">("eula");
  const [agreed, setAgreed] = useState(false);

  const accept = () => {
    if (!agreed) return;
    setSetting("legalAcceptedVersion", LEGAL_VERSION);
    setSetting("legalAcceptedAt", new Date().toISOString());
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md grid place-items-center p-6"
        role="dialog"
        aria-modal="true"
        aria-label="License agreement"
      >
        <motion.div
          initial={{ y: 24, scale: 0.97, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 30 }}
          className="glass-strong max-w-xl w-full rounded-2xl p-6 max-h-[90vh] flex flex-col"
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-cyan mb-1">
            Before you begin · {LEGAL_VERSION}
          </div>
          <div className="text-2xl font-semibold neon-text mb-1">
            Agree to continue
          </div>
          <p className="text-sm text-white/80 leading-relaxed mb-4">
            {PRODUCT_TAGLINE} Review the draft license and privacy terms, then
            agree to unlock Kill-Chain.
          </p>

          <div className="flex gap-1 mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 self-start">
            <button
              type="button"
              onClick={() => setTab("eula")}
              className={`px-3 py-1.5 rounded-md text-xs transition ${
                tab === "eula" ? "bg-cyan/20 text-cyan" : "text-dim hover:text-white"
              }`}
            >
              {LEGAL_EULA_TITLE}
            </button>
            <button
              type="button"
              onClick={() => setTab("privacy")}
              className={`px-3 py-1.5 rounded-md text-xs transition ${
                tab === "privacy" ? "bg-cyan/20 text-cyan" : "text-dim hover:text-white"
              }`}
            >
              {LEGAL_PRIVACY_TITLE}
            </button>
          </div>

          <pre className="flex-1 min-h-[220px] max-h-[40vh] overflow-y-auto sidebar-scroll rounded-xl border border-white/10 bg-black/40 p-4 text-[11px] leading-relaxed text-white/75 whitespace-pre-wrap font-sans">
            {tab === "eula" ? LEGAL_EULA_BODY : LEGAL_PRIVACY_BODY}
          </pre>

          <label className="mt-4 flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 accent-[rgb(var(--c-cyan))]"
            />
            <span className="text-sm text-white/85 leading-snug">
              I have read and agree to the End User License Agreement and Privacy
              Policy (draft) for this version.
            </span>
          </label>

          <button
            type="button"
            disabled={!agreed}
            onClick={accept}
            className="mt-4 w-full kc-btn kc-btn--primary disabled:opacity-40 disabled:pointer-events-none"
          >
            I agree — continue
          </button>
          <p className="mt-2 text-[10px] text-dim leading-relaxed text-center">
            Draft terms pending attorney review. Acceptance is recorded locally
            on this device.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
