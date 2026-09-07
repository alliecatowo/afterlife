import { describe, expect, it } from 'vitest';
import { bresenhamLine } from '@/interact/input';

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

describe('bresenhamLine: connected stroke interpolation', () => {
  it('includes both endpoints', () => {
    const pts = bresenhamLine(0, 0, 10, 4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 4 });
  });

  it('is 8-connected end-to-end for a fast diagonal drag (no gaps)', () => {
    // Simulates a big jump between two pointermove samples, as happens on a
    // fast swipe — every consecutive pair must be adjacent (including
    // diagonally), never skipping a cell.
    const pts = bresenhamLine(-50, -30, 137, 212);
    for (let i = 1; i < pts.length; i++) {
      expect(chebyshev(pts[i - 1]!, pts[i]!)).toBe(1);
    }
    // No duplicate consecutive points either.
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]).not.toEqual(pts[i - 1]);
    }
  });

  it('handles a pure horizontal, vertical, and single-cell case', () => {
    expect(bresenhamLine(2, 5, 2, 5)).toEqual([{ x: 2, y: 5 }]);
    const horiz = bresenhamLine(0, 0, 5, 0);
    expect(horiz).toHaveLength(6);
    expect(horiz.every((p) => p.y === 0)).toBe(true);
    const vert = bresenhamLine(0, 0, 0, -5);
    expect(vert).toHaveLength(6);
    expect(vert.every((p) => p.x === 0)).toBe(true);
  });

  it('is symmetric in length regardless of direction', () => {
    const forward = bresenhamLine(3, 3, -9, 17);
    const backward = bresenhamLine(-9, 17, 3, 3);
    expect(forward.length).toBe(backward.length);
  });
});
