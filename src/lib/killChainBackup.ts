/**
 * Kill-Chain backup v1 — Settings + Library folders/meta + Mission Log.
 * Fire project snapshots are intentionally out of scope for v1.
 */

import { LEGAL_VERSION } from "@/lib/legal";

export const BACKUP_KIND = "kill-chain-backup";
export const BACKUP_VERSION = 1;

export type BackupImportMode = "merge" | "replace";

export interface KillChainBackupPayload {
  kind: typeof BACKUP_KIND;
  v: number;
  exportedAt: number;
  appVersion?: string;
  legalVersion?: string;
  settings?: Record<string, unknown>;
  library?: {
    folders: string[];
    tracks?: unknown[];
    sortKey?: string;
    sortDir?: string;
    groupBy?: string;
    viewMode?: string;
  };
  libraryMeta?: {
    favorites?: string[];
    playCounts?: Record<string, number>;
    lastPlayed?: Record<string, number>;
    playlists?: unknown[];
  };
  missionLog?: {
    entries?: Record<string, unknown>;
    autoRestore?: boolean;
  };
}

export async function buildKillChainBackup(): Promise<KillChainBackupPayload> {
  const { useSettingsStore } = await import("@/state/settingsStore");
  const { useLibraryStore } = await import("@/state/libraryStore");
  const { useMissionLogStore } = await import("@/state/missionLogStore");
  const { APP_VERSION } = await import("@/lib/appVersion");

  const s = useSettingsStore.getState();
  const lib = useLibraryStore.getState();
  const log = useMissionLogStore.getState();

  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "set" || k === "toggle") continue;
    settings[k] = v;
  }

  return {
    kind: BACKUP_KIND,
    v: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: APP_VERSION,
    legalVersion: LEGAL_VERSION,
    settings,
    library: {
      folders: [...lib.folders],
      tracks: lib.tracks.slice(0, 5000),
      sortKey: lib.sortKey,
      sortDir: lib.sortDir,
      groupBy: lib.groupBy,
      viewMode: lib.viewMode,
    },
    libraryMeta: {
      favorites: Object.keys(lib.favorites),
      playCounts: { ...lib.playCounts },
      lastPlayed: { ...lib.lastPlayed },
      playlists: lib.playlists,
    },
    missionLog: {
      entries: { ...log.entries },
      autoRestore: log.autoRestore,
    },
  };
}

export async function exportKillChainBackup(): Promise<boolean> {
  const files = window.playground?.files;
  if (!files?.save) return false;
  const payload = await buildKillChainBackup();
  const json = JSON.stringify(payload, null, 2);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  const out = await files.save(
    `kill-chain-backup-${new Date().toISOString().slice(0, 10)}.kcbackup`,
    [{ name: "Kill-Chain backup", extensions: ["kcbackup", "json"] }],
    base64,
  );
  return out !== null;
}

export async function importKillChainBackup(
  mode: BackupImportMode,
): Promise<{ ok: boolean; detail: string }> {
  const files = window.playground?.files;
  if (!files?.openText) {
    return { ok: false, detail: "File picker unavailable — use the desktop app." };
  }
  const res = await files.openText([
    { name: "Kill-Chain backup", extensions: ["kcbackup", "json"] },
  ]);
  if (!res) return { ok: false, detail: "Import cancelled." };

  let data: KillChainBackupPayload;
  try {
    data = JSON.parse(res.text) as KillChainBackupPayload;
  } catch {
    return { ok: false, detail: "File is not valid JSON." };
  }
  if (data.kind !== BACKUP_KIND || typeof data.v !== "number") {
    return { ok: false, detail: "Not a Kill-Chain backup file." };
  }

  const { useSettingsStore } = await import("@/state/settingsStore");
  const { useLibraryStore } = await import("@/state/libraryStore");
  const { useMissionLogStore } = await import("@/state/missionLogStore");

  if (data.settings && typeof data.settings === "object") {
    const set = useSettingsStore.getState().set;
    for (const [key, value] of Object.entries(data.settings)) {
      if (key === "set" || key === "toggle") continue;
      try {
        set(key as never, value as never);
      } catch {
        /* skip unknown / incompatible keys */
      }
    }
  }

  useLibraryStore.getState().applyBackup(
    {
      folders: data.library?.folders ?? [],
      tracks: Array.isArray(data.library?.tracks) ? (data.library!.tracks as never[]) : [],
      sortKey: data.library?.sortKey,
      sortDir: data.library?.sortDir,
      groupBy: data.library?.groupBy,
      viewMode: data.library?.viewMode,
      favorites: data.libraryMeta?.favorites ?? [],
      playCounts: data.libraryMeta?.playCounts ?? {},
      lastPlayed: data.libraryMeta?.lastPlayed ?? {},
      playlists: (data.libraryMeta?.playlists as never[]) ?? [],
    },
    mode,
  );

  if (data.missionLog) {
    useMissionLogStore.getState().applyBackup(
      {
        entries: (data.missionLog.entries as never) ?? {},
        autoRestore: data.missionLog.autoRestore,
      },
      mode,
    );
  }

  const folderHint =
    (data.library?.folders?.length ?? 0) > 0
      ? " Folder paths may need re-adding if files moved on this machine."
      : "";
  return {
    ok: true,
    detail:
      mode === "replace"
        ? `Backup restored (replace).${folderHint}`
        : `Backup merged.${folderHint}`,
  };
}
