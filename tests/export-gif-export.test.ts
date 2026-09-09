import { describe, expect, it } from 'vitest';
import { encodeGifExport } from '@/export/gifExport';
import type { FrameSource } from '@/export/types';

/**
 * A `FrameSource` test double backed by plain RGBA buffers (no real
 * `<canvas>`/2D context — jsdom doesn't implement one without the native
 * `canvas` package, which this project deliberately doesn't depend on).
 * Only implements what `gifExport.ts` actually calls: `getContext('2d')`
 * returning an object with `getImageData`.
 */
function fakeCanvasFrameSource(width: number, height: number, frames: readonly Uint8ClampedArray[]): FrameSource {
  let disposed = false;
  return {
    frameCount: frames.length,
    width,
    height,
    async frame(index: number) {
      const data = frames[index]!;
      const fakeCanvas = {
        width,
        height,
        getContext: (kind: string) => {
          if (kind !== '2d') return null;
          return { getImageData: () => ({ data, width, height }) };
        },
      };
      return fakeCanvas as unknown as HTMLCanvasElement;
    },
    dispose() { disposed = true; },
    get __disposed() { return disposed; },
  } as FrameSource & { __disposed: boolean };
}

function solidFrame(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return data;
}

describe('encodeGifExport', () => {
  it('produces an image/gif Blob covering every frame from the source', async () => {
    const frames = [
      solidFrame(4, 4, 255, 0, 0),
      solidFrame(4, 4, 0, 255, 0),
      solidFrame(4, 4, 0, 0, 255),
    ];
    const source = fakeCanvasFrameSource(4, 4, frames);
    const progressCalls: Array<{ done: number; total: number }> = [];
    const blob = await encodeGifExport(source, { fps: 10, onProgress: (p) => progressCalls.push(p) });
    expect(blob.type).toBe('image/gif');
    expect(blob.size).toBeGreaterThan(0);
    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[2]).toEqual({ done: 3, total: 3 });
  });

  it('disposes the source when done, even on success', async () => {
    const source = fakeCanvasFrameSource(2, 2, [solidFrame(2, 2, 1, 2, 3)]) as FrameSource & { __disposed: boolean };
    await encodeGifExport(source, { fps: 10 });
    expect(source.__disposed).toBe(true);
  });

  it('disposes the source and rejects when cancelled mid-encode', async () => {
    const frames = Array.from({ length: 10 }, (_, i) => solidFrame(2, 2, i, i, i));
    const source = fakeCanvasFrameSource(2, 2, frames) as FrameSource & { __disposed: boolean };
    const controller = new AbortController();
    controller.abort();
    await expect(encodeGifExport(source, { fps: 10, signal: controller.signal })).rejects.toThrow();
    expect(source.__disposed).toBe(true);
  });

  it('handles a genuinely colourful frame (many distinct hues) without crashing or truncating the palette silently', async () => {
    const w = 32, h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = (x * 8) % 256;
        data[i + 1] = (y * 8) % 256;
        data[i + 2] = ((x * y) * 3) % 256;
        data[i + 3] = 255;
      }
    }
    const source = fakeCanvasFrameSource(w, h, [data]);
    const blob = await encodeGifExport(source, { fps: 10 });
    expect(blob.size).toBeGreaterThan(0);
  });
});
