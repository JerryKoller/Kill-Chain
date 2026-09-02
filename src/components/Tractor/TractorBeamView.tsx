import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ActionBar } from "@/components/shared/ActionBar";
import { KCEmptyState, IconTractor } from "@/components/kcds";
import { useAudioStore } from "@/state/audioStore";
import { useSettingsStore } from "@/state/settingsStore";
import { usePlayerStore } from "@/state/playerStore";
import { useUIStore } from "@/state/uiStore";
import { useAirspaceStore } from "@/state/airspaceStore";
import { useLibraryStore, audioUrlForPath } from "@/state/libraryStore";
import { getEngine } from "@/audio/AudioEngine";
import { profileForId } from "@/audio/headphoneProfiles";
import { useEqStore } from "@/state/eqStore";
import {
  measureTrack,
  getTargetProfile,
  TARGET_PROFILES,
  DEFAULT_TARGET_ID,
  TRACTOR_MOVE_CLAMP_DB,
  TRACTOR_MAX_STRENGTH,
  type TractorMeasurement,
} from "@/lib/tractorBeam";
import { measureLive } from "@/lib/tractorLive";
import {
  buildLockManifest,
  applyLockManifest,
  ALL_LAYERS,
  type LockManifest,
  type LockLayerId,
  type LockLayerSelection,
} from "@/lib/tractorLock";
import { loadReferenceFile, type TargetReference } from "@/lib/targetLock";
import {
  useLockLibraryStore,
  lockKeyForCurrentSource,
  measurementFingerprint,
  type LockRecord,
} from "@/state/lockLibraryStore";

function fmtFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${hz}`;
}

/** Colour a band by its frequency: warm amber (bass) → cool violet (treble). */
function freqColor(freq: number): string {
  const t = Math.max(
    0,
    Math.min(1, (Math.log2(freq) - Math.log2(20)) / (Math.log2(20000) - Math.log2(20))),
  );
  return `hsl(${Math.round(35 + t * 235)}, 85%, 62%)`;
}

function fmtAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Persistence (controls only — locks live in the Lock Library) ──────────

const PREFS_KEY = "audio-playground.tractorPrefs.v1";

interface TractorPrefs {
  strength: number;
  targetId: string;
}

const DEFAULT_PREFS: TractorPrefs = { strength: 1, targetId: DEFAULT_TARGET_ID };

function loadPrefs(): TractorPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<TractorPrefs>;
    const strength = Number(p.strength);
    return {
      strength: Number.isFinite(strength)
        ? Math.max(0, Math.min(TRACTOR_MAX_STRENGTH, strength))
        : DEFAULT_PREFS.strength,
      targetId: getTargetProfile(typeof p.targetId === "string" ? p.targetId : undefined).id,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let prefsTimer: ReturnType<typeof setTimeout> | null = null;
function persistPrefs(prefs: TractorPrefs): void {
  if (typeof window === "undefined") return;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (err) {
      void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
        reportStorageFailure("Tractor prefs", err),
      );
    }
  }, 300);
}

// ── View ──────────────────────────────────────────────────────────────────

export function TractorBeamView() {
  const correctionEnabled = useAudioStore((s) => s.correctionEnabled);
  const headphoneId = useSettingsStore((s) => s.headphone);
  const headphone = profileForId(headphoneId);
  const playerEl = usePlayerStore((s) => s.element);
  const playerMeta = usePlayerStore((s) => s.metadata);
  const playerStatus = usePlayerStore((s) => s.status);
  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  const airMode = useAirspaceStore((s) => s.airMode);
  const mediaHint = airMode === "off" ? null : airMode;
  const toast = useUIStore((s) => s.toast);

  const [prefs] = useState(loadPrefs);
  const [strength, setStrengthRaw] = useState(prefs.strength);
  const [targetId, setTargetIdRaw] = useState(prefs.targetId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string | null>(null);
  const [titleHint, setTitleHint] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<TractorMeasurement | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const [curveEdits, setCurveEdits] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [layerSel, setLayerSel] = useState<LockLayerSelection>({ ...ALL_LAYERS });
  const [reference, setReference] = useState<TargetReference | null>(null);
  const [applied, setApplied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  const strengthRef = useRef(strength);
  strengthRef.current = strength;
  const targetIdRef = useRef(targetId);
  targetIdRef.current = targetId;

  const setStrength = useCallback((v: number) => {
    const s = Math.max(0, Math.min(TRACTOR_MAX_STRENGTH, v));
    setStrengthRaw(s);
    persistPrefs({ strength: s, targetId: targetIdRef.current });
  }, []);

  const setTargetId = useCallback((id: string) => {
    setTargetIdRaw(id);
    persistPrefs({ strength: strengthRef.current, targetId: id });
  }, []);

  // Drop the ref so an in-flight catch does not toast "cancelled" or setState
  // after we leave Tractor. Click-to-cancel keeps the ref and still toasts.
  useEffect(
    () => () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  // A/B compares the last engaged chain, not a recipe you haven't applied yet.
  useEffect(() => {
    setApplied(false);
  }, [strength, targetId, excluded, curveEdits, layerSel, reference, correctionEnabled, headphoneId]);

  // ── The manifest: EVERYTHING derives from the measurement, instantly ──
  const manifest: LockManifest | null = useMemo(
    () =>
      measurement
        ? buildLockManifest(measurement, {
            headphone,
            correctionEnabled,
            strength,
            targetId,
            excluded,
            mediaHint,
            titleHint,
            reference: reference?.m ?? null,
            curveEdits,
          })
        : null,
    [measurement, headphone, correctionEnabled, strength, targetId, excluded, mediaHint, titleHint, reference, curveEdits],
  );

  // Veto-free derivation for ghost bars.
  const ghostCurve = useMemo(
    () =>
      measurement && excluded.size > 0
        ? buildLockManifest(measurement, {
            headphone,
            correctionEnabled,
            strength,
            targetId,
            mediaHint,
            titleHint,
            reference: reference?.m ?? null,
            curveEdits,
          }).curve
        : null,
    [measurement, headphone, correctionEnabled, strength, targetId, excluded, mediaHint, titleHint, reference, curveEdits],
  );

  const resetForNewMeasurement = useCallback(() => {
    setExcluded(new Set());
    setCurveEdits(new Map());
    setLayerSel({ ...ALL_LAYERS });
    setApplied(false);
  }, []);

  const runAnalysis = useCallback(
    async (buffer: AudioBuffer, name: string, ac: AbortController) => {
      setStatus("Scanning spectrum…");
      setTrackName(name);
      try {
        const m = await measureTrack(buffer, {
          signal: ac.signal,
          onProgress: (p) => {
            if (abortRef.current !== ac) return;
            setStatus(p.stage);
            setProgress(p.fraction);
          },
        });
        if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
        setMeasurement(m);
        setResultName(name);
        setTitleHint(name);
        resetForNewMeasurement();
        setError(null);
        setStatus("");
        if (m.silent) {
          toast("Track appears silent — nothing to correct");
        } else {
          toast("Spectral lock acquired — review the manifest", "success");
        }
      } catch (err) {
        if (abortRef.current !== ac) return;
        if ((err as DOMException)?.name === "AbortError") return;
        console.error("[tractor] analysis failed:", err);
        setError("Analysis failed — the file decoded but could not be scanned. Try another track.");
        toast("Analysis failed — try another file", "error");
        setStatus("");
      } finally {
        if (abortRef.current === ac) {
          setBusy(false);
          setProgress(0);
        }
      }
    },
    [toast, resetForNewMeasurement],
  );

  const analyzeSource = useCallback(
    async (getData: () => Promise<ArrayBuffer>, name: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        setBusy(true);
        setProgress(0);
        setError(null);
        setStatus("Decoding audio…");
        const buf = await getData();
        if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
        const audioBuf = await getEngine().ctx.decodeAudioData(buf);
        if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
        await runAnalysis(audioBuf, name, ac);
      } catch (err) {
        if (abortRef.current !== ac) return;
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("[tractor] decode failed:", err);
          setError("Couldn't read that track — the file may be corrupt or an unsupported format.");
          toast("Couldn't read that track", "error");
        }
        setBusy(false);
        setStatus("");
        setProgress(0);
      }
    },
    [runAnalysis, toast],
  );

  const cancelAnalysis = useCallback(() => {
    const ac = abortRef.current;
    if (!ac || ac.signal.aborted) return;
    ac.abort();
    toast("Acquisition cancelled");
  }, [toast]);

  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      cancelAnalysis();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, cancelAnalysis]);

  const onLiveLock = useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const p = usePlayerStore.getState();
    const airTitle = useAirspaceStore.getState().media?.title || null;
    const hint =
      (p.loopbackActive && p.loopbackMode === "airspace" ? airTitle : null) ??
      airTitle ??
      p.metadata.title ??
      null;
    const name = hint
      ? `${hint} (live lock)`
      : p.loopbackActive
        ? "Exterior audio (live lock)"
        : "Live lock";
    setBusy(true);
    setProgress(0);
    setError(null);
    setTrackName(name);
    setStatus("Listening…");
    void (async () => {
      try {
        const m = await measureLive({
          seconds: 20,
          signal: ac.signal,
          onProgress: (pr) => {
            if (abortRef.current !== ac) return;
            setStatus(pr.stage);
            setProgress(pr.fraction);
          },
        });
        if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
        setMeasurement(m);
        setResultName(name);
        setTitleHint(hint);
        resetForNewMeasurement();
        setError(null);
        setStatus("");
        if (m.silent) {
          toast("Heard nothing — start playback, then run the lock again");
        } else {
          toast("Live spectral lock acquired — review the manifest", "success");
        }
      } catch (err) {
        if (abortRef.current !== ac) return;
        if ((err as DOMException)?.name === "AbortError") return;
        console.error("[tractor] live lock failed:", err);
        setError("Live lock failed — the engine tap could not be read.");
        toast("Live lock failed — the engine tap could not be read", "error");
        setStatus("");
      } finally {
        if (abortRef.current === ac) {
          setBusy(false);
          setProgress(0);
        }
      }
    })();
  }, [toast, resetForNewMeasurement]);

  /** THE big lock: reads whatever is in front of it right now. */
  const onLock = useCallback(() => {
    const p = usePlayerStore.getState();
    if (p.status === "playing" && p.element?.src && !p.loopbackActive) {
      const name = p.metadata.title || p.element.src.split("/").pop() || "Current track";
      const src = p.element.src;
      void analyzeSource(async () => (await fetch(src)).arrayBuffer(), name);
      return;
    }
    if (p.loopbackActive || p.status === "playing") {
      onLiveLock();
      return;
    }
    if (p.element?.src) {
      const name = p.metadata.title || p.element.src.split("/").pop() || "Current track";
      const src = p.element.src;
      void analyzeSource(async () => (await fetch(src)).arrayBuffer(), name);
      return;
    }
    toast("Nothing to lock onto — play something or load a file first");
  }, [analyzeSource, onLiveLock, toast]);

  const onPickFile = useCallback(() => fileRef.current?.click(), []);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      void analyzeSource(() => file.arrayBuffer(), file.name);
    },
    [analyzeSource],
  );

  const onUseCurrent = useCallback(() => {
    const src = playerEl?.src;
    if (!src) {
      toast("No track loaded — drop one in or pick a file");
      return;
    }
    const name = playerMeta.title || src.split("/").pop() || "Current track";
    void analyzeSource(async () => (await fetch(src)).arrayBuffer(), name);
  }, [playerEl, playerMeta, analyzeSource, toast]);

  const onLibraryTrack = useCallback(
    (path: string, name: string) => {
      const url = audioUrlForPath(path);
      void analyzeSource(async () => (await fetch(url)).arrayBuffer(), name);
    },
    [analyzeSource],
  );

  // ── Reference target slot ──
  const [refBusy, setRefBusy] = useState(false);
  const onLoadReference = useCallback(() => {
    if (typeof window.playground?.files?.openAudioMulti !== "function") {
      toast("Loading a reference needs the desktop app");
      return;
    }
    setRefBusy(true);
    void loadReferenceFile((p) => {
      if (aliveRef.current) setStatus(p.stage);
    })
      .then((ref) => {
        if (!aliveRef.current) return;
        if (ref) {
          setReference(ref);
          toast(`Reference locked — ${ref.name}`, "success");
        }
      })
      .catch(() => {
        if (aliveRef.current) toast("Couldn't read the reference file", "error");
      })
      .finally(() => {
        if (!aliveRef.current) return;
        setRefBusy(false);
        setStatus("");
      });
  }, [toast]);

  // ── Curve interaction ──
  const toggleBand = useCallback((freq: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(freq)) next.delete(freq);
      else next.add(freq);
      return next;
    });
  }, []);

  const editBand = useCallback((freq: number, deltaDb: number) => {
    setCurveEdits((prev) => {
      const next = new Map(prev);
      const cur = next.get(freq) ?? 0;
      const v = Math.max(-9, Math.min(9, cur + deltaDb));
      if (Math.abs(v) < 0.05) next.delete(freq);
      else next.set(freq, v);
      return next;
    });
  }, []);

  const clearVetoes = useCallback(() => setExcluded(new Set()), []);
  const clearEdits = useCallback(() => setCurveEdits(new Map()), []);

  const toggleLayer = useCallback((id: LockLayerId) => {
    setLayerSel((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── Engage: apply the manifest + record the lock ──
  const engageLock = useCallback(() => {
    if (!manifest || manifest.silent || busy) return;
    void (async () => {
      try {
        const appliedLayers = await applyLockManifest(manifest, layerSel, resultName);
        toast(
          appliedLayers.length > 1
            ? `Lock engaged — ${appliedLayers.length} layers`
            : appliedLayers.length === 1
              ? "Lock engaged — EQ matched"
              : "Nothing selected to apply",
          appliedLayers.length > 0 ? "success" : "warn",
        );
        if (appliedLayers.length === 0 || !measurement) return;
        setApplied(true);
        // Record into the Lock Library under the playing source's identity
        // (falls back to the analyzed name for one-off files).
        const src = await lockKeyForCurrentSource();
        const ident = src ?? {
          key: `live:${resultName ?? "unknown"}`,
          kind: "live" as const,
          name: resultName ?? "Lock",
          sub: "",
        };
        const now = Date.now();
        useLockLibraryStore.getState().upsert({
          ...ident,
          favorite: false,
          savedAt: now,
          updatedAt: now,
          measurement: {
            ...measurement,
            levelsDb: measurement.levelsDb.map((v) => Math.round(v * 100) / 100),
          },
          targetId: targetIdRef.current,
          strength: manifest.strength,
          vetoes: [...excluded],
          curveEdits: Object.fromEntries([...curveEdits].map(([f, d]) => [String(f), d])),
          layers: { ...layerSel },
          curve: manifest.curve,
          masterMoves: manifest.masterMoves,
          restore: manifest.restore,
          clarity: manifest.clarity,
          outputTrimDb: manifest.outputTrimDb,
          matchBeforePct: manifest.matchBeforePct,
          matchAfterPct: manifest.matchAfterPct,
          contentLabel: manifest.contentLabel,
          fingerprint: measurementFingerprint(measurement),
          v: 1,
        });
      } catch (err) {
        console.error("[tractor] engage failed:", err);
        toast("Couldn't engage the lock", "error");
      }
    })();
  }, [manifest, layerSel, resultName, measurement, excluded, curveEdits, toast, busy]);

  const saveResult = useCallback(() => {
    if (!manifest || manifest.silent || busy) return;
    const base = (resultName || "Tractor").replace(/\.[^.]+$/, "").slice(0, 28);
    void import("@/state/userPresetsStore").then(({ useUserPresetsStore }) => {
      useUserPresetsStore.getState().savePreset(`Beam · ${base}`, manifest.result.params);
      toast(`Saved "Beam · ${base}" (Armory knobs — EQ stays in the Lock Library)`, "success");
    });
  }, [manifest, resultName, toast, busy]);

  /** Open a Lock Library record back into the console for re-voicing. */
  const openRecord = useCallback(
    (rec: LockRecord) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      setStatus("");
      setProgress(0);
      setError(null);
      setTrackName(rec.name);
      setResultName(rec.name);
      setTitleHint(rec.name);
      setMeasurement(rec.measurement);
      setStrengthRaw(rec.strength);
      setTargetIdRaw(rec.targetId);
      setExcluded(new Set(rec.vetoes));
      setCurveEdits(new Map(Object.entries(rec.curveEdits).map(([f, d]) => [Number(f), d])));
      setLayerSel({ ...rec.layers });
      setApplied(false);
      persistPrefs({ strength: rec.strength, targetId: rec.targetId });
      toast(`Opened lock — ${rec.name}`);
    },
    [toast],
  );

  const canEngage =
    !!manifest &&
    !manifest.silent &&
    manifest.items.some((item) => item.active && layerSel[item.id]);
  const canLoadReference = typeof window.playground?.files?.openAudioMulti === "function";

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Tractor Beam"
        code="KC-03"
        subtitle="Analyze, explain, correct, remember — one LOCK prepares the complete manifest; nothing lands until you engage it"
      />

      <input
        ref={fileRef}
        type="file"
        // Same containers the drop handler accepts — audio/* alone hid
        // decodable files with odd MIME registrations on some systems.
        accept="audio/*,.mp3,.wav,.wave,.flac,.ogg,.oga,.opus,.m4a,.m4b,.mp4,.aac,.webm,.weba,.mka"
        className="hidden"
        onChange={onFile}
      />

      <div className="grid grid-cols-12 gap-3">
        {/* ── Mission console: acquisition ── */}
        <GlassPanel intense className="col-span-12 lg:col-span-5 p-5 flex flex-col gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-dim">Tractor Command</div>
            <div className="text-xl font-semibold">Acquisition</div>
          </div>

          <LockButton busy={busy} progress={progress} status={status} onLock={onLock} onCancel={cancelAnalysis} />

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onPickFile}
              disabled={busy}
              className="kc-btn kc-btn--ghost kc-btn--sm"
              title="Pick a file from disk"
            >
              ＋ File
            </button>
            <button
              type="button"
              onClick={onUseCurrent}
              disabled={busy || !playerEl?.src}
              className="kc-btn kc-btn--ghost kc-btn--sm"
              title={playerEl?.src ? "Analyze the loaded track (even if paused)" : "No track loaded"}
            >
              ♪ Current
            </button>
            <button
              type="button"
              onClick={onLiveLock}
              disabled={busy}
              className="kc-btn kc-btn--ghost kc-btn--sm"
              title="Force a live capture of whatever is flowing through the engine (~20 s)"
            >
              ◉ Live
            </button>
          </div>
          {loopbackActive && (
            <div className="text-[11px] text-emerald-300/80 -mt-2">
              Exterior audio is flowing — the lock will read exactly what you hear.
            </div>
          )}

          {/* Source / Target slots */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.25em] text-dim">Source</div>
              <div className="text-sm font-medium truncate" title={trackName ?? undefined}>
                {trackName ?? "—"}
              </div>
            </div>
            <div
              className={`rounded-xl border px-3 py-2 min-w-0 ${
                reference ? "border-violet-400/40 bg-violet-500/[0.07]" : "border-white/10 bg-black/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.25em] text-dim">Target ref</div>
                {reference && (
                  <button
                    type="button"
                    onClick={() => {
                      setReference(null);
                      toast("Reference cleared");
                    }}
                    className="text-[10px] text-dim hover:text-white/80 transition"
                    title="Clear the reference — back to profile targets"
                  >
                    ✕
                  </button>
                )}
              </div>
              {reference ? (
                <div className="text-sm font-medium truncate text-violet-200" title={reference.name}>
                  {reference.name}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onLoadReference}
                  disabled={refBusy || busy}
                  className="text-sm text-cyan/90 hover:text-cyan transition disabled:opacity-50"
                  title={
                    canLoadReference
                      ? "Pick a reference track — Tractor matches the source toward it"
                      : "Loading a reference needs the desktop app"
                  }
                >
                  {refBusy ? "Reading…" : "+ Load reference"}
                </button>
              )}
            </div>
          </div>
          {reference && (
            <p className="text-[11px] text-violet-200/70 -mt-2 leading-relaxed">
              Reference mode — the correction now drives the source toward this reference instead
              of a taste profile. Strength scales how far it goes.
            </p>
          )}

          <AutoLockToggle />

          <LibraryPicker disabled={busy} onPick={onLibraryTrack} />

          <MissionPresetPicker value={targetId} onChange={setTargetId} disabled={!!reference} />

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs uppercase tracking-[0.3em] text-dim">Correction strength</div>
              <div className="text-sm font-mono text-cyan">
                {Math.round(strength * 100)}%
                {manifest?.strengthLimited && (
                  <span className="text-amber ml-1" title="Intelligence capped the strength — the source is already healthy">
                    → {Math.round(manifest.strength * 100)}%
                  </span>
                )}
              </div>
            </div>
            <div className="relative">
              <input
                type="range"
                min={0}
                max={TRACTOR_MAX_STRENGTH}
                step={0.05}
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                className="kc-slider w-full relative z-10"
                style={{ ["--kc-fill" as string]: `${(strength / TRACTOR_MAX_STRENGTH) * 100}%` }}
                aria-label="Correction strength"
              />
              <div
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-3.5 w-px bg-white/35"
                style={{ left: `${(1 / TRACTOR_MAX_STRENGTH) * 100}%` }}
                title="100% — recommended"
              />
              {manifest?.strengthLimited && (
                <div
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-3.5 w-px bg-amber"
                  style={{ left: `${(manifest.health.strengthCeiling / TRACTOR_MAX_STRENGTH) * 100}%` }}
                  title="Health ceiling — the source doesn't need more"
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-dim tabular-nums">
              <span>0%</span>
              <span>100% = recommended</span>
              <span>150%</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.25em] text-dim">Voiced for</div>
            <div className="text-sm font-medium">{headphone.name}</div>
            <div className="text-[11px] text-dim mt-0.5">
              {correctionEnabled
                ? "Correction ON — headphone profile is flattening; Tractor voices for a flat baseline."
                : "Correction OFF — Tractor also compensates this headphone's colour."}
            </div>
          </div>

          <LockLibraryPanel disabled={busy} onOpen={openRecord} />
        </GlassPanel>

        {/* ── Readout + manifest ── */}
        <GlassPanel intense className="col-span-12 lg:col-span-7 p-5">
          {!manifest ? (
            error ? (
              <ErrorState message={error} />
            ) : (
              <EmptyState />
            )
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.3em] text-dim">
                    {reference ? "Reference lock" : "Spectral lock"}
                  </div>
                  <div className="text-xl font-semibold truncate" title={resultName ?? undefined}>
                    {resultName || "Analysis complete"}
                  </div>
                  {busy && (
                    <div className="text-[11px] text-amber mt-0.5">
                      Scan in progress — this is the previous lock until acquisition finishes.
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Stat
                    label="Target"
                    text={
                      reference
                        ? "Reference"
                        : manifest.targetId === "smart"
                          ? `Smart → ${getTargetProfile(manifest.resolvedTargetId).label}`
                          : getTargetProfile(manifest.resolvedTargetId).label
                    }
                  />
                  <MatchStat before={manifest.matchBeforePct} after={manifest.matchAfterPct} />
                  <Stat
                    label="Read conf"
                    text={`${manifest.health.measureConfidencePct}%`}
                    hint="How trustworthy the measurement is — signal coverage, window count, section agreement"
                  />
                  <Stat
                    label="Benefit"
                    text={`${manifest.health.benefitConfidencePct}%`}
                    hint="How much correcting is likely to help — target residual plus detected damage"
                  />
                </div>
              </div>

              <HealthCard manifest={manifest} />

              {manifest.result.content && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 flex items-start gap-3 -mt-1">
                  <div className="shrink-0 rounded-lg border border-cyan/30 bg-cyan/10 px-2.5 py-1.5 text-center">
                    <div className="text-[9px] uppercase tracking-[0.25em] text-dim">Read as</div>
                    <div className="text-sm font-semibold text-cyan">{manifest.result.content.label}</div>
                    <div className="text-[8px] uppercase tracking-[0.2em] text-dim mt-0.5">
                      {manifest.result.content.via === "audio+title"
                        ? "audio + title"
                        : manifest.result.content.via === "title"
                          ? "from title"
                          : "from audio"}
                    </div>
                  </div>
                  <div className="text-[11px] text-dim leading-relaxed pt-0.5">
                    {manifest.result.content.blurb}
                    {mediaHint && !reference && (
                      <span className="text-cyan/80"> Airspace says {mediaHint} — Smart Lock honours it.</span>
                    )}
                  </div>
                </div>
              )}

              <BandChart
                manifest={manifest}
                ghostCurve={ghostCurve}
                excluded={excluded}
                edited={curveEdits}
                onToggleBand={toggleBand}
                onEditBand={editBand}
              />

              {(excluded.size > 0 || curveEdits.size > 0) && (
                <div className="flex items-center gap-3 text-[11px] text-dim -mt-2 flex-wrap">
                  {excluded.size > 0 && (
                    <span className="flex items-center gap-2">
                      {excluded.size} band{excluded.size === 1 ? "" : "s"} vetoed
                      <button type="button" onClick={clearVetoes} className="kc-btn kc-btn--ghost kc-btn--sm uppercase tracking-[0.15em]">
                        Restore
                      </button>
                    </span>
                  )}
                  {curveEdits.size > 0 && (
                    <span className="flex items-center gap-2">
                      {curveEdits.size} band{curveEdits.size === 1 ? "" : "s"} hand-edited
                      <button type="button" onClick={clearEdits} className="kc-btn kc-btn--ghost kc-btn--sm uppercase tracking-[0.15em]">
                        Reset edits
                      </button>
                    </span>
                  )}
                </div>
              )}

              <ManifestPanel manifest={manifest} sel={layerSel} onToggle={toggleLayer} />

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={engageLock}
                  disabled={!canEngage || busy}
                  className="kc-btn kc-btn--primary"
                  title={
                    busy
                      ? "Wait — a scan is running. This curve is the previous lock until it finishes."
                      : manifest.silent
                        ? "Nothing to apply — the source looks silent"
                        : canEngage
                          ? "Apply every enabled layer of the manifest and record the lock"
                          : "Turn on at least one layer in the manifest"
                  }
                >
                  ⚡ Engage lock
                </button>
                <button
                  type="button"
                  onClick={saveResult}
                  disabled={manifest.silent || busy}
                  className="kc-btn kc-btn--ghost"
                  title={
                    busy
                      ? "Wait — a scan is running. This curve is the previous lock until it finishes."
                      : "Armory preset of the derived tone knobs only — the EQ curve is not included. Engage lock to keep EQ in the Lock Library."
                  }
                >
                  Save as preset
                </button>
                <AbCompareButton applied={applied} playing={playerStatus === "playing"} />
                <div className="text-[11px] text-dim">
                  Analyzed {manifest.result.analyzedSec.toFixed(0)}s · {manifest.result.windowsUsed} windows
                  {Math.abs(manifest.curveTrimDb) > 0.05 && (
                    <> · level trim {manifest.curveTrimDb > 0 ? "+" : ""}{manifest.curveTrimDb.toFixed(1)} dB</>
                  )}
                </div>
              </div>
            </div>
          )}
        </GlassPanel>
      </div>

      <GlassPanel className="p-5">
        <div className="text-xs uppercase tracking-[0.3em] text-dim mb-2">How it works</div>
        <ol className="grid md:grid-cols-3 gap-3 text-[12px] leading-relaxed text-white/75">
          <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <span className="text-cyan font-semibold">1 · Lock</span> — a loaded
            file is scanned offline (FFT windows start-to-finish, silence skipped).
            Live capture / LOCK-while-playing listens for ~20 s instead. Health is
            read: an already-clean master gets a capped, gentle correction; damage
            like an HF cutoff, crunch or a thin body justifies a firmer hand.
          </li>
          <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <span className="text-cyan font-semibold">2 · Manifest</span> — every proposed layer is
            listed before anything is applied: Sculptor EQ, master moves, restoration, clarity and
            loudness trim. Toggle layers, veto bands, drag bars to hand-edit the curve — the match
            % updates live. Load a reference to drive toward a target instead of a profile.
          </li>
          <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <span className="text-cyan font-semibold">3 · Remember</span> — engaging the lock files
            it in the Lock Library under the source's identity. Next time that source plays,
            Auto-Lock restores the saved lock instantly instead of re-scanning. Desktop can export
            locks as .klock packs.
          </li>
        </ol>
      </GlassPanel>
    </div>
  );
}

