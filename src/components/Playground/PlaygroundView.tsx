import { GlassPanel } from "@/components/shared/GlassPanel";
import { ParamKnob } from "@/components/shared/ParamKnob";
import { ActionBar } from "@/components/shared/ActionBar";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import {
  SOUND_PARAM_META,
  TONE_KEYS,
  type SoundParams,
} from "@/audio/types";
import { BandEQPanel } from "./BandEQPanel";
import { EQResponseCurve } from "./EQResponseCurve";
import { ProToolsPanel } from "./ProToolsPanel";
import { LoFiPanel } from "./LoFiPanel";
import { RestorePanel } from "./RestorePanel";
import { ClarityPanel } from "./ClarityPanel";
import { AdvancedMeter } from "@/components/Metering/AdvancedMeter";
import { HEADPHONES } from "@/audio/headphoneProfiles";
import { useSettingsStore } from "@/state/settingsStore";

const DYNAMICS_KEYS: (keyof SoundParams)[] = ["punch", "texture", "compression"];
const SPACE_KEYS: (keyof SoundParams)[] = ["width", "spatial", "reverbAmount", "reverbSize"];
const COLOR_KEYS: (keyof SoundParams)[] = ["harmonics", "saturation"];

function metaFor(k: keyof SoundParams) {
  return SOUND_PARAM_META.find((m) => m.key === k)!;
}

