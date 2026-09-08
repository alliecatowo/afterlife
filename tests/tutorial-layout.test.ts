import { describe, expect, it } from 'vitest';
import { placeCoachMark, SPOTLIGHT_PADDING } from '@/ui/tutorial/layout';

const VIEWPORT = { width: 1440, height: 900 };
const CARD = { width: 300, height: 150 };

describe('tutorial: placeCoachMark', () => {
  it('has no connector with no target, and sits low rather than dead-center (never over the middle of the world)', () => {
    const layout = placeCoachMark(null, 'bottom', VIEWPORT, CARD);
    expect(layout.cardAnchor).toBeNull();
    expect(layout.targetAnchor).toBeNull();
    expect(layout.card.x).toBeCloseTo((VIEWPORT.width - CARD.width) / 2, 0);
    // Below the vertical midpoint — the exact center is where a live
    // instrument expects clicks (drawing, selecting) to land.
    expect(layout.card.y).toBeGreaterThan(VIEWPORT.height / 2);
    expect(layout.card.y + layout.card.height).toBeLessThanOrEqual(VIEWPORT.height - 12);
  });

  it('places the card below the target for placement "bottom", with a connector anchored to the target center', () => {
    const target = { x: 600, y: 100, width: 40, height: 20 };
    const layout = placeCoachMark(target, 'bottom', VIEWPORT, CARD);
    expect(layout.card.y).toBeGreaterThan(target.y + target.height);
    expect(layout.targetAnchor).toEqual({ x: 620, y: 110 });
    // The card is horizontally centered on the target.
    expect(layout.card.x + layout.card.width / 2).toBeCloseTo(620, 0);
  });

  it('places the card above the target for placement "top"', () => {
    const target = { x: 600, y: 400, width: 40, height: 20 };
    const layout = placeCoachMark(target, 'top', VIEWPORT, CARD);
    expect(layout.card.y + layout.card.height).toBeLessThan(target.y);
  });

  it('places the card to the right for "right" and to the left for "left"', () => {
    const target = { x: 700, y: 400, width: 40, height: 20 };
    const right = placeCoachMark(target, 'right', VIEWPORT, CARD);
    expect(right.card.x).toBeGreaterThan(target.x + target.width);
    const left = placeCoachMark(target, 'left', VIEWPORT, CARD);
    expect(left.card.x + left.card.width).toBeLessThan(target.x);
  });

  it('never places the card outside the viewport, even for a target hugging the edge', () => {
    // A target in the top-left corner requesting "top" placement cannot fit
    // above it — the card must fall back to a side that does, or clamp.
    const target = { x: 4, y: 4, width: 10, height: 10 };
    const layout = placeCoachMark(target, 'top', VIEWPORT, CARD);
    expect(layout.card.x).toBeGreaterThanOrEqual(0);
    expect(layout.card.y).toBeGreaterThanOrEqual(0);
    expect(layout.card.x + layout.card.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(layout.card.y + layout.card.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('stays fully on-screen at a 390x844 mobile viewport for every placement', () => {
    const mobile = { width: 390, height: 844 };
    const target = { x: 20, y: 20, width: 200, height: 40 };
    for (const placement of ['top', 'bottom', 'left', 'right'] as const) {
      const layout = placeCoachMark(target, placement, mobile, CARD);
      expect(layout.card.x).toBeGreaterThanOrEqual(0);
      expect(layout.card.y).toBeGreaterThanOrEqual(0);
      expect(layout.card.x + layout.card.width).toBeLessThanOrEqual(mobile.width);
      expect(layout.card.y + layout.card.height).toBeLessThanOrEqual(mobile.height);
    }
  });

  it('never covers the target it is describing when a non-overlapping placement fits', () => {
    const target = { x: 700, y: 400, width: 40, height: 20 };
    const layout = placeCoachMark(target, 'bottom', VIEWPORT, CARD);
    const overlaps =
      layout.card.x < target.x + target.width &&
      layout.card.x + layout.card.width > target.x &&
      layout.card.y < target.y + target.height &&
      layout.card.y + layout.card.height > target.y;
    expect(overlaps).toBe(false);
  });

  describe('spotlight cutout', () => {
    it('is null with no target', () => {
      const layout = placeCoachMark(null, 'bottom', VIEWPORT, CARD);
      expect(layout.spotlight).toBeNull();
    });

    it('pads the target bounding box symmetrically by SPOTLIGHT_PADDING', () => {
      const target = { x: 600, y: 100, width: 40, height: 20 };
      const layout = placeCoachMark(target, 'bottom', VIEWPORT, CARD);
      expect(layout.spotlight).toEqual({
        x: target.x - SPOTLIGHT_PADDING,
        y: target.y - SPOTLIGHT_PADDING,
        width: target.width + SPOTLIGHT_PADDING * 2,
        height: target.height + SPOTLIGHT_PADDING * 2,
      });
    });

    it('never overlaps the card, for every placement — the spotlight padding is smaller than the target gap', () => {
      const target = { x: 700, y: 400, width: 40, height: 20 };
      for (const placement of ['top', 'bottom', 'left', 'right'] as const) {
        const layout = placeCoachMark(target, placement, VIEWPORT, CARD);
        const s = layout.spotlight!;
        const overlaps =
          layout.card.x < s.x + s.width &&
          layout.card.x + layout.card.width > s.x &&
          layout.card.y < s.y + s.height &&
          layout.card.y + layout.card.height > s.y;
        expect(overlaps).toBe(false);
      }
    });
  });
});
