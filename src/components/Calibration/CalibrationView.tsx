import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { NeonButton } from "@/components/shared/NeonButton";
import { ActionBar } from "@/components/shared/ActionBar";
import { useCalibrationStore } from "@/state/calibrationStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { usePlayerStore } from "@/state/playerStore";
import { SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import { SignatureSliders } from "./SignatureSliders";
import { CalibrationToolbar } from "./CalibrationToolbar";
import { PureTonePanel } from "./PureTonePanel";
import { DeadflatPanel } from "./DeadflatPanel";
import { HearingTestModal } from "./HearingTestModal";

export function CalibrationView() {
  const start = useCalibrationStore((s) => s.start);
  const reset = useCalibrationStore((s) => s.reset);
  const answer = useCalibrationStore((s) => s.answer);
  const back = useCalibrationStore((s) => s.back);
  const skip = useCalibrationStore((s) => s.skip);
  const setProfileAxis = useCalibrationStore((s) => s.setProfileAxis);
  const current = useCalibrationStore((s) => s.current);
  const state = useCalibrationStore((s) => s.state);
  const preview = useCalibrationStore((s) => s.preview);
  const setPreview = useCalibrationStore((s) => s.setPreview);
  const done = useCalibrationStore((s) => s.done);
  const blind = useCalibrationStore((s) => s.blind);
  const blindSwap = useCalibrationStore((s) => s.blindSwap);
  const mode = useCalibrationStore((s) => s.mode);

  const previewParams = useAudioStore((s) => s.previewParams);
  const replaceParams = useAudioStore((s) => s.replaceParams);
  const params = useAudioStore((s) => s.params);
  const ensureReady = useAudioStore((s) => s.ensureReady);
  const playerStatus = usePlayerStore((s) => s.status);
  const playerSrc = usePlayerStore((s) => s.src);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const toast = useUIStore((s) => s.toast);

  const [hearingOpen, setHearingOpen] = useState(false);

  useEffect(() => {
    if (!current && !done) start(mode);
  }, [current, done, start, mode]);

  // When the user leaves the Calibration tab, drop any transient A/B preview
  // back to the in-progress profile so the next tab doesn't sound subtly off.
  // If they weren't mid-preview we leave the live engine alone — that way
  // direct edits made here (sliders, Pure Tone Calibration) carry over instead
  // of being clobbered.
  useEffect(() => {
    return () => {
      const cs = useCalibrationStore.getState();
      if (cs.preview !== "none") {
        previewParams(cs.state.profile);
      }
      cs.setPreview("none");
    };
  }, [previewParams]);

  // Determine whether THIS step is blind-swapped; if so, "A" the user sees
  // is actually internal B. We invert the preview lookup so what the user
  // hears matches the label they're tapping.
  const stepSwap = blind ? (blindSwap[state.history.length] ?? false) : false;
  const variantForLabel = (label: "A" | "B"): "A" | "B" =>
    stepSwap ? (label === "A" ? "B" : "A") : label;

  // Push the previewed variant — or the running profile — into the engine so
  // the user instantly hears the difference without committing to a choice.
  useEffect(() => {
    if (!current) {
      previewParams(state.profile);
      return;
    }
    if (preview === "A") {
      const v = variantForLabel("A");
      previewParams(v === "A" ? current.variantA : current.variantB);
    } else if (preview === "B") {
      const v = variantForLabel("B");
      previewParams(v === "A" ? current.variantA : current.variantB);
    } else {
      previewParams(state.profile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, current, state.profile, previewParams, blind, stepSwap]);

  const progress = current ? state.step / state.totalSteps : done ? 1 : 0;

  const onChoose = (choice: "A" | "B") => {
    answer(choice);
    setPreview("none");
    toast(`Pinned ${choice}`);
  };

  const onTogglePreview = (which: "A" | "B") => {
    setPreview(preview === which ? "none" : which);
  };

  const handlePlayToggle = async () => {
    await ensureReady();
    if (playerStatus === "playing") pause();
    else await play();
  };

  // Direct-slider edits should update BOTH the engine (audible immediately)
  // AND the running calibration profile (so the radar / next question is
  // built on top of the new value).
  const onSliderChange = <K extends keyof SoundParams>(
    key: K,
    value: SoundParams[K],
  ) => {
    setProfileAxis(key, value);
    previewParams({ [key]: value } as Partial<SoundParams>);
  };

  const confidence = state.confidence as Partial<Record<keyof SoundParams, number>>;

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Calibration"
        code="KC-04"
        subtitle="Zero in your hearing — A/B your way to a personal tuning, or drive the sliders direct"
      />
      <CalibrationToolbar />
      <div className="grid grid-cols-12 gap-3">
      {/* Left column: the guided A/B up top, then the calibration tools
          (Hearing Test + Pure Tone) filling the space below it. */}
      <div className="col-span-12 lg:col-span-8 flex flex-col gap-3">
      <GlassPanel intense className="p-4 flex flex-col">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
              Sound Signature
            </div>
            <div className="text-lg font-semibold neon-text">
              Guided Calibration
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-widest text-dim">
            {done ? "complete" : `step ${state.step + 1} of ${state.totalSteps}`}
          </div>
        </div>

        <ProgressArc progress={progress} />

        <AnimatePresence mode="wait">
          {!done && current && (
            <motion.div
              key={`q-${state.step}-${current.axis}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="mt-3 flex-1 flex flex-col"
            >
              <div className="text-center">
                <div className="text-[10px] tracking-[0.35em] uppercase text-dim">
                  Question {state.step + 1} {blind ? "(blind A/B)" : `\u00b7 ${current.axis}`}
                </div>
                <h2 className="text-xl font-semibold mt-1">
                  {blind ? "Which sounds better to you?" : current.prompt}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <Variant
                  letter="A"
                  hint={blind ? "Sample A" : (variantForLabel("A") === "A" ? current.hintA : current.hintB)}
                  active={preview === "A"}
                  onTogglePreview={() => onTogglePreview("A")}
                  onPick={() => onChoose("A")}
                />
                <Variant
                  letter="B"
                  hint={blind ? "Sample B" : (variantForLabel("B") === "A" ? current.hintA : current.hintB)}
                  active={preview === "B"}
                  onTogglePreview={() => onTogglePreview("B")}
                  onPick={() => onChoose("B")}
                />
              </div>

              <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <NeonButton
                    variant="ghost"
                    onClick={() => { back(); toast("Stepped back"); }}
                    disabled={state.history.length === 0}
                  >
                    ← Back
                  </NeonButton>
                  <NeonButton
                    variant="ghost"
                    onClick={() => { skip(); toast("Skipped"); }}
                  >
                    Skip →
                  </NeonButton>
                  <NeonButton
                    variant="ghost"
                    onClick={() => { reset(); start(mode); toast("Restarted"); }}
                  >
                    ↺ Restart
                  </NeonButton>
                </div>
                <div className="flex items-center gap-2">
                  <NeonButton variant="ghost" onClick={handlePlayToggle}>
                    {playerStatus === "playing" ? "❚❚ Pause" : "▶ Play sample"}
                  </NeonButton>
                  <div className="text-[10px] uppercase tracking-widest text-dim">
                    probe · {Math.round(current.magnitude * 100)}%
                  </div>
                </div>
              </div>

              {!playerSrc && (
                <p className="text-[11px] text-amber-300/70 mt-3 text-center">
                  Tip: load a track from the transport bar first so the
                  calibration can actually use your ears.
                </p>
              )}
            </motion.div>
          )}

          {done && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 flex-1 flex flex-col items-center justify-center text-center"
            >
              <div className="text-[11px] tracking-[0.35em] uppercase text-dim">
                Signature Generated
              </div>
              <h2 className="text-4xl font-semibold neon-text mt-2">
                Your personal tuning
              </h2>
              <p className="text-sm text-dim mt-3 max-w-md">
                Based on your choices we shaped a custom profile. Apply it now,
                tweak it on the right, or run the calibration again.
              </p>
              <div className="flex gap-3 mt-8 flex-wrap justify-center">
                <NeonButton
                  onClick={() => {
                    replaceParams(state.profile);
                    toast("Applied your signature");
                  }}
                >
                  Apply Signature
                </NeonButton>
                <NeonButton variant="ghost" onClick={() => { reset(); start(mode); }}>
                  Run again
                </NeonButton>
                <NeonButton variant="ghost" onClick={() => back()}>
                  ← Tweak last answer
                </NeonButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassPanel>

      {/* Calibration tools — pulled out of the toolbar so they aren't hidden.
          They live in the open space directly under the sound-signature A/B. */}
      <HearingTestCard onOpen={() => setHearingOpen(true)} />
      <DeadflatPanel />
      <PureTonePanel />
      </div>{/* end left column */}

      {/* Right panel: radar + direct sliders */}
      <GlassPanel intense className="col-span-12 lg:col-span-4 p-5 flex flex-col">
        <div className="text-xs uppercase tracking-[0.3em] text-dim">
          Live signature
        </div>
        <div className="text-lg font-semibold mt-1">Profile in progress</div>

        <SignatureRadar profile={state.profile} live={params} />

        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-dim">
          <Legend swatch="rgba(255,43,214,0.9)" label="Profile + (boost)" />
          <Legend swatch="rgba(255,182,72,0.85)" label="Profile - (cut)" dashed />
          <Legend swatch="rgba(34,232,255,0.7)" label="Live + (boost)" />
          <Legend swatch="rgba(120,255,240,0.8)" label="Live - (cut)" dashed />
        </div>
        <p className="text-[11px] text-dim mt-3 leading-relaxed">
          Drag any slider below to tweak the profile directly - the engine
          reacts instantly. Negative values bloom in the warmer / lighter
          colours so a +50 sub-bass looks different from a -50.
        </p>

        <div className="mt-4 pt-4 border-t border-white/8">
          <div className="text-xs uppercase tracking-[0.3em] text-dim mb-3">
            Direct edit
          </div>
          <SignatureSliders
            values={state.profile}
            onChange={onSliderChange}
            confidence={confidence}
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <NeonButton
            onClick={() => {
              replaceParams(state.profile);
              toast("Applied current profile");
            }}
            className="flex-1 justify-center"
          >
            Apply profile
          </NeonButton>
          <NeonButton
            variant="ghost"
            onClick={() => { reset(); start(mode); }}
          >
            {"\u21BA"} Reset
          </NeonButton>
        </div>
      </GlassPanel>
      </div>

      <HearingTestModal open={hearingOpen} onClose={() => setHearingOpen(false)} />
    </div>
  );
}

function HearingTestCard({ onOpen }: { onOpen: () => void }) {
  const lastTest = useCalibrationStore((s) => s.hearingTest);
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-2xl border border-cyan/30 bg-cyan/[0.04] hover:border-cyan/60 hover:bg-cyan/[0.08] px-4 py-3.5 text-left transition flex items-center gap-3"
    >
      <span className="text-2xl text-cyan leading-none shrink-0">◐</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold flex items-center gap-2">
          Hearing Test
          <span className="text-[9px] uppercase tracking-widest text-dim border border-white/12 rounded-full px-2 py-0.5">
            ~2 min · both ears
          </span>
          {lastTest && (
            <span className="text-[9px] uppercase tracking-widest text-cyan/70 border border-cyan/25 rounded-full px-2 py-0.5">
              last: {new Date(lastTest.testedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="text-[11px] text-dim mt-0.5">
          Find the quietest tone you can hear in each ear across 10 frequencies,
          then fold a gentle compensating EQ into your tuning.
        </div>
      </div>
      <span className="text-cyan/80 text-sm font-semibold shrink-0">Start →</span>
    </button>
  );
}

function ProgressArc({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className="mt-4 h-2 rounded-full bg-white/[0.05] overflow-hidden">
      <motion.div
        className="h-full"
        animate={{ width: `${pct * 100}%` }}
        transition={{ type: "spring", stiffness: 220, damping: 32 }}
        style={{
          background: "linear-gradient(90deg, #22e8ff, #7a3bff 55%, #ff2bd6)",
          boxShadow: "0 0 18px rgba(122,59,255,0.55)",
        }}
      />
    </div>
  );
}

function Variant({
  letter,
  hint,
  active,
  onTogglePreview,
  onPick,
}: {
  letter: "A" | "B";
  hint: string;
  active: boolean;
  onTogglePreview: () => void;
  onPick: () => void;
}) {
  const color = letter === "A" ? "var(--c-cyan)" : "var(--c-plasma)";
  return (
    <div
      className="rounded-xl border overflow-hidden transition"
      style={{
        borderColor: active ? `rgb(${color})` : "rgba(255,255,255,0.08)",
        boxShadow: active ? `inset 0 0 0 1px rgb(${color} / 0.5)` : "none",
        background: active ? `rgb(${color} / 0.06)` : "rgba(255,255,255,0.02)",
      }}
    >
      <button
        onClick={onTogglePreview}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <div
          className="text-3xl font-black leading-none w-8 text-center shrink-0"
          style={{ color: `rgb(${color})` }}
        >
          {letter}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white/85 font-medium truncate">{hint}</div>
          <div className="text-[10px] text-dim">
            {active ? "● previewing — tap to stop" : "tap to preview"}
          </div>
        </div>
      </button>
      <button
        onClick={onPick}
        className="w-full py-1.5 text-xs font-semibold border-t transition"
        style={{
          color: `rgb(${color})`,
          borderColor: "rgba(255,255,255,0.06)",
          background: active ? `rgb(${color} / 0.12)` : "transparent",
        }}
      >
        Pick {letter}
      </button>
    </div>
  );
}

function SignatureRadar({
  profile,
  live,
}: {
  profile: SoundParams;
  live: SoundParams;
}) {
  // Show only the headline signature axes. The full param set (27 axes) made
  // the radar labels overlap into an unreadable cluster — these 14 capture the
  // tonal balance plus the most-felt character moves, with room to breathe.
  const axes = useMemo(() => {
    const keys: (keyof SoundParams)[] = [
      "subBass", "bass", "warmth", "body", "mid",
      "vocals", "presence", "clarity", "air", "sparkle",
      "punch", "width", "reverbAmount", "harmonics",
    ];
    return keys.map((k) => SOUND_PARAM_META.find((m) => m.key === k)!);
  }, []);
  const n = axes.length;
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 28;
  const angleFor = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  // Build a polygon path where each vertex's radius = clamp(sign * v, 0, 1) * R.
  // We use TWO paths per signal: positive lobe (outward), negative lobe (also
  // outward but rendered in a contrasting colour with a dashed stroke) so a
  // user can instantly read which knobs are pushed up vs. cut.
  const buildPath = (vals: number[], sign: 1 | -1) =>
    vals
      .map((v, i) => {
        const signed = sign === 1 ? Math.max(0, v) : Math.max(0, -v);
        const norm = Math.min(1, signed);
        const a = angleFor(i);
        const x = cx + norm * R * Math.cos(a);
        const y = cy + norm * R * Math.sin(a);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  const liveVals = axes.map((a) => live[a.key]);
  const profileVals = axes.map((a) => profile[a.key]);

  return (
    <div className="mt-4 flex items-center justify-center">
      <svg width={size} height={size} className="overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((s) => (
          <circle
            key={s}
            cx={cx}
            cy={cy}
            r={R * s}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
          />
        ))}
        {axes.map((a, i) => {
          const angle = angleFor(i);
          const x = cx + R * Math.cos(angle);
          const y = cy + R * Math.sin(angle);
          const lx = cx + (R + 15) * Math.cos(angle);
          const ly = cy + (R + 15) * Math.sin(angle);
          // Anchor each label away from the chart based on its side so adjacent
          // words don't collide near the top / bottom of the ring.
          const cos = Math.cos(angle);
          const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
          return (
            <g key={a.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.05)" />
              <text
                x={lx}
                y={ly}
                fontSize={8.5}
                fill="rgba(255,255,255,0.5)"
                textAnchor={anchor}
                dominantBaseline="middle"
              >
                {a.label}
              </text>
            </g>
          );
        })}

        {/* Live (audible) — negative lobe in cool cyan dashed, positive in solid cyan */}
        <path
          d={buildPath(liveVals, -1)}
          fill="rgba(34,232,255,0.06)"
          stroke="rgba(120,255,240,0.7)"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
        <path
          d={buildPath(liveVals, 1)}
          fill="rgba(34,232,255,0.10)"
          stroke="rgba(34,232,255,0.7)"
          strokeWidth={1.5}
        />

        {/* Profile (target) — negative lobe in warm gold dashed, positive in plasma */}
        <path
          d={buildPath(profileVals, -1)}
          fill="rgba(255,182,72,0.08)"
          stroke="rgba(255,182,72,0.85)"
          strokeWidth={1.2}
          strokeDasharray="5 3"
        />
        <path
          d={buildPath(profileVals, 1)}
          fill="rgba(255,43,214,0.12)"
          stroke="rgba(255,43,214,0.9)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}

function Legend({ swatch, label, dashed }: { swatch: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-[2px] w-4 rounded-full"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${swatch} 0 4px, transparent 4px 7px)`
            : swatch,
          boxShadow: `0 0 6px ${swatch}`,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

