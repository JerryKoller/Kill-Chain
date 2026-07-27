/**
 * Fire Command workspace: Synth (sound) vs Sequencer (patterns / roll / drums).
 * Persisted so the last workspace survives reloads.
 */

import { useCallback, useEffect, useState } from "react";

export type FireWorkspace = "synth" | "sequencer";

export const FIRE_WORKSPACE_KEY = "killchain.fire.workspace";
export const FIRE_WORKSPACE_EVENT = "killchain.fire.workspace";

function readWorkspace(): FireWorkspace {
  try {
    const raw = window.localStorage.getItem(FIRE_WORKSPACE_KEY);
    if (raw === "sequencer" || raw === "synth") return raw;
  } catch { /* quota */ }
  return "synth";
}

export function writeFireWorkspace(ws: FireWorkspace): void {
  try {
    window.localStorage.setItem(FIRE_WORKSPACE_KEY, ws);
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(FIRE_WORKSPACE_EVENT, { detail: { workspace: ws } }));
}

export function useFireWorkspace(): [FireWorkspace, (ws: FireWorkspace) => void] {
  const [workspace, setWorkspace] = useState<FireWorkspace>(() =>
    typeof window !== "undefined" ? readWorkspace() : "synth",
  );

  useEffect(() => {
    const onExt = (e: Event) => {
      const detail = (e as CustomEvent<{ workspace: FireWorkspace }>).detail;
      if (detail?.workspace === "synth" || detail?.workspace === "sequencer") {
        setWorkspace(detail.workspace);
      }
    };
    window.addEventListener(FIRE_WORKSPACE_EVENT, onExt);
    return () => window.removeEventListener(FIRE_WORKSPACE_EVENT, onExt);
  }, []);

  const set = useCallback((ws: FireWorkspace) => {
    setWorkspace(ws);
    writeFireWorkspace(ws);
  }, []);

  return [workspace, set];
}
