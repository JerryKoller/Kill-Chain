/**
 * Quiet disclosure chevron for section headers.
 * Square + muted — never reads as a transport / play control.
 */

function ChevronGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="block">
      <path
        d="M2.4 4.2 L6 7.8 L9.6 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] leading-none transition duration-150"
      style={{
        color: "rgba(255,255,255,0.58)",
        background: "rgba(255,255,255,0.04)",
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.12), 0 0 0 1px ${color}10`,
      }}
      title={title}
      aria-hidden
    >
      <span
        className="inline-block transition-transform duration-150"
        style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
      >
        <ChevronGlyph />
      </span>
    </span>
  );
}
