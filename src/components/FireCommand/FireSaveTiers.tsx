/**
 * Unified Patch / Pattern / Scene / Project save cluster.
 * No window.prompt (unsupported in Electron) — patch naming is an inline popover.
 */

import { useEffect, useRef, useState } from "react";
import { useFireCommandStore, SCENE_SLOTS } from "@/state/fireCommandStore";
import { useFireSequencerStore, serializePattern } from "@/state/fireSequencerStore";
import { useUIStore } from "@/state/uiStore";
import { saveProject, openProject } from "@/lib/fireStudio";

const BTN =
  "h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-[0.06em] transition bg-white/[0.04] text-white/60 hover:bg-white/[0.09] hover:text-white/85 ring-1 ring-white/10 disabled:opacity-50";

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
        await saveProject();
      } else {
        const res = await openProject();
        if (!res.ok && res.error) toast(res.error);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Project I/O failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col justify-center gap-1.5 shrink-0 h-full min-h-[56px]">
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40 leading-none">
        {naming ? "Save patch as" : "Save"}
      </div>
      {/* Inline swap (not a popover) — the header clips overflow. */}
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
            className="h-8 w-36 rounded-md bg-black/45 px-2 text-[11px] text-white outline-none ring-1 ring-white/15 placeholder:text-white/30"
          />
          <button type="button" className={BTN} onClick={commitPatch} title="Save patch (Enter)">
            Save
          </button>
          <button type="button" className={BTN} onClick={() => setNaming(false)} title="Cancel (Esc)">
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={() => setNaming(true)} title="Save the current patch as a user preset">
            Patch
          </button>
          <button type="button" className={BTN} onClick={savePattern} title="Export the whole pattern bank + arrangement (.kcpat)">
            Patterns
          </button>
          <button type="button" className={BTN} onClick={saveScene} title={`Capture a performance scene (next free of ${SCENE_SLOTS} slots)`}>
            Scene
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => void doProject("save")} title="Save project (.kcproj)">
            Project
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => void doProject("open")} title="Open project (.kcproj)">
            Open
          </button>
        </div>
      )}
    </div>
  );
}
