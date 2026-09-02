/**
 * "Snap sequencer right": the sequencer alone on the second monitor.
 *
 * The window still spans both displays — content cannot render outside its own
 * window — but the layout is inverted relative to the plain split: everything
 * except the sequencer is confined to the LEFT display (by padding
 * `.kc-app-root`, see fireChrome.css), and the sequencer is lifted out into a
 * fixed panel covering the right display exactly.
 *
 * Rendered through a portal onto <body> for two reasons: the app applies a
 * `zoom` for UI density, which would scale a fixed-position descendant and
 * mis-size the panel; and the same padding that pushes the rest of the app off
 * the right display would otherwise apply to this panel too.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function FireSnapPanel({
  seamPx,
  widthPx,
  onUnsnap,
  children,
}: {
  /** Bezel position in CSS px from the window's left edge. */
  seamPx: number;
  /** Right-region width, from the main process (see useDualMonitor.rightPx). */
  widthPx: number;
  onUnsnap: () => void;
  children: ReactNode;
}) {
  const [host] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.className = "fc-snap-host";
    return el;
  });

  useEffect(() => {
    if (!host) return;
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, [host]);

  if (!host) return null;

  // Authoritative width from the main process. Deriving it from
  // window.innerWidth here raced the asynchronous window resize and produced a
  // zero-width panel on the first expand.
  const width = Math.max(320, widthPx);

  return createPortal(
    <div
      className="fc-snap-panel"
      style={{ left: `${seamPx}px`, width: `${width}px` }}
      aria-label="Sequencer (second display)"
    >
      <div className="fc-snap-panel__bar">
        <span className="fc-snap-panel__title">Sequencer</span>
        <span className="fc-snap-panel__hint">Second display</span>
        <button
          type="button"
          className="fc-snap-panel__close fc-focus"
          onClick={onUnsnap}
          title="Bring the sequencer back to one screen"
          aria-label="Bring the sequencer back to this screen"
        >
          Undock
        </button>
      </div>
      <div className="fc-snap-panel__body">{children}</div>
    </div>,
    host,
  );
}
