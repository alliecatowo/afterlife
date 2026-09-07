/**
 * A quiet, non-blocking invitation over the world canvas: "touch the world".
 * No pointer events of its own — the canvas underneath stays fully live.
 * Fades permanently once `uiState.worldTouched` flips (see `App.tsx`, which
 * sets it from a capture-phase listener on the canvas section).
 *
 * Also fades TEMPORARILY while a bus `toast` is showing — both live in the
 * same bottom band above the timeline, and a scene beat's toast (e.g. the
 * opening scene's "something is about to meet" note at gen 108) can fire
 * before the user has ever touched the world, especially on a narrow
 * viewport where the hint's longer text wraps wider than the toast and used
 * to stick out from behind it, illegible. Ducking the hint while any toast
 * is visible keeps both messages readable one at a time instead of
 * overlapping.
 */
import { useEffect, useState } from 'react';
import { bus } from '@/ui/bus';
import { useUIState } from '@/ui/uiState';

export function WorldHint() {
  const touched = useUIState((s) => s.worldTouched);
  const dismissed = useUIState((s) => s.titleDismissed);
  const [activeToasts, setActiveToasts] = useState(0);

  useEffect(() => {
    const sub = bus.on('toast', ({ ms = 4200 }) => {
      setActiveToasts((n) => n + 1);
      window.setTimeout(() => setActiveToasts((n) => Math.max(0, n - 1)), ms);
    });
    return () => sub.dispose();
  }, []);

  if (touched) return null;

  return (
    <div
      aria-hidden="true"
      className={
        'pointer-events-none absolute inset-x-0 bottom-10 z-[var(--z-overlay)] flex justify-center ' +
        'transition-opacity duration-[var(--duration-slow)] ease-[var(--ease-standard)] ' +
        (dismissed && activeToasts === 0 ? 'opacity-100' : 'opacity-0')
      }
    >
      <span className="rounded-full border border-line bg-ink-800/80 px-3 py-1.5 text-micro uppercase tracking-[0.18em] text-ivory-300">
        click or drag to bring a cell to life
      </span>
    </div>
  );
}
