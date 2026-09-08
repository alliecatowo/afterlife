/**
 * The tour's one visual: a small card connected by a hairline to the real
 * control or place it's talking about. Never a dialog and never a full-bleed
 * overlay — see `@/content/tour`'s module doc and DESIGN.md's "world
 * dominates" rule. Positioning is recomputed every animation frame (same
 * discipline as `@/ui/SceneAnnotation` and `@/ui/timeline/Timeline`: direct
 * style writes, no `setState` in the loop) from `resolveTourTarget` +
 * `placeCoachMark`, so it stays correctly anchored across resize, drawer/
 * panel open-close, and camera motion without any bespoke ResizeObserver
 * wiring — a target rect is just read fresh every frame.
 *
 * A11y: `role="group"` + `aria-roledescription`/`aria-label` name it as a
 * single unit WITHOUT the `dialog` role — `@/interact/globalShortcutGuard`'s
 * `isDialogOpen()` treats any `[role="dialog"]` in the document as "a dialog
 * owns the keyboard" and suppresses every global shortcut app-wide,
 * including the very ones several tour steps wait for (space to pause, 1/2/3
 * for lens). A visually-hidden live region announces the step to assistive
 * tech on change; focus moves into the card only when focus was already
 * inside the previous one (so an in-progress drag or a rename field never
 * gets yanked away) — "announced, not trapped", per the tour's own brief.
 *
 * The title is a styled `<p>`, never a heading element: like `TitlePlate`'s
 * own transient wordmark, a card that mounts and unmounts every few seconds
 * would otherwise inject/remove `<h*>` levels from the page's outline on a
 * timer, which is worse for a screen reader than not being a heading at all.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/ui/primitives';
import { CloseIcon } from '@/ui/icons';
import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { resolveTourTarget } from './targeting';
import { placeCoachMark, type Placement } from './layout';
import type { TourTarget } from '@/content/tour';

export interface CoachMarkProps {
  stepKey: string;
  title: string;
  body: string;
  target: TourTarget;
  placement: Placement;
  stepNumber: number;
  totalSteps: number;
  showMeLabel?: string;
  onShowMe?: () => void;
  onNext: () => void;
  onSkip: () => void;
  isLast: boolean;
}

const DEFAULT_CARD_SIZE = { width: 300, height: 150 };

export function CoachMark({
  stepKey, title, body, target, placement, stepNumber, totalSteps, showMeLabel, onShowMe, onNext, onSkip, isLast,
}: CoachMarkProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  // Only used to decide whether a target exists at all (for the connector's
  // visibility) — the per-frame loop below re-resolves the live rect itself.
  const [hasTarget, setHasTarget] = useState(false);

  // Move focus into the new card only if focus was already inside the tour's
  // own chrome (the previous card or its buttons) — never steal it from a
  // drag-in-progress on the canvas or a text field elsewhere in the app.
  useEffect(() => {
    const active = document.activeElement;
    const wasInTour = active instanceof HTMLElement && active.closest('[data-tour-card]') !== null;
    if (wasInTour || stepNumber === 1) cardRef.current?.focus();
  }, [stepKey, stepNumber]);

  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      const targetRect = resolveTourTarget(target);
      setHasTarget((prev) => (prev !== (targetRect !== null) ? targetRect !== null : prev));
      const card = cardRef.current;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const cardSize = card
        ? { width: card.offsetWidth || DEFAULT_CARD_SIZE.width, height: card.offsetHeight || DEFAULT_CARD_SIZE.height }
        : DEFAULT_CARD_SIZE;
      const layout = placeCoachMark(targetRect, placement, viewport, cardSize);

      if (card) card.style.transform = `translate(${layout.card.x}px, ${layout.card.y}px)`;

      if (dotRef.current) {
        if (layout.targetAnchor) {
          dotRef.current.style.display = 'block';
          dotRef.current.style.transform = `translate(${layout.targetAnchor.x}px, ${layout.targetAnchor.y}px)`;
        } else {
          dotRef.current.style.display = 'none';
        }
      }
      if (lineRef.current) {
        if (layout.targetAnchor && layout.cardAnchor) {
          lineRef.current.setAttribute('x1', String(layout.targetAnchor.x));
          lineRef.current.setAttribute('y1', String(layout.targetAnchor.y));
          lineRef.current.setAttribute('x2', String(layout.cardAnchor.x));
          lineRef.current.setAttribute('y2', String(layout.cardAnchor.y));
          lineRef.current.style.display = 'block';
        } else {
          lineRef.current.style.display = 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, placement]);

  return (
    <div
      role="complementary"
      aria-label="Guided tour"
      className="pointer-events-none fixed inset-0 z-[var(--z-toast)]"
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <line ref={lineRef} stroke="var(--color-line-strong)" strokeWidth={1.5} style={{ display: 'none' }} />
      </svg>
      {hasTarget && (
        <span
          ref={dotRef}
          aria-hidden="true"
          className="absolute left-0 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'var(--color-line-strong)' }}
        />
      )}
      <div
        key={stepKey}
        ref={cardRef}
        data-tour-card
        role="group"
        aria-roledescription="guided tour step"
        aria-label={title}
        tabIndex={-1}
        style={{ width: DEFAULT_CARD_SIZE.width, left: 0, top: 0 }}
        // Deliberately NOT `pointer-events-auto` on the card itself: a coach
        // mark can land anywhere on screen depending on what it's pointing
        // at, including directly over the world canvas at coordinates a real
        // gesture (drawing, dragging a selection, stamping) needs to reach.
        // The card's background, text and connector stay click-THROUGH — only
        // its own buttons below opt back into `pointer-events-auto`
        // individually, so the world underneath is never, even
        // coincidentally, blocked by where the card happens to sit.
        className={
          'pointer-events-none absolute rounded-lg border border-line bg-surface-raised p-4 shadow-[var(--shadow-float)] outline-none ' +
          'focus-visible:focus-ring ' +
          (reducedMotion ? '' : 'animate-[tooltip-in_var(--duration-base)_var(--ease-entrance)]')
        }
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <span className="tabular text-micro uppercase tracking-[0.18em] text-ivory-300">
            {stepNumber} of {totalSteps}
          </span>
          <IconButton label="Skip tour" icon={<CloseIcon />} size="sm" className="pointer-events-auto" onClick={onSkip} />
        </div>
        {/* Styled like a heading, deliberately not one — see module doc. */}
        <p className="display-face-tight text-lg text-ivory-100">{title}</p>
        <p className="mt-1.5 text-sm text-ivory-200">{body}</p>
        {/* A visually-hidden echo, so a screen reader gets the full step
            announced via this element's own presence/text change even
            though focus doesn't always move here (see the effect above). */}
        <p className="sr-only" role="status" aria-live="polite">{`Step ${stepNumber} of ${totalSteps}: ${title}. ${body}`}</p>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {showMeLabel && onShowMe && (
            <Button variant="ghost" size="sm" className="pointer-events-auto" onClick={onShowMe}>{showMeLabel}</Button>
          )}
          <Button variant="solid" size="sm" className="pointer-events-auto" onClick={onNext}>{isLast ? 'Done' : 'Next'}</Button>
        </div>
      </div>
    </div>
  );
}
