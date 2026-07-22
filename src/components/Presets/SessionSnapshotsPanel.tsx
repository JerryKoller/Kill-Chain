import { useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useSessionSnapshotsStore } from "@/state/sessionSnapshotsStore";
import { describeChain } from "@/lib/chainSnapshot";
import { useUIStore } from "@/state/uiStore";
import { playUi } from "@/audio/uiSounds";

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Session snapshots — full-chain working states (params + EQ + Restoration +
 * modes + Tractor lock), distinct from presets which only store SoundParams.
 * Quick-save from anywhere with Shift+S.
 */
export function SessionSnapshotsPanel() {
  const snapshots = useSessionSnapshotsStore((s) => s.snapshots);
  const saveSnapshot = useSessionSnapshotsStore((s) => s.saveSnapshot);
  const applySnapshot = useSessionSnapshotsStore((s) => s.applySnapshot);
  const renameSnapshot = useSessionSnapshotsStore((s) => s.renameSnapshot);
  const deleteSnapshot = useSessionSnapshotsStore((s) => s.deleteSnapshot);
  const toast = useUIStore((s) => s.toast);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <GlassPanel intense className="p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-dim">
            Session Snapshots
          </div>
          <div className="text-[11px] text-white/45 mt-0.5">
            Full-chain working states — EQ bands, Restoration Bay, modes and
            Tractor lock included. Quick-save anywhere with{" "}
            <kbd className="rounded border border-white/20 bg-white/5 px-1 text-[10px]">Shift+S</kbd>.
          </div>
        </div>
        <button
          onClick={() => {
            const name = saveSnapshot();
            playUi("success");
            toast(`⧉ Snapshot saved — "${name}"`);
          }}
          data-ui-sound="none"
          className="rounded-xl border border-cyan/40 bg-cyan/10 hover:bg-cyan/20 px-4 py-2 text-sm font-semibold text-cyan transition whitespace-nowrap"
        >
          ⧉ Snapshot Now
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="text-center py-6 text-white/40 text-sm">
          No snapshots yet — dial in a chain you like, then hit Snapshot Now.
        </div>
      ) : (
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="group relative p-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 transition"
            >
              {renamingId === snap.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") { setRenameText(""); setRenamingId(null); }
                  }}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => {
                    if (renameText.trim()) renameSnapshot(snap.id, renameText.trim());
                    setRenamingId(null);
                  }}
                  className="w-full rounded-md border border-cyan/50 bg-black/50 px-2 py-0.5 text-sm text-white outline-none"
                />
              ) : (
                <div className="text-sm font-medium text-white pr-14 truncate">
                  {snap.name}
                </div>
              )}
              <div className="text-[10px] text-white/40 mt-0.5 truncate">
                {describeChain(snap.chain) || "Neutral chain"}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    if (applySnapshot(snap.id)) {
                      playUi("success");
                      toast(`Restored "${snap.name}"`);
                    }
                  }}
                  data-ui-sound="none"
                  className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs font-semibold text-cyan-300 rounded transition"
                >
                  Restore
                </button>
                <span className="text-[10px] text-white/35">{timeAgo(snap.createdAt)}</span>
              </div>

              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => { setRenamingId(snap.id); setRenameText(snap.name); }}
                  className="w-5 h-5 grid place-items-center rounded border border-white/10 text-[10px] text-white/55 hover:text-white hover:border-white/30"
                  title="Rename"
                >✎</button>
                <button
                  onClick={() => {
                    if (confirmDeleteId === snap.id) {
                      deleteSnapshot(snap.id);
                      setConfirmDeleteId(null);
                      toast(`Deleted "${snap.name}"`);
                    } else {
                      setConfirmDeleteId(snap.id);
                      setTimeout(() => setConfirmDeleteId(null), 2400);
                    }
                  }}
                  className={`h-5 grid place-items-center rounded border text-[10px] transition px-1 ${
                    confirmDeleteId === snap.id
                      ? "border-rose-400/70 bg-rose-500/25 text-rose-100 w-auto"
                      : "border-rose-400/30 text-rose-300/70 hover:text-rose-200 hover:border-rose-400/60 w-5"
                  }`}
                  title="Delete"
                >{confirmDeleteId === snap.id ? "CONFIRM" : "✕"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
