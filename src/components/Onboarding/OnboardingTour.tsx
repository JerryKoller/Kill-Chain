import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "@/state/settingsStore";
import { useUIStore } from "@/state/uiStore";

interface Step {
  title: string;
  body: string;
  cta?: string;
  view?: "playground" | "tractor" | "calibration" | "presets" | "settings";
}

const STEPS: Step[] = [
  {
    title: "Welcome to Kill-Chain",
    body:
      "Sculpt the sound, calibrate it to your ears, blend presets, and watch the music react in real time. Built around the Sony WH-1000XM6, but works with anything.",
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
      "Drop in a song and Tractor Beam analyses its spectral balance, then crafts an EQ voiced for your headphones and that style of music. One click to apply.",
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
  const setView = useUIStore((s) => s.setView);

  const close = () => {
    setOnboardingDone("onboardingDone", true);
    setClosed(true);
  };

  // Keyboard navigation: Esc skips, arrows/Enter advance.
  useEffect(() => {
    if (closed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") setStep((v) => Math.min(v + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed]);

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
                  className="rounded-lg border border-white/12 hover:bg-white/5 px-3 py-2 text-xs font-medium"
                >
                  Back
                </button>
              )}
              {s.cta && s.view && (
                <>
                  <button
                    onClick={() => setStep(step + 1)}
                    className="rounded-lg border border-white/12 hover:bg-white/5 px-3 py-2 text-xs font-medium"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => {
                      setView(s.view!);
                      setStep(step + 1);
                    }}
                    className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-2 text-xs font-semibold text-cyan"
                  >
                    {s.cta}
                  </button>
                </>
              )}
              {step < STEPS.length - 1 && !s.cta && (
                <button
                  onClick={() => setStep(step + 1)}
                  className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-3 py-2 text-xs font-semibold text-cyan"
                >
                  Next
                </button>
              )}
              {step === STEPS.length - 1 && (
                <button
                  onClick={close}
                  className="rounded-lg border border-cyan/60 bg-cyan/20 hover:bg-cyan/30 px-4 py-2 text-xs font-semibold text-cyan"
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
