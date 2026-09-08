/**
 * Regression test for the tour's "corner flash" bug: advancing between
 * steps used to fully remount the coach mark's card (`key={stepKey}`), and
 * conditionally mount its connector dot (`hasTarget &&`) — so the FIRST
 * paint of either freshly-mounted node showed nothing but its raw JSX
 * default: `left: 0, top: 0`, no `transform` — the viewport's literal
 * top-left corner — for one or two real animation frames before
 * `recompute()`'s (deferred, `requestAnimationFrame`-driven) position write
 * caught up and eased it to the correct spot. A plain "eventually correct"
 * assertion can't catch a one-frame visual glitch; this test samples the
 * actual rendered geometry on every real animation frame across a step
 * transition and asserts it is never at/near the origin and never outside
 * the sane travel path between the two targets — see `@/ui/tutorial/
 * CoachMark`'s module doc for the full root-cause writeup.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { CoachMark, type CoachMarkProps } from '@/ui/tutorial/CoachMark';
import { useAppStore } from '@/ui/store';
import type { TourTarget } from '@/content/tour';

/** jsdom never actually lays anything out, so a real element's
 *  `getBoundingClientRect()` is always a zero rect — same stubbing
 *  technique as `tests/tutorial-targeting.test.ts`. */
function stubRect(el: Element, rect: { x: number; y: number; width: number; height: number }): void {
  el.getBoundingClientRect = () =>
    ({ ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON() { return this; } }) as DOMRect;
}

/** jsdom doesn't implement `matchMedia` at all (calling it throws) — same
 *  stub shape as `tests/render-camera.test.ts`'s `stubReducedMotion`. */
function stubReducedMotion(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  })) as unknown as typeof window.matchMedia;
}

/** jsdom provides a real `requestAnimationFrame` (see `tests/loop.test.ts`). */
function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SpotlightSample { left: number; top: number; width: number; height: number; opacity: number }

function readSpotlight(el: HTMLElement): SpotlightSample {
  return {
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
    width: parseFloat(el.style.width) || 0,
    height: parseFloat(el.style.height) || 0,
    opacity: el.style.opacity === '' ? 1 : parseFloat(el.style.opacity),
  };
}

/** The card's position is set via `transform: translate(Xpx, Ypx)`, not
 *  `left`/`top` — parsed straight out of the inline style string rather
 *  than `getBoundingClientRect()` (useless under jsdom, see above). */
