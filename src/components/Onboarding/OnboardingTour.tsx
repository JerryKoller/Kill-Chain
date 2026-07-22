import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "@/state/settingsStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { openHeadphoneWizard } from "@/components/Settings/HeadphoneWizard";
import { PRODUCT_TAGLINE, PRODUCT_DESCRIPTION } from "@/lib/appVersion";

interface Step {
  title: string;
  body: string;
  cta?: string;
  view?: "playground" | "tractor" | "calibration" | "presets" | "settings";
  /** Custom CTA side effect (used instead of / alongside a view switch). */
  action?: () => void;
  /** Render the output-setup picker (headphones / speakers / TV / etc.). */
  outputSetup?: boolean;
}

const OUTPUT_CHOICES: Array<{
  label: string;
  sub: string;
  profileId: string;
  wizard?: boolean;
}> = [
  { label: "Headphones", sub: "Over-ear, on-ear, IEM, earbuds", profileId: "", wizard: true },
  { label: "Desktop / bookshelf speakers", sub: "PC speakers, monitors, smart speakers", profileId: "generic-pc-speakers" },
  { label: "Soundbar / TV", sub: "Living-room bar or built-in TV audio", profileId: "generic-soundbar-21" },
  { label: "Home theater", sub: "Multi-speaker TV / receiver layout", profileId: "generic-tv" },
  { label: "Not sure", sub: "Neutral — no correction curve", profileId: "neutral" },
];

const STEPS: Step[] = [
  {
    title: "Welcome to Kill-Chain",
    body: `${PRODUCT_TAGLINE} ${PRODUCT_DESCRIPTION}`,
  },
  {
    title: "What are you listening on?",
    body:
      "Pick a starting correction profile for your output device. Headphones, speakers, soundbars, and TVs each get their own compatibility curves. You can change this any time under Settings → Playback Correction.",
    outputSetup: true,
  },
  {
    title: "Sculptor — your fire-control bench",
    body:
      "A configurable parametric EQ (add or remove 1-20 bands), quick tone knobs, dynamic effects, A/B compare, and save it all as a preset. Drag an EQ node to move it, double-click empty space to add one.",
    cta: "Take me there",
    view: "playground",
  },
  {
    title: "Tractor Beam auto-tunes to a track",
    body:
      "Drop in a song and Tractor Beam analyses its spectral balance, then crafts an EQ voiced for your output profile and that style of music. One click to apply.",
    cta: "Open Tractor Beam",
    view: "tractor",
  },
  {
    title: "Calibration finds YOUR profile",
    body:
      "30 quick A/B questions build a personal sound signature. Or jump straight to the direct-edit sliders on the right.",
    cta: "Open Calibration",
    view: "calibration",
  },
  {
    title: "Presets blend, morph, and stack",
    body:
      "Pick two presets, drag the slider to morph between them. Save your favourites - they live in localStorage forever.",
    cta: "Show Presets",
    view: "presets",
  },
  {
    title: "Press ? any time",
    body:
      "Brings up the keyboard cheat sheet. Spacebar plays/pauses, A/B snapshot the tuning, number keys jump between tools. Briefing complete — drop an audio file on the window to start.",
  },
];

export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [closed, setClosed] = useState(false);
  const setOnboardingDone = useSettingsStore((s) => s.set);
  const setHeadphone = useSettingsStore((s) => s.set);
  const setHeadphoneProfile = useAudioStore((s) => s.setHeadphoneProfile);
  const setView = useUIStore((s) => s.setView);
  const toast = useUIStore((s) => s.toast);

  const close = () => {
    setOnboardingDone("onboardingDone", true);
    setClosed(true);
  };

  const pickOutput = (choice: (typeof OUTPUT_CHOICES)[number]) => {
    if (choice.wizard) {
      openHeadphoneWizard();
      setStep(step + 1);
      return;
    }
    setHeadphone("headphone", choice.profileId);
    setHeadphoneProfile(choice.profileId);
    toast(`Playback correction: ${choice.label}`, "success");
    setStep(step + 1);
  };

  // Keyboard navigation: Esc skips, arrows/Enter advance.
  useEffect(() => {
    if (closed) return;
    const s = STEPS[step];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (s.outputSetup) return;
      else if (e.key === "ArrowRight" || e.key === "Enter") setStep((v) => Math.min(v + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed, step]);

  if (closed) return null;
  const s = STEPS[step];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center p-6"
      >
        <motion.div
          key={step}
          initial={{ y: 20, scale: 0.97, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: -20, scale: 0.97, opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 30 }}
          className="glass-strong max-w-md w-full rounded-2xl p-6"
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-cyan mb-2">
            Step {step + 1} / {STEPS.length}
          </div>
          <div className="text-2xl font-semibold neon-text mb-3">{s.title}</div>
          <div className="text-sm text-white/85 leading-relaxed mb-5">{s.body}</div>

          {s.outputSetup && (
            <div className="mb-5 flex flex-col gap-2">
              {OUTPUT_CHOICES.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => pickOutput(c)}
                  className="rounded-xl border border-white/10 bg-white/[0.04] hover:border-cyan/40 hover:bg-cyan/10 px-3 py-2.5 text-left transition"
                >
                  <div className="text-sm font-semibold text-white">{c.label}</div>
                  <div className="text-[11px] text-dim mt-0.5">{c.sub}</div>
                </button>
              ))}
              <p className="text-[10px] text-dim mt-1 leading-relaxed">
                Profiles are compatibility aids, not brand endorsements.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={close}
              className="text-xs text-dim hover:text-white transition"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="kc-btn kc-btn--sm kc-btn--ghost"
                >
                  Back
                </button>
              )}
              {s.cta && (s.view || s.action) && (
                <>
                  <button
                    onClick={() => setStep(step + 1)}
                    className="kc-btn kc-btn--sm kc-btn--ghost"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => {
                      if (s.view) setView(s.view);
                      s.action?.();
                      setStep(step + 1);
                    }}
                    className="kc-btn kc-btn--sm kc-btn--accent"
                  >
                    {s.cta}
                  </button>
                </>
              )}
              {step < STEPS.length - 1 && !s.cta && !s.outputSetup && (
                <button
                  onClick={() => setStep(step + 1)}
                  className="kc-btn kc-btn--sm kc-btn--accent"
                >
                  Next
                </button>
              )}
              {step === STEPS.length - 1 && (
                <button
                  onClick={close}
                  className="kc-btn kc-btn--sm kc-btn--primary"
                >
                  Begin operations
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-1.5 justify-center">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === step ? "bg-cyan w-6" : "bg-white/15 w-1.5"
                }`}
              />
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
