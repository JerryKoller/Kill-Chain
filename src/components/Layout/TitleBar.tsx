import { useEffect, useState, type CSSProperties } from "react";
import { SystemMonitor } from "@/components/Layout/SystemMonitor";
import { useAudioStore } from "@/state/audioStore";
import { APP_VERSION } from "@/lib/appVersion";

/** Electron titlebar drag regions — not in standard CSS typings. */
type AppRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };
const noDrag: AppRegionStyle = { WebkitAppRegion: "no-drag" };
const drag: AppRegionStyle = { WebkitAppRegion: "drag" };

/**
 * Always-visible window controls in a permanent no-drag hit zone.
 * Grid layout keeps SystemMonitor from overlaying min/max/close.
 */
function WindowChrome() {
  const [maximized, setMaximized] = useState(false);
  const api = typeof window !== "undefined" ? window.playground?.window : undefined;

  useEffect(() => {
    if (!api?.isMaximized) return;
    void api.isMaximized().then((v) => setMaximized(!!v));
  }, [api]);

  if (!api?.minimize) return null;

  const btn =
    "h-9 w-11 flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition-colors";

  return (
    <div
      className="titlebar-no-drag relative z-[90] flex h-9 shrink-0 items-center border-l border-white/[0.06] bg-[#07070c]"
      title="Window controls"
      style={noDrag}
    >
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
  const engaged = useAudioStore((s) => !s.bypass);

  return (
    <div
      className="titlebar-drag relative grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center pl-4 text-xs text-dim"
      style={drag}
    >
      <div className="flex min-w-0 items-center gap-3 justify-self-start">
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
        <span className="hidden sm:inline text-[10px] tracking-widest uppercase text-white/35">
          {`v${APP_VERSION}`}
        </span>
      </div>

      <div className="titlebar-no-drag justify-self-center px-2" style={noDrag}>
        <SystemMonitor />
      </div>

      <div className="flex items-center justify-self-end">
        <WindowChrome />
      </div>
    </div>
  );
}
