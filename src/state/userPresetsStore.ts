import { create } from "zustand";
import type { SoundParams } from "@/audio/types";
import { NEUTRAL_PARAMS } from "@/audio/types";
import { RESTORE_OFF, type RestoreParams } from "@/audio/dsp/Reconstructor";

const STORAGE_KEY = "audio-playground.userPresets.v1";

/** v2.1 — optional repair layer saved alongside the tone params. */
export interface PresetRepairLayer {
  restore: RestoreParams;
  clarity: number;
}

export interface UserPreset {
  id: string;
  name: string;
  emoji: string;
  accent: string;
  params: SoundParams;
  /** v2.1 — Restoration Bay + Clarity, when the user chose to include them.
   *  Absent/null on tone-only presets (all pre-2.1 presets). */
  repair?: PresetRepairLayer | null;
  createdAt: number;
  updatedAt: number;
}

interface UserPresetsState {
  presets: UserPreset[];
  /** Save a new preset; returns the new id. */
  savePreset: (
    name: string,
    params: SoundParams,
    accent?: string,
    emoji?: string,
    repair?: PresetRepairLayer | null,
  ) => string;
  /** Overwrite an existing preset's params (keeps name/emoji/accent). */
  overwrite: (id: string, params: SoundParams) => void;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  duplicatePreset: (id: string) => string | null;
}

const clamp01 = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

function sanitizeRepair(raw: unknown): PresetRepairLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PresetRepairLayer> & { restore?: Partial<RestoreParams> };
  const restore: RestoreParams = { ...RESTORE_OFF };
  if (r.restore && typeof r.restore === "object") {
    for (const k of Object.keys(RESTORE_OFF) as (keyof RestoreParams)[]) {
      restore[k] = clamp01(r.restore[k]);
    }
  }
  return { restore, clarity: clamp01(r.clarity) };
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
        repair: sanitizeRepair(p.repair),
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

  savePreset: (name, params, accent, emoji, repair) => {
    const id = cryptoId();
    const now = Date.now();
    const preset: UserPreset = {
      id,
      name: (name || "Untitled").trim().slice(0, 60) || "Untitled",
      emoji: emoji ?? pickFrom(EMOJIS),
      accent: accent ?? pickFrom(ACCENTS),
      params: { ...params },
      repair: repair ? { restore: { ...repair.restore }, clarity: repair.clarity } : null,
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
    return get().savePreset(`${src.name} copy`, src.params, src.accent, src.emoji, src.repair ?? null);
  },
}));
