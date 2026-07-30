/** Public installer / release page — manual updates only (no auto-updater). */
export const RELEASES_URL = "https://github.com/JerryKoller/Kill-Chain";

/** Glossary term for the quick-start card and deep-link from Settings / Fire. */
export const FIRST_60_SECONDS_TERM = "First 60 seconds";

export const FIRE_MISSING_SAMPLES_TERM = "Missing Fire samples";

/** Three-step loop buyers can repeat on every session. */
export const FIRST_60_SECONDS_STEPS = [
  {
    title: "Add music",
    body: "Library → Add folders or drop a file. Double-click a track to load it.",
  },
  {
    title: "Hear through the chain",
    body: "Press Space to play. Correction and Sculptor shape what reaches your headphones or speakers.",
  },
  {
    title: "Sculpt",
    body: "Tweak Tone / Dynamics / Space on the Sculptor, try Tractor for balance, save favorites to the Armory.",
  },
] as const;

export function summarizeMissingSamplePaths(paths: string[], max = 3): string {
  if (paths.length === 0) return "";
  const names = paths
    .slice(0, max)
    .map((p) => p.split(/[\\/]/).pop() ?? p)
    .join(", ");
  return paths.length > max ? `${names}…` : names;
}

export function missingSamplesOpenMessage(count: number, paths: string[] = []): string {
  const detail = summarizeMissingSamplePaths(paths);
  const base = `${count} sample${count === 1 ? "" : "s"} missing on this machine`;
  return detail ? `${base} (${detail})` : base;
}

export function missingSamplesExportMessage(
  count: number,
  context: "wav" | "stems",
): string {
  const tail = context === "stems" ? "stems may be incomplete" : "export may be incomplete";
  return `${count} sample${count === 1 ? "" : "s"} missing — ${tail}`;
}

export function missingSamplesRepairTip(): string {
  return "Drums tab → reload each lane, or Glossary → Missing Fire samples";
}
