import { GlassPanel } from "@/components/shared/GlassPanel";
import { useCalibrationStore, MODE_STEPS, type CalibMode, type GenreId } from "@/state/calibrationStore";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { ReferenceClipsBar } from "./ReferenceClipsBar";

const MODE_BLURBS: Record<CalibMode, { label: string; subtitle: string }> = {
  quick:    { label: "Quick",    subtitle: "12 questions - ~60s" },
  standard: { label: "Standard", subtitle: "30 questions - ~3 min" },
  deep:     { label: "Deep",     subtitle: "60 questions - ~6 min" },
};

export function CalibrationToolbar() {
  const mode = useCalibrationStore((s) => s.mode);
  const start = useCalibrationStore((s) => s.start);
  const blind = useCalibrationStore((s) => s.blind);
  const setBlind = useCalibrationStore((s) => s.setBlind);
  const activeGenre = useCalibrationStore((s) => s.activeGenre);
  const slots = useCalibrationStore((s) => s.slots);
  const setActiveGenre = useCalibrationStore((s) => s.setActiveGenre);
  const saveToActiveGenre = useCalibrationStore((s) => s.saveToActiveGenre);
  const loadActiveGenre = useCalibrationStore((s) => s.loadActiveGenre);
  const replaceParams = useAudioStore((s) => s.replaceParams);
  const params = useAudioStore((s) => s.params);
  const toast = useUIStore((s) => s.toast);

  return (
    <GlassPanel intense className="p-4 space-y-4">
        {/* Mode + blind */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(MODE_STEPS) as CalibMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  start(m);
                  toast(`Started ${MODE_BLURBS[m].label} calibration`);
                }}
                className={`text-left rounded-xl border px-3 py-2 transition ${
                  mode === m
                    ? "border-cyan/60 bg-cyan/10 text-cyan"
                    : "border-white/10 hover:border-white/25 text-white/80"
                }`}
              >
                <div className="text-sm font-semibold">{MODE_BLURBS[m].label}</div>
                <div className="text-[10px] text-dim">{MODE_BLURBS[m].subtitle}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <ToggleBtn
              label="Blind A/B"
              sub="Hide which side is which"
              on={blind}
              onClick={() => setBlind(!blind)}
            />
          </div>
        </div>

        {/* Reference clips */}
        <ReferenceClipsBar />

        {/* Genre slots */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2">
            Per-genre profile slot
          </div>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                key={slot.id}
                onClick={() => setActiveGenre(slot.id as GenreId)}
                className={`rounded-lg border px-3 py-1.5 text-left transition ${
                  activeGenre === slot.id
                    ? "border-cyan/60 bg-cyan/10 text-cyan"
                    : "border-white/10 hover:border-white/25 text-white/75"
                }`}
              >
                <div className="text-sm font-medium">{slot.name}</div>
                <div className="text-[10px] text-dim">{slot.blurb}</div>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-dim">
            <span>Slot {`"${activeGenre}"`} actions:</span>
            <button
              onClick={() => {
                saveToActiveGenre(params);
                toast(`Saved current tuning into "${activeGenre}"`);
              }}
              className="rounded-md border border-white/12 px-2 py-1 hover:border-cyan/40 hover:text-cyan"
            >
              Save current
            </button>
            <button
              onClick={() => {
                replaceParams(loadActiveGenre());
                toast(`Loaded "${activeGenre}"`);
              }}
              className="rounded-md border border-white/12 px-2 py-1 hover:border-cyan/40 hover:text-cyan"
            >
              Load
            </button>
          </div>
        </div>
    </GlassPanel>
  );
}

function ToggleBtn({
  label,
  sub,
  on,
  onClick,
}: {
  label: string;
  sub: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-left transition ${
        on
          ? "border-plasma/60 bg-plasma/10 text-plasma"
          : "border-white/10 hover:border-white/25 text-white/80"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-[10px] text-dim">{sub}</div>
    </button>
  );
}
