/**
 * A quiet, non-blocking invitation over the world canvas: "touch the world".
 * No pointer events of its own — the canvas underneath stays fully live.
 * Fades permanently once `uiState.worldTouched` flips (see `App.tsx`, which
 * sets it from a capture-phase listener on the canvas section).
 */
import { useUIState } from '@/ui/uiState';

export function WorldHint() {
  const touched = useUIState((s) => s.worldTouched);
  const dismissed = useUIState((s) => s.titleDismissed);

  if (touched) return null;

  return (
    <div
      aria-hidden="true"
      className={
        'pointer-events-none absolute inset-x-0 bottom-10 z-[var(--z-overlay)] flex justify-center ' +
        'transition-opacity duration-[var(--duration-slow)] ease-[var(--ease-standard)] ' +
        (dismissed ? 'opacity-100' : 'opacity-0')
      }
    >
      <span className="rounded-full border border-line bg-ink-800/80 px-3 py-1.5 text-micro uppercase tracking-[0.18em] text-ivory-300">
        click or drag to bring a cell to life
      </span>
    </div>
  );
}
