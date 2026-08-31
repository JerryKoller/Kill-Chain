/**
 * Horizontal grab bar for resizing a stacked sequencer section vertically.
 * Pairs with usePanelHeight.
 */

import type { PanelHeight } from "./usePanelHeight";

export function PanelResizeHandle({
  panel,
  label,
}: {
  panel: PanelHeight;
  /** Named in the tooltip and for screen readers, e.g. "arrangement". */
  label: string;
}) {
  return (
    <div
      className="fc-vresize"
      data-dragging={panel.dragging ? "1" : undefined}
      onPointerDown={panel.onResizeStart}
      onDoubleClick={panel.reset}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${label} height`}
      title={`Drag to resize ${label} · double-click to reset`}
    >
      <span className="fc-vresize__grip" aria-hidden />
    </div>
  );
}
