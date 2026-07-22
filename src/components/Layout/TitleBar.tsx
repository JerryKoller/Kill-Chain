import { SystemMonitor } from "@/components/Layout/SystemMonitor";
import { useAudioStore } from "@/state/audioStore";
import { APP_VERSION } from "@/lib/appVersion";

export function TitleBar() {
  // The kill-chain status light: red on standby/bypass, green when the DSP
  // chain is ENGAGED (transport's ENGAGED/BYPASSED state).
  const engaged = useAudioStore((s) => !s.bypass);

  return (
    <div className="titlebar-drag h-9 px-4 flex items-center justify-between text-xs text-dim relative">
      <div className="flex items-center gap-3">
        {/* CSS-only status dot (see .kc-status-* in globals.css) — pulses red
            on standby, green when the chain is engaged. The ring + burst
            children mount fresh on each engage, replaying their one-shot
            animations; disengage fades back to red via the dot's transition. */}
        <div
          className={`kc-status-dot ${engaged ? "kc-status-dot--engaged" : ""}`}
          title={engaged ? "Kill-chain ENGAGED" : "Kill-chain on standby"}
        >
          {engaged && (
            <>
              <span className="kc-status-ring" aria-hidden="true" />
              <span className="kc-status-burst" aria-hidden="true" />
            </>
          )}
        </div>
        <span className="tracking-[0.3em] uppercase text-[10px] text-white/70">
          Kill-Chain
        </span>
        <span className="module-tag">MIL-SPEC</span>
      </div>

      {/* Always-on resource monitor — centred so it clears the native window
          controls on the right regardless of which tool is open. The translate
          transform makes this wrapper a stacking context, so it needs its own
          z-index: at z-auto, any later-in-DOM positioned content (sticky view
          headers at z-20, Airspace at z-20…) painted OVER the detail popover. */}
      <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-[70]">
        <SystemMonitor />
      </div>

      <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-white/40 pr-[120px]">
        <span>{`v${APP_VERSION} · Kill-Chain`}</span>
      </div>
    </div>
  );
}
