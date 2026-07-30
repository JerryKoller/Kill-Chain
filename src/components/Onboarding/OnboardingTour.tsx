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
  view?:
    | "playground"
    | "library"
    | "tractor"
    | "calibration"
    | "presets"
    | "settings"
    | "fire"
    | "glossary";
  /** Custom CTA side effect (used instead of / alongside a view switch). */
  action?: () => void;
  /** Render the output-setup picker (headphones / speakers / TV / etc.). */
  outputSetup?: boolean;
  /** Library-first-run CTAs (add folders / load a file). */
  libraryCta?: boolean;
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

/**
 * 7-step BASIC program. Legal gate runs separately before this.
 * In-depth explanations live in the Glossary — keep these short.
 */
const STEPS: Step[] = [
  {
    title: "Welcome to Kill-Chain",
    body: `${PRODUCT_TAGLINE} ${PRODUCT_DESCRIPTION}`,
  },
  {
    title: "What are you listening on?",
    body:
      "Pick a starting correction profile for your headphones, speakers, soundbar, or TV. You can change this any time under Settings → Playback Correction.",
    outputSetup: true,
  },
  {
    title: "Load some music",
    body:
      "The Library is where your tracks live. Add folders from your PC, or drop audio files onto the window. Play anything straight into the sculpting engine.",
    cta: "Open Library",
    view: "library",
    libraryCta: true,
  },
  {
    title: "Sculptor — reshape sound",
    body:
      "Your main bench: parametric EQ, tone knobs, dynamics, space, and color. Drag EQ nodes, tweak by ear, A/B compare — no Fire Command required.",
    cta: "Open Sculptor",
    view: "playground",
  },
  {
    title: "Tractor Beam — auto-tune a track",
    body:
      "Drop in a song and Tractor analyses its balance, then crafts an EQ voiced for your output. One click to apply. Dig deeper anytime in the Glossary.",
    cta: "Open Tractor Beam",
    view: "tractor",
  },
  {
    title: "Armory — presets",
    body:
      "Save what you like, morph between two presets, and stack favourites. Your Armory lives on this machine until you export a Kill-Chain backup.",
    cta: "Show Armory",
    view: "presets",
  },
  {
    title: "Advanced tools & shortcuts",
    body:
      "When you're ready: Fire Command (synth + sequencer), Airspace (in-app browser into the chain), and Morph Lab. Press ? for the keyboard cheat sheet — Space plays/pauses. Field Manual (Glossary) has the deep dive.",
    cta: "Open Glossary",
    view: "glossary",
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

  const addLibraryFolders = () => {
    setView("library");
    void import("@/state/libraryStore").then(({ useLibraryStore }) => {
      void useLibraryStore.getState().addFolders();
    });
  };

  const loadAudioFile = () => {
    void (async () => {
      const path = await window.playground?.openAudioFile?.();
      if (!path) {
        toast("No file selected", "warn");
        return;
      }
      const { usePlayerStore } = await import("@/state/playerStore");
      const name = path.split(/[\\/]/).pop() || "Track";
      const src = `playground-audio:///lib?p=${encodeURIComponent(path)}`;
      await usePlayerStore.getState().setQueue([{ id: path, src, name }], 0);
      await usePlayerStore.getState().play();
      toast(`Loaded "${name}"`, "success");
    })();
  };

  // Keyboard navigation: Esc skips, arrows/Enter advance.
  useEffect(() => {
    if (closed) return;
    const s = STEPS[step];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (s.outputSetup || s.libraryCta) return;
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

          {s.libraryCta && (
            <div className="mb-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  addLibraryFolders();
                  setStep(step + 1);
                }}
                className="kc-btn kc-btn--accent w-full justify-center"
              >
                Add folders
              </button>
              <button
                type="button"
                onClick={() => {
                  loadAudioFile();
                  setStep(step + 1);
                }}
                className="kc-btn kc-btn--ghost w-full justify-center"
              >
                Load a file
              </button>
              <p className="text-[10px] text-dim leading-relaxed">
                You can also drop files onto the window any time.
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
              {s.cta && (s.view || s.action) && !s.libraryCta && (
                <>
                  {step < STEPS.length - 1 && (
                    <button
                      onClick={() => setStep(step + 1)}
                      className="kc-btn kc-btn--sm kc-btn--ghost"
                    >
                      Next
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (s.view) setView(s.view);
                      s.action?.();
                      if (step === STEPS.length - 1) close();
                      else setStep(step + 1);
                    }}
                    className="kc-btn kc-btn--sm kc-btn--accent"
                  >
                    {s.cta}
                  </button>
                </>
              )}
              {s.libraryCta && (
                <button
                  onClick={() => {
                    setView("library");
                    setStep(step + 1);
                  }}
                  className="kc-btn kc-btn--sm kc-btn--ghost"
                >
                  Next
                </button>
              )}
              {step < STEPS.length - 1 && !s.cta && !s.outputSetup && !s.libraryCta && (
                <button
                  onClick={() => setStep(step + 1)}
                  className="kc-btn kc-btn--sm kc-btn--accent"
                >
                  Next
                </button>
              )}
              {step === STEPS.length - 1 && !s.cta && (
                <button
                  onClick={close}
                  className="kc-btn kc-btn--sm kc-btn--primary"
                >
                  Start playing
                </button>
              )}
              {step === STEPS.length - 1 && s.cta && (
                <button
                  onClick={close}
                  className="kc-btn kc-btn--sm kc-btn--primary"
                >
                  Start playing
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
