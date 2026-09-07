/**
 * Compare host: picks branch B against the active branch, states the exact
 * measurement region being diffed, and toggles the `#compare-canvas` anchor
 * (declared in `App.tsx`) so a second, camera-synchronized world view can be
 * painted into it. This panel does not compute the diff itself — no bus
 * event exists yet for "run diff" (see INTEGRATION-NOTES.md); it presents an
 * honest "not yet computed" readout rather than fabricating a count.
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '@/ui/store';
import { Button, Divider, Legend, Readout, Toggle } from '@/ui/primitives';

export function ComparePanel() {
  const branches = useAppStore((s) => s.branches);
  const activeBranch = useAppStore((s) => s.activeBranch);
  const compareWith = useAppStore((s) => s.compareWith);
  const setCompareWith = useAppStore((s) => s.setCompareWith);
  const selection = useAppStore((s) => s.selection);
  const [diffLens, setDiffLens] = useState<'side-by-side' | 'difference'>('side-by-side');

  const others = [{ id: 'root', name: 'Original' }, ...branches.filter((b) => b.id !== 'root')]
    .filter((b) => b.id !== activeBranch);

  useEffect(() => {
    const compareCanvas = document.getElementById('compare-canvas');
    if (!compareCanvas) return;
    compareCanvas.classList.toggle('hidden', compareWith === null);
  }, [compareWith]);

  const activeName = branches.find((b) => b.id === activeBranch)?.name ?? (activeBranch === 'root' ? 'Original' : activeBranch);
  const otherName = compareWith
    ? (branches.find((b) => b.id === compareWith)?.name ?? (compareWith === 'root' ? 'Original' : compareWith))
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Branch B</span>
        {others.length === 0 ? (
          <p className="text-xs text-ivory-300">No other branch exists yet to compare against.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {others.map((b) => (
              <Button
                key={b.id}
                size="sm"
                variant="ghost"
                pressed={compareWith === b.id}
                onClick={() => setCompareWith(compareWith === b.id ? null : b.id)}
              >
                {b.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {compareWith && (
        <>
          <Divider />
          <Legend
            items={[
              { swatch: 'var(--color-accent-branch-a)', label: `A — ${activeName}` },
              { swatch: 'var(--color-accent-branch-b)', label: `B — ${otherName}` },
              { swatch: 'var(--color-accent-diff)', label: 'differs between A and B' },
            ]}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Measurement region</span>
            <p className="text-xs text-ivory-200">
              {selection
                ? `The current selection: ${selection.w}×${selection.h} cells at (${selection.x}, ${selection.y}).`
                : 'The entire world — draw a selection on the canvas to narrow it.'}
            </p>
          </div>
          <Toggle
            aria-label="Comparison view"
            options={[
              { value: 'side-by-side', label: 'Side by side' },
              { value: 'difference', label: 'Difference' },
            ]}
            value={diffLens}
            onChange={setDiffLens}
          />
          <Readout label="differing cells" value="—" digits={5} />
          <p className="text-xs text-ivory-300">Not yet computed for this pair.</p>
        </>
      )}
    </div>
  );
}
