import { useEffect, useRef, useState } from "react";
import type { RestoreParams } from "@/audio/dsp/Reconstructor";
import { restoreActive } from "@/audio/dsp/Reconstructor";
import { runBatchRestore, type BatchProgress } from "@/lib/offlineRestore";
import { useUIStore } from "@/state/uiStore";

/**
 * Batch restore — offline processing of whole files with the CURRENT
 * Restoration Bay knob settings. Pick files, pick an output folder, and
 * each one is decoded, de-clicked, rendered through the restoration graph
 * faster than realtime and written out as <name>.restored.wav.
 */
export function BatchRestorePanel({ liveParams }: { liveParams: RestoreParams }) {
  const toast = useUIStore((s) => s.toast);
  const [files, setFiles] = useState<string[]>([]);
  const [outDir, setOutDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [doneCount, setDoneCount] = useState<{ ok: number; failed: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const api = window.playground?.files;
  const available = !!api?.openAudioMulti && !!api?.writeIn;

  const pickFiles = async () => {
    const picked = await api?.openAudioMulti?.();
    if (picked && picked.length > 0) {
      setFiles((prev) => Array.from(new Set([...prev, ...picked])));
      setDoneCount(null);
    }
  };

  const pickOut = async () => {
    const dir = await api?.pickOutputFolder?.();
    if (dir) setOutDir(dir);
  };

  const run = async () => {
    if (running) {
      abortRef.current?.abort();
      toast("Batch restore cancelled");
      return;
    }
    if (!restoreActive(liveParams)) {
      toast("Set the restoration knobs first — the batch uses the live settings");
      return;
    }
    if (files.length === 0 || !outDir) return;
    setRunning(true);
    setDoneCount(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const results = await runBatchRestore(files, liveParams, outDir, setProgress, ac.signal);
      const ok = results.filter((r) => r.outPath).length;
      const failed = results.filter((r) => r.error).length;
      setDoneCount({ ok, failed });
      if (ac.signal.aborted) return;
      toast(
        failed === 0
          ? `Batch restore complete — ${ok} file${ok === 1 ? "" : "s"} written`
          : `Batch restore: ${ok} ok, ${failed} failed`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast(`Batch restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  if (!available) {
    return (
      <div className="mt-6 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-100/85">
        Batch restore needs the desktop app — pick files and write restored WAVs there.
      </div>
    );
  }

  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-dim">Batch restore</div>
          <div className="text-[11px] text-dim mt-1">
            Process whole files offline with the knob settings above — faster than
            realtime, written as <span className="text-white/70">.restored.wav</span>.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void pickFiles()}
            disabled={running}
            className="rounded-lg border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 px-3 py-1.5 text-xs font-semibold transition"
          >
            + Add files{files.length > 0 ? ` (${files.length})` : ""}
          </button>
          <button
            onClick={() => void pickOut()}
            disabled={running}
            className="rounded-lg border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 px-3 py-1.5 text-xs font-semibold transition max-w-[220px] truncate"
            title={outDir ?? "Choose where the restored files are written"}
          >
            {outDir ? `→ ${fileName(outDir)}` : "Output folder…"}
          </button>
          <button
            onClick={() => void run()}
            disabled={!running && (files.length === 0 || !outDir || !restoreActive(liveParams))}
            title={
              running
                ? "Click to cancel"
                : !restoreActive(liveParams)
                  ? "Set the restoration knobs first — the batch uses the live settings"
                  : files.length === 0
                    ? "Add files first"
                    : !outDir
                      ? "Choose an output folder"
                      : undefined
            }
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              running
                ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                : "border-emerald-400/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 disabled:opacity-40"
            }`}
          >
            {running ? "◉ Processing… (click to cancel)" : `⚙ Process ${files.length} file${files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-3 max-h-28 overflow-y-auto sidebar-scroll rounded-lg border border-white/5 bg-black/20">
          {files.map((f) => (
            <div key={f} className="flex items-center gap-2 px-3 py-1 text-[11px] text-white/70 border-b border-white/5 last:border-0">
              <span className="flex-1 truncate" title={f}>{fileName(f)}</span>
              {!running && (
                <button
                  onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                  className="text-dim hover:text-plasma"
                  title="Remove from batch"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {progress && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-dim mb-1">
            <span className="truncate">
              {progress.stage} — {fileName(progress.file)}
            </span>
            <span className="tabular-nums">
              {progress.index + 1} / {progress.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-emerald-400/80 transition-all"
              style={{ width: `${((progress.index + (progress.stage === "writing" ? 0.9 : progress.stage === "rendering" ? 0.6 : 0.2)) / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {doneCount && !running && (
        <div className="mt-3 text-[11px] text-emerald-300/90">
          Done — {doneCount.ok} written{doneCount.failed > 0 ? `, ${doneCount.failed} failed` : ""}.
        </div>
      )}
    </div>
  );
}
