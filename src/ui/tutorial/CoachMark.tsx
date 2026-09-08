/**
 * The tour's one visual: a small card connected by a hairline to the real
 * control or place it's talking about, with a dimming SPOTLIGHT that cuts a
 * hole around that control so it's unmistakable which thing is being
 * described — never a dialog and never a full-bleed opaque overlay, see
 * `@/content/tour`'s module doc and DESIGN.md's "world dominates" rule.
 *
 * Positioning is event-driven, not a per-frame loop: `recompute()` re-reads
 * `resolveTourTarget` + `placeCoachMark` and writes styles directly to refs
 * (same discipline as `@/ui/SceneAnnotation` and `@/ui/timeline/Timeline` —
 * no `setState` in a hot path), but it's called ONLY when something that can
 * actually move the target fires: window resize/scroll, a `camera:changed`
 * bus event, the drawer/right-panel opening or closing, and the Time
 * Sculpture opening or closing. A step spends the overwhelming majority of
 * its life completely idle, and now costs the browser nothing while it
 * waits — a real consideration after CPU usage was just optimised hard
 * elsewhere in the app (see the tour's task brief). Panel/drawer opens
 * animate via a CSS transform slide over `--duration-base`, so those two
 * triggers additionally run a short BOUNDED `requestAnimationFrame` poll
 * (`settleFor`) that stops itself once the transition's had time to finish —
 * still not an unconditional loop, just enough frames to track one known,
 * time-boxed animation.
 *
 * The card and spotlight both EASE between positions via a CSS transition on
 * `transform`/`left`/`top`/`width`/`height` (cut instantly under
 * `prefers-reduced-motion`) rather than being interpolated by hand, and every
 * written coordinate is snapped to a whole device pixel first so neither the
 * card nor the spotlight's ring ever shimmers between sub-pixel positions.
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
 *
 * CRITICAL invariant, regressed once before: nothing in this file may ever
 * become a click target except the card's own buttons. The dimming layer in
 * particular stays `pointer-events: none` EVERYWHERE, including over the
 * dimmed (non-cutout) area — the world canvas often occupies that dimmed
 * area, and steps like `draw`/`stamp`/`fork` need clicks to land on it
 * anywhere, not only inside the current cutout. See `e2e/tour.spec.ts` and
 * `e2e/tour-spotlight.spec.ts`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/ui/primitives';
import { CloseIcon } from '@/ui/icons';
import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { resolveTourTarget, resolveTourTargetElement } from './targeting';
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

/** How long, in ms, the bounded settle poll runs after a known
 *  CSS-transitioned geometry change (drawer/panel/sculpture open-close) —
 *  a little past `--duration-slow` (400ms) so even the sculpture's own
 *  open animation is fully tracked. */
const SETTLE_MS = 450;

/** Rounds a CSS-pixel coordinate to the nearest whole DEVICE pixel, so
 *  hairline strokes (the connector, the focus ring) and text never sit on a
 *  sub-pixel boundary and shimmer as the page repaints. */
function snap(v: number): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.round(v * dpr) / dpr;
}

