import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { create } from "zustand";
import {
  HEADPHONES,
  deviceTypeOf,
  searchHeadphones,
  type HeadphoneFormFactor,
  type HeadphoneProfile,
} from "@/audio/headphoneProfiles";
import { parseAutoEq, formatAutoEq } from "@/lib/autoEq";
import { useCustomHeadphonesStore } from "@/state/customHeadphonesStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";

/**
 * "I have these cans" wizard (v1.5). Three paths to a correction profile:
 *   1. Find your model in the built-in ~130-profile catalog.
 *   2. Import an AutoEq ParametricEQ.txt for anything we don't ship.
 *   3. Generic form-factor fallback (Harman target / neutral).
 *
 * Opened from Settings and from the first-run onboarding tour, so the
 * open flag lives in a tiny standalone store and the modal mounts once
 * in App.tsx.
 */

interface WizardOpenState {
  open: boolean;
  openWizard: () => void;
  closeWizard: () => void;
}

export const useHeadphoneWizardStore = create<WizardOpenState>((set) => ({
  open: false,
  openWizard: () => set({ open: true }),
  closeWizard: () => set({ open: false }),
}));

export function openHeadphoneWizard(): void {
  useHeadphoneWizardStore.getState().openWizard();
}

type WizardStep = "search" | "import" | "fallback";

const FALLBACKS: Array<{ label: string; sub: string; profileId: string }> = [
  { label: "Headphones (over-ear / on-ear)", sub: "Harman over-ear target curve", profileId: "harman" },
  { label: "IEM / earbuds", sub: "Harman target, gentle voicing", profileId: "harman" },
  { label: "Desktop / bookshelf speakers", sub: "Generic PC speaker correction", profileId: "generic-pc-speakers" },
  { label: "Soundbar / TV", sub: "Generic 2.1 soundbar starting point", profileId: "generic-soundbar-21" },
  { label: "Not sure", sub: "Neutral — pure source signal", profileId: "neutral" },
];

