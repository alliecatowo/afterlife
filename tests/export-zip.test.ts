import { describe, expect, it } from 'vitest';
import { crc32 } from '@/export/crc32';
import { buildZip } from '@/export/zip';

describe('crc32', () => {
  it('matches the canonical CRC-32 check value for "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zip: buildZip', () => {
  it('produces a structurally valid archive with correct signatures and offsets', () => {
    const a = new TextEncoder().encode('hello world');
    const b = new TextEncoder().encode('afterlife');
    const bytes = buildZip([{ name: 'a.txt', data: a }, { name: 'b.txt', data: b }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // First local file header.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const firstNameLen = view.getUint16(26, true);
    expect(firstNameLen).toBe('a.txt'.length);

    // The end-of-central-directory record's signature must appear somewhere
    // near the tail, and its record counts must match the entry count.
    const tail = bytes.slice(bytes.length - 22);
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    expect(tailView.getUint32(0, true)).toBe(0x06054b50);
    expect(tailView.getUint16(8, true)).toBe(2); // records on this disk
    expect(tailView.getUint16(10, true)).toBe(2); // total records

    // Every central-directory-header signature is present exactly `entries.length` times.
    let centralHeaderCount = 0;
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) centralHeaderCount++;
    }
    expect(centralHeaderCount).toBe(2);
  });

  it('round-trips file contents (verified via a minimal manual parse)', () => {
    const data = new TextEncoder().encode('round trip me');
    const bytes = buildZip([{ name: 'x.bin', data }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    const dataStart = 30 + nameLen + extraLen;
    const size = view.getUint32(18, true);
    const extracted = bytes.slice(dataStart, dataStart + size);
    expect(new TextDecoder().decode(extracted)).toBe('round trip me');
  });

  it('produces an empty-but-valid archive for zero entries', () => {
    const bytes = buildZip([]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
  });
});
