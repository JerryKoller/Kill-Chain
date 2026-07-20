import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSystemStats } from "@/hooks/useSystemStats";

/** Load → colour. Cyan when relaxed, amber when busy, rose when pegged. */
function loadColor(v: number): string {
  if (v < 60) return "rgb(var(--c-cyan))";
  if (v < 85) return "rgb(255 176 72)";
  return "rgb(255 96 96)";
}

function Gauge({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = loadColor(v);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-widest text-white/40">{label}</span>
      <div className="relative h-1.5 w-9 rounded-full bg-white/10 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${v}%`, background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-white/70 w-9 text-right">
        {Math.round(v)}
        {suffix}
      </span>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1">
      <span className="text-[10px] uppercase tracking-widest text-dim">{label}</span>
      <span className="text-xs font-mono tabular-nums text-white/85 text-right" title={hint}>
        {value}
      </span>
    </div>
  );
}

const gb = (mb: number) => (mb / 1024).toFixed(1);

export function SystemMonitor() {
  const s = useSystemStats(1000);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Max polyphony lives in fireCommandStore, which statically pulls the whole
  // ~500-entry generated preset bank with it. Importing that store here would
  // put the bank in the MAIN chunk and generate it on every boot (the monitor
  // is always mounted in the title bar) — so it's loaded lazily, and only
  // once the detail popover actually opens.
  const [maxVoices, setMaxVoices] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let unsub: (() => void) | undefined;
    void import("@/state/fireCommandStore").then(({ useFireCommandStore }) => {
      if (!alive) return;
      setMaxVoices(useFireCommandStore.getState().maxVoices);
      unsub = useFireCommandStore.subscribe((st) => setMaxVoices(st.maxVoices));
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ramPct =
    s.sysRamTotalMB && s.sysRamUsedMB != null
      ? (s.sysRamUsedMB / s.sysRamTotalMB) * 100
      : null;

  return (
    <div ref={wrapRef} className="titlebar-no-drag relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2.5 rounded-full border px-2.5 py-1 transition ${
          open ? "border-cyan/50 bg-cyan/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
        }`}
        title="System resource monitor — click for detail"
      >
        {s.sysCpuPercent != null && <Gauge label="CPU" value={s.sysCpuPercent} />}
        {ramPct != null ? (
          <Gauge label="RAM" value={ramPct} />
        ) : s.appRamMB != null ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-widest text-white/40">RAM</span>
            <span className="text-[10px] font-mono tabular-nums text-white/70">{s.appRamMB} MB</span>
          </div>
        ) : null}
        <span
          className="flex items-center gap-1 text-[10px] font-mono tabular-nums"
          style={{ color: s.voices > 0 ? "rgb(var(--c-cyan))" : "rgba(255,255,255,0.45)" }}
          title="Active synth voices"
        >
          <span className="text-[11px] leading-none">♪</span>
          {s.voices}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-72 z-[80] rounded-2xl border border-white/15 p-3.5 shadow-2xl backdrop-blur-xl"
            style={{
              // Near-opaque, theme-aware fill. The popover floats over live app
              // content with no dimming scrim, so the stock translucent glass was
              // unreadable — this keeps a hint of glass but guarantees legibility.
              background:
                "linear-gradient(180deg, rgb(var(--c-void) / 0.97), rgb(var(--c-ink) / 0.985))",
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-2">
              Resource Monitor
            </div>

            {s.sysCpuPercent != null && (
              <>
                <Gauge label="CPU" value={s.sysCpuPercent} />
                <div className="h-1.5" />
              </>
            )}
            {ramPct != null && (
              <>
                <Gauge label="RAM" value={ramPct} />
                <div className="h-2 border-b border-white/8 mb-1.5" />
              </>
            )}

            {s.appCpuPercent != null && (
              <Row label="App CPU" value={`${s.appCpuPercent.toFixed(1)}%`} hint="This app's share of total CPU" />
            )}
            {s.appRamMB != null && (
              <Row label="App RAM" value={`${s.appRamMB} MB`} hint="Resident memory across all app processes" />
            )}
            {s.sysRamUsedMB != null && s.sysRamTotalMB != null && (
              <Row label="System RAM" value={`${gb(s.sysRamUsedMB)} / ${gb(s.sysRamTotalMB)} GB`} />
            )}
            {s.cores != null && (
              <Row label="CPU cores" value={`${s.cores}${s.procCount != null ? ` · ${s.procCount} proc` : ""}`} />
            )}
            {s.gpu && (
              <Row
                label="GPU"
                value={`${s.gpu.accelerated ? "● " : "○ "}${s.gpu.renderer}`}
                hint={s.gpu.accelerated ? "Hardware-accelerated" : "Software rendering"}
              />
            )}

            <div className="h-2 border-b border-white/8 mb-1.5 mt-1" />
            <Row
              label="Audio"
              value={
                s.sampleRate
                  ? `${(s.sampleRate / 1000).toFixed(1)} kHz · ${s.audioState}`
                  : "idle"
              }
            />
            <Row
              label="Voices"
              value={maxVoices !== null ? `${s.voices} / ${maxVoices}` : `${s.voices}`}
              hint="Active / max polyphony"
            />

            {!s.electron && (
              <div className="mt-2 text-[10px] text-dim leading-snug">
                Full CPU / system-RAM telemetry is available in the desktop app.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
