import { useEffect, useState } from "react";
import { SystemMonitor } from "@/components/Layout/SystemMonitor";
import { useAudioStore } from "@/state/audioStore";
import { APP_VERSION } from "@/lib/appVersion";

/** Hover-reveal min / max / close — hidden until the cursor enters the corner. */
function WindowChrome() {
  const [maximized, setMaximized] = useState(false);
  const api = typeof window !== "undefined" ? window.playground?.window : undefined;

  useEffect(() => {
    if (!api?.isMaximized) return;
    void api.isMaximized().then((v) => setMaximized(!!v));
  }, [api]);

  if (!api?.minimize) return null;

  const btn =
    "h-9 w-11 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors";

  return (
    <div
      className="titlebar-no-drag absolute right-0 top-0 z-[80] flex h-9 items-center opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100"
      title="Window controls"
    >
      {/* Invisible widen so the corner is easy to find before fade-in */}
      <div className="pointer-events-none absolute inset-y-0 -left-8 w-8" aria-hidden />
      <button
        type="button"
        className={btn}
        onClick={() => void api.minimize()}
        aria-label="Minimize"
        title="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className={btn}
        onClick={async () => {
          const next = await api.maximize();
          if (typeof next === "boolean") setMaximized(next);
          else if (api.isMaximized) setMaximized(!!(await api.isMaximized()));
        }}
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <rect x="2.5" y="1" width="6" height="6" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 3.5H7v5.5H1.5z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={`${btn} hover:!bg-rose-600/90 hover:!text-white`}
        onClick={() => void api.close()}
        aria-label="Close"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

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

      {/* Always-on resource monitor — centred. The translate transform makes
          this wrapper a stacking context, so it needs its own z-index. */}
      <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-[70]">
        <SystemMonitor />
      </div>

      <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-white/40 pr-2">
        <span>{`v${APP_VERSION} · Kill-Chain`}</span>
      </div>

      <WindowChrome />
    </div>
  );
}
