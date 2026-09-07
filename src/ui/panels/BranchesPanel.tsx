/**
 * Branches: a compact list of alternate futures. Renaming and switching are
 * emitted as bus intents (`branch:renamed`, `branch:switched`) — whatever
 * owns the `TimelineStore` performs the call and writes the result back into
 * `useAppStore.branches` / `.activeBranch` (ARCHITECTURE.md § cross-module
 * communication). This panel never fabricates branch data: the root branch
 * is always shown even before any `BranchMeta` exists for it, because it is
 * the one branch guaranteed to exist by `TimelineStore.reset()`.
 */
import { useState } from 'react';
import { useAppStore } from '@/ui/store';
import { bus } from '@/ui/bus';
import { Button, IconButton } from '@/ui/primitives';
import { BranchIcon, CheckIcon, ChevronIcon } from '@/ui/icons';
import type { BranchMeta } from '@/core/types';

const ROOT: BranchMeta = { id: 'root', name: 'Original', parent: null, fromGen: 0, createdAt: 0 };

function BranchRow({
  branch, isActive, parentName, onSwitch, onRename,
}: {
  branch: BranchMeta;
  isActive: boolean;
  parentName: string | null;
  onSwitch: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(branch.name);

  const submit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== branch.name) onRename(trimmed);
    else setDraft(branch.name);
  };

  return (
    <li
      className={
        'flex flex-col gap-1 rounded-sm border px-2.5 py-2 ' +
        (isActive ? 'border-line-strong bg-ink-700' : 'border-transparent hover:bg-ink-800')
      }
    >
      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') { setDraft(branch.name); setEditing(false); }
            }}
            className="min-w-0 flex-1 rounded-xs border border-line-strong bg-ink-900 px-1.5 py-0.5 text-sm text-ivory-100 focus-visible:focus-ring outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left text-sm text-ivory-100"
            title="Double-click to rename"
          >
            {branch.name}
          </button>
        )}
        {isActive ? (
          <span className="flex shrink-0 items-center gap-1 text-micro uppercase tracking-[0.14em]" style={{ color: 'var(--color-accent-time)' }}>
            <CheckIcon /> current
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={onSwitch}>Switch</Button>
        )}
      </div>
      <p className="text-xs text-ivory-300">
        {branch.parent === null
          ? 'The original run.'
          : `Forked from ${parentName ?? branch.parent} at the intervention on gen ${branch.fromGen}.`}
      </p>
    </li>
  );
}

export function BranchesPanel() {
  const branches = useAppStore((s) => s.branches);
  const activeBranch = useAppStore((s) => s.activeBranch);

  const all: BranchMeta[] = branches.some((b) => b.id === 'root') ? branches : [ROOT, ...branches];
  const byId = new Map(all.map((b) => [b.id, b]));

  return (
    <div className="flex flex-col gap-3">
      {activeBranch !== 'root' && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => bus.emit('branch:switched', { id: 'root' })}
        >
          <ChevronIcon direction="left" width={12} height={12} /> Return to original
        </Button>
      )}
      {all.length === 0 ? (
        <p className="text-xs text-ivory-300">No branches yet — edit the past from the timeline to fork one.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {all.map((b) => (
            <BranchRow
              key={b.id}
              branch={b}
              isActive={b.id === activeBranch}
              parentName={b.parent ? byId.get(b.parent)?.name ?? null : null}
              onSwitch={() => bus.emit('branch:switched', { id: b.id })}
              onRename={(name) => bus.emit('branch:renamed', { id: b.id, name })}
            />
          ))}
        </ul>
      )}
      <p className="flex items-start gap-1.5 text-xs text-ivory-300">
        <BranchIcon className="mt-0.5 shrink-0" />
        Edit cells at a past generation to fork a new branch there — both futures are kept.
      </p>
    </div>
  );
}