export function CoachMark({
  stepKey, title, body, target, placement, stepNumber, totalSteps, showMeLabel, onShowMe, onNext, onSkip, isLast,
}: CoachMarkProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  // Only used to decide whether a target exists at all (for the connector's
  // visibility) — `recompute()` below re-resolves the live rect itself and
  // writes it straight to refs.
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
    let disposed = false;
    let settleRaf = 0;
    let settleUntil = 0;

    function recompute() {
      if (disposed) return;
      const targetRect = resolveTourTarget(target);
      setHasTarget((prev) => (prev !== (targetRect !== null) ? targetRect !== null : prev));
      const card = cardRef.current;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const cardSize = card
        ? { width: card.offsetWidth || DEFAULT_CARD_SIZE.width, height: card.offsetHeight || DEFAULT_CARD_SIZE.height }
        : DEFAULT_CARD_SIZE;
      const layout = placeCoachMark(targetRect, placement, viewport, cardSize);

      if (card) card.style.transform = `translate(${snap(layout.card.x)}px, ${snap(layout.card.y)}px)`;

      if (dotRef.current) {
        if (layout.targetAnchor) {
          dotRef.current.style.display = 'block';
          dotRef.current.style.transform = `translate(${snap(layout.targetAnchor.x)}px, ${snap(layout.targetAnchor.y)}px)`;
        } else {
          dotRef.current.style.display = 'none';
        }
      }
      if (lineRef.current) {
        if (layout.targetAnchor && layout.cardAnchor) {
          lineRef.current.setAttribute('x1', String(snap(layout.targetAnchor.x)));
          lineRef.current.setAttribute('y1', String(snap(layout.targetAnchor.y)));
          lineRef.current.setAttribute('x2', String(snap(layout.cardAnchor.x)));
          lineRef.current.setAttribute('y2', String(snap(layout.cardAnchor.y)));
          lineRef.current.style.display = 'block';
        } else {
          lineRef.current.style.display = 'none';
        }
      }
      if (spotlightRef.current) {
        const el = spotlightRef.current;
        if (layout.spotlight) {
          el.style.opacity = '1';
          el.style.left = `${snap(layout.spotlight.x)}px`;
          el.style.top = `${snap(layout.spotlight.y)}px`;
          el.style.width = `${snap(layout.spotlight.width)}px`;
          el.style.height = `${snap(layout.spotlight.height)}px`;
        } else {
          // No target: fade the dimming out entirely rather than collapsing
          // it to a zero-size box (which would otherwise flash a fully-dark
          // screen for one frame while width/height ease toward 0).
          el.style.opacity = '0';
        }
      }
    }

    /** A short, BOUNDED animation-frame poll — see module doc. Restarting an
     *  already-running poll just extends its deadline, so overlapping
     *  triggers (e.g. the drawer opening while the sculpture is also
     *  closing) don't spawn a second loop. */
    function settleFor(ms: number) {
      settleUntil = performance.now() + ms;
      if (settleRaf) return;
      const tick = () => {
        recompute();
        if (!disposed && performance.now() < settleUntil) {
          settleRaf = requestAnimationFrame(tick);
        } else {
          settleRaf = 0;
        }
      };
      settleRaf = requestAnimationFrame(tick);
    }

    // A fresh step's target may not exist for an instant after mount (a
    // `world` step's session/renderer still finishing setup right after
    // navigation, a `role`/`selector` step whose `onEnter` just asked another
    // module to open a drawer/panel that hasn't laid out yet) — the SAME
    // short bounded poll used for a known CSS transition also covers this,
    // so a step never gets stuck on a stale "no target" read taken a frame
    // too early. If the target genuinely never appears, this settles on the
    // honest no-cutout fallback once the window elapses, same as always.
    settleFor(SETTLE_MS);

    window.addEventListener('resize', recompute);
    // `capture: true` so this also fires for a scroll on some inner
    // scrollable ancestor, not only `window` itself — there isn't one today
    // (the app has no scrolling page), but a target inside a future
    // scrollable list shouldn't silently drift out of sync.
    window.addEventListener('scroll', recompute, { passive: true, capture: true });

    const busSubs = [
      // Camera motion is the one continuous, potentially high-frequency
      // trigger here — but it only fires while the camera is actually
      // moving (pan/zoom/follow), and `recompute()` itself is a handful of
      // direct style writes, not a `setState`, so this is the same
      // "imperative subscriber" shape the bus's own contract requires for
      // exactly this kind of high-frequency signal.
      bus.on('camera:changed', recompute),
      bus.on('sculpture:open', () => settleFor(SETTLE_MS)),
      bus.on('sculpture:close', () => settleFor(SETTLE_MS)),
      bus.on('lens:changed', recompute),
    ];

    const unsubDrawer = useAppStore.subscribe((s, prev) => {
      if (s.drawerOpen !== prev.drawerOpen) settleFor(SETTLE_MS);
    });
    const unsubPanel = useUIState.subscribe((s, prev) => {
      if (s.rightPanel !== prev.rightPanel) settleFor(SETTLE_MS);
    });

    // Catches the DOM target itself appearing, disappearing, or being
    // resized by its own content (a drawer row's tooltip, a font swap) —
    // callback-driven, not polled.
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;
    if (target.kind === 'selector' || target.kind === 'role') {
      const el = resolveTourTargetElement(target);
      if (el) {
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(recompute);
          ro.observe(el);
        }
        if (typeof IntersectionObserver !== 'undefined') {
          io = new IntersectionObserver(recompute, { threshold: [0, 1] });
          io.observe(el);
        }
      }
    }
    // The overall document size (a narrower/wider layout from something
    // other than a plain `window.resize`, e.g. a font finishing load and
    // reflowing text) — belt-and-braces alongside the `resize` listener.
    let bodyRo: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      bodyRo = new ResizeObserver(recompute);
      bodyRo.observe(document.documentElement);
    }

    return () => {
      disposed = true;
      if (settleRaf) cancelAnimationFrame(settleRaf);
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
      for (const sub of busSubs) sub.dispose();
      unsubDrawer();
      unsubPanel();
      ro?.disconnect();
      io?.disconnect();
      bodyRo?.disconnect();
    };
  }, [target, placement]);

  const motionTransition = reducedMotion
    ? 'none'
    : 'left var(--duration-base) var(--ease-standard), top var(--duration-base) var(--ease-standard), ' +
      'width var(--duration-base) var(--ease-standard), height var(--duration-base) var(--ease-standard), ' +
      'opacity var(--duration-base) var(--ease-standard)';
  const cardTransition = reducedMotion ? 'none' : 'transform var(--duration-base) var(--ease-standard)';

  return (
    <div
      role="complementary"
      aria-label="Guided tour"
      className="pointer-events-none fixed inset-0 z-[var(--z-toast)]"
    >
      {/* The spotlight: a single element dimming the whole viewport except a
          cutout around the target, via a layered box-shadow (a huge spread
          for the dim, a tight one for the focus ring) rather than an SVG
          mask or four positioned rects — one element, one set of
          transitionable box coordinates, and trivially `pointer-events:
          none` everywhere including the dimmed area (see module doc's
          CRITICAL invariant). Absent with no target: `opacity: 0`, so a
          centered welcome/completion card never dims anything. */}
      <div
        ref={spotlightRef}
        aria-hidden="true"
        data-tour-spotlight
        className="pointer-events-none absolute rounded-md"
        style={{
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          opacity: 0,
          boxShadow:
            '0 0 0 2px var(--color-focus), 0 0 0 9999px color-mix(in oklch, var(--color-ink-900) 78%, transparent)',
          transition: motionTransition,
        }}
      />
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
        style={{ width: DEFAULT_CARD_SIZE.width, left: 0, top: 0, transition: cardTransition }}
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
