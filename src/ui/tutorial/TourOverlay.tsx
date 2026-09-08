/**
 * Mounts the live tour: wires the active step's real-action detection
 * (`@/ui/tutorial/behaviors`) to the store, and renders its `CoachMark`.
 * Renders nothing while idle/done, and nothing while an actual dialog
 * (shortcuts, About) is open — a coach mark pointing at a control the dialog
 * is currently covering would be worse than no coach mark at all, and two
 * floating "help" surfaces stacked at once is exactly the clutter DESIGN.md
 * warns against.
 *
 * Also the achievements logbook's ONE boot hook: `App.tsx`/`Hud.tsx`/
 * `panels/**` are other agents' territory for this task, so
 * `@/ui/achievements` mounts itself into its own DOM root rather than
 * needing a wire-up there (see that module's doc). `TourOverlay` is already
 * unconditionally rendered by `App.tsx` today, so calling `initAchievements()`
 * from here — instead of proposing yet another `App.tsx` edit for a single
 * `useEffect` — turns the feature on with zero touches outside this task's
 * own ownership. Idempotent; safe alongside StrictMode's double-invoke.
 */
import { useEffect } from 'react';
import { useTourStore } from './tourStore';
import { useUIState } from '@/ui/uiState';
import { TOUR_BEHAVIORS, tourCtx } from './behaviors';
import { CoachMark } from './CoachMark';
import { TOUR_STEPS } from '@/content/tour';
import { initAchievements } from '@/ui/achievements';

export function TourOverlay() {
  useEffect(() => {
    initAchievements();
  }, []);

  const status = useTourStore((s) => s.status);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const next = useTourStore((s) => s.next);
  const skip = useTourStore((s) => s.skip);
  const shortcutsOpen = useUIState((s) => s.shortcutsOpen);
  const aboutOpen = useTourStore((s) => s.aboutOpen);

  const step = status === 'active' ? TOUR_STEPS[stepIndex] : undefined;

  // Step lifecycle: run the step's `onEnter` and start listening for the
  // real action that completes it. Both are torn down when the step changes
  // or the tour ends, and re-established fresh for the next step — a step
  // never carries over a stale subscription from the one before it.
  useEffect(() => {
    if (!step) return;
    const behavior = TOUR_BEHAVIORS[step.id];
    if (!behavior) return;
    const ctx = tourCtx();
    const cleanupEnter = behavior.onEnter?.(ctx);
    const unsubscribe = behavior.completesOn?.(ctx, next);
    return () => {
      cleanupEnter?.();
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  if (!step || shortcutsOpen || aboutOpen) return null;

  const behavior = TOUR_BEHAVIORS[step.id];
  const showMe = behavior?.showMe;

  return (
    <CoachMark
      stepKey={step.id}
      title={step.title}
      body={step.body}
      target={step.target}
      placement={step.placement}
      stepNumber={stepIndex + 1}
      totalSteps={TOUR_STEPS.length}
      showMeLabel={showMe ? step.showMeLabel : undefined}
      onShowMe={showMe ? () => showMe(tourCtx()) : undefined}
      onNext={next}
      onSkip={skip}
      isLast={stepIndex === TOUR_STEPS.length - 1}
    />
  );
}