function readCardTranslate(el: HTMLElement): { x: number; y: number } {
  const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(el.style.transform);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

const BASE_PROPS: Omit<CoachMarkProps, 'stepKey' | 'target' | 'placement'> = {
  title: 'Title',
  body: 'Body',
  stepNumber: 1,
  totalSteps: 3,
  onNext: () => {},
  onSkip: () => {},
  isLast: false,
};

describe('CoachMark: no corner flash between steps', () => {
  let appended: HTMLElement[] = [];

  beforeEach(() => {
    stubReducedMotion(false);
    appended = [];
  });

  afterEach(() => {
    cleanup();
    for (const el of appended) el.remove();
    // @ts-expect-error test-only cleanup of a property this suite adds
    delete window.matchMedia;
    useAppStore.getState().setDrawerOpen(true); // restore the store's real default
  });

  function appendTarget(attrs: Record<string, string>, rect: { x: number; y: number; width: number; height: number }): HTMLElement {
    const el = document.createElement('button');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    stubRect(el, rect);
    appended.push(el);
    return el;
  }

  it('holds the previous target and eases smoothly — never a zero/origin rect — across a transition where the next target lives inside a panel still opening', async () => {
    useAppStore.getState().setDrawerOpen(false); // simulate: the drawer/panel starts CLOSED

    const targetA: TourTarget = { kind: 'selector', selectors: ['[data-test="a"]'] };
    const targetB: TourTarget = { kind: 'role', role: 'radio', name: 'Draw' };
    const rectA = { x: 80, y: 80, width: 40, height: 24 };
    const rectB = { x: 600, y: 420, width: 36, height: 22 };

    appendTarget({ 'data-test': 'a' }, rectA);

    const { container, rerender } = render(
      <CoachMark {...BASE_PROPS} stepKey="a" target={targetA} placement="bottom" />,
    );

    // Let it settle on step A first.
    await act(async () => { await waitFrame(); await waitFrame(); });

    const spotlight = container.querySelector('[data-tour-spotlight]') as HTMLElement;
    const card = container.querySelector('[data-tour-card]') as HTMLElement;
    expect(spotlight).toBeTruthy();
    expect(card).toBeTruthy();

    const afterA = readSpotlight(spotlight);
    expect(afterA.width).toBeGreaterThan(0);
    expect(afterA.left).toBeCloseTo(rectA.x - 8, 0); // SPOTLIGHT_PADDING (layout.ts)

    // --- Advance to step B, whose target ("Draw" radio) does not exist in
    // the DOM yet — exactly like a drawer/panel that hasn't finished
    // opening (`onEnter` for the real `draw` step opens the drawer, but
    // that's a separate, later-firing effect — see the module doc).
    rerender(<CoachMark {...BASE_PROPS} stepKey="b" target={targetB} placement="right" />);

    // THE regression check, synchronous: the instant the step changes,
    // before any frame has passed, the DOM must be UNCHANGED from step A's
    // resolved position — never reset to the raw JSX default (origin, zero
    // area), and the card must be the SAME node, never remounted.
    expect(readSpotlight(spotlight)).toEqual(afterA);
    expect(container.querySelector('[data-tour-card]')).toBe(card);

    // Now sample every real animation frame while the panel "opens".
    const samples: Array<SpotlightSample & { cardX: number; cardY: number }> = [];
    let sampling = true;
    function sample() {
      if (!sampling) return;
      const s = readSpotlight(spotlight);
      const c = readCardTranslate(card);
      samples.push({ ...s, cardX: c.x, cardY: c.y });
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);

    // Partway through the bounded settle window, the panel "finishes
    // opening": the target now exists in the DOM, and the store fires the
    // same `drawerOpen` change the real drawer's `onEnter` would (well
    // inside `SETTLE_MS` — the whole point is this resolves within the
    // hold window instead of timing out to the centered fallback).
    await waitMs(120);
    appendTarget({ role: 'radio', 'aria-label': 'Draw' }, rectB);
    act(() => { useAppStore.getState().setDrawerOpen(true); });

    // Give it comfortably past `--duration-base`'s ease plus a few more frames.
    await waitMs(400);
    sampling = false;
    await waitFrame();

    expect(samples.length).toBeGreaterThan(5);

    const envelope = {
      minX: Math.min(rectA.x, rectB.x) - 20,
      minY: Math.min(rectA.y, rectB.y) - 20,
      maxX: Math.max(rectA.x + rectA.width, rectB.x + rectB.width) + 20,
      maxY: Math.max(rectA.y + rectA.height, rectB.y + rectB.height) + 20,
    };

    for (const s of samples) {
      if (s.opacity > 0.05) {
        // Never a near-zero-area rect sitting at/near the origin — the
        // exact shape of the flash this test guards against.
        const nearOriginZeroArea = s.left < 4 && s.top < 4 && s.width < 8 && s.height < 8;
        expect(nearOriginZeroArea).toBe(false);
        // Never outside a sane travel path between the two real targets.
        expect(s.left).toBeGreaterThanOrEqual(envelope.minX);
        expect(s.top).toBeGreaterThanOrEqual(envelope.minY);
        expect(s.left + s.width).toBeLessThanOrEqual(envelope.maxX);
        expect(s.top + s.height).toBeLessThanOrEqual(envelope.maxY);
      }
      // The card itself never sits at the literal viewport corner mid-flight.
      expect(s.cardX === 0 && s.cardY === 0).toBe(false);
    }

    // And it genuinely resolved onto the new target by the end — it didn't
    // just hold the old one forever, or time out to the fallback.
    const final = readSpotlight(spotlight);
    expect(final.left).toBeCloseTo(rectB.x - 8, 0);
    expect(final.top).toBeCloseTo(rectB.y - 8, 0);
  });

  it('never resolves a genuinely-unreachable target to a corner rect — falls back to the honest centered/no-cutout state once the bounded window elapses', async () => {
    const targetA: TourTarget = { kind: 'selector', selectors: ['[data-test="fa"]'] };
    const targetGone: TourTarget = { kind: 'selector', selectors: ['[data-test="never-appears"]'] };
    const rectA = { x: 80, y: 80, width: 40, height: 24 };
    appendTarget({ 'data-test': 'fa' }, rectA);

    const { container, rerender } = render(
      <CoachMark {...BASE_PROPS} stepKey="fa" target={targetA} placement="bottom" />,
    );
    await act(async () => { await waitFrame(); await waitFrame(); });

    const spotlight = container.querySelector('[data-tour-spotlight]') as HTMLElement;
    const card = container.querySelector('[data-tour-card]') as HTMLElement;

    rerender(<CoachMark {...BASE_PROPS} stepKey="gone" target={targetGone} placement="bottom" />);

    const samples: SpotlightSample[] = [];
    let sampling = true;
    function sample() {
      if (!sampling) return;
      samples.push(readSpotlight(spotlight));
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);

    // Comfortably past `SETTLE_MS` (450ms) with the target never appearing.
    await waitMs(650);
    sampling = false;
    await waitFrame();

    // Never a corner flash while giving up, either.
    for (const s of samples) {
      if (s.opacity > 0.05) {
        const nearOriginZeroArea = s.left < 4 && s.top < 4 && s.width < 8 && s.height < 8;
        expect(nearOriginZeroArea).toBe(false);
      }
    }
    // Settles honestly on "no target": the spotlight fades out rather than
    // pointing at a stale or invalid rect.
    expect(readSpotlight(spotlight).opacity).toBeLessThan(0.05);
    expect(container.querySelector('[data-tour-card]')).toBe(card);
  });

  it('prefers-reduced-motion: cuts instantly between resolved rects, never through an invalid intermediate state', async () => {
    stubReducedMotion(true);
    const targetA: TourTarget = { kind: 'selector', selectors: ['[data-test="ra"]'] };
    const targetB: TourTarget = { kind: 'selector', selectors: ['[data-test="rb"]'] };
    const rectA = { x: 50, y: 60, width: 30, height: 20 };
    const rectB = { x: 300, y: 200, width: 30, height: 20 };
    appendTarget({ 'data-test': 'ra' }, rectA);
    appendTarget({ 'data-test': 'rb' }, rectB);

    const { container, rerender } = render(
      <CoachMark {...BASE_PROPS} stepKey="ra" target={targetA} placement="bottom" />,
    );
    await act(async () => { await waitFrame(); });

    const spotlight = container.querySelector('[data-tour-spotlight]') as HTMLElement;
    expect(spotlight.style.transition).toBe('none');

    const samples: SpotlightSample[] = [];
    let sampling = true;
    function sample() {
      if (!sampling) return;
      samples.push(readSpotlight(spotlight));
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);

    rerender(<CoachMark {...BASE_PROPS} stepKey="rb" target={targetB} placement="bottom" />);

    await waitMs(150);
    sampling = false;
    await waitFrame();

    for (const s of samples) {
      if (s.opacity > 0.05) {
        const nearOriginZeroArea = s.left < 4 && s.top < 4 && s.width < 8 && s.height < 8;
        expect(nearOriginZeroArea).toBe(false);
        // With motion cut, every visible sample must match EITHER the old
        // or the new resting rect exactly — nothing in between, nothing else.
        const matchesA = Math.abs(s.left - (rectA.x - 8)) < 1 && Math.abs(s.top - (rectA.y - 8)) < 1;
        const matchesB = Math.abs(s.left - (rectB.x - 8)) < 1 && Math.abs(s.top - (rectB.y - 8)) < 1;
        expect(matchesA || matchesB).toBe(true);
      }
    }
  });
});
