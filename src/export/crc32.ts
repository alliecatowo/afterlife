/** Standard table-based CRC-32 (ISO 3309 / ITU-T V.42), as used by ZIP and
 *  GIF-adjacent formats. Pure. Verify against the canonical check value:
 *  `crc32(new TextEncoder().encode('123456789'))` === `0xCBF43926`. */

let table: Uint32Array | null = null;

function buildTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
}

export function crc32(data: Uint8Array, seed = 0): number {
  table ??= buildTable();
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
