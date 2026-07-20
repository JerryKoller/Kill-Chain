import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ActionBar } from "@/components/shared/ActionBar";
import { useAudioStore } from "@/state/audioStore";
import { useSettingsStore } from "@/state/settingsStore";
import { usePlayerStore } from "@/state/playerStore";
import { useUIStore } from "@/state/uiStore";
import { useAirspaceStore } from "@/state/airspaceStore";
import { useLibraryStore, audioUrlForPath } from "@/state/libraryStore";
import { getEngine } from "@/audio/AudioEngine";
import { HEADPHONES } from "@/audio/headphoneProfiles";
import { useEqStore } from "@/state/eqStore";
import {
  measureTrack,
  deriveCorrection,
  sampleCurveDb,
  getTargetProfile,
  TARGET_PROFILES,
  DEFAULT_TARGET_ID,
  TRACTOR_MOVE_CLAMP_DB,
  TRACTOR_MAX_STRENGTH,
  type TractorMeasurement,
  type TractorResult,
} from "@/lib/tractorBeam";
import { measureLive } from "@/lib/tractorLive";

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

// ── Persistence (own keys, defensive parsing) ─────────────────────────────

const PREFS_KEY = "audio-playground.tractorPrefs.v1";
const HISTORY_KEY = "audio-playground.tractorHistory.v1";
const HISTORY_MAX = 5;

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
      // Unknown ids collapse to the reference profile.
      targetId: getTargetProfile(typeof p.targetId === "string" ? p.targetId : undefined).id,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

// Debounced — the strength slider fires per pointermove and a synchronous
// localStorage write per event would jank the drag.
let prefsTimer: ReturnType<typeof setTimeout> | null = null;
function persistPrefs(prefs: TractorPrefs): void {
  if (typeof window === "undefined") return;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, 300);
}

/** One remembered analysis — the measurement is enough to re-derive fully. */
interface HistoryEntry {
  id: string;
  name: string;
  at: number;
  measurement: TractorMeasurement;
  /** Controls in effect when it was captured (restored with the entry). */
  targetId: string;
  strength: number;
  excluded: number[];
  /** Headline stats snapshot for the list row. */
  matchBeforePct: number;
  matchAfterPct: number;
  confidencePct: number;
}

