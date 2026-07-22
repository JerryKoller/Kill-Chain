import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useUIStore } from "@/state/uiStore";
import { usePlayerStore } from "@/state/playerStore";
import {
  bounceAvailability,
  bounceCurrentTrack,
  BOUNCE_TARGET_LUFS,
} from "@/lib/bounceExport";
import type { ExportFormat } from "@/lib/fireStudio";

/**
 * Bounce — print the current track through the full active Kill Chain
 * (v2.1). The processed pass is a real playback capture of the chain's very
 * last node, so what lands on disk is exactly what you hear.
 */
export function BouncePanel() {
  const [open, setOpen] = useState(false);
  const toast = useUIStore((s) => s.toast);
  // Subscribe so availability updates when the loaded track changes.
  const src = usePlayerStore((s) => s.src);
  void src;

  const [processed, setProcessed] = useState(true);
  const [dry, setDry] = useState(false);
  const [normalized, setNormalized] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("wav");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: string; fraction: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const avail = bounceAvailability();

  const run = async () => {
    if (busy) {
      abortRef.current?.abort();
      return;
    }
    if (!avail.ok) {
      toast(avail.reason ?? "Bounce unavailable");
      return;
    }
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await bounceCurrentTrack({
        processed,
        dry,
        normalized: normalized && processed,
        format,
        signal: ac.signal,
        onProgress: setStage,
      });
      if (res && res.written.length > 0) {
        toast(`Bounced ${res.written.length} file${res.written.length > 1 ? "s" : ""} → ${res.dir}`);
      } else if (res) {
        toast("Nothing was written — capture came back empty");
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast(err instanceof Error ? err.message : "Bounce failed");
      }
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  return (
    <GlassPanel intense className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition"
      >
        <div className="text-left">
          <div className="text-xs uppercase tracking-[0.3em] text-dim">Bounce</div>
          <div className="text-base font-semibold">
            Export the repaired sound — print the full chain to disk
          </div>
        </div>
        <div className="text-sm text-amber-300/80 font-mono">{open ? "\u25BC" : "\u25B6"}</div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-white/10"
          >
            <div className="p-5">
              {!avail.ok ? (
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-100/85">
                  {avail.reason}
                </div>
              ) : (
                <div className="text-sm text-white/75 mb-3">
                  Loaded: <span className="font-mono text-cyan">{avail.name}</span>
                  <span className="text-[11px] text-white/45">
                    {" "}— the processed pass plays the track once (audibly) and records the chain output.
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
                <Check label="Processed (through the Kill Chain)" checked={processed} onChange={setProcessed} />
                <Check label="Dry master (untouched source)" checked={dry} onChange={setDry} />
                <Check
                  label={`Loudness-normalized copy (≈ ${BOUNCE_TARGET_LUFS} LUFS)`}
                  checked={normalized && processed}
                  onChange={setNormalized}
                  disabled={!processed}
                />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-dim">Format</span>
                  {(["wav", "mp3"] as ExportFormat[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase transition ${
                        format === f
                          ? "border-amber-400/60 bg-amber-400/15 text-amber-300"
                          : "border-white/12 text-white/50 hover:border-white/25"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => void run()}
                disabled={!avail.ok || (!processed && !dry)}
                className={`w-full rounded-xl border px-4 py-2.5 text-sm font-bold tracking-wide transition ${
                  busy
                    ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                    : avail.ok && (processed || dry)
                      ? "border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300"
                      : "border-white/10 bg-white/[0.02] text-white/30 cursor-not-allowed"
                }`}
              >
                {busy ? `◉ ${stage?.stage ?? "Working…"} (click to cancel)` : "⬇ BOUNCE TO FOLDER"}
              </button>
              {busy && stage && (
                <div className="mt-2 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-amber-400/70 transition-[width] duration-200"
                    style={{ width: `${Math.round(stage.fraction * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm select-none ${
        disabled ? "text-white/30 cursor-not-allowed" : "text-white/80 cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-amber-400"
      />
      {label}
    </label>
  );
}
