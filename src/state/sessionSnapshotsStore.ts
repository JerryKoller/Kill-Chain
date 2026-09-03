import { create } from "zustand";
import {
  applyChain,
  captureChain,
  sanitizeChainSnapshot,
  type ChainSnapshot,
} from "@/lib/chainSnapshot";

/**
 * Session snapshots — named, one-click saves of the FULL chain (params, EQ
 * bands, Restoration Bay, modes, output gain, Tractor lock). Unlike presets
 * (SoundParams only) a snapshot restores everything; unlike the Mission Log
 * they're not tied to a source — they're working states: "before mastering
 * pass", "warm voicing v2", etc. Quick-save is on a hotkey (Ctrl+Shift+S).
 */

const STORAGE_KEY = "killchain.sessionSnapshots.v1";
const MAX_SNAPSHOTS = 100;

export interface SessionSnapshot {
  id: string;
  name: string;
  chain: ChainSnapshot;
  createdAt: number;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `snap-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function load(): SessionSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    const out: SessionSnapshot[] = [];
    for (const s of p) {
      if (!s || typeof s !== "object") continue;
      const chain = sanitizeChainSnapshot(s.chain);
      if (!chain) continue;
      out.push({
        id: typeof s.id === "string" ? s.id : newId(),
        name: typeof s.name === "string" ? s.name : "Snapshot",
        chain,
        createdAt: Number(s.createdAt ?? Date.now()),
      });
    }
    return out.slice(0, MAX_SNAPSHOTS);
  } catch {
    return [];
  }
}

function persist(snapshots: SessionSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch (err) {
    console.warn("[sessionSnapshots] persist failed:", err);
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Session snapshots", err),
    );
  }
}

interface SessionSnapshotsState {
  snapshots: SessionSnapshot[];
  /** Snapshot the live chain. Returns the generated name. */
  saveSnapshot: (name?: string) => string;
  applySnapshot: (id: string) => boolean;
  renameSnapshot: (id: string, name: string) => void;
  deleteSnapshot: (id: string) => void;
}

export const useSessionSnapshotsStore = create<SessionSnapshotsState>((set, get) => ({
  snapshots: load(),

  saveSnapshot: (name) => {
    const n = get().snapshots.length + 1;
    const finalName =
      (name ?? "").trim().slice(0, 60) ||
      `Snapshot ${n} — ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const snap: SessionSnapshot = {
      id: newId(),
      name: finalName,
      chain: captureChain(),
      createdAt: Date.now(),
    };
    const snapshots = [snap, ...get().snapshots].slice(0, MAX_SNAPSHOTS);
    set({ snapshots });
    persist(snapshots);
    return finalName;
  },

  applySnapshot: (id) => {
    const snap = get().snapshots.find((s) => s.id === id);
    if (!snap) return false;
    applyChain(snap.chain);
    return true;
  },

  renameSnapshot: (id, name) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const snapshots = get().snapshots.map((s) =>
      s.id === id ? { ...s, name: trimmed } : s,
    );
    set({ snapshots });
    persist(snapshots);
  },

  deleteSnapshot: (id) => {
    const snapshots = get().snapshots.filter((s) => s.id !== id);
    set({ snapshots });
    persist(snapshots);
  },
}));
