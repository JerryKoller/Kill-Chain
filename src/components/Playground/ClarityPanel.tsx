import { GlassPanel } from "@/components/shared/GlassPanel";
import { Knob } from "@/components/shared/Knob";
import { useAudioStore } from "@/state/audioStore";

/**
 * Clarity Engine — one knob whose only job is CLEAN. Four coordinated moves:
 * a dynamic mud duck (180-450 Hz, only when it piles up), a sub-sonic rumble
 * gate, the classic "remove the blanket" tilt, and an edge guard that keeps
 * the opened top end from turning harsh.
 */
export function ClarityPanel() {
  const clarity = useAudioStore((s) => s.clarity);
  const setClarity = useAudioStore((s) => s.setClarity);

  return (
    <GlassPanel intense className="p-5">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="shrink-0">
          <Knob
            value={clarity}
            onChange={setClarity}
            size={104}
            color="#8be9ff"
            label="Clarity"
            hint="One knob — wipe the glass"
            bipolar={false}
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="text-xs uppercase tracking-[0.3em] text-dim flex items-center gap-2">
            Clarity Engine
            {clarity > 0.01 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#8be9ff]/20 text-[#8be9ff] tracking-normal">
                ON
              </span>
            )}
          </div>
          <div className="text-base font-semibold mb-1.5">
            Clear the signal — mud out, veil off, edge guarded
          </div>
          <div className="text-[12px] text-dim leading-relaxed">
            A dynamic dip hunts low-mid mud only when it builds up, a rumble gate clears
            sub-sonic junk, a gentle tilt lifts the veil, and an edge guard keeps the opened
            top end smooth. All four scale with the one knob — 30-50% suits most tracks.
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