// ── LOCK button with acquisition animation ─────────────────────────────────

function LockButton({
  busy,
  progress,
  status,
  onLock,
  onCancel,
}: {
  busy: boolean;
  progress: number;
  status: string;
  onLock: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={busy ? onCancel : onLock}
        className={`relative w-full overflow-hidden rounded-2xl border px-4 py-5 text-center transition group ${
          busy
            ? "border-cyan/60 bg-cyan/[0.08]"
            : "border-cyan/40 bg-cyan/[0.05] hover:bg-cyan/[0.1] hover:border-cyan/70"
        }`}
        title={busy ? "Cancel the acquisition (Esc)" : "Measure whatever is playing (or loaded) and prepare the full correction manifest"}
      >
        {/* Acquisition sweep */}
        {busy && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan/25 to-transparent"
            style={{ animation: "kc-lock-sweep 1.4s linear infinite" }}
          />
        )}
        <span className="relative flex items-center justify-center gap-3">
          <span
            className={`grid place-items-center w-12 h-12 rounded-full border-2 transition ${
              busy ? "border-cyan/30 border-t-cyan animate-spin" : "border-cyan/60 group-hover:border-cyan"
            }`}
          >
            {!busy && <span className="w-3.5 h-3.5 rounded-full bg-cyan shadow-[0_0_12px_rgb(34,232,255)]" />}
          </span>
          <span className="text-left">
            <span className="block text-lg font-bold tracking-[0.2em] text-cyan">
              {busy ? "ACQUIRING…" : "LOCK"}
            </span>
            <span className="block text-[11px] text-dim">
              {busy
                ? `${status || "Working…"} · ${Math.round(progress * 100)}% — click to cancel`
                : "Measure the loaded or playing source · nothing applies until Engage"}
            </span>
          </span>
        </span>
        {busy && (
          <span className="absolute bottom-0 left-0 h-1 bg-cyan transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
        )}
      </button>
      <style>{`@keyframes kc-lock-sweep { from { left: -35%; } to { left: 100%; } }`}</style>
    </div>
  );
}

