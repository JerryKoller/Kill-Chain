import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { NeonButton } from "@/components/shared/NeonButton";
import { ActionBar } from "@/components/shared/ActionBar";
import { PRESETS, type Preset } from "@/audio/presets";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { usePreviewSession } from "@/hooks/usePreviewSession";
import { isBipolar, SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import { MorphPad } from "@/components/Playground/MorphPad";
import { luckyDip } from "@/lib/randomSculpt";
import { useEqStore } from "@/state/eqStore";
import {
  useUserPresetsStore,
  type UserPreset,
} from "@/state/userPresetsStore";
import {
  CORNERS,
  GESTURE_MAX_POINTS,
  GESTURE_SAMPLE_MS,
  MOTION_RATE_MAX,
  MOTION_RATE_MIN,
  DEFAULT_CORNERS,
  DEFAULT_MOTION,
  bilinearWeights,
  buildGesture,
  clamp01,
  gestureSpeed,
  loadMorphConfig,
  morphAt,
  motionPoint,
  resolveCornerParams,
  sampleGesture,
  saveMorphConfig,
  unlockKeys,
  type Corner,
  type CornerSource,
  type GestureData,
  type MotionConfig,
  type MotionPattern,
} from "./morphEngine";

type AnyPreset = Preset | UserPreset;

const CORNER_TITLES: Record<Corner, string> = {
  a: "A · TOP-LEFT",
  b: "B · TOP-RIGHT",
  c: "C · BTM-LEFT",
  d: "D · BTM-RIGHT",
};

const SNAPSHOT_ACCENT = "#8be9ff";

const PUSH_INTERVAL_MS = 33; // ~30 Hz param writes
const PUSH_ALPHA = 0.45; // light smoothing so morphs never zipper
const UI_MIRROR_MS = 90; // ~11 Hz React mirror for readouts/aria

export function MorphLabView() {
  const previewParams = useAudioStore((s) => s.previewParams);
  const replaceParams = useAudioStore((s) => s.replaceParams);
  const toast = useUIStore((s) => s.toast);
  const userPresets = useUserPresetsStore((s) => s.presets);
  const savePreset = useUserPresetsStore((s) => s.savePreset);
  const preview = usePreviewSession();

  // Persisted lab configuration (new storage key; loaded once per mount).
  const cfgRef = useRef<ReturnType<typeof loadMorphConfig> | null>(null);
  if (cfgRef.current === null) cfgRef.current = loadMorphConfig();
  const initialCfg = cfgRef.current;

  const [corners, setCorners] = useState<Record<Corner, CornerSource>>(() => {
    // Heal corners that point at presets deleted since the last session.
    const known = new Set<string>([
      ...PRESETS.map((p) => p.id),
      ...useUserPresetsStore.getState().presets.map((p) => p.id),
    ]);
    const healed = { ...initialCfg.corners };
    for (const c of CORNERS) {
      const src = healed[c];
      if (src.kind === "preset" && !known.has(src.id)) {
        healed[c] = { ...DEFAULT_CORNERS[c] };
      }
    }
    return healed;
  });
  const [locks, setLocks] = useState<string[]>(() => initialCfg.locks);
  const [motionCfg, setMotionCfg] = useState<MotionConfig>(
    () => initialCfg.motion,
  );
  const [gesture, setGesture] = useState<GestureData | null>(
    () => initialCfg.gesture,
  );
  const [uiXy, setUiXy] = useState(() => initialCfg.pos);
  const [dragging, setDragging] = useState(false);
  const [recArmed, setRecArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [locksOpen, setLocksOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  // ── Refs: everything the RAF loop touches lives outside React state ──
  const padRef = useRef<HTMLDivElement | null>(null);
  const puckRef = useRef<HTMLButtonElement | null>(null);
  const posRef = useRef({ ...initialCfg.pos });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const lastPushRef = useRef(0);
  const lastUiRef = useRef(0);
  const phaseRef = useRef(0);
  const gestureClockRef = useRef(0);
  const settledRef = useRef(true);
  const draggingRef = useRef(false);
  const recordingRef = useRef(false);
  const recBufRef = useRef<number[]>([]);
  const recFirstTsRef = useRef<number | null>(null);
  const recLastSampleRef = useRef<number | null>(null);
  const morphCurRef = useRef<Partial<SoundParams> | null>(null);
  const targetRef = useRef<{
    partial: Partial<SoundParams>;
    keys: (keyof SoundParams)[];
  } | null>(null);

  const presetById = useMemo(() => {
    const map = new Map<string, AnyPreset>();
    [...PRESETS, ...userPresets].forEach((p) => map.set(p.id, p));
    return map;
  }, [userPresets]);

  const cornerParams = useMemo(
    () => ({
      a: resolveCornerParams(corners.a, presetById),
      b: resolveCornerParams(corners.b, presetById),
      c: resolveCornerParams(corners.c, presetById),
      d: resolveCornerParams(corners.d, presetById),
    }),
    [corners, presetById],
  );
  const locksSet = useMemo(() => new Set(locks), [locks]);

  // Latest-value refs so the RAF loop never sees stale closures.
  const cornerParamsRef = useRef(cornerParams);
  cornerParamsRef.current = cornerParams;
  const locksSetRef = useRef(locksSet);
  locksSetRef.current = locksSet;
  const motionRef = useRef(motionCfg);
  motionRef.current = motionCfg;
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;
  const tickRef = useRef<(ts: number) => void>(() => {});
  const finishRecordingRef = useRef<(tsNow: number) => void>(() => {});

  const runLoop = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame((t) => tickRef.current(t));
  }, []);

  /** Recompute the morph target for the current puck position. */
  const retarget = useCallback(() => {
    const p = posRef.current;
    const full = morphAt(cornerParamsRef.current, p.x, p.y);
    targetRef.current = unlockKeys(full, locksSetRef.current);
    settledRef.current = false;
    runLoop();
  }, [runLoop]);

  /** Move the puck without a React render (direct DOM write) and retarget. */
  const movePuck = useCallback(
    (x: number, y: number) => {
      const cx = clamp01(x);
      const cy = clamp01(y);
      posRef.current = { x: cx, y: cy };
      const el = puckRef.current;
      if (el) {
        el.style.left = `${cx * 100}%`;
        el.style.top = `${cy * 100}%`;
      }
      retarget();
    },
    [retarget],
  );

  // ── The single RAF loop: motion, gesture record/playback, 30 Hz pushes ──
  tickRef.current = (ts: number) => {
    const mc = motionRef.current;
    const idle =
      settledRef.current &&
      !draggingRef.current &&
      !recordingRef.current &&
      mc.pattern === "off";
    if (idle) {
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame((t) => tickRef.current(t));
    if (document.hidden) {
      lastTsRef.current = ts;
      return;
    }
    const prev = lastTsRef.current;
    lastTsRef.current = ts;
    const dt = prev != null ? Math.min(0.1, (ts - prev) / 1000) : 0;

    // Gesture recording — sample puck position at a fixed cadence.
    if (recordingRef.current && draggingRef.current) {
      if (
        recLastSampleRef.current == null ||
        ts - recLastSampleRef.current >= GESTURE_SAMPLE_MS
      ) {
        if (recFirstTsRef.current == null) recFirstTsRef.current = ts;
        recLastSampleRef.current = ts;
        recBufRef.current.push(posRef.current.x, posRef.current.y);
        if (recBufRef.current.length >= GESTURE_MAX_POINTS * 2) {
          finishRecordingRef.current(ts);
        }
      }
    } else if (mc.pattern !== "off" && !draggingRef.current && dt > 0) {
      // Autopilot paths / gesture playback.
      if (mc.pattern === "gesture") {
        const g = gestureRef.current;
        if (g) {
          gestureClockRef.current += dt * 1000 * gestureSpeed(mc.rate);
          const p = sampleGesture(g, gestureClockRef.current, mc.depth);
          movePuck(p.x, p.y);
        }
      } else {
        phaseRef.current += 2 * Math.PI * mc.rate * dt;
        const p = motionPoint(mc.pattern, phaseRef.current, mc.depth);
        movePuck(p.x, p.y);
      }
    }

    // Throttled, smoothed param push (~30 Hz, light lerp = no zipper).
    if (!settledRef.current && ts - lastPushRef.current >= PUSH_INTERVAL_MS) {
      lastPushRef.current = ts;
      const tgt = targetRef.current;
      if (!tgt || tgt.keys.length === 0 || !preview.startedRef.current) {
        settledRef.current = true;
      } else {
        const live = useAudioStore.getState().params;
        let cur = morphCurRef.current;
        if (!cur) {
          cur = {};
          morphCurRef.current = cur;
        }
        const out: Partial<SoundParams> = {};
        let maxDelta = 0;
        for (const k of tgt.keys) {
          const t = tgt.partial[k] as number;
          const c = (cur[k] ?? live[k]) as number;
          const n = c + (t - c) * PUSH_ALPHA;
          cur[k] = n;
          out[k] = n;
          const d = Math.abs(t - n);
          if (d > maxDelta) maxDelta = d;
        }
        preview.touch(tgt.keys);
        previewParams(out);
        if (maxDelta < 0.002) {
          for (const k of tgt.keys) cur[k] = tgt.partial[k] as number;
          settledRef.current = true;
        }
      }
    }

    // Low-rate React mirror for weight bars, coordinates, aria values.
    if (ts - lastUiRef.current >= UI_MIRROR_MS) {
      lastUiRef.current = ts;
      const p = posRef.current;
      setUiXy((prevXy) =>
        Math.abs(prevXy.x - p.x) > 0.002 || Math.abs(prevXy.y - p.y) > 0.002
          ? { x: p.x, y: p.y }
          : prevXy,
      );
    }
  };

  finishRecordingRef.current = (tsNow: number) => {
    recordingRef.current = false;
    setRecording(false);
    setRecArmed(false);
    const first = recFirstTsRef.current;
    const dur =
      first != null
        ? Math.max(GESTURE_SAMPLE_MS, tsNow - first)
        : (recBufRef.current.length / 2) * GESTURE_SAMPLE_MS;
    const g = buildGesture(recBufRef.current, dur);
    recBufRef.current = [];
    recFirstTsRef.current = null;
    recLastSampleRef.current = null;
    if (!g) {
      toast("Gesture too short — hold REC and fly a longer pass");
      return;
    }
    setGesture(g);
    gestureClockRef.current = 0;
    setMotionCfg((p) => ({ ...p, pattern: "gesture" }));
    toast("Gesture captured — looping playback engaged");
  };

  // Retarget when corners or locks change (new blend recipe).
  useEffect(() => {
    retarget();
  }, [cornerParams, locksSet, retarget]);

  // Engaging any motion pattern counts as an interaction (starts preview).
  useEffect(() => {
    if (motionCfg.pattern === "off") return;
    if (motionCfg.pattern === "gesture" && !gestureRef.current) {
      setMotionCfg((p) => ({ ...p, pattern: "off" }));
      return;
    }
    preview.start();
    runLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionCfg.pattern, runLoop]);

  // Initial puck placement (before paint) + RAF cleanup on unmount.
  useLayoutEffect(() => {
    const el = puckRef.current;
    const p = posRef.current;
    if (el) {
      el.style.left = `${p.x * 100}%`;
      el.style.top = `${p.y * 100}%`;
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // Persist lab configuration (debounced inside saveMorphConfig). The puck
  // position is read from the ref so continuous autopilot motion doesn't
  // reset the debounce forever; drag-end flushes it explicitly.
  useEffect(() => {
    saveMorphConfig({
      corners,
      locks,
      motion: motionCfg,
      gesture,
      pos: { ...posRef.current },
    });
  }, [corners, locks, motionCfg, gesture]);

  // ── Pointer interaction (whole pad is grabbable) ──
  const dragTo = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    movePuck((clientX - r.left) / r.width, (clientY - r.top) / r.height);
  };

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = padRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    preview.start();
    draggingRef.current = true;
    setDragging(true);
    // Grabbing the puck takes manual control — autopilot disengages.
    setMotionCfg((p) => (p.pattern === "off" ? p : { ...p, pattern: "off" }));
    if (recArmed && !recordingRef.current) {
      recordingRef.current = true;
      setRecording(true);
      recBufRef.current = [];
      recFirstTsRef.current = null;
      recLastSampleRef.current = null;
    }
    dragTo(e.clientX, e.clientY);
    runLoop();
  };

  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    dragTo(e.clientX, e.clientY);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (recordingRef.current) finishRecordingRef.current(performance.now());
    // Snap the UI mirror so readouts land exactly where the puck stopped.
    setUiXy({ ...posRef.current });
    saveMorphConfig({
      corners,
      locks,
      motion: motionCfg,
      gesture,
      pos: { ...posRef.current },
    });
  };

  // ── Keyboard nudging on the puck (role="slider" keeps global keys away) ──
  const onPuckKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else if (e.key === "Home") {
      e.preventDefault();
      preview.start();
      movePuck(0.5, 0.5);
      setUiXy({ x: 0.5, y: 0.5 });
      runLoop();
      return;
    } else return;
    e.preventDefault();
    preview.start();
    movePuck(posRef.current.x + dx, posRef.current.y + dy);
    setUiXy({ ...posRef.current });
    runLoop();
  };

  // ── Actions ──
  const currentBlend = (): SoundParams => ({
    ...useAudioStore.getState().params,
    ...(targetRef.current?.partial ?? {}),
  });

  const commitBlend = () => {
    preview.commit();
    replaceParams(currentBlend());
    toast("Blend committed to the sculpt");
  };

  const doSaveBlend = () => {
    const name = saveName.trim() || `Morph ${new Date().toLocaleTimeString()}`;
    savePreset(name, currentBlend(), SNAPSHOT_ACCENT, "✛");
    setSaveOpen(false);
    setSaveName("");
    toast(`Saved "${name}" — deployable from Presets`);
  };

  const centerPuck = () => {
    preview.start();
    movePuck(0.5, 0.5);
    setUiXy({ x: 0.5, y: 0.5 });
    runLoop();
  };

  const setCornerPreset = (corner: Corner, id: string) => {
    if (id === "__snapshot") return;
    preview.start();
    setCorners((prevC) => ({ ...prevC, [corner]: { kind: "preset", id } }));
  };

  const snapCorner = (corner: Corner) => {
    const label = `SNAP ${new Date().toLocaleTimeString([], { hour12: false })}`;
    const params = { ...useAudioStore.getState().params };
    preview.start();
    setCorners((prevC) => ({
      ...prevC,
      [corner]: { kind: "snapshot", label, params },
    }));
    toast(`Corner ${corner.toUpperCase()} ← current sound frozen`);
  };

  const toggleLock = (key: keyof SoundParams) => {
    setLocks((prevL) =>
      prevL.includes(key) ? prevL.filter((k) => k !== key) : [...prevL, key],
    );
  };

  const setPattern = (pattern: MotionPattern) => {
    if (pattern === "gesture" && !gesture) {
      toast("No gesture on file — arm REC and fly a pass first");
      return;
    }
    if (pattern !== "off") {
      if (pattern === "gesture") gestureClockRef.current = 0;
      setRecArmed(false);
    }
    setMotionCfg((p) => ({ ...p, pattern: p.pattern === pattern ? "off" : pattern }));
  };

  const clearGesture = () => {
    setGesture(null);
    setMotionCfg((p) => (p.pattern === "gesture" ? { ...p, pattern: "off" } : p));
    toast("Recorded gesture purged");
  };

  const resetLab = () => {
    setCorners({ ...DEFAULT_CORNERS });
    setLocks([]);
    setMotionCfg({ ...DEFAULT_MOTION });
    setGesture(null);
    setRecArmed(false);
    movePuck(0.5, 0.5);
    setUiXy({ x: 0.5, y: 0.5 });
    setConfirmReset(false);
    toast("Morph Lab reset to factory state");
  };

  // ── Quick Sculpts (unchanged behaviour — commit straight to the sculpt) ──
  const applyMacro = (label: string, deltas: Partial<SoundParams>) => {
    const next = { ...useAudioStore.getState().params };
    (Object.entries(deltas) as [keyof SoundParams, number][]).forEach(([k, v]) => {
      const lo = isBipolar(k) ? -1 : 0;
      next[k] = Math.max(lo, Math.min(1, next[k] + v));
    });
    preview.commit();
    replaceParams(next);
    toast(`Pushed ${label}`);
  };

  const randomizeSculpt = () => {
    const dip = luckyDip();
    preview.commit();
    replaceParams(dip.params);
    useEqStore.getState().randomize();
    toast(`Randomized: ${dip.name} — ${dip.tagline}`);
  };

  // ── Derived display data ──
  const weights = bilinearWeights(uiXy.x, uiXy.y);
  const motionEngaged = motionCfg.pattern !== "off";
  const cornerMeta = CORNERS.map((c) => {
    const src = corners[c];
    const name =
      src.kind === "snapshot"
        ? src.label
        : presetById.get(src.id)?.name ?? "Unknown";
    const accent =
      src.kind === "snapshot"
        ? SNAPSHOT_ACCENT
        : presetById.get(src.id)?.accent ?? "#54b4d6";
    return { corner: c, src, name, accent, weight: weights[c] };
  });

  const rateLabel =
    motionCfg.pattern === "gesture"
      ? `${gestureSpeed(motionCfg.rate).toFixed(2)}×`
      : `${motionCfg.rate.toFixed(2)} Hz`;

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Morph Lab"
        code="KC-05"
        subtitle="Four-corner blend terrain — drag the puck, fly patrol patterns, or loop a recorded pass"
      />

      <div className="grid grid-cols-12 gap-3">
        <GlassPanel intense className="col-span-12 xl:col-span-8 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-dim">
                <span>2D Blend Surface</span>
                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full border tracking-[0.2em] ${
                    motionEngaged || dragging
                      ? "border-lime/50 text-lime bg-lime/10"
                      : "border-white/15 text-white/45"
                  }`}
                >
                  {recording ? "RECORDING" : motionEngaged || dragging ? "ENGAGED" : "STANDBY"}
                </span>
              </div>
              <div className="text-xl font-semibold">Preset Space Navigator</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <NeonButton variant="ghost" onClick={centerPuck} className="text-xs">
                Center puck
              </NeonButton>
              <NeonButton
                variant="ghost"
                onClick={() => setSaveOpen((v) => !v)}
                className="text-xs"
              >
                ⊕ Save blend as preset
              </NeonButton>
              <NeonButton onClick={commitBlend} className="text-xs">
                Commit current blend
              </NeonButton>
            </div>
          </div>

          {saveOpen && (
            <div className="mt-3 rounded-xl border border-cyan/30 bg-cyan/5 p-3 flex items-center gap-2 flex-wrap">
              <input
                type="text"
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSaveBlend();
                  if (e.key === "Escape") setSaveOpen(false);
                }}
                placeholder="Name this morph position…"
                maxLength={60}
                className="flex-1 min-w-[220px] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
              />
              <button
                onClick={doSaveBlend}
                className="kc-btn kc-btn--accent"
              >
                Save
              </button>
              <button
                onClick={() => setSaveOpen(false)}
                className="kc-btn kc-btn--ghost"
              >
                Cancel
              </button>
              <div className="text-[10px] text-dim w-full">
                Captures the sound exactly as it plays now (locked params included). Saving does not commit the preview.
              </div>
            </div>
          )}

          <div
            ref={padRef}
            onPointerDown={beginDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative mt-4 w-full aspect-[1.3/1] rounded-2xl border border-white/10 overflow-hidden bg-black/40 cursor-crosshair select-none touch-none"
          >
            {/* Corner glows */}
            <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full blur-3xl opacity-30 bg-cyan" />
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-30 bg-plasma" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full blur-3xl opacity-30 bg-violet" />
            <div className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-30 bg-lime" />

            {/* Grid */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={`v${i}`}
                  className="absolute top-0 bottom-0 border-l border-white/5"
                  style={{ left: `${(i * 100) / 6}%` }}
                />
              ))}
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={`h${i}`}
                  className="absolute left-0 right-0 border-t border-white/5"
                  style={{ top: `${(i * 100) / 4}%` }}
                />
              ))}
            </div>

            {/* Corner designations */}
            <CornerBadge corner="a" name={cornerMeta[0].name} />
            <CornerBadge corner="b" name={cornerMeta[1].name} />
            <CornerBadge corner="c" name={cornerMeta[2].name} />
            <CornerBadge corner="d" name={cornerMeta[3].name} />

            {/* Coordinate readout */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-mono text-white/40 pointer-events-none">
              X {String(Math.round(uiXy.x * 100)).padStart(3, "0")} · Y{" "}
              {String(Math.round(uiXy.y * 100)).padStart(3, "0")}
            </div>

            {/* Motion path hint */}
            {motionEngaged && !dragging && (
              <div className="absolute inset-[8%] rounded-[28px] border border-cyan/20 border-dashed pointer-events-none" />
            )}

            {/* REC indicator */}
            {(recArmed || recording) && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1 rounded-full border border-plasma/50 bg-black/60 pointer-events-none">
                <span className="mlab-rec-dot" />
                <span className="text-[9px] uppercase tracking-[0.25em] text-plasma">
                  {recording ? "Recording pass" : "REC armed — drag to record"}
                </span>
              </div>
            )}

            {/* The puck — keyboard-operable slider (X/Y) */}
            <motion.button
              ref={puckRef}
              role="slider"
              aria-label="Morph position. Arrow keys nudge, Shift for coarse, Home to center."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(uiXy.x * 100)}
              aria-valuetext={`X ${Math.round(uiXy.x * 100)}%, Y ${Math.round(uiXy.y * 100)}%`}
              onKeyDown={onPuckKeyDown}
              className="mlab-puck absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-2 border-white/80 bg-cyan/40 backdrop-blur-sm shadow-[0_0_24px_rgba(34,232,255,0.8)] cursor-grab active:cursor-grabbing"
              animate={{ scale: dragging ? 1.12 : 1 }}
              transition={{ type: "spring", stiffness: 360, damping: 24 }}
              title="Drag to morph — arrow keys nudge"
            />
          </div>

          {/* Motion module */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.25em] text-dim mr-1">
              Motion
            </span>
            {(
              [
                ["orbit", "Orbit"],
                ["figure8", "Fig-8"],
                ["drift", "Drift"],
                ["gesture", "Gesture"],
              ] as [MotionPattern, string][]
            ).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPattern(p)}
                disabled={p === "gesture" && !gesture}
                title={
                  p === "gesture" && !gesture
                    ? "Record a gesture first (REC, then drag)"
                    : undefined
                }
                className={`kc-btn kc-btn--sm kc-btn--ghost ${motionCfg.pattern === p ? "kc-on" : ""}`}
              >
                {label}
              </button>
            ))}

            <button
              onClick={() => {
                if (recording) {
                  finishRecordingRef.current(performance.now());
                  return;
                }
                setRecArmed((v) => !v);
                if (!recArmed) {
                  setMotionCfg((p) => ({ ...p, pattern: "off" }));
                }
              }}
              className={`kc-btn kc-btn--sm ${
                recArmed || recording ? "kc-btn--danger" : "kc-btn--ghost"
              }`}
              title="Arm, then drag the puck — the pass loops when you release"
            >
              {recording ? "■ Stop" : recArmed ? "● Armed" : "● Rec"}
            </button>

            {gesture && (
              <TwoTapButton
                label="Clear gesture"
                confirmLabel="CONFIRM PURGE"
                onConfirm={clearGesture}
              />
            )}
          </div>

          <div className="mt-3 flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 min-w-[220px]">
              <span className="text-[11px] uppercase tracking-widest text-dim w-10">
                Rate
              </span>
              <input
                type="range"
                min={MOTION_RATE_MIN}
                max={MOTION_RATE_MAX}
                step={0.01}
                value={motionCfg.rate}
                onChange={(e) =>
                  setMotionCfg((p) => ({ ...p, rate: Number(e.target.value) }))
                }
                className="kc-slider w-40"
                style={{
                  ["--kc-fill" as string]: `${((motionCfg.rate - MOTION_RATE_MIN) / (MOTION_RATE_MAX - MOTION_RATE_MIN)) * 100}%`,
                }}
              />
              <span className="text-[11px] font-mono text-dim w-14 text-right">
                {rateLabel}
              </span>
            </label>
            <label className="flex items-center gap-2 min-w-[220px]">
              <span className="text-[11px] uppercase tracking-widest text-dim w-10">
                Depth
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={motionCfg.depth}
                onChange={(e) =>
                  setMotionCfg((p) => ({ ...p, depth: Number(e.target.value) }))
                }
                className="kc-slider w-40"
                style={{ ["--kc-fill" as string]: `${motionCfg.depth * 100}%` }}
              />
              <span className="text-[11px] font-mono text-dim w-14 text-right">
                {Math.round(motionCfg.depth * 100)}%
              </span>
            </label>
          </div>
        </GlassPanel>

        <GlassPanel intense className="col-span-12 xl:col-span-4 p-5 flex flex-col gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-dim">
              Corner Assignment
            </div>
            <div className="text-xl font-semibold">Four voices, one terrain</div>
          </div>

          {CORNERS.map((c) => {
            const src = corners[c];
            return (
              <div key={c} className="flex items-center gap-2">
                <div className="w-[88px] shrink-0 text-[10px] uppercase tracking-wider text-dim font-mono">
                  {CORNER_TITLES[c]}
                </div>
                <select
                  value={src.kind === "snapshot" ? "__snapshot" : src.id}
                  onChange={(e) => setCornerPreset(c, e.target.value)}
                  className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-cyan/60"
                >
                  {src.kind === "snapshot" && (
                    <option value="__snapshot">◉ {src.label}</option>
                  )}
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  {userPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      ★ {p.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => snapCorner(c)}
                  className="kc-btn kc-btn--sm kc-btn--ghost shrink-0"
                  title="Freeze the current sound into this corner"
                >
                  ◉ Snap
                </button>
              </div>
            );
          })}

          <div className="rounded-xl border border-white/10 p-3 bg-white/[0.02]">
            <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-2">
              Blend breakdown
            </div>
            <div className="space-y-1.5">
              {cornerMeta.map(({ corner, name, accent, weight }) => (
                <div key={corner} className="flex items-center gap-2">
                  <div className="w-4 text-[10px] font-mono text-dim uppercase">
                    {corner.toUpperCase()}
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-white/8 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, weight * 100)}%`,
                        background: accent,
                        boxShadow: `0 0 12px ${accent}66`,
                      }}
                    />
                  </div>
                  <div className="w-16 min-w-0 text-[9px] text-dim truncate">{name}</div>
                  <div className="w-9 text-[10px] font-mono text-right text-dim">
                    {(weight * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Param locks */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02]">
            <button
              onClick={() => setLocksOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="text-[10px] uppercase tracking-[0.25em] text-dim">
                Param locks{" "}
                <span className={locks.length ? "text-amber" : ""}>
                  ({locks.length})
                </span>
              </span>
              <span className="text-[10px] text-dim">{locksOpen ? "▲" : "▼"}</span>
            </button>
            {locksOpen && (
              <div className="px-3 pb-3">
                <div className="text-[10px] text-dim leading-relaxed mb-2">
                  Locked params hold their current value — the morph flies around them.
                </div>
                <div className="flex flex-wrap gap-1">
                  {SOUND_PARAM_META.map((meta) => {
                    const locked = locksSet.has(meta.key);
                    return (
                      <button
                        key={meta.key}
                        onClick={() => toggleLock(meta.key)}
                        title={meta.hint}
                        className={`kc-chip ${locked ? "kc-on" : ""}`}
                      >
                        {locked ? "⊘ " : ""}
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                {locks.length > 0 && (
                  <button
                    onClick={() => setLocks([])}
                    className="mt-2 text-[10px] uppercase tracking-wider text-dim hover:text-white/80 transition"
                  >
                    Release all locks
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="text-[11px] text-dim leading-relaxed">
            Nothing changes until you interact — then the blend previews live.{" "}
            <span className="text-cyan">Commit current blend</span> keeps it;
            leaving without committing restores your previous sound.
          </div>

          <div className="mt-auto flex justify-end">
            <button
              onClick={() => {
                if (confirmReset) {
                  resetLab();
                } else {
                  setConfirmReset(true);
                  window.setTimeout(() => setConfirmReset(false), 2400);
                }
              }}
              className={`kc-btn kc-btn--sm ${
                confirmReset ? "kc-btn--danger" : "kc-btn--ghost"
              }`}
            >
              {confirmReset ? "CONFIRM PURGE" : "✕ Reset lab"}
            </button>
          </div>
        </GlassPanel>
      </div>

      {/* Quick Sculpts — fast one-tap moves plus the XY morph pad for shaping
          tone & space by feel. These commit straight onto the current sound. */}
      <GlassPanel intense className="p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-dim">
              Quick Sculpts
            </div>
            <div className="text-xl font-semibold">Make it…</div>
          </div>
          <div className="text-[11px] text-dim max-w-xs sm:text-right">
            One-tap moves layer onto your current sound. The morph pad nudges
            tone &amp; space by feel — both commit straight to the sculpt.
          </div>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-5">
          <div className="col-span-12 md:col-span-5 lg:col-span-4">
            <MorphPad onInteract={preview.commit} />
          </div>
          <div className="col-span-12 md:col-span-7 lg:col-span-8 flex flex-col justify-center">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MacroButton label="Warmer" color="#ffb648"
                onClick={() => applyMacro("warmer", { warmth: 0.2, bass: 0.1, harmonics: 0.1, sparkle: -0.05 })} />
              <MacroButton label="Cleaner" color="#22e8ff"
                onClick={() => applyMacro("cleaner", { clarity: 0.15, air: 0.15, harmonics: -0.05, saturation: -0.05 })} />
              <MacroButton label="Punchier" color="#ff5b8a"
                onClick={() => applyMacro("punchier", { punch: 0.2, compression: 0.15, bass: 0.1 })} />
              <MacroButton label="Wider" color="#48ffd1"
                onClick={() => applyMacro("wider", { width: 0.2, spatial: 0.15, reverbAmount: 0.05 })} />
              <MacroButton label="Bigger" color="#7a3bff"
                onClick={() => applyMacro("bigger", { subBass: 0.2, reverbSize: 0.1, spatial: 0.1 })} />
              <MacroButton label="Tighter" color="#9dff5b"
                onClick={() => applyMacro("tighter", { subBass: -0.1, bass: -0.05, compression: 0.1, punch: 0.1 })} />
            </div>
            <button
              onClick={randomizeSculpt}
              className="kc-btn kc-btn--danger mt-2 w-full h-11"
            >
              Randomize sculpt
            </button>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

function TwoTapButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 2400);
        }
      }}
      className={`kc-btn kc-btn--sm ${armed ? "kc-btn--danger" : "kc-btn--ghost"}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function MacroButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="kc-btn kc-btn--ghost h-11"
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      {label}
    </button>
  );
}

function CornerBadge({ corner, name }: { corner: Corner; name: string }) {
  const base =
    "absolute text-[10px] px-2 py-1 rounded-full border border-white/15 bg-black/45 backdrop-blur-sm max-w-[46%] truncate pointer-events-none";
  const pos =
    corner === "a" ? "top-2 left-2" :
    corner === "b" ? "top-2 right-2 text-right" :
    corner === "c" ? "bottom-2 left-2" :
    "bottom-2 right-2 text-right";
  const tag = corner.toUpperCase();
  return (
    <div className={`${base} ${pos}`}>
      <span className="font-mono text-cyan/80">{tag}</span> {name}
    </div>
  );
}
