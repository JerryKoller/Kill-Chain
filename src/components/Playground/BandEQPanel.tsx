import { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { HistoryStrip } from "./HistoryStrip";
import { getEngine } from "@/audio/AudioEngine";
import { uiTick } from "@/audio/uiSounds";
import { useUIStore } from "@/state/uiStore";
import { useAudioStore } from "@/state/audioStore";
import {
  useEqStore,
  EQ_TYPES,
  EQ_MAX_BANDS,
  EQ_MIN_BANDS,
  EQ_GAIN_LIMIT,
  EQ_FREQ_MIN,
  EQ_FREQ_MAX,
  type EqBand,
} from "@/state/eqStore";

const DB_MIN = -EQ_GAIN_LIMIT;
const DB_MAX = EQ_GAIN_LIMIT;
const DECADES = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

const logF = (f: number) =>
  (Math.log10(f) - Math.log10(EQ_FREQ_MIN)) /
  (Math.log10(EQ_FREQ_MAX) - Math.log10(EQ_FREQ_MIN));
const freqToX = (f: number, w: number) => logF(f) * w;
const xToFreq = (x: number, w: number) =>
  Math.pow(10, Math.log10(EQ_FREQ_MIN) + (x / w) * (Math.log10(EQ_FREQ_MAX) - Math.log10(EQ_FREQ_MIN)));
const dbToY = (db: number, h: number) => ((DB_MAX - db) / (DB_MAX - DB_MIN)) * h;
const yToDb = (y: number, h: number) => DB_MAX - (y / h) * (DB_MAX - DB_MIN);

const fmtFreq = (f: number) =>
  f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${Math.round(f)}`;

/** A user-built parametric EQ — drag handles in freq+gain, add/remove 1-20. */
export function BandEQPanel() {
  const bands = useEqStore((s) => s.bands);
  const addBand = useEqStore((s) => s.addBand);
  const removeBand = useEqStore((s) => s.removeBand);
  const updateBand = useEqStore((s) => s.updateBand);
  const toggleBand = useEqStore((s) => s.toggleBand);
  const flatten = useEqStore((s) => s.flatten);
  const reset = useEqStore((s) => s.reset);
  const syncEngine = useEqStore((s) => s.syncEngine);
  const toast = useUIStore((s) => s.toast);
  // Friendly tone EQ (Quick tone bands, Morph Lab, presets, Reactor…) lives in
  // the audio store. We subscribe so the parametric graph re-renders the moment
  // any of it changes — the two views are one.
  const params = useAudioStore((s) => s.params);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: string; offset: number } | null>(null);
  const dirtyRef = useRef(true);
  const lastTickRef = useRef(0);
  // v2.0 — selection lives in the eq store so 3rd Dimension's Band Mode and
  // the Sculptor highlight the same band (live selection link).
  const selected = useEqStore((s) => s.selectedBandId);
  const setSelected = useEqStore((s) => s.selectBand);

  const selectedBand = useMemo(
    () => bands.find((b) => b.id === selected) ?? null,
    [bands, selected],
  );

  // The on-screen height of every band node = the TOTAL response at that band's
  // frequency (friendly tone EQ + the full user band stack), sampled from the
  // live filters. This is exactly what the unified curve and the Frequency
  // Response panel draw, so the nodes always sit on the real curve — and any
  // tool that bends a frequency (tone knobs, Tractor Beam, Morph Lab…) visibly
  // moves them.
  const nodeDb = useMemo(() => {
    const engine = getEngine();
    const map: Record<string, number> = {};
    if (bands.length > 0) {
      const fs = new Float32Array(bands.map((b) => b.freq));
      const friendly = engine.friendlyEQ.computeResponse(fs);
      const user = engine.computeUserEQResponseDb(fs);
      bands.forEach((b, i) => {
        map[b.id] = friendly[i] + user[i];
      });
    }
    return map;
  }, [bands, params]);

  // Make sure the engine reflects the persisted bands on mount.
  useEffect(() => {
    syncEngine();
  }, [syncEngine]);

  // Flag a redraw whenever the bands OR the friendly tone params change so the
  // static curve refreshes even while audio is stopped (the loop otherwise
  // idles to save CPU).
  useEffect(() => {
    dirtyRef.current = true;
  }, [bands, selected, params]);

  useEffect(() => {
    const onResize = () => { dirtyRef.current = true; };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Draw loop: live spectrum backdrop + grid + combined EQ curve.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const engine = getEngine();
    const freqBuf = new Uint8Array(engine.analyserPre.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    const MIN_INTERVAL = 40; // ~25 fps
    // Reused across frames — rebuilding a Float32Array + resampling the axis
    // every draw was pure garbage-collector churn (only width changes it).
    let curveFreqs = new Float32Array(0) as Float32Array<ArrayBuffer>;
    let curveW = -1;

    // Canvas colours can't resolve CSS var() — read the theme triplet once.
    const cyanTriplet = (getComputedStyle(document.documentElement)
      .getPropertyValue("--c-cyan")
      .trim() || "84 180 214")
      .split(/\s+/)
      .slice(0, 3)
      .join(",");

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - last < MIN_INTERVAL) return;
      const running = engine.ctx.state === "running";
      // Idle: nothing playing and no pending change — skip the frame entirely.
      if (!running && !dirtyRef.current) return;
      dirtyRef.current = false;
      last = now;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Live input spectrum (subtle backdrop).
      if (engine.ctx.state === "running") {
        engine.analyserPre.getByteFrequencyData(freqBuf);
        const n = freqBuf.length;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 1; i < n; i++) {
          const f = (i / n) * (engine.ctx.sampleRate / 2);
          if (f < EQ_FREQ_MIN || f > EQ_FREQ_MAX) continue;
          const x = freqToX(f, w);
          const y = h - (freqBuf[i] / 255) * h * 0.9;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fill();
      }

      // Grid.
      ctx.lineWidth = 1;
      ctx.font = "9px JetBrains Mono, Consolas, monospace";
      for (const f of DECADES) {
        const x = freqToX(f, w);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fillText(fmtFreq(f), x + 3, h - 5);
      }
      for (let db = DB_MIN; db <= DB_MAX; db += 5) {
        const y = dbToY(db, h);
        ctx.strokeStyle = db === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.045)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        if (db !== 0) {
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillText(`${db > 0 ? "+" : ""}${db}`, 3, y - 2);
        }
      }

      // ── The unified EQ curve ──
      // Friendly tone EQ + the user band stack, sampled straight from the live
      // filters — the exact same math the Frequency Response panel uses. The two
      // panels are now literally one curve, and it reflects EVERY change to the
      // frequency response, no matter which tool made it.
      const clampDb = (g: number) => Math.max(DB_MIN, Math.min(DB_MAX, g));
      const N = Math.max(160, Math.floor(w));
      if (curveW !== w || curveFreqs.length !== N) {
        curveFreqs = new Float32Array(N) as Float32Array<ArrayBuffer>;
        for (let i = 0; i < N; i++) curveFreqs[i] = xToFreq((i / (N - 1)) * w, w);
        curveW = w;
      }
      const friendlyDb = engine.friendlyEQ.computeResponse(curveFreqs);
      const userDb = engine.computeUserEQResponseDb(curveFreqs);
      const yAt = (i: number) => dbToY(clampDb(friendlyDb[i] + userDb[i]), h);

      // Fill under the curve.
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(${cyanTriplet},0.26)`);
      grad.addColorStop(1, `rgba(${cyanTriplet},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < N; i++) ctx.lineTo((i / (N - 1)) * w, yAt(i));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      // The curve itself.
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgb(${cyanTriplet})`;
      ctx.shadowColor = `rgba(${cyanTriplet},0.45)`;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = yAt(i);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Drag a handle in both axes (freq + gain) ──
  const onHandleDown = (e: React.PointerEvent, b: EqBand) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    // Offset = how much of this node's on-screen height comes from everything
    // *except* this band's own gain (friendly tone EQ + neighbouring bands).
    // Holding it constant during the drag makes the unified curve follow the
    // cursor instead of just the raw band gain.
    const dbAt = nodeDb[b.id] ?? b.gain;
    dragRef.current = { id: b.id, offset: dbAt - b.gain };
    setSelected(b.id);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    updateBand(drag.id, {
      freq: xToFreq(x, rect.width),
      gain: yToDb(y, rect.height) - drag.offset,
    });
    const now = performance.now();
    if (now - lastTickRef.current > 55) {
      lastTickRef.current = now;
      uiTick(x / rect.width);
    }
  };
  const onHandleUp = (e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };
  const onHandleWheel = (e: React.WheelEvent, b: EqBand) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    updateBand(b.id, { q: b.q * (dir > 0 ? 1.12 : 0.89) });
  };

  // Double-click empty area → drop a new band there.
  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = addBand({ freq: xToFreq(x, rect.width), gain: yToDb(y, rect.height) });
    if (id) {
      setSelected(id);
      toast(`Added band (${bands.length + 1}/${EQ_MAX_BANDS})`);
    } else {
      toast(`Max ${EQ_MAX_BANDS} bands`);
    }
  };

  return (
    <GlassPanel intense className="col-span-12 xl:col-span-8 p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">Sculptor EQ</div>
          <div className="text-lg font-semibold">Parametric EQ</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-dim">
            {bands.length}/{EQ_MAX_BANDS} bands
          </span>
          <button
            onClick={() => {
              const id = addBand();
              if (id) {
                setSelected(id);
                toast(`Added band (${bands.length + 1}/${EQ_MAX_BANDS})`);
              } else {
                toast(`Max ${EQ_MAX_BANDS} bands`);
              }
            }}
            disabled={bands.length >= EQ_MAX_BANDS}
            title={bands.length >= EQ_MAX_BANDS ? `Max ${EQ_MAX_BANDS} bands` : "Add a band in the widest gap"}
            className="rounded-lg border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 disabled:opacity-40 px-2.5 py-1 text-xs font-semibold text-cyan transition"
          >
            + Band
          </button>
          <button
            onClick={() => {
              if (bands.length <= EQ_MIN_BANDS) { toast(`Min ${EQ_MIN_BANDS} band`); return; }
              // Remove the selected band, or the top band if none is selected.
              const target =
                selected && bands.some((b) => b.id === selected)
                  ? selected
                  : bands[bands.length - 1]?.id;
              if (target) {
                removeBand(target);
                setSelected(null);
                toast("Removed band");
              }
            }}
            disabled={bands.length <= EQ_MIN_BANDS}
            title={
              bands.length <= EQ_MIN_BANDS
                ? `Keep at least ${EQ_MIN_BANDS} band`
                : "Remove the selected band (or the highest if none is selected)"
            }
            className="rounded-lg border border-plasma/40 bg-plasma/10 hover:bg-plasma/20 disabled:opacity-40 px-2.5 py-1 text-xs font-semibold text-plasma transition"
          >
            − Band
          </button>
          <button
            onClick={() => {
              const filterLive = bands.some(
                (b) => b.enabled && (b.type === "lowpass" || b.type === "highpass" || b.type === "notch"),
              );
              flatten();
              toast(filterLive ? "Gains flattened — LP / HP / notch still filter" : "EQ flattened");
            }}
            title="Zero every peaking/shelf gain. Lowpass, highpass, and notch still run."
            className="rounded-lg border border-white/12 hover:bg-white/5 px-2.5 py-1 text-xs text-white/75 transition"
          >
            Flatten
          </button>
          <button
            onClick={() => { reset(); setSelected(null); toast("EQ reset to 6 flat bands"); }}
            title="Replace the current layout with the default 6-band flat EQ"
            className="rounded-lg border border-white/12 hover:bg-white/5 px-2.5 py-1 text-xs text-white/75 transition"
          >
            Reset
          </button>
          <VolumeControl />
          <HistoryStrip />
        </div>
      </div>

      <div className="relative w-full h-[260px]">
        <canvas
          ref={canvasRef}
          onDoubleClick={onCanvasDoubleClick}
          className="w-full h-full block rounded-xl border border-white/10"
        />
        <div className="absolute inset-0 pointer-events-none">
          {bands.map((b, i) => {
            const left = `${(freqToX(b.freq, 1) * 100).toFixed(2)}%`;
            // Ride the unified curve: node height = total response at its freq.
            const dbAt = nodeDb[b.id] ?? b.gain;
            const top = `${(dbToY(dbAt, 1) * 100).toFixed(2)}%`;
            const isSel = b.id === selected;
            return (
              <div
                key={b.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                style={{ left, top }}
              >
                <button
                  onPointerDown={(e) => onHandleDown(e, b)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  onWheel={(e) => onHandleWheel(e, b)}
                  onDoubleClick={(e) => { e.stopPropagation(); updateBand(b.id, { gain: 0 }); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (bands.length > EQ_MIN_BANDS) {
                      removeBand(b.id);
                      setSelected(null);
                      toast("Removed band");
                    } else {
                      toast(`Min ${EQ_MIN_BANDS} band`);
                    }
                  }}
                  className="group relative grid place-items-center rounded-full cursor-grab active:cursor-grabbing transition"
                  style={{
                    width: isSel ? 18 : 14,
                    height: isSel ? 18 : 14,
                    background: b.enabled ? "rgb(var(--c-cyan))" : "rgba(255,255,255,0.25)",
                    border: "1.5px solid rgba(255,255,255,0.9)",
                    boxShadow: isSel ? "0 0 0 4px rgb(var(--c-cyan) / 0.25)" : "none",
                    opacity: b.enabled ? 1 : 0.55,
                  }}
                  title={`${b.type} · ${fmtFreq(b.freq)}Hz · ${b.gain >= 0 ? "+" : ""}${b.gain.toFixed(1)}dB · Q${b.q.toFixed(1)}`}
                >
                  <span className="text-[9px] font-bold text-ink leading-none select-none">
                    {i + 1}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected-band editor + helper text */}
      <div className="mt-3">
        {selectedBand ? (
          <BandEditor
            band={selectedBand}
            index={bands.findIndex((b) => b.id === selectedBand.id) + 1}
            canRemove={bands.length > EQ_MIN_BANDS}
            onChange={(patch) => updateBand(selectedBand.id, patch)}
            onToggle={() => toggleBand(selectedBand.id)}
            onRemove={() => {
              removeBand(selectedBand.id);
              setSelected(null);
              toast("Removed band");
            }}
          />
        ) : (
          <div className="text-[11px] text-dim">
            Drag a node to bend the curve (left/right = frequency, up/down =
            gain). Scroll a node for Q. Double-click empty space to add a band, a
            node to flatten it, right-click to remove. Same curve as Frequency
            Response: tone knobs plus these bands. Restoration, Clarity, and tape
            are not drawn here.
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

function BandEditor({
  band,
  index,
  canRemove,
  onChange,
  onToggle,
  onRemove,
}: {
  band: EqBand;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<Omit<EqBand, "id">>) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [freqDraft, setFreqDraft] = useState(String(Math.round(band.freq)));
  useEffect(() => {
    setFreqDraft(String(Math.round(band.freq)));
  }, [band.id, band.freq]);

  const commitFreq = () => {
    const n = Number(freqDraft);
    if (!Number.isFinite(n)) {
      setFreqDraft(String(Math.round(band.freq)));
      return;
    }
    onChange({ freq: n });
  };

  const usesGain =
    band.type === "peaking" || band.type === "lowshelf" || band.type === "highshelf";

  return (
    <div className="flex items-end gap-3 flex-wrap rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-xs font-semibold text-cyan w-14 shrink-0">Band {index}</div>

      <Field label="Freq (Hz)">
        <input
          type="number"
          min={EQ_FREQ_MIN}
          max={EQ_FREQ_MAX}
          value={freqDraft}
          onChange={(e) => setFreqDraft(e.target.value)}
          onBlur={commitFreq}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFreq();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setFreqDraft(String(Math.round(band.freq)));
              e.currentTarget.blur();
            }
          }}
          className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan/60"
          aria-label="Band frequency in hertz"
        />
      </Field>

      <Field label={`Gain ${band.gain >= 0 ? "+" : ""}${band.gain.toFixed(1)} dB`}>
        <input
          type="range"
          min={DB_MIN}
          max={DB_MAX}
          step={0.5}
          value={band.gain}
          onChange={(e) => onChange({ gain: Number(e.target.value) })}
          disabled={!usesGain}
          title={usesGain ? "Band gain" : "Gain is unused on lowpass, highpass, and notch"}
          className="w-28 accent-cyan disabled:opacity-40"
        />
      </Field>

      <Field label={`Q ${band.q.toFixed(2)}`}>
        <input
          type="range"
          min={0.3}
          max={8}
          step={0.1}
          value={band.q}
          onChange={(e) => onChange({ q: Number(e.target.value) })}
          className="w-24 accent-cyan"
        />
      </Field>

      <Field label="Type">
        <select
          value={band.type}
          onChange={(e) => onChange({ type: e.target.value as BiquadFilterType })}
          className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan/60 capitalize"
        >
          {EQ_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        onClick={onToggle}
        title={band.enabled ? "Mute this band (it stays in the list)" : "Enable this band"}
        className={`rounded-lg border px-2.5 py-1 text-xs transition ${
          band.enabled
            ? "border-cyan/50 bg-cyan/10 text-cyan"
            : "border-white/12 text-white/50"
        }`}
      >
        {band.enabled ? "On" : "Off"}
      </button>

      {(band.type === "peaking" || band.type === "lowshelf" || band.type === "highshelf") && (
        <button
          onClick={() => onChange({ dynamic: !band.dynamic })}
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
            band.dynamic
              ? "border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-300 shadow-[0_0_10px_rgba(232,121,249,0.25)]"
              : "border-white/12 text-white/50 hover:border-white/25"
          }`}
          title="Dynamic mode (v2.1): the band's gain rides a sidechain — cuts only engage when this region flares above its usual level, boosts only fill in when it dips. Steady content passes untouched."
        >
          DYN
        </button>
      )}

      <button
        onClick={onRemove}
        disabled={!canRemove}
        className="rounded-lg border border-rose-400/30 bg-rose-500/5 hover:bg-rose-500/15 disabled:opacity-30 px-2.5 py-1 text-xs text-rose-200/80 transition"
        title={canRemove ? "Remove this band" : `Keep at least ${EQ_MIN_BANDS} band`}
      >
        Remove
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-dim">{label}</span>
      {children}
    </label>
  );
}

/**
 * Master output volume. This drives the engine's post-everything output gain,
 * so it can genuinely BOOST past unity — the master brick-wall limiter after
 * it keeps the boosted signal from clipping the hardware. 0 dB = unity.
 */
const VOL_MIN = -24;
const VOL_MAX = 12;

function VolumeControl() {
  const outputGainDb = useAudioStore((s) => s.outputGainDb);
  const setOutputGain = useAudioStore((s) => s.setOutputGain);
  const boosted = outputGainDb > 0.05;
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg border border-white/12 px-2 py-1"
      title="Master volume — boost or cut the final output. Double-click for 0 dB. Safe to push: the limiter prevents clipping."
    >
      <span className="text-[10px] uppercase tracking-widest text-dim">Vol</span>
      <input
        type="range"
        min={VOL_MIN}
        max={VOL_MAX}
        step={0.5}
        value={Math.max(VOL_MIN, Math.min(VOL_MAX, outputGainDb))}
        onChange={(e) => setOutputGain(parseFloat(e.target.value))}
        onDoubleClick={() => setOutputGain(0)}
        className="w-24 accent-cyan cursor-pointer"
        aria-label="Master volume"
      />
      <span
        className="text-[10px] font-mono tabular-nums w-11 text-right"
        style={{ color: boosted ? "#22e8ff" : "rgba(255,255,255,0.6)" }}
      >
        {boosted ? "+" : ""}{outputGainDb.toFixed(1)}
      </span>
    </div>
  );
}
