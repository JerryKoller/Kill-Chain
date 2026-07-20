import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PresetCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  presetIds: string[];
  createdAt: number;
}

export interface PresetMetadata {
  id: string;
  isFavorite: boolean;
  collections: string[];
  tags: string[];
  lastUsed: number;
  useCount: number;
}

interface FavoritesStore {
  collections: PresetCollection[];
  metadata: Record<string, PresetMetadata>;

  // Collections
  createCollection: (name: string, description?: string, color?: string) => string;
  updateCollection: (id: string, updates: Partial<PresetCollection>) => void;
  deleteCollection: (id: string) => void;
  addPresetToCollection: (presetId: string, collectionId: string) => void;
  removePresetFromCollection: (presetId: string, collectionId: string) => void;

  // Metadata
  toggleFavorite: (presetId: string) => void;
  addTag: (presetId: string, tag: string) => void;
  removeTag: (presetId: string, tag: string) => void;
  recordPresetUse: (presetId: string) => void;

  // Queries
  getFavoritedPresets: () => string[];
  getPresetsInCollection: (collectionId: string) => string[];
  getPresetsByTag: (tag: string) => string[];
  getTrendingPresets: () => string[];
}

const DEFAULT_COLLECTIONS: PresetCollection[] = [
  {
    id: "favorites",
    name: "Favorites",
    description: "Your go-to tunings",
    color: "#ff5b8a",
    presetIds: [],
    createdAt: Date.now(),
  },
  {
    id: "recent",
    name: "Recently Used",
    description: "Your 20 most recent",
    color: "#22e8ff",
    presetIds: [],
    createdAt: Date.now(),
  },
];

export const useFavoritesStore = create<FavoritesStore>()(
  persist(
    (set, get) => ({
      collections: DEFAULT_COLLECTIONS,
      metadata: {},

      createCollection: (name, description = "", color = "#7a3bff") => {
        const id = Math.random().toString(36).slice(2);
        const collection: PresetCollection = {
          id,
          name,
          description,
          color,
          presetIds: [],
          createdAt: Date.now(),
        };
        set((state) => ({
          collections: [...state.collections, collection],
        }));
        return id;
      },

      updateCollection: (id, updates) => {
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === id ? { ...c, ...updates } : c,
          ),
        }));
      },

      deleteCollection: (id) => {
        if (id === "favorites" || id === "recent") return; // Prevent delete built-in
        set((state) => ({
          collections: state.collections.filter((c) => c.id !== id),
          metadata: Object.fromEntries(
            Object.entries(state.metadata).map(([presetId, meta]) => [
              presetId,
              {
                ...meta,
                collections: (meta.collections || []).filter((cId) => cId !== id),
              },
            ]),
          ),
        }));
      },

      addPresetToCollection: (presetId, collectionId) => {
        set((state) => {
          const collection = state.collections.find((c) => c.id === collectionId);
          if (!collection || collection.presetIds.includes(presetId)) return state;

          const existing = state.metadata[presetId] || {
            id: presetId,
            isFavorite: false,
            collections: [],
            tags: [],
            lastUsed: 0,
            useCount: 0,
          };

          return {
            collections: state.collections.map((c) =>
              c.id === collectionId
                ? { ...c, presetIds: [...c.presetIds, presetId] }
                : c,
            ),
            metadata: {
              ...state.metadata,
              [presetId]: {
                ...existing,
                collections: Array.from(
                  new Set([...existing.collections, collectionId]),
                ),
              },
            },
          };
        });
      },

      removePresetFromCollection: (presetId, collectionId) => {
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === collectionId
              ? { ...c, presetIds: c.presetIds.filter((p) => p !== presetId) }
              : c,
          ),
          metadata: {
            ...state.metadata,
            [presetId]: {
              ...state.metadata[presetId],
              collections: (state.metadata[presetId]?.collections || []).filter(
                (cId) => cId !== collectionId,
              ),
            },
          },
        }));
      },

      toggleFavorite: (presetId) => {
        set((state) => {
          const isFav = state.metadata[presetId]?.isFavorite ?? false;
          const meta = {
            ...state.metadata,
            [presetId]: {
              ...(state.metadata[presetId] || {
                id: presetId,
                collections: [],
                tags: [],
                lastUsed: 0,
                useCount: 0,
              }),
              isFavorite: !isFav,
            },
          };

          // Sync with favorites collection
          const favCollection = state.collections.find((c) => c.id === "favorites");
          if (favCollection) {
            const collections = state.collections.map((c) => {
              if (c.id === "favorites") {
                const inFav = c.presetIds.includes(presetId);
                return {
                  ...c,
                  presetIds: isFav
                    ? c.presetIds.filter((p) => p !== presetId)
                    : Array.from(new Set([...c.presetIds, presetId])),
                };
              }
              return c;
            });
            return { collections, metadata: meta };
          }

          return { metadata: meta };
        });
      },

      addTag: (presetId, tag) => {
        set((state) => ({
          metadata: {
            ...state.metadata,
            [presetId]: {
              ...(state.metadata[presetId] || {
                id: presetId,
                isFavorite: false,
                collections: [],
                lastUsed: 0,
                useCount: 0,
              }),
              tags: Array.from(
                new Set([...(state.metadata[presetId]?.tags || []), tag]),
              ),
            },
          },
        }));
      },

      removeTag: (presetId, tag) => {
        set((state) => ({
          metadata: {
            ...state.metadata,
            [presetId]: {
              ...state.metadata[presetId],
              tags: (state.metadata[presetId]?.tags || []).filter((t) => t !== tag),
            },
          },
        }));
      },

      recordPresetUse: (presetId) => {
        set((state) => {
          const meta = state.metadata[presetId] || {
            id: presetId,
            isFavorite: false,
            collections: [],
            tags: [],
            lastUsed: 0,
            useCount: 0,
          };
          return {
            metadata: {
              ...state.metadata,
              [presetId]: {
                ...meta,
                lastUsed: Date.now(),
                useCount: meta.useCount + 1,
              },
            },
            collections: state.collections.map((c) => {
              if (c.id === "recent") {
                const filtered = c.presetIds.filter((p) => p !== presetId);
                return {
                  ...c,
                  presetIds: [presetId, ...filtered].slice(0, 20),
                };
              }
              return c;
            }),
          };
        });
      },

      getFavoritedPresets: () => {
        const state = get();
        return Object.entries(state.metadata)
          .filter(([_, meta]) => meta.isFavorite)
          .map(([id]) => id);
      },

      getPresetsInCollection: (collectionId) => {
        const state = get();
        const collection = state.collections.find((c) => c.id === collectionId);
        return collection?.presetIds ?? [];
      },

      getPresetsByTag: (tag) => {
        const state = get();
        return Object.entries(state.metadata)
          .filter(([_, meta]) => meta.tags.includes(tag))
          .map(([id]) => id);
      },

      getTrendingPresets: () => {
        const state = get();
        return Object.entries(state.metadata)
          .sort(([_, a], [__, b]) => b.useCount - a.useCount)
          .slice(0, 10)
          .map(([id]) => id);
      },
    }),
    {
      name: "audio-playground-favorites",
    },
  ),
);
