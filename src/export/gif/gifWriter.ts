/**
 * GIF89a container assembly. Hand-written per this project's "zero new
 * dependencies" rule; verified in `tests/export-gif.test.ts` (structural
 * byte-level checks — headers, block signatures, trailer) and, more
 * importantly, in `e2e/gif-export.spec.ts` against Chromium's OWN GIF
 * decoder (`ImageDecoder`) — a real third-party reference implementation,
 * not this module's own round-trip. See that spec for why that's the actual
 * verification that matters.
 *
 * Builds the output as a list of `Uint8Array` chunks concatenated once at the
 * end (same shape as `@/export/zip.ts`'s writer) rather than a single
 * `number[]` grown one `push()` at a time — a max-size GIF (`MAX_GIF_FRAMES`
 * x `MAX_GIF_DIMENSION`² in `limits.ts`) can have several hundred thousand
 * LZW-compressed bytes per frame, and boxed-number arrays that large cost
 * real memory and GC time for no benefit over typed-array chunks.
 */
import { gifLzwEncode } from './lzw';
import type { RgbColor } from './quantize';

export interface GifFrame {
  /** Palette indices, `width * height` long, row-major. */
  indices: Uint8Array;
  /** This frame's colour table. If it differs from other frames', it's
   *  written as a local colour table; if every frame shares the same
   *  palette instance the writer emits one global colour table instead
   *  (smaller file, still legal). */
  palette: readonly RgbColor[];
  /** Display duration, in 1/100s units (GIF's native delay resolution). */
  delayCentiseconds: number;
}

export interface GifEncodeOptions {
  width: number;
  height: number;
  frames: readonly GifFrame[];
  /** 0 = loop forever (the GIF convention), matching a shareable clip's
   *  expectation. */
  loopCount?: number;
}

function nextPow2Ceil(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return Math.max(2, p);
}

/** GIF colour tables must be a power of two in size, 2..256 entries. */
function paletteTableSize(paletteLength: number): number {
  return Math.min(256, nextPow2Ceil(paletteLength));
}

/** The 3-bit "size of colour table" field stores `log2(size) - 1`. */
function colorTableSizeField(tableSize: number): number {
  return Math.round(Math.log2(tableSize)) - 1;
}

function minCodeSizeFor(tableSize: number): number {
  // GIF requires the LZW minimum code size to be at least 2, even for a
  // 2-colour image — codes 0/1 are still literal indices either way.
  return Math.max(2, Math.round(Math.log2(tableSize)));
}

function paletteBytes(palette: readonly RgbColor[], tableSize: number): Uint8Array {
  const out = new Uint8Array(tableSize * 3);
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? { r: 0, g: 0, b: 0 };
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

/** Split raw LZW data into GIF's sub-block format: a length byte (1..255)
 *  followed by that many data bytes, repeated, terminated by a 0-length block. */
function toSubBlocks(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.length / 255));
  const out = new Uint8Array(data.length + blockCount + 1);
  let outPos = 0;
  let offset = 0;
  do {
    const chunkSize = Math.min(255, data.length - offset);
    out[outPos++] = chunkSize;
    out.set(data.subarray(offset, offset + chunkSize), outPos);
    outPos += chunkSize;
    offset += chunkSize;
  } while (offset < data.length);
  out[outPos++] = 0; // block terminator
  return out.subarray(0, outPos);
}

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function stringBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function u16(n: number): Uint8Array {
  return Uint8Array.from([n & 0xff, (n >> 8) & 0xff]);
}

/** True when every frame passes the exact same `palette` array reference —
 *  the common case here, since `gifExport.ts` builds one shared global
 *  palette from sampled pixels across all frames before quantising each one. */
function sharesOnePalette(frames: readonly GifFrame[]): boolean {
  if (frames.length === 0) return true;
  const first = frames[0]!.palette;
  return frames.every((f) => f.palette === first);
}

export function encodeGif(opts: GifEncodeOptions): Uint8Array {
  const { width, height, frames } = opts;
  if (width <= 0 || height <= 0) throw new Error('encodeGif: width/height must be positive');
  const loopCount = Math.max(0, Math.min(0xffff, opts.loopCount ?? 0));
  const parts: Uint8Array[] = [];
  const push = (p: Uint8Array): void => { parts.push(p); };

  const global = sharesOnePalette(frames) && frames.length > 0 ? frames[0]!.palette : null;
  const globalTableSize = global ? paletteTableSize(global.length) : 2;

  // ---- Header ----
  push(stringBytes('GIF89a'));

  // ---- Logical Screen Descriptor ----
  push(u16(width));
  push(u16(height));
  // Packed byte: global color table flag(1) | color resolution(3) | sort(1) | GCT size(3)
  const gctFlag = global ? 0x80 : 0;
  const gctSizeField = global ? colorTableSizeField(globalTableSize) : 0;
  push(bytesOf(gctFlag | 0x70 | gctSizeField)); // color resolution bits conventionally set to 7 (8-bit)
  push(bytesOf(0)); // background color index
  push(bytesOf(0)); // pixel aspect ratio

  if (global) push(paletteBytes(global, globalTableSize));

  // ---- Netscape Application Extension (looping) ----
  push(bytesOf(0x21, 0xff, 11));
  push(stringBytes('NETSCAPE2.0'));
  push(bytesOf(3, 1));
  push(u16(loopCount));
  push(bytesOf(0));

  for (const frame of frames) {
    const delay = Math.max(1, Math.round(frame.delayCentiseconds));

    // ---- Graphic Control Extension ----
    push(bytesOf(0x21, 0xf9, 4));
    push(bytesOf(0x04)); // disposal method 1 (do not dispose), no transparency, no user input
    push(u16(delay));
    push(bytesOf(0)); // transparent color index (unused)
    push(bytesOf(0));

    // ---- Image Descriptor ----
    push(bytesOf(0x2c));
    push(u16(0)); // left
    push(u16(0)); // top
    push(u16(width));
    push(u16(height));

    const useLocal = !global;
    const tableSize = useLocal ? paletteTableSize(frame.palette.length) : globalTableSize;
    push(bytesOf(useLocal ? 0x80 | colorTableSizeField(tableSize) : 0));
    if (useLocal) push(paletteBytes(frame.palette, tableSize));

    const minCodeSize = minCodeSizeFor(tableSize);
    push(bytesOf(minCodeSize));
    const lzw = gifLzwEncode(frame.indices, minCodeSize);
    push(toSubBlocks(lzw));
  }

  push(bytesOf(0x3b)); // trailer

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function encodeGifBlob(opts: GifEncodeOptions): Blob {
  const bytes = encodeGif(opts);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' });
}
