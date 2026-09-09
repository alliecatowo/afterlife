/**
 * GIF-flavoured variable-width LZW encoder (the compression scheme mandated
 * by the GIF89a spec — not the classic fixed-width Unix `compress` LZW).
 * Hand-written per this project's "zero new dependencies" rule.
 *
 * Reference behaviour (GIF89a Appendix F): codes 0..(2^minCodeSize - 1) are
 * the literal palette indices; `clearCode = 2^minCodeSize` resets the
 * dictionary; `endCode = clearCode + 1` terminates the stream. Code width
 * starts at `minCodeSize + 1` bits and grows by one bit each time the
 * dictionary's next free code would overflow the current width, up to a
 * hard ceiling of 12 bits, at which point the encoder emits a Clear Code and
 * resets rather than growing further (matching every real GIF decoder's
 * fixed 4096-entry table).
 */

const MAX_CODE_BITS = 12;
const MAX_DICT_SIZE = 1 << MAX_CODE_BITS;

/** Bit-packs LSB-first, the order GIF's LZW data stream requires. */
class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private bitCount = 0;

  writeCode(code: number, width: number): void {
    this.current |= code << this.bitCount;
    this.bitCount += width;
    while (this.bitCount >= 8) {
      this.bytes.push(this.current & 0xff);
      this.current >>= 8;
      this.bitCount -= 8;
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.bytes.push(this.current & 0xff);
      this.current = 0;
      this.bitCount = 0;
    }
    return new Uint8Array(this.bytes);
  }
}

/**
 * Encode a sequence of palette indices (each `< 2^minCodeSize`) into a raw
 * GIF LZW bitstream (NOT yet split into 255-byte sub-blocks — see
 * `gifWriter.ts`'s `toSubBlocks` for that). `minCodeSize` must be >= 2 (the
 * GIF spec's floor, even for a 2-colour palette).
 */
export function gifLzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const codeSize = Math.max(2, minCodeSize);
  const clearCode = 1 << codeSize;
  const endCode = clearCode + 1;

  const writer = new BitWriter();
  let codeWidth = codeSize + 1;
  // Dictionary: string (as a compact key) -> code. Reset alongside the
  // decoder's own table whenever a Clear Code is emitted.
  let dict = new Map<string, number>();
  let nextCode = endCode + 1;

  function resetDict(): void {
    dict = new Map();
    nextCode = endCode + 1;
    codeWidth = codeSize + 1;
  }

  writer.writeCode(clearCode, codeWidth);
  resetDict();

  if (indices.length === 0) {
    writer.writeCode(endCode, codeWidth);
    return writer.finish();
  }

  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const combined = `${prefix},${k}`;
    if (dict.has(combined)) {
      prefix = combined;
      continue;
    }
    // Emit the code for `prefix` (a literal single index if it was never
    // extended), then start a fresh prefix at `k`.
    const prefixCode = prefix.includes(',') ? dict.get(prefix)! : Number(prefix);
    writer.writeCode(prefixCode, codeWidth);

    if (nextCode < MAX_DICT_SIZE) {
      dict.set(combined, nextCode);
      nextCode++;
      // Widen when `nextCode` (the code the FOLLOWING new dictionary entry
      // would get) exceeds `2^codeWidth`, i.e. one code past what "the
      // table is exactly full" naively suggests (`nextCode > (1<<codeWidth)
      // - 1`, the textbook LZW rule, is one code TOO EARLY for GIF's own
      // variant). A conforming GIF decoder's own dictionary insertion
      // always lags one code behind the encoder's — it can only learn a
      // new string's last character from the code AFTER the one that
      // completes it — so its code-width transition naturally lands one
      // code later than a naive encoder's. This threshold matches that.
      // Confirmed empirically against Chromium's own `ImageDecoder` in
      // `e2e/gif-export.spec.ts` (a real third-party decoder, not a
      // self-authored round-trip) across random/sparse/run-length content
      // and a forced 4096-entry dictionary reset.
      if (nextCode > (1 << codeWidth) && codeWidth < MAX_CODE_BITS) {
        codeWidth++;
      }
    } else {
      // Dictionary is full — clear and start over, exactly like a decoder
      // hitting the same ceiling would expect.
      writer.writeCode(clearCode, codeWidth);
      resetDict();
    }
    prefix = String(k);
  }

  const lastCode = prefix.includes(',') ? dict.get(prefix)! : Number(prefix);
  writer.writeCode(lastCode, codeWidth);
  writer.writeCode(endCode, codeWidth);
  return writer.finish();
}
