import { describe, expect, it } from 'vitest';
import { encodeGif, type GifFrame } from '@/export/gif/gifWriter';
import type { RgbColor } from '@/export/gif/quantize';

function bytesToString(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.slice(start, start + len));
}

describe('encodeGif: structural validity', () => {
  it('starts with the GIF89a header and ends with the trailer byte', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const frame: GifFrame = { indices: new Uint8Array([0, 1, 1, 0]), palette, delayCentiseconds: 10 };
    const bytes = encodeGif({ width: 2, height: 2, frames: [frame] });
    expect(bytesToString(bytes, 0, 6)).toBe('GIF89a');
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it('encodes width/height in the Logical Screen Descriptor', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const frame: GifFrame = { indices: new Uint8Array(30 * 20), palette, delayCentiseconds: 5 };
    const bytes = encodeGif({ width: 30, height: 20, frames: [frame] });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(6, true)).toBe(30);
    expect(view.getUint16(8, true)).toBe(20);
  });

  it('includes a NETSCAPE2.0 application extension for looping', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const frame: GifFrame = { indices: new Uint8Array([0, 1]), palette, delayCentiseconds: 5 };
    const bytes = encodeGif({ width: 2, height: 1, frames: [frame], loopCount: 0 });
    const str = bytesToString(bytes, 0, bytes.length);
    expect(str).toContain('NETSCAPE2.0');
  });

  it('writes one Graphic Control Extension (0x21 0xF9) per frame with the requested delay', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const frames: GifFrame[] = [
      { indices: new Uint8Array([0, 1]), palette, delayCentiseconds: 25 },
      { indices: new Uint8Array([1, 0]), palette, delayCentiseconds: 25 },
    ];
    const bytes = encodeGif({ width: 2, height: 1, frames });
    let gceCount = 0;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
        gceCount++;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        expect(view.getUint16(i + 4, true)).toBe(25);
      }
    }
    expect(gceCount).toBe(2);
  });

  it('writes one Image Descriptor (0x2C) per frame', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const frames: GifFrame[] = [
      { indices: new Uint8Array([0, 1]), palette, delayCentiseconds: 10 },
      { indices: new Uint8Array([1, 0]), palette, delayCentiseconds: 10 },
      { indices: new Uint8Array([0, 0]), palette, delayCentiseconds: 10 },
    ];
    const bytes = encodeGif({ width: 2, height: 1, frames });
    const count = Array.from(bytes).filter((b) => b === 0x2c).length;
    expect(count).toBe(3);
  });

  it('uses one shared global colour table when every frame passes the same palette reference', () => {
    const palette: RgbColor[] = [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }];
    const frames: GifFrame[] = [
      { indices: new Uint8Array([0, 1]), palette, delayCentiseconds: 10 },
      { indices: new Uint8Array([1, 0]), palette, delayCentiseconds: 10 },
    ];
    const bytes = encodeGif({ width: 2, height: 1, frames });
    // Global colour table flag (bit 7 of byte 10) must be set.
    expect(bytes[10]! & 0x80).toBe(0x80);
    // Colour 1,2,3 should appear exactly once in the file (the shared GCT),
    // not duplicated as a local table per frame.
    let occurrences = 0;
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] === 1 && bytes[i + 1] === 2 && bytes[i + 2] === 3) occurrences++;
    }
    expect(occurrences).toBe(1);
  });

  it('falls back to a local colour table per frame when palettes differ', () => {
    const paletteA: RgbColor[] = [{ r: 10, g: 20, b: 30 }, { r: 40, g: 50, b: 60 }];
    const paletteB: RgbColor[] = [{ r: 70, g: 80, b: 90 }, { r: 100, g: 110, b: 120 }];
    const frames: GifFrame[] = [
      { indices: new Uint8Array([0, 1]), palette: paletteA, delayCentiseconds: 10 },
      { indices: new Uint8Array([1, 0]), palette: paletteB, delayCentiseconds: 10 },
    ];
    const bytes = encodeGif({ width: 2, height: 1, frames });
    // No global colour table this time.
    expect(bytes[10]! & 0x80).toBe(0);
    const str = Array.from(bytes);
    // Both palettes' first colour must appear somewhere (as local tables).
    expect(str.some((_, i) => bytes[i] === 10 && bytes[i + 1] === 20 && bytes[i + 2] === 30)).toBe(true);
    expect(str.some((_, i) => bytes[i] === 70 && bytes[i + 1] === 80 && bytes[i + 2] === 90)).toBe(true);
  });

  it('clamps a sub-1-centisecond delay up to a decoder-friendly minimum', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const frame: GifFrame = { indices: new Uint8Array([0, 1]), palette, delayCentiseconds: 0 };
    const bytes = encodeGif({ width: 2, height: 1, frames: [frame] });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let gceIndex = -1;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) { gceIndex = i; break; }
    }
    expect(gceIndex).toBeGreaterThan(-1);
    expect(view.getUint16(gceIndex + 4, true)).toBeGreaterThanOrEqual(1);
  });

  it('rejects non-positive dimensions', () => {
    const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }];
    expect(() => encodeGif({ width: 0, height: 4, frames: [{ indices: new Uint8Array(0), palette, delayCentiseconds: 10 }] })).toThrow();
  });
});
