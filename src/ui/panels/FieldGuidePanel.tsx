/**
 * Field Guide host. The `ui` agent owns this shell and the prop contract; the
 * `content` agent owns the actual entries (editorial copy, discovery
 * detection) and passes them in from wherever it wires `PATTERNS` /
 * discoveries into the app. Import only `FieldGuideEntry` / `FieldGuidePanel`
 * from this file — do not reach into panel internals.
 */
import { useState } from 'react';
import { Divider } from '@/ui/primitives';
import { BookIcon } from '@/ui/icons';

export interface FieldGuideEntry {
  id: string;
  title: string;
  /** Natural-history register category label, e.g. "oscillator", "spaceship". */
  kind: string;
  /** One or two sentences, editorial voice — see DESIGN.md tone. */
  body: string;
  /** Generation this was first observed in the current session, if applicable. */
  discoveredAtGen?: number;
  /** Optional small row-major preview, 1 = alive. Rendered as a mini swatch grid. */
  preview?: { w: number; h: number; cells: Uint8Array };
}

export interface FieldGuidePanelProps {
  entries?: FieldGuideEntry[];
}

function MiniPreview({ w, h, cells }: { w: number; h: number; cells: Uint8Array }) {
  return (
    <div
      className="grid shrink-0 gap-px rounded-xs border border-line bg-ink-900 p-1"
      style={{ gridTemplateColumns: `repeat(${w}, 3px)`, gridTemplateRows: `repeat(${h}, 3px)` }}
      aria-hidden="true"
    >
      {Array.from(cells).map((v, i) => (
        <span key={i} style={{ background: v ? 'var(--color-accent-life)' : 'transparent' }} />
      ))}
    </div>
  );
}

export function FieldGuidePanel({ entries = [] }: FieldGuidePanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <BookIcon width={22} height={22} className="text-ivory-300" />
        <p className="display-face-tight text-lg text-ivory-200">The guide is unwritten.</p>
        <p className="max-w-[24ch] text-xs text-ivory-300">
          Entries appear here as the observatory recognises still lifes, oscillators and
          spaceships in your worlds.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {entries.map((e, i) => {
        const open = openId === e.id;
        return (
          <li key={e.id}>
            {i > 0 && <Divider />}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : e.id)}
              className="flex w-full items-center gap-3 py-2.5 text-left focus-visible:focus-ring outline-none rounded-xs"
            >
              {e.preview ? <MiniPreview {...e.preview} /> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ivory-100">{e.title}</span>
                <span className="block text-micro uppercase tracking-[0.14em] text-ivory-300">
                  {e.kind}{e.discoveredAtGen !== undefined ? ` · seen at gen ${e.discoveredAtGen}` : ''}
                </span>
              </span>
            </button>
            {open && <p className="pb-3 text-xs text-ivory-200">{e.body}</p>}
          </li>
        );
      })}
    </ul>
  );
}
