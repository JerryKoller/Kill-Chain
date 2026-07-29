/**
 * Quiet expand/collapse chevron for section headers.
 * Square + muted — never reads as a transport / play control.
 */

export function CollapseToggle({
  collapsed,
  color,
  title,
}: {
  collapsed: boolean;
  color: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[12px] leading-none transition duration-150"
      style={{
        color: "rgba(255,255,255,0.62)",
        background: "rgba(255,255,255,0.045)",
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.14), 0 0 0 1px ${color}14`,
      }}
      title={title}
      aria-hidden
    >
      <span
        className="inline-block transition-transform duration-150"
        style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
      >
        ▾
      </span>
    </span>
  );
}
