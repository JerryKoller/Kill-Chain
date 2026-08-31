/**
 * Unified Patch / Pattern / Scene / Project save cluster.
 * No window.prompt (unsupported in Electron) — patch naming is an inline popover.
 * History (Undo/Redo) lives beside this cluster; Open is visually distinct.
 */

import { useEffect, useRef, useState } from "react";
import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import { useFireSequencerStore, serializePattern } from "@/state/fireSequencerStore";
import { useUIStore } from "@/state/uiStore";
import { saveProject, openProject } from "@/lib/fireStudio";
import { toastFireMissingOnOpen } from "@/lib/fireSampleRepair";

const SAVE_BTN =
  "h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-[0.06em] transition bg-white/[0.04] text-white/65 hover:bg-white/[0.09] hover:text-white/90 ring-1 ring-white/10 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer";

const OPEN_BTN =
  "h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-[0.06em] transition bg-[rgba(232,184,109,0.12)] text-[#f5d9a8] hover:bg-[rgba(232,184,109,0.2)] ring-1 ring-[rgba(232,184,109,0.35)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)] cursor-pointer";

export function FireSaveTiers() {
  const toast = useUIStore((s) => s.toast);
  const savePreset = useFireCommandStore((s) => s.savePreset);
  const captureScene = useFireCommandStore((s) => s.captureScene);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) requestAnimationFrame(() => inputRef.current?.focus());
  }, [naming]);

  const commitPatch = () => {
    const trimmed = name.trim();
    setNaming(false);
    if (!trimmed) return;
    savePreset(trimmed);
    toast(`Saved patch “${trimmed}”`);
    setName("");
  };

  const savePattern = () => {
    const s = useFireSequencerStore.getState();
    const patName = s.sections.find((x) => x.id === s.activeSectionId)?.name ?? "Pattern";
    const blob = {
      version: 1,
      kind: "killchain.pattern",
      name: patName,
      pattern: serializePattern(),
      bpm: s.bpm,
      bars: s.bars,
    };
    const json = JSON.stringify(blob, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `${patName.replace(/[^\w\-]+/g, "_") || "pattern"}.kcpat`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Pattern exported (.kcpat)");
  };

  const saveScene = () => {
    const scenes = useFireCommandStore.getState().scenes;
    const empty = scenes.findIndex((sc) => sc == null);
    const slot = empty >= 0 ? empty : 0;
    captureScene(slot);
    toast(`Scene ${slot + 1} captured${empty < 0 ? " (slot 1 reused — all slots full)" : ""}`);
  };

  const doProject = async (mode: "save" | "open") => {
    setBusy(true);
    try {
      if (mode === "save") {
        const path = await saveProject();
        // Feedback either way — a silent save left users unsure it worked
        // (and re-saving "just in case").
        if (path) toast(`Project saved — ${path}`, "success");
        else toast("Save cancelled");
      } else {
        const res = await openProject();
        if (!res.ok && res.error) toast(res.error);
        else if (res.ok) {
          const paths = res.missingSamples ?? [];
          const n = paths.length;
          if (n > 0) {
            toastFireMissingOnOpen(toast, n, paths);
          } else {
            toast("Project opened", "success");
          }
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Project I/O failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fire-header__cluster shrink-0">
      <div className="fire-header__cluster-label">
        {naming ? "Save patch as" : "Save scope"}
      </div>
      {naming ? (
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPatch();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="Patch name"
            className="h-8 w-36 rounded-md bg-black/45 px-2 text-[11px] text-white outline-none ring-1 ring-white/15 placeholder:text-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(232,184,109,0.65)]"
            aria-label="Patch name"
          />
          <button type="button" className={SAVE_BTN} onClick={commitPatch} title="Save patch (Enter)">
            Save
          </button>
          <button type="button" className={SAVE_BTN} onClick={() => setNaming(false)} title="Cancel (Esc)" aria-label="Cancel naming">
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex items-center gap-1 rounded-md bg-black/25 p-0.5 ring-1 ring-white/8" role="group" aria-label="Save scope">
            <button type="button" className={SAVE_BTN} onClick={() => setNaming(true)} title="Save the current synth patch as a user preset">
              Patch
            </button>
            <button type="button" className={SAVE_BTN} onClick={savePattern} title="Export the pattern bank + arrangement (.kcpat)">
              Patterns
            </button>
            <button type="button" className={SAVE_BTN} onClick={saveScene} title={`Capture a performance scene (next free of ${SCENE_SLOTS} slots)`}>
              Scene
            </button>
            <button type="button" className={SAVE_BTN} disabled={busy} onClick={() => void doProject("save")} title="Save full project (.kcproj)">
              Project
            </button>
          </div>
          <button type="button" className={OPEN_BTN} disabled={busy} onClick={() => void doProject("open")} title="Open project (.kcproj)">
            Open
          </button>
        </div>
      )}
    </div>
  );
}
