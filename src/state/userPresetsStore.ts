import { create } from "zustand";
import type { SoundParams } from "@/audio/types";
import { NEUTRAL_PARAMS } from "@/audio/types";

const STORAGE_KEY = "audio-playground.userPresets.v1";

export interface UserPreset {
  id: string;
  name: string;
  emoji: string;
  accent: string;
  params: SoundParams;
  createdAt: number;
  updatedAt: number;
}

interface UserPresetsState {
  presets: UserPreset[];
  /** Save a new preset; returns the new id. */
  savePreset: (name: string, params: SoundParams, accent?: string, emoji?: string) => string;
  /** Overwrite an existing preset's params (keeps name/emoji/accent). */
  overwrite: (id: string, params: SoundParams) => void;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  duplicatePreset: (id: string) => string | null;
}

function loadFromStorage(): UserPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: merge missing keys with NEUTRAL_PARAMS so older saved
    // presets that pre-date a SoundParams change still load cleanly.
    return parsed
      .filter((p) => p && typeof p === "object")
      .map((p) => ({
        id: String(p.id ?? cryptoId()),
        name: String(p.name ?? "Untitled"),
        emoji: String(p.emoji ?? "✦"),
        accent: String(p.accent ?? "#22e8ff"),
        createdAt: Number(p.createdAt ?? Date.now()),
        updatedAt: Number(p.updatedAt ?? Date.now()),
        params: { ...NEUTRAL_PARAMS, ...(p.params ?? {}) } as SoundParams,
      }));
  } catch (err) {
    console.warn("[userPresets] failed to load from storage:", err);
    return [];
  }
}

function persist(presets: UserPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (err) {
    console.warn("[userPresets] failed to persist:", err);
  }
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `up-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

const ACCENTS = ["#22e8ff", "#ff2bd6", "#7a3bff", "#ffb648", "#9dff5b", "#48ffd1", "#a06bff", "#ff8a48", "#ff5b8a"];
const EMOJIS = ["✦", "✧", "❉", "❖", "◈", "◆", "✷", "✺", "◐", "◑", "◉"];

function pickFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const useUserPresetsStore = create<UserPresetsState>((set, get) => ({
  presets: loadFromStorage(),

  savePreset: (name, params, accent, emoji) => {
    const id = cryptoId();
    const now = Date.now();
    const preset: UserPreset = {
      id,
      name: (name || "Untitled").trim().slice(0, 60) || "Untitled",
      emoji: emoji ?? pickFrom(EMOJIS),
      accent: accent ?? pickFrom(ACCENTS),
      params: { ...params },
      createdAt: now,
      updatedAt: now,
    };
    const next = [preset, ...get().presets];
    set({ presets: next });
    persist(next);
    return id;
  },

  overwrite: (id, params) => {
    const next = get().presets.map((p) =>
      p.id === id ? { ...p, params: { ...params }, updatedAt: Date.now() } : p,
    );
    set({ presets: next });
    persist(next);
  },

  renamePreset: (id, name) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const next = get().presets.map((p) =>
      p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
    );
    set({ presets: next });
    persist(next);
  },

  deletePreset: (id) => {
    const next = get().presets.filter((p) => p.id !== id);
    set({ presets: next });
    persist(next);
  },

  duplicatePreset: (id) => {
    const src = get().presets.find((p) => p.id === id);
    if (!src) return null;
    return get().savePreset(`${src.name} copy`, src.params, src.accent, src.emoji);
  },
}));
