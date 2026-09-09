import { describe, expect, it } from 'vitest';
import { atlasCanvasSize, atlasCellPxBucket, atlasCellRect, MAX_ATLAS_CELL_PX } from '@/render/glyphAtlas';

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

  describe('PERF: the bucket is capped so zooming in far never keeps rebuilding a bigger and bigger atlas', () => {
    it('never exceeds MAX_ATLAS_CELL_PX, no matter how large the on-screen cell gets', () => {
      expect(atlasCellPxBucket(MAX_ATLAS_CELL_PX)).toBe(MAX_ATLAS_CELL_PX);
      expect(atlasCellPxBucket(MAX_ATLAS_CELL_PX + 1)).toBe(MAX_ATLAS_CELL_PX);
      expect(atlasCellPxBucket(200)).toBe(MAX_ATLAS_CELL_PX);
      expect(atlasCellPxBucket(10_000)).toBe(MAX_ATLAS_CELL_PX);
    });

    it('is a flat constant once capped — no more distinct buckets to rebuild for, ever, past the cap', () => {
      const beyondCap = [65, 100, 500, 5000, 1_000_000].map(atlasCellPxBucket);
      expect(new Set(beyondCap).size).toBe(1);
      expect(beyondCap[0]).toBe(MAX_ATLAS_CELL_PX);
    });

    it('below the cap, behaviour is unchanged from the original uncapped bucketing', () => {
      for (let px = 4; px <= MAX_ATLAS_CELL_PX; px += 3) {
        expect(atlasCellPxBucket(px)).toBe(Math.max(4, Math.round(px / 2) * 2));
      }
    });
  });
});
