import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useEffect, useState } from "react";
import { TitleBar } from "@/components/Layout/TitleBar";
import { Sidebar } from "@/components/Layout/Sidebar";
import { TransportBar } from "@/components/Layout/TransportBar";
// The default view loads eagerly; every other tool is code-split so startup
// only parses what's actually on screen (the synth alone is a big chunk).
import { PlaygroundView } from "@/components/Playground/PlaygroundView";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

const LibraryView = lazy(() => import("@/components/Library/LibraryView").then((m) => ({ default: m.LibraryView })));
const MorphLabView = lazy(() => import("@/components/MorphLab/MorphLabView").then((m) => ({ default: m.MorphLabView })));
const CalibrationView = lazy(() => import("@/components/Calibration/CalibrationView").then((m) => ({ default: m.CalibrationView })));
const GoldenEarsView = lazy(() => import("@/components/Trainer/GoldenEarsView").then((m) => ({ default: m.GoldenEarsView })));
const MacroReactorView = lazy(() => import("@/components/Reactor/MacroReactorView").then((m) => ({ default: m.MacroReactorView })));
const ScopeView = lazy(() => import("@/components/Scope/ScopeView").then((m) => ({ default: m.ScopeView })));
const TractorBeamView = lazy(() => import("@/components/Tractor/TractorBeamView").then((m) => ({ default: m.TractorBeamView })));
const DimensionView = lazy(() => import("@/components/Dimension/DimensionView").then((m) => ({ default: m.DimensionView })));
const FireCommandView = lazy(() => import("@/components/FireCommand/FireCommandView").then((m) => ({ default: m.FireCommandView })));
const KillChainView = lazy(() => import("@/components/Chain/KillChainView").then((m) => ({ default: m.KillChainView })));
const EnhancedPresetsView = lazy(() => import("@/components/Presets/EnhancedPresetsView").then((m) => ({ default: m.EnhancedPresetsView })));
const GlossaryView = lazy(() => import("@/components/Glossary/GlossaryView").then((m) => ({ default: m.GlossaryView })));
const SettingsView = lazy(() => import("@/components/Settings/SettingsView").then((m) => ({ default: m.SettingsView })));
// Airspace mounts OUTSIDE the animated view switcher (see below) so the
// embedded browser — and its audio — keeps running while other tools are open.
const AirspaceView = lazy(() => import("@/components/Airspace/AirspaceView").then((m) => ({ default: m.AirspaceView })));
import { MiniPlayer } from "@/components/Layout/MiniPlayer";
import { OnboardingTour } from "@/components/Onboarding/OnboardingTour";
import { HotkeyOverlay } from "@/components/shared/HotkeyOverlay";
import { useUIStore } from "@/state/uiStore";
import { useAudioStore } from "@/state/audioStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useEqStore } from "@/state/eqStore";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useCompanionMode } from "@/hooks/useCompanionMode";
import { useRemoteServer } from "@/hooks/useRemoteServer";
import { useAutoFlatten } from "@/hooks/useAutoFlatten";
import { useLufsNormalize } from "@/hooks/useLufsNormalize";
import { useMidi } from "@/hooks/useMidi";
import { useReactiveAmbience } from "@/hooks/useReactiveAmbience";
import { useUiSounds } from "@/hooks/useUiSounds";