// ── Health / intelligence card ──────────────────────────────────────────────

function HealthCard({ manifest }: { manifest: LockManifest }) {
  const h = manifest.health;
  const tone = h.mastered ? "emerald" : h.damage.length > 0 ? "amber" : "cyan";
  const border =
    tone === "emerald" ? "border-emerald-400/30 bg-emerald-500/[0.05]"
    : tone === "amber" ? "border-amber/30 bg-amber/[0.05]"
    : "border-cyan/25 bg-cyan/[0.04]";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${border}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.25em] text-dim">Source health</span>
          <span
            className={`text-sm font-mono font-semibold ${
              h.mastered ? "text-emerald-300" : h.damage.length > 0 ? "text-amber" : "text-cyan"
            }`}
          >
            {h.healthPct}%
          </span>
          {h.mastered && (
            <span className="text-[9px] uppercase tracking-[0.2em] rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 px-2 py-0.5">
              already mastered
            </span>
          )}
          {manifest.strengthLimited && (
            <span className="text-[9px] uppercase tracking-[0.2em] rounded-full border border-amber/40 bg-amber/10 text-amber px-2 py-0.5">
              strength capped {Math.round(manifest.strength * 100)}%
            </span>
          )}
        </div>
        {h.damage.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {h.damage.map((d) => (
              <span
                key={d.id}
                className="text-[10px] rounded-full border border-amber/40 bg-amber/10 text-amber px-2 py-0.5"
                title={d.detail}
              >
                {d.label} {Math.round(d.severity * 100)}%
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-white/70 leading-relaxed">
        {h.notes.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
    </div>
  );
}

// ── Manifest ────────────────────────────────────────────────────────────────

function ManifestPanel({
  manifest,
  sel,
  onToggle,
}: {
  manifest: LockManifest;
  sel: LockLayerSelection;
  onToggle: (id: LockLayerId) => void;
}) {
  return (
    <div className="rounded-xl border border-cyan/20 bg-black/25 overflow-hidden">
      <div className="px-3 py-2 border-b border-white/8 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.3em] text-dim">Lock manifest</span>
        <span className="text-[11px] font-mono text-cyan/90 truncate" title={manifest.summary}>
          {manifest.summary}
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {manifest.items.map((item) => {
          const on = sel[item.id] && item.active;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => item.active && onToggle(item.id)}
              disabled={!item.active}
              className={`w-full text-left px-3 py-2 flex items-start gap-3 transition ${
                item.active ? "hover:bg-white/[0.03] cursor-pointer" : "opacity-45 cursor-default"
              }`}
              title={item.active ? (on ? "Click to skip this layer" : "Click to include this layer") : "Nothing to do for this layer"}
            >
              <span
                className={`mt-0.5 shrink-0 w-4 h-4 rounded grid place-items-center border text-[10px] transition ${
                  on
                    ? "border-cyan/70 bg-cyan/20 text-cyan"
                    : "border-white/20 bg-white/[0.03] text-transparent"
                }`}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`text-xs font-semibold ${on ? "text-white/90" : "text-white/55 line-through"}`}>
                    {item.label}
                  </span>
                  <span className={`text-[11px] font-mono shrink-0 ${on ? "text-cyan/90" : "text-white/40"}`}>
                    {item.value}
                  </span>
                </span>
                <span className="block text-[10px] text-dim leading-relaxed mt-0.5">{item.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Auto-lock, mission presets, library picker (kept from v2.2) ────────────

function AutoLockToggle() {
  const toast = useUIStore((s) => s.toast);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let un: (() => void) | undefined;
    void import("@/lib/tractorAutoLock").then((m) => {
      m.initTractorAutoLock();
      setArmed(m.isAutoLockArmed());
      un = m.onAutoLockChange(setArmed);
    });
    return () => un?.();
  }, []);
  const toggle = () => {
    void import("@/lib/tractorAutoLock").then((m) => {
      const next = !m.isAutoLockArmed();
      m.setAutoLock(next);
      toast(
        next
          ? "Auto-lock armed — saved locks restore instantly; new material is scanned live"
          : "Auto-lock off",
      );
    });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      data-ui-sound="toggle"
      data-ui-on={armed ? "true" : "false"}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition flex items-center gap-3 ${
        armed
          ? "border-cyan/60 bg-cyan/10 shadow-[0_0_18px_rgba(34,232,255,0.15)]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
      title="When armed: a source with a saved lock restores instantly; new material is measured live (~9 s) and the full manifest engages automatically"
    >
      <span className={`text-lg ${armed ? "text-cyan" : "text-white/40"}`}>⟳</span>
      <span className="flex-1">
        <span className={`block text-sm font-semibold ${armed ? "text-cyan" : "text-white/70"}`}>
          Auto-lock {armed ? "ARMED" : "off"}
        </span>
        <span className="block text-[11px] text-dim">
          Restores saved locks instantly · scans only new material
        </span>
      </span>
      <span className={`kc-toggle ${armed ? "kc-on" : ""}`} />
    </button>
  );
}

function MissionPresetPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const active = getTargetProfile(value);
  return (
    <div className={disabled ? "opacity-40 pointer-events-none" : undefined}>
      <div className="text-xs uppercase tracking-[0.3em] text-dim mb-1.5">
        Mission preset{disabled ? " — reference overrides" : ""}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TARGET_PROFILES.map((t) => {
          const sel = t.id === active.id;
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => onChange(t.id)}
              aria-pressed={sel}
              title={t.blurb}
              className={`kc-chip uppercase tracking-[0.12em] ${sel ? "kc-on" : ""}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-dim mt-1.5 leading-relaxed">{active.blurb}</p>
    </div>
  );
}

function AbCompareButton({ applied, playing }: { applied: boolean; playing: boolean }) {
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  const release = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    useEqStore.getState().syncEngine();
  }, []);

  const engage = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!applied || holdingRef.current) return;
      holdingRef.current = true;
      setHolding(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture unsupported — release paths below still cover us */
      }
      getEngine().setUserEQBands([]);
    },
    [applied],
  );

  useEffect(() => {
    const onBlur = () => release();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      release();
    };
  }, [release]);

  const title = !applied
    ? "Engage the lock first — then hold to compare with/without the applied curve"
    : playing
      ? "Hold: Sculptor EQ bypassed (flat). Release: applied curve restored."
      : "Hold to bypass the applied Sculptor EQ — play a track to hear the difference";

  return (
    <button
      type="button"
      disabled={!applied}
      onPointerDown={engage}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat && applied && !holdingRef.current) {
          holdingRef.current = true;
          setHolding(true);
          getEngine().setUserEQBands([]);
        }
      }}
      onKeyUp={release}
      onBlur={release}
      title={title}
      aria-pressed={holding}
      className={`select-none rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40 ${
        holding
          ? "border-amber/70 bg-amber/15 text-amber shadow-[0_0_18px_rgba(251,191,36,0.3)]"
          : "border-white/15 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
    >
      {holding ? "Sculptor bypassed — release to restore" : "A/B · hold to bypass Sculptor"}
    </button>
  );
}

// ── Lock Library (timeline · search · favorites · packs) ───────────────────

function LockLibraryPanel({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: (rec: LockRecord) => void;
}) {
  const records = useLockLibraryStore((s) => s.records);
  const applyRecord = useLockLibraryStore((s) => s.applyRecord);
  const toggleFavorite = useLockLibraryStore((s) => s.toggleFavorite);
  const remove = useLockLibraryStore((s) => s.remove);
  const exportPack = useLockLibraryStore((s) => s.exportPack);
  const importPack = useLockLibraryStore((s) => s.importPack);
  const toast = useUIStore((s) => s.toast);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    const all = Object.values(records).sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    const q = query.trim().toLowerCase();
    return q
      ? all.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.sub.toLowerCase().includes(q) ||
            (r.contentLabel ?? "").toLowerCase().includes(q),
        )
      : all;
  }, [records, query]);

  const count = Object.keys(records).length;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center justify-between text-sm font-semibold"
      >
        <span>⛬ Lock Library ({count})</span>
        <span className="text-dim text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                setQuery("");
              }}
              placeholder="Search locks…"
              className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-cyan/50 transition"
            />
            <button
              type="button"
              onClick={() => {
                if (typeof window.playground?.files?.save !== "function") {
                  toast("Exporting locks needs the desktop app");
                  return;
                }
                void exportPack().then((ok) => ok && toast("Lock pack exported", "success"));
              }}
              disabled={count === 0}
              className="kc-btn kc-btn--ghost kc-btn--sm"
              title={
                typeof window.playground?.files?.save !== "function"
                  ? "Exporting locks needs the desktop app"
                  : "Export every lock as a .klock pack"
              }
            >
              ↥
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window.playground?.files?.openText !== "function") {
                  toast("Importing locks needs the desktop app");
                  return;
                }
                void importPack().then((n) => {
                  if (n === null) return;
                  toast(
                    n > 0 ? `Imported ${n} lock${n === 1 ? "" : "s"}` : "No locks found in that file",
                    n > 0 ? "success" : "warn",
                  );
                });
              }}
              className="kc-btn kc-btn--ghost kc-btn--sm"
              title={
                typeof window.playground?.files?.openText !== "function"
                  ? "Importing locks needs the desktop app"
                  : "Import a .klock pack"
              }
            >
              ↧
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto sidebar-scroll flex flex-col gap-0.5">
            {list.map((r) => (
              <div
                key={r.key}
                className="group rounded-lg px-2 py-1.5 hover:bg-cyan/[0.07] transition"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => toggleFavorite(r.key)}
                    className={`shrink-0 text-xs transition ${r.favorite ? "text-amber" : "text-white/25 hover:text-white/60"}`}
                    title={r.favorite ? "Unfavorite" : "Favorite — survives library cleanup"}
                  >
                    ★
                  </button>
                  <button
                    onClick={() =>
                      void applyRecord(r.key).then((ok) =>
                        toast(
                          ok ? `Lock restored — ${r.name}` : "That lock is gone",
                          ok ? "success" : "warn",
                        ),
                      )
                    }
                    disabled={disabled}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                    title={`Apply this lock now\n${r.matchBeforePct}% → ${r.matchAfterPct}% · ${getTargetProfile(r.targetId).label} · strength ${Math.round(r.strength * 100)}%`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs truncate">{r.name}</span>
                      <span className="text-[10px] text-dim shrink-0">{fmtAgo(r.updatedAt)}</span>
                    </div>
                    <div className="text-[10px] text-dim tabular-nums truncate">
                      {r.matchBeforePct}%→{r.matchAfterPct}%
                      {r.contentLabel ? ` · ${r.contentLabel}` : ""} ·{" "}
                      {r.kind === "airspace" ? "Airspace" : r.kind === "track" ? "Library" : "Live"}
                    </div>
                  </button>
                  <button
                    onClick={() => onOpen(r)}
                    disabled={disabled}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-wide text-cyan/80 hover:text-cyan transition disabled:opacity-30"
                    title="Open in the console — re-voice or force a re-scan from here"
                  >
                    open
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      remove(r.key);
                      toast(`Deleted lock "${r.name}"`);
                    }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-white/30 hover:text-rose-300 text-xs transition"
                    title="Delete this lock"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {list.length === 0 && (
              <div className="text-[11px] text-dim px-2 py-2">
                {count === 0
                  ? "No locks yet — engage one and it lands here, keyed to its source."
                  : "No matches."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Library picker ──────────────────────────────────────────────────────────

function LibraryPicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (path: string, name: string) => void;
}) {
  const tracks = useLibraryStore((s) => s.tracks);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? tracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q),
        )
      : tracks;
    return list.slice(0, 30);
  }, [tracks, query, open]);

  if (tracks.length === 0) {
    const desktop = !!window.playground?.library;
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
        <div className="text-sm font-semibold text-white/50">♬ From library</div>
        <p className="text-[11px] text-dim mt-0.5 leading-relaxed">
          {desktop
            ? "No Library tracks yet — add folders in Library, then pick one here."
            : "Library picker needs the desktop app."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="w-full px-3 py-2 flex items-center justify-between text-sm font-semibold disabled:opacity-50"
      >
        <span>♬ From library ({tracks.length})</span>
        <span className="text-dim text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 flex flex-col gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setQuery("");
            }}
            placeholder="Search title, artist, album…"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-cyan/50 transition"
          />
          <div className="max-h-44 overflow-y-auto sidebar-scroll flex flex-col">
            {matches.map((t) => (
              <button
                key={t.id}
                disabled={disabled}
                onClick={() => onPick(t.path, t.title || t.fileName)}
                className="text-left px-2 py-1.5 rounded-lg hover:bg-cyan/10 disabled:opacity-50 transition"
                title={`${t.title} — ${t.artist}`}
              >
                <div className="text-xs truncate">{t.title || t.fileName}</div>
                <div className="text-[10px] text-dim truncate">{t.artist}</div>
              </button>
            ))}
            {matches.length === 0 && (
              <div className="text-[11px] text-dim px-2 py-2">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty / error / stats ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] grid place-items-center p-4">
      <KCEmptyState
        className="w-full max-w-md"
        icon={<IconTractor width={40} height={40} />}
        title="No lock yet"
        hint="LOCK measures a loaded file (even if paused), a Library track, or ~20 s of whatever is playing. Nothing is applied until you Engage."
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="h-full min-h-[260px] grid place-items-center text-center">
      <div>
        <div className="text-5xl mb-3 opacity-70 text-plasma">⚠</div>
        <div className="text-lg font-semibold">Lock failed</div>
        <div className="text-sm text-dim mt-1 max-w-sm mx-auto leading-relaxed">{message}</div>
        <div className="text-[11px] text-dim mt-2">LOCK or pick another file to try again.</div>
      </div>
    </div>
  );
}

