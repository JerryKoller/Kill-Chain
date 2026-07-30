import { useFireSequencerStore } from "@/state/fireSequencerStore";
import {
  missingSamplesOpenMessage,
  missingSamplesRepairTip,
  summarizeMissingSamplePaths,
} from "@/lib/retailHelp";
import type { ToastKind } from "@/state/uiStore";

type ToastFn = (msg: string, kind?: ToastKind) => void;

/** Re-read sample paths from disk (e.g. after copying files into place). */
export async function retryHydrateFireSamples(): Promise<string[]> {
  const { missing } = await useFireSequencerStore.getState().hydrateSamples();
  return missing;
}

export function toastFireMissingOnOpen(
  toast: ToastFn,
  count: number,
  paths: string[] = [],
): void {
  toast(`${missingSamplesOpenMessage(count, paths)} — ${missingSamplesRepairTip()}`, "warn");
}

export function toastFireMissingOnExport(
  toast: ToastFn,
  count: number,
  context: "wav" | "stems",
): void {
  const tail = context === "stems" ? "stems may be incomplete" : "export may be incomplete";
  toast(
    `${count} sample${count === 1 ? "" : "s"} missing — ${tail}. ${missingSamplesRepairTip()}`,
    "warn",
  );
}

export function toastFireRetryResult(toast: ToastFn, missing: string[]): void {
  if (missing.length === 0) {
    toast("All Fire samples loaded", "success");
    return;
  }
  const names = summarizeMissingSamplePaths(missing);
  toast(
    `Still ${missing.length} missing${names ? ` (${names})` : ""} — re-pick files on the Drums tab`,
    "warn",
  );
}