export default function App() {
  const view = useUIStore((s) => s.view);
  // Airspace lazy-mounts on first visit, then STAYS mounted (hidden) so the
  // browser page and its audio survive view switches. It renders nothing and
  // costs nothing until the user first opens the view.
  const [airspaceMounted, setAirspaceMounted] = useState(false);
  useEffect(() => {
    if (view === "airspace") setAirspaceMounted(true);
  }, [view]);
  const toast = useUIStore((s) => s.toastMessage);
  const ensureReady = useAudioStore((s) => s.ensureReady);
  const theme = useSettingsStore((s) => s.theme);
  const accent = useSettingsStore((s) => s.accent);
  const uiGlow = useSettingsStore((s) => s.uiGlow);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const miniMode = useSettingsStore((s) => s.miniMode);
  const onboardingDone = useSettingsStore((s) => s.onboardingDone);
  const bgFx = useSettingsStore((s) => s.bgFx);
  const forceReduced = useSettingsStore((s) => s.forceReducedMotion);

  // Reduce-motion override: a root class that CSS (and the visualizer) obey
  // even when the OS setting is off.
  useEffect(() => {
    document.documentElement.classList.toggle("kc-reduced", forceReduced);
  }, [forceReduced]);

  useGlobalHotkeys();
  useFileDrop();
  useCompanionMode();
  useRemoteServer();
  useAutoFlatten();
  useLufsNormalize();
  useMidi();
  useReactiveAmbience();
  useUiSounds();

  // Hands-free Tractor Beam: re-locks on track/video changes when armed.
  useEffect(() => {
    void import("@/lib/tractorAutoLock").then((m) => m.initTractorAutoLock());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Apply accent override + global glow multiplier as CSS custom properties.
  useEffect(() => {
    const root = document.documentElement;
    const ACCENTS: Record<string, string> = {
      steel: "84 180 214",
      blood: "255 64 64",
      amber: "255 176 72",
      ice: "120 200 255",
      lime: "95 211 138",
      violet: "122 92 255",
      mono: "226 228 235",
    };
    if (accent !== "theme" && ACCENTS[accent]) {
      root.style.setProperty("--c-cyan", ACCENTS[accent]);
    } else {
      root.style.removeProperty("--c-cyan");
    }
  }, [accent, theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--glow", String(uiGlow));
  }, [uiGlow]);

  useEffect(() => {
    const onFirstGesture = () => {
      ensureReady()
        .then(() => {
          // Push any persisted user EQ bands into the freshly-resumed engine.
          useEqStore.getState().syncEngine();
        })
        .catch(() => {
          /* will re-attempt on next gesture */
        });
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture);
    window.addEventListener("keydown", onFirstGesture);
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [ensureReady]);

  if (miniMode) {
    return <MiniPlayer />;
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-ink relative">
      {/* Animated background field (Settings → Ambient backdrop) */}
      {bgFx && (
        <>
          <div className="absolute inset-0 -z-10 grid-bg" />
          <div className="absolute inset-0 -z-10 bg-gridFade" />
          {/* Static decorative orbs. They breathe with the music via the
              --beat-glow / --beat-pulse CSS vars (compositor-only
              opacity/scale), so we don't run perpetual JS position animations
              on these large blurred layers — that was a constant repaint
              cost. */}
          <div
            className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full -z-10 beat-orb-violet"
            style={{
              background:
                "radial-gradient(closest-side, rgb(var(--c-violet) / 0.35), transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div
            className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full -z-10 beat-orb-cyan"
            style={{
              background:
                "radial-gradient(closest-side, rgb(var(--c-cyan) / 0.25), transparent 70%)",
              filter: "blur(50px)",
            }}
          />
        </>
      )}

      <TitleBar />

      {/* Density: zoom the ENTIRE workspace (sidebar + views + transport) so
          "Compact" genuinely compacts the app instead of just shrinking the
          middle pane while the chrome stays huge — that mismatch was the old
          "density doesn't work" bug. */}
      <div className="flex flex-1 overflow-hidden" style={{ zoom: uiScale }}>
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto px-4 pb-2 noise relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                // Opacity + translate only: animating filter:blur forced a
                // full-view repaint per frame, and 350 ms felt sluggish when
                // hopping between tools.
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
                className="min-h-full"
              >
                {/* Each view gets its own ErrorBoundary so a crash in one
                    never blanks out the whole app — that was the source of
                    the "tabs sometimes fail to load" problem. */}
                <ErrorBoundary viewName={view}>
                  <Suspense
                    fallback={
                      <div className="h-64 grid place-items-center text-xs uppercase tracking-[0.3em] text-dim">
                        Loading…
                      </div>
                    }
                  >
                    {view === "playground" && <PlaygroundView />}
                    {view === "library" && <LibraryView />}
                    {view === "morphlab" && <MorphLabView />}
                    {view === "calibration" && <CalibrationView />}
                    {view === "trainer" && <GoldenEarsView />}
                    {view === "reactor" && <MacroReactorView />}
                    {view === "scope"   && <ScopeView />}
                    {view === "tractor" && <TractorBeamView />}
                    {view === "dimension" && <DimensionView />}
                    {view === "fire" && <FireCommandView />}
                    {view === "chain" && <KillChainView />}
                    {view === "presets" && <EnhancedPresetsView />}
                    {view === "glossary" && <GlossaryView />}
                    {view === "settings" && <SettingsView />}
                  </Suspense>
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
            {airspaceMounted && (
              <Suspense fallback={null}>
                <AirspaceView visible={view === "airspace"} />
              </Suspense>
            )}
          </div>
          <TransportBar />
        </main>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 glass-strong px-4 py-2 rounded-xl text-sm z-[60]"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <HotkeyOverlay />
      {!onboardingDone && <OnboardingTour />}
    </div>
  );
}
