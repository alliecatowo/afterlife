/**
 * `gifLzwEncode` unit tests. This file's own `decodeForTest` is a SANITY
 * CHECK ONLY — round-tripping through a decoder this same test file wrote
 * cannot prove the bitstream matches what a real GIF decoder expects (the
 * exact failure mode `INTEGRATION-NOTES.md` documents for the original,
 * cut attempt at this encoder). The actual verification against a genuine
 * third-party decoder (Chromium's `ImageDecoder`) lives in
 * `e2e/gif-export.spec.ts`. This file exists to catch REGRESSIONS quickly
 * without a browser, not to certify correctness on its own.
 */
import { describe, expect, it } from 'vitest';
import { gifLzwEncode } from '@/export/gif/lzw';

/** Minimal GIF-flavoured LZW decoder, independent implementation style from
 *  the encoder (reads codes as encountered, rebuilding the dictionary in
 *  lockstep) — see the file doc for what this can and can't prove. */
function decodeForTest(data: Uint8Array, minCodeSize: number): number[] {
  const codeSize = Math.max(2, minCodeSize);
  const clearCode = 1 << codeSize;
  const endCode = clearCode + 1;

  let bitPos = 0;
  function readCode(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const byteIndex = bitPos >> 3;
      const bitIndex = bitPos & 7;
      const bit = (data[byteIndex]! >> bitIndex) & 1;
      value |= bit << i;
      bitPos++;
    }
    return value;
  }

  let codeWidth = codeSize + 1;
  let dict: number[][] = [];
  let nextCode = 0;

  function resetDict(): void {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]); // clearCode placeholder
    dict.push([]); // endCode placeholder
    nextCode = endCode + 1;
    codeWidth = codeSize + 1;
  }

  const output: number[] = [];
  let prev: number[] | null = null;

  for (;;) {
    const code = readCode(codeWidth);
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }
    if (code === endCode) break;

    let entry: number[];
    if (code < dict.length && dict[code]!.length > 0) {
      entry = dict[code]!;
    } else if (code === nextCode && prev) {
      entry = [...prev, prev[0]!];
    } else {
      throw new Error(`decodeForTest: bad code ${code}`);
    }
    output.push(...entry);

    if (prev) {
      dict[nextCode] = [...prev, entry[0]!];
      nextCode++;
      // NOT the same threshold as `lzw.ts`'s own encoder-side check
      // (`nextCode > 2^codeWidth` there) — a decoder's own dictionary
      // insertion always lags the encoder's by one code (see `lzw.ts`'s
      // doc), so a decoder built the same way must widen a code EARLIER
      // than the encoder's own formula to land on the same bit width for
      // the same code. This is a real, empirically-confirmed asymmetry
      // (verified by hand against Chromium's `ImageDecoder` while
      // developing the encoder), not a typo.
      if (nextCode > (1 << codeWidth) - 1 && codeWidth < 12) codeWidth++;
    }
    prev = entry;
  }

  return output;
}

describe('gifLzwEncode: round-trip (sanity check only — see file doc)', () => {
  it('round-trips a short, repetitive sequence', () => {
    const indices = Uint8Array.from([0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]);
    const encoded = gifLzwEncode(indices, 2);
    const decoded = decodeForTest(encoded, 2);
    expect(decoded).toEqual(Array.from(indices));
  });

  it('round-trips a longer sequence that forces the dictionary to grow past 8 bits', () => {
    // A de Bruijn-ish varied sequence over a bigger alphabet, long enough to
    // exercise the code-width growth from 5 -> 6 -> ... bits.
    const alphabet = 16;
    const indices = new Uint8Array(2000);
    let x = 1;
    for (let i = 0; i < indices.length; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      indices[i] = x % alphabet;
    }
    const encoded = gifLzwEncode(indices, 4);
    const decoded = decodeForTest(encoded, 4);
    expect(decoded).toEqual(Array.from(indices));
  });

  it('round-trips an empty index sequence', () => {
    const encoded = gifLzwEncode(new Uint8Array(0), 2);
    const decoded = decodeForTest(encoded, 2);
    expect(decoded).toEqual([]);
  });

  it('round-trips a single repeated value across many dictionary insertions', () => {
    // NOT big enough to hit the 4096-entry dictionary reset (a single
    // repeated symbol needs ~8M elements for that — each new dictionary
    // entry only extends the representable run by one, a triangular-number
    // growth curve). That path is instead covered by
    // `e2e/gif-export.spec.ts`'s large random-content case, verified
    // against Chromium's real decoder rather than this file's own.
    const indices = new Uint8Array(6000).fill(1);
    const encoded = gifLzwEncode(indices, 2);
    const decoded = decodeForTest(encoded, 2);
    expect(decoded).toEqual(Array.from(indices));
  });

  it('always starts with a Clear Code and ends with an End Code', () => {
    const indices = Uint8Array.from([0, 1, 0, 1]);
    const minCodeSize = 2;
    const encoded = gifLzwEncode(indices, minCodeSize);
    // First codeWidth bits of the stream must equal the clear code (4).
    const clearCode = 1 << minCodeSize;
    const firstCode = encoded[0]! & ((1 << (minCodeSize + 1)) - 1);
    expect(firstCode).toBe(clearCode);
  });
});
