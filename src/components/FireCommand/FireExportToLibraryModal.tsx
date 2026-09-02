/**
 * Pre-export modal: title / artist / album / artwork / format, then bounce
 * into Music/Kill-Chain/Fire Exports and register in the Library.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useFireSequencerStore } from "@/state/fireSequencerStore";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";
import { exportFireToLibrary } from "@/lib/libraryExport";
import type { ExportFormat } from "@/lib/fireStudio";

const FIRE = "#ff6a3d";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FireExportToLibraryModal({ open, onClose }: Props) {
  const toast = useUIStore((s) => s.toast);
  const setView = useUIStore((s) => s.setView);
  const playMode = useFireSequencerStore((s) => s.playMode);
  const activeSectionId = useFireSequencerStore((s) => s.activeSectionId);
  const sections = useFireSequencerStore((s) => s.sections);
  const presetId = useFireCommandStore((s) => s.presetId);

  const defaultTitle = useMemo(() => {
    if (playMode === "arrangement") return "Fire Arrangement";
    return sections.find((x) => x.id === activeSectionId)?.name ?? "Fire Pattern";
  }, [playMode, sections, activeSectionId]);

  const [title, setTitle] = useState(defaultTitle);
  const [artist, setArtist] = useState("Kill-Chain");
  const [album, setAlbum] = useState("Fire Command Exports");
  const [format, setFormat] = useState<ExportFormat>("mp3");
  const [artwork, setArtwork] = useState<{ base64: string; mime: string; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setArtist("Kill-Chain");
    setAlbum("Fire Command Exports");
    setFormat("mp3");
    setArtwork(null);
    setBusy(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [open, defaultTitle]);

  useEffect(() => {
    return () => {
      if (artwork?.previewUrl) URL.revokeObjectURL(artwork.previewUrl);
    };
  }, [artwork?.previewUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const pickArt = async () => {
    const openImage = window.playground?.files?.openImage;
    if (!openImage) {
      toast("Artwork picker needs the desktop app", "warn");
      return;
    }
    const res = await openImage();
    if (!res) return;
    if (artwork?.previewUrl) URL.revokeObjectURL(artwork.previewUrl);
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    const previewUrl = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
    setArtwork({ base64: res.base64, mime: res.mime, previewUrl });
    if (format === "wav") setFormat("mp3");
  };

  const clearArt = () => {
    if (artwork?.previewUrl) URL.revokeObjectURL(artwork.previewUrl);
    setArtwork(null);
  };

  const run = async () => {
    if (busy) return;
    const t = title.trim() || defaultTitle;
    setBusy("arming…");
    try {
      const res = await exportFireToLibrary(
        {
          title: t,
          artist: artist.trim() || "Kill-Chain",
          album: album.trim() || "Fire Command Exports",
          format,
          artwork: artwork ? { base64: artwork.base64, mime: artwork.mime } : null,
          genre: "Electronic",
        },
        (p) => setBusy(`${p.stage} ${Math.round(p.fraction * 100)}%`),
      );
      if (!res) {
        toast("Export cancelled", "warn");
        return;
      }
      const how = res.method === "offline"
        ? "Fire dry · offline, no live ARP"
        : "Fire dry · realtime fallback";
      toast(`“${res.trackTitle}” → Library (${how})`, "success");
      onClose();
      setView("library");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Library export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (!busy) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Export to Library (Fire dry)"
            className="w-full max-w-lg rounded-xl border border-white/12 bg-[#12151c] shadow-2xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Fire Command
                </div>
                <h2 className="text-[15px] font-semibold text-white/90">Export to Library (Fire dry)</h2>
              </div>
              <button
                type="button"
                disabled={!!busy}
                onClick={onClose}
                className="rounded-md px-2 py-1 text-[12px] text-white/50 hover:bg-white/5 hover:text-white/80 disabled:opacity-40"
              >
                Esc
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <p className="text-[12px] leading-relaxed text-white/50">
                Fire dry bounce of the current {playMode === "arrangement" ? "arrangement" : "pattern"} into{" "}
                <span className="text-white/70">Music / Kill-Chain / Fire Exports</span>, then adds it to your Library.
                Offline omits the live ARP; Kill-Chain master only runs on the realtime fallback.
                {presetId && presetId !== "custom" && presetId !== "init" ? (
                  <span className="text-white/40"> · patch “{presetId}”</span>
                ) : null}
              </p>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => void pickArt()}
                  disabled={!!busy}
                  className="group relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/20 bg-white/[0.03] transition hover:border-white/35 hover:bg-white/[0.05] disabled:opacity-50"
                  title="Choose album artwork"
                >
                  {artwork ? (
                    <img src={artwork.previewUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="px-2 text-center text-[10px] font-bold uppercase tracking-wider text-white/35 group-hover:text-white/55">
                      Artwork
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <Field label="Title">
                    <input
                      ref={titleRef}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={!!busy}
                      className={inputCls}
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Artist">
                    <input
                      value={artist}
                      onChange={(e) => setArtist(e.target.value)}
                      disabled={!!busy}
                      className={inputCls}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Album">
                    <input
                      value={album}
                      onChange={(e) => setAlbum(e.target.value)}
                      disabled={!!busy}
                      className={inputCls}
                      maxLength={80}
                    />
                  </Field>
                </div>
              </div>

              {artwork && (
                <button
                  type="button"
                  onClick={clearArt}
                  disabled={!!busy}
                  className="text-[11px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline disabled:opacity-40"
                >
                  Remove artwork
                </button>
              )}

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Format</span>
                {(["mp3", "wav"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    disabled={!!busy || (!!artwork && f === "wav")}
                    onClick={() => setFormat(f)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition ${
                      format === f
                        ? "bg-white/12 text-white ring-1 ring-white/25"
                        : "text-white/45 hover:bg-white/[0.06] hover:text-white/70"
                    } disabled:opacity-35`}
                    title={artwork && f === "wav" ? "Artwork requires MP3" : undefined}
                  >
                    {f}
                  </button>
                ))}
                {artwork && (
                  <span className="text-[10px] text-white/35">Artwork embeds in MP3</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3.5">
              <button
                type="button"
                disabled={!!busy}
                onClick={onClose}
                className="h-8 rounded-md px-3 text-[11px] font-bold uppercase tracking-wider text-white/55 hover:bg-white/5 hover:text-white/80 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void run()}
                className="h-8 rounded-md px-3.5 text-[11px] font-bold uppercase tracking-wider text-black disabled:opacity-50"
                style={{ background: FIRE }}
              >
                {busy ? busy : "Export Fire dry"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-[13px] text-white/90 outline-none placeholder:text-white/25 focus:border-[rgba(255,106,61,0.45)] disabled:opacity-50";
