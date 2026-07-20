import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { NeonButton } from "@/components/shared/NeonButton";
import { ActionBar } from "@/components/shared/ActionBar";
import { PRESETS, morphPresets, type Preset } from "@/audio/presets";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { usePreviewSession } from "@/hooks/usePreviewSession";
import { useUserPresetsStore, type UserPreset } from "@/state/userPresetsStore";
import { useFavoritesStore } from "@/state/favoritesStore";

type AnyPreset = Preset | UserPreset;

function isUser(p: AnyPreset): p is UserPreset {
  return "createdAt" in p;
}

export function EnhancedPresetsView() {
  const replaceParams = useAudioStore((s) => s.replaceParams);
  const previewParams = useAudioStore((s) => s.previewParams);
  const toast = useUIStore((s) => s.toast);
  const preview = usePreviewSession();

  const userPresets = useUserPresetsStore((s) => s.presets);
  const renamePreset = useUserPresetsStore((s) => s.renamePreset);
  const deletePreset = useUserPresetsStore((s) => s.deletePreset);
  const collections = useFavoritesStore((s) => s.collections);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const recordPresetUse = useFavoritesStore((s) => s.recordPresetUse);
  const createCollection = useFavoritesStore((s) => s.createCollection);
  const getPresetsInCollection = useFavoritesStore((s) => s.getPresetsInCollection);
  const favoritesMetadata = useFavoritesStore((s) => s.metadata);

  const [activeCollectionId, setActiveCollectionId] = useState<string | null>("favorites");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");
  const [aId, setAId] = useState(PRESETS[1]?.id ?? PRESETS[0].id);
  const [bId, setBId] = useState(PRESETS[3]?.id ?? PRESETS[0].id);
  const [mix, setMix] = useState(0.5);
  // Inline rename / two-tap delete for user presets (no native dialogs).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const allPresets: AnyPreset[] = useMemo(
    () => [...PRESETS, ...userPresets],
    [userPresets],
  );

  const activeCollection = collections.find((c) => c.id === activeCollectionId);
  const presetsInActive = activeCollectionId
    ? getPresetsInCollection(activeCollectionId).map((id: string) =>
        allPresets.find((p) => p.id === id),
      )
    : [];

  const morphA = allPresets.find((p) => p.id === aId) ?? allPresets[0];
  const morphB = allPresets.find((p) => p.id === bId) ?? allPresets[1] ?? allPresets[0];

  const blended = useMemo(
    () =>
      morphPresets([
        { params: morphA.params, weight: 1 - mix },
        { params: morphB.params, weight: mix },
      ]),
    [morphA, morphB, mix],
  );

  // Only preview once the user interacts with the blend — opening the tab is
  // silent, and leaving without committing restores the previous sound.
  useEffect(() => {
    if (!preview.startedRef.current) return;
    previewParams(blended);
  }, [blended, previewParams, preview.startedRef]);

  const handleApplyPreset = (preset: AnyPreset) => {
    preview.commit();
    replaceParams(preset.params);
    recordPresetUse(preset.id);
    toast(`Applied: ${preset.name}`);
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Armory"
        code="KC-12"
        subtitle={`${PRESETS.length} issued loadouts · ${userPresets.length} of your own · ${collections.length} collections`}
      />

      {/* Collections sidebar */}
      <div className="grid grid-cols-12 gap-3">
        <GlassPanel intense className="col-span-12 lg:col-span-3 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-dim mb-3">
            Collections
          </div>

          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {collections.map((coll) => (
              <motion.button
                key={coll.id}
                onClick={() => setActiveCollectionId(coll.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                  activeCollectionId === coll.id
                    ? "bg-white/10 border border-white/20"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: coll.color }}
                  />
                  <span className="font-medium">{coll.name}</span>
                  <span className="text-xs text-white/40 ml-auto">
                    {coll.presetIds.length}
                  </span>
                </div>
                {coll.description && (
                  <div className="text-xs text-white/40 mt-1">{coll.description}</div>
                )}
              </motion.button>
            ))}
          </div>

          {showNewCollection ? (
            <div className="mt-3 p-3 bg-white/5 rounded-lg border border-white/10">
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Collection name"
                className="w-full bg-white/5 border border-white/20 rounded px-2 py-1 text-sm mb-2 focus:outline-none focus:border-cyan-400/50"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (newCollectionName.trim()) {
                      createCollection(newCollectionName.trim());
                      setNewCollectionName("");
                      setShowNewCollection(false);
                      toast("Collection created");
                    }
                  }}
                  className="flex-1 px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 rounded text-xs font-semibold text-cyan-300 transition"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewCollection(false);
                    setNewCollectionName("");
                  }}
                  className="flex-1 px-2 py-1 bg-white/10 hover:bg-white/15 rounded text-xs text-white/60 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewCollection(true)}
              className="w-full mt-3 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-semibold text-white/70 transition border border-white/10"
            >
              + New Collection
            </button>
          )}
        </GlassPanel>

        {/* Presets grid */}
        <GlassPanel intense className="col-span-12 lg:col-span-9 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-dim mb-3">
            {activeCollection?.name || "Presets"}
          </div>
          {activeCollection?.description && (
            <p className="text-xs text-white/50 mb-3">{activeCollection.description}</p>
          )}

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence>
              {presetsInActive.map((preset: AnyPreset | undefined) => {
                if (!preset) return null;
                const isFav = favoritesMetadata[preset.id]?.isFavorite;
                return (
                  <motion.div
                    key={preset.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="group p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/15 transition flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-semibold text-sm text-white">
                          {preset.name}
                        </div>
                        {!isUser(preset) && (
                          <div className="text-xs text-white/50 mt-0.5">{preset.blurb}</div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleFavorite(preset.id)}
                        className="text-lg group-hover:scale-125 transition"
                      >
                        {isFav ? "❤️" : "🤍"}
                      </button>
                    </div>

                    <button
                      onClick={() => handleApplyPreset(preset)}
                      data-ui-sound="none" // voiced centrally: preset apply plays the latch clack
                      className="w-full px-2 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs font-semibold text-cyan-300 rounded transition"
                    >
                      Apply
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {presetsInActive.length === 0 && (
            <div className="text-center py-12">
              <div className="text-white/40 text-sm">
                {activeCollection?.id === "favorites"
                  ? "No favorites yet — click the heart to add presets"
                  : "This collection is empty"}
              </div>
            </div>
          )}
        </GlassPanel>
      </div>

      {/* Morphing blend */}
      <GlassPanel intense className="p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.3em] text-dim">
              Morphing Blend
            </div>
            <div className="text-lg font-semibold truncate">
              {morphA.name}
              <span className="text-dim mx-3">{"\u21C4"}</span>
              {morphB.name}
            </div>
            <div className="text-[11px] text-dim mt-1">
              Move the slider to morph between two presets — preview is live.
            </div>
          </div>
          <NeonButton
            onClick={() => {
              preview.commit();
              replaceParams(blended);
              toast(
                `Locked in blend ${Math.round((1 - mix) * 100)}/${Math.round(mix * 100)}`,
              );
            }}
          >
            Commit blend
          </NeonButton>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select
            value={aId}
            onChange={(e) => { preview.start(); setAId(e.target.value); }}
            className="bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400/50"
          >
            {allPresets.map((p) => (
              <option key={p.id} value={p.id}>
                A: {p.name}
              </option>
            ))}
          </select>
          <select
            value={bId}
            onChange={(e) => { preview.start(); setBId(e.target.value); }}
            className="bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400/50"
          >
            {allPresets.map((p) => (
              <option key={p.id} value={p.id}>
                B: {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 grid grid-cols-[110px_1fr_110px] items-center gap-3">
          <div
            className="text-sm font-semibold truncate text-right"
            style={{ color: "accent" in morphA ? morphA.accent : "#22e8ff" }}
          >
            {morphA.name}
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={mix}
            onChange={(e) => { preview.start(); setMix(Number(e.target.value)); }}
            className="w-full accent-plasma h-8"
          />
          <div
            className="text-sm font-semibold truncate"
            style={{ color: "accent" in morphB ? morphB.accent : "#ff2bd6" }}
          >
            {morphB.name}
          </div>
        </div>

        <div className="relative mt-3 h-3 rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(90deg, ${"accent" in morphA ? morphA.accent : "#22e8ff"}33, ${"accent" in morphB ? morphB.accent : "#ff2bd6"}33)`,
            }}
          />
          <motion.div
            className="absolute top-0 bottom-0 rounded-full"
            animate={{ left: `${mix * 100}%` }}
            transition={{ type: "spring", stiffness: 250, damping: 24 }}
            style={{
              width: 12,
              transform: "translateX(-6px)",
              background: "linear-gradient(180deg, #22e8ff, #ff2bd6)",
              boxShadow: "0 0 18px rgba(255,43,214,0.7)",
            }}
          />
        </div>
      </GlassPanel>

      {/* All presets browser */}
      <GlassPanel intense className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-xs uppercase tracking-[0.3em] text-dim">
            All Available Presets
          </div>
          <input
            type="text"
            value={browseQuery}
            onChange={(e) => setBrowseQuery(e.target.value)}
            placeholder="Search presets…"
            className="w-56 bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {allPresets
            .filter((p) => {
              const q = browseQuery.trim().toLowerCase();
              if (!q) return true;
              const blurb = !isUser(p) ? p.blurb : "";
              return p.name.toLowerCase().includes(q) || blurb.toLowerCase().includes(q);
            })
            .map((preset) => {
            const isFav = favoritesMetadata[preset.id]?.isFavorite;
            return (
              <motion.div
                key={preset.id}
                whileHover={{ scale: 1.02 }}
                onClick={() => handleApplyPreset(preset)}
                role="button"
                data-ui-sound="none" // voiced centrally: preset apply plays the latch clack
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleApplyPreset(preset);
                  }
                }}
                className="relative p-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-white/15 transition text-left group cursor-pointer"
              >
                {renamingId === preset.id ? (
                  <input
                    autoFocus
                    value={renameText}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") { setRenameText(""); setRenamingId(null); }
                    }}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => {
                      if (renameText.trim()) renamePreset(preset.id, renameText.trim());
                      setRenamingId(null);
                    }}
                    className="w-full rounded-md border border-cyan/50 bg-black/50 px-2 py-0.5 text-sm text-white outline-none"
                  />
                ) : (
                  <div className="text-sm font-medium text-white group-hover:text-cyan transition">
                    {preset.name}
                  </div>
                )}
                <div className="text-[10px] text-white/40">
                  {!isUser(preset) ? preset.blurb : "Saved preset"}
                </div>

                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  {isUser(preset) && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(preset.id);
                          setRenameText(preset.name);
                        }}
                        data-ui-sound="press" // opt back in — the card itself is "none"
                        className="w-5 h-5 grid place-items-center rounded border border-white/10 text-[10px] text-white/55 hover:text-white hover:border-white/30"
                        title="Rename"
                      >✎</button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirmDeleteId === preset.id) {
                            deletePreset(preset.id);
                            setConfirmDeleteId(null);
                            toast(`Deleted "${preset.name}"`);
                          } else {
                            setConfirmDeleteId(preset.id);
                            setTimeout(() => setConfirmDeleteId(null), 2400);
                          }
                        }}
                        data-ui-sound="press"
                        className={`h-5 grid place-items-center rounded border text-[10px] transition px-1 ${
                          confirmDeleteId === preset.id
                            ? "border-rose-400/70 bg-rose-500/25 text-rose-100 w-auto"
                            : "border-rose-400/30 text-rose-300/70 hover:text-rose-200 hover:border-rose-400/60 w-5"
                        }`}
                        title="Delete"
                      >{confirmDeleteId === preset.id ? "CONFIRM PURGE" : "✕"}</button>
                    </>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(preset.id);
                    }}
                    data-ui-sound="press"
                    className="text-xs"
                    aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                  >
                    {isFav ? "❤️" : "🤍"}
                  </button>
                </div>
              </motion.div>
            );
            })}
        </div>
      </GlassPanel>
    </div>
  );
}