function Stat({ label, value, text, hint }: { label: string; value?: number; text?: string; hint?: string }) {
  const v = value ?? 0;
  const sign = value !== undefined && v > 0.05 ? "+" : "";
  const tone =
    value === undefined
      ? "rgba(255,255,255,0.85)"
      : v > 0.3
        ? "#22e8ff"
        : v < -0.3
          ? "#ff2bd6"
          : "rgba(255,255,255,0.6)";
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-center min-w-[78px]" title={hint}>
      <div className="text-[9px] uppercase tracking-[0.25em] text-dim">{label}</div>
      <div className="text-sm font-mono" style={{ color: tone }}>
        {text ?? `${sign}${v.toFixed(1)} dB`}
      </div>
    </div>
  );
}

function MatchStat({ before, after }: { before: number; after: number }) {
  return (
    <div className="rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-1.5 text-center min-w-[104px]">
      <div className="text-[9px] uppercase tracking-[0.25em] text-dim">Target match</div>
      <div className="text-sm font-mono">
        <span className="text-white/55">{before}%</span>
        <span className="text-dim mx-1">→</span>
        <span className="text-cyan">{after}%</span>
      </div>
    </div>
  );
}

// ── Editable band chart ─────────────────────────────────────────────────────

const CHART_HALF_PX = 70;
const DRAG_DB_PER_PX = 0.12;
const CLICK_SLOP_PX = 4;