export function HeadphoneWizard() {
  const open = useHeadphoneWizardStore((s) => s.open);
  const closeWizard = useHeadphoneWizardStore((s) => s.closeWizard);
  const [step, setStep] = useState<WizardStep>("search");
  const [query, setQuery] = useState("");

  const settings = useSettingsStore();
  const setHeadphoneProfile = useAudioStore((s) => s.setHeadphoneProfile);
  const toast = useUIStore((s) => s.toast);

  const customs = useCustomHeadphonesStore((s) => s.profiles);
  const addProfile = useCustomHeadphonesStore((s) => s.addProfile);
  const removeProfile = useCustomHeadphonesStore((s) => s.removeProfile);

  // Import-step form state.
  const [impName, setImpName] = useState("");
  const [impBrand, setImpBrand] = useState("");
  const [impForm, setImpForm] = useState<HeadphoneFormFactor>("over-ear");
  const [impText, setImpText] = useState<string | null>(null);
  const [impError, setImpError] = useState<string | null>(null);
  const importParsed = useMemo(
    () => (impText ? parseAutoEq(impText) : null),
    [impText],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!open) return [];
    const found = searchHeadphones(query).filter(
      (h) => deviceTypeOf(h) === "headphones",
    );
    found.sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
    return found.slice(0, 40);
  }, [query, open, customs.length]);

  if (!open) return null;

  const activate = (id: string, name?: string) => {
    settings.set("headphone", id);
    setHeadphoneProfile(id);
    toast(`Correction: ${name ?? HEADPHONES[id]?.name ?? id}`);
    closeWizard();
    setStep("search");
    setQuery("");
  };

  const pickImportFile = async () => {
    setImpError(null);
    const api = window.playground?.files;
    if (api?.openText) {
      const res = await api.openText([{ name: "AutoEq / EQ text", extensions: ["txt", "csv"] }]);
      if (!res) return;
      handleImportText(res.text, res.path);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleImportText = (text: string, path?: string) => {
    const parsed = parseAutoEq(text);
    if (!parsed) {
      setImpError("Couldn't find any parametric filters in that file. Expected AutoEq ParametricEQ.txt format.");
      setImpText(null);
      return;
    }
    setImpText(text);
    setImpError(null);
    if (!impName && path) {
      // AutoEq files are usually named "<Model> ParametricEQ.txt".
      const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
      const guess = base.replace(/\s*param(etric)?\s*eq.*$/i, "").replace(/\.(txt|csv)$/i, "").trim();
      if (guess) setImpName(guess);
    }
  };

  const saveImport = () => {
    if (!importParsed) return;
    const id = addProfile({
      name: impName.trim() || "Imported profile",
      brand: impBrand.trim() || "Custom",
      formFactor: impForm,
      bands: importParsed.bands,
      preampDb: importParsed.preampDb,
      match: impName.trim() ? [impName.trim().toLowerCase()] : [],
    });
    setImpText(null);
    setImpName("");
    setImpBrand("");
    activate(id);
  };

  const exportCustom = async (p: HeadphoneProfile) => {
    const api = window.playground?.files;
    if (!api?.save) {
      toast("Export needs the desktop build");
      return;
    }
    const text = formatAutoEq(p.outputGainDb, p.bands);
    const b64 = btoa(unescape(encodeURIComponent(text)));
    const saved = await api.save(
      `${p.name} ParametricEQ.txt`,
      [{ name: "AutoEq text", extensions: ["txt"] }],
      b64,
    );
    if (saved) toast("Profile exported");
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-sm grid place-items-center p-6"
        onClick={closeWizard}
      >
        <motion.div
          initial={{ y: 20, scale: 0.97, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 30 }}
          className="glass-strong max-w-2xl w-full rounded-2xl p-6 max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Headphone setup wizard"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-cyan mb-1">
                Headphone setup
              </div>
              <div className="text-xl font-semibold neon-text">I have these cans</div>
            </div>
            <button
              onClick={closeWizard}
              className="text-dim hover:text-white transition text-lg leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Step tabs */}
          <div className="mt-4 kc-seg">
            {(
              [
                ["search", "1. Find my model"],
                ["import", "2. Import AutoEq"],
                ["fallback", "3. Generic fallback"],
              ] as Array<[WizardStep, string]>
            ).map(([s, label]) => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`kc-seg-btn ${step === s ? "kc-on" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>

          {step === "search" && (
            <div className="mt-4">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search brand or model — "HD 650", "soundbar", "laptop"...'
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
              />
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
                {results.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => activate(h.id, h.name)}
                    className={`rounded-xl p-3 border text-left transition ${
                      settings.headphone === h.id
                        ? "border-cyan/60 bg-cyan/10"
                        : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.25em] text-dim">
                      {h.brand} - {h.formFactor.replace("-", " ")}
                    </div>
                    <div className="text-sm font-semibold">{h.name}</div>
                  </button>
                ))}
                {results.length === 0 && (
                  <div className="col-span-full text-[12px] text-dim p-4 text-center">
                    No match. Try the AutoEq import or the generic fallback tab.
                  </div>
                )}
              </div>
              <div className="mt-3 text-[11px] text-dim">
                Not listed? AutoEq publishes corrections for thousands of models —
                grab the <span className="text-white/80">ParametricEQ.txt</span> for
                your headphones and import it in step 2.
              </div>
            </div>
          )}

          {step === "import" && (
            <div className="mt-4">
              <div className="text-[12px] text-dim leading-relaxed">
                Import an AutoEq <span className="text-white/80">ParametricEQ.txt</span>{" "}
                (or any EQ text in the same format). The filters become a custom
                correction profile that shows up everywhere the built-ins do.
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={impName}
                  onChange={(e) => setImpName(e.target.value)}
                  placeholder="Model name (e.g. HD 560S)"
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
                />
                <input
                  value={impBrand}
                  onChange={(e) => setImpBrand(e.target.value)}
                  placeholder="Brand (e.g. Sennheiser)"
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={impForm}
                  onChange={(e) => setImpForm(e.target.value as HeadphoneFormFactor)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
                >
                  <option value="over-ear">Over-ear</option>
                  <option value="on-ear">On-ear</option>
                  <option value="iem">IEM</option>
                  <option value="true-wireless">True wireless</option>
                  <option value="open-back">Open-back</option>
                  <option value="generic">Other</option>
                </select>
                <button
                  onClick={() => void pickImportFile()}
                  className="kc-btn kc-btn--sm kc-btn--accent"
                >
                  Pick ParametricEQ.txt…
                </button>
                {/* Browser fallback when the desktop file bridge is missing. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void f.text().then((t) => handleImportText(t, f.name));
                    e.target.value = "";
                  }}
                />
              </div>
              {impError && (
                <div className="mt-2 text-[12px] text-red-400">{impError}</div>
              )}
              {importParsed && (
                <div className="mt-3 rounded-xl border border-cyan/30 bg-cyan/5 p-3">
                  <div className="text-[11px] uppercase tracking-widest text-cyan">
                    Parsed OK
                  </div>
                  <div className="text-[12px] text-white/85 mt-1">
                    {importParsed.bands.length} filters, preamp{" "}
                    {importParsed.preampDb.toFixed(1)} dB
                  </div>
                  <button
                    onClick={saveImport}
                    className="kc-btn kc-btn--sm kc-btn--primary mt-2"
                  >
                    Save & activate
                  </button>
                </div>
              )}

              {customs.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.25em] text-dim mb-2">
                    Your imported profiles
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {customs.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{p.name}</div>
                          <div className="text-[10px] text-dim">
                            {p.brand} - {p.bands.length} bands
                          </div>
                        </div>
                        <button
                          onClick={() => activate(p.id, p.name)}
                          className="text-[11px] text-cyan hover:underline"
                        >
                          Use
                        </button>
                        <button
                          onClick={() => void exportCustom(p)}
                          className="text-[11px] text-dim hover:text-white"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => {
                            removeProfile(p.id);
                            if (settings.headphone === p.id) activate("neutral");
                          }}
                          className="text-[11px] text-red-400/80 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "fallback" && (
            <div className="mt-4">
              <div className="text-[12px] text-dim leading-relaxed">
                No exact profile? Pick the closest form factor — you get a sane
                generic starting point, and Calibration can fine-tune from there.
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FALLBACKS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => activate(f.profileId)}
                    className="rounded-xl p-3.5 border border-white/10 hover:border-cyan/40 hover:bg-cyan/5 text-left transition"
                  >
                    <div className="text-sm font-semibold">{f.label}</div>
                    <div className="text-[11px] text-dim mt-0.5">{f.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
