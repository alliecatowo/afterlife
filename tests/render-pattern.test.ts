import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type StampPattern, type StampTransform } from '@/core/types';
import { transformPattern } from '@/core/engine';

// Asymmetric L-tromino in a 2x3 box so every flip/rotation produces a
// distinguishable footprint:
//   X .
//   X .
//   X X
function lPattern(): StampPattern {
  const w = 2, h = 3;
  const cells = new Uint8Array(w * h);
  cells[0 * w + 0] = 1; // (0,0)
  cells[1 * w + 0] = 1; // (0,1)
  cells[2 * w + 0] = 1; // (0,2)
  cells[2 * w + 1] = 1; // (1,2)
  return { name: 'L', w, h, cells };
}

function grid(w: number, h: number, cells: Uint8Array): string {
  let s = '';
  for (let y = 0; y < h; y++) {
    s += Array.from({ length: w }, (_, x) => (cells[y * w + x] ? 'X' : '.')).join('') + '\n';
  }
  return s;
}

describe('transformPattern: ghost/stamp footprint agreement', () => {
  it('identity transform reproduces the pattern exactly', () => {
    const p = lPattern();
    const t = transformPattern(p, IDENTITY_TRANSFORM);
    expect(t.w).toBe(p.w);
    expect(t.h).toBe(p.h);
    expect([...t.cells]).toEqual([...p.cells]);
  });

  it('is deterministic — the ghost and any later stamp call agree by construction', () => {
    const p = lPattern();
    const transform: StampTransform = { rotate: 1, flipX: true, flipY: false };
    const a = transformPattern(p, transform);
    const b = transformPattern(p, transform);
    expect(a.w).toBe(b.w);
    expect(a.h).toBe(b.h);
    expect([...a.cells]).toEqual([...b.cells]);
    // transformPattern never mutates the source pattern.
    expect([...p.cells]).toEqual([1, 0, 1, 0, 1, 1]);
  });

  it('four quarter-turns return to the original footprint', () => {
    const p = lPattern();
    let cur = { w: p.w, h: p.h, cells: p.cells };
    for (let i = 0; i < 4; i++) {
      cur = transformPattern({ name: 'x', w: cur.w, h: cur.h, cells: cur.cells }, { rotate: 1, flipX: false, flipY: false });
    }
    expect(cur.w).toBe(p.w);
    expect(cur.h).toBe(p.h);
    expect([...cur.cells]).toEqual([...p.cells]);
  });

  it('a single clockwise quarter-turn swaps dimensions and rotates cells correctly', () => {
    const p = lPattern(); // 2 wide x 3 tall
    const t = transformPattern(p, { rotate: 1, flipX: false, flipY: false });
    expect(t.w).toBe(3);
    expect(t.h).toBe(2);
    // Rotating the L 90 clockwise:
    //  X . .        X X X
    //  X . .   -->  X . .
    //  X X
    expect(grid(t.w, t.h, t.cells)).toBe('XXX\nX..\n');
  });

  it('flipping twice on the same axis is the identity', () => {
    const p = lPattern();
    const once = transformPattern(p, { rotate: 0, flipX: true, flipY: false });
    const twice = transformPattern({ name: 'x', w: once.w, h: once.h, cells: once.cells }, { rotate: 0, flipX: true, flipY: false });
    expect([...twice.cells]).toEqual([...p.cells]);
  });

  it('flipX is applied before rotate, matching the documented StampTransform contract', () => {
    const p = lPattern();
    const flipThenRotate = transformPattern(p, { rotate: 1, flipX: true, flipY: false });
    const flipOnly = transformPattern(p, { rotate: 0, flipX: true, flipY: false });
    const rotateFlipOnly = transformPattern({ name: 'x', w: flipOnly.w, h: flipOnly.h, cells: flipOnly.cells }, { rotate: 1, flipX: false, flipY: false });
    expect([...flipThenRotate.cells]).toEqual([...rotateFlipOnly.cells]);
    expect(flipThenRotate.w).toBe(rotateFlipOnly.w);
    expect(flipThenRotate.h).toBe(rotateFlipOnly.h);
  });
});