function BandChart({
  manifest,
  ghostCurve,
  excluded,
  edited,
  onToggleBand,
  onEditBand,
}: {
  manifest: LockManifest;
  /** Veto-free curve — supplies heights for vetoed bars. */
  ghostCurve: { freq: number; db: number }[] | null;
  excluded: ReadonlySet<number>;
  edited: ReadonlyMap<number, number>;
  onToggleBand: (freq: number) => void;
  onEditBand: (freq: number, deltaDb: number) => void;
}) {
  const result = manifest.result;
  // Final per-band move: the manifest curve (strength/veto/edit applied).
  const curveDb = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of manifest.curve) map.set(p.freq, p.db);
    return map;
  }, [manifest.curve]);
  const ghostDb = useMemo(() => {
    if (!ghostCurve) return null;
    const map = new Map<number, number>();
    for (const p of ghostCurve) map.set(p.freq, p.db);
    return map;
  }, [ghostCurve]);

  // Drag-to-edit state.
  const dragRef = useRef<{ freq: number; lastY: number; moved: number } | null>(null);

  const spectrum = useMemo(() => {
    const n = result.bands.length;
    if (n < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    const afterOf = (i: number) => {
      const b = result.bands[i];
      return b.relDb + (curveDb.get(b.freq) ?? 0);
    };
    for (let i = 0; i < n; i++) {
      const b = result.bands[i];
      const after = afterOf(i);
      if (!Number.isFinite(b.relDb) || !Number.isFinite(after)) continue;
      lo = Math.min(lo, b.relDb, after);
      hi = Math.max(hi, b.relDb, after);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const span = Math.max(6, hi - lo);
    const toY = (db: number) => {
      const y = 6 + 88 * (1 - (db - lo) / span);
      return Number.isFinite(y) ? Math.max(2, Math.min(98, y)) : 50;
    };
    const toX = (i: number) => (100 * (i + 0.5)) / n;
    const before = result.bands
      .map((b, i) => `${toX(i).toFixed(2)},${toY(b.relDb).toFixed(2)}`)
      .join(" ");
    const after = result.bands
      .map((b, i) => `${toX(i).toFixed(2)},${toY(afterOf(i)).toFixed(2)}`)
      .join(" ");
    return { before, after };
  }, [result, curveDb]);

  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-3 overflow-hidden">
      <div className="relative overflow-hidden">
        <div className="flex items-end justify-between gap-px h-44">
          {result.bands.map((b) => {
            const color = freqColor(b.freq);
            const vetoed = excluded.has(b.freq);
            const isEdited = edited.has(b.freq);
            const shownDb = vetoed
              ? (ghostDb?.get(b.freq) ?? 0)
              : (curveDb.get(b.freq) ?? 0);
            const frac = Math.max(-1, Math.min(1, shownDb / TRACTOR_MOVE_CLAMP_DB));
            const h = Math.abs(frac) * CHART_HALF_PX;
            const up = frac >= 0;
            const barStyle: React.CSSProperties = vetoed
              ? {
                  height: `${h}px`,
                  background: "transparent",
                  border: `1px dashed ${color}`,
                  opacity: 0.38,
                }
              : up
                ? {
                    height: `${h}px`,
                    background: color,
                    boxShadow: isEdited ? `0 0 10px ${color}` : `0 0 6px ${color}55`,
                    outline: isEdited ? `1px solid rgba(255,255,255,0.7)` : undefined,
                  }
                : {
                    height: `${h}px`,
                    background: color,
                    opacity: 0.85,
                    outline: isEdited ? `1px solid rgba(255,255,255,0.7)` : undefined,
                  };
            return (
              <div
                key={b.freq}
                role="button"
                aria-pressed={vetoed}
                onPointerDown={(e) => {
                  dragRef.current = { freq: b.freq, lastY: e.clientY, moved: 0 };
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.freq !== b.freq) return;
                  const dy = e.clientY - d.lastY;
                  d.moved += Math.abs(dy);
                  if (d.moved > CLICK_SLOP_PX && dy !== 0) {
                    onEditBand(b.freq, -dy * DRAG_DB_PER_PX);
                  }
                  d.lastY = e.clientY;
                }}
                onPointerUp={() => {
                  const d = dragRef.current;
                  dragRef.current = null;
                  if (d && d.freq === b.freq && d.moved <= CLICK_SLOP_PX) {
                    onToggleBand(b.freq);
                  }
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                className="flex-1 min-w-0 flex flex-col items-center justify-end h-full cursor-ns-resize bg-transparent p-0 border-0 group touch-none select-none"
                title={
                  vetoed
                    ? `${fmtFreq(b.freq)} Hz · vetoed (0 dB) — click to re-enable`
                    : `${fmtFreq(b.freq)} Hz · ${shownDb > 0 ? "+" : ""}${shownDb.toFixed(1)} dB${isEdited ? " (edited)" : ""} — click to veto · drag to edit`
                }
              >
                <div className="flex-1 w-full flex flex-col items-center justify-end">
                  {up && <div className="w-full rounded-t group-hover:brightness-125" style={barStyle} />}
                </div>
                <div className={`w-full h-px ${vetoed ? "bg-white/8" : "bg-white/15"}`} />
                <div className="flex-1 w-full flex flex-col items-center justify-start">
                  {!up && <div className="w-full rounded-b group-hover:brightness-125" style={barStyle} />}
                </div>
              </div>
            );
          })}
        </div>
        {spectrum && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ overflow: "hidden" }}
          >
            <polyline
              points={spectrum.before}
              fill="none"
              stroke="rgba(255,255,255,0.30)"
              strokeWidth="0.8"
              strokeDasharray="2 1.6"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={spectrum.after}
              fill="none"
              stroke="rgba(34,232,255,0.75)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      <div className="mt-2 flex justify-between text-[8px] text-dim tabular-nums px-0.5">
        {[30, 100, 300, 1000, 3000, 10000].map((f) => (
          <span key={f}>{fmtFreq(f)}</span>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] text-dim">
        <span>Click to veto · drag to hand-edit</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t border-dashed border-white/40" /> measured
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t border-cyan/80" /> predicted after
        </span>
      </div>
    </div>
  );
}
