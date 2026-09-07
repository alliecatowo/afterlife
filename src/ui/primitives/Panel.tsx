import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronIcon } from '@/ui/icons';

export interface PanelProps {
  title: string;
  children: ReactNode;
  /** Small tabular/utility content shown right-aligned in the header. */
  aside?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * A titled surface with a hairline rule — "stacked sections", per DESIGN.md
 * § Composition. No nested borders; panels are the outermost frame the caller
 * (e.g. `PanelRight`) already draws.
 */
export function Panel({ title, children, aside, collapsible = false, defaultOpen = true, className = '' }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={`border-b border-line ${className}`}>
      <header className="flex items-center justify-between gap-2 px-4 py-2.5">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.18em] text-ivory-300 focus-visible:focus-ring outline-none rounded-xs hover:text-ivory-100"
          >
            <ChevronIcon direction={open ? 'down' : 'right'} width={12} height={12} />
            {title}
          </button>
        ) : (
          <h3 className="display-face-tight text-sm text-ivory-100" style={{ fontSize: 'var(--text-sm)' }}>
            {title}
          </h3>
        )}
        {aside}
      </header>
      {open ? (
        <div id={bodyId} className="px-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
