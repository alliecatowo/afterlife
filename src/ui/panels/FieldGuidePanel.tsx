/**
 * Field Guide host. The `ui` agent owns this shell and the prop contract; the
 * `content` agent owns the actual entries (editorial copy, discovery
 * detection). `@/ui/discoveries` bridges the two into a live log — see
 * `PanelRight.tsx` for the wiring. Import only `FieldGuideEntry` /
 * `FieldGuidePanel` from this file — do not reach into panel internals.
 */
import { useState } from 'react';
import { Button, Divider } from '@/ui/primitives';
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
  /** True while `@/ui/discoveries` is actively tracking this one generation by generation. */
  following?: boolean;
  /** True once a followed discovery stopped matching (collision, dispersal, out of view). */
  lost?: boolean;
}

export interface FieldGuidePanelProps {
  entries?: FieldGuideEntry[];
  /** Scan the current selection (or the camera's view, if nothing is selected) for structures. */
  onScanHere?: () => void;
  onRename?: (id: string, name: string) => void;
  onToggleFollow?: (id: string) => void;
  /** Move the sim to this discovery's most recent sighting and frame it. */
  onGoTo?: (id: string) => void;
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

export function FieldGuidePanel({ entries = [], onScanHere, onRename, onToggleFollow, onGoTo }: FieldGuidePanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="flex flex-col gap-3">
      {onScanHere && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onScanHere}>
          Scan here
        </Button>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <BookIcon width={22} height={22} className="text-ivory-300" />
          <p className="display-face-tight text-lg text-ivory-200">The guide is unwritten.</p>
          <p className="max-w-[24ch] text-xs text-ivory-300">
            The observatory quietly scans for still lifes, oscillators and spaceships as the world
            runs — or scan a selection yourself.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {entries.map((e, i) => {
            const open = openId === e.id;
            const renaming = renamingId === e.id;
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
                    <span className="block truncate text-sm text-ivory-100">
                      {e.title}{e.lost ? ' (lost)' : e.following ? ' — following' : ''}
                    </span>
                    <span className="block text-micro uppercase tracking-[0.14em] text-ivory-300">
                      {e.kind}{e.discoveredAtGen !== undefined ? ` · seen at gen ${e.discoveredAtGen}` : ''}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="flex flex-col gap-2 pb-3">
                    <p className="text-xs text-ivory-200">{e.body}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {onGoTo && (
                        <Button size="sm" variant="ghost" onClick={() => onGoTo(e.id)}>
                          Go to sighting
                        </Button>
                      )}
                      {onToggleFollow && !e.lost && (
                        <Button size="sm" variant="ghost" pressed={e.following} onClick={() => onToggleFollow(e.id)}>
                          {e.following ? 'Stop following' : 'Follow'}
                        </Button>
                      )}
                      {onRename && !renaming && (
                        <Button size="sm" variant="quiet" onClick={() => { setRenamingId(e.id); setDraft(e.title === 'Unnamed observation' ? '' : e.title); }}>
                          Name it
                        </Button>
                      )}
                    </div>
                    {onRename && renaming && (
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          const trimmed = draft.trim();
                          if (trimmed) onRename(e.id, trimmed);
                          setRenamingId(null);
                        }}
                      >
                        <input
                          autoFocus
                          value={draft}
                          onChange={(ev) => setDraft(ev.target.value)}
                          onBlur={() => setRenamingId(null)}
                          placeholder="Give it a name…"
                          className="min-w-0 flex-1 rounded-xs border border-line-strong bg-ink-900 px-1.5 py-0.5 text-sm text-ivory-100 focus-visible:focus-ring outline-none"
                        />
                      </form>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
