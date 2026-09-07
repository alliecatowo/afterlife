/**
 * The opening title plate — a museum exhibit's title card, not a splash
 * screen. It carries zero pointer events (nothing to click, nothing gating
 * entry): the very first pointer interaction anywhere in the app dismisses it
 * via `useUIState.dismissTitle()`, wired once at the `App` root. It fades,
 * it does not vanish — `prefers-reduced-motion` renders the dismissed state
 * directly with no transition.
 */
import { useUIState } from '@/ui/uiState';
import { useReducedMotion } from '@/ui/hooks/useReducedMotion';

export function TitlePlate() {
  const dismissed = useUIState((s) => s.titleDismissed);
  const reducedMotion = useReducedMotion();

  if (dismissed && reducedMotion) return null;

  return (
    <div
      data-testid="title-plate"
      aria-hidden={dismissed}
      className={
        'pointer-events-none absolute inset-0 z-[var(--z-overlay)] flex flex-col items-center justify-center gap-3 ' +
        'bg-ink-900/55 text-center ' +
        (dismissed ? 'animate-[title-fade-out_var(--duration-slow)_var(--ease-exit)] forwards' : '')
      }
      style={dismissed ? { animationFillMode: 'forwards' } : undefined}
    >
      <h1 className="display-face text-display-lg text-ivory-100">AFTERLIFE</h1>
      <p className="max-w-xs text-sm text-ivory-300">Every future leaves a trace.</p>
      <p className="mt-4 text-micro uppercase tracking-[0.22em] text-ivory-300">
        touch the world to begin
      </p>
    </div>
  );
}
