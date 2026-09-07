/**
 * Compare host: picks branch B against the active branch, states the exact
 * measurement region being diffed, and toggles the `#compare-canvas` anchor
 * (declared in `App.tsx`) so a second, camera-synchronized world view can be
 * painted into it. Diffing uses the live `TimelineStore.diff()` via
 * `@/ui/session`'s `getSession()` — a real, replay-backed comparison, never
 * a fabricated count.
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '@/ui/store';
import { getSession, WORLD_SPEC } from '@/ui/session';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { Button, Divider, Legend, Readout, Toggle } from '@/ui/primitives';
import type { Rect } from '@/core/types';

export function ComparePanel() {
  const branches = useAppStore((s) => s.branches);
  const activeBranch = useAppStore((s) => s.activeBranch);
  const compareWith = useAppStore((s) => s.compareWith);
  const setCompareWith = useAppStore((s) => s.setCompareWith);
  const selection = useAppStore((s) => s.selection);
  const [diffLens, setDiffLens] = useState<'side-by-side' | 'difference'>('side-by-side');
  const [count, setCount] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [gen, setGen] = useState(0);

  const others = [{ id: 'root', name: 'Original' }, ...branches.filter((b) => b.id !== 'root')]
    .filter((b) => b.id !== activeBranch);

  useEffect(() => subscribeReadout((r) => setGen(r.gen)), []);

  // `#compare-canvas`'s visibility/layout is driven by `App.tsx` straight off
  // `compareWith` (same source of truth) — this effect only owns clearing the
  // main canvas's diff overlay when the comparison ends.
  useEffect(() => () => { if (compareWith === null) getSession()?.renderer.setDiffOverlay(null); }, [compareWith]);

  const rect: Rect = selection ?? { x: 0, y: 0, w: WORLD_SPEC.width, h: WORLD_SPEC.height };

  const runDiff = () => {
    const session = getSession();
    if (!session || !compareWith) return;
    setPending(true);
    session.history.diff(activeBranch, compareWith, gen, rect)
      .then((result) => {
        setCount(result.count);
        session.renderer.setDiffOverlay(diffLens === 'difference' ? result.cells : null);
      })
      .catch(() => setCount(null))
      .finally(() => setPending(false));
  };

  useEffect(() => {
    if (compareWith) runDiff();
    else setCount(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareWith, diffLens]);

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
              // The difference overlay itself never relies on colour alone
              // to tell A-only from B-only cells (see `renderer.ts`'s
              // `#drawDiff`: A-only is a solid fill, B-only is a diagonal
              // hatch) — these two legend rows use the same two fill styles
              // so the visual key matches what's actually on the canvas.
              { swatch: 'color-mix(in oklch, var(--color-accent-diff) 60%, transparent)', label: 'A-only (solid)' },
              {
                swatch: 'repeating-linear-gradient(45deg, var(--color-accent-diff) 0 2px, color-mix(in oklch, var(--color-accent-diff) 22%, transparent) 2px 4px)',
                label: 'B-only (hatched)',
              },
            ]}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Measurement region</span>
            <p className="text-xs text-ivory-200">
              {selection
                ? `The current selection: ${selection.w}×${selection.h} cells at (${selection.x}, ${selection.y}), at generation ${gen}.`
                : `The entire ${WORLD_SPEC.width}×${WORLD_SPEC.height} world at generation ${gen} — draw a selection to narrow it.`}
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
          <div className="flex items-center gap-3">
            <Readout label="differing cells" value={pending ? '…' : count === null ? '—' : count} digits={6} accent="diff" />
            <Button size="sm" variant="ghost" onClick={runDiff} disabled={pending}>Recompute</Button>
          </div>
        </>
      )}
    </div>
  );
}