export function PlaygroundView() {
  const storeAB = useAudioStore((s) => s.storeAB);
  const swapAB = useAudioStore((s) => s.swapAB);
  const clearAB = useAudioStore((s) => s.clearAB);
  const abSnapshot = useAudioStore((s) => s.abSnapshot);
  const correctionEnabled = useAudioStore((s) => s.correctionEnabled);
  const toggleCorrection = useAudioStore((s) => s.toggleCorrection);
  const toast = useUIStore((s) => s.toast);
  const headphoneId = useSettingsStore((s) => s.headphone);
  const headphone = HEADPHONES[headphoneId] ?? HEADPHONES.xm6;

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Sculptor"
        code="KC-01"
        subtitle="Shape the signal — every band, slider, and toggle locks into a savable loadout"
      />

      {/* ─── Top row: configurable parametric EQ + quick actions ─── */}
      <div className="grid grid-cols-12 gap-3">
        <BandEQPanel />

        <GlassPanel intense className="col-span-12 xl:col-span-4 p-4 flex flex-col gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-dim">
              Reference
            </div>
            <div className="text-xl font-semibold">Compare &amp; calibrate</div>
            <p className="text-[11px] text-dim mt-1 leading-relaxed">
              Quick Sculpts now live in <span className="text-cyan">Morph Lab</span>.
            </p>
          </div>

          {/* A/B Compare — tight 2-col layout */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-[0.3em] text-dim">
                A / B Compare
              </div>
              {abSnapshot && (
                <span className="text-[10px] uppercase tracking-widest text-cyan/90 border border-cyan/40 bg-cyan/10 rounded-full px-2 py-0.5">
                  A locked
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { storeAB(); toast("Snapshot A locked"); }}
                className="h-9 rounded-lg border border-white/12 hover:bg-white/5 hover:border-white/25 text-xs font-medium transition"
              >
                Snapshot A
              </button>
              <button
                onClick={() => {
                  if (!abSnapshot) { toast("Snapshot A first"); return; }
                  swapAB();
                  toast("Swapped A ↔ B");
                }}
                disabled={!abSnapshot}
                className={`h-9 rounded-lg border text-xs font-medium transition ${
                  abSnapshot
                    ? "border-cyan/50 bg-cyan/10 text-cyan hover:bg-cyan/20"
                    : "border-white/8 bg-white/[0.02] text-white/30 cursor-not-allowed"
                }`}
              >
                Swap A ↔ B
              </button>
            </div>
            {abSnapshot && (
              <button
                onClick={() => { clearAB(); toast("Snapshot A released"); }}
                className="mt-2 w-full text-[11px] text-white/55 hover:text-white/80 underline-offset-2 hover:underline"
              >
                Release snapshot A
              </button>
            )}
          </div>

          {/* Headphone correction toggle */}
          <div className="mt-auto">
            <div className="text-xs uppercase tracking-[0.3em] text-dim mb-2">
              Headphone Correction
            </div>
            <button
              onClick={() => {
                toggleCorrection();
                toast(
                  correctionEnabled
                    ? `${headphone.name} correction OFF (raw)`
                    : `${headphone.name} correction ON`,
                );
              }}
              className={`w-full rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                correctionEnabled
                  ? "border-cyan/60 bg-cyan/10 text-cyan shadow-[0_0_22px_rgba(34,232,255,0.35)]"
                  : "border-white/12 bg-white/[0.03] text-white/70 hover:border-white/20"
              }`}
            >
              {headphone.name} EQ · {correctionEnabled ? "ON" : "OFF"}
            </button>
            <p className="text-[11px] text-dim mt-2 leading-relaxed">
              Turn off for a raw, unprocessed reference identical to Windows.
            </p>
          </div>
        </GlassPanel>
      </div>

      {/* ─── EQ Response Curve + Advanced Metering Row ─── */}
      <div className="grid grid-cols-12 gap-3">
        <GlassPanel intense className="col-span-12 lg:col-span-8 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-dim mb-2">
            Telemetry · Frequency Response
          </div>
          <div className="h-[220px]">
            <EQResponseCurve />
          </div>
        </GlassPanel>

        <div className="col-span-12 lg:col-span-4">
          <AdvancedMeter />
        </div>
      </div>

      {/* ─── Quick tone knobs (friendly EQ; also used by Calibration) ─── */}
      <GlassPanel className="p-4">
        <SectionHeader title="Tone" hint="Quick tone bands" />
        <div className="mt-4 grid gap-3 grid-cols-5 md:grid-cols-10">
          {TONE_KEYS.map((k) => {
            const m = metaFor(k);
            return (
              <ParamKnob
                key={k}
                paramKey={k}
                size={80}
                color={m.color}
                label={m.label}
                hint={m.hint}
                bipolar
              />
            );
          })}
        </div>
      </GlassPanel>

      {/* ─── Dynamics & Color | Space ─── */}
      <div className="grid grid-cols-12 gap-3">
        <GlassPanel className="col-span-12 xl:col-span-7 p-4">
          <SectionHeader title="Dynamics & Color" hint="Transient shape, glue, and drive" />
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mt-4">
            {[...DYNAMICS_KEYS, ...COLOR_KEYS].map((k) => {
              const m = metaFor(k);
              return (
                <ParamKnob
                  key={k}
                  paramKey={k}
                  size={88}
                  color={m.color}
                  label={m.label}
                  hint={m.hint}
                  bipolar={m.bipolar !== false}
                />
              );
            })}
          </div>
        </GlassPanel>

        <GlassPanel className="col-span-12 xl:col-span-5 p-4">
          <SectionHeader title="Space" hint="Stereo image, ambience, and room" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {SPACE_KEYS.map((k) => {
              const m = metaFor(k);
              return (
                <ParamKnob
                  key={k}
                  paramKey={k}
                  size={92}
                  color={m.color}
                  label={m.label}
                  hint={m.hint}
                  bipolar={m.bipolar !== false}
                />
              );
            })}
          </div>
        </GlassPanel>
      </div>

      {/* ─── Clarity Engine ─── */}
      <ClarityPanel />

      {/* ─── Restoration Bay (collapsible) ─── */}
      <RestorePanel />

      {/* ─── Lo-Fi tape (collapsible) ─── */}
      <LoFiPanel />

      {/* ─── Pro tools (collapsible) ─── */}
      <ProToolsPanel />
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-dim">{title}</div>
        <div className="text-lg font-semibold">{hint}</div>
      </div>
    </div>
  );
}

