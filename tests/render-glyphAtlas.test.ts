import { describe, expect, it } from 'vitest';
import { atlasCanvasSize, atlasCellPxBucket, atlasCellRect } from '@/render/glyphAtlas';

describe('glyph atlas layout maths (pure, no canvas needed)', () => {
  it('lays out cells left to right with no gap or overlap', () => {
    const cellPx = 16;
    for (let i = 0; i < 10; i++) {
      const r = atlasCellRect(i, cellPx);
      expect(r.sx).toBe(i * cellPx);
      expect(r.sy).toBe(0);
      expect(r.sw).toBe(cellPx);
      expect(r.sh).toBe(cellPx);
    }
    // Adjacent cells are exactly contiguous (no drift/gap).
    const a = atlasCellRect(2, cellPx);
    const b = atlasCellRect(3, cellPx);
    expect(a.sx + a.sw).toBe(b.sx);
  });

  it('atlasCanvasSize matches the number of characters exactly', () => {
    expect(atlasCanvasSize(10, 16)).toEqual({ w: 160, h: 16 });
    expect(atlasCanvasSize(0, 16)).toEqual({ w: 16, h: 16 }); // never zero-width
  });

  it('atlasCellPxBucket rounds to even 2px steps and never drops below 4', () => {
    expect(atlasCellPxBucket(11)).toBe(12);
    expect(atlasCellPxBucket(12)).toBe(12);
    expect(atlasCellPxBucket(1)).toBe(4);
    expect(atlasCellPxBucket(0)).toBe(4);
    // Small zoom jitter within a bucket doesn't change the bucket.
    expect(atlasCellPxBucket(20)).toBe(atlasCellPxBucket(20.9));
  });
});
