import { create } from "zustand";
import type { ParametricBand } from "@/audio/types";
import {
  HEADPHONES,
  type HeadphoneFormFactor,
  type HeadphoneProfile,
} from "@/audio/headphoneProfiles";

/**
 * User-imported headphone correction profiles (v1.5 — AutoEq import + the
 * "I have these cans" wizard). Custom profiles are INJECTED into the same
 * `HEADPHONES` catalog record the rest of the app reads, so the settings
 * picker, companion-mode matching, Tractor and Sidebar all see them without
 * any extra plumbing. This module must be imported at app boot (App.tsx)
 * so lookups like `HEADPHONES[settings.headphone]` resolve custom ids.
 */

const STORAGE_KEY = "killchain.customHeadphones.v1";

export interface CustomHeadphoneInput {
  name: string;
  brand?: string;
  formFactor?: HeadphoneFormFactor;
  bands: ParametricBand[];
  /** AutoEq preamp — mapped onto the profile's output gain trim. */
  preampDb?: number;
  /** Lowercase substrings for companion-mode device matching. */
  match?: string[];
}

function sanitizeBands(raw: unknown, prefix: string): ParametricBand[] {
  if (!Array.isArray(raw)) return [];
  const out: ParametricBand[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const freq = Number((b as ParametricBand).freq);
    const gain = Number((b as ParametricBand).gain);
    const q = Number((b as ParametricBand).q);
    if (!isFinite(freq) || freq < 10 || freq > 24000) continue;
    const type = (b as ParametricBand).type;
    out.push({
      id: `${prefix}-b${out.length}`,
      freq,
      gain: Math.max(-20, Math.min(20, isFinite(gain) ? gain : 0)),
      q: Math.max(0.1, Math.min(18, isFinite(q) ? q : 0.71)),
      type: type === "lowshelf" || type === "highshelf" ? type : "peaking",
      label: typeof (b as ParametricBand).label === "string" ? (b as ParametricBand).label : `Band ${out.length + 1}`,
    });
  }
  return out;
}

function sanitizeProfile(raw: unknown): HeadphoneProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<HeadphoneProfile>;
  if (typeof r.id !== "string" || !r.id.startsWith("custom-")) return null;
  if (typeof r.name !== "string" || !r.name.trim()) return null;
  const bands = sanitizeBands(r.bands, r.id);
  return {
    id: r.id,
    name: r.name.trim().slice(0, 80),
    brand: typeof r.brand === "string" && r.brand.trim() ? r.brand.trim().slice(0, 40) : "Custom",
    formFactor: (["over-ear", "on-ear", "iem", "true-wireless", "open-back", "generic"] as const)
      .includes(r.formFactor as HeadphoneFormFactor)
      ? (r.formFactor as HeadphoneFormFactor)
      : "over-ear",
    blurb: typeof r.blurb === "string" ? r.blurb.slice(0, 140) : "Imported profile.",
    outputGainDb: Math.max(-12, Math.min(0, Number(r.outputGainDb ?? -3.5))),
    bands,
    match: Array.isArray(r.match)
      ? r.match.filter((m): m is string => typeof m === "string").map((m) => m.toLowerCase())
      : [],
  };
}

function load(): HeadphoneProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeProfile).filter((p): p is HeadphoneProfile => p !== null);
  } catch {
    return [];
  }
}

function persist(profiles: HeadphoneProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.warn("[customHeadphones] persist failed:", err);
    void import("@/lib/appHealth").then(({ reportStorageFailure }) =>
      reportStorageFailure("Custom headphones", err),
    );
  }
}

/** Push a custom profile into the shared catalog record. */
function inject(p: HeadphoneProfile): void {
  HEADPHONES[p.id] = p;
}

function eject(id: string): void {
  if (id.startsWith("custom-")) delete HEADPHONES[id];
}

interface CustomHeadphonesState {
  profiles: HeadphoneProfile[];
  /** Create + catalog-inject a profile. Returns its id. */
  addProfile: (input: CustomHeadphoneInput) => string;
  removeProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;
}

export const useCustomHeadphonesStore = create<CustomHeadphonesState>((set, get) => {
  const initial = load();
  for (const p of initial) inject(p);

  return {
    profiles: initial,

    addProfile: (input) => {
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      // AutoEq preamps assume full-scale digital sources; clamp the trim into
      // the same headroom window the built-in profiles use.
      const preamp = Number(input.preampDb ?? -3.5);
      const profile: HeadphoneProfile = {
        id,
        name: input.name.trim().slice(0, 80) || "Custom profile",
        brand: (input.brand ?? "Custom").trim().slice(0, 40) || "Custom",
        formFactor: input.formFactor ?? "over-ear",
        blurb: `Imported ${new Date().toLocaleDateString()} — ${input.bands.length} filters.`,
        outputGainDb: Math.max(-12, Math.min(0, isFinite(preamp) ? preamp : -3.5)),
        bands: sanitizeBands(input.bands, id),
        match: (input.match ?? []).map((m) => m.toLowerCase()).filter(Boolean),
      };
      inject(profile);
      const profiles = [...get().profiles, profile];
      set({ profiles });
      persist(profiles);
      return id;
    },

    removeProfile: (id) => {
      eject(id);
      const profiles = get().profiles.filter((p) => p.id !== id);
      set({ profiles });
      persist(profiles);
    },

    renameProfile: (id, name) => {
      const trimmed = name.trim().slice(0, 80);
      if (!trimmed) return;
      const profiles = get().profiles.map((p) =>
        p.id === id ? { ...p, name: trimmed } : p,
      );
      const updated = profiles.find((p) => p.id === id);
      if (updated) inject(updated);
      set({ profiles });
      persist(profiles);
    },
  };
});
