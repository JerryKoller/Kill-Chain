import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useAudioStore } from "@/state/audioStore";
import { useCalibrationStore } from "@/state/calibrationStore";
import { useUIStore } from "@/state/uiStore";
import { SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import { FRIENDLY_TO_EQ, type FriendlyKey } from "@/audio/AudioEngine";
import { getPureToneCalibrator, type ToneSpec } from "@/audio/PureToneCalibrator";
import { requestPreviewCommit } from "@/lib/previewCommitBus";

interface BandDef {
  key: FriendlyKey;
  freq: number;
  maxDb: number;
}

const BANDS: BandDef[] = (Object.keys(FRIENDLY_TO_EQ) as FriendlyKey[]).map((k) => ({
  key: k,
  freq: FRIENDLY_TO_EQ[k].freq,
  maxDb: FRIENDLY_TO_EQ[k].maxDb,
}));

type ToneMode = "single" | "unison";

function metaFor(k: keyof SoundParams) {
  return SOUND_PARAM_META.find((m) => m.key === k)!;
}

function fmtFreq(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
  return `${hz} Hz`;
}

const SWEEP_MS = 2600;

export function PureTonePanel() {
  const params = useAudioStore((s) => s.params);
  const setParamRaw = useAudioStore((s) => s.setParam);
  const toast = useUIStore((s) => s.toast);

  // Mirror every band edit into the calibration profile as well as the live
  // engine. The Calibration view re-pushes its profile whenever an A/B preview
  // ends — without this, pure-tone edits would be wiped back the moment the
  // user auditioned a variant. Commit the preview session so leaving the tab
  // does not restore the pre-Calibration knobs over these writes.
  const setParam = (key: FriendlyKey, value: number) => {
    requestPreviewCommit();
    setParamRaw(key, value);
    useCalibrationStore.getState().setProfileAxis(key, value);
  };

  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<ToneMode>("single");
  const [activeBand, setActiveBand] = useState<FriendlyKey | null>(null);
  const [sweep, setSweep] = useState(false);
  const [enabled, setEnabled] = useState<Record<FriendlyKey, boolean>>(
    () => Object.fromEntries(BANDS.map((b) => [b.key, true])) as Record<FriendlyKey, boolean>,
  );
  // Remembers each band's value while it's toggled off so re-enabling restores it.
  const stored = useRef<Partial<Record<FriendlyKey, number>>>({});

  const cal = getPureToneCalibrator();

  // Drive the calibrator from current mode / selection / params.
  useEffect(() => {
    if (!active) return;
    const map: Record<string, ToneSpec> = {};
    if (mode === "unison") {
      for (const b of BANDS) {
        if (enabled[b.key]) map[b.key] = { freq: b.freq, gainDb: params[b.key] * b.maxDb };
      }
    } else if (activeBand && enabled[activeBand]) {
      const b = BANDS.find((x) => x.key === activeBand)!;
      map[activeBand] = { freq: b.freq, gainDb: params[activeBand] * b.maxDb };
    }
    cal.setTones(map);
  }, [active, mode, activeBand, enabled, params, cal]);

  // Auto-sweep through the enabled bands (single mode only).
  useEffect(() => {
    if (!active || !sweep || mode !== "single") return;
    const id = window.setInterval(() => {
      setActiveBand((cur) => {
        const list = BANDS.filter((b) => enabled[b.key]).map((b) => b.key);
        if (list.length === 0) return cur;
        const idx = cur ? list.indexOf(cur) : -1;
        return list[(idx + 1) % list.length];
      });
    }, SWEEP_MS);
    return () => window.clearInterval(id);
  }, [active, sweep, mode, enabled]);

  // Silence when collapsed / inactive / unmounted.
  useEffect(() => {
    if (open && active) return;
    cal.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);
  useEffect(() => () => cal.stop(), [cal]);

  const startCalibration = (firstKey?: FriendlyKey) => {
    void cal.engage();
    const key = firstKey ?? activeBand ?? BANDS.find((b) => enabled[b.key])?.key ?? BANDS[0].key;
    setActive(true);
    setActiveBand(key);
  };

  const toggleActive = () => {
    if (active) {
      setActive(false);
      setSweep(false);
      cal.stop();
      toast("Tones off");
    } else {
      startCalibration();
      toast(mode === "unison" ? "Unison tones on" : "Pure tone on");
    }
  };

  const switchMode = (m: ToneMode) => {
    setMode(m);
    if (m === "unison") setSweep(false);
  };

  const listen = (key: FriendlyKey) => {
    if (!enabled[key]) return;
    setActiveBand(key);
    if (!active) startCalibration(key);
  };

  const toggleEnabled = (key: FriendlyKey) => {
    if (enabled[key]) {
      stored.current[key] = params[key];
      setParam(key, 0);
      setEnabled((p) => ({ ...p, [key]: false }));
      if (activeBand === key) {
        const nextKey = BANDS.find((b) => b.key !== key && enabled[b.key])?.key ?? null;
        setActiveBand(nextKey);
        if (!nextKey && active && mode === "single") {
          setActive(false);
          cal.stop();
        }
      }
    } else {
      setParam(key, stored.current[key] ?? 0);
      setEnabled((p) => ({ ...p, [key]: true }));
    }
  };

  const onGain = (band: BandDef, value: number) => {
    setParam(band.key, value);
  };

  const allOn = () => {
    BANDS.forEach((b) => {
      if (!enabled[b.key]) setParam(b.key, stored.current[b.key] ?? 0);
    });
    setEnabled(Object.fromEntries(BANDS.map((b) => [b.key, true])) as Record<FriendlyKey, boolean>);
  };

  const allOff = () => {
    BANDS.forEach((b) => {
      if (enabled[b.key]) {
        stored.current[b.key] = params[b.key];
        setParam(b.key, 0);
      }
    });
    setEnabled(Object.fromEntries(BANDS.map((b) => [b.key, false])) as Record<FriendlyKey, boolean>);
    setActiveBand(null);
    if (active) { setActive(false); cal.stop(); }
  };

  return (
    <GlassPanel className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02] transition"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg text-cyan">◎</span>
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              Pure Tone Calibration
              {active && (
                <span className="text-[9px] uppercase tracking-widest text-cyan border border-cyan/40 bg-cyan/10 rounded-full px-2 py-0.5">
                  ● {mode === "unison" ? "unison" : "tone on"}
                </span>
              )}
            </div>
            <div className="text-[11px] text-dim">
              Hear bands solo — or all at once — to find exactly what to lift or cut
            </div>
          </div>
        </div>
        <span className={`text-dim transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <button
                  type="button"
                  onClick={toggleActive}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_20px_rgba(34,232,255,0.3)]"
                      : "border-white/15 bg-white/[0.03] text-white/80 hover:border-white/30"
                  }`}
                >
                  {active ? "■ Stop tones" : "▶ Start tones"}
                </button>

                {/* Mode segmented control */}
                <div className="flex rounded-xl border border-white/12 overflow-hidden">
                  {(["single", "unison"] as ToneMode[]).map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => switchMode(m)}
                      className={`px-3 py-2 text-xs font-semibold capitalize transition ${
                        mode === m ? "bg-cyan/15 text-cyan" : "text-white/60 hover:bg-white/[0.04]"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setSweep((v) => !v)}
                  disabled={!active || mode !== "single"}
                  className={`rounded-xl border px-3 py-2 text-xs uppercase tracking-widest transition ${
                    sweep && mode === "single"
                      ? "border-violet/60 bg-violet/20 text-white"
                      : "border-white/12 bg-white/[0.03] text-white/60 hover:border-white/25"
                  } ${!active || mode !== "single" ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  ↻ Auto-sweep
                </button>
                <div className="flex-1" />
                <button type="button" onClick={allOn} className="text-[11px] text-white/55 hover:text-white/85 underline-offset-2 hover:underline">
                  All on
                </button>
                <span className="text-white/20">·</span>
                <button type="button" onClick={allOff} className="text-[11px] text-white/55 hover:text-white/85 underline-offset-2 hover:underline">
                  All off
                </button>
              </div>

              <p className="text-[11px] text-dim leading-relaxed mb-3">
                Tones go straight to the output — not through Sculptor or the
                headphone/speaker profile. The sliders still write those bands
                on the live chain.
                {" "}
                {mode === "unison" ? (
                  <>
                    <span className="text-white/70">Unison</span> plays every enabled band together
                    at its current level — you can hear which bands sit louder or quieter and balance
                    them by ear. Drag a band's slider to raise or lower just that tone.
                  </>
                ) : (
                  <>
                    <span className="text-white/70">Single</span> auditions one band at a time. Click a
                    band to hear a clean tone at its exact frequency; boosting/cutting changes the
                    tone's level. Turn bands off to drop them from your sculpt entirely.
                  </>
                )}
              </p>

              {/* Band rows */}
              <div className="space-y-1.5">
                {BANDS.map((band) => {
                  const m = metaFor(band.key);
                  const on = enabled[band.key];
                  const isActive = active && (mode === "unison" ? on : activeBand === band.key);
                  const value = params[band.key];
                  const db = value * band.maxDb;
                  return (
                    <div
                      key={band.key}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                        isActive
                          ? "border-cyan/50 bg-cyan/[0.07]"
                          : on
                            ? "border-white/8 bg-white/[0.02]"
                            : "border-white/5 bg-transparent opacity-55"
                      }`}
                    >
                      {/* Enable toggle */}
                      <button
                        type="button"
                        onClick={() => toggleEnabled(band.key)}
                        title={on ? "Disable band" : "Enable band"}
                        className={`shrink-0 w-9 h-5 rounded-full border transition relative ${
                          on ? "border-cyan/50 bg-cyan/20" : "border-white/15 bg-white/5"
                        }`}
                      >
                        <span
                          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
                          style={{
                            left: on ? "calc(100% - 18px)" : "2px",
                            background: on ? "#22e8ff" : "rgba(255,255,255,0.5)",
                          }}
                        />
                      </button>

                      {/* Band name + freq */}
                      <button
                        type="button"
                        onClick={() => listen(band.key)}
                        disabled={!on}
                        className="shrink-0 w-32 text-left"
                      >
                        <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: isActive ? "#22e8ff" : undefined }}>
                          {isActive && <span className="text-[10px]">♪</span>}
                          {m.label}
                        </div>
                        <div className="text-[10px] text-dim tabular-nums">{fmtFreq(band.freq)}</div>
                      </button>

                      {/* Gain slider */}
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.02}
                        value={value}
                        disabled={!on}
                        onChange={(e) => onGain(band, parseFloat(e.target.value))}
                        className="flex-1 disabled:opacity-40"
                        style={{ accentColor: m.color }}
                      />

                      {/* dB read-out */}
                      <div
                        className="shrink-0 w-16 text-right text-xs font-mono tabular-nums"
                        style={{ color: Math.abs(db) < 0.05 ? "rgba(255,255,255,0.4)" : m.color }}
                      >
                        {db > 0.05 ? "+" : ""}{db.toFixed(1)} dB
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}
