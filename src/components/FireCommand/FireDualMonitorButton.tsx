/**
 * Expand control: moves the sequencer onto a second display on its own.
 *
 * Deliberately a plain toggle. With the usual two-monitor setup there is only
 * one display the sequencer can go to, so a menu offering "which display" and
 * "which layout" listed choices that had exactly one useful answer each. The
 * chevron therefore only appears with THREE or more displays, where picking a
 * target is a real decision.
 */

import { useEffect, useRef, useState } from "react";
import type { DualMonitorState } from "./useDualMonitor";

export function FireDualMonitorButton({ dual }: { dual: DualMonitorState }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const expanded = dual.active;
  const blocked = !dual.available;
  const targets = dual.displays.filter((d) => !d.isCurrent);
  // A genuine choice deserves a menu — including while expanded, so 3+
  // displays can re-target without collapsing first.
  const showMenu = targets.length > 1;

  return (
    <div className="fc-dual-btn" ref={wrapRef} data-solo={showMenu ? undefined : "1"}>
      <button
        type="button"
        className="fc-dual-btn__main fc-focus"
        data-on={expanded ? "1" : "0"}
        disabled={blocked && !expanded}
        onClick={() => { void dual.toggle(); }}
        title={
          expanded
            ? "Collapse — bring the sequencer back onto this screen"
            : blocked
              ? `Needs a second display — ${dual.reason ?? "only one detected"}`
              : targets.length === 1
                ? `Expand — put the sequencer on ${targets[0].label} by itself`
                : "Expand — put the sequencer on a second display by itself"
        }
        aria-pressed={expanded}
      >
        <span className="fc-dual-btn__glyph" aria-hidden>
          <span className="fc-dual-btn__screen" />
          <span className="fc-dual-btn__screen" />
        </span>
        <span className="fc-dual-btn__label">{expanded ? "Collapse" : "Expand"}</span>
      </button>

      {showMenu && (
        <button
          type="button"
          className="fc-dual-btn__more fc-focus"
          onClick={() => setMenuOpen((v) => !v)}
          title="Choose which display"
          aria-label="Choose which display"
          aria-expanded={menuOpen}
        >
          ▾
        </button>
      )}

      {menuOpen && (
        <div className="fc-dual-btn__menu" role="menu">
          <div className="fc-dual-btn__menu-head">Sequencer onto</div>
          {targets.map((d) => (
            <button
              key={d.id}
              type="button"
              role="menuitem"
              onClick={() => { setMenuOpen(false); void dual.span(d.id); }}
            >
              {d.label}
              <span className="fc-dual-btn__dim">{d.bounds.width}×{d.bounds.height}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
