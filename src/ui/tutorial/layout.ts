/**
 * Pure geometry for the coach mark: given a target rect (or none), a
 * preferred side, the viewport, and the card's own measured size, decide
 * where the card goes and where its connector should anchor. No DOM reads —
 * `CoachMark` supplies the measurements; this just does the arithmetic, so
 * it's exercised directly in `tests/tutorial-layout.test.ts` rather than only
 * through a real browser.
 */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export type Placement = 'top' | 'bottom' | 'left' | 'right';

const VIEWPORT_MARGIN = 12;
const TARGET_GAP = 16;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

function boxFor(placement: Placement, target: Rect, card: Size): Rect {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  switch (placement) {
    case 'top':
      return { x: cx - card.width / 2, y: target.y - TARGET_GAP - card.height, width: card.width, height: card.height };
    case 'bottom':
      return { x: cx - card.width / 2, y: target.y + target.height + TARGET_GAP, width: card.width, height: card.height };
    case 'left':
      return { x: target.x - TARGET_GAP - card.width, y: cy - card.height / 2, width: card.width, height: card.height };
    case 'right':
      return { x: target.x + target.width + TARGET_GAP, y: cy - card.height / 2, width: card.width, height: card.height };
  }
}

function fitsViewport(box: Rect, viewport: Size): boolean {
  return (
    box.x >= VIEWPORT_MARGIN &&
    box.y >= VIEWPORT_MARGIN &&
    box.x + box.width <= viewport.width - VIEWPORT_MARGIN &&
    box.y + box.height <= viewport.height - VIEWPORT_MARGIN
  );
}

function clampToViewport(box: Rect, viewport: Size): Rect {
  return {
    ...box,
    x: clamp(box.x, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - box.width - VIEWPORT_MARGIN)),
    y: clamp(box.y, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - box.height - VIEWPORT_MARGIN)),
  };
}

/** Try the requested side first, then its opposite, then the two perpendicular sides —
 *  whichever is the first to actually fit inside the viewport without clamping. */
function candidateOrder(placement: Placement): Placement[] {
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const perpendicular: Placement[] = placement === 'top' || placement === 'bottom' ? ['left', 'right'] : ['top', 'bottom'];
  return [placement, opposite[placement], ...perpendicular];
}

/** The point on the card's edge the connector line should touch, given the
 *  side the card was actually placed on (BEFORE viewport clamping — a small,
 *  deliberate approximation: it keeps the line pointing the right general
 *  direction even in the rare case the card had to be nudged to fit). */
function anchorFor(placement: Placement, box: Rect): Point {
  switch (placement) {
    case 'top': return { x: box.x + box.width / 2, y: box.y + box.height };
    case 'bottom': return { x: box.x + box.width / 2, y: box.y };
    case 'left': return { x: box.x + box.width, y: box.y + box.height / 2 };
    case 'right': return { x: box.x, y: box.y + box.height / 2 };
  }
}

export interface CoachLayout {
  card: Rect;
  /** Where the connector line touches the card, or `null` with no target (a centered card, no line). */
  cardAnchor: Point | null;
  /** Where the connector line touches the target (its center), or `null` with no target. */
  targetAnchor: Point | null;
}

export function placeCoachMark(
  target: Rect | null,
  placement: Placement,
  viewport: Size,
  card: Size,
): CoachLayout {
  if (!target) {
    // Deliberately NOT dead-center: the welcome/completion steps have no
    // control to anchor to, but the middle of the screen is exactly where a
    // live instrument expects clicks (drawing, selecting) to land. Anchoring
    // low — the same "quiet invitation" register `@/ui/WorldHint` already
    // uses near the timeline — keeps the card out of the way of the world
    // it's sitting in front of, per the "never a jail" rule.
    const x = clamp((viewport.width - card.width) / 2, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - card.width - VIEWPORT_MARGIN));
    const y = clamp(viewport.height - card.height - 96, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - card.height - VIEWPORT_MARGIN));
    return { card: { x, y, width: card.width, height: card.height }, cardAnchor: null, targetAnchor: null };
  }

  let chosen: Placement = placement;
  let box = boxFor(placement, target, card);
  for (const candidate of candidateOrder(placement)) {
    const attempt = boxFor(candidate, target, card);
    if (fitsViewport(attempt, viewport)) {
      chosen = candidate;
      box = attempt;
      break;
    }
  }

  const cardAnchor = anchorFor(chosen, box);
  const targetAnchor: Point = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  return { card: clampToViewport(box, viewport), cardAnchor, targetAnchor };
}
