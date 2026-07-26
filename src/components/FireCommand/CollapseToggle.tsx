/**
 * Lit collapse chevron used across Fire Command section headers.
 * Bigger + accent-colored so it reads on dark glass panels.
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
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold leading-none transition"
      style={{
        borderColor: `${color}77`,
        color,
        background: collapsed
          ? `linear-gradient(160deg, ${color}22, ${color}0a)`
          : `linear-gradient(160deg, ${color}38, ${color}14)`,
        boxShadow: collapsed
          ? `0 0 8px ${color}28, inset 0 0 6px ${color}12`
          : `0 0 14px ${color}44, inset 0 0 8px ${color}18`,
      }}
      title={title}
      aria-hidden
    >
      {collapsed ? "▸" : "▾"}
    </span>
  );
}
