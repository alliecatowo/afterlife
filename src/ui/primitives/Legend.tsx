export interface LegendItem {
  /** A token var(...) string, e.g. `var(--color-accent-age)`, or a CSS gradient using one. */
  swatch: string;
  label: string;
  /** Optional fuller explanation, surfaced as a native tooltip on hover/focus
   *  when the visible `label` is kept short (e.g. in a horizontal HUD strip
   *  with limited width) — see `@/render/color`'s `LensLegendEntry` doc. */
  title?: string;
}

export interface LegendProps {
  items: LegendItem[];
  className?: string;
}

/** Swatch + meaning rows. Colour is always paired with a text label — never colour alone. */
export function Legend({ items, className = '' }: LegendProps) {
  return (
    <ul className={`flex flex-col gap-1 ${className}`}>
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-2 text-xs text-ivory-300"
          title={item.title}
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-xs border border-line-strong"
            style={{ background: item.swatch }}
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
