/**
 * Real designed moments over the world canvas: empty, extinct, seeking and
 * restored. None of these fabricate simulation data — they are read
 * entirely from `gen:changed` (via the zero-render `subscribeReadout`
 * bridge) and `useAppStore`. Overlays are `pointer-events-none` except their
 * own action buttons, so the world underneath stays interactive.
 */
import { useEffect, useRef, useState } from 'react';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { Button } from '@/ui/primitives';
import { ClockIcon } from '@/ui/icons';

type Phase = 'empty' | 'extinct' | 'none';

export function WorldStateOverlay() {
  const [phase, setPhase] = useState<Phase>('empty');
  const everAlive = useRef(false);
  // Held back until the title plate has faded, so the opening moment never
  // shows two competing centred messages at once.
  const titleDismissed = useUIState((s) => s.titleDismissed);
  const scrubbing = useAppStore((s) => s.scrubbing);
  const branches = useAppStore((s) => s.branches);
  const setTool = useAppStore((s) => s.setTool);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);

  useEffect(() => subscribeReadout((r) => {
    if (r.population > 0) {
      everAlive.current = true;
      setPhase('none');
    } else if (everAlive.current) {
      setPhase('extinct');
    } else {
      setPhase('empty');
    }
  }), []);

  // "Restored": a real discontinuity signal (jumping onto another branch),
  // never a guess from the first `gen:changed` tick — `gen:changed` only
  // ever fires for gen >= 1 (it fires from inside `step()`), so "first
  // observed gen > 0" is true on every ordinary first play and cannot tell
  // "resumed" apart from "just started playing".
  useEffect(() => bus.on('branch:switched', ({ id }) => {
    const name = branches.find((b) => b.id === id)?.name ?? (id === 'root' ? 'the original' : id);
    bus.emit('toast', { message: `Restored — now on "${name}".`, tone: 'info' });
  }).dispose, [branches]);

  const beginDrawing = () => {
    setTool('draw');
    setDrawerOpen(true);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[var(--z-overlay)] flex flex-col">
      {scrubbing && (
        <div className="flex justify-center pt-3">
          <span className="tabular flex items-center gap-1.5 rounded-full border border-line bg-ink-800/85 px-3 py-1 text-xs text-accent-time">
            <ClockIcon /> seeking…
          </span>
        </div>
      )}

      {titleDismissed && phase === 'empty' && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="display-face-tight text-lg text-ivory-200">Nothing lives here yet.</p>
            <p className="max-w-[32ch] text-xs text-ivory-300">
              Draw a few cells on the world, stamp a pattern from the drawer, or press play to seed
              activity from noise.
            </p>
            <Button variant="ghost" className="pointer-events-auto" onClick={beginDrawing}>Start drawing</Button>
          </div>
        </div>
      )}

      {titleDismissed && phase === 'extinct' && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="display-face-tight text-lg text-ivory-200">Extinct.</p>
            <p className="max-w-[34ch] text-xs text-ivory-300">
              Every cell has died. Step back on the timeline to the moment before the collapse, or
              draw new life into the world.
            </p>
            <div className="flex gap-2 pointer-events-auto">
              <Button variant="ghost" onClick={() => bus.emit('playback:step', { by: -1 })}>Step back</Button>
              <Button variant="solid" onClick={beginDrawing}>Draw new life</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
