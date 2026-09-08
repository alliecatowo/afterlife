/**
 * Minimal ZIP writer — STORED (uncompressed) entries only. That's a legal
 * ZIP per the spec (compression method 0), and it's the right trade-off
 * here: entries are already-compressed PNGs, so a second compression pass
 * would cost CPU for no size benefit. Pure (returns bytes; the caller wraps
 * in a `Blob`).
 */
import { crc32 } from './crc32';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LOCAL_FILE_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

/** MS-DOS date/time encoding, fixed at a stable epoch — export ZIPs don't
 *  need real per-frame timestamps, and a fixed value keeps output byte-
 *  identical across runs of the same export (useful for tests / diffing). */
const DOS_TIME = 0;
const DOS_DATE = (1 << 9) | (1 << 5) | 1; // 1980-01-01, the DOS epoch

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    offsets.push(offset);

    const local = [
      u32(LOCAL_FILE_SIG),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method: stored
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(size), // compressed size
      u32(size), // uncompressed size
      u16(nameBytes.length),
      u16(0), // extra field length
      nameBytes,
      entry.data,
    ];
    for (const part of local) localParts.push(part);
    const localLength = local.reduce((sum, p) => sum + p.length, 0);

    const central = [
      u32(CENTRAL_DIR_SIG),
      u16(20), // version made by
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk number
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset),
      nameBytes,
    ];
    for (const part of central) centralParts.push(part);

    offset += localLength;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);

  const end = [
    u32(END_OF_CENTRAL_DIR_SIG),
    u16(0), // disk number
    u16(0), // central dir start disk
    u16(entries.length), // records on this disk
    u16(entries.length), // total records
    u32(centralSize),
    u32(centralStart),
    u16(0), // comment length
  ];

  const totalLength = offset + centralSize + end.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, ...end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

export function buildZipBlob(entries: readonly ZipEntry[]): Blob {
  return new Blob([buildZip(entries)], { type: 'application/zip' });
}