function newEntryId(): string {
  return `tb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isNumArray(a: unknown): a is number[] {
  return Array.isArray(a) && a.every((x) => typeof x === "number" && Number.isFinite(x));
}

function sanitizeEntry(e: unknown): HistoryEntry | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const m = o.measurement as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return null;
  if (!isNumArray(m.centers) || !isNumArray(m.levelsDb)) return null;
  if (m.centers.length === 0 || m.centers.length !== m.levelsDb.length) return null;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const measurement: TractorMeasurement = {
    sampleRate: num(m.sampleRate, 44100),
    analyzedSec: num(m.analyzedSec, 0),
    windowsUsed: num(m.windowsUsed, 1),
    centers: m.centers,
    levelsDb: m.levelsDb,
    silent: m.silent === true,
  };
  return {
    id: typeof o.id === "string" ? o.id : newEntryId(),
    name: typeof o.name === "string" && o.name ? o.name : "Unknown track",
    at: num(o.at, Date.now()),
    measurement,
    targetId: getTargetProfile(typeof o.targetId === "string" ? o.targetId : undefined).id,
    strength: Math.max(0, Math.min(TRACTOR_MAX_STRENGTH, num(o.strength, 1))),
    excluded: isNumArray(o.excluded) ? o.excluded : [],
    matchBeforePct: num(o.matchBeforePct, 0),
    matchAfterPct: num(o.matchAfterPct, 0),
    confidencePct: num(o.confidencePct, 0),
  };
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(sanitizeEntry)
      .filter((x): x is HistoryEntry => x !== null)
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function persistHistory(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

// ── View ──────────────────────────────────────────────────────────────────

export function TractorBeamView() {
  const correctionEnabled = useAudioStore((s) => s.correctionEnabled);
  const headphoneId = useSettingsStore((s) => s.headphone);
  const headphone = HEADPHONES[headphoneId] ?? HEADPHONES.xm6;
  const playerEl = usePlayerStore((s) => s.element);
  const playerMeta = usePlayerStore((s) => s.metadata);
  const playerStatus = usePlayerStore((s) => s.status);
  const loopbackActive = usePlayerStore((s) => s.loopbackActive);
  // Airspace's Cinema/Music switch steers Smart Lock: the user has already
  // declared what kind of media they're playing.
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
  /** Name of the track the CURRENT measurement belongs to (readout header).
   *  Kept separate from trackName so a cancelled re-analysis can't relabel
   *  the previous result with the new track's name. */
  const [resultName, setResultName] = useState<string | null>(null);
  /** The media TITLE fed to the classifier (video title, track title…). */
  const [titleHint, setTitleHint] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<TractorMeasurement | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [applied, setApplied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Live refs so async completion handlers snapshot the CURRENT controls.
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

  // Cancel any in-flight analysis when the view unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The full recommendation, re-derived instantly from the measurement
  // whenever strength / target / vetoes / voicing context change.
  const result: TractorResult | null = useMemo(
    () =>
      measurement
        ? deriveCorrection(measurement, {
            headphone,
            correctionEnabled,
            strength,
            targetId,
            excluded,
            mediaHint,
            titleHint,
          })
        : null,
    [measurement, headphone, correctionEnabled, strength, targetId, excluded, mediaHint, titleHint],
  );

  // Same derivation without vetoes — gives vetoed bars a "ghost" height so
  // the user can see (and click back) what they turned off.
  const ghost: TractorResult | null = useMemo(
    () =>
      measurement && excluded.size > 0
        ? deriveCorrection(measurement, { headphone, correctionEnabled, strength, targetId, mediaHint, titleHint })
        : null,
    [measurement, headphone, correctionEnabled, strength, targetId, excluded, mediaHint, titleHint],
  );

  const pushHistory = useCallback(
    (name: string, m: TractorMeasurement) => {
      if (m.silent) return;
      const snap = deriveCorrection(m, {
        headphone,
        correctionEnabled,
        strength: strengthRef.current,
        targetId: targetIdRef.current,
      });
      const entry: HistoryEntry = {
        id: newEntryId(),
        name,
        at: Date.now(),
        measurement: {
          ...m,
          // Trim stored precision — 0.01 dB is far beyond audibility.
          levelsDb: m.levelsDb.map((v) => Math.round(v * 100) / 100),
        },
        targetId: targetIdRef.current,
        strength: strengthRef.current,
        excluded: [],
        matchBeforePct: snap.matchBeforePct,
        matchAfterPct: snap.matchAfterPct,
        confidencePct: snap.confidencePct,
      };
      setHistory((prev) => {
        const next = [entry, ...prev.filter((p) => p.name !== name)].slice(0, HISTORY_MAX);
        persistHistory(next);
        return next;
      });
    },
    [headphone, correctionEnabled],
  );

  const runAnalysis = useCallback(
    async (buffer: AudioBuffer, name: string, ac: AbortController) => {
      setStatus("Scanning spectrum…");
      setTrackName(name);
      try {
        const m = await measureTrack(buffer, {
          signal: ac.signal,
          onProgress: (p) => {
            // A superseded run must not fight the active run's progress UI.
            if (abortRef.current !== ac) return;
            setStatus(p.stage);
            setProgress(p.fraction);
          },
        });
        // The scan can resolve normally if abort landed after its last
        // checkpoint — route that through the cancel path.
        if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
        setMeasurement(m);
        setResultName(name);
        setTitleHint(name);
        setExcluded(new Set());
        setError(null);
        setStatus("");
        if (m.silent) {
          toast("Track appears silent — nothing to correct");
        } else {
          pushHistory(name, m);
          toast("Spectral lock acquired");
        }
      } catch (err) {
        // Only the ACTIVE run may touch shared UI state; a run that was
        // replaced by a newer analysis (or a history restore) stays silent.
        if (abortRef.current !== ac) return;
        if ((err as DOMException)?.name === "AbortError") {
          toast("Analysis cancelled");
        } else {
          console.error("[tractor] analysis failed:", err);
          setError("Analysis failed — the file decoded but could not be scanned. Try another track.");
          toast("Analysis failed — try another file");
        }
        setStatus("");
      } finally {
        if (abortRef.current === ac) {
          setBusy(false);
          setProgress(0);
        }
      }
    },
    [toast, pushHistory],
  );

  /** Decode a source (URL or ArrayBuffer) then analyze — shared entry point. */
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
        if (abortRef.current !== ac) return; // superseded — stay silent
        if ((err as DOMException)?.name === "AbortError") {
          toast("Analysis cancelled");
        } else {
          console.error("[tractor] decode failed:", err);
          setError("Couldn't read that track — the file may be corrupt or an unsupported format.");
          toast("Couldn't read that track");
        }
        setBusy(false);
        setStatus("");
        setProgress(0);
      }
    },
    [runAnalysis, toast],
  );

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * LIVE LOCK — listen to whatever is playing through the engine right now
   * (local track, Exterior Audio, an Airspace movie) for ~20 s and lock onto
   * it. This is how film/TV in the browser gets a real measurement.
   */
  const onLiveLock = useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const p = usePlayerStore.getState();
    // Best available TITLE for the classifier: the Airspace video title when
    // the browser is the source, else the loaded track's title.
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
        setExcluded(new Set());
        setError(null);
        setStatus("");
        if (m.silent) {
          toast("Heard nothing — start playback, then run Live Lock again");
        } else {
          pushHistory(name, m);
          toast("Live spectral lock acquired");
        }
      } catch (err) {
        if (abortRef.current !== ac) return;
        if ((err as DOMException)?.name === "AbortError") {
          toast("Live lock cancelled");
        } else {
          console.error("[tractor] live lock failed:", err);
          setError("Live lock failed — the engine tap could not be read.");
        }
        setStatus("");
      } finally {
        if (abortRef.current === ac) {
          setBusy(false);
          setProgress(0);
        }
      }
    })();
  }, [toast, pushHistory]);

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

  const toggleBand = useCallback((freq: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(freq)) next.delete(freq);
      else next.add(freq);
      return next;
    });
  }, []);

  const clearVetoes = useCallback(() => setExcluded(new Set()), []);

  const restoreEntry = useCallback(
    (entry: HistoryEntry) => {
      // Abort AND detach any in-flight run so its late handlers can't clobber
      // the restored state or flash a "cancelled" toast over ours.
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      setStatus("");
      setProgress(0);
      setError(null);
      setTrackName(entry.name);
      setResultName(entry.name);
      setTitleHint(entry.name);
      setMeasurement(entry.measurement);
      setStrengthRaw(entry.strength);
      setTargetIdRaw(entry.targetId);
      setExcluded(new Set(entry.excluded));
      persistPrefs({ strength: entry.strength, targetId: entry.targetId });
      toast(`Restored analysis — ${entry.name}`);
    },
    [toast],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    persistHistory([]);
  }, []);

  const applyResult = useCallback(() => {
    if (!result) return;
    if (result.silent) {
      toast("Nothing to apply — the track was silent");
      return;
    }
    // Map the detailed correction curve onto WHATEVER bands the user has — each
    // band is retuned at its own frequency, so a 3-band or 20-band Sculptor both
    // get the right match without changing the band count or layout.
    const n = useEqStore.getState().bands.length;
    useEqStore.getState().applyGainCurve((f) => sampleCurveDb(result.curve, f));
    setApplied(true);
    toast(`Tractor Beam matched ${n} band${n === 1 ? "" : "s"}`);
  }, [result, toast]);

  /** EQ curve + the beyond-EQ moves (dynamics / width / de-ess) in one shot. */
  const applyFullChain = useCallback(() => {
    if (!result || result.silent) return;
    useEqStore.getState().applyGainCurve((f) => sampleCurveDb(result.curve, f));
    if (Object.keys(result.masterMoves).length > 0) {
      useAudioStore.getState().setParams(result.masterMoves);
    }
    setApplied(true);
    toast("Full-chain lock engaged — EQ, dynamics and image");
  }, [result, toast]);

  const saveResult = useCallback(() => {
    if (!result || result.silent) return;
    const base = (resultName || "Tractor").replace(/\.[^.]+$/, "").slice(0, 28);
    void import("@/state/userPresetsStore").then(({ useUserPresetsStore }) => {
      useUserPresetsStore.getState().savePreset(`Beam · ${base}`, result.params);
      toast(`Saved preset "Beam · ${base}"`);
    });
  }, [result, resultName, toast]);

  const targetProfile = getTargetProfile(targetId);

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Tractor Beam"
        code="KC-03"
        subtitle="Lock onto a target — reads what it IS (film, music, speech), then voices EQ + dynamics for it and your headphones"
      />

      <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={onFile} />

      <div className="grid grid-cols-12 gap-3">
        {/* ── Source + engage ── */}
        <GlassPanel intense className="col-span-12 lg:col-span-5 p-5 flex flex-col gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-dim">Target</div>
            <div className="text-xl font-semibold">Acquire a track</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onPickFile}
              disabled={busy}
              className="rounded-xl border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 disabled:opacity-50 px-3 py-3 text-sm font-semibold text-cyan transition"
            >
              ＋ Load a file
            </button>
            <button
              onClick={onUseCurrent}
              disabled={busy}
              className="rounded-xl border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50 px-3 py-3 text-sm font-semibold transition"
            >
              ♪ Use current track
            </button>
            <button
              onClick={onLiveLock}
              disabled={busy}
              className="col-span-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 px-3 py-3 text-sm font-semibold text-emerald-300 transition"
              title="Listen to whatever is playing RIGHT NOW — a movie in Airspace, Exterior Audio, or the current track — for ~20 seconds and lock onto it"
            >
              ◉ Live lock — listen to what's playing
            </button>
          </div>
          {loopbackActive && (
            <div className="text-[11px] text-emerald-300/80 -mt-2">
              Exterior audio is flowing — Live Lock will read exactly what you hear.
            </div>
          )}

          <AutoLockToggle />

          <LibraryPicker disabled={busy} onPick={onLibraryTrack} />

          {trackName && (
            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.25em] text-dim">Locked target</div>
              <div className="text-sm font-medium truncate" title={trackName}>{trackName}</div>
            </div>
          )}

          <TargetProfilePicker value={targetId} onChange={setTargetId} />

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs uppercase tracking-[0.3em] text-dim">Correction strength</div>
              <div className="text-sm font-mono text-cyan">{Math.round(strength * 100)}%</div>
            </div>
            <div className="relative">
              <input
                type="range"
                min={0}
                max={TRACTOR_MAX_STRENGTH}
                step={0.05}
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                className="w-full relative z-10"
                style={{ accentColor: "#22e8ff" }}
                aria-label="Correction strength"
              />
              <div
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-3.5 w-px bg-white/35"
                style={{ left: `${(1 / TRACTOR_MAX_STRENGTH) * 100}%` }}
                title="100% — recommended"
              />
            </div>
            <div className="flex justify-between text-[10px] text-dim tabular-nums">
              <span>0%</span>
              <span>100% = recommended</span>
              <span>150%</span>
            </div>
            <p className="text-[11px] text-dim mt-1 leading-relaxed">
              Scales the recommended moves — the preview, match % and stats update live
              without re-scanning the track.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.25em] text-dim">Voiced for</div>
            <div className="text-sm font-medium">{headphone.name}</div>
            <div className="text-[11px] text-dim mt-0.5">
              {correctionEnabled
                ? "Correction ON — assuming a flat baseline."
                : "Correction OFF — compensating the headphone's own colour."}
            </div>
          </div>

          {busy && (
            <div className="rounded-xl border border-cyan/25 bg-cyan/[0.06] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm text-cyan">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 inline-block w-4 h-4 rounded-full border-2 border-cyan/30 border-t-cyan animate-spin" />
                  <span className="truncate">{status || "Working…"}</span>
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  <span className="text-[11px] font-mono text-cyan/80 tabular-nums">
                    {Math.round(progress * 100)}%
                  </span>
                  <button
                    onClick={cancelAnalysis}
                    className="rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70 hover:text-white hover:bg-white/10 transition"
                  >
                    Cancel
                  </button>
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan transition-[width] duration-200"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          <HistoryList
            entries={history}
            disabled={busy}
            onRestore={restoreEntry}
            onClear={clearHistory}
          />
        </GlassPanel>

        {/* ── Readout ── */}
        <GlassPanel intense className="col-span-12 lg:col-span-7 p-5">
          {!result ? (
            error ? (
              <ErrorState message={error} />
            ) : (
              <EmptyState />
            )
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.3em] text-dim">Spectral lock</div>
                  <div className="text-xl font-semibold truncate" title={resultName ?? undefined}>
                    {resultName || "Analysis complete"}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Stat
                    label="Target"
                    text={
                      result.targetId === "smart"
                        ? `Smart → ${getTargetProfile(result.resolvedTargetId).label}`
                        : getTargetProfile(result.resolvedTargetId).label
                    }
                  />
                  <MatchStat before={result.matchBeforePct} after={result.matchAfterPct} />
                  <Stat label="Confidence" text={`${result.confidencePct}%`} />
                  <Stat label="Bass EQ" value={result.bassMoveDb} />
                  <Stat label="Treble EQ" value={result.trebleMoveDb} />
                </div>
              </div>

              {/* What the analyzer read the content as (v4 fingerprint). */}
              {result.content && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 flex items-start gap-3 -mt-1">
                  <div className="shrink-0 rounded-lg border border-cyan/30 bg-cyan/10 px-2.5 py-1.5 text-center">
                    <div className="text-[9px] uppercase tracking-[0.25em] text-dim">Read as</div>
                    <div className="text-sm font-semibold text-cyan">{result.content.label}</div>
                    <div className="text-[8px] uppercase tracking-[0.2em] text-dim mt-0.5">
                      {result.content.via === "audio+title"
                        ? "audio + title"
                        : result.content.via === "title"
                          ? "from title"
                          : "from audio"}
                    </div>
                  </div>
                  <div className="text-[11px] text-dim leading-relaxed pt-0.5">
                    {result.content.blurb}
                    {mediaHint && (
                      <span className="text-cyan/80"> Airspace says {mediaHint} — Smart Lock honours it.</span>
                    )}
                    {measurement?.crestDb !== undefined && (
                      <span className="block mt-0.5 tabular-nums text-white/45">
                        crest {measurement.crestDb.toFixed(1)} dB · dynamics ±{(measurement.dynRangeDb ?? 0).toFixed(1)} dB
                        {measurement.stereoCorr != null && <> · L/R corr {measurement.stereoCorr.toFixed(2)}</>}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <BandChart
                result={result}
                ghost={ghost ?? result}
                excluded={excluded}
                onToggleBand={toggleBand}
              />

              {excluded.size > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-dim -mt-2">
                  <span>
                    {excluded.size} band{excluded.size === 1 ? "" : "s"} vetoed — hollow bars
                    contribute 0 dB.
                  </span>
                  <button
                    onClick={clearVetoes}
                    className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em] text-white/70 hover:text-white hover:bg-white/10 transition"
                  >
                    Restore all
                  </button>
                </div>
              )}

              {/* Beyond-EQ moves the fingerprint recommends. */}
              {result.masterNotes.length > 0 && (
                <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-1">
                    Full-chain recommendations
                  </div>
                  <ul className="text-[11px] text-white/75 leading-relaxed list-disc list-inside">
                    {result.masterNotes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={applyFullChain}
                  disabled={result.silent}
                  className="rounded-xl border border-cyan/60 bg-cyan/15 hover:bg-cyan/25 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-cyan shadow-[0_0_22px_rgba(34,232,255,0.3)] transition"
                  title="Apply the EQ match AND the recommended dynamics / width / de-ess moves"
                >
                  ⚡ Engage full chain
                </button>
                <button
                  onClick={applyResult}
                  disabled={result.silent}
                  className="rounded-xl border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 px-4 py-2.5 text-sm font-semibold transition"
                  title="Apply only the EQ curve onto your Sculptor bands"
                >
                  EQ only
                </button>
                <button
                  onClick={saveResult}
                  disabled={result.silent}
                  className="rounded-xl border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 px-4 py-2.5 text-sm font-semibold transition"
                >
                  Save as preset
                </button>
                <AbCompareButton applied={applied} playing={playerStatus === "playing"} />
                <div className="text-[11px] text-dim">
                  Analyzed {result.analyzedSec.toFixed(0)}s · {result.windowsUsed} windows
                  {Math.abs(result.trimDb) > 0.05 && (
                    <> · level trim {result.trimDb > 0 ? "+" : ""}{result.trimDb.toFixed(1)} dB</>
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
            <span className="text-cyan font-semibold">1 · Scan</span> — the WHOLE track is
            measured offline: ~100 FFT windows spread start-to-finish are averaged
            (silence skipped) into a 1/3-octave spectrum, so one loud chorus or a quiet
            intro can't skew the reading.
          </li>
          <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <span className="text-cyan font-semibold">2 · Compare</span> — that balance is
            matched against the selected target profile ({targetProfile.label.toLowerCase()})
            with loudness weighting, smoothed into a correction curve, level-trimmed for a
            fair A/B, then voiced for your {headphone.name}. Strength, target and band
            vetoes re-derive instantly from the same scan.
          </li>
          <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <span className="text-cyan font-semibold">3 · Apply</span> — the curve is mapped onto
            however many Sculptor bands you have (1-20), retuning each at its own frequency, or
            saved as a preset for that kind of music.
          </li>
        </ol>
      </GlassPanel>
    </div>
  );
}

/**
 * AUTO-LOCK — hands-free re-lock whenever the playing track/video changes.
 * The armed state lives in tractorAutoLock (module-level, persisted) so it
 * keeps working with this view closed.
 */
function AutoLockToggle() {
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
    void import("@/lib/tractorAutoLock").then((m) => m.setAutoLock(!m.isAutoLockArmed()));
  };
  return (
    <button
      onClick={toggle}
      data-ui-sound="toggle"
      data-ui-on={armed ? "true" : "false"}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition flex items-center gap-3 ${
        armed
          ? "border-cyan/60 bg-cyan/10 shadow-[0_0_18px_rgba(34,232,255,0.15)]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
      title="When armed, every new track or Airspace video is measured live (~9 s) and the full chain re-locks automatically"
    >
      <span className={`text-lg ${armed ? "text-cyan" : "text-white/40"}`}>⟳</span>
      <span className="flex-1">
        <span className={`block text-sm font-semibold ${armed ? "text-cyan" : "text-white/70"}`}>
          Auto-lock {armed ? "ARMED" : "off"}
        </span>
        <span className="block text-[11px] text-dim">
          Re-locks the full chain whenever the track or video changes
        </span>
      </span>
      <span
        className={`w-9 h-5 rounded-full relative transition ${armed ? "bg-cyan/60" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
            armed ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/** Selectable correction target — reference plus four voiced alternatives. */
function TargetProfilePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const active = getTargetProfile(value);
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-dim mb-1.5">Target profile</div>
      <div className="flex flex-wrap gap-1.5">
        {TARGET_PROFILES.map((t) => {
          const sel = t.id === active.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              aria-pressed={sel}
              title={t.blurb}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
                sel
                  ? "border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_14px_rgba(34,232,255,0.25)]"
                  : "border-white/15 bg-white/[0.03] text-white/65 hover:bg-white/[0.07] hover:text-white/90"
              }`}
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

/**
 * Hold-to-compare: while held, the Sculptor EQ stack is bypassed in the
 * engine (flat); on release the Sculptor state is re-synced. Compares the
 * APPLIED Sculptor curve against no Sculptor EQ — enabled after "Apply to
 * Sculptor" so the comparison is always real.
 */
function AbCompareButton({ applied, playing }: { applied: boolean; playing: boolean }) {
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  const release = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    // Restore the engine from the Sculptor store — the store is never
    // touched by the hold, so this cannot drift.
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

  // Never leave the bypass stuck: restore on unmount or window blur.
  useEffect(() => {
    const onBlur = () => release();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      release();
    };
  }, [release]);

  const title = !applied
    ? "Apply to Sculptor first — then hold to compare with/without the applied curve"
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

/** Last few analyses — click to restore the full result without re-scanning. */
function HistoryList({
  entries,
  disabled,
  onRestore,
  onClear,
}: {
  entries: HistoryEntry[];
  disabled: boolean;
  onRestore: (e: HistoryEntry) => void;
  onClear: () => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-dim">
          Recent locks ({entries.length})
        </div>
        <button
          onClick={onClear}
          disabled={disabled}
          className="text-[10px] uppercase tracking-[0.15em] text-dim hover:text-white/80 disabled:opacity-50 transition"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((e) => (
          <button
            key={e.id}
            disabled={disabled}
            onClick={() => onRestore(e)}
            className="text-left rounded-lg px-2 py-1.5 hover:bg-cyan/10 disabled:opacity-50 transition"
            title={`Restore this analysis (target: ${getTargetProfile(e.targetId).label}, strength ${Math.round(e.strength * 100)}%)`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs truncate">{e.name}</span>
              <span className="text-[10px] text-dim shrink-0">{fmtAgo(e.at)}</span>
            </div>
            <div className="text-[10px] text-dim tabular-nums">
              match {e.matchBeforePct}%→{e.matchAfterPct}% · conf {e.confidencePct}% ·{" "}
              {getTargetProfile(e.targetId).label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Compact library search + pick list so ANY library track can be analyzed. */
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

  if (tracks.length === 0) return null;

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

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] grid place-items-center text-center">
      <div>
        <div className="text-5xl mb-3 opacity-70">◉</div>
        <div className="text-lg font-semibold">No target acquired</div>
        <div className="text-sm text-dim mt-1 max-w-sm mx-auto leading-relaxed">
          Load a track, pick one from your library, or use the one that's playing.
          Tractor Beam will read its tonal balance and craft a matching EQ for
          your headphones.
        </div>
      </div>
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
      </div>
    </div>
  );
}

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
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
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-center min-w-[78px]">
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

function BandChart({
  result,
  ghost,
  excluded,
  onToggleBand,
}: {
  result: TractorResult;
  /** Same derivation with NO vetoes — supplies heights for vetoed bars. */
  ghost: TractorResult;
  excluded: ReadonlySet<number>;
  onToggleBand: (freq: number) => void;
}) {
  const half = 70; // px each direction

  // Before / after spectrum overlay (relative dB → chart Y in %).
  const spectrum = useMemo(() => {
    const n = result.bands.length;
    if (n < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of result.bands) {
      if (!Number.isFinite(b.relDb) || !Number.isFinite(b.afterDb)) continue;
      lo = Math.min(lo, b.relDb, b.afterDb);
      hi = Math.max(hi, b.relDb, b.afterDb);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const span = Math.max(6, hi - lo);
    // Hard-clamp every point into the viewBox so the overlay can never paint
    // outside the chart, whatever the data does.
    const toY = (db: number) => {
      const y = 6 + 88 * (1 - (db - lo) / span);
      return Number.isFinite(y) ? Math.max(2, Math.min(98, y)) : 50;
    };
    const toX = (i: number) => (100 * (i + 0.5)) / n;
    const mk = (get: (b: (typeof result.bands)[number]) => number) =>
      result.bands.map((b, i) => `${toX(i).toFixed(2)},${toY(get(b)).toFixed(2)}`).join(" ");
    return { before: mk((b) => b.relDb), after: mk((b) => b.afterDb) };
  }, [result]);

  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-3 overflow-hidden">
      <div className="relative overflow-hidden">
        <div className="flex items-end justify-between gap-px h-44">
          {result.bands.map((b, i) => {
            const color = freqColor(b.freq);
            const vetoed = excluded.has(b.freq);
            // Vetoed bands contribute 0 dB — draw the move they WOULD make
            // (from the veto-free derivation) as a hollow ghost bar.
            const shownDb = vetoed ? (ghost.bands[i]?.moveDb ?? 0) : b.moveDb;
            const frac = Math.max(-1, Math.min(1, shownDb / TRACTOR_MOVE_CLAMP_DB));
            const h = Math.abs(frac) * half;
            const up = frac >= 0;
            const barStyle: React.CSSProperties = vetoed
              ? {
                  height: `${h}px`,
                  background: "transparent",
                  border: `1px dashed ${color}`,
                  opacity: 0.38,
                }
              : up
                ? { height: `${h}px`, background: color, boxShadow: `0 0 6px ${color}55` }
                : { height: `${h}px`, background: color, opacity: 0.85 };
            return (
              <button
                key={b.freq}
                type="button"
                onClick={() => onToggleBand(b.freq)}
                aria-pressed={vetoed}
                className="flex-1 min-w-0 flex flex-col items-center justify-end h-full cursor-pointer bg-transparent p-0 border-0 group"
                title={
                  vetoed
                    ? `${fmtFreq(b.freq)} Hz · vetoed (0 dB) — click to re-enable`
                    : `${fmtFreq(b.freq)} Hz · ${b.moveDb > 0 ? "+" : ""}${b.moveDb.toFixed(1)} dB — click to veto`
                }
              >
                <div className="flex-1 w-full flex flex-col items-center justify-end">
                  {up && <div className="w-full rounded-t group-hover:brightness-125" style={barStyle} />}
                </div>
                <div className={`w-full h-px ${vetoed ? "bg-white/8" : "bg-white/15"}`} />
                <div className="flex-1 w-full flex flex-col items-center justify-start">
                  {!up && <div className="w-full rounded-b group-hover:brightness-125" style={barStyle} />}
                </div>
              </button>
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
        <span>Bars · correction (peak {result.maxMoveDb.toFixed(1)} dB) · click to veto</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t border-dashed border-white/40" /> before
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t border-cyan/80" /> after
        </span>
      </div>
    </div>
  );
}
